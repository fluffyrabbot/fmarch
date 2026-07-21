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
}
