use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use tower::ServiceExt;
use uuid::Uuid;
use wire::{RejectCode, RejectMsg};

fn app(pool: sqlx::PgPool) -> axum::Router {
    operator_api::router_with_state(operator_api::OperatorApiState::new(pool).with_dev_auth(false))
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

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/operator?principal_user_id=host_h"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(html.contains("Operator Index"));
    assert!(html.contains(&format!(
        "/games/{game}/operator/proof-runs?principal_user_id=host_h"
    )));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status?principal_user_id=cohost_c"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    for path in [
        format!("/games/{game}/operator?principal_user_id=outsider"),
        format!("/games/{game}/operator/proof-runs/status?principal_user_id=outsider"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(path)
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
    sqlx::query(
        "INSERT INTO auth_session \
         (token_hash, principal_user_id, created_at, expires_at, global_capabilities) \
         VALUES ('dev-admin-token-hash', 'admin_a', 0, 4102444800, ARRAY['GlobalAdmin']::TEXT[])",
    )
    .execute(&pool)
    .await
    .expect("insert global operator session");

    let enabled = operator_api::router_with_state(
        operator_api::OperatorApiState::new(pool.clone()).with_dev_auth(true),
    );
    let response = enabled
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
    assert_eq!(response.status(), StatusCode::OK);

    let dev_disabled = app(pool);
    let response = dev_disabled
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
    assert_eq!(response.status(), StatusCode::OK);
}
