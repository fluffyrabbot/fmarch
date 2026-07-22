use eventstore::decrypt_delivery_credential;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::postgres::PgPool;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{fmt, fmt::Formatter, future::Future, pin::Pin};
use thiserror::Error;
use uuid::Uuid;

pub const LOCAL_DETERMINISTIC_PROVIDER_ID: &str = "local-deterministic";
pub const HTTP_JSON_PROVIDER_DEFAULT_ID: &str = "http-json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityDeliveryKind {
    Invite,
    Recovery,
}

impl IdentityDeliveryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Invite => "invite",
            Self::Recovery => "recovery",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "invite" => Some(Self::Invite),
            "recovery" => Some(Self::Recovery),
            _ => None,
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct IdentityDeliveryAttempt {
    pub delivery_id: Uuid,
    pub kind: IdentityDeliveryKind,
    pub account_id: String,
    pub principal_user_id: String,
    pub credential_hash: String,
    pub credential_expires_at: i64,
    pub credential_material: Option<String>,
    pub attempt_number: i32,
}

impl fmt::Debug for IdentityDeliveryAttempt {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("IdentityDeliveryAttempt")
            .field("delivery_id", &self.delivery_id)
            .field("kind", &self.kind)
            .field("account_id", &self.account_id)
            .field("principal_user_id", &self.principal_user_id)
            .field("credential_hash", &self.credential_hash)
            .field("credential_expires_at", &self.credential_expires_at)
            .field(
                "credential_material",
                &self.credential_material.as_ref().map(|_| "[sealed]"),
            )
            .field("attempt_number", &self.attempt_number)
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityDeliveryFailureCode {
    LocalTransient,
    ProviderUnavailable,
    RecipientRejected,
    CredentialUnavailable,
    CredentialExpired,
}

impl IdentityDeliveryFailureCode {
    fn from_provider_code(code: Option<&str>) -> Self {
        match code {
            Some("recipient_rejected") => Self::RecipientRejected,
            Some("credential_unavailable") => Self::CredentialUnavailable,
            Some("credential_expired") => Self::CredentialExpired,
            _ => Self::ProviderUnavailable,
        }
    }
}

impl IdentityDeliveryFailureCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LocalTransient => "local_transient",
            Self::ProviderUnavailable => "provider_unavailable",
            Self::RecipientRejected => "recipient_rejected",
            Self::CredentialUnavailable => "credential_unavailable",
            Self::CredentialExpired => "credential_expired",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityDeliveryOutcome {
    Delivered { provider_receipt_id: String },
    RetryableFailure(IdentityDeliveryFailureCode),
    PermanentFailure(IdentityDeliveryFailureCode),
}

impl IdentityDeliveryOutcome {
    pub fn status(&self) -> &'static str {
        match self {
            Self::Delivered { .. } => "delivered",
            Self::RetryableFailure(_) => "retryable_failed",
            Self::PermanentFailure(_) => "permanent_failed",
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::Delivered { .. } => "delivered",
            Self::RetryableFailure(_) => "retryable_failure",
            Self::PermanentFailure(_) => "permanent_failure",
        }
    }

    pub fn code(&self) -> Option<&'static str> {
        match self {
            Self::Delivered { .. } => None,
            Self::RetryableFailure(code) | Self::PermanentFailure(code) => Some(code.as_str()),
        }
    }

    pub fn retry_after_seconds(&self) -> Option<i64> {
        match self {
            Self::RetryableFailure(_) => Some(1),
            Self::Delivered { .. } | Self::PermanentFailure(_) => None,
        }
    }

    pub fn provider_receipt_id(&self) -> Option<&str> {
        match self {
            Self::Delivered {
                provider_receipt_id,
            } => Some(provider_receipt_id.as_str()),
            Self::RetryableFailure(_) | Self::PermanentFailure(_) => None,
        }
    }
}

pub type IdentityDeliveryFuture<'a> =
    Pin<Box<dyn Future<Output = IdentityDeliveryOutcome> + Send + 'a>>;

