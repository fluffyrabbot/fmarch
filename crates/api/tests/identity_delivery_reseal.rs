use api::identity_delivery::{
    count_delivery_credential_envelopes_by_kid, delivery_aad,
    reseal_identity_delivery_credentials_batch, IdentityDeliveryKind,
};
use principal::PrincipalId;
use serde_json::Value;
use sqlx::{PgPool, Postgres, Transaction};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use uuid::Uuid;

static ENCRYPTION_ENV_LOCK: Mutex<()> = Mutex::new(());

struct EncryptionEnvGuard {
    prior_key: Option<String>,
    prior_kid: Option<String>,
    prior_keys: Option<String>,
    _lock: MutexGuard<'static, ()>,
}

impl EncryptionEnvGuard {
    fn new() -> Self {
        let lock = ENCRYPTION_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let guard = Self {
            prior_key: std::env::var("FMARCH_EVENT_WRAP_KEY").ok(),
            prior_kid: std::env::var("FMARCH_EVENT_WRAP_KID").ok(),
            prior_keys: std::env::var("FMARCH_EVENT_WRAP_KEYS").ok(),
            _lock: lock,
        };
        std::env::remove_var("FMARCH_EVENT_WRAP_KEY");
        std::env::remove_var("FMARCH_EVENT_WRAP_KID");
        std::env::remove_var("FMARCH_EVENT_WRAP_KEYS");
        guard
    }

    fn set_active(&self, kid: &str, key: &str) {
        std::env::set_var("FMARCH_EVENT_WRAP_KID", kid);
        std::env::set_var("FMARCH_EVENT_WRAP_KEY", key);
        std::env::remove_var("FMARCH_EVENT_WRAP_KEYS");
    }

    fn set_active_with_prior_key(&self, kid: &str, key: &str, prior_kid: &str, prior_key: &str) {
        self.set_active(kid, key);
        std::env::set_var("FMARCH_EVENT_WRAP_KEYS", format!("{prior_kid}={prior_key}"));
    }
}

impl Drop for EncryptionEnvGuard {
    fn drop(&mut self) {
        restore_env("FMARCH_EVENT_WRAP_KEY", &self.prior_key);
        restore_env("FMARCH_EVENT_WRAP_KID", &self.prior_kid);
        restore_env("FMARCH_EVENT_WRAP_KEYS", &self.prior_keys);
    }
}

fn restore_env(name: &str, value: &Option<String>) {
    match value {
        Some(value) => std::env::set_var(name, value),
        None => std::env::remove_var(name),
    }
}

#[derive(Clone, Copy)]
enum DeliveryState {
    Queued,
    Retryable,
    Processing,
    Cancelled,
}

async fn seed_account(pool: &PgPool) {
    let principal_id = PrincipalId::fixture("reseal-user");
    let mut connection = pool.acquire().await.unwrap();
    identity::methods::ensure_principal(&mut connection, &principal_id, &[], 1)
        .await
        .unwrap();
    let method_id = identity::methods::create_method(
        &mut connection,
        &principal_id,
        identity::MethodKind::ClassicPassword,
        1,
    )
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO auth_account \
         (account_id, principal_id, method_id, password_hash, created_at, global_capabilities) \
         VALUES ('reseal@example.test', $1, $2, 'unused', 1, '{}')",
    )
    .bind(principal_id.as_uuid())
    .bind(method_id)
    .execute(&mut *connection)
    .await
    .unwrap();
}

async fn seed_delivery(
    tx: &mut Transaction<'_, Postgres>,
    delivery_id: Uuid,
    kind: IdentityDeliveryKind,
    state: DeliveryState,
    credential: &str,
) {
    let principal_id = PrincipalId::fixture("reseal-user");
    let envelope = if matches!(state, DeliveryState::Cancelled) {
        None
    } else {
        Some(
            eventstore::encrypt_delivery_credential(
                tx,
                credential,
                &delivery_aad(delivery_id, kind),
            )
            .await
            .unwrap(),
        )
    };
    let (status, outcome_kind, outcome_code, next_attempt_at, claim_token, claim_expires_at) =
        match state {
            DeliveryState::Queued => ("queued", "queued", None, Some(100), None, None),
            DeliveryState::Retryable => (
                "retryable_failed",
                "retryable_failure",
                Some("provider_unavailable"),
                Some(100),
                None,
                None,
            ),
            DeliveryState::Processing => (
                "processing",
                "processing",
                None,
                None,
                Some(Uuid::new_v4()),
                Some(200),
            ),
            DeliveryState::Cancelled => (
                "cancelled",
                "cancelled",
                Some("credential_inactive"),
                None,
                None,
                None,
            ),
        };
    sqlx::query(
        r#"
        INSERT INTO auth_delivery_intent (
            delivery_id, delivery_kind, account_id, principal_id,
            credential_hash, credential_expires_at, credential_envelope,
            status, attempt_count, next_attempt_at, delivered_at, last_error,
            created_at, updated_at, provider_id, outcome_kind, outcome_code,
            provider_receipt_id, claim_token, claim_expires_at
        )
        VALUES (
            $1, $2, 'reseal@example.test', $3, $4, 1_000, $5,
            $6, 0, $7, NULL, $8, 10, 10, 'local-deterministic', $9, $8,
            NULL, $10, $11
        )
        "#,
    )
    .bind(delivery_id)
    .bind(kind.as_str())
    .bind(principal_id.as_uuid())
    .bind(format!("hash-{delivery_id}"))
    .bind(envelope)
    .bind(status)
    .bind(next_attempt_at)
    .bind(outcome_code)
    .bind(outcome_kind)
    .bind(claim_token)
    .bind(claim_expires_at)
    .execute(&mut **tx)
    .await
    .unwrap();
}

