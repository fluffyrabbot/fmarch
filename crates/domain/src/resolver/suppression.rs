//! Block suppression and empowered-slot discovery for night resolution.
//!
//! The coordinator supplies the prepared actions and validated pack policy.
//! This owner indexes block sources in stable ability order, selects the actions
//! each source suppresses under the pack's suppression policy, exempts the
//! actors the empower fixpoint reaches, and emits the exact suppression trace
//! and `ActionInterfered` products.
//!
//! Empowered discovery lives here because suppression candidacy is its input,
//! but the discovered set is returned rather than retained: the redirect stage
//! consumes it too, and running discovery twice against different blocked-index
//! inputs would let the two stages disagree about who is empowered.

use std::collections::{BTreeMap, BTreeSet};

use crate::events::{DecisionTrace, InnerEvent};
use crate::ir::IrAbility;
use crate::pack::{ActionTemplate, Pack, SuppressionScope};
use crate::state::SlotId;

use super::intake::{ability_order, Action};

#[derive(Clone)]
struct BlockSource {
    actor: SlotId,
    source_action_id: String,
    template_id: String,
}

impl BlockSource {
    fn trace_detail(&self) -> serde_json::Value {
        serde_json::json!({
            "actor": self.actor,
            "action_id": self.source_action_id,
            "template_id": self.template_id,
        })
    }
}

pub(super) struct SuppressionResolutionContext<'context, 'action> {
    pub(super) actions: &'context mut [Action<'action>],
    pub(super) pack: &'context Pack,
    pub(super) events: &'context mut Vec<InnerEvent>,
    pub(super) trace_decisions: &'context mut Vec<DecisionTrace>,
}

pub(super) struct EmpowerDiscoveryInput<'context, 'action> {
    pub(super) actions: &'context [Action<'action>],
    pub(super) pack: &'context Pack,
    pub(super) blocked_action_idxs: &'context BTreeSet<usize>,
}

/// Resolve the Block stage. Block is a pack-priority/precedence stage: once
/// resolved, it suppresses pack-classified actions before later stages inspect
/// them. Returns the empowered slots discovered against this stage's
/// suppression candidates, which the redirect stage then reuses.
pub(super) fn resolve_suppression(
    context: SuppressionResolutionContext<'_, '_>,
) -> BTreeSet<SlotId> {
    let SuppressionResolutionContext {
        actions,
        pack,
        events,
        trace_decisions,
    } = context;

    let block_sources = index_block_sources(actions, pack);
    let block_candidates = select_block_candidates(actions, pack, &block_sources);
    let block_candidate_idxs = block_candidates
        .iter()
        .map(|(idx, _)| *idx)
        .collect::<BTreeSet<_>>();
    let empowered_slots = discover_empowered_slots(EmpowerDiscoveryInput {
        actions,
        pack,
        blocked_action_idxs: &block_candidate_idxs,
    });

    let mut newly_blocked: Vec<(SlotId, String, String, Vec<BlockSource>)> = Vec::new();
    for (idx, sources) in block_candidates {
        if empowered_slots.contains(&actions[idx].sub.actor) {
            trace_decisions.push(DecisionTrace {
                stage: "night:block".to_string(),
                source: "night_resolution.empower_effects".to_string(),
                outcome: "action_suppression_bypassed".to_string(),
                detail: crate::json_atom!({
                    "actor": actions[idx].sub.actor,
                    "action_id": actions[idx].sub.action_id,
                    "template_id": actions[idx].template.id,
                    "empower_effects": pack.night_resolution.empower_effects.clone(),
                    "block_sources": sources
                        .iter()
                        .map(BlockSource::trace_detail)
                        .collect::<Vec<_>>(),
                }),
            });
            continue;
        }
        actions[idx].blocked = true;
        newly_blocked.push((
            actions[idx].sub.actor.clone(),
            actions[idx].sub.action_id.clone(),
            actions[idx].template.id.clone(),
            sources,
        ));
    }
    for (actor, action_id, template_id, sources) in newly_blocked {
        trace_decisions.push(DecisionTrace {
            stage: "night:block".to_string(),
            source: "IrAbility::Block".to_string(),
            outcome: "action_suppressed".to_string(),
            detail: crate::json_atom!({
                "actor": actor,
                "action_id": action_id,
                "template_id": template_id,
                "reason": "roleblocked",
                "block_sources": sources
                    .iter()
                    .map(BlockSource::trace_detail)
                    .collect::<Vec<_>>(),
            }),
        });
        events.push(InnerEvent::ActionInterfered {
            actor,
            reason: "roleblocked".to_string(),
        });
    }

    empowered_slots
}