pub trait IdentityDeliveryGateway: Send + Sync {
    fn provider_id(&self) -> &str;

    fn deliver<'a>(&'a self, attempt: &'a IdentityDeliveryAttempt) -> IdentityDeliveryFuture<'a>;
}

#[derive(Debug, Clone, Copy)]
pub struct LocalDeterministicIdentityDeliveryGateway {
    fail_first_attempt: bool,
}

impl LocalDeterministicIdentityDeliveryGateway {
    pub fn from_env() -> Self {
        Self {
            fail_first_attempt: std::env::var("FMARCH_LOCAL_DELIVERY_FAIL_FIRST_ATTEMPT")
                .ok()
                .as_deref()
                == Some("1"),
        }
    }

    pub fn new(fail_first_attempt: bool) -> Self {
        Self { fail_first_attempt }
    }
}

impl IdentityDeliveryGateway for LocalDeterministicIdentityDeliveryGateway {
    fn provider_id(&self) -> &str {
        LOCAL_DETERMINISTIC_PROVIDER_ID
    }

    fn deliver<'a>(&'a self, attempt: &'a IdentityDeliveryAttempt) -> IdentityDeliveryFuture<'a> {
        Box::pin(async move {
            if self.fail_first_attempt && attempt.attempt_number == 1 {
                return IdentityDeliveryOutcome::RetryableFailure(
                    IdentityDeliveryFailureCode::LocalTransient,
                );
            }
            IdentityDeliveryOutcome::Delivered {
                provider_receipt_id: format!("local-{}", attempt.delivery_id),
            }
        })
    }
}

#[derive(Clone)]
pub struct HttpJsonIdentityDeliveryGateway {
    provider_id: String,
    endpoint: Url,
    auth_token: Option<String>,
    client: Client,
}

impl HttpJsonIdentityDeliveryGateway {
    pub fn from_env() -> Result<Option<Self>, String> {
        let Some(endpoint) = std::env::var("FMARCH_IDENTITY_DELIVERY_ENDPOINT")
            .ok()
            .filter(|value| !value.trim().is_empty())
        else {
            return Ok(None);
        };
        let endpoint = Url::parse(endpoint.trim())
            .map_err(|error| format!("FMARCH_IDENTITY_DELIVERY_ENDPOINT is invalid: {error}"))?;
        let local_host = matches!(endpoint.host_str(), Some("127.0.0.1" | "localhost"));
        if endpoint.scheme() != "https" && !local_host {
            return Err(
                "FMARCH_IDENTITY_DELIVERY_ENDPOINT must use https outside localhost".to_string(),
            );
        }
        let provider_id = std::env::var("FMARCH_IDENTITY_DELIVERY_PROVIDER_ID")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| HTTP_JSON_PROVIDER_DEFAULT_ID.to_string());
        let auth_token = std::env::var("FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN")
            .ok()
            .filter(|value| !value.trim().is_empty());
        Ok(Some(Self {
            provider_id,
            endpoint,
            auth_token,
            client: Client::new(),
        }))
    }

    pub fn new(
        provider_id: impl Into<String>,
        endpoint: Url,
        auth_token: Option<String>,
        client: Client,
    ) -> Self {
        Self {
            provider_id: provider_id.into(),
            endpoint,
            auth_token,
            client,
        }
    }

    async fn deliver_http(&self, attempt: &IdentityDeliveryAttempt) -> IdentityDeliveryOutcome {
        let Some(credential) = attempt.credential_material.as_deref() else {
            return IdentityDeliveryOutcome::PermanentFailure(
                IdentityDeliveryFailureCode::CredentialUnavailable,
            );
        };
        let request = IdentityDeliveryProviderRequest {
            schema: "fmarch.identity-delivery.v1",
            delivery_id: attempt.delivery_id,
            delivery_kind: attempt.kind.as_str(),
            account_id: &attempt.account_id,
            principal_user_id: &attempt.principal_user_id,
            credential,
            attempt_number: attempt.attempt_number,
            idempotency_key: attempt.delivery_id,
        };
        let mut builder = self.client.post(self.endpoint.clone()).json(&request);
        if let Some(auth_token) = self.auth_token.as_deref() {
            builder = builder.bearer_auth(auth_token);
        }
        let response = match builder.send().await {
            Ok(response) => response,
            Err(_) => {
                return IdentityDeliveryOutcome::RetryableFailure(
                    IdentityDeliveryFailureCode::ProviderUnavailable,
                )
            }
        };
        let status = response.status();
        if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
            return IdentityDeliveryOutcome::RetryableFailure(
                IdentityDeliveryFailureCode::ProviderUnavailable,
            );
        }
        if status.is_client_error() {
            return IdentityDeliveryOutcome::PermanentFailure(
                IdentityDeliveryFailureCode::RecipientRejected,
            );
        }
        let provider_response = match response.json::<IdentityDeliveryProviderResponse>().await {
            Ok(response) => response,
            Err(_) => {
                return IdentityDeliveryOutcome::RetryableFailure(
                    IdentityDeliveryFailureCode::ProviderUnavailable,
                )
            }
        };
        match provider_response.status.as_str() {
            "delivered" => provider_response
                .provider_receipt_id
                .filter(|receipt| !receipt.trim().is_empty())
                .map(|provider_receipt_id| IdentityDeliveryOutcome::Delivered {
                    provider_receipt_id,
                })
                .unwrap_or_else(|| {
                    IdentityDeliveryOutcome::RetryableFailure(
                        IdentityDeliveryFailureCode::ProviderUnavailable,
                    )
                }),
            "retryable_failure" => IdentityDeliveryOutcome::RetryableFailure(
                IdentityDeliveryFailureCode::from_provider_code(provider_response.code.as_deref()),
            ),
            "permanent_failure" => IdentityDeliveryOutcome::PermanentFailure(
                IdentityDeliveryFailureCode::from_provider_code(provider_response.code.as_deref()),
            ),
            _ => IdentityDeliveryOutcome::RetryableFailure(
                IdentityDeliveryFailureCode::ProviderUnavailable,
            ),
        }
    }
}