async fn begin_retirement(env: &EncryptionEnvGuard, pool: &PgPool) {
    env.set_active_with_prior_key(
        "delivery-new",
        "new delivery envelope key material",
        "delivery-old",
        "old delivery envelope key material",
    );
    eventstore::attest_active_runtime_kek(pool).await.unwrap();
    eventstore::begin_runtime_kek_retirement(pool, "delivery-old", "delivery-new")
        .await
        .unwrap();
}

async fn operational_state(pool: &PgPool) -> Vec<Value> {
    sqlx::query_scalar(
        r#"
        SELECT jsonb_build_object(
            'delivery_id', delivery_id,
            'status', status,
            'outcome_kind', outcome_kind,
            'outcome_code', outcome_code,
            'attempt_count', attempt_count,
            'next_attempt_at', next_attempt_at,
            'claim_token', claim_token,
            'claim_expires_at', claim_expires_at,
            'updated_at', updated_at
        )
        FROM auth_delivery_intent
        ORDER BY delivery_id
        "#,
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn reseal_batch_preserves_delivery_states_and_resumes_after_interruption(pool: PgPool) {
    let env = EncryptionEnvGuard::new();
    env.set_active("delivery-old", "old delivery envelope key material");
    seed_account(&pool).await;

    let deliveries = [
        (
            Uuid::from_u128(1),
            IdentityDeliveryKind::Invite,
            DeliveryState::Queued,
            "queued-secret",
        ),
        (
            Uuid::from_u128(2),
            IdentityDeliveryKind::Recovery,
            DeliveryState::Retryable,
            "retryable-secret",
        ),
        (
            Uuid::from_u128(3),
            IdentityDeliveryKind::Invite,
            DeliveryState::Processing,
            "processing-secret",
        ),
        (
            Uuid::from_u128(4),
            IdentityDeliveryKind::Recovery,
            DeliveryState::Cancelled,
            "must-not-exist",
        ),
    ];
    let mut seed = pool.begin().await.unwrap();
    for (delivery_id, kind, state, credential) in deliveries {
        seed_delivery(&mut seed, delivery_id, kind, state, credential).await;
    }
    seed.commit().await.unwrap();
    let state_before = operational_state(&pool).await;
    assert_eq!(
        count_delivery_credential_envelopes_by_kid(&pool, "delivery-old")
            .await
            .unwrap(),
        3
    );

    begin_retirement(&env, &pool).await;
    let interrupted = reseal_identity_delivery_credentials_batch(&pool, "delivery-old", 2)
        .await
        .unwrap();
    assert_eq!(interrupted.examined, 2);
    assert_eq!(interrupted.resealed, 2);
    assert!(interrupted.batch_full);

    let resumed = reseal_identity_delivery_credentials_batch(&pool, "delivery-old", 2)
        .await
        .unwrap();
    assert_eq!(resumed.examined, 1);
    assert_eq!(resumed.resealed, 1);
    assert!(!resumed.batch_full);
    assert_eq!(
        count_delivery_credential_envelopes_by_kid(&pool, "delivery-old")
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        reseal_identity_delivery_credentials_batch(&pool, "delivery-old", 2)
            .await
            .unwrap(),
        api::identity_delivery::IdentityDeliveryCredentialResealBatchReport {
            examined: 0,
            resealed: 0,
            batch_full: false,
        }
    );
    assert_eq!(operational_state(&pool).await, state_before);

    let rows: Vec<(Uuid, String, Option<Value>, Option<String>)> = sqlx::query_as(
        "SELECT delivery_id, delivery_kind, credential_envelope, credential_envelope_kid \
         FROM auth_delivery_intent ORDER BY delivery_id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    for ((delivery_id, kind, _, expected_credential), (_, _, envelope, kid)) in
        deliveries.into_iter().zip(rows)
    {
        if expected_credential == "must-not-exist" {
            assert!(envelope.is_none());
            assert!(kid.is_none());
            continue;
        }
        assert_eq!(kid.as_deref(), Some("delivery-new"));
        assert_eq!(
            eventstore::decrypt_delivery_credential(
                envelope.as_ref().unwrap(),
                &delivery_aad(delivery_id, kind),
            )
            .unwrap(),
            expected_credential
        );
    }
    assert_eq!(
        count_delivery_credential_envelopes_by_kid(&pool, "delivery-new")
            .await
            .unwrap(),
        3
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn locked_claim_cancel_and_erasure_are_skipped_without_resurrection(pool: PgPool) {
    let env = EncryptionEnvGuard::new();
    env.set_active("delivery-old", "old delivery envelope key material");
    seed_account(&pool).await;
    let claimed_id = Uuid::from_u128(11);
    let cancelled_id = Uuid::from_u128(12);
    let erased_id = Uuid::from_u128(13);
    let mut seed = pool.begin().await.unwrap();
    for (delivery_id, credential) in [
        (claimed_id, "claimed-secret"),
        (cancelled_id, "cancelled-secret"),
        (erased_id, "erased-secret"),
    ] {
        seed_delivery(
            &mut seed,
            delivery_id,
            IdentityDeliveryKind::Invite,
            DeliveryState::Queued,
            credential,
        )
        .await;
    }
    seed.commit().await.unwrap();
    begin_retirement(&env, &pool).await;

    let claim_token = Uuid::new_v4();
    let mut lifecycle = pool.begin().await.unwrap();
    sqlx::query(
        "UPDATE auth_delivery_intent \
         SET status = 'processing', outcome_kind = 'processing', next_attempt_at = NULL, \
             claim_token = $2, claim_expires_at = 200 \
         WHERE delivery_id = $1",
    )
    .bind(claimed_id)
    .bind(claim_token)
    .execute(&mut *lifecycle)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE auth_delivery_intent \
         SET status = 'cancelled', outcome_kind = 'cancelled', \
             outcome_code = 'credential_inactive', next_attempt_at = NULL, \
             last_error = 'credential_inactive', credential_envelope = NULL \
         WHERE delivery_id = $1",
    )
    .bind(cancelled_id)
    .execute(&mut *lifecycle)
    .await
    .unwrap();
    sqlx::query("DELETE FROM auth_delivery_intent WHERE delivery_id = $1")
        .bind(erased_id)
        .execute(&mut *lifecycle)
        .await
        .unwrap();

    let batch_pool = pool.clone();
    let skipped = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::spawn(async move {
            reseal_identity_delivery_credentials_batch(&batch_pool, "delivery-old", 10).await
        }),
    )
    .await
    .expect("SKIP LOCKED batch must not wait for lifecycle locks")
    .unwrap()
    .unwrap();
    assert_eq!(skipped.examined, 0);
    assert_eq!(skipped.resealed, 0);
    assert!(!skipped.batch_full);
    assert_eq!(
        count_delivery_credential_envelopes_by_kid(&pool, "delivery-old")
            .await
            .unwrap(),
        3,
        "the explicit census must conservatively retain every locked old reference"
    );

    lifecycle.commit().await.unwrap();
    let resumed = reseal_identity_delivery_credentials_batch(&pool, "delivery-old", 10)
        .await
        .unwrap();
    assert_eq!(resumed.examined, 1);
    assert_eq!(resumed.resealed, 1);
    assert!(!resumed.batch_full);
    assert_eq!(
        count_delivery_credential_envelopes_by_kid(&pool, "delivery-old")
            .await
            .unwrap(),
        0
    );

    let claimed: (String, Option<Uuid>, Option<Value>, Option<String>) = sqlx::query_as(
        "SELECT status, claim_token, credential_envelope, credential_envelope_kid \
         FROM auth_delivery_intent WHERE delivery_id = $1",
    )
    .bind(claimed_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(claimed.0, "processing");
    assert_eq!(claimed.1, Some(claim_token));
    assert_eq!(claimed.3.as_deref(), Some("delivery-new"));
    assert_eq!(
        eventstore::decrypt_delivery_credential(
            claimed.2.as_ref().unwrap(),
            &delivery_aad(claimed_id, IdentityDeliveryKind::Invite),
        )
        .unwrap(),
        "claimed-secret"
    );

    let cancelled: (String, Option<Value>, Option<String>) = sqlx::query_as(
        "SELECT status, credential_envelope, credential_envelope_kid \
         FROM auth_delivery_intent WHERE delivery_id = $1",
    )
    .bind(cancelled_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cancelled, ("cancelled".to_string(), None, None));
    let erased_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM auth_delivery_intent WHERE delivery_id = $1)",
    )
    .bind(erased_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!erased_exists);
}
