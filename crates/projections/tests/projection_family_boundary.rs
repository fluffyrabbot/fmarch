use std::path::PathBuf;

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