#[derive(Debug, Serialize)]
struct IdentityDeliveryProviderRequest<'a> {
    schema: &'static str,
    delivery_id: Uuid,
    delivery_kind: &'static str,
    account_id: &'a str,
    principal_user_id: &'a str,
    credential: &'a str,
    attempt_number: i32,
    idempotency_key: Uuid,
}

#[derive(Debug, Deserialize)]
struct IdentityDeliveryProviderResponse {
    status: String,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    provider_receipt_id: Option<String>,
}

impl IdentityDeliveryGateway for HttpJsonIdentityDeliveryGateway {
    fn provider_id(&self) -> &str {
        self.provider_id.as_str()
    }

    fn deliver<'a>(&'a self, attempt: &'a IdentityDeliveryAttempt) -> IdentityDeliveryFuture<'a> {
        Box::pin(self.deliver_http(attempt))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityDeliveryReceipt {
    pub delivery_id: Uuid,
    pub delivery_kind: String,
    pub status: String,
    pub attempt_count: i32,
    pub provider_id: String,
    pub outcome_kind: String,
    pub outcome_code: Option<String>,
    pub provider_receipt_id: Option<String>,
}

#[derive(Debug, Error)]
pub enum IdentityDeliveryError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("delivery credential envelope error: {0}")]
    Credential(String),
}

#[derive(Debug)]
struct ClaimedIdentityDelivery {
    attempt: IdentityDeliveryAttempt,
    credential_envelope: Option<Value>,
    provider_id: String,
    claim_token: Uuid,
}

pub async fn process_identity_delivery_intent(
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
    delivery_id: Uuid,
    actor_user_id: &str,
    event_kind: &str,
    now: i64,
) -> Result<Option<IdentityDeliveryReceipt>, IdentityDeliveryError> {
    let Some(mut claim) =
        claim_delivery(pool, gateway.provider_id(), Some(delivery_id), now).await?
    else {
        return Ok(None);
    };
    let outcome = deliver_claim(&mut claim, gateway, now).await;
    finalize_delivery(pool, claim, outcome, actor_user_id, event_kind, now).await
}

