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

#[test]
fn night_action_preparation_has_one_typed_owner_and_direct_consumers() {
    let coordinator = resolver_coordinator_source();
    let intake = resolver_source("intake.rs");
    let action = resolver_source("action.rs");
    let trigger = resolver_source("trigger.rs");

    assert!(coordinator.contains("mod intake;"));
    assert!(intake.contains("pub(super) struct Action<'a>"));
    assert!(intake.contains("pub(super) struct NightActionPreparationInput<'a>"));
    assert!(intake.contains("pub(super) resolution: &'a ResolutionInput"));
    assert!(intake.contains("pub(super) struct NightActionPreparationOutput<'a>"));
    assert!(intake.contains("pub(super) actions: Vec<Action<'a>>"));
    assert!(intake.contains("pub(super) prefix_events: Vec<InnerEvent>"));
    assert!(intake.contains("pub(super) trace_decisions: Vec<DecisionTrace>"));
    assert!(intake.contains("pub(super) history: NightActionHistory"));
    assert!(intake.contains("pub(super) struct NightActionHistory;"));
    assert!(intake.contains("pub(super) fn events("));
    assert!(intake.contains("pub(super) fn prepare_night_actions("));
    assert!(intake.contains("fn emit_missing_compulsive_actions("));
    assert!(intake.contains("fn apply_faction_action_coordination("));
    assert!(intake.contains("fn apply_action_constraints("));
    assert!(intake.contains("fn history_sensitive_action_events("));
    assert!(intake.contains("pub(super) fn ability_order("));

    assert_eq!(
        coordinator
            .matches("NightActionPreparationInput { resolution: input }")
            .count(),
        1,
        "resolve_night must construct the immutable intake directly once"
    );
    assert!(coordinator.contains("let NightActionPreparationOutput {"));
    assert!(coordinator.contains("events.extend(history.events(input, &actions));"));
    assert!(action.contains("use super::intake::Action;"));
    assert!(trigger.contains("use super::intake::Action;"));

    for moved_owner in [
        "struct Action<'a>",
        "fn emit_missing_compulsive_actions(",
        "fn apply_faction_action_coordination(",
        "fn apply_action_constraints(",
        "fn record_history_sensitive_actions(",
        "fn ability_order(",
    ] {
        assert!(
            !coordinator.contains(moved_owner),
            "the coordinator must not retain `{moved_owner}`"
        );
    }
    assert!(!coordinator.contains("pub(super) use intake::Action"));
    assert!(!action.contains("struct Action<'a>"));
    assert!(!trigger.contains("struct Action<'a>"));

    let prepare = coordinator
        .find("let NightActionPreparationOutput {")
        .unwrap();
    let stage_order = coordinator
        .find("let stage_order = night_ability_order(pack)")
        .unwrap();
    let history = coordinator
        .find("events.extend(history.events(input, &actions));")
        .unwrap();
    let beloved = coordinator
        .find("resolve_beloved_princess_prompts(input, &mut events, &mut trace_decisions);")
        .unwrap();
    assert!(prepare < stage_order);
    assert!(stage_order < history);
    assert!(history < beloved);

    assert!(!intake.contains("use super::*"));
    assert!(!intake.contains("#[expect"));
    assert!(!intake.contains("#[allow(clippy"));
}

#[test]
fn redirect_resolution_has_one_typed_owner_and_single_coordinator_call() {
    let coordinator = resolver_coordinator_source();
    let redirect = resolver_source("redirect.rs");

    assert!(coordinator.contains("mod redirect;"));
    assert!(redirect.contains("use super::intake::{ability_order, Action};"));
    assert!(redirect.contains("pub(super) struct RedirectResolutionContext<'context, 'action>"));
    assert!(redirect.contains("pub(super) actions: &'context mut [Action<'action>]"));
    assert!(redirect.contains("pub(super) pack: &'context Pack"));
    assert!(redirect.contains("pub(super) empowered_slots: &'context BTreeSet<SlotId>"));
    assert!(redirect.contains("pub(super) trace_edges: &'context mut Vec<TraceEdge>"));
    assert!(redirect.contains("pub(super) trace_decisions: &'context mut Vec<DecisionTrace>"));
    assert!(redirect.contains("pub(super) trace_notes: &'context mut Vec<String>"));
    assert!(redirect.contains("pub(super) fn resolve_redirects("));
    assert!(redirect.contains("struct RedirectRule"));
    assert!(redirect.contains("struct RedirectRules"));
    assert!(redirect.contains("struct RedirectApplication"));
    assert!(redirect.contains("struct RedirectStep"));
    assert!(redirect.contains("fn redirect_target_space("));
    assert!(redirect.contains("fn build_redirect_rules("));
    assert!(redirect.contains("fn apply_redirect_rules("));
    assert!(redirect.contains("fn redirect_trace_edge("));
    assert!(redirect.contains("fn redirect_eligible("));

    assert_eq!(
        coordinator.matches("RedirectResolutionContext {").count(),
        1,
        "the redirect stage must construct the mutable context directly once"
    );
    assert_eq!(
        coordinator.matches("resolve_redirects(").count(),
        1,
        "the coordinator must invoke redirect resolution exactly once"
    );
    assert!(coordinator.contains("resolve_redirects(RedirectResolutionContext {"));
    assert!(coordinator.contains("empowered_slots: &empowered_slots,"));

    for moved_owner in [
        "struct RedirectRule",
        "struct RedirectRules",
        "struct RedirectApplication",
        "struct RedirectStep",
        "fn redirect_target_space(",
        "fn build_redirect_rules(",
        "fn apply_redirect_rules(",
        "fn redirect_trace_edge(",
        "outcome: \"action_redirect_bypassed\".to_string()",
        "truncating redirect graph rules",
    ] {
        assert!(
            !coordinator.contains(moved_owner),
            "the coordinator must not retain `{moved_owner}`"
        );
    }
    assert!(!coordinator.contains("pub(super) use redirect::"));
    assert!(!redirect.contains("use super::*"));
    assert!(!redirect.contains("#[expect"));
    assert!(!redirect.contains("#[allow(clippy"));
}

