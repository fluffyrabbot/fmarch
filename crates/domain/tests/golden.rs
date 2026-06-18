//! Golden scenario harness. Loads the mafiascum pack + each golden, runs
//! `resolve`, and asserts the produced inner events equal `expected_events`
//! semantically: the event *sequence* is order-sensitive, but field order
//! within each payload is irrelevant (compared as `serde_json::Value`).
//!
//! Hermetic: repo files are located relative to `CARGO_MANIFEST_DIR`.

use std::path::PathBuf;

use domain::pack::{
    ActionTemplate, ActorRef, Pack, PrecedenceRule, PrecedenceWhen, SuppressionPolicy,
    SuppressionScope, TargetRef, TriggerEvent, TriggerLoopCapPolicy, TriggerOn,
};
use domain::resolver::{resolve, DayPhaseInputs, ResolutionInput};
use domain::state::{StateSnapshot, Submission};
use domain::{InvestigateMode, IrAbility};
use serde::Deserialize;
use serde_json::Value;

fn repo_root() -> PathBuf {
    // crates/domain -> repo root is two parents up.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn load_pack_named(name: &str) -> Pack {
    let p = repo_root().join("packs").join(name).join("pack.json");
    let raw = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {p:?}: {e}"));
    domain::load_pack_from_json(&raw).unwrap_or_else(|e| panic!("load {name}/pack.json: {e}"))
}

fn load_pack_for_golden(name: &str, golden: &Value) -> Pack {
    let p = repo_root().join("packs").join(name).join("pack.json");
    let raw = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {p:?}: {e}"));
    let pack_json: Value =
        serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse {name}/pack.json: {e}"));
    let pack_json = domain::golden_pack_json_with_overrides(&pack_json, golden)
        .unwrap_or_else(|e| panic!("apply {name} golden overrides: {e}"));
    let raw = serde_json::to_string(&pack_json).expect("encode overridden pack");
    domain::load_pack_from_json(&raw).unwrap_or_else(|e| panic!("load {name}/pack.json: {e}"))
}

fn load_pack() -> Pack {
    load_pack_named("mafiascum")
}

fn role_action<'a>(pack: &'a Pack, role_id: &str, action_id: &str) -> &'a ActionTemplate {
    pack.roles
        .get(role_id)
        .unwrap_or_else(|| panic!("missing role `{role_id}`"))
        .actions
        .iter()
        .find(|action| action.id == action_id)
        .unwrap_or_else(|| panic!("missing action `{action_id}` on role `{role_id}`"))
}

fn remove_standard_nar_generated_kill_trigger(pack: &mut Pack, trigger_id: &str) {
    pack.triggers.retain(|trigger| trigger.id != trigger_id);
    pack.standard_nar
        .generated_kill_cause_policy
        .remove(trigger_id);
    pack.standard_nar.trigger_fixpoint_policy.remove(trigger_id);
    pack.standard_nar
        .kill_cause_ids
        .retain(|cause| cause != trigger_id);
    for policy in pack.standard_nar.protection_cause_policy.values_mut() {
        policy.blocks.retain(|cause| cause != trigger_id);
        policy.bypasses.retain(|cause| cause != trigger_id);
    }
    for policy in pack.standard_nar.target_state_save_policy.values_mut() {
        policy.blocks.retain(|cause| cause != trigger_id);
        policy.bypasses.retain(|cause| cause != trigger_id);
    }
}

fn load_golden_in(pack: &str, name: &str) -> Value {
    let p = repo_root()
        .join("packs")
        .join(pack)
        .join("golden")
        .join(name);
    let raw = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {p:?}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("deserialize {name}: {e}"))
}

fn load_golden(name: &str) -> Value {
    load_golden_in("mafiascum", name)
}

/// The `input` block of a golden, minus `pack` (a name string the harness
/// resolves itself) and `game_id`.
#[derive(Deserialize)]
struct GoldenInput {
    phase_id: String,
    state: StateSnapshot,
    submissions: Vec<Submission>,
    #[serde(default)]
    day_phase_inputs: DayPhaseInputs,
    seed: u64,
    #[serde(default)]
    game_id: String,
}

/// Run a golden's input against the pack and return the produced inner events as
/// indexed `{ index, kind, payload }` JSON values, matching the goldens' shape.
fn run(input_json: &Value, pack: Pack) -> Vec<Value> {
    domain::golden_events_from_input_value(input_json, pack, "golden-run")
        .expect("run golden input")
}

fn run_instant(input_json: &Value, pack: Pack) -> Vec<Value> {
    let gi: GoldenInput =
        serde_json::from_value(input_json.clone()).expect("deserialize instant golden input");
    let output = domain::resolve_instant(ResolutionInput {
        game_id: gi.game_id,
        phase_id: gi.phase_id,
        run_id: "instant-golden-run".to_string(),
        state: gi.state,
        submissions: gi.submissions,
        day_phase_inputs: gi.day_phase_inputs,
        pack,
        seed: gi.seed,
        logical_time: 0,
    });
    output
        .applied
        .events
        .into_iter()
        .map(|indexed| serde_json::to_value(indexed).expect("indexed event serializes"))
        .collect()
}

fn run_output(input_json: &Value, pack: Pack, run_id: &str) -> domain::resolver::ResolutionOutput {
    let gi: GoldenInput =
        serde_json::from_value(input_json.clone()).expect("deserialize golden input");
    resolve(ResolutionInput {
        game_id: gi.game_id,
        phase_id: gi.phase_id,
        run_id: run_id.to_string(),
        state: gi.state,
        submissions: gi.submissions,
        day_phase_inputs: gi.day_phase_inputs,
        pack,
        seed: gi.seed,
        logical_time: 0,
    })
}

fn caught_panic_message(panic: Box<dyn std::any::Any + Send>) -> String {
    panic
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| {
            panic
                .downcast_ref::<&str>()
                .map(|message| message.to_string())
        })
        .unwrap_or_else(|| "<non-string panic>".to_string())
}

fn remove_block_precedence_before(pack: &mut Pack, ability: IrAbility) {
    for rule in &mut pack.precedence {
        if rule.when.effect == IrAbility::Block {
            rule.beats.retain(|beaten| *beaten != ability);
        }
        if rule.when.effect == ability {
            rule.blocked_by
                .retain(|blocker| *blocker != IrAbility::Block);
        }
    }
}

fn remove_all_precedence_before(pack: &mut Pack, ability: IrAbility) {
    for rule in &mut pack.precedence {
        rule.beats.retain(|beaten| *beaten != ability);
        if rule.when.effect == ability {
            rule.blocked_by.clear();
        }
    }
}

/// Strip non-canonical, non-asserted fields before comparison:
/// - `DayVoteOutcome.reason` — optional, localizable human prose (doc 10).
/// - `WinReached.reason` — R3: a resolver-derived string, but NOT part of the
///   asserted golden contract (the contract is `{winner}`); strip it exactly as
///   we strip `DayVoteOutcome.reason`.
fn strip_noncanonical(v: &Value) -> Value {
    domain::normalize_golden_event(v)
}

/// Assert two event sequences are equal: order-sensitive across events,
/// field-order-insensitive within each (serde_json::Value equality already
/// ignores object key order). `DayVoteOutcome.reason` is ignored (non-canonical).
fn assert_events_eq(got: &[Value], expected: &[Value], scenario: &str) {
    assert_eq!(
        got.len(),
        expected.len(),
        "{scenario}: event count mismatch\n got: {got:#?}\n exp: {expected:#?}"
    );
    for (i, (g, e)) in got.iter().zip(expected.iter()).enumerate() {
        let g = strip_noncanonical(g);
        let e = strip_noncanonical(e);
        assert_eq!(
            g, e,
            "{scenario}: event[{i}] mismatch\n got: {g:#?}\n exp: {e:#?}"
        );
    }
}

fn expected_events(golden: &Value) -> Vec<Value> {
    golden["expected_events"]
        .as_array()
        .expect("expected_events array")
        .clone()
}

fn event_kind(event: &Value) -> &str {
    event["kind"].as_str().expect("golden event kind")
}

fn first_event_index(events: &[Value], kind: &str) -> usize {
    events
        .iter()
        .position(|event| event_kind(event) == kind)
        .unwrap_or_else(|| panic!("missing event kind {kind}; events: {events:#?}"))
}

fn first_event_index_where(
    events: &[Value],
    kind: &str,
    predicate: impl Fn(&Value) -> bool,
) -> usize {
    events
        .iter()
        .position(|event| event_kind(event) == kind && predicate(event))
        .unwrap_or_else(|| panic!("missing matching event kind {kind}; events: {events:#?}"))
}

fn assert_event_order(scenario: &str, events: &[Value], labels: &[(&str, usize)]) {
    for pair in labels.windows(2) {
        let (left_label, left_index) = pair[0];
        let (right_label, right_index) = pair[1];
        assert!(
            left_index < right_index,
            "{scenario}: expected {left_label} at {left_index} before {right_label} at {right_index}; events: {events:#?}"
        );
    }
}

#[test]
fn pack_deserializes() {
    let pack = load_pack();
    assert_eq!(pack.name, "mafiascum");
    assert_eq!(pack.ir_version, 65);
    let bomb = pack.roles.get("bomb").expect("Mafiascum Bomb role");
    assert_eq!(bomb.alignment.as_deref(), Some("town"));
    assert!(bomb.actions.is_empty());
    assert_eq!(bomb.effects, vec!["bomb".to_string()]);
    let hero = pack.roles.get("hero").expect("Mafiascum Hero role");
    assert_eq!(hero.alignment.as_deref(), Some("town"));
    assert!(hero.actions.is_empty());
    assert_eq!(hero.effects, vec!["hero".to_string()]);
    let hero_trigger = pack
        .triggers
        .iter()
        .find(|trigger| trigger.id == "hero_instigator_kill")
        .expect("Hero VoteDuel trigger");
    assert_eq!(hero_trigger.on, TriggerOn::Ability(IrAbility::VoteDuel));
    assert_eq!(hero_trigger.produces.actor, ActorRef::Target);
    assert_eq!(hero_trigger.produces.target, TargetRef::Actor);
    assert!(hero_trigger
        .produces
        .modifiers
        .contains(&domain::Modifier::Strongman));
    assert!(pack.roles.contains_key("cop"));
    assert!(pack.roles.contains_key("vanilla_cop"));
    assert!(pack.roles.contains_key("neapolitan"));
    assert!(pack.roles.contains_key("gunsmith"));
    assert!(pack.roles.contains_key("psychologist"));
    assert!(pack.roles.contains_key("specialist"));
    assert!(pack.roles.contains_key("pt_cop"));
    assert!(pack.roles.contains_key("role_cop"));
    assert!(pack.roles.contains_key("comparison_cop"));
    assert!(pack.roles.contains_key("miller"));
    assert!(pack.roles.contains_key("framer"));
    assert!(pack.roles.contains_key("lawyer"));
    assert!(pack.roles.contains_key("mailman"));
    assert!(pack.roles.contains_key("observer"));
    assert!(pack.roles.contains_key("reporter"));
    assert!(pack.roles.contains_key("bodyguard"));
    assert!(pack.roles.contains_key("huntsman"));
    assert!(role_action(&pack, "huntsman", "huntsman_guard")
        .source_ids
        .iter()
        .any(|source_id| source_id == "guard_retaliate"));
    assert!(pack.roles.contains_key("faith_healer"));
    assert!(pack.roles.contains_key("martyr"));
    assert!(pack.roles.contains_key("cpr_doctor"));
    assert!(pack.roles.contains_key("babysitter"));
    assert!(pack.roles.contains_key("jailkeeper"));
    assert!(pack.roles.contains_key("catastrophic_roleblocker"));
    assert!(pack.roles.contains_key("beloved_princess"));
    let virgin = pack.roles.get("virgin").expect("Mafiascum Virgin role");
    assert_eq!(virgin.alignment.as_deref(), Some("town"));
    assert!(virgin.actions.is_empty());
    assert!(virgin.effects.is_empty());
    assert!(pack.roles.contains_key("executioner"));
    assert!(pack.roles.contains_key("condemner"));
    assert!(pack.roles.contains_key("cupid"));
    assert!(pack.roles.contains_key("hunter"));
    assert!(pack.roles.contains_key("mafia_janitor"));
    assert!(pack.roles.contains_key("serial_killer"));
    assert!(pack.roles.contains_key("flipless_townie"));
    assert!(pack.roles.contains_key("alignment_only_townie"));
    assert_eq!(pack.host_prompt_resolution_effects.len(), 2);
    assert!(pack
        .host_prompt_resolution_effects
        .iter()
        .any(|policy| policy.id == "beloved_princess_skip_next_day"
            && policy.prompt_kind == "skip_next_day"
            && policy.prompt_reason == "beloved_princess_death"));
    assert!(pack.beloved_princess_policy.enabled);
    assert!(pack.beloved_princess_policy.all_death_causes);
    assert_eq!(
        pack.beloved_princess_policy.eligible_roles,
        vec!["beloved_princess".to_string(), "virgin".to_string()]
    );
    assert!(pack
        .host_prompt_resolution_effects
        .iter()
        .any(|policy| policy.id == "no_majority_revote"
            && policy.prompt_kind == "revote"
            && policy.prompt_reason == "no_majority"));
    assert!(pack.roles.contains_key("hider"));
    assert!(pack.roles.contains_key("watcher"));
    assert!(pack.roles.contains_key("motion_detector"));
    assert!(pack.roles.contains_key("visitor"));
    assert!(pack.roles.contains_key("hooker"));
    assert!(pack.roles.contains_key("jailer"));
    assert!(pack.roles.contains_key("mafia_roleblocker"));
    assert!(pack.roles.contains_key("visitor_kill_target_visitor"));
    assert!(pack.roles.contains_key("x_voter"));
    assert!(pack.roles.contains_key("traffic_analyst"));
    assert!(pack.roles.contains_key("lightning_rod"));
    assert!(pack.roles.contains_key("redirector"));
    assert!(pack.roles.contains_key("traffic_controller"));
    assert!(pack.roles.contains_key("bulletproof"));
    assert!(pack.roles.contains_key("commuter"));
    assert!(pack.roles.contains_key("rolestopper"));
    assert!(pack.roles.contains_key("shield"));
    assert!(pack.roles.contains_key("macho_townie"));
    assert!(pack.roles.contains_key("vigilante"));
    assert!(pack.roles.contains_key("jack_of_all_trades"));
    assert!(pack.roles.contains_key("odd_night_cop"));
    assert!(pack.roles.contains_key("even_night_cop"));
    assert!(pack.roles.contains_key("odd_cycle_cop"));
    assert!(pack.roles.contains_key("even_cycle_cop"));
    assert!(pack.roles.contains_key("weak_cop"));
    assert!(pack.roles.contains_key("lazy_cop"));
    assert!(pack.roles.contains_key("loud_cop"));
    assert!(pack.roles.contains_key("announcing_cop"));
    assert!(pack.roles.contains_key("non_consecutive_cop"));
    assert!(pack.roles.contains_key("indecisive_cop"));
    assert!(pack.roles.contains_key("uncooperative_cop"));
    assert!(pack.roles.contains_key("roaming_cop"));
    assert!(pack.roles.contains_key("disabled_endgame_cop"));
    assert!(pack.roles.contains_key("lost_mafia_goon"));
    assert!(pack.roles.contains_key("recluse_mafia_goon"));
    let follower = pack.roles.get("follower").expect("Mafiascum Follower role");
    assert_eq!(follower.alignment.as_deref(), Some("town"));
    let follow = follower
        .actions
        .iter()
        .find(|action| action.id == "follow")
        .expect("Follower follow action");
    assert_eq!(follow.ability, IrAbility::Investigate);
    assert_eq!(follow.mode, Some(InvestigateMode::ActionType));
    let encryptor = pack
        .roles
        .get("encryptor")
        .expect("Mafiascum Encryptor role");
    assert_eq!(encryptor.alignment.as_deref(), Some("mafia"));
    assert!(encryptor.actions.is_empty());
    assert!(encryptor.effects.is_empty());
    assert!(pack.roles.contains_key("compulsive_cop"));
    assert!(pack.roles.contains_key("simultaneous_vigilante"));
    assert!(pack.roles.contains_key("poisoner"));
    assert!(pack.roles.contains_key("poison_doctor"));
    assert!(pack.roles.contains_key("arsonist"));
    assert!(pack.roles.contains_key("cleanser"));
    assert!(pack.roles.contains_key("vanillaiser"));
    assert!(pack.roles.contains_key("vanillizer"));
    assert!(pack.roles.contains_key("doublevoter"));
    assert!(pack.roles.contains_key("triplevoter"));
    assert!(pack.roles.contains_key("voteless"));
    assert!(pack.roles.contains_key("loved"));
    assert!(pack.roles.contains_key("hated"));
    assert!(pack.roles.contains_key("selective_visit_killer"));
    assert!(pack.roles.contains_key("death_cursed_townie"));
    assert!(pack.roles.contains_key("death_marker"));
    assert!(pack.roles.contains_key("phase_end_doomed_townie"));
    assert!(pack.roles.contains_key("win_witness_townie"));
    let lover = pack.roles.get("lover").expect("Mafiascum Lover role");
    assert_eq!(lover.alignment.as_deref(), None);
    assert!(lover.actions.is_empty());
    assert!(lover.effects.is_empty());
    let saulus = pack.roles.get("saulus").expect("Mafiascum Saulus role");
    assert_eq!(saulus.alignment.as_deref(), Some("mafia"));
    assert!(saulus.actions.is_empty());
    assert!(saulus.effects.is_empty());
    assert!(pack.saulus_policy.enabled);
    assert_eq!(
        pack.saulus_policy.eligible_roles,
        vec!["saulus".to_string()]
    );
    assert_eq!(pack.saulus_policy.target_alignment, "town");
    let survivor = pack.roles.get("survivor").expect("Mafiascum Survivor role");
    assert_eq!(survivor.alignment.as_deref(), Some("independent"));
    assert!(survivor.actions.is_empty());
    assert!(survivor.effects.is_empty());
    let survivor_award = pack
        .win
        .survival_awards
        .iter()
        .find(|award| award.id == "survivor")
        .expect("Mafiascum Survivor win award");
    assert_eq!(survivor_award.winner, "survivor");
    assert_eq!(survivor_award.eligible_roles, vec!["survivor".to_string()]);
    assert_eq!(survivor_award.source_event.as_deref(), Some("win.survivor"));
    let traitor = pack.roles.get("traitor").expect("Mafiascum Traitor role");
    assert_eq!(traitor.alignment.as_deref(), Some("mafia"));
    assert!(traitor.actions.is_empty());
    assert!(traitor.effects.is_empty());
    assert!(role_action(&pack, "vigilante", "night_kill")
        .source_ids
        .iter()
        .any(|source_id| source_id == "kill"));
    assert!(role_action(&pack, "mafia_goon", "factional_kill")
        .source_ids
        .iter()
        .any(|source_id| source_id == "kill"));
    assert!(role_action(&pack, "ninja", "factional_kill")
        .source_ids
        .iter()
        .any(|source_id| source_id == "kill"));
    assert!(role_action(&pack, "serial_killer", "night_kill")
        .source_ids
        .iter()
        .any(|source_id| source_id == "kill"));
    assert!(pack.lover_policy.enabled);
    assert_eq!(pack.lover_policy.link_effect, "lovers_link");
    assert!(pack
        .standard_nar
        .protection_cause_policy
        .contains_key("doctor_protect"));
    assert!(pack
        .standard_nar
        .kill_action_ids
        .iter()
        .any(|action_id| action_id == "night_kill"));
    assert!(pack
        .standard_nar
        .kill_action_ids
        .iter()
        .any(|action_id| action_id == "factional_kill"));
    let kill_cause_ids = pack
        .standard_nar
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    assert_eq!(
        kill_cause_ids,
        vec![
            "bomb_retaliates",
            "death_curse_retaliates",
            "death_mark_detonates",
            "factional_kill",
            "hero_instigator_kill",
            "hunter_retaliate",
            "huntsman_retaliation",
            "ignite",
            "janitor_kill",
            "night_kill",
            "phase_end_doom_claims",
            "pgo_shoots_visitor",
            "strongman_kill",
            "super_saint_retaliates",
            "unstoppable_vengeful_retaliates",
            "vengeful_retaliates",
            "visitor_kill_marked_visitor",
        ]
    );
    let target_state_save_tags = pack
        .standard_nar
        .target_state_save_tags
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    assert_eq!(
        target_state_save_tags,
        vec!["bulletproof", "bulletproof_vest"]
    );
    let target_state_gate_tags = pack
        .standard_nar
        .target_state_gate_tags
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    assert_eq!(
        target_state_gate_tags,
        vec!["ascetic", "commuted", "untargetable"]
    );
    assert!(pack.private_channels.groups.iter().any(|group| {
        group.id == "mafia_day_chat"
            && group.kind == domain::pack::PrivateChannelKind::FactionDayChat
            && group.roles.is_empty()
            && group.member_alignments == vec!["mafia".to_string()]
            && group.enabled_by_roles == vec!["encryptor".to_string()]
            && group.excluded_roles == vec!["traitor".to_string()]
            && group.active_while_source_alive
            && group.reveals_alignment == domain::pack::PrivateChannelAlignmentReveal::None
    }));
    assert_eq!(
        pack.standard_nar
            .generated_kill_cause_policy
            .get("bomb_retaliates")
            .map(|policy| policy.strongman_bypasses_protect),
        Some(false)
    );
    let bomb_generated_policy = pack
        .standard_nar
        .generated_kill_cause_policy
        .get("bomb_retaliates")
        .expect("bomb generated kill policy");
    assert_eq!(
        bomb_generated_policy.on,
        Some(TriggerOn::Ability(IrAbility::Kill))
    );
    assert_eq!(bomb_generated_policy.actor, Some(ActorRef::Target));
    assert_eq!(bomb_generated_policy.target, Some(TargetRef::Killer));
    let bomb_trigger = pack
        .triggers
        .iter()
        .find(|trigger| trigger.id == "bomb_retaliates")
        .expect("bomb trigger");
    assert_eq!(bomb_trigger.on, TriggerOn::Ability(IrAbility::Kill));
    assert_eq!(bomb_trigger.if_target_has, vec!["bomb".to_string()]);
    assert_eq!(bomb_trigger.produces.ability, IrAbility::Kill);
    assert_eq!(bomb_trigger.produces.actor, ActorRef::Target);
    assert_eq!(bomb_trigger.produces.target, TargetRef::Killer);
    assert!(pack.effects.contains_key("bomb"));
    assert_eq!(
        pack.standard_nar
            .generated_kill_cause_policy
            .get("pgo_shoots_visitor")
            .map(|policy| policy.strongman_bypasses_protect),
        Some(false)
    );
    let pgo_generated_policy = pack
        .standard_nar
        .generated_kill_cause_policy
        .get("pgo_shoots_visitor")
        .expect("pgo generated kill policy");
    assert_eq!(
        pgo_generated_policy.on,
        Some(TriggerOn::Ability(IrAbility::Visit))
    );
    assert_eq!(pgo_generated_policy.actor, Some(ActorRef::Target));
    assert_eq!(pgo_generated_policy.target, Some(TargetRef::Actor));
    assert_eq!(
        pack.standard_nar
            .generated_kill_cause_policy
            .get("unstoppable_vengeful_retaliates")
            .map(|policy| policy.strongman_bypasses_protect),
        Some(true)
    );
    let unstoppable_vengeful_policy = pack
        .standard_nar
        .generated_kill_cause_policy
        .get("unstoppable_vengeful_retaliates")
        .expect("unstoppable vengeful generated kill policy");
    assert_eq!(
        unstoppable_vengeful_policy.on,
        Some(TriggerOn::Ability(IrAbility::Kill))
    );
    assert_eq!(unstoppable_vengeful_policy.actor, Some(ActorRef::Target));
    assert_eq!(unstoppable_vengeful_policy.target, Some(TargetRef::Actor));
    let death_curse_policy = pack
        .standard_nar
        .generated_kill_cause_policy
        .get("death_curse_retaliates")
        .expect("death-cursed generated kill policy");
    assert_eq!(
        death_curse_policy.on,
        Some(TriggerOn::Event(TriggerEvent::Death))
    );
    assert_eq!(death_curse_policy.actor, Some(ActorRef::Target));
    assert_eq!(death_curse_policy.target, Some(TargetRef::Actor));
    assert!(!death_curse_policy.strongman_bypasses_protect);
    let death_mark_policy = pack
        .standard_nar
        .generated_kill_cause_policy
        .get("death_mark_detonates")
        .expect("death-mark generated kill policy");
    assert_eq!(
        death_mark_policy.on,
        Some(TriggerOn::Event(TriggerEvent::EffectMarked))
    );
    assert_eq!(death_mark_policy.actor, Some(ActorRef::Actor));
    assert_eq!(death_mark_policy.target, Some(TargetRef::Target));
    assert!(!death_mark_policy.strongman_bypasses_protect);
    let phase_end_policy = pack
        .standard_nar
        .generated_kill_cause_policy
        .get("phase_end_doom_claims")
        .expect("phase-end generated kill policy");
    assert_eq!(
        phase_end_policy.on,
        Some(TriggerOn::Event(TriggerEvent::PhaseEnd))
    );
    assert_eq!(phase_end_policy.actor, Some(ActorRef::Target));
    assert_eq!(phase_end_policy.target, Some(TargetRef::Target));
    assert!(!phase_end_policy.strongman_bypasses_protect);
    let super_saint_policy = pack
        .standard_nar
        .generated_kill_cause_policy
        .get("super_saint_retaliates")
        .expect("super-saint generated kill policy");
    assert_eq!(
        super_saint_policy.on,
        Some(TriggerOn::Event(TriggerEvent::Lynch))
    );
    assert_eq!(super_saint_policy.actor, Some(ActorRef::Target));
    assert_eq!(super_saint_policy.target, Some(TargetRef::Actor));
    let bomb_fixpoint_policy = pack
        .standard_nar
        .trigger_fixpoint_policy
        .get("bomb_retaliates")
        .expect("bomb trigger fixpoint policy");
    assert_eq!(
        bomb_fixpoint_policy.on,
        Some(TriggerOn::Ability(IrAbility::Kill))
    );
    assert!(bomb_fixpoint_policy.produced_kill_reenters);
    assert_eq!(
        bomb_fixpoint_policy.loop_cap,
        Some(TriggerLoopCapPolicy::RedirectLoopCap)
    );
    assert!(bomb_fixpoint_policy.trace);
    let pgo_fixpoint_policy = pack
        .standard_nar
        .trigger_fixpoint_policy
        .get("pgo_shoots_visitor")
        .expect("pgo trigger fixpoint policy");
    assert_eq!(
        pgo_fixpoint_policy.on,
        Some(TriggerOn::Ability(IrAbility::Visit))
    );
    assert!(pgo_fixpoint_policy.produced_kill_reenters);
    assert_eq!(
        pgo_fixpoint_policy.loop_cap,
        Some(TriggerLoopCapPolicy::RedirectLoopCap)
    );
    assert!(pgo_fixpoint_policy.trace);
    let visitor_kill_generated_policy = pack
        .standard_nar
        .generated_kill_cause_policy
        .get("visitor_kill_marked_visitor")
        .expect("visitor-kill generated kill policy");
    assert_eq!(
        visitor_kill_generated_policy.on,
        Some(TriggerOn::Ability(IrAbility::Visit))
    );
    assert_eq!(visitor_kill_generated_policy.actor, Some(ActorRef::Target));
    assert_eq!(visitor_kill_generated_policy.target, Some(TargetRef::Actor));
    assert!(!visitor_kill_generated_policy.strongman_bypasses_protect);
    let visitor_kill_fixpoint_policy = pack
        .standard_nar
        .trigger_fixpoint_policy
        .get("visitor_kill_marked_visitor")
        .expect("visitor-kill trigger fixpoint policy");
    assert_eq!(
        visitor_kill_fixpoint_policy.on,
        Some(TriggerOn::Ability(IrAbility::Visit))
    );
    assert!(visitor_kill_fixpoint_policy.produced_kill_reenters);
    assert_eq!(
        visitor_kill_fixpoint_policy.loop_cap,
        Some(TriggerLoopCapPolicy::RedirectLoopCap)
    );
    assert!(visitor_kill_fixpoint_policy.trace);
    let death_curse_fixpoint_policy = pack
        .standard_nar
        .trigger_fixpoint_policy
        .get("death_curse_retaliates")
        .expect("death-cursed trigger fixpoint policy");
    assert_eq!(
        death_curse_fixpoint_policy.on,
        Some(TriggerOn::Event(TriggerEvent::Death))
    );
    assert!(death_curse_fixpoint_policy.produced_kill_reenters);
    assert_eq!(
        death_curse_fixpoint_policy.loop_cap,
        Some(TriggerLoopCapPolicy::RedirectLoopCap)
    );
    assert!(death_curse_fixpoint_policy.trace);
    let death_mark_fixpoint_policy = pack
        .standard_nar
        .trigger_fixpoint_policy
        .get("death_mark_detonates")
        .expect("death-mark trigger fixpoint policy");
    assert_eq!(
        death_mark_fixpoint_policy.on,
        Some(TriggerOn::Event(TriggerEvent::EffectMarked))
    );
    assert!(death_mark_fixpoint_policy.produced_kill_reenters);
    assert_eq!(
        death_mark_fixpoint_policy.loop_cap,
        Some(TriggerLoopCapPolicy::RedirectLoopCap)
    );
    assert!(death_mark_fixpoint_policy.trace);
    let phase_end_fixpoint_policy = pack
        .standard_nar
        .trigger_fixpoint_policy
        .get("phase_end_doom_claims")
        .expect("phase-end trigger fixpoint policy");
    assert_eq!(
        phase_end_fixpoint_policy.on,
        Some(TriggerOn::Event(TriggerEvent::PhaseEnd))
    );
    assert!(phase_end_fixpoint_policy.produced_kill_reenters);
    assert_eq!(
        phase_end_fixpoint_policy.loop_cap,
        Some(TriggerLoopCapPolicy::RedirectLoopCap)
    );
    assert!(phase_end_fixpoint_policy.trace);
    let win_witness_trigger = pack
        .triggers
        .iter()
        .find(|trigger| trigger.id == "win_witness_observes")
        .expect("win witness trigger");
    assert_eq!(win_witness_trigger.on, TriggerOn::Event(TriggerEvent::Win));
    assert_eq!(win_witness_trigger.produces.ability, IrAbility::Visit);
    assert_eq!(win_witness_trigger.produces.actor, ActorRef::Target);
    assert_eq!(win_witness_trigger.produces.target, TargetRef::Target);
    assert!(death_curse_fixpoint_policy.trace);
    let super_saint_fixpoint_policy = pack
        .standard_nar
        .trigger_fixpoint_policy
        .get("super_saint_retaliates")
        .expect("super-saint trigger fixpoint policy");
    assert_eq!(
        super_saint_fixpoint_policy.on,
        Some(TriggerOn::Event(TriggerEvent::Lynch))
    );
    assert!(super_saint_fixpoint_policy.produced_kill_reenters);
    assert_eq!(
        super_saint_fixpoint_policy.loop_cap,
        Some(TriggerLoopCapPolicy::RedirectLoopCap)
    );
    assert!(super_saint_fixpoint_policy.trace);
    assert_eq!(
        pack.standard_nar
            .chosen_retaliation_cause_policy
            .get("hunter_retaliate")
            .map(|policy| policy.strongman_bypasses_protect),
        Some(false)
    );
    assert_eq!(
        pack.standard_nar
            .intercept_cause_policy
            .get("bodyguard")
            .map(String::as_str),
        Some("bodyguard_intercept")
    );
    assert_eq!(
        pack.standard_nar
            .intercept_cause_policy
            .get("huntsman_guard")
            .map(String::as_str),
        Some("huntsman_intercept")
    );
    assert_eq!(
        pack.standard_nar
            .guard_retaliation_cause_policy
            .get("huntsman_guard")
            .map(String::as_str),
        Some("huntsman_retaliation")
    );
    assert_eq!(
        pack.standard_nar
            .intercept_cause_policy
            .get("martyr_protect")
            .map(String::as_str),
        Some("martyr_intercept")
    );
    assert_eq!(
        pack.standard_nar
            .cpr_harm_cause_policy
            .get("cpr_protect")
            .map(String::as_str),
        Some("cpr_protect")
    );
    assert_eq!(
        pack.standard_nar
            .guard_dependency_cause_policy
            .get("babysit")
            .map(String::as_str),
        Some("babysit")
    );
    assert_eq!(
        pack.standard_nar
            .hide_dependency_cause_policy
            .get("hide")
            .map(String::as_str),
        Some("hide")
    );
    assert!(pack
        .standard_nar
        .protection_cause_policy
        .contains_key("bodyguard"));
    assert!(pack
        .standard_nar
        .protection_cause_policy
        .contains_key("martyr_protect"));
    assert!(pack
        .standard_nar
        .protection_cause_policy
        .contains_key("cpr_protect"));
    assert!(pack
        .standard_nar
        .protection_cause_policy
        .contains_key("babysit"));
    assert!(pack
        .standard_nar
        .protection_cause_policy
        .contains_key("jail"));
    assert!(pack
        .standard_nar
        .target_state_save_policy
        .contains_key("bulletproof"));
    assert!(pack
        .standard_nar
        .target_state_save_policy
        .contains_key("bulletproof_vest"));
    assert!(pack
        .standard_nar
        .target_state_gate_policy
        .contains_key("ascetic"));
    assert!(pack
        .standard_nar
        .target_state_gate_policy
        .contains_key("commuted"));
    assert!(pack
        .standard_nar
        .target_state_gate_policy
        .contains_key("untargetable"));
    assert!(pack
        .standard_nar
        .suppression_policy
        .contains_key("roleblocker_block"));
    assert!(pack.standard_nar.suppression_policy.contains_key("jail"));
    assert!(pack
        .standard_nar
        .suppression_policy
        .contains_key("catastrophic_block"));
    // Round-trip: investigation_overrides with an enum map key must survive.
    let v = serde_json::to_value(&pack).expect("serialize pack");
    assert_eq!(
        v["investigation_overrides"]["godfather"]["Parity"],
        Value::from("town")
    );
    assert_eq!(
        v["investigation_overrides"]["lawyered"]["Parity"],
        Value::from("town")
    );
}

