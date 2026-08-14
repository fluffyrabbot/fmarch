use api::Readiness;
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use media::{MediaLimits, MediaRepository};
use object_store::path::Path as ObjectPath;
use object_store::{ObjectStore, ObjectStoreExt};
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

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
            event_encryption: true,
            object_storage: true,
            subject_authority: true,
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
            event_encryption: false,
            object_storage: true,
            subject_authority: true,
        }
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn readyz_revalidates_subject_authority_after_startup(pool: sqlx::PgPool) {
    let media = MediaRepository::in_memory(MediaLimits::default()).unwrap();
    let backing: Arc<dyn ObjectStore> = Arc::new(object_store::memory::InMemory::new());
    let authority = identity::ObjectSubjectKeyStore::new(
        Arc::clone(&backing),
        "readiness-revision",
        Uuid::new_v4(),
        "readiness-wrap-v1",
        [17_u8; 32],
        "readiness-journal-v1",
        [19_u8; 32],
    );
    authority.bootstrap().await.unwrap();
    let app = api::router_with_state(
        api::ApiState::new(pool, media).with_subject_key_store(Arc::new(authority)),
    );
    assert_eq!(readiness(app.clone()).await.0, StatusCode::OK);

    backing
        .delete(&ObjectPath::from(
            "fmarch-subject-authority/v1/authority.json",
        ))
        .await
        .unwrap();
    let (status, body) = readiness(app).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(!body.ok);
    assert!(body.database_schema);
    assert!(body.event_encryption);
    assert!(body.object_storage);
    assert!(!body.subject_authority);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn readyz_rejects_an_event_kid_missing_from_the_configured_ring(pool: sqlx::PgPool) {
    sqlx::query(
        r#"
        INSERT INTO events (
            stream_id, stream_seq, kind, version, occurred_at,
            sealed_version, sealed_kid, sealed_nonce, sealed_body
        ) VALUES ($1, 1, 'CoverageCanary', 1, 1, 2, 'missing-readiness-kid',
                  decode(repeat('00', 24), 'hex'), decode(repeat('00', 16), 'hex'))
        "#,
    )
    .bind(Uuid::new_v4())
    .execute(&pool)
    .await
    .unwrap();
    let media = MediaRepository::in_memory(MediaLimits::default()).unwrap();
    let (status, body) = readiness(api::router(pool, media)).await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(!body.ok);
    assert!(body.database_schema);
    assert!(!body.event_encryption);
    assert!(body.object_storage);
    assert!(body.subject_authority);
}
