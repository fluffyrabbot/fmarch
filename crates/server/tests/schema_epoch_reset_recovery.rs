use std::process::{Command, Output};

use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

const RELEASE_COMMIT: &str = "1111111111111111111111111111111111111111";
const PROJECT_ID: &str = "9d285d67-c11b-4508-9efb-fad042787b4c";
const ENVIRONMENT_ID: &str = "e109e500-2a4c-48a3-96f2-e92a9edb63e4";

async fn migration_url(pool: &PgPool) -> String {
    let database: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(pool)
        .await
        .expect("read disposable database name");
    let mut url = url::Url::parse(
        &std::env::var("DATABASE_URL").expect("canonical lane supplies DATABASE_URL"),
    )
    .expect("DATABASE_URL is valid");
    url.set_path(&format!("/{database}"));
    url.set_query(Some("sslmode=disable"));
    url.to_string()
}

fn epoch() -> u64 {
    serde_json::from_str::<Value>(include_str!("../../database_schema/schema/epoch.json")).unwrap()
        ["epoch"]
        .as_u64()
        .unwrap()
}

fn reset_command(database_url: &str, execute: bool, expected: Option<&Value>) -> Command {
    let epoch = epoch();
    let mut command = Command::new(env!("CARGO_BIN_EXE_fmarch-schema-epoch-reset"));
    command
        .env_clear()
        .env("DATABASE_MIGRATION_URL", database_url)
        .env("FMARCH_DATABASE_ENVIRONMENT", "staging")
        .env("FMARCH_DATABASE_PROJECT_ID", PROJECT_ID)
        .env("FMARCH_DATABASE_ENVIRONMENT_ID", ENVIRONMENT_ID)
        .env("FMARCH_SCHEMA_EPOCH_RESET_ENVIRONMENT", "staging")
        .env("FMARCH_SCHEMA_EPOCH_RESET_EPOCH", epoch.to_string())
        .env(
            "FMARCH_SCHEMA_EPOCH_RESET_CONFIRM",
            format!("staging:{epoch}:{RELEASE_COMMIT}"),
        )
        .env(
            "FMARCH_SCHEMA_EPOCH_RESET_TEST_RELEASE_COMMIT",
            RELEASE_COMMIT,
        );
    if execute {
        command.arg("--execute");
        let raw = expected
            .expect("execute requires expected inventory")
            .to_string();
        command
            .env("FMARCH_SCHEMA_EPOCH_RESET_EXPECTED_INVENTORY", &raw)
            .env(
                "FMARCH_SCHEMA_EPOCH_RESET_EXPECTED_INVENTORY_SHA256",
                format!("{:x}", Sha256::digest(raw.as_bytes())),
            );
    }
    command
}

fn run_reset(database_url: &str, execute: bool, expected: Option<&Value>) -> Output {
    reset_command(database_url, execute, expected)
        .output()
        .expect("run schema reset binary")
}

fn message(output: &Output, kind: &str) -> Value {
    String::from_utf8(output.stdout.clone())
        .expect("reset output is UTF-8")
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find(|value| value["kind"] == kind)
        .unwrap_or_else(|| panic!("missing {kind} output"))
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn committed_reset_recovers_without_a_second_drop_and_rejects_a_changed_inventory(
    pool: PgPool,
) {
    database_schema::bind_database_environment_identity(
        &pool,
        "staging",
        PROJECT_ID,
        ENVIRONMENT_ID,
    )
    .await
    .expect("explicitly bootstrap disposable database identity");
    let database_url = migration_url(&pool).await;

    let first_audit = run_reset(&database_url, false, None);
    assert!(first_audit.status.success());
    let first_inventory =
        message(&first_audit, "fmarch-schema-epoch-reset-audit")["counts"].clone();
    sqlx::query("CREATE TABLE public.audit_race_canary (id bigint PRIMARY KEY)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO public.audit_race_canary VALUES (1)")
        .execute(&pool)
        .await
        .unwrap();
    let changed = run_reset(&database_url, true, Some(&first_inventory));
    assert!(
        !changed.status.success(),
        "changed inventory must abort before DROP"
    );
    let events_still_exist: bool =
        sqlx::query_scalar("SELECT to_regclass('public.events') IS NOT NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        events_still_exist,
        "inventory mismatch must preserve public schema"
    );
    sqlx::query("DROP TABLE public.audit_race_canary")
        .execute(&pool)
        .await
        .unwrap();

    let audit = run_reset(&database_url, false, None);
    assert!(audit.status.success());
    let inventory = message(&audit, "fmarch-schema-epoch-reset-audit")["counts"].clone();
    let mut interrupted = reset_command(&database_url, true, Some(&inventory));
    interrupted.env(
        "FMARCH_SCHEMA_EPOCH_RESET_FAILPOINT",
        "after-commit-before-output",
    );
    let interrupted = interrupted.output().expect("run injected reset failure");
    assert!(!interrupted.status.success());
    assert_eq!(
        message(&interrupted, "fmarch-schema-epoch-reset-audit")["execute"],
        true
    );

    sqlx::query("CREATE TABLE public.retry_drop_canary (id bigint PRIMARY KEY)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO public.retry_drop_canary VALUES (1)")
        .execute(&pool)
        .await
        .unwrap();
    let recovered = run_reset(&database_url, true, Some(&inventory));
    assert!(recovered.status.success());
    let completion = message(&recovered, "fmarch-schema-epoch-reset-complete");
    assert_eq!(completion["release_commit"], RELEASE_COMMIT);
    assert_eq!(completion["prior_counts"], inventory);
    let canary_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM public.retry_drop_canary")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        canary_count, 1,
        "recovery must not repeat the destructive reset"
    );
    sqlx::query("DROP TABLE public.retry_drop_canary")
        .execute(&pool)
        .await
        .unwrap();

    let migration = Command::new(env!("CARGO_BIN_EXE_fmarch-migrate"))
        .env_clear()
        .env("DATABASE_MIGRATION_URL", &database_url)
        .env("FMARCH_DATABASE_ENVIRONMENT", "staging")
        .env("FMARCH_DATABASE_PROJECT_ID", PROJECT_ID)
        .env("FMARCH_DATABASE_ENVIRONMENT_ID", ENVIRONMENT_ID)
        .env(
            "FMARCH_DATABASE_APPLICATION_PASSWORD",
            "reset-recovery-application-password-proof",
        )
        .env(
            "FMARCH_DATABASE_KEY_ADMIN_PASSWORD",
            "reset-recovery-key-admin-password-proof",
        )
        .output()
        .expect("run migrator after recovered reset");
    assert!(
        migration.status.success(),
        "migration after recovery failed: {}",
        String::from_utf8_lossy(&migration.stderr)
    );
}
