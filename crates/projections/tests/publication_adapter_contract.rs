//! Architectural contract for the source-agnostic public-publication bridge.

use std::path::PathBuf;

#[test]
fn public_consumers_depend_on_publication_identity_not_post_kind() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let publications = std::fs::read_to_string(root.join("src/publications.rs")).unwrap();
    let attention = std::fs::read_to_string(root.join("src/attention_writes.rs")).unwrap();
    let social = std::fs::read_to_string(root.join("src/social_writes.rs")).unwrap();
    let moderation = std::fs::read_to_string(root.join("src/moderation_writes.rs")).unwrap();

    for adapter in [
        "record_forum_surface",
        "record_game_surface",
        "record_profile_surface",
    ] {
        assert!(
            publications.contains(adapter),
            "missing source adapter: {adapter}"
        );
    }

    for consumer in [attention, social, moderation] {
        assert!(
            !consumer.contains("PostKind")
                && !consumer.contains("DiscussionPost")
                && !consumer.contains("GamePost"),
            "public engagement consumers must not classify source posts"
        );
    }
}
