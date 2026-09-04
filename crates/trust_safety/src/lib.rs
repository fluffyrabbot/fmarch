//! Reports, case decisions, and public-content visibility overlays.

use content_reference::PublicContentRef;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

pub const MODERATION_CASE_OPENED: &str = "ModerationCaseOpened";
pub const MODERATION_REPORT_SUBMITTED: &str = "ModerationReportSubmitted";
pub const MODERATION_CONTENT_HIDDEN: &str = "ModerationContentHidden";
pub const MODERATION_CASE_DISMISSED: &str = "ModerationCaseDismissed";
pub const MODERATION_CONTENT_RESTORED: &str = "ModerationContentRestored";

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum TrustSafetyReject {
    #[error("report reason is invalid")]
    InvalidReportReason,
    #[error("moderation case status is invalid")]
    InvalidModerationCaseStatus,
    #[error("moderation case already exists")]
    ModerationCaseAlreadyExists,
    #[error("moderation case was not found")]
    ModerationCaseNotFound,
    #[error("moderation target is hidden")]
    ModerationTargetHidden,
    #[error("moderation transition is invalid")]
    InvalidModerationTransition,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModerationTarget {
    pub public: PublicContentRef,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportReasonFamily {
    Spam,
    Harassment,
    Hate,
    SexualContent,
    SelfHarm,
    /// Mass-addressing through mentions. Mentions push into an inbox nobody
    /// subscribed to, so abuse of the channel is reportable in its own right
    /// rather than folded into `Other`.
    MentionAbuse,
    Other,
}

impl ReportReasonFamily {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Spam => "spam",
            Self::Harassment => "harassment",
            Self::Hate => "hate",
            Self::SexualContent => "sexual_content",
            Self::SelfHarm => "self_harm",
            Self::MentionAbuse => "mention_abuse",
            Self::Other => "other",
        }
    }
    pub fn parse(value: &str) -> Result<Self, TrustSafetyReject> {
        match value.trim() {
            "spam" => Ok(Self::Spam),
            "harassment" => Ok(Self::Harassment),
            "hate" => Ok(Self::Hate),
            "sexual_content" => Ok(Self::SexualContent),
            "self_harm" => Ok(Self::SelfHarm),
            "mention_abuse" => Ok(Self::MentionAbuse),
            "other" => Ok(Self::Other),
            _ => Err(TrustSafetyReject::InvalidReportReason),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationCaseStatus {
    Open,
    Hidden,
    Dismissed,
    Restored,
}

impl ModerationCaseStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Hidden => "hidden",
            Self::Dismissed => "dismissed",
            Self::Restored => "restored",
        }
    }
    pub fn parse(value: &str) -> Result<Self, TrustSafetyReject> {
        match value {
            "open" => Ok(Self::Open),
            "hidden" => Ok(Self::Hidden),
            "dismissed" => Ok(Self::Dismissed),
            "restored" => Ok(Self::Restored),
            _ => Err(TrustSafetyReject::InvalidModerationCaseStatus),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModerationCaseState {
    pub case_id: Uuid,
    pub target: ModerationTarget,
    pub status: ModerationCaseStatus,
    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModerationCommand {
    OpenReport {
        target: ModerationTarget,
        report_id: Uuid,
        reason: ReportReasonFamily,
        details: String,
    },
    SubmitReport {
        report_id: Uuid,
        reason: ReportReasonFamily,
        details: String,
    },
    Hide {
        reason: String,
    },
    Dismiss {
        reason: String,
    },
    Restore {
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModerationEvent {
    CaseOpened {
        target: ModerationTarget,
    },
    ReportSubmitted {
        report_id: Uuid,
        reason: ReportReasonFamily,
        details: String,
    },
    ContentHidden {
        reason: String,
    },
    CaseDismissed {
        reason: String,
    },
    ContentRestored {
        reason: String,
    },
}

impl ModerationEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::CaseOpened { .. } => MODERATION_CASE_OPENED,
            Self::ReportSubmitted { .. } => MODERATION_REPORT_SUBMITTED,
            Self::ContentHidden { .. } => MODERATION_CONTENT_HIDDEN,
            Self::CaseDismissed { .. } => MODERATION_CASE_DISMISSED,
            Self::ContentRestored { .. } => MODERATION_CONTENT_RESTORED,
        }
    }
    pub fn payload(&self) -> serde_json::Value {
        match self {
            Self::CaseOpened { target } => serde_json::json!({"target": target}),
            Self::ReportSubmitted {
                report_id,
                reason,
                details,
            } => {
                serde_json::json!({"report_id": report_id, "reason": reason.as_str(), "details": details})
            }
            Self::ContentHidden { reason }
            | Self::CaseDismissed { reason }
            | Self::ContentRestored { reason } => serde_json::json!({"reason": reason}),
        }
    }
}

pub fn decide_moderation(
    state: Option<&ModerationCaseState>,
    command: ModerationCommand,
) -> Result<Vec<ModerationEvent>, TrustSafetyReject> {
    match (state, command) {
        (
            None,
            ModerationCommand::OpenReport {
                target,
                report_id,
                reason,
                details,
            },
        ) => Ok(vec![
            ModerationEvent::CaseOpened { target },
            ModerationEvent::ReportSubmitted {
                report_id,
                reason,
                details,
            },
        ]),
        (Some(_), ModerationCommand::OpenReport { .. }) => {
            Err(TrustSafetyReject::ModerationCaseAlreadyExists)
        }
        (None, _) => Err(TrustSafetyReject::ModerationCaseNotFound),
        (
            Some(state),
            ModerationCommand::SubmitReport {
                report_id,
                reason,
                details,
            },
        ) => {
            if state.status == ModerationCaseStatus::Hidden {
                return Err(TrustSafetyReject::ModerationTargetHidden);
            }
            Ok(vec![ModerationEvent::ReportSubmitted {
                report_id,
                reason,
                details,
            }])
        }
        (Some(state), ModerationCommand::Hide { reason })
            if state.status == ModerationCaseStatus::Open =>
        {
            Ok(vec![ModerationEvent::ContentHidden { reason }])
        }
        (Some(state), ModerationCommand::Dismiss { reason })
            if state.status == ModerationCaseStatus::Open =>
        {
            Ok(vec![ModerationEvent::CaseDismissed { reason }])
        }
        (Some(state), ModerationCommand::Restore { reason })
            if state.status == ModerationCaseStatus::Hidden =>
        {
            Ok(vec![ModerationEvent::ContentRestored { reason }])
        }
        _ => Err(TrustSafetyReject::InvalidModerationTransition),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(status: ModerationCaseStatus) -> ModerationCaseState {
        ModerationCaseState {
            case_id: Uuid::from_u128(1),
            target: ModerationTarget {
                public: PublicContentRef::new(Uuid::from_u128(2), 3),
            },
            status,
            version: 1,
        }
    }

    #[test]
    fn every_report_reason_round_trips_through_its_wire_string() {
        for reason in [
            ReportReasonFamily::Spam,
            ReportReasonFamily::Harassment,
            ReportReasonFamily::Hate,
            ReportReasonFamily::SexualContent,
            ReportReasonFamily::SelfHarm,
            ReportReasonFamily::MentionAbuse,
            ReportReasonFamily::Other,
        ] {
            assert_eq!(ReportReasonFamily::parse(reason.as_str()), Ok(reason));
        }
        assert_eq!(
            ReportReasonFamily::parse("mention"),
            Err(TrustSafetyReject::InvalidReportReason),
        );
    }

    #[test]
    fn hidden_content_rejects_new_reports() {
        assert_eq!(
            decide_moderation(
                Some(&state(ModerationCaseStatus::Hidden)),
                ModerationCommand::SubmitReport {
                    report_id: Uuid::from_u128(4),
                    reason: ReportReasonFamily::Spam,
                    details: "spam".to_string(),
                },
            ),
            Err(TrustSafetyReject::ModerationTargetHidden),
        );
    }

    #[test]
    fn only_a_hidden_case_can_be_restored() {
        assert_eq!(
            decide_moderation(
                Some(&state(ModerationCaseStatus::Open)),
                ModerationCommand::Restore {
                    reason: "appeal".to_string(),
                },
            ),
            Err(TrustSafetyReject::InvalidModerationTransition),
        );
    }
}
