use eventstore::decrypt_delivery_credential;
use principal::PrincipalId;
use reqwest::{header::RETRY_AFTER, Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::postgres::PgPool;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{fmt, fmt::Formatter, future::Future, pin::Pin};
use thiserror::Error;
use tokio::task::JoinSet;
use uuid::Uuid;

pub const LOCAL_DETERMINISTIC_PROVIDER_ID: &str = "local-deterministic";
pub const DISABLED_PROVIDER_ID: &str = "disabled";

const DEFAULT_DELIVERY_CONNECT_TIMEOUT: Duration = Duration::from_secs(1);
const DEFAULT_DELIVERY_RESPONSE_TIMEOUT: Duration = Duration::from_secs(3);
const DEFAULT_DELIVERY_BODY_TIMEOUT: Duration = Duration::from_secs(1);
const DEFAULT_DELIVERY_TOTAL_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_DELIVERY_RESPONSE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdentityDeliveryHttpTimeouts {
    connect: Duration,
    response: Duration,
    body: Duration,
    total: Duration,
    max_response_bytes: usize,
}

impl IdentityDeliveryHttpTimeouts {
    pub fn new(
        connect: Duration,
        response: Duration,
        body: Duration,
        total: Duration,
        max_response_bytes: usize,
    ) -> Result<Self, String> {
        if connect.is_zero() || response.is_zero() || body.is_zero() || total.is_zero() {
            return Err("identity delivery HTTP deadlines must be non-zero".to_string());
        }
        if connect > response {
            return Err(
                "identity delivery connect deadline must not exceed the response deadline"
                    .to_string(),
            );
        }
        if response.saturating_add(body) > total {
            return Err(
                "identity delivery total deadline must cover the response and body deadlines"
                    .to_string(),
            );
        }
        if !(1..=1024 * 1024).contains(&max_response_bytes) {
            return Err(
                "identity delivery response limit must be between 1 byte and 1 MiB".to_string(),
            );
        }
        Ok(Self {
            connect,
            response,
            body,
            total,
            max_response_bytes,
        })
    }

    pub fn total(self) -> Duration {
        self.total
    }
}

impl Default for IdentityDeliveryHttpTimeouts {
    fn default() -> Self {
        Self {
            connect: DEFAULT_DELIVERY_CONNECT_TIMEOUT,
            response: DEFAULT_DELIVERY_RESPONSE_TIMEOUT,
            body: DEFAULT_DELIVERY_BODY_TIMEOUT,
            total: DEFAULT_DELIVERY_TOTAL_TIMEOUT,
            max_response_bytes: DEFAULT_DELIVERY_RESPONSE_BYTES,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdentityDeliveryRetryPolicy {
    base: Duration,
    max: Duration,
    max_attempts: i32,
}

impl IdentityDeliveryRetryPolicy {
    pub fn new(base: Duration, max: Duration, max_attempts: i32) -> Result<Self, String> {
        if base.as_secs() == 0 || max < base || max > Duration::from_secs(86_400) {
            return Err(
                "identity delivery retry bounds must be whole-second values with 1s <= base <= max <= 24h"
                    .to_string(),
            );
        }
        if base.subsec_nanos() != 0 || max.subsec_nanos() != 0 {
            return Err("identity delivery retry bounds must use whole seconds".to_string());
        }
        if !(1..=100).contains(&max_attempts) {
            return Err("identity delivery max attempts must be between 1 and 100".to_string());
        }
        Ok(Self {
            base,
            max,
            max_attempts,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdentityDeliveryWorkerConfig {
    max_concurrency: usize,
    poll_interval: Duration,
    claim_lease: Duration,
    attempt_timeout: Duration,
    retry_base: Duration,
    retry_max: Duration,
    max_attempts: i32,
}

impl IdentityDeliveryWorkerConfig {
    pub fn new(
        max_concurrency: usize,
        poll_interval: Duration,
        claim_lease: Duration,
        attempt_timeout: Duration,
        retry: IdentityDeliveryRetryPolicy,
    ) -> Result<Self, String> {
        if !(1..=64).contains(&max_concurrency) {
            return Err("identity delivery concurrency must be between 1 and 64".to_string());
        }
        if poll_interval.is_zero() || poll_interval > Duration::from_secs(60) {
            return Err("identity delivery poll interval must be in (0ms, 60s]".to_string());
        }
        if attempt_timeout.is_zero() || attempt_timeout > Duration::from_secs(120) {
            return Err("identity delivery attempt timeout must be in (0ms, 120s]".to_string());
        }
        if claim_lease.subsec_nanos() != 0
            || claim_lease.as_secs() < 2
            || claim_lease > Duration::from_secs(300)
            || claim_lease <= attempt_timeout.saturating_add(Duration::from_secs(1))
        {
            return Err(
                "identity delivery claim lease must use 2..=300 whole seconds and exceed the attempt timeout by more than one second"
                    .to_string(),
            );
        }
        Ok(Self {
            max_concurrency,
            poll_interval,
            claim_lease,
            attempt_timeout,
            retry_base: retry.base,
            retry_max: retry.max,
            max_attempts: retry.max_attempts,
        })
    }

    pub fn max_concurrency(self) -> usize {
        self.max_concurrency
    }

    pub fn poll_interval(self) -> Duration {
        self.poll_interval
    }

    pub fn claim_lease(self) -> Duration {
        self.claim_lease
    }

    pub fn attempt_timeout(self) -> Duration {
        self.attempt_timeout
    }

    pub fn retry_base(self) -> Duration {
        self.retry_base
    }

    pub fn retry_max(self) -> Duration {
        self.retry_max
    }

    pub fn max_attempts(self) -> i32 {
        self.max_attempts
    }

    fn retry_delay_seconds(
        self,
        attempt_number: i32,
        provider_retry_after_seconds: Option<i64>,
        entropy: u64,
    ) -> i64 {
        let exponent = u32::try_from(attempt_number.saturating_sub(1))
            .unwrap_or_default()
            .min(62);
        let base = self.retry_base.as_secs();
        let exponential_cap = base
            .checked_mul(1_u64 << exponent)
            .unwrap_or(u64::MAX)
            .min(self.retry_max.as_secs());
        // PostgreSQL persists second-resolution scheduling. Keep the lower bound
        // at one second while sampling every other point in the full-jitter
        // interval uniformly.
        let jittered = 1 + entropy % exponential_cap.max(1);
        let provider_floor = provider_retry_after_seconds
            .and_then(|seconds| u64::try_from(seconds).ok())
            .unwrap_or_default()
            .min(self.retry_max.as_secs());
        i64::try_from(jittered.max(provider_floor)).unwrap_or(i64::MAX)
    }
}

impl Default for IdentityDeliveryWorkerConfig {
    fn default() -> Self {
        Self {
            max_concurrency: 4,
            poll_interval: Duration::from_millis(100),
            claim_lease: Duration::from_secs(30),
            attempt_timeout: Duration::from_secs(10),
            retry_base: Duration::from_secs(2),
            retry_max: Duration::from_secs(300),
            max_attempts: 8,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityDeliveryKind {
    Invite,
    Recovery,
    CommunityInvitation,
}

impl IdentityDeliveryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Invite => "invite",
            Self::Recovery => "recovery",
            Self::CommunityInvitation => "community_invitation",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "invite" => Some(Self::Invite),
            "recovery" => Some(Self::Recovery),
            "community_invitation" => Some(Self::CommunityInvitation),
            _ => None,
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct IdentityDeliveryAttempt {
    pub delivery_id: Uuid,
    pub kind: IdentityDeliveryKind,
    pub account_id: String,
    pub principal_id: PrincipalId,
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
            .field("principal_id", &self.principal_id)
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
    AttemptsExhausted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityDeliveryCancellationCode {
    CredentialInactive,
}

impl IdentityDeliveryCancellationCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CredentialInactive => "credential_inactive",
        }
    }
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
            Self::AttemptsExhausted => "attempts_exhausted",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityDeliveryOutcome {
    Delivered {
        provider_receipt_id: String,
    },
    RetryableFailure(IdentityDeliveryFailureCode),
    RetryableFailureAfter {
        code: IdentityDeliveryFailureCode,
        retry_after_seconds: i64,
    },
    PermanentFailure(IdentityDeliveryFailureCode),
    Cancelled(IdentityDeliveryCancellationCode),
}

impl IdentityDeliveryOutcome {
    pub fn status(&self) -> &'static str {
        match self {
            Self::Delivered { .. } => "delivered",
            Self::RetryableFailure(_) | Self::RetryableFailureAfter { .. } => "retryable_failed",
            Self::PermanentFailure(_) => "permanent_failed",
            Self::Cancelled(_) => "cancelled",
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::Delivered { .. } => "delivered",
            Self::RetryableFailure(_) | Self::RetryableFailureAfter { .. } => "retryable_failure",
            Self::PermanentFailure(_) => "permanent_failure",
            Self::Cancelled(_) => "cancelled",
        }
    }

    pub fn code(&self) -> Option<&'static str> {
        match self {
            Self::Delivered { .. } => None,
            Self::RetryableFailure(code) | Self::PermanentFailure(code) => Some(code.as_str()),
            Self::RetryableFailureAfter { code, .. } => Some(code.as_str()),
            Self::Cancelled(code) => Some(code.as_str()),
        }
    }

    pub fn retry_after_seconds(&self) -> Option<i64> {
        match self {
            Self::RetryableFailure(_) => Some(1),
            Self::RetryableFailureAfter {
                retry_after_seconds,
                ..
            } => Some(*retry_after_seconds),
            Self::Delivered { .. } | Self::PermanentFailure(_) | Self::Cancelled(_) => None,
        }
    }

    pub fn provider_receipt_id(&self) -> Option<&str> {
        match self {
            Self::Delivered {
                provider_receipt_id,
            } => Some(provider_receipt_id.as_str()),
            Self::RetryableFailure(_)
            | Self::RetryableFailureAfter { .. }
            | Self::PermanentFailure(_)
            | Self::Cancelled(_) => None,
        }
    }
}

pub type IdentityDeliveryFuture<'a> =
    Pin<Box<dyn Future<Output = IdentityDeliveryOutcome> + Send + 'a>>;

pub trait IdentityDeliveryGateway: Send + Sync {
    fn provider_id(&self) -> &str;

    fn deliver<'a>(&'a self, attempt: &'a IdentityDeliveryAttempt) -> IdentityDeliveryFuture<'a>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct DisabledIdentityDeliveryGateway;

impl IdentityDeliveryGateway for DisabledIdentityDeliveryGateway {
    fn provider_id(&self) -> &str {
        DISABLED_PROVIDER_ID
    }

    fn deliver<'a>(&'a self, _attempt: &'a IdentityDeliveryAttempt) -> IdentityDeliveryFuture<'a> {
        Box::pin(async {
            IdentityDeliveryOutcome::PermanentFailure(
                IdentityDeliveryFailureCode::CredentialUnavailable,
            )
        })
    }
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
    timeouts: IdentityDeliveryHttpTimeouts,
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
            .ok_or_else(|| {
                "FMARCH_IDENTITY_DELIVERY_PROVIDER_ID is required when the delivery endpoint is configured"
                    .to_string()
            })?;
        let auth_token = std::env::var("FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                "FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN is required when the delivery endpoint is configured"
                    .to_string()
            })?;
        let timeouts = IdentityDeliveryHttpTimeouts::new(
            delivery_duration_from_env(
                "FMARCH_IDENTITY_DELIVERY_CONNECT_TIMEOUT_MS",
                DEFAULT_DELIVERY_CONNECT_TIMEOUT,
            )?,
            delivery_duration_from_env(
                "FMARCH_IDENTITY_DELIVERY_RESPONSE_TIMEOUT_MS",
                DEFAULT_DELIVERY_RESPONSE_TIMEOUT,
            )?,
            delivery_duration_from_env(
                "FMARCH_IDENTITY_DELIVERY_BODY_TIMEOUT_MS",
                DEFAULT_DELIVERY_BODY_TIMEOUT,
            )?,
            delivery_duration_from_env(
                "FMARCH_IDENTITY_DELIVERY_TOTAL_TIMEOUT_MS",
                DEFAULT_DELIVERY_TOTAL_TIMEOUT,
            )?,
            delivery_usize_from_env(
                "FMARCH_IDENTITY_DELIVERY_MAX_RESPONSE_BYTES",
                DEFAULT_DELIVERY_RESPONSE_BYTES,
            )?,
        )?;
        Ok(Some(Self::configured(
            provider_id,
            endpoint,
            Some(auth_token),
            timeouts,
        )?))
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
            timeouts: IdentityDeliveryHttpTimeouts::default(),
        }
    }

    pub fn configured(
        provider_id: impl Into<String>,
        endpoint: Url,
        auth_token: Option<String>,
        timeouts: IdentityDeliveryHttpTimeouts,
    ) -> Result<Self, String> {
        let provider_id = provider_id.into();
        if provider_id.trim() != provider_id || provider_id.is_empty() || provider_id.len() > 128 {
            return Err("identity delivery provider id must be 1..=128 unpadded bytes".to_string());
        }
        let local_host = matches!(endpoint.host_str(), Some("127.0.0.1" | "localhost"));
        if endpoint.scheme() != "https" && !local_host {
            return Err("identity delivery endpoint must use https outside localhost".to_string());
        }
        if auth_token
            .as_deref()
            .is_some_and(|token| token.trim().is_empty())
        {
            return Err("identity delivery auth token must not be blank".to_string());
        }
        let client = Client::builder()
            .connect_timeout(timeouts.connect)
            .build()
            .map_err(|error| format!("identity delivery HTTP client is invalid: {error}"))?;
        Ok(Self {
            provider_id,
            endpoint,
            auth_token,
            client,
            timeouts,
        })
    }

    pub fn with_timeouts(mut self, timeouts: IdentityDeliveryHttpTimeouts) -> Self {
        self.timeouts = timeouts;
        self
    }

    async fn deliver_http(&self, attempt: &IdentityDeliveryAttempt) -> IdentityDeliveryOutcome {
        match tokio::time::timeout(
            self.timeouts.total,
            self.deliver_http_with_deadlines(attempt),
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(_) => IdentityDeliveryOutcome::RetryableFailure(
                IdentityDeliveryFailureCode::ProviderUnavailable,
            ),
        }
    }

    async fn deliver_http_with_deadlines(
        &self,
        attempt: &IdentityDeliveryAttempt,
    ) -> IdentityDeliveryOutcome {
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
            principal_id: &attempt.principal_id,
            credential,
            attempt_number: attempt.attempt_number,
            idempotency_key: attempt.delivery_id,
        };
        let mut builder = self.client.post(self.endpoint.clone()).json(&request);
        if let Some(auth_token) = self.auth_token.as_deref() {
            builder = builder.bearer_auth(auth_token);
        }
        let response = match tokio::time::timeout(self.timeouts.response, builder.send()).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) | Err(_) => {
                return IdentityDeliveryOutcome::RetryableFailure(
                    IdentityDeliveryFailureCode::ProviderUnavailable,
                )
            }
        };
        let status = response.status();
        let retry_after_seconds = parse_retry_after_seconds(response.headers());
        if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
            return retry_after_seconds
                .map(
                    |retry_after_seconds| IdentityDeliveryOutcome::RetryableFailureAfter {
                        code: IdentityDeliveryFailureCode::ProviderUnavailable,
                        retry_after_seconds,
                    },
                )
                .unwrap_or(IdentityDeliveryOutcome::RetryableFailure(
                    IdentityDeliveryFailureCode::ProviderUnavailable,
                ));
        }
        if status.is_client_error() {
            return IdentityDeliveryOutcome::PermanentFailure(
                IdentityDeliveryFailureCode::RecipientRejected,
            );
        }
        if response
            .content_length()
            .is_some_and(|length| length > self.timeouts.max_response_bytes as u64)
        {
            return IdentityDeliveryOutcome::RetryableFailure(
                IdentityDeliveryFailureCode::ProviderUnavailable,
            );
        }
        let response_bytes = match tokio::time::timeout(self.timeouts.body, response.bytes()).await
        {
            Ok(Ok(bytes)) if bytes.len() <= self.timeouts.max_response_bytes => bytes,
            Ok(Ok(_)) | Ok(Err(_)) | Err(_) => {
                return IdentityDeliveryOutcome::RetryableFailure(
                    IdentityDeliveryFailureCode::ProviderUnavailable,
                )
            }
        };
        let provider_response =
            match serde_json::from_slice::<IdentityDeliveryProviderResponse>(&response_bytes) {
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
            "retryable_failure" => provider_response
                .retry_after_seconds
                .filter(|seconds| *seconds >= 0)
                .map(
                    |retry_after_seconds| IdentityDeliveryOutcome::RetryableFailureAfter {
                        code: IdentityDeliveryFailureCode::from_provider_code(
                            provider_response.code.as_deref(),
                        ),
                        retry_after_seconds,
                    },
                )
                .unwrap_or_else(|| {
                    IdentityDeliveryOutcome::RetryableFailure(
                        IdentityDeliveryFailureCode::from_provider_code(
                            provider_response.code.as_deref(),
                        ),
                    )
                }),
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
    principal_id: &'a PrincipalId,
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
    #[serde(default)]
    retry_after_seconds: Option<i64>,
}

fn delivery_duration_from_env(name: &str, default: Duration) -> Result<Duration, String> {
    let Some(raw) = std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(default);
    };
    let milliseconds = raw
        .parse::<u64>()
        .map_err(|_| format!("{name} must be an unsigned integer number of milliseconds"))?;
    if !(1..=120_000).contains(&milliseconds) {
        return Err(format!("{name} must be between 1 and 120000 milliseconds"));
    }
    Ok(Duration::from_millis(milliseconds))
}

fn delivery_usize_from_env(name: &str, default: usize) -> Result<usize, String> {
    let Some(raw) = std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(default);
    };
    raw.parse::<usize>()
        .map_err(|_| format!("{name} must be an unsigned integer"))
}

fn parse_retry_after_seconds(headers: &reqwest::header::HeaderMap) -> Option<i64> {
    headers
        .get(RETRY_AFTER)?
        .to_str()
        .ok()?
        .parse::<i64>()
        .ok()
        .filter(|seconds| *seconds >= 0)
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

type IdentityDeliveryTaskOutput = Result<Option<IdentityDeliveryReceipt>, IdentityDeliveryError>;
type JoinedIdentityDeliveryTask = Result<IdentityDeliveryTaskOutput, tokio::task::JoinError>;

#[derive(Debug, Error)]
pub enum IdentityDeliveryError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("delivery credential envelope error: {0}")]
    Credential(String),
    #[error("identity delivery worker task failed: {0}")]
    Worker(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct IdentityDeliveryCredentialResealBatchReport {
    pub examined: u64,
    pub resealed: u64,
    pub batch_full: bool,
}

const MAX_IDENTITY_DELIVERY_RESEAL_BATCH: i64 = 1_000;

#[derive(Debug)]
struct ClaimedIdentityDelivery {
    attempt: IdentityDeliveryAttempt,
    credential_envelope: Option<Value>,
    provider_id: String,
    claim_token: Uuid,
    provider_attempt_permitted: bool,
}

#[derive(Debug)]
struct IdentityDeliveryCancellationRequest<'a> {
    delivery_id: Uuid,
    kind: IdentityDeliveryKind,
    account_id: &'a str,
    principal_id: &'a PrincipalId,
    credential_hash: &'a str,
    provider_id: &'a str,
    cancelled_at: i64,
}

#[derive(Debug)]
struct IdentityDeliveryAuditRecord<'a> {
    event_at: i64,
    event_kind: &'a str,
    actor_principal_id: &'a PrincipalId,
    principal_id: &'a PrincipalId,
    credential_hash: &'a str,
    delivery_id: Uuid,
    delivery_kind: IdentityDeliveryKind,
    account_id: &'a str,
    provider_id: &'a str,
    outcome_kind: &'a str,
    outcome_code: Option<&'a str>,
    provider_receipt_id: Option<&'a str>,
}

pub async fn process_identity_delivery_intent(
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
    delivery_id: Uuid,
    actor_principal_id: &PrincipalId,
    event_kind: &str,
    now: i64,
) -> Result<Option<IdentityDeliveryReceipt>, IdentityDeliveryError> {
    process_identity_delivery_intent_with_config(
        pool,
        gateway,
        delivery_id,
        actor_principal_id,
        event_kind,
        now,
        IdentityDeliveryWorkerConfig::default(),
    )
    .await
}

async fn process_identity_delivery_intent_with_config(
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
    delivery_id: Uuid,
    actor_principal_id: &PrincipalId,
    event_kind: &str,
    now: i64,
    config: IdentityDeliveryWorkerConfig,
) -> Result<Option<IdentityDeliveryReceipt>, IdentityDeliveryError> {
    let Some(claim) =
        claim_delivery(pool, gateway.provider_id(), Some(delivery_id), now, config).await?
    else {
        return Ok(None);
    };
    deliver_and_finalize(
        pool,
        claim,
        gateway,
        actor_principal_id,
        Some(event_kind),
        now,
        config,
    )
    .await
}

pub async fn process_next_identity_delivery(
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
    now: i64,
) -> Result<Option<IdentityDeliveryReceipt>, IdentityDeliveryError> {
    process_next_identity_delivery_with_config(
        pool,
        gateway,
        now,
        IdentityDeliveryWorkerConfig::default(),
    )
    .await
}

pub async fn process_next_identity_delivery_with_config(
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
    now: i64,
    config: IdentityDeliveryWorkerConfig,
) -> Result<Option<IdentityDeliveryReceipt>, IdentityDeliveryError> {
    let Some(claim) = claim_delivery(pool, gateway.provider_id(), None, now, config).await? else {
        return Ok(None);
    };
    let actor_principal_id = claim.attempt.principal_id;
    deliver_and_finalize(pool, claim, gateway, &actor_principal_id, None, now, config).await
}

pub async fn run_identity_delivery_worker(
    pool: PgPool,
    gateway: Arc<dyn IdentityDeliveryGateway>,
    config: IdentityDeliveryWorkerConfig,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<(), IdentityDeliveryError> {
    let mut attempts = JoinSet::new();
    loop {
        if *shutdown.borrow() {
            break;
        }

        let mut found_work = false;
        while attempts.len() < config.max_concurrency() {
            let now = unix_now_seconds();
            let Some(claim) =
                claim_delivery(&pool, gateway.provider_id(), None, now, config).await?
            else {
                break;
            };
            found_work = true;
            let attempt_pool = pool.clone();
            let attempt_gateway = gateway.clone();
            let actor_principal_id = claim.attempt.principal_id;
            attempts.spawn(async move {
                deliver_and_finalize(
                    &attempt_pool,
                    claim,
                    attempt_gateway.as_ref(),
                    &actor_principal_id,
                    None,
                    now,
                    config,
                )
                .await
            });
        }

        if attempts.is_empty() {
            tokio::select! {
                changed = shutdown.changed() => {
                    if changed.is_err() || *shutdown.borrow() {
                        break;
                    }
                }
                () = tokio::time::sleep(config.poll_interval()) => {}
            }
            continue;
        }

        if attempts.len() >= config.max_concurrency() || !found_work {
            tokio::select! {
                changed = shutdown.changed() => {
                    if changed.is_err() || *shutdown.borrow() {
                        break;
                    }
                }
                joined = attempts.join_next() => {
                    finish_delivery_task(joined)?;
                }
            }
        }
    }

    while let Some(joined) = attempts.join_next().await {
        finish_delivery_task(Some(joined))?;
    }
    Ok(())
}

fn finish_delivery_task(
    joined: Option<JoinedIdentityDeliveryTask>,
) -> Result<(), IdentityDeliveryError> {
    match joined {
        Some(Ok(Ok(_))) | None => Ok(()),
        Some(Ok(Err(error))) => Err(error),
        Some(Err(error)) => Err(IdentityDeliveryError::Worker(error.to_string())),
    }
}

pub fn spawn_identity_delivery_worker(
    pool: PgPool,
    gateway: Arc<dyn IdentityDeliveryGateway>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let (_shutdown_guard, shutdown) = tokio::sync::watch::channel(false);
        if let Err(error) = run_identity_delivery_worker(
            pool,
            gateway,
            IdentityDeliveryWorkerConfig::default(),
            shutdown,
        )
        .await
        {
            tracing::error!(error = %error, "identity delivery worker stopped");
        }
    })
}

