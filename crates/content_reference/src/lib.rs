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

/// Byte range of the mentioning post's immutable body that the address
/// annotates. There is deliberately no game/community enum over mentions:
/// [`ProfileMention`] is the community address and [`SlotMention`] is the game
/// address, each with its own decide function, so the cross-universe case is
/// unrepresentable instead of rejected. A span is a byte range and carries no
/// identity, which is why both universes may share it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MentionSpan {
    pub offset: usize,
    pub len: usize,
}

/// Address of a community member inside a profile-authored thread. Carries the
/// resolved profile id, never the handle string: a later rename must not
/// re-target the link, and no plaintext handle may reach a durable payload
/// beyond what the author already typed into their own prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfileMention {
    pub profile_id: Uuid,
    pub span: MentionSpan,
}

/// A handle the API boundary resolved to a currently public profile, awaiting
/// the pure span decision. Adapters populate this from `public_profile`;
/// mention validation stays pure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MentionCandidate {
    pub profile_id: Uuid,
    pub handle: String,
    pub offset: usize,
    pub len: usize,
}

pub const MAX_MENTIONS_PER_POST: usize = 8;

/// Decide the profile mentions a new community post may carry. The candidates
/// arrive already resolved to currently public profiles; unknown, private, and
/// redacted handles all fail resolution upstream, so they collapse to one
/// non-disclosing reject before this function ever runs.
pub fn decide_profile_mentions(
    body: &str,
    candidates: &[MentionCandidate],
) -> Result<Vec<ProfileMention>, ContentReferenceReject> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    if candidates.len() > MAX_MENTIONS_PER_POST {
        return Err(ContentReferenceReject::TooManyMentions);
    }
    let mut seen = Vec::with_capacity(candidates.len());
    let mut decided = Vec::with_capacity(candidates.len());
    let mut previous_end = 0usize;
    for candidate in candidates {
        let end = candidate.offset.saturating_add(candidate.len);
        if end > body.len()
            || !body.is_char_boundary(candidate.offset)
            || !body.is_char_boundary(end)
        {
            return Err(ContentReferenceReject::InvalidMentionSpan);
        }
        let span_text = &body[candidate.offset..end];
        span_text
            .strip_prefix('@')
            .filter(|remainder| *remainder == candidate.handle.as_str())
            .ok_or(ContentReferenceReject::InvalidMentionSpan)?;
        if candidate.offset < previous_end {
            return Err(ContentReferenceReject::InvalidMentionSpan);
        }
        if seen
            .iter()
            .any(|profile_id| profile_id == &candidate.profile_id)
        {
            return Err(ContentReferenceReject::DuplicateMention);
        }
        seen.push(candidate.profile_id);
        previous_end = end;
        decided.push(ProfileMention {
            profile_id: candidate.profile_id,
            span: MentionSpan {
                offset: candidate.offset,
                len: candidate.len,
            },
        });
    }
    Ok(decided)
}

/// Parse the additive `mentions` field. Absent, null, or `[]` is none, which is
/// how every pre-mention event upcasts.
pub fn mentions_from_payload(
    payload: &serde_json::Value,
) -> Result<Vec<ProfileMention>, serde_json::Error> {
    match payload.get("mentions") {
        None | Some(serde_json::Value::Null) => Ok(Vec::new()),
        Some(value) => serde_json::from_value(value.clone()),
    }
}

pub fn mentions_payload(mentions: &[ProfileMention]) -> Option<serde_json::Value> {
    (!mentions.is_empty()).then(|| serde_json::to_value(mentions).expect("mentions serialize"))
}

/// Address of a game seat inside a game thread. Slot-stable across
/// replacement, so a mention of Slot 7 on D2 stays a fact about Slot 7 no
/// matter who sits there afterwards; it names no profile, persona, principal,
/// or account.
///
/// This is deliberately a sibling of [`ProfileMention`] rather than a variant
/// of a shared enum. `01-domain-model` calls conflating user and slot the most
/// unfixable mistake in forum mafia software, so the cross-universe case is
/// unrepresentable here instead of rejected at run time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotMention {
    pub slot_id: String,
    pub span: MentionSpan,
}

/// A slot address the composer claimed, awaiting the pure decision. Unlike
/// [`MentionCandidate`], nothing has been resolved yet: the claim is
/// client-supplied text and [`decide_slot_mentions`] is what admits it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotMentionCandidate {
    pub slot_id: String,
    pub offset: usize,
    pub len: usize,
}

/// The seats that could read the posting channel when the post was decided.
///
/// Adapters build this from slot state and private-channel membership; the
/// mention decision stays pure. Hosts and cohosts read every channel but hold
/// no seat, so they never appear here — a mention addresses a slot or nothing.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChannelAudience {
    pub readable_slots: Vec<String>,
}

