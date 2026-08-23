//! The pure, deterministic resolver (doc 09).
//!
//! `resolve(ResolutionInput) -> ResolutionOutput` implements the night and day
//! pipelines the goldens exercise, wraps the result envelope, emits the
//! companion trace, and returns the post-resolution state. Determinism is
//! mandatory: night stage order is derived from pack precedence plus action
//! `Constraints.priority`, and within an ability actions use descending priority
//! then stable submission ordering. No hash-map iteration order ever reaches
//! output.

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

use crate::events::{
    day_death_announcement_metadata, DayAnnouncement, DayVoteOutcome, Death, DecisionTrace,
    DuelResult, HostPromptIssued, HostPromptMetadata, IndexedEvent, InnerEvent,
    InvestigationResultBody, InvestigationResultFields, ItaCounters, ItaShotOutcome,
    LastWordsRecorded, LastWordsVoteSummary, PhaseAnnouncement, ResolutionApplied,
    ResolutionCounts, ResolutionTrace, ResultValidationError, TraceEdge, TriggerPayload,
    VoteStatus,
};
use crate::ir::{InvestigateMode, IrAbility, Modifier};
use crate::pack::{
    visibility_required_families, win_required_families, ActionTemplate, ActorRef,
    BackupPriorityPolicy, BadgeOperation, ConversionDeadTargetPolicy, ConversionMode,
    ConversionPendingDeathPolicy, DayNoteRolePayload, DeathRetaliationTiming, DeathRevealMode,
    EffectDuration, EffectSourceDeathRevealKind, EffectVisibility, GrantKind, GrantSpec,
    GuardWitchSameTargetPolicy, ItaSessionControlKind, ItaSessionSpec, ItaTargetAlreadyDeadPolicy,
    ItaVoteConflictPolicy, KillStackingPolicy, NightResolutionConflictFamily, Pack,
    ResultMemoryOutput, ResultMemoryScope, RoleModifier, SuppressionScope, TargetRef, TargetSpec,
    TriggerEvent, TriggerLoopCapPolicy, TriggerOn, TriggerRule, ValidatedPack, VisibilityFamily,
    VoteDuelTieBreaker, VoteMethod, VoteTieBreaker, WeightPolicy, WinCondition, WinFamily, Window,
};
use crate::phase::{PhaseId, PhaseKind};
use crate::state::{
    apply_events, BackupTargetRecord, BadgeRecord, DelayedDeathRecord, LogicalTime, RevealState,
    Seed, SlotId, SlotState, StateSnapshot, Submission, WolfBeautyMarkRecord,
};

use serde::{Deserialize, Serialize};

mod action;
mod intake;
mod outcome;
mod redirect;
mod suppression;
mod trace;
mod trigger;

use action::{
    apply_chosen_retaliations, apply_cpr_harms, apply_guard_dependency_deaths,
    apply_guard_witch_same_target_policy, apply_hide_dependency_deaths, counter_use_counted,
    death_reveal_mode, emit_action_interfered_by_target_state, merge_stacked_kill_attribution,
    night_resolution_aggregates_kill_attackers, resolve_one_kill, ActionInterference,
    ActionResolutionContext, CounterUseInput, GuardDependency, HideDependency, KillAction,
    KillRecord, ProtectionResolutionContext, ProtectionSource,
};

use intake::{
    ability_order, prepare_night_actions, Action, NightActionPreparationInput,
    NightActionPreparationOutput,
};

use outcome::{resolve_day_vote, resolve_duel_actions, DayVoteResolutionContext};

use redirect::{resolve_redirects, RedirectResolutionContext};

use suppression::{
    discover_empowered_slots, resolve_suppression, EmpowerDiscoveryInput,
    SuppressionResolutionContext,
};

use trace::{build_resolution_trace, ResolutionTraceInput};

use trigger::{
    apply_trigger_fixpoint, apply_win_triggers_before_final, collect_night_observations,
    effect_marked_observation, phase_end_observations, ProducedKillCollection,
    TriggerCascadeContext, TriggerObservation, TriggerResolutionContext,
};

/// Resolver contract version (doc 10 `result_version`).
pub const RESULT_VERSION: u16 = 21;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DayPhaseInputs {
    pub night_victims: Vec<DayAnnouncementInput>,
    pub ita_session_controls: Vec<ItaSessionControlInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DayAnnouncementInput {
    pub player_id: SlotId,
    pub cause: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_action_id: Option<String>,
    #[serde(default)]
    pub attackers: Vec<SlotId>,
    #[serde(default)]
    pub unstoppable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recorded_at: Option<LogicalTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ItaSessionControlInput {
    pub session_id: String,
    pub control: ItaSessionControlKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub recorded_at: LogicalTime,
}

pub struct ResolutionInput {
    pub game_id: String,
    pub phase_id: PhaseId,
    pub run_id: String,
    pub state: StateSnapshot,
    pub submissions: Vec<Submission>,
    pub day_phase_inputs: DayPhaseInputs,
    /// The semantically validated, immutable pack artifact shared by the
    /// engine. It owns the precomputed execution plan and cannot be forged in
    /// safe code; remaining `require_*` checks are defense in depth while
    /// their duplicated resolver grammar is retired family by family.
    pub pack: Arc<ValidatedPack>,
    pub seed: Seed,
    pub logical_time: LogicalTime,
}

/// A resolver invocation is only meaningful when its explicit phase coordinate
/// and snapshot describe the same exact window. This error is returned at the
/// pure-engine boundary instead of allowing a malformed snapshot to produce a
/// contradictory envelope (or an internal validation panic).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolutionInputError {
    PhaseMismatch {
        input_phase_id: PhaseId,
        state_phase_id: PhaseId,
    },
    GeneratedResolution(ResultValidationError),
    GeneratedTrace(ResultValidationError),
}

impl std::fmt::Display for ResolutionInputError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PhaseMismatch {
                input_phase_id,
                state_phase_id,
            } => write!(
                f,
                "resolution input phase `{input_phase_id}` does not match snapshot phase `{state_phase_id}`"
            ),
            Self::GeneratedResolution(error) => {
                write!(f, "resolver generated an invalid resolution envelope: {error}")
            }
            Self::GeneratedTrace(error) => {
                write!(f, "resolver generated an invalid resolution trace: {error}")
            }
        }
    }
}

impl std::error::Error for ResolutionInputError {}

impl ResolutionInput {
    /// Validate untrusted or deserialized state before any resolver work.
    pub fn validate(&self) -> Result<(), ResolutionInputError> {
        if self.phase_id != self.state.phase_id {
            return Err(ResolutionInputError::PhaseMismatch {
                input_phase_id: self.phase_id.clone(),
                state_phase_id: self.state.phase_id.clone(),
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct ResolutionOutput {
    pub applied: ResolutionApplied,
    pub trace: ResolutionTrace,
    pub post_state: StateSnapshot,
}

#[derive(Debug, Clone, Default)]
struct InnerResolution {
    events: Vec<InnerEvent>,
    trace_edges: Vec<TraceEdge>,
    trace_decisions: Vec<DecisionTrace>,
    trace_notes: Vec<String>,
}

/// A tiny deterministic PRNG (SplitMix64), seeded from `Seed`, for pack-declared
/// random tie-breakers without reaching for system randomness.
struct DetRng(u64);

impl DetRng {
    fn new(seed: Seed) -> Self {
        DetRng(seed)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn next_f64(&mut self) -> f64 {
        const SCALE: f64 = 1.0 / ((1u64 << 53) as f64);
        ((self.next_u64() >> 11) as f64) * SCALE
    }
}

/// Is a role immune to conversion? A role is immune iff it carries the `Loyal`
/// modifier on any of its actions, or its role-level `effects` include a
/// pack-configured immune tag (`"loyal"`). v1 uses the `"loyal"` effect tag and
/// the `Loyal` modifier interchangeably as the conversion-immunity signal.
fn conversion_immune(input: &ResolutionInput, role_key: &str) -> bool {
    let Some(role) = input.pack.document().roles.get(role_key) else {
        return false;
    };
    if role.effects.iter().any(|e| e == "loyal") {
        return true;
    }
    role.actions.iter().any(|a| a.has_modifier(Modifier::Loyal))
}

fn conversion_destination(
    input: &ResolutionInput,
    action: &Action<'_>,
    target: &SlotId,
) -> Result<(String, Option<String>), &'static str> {
    if let Some(conversion) = &action.template.conversion {
        return match conversion.mode {
            ConversionMode::AssignRole => {
                let Some(role) = conversion.role.clone() else {
                    return Err("invalid_conversion");
                };
                Ok((
                    role.clone(),
                    input
                        .pack
                        .document()
                        .roles
                        .get(&role)
                        .and_then(|r| r.alignment.clone()),
                ))
            }
            ConversionMode::RestoreOriginal => input
                .state
                .conversion_origins
                .iter()
                .find(|origin| &origin.target == target)
                .map(|origin| {
                    (
                        origin.original_role.clone(),
                        origin.original_alignment.clone(),
                    )
                })
                .ok_or("no_original_role"),
        };
    }

    let Some(role) = action.template.effect.clone() else {
        return Err("invalid_conversion");
    };
    Ok((
        role.clone(),
        input
            .pack
            .document()
            .roles
            .get(&role)
            .and_then(|r| r.alignment.clone()),
    ))
}

fn backup_role<'a>(policy: &crate::pack::BackupPolicy, effect: &'a str) -> Option<&'a str> {
    effect.strip_prefix(&policy.passive_effect_prefix)
}

fn apply_lover_suicides(
    input: &ResolutionInput,
    killed: &mut Vec<SlotId>,
    kill_log: &mut Vec<KillRecord>,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) -> Vec<SlotId> {
    let policy = &input.pack.document().lover_policy;
    if !policy.enabled || !policy.suicide_on_lover_death {
        return Vec::new();
    }
    let mut generated = Vec::new();
    let mut recorded_suicides = BTreeSet::new();
    let mut changed = true;
    while changed {
        changed = false;
        let killed_now: BTreeSet<SlotId> = killed.iter().cloned().collect();
        for link in &input.state.linked_slots {
            let Some(source_dead) = killed
                .iter()
                .find(|slot_id| link.slots.contains(*slot_id))
                .cloned()
            else {
                continue;
            };
            for slot_id in &link.slots {
                if slot_id == &source_dead || recorded_suicides.contains(slot_id) {
                    continue;
                }
                let Some(slot) = input
                    .state
                    .slots
                    .iter()
                    .find(|slot| &slot.slot_id == slot_id)
                else {
                    continue;
                };
                if !slot.is_alive() {
                    continue;
                }
                trace_decisions.push(DecisionTrace {
                    stage: "death:cascade".to_string(),
                    source: format!("link:{}", link.link_id),
                    outcome: "lover_suicide".to_string(),
                    detail: crate::json_atom!({
                        "link_id": link.link_id.clone(),
                        "link_source": link.source.clone(),
                        "linked_slots": link.slots.clone(),
                        "source_dead": source_dead.clone(),
                        "target": slot_id.clone(),
                        "cause": policy.suicide_cause.clone(),
                    }),
                });
                recorded_suicides.insert(slot_id.clone());
                if killed_now.contains(slot_id) {
                    if night_resolution_aggregates_kill_attackers(input.pack.document()) {
                        let _ = merge_stacked_kill_attribution(
                            slot_id,
                            &source_dead,
                            &policy.suicide_cause,
                            true,
                            events,
                            kill_log,
                            trace_decisions,
                        );
                    }
                    continue;
                }
                killed.push(slot_id.clone());
                generated.push(slot_id.clone());
                events.push(InnerEvent::PlayerKilled {
                    slot_id: slot_id.clone(),
                    cause: policy.suicide_cause.clone(),
                    attackers: vec![source_dead.clone()],
                    unstoppable: true,
                    death_reveal: death_reveal_mode(input, slot_id, &policy.suicide_cause),
                });
                changed = true;
            }
        }
    }
    generated
}

fn apply_wolf_beauty_drag_triggers(
    input: &ResolutionInput,
    killed: &mut Vec<SlotId>,
    kill_log: &mut Vec<KillRecord>,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    let policy = &input.pack.document().wolf_beauty;
    if !policy.enabled {
        return;
    }
    let observed = kill_log.clone();
    let mut processed_beauties = BTreeSet::new();
    for record in observed {
        if !policy
            .death_causes
            .iter()
            .any(|cause| cause == &record.cause)
        {
            continue;
        }
        if !processed_beauties.insert(record.target.clone()) {
            continue;
        }
        let Some(beauty_role) = slot_role(input, &record.target) else {
            continue;
        };
        if !policy.eligible_roles.iter().any(|role| role == beauty_role) {
            continue;
        }
        let Some(mark) = input
            .state
            .wolf_beauty_marks
            .iter()
            .find(|mark| mark.beauty_id == record.target && mark.effect == policy.mark_effect)
        else {
            continue;
        };
        let Some(target_slot) = input
            .state
            .slots
            .iter()
            .find(|slot| slot.slot_id == mark.target_id)
        else {
            continue;
        };
        if !target_slot.is_alive() {
            continue;
        }

        trace_decisions.push(DecisionTrace {
            stage: "death:cascade".to_string(),
            source: format!("action:{}", mark.source_action),
            outcome: "wolf_beauty_dragged".to_string(),
            detail: crate::json_atom!({
                "beauty_id": record.target.clone(),
                "dragged_id": mark.target_id.clone(),
                "mark_effect": mark.effect.clone(),
                "mark_source_action": mark.source_action.clone(),
                "mark_phase_id": mark.phase_id.clone(),
                "trigger_cause": record.cause.clone(),
                "cause": policy.drag_cause.clone(),
            }),
        });
        events.push(InnerEvent::WolfBeautyDragged {
            beauty_id: record.target.clone(),
            dragged_ids: vec![mark.target_id.clone()],
            cause: policy.drag_cause.clone(),
            phase_id: input.phase_id.clone(),
        });
        if killed.contains(&mark.target_id) {
            let _ = merge_stacked_kill_attribution(
                &mark.target_id,
                &record.target,
                &policy.drag_cause,
                true,
                events,
                kill_log,
                trace_decisions,
            );
            continue;
        }
        killed.push(mark.target_id.clone());
        events.push(InnerEvent::PlayerKilled {
            slot_id: mark.target_id.clone(),
            cause: policy.drag_cause.clone(),
            attackers: vec![record.target.clone()],
            unstoppable: true,
            death_reveal: death_reveal_mode(input, &mark.target_id, &policy.drag_cause),
        });
        kill_log.push(KillRecord {
            target: mark.target_id.clone(),
            attacker: record.target,
            cause: policy.drag_cause.clone(),
        });
    }
}

fn target_tags(
    input: &ResolutionInput,
    transient_effects: &BTreeMap<SlotId, BTreeSet<String>>,
    target: &SlotId,
) -> BTreeSet<String> {
    let mut tags = BTreeSet::new();
    let Some(slot) = input.state.slots.iter().find(|s| &s.slot_id == target) else {
        return tags;
    };
    tags.extend(slot.effects.iter().cloned());
    if let Some(role) = input.pack.document().roles.get(&slot.role_key) {
        tags.extend(role.effects.iter().cloned());
    }
    if let Some(transient) = transient_effects.get(target) {
        tags.extend(transient.iter().cloned());
    }
    tags
}

fn slot_alignment<'a>(input: &'a ResolutionInput, slot_id: &SlotId) -> Option<&'a str> {
    input
        .state
        .slots
        .iter()
        .find(|slot| &slot.slot_id == slot_id)
        .and_then(|slot| slot.alignment.as_deref())
}

fn alignment_failback_victim(
    input: &ResolutionInput,
    action_id: &str,
    template: &ActionTemplate,
    actor: &SlotId,
    submitted_target: &SlotId,
    trace_stage: &str,
    trace_decisions: &mut Vec<DecisionTrace>,
) -> (SlotId, bool) {
    let Some(failback) = &template.alignment_failback else {
        return (submitted_target.clone(), false);
    };
    let target_alignment = slot_alignment(input, submitted_target);
    let target_is_hostile = target_alignment.is_some_and(|alignment| {
        failback
            .hostile_alignments
            .iter()
            .any(|hostile| hostile == alignment)
    });
    if target_is_hostile {
        return (submitted_target.clone(), false);
    }
    trace_decisions.push(DecisionTrace {
        stage: trace_stage.to_string(),
        source: format!("action:{action_id}"),
        outcome: "alignment_failback_self_kill".to_string(),
        detail: crate::json_atom!({
            "action_id": action_id,
            "template_id": template.id,
            "actor": actor,
            "submitted_target": submitted_target,
            "target_alignment": target_alignment,
            "hostile_alignments": failback.hostile_alignments,
        }),
    });
    (actor.clone(), true)
}

fn slot_role<'a>(input: &'a ResolutionInput, slot_id: &SlotId) -> Option<&'a str> {
    input
        .state
        .slots
        .iter()
        .find(|slot| &slot.slot_id == slot_id)
        .map(|slot| slot.role_key.as_str())
}

fn target_state_gate_reason<'a>(
    pack: &Pack,
    tags: &'a BTreeSet<String>,
    ability: IrAbility,
) -> Option<&'a str> {
    if pack.night_resolution.is_explicit() {
        let gate_tags = pack
            .night_resolution
            .target_state_gate_tags
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        return tags.iter().find_map(|tag| {
            if !gate_tags.contains(tag.as_str()) {
                return None;
            }
            pack.night_resolution
                .target_state_gate_policy
                .get(tag)
                .is_some_and(|policy| policy.blocks.contains(&ability))
                .then_some(tag.as_str())
        });
    }
    if tags.contains("commuted") {
        Some("commuted")
    } else if tags.contains("untargetable") {
        Some("untargetable")
    } else {
        None
    }
}

fn require_night_resolution_target_state_save_catalog(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let save_tags = night_resolution_derived_target_state_save_tags(pack);
    if !save_tags.is_empty() && pack.night_resolution.target_state_save_tags.is_empty() {
        panic!(
            "invalid night_resolution target-state save catalog: explicit night_resolution policy must declare target-state save tags"
        );
    }
}

fn require_night_resolution_target_state_save_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let save_tags = night_resolution_target_state_save_tags(pack);
    if save_tags.is_empty() {
        return;
    }
    let kill_causes = pack
        .night_resolution
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    for tag in &save_tags {
        let Some(policy) = pack.night_resolution.target_state_save_policy.get(*tag) else {
            panic!(
                "invalid night_resolution target-state save policy: target-state save `{tag}` must classify every kill cause"
            );
        };
        if policy.blocks.is_empty() && policy.bypasses.is_empty() {
            panic!(
                "invalid night_resolution target-state save policy: target-state save `{tag}` must classify kill causes"
            );
        }
        require_night_resolution_target_state_save_policy_causes(
            tag,
            "blocks",
            &policy.blocks,
            &kill_causes,
        );
        require_night_resolution_target_state_save_policy_causes(
            tag,
            "bypasses",
            &policy.bypasses,
            &kill_causes,
        );
        let blocked = policy
            .blocks
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        for cause in &policy.bypasses {
            if blocked.contains(cause.as_str()) {
                panic!(
                    "invalid night_resolution target-state save policy: target-state save `{tag}` kill cause `{cause}` cannot be both blocked and bypassed"
                );
            }
        }
    }
    for tag in pack.night_resolution.target_state_save_policy.keys() {
        if tag.trim().is_empty() {
            panic!(
                "invalid night_resolution target-state save policy: target-state save tag must not be empty"
            );
        }
        if !save_tags.contains(tag.as_str()) {
            panic!(
                "invalid night_resolution target-state save policy: unknown target-state save `{tag}`"
            );
        }
    }
}

fn require_night_resolution_target_state_save_policy_causes(
    tag: &str,
    field: &str,
    causes: &[String],
    kill_causes: &BTreeSet<&str>,
) {
    let mut seen = BTreeSet::new();
    for cause in causes {
        if cause.trim().is_empty() {
            panic!(
                "invalid night_resolution target-state save policy: target-state save `{tag}` {field} contains empty kill cause"
            );
        }
        if !seen.insert(cause.as_str()) {
            panic!(
                "invalid night_resolution target-state save policy: target-state save `{tag}` {field} contains duplicate kill cause `{cause}`"
            );
        }
        if !kill_causes.contains(cause.as_str()) {
            panic!(
                "invalid night_resolution target-state save policy: target-state save `{tag}` {field} references unknown kill cause `{cause}`"
            );
        }
    }
}

fn night_resolution_target_state_save_tags(pack: &Pack) -> BTreeSet<&str> {
    if pack.night_resolution.is_explicit() {
        return pack
            .night_resolution
            .target_state_save_tags
            .iter()
            .map(String::as_str)
            .collect();
    }
    night_resolution_derived_target_state_save_tags(pack)
}

fn night_resolution_derived_target_state_save_tags(pack: &Pack) -> BTreeSet<&str> {
    let mut tags = BTreeSet::new();
    for role in pack.roles.values() {
        for effect in &role.effects {
            record_night_resolution_target_state_save_tag(&mut tags, effect);
        }
    }
    for effect in pack.effects.keys() {
        record_night_resolution_target_state_save_tag(&mut tags, effect);
    }
    tags
}

fn record_night_resolution_target_state_save_tag<'a>(
    tags: &mut BTreeSet<&'a str>,
    effect: &'a str,
) {
    if effect == "bulletproof" || effect == "bulletproof_vest" {
        tags.insert(effect);
    }
}

fn require_night_resolution_target_state_gate_catalog(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let gate_tags = night_resolution_derived_target_state_gate_tags(pack);
    if !gate_tags.is_empty() && pack.night_resolution.target_state_gate_tags.is_empty() {
        panic!(
            "invalid night_resolution target-state gate catalog: explicit night_resolution policy must declare target-state gate tags"
        );
    }
}

fn require_night_resolution_target_state_gate_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let gate_tags = night_resolution_target_state_gate_tags(pack);
    if gate_tags.is_empty() {
        return;
    }
    for tag in &gate_tags {
        let Some(policy) = pack.night_resolution.target_state_gate_policy.get(*tag) else {
            panic!(
                "invalid night_resolution target-state gate policy: target-state gate `{tag}` must classify blocked abilities"
            );
        };
        if policy.blocks.is_empty() {
            panic!(
                "invalid night_resolution target-state gate policy: target-state gate `{tag}` must declare blocked abilities"
            );
        }
        let mut seen = BTreeSet::new();
        for ability in &policy.blocks {
            if !seen.insert(*ability) {
                panic!(
                    "invalid night_resolution target-state gate policy: target-state gate `{tag}` contains duplicate blocked ability `{ability:?}`"
                );
            }
            if !matches!(
                ability,
                IrAbility::Kill
                    | IrAbility::Protect
                    | IrAbility::Investigate
                    | IrAbility::Convert
                    | IrAbility::Mark
            ) {
                panic!(
                    "invalid night_resolution target-state gate policy: target-state gate `{tag}` only supports Kill, Protect, Investigate, Convert, or Mark, got `{ability:?}`"
                );
            }
        }
    }
    for tag in pack.night_resolution.target_state_gate_policy.keys() {
        if tag.trim().is_empty() {
            panic!(
                "invalid night_resolution target-state gate policy: target-state gate tag must not be empty"
            );
        }
        if !gate_tags.contains(tag.as_str()) {
            panic!(
                "invalid night_resolution target-state gate policy: unknown target-state gate `{tag}`"
            );
        }
    }
}

fn require_night_resolution_kill_stacking_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    if !matches!(
        pack.night_resolution.kill_stacking,
        Some(KillStackingPolicy::AggregateAttackers)
    ) {
        panic!(
            "invalid night_resolution kill stacking policy: explicit night_resolution policy requires kill_stacking AggregateAttackers"
        );
    }
}

fn require_night_resolution_strongman_bypass_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    if !pack.night_resolution.strongman_bypasses_protect {
        panic!(
            "invalid night_resolution strongman bypass policy: explicit night_resolution policy requires strongman_bypasses_protect true"
        );
    }
}

fn require_night_resolution_protection_cause_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let protect_sources = night_resolution_protect_source_ids(pack);
    if protect_sources.is_empty() {
        return;
    }
    let kill_causes = pack
        .night_resolution
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    for source in &protect_sources {
        let Some(policy) = pack.night_resolution.protection_cause_policy.get(*source) else {
            panic!(
                "invalid night_resolution protection cause policy: protection source `{source}` must classify every kill cause"
            );
        };
        if policy.blocks.is_empty() && policy.bypasses.is_empty() {
            panic!(
                "invalid night_resolution protection cause policy: protection source `{source}` must classify kill causes"
            );
        }
        require_night_resolution_protection_cause_policy_causes(
            source,
            "blocks",
            &policy.blocks,
            &kill_causes,
        );
        require_night_resolution_protection_cause_policy_causes(
            source,
            "bypasses",
            &policy.bypasses,
            &kill_causes,
        );
        let blocked = policy
            .blocks
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        for cause in &policy.bypasses {
            if blocked.contains(cause.as_str()) {
                panic!(
                    "invalid night_resolution protection cause policy: protection source `{source}` kill cause `{cause}` cannot be both blocked and bypassed"
                );
            }
        }
    }
    for source in pack.night_resolution.protection_cause_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid night_resolution protection cause policy: protection source id must not be empty"
            );
        }
        if !protect_sources.contains(source.as_str()) {
            panic!(
                "invalid night_resolution protection cause policy: unknown protection source `{source}`"
            );
        }
    }
}

fn require_night_resolution_protection_cause_policy_causes(
    source: &str,
    field: &str,
    causes: &[String],
    kill_causes: &BTreeSet<&str>,
) {
    let mut seen = BTreeSet::new();
    for cause in causes {
        if cause.trim().is_empty() {
            panic!(
                "invalid night_resolution protection cause policy: protection source `{source}` {field} contains empty kill cause"
            );
        }
        if !seen.insert(cause.as_str()) {
            panic!(
                "invalid night_resolution protection cause policy: protection source `{source}` {field} contains duplicate kill cause `{cause}`"
            );
        }
        if !kill_causes.contains(cause.as_str()) {
            panic!(
                "invalid night_resolution protection cause policy: protection source `{source}` {field} references unknown kill cause `{cause}`"
            );
        }
    }
}

fn require_night_resolution_suppression_policy_shape(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let block_sources = night_resolution_block_source_ids(pack);
    let night_actions = night_resolution_night_action_roleblockability(pack);
    for (source, policy) in &pack.night_resolution.suppression_policy {
        if source.trim().is_empty() {
            panic!(
                "invalid night_resolution suppression policy: block source id must not be empty"
            );
        }
        if !block_sources.contains(source.as_str()) {
            panic!("invalid night_resolution suppression policy: unknown block source `{source}`");
        }
        if policy.scope.is_none() {
            panic!(
                "invalid night_resolution suppression policy: Block action `{source}` must declare suppression scope"
            );
        }
        require_night_resolution_suppression_policy_actions(
            source,
            "suppresses",
            &policy.suppresses,
            &night_actions,
        );
        require_night_resolution_suppression_policy_actions(
            source,
            "bypasses",
            &policy.bypasses,
            &night_actions,
        );
        let suppressed = policy
            .suppresses
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        for action_id in &policy.bypasses {
            if suppressed.contains(action_id.as_str()) {
                panic!(
                    "invalid night_resolution suppression policy: night action `{action_id}` cannot be both suppressed and bypassed"
                );
            }
        }
    }
}

