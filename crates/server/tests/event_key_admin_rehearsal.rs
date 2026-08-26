//! Exact subprocess rehearsal for runtime KEK migration and retirement.

use std::process::Command;
use std::sync::{Mutex, MutexGuard};

use eventstore::{ActorId, EventInput, RuntimeKekLifecycle};
use identity::{MethodKind, PrincipalId};
use sqlx::{PgPool, Row};
use uuid::Uuid;

static ENCRYPTION_ENV_LOCK: Mutex<()> = Mutex::new(());
const APPLICATION_DATABASE_PASSWORD: &str = "event-key-admin-application-proof";
const KEY_ADMIN_DATABASE_PASSWORD: &str = "event-key-admin-key-authority-proof";

struct EncryptionEnvGuard {
    prior_key: Option<String>,
    prior_kid: Option<String>,
    prior_keys: Option<String>,
    _lock: MutexGuard<'static, ()>,
}

impl EncryptionEnvGuard {
    fn new() -> Self {
        let lock = ENCRYPTION_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let guard = Self {
            prior_key: std::env::var("FMARCH_EVENT_WRAP_KEY").ok(),
            prior_kid: std::env::var("FMARCH_EVENT_WRAP_KID").ok(),
            prior_keys: std::env::var("FMARCH_EVENT_WRAP_KEYS").ok(),
            _lock: lock,
        };
        std::env::remove_var("FMARCH_EVENT_WRAP_KEY");
        std::env::remove_var("FMARCH_EVENT_WRAP_KID");
        std::env::remove_var("FMARCH_EVENT_WRAP_KEYS");
        guard
    }

    fn set_active(&self, kid: &str, key: &str) {
        std::env::set_var("FMARCH_EVENT_WRAP_KID", kid);
        std::env::set_var("FMARCH_EVENT_WRAP_KEY", key);
        std::env::remove_var("FMARCH_EVENT_WRAP_KEYS");
    }
}

impl Drop for EncryptionEnvGuard {
    fn drop(&mut self) {
        restore_env("FMARCH_EVENT_WRAP_KEY", &self.prior_key);
        restore_env("FMARCH_EVENT_WRAP_KID", &self.prior_kid);
        restore_env("FMARCH_EVENT_WRAP_KEYS", &self.prior_keys);
    }
}

fn restore_env(name: &str, value: &Option<String>) {
    match value {
        Some(value) => std::env::set_var(name, value),
        None => std::env::remove_var(name),
    }
}

fn run_admin(
    database_url: &str,
    operation: &str,
    historical: Option<(&str, &str)>,
) -> serde_json::Value {
    let binary = env!("CARGO_BIN_EXE_fmarch-event-key-admin");
    let mut command = Command::new(binary);
    command
        .args([
            "runtime-kek",
            operation,
            "--retiring-kid",
            "rehearsal-old",
            "--expect-active-kid",
            "rehearsal-new",
            "--batch-size",
            "1",
        ])
        .env("DATABASE_KEY_ADMIN_URL", database_url)
        .env_remove("DATABASE_URL")
        .env_remove("DATABASE_MIGRATION_URL")
        .env("FMARCH_EVENT_WRAP_KID", "rehearsal-new")
        .env(
            "FMARCH_EVENT_WRAP_KEY",
            "new rehearsal runtime key material",
        )
        .env("FMARCH_EVENT_ARCHIVE_KID", "rehearsal-archive")
        .env(
            "FMARCH_EVENT_ARCHIVE_KEY",
            "distinct rehearsal archive key material",
        )
        .env_remove("FMARCH_EVENT_WRAP_KEYS");
    if operation != "plan" {
        command.arg("--execute");
    }
    if let Some((kid, key)) = historical {
        command.env("FMARCH_EVENT_WRAP_KEYS", format!("{kid}={key}"));
    }
    let output = command.output().expect("run event-key admin binary");
    assert!(
        output.status.success(),
        "event-key admin {operation} failed: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    serde_json::from_slice(&output.stdout).expect("admin stdout is one JSON report")
}

fn rejected_admin_configuration(
    active_kid: &str,
    active_key: &str,
    archive_kid: &str,
    archive_key: &str,
) -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_fmarch-event-key-admin"))
        .args([
            "runtime-kek",
            "plan",
            "--retiring-kid",
            "prior-v1",
            "--expect-active-kid",
            active_kid,
        ])
        .env("FMARCH_EVENT_WRAP_KID", active_kid)
        .env("FMARCH_EVENT_WRAP_KEY", active_key)
        .env("FMARCH_EVENT_ARCHIVE_KID", archive_kid)
        .env("FMARCH_EVENT_ARCHIVE_KEY", archive_key)
        .env_remove("FMARCH_EVENT_WRAP_KEYS")
        .env_remove("FMARCH_DEV_AUTH")
        .env_remove("FMARCH_ALLOW_INSECURE_DEV_EVENT_KEY")
        .env_remove("DATABASE_URL")
        .env_remove("DATABASE_KEY_ADMIN_URL")
        .env_remove("DATABASE_MIGRATION_URL")
        .output()
        .expect("run rejected event-key admin configuration");
    assert!(!output.status.success());
    String::from_utf8(output.stderr).unwrap()
}