#[test]
fn golden_kill_vs_doctor_base() {
    let golden = load_golden("kill_vs_doctor.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "kill_vs_doctor base");
}

#[test]
fn golden_faith_healer_chance_protect_saves() {
    let golden = load_golden("faith_healer_chance_protect_saves.json");
    let got = run(&golden["input"], load_pack());
    let output = run_output(&golden["input"], load_pack(), "faith-healer-saves");
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "faith_healer_chance_protect_saves",
    );
    assert!(output.trace.decisions.iter().any(|decision| {
        decision.stage == "night:action_chance"
            && decision.outcome == "action_chance_succeeded"
            && decision.detail["template_id"] == "faith_healer_protect"
            && decision.detail["chance"] == 0.5
    }));
}

#[test]
fn golden_faith_healer_chance_protect_misses() {
    let golden = load_golden("faith_healer_chance_protect_misses.json");
    let got = run(&golden["input"], load_pack());
    let output = run_output(&golden["input"], load_pack(), "faith-healer-misses");
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "faith_healer_chance_protect_misses",
    );
    assert!(output.trace.decisions.iter().any(|decision| {
        decision.stage == "night:action_chance"
            && decision.outcome == "action_chance_failed"
            && decision.detail["template_id"] == "faith_healer_protect"
            && decision.detail["chance"] == 0.5
    }));
}

#[test]
fn golden_protected_multi_attacker_no_death() {
    let golden = load_golden("protected_multi_attacker_no_death.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "protected_multi_attacker_no_death",
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_conflict_family_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .conflict_families
        .retain(|family| format!("{family:?}") != "ProtectBlocksKills");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing standard-NAR conflict family must not silently resolve");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar conflict families"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("conflict_families must include `ProtectBlocksKills`"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_visibility_family_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    pack.visibility_families
        .retain(|family| format!("{family:?}") != "StealthNinjaVisits");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing visibility family must not silently resolve");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid visibility families"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("visibility_families must include `StealthNinjaVisits`"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_win_family_before_day_resolution() {
    let golden = load_golden("executioner_wins_on_target_lynch.json");
    let mut pack = load_pack();
    pack.win_families
        .retain(|family| format!("{family:?}") != "TargetLynchIndependent");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing win family must not silently resolve");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid win families"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("win_families must include `TargetLynchIndependent`"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_block_action_policy_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .block_action_ids
        .retain(|action_id| action_id != "roleblocker_block");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing standard-NAR Block action policy must not silently skip blocking");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar block action policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("Block action `roleblocker_block` must be declared"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_doctor_protect_action_policy_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .protect_action_ids
        .retain(|action_id| action_id != "doctor_protect");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing standard-NAR Doctor protect policy must not silently skip protection");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar protect action policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("Protect action `doctor_protect` must be declared"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_bodyguard_protect_action_policy_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .bodyguard_action_ids
        .retain(|action_id| action_id != "bodyguard");
    pack.standard_nar
        .protect_action_ids
        .push("bodyguard".to_string());

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack)).expect_err(
        "missing standard-NAR Bodyguard protect policy must not silently skip interception",
    );
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar bodyguard action policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("Bodyguard Protect action `bodyguard` must be declared"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_jailkeep_explicit_block_policy_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .block_action_ids
        .retain(|action_id| action_id != "jail");
    pack.standard_nar
        .protect_action_ids
        .retain(|action_id| action_id != "jail");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("Jailkeeper must remain explicitly declared as Block and Protect");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar jailkeep action policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("Jailkeeper action `jail` must also be declared in block_action_ids"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_wrong_standard_nar_action_bucket_entries_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let cases: Vec<(&str, fn(&mut Pack), &str, &str)> = vec![
        (
            "empty block_action_ids",
            |pack| pack.standard_nar.block_action_ids.clear(),
            "invalid standard_nar block action policy",
            "enabled standard_nar policy must declare block_action_ids",
        ),
        (
            "blank protect_action_ids",
            |pack| pack.standard_nar.protect_action_ids.push("".to_string()),
            "invalid standard_nar protect action policy",
            "protect_action_ids id must not be empty",
        ),
        (
            "block_action_ids",
            |pack| pack.standard_nar.block_action_ids.push("doctor_protect".to_string()),
            "invalid standard_nar block action policy",
            "block_action_ids entry `doctor_protect` must be a night/any Block action",
        ),
        (
            "protect_action_ids",
            |pack| pack.standard_nar.protect_action_ids.push("bodyguard".to_string()),
            "invalid standard_nar protect action policy",
            "protect_action_ids entry `bodyguard` must be a night/any Protect without Bodyguard/Martyr/Cpr action",
        ),
        (
            "kill_action_ids",
            |pack| pack.standard_nar.kill_action_ids.push("doctor_protect".to_string()),
            "invalid standard_nar kill action policy",
            "kill_action_ids entry `doctor_protect` must be a night/any Kill without Strongman/Cpr action",
        ),
        (
            "bodyguard_action_ids",
            |pack| {
                pack.standard_nar
                    .bodyguard_action_ids
                    .push("doctor_protect".to_string());
            },
            "invalid standard_nar bodyguard action policy",
            "bodyguard_action_ids entry `doctor_protect` must be a night/any Protect with Bodyguard action",
        ),
        (
            "martyr_action_ids",
            |pack| {
                pack.standard_nar
                    .martyr_action_ids
                    .push("doctor_protect".to_string());
            },
            "invalid standard_nar martyr action policy",
            "martyr_action_ids entry `doctor_protect` must be a night/any Protect with Martyr action",
        ),
        (
            "cpr_action_ids",
            |pack| pack.standard_nar.cpr_action_ids.push("doctor_protect".to_string()),
            "invalid standard_nar CPR action policy",
            "cpr_action_ids entry `doctor_protect` must be a night/any Protect plus Kill with Cpr action",
        ),
        (
            "jailkeep_action_ids",
            |pack| {
                pack.standard_nar
                    .jailkeep_action_ids
                    .push("doctor_protect".to_string());
            },
            "invalid standard_nar jailkeep action policy",
            "jailkeep_action_ids entry `doctor_protect` must be a night/any Block plus Protect action",
        ),
        (
            "strongman_action_ids",
            |pack| {
                pack.standard_nar
                    .strongman_action_ids
                    .push("doctor_protect".to_string());
            },
            "invalid standard_nar strongman action policy",
            "strongman_action_ids entry `doctor_protect` must be a night/any Kill with Strongman action",
        ),
        (
            "duplicate block_action_ids",
            |pack| {
                pack.standard_nar
                    .block_action_ids
                    .push("roleblocker_block".to_string());
            },
            "invalid standard_nar block action policy",
            "block_action_ids contains duplicate value `roleblocker_block`",
        ),
        (
            "unknown protect_action_ids",
            |pack| {
                pack.standard_nar
                    .protect_action_ids
                    .push("missing_protect".to_string());
            },
            "invalid standard_nar protect action policy",
            "protect_action_ids entry `missing_protect` references unknown action",
        ),
    ];

    for (case, mutate, policy, detail) in cases {
        let mut pack = load_pack();
        mutate(&mut pack);
        let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
            .expect_err("{case} wrong bucket entry unexpectedly resolved");
        let message = caught_panic_message(panic);
        assert!(
            message.contains(policy),
            "{case}: unexpected panic message: {message}"
        );
        assert!(
            message.contains(detail),
            "{case}: unexpected panic message: {message}"
        );
    }
}

#[test]
fn resolver_rejects_malformed_standard_nar_team_kill_policy_before_resolution() {
    let golden = load_golden("lost_mafia_goon_blocks_team_kill_with_teammate_alive.json");
    let cases: Vec<(&str, fn(&mut Pack), &str, &str)> = vec![
        (
            "blank team_kill_action_ids",
            |pack| pack.standard_nar.team_kill_action_ids.push("".to_string()),
            "invalid standard_nar team kill action policy",
            "team_kill_action_ids contains empty value",
        ),
        (
            "duplicate team_kill_action_ids",
            |pack| {
                pack.standard_nar
                    .team_kill_action_ids
                    .push("factional_kill".to_string());
            },
            "invalid standard_nar team kill action policy",
            "team_kill_action_ids contains duplicate value `factional_kill`",
        ),
        (
            "unknown team_kill_action_ids",
            |pack| {
                pack.standard_nar
                    .team_kill_action_ids
                    .push("missing_team_kill".to_string());
            },
            "invalid standard_nar team kill action policy",
            "team_kill_action_ids entry `missing_team_kill` references unknown action",
        ),
        (
            "wrong-shape team_kill_action_ids",
            |pack| {
                pack.standard_nar
                    .team_kill_action_ids
                    .push("doctor_protect".to_string());
            },
            "invalid standard_nar team kill action policy",
            "team_kill_action_ids entry `doctor_protect` must be a night/any Kill action",
        ),
        (
            "team kill removed from kill_action_ids",
            |pack| {
                pack.standard_nar
                    .kill_action_ids
                    .retain(|action_id| action_id != "factional_kill");
            },
            "invalid standard_nar team kill action policy",
            "team_kill_action_ids entry `factional_kill` must also be declared in kill_action_ids",
        ),
        (
            "empty team_kill_action_ids",
            |pack| pack.standard_nar.team_kill_action_ids.clear(),
            "invalid standard_nar team kill action policy",
            "team-kill restricted role `lost_mafia_goon` requires team_kill_action_ids",
        ),
        (
            "missing Lost role team-kill action",
            |pack| {
                pack.roles
                    .get_mut("lost_mafia_goon")
                    .expect("mafiascum pack should include lost_mafia_goon")
                    .actions
                    .clear();
            },
            "invalid standard_nar team kill action policy",
            "team-kill restricted role `lost_mafia_goon` must expose a team kill action",
        ),
    ];

    for (case, mutate, policy, detail) in cases {
        let mut pack = load_pack();
        mutate(&mut pack);
        let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
            .expect_err("{case} malformed team-kill policy unexpectedly resolved");
        let message = caught_panic_message(panic);
        assert!(
            message.contains(policy),
            "{case}: unexpected panic message: {message}"
        );
        assert!(
            message.contains(detail),
            "{case}: unexpected panic message: {message}"
        );
    }
}

#[test]
fn resolver_rejects_missing_standard_nar_kill_action_policy_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .kill_action_ids
        .retain(|action_id| action_id != "night_kill");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing standard-NAR Kill action policy must not silently use action ids");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid standard_nar kill action policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("Kill action `night_kill` must be declared"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_kill_cause_catalog_before_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    pack.standard_nar.kill_cause_ids.clear();

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing standard-NAR kill cause catalog must not silently resolve");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid standard_nar kill cause catalog"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("must declare kill_cause_ids"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_malformed_standard_nar_kill_cause_catalog_before_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let cases: Vec<(&str, fn(&mut Pack), &str)> = vec![
        (
            "empty kill cause id",
            |pack| pack.standard_nar.kill_cause_ids.push("".to_string()),
            "kill cause id must not be empty",
        ),
        (
            "duplicate kill cause id",
            |pack| {
                pack.standard_nar
                    .kill_cause_ids
                    .push("night_kill".to_string())
            },
            "duplicate kill cause `night_kill`",
        ),
        (
            "unknown kill cause id",
            |pack| {
                pack.standard_nar
                    .kill_cause_ids
                    .push("missing_cause".to_string());
            },
            "unknown kill cause `missing_cause`",
        ),
        (
            "omitted generated kill cause",
            |pack| {
                pack.standard_nar
                    .kill_cause_ids
                    .retain(|cause| cause != "pgo_shoots_visitor");
            },
            "kill_cause_ids must include `pgo_shoots_visitor`",
        ),
    ];

    for (case, mutate, detail) in cases {
        let mut pack = load_pack();
        mutate(&mut pack);
        let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
            .expect_err("{case} malformed kill cause catalog unexpectedly resolved");
        let message = caught_panic_message(panic);
        assert!(
            message.contains("invalid standard_nar kill cause catalog"),
            "{case}: unexpected panic message: {message}"
        );
        assert!(
            message.contains(detail),
            "{case}: unexpected panic message: {message}"
        );
    }
}

#[test]
fn resolver_rejects_missing_standard_nar_protection_classifier_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .protection_cause_policy
        .get_mut("doctor_protect")
        .expect("doctor protection cause policy")
        .blocks
        .retain(|cause| cause != "factional_kill");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing ordinary kill protection classifier must not silently resolve");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar protection cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains(
            "protection source `doctor_protect` does not classify kill cause `factional_kill`"
        ),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_protection_source_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .protection_cause_policy
        .remove("doctor_protect");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing protection source policy must not silently drop protection");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar protection cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("protection source `doctor_protect` must classify every kill cause"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_malformed_standard_nar_protection_cause_policy_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let cases: Vec<(&str, fn(&mut Pack), &str)> = vec![
        (
            "empty protection source key",
            |pack| {
                pack.standard_nar.protection_cause_policy.insert(
                    "".to_string(),
                    domain::pack::ProtectionCausePolicy {
                        blocks: vec!["night_kill".to_string()],
                        bypasses: Vec::new(),
                    },
                );
            },
            "protection source id must not be empty",
        ),
        (
            "unknown protection source key",
            |pack| {
                pack.standard_nar.protection_cause_policy.insert(
                    "phase_protect".to_string(),
                    domain::pack::ProtectionCausePolicy {
                        blocks: vec!["night_kill".to_string()],
                        bypasses: Vec::new(),
                    },
                );
            },
            "unknown protection source `phase_protect`",
        ),
        (
            "duplicate blocked kill cause",
            |pack| {
                let doctor = pack
                    .standard_nar
                    .protection_cause_policy
                    .get_mut("doctor_protect")
                    .expect("mafiascum declares doctor protection cause policy");
                doctor.blocks.push("night_kill".to_string());
            },
            "protection source `doctor_protect` blocks contains duplicate kill cause `night_kill`",
        ),
        (
            "unknown blocked kill cause",
            |pack| {
                pack.standard_nar
                    .protection_cause_policy
                    .get_mut("doctor_protect")
                    .expect("mafiascum declares doctor protection cause policy")
                    .blocks
                    .push("missing_kill_cause".to_string());
            },
            "protection source `doctor_protect` blocks references unknown kill cause `missing_kill_cause`",
        ),
        (
            "blocked and bypassed kill cause",
            |pack| {
                pack.standard_nar
                    .protection_cause_policy
                    .get_mut("doctor_protect")
                    .expect("mafiascum declares doctor protection cause policy")
                    .bypasses
                    .push("night_kill".to_string());
            },
            "protection source `doctor_protect` kill cause `night_kill` cannot be both blocked and bypassed",
        ),
    ];

    for (case, mutate, detail) in cases {
        let mut pack = load_pack();
        mutate(&mut pack);
        let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
            .expect_err("{case} malformed protection cause policy unexpectedly resolved");
        let message = caught_panic_message(panic);
        assert!(
            message.contains("invalid standard_nar protection cause policy"),
            "{case}: unexpected panic message: {message}"
        );
        assert!(
            message.contains(detail),
            "{case}: unexpected panic message: {message}"
        );
    }
}

#[test]
fn resolver_rejects_missing_standard_nar_target_state_classifier_for_chosen_retaliation_before_resolution(
) {
    let golden = load_golden("hunter_retaliates_on_death.json");
    let mut pack = load_pack();
    pack.standard_nar
        .target_state_save_policy
        .get_mut("bulletproof")
        .expect("bulletproof target-state save policy")
        .blocks
        .retain(|cause| cause != "hunter_retaliate");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing chosen-retaliation target-state classifier must not silently resolve");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar target-state save policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains(
            "target-state save `bulletproof` does not classify kill cause `hunter_retaliate`"
        ),
        "unexpected panic message: {message}"
    );
}