fn require_night_resolution_suppression_policy_actions(
    source: &str,
    field: &str,
    action_ids: &[String],
    night_actions: &BTreeMap<&str, NightResolutionNightAction>,
) {
    let mut seen = BTreeSet::new();
    for action_id in action_ids {
        if action_id.trim().is_empty() {
            panic!(
                "invalid night_resolution suppression policy: block source `{source}` {field} contains empty night action"
            );
        }
        if !seen.insert(action_id.as_str()) {
            panic!(
                "invalid night_resolution suppression policy: block source `{source}` {field} contains duplicate night action `{action_id}`"
            );
        }
        if !night_actions.contains_key(action_id.as_str()) {
            panic!(
                "invalid night_resolution suppression policy: block source `{source}` {field} references unknown night action `{action_id}`"
            );
        }
    }
}

fn require_conversion_policy(pack: &Pack) {
    if !pack_has_convert_action(pack) {
        return;
    }
    if pack.conversion_policy.on_dead_target != Some(ConversionDeadTargetPolicy::Block) {
        panic!(
            "invalid conversion policy: packs with Convert actions must declare on_dead_target Block"
        );
    }
    if pack.conversion_policy.on_pending_death != Some(ConversionPendingDeathPolicy::Block) {
        panic!(
            "invalid conversion policy: packs with Convert actions must declare on_pending_death Block"
        );
    }
}

fn pack_has_convert_action(pack: &Pack) -> bool {
    pack.roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .any(|action| action.has_ability(IrAbility::Convert))
}

fn require_night_resolution_intercept_cause_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let intercept_sources = pack
        .night_resolution
        .bodyguard_action_ids
        .iter()
        .chain(pack.night_resolution.martyr_action_ids.iter())
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let direct_kill_causes = pack
        .night_resolution
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    for &action_id in &intercept_sources {
        let Some(cause) = pack.night_resolution.intercept_cause_policy.get(action_id) else {
            panic!(
                "invalid night_resolution intercept cause policy: intercept action `{action_id}` must declare intercept cause"
            );
        };
        if cause.trim().is_empty() {
            panic!(
                "invalid night_resolution intercept cause policy: intercept action `{action_id}` must declare non-empty intercept cause"
            );
        }
        if direct_kill_causes.contains(cause.as_str()) {
            panic!(
                "invalid night_resolution intercept cause policy: intercept action `{action_id}` cause `{cause}` must not reuse a direct kill cause"
            );
        }
    }
    for source in pack.night_resolution.intercept_cause_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid night_resolution intercept cause policy: intercept source id must not be empty"
            );
        }
        if !intercept_sources.contains(source.as_str()) {
            panic!(
                "invalid night_resolution intercept cause policy: unknown intercept source `{source}`"
            );
        }
    }
}

fn require_night_resolution_guard_retaliation_cause_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let intercept_sources = pack
        .night_resolution
        .bodyguard_action_ids
        .iter()
        .chain(pack.night_resolution.martyr_action_ids.iter())
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let kill_causes = pack
        .night_resolution
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    for (source, cause) in &pack.night_resolution.guard_retaliation_cause_policy {
        if source.trim().is_empty() {
            panic!(
                "invalid night_resolution guard retaliation cause policy: source id must not be empty"
            );
        }
        if !intercept_sources.contains(source.as_str()) {
            panic!(
                "invalid night_resolution guard retaliation cause policy: source `{source}` must also be an intercept source"
            );
        }
        if cause.trim().is_empty() {
            panic!(
                "invalid night_resolution guard retaliation cause policy: source `{source}` must declare non-empty retaliation cause"
            );
        }
        if !kill_causes.contains(cause.as_str()) {
            panic!(
                "invalid night_resolution guard retaliation cause policy: cause `{cause}` must be declared in kill_cause_ids"
            );
        }
    }
}

fn require_night_resolution_cpr_harm_cause_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let cpr_sources = pack
        .night_resolution
        .cpr_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let direct_kill_causes = pack
        .night_resolution
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    for &action_id in &cpr_sources {
        let Some(cause) = pack.night_resolution.cpr_harm_cause_policy.get(action_id) else {
            panic!(
                "invalid night_resolution CPR harm cause policy: CPR action `{action_id}` must declare harm cause"
            );
        };
        if cause.trim().is_empty() {
            panic!(
                "invalid night_resolution CPR harm cause policy: CPR action `{action_id}` must declare non-empty harm cause"
            );
        }
        if direct_kill_causes.contains(cause.as_str()) {
            panic!(
                "invalid night_resolution CPR harm cause policy: CPR action `{action_id}` cause `{cause}` must not reuse a direct kill cause"
            );
        }
    }
    for source in pack.night_resolution.cpr_harm_cause_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid night_resolution CPR harm cause policy: CPR source id must not be empty"
            );
        }
        if !cpr_sources.contains(source.as_str()) {
            panic!("invalid night_resolution CPR harm cause policy: unknown CPR source `{source}`");
        }
    }
}

fn require_night_resolution_guard_dependency_cause_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let guard_sources = pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .filter(|action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Protect)
                && action.has_modifier(Modifier::Babysitter)
        })
        .map(|action| action.id.as_str())
        .collect::<BTreeSet<_>>();
    let direct_kill_causes = pack
        .night_resolution
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    for &action_id in &guard_sources {
        let Some(cause) = pack
            .night_resolution
            .guard_dependency_cause_policy
            .get(action_id)
        else {
            panic!(
                "invalid night_resolution guard dependency cause policy: guard dependency action `{action_id}` must declare dependency cause"
            );
        };
        if cause.trim().is_empty() {
            panic!(
                "invalid night_resolution guard dependency cause policy: guard dependency action `{action_id}` must declare non-empty dependency cause"
            );
        }
        if direct_kill_causes.contains(cause.as_str()) {
            panic!(
                "invalid night_resolution guard dependency cause policy: guard dependency action `{action_id}` cause `{cause}` must not reuse a direct kill cause"
            );
        }
    }
    for source in pack.night_resolution.guard_dependency_cause_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid night_resolution guard dependency cause policy: guard dependency source id must not be empty"
            );
        }
        if !guard_sources.contains(source.as_str()) {
            panic!(
                "invalid night_resolution guard dependency cause policy: unknown guard dependency source `{source}`"
            );
        }
    }
}

fn require_night_resolution_block_action_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let declared_blocks = pack
        .night_resolution
        .block_action_ids
        .iter()
        .chain(pack.night_resolution.jailkeep_action_ids.iter())
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    for action in pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .filter(|action| {
            action.window.is_night_resolution_window() && action.has_ability(IrAbility::Block)
        })
    {
        if !declared_blocks.contains(action.id.as_str()) {
            panic!(
                "invalid night_resolution block action policy: Block action `{}` must be declared in block_action_ids or jailkeep_action_ids",
                action.id
            );
        }
    }
}

fn require_night_resolution_protect_action_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let declared_protects = pack
        .night_resolution
        .protect_action_ids
        .iter()
        .chain(pack.night_resolution.bodyguard_action_ids.iter())
        .chain(pack.night_resolution.martyr_action_ids.iter())
        .chain(pack.night_resolution.cpr_action_ids.iter())
        .chain(pack.night_resolution.jailkeep_action_ids.iter())
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    for action in pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .filter(|action| {
            action.window.is_night_resolution_window() && action.has_ability(IrAbility::Protect)
        })
    {
        if !declared_protects.contains(action.id.as_str()) {
            panic!(
                "invalid night_resolution protect action policy: Protect action `{}` must be declared in protect_action_ids, bodyguard_action_ids, martyr_action_ids, cpr_action_ids, or jailkeep_action_ids",
                action.id
            );
        }
    }
}

fn require_night_resolution_specialized_protect_action_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let bodyguards = pack
        .night_resolution
        .bodyguard_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let martyrs = pack
        .night_resolution
        .martyr_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let cpr_actions = pack
        .night_resolution
        .cpr_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let ordinary_protects = pack
        .night_resolution
        .protect_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    for action in pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .filter(|action| {
            action.window.is_night_resolution_window() && action.has_ability(IrAbility::Protect)
        })
    {
        if action.has_modifier(Modifier::Bodyguard) && !bodyguards.contains(action.id.as_str()) {
            panic!(
                "invalid night_resolution bodyguard action policy: Bodyguard Protect action `{}` must be declared in bodyguard_action_ids",
                action.id
            );
        }
        if action.has_modifier(Modifier::Martyr) && !martyrs.contains(action.id.as_str()) {
            panic!(
                "invalid night_resolution martyr action policy: Martyr Protect action `{}` must be declared in martyr_action_ids",
                action.id
            );
        }
        if action.has_modifier(Modifier::Cpr)
            && action.has_ability(IrAbility::Kill)
            && !cpr_actions.contains(action.id.as_str())
        {
            panic!(
                "invalid night_resolution CPR action policy: CPR Protect+Kill action `{}` must be declared in cpr_action_ids",
                action.id
            );
        }
        if action.has_modifier(Modifier::Babysitter)
            && !ordinary_protects.contains(action.id.as_str())
        {
            panic!(
                "invalid night_resolution babysitter action policy: Babysitter Protect action `{}` must be declared in protect_action_ids",
                action.id
            );
        }
    }
}

fn require_night_resolution_action_bucket_shapes(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    require_night_resolution_action_bucket_shape(
        pack,
        "block_action_ids",
        &pack.night_resolution.block_action_ids,
        "block",
        "Block",
        |action| action.has_ability(IrAbility::Block),
    );
    require_night_resolution_action_bucket_shape(
        pack,
        "protect_action_ids",
        &pack.night_resolution.protect_action_ids,
        "protect",
        "Protect without Bodyguard/Martyr/Cpr",
        |action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Protect)
                && !action.has_modifier(Modifier::Bodyguard)
                && !action.has_modifier(Modifier::Martyr)
                && !action.has_modifier(Modifier::Cpr)
        },
    );
    require_night_resolution_action_bucket_shape(
        pack,
        "kill_action_ids",
        &pack.night_resolution.kill_action_ids,
        "kill",
        "Kill without Strongman/Cpr",
        |action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Kill)
                && !action.has_modifier(Modifier::Strongman)
                && !action.has_modifier(Modifier::Cpr)
        },
    );
    require_night_resolution_action_bucket_shape(
        pack,
        "bodyguard_action_ids",
        &pack.night_resolution.bodyguard_action_ids,
        "bodyguard",
        "Protect with Bodyguard",
        |action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Protect)
                && action.has_modifier(Modifier::Bodyguard)
        },
    );
    require_night_resolution_action_bucket_shape(
        pack,
        "martyr_action_ids",
        &pack.night_resolution.martyr_action_ids,
        "martyr",
        "Protect with Martyr",
        |action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Protect)
                && action.has_modifier(Modifier::Martyr)
        },
    );
    require_night_resolution_action_bucket_shape(
        pack,
        "cpr_action_ids",
        &pack.night_resolution.cpr_action_ids,
        "CPR",
        "Protect plus Kill with Cpr",
        |action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Protect)
                && action.has_ability(IrAbility::Kill)
                && action.has_modifier(Modifier::Cpr)
        },
    );
    require_night_resolution_action_bucket_shape(
        pack,
        "jailkeep_action_ids",
        &pack.night_resolution.jailkeep_action_ids,
        "jailkeep",
        "Block plus Protect",
        |action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Block)
                && action.has_ability(IrAbility::Protect)
        },
    );
    require_night_resolution_action_bucket_shape(
        pack,
        "strongman_action_ids",
        &pack.night_resolution.strongman_action_ids,
        "strongman",
        "Kill with Strongman",
        |action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Kill)
                && action.has_modifier(Modifier::Strongman)
        },
    );
}

fn require_night_resolution_team_kill_action_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let mut seen = BTreeSet::new();
    for action_id in &pack.night_resolution.team_kill_action_ids {
        if action_id.trim().is_empty() {
            panic!("invalid night_resolution team kill action policy: team_kill_action_ids contains empty value");
        }
        if !seen.insert(action_id.as_str()) {
            panic!(
                "invalid night_resolution team kill action policy: team_kill_action_ids contains duplicate value `{action_id}`"
            );
        }
        let Some(action) = night_resolution_pack_action(pack, action_id) else {
            panic!(
                "invalid night_resolution team kill action policy: team_kill_action_ids entry `{action_id}` references unknown action"
            );
        };
        if !action.window.is_night_resolution_window() || !action.has_ability(IrAbility::Kill) {
            panic!(
                "invalid night_resolution team kill action policy: team_kill_action_ids entry `{action_id}` must be a night/any Kill action"
            );
        }
        if !pack
            .night_resolution
            .kill_action_ids
            .iter()
            .any(|kill_id| kill_id == action_id)
        {
            panic!(
                "invalid night_resolution team kill action policy: team_kill_action_ids entry `{action_id}` must also be declared in kill_action_ids"
            );
        }
    }

    for (role_key, role) in &pack.roles {
        if !role.has_modifier(RoleModifier::Lost) && !role.has_modifier(RoleModifier::Recluse) {
            continue;
        }
        if role.alignment.as_deref() != Some("mafia") {
            panic!(
                "invalid night_resolution team kill action policy: team-kill restricted role `{role_key}` must be mafia-aligned"
            );
        }
        if pack.night_resolution.team_kill_action_ids.is_empty() {
            panic!(
                "invalid night_resolution team kill action policy: team-kill restricted role `{role_key}` requires team_kill_action_ids"
            );
        }
        if !role.actions.iter().any(|action| {
            pack.night_resolution
                .team_kill_action_ids
                .iter()
                .any(|team_kill| team_kill == &action.id)
        }) {
            panic!(
                "invalid night_resolution team kill action policy: team-kill restricted role `{role_key}` must expose a team kill action"
            );
        }
    }
}

fn require_night_resolution_action_bucket_shape(
    pack: &Pack,
    bucket_name: &str,
    action_ids: &[String],
    policy_label: &str,
    expected_shape: &str,
    matches_shape: impl Fn(&ActionTemplate) -> bool,
) {
    if action_ids.is_empty() {
        panic!(
            "invalid night_resolution {policy_label} action policy: explicit night_resolution policy must declare {bucket_name}"
        );
    }
    let mut seen = BTreeSet::new();
    for action_id in action_ids {
        if action_id.trim().is_empty() {
            panic!(
                "invalid night_resolution {policy_label} action policy: {bucket_name} id must not be empty"
            );
        }
        if !seen.insert(action_id.as_str()) {
            panic!(
                "invalid night_resolution {policy_label} action policy: {bucket_name} contains duplicate value `{action_id}`"
            );
        }
        let Some(action) = night_resolution_pack_action(pack, action_id) else {
            panic!(
                "invalid night_resolution {policy_label} action policy: {bucket_name} entry `{action_id}` references unknown action"
            );
        };
        if !action.window.is_night_resolution_window() || !matches_shape(action) {
            panic!(
                "invalid night_resolution {policy_label} action policy: {bucket_name} entry `{action_id}` must be a night/any {expected_shape} action"
            );
        }
    }
}

fn night_resolution_pack_action<'a>(pack: &'a Pack, action_id: &str) -> Option<&'a ActionTemplate> {
    pack.roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .find(|action| action.id == action_id)
}

fn require_night_resolution_jailkeep_action_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let block_ids = pack
        .night_resolution
        .block_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let protect_ids = pack
        .night_resolution
        .protect_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    for action_id in &pack.night_resolution.jailkeep_action_ids {
        if !block_ids.contains(action_id.as_str()) {
            panic!(
                "invalid night_resolution jailkeep action policy: Jailkeeper action `{action_id}` must also be declared in block_action_ids"
            );
        }
        if !protect_ids.contains(action_id.as_str()) {
            panic!(
                "invalid night_resolution jailkeep action policy: Jailkeeper action `{action_id}` must also be declared in protect_action_ids"
            );
        }
    }
}

fn require_night_resolution_kill_action_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    for action in pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .filter(|action| {
            action.window.is_night_resolution_window() && action.has_ability(IrAbility::Kill)
        })
    {
        if pack
            .night_resolution
            .cpr_action_ids
            .iter()
            .any(|action_id| action_id == &action.id)
        {
            continue;
        }
        let declared = pack
            .night_resolution
            .kill_action_ids
            .iter()
            .chain(pack.night_resolution.strongman_action_ids.iter())
            .any(|action_id| action_id == &action.id);
        if !declared {
            panic!(
                "invalid night_resolution kill action policy: Kill action `{}` must be declared in kill_action_ids or strongman_action_ids",
                action.id
            );
        }
    }
}

fn require_night_resolution_strongman_action_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let declared_strongman_kills = pack
        .night_resolution
        .strongman_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    for action in pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .filter(|action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Kill)
                && action.has_modifier(Modifier::Strongman)
        })
    {
        if !declared_strongman_kills.contains(action.id.as_str()) {
            panic!(
                "invalid night_resolution strongman action policy: Strongman Kill action `{}` must be declared in strongman_action_ids",
                action.id
            );
        }
    }
}

fn require_night_resolution_kill_cause_catalog(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    if pack.night_resolution.kill_cause_ids.is_empty() {
        panic!(
            "invalid night_resolution kill cause catalog: explicit night_resolution policy must declare kill_cause_ids"
        );
    }
    let expected = night_resolution_derived_kill_cause_ids(pack);
    let mut declared = BTreeSet::new();
    for cause in &pack.night_resolution.kill_cause_ids {
        if cause.trim().is_empty() {
            panic!("invalid night_resolution kill cause catalog: kill cause id must not be empty");
        }
        if !declared.insert(cause.as_str()) {
            panic!("invalid night_resolution kill cause catalog: duplicate kill cause `{cause}`");
        }
        if !expected.contains(cause.as_str()) {
            panic!("invalid night_resolution kill cause catalog: unknown kill cause `{cause}`");
        }
    }
    for cause in expected {
        if !declared.contains(cause.as_str()) {
            panic!(
                "invalid night_resolution kill cause catalog: kill_cause_ids must include `{cause}`"
            );
        }
    }
}

fn night_resolution_derived_kill_cause_ids(pack: &Pack) -> BTreeSet<String> {
    let mut causes = BTreeSet::new();
    for action in pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .filter(|action| {
            action.window.is_night_resolution_window()
                && (action.has_ability(IrAbility::Kill) || action.has_ability(IrAbility::Retaliate))
                && !pack
                    .night_resolution
                    .cpr_action_ids
                    .iter()
                    .any(|action_id| action_id == &action.id)
        })
    {
        causes.insert(action.id.clone());
    }
    for trigger in pack
        .triggers
        .iter()
        .filter(|trigger| trigger.produces.ability == IrAbility::Kill)
    {
        causes.insert(trigger.id.clone());
    }
    causes.extend(
        pack.night_resolution
            .guard_retaliation_cause_policy
            .values()
            .cloned(),
    );
    causes
}

fn require_night_resolution_chosen_retaliation_cause_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let retaliation_sources = pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .filter(|action| {
            action.window.is_night_resolution_window() && action.has_ability(IrAbility::Retaliate)
        })
        .map(|action| (action.id.as_str(), action))
        .collect::<BTreeMap<_, _>>();

    for (&action_id, action) in &retaliation_sources {
        let Some(policy) = pack
            .night_resolution
            .chosen_retaliation_cause_policy
            .get(action_id)
        else {
            panic!(
                "invalid night_resolution chosen retaliation cause policy: Retaliate action `{action_id}` must declare chosen retaliation cause policy"
            );
        };
        let action_is_strongman = action.has_modifier(Modifier::Strongman);
        if policy.strongman_bypasses_protect != action_is_strongman {
            panic!(
                "invalid night_resolution chosen retaliation cause policy: Retaliate action `{action_id}` strongman_bypasses_protect must match Strongman modifier"
            );
        }
    }
    for source in pack.night_resolution.chosen_retaliation_cause_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid night_resolution chosen retaliation cause policy: Retaliate source id must not be empty"
            );
        }
        if !retaliation_sources.contains_key(source.as_str()) {
            panic!(
                "invalid night_resolution chosen retaliation cause policy: unknown Retaliate action `{source}`"
            );
        }
    }
}

fn require_night_resolution_generated_kill_cause_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let generated_sources = pack
        .triggers
        .iter()
        .filter(|trigger| trigger.produces.ability == IrAbility::Kill)
        .map(|trigger| (trigger.id.as_str(), trigger))
        .collect::<BTreeMap<_, _>>();
    for (&trigger_id, trigger) in &generated_sources {
        let Some(policy) = pack
            .night_resolution
            .generated_kill_cause_policy
            .get(trigger_id)
        else {
            panic!(
                "invalid night_resolution generated kill cause policy: generated kill trigger `{trigger_id}` must declare generated kill cause policy"
            );
        };
        if policy.on.is_none() {
            panic!(
                "invalid night_resolution generated kill cause policy: generated kill trigger `{trigger_id}` must declare trigger on"
            );
        }
        if policy.on != Some(trigger.on) {
            panic!(
                "invalid night_resolution generated kill cause policy: generated kill trigger `{trigger_id}` on must match trigger rule"
            );
        }
        if policy.actor.is_none() {
            panic!(
                "invalid night_resolution generated kill cause policy: generated kill trigger `{trigger_id}` must declare produced actor"
            );
        }
        if policy.actor != Some(trigger.produces.actor) {
            panic!(
                "invalid night_resolution generated kill cause policy: generated kill trigger `{trigger_id}` actor must match trigger production"
            );
        }
        if policy.target.is_none() {
            panic!(
                "invalid night_resolution generated kill cause policy: generated kill trigger `{trigger_id}` must declare produced target"
            );
        }
        if policy.target != Some(trigger.produces.target) {
            panic!(
                "invalid night_resolution generated kill cause policy: generated kill trigger `{trigger_id}` target must match trigger production"
            );
        }
        let trigger_is_strongman = trigger.produces.modifiers.contains(&Modifier::Strongman);
        if policy.strongman_bypasses_protect != trigger_is_strongman {
            panic!(
                "invalid night_resolution generated kill cause policy: generated kill trigger `{trigger_id}` strongman_bypasses_protect must match produced Strongman modifier"
            );
        }
    }
    for source in pack.night_resolution.generated_kill_cause_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid night_resolution generated kill cause policy: generated kill trigger id must not be empty"
            );
        }
        if !generated_sources.contains_key(source.as_str()) {
            panic!(
                "invalid night_resolution generated kill cause policy: unknown generated kill trigger `{source}`"
            );
        }
    }
}

fn require_night_resolution_generated_kill_ownership(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }

    let generated_triggers = night_resolution_generated_kill_triggers(pack);
    if generated_triggers.is_empty() {
        return;
    }

    let kill_causes = pack
        .night_resolution
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let protect_sources = night_resolution_protect_source_ids(pack);
    let save_tags = night_resolution_target_state_save_tags(pack);
    let block_sources = night_resolution_block_source_ids(pack);
    let generated_trigger_feeds = night_resolution_generated_trigger_feed_actions(pack);

    for trigger in generated_triggers {
        let trigger_id = trigger.id.as_str();
        if !kill_causes.contains(trigger_id) {
            panic!(
                "invalid night_resolution generated kill ownership: generated kill trigger `{trigger_id}` is missing from kill_cause_ids"
            );
        }

        for protect_source in &protect_sources {
            let Some(policy) = pack
                .night_resolution
                .protection_cause_policy
                .get(*protect_source)
            else {
                continue;
            };
            if !night_resolution_blocks_bypasses_contains(
                &policy.blocks,
                &policy.bypasses,
                trigger_id,
            ) {
                panic!(
                    "invalid night_resolution generated kill ownership: generated kill trigger `{trigger_id}` is not owned by protection source `{protect_source}`"
                );
            }
        }

        for save_tag in &save_tags {
            let Some(policy) = pack
                .night_resolution
                .target_state_save_policy
                .get(*save_tag)
            else {
                continue;
            };
            if !night_resolution_blocks_bypasses_contains(
                &policy.blocks,
                &policy.bypasses,
                trigger_id,
            ) {
                panic!(
                    "invalid night_resolution generated kill ownership: generated kill trigger `{trigger_id}` is not owned by target-state save `{save_tag}`"
                );
            }
        }

        for block_source in &block_sources {
            let Some(policy) = pack.night_resolution.suppression_policy.get(*block_source) else {
                continue;
            };
            for (action_id, trigger_ids) in &generated_trigger_feeds {
                if !trigger_ids.contains(trigger_id) {
                    continue;
                }
                if !night_resolution_suppression_contains(policy, action_id) {
                    panic!(
                        "invalid night_resolution generated kill ownership: generated kill trigger `{trigger_id}` feeder action `{action_id}` is not owned by block source `{block_source}`"
                    );
                }
            }
        }
    }
}

fn require_night_resolution_kill_cause_classifiers(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let kill_causes = pack
        .night_resolution
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if kill_causes.is_empty() {
        return;
    }

    for protect_source in night_resolution_protect_source_ids(pack) {
        let Some(policy) = pack
            .night_resolution
            .protection_cause_policy
            .get(protect_source)
        else {
            panic!(
                "invalid night_resolution protection cause policy: protection source `{protect_source}` must classify every kill cause"
            );
        };
        for cause in &kill_causes {
            if !night_resolution_blocks_bypasses_contains(&policy.blocks, &policy.bypasses, cause) {
                panic!(
                    "invalid night_resolution protection cause policy: protection source `{protect_source}` does not classify kill cause `{cause}`"
                );
            }
        }
    }

    for save_tag in night_resolution_target_state_save_tags(pack) {
        let Some(policy) = pack.night_resolution.target_state_save_policy.get(save_tag) else {
            panic!(
                "invalid night_resolution target-state save policy: target-state save `{save_tag}` must classify every kill cause"
            );
        };
        for cause in &kill_causes {
            if !night_resolution_blocks_bypasses_contains(&policy.blocks, &policy.bypasses, cause) {
                panic!(
                    "invalid night_resolution target-state save policy: target-state save `{save_tag}` does not classify kill cause `{cause}`"
                );
            }
        }
    }
}

fn night_resolution_strongman_bypass_cause_ids(pack: &Pack) -> BTreeSet<&str> {
    let mut causes = pack
        .night_resolution
        .strongman_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    causes.extend(
        pack.night_resolution
            .chosen_retaliation_cause_policy
            .iter()
            .filter(|(_, policy)| policy.strongman_bypasses_protect)
            .map(|(cause, _)| cause.as_str()),
    );
    causes.extend(
        pack.night_resolution
            .generated_kill_cause_policy
            .iter()
            .filter(|(_, policy)| policy.strongman_bypasses_protect)
            .map(|(cause, _)| cause.as_str()),
    );
    causes
}

