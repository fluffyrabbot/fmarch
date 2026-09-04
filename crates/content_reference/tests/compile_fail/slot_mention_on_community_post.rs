//! A slot address must not be constructible on a community post.
//!
//! `mentions_payload` is the community half of the durable write boundary: it
//! is what puts a decided list onto `DiscussionPostSubmitted`. Handing it a
//! game address must fail to compile, because RFC 0007 invariant 5 says the
//! cross-universe case is unrepresentable, not rejected.

use content_reference::{
    decide_profile_mentions, mentions_payload, ChannelAudience, MentionSpan, SlotMention,
    SlotMentionCandidate,
};

pub fn slot_address_reaches_a_discussion_payload() {
    let mention = SlotMention {
        slot_id: "S1".to_string(),
        span: MentionSpan { offset: 0, len: 3 },
    };
    let _ = mentions_payload(&[mention]);
}

pub fn slot_candidate_reaches_the_community_decision() {
    let candidate = SlotMentionCandidate {
        slot_id: "S1".to_string(),
        offset: 0,
        len: 3,
    };
    let _ = decide_profile_mentions("@S1", &[candidate]);
}

pub fn community_decision_accepts_a_channel_audience() {
    let _ = decide_profile_mentions("@S1", &ChannelAudience::default());
}