pub async fn process_next_identity_delivery(
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
    now: i64,
) -> Result<Option<IdentityDeliveryReceipt>, IdentityDeliveryError> {
    let Some(mut claim) = claim_delivery(pool, gateway.provider_id(), None, now).await? else {
        return Ok(None);
    };
    let actor_user_id = claim.attempt.principal_user_id.clone();
    let outcome = deliver_claim(&mut claim, gateway, now).await;
    let event_kind = match &outcome {
        IdentityDeliveryOutcome::Delivered { .. } => "auth_delivery_delivered",
        IdentityDeliveryOutcome::RetryableFailure(_) => "auth_delivery_retryable_failed",
        IdentityDeliveryOutcome::PermanentFailure(_) => "auth_delivery_permanent_failed",
    };
    finalize_delivery(pool, claim, outcome, &actor_user_id, event_kind, now).await
}

pub fn spawn_identity_delivery_worker(
    pool: PgPool,
    gateway: Arc<dyn IdentityDeliveryGateway>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            match process_next_identity_delivery(&pool, gateway.as_ref(), unix_now_seconds()).await
            {
                Ok(Some(_)) => continue,
                Ok(None) => tokio::time::sleep(Duration::from_millis(100)).await,
                Err(error) => {
                    tracing::error!(error = %error, "identity delivery worker failed");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
    })
}

async fn claim_delivery(
    pool: &PgPool,
    provider_id: &str,
    delivery_id: Option<Uuid>,
    now: i64,
) -> Result<Option<ClaimedIdentityDelivery>, IdentityDeliveryError> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query_as::<_, (Uuid, String, String, String, String, i64, i32, Option<Value>)>(
        r#"
        SELECT delivery_id, delivery_kind, account_id, principal_user_id, credential_hash, credential_expires_at, attempt_count, credential_envelope
        FROM auth_delivery_intent
        WHERE provider_id = $1
          AND ($2::UUID IS NULL OR delivery_id = $2)
          AND (
              (status = 'queued' AND next_attempt_at <= $3)
              OR ($2::UUID IS NOT NULL AND status = 'retryable_failed' AND next_attempt_at <= $3)
              OR (status = 'processing' AND claim_expires_at <= $3)
          )
        ORDER BY created_at, delivery_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
        "#,
    )
    .bind(provider_id)
    .bind(delivery_id)
    .bind(now)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((
        delivery_id,
        delivery_kind,
        account_id,
        principal_user_id,
        credential_hash,
        credential_expires_at,
        attempt_count,
        credential_envelope,
    )) = row
    else {
        tx.commit().await?;
        return Ok(None);
    };
    let kind = IdentityDeliveryKind::parse(&delivery_kind).expect("validated delivery kind");
    let claim_token = Uuid::new_v4();
    sqlx::query(
        r#"
        UPDATE auth_delivery_intent
        SET status = 'processing',
            outcome_kind = 'processing',
            outcome_code = NULL,
            next_attempt_at = NULL,
            delivered_at = NULL,
            last_error = NULL,
            provider_receipt_id = NULL,
            claim_token = $2,
            claim_expires_at = $3,
            attempt_count = attempt_count + 1,
            updated_at = $4
        WHERE delivery_id = $1
        "#,
    )
    .bind(delivery_id)
    .bind(claim_token)
    .bind(now + 60)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some(ClaimedIdentityDelivery {
        attempt: IdentityDeliveryAttempt {
            delivery_id,
            kind,
            account_id,
            principal_user_id,
            credential_hash,
            credential_expires_at,
            credential_material: None,
            attempt_number: attempt_count + 1,
        },
        credential_envelope,
        provider_id: provider_id.to_string(),
        claim_token,
    }))
}

