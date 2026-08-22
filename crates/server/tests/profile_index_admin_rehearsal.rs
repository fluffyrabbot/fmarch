//! Exact subprocess rehearsal for a drained profile handle-index rekey.

use std::process::Command;
use std::sync::{Mutex, MutexGuard};

use profile_application::ProfileApplicationError;
use social::{
    PrincipalId, ProfileBio, ProfileDisplayName, ProfileHandle, ProfilePresentation,
    ProfileVisibility,
};
use sqlx::PgPool;

static PROFILE_INDEX_ENV_LOCK: Mutex<()> = Mutex::new(());
const APPLICATION_DATABASE_PASSWORD: &str = "profile-index-admin-application-proof";
const KEY_ADMIN_DATABASE_PASSWORD: &str = "profile-index-admin-key-authority-proof";
const CURRENT_KID: &str = "profile-index-rehearsal-v1";
const CURRENT_KEY: &str = "current-profile-index-rehearsal-key-material-0001";
const REPLACEMENT_KID: &str = "profile-index-rehearsal-v2";
const REPLACEMENT_KEY: &str = "rotated-profile-index-rehearsal-key-material-0002";

struct ProfileIndexEnvironment {
    prior_key: Option<String>,
    prior_kid: Option<String>,
    prior_replacement_key: Option<String>,
    prior_subject_key_dir: Option<String>,
    directory: tempfile::TempDir,
    _lock: MutexGuard<'static, ()>,
}

impl ProfileIndexEnvironment {
    fn isolated() -> Self {
        let lock = PROFILE_INDEX_ENV_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let directory = tempfile::tempdir().expect("create hermetic subject-key directory");
        let guard = Self {
            prior_key: std::env::var("FMARCH_PROFILE_HANDLE_INDEX_KEY").ok(),
            prior_kid: std::env::var("FMARCH_PROFILE_HANDLE_INDEX_KID").ok(),
            prior_replacement_key: std::env::var("FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY")
                .ok(),
            prior_subject_key_dir: std::env::var("FMARCH_SUBJECT_KEY_DIR").ok(),
            directory,
            _lock: lock,
        };
        guard.set_active(CURRENT_KID, CURRENT_KEY);
        std::env::remove_var("FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY");
        std::env::set_var("FMARCH_SUBJECT_KEY_DIR", guard.directory.path());
        guard
    }

    fn set_active(&self, kid: &str, key: &str) {
        std::env::set_var("FMARCH_PROFILE_HANDLE_INDEX_KID", kid);
        std::env::set_var("FMARCH_PROFILE_HANDLE_INDEX_KEY", key);
    }
}

impl Drop for ProfileIndexEnvironment {
    fn drop(&mut self) {
        restore_env("FMARCH_PROFILE_HANDLE_INDEX_KEY", &self.prior_key);
        restore_env("FMARCH_PROFILE_HANDLE_INDEX_KID", &self.prior_kid);
        restore_env(
            "FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY",
            &self.prior_replacement_key,
        );
        restore_env("FMARCH_SUBJECT_KEY_DIR", &self.prior_subject_key_dir);
    }
}

fn restore_env(name: &str, value: &Option<String>) {
    match value {
        Some(value) => std::env::set_var(name, value),
        None => std::env::remove_var(name),
    }
}

fn presentation(handle: &str) -> ProfilePresentation {
    ProfilePresentation::new(
        ProfileHandle::new(handle).expect("valid profile handle"),
        ProfileDisplayName::new("Rotation rehearsal").expect("valid profile display name"),
        ProfileBio::new("This profile proves a blind-index rotation.").expect("valid profile bio"),
        ProfileVisibility::Private,
    )
}

async fn ensure_principal(pool: &PgPool, principal_id: PrincipalId) {
    let mut connection = pool.acquire().await.expect("acquire principal connection");
    identity::methods::ensure_principal(&mut connection, &principal_id, &[], 1)
        .await
        .expect("provision active test principal");
}

async fn application_database_url(pool: &PgPool) -> String {
    let database: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(pool)
        .await
        .expect("query temporary database name");
    let base = std::env::var("DATABASE_URL").expect("DATABASE_URL for sqlx test database admin");
    let mut url = url::Url::parse(&base).expect("DATABASE_URL is a URL");
    url.set_path(&format!("/{database}"));
    url.set_username(server::APPLICATION_DATABASE_ROLE)
        .expect("PostgreSQL URL accepts application role");
    url.set_password(Some(APPLICATION_DATABASE_PASSWORD))
        .expect("PostgreSQL URL accepts application password");
    url.set_query(Some("sslmode=disable"));
    url.to_string()
}

