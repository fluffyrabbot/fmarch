//! Proofs for the authentication-method identity model: backend-issued
//! app-session tokens, principal/method rows on classic write paths, the lazy
//! upgrade of pre-refactor accounts, the WorkOS session exchange, method
//! management invariants, and bearer dispatch.

use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use api::ApiState;
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
    assert!(identity::token::is_app_session_token(session_token.as_str()));
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
    assert_eq!(body["principal_user_id"].as_str(), Some(principal_user_id.as_str()));
    assert!(body.get("session_token").is_none());
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn login_issues_backend_token_and_lazily_upgrades_legacy_accounts(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let app = api::router_with_state(test_state(pool.clone(), &root));

    let password = "correct horse battery staple";
    let password_hash = identity::password::hash_password_sync(password).unwrap();
    sqlx::query(
        "INSERT INTO auth_account (account_id, principal_user_id, password_hash, created_at, disabled_at, global_capabilities) VALUES ($1, $2, $3, 1, NULL, '{}')",
    )
    .bind("legacy-player@example.test")
    .bind("legacy-player-principal")
    .bind(password_hash)
    .execute(&pool)
    .await
    .unwrap();

    let response = post_json(
        &app,
        "/auth/accounts/login",
        None,
        serde_json::json!({
            "account_id": "legacy-player@example.test",
            "password": password
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let session_token = body["session_token"].as_str().unwrap().to_string();
    assert!(identity::token::is_app_session_token(session_token.as_str()));
    assert!(body["expires_at"].as_i64().unwrap() > 0);

    let (principal_status, method_id, method_kind, _) =
        classic_identity_rows(&pool, "legacy-player@example.test").await;
    assert_eq!(principal_status, "active");
    assert_eq!(method_kind, "classic_password");
    let (session_method, session_assurance) = session_row(&pool, session_token.as_str()).await;
    assert_eq!(session_method, Some(method_id));
    assert_eq!(session_assurance.as_deref(), Some("password"));

    let response = get_session(&app, session_token.as_str()).await;
    assert_eq!(response.status(), StatusCode::OK);

    let second_login = post_json(
        &app,
        "/auth/accounts/login",
        None,
        serde_json::json!({
            "account_id": "legacy-player@example.test",
            "password": password
        }),
    )
    .await;
    assert_eq!(second_login.status(), StatusCode::OK);
    let (_, second_method_id, _, _) =
        classic_identity_rows(&pool, "legacy-player@example.test").await;
    assert_eq!(second_method_id, method_id);
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
    assert!(identity::token::is_app_session_token(granted_token.as_str()));
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
    assert!(identity::token::is_app_session_token(rotated_token.as_str()));
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
        .with_access_token_verifier(Arc::new(workos_verifier("workos-token", "user_convert")));
    let app = api::router_with_state(state);

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
    assert_eq!(session_a["principal_user_id"].as_str().unwrap(), principal_user_id);

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
    assert_eq!(added["principal_user_id"].as_str().unwrap(), principal_user_id);
    let recovery_codes: Vec<String> = added["recovery_codes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|code| code.as_str().unwrap().to_string())
        .collect();
    assert_eq!(recovery_codes.len(), 3);

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

    // Sign in through classic: same principal, identical capabilities.
    let response = post_json(
        &app,
        "/auth/sessions",
        None,
        serde_json::json!({
            "method": "classic",
            "login_name": "converted@example.test",
            "password": "correct horse battery staple"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let classic_session = body["session_token"].as_str().unwrap().to_string();
    assert_eq!(body["principal_user_id"].as_str().unwrap(), principal_user_id);
    let (status, session_b) = get_json(&app, "/auth/session", classic_session.as_str()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(session_a["principal_user_id"], session_b["principal_user_id"]);
    assert_eq!(session_a["capabilities"], session_b["capabilities"]);

    // Enumerate methods, then disconnect WorkOS under the classic session.
    let (status, methods) =
        get_json(&app, "/auth/account/methods", classic_session.as_str()).await;
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
    assert!(audit_kinds.iter().any(|kind| kind == "session_created"));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn provider_jwts_and_random_bearers_are_never_general_credentials(pool: sqlx::PgPool) {
    let root = TempDir::new().unwrap();
    let state = test_state(pool.clone(), &root)
        .with_access_token_verifier(Arc::new(workos_verifier("workos-token", "user_dispatch")));
    let app = api::router_with_state(state);

    for bearer in ["workos-token", "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.sig", "fmss_unknown"] {
        let (status, _) = get_json(&app, "/auth/session", bearer).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "bearer {bearer} must not authenticate");
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
