use std::{
    process::{Command, Output},
    time::{Duration, Instant},
};

use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

const RELEASE_COMMIT: &str = "1111111111111111111111111111111111111111";
const PROJECT_ID: &str = "9d285d67-c11b-4508-9efb-fad042787b4c";
const ENVIRONMENT_ID: &str = "e109e500-2a4c-48a3-96f2-e92a9edb63e4";
const RESET_OPERATION_ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MIGRATION_OPERATION_ID: &str =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const APPLICATION_PASSWORD: &str = "reset-recovery-application-password-proof";
const KEY_ADMIN_PASSWORD: &str = "reset-recovery-key-admin-password-proof";

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
        )
        .env("FMARCH_DB_ACQUIRE_TIMEOUT_MS", "30000")
        .env("FMARCH_DB_LOCK_TIMEOUT_MS", "60000")
        .env("FMARCH_DB_STATEMENT_TIMEOUT_MS", "300000")
        .env("FMARCH_DB_OPERATION_TIMEOUT_MS", "600000");
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
    command.arg("--operation-id").arg(RESET_OPERATION_ID);
    command
}

fn migration_command(database_url: &str) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_fmarch-migrate"));
    command
        .arg("--operation-id")
        .arg(MIGRATION_OPERATION_ID)
        .env_clear()
        .env("DATABASE_MIGRATION_URL", database_url)
        .env("FMARCH_DATABASE_ENVIRONMENT", "staging")
        .env("FMARCH_DATABASE_PROJECT_ID", PROJECT_ID)
        .env("FMARCH_DATABASE_ENVIRONMENT_ID", ENVIRONMENT_ID)
        .env("FMARCH_DATABASE_APPLICATION_PASSWORD", APPLICATION_PASSWORD)
        .env("FMARCH_DATABASE_KEY_ADMIN_PASSWORD", KEY_ADMIN_PASSWORD)
        .env("FMARCH_DB_ACQUIRE_TIMEOUT_MS", "30000")
        .env("FMARCH_DB_LOCK_TIMEOUT_MS", "60000")
        .env("FMARCH_DB_STATEMENT_TIMEOUT_MS", "300000")
        .env("FMARCH_DB_OPERATION_TIMEOUT_MS", "600000");
    command
}

fn install_short_debug_deadlines(command: &mut Command) {
    command
        .env("FMARCH_DB_ACQUIRE_TIMEOUT_MS", "500")
        .env("FMARCH_DB_LOCK_TIMEOUT_MS", "1000")
        .env("FMARCH_DB_STATEMENT_TIMEOUT_MS", "2000")
        .env("FMARCH_DB_OPERATION_TIMEOUT_MS", "4000");
}