fn require_night_resolution_strongman_bypass_classifiers(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let strongman_causes = night_resolution_strongman_bypass_cause_ids(pack);
    if strongman_causes.is_empty() {
        return;
    }

    for protect_source in night_resolution_protect_source_ids(pack) {
        let Some(policy) = pack
            .night_resolution
            .protection_cause_policy
            .get(protect_source)
        else {
            continue;
        };
        for cause in &policy.blocks {
            if strongman_causes.contains(cause.as_str()) {
                panic!(
                    "invalid night_resolution protection cause policy: strongman bypass cause `{cause}` must be classified in bypasses"
                );
            }
        }
        for cause in &policy.bypasses {
            if !strongman_causes.contains(cause.as_str()) {
                panic!(
                    "invalid night_resolution protection cause policy: bypassed kill cause `{cause}` must be a Strongman bypass cause"
                );
            }
        }
    }

    for save_tag in night_resolution_target_state_save_tags(pack) {
        let Some(policy) = pack.night_resolution.target_state_save_policy.get(save_tag) else {
            continue;
        };
        for cause in &policy.blocks {
            if strongman_causes.contains(cause.as_str()) {
                panic!(
                    "invalid night_resolution target-state save policy: strongman bypass cause `{cause}` must be classified in bypasses"
                );
            }
        }
        for cause in &policy.bypasses {
            if !strongman_causes.contains(cause.as_str()) {
                panic!(
                    "invalid night_resolution target-state save policy: bypassed kill cause `{cause}` must be a Strongman bypass cause"
                );
            }
        }
    }
}

fn require_night_resolution_suppression_classifiers(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let night_actions = night_resolution_night_action_roleblockability(pack);
    if night_actions.is_empty() {
        return;
    }

    for block_source in night_resolution_block_source_ids(pack) {
        let Some(policy) = pack.night_resolution.suppression_policy.get(block_source) else {
            panic!(
                "invalid night_resolution suppression policy: Block action `{block_source}` must classify every night action"
            );
        };
        if policy.scope.is_none() {
            panic!(
                "invalid night_resolution suppression policy: Block action `{block_source}` must declare suppression scope"
            );
        }
        for (action_id, action) in &night_actions {
            let suppresses = policy
                .suppresses
                .iter()
                .any(|configured| configured == action_id);
            let bypasses = policy
                .bypasses
                .iter()
                .any(|configured| configured == action_id);
            if !suppresses && !bypasses {
                panic!(
                    "invalid night_resolution suppression policy: block source `{block_source}` does not classify night action `{action_id}`"
                );
            }
            if policy.scope == Some(SuppressionScope::FirstMatchingAction) {
                if suppresses && (!action.roleblockable || action.strong_willed) {
                    panic!(
                        "invalid night_resolution suppression policy: suppression-immune action `{action_id}` must be classified in bypasses"
                    );
                }
                if bypasses && action.roleblockable && !action.strong_willed {
                    panic!(
                        "invalid night_resolution suppression policy: roleblockable action `{action_id}` must be classified in suppresses"
                    );
                }
            }
            if suppresses && bypasses {
                panic!(
                    "invalid night_resolution suppression policy: night action `{action_id}` cannot be both suppressed and bypassed"
                );
            }
        }
    }
}

fn require_night_resolution_suppression_precedence(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let abilities = night_resolution_night_ability_set(pack);
    if !abilities.contains(&IrAbility::Block) {
        return;
    }
    let edges = night_resolution_precedence_edges(pack, &abilities);
    let action_abilities = night_resolution_night_action_abilities(pack);

    for block_source in night_resolution_block_source_ids(pack) {
        let Some(policy) = pack.night_resolution.suppression_policy.get(block_source) else {
            continue;
        };
        for action_id in &policy.suppresses {
            let Some(suppressed_abilities) = action_abilities.get(action_id.as_str()) else {
                continue;
            };
            for ability in suppressed_abilities {
                if *ability == IrAbility::Block {
                    continue;
                }
                if abilities.contains(ability)
                    && !night_resolution_has_precedence_path(IrAbility::Block, *ability, &edges)
                {
                    panic!(
                        "invalid night_resolution suppression policy: block source `{block_source}` suppresses action `{action_id}` but night_resolution suppression policy requires Block precedence before suppressed ability `{ability:?}`"
                    );
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct NightResolutionNightAction {
    roleblockable: bool,
    strong_willed: bool,
}

fn night_resolution_night_action_roleblockability(
    pack: &Pack,
) -> BTreeMap<&str, NightResolutionNightAction> {
    let mut actions = BTreeMap::new();
    for action in pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
    {
        if !action.window.is_night_resolution_window() {
            continue;
        }
        let record = NightResolutionNightAction {
            roleblockable: action.constraints.roleblockable,
            strong_willed: action.has_modifier(Modifier::StrongWilled),
        };
        if let Some(existing) = actions.insert(action.id.as_str(), record) {
            if existing.roleblockable != record.roleblockable
                || existing.strong_willed != record.strong_willed
            {
                panic!(
                    "invalid night_resolution suppression policy: night action `{}` has inconsistent suppression traits",
                    action.id
                );
            }
        }
    }
    actions
}

fn night_resolution_night_action_abilities(pack: &Pack) -> BTreeMap<&str, BTreeSet<IrAbility>> {
    let mut actions = BTreeMap::new();
    for action in pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
    {
        if !action.window.is_night_resolution_window() {
            continue;
        }
        actions
            .entry(action.id.as_str())
            .or_insert_with(BTreeSet::new)
            .extend(night_resolution_night_order_abilities(action));
    }
    actions
}

fn night_resolution_night_ability_set(pack: &Pack) -> BTreeSet<IrAbility> {
    night_resolution_night_action_abilities(pack)
        .into_values()
        .flatten()
        .collect()
}

fn night_resolution_night_order_abilities(action: &ActionTemplate) -> Vec<IrAbility> {
    action
        .abilities()
        .filter(|ability| !(action.has_modifier(Modifier::Cpr) && *ability == IrAbility::Kill))
        .collect()
}

fn night_resolution_precedence_edges(
    pack: &Pack,
    abilities: &BTreeSet<IrAbility>,
) -> Vec<(IrAbility, IrAbility)> {
    let mut edges = BTreeSet::new();
    for rule in &pack.precedence {
        for beaten in &rule.beats {
            if abilities.contains(&rule.when.effect) && abilities.contains(beaten) {
                edges.insert((rule.when.effect, *beaten));
            }
        }
        for blocker in &rule.blocked_by {
            if abilities.contains(blocker) && abilities.contains(&rule.when.effect) {
                edges.insert((*blocker, rule.when.effect));
            }
        }
    }
    edges.into_iter().collect()
}

fn night_resolution_has_precedence_path(
    from: IrAbility,
    to: IrAbility,
    edges: &[(IrAbility, IrAbility)],
) -> bool {
    let mut stack = vec![from];
    let mut seen = BTreeSet::new();
    while let Some(current) = stack.pop() {
        if current == to {
            return true;
        }
        if !seen.insert(current) {
            continue;
        }
        for (_, next) in edges.iter().filter(|(edge_from, _)| *edge_from == current) {
            stack.push(*next);
        }
    }
    false
}

fn night_resolution_generated_kill_triggers(pack: &Pack) -> Vec<&TriggerRule> {
    pack.triggers
        .iter()
        .filter(|trigger| trigger.produces.ability == IrAbility::Kill)
        .collect()
}

fn night_resolution_protect_source_ids(pack: &Pack) -> BTreeSet<&str> {
    pack.night_resolution
        .protect_action_ids
        .iter()
        .chain(pack.night_resolution.bodyguard_action_ids.iter())
        .chain(pack.night_resolution.martyr_action_ids.iter())
        .chain(pack.night_resolution.cpr_action_ids.iter())
        .chain(pack.night_resolution.jailkeep_action_ids.iter())
        .map(String::as_str)
        .collect()
}

fn night_resolution_block_source_ids(pack: &Pack) -> BTreeSet<&str> {
    pack.night_resolution
        .block_action_ids
        .iter()
        .chain(pack.night_resolution.jailkeep_action_ids.iter())
        .map(String::as_str)
        .collect()
}

fn night_resolution_generated_trigger_feed_actions(pack: &Pack) -> BTreeMap<&str, BTreeSet<&str>> {
    let generated_triggers = night_resolution_generated_kill_triggers(pack);
    let mut feeds: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for action in pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
    {
        if !action.window.is_night_resolution_window() {
            continue;
        }
        for trigger in &generated_triggers {
            if action_can_feed_trigger(action, trigger.on) {
                feeds
                    .entry(action.id.as_str())
                    .or_default()
                    .insert(trigger.id.as_str());
            }
        }
    }
    feeds
}

fn action_can_feed_trigger(action: &ActionTemplate, on: TriggerOn) -> bool {
    match on {
        TriggerOn::Ability(IrAbility::Visit) => action.targets != TargetSpec::None,
        TriggerOn::Ability(ability) => action
            .abilities()
            .any(|action_ability| action_ability == ability),
        TriggerOn::Event(TriggerEvent::Death) => {
            action.has_ability(IrAbility::Kill) || action.has_ability(IrAbility::Retaliate)
        }
        TriggerOn::Event(TriggerEvent::EffectMarked) => action.has_ability(IrAbility::Mark),
        TriggerOn::Event(TriggerEvent::Lynch | TriggerEvent::PhaseEnd | TriggerEvent::Win) => false,
        TriggerOn::Event(TriggerEvent::Visit) => action.targets != TargetSpec::None,
    }
}

fn night_resolution_blocks_bypasses_contains(
    blocks: &[String],
    bypasses: &[String],
    cause: &str,
) -> bool {
    blocks.iter().any(|item| item == cause) || bypasses.iter().any(|item| item == cause)
}

fn night_resolution_suppression_contains(
    policy: &crate::pack::SuppressionPolicy,
    action_id: &str,
) -> bool {
    policy.suppresses.iter().any(|item| item == action_id)
        || policy.bypasses.iter().any(|item| item == action_id)
}

fn require_night_resolution_trigger_fixpoint_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let generated_sources = pack
        .triggers
        .iter()
        .filter(|trigger| trigger.produces.ability == IrAbility::Kill)
        .map(|trigger| (trigger.id.as_str(), trigger))
        .collect::<BTreeMap<_, _>>();
    for (&trigger_id, trigger) in &generated_sources {
        let Some(policy) = pack
            .night_resolution
            .trigger_fixpoint_policy
            .get(trigger_id)
        else {
            panic!(
                "invalid night_resolution trigger fixpoint policy: generated kill trigger `{trigger_id}` must declare trigger fixpoint policy"
            );
        };
        if policy.on.is_none() {
            panic!(
                "invalid night_resolution trigger fixpoint policy: trigger `{trigger_id}` must declare observed trigger on"
            );
        }
        if policy.on != Some(trigger.on) {
            panic!(
                "invalid night_resolution trigger fixpoint policy: trigger `{trigger_id}` on must match trigger rule"
            );
        }
        if !policy.produced_kill_reenters {
            panic!(
                "invalid night_resolution trigger fixpoint policy: generated kill trigger `{trigger_id}` must declare produced_kill_reenters true"
            );
        }
        if policy.loop_cap.is_none() {
            panic!(
                "invalid night_resolution trigger fixpoint policy: trigger `{trigger_id}` must declare loop_cap policy"
            );
        }
        if policy.loop_cap != Some(TriggerLoopCapPolicy::RedirectLoopCap) {
            panic!(
                "invalid night_resolution trigger fixpoint policy: trigger `{trigger_id}` loop_cap must use RedirectLoopCap"
            );
        }
        if !policy.trace {
            panic!(
                "invalid night_resolution trigger fixpoint policy: trigger `{trigger_id}` must declare trace true"
            );
        }
    }
    for source in pack.night_resolution.trigger_fixpoint_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid night_resolution trigger fixpoint policy: trigger fixpoint source id must not be empty"
            );
        }
        if !generated_sources.contains_key(source.as_str()) {
            panic!(
                "invalid night_resolution trigger fixpoint policy: unknown trigger fixpoint source `{source}`"
            );
        }
    }
}

fn require_night_resolution_hide_dependency_cause_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let hide_sources = pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .filter(|action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Mark)
                && action.has_modifier(Modifier::Hider)
        })
        .map(|action| action.id.as_str())
        .collect::<BTreeSet<_>>();
    let direct_kill_causes = pack
        .night_resolution
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    for &action_id in &hide_sources {
        let Some(cause) = pack
            .night_resolution
            .hide_dependency_cause_policy
            .get(action_id)
        else {
            panic!(
                "invalid night_resolution hide dependency cause policy: hide dependency action `{action_id}` must declare dependency cause"
            );
        };
        if cause.trim().is_empty() {
            panic!(
                "invalid night_resolution hide dependency cause policy: hide dependency action `{action_id}` must declare non-empty dependency cause"
            );
        }
        if direct_kill_causes.contains(cause.as_str()) {
            panic!(
                "invalid night_resolution hide dependency cause policy: hide dependency action `{action_id}` cause `{cause}` must not reuse a direct kill cause"
            );
        }
    }
    for source in pack.night_resolution.hide_dependency_cause_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid night_resolution hide dependency cause policy: hide dependency source id must not be empty"
            );
        }
        if !hide_sources.contains(source.as_str()) {
            panic!(
                "invalid night_resolution hide dependency cause policy: unknown hide dependency source `{source}`"
            );
        }
    }
}

fn night_resolution_target_state_gate_tags(pack: &Pack) -> BTreeSet<&str> {
    if pack.night_resolution.is_explicit() {
        return pack
            .night_resolution
            .target_state_gate_tags
            .iter()
            .map(String::as_str)
            .collect();
    }
    night_resolution_derived_target_state_gate_tags(pack)
}

fn night_resolution_derived_target_state_gate_tags(pack: &Pack) -> BTreeSet<&str> {
    let mut tags = BTreeSet::new();
    for role in pack.roles.values() {
        for effect in &role.effects {
            record_night_resolution_target_state_gate_tag(&mut tags, effect);
        }
        for action in &role.actions {
            if let Some(effect) = action.effect.as_deref() {
                record_night_resolution_target_state_gate_tag(&mut tags, effect);
            }
        }
    }
    for effect in pack.effects.keys() {
        record_night_resolution_target_state_gate_tag(&mut tags, effect);
    }
    tags
}

fn record_night_resolution_target_state_gate_tag<'a>(
    tags: &mut BTreeSet<&'a str>,
    effect: &'a str,
) {
    if effect == "ascetic" || effect == "commuted" || effect == "untargetable" {
        tags.insert(effect);
    }
}

fn require_ninja_visibility_policy(pack: &Pack) {
    if !pack_has_ninja_action(pack) {
        return;
    }
    let Some(rule) = pack.visibility.get(&IrAbility::Investigate) else {
        panic!("invalid visibility policy: Ninja actions require Investigate visibility policy");
    };
    if !rule.unless_modifiers.contains(&Modifier::Ninja) {
        panic!(
            "invalid visibility policy: Ninja actions require Investigate visibility unless_modifiers Ninja"
        );
    }
}

fn require_visibility_families(pack: &Pack) {
    let declared = pack
        .visibility_families
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    if declared.len() != pack.visibility_families.len() {
        panic!("invalid visibility families: visibility_families must not contain duplicates");
    }
    let required = visibility_required_families(pack);
    if !required.is_empty() && declared.is_empty() {
        panic!(
            "invalid visibility families: packs with visibility policy surfaces must declare visibility_families"
        );
    }
    for family in &required {
        if !declared.contains(family) {
            panic!("invalid visibility families: visibility_families must include `{family:?}`");
        }
    }
    for family in &declared {
        if !required.contains(family) {
            panic!(
                "invalid visibility families: declared visibility family `{family:?}` has no matching policy surface"
            );
        }
    }
    if required.contains(&VisibilityFamily::GraphVisitResults)
        || required.contains(&VisibilityFamily::StealthNinjaVisits)
        || required.contains(&VisibilityFamily::ResultTampering)
        || required.contains(&VisibilityFamily::PrivateInvestigationResults)
    {
        let Some(rule) = pack.visibility.get(&IrAbility::Investigate) else {
            panic!("invalid visibility policy: visibility families require Investigate visibility policy");
        };
        if (required.contains(&VisibilityFamily::GraphVisitResults)
            || required.contains(&VisibilityFamily::StealthNinjaVisits))
            && !rule.sees.contains(&crate::pack::VisField::TargetId)
        {
            panic!(
                "invalid visibility policy: graph-derived visit visibility requires Investigate visibility to expose TargetId"
            );
        }
        if (required.contains(&VisibilityFamily::ResultTampering)
            || required.contains(&VisibilityFamily::PrivateInvestigationResults))
            && !rule.sees.contains(&crate::pack::VisField::Result)
        {
            panic!(
                "invalid visibility policy: result visibility families require Investigate visibility to expose Result"
            );
        }
    }
}

fn pack_has_ninja_action(pack: &Pack) -> bool {
    pack.roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .any(|action| action.has_modifier(Modifier::Ninja))
}

fn bulletproof_reason(tags: &BTreeSet<String>) -> Option<&'static str> {
    if tags.contains("bulletproof") {
        Some("bulletproof")
    } else if tags.contains("bulletproof_vest") {
        Some("bulletproof_vest")
    } else {
        None
    }
}

fn action_counter_id(template_id: &str) -> String {
    format!("x_shot:{template_id}")
}

fn day_session_counter_id(session_id: &str, template_id: &str) -> String {
    format!("day_session:{session_id}:{template_id}")
}

fn inventory_counter_id(grant_id: &str) -> String {
    format!("inventory:{grant_id}")
}

fn action_counter_used_count(input: &ResolutionInput, actor: &str, template_id: &str) -> u16 {
    let counter_id = action_counter_id(template_id);
    input
        .state
        .use_counters
        .iter()
        .find(|counter| counter.actor == actor && counter.counter_id == counter_id)
        .map(|counter| {
            counter
                .used
                .max(counter.limit.saturating_sub(counter.remaining))
        })
        .unwrap_or(0)
}

fn action_counter_exhausted(
    input: &ResolutionInput,
    actor: &str,
    template_id: &str,
    limit: u16,
) -> bool {
    let counter_id = action_counter_id(template_id);
    input.state.use_counters.iter().any(|counter| {
        counter.actor == actor
            && counter.counter_id == counter_id
            && (counter.remaining == 0
                || action_counter_used_count(input, actor, template_id) >= limit)
    })
}

fn inventory_counter_exhausted(input: &ResolutionInput, actor: &str, grant_id: &str) -> bool {
    let counter_id = inventory_counter_id(grant_id);
    input.state.use_counters.iter().any(|counter| {
        counter.actor == actor && counter.counter_id == counter_id && counter.remaining == 0
    })
}

fn day_session_counter_used(
    input: &ResolutionInput,
    actor: &str,
    session_id: &str,
    template_id: &str,
) -> u16 {
    let counter_id = day_session_counter_id(session_id, template_id);
    input
        .state
        .use_counters
        .iter()
        .find(|counter| counter.actor == actor && counter.counter_id == counter_id)
        .map(|counter| counter.used)
        .unwrap_or(0)
}

fn action_use_counted(
    input: &ResolutionInput,
    actor: SlotId,
    template_id: String,
    action_id: String,
    limit: u16,
) -> InnerEvent {
    let used = action_counter_used_count(input, &actor, &template_id)
        .saturating_add(1)
        .min(limit);
    counter_use_counted(CounterUseInput {
        phase_id: input.phase_id.clone(),
        counter_id: action_counter_id(&template_id),
        actor,
        template_id,
        consumed_action: action_id,
        cadence_policy: "x_shot".to_string(),
        phase_scope: "game".to_string(),
        limit,
        used,
    })
}

fn day_session_use_counted(
    input: &ResolutionInput,
    actor: SlotId,
    session_id: &str,
    template_id: String,
    action_id: String,
    limit: u16,
    used: u16,
) -> InnerEvent {
    InnerEvent::ActionUseCounted {
        counter_id: day_session_counter_id(session_id, &template_id),
        actor,
        template_id,
        consumed_action: action_id,
        cadence_policy: "day_session".to_string(),
        phase_scope: "session".to_string(),
        limit,
        used,
        remaining: limit.saturating_sub(used),
        phase_id: input.phase_id.clone(),
    }
}

fn inventory_use_counted(
    input: &ResolutionInput,
    actor: SlotId,
    grant_id: &str,
    template_id: String,
    action_id: String,
    limit: u16,
    remaining: u16,
) -> InnerEvent {
    InnerEvent::ActionUseCounted {
        counter_id: inventory_counter_id(grant_id),
        actor,
        template_id,
        consumed_action: action_id,
        cadence_policy: "inventory".to_string(),
        phase_scope: "grant".to_string(),
        limit,
        used: limit.saturating_sub(remaining),
        remaining,
        phase_id: input.phase_id.clone(),
    }
}

fn alive_slot_ids(input: &ResolutionInput) -> Vec<SlotId> {
    input
        .state
        .slots
        .iter()
        .filter(|slot| slot.is_alive())
        .map(|slot| slot.slot_id.clone())
        .collect()
}

fn effect_duration(pack: &Pack, template: &ActionTemplate, effect: &str) -> EffectDuration {
    template
        .effect_duration
        .or_else(|| pack.effects.get(effect).map(|policy| policy.duration))
        .unwrap_or(EffectDuration::Persistent)
}

fn effect_visibility(pack: &Pack, effect: &str) -> EffectVisibility {
    pack.effects
        .get(effect)
        .map(|policy| policy.visibility)
        .unwrap_or(EffectVisibility::Hidden)
}

fn effect_audience(
    input: &ResolutionInput,
    visibility: EffectVisibility,
    actor: &SlotId,
    target: &SlotId,
) -> Vec<SlotId> {
    match visibility {
        EffectVisibility::Hidden => Vec::new(),
        EffectVisibility::Public => alive_slot_ids(input),
        EffectVisibility::Actor => vec![actor.clone()],
        EffectVisibility::Target => vec![target.clone()],
        EffectVisibility::ActorAndTarget => {
            let mut audience = vec![actor.clone()];
            if actor != target {
                audience.push(target.clone());
            }
            audience
        }
    }
}

fn effects_marked(
    input: &ResolutionInput,
    pack: &Pack,
    effect: String,
    target: SlotId,
    actor: SlotId,
    source_action: String,
    duration: EffectDuration,
) -> InnerEvent {
    let visibility = effect_visibility(pack, &effect);
    InnerEvent::EffectsMarked {
        effect,
        target,
        actor,
        source_action: Some(source_action),
        phase_id: Some(input.phase_id.clone()),
        duration,
        visibility,
    }
}

fn emit_effect_notification(
    input: &ResolutionInput,
    pack: &Pack,
    events: &mut Vec<InnerEvent>,
    effect: &str,
    status: &str,
    actor: &SlotId,
    target: &SlotId,
) {
    let visibility = effect_visibility(pack, effect);
    if visibility == EffectVisibility::Hidden {
        return;
    }
    events.push(InnerEvent::EffectNotification {
        effect: effect.to_string(),
        status: status.to_string(),
        audience: effect_audience(input, visibility, actor, target),
        phase_id: None,
    });
}

fn emit_grant_notification(
    input: &ResolutionInput,
    events: &mut Vec<InnerEvent>,
    grant_id: &str,
    visibility: EffectVisibility,
    actor: &SlotId,
    target: &SlotId,
) {
    if visibility == EffectVisibility::Hidden {
        return;
    }
    events.push(InnerEvent::EffectNotification {
        effect: "grant".to_string(),
        status: grant_id.to_string(),
        audience: effect_audience(input, visibility, actor, target),
        phase_id: None,
    });
}

fn phase_window_matches(window: Window, phase_kind: PhaseKind) -> bool {
    match window {
        Window::Any => true,
        Window::Day => phase_kind == PhaseKind::Day,
        Window::Night => phase_kind == PhaseKind::Night,
        Window::Twilight => phase_kind == PhaseKind::Twilight,
        Window::Instant => false,
    }
}

fn phase_window_mismatch_reason(window: Window, phase_kind: PhaseKind) -> Option<&'static str> {
    if phase_window_matches(window, phase_kind) {
        return None;
    }
    match window {
        Window::Any => None,
        Window::Day => Some("day_specific"),
        Window::Night => Some("night_specific"),
        Window::Twilight => Some("twilight_specific"),
        Window::Instant => Some("instant_specific"),
    }
}

/// Resolve a window's submissions into the full deterministic resolver output.
///
/// The resolver is intentionally fallible at its public boundary: a snapshot
/// assembled from storage or fixture JSON must not be allowed to mix a phase
/// id with contradictory denormalized coordinates.
pub fn resolve(input: ResolutionInput) -> Result<ResolutionOutput, ResolutionInputError> {
    input.validate()?;
    let inner = resolve_inner(&input);
    finalize_resolution(input, inner)
}

/// Resolve command-time Instant submissions into the same validated envelope shape
/// as ordinary phase resolution. Instant actions are not replayed by
/// `resolve_inner`; callers must pass only the instant submissions being committed.
pub fn resolve_instant(input: ResolutionInput) -> Result<ResolutionOutput, ResolutionInputError> {
    input.validate()?;
    let mut events = Vec::new();
    let mut trace_decisions = Vec::new();
    resolve_instant_self_destruct_actions(&input, &mut events);
    resolve_beloved_princess_prompts(&input, &mut events, &mut trace_decisions);
    let deaths = deaths_from_events(&events);
    events.push(InnerEvent::PhaseAnnouncement(phase_announcement(
        &input, deaths,
    )));
    let inner = InnerResolution {
        events,
        trace_edges: Vec::new(),
        trace_decisions,
        trace_notes: Vec::new(),
    };
    finalize_resolution(input, inner)
}

fn finalize_resolution(
    input: ResolutionInput,
    mut inner: InnerResolution,
) -> Result<ResolutionOutput, ResolutionInputError> {
    let mut events = inner.events;
    apply_treestump_policy(&input, &mut events, &mut inner.trace_decisions);
    let mut post_state = apply_events(&input.state, &events);
    if !has_win_reached(&events) {
        if let Some(win) = check_win(&post_state, input.pack.as_ref()) {
            apply_win_triggers_before_final(
                &input,
                &mut events,
                &win,
                &mut inner.trace_decisions,
                &mut inner.trace_notes,
            );
            post_state = apply_events(&input.state, &events);
            let final_win = check_win(&post_state, input.pack.as_ref()).unwrap_or(win);
            events.push(final_win);
            post_state = apply_events(&input.state, &events);
        }
    }

    let applied = wrap_resolution(&input, events);
    let trace = build_resolution_trace(ResolutionTraceInput {
        applied: &applied,
        trace_edges: inner.trace_edges,
        trace_decisions: inner.trace_decisions,
        trace_notes: inner.trace_notes,
    });
    crate::events::validate_resolution_applied(&applied, RESULT_VERSION)
        .map_err(ResolutionInputError::GeneratedResolution)?;
    crate::events::validate_resolution_trace(&trace, crate::events::TRACE_VERSION)
        .map_err(ResolutionInputError::GeneratedTrace)?;

    Ok(ResolutionOutput {
        applied,
        trace,
        post_state,
    })
}

