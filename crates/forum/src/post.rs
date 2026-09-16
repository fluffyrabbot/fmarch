//! Decisions about one explicitly addressed forum post.

use content_reference::{decide_profile_mentions, MentionCandidate};
use uuid::Uuid;

use crate::{
    ForumReject, PostBody, PostState, PostingState, TopicEvent, TopicState, TopicVisibility,
    FORUM_EDIT_WINDOW_SECONDS,
};

/// Exactly one loaded post and its topic policy. A partial topic-wide vector
/// cannot masquerade as the write aggregate, and foreign post state is refused.
#[derive(Debug, Clone, Copy)]
pub struct PostDecisionContext<'a> {
    topic: &'a TopicState,
    post: &'a PostState,
}

impl<'a> PostDecisionContext<'a> {
    pub fn new(topic: &'a TopicState, post: &'a PostState) -> Result<Self, ForumReject> {
        if post.topic_id != topic.topic_id || post.source_seq < 1 {
            return Err(ForumReject::PostNotFound);
        }
        Ok(Self { topic, post })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PostCommand {
    Edit {
        body: PostBody,
        mentions: Vec<MentionCandidate>,
        author_profile_id: Uuid,
        expected_revision: i64,
        now: i64,
    },
    Retract {
        author_profile_id: Uuid,
    },
}

pub fn decide_post(
    context: PostDecisionContext<'_>,
    command: PostCommand,
) -> Result<Vec<TopicEvent>, ForumReject> {
    let PostDecisionContext { topic, post } = context;
    if topic.visibility != TopicVisibility::Visible {
        return Err(ForumReject::TopicHidden);
    }
    if topic.posting_state != PostingState::Open {
        return Err(ForumReject::TopicLocked);
    }
    let author = match &command {
        PostCommand::Edit {
            author_profile_id, ..
        }
        | PostCommand::Retract { author_profile_id } => *author_profile_id,
    };
    if post.author_profile_id != Some(author) {
        return Err(ForumReject::NotAuthor);
    }
    if post.retracted {
        return Err(ForumReject::PostRetracted);
    }
    match command {
        PostCommand::Edit {
            body,
            mentions,
            expected_revision,
            now,
            ..
        } => {
            if expected_revision < 0 || post.revision < 0 {
                return Err(ForumReject::InvalidRevision);
            }
            if post.revision != expected_revision {
                return Err(ForumReject::StaleRevision);
            }
            let age = now
                .checked_sub(post.created_at)
                .ok_or(ForumReject::EditWindowElapsed)?;
            if !(0..=FORUM_EDIT_WINDOW_SECONDS).contains(&age) {
                return Err(ForumReject::EditWindowElapsed);
            }
            body.require_content(post.has_quotations)?;
            let mentions = decide_profile_mentions(body.as_str(), &mentions)?;
            if post.body == body.as_str() && post.mentions == mentions {
                return Err(ForumReject::NoStateChange);
            }
            let revision = post
                .revision
                .checked_add(1)
                .ok_or(ForumReject::InvalidRevision)?;
            Ok(vec![TopicEvent::PostEdited {
                source_seq: post.source_seq,
                body: body.into_string(),
                mentions,
                revision,
            }])
        }
        PostCommand::Retract { .. } => Ok(vec![TopicEvent::PostRetracted {
            source_seq: post.source_seq,
        }]),
    }
}
