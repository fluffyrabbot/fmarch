//! Forum text and submitted-content invariants, independent of transport.

use content_reference::{
    decide_profile_mentions, decide_quotations, ContentReferenceReject, MentionCandidate, PostKind,
    ProfileMention, Quotation, QuotationThreadState,
};
use uuid::Uuid;

use crate::ForumReject;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopicTitle(String);

impl TopicTitle {
    pub fn new(value: &str) -> Result<Self, ForumReject> {
        let value = value.trim();
        if value.is_empty() || value.len() > 180 {
            return Err(ForumReject::InvalidTitle);
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn into_string(self) -> String {
        self.0
    }
}

/// Empty text is valid only when the deciding operation retains a quotation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostBody(String);

impl PostBody {
    pub fn new(value: &str) -> Result<Self, ForumReject> {
        let value = value.trim();
        if value.len() > 10_000 {
            return Err(ForumReject::BodyTooLong);
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn require_content(&self, has_quotations: bool) -> Result<(), ForumReject> {
        if self.0.is_empty() && !has_quotations {
            return Err(ForumReject::EmptyPost);
        }
        Ok(())
    }

    pub(crate) fn into_string(self) -> String {
        self.0
    }
}

/// Decided content belongs to exactly one forum topic. Private fields prevent
/// callers from changing the normalized body after its spans/excerpts passed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostContent {
    topic_id: Uuid,
    body: PostBody,
    quotations: Vec<Quotation>,
    mentions: Vec<ProfileMention>,
}

impl PostContent {
    pub fn new(
        thread: &QuotationThreadState,
        body: PostBody,
        quotations: &[Quotation],
        mentions: &[MentionCandidate],
    ) -> Result<Self, ForumReject> {
        if thread.thread.kind != PostKind::DiscussionPost {
            return Err(ContentReferenceReject::InvalidQuotationTarget.into());
        }
        let quotations = decide_quotations(thread, quotations)?;
        body.require_content(!quotations.is_empty())?;
        let mentions = decide_profile_mentions(body.as_str(), mentions)?;
        Ok(Self {
            topic_id: thread.thread.scope_id,
            body,
            quotations,
            mentions,
        })
    }

    pub(crate) fn into_parts(
        self,
        topic_id: Uuid,
    ) -> Result<(String, Vec<Quotation>, Vec<ProfileMention>), ForumReject> {
        if self.topic_id != topic_id {
            return Err(ContentReferenceReject::InvalidQuotationTarget.into());
        }
        Ok((self.body.into_string(), self.quotations, self.mentions))
    }
}
