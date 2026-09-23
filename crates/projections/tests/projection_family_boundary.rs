use std::path::PathBuf;

#[test]
fn forum_projection_consumes_owner_decoded_events_exhaustively() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs");
    let source = std::fs::read_to_string(root).unwrap();
    let fold = source
        .split("async fn fold_discussion_event(")
        .nth(1)
        .unwrap()
        .split("/// Append profile events")
        .next()
        .unwrap();
    assert!(fold.contains("forum::decode_event(&event.kind, event.version, &event.payload)?"));
    assert!(fold.contains("match decoded {"));
    for forbidden in [
        "match event.kind",
        "_ => {}",
        "str_field(",
        "uuid_field(",
        "i64_field(",
        "bool_field(",
        "quotations_from_event(",
        "mentions_from_event(",
        "discussion_author_profile_id(",
        "event.payload.get(",
        "event.payload[",
    ] {
        assert!(
            !fold.contains(forbidden),
            "forum fold bypasses typed owner: {forbidden}"
        );
    }
    for adapter in [
        "pub async fn append_discussion_and_project_in_tx(",
        "pub async fn append_discussion_and_project_expected(",
        "pub async fn append_member_discussion_and_project_expected(",
    ] {
        let body = source
            .split(adapter)
            .nth(1)
            .unwrap()
            .split("\npub async fn ")
            .next()
            .unwrap();
        assert!(
            body.contains("validate_discussion_events(events)?"),
            "missing complete-batch preflight: {adapter}"
        );
    }
}

#[test]
fn effect_and_private_channel_families_have_bounded_typed_owners() {
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let composition_root = std::fs::read_to_string(source_root.join("lib.rs")).unwrap();
    let effects = std::fs::read_to_string(source_root.join("effect_projection.rs")).unwrap();
    let private_channels =
        std::fs::read_to_string(source_root.join("private_channel_projection.rs")).unwrap();

    assert!(composition_root.contains("mod effect_projection;"));
    assert!(composition_root.contains("mod private_channel_projection;"));
    assert!(composition_root.contains(
        "pub use effect_projection::{slot_effects, slot_effects_for_slot, SlotEffectRow};"
    ));
    assert!(composition_root.contains(
        "pub use private_channel_projection::{private_channel_members, PrivateChannelMemberRow};"
    ));

    for owned_symbol in [
        "struct SlotEffectRow",
        "struct EffectProjection",
        "async fn upsert_effect(",
        "async fn delete_effect(",
        "pub async fn slot_effects(",
        "pub async fn slot_effects_for_slot<'e, E>(",
    ] {
        assert!(
            effects.contains(owned_symbol),
            "missing effect owner: {owned_symbol}"
        );
        assert!(
            !composition_root.contains(owned_symbol),
            "composition root still owns effect symbol: {owned_symbol}"
        );
    }

    for owned_symbol in [
        "struct PrivateChannelMemberRow",
        "struct PrivateChannelMemberProjection",
        "async fn insert_member(",
        "async fn delete_channel(",
        "async fn delete_member(",
        "fn members_field(",
        "pub async fn private_channel_members(",
        "fn snapshot_identity(",
        "fn redact_snapshot(",
    ] {
        assert!(
            private_channels.contains(owned_symbol),
            "missing private-channel owner: {owned_symbol}"
        );
        assert!(
            !composition_root.contains(owned_symbol),
            "composition root still owns private-channel symbol: {owned_symbol}"
        );
    }

    assert!(effects.contains("pub(super) async fn project_stored_event("));
    assert!(effects.contains("pub(super) async fn project_inner_event("));
    assert!(private_channels.contains("pub(super) async fn project_stored_event("));
    assert!(composition_root.contains("effect_projection::project_inner_event("));
    assert!(composition_root.contains("private_channel_projection::project_stored_event("));

    for family in [&effects, &private_channels] {
        assert!(family.contains("pub(super) const TABLE"));
        assert!(family.contains("pub(super) const AUDIT_ORDER_BY"));
        assert!(
            !family.contains("use super::*")
                && !family.contains("#[expect")
                && !family.contains("#[allow(clippy"),
            "projection family boundaries must not hide ownership or lint debt"
        );
    }
}
