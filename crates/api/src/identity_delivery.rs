use eventstore::decrypt_delivery_credential;
use principal::PrincipalId;
use reqwest::{header::RETRY_AFTER, Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPool;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{fmt, fmt::Formatter, future::Future, pin::Pin};
use thiserror::Error;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::task::JoinSet;
use uuid::Uuid;

pub const LOCAL_DETERMINISTIC_PROVIDER_ID: &str = "local-deterministic";
pub const DISABLED_PROVIDER_ID: &str = "disabled";

const IDENTITY_DELIVERY_PROVIDER_AUTHORITY_LOCK: i64 = 3_558_797_279_831_991_379;
const HTTP_JSON_ADAPTER_PROTOCOL: &str = "http-json-delivery-v2+bound-result-v2+provider-probe-v1";
const LOCAL_DETERMINISTIC_CONFIGURATION_FINGERPRINT: &str =
    "4a21345ef00ace140da56603a0ed75aa2e43f2b3d0d25612c04365e8343513b3";
const DISABLED_CONFIGURATION_FINGERPRINT: &str =
    "59cca061f770a7a1ee6ed0832e40d965500c753846deff2c66f0384dd1b8a2ee";
const OPAQUE_TEST_CONFIGURATION_FINGERPRINT: &str =
    "b1723cb7bb8e2c8a4f23e2b0188a79caa85590b6b490cae9e54bfa16621c15fe";

const DEFAULT_DELIVERY_CONNECT_TIMEOUT: Duration = Duration::from_secs(1);
const DEFAULT_DELIVERY_RESPONSE_TIMEOUT: Duration = Duration::from_secs(3);
const DEFAULT_DELIVERY_BODY_TIMEOUT: Duration = Duration::from_secs(1);
const DEFAULT_DELIVERY_TOTAL_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_DELIVERY_RESPONSE_BYTES: usize = 64 * 1024;
const EXPIRED_PROVIDER_ATTEMPT_FENCE_GC_BATCH: i64 = 1_000;
const DATABASE_CLOCK_QUANTIZATION_RESERVE: Duration = Duration::from_secs(1);

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
    max_database_in_flight: usize,
    poll_interval: Duration,
    claim_lease: Duration,
    provider_clock_skew_margin: Duration,
    provider_timeout: Duration,
    database_timeout: Duration,
    retry_base: Duration,
    retry_max: Duration,
    max_attempts: i32,
}

impl IdentityDeliveryWorkerConfig {
    pub fn new(
        max_concurrency: usize,
        max_database_in_flight: usize,
        poll_interval: Duration,
        claim_lease: Duration,
        provider_clock_skew_margin: Duration,
        provider_timeout: Duration,
        database_timeout: Duration,
        retry: IdentityDeliveryRetryPolicy,
    ) -> Result<Self, String> {
        if !(1..=64).contains(&max_concurrency) {
            return Err("identity delivery concurrency must be between 1 and 64".to_string());
        }
        if !(1..=max_concurrency).contains(&max_database_in_flight) {
            return Err(
                "identity delivery database concurrency must be positive and must not exceed provider concurrency"
                    .to_string(),
            );
        }
        if poll_interval.is_zero() || poll_interval > Duration::from_secs(60) {
            return Err("identity delivery poll interval must be in (0ms, 60s]".to_string());
        }
        if provider_timeout.is_zero() || provider_timeout > Duration::from_secs(120) {
            return Err("identity delivery provider timeout must be in (0ms, 120s]".to_string());
        }
        if database_timeout.is_zero() || database_timeout > Duration::from_secs(120) {
            return Err("identity delivery database timeout must be in (0ms, 120s]".to_string());
        }
        if provider_clock_skew_margin.subsec_nanos() != 0
            || !(1..=60).contains(&provider_clock_skew_margin.as_secs())
        {
            return Err(
                "identity delivery provider clock-skew margin must use 1..=60 whole seconds"
                    .to_string(),
            );
        }
        let post_claim_timeout = provider_timeout
            .saturating_add(database_timeout)
            .saturating_add(database_timeout);
        let lease_coverage_timeout = post_claim_timeout.saturating_add(database_timeout);
        if claim_lease.subsec_nanos() != 0
            || claim_lease.as_secs() < 2
            || claim_lease > Duration::from_secs(300)
            || claim_lease
                <= lease_coverage_timeout
                    .saturating_add(provider_clock_skew_margin)
                    .saturating_add(DATABASE_CLOCK_QUANTIZATION_RESERVE)
        {
            return Err(
                "identity delivery claim lease must use 2..=300 whole seconds and exceed the bounded claim commit, preparation, provider, and finalization lifetime by the provider clock-skew margin plus a one-second database-clock quantization reserve"
                    .to_string(),
            );
        }
        Ok(Self {
            max_concurrency,
            max_database_in_flight,
            poll_interval,
            claim_lease,
            provider_clock_skew_margin,
            provider_timeout,
            database_timeout,
            retry_base: retry.base,
            retry_max: retry.max,
            max_attempts: retry.max_attempts,
        })
    }

    pub fn max_concurrency(self) -> usize {
        self.max_concurrency
    }

    pub fn max_database_in_flight(self) -> usize {
        self.max_database_in_flight
    }

    pub fn poll_interval(self) -> Duration {
        self.poll_interval
    }

    pub fn claim_lease(self) -> Duration {
        self.claim_lease
    }

    pub fn provider_clock_skew_margin(self) -> Duration {
        self.provider_clock_skew_margin
    }

    fn provider_effect_deadline_at(self, generation_fence_expires_at: i64) -> i64 {
        generation_fence_expires_at.saturating_sub(self.provider_clock_skew_margin.as_secs() as i64)
    }

    pub fn provider_timeout(self) -> Duration {
        self.provider_timeout
    }

    pub fn database_timeout(self) -> Duration {
        self.database_timeout
    }

    /// Maximum post-claim lifetime drained during shutdown: one preparation
    /// database phase, one provider phase, and one finalization database phase.
    pub fn total_timeout(self) -> Duration {
        self.provider_timeout
            .saturating_add(self.database_timeout)
            .saturating_add(self.database_timeout)
    }

    /// Maximum authority lifetime measured from the claim mutation clock. The
    /// extra database phase reserves a full budget for the claim commit itself.
    pub fn lease_coverage_timeout(self) -> Duration {
        self.total_timeout().saturating_add(self.database_timeout)
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
            .saturating_mul(1_u64 << exponent)
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
            max_database_in_flight: 2,
            poll_interval: Duration::from_millis(100),
            claim_lease: Duration::from_secs(40),
            provider_clock_skew_margin: Duration::from_secs(5),
            provider_timeout: Duration::from_secs(10),
            database_timeout: Duration::from_secs(5),
            retry_base: Duration::from_secs(2),
            retry_max: Duration::from_secs(300),
            max_attempts: 8,
        }
    }
}

/// Process-wide admission shared by the supervised worker and synchronous
/// operator retries. One budget therefore bounds provider and database load
/// regardless of which claim path wins.
#[derive(Clone)]
pub struct IdentityDeliveryAdmission {
    attempt_slots: Arc<Semaphore>,
    database_slots: Arc<Semaphore>,
}

impl IdentityDeliveryAdmission {
    pub fn new(config: IdentityDeliveryWorkerConfig) -> Self {
        Self {
            attempt_slots: Arc::new(Semaphore::new(config.max_concurrency())),
            database_slots: Arc::new(Semaphore::new(config.max_database_in_flight())),
        }
    }

    pub(super) fn try_acquire_attempt(&self) -> Option<OwnedSemaphorePermit> {
        self.attempt_slots.clone().try_acquire_owned().ok()
    }

    async fn acquire_attempt(&self) -> OwnedSemaphorePermit {
        self.attempt_slots
            .clone()
            .acquire_owned()
            .await
            .expect("identity delivery attempt admission remains open")
    }

    async fn acquire_database(&self) -> OwnedSemaphorePermit {
        self.database_slots
            .clone()
            .acquire_owned()
            .await
            .expect("identity delivery database admission remains open")
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
    pub attempt_token: Uuid,
    pub lease_expires_at: i64,
    pub clock_skew_margin_seconds: i64,
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
            .field("account_id", &"[redacted]")
            .field("principal_id", &self.principal_id)
            .field("credential_hash", &"[redacted]")
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
    /// The local caller stopped observing the provider before it could prove
    /// that the remote handler had completed. The anonymous attempt fence must
    /// remain until the later generation-fence deadline expires.
    UncertainFailure {
        code: IdentityDeliveryFailureCode,
        retry_after_seconds: Option<i64>,
    },
    PermanentFailure(IdentityDeliveryFailureCode),
    Cancelled(IdentityDeliveryCancellationCode),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityDeliveryProviderProbeOutcome {
    Available,
    Unavailable,
}

impl IdentityDeliveryOutcome {
    pub fn status(&self) -> &'static str {
        match self {
            Self::Delivered { .. } => "delivered",
            Self::RetryableFailure(_)
            | Self::RetryableFailureAfter { .. }
            | Self::UncertainFailure { .. } => "retryable_failed",
            Self::PermanentFailure(_) => "permanent_failed",
            Self::Cancelled(_) => "cancelled",
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::Delivered { .. } => "delivered",
            Self::RetryableFailure(_)
            | Self::RetryableFailureAfter { .. }
            | Self::UncertainFailure { .. } => "retryable_failure",
            Self::PermanentFailure(_) => "permanent_failure",
            Self::Cancelled(_) => "cancelled",
        }
    }

    pub fn code(&self) -> Option<&'static str> {
        match self {
            Self::Delivered { .. } => None,
            Self::RetryableFailure(code) | Self::PermanentFailure(code) => Some(code.as_str()),
            Self::RetryableFailureAfter { code, .. } => Some(code.as_str()),
            Self::UncertainFailure { code, .. } => Some(code.as_str()),
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
            Self::UncertainFailure {
                retry_after_seconds,
                ..
            } => Some(retry_after_seconds.unwrap_or(1)),
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
            | Self::UncertainFailure { .. }
            | Self::PermanentFailure(_)
            | Self::Cancelled(_) => None,
        }
    }

    fn provider_unavailable(&self) -> bool {
        matches!(
            self,
            Self::RetryableFailure(IdentityDeliveryFailureCode::ProviderUnavailable)
                | Self::RetryableFailureAfter {
                    code: IdentityDeliveryFailureCode::ProviderUnavailable,
                    ..
                }
                | Self::UncertainFailure {
                    code: IdentityDeliveryFailureCode::ProviderUnavailable,
                    ..
                }
        )
    }

    fn provider_completion_uncertain(&self) -> bool {
        matches!(self, Self::UncertainFailure { .. })
    }
}

/// Orchestration-owned resolution of a claimed delivery. Provider gateways can
/// construct only `IdentityDeliveryOutcome`; pre-invocation failures are
/// deliberately private because only orchestration-proven absence of provider
/// I/O may reuse an attempt generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IdentityDeliveryPreInvocationFailure {
    ProviderSuspended,
    PreparationTransient,
}

impl IdentityDeliveryPreInvocationFailure {
    fn code(self) -> &'static str {
        match self {
            Self::ProviderSuspended => "provider_suspended_before_invocation",
            Self::PreparationTransient => "local_transient_before_provider_invocation",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum IdentityDeliveryResolution {
    Outcome(IdentityDeliveryOutcome),
    RetryableBeforeProviderInvocation(IdentityDeliveryPreInvocationFailure),
}

impl IdentityDeliveryResolution {
    fn status(&self) -> &'static str {
        match self {
            Self::Outcome(outcome) => outcome.status(),
            Self::RetryableBeforeProviderInvocation(_) => "retryable_failed",
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            Self::Outcome(outcome) => outcome.kind(),
            Self::RetryableBeforeProviderInvocation(_) => "retryable_failure",
        }
    }

    fn code(&self) -> Option<&'static str> {
        match self {
            Self::Outcome(outcome) => outcome.code(),
            Self::RetryableBeforeProviderInvocation(failure) => Some(failure.code()),
        }
    }

    fn retry_after_seconds(&self) -> Option<i64> {
        match self {
            Self::Outcome(outcome) => outcome.retry_after_seconds(),
            Self::RetryableBeforeProviderInvocation(_) => Some(1),
        }
    }