/// Reseals one independently committed batch of persisted delivery credentials.
///
/// The row lock is the authority boundary with delivery claim, cancellation,
/// and subject erasure. A caller may safely repeat this operation after an
/// interruption; rows already resealed no longer match `retiring_kid`, while a
/// concurrently locked row is left for a later batch.
pub async fn reseal_identity_delivery_credentials_batch(
    pool: &PgPool,
    retiring_kid: &str,
    limit: i64,
) -> Result<IdentityDeliveryCredentialResealBatchReport, IdentityDeliveryError> {
    validate_delivery_reseal_kid(retiring_kid)?;
    if !(1..=MAX_IDENTITY_DELIVERY_RESEAL_BATCH).contains(&limit) {
        return Err(IdentityDeliveryError::Credential(format!(
            "delivery credential reseal batch limit must be between 1 and {MAX_IDENTITY_DELIVERY_RESEAL_BATCH}"
        )));
    }

    let mut tx = pool.begin().await?;
    let rows = sqlx::query_as::<_, (Uuid, String, Option<Value>)>(
        r#"
        SELECT delivery_id, delivery_kind, credential_envelope
        FROM auth_delivery_intent
        WHERE credential_envelope_kid = $1
        ORDER BY delivery_id
        FOR UPDATE SKIP LOCKED
        LIMIT $2
        "#,
    )
    .bind(retiring_kid)
    .bind(limit)
    .fetch_all(&mut *tx)
    .await?;
    let examined = rows.len() as u64;
    let transformed = if rows.is_empty() {
        Vec::new()
    } else {
        let context = eventstore::DirectEnvelopeResealContext::begin(&mut tx, retiring_kid)
            .await
            .map_err(|error| IdentityDeliveryError::Credential(error.to_string()))?;
        let mut transformed = Vec::with_capacity(rows.len());
        for (delivery_id, delivery_kind, credential_envelope) in rows {
            // A generated KID normally excludes NULL envelopes. Keep the
            // explicit check so cancellation/erasure can never resurrect one.
            let Some(credential_envelope) = credential_envelope else {
                continue;
            };
            let kind = IdentityDeliveryKind::parse(&delivery_kind).ok_or_else(|| {
                IdentityDeliveryError::Credential(format!(
                    "delivery `{delivery_id}` has unsupported kind `{delivery_kind}`"
                ))
            })?;
            let aad = delivery_aad(delivery_id, kind);
            let new_envelope = context
                .reseal_delivery_credential(&credential_envelope, &aad)
                .map_err(|error| IdentityDeliveryError::Credential(error.to_string()))?;
            transformed.push((delivery_id, new_envelope));
        }
        transformed
    };

    let resealed = transformed.len() as u64;
    if !transformed.is_empty() {
        let mut update = sqlx::QueryBuilder::<sqlx::Postgres>::new(
            "UPDATE auth_delivery_intent AS target \
             SET credential_envelope = input.envelope \
             FROM (",
        );
        update.push_values(transformed.iter(), |mut row, (delivery_id, envelope)| {
            row.push_bind(delivery_id).push_bind(envelope);
        });
        update.push(
            ") AS input(delivery_id, envelope) \
             WHERE target.delivery_id = input.delivery_id \
               AND target.credential_envelope IS NOT NULL \
               AND target.credential_envelope_kid = ",
        );
        update.push_bind(retiring_kid);
        let result = update.build().execute(&mut *tx).await?;
        if result.rows_affected() != resealed {
            return Err(IdentityDeliveryError::Credential(
                "claimed delivery credential batch was not updated exactly once per row"
                    .to_string(),
            ));
        }
    }

    tx.commit().await?;

    Ok(IdentityDeliveryCredentialResealBatchReport {
        examined,
        resealed,
        batch_full: examined == limit as u64,
    })
}