#[test]
fn admin_rejects_non_deployable_key_configuration_before_database_access() {
    let local_dev = rejected_admin_configuration(
        "local-dev",
        "local development runtime material",
        "archive-v1",
        "distinct archive material",
    );
    assert!(local_dev.contains("local-dev event wrapping kids are banned"));
    assert!(!local_dev.contains("DATABASE_KEY_ADMIN_URL"));

    let reused = rejected_admin_configuration(
        "runtime-v2",
        "accidentally reused custody material",
        "archive-v2",
        "accidentally reused custody material",
    );
    assert!(reused.contains("must not reuse runtime wrapping key material"));
    assert!(!reused.contains("DATABASE_KEY_ADMIN_URL"));
}

async fn ephemeral_database_url(pool: &PgPool) -> String {
    let database: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(pool)
        .await
        .unwrap();
    let base = std::env::var("DATABASE_URL").expect("DATABASE_URL for sqlx test database admin");
    let (server, _) = base
        .rsplit_once('/')
        .expect("DATABASE_URL must contain a database path");
    format!("{server}/{database}")
}

async fn key_admin_database_url(pool: &PgPool) -> String {
    let owner = ephemeral_database_url(pool).await;
    let mut url = url::Url::parse(&owner).expect("DATABASE_URL must be a URL");
    url.set_username(server::KEY_ADMIN_DATABASE_ROLE)
        .expect("PostgreSQL URL accepts a username");
    url.set_password(Some(KEY_ADMIN_DATABASE_PASSWORD))
        .expect("PostgreSQL URL accepts a password");
    if url.query().is_none() {
        url.query_pairs_mut().append_pair("sslmode", "disable");
    }
    url.to_string()
}

