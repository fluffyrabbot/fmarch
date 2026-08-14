use std::path::PathBuf;

#[test]
fn host_prompt_resolution_has_one_typed_owner_without_admission_or_persistence_drift() {
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let composition_root = std::fs::read_to_string(source_root.join("lib.rs")).unwrap();
    let prompt_owner =
        std::fs::read_to_string(source_root.join("host_prompt_resolution.rs")).unwrap();

    assert!(composition_root.contains("mod host_prompt_resolution;"));
    assert!(composition_root.contains("admit_host_prompt_resolution("));
    assert!(composition_root.contains("host_prompt_resolution::HostPromptResolutionContext::new("));
    assert!(composition_root.contains("host_prompt_resolution::HostPromptResolutionRequest {"));
    assert!(composition_root
        .contains("host_prompt_resolution::rerun_stored_host_prompt(game, prefix)?"));

    for owned_symbol in [
        "struct HostPromptResolutionRequest",
        "struct HostPromptResolutionContext",
        "enum HostPromptEffect",
        "struct PkResolutionContext",
        "struct HostPromptPhaseControlPayload",
        "pub(super) async fn resolve_host_prompt(",
        "pub(super) fn rerun_stored_host_prompt(",
        "fn host_prompt_from_stream(",
        "fn build_pk_prompt_resolution(",
        "fn host_prompt_effect(",
        "fn host_prompt_public_resolution(",
        "fn phase_advanced_from_prompt(",
        "fn next_revote_phase_id(",
    ] {
        assert!(
            prompt_owner.contains(owned_symbol),
            "missing host-prompt owner: {owned_symbol}"
        );
        assert!(
            !composition_root.contains(owned_symbol),
            "command composition root still owns host-prompt symbol: {owned_symbol}"
        );
    }

    for preserved_contract in [
        "projections::host_prompts(",
        "eventstore::load_stream_in_tx(",
        "load_pack(&pack_artifact_from_stream(",
        "\"HostPromptResolved\"",
        "host_prompt_effect(",
        "host_prompt_public_resolution(",
        "public_resolution does not match rebuilt prompt effect",
        "\"ResolutionApplied\"",
        "\"ResolutionTrace\"",
        "\"PhaseAdvanced\"",
        "persist(tx, game, &events).await",
    ] {
        assert!(
            prompt_owner.contains(preserved_contract),
            "missing preserved host-prompt contract: {preserved_contract}"
        );
    }

    for root_owned_contract in [
        "require_game(tx, game).await?",
        "resolve_capabilities_in_tx(tx, principal, game).await?",
        "require_game_run(tx, &caps, game, CohostPermissionClass::HostPromptResolve).await?",
        "pub async fn handle_idempotent(",
        "pub(crate) async fn persist(",
    ] {
        assert!(
            composition_root.contains(root_owned_contract),
            "composition root lost shared command contract: {root_owned_contract}"
        );
    }

    assert!(
        !prompt_owner.contains("resolve_capabilities_in_tx")
            && !prompt_owner.contains("require_game_run")
            && !prompt_owner.contains("caps::")
            && !prompt_owner.contains("Principal")
            && !prompt_owner.contains("sqlx::query")
            && !prompt_owner.contains("append_and_project_in_tx")
            && !prompt_owner.contains("async fn persist(")
            && !prompt_owner.contains("use super::*")
            && !prompt_owner.contains("#[expect")
            && !prompt_owner.contains("#[allow(clippy"),
        "the host-prompt owner must not absorb admission, SQL, persistence, wildcard imports, or lint debt"
    );

    assert!(!composition_root.contains(
        "prompt resolution inputs remain explicit until prompt rebuilding owns a typed resolution context"
    ));
    assert!(!prompt_owner.contains(
        "prompt resolution inputs remain explicit until prompt rebuilding owns a typed resolution context"
    ));
}
