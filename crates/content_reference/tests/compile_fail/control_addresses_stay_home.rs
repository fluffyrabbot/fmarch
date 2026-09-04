//! Negative control for the compile-fail fixtures.
//!
//! Each universe used correctly must compile. Without this the boundary proof
//! is worthless: a typo in a fixture would fail to compile for the wrong
//! reason and still be scored as a pass.

use content_reference::{
    decide_profile_mentions, decide_slot_mentions, mentions_payload, slot_mentions_payload,
    ChannelAudience, MentionCandidate, MentionSpan, ProfileMention, SlotMention,
    SlotMentionCandidate,
};

pub fn community_addresses_a_profile() {
    let _ = mentions_payload(&[ProfileMention {
        profile_id: Default::default(),
        span: MentionSpan { offset: 0, len: 6 },
    }]);
    let _ = decide_profile_mentions(
        "@alice",
        &[MentionCandidate {
            profile_id: Default::default(),
            handle: "alice".to_string(),
            offset: 0,
            len: 6,
        }],
    );
}

pub fn a_game_thread_addresses_a_slot() {
    let _ = slot_mentions_payload(&[SlotMention {
        slot_id: "S1".to_string(),
        span: MentionSpan { offset: 0, len: 3 },
    }]);
    let _ = decide_slot_mentions(
        "@S1",
        &ChannelAudience::new(["S1".to_string()]),
        &[SlotMentionCandidate {
            slot_id: "S1".to_string(),
            offset: 0,
            len: 3,
        }],
    );
}
