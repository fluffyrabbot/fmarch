//! Trigger observation and deterministic fixpoint resolution.
//!
//! The coordinator supplies ordered observations and mutable resolution sinks;
//! this module owns matching, generated action/event construction, iteration,
//! and the optional night-only dependency cascade between fixpoint rounds.

use super::intake::Action;
use super::*;

#[derive(Clone)]
pub(super) struct TriggerObservation {
    pub(super) on: TriggerOn,
    pub(super) target: SlotId,
    pub(super) actor: SlotId,
    pub(super) cause: String,
    pub(super) target_tags: Vec<String>,
    pub(super) actor_tags: Vec<String>,
}

pub(super) struct TriggerCascadeContext<'a> {
    pub(super) guard_dependencies: &'a [GuardDependency],
    pub(super) hide_dependencies: &'a [HideDependency],
    pub(super) kill_log: &'a mut Vec<KillRecord>,
}

#[derive(Clone, Copy)]
pub(super) enum ProducedKillCollection {
    Return,
    FrontierOnly,
}

pub(super) struct TriggerResolutionContext<'a> {
    pub(super) input: &'a ResolutionInput,
    pub(super) protections: &'a BTreeMap<SlotId, Vec<ProtectionSource>>,
    pub(super) transient_effects: &'a BTreeMap<SlotId, BTreeSet<String>>,
    pub(super) killed: &'a mut Vec<SlotId>,
    pub(super) cpr_saves: &'a mut BTreeSet<String>,
    pub(super) events: &'a mut Vec<InnerEvent>,
    pub(super) trace_decisions: &'a mut Vec<DecisionTrace>,
    pub(super) trace_notes: &'a mut Vec<String>,
    pub(super) produced_kill_collection: ProducedKillCollection,
    pub(super) cascade: Option<TriggerCascadeContext<'a>>,
}

fn trigger_slot_has_tags(tags: &[String], slot: &SlotState, observation_tags: &[String]) -> bool {
    tags.iter()
        .all(|tag| slot.effects.contains(tag) || observation_tags.contains(tag))
}

/// Does a trigger match the observed target and actor slots? `if_target_has`
/// matches the visited/killed slot; `if_actor_has` matches the visitor/killer.
fn trigger_observation_matches(
    trig: &TriggerRule,
    target_slot: &SlotState,
    actor_slot: Option<&SlotState>,
    observation: &TriggerObservation,
) -> bool {
    if !trigger_slot_has_tags(&trig.if_target_has, target_slot, &observation.target_tags) {
        return false;
    }
    if trig.if_actor_has.is_empty() {
        return true;
    }
    actor_slot
        .map(|slot| trigger_slot_has_tags(&trig.if_actor_has, slot, &observation.actor_tags))
        .unwrap_or(false)
}

fn trigger_on_label(on: TriggerOn) -> &'static str {
    match on {
        TriggerOn::Ability(IrAbility::Kill) => "Kill",
        TriggerOn::Ability(IrAbility::Protect) => "Protect",
        TriggerOn::Ability(IrAbility::Block) => "Block",
        TriggerOn::Ability(IrAbility::Redirect) => "Redirect",
        TriggerOn::Ability(IrAbility::Investigate) => "Investigate",
        TriggerOn::Ability(IrAbility::Convert) => "Convert",
        TriggerOn::Ability(IrAbility::Mark) => "Mark",
        TriggerOn::Ability(IrAbility::Clear) => "Clear",
        TriggerOn::Ability(IrAbility::Grant) => "Grant",
        TriggerOn::Ability(IrAbility::Link) => "Link",
        TriggerOn::Ability(IrAbility::Retaliate) => "Retaliate",
        TriggerOn::Ability(IrAbility::Badge) => "Badge",
        TriggerOn::Ability(IrAbility::Duel) => "Duel",
        TriggerOn::Ability(IrAbility::ItaShot) => "ItaShot",
        TriggerOn::Ability(IrAbility::SelfDestruct) => "SelfDestruct",
        TriggerOn::Ability(IrAbility::Visit) => "Visit",
        TriggerOn::Ability(IrAbility::RevealTown) => "RevealTown",
        TriggerOn::Ability(IrAbility::VoteDuel) => "VoteDuel",
        TriggerOn::Ability(IrAbility::Veto) => "Veto",
        TriggerOn::Ability(IrAbility::Info) => "Info",
        TriggerOn::Event(TriggerEvent::Visit) => "Visit",
        TriggerOn::Event(TriggerEvent::Lynch) => "Lynch",
        TriggerOn::Event(TriggerEvent::Death) => "Death",
        TriggerOn::Event(TriggerEvent::EffectMarked) => "EffectMarked",
        TriggerOn::Event(TriggerEvent::PhaseEnd) => "PhaseEnd",
        TriggerOn::Event(TriggerEvent::Win) => "Win",
    }
}

