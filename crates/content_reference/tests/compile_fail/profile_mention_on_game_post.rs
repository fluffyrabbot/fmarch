//! A profile address must not be constructible on a game post.
//!
//! `slot_mentions_payload` is what puts a decided list onto `PostSubmitted`.
//! Handing it a community address must fail to compile: naming a member
//! profile from inside a game thread is an anonymity break, and RFC 0007
//! invariant 4 makes it unrepresentable rather than validated away.

use content_reference::{
    decide_slot_mentions, slot_mentions_payload, ChannelAudience, MentionCandidate, MentionSpan,
    ProfileMention,
};

pub fn profile_address_reaches_a_game_payload() {
    let mention = ProfileMention {
        profile_id: Default::default(),
        span: MentionSpan { offset: 0, len: 6 },
    };
    let _ = slot_mentions_payload(&[mention]);
}

pub fn profile_candidate_reaches_the_game_decision() {
    let candidate = MentionCandidate {
        profile_id: Default::default(),
        handle: "alice".to_string(),
        offset: 0,
        len: 6,
    };
    let _ = decide_slot_mentions("@alice", &ChannelAudience::default(), &[candidate]);
}

pub fn a_slot_mention_accepts_a_profile_id() {
    let _ = content_reference::SlotMention {
        profile_id: Default::default(),
        span: MentionSpan { offset: 0, len: 6 },
    };
}
