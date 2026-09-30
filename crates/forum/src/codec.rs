//! The persisted forum schema, independent of a journal or projection adapter.
//!
//! Version 1 predates profile attribution, quotations, and mentions. Missing
//! attribution remains unknown; absent/null reference lists mean no references.
//! No other missing or malformed field is repaired. Historical text is decoded
//! verbatim, not passed through today's command normalization or admission rules.

use content_reference::{ProfileMention, Quotation};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

use crate::{PostingState, TopicVisibility};

/// A successfully decoded persisted fact. The optional historical author is
/// deliberate: newly decided `TopicEvent` values always carry an author.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", deny_unknown_fields)]
pub enum DecodedForumEvent {
    #[serde(rename = "DiscussionAreaCreated")]
    AreaCreated {
        slug: String,
        title: String,
        description: String,
    },
    #[serde(rename = "DiscussionTopicCreated")]
    TopicCreated {
        area_id: Uuid,
        title: String,
        #[serde(
            default,
            deserialize_with = "present_profile",
            skip_serializing_if = "Option::is_none"
        )]
        author_profile_id: Option<Uuid>,
    },
    #[serde(rename = "DiscussionPostSubmitted")]
    PostSubmitted {
        body: String,
        #[serde(
            default,
            deserialize_with = "present_profile",
            skip_serializing_if = "Option::is_none"
        )]
        author_profile_id: Option<Uuid>,
        #[serde(default, deserialize_with = "reference_list")]
        quotations: Vec<Quotation>,
        #[serde(default, deserialize_with = "reference_list")]
        mentions: Vec<ProfileMention>,
    },
    #[serde(rename = "DiscussionPostEdited")]
    PostEdited {
        source_seq: i64,
        body: String,
        #[serde(default, deserialize_with = "reference_list")]
        mentions: Vec<ProfileMention>,
        revision: i64,
    },
    #[serde(rename = "DiscussionPostRetracted")]
    PostRetracted { source_seq: i64 },
    #[serde(rename = "DiscussionTopicPostingStateChanged")]
    PostingStateChanged { posting_state: PostingState },
    #[serde(rename = "DiscussionTopicVisibilityChanged")]
    VisibilityChanged { visibility: TopicVisibility },
    #[serde(rename = "DiscussionTopicRenamed")]
    TopicRenamed { title: String },
    #[serde(rename = "DiscussionTopicMoved")]
    TopicMoved { area_id: Uuid },
    #[serde(rename = "DiscussionTopicPinnedChanged")]
    PinnedChanged { pinned: bool },
}

#[derive(Debug, Error)]
pub enum ForumDecodeError {
    #[error("unknown forum event kind {kind}")]
    UnknownKind { kind: String },
    #[error("unsupported forum event version {version} for {kind}")]
    UnsupportedVersion { kind: String, version: i16 },
    #[error("malformed forum event {kind} version {version}: {source}")]
    Payload {
        kind: String,
        version: i16,
        #[source]
        source: serde_json::Error,
    },
}

impl DecodedForumEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::AreaCreated { .. } => crate::AREA_CREATED,
            Self::TopicCreated { .. } => crate::TOPIC_CREATED,
            Self::PostSubmitted { .. } => crate::POST_SUBMITTED,
            Self::PostEdited { .. } => crate::POST_EDITED,
            Self::PostRetracted { .. } => crate::POST_RETRACTED,
            Self::PostingStateChanged { .. } => crate::POSTING_STATE_CHANGED,
            Self::VisibilityChanged { .. } => crate::VISIBILITY_CHANGED,
            Self::TopicRenamed { .. } => crate::TOPIC_RENAMED,
            Self::TopicMoved { .. } => crate::TOPIC_MOVED,
            Self::PinnedChanged { .. } => crate::TOPIC_PINNED_CHANGED,
        }
    }

    /// Encoding is owned by the context, including the historical omission of
    /// unknown profile attribution. Callers never assemble a kind/JSON pair.
    pub fn payload(&self) -> Value {
        serde_json::to_value(self)
            .expect("forum facts contain only serializable domain values")
            .get("payload")
            .expect("all forum facts carry a payload")
            .clone()
    }
}

impl From<crate::AreaCreated> for DecodedForumEvent {
    fn from(event: crate::AreaCreated) -> Self {
        Self::AreaCreated {
            slug: event.slug,
            title: event.title,
            description: event.description,
        }
    }
}

impl From<crate::TopicEvent> for DecodedForumEvent {
    fn from(event: crate::TopicEvent) -> Self {
        use crate::TopicEvent;
        match event {
            TopicEvent::Created {
                area_id,
                title,
                author_profile_id,
            } => Self::TopicCreated {
                area_id,
                title,
                author_profile_id: Some(author_profile_id),
            },
            TopicEvent::PostSubmitted {
                body,
                author_profile_id,
                quotations,
                mentions,
            } => Self::PostSubmitted {
                body,
                author_profile_id: Some(author_profile_id),
                quotations,
                mentions,
            },
            TopicEvent::PostEdited {
                source_seq,
                body,
                mentions,
                revision,
            } => Self::PostEdited {
                source_seq,
                body,
                mentions,
                revision,
            },
            TopicEvent::PostRetracted { source_seq } => Self::PostRetracted { source_seq },
            TopicEvent::PostingStateChanged { posting_state } => {
                Self::PostingStateChanged { posting_state }
            }
            TopicEvent::VisibilityChanged { visibility } => Self::VisibilityChanged { visibility },
            TopicEvent::Renamed { title } => Self::TopicRenamed { title },
            TopicEvent::Moved { area_id } => Self::TopicMoved { area_id },
            TopicEvent::PinnedChanged { pinned } => Self::PinnedChanged { pinned },
        }
    }
}

/// Decode exactly the forum-owned kind/version pair. A consumer must stop on
/// any error, including unknown kinds; silently skipping a stored fact could
/// otherwise advance its stream version with an incomplete projection.
pub fn decode_event(
    kind: &str,
    version: i16,
    payload: &Value,
) -> Result<DecodedForumEvent, ForumDecodeError> {
    if !matches!(
        kind,
        crate::AREA_CREATED
            | crate::TOPIC_CREATED
            | crate::POST_SUBMITTED
            | crate::POST_EDITED
            | crate::POST_RETRACTED
            | crate::POSTING_STATE_CHANGED
            | crate::VISIBILITY_CHANGED
            | crate::TOPIC_RENAMED
            | crate::TOPIC_MOVED
            | crate::TOPIC_PINNED_CHANGED
    ) {
        return Err(ForumDecodeError::UnknownKind { kind: kind.into() });
    }
    if version != 1 {
        return Err(ForumDecodeError::UnsupportedVersion {
            kind: kind.into(),
            version,
        });
    }
    serde_json::from_value(serde_json::json!({ "kind": kind, "payload": payload })).map_err(
        |source| ForumDecodeError::Payload {
            kind: kind.into(),
            version,
            source,
        },
    )
}

fn present_profile<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Uuid>, D::Error> {
    // Absence is historical; a present null or malformed UUID never was.
    Uuid::deserialize(deserializer).map(Some)
}

fn reference_list<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<Vec<T>>::deserialize(deserializer).map(Option::unwrap_or_default)
}

#[cfg(test)]
mod tests;
