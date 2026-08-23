//! Night-action collection, coordination, constraint admission, and ordering.
//!
//! The coordinator constructs one immutable preparation input and receives
//! owned ordered products. History recording remains owned here but is evaluated
//! by the coordinator at its established late-resolution position, after target
//! rewrites have settled.

use std::collections::{BTreeMap, BTreeSet};

use crate::events::{DecisionTrace, InnerEvent};
use crate::ir::{IrAbility, Modifier};
use crate::pack::{
    ActionTemplate, ActivationGateReason, FactionVoteTieBreaker, PhaseParity, RoleModifier,
    TargetSpec, Window,
};
use crate::phase::PhaseKind;
use crate::state::{SlotId, Submission};

use super::{
    action_counter_exhausted, action_use_counted, alive_slot_ids, lookup_submission_template,
    phase_window_matches, slot_alignment, slot_role, ResolutionInput,
};

/// One resolved night action: a submission paired with its role action template.
pub(super) struct Action<'a> {
    pub(super) sub: &'a Submission,
    pub(super) template: &'a ActionTemplate,
    /// Live targets after any redirect rewrite.
    pub(super) targets: Vec<SlotId>,
    pub(super) blocked: bool,
}

impl Action<'_> {
    pub(super) fn has_ability(&self, ability: IrAbility) -> bool {
        self.template.has_ability(ability)
    }
}

pub(super) struct NightActionPreparationInput<'a> {
    pub(super) resolution: &'a ResolutionInput,
}

pub(super) struct NightActionPreparationOutput<'a> {
    pub(super) actions: Vec<Action<'a>>,
    pub(super) prefix_events: Vec<InnerEvent>,
    pub(super) trace_decisions: Vec<DecisionTrace>,
    pub(super) history: NightActionHistory,
}

pub(super) struct NightActionHistory;

impl NightActionHistory {
    pub(super) fn events(self, input: &ResolutionInput, actions: &[Action<'_>]) -> Vec<InnerEvent> {
        history_sensitive_action_events(input, actions)
    }
}

pub(super) fn prepare_night_actions(
    input: NightActionPreparationInput<'_>,
) -> NightActionPreparationOutput<'_> {
    let input = input.resolution;
    let mut actions = input
        .submissions
        .iter()
        .filter(|submission| !submission.withdrawn)
        .filter_map(|submission| {
            let template = lookup_submission_template(input, submission)?;
            phase_window_matches(template.window, input.state.phase_id.kind()).then(|| Action {
                sub: submission,
                template,
                targets: submission.targets.clone(),
                blocked: false,
            })
        })
        .collect::<Vec<_>>();

    let mut prefix_events = Vec::new();
    let mut trace_decisions = Vec::new();
    emit_missing_compulsive_actions(input, &actions, &mut prefix_events);
    apply_faction_action_coordination(input, &mut actions, &mut prefix_events);
    apply_action_constraints(
        input,
        &mut actions,
        &mut prefix_events,
        &mut trace_decisions,
    );
    NightActionPreparationOutput {
        actions,
        prefix_events,
        trace_decisions,
        history: NightActionHistory,
    }
}

fn has_history_sensitive_modifier(action: &Action<'_>) -> bool {
    action.template.has_modifier(Modifier::NonConsecutive)
        || action.template.has_modifier(Modifier::Indecisive)
        || action.template.has_modifier(Modifier::Roaming)
        || action.template.has_modifier(Modifier::Compulsive)
}

fn repeated_target_limiter_reason(
    input: &ResolutionInput,
    action: &Action<'_>,
) -> Option<&'static str> {
    let reason = if action.template.has_modifier(Modifier::NonConsecutive) {
        "non_consecutive"
    } else if action.template.has_modifier(Modifier::Indecisive) {
        "indecisive"
    } else if action.template.has_modifier(Modifier::Roaming) {
        "roaming"
    } else {
        return None;
    };
    let repeated = input.state.action_history.iter().any(|record| {
        let in_scope = if action.template.has_modifier(Modifier::Roaming) {
            record.phase_id.kind() == PhaseKind::Night
        } else {
            record.phase_id.kind() == PhaseKind::Night
                && record.phase_id.number().checked_add(1) == Some(input.state.phase_id.number())
        };
        record.actor == action.sub.actor
            && record.template_id == action.template.id
            && in_scope
            && record.status == "resolved"
            && action
                .targets
                .iter()
                .any(|target| record.targets.contains(target))
    });
    repeated.then_some(reason)
}