/// Counts persisted delivery credentials that still require `kid`.
pub async fn count_delivery_credential_envelopes_by_kid(
    pool: &PgPool,
    kid: &str,
) -> Result<u64, IdentityDeliveryError> {
    validate_delivery_reseal_kid(kid)?;
    let count = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*)
        FROM auth_delivery_intent
        WHERE credential_envelope_kid = $1
        "#,
    )
    .bind(kid)
    .fetch_one(pool)
    .await?;
    Ok(count as u64)
}

fn validate_delivery_reseal_kid(kid: &str) -> Result<(), IdentityDeliveryError> {
    if kid.is_empty() || kid.trim() != kid || kid.len() > 128 {
        return Err(IdentityDeliveryError::Credential(
            "delivery credential key id must be 1..=128 unpadded bytes".to_string(),
        ));
    }
    Ok(())
}

async fn claim_delivery(
    pool: &PgPool,
    provider_id: &str,
    delivery_id: Option<Uuid>,
    now: i64,
    config: IdentityDeliveryWorkerConfig,
) -> Result<Option<ClaimedIdentityDelivery>, IdentityDeliveryError> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query_as::<_, (Uuid, String, String, Uuid, String, i64, i32, Option<Value>)>(
        r#"
        SELECT delivery_id, delivery_kind, account_id, principal_id, credential_hash, credential_expires_at, attempt_count, credential_envelope
        FROM auth_delivery_intent
        WHERE provider_id = $1
          AND ($2::UUID IS NULL OR delivery_id = $2)
          AND (
              (status = 'queued' AND next_attempt_at <= $3)
              OR (status = 'retryable_failed' AND next_attempt_at <= $3)
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
        principal_id,
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
    let principal_id = PrincipalId::from_uuid(principal_id);
    if !credential_is_active(&mut tx, kind, credential_hash.as_str()).await? {
        let request = IdentityDeliveryCancellationRequest {
            delivery_id,
            kind,
            account_id: account_id.as_str(),
            principal_id: &principal_id,
            credential_hash: credential_hash.as_str(),
            provider_id,
            cancelled_at: now,
        };
        cancel_claimed_delivery(&mut tx, request).await?;
        tx.commit().await?;
        return Ok(None);
    }
    let provider_attempt_permitted = attempt_count < config.max_attempts();
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
            attempt_count = attempt_count + CASE WHEN attempt_count < $5 THEN 1 ELSE 0 END,
            updated_at = $4
        WHERE delivery_id = $1
        "#,
    )
    .bind(delivery_id)
    .bind(claim_token)
    .bind(now.saturating_add(config.claim_lease().as_secs() as i64))
    .bind(now)
    .bind(config.max_attempts())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some(ClaimedIdentityDelivery {
        attempt: IdentityDeliveryAttempt {
            delivery_id,
            kind,
            account_id,
            principal_id,
            credential_hash,
            credential_expires_at,
            credential_material: None,
            attempt_number: attempt_count + if provider_attempt_permitted { 1 } else { 0 },
        },
        credential_envelope,
        provider_id: provider_id.to_string(),
        claim_token,
        provider_attempt_permitted,
    }))
}

