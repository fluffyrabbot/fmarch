use std::path::PathBuf;

fn resolver_source(path: &str) -> String {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/resolver");
    std::fs::read_to_string(root.join(path)).unwrap()
}

#[test]
fn trigger_fixpoint_has_one_typed_owner_without_local_lint_debt() {
    let coordinator =
        std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/resolver.rs"))
            .unwrap();
    let trigger = resolver_source("trigger.rs");

    assert!(coordinator.contains("mod trigger;"));
    assert!(coordinator.contains("struct ActionResolutionContext"));
    assert!(coordinator.contains("struct KillAction"));
    assert!(trigger.contains("struct TriggerResolutionContext"));
    assert!(trigger.contains("struct TriggerCascadeContext"));
    assert!(trigger.contains("enum ProducedKillCollection"));
    assert!(trigger.contains("fn collect_night_observations"));
    assert!(trigger.contains("fn apply_trigger_fixpoint"));

    assert!(!coordinator.contains("fn trigger_observation_matches"));
    assert!(!coordinator.contains("fn kill_observations"));
    assert!(!coordinator.contains("fn visit_observations"));
    assert!(!coordinator.contains("fn apply_trigger_fixpoint"));
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
    ] {
        assert!(!coordinator.contains(obsolete_reason));
        assert!(!trigger.contains(obsolete_reason));
    }
    assert!(
        !trigger.contains("#[expect") && !trigger.contains("#[allow(clippy"),
        "the trigger boundary must not hide architectural lint debt"
    );
}