fn has_win_reached(events: &[InnerEvent]) -> bool {
    events
        .iter()
        .any(|event| matches!(event, InnerEvent::WinReached { .. }))
}

fn apply_treestump_policy(
    input: &ResolutionInput,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    let policy = &input.pack.document().treestump_policy;
    if !policy.enabled {
        return;
    }

    let Some(announcement_index) = events
        .iter()
        .position(|event| matches!(event, InnerEvent::PhaseAnnouncement(_)))
    else {
        return;
    };

    let mut rolling = input.state.clone();
    let mut tags_to_insert = Vec::new();
    for event in events.iter().take(announcement_index) {
        if let InnerEvent::PlayerKilled { slot_id, cause, .. } = event {
            if treestump_applies(policy, &rolling, slot_id) {
                tags_to_insert.push(InnerEvent::SlotStatusTagged {
                    slot_id: slot_id.clone(),
                    tag: policy.status_tag.clone(),
                    source: cause.clone(),
                });
                trace_decisions.push(DecisionTrace {
                    stage: "death:status".to_string(),
                    source: format!("cause:{cause}"),
                    outcome: "treestump_status_tagged".to_string(),
                    detail: crate::json_atom!({
                        "slot_id": slot_id,
                        "status_tag": policy.status_tag,
                    }),
                });
            }
        }
        rolling = apply_events(&rolling, std::slice::from_ref(event));
    }

    if !tags_to_insert.is_empty() {
        events.splice(announcement_index..announcement_index, tags_to_insert);
    }
}

fn treestump_applies(
    policy: &crate::pack::TreestumpPolicy,
    state: &StateSnapshot,
    slot_id: &SlotId,
) -> bool {
    let Some(slot) = state.slots.iter().find(|slot| &slot.slot_id == slot_id) else {
        return false;
    };
    slot.is_alive()
        && policy
            .eligible_roles
            .iter()
            .any(|role| role == &slot.role_key)
        && !slot.status_tags.iter().any(|tag| tag == &policy.status_tag)
}

/// Resolve a window's submissions into ordered inner events.
///
/// Canonical inner-event ordering: the phase's own results, then the single
/// trailing `PhaseAnnouncement` (doc 10), then — iff the post-resolution state
/// satisfies a `WinPolicy` rule — a final `WinReached`. Win-check runs **once**,
/// at phase end, on the state produced by folding this resolution's events
/// (`apply_events`); it never runs mid-resolution.
fn resolve_inner(input: &ResolutionInput) -> InnerResolution {
    require_night_resolution_kill_cause_catalog(input.pack.document());
    require_night_resolution_specialized_protect_action_policy(input.pack.document());
    require_night_resolution_team_kill_action_policy(input.pack.document());
    require_night_resolution_action_bucket_shapes(input.pack.document());
    require_night_resolution_block_action_policy(input.pack.document());
    require_night_resolution_target_state_save_catalog(input.pack.document());
    require_night_resolution_target_state_save_policy(input.pack.document());
    require_night_resolution_target_state_gate_catalog(input.pack.document());
    require_night_resolution_kill_stacking_policy(input.pack.document());
    require_night_resolution_strongman_bypass_policy(input.pack.document());
    require_night_resolution_protect_action_policy(input.pack.document());
    require_night_resolution_protection_cause_policy(input.pack.document());
    require_conversion_policy(input.pack.document());
    require_night_resolution_strongman_action_policy(input.pack.document());
    require_night_resolution_chosen_retaliation_cause_policy(input.pack.document());
    require_night_resolution_generated_kill_cause_policy(input.pack.document());
    require_night_resolution_suppression_policy_shape(input.pack.document());
    require_night_resolution_generated_kill_ownership(input.pack.document());
    require_night_resolution_strongman_bypass_classifiers(input.pack.document());
    require_night_resolution_kill_cause_classifiers(input.pack.document());
    require_night_resolution_trigger_fixpoint_policy(input.pack.document());
    let mut events = grant_consumption_events(input);
    let (mut ingest_events, mut ingest_decisions) = invalid_submission_ingest_halts(input);
    events.append(&mut ingest_events);
    let (mut window_events, mut window_decisions) = phase_window_mismatch_halts(input);
    events.append(&mut window_events);
    ingest_decisions.append(&mut window_decisions);
    let mut inner = match input.state.phase_id.kind() {
        PhaseKind::Day => resolve_day(input),
        PhaseKind::Twilight => resolve_twilight(input),
        PhaseKind::Night => resolve_night(input),
    };
    ingest_decisions.append(&mut inner.trace_decisions);
    inner.trace_decisions = ingest_decisions;
    events.append(&mut inner.events);
    inner.events = events;
    inner
}

fn invalid_submission_ingest_halts(
    input: &ResolutionInput,
) -> (Vec<InnerEvent>, Vec<DecisionTrace>) {
    let mut events = Vec::new();
    let mut decisions = Vec::new();

    for sub in input
        .submissions
        .iter()
        .filter(|sub| !sub.withdrawn)
        .filter(|sub| {
            !(matches!(
                input.state.phase_id.kind(),
                PhaseKind::Day | PhaseKind::Twilight
            ) && sub.template_id == "day_vote")
        })
        .filter(|sub| !submission_has_exhausted_item_grant(input, sub))
        .filter(|sub| lookup_submission_template(input, sub).is_none())
    {
        let actor_role = input
            .state
            .slots
            .iter()
            .find(|slot| slot.slot_id == sub.actor)
            .map(|slot| slot.role_key.clone());
        let grant_id = sub
            .metadata
            .get("grant_id")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        let reason = "template_not_available_to_actor".to_string();

        events.push(InnerEvent::ActionIngestHalted {
            action_id: sub.action_id.clone(),
            actor: sub.actor.clone(),
            actor_role: actor_role.clone(),
            template_id: sub.template_id.clone(),
            targets: sub.targets.clone(),
            phase_id: sub.phase_id.clone(),
            reason: reason.clone(),
            grant_id: grant_id.clone(),
        });
        decisions.push(DecisionTrace {
            stage: "submission_ingest".to_string(),
            source: format!("action:{}", sub.action_id),
            outcome: "submission_template_rejected".to_string(),
            detail: crate::json_atom!({
                "action_id": sub.action_id,
                "actor": sub.actor,
                "actor_role": actor_role,
                "template_id": sub.template_id,
                "grant_id": grant_id,
                "targets": sub.targets,
                "reason": reason,
            }),
        });
    }

    (events, decisions)
}

fn phase_window_mismatch_halts(input: &ResolutionInput) -> (Vec<InnerEvent>, Vec<DecisionTrace>) {
    let mut events = Vec::new();
    let mut decisions = Vec::new();

    for sub in input.submissions.iter().filter(|sub| !sub.withdrawn) {
        let Some(template) = lookup_submission_template(input, sub) else {
            continue;
        };
        let Some(reason) =
            phase_window_mismatch_reason(template.window, input.state.phase_id.kind())
        else {
            continue;
        };

        events.push(InnerEvent::ActionInterfered {
            actor: sub.actor.clone(),
            reason: reason.to_string(),
        });
        decisions.push(DecisionTrace {
            stage: "submission_ingest".to_string(),
            source: format!("action:{}", sub.action_id),
            outcome: "phase_window_rejected".to_string(),
            detail: crate::json_atom!({
                "action_id": sub.action_id,
                "actor": sub.actor,
                "template_id": sub.template_id,
                "phase_id": sub.phase_id,
                "window": template.window,
                "reason": reason,
            }),
        });
    }

    (events, decisions)
}

fn grant_consumption_events(input: &ResolutionInput) -> Vec<InnerEvent> {
    let mut grants = input.state.action_grants.clone();
    grants.sort_by(|a, b| {
        a.phase_id
            .number()
            .cmp(&b.phase_id.number())
            .then(a.phase_id.cmp(&b.phase_id))
            .then(a.actor.cmp(&b.actor))
            .then(a.grant_id.cmp(&b.grant_id))
    });

    let mut submissions: Vec<_> = input
        .submissions
        .iter()
        .filter(|sub| !sub.withdrawn)
        .filter_map(|sub| submission_consumed_grant_id(input, sub).map(|grant_id| (sub, grant_id)))
        .collect();
    submissions.sort_by(|(a, _), (b, _)| {
        a.submitted_at
            .cmp(&b.submitted_at)
            .then(a.action_id.cmp(&b.action_id))
    });

    let mut events = Vec::new();
    for (sub, grant_id) in submissions {
        let Some(grant) = grants.iter_mut().find(|grant| {
            grant.target == sub.actor && grant.grant_id == grant_id && grant.uses > 0
        }) else {
            continue;
        };
        if grant.kind == GrantKind::Item
            && inventory_counter_exhausted(input, &sub.actor, &grant_id)
        {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "inventory_exhausted".to_string(),
            });
            continue;
        }
        grant.uses = grant.uses.saturating_sub(1);
        let remaining_uses = grant.uses;
        events.push(InnerEvent::ActionGrantConsumed {
            grant_id: grant_id.clone(),
            actor: sub.actor.clone(),
            action_id: sub.action_id.clone(),
            source_action: grant.source_action.clone(),
            phase_id: input.phase_id.clone(),
            remaining_uses,
        });
        if grant.kind == GrantKind::Item {
            events.push(inventory_use_counted(
                input,
                sub.actor.clone(),
                &grant_id,
                sub.template_id.clone(),
                sub.action_id.clone(),
                declared_grant_uses(input.pack.document(), &grant_id)
                    .unwrap_or(remaining_uses.saturating_add(1)),
                remaining_uses,
            ));
        }
    }
    events
}

fn declared_grant_uses(pack: &Pack, grant_id: &str) -> Option<u16> {
    pack.roles
        .values()
        .flat_map(|role| role.actions.iter())
        .flat_map(|action| action.grant.iter().chain(action.grant_options.iter()))
        .find(|grant| grant.grant_id == grant_id)
        .map(|grant| grant.uses)
}

fn wrap_resolution(input: &ResolutionInput, inner: Vec<InnerEvent>) -> ResolutionApplied {
    let kills = inner
        .iter()
        .filter(|e| matches!(e, InnerEvent::PlayerKilled { .. }))
        .count();
    let saves = inner
        .iter()
        .filter(|e| matches!(e, InnerEvent::PlayerSaved { .. }))
        .count();
    let events: Vec<IndexedEvent> = inner
        .into_iter()
        .enumerate()
        .map(|(index, event)| IndexedEvent { index, event })
        .collect();

    ResolutionApplied {
        phase_id: input.phase_id.clone(),
        run_id: input.run_id.clone(),
        result_version: RESULT_VERSION,
        seed: input.seed,
        counts: ResolutionCounts {
            events: events.len(),
            kills,
            saves,
        },
        events,
        started_at: input.logical_time,
        finished_at: input.logical_time,
    }
}

/// Evaluate a validated pack's `WinPolicy` against a (post-resolution) state.
/// Rules are tried in order; the FIRST match wins and yields a `WinReached`.
/// Returns `None` if no rule fires. PURE: a fold over alive-counts, no
/// clock/RNG.
pub fn check_win(state: &StateSnapshot, pack: &ValidatedPack) -> Option<InnerEvent> {
    check_win_document(state, pack.document())
}

fn check_win_document(state: &StateSnapshot, pack: &Pack) -> Option<InnerEvent> {
    for rule in &pack.win.rules {
        let (fires, reason) = match &rule.when {
            WinCondition::FactionEliminated(faction) => {
                let alive = alive_in_faction_for_win(state, pack, faction);
                (
                    alive == 0,
                    format!("faction {faction} eliminated (0 alive)"),
                )
            }
            WinCondition::FactionReachesParity(faction) => {
                let alive = alive_in_faction_for_win(state, pack, faction);
                let others = alive_total_for_win(state, pack) - alive;
                (
                    alive > 0 && alive >= others,
                    format!("faction {faction} reaches parity ({alive} vs {others} others)"),
                )
            }
            WinCondition::AllOtherFactionsEliminated(faction) => {
                // R5: faction `f` is the sole surviving faction. Every other
                // alive slot (any other alignment, or alignment-less) must be 0,
                // and `f` must have >= 1 alive.
                let alive = alive_in_faction_for_win(state, pack, faction);
                let others = alive_total_for_win(state, pack) - alive;
                (
                    alive > 0 && others == 0,
                    format!("all factions other than {faction} eliminated ({alive} alive)"),
                )
            }
        };
        let blocked_by_alive = rule
            .blocked_by_alive
            .iter()
            .any(|alignment| alive_in_faction_for_win(state, pack, alignment) > 0);
        if fires && !blocked_by_alive {
            return Some(InnerEvent::WinReached {
                winner: rule.winner.clone(),
                reason,
                metadata: survival_win_metadata(state, pack),
            });
        }
    }
    None
}

fn require_win_families(pack: &Pack) {
    let declared = pack.win_families.iter().copied().collect::<BTreeSet<_>>();
    if declared.len() != pack.win_families.len() {
        panic!("invalid win families: win_families must not contain duplicates");
    }
    if pack.ir_version < 46 {
        if !declared.is_empty() {
            panic!("invalid win families: win_families requires ir_version >= 46");
        }
        return;
    }
    let required = win_required_families(pack);
    if !required.is_empty() && declared.is_empty() {
        panic!("invalid win families: packs with win policy surfaces must declare win_families");
    }
    for family in &required {
        if !declared.contains(family) {
            panic!("invalid win families: win_families must include `{family:?}`");
        }
    }
    for family in &declared {
        if !required.contains(family) {
            panic!(
                "invalid win families: declared win family `{family:?}` has no matching policy surface"
            );
        }
    }
    if required.contains(&WinFamily::TargetLynchIndependent)
        && pack.target_lynch_win_policies.is_empty()
    {
        panic!("invalid win families: TargetLynchIndependent requires target_lynch_win_policies");
    }
    if required.contains(&WinFamily::SelfLynchIndependent)
        && pack.self_lynch_win_policies.is_empty()
    {
        panic!("invalid win families: SelfLynchIndependent requires self_lynch_win_policies");
    }
    if required.contains(&WinFamily::SurvivalIndependent) && pack.win.survival_awards.is_empty() {
        panic!("invalid win families: SurvivalIndependent requires win.survival_awards");
    }
}

fn alive_in_faction_for_win(state: &StateSnapshot, pack: &Pack, faction: &str) -> usize {
    state
        .slots
        .iter()
        .filter(|slot| {
            slot.is_alive()
                && slot.alignment.as_deref() == Some(faction)
                && !is_survival_award_slot(pack, slot)
        })
        .count()
}

fn alive_total_for_win(state: &StateSnapshot, pack: &Pack) -> usize {
    state
        .slots
        .iter()
        .filter(|slot| slot.is_alive() && !is_survival_award_slot(pack, slot))
        .count()
}

fn is_survival_award_slot(pack: &Pack, slot: &SlotState) -> bool {
    pack.win.survival_awards.iter().any(|award| {
        award
            .eligible_roles
            .iter()
            .any(|role| role == &slot.role_key)
    })
}

fn survival_win_metadata(
    state: &StateSnapshot,
    pack: &Pack,
) -> Option<crate::events::WinReachedMetadata> {
    let mut awards = Vec::new();
    for award in &pack.win.survival_awards {
        let source_event = award
            .source_event
            .clone()
            .unwrap_or_else(|| format!("win.{}", award.id));
        for slot in state.slots.iter().filter(|slot| {
            slot.is_alive()
                && award
                    .eligible_roles
                    .iter()
                    .any(|role| role == &slot.role_key)
        }) {
            awards.push(crate::events::SurvivalWinAward {
                policy: award.id.clone(),
                winner: award.winner.clone(),
                slot_id: slot.slot_id.clone(),
                role: slot.role_key.clone(),
                source_event: source_event.clone(),
            });
        }
    }
    if awards.is_empty() {
        None
    } else {
        Some(crate::events::WinReachedMetadata {
            survival_awards: awards,
            ..crate::events::WinReachedMetadata::default()
        })
    }
}

fn effect_was_cleared(
    cleared_effects: &BTreeSet<(SlotId, String)>,
    target: &SlotId,
    effect: &str,
) -> bool {
    cleared_effects.contains(&(target.clone(), effect.to_string()))
}

fn active_pending_death<'a>(
    input: &'a ResolutionInput,
    cleared_effects: &BTreeSet<(SlotId, String)>,
    target: &SlotId,
) -> Option<&'a DelayedDeathRecord> {
    let slot = input
        .state
        .slots
        .iter()
        .find(|slot| slot.slot_id == *target)?;
    if !slot.is_alive() {
        return None;
    }
    input.state.delayed_deaths.iter().find(|record| {
        record.target == *target
            && record.effect == "poisoned"
            && slot.effects.contains(&record.effect)
            && !effect_was_cleared(cleared_effects, target, &record.effect)
    })
}

fn apply_pending_poison(
    input: &ResolutionInput,
    cleared_effects: &BTreeSet<(SlotId, String)>,
    events: &mut Vec<InnerEvent>,
    killed: &mut Vec<SlotId>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    for queued in input
        .state
        .delayed_deaths
        .iter()
        .filter(|record| record.effect == "poisoned")
    {
        let Some(slot) = input
            .state
            .slots
            .iter()
            .find(|slot| slot.slot_id == queued.target)
        else {
            continue;
        };
        if !slot.is_alive() || killed.contains(&slot.slot_id) {
            trace_decisions.push(DecisionTrace {
                stage: "night:pending_effect".to_string(),
                source: format!("delayed_death:{}", queued.queue_id),
                outcome: "pending_poison_target_already_dead".to_string(),
                detail: crate::json_atom!({
                    "target": queued.target,
                    "effect": queued.effect,
                    "cause": queued.cause,
                    "source": queued.source,
                    "source_action": queued.source_action,
                }),
            });
            events.push(InnerEvent::DelayedDeathResolved {
                queue_id: queued.queue_id.clone(),
                target: queued.target.clone(),
                cause: queued.cause.clone(),
                effect: queued.effect.clone(),
                outcome: "target_already_dead".to_string(),
                phase_id: input.phase_id.clone(),
            });
            continue;
        }
        if effect_was_cleared(cleared_effects, &slot.slot_id, "poisoned")
            || !slot.effects.contains(&"poisoned".to_string())
        {
            trace_decisions.push(DecisionTrace {
                stage: "night:pending_effect".to_string(),
                source: format!("delayed_death:{}", queued.queue_id),
                outcome: "pending_poison_preempted_by_clear".to_string(),
                detail: crate::json_atom!({
                    "target": slot.slot_id,
                    "effect": "poisoned",
                    "cause": queued.cause,
                    "source": queued.source,
                    "source_action": queued.source_action,
                }),
            });
            events.push(InnerEvent::DelayedDeathResolved {
                queue_id: queued.queue_id.clone(),
                target: queued.target.clone(),
                cause: queued.cause.clone(),
                effect: queued.effect.clone(),
                outcome: "preempted_by_clear".to_string(),
                phase_id: input.phase_id.clone(),
            });
            continue;
        }
        trace_decisions.push(DecisionTrace {
            stage: "night:pending_effect".to_string(),
            source: format!("delayed_death:{}", queued.queue_id),
            outcome: "pending_poison_applied".to_string(),
            detail: crate::json_atom!({
                "target": slot.slot_id,
                "effect": "poisoned",
                "cause": queued.cause,
                "source": queued.source,
                "source_action": queued.source_action,
            }),
        });
        events.push(InnerEvent::DelayedDeathResolved {
            queue_id: queued.queue_id.clone(),
            target: queued.target.clone(),
            cause: queued.cause.clone(),
            effect: queued.effect.clone(),
            outcome: "applied".to_string(),
            phase_id: input.phase_id.clone(),
        });
        killed.push(slot.slot_id.clone());
        events.push(InnerEvent::PlayerKilled {
            slot_id: slot.slot_id.clone(),
            cause: queued.cause.clone(),
            attackers: Vec::new(),
            unstoppable: true,
            death_reveal: death_reveal_mode(input, &slot.slot_id, &queued.cause),
        });
    }
}

fn apply_backup_inheritance(
    input: &ResolutionInput,
    killed: &[SlotId],
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    if !input.pack.document().backup_policy.enabled {
        return;
    }
    let killed_roles: Vec<(SlotId, String)> = killed
        .iter()
        .filter_map(|slot_id| {
            input
                .state
                .slots
                .iter()
                .find(|slot| &slot.slot_id == slot_id)
                .map(|slot| (slot_id.clone(), slot.role_key.clone()))
        })
        .collect();
    let mut backup_targets = input.state.backup_targets.clone();
    for event in events.iter() {
        if let InnerEvent::BackupTargeted {
            backup,
            source_target,
            source_role,
            source_action,
            phase_id,
        } = event
        {
            backup_targets.retain(|record| record.backup != *backup);
            backup_targets.push(BackupTargetRecord {
                backup: backup.clone(),
                source_target: source_target.clone(),
                source_role: source_role.clone(),
                source_action: source_action.clone(),
                phase_id: phase_id.clone(),
            });
        }
    }

    for backup in input
        .state
        .slots
        .iter()
        .filter(|slot| slot.is_alive() && !killed.contains(&slot.slot_id))
    {
        let targeted = backup_targets
            .iter()
            .find(|record| record.backup == backup.slot_id)
            .and_then(|record| {
                killed_roles
                    .iter()
                    .find(|(source, _)| source == &record.source_target)
                    .map(|(source, killed_role)| {
                        (
                            source.clone(),
                            killed_role.clone(),
                            "targeted",
                            serde_json::json!({
                                "source_action": record.source_action,
                                "declared_source_role": record.source_role,
                                "target_phase_id": record.phase_id,
                            }),
                        )
                    })
            });
        let passive = backup.effects.iter().find_map(|effect| {
            let role = backup_role(&input.pack.document().backup_policy, effect)?;
            killed_roles
                .iter()
                .find(|(_, killed_role)| killed_role == role)
                .map(|(source, killed_role)| {
                    (
                        source.clone(),
                        killed_role.clone(),
                        "passive",
                        serde_json::json!({
                            "effect": effect,
                        }),
                    )
                })
        });
        let priority = input
            .pack
            .document()
            .backup_policy
            .priority
            .expect("validated enabled backup policy must declare priority");
        let candidate = match priority {
            BackupPriorityPolicy::TargetedThenPassive => targeted.or(passive),
            BackupPriorityPolicy::PassiveThenTargeted => passive.or(targeted),
        };
        let Some((source, inherited_role, policy, policy_detail)) = candidate else {
            continue;
        };
        if backup.role_key == inherited_role {
            continue;
        }
        let new_alignment = input
            .pack
            .document()
            .roles
            .get(&inherited_role)
            .and_then(|role| role.alignment.clone());
        trace_decisions.push(DecisionTrace {
            stage: "night:backup".to_string(),
            source: format!("slot:{source}"),
            outcome: "backup_inherited_role".to_string(),
            detail: crate::json_atom!({
                "backup": backup.slot_id,
                "source_target": source,
                "policy": policy,
                "policy_detail": policy_detail,
                "new_role": inherited_role,
                "new_alignment": new_alignment,
                "original_role": backup.role_key,
                "original_alignment": backup.alignment,
            }),
        });
        events.push(InnerEvent::PlayerConverted {
            target: backup.slot_id.clone(),
            new_role: inherited_role,
            new_alignment,
            original_role: backup.role_key.clone(),
            original_alignment: backup.alignment.clone(),
            source,
        });
    }
}

// ───────────────────────────── Night ─────────────────────────────