async fn credential_is_active(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kind: IdentityDeliveryKind,
    credential_hash: &str,
) -> Result<bool, sqlx::Error> {
    match kind {
        IdentityDeliveryKind::Invite => {
            sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1
                    FROM game_invitation
                    WHERE token_hash = $1
                      AND redeemed_at IS NULL
                      AND revoked_at IS NULL
                )
                "#,
            )
            .bind(credential_hash)
            .fetch_one(&mut **tx)
            .await
        }
        IdentityDeliveryKind::Recovery => {
            sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1
                    FROM auth_account_recovery_credential
                    WHERE token_hash = $1
                      AND used_at IS NULL
                      AND revoked_at IS NULL
                )
                "#,
            )
            .bind(credential_hash)
            .fetch_one(&mut **tx)
            .await
        }
        IdentityDeliveryKind::CommunityInvitation => {
            sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1
                    FROM community_invitation_credential
                    WHERE token_hash = $1
                      AND consumed_at IS NULL
                      AND revoked_at IS NULL
                )
                "#,
            )
            .bind(credential_hash)
            .fetch_one(&mut **tx)
            .await
        }
    }
}

async fn credential_is_active_now(
    pool: &PgPool,
    kind: IdentityDeliveryKind,
    credential_hash: &str,
) -> Result<bool, sqlx::Error> {
    match kind {
        IdentityDeliveryKind::Invite => {
            sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM game_invitation
                    WHERE token_hash = $1 AND redeemed_at IS NULL AND revoked_at IS NULL
                )
                "#,
            )
            .bind(credential_hash)
            .fetch_one(pool)
            .await
        }
        IdentityDeliveryKind::Recovery => {
            sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM auth_account_recovery_credential
                    WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL
                )
                "#,
            )
            .bind(credential_hash)
            .fetch_one(pool)
            .await
        }
        IdentityDeliveryKind::CommunityInvitation => {
            sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1 FROM community_invitation_credential
                    WHERE token_hash = $1 AND consumed_at IS NULL AND revoked_at IS NULL
                )
                "#,
            )
            .bind(credential_hash)
            .fetch_one(pool)
            .await
        }
    }
}

