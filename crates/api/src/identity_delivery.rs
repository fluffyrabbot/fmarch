use uuid::Uuid;

pub const LOCAL_DETERMINISTIC_PROVIDER_ID: &str = "local-deterministic";

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityDeliveryAttempt {
    pub delivery_id: Uuid,
    pub kind: IdentityDeliveryKind,
    pub account_id: String,
    pub principal_user_id: String,
    pub credential_hash: String,
    pub attempt_number: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityDeliveryFailureCode {
    LocalTransient,
    ProviderUnavailable,
    RecipientRejected,
}

impl IdentityDeliveryFailureCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LocalTransient => "local_transient",
            Self::ProviderUnavailable => "provider_unavailable",
            Self::RecipientRejected => "recipient_rejected",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityDeliveryOutcome {
    Delivered,
    RetryableFailure(IdentityDeliveryFailureCode),
    PermanentFailure(IdentityDeliveryFailureCode),
}

impl IdentityDeliveryOutcome {
    pub fn status(self) -> &'static str {
        match self {
            Self::Delivered => "delivered",
            Self::RetryableFailure(_) => "retryable_failed",
            Self::PermanentFailure(_) => "permanent_failed",
        }
    }

    pub fn kind(self) -> &'static str {
        match self {
            Self::Delivered => "delivered",
            Self::RetryableFailure(_) => "retryable_failure",
            Self::PermanentFailure(_) => "permanent_failure",
        }
    }

    pub fn code(self) -> Option<&'static str> {
        match self {
            Self::Delivered => None,
            Self::RetryableFailure(code) | Self::PermanentFailure(code) => Some(code.as_str()),
        }
    }

    pub fn retry_after_seconds(self) -> Option<i64> {
        match self {
            Self::RetryableFailure(_) => Some(1),
            Self::Delivered | Self::PermanentFailure(_) => None,
        }
    }
}

pub trait IdentityDeliveryGateway: Send + Sync {
    fn provider_id(&self) -> &'static str;

    fn deliver(&self, attempt: &IdentityDeliveryAttempt) -> IdentityDeliveryOutcome;
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
    fn provider_id(&self) -> &'static str {
        LOCAL_DETERMINISTIC_PROVIDER_ID
    }

    fn deliver(&self, attempt: &IdentityDeliveryAttempt) -> IdentityDeliveryOutcome {
        if self.fail_first_attempt && attempt.attempt_number == 1 {
            return IdentityDeliveryOutcome::RetryableFailure(
                IdentityDeliveryFailureCode::LocalTransient,
            );
        }
        IdentityDeliveryOutcome::Delivered
    }
}

#[cfg(test)]
mod tests {
    use super::{
        IdentityDeliveryAttempt, IdentityDeliveryFailureCode, IdentityDeliveryGateway,
        IdentityDeliveryKind, IdentityDeliveryOutcome, LocalDeterministicIdentityDeliveryGateway,
        LOCAL_DETERMINISTIC_PROVIDER_ID,
    };
    use uuid::Uuid;

    fn attempt(attempt_number: i32) -> IdentityDeliveryAttempt {
        IdentityDeliveryAttempt {
            delivery_id: Uuid::nil(),
            kind: IdentityDeliveryKind::Invite,
            account_id: "member@example.test".to_string(),
            principal_user_id: "member_a".to_string(),
            credential_hash: "redacted-hash".to_string(),
            attempt_number,
        }
    }

    #[test]
    fn deterministic_gateway_fails_only_the_first_attempt_when_configured() {
        let gateway = LocalDeterministicIdentityDeliveryGateway::new(true);
        assert_eq!(gateway.provider_id(), LOCAL_DETERMINISTIC_PROVIDER_ID);
        assert_eq!(
            gateway.deliver(&attempt(1)),
            IdentityDeliveryOutcome::RetryableFailure(IdentityDeliveryFailureCode::LocalTransient)
        );
        assert_eq!(
            gateway.deliver(&attempt(2)),
            IdentityDeliveryOutcome::Delivered
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