fn resolve_night(input: &ResolutionInput) -> InnerResolution {
    let pack: &Pack = input.pack.document();
    require_conversion_policy(pack);
    require_visibility_families(pack);
    require_ninja_visibility_policy(pack);
    require_night_resolution_kill_cause_catalog(pack);
    require_night_resolution_specialized_protect_action_policy(pack);
    require_night_resolution_team_kill_action_policy(pack);
    require_night_resolution_action_bucket_shapes(pack);
    require_night_resolution_intercept_cause_policy(pack);
    require_night_resolution_guard_retaliation_cause_policy(pack);
    require_night_resolution_cpr_harm_cause_policy(pack);
    require_night_resolution_guard_dependency_cause_policy(pack);
    require_night_resolution_block_action_policy(pack);
    require_night_resolution_protect_action_policy(pack);
    require_night_resolution_jailkeep_action_policy(pack);
    require_night_resolution_strongman_action_policy(pack);
    require_night_resolution_kill_action_policy(pack);
    require_night_resolution_chosen_retaliation_cause_policy(pack);
    require_night_resolution_protection_cause_policy(pack);
    require_night_resolution_action_chance_policy(pack);
    require_night_resolution_suppression_policy_shape(pack);
    require_night_resolution_generated_kill_ownership(pack);
    require_night_resolution_strongman_bypass_classifiers(pack);
    require_night_resolution_kill_cause_classifiers(pack);
    require_night_resolution_hide_dependency_cause_policy(pack);
    require_night_resolution_trigger_fixpoint_policy(pack);
    require_night_resolution_target_state_save_catalog(pack);
    require_night_resolution_target_state_save_policy(pack);
    require_night_resolution_target_state_gate_catalog(pack);
    require_night_resolution_target_state_gate_policy(pack);
    require_night_resolution_conflict_families(pack);
    require_night_resolution_kill_stacking_policy(pack);
    require_night_resolution_strongman_bypass_policy(pack);
    require_night_resolution_suppression_classifiers(pack);
    require_night_resolution_suppression_precedence(pack);

    let NightActionPreparationOutput {
        mut actions,
        prefix_events: mut events,
        mut trace_decisions,
        history,
    } = prepare_night_actions(NightActionPreparationInput { resolution: input });

    let mut trace_edges: Vec<TraceEdge> = Vec::new();
    // Determinism diagnostics (redirect/trigger loop-cap hits). Trace-bound; see below.
    let mut trace_notes: Vec<String> = Vec::new();

    let mut protections: BTreeMap<SlotId, Vec<ProtectionSource>> = BTreeMap::new();
    let mut cpr_saves: BTreeSet<String> = BTreeSet::new();
    let mut guard_dependencies: Vec<GuardDependency> = Vec::new();
    let mut hide_dependencies: Vec<HideDependency> = Vec::new();
    let mut transient_effects: BTreeMap<SlotId, BTreeSet<String>> = BTreeMap::new();
    let mut effect_marked_observations: Vec<TriggerObservation> = Vec::new();
    let mut cleared_effects: BTreeSet<(SlotId, String)> = BTreeSet::new();
    // Slots that got PlayerKilled this resolution, in event order — surfaced as
    // the trailing PhaseAnnouncement's deaths (doc 10). Each kill is also recorded
    // (target -> attacker) so triggers can react to it after core resolution.
    let mut killed: Vec<SlotId> = Vec::new();
    let mut kill_log: Vec<KillRecord> = Vec::new();
    let mut pending_wolf_carry_tokens = input.state.wolf_carry_tokens.clone();
    let mut empowered_slots: BTreeSet<SlotId> = BTreeSet::new();
    let mut action_chance_rng = DetRng::new(input.seed ^ 0x4e49_4748_545f_4348);

    let stage_order = input.pack.night_stage_order();
    trace_decisions.push(DecisionTrace {
        stage: "night:stage_order".to_string(),
        source: "pack.precedence".to_string(),
        outcome: "pack_derived_stage_order".to_string(),
        detail: crate::json_atom!({
            "order": stage_order
                .iter()
                .map(|stage| format!("{stage:?}"))
                .collect::<Vec<_>>(),
        }),
    });
    for &stage in stage_order {
        match stage {
            IrAbility::Block => {
                empowered_slots = resolve_suppression(SuppressionResolutionContext {
                    actions: &mut actions,
                    pack,
                    events: &mut events,
                    trace_decisions: &mut trace_decisions,
                });
            }
            IrAbility::Redirect => {
                // Redirect rewrites target maps before later target-reading stages.
                if empowered_slots.is_empty() {
                    let blocked_idxs = actions
                        .iter()
                        .enumerate()
                        .filter_map(|(idx, action)| action.blocked.then_some(idx))
                        .collect::<BTreeSet<_>>();
                    empowered_slots = discover_empowered_slots(EmpowerDiscoveryInput {
                        actions: &actions,
                        pack,
                        blocked_action_idxs: &blocked_idxs,
                    });
                }
                resolve_redirects(RedirectResolutionContext {
                    actions: &mut actions,
                    pack,
                    empowered_slots: &empowered_slots,
                    trace_edges: &mut trace_edges,
                    trace_decisions: &mut trace_decisions,
                    trace_notes: &mut trace_notes,
                });
            }
            IrAbility::Mark => {
                let mut wolf_beauty_marks = input.state.wolf_beauty_marks.clone();
                for idx in ability_order(&actions, IrAbility::Mark) {
                    if actions[idx].blocked {
                        continue;
                    }
                    let Some(effect) = actions[idx].template.effect.clone() else {
                        continue;
                    };
                    let actor = actions[idx].sub.actor.clone();
                    let hide_dependency_cause =
                        night_resolution_hide_dependency_cause(pack, actions[idx].template);
                    for target in actions[idx].targets.clone() {
                        let tags = target_tags(input, &transient_effects, &target);
                        if let Some(reason) = target_state_gate_reason(pack, &tags, IrAbility::Mark)
                        {
                            emit_action_interfered_by_target_state(
                                &mut trace_decisions,
                                &mut events,
                                ActionInterference {
                                    action: &actions[idx],
                                    target: &target,
                                    ability: IrAbility::Mark,
                                    mode: None,
                                    reason,
                                    target_tags: &tags,
                                },
                            );
                            continue;
                        }
                        if let Some(cause) = hide_dependency_cause.clone() {
                            hide_dependencies.push(HideDependency {
                                host: target.clone(),
                                hider: actor.clone(),
                                template_id: actions[idx].template.id.clone(),
                                cause,
                                source_action_id: actions[idx].sub.action_id.clone(),
                            });
                            if matches!(slot_alignment(input, &target), Some(alignment) if alignment != "mafia")
                            {
                                transient_effects
                                    .entry(actor.clone())
                                    .or_default()
                                    .insert("untargetable".to_string());
                            }
                        }
                        transient_effects
                            .entry(target.clone())
                            .or_default()
                            .insert(effect.clone());
                        emit_effect_notification(
                            input,
                            pack,
                            &mut events,
                            &effect,
                            "marked",
                            &actor,
                            &target,
                        );
                        let is_wolf_beauty_mark = input.pack.document().wolf_beauty.enabled
                            && effect == input.pack.document().wolf_beauty.mark_effect
                            && slot_role(input, &actor).is_some_and(|role| {
                                input
                                    .pack
                                    .document()
                                    .wolf_beauty
                                    .eligible_roles
                                    .iter()
                                    .any(|candidate| candidate == role)
                            });
                        if is_wolf_beauty_mark {
                            if let Some(previous) = wolf_beauty_marks
                                .iter()
                                .find(|record| record.beauty_id == actor)
                                .cloned()
                            {
                                if previous.target_id != target {
                                    events.push(InnerEvent::EffectsCleared {
                                        effect: effect.clone(),
                                        targets: vec![previous.target_id.clone()],
                                        actor: actor.clone(),
                                        source_action: None,
                                        phase_id: None,
                                    });
                                    cleared_effects
                                        .insert((previous.target_id.clone(), effect.clone()));
                                }
                            }
                        }
                        if effect_duration(pack, actions[idx].template, &effect)
                            != EffectDuration::Resolution
                        {
                            let marked_target = target.clone();
                            events.push(effects_marked(
                                input,
                                pack,
                                effect.clone(),
                                target.clone(),
                                actor.clone(),
                                actions[idx].sub.action_id.clone(),
                                effect_duration(pack, actions[idx].template, &effect),
                            ));
                            effect_marked_observations.push(effect_marked_observation(
                                target.clone(),
                                actor.clone(),
                                effect.clone(),
                                actions[idx].sub.action_id.clone(),
                            ));
                            if let Some(cause) = delayed_death_cause_for_effect(&effect) {
                                events.push(InnerEvent::DelayedDeathQueued {
                                    queue_id: delayed_death_queue_id(
                                        &effect,
                                        &target,
                                        &actions[idx].sub.action_id,
                                    ),
                                    target: target.clone(),
                                    cause: cause.to_string(),
                                    effect: effect.clone(),
                                    source: actor.clone(),
                                    source_action: actions[idx].sub.action_id.clone(),
                                    phase_id: input.phase_id.clone(),
                                });
                            }
                            if is_wolf_beauty_mark {
                                events.push(InnerEvent::WolfBeautyMarked {
                                    beauty_id: actor.clone(),
                                    target_id: marked_target.clone(),
                                    effect: effect.clone(),
                                    source_action: actions[idx].sub.action_id.clone(),
                                    phase_id: input.phase_id.clone(),
                                });
                                wolf_beauty_marks.retain(|record| record.beauty_id != actor);
                                wolf_beauty_marks.push(WolfBeautyMarkRecord {
                                    beauty_id: actor.clone(),
                                    target_id: marked_target,
                                    effect: effect.clone(),
                                    source_action: actions[idx].sub.action_id.clone(),
                                    phase_id: input.phase_id.clone(),
                                });
                            }
                            if input.pack.document().backup_policy.enabled
                                && effect == input.pack.document().backup_policy.targeted_effect
                            {
                                if let Some(source_slot) =
                                    input.state.slots.iter().find(|slot| slot.slot_id == target)
                                {
                                    events.push(InnerEvent::BackupTargeted {
                                        backup: actor.clone(),
                                        source_target: target.clone(),
                                        source_role: source_slot.role_key.clone(),
                                        source_action: actions[idx].sub.action_id.clone(),
                                        phase_id: input.phase_id.clone(),
                                    });
                                }
                            }
                        }
                        if let Some(actor_role) = slot_role(input, &actor) {
                            for policy in &input.pack.document().target_lynch_win_policies {
                                if effect == policy.target_effect
                                    && policy
                                        .eligible_roles
                                        .iter()
                                        .any(|candidate| candidate == actor_role)
                                {
                                    events.push(InnerEvent::TargetLynchWinTargeted {
                                        policy: policy.id.clone(),
                                        owner: actor.clone(),
                                        target: target.clone(),
                                        effect: effect.clone(),
                                        source_action: actions[idx].sub.action_id.clone(),
                                        phase_id: input.phase_id.clone(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
            IrAbility::Clear => {
                for idx in ability_order(&actions, IrAbility::Clear) {
                    if actions[idx].blocked {
                        continue;
                    }
                    let Some(effect) = actions[idx].template.effect.clone() else {
                        continue;
                    };
                    let actor = actions[idx].sub.actor.clone();
                    let targets = actions[idx].targets.clone();
                    if !targets.is_empty() {
                        for target in &targets {
                            emit_effect_notification(
                                input,
                                pack,
                                &mut events,
                                &effect,
                                "cleared",
                                &actor,
                                target,
                            );
                        }
                        events.push(InnerEvent::EffectsCleared {
                            effect: effect.clone(),
                            targets: targets.clone(),
                            actor,
                            source_action: None,
                            phase_id: None,
                        });
                        for target in targets {
                            cleared_effects.insert((target.clone(), effect.clone()));
                            if let Some(effects) = transient_effects.get_mut(&target) {
                                effects.remove(&effect);
                            }
                        }
                    }
                }
            }
            IrAbility::Grant => {
                for idx in ability_order(&actions, IrAbility::Grant) {
                    if actions[idx].blocked {
                        continue;
                    }
                    let Some((grant, grant_option)) =
                        selected_grant_for_submission(actions[idx].template, actions[idx].sub)
                    else {
                        continue;
                    };
                    let actor = actions[idx].sub.actor.clone();
                    for target in actions[idx].targets.clone() {
                        events.push(InnerEvent::ActionGranted {
                            grant_id: grant.grant_id.clone(),
                            grant_option: grant_option.clone(),
                            kind: grant.kind,
                            actor: actor.clone(),
                            target: target.clone(),
                            source_action: actions[idx].sub.action_id.clone(),
                            uses: grant.uses,
                            vote_weight: grant.vote_weight,
                            phase_id: input.phase_id.clone(),
                        });
                        emit_grant_notification(
                            input,
                            &mut events,
                            &grant.grant_id,
                            grant.visibility,
                            &actor,
                            &target,
                        );
                    }
                }
            }
            IrAbility::Link => {
                for idx in ability_order(&actions, IrAbility::Link) {
                    if actions[idx].blocked {
                        continue;
                    }
                    let mut slots = actions[idx].targets.clone();
                    slots.sort();
                    slots.dedup();
                    if slots.len() < 2 {
                        continue;
                    }
                    events.push(InnerEvent::PlayersLinked {
                        link_id: actions[idx].sub.action_id.clone(),
                        slots: slots.clone(),
                        source: actions[idx].sub.actor.clone(),
                    });
                    let policy = &input.pack.document().lover_policy;
                    if policy.enabled
                        && policy.lovers_known_to_each_other
                        && actions[idx].template.effect.as_deref() == Some(&policy.link_effect)
                    {
                        events.push(InnerEvent::EffectNotification {
                            effect: policy.link_effect.clone(),
                            status: actions[idx].sub.action_id.clone(),
                            audience: slots,
                            phase_id: None,
                        });
                    }
                }
            }
            IrAbility::Retaliate => {
                for idx in ability_order(&actions, IrAbility::Retaliate) {
                    if actions[idx].blocked {
                        continue;
                    }
                    let Some(target) = actions[idx].targets.first().cloned() else {
                        continue;
                    };
                    events.push(InnerEvent::RetaliationArmed {
                        retaliation_id: actions[idx].sub.action_id.clone(),
                        actor: actions[idx].sub.actor.clone(),
                        target,
                        source_action: actions[idx].template.id.clone(),
                    });
                }
            }
            IrAbility::Visit => {
                for idx in ability_order(&actions, IrAbility::Visit) {
                    if actions[idx].blocked {
                        continue;
                    }
                    let visible = visible_visit(&actions[idx], pack);
                    for target in actions[idx].targets.clone() {
                        events.push(InnerEvent::VisitRecorded {
                            actor: actions[idx].sub.actor.clone(),
                            target,
                            template_id: actions[idx].template.id.clone(),
                            source_action: actions[idx].sub.action_id.clone(),
                            phase_id: input.phase_id.clone(),
                            visible,
                        });
                    }
                }
            }
            IrAbility::Info => {
                for idx in ability_order(&actions, IrAbility::Info) {
                    if actions[idx].blocked {
                        continue;
                    }
                    let Some(info) = actions[idx].template.info.as_ref() else {
                        continue;
                    };
                    let actor = actions[idx].sub.actor.clone();
                    for target in actions[idx].targets.clone() {
                        let audience = info_audience(info.audience, &actor, &target);
                        let mut result = serde_json::Map::new();
                        result.insert(
                            "kind".to_string(),
                            serde_json::Value::String(info.kind.clone()),
                        );
                        result.insert(
                            "target".to_string(),
                            serde_json::Value::String(target.clone()),
                        );
                        result.insert(
                            "source_action".to_string(),
                            serde_json::Value::String(actions[idx].sub.action_id.clone()),
                        );
                        for (key, value) in &info.payload {
                            result.insert(key.clone(), value.clone());
                        }
                        events.push(InnerEvent::InfoResult {
                            actor: actor.clone(),
                            target,
                            kind: info.kind.clone(),
                            audience,
                            result: crate::json::JsonAtom::from(serde_json::Value::Object(result)),
                            source_action: actions[idx].sub.action_id.clone(),
                            template_id: actions[idx].template.id.clone(),
                            phase_id: input.phase_id.clone(),
                        });
                    }
                }
            }
            IrAbility::RevealTown => {
                // RevealTown is a public day-action primitive. Night handling is
                // intentionally empty; day semantics live in `resolve_day`.
            }
            IrAbility::VoteDuel => {
                // VoteDuel is a public day-action primitive that restricts the
                // following official vote. Night handling is intentionally empty.
            }
            IrAbility::Veto => {
                // Veto is a public day-action primitive that cancels a resolved
                // day elimination. Night handling is intentionally empty.
            }
            IrAbility::Badge => {
                // Badge is a day-action lifecycle primitive. The current night
                // resolver has no badge stage semantics; day handling lives in
                // `resolve_day` so sheriff actions run before official voting.
            }
            IrAbility::Duel => {
                // Duel is a rich day-action primitive. Night handling is
                // intentionally empty; day semantics live in `resolve_day`.
            }
            IrAbility::ItaShot => {
                // ITA sessions are rich day-action mechanics. Night handling is
                // intentionally empty; day semantics live in `resolve_day`.
            }
            IrAbility::SelfDestruct => {
                // Self-destruct is a rich day-action primitive. Night handling
                // is intentionally empty; day semantics live in `resolve_day`.
            }
            IrAbility::Protect => {
                for idx in ability_order(&actions, IrAbility::Protect) {
                    if actions[idx].blocked
                        || !night_resolution_protect_participates(pack, actions[idx].template)
                    {
                        continue;
                    }
                    let actor = actions[idx].sub.actor.clone();
                    let intercept_cause =
                        night_resolution_intercept_cause(pack, actions[idx].template);
                    let guard_retaliation_cause =
                        night_resolution_guard_retaliation_cause(pack, actions[idx].template);
                    let cpr_harm_cause =
                        night_resolution_cpr_harm_cause(pack, actions[idx].template);
                    let guard_dependency_cause =
                        night_resolution_guard_dependency_cause(pack, actions[idx].template);
                    for t in actions[idx].targets.clone() {
                        let tags = target_tags(input, &transient_effects, &t);
                        if let Some(reason) =
                            target_state_gate_reason(pack, &tags, IrAbility::Protect)
                        {
                            emit_action_interfered_by_target_state(
                                &mut trace_decisions,
                                &mut events,
                                ActionInterference {
                                    action: &actions[idx],
                                    target: &t,
                                    ability: IrAbility::Protect,
                                    mode: None,
                                    reason,
                                    target_tags: &tags,
                                },
                            );
                            continue;
                        }
                        if tags.contains("macho") {
                            continue;
                        }
                        if !action_chance_allows(
                            pack,
                            &actions[idx],
                            &t,
                            &mut action_chance_rng,
                            &mut trace_decisions,
                        ) {
                            continue;
                        }
                        protections
                            .entry(t.clone())
                            .or_default()
                            .push(ProtectionSource {
                                protector: actor.clone(),
                                action_id: actions[idx].sub.action_id.clone(),
                                template_id: actions[idx].template.id.clone(),
                                intercept_cause: intercept_cause.clone(),
                                guard_retaliation_cause: guard_retaliation_cause.clone(),
                                cpr_harm_cause: cpr_harm_cause.clone(),
                            });
                        if let Some(cause) = guard_dependency_cause.clone() {
                            guard_dependencies.push(GuardDependency {
                                guard: actor.clone(),
                                ward: t,
                                template_id: actions[idx].template.id.clone(),
                                cause,
                                source_action_id: actions[idx].sub.action_id.clone(),
                            });
                        }
                    }
                }
                apply_guard_witch_same_target_policy(ProtectionResolutionContext {
                    input,
                    protections: &protections,
                    killed: &mut killed,
                    log: &mut kill_log,
                    events: &mut events,
                    trace_decisions: &mut trace_decisions,
                });
            }
            IrAbility::Kill => {
                let strongman_bypasses_protect = protect_beats_kill_unless_strongman(pack);
                for idx in ability_order(&actions, IrAbility::Kill) {
                    if actions[idx].blocked {
                        continue;
                    }
                    if night_resolution_cpr_harm_cause(pack, actions[idx].template).is_some() {
                        continue;
                    }
                    if !night_resolution_kill_participates(pack, actions[idx].template) {
                        continue;
                    }
                    let cause = actions[idx].template.id.clone();
                    let attacker = actions[idx].sub.actor.clone();
                    let is_strongman =
                        night_resolution_strongman_bypasses(pack, actions[idx].template);
                    // An ignite-style Kill `reads_effect`: its targets are every
                    // alive slot carrying that persistent effect tag in the input state.
                    let mut targets: Vec<SlotId> = match &actions[idx].template.reads_effect {
                        Some(tag) => {
                            let mut targets = Vec::new();
                            for slot in &input.state.slots {
                                if !slot.is_alive() || !slot.effects.contains(tag) {
                                    continue;
                                }
                                if effect_was_cleared(&cleared_effects, &slot.slot_id, tag) {
                                    trace_decisions.push(DecisionTrace {
                                        stage: "night:read_effect".to_string(),
                                        source: format!("action:{}", actions[idx].sub.action_id),
                                        outcome: "read_effect_target_preempted_by_clear"
                                            .to_string(),
                                        detail: crate::json_atom!({
                                            "action_id": actions[idx].sub.action_id,
                                            "template_id": actions[idx].template.id,
                                            "actor": attacker,
                                            "target": slot.slot_id,
                                            "reads_effect": tag,
                                        }),
                                    });
                                    continue;
                                }
                                targets.push(slot.slot_id.clone());
                            }
                            targets
                        }
                        None => actions[idx].targets.clone(),
                    };
                    let mut carry_targets = Vec::new();
                    if actions[idx].template.reads_effect.is_none()
                        && input.pack.document().wolf_carry.enabled
                        && targets.len() > 1
                    {
                        let attacker_role = slot_role(input, &attacker);
                        let can_carry = attacker_role.is_some_and(|role| {
                            input
                                .pack
                                .document()
                                .wolf_carry
                                .wolf_kill_roles
                                .iter()
                                .any(|candidate| candidate == role)
                        });
                        if can_carry {
                            let primary = targets.first().cloned().into_iter().collect();
                            for target in targets.iter().skip(1).cloned() {
                                let Some(token_idx) =
                                    pending_wolf_carry_tokens.iter().position(|token| {
                                        input
                                            .pack
                                            .document()
                                            .wolf_carry
                                            .eligible_roles
                                            .iter()
                                            .any(|candidate| candidate == &token.role_key)
                                    })
                                else {
                                    events.push(InnerEvent::ActionInterfered {
                                        actor: attacker.clone(),
                                        reason: "wolf_carry_token_missing".to_string(),
                                    });
                                    continue;
                                };
                                let token = pending_wolf_carry_tokens.remove(token_idx);
                                carry_targets.push((token, target));
                            }
                            targets = primary;
                        }
                    }
                    for submitted_target in targets {
                        let (victim, _) = alignment_failback_victim(
                            input,
                            &actions[idx].sub.action_id,
                            actions[idx].template,
                            &attacker,
                            &submitted_target,
                            "night:kill_resolution",
                            &mut trace_decisions,
                        );
                        let target_tags = target_tags(input, &transient_effects, &victim);
                        if let Some(reason) =
                            target_state_gate_reason(pack, &target_tags, IrAbility::Kill)
                        {
                            trace_decisions.push(DecisionTrace {
                                stage: "kill_resolution".to_string(),
                                source: format!("cause:{cause}"),
                                outcome: "kill_skipped_by_target_state".to_string(),
                                detail: crate::json_atom!({
                                    "action_id": actions[idx].sub.action_id,
                                    "template_id": actions[idx].template.id,
                                    "actor": attacker,
                                    "target": victim,
                                    "reason": reason,
                                    "target_tags": target_tags,
                                }),
                            });
                            continue;
                        }
                        resolve_one_kill(
                            ActionResolutionContext {
                                input,
                                protections: &protections,
                                cpr_saves: &mut cpr_saves,
                                events: &mut events,
                                killed: &mut killed,
                                log: &mut kill_log,
                                trace_decisions: &mut trace_decisions,
                            },
                            KillAction {
                                target: &victim,
                                attacker: &attacker,
                                cause: &cause,
                                unstoppable: is_strongman && strongman_bypasses_protect,
                                death_reveal: death_reveal_mode(input, &victim, &cause),
                                target_tags: &target_tags,
                            },
                        );
                    }
                    for (carry_idx, (token, target)) in carry_targets.into_iter().enumerate() {
                        let source_action_id = format!(
                            "{}:wolf_carry:{}",
                            actions[idx].sub.action_id,
                            carry_idx + 1
                        );
                        let effect_id = format!("{}:{source_action_id}", token.token_id);
                        events.push(InnerEvent::WolfCarryUsed {
                            owner_id: token.owner_id.clone(),
                            target_id: target.clone(),
                            source_action_id: source_action_id.clone(),
                            effect_id,
                            role_key: token.role_key.clone(),
                            phase_id: input.phase_id.clone(),
                        });
                        let target_tags = target_tags(input, &transient_effects, &target);
                        if let Some(reason) =
                            target_state_gate_reason(pack, &target_tags, IrAbility::Kill)
                        {
                            trace_decisions.push(DecisionTrace {
                                stage: "kill_resolution".to_string(),
                                source: format!("cause:{}", input.pack.document().wolf_carry.cause),
                                outcome: "kill_skipped_by_target_state".to_string(),
                                detail: crate::json_atom!({
                                    "action_id": source_action_id,
                                    "template_id": input.pack.document().wolf_carry.cause,
                                    "actor": token.owner_id,
                                    "target": target,
                                    "reason": reason,
                                    "target_tags": target_tags,
                                }),
                            });
                            continue;
                        }
                        resolve_one_kill(
                            ActionResolutionContext {
                                input,
                                protections: &protections,
                                cpr_saves: &mut cpr_saves,
                                events: &mut events,
                                killed: &mut killed,
                                log: &mut kill_log,
                                trace_decisions: &mut trace_decisions,
                            },
                            KillAction {
                                target: &target,
                                attacker: &token.owner_id,
                                cause: &input.pack.document().wolf_carry.cause,
                                unstoppable: is_strongman && strongman_bypasses_protect,
                                death_reveal: death_reveal_mode(
                                    input,
                                    &target,
                                    &input.pack.document().wolf_carry.cause,
                                ),
                                target_tags: &target_tags,
                            },
                        );
                    }
                }
            }
            IrAbility::Convert => {
                for idx in ability_order(&actions, IrAbility::Convert) {
                    if actions[idx].blocked {
                        continue;
                    }
                    let source = actions[idx].sub.actor.clone();
                    for target in actions[idx].targets.clone() {
                        let Some(slot) = input.state.slots.iter().find(|s| s.slot_id == target)
                        else {
                            continue;
                        };
                        let action_id = actions[idx].sub.action_id.clone();
                        let template_id = actions[idx].template.id.clone();
                        let conversion_mode = actions[idx]
                            .template
                            .conversion
                            .as_ref()
                            .map(|conversion| conversion.mode)
                            .or_else(|| {
                                actions[idx]
                                    .template
                                    .effect
                                    .as_ref()
                                    .map(|_| ConversionMode::AssignRole)
                            });
                        let tags = target_tags(input, &transient_effects, &target);
                        if let Some(reason) =
                            target_state_gate_reason(pack, &tags, IrAbility::Convert)
                        {
                            trace_decisions.push(DecisionTrace {
                                stage: "night:conversion".to_string(),
                                source: format!("action:{action_id}"),
                                outcome: "conversion_blocked".to_string(),
                                detail: crate::json_atom!({
                                    "action_id": action_id,
                                    "template_id": template_id,
                                    "actor": source,
                                    "target": target,
                                    "target_role": slot.role_key,
                                    "target_alignment": slot.alignment,
                                    "mode": conversion_mode,
                                    "reason": reason,
                                    "target_tags": tags,
                                }),
                            });
                            events.push(InnerEvent::ConversionBlocked {
                                target: target.clone(),
                                status: "blocked".to_string(),
                                reason: reason.to_string(),
                            });
                            continue;
                        }
                        if killed.contains(&target) {
                            match pack.conversion_policy.on_dead_target {
                                Some(ConversionDeadTargetPolicy::Block) => {
                                    trace_decisions.push(DecisionTrace {
                                        stage: "night:conversion".to_string(),
                                        source: format!("action:{action_id}"),
                                        outcome: "conversion_blocked".to_string(),
                                        detail: crate::json_atom!({
                                            "action_id": action_id,
                                            "template_id": template_id,
                                            "actor": source.clone(),
                                            "target": target.clone(),
                                            "target_role": slot.role_key.clone(),
                                            "target_alignment": slot.alignment.clone(),
                                            "mode": conversion_mode,
                                            "reason": "dead_target",
                                        }),
                                    });
                                    events.push(InnerEvent::ConversionBlocked {
                                        target: target.clone(),
                                        status: "blocked".to_string(),
                                        reason: "dead_target".to_string(),
                                    });
                                }
                                None => panic!(
                                    "invalid conversion policy: packs with Convert actions must declare on_dead_target Block"
                                ),
                            }
                            continue;
                        }
                        if let Some(pending_death) =
                            active_pending_death(input, &cleared_effects, &target)
                        {
                            match pack.conversion_policy.on_pending_death {
                                Some(ConversionPendingDeathPolicy::Block) => {
                                    trace_decisions.push(DecisionTrace {
                                        stage: "night:conversion".to_string(),
                                        source: format!("action:{action_id}"),
                                        outcome: "conversion_blocked".to_string(),
                                        detail: crate::json_atom!({
                                            "action_id": action_id,
                                            "template_id": template_id,
                                            "actor": source.clone(),
                                            "target": target.clone(),
                                            "target_role": slot.role_key.clone(),
                                            "target_alignment": slot.alignment.clone(),
                                            "mode": conversion_mode,
                                            "reason": "pending_death",
                                            "queue_id": pending_death.queue_id.clone(),
                                            "cause": pending_death.cause.clone(),
                                            "effect": pending_death.effect.clone(),
                                            "source_action": pending_death.source_action.clone(),
                                        }),
                                    });
                                    events.push(InnerEvent::ConversionBlocked {
                                        target: target.clone(),
                                        status: "blocked".to_string(),
                                        reason: "pending_death".to_string(),
                                    });
                                }
                                None => panic!(
                                    "invalid conversion policy: packs with Convert actions must declare on_pending_death Block"
                                ),
                            }
                            continue;
                        }
                        if conversion_immune(input, &slot.role_key) {
                            trace_decisions.push(DecisionTrace {
                                stage: "night:conversion".to_string(),
                                source: format!("action:{action_id}"),
                                outcome: "conversion_blocked".to_string(),
                                detail: crate::json_atom!({
                                    "action_id": action_id,
                                    "template_id": template_id,
                                    "actor": source,
                                    "target": target,
                                    "target_role": slot.role_key,
                                    "target_alignment": slot.alignment,
                                    "mode": conversion_mode,
                                    "reason": "loyal",
                                }),
                            });
                            events.push(InnerEvent::ConversionBlocked {
                                target: target.clone(),
                                status: "blocked".to_string(),
                                reason: "loyal".to_string(),
                            });
                            continue;
                        }
                        let (new_role, new_alignment) =
                            match conversion_destination(input, &actions[idx], &target) {
                                Ok(destination) => destination,
                                Err(reason) => {
                                    trace_decisions.push(DecisionTrace {
                                        stage: "night:conversion".to_string(),
                                        source: format!("action:{action_id}"),
                                        outcome: "conversion_blocked".to_string(),
                                        detail: crate::json_atom!({
                                            "action_id": action_id,
                                            "template_id": template_id,
                                            "actor": source,
                                            "target": target,
                                            "target_role": slot.role_key,
                                            "target_alignment": slot.alignment,
                                            "mode": conversion_mode,
                                            "reason": reason,
                                        }),
                                    });
                                    events.push(InnerEvent::ConversionBlocked {
                                        target: target.clone(),
                                        status: "blocked".to_string(),
                                        reason: reason.to_string(),
                                    });
                                    continue;
                                }
                            };
                        let (outcome, origin_source) =
                            if matches!(conversion_mode, Some(ConversionMode::RestoreOriginal)) {
                                (
                                    "conversion_restored_original",
                                    input
                                        .state
                                        .conversion_origins
                                        .iter()
                                        .find(|origin| origin.target == target)
                                        .map(|origin| origin.source.clone()),
                                )
                            } else {
                                ("conversion_assigned_role", None)
                            };
                        trace_decisions.push(DecisionTrace {
                            stage: "night:conversion".to_string(),
                            source: format!("action:{action_id}"),
                            outcome: outcome.to_string(),
                            detail: crate::json_atom!({
                                "action_id": action_id,
                                "template_id": template_id,
                                "actor": source,
                                "target": target,
                                "mode": conversion_mode,
                                "new_role": new_role,
                                "new_alignment": new_alignment,
                                "original_role": slot.role_key,
                                "original_alignment": slot.alignment,
                                "origin_source": origin_source,
                            }),
                        });
                        events.push(InnerEvent::PlayerConverted {
                            target: target.clone(),
                            new_role: new_role.clone(),
                            new_alignment,
                            original_role: slot.role_key.clone(),
                            original_alignment: slot.alignment.clone(),
                            source: source.clone(),
                        });
                    }
                }
            }
            IrAbility::Investigate => {
                for idx in ability_order(&actions, IrAbility::Investigate) {
                    if actions[idx].blocked {
                        continue;
                    }
                    let Some(mode) = actions[idx].template.mode else {
                        continue;
                    };
                    let investigator = actions[idx].sub.actor.clone();
                    for target in actions[idx].targets.clone() {
                        let tags = target_tags(input, &transient_effects, &target);
                        if let Some(reason) =
                            target_state_gate_reason(pack, &tags, IrAbility::Investigate)
                        {
                            emit_action_interfered_by_target_state(
                                &mut trace_decisions,
                                &mut events,
                                ActionInterference {
                                    action: &actions[idx],
                                    target: &target,
                                    ability: IrAbility::Investigate,
                                    mode: Some(mode),
                                    reason,
                                    target_tags: &tags,
                                },
                            );
                            continue;
                        }
                        match mode {
                            InvestigateMode::Parity => {
                                let result =
                                    parity_result(input, &transient_effects, &target, mode);
                                let memory = actions[idx].template.result_memory.as_ref();
                                let visible_result = actions[idx]
                                    .template
                                    .constraints
                                    .uncooperative_result
                                    .as_ref()
                                    .filter(|_| {
                                        actions[idx].template.has_modifier(Modifier::Uncooperative)
                                    })
                                    .cloned()
                                    .unwrap_or_else(|| result.clone());
                                let output_result = if memory
                                    .map(|memory| memory.compare_previous)
                                    .unwrap_or(false)
                                {
                                    let previous = prior_investigation_result(
                                        input,
                                        &investigator,
                                        &target,
                                        mode,
                                        memory
                                            .map(|memory| memory.scope)
                                            .unwrap_or(ResultMemoryScope::Target),
                                    );
                                    let changed = previous.as_ref().is_some_and(|previous| {
                                        previous != &InvestigationResultBody::label(result.clone())
                                    });
                                    if memory.is_some_and(|memory| {
                                        memory.output == ResultMemoryOutput::SameDifferent
                                    }) {
                                        if previous.is_some() {
                                            InvestigationResultBody::label(if changed {
                                                "different"
                                            } else {
                                                "same"
                                            })
                                        } else {
                                            InvestigationResultBody::label(visible_result)
                                        }
                                    } else {
                                        InvestigationResultBody::fields(InvestigationResultFields {
                                            previous: previous
                                                .as_ref()
                                                .and_then(InvestigationResultBody::as_label)
                                                .map(str::to_string),
                                            current: Some(visible_result),
                                            changed: Some(changed),
                                            ..InvestigationResultFields::default()
                                        })
                                    }
                                } else {
                                    InvestigationResultBody::label(visible_result)
                                };
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: output_result,
                                });
                                if memory.map(|memory| memory.record).unwrap_or(false) {
                                    events.push(InnerEvent::InvestigationMemoryRecorded {
                                        investigator: investigator.clone(),
                                        target: target.clone(),
                                        mode,
                                        scope: memory
                                            .map(|memory| memory.scope)
                                            .unwrap_or(ResultMemoryScope::Target),
                                        result: InvestigationResultBody::label(result.clone()),
                                        source_action: actions[idx].sub.action_id.clone(),
                                        template_id: actions[idx].template.id.clone(),
                                        phase_id: input.phase_id.clone(),
                                    });
                                }
                                if actions[idx].template.has_modifier(Modifier::Weak)
                                    && result == "scum"
                                    && !killed.contains(&investigator)
                                {
                                    killed.push(investigator.clone());
                                    events.push(InnerEvent::PlayerKilled {
                                        slot_id: investigator.clone(),
                                        cause: "weak".to_string(),
                                        attackers: vec![target.clone()],
                                        unstoppable: true,
                                        death_reveal: death_reveal_mode(
                                            input,
                                            &investigator,
                                            "weak",
                                        ),
                                    });
                                    kill_log.push(KillRecord {
                                        target: investigator.clone(),
                                        attacker: target,
                                        cause: "weak".to_string(),
                                    });
                                }
                            }
                            InvestigateMode::Vanilla => {
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            vanilla: Some(role_set_contains(
                                                &input
                                                    .pack
                                                    .document()
                                                    .investigation_results
                                                    .role_sets
                                                    .vanilla_roles,
                                                input,
                                                &target,
                                            )),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::Neapolitan => {
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            vanilla_town: Some(
                                                role_set_contains(
                                                    &input
                                                        .pack
                                                        .document()
                                                        .investigation_results
                                                        .role_sets
                                                        .vanilla_roles,
                                                    input,
                                                    &target,
                                                ) && matches!(
                                                    slot_alignment(input, &target),
                                                    Some(alignment) if alignment == "town"
                                                ),
                                            ),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::Gunsmith => {
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            has_gun: Some(role_set_contains(
                                                &input
                                                    .pack
                                                    .document()
                                                    .investigation_results
                                                    .role_sets
                                                    .gun_bearing_roles,
                                                input,
                                                &target,
                                            )),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::Killer => {
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            killer: Some(role_set_contains(
                                                &input
                                                    .pack
                                                    .document()
                                                    .investigation_results
                                                    .role_sets
                                                    .killer_roles,
                                                input,
                                                &target,
                                            )),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::Specialist => {
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            specialist: Some(role_set_contains(
                                                &input
                                                    .pack
                                                    .document()
                                                    .investigation_results
                                                    .role_sets
                                                    .specialist_roles,
                                                input,
                                                &target,
                                            )),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::PtAccess => {
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            pt_access: Some(private_topic_access(input, &target)),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::Role => {
                                let role = slot_role(input, &target).unwrap_or("");
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            role: Some(role.to_string()),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::FullRole => {
                                let role = slot_role(input, &target).unwrap_or("");
                                let alignment = slot_alignment(input, &target).unwrap_or("");
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            role: Some(role.to_string()),
                                            alignment: Some(alignment.to_string()),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::Track => {
                                let visited = tracked_visits(&actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: InvestigationResultBody::track(visited),
                                });
                            }
                            InvestigateMode::Watch => {
                                let visitors = watched_visitors(&actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            visitors: Some(visitors),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::RoleWatcher => {
                                let visitor_roles =
                                    watched_visitor_roles(input, &actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            visitor_roles: Some(visitor_roles),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::RoleGuard => {
                                let visitor_roles =
                                    watched_visitor_roles(input, &actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            visitor_roles: Some(visitor_roles),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::SecurityGuard => {
                                let visitors = watched_visitors(&actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            visitors: Some(visitors),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::Voyeur => {
                                let actions_seen = watched_action_ids(&actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            actions: Some(actions_seen),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::ActionType => {
                                let action_types =
                                    followed_action_types(&actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            action_types: Some(action_types),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::Motion => {
                                let active = detected_motion(&actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            motion: Some(active),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                            InvestigateMode::PriorMotion => {
                                let active = prior_detected_motion(input, &target);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: InvestigationResultBody::fields(
                                        InvestigationResultFields {
                                            prior_motion: Some(active),
                                            ..InvestigationResultFields::default()
                                        },
                                    ),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    apply_pending_poison(
        input,
        &cleared_effects,
        &mut events,
        &mut killed,
        &mut trace_decisions,
    );
    apply_chosen_retaliations(
        input,
        &protections,
        &mut killed,
        &mut kill_log,
        &mut cpr_saves,
        &mut events,
        &mut trace_decisions,
    );
    apply_guard_dependency_deaths(
        input,
        &guard_dependencies,
        &mut killed,
        &mut kill_log,
        &mut events,
        &mut trace_decisions,
    );
    apply_hide_dependency_deaths(
        input,
        &hide_dependencies,
        &mut killed,
        &mut kill_log,
        &mut events,
        &mut trace_decisions,
    );
    apply_wolf_beauty_drag_triggers(
        input,
        &mut killed,
        &mut kill_log,
        &mut events,
        &mut trace_decisions,
    );

    // ── Phase 8: Triggers ── reactive abilities (doc 09). Observation order is
    // fixed by the collector; generated kills re-enter through the bounded
    // fixpoint, with night-only guard/hide dependency cascades between rounds.
    let trigger_frontier = collect_night_observations(
        input,
        &actions,
        &kill_log,
        effect_marked_observations,
        &killed,
    );
    let _generated_kills = apply_trigger_fixpoint(
        TriggerResolutionContext {
            input,
            protections: &protections,
            transient_effects: &transient_effects,
            killed: &mut killed,
            cpr_saves: &mut cpr_saves,
            events: &mut events,
            trace_decisions: &mut trace_decisions,
            trace_notes: &mut trace_notes,
            produced_kill_collection: ProducedKillCollection::FrontierOnly,
            cascade: Some(TriggerCascadeContext {
                guard_dependencies: &guard_dependencies,
                hide_dependencies: &hide_dependencies,
                kill_log: &mut kill_log,
            }),
        },
        trigger_frontier,
    );

    apply_cpr_harms(
        input,
        &protections,
        &cpr_saves,
        &mut killed,
        &mut kill_log,
        &mut events,
        &mut trace_decisions,
    );

    apply_lover_suicides(
        input,
        &mut killed,
        &mut kill_log,
        &mut events,
        &mut trace_decisions,
    );

    apply_backup_inheritance(input, &killed, &mut events, &mut trace_decisions);

    apply_effect_source_death_reveals(input, &killed, &mut events, &mut trace_decisions);

    events.extend(history.events(input, &actions));

    resolve_beloved_princess_prompts(input, &mut events, &mut trace_decisions);

    // ── Trailing PhaseAnnouncement ── every resolution ends with exactly one
    // PhaseAnnouncement listing the deaths it produced (empty if none); it is the
    // single canonical death-reveal signal (doc 10).
    let deaths = deaths_from_events(&events);
    // Trace diagnostics are not inner events because the game-result event stream
    // is a closed domain contract.
    events.push(InnerEvent::PhaseAnnouncement(phase_announcement(
        input, deaths,
    )));

    InnerResolution {
        events,
        trace_edges,
        trace_decisions,
        trace_notes,
    }
}

/// Compute the slots a tracked slot visited this night: the (post-redirect)
/// targets of that slot's own actions, excluding Ninja-hidden actions per the
/// visibility rule. Stable, de-duplicated ordering.
fn tracked_visits(
    actions: &[Action],
    observer_idx: usize,
    tracked: &SlotId,
    pack: &Pack,
) -> Vec<SlotId> {
    let mut visited: Vec<SlotId> = Vec::new();
    for (idx, action) in actions.iter().enumerate() {
        if idx == observer_idx || &action.sub.actor != tracked || !visible_visit(action, pack) {
            continue;
        }
        for t in &action.targets {
            if !visited.contains(t) {
                visited.push(t.clone());
            }
        }
    }
    visited
}

/// Compute who visited a watched slot: actors whose resolved, visible target
/// lists contain the watched slot. Stable, de-duplicated by first visit.
fn watched_visitors(
    actions: &[Action],
    observer_idx: usize,
    watched: &SlotId,
    pack: &Pack,
) -> Vec<SlotId> {
    let mut visitors: Vec<SlotId> = Vec::new();
    for (idx, action) in actions.iter().enumerate() {
        if idx == observer_idx || !visible_visit(action, pack) || !action.targets.contains(watched)
        {
            continue;
        }
        if !visitors.contains(&action.sub.actor) {
            visitors.push(action.sub.actor.clone());
        }
    }
    visitors
}

/// Compute the unique role keys of visible visitors to a watched slot. This is
/// deliberately role-level rather than actor-level so Role Watcher/Role Guard
/// results do not leak identity or duplicate-count information.
fn watched_visitor_roles(
    input: &ResolutionInput,
    actions: &[Action],
    observer_idx: usize,
    watched: &SlotId,
    pack: &Pack,
) -> Vec<String> {
    let mut roles: Vec<String> = Vec::new();
    for visitor in watched_visitors(actions, observer_idx, watched, pack) {
        let Some(role) = slot_role(input, &visitor) else {
            continue;
        };
        if !roles.iter().any(|existing| existing == role) {
            roles.push(role.to_string());
        }
    }
    roles
}

/// Compute the unique visible action ids aimed at a watched slot. Voyeur
/// results reveal action categories without actor identity or duplicate counts.
fn watched_action_ids(
    actions: &[Action],
    observer_idx: usize,
    watched: &SlotId,
    pack: &Pack,
) -> Vec<String> {
    let mut action_ids: Vec<String> = Vec::new();
    for (idx, action) in actions.iter().enumerate() {
        if idx == observer_idx || !visible_visit(action, pack) || !action.targets.contains(watched)
        {
            continue;
        }
        if !action_ids
            .iter()
            .any(|existing| existing == &action.template.id)
        {
            action_ids.push(action.template.id.clone());
        }
    }
    action_ids
}

/// Follower-style result: the visible action categories performed by the
/// followed actor, without revealing targets or duplicate-count information.
fn followed_action_types(
    actions: &[Action],
    observer_idx: usize,
    followed: &SlotId,
    pack: &Pack,
) -> Vec<String> {
    let mut action_types: Vec<String> = Vec::new();
    for (idx, action) in actions.iter().enumerate() {
        if idx == observer_idx || &action.sub.actor != followed || !visible_visit(action, pack) {
            continue;
        }
        let action_type = action_type_category(action.template);
        if !action_types.iter().any(|existing| existing == action_type) {
            action_types.push(action_type.to_string());
        }
    }
    action_types.sort();
    action_types
}

fn action_type_category(template: &ActionTemplate) -> &'static str {
    if template.has_ability(IrAbility::Kill) {
        "killing"
    } else if template.has_ability(IrAbility::Protect) {
        "protection"
    } else if template.has_ability(IrAbility::Investigate) {
        "investigation"
    } else if template.has_ability(IrAbility::Block)
        || template.has_ability(IrAbility::Redirect)
        || template.has_ability(IrAbility::Mark)
        || template.has_ability(IrAbility::Clear)
        || template.has_ability(IrAbility::Convert)
    {
        "manipulation"
    } else {
        "utility"
    }
}

/// Motion detector result: true iff the target either made a visible visit or
/// received a visible visit. The observer's own info action is excluded, or
/// every motion check would trivially make its target active.
fn detected_motion(actions: &[Action], observer_idx: usize, target: &SlotId, pack: &Pack) -> bool {
    !tracked_visits(actions, observer_idx, target, pack).is_empty()
        || !watched_visitors(actions, observer_idx, target, pack).is_empty()
}

fn prior_detected_motion(input: &ResolutionInput, target: &SlotId) -> bool {
    input
        .state
        .visit_history
        .iter()
        .any(|visit| visit.visible && (&visit.actor == target || &visit.target == target))
}

fn visible_visit(action: &Action, pack: &Pack) -> bool {
    if action.blocked {
        return false;
    }
    if matches!(
        action.template.mode,
        Some(
            InvestigateMode::Watch
                | InvestigateMode::RoleWatcher
                | InvestigateMode::RoleGuard
                | InvestigateMode::SecurityGuard
                | InvestigateMode::Voyeur
                | InvestigateMode::ActionType
        )
    ) {
        return false;
    }
    let ninja_hides = pack
        .visibility
        .get(&IrAbility::Investigate)
        .map(|v| v.unless_modifiers.contains(&Modifier::Ninja))
        .unwrap_or(false);
    !(ninja_hides && action.template.has_modifier(Modifier::Ninja))
}

/// Parity investigation result: a slot's alignment-derived "town"/"scum",
/// after applying `investigation_overrides` (e.g. the godfather effect flips a
/// Parity read to "town").
fn parity_result(
    input: &ResolutionInput,
    transient_effects: &BTreeMap<SlotId, BTreeSet<String>>,
    target: &SlotId,
    mode: InvestigateMode,
) -> String {
    let slot = input.state.slots.iter().find(|s| &s.slot_id == target);
    let base = match slot.and_then(|s| s.alignment.as_deref()) {
        Some(alignment) => input
            .pack
            .document()
            .investigation_results
            .parity
            .alignment_results
            .get(alignment)
            .cloned()
            .unwrap_or_else(|| {
                if alignment == "town" {
                    input
                        .pack
                        .document()
                        .investigation_results
                        .parity
                        .town
                        .clone()
                } else {
                    input
                        .pack
                        .document()
                        .investigation_results
                        .parity
                        .non_town
                        .clone()
                }
            }),
        None => input
            .pack
            .document()
            .investigation_results
            .parity
            .non_town
            .clone(),
    };

    if let (Some(slot), Some(overrides)) =
        (slot, input.pack.document().investigation_overrides.as_ref())
    {
        let tags = slot.effects.iter().chain(
            transient_effects
                .get(target)
                .into_iter()
                .flat_map(|effects| effects.iter()),
        );
        for tag in tags {
            if let Some(ro) = overrides.get(tag) {
                if let Some(value) = ro.by_mode.get(&mode) {
                    return value.clone();
                }
            }
        }
    }
    base
}

fn role_set_contains(role_set: &[String], input: &ResolutionInput, target: &SlotId) -> bool {
    slot_role(input, target).is_some_and(|role| role_set.iter().any(|candidate| candidate == role))
}

fn private_topic_access(input: &ResolutionInput, target: &SlotId) -> Vec<String> {
    // A Role PM is the universal per-slot control channel, not social access
    // granted by a role or faction. Including it would make PT-access checks
    // positive for every occupied slot and erase the mechanic's distinction.
    input
        .state
        .private_channels
        .iter()
        .filter(|record| &record.slot_id == target && record.kind != "RolePm")
        .map(|record| record.channel_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn delayed_death_cause_for_effect(effect: &str) -> Option<&'static str> {
    match effect {
        "poisoned" => Some("poison"),
        _ => None,
    }
}

fn delayed_death_queue_id(effect: &str, target: &SlotId, source_action: &str) -> String {
    format!("{effect}:{target}:{source_action}")
}

fn prior_investigation_result(
    input: &ResolutionInput,
    investigator: &SlotId,
    target: &SlotId,
    mode: InvestigateMode,
    scope: ResultMemoryScope,
) -> Option<InvestigationResultBody> {
    input
        .state
        .investigation_memory
        .iter()
        .find(|record| {
            record.investigator == *investigator
                && record.mode == mode
                && (scope == ResultMemoryScope::Investigator || record.target == *target)
        })
        .map(|record| record.result.clone())
}

/// Whether a Strongman kill removes Protect from its blockers at evaluation time.
fn protect_beats_kill_unless_strongman(pack: &Pack) -> bool {
    if pack.night_resolution.is_explicit() {
        return pack.night_resolution.strongman_bypasses_protect;
    }
    pack.precedence.iter().any(|rule| {
        rule.when.effect == IrAbility::Protect
            && rule.beats.contains(&IrAbility::Kill)
            && rule.unless_modifiers.contains(&Modifier::Strongman)
    })
}

fn night_resolution_protect_participates(pack: &Pack, template: &ActionTemplate) -> bool {
    if !pack.night_resolution.is_explicit() {
        return true;
    }
    pack.night_resolution
        .protect_action_ids
        .iter()
        .chain(pack.night_resolution.bodyguard_action_ids.iter())
        .chain(pack.night_resolution.martyr_action_ids.iter())
        .chain(pack.night_resolution.cpr_action_ids.iter())
        .chain(pack.night_resolution.jailkeep_action_ids.iter())
        .any(|action_id| action_id == &template.id)
}

fn action_chance_allows(
    pack: &Pack,
    action: &Action<'_>,
    target: &SlotId,
    rng: &mut DetRng,
    trace_decisions: &mut Vec<DecisionTrace>,
) -> bool {
    let Some(policy) = pack.night_resolution.action_chance.get(&action.template.id) else {
        return true;
    };
    let roll = rng.next_f64();
    let allowed = roll <= policy.chance;
    trace_decisions.push(DecisionTrace {
        stage: "night:action_chance".to_string(),
        source: format!("action:{}", action.sub.action_id),
        outcome: if allowed {
            "action_chance_succeeded"
        } else {
            "action_chance_failed"
        }
        .to_string(),
        detail: crate::json_atom!({
            "action_id": action.sub.action_id,
            "template_id": action.template.id,
            "actor": action.sub.actor,
            "target": target,
            "chance": policy.chance,
            "roll": roll,
        }),
    });
    allowed
}

fn require_night_resolution_action_chance_policy(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    for (action_id, policy) in &pack.night_resolution.action_chance {
        if action_id.trim().is_empty() {
            panic!("invalid night_resolution action chance policy: action id must not be empty");
        }
        if !policy.chance.is_finite() || !(0.0..=1.0).contains(&policy.chance) {
            panic!(
                "invalid night_resolution action chance policy: action `{action_id}` chance must be finite and between 0.0 and 1.0"
            );
        }
        if !pack
            .roles
            .values()
            .flat_map(|role| role.actions.iter())
            .chain(pack.item_actions.values())
            .any(|action| action.window.is_night_resolution_window() && action.id == *action_id)
        {
            panic!(
                "invalid night_resolution action chance policy: unknown night/any action `{action_id}`"
            );
        }
    }
}

fn require_night_resolution_conflict_families(pack: &Pack) {
    if !pack.night_resolution.is_explicit() {
        return;
    }
    let declared = pack
        .night_resolution
        .conflict_families
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    if declared.len() != pack.night_resolution.conflict_families.len() {
        panic!(
            "invalid night_resolution conflict families: conflict_families must not contain duplicates"
        );
    }
    if declared.is_empty() {
        panic!(
            "invalid night_resolution conflict families: explicit night_resolution policy must declare conflict_families"
        );
    }
    let required = night_resolution_required_conflict_families(pack);
    for family in &required {
        if !declared.contains(family) {
            panic!(
                "invalid night_resolution conflict families: conflict_families must include `{family:?}`"
            );
        }
    }
    for family in &declared {
        if !required.contains(family) {
            panic!(
                "invalid night_resolution conflict families: declared conflict family `{family:?}` has no matching policy surface"
            );
        }
    }
}

fn night_resolution_required_conflict_families(
    pack: &Pack,
) -> BTreeSet<NightResolutionConflictFamily> {
    let policy = &pack.night_resolution;
    let mut required = BTreeSet::from([
        NightResolutionConflictFamily::BlockSuppressesActions,
        NightResolutionConflictFamily::ProtectBlocksKills,
        NightResolutionConflictFamily::StrongmanBypassesProtect,
        NightResolutionConflictFamily::KillStacking,
    ]);
    if !policy.intercept_cause_policy.is_empty()
        || !policy.bodyguard_action_ids.is_empty()
        || !policy.martyr_action_ids.is_empty()
    {
        required.insert(NightResolutionConflictFamily::InterceptProtection);
    }
    if !policy.guard_retaliation_cause_policy.is_empty() {
        required.insert(NightResolutionConflictFamily::GuardRetaliation);
    }
    if !policy.cpr_action_ids.is_empty() || !policy.cpr_harm_cause_policy.is_empty() {
        required.insert(NightResolutionConflictFamily::CprProtection);
    }
    if !policy.guard_dependency_cause_policy.is_empty() {
        required.insert(NightResolutionConflictFamily::GuardDependency);
    }
    if !policy.hide_dependency_cause_policy.is_empty() {
        required.insert(NightResolutionConflictFamily::HideDependency);
    }
    if !policy.chosen_retaliation_cause_policy.is_empty() {
        required.insert(NightResolutionConflictFamily::ChosenRetaliation);
    }
    if !policy.generated_kill_cause_policy.is_empty() || !policy.trigger_fixpoint_policy.is_empty()
    {
        required.insert(NightResolutionConflictFamily::GeneratedKillReentry);
    }
    if !night_resolution_target_state_save_tags(pack).is_empty() {
        required.insert(NightResolutionConflictFamily::TargetStateSave);
    }
    if !night_resolution_target_state_gate_tags(pack).is_empty() {
        required.insert(NightResolutionConflictFamily::TargetStateGate);
    }
    if !policy.action_chance.is_empty() {
        required.insert(NightResolutionConflictFamily::ActionChance);
    }
    required
}

fn night_resolution_cpr_harm_cause(pack: &Pack, template: &ActionTemplate) -> Option<String> {
    if pack.night_resolution.is_explicit() {
        return pack
            .night_resolution
            .cpr_harm_cause_policy
            .get(&template.id)
            .cloned();
    }
    if template.has_modifier(Modifier::Cpr) {
        return Some(template.id.clone());
    }
    None
}

fn night_resolution_guard_dependency_cause(
    pack: &Pack,
    template: &ActionTemplate,
) -> Option<String> {
    if pack.night_resolution.is_explicit() {
        return pack
            .night_resolution
            .guard_dependency_cause_policy
            .get(&template.id)
            .cloned();
    }
    if template.has_modifier(Modifier::Babysitter) {
        return Some(template.id.clone());
    }
    None
}

fn night_resolution_hide_dependency_cause(
    pack: &Pack,
    template: &ActionTemplate,
) -> Option<String> {
    if pack.night_resolution.is_explicit() {
        return pack
            .night_resolution
            .hide_dependency_cause_policy
            .get(&template.id)
            .cloned();
    }
    if template.has_modifier(Modifier::Hider) {
        return Some(template.id.clone());
    }
    None
}

fn night_resolution_intercept_cause(pack: &Pack, template: &ActionTemplate) -> Option<String> {
    if pack.night_resolution.is_explicit() {
        return pack
            .night_resolution
            .intercept_cause_policy
            .get(&template.id)
            .cloned();
    }
    if template.has_modifier(Modifier::Bodyguard) {
        return Some("bodyguard_intercept".to_string());
    }
    if template.has_modifier(Modifier::Martyr) {
        return Some("martyr_intercept".to_string());
    }
    None
}

fn night_resolution_guard_retaliation_cause(
    pack: &Pack,
    template: &ActionTemplate,
) -> Option<String> {
    if pack.night_resolution.is_explicit() {
        return pack
            .night_resolution
            .guard_retaliation_cause_policy
            .get(&template.id)
            .cloned();
    }
    None
}

fn night_resolution_strongman_bypasses(pack: &Pack, template: &ActionTemplate) -> bool {
    if pack.night_resolution.is_explicit() {
        return pack
            .night_resolution
            .strongman_action_ids
            .iter()
            .any(|action_id| action_id == &template.id);
    }
    template.has_modifier(Modifier::Strongman)
}

fn night_resolution_kill_participates(pack: &Pack, template: &ActionTemplate) -> bool {
    if !pack.night_resolution.is_explicit() {
        return true;
    }
    pack.night_resolution
        .kill_action_ids
        .iter()
        .chain(pack.night_resolution.strongman_action_ids.iter())
        .any(|action_id| action_id == &template.id)
}

fn night_resolution_chosen_retaliation_bypasses_protect(pack: &Pack, source_action: &str) -> bool {
    if pack.night_resolution.is_explicit() {
        return pack
            .night_resolution
            .chosen_retaliation_cause_policy
            .get(source_action)
            .map(|policy| policy.strongman_bypasses_protect)
            .unwrap_or_else(|| {
                panic!(
                    "invalid night_resolution chosen retaliation cause policy: Retaliate action `{source_action}` must declare chosen retaliation cause policy"
                )
            });
    }
    false
}

fn night_resolution_generated_kill_bypasses_protect(pack: &Pack, trigger: &TriggerRule) -> bool {
    if pack.night_resolution.is_explicit() {
        return pack
            .night_resolution
            .generated_kill_cause_policy
            .get(&trigger.id)
            .map(|policy| policy.strongman_bypasses_protect)
            .unwrap_or_else(|| {
                panic!(
                    "invalid night_resolution generated kill cause policy: generated kill trigger `{}` must declare generated kill cause policy",
                    trigger.id
                )
            });
    }
    trigger.produces.modifiers.contains(&Modifier::Strongman)
}

fn night_resolution_trigger_participates_in_fixpoint(pack: &Pack, trigger: &TriggerRule) -> bool {
    if trigger.produces.ability != IrAbility::Kill {
        return true;
    }
    if pack.night_resolution.is_explicit() {
        return pack
            .night_resolution
            .trigger_fixpoint_policy
            .get(&trigger.id)
            .map(|policy| policy.produced_kill_reenters)
            .unwrap_or_else(|| {
                panic!(
                    "invalid night_resolution trigger fixpoint policy: generated kill trigger `{}` must declare trigger fixpoint policy",
                    trigger.id
                )
            });
    }
    true
}

fn info_audience(
    audience: crate::pack::InfoAudience,
    actor: &SlotId,
    target: &SlotId,
) -> Vec<SlotId> {
    match audience {
        crate::pack::InfoAudience::Actor => vec![actor.clone()],
        crate::pack::InfoAudience::Target => vec![target.clone()],
        crate::pack::InfoAudience::ActorAndTarget => {
            if actor == target {
                vec![actor.clone()]
            } else {
                vec![actor.clone(), target.clone()]
            }
        }
    }
}

/// Look up a submitted action template. Role-owned actions are always looked up
/// from the actor's current role. Generated item actions additionally require a
/// matching unspent item grant plus `metadata.grant_id`, so a direct resolver
/// caller cannot use an item without spending its durable grant.
fn lookup_submission_template<'a>(
    input: &'a ResolutionInput,
    sub: &Submission,
) -> Option<&'a ActionTemplate> {
    lookup_template(input, &sub.actor, &sub.template_id)
        .or_else(|| lookup_item_template(input, sub))
}

/// Look up an actor's role-owned action template by `template_id`.
fn lookup_template<'a>(
    input: &'a ResolutionInput,
    actor: &SlotId,
    template_id: &str,
) -> Option<&'a ActionTemplate> {
    let slot = input.state.slots.iter().find(|s| &s.slot_id == actor)?;
    let role = input.pack.document().roles.get(&slot.role_key)?;
    role.actions.iter().find(|t| t.id == template_id)
}

fn lookup_item_template<'a>(
    input: &'a ResolutionInput,
    sub: &Submission,
) -> Option<&'a ActionTemplate> {
    let grant_id = sub.metadata.get("grant_id")?.as_str()?;
    if inventory_counter_exhausted(input, &sub.actor, grant_id) {
        return None;
    }
    let grant = input.state.action_grants.iter().find(|grant| {
        grant.target == sub.actor
            && grant.grant_id == grant_id
            && grant.kind == GrantKind::Item
            && grant.uses > 0
    })?;
    let template = input.pack.document().item_actions.get(&grant.grant_id)?;
    (template.id == sub.template_id).then_some(template)
}

fn selected_grant_for_submission(
    template: &ActionTemplate,
    sub: &Submission,
) -> Option<(GrantSpec, Option<String>)> {
    if template.grant_options.is_empty() {
        return template.grant.clone().map(|grant| (grant, None));
    }
    let grant_id = sub.metadata.get("grant_id")?.as_str()?;
    template
        .grant_options
        .iter()
        .find(|grant| grant.grant_id == grant_id)
        .cloned()
        .map(|grant| (grant, Some(grant_id.to_string())))
}

fn submission_item_grant_id(input: &ResolutionInput, sub: &Submission) -> Option<String> {
    let grant_id = sub.metadata.get("grant_id")?.as_str()?;
    let template = input.pack.document().item_actions.get(grant_id)?;
    (template.id == sub.template_id).then_some(grant_id.to_string())
}

fn submission_consumed_grant_id(input: &ResolutionInput, sub: &Submission) -> Option<String> {
    let grant_id = sub.metadata.get("grant_id")?.as_str()?;
    if let Some(template) = lookup_template(input, &sub.actor, &sub.template_id) {
        if template.has_ability(IrAbility::Grant)
            && selected_grant_for_submission(template, sub).is_some()
        {
            return None;
        }
    }
    if let Some(item_grant_id) = submission_item_grant_id(input, sub) {
        return Some(item_grant_id);
    }
    let has_extra_action_grant = input.state.action_grants.iter().any(|grant| {
        grant.target == sub.actor
            && grant.grant_id == grant_id
            && grant.kind == GrantKind::ExtraAction
            && grant.uses > 0
    });
    has_extra_action_grant.then(|| grant_id.to_string())
}

fn submission_has_exhausted_item_grant(input: &ResolutionInput, sub: &Submission) -> bool {
    let Some(grant_id) = submission_item_grant_id(input, sub) else {
        return false;
    };
    input.state.action_grants.iter().any(|grant| {
        grant.target == sub.actor
            && grant.grant_id == grant_id
            && grant.kind == GrantKind::Item
            && grant.uses > 0
    }) && inventory_counter_exhausted(input, &sub.actor, &grant_id)
}

// ───────────────────────────── Day ─────────────────────────────

fn resolve_twilight(input: &ResolutionInput) -> InnerResolution {
    let mut events = Vec::new();
    let mut trace_decisions = Vec::new();
    resolve_self_destruct_actions(input, &mut events);
    resolve_beloved_princess_prompts(input, &mut events, &mut trace_decisions);
    let deaths = deaths_from_events(&events);
    events.push(InnerEvent::PhaseAnnouncement(phase_announcement(
        input, deaths,
    )));
    InnerResolution {
        events,
        trace_edges: Vec::new(),
        trace_decisions,
        trace_notes: Vec::new(),
    }
}

fn resolve_day(input: &ResolutionInput) -> InnerResolution {
    let pack: &Pack = input.pack.document();
    require_visibility_families(pack);
    require_win_families(pack);
    let mut events = Vec::new();
    let mut trace_decisions = Vec::new();
    let mut trace_notes = Vec::new();
    resolve_day_announcements(input, &mut events);
    resolve_reveal_town_actions(input, &mut events);
    let badges = resolve_badge_actions(input, &mut events);
    resolve_self_destruct_actions(input, &mut events);
    resolve_day_kill_actions(input, &mut events, &mut trace_decisions);
    require_ita_vote_conflict_policy(pack);
    resolve_ita_actions(input, &mut events, &mut trace_decisions);
    resolve_duel_actions(input, &mut events, &mut trace_decisions, &mut trace_notes);
    resolve_day_vote(DayVoteResolutionContext {
        input,
        badges: &badges,
        events: &mut events,
        trace_decisions: &mut trace_decisions,
        trace_notes: &mut trace_notes,
    });
    InnerResolution {
        events,
        trace_edges: Vec::new(),
        trace_decisions,
        trace_notes,
    }
}

fn resolve_reveal_town_actions(input: &ResolutionInput, events: &mut Vec<InnerEvent>) {
    if input.state.phase_id.kind() != PhaseKind::Day {
        return;
    }

    let mut submissions: Vec<&Submission> = input
        .submissions
        .iter()
        .filter(|submission| !submission.withdrawn)
        .filter(|submission| {
            lookup_submission_template(input, submission)
                .is_some_and(|template| template.has_ability(IrAbility::RevealTown))
        })
        .collect();
    submissions.sort_by(|left, right| {
        left.submitted_at
            .cmp(&right.submitted_at)
            .then(left.action_id.cmp(&right.action_id))
    });

    let mut revealed = BTreeSet::new();
    for submission in submissions {
        if !revealed.insert(submission.actor.clone()) {
            continue;
        }
        let Some(slot) = input
            .state
            .slots
            .iter()
            .find(|slot| slot.slot_id == submission.actor && slot.is_alive())
        else {
            continue;
        };
        let Some(alignment) = slot.alignment.clone() else {
            continue;
        };
        events.push(InnerEvent::AlignmentRevealed {
            slot_id: submission.actor.clone(),
            alignment,
            source_action: submission.action_id.clone(),
            phase_id: input.phase_id.clone(),
        });
    }
}

fn apply_effect_source_death_reveals(
    input: &ResolutionInput,
    killed: &[SlotId],
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    if input.pack.document().effect_source_death_reveals.is_empty() || killed.is_empty() {
        return;
    }

    let killed: BTreeSet<&SlotId> = killed.iter().collect();
    let policies: BTreeMap<&str, _> = input
        .pack
        .document()
        .effect_source_death_reveals
        .iter()
        .map(|policy| (policy.effect.as_str(), policy))
        .collect();
    let state_after_deaths = apply_events(&input.state, events);
    let mut already_revealed: BTreeSet<(SlotId, EffectSourceDeathRevealKind)> = events
        .iter()
        .filter_map(|event| match event {
            InnerEvent::AlignmentRevealed { slot_id, .. } => {
                Some((slot_id.clone(), EffectSourceDeathRevealKind::Alignment))
            }
            InnerEvent::RoleRevealed { slot_id, .. } => {
                Some((slot_id.clone(), EffectSourceDeathRevealKind::Role))
            }
            _ => None,
        })
        .collect();

    let mut matches = input
        .state
        .effect_records
        .iter()
        .filter(|record| killed.contains(&record.source))
        .filter_map(|record| {
            let policy = policies.get(record.effect.as_str())?;
            Some((record, *policy))
        })
        .collect::<Vec<_>>();
    matches.sort_by(|(left, left_policy), (right, right_policy)| {
        left_policy
            .id
            .cmp(&right_policy.id)
            .then(left.source.cmp(&right.source))
            .then(left.target.cmp(&right.target))
            .then(left.effect.cmp(&right.effect))
            .then(left.source_action.cmp(&right.source_action))
    });

    for (record, policy) in matches {
        match policy.reveal {
            EffectSourceDeathRevealKind::Alignment => {
                if !already_revealed.insert((
                    record.target.clone(),
                    EffectSourceDeathRevealKind::Alignment,
                )) {
                    continue;
                }
                let Some(target) = state_after_deaths
                    .slots
                    .iter()
                    .find(|slot| slot.slot_id == record.target)
                else {
                    continue;
                };
                if target.alignment_reveal == RevealState::Public {
                    continue;
                }
                let Some(alignment) = target.alignment.clone() else {
                    continue;
                };
                let source_action = record
                    .source_action
                    .clone()
                    .unwrap_or_else(|| policy.id.clone());
                trace_decisions.push(DecisionTrace {
                    stage: "source_death_reveal".to_string(),
                    source: format!("effect:{}", record.effect),
                    outcome: "alignment_revealed".to_string(),
                    detail: crate::json_atom!({
                        "policy": policy.id,
                        "effect": record.effect,
                        "source": record.source,
                        "target": record.target,
                        "source_action": source_action,
                    }),
                });
                events.push(InnerEvent::AlignmentRevealed {
                    slot_id: record.target.clone(),
                    alignment,
                    source_action,
                    phase_id: input.phase_id.clone(),
                });
            }
            EffectSourceDeathRevealKind::Role => {
                if !already_revealed
                    .insert((record.target.clone(), EffectSourceDeathRevealKind::Role))
                {
                    continue;
                }
                let Some(target) = state_after_deaths
                    .slots
                    .iter()
                    .find(|slot| slot.slot_id == record.target)
                else {
                    continue;
                };
                if target.role_reveal == RevealState::Public {
                    continue;
                }
                let source_action = record
                    .source_action
                    .clone()
                    .unwrap_or_else(|| policy.id.clone());
                trace_decisions.push(DecisionTrace {
                    stage: "source_death_reveal".to_string(),
                    source: format!("effect:{}", record.effect),
                    outcome: "role_revealed".to_string(),
                    detail: crate::json_atom!({
                        "policy": policy.id,
                        "effect": record.effect,
                        "source": record.source,
                        "target": record.target,
                        "source_action": source_action,
                    }),
                });
                events.push(InnerEvent::RoleRevealed {
                    slot_id: record.target.clone(),
                    role_key: target.role_key.clone(),
                    source_action,
                    phase_id: input.phase_id.clone(),
                });
            }
        }
    }
}

fn resolve_day_kill_actions(
    input: &ResolutionInput,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    if input.state.phase_id.kind() != PhaseKind::Day {
        return;
    }

    let mut ordered: Vec<(&Submission, &ActionTemplate)> = input
        .submissions
        .iter()
        .filter(|sub| !sub.withdrawn)
        .filter_map(|sub| {
            let template = lookup_submission_template(input, sub)?;
            if !phase_window_matches(template.window, input.state.phase_id.kind()) {
                return None;
            }
            (template.has_ability(IrAbility::Kill) && template.window == Window::Day)
                .then_some((sub, template))
        })
        .collect();
    if ordered.is_empty() {
        return;
    }
    ordered.sort_by(|(a, a_template), (b, b_template)| {
        b_template
            .constraints
            .priority
            .cmp(&a_template.constraints.priority)
            .then(a.submitted_at.cmp(&b.submitted_at))
            .then(a.action_id.cmp(&b.action_id))
    });

    let mut day_state = apply_events(&input.state, events);
    for (sub, template) in ordered {
        let Some(target) = sub.targets.first().cloned() else {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "day_kill_missing_target".to_string(),
            });
            continue;
        };
        let Some(actor_slot) = day_state
            .slots
            .iter()
            .find(|slot| slot.slot_id == sub.actor)
        else {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "day_kill_actor_unknown".to_string(),
            });
            continue;
        };
        if !actor_slot.is_alive() {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "day_kill_actor_dead".to_string(),
            });
            continue;
        }
        let Some(target_slot) = day_state.slots.iter().find(|slot| slot.slot_id == target) else {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "day_kill_target_unknown".to_string(),
            });
            continue;
        };
        if !target_slot.is_alive() {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "day_kill_target_dead".to_string(),
            });
            continue;
        }
        if let Some(limit) = template.constraints.x_shots {
            if action_counter_exhausted(input, &sub.actor, &template.id, limit) {
                events.push(InnerEvent::ActionInterfered {
                    actor: sub.actor.clone(),
                    reason: "x_shot_exhausted".to_string(),
                });
                continue;
            }
        }

        let (victim, failback_self_kill) = alignment_failback_victim(
            input,
            &sub.action_id,
            template,
            &sub.actor,
            &target,
            "day:kill_resolution",
            trace_decisions,
        );

        if !failback_self_kill {
            let target_tags = target_tags(input, &BTreeMap::new(), &victim);
            if let Some(reason) =
                target_state_gate_reason(input.pack.document(), &target_tags, IrAbility::Kill)
            {
                trace_decisions.push(DecisionTrace {
                    stage: "day:kill_resolution".to_string(),
                    source: format!("action:{}", sub.action_id),
                    outcome: "kill_skipped_by_target_state".to_string(),
                    detail: crate::json_atom!({
                        "action_id": sub.action_id,
                        "template_id": template.id,
                        "actor": sub.actor,
                        "target": victim,
                        "reason": reason,
                        "target_tags": target_tags,
                    }),
                });
                continue;
            }
        }

        let mut kill_events = Vec::new();
        if let Some(limit) = template.constraints.x_shots {
            kill_events.push(action_use_counted(
                input,
                sub.actor.clone(),
                template.id.clone(),
                sub.action_id.clone(),
                limit,
            ));
        }
        let unstoppable = template.has_modifier(Modifier::Strongman);
        kill_events.push(InnerEvent::PlayerKilled {
            slot_id: victim.clone(),
            cause: template.id.clone(),
            attackers: vec![sub.actor.clone()],
            unstoppable,
            death_reveal: death_reveal_mode(input, &victim, &template.id),
        });
        events.extend(kill_events.iter().cloned());
        day_state = apply_events(&day_state, &kill_events);
    }
}

fn resolve_beloved_princess_prompt(
    input: &ResolutionInput,
    slot_id: &SlotId,
    cause: &str,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    let policy = &input.pack.document().beloved_princess_policy;
    if !policy.enabled || !beloved_princess_policy_matches_cause(policy, cause) {
        return;
    }
    let Some(slot) = input
        .state
        .slots
        .iter()
        .find(|slot| slot.slot_id == *slot_id)
    else {
        return;
    };
    if !policy
        .eligible_roles
        .iter()
        .any(|role| role == &slot.role_key)
    {
        return;
    }

    let prompt_id = format!("{}:{}:{}", input.phase_id, policy.prompt_kind, slot_id);
    trace_decisions.push(DecisionTrace {
        stage: "death:trigger".to_string(),
        source: format!("slot:{slot_id}"),
        outcome: "host_prompt_issued".to_string(),
        detail: crate::json_atom!({
            "policy": "beloved_princess",
            "prompt_id": prompt_id,
            "kind": policy.prompt_kind,
            "subject": slot_id,
            "reason": policy.prompt_reason,
            "death_cause": cause,
            "role": slot.role_key,
        }),
    });
    events.push(InnerEvent::HostPromptIssued(HostPromptIssued {
        prompt_id,
        kind: policy.prompt_kind.clone(),
        subject: Some(slot_id.clone()),
        reason: policy.prompt_reason.clone(),
        phase_id: input.phase_id.clone(),
        metadata: HostPromptMetadata {
            policy: Some("beloved_princess".to_string()),
            death_cause: Some(cause.to_string()),
            role: Some(slot.role_key.clone()),
            ..HostPromptMetadata::default()
        },
    }));
}

fn resolve_beloved_princess_prompts(
    input: &ResolutionInput,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    let policy = &input.pack.document().beloved_princess_policy;
    if !policy.enabled {
        return;
    }
    let mut seen_slots = BTreeSet::new();
    let deaths = events
        .iter()
        .filter_map(|event| {
            let InnerEvent::PlayerKilled { slot_id, cause, .. } = event else {
                return None;
            };
            let canonical_cause = beloved_princess_death_cause(input, cause);
            Some((slot_id.clone(), canonical_cause))
        })
        .filter(|(slot_id, _)| seen_slots.insert(slot_id.clone()))
        .collect::<Vec<_>>();

    for (slot_id, cause) in deaths {
        resolve_beloved_princess_prompt(input, &slot_id, &cause, events, trace_decisions);
    }
}

fn beloved_princess_death_cause(input: &ResolutionInput, cause: &str) -> String {
    if input.state.phase_id.kind() == PhaseKind::Day && cause == "day_vote" {
        "lynch".to_string()
    } else {
        cause.to_string()
    }
}

fn beloved_princess_policy_matches_cause(
    policy: &crate::pack::BelovedPrincessPolicy,
    cause: &str,
) -> bool {
    policy.all_death_causes
        || policy
            .death_causes
            .iter()
            .any(|candidate| candidate == cause)
}

fn resolve_day_announcements(input: &ResolutionInput, events: &mut Vec<InnerEvent>) {
    let policy = &input.pack.document().day_notes.announcements;
    if !policy.enabled || input.state.phase_id.kind() != PhaseKind::Day {
        return;
    }

    let day = input.state.phase_id.number();
    let night = day.saturating_sub(1);
    let victims = &input.day_phase_inputs.night_victims;
    if victims.is_empty() {
        return;
    }
    if day == 1 && !policy.night_deaths_n1 {
        return;
    }
    if day > 1 && !policy.night_deaths_after_n1 {
        return;
    }

    let selected: Vec<&DayAnnouncementInput> =
        if day > 1 && victims.len() > 1 && !policy.multiple_night_deaths_n2plus {
            victims.iter().take(1).collect()
        } else {
            victims.iter().collect()
        };

    for (sequence, victim) in selected.into_iter().enumerate() {
        if victim.player_id.is_empty() {
            continue;
        }
        events.push(InnerEvent::DayAnnouncement(DayAnnouncement {
            player_id: victim.player_id.clone(),
            cause: victim.cause.clone(),
            template_id: policy.template_id.clone(),
            audience: policy.audience.clone(),
            source_action_id: victim.source_action_id.clone(),
            attackers: victim.attackers.clone(),
            unstoppable: victim.unstoppable,
            role_key: match policy.role_payload {
                DayNoteRolePayload::Hidden => None,
                DayNoteRolePayload::RoleKey => victim.role_key.clone(),
            },
            role_payload: day_announcement_role_payload(policy),
            recorded_at: victim.recorded_at,
            sequence: sequence as u32,
            day,
            night,
            phase_id: input.phase_id.clone(),
        }));
    }
}

fn day_announcement_role_payload(
    policy: &crate::pack::DayAnnouncementPolicy,
) -> Option<DayNoteRolePayload> {
    (policy.template_id.is_some()
        || policy.audience.is_some()
        || policy.role_payload != DayNoteRolePayload::default())
    .then_some(policy.role_payload)
}

fn resolve_badge_actions(
    input: &ResolutionInput,
    events: &mut Vec<InnerEvent>,
) -> Vec<BadgeRecord> {
    let mut badges: BTreeMap<String, BadgeRecord> = input
        .state
        .badges
        .iter()
        .map(|record| (record.badge_id.clone(), record.clone()))
        .collect();

    let mut ordered: Vec<(&Submission, &ActionTemplate)> = input
        .submissions
        .iter()
        .filter(|sub| !sub.withdrawn)
        .filter_map(|sub| {
            let template = lookup_submission_template(input, sub)?;
            if !phase_window_matches(template.window, input.state.phase_id.kind()) {
                return None;
            }
            template
                .has_ability(IrAbility::Badge)
                .then_some((sub, template))
        })
        .collect();
    ordered.sort_by(|(a, _), (b, _)| {
        a.submitted_at
            .cmp(&b.submitted_at)
            .then(a.action_id.cmp(&b.action_id))
    });

    for (sub, template) in ordered {
        let Some(badge) = &template.badge else {
            continue;
        };
        let previous = badges.get(&badge.badge_id);
        let previous_owner = previous.and_then(|record| record.owner.clone());
        let previous_weight = previous.and_then(|record| record.vote_weight);

        let (owner, vote_weight, reason, destroyed) = match badge.operation {
            BadgeOperation::Elect => {
                let Some(target) = sub.targets.first().cloned() else {
                    continue;
                };
                (
                    Some(target),
                    Some(badge.vote_weight.or(previous_weight).unwrap_or(1.0)),
                    "elected".to_string(),
                    false,
                )
            }
            BadgeOperation::Pass => {
                let Some(target) = sub.targets.first().cloned() else {
                    continue;
                };
                (
                    Some(target),
                    Some(badge.vote_weight.or(previous_weight).unwrap_or(1.0)),
                    "voluntary".to_string(),
                    false,
                )
            }
            BadgeOperation::Destroy => (None, None, "destroyed".to_string(), true),
        };

        events.push(InnerEvent::BadgeChanged {
            badge_id: badge.badge_id.clone(),
            owner: owner.clone(),
            previous_owner,
            vote_weight,
            actor: sub.actor.clone(),
            source_action: sub.action_id.clone(),
            reason: reason.clone(),
            destroyed,
            phase_id: input.phase_id.clone(),
        });

        badges.insert(
            badge.badge_id.clone(),
            BadgeRecord {
                badge_id: badge.badge_id.clone(),
                owner,
                vote_weight,
                actor: sub.actor.clone(),
                source_action: sub.action_id.clone(),
                reason,
                destroyed,
                phase_id: input.phase_id.clone(),
            },
        );
    }

    badges.into_values().collect()
}

fn require_ita_vote_conflict_policy(pack: &Pack) {
    if pack.ita.sessions.is_empty() {
        return;
    }
    if !matches!(
        pack.ita.vote_conflict,
        Some(ItaVoteConflictPolicy::ResolveShotsBeforeVote)
    ) {
        panic!(
            "invalid ITA vote conflict policy: packs with ITA sessions must declare ResolveShotsBeforeVote"
        );
    }
}

#[derive(Debug, Default)]
struct ItaLifecycleResolution {
    opened: BTreeSet<String>,
    blocked_statuses: BTreeMap<String, String>,
}

fn resolve_ita_actions(
    input: &ResolutionInput,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    if input.pack.document().ita.sessions.is_empty() {
        return;
    }
    let lifecycle = resolve_ita_lifecycle_controls(input, events, trace_decisions);

    let released_submissions = input
        .state
        .buffered_ita_shots
        .iter()
        .filter(|record| record.release_at <= input.logical_time)
        .filter(|record| {
            input.pack.document().ita.sessions.iter().any(|session| {
                session.session_id == record.session_id && ita_session_active(input, session)
            })
        })
        .map(|record| {
            let mut metadata = BTreeMap::new();
            metadata.insert(
                "ita_session_id".to_string(),
                serde_json::Value::String(record.session_id.clone()),
            );
            metadata.insert(
                "ita_buffer_release".to_string(),
                serde_json::Value::Bool(true),
            );
            Submission {
                action_id: record.action_id.clone(),
                actor: record.actor.clone(),
                template_id: record.template_id.clone(),
                targets: record.targets.clone(),
                phase_id: input.phase_id.clone(),
                submitted_at: record.submitted_at,
                withdrawn: false,
                metadata,
            }
        })
        .collect::<Vec<_>>();

    let mut ordered: Vec<(&Submission, &ActionTemplate)> = input
        .submissions
        .iter()
        .chain(released_submissions.iter())
        .filter(|sub| !sub.withdrawn)
        .filter_map(|sub| {
            let template = lookup_submission_template(input, sub)?;
            if !phase_window_matches(template.window, input.state.phase_id.kind()) {
                return None;
            }
            template
                .has_ability(IrAbility::ItaShot)
                .then_some((sub, template))
        })
        .collect();
    if ordered.is_empty() && lifecycle.opened.is_empty() {
        return;
    }
    ordered.sort_by(|(a, a_template), (b, b_template)| {
        b_template
            .constraints
            .priority
            .cmp(&a_template.constraints.priority)
            .then(a.submitted_at.cmp(&b.submitted_at))
            .then(a.action_id.cmp(&b.action_id))
    });

    let mut rng = DetRng::new(input.seed ^ 0x4954_415f_5348_4f54);
    let mut day_state = apply_events(&input.state, events);
    let mut counters_by_session: BTreeMap<String, ItaCounters> = BTreeMap::new();
    let ItaLifecycleResolution {
        mut opened,
        blocked_statuses,
    } = lifecycle;
    let mut resolved_by_session: BTreeMap<String, u32> = BTreeMap::new();
    let mut invalidated_by_session: BTreeMap<String, u32> = BTreeMap::new();
    let mut buffered_by_session: BTreeMap<String, u32> = BTreeMap::new();
    let mut ita_kills_by_target: BTreeMap<SlotId, String> = BTreeMap::new();

    for (sub, template) in ordered {
        let Some(session) = ita_session_for_submission(input, sub) else {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "ita_session_missing".to_string(),
            });
            continue;
        };
        if let Some(status) = blocked_statuses.get(&session.session_id) {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: format!("ita_session_{status}"),
            });
            continue;
        }
        if opened.insert(session.session_id.clone()) {
            events.push(InnerEvent::ItaSessionOpened {
                session_id: session.session_id.clone(),
                label: session.label.clone(),
                day: session.day,
                window: session.window.clone(),
                status: "open".to_string(),
                phase_id: input.phase_id.clone(),
            });
        }

        let Some(target) = sub.targets.first().cloned() else {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "ita_missing_target".to_string(),
            });
            continue;
        };
        let Some(actor_slot) = day_state
            .slots
            .iter()
            .find(|slot| slot.slot_id == sub.actor)
        else {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "ita_actor_unknown".to_string(),
            });
            continue;
        };
        if !actor_slot.is_alive() {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "ita_actor_dead".to_string(),
            });
            continue;
        }
        let Some(target_slot) = day_state.slots.iter().find(|slot| slot.slot_id == target) else {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "ita_target_unknown".to_string(),
            });
            continue;
        };
        let invalidated_by = if target_slot.is_alive() {
            None
        } else {
            ita_kills_by_target.get(&target).cloned()
        };
        let should_refund_dead_target = !target_slot.is_alive()
            && invalidated_by.is_none()
            && matches!(
                input
                    .pack
                    .document()
                    .ita
                    .resolution_policy
                    .on_target_already_dead,
                ItaTargetAlreadyDeadPolicy::RefundShot
            );
        if !target_slot.is_alive() && invalidated_by.is_none() && !should_refund_dead_target {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "ita_target_dead".to_string(),
            });
            continue;
        }

        let released_from_buffer = sub
            .metadata
            .get("ita_buffer_release")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        if let Some(delay_ms) = session.buffer_delay_ms.filter(|_| !released_from_buffer) {
            events.push(InnerEvent::ItaShotBuffered {
                session_id: session.session_id.clone(),
                action_id: sub.action_id.clone(),
                template_id: template.id.clone(),
                actor_id: sub.actor.clone(),
                targets: sub.targets.clone(),
                submitted_at: sub.submitted_at,
                release_at: sub.submitted_at.saturating_add(delay_ms),
                delay_ms,
            });
            *buffered_by_session
                .entry(session.session_id.clone())
                .or_insert(0) += 1;
            continue;
        }

        if should_refund_dead_target {
            let counters = counters_by_session
                .entry(session.session_id.clone())
                .or_default();
            let previous_queue_length = counters.global_shots_fired;
            counters.global_shots_fired += 1;
            *counters.per_shooter.entry(sub.actor.clone()).or_insert(0) += 1;
            *counters.per_target.entry(target.clone()).or_insert(0) += 1;
            let queue_position = previous_queue_length + 1;
            let queue_length = counters.global_shots_fired;

            events.push(InnerEvent::ItaShotQueued {
                session_id: session.session_id.clone(),
                action_id: sub.action_id.clone(),
                actor: sub.actor.clone(),
                targets: sub.targets.clone(),
                submitted_at: sub.submitted_at,
                queue_position,
                queue_length,
                previous_queue_length,
                counters: counters.clone(),
            });

            counters.global_shots_fired = counters.global_shots_fired.saturating_sub(1);
            decrement_ita_counter(&mut counters.per_shooter, &sub.actor);
            decrement_ita_counter(&mut counters.per_target, &target);
            counters.shots_refunded = counters.shots_refunded.saturating_add(1);
            *counters
                .refunded_by_reason
                .entry("target_dead".to_string())
                .or_insert(0) += 1;

            events.push(InnerEvent::ItaShotRefunded {
                session_id: session.session_id.clone(),
                action_id: sub.action_id.clone(),
                actor_id: sub.actor.clone(),
                target_id: target.clone(),
                reason: "target_dead".to_string(),
                policy: Some("REFUND_SHOT".to_string()),
                hit_chance: Some(ita_hit_chance(input, session, actor_slot, target_slot)),
                roll: Some(rng.next_f64()),
                hp_before: Some(0),
                hp_after: Some(0),
                protection_path: Some("hp".to_string()),
                submitted_at: sub.submitted_at,
                timestamp: sub.submitted_at,
                counters: counters.clone(),
            });
            continue;
        }

        let prior_session_uses =
            day_session_counter_used(input, &sub.actor, &session.session_id, &template.id);
        let current_session_uses = counters_by_session
            .get(&session.session_id)
            .and_then(|counters| counters.per_shooter.get(&sub.actor))
            .copied()
            .unwrap_or(0)
            .min(u32::from(u16::MAX)) as u16;
        if let Some(limit) = session.shot_limit {
            if prior_session_uses.saturating_add(current_session_uses) >= limit {
                events.push(InnerEvent::ActionInterfered {
                    actor: sub.actor.clone(),
                    reason: "day_session_exhausted".to_string(),
                });
                continue;
            }
            events.push(day_session_use_counted(
                input,
                sub.actor.clone(),
                &session.session_id,
                template.id.clone(),
                sub.action_id.clone(),
                limit,
                prior_session_uses
                    .saturating_add(current_session_uses)
                    .saturating_add(1),
            ));
        }

        let counters = counters_by_session
            .entry(session.session_id.clone())
            .or_default();
        let previous_queue_length = counters.global_shots_fired;
        counters.global_shots_fired += 1;
        *counters.per_shooter.entry(sub.actor.clone()).or_insert(0) += 1;
        *counters.per_target.entry(target.clone()).or_insert(0) += 1;
        let queue_position = previous_queue_length + 1;
        let queue_length = counters.global_shots_fired;

        events.push(InnerEvent::ItaShotQueued {
            session_id: session.session_id.clone(),
            action_id: sub.action_id.clone(),
            actor: sub.actor.clone(),
            targets: sub.targets.clone(),
            submitted_at: sub.submitted_at,
            queue_position,
            queue_length,
            previous_queue_length,
            counters: counters.clone(),
        });

        if let Some(invalidated_by) = invalidated_by {
            *invalidated_by_session
                .entry(session.session_id.clone())
                .or_insert(0) += 1;
            events.push(InnerEvent::ItaShotInvalidated {
                session_id: session.session_id.clone(),
                action_id: sub.action_id.clone(),
                actor_id: sub.actor.clone(),
                target_id: target.clone(),
                reason: "target_dead".to_string(),
                invalidated_by: Some(invalidated_by),
                submitted_at: sub.submitted_at,
                timestamp: sub.submitted_at,
            });
            continue;
        }

        let hit_chance = ita_hit_chance(input, session, actor_slot, target_slot);
        let roll = rng.next_f64();
        let should_hit = roll <= hit_chance;
        let shield_before = ita_shields_before(input, counters, target_slot);
        let shield_spent = should_hit && shield_before > 0;
        let shield_after = if shield_spent {
            shield_before.saturating_sub(1)
        } else {
            shield_before
        };
        if shield_before > 0 || shield_spent {
            counters
                .shields_remaining
                .insert(target.clone(), shield_after);
        }
        if shield_spent {
            *counters.shields_spent.entry(target.clone()).or_insert(0) += 1;
        }
        let hp_before = ita_hp_before(input, counters, target_slot);
        let hp_damaged = should_hit && !shield_spent && hp_before > 0;
        let hp_after = if hp_damaged {
            hp_before.saturating_sub(1)
        } else {
            hp_before
        };
        if hp_before > 0 || hp_damaged {
            counters.hp_remaining.insert(target.clone(), hp_after);
        }
        if hp_damaged {
            *counters.hp_damage.entry(target.clone()).or_insert(0) += 1;
        }
        let outcome = if !should_hit {
            ItaShotOutcome::Miss
        } else if shield_spent {
            ItaShotOutcome::Blocked
        } else {
            ItaShotOutcome::Hit
        };
        let hit = matches!(outcome, ItaShotOutcome::Hit) && (hp_before == 0 || hp_after == 0);
        counters.shots_resolved += 1;
        match outcome {
            ItaShotOutcome::Hit => counters.hits_landed += 1,
            ItaShotOutcome::Miss => counters.shots_missed += 1,
            ItaShotOutcome::Blocked => counters.shots_blocked += 1,
        }
        *resolved_by_session
            .entry(session.session_id.clone())
            .or_insert(0) += 1;

        let mut ita_events = vec![InnerEvent::ItaShotResolved {
            session_id: session.session_id.clone(),
            action_id: sub.action_id.clone(),
            actor: sub.actor.clone(),
            target: target.clone(),
            outcome,
            hit_chance,
            roll,
            kill: hit,
            shield_before: (shield_before > 0 || shield_spent).then_some(shield_before),
            shield_after: (shield_before > 0 || shield_spent).then_some(shield_after),
            shield_spent,
            hp_before: (hp_before > 0 || hp_damaged).then_some(hp_before),
            hp_after: (hp_before > 0 || hp_damaged).then_some(hp_after),
            protection_path: if shield_before > 0 || shield_spent {
                Some("shield".to_string())
            } else if hp_before > 0 || hp_damaged {
                Some("hp".to_string())
            } else {
                None
            },
            submitted_at: sub.submitted_at,
            timestamp: sub.submitted_at,
            counters: counters.clone(),
        }];
        if hit {
            ita_events.push(InnerEvent::PlayerKilled {
                slot_id: target.clone(),
                cause: template.id.clone(),
                attackers: vec![sub.actor.clone()],
                unstoppable: true,
                death_reveal: death_reveal_mode(input, &target, &template.id),
            });
            ita_kills_by_target.insert(target.clone(), sub.action_id.clone());
        }
        events.extend(ita_events.iter().cloned());
        day_state = apply_events(&day_state, &ita_events);
    }

    for session in &input.pack.document().ita.sessions {
        if !opened.contains(&session.session_id) {
            continue;
        }
        if blocked_statuses.contains_key(&session.session_id) {
            continue;
        }
        let counters = counters_by_session
            .get(&session.session_id)
            .cloned()
            .unwrap_or_default();
        let buffered = buffered_by_session
            .get(&session.session_id)
            .copied()
            .unwrap_or(0);
        let resolved = resolved_by_session
            .get(&session.session_id)
            .copied()
            .unwrap_or(0);
        let invalidated = invalidated_by_session
            .get(&session.session_id)
            .copied()
            .unwrap_or(0);
        let queue_length = counters
            .global_shots_fired
            .saturating_sub(resolved.saturating_add(invalidated));
        events.push(InnerEvent::ItaSessionUpdated {
            session_id: session.session_id.clone(),
            queue_length,
            queue_delta: queue_length as i32 - counters.global_shots_fired as i32,
            shots_resolved: resolved,
            global_shots_fired: counters.global_shots_fired,
            counters: counters.clone(),
            phase_id: input.phase_id.clone(),
        });
        if input.pack.document().ita.auto_close && buffered == 0 {
            events.push(InnerEvent::ItaSessionClosed {
                session_id: session.session_id.clone(),
                last_status: "open".to_string(),
                phase_id: input.phase_id.clone(),
            });
        }
    }
}

fn resolve_ita_lifecycle_controls(
    input: &ResolutionInput,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) -> ItaLifecycleResolution {
    let mut resolution = ItaLifecycleResolution::default();
    if input.day_phase_inputs.ita_session_controls.is_empty() {
        return resolution;
    }

    let sessions = input
        .pack
        .document()
        .ita
        .sessions
        .iter()
        .map(|session| (session.session_id.as_str(), session))
        .collect::<BTreeMap<_, _>>();
    let mut statuses = BTreeMap::<String, String>::new();
    let mut controls = input
        .day_phase_inputs
        .ita_session_controls
        .iter()
        .collect::<Vec<_>>();
    controls.sort_by(|a, b| {
        a.recorded_at
            .cmp(&b.recorded_at)
            .then(a.session_id.cmp(&b.session_id))
            .then(format!("{:?}", a.control).cmp(&format!("{:?}", b.control)))
    });

    for control in controls {
        let Some(session) = sessions.get(control.session_id.as_str()) else {
            trace_decisions.push(DecisionTrace {
                stage: "ita_session_lifecycle".to_string(),
                source: control.session_id.clone(),
                outcome: "ignored_unknown_session".to_string(),
                detail: crate::json_atom!({
                    "control": control.control,
                    "recorded_at": control.recorded_at,
                }),
            });
            continue;
        };
        if !input.pack.document().ita.lifecycle.allows(control.control) {
            trace_decisions.push(DecisionTrace {
                stage: "ita_session_lifecycle".to_string(),
                source: control.session_id.clone(),
                outcome: "ignored_pack_policy".to_string(),
                detail: crate::json_atom!({
                    "control": control.control,
                    "recorded_at": control.recorded_at,
                }),
            });
            continue;
        }

        let from_status = statuses
            .get(&control.session_id)
            .cloned()
            .unwrap_or_else(|| "scheduled".to_string());
        let to_status = match control.control {
            ItaSessionControlKind::Open => "open",
            ItaSessionControlKind::Pause => "paused",
            ItaSessionControlKind::Cancel => "cancelled",
            ItaSessionControlKind::Update => from_status.as_str(),
            ItaSessionControlKind::Close => "closed",
        }
        .to_string();

        if matches!(control.control, ItaSessionControlKind::Open) {
            resolution.opened.insert(control.session_id.clone());
            events.push(InnerEvent::ItaSessionOpened {
                session_id: control.session_id.clone(),
                label: session.label.clone(),
                day: session.day,
                window: session.window.clone(),
                status: to_status.clone(),
                phase_id: input.phase_id.clone(),
            });
        }

        events.push(InnerEvent::ItaSessionLifecycleChanged {
            session_id: control.session_id.clone(),
            control: control.control,
            from_status: from_status.clone(),
            to_status: to_status.clone(),
            message: control.message.clone(),
            recorded_at: control.recorded_at,
            phase_id: input.phase_id.clone(),
        });
        events.push(InnerEvent::ItaSessionAnnouncement {
            session_id: control.session_id.clone(),
            status: to_status.clone(),
            message: control.message.clone(),
            recorded_at: control.recorded_at,
            phase_id: input.phase_id.clone(),
        });
        if matches!(control.control, ItaSessionControlKind::Close) {
            events.push(InnerEvent::ItaSessionClosed {
                session_id: control.session_id.clone(),
                last_status: from_status.clone(),
                phase_id: input.phase_id.clone(),
            });
        }

        if matches!(
            control.control,
            ItaSessionControlKind::Pause
                | ItaSessionControlKind::Cancel
                | ItaSessionControlKind::Close
        ) {
            resolution
                .blocked_statuses
                .insert(control.session_id.clone(), to_status.clone());
        } else if matches!(control.control, ItaSessionControlKind::Open) {
            resolution.blocked_statuses.remove(&control.session_id);
        }
        statuses.insert(control.session_id.clone(), to_status.clone());
        trace_decisions.push(DecisionTrace {
            stage: "ita_session_lifecycle".to_string(),
            source: control.session_id.clone(),
            outcome: to_status,
            detail: crate::json_atom!({
                "control": control.control,
                "from_status": from_status,
                "message": control.message.clone(),
                "recorded_at": control.recorded_at,
            }),
        });
    }

    resolution
}

fn decrement_ita_counter(counters: &mut BTreeMap<SlotId, u32>, key: &SlotId) {
    let Some(value) = counters.get_mut(key) else {
        return;
    };
    *value = value.saturating_sub(1);
    if *value == 0 {
        counters.remove(key);
    }
}

fn resolve_self_destruct_actions(input: &ResolutionInput, events: &mut Vec<InnerEvent>) {
    resolve_self_destruct_actions_matching(input, events, |template| {
        phase_window_matches(template.window, input.state.phase_id.kind())
    });
}

fn resolve_instant_self_destruct_actions(input: &ResolutionInput, events: &mut Vec<InnerEvent>) {
    resolve_self_destruct_actions_matching(input, events, |template| {
        template.window == Window::Instant
    });
}

fn resolve_self_destruct_actions_matching(
    input: &ResolutionInput,
    events: &mut Vec<InnerEvent>,
    matches_window: impl Fn(&ActionTemplate) -> bool,
) {
    let mut ordered: Vec<(&Submission, &ActionTemplate)> = input
        .submissions
        .iter()
        .filter(|sub| !sub.withdrawn)
        .filter_map(|sub| {
            let template = lookup_submission_template(input, sub)?;
            if !matches_window(template) {
                return None;
            }
            template
                .has_ability(IrAbility::SelfDestruct)
                .then_some((sub, template))
        })
        .collect();
    if ordered.is_empty() {
        return;
    }
    ordered.sort_by(|(a, a_template), (b, b_template)| {
        b_template
            .constraints
            .priority
            .cmp(&a_template.constraints.priority)
            .then(a.submitted_at.cmp(&b.submitted_at))
            .then(a.action_id.cmp(&b.action_id))
    });

    let mut day_state = apply_events(&input.state, events);
    for (sub, template) in ordered {
        let Some(spec) = &template.self_destruct else {
            continue;
        };
        let Some(target) = sub.targets.first().cloned() else {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "self_destruct_missing_target".to_string(),
            });
            continue;
        };
        let Some(actor_slot) = day_state
            .slots
            .iter()
            .find(|slot| slot.slot_id == sub.actor)
        else {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "self_destruct_actor_unknown".to_string(),
            });
            continue;
        };
        if !actor_slot.is_alive() {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "self_destruct_actor_dead".to_string(),
            });
            continue;
        }
        let actor_role = actor_slot.role_key.clone();
        let Some(target_slot) = day_state.slots.iter().find(|slot| slot.slot_id == target) else {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "self_destruct_target_unknown".to_string(),
            });
            continue;
        };
        if !target_slot.is_alive() {
            events.push(InnerEvent::ActionInterfered {
                actor: sub.actor.clone(),
                reason: "self_destruct_target_dead".to_string(),
            });
            continue;
        }

        let mut self_events = vec![InnerEvent::WolfSelfDestructed {
            wolf_id: sub.actor.clone(),
            target_id: target.clone(),
            cause: spec.cause.clone(),
            unstoppable: spec.unstoppable,
            source_action: sub.action_id.clone(),
            phase_id: input.phase_id.clone(),
        }];
        if spec.kill_target {
            self_events.push(InnerEvent::PlayerKilled {
                slot_id: target.clone(),
                cause: spec.cause.clone(),
                attackers: vec![sub.actor.clone()],
                unstoppable: spec.unstoppable,
                death_reveal: death_reveal_mode(input, &target, &spec.cause),
            });
        }
        if spec.sacrifice_actor {
            self_events.push(InnerEvent::PlayerKilled {
                slot_id: sub.actor.clone(),
                cause: spec.cause.clone(),
                attackers: vec![sub.actor.clone()],
                unstoppable: spec.unstoppable,
                death_reveal: death_reveal_mode(input, &sub.actor, &spec.cause),
            });
            if input.pack.document().wolf_carry.enabled
                && input
                    .pack
                    .document()
                    .wolf_carry
                    .eligible_roles
                    .iter()
                    .any(|role| role == &actor_role)
            {
                self_events.push(InnerEvent::WolfCarryQueued {
                    owner_id: sub.actor.clone(),
                    token_id: input.pack.document().wolf_carry.token_id.clone(),
                    cause: input.pack.document().wolf_carry.cause.clone(),
                    role_key: actor_role.clone(),
                    phase_id: input.phase_id.clone(),
                });
            }
        }
        events.extend(self_events.iter().cloned());
        day_state = apply_events(&day_state, &self_events);
    }
}