async fn cancel_claimed_delivery(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request: IdentityDeliveryCancellationRequest<'_>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE auth_delivery_intent
        SET status = 'cancelled',
            outcome_kind = 'cancelled',
            outcome_code = 'credential_inactive',
            next_attempt_at = NULL,
            delivered_at = NULL,
            last_error = 'credential_inactive',
            provider_receipt_id = NULL,
            claim_token = NULL,
            claim_expires_at = NULL,
            credential_envelope = NULL,
            updated_at = $2
        WHERE delivery_id = $1
        "#,
    )
    .bind(request.delivery_id)
    .bind(request.cancelled_at)
    .execute(&mut **tx)
    .await?;
    record_delivery_audit(
        tx,
        IdentityDeliveryAuditRecord {
            event_at: request.cancelled_at,
            event_kind: "auth_delivery_cancelled",
            actor_principal_id: request.principal_id,
            principal_id: request.principal_id,
            credential_hash: request.credential_hash,
            delivery_id: request.delivery_id,
            delivery_kind: request.kind,
            account_id: request.account_id,
            provider_id: request.provider_id,
            outcome_kind: "cancelled",
            outcome_code: Some("credential_inactive"),
            provider_receipt_id: None,
        },
    )
    .await
}

async fn delivery_outcome(
    claim: &mut ClaimedIdentityDelivery,
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
    now: i64,
    config: IdentityDeliveryWorkerConfig,
) -> IdentityDeliveryOutcome {
    if !claim.provider_attempt_permitted {
        return IdentityDeliveryOutcome::PermanentFailure(
            IdentityDeliveryFailureCode::AttemptsExhausted,
        );
    }
    let credential_active = match credential_is_active_now(
        pool,
        claim.attempt.kind,
        claim.attempt.credential_hash.as_str(),
    )
    .await
    {
        Ok(active) => active,
        Err(_) => {
            return IdentityDeliveryOutcome::RetryableFailure(
                IdentityDeliveryFailureCode::LocalTransient,
            )
        }
    };
    if !credential_active {
        return IdentityDeliveryOutcome::Cancelled(
            IdentityDeliveryCancellationCode::CredentialInactive,
        );
    }
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
    match tokio::time::timeout(config.attempt_timeout(), gateway.deliver(&claim.attempt)).await {
        Ok(outcome) => outcome,
        Err(_) => IdentityDeliveryOutcome::RetryableFailure(
            IdentityDeliveryFailureCode::ProviderUnavailable,
        ),
    }
}