    fn provider_receipt_id(&self) -> Option<&str> {
        match self {
            Self::Outcome(outcome) => outcome.provider_receipt_id(),
            Self::RetryableBeforeProviderInvocation(_) => None,
        }
    }

    fn provider_unavailable(&self) -> bool {
        match self {
            Self::Outcome(outcome) => outcome.provider_unavailable(),
            Self::RetryableBeforeProviderInvocation(_) => false,
        }
    }

    fn provider_completion_uncertain(&self) -> bool {
        match self {
            Self::Outcome(outcome) => outcome.provider_completion_uncertain(),
            Self::RetryableBeforeProviderInvocation(_) => false,
        }
    }

    fn preserves_attempt_generation(&self) -> bool {
        matches!(self, Self::RetryableBeforeProviderInvocation(_))
    }

    fn is_cancelled(&self) -> bool {
        matches!(self, Self::Outcome(IdentityDeliveryOutcome::Cancelled(_)))
    }

    fn is_delivered(&self) -> bool {
        matches!(
            self,
            Self::Outcome(IdentityDeliveryOutcome::Delivered { .. })
        )
    }

    fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::RetryableBeforeProviderInvocation(_)
                | Self::Outcome(
                    IdentityDeliveryOutcome::RetryableFailure(_)
                        | IdentityDeliveryOutcome::RetryableFailureAfter { .. }
                        | IdentityDeliveryOutcome::UncertainFailure { .. }
                )
        )
    }
}

pub type IdentityDeliveryFuture<'a> =
    Pin<Box<dyn Future<Output = IdentityDeliveryOutcome> + Send + 'a>>;
pub type IdentityDeliveryProviderProbeFuture<'a> =
    Pin<Box<dyn Future<Output = IdentityDeliveryProviderProbeOutcome> + Send + 'a>>;

pub trait IdentityDeliveryGateway: Send + Sync {
    /// A retained, never-reused name for this exact provider generation.
    fn provider_id(&self) -> &str;

    /// Nonsecret digest of the adapter protocol and delivery endpoint. Bearer
    /// credentials must never participate in this value, which lets tokens
    /// rotate without changing the generation's durable identity.
    fn configuration_fingerprint(&self) -> &str {
        OPAQUE_TEST_CONFIGURATION_FINGERPRINT
    }

    /// Whether this gateway is backed by a configured delivery transport.
    ///
    /// Identity delivery is independent of the enabled authentication methods,
    /// but credential issuance must fail closed when no transport is configured.
    fn is_enabled(&self) -> bool {
        true
    }

    /// A live database claim permits at most one invocation, but a process can
    /// fail after provider acceptance and before claim finalization. Gateways
    /// must therefore use `attempt.delivery_id` as the stable idempotency key
    /// across lease recovery and later attempts.
    fn deliver<'a>(&'a self, attempt: &'a IdentityDeliveryAttempt) -> IdentityDeliveryFuture<'a>;

    /// Credential-free recovery ceremony for a suspended provider circuit.
    /// Implementations must exercise the same authenticated endpoint and
    /// adapter generation as delivery without accepting credential material.
    fn probe<'a>(&'a self, probe_token: Uuid) -> IdentityDeliveryProviderProbeFuture<'a>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct DisabledIdentityDeliveryGateway;

impl IdentityDeliveryGateway for DisabledIdentityDeliveryGateway {
    fn provider_id(&self) -> &str {
        DISABLED_PROVIDER_ID
    }

    fn is_enabled(&self) -> bool {
        false
    }

    fn configuration_fingerprint(&self) -> &str {
        DISABLED_CONFIGURATION_FINGERPRINT
    }

    fn deliver<'a>(&'a self, _attempt: &'a IdentityDeliveryAttempt) -> IdentityDeliveryFuture<'a> {
        Box::pin(async {
            IdentityDeliveryOutcome::PermanentFailure(
                IdentityDeliveryFailureCode::CredentialUnavailable,
            )
        })
    }

    fn probe<'a>(&'a self, _probe_token: Uuid) -> IdentityDeliveryProviderProbeFuture<'a> {
        Box::pin(async { IdentityDeliveryProviderProbeOutcome::Unavailable })
    }
}

#[derive(Debug, Clone, Copy)]
pub struct LocalDeterministicIdentityDeliveryGateway {
    fail_first_attempt: bool,
}

impl LocalDeterministicIdentityDeliveryGateway {
    pub fn new(fail_first_attempt: bool) -> Self {
        Self { fail_first_attempt }
    }
}

impl IdentityDeliveryGateway for LocalDeterministicIdentityDeliveryGateway {
    fn provider_id(&self) -> &str {
        LOCAL_DETERMINISTIC_PROVIDER_ID
    }

    fn configuration_fingerprint(&self) -> &str {
        LOCAL_DETERMINISTIC_CONFIGURATION_FINGERPRINT
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

    fn probe<'a>(&'a self, _probe_token: Uuid) -> IdentityDeliveryProviderProbeFuture<'a> {
        Box::pin(async { IdentityDeliveryProviderProbeOutcome::Available })
    }
}

#[derive(Clone)]
pub struct HttpJsonIdentityDeliveryGateway {
    provider_id: String,
    endpoint: Url,
    configuration_fingerprint: String,
    auth_token: Option<String>,
    client: Client,
    timeouts: IdentityDeliveryHttpTimeouts,
}

impl HttpJsonIdentityDeliveryGateway {
    pub fn new(
        provider_id: impl Into<String>,
        endpoint: Url,
        auth_token: Option<String>,
        client: Client,
    ) -> Self {
        let configuration_fingerprint =
            identity_delivery_configuration_fingerprint(HTTP_JSON_ADAPTER_PROTOCOL, &endpoint);
        Self {
            provider_id: provider_id.into(),
            endpoint,
            configuration_fingerprint,
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
        if !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
        {
            return Err(
                "identity delivery endpoint must not contain credentials, query, or fragment"
                    .to_string(),
            );
        }
        if auth_token
            .as_deref()
            .is_some_and(|token| token.trim().is_empty())
        {
            return Err("identity delivery auth token must not be blank".to_string());
        }
        let client = Client::builder()
            .connect_timeout(timeouts.connect)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("identity delivery HTTP client is invalid: {error}"))?;
        let configuration_fingerprint =
            identity_delivery_configuration_fingerprint(HTTP_JSON_ADAPTER_PROTOCOL, &endpoint);
        Ok(Self {
            provider_id,
            endpoint,
            configuration_fingerprint,
            auth_token,
            client,
            timeouts,
        })
    }

    pub fn with_timeouts(mut self, timeouts: IdentityDeliveryHttpTimeouts) -> Self {
        self.timeouts = timeouts;
        self
    }

    pub fn total_timeout(&self) -> Duration {
        self.timeouts.total()
    }

    async fn deliver_http(&self, attempt: &IdentityDeliveryAttempt) -> IdentityDeliveryOutcome {
        match tokio::time::timeout(
            self.timeouts.total,
            self.deliver_http_with_deadlines(attempt),
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(_) => IdentityDeliveryOutcome::UncertainFailure {
                code: IdentityDeliveryFailureCode::ProviderUnavailable,
                retry_after_seconds: None,
            },
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
            schema: "fmarch.identity-delivery.v2",
            provider_generation: self.provider_id.as_str(),
            delivery_id: attempt.delivery_id,
            attempt_token: attempt.attempt_token,
            lease_expires_at: attempt.lease_expires_at,
            clock_skew_margin_seconds: attempt.clock_skew_margin_seconds,
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
                return IdentityDeliveryOutcome::UncertainFailure {
                    code: IdentityDeliveryFailureCode::ProviderUnavailable,
                    retry_after_seconds: None,
                }
            }
        };
        let status = response.status();
        let retry_after_seconds = parse_retry_after_seconds(response.headers());
        // Only an attempt-bound completion acknowledgement proves that the
        // provider handler has quiesced. An intermediary may synthesize any
        // non-success status while an upstream handler remains live, so every
        // transport-level rejection is uncertain remote execution.
        if !status.is_success() {
            return IdentityDeliveryOutcome::UncertainFailure {
                code: IdentityDeliveryFailureCode::ProviderUnavailable,
                retry_after_seconds,
            };
        }
        if response
            .content_length()
            .is_some_and(|length| length > self.timeouts.max_response_bytes as u64)
        {
            return IdentityDeliveryOutcome::UncertainFailure {
                code: IdentityDeliveryFailureCode::ProviderUnavailable,
                retry_after_seconds: None,
            };
        }
        let response_bytes = match tokio::time::timeout(
            self.timeouts.body,
            read_bounded_delivery_response(response, self.timeouts.max_response_bytes),
        )
        .await
        {
            Ok(Some(bytes)) => bytes,
            Ok(None) | Err(_) => {
                return IdentityDeliveryOutcome::UncertainFailure {
                    code: IdentityDeliveryFailureCode::ProviderUnavailable,
                    retry_after_seconds: None,
                }
            }
        };
        let provider_response =
            match serde_json::from_slice::<IdentityDeliveryProviderResponse>(&response_bytes) {
                Ok(response) => response,
                Err(_) => {
                    return IdentityDeliveryOutcome::UncertainFailure {
                        code: IdentityDeliveryFailureCode::ProviderUnavailable,
                        retry_after_seconds: None,
                    }
                }
            };
        if provider_response.schema != "fmarch.identity-delivery-result.v2"
            || provider_response.provider_generation != self.provider_id
            || provider_response.delivery_id != attempt.delivery_id
            || provider_response.attempt_token != attempt.attempt_token
        {
            return IdentityDeliveryOutcome::UncertainFailure {
                code: IdentityDeliveryFailureCode::ProviderUnavailable,
                retry_after_seconds: None,
            };
        }
        match (
            provider_response.status.as_str(),
            provider_response.code.as_deref(),
            provider_response.provider_receipt_id,
            provider_response.retry_after_seconds,
        ) {
            ("delivered", None, Some(provider_receipt_id), None)
                if !provider_receipt_id.trim().is_empty() =>
            {
                IdentityDeliveryOutcome::Delivered {
                    provider_receipt_id,
                }
            }
            ("retryable_failure", Some("provider_unavailable"), None, retry_after_seconds)
                if retry_after_seconds.is_none_or(|seconds| seconds >= 0) =>
            {
                retry_after_seconds
                    .map(
                        |retry_after_seconds| IdentityDeliveryOutcome::RetryableFailureAfter {
                            code: IdentityDeliveryFailureCode::ProviderUnavailable,
                            retry_after_seconds,
                        },
                    )
                    .unwrap_or(IdentityDeliveryOutcome::RetryableFailure(
                        IdentityDeliveryFailureCode::ProviderUnavailable,
                    ))
            }
            ("permanent_failure", Some("recipient_rejected"), None, None) => {
                IdentityDeliveryOutcome::PermanentFailure(
                    IdentityDeliveryFailureCode::RecipientRejected,
                )
            }
            ("permanent_failure", Some("credential_unavailable"), None, None) => {
                IdentityDeliveryOutcome::PermanentFailure(
                    IdentityDeliveryFailureCode::CredentialUnavailable,
                )
            }
            ("permanent_failure", Some("credential_expired"), None, None) => {
                IdentityDeliveryOutcome::PermanentFailure(
                    IdentityDeliveryFailureCode::CredentialExpired,
                )
            }
            _ => IdentityDeliveryOutcome::UncertainFailure {
                code: IdentityDeliveryFailureCode::ProviderUnavailable,
                retry_after_seconds: None,
            },
        }
    }

    async fn probe_http(&self, probe_token: Uuid) -> IdentityDeliveryProviderProbeOutcome {
        match tokio::time::timeout(
            self.timeouts.total,
            self.probe_http_with_deadlines(probe_token),
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(_) => IdentityDeliveryProviderProbeOutcome::Unavailable,
        }
    }

    async fn probe_http_with_deadlines(
        &self,
        probe_token: Uuid,
    ) -> IdentityDeliveryProviderProbeOutcome {
        let request = IdentityDeliveryProviderProbeWireRequest {
            schema: "fmarch.identity-delivery-provider-probe.v1",
            provider_generation: self.provider_id.as_str(),
            probe_token,
        };
        let mut builder = self.client.post(self.endpoint.clone()).json(&request);
        if let Some(auth_token) = self.auth_token.as_deref() {
            builder = builder.bearer_auth(auth_token);
        }
        let response = match tokio::time::timeout(self.timeouts.response, builder.send()).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) | Err(_) => return IdentityDeliveryProviderProbeOutcome::Unavailable,
        };
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|length| length > self.timeouts.max_response_bytes as u64)
        {
            return IdentityDeliveryProviderProbeOutcome::Unavailable;
        }
        let response_bytes = match tokio::time::timeout(
            self.timeouts.body,
            read_bounded_delivery_response(response, self.timeouts.max_response_bytes),
        )
        .await
        {
            Ok(Some(bytes)) => bytes,
            Ok(None) | Err(_) => return IdentityDeliveryProviderProbeOutcome::Unavailable,
        };
        match serde_json::from_slice::<IdentityDeliveryProviderProbeWireResponse>(&response_bytes) {
            Ok(response)
                if response.schema == "fmarch.identity-delivery-provider-probe.v1"
                    && response.provider_generation == self.provider_id
                    && response.probe_token == probe_token
                    && response.status == "available" =>
            {
                IdentityDeliveryProviderProbeOutcome::Available
            }
            _ => IdentityDeliveryProviderProbeOutcome::Unavailable,
        }
    }
}