fn run_admin(
    database_url: &str,
    subject_key_dir: &std::path::Path,
    operation: &str,
    execute: bool,
) -> std::process::Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_fmarch-profile-index-admin"));
    command
        .env_clear()
        .args([
            "profile-handle-index",
            operation,
            "--expect-current-kid",
            CURRENT_KID,
            "--replacement-kid",
            REPLACEMENT_KID,
        ])
        .env("DATABASE_URL", database_url)
        .env("FMARCH_PROFILE_HANDLE_INDEX_KEY", CURRENT_KEY)
        .env("FMARCH_PROFILE_HANDLE_INDEX_KID", CURRENT_KID)
        .env(
            "FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY",
            REPLACEMENT_KEY,
        )
        .env("FMARCH_SUBJECT_KEY_DIR", subject_key_dir);
    if execute {
        command.args(["--writers-drained", "--execute"]);
    }
    command.output().expect("run profile-index admin binary")
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn deployed_admin_reindexes_claim_derived_tokens_without_event_payload_compatibility(
    pool: PgPool,
) {
    let environment = ProfileIndexEnvironment::isolated();
    let first_principal = PrincipalId::random();
    ensure_principal(&pool, first_principal).await;
    let profile = profile_application::create_profile(
        &pool,
        first_principal,
        presentation("rotation_rehearsal"),
        1,
    )
    .await
    .expect("create profile under current handle-index key");
    profile_application::verify_profile_handle_index_consistency(&pool)
        .await
        .expect("current key audits the initial reservation");

    let canonical = eventstore::load_stream(&pool, profile.as_uuid())
        .await
        .expect("load canonical profile event");
    assert_eq!(canonical.len(), 1);
    assert_eq!(
        canonical[0]
            .payload
            .as_object()
            .expect("canonical profile payload is an object")
            .keys()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>(),
        ["claim_id", "subject_id"].into_iter().collect(),
        "derived handle-index data must not become event history"
    );

    let old_token: Vec<u8> =
        sqlx::query_scalar("SELECT handle_hmac FROM member_profile WHERE profile_id = $1")
            .bind(profile.as_uuid())
            .fetch_one(&pool)
            .await
            .expect("read current blind-index token");

    server::reconcile_database_authority(
        &pool,
        APPLICATION_DATABASE_PASSWORD,
        KEY_ADMIN_DATABASE_PASSWORD,
    )
    .await
    .expect("grant the protected application role its exact authority");
    let database_url = application_database_url(&pool).await;

    let plan = run_admin(&database_url, environment.directory.path(), "plan", false);
    assert!(
        plan.status.success(),
        "plan failed: stdout={} stderr={}",
        String::from_utf8_lossy(&plan.stdout),
        String::from_utf8_lossy(&plan.stderr),
    );
    let plan: serde_json::Value = serde_json::from_slice(&plan.stdout).expect("plan JSON");
    assert_eq!(plan["status"], "planned");
    assert_eq!(plan["active_profile_count"], 1);
    assert_eq!(plan["requires_writer_drain"], true);

    let ungated = run_admin(
        &database_url,
        environment.directory.path(),
        "reindex",
        false,
    );
    assert!(
        !ungated.status.success(),
        "reindex cannot be an accidental command"
    );
    assert!(String::from_utf8_lossy(&ungated.stderr).contains("--writers-drained and --execute"));

    let reindex_output = run_admin(&database_url, environment.directory.path(), "reindex", true);
    assert!(
        reindex_output.status.success(),
        "reindex failed: stdout={} stderr={}",
        String::from_utf8_lossy(&reindex_output.stdout),
        String::from_utf8_lossy(&reindex_output.stderr),
    );
    let reindex_stdout = String::from_utf8(reindex_output.stdout).expect("reindex stdout is UTF-8");
    let reindex: serde_json::Value = serde_json::from_str(&reindex_stdout).expect("reindex JSON");
    assert_eq!(reindex["status"], "reindexed");
    assert_eq!(reindex["current_kid"], CURRENT_KID);
    assert_eq!(reindex["replacement_kid"], REPLACEMENT_KID);
    assert_eq!(reindex["active_profile_count"], 1);
    assert!(!reindex_stdout.contains(CURRENT_KEY));
    assert!(!reindex_stdout.contains(REPLACEMENT_KEY));

    let replacement_token: Vec<u8> =
        sqlx::query_scalar("SELECT handle_hmac FROM member_profile WHERE profile_id = $1")
            .bind(profile.as_uuid())
            .fetch_one(&pool)
            .await
            .expect("read replacement blind-index token");
    assert_ne!(replacement_token, old_token);

    environment.set_active(REPLACEMENT_KID, REPLACEMENT_KEY);
    profile_application::verify_profile_handle_index_consistency(&pool)
        .await
        .expect("replacement key passes the startup audit");
    projections::rebuild_profile_stream(&pool, profile.as_uuid())
        .await
        .expect("replay derives the replacement token from the sealed claim");
    let rebuilt_token: Vec<u8> =
        sqlx::query_scalar("SELECT handle_hmac FROM member_profile WHERE profile_id = $1")
            .bind(profile.as_uuid())
            .fetch_one(&pool)
            .await
            .expect("read rebuilt blind-index token");
    assert_eq!(rebuilt_token, replacement_token);

    let duplicate_principal = PrincipalId::random();
    ensure_principal(&pool, duplicate_principal).await;
    assert!(matches!(
        profile_application::create_profile(
            &pool,
            duplicate_principal,
            presentation("rotation_rehearsal"),
            2,
        )
        .await,
        Err(ProfileApplicationError::HandleAlreadyExists)
    ));

    environment.set_active(CURRENT_KID, CURRENT_KEY);
    assert!(
        profile_application::verify_profile_handle_index_consistency(&pool)
            .await
            .is_err(),
        "the old configuration must fail closed after a successful reindex"
    );
}