pub fn delivery_aad(delivery_id: Uuid, kind: IdentityDeliveryKind) -> String {
    format!(
        "fmarch:identity-delivery:v1:{delivery_id}:{}",
        kind.as_str()
    )
}

async fn deliver_and_finalize(
    pool: &PgPool,
    mut claim: ClaimedIdentityDelivery,
    gateway: &dyn IdentityDeliveryGateway,
    actor_principal_id: &PrincipalId,
    requested_event_kind: Option<&str>,
    now: i64,
    config: IdentityDeliveryWorkerConfig,
) -> Result<Option<IdentityDeliveryReceipt>, IdentityDeliveryError> {
    // The provider is deliberately outside every database transaction. The
    // claim token and immutable credential hash fence completion; source
    // revocation/consumption wins through the conditional finalization CAS.
    let outcome = delivery_outcome(&mut claim, pool, gateway, now, config).await;
    let finalized_at = unix_now_seconds().max(now);
    let mut tx = pool.begin().await?;
    let receipt = finalize_delivery(
        &mut tx,
        claim,
        outcome,
        actor_principal_id,
        requested_event_kind,
        finalized_at,
        config,
    )
    .await?;
    tx.commit().await?;
    Ok(receipt)
}

async fn finalize_delivery(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    claim: ClaimedIdentityDelivery,
    outcome: IdentityDeliveryOutcome,
    actor_principal_id: &PrincipalId,
    requested_event_kind: Option<&str>,
    now: i64,
    config: IdentityDeliveryWorkerConfig,
) -> Result<Option<IdentityDeliveryReceipt>, IdentityDeliveryError> {
    let mut outcome = outcome;
    if now >= claim.attempt.credential_expires_at
        && !matches!(&outcome, IdentityDeliveryOutcome::Cancelled(_))
    {
        outcome = IdentityDeliveryOutcome::PermanentFailure(
            IdentityDeliveryFailureCode::CredentialExpired,
        );
    }
    if matches!(
        &outcome,
        IdentityDeliveryOutcome::RetryableFailure(_)
            | IdentityDeliveryOutcome::RetryableFailureAfter { .. }
    ) && claim.attempt.attempt_number >= config.max_attempts()
    {
        outcome = IdentityDeliveryOutcome::PermanentFailure(
            IdentityDeliveryFailureCode::AttemptsExhausted,
        );
    }
    let entropy = u64::from_le_bytes(
        Uuid::new_v4().as_bytes()[..8]
            .try_into()
            .expect("UUID contains eight entropy bytes"),
    );
    let mut next_attempt_at = outcome.retry_after_seconds().map(|retry_after_seconds| {
        now.saturating_add(config.retry_delay_seconds(
            claim.attempt.attempt_number,
            Some(retry_after_seconds),
            entropy,
        ))
    });
    if next_attempt_at.is_some_and(|retry_at| retry_at >= claim.attempt.credential_expires_at) {
        outcome = IdentityDeliveryOutcome::PermanentFailure(
            IdentityDeliveryFailureCode::CredentialExpired,
        );
        next_attempt_at = None;
    }
    let event_kind = match (&outcome, requested_event_kind) {
        (IdentityDeliveryOutcome::Cancelled(_), _) => "auth_delivery_cancelled",
        (_, Some(event_kind)) => event_kind,
        (IdentityDeliveryOutcome::Delivered { .. }, None) => "auth_delivery_delivered",
        (
            IdentityDeliveryOutcome::RetryableFailure(_)
            | IdentityDeliveryOutcome::RetryableFailureAfter { .. },
            None,
        ) => "auth_delivery_retryable_failed",
        (IdentityDeliveryOutcome::PermanentFailure(_), None) => "auth_delivery_permanent_failed",
    };
    let outcome_code = outcome.code().map(str::to_string);
    let provider_receipt_id = outcome.provider_receipt_id().map(str::to_string);
    let delivered_at = (outcome.status() == "delivered").then_some(now);
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
            credential_envelope = CASE WHEN $3 = 'cancelled' THEN NULL ELSE credential_envelope END,
            updated_at = $9
        WHERE delivery_id = $1
          AND status = 'processing'
          AND claim_token = $2
          AND CASE $10
              WHEN 'invite' THEN EXISTS (
                  SELECT 1 FROM game_invitation
                  WHERE token_hash = $11 AND redeemed_at IS NULL AND revoked_at IS NULL
              )
              WHEN 'recovery' THEN EXISTS (
                  SELECT 1 FROM auth_account_recovery_credential
                  WHERE token_hash = $11 AND used_at IS NULL AND revoked_at IS NULL
              )
              WHEN 'community_invitation' THEN EXISTS (
                  SELECT 1 FROM community_invitation_credential
                  WHERE token_hash = $11 AND consumed_at IS NULL AND revoked_at IS NULL
              )
              ELSE FALSE
          END
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
    .bind(claim.attempt.kind.as_str())
    .bind(claim.attempt.credential_hash.as_str())
    .fetch_optional(&mut **tx)
    .await?;
    let (attempt_count, event_kind, outcome) = if let Some(attempt_count) = attempt_count {
        (attempt_count, event_kind, outcome)
    } else {
        let cancelled_attempt_count = sqlx::query_scalar::<_, i32>(
            r#"
            UPDATE auth_delivery_intent
            SET status = 'cancelled',
                outcome_kind = 'cancelled',
                outcome_code = 'credential_inactive',
                next_attempt_at = NULL,
                delivered_at = NULL,
                last_error = 'credential_inactive',
                provider_receipt_id = NULL,
                claim_token = NULL,
                claim_expires_at = NULL,
                credential_envelope = NULL,
                updated_at = $3
            WHERE delivery_id = $1
              AND status = 'processing'
              AND claim_token = $2
              AND NOT CASE $4
                  WHEN 'invite' THEN EXISTS (
                      SELECT 1 FROM game_invitation
                      WHERE token_hash = $5 AND redeemed_at IS NULL AND revoked_at IS NULL
                  )
                  WHEN 'recovery' THEN EXISTS (
                      SELECT 1 FROM auth_account_recovery_credential
                      WHERE token_hash = $5 AND used_at IS NULL AND revoked_at IS NULL
                  )
                  WHEN 'community_invitation' THEN EXISTS (
                      SELECT 1 FROM community_invitation_credential
                      WHERE token_hash = $5 AND consumed_at IS NULL AND revoked_at IS NULL
                  )
                  ELSE FALSE
              END
            RETURNING attempt_count
            "#,
        )
        .bind(claim.attempt.delivery_id)
        .bind(claim.claim_token)
        .bind(now)
        .bind(claim.attempt.kind.as_str())
        .bind(claim.attempt.credential_hash.as_str())
        .fetch_optional(&mut **tx)
        .await?;
        let Some(attempt_count) = cancelled_attempt_count else {
            // A cancellation or a newer lease changed the token while provider
            // I/O was in flight. The obsolete worker has no authority to write.
            return Ok(None);
        };
        (
            attempt_count,
            "auth_delivery_cancelled",
            IdentityDeliveryOutcome::Cancelled(
                IdentityDeliveryCancellationCode::CredentialInactive,
            ),
        )
    };
    let outcome_code = outcome.code().map(str::to_string);
    let provider_receipt_id = outcome.provider_receipt_id().map(str::to_string);
    record_delivery_audit(
        tx,
        IdentityDeliveryAuditRecord {
            event_at: now,
            event_kind,
            actor_principal_id,
            principal_id: &claim.attempt.principal_id,
            credential_hash: claim.attempt.credential_hash.as_str(),
            delivery_id: claim.attempt.delivery_id,
            delivery_kind: claim.attempt.kind,
            account_id: claim.attempt.account_id.as_str(),
            provider_id: claim.provider_id.as_str(),
            outcome_kind: outcome.kind(),
            outcome_code: outcome.code(),
            provider_receipt_id: provider_receipt_id.as_deref(),
        },
    )
    .await?;
    let receipt = IdentityDeliveryReceipt {
        delivery_id: claim.attempt.delivery_id,
        delivery_kind: claim.attempt.kind.as_str().to_string(),
        status: outcome.status().to_string(),
        attempt_count,
        provider_id: claim.provider_id,
        outcome_kind: outcome.kind().to_string(),
        outcome_code,
        provider_receipt_id,
    };
    Ok(Some(receipt))
}

