use axum::body::{to_bytes, Body};
use axum::http::{header::AUTHORIZATION, Request, StatusCode};
use sha2::{Digest, Sha256};
use tower::ServiceExt;
use uuid::Uuid;
use wire::{RejectCode, RejectMsg};

fn app(pool: sqlx::PgPool) -> axum::Router {
    operator_api::router_with_state(operator_api::OperatorApiState::new(pool))
}

fn token_hash(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

async fn create_session(pool: &sqlx::PgPool, token: &str, user: &str, globals: &[&str]) {
    sqlx::query(
        "INSERT INTO platform_principal (principal_user_id, status, global_capabilities, created_at) \
         VALUES ($1, 'active', $2, 0) ON CONFLICT (principal_user_id) DO UPDATE SET global_capabilities = EXCLUDED.global_capabilities",
    )
    .bind(user)
    .bind(globals)
    .execute(pool)
    .await
    .expect("insert operator principal");
    sqlx::query(
        "INSERT INTO auth_session \
         (token_hash, principal_user_id, created_at, expires_at, global_capabilities, authenticated_at) \
         VALUES ($1, $2, 0, 4102444800, $3, 0)",
    )
    .bind(token_hash(token))
    .bind(user)
    .bind(globals)
    .execute(pool)
    .await
    .expect("insert operator session");
}

async fn grant_game_authority(pool: &sqlx::PgPool, game: Uuid, user: &str, role: &str) {
    sqlx::query("INSERT INTO game_authority (game_id, user_id, role) VALUES ($1, $2, $3)")
        .bind(game)
        .bind(user)
        .bind(role)
        .execute(pool)
        .await
        .expect("insert game authority");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn operator_routes_are_host_audit_only(pool: sqlx::PgPool) {
    let app = app(pool.clone());
    let game = Uuid::new_v4();
    grant_game_authority(&pool, game, "host_h", "host").await;
    grant_game_authority(&pool, game, "cohost_c", "cohost").await;
    create_session(&pool, "fmss_host-token", "host_h", &[]).await;
    create_session(&pool, "fmss_cohost-token", "cohost_c", &[]).await;
    create_session(&pool, "fmss_outsider-token", "outsider", &[]).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/operator?principal_user_id=outsider"))
                .header(AUTHORIZATION, "Bearer fmss_host-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(html.contains("Operator Index"));
    assert!(html.contains(&format!("/games/{game}/operator/proof-runs")));
    assert!(!html.contains("principal_user_id="));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status?principal_user_id=host_h"
                ))
                .header(AUTHORIZATION, "Bearer fmss_cohost-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    for path in [
        format!("/games/{game}/operator"),
        format!("/games/{game}/operator/proof-runs/status"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(path)
                    .header(AUTHORIZATION, "Bearer fmss_outsider-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(reject.error, RejectCode::NotAuthorized);
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn active_global_operator_session_can_read_status_without_dev_auth(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    create_session(&pool, "fmss_admin-token", "admin_a", &["GlobalAdmin"]).await;

    let operator = app(pool);
    let response = operator
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status?principal_user_id=outsider"
                ))
                .header(AUTHORIZATION, "Bearer fmss_admin-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = operator
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status?principal_user_id=admin_a"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
