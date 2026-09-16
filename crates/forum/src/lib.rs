//! Public forum area/topic lifecycle and profile-authored posting policy.

use content_reference::{
    mentions_payload, quotations_payload, ContentReferenceReject, ProfileMention, Quotation,
};

mod content;
mod post;
pub use content::{PostBody, PostContent, TopicTitle};
pub use post::{decide_post, PostCommand, PostDecisionContext};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

pub const AREA_CREATED: &str = "DiscussionAreaCreated";
pub const TOPIC_CREATED: &str = "DiscussionTopicCreated";
pub const POST_SUBMITTED: &str = "DiscussionPostSubmitted";
pub const POST_EDITED: &str = "DiscussionPostEdited";
pub const POST_RETRACTED: &str = "DiscussionPostRetracted";
pub const POSTING_STATE_CHANGED: &str = "DiscussionTopicPostingStateChanged";
pub const VISIBILITY_CHANGED: &str = "DiscussionTopicVisibilityChanged";
pub const TOPIC_RENAMED: &str = "DiscussionTopicRenamed";
pub const TOPIC_MOVED: &str = "DiscussionTopicMoved";
pub const TOPIC_PINNED_CHANGED: &str = "DiscussionTopicPinnedChanged";

/// How long after submission a forum post stays editable by its author,
/// measured from the original submission rather than the last edit so a
/// chain of edits cannot extend the window. Editability is a policy owned by
/// each thread source: this constant is the forum's, and game channels have
/// no counterpart because their posts are slot-authored evidence.
pub const FORUM_EDIT_WINDOW_SECONDS: i64 = 30 * 60;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ForumReject {
    #[error("discussion topic title must contain 1 to 180 bytes")]
    InvalidTitle,
    #[error("discussion post must contain at most 10000 bytes")]
    BodyTooLong,
    #[error("discussion post requires a body or quotation")]
    EmptyPost,
    #[error("discussion post revision is invalid or exhausted")]
    InvalidRevision,
    #[error(transparent)]
    ContentReference(#[from] ContentReferenceReject),
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
    #[error("discussion post was not found")]
    PostNotFound,
    #[error("only the post author may change this post")]
    NotAuthor,
    #[error("discussion post edit window has elapsed")]
    EditWindowElapsed,
    #[error("discussion post was retracted by its author")]
    PostRetracted,
    #[error("discussion post changed since it was read; refresh and try again")]
    StaleRevision,
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
        serde_json::json!({"slug": self.slug, "title": self.title, "description": self.description})
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
    pub fn parse(value: &str) -> Result<Self, ForumReject> {
        match value.trim() {
            "open" => Ok(Self::Open),
            "locked" => Ok(Self::Locked),
            _ => Err(ForumReject::InvalidPostingState),
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
    pub fn parse(value: &str) -> Result<Self, ForumReject> {
        match value.trim() {
            "visible" => Ok(Self::Visible),
            "hidden" => Ok(Self::Hidden),
            _ => Err(ForumReject::InvalidVisibility),
        }
    }
}

/// The slice of one post the write model needs to decide an edit or a
/// retraction. The adapter loads only the addressed post; every other post in
/// the topic is irrelevant to the decision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostState {
    pub topic_id: Uuid,
    pub source_seq: i64,
    pub author_profile_id: Option<Uuid>,
    pub body: String,
    pub mentions: Vec<ProfileMention>,
    /// Quotations are fixed at submission; an edit only needs to know whether
    /// they exist so an emptied body still leaves something to read.
    pub has_quotations: bool,
    pub created_at: i64,
    pub revision: i64,
    pub retracted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopicState {
    pub topic_id: Uuid,
    pub area_id: Uuid,
    pub title: String,
    pub pinned: bool,
    pub posting_state: PostingState,
    pub visibility: TopicVisibility,
    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TopicCommand {
    Create {
        topic_id: Uuid,
        area_id: Uuid,
        title: TopicTitle,
        opening_body: PostBody,
        author_profile_id: Uuid,
    },
    SubmitPost {
        content: PostContent,
        author_profile_id: Uuid,
    },
    SetPostingState {
        posting_state: PostingState,
    },
    SetVisibility {
        visibility: TopicVisibility,
    },
    /// Curation transitions. Capability is decided at the boundary
    /// (GlobalMod); the write model only refuses no-ops. Curation is
    /// independent of posting state: a locked topic can still be filed.
    Rename {
        title: TopicTitle,
    },
    Move {
        area_id: Uuid,
    },
    SetPinned {
        pinned: bool,
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
        quotations: Vec<Quotation>,
        mentions: Vec<ProfileMention>,
    },
    PostEdited {
        source_seq: i64,
        body: String,
        mentions: Vec<ProfileMention>,
        revision: i64,
    },
    PostRetracted {
        source_seq: i64,
    },
    PostingStateChanged {
        posting_state: PostingState,
    },
    VisibilityChanged {
        visibility: TopicVisibility,
    },
    Renamed {
        title: String,
    },
    Moved {
        area_id: Uuid,
    },
    PinnedChanged {
        pinned: bool,
    },
}
impl TopicEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Created { .. } => TOPIC_CREATED,
            Self::PostSubmitted { .. } => POST_SUBMITTED,
            Self::PostEdited { .. } => POST_EDITED,
            Self::PostRetracted { .. } => POST_RETRACTED,
            Self::PostingStateChanged { .. } => POSTING_STATE_CHANGED,
            Self::VisibilityChanged { .. } => VISIBILITY_CHANGED,
            Self::Renamed { .. } => TOPIC_RENAMED,
            Self::Moved { .. } => TOPIC_MOVED,
            Self::PinnedChanged { .. } => TOPIC_PINNED_CHANGED,
        }
    }
    pub fn payload(&self) -> serde_json::Value {
        match self {
            Self::Created {
                area_id,
                title,
                author_profile_id,
            } => {
                serde_json::json!({"area_id": area_id, "title": title, "author_profile_id": author_profile_id})
            }
            Self::PostSubmitted {
                body,
                author_profile_id,
                quotations,
                mentions,
            } => {
                let mut payload =
                    serde_json::json!({"body": body, "author_profile_id": author_profile_id});
                if let Some(quotations) = quotations_payload(quotations) {
                    payload["quotations"] = quotations;
                }
                if let Some(mentions) = mentions_payload(mentions) {
                    payload["mentions"] = mentions;
                }
                payload
            }
            Self::PostEdited {
                source_seq,
                body,
                mentions,
                revision,
            } => {
                let mut payload = serde_json::json!({
                    "source_seq": source_seq,
                    "body": body,
                    "revision": revision,
                });
                if let Some(mentions) = mentions_payload(mentions) {
                    payload["mentions"] = mentions;
                }
                payload
            }
            Self::PostRetracted { source_seq } => {
                serde_json::json!({"source_seq": source_seq})
            }
            Self::PostingStateChanged { posting_state } => {
                serde_json::json!({"posting_state": posting_state.as_str()})
            }
            Self::VisibilityChanged { visibility } => {
                serde_json::json!({"visibility": visibility.as_str()})
            }
            Self::Renamed { title } => serde_json::json!({"title": title}),
            Self::Moved { area_id } => serde_json::json!({"area_id": area_id}),
            Self::PinnedChanged { pinned } => serde_json::json!({"pinned": pinned}),
        }
    }
}

pub fn decide_topic(
    state: Option<&TopicState>,
    command: TopicCommand,
) -> Result<Vec<TopicEvent>, ForumReject> {
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
        ) => {
            opening_body.require_content(false)?;
            Ok(vec![
                TopicEvent::Created {
                    area_id,
                    title: title.into_string(),
                    author_profile_id,
                },
                TopicEvent::PostSubmitted {
                    body: opening_body.into_string(),
                    author_profile_id,
                    quotations: Vec::new(),
                    mentions: Vec::new(),
                },
            ])
        }
        (Some(_), TopicCommand::Create { .. }) => Err(ForumReject::TopicAlreadyExists),
        (None, _) => Err(ForumReject::TopicNotFound),
        (
            Some(state),
            TopicCommand::SubmitPost {
                content,
                author_profile_id,
            },
        ) => {
            if state.visibility != TopicVisibility::Visible {
                return Err(ForumReject::TopicHidden);
            }
            if state.posting_state != PostingState::Open {
                return Err(ForumReject::TopicLocked);
            }
            let (body, quotations, mentions) = content.into_parts(state.topic_id)?;
            Ok(vec![TopicEvent::PostSubmitted {
                body,
                author_profile_id,
                quotations,
                mentions,
            }])
        }
        (Some(state), TopicCommand::SetPostingState { posting_state })
            if state.posting_state != posting_state =>
        {
            Ok(vec![TopicEvent::PostingStateChanged { posting_state }])
        }
        (Some(state), TopicCommand::SetVisibility { visibility })
            if state.visibility != visibility =>
        {
            Ok(vec![TopicEvent::VisibilityChanged { visibility }])
        }
        (Some(state), TopicCommand::Rename { title }) if state.title != title.as_str() => {
            Ok(vec![TopicEvent::Renamed {
                title: title.into_string(),
            }])
        }
        (Some(state), TopicCommand::Move { area_id }) if state.area_id != area_id => {
            Ok(vec![TopicEvent::Moved { area_id }])
        }
        (Some(state), TopicCommand::SetPinned { pinned }) if state.pinned != pinned => {
            Ok(vec![TopicEvent::PinnedChanged { pinned }])
        }
        _ => Err(ForumReject::NoStateChange),
    }
}

#[cfg(test)]
mod tests;