async fn deliver_claim(
    claim: &mut ClaimedIdentityDelivery,
    gateway: &dyn IdentityDeliveryGateway,
    now: i64,
) -> IdentityDeliveryOutcome {
    if claim.attempt.credential_expires_at <= now {
        return IdentityDeliveryOutcome::PermanentFailure(
            IdentityDeliveryFailureCode::CredentialExpired,
        );
    }
    let Some(envelope) = claim.credential_envelope.as_ref() else {
        return IdentityDeliveryOutcome::PermanentFailure(
            IdentityDeliveryFailureCode::CredentialUnavailable,
        );
    };
    let credential_material = match decrypt_delivery_credential(
        envelope,
        &delivery_aad(claim.attempt.delivery_id, claim.attempt.kind),
    ) {
        Ok(material) => material,
        Err(_) => {
            return IdentityDeliveryOutcome::PermanentFailure(
                IdentityDeliveryFailureCode::CredentialUnavailable,
            )
        }
    };
    claim.attempt.credential_material = Some(credential_material);
    gateway.deliver(&claim.attempt).await
}

pub fn delivery_aad(delivery_id: Uuid, kind: IdentityDeliveryKind) -> String {
    format!(
        "fmarch:identity-delivery:v1:{delivery_id}:{}",
        kind.as_str()
    )
}

async fn finalize_delivery(
    pool: &PgPool,
    claim: ClaimedIdentityDelivery,
    outcome: IdentityDeliveryOutcome,
    actor_user_id: &str,
    event_kind: &str,
    now: i64,
) -> Result<Option<IdentityDeliveryReceipt>, IdentityDeliveryError> {
    let outcome_code = outcome.code().map(str::to_string);
    let provider_receipt_id = outcome.provider_receipt_id().map(str::to_string);
    let next_attempt_at = outcome.retry_after_seconds().map(|seconds| now + seconds);
    let delivered_at = (outcome.status() == "delivered").then_some(now);
    let mut tx = pool.begin().await?;
    let attempt_count = sqlx::query_scalar::<_, i32>(
        r#"
        UPDATE auth_delivery_intent
        SET status = $3,
            outcome_kind = $4,
            outcome_code = $5,
            next_attempt_at = $6,
            delivered_at = $7,
            last_error = $5,
            provider_receipt_id = $8,
            claim_token = NULL,
            claim_expires_at = NULL,
            updated_at = $9
        WHERE delivery_id = $1
          AND status = 'processing'
          AND claim_token = $2
        RETURNING attempt_count
        "#,
    )
    .bind(claim.attempt.delivery_id)
    .bind(claim.claim_token)
    .bind(outcome.status())
    .bind(outcome.kind())
    .bind(&outcome_code)
    .bind(next_attempt_at)
    .bind(delivered_at)
    .bind(&provider_receipt_id)
    .bind(now)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(attempt_count) = attempt_count else {
        tx.commit().await?;
        return Ok(None);
    };
    record_delivery_audit(
        &mut tx,
        event_kind,
        &claim,
        actor_user_id,
        outcome.kind(),
        outcome.code(),
        provider_receipt_id.as_deref(),
        now,
    )
    .await?;
    tx.commit().await?;
    Ok(Some(IdentityDeliveryReceipt {
        delivery_id: claim.attempt.delivery_id,
        delivery_kind: claim.attempt.kind.as_str().to_string(),
        status: outcome.status().to_string(),
        attempt_count,
        provider_id: claim.provider_id,
        outcome_kind: outcome.kind().to_string(),
        outcome_code,
        provider_receipt_id,
    }))
}

