use std::path::PathBuf;

fn resolver_source(path: &str) -> String {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/resolver");
    std::fs::read_to_string(root.join(path)).unwrap()
}

fn resolver_coordinator_source() -> String {
    std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/resolver.rs"))
        .unwrap()
}

#[test]
fn resolver_action_trigger_and_outcome_families_have_one_typed_owner_without_local_lint_debt() {
    let coordinator = resolver_coordinator_source();
    let action = resolver_source("action.rs");
    let outcome = resolver_source("outcome.rs");
    let trigger = resolver_source("trigger.rs");

    assert!(coordinator.contains("mod action;"));
    assert!(coordinator.contains("mod outcome;"));
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
    assert!(outcome.contains("struct DayVoteResolutionContext"));
    assert!(outcome.contains("struct OutcomeDecisionInput"));
    assert!(outcome.contains("fn resolve_day_vote"));
    assert!(outcome.contains("fn resolve_duel_actions"));
    assert!(outcome.contains("fn resolve_vote_duel_action"));
    assert!(outcome.contains("fn tally_votes"));
    assert!(outcome.contains("fn decide_outcome"));
    assert!(outcome.contains("InnerEvent::DayVoteOutcome"));

    assert!(!coordinator.contains("fn trigger_observation_matches"));
    assert!(!coordinator.contains("fn kill_observations"));
    assert!(!coordinator.contains("fn visit_observations"));
    assert!(!coordinator.contains("fn apply_trigger_fixpoint"));
    assert!(!coordinator.contains("fn resolve_one_kill"));
    assert!(!coordinator.contains("fn merge_stacked_kill_attribution"));
    assert!(!coordinator.contains("fn emit_action_interfered_by_target_state"));
    assert!(!coordinator.contains("fn counter_use_counted"));
    assert!(!coordinator.contains("fn apply_guard_witch_same_target_policy"));
    assert!(!coordinator.contains("fn resolve_day_vote"));
    assert!(!coordinator.contains("fn resolve_duel_actions"));
    assert!(!coordinator.contains("fn resolve_vote_duel_action"));
    assert!(!coordinator.contains("fn tally_votes"));
    assert!(!coordinator.contains("fn decide_outcome"));
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
        "vote outcome context extraction remains queued",
    ] {
        assert!(!coordinator.contains(obsolete_reason));
        assert!(!action.contains(obsolete_reason));
        assert!(!outcome.contains(obsolete_reason));
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
    assert!(
        !outcome.contains("#[expect") && !outcome.contains("#[allow(clippy"),
        "the outcome boundary must not hide architectural lint debt"
    );
}

#[test]
fn resolution_trace_construction_has_one_typed_owner_and_preserves_validation_order() {
    let coordinator = resolver_coordinator_source();
    let trace = resolver_source("trace.rs");

    assert!(coordinator.contains("mod trace;"));
    assert!(trace.contains("pub(super) struct ResolutionTraceInput<'a>"));
    assert!(trace.contains("pub(super) applied: &'a ResolutionApplied"));
    assert!(trace.contains("pub(super) trace_edges: Vec<TraceEdge>"));
    assert!(trace.contains("pub(super) trace_decisions: Vec<DecisionTrace>"));
    assert!(trace.contains("pub(super) trace_notes: Vec<String>"));
    assert!(trace.contains("pub(super) fn build_resolution_trace("));
    assert!(trace.contains("for indexed in &applied.events"));
    assert!(trace.contains("InnerEvent::DayVoteOutcome(_) => \"day_vote_outcome\""));
    assert!(trace.contains("stage: \"inner_event\".to_string()"));
    assert!(trace.contains("outcome: \"survival_win_awarded\".to_string()"));
    assert!(trace.contains("trace_version: crate::events::TRACE_VERSION"));

    assert_eq!(
        coordinator.matches("ResolutionTraceInput {").count(),
        1,
        "finalization must construct the trace input directly exactly once"
    );
    assert!(coordinator.contains("let trace = build_resolution_trace(ResolutionTraceInput {"));
    assert!(!coordinator.contains("fn build_trace("));
    assert!(!coordinator.contains("stage: \"inner_event\".to_string()"));
    assert!(!coordinator.contains("InnerEvent::DayVoteOutcome(_) => \"day_vote_outcome\""));

    let build = coordinator
        .find("let trace = build_resolution_trace(ResolutionTraceInput {")
        .unwrap();
    let validate_applied = coordinator
        .find("crate::events::validate_resolution_applied(&applied, RESULT_VERSION)")
        .unwrap();
    let validate_trace = coordinator
        .find("crate::events::validate_resolution_trace(&trace, crate::events::TRACE_VERSION)")
        .unwrap();
    let output = coordinator
        .find("ResolutionOutput {\n        applied,")
        .unwrap();
    assert!(build < validate_applied);
    assert!(validate_applied < validate_trace);
    assert!(validate_trace < output);

    assert!(!trace.contains("use super::*"));
    assert!(!trace.contains("#[expect"));
    assert!(!trace.contains("#[allow(clippy"));
}