fn ita_session_for_submission<'a>(
    input: &'a ResolutionInput,
    sub: &Submission,
) -> Option<&'a ItaSessionSpec> {
    let requested = sub
        .metadata
        .get("ita_session_id")
        .and_then(|value| value.as_str());
    match requested {
        Some(session_id) => {
            input.pack.document().ita.sessions.iter().find(|session| {
                session.session_id == session_id && ita_session_active(input, session)
            })
        }
        None => input
            .pack
            .document()
            .ita
            .sessions
            .iter()
            .find(|session| ita_session_active(input, session)),
    }
}

fn ita_session_active(input: &ResolutionInput, session: &ItaSessionSpec) -> bool {
    match session.day {
        Some(day) => day == input.state.phase_id.number(),
        None => true,
    }
}

fn ita_hit_chance(
    input: &ResolutionInput,
    session: &ItaSessionSpec,
    actor: &SlotState,
    target: &SlotState,
) -> f64 {
    let actor_override = input
        .pack
        .document()
        .ita
        .effective_role_override(&actor.role_key);
    let target_override = input
        .pack
        .document()
        .ita
        .effective_role_override(&target.role_key);
    let base = session
        .hit_chance
        .unwrap_or(input.pack.document().ita.default_hit_chance);
    let bonus = actor_override.hit_bonus;
    let penalty = actor_override.hit_penalty;
    let evade = target_override.target_evade;

    (base + bonus - penalty - evade).clamp(0.0, 1.0)
}