async fn record_delivery_audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event_kind: &str,
    claim: &ClaimedIdentityDelivery,
    actor_user_id: &str,
    outcome_kind: &str,
    outcome_code: Option<&str>,
    provider_receipt_id: Option<&str>,
    now: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at, event_kind, actor_user_id, principal_user_id, token_hash, related_token_hash, metadata
        ) VALUES ($1, $2, $3, $4, $5, NULL, $6::JSONB)
        "#,
    )
    .bind(now)
    .bind(event_kind)
    .bind(actor_user_id)
    .bind(&claim.attempt.principal_user_id)
    .bind(&claim.attempt.credential_hash)
    .bind(
        serde_json::json!({
            "delivery_id": claim.attempt.delivery_id,
            "delivery_kind": claim.attempt.kind.as_str(),
            "account_id": claim.attempt.account_id,
            "adapter": claim.provider_id,
            "provider_id": claim.provider_id,
            "outcome_kind": outcome_kind,
            "outcome_code": outcome_code,
            "provider_receipt_id": provider_receipt_id
        })
        .to_string(),
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub fn unix_now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::{
        IdentityDeliveryAttempt, IdentityDeliveryFailureCode, IdentityDeliveryGateway,
        IdentityDeliveryKind, IdentityDeliveryOutcome, LocalDeterministicIdentityDeliveryGateway,
        LOCAL_DETERMINISTIC_PROVIDER_ID,
    };
    use uuid::Uuid;

    #[tokio::test]
    async fn http_json_gateway_maps_provider_receipts_and_sends_idempotency_key() {
        let app = axum::Router::new().route(
            "/delivery",
            axum::routing::post(
                |axum::Json(payload): axum::Json<serde_json::Value>| async move {
                    assert_eq!(payload["credential"], "one-time-secret");
                    assert_eq!(payload["idempotency_key"], payload["delivery_id"]);
                    axum::Json(serde_json::json!({
                        "status": "delivered",
                        "provider_receipt_id": "provider-receipt-1"
                    }))
                },
            ),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let gateway = super::HttpJsonIdentityDeliveryGateway::new(
            "fixture-http",
            reqwest::Url::parse(&format!("http://{address}/delivery")).unwrap(),
            None,
            reqwest::Client::new(),
        );
        let mut delivery_attempt = attempt(1);
        delivery_attempt.credential_material = Some("one-time-secret".to_string());
        assert_eq!(gateway.provider_id(), "fixture-http");
        assert_eq!(
            gateway.deliver(&delivery_attempt).await,
            IdentityDeliveryOutcome::Delivered {
                provider_receipt_id: "provider-receipt-1".to_string()
            }
        );
    }

    fn attempt(attempt_number: i32) -> IdentityDeliveryAttempt {
        IdentityDeliveryAttempt {
            delivery_id: Uuid::nil(),
            kind: IdentityDeliveryKind::Invite,
            account_id: "member@example.test".to_string(),
            principal_user_id: "member_a".to_string(),
            credential_hash: "redacted-hash".to_string(),
            credential_material: None,
            attempt_number,
        }
    }

    #[tokio::test]
    async fn deterministic_gateway_fails_only_the_first_attempt_when_configured() {
        let gateway = LocalDeterministicIdentityDeliveryGateway::new(true);
        assert_eq!(gateway.provider_id(), LOCAL_DETERMINISTIC_PROVIDER_ID);
        assert_eq!(
            gateway.deliver(&attempt(1)).await,
            IdentityDeliveryOutcome::RetryableFailure(IdentityDeliveryFailureCode::LocalTransient)
        );
        assert_eq!(
            gateway.deliver(&attempt(2)).await,
            IdentityDeliveryOutcome::Delivered {
                provider_receipt_id: "local-00000000-0000-0000-0000-000000000000".to_string(),
            }
        );
    }

    #[test]
    fn typed_outcomes_keep_retryability_and_terminality_distinct() {
        let retryable = IdentityDeliveryOutcome::RetryableFailure(
            IdentityDeliveryFailureCode::ProviderUnavailable,
        );
        let permanent = IdentityDeliveryOutcome::PermanentFailure(
            IdentityDeliveryFailureCode::RecipientRejected,
        );
        assert_eq!(retryable.status(), "retryable_failed");
        assert_eq!(retryable.kind(), "retryable_failure");
        assert_eq!(retryable.code(), Some("provider_unavailable"));
        assert_eq!(retryable.retry_after_seconds(), Some(1));
        assert_eq!(permanent.status(), "permanent_failed");
        assert_eq!(permanent.kind(), "permanent_failure");
        assert_eq!(permanent.code(), Some("recipient_rejected"));
        assert_eq!(permanent.retry_after_seconds(), None);
    }
}
