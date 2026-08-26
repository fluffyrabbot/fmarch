use identity::workos::{attach_subject, resolve_subject};
use identity::{methods, MethodKind, PrincipalId, VerifiedIdentity, WorkosSessionId};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

fn verified(subject: String) -> VerifiedIdentity {
    VerifiedIdentity {
        subject,
        session_id: WorkosSessionId::parse("session_01HQAG1HENBZMAZD82YRXDFC0B").unwrap(),
        expires_at: 4_102_444_800,
        email: Some("workos-proof@example.test".to_string()),
    }
}

async fn seed_workos_identity(
    pool: &PgPool,
    disabled: bool,
) -> (PrincipalId, String, Uuid, VerifiedIdentity) {
    let principal_id = PrincipalId::random();
    let assertion = verified(format!("workos-{}", Uuid::new_v4().simple()));
    let mut tx = pool.begin().await.unwrap();
    methods::ensure_principal(&mut tx, &principal_id, &[], 10)
        .await
        .unwrap();
    let method_id = methods::create_method(&mut tx, &principal_id, MethodKind::Workos, 10)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO external_identity (provider, subject, principal_id, display_label, created_at, last_seen_at, method_id) VALUES ('workos', $1, $2, $3, 10, 10, $4)",
    )
    .bind(assertion.subject.as_str())
    .bind(principal_id.as_uuid())
    .bind(assertion.email.as_deref())
    .bind(method_id)
    .execute(&mut *tx)
    .await
    .unwrap();
    if disabled {
        sqlx::query(
            "UPDATE authentication_method SET status = 'disabled', disabled_at = 11 WHERE method_id = $1",
        )
        .bind(method_id)
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    tx.commit().await.unwrap();
    (
        principal_id,
        assertion.subject.clone(),
        method_id,
        assertion,
    )
}

async fn lock_method_for_erasure_tail<'a>(
    pool: &'a PgPool,
    method_id: Uuid,
) -> Transaction<'a, Postgres> {
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SET LOCAL lock_timeout = '500ms'")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("SELECT method_id FROM authentication_method WHERE method_id = $1 FOR UPDATE")
        .bind(method_id)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx
}

async fn wait_until_authentication_is_lock_blocked(pool: &PgPool, application_name: &str) {
    for _ in 0..1_000 {
        let waiting: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM pg_stat_activity
                WHERE application_name = $1
                  AND wait_event_type = 'Lock'
            )
            "#,
        )
        .bind(application_name)
        .fetch_one(pool)
        .await
        .unwrap();
        if waiting {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("authentication transaction never reached the expected row-lock boundary");
}

async fn name_transaction(tx: &mut Transaction<'_, Postgres>, application_name: &str) {
    sqlx::query_scalar::<_, String>("SELECT set_config('application_name', $1, true)")
        .bind(application_name)
        .fetch_one(&mut **tx)
        .await
        .unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn first_sight_workos_provisions_privacy_subject_before_provider_binding(pool: PgPool) {
    let assertion = verified(format!("first-sight-{}", Uuid::new_v4().simple()));
    let mut tx = pool.begin().await.unwrap();
    let resolution = resolve_subject(&mut tx, &assertion, 100).await.unwrap();

    let ownership = sqlx::query_as::<_, (String, String, Uuid, Uuid)>(
        r#"
        SELECT subject.lifecycle_state, method.kind, method.method_id, identity.method_id
        FROM platform_principal AS principal
        JOIN privacy_subject AS subject
          ON subject.principal_id = principal.principal_id
        JOIN authentication_method AS method
          ON method.principal_id = principal.principal_id
        JOIN external_identity AS identity
          ON identity.principal_id = principal.principal_id
        WHERE principal.principal_id = $1
          AND identity.provider = 'workos'
          AND identity.subject = $2
        "#,
    )
    .bind(resolution.principal_id.as_uuid())
    .bind(assertion.subject.as_str())
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    assert_eq!(ownership.0, "active");
    assert_eq!(ownership.1, "workos");
    assert_eq!(ownership.2, resolution.method_id);
    assert_eq!(ownership.3, resolution.method_id);
    tx.commit().await.unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_sign_in_locks_method_before_external_identity_erasure_tail(pool: PgPool) {
    let (principal_id, subject, method_id, assertion) = seed_workos_identity(&pool, false).await;
    let mut erasure_tail = lock_method_for_erasure_tail(&pool, method_id).await;
    let application_name = format!("workos-sign-in-{}", Uuid::new_v4().simple());

    let auth_pool = pool.clone();
    let auth_application_name = application_name.clone();
    let authentication = tokio::spawn(async move {
        let mut tx = auth_pool.begin().await.unwrap();
        name_transaction(&mut tx, auth_application_name.as_str()).await;
        let result = resolve_subject(&mut tx, &assertion, 100).await;
        tx.rollback().await.unwrap();
        result
    });
    wait_until_authentication_is_lock_blocked(&pool, application_name.as_str()).await;

    // Erasure owns M and must be able to advance to E. The former E -> M
    // WorkOS order made this deterministic DELETE time out (and deadlock when
    // both paths waited without a timeout).
    let deleted =
        sqlx::query("DELETE FROM external_identity WHERE provider = 'workos' AND subject = $1")
            .bind(subject.as_str())
            .execute(&mut *erasure_tail)
            .await
            .expect("WorkOS sign-in must not own E while waiting for M");
    assert_eq!(deleted.rows_affected(), 1);
    erasure_tail.commit().await.unwrap();

    assert!(authentication.await.unwrap().is_err());
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM external_identity WHERE principal_id = $1",
        )
        .bind(principal_id.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        0,
        "the stale provider assertion must not resurrect the erased binding",
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn workos_attach_locks_method_before_external_identity_erasure_tail(pool: PgPool) {
    let (principal_id, subject, method_id, assertion) = seed_workos_identity(&pool, true).await;
    let mut erasure_tail = lock_method_for_erasure_tail(&pool, method_id).await;
    let application_name = format!("workos-attach-{}", Uuid::new_v4().simple());

    let auth_pool = pool.clone();
    let auth_application_name = application_name.clone();
    let attached_principal = principal_id;
    let authentication = tokio::spawn(async move {
        let mut tx = auth_pool.begin().await.unwrap();
        name_transaction(&mut tx, auth_application_name.as_str()).await;
        let result = attach_subject(&mut tx, &assertion, &attached_principal, 100).await;
        tx.rollback().await.unwrap();
        result
    });
    wait_until_authentication_is_lock_blocked(&pool, application_name.as_str()).await;

    let deleted =
        sqlx::query("DELETE FROM external_identity WHERE provider = 'workos' AND subject = $1")
            .bind(subject.as_str())
            .execute(&mut *erasure_tail)
            .await
            .expect("WorkOS attach must not own E while waiting for M");
    assert_eq!(deleted.rows_affected(), 1);
    erasure_tail.commit().await.unwrap();

    assert!(authentication.await.unwrap().is_err());
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT status FROM authentication_method WHERE method_id = $1",
        )
        .bind(method_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        "disabled",
        "a stale attachment must not reactivate the method after E was erased",
    );
}
