//! Redirect graph planning and target rewriting for night resolution.
//!
//! The coordinator supplies the prepared actions, validated pack policy, and
//! already-discovered empowered slots. This owner constructs the stable rule
//! graph once, applies each redirect action group at most once per target, and
//! emits the exact trace products associated with target mutation or bypass.

use std::collections::BTreeSet;

use crate::events::{DecisionTrace, TraceEdge};
use crate::ir::IrAbility;
use crate::pack::{Pack, RedirectKind};
use crate::state::SlotId;

use super::intake::{ability_order, Action};

#[derive(Clone)]
struct RedirectRule {
    group: usize,
    from: Option<SlotId>,
    to: SlotId,
    source_action_id: String,
    source_actor: SlotId,
    redirect_kind: RedirectKind,
}

#[derive(Clone)]
struct RedirectRules {
    rules: Vec<RedirectRule>,
    truncated: bool,
}

struct RedirectApplication {
    target: SlotId,
    steps: Vec<RedirectStep>,
}

struct RedirectStep {
    group: usize,
    from: Option<SlotId>,
    to: SlotId,
    source_action_id: String,
    source_actor: SlotId,
    redirect_kind: RedirectKind,
}

pub(super) struct RedirectResolutionContext<'context, 'action> {
    pub(super) actions: &'context mut [Action<'action>],
    pub(super) pack: &'context Pack,
    pub(super) empowered_slots: &'context BTreeSet<SlotId>,
    pub(super) trace_edges: &'context mut Vec<TraceEdge>,
    pub(super) trace_decisions: &'context mut Vec<DecisionTrace>,
    pub(super) trace_notes: &'context mut Vec<String>,
}

pub(super) fn resolve_redirects(context: RedirectResolutionContext<'_, '_>) {
    let RedirectResolutionContext {
        actions,
        pack,
        empowered_slots,
        trace_edges,
        trace_decisions,
        trace_notes,
    } = context;

    let redirect_rules = build_redirect_rules(actions, pack);
    if redirect_rules.truncated {
        trace_notes.push(format!(
            "redirect loop_cap ({}) reached; truncating redirect graph rules",
            pack.redirects.loop_cap
        ));
    }
    if redirect_rules.rules.is_empty() {
        return;
    }

    for action in actions {
        if action.blocked || !redirect_eligible(action) {
            continue;
        }

        let action_id = action.sub.action_id.clone();
        let template_id = action.template.id.clone();
        let actor = action.sub.actor.clone();
        if empowered_slots.contains(&actor) {
            let would_redirect = action.targets.iter().any(|target| {
                apply_redirect_rules(target, &redirect_rules.rules, pack.redirects.loop_cap).target
                    != *target
            });
            if would_redirect {
                trace_decisions.push(DecisionTrace {
                    stage: "night:redirect".to_string(),
                    source: "night_resolution.empower_effects".to_string(),
                    outcome: "action_redirect_bypassed".to_string(),
                    detail: serde_json::json!({
                        "actor": actor,
                        "action_id": action_id,
                        "template_id": template_id,
                        "targets": action.targets.clone(),
                        "empower_effects": pack.night_resolution.empower_effects.clone(),
                    }),
                });
            }
            continue;
        }

        for (target_index, target) in action.targets.iter_mut().enumerate() {
            let original = target.clone();
            let applied =
                apply_redirect_rules(&original, &redirect_rules.rules, pack.redirects.loop_cap);
            if applied.target != original {
                trace_edges.push(redirect_trace_edge(
                    &action_id,
                    &template_id,
                    &actor,
                    target_index,
                    &original,
                    &applied,
                ));
            }
            *target = applied.target;
        }
    }
}

fn redirect_eligible(action: &Action<'_>) -> bool {
    action.has_ability(IrAbility::Kill)
        || action.has_ability(IrAbility::Protect)
        || action.has_ability(IrAbility::Convert)
        || action.has_ability(IrAbility::Grant)
        || action.has_ability(IrAbility::Link)
        || action.has_ability(IrAbility::Retaliate)
        || action.has_ability(IrAbility::Visit)
        || action.has_ability(IrAbility::Investigate)
}

