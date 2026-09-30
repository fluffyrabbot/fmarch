//! Authoritative forum state folded only from its canonical typed history.

use std::collections::BTreeMap;

use content_reference::{PostKind, PostRef, Quotation, QuotationPostState, QuotationThreadState};
use uuid::Uuid;

use crate::{DecodedForumEvent, PostState, PostingState, TopicState, TopicVisibility};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForumEventRecord {
    pub source_seq: i64,
    pub stream_seq: i64,
    pub occurred_at: i64,
    pub event: DecodedForumEvent,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid forum history at stream version {stream_seq}: {reason}")]
pub struct ForumReplayError {
    pub stream_seq: i64,
    pub reason: &'static str,
}

fn invalid(record: &ForumEventRecord, reason: &'static str) -> ForumReplayError {
    ForumReplayError {
        stream_seq: record.stream_seq,
        reason,
    }
}

fn validate_position(
    record: &ForumEventRecord,
    version: i64,
    last_seq: i64,
) -> Result<(), ForumReplayError> {
    if version.checked_add(1) != Some(record.stream_seq) {
        return Err(invalid(
            record,
            "stream versions must be contiguous from one",
        ));
    }
    if record.source_seq <= last_seq {
        return Err(invalid(
            record,
            "global event positions must be positive and increasing",
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AreaState {
    pub area_id: Uuid,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub version: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AreaAggregate {
    state: Option<AreaState>,
}

impl AreaAggregate {
    pub fn replay(area_id: Uuid, records: &[ForumEventRecord]) -> Result<Self, ForumReplayError> {
        let mut aggregate = Self::default();
        for record in records {
            validate_position(record, 0, 0)?;
            if aggregate.state.is_some() {
                return Err(invalid(record, "an area has exactly one creation fact"));
            }
            let DecodedForumEvent::AreaCreated {
                slug,
                title,
                description,
            } = &record.event
            else {
                return Err(invalid(
                    record,
                    "a topic fact cannot inhabit an area stream",
                ));
            };
            aggregate.state = Some(AreaState {
                area_id,
                slug: slug.clone(),
                title: title.clone(),
                description: description.clone(),
                version: record.stream_seq,
            });
        }
        Ok(aggregate)
    }

    pub fn state(&self) -> Option<&AreaState> {
        self.state.as_ref()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TopicAggregate {
    state: Option<TopicState>,
    posts: BTreeMap<i64, PostState>,
    quotations: BTreeMap<i64, Vec<Quotation>>,
}

impl TopicAggregate {
    pub fn replay(topic_id: Uuid, records: &[ForumEventRecord]) -> Result<Self, ForumReplayError> {
        let mut aggregate = Self::default();
        let mut version = 0;
        let mut last_seq = 0;
        for record in records {
            validate_position(record, version, last_seq)?;
            aggregate.fold(topic_id, record)?;
            version = record.stream_seq;
            last_seq = record.source_seq;
        }
        Ok(aggregate)
    }

    pub fn state(&self) -> Option<&TopicState> {
        self.state.as_ref()
    }
    pub fn post(&self, source_seq: i64) -> Option<&PostState> {
        self.posts.get(&source_seq)
    }
    pub fn version(&self) -> i64 {
        self.state.as_ref().map_or(0, |state| state.version)
    }

    /// Canonical bodies and quotation edges. The publication adapter applies
    /// current moderation/mute visibility; query-projection bodies have no say.
    pub fn quotation_thread(&self) -> Option<QuotationThreadState> {
        let state = self.state.as_ref()?;
        Some(QuotationThreadState {
            thread: PostRef {
                kind: PostKind::DiscussionPost,
                scope_id: state.topic_id,
                source_seq: 0,
            },
            posts: self
                .posts
                .values()
                .map(|post| QuotationPostState {
                    source_seq: post.source_seq,
                    body: post.body.clone(),
                    outgoing: self
                        .quotations
                        .get(&post.source_seq)
                        .into_iter()
                        .flatten()
                        .map(|quotation| quotation.target.clone())
                        .collect(),
                    visible: !post.retracted && state.visibility == TopicVisibility::Visible,
                })
                .collect(),
        })
    }

    fn fold(&mut self, topic_id: Uuid, record: &ForumEventRecord) -> Result<(), ForumReplayError> {
        use DecodedForumEvent as Event;
        if let Event::TopicCreated { area_id, title, .. } = &record.event {
            if self.state.is_some() || record.stream_seq != 1 {
                return Err(invalid(
                    record,
                    "topic creation must be the unique first fact",
                ));
            }
            self.state = Some(TopicState {
                topic_id,
                area_id: *area_id,
                title: title.clone(),
                pinned: false,
                posting_state: PostingState::Open,
                visibility: TopicVisibility::Visible,
                version: record.stream_seq,
            });
            return Ok(());
        }
        let state = self
            .state
            .as_mut()
            .ok_or_else(|| invalid(record, "topic creation must precede every topic fact"))?;
        match &record.event {
            Event::AreaCreated { .. } | Event::TopicCreated { .. } => {
                return Err(invalid(
                    record,
                    "foreign or repeated creation fact in topic stream",
                ))
            }
            Event::PostSubmitted {
                body,
                author_profile_id,
                quotations,
                mentions,
            } => {
                self.posts.insert(
                    record.source_seq,
                    PostState {
                        topic_id,
                        source_seq: record.source_seq,
                        author_profile_id: *author_profile_id,
                        body: body.clone(),
                        mentions: mentions.clone(),
                        has_quotations: !quotations.is_empty(),
                        created_at: record.occurred_at,
                        revision: 0,
                        retracted: false,
                    },
                );
                self.quotations
                    .insert(record.source_seq, quotations.clone());
            }
            Event::PostEdited {
                source_seq,
                body,
                mentions,
                revision,
            } => {
                let post = self
                    .posts
                    .get_mut(source_seq)
                    .ok_or_else(|| invalid(record, "edit names a missing or foreign post"))?;
                if post.retracted || post.revision.checked_add(1) != Some(*revision) {
                    return Err(invalid(
                        record,
                        "edit revision must advance an unretracted post by one",
                    ));
                }
                post.body = body.clone();
                post.mentions = mentions.clone();
                post.revision = *revision;
            }
            Event::PostRetracted { source_seq } => {
                let post = self
                    .posts
                    .get_mut(source_seq)
                    .ok_or_else(|| invalid(record, "retraction names a missing or foreign post"))?;
                if post.retracted {
                    return Err(invalid(record, "post was already retracted"));
                }
                post.retracted = true;
            }
            Event::PostingStateChanged { posting_state } => state.posting_state = *posting_state,
            Event::VisibilityChanged { visibility } => state.visibility = *visibility,
            Event::TopicRenamed { title } => state.title = title.clone(),
            Event::TopicMoved { area_id } => state.area_id = *area_id,
            Event::PinnedChanged { pinned } => state.pinned = *pinned,
        }
        state.version = record.stream_seq;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
