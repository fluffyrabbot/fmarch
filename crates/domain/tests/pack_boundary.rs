use std::path::PathBuf;

fn pack_source(path: &str) -> String {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/pack");
    std::fs::read_to_string(root.join(path)).unwrap()
}

#[test]
fn pack_model_validation_and_private_tests_keep_separate_owners() {
    let facade =
        std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/pack.rs"))
            .unwrap();
    let model = pack_source("model.rs");
    let validation = pack_source("validation.rs");
    let validation_tests = pack_source("validation_tests.rs");

    assert!(facade.contains("mod model;"));
    assert!(facade.contains("mod validation;"));
    assert!(facade.contains("mod validation_tests;"));
    assert!(!model.contains("PackValidationContext"));
    assert!(!validation.contains("PackValidationContext"));
    assert!(validation.contains("pub struct ValidatedPack"));
    assert!(validation.contains("struct PackAnalysis"));
    assert!(!validation.contains("pub struct PackAnalysis"));
    assert!(validation.contains("pub fn validate_pack_validated"));
    assert!(!validation.contains("pub fn new(pack: std::sync::Arc<Pack>)"));
    assert!(!validation.contains("from_unchecked_for_test"));
    assert!(!validation.contains("unsafe fn"));
    assert!(!validation.contains("impl std::ops::Deref for ValidatedPack"));
    assert!(validation.contains("night_stage_order: Box<[IrAbility]>"));
    assert!(!validation.contains("pub fn night_stage_order(&self)"));
    for public_field in [
        "pub pack:",
        "pub role_keys:",
        "pub alignments:",
        "pub effect_tags:",
        "pub team_kill_action_ids:",
        "pub cadence:",
        "pub kill_cause_ids:",
        "pub vote_weight_grant_ids:",
        "pub uses_vote_duel:",
    ] {
        assert!(
            !validation.contains(public_field),
            "ValidatedPack must not expose mutable artifact state: {public_field}"
        );
    }
    assert!(validation_tests.contains("pack_required_ir_version_covers_versioned_action_features"));

    for (owner, source) in [("model", model), ("validation", validation)] {
        assert!(
            !source.contains("#[expect") && !source.contains("#[allow(clippy"),
            "pack {owner} must not hide architectural lint debt"
        );
    }
}