#[test]
fn block_suppression_and_empower_discovery_have_one_typed_owner_and_feed_redirect() {
    let coordinator = resolver_coordinator_source();
    let suppression = resolver_source("suppression.rs");
    let redirect = resolver_source("redirect.rs");

    assert!(coordinator.contains("mod suppression;"));
    assert!(suppression.contains("use super::intake::{ability_order, Action};"));
    assert!(
        suppression.contains("pub(super) struct SuppressionResolutionContext<'context, 'action>")
    );
    assert!(suppression.contains("pub(super) actions: &'context mut [Action<'action>]"));
    assert!(suppression.contains("pub(super) events: &'context mut Vec<InnerEvent>"));
    assert!(suppression.contains("pub(super) trace_decisions: &'context mut Vec<DecisionTrace>"));
    assert!(suppression.contains("pub(super) struct EmpowerDiscoveryInput<'context, 'action>"));
    assert!(suppression.contains("pub(super) actions: &'context [Action<'action>]"));
    assert!(suppression.contains("pub(super) blocked_action_idxs: &'context BTreeSet<usize>"));
    assert!(suppression.contains("pub(super) fn resolve_suppression("));
    assert!(suppression.contains(") -> BTreeSet<SlotId> {"));
    assert!(suppression.contains("pub(super) fn discover_empowered_slots("));
    assert!(suppression.contains("struct BlockSource"));
    assert!(suppression.contains("fn trace_detail("));
    assert!(suppression.contains("fn index_block_sources("));
    assert!(suppression.contains("fn select_block_candidates("));
    assert!(suppression.contains("fn night_resolution_block_participates("));
    assert!(suppression.contains("fn night_resolution_block_suppression_scope("));
    assert!(suppression.contains("InnerEvent::ActionInterfered"));
    assert!(suppression.contains("outcome: \"action_suppressed\".to_string()"));
    assert!(suppression.contains("outcome: \"action_suppression_bypassed\".to_string()"));

    // The block stage is one call that returns the empowered set, rather than a
    // stage body that assigns a coordinator-scoped variable as a side effect.
    assert_eq!(
        coordinator
            .matches("SuppressionResolutionContext {")
            .count(),
        1,
        "the block stage must construct the mutable context directly once"
    );
    assert_eq!(
        coordinator.matches("resolve_suppression(").count(),
        1,
        "the coordinator must invoke suppression resolution exactly once"
    );
    assert!(coordinator
        .contains("empowered_slots = resolve_suppression(SuppressionResolutionContext {"));

    // Both stages discover empowered slots through the same owner; the redirect
    // fallback differs only in the blocked-index input it supplies.
    assert_eq!(
        coordinator
            .matches("discover_empowered_slots(EmpowerDiscoveryInput {")
            .count(),
        1,
        "only the redirect fallback may call discovery directly"
    );
    assert!(coordinator.contains("blocked_action_idxs: &blocked_idxs,"));
    let fallback = coordinator
        .find("empowered_slots = discover_empowered_slots(EmpowerDiscoveryInput {")
        .unwrap();
    let redirect_context = coordinator
        .find("resolve_redirects(RedirectResolutionContext {")
        .unwrap();
    assert!(
        fallback < redirect_context,
        "the fallback must run before the redirect context is constructed"
    );

    // Suppression produces the empowered set and redirect consumes it. Neither
    // module may reach for the other.
    assert!(!suppression.contains("use super::redirect"));
    assert!(!suppression.contains("resolve_redirects"));
    assert!(!redirect.contains("use super::suppression"));
    assert!(!redirect.contains("discover_empowered_slots"));

    for moved_owner in [
        "struct BlockSource",
        "fn collect_empowered_slots(",
        "fn night_resolution_block_participates(",
        "fn night_resolution_block_suppression_scope(",
        "outcome: \"action_suppressed\".to_string()",
        "outcome: \"action_suppression_bypassed\".to_string()",
        "reason: \"roleblocked\".to_string()",
    ] {
        assert!(
            !coordinator.contains(moved_owner),
            "the coordinator must not retain `{moved_owner}`"
        );
    }
    assert!(!coordinator.contains("pub(super) use suppression::"));
    assert!(!suppression.contains("use super::*"));
    assert!(!suppression.contains("#[expect"));
    assert!(!suppression.contains("#[allow(clippy"));
}
