//! Proofs for the authentication-method identity model: backend-issued
//! app-session tokens, principal/method rows on classic write paths, the lazy
//! upgrade of pre-refactor accounts, the WorkOS session exchange, method
//! management invariants, and bearer dispatch.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use api::ApiState;
use async_trait::async_trait;
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use identity::{
    AccessTokenVerifier, IdentityError, StaticAccessTokenVerifier, VerifiedIdentity,
    WorkosSessionId,
};
use media::{MediaLimits, MediaStore};
use principal::PrincipalId;
use tempfile::TempDir;
use tokio::sync::Notify;
use tower::ServiceExt;
use uuid::Uuid;

const TEST_LOCAL_PROOF_SECRET: &str =
    "123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0";

fn test_local_proof_verifier() -> api::LocalProofAuthVerifier {
    api::LocalProofAuthVerifier::from_secret(TEST_LOCAL_PROOF_SECRET)
        .expect("test local-proof secret is canonical")
}

fn test_state(pool: sqlx::PgPool, root: &TempDir) -> ApiState {
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    ApiState::new(pool, store)
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn response_principal_id(body: &serde_json::Value) -> PrincipalId {
    body["principal_id"]
        .as_str()
        .expect("response includes principal_id")
        .parse()
        .expect("response principal_id is a canonical UUID")
}

async fn assert_workos_provider_logout_recovery(
    response: axum::response::Response,
    session_id: &str,
) {
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = json_body(response).await;
    assert_eq!(body.as_object().unwrap().len(), 2, "body: {body}");
    assert_eq!(
        body,
        serde_json::json!({
            "error": "WorkosProviderSessionLogoutRequired",
            "provider_logout_url": format!(
                "https://api.workos.com/user_management/sessions/logout?session_id={session_id}"
            )
        })
    );
}

async fn post_json(
    app: &axum::Router,
    uri: &str,
    token: Option<&str>,
    body: serde_json::Value,
) -> axum::response::Response {
    let mut request = Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json");
    if uri == "/auth/local-proof/sessions" {
        request = request.header(api::LOCAL_PROOF_AUTH_HEADER, TEST_LOCAL_PROOF_SECRET);
    }
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    app.clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap()
}

async fn post_workos_session_from_source(
    app: &axum::Router,
    token: &str,
    source: &str,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/sessions")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .header("x-fmarch-auth-source", source)
                .body(Body::from(r#"{"method":"workos"}"#))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn register_classic_account(
    app: &axum::Router,
    pool: &sqlx::PgPool,
    account_id: &str,
    password: &str,
) -> (PrincipalId, String) {
    let response = register_classic_response(app, pool, account_id, password).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    (
        response_principal_id(&body),
        body["session_token"].as_str().unwrap().to_string(),
    )
}

async fn register_classic_response(
    app: &axum::Router,
    pool: &sqlx::PgPool,
    account_id: &str,
    password: &str,
) -> axum::response::Response {
    let invitation_credential = community_invitation_for(pool, account_id).await;
    post_json(
        app,
        "/auth/accounts/registrations",
        None,
        serde_json::json!({
            "invitation_credential": invitation_credential,
            "account_id": account_id,
            "password": password
        }),
    )
    .await
}

async fn community_invitation_for(pool: &sqlx::PgPool, account_id: &str) -> String {
    let founder = PrincipalId::random();
    let now = 1_700_000_000;
    let mut tx = pool.begin().await.unwrap();
    identity::methods::ensure_principal(&mut tx, &founder, &[], now)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    membership_application::ensure_founder_membership(pool, founder, now)
        .await
        .unwrap();
    membership_application::issue_invitation(
        pool,
        &membership_application::InvitationTargetIndex::from_env_or_local().unwrap(),
        founder,
        account_id,
        4_102_444_800,
        now,
    )
    .await
    .unwrap()
    .credential
}

async fn issue_dev_admin(app: &axum::Router, principal_id: PrincipalId) -> String {
    let response = post_json(
        app,
        "/auth/local-proof/sessions",
        None,
        serde_json::json!({
            "principal_id": principal_id,
            "expires_at": 4_102_444_800i64,
            "global_capabilities": ["GlobalAdmin"]
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    json_body(response).await["session_token"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn wait_for_owner_lock_waiters(pool: &sqlx::PgPool, expected: i64) {
    for _ in 0..200 {
        let waiters: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND query LIKE '%FROM platform_principal%'
              AND query LIKE '%FOR UPDATE%'
            "#,
        )
        .fetch_one(pool)
        .await
        .unwrap();
        if waiters >= expected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("expected {expected} canonical owner-lock waiter(s)");
}

async fn wait_for_workos_subject_lock_waiters(pool: &sqlx::PgPool, expected: i64) {
    for _ in 0..200 {
        let waiters: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND query LIKE '%pg_advisory_xact_lock%'
              AND query LIKE '%hashtextextended%'
            "#,
        )
        .fetch_one(pool)
        .await
        .unwrap();
        if waiters >= expected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("expected {expected} WorkOS subject-lock waiter(s)");
}

async fn wait_for_profile_index_writer_lock_waiter(pool: &sqlx::PgPool) {
    for _ in 0..200 {
        let waiting: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND pid <> pg_backend_pid()
                  AND wait_event_type = 'Lock'
                  AND query LIKE '%pg_advisory_xact_lock_shared%'
                  AND query LIKE '%hashtextextended%'
            )
            "#,
        )
        .fetch_one(pool)
        .await
        .unwrap();
        if waiting {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("expected erasure to wait for the profile-index writer lease");
}

async fn wait_for_workos_signing_key_waiters(pool: &sqlx::PgPool, expected: i64) {
    for _ in 0..200 {
        let waiters: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND query LIKE '%pg_advisory_xact_lock%'
              AND query LIKE '%fmarch.workos-signing-key:%'
            "#,
        )
        .fetch_one(pool)
        .await
        .unwrap();
        if waiters >= expected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("expected {expected} WorkOS signing-key waiter(s)");
}

async fn wait_for_workos_retirement_command_waiters(pool: &sqlx::PgPool, expected: i64) {
    for _ in 0..200 {
        let waiters: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND query LIKE '%fmarch.workos-signing-key-retirement-command%'
            "#,
        )
        .fetch_one(pool)
        .await
        .unwrap();
        if waiters >= expected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("expected {expected} WorkOS retirement-command waiter(s)");
}

async fn assert_erased_without_eligible_sessions(pool: &sqlx::PgPool, principal_id: PrincipalId) {
    let (principal_status, subject_state): (String, String) = sqlx::query_as(
        r#"
        SELECT principal.status, subject.lifecycle_state
        FROM platform_principal AS principal
        JOIN privacy_subject AS subject USING (principal_id)
        WHERE principal.principal_id = $1
        "#,
    )
    .bind(principal_id.as_uuid())
    .fetch_one(pool)
    .await
    .unwrap();
    let eligible_sessions: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM auth_session AS session
        JOIN platform_principal AS principal USING (principal_id)
        WHERE session.principal_id = $1
          AND session.revoked_at IS NULL
          AND session.expires_at > $2
          AND session.idle_expires_at > $2
          AND principal.status = 'active'
        "#,
    )
    .bind(principal_id.as_uuid())
    .bind(unix_now_seconds())
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        (
            principal_status.as_str(),
            subject_state.as_str(),
            eligible_sessions
        ),
        ("disabled", "erased", 0)
    );
}

async fn assert_success_without_deadlock(response: axum::response::Response) {
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body = String::from_utf8_lossy(&body);
    assert!(!body.contains("40P01"), "deadlock SQLSTATE leaked: {body}");
    assert!(
        !body.contains("deadlock detected"),
        "deadlock surfaced: {body}"
    );
    assert_eq!(
        status,
        StatusCode::OK,
        "unexpected mutation response: {body}"
    );
}

async fn get_session(app: &axum::Router, token: &str) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/session")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

fn unix_now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock must follow the Unix epoch")
        .as_secs() as i64
}

async fn classic_identity_rows(
    pool: &sqlx::PgPool,
    account_id: &str,
) -> (String, Uuid, String, String) {
    sqlx::query_as::<_, (String, Uuid, String, String)>(
        r#"
        SELECT principal.status, method.method_id, method.kind, method.status
        FROM auth_account AS account
        JOIN authentication_method AS method ON method.method_id = account.method_id
        JOIN platform_principal AS principal
          ON principal.principal_id = account.principal_id
        WHERE account.account_id = $1
        "#,
    )
    .bind(account_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn session_row(pool: &sqlx::PgPool, token: &str) -> (Option<Uuid>, Option<String>) {
    sqlx::query_as::<_, (Option<Uuid>, Option<String>)>(
        "SELECT authenticated_via_method_id, assurance FROM auth_session WHERE token_hash = $1",
    )
    .bind(identity::token::hash_token(token))
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn registration_issues_backend_token_and_method_rows(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));

    let response = register_classic_response(
        &app,
        &pool,
        "new-player@example.test",
        "correct horse battery staple",
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let session_token = body["session_token"].as_str().unwrap().to_string();
    assert!(identity::token::is_app_session_token(
        session_token.as_str()
    ));
    let principal_id = response_principal_id(&body);

    let (principal_status, method_id, method_kind, method_status) =
        classic_identity_rows(&pool, "new-player@example.test").await;
    assert_eq!(principal_status, "active");
    assert_eq!(method_kind, "classic_password");
    assert_eq!(method_status, "active");

    let (session_method, session_assurance) = session_row(&pool, session_token.as_str()).await;
    assert_eq!(session_method, Some(method_id));
    assert_eq!(session_assurance.as_deref(), Some("password"));

    let response = get_session(&app, session_token.as_str()).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["principal_id"], serde_json::json!(principal_id));
    assert!(body.get("session_token").is_none());
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn orphan_accounts_fail_closed_without_creating_identity_rows(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));

    let password = "correct horse battery staple";
    let password_hash = identity::password::hash_password_sync(password).unwrap();
    let orphan_principal_id = principal::PrincipalId::fixture("orphan-player-principal");
    let orphan_method_id = Uuid::new_v4();
    // Bypass the database guards in this isolated test to prove login remains
    // fail-closed against a corrupted/restored account row as well.
    sqlx::query("ALTER TABLE auth_account DROP CONSTRAINT IF EXISTS auth_account_method_id_fkey")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "ALTER TABLE auth_account DROP CONSTRAINT IF EXISTS auth_account_method_identity_fkey",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO auth_account (account_id, principal_id, method_id, password_hash, created_at, disabled_at) VALUES ($1, $2, $3, $4, 1, NULL)",
    )
    .bind("orphan-player@example.test")
    .bind(orphan_principal_id.as_uuid())
    .bind(orphan_method_id)
    .bind(password_hash)
    .execute(&pool)
    .await
    .unwrap();

    let response = post_json(
        &app,
        "/auth/accounts/login",
        None,
        serde_json::json!({
            "account_id": "orphan-player@example.test",
            "password": password
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let (principals, subjects, methods, sessions): (i64, i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
            (SELECT COUNT(*) FROM platform_principal WHERE principal_id = $1),
            (SELECT COUNT(*) FROM privacy_subject WHERE principal_id = $1),
            (SELECT COUNT(*) FROM authentication_method WHERE principal_id = $1),
            (SELECT COUNT(*) FROM auth_session WHERE principal_id = $1)
        "#,
    )
    .bind(orphan_principal_id.as_uuid())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((principals, subjects, methods, sessions), (0, 0, 0, 0));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn local_proof_sessions_and_rotation_issue_backend_tokens(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(
        test_state(pool.clone(), &root).with_local_proof_auth(test_local_proof_verifier()),
    );

    let response = post_json(
        &app,
        "/auth/local-proof/sessions",
        None,
        serde_json::json!({
            "principal_id": principal::PrincipalId::fixture("phase-one-admin"),
            "expires_at": 4_102_444_800i64,
            "global_capabilities": ["GlobalAdmin"]
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let admin_token = body["session_token"].as_str().unwrap().to_string();
    assert!(identity::token::is_app_session_token(admin_token.as_str()));
    let (method, assurance) = session_row(&pool, admin_token.as_str()).await;
    assert_eq!(method, None);
    assert_eq!(assurance.as_deref(), Some("dev"));

    let response = post_json(
        &app,
        "/auth/local-proof/sessions",
        None,
        serde_json::json!({
            "principal_id": principal::PrincipalId::fixture("local-proof-principal"),
            "expires_at": 4_102_444_800i64
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let local_proof_token = body["session_token"].as_str().unwrap().to_string();
    assert!(identity::token::is_app_session_token(
        local_proof_token.as_str()
    ));
    let (method, assurance) = session_row(&pool, local_proof_token.as_str()).await;
    assert_eq!(method, None);
    assert_eq!(assurance.as_deref(), Some("dev"));

    let response = post_json(
        &app,
        "/auth/session-rotations",
        Some(local_proof_token.as_str()),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let rotated_token = body["session_token"].as_str().unwrap().to_string();
    assert!(identity::token::is_app_session_token(
        rotated_token.as_str()
    ));
    assert_ne!(rotated_token, local_proof_token);

    let stale = get_session(&app, local_proof_token.as_str()).await;
    assert_eq!(stale.status(), StatusCode::UNAUTHORIZED);
    let fresh = get_session(&app, rotated_token.as_str()).await;
    assert_eq!(fresh.status(), StatusCode::OK);
}

fn workos_verifier(token: &str, subject: &str) -> StaticAccessTokenVerifier {
    StaticAccessTokenVerifier::new([(
        token.to_string(),
        VerifiedIdentity {
            subject: subject.to_string(),
            session_id: WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap(),
            issued_at: 1,
            expires_at: 4_102_444_800,
            signing_key_id: "test-workos-key".to_string(),
            email: Some(format!("{subject}@example.test")),
        },
    )])
}

async fn get_json(app: &axum::Router, uri: &str, token: &str) -> (StatusCode, serde_json::Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(uri)
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body = if bytes.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null)
    };
    (status, body)
}

fn workos_race_verifier() -> StaticAccessTokenVerifier {
    let session_id = WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap();
    StaticAccessTokenVerifier::new(["workos-race-a", "workos-race-b"].map(|token| {
        (
            token.to_string(),
            VerifiedIdentity {
                subject: "user_workos_race".to_string(),
                session_id: session_id.clone(),
                issued_at: 1,
                expires_at: 4_102_444_800,
                signing_key_id: "test-workos-key".to_string(),
                email: Some("user_workos_race@example.test".to_string()),
            },
        )
    }))
}

fn workos_retirement_verifier() -> StaticAccessTokenVerifier {
    let issued_at = unix_now_seconds();
    StaticAccessTokenVerifier::new([
        (
            "retirement-existing".to_string(),
            VerifiedIdentity {
                subject: "user_retirement_existing".to_string(),
                session_id: WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0C").unwrap(),
                issued_at,
                expires_at: 4_102_444_800,
                signing_key_id: "compromised-workos-key".to_string(),
                email: Some("user_retirement_existing@example.test".to_string()),
            },
        ),
        (
            "retirement-future".to_string(),
            VerifiedIdentity {
                subject: "user_retirement_future".to_string(),
                session_id: WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0D").unwrap(),
                issued_at,
                expires_at: 4_102_444_800,
                signing_key_id: "compromised-workos-key".to_string(),
                email: Some("user_retirement_future@example.test".to_string()),
            },
        ),
    ])
}

struct BlockingWorkosVerifier {
    identity: VerifiedIdentity,
    entered: Arc<Notify>,
    release: Arc<Notify>,
    invocations: Arc<AtomicUsize>,
}

#[async_trait]
impl AccessTokenVerifier for BlockingWorkosVerifier {
    async fn verify(&self, _token: &str) -> Result<VerifiedIdentity, IdentityError> {
        self.invocations.fetch_add(1, Ordering::SeqCst);
        self.entered.notify_one();
        self.release.notified().await;
        Ok(self.identity.clone())
    }
}

async fn seed_workos_race_session(
    app: &axum::Router,
    pool: &sqlx::PgPool,
) -> (PrincipalId, String) {
    let invitation = community_invitation_for(pool, "user_workos_race@example.test").await;
    let response = post_json(
        app,
        "/auth/sessions",
        Some("workos-race-a"),
        serde_json::json!({
            "method": "workos",
            "invitation_credential": invitation
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    (
        response_principal_id(&body),
        body["session_token"].as_str().unwrap().to_string(),
    )
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_verification_source_budget_rejects_before_repeated_crypto(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(
        test_state(pool, &root)
            .with_access_token_verifier(Arc::new(workos_verifier("known-token", "known-user")))
            .with_trusted_auth_attempt_source_header(true)
            .with_workos_verification_source_limit(2),
    );

    let first = post_workos_session_from_source(&app, "unknown-token-a", "198.51.100.10").await;
    assert_eq!(first.status(), StatusCode::UNAUTHORIZED);
    let limited = post_workos_session_from_source(&app, "unknown-token-b", "198.51.100.10").await;
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(
        limited
            .headers()
            .get("retry-after")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .is_some_and(|seconds| seconds > 0),
        "the WorkOS source budget returns an explicit retry window"
    );
    let other_source =
        post_workos_session_from_source(&app, "unknown-token-c", "198.51.100.11").await;
    assert_eq!(other_source.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn stale_workos_source_budget_cleanup_is_bounded_per_request(pool: sqlx::PgPool) {
    sqlx::query(
        r#"
        INSERT INTO auth_registration_attempt (
            scope_hash, window_started_at, attempt_count, blocked_until, updated_at
        )
        SELECT lpad(candidate::text, 64, '0'), 1, 1, NULL, 1
        FROM generate_series(1, 300) AS candidate
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(
        test_state(pool.clone(), &root)
            .with_access_token_verifier(Arc::new(workos_verifier("known-token", "known-user"))),
    );

    let response = post_workos_session_from_source(&app, "unknown-token", "198.51.100.12").await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let stale_remaining: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM auth_registration_attempt WHERE updated_at = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        stale_remaining, 44,
        "one request must delete at most 256 stale source-budget rows"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_verification_concurrency_sheds_overload_before_the_verifier(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let invocations = Arc::new(AtomicUsize::new(0));
    let app = api::router_with_state(
        test_state(pool.clone(), &root)
            .with_workos_verification_limit(1)
            .with_workos_verification_source_limit(3)
            .with_access_token_verifier(Arc::new(BlockingWorkosVerifier {
                identity: VerifiedIdentity {
                    subject: "user_workos_capacity".to_string(),
                    session_id: WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0E")
                        .unwrap(),
                    issued_at: 1,
                    expires_at: 4_102_444_800,
                    signing_key_id: "capacity-workos-key".to_string(),
                    email: Some("user_workos_capacity@example.test".to_string()),
                },
                entered: entered.clone(),
                release: release.clone(),
                invocations: invocations.clone(),
            })),
    );
    let invitation = community_invitation_for(&pool, "user_workos_capacity@example.test").await;

    let first_app = app.clone();
    let first = tokio::spawn(async move {
        post_json(
            &first_app,
            "/auth/sessions",
            Some("first-capacity-token"),
            serde_json::json!({
                "method": "workos",
                "invitation_credential": invitation
            }),
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(5), entered.notified())
        .await
        .expect("first request must enter the verifier");

    for token in ["second-capacity-token", "third-capacity-token"] {
        let overloaded = post_json(
            &app,
            "/auth/sessions",
            Some(token),
            serde_json::json!({ "method": "workos" }),
        )
        .await;
        assert_eq!(overloaded.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
    assert_eq!(invocations.load(Ordering::SeqCst), 1);
    release.notify_one();

    let first = tokio::time::timeout(Duration::from_secs(10), first)
        .await
        .expect("admitted verifier request must complete")
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);

    // The two shed requests never acquired verification authority, so they
    // must not have consumed the source budget. A second admitted request is
    // still below the limit and reaches the verifier.
    release.notify_one();
    let next = post_json(
        &app,
        "/auth/sessions",
        Some("next-capacity-token"),
        serde_json::json!({ "method": "workos" }),
    )
    .await;
    assert_eq!(next.status(), StatusCode::OK);
    assert_eq!(invocations.load(Ordering::SeqCst), 2);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_signing_key_retirement_is_monotonic_and_targets_only_live_sessions_for_that_key(
    pool: sqlx::PgPool,
) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(
        test_state(pool.clone(), &root)
            .with_access_token_verifier(Arc::new(workos_race_verifier())),
    );
    let (_, target_token) = seed_workos_race_session(&app, &pool).await;
    let target_reference = identity::token::hash_token(target_token.as_str());
    let other_reference = identity::token::hash_token(
        "fmss_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    let already_revoked_reference = identity::token::hash_token(
        "fmss_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    let expired_reference = identity::token::hash_token(
        "fmss_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    );
    let idle_expired_reference = identity::token::hash_token(
        "fmss_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    );
    let retirement_now = unix_now_seconds();
    sqlx::query(
        r#"
        INSERT INTO auth_session (
            token_hash, principal_id, created_at, expires_at, revoked_at,
            authenticated_via_method_id, idle_expires_at,
            assurance, authenticated_at, workos_session_id,
            local_proof_instance_id, workos_signing_key_id
        )
        SELECT $1, principal_id, created_at, expires_at, NULL,
               authenticated_via_method_id, idle_expires_at,
               assurance, authenticated_at, workos_session_id,
               NULL, 'other-workos-key'
        FROM auth_session
        WHERE token_hash = $2
        UNION ALL
        SELECT $3, principal_id, created_at, expires_at, 1,
               authenticated_via_method_id, idle_expires_at,
               assurance, authenticated_at, workos_session_id,
               NULL, workos_signing_key_id
        FROM auth_session
        WHERE token_hash = $2
        UNION ALL
        SELECT $4, principal_id, 1, 10, NULL,
               authenticated_via_method_id, 10,
               assurance, 1, workos_session_id,
               NULL, workos_signing_key_id
        FROM auth_session
        WHERE token_hash = $2
        UNION ALL
        SELECT $5, principal_id, 1, $6, NULL,
               authenticated_via_method_id, 10,
               assurance, 1, workos_session_id,
               NULL, workos_signing_key_id
        FROM auth_session
        WHERE token_hash = $2
        "#,
    )
    .bind(&other_reference)
    .bind(&target_reference)
    .bind(&already_revoked_reference)
    .bind(&expired_reference)
    .bind(&idle_expired_reference)
    .bind(retirement_now + 100)
    .execute(&pool)
    .await
    .unwrap();

    let actor = PrincipalId::random();
    let mut tx = pool.begin().await.unwrap();
    identity::methods::ensure_principal(&mut tx, &actor, &["GlobalAdmin".to_string()], 1)
        .await
        .unwrap();
    let signing_key_id = identity::WorkosSigningKeyId::parse("test-workos-key").unwrap();
    let retired = identity::retire_workos_signing_key(
        &mut tx,
        &signing_key_id,
        &actor,
        "provider incident",
        retirement_now,
    )
    .await
    .unwrap();
    assert!(retired.newly_retired);
    assert_eq!(retired.revoked_session_count, 1);
    tx.commit().await.unwrap();

    let target_revoked_at: Option<i64> =
        sqlx::query_scalar("SELECT revoked_at FROM auth_session WHERE token_hash = $1")
            .bind(&target_reference)
            .fetch_one(&pool)
            .await
            .unwrap();
    let other_revoked_at: Option<i64> =
        sqlx::query_scalar("SELECT revoked_at FROM auth_session WHERE token_hash = $1")
            .bind(&other_reference)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(target_revoked_at, Some(retirement_now));
    assert_eq!(other_revoked_at, None);
    let historical_revocation_state = sqlx::query_as::<_, (Option<i64>, Option<i64>, Option<i64>)>(
        r#"
        SELECT
            (SELECT revoked_at FROM auth_session WHERE token_hash = $1),
            (SELECT revoked_at FROM auth_session WHERE token_hash = $2),
            (SELECT revoked_at FROM auth_session WHERE token_hash = $3)
        "#,
    )
    .bind(&already_revoked_reference)
    .bind(&expired_reference)
    .bind(&idle_expired_reference)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        historical_revocation_state,
        (Some(1), None, None),
        "retirement must not lock or rewrite already-revoked, absolute-expired, or idle-expired history"
    );

    let mut tx = pool.begin().await.unwrap();
    let repeated = identity::retire_workos_signing_key(
        &mut tx,
        &signing_key_id,
        &actor,
        "a replay cannot rewrite the original reason",
        retirement_now + 1,
    )
    .await
    .unwrap();
    assert!(!repeated.newly_retired);
    assert_eq!(repeated.retired_at, retirement_now);
    assert_eq!(repeated.reason, "provider incident");
    assert_eq!(repeated.revoked_session_count, 0);
    tx.commit().await.unwrap();

    let retirement_audits: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM identity_lifecycle_audit WHERE event_kind = 'workos_signing_key_retired'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(retirement_audits, 1);

    let malformed = identity::WorkosSigningKeyId::parse(" contains-whitespace ");
    assert!(matches!(
        malformed,
        Err(identity::IdentityFlowError::Invalid(_))
    ));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn global_admin_http_retirement_revokes_and_permanently_denies_a_workos_key(
    pool: sqlx::PgPool,
) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(
        test_state(pool.clone(), &root)
            .with_local_proof_auth(test_local_proof_verifier())
            .with_access_token_verifier(Arc::new(workos_retirement_verifier())),
    );
    let (admin, admin_token) = register_classic_account(
        &app,
        &pool,
        "retirement-admin@example.test",
        "correct horse battery staple",
    )
    .await;
    sqlx::query(
        "UPDATE platform_principal SET global_capabilities = ARRAY['GlobalAdmin'] WHERE principal_id = $1",
    )
    .bind(admin.as_uuid())
    .execute(&pool)
    .await
    .unwrap();

    let invitation = community_invitation_for(&pool, "user_retirement_existing@example.test").await;
    let existing = post_json(
        &app,
        "/auth/sessions",
        Some("retirement-existing"),
        serde_json::json!({
            "method": "workos",
            "invitation_credential": invitation
        }),
    )
    .await;
    assert_eq!(existing.status(), StatusCode::OK);
    let existing = json_body(existing).await;
    let existing_token = existing["session_token"].as_str().unwrap().to_string();

    let non_admin = post_json(
        &app,
        "/auth/workos-signing-key-retirements",
        Some(existing_token.as_str()),
        serde_json::json!({
            "signing_key_id": "compromised-workos-key",
            "reason": "provider incident"
        }),
    )
    .await;
    assert_eq!(non_admin.status(), StatusCode::FORBIDDEN);

    let retired = post_json(
        &app,
        "/auth/workos-signing-key-retirements",
        Some(admin_token.as_str()),
        serde_json::json!({
            "signing_key_id": "compromised-workos-key",
            "reason": "provider incident"
        }),
    )
    .await;
    assert_eq!(retired.status(), StatusCode::OK);
    let retired = json_body(retired).await;
    assert_eq!(retired["status"], "retired");
    assert_eq!(retired["newly_retired"], true);
    assert_eq!(retired["retired_by_principal_id"], admin.to_string());
    assert_eq!(retired["revoked_session_count"], 1);
    assert_eq!(
        get_session(&app, existing_token.as_str()).await.status(),
        StatusCode::UNAUTHORIZED
    );

    let repeated = post_json(
        &app,
        "/auth/workos-signing-key-retirements",
        Some(admin_token.as_str()),
        serde_json::json!({
            "signing_key_id": "compromised-workos-key",
            "reason": "a replay cannot rewrite evidence"
        }),
    )
    .await;
    assert_eq!(repeated.status(), StatusCode::OK);
    let repeated = json_body(repeated).await;
    assert_eq!(repeated["newly_retired"], false);
    assert_eq!(repeated["reason"], "provider incident");
    assert_eq!(repeated["revoked_session_count"], 0);
    assert_eq!(repeated["retired_at"], retired["retired_at"]);

    let future_invitation =
        community_invitation_for(&pool, "user_retirement_future@example.test").await;
    let denied = post_json(
        &app,
        "/auth/sessions",
        Some("retirement-future"),
        serde_json::json!({
            "method": "workos",
            "invitation_credential": future_invitation
        }),
    )
    .await;
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
    let future_bindings: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM external_identity WHERE subject = 'user_retirement_future'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        future_bindings, 0,
        "retired-key identity mutation rolled back"
    );

    let denied_link = post_json(
        &app,
        "/auth/account/methods/workos",
        Some(admin_token.as_str()),
        serde_json::json!({ "provider_assertion": "retirement-future" }),
    )
    .await;
    assert_eq!(denied_link.status(), StatusCode::UNAUTHORIZED);
    let future_bindings_after_link: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM external_identity WHERE subject = 'user_retirement_future'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        future_bindings_after_link, 0,
        "retired-key account linking rolled back"
    );

    let dev_admin = issue_dev_admin(&app, PrincipalId::random()).await;
    let methodless = post_json(
        &app,
        "/auth/workos-signing-key-retirements",
        Some(dev_admin.as_str()),
        serde_json::json!({
            "signing_key_id": "another-workos-key",
            "reason": "must use a production authentication method"
        }),
    )
    .await;
    assert_eq!(methodless.status(), StatusCode::UNAUTHORIZED);

    let audit: (Uuid, String) = sqlx::query_as(
        r#"
        SELECT actor_principal_id, metadata::TEXT
        FROM identity_lifecycle_audit
        WHERE event_kind = 'workos_signing_key_retired'
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit.0, admin.as_uuid());
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&audit.1).unwrap()["workos_signing_key_id"],
        "compromised-workos-key"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn concurrent_global_admin_retirements_serialize_before_session_locks(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(
        test_state(pool.clone(), &root)
            .with_access_token_verifier(Arc::new(workos_race_verifier())),
    );
    let (first_admin, first_token) = register_classic_account(
        &app,
        &pool,
        "retirement-concurrent-a@example.test",
        "correct horse battery staple",
    )
    .await;
    let (second_admin, second_token) = register_classic_account(
        &app,
        &pool,
        "retirement-concurrent-b@example.test",
        "correct horse battery staple",
    )
    .await;
    sqlx::query(
        r#"
        UPDATE platform_principal
        SET global_capabilities = ARRAY['GlobalAdmin']
        WHERE principal_id IN ($1, $2)
        "#,
    )
    .bind(first_admin.as_uuid())
    .bind(second_admin.as_uuid())
    .execute(&pool)
    .await
    .unwrap();
    let (_, target_token) = seed_workos_race_session(&app, &pool).await;

    let mut command_gate = pool.begin().await.unwrap();
    identity::session::lock_workos_retirement_command(&mut command_gate)
        .await
        .unwrap();

    let first_app = app.clone();
    let first = tokio::spawn(async move {
        post_json(
            &first_app,
            "/auth/workos-signing-key-retirements",
            Some(first_token.as_str()),
            serde_json::json!({
                "signing_key_id": "test-workos-key",
                "reason": "concurrent retirement a"
            }),
        )
        .await
    });
    let second_app = app.clone();
    let second = tokio::spawn(async move {
        post_json(
            &second_app,
            "/auth/workos-signing-key-retirements",
            Some(second_token.as_str()),
            serde_json::json!({
                "signing_key_id": "test-workos-key",
                "reason": "concurrent retirement b"
            }),
        )
        .await
    });
    wait_for_workos_retirement_command_waiters(&pool, 2).await;
    command_gate.commit().await.unwrap();

    let (first, second) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(first, second)
    })
    .await
    .expect("concurrent retirement commands must not deadlock");
    let first = first.unwrap();
    let second = second.unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    assert_eq!(second.status(), StatusCode::OK);
    let first = json_body(first).await;
    let second = json_body(second).await;
    let mut newly_retired = [
        first["newly_retired"].as_bool().unwrap(),
        second["newly_retired"].as_bool().unwrap(),
    ];
    newly_retired.sort_unstable();
    assert_eq!(newly_retired, [false, true]);
    assert_eq!(
        first["revoked_session_count"].as_u64().unwrap()
            + second["revoked_session_count"].as_u64().unwrap(),
        1
    );
    assert_eq!(
        get_session(&app, target_token.as_str()).await.status(),
        StatusCode::UNAUTHORIZED
    );
    let retirement_audits: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM identity_lifecycle_audit WHERE event_kind = 'workos_signing_key_retired'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(retirement_audits, 1);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn concurrent_workos_issuance_commits_before_retirement_and_is_still_revoked(
    pool: sqlx::PgPool,
) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(
        test_state(pool.clone(), &root)
            .with_access_token_verifier(Arc::new(workos_retirement_verifier())),
    );
    let (admin, admin_token) = register_classic_account(
        &app,
        &pool,
        "retirement-race-admin@example.test",
        "correct horse battery staple",
    )
    .await;
    sqlx::query(
        "UPDATE platform_principal SET global_capabilities = ARRAY['GlobalAdmin'] WHERE principal_id = $1",
    )
    .bind(admin.as_uuid())
    .execute(&pool)
    .await
    .unwrap();
    let invitation = community_invitation_for(&pool, "user_retirement_future@example.test").await;

    let mut gate = pool.begin().await.unwrap();
    sqlx::query(
        r#"
        SELECT pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(
                'fmarch.workos-signing-key:' || 'compromised-workos-key', 0
            )
        )
        "#,
    )
    .execute(&mut *gate)
    .await
    .unwrap();

    let issuance_app = app.clone();
    let issuance = tokio::spawn(async move {
        post_json(
            &issuance_app,
            "/auth/sessions",
            Some("retirement-future"),
            serde_json::json!({
                "method": "workos",
                "invitation_credential": invitation
            }),
        )
        .await
    });
    wait_for_workos_signing_key_waiters(&pool, 1).await;

    let retirement_app = app.clone();
    let retirement = tokio::spawn(async move {
        post_json(
            &retirement_app,
            "/auth/workos-signing-key-retirements",
            Some(admin_token.as_str()),
            serde_json::json!({
                "signing_key_id": "compromised-workos-key",
                "reason": "concurrent retirement proof"
            }),
        )
        .await
    });
    wait_for_workos_signing_key_waiters(&pool, 2).await;
    gate.commit().await.unwrap();

    let (issuance, retirement) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(issuance, retirement)
    })
    .await
    .expect("issuance and retirement must serialize without deadlock");
    let issuance = issuance.unwrap();
    let retirement = retirement.unwrap();
    assert_eq!(issuance.status(), StatusCode::OK);
    let issued_token = json_body(issuance).await["session_token"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(retirement.status(), StatusCode::OK);
    assert_eq!(json_body(retirement).await["revoked_session_count"], 1);
    assert_eq!(
        get_session(&app, issued_token.as_str()).await.status(),
        StatusCode::UNAUTHORIZED,
        "no bearer admitted before retirement may survive the serialized command"
    );
}

async fn hold_identity_owner(
    pool: &sqlx::PgPool,
    principal_id: PrincipalId,
) -> sqlx::Transaction<'static, sqlx::Postgres> {
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("SELECT principal_id FROM platform_principal WHERE principal_id = $1 FOR UPDATE")
        .bind(principal_id.as_uuid())
        .execute(&mut *gate)
        .await
        .unwrap();
    gate
}

async fn hold_workos_subject(
    pool: &sqlx::PgPool,
    subject: &str,
) -> sqlx::Transaction<'static, sqlx::Postgres> {
    let mut gate = pool.begin().await.unwrap();
    identity::workos::lock_subject_advisory(&mut gate, subject)
        .await
        .unwrap();
    gate
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_link_closes_the_provider_session_before_a_queued_login(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(
        test_state(pool.clone(), &root)
            .with_access_token_verifier(Arc::new(workos_race_verifier())),
    );
    let (principal, local_token) = register_classic_account(
        &app,
        &pool,
        "workos-lock-order@example.test",
        "correct horse battery staple",
    )
    .await;
    let gate = hold_workos_subject(&pool, "user_workos_race").await;

    let link_app = app.clone();
    let link = tokio::spawn(async move {
        post_json(
            &link_app,
            "/auth/account/methods/workos",
            Some(&local_token),
            serde_json::json!({ "provider_assertion": "workos-race-a" }),
        )
        .await
    });
    wait_for_workos_subject_lock_waiters(&pool, 1).await;

    let login_app = app.clone();
    let login = tokio::spawn(async move {
        post_json(
            &login_app,
            "/auth/sessions",
            Some("workos-race-b"),
            serde_json::json!({ "method": "workos" }),
        )
        .await
    });
    wait_for_workos_subject_lock_waiters(&pool, 2).await;
    gate.commit().await.unwrap();

    let (link, login) =
        tokio::time::timeout(Duration::from_secs(20), async { tokio::join!(link, login) })
            .await
            .expect("link then login must serialize without a lock-order deadlock");
    let link = link.unwrap();
    let login = login.unwrap();
    assert_eq!(link.status(), StatusCode::OK);
    let link = json_body(link).await;
    assert_eq!(
        link["provider_logout_url"].as_str(),
        Some(
            "https://api.workos.com/user_management/sessions/logout?session_id=session_01HQAG1HENBZMAZD82YRXDFC0B"
        )
    );
    assert_workos_provider_logout_recovery(login, "session_01HQAG1HENBZMAZD82YRXDFC0B").await;
    let consumed_assertions: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM workos_session_exchange WHERE provider_session_id = 'session_01HQAG1HENBZMAZD82YRXDFC0B'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(consumed_assertions, 1);
    let linked_principal: Uuid = sqlx::query_scalar(
        "SELECT principal_id FROM external_identity WHERE provider = 'workos' AND subject = 'user_workos_race'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(linked_principal, principal.as_uuid());
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn concurrent_exact_workos_link_retries_share_one_committed_ceremony(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(
        test_state(pool.clone(), &root)
            .with_access_token_verifier(Arc::new(workos_race_verifier())),
    );
    let (principal, local_token) = register_classic_account(
        &app,
        &pool,
        "workos-duplicate-link@example.test",
        "correct horse battery staple",
    )
    .await;
    let gate = hold_workos_subject(&pool, "user_workos_race").await;

    let first_app = app.clone();
    let first_local_token = local_token.clone();
    let first = tokio::spawn(async move {
        post_json(
            &first_app,
            "/auth/account/methods/workos",
            Some(&first_local_token),
            serde_json::json!({ "provider_assertion": "workos-race-a" }),
        )
        .await
    });
    wait_for_workos_subject_lock_waiters(&pool, 1).await;
    let second_app = app.clone();
    let second_local_token = local_token.clone();
    let second = tokio::spawn(async move {
        post_json(
            &second_app,
            "/auth/account/methods/workos",
            Some(&second_local_token),
            serde_json::json!({ "provider_assertion": "workos-race-a" }),
        )
        .await
    });
    wait_for_workos_subject_lock_waiters(&pool, 2).await;
    gate.commit().await.unwrap();

    let (first, second) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(first, second)
    })
    .await
    .expect("exact duplicate links must serialize without deadlock");
    let first = first.unwrap();
    let second = second.unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    assert_eq!(second.status(), StatusCode::OK);
    assert_eq!(json_body(first).await, json_body(second).await);

    let (provider_rows, assertion_rows, attached_audits): (i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT (SELECT COUNT(*) FROM workos_provider_session),
               (SELECT COUNT(*) FROM workos_session_exchange),
               (SELECT COUNT(*)
                FROM identity_lifecycle_audit
                WHERE event_kind = 'method_attached'
                  AND principal_id = $1)
        "#,
    )
    .bind(principal.as_uuid())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((provider_rows, assertion_rows, attached_audits), (1, 1, 1));
    let linking_session_hash: String =
        sqlx::query_scalar("SELECT linking_session_hash FROM workos_session_exchange")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        linking_session_hash,
        identity::token::hash_token(&local_token)
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_link_revalidates_the_local_session_after_queued_logout(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(
        test_state(pool.clone(), &root)
            .with_access_token_verifier(Arc::new(workos_race_verifier())),
    );
    let (principal, local_token) = register_classic_account(
        &app,
        &pool,
        "workos-stale-link@example.test",
        "correct horse battery staple",
    )
    .await;
    let gate = hold_identity_owner(&pool, principal).await;

    let logout_app = app.clone();
    let logout_token = local_token.clone();
    let logout = tokio::spawn(async move {
        post_json(
            &logout_app,
            "/auth/session-logout",
            Some(&logout_token),
            serde_json::json!({}),
        )
        .await
    });
    wait_for_owner_lock_waiters(&pool, 1).await;

    let link_app = app.clone();
    let link = tokio::spawn(async move {
        post_json(
            &link_app,
            "/auth/account/methods/workos",
            Some(&local_token),
            serde_json::json!({ "provider_assertion": "workos-race-a" }),
        )
        .await
    });
    wait_for_owner_lock_waiters(&pool, 2).await;
    gate.commit().await.unwrap();

    let (logout, link) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(logout, link)
    })
    .await
    .expect("logout then link must serialize without a lock-order deadlock");
    assert_eq!(logout.unwrap().status(), StatusCode::OK);
    assert_eq!(link.unwrap().status(), StatusCode::UNAUTHORIZED);
    let linked_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM external_identity WHERE provider = 'workos'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(linked_rows, 0);
    let provider_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workos_provider_session")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(provider_rows, 0);
    let consumed_assertions: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM workos_session_exchange")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(consumed_assertions, 0);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_exchange_queued_before_logout_is_revoked_by_the_following_tombstone(
    pool: sqlx::PgPool,
) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(
        test_state(pool.clone(), &root)
            .with_access_token_verifier(Arc::new(workos_race_verifier())),
    );
    let (principal, first_local_token) = seed_workos_race_session(&app, &pool).await;
    let gate = hold_identity_owner(&pool, principal).await;

    let exchange_app = app.clone();
    let exchange = tokio::spawn(async move {
        post_json(
            &exchange_app,
            "/auth/sessions",
            Some("workos-race-b"),
            serde_json::json!({ "method": "workos" }),
        )
        .await
    });
    wait_for_owner_lock_waiters(&pool, 1).await;
    let logout_app = app.clone();
    let logout = tokio::spawn(async move {
        post_json(
            &logout_app,
            "/auth/session-logout",
            Some(&first_local_token),
            serde_json::json!({}),
        )
        .await
    });
    wait_for_owner_lock_waiters(&pool, 2).await;
    gate.commit().await.unwrap();

    let (exchange, logout) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(exchange, logout)
    })
    .await
    .expect("exchange then logout must serialize without deadlock");
    let exchange = exchange.unwrap();
    let logout = logout.unwrap();
    assert_eq!(exchange.status(), StatusCode::OK);
    let second_local_token = json_body(exchange).await["session_token"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(logout.status(), StatusCode::OK);
    assert_eq!(
        get_json(&app, "/auth/session", &second_local_token).await.0,
        StatusCode::UNAUTHORIZED
    );
    let provider_status: String = sqlx::query_scalar(
        "SELECT status FROM workos_provider_session WHERE provider_session_id = 'session_01HQAG1HENBZMAZD82YRXDFC0B'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(provider_status, "logged_out");
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_logout_queued_before_exchange_tombstones_the_unused_assertion(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(
        test_state(pool.clone(), &root)
            .with_access_token_verifier(Arc::new(workos_race_verifier())),
    );
    let (principal, first_local_token) = seed_workos_race_session(&app, &pool).await;
    let gate = hold_identity_owner(&pool, principal).await;

    let logout_app = app.clone();
    let logout = tokio::spawn(async move {
        post_json(
            &logout_app,
            "/auth/session-logout",
            Some(&first_local_token),
            serde_json::json!({}),
        )
        .await
    });
    wait_for_owner_lock_waiters(&pool, 1).await;
    let exchange_app = app.clone();
    let exchange = tokio::spawn(async move {
        post_json(
            &exchange_app,
            "/auth/sessions",
            Some("workos-race-b"),
            serde_json::json!({ "method": "workos" }),
        )
        .await
    });
    wait_for_owner_lock_waiters(&pool, 2).await;
    gate.commit().await.unwrap();

    let (logout, exchange) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(logout, exchange)
    })
    .await
    .expect("logout then exchange must serialize without deadlock");
    assert_eq!(logout.unwrap().status(), StatusCode::OK);
    assert_workos_provider_logout_recovery(exchange.unwrap(), "session_01HQAG1HENBZMAZD82YRXDFC0B")
        .await;
    let local_sessions: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM auth_session WHERE principal_id = $1")
            .bind(principal.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(local_sessions, 1, "the unused assertion created no session");
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn one_principal_survives_workos_to_classic_conversion(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let state = test_state(pool.clone(), &root)
        .with_access_token_verifier(Arc::new(workos_verifier("workos-token", "user_convert")))
        .with_local_proof_auth(test_local_proof_verifier());
    let app = api::router_with_state(state);

    let response = post_json(
        &app,
        "/auth/local-proof/sessions",
        None,
        serde_json::json!({
            "principal_id": principal::PrincipalId::fixture("method-lifecycle-admin"),
            "expires_at": 4_102_444_800i64,
            "global_capabilities": ["GlobalAdmin"]
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let admin_session = json_body(response).await["session_token"]
        .as_str()
        .unwrap()
        .to_string();

    // Sign in with WorkOS: one exchange, one backend session.
    let invitation = community_invitation_for(&pool, "user_convert@example.test").await;
    let response = post_json(
        &app,
        "/auth/sessions",
        Some("workos-token"),
        serde_json::json!({
            "method": "workos",
            "invitation_credential": invitation
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let workos_session = body["session_token"].as_str().unwrap().to_string();
    let principal_id = response_principal_id(&body);

    // Grant a capability to the principal so capability continuity is
    // observable across methods.
    sqlx::query(
        "UPDATE platform_principal SET global_capabilities = ARRAY['GlobalMod'] WHERE principal_id = $1",
    )
    .bind(principal_id.as_uuid())
    .execute(&pool)
    .await
    .unwrap();
    let (status, session_a) = get_json(&app, "/auth/session", workos_session.as_str()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(session_a["principal_id"], serde_json::json!(principal_id));

    // Add a classic sign-in method to the same principal (recent session).
    let response = post_json(
        &app,
        "/auth/account/methods/classic",
        Some(workos_session.as_str()),
        serde_json::json!({
            "login_name": "converted@example.test",
            "password": "correct horse battery staple"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let added = json_body(response).await;
    assert_eq!(added["principal_id"], serde_json::json!(principal_id));
    let recovery_codes: Vec<String> = added["recovery_codes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|code| code.as_str().unwrap().to_string())
        .collect();
    assert_eq!(recovery_codes.len(), 3);
    let mut classic_session = added["session_token"].as_str().unwrap().to_string();
    assert!(identity::token::is_app_session_token(&classic_session));
    let (classic_session_method, classic_session_assurance) =
        session_row(&pool, &classic_session).await;
    assert_eq!(classic_session_assurance.as_deref(), Some("password"));

    // A second classic method on the same principal is rejected.
    let response = post_json(
        &app,
        "/auth/account/methods/classic",
        Some(workos_session.as_str()),
        serde_json::json!({
            "login_name": "second@example.test",
            "password": "correct horse battery staple"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);

    // The conversion response itself switches to a Classic-authenticated
    // session: same principal and current durable capabilities.
    let (status, session_b) = get_json(&app, "/auth/session", classic_session.as_str()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(session_a["principal_id"], session_b["principal_id"]);
    assert_eq!(session_a["capabilities"], session_b["capabilities"]);

    // Enumerate methods, then disconnect WorkOS under the classic session.
    let (status, methods) = get_json(&app, "/auth/account/methods", classic_session.as_str()).await;
    assert_eq!(status, StatusCode::OK);
    let methods = methods["methods"].as_array().unwrap().clone();
    assert_eq!(methods.len(), 2);
    let workos_method_id = methods
        .iter()
        .find(|method| method["kind"] == "workos")
        .unwrap()["method_id"]
        .as_str()
        .unwrap()
        .to_string();
    let classic_method_id = methods
        .iter()
        .find(|method| method["kind"] == "classic_password")
        .unwrap()["method_id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        classic_session_method.map(|id| id.to_string()),
        Some(classic_method_id.clone())
    );

    // A live sibling method cannot convert a durable disable into a
    // self-service password reset. Only the administrator-owned enable
    // operation may restore this classic method.
    let response = post_json(
        &app,
        "/auth/accounts/disable",
        Some(admin_session.as_str()),
        serde_json::json!({
            "account_id": "converted@example.test",
            "expected_disabled": false
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        get_json(&app, "/auth/session", &classic_session).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        get_json(&app, "/auth/session", &workos_session).await.0,
        StatusCode::OK
    );
    let response = post_json(
        &app,
        "/auth/account/methods/classic",
        Some(&workos_session),
        serde_json::json!({
            "login_name": "converted@example.test",
            "password": "replacement correct horse battery"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let (account_disabled_at, method_status): (Option<i64>, String) = sqlx::query_as(
        r#"
        SELECT account.disabled_at, method.status
        FROM auth_account AS account
        JOIN authentication_method AS method ON method.method_id = account.method_id
        WHERE account.account_id = 'converted@example.test'
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(account_disabled_at.is_some());
    assert_eq!(method_status, "disabled");

    let response = post_json(
        &app,
        "/auth/accounts/enable",
        Some(admin_session.as_str()),
        serde_json::json!({
            "account_id": "converted@example.test",
            "expected_disabled": true
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);

    // The rejected self-reactivation did not replace the classic credential.
    let response = post_json(
        &app,
        "/auth/accounts/login",
        None,
        serde_json::json!({
            "account_id": "converted@example.test",
            "password": "replacement correct horse battery"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let response = post_json(
        &app,
        "/auth/accounts/login",
        None,
        serde_json::json!({
            "account_id": "converted@example.test",
            "password": "correct horse battery staple"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    classic_session = json_body(response).await["session_token"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        session_row(&pool, classic_session.as_str())
            .await
            .0
            .map(|method_id| method_id.to_string()),
        Some(classic_method_id.clone())
    );

    let response = post_json(
        &app,
        format!("/auth/account/methods/{workos_method_id}/disable").as_str(),
        Some(classic_session.as_str()),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);

    // Sessions authenticated through the removed method are dead; the classic
    // session and the principal's capabilities are untouched.
    let (status, _) = get_json(&app, "/auth/session", workos_session.as_str()).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, session_after) = get_json(&app, "/auth/session", classic_session.as_str()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(session_after["capabilities"], session_a["capabilities"]);

    // The last active method cannot be removed.
    let response = post_json(
        &app,
        format!("/auth/account/methods/{classic_method_id}/disable").as_str(),
        Some(classic_session.as_str()),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);

    // The display-once recovery codes are real classic recovery credentials.
    let response = post_json(
        &app,
        "/auth/accounts/recoveries",
        None,
        serde_json::json!({
            "account_id": "converted@example.test",
            "recovery_token": recovery_codes[0],
            "new_password": "an even longer replacement password"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let recovered = json_body(response).await;
    assert!(recovered["session_token"]
        .as_str()
        .unwrap()
        .starts_with("fmss_"));

    let audit_kinds = sqlx::query_scalar::<_, String>(
        "SELECT event_kind FROM identity_lifecycle_audit WHERE principal_id = $1 ORDER BY id",
    )
    .bind(principal_id.as_uuid())
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(audit_kinds.iter().any(|kind| kind == "method_added"));
    assert!(audit_kinds.iter().any(|kind| kind == "method_disabled"));
    assert!(audit_kinds.iter().any(|kind| kind == "account_disabled"));
    assert!(audit_kinds.iter().any(|kind| kind == "account_enabled"));
    assert!(audit_kinds.iter().any(|kind| kind == "session_created"));
    assert!(!audit_kinds.iter().any(|kind| kind == "method_reactivated"));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn rotation_cannot_refresh_recent_authentication(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let state = test_state(pool.clone(), &root)
        .with_access_token_verifier(Arc::new(workos_verifier("workos-old", "user_old")));
    let app = api::router_with_state(state);

    let invitation = community_invitation_for(&pool, "user_old@example.test").await;
    let response = post_json(
        &app,
        "/auth/sessions",
        Some("workos-old"),
        serde_json::json!({
            "method": "workos",
            "invitation_credential": invitation
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let old_token = json_body(response).await["session_token"]
        .as_str()
        .unwrap()
        .to_string();
    sqlx::query(
        "UPDATE auth_session SET created_at = created_at - 10000, authenticated_at = authenticated_at - 10000 WHERE token_hash = $1",
    )
    .bind(identity::token::hash_token(&old_token))
    .execute(&pool)
    .await
    .unwrap();

    let response = post_json(
        &app,
        "/auth/session-rotations",
        Some(&old_token),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let rotated_token = json_body(response).await["session_token"]
        .as_str()
        .unwrap()
        .to_string();

    let response = post_json(
        &app,
        "/auth/account/methods/classic",
        Some(&rotated_token),
        serde_json::json!({
            "login_name": "too-late@example.test",
            "password": "correct horse battery staple"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let (authenticated_at, created_at) = sqlx::query_as::<_, (i64, i64)>(
        "SELECT authenticated_at, created_at FROM auth_session WHERE token_hash = $1",
    )
    .bind(identity::token::hash_token(&rotated_token))
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(created_at > authenticated_at);
    let rotation_signing_key_id: Option<String> = sqlx::query_scalar(
        r#"
        SELECT metadata->>'workos_signing_key_id'
        FROM identity_lifecycle_audit
        WHERE event_kind = 'session_rotated'
          AND related_token_hash = $1
        "#,
    )
    .bind(identity::token::hash_token(&rotated_token))
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rotation_signing_key_id.as_deref(), Some("test-workos-key"));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn idle_expired_sessions_cannot_rotate_or_choose_legacy_bearers(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let password = "correct horse battery staple";

    let response =
        register_classic_response(&app, &pool, "idle-expired@example.test", password).await;
    assert_eq!(response.status(), StatusCode::OK);
    let expired_token = json_body(response).await["session_token"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(identity::token::is_app_session_token(&expired_token));

    sqlx::query(
        r#"
        UPDATE auth_session
        SET created_at = 1,
            authenticated_at = 1,
            idle_expires_at = 2
        WHERE token_hash = $1
        "#,
    )
    .bind(identity::token::hash_token(&expired_token))
    .execute(&pool)
    .await
    .unwrap();
    let sessions_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auth_session")
        .fetch_one(&pool)
        .await
        .unwrap();
    let audits_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM identity_lifecycle_audit")
        .fetch_one(&pool)
        .await
        .unwrap();

    let expired_rotation = post_json(
        &app,
        "/auth/session-rotations",
        Some(&expired_token),
        serde_json::json!({}),
    )
    .await;
    let expired_rotation_status = expired_rotation.status();
    let sessions_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auth_session")
        .fetch_one(&pool)
        .await
        .unwrap();
    let audits_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM identity_lifecycle_audit")
        .fetch_one(&pool)
        .await
        .unwrap();

    let response = post_json(
        &app,
        "/auth/accounts/login",
        None,
        serde_json::json!({
            "account_id": "idle-expired@example.test",
            "password": password
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let fresh_token = json_body(response).await["session_token"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(identity::token::is_app_session_token(&fresh_token));

    let client_selected_token = "client-selected-legacy-bearer";
    assert!(!identity::token::is_app_session_token(
        client_selected_token
    ));
    let selected_rotation = post_json(
        &app,
        "/auth/session-rotations",
        Some(&fresh_token),
        serde_json::json!({ "session_token": client_selected_token }),
    )
    .await;
    let selected_rotation_status = selected_rotation.status();
    let selected_token_exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM auth_session WHERE token_hash = $1)")
            .bind(identity::token::hash_token(client_selected_token))
            .fetch_one(&pool)
            .await
            .unwrap();
    let selected_token_status = get_session(&app, client_selected_token).await.status();
    let canonical_rotation = post_json(
        &app,
        "/auth/session-rotations",
        Some(&fresh_token),
        serde_json::json!({}),
    )
    .await;
    let canonical_rotation_status = canonical_rotation.status();
    let canonical_rotation_body = json_body(canonical_rotation).await;
    let returned_token = canonical_rotation_body["session_token"].as_str();

    assert_eq!(
        (
            expired_rotation_status,
            sessions_after - sessions_before,
            audits_after - audits_before,
            selected_rotation_status,
            selected_token_exists,
            selected_token_status,
            canonical_rotation_status,
            returned_token.is_some_and(identity::token::is_app_session_token),
            returned_token == Some(client_selected_token),
        ),
        (
            StatusCode::UNAUTHORIZED,
            0,
            0,
            StatusCode::UNPROCESSABLE_ENTITY,
            false,
            StatusCode::UNAUTHORIZED,
            StatusCode::OK,
            true,
            false,
        )
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn idle_session_cannot_resurrect_after_expiring_while_rotation_waits_for_its_lock(
    pool: sqlx::PgPool,
) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));

    let response = register_classic_response(
        &app,
        &pool,
        "lock-expired@example.test",
        "correct horse battery staple",
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let token = json_body(response).await["session_token"]
        .as_str()
        .unwrap()
        .to_string();
    let token_hash = identity::token::hash_token(token.as_str());
    let idle_deadline = unix_now_seconds() + 2;
    sqlx::query("UPDATE auth_session SET idle_expires_at = $1 WHERE token_hash = $2")
        .bind(idle_deadline)
        .bind(token_hash.as_str())
        .execute(&pool)
        .await
        .unwrap();

    let mut lock_holder = pool.begin().await.unwrap();
    sqlx::query_scalar::<_, String>(
        "SELECT token_hash FROM auth_session WHERE token_hash = $1 FOR UPDATE",
    )
    .bind(token_hash.as_str())
    .fetch_one(&mut *lock_holder)
    .await
    .unwrap();

    let rotation_pool = pool.clone();
    let rotation_token = token.clone();
    let rotation = tokio::spawn(async move {
        identity::session::rotate_session(
            &rotation_pool,
            rotation_token.as_str(),
            &identity::SessionPolicy::from_env(),
        )
        .await
    });

    let mut rotation_is_waiting = false;
    for _ in 0..100 {
        rotation_is_waiting = sqlx::query_scalar(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND pid <> pg_backend_pid()
                  AND wait_event_type = 'Lock'
                  AND query LIKE '%auth_session%'
                  AND query LIKE '%FOR UPDATE%'
            )
            "#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        if rotation_is_waiting {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(
        rotation_is_waiting,
        "rotation must be blocked on the row lock"
    );

    while unix_now_seconds() <= idle_deadline {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    lock_holder.commit().await.unwrap();

    let rotation_result = tokio::time::timeout(Duration::from_secs(3), rotation)
        .await
        .expect("rotation should finish after the lock is released")
        .expect("rotation task should not panic");
    assert!(matches!(
        rotation_result,
        Err(identity::IdentityFlowError::Unauthorized)
    ));

    let session_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auth_session")
        .fetch_one(&pool)
        .await
        .unwrap();
    let original_revoked_at: Option<i64> =
        sqlx::query_scalar("SELECT revoked_at FROM auth_session WHERE token_hash = $1")
            .bind(token_hash)
            .fetch_one(&pool)
            .await
            .unwrap();
    let rotation_audits: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM identity_lifecycle_audit WHERE event_kind = 'session_rotated'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (session_rows, original_revoked_at, rotation_audits),
        (1, None, 0)
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn orphan_principal_sessions_fail_closed_for_read_and_rotation(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let local_proof_verifier = test_local_proof_verifier();
    let local_proof_instance_id = local_proof_verifier.instance_id().clone();
    let app = api::router_with_state(
        test_state(pool.clone(), &root).with_local_proof_auth(local_proof_verifier),
    );
    let principal_id = principal::PrincipalId::fixture("missing-platform-principal");
    let token = identity::token::generate_session_token();
    assert!(identity::token::is_app_session_token(token.as_str()));

    // Bypass the database guard in this isolated test to prove the canonical
    // validator remains fail-closed against corrupted/restored data as well.
    sqlx::query(
        "ALTER TABLE auth_session DROP CONSTRAINT IF EXISTS auth_session_principal_id_fkey",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO auth_session (
            token_hash,
            principal_id,
            created_at,
            expires_at,
            revoked_at,
            authenticated_via_method_id,
            idle_expires_at,
            assurance,
            local_proof_instance_id,
            authenticated_at
        )
        VALUES ($1, $2, 1, 4102444800, NULL, NULL, 4102444800, 'dev', $3, 1)
        "#,
    )
    .bind(identity::token::hash_token(token.as_str()))
    .bind(principal_id.as_uuid())
    .bind(local_proof_instance_id.as_str())
    .execute(&pool)
    .await
    .unwrap();

    let read_status = get_session(&app, token.as_str()).await.status();
    let sessions_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM auth_session WHERE principal_id = $1")
            .bind(principal_id.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();
    let audits_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM identity_lifecycle_audit WHERE principal_id = $1")
            .bind(principal_id.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();

    let rotation = post_json(
        &app,
        "/auth/session-rotations",
        Some(token.as_str()),
        serde_json::json!({}),
    )
    .await;
    let sessions_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM auth_session WHERE principal_id = $1")
            .bind(principal_id.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();
    let audits_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM identity_lifecycle_audit WHERE principal_id = $1")
            .bind(principal_id.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(
        (
            read_status,
            rotation.status(),
            sessions_after - sessions_before,
            audits_after - audits_before,
        ),
        (StatusCode::UNAUTHORIZED, StatusCode::UNAUTHORIZED, 0, 0)
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn ordinary_sessions_do_not_preserve_revoked_principal_capabilities(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let password = "correct horse battery staple";

    let response = register_classic_response(&app, &pool, "revoked@example.test", password).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let principal = response_principal_id(&body);
    sqlx::query(
        "UPDATE platform_principal SET global_capabilities = ARRAY['GlobalAdmin'] WHERE principal_id = $1",
    )
    .bind(principal.as_uuid())
    .execute(&pool)
    .await
    .unwrap();

    let response = post_json(
        &app,
        "/auth/sessions",
        None,
        serde_json::json!({
            "method": "classic",
            "login_name": "revoked@example.test",
            "password": password
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let token = json_body(response).await["session_token"]
        .as_str()
        .unwrap()
        .to_string();
    sqlx::query("UPDATE platform_principal SET global_capabilities = '{}' WHERE principal_id = $1")
        .bind(principal.as_uuid())
        .execute(&pool)
        .await
        .unwrap();

    let (status, session) = get_json(&app, "/auth/session", &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(session["capabilities"], serde_json::json!([]));
    let snapshot_columns: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auth_session' AND column_name = 'global_capabilities'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(snapshot_columns, 0);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn classic_to_workos_link_recovers_verified_stale_provider_sessions_without_mutation(
    pool: sqlx::PgPool,
) {
    let root = TempDir::new().unwrap();
    let recovery_cases = [
        (
            "link-recover-logout",
            "session_01HQAG1HENBZMAZD82YRXDFC0C",
            "logout",
        ),
        (
            "link-recover-method-disabled",
            "session_01HQAG1HENBZMAZD82YRXDFC0D",
            "method_disabled",
        ),
    ];
    let erased_subject = "user_link_recovery_erased";
    let erased_sid = "session_01HQAG1HENBZMAZD82YRXDFC0E";
    let mut identities = recovery_cases
        .iter()
        .map(|(token, session_id, _)| {
            (
                (*token).to_string(),
                VerifiedIdentity {
                    subject: format!("user_{token}"),
                    session_id: WorkosSessionId::parse(*session_id).unwrap(),
                    issued_at: 1,
                    expires_at: 4_102_444_800,
                    signing_key_id: "test-workos-key".to_string(),
                    email: None,
                },
            )
        })
        .collect::<Vec<_>>();
    identities.push((
        "link-recover-erased-subject".to_string(),
        VerifiedIdentity {
            subject: erased_subject.to_string(),
            session_id: WorkosSessionId::parse(erased_sid).unwrap(),
            issued_at: 1,
            expires_at: 4_102_444_800,
            signing_key_id: "test-workos-key".to_string(),
            email: None,
        },
    ));
    let verifier = StaticAccessTokenVerifier::new(identities);
    let app = api::router_with_state(
        test_state(pool.clone(), &root).with_access_token_verifier(Arc::new(verifier)),
    );
    let (_, local_session) = register_classic_account(
        &app,
        &pool,
        "link-recovery@example.test",
        "correct horse battery staple",
    )
    .await;

    for (_, session_id, reason) in recovery_cases {
        sqlx::query(
            r#"
            INSERT INTO workos_provider_session_tombstone (
                provider_session_hash, tombstoned_at, reason
            )
            VALUES ($1, 1, $2)
            "#,
        )
        .bind(WorkosSessionId::parse(session_id).unwrap().fingerprint())
        .bind(reason)
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query(
        r#"
        INSERT INTO workos_subject_tombstone (
            provider_subject_hash, tombstoned_at, reason
        )
        VALUES ($1, 1, 'subject_erasure')
        "#,
    )
    .bind(identity::workos::subject_fingerprint(erased_subject))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO workos_provider_session_tombstone (
            provider_session_hash, tombstoned_at, reason
        )
        VALUES ($1, 1, 'logout')
        "#,
    )
    .bind(WorkosSessionId::parse(erased_sid).unwrap().fingerprint())
    .execute(&pool)
    .await
    .unwrap();

    for (provider_assertion, session_id, _) in recovery_cases {
        let response = post_json(
            &app,
            "/auth/account/methods/workos",
            Some(local_session.as_str()),
            serde_json::json!({ "provider_assertion": provider_assertion }),
        )
        .await;
        assert_workos_provider_logout_recovery(response, session_id).await;
    }

    for provider_assertion in ["link-recover-erased-subject", "not-a-verified-assertion"] {
        let response = post_json(
            &app,
            "/auth/account/methods/workos",
            Some(local_session.as_str()),
            serde_json::json!({ "provider_assertion": provider_assertion }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let body = json_body(response).await;
        assert_eq!(body["error"], "NotAuthorized");
        assert!(body.get("provider_logout_url").is_none(), "body: {body}");
    }

    let workos_mutations: (i64, i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT (SELECT COUNT(*) FROM authentication_method WHERE kind = 'workos'),
               (SELECT COUNT(*) FROM external_identity),
               (SELECT COUNT(*) FROM workos_provider_session),
               (SELECT COUNT(*) FROM workos_session_exchange)
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(workos_mutations, (0, 0, 0, 0));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_attachment_is_symmetric_and_reactivates_in_place(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let first_session_id = WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap();
    let second_session_id = WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0C").unwrap();
    let verifier = StaticAccessTokenVerifier::new(
        [
            ("attach-proof", second_session_id),
            ("attach-proof-2", first_session_id.clone()),
            ("attach-proof-2-sibling", first_session_id),
        ]
        .map(|(token, session_id)| {
            (
                token.to_string(),
                VerifiedIdentity {
                    subject: "user_attach".to_string(),
                    session_id,
                    issued_at: 1,
                    expires_at: 4_102_444_800,
                    signing_key_id: "test-workos-key".to_string(),
                    email: Some("user_attach@example.test".to_string()),
                },
            )
        }),
    );
    let state = test_state(pool.clone(), &root).with_access_token_verifier(Arc::new(verifier));
    let app = api::router_with_state(state);

    let response = register_classic_response(
        &app,
        &pool,
        "classic-first@example.test",
        "correct horse battery staple",
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let registered = json_body(response).await;
    let classic_session = registered["session_token"].as_str().unwrap().to_string();
    let principal = response_principal_id(&registered);

    let response = post_json(
        &app,
        "/auth/account/methods/workos",
        Some(&classic_session),
        serde_json::json!({ "provider_assertion": "attach-proof-2" }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let attached = json_body(response).await;
    let method_id = attached["method_id"].as_str().unwrap().to_string();
    assert_eq!(attached["principal_id"], serde_json::json!(principal));
    assert_eq!(
        attached["provider_logout_url"].as_str(),
        Some(
            "https://api.workos.com/user_management/sessions/logout?session_id=session_01HQAG1HENBZMAZD82YRXDFC0B"
        )
    );

    let retried = post_json(
        &app,
        "/auth/account/methods/workos",
        Some(&classic_session),
        serde_json::json!({ "provider_assertion": "attach-proof-2" }),
    )
    .await;
    assert_eq!(retried.status(), StatusCode::OK);
    assert_eq!(json_body(retried).await, attached);
    let sibling_retry = post_json(
        &app,
        "/auth/account/methods/workos",
        Some(&classic_session),
        serde_json::json!({ "provider_assertion": "attach-proof-2-sibling" }),
    )
    .await;
    assert_workos_provider_logout_recovery(sibling_retry, "session_01HQAG1HENBZMAZD82YRXDFC0B")
        .await;
    let method_attached_audits: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM identity_lifecycle_audit WHERE event_kind = 'method_attached'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(method_attached_audits, 1);

    let second_classic_session = post_json(
        &app,
        "/auth/accounts/login",
        None,
        serde_json::json!({
            "account_id": "classic-first@example.test",
            "password": "correct horse battery staple"
        }),
    )
    .await;
    assert_eq!(second_classic_session.status(), StatusCode::OK);
    let second_classic_session = json_body(second_classic_session).await["session_token"]
        .as_str()
        .unwrap()
        .to_string();
    let wrong_local_session_retry = post_json(
        &app,
        "/auth/account/methods/workos",
        Some(&second_classic_session),
        serde_json::json!({ "provider_assertion": "attach-proof-2" }),
    )
    .await;
    assert_workos_provider_logout_recovery(
        wrong_local_session_retry,
        "session_01HQAG1HENBZMAZD82YRXDFC0B",
    )
    .await;

    let response = post_json(
        &app,
        format!("/auth/account/methods/{method_id}/disable").as_str(),
        Some(&classic_session),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);

    let response = post_json(
        &app,
        "/auth/account/methods/workos",
        Some(&classic_session),
        serde_json::json!({ "provider_assertion": "attach-proof" }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let reattached = json_body(response).await;
    assert_eq!(reattached["method_id"].as_str(), Some(method_id.as_str()));
    assert_eq!(
        reattached["provider_logout_url"].as_str(),
        Some(
            "https://api.workos.com/user_management/sessions/logout?session_id=session_01HQAG1HENBZMAZD82YRXDFC0C"
        )
    );

    let (status, methods) = get_json(&app, "/auth/account/methods", &classic_session).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(methods["methods"].as_array().unwrap().len(), 2);
    assert_eq!(
        methods["methods"]
            .as_array()
            .unwrap()
            .iter()
            .find(|method| method["method_id"] == method_id)
            .unwrap()["status"],
        "active"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn disabled_workos_method_never_reopens_an_older_provider_session(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let first_session_id = WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap();
    let second_session_id = WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0C").unwrap();
    let verifier = StaticAccessTokenVerifier::new(
        [
            ("disable-login-a", first_session_id.clone()),
            ("disable-unused-b", first_session_id),
            ("disable-relink-c", second_session_id),
        ]
        .map(|(token, session_id)| {
            (
                token.to_string(),
                VerifiedIdentity {
                    subject: "user_disable_replay".to_string(),
                    session_id,
                    issued_at: 1,
                    expires_at: 4_102_444_800,
                    signing_key_id: "test-workos-key".to_string(),
                    email: Some("disable-replay@example.test".to_string()),
                },
            )
        }),
    );
    let app = api::router_with_state(
        test_state(pool.clone(), &root).with_access_token_verifier(Arc::new(verifier)),
    );

    let invitation = community_invitation_for(&pool, "disable-replay@example.test").await;
    let login = post_json(
        &app,
        "/auth/sessions",
        Some("disable-login-a"),
        serde_json::json!({
            "method": "workos",
            "invitation_credential": invitation
        }),
    )
    .await;
    assert_eq!(login.status(), StatusCode::OK);
    let login = json_body(login).await;
    let principal = response_principal_id(&login);
    let workos_local_session = login["session_token"].as_str().unwrap();
    let workos_method_id: Uuid = sqlx::query_scalar(
        "SELECT method_id FROM authentication_method WHERE principal_id = $1 AND kind = 'workos'",
    )
    .bind(principal.as_uuid())
    .fetch_one(&pool)
    .await
    .unwrap();

    let classic = post_json(
        &app,
        "/auth/account/methods/classic",
        Some(workos_local_session),
        serde_json::json!({
            "login_name": "disable-replay@example.test",
            "password": "correct horse battery staple"
        }),
    )
    .await;
    assert_eq!(classic.status(), StatusCode::OK);
    let classic = json_body(classic).await;
    let classic_session = classic["session_token"].as_str().unwrap();

    let disabled = post_json(
        &app,
        format!("/auth/account/methods/{workos_method_id}/disable").as_str(),
        Some(classic_session),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(disabled.status(), StatusCode::OK);
    let old_sibling = post_json(
        &app,
        "/auth/sessions",
        Some("disable-unused-b"),
        serde_json::json!({ "method": "workos" }),
    )
    .await;
    assert_workos_provider_logout_recovery(old_sibling, "session_01HQAG1HENBZMAZD82YRXDFC0B").await;

    let relinked = post_json(
        &app,
        "/auth/account/methods/workos",
        Some(classic_session),
        serde_json::json!({ "provider_assertion": "disable-relink-c" }),
    )
    .await;
    assert_eq!(relinked.status(), StatusCode::OK);
    assert_eq!(
        json_body(relinked).await["method_id"].as_str(),
        Some(workos_method_id.to_string().as_str())
    );
    let old_sibling_after_reactivation = post_json(
        &app,
        "/auth/sessions",
        Some("disable-unused-b"),
        serde_json::json!({ "method": "workos" }),
    )
    .await;
    assert_workos_provider_logout_recovery(
        old_sibling_after_reactivation,
        "session_01HQAG1HENBZMAZD82YRXDFC0B",
    )
    .await;
    let provider_statuses: Vec<String> = sqlx::query_scalar(
        "SELECT status FROM workos_provider_session ORDER BY provider_session_id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(provider_statuses, ["logged_out", "logged_out"]);
    let tombstones: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM workos_provider_session_tombstone")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(tombstones, 2);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn link_only_workos_session_is_tombstoned_before_subject_erasure_removes_identity(
    pool: sqlx::PgPool,
) {
    let root = TempDir::new().unwrap();
    let session_id = WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap();
    let unseen_session_id = WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0C").unwrap();
    let verifier = StaticAccessTokenVerifier::new(
        [
            ("link-only-a", session_id.clone()),
            ("link-only-unused-b", session_id.clone()),
            ("link-only-unseen-session-c", unseen_session_id),
        ]
        .map(|(token, provider_session_id)| {
            (
                token.to_string(),
                VerifiedIdentity {
                    subject: "user_link_only".to_string(),
                    session_id: provider_session_id,
                    issued_at: 1,
                    expires_at: 4_102_444_800,
                    signing_key_id: "test-workos-key".to_string(),
                    email: None,
                },
            )
        }),
    );
    let app = api::router_with_state(
        test_state(pool.clone(), &root).with_access_token_verifier(Arc::new(verifier)),
    );
    let registration = register_classic_response(
        &app,
        &pool,
        "link-only-erasure@example.test",
        "correct horse battery staple",
    )
    .await;
    assert_eq!(registration.status(), StatusCode::OK);
    let registration = json_body(registration).await;
    let local_token = registration["session_token"].as_str().unwrap();
    let principal = response_principal_id(&registration);

    let linked = post_json(
        &app,
        "/auth/account/methods/workos",
        Some(local_token),
        serde_json::json!({ "provider_assertion": "link-only-a" }),
    )
    .await;
    assert_eq!(linked.status(), StatusCode::OK);
    let linked = json_body(linked).await;
    assert_eq!(
        linked["provider_logout_url"].as_str(),
        Some(
            "https://api.workos.com/user_management/sessions/logout?session_id=session_01HQAG1HENBZMAZD82YRXDFC0B"
        )
    );
    let exact_link_replay = post_json(
        &app,
        "/auth/sessions",
        Some("link-only-a"),
        serde_json::json!({ "method": "workos" }),
    )
    .await;
    assert_workos_provider_logout_recovery(exact_link_replay, "session_01HQAG1HENBZMAZD82YRXDFC0B")
        .await;
    let same_session_sibling = post_json(
        &app,
        "/auth/sessions",
        Some("link-only-unused-b"),
        serde_json::json!({ "method": "workos" }),
    )
    .await;
    assert_workos_provider_logout_recovery(
        same_session_sibling,
        "session_01HQAG1HENBZMAZD82YRXDFC0B",
    )
    .await;

    let erasure = post_json(
        &app,
        "/auth/account/erasure",
        Some(local_token),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(erasure.status(), StatusCode::ACCEPTED);
    assert_eq!(
        identity::process_pending_subject_erasures(
            &pool,
            "workos-link-erasure",
            unix_now_seconds()
        )
        .await
        .unwrap(),
        1
    );
    let provider_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM workos_provider_session WHERE principal_id = $1")
            .bind(principal.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(provider_rows, 0);
    let tombstone_json: String = sqlx::query_scalar(
        "SELECT to_jsonb(tombstone)::text FROM workos_provider_session_tombstone AS tombstone",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(tombstone_json.contains(session_id.fingerprint().as_str()));
    assert!(!tombstone_json.contains(session_id.as_str()));
    let subject_tombstone_json: String = sqlx::query_scalar(
        "SELECT to_jsonb(tombstone)::text FROM workos_subject_tombstone AS tombstone",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(subject_tombstone_json
        .contains(identity::workos::subject_fingerprint("user_link_only").as_str()));
    assert!(!subject_tombstone_json.contains("user_link_only"));

    let counts_before: (i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT (SELECT COUNT(*) FROM platform_principal),
               (SELECT COUNT(*) FROM privacy_subject),
               (SELECT COUNT(*) FROM external_identity)
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let sibling_from_unseen_provider_session = post_json(
        &app,
        "/auth/sessions",
        Some("link-only-unseen-session-c"),
        serde_json::json!({ "method": "workos" }),
    )
    .await;
    assert_eq!(
        sibling_from_unseen_provider_session.status(),
        StatusCode::UNAUTHORIZED
    );
    let counts_after: (i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT (SELECT COUNT(*) FROM platform_principal),
               (SELECT COUNT(*) FROM privacy_subject),
               (SELECT COUNT(*) FROM external_identity)
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(counts_after, counts_before);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn provider_jwts_and_random_bearers_are_never_general_credentials(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let state = test_state(pool.clone(), &root)
        .with_access_token_verifier(Arc::new(workos_verifier("workos-token", "user_dispatch")));
    let app = api::router_with_state(state);

    for bearer in [
        "workos-token",
        "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.sig",
        "fmss_unknown",
    ] {
        let (status, _) = get_json(&app, "/auth/session", bearer).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "bearer {bearer} must not authenticate"
        );
        let response = post_json(
            &app,
            "/auth/websocket-tickets",
            Some(bearer),
            serde_json::json!({ "audience": "fmarch-live", "game": Uuid::new_v4(), "channel": "main" }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn member_export_then_erasure_revokes_authority_and_pseudonymizes_retained_authorship(
    pool: sqlx::PgPool,
) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let response = register_classic_response(
        &app,
        &pool,
        "erase-me@example.test",
        "correct horse battery staple",
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let registered = json_body(response).await;
    let principal = response_principal_id(&registered);
    let token = registered["session_token"].as_str().unwrap().to_string();

    let profile_id = Uuid::new_v4();
    let subject_id: Uuid =
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_id = $1")
            .bind(principal.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();
    let game_id = Uuid::new_v4();
    let persona_id = Uuid::new_v4();
    let mut profile_tx = pool.begin().await.unwrap();
    let profile_claim_id = identity::insert_subject_claim(
        &mut profile_tx,
        identity::SubjectId::from_uuid(subject_id),
        "profile",
        profile_id,
        None,
        1,
        &serde_json::json!({
            "handle": "erase_me",
            "display_name": "Alicia",
            "bio": "private bio",
            "visibility": "public",
        }),
    )
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO member_profile (profile_id, active_principal_id, lifecycle, redacted_alias, created_seq, updated_seq, revision, subject_id, current_claim_id, handle_hmac) VALUES ($1, $2, 'active', NULL, 1, 1, 1, $3, $4, $5)",
    )
    .bind(profile_id)
    .bind(principal.as_uuid())
    .bind(subject_id)
    .bind(profile_claim_id.as_uuid())
    .bind(vec![7_u8; 32])
    .execute(&mut *profile_tx)
    .await
    .unwrap();
    sqlx::query("INSERT INTO public_profile (profile_id, handle, display_name, bio, created_seq, updated_seq, revision) VALUES ($1, 'erase_me', 'Alicia', 'private bio', 1, 1, 1)")
        .bind(profile_id).execute(&mut *profile_tx).await.unwrap();
    let persona_scope_key = persona_id.to_string();
    let persona_claim_id = identity::insert_subject_claim(
        &mut profile_tx,
        identity::SubjectId::from_uuid(subject_id),
        "game_persona_presentation",
        game_id,
        Some(&persona_scope_key),
        1,
        &game_platform::GamePersonaPresentation {
            public_name: game_platform::GamePersonaName::new("Alicia").unwrap(),
        },
    )
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO game_persona (game_id, persona_id, registered_seq) VALUES ($1, $2, 1)",
    )
    .bind(game_id)
    .bind(persona_id)
    .execute(&mut *profile_tx)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO game_persona_subject_binding (game_id, persona_id, subject_id, current_claim_id, lifecycle) VALUES ($1, $2, $3, $4, 'active')",
    )
    .bind(game_id)
    .bind(persona_id)
    .bind(subject_id)
    .bind(persona_claim_id.as_uuid())
    .execute(&mut *profile_tx)
    .await
    .unwrap();
    sqlx::query("INSERT INTO game_persona_public (game_id, persona_id, current_public_name, registered_seq, renamed_seq) VALUES ($1, $2, 'Alicia', 1, NULL)")
        .bind(game_id).bind(persona_id).execute(&mut *profile_tx).await.unwrap();
    let incoming_mute_id = Uuid::new_v4();
    sqlx::query("INSERT INTO profile_mute (relationship_id, principal_id, target_profile_id, active, updated_seq, version) VALUES ($1, $2, $3, TRUE, 1, 1)")
        .bind(incoming_mute_id)
        .bind(Uuid::new_v4())
        .bind(profile_id)
        .execute(&mut *profile_tx)
        .await
        .unwrap();
    profile_tx.commit().await.unwrap();

    let response = post_json(
        &app,
        "/auth/account/personal-exports",
        Some(&token),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let export = json_body(response).await;
    assert_eq!(export["status"], "ready");
    assert_eq!(
        export["artifact"]["accounts"][0]["account_id"],
        "erase-me@example.test"
    );
    assert_eq!(export["artifact"]["profiles"][0]["display_name"], "Alicia");

    let response = post_json(
        &app,
        "/auth/account/erasure",
        Some(&token),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let pending = json_body(response).await;
    assert_eq!(pending["status"], "erasure_in_progress");
    let pseudonym = pending["pseudonym"].as_str().unwrap().to_string();

    let response = get_session(&app, token.as_str()).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let (principal_status, method_status, account_disabled): (String, String, Option<i64>) = sqlx::query_as(
        "SELECT principal.status, method.status, account.disabled_at FROM platform_principal AS principal JOIN authentication_method AS method ON method.principal_id = principal.principal_id JOIN auth_account AS account ON account.principal_id = principal.principal_id WHERE principal.principal_id = $1",
    )
    .bind(principal.as_uuid())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(principal_status, "disabled");
    assert_eq!(method_status, "disabled");
    assert!(account_disabled.is_some());
    let public_profile_exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM public_profile WHERE profile_id = $1)")
            .bind(profile_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        !public_profile_exists,
        "erasure must remove the public profile materialization"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM profile_mute WHERE relationship_id = $1",
        )
        .bind(incoming_mute_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0,
        "erasure must explicitly terminalize incoming mute projections",
    );
    let (active_principal_id, lifecycle, redacted_alias, current_claim_id): (
        Option<Uuid>,
        String,
        Option<String>,
        Option<Uuid>,
    ) = sqlx::query_as(
        "SELECT active_principal_id, lifecycle, redacted_alias, current_claim_id FROM member_profile WHERE profile_id = $1",
    )
    .bind(profile_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(active_principal_id.is_none());
    assert_eq!(lifecycle, "redacted");
    assert_eq!(redacted_alias.as_deref(), Some(pseudonym.as_str()));
    assert!(current_claim_id.is_none());
    let redacted_name: String = sqlx::query_scalar(
        "SELECT replacement_public_name FROM game_persona_redaction WHERE game_id = $1 AND persona_id = $2",
    )
    .bind(game_id)
    .bind(persona_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(redacted_name, pseudonym);
    let pending_kinds: Vec<String> = sqlx::query_scalar(
        "SELECT kind FROM member_lifecycle_event WHERE principal_id = $1 ORDER BY seq",
    )
    .bind(principal.as_uuid())
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        pending_kinds,
        [
            "MemberPersonalExportRecorded",
            "MemberDeactivated",
            "MemberErasureRequested",
            "MemberCredentialsErased",
        ]
    );
    assert_eq!(
        identity::process_pending_subject_erasures(&pool, "api-test-worker", unix_now_seconds())
            .await
            .unwrap(),
        1
    );
    let terminal: (String, Option<String>) = sqlx::query_as(
        "SELECT status, pseudonym FROM member_lifecycle_projection WHERE principal_id = $1",
    )
    .bind(principal.as_uuid())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(terminal.0, "erased");
    assert_eq!(terminal.1.as_deref(), Some(pseudonym.as_str()));
    let kinds: Vec<String> = sqlx::query_scalar(
        "SELECT kind FROM member_lifecycle_event WHERE principal_id = $1 ORDER BY seq",
    )
    .bind(principal.as_uuid())
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        kinds,
        [
            "MemberPersonalExportRecorded",
            "MemberDeactivated",
            "MemberErasureRequested",
            "MemberCredentialsErased",
            "MemberAuthorshipPseudonymized",
        ]
    );
    // Never attempt to restore authority: a redacted binding has no live
    // private claim. Corrupt only the public overlay, then prove lifecycle
    // replay re-derives it from the durable tombstone.
    sqlx::query("UPDATE game_persona_public SET current_public_name = 'Alicia' WHERE game_id = $1 AND persona_id = $2")
        .bind(game_id)
        .bind(persona_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM game_persona_redaction WHERE game_id = $1 AND persona_id = $2")
        .bind(game_id)
        .bind(persona_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM member_lifecycle_projection WHERE principal_id = $1")
        .bind(principal.as_uuid())
        .execute(&pool)
        .await
        .unwrap();

    let rebuilt = identity::rebuild_member_lifecycle(&pool, &principal)
        .await
        .unwrap();
    assert_eq!(rebuilt.status, identity::MemberLifecycleStatus::Erased);
    assert_eq!(rebuilt.last_seq, 5);
    assert_eq!(rebuilt.pseudonym.as_deref(), Some(pseudonym.as_str()));
    let rebuilt_public_profile_exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM public_profile WHERE profile_id = $1)")
            .bind(profile_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        !rebuilt_public_profile_exists,
        "lifecycle rebuild must not rematerialize an erased public profile"
    );
    let rebuilt_profile_binding: (Option<String>, String, Option<String>, Option<Uuid>) =
        sqlx::query_as(
            "SELECT active_principal_id, lifecycle, redacted_alias, current_claim_id FROM member_profile WHERE profile_id = $1",
        )
        .bind(profile_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rebuilt_profile_binding.0, None);
    assert_eq!(rebuilt_profile_binding.1, "redacted");
    assert_eq!(
        rebuilt_profile_binding.2.as_deref(),
        Some(pseudonym.as_str())
    );
    assert_eq!(rebuilt_profile_binding.3, None);
    let rebuilt_persona_name: String = sqlx::query_scalar(
        "SELECT current_public_name FROM game_persona_public WHERE game_id = $1 AND persona_id = $2",
    )
    .bind(game_id)
    .bind(persona_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rebuilt_persona_name, pseudonym);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn logout_wins_before_a_delayed_erasure_commit_boundary(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let (principal, token) = register_classic_account(
        &app,
        &pool,
        "logout-erasure-race@example.test",
        "correct horse battery staple",
    )
    .await;

    // Hold a lease acquired by erasure before its identity transaction. This
    // deterministically recreates slow external/preparation work after the
    // request extractor has accepted the bearer but before the commit fence.
    let mut maintenance = pool.acquire().await.unwrap();
    sqlx::query(
        "SELECT pg_advisory_lock(hashtextextended('fmarch:profile-handle-index-maintenance:v1', 0))",
    )
    .execute(&mut *maintenance)
    .await
    .unwrap();

    let erasure_app = app.clone();
    let erasure_token = token.clone();
    let erasure = tokio::spawn(async move {
        post_json(
            &erasure_app,
            "/auth/account/erasure",
            Some(erasure_token.as_str()),
            serde_json::json!({}),
        )
        .await
    });
    wait_for_profile_index_writer_lock_waiter(&pool).await;

    let logout = post_json(
        &app,
        "/auth/session-logout",
        Some(token.as_str()),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(logout.status(), StatusCode::OK);

    let released: bool = sqlx::query_scalar(
        "SELECT pg_advisory_unlock(hashtextextended('fmarch:profile-handle-index-maintenance:v1', 0))",
    )
    .fetch_one(&mut *maintenance)
    .await
    .unwrap();
    assert!(released);

    let erasure = tokio::time::timeout(Duration::from_secs(5), erasure)
        .await
        .expect("delayed erasure did not leave its commit fence")
        .unwrap();
    assert_eq!(erasure.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM subject_erasure_outbox WHERE principal_id = $1",
        )
        .bind(principal.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        0,
        "a bearer revoked during preparation must not authorize erasure"
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT status FROM platform_principal WHERE principal_id = $1",
        )
        .bind(principal.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        "active"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn account_recovery_waits_at_owner_boundary_before_erasure(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let account_id = "recovery-race@example.test";
    let password = "correct horse battery staple";
    let (principal, token) = register_classic_account(&app, &pool, account_id, password).await;
    let response = post_json(
        &app,
        "/auth/accounts/recovery-credentials",
        Some(&token),
        serde_json::json!({
            "account_id": account_id,
            "current_password": password,
            "expires_at": unix_now_seconds() + 3600
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let credential = json_body(response).await;
    let recovery_id = Uuid::parse_str(credential["recovery_id"].as_str().unwrap()).unwrap();
    let recovery_token = credential["recovery_token"].as_str().unwrap().to_string();

    let mut owner_gate = pool.begin().await.unwrap();
    sqlx::query("SELECT principal_id FROM platform_principal WHERE principal_id = $1 FOR UPDATE")
        .bind(principal.as_uuid())
        .execute(&mut *owner_gate)
        .await
        .unwrap();
    let start = Arc::new(tokio::sync::Barrier::new(2));
    let mutation_app = app.clone();
    let mutation_start = Arc::clone(&start);
    let mutation = tokio::spawn(async move {
        mutation_start.wait().await;
        post_json(
            &mutation_app,
            "/auth/accounts/recoveries",
            None,
            serde_json::json!({
                "account_id": account_id,
                "recovery_token": recovery_token,
                "new_password": "recovered horse battery staple"
            }),
        )
        .await
    });
    start.wait().await;
    wait_for_owner_lock_waiters(&pool, 1).await;

    // Waiting at the owner boundary must not hold the recovery row yet.
    let mut probe = pool.begin().await.unwrap();
    sqlx::query("SELECT recovery_id FROM auth_account_recovery_credential WHERE recovery_id = $1 FOR UPDATE NOWAIT")
        .bind(recovery_id)
        .execute(&mut *probe)
        .await
        .unwrap();
    probe.rollback().await.unwrap();

    let erasure_pool = pool.clone();
    let erasure_principal = principal;
    let erasure = tokio::spawn(async move {
        identity::erase_member(&erasure_pool, &erasure_principal, unix_now_seconds()).await
    });
    wait_for_owner_lock_waiters(&pool, 2).await;
    owner_gate.commit().await.unwrap();

    let (mutation, erasure) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(mutation, erasure)
    })
    .await
    .expect("recovery and erasure must serialize without deadlock");
    assert_success_without_deadlock(mutation.unwrap()).await;
    erasure.unwrap().unwrap();
    assert_erased_without_eligible_sessions(&pool, principal).await;
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn invite_redemption_waits_at_owner_boundary_before_erasure(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(
        test_state(pool.clone(), &root).with_local_proof_auth(test_local_proof_verifier()),
    );
    let account_id = "invite-race@example.test";
    let password = "correct horse battery staple";
    let invite_token = "invite-erasure-race-token";
    let (principal, _) = register_classic_account(&app, &pool, account_id, password).await;
    let admin_token =
        issue_dev_admin(&app, principal::PrincipalId::fixture("invite-race-admin")).await;
    let response = post_json(
        &app,
        "/auth/game-invitations",
        Some(&admin_token),
        serde_json::json!({
            "invite_token": invite_token,
            "account_id": account_id,
            "expected_principal_id": principal,
            "expires_at": unix_now_seconds() + 3600
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let invite_hash = identity::token::hash_token(invite_token);

    let mut owner_gate = pool.begin().await.unwrap();
    sqlx::query("SELECT principal_id FROM platform_principal WHERE principal_id = $1 FOR UPDATE")
        .bind(principal.as_uuid())
        .execute(&mut *owner_gate)
        .await
        .unwrap();
    let start = Arc::new(tokio::sync::Barrier::new(2));
    let mutation_app = app.clone();
    let mutation_start = Arc::clone(&start);
    let mutation = tokio::spawn(async move {
        mutation_start.wait().await;
        post_json(
            &mutation_app,
            "/auth/game-invitations/redeem",
            None,
            serde_json::json!({
                "invite_token": invite_token,
                "account_id": account_id,
                "password": password
            }),
        )
        .await
    });
    start.wait().await;
    wait_for_owner_lock_waiters(&pool, 1).await;
    let mut probe = pool.begin().await.unwrap();
    sqlx::query("SELECT token_hash FROM game_invitation WHERE token_hash = $1 FOR UPDATE NOWAIT")
        .bind(&invite_hash)
        .execute(&mut *probe)
        .await
        .unwrap();
    probe.rollback().await.unwrap();

    let erasure_pool = pool.clone();
    let erasure_principal = principal;
    let erasure = tokio::spawn(async move {
        identity::erase_member(&erasure_pool, &erasure_principal, unix_now_seconds()).await
    });
    wait_for_owner_lock_waiters(&pool, 2).await;
    owner_gate.commit().await.unwrap();
    let (mutation, erasure) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(mutation, erasure)
    })
    .await
    .expect("invite redemption and erasure must serialize without deadlock");
    assert_success_without_deadlock(mutation.unwrap()).await;
    erasure.unwrap().unwrap();
    assert_erased_without_eligible_sessions(&pool, principal).await;
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn account_disable_waits_at_owner_boundary_before_erasure(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(
        test_state(pool.clone(), &root).with_local_proof_auth(test_local_proof_verifier()),
    );
    let account_id = "disable-race@example.test";
    let (principal, _) =
        register_classic_account(&app, &pool, account_id, "correct horse battery staple").await;
    let admin_token =
        issue_dev_admin(&app, principal::PrincipalId::fixture("disable-race-admin")).await;

    let mut owner_gate = pool.begin().await.unwrap();
    sqlx::query("SELECT principal_id FROM platform_principal WHERE principal_id = $1 FOR UPDATE")
        .bind(principal.as_uuid())
        .execute(&mut *owner_gate)
        .await
        .unwrap();
    let start = Arc::new(tokio::sync::Barrier::new(2));
    let mutation_app = app.clone();
    let mutation_start = Arc::clone(&start);
    let mutation = tokio::spawn(async move {
        mutation_start.wait().await;
        post_json(
            &mutation_app,
            "/auth/accounts/disable",
            Some(&admin_token),
            serde_json::json!({ "account_id": account_id, "expected_disabled": false }),
        )
        .await
    });
    start.wait().await;
    wait_for_owner_lock_waiters(&pool, 1).await;
    let mut probe = pool.begin().await.unwrap();
    sqlx::query("SELECT account_id FROM auth_account WHERE account_id = $1 FOR UPDATE NOWAIT")
        .bind(account_id)
        .execute(&mut *probe)
        .await
        .unwrap();
    probe.rollback().await.unwrap();

    let erasure_pool = pool.clone();
    let erasure_principal = principal;
    let erasure = tokio::spawn(async move {
        identity::erase_member(&erasure_pool, &erasure_principal, unix_now_seconds()).await
    });
    wait_for_owner_lock_waiters(&pool, 2).await;
    owner_gate.commit().await.unwrap();
    let (mutation, erasure) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(mutation, erasure)
    })
    .await
    .expect("account mutation and erasure must serialize without deadlock");
    assert_success_without_deadlock(mutation.unwrap()).await;
    erasure.unwrap().unwrap();
    assert_erased_without_eligible_sessions(&pool, principal).await;
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn session_rotation_waits_at_owner_boundary_before_erasure(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let (principal, token) = register_classic_account(
        &app,
        &pool,
        "session-race@example.test",
        "correct horse battery staple",
    )
    .await;
    let token_hash = identity::token::hash_token(&token);

    let mut owner_gate = pool.begin().await.unwrap();
    sqlx::query("SELECT principal_id FROM platform_principal WHERE principal_id = $1 FOR UPDATE")
        .bind(principal.as_uuid())
        .execute(&mut *owner_gate)
        .await
        .unwrap();
    let start = Arc::new(tokio::sync::Barrier::new(2));
    let mutation_app = app.clone();
    let mutation_start = Arc::clone(&start);
    let mutation = tokio::spawn(async move {
        mutation_start.wait().await;
        post_json(
            &mutation_app,
            "/auth/session-rotations",
            Some(&token),
            serde_json::json!({}),
        )
        .await
    });
    start.wait().await;
    wait_for_owner_lock_waiters(&pool, 1).await;
    let mut probe = pool.begin().await.unwrap();
    sqlx::query("SELECT token_hash FROM auth_session WHERE token_hash = $1 FOR UPDATE NOWAIT")
        .bind(&token_hash)
        .execute(&mut *probe)
        .await
        .unwrap();
    probe.rollback().await.unwrap();

    let erasure_pool = pool.clone();
    let erasure_principal = principal;
    let erasure = tokio::spawn(async move {
        identity::erase_member(&erasure_pool, &erasure_principal, unix_now_seconds()).await
    });
    wait_for_owner_lock_waiters(&pool, 2).await;
    owner_gate.commit().await.unwrap();
    let (mutation, erasure) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(mutation, erasure)
    })
    .await
    .expect("session mutation and erasure must serialize without deadlock");
    assert_success_without_deadlock(mutation.unwrap()).await;
    erasure.unwrap().unwrap();
    assert_erased_without_eligible_sessions(&pool, principal).await;
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn lifecycle_rebuild_locks_owner_before_projection_and_erasure(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let (principal, _) = register_classic_account(
        &app,
        &pool,
        "rebuild-race@example.test",
        "correct horse battery staple",
    )
    .await;
    identity::apply_member_lifecycle(
        &pool,
        &principal,
        identity::MemberLifecycleCommand::Deactivate {
            reason: "rebuild_race_fixture".to_string(),
        },
        unix_now_seconds(),
    )
    .await
    .unwrap();

    let mut owner_gate = pool.begin().await.unwrap();
    sqlx::query("SELECT principal_id FROM platform_principal WHERE principal_id = $1 FOR UPDATE")
        .bind(principal.as_uuid())
        .execute(&mut *owner_gate)
        .await
        .unwrap();
    let rebuild_pool = pool.clone();
    let rebuild_principal = principal;
    let rebuild = tokio::spawn(async move {
        identity::rebuild_member_lifecycle(&rebuild_pool, &rebuild_principal).await
    });
    wait_for_owner_lock_waiters(&pool, 1).await;

    // Rebuild cannot read and hold a stale projection before owner
    // serialization; otherwise erasure could commit and then be overwritten.
    let mut probe = pool.begin().await.unwrap();
    sqlx::query("SELECT principal_id FROM member_lifecycle_projection WHERE principal_id = $1 FOR UPDATE NOWAIT")
        .bind(principal.as_uuid())
        .execute(&mut *probe)
        .await
        .unwrap();
    probe.rollback().await.unwrap();

    let erasure_pool = pool.clone();
    let erasure_principal = principal;
    let erasure = tokio::spawn(async move {
        identity::erase_member(&erasure_pool, &erasure_principal, unix_now_seconds()).await
    });
    wait_for_owner_lock_waiters(&pool, 2).await;
    owner_gate.commit().await.unwrap();
    let (rebuild, erasure) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(rebuild, erasure)
    })
    .await
    .expect("lifecycle rebuild and erasure must serialize without deadlock");
    assert_eq!(
        rebuild.unwrap().unwrap().status,
        identity::MemberLifecycleStatus::Deactivated
    );
    erasure.unwrap().unwrap();

    let rebuilt = identity::rebuild_member_lifecycle(&pool, &principal)
        .await
        .unwrap();
    assert_eq!(rebuilt.status, identity::MemberLifecycleStatus::Erased);
    assert_erased_without_eligible_sessions(&pool, principal).await;
}
