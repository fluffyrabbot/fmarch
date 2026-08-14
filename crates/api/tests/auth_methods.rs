//! Proofs for the authentication-method identity model: backend-issued
//! app-session tokens, principal/method rows on classic write paths, the lazy
//! upgrade of pre-refactor accounts, the WorkOS session exchange, method
//! management invariants, and bearer dispatch.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use api::ApiState;
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use identity::{StaticAccessTokenVerifier, VerifiedIdentity};
use media::{MediaLimits, MediaStore};
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;

fn test_state(pool: sqlx::PgPool, root: &TempDir) -> ApiState {
    let store = MediaStore::open(root.path(), MediaLimits::default()).unwrap();
    ApiState::new(pool, store)
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
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
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    app.clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap()
}

async fn register_classic_account(
    app: &axum::Router,
    account_id: &str,
    password: &str,
) -> (String, String) {
    let response = post_json(
        app,
        "/auth/accounts/registrations",
        None,
        serde_json::json!({ "account_id": account_id, "password": password }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    (
        body["principal_user_id"].as_str().unwrap().to_string(),
        body["session_token"].as_str().unwrap().to_string(),
    )
}

async fn issue_dev_admin(app: &axum::Router, principal_user_id: &str) -> String {
    let response = post_json(
        app,
        "/auth/dev-session",
        None,
        serde_json::json!({
            "principal_user_id": principal_user_id,
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

async fn assert_erased_without_eligible_sessions(pool: &sqlx::PgPool, principal_user_id: &str) {
    let (principal_status, subject_state): (String, String) = sqlx::query_as(
        r#"
        SELECT principal.status, subject.lifecycle_state
        FROM platform_principal AS principal
        JOIN privacy_subject AS subject USING (principal_user_id)
        WHERE principal.principal_user_id = $1
        "#,
    )
    .bind(principal_user_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let eligible_sessions: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM auth_session AS session
        JOIN platform_principal AS principal USING (principal_user_id)
        WHERE session.principal_user_id = $1
          AND session.revoked_at IS NULL
          AND session.expires_at > $2
          AND session.idle_expires_at > $2
          AND principal.status = 'active'
        "#,
    )
    .bind(principal_user_id)
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
          ON principal.principal_user_id = account.principal_user_id
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

#[sqlx::test(migrations = "../projections/migrations")]
async fn registration_issues_backend_token_and_method_rows(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));

    let response = post_json(
        &app,
        "/auth/accounts/registrations",
        None,
        serde_json::json!({
            "account_id": "new-player@example.test",
            "password": "correct horse battery staple"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let session_token = body["session_token"].as_str().unwrap().to_string();
    assert!(identity::token::is_app_session_token(
        session_token.as_str()
    ));
    let principal_user_id = body["principal_user_id"].as_str().unwrap().to_string();

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
    assert_eq!(
        body["principal_user_id"].as_str(),
        Some(principal_user_id.as_str())
    );
    assert!(body.get("session_token").is_none());
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn orphan_accounts_fail_closed_without_creating_identity_rows(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));

    let password = "correct horse battery staple";
    let password_hash = identity::password::hash_password_sync(password).unwrap();
    sqlx::query(
        "INSERT INTO auth_account (account_id, principal_user_id, password_hash, created_at, disabled_at, global_capabilities) VALUES ($1, $2, $3, 1, NULL, '{}')",
    )
    .bind("orphan-player@example.test")
    .bind("orphan-player-principal")
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
            (SELECT COUNT(*) FROM platform_principal WHERE principal_user_id = 'orphan-player-principal'),
            (SELECT COUNT(*) FROM privacy_subject WHERE principal_user_id = 'orphan-player-principal'),
            (SELECT COUNT(*) FROM authentication_method WHERE principal_user_id = 'orphan-player-principal'),
            (SELECT COUNT(*) FROM auth_session WHERE principal_user_id = 'orphan-player-principal')
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((principals, subjects, methods, sessions), (0, 0, 0, 0));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn dev_session_grant_and_rotation_issue_backend_tokens(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root).with_dev_auth(true));

    let response = post_json(
        &app,
        "/auth/dev-session",
        None,
        serde_json::json!({
            "principal_user_id": "phase-one-admin",
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
        "/auth/session-grants",
        Some(admin_token.as_str()),
        serde_json::json!({
            "principal_user_id": "granted-principal",
            "expires_at": 4_102_444_800i64
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let granted_token = body["session_token"].as_str().unwrap().to_string();
    assert!(identity::token::is_app_session_token(
        granted_token.as_str()
    ));
    let (method, assurance) = session_row(&pool, granted_token.as_str()).await;
    assert_eq!(method, None);
    assert_eq!(assurance.as_deref(), Some("admin_grant"));

    let response = post_json(
        &app,
        "/auth/session-rotations",
        Some(granted_token.as_str()),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let rotated_token = body["session_token"].as_str().unwrap().to_string();
    assert!(identity::token::is_app_session_token(
        rotated_token.as_str()
    ));
    assert_ne!(rotated_token, granted_token);

    let stale = get_session(&app, granted_token.as_str()).await;
    assert_eq!(stale.status(), StatusCode::UNAUTHORIZED);
    let fresh = get_session(&app, rotated_token.as_str()).await;
    assert_eq!(fresh.status(), StatusCode::OK);
}

fn workos_verifier(token: &str, subject: &str) -> StaticAccessTokenVerifier {
    StaticAccessTokenVerifier::new([(
        token.to_string(),
        VerifiedIdentity {
            subject: subject.to_string(),
            session_id: format!("{subject}-provider-session"),
            expires_at: 4_102_444_800,
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

#[sqlx::test(migrations = "../projections/migrations")]
async fn one_principal_survives_workos_to_classic_conversion(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let state = test_state(pool.clone(), &root)
        .with_access_token_verifier(Arc::new(workos_verifier("workos-token", "user_convert")))
        .with_dev_auth(true);
    let app = api::router_with_state(state);

    let response = post_json(
        &app,
        "/auth/dev-session",
        None,
        serde_json::json!({
            "principal_user_id": "method-lifecycle-admin",
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
    let response = post_json(
        &app,
        "/auth/sessions",
        Some("workos-token"),
        serde_json::json!({ "method": "workos" }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let workos_session = body["session_token"].as_str().unwrap().to_string();
    let principal_user_id = body["principal_user_id"].as_str().unwrap().to_string();

    // Grant a capability to the principal so capability continuity is
    // observable across methods.
    sqlx::query(
        "UPDATE platform_principal SET global_capabilities = ARRAY['GlobalMod'] WHERE principal_user_id = $1",
    )
    .bind(principal_user_id.as_str())
    .execute(&pool)
    .await
    .unwrap();
    let (status, session_a) = get_json(&app, "/auth/session", workos_session.as_str()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        session_a["principal_user_id"].as_str().unwrap(),
        principal_user_id
    );

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
    assert_eq!(
        added["principal_user_id"].as_str().unwrap(),
        principal_user_id
    );
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
    assert_eq!(
        session_a["principal_user_id"],
        session_b["principal_user_id"]
    );
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
        "SELECT event_kind FROM identity_lifecycle_audit WHERE principal_user_id = $1 ORDER BY id",
    )
    .bind(principal_user_id.as_str())
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

#[sqlx::test(migrations = "../projections/migrations")]
async fn rotation_cannot_refresh_recent_authentication(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let state = test_state(pool.clone(), &root)
        .with_access_token_verifier(Arc::new(workos_verifier("workos-old", "user_old")));
    let app = api::router_with_state(state);

    let response = post_json(
        &app,
        "/auth/sessions",
        Some("workos-old"),
        serde_json::json!({ "method": "workos" }),
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
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn idle_expired_sessions_cannot_rotate_or_choose_legacy_bearers(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let password = "correct horse battery staple";

    let response = post_json(
        &app,
        "/auth/accounts/registrations",
        None,
        serde_json::json!({
            "account_id": "idle-expired@example.test",
            "password": password
        }),
    )
    .await;
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

#[sqlx::test(migrations = "../projections/migrations")]
async fn idle_session_cannot_resurrect_after_expiring_while_rotation_waits_for_its_lock(
    pool: sqlx::PgPool,
) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));

    let response = post_json(
        &app,
        "/auth/accounts/registrations",
        None,
        serde_json::json!({
            "account_id": "lock-expired@example.test",
            "password": "correct horse battery staple"
        }),
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

#[sqlx::test(migrations = "../projections/migrations")]
async fn orphan_principal_sessions_fail_closed_for_read_and_rotation(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let principal_user_id = "missing-platform-principal";
    let token = identity::token::generate_session_token();
    assert!(identity::token::is_app_session_token(token.as_str()));

    // Bypass the database guard in this isolated test to prove the canonical
    // validator remains fail-closed against corrupted/restored data as well.
    sqlx::query(
        "ALTER TABLE auth_session DROP CONSTRAINT IF EXISTS auth_session_principal_user_id_fkey",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO auth_session (
            token_hash,
            principal_user_id,
            created_at,
            expires_at,
            revoked_at,
            global_capabilities,
            authenticated_via_method_id,
            idle_expires_at,
            assurance,
            authenticated_at
        )
        VALUES ($1, $2, 1, 4102444800, NULL, '{}', NULL, 4102444800, 'admin_grant', 1)
        "#,
    )
    .bind(identity::token::hash_token(token.as_str()))
    .bind(principal_user_id)
    .execute(&pool)
    .await
    .unwrap();

    let read_status = get_session(&app, token.as_str()).await.status();
    let sessions_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM auth_session WHERE principal_user_id = $1")
            .bind(principal_user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let audits_before: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM identity_lifecycle_audit WHERE principal_user_id = $1",
    )
    .bind(principal_user_id)
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
        sqlx::query_scalar("SELECT COUNT(*) FROM auth_session WHERE principal_user_id = $1")
            .bind(principal_user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let audits_after: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM identity_lifecycle_audit WHERE principal_user_id = $1",
    )
    .bind(principal_user_id)
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

#[sqlx::test(migrations = "../projections/migrations")]
async fn ordinary_sessions_do_not_preserve_revoked_principal_capabilities(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let password = "correct horse battery staple";

    let response = post_json(
        &app,
        "/auth/accounts/registrations",
        None,
        serde_json::json!({ "account_id": "revoked@example.test", "password": password }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let principal = json_body(response).await["principal_user_id"]
        .as_str()
        .unwrap()
        .to_string();
    sqlx::query(
        "UPDATE platform_principal SET global_capabilities = ARRAY['GlobalAdmin'] WHERE principal_user_id = $1",
    )
    .bind(&principal)
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
    sqlx::query(
        "UPDATE platform_principal SET global_capabilities = '{}' WHERE principal_user_id = $1",
    )
    .bind(&principal)
    .execute(&pool)
    .await
    .unwrap();

    let (status, session) = get_json(&app, "/auth/session", &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(session["capabilities"], serde_json::json!([]));
    let stored_grants: Vec<String> =
        sqlx::query_scalar("SELECT global_capabilities FROM auth_session WHERE token_hash = $1")
            .bind(identity::token::hash_token(&token))
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(stored_grants.is_empty());
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn workos_attachment_is_symmetric_and_reactivates_in_place(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let state = test_state(pool.clone(), &root)
        .with_access_token_verifier(Arc::new(workos_verifier("attach-proof", "user_attach")));
    let app = api::router_with_state(state);

    let response = post_json(
        &app,
        "/auth/accounts/registrations",
        None,
        serde_json::json!({
            "account_id": "classic-first@example.test",
            "password": "correct horse battery staple"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let registered = json_body(response).await;
    let classic_session = registered["session_token"].as_str().unwrap().to_string();
    let principal = registered["principal_user_id"]
        .as_str()
        .unwrap()
        .to_string();

    let response = post_json(
        &app,
        "/auth/account/methods/workos",
        Some(&classic_session),
        serde_json::json!({ "provider_assertion": "attach-proof" }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let attached = json_body(response).await;
    let method_id = attached["method_id"].as_str().unwrap().to_string();
    assert_eq!(
        attached["principal_user_id"].as_str(),
        Some(principal.as_str())
    );

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

#[sqlx::test(migrations = "../projections/migrations")]
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

#[sqlx::test(migrations = "../projections/migrations")]
async fn member_export_then_erasure_revokes_authority_and_pseudonymizes_retained_authorship(
    pool: sqlx::PgPool,
) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let response = post_json(
        &app,
        "/auth/accounts/registrations",
        None,
        serde_json::json!({
            "account_id": "erase-me@example.test",
            "password": "correct horse battery staple"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let registered = json_body(response).await;
    let principal = registered["principal_user_id"]
        .as_str()
        .unwrap()
        .to_string();
    let token = registered["session_token"].as_str().unwrap().to_string();

    let profile_id = Uuid::new_v4();
    sqlx::query("INSERT INTO profile_public (profile_id, handle, display_name, bio, visibility, created_seq, updated_seq) VALUES ($1, 'erase-me', 'Alicia', 'private bio', 'public', 1, 1)")
        .bind(profile_id).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO profile_editor (profile_id, principal_user_id, last_edit_seq) VALUES ($1, $2, 1)")
        .bind(profile_id).bind(principal.as_str()).execute(&pool).await.unwrap();
    let game_id = Uuid::new_v4();
    sqlx::query("INSERT INTO game_persona_private (game_id, persona_id, principal_user_id, registered_seq) VALUES ($1, 'gp_test', $2, 1)")
        .bind(game_id).bind(principal.as_str()).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO game_persona_public (game_id, persona_id, current_public_name, registered_seq, renamed_seq) VALUES ($1, 'gp_test', 'Alicia', 1, NULL)")
        .bind(game_id).execute(&pool).await.unwrap();

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
        "SELECT principal.status, method.status, account.disabled_at FROM platform_principal AS principal JOIN authentication_method AS method ON method.principal_user_id = principal.principal_user_id JOIN auth_account AS account ON account.principal_user_id = principal.principal_user_id WHERE principal.principal_user_id = $1",
    )
    .bind(principal.as_str())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(principal_status, "disabled");
    assert_eq!(method_status, "disabled");
    assert!(account_disabled.is_some());
    let (handle, display_name, bio): (String, String, String) = sqlx::query_as(
        "SELECT handle, display_name, bio FROM profile_public WHERE profile_id = $1",
    )
    .bind(profile_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(handle.starts_with("former-member-"));
    assert_eq!(display_name, pseudonym);
    assert!(bio.is_empty());
    let redacted_name: String = sqlx::query_scalar(
        "SELECT replacement_public_name FROM game_persona_redaction WHERE game_id = $1 AND persona_id = 'gp_test'",
    )
    .bind(game_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(redacted_name, pseudonym);
    let pending_kinds: Vec<String> = sqlx::query_scalar(
        "SELECT kind FROM member_lifecycle_event WHERE principal_user_id = $1 ORDER BY seq",
    )
    .bind(principal.as_str())
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
        "SELECT status, pseudonym FROM member_lifecycle_projection WHERE principal_user_id = $1",
    )
    .bind(principal.as_str())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(terminal.0, "erased");
    assert_eq!(terminal.1.as_deref(), Some(pseudonym.as_str()));
    let kinds: Vec<String> = sqlx::query_scalar(
        "SELECT kind FROM member_lifecycle_event WHERE principal_user_id = $1 ORDER BY seq",
    )
    .bind(principal.as_str())
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
    // Simulate a normal profile/game projection rebuild restoring source facts;
    // lifecycle rebuild must reapply the retained-data overlay deterministically.
    sqlx::query("UPDATE profile_public SET handle = 'erase-me', display_name = 'Alicia', bio = 'private bio' WHERE profile_id = $1")
        .bind(profile_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE profile_editor SET principal_user_id = $2 WHERE profile_id = $1")
        .bind(profile_id)
        .bind(principal.as_str())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE game_persona_private SET principal_user_id = $2 WHERE game_id = $1 AND persona_id = 'gp_test'")
        .bind(game_id)
        .bind(principal.as_str())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE game_persona_public SET current_public_name = 'Alicia' WHERE game_id = $1 AND persona_id = 'gp_test'")
        .bind(game_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM game_persona_redaction WHERE game_id = $1 AND persona_id = 'gp_test'")
        .bind(game_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM member_lifecycle_projection WHERE principal_user_id = $1")
        .bind(principal.as_str())
        .execute(&pool)
        .await
        .unwrap();

    let rebuilt = identity::rebuild_member_lifecycle(&pool, principal.as_str())
        .await
        .unwrap();
    assert_eq!(rebuilt.status, identity::MemberLifecycleStatus::Erased);
    assert_eq!(rebuilt.last_seq, 5);
    assert_eq!(rebuilt.pseudonym.as_deref(), Some(pseudonym.as_str()));
    let rebuilt_profile_name: String =
        sqlx::query_scalar("SELECT display_name FROM profile_public WHERE profile_id = $1")
            .bind(profile_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(rebuilt_profile_name, pseudonym);
    let rebuilt_persona_name: String = sqlx::query_scalar(
        "SELECT current_public_name FROM game_persona_public WHERE game_id = $1 AND persona_id = 'gp_test'",
    )
    .bind(game_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rebuilt_persona_name, pseudonym);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn account_recovery_waits_at_owner_boundary_before_erasure(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let account_id = "recovery-race@example.test";
    let password = "correct horse battery staple";
    let (principal, token) = register_classic_account(&app, account_id, password).await;
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
    sqlx::query(
        "SELECT principal_user_id FROM platform_principal WHERE principal_user_id = $1 FOR UPDATE",
    )
    .bind(&principal)
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
    let erasure_principal = principal.clone();
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
    assert_erased_without_eligible_sessions(&pool, &principal).await;
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn invite_redemption_waits_at_owner_boundary_before_erasure(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root).with_dev_auth(true));
    let account_id = "invite-race@example.test";
    let password = "correct horse battery staple";
    let invite_token = "invite-erasure-race-token";
    let (principal, _) = register_classic_account(&app, account_id, password).await;
    let admin_token = issue_dev_admin(&app, "invite-race-admin").await;
    let response = post_json(
        &app,
        "/auth/invites",
        Some(&admin_token),
        serde_json::json!({
            "invite_token": invite_token,
            "account_id": account_id,
            "expected_principal_user_id": principal,
            "expires_at": unix_now_seconds() + 3600,
            "global_capabilities": []
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let invite_hash = identity::token::hash_token(invite_token);

    let mut owner_gate = pool.begin().await.unwrap();
    sqlx::query(
        "SELECT principal_user_id FROM platform_principal WHERE principal_user_id = $1 FOR UPDATE",
    )
    .bind(&principal)
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
            "/auth/invites/redeem",
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
    sqlx::query("SELECT token_hash FROM auth_invite WHERE token_hash = $1 FOR UPDATE NOWAIT")
        .bind(&invite_hash)
        .execute(&mut *probe)
        .await
        .unwrap();
    probe.rollback().await.unwrap();

    let erasure_pool = pool.clone();
    let erasure_principal = principal.clone();
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
    assert_erased_without_eligible_sessions(&pool, &principal).await;
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn account_disable_waits_at_owner_boundary_before_erasure(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root).with_dev_auth(true));
    let account_id = "disable-race@example.test";
    let (principal, _) =
        register_classic_account(&app, account_id, "correct horse battery staple").await;
    let admin_token = issue_dev_admin(&app, "disable-race-admin").await;

    let mut owner_gate = pool.begin().await.unwrap();
    sqlx::query(
        "SELECT principal_user_id FROM platform_principal WHERE principal_user_id = $1 FOR UPDATE",
    )
    .bind(&principal)
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
    let erasure_principal = principal.clone();
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
    assert_erased_without_eligible_sessions(&pool, &principal).await;
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn session_rotation_waits_at_owner_boundary_before_erasure(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let (principal, token) = register_classic_account(
        &app,
        "session-race@example.test",
        "correct horse battery staple",
    )
    .await;
    let token_hash = identity::token::hash_token(&token);

    let mut owner_gate = pool.begin().await.unwrap();
    sqlx::query(
        "SELECT principal_user_id FROM platform_principal WHERE principal_user_id = $1 FOR UPDATE",
    )
    .bind(&principal)
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
    let erasure_principal = principal.clone();
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
    assert_erased_without_eligible_sessions(&pool, &principal).await;
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn lifecycle_rebuild_locks_owner_before_projection_and_erasure(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));
    let (principal, _) = register_classic_account(
        &app,
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
    sqlx::query(
        "SELECT principal_user_id FROM platform_principal WHERE principal_user_id = $1 FOR UPDATE",
    )
    .bind(&principal)
    .execute(&mut *owner_gate)
    .await
    .unwrap();
    let rebuild_pool = pool.clone();
    let rebuild_principal = principal.clone();
    let rebuild = tokio::spawn(async move {
        identity::rebuild_member_lifecycle(&rebuild_pool, &rebuild_principal).await
    });
    wait_for_owner_lock_waiters(&pool, 1).await;

    // Rebuild cannot read and hold a stale projection before owner
    // serialization; otherwise erasure could commit and then be overwritten.
    let mut probe = pool.begin().await.unwrap();
    sqlx::query("SELECT principal_user_id FROM member_lifecycle_projection WHERE principal_user_id = $1 FOR UPDATE NOWAIT")
        .bind(&principal)
        .execute(&mut *probe)
        .await
        .unwrap();
    probe.rollback().await.unwrap();

    let erasure_pool = pool.clone();
    let erasure_principal = principal.clone();
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
    assert_erased_without_eligible_sessions(&pool, &principal).await;
}