impl ChannelAudience {
    pub fn new(readable_slots: impl IntoIterator<Item = String>) -> Self {
        Self {
            readable_slots: readable_slots.into_iter().collect(),
        }
    }

    fn admits(&self, slot_id: &str) -> bool {
        self.readable_slots.iter().any(|slot| slot == slot_id)
    }
}

/// Decide the slot mentions a new game post may carry.
///
/// The two-sided check RFC 0007 §4 requires — the slot exists in this game and
/// can read the channel being posted to — is one membership test against
/// `audience`, because a seat absent from the game is absent from every
/// channel's audience. Collapsing both into [`ContentReferenceReject::UnknownMentionTarget`]
/// is the point: naming a non-member slot from inside `scumchat` must not
/// disclose whether the slot exists, whether the channel exists, or which.
pub fn decide_slot_mentions(
    body: &str,
    audience: &ChannelAudience,
    candidates: &[SlotMentionCandidate],
) -> Result<Vec<SlotMention>, ContentReferenceReject> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    if candidates.len() > MAX_MENTIONS_PER_POST {
        return Err(ContentReferenceReject::TooManyMentions);
    }
    let mut seen: Vec<&str> = Vec::with_capacity(candidates.len());
    let mut decided = Vec::with_capacity(candidates.len());
    let mut previous_end = 0usize;
    for candidate in candidates {
        // Target before span: an unreadable seat is refused on the same
        // evidence whether or not the claimed span happens to be well formed.
        if !audience.admits(&candidate.slot_id) {
            return Err(ContentReferenceReject::UnknownMentionTarget);
        }
        let end = candidate.offset.saturating_add(candidate.len);
        if end > body.len()
            || !body.is_char_boundary(candidate.offset)
            || !body.is_char_boundary(end)
        {
            return Err(ContentReferenceReject::InvalidMentionSpan);
        }
        let span_text = &body[candidate.offset..end];
        span_text
            .strip_prefix('@')
            .filter(|remainder| *remainder == candidate.slot_id.as_str())
            .ok_or(ContentReferenceReject::InvalidMentionSpan)?;
        if candidate.offset < previous_end {
            return Err(ContentReferenceReject::InvalidMentionSpan);
        }
        if seen.iter().any(|slot_id| *slot_id == candidate.slot_id) {
            return Err(ContentReferenceReject::DuplicateSlotMention);
        }
        seen.push(candidate.slot_id.as_str());
        previous_end = end;
        decided.push(SlotMention {
            slot_id: candidate.slot_id.clone(),
            span: MentionSpan {
                offset: candidate.offset,
                len: candidate.len,
            },
        });
    }
    Ok(decided)
}

/// Parse the additive `mentions` field of a game post. Absent, null, or `[]`
/// is none, which is how every pre-mention `PostSubmitted` upcasts.
pub fn slot_mentions_from_payload(
    payload: &serde_json::Value,
) -> Result<Vec<SlotMention>, serde_json::Error> {
    match payload.get("mentions") {
        None | Some(serde_json::Value::Null) => Ok(Vec::new()),
        Some(value) => serde_json::from_value(value.clone()),
    }
}