async fn seed_direct_surfaces(pool: &PgPool, game: Uuid, delivery: Uuid) {
    let game_text = game.to_string();
    let slot_context = format!("fmarch-projection-v1:slot_state:{game_text}:slot_1");
    let delivery_context = format!("fmarch:identity-delivery:v1:{delivery}:invite");
    let mut tx = pool.begin().await.unwrap();
    let slot_envelope = eventstore::encrypt_private_projection(
        &mut tx,
        serde_json::json!({"role_key": "doctor", "alignment": "town"}),
        &slot_context,
    )
    .await
    .unwrap();
    sqlx::query("INSERT INTO slot_state (game_id, slot_id, private) VALUES ($1, 'slot_1', $2)")
        .bind(game)
        .bind(slot_envelope)
        .execute(&mut *tx)
        .await
        .unwrap();

    let principal_id = PrincipalId::fixture("rotation-user");
    identity::methods::ensure_principal(&mut tx, &principal_id, &[], 1)
        .await
        .unwrap();
    let method_id =
        identity::methods::create_method(&mut tx, &principal_id, MethodKind::ClassicPassword, 1)
            .await
            .unwrap();
    sqlx::query(
        "INSERT INTO auth_account \
         (account_id, principal_id, method_id, password_hash, created_at, global_capabilities) \
         VALUES ('rotation@example.test', $1, $2, 'unused', 1, '{}')",
    )
    .bind(principal_id.as_uuid())
    .bind(method_id)
    .execute(&mut *tx)
    .await
    .unwrap();
    let credential_envelope = eventstore::encrypt_delivery_credential(
        &mut tx,
        "one-time-rotation-credential",
        &delivery_context,
    )
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO auth_delivery_intent (
            delivery_id, delivery_kind, account_id, principal_id,
            credential_hash, credential_expires_at, credential_envelope,
            status, attempt_count, next_attempt_at, delivered_at, last_error,
            created_at, updated_at, provider_id, outcome_kind, outcome_code,
            provider_receipt_id, claim_token, claim_expires_at
        )
        VALUES (
            $1, 'invite', 'rotation@example.test', $2,
            'rotation-hash', 1000, $3,
            'queued', 0, 100, NULL, NULL,
            1, 1, 'local-deterministic', 'queued', NULL,
            NULL, NULL, NULL
        )
        "#,
    )
    .bind(delivery)
    .bind(principal_id.as_uuid())
    .bind(credential_envelope)
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn deployed_admin_rehearses_old_key_removal_before_retirement(pool: PgPool) {
    let env = EncryptionEnvGuard::new();
    env.set_active("rehearsal-old", "old rehearsal runtime key material");
    let stream = Uuid::new_v4();
    let game = Uuid::new_v4();
    let delivery = Uuid::new_v4();
    eventstore::append(
        &pool,
        stream,
        &[EventInput::new(
            "RotationCanary",
            1,
            serde_json::json!({"canary": "stream-remains-readable"}),
            ActorId::System,
            1,
        )],
    )
    .await
    .unwrap();
    seed_direct_surfaces(&pool, game, delivery).await;
    env.set_active("rehearsal-new", "new rehearsal runtime key material");
    eventstore::attest_active_runtime_kek(&pool).await.unwrap();
    server::reconcile_database_authority(
        &pool,
        APPLICATION_DATABASE_PASSWORD,
        KEY_ADMIN_DATABASE_PASSWORD,
    )
    .await
    .unwrap();

    let database_url = key_admin_database_url(&pool).await;
    let mut held_registry = pool.begin().await.unwrap();
    sqlx::query("SELECT kid FROM event_direct_key_sentinel WHERE kid = 'rehearsal-old' FOR UPDATE")
        .fetch_one(&mut *held_registry)
        .await
        .unwrap();
    let timeout = Command::new(env!("CARGO_BIN_EXE_fmarch-event-key-admin"))
        .args([
            "runtime-kek",
            "migrate",
            "--retiring-kid",
            "rehearsal-old",
            "--expect-active-kid",
            "rehearsal-new",
            "--execute",
        ])
        .env("DATABASE_KEY_ADMIN_URL", &database_url)
        .env_remove("DATABASE_URL")
        .env_remove("DATABASE_MIGRATION_URL")
        .env("FMARCH_EVENT_WRAP_KID", "rehearsal-new")
        .env(
            "FMARCH_EVENT_WRAP_KEY",
            "new rehearsal runtime key material",
        )
        .env(
            "FMARCH_EVENT_WRAP_KEYS",
            "rehearsal-old=old rehearsal runtime key material",
        )
        .env("FMARCH_EVENT_ARCHIVE_KID", "rehearsal-archive")
        .env(
            "FMARCH_EVENT_ARCHIVE_KEY",
            "distinct rehearsal archive key material",
        )
        .env("FMARCH_DB_LOCK_TIMEOUT_MS", "100")
        .output()
        .expect("run bounded-lock event-key admin binary");
    assert!(!timeout.status.success());
    assert!(String::from_utf8_lossy(&timeout.stderr).contains("lock timeout"));
    held_registry.rollback().await.unwrap();

    let plan = run_admin(
        &database_url,
        "plan",
        Some(("rehearsal-old", "old rehearsal runtime key material")),
    );
    assert_eq!(plan["read_only"], true);
    assert_eq!(plan["references"]["stream_keys"], 1);
    assert_eq!(plan["references"]["private_projections"], 1);
    assert_eq!(plan["references"]["delivery_credentials"], 1);

    let migrated = run_admin(
        &database_url,
        "migrate",
        Some(("rehearsal-old", "old rehearsal runtime key material")),
    );
    assert_eq!(migrated["remaining_references"], 0);
    assert_eq!(migrated["migrated"]["stream_keys"], 1);
    assert_eq!(migrated["migrated"]["private_projections"], 1);
    assert_eq!(migrated["migrated"]["delivery_credentials"], 1);

    let rehearsed = run_admin(&database_url, "rehearse", None);
    assert_eq!(rehearsed["already_retired"], false);
    assert_eq!(rehearsed["evidence_recorded"], true);
    assert!(rehearsed.get("evidence").is_none());
    let rehearse_retry = run_admin(&database_url, "migrate", None);
    assert_eq!(rehearse_retry["already_rehearsed"], true);
    assert_eq!(rehearse_retry["remaining_references"], 0);
    let retired = run_admin(&database_url, "retire", None);
    assert_eq!(retired["already_retired"], false);
    assert_eq!(retired["lifecycle"]["lifecycle"], "retired");
    let retired_retry = run_admin(&database_url, "migrate", None);
    assert_eq!(retired_retry["already_retired"], true);
    assert_eq!(retired_retry["remaining_references"], 0);

    env.set_active("rehearsal-new", "new rehearsal runtime key material");
    eventstore::audit_event_encryption_key_coverage(&pool)
        .await
        .unwrap();
    eventstore::ensure_event_encryption_key_readiness(&pool)
        .await
        .unwrap();
    let events = eventstore::load_stream(&pool, stream).await.unwrap();
    assert_eq!(events[0].payload["canary"], "stream-remains-readable");

    let slot: serde_json::Value =
        sqlx::query_scalar("SELECT private FROM slot_state WHERE game_id = $1")
            .bind(game)
            .fetch_one(&pool)
            .await
            .unwrap();
    let slot_context = format!("fmarch-projection-v1:slot_state:{game}:slot_1");
    assert_eq!(
        eventstore::decrypt_private_projection(&slot, &slot_context).unwrap()["role_key"],
        "doctor"
    );
    let delivery_row = sqlx::query(
        "SELECT delivery_kind, credential_envelope FROM auth_delivery_intent WHERE delivery_id = $1",
    )
    .bind(delivery)
    .fetch_one(&pool)
    .await
    .unwrap();
    let envelope: serde_json::Value = delivery_row.get("credential_envelope");
    let delivery_context = format!("fmarch:identity-delivery:v1:{delivery}:invite");
    assert_eq!(
        eventstore::decrypt_delivery_credential(&envelope, &delivery_context).unwrap(),
        "one-time-rotation-credential"
    );
    assert_eq!(
        eventstore::runtime_kek_status(&pool, "rehearsal-old")
            .await
            .unwrap()
            .unwrap()
            .lifecycle,
        RuntimeKekLifecycle::Retired
    );
}
