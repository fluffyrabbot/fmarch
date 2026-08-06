use api::Readiness;
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use media::{MediaLimits, MediaRepository};
use tower::ServiceExt;

async fn readiness(app: axum::Router) -> (StatusCode, Readiness) {
    let response = app
        .oneshot(Request::get("/readyz").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn readyz_proves_schema_and_object_storage(pool: sqlx::PgPool) {
    let media = MediaRepository::in_memory(MediaLimits::default()).unwrap();
    let (status, body) = readiness(api::router(pool, media)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        Readiness {
            ok: true,
            database_schema: true,
            object_storage: true,
        }
    );
}

#[sqlx::test]
async fn readyz_rejects_a_database_without_the_required_schema(pool: sqlx::PgPool) {
    let media = MediaRepository::in_memory(MediaLimits::default()).unwrap();
    let (status, body) = readiness(api::router(pool, media)).await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        body,
        Readiness {
            ok: false,
            database_schema: false,
            object_storage: true,
        }
    );
}