fn target_shape_error(action: &Action<'_>) -> Option<&'static str> {
    match action.template.targets {
        TargetSpec::None if !action.targets.is_empty() => Some("target_count"),
        TargetSpec::One if action.targets.len() != 1 => Some("target_count"),
        TargetSpec::Many | TargetSpec::Group
            if action.targets.is_empty()
                || action.targets.len() > action.template.constraints.max_targets as usize =>
        {
            Some("target_count")
        }
        _ => None,
    }
}

fn duplicate_target_error(action: &Action<'_>) -> bool {
    if !action.template.constraints.unique_targets {
        return false;
    }
    let unique = action
        .targets
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    unique.len() != action.targets.len()
}

fn self_target_error(action: &Action<'_>) -> bool {
    !action.template.constraints.self_allowed
        && action
            .targets
            .iter()
            .any(|target| target == &action.sub.actor)
}

fn personal_target_error(action: &Action<'_>) -> bool {
    action.template.constraints.personal_only
        && action
            .targets
            .iter()
            .any(|target| target != &action.sub.actor)
}

fn target_role_filter_error(input: &ResolutionInput, action: &Action<'_>) -> bool {
    let Some(filter) = action.template.constraints.target_role_filter else {
        return false;
    };
    let vanilla_roles = &input.pack.investigation_results.role_sets.vanilla_roles;
    if vanilla_roles.is_empty() {
        return true;
    }
    action.targets.iter().any(|target| {
        let Some(role) = slot_role(input, target) else {
            return true;
        };
        let is_vanilla = vanilla_roles.iter().any(|candidate| candidate == role);
        match filter {
            crate::pack::TargetRoleFilter::PowerRole => is_vanilla,
            crate::pack::TargetRoleFilter::Vanilla => !is_vanilla,
        }
    })
}

fn disloyal_target_error(input: &ResolutionInput, action: &Action<'_>) -> bool {
    if !action.template.has_modifier(Modifier::Disloyal) {
        return false;
    }
    let Some(actor_alignment) = slot_alignment(input, &action.sub.actor) else {
        return true;
    };
    action.targets.iter().any(|target| {
        slot_alignment(input, target)
            .is_none_or(|target_alignment| target_alignment == actor_alignment)
    })
}

fn apply_faction_action_coordination(
    input: &ResolutionInput,
    actions: &mut [Action<'_>],
    events: &mut Vec<InnerEvent>,
) {
    if !input.pack.faction_actions.enabled {
        return;
    }

    for spec in &input.pack.faction_actions.actions {
        let mut candidates = Vec::new();
        for (idx, action) in actions.iter().enumerate() {
            if action.blocked || action.template.id != spec.action_id || action.targets.is_empty() {
                continue;
            }
            let Some(actor_slot) = input
                .state
                .slots
                .iter()
                .find(|slot| slot.slot_id == action.sub.actor)
            else {
                continue;
            };
            if actor_slot.alignment.as_deref() == Some(spec.alignment.as_str()) {
                candidates.push(idx);
            }
        }
        if candidates.len() <= spec.max_resolved_submissions as usize {
            continue;
        }

        let mut votes: BTreeMap<SlotId, Vec<usize>> = BTreeMap::new();
        for idx in candidates {
            votes
                .entry(actions[idx].targets[0].clone())
                .or_default()
                .push(idx);
        }
        let Some(max_votes) = votes.values().map(Vec::len).max() else {
            continue;
        };
        let tied_targets = votes
            .iter()
            .filter_map(|(target, indices)| (indices.len() == max_votes).then_some(target.clone()))
            .collect::<Vec<_>>();

        if tied_targets.len() > 1 && spec.target_tie == FactionVoteTieBreaker::BlockAll {
            for indices in votes.values() {
                for idx in indices {
                    actions[*idx].blocked = true;
                    events.push(InnerEvent::ActionInterfered {
                        actor: actions[*idx].sub.actor.clone(),
                        reason: "faction_vote_tie".to_string(),
                    });
                }
            }
            continue;
        }

        let selected_idx = tied_targets
            .iter()
            .filter_map(|target| votes.get(target))
            .flatten()
            .copied()
            .min_by(|a, b| {
                actions[*a]
                    .sub
                    .submitted_at
                    .cmp(&actions[*b].sub.submitted_at)
                    .then(actions[*a].sub.action_id.cmp(&actions[*b].sub.action_id))
                    .then(actions[*a].sub.actor.cmp(&actions[*b].sub.actor))
            });
        let Some(selected_idx) = selected_idx else {
            continue;
        };

        for indices in votes.values() {
            for idx in indices {
                if *idx == selected_idx {
                    continue;
                }
                actions[*idx].blocked = true;
                events.push(InnerEvent::ActionInterfered {
                    actor: actions[*idx].sub.actor.clone(),
                    reason: "faction_vote_superseded".to_string(),
                });
            }
        }
    }
}

fn alive_non_town_count(input: &ResolutionInput) -> usize {
    input
        .state
        .slots
        .iter()
        .filter(|slot| slot.is_alive())
        .filter(|slot| slot.alignment.as_deref() != Some("town"))
        .count()
}

fn alive_slot_count(input: &ResolutionInput) -> usize {
    input
        .state
        .slots
        .iter()
        .filter(|slot| slot.is_alive())
        .count()
}

fn lazy_endgame_error(input: &ResolutionInput, action: &Action<'_>) -> bool {
    action.template.constraints.lazy_requires_multiple_non_town && alive_non_town_count(input) <= 1
}

fn disabled_endgame_error(input: &ResolutionInput, action: &Action<'_>) -> bool {
    action
        .template
        .constraints
        .disabled_at_or_below_alive
        .map(|threshold| alive_slot_count(input) <= threshold as usize)
        .unwrap_or(false)
}

fn base_role_submission(action: &Action<'_>) -> bool {
    !action.sub.metadata.contains_key("grant_id")
}

fn role_modifier_team_kill_error(input: &ResolutionInput, action: &Action<'_>) -> bool {
    if !input
        .pack
        .night_resolution
        .team_kill_action_ids
        .iter()
        .any(|id| id == &action.template.id)
    {
        return false;
    }
    let Some(actor_slot) = input
        .state
        .slots
        .iter()
        .find(|slot| slot.slot_id == action.sub.actor)
    else {
        return false;
    };
    let Some(role) = input.pack.roles.get(&actor_slot.role_key) else {
        return false;
    };
    let lost = role.has_modifier(RoleModifier::Lost);
    let recluse = role.has_modifier(RoleModifier::Recluse);
    if !lost && !recluse {
        return false;
    }
    if actor_slot.alignment.as_deref() != Some("mafia") {
        return true;
    }
    let mut living_teammates = input.state.slots.iter().filter(|slot| {
        slot.slot_id != actor_slot.slot_id
            && slot.is_alive()
            && slot.alignment.as_deref() == Some("mafia")
    });
    if lost {
        return living_teammates.count() > 0;
    }
    living_teammates.any(|slot| {
        input
            .pack
            .roles
            .get(&slot.role_key)
            .map(|role| !role.has_modifier(RoleModifier::Recluse))
            .unwrap_or(true)
    })
}

fn role_modifier_team_kill_reason<'a>(input: &'a ResolutionInput, action: &Action<'_>) -> &'a str {
    input
        .state
        .slots
        .iter()
        .find(|slot| slot.slot_id == action.sub.actor)
        .and_then(|slot| input.pack.roles.get(&slot.role_key))
        .filter(|role| role.has_modifier(RoleModifier::Recluse))
        .map(|_| "recluse")
        .unwrap_or("lost")
}

fn emit_missing_compulsive_actions(
    input: &ResolutionInput,
    actions: &[Action<'_>],
    events: &mut Vec<InnerEvent>,
) {
    for slot in input.state.slots.iter().filter(|slot| slot.is_alive()) {
        let Some(role) = input.pack.roles.get(&slot.role_key) else {
            continue;
        };
        for template in &role.actions {
            if !template.has_modifier(Modifier::Compulsive)
                || !matches!(template.window, Window::Night | Window::Any)
            {
                continue;
            }
            let submitted = actions.iter().any(|action| {
                action.sub.actor == slot.slot_id && action.template.id == template.id
            });
            if submitted {
                continue;
            }
            events.push(InnerEvent::ActionInterfered {
                actor: slot.slot_id.clone(),
                reason: "compulsive_missing".to_string(),
            });
            events.push(InnerEvent::ActionRecorded {
                actor: slot.slot_id.clone(),
                template_id: template.id.clone(),
                targets: Vec::new(),
                phase_id: input.phase_id.clone(),
                status: "missing".to_string(),
            });
        }
    }
}

fn phase_parity_matches(phase_number: u32, parity: PhaseParity) -> bool {
    match parity {
        PhaseParity::Odd => phase_number % 2 == 1,
        PhaseParity::Even => phase_number.is_multiple_of(2),
    }
}

fn activation_gate_reason(
    template: &ActionTemplate,
    phase_kind: PhaseKind,
    phase_number: u32,
) -> Option<&'static str> {
    let gate = template.constraints.active_from.as_ref()?;
    if gate.phase_kind == phase_kind && phase_number >= gate.phase_number {
        return None;
    }
    Some(match gate.reason {
        ActivationGateReason::Novice => "novice_inactive",
        ActivationGateReason::Activated => "activated_inactive",
    })
}

fn cooldown_counter_id(template_id: &str) -> String {
    format!("cooldown:{template_id}")
}

fn action_on_cooldown(
    input: &ResolutionInput,
    actor: &str,
    template_id: &str,
    cooldown_cycles: u16,
) -> bool {
    let counter_id = cooldown_counter_id(template_id);
    input.state.use_counters.iter().any(|counter| {
        counter.actor == actor
            && counter.counter_id == counter_id
            && counter.phase_id.kind() == input.state.phase_id.kind()
            && input.state.phase_id.number()
                <= counter
                    .phase_id
                    .number()
                    .saturating_add(u32::from(cooldown_cycles))
    })
}

fn cooldown_use_counted(
    input: &ResolutionInput,
    actor: SlotId,
    template_id: String,
    action_id: String,
    cooldown_cycles: u16,
) -> InnerEvent {
    InnerEvent::ActionUseCounted {
        counter_id: cooldown_counter_id(&template_id),
        actor,
        template_id,
        consumed_action: action_id,
        cadence_policy: "cooldown".to_string(),
        phase_scope: "phase_kind".to_string(),
        limit: cooldown_cycles,
        used: 1,
        remaining: cooldown_cycles,
        phase_id: input.phase_id.clone(),
    }
}

fn apply_action_constraints(
    input: &ResolutionInput,
    actions: &mut [Action<'_>],
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    let audience = alive_slot_ids(input);
    let mut base_role_submissions_seen = BTreeSet::new();
    for action in actions {
        if action.blocked {
            continue;
        }

        if base_role_submission(action) {
            let key = (action.sub.actor.clone(), action.template.id.clone());
            if !action.template.has_modifier(Modifier::Simultaneous)
                && !base_role_submissions_seen.insert(key)
            {
                suppress(action, events, "duplicate_submission");
                continue;
            }
        }

        if let Some(reason) = target_shape_error(action) {
            suppress(action, events, reason);
            continue;
        }
        if duplicate_target_error(action) {
            suppress(action, events, "duplicate_target");
            continue;
        }
        if self_target_error(action) {
            suppress(action, events, "self_target");
            continue;
        }
        if personal_target_error(action) {
            suppress(action, events, "personal");
            continue;
        }
        if target_role_filter_error(input, action) {
            suppress(action, events, "invalid_target_role");
            continue;
        }
        if disloyal_target_error(input, action) {
            action.blocked = true;
            trace_decisions.push(DecisionTrace {
                stage: "night:action_constraints".to_string(),
                source: format!("action:{}", action.sub.action_id),
                outcome: "action_suppressed".to_string(),
                detail: crate::json_atom!({
                    "action_id": action.sub.action_id.clone(),
                    "template_id": action.template.id.clone(),
                    "actor": action.sub.actor.clone(),
                    "actor_alignment": slot_alignment(input, &action.sub.actor),
                    "targets": action.targets.clone(),
                    "target_alignments": action
                        .targets
                        .iter()
                        .map(|target| serde_json::json!({
                            "target": target,
                            "alignment": slot_alignment(input, target),
                        }))
                        .collect::<Vec<_>>(),
                    "reason": "disloyal",
                }),
            });
            events.push(InnerEvent::ActionInterfered {
                actor: action.sub.actor.clone(),
                reason: "disloyal".to_string(),
            });
            continue;
        }
        if lazy_endgame_error(input, action) {
            suppress(action, events, "lazy");
            continue;
        }
        if disabled_endgame_error(input, action) {
            suppress(action, events, "disabled_endgame");
            continue;
        }
        if role_modifier_team_kill_error(input, action) {
            let reason = role_modifier_team_kill_reason(input, action);
            suppress(action, events, reason);
            continue;
        }
        if let Some(parity) = action.template.constraints.phase_parity {
            if !phase_parity_matches(input.state.phase_id.number(), parity) {
                let reason = match parity {
                    PhaseParity::Odd => "odd_night",
                    PhaseParity::Even => "even_night",
                };
                suppress(action, events, reason);
                continue;
            }
        }
        if let Some(parity) = action.template.constraints.cycle_parity {
            if !phase_parity_matches(input.state.phase_id.number(), parity) {
                let reason = match parity {
                    PhaseParity::Odd => "odd_cycle",
                    PhaseParity::Even => "even_cycle",
                };
                suppress(action, events, reason);
                continue;
            }
        }
        if let Some(reason) = activation_gate_reason(
            action.template,
            input.state.phase_id.kind(),
            input.state.phase_id.number(),
        ) {
            suppress(action, events, reason);
            continue;
        }
        if let Some(reason) = repeated_target_limiter_reason(input, action) {
            suppress(action, events, reason);
            continue;
        }
        if let Some(limit) = action.template.constraints.x_shots {
            if action_counter_exhausted(input, &action.sub.actor, &action.template.id, limit) {
                suppress(action, events, "x_shot_exhausted");
                continue;
            }
            events.push(action_use_counted(
                input,
                action.sub.actor.clone(),
                action.template.id.clone(),
                action.sub.action_id.clone(),
                limit,
            ));
        }
        if let Some(cooldown_cycles) = action.template.constraints.cooldown_cycles {
            if action_on_cooldown(
                input,
                &action.sub.actor,
                &action.template.id,
                cooldown_cycles,
            ) {
                suppress(action, events, "cooldown");
                continue;
            }
            events.push(cooldown_use_counted(
                input,
                action.sub.actor.clone(),
                action.template.id.clone(),
                action.sub.action_id.clone(),
                cooldown_cycles,
            ));
        }
        if action.template.has_modifier(Modifier::Loud) {
            events.push(InnerEvent::EffectNotification {
                effect: "loud".to_string(),
                status: action.template.id.clone(),
                audience: audience.clone(),
                phase_id: None,
            });
        }
        if action.template.has_modifier(Modifier::Announcing) {
            events.push(InnerEvent::EffectNotification {
                effect: "announcing".to_string(),
                status: action.template.id.clone(),
                audience: audience.clone(),
                phase_id: None,
            });
        }
    }
}

fn suppress(action: &mut Action<'_>, events: &mut Vec<InnerEvent>, reason: &str) {
    action.blocked = true;
    events.push(InnerEvent::ActionInterfered {
        actor: action.sub.actor.clone(),
        reason: reason.to_string(),
    });
}

fn history_sensitive_action_events(
    input: &ResolutionInput,
    actions: &[Action<'_>],
) -> Vec<InnerEvent> {
    actions
        .iter()
        .filter(|action| has_history_sensitive_modifier(action))
        .map(|action| InnerEvent::ActionRecorded {
            actor: action.sub.actor.clone(),
            template_id: action.template.id.clone(),
            targets: action.targets.clone(),
            phase_id: input.phase_id.clone(),
            status: if action.blocked {
                "suppressed"
            } else {
                "resolved"
            }
            .to_string(),
        })
        .collect()
}

/// Indices of actions with the given ability, ordered by descending priority,
/// then ascending submission time and action id for a total stable order.
pub(super) fn ability_order(actions: &[Action<'_>], ability: IrAbility) -> Vec<usize> {
    let mut indices = actions
        .iter()
        .enumerate()
        .filter(|(_, action)| action.has_ability(ability))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    indices.sort_by(|&left, &right| {
        actions[right]
            .template
            .constraints
            .priority
            .cmp(&actions[left].template.constraints.priority)
            .then(
                actions[left]
                    .sub
                    .submitted_at
                    .cmp(&actions[right].sub.submitted_at),
            )
            .then(
                actions[left]
                    .sub
                    .action_id
                    .cmp(&actions[right].sub.action_id),
            )
    });
    indices
}