#[test]
fn golden_death_reveal_policy() {
    let golden = load_golden("death_reveal_policy.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "death_reveal_policy");
}

#[test]
fn golden_kill_vs_doctor_strongman_variant() {
    // Swap slot_1's role/action to `strongman` so the kill carries Strongman;
    // standard_nar.strongman_bypasses_protect lets the kill go through.
    let golden = load_golden("kill_vs_doctor.json");
    let mut input = golden["input"].clone();
    for slot in input["state"]["slots"].as_array_mut().unwrap() {
        if slot["slot_id"] == "slot_1" {
            slot["role_key"] = Value::from("strongman");
        }
    }
    for sub in input["submissions"].as_array_mut().unwrap() {
        if sub["actor"] == "slot_1" {
            sub["template_id"] = Value::from("strongman_kill");
        }
    }
    let got = run(&input, load_pack());
    let expected = golden["variant_note"]["expected_events"]
        .as_array()
        .expect("variant expected_events")
        .clone();
    assert_events_eq(&got, &expected, "kill_vs_doctor strongman variant");
}

#[test]
fn resolver_rejects_missing_standard_nar_strongman_action_policy_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut input = golden["input"].clone();
    for slot in input["state"]["slots"].as_array_mut().unwrap() {
        if slot["slot_id"] == "slot_1" {
            slot["role_key"] = Value::from("strongman");
        }
    }
    for sub in input["submissions"].as_array_mut().unwrap() {
        if sub["actor"] == "slot_1" {
            sub["template_id"] = Value::from("strongman_kill");
        }
    }
    let mut pack = load_pack();
    pack.standard_nar
        .strongman_action_ids
        .retain(|action_id| action_id != "strongman_kill");

    let panic = std::panic::catch_unwind(|| run(&input, pack)).expect_err(
        "missing standard-NAR Strongman action policy must not resolve as ordinary Kill",
    );
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar strongman action policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("enabled standard_nar policy must declare strongman_action_ids"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_strongman_bypass_policy_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut input = golden["input"].clone();
    for slot in input["state"]["slots"].as_array_mut().unwrap() {
        if slot["slot_id"] == "slot_1" {
            slot["role_key"] = Value::from("strongman");
        }
    }
    for sub in input["submissions"].as_array_mut().unwrap() {
        if sub["actor"] == "slot_1" {
            sub["template_id"] = Value::from("strongman_kill");
        }
    }
    let mut pack = load_pack();
    pack.standard_nar.strongman_bypasses_protect = false;

    let panic = std::panic::catch_unwind(|| run(&input, pack))
        .expect_err("missing standard-NAR Strongman bypass policy must not resolve as blocked");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar strongman bypass policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("requires strongman_bypasses_protect true"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_standard_nar_ordinary_kill_as_target_state_bypass_before_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    let bulletproof = pack
        .standard_nar
        .target_state_save_policy
        .get_mut("bulletproof")
        .expect("mafiascum declares bulletproof target-state save policy");
    bulletproof.blocks.retain(|cause| cause != "night_kill");
    bulletproof.bypasses.push("night_kill".to_string());

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("ordinary kill classified as target-state bypass must not resolve");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar target-state save policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("bypassed kill cause `night_kill` must be a Strongman bypass cause"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_standard_nar_generated_strongman_cause_as_protection_block_before_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    let doctor = pack
        .standard_nar
        .protection_cause_policy
        .get_mut("doctor_protect")
        .expect("mafiascum declares doctor protection cause policy");
    doctor
        .bypasses
        .retain(|cause| cause != "unstoppable_vengeful_retaliates");
    doctor
        .blocks
        .push("unstoppable_vengeful_retaliates".to_string());

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("generated Strongman cause classified as protection block must not resolve");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar protection cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains(
            "strongman bypass cause `unstoppable_vengeful_retaliates` must be classified in bypasses"
        ),
        "unexpected panic message: {message}"
    );
}

#[test]
fn standard_nar_strongman_bypass_does_not_require_precedence_unless_modifier() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut input = golden["input"].clone();
    for slot in input["state"]["slots"].as_array_mut().unwrap() {
        if slot["slot_id"] == "slot_1" {
            slot["role_key"] = Value::from("strongman");
        }
    }
    for sub in input["submissions"].as_array_mut().unwrap() {
        if sub["actor"] == "slot_1" {
            sub["template_id"] = Value::from("strongman_kill");
        }
    }
    let mut pack = load_pack();
    for rule in &mut pack.precedence {
        if rule.when.effect == IrAbility::Protect && rule.beats.contains(&IrAbility::Kill) {
            rule.unless_modifiers.clear();
        }
    }

    let got = run(&input, pack);
    let expected = golden["variant_note"]["expected_events"]
        .as_array()
        .expect("variant expected_events")
        .clone();
    assert_events_eq(
        &got,
        &expected,
        "standard_nar strongman bypass without precedence unless modifier",
    );
}

#[test]
fn trace_records_pack_derived_night_stage_order() {
    let golden = load_golden("kill_vs_doctor.json");
    let output = run_output(&golden["input"], load_pack(), "stage-order-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "pack_derived_stage_order")
        .expect("night resolution should trace the pack-derived stage order");
    assert_eq!(decision.stage, "night:stage_order");
    assert_eq!(decision.source, "pack.precedence");
    assert_eq!(
        decision.detail["order"],
        serde_json::json!([
            "Block",
            "Redirect",
            "Protect",
            "Mark",
            "Clear",
            "Link",
            "Grant",
            "Retaliate",
            "Kill",
            "Convert",
            "Investigate",
            "Visit",
            "Info"
        ])
    );
}

#[test]
fn trace_records_protect_vs_kill_decision() {
    let golden = load_golden("kill_vs_doctor.json");
    let output = run_output(&golden["input"], load_pack(), "protect-conflict-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "kill_prevented_by_protection")
        .expect("doctor save should emit a protect-vs-kill trace decision");
    assert_eq!(decision.stage, "kill_resolution");
    assert_eq!(decision.source, "cause:factional_kill");
    assert_eq!(decision.detail["target"], "slot_3");
    assert_eq!(decision.detail["attacker"], "slot_1");
    assert_eq!(decision.detail["protectors"][0]["protector"], "slot_2");
    assert_eq!(decision.detail["protectors"][0]["action_id"], "sub_002");
    assert_eq!(
        decision.detail["protectors"][0]["template_id"],
        "doctor_protect"
    );
}

#[test]
fn trace_records_protected_multi_attacker_no_death() {
    let golden = load_golden("protected_multi_attacker_no_death.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "protected-multi-attacker-trace-run",
    );

    assert!(
        !output.applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerKilled { slot_id, .. } if slot_id == "slot_3"
        )),
        "blocked multi-attacker attempts must not synthesize a PlayerKilled event"
    );
    let saved_events: Vec<_> = output
        .applied
        .events
        .iter()
        .filter(|indexed| {
            matches!(
                &indexed.event,
                domain::InnerEvent::PlayerSaved { slot_id, reasons, sources }
                    if slot_id == "slot_3"
                        && reasons == &vec!["protected".to_string()]
                        && sources == &vec!["slot_2".to_string()]
            )
        })
        .collect();
    assert_eq!(
        saved_events.len(),
        2,
        "each blocked attacker should emit a save event for the protected target"
    );

    let mut attackers: Vec<_> = output
        .trace
        .decisions
        .iter()
        .filter(|decision| {
            decision.outcome == "kill_prevented_by_protection"
                && decision.detail["target"] == "slot_3"
        })
        .map(|decision| {
            assert_eq!(decision.stage, "kill_resolution");
            assert_eq!(decision.source, "cause:factional_kill");
            assert_eq!(decision.detail["cause"], "factional_kill");
            assert_eq!(decision.detail["unstoppable"], false);
            assert_eq!(decision.detail["protectors"][0]["protector"], "slot_2");
            assert_eq!(decision.detail["protectors"][0]["action_id"], "protect_001");
            assert_eq!(
                decision.detail["protectors"][0]["template_id"],
                "doctor_protect"
            );
            decision.detail["attacker"].as_str().unwrap().to_string()
        })
        .collect();
    attackers.sort();
    assert_eq!(
        attackers,
        vec!["slot_1".to_string(), "slot_4".to_string()],
        "trace should preserve both blocked attackers without creating a death"
    );
}

#[test]
fn trace_records_strongman_bypassing_protection() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut input = golden["input"].clone();
    for slot in input["state"]["slots"].as_array_mut().unwrap() {
        if slot["slot_id"] == "slot_1" {
            slot["role_key"] = Value::from("strongman");
        }
    }
    for sub in input["submissions"].as_array_mut().unwrap() {
        if sub["actor"] == "slot_1" {
            sub["template_id"] = Value::from("strongman_kill");
        }
    }
    let output = run_output(&input, load_pack(), "strongman-conflict-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "protection_bypassed_by_unstoppable_kill")
        .expect("strongman kill should emit a bypass trace decision");
    assert_eq!(decision.stage, "kill_resolution");
    assert_eq!(decision.source, "cause:strongman_kill");
    assert_eq!(decision.detail["target"], "slot_3");
    assert_eq!(decision.detail["attacker"], "slot_1");
    assert_eq!(decision.detail["unstoppable"], true);
    assert_eq!(decision.detail["protectors"][0]["protector"], "slot_2");
}

#[test]
fn resolver_rejects_standard_nar_strongman_cause_as_target_state_block_before_night_resolution() {
    let golden = load_golden("strongman_pierces_bulletproof.json");
    let mut pack = load_pack();
    let bulletproof = pack
        .standard_nar
        .target_state_save_policy
        .get_mut("bulletproof")
        .expect("mafiascum declares bulletproof target-state save policy");
    bulletproof
        .bypasses
        .retain(|cause| cause != "strongman_kill");
    bulletproof.blocks.push("strongman_kill".to_string());

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("Strongman cause classified as target-state block must not resolve");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar target-state save policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("strongman bypass cause `strongman_kill` must be classified in bypasses"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_target_state_save_policy_before_night_resolution() {
    let golden = load_golden("bulletproof_saves_kill.json");
    let mut pack = load_pack();
    pack.standard_nar.target_state_save_policy.clear();

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing target-state save policy must not silently use legacy saves");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid standard_nar target-state save policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("target-state save `bulletproof` must classify every kill cause")
            || message
                .contains("target-state save `bulletproof_vest` must classify every kill cause"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_target_state_save_source_before_night_resolution() {
    let golden = load_golden("bulletproof_saves_kill.json");
    let mut pack = load_pack();
    pack.standard_nar
        .target_state_save_policy
        .remove("bulletproof");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing target-state save source must not silently use legacy saves");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar target-state save policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("target-state save `bulletproof` must classify every kill cause"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_malformed_standard_nar_target_state_save_policy_before_night_resolution() {
    let golden = load_golden("bulletproof_saves_kill.json");
    let cases: Vec<(&str, fn(&mut Pack), &str)> = vec![
        (
            "empty save policy key",
            |pack| {
                pack.standard_nar.target_state_save_policy.insert(
                    "".to_string(),
                    domain::pack::TargetStateSavePolicy {
                        blocks: vec!["night_kill".to_string()],
                        bypasses: Vec::new(),
                    },
                );
            },
            "target-state save tag must not be empty",
        ),
        (
            "unknown save policy key",
            |pack| {
                pack.standard_nar.target_state_save_policy.insert(
                    "phase_armor".to_string(),
                    domain::pack::TargetStateSavePolicy {
                        blocks: vec!["night_kill".to_string()],
                        bypasses: Vec::new(),
                    },
                );
            },
            "unknown target-state save `phase_armor`",
        ),
        (
            "duplicate blocked kill cause",
            |pack| {
                let bulletproof = pack
                    .standard_nar
                    .target_state_save_policy
                    .get_mut("bulletproof")
                    .expect("mafiascum declares bulletproof target-state save policy");
                bulletproof.blocks.push("night_kill".to_string());
            },
            "target-state save `bulletproof` blocks contains duplicate kill cause `night_kill`",
        ),
        (
            "unknown blocked kill cause",
            |pack| {
                pack.standard_nar
                    .target_state_save_policy
                    .get_mut("bulletproof")
                    .expect("mafiascum declares bulletproof target-state save policy")
                    .blocks
                    .push("missing_kill_cause".to_string());
            },
            "target-state save `bulletproof` blocks references unknown kill cause `missing_kill_cause`",
        ),
        (
            "blocked and bypassed kill cause",
            |pack| {
                pack.standard_nar
                    .target_state_save_policy
                    .get_mut("bulletproof")
                    .expect("mafiascum declares bulletproof target-state save policy")
                    .bypasses
                    .push("night_kill".to_string());
            },
            "target-state save `bulletproof` kill cause `night_kill` cannot be both blocked and bypassed",
        ),
    ];

    for (case, mutate, detail) in cases {
        let mut pack = load_pack();
        mutate(&mut pack);
        let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
            .expect_err("{case} malformed target-state save policy unexpectedly resolved");
        let message = caught_panic_message(panic);
        assert!(
            message.contains("invalid standard_nar target-state save policy"),
            "{case}: unexpected panic message: {message}"
        );
        assert!(
            message.contains(detail),
            "{case}: unexpected panic message: {message}"
        );
    }
}

#[test]
fn golden_busdriver_redirect() {
    let golden = load_golden("busdriver_redirect.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "busdriver_redirect");
}

#[test]
fn golden_lightning_rod_pull() {
    let golden = load_golden("lightning_rod_pull.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "lightning_rod_pull");
}

#[test]
fn golden_redirect_cycle_stable() {
    let golden = load_golden("redirect_cycle_stable.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "redirect_cycle_stable");
}

#[test]
fn golden_mass_redirect_rotate() {
    let golden = load_golden("mass_redirect_rotate.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "mass_redirect_rotate");
}

#[test]
fn trace_records_redirect_edge_for_busdriver() {
    let golden = load_golden("busdriver_redirect.json");
    let input: GoldenInput =
        serde_json::from_value(golden["input"].clone()).expect("deserialize golden input");

    let output = resolve(ResolutionInput {
        game_id: input.game_id,
        phase_id: input.phase_id,
        run_id: "redirect-trace-run".to_string(),
        state: input.state,
        submissions: input.submissions,
        day_phase_inputs: input.day_phase_inputs,
        pack: load_pack(),
        seed: input.seed,
        logical_time: 0,
    });

    let edge = output
        .trace
        .edges
        .iter()
        .find(|edge| edge.kind == "redirect")
        .expect("bus driver should emit a redirect trace edge");
    assert_eq!(edge.from, "sub_002:target:0:slot_1");
    assert_eq!(edge.to, "sub_002:target:0:slot_2");
    assert_eq!(edge.detail["action_id"], "sub_002");
    assert_eq!(edge.detail["template_id"], "factional_kill");
    assert_eq!(edge.detail["actor"], "slot_3");
    assert_eq!(edge.detail["original_target"], "slot_1");
    assert_eq!(edge.detail["final_target"], "slot_2");
    assert_eq!(edge.detail["steps"][0]["redirect_action_id"], "sub_001");
    assert_eq!(edge.detail["steps"][0]["redirect_kind"], "Swap");
}

#[test]
fn trace_records_mass_redirect_rotate_edges() {
    let golden = load_golden("mass_redirect_rotate.json");
    let input: GoldenInput =
        serde_json::from_value(golden["input"].clone()).expect("deserialize golden input");

    let output = resolve(ResolutionInput {
        game_id: input.game_id,
        phase_id: input.phase_id,
        run_id: "mass-redirect-rotate-trace-run".to_string(),
        state: input.state,
        submissions: input.submissions,
        day_phase_inputs: input.day_phase_inputs,
        pack: load_pack(),
        seed: input.seed,
        logical_time: 0,
    });

    let edges = output
        .trace
        .edges
        .iter()
        .filter(|edge| edge.kind == "redirect")
        .collect::<Vec<_>>();
    assert_eq!(
        edges.len(),
        3,
        "three target-reading actions should be redirected"
    );
    assert_eq!(edges[0].from, "kill_rotate_n01:target:0:slot_2");
    assert_eq!(edges[0].to, "kill_rotate_n01:target:0:slot_3");
    assert_eq!(edges[1].from, "protect_rotate_n01:target:0:slot_3");
    assert_eq!(edges[1].to, "protect_rotate_n01:target:0:slot_4");
    assert_eq!(edges[2].from, "watch_rotate_n01:target:0:slot_4");
    assert_eq!(edges[2].to, "watch_rotate_n01:target:0:slot_2");
    for edge in edges {
        assert_eq!(
            edge.detail["steps"][0]["redirect_action_id"],
            "rotate_targets_n01"
        );
        assert_eq!(edge.detail["steps"][0]["redirect_kind"], "Rotate");
    }
}

#[test]
fn trace_records_redirect_loop_cap_truncation() {
    let mut pack = load_pack();
    pack.redirects.loop_cap = 1;
    let golden = load_golden("busdriver_redirect.json");
    let input: GoldenInput =
        serde_json::from_value(golden["input"].clone()).expect("deserialize golden input");

    let output = resolve(ResolutionInput {
        game_id: "game_demo_redirect_loop_cap_001".to_string(),
        phase_id: input.phase_id,
        run_id: "redirect-loop-cap-run".to_string(),
        state: input.state,
        submissions: input.submissions,
        day_phase_inputs: input.day_phase_inputs,
        pack,
        seed: input.seed,
        logical_time: 0,
    });

    assert!(
        output.trace.notes.iter().any(|note| {
            note == "redirect loop_cap (1) reached; truncating redirect graph rules"
        }),
        "trace should record deterministic redirect graph truncation"
    );
    assert!(
        output.trace.edges.iter().any(|edge| {
            edge.kind == "redirect"
                && edge.detail["original_target"] == "slot_1"
                && edge.detail["final_target"] == "slot_2"
        }),
        "truncated graph should still trace applied redirect edges"
    );
}

#[test]
fn golden_roleblock_stops_action() {
    let golden = load_golden("roleblock_stops_action.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "roleblock_stops_action");
}

#[test]
fn golden_non_roleblockable_roleblocker_survives_block() {
    let golden = load_golden("non_roleblockable_roleblocker_survives_block.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "non_roleblockable_roleblocker_survives_block",
    );
}

#[test]
fn trace_records_non_roleblockable_roleblocker_surviving_block() {
    let golden = load_golden("non_roleblockable_roleblocker_survives_block.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "non-roleblockable-roleblocker-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "action_suppressed"
                && decision.detail["reason"] == "roleblocked"
                && decision.detail["actor"] == "slot_2"
        })
        .expect("roleblocked cop should emit a suppression trace decision");
    assert_eq!(decision.stage, "night:block");
    assert_eq!(decision.detail["template_id"], "cop_investigate");
    assert_eq!(decision.detail["block_sources"][0]["actor"], "slot_4");
    assert_eq!(
        decision.detail["block_sources"][0]["template_id"],
        "roleblocker_block"
    );
    assert!(
        output.trace.decisions.iter().all(|decision| {
            decision.outcome != "action_suppressed" || decision.detail["actor"] != "slot_4"
        }),
        "non-roleblockable roleblocker_block should survive a roleblock"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_suppression_classifier_for_role_action_before_night_resolution(
) {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    for trigger_id in ["pgo_shoots_visitor", "visitor_kill_marked_visitor"] {
        remove_standard_nar_generated_kill_trigger(&mut pack, trigger_id);
    }
    pack.standard_nar
        .suppression_policy
        .get_mut("roleblocker_block")
        .expect("roleblocker suppression policy")
        .suppresses
        .retain(|action_id| action_id != "redirect");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing role-action suppression classifier must not silently resolve");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar suppression policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message
            .contains("block source `roleblocker_block` does not classify night action `redirect`"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_suppression_classifier_for_item_action_before_night_resolution(
) {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    for trigger_id in ["pgo_shoots_visitor", "visitor_kill_marked_visitor"] {
        remove_standard_nar_generated_kill_trigger(&mut pack, trigger_id);
    }
    pack.standard_nar
        .suppression_policy
        .get_mut("roleblocker_block")
        .expect("roleblocker suppression policy")
        .suppresses
        .retain(|action_id| action_id != "single_use_item");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing item-action suppression classifier must not silently resolve");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar suppression policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains(
            "block source `roleblocker_block` does not classify night action `single_use_item`"
        ),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_suppression_source_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .suppression_policy
        .remove("roleblocker_block");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing suppression source policy must not silently allow roleblocks");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar suppression policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("Block action `roleblocker_block` must classify every night action"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_malformed_standard_nar_suppression_policy_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let cases: Vec<(&str, fn(&mut Pack), &str)> = vec![
        (
            "empty block source key",
            |pack| {
                pack.standard_nar.suppression_policy.insert(
                    "".to_string(),
                    SuppressionPolicy {
                        scope: Some(SuppressionScope::FirstMatchingAction),
                        suppresses: vec!["cop_investigate".to_string()],
                        bypasses: vec!["roleblocker_block".to_string()],
                    },
                );
            },
            "block source id must not be empty",
        ),
        (
            "unknown block source key",
            |pack| {
                pack.standard_nar.suppression_policy.insert(
                    "phase_block".to_string(),
                    SuppressionPolicy {
                        scope: Some(SuppressionScope::FirstMatchingAction),
                        suppresses: vec!["cop_investigate".to_string()],
                        bypasses: vec!["roleblocker_block".to_string()],
                    },
                );
            },
            "unknown block source `phase_block`",
        ),
        (
            "missing scope",
            |pack| {
                pack.standard_nar
                    .suppression_policy
                    .get_mut("roleblocker_block")
                    .expect("roleblocker suppression policy")
                    .scope = None;
            },
            "Block action `roleblocker_block` must declare suppression scope",
        ),
        (
            "empty suppressed action",
            |pack| {
                pack.standard_nar
                    .suppression_policy
                    .get_mut("roleblocker_block")
                    .expect("roleblocker suppression policy")
                    .suppresses
                    .push("".to_string());
            },
            "block source `roleblocker_block` suppresses contains empty night action",
        ),
        (
            "duplicate suppressed action",
            |pack| {
                pack.standard_nar
                    .suppression_policy
                    .get_mut("roleblocker_block")
                    .expect("roleblocker suppression policy")
                    .suppresses
                    .push("cop_investigate".to_string());
            },
            "block source `roleblocker_block` suppresses contains duplicate night action `cop_investigate`",
        ),
        (
            "unknown suppressed action",
            |pack| {
                pack.standard_nar
                    .suppression_policy
                    .get_mut("roleblocker_block")
                    .expect("roleblocker suppression policy")
                    .suppresses
                    .push("missing_action".to_string());
            },
            "block source `roleblocker_block` suppresses references unknown night action `missing_action`",
        ),
        (
            "empty bypassed action",
            |pack| {
                pack.standard_nar
                    .suppression_policy
                    .get_mut("roleblocker_block")
                    .expect("roleblocker suppression policy")
                    .bypasses
                    .push("".to_string());
            },
            "block source `roleblocker_block` bypasses contains empty night action",
        ),
        (
            "duplicate bypassed action",
            |pack| {
                pack.standard_nar
                    .suppression_policy
                    .get_mut("roleblocker_block")
                    .expect("roleblocker suppression policy")
                    .bypasses
                    .push("roleblocker_block".to_string());
            },
            "block source `roleblocker_block` bypasses contains duplicate night action `roleblocker_block`",
        ),
        (
            "unknown bypassed action",
            |pack| {
                pack.standard_nar
                    .suppression_policy
                    .get_mut("roleblocker_block")
                    .expect("roleblocker suppression policy")
                    .bypasses
                    .push("missing_action".to_string());
            },
            "block source `roleblocker_block` bypasses references unknown night action `missing_action`",
        ),
        (
            "suppressed and bypassed action",
            |pack| {
                pack.standard_nar
                    .suppression_policy
                    .get_mut("roleblocker_block")
                    .expect("roleblocker suppression policy")
                    .bypasses
                    .push("cop_investigate".to_string());
            },
            "night action `cop_investigate` cannot be both suppressed and bypassed",
        ),
        (
            "suppression immune action in suppresses",
            |pack| {
                let policy = pack
                    .standard_nar
                    .suppression_policy
                    .get_mut("roleblocker_block")
                    .expect("roleblocker suppression policy");
                policy
                    .bypasses
                    .retain(|action_id| action_id != "strong_willed_investigate");
                policy
                    .suppresses
                    .push("strong_willed_investigate".to_string());
            },
            "suppression-immune action `strong_willed_investigate` must be classified in bypasses",
        ),
        (
            "roleblockable action in bypasses",
            |pack| {
                let policy = pack
                    .standard_nar
                    .suppression_policy
                    .get_mut("roleblocker_block")
                    .expect("roleblocker suppression policy");
                policy
                    .suppresses
                    .retain(|action_id| action_id != "doctor_protect");
                policy.bypasses.push("doctor_protect".to_string());
            },
            "roleblockable action `doctor_protect` must be classified in suppresses",
        ),
    ];

    for (case, mutate, detail) in cases {
        let mut pack = load_pack();
        mutate(&mut pack);
        let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
            .expect_err("{case} malformed suppression policy unexpectedly resolved");
        let message = caught_panic_message(panic);
        assert!(
            message.contains("invalid standard_nar suppression policy"),
            "{case}: unexpected panic message: {message}"
        );
        assert!(
            message.contains(detail),
            "{case}: unexpected panic message: {message}"
        );
    }
}

#[test]
fn resolver_rejects_redirect_suppression_without_block_precedence_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    remove_block_precedence_before(&mut pack, IrAbility::Redirect);

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("Redirect suppression without Block precedence must not resolve");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar suppression policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("suppresses action `bus_driver_swap`"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("requires Block precedence before suppressed ability `Redirect`"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_protect_suppression_without_block_precedence_before_night_resolution() {
    let golden = load_golden("kill_vs_doctor.json");
    let mut pack = load_pack();
    remove_all_precedence_before(&mut pack, IrAbility::Protect);

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("Protect suppression without Block precedence must not resolve");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar suppression policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("suppresses action `babysit`"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("requires Block precedence before suppressed ability `Protect`"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn golden_strong_willed_bypasses_roleblock() {
    let golden = load_golden("strong_willed_bypasses_roleblock.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "strong_willed_bypasses_roleblock",
    );
}

#[test]
fn trace_records_strong_willed_roleblock_bypass() {
    let golden = load_golden("strong_willed_bypasses_roleblock.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "strong-willed-roleblock-bypass-trace-run",
    );

    assert!(output.applied.events.iter().any(|event| {
        matches!(
            &event.event,
            domain::InnerEvent::InvestigationResult {
                investigator,
                target,
                result,
                ..
            } if investigator == "slot_2"
                && target == "slot_1"
                && result == &serde_json::json!("scum")
        )
    }));
    assert!(
        output.trace.decisions.iter().all(|decision| {
            decision.outcome != "action_suppressed" || decision.detail["actor"] != "slot_2"
        }),
        "StrongWilled action must bypass standard-NAR suppression"
    );
}

#[test]
fn golden_ordinary_roleblocker_suppresses_first_matching_action() {
    let golden = load_golden("ordinary_roleblocker_suppresses_first_matching_action.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "ordinary_roleblocker_suppresses_first_matching_action",
    );
}

#[test]
fn golden_roleblocker_aliases_block_first_matching() {
    let golden = load_golden("roleblocker_aliases_block_first_matching.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "roleblocker_aliases_block_first_matching",
    );
}

#[test]
fn trace_records_ordinary_roleblocker_suppressing_one_of_multiple_actions() {
    let golden = load_golden("ordinary_roleblocker_suppresses_first_matching_action.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "ordinary-roleblocker-first-match-trace-run",
    );

    let suppressed = output
        .trace
        .decisions
        .iter()
        .filter(|decision| {
            decision.outcome == "action_suppressed"
                && decision.detail["reason"] == "roleblocked"
                && decision.detail["actor"] == "slot_2"
        })
        .collect::<Vec<_>>();
    assert_eq!(
        suppressed.len(),
        1,
        "ordinary Roleblocker should suppress only the first matching action"
    );
    assert_eq!(suppressed[0].detail["template_id"], "grant_item");
    assert_eq!(
        suppressed[0].detail["block_sources"][0]["template_id"],
        "roleblocker_block"
    );
    assert!(output.applied.events.iter().any(|event| {
        matches!(
            &event.event,
            domain::InnerEvent::ActionGranted { grant_id, target, .. }
                if grant_id == "bulletproof_vest_item" && target == "slot_4"
        )
    }));
}

#[test]
fn golden_catastrophic_roleblock_suppresses_all_actions() {
    let golden = load_golden("catastrophic_roleblock_suppresses_all_actions.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "catastrophic_roleblock_suppresses_all_actions",
    );
}

#[test]
fn trace_records_catastrophic_roleblock_suppressing_multiple_actions() {
    let golden = load_golden("catastrophic_roleblock_suppresses_all_actions.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "catastrophic-roleblock-all-actions-trace-run",
    );

    let suppressed_templates = output
        .trace
        .decisions
        .iter()
        .filter(|decision| {
            decision.outcome == "action_suppressed"
                && decision.detail["reason"] == "roleblocked"
                && decision.detail["actor"] == "slot_2"
        })
        .map(|decision| decision.detail["template_id"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(suppressed_templates, vec!["grant_item", "grant_vest_item"]);
    assert!(
        output
            .applied
            .events
            .iter()
            .all(|event| { !matches!(&event.event, domain::InnerEvent::ActionGranted { .. }) }),
        "catastrophic block should suppress every grant action from the target"
    );
}

#[test]
fn resolver_rejects_invalid_pack_precedence_before_night_resolution() {
    let golden = load_golden("roleblock_stops_action.json");
    let mut pack = load_pack();
    pack.precedence = vec![
        PrecedenceRule {
            id: "block_before_kill".to_string(),
            when: PrecedenceWhen {
                effect: IrAbility::Block,
                target_state: None,
            },
            beats: vec![IrAbility::Kill],
            blocked_by: vec![],
            unless_modifiers: vec![],
            notes: String::new(),
        },
        PrecedenceRule {
            id: "kill_before_block".to_string(),
            when: PrecedenceWhen {
                effect: IrAbility::Kill,
                target_state: None,
            },
            beats: vec![IrAbility::Block],
            blocked_by: vec![],
            unless_modifiers: vec![],
            notes: String::new(),
        },
    ];

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("invalid precedence must not fall back to legacy night order");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid pack precedence for night resolution"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("precedence cycle prevents deriving night ability order"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn golden_roleblock_stops_doctor_protect() {
    let golden = load_golden("roleblock_stops_doctor_protect.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "roleblock_stops_doctor_protect",
    );
}

#[test]
fn trace_records_roleblock_suppression_decision() {
    let golden = load_golden("roleblock_stops_doctor_protect.json");
    let output = run_output(&golden["input"], load_pack(), "roleblock-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "action_suppressed"
                && decision.detail["reason"] == "roleblocked"
                && decision.detail["actor"] == "slot_2"
        })
        .expect("roleblocked doctor should emit a suppression trace decision");
    assert_eq!(decision.stage, "night:block");
    assert_eq!(decision.detail["template_id"], "doctor_protect");
    assert_eq!(decision.detail["block_sources"][0]["actor"], "slot_4");
    assert_eq!(
        decision.detail["block_sources"][0]["template_id"],
        "roleblocker_block"
    );
}

#[test]
fn golden_bodyguard_intercept() {
    let golden = load_golden("bodyguard_intercept.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "bodyguard_intercept");
}

#[test]
fn golden_huntsman_guard_retaliates() {
    let golden = load_golden("huntsman_guard_retaliates.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "huntsman_guard_retaliates");
}

#[test]
fn golden_martyr_intercept() {
    let golden = load_golden("martyr_intercept.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "martyr_intercept");
}

#[test]
fn trace_records_martyr_intercept() {
    let golden = load_golden("martyr_intercept.json");
    let output = run_output(&golden["input"], load_pack(), "martyr-intercept-trace-run");

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerSaved { slot_id, reasons, sources }
            if slot_id == "slot_3"
                && reasons == &vec!["protected".to_string()]
                && sources == &vec!["slot_2".to_string()]
    )));
    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled {
            slot_id,
            cause,
            attackers,
            unstoppable,
            ..
        } if slot_id == "slot_2"
            && cause == "martyr_intercept"
            && attackers == &vec!["slot_1".to_string()]
            && !*unstoppable
    )));

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_prevented_by_protection"
                && decision.detail["target"] == "slot_3"
        })
        .expect("Martyr protect should emit protect-vs-kill trace detail");
    assert_eq!(decision.stage, "kill_resolution");
    assert_eq!(decision.source, "cause:factional_kill");
    assert_eq!(decision.detail["attacker"], "slot_1");
    assert_eq!(decision.detail["protectors"][0]["protector"], "slot_2");
    assert_eq!(decision.detail["protectors"][0]["action_id"], "sub_002");
    assert_eq!(
        decision.detail["protectors"][0]["template_id"],
        "martyr_protect"
    );
    assert_eq!(decision.detail["protectors"][0]["intercepts"], true);
    assert_eq!(
        decision.detail["protectors"][0]["intercept_cause"],
        "martyr_intercept"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_martyr_action_bucket_before_night_resolution() {
    let golden = load_golden("martyr_intercept.json");
    let mut pack = load_pack();
    pack.standard_nar
        .martyr_action_ids
        .retain(|action_id| action_id != "martyr_protect");
    pack.standard_nar
        .protect_action_ids
        .push("martyr_protect".to_string());

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("Martyr in the generic protect bucket must not skip intercept policy");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar martyr action policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("Martyr Protect action `martyr_protect` must be declared"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn golden_cpr_saves_attacked_target() {
    let golden = load_golden("cpr_saves_attacked_target.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "cpr_saves_attacked_target");
}

#[test]
fn golden_cpr_kills_unattacked_target() {
    let golden = load_golden("cpr_kills_unattacked_target.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "cpr_kills_unattacked_target",
    );
}

#[test]
fn golden_cpr_strongman_bypass() {
    let golden = load_golden("cpr_strongman_bypass.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "cpr_strongman_bypass");
}

#[test]
fn standard_nar_cpr_harm_cause_is_pack_owned() {
    let golden = load_golden("cpr_kills_unattacked_target.json");
    let mut pack = load_pack();
    pack.standard_nar
        .cpr_harm_cause_policy
        .insert("cpr_protect".to_string(), "pack_named_cpr_harm".to_string());
    let output = run_output(&golden["input"], pack, "cpr-pack-owned-harm-cause-run");

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
            if slot_id == "slot_3" && cause == "pack_named_cpr_harm"
    )));
    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "cpr_harm_applied")
        .expect("unneeded CPR should emit harm trace detail");
    assert_eq!(decision.detail["cause"], "pack_named_cpr_harm");
}

#[test]
fn resolver_rejects_missing_standard_nar_cpr_harm_cause_policy_before_night_resolution() {
    let golden = load_golden("cpr_kills_unattacked_target.json");
    let mut pack = load_pack();
    pack.standard_nar.cpr_harm_cause_policy.clear();

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing CPR harm cause policy must not silently use action ids");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid standard_nar CPR harm cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("CPR action `cpr_protect` must declare harm cause"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_cpr_harm_source_before_night_resolution() {
    let golden = load_golden("cpr_kills_unattacked_target.json");
    let mut pack = load_pack();
    pack.standard_nar
        .cpr_harm_cause_policy
        .remove("cpr_protect");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing CPR harm source policy must not silently use action ids");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar CPR harm cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("CPR action `cpr_protect` must declare harm cause"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_malformed_standard_nar_cpr_harm_cause_policy_before_night_resolution() {
    let golden = load_golden("cpr_kills_unattacked_target.json");
    let cases: Vec<(&str, fn(&mut Pack), &str)> = vec![
        (
            "empty CPR source key",
            |pack| {
                pack.standard_nar
                    .cpr_harm_cause_policy
                    .insert("".to_string(), "custom_cpr_harm".to_string());
            },
            "CPR source id must not be empty",
        ),
        (
            "unknown CPR source key",
            |pack| {
                pack.standard_nar
                    .cpr_harm_cause_policy
                    .insert("phase_cpr".to_string(), "custom_cpr_harm".to_string());
            },
            "unknown CPR source `phase_cpr`",
        ),
        (
            "empty CPR harm cause",
            |pack| {
                pack.standard_nar
                    .cpr_harm_cause_policy
                    .insert("cpr_protect".to_string(), "".to_string());
            },
            "CPR action `cpr_protect` must declare non-empty harm cause",
        ),
        (
            "direct kill cause reused",
            |pack| {
                pack.standard_nar
                    .cpr_harm_cause_policy
                    .insert("cpr_protect".to_string(), "factional_kill".to_string());
            },
            "CPR action `cpr_protect` cause `factional_kill` must not reuse a direct kill cause",
        ),
    ];

    for (case, mutate, detail) in cases {
        let mut pack = load_pack();
        mutate(&mut pack);
        let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
            .expect_err("{case} malformed CPR harm cause policy unexpectedly resolved");
        let message = caught_panic_message(panic);
        assert!(
            message.contains("invalid standard_nar CPR harm cause policy"),
            "{case}: unexpected panic message: {message}"
        );
        assert!(
            message.contains(detail),
            "{case}: unexpected panic message: {message}"
        );
    }
}

#[test]
fn resolver_rejects_missing_standard_nar_cpr_action_bucket_before_night_resolution() {
    let golden = load_golden("cpr_kills_unattacked_target.json");
    let mut pack = load_pack();
    pack.standard_nar
        .cpr_action_ids
        .retain(|action_id| action_id != "cpr_protect");
    pack.standard_nar
        .protect_action_ids
        .push("cpr_protect".to_string());
    pack.standard_nar
        .kill_cause_ids
        .push("cpr_protect".to_string());

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("CPR in the generic protect bucket must not skip CPR harm policy");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar CPR action policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("CPR Protect+Kill action `cpr_protect` must be declared"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn trace_records_cpr_save_without_harm() {
    let golden = load_golden("cpr_saves_attacked_target.json");
    let output = run_output(&golden["input"], load_pack(), "cpr-save-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_prevented_by_protection"
                && decision.detail["target"] == "slot_3"
        })
        .expect("CPR save should emit protect-vs-kill trace detail");
    assert_eq!(decision.stage, "kill_resolution");
    assert_eq!(decision.source, "cause:factional_kill");
    assert_eq!(decision.detail["protectors"][0]["protector"], "slot_2");
    assert_eq!(decision.detail["protectors"][0]["action_id"], "sub_002");
    assert_eq!(
        decision.detail["protectors"][0]["template_id"],
        "cpr_protect"
    );
    assert_eq!(
        decision.detail["protectors"][0]["cpr_harm_cause"],
        "cpr_protect"
    );
    assert!(
        !output
            .trace
            .decisions
            .iter()
            .any(|decision| decision.outcome == "cpr_harm_applied"),
        "CPR that actually saved a target must not apply its harmful consequence"
    );
}

#[test]
fn trace_records_cpr_harm() {
    let golden = load_golden("cpr_kills_unattacked_target.json");
    let output = run_output(&golden["input"], load_pack(), "cpr-harm-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "cpr_harm_applied")
        .expect("unneeded CPR should emit harm trace detail");
    assert_eq!(decision.stage, "night:cpr");
    assert_eq!(decision.source, "action:sub_001");
    assert_eq!(decision.detail["protector"], "slot_2");
    assert_eq!(decision.detail["target"], "slot_3");
    assert_eq!(decision.detail["cause"], "cpr_protect");
}

#[test]
fn trace_records_cpr_strongman_bypass_without_extra_harm() {
    let golden = load_golden("cpr_strongman_bypass.json");
    let output = run_output(&golden["input"], load_pack(), "cpr-strongman-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "protection_bypassed_by_unstoppable_kill"
                && decision.detail["target"] == "slot_3"
        })
        .expect("Strongman bypass should emit protect bypass trace detail");
    assert_eq!(decision.stage, "kill_resolution");
    assert_eq!(decision.source, "cause:strongman_kill");
    assert_eq!(
        decision.detail["protectors"][0]["template_id"],
        "cpr_protect"
    );
    assert_eq!(
        decision.detail["protectors"][0]["cpr_harm_cause"],
        "cpr_protect"
    );
    assert!(
        !output
            .trace
            .decisions
            .iter()
            .any(|decision| decision.outcome == "cpr_harm_applied"),
        "Strongman-killed target must not receive an extra CPR harm decision"
    );
}

#[test]
fn golden_babysitter_protects_then_dooms_ward() {
    let golden = load_golden("babysitter_protects_then_dooms_ward.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "babysitter_protects_then_dooms_ward",
    );
}

#[test]
fn golden_babysitter_dependency_stacks_with_direct_ward_death() {
    let golden = load_golden("babysitter_dependency_stacks_with_direct_ward_death.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "babysitter_dependency_stacks_with_direct_ward_death",
    );
}

#[test]
fn standard_nar_babysitter_dependency_cause_is_pack_owned() {
    let golden = load_golden("babysitter_protects_then_dooms_ward.json");
    let mut pack = load_pack();
    pack.standard_nar.guard_dependency_cause_policy.insert(
        "babysit".to_string(),
        "pack_named_babysitter_dependency".to_string(),
    );
    let output = run_output(
        &golden["input"],
        pack,
        "babysitter-pack-owned-dependency-cause-run",
    );

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
            if slot_id == "slot_3" && cause == "pack_named_babysitter_dependency"
    )));
    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "babysitter_dependency_death")
        .expect("babysitter dependency should emit a death attribution trace decision");
    assert_eq!(decision.detail["template_id"], "babysit");
    assert_eq!(decision.detail["cause"], "pack_named_babysitter_dependency");
}

#[test]
fn resolver_rejects_missing_standard_nar_babysitter_protect_bucket_before_night_resolution() {
    let golden = load_golden("babysitter_protects_then_dooms_ward.json");
    let mut pack = load_pack();
    pack.standard_nar
        .protect_action_ids
        .retain(|action_id| action_id != "babysit");
    pack.standard_nar
        .bodyguard_action_ids
        .push("babysit".to_string());

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack)).expect_err(
        "Babysitter in a specialized protect bucket must not skip guard dependency ownership",
    );
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar babysitter action policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("Babysitter Protect action `babysit` must be declared"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_guard_dependency_cause_policy_before_night_resolution() {
    let golden = load_golden("babysitter_protects_then_dooms_ward.json");
    let mut pack = load_pack();
    pack.standard_nar.guard_dependency_cause_policy.clear();

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing guard dependency cause policy must not silently use action ids");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid standard_nar guard dependency cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("guard dependency action `babysit` must declare dependency cause"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_guard_dependency_source_before_night_resolution() {
    let golden = load_golden("babysitter_protects_then_dooms_ward.json");
    let mut pack = load_pack();
    pack.standard_nar
        .guard_dependency_cause_policy
        .remove("babysit");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing guard dependency source policy must not silently use action ids");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar guard dependency cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("guard dependency action `babysit` must declare dependency cause"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_malformed_standard_nar_guard_dependency_cause_policy_before_night_resolution() {
    let golden = load_golden("babysitter_protects_then_dooms_ward.json");
    let cases: Vec<(&str, fn(&mut Pack), &str)> = vec![
        (
            "empty guard dependency source key",
            |pack| {
                pack.standard_nar
                    .guard_dependency_cause_policy
                    .insert("".to_string(), "custom_guard_dependency".to_string());
            },
            "guard dependency source id must not be empty",
        ),
        (
            "unknown guard dependency source key",
            |pack| {
                pack.standard_nar
                    .guard_dependency_cause_policy
                    .insert(
                        "phase_guard".to_string(),
                        "custom_guard_dependency".to_string(),
                    );
            },
            "unknown guard dependency source `phase_guard`",
        ),
        (
            "empty guard dependency cause",
            |pack| {
                pack.standard_nar
                    .guard_dependency_cause_policy
                    .insert("babysit".to_string(), "".to_string());
            },
            "guard dependency action `babysit` must declare non-empty dependency cause",
        ),
        (
            "direct kill cause reused",
            |pack| {
                pack.standard_nar
                    .guard_dependency_cause_policy
                    .insert("babysit".to_string(), "factional_kill".to_string());
            },
            "guard dependency action `babysit` cause `factional_kill` must not reuse a direct kill cause",
        ),
    ];

    for (case, mutate, detail) in cases {
        let mut pack = load_pack();
        mutate(&mut pack);
        let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
            .expect_err("{case} malformed guard dependency cause policy unexpectedly resolved");
        let message = caught_panic_message(panic);
        assert!(
            message.contains("invalid standard_nar guard dependency cause policy"),
            "{case}: unexpected panic message: {message}"
        );
        assert!(
            message.contains(detail),
            "{case}: unexpected panic message: {message}"
        );
    }
}

#[test]
fn trace_records_babysitter_dependency_death() {
    let golden = load_golden("babysitter_protects_then_dooms_ward.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "babysitter-dependency-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "babysitter_dependency_death")
        .expect("babysitter dependency should emit a death attribution trace decision");
    assert_eq!(decision.stage, "night:dependency_death");
    assert_eq!(decision.source, "action:babysit_001");
    assert_eq!(decision.detail["action_id"], "babysit_001");
    assert_eq!(decision.detail["template_id"], "babysit");
    assert_eq!(decision.detail["protector"], "slot_2");
    assert_eq!(decision.detail["ward"], "slot_3");
    assert_eq!(decision.detail["cause"], "babysit");
    assert_eq!(decision.detail["attackers"][0], "slot_2");
}

#[test]
fn trace_records_babysitter_dependency_stack_with_direct_ward_death() {
    let golden = load_golden("babysitter_dependency_stacks_with_direct_ward_death.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "babysitter-dependency-stack-trace-run",
    );

    let dependency = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "babysitter_dependency_death")
        .expect("raced babysitter dependency should still emit dependency attribution");
    assert_eq!(dependency.stage, "night:dependency_death");
    assert_eq!(dependency.source, "action:babysit_001");
    assert_eq!(dependency.detail["action_id"], "babysit_001");
    assert_eq!(dependency.detail["template_id"], "babysit");
    assert_eq!(dependency.detail["protector"], "slot_2");
    assert_eq!(dependency.detail["ward"], "slot_3");
    assert_eq!(dependency.detail["cause"], "babysit");
    assert_eq!(dependency.detail["attackers"][0], "slot_2");

    let stacked = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_stacked_on_existing_death"
                && decision.detail["target"] == "slot_3"
        })
        .expect("babysitter dependency should merge into the direct ward death");
    assert_eq!(stacked.stage, "kill_resolution");
    assert_eq!(stacked.source, "cause:babysit");
    assert_eq!(stacked.detail["attacker"], "slot_2");
    assert_eq!(stacked.detail["cause"], "babysit");
    assert_eq!(stacked.detail["existing_cause"], "strongman_kill");
    assert_eq!(stacked.detail["unstoppable"], true);
    assert_eq!(
        stacked.detail["merged_attackers"],
        serde_json::json!(["slot_1", "slot_2"])
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_kill_stacking_policy_before_night_resolution() {
    let golden = load_golden("babysitter_dependency_stacks_with_direct_ward_death.json");
    let mut pack = load_pack();
    pack.standard_nar.kill_stacking = None;

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing standard-NAR kill stacking policy must not silently unstack kills");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar kill stacking policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("requires kill_stacking AggregateAttackers"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_target_state_save_catalog_before_night_resolution() {
    let golden = load_golden("bulletproof_saves_kill.json");
    let mut pack = load_pack();
    pack.standard_nar.target_state_save_tags.clear();

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing target-state save catalog must not silently use hardcoded tags");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid standard_nar target-state save catalog"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("must declare target-state save tags"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn golden_jailkeeper_block_protect() {
    let golden = load_golden("jailkeeper_block_protect.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "jailkeeper_block_protect");
}

#[test]
fn trace_records_jailkeeper_block_plus_protect_policy() {
    let golden = load_golden("jailkeeper_block_protect.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "jailkeeper-block-protect-trace-run",
    );

    let suppression = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "action_suppressed" && decision.detail["action_id"] == "sub_003"
        })
        .expect("Jailkeeper should suppress the jailed Cop action");
    assert_eq!(suppression.stage, "night:block");
    assert_eq!(suppression.detail["actor"], "slot_3");
    assert_eq!(suppression.detail["reason"], "roleblocked");
    assert_eq!(suppression.detail["template_id"], "cop_investigate");
    assert_eq!(suppression.detail["block_sources"][0]["actor"], "slot_2");
    assert_eq!(
        suppression.detail["block_sources"][0]["action_id"],
        "sub_002"
    );
    assert_eq!(
        suppression.detail["block_sources"][0]["template_id"],
        "jail"
    );

    let protect = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_prevented_by_protection"
                && decision.detail["target"] == "slot_3"
        })
        .expect("Jailkeeper should protect the jailed target from normal kill");
    assert_eq!(protect.stage, "kill_resolution");
    assert_eq!(protect.source, "cause:factional_kill");
    assert_eq!(protect.detail["attacker"], "slot_1");
    assert_eq!(protect.detail["cause"], "factional_kill");
    assert_eq!(protect.detail["unstoppable"], false);
    assert_eq!(protect.detail["protectors"][0]["protector"], "slot_2");
    assert_eq!(protect.detail["protectors"][0]["action_id"], "sub_002");
    assert_eq!(protect.detail["protectors"][0]["template_id"], "jail");
}

#[test]
fn golden_bulletproof_saves_kill() {
    let golden = load_golden("bulletproof_saves_kill.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "bulletproof_saves_kill");
}

#[test]
fn golden_bulletproof_vest_consumed() {
    let golden = load_golden("bulletproof_vest_consumed.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "bulletproof_vest_consumed");
}

#[test]
fn golden_commuter_avoids_targeting() {
    let golden = load_golden("commuter_avoids_targeting.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "commuter_avoids_targeting");
}

#[test]
fn standard_nar_commute_gate_uses_target_state_gate_policy() {
    let golden = load_golden("commuter_avoids_targeting.json");
    let mut pack = load_pack();
    pack.standard_nar
        .target_state_gate_policy
        .get_mut("commuted")
        .expect("mafiascum declares commuted target-state gate policy")
        .blocks = vec![IrAbility::Investigate];

    let output = run_output(
        &golden["input"],
        pack,
        "commuter-target-state-gate-policy-run",
    );
    assert!(
        output.applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
                if slot_id == "slot_2" && cause == "factional_kill"
        )),
        "mutated commuted gate policy should let Kill land"
    );
    assert!(
        !output.trace.decisions.iter().any(|decision| {
            decision.outcome == "kill_skipped_by_target_state"
                && decision.detail["reason"] == "commuted"
        }),
        "Kill must not be gated by commuted when the standard_nar table omits Kill"
    );
    assert!(
        output.trace.decisions.iter().any(|decision| {
            decision.outcome == "action_interfered_by_target_state"
                && decision.detail["reason"] == "commuted"
                && decision.detail["ability"] == "Investigate"
        }),
        "Investigate should remain gated by commuted after the policy mutation"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_target_state_gate_policy_before_night_resolution() {
    let golden = load_golden("commuter_avoids_targeting.json");
    let mut pack = load_pack();
    pack.standard_nar.target_state_gate_policy.clear();

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing target-state gate policy must not silently use hardcoded gates");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid standard_nar target-state gate policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("target-state gate `commuted` must classify blocked abilities")
            || message.contains("target-state gate `untargetable` must classify blocked abilities")
            || message.contains("target-state gate `ascetic` must classify blocked abilities"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_target_state_gate_source_before_night_resolution() {
    let golden = load_golden("commuter_avoids_targeting.json");
    let mut pack = load_pack();
    pack.standard_nar
        .target_state_gate_policy
        .remove("commuted");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing target-state gate source must not silently use hardcoded gates");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar target-state gate policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("target-state gate `commuted` must classify blocked abilities"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_malformed_standard_nar_target_state_gate_policy_before_night_resolution() {
    let golden = load_golden("commuter_avoids_targeting.json");
    let cases: Vec<(&str, fn(&mut Pack), &str)> = vec![
        (
            "empty gate policy key",
            |pack| {
                pack.standard_nar.target_state_gate_policy.insert(
                    "".to_string(),
                    domain::pack::TargetStateGatePolicy {
                        blocks: vec![IrAbility::Kill],
                    },
                );
            },
            "target-state gate tag must not be empty",
        ),
        (
            "unknown gate policy key",
            |pack| {
                pack.standard_nar.target_state_gate_policy.insert(
                    "phase_shifted".to_string(),
                    domain::pack::TargetStateGatePolicy {
                        blocks: vec![IrAbility::Kill],
                    },
                );
            },
            "unknown target-state gate `phase_shifted`",
        ),
        (
            "duplicate blocked ability",
            |pack| {
                pack.standard_nar
                    .target_state_gate_policy
                    .get_mut("commuted")
                    .expect("mafiascum declares commuted target-state gate policy")
                    .blocks = vec![IrAbility::Kill, IrAbility::Kill];
            },
            "target-state gate `commuted` contains duplicate blocked ability `Kill`",
        ),
        (
            "unsupported blocked ability",
            |pack| {
                pack.standard_nar
                    .target_state_gate_policy
                    .get_mut("commuted")
                    .expect("mafiascum declares commuted target-state gate policy")
                    .blocks = vec![IrAbility::Block];
            },
            "target-state gate `commuted` only supports Kill, Protect, Investigate, Convert, or Mark, got `Block`",
        ),
    ];

    for (case, mutate, detail) in cases {
        let mut pack = load_pack();
        mutate(&mut pack);
        let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
            .expect_err("{case} malformed target-state gate policy unexpectedly resolved");
        let message = caught_panic_message(panic);
        assert!(
            message.contains("invalid standard_nar target-state gate policy"),
            "{case}: unexpected panic message: {message}"
        );
        assert!(
            message.contains(detail),
            "{case}: unexpected panic message: {message}"
        );
    }
}

#[test]
fn resolver_rejects_missing_standard_nar_target_state_gate_catalog_before_night_resolution() {
    let golden = load_golden("commuter_avoids_targeting.json");
    let mut pack = load_pack();
    pack.standard_nar.target_state_gate_tags.clear();

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing target-state gate catalog must not silently use hardcoded tags");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid standard_nar target-state gate catalog"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("must declare target-state gate tags"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn trace_records_commuter_target_state_gate() {
    let golden = load_golden("commuter_avoids_targeting.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "commuter-target-state-trace-run",
    );

    let skipped_kill = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_skipped_by_target_state"
                && decision.detail["reason"] == "commuted"
        })
        .expect("commuted kill target should emit a skipped-kill trace decision");
    assert_eq!(skipped_kill.stage, "kill_resolution");
    assert_eq!(skipped_kill.source, "cause:factional_kill");
    assert_eq!(skipped_kill.detail["action_id"], "sub_002");
    assert_eq!(skipped_kill.detail["actor"], "slot_1");
    assert_eq!(skipped_kill.detail["target"], "slot_2");
    assert!(skipped_kill.detail["target_tags"]
        .as_array()
        .unwrap()
        .iter()
        .any(|tag| tag == "commuted"));

    let interfered_investigation = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "action_interfered_by_target_state"
                && decision.detail["reason"] == "commuted"
        })
        .expect("commuted investigation target should emit an interference trace decision");
    assert_eq!(interfered_investigation.stage, "night:target_state");
    assert_eq!(interfered_investigation.detail["action_id"], "sub_003");
    assert_eq!(interfered_investigation.detail["actor"], "slot_3");
    assert_eq!(interfered_investigation.detail["target"], "slot_2");
}

#[test]
fn golden_untargetable_blocks_targeting() {
    let golden = load_golden("untargetable_blocks_targeting.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "untargetable_blocks_targeting",
    );
}

#[test]
fn golden_rolestop_and_shield_target_state() {
    let golden = load_golden("rolestop_and_shield_target_state.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "rolestop_and_shield_target_state",
    );
}

#[test]
fn trace_records_rolestop_and_shield_target_state_gate() {
    let golden = load_golden("rolestop_and_shield_target_state.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "rolestop-shield-target-state-trace-run",
    );

    let skipped_targets = output
        .trace
        .decisions
        .iter()
        .filter(|decision| {
            decision.outcome == "kill_skipped_by_target_state"
                && decision.detail["reason"] == "untargetable"
        })
        .map(|decision| {
            assert_eq!(decision.stage, "kill_resolution");
            assert_eq!(decision.detail["target_tags"][0], "untargetable");
            decision.detail["target"].as_str().unwrap().to_string()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        skipped_targets,
        vec!["slot_3".to_string(), "slot_4".to_string()]
    );

    let interfered_investigation = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "action_interfered_by_target_state"
                && decision.detail["reason"] == "untargetable"
        })
        .expect("shielded investigation target should emit an interference trace decision");
    assert_eq!(
        interfered_investigation.detail["action_id"],
        "cop_check_shielded_n01"
    );
    assert_eq!(interfered_investigation.detail["actor"], "slot_6");
    assert_eq!(interfered_investigation.detail["target"], "slot_4");
}

#[test]
fn trace_records_passive_untargetable_target_state_gate() {
    let golden = load_golden("untargetable_blocks_targeting.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "untargetable-target-state-trace-run",
    );

    let skipped_kill = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_skipped_by_target_state"
                && decision.detail["reason"] == "untargetable"
        })
        .expect("untargetable kill target should emit a skipped-kill trace decision");
    assert_eq!(skipped_kill.detail["action_id"], "sub_001");
    assert_eq!(skipped_kill.detail["actor"], "slot_1");
    assert_eq!(skipped_kill.detail["target"], "slot_2");

    let interfered_investigation = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "action_interfered_by_target_state"
                && decision.detail["reason"] == "untargetable"
        })
        .expect("untargetable investigation target should emit an interference trace decision");
    assert_eq!(interfered_investigation.detail["action_id"], "sub_002");
    assert_eq!(interfered_investigation.detail["actor"], "slot_3");
    assert_eq!(interfered_investigation.detail["target"], "slot_2");
}

#[test]
fn golden_strongman_pierces_bulletproof() {
    let golden = load_golden("strongman_pierces_bulletproof.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "strongman_pierces_bulletproof",
    );
}

#[test]
fn golden_godfather_parity_override() {
    let golden = load_golden("godfather_parity_override.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "godfather_parity_override");
}

#[test]
fn golden_miller_parity_override() {
    let golden = load_golden("miller_parity_override.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "miller_parity_override");
}

#[test]
fn golden_role_set_info_positive() {
    let golden = load_golden("role_set_info_positive.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "role_set_info_positive");
}

#[test]
fn golden_role_set_info_negative() {
    let golden = load_golden("role_set_info_negative.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "role_set_info_negative");
}

#[test]
fn golden_psychologist_detects_killer() {
    let golden = load_golden("psychologist_detects_killer.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "psychologist_detects_killer",
    );
}

#[test]
fn golden_specialist_detects_specialist() {
    let golden = load_golden("specialist_detects_specialist.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "specialist_detects_specialist",
    );
}

#[test]
fn golden_pt_cop_reads_private_topic_access() {
    let golden = load_golden("pt_cop_reads_private_topic_access.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "pt_cop_reads_private_topic_access",
    );
}

#[test]
fn golden_role_scan_reveals_role() {
    let golden = load_golden("role_scan_reveals_role.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "role_scan_reveals_role");
}

#[test]
fn golden_coroner_inspects_corpse() {
    let golden = load_golden("coroner_inspects_corpse.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "coroner_inspects_corpse");
}

#[test]
fn golden_framer_parity_override() {
    let golden = load_golden("framer_parity_override.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "framer_parity_override");
}

#[test]
fn golden_lawyer_parity_override() {
    let golden = load_golden("lawyer_parity_override.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "lawyer_parity_override");
}

#[test]
fn golden_info_actions_private_results() {
    let golden = load_golden("info_actions_private_results.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "info_actions_private_results",
    );
}

#[test]
fn golden_fruit_vendor_sends_fruit() {
    let golden = load_golden("fruit_vendor_sends_fruit.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "fruit_vendor_sends_fruit");
}

#[test]
fn golden_action_investigation_guards() {
    let golden = load_golden("action_investigation_guards.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "action_investigation_guards",
    );
}

#[test]
fn golden_prior_result_memory_changed_by_frame() {
    let golden = load_golden("prior_result_memory_changed_by_frame.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "prior_result_memory_changed_by_frame",
    );
}

#[test]
fn golden_prior_motion_reads_visit_history() {
    let golden = load_golden("prior_motion_reads_visit_history.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "prior_motion_reads_visit_history",
    );
}

#[test]
fn golden_friendly_neighbor_visit() {
    let golden = load_golden("friendly_neighbor_visit.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "friendly_neighbor_visit");
}

#[test]
fn golden_neighborize_visit() {
    let golden = load_golden("neighborize_visit.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "neighborize_visit");
}

#[test]
fn golden_tracker_tracks_visit() {
    let golden = load_golden("tracker_tracks_visit.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "tracker_tracks_visit");
}

#[test]
fn golden_follower_reads_action_type() {
    let golden = load_golden("follower_reads_action_type.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "follower_reads_action_type",
    );
}

#[test]
fn golden_watcher_sees_visitors() {
    let golden = load_golden("watcher_sees_visitors.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "watcher_sees_visitors");
}

#[test]
fn golden_motion_detector_activity() {
    let golden = load_golden("motion_detector_activity.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "motion_detector_activity");
}

#[test]
fn golden_ninja_hidden_from_watch_motion() {
    let golden = load_golden("ninja_hidden_from_watch_motion.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "ninja_hidden_from_watch_motion",
    );
}

#[test]
fn golden_ninja_hidden_from_motion() {
    let golden = load_golden("ninja_hidden_from_motion.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "ninja_hidden_from_motion");
}

#[test]
fn resolver_rejects_missing_ninja_visibility_policy_before_night_resolution() {
    let golden = load_golden("ninja_hidden_from_watch_motion.json");
    let mut pack = load_pack();
    pack.visibility.remove(&IrAbility::Investigate);
    pack.visibility_families
        .retain(|family| format!("{family:?}") != "PrivateInvestigationResults");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing Ninja visibility policy must not reveal visits");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid visibility policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("visibility families require Investigate visibility policy"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn golden_one_shot_vigilante_marks_use() {
    let golden = load_golden("one_shot_vigilante_marks_use.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "one_shot_vigilante_marks_use",
    );
}

#[test]
fn golden_one_shot_vigilante_exhausted() {
    let golden = load_golden("one_shot_vigilante_exhausted.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "one_shot_vigilante_exhausted",
    );
}

#[test]
fn golden_two_shot_vigilante_second_charge_marks_exhausted() {
    let golden = load_golden("two_shot_vigilante_second_charge_marks_exhausted.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "two_shot_vigilante_second_charge_marks_exhausted",
    );
}

#[test]
fn golden_two_shot_vigilante_exhausted() {
    let golden = load_golden("two_shot_vigilante_exhausted.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "two_shot_vigilante_exhausted",
    );
}

#[test]
fn golden_serial_killer_wins_as_sole_survivor() {
    let golden = load_golden("serial_killer_wins_as_sole_survivor.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "serial_killer_wins_as_sole_survivor",
    );
}

#[test]
fn golden_serial_killer_blocks_mafia_parity() {
    let golden = load_golden("serial_killer_blocks_mafia_parity.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "serial_killer_blocks_mafia_parity",
    );
}

#[test]
fn golden_white_wolf_king_night_kill() {
    let golden = load_golden("white_wolf_king_night_kill.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "white_wolf_king_night_kill",
    );
}

#[test]
fn golden_jack_of_all_trades_block_consumes_one_shot() {
    let golden = load_golden("jack_of_all_trades_block_consumes_one_shot.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "jack_of_all_trades_block_consumes_one_shot",
    );
}

#[test]
fn golden_non_reflexive_self_target_rejected() {
    let golden = load_golden("non_reflexive_self_target_rejected.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "non_reflexive_self_target_rejected",
    );
}

#[test]
fn golden_ascetic_blocks_non_lethal_actions() {
    let golden = load_golden("ascetic_blocks_non_lethal_actions.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "ascetic_blocks_non_lethal_actions",
    );
}

#[test]
fn trace_records_ascetic_non_lethal_target_state_gate() {
    let golden = load_golden("ascetic_blocks_non_lethal_actions.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "ascetic-target-state-trace-run",
    );
    let poison = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "action_interfered_by_target_state"
                && decision.detail["reason"] == "ascetic"
                && decision.detail["ability"] == "Mark"
        })
        .expect("ascetic poison target should emit a Mark interference trace decision");
    assert_eq!(poison.detail["target_tags"], serde_json::json!(["ascetic"]));
    let investigation = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "action_interfered_by_target_state"
                && decision.detail["reason"] == "ascetic"
                && decision.detail["ability"] == "Investigate"
        })
        .expect(
            "ascetic investigation target should emit an Investigate interference trace decision",
        );
    assert_eq!(
        investigation.detail["target_tags"],
        serde_json::json!(["ascetic"])
    );
}

#[test]
fn golden_ascetic_blocks_protect_and_convert() {
    let golden = load_golden("ascetic_blocks_protect_and_convert.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "ascetic_blocks_protect_and_convert",
    );
}

#[test]
fn trace_records_ascetic_protect_and_convert_target_state_gate() {
    let golden = load_golden("ascetic_blocks_protect_and_convert.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "ascetic-protect-convert-target-state-trace-run",
    );
    let protect = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "action_interfered_by_target_state"
                && decision.detail["reason"] == "ascetic"
                && decision.detail["ability"] == "Protect"
        })
        .expect("ascetic protect target should emit a Protect interference trace decision");
    assert_eq!(
        protect.detail["target_tags"],
        serde_json::json!(["ascetic"])
    );
    let conversion = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "conversion_blocked"
                && decision.detail["reason"] == "ascetic"
                && decision.detail["target_tags"] == serde_json::json!(["ascetic"])
        })
        .expect("ascetic conversion target should emit a conversion_blocked trace decision");
    assert_eq!(conversion.detail["target_role"], "ascetic");
}

#[test]
fn golden_personal_commute_rejects_other_target() {
    let golden = load_golden("personal_commute_rejects_other_target.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "personal_commute_rejects_other_target",
    );
}

#[test]
fn golden_cooldown_cop_records_use() {
    let golden = load_golden("cooldown_cop_records_use.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "cooldown_cop_records_use");
}

#[test]
fn golden_cooldown_cop_blocks_next_cycle() {
    let golden = load_golden("cooldown_cop_blocks_next_cycle.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "cooldown_cop_blocks_next_cycle",
    );
}

#[test]
fn golden_long_cooldown_cop_blocks_second_cycle() {
    let golden = load_golden("long_cooldown_cop_blocks_second_cycle.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "long_cooldown_cop_blocks_second_cycle",
    );
}

#[test]
fn golden_long_cooldown_cop_accepts_after_second_cycle() {
    let golden = load_golden("long_cooldown_cop_accepts_after_second_cycle.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "long_cooldown_cop_accepts_after_second_cycle",
    );
}

#[test]
fn golden_novice_cop_blocks_before_active() {
    let golden = load_golden("novice_cop_blocks_before_active.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "novice_cop_blocks_before_active",
    );
}

#[test]
fn golden_activated_cop_blocks_before_active() {
    let golden = load_golden("activated_cop_blocks_before_active.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "activated_cop_blocks_before_active",
    );
}

#[test]
fn golden_novice_activated_cops_active_n2() {
    let golden = load_golden("novice_activated_cops_active_n2.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "novice_activated_cops_active_n2",
    );
}

#[test]
fn golden_odd_even_night_constraints() {
    let golden = load_golden("odd_even_night_constraints.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "odd_even_night_constraints",
    );
}

#[test]
fn golden_odd_even_cycle_constraints() {
    let golden = load_golden("odd_even_cycle_constraints.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "odd_even_cycle_constraints",
    );
}

#[test]
fn golden_phase_window_night_action_rejected_during_day() {
    let golden = load_golden("phase_window_night_action_rejected_during_day.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "phase_window_night_action_rejected_during_day",
    );
}

#[test]
fn golden_phase_window_day_action_rejected_during_night() {
    let golden = load_golden_in(
        "chinese_structured",
        "phase_window_day_action_rejected_during_night.json",
    );
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "phase_window_day_action_rejected_during_night",
    );
}

#[test]
fn golden_weak_cop_dies_on_scum() {
    let golden = load_golden("weak_cop_dies_on_scum.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "weak_cop_dies_on_scum");
}

#[test]
fn golden_lazy_cop_blocks_endgame() {
    let golden = load_golden("lazy_cop_blocks_endgame.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "lazy_cop_blocks_endgame");
}

#[test]
fn golden_lazy_cop_allows_multiple_non_town() {
    let golden = load_golden("lazy_cop_allows_multiple_non_town.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "lazy_cop_allows_multiple_non_town",
    );
}

#[test]
fn golden_macho_ignores_protection() {
    let golden = load_golden("macho_ignores_protection.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "macho_ignores_protection");
}

#[test]
fn golden_loud_announcing_notifications() {
    let golden = load_golden("loud_announcing_notifications.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "loud_announcing_notifications",
    );
}

#[test]
fn golden_non_consecutive_blocks_same_target() {
    let golden = load_golden("non_consecutive_blocks_same_target.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "non_consecutive_blocks_same_target",
    );
}

#[test]
fn golden_non_consecutive_allows_different_target() {
    let golden = load_golden("non_consecutive_allows_different_target.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "non_consecutive_allows_different_target",
    );
}

#[test]
fn golden_indecisive_cop_blocks_same_target() {
    let golden = load_golden("indecisive_cop_blocks_same_target.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "indecisive_cop_blocks_same_target",
    );
}

#[test]
fn golden_indecisive_cop_allows_different_target() {
    let golden = load_golden("indecisive_cop_allows_different_target.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "indecisive_cop_allows_different_target",
    );
}

#[test]
fn golden_uncooperative_cop_ambiguous_feedback() {
    let golden = load_golden("uncooperative_cop_ambiguous_feedback.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "uncooperative_cop_ambiguous_feedback",
    );
}

#[test]
fn golden_roaming_cop_blocks_prior_target_across_gap() {
    let golden = load_golden("roaming_cop_blocks_prior_target_across_gap.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "roaming_cop_blocks_prior_target_across_gap",
    );
}

#[test]
fn golden_roaming_cop_allows_new_target_after_gap() {
    let golden = load_golden("roaming_cop_allows_new_target_after_gap.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "roaming_cop_allows_new_target_after_gap",
    );
}

#[test]
fn golden_disabled_endgame_cop_blocks_at_threshold() {
    let golden = load_golden("disabled_endgame_cop_blocks_at_threshold.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "disabled_endgame_cop_blocks_at_threshold",
    );
}

#[test]
fn golden_disabled_endgame_cop_allows_above_threshold() {
    let golden = load_golden("disabled_endgame_cop_allows_above_threshold.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "disabled_endgame_cop_allows_above_threshold",
    );
}

#[test]
fn golden_lost_mafia_goon_blocks_team_kill_with_teammate_alive() {
    let golden = load_golden("lost_mafia_goon_blocks_team_kill_with_teammate_alive.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "lost_mafia_goon_blocks_team_kill_with_teammate_alive",
    );
}

#[test]
fn golden_lost_mafia_goon_allows_team_kill_when_sole_mafia_alive() {
    let golden = load_golden("lost_mafia_goon_allows_team_kill_when_sole_mafia_alive.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "lost_mafia_goon_allows_team_kill_when_sole_mafia_alive",
    );
}

#[test]
fn golden_recluse_mafia_goon_blocks_team_kill_with_non_recluse_teammate_alive() {
    let golden =
        load_golden("recluse_mafia_goon_blocks_team_kill_with_non_recluse_teammate_alive.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "recluse_mafia_goon_blocks_team_kill_with_non_recluse_teammate_alive",
    );
}

#[test]
fn golden_recluse_mafia_goon_allows_team_kill_when_living_teammates_recluse() {
    let golden =
        load_golden("recluse_mafia_goon_allows_team_kill_when_living_teammates_recluse.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "recluse_mafia_goon_allows_team_kill_when_living_teammates_recluse",
    );
}

#[test]
fn golden_compulsive_missing_action() {
    let golden = load_golden("compulsive_missing_action.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "compulsive_missing_action");
}

#[test]
fn golden_duplicate_base_action_blocks_without_simultaneous() {
    let golden = load_golden("duplicate_base_action_blocks_without_simultaneous.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "duplicate_base_action_blocks_without_simultaneous",
    );
}

#[test]
fn golden_simultaneous_vigilante_allows_multiple_same_template_submissions() {
    let golden =
        load_golden("simultaneous_vigilante_allows_multiple_same_template_submissions.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "simultaneous_vigilante_allows_multiple_same_template_submissions",
    );
}

#[test]
fn golden_poison_marks_no_death() {
    let golden = load_golden("poison_marks_no_death.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "poison_marks_no_death");
}

#[test]
fn golden_pending_poison_kills() {
    let golden = load_golden("pending_poison_kills.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "pending_poison_kills");
}

#[test]
fn trace_records_pending_poison_applied() {
    let golden = load_golden("pending_poison_kills.json");
    let output = run_output(&golden["input"], load_pack(), "pending-poison-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "pending_poison_applied")
        .expect("pending poison death should emit a trace decision");
    assert_eq!(decision.stage, "night:pending_effect");
    assert_eq!(decision.source, "delayed_death:poisoned:slot_2:sub_prev");
    assert_eq!(decision.detail["target"], "slot_2");
    assert_eq!(decision.detail["effect"], "poisoned");
    assert_eq!(decision.detail["cause"], "poison");
    assert_eq!(decision.detail["source"], "slot_1");
    assert_eq!(decision.detail["source_action"], "sub_prev");
}

#[test]
fn golden_pending_poison_target_already_dead() {
    let golden = load_golden("pending_poison_target_already_dead.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "pending_poison_target_already_dead",
    );
}

#[test]
fn trace_records_pending_poison_target_already_dead() {
    let golden = load_golden("pending_poison_target_already_dead.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "pending-poison-already-dead-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "pending_poison_target_already_dead")
        .expect("already-dead pending poison target should emit a trace decision");
    assert_eq!(decision.stage, "night:pending_effect");
    assert_eq!(decision.source, "delayed_death:poisoned:slot_2:sub_prev");
    assert_eq!(decision.detail["target"], "slot_2");
    assert_eq!(decision.detail["effect"], "poisoned");
    assert_eq!(decision.detail["cause"], "poison");
    assert_eq!(decision.detail["source"], "slot_1");
    assert_eq!(decision.detail["source_action"], "sub_prev");
}

#[test]
fn golden_cure_poison_preempts_death() {
    let golden = load_golden("cure_poison_preempts_death.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "cure_poison_preempts_death",
    );
}

#[test]
fn trace_records_cure_poison_preempting_pending_death() {
    let golden = load_golden("cure_poison_preempts_death.json");
    let output = run_output(&golden["input"], load_pack(), "cure-poison-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "pending_poison_preempted_by_clear")
        .expect("cured pending poison should emit a preemption trace decision");
    assert_eq!(decision.stage, "night:pending_effect");
    assert_eq!(decision.source, "delayed_death:poisoned:slot_2:sub_prev");
    assert_eq!(decision.detail["target"], "slot_2");
    assert_eq!(decision.detail["effect"], "poisoned");
    assert_eq!(decision.detail["source"], "slot_3");
    assert_eq!(decision.detail["source_action"], "sub_prev");
}

#[test]
fn golden_ignite_reads_doused() {
    let golden = load_golden("ignite_reads_doused.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "ignite_reads_doused");
}

#[test]
fn golden_cleanse_preempts_ignite() {
    let golden = load_golden("cleanse_preempts_ignite.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "cleanse_preempts_ignite");
}

#[test]
fn trace_records_cleanse_preempting_ignite_read_effect() {
    let golden = load_golden("cleanse_preempts_ignite.json");
    let output = run_output(&golden["input"], load_pack(), "cleanse-ignite-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "read_effect_target_preempted_by_clear")
        .expect("cleansed douse should emit a read-effect preemption trace decision");
    assert_eq!(decision.stage, "night:read_effect");
    assert_eq!(decision.source, "action:sub_002");
    assert_eq!(decision.detail["action_id"], "sub_002");
    assert_eq!(decision.detail["template_id"], "ignite");
    assert_eq!(decision.detail["actor"], "slot_1");
    assert_eq!(decision.detail["target"], "slot_3");
    assert_eq!(decision.detail["reads_effect"], "doused");
}

#[test]
fn golden_motivator_grants_extra_action() {
    let golden = load_golden("motivator_grants_extra_action.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "motivator_grants_extra_action",
    );
}

#[test]
fn golden_inventor_grants_item() {
    let golden = load_golden("inventor_grants_item.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "inventor_grants_item");
}

#[test]
fn golden_inventor_item_investigate_consumed() {
    let golden = load_golden("inventor_item_investigate_consumed.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "inventor_item_investigate_consumed",
    );
}

#[test]
fn golden_inventor_item_inventory_exhausted() {
    let golden = load_golden("inventor_item_inventory_exhausted.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "inventor_item_inventory_exhausted",
    );
}

#[test]
fn golden_inventor_vest_item_marks_bulletproof_vest() {
    let golden = load_golden("inventor_vest_item_marks_bulletproof_vest.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "inventor_vest_item_marks_bulletproof_vest",
    );
}

#[test]
fn golden_deprogram_restores_original() {
    let golden = load_golden("deprogram_restores_original.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "deprogram_restores_original",
    );
}

#[test]
fn golden_cult_recruit_converts_to_cultist() {
    let golden = load_golden("cult_recruit_converts_to_cultist.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "cult_recruit_converts_to_cultist",
    );
}

#[test]
fn golden_disloyal_cult_recruit_requires_cross_alignment() {
    let golden = load_golden("disloyal_cult_recruit_cross_alignment.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "disloyal_cult_recruit_cross_alignment",
    );
}

#[test]
fn trace_records_deprogram_restore_original() {
    let golden = load_golden("deprogram_restores_original.json");
    let output = run_output(&golden["input"], load_pack(), "deprogram-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "conversion_restored_original")
        .expect("deprogram should emit a restore-original trace decision");
    assert_eq!(decision.stage, "night:conversion");
    assert_eq!(decision.source, "action:sub_001");
    assert_eq!(decision.detail["action_id"], "sub_001");
    assert_eq!(decision.detail["template_id"], "deprogram");
    assert_eq!(decision.detail["actor"], "slot_1");
    assert_eq!(decision.detail["target"], "slot_2");
    assert_eq!(decision.detail["mode"], "RestoreOriginal");
    assert_eq!(decision.detail["new_role"], "cop");
    assert_eq!(decision.detail["new_alignment"], "town");
    assert_eq!(decision.detail["original_role"], "cultist");
    assert_eq!(decision.detail["original_alignment"], "cult");
    assert_eq!(decision.detail["origin_source"], "slot_5");
}

#[test]
fn trace_records_disloyal_action_suppression() {
    let golden = load_golden("disloyal_cult_recruit_cross_alignment.json");
    let output = run_output(&golden["input"], load_pack(), "disloyal-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "action_suppressed" && decision.detail["reason"] == "disloyal"
        })
        .expect("same-alignment disloyal recruit should emit a suppression trace decision");
    assert_eq!(decision.stage, "night:action_constraints");
    assert_eq!(decision.source, "action:disloyal_recruit_same_alignment");
    assert_eq!(
        decision.detail["action_id"],
        "disloyal_recruit_same_alignment"
    );
    assert_eq!(decision.detail["template_id"], "disloyal_cult_recruit");
    assert_eq!(decision.detail["actor"], "slot_1");
    assert_eq!(decision.detail["actor_alignment"], "cult");
    assert_eq!(decision.detail["targets"], serde_json::json!(["slot_6"]));
    assert_eq!(
        decision.detail["target_alignments"],
        serde_json::json!([{"target": "slot_6", "alignment": "cult"}])
    );

    let converted = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "conversion_assigned_role"
                && decision.detail["action_id"] == "disloyal_recruit_cross_alignment"
        })
        .expect("cross-alignment disloyal recruit should convert normally");
    assert_eq!(converted.detail["actor"], "slot_3");
    assert_eq!(converted.detail["target"], "slot_2");
    assert_eq!(converted.detail["new_role"], "cultist");
}

#[test]
fn golden_vanillaize_mutates_role() {
    let golden = load_golden("vanillaize_mutates_role.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "vanillaize_mutates_role");
}

#[test]
fn golden_conversion_blocked_on_dead_target() {
    let golden = load_golden("conversion_blocked_on_dead_target.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "conversion_blocked_on_dead_target",
    );
}

#[test]
fn trace_records_conversion_dead_target_policy() {
    let golden = load_golden("conversion_blocked_on_dead_target.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "conversion-dead-target-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "conversion_blocked" && decision.detail["reason"] == "dead_target"
        })
        .expect("dead conversion target should emit a conversion-block trace decision");
    assert_eq!(decision.stage, "night:conversion");
    assert_eq!(decision.source, "action:convert_001");
    assert_eq!(decision.detail["action_id"], "convert_001");
    assert_eq!(decision.detail["template_id"], "vanillaize");
    assert_eq!(decision.detail["actor"], "slot_1");
    assert_eq!(decision.detail["target"], "slot_2");
    assert_eq!(decision.detail["target_role"], "cop");
    assert_eq!(decision.detail["target_alignment"], "town");
    assert_eq!(decision.detail["mode"], "AssignRole");
}

#[test]
fn golden_conversion_blocked_on_pending_death() {
    let golden = load_golden("conversion_blocked_on_pending_death.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "conversion_blocked_on_pending_death",
    );
}

#[test]
fn trace_records_conversion_pending_death_policy() {
    let golden = load_golden("conversion_blocked_on_pending_death.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "conversion-pending-death-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "conversion_blocked" && decision.detail["reason"] == "pending_death"
        })
        .expect("pending-death conversion target should emit a conversion-block trace decision");
    assert_eq!(decision.stage, "night:conversion");
    assert_eq!(decision.source, "action:convert_001");
    assert_eq!(decision.detail["action_id"], "convert_001");
    assert_eq!(decision.detail["template_id"], "vanillaize");
    assert_eq!(decision.detail["actor"], "slot_1");
    assert_eq!(decision.detail["target"], "slot_2");
    assert_eq!(decision.detail["target_role"], "cop");
    assert_eq!(decision.detail["target_alignment"], "town");
    assert_eq!(decision.detail["mode"], "AssignRole");
    assert_eq!(decision.detail["queue_id"], "poisoned:slot_2:poison_prev");
    assert_eq!(decision.detail["cause"], "poison");
    assert_eq!(decision.detail["effect"], "poisoned");
    assert_eq!(decision.detail["source_action"], "poison_prev");
}

#[test]
fn resolver_rejects_missing_conversion_policy_before_night_resolution() {
    let golden = load_golden("conversion_blocked_on_dead_target.json");
    let mut pack = load_pack();
    pack.conversion_policy.on_dead_target = None;

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing conversion policy must not silently use resolver timing");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid conversion policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("on_dead_target Block"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_conversion_pending_death_policy_before_night_resolution() {
    let golden = load_golden("conversion_blocked_on_pending_death.json");
    let mut pack = load_pack();
    pack.conversion_policy.on_pending_death = None;

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing conversion pending-death policy must not silently resolve");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid conversion policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("on_pending_death Block"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn trace_records_vanillaize_assignment() {
    let golden = load_golden("vanillaize_mutates_role.json");
    let output = run_output(&golden["input"], load_pack(), "vanillaize-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "conversion_assigned_role")
        .expect("vanillaize should emit an assigned-role conversion trace decision");
    assert_eq!(decision.stage, "night:conversion");
    assert_eq!(decision.source, "action:sub_001");
    assert_eq!(decision.detail["action_id"], "sub_001");
    assert_eq!(decision.detail["template_id"], "vanillaize");
    assert_eq!(decision.detail["actor"], "slot_1");
    assert_eq!(decision.detail["target"], "slot_2");
    assert_eq!(decision.detail["mode"], "AssignRole");
    assert_eq!(decision.detail["new_role"], "vanilla_townie");
    assert_eq!(decision.detail["new_alignment"], "town");
    assert_eq!(decision.detail["original_role"], "cop");
    assert_eq!(decision.detail["original_alignment"], "town");
}

#[test]
fn golden_backup_cop_inherits_on_cop_death() {
    let golden = load_golden("backup_cop_inherits_on_cop_death.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "backup_cop_inherits_on_cop_death",
    );
}

#[test]
fn trace_records_passive_backup_inheritance() {
    let golden = load_golden("backup_cop_inherits_on_cop_death.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "passive-backup-inheritance-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "backup_inherited_role")
        .expect("passive backup should emit an inheritance trace decision");
    assert_eq!(decision.stage, "night:backup");
    assert_eq!(decision.source, "slot:slot_2");
    assert_eq!(decision.detail["backup"], "slot_3");
    assert_eq!(decision.detail["source_target"], "slot_2");
    assert_eq!(decision.detail["policy"], "passive");
    assert_eq!(decision.detail["policy_detail"]["effect"], "backup:cop");
    assert_eq!(decision.detail["new_role"], "cop");
    assert_eq!(decision.detail["new_alignment"], "town");
    assert_eq!(decision.detail["original_role"], "backup_cop");
    assert_eq!(decision.detail["original_alignment"], "town");
}

#[test]
fn golden_targeted_backup_designates_source() {
    let golden = load_golden("targeted_backup_designates_source.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "targeted_backup_designates_source",
    );
}

#[test]
fn golden_targeted_backup_inherits_on_target_death() {
    let golden = load_golden("targeted_backup_inherits_on_target_death.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "targeted_backup_inherits_on_target_death",
    );
}

#[test]
fn trace_records_targeted_backup_inheritance() {
    let golden = load_golden("targeted_backup_inherits_on_target_death.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "targeted-backup-inheritance-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "backup_inherited_role")
        .expect("targeted backup should emit an inheritance trace decision");
    assert_eq!(decision.stage, "night:backup");
    assert_eq!(decision.source, "slot:slot_2");
    assert_eq!(decision.detail["backup"], "slot_1");
    assert_eq!(decision.detail["source_target"], "slot_2");
    assert_eq!(decision.detail["policy"], "targeted");
    assert_eq!(
        decision.detail["policy_detail"]["source_action"],
        "target_backup_n01"
    );
    assert_eq!(
        decision.detail["policy_detail"]["declared_source_role"],
        "cop"
    );
    assert_eq!(decision.detail["policy_detail"]["target_phase_id"], "N01");
    assert_eq!(
        decision.detail["policy_detail"]["target_phase_kind"],
        "Night"
    );
    assert_eq!(decision.detail["policy_detail"]["target_phase_number"], 1);
    assert_eq!(decision.detail["new_role"], "cop");
    assert_eq!(decision.detail["new_alignment"], "town");
    assert_eq!(decision.detail["original_role"], "universal_backup");
    assert_eq!(decision.detail["original_alignment"], "town");
}

#[test]
fn golden_executioner_targets_victim() {
    let golden = load_golden("executioner_targets_victim.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "executioner_targets_victim",
    );
}

#[test]
fn golden_executioner_wins_on_target_lynch() {
    let golden = load_golden("executioner_wins_on_target_lynch.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "executioner_wins_on_target_lynch",
    );
}

#[test]
fn golden_condemner_targets_victim() {
    let golden = load_golden("condemner_targets_victim.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "condemner_targets_victim");
}

#[test]
fn golden_condemner_wins_on_target_lynch() {
    let golden = load_golden("condemner_wins_on_target_lynch.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "condemner_wins_on_target_lynch",
    );
}

#[test]
fn golden_jester_wins_on_self_lynch() {
    let golden = load_golden("jester_wins_on_self_lynch.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "jester_wins_on_self_lynch");
}

#[test]
fn golden_saulus_flips_alignment_on_lynch() {
    let golden = load_golden("saulus_flips_alignment_on_lynch.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "saulus_flips_alignment_on_lynch",
    );
}

#[test]
fn golden_survivor_wins_alive_at_end_with_town() {
    let golden = load_golden("survivor_wins_alive_at_end_with_town.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "survivor_wins_alive_at_end_with_town",
    );
}

#[test]
fn golden_traitor_counts_for_mafia_parity_without_faction_action() {
    let golden = load_golden("traitor_counts_for_mafia_parity.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "traitor_counts_for_mafia_parity",
    );
}

#[test]
fn trace_records_executioner_target_lynch_win() {
    let golden = load_golden("executioner_wins_on_target_lynch.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "executioner-target-lynch-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "target_lynch_win_reached")
        .expect("executioner target lynch should emit an independent-win trace decision");
    assert_eq!(decision.stage, "day:lynch_trigger");
    assert_eq!(decision.source, "action:executioner_target_n01");
    assert_eq!(decision.detail["policy"], "executioner");
    assert_eq!(decision.detail["owner"], "slot_1");
    assert_eq!(decision.detail["target"], "slot_2");
    assert_eq!(decision.detail["effect"], "execution_target");
    assert_eq!(decision.detail["winner"], "executioner");
    assert_eq!(decision.detail["target_phase_id"], "N01");
    assert_eq!(decision.detail["target_phase_kind"], "Night");
    assert_eq!(decision.detail["target_phase_number"], 1);
}

#[test]
fn trace_records_condemner_target_lynch_win() {
    let golden = load_golden("condemner_wins_on_target_lynch.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "condemner-target-lynch-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "target_lynch_win_reached")
        .expect("condemner target lynch should emit an independent-win trace decision");
    assert_eq!(decision.stage, "day:lynch_trigger");
    assert_eq!(decision.source, "action:condemner_target_n01");
    assert_eq!(decision.detail["policy"], "condemner");
    assert_eq!(decision.detail["owner"], "slot_1");
    assert_eq!(decision.detail["target"], "slot_2");
    assert_eq!(decision.detail["effect"], "condemner_target");
    assert_eq!(decision.detail["winner"], "condemner");
    assert_eq!(decision.detail["target_phase_id"], "N01");
    assert_eq!(decision.detail["target_phase_kind"], "Night");
    assert_eq!(decision.detail["target_phase_number"], 1);
}

#[test]
fn trace_records_jester_self_lynch_win() {
    let golden = load_golden("jester_wins_on_self_lynch.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "jester-self-lynch-win-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "self_lynch_win_reached")
        .expect("Jester self-lynch should emit an independent-win trace decision");
    assert_eq!(decision.stage, "day:lynch_trigger");
    assert_eq!(decision.source, "slot:slot_1");
    assert_eq!(decision.detail["policy"], "jester");
    assert_eq!(decision.detail["target"], "slot_1");
    assert_eq!(decision.detail["role"], "jester");
    assert_eq!(decision.detail["winner"], "jester");
    assert_eq!(decision.detail["source_event"], "win.jester");
}

#[test]
fn trace_records_survivor_alive_at_end_award() {
    let golden = load_golden("survivor_wins_alive_at_end_with_town.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "survivor-alive-at-end-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "survival_win_awarded")
        .expect("Survivor alive at end should emit a survival-award trace decision");
    assert_eq!(decision.stage, "win:survival");
    assert_eq!(decision.source, "slot:slot_3");
    assert_eq!(decision.detail["policy"], "survivor");
    assert_eq!(decision.detail["winner"], "survivor");
    assert_eq!(decision.detail["slot_id"], "slot_3");
    assert_eq!(decision.detail["role"], "survivor");
    assert_eq!(decision.detail["source_event"], "win.survivor");
}

#[test]
fn trace_records_saulus_alignment_flip() {
    let golden = load_golden("saulus_flips_alignment_on_lynch.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "saulus-alignment-flip-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "saulus_alignment_flipped")
        .expect("Saulus lynch should emit an alignment-flip trace decision");
    assert_eq!(decision.stage, "day:lynch_trigger");
    assert_eq!(decision.source, "slot:slot_1");
    assert_eq!(decision.detail["target"], "slot_1");
    assert_eq!(decision.detail["role"], "saulus");
    assert_eq!(decision.detail["original_alignment"], "mafia");
    assert_eq!(decision.detail["new_alignment"], "town");
    assert_eq!(decision.detail["reason"], "saulus_conversion");
}

#[test]
fn golden_beloved_princess_lynch_prompts_skip_day() {
    let golden = load_golden("beloved_princess_lynch_prompts_skip_day.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "beloved_princess_lynch_prompts_skip_day",
    );
}

#[test]
fn golden_virgin_night_death_prompts_skip_day() {
    let golden = load_golden("virgin_night_death_prompts_skip_day.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "virgin_night_death_prompts_skip_day",
    );
}

#[test]
fn trace_records_beloved_princess_host_prompt() {
    let golden = load_golden("beloved_princess_lynch_prompts_skip_day.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "beloved-princess-host-prompt-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "host_prompt_issued")
        .expect("Beloved Princess lynch should emit a host-prompt trace decision");
    assert_eq!(decision.stage, "death:trigger");
    assert_eq!(decision.source, "slot:slot_1");
    assert_eq!(decision.detail["policy"], "beloved_princess");
    assert_eq!(decision.detail["prompt_id"], "D01:skip_next_day:slot_1");
    assert_eq!(decision.detail["kind"], "skip_next_day");
    assert_eq!(decision.detail["subject"], "slot_1");
    assert_eq!(decision.detail["reason"], "beloved_princess_death");
    assert_eq!(decision.detail["death_cause"], "lynch");
    assert_eq!(decision.detail["role"], "beloved_princess");
}

#[test]
fn golden_vengeful_retaliates_on_kill() {
    let golden = load_golden("vengeful_retaliates_on_kill.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "vengeful_retaliates_on_kill",
    );
}

#[test]
fn golden_death_curse_retaliates_on_death() {
    let golden = load_golden("death_curse_retaliates_on_death.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "death_curse_retaliates_on_death",
    );
}

#[test]
fn golden_bomb_retaliates_on_night_kill() {
    let golden = load_golden("bomb_retaliates_on_night_kill.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "bomb_retaliates_on_night_kill",
    );
}

#[test]
fn golden_death_mark_detonates_on_effect_marked() {
    let golden = load_golden("death_mark_detonates_on_effect_marked.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "death_mark_detonates_on_effect_marked",
    );
}

#[test]
fn golden_phase_end_doom_claims_on_phase_end() {
    let golden = load_golden("phase_end_doom_claims_on_phase_end.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "phase_end_doom_claims_on_phase_end",
    );
}

#[test]
fn golden_win_witness_observes_on_win() {
    let golden = load_golden("win_witness_observes_on_win.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "win_witness_observes_on_win",
    );
}

#[test]
fn trace_records_win_trigger_observation() {
    let golden = load_golden("win_witness_observes_on_win.json");
    let output = run_output(&golden["input"], load_pack(), "win-trigger-trace-run");

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::Trigger { trigger_id, payload }
            if trigger_id == "win_witness_observes"
                && payload["on"] == "Win"
                && payload["source_target"] == "slot_1"
                && payload["source_actor"] == "slot_1"
                && payload["source_cause"] == "win:town"
                && payload["produced_actor"] == "slot_1"
                && payload["produced_target"] == "slot_1"
    )));
    assert!(matches!(
        output.applied.events.last().map(|indexed| &indexed.event),
        Some(domain::InnerEvent::WinReached { winner, .. }) if winner == "town"
    ));
    assert!(
        output
            .trace
            .notes
            .iter()
            .any(|note| note == "trigger win_witness_observes emitted at event_index 0"),
        "ResolutionTrace should persist the win trigger diagnostic note"
    );
}

#[test]
fn trace_records_phase_end_trigger_observation() {
    let golden = load_golden("phase_end_doom_claims_on_phase_end.json");
    let output = run_output(&golden["input"], load_pack(), "phase-end-trigger-trace-run");

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::Trigger { trigger_id, payload }
            if trigger_id == "phase_end_doom_claims"
                && payload["on"] == "PhaseEnd"
                && payload["source_target"] == "slot_1"
                && payload["source_actor"] == "slot_1"
                && payload["source_cause"] == "phase_end:N01"
                && payload["produced_actor"] == "slot_1"
                && payload["produced_target"] == "slot_1"
    )));
    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled { slot_id, cause, attackers, unstoppable, .. }
            if slot_id == "slot_1"
                && cause == "phase_end_doom_claims"
                && attackers == &vec!["slot_1".to_string()]
                && !*unstoppable
    )));
    assert!(
        output
            .trace
            .notes
            .iter()
            .any(|note| note == "trigger phase_end_doom_claims emitted at event_index 0"),
        "ResolutionTrace should persist the phase-end trigger diagnostic note"
    );
}

#[test]
fn trace_records_effect_marked_trigger_observation() {
    let golden = load_golden("death_mark_detonates_on_effect_marked.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "effect-marked-trigger-trace-run",
    );

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::Trigger { trigger_id, payload }
            if trigger_id == "death_mark_detonates"
                && payload["on"] == "EffectMarked"
                && payload["source_target"] == "slot_2"
                && payload["source_actor"] == "slot_1"
                && payload["source_cause"] == "death_mark_001"
                && payload["produced_actor"] == "slot_1"
                && payload["produced_target"] == "slot_2"
    )));
    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled { slot_id, cause, attackers, unstoppable, .. }
            if slot_id == "slot_2"
                && cause == "death_mark_detonates"
                && attackers == &vec!["slot_1".to_string()]
                && !*unstoppable
    )));
    assert!(
        output
            .trace
            .notes
            .iter()
            .any(|note| note == "trigger death_mark_detonates emitted at event_index 2"),
        "ResolutionTrace should persist the effect-marked trigger diagnostic note"
    );
}

#[test]
fn trace_records_death_trigger_observation() {
    let golden = load_golden("death_curse_retaliates_on_death.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "death-cursed-trigger-trace-run",
    );

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::Trigger { trigger_id, payload }
            if trigger_id == "death_curse_retaliates"
                && payload["on"] == "Death"
                && payload["source_target"] == "slot_2"
                && payload["source_actor"] == "slot_1"
                && payload["source_cause"] == "factional_kill"
                && payload["produced_actor"] == "slot_2"
                && payload["produced_target"] == "slot_1"
    )));
    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled { slot_id, cause, attackers, unstoppable, .. }
            if slot_id == "slot_1"
                && cause == "death_curse_retaliates"
                && attackers == &vec!["slot_2".to_string()]
                && !*unstoppable
    )));
    assert!(
        output
            .trace
            .notes
            .iter()
            .any(|note| note == "trigger death_curse_retaliates emitted at event_index 1"),
        "Death trigger note should persist at its generated event index"
    );
}

#[test]
fn trigger_generated_trace_rows_mirror_trigger_payloads() {
    let cases = [
        ("mafiascum", "death_curse_retaliates_on_death.json"),
        ("mafiascum", "death_mark_detonates_on_effect_marked.json"),
        ("mafiascum", "bomb_retaliates_on_night_kill.json"),
        ("mafiascum", "phase_end_doom_claims_on_phase_end.json"),
        ("mafiascum", "win_witness_observes_on_win.json"),
        ("mafiascum", "pgo_shoots_visitor.json"),
        ("mafiascum", "vengeful_retaliates_on_kill.json"),
        ("mafiascum", "unstoppable_vengeful_bypasses_protection.json"),
        ("mafiascum", "super_saint_retaliates_on_lynch.json"),
        ("mafiascum", "visitor_kill_filters_visitors.json"),
        ("epicmafia", "bomb_trigger.json"),
    ];

    for (pack_name, golden_name) in cases {
        let golden = load_golden_in(pack_name, golden_name);
        let output = run_output(
            &golden["input"],
            load_pack_named(pack_name),
            &format!("{pack_name}:{golden_name}:trigger-generated-trace-run"),
        );
        let triggers = output
            .applied
            .events
            .iter()
            .filter_map(|indexed| match &indexed.event {
                domain::InnerEvent::Trigger {
                    trigger_id,
                    payload,
                } => Some((indexed.index, trigger_id, payload)),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(
            !triggers.is_empty(),
            "{pack_name}/{golden_name} should exercise at least one Trigger event"
        );

        for (event_index, trigger_id, payload) in triggers {
            let produced_actor = payload["produced_actor"]
                .as_str()
                .unwrap_or_else(|| panic!("{pack_name}/{golden_name}:{trigger_id} produced_actor"));
            let produced_target = payload["produced_target"].as_str().unwrap_or_else(|| {
                panic!("{pack_name}/{golden_name}:{trigger_id} produced_target")
            });
            let generated = output
                .trace
                .generated
                .iter()
                .find(|generated| {
                    generated.source == "Trigger"
                        && generated.action_id == *trigger_id
                        && generated.detail["event_index"] == serde_json::json!(event_index)
                })
                .unwrap_or_else(|| {
                    panic!(
                        "{pack_name}/{golden_name}:{trigger_id} should emit a matching generated trace row"
                    )
                });
            assert_eq!(
                generated.actor, produced_actor,
                "{pack_name}/{golden_name}:{trigger_id}"
            );
            assert_eq!(
                generated.targets,
                vec![produced_target.to_string()],
                "{pack_name}/{golden_name}:{trigger_id}"
            );
            for key in [
                "on",
                "source_target",
                "source_actor",
                "source_cause",
                "produced_actor",
                "produced_target",
            ] {
                assert_eq!(
                    generated.detail[key], payload[key],
                    "{pack_name}/{golden_name}:{trigger_id}:{key}"
                );
            }
            assert_eq!(
                generated.detail["actor_filter"],
                payload.get("actor_filter").cloned().unwrap_or(Value::Null),
                "{pack_name}/{golden_name}:{trigger_id}:actor_filter"
            );
        }
    }
}

#[test]
fn golden_vengeful_retaliates_saved_by_doctor() {
    let golden = load_golden("vengeful_retaliates_saved_by_doctor.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "vengeful_retaliates_saved_by_doctor",
    );
}

#[test]
fn trace_records_protected_vengeful_generated_kill() {
    let golden = load_golden("vengeful_retaliates_saved_by_doctor.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "protected-vengeful-trigger-trace-run",
    );

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::Trigger { trigger_id, payload }
            if trigger_id == "vengeful_retaliates"
                && payload["source_target"] == "slot_2"
                && payload["source_actor"] == "slot_1"
                && payload["source_cause"] == "factional_kill"
                && payload["produced_actor"] == "slot_2"
                && payload["produced_target"] == "slot_1"
    )));
    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerSaved { slot_id, reasons, sources }
            if slot_id == "slot_1"
                && reasons == &vec!["protected".to_string()]
                && sources == &vec!["slot_3".to_string()]
    )));
    assert!(
        !output.applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
                if slot_id == "slot_1" && cause == "vengeful_retaliates"
        )),
        "Doctor-protected ordinary vengeful generated kill must not kill the original attacker"
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_prevented_by_protection"
                && decision.detail["cause"] == "vengeful_retaliates"
        })
        .expect("protected vengeful trigger kill should emit normal protect trace detail");
    assert_eq!(decision.stage, "kill_resolution");
    assert_eq!(decision.source, "cause:vengeful_retaliates");
    assert_eq!(decision.detail["target"], "slot_1");
    assert_eq!(decision.detail["attacker"], "slot_2");
    assert_eq!(decision.detail["unstoppable"], false);
    assert_eq!(decision.detail["protectors"][0]["protector"], "slot_3");
    assert_eq!(decision.detail["protectors"][0]["action_id"], "protect_001");
    assert_eq!(
        decision.detail["protectors"][0]["template_id"],
        "doctor_protect"
    );
    assert!(
        output
            .trace
            .notes
            .iter()
            .any(|note| note == "trigger vengeful_retaliates emitted at event_index 1"),
        "ordinary vengeful trigger note should persist at its generated event index"
    );
}