/// Build ordered target-rewrite rules. Each redirect action contributes rules
/// once, in action order; applying a target through this ordered list composes
/// redirects without re-applying the same action forever.
fn build_redirect_rules(actions: &[Action<'_>], pack: &Pack) -> RedirectRules {
    let mut rules = Vec::new();
    let mut truncated = false;
    let cap = pack.redirects.loop_cap as usize;
    let target_space = redirect_target_space(actions);
    for (group, idx) in ability_order(actions, IrAbility::Redirect)
        .into_iter()
        .enumerate()
    {
        if actions[idx].blocked {
            continue;
        }
        if rules.len() >= cap {
            truncated = true;
            break;
        }
        let targets = &actions[idx].targets;
        let source_action_id = actions[idx].sub.action_id.clone();
        let source_actor = actions[idx].sub.actor.clone();
        match actions[idx].template.redirect {
            Some(RedirectKind::Swap) if targets.len() == 2 && targets[0] != targets[1] => {
                rules.push(RedirectRule {
                    group,
                    from: Some(targets[0].clone()),
                    to: targets[1].clone(),
                    source_action_id: source_action_id.clone(),
                    source_actor: source_actor.clone(),
                    redirect_kind: RedirectKind::Swap,
                });
                rules.push(RedirectRule {
                    group,
                    from: Some(targets[1].clone()),
                    to: targets[0].clone(),
                    source_action_id,
                    source_actor,
                    redirect_kind: RedirectKind::Swap,
                });
            }
            Some(RedirectKind::Rotate) if targets.len() >= 3 => {
                for (from, to) in targets
                    .iter()
                    .zip(targets.iter().cycle().skip(1))
                    .take(targets.len())
                {
                    if from == to {
                        continue;
                    }
                    rules.push(RedirectRule {
                        group,
                        from: Some(from.clone()),
                        to: to.clone(),
                        source_action_id: source_action_id.clone(),
                        source_actor: source_actor.clone(),
                        redirect_kind: RedirectKind::Rotate,
                    });
                }
            }
            Some(RedirectKind::Retarget) if targets.len() == 2 && targets[0] != targets[1] => {
                rules.push(RedirectRule {
                    group,
                    from: Some(targets[0].clone()),
                    to: targets[1].clone(),
                    source_action_id,
                    source_actor,
                    redirect_kind: RedirectKind::Retarget,
                });
            }
            Some(RedirectKind::Pull) => {
                let destination = targets
                    .first()
                    .cloned()
                    .unwrap_or_else(|| actions[idx].sub.actor.clone());
                for source in &target_space {
                    if source != &destination {
                        rules.push(RedirectRule {
                            group,
                            from: Some(source.clone()),
                            to: destination.clone(),
                            source_action_id: source_action_id.clone(),
                            source_actor: source_actor.clone(),
                            redirect_kind: RedirectKind::Pull,
                        });
                    }
                }
            }
            _ => {}
        }
    }
    let _ = pack.redirects.tie_breaker; // Stable: source ordering is already stable.
    if rules.len() > cap {
        truncated = true;
        rules.truncate(cap);
    }
    RedirectRules { rules, truncated }
}

fn redirect_target_space(actions: &[Action<'_>]) -> Vec<SlotId> {
    let mut target_space = Vec::new();
    for action in actions {
        if action.blocked || action.has_ability(IrAbility::Redirect) || !redirect_eligible(action) {
            continue;
        }
        for target in &action.targets {
            if !target_space.contains(target) {
                target_space.push(target.clone());
            }
        }
    }
    target_space
}

fn apply_redirect_rules(
    target: &SlotId,
    rules: &[RedirectRule],
    loop_cap: u16,
) -> RedirectApplication {
    let mut current = target.clone();
    let mut steps = Vec::new();
    let mut applied = 0usize;
    let cap = loop_cap as usize;
    let mut applied_groups = BTreeSet::new();
    for rule in rules {
        if applied >= cap {
            break;
        }
        if applied_groups.contains(&rule.group) {
            continue;
        }
        let matches = rule
            .from
            .as_ref()
            .map(|from| from == &current)
            .unwrap_or(true);
        if matches {
            current = rule.to.clone();
            applied += 1;
            applied_groups.insert(rule.group);
            steps.push(RedirectStep {
                group: rule.group,
                from: rule.from.clone(),
                to: rule.to.clone(),
                source_action_id: rule.source_action_id.clone(),
                source_actor: rule.source_actor.clone(),
                redirect_kind: rule.redirect_kind,
            });
        }
    }
    RedirectApplication {
        target: current,
        steps,
    }
}

fn redirect_trace_edge(
    action_id: &str,
    template_id: &str,
    actor: &SlotId,
    target_index: usize,
    original: &SlotId,
    applied: &RedirectApplication,
) -> TraceEdge {
    let steps: Vec<serde_json::Value> = applied
        .steps
        .iter()
        .map(|step| {
            serde_json::json!({
                "group": step.group,
                "from": step.from,
                "to": step.to,
                "redirect_action_id": step.source_action_id,
                "redirect_actor": step.source_actor,
                "redirect_kind": step.redirect_kind,
            })
        })
        .collect();
    TraceEdge {
        from: format!("{action_id}:target:{target_index}:{original}"),
        to: format!("{}:target:{target_index}:{}", action_id, applied.target),
        kind: "redirect".to_string(),
        detail: serde_json::json!({
            "action_id": action_id,
            "template_id": template_id,
            "actor": actor,
            "target_index": target_index,
            "original_target": original,
            "final_target": applied.target,
            "steps": steps,
        }),
    }
}