pub fn slot_mentions_payload(mentions: &[SlotMention]) -> Option<serde_json::Value> {
    (!mentions.is_empty()).then(|| serde_json::to_value(mentions).expect("slot mentions serialize"))
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
    #[error("unknown mention target")]
    UnknownMentionTarget,
    #[error("invalid mention span")]
    InvalidMentionSpan,
    #[error("post mentions the same profile more than once")]
    DuplicateMention,
    #[error("post mentions the same slot more than once")]
    DuplicateSlotMention,
    #[error("post carries too many mentions")]
    TooManyMentions,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(profile_id: u128, handle: &str, offset: usize, len: usize) -> MentionCandidate {
        MentionCandidate {
            profile_id: Uuid::from_u128(profile_id),
            handle: handle.to_string(),
            offset,
            len,
        }
    }

    #[test]
    fn empty_mentions_decide_to_nothing() {
        assert_eq!(decide_profile_mentions("hello", &[]), Ok(Vec::new()));
    }

    #[test]
    fn happy_path_stores_id_and_span() {
        let decided = decide_profile_mentions("@alice hi", &[candidate(1, "alice", 0, 6)]).unwrap();
        assert_eq!(
            decided,
            vec![ProfileMention {
                profile_id: Uuid::from_u128(1),
                span: MentionSpan { offset: 0, len: 6 },
            }]
        );
    }

    #[test]
    fn over_cap_rejects() {
        let candidates: Vec<MentionCandidate> = (0..=MAX_MENTIONS_PER_POST)
            .map(|index| candidate(index as u128, "alice", 0, 6))
            .collect();
        assert_eq!(
            decide_profile_mentions("@alice", &candidates),
            Err(ContentReferenceReject::TooManyMentions),
        );
    }

    #[test]
    fn span_violations_reject() {
        // Out of range.
        assert_eq!(
            decide_profile_mentions("hi", &[candidate(1, "alice", 0, 6)]),
            Err(ContentReferenceReject::InvalidMentionSpan),
        );
        // Does not start with '@'.
        assert_eq!(
            decide_profile_mentions("alice!", &[candidate(1, "alice", 0, 5)]),
            Err(ContentReferenceReject::InvalidMentionSpan),
        );
        // Span text disagrees with the resolved handle.
        assert_eq!(
            decide_profile_mentions("@alice", &[candidate(1, "bob", 0, 6)]),
            Err(ContentReferenceReject::InvalidMentionSpan),
        );
        // Mid-character boundary.
        assert_eq!(
            decide_profile_mentions("é", &[candidate(1, "alice", 1, 1)]),
            Err(ContentReferenceReject::InvalidMentionSpan),
        );
    }

    #[test]
    fn ordering_and_duplicate_violations_reject() {
        // Overlapping spans (same span twice for distinct profiles is still
        // not ascending).
        assert_eq!(
            decide_profile_mentions(
                "@alice x",
                &[candidate(1, "alice", 0, 6), candidate(2, "alice", 0, 6),],
            ),
            Err(ContentReferenceReject::InvalidMentionSpan),
        );
        // Descending spans.
        assert_eq!(
            decide_profile_mentions(
                "@alice @bob",
                &[candidate(2, "bob", 7, 4), candidate(1, "alice", 0, 6),],
            ),
            Err(ContentReferenceReject::InvalidMentionSpan),
        );
        // Duplicate target.
        assert_eq!(
            decide_profile_mentions(
                "@alice @alice",
                &[candidate(1, "alice", 0, 6), candidate(1, "alice", 7, 6),],
            ),
            Err(ContentReferenceReject::DuplicateMention),
        );
    }

    #[test]
    fn missing_mentions_upcast_to_empty() {
        assert_eq!(
            mentions_from_payload(&serde_json::json!({})).unwrap(),
            Vec::new(),
        );
        assert_eq!(
            mentions_from_payload(&serde_json::json!({ "mentions": null })).unwrap(),
            Vec::new(),
        );
        assert_eq!(mentions_payload(&[]), None);
    }

    fn audience(slots: &[&str]) -> ChannelAudience {
        ChannelAudience::new(slots.iter().map(|slot| slot.to_string()))
    }

    fn slot_candidate(slot_id: &str, offset: usize, len: usize) -> SlotMentionCandidate {
        SlotMentionCandidate {
            slot_id: slot_id.to_string(),
            offset,
            len,
        }
    }

    #[test]
    fn empty_slot_mentions_decide_to_nothing() {
        assert_eq!(
            decide_slot_mentions("hello", &audience(&["S1"]), &[]),
            Ok(Vec::new()),
        );
    }

    #[test]
    fn slot_happy_path_stores_slot_and_span() {
        let decided = decide_slot_mentions(
            "@S1 you flipped",
            &audience(&["S1", "S2"]),
            &[slot_candidate("S1", 0, 3)],
        )
        .unwrap();
        assert_eq!(
            decided,
            vec![SlotMention {
                slot_id: "S1".to_string(),
                span: MentionSpan { offset: 0, len: 3 },
            }]
        );
    }

    /// Self-mention is accepted; it simply delivers nothing downstream. The
    /// write model does not know which seat is posting and must not learn.
    #[test]
    fn slot_self_mention_is_accepted() {
        assert_eq!(
            decide_slot_mentions("@S1 me", &audience(&["S1"]), &[slot_candidate("S1", 0, 3)]),
            Ok(vec![SlotMention {
                slot_id: "S1".to_string(),
                span: MentionSpan { offset: 0, len: 3 },
            }]),
        );
    }

    /// RFC 0007 §4: a seat absent from this game and a seat that merely cannot
    /// read this channel must be refused on identical evidence, or the reject
    /// becomes an oracle for private-room membership.
    #[test]
    fn foreign_and_non_member_slots_reject_indistinguishably() {
        let scumchat = audience(&["S1", "S4"]);
        let foreign = decide_slot_mentions("@S9 hi", &scumchat, &[slot_candidate("S9", 0, 3)]);
        let non_member = decide_slot_mentions("@S2 hi", &scumchat, &[slot_candidate("S2", 0, 3)]);
        assert_eq!(foreign, Err(ContentReferenceReject::UnknownMentionTarget));
        assert_eq!(foreign, non_member);
        assert_eq!(
            foreign.unwrap_err().to_string(),
            non_member.unwrap_err().to_string()
        );
    }

    /// A malformed span on an unreadable seat still reports the target reject,
    /// so span validity cannot be used to probe the audience.
    #[test]
    fn unreadable_slot_outranks_a_broken_span() {
        assert_eq!(
            decide_slot_mentions("hi", &audience(&["S1"]), &[slot_candidate("S9", 40, 90)]),
            Err(ContentReferenceReject::UnknownMentionTarget),
        );
    }

    #[test]
    fn slot_over_cap_rejects() {
        let roster: Vec<String> = (0..=MAX_MENTIONS_PER_POST)
            .map(|index| format!("S{index}"))
            .collect();
        let candidates: Vec<SlotMentionCandidate> = roster
            .iter()
            .map(|slot_id| slot_candidate(slot_id, 0, 3))
            .collect();
        assert_eq!(
            decide_slot_mentions("@S0", &ChannelAudience::new(roster), &candidates),
            Err(ContentReferenceReject::TooManyMentions),
        );
    }

    #[test]
    fn slot_span_violations_reject() {
        let roster = audience(&["S1", "S2"]);
        // Out of range.
        assert_eq!(
            decide_slot_mentions("hi", &roster, &[slot_candidate("S1", 0, 3)]),
            Err(ContentReferenceReject::InvalidMentionSpan),
        );
        // Does not start with '@'.
        assert_eq!(
            decide_slot_mentions("S1 hi", &roster, &[slot_candidate("S1", 0, 2)]),
            Err(ContentReferenceReject::InvalidMentionSpan),
        );
        // Span text disagrees with the claimed slot.
        assert_eq!(
            decide_slot_mentions("@S1", &roster, &[slot_candidate("S2", 0, 3)]),
            Err(ContentReferenceReject::InvalidMentionSpan),
        );
        // Mid-character boundary.
        assert_eq!(
            decide_slot_mentions("é@S1", &roster, &[slot_candidate("S1", 1, 3)]),
            Err(ContentReferenceReject::InvalidMentionSpan),
        );
    }

    #[test]
    fn slot_ordering_and_duplicate_violations_reject() {
        let roster = audience(&["S1", "S2"]);
        // Overlapping spans.
        assert_eq!(
            decide_slot_mentions(
                "@S1 x",
                &roster,
                &[slot_candidate("S1", 0, 3), slot_candidate("S2", 0, 3)],
            ),
            Err(ContentReferenceReject::InvalidMentionSpan),
        );
        // Descending spans.
        assert_eq!(
            decide_slot_mentions(
                "@S1 @S2",
                &roster,
                &[slot_candidate("S2", 4, 3), slot_candidate("S1", 0, 3)],
            ),
            Err(ContentReferenceReject::InvalidMentionSpan),
        );
        // Duplicate target.
        assert_eq!(
            decide_slot_mentions(
                "@S1 @S1",
                &roster,
                &[slot_candidate("S1", 0, 3), slot_candidate("S1", 4, 3)],
            ),
            Err(ContentReferenceReject::DuplicateSlotMention),
        );
    }

    #[test]
    fn missing_slot_mentions_upcast_to_empty() {
        assert_eq!(
            slot_mentions_from_payload(&serde_json::json!({})).unwrap(),
            Vec::new(),
        );
        assert_eq!(
            slot_mentions_from_payload(&serde_json::json!({ "mentions": null })).unwrap(),
            Vec::new(),
        );
        assert_eq!(
            slot_mentions_from_payload(&serde_json::json!({ "mentions": [] })).unwrap(),
            Vec::new(),
        );
        assert_eq!(slot_mentions_payload(&[]), None);
    }

    /// A decided slot mention round-trips through the event payload without
    /// acquiring a profile, persona, principal, or handle on the way.
    #[test]
    fn slot_mention_payload_round_trips_identity_free() {
        let decided = vec![SlotMention {
            slot_id: "S1".to_string(),
            span: MentionSpan { offset: 0, len: 3 },
        }];
        let payload = serde_json::json!({ "mentions": slot_mentions_payload(&decided).unwrap() });
        assert_eq!(slot_mentions_from_payload(&payload).unwrap(), decided);
        assert_eq!(
            payload["mentions"],
            serde_json::json!([{ "slot_id": "S1", "span": { "offset": 0, "len": 3 } }]),
        );
    }
}