#[test]
fn golden_unstoppable_vengeful_bypasses_protection() {
    let golden = load_golden("unstoppable_vengeful_bypasses_protection.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "unstoppable_vengeful_bypasses_protection",
    );
}

#[test]
fn trace_records_unstoppable_trigger_generated_kill() {
    let golden = load_golden("unstoppable_vengeful_bypasses_protection.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "unstoppable-vengeful-trigger-trace-run",
    );

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::Trigger { trigger_id, .. }
            if trigger_id == "unstoppable_vengeful_retaliates"
    )));
    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled {
            slot_id,
            cause,
            attackers,
            unstoppable,
            ..
        } if slot_id == "slot_1"
            && cause == "unstoppable_vengeful_retaliates"
            && attackers == &vec!["slot_2".to_string()]
            && *unstoppable
    )));

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "protection_bypassed_by_unstoppable_kill"
                && decision.detail["cause"] == "unstoppable_vengeful_retaliates"
        })
        .expect("pack-declared Strongman trigger kill should emit a bypass trace decision");
    assert_eq!(decision.stage, "kill_resolution");
    assert_eq!(decision.source, "cause:unstoppable_vengeful_retaliates");
    assert_eq!(decision.detail["target"], "slot_1");
    assert_eq!(decision.detail["attacker"], "slot_2");
    assert_eq!(decision.detail["unstoppable"], true);
    assert_eq!(decision.detail["protectors"][0]["protector"], "slot_3");
    assert_eq!(decision.detail["protectors"][0]["action_id"], "protect_001");
    assert_eq!(
        decision.detail["protectors"][0]["template_id"],
        "doctor_protect"
    );
}

