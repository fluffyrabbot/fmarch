//! Stable references and pure quotation rules shared by independently owned
//! conversation write models.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The source-owned post families that can participate in a quotation.
///
/// This is deliberately a value-level identity, not a shared post aggregate.
/// Public engagement resolves a narrower publication reference instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PostKind {
    DiscussionPost,
    GamePost,
}

impl PostKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DiscussionPost => "discussion_post",
            Self::GamePost => "game_post",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ContentReferenceReject> {
        match value.trim() {
            "discussion_post" => Ok(Self::DiscussionPost),
            "game_post" => Ok(Self::GamePost),
            _ => Err(ContentReferenceReject::InvalidPostKind),
        }
    }
}

/// Immutable source address. Game citation reads also carry their channel
/// boundary in the source-specific thread loader; a future public reference
/// can only be created from a public-publication row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PostRef {
    pub kind: PostKind,
    pub scope_id: Uuid,
    pub source_seq: i64,
}

/// Identity of an item admitted to the public-publication index. Unlike
/// [`PostRef`], this reference carries no source discriminator: public
/// engagement only knows the stable surface and item sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PublicContentRef {
    pub surface_id: Uuid,
    pub source_seq: i64,
}

impl PublicContentRef {
    pub fn new(surface_id: Uuid, source_seq: i64) -> Self {
        Self {
            surface_id,
            source_seq,
        }
    }
}

impl PostRef {
    pub fn thread(kind: PostKind, scope_id: Uuid) -> Self {
        Self {
            kind,
            scope_id,
            source_seq: 0,
        }
    }

    pub fn same_thread_as(&self, thread: &PostRef) -> bool {
        self.kind == thread.kind && self.scope_id == thread.scope_id
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Quotation {
    pub target: PostRef,
    pub excerpt: String,
}

/// One already-committed post in the thread being posted to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuotationPostState {
    pub source_seq: i64,
    pub body: String,
    pub visible: bool,
    pub outgoing: Vec<PostRef>,
}

/// Loaded same-thread posts used to decide quotations. Adapters populate this
/// from their source projection; quotation validation stays pure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuotationThreadState {
    pub thread: PostRef,
    pub posts: Vec<QuotationPostState>,
}

pub const MAX_QUOTATIONS_PER_POST: usize = 8;
pub const MAX_QUOTATION_CHAIN_DEPTH: usize = 8;
pub const MAX_QUOTATION_EXCERPT_BYTES: usize = 1_000;
pub const DEFAULT_POST_CITATION_LIMIT: i64 = 5;
pub const MAX_POST_CITATION_LIMIT: i64 = 20;

/// Decide the quotations a new post may carry. Missing, hidden, and
/// foreign-thread targets collapse to non-disclosing rejects.
pub fn decide_quotations(
    thread: &QuotationThreadState,
    quotations: &[Quotation],
) -> Result<Vec<Quotation>, ContentReferenceReject> {
    if quotations.is_empty() {
        return Ok(Vec::new());
    }
    if quotations.len() > MAX_QUOTATIONS_PER_POST {
        return Err(ContentReferenceReject::TooManyQuotations);
    }
    let mut seen = Vec::with_capacity(quotations.len());
    let mut decided = Vec::with_capacity(quotations.len());
    for quotation in quotations {
        if !quotation.target.same_thread_as(&thread.thread) {
            return Err(ContentReferenceReject::InvalidQuotationTarget);
        }
        if seen
            .iter()
            .any(|target: &PostRef| target == &quotation.target)
        {
            return Err(ContentReferenceReject::DuplicateQuotation);
        }
        seen.push(quotation.target.clone());
        let post = thread
            .posts
            .iter()
            .find(|post| post.source_seq == quotation.target.source_seq && post.visible)
            .ok_or(ContentReferenceReject::QuotationNotFound)?;
        validate_quotation_excerpt(quotation.excerpt.as_str(), post.body.as_str())?;
        if quotation_chain_depth(quotation.target.source_seq, thread) + 1
            > MAX_QUOTATION_CHAIN_DEPTH
        {
            return Err(ContentReferenceReject::QuotationChainTooDeep);
        }
        decided.push(quotation.clone());
    }
    Ok(decided)
}

fn validate_quotation_excerpt(excerpt: &str, body: &str) -> Result<(), ContentReferenceReject> {
    if excerpt.is_empty()
        || excerpt.len() > MAX_QUOTATION_EXCERPT_BYTES
        || excerpt.chars().all(char::is_whitespace)
        || !body.contains(excerpt)
    {
        return Err(ContentReferenceReject::InvalidQuotationExcerpt);
    }
    Ok(())
}

fn quotation_chain_depth(source_seq: i64, thread: &QuotationThreadState) -> usize {
    fn depth_from(
        source_seq: i64,
        thread: &QuotationThreadState,
        visiting: &mut Vec<i64>,
    ) -> usize {
        if visiting.contains(&source_seq) {
            return 0;
        }
        let Some(post) = thread
            .posts
            .iter()
            .find(|post| post.source_seq == source_seq)
        else {
            return 0;
        };
        if post.outgoing.is_empty() {
            return 0;
        }
        visiting.push(source_seq);
        let child = post
            .outgoing
            .iter()
            .filter(|target| target.same_thread_as(&thread.thread))
            .map(|target| depth_from(target.source_seq, thread, visiting))
            .max()
            .unwrap_or(0);
        visiting.pop();
        1 + child
    }
    depth_from(source_seq, thread, &mut Vec::new())
}

/// Parse the additive `quotations` field. Absent, null, or `[]` is none.
pub fn quotations_from_payload(
    payload: &serde_json::Value,
) -> Result<Vec<Quotation>, serde_json::Error> {
    match payload.get("quotations") {
        None | Some(serde_json::Value::Null) => Ok(Vec::new()),
        Some(value) => serde_json::from_value(value.clone()),
    }
}

pub fn quotations_payload(quotations: &[Quotation]) -> Option<serde_json::Value> {
    (!quotations.is_empty())
        .then(|| serde_json::to_value(quotations).expect("quotations serialize"))
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ContentReferenceReject {
    #[error("post kind is invalid")]
    InvalidPostKind,
    #[error("quotation target is not in this thread")]
    InvalidQuotationTarget,
    #[error("quoted post was not found")]
    QuotationNotFound,
    #[error("quotation excerpt is invalid")]
    InvalidQuotationExcerpt,
    #[error("post carries too many quotations")]
    TooManyQuotations,
    #[error("quotation chain exceeds the depth cap")]
    QuotationChainTooDeep,
    #[error("post quotes the same target more than once")]
    DuplicateQuotation,
}