fn kill_observations(record: &KillRecord) -> Vec<TriggerObservation> {
    vec![
        TriggerObservation {
            on: TriggerOn::Ability(IrAbility::Kill),
            target: record.target.clone(),
            actor: record.attacker.clone(),
            cause: record.cause.clone(),
            target_tags: Vec::new(),
            actor_tags: Vec::new(),
        },
        TriggerObservation {
            on: TriggerOn::Event(TriggerEvent::Death),
            target: record.target.clone(),
            actor: record.attacker.clone(),
            cause: record.cause.clone(),
            target_tags: Vec::new(),
            actor_tags: Vec::new(),
        },
    ]
}

fn visit_observations(actions: &[Action<'_>]) -> Vec<TriggerObservation> {
    let mut observations = Vec::new();
    for action in actions {
        if action.blocked {
            continue;
        }
        for target in &action.targets {
            observations.push(TriggerObservation {
                on: TriggerOn::Ability(IrAbility::Visit),
                target: target.clone(),
                actor: action.sub.actor.clone(),
                cause: action.template.id.clone(),
                target_tags: Vec::new(),
                actor_tags: Vec::new(),
            });
        }
    }
    observations
}

pub(super) fn effect_marked_observation(
    target: SlotId,
    actor: SlotId,
    effect: String,
    source_action: String,
) -> TriggerObservation {
    TriggerObservation {
        on: TriggerOn::Event(TriggerEvent::EffectMarked),
        target,
        actor,
        cause: source_action,
        target_tags: vec![effect],
        actor_tags: Vec::new(),
    }
}

pub(super) fn phase_end_observations(
    input: &ResolutionInput,
    killed: &[SlotId],
) -> Vec<TriggerObservation> {
    let killed: BTreeSet<SlotId> = killed.iter().cloned().collect();
    input
        .state
        .slots
        .iter()
        .filter(|slot| slot.is_alive() && !killed.contains(&slot.slot_id))
        .map(|slot| TriggerObservation {
            on: TriggerOn::Event(TriggerEvent::PhaseEnd),
            target: slot.slot_id.clone(),
            actor: slot.slot_id.clone(),
            cause: format!("phase_end:{}", input.phase_id),
            target_tags: Vec::new(),
            actor_tags: Vec::new(),
        })
        .collect()
}

fn win_observations(state: &StateSnapshot, winner: &str) -> Vec<TriggerObservation> {
    state
        .slots
        .iter()
        .filter(|slot| slot.is_alive())
        .map(|slot| TriggerObservation {
            on: TriggerOn::Event(TriggerEvent::Win),
            target: slot.slot_id.clone(),
            actor: slot.slot_id.clone(),
            cause: format!("win:{winner}"),
            target_tags: vec!["win".to_string(), format!("winner:{winner}")],
            actor_tags: Vec::new(),
        })
        .collect()
}

pub(super) fn collect_night_observations(
    input: &ResolutionInput,
    actions: &[Action<'_>],
    kill_log: &[KillRecord],
    effect_marked: Vec<TriggerObservation>,
    killed: &[SlotId],
) -> Vec<TriggerObservation> {
    let mut frontier = kill_log
        .iter()
        .flat_map(kill_observations)
        .collect::<Vec<_>>();
    frontier.extend(visit_observations(actions));
    frontier.extend(effect_marked);
    frontier.extend(phase_end_observations(input, killed));
    frontier
}

pub(super) fn apply_win_triggers_before_final(
    input: &ResolutionInput,
    events: &mut Vec<InnerEvent>,
    tentative_win: &InnerEvent,
    trace_decisions: &mut Vec<DecisionTrace>,
    trace_notes: &mut Vec<String>,
) {
    let InnerEvent::WinReached { winner, .. } = tentative_win else {
        return;
    };
    let Some(InnerEvent::PhaseAnnouncement(announcement)) = events.pop() else {
        panic!("resolver invariant: PhaseAnnouncement must precede Win trigger observation");
    };
    let mut announced_deaths = announcement.deaths;
    let mut announced_slots = announced_deaths
        .iter()
        .map(|death| death.slot_id.clone())
        .collect::<BTreeSet<_>>();

    let state_before_final = apply_events(&input.state, events);
    let mut killed = deaths_from_events(events)
        .into_iter()
        .map(|death| death.slot_id)
        .collect::<Vec<_>>();
    let mut cpr_saves = BTreeSet::new();
    let no_protections = BTreeMap::new();
    let no_transient_effects = BTreeMap::new();
    let _generated_kills = apply_trigger_fixpoint(
        TriggerResolutionContext {
            input,
            protections: &no_protections,
            transient_effects: &no_transient_effects,
            killed: &mut killed,
            cpr_saves: &mut cpr_saves,
            events,
            trace_decisions,
            trace_notes,
            produced_kill_collection: ProducedKillCollection::Return,
            cascade: None,
        },
        win_observations(&state_before_final, winner),
    );
    for death in deaths_from_events(events) {
        if announced_slots.insert(death.slot_id.clone()) {
            announced_deaths.push(death);
        }
    }
    events.push(InnerEvent::PhaseAnnouncement(phase_announcement(
        input,
        announced_deaths,
    )));
}

pub(super) fn apply_trigger_fixpoint(
    context: TriggerResolutionContext<'_>,
    mut frontier: Vec<TriggerObservation>,
) -> Vec<KillRecord> {
    let TriggerResolutionContext {
        input,
        protections,
        transient_effects,
        killed,
        cpr_saves,
        events,
        trace_decisions,
        trace_notes,
        produced_kill_collection,
        mut cascade,
    } = context;
    let pack = &input.pack;
    let loop_cap = pack.redirects.loop_cap as usize;
    let mut produced_kills = Vec::new();
    let mut iterations = 0usize;
    while !frontier.is_empty() {
        if iterations >= loop_cap {
            trace_notes.push(format!(
                "trigger loop_cap ({loop_cap}) reached; terminating trigger fixpoint"
            ));
            break;
        }
        iterations += 1;
        let mut next_kills = Vec::new();
        for observation in &frontier {
            for trig in &pack.triggers {
                if trig.on != observation.on
                    || !night_resolution_trigger_participates_in_fixpoint(pack, trig)
                {
                    continue;
                }
                let Some(target_slot) = input
                    .state
                    .slots
                    .iter()
                    .find(|slot| slot.slot_id == observation.target)
                else {
                    continue;
                };
                let actor_slot = input
                    .state
                    .slots
                    .iter()
                    .find(|slot| slot.slot_id == observation.actor);
                if !trigger_observation_matches(trig, target_slot, actor_slot, observation) {
                    continue;
                }
                let produced_actor = match trig.produces.actor {
                    ActorRef::Target => observation.target.clone(),
                    ActorRef::Actor => observation.actor.clone(),
                    ActorRef::TargetGuard | ActorRef::Other => continue,
                };
                let produced_target = match trig.produces.target {
                    TargetRef::Killer | TargetRef::Actor => observation.actor.clone(),
                    TargetRef::Target => observation.target.clone(),
                    TargetRef::Other => continue,
                };
                let mut payload = serde_json::json!({
                    "on": trigger_on_label(observation.on),
                    "source_target": observation.target,
                    "source_actor": observation.actor,
                    "source_cause": observation.cause,
                    "produced_actor": produced_actor,
                    "produced_target": produced_target,
                });
                if !trig.if_actor_has.is_empty() {
                    payload["actor_filter"] = serde_json::json!(trig.if_actor_has);
                }
                events.push(InnerEvent::Trigger {
                    trigger_id: trig.id.clone(),
                    payload,
                });
                if trig.produces.ability != IrAbility::Kill {
                    continue;
                }
                let strongman = night_resolution_generated_kill_bypasses_protect(pack, trig);
                let generated_target_tags = target_tags(input, transient_effects, &produced_target);
                if let Some(reason) =
                    target_state_gate_reason(pack, &generated_target_tags, IrAbility::Kill)
                {
                    trace_decisions.push(DecisionTrace {
                        stage: "kill_resolution".to_string(),
                        source: format!("cause:{}", trig.id),
                        outcome: "kill_skipped_by_target_state".to_string(),
                        detail: crate::json_atom!({
                            "action_id": trig.id,
                            "template_id": trig.id,
                            "actor": produced_actor,
                            "target": produced_target,
                            "reason": reason,
                            "target_tags": generated_target_tags,
                        }),
                    });
                    continue;
                }
                resolve_one_kill(
                    ActionResolutionContext {
                        input,
                        protections,
                        cpr_saves: &mut *cpr_saves,
                        events: &mut *events,
                        killed: &mut *killed,
                        log: &mut next_kills,
                        trace_decisions: &mut *trace_decisions,
                    },
                    KillAction {
                        target: &produced_target,
                        attacker: &produced_actor,
                        cause: &trig.id,
                        unstoppable: strongman,
                        death_reveal: death_reveal_mode(input, &produced_target, &trig.id),
                        target_tags: &generated_target_tags,
                    },
                );
            }
        }
        if matches!(produced_kill_collection, ProducedKillCollection::Return) {
            produced_kills.extend(next_kills.clone());
        }
        if let Some(cascade) = cascade.as_mut() {
            next_kills.extend(apply_guard_dependency_deaths(
                input,
                cascade.guard_dependencies,
                &mut *killed,
                &mut *cascade.kill_log,
                &mut *events,
                &mut *trace_decisions,
            ));
            next_kills.extend(apply_hide_dependency_deaths(
                input,
                cascade.hide_dependencies,
                &mut *killed,
                &mut *cascade.kill_log,
                &mut *events,
                &mut *trace_decisions,
            ));
        }
        frontier = next_kills.iter().flat_map(kill_observations).collect();
    }
    produced_kills
}