#[test]
fn golden_unstoppable_vengeful_bypasses_bodyguard() {
    let golden = load_golden("unstoppable_vengeful_bypasses_bodyguard.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "unstoppable_vengeful_bypasses_bodyguard",
    );
}

#[test]
fn golden_unstoppable_vengeful_bypasses_martyr() {
    let golden = load_golden("unstoppable_vengeful_bypasses_martyr.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "unstoppable_vengeful_bypasses_martyr",
    );
}

#[test]
fn trace_records_unstoppable_trigger_bypassing_bodyguard() {
    let golden = load_golden("unstoppable_vengeful_bypasses_bodyguard.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "unstoppable-vengeful-bodyguard-trace-run",
    );

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled {
            slot_id,
            cause,
            attackers,
            unstoppable,
            ..
        } if slot_id == "slot_1"
            && cause == "unstoppable_vengeful_retaliates"
            && attackers == &vec!["slot_2".to_string()]
            && *unstoppable
    )));
    assert!(
        !output.applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerSaved { slot_id, .. } if slot_id == "slot_1"
        )),
        "unstoppable generated trigger kill must not save the bodyguard-protected target"
    );
    assert!(
        !output.applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
                if slot_id == "slot_3" && cause == "bodyguard_intercept"
        )),
        "Bodyguard must not die intercepting an unstoppable generated trigger kill"
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "protection_bypassed_by_unstoppable_kill"
                && decision.detail["cause"] == "unstoppable_vengeful_retaliates"
        })
        .expect("Strongman trigger kill should emit a bypass decision for Bodyguard protection");
    assert_eq!(decision.stage, "kill_resolution");
    assert_eq!(decision.source, "cause:unstoppable_vengeful_retaliates");
    assert_eq!(decision.detail["target"], "slot_1");
    assert_eq!(decision.detail["attacker"], "slot_2");
    assert_eq!(decision.detail["unstoppable"], true);
    assert_eq!(decision.detail["protectors"][0]["protector"], "slot_3");
    assert_eq!(
        decision.detail["protectors"][0]["action_id"],
        "bodyguard_001"
    );
    assert_eq!(decision.detail["protectors"][0]["template_id"], "bodyguard");
    assert_eq!(decision.detail["protectors"][0]["intercepts"], true);
}

#[test]
fn trace_records_unstoppable_trigger_bypassing_martyr() {
    let golden = load_golden("unstoppable_vengeful_bypasses_martyr.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "unstoppable-vengeful-martyr-trace-run",
    );

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled {
            slot_id,
            cause,
            attackers,
            unstoppable,
            ..
        } if slot_id == "slot_1"
            && cause == "unstoppable_vengeful_retaliates"
            && attackers == &vec!["slot_2".to_string()]
            && *unstoppable
    )));
    assert!(
        !output.applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerSaved { slot_id, .. } if slot_id == "slot_1"
        )),
        "unstoppable generated trigger kill must not save the Martyr-protected target"
    );
    assert!(
        !output.applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
                if slot_id == "slot_3" && cause == "martyr_intercept"
        )),
        "Martyr must not die intercepting an unstoppable generated trigger kill"
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "protection_bypassed_by_unstoppable_kill"
                && decision.detail["cause"] == "unstoppable_vengeful_retaliates"
        })
        .expect("Strongman trigger kill should emit a bypass decision for Martyr protection");
    assert_eq!(decision.stage, "kill_resolution");
    assert_eq!(decision.source, "cause:unstoppable_vengeful_retaliates");
    assert_eq!(decision.detail["target"], "slot_1");
    assert_eq!(decision.detail["attacker"], "slot_2");
    assert_eq!(decision.detail["unstoppable"], true);
    assert_eq!(decision.detail["protectors"][0]["protector"], "slot_3");
    assert_eq!(decision.detail["protectors"][0]["action_id"], "martyr_001");
    assert_eq!(
        decision.detail["protectors"][0]["template_id"],
        "martyr_protect"
    );
    assert_eq!(decision.detail["protectors"][0]["intercepts"], true);
    assert_eq!(
        decision.detail["protectors"][0]["intercept_cause"],
        "martyr_intercept"
    );
}

#[test]
fn golden_super_saint_retaliates_on_lynch() {
    let golden = load_golden("super_saint_retaliates_on_lynch.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "super_saint_retaliates_on_lynch",
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_day_generated_kill_cause_policy_before_trigger_fixpoint() {
    let golden = load_golden("super_saint_retaliates_on_lynch.json");
    let mut pack = load_pack();
    pack.standard_nar
        .generated_kill_cause_policy
        .remove("super_saint_retaliates");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing day generated kill cause policy must not use trigger modifiers");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid standard_nar generated kill cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("generated kill trigger `super_saint_retaliates` must declare generated kill cause policy"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn trace_records_super_saint_lynch_trigger() {
    let golden = load_golden("super_saint_retaliates_on_lynch.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "super-saint-lynch-trigger-trace-run",
    );

    let (trigger_event_index, trigger_payload) = output
        .applied
        .events
        .iter()
        .find_map(|indexed| match &indexed.event {
            domain::InnerEvent::Trigger {
                trigger_id,
                payload,
            } if trigger_id == "super_saint_retaliates" => Some((indexed.index, payload)),
            _ => None,
        })
        .expect("Super-Saint lynch should emit a typed trigger event");
    assert_eq!(
        trigger_payload,
        &serde_json::json!({
            "on": "Lynch",
            "source_target": "slot_1",
            "source_actor": "slot_2",
            "source_cause": "lynch",
            "produced_actor": "slot_1",
            "produced_target": "slot_2"
        })
    );
    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled {
            slot_id,
            cause,
            attackers,
            unstoppable,
            ..
        } if slot_id == "slot_2"
            && cause == "super_saint_retaliates"
            && attackers == &vec!["slot_1".to_string()]
            && !*unstoppable
    )));
    let trigger_note =
        format!("trigger super_saint_retaliates emitted at event_index {trigger_event_index}");
    assert!(
        output.trace.notes.iter().any(|note| note == &trigger_note),
        "Super-Saint lynch trigger should be visible in persisted trace notes"
    );
    assert!(
        output.trace.generated.iter().any(|generated| {
            generated.action_id == "super_saint_retaliates"
                && generated.source == "Trigger"
                && generated.actor == "slot_1"
                && generated.targets == vec!["slot_2".to_string()]
                && generated.detail["on"] == "Lynch"
                && generated.detail["source_target"] == "slot_1"
                && generated.detail["source_actor"] == "slot_2"
                && generated.detail["source_cause"] == "lynch"
                && generated.detail["event_index"] == serde_json::json!(trigger_event_index)
        }),
        "Super-Saint lynch trigger should be represented as a generated trace row"
    );
}

#[test]
fn trace_records_trigger_loop_cap_for_cyclic_retaliation_fixture() {
    let mut pack = load_pack();
    pack.redirects.loop_cap = 1;
    let golden = load_golden("vengeful_retaliates_on_kill.json");
    let mut input: GoldenInput =
        serde_json::from_value(golden["input"].clone()).expect("deserialize golden input");
    input.state.slots[0].effects.push("vengeful".to_string());

    let output = resolve(ResolutionInput {
        game_id: "game_demo_trigger_loop_cap_001".to_string(),
        phase_id: input.phase_id,
        run_id: "trigger-loop-cap-run".to_string(),
        state: input.state,
        submissions: input.submissions,
        day_phase_inputs: input.day_phase_inputs,
        pack,
        seed: input.seed,
        logical_time: 0,
    });

    assert!(
        output
            .trace
            .notes
            .iter()
            .any(|note| { note == "trigger loop_cap (1) reached; terminating trigger fixpoint" }),
        "trace should record deterministic trigger loop-cap termination"
    );
    assert_eq!(
        output.applied.counts.kills, 2,
        "fixture still resolves the initial kill and first generated retaliation"
    );
    assert!(
        output
            .trace
            .notes
            .iter()
            .any(|note| note == "trigger vengeful_retaliates emitted at event_index 1"),
        "ordinary trigger trace notes should remain intact"
    );
}

#[test]
fn golden_pgo_shoots_visitor() {
    let golden = load_golden("pgo_shoots_visitor.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "pgo_shoots_visitor");
}

#[test]
fn golden_visitor_kill_filters_visitors() {
    let golden = load_golden("visitor_kill_filters_visitors.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "visitor_kill_filters_visitors",
    );
}

#[test]
fn trace_records_visitor_kill_actor_filter() {
    let golden = load_golden("visitor_kill_filters_visitors.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "visitor-kill-filter-trace-run",
    );

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::Trigger { trigger_id, payload }
            if trigger_id == "visitor_kill_marked_visitor"
                && payload["actor_filter"] == serde_json::json!(["visitor_kill_target"])
                && payload["source_actor"] == "slot_3"
                && payload["source_target"] == "slot_2"
    )));
    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
            if slot_id == "slot_3" && cause == "visitor_kill_marked_visitor"
    )));
    assert!(
        !output.applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
                if slot_id == "slot_1" && cause == "visitor_kill_marked_visitor"
        )),
        "unmarked visitor must not die to target-filtered visitor_kill"
    );
    assert!(
        output
            .trace
            .notes
            .iter()
            .any(|note| note == "trigger visitor_kill_marked_visitor emitted at event_index 2"),
        "ResolutionTrace should persist the target-filtered visitor_kill diagnostic note"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_night_generated_kill_cause_policy_before_trigger_fixpoint()
{
    let golden = load_golden("pgo_shoots_visitor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .generated_kill_cause_policy
        .remove("pgo_shoots_visitor");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing night generated kill cause policy must not use trigger modifiers");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid standard_nar generated kill cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains(
            "generated kill trigger `pgo_shoots_visitor` must declare generated kill cause policy"
        ),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_malformed_standard_nar_generated_kill_shape_before_trigger_fixpoint() {
    let golden = load_golden("pgo_shoots_visitor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .generated_kill_cause_policy
        .get_mut("pgo_shoots_visitor")
        .expect("pgo generated kill policy")
        .on = Some(TriggerOn::Ability(IrAbility::Kill));

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("mismatched generated kill shape must not enter trigger fixpoint");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid standard_nar generated kill cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("generated kill trigger `pgo_shoots_visitor` on must match trigger rule"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_malformed_standard_nar_generated_kill_cause_policy_before_trigger_fixpoint() {
    let golden = load_golden("pgo_shoots_visitor.json");
    let cases: Vec<(&str, fn(&mut Pack), &str)> = vec![
        (
            "empty generated kill trigger key",
            |pack| {
                pack.standard_nar.generated_kill_cause_policy.insert(
                    "".to_string(),
                    domain::pack::GeneratedKillCausePolicy {
                        on: Some(TriggerOn::Ability(IrAbility::Visit)),
                        actor: Some(ActorRef::Target),
                        target: Some(TargetRef::Actor),
                        strongman_bypasses_protect: false,
                    },
                );
            },
            "generated kill trigger id must not be empty",
        ),
        (
            "unknown generated kill trigger key",
            |pack| {
                pack.standard_nar.generated_kill_cause_policy.insert(
                    "phantom_generated_kill".to_string(),
                    domain::pack::GeneratedKillCausePolicy {
                        on: Some(TriggerOn::Ability(IrAbility::Visit)),
                        actor: Some(ActorRef::Target),
                        target: Some(TargetRef::Actor),
                        strongman_bypasses_protect: false,
                    },
                );
            },
            "unknown generated kill trigger `phantom_generated_kill`",
        ),
        (
            "Strongman flag mismatch",
            |pack| {
                pack.standard_nar
                    .generated_kill_cause_policy
                    .get_mut("pgo_shoots_visitor")
                    .expect("pgo generated kill policy")
                    .strongman_bypasses_protect = true;
            },
            "generated kill trigger `pgo_shoots_visitor` strongman_bypasses_protect must match produced Strongman modifier",
        ),
    ];

    for (case, mutate, detail) in cases {
        let mut pack = load_pack();
        mutate(&mut pack);
        let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
            .expect_err("{case} malformed generated kill cause policy unexpectedly resolved");
        let message = caught_panic_message(panic);
        assert!(
            message.contains("invalid standard_nar generated kill cause policy"),
            "{case}: unexpected panic message: {message}"
        );
        assert!(
            message.contains(detail),
            "{case}: unexpected panic message: {message}"
        );
    }
}

#[test]
fn resolver_rejects_missing_standard_nar_trigger_fixpoint_policy_source_before_trigger_fixpoint() {
    let golden = load_golden("pgo_shoots_visitor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .trigger_fixpoint_policy
        .remove("pgo_shoots_visitor");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing trigger fixpoint source policy must not silently skip trigger policy");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar trigger fixpoint policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains(
            "generated kill trigger `pgo_shoots_visitor` must declare trigger fixpoint policy"
        ),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_malformed_standard_nar_trigger_fixpoint_policy_before_trigger_fixpoint() {
    let golden = load_golden("pgo_shoots_visitor.json");
    let cases: Vec<(&str, fn(&mut Pack), &str)> = vec![
        (
            "empty trigger fixpoint source key",
            |pack| {
                pack.standard_nar.trigger_fixpoint_policy.insert(
                    "".to_string(),
                    domain::pack::TriggerFixpointPolicy {
                        on: Some(TriggerOn::Ability(IrAbility::Visit)),
                        produced_kill_reenters: true,
                        loop_cap: Some(TriggerLoopCapPolicy::RedirectLoopCap),
                        trace: true,
                    },
                );
            },
            "trigger fixpoint source id must not be empty",
        ),
        (
            "unknown trigger fixpoint source key",
            |pack| {
                pack.standard_nar.trigger_fixpoint_policy.insert(
                    "phantom_trigger_fixpoint".to_string(),
                    domain::pack::TriggerFixpointPolicy {
                        on: Some(TriggerOn::Ability(IrAbility::Visit)),
                        produced_kill_reenters: true,
                        loop_cap: Some(TriggerLoopCapPolicy::RedirectLoopCap),
                        trace: true,
                    },
                );
            },
            "unknown trigger fixpoint source `phantom_trigger_fixpoint`",
        ),
        (
            "produced kill re-entry disabled",
            |pack| {
                pack.standard_nar
                    .trigger_fixpoint_policy
                    .get_mut("pgo_shoots_visitor")
                    .expect("pgo trigger fixpoint policy")
                    .produced_kill_reenters = false;
            },
            "generated kill trigger `pgo_shoots_visitor` must declare produced_kill_reenters true",
        ),
    ];

    for (case, mutate, detail) in cases {
        let mut pack = load_pack();
        mutate(&mut pack);
        let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
            .expect_err("{case} malformed trigger fixpoint policy unexpectedly resolved");
        let message = caught_panic_message(panic);
        assert!(
            message.contains("invalid standard_nar trigger fixpoint policy"),
            "{case}: unexpected panic message: {message}"
        );
        assert!(
            message.contains(detail),
            "{case}: unexpected panic message: {message}"
        );
    }
}

#[test]
fn resolver_rejects_missing_standard_nar_generated_kill_protection_ownership_before_trigger_fixpoint(
) {
    let golden = load_golden("pgo_shoots_visitor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .protection_cause_policy
        .get_mut("doctor_protect")
        .expect("doctor protection cause policy")
        .blocks
        .retain(|cause| cause != "pgo_shoots_visitor");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing generated-kill protection ownership must not enter trigger fixpoint");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar generated kill ownership"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains(
            "generated kill trigger `pgo_shoots_visitor` is not owned by protection source `doctor_protect`"
        ),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_generated_kill_target_state_ownership_before_trigger_fixpoint(
) {
    let golden = load_golden("pgo_shoots_visitor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .target_state_save_policy
        .get_mut("bulletproof")
        .expect("bulletproof target-state save policy")
        .blocks
        .retain(|cause| cause != "pgo_shoots_visitor");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack)).expect_err(
        "missing generated-kill target-state ownership must not enter trigger fixpoint",
    );
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar generated kill ownership"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains(
            "generated kill trigger `pgo_shoots_visitor` is not owned by target-state save `bulletproof`"
        ),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_generated_kill_suppression_ownership_before_trigger_fixpoint(
) {
    let golden = load_golden("pgo_shoots_visitor.json");
    let mut pack = load_pack();
    pack.standard_nar
        .suppression_policy
        .get_mut("roleblocker_block")
        .expect("roleblocker suppression policy")
        .suppresses
        .retain(|action_id| action_id != "visit");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing generated-kill suppression ownership must not enter trigger fixpoint");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar generated kill ownership"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains(
            "generated kill trigger `pgo_shoots_visitor` feeder action `visit` is not owned by block source `roleblocker_block`"
        ),
        "unexpected panic message: {message}"
    );
}

#[test]
fn trace_records_protected_trigger_generated_kill() {
    let golden = load_golden("pgo_shoots_visitor.json");
    let mut input = golden["input"].clone();
    input["state"]["slots"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "slot_id": "slot_6",
            "role_key": "doctor",
            "alignment": "town",
            "status": "alive",
            "effects": []
        }));
    input["submissions"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "action_id": "doctor_protect_visitor",
            "actor": "slot_6",
            "template_id": "doctor_protect",
            "targets": ["slot_1"],
            "phase_id": "N01",
            "submitted_at": 2,
            "withdrawn": false,
            "metadata": {}
        }));

    let output = run_output(&input, load_pack(), "protected-pgo-trigger-trace-run");
    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::Trigger { trigger_id, .. } if trigger_id == "pgo_shoots_visitor"
    )));
    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerSaved { slot_id, reasons, sources }
            if slot_id == "slot_1"
                && reasons == &vec!["protected".to_string()]
                && sources == &vec!["slot_6".to_string()]
    )));
    assert!(
        !output.applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
                if slot_id == "slot_1" && cause == "pgo_shoots_visitor"
        )),
        "protected generated trigger kill must not kill the visitor"
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_prevented_by_protection"
                && decision.detail["cause"] == "pgo_shoots_visitor"
        })
        .expect("protected generated trigger kill should emit normal protect trace detail");
    assert_eq!(decision.stage, "kill_resolution");
    assert_eq!(decision.source, "cause:pgo_shoots_visitor");
    assert_eq!(decision.detail["target"], "slot_1");
    assert_eq!(decision.detail["attacker"], "slot_2");
    assert_eq!(decision.detail["unstoppable"], false);
    assert_eq!(decision.detail["protectors"][0]["protector"], "slot_6");
    assert_eq!(
        decision.detail["protectors"][0]["action_id"],
        "doctor_protect_visitor"
    );
    assert_eq!(
        decision.detail["protectors"][0]["template_id"],
        "doctor_protect"
    );
    let generated = output
        .trace
        .generated
        .iter()
        .find(|generated| {
            generated.source == "Trigger" && generated.action_id == "pgo_shoots_visitor"
        })
        .expect("PGO trigger should emit a generated trace row");
    assert_eq!(generated.actor, "slot_2");
    assert_eq!(generated.targets, vec!["slot_1".to_string()]);
    assert_eq!(generated.detail["on"], "Visit");
    assert_eq!(generated.detail["source_target"], "slot_2");
    assert_eq!(generated.detail["source_actor"], "slot_1");
    assert_eq!(generated.detail["source_cause"], "roleblocker_block");
    assert_eq!(generated.detail["produced_actor"], "slot_2");
    assert_eq!(generated.detail["produced_target"], "slot_1");
}