async fn read_bounded_delivery_response(
    mut response: reqwest::Response,
    max_response_bytes: usize,
) -> Option<Vec<u8>> {
    let mut body = Vec::with_capacity(max_response_bytes.min(8 * 1024));
    loop {
        let chunk = response.chunk().await.ok()?;
        let Some(chunk) = chunk else {
            return Some(body);
        };
        let next_len = body.len().checked_add(chunk.len())?;
        if next_len > max_response_bytes {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
}

#[derive(Debug, Serialize)]
struct IdentityDeliveryProviderRequest<'a> {
    schema: &'static str,
    provider_generation: &'a str,
    delivery_id: Uuid,
    attempt_token: Uuid,
    lease_expires_at: i64,
    clock_skew_margin_seconds: i64,
    delivery_kind: &'static str,
    account_id: &'a str,
    principal_id: &'a PrincipalId,
    credential: &'a str,
    attempt_number: i32,
    idempotency_key: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct IdentityDeliveryProviderResponse {
    schema: String,
    provider_generation: String,
    delivery_id: Uuid,
    attempt_token: Uuid,
    status: String,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    provider_receipt_id: Option<String>,
    #[serde(default)]
    retry_after_seconds: Option<i64>,
}

#[derive(Debug, Serialize)]
struct IdentityDeliveryProviderProbeWireRequest<'a> {
    schema: &'static str,
    provider_generation: &'a str,
    probe_token: Uuid,
}

#[derive(Debug, Deserialize)]
struct IdentityDeliveryProviderProbeWireResponse {
    schema: String,
    provider_generation: String,
    probe_token: Uuid,
    status: String,
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

    fn configuration_fingerprint(&self) -> &str {
        self.configuration_fingerprint.as_str()
    }

    fn deliver<'a>(&'a self, attempt: &'a IdentityDeliveryAttempt) -> IdentityDeliveryFuture<'a> {
        Box::pin(self.deliver_http(attempt))
    }

    fn probe<'a>(&'a self, probe_token: Uuid) -> IdentityDeliveryProviderProbeFuture<'a> {
        Box::pin(self.probe_http(probe_token))
    }
}

pub fn identity_delivery_configuration_fingerprint(
    adapter_protocol: &str,
    endpoint: &Url,
) -> String {
    format!(
        "{:x}",
        Sha256::digest(
            format!(
                "fmarch.identity-delivery.adapter.v1\n{adapter_protocol}\n{}",
                endpoint.as_str()
            )
            .as_bytes()
        )
    )
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ExpectedIdentityDeliveryAttemptCount(i32);

impl ExpectedIdentityDeliveryAttemptCount {
    pub(super) fn new(value: i32) -> Option<Self> {
        (value >= 0).then_some(Self(value))
    }

    fn get(self) -> i32 {
        self.0
    }
}

pub(super) struct IdentityDeliveryRetryRequest<'a> {
    pub(super) delivery_id: Uuid,
    pub(super) expected_attempt_count: ExpectedIdentityDeliveryAttemptCount,
    pub(super) initiating_session: &'a identity::InitiatingSession,
    pub(super) session_policy: &'a identity::SessionPolicy,
}

pub(super) enum IdentityDeliveryRetryResult {
    Applied(IdentityDeliveryReceipt),
    Conflict,
}

pub(super) struct IdentityDeliveryProviderProbeRequest<'a> {
    pub(super) initiating_session: &'a identity::InitiatingSession,
    pub(super) session_policy: &'a identity::SessionPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct IdentityDeliveryProviderProbeReceipt {
    pub(super) provider_generation: String,
    pub(super) outcome: &'static str,
    pub(super) operable: bool,
    pub(super) circuit_version: i64,
}

pub(super) enum IdentityDeliveryProviderProbeResult {
    Applied(IdentityDeliveryProviderProbeReceipt),
    Conflict,
    NotSuspended,
}