async fn record_delivery_audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    record: IdentityDeliveryAuditRecord<'_>,
) -> Result<(), sqlx::Error> {
    let mut metadata = serde_json::json!({
        "delivery_id": record.delivery_id,
        "delivery_kind": record.delivery_kind.as_str(),
        "adapter": record.provider_id,
        "provider_id": record.provider_id,
        "outcome_kind": record.outcome_kind,
        "outcome_code": record.outcome_code,
        "provider_receipt_id": record.provider_receipt_id
    });
    if record.delivery_kind != IdentityDeliveryKind::CommunityInvitation {
        metadata["account_id"] = serde_json::Value::String(record.account_id.to_string());
    }
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at, event_kind, actor_principal_id, principal_id, token_hash, related_token_hash, metadata
        ) VALUES ($1, $2, $3, $4, $5, NULL, $6::JSONB)
        "#,
    )
    .bind(record.event_at)
    .bind(record.event_kind)
    .bind(record.actor_principal_id.as_uuid())
    .bind(record.principal_id.as_uuid())
    .bind(record.credential_hash)
    .bind(metadata.to_string())
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
        DisabledIdentityDeliveryGateway, IdentityDeliveryAttempt, IdentityDeliveryCancellationCode,
        IdentityDeliveryFailureCode, IdentityDeliveryGateway, IdentityDeliveryHttpTimeouts,
        IdentityDeliveryKind, IdentityDeliveryOutcome, IdentityDeliveryRetryPolicy,
        IdentityDeliveryWorkerConfig, LocalDeterministicIdentityDeliveryGateway,
        DISABLED_PROVIDER_ID, LOCAL_DETERMINISTIC_PROVIDER_ID,
    };
    use axum::response::IntoResponse;
    use principal::PrincipalId;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
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

    #[tokio::test]
    async fn http_json_gateway_bounds_a_blackholed_provider() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (_socket, _) = listener.accept().await.unwrap();
            std::future::pending::<()>().await;
        });
        let timeouts = IdentityDeliveryHttpTimeouts::new(
            Duration::from_millis(20),
            Duration::from_millis(40),
            Duration::from_millis(20),
            Duration::from_millis(60),
            1024,
        )
        .unwrap();
        let gateway = super::HttpJsonIdentityDeliveryGateway::new(
            "fixture-blackhole",
            reqwest::Url::parse(&format!("http://{address}/delivery")).unwrap(),
            None,
            reqwest::Client::new(),
        )
        .with_timeouts(timeouts);
        let mut delivery_attempt = attempt(1);
        delivery_attempt.credential_material = Some("one-time-secret".to_string());
        let started = Instant::now();
        assert_eq!(
            gateway.deliver(&delivery_attempt).await,
            IdentityDeliveryOutcome::RetryableFailure(
                IdentityDeliveryFailureCode::ProviderUnavailable
            )
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn http_json_gateway_honors_retry_after_then_reuses_delivery_id() {
        let requests = Arc::new(AtomicUsize::new(0));
        let handler_requests = requests.clone();
        let app = axum::Router::new().route(
            "/delivery",
            axum::routing::post(move |axum::Json(payload): axum::Json<serde_json::Value>| {
                let handler_requests = handler_requests.clone();
                async move {
                    assert_eq!(payload["delivery_id"], payload["idempotency_key"]);
                    if handler_requests.fetch_add(1, Ordering::SeqCst) == 0 {
                        (
                            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                            [(axum::http::header::RETRY_AFTER, "7")],
                            axum::Json(serde_json::json!({"status": "unavailable"})),
                        )
                            .into_response()
                    } else {
                        axum::Json(serde_json::json!({
                            "status": "delivered",
                            "provider_receipt_id": "provider-receipt-after-retry"
                        }))
                        .into_response()
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let gateway = super::HttpJsonIdentityDeliveryGateway::new(
            "fixture-retry",
            reqwest::Url::parse(&format!("http://{address}/delivery")).unwrap(),
            None,
            reqwest::Client::new(),
        );
        let mut delivery_attempt = attempt(1);
        delivery_attempt.credential_material = Some("one-time-secret".to_string());
        assert_eq!(
            gateway.deliver(&delivery_attempt).await,
            IdentityDeliveryOutcome::RetryableFailureAfter {
                code: IdentityDeliveryFailureCode::ProviderUnavailable,
                retry_after_seconds: 7,
            }
        );
        delivery_attempt.attempt_number = 2;
        assert_eq!(
            gateway.deliver(&delivery_attempt).await,
            IdentityDeliveryOutcome::Delivered {
                provider_receipt_id: "provider-receipt-after-retry".to_string(),
            }
        );
        assert_eq!(requests.load(Ordering::SeqCst), 2);
    }

    fn attempt(attempt_number: i32) -> IdentityDeliveryAttempt {
        IdentityDeliveryAttempt {
            delivery_id: Uuid::nil(),
            kind: IdentityDeliveryKind::Invite,
            account_id: "member@example.test".to_string(),
            principal_id: PrincipalId::fixture("member_a"),
            credential_hash: "redacted-hash".to_string(),
            credential_expires_at: 4_102_444_800,
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

    #[tokio::test]
    async fn disabled_gateway_can_never_report_delivery() {
        let gateway = DisabledIdentityDeliveryGateway;
        assert_eq!(gateway.provider_id(), DISABLED_PROVIDER_ID);
        assert_eq!(
            gateway.deliver(&attempt(1)).await,
            IdentityDeliveryOutcome::PermanentFailure(
                IdentityDeliveryFailureCode::CredentialUnavailable
            )
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
        let cancelled = IdentityDeliveryOutcome::Cancelled(
            IdentityDeliveryCancellationCode::CredentialInactive,
        );
        assert_eq!(retryable.status(), "retryable_failed");
        assert_eq!(retryable.kind(), "retryable_failure");
        assert_eq!(retryable.code(), Some("provider_unavailable"));
        assert_eq!(retryable.retry_after_seconds(), Some(1));
        assert_eq!(permanent.status(), "permanent_failed");
        assert_eq!(permanent.kind(), "permanent_failure");
        assert_eq!(permanent.code(), Some("recipient_rejected"));
        assert_eq!(permanent.retry_after_seconds(), None);
        assert_eq!(cancelled.status(), "cancelled");
        assert_eq!(cancelled.kind(), "cancelled");
        assert_eq!(cancelled.code(), Some("credential_inactive"));
        assert_eq!(cancelled.retry_after_seconds(), None);
    }

    #[test]
    fn worker_config_rejects_an_attempt_deadline_that_can_outlive_its_claim() {
        let retry =
            IdentityDeliveryRetryPolicy::new(Duration::from_secs(2), Duration::from_secs(60), 8)
                .unwrap();
        assert!(IdentityDeliveryWorkerConfig::new(
            4,
            Duration::from_millis(100),
            Duration::from_secs(10),
            Duration::from_secs(9),
            retry,
        )
        .is_err());
    }

    #[test]
    fn retry_policy_applies_full_jitter_and_provider_floor() {
        let retry =
            IdentityDeliveryRetryPolicy::new(Duration::from_secs(2), Duration::from_secs(60), 8)
                .unwrap();
        let config = IdentityDeliveryWorkerConfig::new(
            4,
            Duration::from_millis(100),
            Duration::from_secs(30),
            Duration::from_secs(5),
            retry,
        )
        .unwrap();
        assert_eq!(config.retry_delay_seconds(1, None, 0), 1);
        assert_eq!(config.retry_delay_seconds(3, None, 7), 8);
        assert_eq!(config.retry_delay_seconds(3, Some(17), 0), 17);
        assert_eq!(config.retry_delay_seconds(30, Some(600), 0), 60);
    }
}