#[test]
fn golden_pgo_bodyguard_intercept() {
    let golden = load_golden("pgo_bodyguard_intercept.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "pgo_bodyguard_intercept");
}

#[test]
fn standard_nar_bodyguard_intercept_cause_is_pack_owned() {
    let golden = load_golden("pgo_bodyguard_intercept.json");
    let mut pack = load_pack();
    pack.standard_nar.intercept_cause_policy.insert(
        "bodyguard".to_string(),
        "pack_named_bodyguard_intercept".to_string(),
    );
    let output = run_output(
        &golden["input"],
        pack,
        "pgo-bodyguard-pack-owned-intercept-cause-run",
    );

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
            if slot_id == "slot_3" && cause == "factional_kill"
    )));
    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_prevented_by_protection"
                && decision.detail["cause"] == "pgo_shoots_visitor"
        })
        .expect("bodyguard-intercepted generated trigger kill should emit protect trace detail");
    assert_eq!(
        decision.detail["protectors"][0]["intercept_cause"],
        "pack_named_bodyguard_intercept"
    );
    let stacked = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_stacked_on_existing_death"
                && decision.detail["target"] == "slot_3"
        })
        .expect("pack-owned Bodyguard intercept cause should be preserved in stacked kill trace");
    assert_eq!(stacked.source, "cause:pack_named_bodyguard_intercept");
    assert_eq!(stacked.detail["cause"], "pack_named_bodyguard_intercept");
    assert_eq!(stacked.detail["existing_cause"], "factional_kill");
}

#[test]
fn resolver_rejects_missing_standard_nar_intercept_cause_policy_before_night_resolution() {
    let golden = load_golden("pgo_bodyguard_intercept.json");
    let mut pack = load_pack();
    pack.standard_nar.intercept_cause_policy.clear();

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing intercept cause policy must not silently drop intercept deaths");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid standard_nar intercept cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("intercept action `bodyguard` must declare intercept cause")
            || message.contains("intercept action `martyr_protect` must declare intercept cause"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_intercept_source_before_night_resolution() {
    let golden = load_golden("pgo_bodyguard_intercept.json");
    let mut pack = load_pack();
    pack.standard_nar.intercept_cause_policy.remove("bodyguard");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack)).expect_err(
        "missing bodyguard intercept cause policy must not silently drop intercept deaths",
    );
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar intercept cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("intercept action `bodyguard` must declare intercept cause"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_malformed_standard_nar_intercept_cause_policy_before_night_resolution() {
    let golden = load_golden("pgo_bodyguard_intercept.json");
    let cases: Vec<(&str, fn(&mut Pack), &str)> = vec![
        (
            "empty intercept source key",
            |pack| {
                pack.standard_nar
                    .intercept_cause_policy
                    .insert("".to_string(), "custom_intercept".to_string());
            },
            "intercept source id must not be empty",
        ),
        (
            "unknown intercept source key",
            |pack| {
                pack.standard_nar
                    .intercept_cause_policy
                    .insert("phase_intercept".to_string(), "custom_intercept".to_string());
            },
            "unknown intercept source `phase_intercept`",
        ),
        (
            "empty intercept cause",
            |pack| {
                pack.standard_nar
                    .intercept_cause_policy
                    .insert("bodyguard".to_string(), "".to_string());
            },
            "intercept action `bodyguard` must declare non-empty intercept cause",
        ),
        (
            "direct kill cause reused",
            |pack| {
                pack.standard_nar
                    .intercept_cause_policy
                    .insert("bodyguard".to_string(), "factional_kill".to_string());
            },
            "intercept action `bodyguard` cause `factional_kill` must not reuse a direct kill cause",
        ),
    ];

    for (case, mutate, detail) in cases {
        let mut pack = load_pack();
        mutate(&mut pack);
        let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
            .expect_err("{case} malformed intercept cause policy unexpectedly resolved");
        let message = caught_panic_message(panic);
        assert!(
            message.contains("invalid standard_nar intercept cause policy"),
            "{case}: unexpected panic message: {message}"
        );
        assert!(
            message.contains(detail),
            "{case}: unexpected panic message: {message}"
        );
    }
}

#[test]
fn trace_records_bodyguard_intercepting_trigger_generated_kill() {
    let golden = load_golden("pgo_bodyguard_intercept.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "pgo-bodyguard-intercept-trace-run",
    );

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::Trigger { trigger_id, .. } if trigger_id == "pgo_shoots_visitor"
    )));
    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerSaved { slot_id, reasons, sources }
            if slot_id == "slot_1"
                && reasons == &vec!["protected".to_string()]
                && sources == &vec!["slot_3".to_string()]
    )));
    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled {
            slot_id,
            cause,
            attackers,
            unstoppable,
            ..
        } if slot_id == "slot_3"
            && cause == "factional_kill"
            && attackers == &vec!["slot_5".to_string(), "slot_2".to_string()]
            && !*unstoppable
    )));
    assert!(
        !output.applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
                if slot_id == "slot_1" && cause == "pgo_shoots_visitor"
        )),
        "bodyguard-intercepted generated PGO kill must not kill the visitor"
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_prevented_by_protection"
                && decision.detail["cause"] == "pgo_shoots_visitor"
        })
        .expect("bodyguard-intercepted generated trigger kill should emit protect trace detail");
    assert_eq!(decision.stage, "kill_resolution");
    assert_eq!(decision.source, "cause:pgo_shoots_visitor");
    assert_eq!(decision.detail["target"], "slot_1");
    assert_eq!(decision.detail["attacker"], "slot_2");
    assert_eq!(decision.detail["unstoppable"], false);
    assert_eq!(decision.detail["protectors"][0]["protector"], "slot_3");
    assert_eq!(
        decision.detail["protectors"][0]["action_id"],
        "bodyguard_001"
    );
    assert_eq!(decision.detail["protectors"][0]["template_id"], "bodyguard");
    assert_eq!(decision.detail["protectors"][0]["intercepts"], true);

    let stacked = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_stacked_on_existing_death"
                && decision.detail["target"] == "slot_3"
        })
        .expect("bodyguard intercept should merge into the bodyguard's existing death");
    assert_eq!(stacked.stage, "kill_resolution");
    assert_eq!(stacked.source, "cause:bodyguard_intercept");
    assert_eq!(stacked.detail["attacker"], "slot_2");
    assert_eq!(stacked.detail["cause"], "bodyguard_intercept");
    assert_eq!(stacked.detail["existing_cause"], "factional_kill");
    assert_eq!(
        stacked.detail["merged_attackers"],
        serde_json::json!(["slot_5", "slot_2"])
    );
}

#[test]
fn golden_cupid_links_lovers() {
    let golden = load_golden("cupid_links_lovers.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "cupid_links_lovers");
}

#[test]
fn golden_lover_suicide_on_partner_death() {
    let golden = load_golden("lover_suicide_on_partner_death.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "lover_suicide_on_partner_death",
    );
}

#[test]
fn golden_lover_suicide_stacks_with_direct_death() {
    let golden = load_golden("lover_suicide_stacks_with_direct_death.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "lover_suicide_stacks_with_direct_death",
    );
}

#[test]
fn trace_records_lover_suicide_cascade() {
    let golden = load_golden("lover_suicide_on_partner_death.json");
    let output = run_output(&golden["input"], load_pack(), "lover-suicide-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "lover_suicide")
        .expect("lover suicide should emit generated-death trace attribution");
    assert_eq!(decision.stage, "death:cascade");
    assert_eq!(decision.source, "link:link_001");
    assert_eq!(decision.detail["link_id"], "link_001");
    assert_eq!(decision.detail["link_source"], "slot_6");
    assert_eq!(decision.detail["source_dead"], "slot_2");
    assert_eq!(decision.detail["target"], "slot_3");
    assert_eq!(decision.detail["cause"], "lover_suicide");
    assert_eq!(decision.detail["linked_slots"][0], "slot_2");
    assert_eq!(decision.detail["linked_slots"][1], "slot_3");
}

#[test]
fn trace_records_lover_suicide_stack_with_direct_death() {
    let golden = load_golden("lover_suicide_stacks_with_direct_death.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "lover-suicide-stacked-trace-run",
    );

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled {
            slot_id,
            cause,
            attackers,
            unstoppable,
            ..
        } if slot_id == "slot_3"
            && cause == "factional_kill"
            && attackers == &vec!["slot_5".to_string(), "slot_2".to_string()]
            && *unstoppable
    )));
    assert!(
        !output.applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
                if slot_id == "slot_3" && cause == "lover_suicide"
        )),
        "lover suicide must stack onto the direct death instead of adding a second kill event"
    );

    let cascade = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "lover_suicide")
        .expect("lover suicide should still emit cascade trace attribution");
    assert_eq!(cascade.stage, "death:cascade");
    assert_eq!(cascade.source, "link:link_002");
    assert_eq!(cascade.detail["link_id"], "link_002");
    assert_eq!(cascade.detail["link_source"], "slot_6");
    assert_eq!(cascade.detail["source_dead"], "slot_2");
    assert_eq!(cascade.detail["target"], "slot_3");
    assert_eq!(cascade.detail["cause"], "lover_suicide");

    let stacked = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_stacked_on_existing_death"
                && decision.detail["target"] == "slot_3"
        })
        .expect("lover suicide should merge into the existing direct death");
    assert_eq!(stacked.stage, "kill_resolution");
    assert_eq!(stacked.source, "cause:lover_suicide");
    assert_eq!(stacked.detail["attacker"], "slot_2");
    assert_eq!(stacked.detail["cause"], "lover_suicide");
    assert_eq!(stacked.detail["existing_cause"], "factional_kill");
    assert_eq!(stacked.detail["unstoppable"], true);
    assert_eq!(
        stacked.detail["merged_attackers"],
        serde_json::json!(["slot_5", "slot_2"])
    );
}

#[test]
fn golden_hunter_arms_retaliation() {
    let golden = load_golden("hunter_arms_retaliation.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "hunter_arms_retaliation");
}

#[test]
fn golden_hunter_retaliates_on_death() {
    let golden = load_golden("hunter_retaliates_on_death.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "hunter_retaliates_on_death",
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_chosen_retaliation_cause_policy_before_retaliation() {
    let golden = load_golden("hunter_retaliates_on_death.json");
    let mut pack = load_pack();
    pack.standard_nar
        .chosen_retaliation_cause_policy
        .remove("hunter_retaliate");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing chosen retaliation cause policy must not consume folded state");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid standard_nar chosen retaliation cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains(
            "Retaliate action `hunter_retaliate` must declare chosen retaliation cause policy"
        ),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_malformed_standard_nar_chosen_retaliation_cause_policy_before_retaliation() {
    let golden = load_golden("hunter_retaliates_on_death.json");
    let cases: Vec<(&str, fn(&mut Pack), &str)> = vec![
        (
            "empty Retaliate source key",
            |pack| {
                pack.standard_nar.chosen_retaliation_cause_policy.insert(
                    "".to_string(),
                    domain::pack::GeneratedKillCausePolicy {
                        on: None,
                        actor: None,
                        target: None,
                        strongman_bypasses_protect: false,
                    },
                );
            },
            "Retaliate source id must not be empty",
        ),
        (
            "unknown Retaliate source key",
            |pack| {
                pack.standard_nar.chosen_retaliation_cause_policy.insert(
                    "phase_retaliate".to_string(),
                    domain::pack::GeneratedKillCausePolicy {
                        on: None,
                        actor: None,
                        target: None,
                        strongman_bypasses_protect: false,
                    },
                );
            },
            "unknown Retaliate action `phase_retaliate`",
        ),
        (
            "Strongman flag mismatch",
            |pack| {
                pack.standard_nar
                    .chosen_retaliation_cause_policy
                    .get_mut("hunter_retaliate")
                    .expect("mafiascum declares hunter retaliation policy")
                    .strongman_bypasses_protect = true;
            },
            "Retaliate action `hunter_retaliate` strongman_bypasses_protect must match Strongman modifier",
        ),
    ];

    for (case, mutate, detail) in cases {
        let mut pack = load_pack();
        mutate(&mut pack);
        let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
            .expect_err("{case} malformed chosen retaliation cause policy unexpectedly resolved");
        let message = caught_panic_message(panic);
        assert!(
            message.contains("invalid standard_nar chosen retaliation cause policy"),
            "{case}: unexpected panic message: {message}"
        );
        assert!(
            message.contains(detail),
            "{case}: unexpected panic message: {message}"
        );
    }
}

#[test]
fn golden_hider_untargetable_behind_town() {
    let golden = load_golden("hider_untargetable_behind_town.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "hider_untargetable_behind_town",
    );
}

#[test]
fn golden_hider_dies_when_host_dies() {
    let golden = load_golden("hider_dies_when_host_dies.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "hider_dies_when_host_dies");
}

#[test]
fn golden_hider_dependency_stacks_with_direct_death() {
    let golden = load_golden("hider_dependency_stacks_with_direct_death.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "hider_dependency_stacks_with_direct_death",
    );
}

#[test]
fn standard_nar_hider_dependency_cause_is_pack_owned() {
    let golden = load_golden("hider_dies_when_host_dies.json");
    let mut pack = load_pack();
    pack.standard_nar.hide_dependency_cause_policy.insert(
        "hide".to_string(),
        "pack_named_hider_dependency".to_string(),
    );
    let output = run_output(
        &golden["input"],
        pack,
        "hider-pack-owned-dependency-cause-run",
    );

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
            if slot_id == "slot_2" && cause == "pack_named_hider_dependency"
    )));
    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "hider_dependency_death")
        .expect("hider dependency should emit a death attribution trace decision");
    assert_eq!(decision.detail["template_id"], "hide");
    assert_eq!(decision.detail["cause"], "pack_named_hider_dependency");
}

#[test]
fn resolver_rejects_missing_standard_nar_hide_dependency_cause_policy_before_night_resolution() {
    let golden = load_golden("hider_dies_when_host_dies.json");
    let mut pack = load_pack();
    pack.standard_nar.hide_dependency_cause_policy.clear();

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing hide dependency cause policy must not silently use action ids");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid standard_nar hide dependency cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("hide dependency action `hide` must declare dependency cause"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_missing_standard_nar_hide_dependency_source_before_night_resolution() {
    let golden = load_golden("hider_dies_when_host_dies.json");
    let mut pack = load_pack();
    pack.standard_nar
        .hide_dependency_cause_policy
        .remove("hide");

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("missing hide dependency source policy must not silently use action ids");
    let message = caught_panic_message(panic);
    assert!(
        message.contains("invalid standard_nar hide dependency cause policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("hide dependency action `hide` must declare dependency cause"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn resolver_rejects_malformed_standard_nar_hide_dependency_cause_policy_before_night_resolution() {
    let golden = load_golden("hider_dies_when_host_dies.json");
    let cases: Vec<(&str, fn(&mut Pack), &str)> = vec![
        (
            "empty hide dependency source key",
            |pack| {
                pack.standard_nar
                    .hide_dependency_cause_policy
                    .insert("".to_string(), "custom_hide_dependency".to_string());
            },
            "hide dependency source id must not be empty",
        ),
        (
            "unknown hide dependency source key",
            |pack| {
                pack.standard_nar.hide_dependency_cause_policy.insert(
                    "phase_hide".to_string(),
                    "custom_hide_dependency".to_string(),
                );
            },
            "unknown hide dependency source `phase_hide`",
        ),
        (
            "empty hide dependency cause",
            |pack| {
                pack.standard_nar
                    .hide_dependency_cause_policy
                    .insert("hide".to_string(), "".to_string());
            },
            "hide dependency action `hide` must declare non-empty dependency cause",
        ),
        (
            "direct kill cause reused",
            |pack| {
                pack.standard_nar
                    .hide_dependency_cause_policy
                    .insert("hide".to_string(), "factional_kill".to_string());
            },
            "hide dependency action `hide` cause `factional_kill` must not reuse a direct kill cause",
        ),
    ];

    for (case, mutate, detail) in cases {
        let mut pack = load_pack();
        mutate(&mut pack);
        let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
            .expect_err("{case} malformed hide dependency cause policy unexpectedly resolved");
        let message = caught_panic_message(panic);
        assert!(
            message.contains("invalid standard_nar hide dependency cause policy"),
            "{case}: unexpected panic message: {message}"
        );
        assert!(
            message.contains(detail),
            "{case}: unexpected panic message: {message}"
        );
    }
}

#[test]
fn trace_records_hider_dependency_death() {
    let golden = load_golden("hider_dies_when_host_dies.json");
    let output = run_output(&golden["input"], load_pack(), "hider-dependency-trace-run");

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "hider_dependency_death")
        .expect("hider dependency should emit a death attribution trace decision");
    assert_eq!(decision.stage, "night:dependency_death");
    assert_eq!(decision.source, "action:hide_001");
    assert_eq!(decision.detail["action_id"], "hide_001");
    assert_eq!(decision.detail["template_id"], "hide");
    assert_eq!(decision.detail["host"], "slot_3");
    assert_eq!(decision.detail["hider"], "slot_2");
    assert_eq!(decision.detail["cause"], "hide");
    assert_eq!(decision.detail["attackers"][0], "slot_3");
}

#[test]
fn trace_records_hider_dependency_stack_with_direct_death() {
    let golden = load_golden("hider_dependency_stacks_with_direct_death.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "hider-dependency-stack-trace-run",
    );

    let dependency = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "hider_dependency_death")
        .expect("raced hider dependency should still emit dependency attribution");
    assert_eq!(dependency.stage, "night:dependency_death");
    assert_eq!(dependency.source, "action:hide_behind_mafia_001");
    assert_eq!(dependency.detail["action_id"], "hide_behind_mafia_001");
    assert_eq!(dependency.detail["template_id"], "hide");
    assert_eq!(dependency.detail["host"], "slot_3");
    assert_eq!(dependency.detail["hider"], "slot_2");
    assert_eq!(dependency.detail["cause"], "hide");
    assert_eq!(dependency.detail["attackers"][0], "slot_3");

    let stacked = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_stacked_on_existing_death"
                && decision.detail["target"] == "slot_2"
        })
        .expect("hider dependency should merge into the direct hider death");
    assert_eq!(stacked.stage, "kill_resolution");
    assert_eq!(stacked.source, "cause:hide");
    assert_eq!(stacked.detail["attacker"], "slot_3");
    assert_eq!(stacked.detail["cause"], "hide");
    assert_eq!(stacked.detail["existing_cause"], "factional_kill");
    assert_eq!(stacked.detail["unstoppable"], true);
    assert_eq!(
        stacked.detail["merged_attackers"],
        serde_json::json!(["slot_1", "slot_3"])
    );
}