/// Index each participating block action's sources by the slot it targets.
/// Iteration follows the stage's stable ability order, so a target's sources
/// keep descending priority then submission order.
fn index_block_sources(actions: &[Action<'_>], pack: &Pack) -> BTreeMap<SlotId, Vec<BlockSource>> {
    let mut block_sources: BTreeMap<SlotId, Vec<BlockSource>> = BTreeMap::new();
    for idx in ability_order(actions, IrAbility::Block) {
        if actions[idx].blocked || !night_resolution_block_participates(pack, actions[idx].template)
        {
            continue;
        }
        for target in &actions[idx].targets {
            block_sources
                .entry(target.clone())
                .or_default()
                .push(BlockSource {
                    actor: actions[idx].sub.actor.clone(),
                    source_action_id: actions[idx].sub.action_id.clone(),
                    template_id: actions[idx].template.id.clone(),
                });
        }
    }
    block_sources
}

/// Select the actions the indexed sources suppress. A `FirstMatchingAction`
/// source is consumed by the first action it matches in action order, so it
/// cannot suppress a second one; `AllMatchingActions` sources are never
/// consumed. Candidates keep action order and their sources keep index order.
fn select_block_candidates(
    actions: &[Action<'_>],
    pack: &Pack,
    block_sources: &BTreeMap<SlotId, Vec<BlockSource>>,
) -> Vec<(usize, Vec<BlockSource>)> {
    let mut block_candidates: Vec<(usize, Vec<BlockSource>)> = Vec::new();
    let mut consumed_first_match_sources: BTreeSet<(SlotId, String)> = BTreeSet::new();
    for (idx, action) in actions.iter().enumerate() {
        if action.blocked {
            continue;
        }
        let suppressing_sources = block_sources
            .get(&action.sub.actor)
            .into_iter()
            .flat_map(|sources| sources.iter())
            .filter_map(|source| {
                let scope =
                    night_resolution_block_suppression_scope(pack, source, action.template)?;
                let key = (action.sub.actor.clone(), source.source_action_id.clone());
                if scope == SuppressionScope::FirstMatchingAction
                    && consumed_first_match_sources.contains(&key)
                {
                    return None;
                }
                Some((source.clone(), scope))
            })
            .collect::<Vec<_>>();
        if !suppressing_sources.is_empty() {
            for (source, scope) in &suppressing_sources {
                if *scope == SuppressionScope::FirstMatchingAction {
                    consumed_first_match_sources
                        .insert((action.sub.actor.clone(), source.source_action_id.clone()));
                }
            }
            block_candidates.push((
                idx,
                suppressing_sources
                    .into_iter()
                    .map(|(source, _)| source)
                    .collect(),
            ));
        }
    }
    block_candidates
}

/// Discover the empowered slots as a fixpoint over empower-effect `Mark`
/// actions. A mark whose own action is a blocked-index input only counts once
/// its actor is itself empowered, so an empower chain converges regardless of
/// the order the marks appear in.
pub(super) fn discover_empowered_slots(input: EmpowerDiscoveryInput<'_, '_>) -> BTreeSet<SlotId> {
    let EmpowerDiscoveryInput {
        actions,
        pack,
        blocked_action_idxs,
    } = input;

    if pack.night_resolution.empower_effects.is_empty() {
        return BTreeSet::new();
    }

    let empower_effects = pack
        .night_resolution
        .empower_effects
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let mut empowered = BTreeSet::new();
    loop {
        let mut changed = false;
        for (idx, action) in actions.iter().enumerate() {
            if action.blocked || !action.has_ability(IrAbility::Mark) {
                continue;
            }
            let Some(effect) = action.template.effect.as_deref() else {
                continue;
            };
            if !empower_effects.contains(effect) {
                continue;
            }
            if blocked_action_idxs.contains(&idx) && !empowered.contains(&action.sub.actor) {
                continue;
            }
            for target in &action.targets {
                changed |= empowered.insert(target.clone());
            }
        }
        if !changed {
            break;
        }
    }
    empowered
}

fn night_resolution_block_participates(pack: &Pack, template: &ActionTemplate) -> bool {
    if !pack.night_resolution.is_explicit() {
        return true;
    }
    pack.night_resolution
        .block_action_ids
        .iter()
        .chain(pack.night_resolution.jailkeep_action_ids.iter())
        .any(|action_id| action_id == &template.id)
}

fn night_resolution_block_suppression_scope(
    pack: &Pack,
    source: &BlockSource,
    target: &ActionTemplate,
) -> Option<SuppressionScope> {
    if !pack.night_resolution.is_explicit() {
        return target
            .constraints
            .roleblockable
            .then_some(SuppressionScope::AllMatchingActions);
    }
    pack.night_resolution
        .suppression_policy
        .get(&source.template_id)
        .and_then(|policy| {
            policy
                .suppresses
                .iter()
                .any(|action_id| action_id == &target.id)
                .then(|| {
                    policy.scope.unwrap_or_else(|| {
                        panic!(
                            "invalid night_resolution suppression policy: Block action `{}` must declare suppression scope",
                            source.template_id
                        )
                    })
                })
        })
}
