use std::path::PathBuf;

fn resolver_source(path: &str) -> String {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/resolver");
    std::fs::read_to_string(root.join(path)).unwrap()
}

#[test]
fn resolver_action_and_trigger_families_have_one_typed_owner_without_local_lint_debt() {
    let coordinator =
        std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/resolver.rs"))
            .unwrap();
    let action = resolver_source("action.rs");
    let trigger = resolver_source("trigger.rs");

    assert!(coordinator.contains("mod action;"));
    assert!(coordinator.contains("mod trigger;"));
    assert!(action.contains("struct ActionResolutionContext"));
    assert!(action.contains("struct KillAction"));
    assert!(action.contains("struct ProtectionResolutionContext"));
    assert!(action.contains("struct CounterUseInput"));
    assert!(action.contains("fn resolve_one_kill"));
    assert!(action.contains("fn merge_stacked_kill_attribution"));
    assert!(action.contains("fn emit_action_interfered_by_target_state"));
    assert!(action.contains("fn counter_use_counted"));
    assert!(action.contains("fn apply_guard_witch_same_target_policy"));
    assert!(trigger.contains("struct TriggerResolutionContext"));
    assert!(trigger.contains("struct TriggerCascadeContext"));
    assert!(trigger.contains("enum ProducedKillCollection"));
    assert!(trigger.contains("fn collect_night_observations"));
    assert!(trigger.contains("fn apply_trigger_fixpoint"));

    assert!(!coordinator.contains("fn trigger_observation_matches"));
    assert!(!coordinator.contains("fn kill_observations"));
    assert!(!coordinator.contains("fn visit_observations"));
    assert!(!coordinator.contains("fn apply_trigger_fixpoint"));
    assert!(!coordinator.contains("fn resolve_one_kill"));
    assert!(!coordinator.contains("fn merge_stacked_kill_attribution"));
    assert!(!coordinator.contains("fn emit_action_interfered_by_target_state"));
    assert!(!coordinator.contains("fn counter_use_counted"));
    assert!(!coordinator.contains("fn apply_guard_witch_same_target_policy"));
    assert_eq!(
        trigger
            .matches("trigger loop_cap ({loop_cap}) reached; terminating trigger fixpoint")
            .count(),
        1,
        "the deterministic fixpoint loop must have one implementation"
    );

    for obsolete_reason in [
        "trigger resolution context extraction remains queued",
        "action-resolution context extraction remains queued",
        "counter event construction remains explicit",
    ] {
        assert!(!coordinator.contains(obsolete_reason));
        assert!(!action.contains(obsolete_reason));
        assert!(!trigger.contains(obsolete_reason));
    }
    assert!(
        !action.contains("#[expect") && !action.contains("#[allow(clippy"),
        "the action boundary must not hide architectural lint debt"
    );
    assert!(
        !trigger.contains("#[expect") && !trigger.contains("#[allow(clippy"),
        "the trigger boundary must not hide architectural lint debt"
    );
}