#[test]
fn golden_day_vote_tiebreak() {
    let golden = load_golden("day_vote_tiebreak.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "day_vote_tiebreak");
}

#[test]
fn golden_reveal_town_day() {
    let golden = load_golden("reveal_town_day.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "reveal_town_day");
}

#[test]
fn golden_gladiator_vote_duel() {
    let golden = load_golden("gladiator_vote_duel.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "gladiator_vote_duel");
}

#[test]
fn golden_hero_instigator_kill_on_vote_duel() {
    let golden = load_golden("hero_instigator_kill_on_vote_duel.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "hero_instigator_kill_on_vote_duel",
    );
}

#[test]
fn golden_gladiator_vote_duel_no_ballots() {
    let golden = load_golden("gladiator_vote_duel_no_ballots.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "gladiator_vote_duel_no_ballots",
    );
}

#[test]
fn golden_gladiator_vote_duel_tied_ballots() {
    let golden = load_golden("gladiator_vote_duel_tied_ballots.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "gladiator_vote_duel_tied_ballots",
    );
}

#[test]
fn golden_day_self_destruct_trade() {
    let golden = load_golden("day_self_destruct_trade.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "day_self_destruct_trade");
}

#[test]
fn golden_day_vigilante_kill_before_vote() {
    let golden = load_golden("day_vigilante_kill_before_vote.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "day_vigilante_kill_before_vote",
    );
}

#[test]
fn golden_day_action_kill_triggers_post_announcement_win() {
    let golden = load_golden("day_action_kill_triggers_post_announcement_win.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "day_action_kill_triggers_post_announcement_win",
    );
}

#[test]
fn golden_white_wolf_king_day_self_destruct() {
    let golden = load_golden("white_wolf_king_day_self_destruct.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "white_wolf_king_day_self_destruct",
    );
}

#[test]
fn golden_twilight_self_destruct_window() {
    let golden = load_golden_in("test_twilight_window", "twilight_self_destruct.json");
    let got = run(&golden["input"], load_pack_named("test_twilight_window"));
    assert!(
        got.iter()
            .all(|event| event_kind(event) != "DayVoteOutcome"),
        "Twilight resolution must not run ordinary day-vote tallying: {got:#?}"
    );
    assert_events_eq(&got, &expected_events(&golden), "twilight_self_destruct");
}

#[test]
fn golden_instant_self_destruct_window() {
    let golden = load_golden_in("test_instant_window", "instant_self_destruct.json");
    let got = run_instant(&golden["input"], load_pack_named("test_instant_window"));
    assert!(
        got.iter()
            .all(|event| event_kind(event) != "DayVoteOutcome"),
        "Instant resolution must not run ordinary day-vote tallying: {got:#?}"
    );
    assert_events_eq(&got, &expected_events(&golden), "instant_self_destruct");
}

#[test]
fn golden_governor_veto_cancels_lynch() {
    let golden = load_golden("governor_veto_cancels_lynch.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "governor_veto_cancels_lynch",
    );
}

#[test]
fn trace_records_no_majority_revote_prompt() {
    let golden = load_golden("day_vote_tiebreak.json");
    let output = run_output(
        &golden["input"],
        load_pack(),
        "no-majority-revote-prompt-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "host_prompt_issued"
                && decision.detail["policy"] == "no_majority_revote"
        })
        .expect("NoMajority should emit a revote host-prompt trace decision");
    assert_eq!(decision.stage, "day:vote_prompt");
    assert_eq!(decision.source, "day_vote");
    assert_eq!(decision.detail["prompt_id"], "D01:revote:NoMajority");
    assert_eq!(decision.detail["kind"], "revote");
    assert_eq!(decision.detail["subject"], serde_json::Value::Null);
    assert_eq!(decision.detail["reason"], "no_majority");
    assert_eq!(decision.detail["status"], "NoMajority");
    assert_eq!(
        decision.detail["contenders"],
        serde_json::json!(["slot_2", "slot_3"])
    );
}

#[test]
fn golden_day_vote_weighted_roles() {
    let golden = load_golden("day_vote_weighted_roles.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "day_vote_weighted_roles");
}

#[test]
fn golden_day_vote_triplevoter_weighted_role() {
    let golden = load_golden("day_vote_triplevoter_weighted_role.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "day_vote_triplevoter_weighted_role",
    );
}

#[test]
fn golden_day_vote_x_voter_weight() {
    let golden = load_golden("day_vote_x_voter_weight.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "day_vote_x_voter_weight");
}

#[test]
fn golden_dynamic_vote_effect_weight() {
    let golden = load_golden_in(
        "test_dynamic_vote_effect",
        "dynamic_vote_effect_weight.json",
    );
    let got = run(
        &golden["input"],
        load_pack_named("test_dynamic_vote_effect"),
    );
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "dynamic_vote_effect_weight",
    );
}

#[test]
fn golden_dynamic_vote_effect_mark_action() {
    let golden = load_golden_in(
        "test_dynamic_vote_effect",
        "dynamic_vote_effect_mark_action.json",
    );
    let got = run(
        &golden["input"],
        load_pack_named("test_dynamic_vote_effect"),
    );
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "dynamic_vote_effect_mark_action",
    );
}

#[test]
fn golden_dynamic_vote_grant_action() {
    let golden = load_golden_in("test_dynamic_vote_effect", "dynamic_vote_grant_action.json");
    let got = run(
        &golden["input"],
        load_pack_named("test_dynamic_vote_effect"),
    );
    assert_events_eq(&got, &expected_events(&golden), "dynamic_vote_grant_action");
}

#[test]
fn golden_dynamic_vote_grant_weight() {
    let golden = load_golden_in("test_dynamic_vote_effect", "dynamic_vote_grant_weight.json");
    let got = run(
        &golden["input"],
        load_pack_named("test_dynamic_vote_effect"),
    );
    assert_events_eq(&got, &expected_events(&golden), "dynamic_vote_grant_weight");
}

#[test]
fn golden_dynamic_vote_grant_hammer() {
    let golden = load_golden_in("test_dynamic_vote_hammer", "dynamic_vote_grant_hammer.json");
    let got = run(
        &golden["input"],
        load_pack_named("test_dynamic_vote_hammer"),
    );
    assert_events_eq(&got, &expected_events(&golden), "dynamic_vote_grant_hammer");
}

#[test]
fn golden_dynamic_vote_grant_no_majority_prompt() {
    let golden = load_golden_in(
        "test_dynamic_vote_prompt",
        "dynamic_vote_grant_no_majority_prompt.json",
    );
    let got = run(
        &golden["input"],
        load_pack_named("test_dynamic_vote_prompt"),
    );
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "dynamic_vote_grant_no_majority_prompt",
    );
}

#[test]
fn golden_dynamic_vote_grant_pk_tie_prompt() {
    let golden = load_golden_in(
        "test_dynamic_vote_pk",
        "dynamic_vote_grant_pk_tie_prompt.json",
    );
    let got = run(&golden["input"], load_pack_named("test_dynamic_vote_pk"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "dynamic_vote_grant_pk_tie_prompt",
    );
}

#[test]
fn golden_day_vote_loved_threshold() {
    let golden = load_golden("day_vote_loved_threshold.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "day_vote_loved_threshold");
}

#[test]
fn golden_day_vote_hated_threshold() {
    let golden = load_golden("day_vote_hated_threshold.json");
    let got = run(&golden["input"], load_pack());
    assert_events_eq(&got, &expected_events(&golden), "day_vote_hated_threshold");
}

// ───────────────────────── epicmafia (Phase 3.5b) ─────────────────────────

#[test]
fn epicmafia_pack_deserializes() {
    let pack = load_pack_named("epicmafia");
    assert_eq!(pack.name, "epicmafia");
    assert_eq!(pack.ir_version, 46);
    assert!(pack.roles.contains_key("bomb"));
    assert!(pack.roles.contains_key("cult_leader"));
    assert!(pack.roles.contains_key("arsonist"));
    assert_eq!(pack.triggers.len(), 1);
    assert_eq!(pack.triggers[0].id, "bomb_retaliates");
    assert_eq!(pack.day_vote_prompt_policies.len(), 1);
    assert_eq!(pack.day_vote_prompt_policies[0].id, "pk_host_decides_tie");
    assert_eq!(pack.day_vote_prompt_policies[0].prompt_kind, "pk");
    assert_eq!(pack.host_prompt_resolution_effects.len(), 1);
    assert_eq!(
        pack.host_prompt_resolution_effects[0].id,
        "pk_host_decides_tie"
    );
    assert_eq!(pack.host_prompt_resolution_effects[0].prompt_kind, "pk");
    // Round-trips losslessly (incl. the new effect/reads_effect action fields).
    let v = serde_json::to_value(&pack).expect("serialize epicmafia pack");
    let back: Pack = serde_json::from_value(v).expect("re-deserialize epicmafia pack");
    assert_eq!(back.roles.len(), pack.roles.len());
}

#[test]
fn chinese_structured_pack_deserializes() {
    let pack = load_pack_named("chinese_structured");
    assert_eq!(pack.name, "chinese_structured");
    assert_eq!(pack.ir_version, 46);
    assert!(pack.roles.contains_key("knight"));
    assert!(pack.roles.contains_key("wolf"));
    assert!(pack.roles.contains_key("wolf_beauty"));
    assert!(pack.roles.contains_key("witch"));
    assert!(pack.roles.contains_key("guard"));
    assert!(pack.roles.contains_key("hunter"));
    assert!(pack.roles.contains_key("idiot"));
    assert!(pack.roles.contains_key("cupid"));
    assert!(pack.roles.contains_key("prophet"));
    assert!(pack.roles.contains_key("white_wolf_king"));
    assert!(pack.roles.contains_key("white_wolf_carry"));
    assert!(pack.roles.contains_key("sheriff_badge_helper"));
    let wolf_kill = pack.roles["wolf"]
        .actions
        .iter()
        .find(|action| action.id == "wolf_night_kill")
        .expect("Chinese wolf exposes canonical wolf_night_kill");
    assert!(
        wolf_kill
            .source_ids
            .iter()
            .any(|source_id| source_id == "night_kill"),
        "Chinese wolf_night_kill should cover im-human night_kill"
    );
    let white_wolf_king_kill = pack.roles["white_wolf_king"]
        .actions
        .iter()
        .find(|action| action.id == "wolf_night_kill")
        .expect("Chinese White Wolf King exposes canonical wolf_night_kill");
    assert!(
        white_wolf_king_kill
            .source_ids
            .iter()
            .any(|source_id| source_id == "night_kill"),
        "Chinese White Wolf King wolf_night_kill should cover im-human night_kill"
    );
    assert_eq!(pack.investigation_results.parity.town, "good");
    assert_eq!(pack.investigation_results.parity.non_town, "evil");
    assert!(pack.wolf_carry.enabled);
    assert!(pack.wolf_beauty.enabled);
    assert!(pack.guard_policy.enabled);
    assert!(pack.faction_actions.enabled);
    let wolf_faction_action = pack
        .faction_actions
        .actions
        .iter()
        .find(|action| action.action_id == "wolf_night_kill")
        .expect("Chinese wolf_night_kill declares faction coordination");
    assert_eq!(wolf_faction_action.alignment, "wolf");
    assert_eq!(wolf_faction_action.max_resolved_submissions, 1);
    assert_eq!(
        wolf_faction_action.target_tie,
        domain::pack::FactionVoteTieBreaker::BlockAll
    );
    assert!(pack.death_retaliation.enabled);
    assert!(pack.idiot_policy.enabled);
    assert!(pack.lover_policy.enabled);
    assert_eq!(pack.lover_policy.link_effect, "lovers_link");
    assert_eq!(
        pack.lover_policy.source_helper_role.as_deref(),
        Some("lovers_helper")
    );
    let v = serde_json::to_value(&pack).expect("serialize chinese_structured pack");
    let back: Pack = serde_json::from_value(v).expect("re-deserialize chinese_structured pack");
    assert_eq!(back.roles.len(), pack.roles.len());
}

#[test]
fn mafia_universe_pack_deserializes() {
    let pack = load_pack_named("mafia_universe");
    assert_eq!(pack.name, "mafia_universe");
    assert_eq!(pack.ir_version, 60);
    assert!(pack.roles.contains_key("town_ita_shooter"));
    assert!(pack.roles.contains_key("town_ita_sharpshooter"));
    assert!(pack.roles.contains_key("town_ita_bad_shot"));
    assert!(pack.roles.contains_key("mafia_ita_evasive"));
    assert!(pack.roles.contains_key("mafia_ita_shielded"));
    assert!(pack.roles.contains_key("mafia_ita_evasive_shielded"));
    let lover = pack.roles.get("lover").expect("Mafia Universe Lover role");
    assert_eq!(lover.alignment.as_deref(), None);
    assert!(lover.actions.is_empty());
    assert!(lover.effects.is_empty());
    let mafia_bomber = pack
        .roles
        .get("mafia_bomber")
        .expect("Mafia Universe Mafia Bomber role");
    assert_eq!(mafia_bomber.alignment.as_deref(), Some("mafia"));
    assert!(mafia_bomber.actions.is_empty());
    assert_eq!(mafia_bomber.effects, vec!["bomb".to_string()]);
    let town_bomber = pack
        .roles
        .get("town_bomber")
        .expect("Mafia Universe Town Bomber role");
    assert_eq!(town_bomber.alignment.as_deref(), Some("town"));
    assert!(town_bomber.actions.is_empty());
    assert_eq!(town_bomber.effects, vec!["bomb".to_string()]);
    let mason = pack.roles.get("mason").expect("Mafia Universe Mason role");
    assert_eq!(mason.alignment.as_deref(), Some("town"));
    assert!(mason.actions.is_empty());
    assert!(mason.effects.is_empty());
    let neighbor = pack
        .roles
        .get("neighbor")
        .expect("Mafia Universe Neighbor role");
    assert_eq!(neighbor.alignment.as_deref(), None);
    assert!(neighbor.actions.is_empty());
    assert!(neighbor.effects.is_empty());
    assert!(pack.private_channels.enabled);
    assert!(pack.private_channels.groups.iter().any(|group| {
        group.id == "mason"
            && group.kind == domain::pack::PrivateChannelKind::Mason
            && group.roles == vec!["mason".to_string()]
            && group.reveals_alignment == domain::pack::PrivateChannelAlignmentReveal::Town
    }));
    assert!(pack.private_channels.groups.iter().any(|group| {
        group.id == "neighbor"
            && group.kind == domain::pack::PrivateChannelKind::Neighbor
            && group.roles == vec!["neighbor".to_string()]
            && group.reveals_alignment == domain::pack::PrivateChannelAlignmentReveal::None
    }));
    assert!(pack.effects.contains_key("bomb"));
    assert!(pack.triggers.iter().any(|trigger| {
        trigger.id == "bomb_retaliates"
            && trigger.on == domain::pack::TriggerOn::Ability(domain::IrAbility::Kill)
            && trigger.if_target_has == vec!["bomb".to_string()]
            && trigger.produces.ability == domain::IrAbility::Kill
    }));
    assert!(pack.lover_policy.enabled);
    assert_eq!(pack.lover_policy.link_effect, "lovers_link");
    assert_eq!(pack.lover_policy.suicide_cause, "lover_suicide");
    assert!(pack.roles.contains_key("town_fruit_vendor"));
    assert!(pack.roles.contains_key("mafia_fruit_vendor"));
    assert!(pack.roles.contains_key("town_night_desperado"));
    assert!(pack.roles.contains_key("mafia_night_desperado"));
    assert!(pack.roles.contains_key("town_vigilante"));
    assert!(pack.roles.contains_key("mafia_vigilante"));
    assert!(pack
        .ita
        .modifier_components
        .contains_key("better_ita_chance"));
    assert!(pack.ita.modifier_components.contains_key("one_ita_shield"));
    assert_eq!(
        pack.ita
            .role_modifier_refs
            .get("mafia_ita_evasive_shielded"),
        Some(&vec![
            "percent_ita_vulnerability".to_string(),
            "one_ita_shield".to_string()
        ])
    );
    assert!(pack.roles.contains_key("town_treestump"));
    assert!(pack.roles.contains_key("mafia_treestump"));
    assert!(pack.roles.contains_key("town_doctor"));
    assert!(pack.roles.contains_key("town_bodyguard"));
    assert!(pack.roles.contains_key("town_martyr"));
    assert!(pack.roles.contains_key("town_cpr_doctor"));
    assert!(pack.roles.contains_key("town_cop"));
    assert!(pack.roles.contains_key("town_parity_cop"));
    assert!(pack.roles.contains_key("town_vanilla_cop"));
    assert!(pack.roles.contains_key("town_neapolitan"));
    assert!(pack.roles.contains_key("town_gunsmith"));
    assert!(pack.roles.contains_key("town_role_cop"));
    assert!(pack.roles.contains_key("town_full_cop"));
    assert!(pack.roles.contains_key("town_framer"));
    assert!(pack.roles.contains_key("town_tracker"));
    assert!(pack.roles.contains_key("town_watcher"));
    assert!(pack.roles.contains_key("town_motion_detector"));
    assert!(pack.roles.contains_key("town_bus_driver"));
    assert!(pack.roles.contains_key("town_redirector"));
    assert!(pack.roles.contains_key("town_commuter"));
    assert!(pack.roles.contains_key("town_rolestopper"));
    assert!(pack.roles.contains_key("miller"));
    assert!(pack.roles.contains_key("town_roleblocker"));
    assert!(pack.roles.contains_key("town_jack_of_all_trades"));
    assert!(pack.roles.contains_key("town_jailkeeper"));
    assert!(pack.roles.contains_key("town_poisoner"));
    assert!(pack.roles.contains_key("town_poison_doctor"));
    assert!(pack.roles.contains_key("town_healer"));
    assert!(pack.roles.contains_key("town_arsonist"));
    assert!(pack.roles.contains_key("town_firefighter"));
    assert!(pack.roles.contains_key("town_firefighter_preempt"));
    assert!(pack.roles.contains_key("town_motivator"));
    assert!(pack.roles.contains_key("town_inventor"));
    assert!(pack.roles.contains_key("innocent_child"));
    let town_strongman = pack
        .roles
        .get("town_strongman")
        .expect("Mafia Universe Town Strongman role");
    assert_eq!(town_strongman.alignment.as_deref(), Some("town"));
    let town_strongman_kill = town_strongman
        .actions
        .iter()
        .find(|action| action.id == "strongman_kill")
        .expect("Town Strongman exposes strongman_kill");
    assert_eq!(town_strongman_kill.ability, domain::IrAbility::Kill);
    assert!(town_strongman_kill
        .modifiers
        .contains(&domain::Modifier::Strongman));
    assert!(pack.roles.contains_key("mafia_strongman"));
    assert!(pack.roles.contains_key("godfather"));
    assert!(pack.roles.contains_key("mafia_parity_cop"));
    assert!(pack.roles.contains_key("mafia_framer"));
    assert!(pack.roles.contains_key("mafia_vanilla_cop"));
    assert!(pack.roles.contains_key("mafia_neapolitan"));
    assert!(pack.roles.contains_key("mafia_gunsmith"));
    assert!(pack.roles.contains_key("mafia_role_cop"));
    assert!(pack.roles.contains_key("mafia_full_cop"));
    assert!(pack.roles.contains_key("mafia_tracker"));
    assert!(pack.roles.contains_key("mafia_watcher"));
    assert!(pack.roles.contains_key("mafia_motion_detector"));
    assert!(pack.roles.contains_key("mafia_bus_driver"));
    assert!(pack.roles.contains_key("mafia_redirector"));
    assert!(pack.roles.contains_key("mafia_commuter"));
    assert!(pack.roles.contains_key("mafia_rolestopper"));
    assert!(pack.roles.contains_key("mafia_roleblocker"));
    assert!(pack.roles.contains_key("mafia_jack_of_all_trades"));
    assert!(pack.roles.contains_key("mafia_poisoner"));
    assert!(pack.roles.contains_key("mafia_poison_doctor"));
    assert!(pack.roles.contains_key("mafia_healer"));
    assert!(pack.roles.contains_key("mafia_arsonist"));
    assert!(pack.roles.contains_key("mafia_firefighter"));
    assert!(pack.roles.contains_key("mafia_motivator"));
    assert!(pack.roles.contains_key("mafia_inventor"));
    assert_eq!(
        pack.investigation_overrides
            .as_ref()
            .and_then(|overrides| overrides.get("framed"))
            .and_then(|override_rule| override_rule.by_mode.get(&domain::InvestigateMode::Parity))
            .map(String::as_str),
        Some("scum")
    );
    assert_eq!(
        pack.investigation_overrides
            .as_ref()
            .and_then(|overrides| overrides.get("godfather"))
            .and_then(|override_rule| override_rule.by_mode.get(&domain::InvestigateMode::Parity))
            .map(String::as_str),
        Some("town")
    );
    assert_eq!(
        pack.investigation_overrides
            .as_ref()
            .and_then(|overrides| overrides.get("miller"))
            .and_then(|override_rule| override_rule.by_mode.get(&domain::InvestigateMode::Parity))
            .map(String::as_str),
        Some("scum")
    );
    assert!(pack.standard_nar.enabled);
    assert!(pack
        .standard_nar
        .kill_cause_ids
        .contains(&"factional_kill".to_string()));
    assert!(pack
        .standard_nar
        .kill_cause_ids
        .contains(&"strongman_kill".to_string()));
    assert_eq!(pack.ita.sessions.len(), 1);
    assert!(pack.day_notes.announcements.enabled);
    assert!(pack.day_notes.last_words.day_deaths);
    assert!(pack.treestump_policy.enabled);
    let v = serde_json::to_value(&pack).expect("serialize mafia_universe pack");
    let back: Pack = serde_json::from_value(v).expect("re-deserialize mafia_universe pack");
    assert_eq!(back.roles.len(), pack.roles.len());
}

#[test]
fn default_open_pack_deserializes() {
    let pack = load_pack_named("default_open");
    assert_eq!(pack.name, "default_open");
    assert_eq!(pack.ir_version, 46);
    assert!(pack.roles.contains_key("citizen"));
    assert!(pack.roles.contains_key("guardian"));
    assert!(pack.roles.contains_key("seer"));
    assert!(pack.roles.contains_key("agent"));
    let v = serde_json::to_value(&pack).expect("serialize default_open pack");
    let back: Pack = serde_json::from_value(v).expect("re-deserialize default_open pack");
    assert_eq!(back.roles.len(), pack.roles.len());
}

#[test]
fn golden_default_open_guardian_seer_night() {
    let golden = load_golden_in("default_open", "guardian_seer_night.json");
    let got = run(&golden["input"], load_pack_named("default_open"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "default_open guardian_seer_night",
    );
}

#[test]
fn golden_default_open_day_majority_elimination() {
    let golden = load_golden_in("default_open", "day_majority_elimination.json");
    let got = run(&golden["input"], load_pack_named("default_open"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "default_open day_majority_elimination",
    );
}

#[test]
fn golden_hammer_majority_ignores_late_withdrawal() {
    let golden = load_golden_in(
        "test_hammer_majority",
        "hammer_majority_ignores_late_withdrawal.json",
    );
    let got = run(&golden["input"], load_pack_named("test_hammer_majority"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "hammer_majority_ignores_late_withdrawal",
    );
}

#[test]
fn golden_sheriff_badge_election_weighted_vote() {
    let golden = load_golden_in(
        "chinese_structured",
        "sheriff_badge_election_weighted_vote.json",
    );
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "sheriff_badge_election_weighted_vote",
    );
}

#[test]
fn golden_sheriff_badge_pass() {
    let golden = load_golden_in("chinese_structured", "sheriff_badge_pass.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(&got, &expected_events(&golden), "sheriff_badge_pass");
}

#[test]
fn golden_sheriff_badge_destroy() {
    let golden = load_golden_in("chinese_structured", "sheriff_badge_destroy.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(&got, &expected_events(&golden), "sheriff_badge_destroy");
}

#[test]
fn golden_knight_duel_success() {
    let golden = load_golden_in("chinese_structured", "knight_duel_success.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(&got, &expected_events(&golden), "knight_duel_success");
}

#[test]
fn golden_knight_duel_failure() {
    let golden = load_golden_in("chinese_structured", "knight_duel_failure.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(&got, &expected_events(&golden), "knight_duel_failure");
}

#[test]
fn golden_wolf_self_destruct_trade() {
    let golden = load_golden_in("chinese_structured", "wolf_self_destruct_trade.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(&got, &expected_events(&golden), "wolf_self_destruct_trade");
}

#[test]
fn golden_wolf_carry_extra_night_kill() {
    let golden = load_golden_in("chinese_structured", "wolf_carry_extra_night_kill.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "wolf_carry_extra_night_kill",
    );
}

#[test]
fn golden_wolf_carry_passive_role_extra_night_kill() {
    let golden = load_golden_in(
        "chinese_structured",
        "wolf_carry_passive_role_extra_night_kill.json",
    );
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "wolf_carry_passive_role_extra_night_kill",
    );
}

#[test]
fn golden_wolf_faction_vote_same_target_collapses_to_one_kill() {
    let golden = load_golden_in(
        "chinese_structured",
        "wolf_faction_vote_same_target_collapses_to_one_kill.json",
    );
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "wolf_faction_vote_same_target_collapses_to_one_kill",
    );
}

#[test]
fn golden_wolf_faction_vote_tie_blocks_kill() {
    let golden = load_golden_in(
        "chinese_structured",
        "wolf_faction_vote_tie_blocks_kill.json",
    );
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "wolf_faction_vote_tie_blocks_kill",
    );
}

#[test]
fn golden_chinese_white_wolf_king_shared_night_kill() {
    let golden = load_golden_in(
        "chinese_structured",
        "white_wolf_king_shared_night_kill.json",
    );
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "chinese_structured white_wolf_king_shared_night_kill",
    );
}

#[test]
fn golden_wolf_beauty_mark() {
    let golden = load_golden_in("chinese_structured", "wolf_beauty_mark.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(&got, &expected_events(&golden), "wolf_beauty_mark");
}

#[test]
fn golden_wolf_beauty_drag_lynch() {
    let golden = load_golden_in("chinese_structured", "wolf_beauty_drag_lynch.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(&got, &expected_events(&golden), "wolf_beauty_drag_lynch");
}

#[test]
fn trace_records_day_wolf_beauty_drag() {
    let golden = load_golden_in("chinese_structured", "wolf_beauty_drag_lynch.json");
    let output = run_output(
        &golden["input"],
        load_pack_named("chinese_structured"),
        "day-wolf-beauty-drag-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "wolf_beauty_dragged")
        .expect("day Wolf Beauty drag should emit generated-death trace attribution");
    assert_eq!(decision.stage, "death:cascade");
    assert_eq!(decision.source, "action:beauty_001");
    assert_eq!(decision.detail["beauty_id"], "slot_1");
    assert_eq!(decision.detail["dragged_id"], "slot_2");
    assert_eq!(decision.detail["mark_effect"], "wolf_beauty_mark");
    assert_eq!(decision.detail["mark_source_action"], "beauty_001");
    assert_eq!(decision.detail["mark_phase_id"], "N01");
    assert_eq!(decision.detail["trigger_cause"], "lynch");
    assert_eq!(decision.detail["cause"], "trigger:wolf_beauty_drag");
}

#[test]
fn golden_witch_poison_triggers_wolf_beauty_drag() {
    let golden = load_golden_in(
        "chinese_structured",
        "witch_poison_triggers_wolf_beauty_drag.json",
    );
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "witch_poison_triggers_wolf_beauty_drag",
    );
}

#[test]
fn golden_wolf_beauty_drag_stacks_with_direct_death() {
    let golden = load_golden_in(
        "chinese_structured",
        "wolf_beauty_drag_stacks_with_direct_death.json",
    );
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "wolf_beauty_drag_stacks_with_direct_death",
    );
}

#[test]
fn trace_records_night_wolf_beauty_drag() {
    let golden = load_golden_in(
        "chinese_structured",
        "witch_poison_triggers_wolf_beauty_drag.json",
    );
    let output = run_output(
        &golden["input"],
        load_pack_named("chinese_structured"),
        "night-wolf-beauty-drag-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "wolf_beauty_dragged")
        .expect("night Wolf Beauty drag should emit generated-death trace attribution");
    assert_eq!(decision.stage, "death:cascade");
    assert_eq!(decision.source, "action:beauty_001");
    assert_eq!(decision.detail["beauty_id"], "slot_1");
    assert_eq!(decision.detail["dragged_id"], "slot_2");
    assert_eq!(decision.detail["mark_effect"], "wolf_beauty_mark");
    assert_eq!(decision.detail["mark_source_action"], "beauty_001");
    assert_eq!(decision.detail["mark_phase_id"], "N01");
    assert_eq!(decision.detail["trigger_cause"], "poison_potion");
    assert_eq!(decision.detail["cause"], "trigger:wolf_beauty_drag");
}

#[test]
fn trace_records_wolf_beauty_drag_stack_with_direct_death() {
    let golden = load_golden_in(
        "chinese_structured",
        "wolf_beauty_drag_stacks_with_direct_death.json",
    );
    let output = run_output(
        &golden["input"],
        load_pack_named("chinese_structured"),
        "wolf-beauty-drag-stacked-trace-run",
    );

    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::WolfBeautyDragged {
            beauty_id,
            dragged_ids,
            cause,
            ..
        } if beauty_id == "slot_1"
            && dragged_ids == &vec!["slot_2".to_string()]
            && cause == "trigger:wolf_beauty_drag"
    )));
    assert!(output.applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled {
            slot_id,
            cause,
            attackers,
            unstoppable,
            ..
        } if slot_id == "slot_2"
            && cause == "wolf_night_kill"
            && attackers == &vec!["slot_4".to_string(), "slot_1".to_string()]
            && *unstoppable
    )));
    assert!(
        !output.applied.events.iter().any(|indexed| matches!(
            &indexed.event,
            domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
                if slot_id == "slot_2" && cause == "trigger:wolf_beauty_drag"
        )),
        "Wolf Beauty drag must stack onto the direct death instead of adding a second kill event"
    );

    let drag = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "wolf_beauty_dragged")
        .expect("Wolf Beauty drag should still emit cascade trace attribution");
    assert_eq!(drag.stage, "death:cascade");
    assert_eq!(drag.source, "action:beauty_001");
    assert_eq!(drag.detail["beauty_id"], "slot_1");
    assert_eq!(drag.detail["dragged_id"], "slot_2");
    assert_eq!(drag.detail["mark_effect"], "wolf_beauty_mark");
    assert_eq!(drag.detail["mark_source_action"], "beauty_001");
    assert_eq!(drag.detail["mark_phase_id"], "N01");
    assert_eq!(drag.detail["trigger_cause"], "poison_potion");
    assert_eq!(drag.detail["cause"], "trigger:wolf_beauty_drag");

    let stacked = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "kill_stacked_on_existing_death"
                && decision.detail["target"] == "slot_2"
        })
        .expect("Wolf Beauty drag should merge into the existing direct death");
    assert_eq!(stacked.stage, "kill_resolution");
    assert_eq!(stacked.source, "cause:trigger:wolf_beauty_drag");
    assert_eq!(stacked.detail["attacker"], "slot_1");
    assert_eq!(stacked.detail["cause"], "trigger:wolf_beauty_drag");
    assert_eq!(stacked.detail["existing_cause"], "wolf_night_kill");
    assert_eq!(stacked.detail["unstoppable"], true);
    assert_eq!(
        stacked.detail["merged_attackers"],
        serde_json::json!(["slot_4", "slot_1"])
    );
}

#[test]
fn golden_witch_heal_potion_protects_wolf_kill() {
    let golden = load_golden_in(
        "chinese_structured",
        "witch_heal_potion_protects_wolf_kill.json",
    );
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "witch_heal_potion_protects_wolf_kill",
    );
}

#[test]
fn golden_guard_blocks_witch_poison() {
    let golden = load_golden_in("chinese_structured", "guard_blocks_witch_poison.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(&got, &expected_events(&golden), "guard_blocks_witch_poison");
}

#[test]
fn golden_chinese_guard_self_save_night_one_allowed() {
    let golden = load_golden_in(
        "chinese_structured",
        "guard_self_save_night_one_allowed.json",
    );
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "guard_self_save_night_one_allowed",
    );
}

#[test]
fn golden_chinese_guard_night_one_disabled() {
    let golden = load_golden_in("chinese_structured", "guard_night_one_disabled.json");
    let got = run(
        &golden["input"],
        load_pack_for_golden("chinese_structured", &golden),
    );
    assert_events_eq(&got, &expected_events(&golden), "guard_night_one_disabled");
}

#[test]
fn golden_chinese_guard_self_save_disabled() {
    let golden = load_golden_in("chinese_structured", "guard_self_save_disabled.json");
    let got = run(
        &golden["input"],
        load_pack_for_golden("chinese_structured", &golden),
    );
    assert_events_eq(&got, &expected_events(&golden), "guard_self_save_disabled");
}

#[test]
fn trace_records_guard_blocking_witch_poison_policy() {
    let golden = load_golden_in("chinese_structured", "guard_blocks_witch_poison.json");
    let output = run_output(
        &golden["input"],
        load_pack_named("chinese_structured"),
        "guard-blocks-witch-poison-run",
    );
    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.stage == "kill_resolution"
                && decision.source == "cause:poison_potion"
                && decision.outcome == "kill_prevented_by_protection"
                && decision.detail["target"] == "slot_3"
                && decision.detail["attacker"] == "slot_4"
        })
        .expect("Guard-blocked Witch poison should emit a protection trace decision");
    assert_eq!(decision.detail["cause"], "poison_potion");
    assert_eq!(decision.detail["unstoppable"], false);
    assert_eq!(
        decision.detail["protectors"],
        serde_json::json!([{
            "protector": "slot_1",
            "action_id": "guard_001",
            "template_id": "night_guard",
            "intercepts": false,
            "intercept_cause": null,
            "guard_retaliation_cause": null,
            "cpr_harm_cause": null
        }])
    );
}

#[test]
fn golden_witch_heal_does_not_block_poison() {
    let golden = load_golden_in(
        "chinese_structured",
        "witch_heal_does_not_block_poison.json",
    );
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "witch_heal_does_not_block_poison",
    );
}

#[test]
fn golden_guard_witch_double_save_succeeds() {
    let golden = load_golden_in(
        "chinese_structured",
        "guard_witch_double_save_succeeds.json",
    );
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "guard_witch_double_save_succeeds",
    );
}

#[test]
fn trace_records_guard_witch_double_save_policy() {
    let golden = load_golden_in(
        "chinese_structured",
        "guard_witch_double_save_succeeds.json",
    );
    let output = run_output(
        &golden["input"],
        load_pack_named("chinese_structured"),
        "guard-witch-double-save-run",
    );
    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.stage == "kill_resolution"
                && decision.source == "cause:wolf_night_kill"
                && decision.outcome == "kill_prevented_by_protection"
                && decision.detail["target"] == "slot_3"
                && decision.detail["attacker"] == "slot_4"
        })
        .expect("Guard/Witch double-save should emit a protection trace decision");
    assert_eq!(decision.detail["cause"], "wolf_night_kill");
    assert_eq!(decision.detail["unstoppable"], false);
    assert_eq!(
        decision.detail["protectors"],
        serde_json::json!([
            {
                "protector": "slot_1",
                "action_id": "guard_001",
                "template_id": "night_guard",
                "intercepts": false,
                "intercept_cause": null,
                "guard_retaliation_cause": null,
                "cpr_harm_cause": null
            },
            {
                "protector": "slot_2",
                "action_id": "heal_001",
                "template_id": "heal_potion",
                "intercepts": false,
                "intercept_cause": null,
                "guard_retaliation_cause": null,
                "cpr_harm_cause": null
            }
        ])
    );
}

#[test]
fn golden_guard_witch_same_target_kills() {
    let golden = load_golden_in("chinese_structured", "guard_witch_same_target_kills.json");
    let got = run(
        &golden["input"],
        load_pack_for_golden("chinese_structured", &golden),
    );
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "guard_witch_same_target_kills",
    );
}

#[test]
fn trace_records_guard_witch_same_target_kill_policy() {
    let golden = load_golden_in("chinese_structured", "guard_witch_same_target_kills.json");
    let output = run_output(
        &golden["input"],
        load_pack_for_golden("chinese_structured", &golden),
        "guard-witch-same-target-kill-run",
    );
    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "guard_witch_same_target_killed")
        .expect("Guard/Witch KillTarget policy should emit a trace decision");
    assert_eq!(decision.stage, "night:guard_policy");
    assert_eq!(decision.source, "guard_policy.same_target_witch");
    assert_eq!(decision.detail["target"], "slot_3");
    assert_eq!(decision.detail["cause"], "guard_witch_same_target");
    assert_eq!(decision.detail["policy"], "KillTarget");
    assert_eq!(
        decision.detail["guard_sources"][0]["action_id"],
        "guard_001"
    );
    assert_eq!(decision.detail["witch_sources"][0]["action_id"], "heal_001");
}

#[test]
fn golden_chinese_hunter_arms_retaliation() {
    let golden = load_golden_in("chinese_structured", "hunter_arms_retaliation.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "chinese_hunter_arms_retaliation",
    );
}

#[test]
fn golden_chinese_hunter_retaliates_on_wolf_kill() {
    let golden = load_golden_in("chinese_structured", "hunter_retaliates_on_wolf_kill.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "chinese_hunter_retaliates_on_wolf_kill",
    );
}

#[test]
fn trace_records_chinese_hunter_immediate_retaliation_timing() {
    let golden = load_golden_in("chinese_structured", "hunter_retaliates_on_wolf_kill.json");
    let output = run_output(
        &golden["input"],
        load_pack_named("chinese_structured"),
        "chinese-hunter-immediate-retaliation-run",
    );
    let event_kinds = output
        .applied
        .events
        .iter()
        .map(|indexed| match &indexed.event {
            domain::InnerEvent::PlayerKilled { .. } => "PlayerKilled",
            domain::InnerEvent::PhaseAnnouncement(_) => "PhaseAnnouncement",
            domain::InnerEvent::HostPromptIssued(_) => "HostPromptIssued",
            _ => "Other",
        })
        .collect::<Vec<_>>();
    assert_eq!(
        event_kinds,
        vec!["PlayerKilled", "PlayerKilled", "PhaseAnnouncement"],
        "Chinese Hunter immediate timing should kill before the trailing announcement and emit no host prompt"
    );
    assert!(
        !output
            .applied
            .events
            .iter()
            .any(|indexed| matches!(indexed.event, domain::InnerEvent::HostPromptIssued(_))),
        "shipped Chinese Hunter immediate timing must not emit a host prompt"
    );
    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "chosen_retaliation")
        .expect("allowed Chinese Hunter retaliation should emit a trace decision");
    assert_eq!(decision.stage, "death:cascade");
    assert_eq!(decision.source, "retaliation:hunt_001");
    assert_eq!(
        decision.detail["timing"],
        "ImmediateBeforePhaseAnnouncement"
    );
    assert_eq!(decision.detail["source_death_cause"], "wolf_night_kill");
}

#[test]
fn golden_chinese_hunter_poison_suppresses_retaliation() {
    let golden = load_golden_in(
        "chinese_structured",
        "hunter_poison_suppresses_retaliation.json",
    );
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "chinese_hunter_poison_suppresses_retaliation",
    );
}

