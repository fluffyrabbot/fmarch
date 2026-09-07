use api::{DatabaseIdentityAttestation, Readiness};
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use media::{MediaLimits, MediaReadLimits, MediaRepository};
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn readyz_proves_schema_and_object_storage(pool: sqlx::PgPool) {
    eventstore::attest_active_runtime_kek(&pool).await.unwrap();
    let media =
        MediaRepository::in_memory(MediaLimits::default(), MediaReadLimits::default()).unwrap();
    let (status, body) =
        readiness(api::router(pool, media, api::ApiRuntimeConfig::default()).unwrap()).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        Readiness {
            ok: true,
            release_commit: api::release_commit().to_string(),
            database_schema: true,
            database_identity: None,
            event_encryption: true,
            object_storage: true,
            subject_authority: true,
            required_workers: true,
            workers: Vec::new(),
        }
    );
}

#[sqlx::test]
async fn readyz_rejects_a_database_without_the_required_schema(pool: sqlx::PgPool) {
    let media =
        MediaRepository::in_memory(MediaLimits::default(), MediaReadLimits::default()).unwrap();
    let (status, body) =
        readiness(api::router(pool, media, api::ApiRuntimeConfig::default()).unwrap()).await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        body,
        Readiness {
            ok: false,
            release_commit: api::release_commit().to_string(),
            database_schema: false,
            database_identity: None,
            event_encryption: false,
            object_storage: true,
            subject_authority: true,
            required_workers: true,
            workers: Vec::new(),
        }
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn readyz_attests_the_actual_database_and_rejects_a_coherent_wrong_target(
    pool: sqlx::PgPool,
) {
    let staging = database_schema::DatabaseEnvironmentIdentity::new(
        "staging",
        "9d285d67-c11b-4508-9efb-fad042787b4c",
        "e109e500-2a4c-48a3-96f2-e92a9edb63e4",
    )
    .unwrap();
    database_schema::bind_database_environment_identity(
        &pool,
        &staging.environment,
        &staging.project_id,
        &staging.environment_id,
    )
    .await
    .unwrap();
    eventstore::attest_active_runtime_kek(&pool).await.unwrap();

    let production = database_schema::DatabaseEnvironmentIdentity::new(
        "production",
        "9d285d67-c11b-4508-9efb-fad042787b4c",
        "c1378737-84cc-45ba-8474-9c868baf7cfb",
    )
    .unwrap();
    let media =
        || MediaRepository::in_memory(MediaLimits::default(), MediaReadLimits::default()).unwrap();
    let wrong_target = api::router_with_state(
        api::ApiState::new(pool.clone(), media(), api::ApiRuntimeConfig::default())
            .unwrap()
            .with_database_environment_identity(production),
    );
    let (status, body) = readiness(wrong_target).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(!body.ok);
    assert_eq!(body.database_identity, None);

    let canonical = api::router_with_state(
        api::ApiState::new(pool.clone(), media(), api::ApiRuntimeConfig::default())
            .unwrap()
            .with_database_environment_identity(staging),
    );
    let (status, body) = readiness(canonical.clone()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body.database_identity,
        Some(DatabaseIdentityAttestation {
            project_id: "9d285d67-c11b-4508-9efb-fad042787b4c".to_string(),
            environment_id: "e109e500-2a4c-48a3-96f2-e92a9edb63e4".to_string(),
            environment: "staging".to_string(),
        })
    );

    let mutation: String = sqlx::query_scalar(
        "SELECT format('COMMENT ON DATABASE %I IS %L', current_database(), $1)",
    )
    .bind("fmarch-database-environment-identity:v1:9d285d67-c11b-4508-9efb-fad042787b4c:c1378737-84cc-45ba-8474-9c868baf7cfb:production")
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(sqlx::AssertSqlSafe(mutation))
        .execute(&pool)
        .await
        .unwrap();
    let (status, body) = readiness(canonical).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(!body.ok);
    assert_eq!(body.database_identity, None);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn readyz_revalidates_subject_authority_after_startup(pool: sqlx::PgPool) {
    eventstore::attest_active_runtime_kek(&pool).await.unwrap();
    let media =
        MediaRepository::in_memory(MediaLimits::default(), MediaReadLimits::default()).unwrap();
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
        api::ApiState::new(pool, media, api::ApiRuntimeConfig::default())
            .unwrap()
            .with_subject_key_store(Arc::new(authority)),
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn readyz_rejects_a_direct_envelope_kid_missing_from_the_configured_ring(pool: sqlx::PgPool) {
    eventstore::attest_active_runtime_kek(&pool).await.unwrap();
    sqlx::query(
        r#"
        INSERT INTO event_direct_key_sentinel (
            kid, sentinel_version, sentinel_nonce, sentinel_ciphertext
        ) VALUES ('missing-readiness-kid', 1,
                  decode(repeat('00', 24), 'hex'), decode(repeat('00', 56), 'hex'))
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let media =
        MediaRepository::in_memory(MediaLimits::default(), MediaReadLimits::default()).unwrap();
    let (status, body) =
        readiness(api::router(pool, media, api::ApiRuntimeConfig::default()).unwrap()).await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(!body.ok);
    assert!(body.database_schema);
    assert!(!body.event_encryption);
    assert!(body.object_storage);
    assert!(body.subject_authority);
}
