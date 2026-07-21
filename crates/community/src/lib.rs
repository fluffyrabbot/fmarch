//! Pure write model for public community discussions.
//!
//! HTTP, persistence, and projection concerns stay outside this crate. Callers
//! load a topic state, ask the aggregate to decide a typed command, then append
//! the returned typed events against the state's expected version.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const AREA_CREATED: &str = "DiscussionAreaCreated";
pub const TOPIC_CREATED: &str = "DiscussionTopicCreated";
pub const POST_SUBMITTED: &str = "DiscussionPostSubmitted";
pub const POSTING_STATE_CHANGED: &str = "DiscussionTopicPostingStateChanged";
pub const VISIBILITY_CHANGED: &str = "DiscussionTopicVisibilityChanged";
pub const MODERATION_CASE_OPENED: &str = "ModerationCaseOpened";
pub const MODERATION_REPORT_SUBMITTED: &str = "ModerationReportSubmitted";
pub const MODERATION_CONTENT_HIDDEN: &str = "ModerationContentHidden";
pub const MODERATION_CASE_DISMISSED: &str = "ModerationCaseDismissed";
pub const MODERATION_CONTENT_RESTORED: &str = "ModerationContentRestored";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationTargetKind {
    DiscussionPost,
    GamePost,
}

impl ModerationTargetKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DiscussionPost => "discussion_post",
            Self::GamePost => "game_post",
        }
    }

    pub fn parse(value: &str) -> Result<Self, CommunityReject> {
        match value.trim() {
            "discussion_post" => Ok(Self::DiscussionPost),
            "game_post" => Ok(Self::GamePost),
            _ => Err(CommunityReject::InvalidModerationTarget),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModerationTarget {
    pub kind: ModerationTargetKind,
    pub scope_id: Uuid,
    pub source_seq: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportReasonFamily {
    Spam,
    Harassment,
    Hate,
    SexualContent,
    SelfHarm,
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
            Self::Other => "other",
        }
    }

    pub fn parse(value: &str) -> Result<Self, CommunityReject> {
        match value.trim() {
            "spam" => Ok(Self::Spam),
            "harassment" => Ok(Self::Harassment),
            "hate" => Ok(Self::Hate),
            "sexual_content" => Ok(Self::SexualContent),
            "self_harm" => Ok(Self::SelfHarm),
            "other" => Ok(Self::Other),
            _ => Err(CommunityReject::InvalidReportReason),
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

    pub fn parse(value: &str) -> Result<Self, CommunityReject> {
        match value {
            "open" => Ok(Self::Open),
            "hidden" => Ok(Self::Hidden),
            "dismissed" => Ok(Self::Dismissed),
            "restored" => Ok(Self::Restored),
            _ => Err(CommunityReject::InvalidModerationCaseStatus),
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
            Self::CaseOpened { target } => serde_json::json!({ "target": target }),
            Self::ReportSubmitted {
                report_id,
                reason,
                details,
            } => serde_json::json!({
                "report_id": report_id,
                "reason": reason.as_str(),
                "details": details,
            }),
            Self::ContentHidden { reason }
            | Self::CaseDismissed { reason }
            | Self::ContentRestored { reason } => serde_json::json!({ "reason": reason }),
        }
    }
}

pub fn decide_moderation(
    state: Option<&ModerationCaseState>,
    command: ModerationCommand,
) -> Result<Vec<ModerationEvent>, CommunityReject> {
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
            Err(CommunityReject::ModerationCaseAlreadyExists)
        }
        (None, _) => Err(CommunityReject::ModerationCaseNotFound),
        (
            Some(state),
            ModerationCommand::SubmitReport {
                report_id,
                reason,
                details,
            },
        ) => {
            if state.status == ModerationCaseStatus::Hidden {
                return Err(CommunityReject::ModerationTargetHidden);
            }
            Ok(vec![ModerationEvent::ReportSubmitted {
                report_id,
                reason,
                details,
            }])
        }
        (Some(state), ModerationCommand::Hide { reason }) => {
            if state.status != ModerationCaseStatus::Open {
                return Err(CommunityReject::InvalidModerationTransition);
            }
            Ok(vec![ModerationEvent::ContentHidden { reason }])
        }
        (Some(state), ModerationCommand::Dismiss { reason }) => {
            if state.status != ModerationCaseStatus::Open {
                return Err(CommunityReject::InvalidModerationTransition);
            }
            Ok(vec![ModerationEvent::CaseDismissed { reason }])
        }
        (Some(state), ModerationCommand::Restore { reason }) => {
            if state.status != ModerationCaseStatus::Hidden {
                return Err(CommunityReject::InvalidModerationTransition);
            }
            Ok(vec![ModerationEvent::ContentRestored { reason }])
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AreaCreated {
    pub slug: String,
    pub title: String,
    pub description: String,
}

impl AreaCreated {
    pub fn kind(&self) -> &'static str {
        AREA_CREATED
    }

    pub fn payload(&self) -> serde_json::Value {
        serde_json::json!({
            "slug": self.slug,
            "title": self.title,
            "description": self.description,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PostingState {
    Open,
    Locked,
}

impl PostingState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Locked => "locked",
        }
    }

    pub fn parse(value: &str) -> Result<Self, CommunityReject> {
        match value.trim() {
            "open" => Ok(Self::Open),
            "locked" => Ok(Self::Locked),
            _ => Err(CommunityReject::InvalidPostingState),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TopicVisibility {
    Visible,
    Hidden,
}

impl TopicVisibility {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Visible => "visible",
            Self::Hidden => "hidden",
        }
    }

    pub fn parse(value: &str) -> Result<Self, CommunityReject> {
        match value.trim() {
            "visible" => Ok(Self::Visible),
            "hidden" => Ok(Self::Hidden),
            _ => Err(CommunityReject::InvalidVisibility),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopicState {
    pub topic_id: Uuid,
    pub area_id: Uuid,
    pub posting_state: PostingState,
    pub visibility: TopicVisibility,
    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TopicCommand {
    Create {
        topic_id: Uuid,
        area_id: Uuid,
        title: String,
        opening_body: String,
        author_profile_id: Uuid,
    },
    SubmitPost {
        body: String,
        author_profile_id: Uuid,
    },
    SetPostingState {
        posting_state: PostingState,
    },
    SetVisibility {
        visibility: TopicVisibility,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TopicEvent {
    Created {
        area_id: Uuid,
        title: String,
        author_profile_id: Uuid,
    },
    PostSubmitted {
        body: String,
        author_profile_id: Uuid,
    },
    PostingStateChanged {
        posting_state: PostingState,
    },
    VisibilityChanged {
        visibility: TopicVisibility,
    },
}

impl TopicEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Created { .. } => TOPIC_CREATED,
            Self::PostSubmitted { .. } => POST_SUBMITTED,
            Self::PostingStateChanged { .. } => POSTING_STATE_CHANGED,
            Self::VisibilityChanged { .. } => VISIBILITY_CHANGED,
        }
    }

    pub fn payload(&self) -> serde_json::Value {
        match self {
            Self::Created {
                area_id,
                title,
                author_profile_id,
            } => serde_json::json!({
                "area_id": area_id,
                "title": title,
                "author_profile_id": author_profile_id,
            }),
            Self::PostSubmitted {
                body,
                author_profile_id,
            } => serde_json::json!({
                "body": body,
                "author_profile_id": author_profile_id,
            }),
            Self::PostingStateChanged { posting_state } => {
                serde_json::json!({ "posting_state": posting_state.as_str() })
            }
            Self::VisibilityChanged { visibility } => {
                serde_json::json!({ "visibility": visibility.as_str() })
            }
        }
    }
}

pub fn decide_topic(
    state: Option<&TopicState>,
    command: TopicCommand,
) -> Result<Vec<TopicEvent>, CommunityReject> {
    match (state, command) {
        (
            None,
            TopicCommand::Create {
                area_id,
                title,
                opening_body,
                author_profile_id,
                ..
            },
        ) => Ok(vec![
            TopicEvent::Created {
                area_id,
                title,
                author_profile_id,
            },
            TopicEvent::PostSubmitted {
                body: opening_body,
                author_profile_id,
            },
        ]),
        (Some(_), TopicCommand::Create { .. }) => Err(CommunityReject::TopicAlreadyExists),
        (None, _) => Err(CommunityReject::TopicNotFound),
        (
            Some(state),
            TopicCommand::SubmitPost {
                body,
                author_profile_id,
            },
        ) => {
            if state.visibility != TopicVisibility::Visible {
                return Err(CommunityReject::TopicHidden);
            }
            if state.posting_state != PostingState::Open {
                return Err(CommunityReject::TopicLocked);
            }
            Ok(vec![TopicEvent::PostSubmitted {
                body,
                author_profile_id,
            }])
        }
        (Some(state), TopicCommand::SetPostingState { posting_state }) => {
            if state.posting_state == posting_state {
                return Err(CommunityReject::NoStateChange);
            }
            Ok(vec![TopicEvent::PostingStateChanged { posting_state }])
        }
        (Some(state), TopicCommand::SetVisibility { visibility }) => {
            if state.visibility == visibility {
                return Err(CommunityReject::NoStateChange);
            }
            Ok(vec![TopicEvent::VisibilityChanged { visibility }])
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CommunityReject {
    #[error("discussion topic already exists")]
    TopicAlreadyExists,
    #[error("discussion topic was not found")]
    TopicNotFound,
    #[error("discussion topic is locked")]
    TopicLocked,
    #[error("discussion topic is hidden")]
    TopicHidden,
    #[error("discussion command does not change topic state")]
    NoStateChange,
    #[error("discussion posting state must be open or locked")]
    InvalidPostingState,
    #[error("discussion visibility must be visible or hidden")]
    InvalidVisibility,
    #[error("moderation target must be a public discussion_post or game_post")]
    InvalidModerationTarget,
    #[error("report reason family is invalid")]
    InvalidReportReason,
    #[error("moderation case status is invalid")]
    InvalidModerationCaseStatus,
    #[error("moderation case already exists")]
    ModerationCaseAlreadyExists,
    #[error("moderation case was not found")]
    ModerationCaseNotFound,
    #[error("moderation target is already hidden")]
    ModerationTargetHidden,
    #[error("moderation action is invalid for the current case status")]
    InvalidModerationTransition,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> TopicState {
        TopicState {
            topic_id: Uuid::from_u128(1),
            area_id: Uuid::from_u128(2),
            posting_state: PostingState::Open,
            visibility: TopicVisibility::Visible,
            version: 2,
        }
    }

    #[test]
    fn locked_and_hidden_topics_reject_posts() {
        let profile = Uuid::from_u128(3);
        let mut locked = state();
        locked.posting_state = PostingState::Locked;
        assert_eq!(
            decide_topic(
                Some(&locked),
                TopicCommand::SubmitPost {
                    body: "late".into(),
                    author_profile_id: profile,
                }
            ),
            Err(CommunityReject::TopicLocked)
        );
        let mut hidden = state();
        hidden.visibility = TopicVisibility::Hidden;
        assert_eq!(
            decide_topic(
                Some(&hidden),
                TopicCommand::SubmitPost {
                    body: "late".into(),
                    author_profile_id: profile,
                }
            ),
            Err(CommunityReject::TopicHidden)
        );
    }

    #[test]
    fn moderation_axes_are_independent() {
        let state = state();
        assert!(matches!(
            decide_topic(
                Some(&state),
                TopicCommand::SetPostingState {
                    posting_state: PostingState::Locked
                }
            )
            .unwrap()
            .as_slice(),
            [TopicEvent::PostingStateChanged { .. }]
        ));
        assert!(matches!(
            decide_topic(
                Some(&state),
                TopicCommand::SetVisibility {
                    visibility: TopicVisibility::Hidden
                }
            )
            .unwrap()
            .as_slice(),
            [TopicEvent::VisibilityChanged { .. }]
        ));
    }

    #[test]
    fn moderation_case_transitions_are_explicit_and_restorable() {
        let target = ModerationTarget {
            kind: ModerationTargetKind::DiscussionPost,
            scope_id: Uuid::from_u128(20),
            source_seq: 9,
        };
        let opened = decide_moderation(
            None,
            ModerationCommand::OpenReport {
                target: target.clone(),
                report_id: Uuid::from_u128(22),
                reason: ReportReasonFamily::Spam,
                details: "repeated links".into(),
            },
        )
        .unwrap();
        assert!(matches!(
            opened.as_slice(),
            [
                ModerationEvent::CaseOpened { .. },
                ModerationEvent::ReportSubmitted { .. }
            ]
        ));

        let mut state = ModerationCaseState {
            case_id: Uuid::from_u128(21),
            target,
            status: ModerationCaseStatus::Open,
            version: 2,
        };
        assert!(matches!(
            decide_moderation(Some(&state), ModerationCommand::Hide { reason: "spam".into() }),
            Ok(events) if matches!(events.as_slice(), [ModerationEvent::ContentHidden { .. }])
        ));
        state.status = ModerationCaseStatus::Hidden;
        assert!(matches!(
            decide_moderation(Some(&state), ModerationCommand::Restore { reason: "appeal accepted".into() }),
            Ok(events) if matches!(events.as_slice(), [ModerationEvent::ContentRestored { .. }])
        ));
        assert_eq!(
            decide_moderation(
                Some(&state),
                ModerationCommand::Dismiss {
                    reason: "no violation".into()
                }
            ),
            Err(CommunityReject::InvalidModerationTransition)
        );
    }
}