#[test]
fn trace_records_chinese_hunter_poison_suppresses_retaliation() {
    let golden = load_golden_in(
        "chinese_structured",
        "hunter_poison_suppresses_retaliation.json",
    );
    let output = run_output(
        &golden["input"],
        load_pack_named("chinese_structured"),
        "chinese-hunter-poison-suppression-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "chosen_retaliation_suppressed")
        .expect("poison-suppressed Hunter retaliation should emit a trace decision");
    assert_eq!(decision.stage, "death:cascade");
    assert_eq!(decision.source, "retaliation:hunt_001");
    assert_eq!(decision.detail["policy"], "death_retaliation");
    assert_eq!(decision.detail["reason"], "suppressed_death_cause");
    assert_eq!(
        decision.detail["timing"],
        "ImmediateBeforePhaseAnnouncement"
    );
    assert_eq!(decision.detail["retaliation_id"], "hunt_001");
    assert_eq!(decision.detail["actor"], "slot_1");
    assert_eq!(decision.detail["target"], "slot_2");
    assert_eq!(decision.detail["source_action"], "hunter_retaliate");
    assert_eq!(decision.detail["source_death_cause"], "poison_potion");
}

#[test]
fn golden_chinese_idiot_survives_first_lynch() {
    let golden = load_golden_in("chinese_structured", "idiot_survives_first_lynch.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "chinese_idiot_survives_first_lynch",
    );
}

#[test]
fn golden_chinese_idiot_vote_loss_zero_weight() {
    let golden = load_golden_in("chinese_structured", "idiot_vote_loss_zero_weight.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "chinese_idiot_vote_loss_zero_weight",
    );
}

#[test]
fn golden_chinese_prophet_alignment_results() {
    let golden = load_golden_in("chinese_structured", "prophet_alignment_results.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "chinese_prophet_alignment_results",
    );
}

#[test]
fn golden_chinese_cupid_links_lovers() {
    let golden = load_golden_in("chinese_structured", "cupid_links_lovers.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "chinese_cupid_links_lovers",
    );
}

#[test]
fn golden_chinese_cupid_lovers_death_cascade() {
    let golden = load_golden_in("chinese_structured", "cupid_lovers_death_cascade.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "chinese_cupid_lovers_death_cascade",
    );
}

#[test]
fn golden_chinese_cupid_lovers_lynch_cascade() {
    let golden = load_golden_in("chinese_structured", "cupid_lovers_lynch_cascade.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "chinese_cupid_lovers_lynch_cascade",
    );
}

#[test]
fn golden_chinese_cupid_lovers_poison_cascade() {
    let golden = load_golden_in("chinese_structured", "cupid_lovers_poison_cascade.json");
    let got = run(&golden["input"], load_pack_named("chinese_structured"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "chinese_cupid_lovers_poison_cascade",
    );
}

#[test]
fn golden_chinese_cupid_lovers_cascade_disabled() {
    let golden = load_golden_in("chinese_structured", "cupid_lovers_cascade_disabled.json");
    let pack = load_pack_for_golden("chinese_structured", &golden);
    let got = run(&golden["input"], pack);
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "chinese_cupid_lovers_cascade_disabled",
    );
}

#[test]
fn golden_ita_session_lethal_shot() {
    let golden = load_golden_in("mafia_universe", "ita_session_lethal_shot.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(&got, &expected_events(&golden), "ita_session_lethal_shot");
}

#[test]
fn golden_ita_session_invalidates_later_dead_target() {
    let golden = load_golden_in(
        "mafia_universe",
        "ita_session_invalidates_later_dead_target.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "ita_session_invalidates_later_dead_target",
    );
    assert!(got.iter().any(|event| {
        event["kind"] == "ItaShotInvalidated"
            && event["payload"]["action_id"] == "ita_invalidated_002"
            && event["payload"]["invalidated_by"] == "ita_kill_001"
            && event["payload"]["reason"] == "target_dead"
    }));
    assert!(!got.iter().any(|event| {
        event["kind"] == "ItaShotResolved" && event["payload"]["action_id"] == "ita_invalidated_002"
    }));
}

#[test]
fn golden_ita_session_refunds_already_dead_target() {
    let golden = load_golden_in(
        "mafia_universe",
        "ita_session_refunds_already_dead_target.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "ita_session_refunds_already_dead_target",
    );
    assert!(got.iter().any(|event| {
        event["kind"] == "ItaShotRefunded"
            && event["payload"]["action_id"] == "ita_refunded_001"
            && event["payload"]["reason"] == "target_dead"
            && event["payload"]["policy"] == "REFUND_SHOT"
            && event["payload"]["counters"]["shots_refunded"] == 1
            && event["payload"]["counters"]["refunded_by_reason"]["target_dead"] == 1
    }));
    assert!(!got.iter().any(|event| {
        event["kind"] == "ItaShotResolved" && event["payload"]["action_id"] == "ita_refunded_001"
    }));
}

#[test]
fn resolver_rejects_missing_ita_vote_conflict_before_day_resolution() {
    let golden = load_golden_in("mafia_universe", "ita_session_lethal_shot.json");
    let mut pack = load_pack_named("mafia_universe");
    pack.ita.vote_conflict = None;

    let panic = std::panic::catch_unwind(|| run(&golden["input"], pack))
        .expect_err("invalid ITA vote conflict policy must not silently use Rust day ordering");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("<non-string panic>");
    assert!(
        message.contains("invalid ITA vote conflict policy"),
        "unexpected panic message: {message}"
    );
    assert!(
        message.contains("ResolveShotsBeforeVote"),
        "unexpected panic message: {message}"
    );
}

#[test]
fn golden_ita_session_shot_limit_exhausted() {
    let golden = load_golden_in("mafia_universe", "ita_session_shot_limit_exhausted.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "ita_session_shot_limit_exhausted",
    );
}

#[test]
fn golden_ita_session_buffered_shot() {
    let golden = load_golden_in("test_ita_buffered", "ita_session_buffered_shot.json");
    let got = run(&golden["input"], load_pack_named("test_ita_buffered"));
    assert_events_eq(&got, &expected_events(&golden), "ita_session_buffered_shot");
    assert!(
        !got.iter().any(|event| event["kind"] == "ItaShotQueued"),
        "newly buffered ITA shots must not enter the queue in the same pass"
    );
    assert!(
        !got.iter().any(|event| event["kind"] == "ItaShotResolved"),
        "newly buffered ITA shots must not resolve in the same pass"
    );
}

#[test]
fn golden_ita_session_lifecycle_controls() {
    let golden = load_golden_in("test_ita_buffered", "ita_session_lifecycle_controls.json");
    let got = run(&golden["input"], load_pack_named("test_ita_buffered"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "ita_session_lifecycle_controls",
    );
    assert!(got.iter().any(|event| {
        event["kind"] == "ItaSessionLifecycleChanged"
            && event["payload"]["control"] == "Pause"
            && event["payload"]["to_status"] == "paused"
    }));
    assert!(got.iter().any(|event| {
        event["kind"] == "ItaSessionLifecycleChanged"
            && event["payload"]["control"] == "Cancel"
            && event["payload"]["to_status"] == "cancelled"
    }));
    assert!(got.iter().any(|event| {
        event["kind"] == "ActionInterfered"
            && event["payload"]["actor"] == "slot_1"
            && event["payload"]["reason"] == "ita_session_closed"
    }));
    assert!(!got
        .iter()
        .any(|event| { event["kind"] == "ItaShotQueued" || event["kind"] == "ItaShotResolved" }));
}

#[test]
fn golden_ita_chance_and_shields() {
    let golden = load_golden_in("mafia_universe", "ita_chance_and_shields.json");
    let got = run(
        &golden["input"],
        load_pack_for_golden("mafia_universe", &golden),
    );
    assert_events_eq(&got, &expected_events(&golden), "ita_chance_and_shields");
}

#[test]
fn golden_ita_hp_and_hybrid_protection() {
    let golden = load_golden_in("mafia_universe", "ita_hp_and_hybrid_protection.json");
    let got = run(
        &golden["input"],
        load_pack_for_golden("mafia_universe", &golden),
    );
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "ita_hp_and_hybrid_protection",
    );
    let hp_damage = got
        .iter()
        .find(|event| {
            event["kind"] == "ItaShotResolved"
                && event["payload"]["action_id"] == "ita_hp_damage_001"
        })
        .expect("first armored ITA hit resolves");
    assert_eq!(hp_damage["payload"]["outcome"], "Hit");
    assert_eq!(hp_damage["payload"]["hp_before"], 2);
    assert_eq!(hp_damage["payload"]["hp_after"], 1);
    assert_eq!(hp_damage["payload"]["kill"], false);

    let hp_kill = got
        .iter()
        .find(|event| {
            event["kind"] == "ItaShotResolved" && event["payload"]["action_id"] == "ita_hp_kill_002"
        })
        .expect("second armored ITA hit resolves");
    assert_eq!(hp_kill["payload"]["hp_before"], 1);
    assert_eq!(hp_kill["payload"]["hp_after"], 0);
    assert_eq!(hp_kill["payload"]["kill"], true);

    let hybrid_shield = got
        .iter()
        .find(|event| {
            event["kind"] == "ItaShotResolved"
                && event["payload"]["action_id"] == "ita_hybrid_shield_003"
        })
        .expect("hybrid shield ITA hit resolves");
    assert_eq!(hybrid_shield["payload"]["outcome"], "Blocked");
    assert_eq!(hybrid_shield["payload"]["shield_spent"], true);
    assert_eq!(hybrid_shield["payload"]["hp_before"], 2);
    assert_eq!(hybrid_shield["payload"]["hp_after"], 2);

    let hybrid_hp = got
        .iter()
        .find(|event| {
            event["kind"] == "ItaShotResolved"
                && event["payload"]["action_id"] == "ita_hybrid_hp_004"
        })
        .expect("hybrid HP ITA hit resolves");
    assert_eq!(hybrid_hp["payload"]["outcome"], "Hit");
    assert_eq!(hybrid_hp["payload"]["hp_before"], 2);
    assert_eq!(hybrid_hp["payload"]["hp_after"], 1);
    assert_eq!(hybrid_hp["payload"]["kill"], false);
}

#[test]
fn golden_day_notes_announcement_last_words() {
    let golden = load_golden_in("mafia_universe", "day_notes_announcement_last_words.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "day_notes_announcement_last_words",
    );
}

#[test]
fn day_substep_goldens_expose_canonical_host_console_ordering() {
    let day_notes = {
        let golden = load_golden_in("mafia_universe", "day_notes_announcement_last_words.json");
        run(&golden["input"], load_pack_named("mafia_universe"))
    };
    assert_event_order(
        "day notes",
        &day_notes,
        &[
            (
                "announcement",
                first_event_index(&day_notes, "DayAnnouncement"),
            ),
            (
                "resolve_votes",
                first_event_index(&day_notes, "DayVoteOutcome"),
            ),
            (
                "day_death",
                first_event_index_where(&day_notes, "PlayerKilled", |event| {
                    event["payload"]["cause"] == "day_vote"
                }),
            ),
            (
                "last_words",
                first_event_index(&day_notes, "LastWordsRecorded"),
            ),
            (
                "phase_announcement",
                first_event_index(&day_notes, "PhaseAnnouncement"),
            ),
        ],
    );

    let reveal = {
        let golden = load_golden_in("mafia_universe", "reveal_town_day.json");
        run(&golden["input"], load_pack_named("mafia_universe"))
    };
    assert_event_order(
        "public reveal",
        &reveal,
        &[
            (
                "public_reveal",
                first_event_index(&reveal, "AlignmentRevealed"),
            ),
            (
                "resolve_votes",
                first_event_index(&reveal, "DayVoteOutcome"),
            ),
            (
                "phase_announcement",
                first_event_index(&reveal, "PhaseAnnouncement"),
            ),
        ],
    );

    let ita = {
        let golden = load_golden_in("mafia_universe", "ita_session_lethal_shot.json");
        run(&golden["input"], load_pack_named("mafia_universe"))
    };
    assert_event_order(
        "ita session",
        &ita,
        &[
            ("ita_open", first_event_index(&ita, "ItaSessionOpened")),
            ("ita_queue", first_event_index(&ita, "ItaShotQueued")),
            ("ita_resolve", first_event_index(&ita, "ItaShotResolved")),
            (
                "ita_day_death",
                first_event_index_where(&ita, "PlayerKilled", |event| {
                    event["payload"]["cause"] == "ita_shot"
                }),
            ),
            ("ita_update", first_event_index(&ita, "ItaSessionUpdated")),
            ("ita_close", first_event_index(&ita, "ItaSessionClosed")),
            ("resolve_votes", first_event_index(&ita, "DayVoteOutcome")),
            (
                "phase_announcement",
                first_event_index(&ita, "PhaseAnnouncement"),
            ),
        ],
    );

    let knight = {
        let golden = load_golden_in("chinese_structured", "knight_duel_success.json");
        run(&golden["input"], load_pack_named("chinese_structured"))
    };
    assert_event_order(
        "knight duel",
        &knight,
        &[
            ("knight_duel", first_event_index(&knight, "DuelResolved")),
            (
                "knight_day_death",
                first_event_index_where(&knight, "PlayerKilled", |event| {
                    event["payload"]["cause"] == "knight_duel"
                }),
            ),
            (
                "resolve_votes",
                first_event_index(&knight, "DayVoteOutcome"),
            ),
            (
                "phase_announcement",
                first_event_index(&knight, "PhaseAnnouncement"),
            ),
        ],
    );

    let self_destruct = {
        let golden = load_golden_in("chinese_structured", "wolf_self_destruct_trade.json");
        run(&golden["input"], load_pack_named("chinese_structured"))
    };
    assert_event_order(
        "wolf self-destruct",
        &self_destruct,
        &[
            (
                "wolf_self_destruct",
                first_event_index(&self_destruct, "WolfSelfDestructed"),
            ),
            (
                "self_destruct_day_death",
                first_event_index_where(&self_destruct, "PlayerKilled", |event| {
                    event["payload"]["cause"] == "self_destruct"
                }),
            ),
            (
                "wolf_carry",
                first_event_index(&self_destruct, "WolfCarryQueued"),
            ),
            (
                "resolve_votes",
                first_event_index(&self_destruct, "DayVoteOutcome"),
            ),
            (
                "phase_announcement",
                first_event_index(&self_destruct, "PhaseAnnouncement"),
            ),
        ],
    );

    let day_vigilante = {
        let golden = load_golden_in(
            "mafia_universe",
            "day_vigilante_alignment_variants_kill.json",
        );
        run(&golden["input"], load_pack_named("mafia_universe"))
    };
    assert_event_order(
        "day vigilante",
        &day_vigilante,
        &[
            (
                "day_action_death",
                first_event_index_where(&day_vigilante, "PlayerKilled", |event| {
                    event["payload"]["cause"] == "day_vigilante_kill"
                }),
            ),
            (
                "resolve_votes",
                first_event_index(&day_vigilante, "DayVoteOutcome"),
            ),
            (
                "phase_announcement",
                first_event_index(&day_vigilante, "PhaseAnnouncement"),
            ),
        ],
    );

    let wolf_beauty = {
        let golden = load_golden_in("chinese_structured", "wolf_beauty_drag_lynch.json");
        run(&golden["input"], load_pack_named("chinese_structured"))
    };
    assert_event_order(
        "wolf beauty day-death cascade",
        &wolf_beauty,
        &[
            (
                "resolve_votes",
                first_event_index(&wolf_beauty, "DayVoteOutcome"),
            ),
            (
                "lynch_death",
                first_event_index_where(&wolf_beauty, "PlayerKilled", |event| {
                    event["payload"]["cause"] == "day_vote"
                }),
            ),
            (
                "day_death_cascade",
                first_event_index(&wolf_beauty, "WolfBeautyDragged"),
            ),
            (
                "dragged_death",
                first_event_index_where(&wolf_beauty, "PlayerKilled", |event| {
                    event["payload"]["cause"] == "trigger:wolf_beauty_drag"
                }),
            ),
            (
                "phase_announcement",
                first_event_index(&wolf_beauty, "PhaseAnnouncement"),
            ),
        ],
    );
}

#[test]
fn golden_treestump_status_on_lynch() {
    let golden = load_golden_in("mafia_universe", "treestump_status_on_lynch.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(&got, &expected_events(&golden), "treestump_status_on_lynch");
}

#[test]
fn golden_mafia_treestump_status_on_lynch() {
    let golden = load_golden_in("mafia_universe", "mafia_treestump_status_on_lynch.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_treestump_status_on_lynch",
    );
}

#[test]
fn golden_mafia_universe_basic_nar_doctor_saves() {
    let golden = load_golden_in("mafia_universe", "basic_nar_doctor_saves.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe basic_nar_doctor_saves",
    );
}

#[test]
fn golden_mafia_universe_basic_nar_roleblock_opens_kill() {
    let golden = load_golden_in("mafia_universe", "basic_nar_roleblock_opens_kill.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe basic_nar_roleblock_opens_kill",
    );
}

#[test]
fn golden_mafia_universe_lover_suicide_on_partner_death() {
    let golden = load_golden_in("mafia_universe", "lover_suicide_on_partner_death.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe lover_suicide_on_partner_death",
    );
}

#[test]
fn golden_mafia_universe_town_bomber_retaliates_on_night_kill() {
    let golden = load_golden_in(
        "mafia_universe",
        "town_bomber_retaliates_on_night_kill.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe town_bomber_retaliates_on_night_kill",
    );
}

#[test]
fn golden_mafia_universe_mafia_bomber_retaliates_on_night_kill() {
    let golden = load_golden_in(
        "mafia_universe",
        "mafia_bomber_retaliates_on_night_kill.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe mafia_bomber_retaliates_on_night_kill",
    );
}

#[test]
fn golden_mafia_universe_roleblocker_mafia_blocks_doctor() {
    let golden = load_golden_in("mafia_universe", "roleblocker_mafia_blocks_doctor.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe roleblocker_mafia_blocks_doctor",
    );
}

#[test]
fn golden_mafia_universe_jack_of_all_trades_block_consumes_one_shot() {
    let golden = load_golden_in(
        "mafia_universe",
        "jack_of_all_trades_block_consumes_one_shot.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe jack_of_all_trades_block_consumes_one_shot",
    );
}

#[test]
fn golden_mafia_universe_jack_of_all_trades_town_block_consumes_one_shot() {
    let golden = load_golden_in(
        "mafia_universe",
        "jack_of_all_trades_town_block_consumes_one_shot.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe jack_of_all_trades_town_block_consumes_one_shot",
    );
}

#[test]
fn golden_mafia_universe_basic_nar_strongman_pierces_doctor() {
    let golden = load_golden_in("mafia_universe", "basic_nar_strongman_pierces_doctor.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe basic_nar_strongman_pierces_doctor",
    );
}

#[test]
fn golden_mafia_universe_town_strongman_pierces_doctor() {
    let golden = load_golden_in("mafia_universe", "town_strongman_pierces_doctor.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe town_strongman_pierces_doctor",
    );
}

#[test]
fn golden_mafia_universe_basic_nar_jail_blocks_and_protects() {
    let golden = load_golden_in("mafia_universe", "basic_nar_jail_blocks_and_protects.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe basic_nar_jail_blocks_and_protects",
    );
}

#[test]
fn golden_mafia_universe_night_desperado_alignment_variants_kill() {
    let golden = load_golden_in(
        "mafia_universe",
        "night_desperado_alignment_variants_kill.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe night_desperado_alignment_variants_kill",
    );
}

#[test]
fn golden_mafia_universe_vigilante_alignment_variants_kill() {
    let golden = load_golden_in("mafia_universe", "vigilante_alignment_variants_kill.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe vigilante_alignment_variants_kill",
    );
}

#[test]
fn golden_mafia_universe_day_vigilante_alignment_variants_kill() {
    let golden = load_golden_in(
        "mafia_universe",
        "day_vigilante_alignment_variants_kill.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe day_vigilante_alignment_variants_kill",
    );
}

#[test]
fn golden_mafia_universe_day_desperado_alignment_failback() {
    let golden = load_golden_in("mafia_universe", "day_desperado_alignment_failback.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe day_desperado_alignment_failback",
    );
}

#[test]
fn golden_mafia_universe_power_role_killer_kills_power_roles() {
    let golden = load_golden_in("mafia_universe", "power_role_killer_kills_power_roles.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe power_role_killer_kills_power_roles",
    );
}

#[test]
fn golden_mafia_universe_power_role_killer_rejects_vanilla_target() {
    let golden = load_golden_in(
        "mafia_universe",
        "power_role_killer_rejects_vanilla_target.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe power_role_killer_rejects_vanilla_target",
    );
}

#[test]
fn golden_mafia_universe_basic_nar_bodyguard_intercepts() {
    let golden = load_golden_in("mafia_universe", "basic_nar_bodyguard_intercepts.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe basic_nar_bodyguard_intercepts",
    );
}

#[test]
fn golden_mafia_universe_basic_nar_martyr_intercepts() {
    let golden = load_golden_in("mafia_universe", "basic_nar_martyr_intercepts.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe basic_nar_martyr_intercepts",
    );
}

#[test]
fn golden_mafia_universe_basic_nar_cpr_saves_attacked_target() {
    let golden = load_golden_in("mafia_universe", "basic_nar_cpr_saves_attacked_target.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe basic_nar_cpr_saves_attacked_target",
    );
}

#[test]
fn golden_mafia_universe_basic_nar_cpr_kills_unattacked_target() {
    let golden = load_golden_in(
        "mafia_universe",
        "basic_nar_cpr_kills_unattacked_target.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe basic_nar_cpr_kills_unattacked_target",
    );
}

#[test]
fn golden_mafia_universe_investigation_parity_scum() {
    let golden = load_golden_in("mafia_universe", "investigation_parity_scum.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe investigation_parity_scum",
    );
}

#[test]
fn golden_mafia_universe_investigation_godfather_reads_town() {
    let golden = load_golden_in("mafia_universe", "investigation_godfather_reads_town.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe investigation_godfather_reads_town",
    );
}

#[test]
fn golden_mafia_universe_investigation_miller_reads_scum() {
    let golden = load_golden_in("mafia_universe", "investigation_miller_reads_scum.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe investigation_miller_reads_scum",
    );
}

#[test]
fn golden_mafia_universe_investigation_framer_parity_override() {
    let golden = load_golden_in(
        "mafia_universe",
        "investigation_framer_parity_override.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe investigation_framer_parity_override",
    );
}

#[test]
fn golden_mafia_universe_investigation_town_framer_parity_override() {
    let golden = load_golden_in(
        "mafia_universe",
        "investigation_town_framer_parity_override.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe investigation_town_framer_parity_override",
    );
}

#[test]
fn golden_mafia_universe_parity_scan_investigator_memory() {
    let golden = load_golden_in("mafia_universe", "parity_scan_investigator_memory.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe parity_scan_investigator_memory",
    );
}

#[test]
fn golden_mafia_universe_reveal_town_day() {
    let golden = load_golden_in("mafia_universe", "reveal_town_day.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe reveal_town_day",
    );
}

#[test]
fn golden_mafia_universe_role_set_info_town_investigations() {
    let golden = load_golden_in("mafia_universe", "role_set_info_town_investigations.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe role_set_info_town_investigations",
    );
}

#[test]
fn golden_mafia_universe_role_set_info_mafia_investigations() {
    let golden = load_golden_in("mafia_universe", "role_set_info_mafia_investigations.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe role_set_info_mafia_investigations",
    );
}

#[test]
fn golden_mafia_universe_role_and_full_role_info_town_investigations() {
    let golden = load_golden_in(
        "mafia_universe",
        "role_and_full_role_info_town_investigations.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe role_and_full_role_info_town_investigations",
    );
}

#[test]
fn golden_mafia_universe_role_and_full_role_info_mafia_investigations() {
    let golden = load_golden_in(
        "mafia_universe",
        "role_and_full_role_info_mafia_investigations.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe role_and_full_role_info_mafia_investigations",
    );
}

#[test]
fn golden_mafia_universe_culture_alias_alignment_cops_and_serial_killer() {
    let golden = load_golden_in(
        "mafia_universe",
        "culture_alias_alignment_cops_and_serial_killer.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe culture_alias_alignment_cops_and_serial_killer",
    );
}

#[test]
fn golden_mafia_universe_graph_info_town_tracker_watcher_motion() {
    let golden = load_golden_in(
        "mafia_universe",
        "graph_info_town_tracker_watcher_motion.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe graph_info_town_tracker_watcher_motion",
    );
}

#[test]
fn golden_mafia_universe_graph_info_mafia_tracker_watcher_motion() {
    let golden = load_golden_in(
        "mafia_universe",
        "graph_info_mafia_tracker_watcher_motion.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe graph_info_mafia_tracker_watcher_motion",
    );
}

#[test]
fn golden_mafia_universe_voyeur_action_investigation() {
    let golden = load_golden_in("mafia_universe", "voyeur_action_investigation.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe voyeur_action_investigation",
    );
}

#[test]
fn golden_mafia_universe_alignment_oracle_source_death_reveals_target() {
    let golden = load_golden_in(
        "mafia_universe",
        "alignment_oracle_source_death_reveals_target.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe alignment_oracle_source_death_reveals_target",
    );
}

#[test]
fn golden_mafia_universe_alignment_oracle_marks_target() {
    let golden = load_golden_in("mafia_universe", "alignment_oracle_marks_target.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe alignment_oracle_marks_target",
    );
}

#[test]
fn golden_mafia_universe_role_oracle_source_death_reveals_target() {
    let golden = load_golden_in(
        "mafia_universe",
        "role_oracle_source_death_reveals_target.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe role_oracle_source_death_reveals_target",
    );
}

#[test]
fn golden_mafia_universe_role_oracle_marks_target() {
    let golden = load_golden_in("mafia_universe", "role_oracle_marks_target.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe role_oracle_marks_target",
    );
}

#[test]
fn golden_mafia_universe_janitor_alignment_variants_conceal() {
    let golden = load_golden_in("mafia_universe", "janitor_alignment_variants_conceal.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe janitor_alignment_variants_conceal",
    );
}

#[test]
fn golden_mafia_universe_backup_alignment_variants_designate_sources() {
    let golden = load_golden_in(
        "mafia_universe",
        "backup_alignment_variants_designate_sources.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe backup_alignment_variants_designate_sources",
    );
}

#[test]
fn golden_mafia_universe_backup_alignment_variants_inherit_on_source_death() {
    let golden = load_golden_in(
        "mafia_universe",
        "backup_alignment_variants_inherit_on_source_death.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe backup_alignment_variants_inherit_on_source_death",
    );
}

#[test]
fn golden_mafia_universe_ninja_hidden_from_watch_motion() {
    let golden = load_golden_in("mafia_universe", "ninja_hidden_from_watch_motion.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe ninja_hidden_from_watch_motion",
    );
}

#[test]
fn golden_mafia_universe_redirect_town_bus_driver_swap() {
    let golden = load_golden_in("mafia_universe", "redirect_town_bus_driver_swap.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe redirect_town_bus_driver_swap",
    );
}

#[test]
fn golden_mafia_universe_redirect_mafia_bus_driver_swap() {
    let golden = load_golden_in("mafia_universe", "redirect_mafia_bus_driver_swap.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe redirect_mafia_bus_driver_swap",
    );
}

#[test]
fn golden_mafia_universe_redirect_mixed_redirector_cycle() {
    let golden = load_golden_in("mafia_universe", "redirect_mixed_redirector_cycle.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe redirect_mixed_redirector_cycle",
    );
}

#[test]
fn golden_mafia_universe_commute_town_avoids_targeting() {
    let golden = load_golden_in("mafia_universe", "commute_town_avoids_targeting.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe commute_town_avoids_targeting",
    );
}

#[test]
fn golden_mafia_universe_commute_mafia_blocks_investigation() {
    let golden = load_golden_in("mafia_universe", "commute_mafia_blocks_investigation.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe commute_mafia_blocks_investigation",
    );
}

#[test]
fn golden_mafia_universe_commute_personal_rejects_other_target() {
    let golden = load_golden_in(
        "mafia_universe",
        "commute_personal_rejects_other_target.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe commute_personal_rejects_other_target",
    );
}

#[test]
fn golden_mafia_universe_rolestop_town_blocks_kill_and_investigation() {
    let golden = load_golden_in(
        "mafia_universe",
        "rolestop_town_blocks_kill_and_investigation.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe rolestop_town_blocks_kill_and_investigation",
    );
}

#[test]
fn golden_mafia_universe_rolestop_mafia_blocks_kill_and_investigation() {
    let golden = load_golden_in(
        "mafia_universe",
        "rolestop_mafia_blocks_kill_and_investigation.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe rolestop_mafia_blocks_kill_and_investigation",
    );
}

#[test]
fn golden_mafia_universe_poison_town_marks_no_death() {
    let golden = load_golden_in("mafia_universe", "poison_town_marks_no_death.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe poison_town_marks_no_death",
    );
}

#[test]
fn golden_mafia_universe_poison_mafia_marks_no_death() {
    let golden = load_golden_in("mafia_universe", "poison_mafia_marks_no_death.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe poison_mafia_marks_no_death",
    );
}

#[test]
fn golden_mafia_universe_poison_cure_town_preempts_death() {
    let golden = load_golden_in("mafia_universe", "poison_cure_town_preempts_death.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe poison_cure_town_preempts_death",
    );
}

#[test]
fn golden_mafia_universe_poison_cure_mafia_preempts_death() {
    let golden = load_golden_in("mafia_universe", "poison_cure_mafia_preempts_death.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe poison_cure_mafia_preempts_death",
    );
}

#[test]
fn golden_mafia_universe_poison_cure_town_healer_preempts_death() {
    let golden = load_golden_in(
        "mafia_universe",
        "poison_cure_town_healer_preempts_death.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe poison_cure_town_healer_preempts_death",
    );
}

#[test]
fn golden_mafia_universe_poison_cure_mafia_healer_preempts_death() {
    let golden = load_golden_in(
        "mafia_universe",
        "poison_cure_mafia_healer_preempts_death.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe poison_cure_mafia_healer_preempts_death",
    );
}

#[test]
fn golden_mafia_universe_poison_pending_kills() {
    let golden = load_golden_in("mafia_universe", "poison_pending_kills.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe poison_pending_kills",
    );
}

#[test]
fn golden_mafia_universe_poison_pending_target_already_dead() {
    let golden = load_golden_in("mafia_universe", "poison_pending_target_already_dead.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe poison_pending_target_already_dead",
    );
}

#[test]
fn golden_mafia_universe_douse_town_marks_target() {
    let golden = load_golden_in("mafia_universe", "douse_town_marks_target.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe douse_town_marks_target",
    );
}

#[test]
fn golden_mafia_universe_douse_mafia_marks_target() {
    let golden = load_golden_in("mafia_universe", "douse_mafia_marks_target.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe douse_mafia_marks_target",
    );
}

#[test]
fn golden_mafia_universe_ignite_reads_doused() {
    let golden = load_golden_in("mafia_universe", "ignite_reads_doused.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe ignite_reads_doused",
    );
}

#[test]
fn golden_mafia_universe_extinguish_town_preempts_ignite() {
    let golden = load_golden_in("mafia_universe", "extinguish_town_preempts_ignite.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe extinguish_town_preempts_ignite",
    );
}

#[test]
fn golden_mafia_universe_extinguish_town_firefighter_preempt_preempts_ignite() {
    let golden = load_golden_in(
        "mafia_universe",
        "extinguish_town_firefighter_preempt_preempts_ignite.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe extinguish_town_firefighter_preempt_preempts_ignite",
    );
}

#[test]
fn golden_mafia_universe_extinguish_mafia_preempts_ignite() {
    let golden = load_golden_in("mafia_universe", "extinguish_mafia_preempts_ignite.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe extinguish_mafia_preempts_ignite",
    );
}

#[test]
fn golden_mafia_universe_motivator_town_grants_extra_action() {
    let golden = load_golden_in("mafia_universe", "motivator_town_grants_extra_action.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe motivator_town_grants_extra_action",
    );
}

#[test]
fn golden_mafia_universe_motivator_mafia_grants_extra_action() {
    let golden = load_golden_in("mafia_universe", "motivator_mafia_grants_extra_action.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe motivator_mafia_grants_extra_action",
    );
}

#[test]
fn golden_mafia_universe_fruit_vendor_town_sends_fruit() {
    let golden = load_golden_in("mafia_universe", "fruit_vendor_town_sends_fruit.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe fruit_vendor_town_sends_fruit",
    );
}

#[test]
fn golden_mafia_universe_fruit_vendor_mafia_sends_fruit() {
    let golden = load_golden_in("mafia_universe", "fruit_vendor_mafia_sends_fruit.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe fruit_vendor_mafia_sends_fruit",
    );
}

#[test]
fn golden_mafia_universe_inventor_town_grants_item() {
    let golden = load_golden_in("mafia_universe", "inventor_town_grants_item.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe inventor_town_grants_item",
    );
}

#[test]
fn golden_mafia_universe_inventor_mafia_grants_item() {
    let golden = load_golden_in("mafia_universe", "inventor_mafia_grants_item.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe inventor_mafia_grants_item",
    );
}

#[test]
fn golden_mafia_universe_inventor_item_investigate_consumed() {
    let golden = load_golden_in("mafia_universe", "inventor_item_investigate_consumed.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe inventor_item_investigate_consumed",
    );
}

#[test]
fn golden_mafia_universe_inventor_item_inventory_exhausted() {
    let golden = load_golden_in("mafia_universe", "inventor_item_inventory_exhausted.json");
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe inventor_item_inventory_exhausted",
    );
}

#[test]
fn golden_mafia_universe_inventor_vest_item_marks_bulletproof_vest() {
    let golden = load_golden_in(
        "mafia_universe",
        "inventor_vest_item_marks_bulletproof_vest.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe inventor_vest_item_marks_bulletproof_vest",
    );
}

#[test]
fn golden_mafia_universe_empower_town_bypasses_block_and_redirect() {
    let golden = load_golden_in(
        "mafia_universe",
        "empower_town_bypasses_block_and_redirect.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe empower_town_bypasses_block_and_redirect",
    );
}

#[test]
fn golden_mafia_universe_empower_mafia_bypasses_block_and_redirect() {
    let golden = load_golden_in(
        "mafia_universe",
        "empower_mafia_bypasses_block_and_redirect.json",
    );
    let got = run(&golden["input"], load_pack_named("mafia_universe"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "mafia_universe empower_mafia_bypasses_block_and_redirect",
    );
}

#[test]
fn golden_bomb_trigger() {
    let golden = load_golden_in("epicmafia", "bomb_trigger.json");
    let got = run(&golden["input"], load_pack_named("epicmafia"));
    assert_events_eq(&got, &expected_events(&golden), "bomb_trigger");
}

#[test]
fn golden_cult_convert() {
    let golden = load_golden_in("epicmafia", "cult_convert.json");
    let got = run(&golden["input"], load_pack_named("epicmafia"));
    assert_events_eq(&got, &expected_events(&golden), "cult_convert");
}

#[test]
fn golden_epicmafia_pk_host_decides_tie_prompt() {
    let golden = load_golden_in("epicmafia", "pk_host_decides_tie_prompt.json");
    let got = run(&golden["input"], load_pack_named("epicmafia"));
    assert_events_eq(
        &got,
        &expected_events(&golden),
        "epicmafia pk_host_decides_tie_prompt",
    );
}

#[test]
fn trace_records_epicmafia_pk_host_decides_prompt() {
    let golden = load_golden_in("epicmafia", "pk_host_decides_tie_prompt.json");
    let output = run_output(
        &golden["input"],
        load_pack_named("epicmafia"),
        "pk-host-decides-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.stage == "day:vote_prompt"
                && decision.source == "day_vote"
                && decision.outcome == "host_prompt_issued"
                && decision.detail["policy"] == "pk_host_decides_tie"
        })
        .expect("HostDecides Tie should emit a PK host-prompt trace decision");
    assert_eq!(decision.detail["prompt_id"], "D01:pk:Tie");
    assert_eq!(decision.detail["kind"], "pk");
    assert_eq!(decision.detail["subject"], Value::Null);
    assert_eq!(decision.detail["reason"], "host_decides_tie");
    assert_eq!(decision.detail["status"], "Tie");
    assert_eq!(decision.detail["tiebreak"], "HostDecides");
    assert_eq!(
        decision.detail["contenders"],
        serde_json::json!(["slot_2", "slot_4"])
    );
}

#[test]
fn trace_records_cult_conversion_assignment() {
    let golden = load_golden_in("epicmafia", "cult_convert.json");
    let output = run_output(
        &golden["input"],
        load_pack_named("epicmafia"),
        "cult-convert-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| decision.outcome == "conversion_assigned_role")
        .expect("cult recruit should emit an assigned-role conversion trace decision");
    assert_eq!(decision.stage, "night:conversion");
    assert_eq!(decision.source, "action:sub_001");
    assert_eq!(decision.detail["action_id"], "sub_001");
    assert_eq!(decision.detail["template_id"], "cult_recruit");
    assert_eq!(decision.detail["actor"], "slot_1");
    assert_eq!(decision.detail["target"], "slot_2");
    assert_eq!(decision.detail["mode"], "AssignRole");
    assert_eq!(decision.detail["new_role"], "cultist");
    assert_eq!(decision.detail["new_alignment"], "cult");
    assert_eq!(decision.detail["original_role"], "villager");
    assert_eq!(decision.detail["original_alignment"], "town");
}

#[test]
fn golden_cult_convert_loyal_variant() {
    // Swap slot_2's role to `loyal_villager` (carries the "loyal" effect). The
    // recruit is rebuffed -> ConversionBlocked instead of PlayerConverted.
    let golden = load_golden_in("epicmafia", "cult_convert.json");
    let mut input = golden["input"].clone();
    for slot in input["state"]["slots"].as_array_mut().unwrap() {
        if slot["slot_id"] == "slot_2" {
            slot["role_key"] = Value::from("loyal_villager");
        }
    }
    let got = run(&input, load_pack_named("epicmafia"));
    let expected = golden["variant_note"]["expected_events"]
        .as_array()
        .expect("variant expected_events")
        .clone();
    assert_events_eq(&got, &expected, "cult_convert loyal variant");
}

#[test]
fn trace_records_loyal_conversion_block() {
    let golden = load_golden_in("epicmafia", "cult_convert.json");
    let mut input = golden["input"].clone();
    for slot in input["state"]["slots"].as_array_mut().unwrap() {
        if slot["slot_id"] == "slot_2" {
            slot["role_key"] = Value::from("loyal_villager");
        }
    }
    let output = run_output(
        &input,
        load_pack_named("epicmafia"),
        "loyal-convert-block-trace-run",
    );

    let decision = output
        .trace
        .decisions
        .iter()
        .find(|decision| {
            decision.outcome == "conversion_blocked" && decision.detail["reason"] == "loyal"
        })
        .expect("loyal recruit target should emit a conversion-block trace decision");
    assert_eq!(decision.stage, "night:conversion");
    assert_eq!(decision.source, "action:sub_001");
    assert_eq!(decision.detail["action_id"], "sub_001");
    assert_eq!(decision.detail["template_id"], "cult_recruit");
    assert_eq!(decision.detail["actor"], "slot_1");
    assert_eq!(decision.detail["target"], "slot_2");
    assert_eq!(decision.detail["target_role"], "loyal_villager");
    assert_eq!(decision.detail["target_alignment"], "town");
    assert_eq!(decision.detail["mode"], "AssignRole");
}

#[test]
fn resolve_is_deterministic() {
    // Same input twice -> byte-identical event JSON.
    let golden = load_golden("day_vote_tiebreak.json");
    let a = run(&golden["input"], load_pack());
    let b = run(&golden["input"], load_pack());
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap()
    );
}