type IdentityDeliveryTaskOutput = Result<Option<IdentityDeliveryReceipt>, IdentityDeliveryError>;
type JoinedIdentityDeliveryTask = Result<IdentityDeliveryTaskOutput, tokio::task::JoinError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdentityDeliveryWorkerObservation {
    pub completed: u64,
    pub attempt_errors: u64,
    pub in_flight: usize,
    pub kind: IdentityDeliveryWorkerObservationKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityDeliveryWorkerObservationKind {
    EmptyClaim,
    ProviderSuspended,
    AttemptStarted,
    TimerTick,
    AttemptFinished,
}

#[derive(Debug, Error)]
pub enum IdentityDeliveryError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("delivery credential envelope error: {0}")]
    Credential(String),
    #[error(transparent)]
    Identity(#[from] identity::IdentityFlowError),
    #[error("identity delivery retry requires current GlobalAdmin authority")]
    NotAuthorized,
    #[error("identity delivery provider continuity check failed: {0}")]
    ProviderContinuity(String),
    #[error("identity delivery provider authority is suspended")]
    ProviderSuspended,
    #[error("identity delivery worker task failed: {0}")]
    Worker(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IdentityDeliveryProviderStatus {
    pub configured: bool,
    pub bound: bool,
    pub operable: bool,
    pub configured_generation: String,
    pub active_generation: Option<String>,
    pub suspension_code: Option<String>,
    pub probe_in_flight: bool,
    pub circuit_version: Option<i64>,
}

#[derive(Debug)]
struct LockedIdentityDeliveryProviderAuthority;

#[derive(Debug, sqlx::FromRow)]
struct IdentityDeliveryProviderAuthorityRow {
    generation_id: String,
    configuration_fingerprint: String,
    circuit_version: i64,
    suspended_at: Option<i64>,
    suspension_code: Option<String>,
    probe_token: Option<Uuid>,
    probe_expires_at: Option<i64>,
}

fn validate_provider_authority_configuration(
    gateway: &dyn IdentityDeliveryGateway,
) -> Result<(), IdentityDeliveryError> {
    let generation = gateway.provider_id();
    if generation.is_empty() || generation.trim() != generation || generation.len() > 128 {
        return Err(IdentityDeliveryError::ProviderContinuity(
            "provider generation must be 1..=128 unpadded bytes".to_string(),
        ));
    }
    let fingerprint = gateway.configuration_fingerprint();
    if fingerprint.len() != 64
        || !fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(IdentityDeliveryError::ProviderContinuity(
            "provider configuration fingerprint must be 64 lowercase hexadecimal bytes".to_string(),
        ));
    }
    Ok(())
}

async fn lock_provider_authority_protocol(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(IDENTITY_DELIVERY_PROVIDER_AUTHORITY_LOCK)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn database_now(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT floor(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT")
        .fetch_one(&mut **tx)
        .await
}

async fn lock_identity_delivery_provider_authority(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    gateway: &dyn IdentityDeliveryGateway,
) -> Result<LockedIdentityDeliveryProviderAuthority, IdentityDeliveryError> {
    validate_provider_authority_configuration(gateway)?;
    if !gateway.is_enabled() {
        return Err(IdentityDeliveryError::ProviderSuspended);
    }
    let active = sqlx::query_as::<_, (String, String, Option<i64>)>(
        "SELECT generation_id, configuration_fingerprint, suspended_at \
         FROM auth_delivery_provider_authority \
         WHERE retired_at IS NULL FOR SHARE",
    )
    .fetch_optional(&mut **tx)
    .await?;
    let Some((generation, fingerprint, suspended_at)) = active else {
        return Err(IdentityDeliveryError::ProviderContinuity(
            "provider authority has no active startup binding".to_string(),
        ));
    };
    if generation != gateway.provider_id() {
        return Err(IdentityDeliveryError::ProviderContinuity(format!(
            "configured generation '{}' does not match active generation '{}'",
            gateway.provider_id(),
            generation
        )));
    }
    if fingerprint != gateway.configuration_fingerprint() {
        return Err(IdentityDeliveryError::ProviderContinuity(format!(
            "configured generation '{}' changed adapter endpoint fingerprint; select a fresh generation",
            gateway.provider_id()
        )));
    }
    if suspended_at.is_some() {
        return Err(IdentityDeliveryError::ProviderSuspended);
    }
    Ok(LockedIdentityDeliveryProviderAuthority)
}

pub(super) async fn require_identity_delivery_provider_operable(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    gateway: &dyn IdentityDeliveryGateway,
) -> Result<(), IdentityDeliveryError> {
    if !gateway.is_enabled() {
        return Err(IdentityDeliveryError::ProviderSuspended);
    }
    lock_identity_delivery_provider_authority(tx, gateway).await?;
    Ok(())
}

pub(super) async fn require_identity_delivery_provider_operable_now(
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
) -> Result<(), IdentityDeliveryError> {
    let mut tx = pool.begin().await?;
    require_identity_delivery_provider_operable(&mut tx, gateway).await?;
    tx.commit().await?;
    Ok(())
}

/// Bind the configured adapter generation before the process serves traffic.
///
/// Generation mutation is serialized by a transaction-scoped advisory lock.
/// Runtime enqueue and claim transactions hold the active row `FOR SHARE`, so
/// a rolling cutover waits for every old-generation decision to commit. A
/// generation switch is permitted only after all delivery work is terminal;
/// retained generation names can never be reused.
pub async fn bind_identity_delivery_provider_authority(
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
) -> Result<IdentityDeliveryProviderStatus, IdentityDeliveryError> {
    validate_provider_authority_configuration(gateway)?;
    if !gateway.is_enabled() {
        return Err(IdentityDeliveryError::ProviderContinuity(
            "identity delivery transport is not configured".to_string(),
        ));
    }
    let mut tx = pool.begin().await?;
    lock_provider_authority_protocol(&mut tx).await?;
    let active = sqlx::query_as::<_, IdentityDeliveryProviderAuthorityRow>(
        "SELECT generation_id, configuration_fingerprint, circuit_version, suspended_at, \
                suspension_code, probe_token, probe_expires_at \
         FROM auth_delivery_provider_authority \
         WHERE retired_at IS NULL FOR UPDATE",
    )
    .fetch_optional(&mut *tx)
    .await?;
    let now = database_now(&mut tx).await?;
    // Attempt fences are deliberately anonymous and may outlive a crashed or
    // erased delivery row. Startup is the durable garbage collector for every
    // generation, including an unchanged one, so steady-state restarts cannot
    // accumulate expired authority records forever.
    sqlx::query("DELETE FROM auth_delivery_provider_attempt_fence WHERE expires_at <= $1")
        .bind(now)
        .execute(&mut *tx)
        .await?;

    let active = match active {
        Some(active) if active.generation_id == gateway.provider_id() => {
            if active.configuration_fingerprint != gateway.configuration_fingerprint() {
                return Err(IdentityDeliveryError::ProviderContinuity(format!(
                    "configured generation '{}' changed adapter endpoint fingerprint; select a fresh generation",
                    gateway.provider_id()
                )));
            }
            sqlx::query_as::<_, IdentityDeliveryProviderAuthorityRow>(
                "UPDATE auth_delivery_provider_authority \
                 SET last_bound_at = GREATEST(last_bound_at, $2), \
                     circuit_version = circuit_version + CASE \
                         WHEN probe_token IS NOT NULL AND probe_expires_at <= $2 THEN 1 ELSE 0 END, \
                     probe_token = CASE WHEN probe_expires_at <= $2 THEN NULL ELSE probe_token END, \
                     probe_expires_at = CASE WHEN probe_expires_at <= $2 THEN NULL ELSE probe_expires_at END \
                 WHERE generation_id = $1 AND retired_at IS NULL \
                 RETURNING generation_id, configuration_fingerprint, circuit_version, \
                           suspended_at, suspension_code, probe_token, probe_expires_at",
            )
            .bind(gateway.provider_id())
            .bind(now)
            .fetch_one(&mut *tx)
            .await?
        }
        active => {
            let live_attempt_generations = sqlx::query_scalar::<_, String>(
                "SELECT DISTINCT generation_id \
                 FROM auth_delivery_provider_attempt_fence \
                 WHERE expires_at > $1 ORDER BY generation_id",
            )
            .bind(now)
            .fetch_all(&mut *tx)
            .await?;
            if !live_attempt_generations.is_empty() {
                return Err(IdentityDeliveryError::ProviderContinuity(format!(
                    "generation switch requires all provider attempts to quiesce; live generations: {}",
                    live_attempt_generations.join(", ")
                )));
            }
            let nonterminal_generations = sqlx::query_scalar::<_, String>(
                "SELECT DISTINCT provider_id FROM auth_delivery_intent \
                 WHERE status IN ('queued', 'processing', 'retryable_failed') \
                 ORDER BY provider_id",
            )
            .fetch_all(&mut *tx)
            .await?;
            if !nonterminal_generations.is_empty() {
                return Err(IdentityDeliveryError::ProviderContinuity(format!(
                    "generation switch requires a drained delivery queue; nonterminal generations: {}",
                    nonterminal_generations.join(", ")
                )));
            }
            let generation_was_retained = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (SELECT 1 FROM auth_delivery_provider_authority WHERE generation_id = $1)",
            )
            .bind(gateway.provider_id())
            .fetch_one(&mut *tx)
            .await?;
            if generation_was_retained {
                return Err(IdentityDeliveryError::ProviderContinuity(format!(
                    "provider generation '{}' was already used and cannot be reactivated",
                    gateway.provider_id()
                )));
            }
            if let Some(previous) = active {
                sqlx::query(
                    "UPDATE auth_delivery_provider_authority \
                     SET retired_at = $2, circuit_version = circuit_version + 1, \
                         suspended_at = NULL, suspension_code = NULL, \
                         suspension_observation_id = NULL, probe_token = NULL, \
                         probe_expires_at = NULL \
                     WHERE generation_id = $1 AND retired_at IS NULL",
                )
                .bind(previous.generation_id)
                .bind(now)
                .execute(&mut *tx)
                .await?;
            }
            sqlx::query(
                "INSERT INTO auth_delivery_provider_authority (\
                    generation_id, configuration_fingerprint, activated_at, last_bound_at, \
                    circuit_version, retired_at, suspended_at, suspension_code, \
                    suspension_observation_id, probe_token, probe_expires_at\
                 ) VALUES ($1, $2, $3, $3, 0, NULL, NULL, NULL, NULL, NULL, NULL)",
            )
            .bind(gateway.provider_id())
            .bind(gateway.configuration_fingerprint())
            .bind(now)
            .execute(&mut *tx)
            .await?;
            IdentityDeliveryProviderAuthorityRow {
                generation_id: gateway.provider_id().to_string(),
                configuration_fingerprint: gateway.configuration_fingerprint().to_string(),
                circuit_version: 0,
                suspended_at: None,
                suspension_code: None,
                probe_token: None,
                probe_expires_at: None,
            }
        }
    };
    tx.commit().await?;
    Ok(IdentityDeliveryProviderStatus {
        configured: true,
        bound: true,
        operable: active.suspended_at.is_none(),
        configured_generation: gateway.provider_id().to_string(),
        active_generation: Some(active.generation_id),
        suspension_code: active.suspension_code,
        probe_in_flight: active
            .probe_expires_at
            .is_some_and(|probe_expires_at| probe_expires_at > now),
        circuit_version: Some(active.circuit_version),
    })
}

/// Read provider diagnostics without mutating or locking its authority row.
pub async fn identity_delivery_provider_status(
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
) -> Result<IdentityDeliveryProviderStatus, IdentityDeliveryError> {
    validate_provider_authority_configuration(gateway)?;
    let (now, active) = {
        let mut tx = pool.begin().await?;
        let now = database_now(&mut tx).await?;
        let active = sqlx::query_as::<_, IdentityDeliveryProviderAuthorityRow>(
            "SELECT generation_id, configuration_fingerprint, circuit_version, suspended_at, \
                    suspension_code, probe_token, probe_expires_at \
             FROM auth_delivery_provider_authority WHERE retired_at IS NULL",
        )
        .fetch_optional(&mut *tx)
        .await?;
        tx.commit().await?;
        (now, active)
    };
    let bound = active.as_ref().is_some_and(|active| {
        active.generation_id == gateway.provider_id()
            && active.configuration_fingerprint == gateway.configuration_fingerprint()
    });
    let operable = gateway.is_enabled()
        && bound
        && active
            .as_ref()
            .is_some_and(|active| active.suspended_at.is_none());
    Ok(IdentityDeliveryProviderStatus {
        configured: gateway.is_enabled(),
        bound,
        operable,
        configured_generation: gateway.provider_id().to_string(),
        active_generation: active.as_ref().map(|active| active.generation_id.clone()),
        suspension_code: active
            .as_ref()
            .and_then(|active| active.suspension_code.clone()),
        probe_in_flight: active.as_ref().is_some_and(|active| {
            active.probe_token.is_some()
                && active
                    .probe_expires_at
                    .is_some_and(|probe_expires_at| probe_expires_at > now)
        }),
        circuit_version: active.map(|active| active.circuit_version),
    })
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
    provenance: IdentityDeliveryClaimProvenance,
    provider_attempt_permitted: bool,
}

enum IdentityDeliveryClaimResult {
    Claimed(ClaimedIdentityDelivery),
    Reconciled(IdentityDeliveryReceipt),
    ProviderSuspended,
    Empty,
}

#[derive(sqlx::FromRow)]
struct IdentityDeliveryClaimRow {
    delivery_id: Uuid,
    delivery_kind: String,
    account_id: String,
    principal_id: Uuid,
    credential_hash: String,
    credential_expires_at: i64,
    attempt_count: i32,
    credential_envelope: Option<Value>,
    status: String,
    outcome_code: Option<String>,
    claim_source: Option<String>,
    claim_actor_principal_id: Option<Uuid>,
}

#[derive(Debug, Clone, Copy)]
enum IdentityDeliveryClaimTarget {
    NextDue,
    ExplicitRetry {
        delivery_id: Uuid,
        actor_principal_id: PrincipalId,
        expected_attempt_count: ExpectedIdentityDeliveryAttemptCount,
    },
}

impl IdentityDeliveryClaimTarget {
    fn delivery_id(self) -> Option<Uuid> {
        match self {
            Self::NextDue => None,
            Self::ExplicitRetry { delivery_id, .. } => Some(delivery_id),
        }
    }

    fn expected_attempt_count(self) -> Option<i32> {
        match self {
            Self::NextDue => None,
            Self::ExplicitRetry {
                expected_attempt_count,
                ..
            } => Some(expected_attempt_count.get()),
        }
    }

    fn provenance(self) -> IdentityDeliveryClaimProvenance {
        match self {
            Self::NextDue => IdentityDeliveryClaimProvenance::Automatic,
            Self::ExplicitRetry {
                actor_principal_id, ..
            } => IdentityDeliveryClaimProvenance::ExplicitRetry { actor_principal_id },
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum IdentityDeliveryClaimProvenance {
    Automatic,
    ExplicitRetry { actor_principal_id: PrincipalId },
}

impl IdentityDeliveryClaimProvenance {
    fn from_persisted(source: &str, actor_principal_id: Option<Uuid>) -> Option<Self> {
        match (source, actor_principal_id) {
            ("automatic", None) => Some(Self::Automatic),
            ("explicit_retry", Some(actor_principal_id)) => Some(Self::ExplicitRetry {
                actor_principal_id: PrincipalId::from_uuid(actor_principal_id),
            }),
            _ => None,
        }
    }

    fn persisted_source(self) -> &'static str {
        match self {
            Self::Automatic => "automatic",
            Self::ExplicitRetry { .. } => "explicit_retry",
        }
    }

    fn persisted_actor_principal_id(self) -> Option<Uuid> {
        match self {
            Self::Automatic => None,
            Self::ExplicitRetry { actor_principal_id } => Some(actor_principal_id.as_uuid()),
        }
    }

    fn actor_principal_id(self, subject_principal_id: PrincipalId) -> PrincipalId {
        match self {
            Self::Automatic => subject_principal_id,
            Self::ExplicitRetry { actor_principal_id } => actor_principal_id,
        }
    }

    fn audit_event_kind(self, resolution: &IdentityDeliveryResolution) -> &'static str {
        if resolution.is_cancelled() {
            return "auth_delivery_cancelled";
        }
        if matches!(self, Self::ExplicitRetry { .. }) {
            return "auth_delivery_retried";
        }
        match resolution.status() {
            "delivered" => "auth_delivery_delivered",
            "retryable_failed" => "auth_delivery_retryable_failed",
            "permanent_failed" => "auth_delivery_permanent_failed",
            status => unreachable!("identity delivery resolution has invalid status {status}"),
        }
    }
}

#[derive(Debug)]
struct IdentityDeliveryCancellationRequest<'a> {
    delivery_id: Uuid,
    kind: IdentityDeliveryKind,
    account_id: &'a str,
    actor_principal_id: &'a PrincipalId,
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

struct IdentityDeliveryExecution<'a> {
    pool: &'a PgPool,
    gateway: &'a dyn IdentityDeliveryGateway,
    config: IdentityDeliveryWorkerConfig,
    admission: &'a IdentityDeliveryAdmission,
}

struct IdentityDeliveryProviderProbeLease {
    probe_token: Uuid,
    circuit_version: i64,
    actor_principal_id: PrincipalId,
}

enum IdentityDeliveryProviderProbeLeaseResult {
    Acquired(IdentityDeliveryProviderProbeLease),
    Conflict,
    NotSuspended,
}

pub(super) async fn retry_identity_delivery_intent_with_config(
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
    request: IdentityDeliveryRetryRequest<'_>,
    config: IdentityDeliveryWorkerConfig,
    admission: &IdentityDeliveryAdmission,
) -> Result<IdentityDeliveryRetryResult, IdentityDeliveryError> {
    let claim = bounded_delivery_database_operation(config.database_timeout(), "claim", async {
        let _database_permit = admission.acquire_database().await;
        let mut tx = identity::session::begin_authority_transaction(pool).await?;
        let authorization = identity::session::validate_initiating_session_for_update(
            &mut tx,
            request.initiating_session,
            request.session_policy,
        )
        .await?;
        if !authorization
            .global_capabilities()
            .iter()
            .any(|capability| capability == "GlobalAdmin")
        {
            return Err(IdentityDeliveryError::NotAuthorized);
        }
        let claim = claim_delivery_transaction(
            &mut tx,
            gateway,
            IdentityDeliveryClaimTarget::ExplicitRetry {
                delivery_id: request.delivery_id,
                actor_principal_id: authorization.principal_id(),
                expected_attempt_count: request.expected_attempt_count,
            },
            config,
        )
        .await?;
        tx.commit().await?;
        Ok(claim)
    })
    .await?;
    let claim = match claim {
        IdentityDeliveryClaimResult::Claimed(claim) => claim,
        IdentityDeliveryClaimResult::Reconciled(receipt) => {
            return Ok(IdentityDeliveryRetryResult::Applied(receipt))
        }
        IdentityDeliveryClaimResult::ProviderSuspended => {
            return Err(IdentityDeliveryError::ProviderSuspended)
        }
        IdentityDeliveryClaimResult::Empty => return Ok(IdentityDeliveryRetryResult::Conflict),
    };
    Ok(
        match deliver_and_finalize(
            claim,
            IdentityDeliveryExecution {
                pool,
                gateway,
                config,
                admission,
            },
        )
        .await?
        {
            Some(receipt) => IdentityDeliveryRetryResult::Applied(receipt),
            None => IdentityDeliveryRetryResult::Conflict,
        },
    )
}

pub(super) async fn probe_identity_delivery_provider_with_config(
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
    request: IdentityDeliveryProviderProbeRequest<'_>,
    config: IdentityDeliveryWorkerConfig,
    admission: &IdentityDeliveryAdmission,
) -> Result<IdentityDeliveryProviderProbeResult, IdentityDeliveryError> {
    validate_provider_authority_configuration(gateway)?;
    if !gateway.is_enabled() {
        return Err(IdentityDeliveryError::ProviderSuspended);
    }
    let lease = bounded_delivery_database_operation(
        config.database_timeout(),
        "provider probe acquisition",
        async {
            let _database_permit = admission.acquire_database().await;
            let mut tx = identity::session::begin_authority_transaction(pool).await?;
            let authorization = identity::session::validate_initiating_session_for_update(
                &mut tx,
                request.initiating_session,
                request.session_policy,
            )
            .await?;
            if !authorization
                .global_capabilities()
                .iter()
                .any(|capability| capability == "GlobalAdmin")
            {
                return Err(IdentityDeliveryError::NotAuthorized);
            }
            let now = database_now(&mut tx).await?;
            let active =
                sqlx::query_as::<_, (String, String, i64, Option<i64>, Option<Uuid>, Option<i64>)>(
                    "SELECT generation_id, configuration_fingerprint, circuit_version, \
                        suspended_at, probe_token, probe_expires_at \
                 FROM auth_delivery_provider_authority \
                 WHERE retired_at IS NULL FOR UPDATE",
                )
                .fetch_optional(&mut *tx)
                .await?;
            let Some((
                generation,
                fingerprint,
                circuit_version,
                suspended_at,
                probe_token,
                probe_expires_at,
            )) = active
            else {
                return Err(IdentityDeliveryError::ProviderContinuity(
                    "provider authority has no active startup binding".to_string(),
                ));
            };
            if generation != gateway.provider_id()
                || fingerprint != gateway.configuration_fingerprint()
            {
                return Err(IdentityDeliveryError::ProviderContinuity(format!(
                    "configured generation '{}' does not match the active provider authority",
                    gateway.provider_id()
                )));
            }
            let result = if suspended_at.is_none() {
                IdentityDeliveryProviderProbeLeaseResult::NotSuspended
            } else if probe_token.is_some()
                && probe_expires_at.is_some_and(|probe_expires_at| probe_expires_at > now)
            {
                IdentityDeliveryProviderProbeLeaseResult::Conflict
            } else {
                let probe_token = Uuid::new_v4();
                let probe_expires_at = now.saturating_add(config.claim_lease().as_secs() as i64);
                let leased_circuit_version = sqlx::query_scalar::<_, i64>(
                    "UPDATE auth_delivery_provider_authority \
                     SET circuit_version = circuit_version + 1, probe_token = $2, \
                         probe_expires_at = $3 \
                     WHERE generation_id = $1 AND retired_at IS NULL \
                       AND circuit_version = $4 AND suspended_at IS NOT NULL \
                     RETURNING circuit_version",
                )
                .bind(gateway.provider_id())
                .bind(probe_token)
                .bind(probe_expires_at)
                .bind(circuit_version)
                .fetch_one(&mut *tx)
                .await?;
                IdentityDeliveryProviderProbeLeaseResult::Acquired(
                    IdentityDeliveryProviderProbeLease {
                        probe_token,
                        circuit_version: leased_circuit_version,
                        actor_principal_id: authorization.principal_id(),
                    },
                )
            };
            tx.commit().await?;
            Ok(result)
        },
    )
    .await?;
    let lease = match lease {
        IdentityDeliveryProviderProbeLeaseResult::Acquired(lease) => lease,
        IdentityDeliveryProviderProbeLeaseResult::Conflict => {
            return Ok(IdentityDeliveryProviderProbeResult::Conflict)
        }
        IdentityDeliveryProviderProbeLeaseResult::NotSuspended => {
            return Ok(IdentityDeliveryProviderProbeResult::NotSuspended)
        }
    };
    let outcome =
        match tokio::time::timeout(config.provider_timeout(), gateway.probe(lease.probe_token))
            .await
        {
            Ok(outcome) => outcome,
            Err(_) => IdentityDeliveryProviderProbeOutcome::Unavailable,
        };
    bounded_delivery_database_operation(
        config.database_timeout(),
        "provider probe finalization",
        async {
            let _database_permit = admission.acquire_database().await;
            let mut tx = pool.begin().await?;
            let now = database_now(&mut tx).await?;
            let updated_circuit_version = match outcome {
                IdentityDeliveryProviderProbeOutcome::Available => {
                    sqlx::query_scalar::<_, i64>(
                        "UPDATE auth_delivery_provider_authority \
                         SET circuit_version = circuit_version + 1, suspended_at = NULL, \
                             suspension_code = NULL, suspension_observation_id = NULL, \
                             probe_token = NULL, probe_expires_at = NULL \
                         WHERE generation_id = $1 AND configuration_fingerprint = $2 \
                           AND retired_at IS NULL AND suspended_at IS NOT NULL \
                           AND circuit_version = $3 AND probe_token = $4 \
                           AND probe_expires_at > $5 \
                         RETURNING circuit_version",
                    )
                    .bind(gateway.provider_id())
                    .bind(gateway.configuration_fingerprint())
                    .bind(lease.circuit_version)
                    .bind(lease.probe_token)
                    .bind(now)
                    .fetch_optional(&mut *tx)
                    .await?
                }
                IdentityDeliveryProviderProbeOutcome::Unavailable => {
                    sqlx::query_scalar::<_, i64>(
                        "UPDATE auth_delivery_provider_authority \
                         SET circuit_version = circuit_version + 1, \
                             suspended_at = GREATEST(suspended_at, $5), \
                             suspension_code = 'provider_unavailable', \
                             suspension_observation_id = $4, probe_token = NULL, \
                             probe_expires_at = NULL \
                         WHERE generation_id = $1 AND configuration_fingerprint = $2 \
                           AND retired_at IS NULL AND suspended_at IS NOT NULL \
                           AND circuit_version = $3 AND probe_token = $4 \
                         RETURNING circuit_version",
                    )
                    .bind(gateway.provider_id())
                    .bind(gateway.configuration_fingerprint())
                    .bind(lease.circuit_version)
                    .bind(lease.probe_token)
                    .bind(now)
                    .fetch_optional(&mut *tx)
                    .await?
                }
            };
            let Some(circuit_version) = updated_circuit_version else {
                tx.rollback().await?;
                return Ok(IdentityDeliveryProviderProbeResult::Conflict);
            };
            record_provider_probe_audit(
                &mut tx,
                &lease.actor_principal_id,
                gateway.provider_id(),
                lease.probe_token,
                outcome,
                circuit_version,
                now,
            )
            .await?;
            tx.commit().await?;
            Ok(IdentityDeliveryProviderProbeResult::Applied(
                IdentityDeliveryProviderProbeReceipt {
                    provider_generation: gateway.provider_id().to_string(),
                    outcome: match outcome {
                        IdentityDeliveryProviderProbeOutcome::Available => "available",
                        IdentityDeliveryProviderProbeOutcome::Unavailable => "unavailable",
                    },
                    operable: outcome == IdentityDeliveryProviderProbeOutcome::Available,
                    circuit_version,
                },
            ))
        },
    )
    .await
}

pub async fn process_next_identity_delivery_with_config(
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
    config: IdentityDeliveryWorkerConfig,
    admission: &IdentityDeliveryAdmission,
) -> Result<Option<IdentityDeliveryReceipt>, IdentityDeliveryError> {
    let due = identity_delivery_work_is_due(pool, gateway, config, admission).await?;
    if !due {
        return Ok(None);
    }
    let _attempt_permit = admission.acquire_attempt().await;
    let claim = claim_delivery(
        pool,
        gateway,
        IdentityDeliveryClaimTarget::NextDue,
        config,
        admission,
    )
    .await?;
    let claim = match claim {
        IdentityDeliveryClaimResult::Claimed(claim) => claim,
        IdentityDeliveryClaimResult::Reconciled(receipt) => return Ok(Some(receipt)),
        IdentityDeliveryClaimResult::ProviderSuspended => {
            return Err(IdentityDeliveryError::ProviderSuspended)
        }
        IdentityDeliveryClaimResult::Empty => return Ok(None),
    };
    deliver_and_finalize(
        claim,
        IdentityDeliveryExecution {
            pool,
            gateway,
            config,
            admission,
        },
    )
    .await
}

pub async fn run_identity_delivery_worker_observed<F>(
    pool: PgPool,
    gateway: Arc<dyn IdentityDeliveryGateway>,
    config: IdentityDeliveryWorkerConfig,
    admission: IdentityDeliveryAdmission,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
    mut observe_progress: F,
) -> Result<(), IdentityDeliveryError>
where
    F: FnMut(IdentityDeliveryWorkerObservation) + Send,
{
    let mut attempts = JoinSet::new();
    'worker: loop {
        if *shutdown.borrow() {
            break;
        }

        let mut found_work = false;
        while attempts.len() < config.max_concurrency() {
            let due = tokio::select! {
                biased;
                changed = shutdown.changed() => {
                    if changed.is_err() || *shutdown.borrow() {
                        break 'worker;
                    }
                    continue;
                }
                due = identity_delivery_work_is_due(
                    &pool,
                    gateway.as_ref(),
                    config,
                    &admission,
                ) => due?,
            };
            if !due {
                observe_progress(IdentityDeliveryWorkerObservation {
                    completed: 0,
                    attempt_errors: 0,
                    in_flight: attempts.len(),
                    kind: IdentityDeliveryWorkerObservationKind::EmptyClaim,
                });
                break;
            }
            let attempt_permit = tokio::select! {
                biased;
                changed = shutdown.changed() => {
                    if changed.is_err() || *shutdown.borrow() {
                        break 'worker;
                    }
                    continue;
                }
                permit = admission.acquire_attempt() => permit,
            };
            let claim = tokio::select! {
                biased;
                changed = shutdown.changed() => {
                    if changed.is_err() || *shutdown.borrow() {
                        break 'worker;
                    }
                    continue;
                }
                claim = claim_delivery(
                    &pool,
                    gateway.as_ref(),
                    IdentityDeliveryClaimTarget::NextDue,
                    config,
                    &admission,
                ) => claim?,
            };
            let claim = match claim {
                IdentityDeliveryClaimResult::Claimed(claim) => claim,
                IdentityDeliveryClaimResult::Reconciled(_) => {
                    found_work = true;
                    drop(attempt_permit);
                    observe_progress(IdentityDeliveryWorkerObservation {
                        completed: 1,
                        attempt_errors: 0,
                        in_flight: attempts.len(),
                        kind: IdentityDeliveryWorkerObservationKind::AttemptFinished,
                    });
                    continue;
                }
                IdentityDeliveryClaimResult::ProviderSuspended => {
                    drop(attempt_permit);
                    observe_progress(IdentityDeliveryWorkerObservation {
                        completed: 0,
                        attempt_errors: 1,
                        in_flight: attempts.len(),
                        kind: IdentityDeliveryWorkerObservationKind::ProviderSuspended,
                    });
                    break;
                }
                IdentityDeliveryClaimResult::Empty => {
                    drop(attempt_permit);
                    observe_progress(IdentityDeliveryWorkerObservation {
                        completed: 0,
                        attempt_errors: 0,
                        in_flight: attempts.len(),
                        kind: IdentityDeliveryWorkerObservationKind::EmptyClaim,
                    });
                    break;
                }
            };
            if *shutdown.borrow() {
                // The exact claim token remains safely fenced and becomes
                // reclaimable at lease expiry. No new provider side effect is
                // started after shutdown has been observed.
                break 'worker;
            }
            found_work = true;
            let attempt_pool = pool.clone();
            let attempt_gateway = gateway.clone();
            let attempt_admission = admission.clone();
            attempts.spawn(async move {
                let _attempt_permit = attempt_permit;
                deliver_and_finalize(
                    claim,
                    IdentityDeliveryExecution {
                        pool: &attempt_pool,
                        gateway: attempt_gateway.as_ref(),
                        config,
                        admission: &attempt_admission,
                    },
                )
                .await
            });
            observe_progress(IdentityDeliveryWorkerObservation {
                completed: 0,
                attempt_errors: 0,
                in_flight: attempts.len(),
                kind: IdentityDeliveryWorkerObservationKind::AttemptStarted,
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
                    observe_progress(finish_delivery_task(joined, attempts.len())?);
                }
                () = tokio::time::sleep(config.poll_interval()) => {
                    observe_progress(IdentityDeliveryWorkerObservation {
                        completed: 0,
                        attempt_errors: 0,
                        in_flight: attempts.len(),
                        kind: IdentityDeliveryWorkerObservationKind::TimerTick,
                    });
                }
            }
        }
    }

    while let Some(joined) = attempts.join_next().await {
        observe_progress(finish_delivery_task(Some(joined), attempts.len())?);
    }
    Ok(())
}

async fn identity_delivery_work_is_due(
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
    config: IdentityDeliveryWorkerConfig,
    admission: &IdentityDeliveryAdmission,
) -> Result<bool, IdentityDeliveryError> {
    bounded_delivery_database_operation(
        config.database_timeout(),
        "due-work precheck",
        async {
            let _database_permit = admission.acquire_database().await;
            sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (\
                    SELECT 1 FROM auth_delivery_intent \
                    WHERE provider_id = $1 AND (\
                        (status IN ('queued', 'retryable_failed') \
                         AND next_attempt_at <= floor(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT) \
                        OR (status = 'processing' \
                            AND claim_expires_at <= floor(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT)\
                    )\
                 )",
            )
            .bind(gateway.provider_id())
            .fetch_one(pool)
            .await
            .map_err(IdentityDeliveryError::from)
        },
    )
    .await
}

fn finish_delivery_task(
    joined: Option<JoinedIdentityDeliveryTask>,
    in_flight: usize,
) -> Result<IdentityDeliveryWorkerObservation, IdentityDeliveryError> {
    match joined {
        Some(Ok(Ok(receipt))) => Ok(IdentityDeliveryWorkerObservation {
            completed: u64::from(receipt.is_some()),
            attempt_errors: 0,
            in_flight,
            kind: IdentityDeliveryWorkerObservationKind::AttemptFinished,
        }),
        Some(Ok(Err(_))) => {
            tracing::error!(
                event = "identity_delivery_attempt_failed",
                "identity delivery attempt failed; its fenced claim remains retryable"
            );
            Ok(IdentityDeliveryWorkerObservation {
                completed: 0,
                attempt_errors: 1,
                in_flight,
                kind: IdentityDeliveryWorkerObservationKind::AttemptFinished,
            })
        }
        None => Ok(IdentityDeliveryWorkerObservation {
            completed: 0,
            attempt_errors: 0,
            in_flight,
            kind: IdentityDeliveryWorkerObservationKind::TimerTick,
        }),
        Some(Err(error)) => Err(IdentityDeliveryError::Worker(error.to_string())),
    }
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
    gateway: &dyn IdentityDeliveryGateway,
    target: IdentityDeliveryClaimTarget,
    config: IdentityDeliveryWorkerConfig,
    admission: &IdentityDeliveryAdmission,
) -> Result<IdentityDeliveryClaimResult, IdentityDeliveryError> {
    bounded_delivery_database_operation(config.database_timeout(), "claim", async {
        let _database_permit = admission.acquire_database().await;
        let mut tx = pool.begin().await?;
        let claim = claim_delivery_transaction(&mut tx, gateway, target, config).await?;
        tx.commit().await?;
        Ok(claim)
    })
    .await
}

async fn claim_delivery_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    gateway: &dyn IdentityDeliveryGateway,
    target: IdentityDeliveryClaimTarget,
    config: IdentityDeliveryWorkerConfig,
) -> Result<IdentityDeliveryClaimResult, IdentityDeliveryError> {
    let provider_id = gateway.provider_id();
    let database_now =
        sqlx::query_scalar::<_, i64>("SELECT floor(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT")
            .fetch_one(&mut **tx)
            .await?;
    let delivery_id = target.delivery_id();
    let expected_attempt_count = target.expected_attempt_count();
    let row = sqlx::query_as::<_, IdentityDeliveryClaimRow>(
        r#"
        SELECT delivery_id,
               delivery_kind,
               account_id,
               principal_id,
               credential_hash,
               credential_expires_at,
               attempt_count,
               credential_envelope,
               status,
               outcome_code,
               claim_source,
               claim_actor_principal_id
        FROM auth_delivery_intent
        WHERE provider_id = $1
          AND (
              (
                  $2::UUID IS NULL
                  AND (
                      (status = 'queued' AND next_attempt_at <= $3)
                      OR (status = 'retryable_failed' AND next_attempt_at <= $3)
                      OR (status = 'processing' AND claim_expires_at <= $3)
                  )
              )
              OR (
                  $2::UUID IS NOT NULL
                  AND delivery_id = $2
                  AND status = 'retryable_failed'
                  AND attempt_count = $4
              )
          )
        ORDER BY created_at, delivery_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
        "#,
    )
    .bind(provider_id)
    .bind(delivery_id)
    .bind(database_now)
    .bind(expected_attempt_count)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = row else {
        return Ok(IdentityDeliveryClaimResult::Empty);
    };
    let reclaiming = row.status == "processing";
    let provenance = if reclaiming {
        IdentityDeliveryClaimProvenance::from_persisted(
            row.claim_source.as_deref().unwrap_or_default(),
            row.claim_actor_principal_id,
        )
        .ok_or_else(|| {
            IdentityDeliveryError::Worker(
                "processing identity delivery has invalid persisted claim provenance".to_string(),
            )
        })?
    } else {
        target.provenance()
    };
    let kind = IdentityDeliveryKind::parse(&row.delivery_kind).expect("validated delivery kind");
    let principal_id = PrincipalId::from_uuid(row.principal_id);
    if !credential_is_active(tx, kind, row.credential_hash.as_str()).await? {
        let actor_principal_id = provenance.actor_principal_id(principal_id);
        let request = IdentityDeliveryCancellationRequest {
            delivery_id: row.delivery_id,
            kind,
            account_id: row.account_id.as_str(),
            actor_principal_id: &actor_principal_id,
            principal_id: &principal_id,
            credential_hash: row.credential_hash.as_str(),
            provider_id,
            cancelled_at: database_now,
        };
        let receipt = cancel_claimed_delivery(tx, request).await?;
        return Ok(IdentityDeliveryClaimResult::Reconciled(receipt));
    }
    // Existing-intent operations use one global blocking order: delivery row
    // before provider authority. This matches unavailable finalization and the
    // database guard used by old binaries, while the SKIP LOCKED selection
    // keeps competing workers from waiting on another delivery finalizer.
    match lock_identity_delivery_provider_authority(tx, gateway).await {
        Ok(_) => {}
        Err(IdentityDeliveryError::ProviderSuspended) => {
            return Ok(IdentityDeliveryClaimResult::ProviderSuspended)
        }
        Err(error) => return Err(error),
    }
    // A pre-invocation circuit transition or local preparation failure proves
    // that this generation never reached the provider. Recovery may therefore
    // reuse the same generation, including the final configured generation,
    // while every actual provider invocation remains bounded by max_attempts.
    let persisted_resolution_preserves_attempt_generation = matches!(
        row.outcome_code.as_deref(),
        Some("provider_suspended_before_invocation" | "local_transient_before_provider_invocation")
    );
    let reusing_attempt_generation =
        reclaiming || persisted_resolution_preserves_attempt_generation;
    let provider_attempt_permitted = if reusing_attempt_generation {
        (1..=config.max_attempts()).contains(&row.attempt_count)
    } else {
        row.attempt_count < config.max_attempts()
    };
    let claim_token = Uuid::new_v4();
    let claim_lease_seconds = config.claim_lease().as_secs() as i64;
    let claim_source = provenance.persisted_source();
    let claim_actor_principal_id = provenance.persisted_actor_principal_id();
    let (claimed_at, claim_expires_at, attempt_number) = sqlx::query_as::<_, (i64, i64, i32)>(
        r#"
        WITH mutation_clock AS MATERIALIZED (
            SELECT floor(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT AS claimed_at
        )
        UPDATE auth_delivery_intent AS delivery
        SET status = 'processing',
            outcome_kind = 'processing',
            outcome_code = NULL,
            next_attempt_at = NULL,
            delivered_at = NULL,
            last_error = NULL,
            provider_receipt_id = NULL,
            claim_token = $2,
            claim_expires_at = mutation_clock.claimed_at + $3,
            attempt_count = attempt_count + CASE
                WHEN delivery.status <> 'processing'
                     AND delivery.outcome_code IS DISTINCT FROM
                         'provider_suspended_before_invocation'
                     AND delivery.outcome_code IS DISTINCT FROM
                         'local_transient_before_provider_invocation'
                     AND attempt_count < $4 THEN 1
                ELSE 0
            END,
            claim_source = $5,
            claim_actor_principal_id = $6,
            updated_at = mutation_clock.claimed_at
        FROM mutation_clock
        WHERE delivery.delivery_id = $1
        RETURNING mutation_clock.claimed_at,
                  delivery.claim_expires_at,
                  delivery.attempt_count
        "#,
    )
    .bind(row.delivery_id)
    .bind(claim_token)
    .bind(claim_lease_seconds)
    .bind(config.max_attempts())
    .bind(claim_source)
    .bind(claim_actor_principal_id)
    .fetch_one(&mut **tx)
    .await?;
    if claim_expires_at != claimed_at.saturating_add(claim_lease_seconds) {
        return Err(IdentityDeliveryError::Worker(
            "identity delivery claim lease did not match its mutation clock".to_string(),
        ));
    }
    let generation_fence_expires_at = claim_expires_at;
    let effect_deadline_at = config.provider_effect_deadline_at(generation_fence_expires_at);
    if effect_deadline_at <= claimed_at {
        return Err(IdentityDeliveryError::Worker(
            "identity delivery provider effect deadline did not precede its generation fence"
                .to_string(),
        ));
    }
    Ok(IdentityDeliveryClaimResult::Claimed(
        ClaimedIdentityDelivery {
            attempt: IdentityDeliveryAttempt {
                delivery_id: row.delivery_id,
                attempt_token: claim_token,
                lease_expires_at: effect_deadline_at,
                clock_skew_margin_seconds: config.provider_clock_skew_margin().as_secs() as i64,
                kind,
                account_id: row.account_id,
                principal_id,
                credential_hash: row.credential_hash,
                credential_expires_at: row.credential_expires_at,
                credential_material: None,
                attempt_number,
            },
            credential_envelope: row.credential_envelope,
            provider_id: provider_id.to_string(),
            claim_token,
            provenance,
            provider_attempt_permitted,
        },
    ))
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IdentityDeliveryInvocationPermission {
    Permitted,
    ClaimLost,
    CredentialInactive,
    CredentialExpired,
    ProviderSuspended,
}

async fn revalidate_identity_delivery_invocation(
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
    claim: &ClaimedIdentityDelivery,
    config: IdentityDeliveryWorkerConfig,
    admission: &IdentityDeliveryAdmission,
) -> Result<IdentityDeliveryInvocationPermission, IdentityDeliveryError> {
    bounded_delivery_database_operation(config.database_timeout(), "preparation", async {
        let _database_permit = admission.acquire_database().await;
        let mut tx = pool.begin().await?;
        let claim_expires_at = sqlx::query_scalar::<_, i64>(
            "SELECT claim_expires_at \
             FROM auth_delivery_intent \
             WHERE delivery_id = $1 AND status = 'processing' AND claim_token = $2 \
             FOR UPDATE",
        )
        .bind(claim.attempt.delivery_id)
        .bind(claim.claim_token)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(claim_expires_at) = claim_expires_at else {
            tx.commit().await?;
            return Ok(IdentityDeliveryInvocationPermission::ClaimLost);
        };
        if !credential_is_active(
            &mut tx,
            claim.attempt.kind,
            claim.attempt.credential_hash.as_str(),
        )
        .await?
        {
            tx.commit().await?;
            return Ok(IdentityDeliveryInvocationPermission::CredentialInactive);
        }
        match lock_identity_delivery_provider_authority(&mut tx, gateway).await {
            Ok(_) => {}
            Err(IdentityDeliveryError::ProviderSuspended) => {
                tx.commit().await?;
                return Ok(IdentityDeliveryInvocationPermission::ProviderSuspended);
            }
            Err(error) => return Err(error),
        }
        // Take the database clock only after every potentially blocking lock.
        // This is the last authority decision before the transaction commits
        // and credential material is unsealed outside the database.
        let invocation_now = database_now(&mut tx).await?;
        let effect_deadline_at = config.provider_effect_deadline_at(claim_expires_at);
        if claim.attempt.lease_expires_at != effect_deadline_at
            || claim.attempt.clock_skew_margin_seconds
                != config.provider_clock_skew_margin().as_secs() as i64
        {
            return Err(IdentityDeliveryError::Worker(
                "identity delivery provider deadline no longer matches its claimed generation fence"
                    .to_string(),
            ));
        }
        if effect_deadline_at <= invocation_now || claim_expires_at <= invocation_now {
            tx.commit().await?;
            return Ok(IdentityDeliveryInvocationPermission::ClaimLost);
        }
        if claim.attempt.credential_expires_at <= invocation_now {
            tx.commit().await?;
            return Ok(IdentityDeliveryInvocationPermission::CredentialExpired);
        }
        tx.commit().await?;
        Ok(IdentityDeliveryInvocationPermission::Permitted)
    })
    .await
}

async fn cancel_claimed_delivery(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request: IdentityDeliveryCancellationRequest<'_>,
) -> Result<IdentityDeliveryReceipt, sqlx::Error> {
    let attempt_count = sqlx::query_scalar::<_, i32>(
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
            claim_source = NULL,
            claim_actor_principal_id = NULL,
            credential_envelope = NULL,
            updated_at = $2
        WHERE delivery_id = $1
        RETURNING attempt_count
        "#,
    )
    .bind(request.delivery_id)
    .bind(request.cancelled_at)
    .fetch_one(&mut **tx)
    .await?;
    record_delivery_audit(
        tx,
        IdentityDeliveryAuditRecord {
            event_at: request.cancelled_at,
            event_kind: "auth_delivery_cancelled",
            actor_principal_id: request.actor_principal_id,
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
    .await?;
    Ok(IdentityDeliveryReceipt {
        delivery_id: request.delivery_id,
        delivery_kind: request.kind.as_str().to_string(),
        status: "cancelled".to_string(),
        attempt_count,
        provider_id: request.provider_id.to_string(),
        outcome_kind: "cancelled".to_string(),
        outcome_code: Some("credential_inactive".to_string()),
        provider_receipt_id: None,
    })
}

async fn delivery_outcome(
    claim: &mut ClaimedIdentityDelivery,
    pool: &PgPool,
    gateway: &dyn IdentityDeliveryGateway,
    config: IdentityDeliveryWorkerConfig,
    admission: &IdentityDeliveryAdmission,
) -> IdentityDeliveryResolution {
    if !claim.provider_attempt_permitted {
        return IdentityDeliveryResolution::Outcome(IdentityDeliveryOutcome::PermanentFailure(
            IdentityDeliveryFailureCode::AttemptsExhausted,
        ));
    }
    match revalidate_identity_delivery_invocation(pool, gateway, claim, config, admission).await {
        Ok(IdentityDeliveryInvocationPermission::Permitted) => {}
        Ok(IdentityDeliveryInvocationPermission::CredentialInactive) => {
            return IdentityDeliveryResolution::Outcome(IdentityDeliveryOutcome::Cancelled(
                IdentityDeliveryCancellationCode::CredentialInactive,
            ))
        }
        Ok(IdentityDeliveryInvocationPermission::CredentialExpired) => {
            return IdentityDeliveryResolution::Outcome(IdentityDeliveryOutcome::PermanentFailure(
                IdentityDeliveryFailureCode::CredentialExpired,
            ))
        }
        Ok(IdentityDeliveryInvocationPermission::ProviderSuspended) => {
            return IdentityDeliveryResolution::RetryableBeforeProviderInvocation(
                IdentityDeliveryPreInvocationFailure::ProviderSuspended,
            )
        }
        Ok(IdentityDeliveryInvocationPermission::ClaimLost) | Err(_) => {
            return IdentityDeliveryResolution::RetryableBeforeProviderInvocation(
                IdentityDeliveryPreInvocationFailure::PreparationTransient,
            )
        }
    }
    let Some(envelope) = claim.credential_envelope.as_ref() else {
        return IdentityDeliveryResolution::Outcome(IdentityDeliveryOutcome::PermanentFailure(
            IdentityDeliveryFailureCode::CredentialUnavailable,
        ));
    };
    let credential_material = match decrypt_delivery_credential(
        envelope,
        &delivery_aad(claim.attempt.delivery_id, claim.attempt.kind),
    ) {
        Ok(material) => material,
        Err(_) => {
            return IdentityDeliveryResolution::Outcome(IdentityDeliveryOutcome::PermanentFailure(
                IdentityDeliveryFailureCode::CredentialUnavailable,
            ))
        }
    };
    claim.attempt.credential_material = Some(credential_material);
    IdentityDeliveryResolution::Outcome(
        bounded_provider_delivery(config.provider_timeout(), gateway.deliver(&claim.attempt)).await,
    )
}

async fn bounded_provider_delivery<F>(timeout: Duration, delivery: F) -> IdentityDeliveryOutcome
where
    F: Future<Output = IdentityDeliveryOutcome>,
{
    match tokio::time::timeout(timeout, delivery).await {
        Ok(outcome) => outcome,
        Err(_) => IdentityDeliveryOutcome::UncertainFailure {
            code: IdentityDeliveryFailureCode::ProviderUnavailable,
            retry_after_seconds: None,
        },
    }
}

pub fn delivery_aad(delivery_id: Uuid, kind: IdentityDeliveryKind) -> String {
    format!(
        "fmarch:identity-delivery:v1:{delivery_id}:{}",
        kind.as_str()
    )
}

async fn deliver_and_finalize(
    mut claim: ClaimedIdentityDelivery,
    execution: IdentityDeliveryExecution<'_>,
) -> Result<Option<IdentityDeliveryReceipt>, IdentityDeliveryError> {
    let IdentityDeliveryExecution {
        pool,
        gateway,
        config,
        admission,
    } = execution;
    // The provider is deliberately outside every database transaction. The
    // claim token and immutable credential hash fence completion; source
    // revocation/consumption wins through the conditional finalization CAS.
    let outcome = delivery_outcome(&mut claim, pool, gateway, config, admission).await;
    bounded_delivery_database_operation(config.database_timeout(), "finalization", async {
        let _database_permit = admission.acquire_database().await;
        let mut tx = pool.begin().await?;
        let finalized_at = sqlx::query_scalar::<_, i64>(
            "SELECT floor(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT",
        )
        .fetch_one(&mut *tx)
        .await?;
        let receipt =
            finalize_delivery(&mut tx, gateway, claim, outcome, finalized_at, config).await?;
        tx.commit().await?;
        Ok(receipt)
    })
    .await
}

async fn bounded_delivery_database_operation<T, F>(
    timeout: Duration,
    phase: &'static str,
    operation: F,
) -> Result<T, IdentityDeliveryError>
where
    F: Future<Output = Result<T, IdentityDeliveryError>>,
{
    tokio::time::timeout(timeout, operation)
        .await
        .map_err(|_| {
            IdentityDeliveryError::Worker(format!(
                "identity delivery {phase} database deadline elapsed"
            ))
        })?
}

async fn finalize_delivery(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    gateway: &dyn IdentityDeliveryGateway,
    claim: ClaimedIdentityDelivery,
    outcome: IdentityDeliveryResolution,
    now: i64,
    config: IdentityDeliveryWorkerConfig,
) -> Result<Option<IdentityDeliveryReceipt>, IdentityDeliveryError> {
    let provider_was_invoked = claim.attempt.credential_material.is_some();
    let provider_is_unavailable = outcome.provider_unavailable();
    let provider_unavailability_was_observed = provider_was_invoked && provider_is_unavailable;
    let provider_completion_was_uncertain =
        provider_was_invoked && outcome.provider_completion_uncertain();
    let preserves_attempt_generation = outcome.preserves_attempt_generation();
    let mut outcome = outcome;
    // Once the provider confirms delivery, persist that external fact even if
    // the credential expires while the already-authorized request is in
    // flight. Pre-send revalidation prevents a fresh call after expiry; expiry
    // cannot undo an external effect that already completed.
    if now >= claim.attempt.credential_expires_at
        && !outcome.is_cancelled()
        && !outcome.is_delivered()
    {
        outcome = IdentityDeliveryResolution::Outcome(IdentityDeliveryOutcome::PermanentFailure(
            IdentityDeliveryFailureCode::CredentialExpired,
        ));
    }
    // Retryable pre-invocation resolutions preserve their generation because
    // no provider call occurred. Every outcome from a provider invocation,
    // including a provider-unavailable acknowledgement or uncertain timeout,
    // exhausts the final configured generation.
    if !preserves_attempt_generation
        && outcome.is_retryable()
        && claim.attempt.attempt_number >= config.max_attempts()
    {
        outcome = IdentityDeliveryResolution::Outcome(IdentityDeliveryOutcome::PermanentFailure(
            IdentityDeliveryFailureCode::AttemptsExhausted,
        ));
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
        outcome = IdentityDeliveryResolution::Outcome(IdentityDeliveryOutcome::PermanentFailure(
            IdentityDeliveryFailureCode::CredentialExpired,
        ));
        next_attempt_at = None;
    }
    let event_kind = claim.provenance.audit_event_kind(&outcome);
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
            claim_source = NULL,
            claim_actor_principal_id = NULL,
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
    let finalized = if let Some(attempt_count) = attempt_count {
        Some((attempt_count, event_kind, outcome))
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
                claim_source = NULL,
                claim_actor_principal_id = NULL,
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
        cancelled_attempt_count.map(|attempt_count| {
            (
                attempt_count,
                "auth_delivery_cancelled",
                IdentityDeliveryResolution::Outcome(IdentityDeliveryOutcome::Cancelled(
                    IdentityDeliveryCancellationCode::CredentialInactive,
                )),
            )
        })
    };
    // Provider health is an external observation. Cancellation, erasure, or a
    // newer delivery lease can revoke authority to mutate the intent, but they
    // cannot erase an unavailable response that was actually observed. Apply
    // the delivery CAS first, then take the provider lock, preserving the only
    // blocking lock order used by finalization and recovery rotation.
    if provider_unavailability_was_observed {
        persist_identity_delivery_provider_unavailable(tx, gateway, claim.attempt.delivery_id, now)
            .await?;
    }
    // A local timeout does not prove that the remote handler stopped. Preserve
    // uncertain invocations until their later generation fence expires; a
    // definitive response or a suppressed send can release the exact fence
    // immediately. The expiry predicate opportunistically collects abandoned
    // fences from earlier failed finalizations without relying on a restart.
    sqlx::query(
        "DELETE FROM auth_delivery_provider_attempt_fence \
         WHERE (attempt_token = $2 AND generation_id = $3 AND NOT $4) \
            OR attempt_token IN (\
                SELECT attempt_token FROM auth_delivery_provider_attempt_fence \
                WHERE expires_at <= $1 \
                ORDER BY expires_at, attempt_token \
                LIMIT $5\
            )",
    )
    .bind(now)
    .bind(claim.claim_token)
    .bind(claim.provider_id.as_str())
    .bind(provider_completion_was_uncertain)
    .bind(EXPIRED_PROVIDER_ATTEMPT_FENCE_GC_BATCH)
    .execute(&mut **tx)
    .await?;
    let Some((attempt_count, event_kind, outcome)) = finalized else {
        tracing::warn!(
            delivery_id = %claim.attempt.delivery_id,
            attempt_number = claim.attempt.attempt_number,
            "identity delivery completion discarded after claim loss"
        );
        return Ok(None);
    };
    let outcome_code = outcome.code().map(str::to_string);
    let provider_receipt_id = outcome.provider_receipt_id().map(str::to_string);
    let actor_principal_id = claim
        .provenance
        .actor_principal_id(claim.attempt.principal_id);
    record_delivery_audit(
        tx,
        IdentityDeliveryAuditRecord {
            event_at: now,
            event_kind,
            actor_principal_id: &actor_principal_id,
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

async fn persist_identity_delivery_provider_unavailable(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    gateway: &dyn IdentityDeliveryGateway,
    observation_id: Uuid,
    now: i64,
) -> Result<(), IdentityDeliveryError> {
    validate_provider_authority_configuration(gateway)?;
    let updated = sqlx::query_scalar::<_, i64>(
        "UPDATE auth_delivery_provider_authority \
         SET circuit_version = circuit_version + 1, \
             suspended_at = GREATEST(COALESCE(suspended_at, $3), $3), \
             suspension_code = 'provider_unavailable', \
             suspension_observation_id = CASE \
                 WHEN suspended_at IS NULL OR suspended_at <= $3 \
                 THEN $4 ELSE suspension_observation_id END, \
             probe_token = NULL, \
             probe_expires_at = NULL \
         WHERE generation_id = $1 AND configuration_fingerprint = $2 \
           AND retired_at IS NULL \
         RETURNING circuit_version",
    )
    .bind(gateway.provider_id())
    .bind(gateway.configuration_fingerprint())
    .bind(now)
    .bind(observation_id)
    .fetch_optional(&mut **tx)
    .await?;
    if updated.is_none() {
        return Err(IdentityDeliveryError::ProviderContinuity(
            "provider-unavailable observation no longer matches the active configured generation"
                .to_string(),
        ));
    }
    Ok(())
}

async fn record_provider_probe_audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    actor_principal_id: &PrincipalId,
    provider_generation: &str,
    probe_token: Uuid,
    outcome: IdentityDeliveryProviderProbeOutcome,
    circuit_version: i64,
    now: i64,
) -> Result<(), sqlx::Error> {
    let outcome = match outcome {
        IdentityDeliveryProviderProbeOutcome::Available => "available",
        IdentityDeliveryProviderProbeOutcome::Unavailable => "unavailable",
    };
    let token_hash = format!(
        "{:x}",
        Sha256::digest(
            format!("fmarch.identity-delivery.provider-probe.v1:{probe_token}").as_bytes()
        )
    );
    let metadata = serde_json::json!({
        "provider_generation": provider_generation,
        "outcome": outcome,
        "circuit_version": circuit_version,
    });
    sqlx::query(
        "INSERT INTO identity_lifecycle_audit (\
            event_at, event_kind, actor_principal_id, principal_id, token_hash, \
            related_token_hash, metadata\
         ) VALUES ($1, 'auth_delivery_provider_probe_completed', $2, $2, $3, NULL, $4::JSONB)",
    )
    .bind(now)
    .bind(actor_principal_id.as_uuid())
    .bind(token_hash)
    .bind(metadata.to_string())
    .execute(&mut **tx)
    .await?;
    Ok(())
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
        bounded_delivery_database_operation, bounded_provider_delivery,
        DisabledIdentityDeliveryGateway, IdentityDeliveryAttempt, IdentityDeliveryCancellationCode,
        IdentityDeliveryError, IdentityDeliveryFailureCode, IdentityDeliveryGateway,
        IdentityDeliveryHttpTimeouts, IdentityDeliveryKind, IdentityDeliveryOutcome,
        IdentityDeliveryPreInvocationFailure, IdentityDeliveryResolution,
        IdentityDeliveryRetryPolicy, IdentityDeliveryWorkerConfig,
        LocalDeterministicIdentityDeliveryGateway, DISABLED_PROVIDER_ID,
        LOCAL_DETERMINISTIC_PROVIDER_ID,
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
                    assert_eq!(payload["schema"], "fmarch.identity-delivery.v2");
                    assert_eq!(payload["provider_generation"], "fixture-http");
                    assert_eq!(payload["credential"], "one-time-secret");
                    assert_eq!(payload["idempotency_key"], payload["delivery_id"]);
                    assert_eq!(payload["attempt_token"], Uuid::from_u128(1).to_string());
                    assert_eq!(payload["lease_expires_at"], 4_102_444_795_i64);
                    assert_eq!(payload["clock_skew_margin_seconds"], 5_i64);
                    axum::Json(serde_json::json!({
                        "schema": "fmarch.identity-delivery-result.v2",
                        "provider_generation": payload["provider_generation"],
                        "delivery_id": payload["delivery_id"],
                        "attempt_token": payload["attempt_token"],
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
    async fn http_json_gateway_never_treats_transport_rejection_as_recipient_rejection() {
        let app = axum::Router::new().route(
            "/delivery",
            axum::routing::post(|| async { axum::http::StatusCode::CONFLICT }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let gateway = super::HttpJsonIdentityDeliveryGateway::new(
            "fixture-contract-rejection",
            reqwest::Url::parse(&format!("http://{address}/delivery")).unwrap(),
            None,
            reqwest::Client::new(),
        );
        let mut delivery_attempt = attempt(1);
        delivery_attempt.credential_material = Some("one-time-secret".to_string());

        assert_eq!(
            gateway.deliver(&delivery_attempt).await,
            IdentityDeliveryOutcome::UncertainFailure {
                code: IdentityDeliveryFailureCode::ProviderUnavailable,
                retry_after_seconds: None,
            }
        );
    }

    #[tokio::test]
    async fn http_json_gateway_requires_an_attempt_bound_completion_acknowledgement() {
        let app = axum::Router::new().route(
            "/delivery",
            axum::routing::post(
                |axum::Json(payload): axum::Json<serde_json::Value>| async move {
                    axum::Json(serde_json::json!({
                        "schema": "fmarch.identity-delivery-result.v2",
                        "provider_generation": payload["provider_generation"],
                        "delivery_id": payload["delivery_id"],
                        "attempt_token": Uuid::from_u128(2),
                        "status": "permanent_failure",
                        "code": "recipient_rejected"
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
            "fixture-bound-result",
            reqwest::Url::parse(&format!("http://{address}/delivery")).unwrap(),
            None,
            reqwest::Client::new(),
        );
        let mut delivery_attempt = attempt(1);
        delivery_attempt.credential_material = Some("one-time-secret".to_string());

        assert_eq!(
            gateway.deliver(&delivery_attempt).await,
            IdentityDeliveryOutcome::UncertainFailure {
                code: IdentityDeliveryFailureCode::ProviderUnavailable,
                retry_after_seconds: None,
            }
        );
    }

    #[tokio::test]
    async fn http_json_gateway_rejects_unknown_permanent_outcomes_as_uncertain() {
        let app = axum::Router::new().route(
            "/delivery",
            axum::routing::post(
                |axum::Json(payload): axum::Json<serde_json::Value>| async move {
                    axum::Json(serde_json::json!({
                        "schema": "fmarch.identity-delivery-result.v2",
                        "provider_generation": payload["provider_generation"],
                        "delivery_id": payload["delivery_id"],
                        "attempt_token": payload["attempt_token"],
                        "status": "permanent_failure",
                        "code": "unknown_terminal_reason"
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
            "fixture-strict-result",
            reqwest::Url::parse(&format!("http://{address}/delivery")).unwrap(),
            None,
            reqwest::Client::new(),
        );
        let mut delivery_attempt = attempt(1);
        delivery_attempt.credential_material = Some("one-time-secret".to_string());

        assert_eq!(
            gateway.deliver(&delivery_attempt).await,
            IdentityDeliveryOutcome::UncertainFailure {
                code: IdentityDeliveryFailureCode::ProviderUnavailable,
                retry_after_seconds: None,
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
            IdentityDeliveryOutcome::UncertainFailure {
                code: IdentityDeliveryFailureCode::ProviderUnavailable,
                retry_after_seconds: None,
            }
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
                    assert_eq!(payload["schema"], "fmarch.identity-delivery.v2");
                    assert_eq!(payload["provider_generation"], "fixture-retry");
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
                            "schema": "fmarch.identity-delivery-result.v2",
                            "provider_generation": payload["provider_generation"],
                            "delivery_id": payload["delivery_id"],
                            "attempt_token": payload["attempt_token"],
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
            IdentityDeliveryOutcome::UncertainFailure {
                code: IdentityDeliveryFailureCode::ProviderUnavailable,
                retry_after_seconds: Some(7),
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
            attempt_token: Uuid::from_u128(1),
            lease_expires_at: 4_102_444_795,
            clock_skew_margin_seconds: 5,
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
        assert!(gateway.is_enabled());
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
        assert!(!gateway.is_enabled());
        assert_eq!(gateway.provider_id(), DISABLED_PROVIDER_ID);
        assert_eq!(
            gateway.deliver(&attempt(1)).await,
            IdentityDeliveryOutcome::PermanentFailure(
                IdentityDeliveryFailureCode::CredentialUnavailable
            )
        );
    }

    #[tokio::test]
    async fn near_deadline_provider_success_receives_a_fresh_finalization_budget() {
        let phase_timeout = Duration::from_millis(250);
        let started = Instant::now();
        let outcome = bounded_provider_delivery(phase_timeout, async {
            tokio::time::sleep(Duration::from_millis(150)).await;
            IdentityDeliveryOutcome::Delivered {
                provider_receipt_id: "near-deadline-receipt".to_string(),
            }
        })
        .await;
        let finalized =
            bounded_delivery_database_operation(phase_timeout, "finalization", async move {
                tokio::time::sleep(Duration::from_millis(150)).await;
                Ok::<_, IdentityDeliveryError>(outcome)
            })
            .await
            .unwrap();

        assert!(matches!(
            finalized,
            IdentityDeliveryOutcome::Delivered { .. }
        ));
        assert!(started.elapsed() > phase_timeout);
    }

    #[test]
    fn typed_outcomes_keep_retryability_and_terminality_distinct() {
        let retryable = IdentityDeliveryOutcome::RetryableFailure(
            IdentityDeliveryFailureCode::ProviderUnavailable,
        );
        let suppressed = IdentityDeliveryResolution::RetryableBeforeProviderInvocation(
            IdentityDeliveryPreInvocationFailure::ProviderSuspended,
        );
        let preparation_transient = IdentityDeliveryResolution::RetryableBeforeProviderInvocation(
            IdentityDeliveryPreInvocationFailure::PreparationTransient,
        );
        let uncertain = IdentityDeliveryOutcome::UncertainFailure {
            code: IdentityDeliveryFailureCode::ProviderUnavailable,
            retry_after_seconds: None,
        };
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
        assert_eq!(
            suppressed.code(),
            Some("provider_suspended_before_invocation")
        );
        assert!(suppressed.preserves_attempt_generation());
        assert!(!suppressed.provider_unavailable());
        assert_eq!(
            preparation_transient.code(),
            Some("local_transient_before_provider_invocation")
        );
        assert!(preparation_transient.preserves_attempt_generation());
        assert_eq!(uncertain.status(), "retryable_failed");
        assert_eq!(uncertain.kind(), "retryable_failure");
        assert_eq!(uncertain.code(), Some("provider_unavailable"));
        assert_eq!(uncertain.retry_after_seconds(), Some(1));
        assert!(uncertain.provider_completion_uncertain());
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
            2,
            Duration::from_millis(100),
            Duration::from_secs(10),
            Duration::from_secs(1),
            Duration::from_secs(9),
            Duration::from_secs(1),
            retry,
        )
        .is_err());
    }

    #[test]
    fn worker_config_reserves_claim_commit_time_outside_the_post_claim_budget() {
        let retry =
            IdentityDeliveryRetryPolicy::new(Duration::from_secs(2), Duration::from_secs(60), 8)
                .unwrap();
        assert!(IdentityDeliveryWorkerConfig::new(
            4,
            2,
            Duration::from_millis(100),
            Duration::from_secs(13),
            Duration::from_secs(1),
            Duration::from_secs(5),
            Duration::from_secs(2),
            retry,
        )
        .is_err());
        let config = IdentityDeliveryWorkerConfig::new(
            4,
            2,
            Duration::from_millis(100),
            Duration::from_secs(14),
            Duration::from_secs(1),
            Duration::from_secs(5),
            Duration::from_secs(2),
            retry,
        )
        .unwrap();
        assert_eq!(config.total_timeout(), Duration::from_secs(9));
        assert_eq!(config.lease_coverage_timeout(), Duration::from_secs(11));
    }

    #[test]
    fn retry_policy_applies_full_jitter_and_provider_floor() {
        let retry =
            IdentityDeliveryRetryPolicy::new(Duration::from_secs(2), Duration::from_secs(60), 8)
                .unwrap();
        let config = IdentityDeliveryWorkerConfig::new(
            4,
            2,
            Duration::from_millis(100),
            Duration::from_secs(30),
            Duration::from_secs(1),
            Duration::from_secs(5),
            Duration::from_secs(2),
            retry,
        )
        .unwrap();
        assert_eq!(config.retry_delay_seconds(1, None, 0), 1);
        assert_eq!(config.retry_delay_seconds(3, None, 7), 8);
        assert_eq!(config.retry_delay_seconds(3, Some(17), 0), 17);
        assert_eq!(config.retry_delay_seconds(30, Some(600), 0), 60);
    }
}
