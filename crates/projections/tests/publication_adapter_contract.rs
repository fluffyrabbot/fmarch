//! Architectural contract for the source-agnostic public-publication bridge.

use projections::{PublicSearchDocumentType, PublicSearchGroup};
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

#[test]
fn public_search_document_type_serde_matches_as_str_and_group() {
    for (document_type, group) in [
        (
            PublicSearchDocumentType::Discussion,
            PublicSearchGroup::Discussions,
        ),
        (
            PublicSearchDocumentType::DiscussionPost,
            PublicSearchGroup::Discussions,
        ),
        (
            PublicSearchDocumentType::Profile,
            PublicSearchGroup::Profiles,
        ),
        (PublicSearchDocumentType::Game, PublicSearchGroup::Games),
        (PublicSearchDocumentType::GamePost, PublicSearchGroup::Games),
    ] {
        let encoded = serde_json::to_string(&document_type).unwrap();
        assert_eq!(encoded, format!("\"{}\"", document_type.as_str()));
        assert_eq!(
            serde_json::from_str::<PublicSearchDocumentType>(&encoded).unwrap(),
            document_type
        );
        assert_eq!(document_type.group(), group);
    }
}

#[test]
fn public_search_group_serde_matches_as_str() {
    for group in [
        PublicSearchGroup::Discussions,
        PublicSearchGroup::Profiles,
        PublicSearchGroup::Games,
    ] {
        let encoded = serde_json::to_string(&group).unwrap();
        assert_eq!(encoded, format!("\"{}\"", group.as_str()));
        assert_eq!(
            serde_json::from_str::<PublicSearchGroup>(&encoded).unwrap(),
            group
        );
    }
}
