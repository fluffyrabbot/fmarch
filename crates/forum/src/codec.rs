//! The persisted forum schema, independent of a journal or projection adapter.
//!
//! Version 1 predates profile attribution, quotations, and mentions. Missing
//! attribution remains unknown; absent/null reference lists mean no references.
//! No other missing or malformed field is repaired. Historical text is decoded
//! verbatim, not passed through today's command normalization or admission rules.

use content_reference::{ProfileMention, Quotation};
use serde::{Deserialize, Deserializer};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

use crate::{PostingState, TopicVisibility};

/// A successfully decoded persisted fact. The optional historical author is
/// deliberate: newly decided `TopicEvent` values always carry an author.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
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
        #[serde(default, deserialize_with = "present_profile")]
        author_profile_id: Option<Uuid>,
    },
    #[serde(rename = "DiscussionPostSubmitted")]
    PostSubmitted {
        body: String,
        #[serde(default, deserialize_with = "present_profile")]
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
