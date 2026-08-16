use std::path::PathBuf;

#[test]
fn action_submission_has_one_typed_owner_without_dispatch_or_persistence_drift() {
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let composition_root = std::fs::read_to_string(source_root.join("lib.rs")).unwrap();
    let action_submission =
        std::fs::read_to_string(source_root.join("action_submission.rs")).unwrap();

    assert!(composition_root.contains("mod action_submission;"));
    assert!(composition_root.contains("action_submission::submit_action("));
    assert!(composition_root.contains("action_submission::ActionSubmissionContext::new("));
    assert!(composition_root.contains("action_submission::ActionSubmissionRequest {"));

    for owned_symbol in [
        "struct ActionSubmissionRequest",
        "struct ActionSubmissionContext",
        "struct ActionValidationContext",
        "struct ActionCapacityContext",
        "enum ActionSource",
        "pub(super) async fn submit_action(",
        "async fn validate_action_submission(",
        "async fn validate_action_slot_capacity(",
        "fn submission_template",
        "fn selected_grant_option",
        "fn target_role_filter_rejected(",
        "fn role_modifier_team_kill_rejected(",
        "fn active_actions_from_rows(",
    ] {
        assert!(
            action_submission.contains(owned_symbol),
            "missing action-submission owner: {owned_symbol}"
        );
        assert!(
            !composition_root.contains(owned_symbol),
            "command composition root still owns action-submission symbol: {owned_symbol}"
        );
    }

    for preserved_contract in [
        "require_game(tx, request.game).await?",
        "resolve_capabilities_in_tx(tx, principal, request.game).await?",
        "require_slot_occupant(",
        "require_open_phase(",
        "require_slot_alive(",
        "load_engine_phase_input_in_tx(",
        "\"ActionSubmitted\"",
        "domain::resolve_instant(",
        "EventInput::resolution_applied(",
        "EventInput::resolution_trace(",
        "persist(tx, request.game, &events).await",
    ] {
        assert!(
            action_submission.contains(preserved_contract),
            "missing preserved action-submission contract: {preserved_contract}"
        );
    }

    assert!(composition_root.contains("pub async fn handle_idempotent("));
    assert!(composition_root.contains("async fn persist("));
    assert!(!action_submission.contains("async fn persist("));
    assert!(composition_root.contains(
        "action_submission::active_actions_for_actor_phase(pool, game, phase_id, actor_slot)"
    ));
    assert!(action_submission.contains("projections::action_counters("));
    assert!(action_submission.contains("projections::action_grants("));
    assert!(action_submission.contains("projections::action_history("));
    assert!(action_submission.contains("projections::active_action_submissions("));

    assert!(
        !action_submission.contains("sqlx::query")
            && !action_submission.contains("append_and_project_in_tx")
            && !action_submission.contains("use super::*")
            && !action_submission.contains("#[expect")
            && !action_submission.contains("#[allow(clippy"),
        "the action-submission boundary must not own SQL/persistence or hide ownership/lint debt"
    );

    for removed_reason in [
        "command submission inputs remain explicit until action orchestration is extracted",
        "validation inputs remain explicit until action validation owns a typed submission context",
        "capacity inputs remain explicit until action validation owns a typed capacity context",
    ] {
        assert!(!composition_root.contains(removed_reason));
        assert!(!action_submission.contains(removed_reason));
    }
}