fn ita_shields_before(
    input: &ResolutionInput,
    counters: &mut ItaCounters,
    target: &SlotState,
) -> u32 {
    if let Some(existing) = counters.shields_remaining.get(&target.slot_id) {
        return *existing;
    }
    let initial = input
        .pack
        .document()
        .ita
        .effective_role_override(&target.role_key)
        .shields;
    let initial = u32::from(initial);
    if initial > 0 {
        counters
            .shields_remaining
            .insert(target.slot_id.clone(), initial);
    }
    initial
}

fn ita_hp_before(input: &ResolutionInput, counters: &mut ItaCounters, target: &SlotState) -> u32 {
    if let Some(existing) = counters.hp_remaining.get(&target.slot_id) {
        return *existing;
    }
    let initial = input
        .pack
        .document()
        .ita
        .effective_role_override(&target.role_key)
        .hit_points;
    let initial = u32::from(initial);
    if initial > 0 {
        counters
            .hp_remaining
            .insert(target.slot_id.clone(), initial);
    }
    initial
}

fn deaths_from_events(events: &[InnerEvent]) -> Vec<Death> {
    events
        .iter()
        .filter_map(|event| match event {
            InnerEvent::PlayerKilled { slot_id, cause, .. } => Some(Death {
                slot_id: slot_id.clone(),
                cause: cause.clone(),
                template_id: None,
                audience: None,
            }),
            _ => None,
        })
        .collect()
}

fn phase_announcement(input: &ResolutionInput, deaths: Vec<Death>) -> PhaseAnnouncement {
    let (template_id, audience, deaths) =
        day_death_announcement_metadata(input.pack.document(), input.state.phase_id.kind(), deaths);
    PhaseAnnouncement {
        phase_id: input.phase_id.clone(),
        template_id,
        audience,
        deaths,
    }
}