fn install_outer_deadline_failpoint(command: &mut Command) {
    command
        .env("FMARCH_DB_ACQUIRE_TIMEOUT_MS", "50")
        .env("FMARCH_DB_LOCK_TIMEOUT_MS", "100")
        .env("FMARCH_DB_STATEMENT_TIMEOUT_MS", "150")
        .env("FMARCH_DB_OPERATION_TIMEOUT_MS", "200")
        .env("FMARCH_DB_OPERATION_TEST_DELAY_MS", "500");
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
    assert_eq!(
        message(&first_audit, "fmarch-schema-epoch-reset-audit")["operation_id"],
        RESET_OPERATION_ID
    );
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
    assert_eq!(completion["operation_id"], RESET_OPERATION_ID);
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

    let migration = migration_command(&database_url)
        .output()
        .expect("run migrator after recovered reset");
    assert!(
        migration.status.success(),
        "migration after recovery failed: {}",
        String::from_utf8_lossy(&migration.stderr)
    );
    assert_eq!(
        message(&migration, "fmarch-database-migration-complete")["operation_id"],
        MIGRATION_OPERATION_ID
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn shared_lock_contention_is_bounded_and_leaves_no_database_side_effects(pool: PgPool) {
    database_schema::bind_database_environment_identity(
        &pool,
        "staging",
        PROJECT_ID,
        ENVIRONMENT_ID,
    )
    .await
    .expect("explicitly bootstrap disposable database identity");
    database_schema::reconcile_database_authority(&pool, APPLICATION_PASSWORD, KEY_ADMIN_PASSWORD)
        .await
        .expect("establish the application privilege manifest");
    let database_url = migration_url(&pool).await;

    sqlx::query("CREATE TABLE public.deadline_reset_canary (id bigint PRIMARY KEY)")
        .execute(&pool)
        .await
        .unwrap();
    let audit = run_reset(&database_url, false, None);
    assert!(
        audit.status.success(),
        "pre-contention audit failed: {}",
        String::from_utf8_lossy(&audit.stderr)
    );
    let inventory = message(&audit, "fmarch-schema-epoch-reset-audit")["counts"].clone();

    let mut blocker = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(server::DATABASE_IDENTITY_ADVISORY_LOCK)
        .execute(&mut *blocker)
        .await
        .unwrap();

    let mut reset = reset_command(&database_url, true, Some(&inventory));
    install_short_debug_deadlines(&mut reset);
    let started = Instant::now();
    let reset = reset.output().expect("run lock-contended reset");
    assert!(
        !reset.status.success(),
        "contended reset unexpectedly succeeded"
    );
    assert!(
        started.elapsed() < Duration::from_secs(8),
        "contended reset did not exit within its bounded deadline"
    );

    let unlocked: bool = sqlx::query_scalar("SELECT pg_advisory_unlock($1)")
        .bind(server::DATABASE_IDENTITY_ADVISORY_LOCK)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    assert!(unlocked);

    let mut delayed_reset = reset_command(&database_url, true, Some(&inventory));
    install_outer_deadline_failpoint(&mut delayed_reset);
    let started = Instant::now();
    let delayed_reset = delayed_reset
        .output()
        .expect("run operation-deadline reset");
    assert!(!delayed_reset.status.success());
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(String::from_utf8_lossy(&delayed_reset.stderr)
        .contains("exceeded its database operation deadline"));

    let canary_remains: bool =
        sqlx::query_scalar("SELECT to_regclass('public.deadline_reset_canary') IS NOT NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(canary_remains, "timed-out reset dropped the public schema");
    sqlx::query("DROP TABLE public.deadline_reset_canary")
        .execute(&pool)
        .await
        .unwrap();

    let application_had_select: bool =
        sqlx::query_scalar("SELECT has_table_privilege($1, 'public.events', 'SELECT')")
            .bind(server::APPLICATION_DATABASE_ROLE)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(application_had_select);
    sqlx::query("REVOKE SELECT ON TABLE public.events FROM fmarch_application")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(server::DATABASE_IDENTITY_ADVISORY_LOCK)
        .execute(&mut *blocker)
        .await
        .unwrap();

    let mut migration = migration_command(&database_url);
    install_short_debug_deadlines(&mut migration);
    let started = Instant::now();
    let migration = migration.output().expect("run lock-contended migrator");
    assert!(
        !migration.status.success(),
        "contended migrator unexpectedly succeeded"
    );
    assert!(
        started.elapsed() < Duration::from_secs(8),
        "contended migrator did not exit within its bounded deadline"
    );

    let unlocked: bool = sqlx::query_scalar("SELECT pg_advisory_unlock($1)")
        .bind(server::DATABASE_IDENTITY_ADVISORY_LOCK)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    assert!(unlocked);

    let mut delayed_migration = migration_command(&database_url);
    install_outer_deadline_failpoint(&mut delayed_migration);
    let started = Instant::now();
    let delayed_migration = delayed_migration
        .output()
        .expect("run operation-deadline migrator");
    assert!(!delayed_migration.status.success());
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(String::from_utf8_lossy(&delayed_migration.stderr)
        .contains("exceeded its database operation deadline"));

    let application_select_was_not_repaired: bool =
        sqlx::query_scalar("SELECT has_table_privilege($1, 'public.events', 'SELECT')")
            .bind(server::APPLICATION_DATABASE_ROLE)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        !application_select_was_not_repaired,
        "timed-out migrator reconciled application privileges"
    );

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let binary_sessions: i64 = sqlx::query_scalar(
                r#"
                SELECT COUNT(*)
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND (
                    application_name LIKE 'fmarch-migrate:%'
                    OR application_name LIKE 'fmarch-schema-epoch-reset:%'
                  )
                "#,
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            if binary_sessions == 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("one-shot binary database sessions remained after process exit");
}
