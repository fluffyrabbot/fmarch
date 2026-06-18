//! The pure, deterministic resolver (doc 09).
//!
//! `resolve(ResolutionInput) -> ResolutionOutput` implements the night and day
//! pipelines the goldens exercise, wraps the result envelope, emits the
//! companion trace, and returns the post-resolution state. Determinism is
//! mandatory: night stage order is derived from pack precedence plus action
//! `Constraints.priority`, and within an ability actions use descending priority
//! then stable submission ordering. No hash-map iteration order ever reaches
//! output.

use std::collections::{BTreeMap, BTreeSet};

use crate::events::{
    day_death_announcement_metadata, DayAnnouncement, DayVoteOutcome, Death, DecisionTrace,
    DuelResult, EffectDeltaTrace, GeneratedActionTrace, HostPromptIssued, IndexedEvent, InnerEvent,
    ItaCounters, ItaShotOutcome, LastWordsRecorded, LastWordsVoteSummary, PhaseAnnouncement,
    ResolutionApplied, ResolutionCounts, ResolutionTrace, TraceEdge, VoteStatus,
};
use crate::ir::{InvestigateMode, IrAbility, Modifier};
use crate::pack::{
    night_ability_order, visibility_required_families, win_required_families, ActionTemplate,
    ActivationGateReason, ActorRef, BadgeOperation, ConversionDeadTargetPolicy, ConversionMode,
    ConversionPendingDeathPolicy, DayNoteRolePayload, DeathRetaliationTiming, DeathRevealMode,
    EffectDuration, EffectSourceDeathRevealKind, EffectVisibility, FactionVoteTieBreaker,
    GrantKind, GrantSpec, GuardWitchSameTargetPolicy, ItaSessionControlKind, ItaSessionSpec,
    ItaTargetAlreadyDeadPolicy, ItaVoteConflictPolicy, KillStackingPolicy, Pack, PhaseKind,
    PhaseParity, RedirectKind, ResultMemoryOutput, ResultMemoryScope, RoleModifier,
    StandardNarConflictFamily, SuppressionScope, TargetRef, TargetSpec, TieBreaker, TriggerEvent,
    TriggerLoopCapPolicy, TriggerOn, TriggerRule, VisibilityFamily, VoteDuelTieBreaker, VoteMethod,
    VoteTieBreaker, WeightPolicy, WinCondition, WinFamily, Window,
};
use crate::state::{
    apply_events, BackupTargetRecord, BadgeRecord, DelayedDeathRecord, LogicalTime, PhaseId,
    RevealState, Seed, SlotId, SlotState, StateSnapshot, Submission, WolfBeautyMarkRecord,
};

use serde::{Deserialize, Serialize};

/// Resolver contract version (doc 10 `result_version`).
pub const RESULT_VERSION: u16 = 19;

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
    pub pack: Pack,
    pub seed: Seed,
    pub logical_time: LogicalTime,
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

/// One resolved night action: a submission paired with its role action template.
struct Action<'a> {
    sub: &'a Submission,
    template: &'a ActionTemplate,
    /// Live targets (after any redirect rewrite).
    targets: Vec<SlotId>,
    blocked: bool,
}

impl<'a> Action<'a> {
    fn has_ability(&self, ability: IrAbility) -> bool {
        self.template.has_ability(ability)
    }
}

#[derive(Clone)]
struct ProtectionSource {
    protector: SlotId,
    action_id: String,
    template_id: String,
    intercept_cause: Option<String>,
    guard_retaliation_cause: Option<String>,
    cpr_harm_cause: Option<String>,
}

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

#[derive(Clone)]
struct GuardDependency {
    guard: SlotId,
    ward: SlotId,
    template_id: String,
    cause: String,
    source_action_id: String,
}

#[derive(Clone)]
struct HideDependency {
    host: SlotId,
    hider: SlotId,
    template_id: String,
    cause: String,
    source_action_id: String,
}

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

/// A landed kill: a (target, attacker) pair, recorded so triggers can react to it
/// after core resolution. `target` is the slot that died; `attacker` is the slot
/// credited with the kill (empty-string-free — every recorded kill has an actor).
#[derive(Clone)]
struct KillRecord {
    target: SlotId,
    attacker: SlotId,
    cause: String,
}

fn death_reveal_mode(input: &ResolutionInput, target: &SlotId, cause: &str) -> DeathRevealMode {
    let mut mode = input.pack.death_reveal.default;
    if let Some(by_cause) = input.pack.death_reveal.by_cause.get(cause) {
        mode = strictest_death_reveal(mode, *by_cause);
    }
    if let Some(slot) = input
        .state
        .slots
        .iter()
        .find(|slot| &slot.slot_id == target)
    {
        for effect in &slot.effects {
            if let Some(by_effect) = input.pack.death_reveal.by_effect.get(effect) {
                mode = strictest_death_reveal(mode, *by_effect);
            }
        }
    }
    mode
}

fn strictest_death_reveal(left: DeathRevealMode, right: DeathRevealMode) -> DeathRevealMode {
    if death_reveal_rank(right) > death_reveal_rank(left) {
        right
    } else {
        left
    }
}

fn death_reveal_rank(mode: DeathRevealMode) -> u8 {
    match mode {
        DeathRevealMode::Full => 0,
        DeathRevealMode::AlignmentOnly => 1,
        DeathRevealMode::Concealed => 2,
    }
}

#[derive(Clone)]
struct TriggerObservation {
    on: TriggerOn,
    target: SlotId,
    actor: SlotId,
    cause: String,
    target_tags: Vec<String>,
    actor_tags: Vec<String>,
}

/// Resolve a single kill against `target` by `attacker` (template id `cause`).
/// `unstoppable` is the already-computed Strongman bypass flag for this kill.
/// Pushes `PlayerSaved` (if protected and not bypassed) or `PlayerKilled`, and on
/// a death records the slot in `killed` and a `KillRecord` in `log`.
#[allow(clippy::too_many_arguments)]
fn resolve_one_kill(
    pack: &Pack,
    phase_id: &PhaseId,
    phase_kind: PhaseKind,
    phase_number: u32,
    target: &SlotId,
    attacker: &SlotId,
    cause: &str,
    unstoppable: bool,
    death_reveal: DeathRevealMode,
    protections: &BTreeMap<SlotId, Vec<ProtectionSource>>,
    target_tags: &BTreeSet<String>,
    cpr_saves: &mut BTreeSet<String>,
    events: &mut Vec<InnerEvent>,
    killed: &mut Vec<SlotId>,
    log: &mut Vec<KillRecord>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    // A slot already killed this resolution is not killed twice.
    if killed.contains(target) {
        if standard_nar_aggregates_kill_attackers(pack) {
            let _ = merge_stacked_kill_attribution(
                target,
                attacker,
                cause,
                unstoppable,
                events,
                log,
                trace_decisions,
            );
        }
        return;
    }
    let protectors: Vec<&ProtectionSource> = protections
        .get(target)
        .into_iter()
        .flat_map(|sources| sources.iter())
        .filter(|source| protection_blocks_cause(pack, cause, source))
        .collect();
    if !protectors.is_empty() && !unstoppable {
        let sources = protectors
            .iter()
            .map(|source| source.protector.clone())
            .collect();
        trace_decisions.push(DecisionTrace {
            stage: "kill_resolution".to_string(),
            source: format!("cause:{cause}"),
            outcome: "kill_prevented_by_protection".to_string(),
            detail: serde_json::json!({
                "target": target,
                "attacker": attacker,
                "cause": cause,
                "unstoppable": unstoppable,
                "protectors": protectors.iter().map(|source| {
                    serde_json::json!({
                        "protector": source.protector,
                        "action_id": source.action_id,
                        "template_id": source.template_id,
                        "intercepts": source.intercept_cause.is_some(),
                        "intercept_cause": source.intercept_cause.as_deref(),
                        "guard_retaliation_cause": source.guard_retaliation_cause.as_deref(),
                        "cpr_harm_cause": source.cpr_harm_cause.as_deref(),
                    })
                }).collect::<Vec<_>>(),
            }),
        });
        events.push(InnerEvent::PlayerSaved {
            slot_id: target.clone(),
            reasons: vec!["protected".to_string()],
            sources,
        });
        for source in &protectors {
            if source.cpr_harm_cause.is_some() {
                cpr_saves.insert(source.action_id.clone());
            }
        }
        for source in &protectors {
            let Some(intercept_cause) = source.intercept_cause.as_deref() else {
                continue;
            };
            if killed.contains(&source.protector) {
                if standard_nar_aggregates_kill_attackers(pack) {
                    let _ = merge_stacked_kill_attribution(
                        &source.protector,
                        attacker,
                        intercept_cause,
                        false,
                        events,
                        log,
                        trace_decisions,
                    );
                }
                continue;
            }
            killed.push(source.protector.clone());
            events.push(InnerEvent::PlayerKilled {
                slot_id: source.protector.clone(),
                cause: intercept_cause.to_string(),
                attackers: vec![attacker.clone()],
                unstoppable: false,
                death_reveal: DeathRevealMode::Full,
            });
            log.push(KillRecord {
                target: source.protector.clone(),
                attacker: attacker.clone(),
                cause: intercept_cause.to_string(),
            });
        }
        for source in &protectors {
            let Some(retaliation_cause) = source.guard_retaliation_cause.as_deref() else {
                continue;
            };
            if killed.contains(attacker) {
                if standard_nar_aggregates_kill_attackers(pack) {
                    let _ = merge_stacked_kill_attribution(
                        attacker,
                        &source.protector,
                        retaliation_cause,
                        false,
                        events,
                        log,
                        trace_decisions,
                    );
                }
                continue;
            }
            let attacker_protectors = protections
                .get(attacker)
                .into_iter()
                .flat_map(|sources| sources.iter())
                .filter(|protector| protection_blocks_cause(pack, retaliation_cause, protector))
                .collect::<Vec<_>>();
            if !attacker_protectors.is_empty() {
                trace_decisions.push(DecisionTrace {
                    stage: "kill_resolution".to_string(),
                    source: format!("cause:{retaliation_cause}"),
                    outcome: "guard_retaliation_prevented_by_protection".to_string(),
                    detail: serde_json::json!({
                        "protected_target": target,
                        "protector": source.protector,
                        "attacker": attacker,
                        "source_action": source.action_id,
                        "template_id": source.template_id,
                        "cause": retaliation_cause,
                        "attacker_protectors": attacker_protectors.iter().map(|protector| {
                            serde_json::json!({
                                "protector": protector.protector,
                                "action_id": protector.action_id,
                                "template_id": protector.template_id,
                            })
                        }).collect::<Vec<_>>(),
                    }),
                });
                events.push(InnerEvent::PlayerSaved {
                    slot_id: attacker.clone(),
                    reasons: vec!["protected".to_string()],
                    sources: attacker_protectors
                        .iter()
                        .map(|protector| protector.protector.clone())
                        .collect(),
                });
                continue;
            }
            killed.push(attacker.clone());
            trace_decisions.push(DecisionTrace {
                stage: "kill_resolution".to_string(),
                source: format!("cause:{retaliation_cause}"),
                outcome: "guard_retaliation_killed_attacker".to_string(),
                detail: serde_json::json!({
                    "protected_target": target,
                    "protector": source.protector,
                    "attacker": attacker,
                    "source_action": source.action_id,
                    "template_id": source.template_id,
                    "cause": retaliation_cause,
                }),
            });
            events.push(InnerEvent::PlayerKilled {
                slot_id: attacker.clone(),
                cause: retaliation_cause.to_string(),
                attackers: vec![source.protector.clone()],
                unstoppable: false,
                death_reveal: DeathRevealMode::Full,
            });
            log.push(KillRecord {
                target: attacker.clone(),
                attacker: source.protector.clone(),
                cause: retaliation_cause.to_string(),
            });
        }
    } else if let Some(reason) = bulletproof_reason(target_tags)
        .filter(|reason| target_state_save_blocks_cause(pack, cause, reason, unstoppable))
    {
        events.push(InnerEvent::PlayerSaved {
            slot_id: target.clone(),
            reasons: vec![reason.to_string()],
            sources: vec![target.clone()],
        });
        if reason == "bulletproof_vest" {
            events.push(counter_use_counted(
                phase_id,
                phase_kind,
                phase_number,
                format!("shield:{reason}"),
                target.clone(),
                reason.to_string(),
                cause.to_string(),
                "shield".to_string(),
                "effect".to_string(),
                1,
                1,
            ));
            events.push(InnerEvent::EffectsCleared {
                effect: "bulletproof_vest".to_string(),
                targets: vec![target.clone()],
                actor: target.clone(),
            });
        }
    } else {
        if !protectors.is_empty() && unstoppable {
            trace_decisions.push(DecisionTrace {
                stage: "kill_resolution".to_string(),
                source: format!("cause:{cause}"),
                outcome: "protection_bypassed_by_unstoppable_kill".to_string(),
                detail: serde_json::json!({
                    "target": target,
                    "attacker": attacker,
                    "cause": cause,
                    "unstoppable": unstoppable,
                    "protectors": protectors.iter().map(|source| {
                        serde_json::json!({
                            "protector": source.protector,
                            "action_id": source.action_id,
                            "template_id": source.template_id,
                            "intercepts": source.intercept_cause.is_some(),
                            "intercept_cause": source.intercept_cause.as_deref(),
                            "guard_retaliation_cause": source.guard_retaliation_cause.as_deref(),
                            "cpr_harm_cause": source.cpr_harm_cause.as_deref(),
                        })
                    }).collect::<Vec<_>>(),
                }),
            });
        }
        killed.push(target.clone());
        events.push(InnerEvent::PlayerKilled {
            slot_id: target.clone(),
            cause: cause.to_string(),
            attackers: vec![attacker.clone()],
            unstoppable,
            death_reveal,
        });
        log.push(KillRecord {
            target: target.clone(),
            attacker: attacker.clone(),
            cause: cause.to_string(),
        });
    }
}

fn merge_stacked_kill_attribution(
    target: &SlotId,
    attacker: &SlotId,
    cause: &str,
    unstoppable: bool,
    events: &mut [InnerEvent],
    log: &mut Vec<KillRecord>,
    trace_decisions: &mut Vec<DecisionTrace>,
) -> Option<KillRecord> {
    let Some(InnerEvent::PlayerKilled {
        cause: original_cause,
        attackers,
        unstoppable: original_unstoppable,
        ..
    }) = events.iter_mut().find(
        |event| matches!(event, InnerEvent::PlayerKilled { slot_id, .. } if slot_id == target),
    )
    else {
        return None;
    };

    if !attackers.contains(attacker) {
        attackers.push(attacker.clone());
    }
    *original_unstoppable = *original_unstoppable || unstoppable;
    let record = KillRecord {
        target: target.clone(),
        attacker: attacker.clone(),
        cause: cause.to_string(),
    };
    log.push(record.clone());
    trace_decisions.push(DecisionTrace {
        stage: "kill_resolution".to_string(),
        source: format!("cause:{cause}"),
        outcome: "kill_stacked_on_existing_death".to_string(),
        detail: serde_json::json!({
            "target": target,
            "attacker": attacker,
            "cause": cause,
            "existing_cause": original_cause,
            "unstoppable": unstoppable,
            "merged_attackers": attackers,
        }),
    });
    Some(record)
}

/// Is a role immune to conversion? A role is immune iff it carries the `Loyal`
/// modifier on any of its actions, or its role-level `effects` include a
/// pack-configured immune tag (`"loyal"`). v1 uses the `"loyal"` effect tag and
/// the `Loyal` modifier interchangeably as the conversion-immunity signal.
fn conversion_immune(input: &ResolutionInput, role_key: &str) -> bool {
    let Some(role) = input.pack.roles.get(role_key) else {
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
            .roles
            .get(&role)
            .and_then(|r| r.alignment.clone()),
    ))
}

fn backup_role<'a>(policy: &crate::pack::BackupPolicy, effect: &'a str) -> Option<&'a str> {
    effect.strip_prefix(&policy.passive_effect_prefix)
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

fn effect_marked_observation(
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

fn phase_end_observations(input: &ResolutionInput, killed: &[SlotId]) -> Vec<TriggerObservation> {
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

fn apply_win_triggers_before_final(
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
    let _generated_kills = apply_trigger_fixpoint(
        input,
        win_observations(&state_before_final, winner),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &mut killed,
        &mut cpr_saves,
        events,
        trace_decisions,
        trace_notes,
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

fn apply_trigger_fixpoint(
    input: &ResolutionInput,
    mut frontier: Vec<TriggerObservation>,
    protections: &BTreeMap<SlotId, Vec<ProtectionSource>>,
    transient_effects: &BTreeMap<SlotId, BTreeSet<String>>,
    killed: &mut Vec<SlotId>,
    cpr_saves: &mut BTreeSet<String>,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
    trace_notes: &mut Vec<String>,
) -> Vec<KillRecord> {
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
        let mut next_kills: Vec<KillRecord> = Vec::new();
        for observation in &frontier {
            for trig in &pack.triggers {
                if trig.on != observation.on {
                    continue;
                }
                if !standard_nar_trigger_participates_in_fixpoint(pack, trig) {
                    continue;
                }
                let Some(target_slot) = input
                    .state
                    .slots
                    .iter()
                    .find(|s| s.slot_id == observation.target)
                else {
                    continue;
                };
                let actor_slot = input
                    .state
                    .slots
                    .iter()
                    .find(|s| s.slot_id == observation.actor);
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
                if trig.produces.ability == IrAbility::Kill {
                    let strongman = standard_nar_generated_kill_bypasses_protect(pack, trig);
                    let target_tags = target_tags(input, transient_effects, &produced_target);
                    if let Some(reason) =
                        target_state_gate_reason(pack, &target_tags, IrAbility::Kill)
                    {
                        trace_decisions.push(DecisionTrace {
                            stage: "kill_resolution".to_string(),
                            source: format!("cause:{}", trig.id),
                            outcome: "kill_skipped_by_target_state".to_string(),
                            detail: serde_json::json!({
                                "action_id": trig.id,
                                "template_id": trig.id,
                                "actor": produced_actor,
                                "target": produced_target,
                                "reason": reason,
                                "target_tags": target_tags,
                            }),
                        });
                        continue;
                    }
                    resolve_one_kill(
                        pack,
                        &input.phase_id,
                        input.state.phase_kind,
                        input.state.phase_number,
                        &produced_target,
                        &produced_actor,
                        &trig.id,
                        strongman,
                        death_reveal_mode(input, &produced_target, &trig.id),
                        protections,
                        &target_tags,
                        cpr_saves,
                        events,
                        killed,
                        &mut next_kills,
                        trace_decisions,
                    );
                }
            }
        }
        produced_kills.extend(next_kills.clone());
        frontier = next_kills.iter().flat_map(kill_observations).collect();
    }
    produced_kills
}

fn apply_lover_suicides(
    input: &ResolutionInput,
    killed: &mut Vec<SlotId>,
    kill_log: &mut Vec<KillRecord>,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) -> Vec<SlotId> {
    let policy = &input.pack.lover_policy;
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
                    detail: serde_json::json!({
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
                    if standard_nar_aggregates_kill_attackers(&input.pack) {
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

fn apply_chosen_retaliations(
    input: &ResolutionInput,
    protections: &BTreeMap<SlotId, Vec<ProtectionSource>>,
    killed: &mut Vec<SlotId>,
    kill_log: &mut Vec<KillRecord>,
    cpr_saves: &mut BTreeSet<String>,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    let killed_now: BTreeSet<SlotId> = killed.iter().cloned().collect();
    for retaliation in &input.state.retaliations {
        if !killed_now.contains(&retaliation.actor) || killed.contains(&retaliation.target) {
            continue;
        }
        let death_cause = player_kill_cause(events, &retaliation.actor);
        if let Some(reason) =
            chosen_retaliation_suppression_reason(input, &retaliation.actor, death_cause.as_deref())
        {
            trace_decisions.push(DecisionTrace {
                stage: "death:cascade".to_string(),
                source: format!("retaliation:{}", retaliation.retaliation_id),
                outcome: "chosen_retaliation_suppressed".to_string(),
                detail: serde_json::json!({
                    "policy": "death_retaliation",
                    "timing": "ImmediateBeforePhaseAnnouncement",
                    "reason": reason,
                    "retaliation_id": retaliation.retaliation_id.clone(),
                    "actor": retaliation.actor.clone(),
                    "target": retaliation.target.clone(),
                    "source_action": retaliation.source_action.clone(),
                    "source_death_cause": death_cause,
                }),
            });
            continue;
        }
        let Some(target_slot) = input
            .state
            .slots
            .iter()
            .find(|slot| slot.slot_id == retaliation.target)
        else {
            continue;
        };
        if !target_slot.is_alive() {
            continue;
        }
        let strongman = standard_nar_chosen_retaliation_bypasses_protect(
            &input.pack,
            &retaliation.source_action,
        );
        trace_decisions.push(DecisionTrace {
            stage: "death:cascade".to_string(),
            source: format!("retaliation:{}", retaliation.retaliation_id),
            outcome: "chosen_retaliation".to_string(),
            detail: serde_json::json!({
                "retaliation_id": retaliation.retaliation_id.clone(),
                "actor": retaliation.actor.clone(),
                "target": retaliation.target.clone(),
                "source_action": retaliation.source_action.clone(),
                "source_death_cause": death_cause,
                "cause": retaliation.source_action.clone(),
                "unstoppable": strongman,
                "timing": "ImmediateBeforePhaseAnnouncement",
            }),
        });
        resolve_one_kill(
            &input.pack,
            &input.phase_id,
            input.state.phase_kind,
            input.state.phase_number,
            &retaliation.target,
            &retaliation.actor,
            &retaliation.source_action,
            strongman,
            death_reveal_mode(input, &retaliation.target, &retaliation.source_action),
            protections,
            &target_tags(input, &BTreeMap::new(), &retaliation.target),
            cpr_saves,
            events,
            killed,
            kill_log,
            trace_decisions,
        );
    }
}

fn apply_cpr_harms(
    input: &ResolutionInput,
    protections: &BTreeMap<SlotId, Vec<ProtectionSource>>,
    cpr_saves: &BTreeSet<String>,
    killed: &mut Vec<SlotId>,
    kill_log: &mut Vec<KillRecord>,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    let killed_before: BTreeSet<SlotId> = killed.iter().cloned().collect();
    for (target, sources) in protections {
        let Some(target_slot) = input
            .state
            .slots
            .iter()
            .find(|slot| &slot.slot_id == target)
        else {
            continue;
        };
        if !target_slot.is_alive() || killed_before.contains(target) {
            continue;
        }
        for source in sources {
            let Some(cause) = source.cpr_harm_cause.as_deref() else {
                continue;
            };
            if cpr_saves.contains(&source.action_id) {
                continue;
            }
            trace_decisions.push(DecisionTrace {
                stage: "night:cpr".to_string(),
                source: format!("action:{}", source.action_id),
                outcome: "cpr_harm_applied".to_string(),
                detail: serde_json::json!({
                    "action_id": source.action_id,
                    "template_id": source.template_id,
                    "protector": source.protector,
                    "target": target,
                    "cause": cause,
                }),
            });
            if killed.contains(target) {
                if standard_nar_aggregates_kill_attackers(&input.pack) {
                    let _ = merge_stacked_kill_attribution(
                        target,
                        &source.protector,
                        cause,
                        false,
                        events,
                        kill_log,
                        trace_decisions,
                    );
                }
                continue;
            }
            killed.push(target.clone());
            events.push(InnerEvent::PlayerKilled {
                slot_id: target.clone(),
                cause: cause.to_string(),
                attackers: vec![source.protector.clone()],
                unstoppable: false,
                death_reveal: death_reveal_mode(input, target, cause),
            });
            kill_log.push(KillRecord {
                target: target.clone(),
                attacker: source.protector.clone(),
                cause: cause.to_string(),
            });
        }
    }
}

fn player_kill_cause(events: &[InnerEvent], slot_id: &SlotId) -> Option<String> {
    events.iter().rev().find_map(|event| match event {
        InnerEvent::PlayerKilled {
            slot_id: killed,
            cause,
            ..
        } if killed == slot_id => Some(cause.clone()),
        _ => None,
    })
}

fn chosen_retaliation_suppression_reason(
    input: &ResolutionInput,
    actor: &SlotId,
    death_cause: Option<&str>,
) -> Option<&'static str> {
    let policy = &input.pack.death_retaliation;
    if !policy.enabled {
        return None;
    }
    if policy.timing != Some(DeathRetaliationTiming::ImmediateBeforePhaseAnnouncement) {
        panic!(
            "invalid death_retaliation policy: enabled policy must declare ImmediateBeforePhaseAnnouncement timing"
        );
    }
    let Some(role) = slot_role(input, actor) else {
        return None;
    };
    if !policy
        .eligible_roles
        .iter()
        .any(|eligible| eligible == role)
    {
        return None;
    }
    let Some(cause) = death_cause else {
        return Some("missing_death_cause");
    };
    if policy
        .suppressed_death_causes
        .iter()
        .any(|suppressed| suppressed == cause)
    {
        return Some("suppressed_death_cause");
    }
    if policy
        .allowed_death_causes
        .iter()
        .any(|allowed| allowed == cause)
    {
        return None;
    }
    Some("death_cause_not_allowed")
}

fn apply_guard_dependency_deaths(
    input: &ResolutionInput,
    dependencies: &[GuardDependency],
    killed: &mut Vec<SlotId>,
    kill_log: &mut Vec<KillRecord>,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) -> Vec<KillRecord> {
    let mut generated = Vec::new();
    let killed_now: BTreeSet<SlotId> = killed.iter().cloned().collect();
    for dependency in dependencies {
        if !killed_now.contains(&dependency.guard) {
            continue;
        }
        let Some(ward_slot) = input
            .state
            .slots
            .iter()
            .find(|slot| slot.slot_id == dependency.ward)
        else {
            continue;
        };
        if !ward_slot.is_alive() {
            continue;
        }
        trace_decisions.push(DecisionTrace {
            stage: "night:dependency_death".to_string(),
            source: format!("action:{}", dependency.source_action_id),
            outcome: "babysitter_dependency_death".to_string(),
            detail: serde_json::json!({
                "action_id": dependency.source_action_id.clone(),
                "template_id": dependency.template_id.clone(),
                "protector": dependency.guard.clone(),
                "ward": dependency.ward.clone(),
                "cause": dependency.cause.clone(),
                "attackers": [dependency.guard.clone()],
            }),
        });
        if killed.contains(&dependency.ward) {
            if standard_nar_aggregates_kill_attackers(&input.pack) {
                if let Some(record) = merge_stacked_kill_attribution(
                    &dependency.ward,
                    &dependency.guard,
                    &dependency.cause,
                    true,
                    events,
                    kill_log,
                    trace_decisions,
                ) {
                    generated.push(record);
                }
            }
            continue;
        }
        killed.push(dependency.ward.clone());
        events.push(InnerEvent::PlayerKilled {
            slot_id: dependency.ward.clone(),
            cause: dependency.cause.clone(),
            attackers: vec![dependency.guard.clone()],
            unstoppable: true,
            death_reveal: death_reveal_mode(input, &dependency.ward, &dependency.cause),
        });
        let record = KillRecord {
            target: dependency.ward.clone(),
            attacker: dependency.guard.clone(),
            cause: dependency.cause.clone(),
        };
        kill_log.push(record.clone());
        generated.push(record);
    }
    generated
}

fn apply_hide_dependency_deaths(
    input: &ResolutionInput,
    dependencies: &[HideDependency],
    killed: &mut Vec<SlotId>,
    kill_log: &mut Vec<KillRecord>,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) -> Vec<KillRecord> {
    let mut generated = Vec::new();
    let killed_now: BTreeSet<SlotId> = killed.iter().cloned().collect();
    for dependency in dependencies {
        if !killed_now.contains(&dependency.host) {
            continue;
        }
        let Some(hider_slot) = input
            .state
            .slots
            .iter()
            .find(|slot| slot.slot_id == dependency.hider)
        else {
            continue;
        };
        if !hider_slot.is_alive() {
            continue;
        }
        trace_decisions.push(DecisionTrace {
            stage: "night:dependency_death".to_string(),
            source: format!("action:{}", dependency.source_action_id),
            outcome: "hider_dependency_death".to_string(),
            detail: serde_json::json!({
                "action_id": dependency.source_action_id.clone(),
                "template_id": dependency.template_id.clone(),
                "host": dependency.host.clone(),
                "hider": dependency.hider.clone(),
                "cause": dependency.cause.clone(),
                "attackers": [dependency.host.clone()],
            }),
        });
        if killed.contains(&dependency.hider) {
            if standard_nar_aggregates_kill_attackers(&input.pack) {
                if let Some(record) = merge_stacked_kill_attribution(
                    &dependency.hider,
                    &dependency.host,
                    &dependency.cause,
                    true,
                    events,
                    kill_log,
                    trace_decisions,
                ) {
                    generated.push(record);
                }
            }
            continue;
        }
        killed.push(dependency.hider.clone());
        events.push(InnerEvent::PlayerKilled {
            slot_id: dependency.hider.clone(),
            cause: dependency.cause.clone(),
            attackers: vec![dependency.host.clone()],
            unstoppable: true,
            death_reveal: death_reveal_mode(input, &dependency.hider, &dependency.cause),
        });
        let record = KillRecord {
            target: dependency.hider.clone(),
            attacker: dependency.host.clone(),
            cause: dependency.cause.clone(),
        };
        kill_log.push(record.clone());
        generated.push(record);
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
    let policy = &input.pack.wolf_beauty;
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
            detail: serde_json::json!({
                "beauty_id": record.target.clone(),
                "dragged_id": mark.target_id.clone(),
                "mark_effect": mark.effect.clone(),
                "mark_source_action": mark.source_action.clone(),
                "mark_phase_id": mark.phase_id.clone(),
                "mark_phase_kind": mark.phase_kind,
                "mark_phase_number": mark.phase_number,
                "trigger_cause": record.cause.clone(),
                "cause": policy.drag_cause.clone(),
            }),
        });
        events.push(InnerEvent::WolfBeautyDragged {
            beauty_id: record.target.clone(),
            dragged_ids: vec![mark.target_id.clone()],
            cause: policy.drag_cause.clone(),
            phase_id: input.phase_id.clone(),
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
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
    if let Some(role) = input.pack.roles.get(&slot.role_key) {
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
        detail: serde_json::json!({
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
    if pack.standard_nar.enabled {
        let gate_tags = pack
            .standard_nar
            .target_state_gate_tags
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        return tags.iter().find_map(|tag| {
            if !gate_tags.contains(tag.as_str()) {
                return None;
            }
            pack.standard_nar
                .target_state_gate_policy
                .get(tag)
                .is_some_and(|policy| policy.blocks.iter().any(|blocked| *blocked == ability))
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

fn target_state_interference_reason(reason: &str) -> String {
    if reason == "commuted" || reason == "untargetable" {
        "untargetable".to_string()
    } else {
        reason.to_string()
    }
}

fn emit_action_interfered_by_target_state(
    trace_decisions: &mut Vec<DecisionTrace>,
    events: &mut Vec<InnerEvent>,
    action: &Action<'_>,
    target: &SlotId,
    ability: IrAbility,
    mode: Option<InvestigateMode>,
    reason: &str,
    target_tags: &BTreeSet<String>,
) {
    let mut detail = serde_json::json!({
        "action_id": action.sub.action_id,
        "template_id": action.template.id,
        "actor": action.sub.actor,
        "target": target,
        "ability": format!("{ability:?}"),
        "reason": reason,
        "target_tags": target_tags,
    });
    if let Some(mode) = mode {
        detail["mode"] = serde_json::json!(mode);
    }
    trace_decisions.push(DecisionTrace {
        stage: "night:target_state".to_string(),
        source: format!("action:{}", action.sub.action_id),
        outcome: "action_interfered_by_target_state".to_string(),
        detail,
    });
    events.push(InnerEvent::ActionInterfered {
        actor: action.sub.actor.clone(),
        reason: target_state_interference_reason(reason),
    });
}

fn require_standard_nar_target_state_save_catalog(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let save_tags = standard_nar_derived_target_state_save_tags(pack);
    if !save_tags.is_empty() && pack.standard_nar.target_state_save_tags.is_empty() {
        panic!(
            "invalid standard_nar target-state save catalog: enabled standard_nar policy must declare target-state save tags"
        );
    }
}

fn require_standard_nar_target_state_save_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let save_tags = standard_nar_target_state_save_tags(pack);
    if save_tags.is_empty() {
        return;
    }
    let kill_causes = pack
        .standard_nar
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    for tag in &save_tags {
        let Some(policy) = pack.standard_nar.target_state_save_policy.get(*tag) else {
            panic!(
                "invalid standard_nar target-state save policy: target-state save `{tag}` must classify every kill cause"
            );
        };
        if policy.blocks.is_empty() && policy.bypasses.is_empty() {
            panic!(
                "invalid standard_nar target-state save policy: target-state save `{tag}` must classify kill causes"
            );
        }
        require_standard_nar_target_state_save_policy_causes(
            tag,
            "blocks",
            &policy.blocks,
            &kill_causes,
        );
        require_standard_nar_target_state_save_policy_causes(
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
                    "invalid standard_nar target-state save policy: target-state save `{tag}` kill cause `{cause}` cannot be both blocked and bypassed"
                );
            }
        }
    }
    for tag in pack.standard_nar.target_state_save_policy.keys() {
        if tag.trim().is_empty() {
            panic!(
                "invalid standard_nar target-state save policy: target-state save tag must not be empty"
            );
        }
        if !save_tags.contains(tag.as_str()) {
            panic!(
                "invalid standard_nar target-state save policy: unknown target-state save `{tag}`"
            );
        }
    }
}

fn require_standard_nar_target_state_save_policy_causes(
    tag: &str,
    field: &str,
    causes: &[String],
    kill_causes: &BTreeSet<&str>,
) {
    let mut seen = BTreeSet::new();
    for cause in causes {
        if cause.trim().is_empty() {
            panic!(
                "invalid standard_nar target-state save policy: target-state save `{tag}` {field} contains empty kill cause"
            );
        }
        if !seen.insert(cause.as_str()) {
            panic!(
                "invalid standard_nar target-state save policy: target-state save `{tag}` {field} contains duplicate kill cause `{cause}`"
            );
        }
        if !kill_causes.contains(cause.as_str()) {
            panic!(
                "invalid standard_nar target-state save policy: target-state save `{tag}` {field} references unknown kill cause `{cause}`"
            );
        }
    }
}

fn standard_nar_target_state_save_tags(pack: &Pack) -> BTreeSet<&str> {
    if pack.standard_nar.enabled {
        return pack
            .standard_nar
            .target_state_save_tags
            .iter()
            .map(String::as_str)
            .collect();
    }
    standard_nar_derived_target_state_save_tags(pack)
}

fn standard_nar_derived_target_state_save_tags(pack: &Pack) -> BTreeSet<&str> {
    let mut tags = BTreeSet::new();
    for role in pack.roles.values() {
        for effect in &role.effects {
            record_standard_nar_target_state_save_tag(&mut tags, effect);
        }
    }
    for effect in pack.effects.keys() {
        record_standard_nar_target_state_save_tag(&mut tags, effect);
    }
    tags
}

fn record_standard_nar_target_state_save_tag<'a>(tags: &mut BTreeSet<&'a str>, effect: &'a str) {
    if effect == "bulletproof" || effect == "bulletproof_vest" {
        tags.insert(effect);
    }
}

fn require_standard_nar_target_state_gate_catalog(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let gate_tags = standard_nar_derived_target_state_gate_tags(pack);
    if !gate_tags.is_empty() && pack.standard_nar.target_state_gate_tags.is_empty() {
        panic!(
            "invalid standard_nar target-state gate catalog: enabled standard_nar policy must declare target-state gate tags"
        );
    }
}

fn require_standard_nar_target_state_gate_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let gate_tags = standard_nar_target_state_gate_tags(pack);
    if gate_tags.is_empty() {
        return;
    }
    for tag in &gate_tags {
        let Some(policy) = pack.standard_nar.target_state_gate_policy.get(*tag) else {
            panic!(
                "invalid standard_nar target-state gate policy: target-state gate `{tag}` must classify blocked abilities"
            );
        };
        if policy.blocks.is_empty() {
            panic!(
                "invalid standard_nar target-state gate policy: target-state gate `{tag}` must declare blocked abilities"
            );
        }
        let mut seen = BTreeSet::new();
        for ability in &policy.blocks {
            if !seen.insert(*ability) {
                panic!(
                    "invalid standard_nar target-state gate policy: target-state gate `{tag}` contains duplicate blocked ability `{ability:?}`"
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
                    "invalid standard_nar target-state gate policy: target-state gate `{tag}` only supports Kill, Protect, Investigate, Convert, or Mark, got `{ability:?}`"
                );
            }
        }
    }
    for tag in pack.standard_nar.target_state_gate_policy.keys() {
        if tag.trim().is_empty() {
            panic!(
                "invalid standard_nar target-state gate policy: target-state gate tag must not be empty"
            );
        }
        if !gate_tags.contains(tag.as_str()) {
            panic!(
                "invalid standard_nar target-state gate policy: unknown target-state gate `{tag}`"
            );
        }
    }
}

fn require_standard_nar_kill_stacking_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    if !matches!(
        pack.standard_nar.kill_stacking,
        Some(KillStackingPolicy::AggregateAttackers)
    ) {
        panic!(
            "invalid standard_nar kill stacking policy: enabled standard_nar policy requires kill_stacking AggregateAttackers"
        );
    }
}

fn require_standard_nar_strongman_bypass_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    if !pack.standard_nar.strongman_bypasses_protect {
        panic!(
            "invalid standard_nar strongman bypass policy: enabled standard_nar policy requires strongman_bypasses_protect true"
        );
    }
}

fn require_standard_nar_protection_cause_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let protect_sources = standard_nar_protect_source_ids(pack);
    if protect_sources.is_empty() {
        return;
    }
    let kill_causes = pack
        .standard_nar
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    for source in &protect_sources {
        let Some(policy) = pack.standard_nar.protection_cause_policy.get(*source) else {
            panic!(
                "invalid standard_nar protection cause policy: protection source `{source}` must classify every kill cause"
            );
        };
        if policy.blocks.is_empty() && policy.bypasses.is_empty() {
            panic!(
                "invalid standard_nar protection cause policy: protection source `{source}` must classify kill causes"
            );
        }
        require_standard_nar_protection_cause_policy_causes(
            source,
            "blocks",
            &policy.blocks,
            &kill_causes,
        );
        require_standard_nar_protection_cause_policy_causes(
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
                    "invalid standard_nar protection cause policy: protection source `{source}` kill cause `{cause}` cannot be both blocked and bypassed"
                );
            }
        }
    }
    for source in pack.standard_nar.protection_cause_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid standard_nar protection cause policy: protection source id must not be empty"
            );
        }
        if !protect_sources.contains(source.as_str()) {
            panic!(
                "invalid standard_nar protection cause policy: unknown protection source `{source}`"
            );
        }
    }
}

fn require_standard_nar_protection_cause_policy_causes(
    source: &str,
    field: &str,
    causes: &[String],
    kill_causes: &BTreeSet<&str>,
) {
    let mut seen = BTreeSet::new();
    for cause in causes {
        if cause.trim().is_empty() {
            panic!(
                "invalid standard_nar protection cause policy: protection source `{source}` {field} contains empty kill cause"
            );
        }
        if !seen.insert(cause.as_str()) {
            panic!(
                "invalid standard_nar protection cause policy: protection source `{source}` {field} contains duplicate kill cause `{cause}`"
            );
        }
        if !kill_causes.contains(cause.as_str()) {
            panic!(
                "invalid standard_nar protection cause policy: protection source `{source}` {field} references unknown kill cause `{cause}`"
            );
        }
    }
}

fn require_standard_nar_suppression_policy_shape(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let block_sources = standard_nar_block_source_ids(pack);
    let night_actions = standard_nar_night_action_roleblockability(pack);
    for (source, policy) in &pack.standard_nar.suppression_policy {
        if source.trim().is_empty() {
            panic!("invalid standard_nar suppression policy: block source id must not be empty");
        }
        if !block_sources.contains(source.as_str()) {
            panic!("invalid standard_nar suppression policy: unknown block source `{source}`");
        }
        if policy.scope.is_none() {
            panic!(
                "invalid standard_nar suppression policy: Block action `{source}` must declare suppression scope"
            );
        }
        require_standard_nar_suppression_policy_actions(
            source,
            "suppresses",
            &policy.suppresses,
            &night_actions,
        );
        require_standard_nar_suppression_policy_actions(
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
                    "invalid standard_nar suppression policy: night action `{action_id}` cannot be both suppressed and bypassed"
                );
            }
        }
    }
}

fn require_standard_nar_suppression_policy_actions(
    source: &str,
    field: &str,
    action_ids: &[String],
    night_actions: &BTreeMap<&str, StandardNarNightAction>,
) {
    let mut seen = BTreeSet::new();
    for action_id in action_ids {
        if action_id.trim().is_empty() {
            panic!(
                "invalid standard_nar suppression policy: block source `{source}` {field} contains empty night action"
            );
        }
        if !seen.insert(action_id.as_str()) {
            panic!(
                "invalid standard_nar suppression policy: block source `{source}` {field} contains duplicate night action `{action_id}`"
            );
        }
        if !night_actions.contains_key(action_id.as_str()) {
            panic!(
                "invalid standard_nar suppression policy: block source `{source}` {field} references unknown night action `{action_id}`"
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

fn require_standard_nar_intercept_cause_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let intercept_sources = pack
        .standard_nar
        .bodyguard_action_ids
        .iter()
        .chain(pack.standard_nar.martyr_action_ids.iter())
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let direct_kill_causes = pack
        .standard_nar
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    for &action_id in &intercept_sources {
        let Some(cause) = pack.standard_nar.intercept_cause_policy.get(action_id) else {
            panic!(
                "invalid standard_nar intercept cause policy: intercept action `{action_id}` must declare intercept cause"
            );
        };
        if cause.trim().is_empty() {
            panic!(
                "invalid standard_nar intercept cause policy: intercept action `{action_id}` must declare non-empty intercept cause"
            );
        }
        if direct_kill_causes.contains(cause.as_str()) {
            panic!(
                "invalid standard_nar intercept cause policy: intercept action `{action_id}` cause `{cause}` must not reuse a direct kill cause"
            );
        }
    }
    for source in pack.standard_nar.intercept_cause_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid standard_nar intercept cause policy: intercept source id must not be empty"
            );
        }
        if !intercept_sources.contains(source.as_str()) {
            panic!(
                "invalid standard_nar intercept cause policy: unknown intercept source `{source}`"
            );
        }
    }
}

fn require_standard_nar_guard_retaliation_cause_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let intercept_sources = pack
        .standard_nar
        .bodyguard_action_ids
        .iter()
        .chain(pack.standard_nar.martyr_action_ids.iter())
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let kill_causes = pack
        .standard_nar
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    for (source, cause) in &pack.standard_nar.guard_retaliation_cause_policy {
        if source.trim().is_empty() {
            panic!(
                "invalid standard_nar guard retaliation cause policy: source id must not be empty"
            );
        }
        if !intercept_sources.contains(source.as_str()) {
            panic!(
                "invalid standard_nar guard retaliation cause policy: source `{source}` must also be an intercept source"
            );
        }
        if cause.trim().is_empty() {
            panic!(
                "invalid standard_nar guard retaliation cause policy: source `{source}` must declare non-empty retaliation cause"
            );
        }
        if !kill_causes.contains(cause.as_str()) {
            panic!(
                "invalid standard_nar guard retaliation cause policy: cause `{cause}` must be declared in kill_cause_ids"
            );
        }
    }
}

fn require_standard_nar_cpr_harm_cause_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let cpr_sources = pack
        .standard_nar
        .cpr_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let direct_kill_causes = pack
        .standard_nar
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    for &action_id in &cpr_sources {
        let Some(cause) = pack.standard_nar.cpr_harm_cause_policy.get(action_id) else {
            panic!(
                "invalid standard_nar CPR harm cause policy: CPR action `{action_id}` must declare harm cause"
            );
        };
        if cause.trim().is_empty() {
            panic!(
                "invalid standard_nar CPR harm cause policy: CPR action `{action_id}` must declare non-empty harm cause"
            );
        }
        if direct_kill_causes.contains(cause.as_str()) {
            panic!(
                "invalid standard_nar CPR harm cause policy: CPR action `{action_id}` cause `{cause}` must not reuse a direct kill cause"
            );
        }
    }
    for source in pack.standard_nar.cpr_harm_cause_policy.keys() {
        if source.trim().is_empty() {
            panic!("invalid standard_nar CPR harm cause policy: CPR source id must not be empty");
        }
        if !cpr_sources.contains(source.as_str()) {
            panic!("invalid standard_nar CPR harm cause policy: unknown CPR source `{source}`");
        }
    }
}

fn require_standard_nar_guard_dependency_cause_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
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
        .standard_nar
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    for &action_id in &guard_sources {
        let Some(cause) = pack
            .standard_nar
            .guard_dependency_cause_policy
            .get(action_id)
        else {
            panic!(
                "invalid standard_nar guard dependency cause policy: guard dependency action `{action_id}` must declare dependency cause"
            );
        };
        if cause.trim().is_empty() {
            panic!(
                "invalid standard_nar guard dependency cause policy: guard dependency action `{action_id}` must declare non-empty dependency cause"
            );
        }
        if direct_kill_causes.contains(cause.as_str()) {
            panic!(
                "invalid standard_nar guard dependency cause policy: guard dependency action `{action_id}` cause `{cause}` must not reuse a direct kill cause"
            );
        }
    }
    for source in pack.standard_nar.guard_dependency_cause_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid standard_nar guard dependency cause policy: guard dependency source id must not be empty"
            );
        }
        if !guard_sources.contains(source.as_str()) {
            panic!(
                "invalid standard_nar guard dependency cause policy: unknown guard dependency source `{source}`"
            );
        }
    }
}

fn require_standard_nar_block_action_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let declared_blocks = pack
        .standard_nar
        .block_action_ids
        .iter()
        .chain(pack.standard_nar.jailkeep_action_ids.iter())
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
                "invalid standard_nar block action policy: Block action `{}` must be declared in block_action_ids or jailkeep_action_ids",
                action.id
            );
        }
    }
}

fn require_standard_nar_protect_action_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let declared_protects = pack
        .standard_nar
        .protect_action_ids
        .iter()
        .chain(pack.standard_nar.bodyguard_action_ids.iter())
        .chain(pack.standard_nar.martyr_action_ids.iter())
        .chain(pack.standard_nar.cpr_action_ids.iter())
        .chain(pack.standard_nar.jailkeep_action_ids.iter())
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
                "invalid standard_nar protect action policy: Protect action `{}` must be declared in protect_action_ids, bodyguard_action_ids, martyr_action_ids, cpr_action_ids, or jailkeep_action_ids",
                action.id
            );
        }
    }
}

fn require_standard_nar_specialized_protect_action_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let bodyguards = pack
        .standard_nar
        .bodyguard_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let martyrs = pack
        .standard_nar
        .martyr_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let cpr_actions = pack
        .standard_nar
        .cpr_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let ordinary_protects = pack
        .standard_nar
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
                "invalid standard_nar bodyguard action policy: Bodyguard Protect action `{}` must be declared in bodyguard_action_ids",
                action.id
            );
        }
        if action.has_modifier(Modifier::Martyr) && !martyrs.contains(action.id.as_str()) {
            panic!(
                "invalid standard_nar martyr action policy: Martyr Protect action `{}` must be declared in martyr_action_ids",
                action.id
            );
        }
        if action.has_modifier(Modifier::Cpr)
            && action.has_ability(IrAbility::Kill)
            && !cpr_actions.contains(action.id.as_str())
        {
            panic!(
                "invalid standard_nar CPR action policy: CPR Protect+Kill action `{}` must be declared in cpr_action_ids",
                action.id
            );
        }
        if action.has_modifier(Modifier::Babysitter)
            && !ordinary_protects.contains(action.id.as_str())
        {
            panic!(
                "invalid standard_nar babysitter action policy: Babysitter Protect action `{}` must be declared in protect_action_ids",
                action.id
            );
        }
    }
}

fn require_standard_nar_action_bucket_shapes(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    require_standard_nar_action_bucket_shape(
        pack,
        "block_action_ids",
        &pack.standard_nar.block_action_ids,
        "block",
        "Block",
        |action| action.has_ability(IrAbility::Block),
    );
    require_standard_nar_action_bucket_shape(
        pack,
        "protect_action_ids",
        &pack.standard_nar.protect_action_ids,
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
    require_standard_nar_action_bucket_shape(
        pack,
        "kill_action_ids",
        &pack.standard_nar.kill_action_ids,
        "kill",
        "Kill without Strongman/Cpr",
        |action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Kill)
                && !action.has_modifier(Modifier::Strongman)
                && !action.has_modifier(Modifier::Cpr)
        },
    );
    require_standard_nar_action_bucket_shape(
        pack,
        "bodyguard_action_ids",
        &pack.standard_nar.bodyguard_action_ids,
        "bodyguard",
        "Protect with Bodyguard",
        |action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Protect)
                && action.has_modifier(Modifier::Bodyguard)
        },
    );
    require_standard_nar_action_bucket_shape(
        pack,
        "martyr_action_ids",
        &pack.standard_nar.martyr_action_ids,
        "martyr",
        "Protect with Martyr",
        |action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Protect)
                && action.has_modifier(Modifier::Martyr)
        },
    );
    require_standard_nar_action_bucket_shape(
        pack,
        "cpr_action_ids",
        &pack.standard_nar.cpr_action_ids,
        "CPR",
        "Protect plus Kill with Cpr",
        |action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Protect)
                && action.has_ability(IrAbility::Kill)
                && action.has_modifier(Modifier::Cpr)
        },
    );
    require_standard_nar_action_bucket_shape(
        pack,
        "jailkeep_action_ids",
        &pack.standard_nar.jailkeep_action_ids,
        "jailkeep",
        "Block plus Protect",
        |action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Block)
                && action.has_ability(IrAbility::Protect)
        },
    );
    require_standard_nar_action_bucket_shape(
        pack,
        "strongman_action_ids",
        &pack.standard_nar.strongman_action_ids,
        "strongman",
        "Kill with Strongman",
        |action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Kill)
                && action.has_modifier(Modifier::Strongman)
        },
    );
}

fn require_standard_nar_team_kill_action_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let mut seen = BTreeSet::new();
    for action_id in &pack.standard_nar.team_kill_action_ids {
        if action_id.trim().is_empty() {
            panic!("invalid standard_nar team kill action policy: team_kill_action_ids contains empty value");
        }
        if !seen.insert(action_id.as_str()) {
            panic!(
                "invalid standard_nar team kill action policy: team_kill_action_ids contains duplicate value `{action_id}`"
            );
        }
        let Some(action) = standard_nar_pack_action(pack, action_id) else {
            panic!(
                "invalid standard_nar team kill action policy: team_kill_action_ids entry `{action_id}` references unknown action"
            );
        };
        if !action.window.is_night_resolution_window() || !action.has_ability(IrAbility::Kill) {
            panic!(
                "invalid standard_nar team kill action policy: team_kill_action_ids entry `{action_id}` must be a night/any Kill action"
            );
        }
        if !pack
            .standard_nar
            .kill_action_ids
            .iter()
            .any(|kill_id| kill_id == action_id)
        {
            panic!(
                "invalid standard_nar team kill action policy: team_kill_action_ids entry `{action_id}` must also be declared in kill_action_ids"
            );
        }
    }

    for (role_key, role) in &pack.roles {
        if !role.has_modifier(RoleModifier::Lost) && !role.has_modifier(RoleModifier::Recluse) {
            continue;
        }
        if role.alignment.as_deref() != Some("mafia") {
            panic!(
                "invalid standard_nar team kill action policy: team-kill restricted role `{role_key}` must be mafia-aligned"
            );
        }
        if pack.standard_nar.team_kill_action_ids.is_empty() {
            panic!(
                "invalid standard_nar team kill action policy: team-kill restricted role `{role_key}` requires team_kill_action_ids"
            );
        }
        if !role.actions.iter().any(|action| {
            pack.standard_nar
                .team_kill_action_ids
                .iter()
                .any(|team_kill| team_kill == &action.id)
        }) {
            panic!(
                "invalid standard_nar team kill action policy: team-kill restricted role `{role_key}` must expose a team kill action"
            );
        }
    }
}

fn require_standard_nar_action_bucket_shape(
    pack: &Pack,
    bucket_name: &str,
    action_ids: &[String],
    policy_label: &str,
    expected_shape: &str,
    matches_shape: impl Fn(&ActionTemplate) -> bool,
) {
    if action_ids.is_empty() {
        panic!(
            "invalid standard_nar {policy_label} action policy: enabled standard_nar policy must declare {bucket_name}"
        );
    }
    let mut seen = BTreeSet::new();
    for action_id in action_ids {
        if action_id.trim().is_empty() {
            panic!(
                "invalid standard_nar {policy_label} action policy: {bucket_name} id must not be empty"
            );
        }
        if !seen.insert(action_id.as_str()) {
            panic!(
                "invalid standard_nar {policy_label} action policy: {bucket_name} contains duplicate value `{action_id}`"
            );
        }
        let Some(action) = standard_nar_pack_action(pack, action_id) else {
            panic!(
                "invalid standard_nar {policy_label} action policy: {bucket_name} entry `{action_id}` references unknown action"
            );
        };
        if !action.window.is_night_resolution_window() || !matches_shape(action) {
            panic!(
                "invalid standard_nar {policy_label} action policy: {bucket_name} entry `{action_id}` must be a night/any {expected_shape} action"
            );
        }
    }
}

fn standard_nar_pack_action<'a>(pack: &'a Pack, action_id: &str) -> Option<&'a ActionTemplate> {
    pack.roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .find(|action| action.id == action_id)
}

fn require_standard_nar_jailkeep_action_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let block_ids = pack
        .standard_nar
        .block_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let protect_ids = pack
        .standard_nar
        .protect_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    for action_id in &pack.standard_nar.jailkeep_action_ids {
        if !block_ids.contains(action_id.as_str()) {
            panic!(
                "invalid standard_nar jailkeep action policy: Jailkeeper action `{action_id}` must also be declared in block_action_ids"
            );
        }
        if !protect_ids.contains(action_id.as_str()) {
            panic!(
                "invalid standard_nar jailkeep action policy: Jailkeeper action `{action_id}` must also be declared in protect_action_ids"
            );
        }
    }
}

fn require_standard_nar_kill_action_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
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
            .standard_nar
            .cpr_action_ids
            .iter()
            .any(|action_id| action_id == &action.id)
        {
            continue;
        }
        let declared = pack
            .standard_nar
            .kill_action_ids
            .iter()
            .chain(pack.standard_nar.strongman_action_ids.iter())
            .any(|action_id| action_id == &action.id);
        if !declared {
            panic!(
                "invalid standard_nar kill action policy: Kill action `{}` must be declared in kill_action_ids or strongman_action_ids",
                action.id
            );
        }
    }
}

fn require_standard_nar_strongman_action_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let declared_strongman_kills = pack
        .standard_nar
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
                "invalid standard_nar strongman action policy: Strongman Kill action `{}` must be declared in strongman_action_ids",
                action.id
            );
        }
    }
}

fn require_standard_nar_kill_cause_catalog(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    if pack.standard_nar.kill_cause_ids.is_empty() {
        panic!(
            "invalid standard_nar kill cause catalog: enabled standard_nar policy must declare kill_cause_ids"
        );
    }
    let expected = standard_nar_derived_kill_cause_ids(pack);
    let mut declared = BTreeSet::new();
    for cause in &pack.standard_nar.kill_cause_ids {
        if cause.trim().is_empty() {
            panic!("invalid standard_nar kill cause catalog: kill cause id must not be empty");
        }
        if !declared.insert(cause.as_str()) {
            panic!("invalid standard_nar kill cause catalog: duplicate kill cause `{cause}`");
        }
        if !expected.contains(cause.as_str()) {
            panic!("invalid standard_nar kill cause catalog: unknown kill cause `{cause}`");
        }
    }
    for cause in expected {
        if !declared.contains(cause.as_str()) {
            panic!(
                "invalid standard_nar kill cause catalog: kill_cause_ids must include `{cause}`"
            );
        }
    }
}

fn standard_nar_derived_kill_cause_ids(pack: &Pack) -> BTreeSet<String> {
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
                    .standard_nar
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
        pack.standard_nar
            .guard_retaliation_cause_policy
            .values()
            .cloned(),
    );
    causes
}

fn require_standard_nar_chosen_retaliation_cause_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
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
            .standard_nar
            .chosen_retaliation_cause_policy
            .get(action_id)
        else {
            panic!(
                "invalid standard_nar chosen retaliation cause policy: Retaliate action `{action_id}` must declare chosen retaliation cause policy"
            );
        };
        let action_is_strongman = action.has_modifier(Modifier::Strongman);
        if policy.strongman_bypasses_protect != action_is_strongman {
            panic!(
                "invalid standard_nar chosen retaliation cause policy: Retaliate action `{action_id}` strongman_bypasses_protect must match Strongman modifier"
            );
        }
    }
    for source in pack.standard_nar.chosen_retaliation_cause_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid standard_nar chosen retaliation cause policy: Retaliate source id must not be empty"
            );
        }
        if !retaliation_sources.contains_key(source.as_str()) {
            panic!(
                "invalid standard_nar chosen retaliation cause policy: unknown Retaliate action `{source}`"
            );
        }
    }
}

fn require_standard_nar_generated_kill_cause_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
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
            .standard_nar
            .generated_kill_cause_policy
            .get(trigger_id)
        else {
            panic!(
                "invalid standard_nar generated kill cause policy: generated kill trigger `{trigger_id}` must declare generated kill cause policy"
            );
        };
        if policy.on.is_none() {
            panic!(
                "invalid standard_nar generated kill cause policy: generated kill trigger `{trigger_id}` must declare trigger on"
            );
        }
        if policy.on != Some(trigger.on) {
            panic!(
                "invalid standard_nar generated kill cause policy: generated kill trigger `{trigger_id}` on must match trigger rule"
            );
        }
        if policy.actor.is_none() {
            panic!(
                "invalid standard_nar generated kill cause policy: generated kill trigger `{trigger_id}` must declare produced actor"
            );
        }
        if policy.actor != Some(trigger.produces.actor) {
            panic!(
                "invalid standard_nar generated kill cause policy: generated kill trigger `{trigger_id}` actor must match trigger production"
            );
        }
        if policy.target.is_none() {
            panic!(
                "invalid standard_nar generated kill cause policy: generated kill trigger `{trigger_id}` must declare produced target"
            );
        }
        if policy.target != Some(trigger.produces.target) {
            panic!(
                "invalid standard_nar generated kill cause policy: generated kill trigger `{trigger_id}` target must match trigger production"
            );
        }
        let trigger_is_strongman = trigger.produces.modifiers.contains(&Modifier::Strongman);
        if policy.strongman_bypasses_protect != trigger_is_strongman {
            panic!(
                "invalid standard_nar generated kill cause policy: generated kill trigger `{trigger_id}` strongman_bypasses_protect must match produced Strongman modifier"
            );
        }
    }
    for source in pack.standard_nar.generated_kill_cause_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid standard_nar generated kill cause policy: generated kill trigger id must not be empty"
            );
        }
        if !generated_sources.contains_key(source.as_str()) {
            panic!(
                "invalid standard_nar generated kill cause policy: unknown generated kill trigger `{source}`"
            );
        }
    }
}

fn require_standard_nar_generated_kill_ownership(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }

    let generated_triggers = standard_nar_generated_kill_triggers(pack);
    if generated_triggers.is_empty() {
        return;
    }

    let kill_causes = pack
        .standard_nar
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let protect_sources = standard_nar_protect_source_ids(pack);
    let save_tags = standard_nar_target_state_save_tags(pack);
    let block_sources = standard_nar_block_source_ids(pack);
    let generated_trigger_feeds = standard_nar_generated_trigger_feed_actions(pack);

    for trigger in generated_triggers {
        let trigger_id = trigger.id.as_str();
        if !kill_causes.contains(trigger_id) {
            panic!(
                "invalid standard_nar generated kill ownership: generated kill trigger `{trigger_id}` is missing from kill_cause_ids"
            );
        }

        for protect_source in &protect_sources {
            let Some(policy) = pack
                .standard_nar
                .protection_cause_policy
                .get(*protect_source)
            else {
                continue;
            };
            if !standard_nar_blocks_bypasses_contains(&policy.blocks, &policy.bypasses, trigger_id)
            {
                panic!(
                    "invalid standard_nar generated kill ownership: generated kill trigger `{trigger_id}` is not owned by protection source `{protect_source}`"
                );
            }
        }

        for save_tag in &save_tags {
            let Some(policy) = pack.standard_nar.target_state_save_policy.get(*save_tag) else {
                continue;
            };
            if !standard_nar_blocks_bypasses_contains(&policy.blocks, &policy.bypasses, trigger_id)
            {
                panic!(
                    "invalid standard_nar generated kill ownership: generated kill trigger `{trigger_id}` is not owned by target-state save `{save_tag}`"
                );
            }
        }

        for block_source in &block_sources {
            let Some(policy) = pack.standard_nar.suppression_policy.get(*block_source) else {
                continue;
            };
            for (action_id, trigger_ids) in &generated_trigger_feeds {
                if !trigger_ids.contains(trigger_id) {
                    continue;
                }
                if !standard_nar_suppression_contains(policy, action_id) {
                    panic!(
                        "invalid standard_nar generated kill ownership: generated kill trigger `{trigger_id}` feeder action `{action_id}` is not owned by block source `{block_source}`"
                    );
                }
            }
        }
    }
}

fn require_standard_nar_kill_cause_classifiers(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let kill_causes = pack
        .standard_nar
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if kill_causes.is_empty() {
        return;
    }

    for protect_source in standard_nar_protect_source_ids(pack) {
        let Some(policy) = pack
            .standard_nar
            .protection_cause_policy
            .get(protect_source)
        else {
            panic!(
                "invalid standard_nar protection cause policy: protection source `{protect_source}` must classify every kill cause"
            );
        };
        for cause in &kill_causes {
            if !standard_nar_blocks_bypasses_contains(&policy.blocks, &policy.bypasses, cause) {
                panic!(
                    "invalid standard_nar protection cause policy: protection source `{protect_source}` does not classify kill cause `{cause}`"
                );
            }
        }
    }

    for save_tag in standard_nar_target_state_save_tags(pack) {
        let Some(policy) = pack.standard_nar.target_state_save_policy.get(save_tag) else {
            panic!(
                "invalid standard_nar target-state save policy: target-state save `{save_tag}` must classify every kill cause"
            );
        };
        for cause in &kill_causes {
            if !standard_nar_blocks_bypasses_contains(&policy.blocks, &policy.bypasses, cause) {
                panic!(
                    "invalid standard_nar target-state save policy: target-state save `{save_tag}` does not classify kill cause `{cause}`"
                );
            }
        }
    }
}

fn standard_nar_strongman_bypass_cause_ids(pack: &Pack) -> BTreeSet<&str> {
    let mut causes = pack
        .standard_nar
        .strongman_action_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    causes.extend(
        pack.standard_nar
            .chosen_retaliation_cause_policy
            .iter()
            .filter(|(_, policy)| policy.strongman_bypasses_protect)
            .map(|(cause, _)| cause.as_str()),
    );
    causes.extend(
        pack.standard_nar
            .generated_kill_cause_policy
            .iter()
            .filter(|(_, policy)| policy.strongman_bypasses_protect)
            .map(|(cause, _)| cause.as_str()),
    );
    causes
}

fn require_standard_nar_strongman_bypass_classifiers(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let strongman_causes = standard_nar_strongman_bypass_cause_ids(pack);
    if strongman_causes.is_empty() {
        return;
    }

    for protect_source in standard_nar_protect_source_ids(pack) {
        let Some(policy) = pack
            .standard_nar
            .protection_cause_policy
            .get(protect_source)
        else {
            continue;
        };
        for cause in &policy.blocks {
            if strongman_causes.contains(cause.as_str()) {
                panic!(
                    "invalid standard_nar protection cause policy: strongman bypass cause `{cause}` must be classified in bypasses"
                );
            }
        }
        for cause in &policy.bypasses {
            if !strongman_causes.contains(cause.as_str()) {
                panic!(
                    "invalid standard_nar protection cause policy: bypassed kill cause `{cause}` must be a Strongman bypass cause"
                );
            }
        }
    }

    for save_tag in standard_nar_target_state_save_tags(pack) {
        let Some(policy) = pack.standard_nar.target_state_save_policy.get(save_tag) else {
            continue;
        };
        for cause in &policy.blocks {
            if strongman_causes.contains(cause.as_str()) {
                panic!(
                    "invalid standard_nar target-state save policy: strongman bypass cause `{cause}` must be classified in bypasses"
                );
            }
        }
        for cause in &policy.bypasses {
            if !strongman_causes.contains(cause.as_str()) {
                panic!(
                    "invalid standard_nar target-state save policy: bypassed kill cause `{cause}` must be a Strongman bypass cause"
                );
            }
        }
    }
}

fn require_standard_nar_suppression_classifiers(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let night_actions = standard_nar_night_action_roleblockability(pack);
    if night_actions.is_empty() {
        return;
    }

    for block_source in standard_nar_block_source_ids(pack) {
        let Some(policy) = pack.standard_nar.suppression_policy.get(block_source) else {
            panic!(
                "invalid standard_nar suppression policy: Block action `{block_source}` must classify every night action"
            );
        };
        if policy.scope.is_none() {
            panic!(
                "invalid standard_nar suppression policy: Block action `{block_source}` must declare suppression scope"
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
                    "invalid standard_nar suppression policy: block source `{block_source}` does not classify night action `{action_id}`"
                );
            }
            if policy.scope == Some(SuppressionScope::FirstMatchingAction) {
                if suppresses && (!action.roleblockable || action.strong_willed) {
                    panic!(
                        "invalid standard_nar suppression policy: suppression-immune action `{action_id}` must be classified in bypasses"
                    );
                }
                if bypasses && action.roleblockable && !action.strong_willed {
                    panic!(
                        "invalid standard_nar suppression policy: roleblockable action `{action_id}` must be classified in suppresses"
                    );
                }
            }
            if suppresses && bypasses {
                panic!(
                    "invalid standard_nar suppression policy: night action `{action_id}` cannot be both suppressed and bypassed"
                );
            }
        }
    }
}

fn require_valid_night_ability_order(pack: &Pack) {
    let _ = night_ability_order(pack)
        .unwrap_or_else(|err| panic!("invalid pack precedence for night resolution: {err}"));
}

fn require_standard_nar_suppression_precedence(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let abilities = standard_nar_night_ability_set(pack);
    if !abilities.contains(&IrAbility::Block) {
        return;
    }
    let edges = standard_nar_precedence_edges(pack, &abilities);
    let action_abilities = standard_nar_night_action_abilities(pack);

    for block_source in standard_nar_block_source_ids(pack) {
        let Some(policy) = pack.standard_nar.suppression_policy.get(block_source) else {
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
                    && !standard_nar_has_precedence_path(IrAbility::Block, *ability, &edges)
                {
                    panic!(
                        "invalid standard_nar suppression policy: block source `{block_source}` suppresses action `{action_id}` but standard_nar suppression policy requires Block precedence before suppressed ability `{ability:?}`"
                    );
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct StandardNarNightAction {
    roleblockable: bool,
    strong_willed: bool,
}

fn standard_nar_night_action_roleblockability(
    pack: &Pack,
) -> BTreeMap<&str, StandardNarNightAction> {
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
        let record = StandardNarNightAction {
            roleblockable: action.constraints.roleblockable,
            strong_willed: action.has_modifier(Modifier::StrongWilled),
        };
        if let Some(existing) = actions.insert(action.id.as_str(), record) {
            if existing.roleblockable != record.roleblockable
                || existing.strong_willed != record.strong_willed
            {
                panic!(
                    "invalid standard_nar suppression policy: night action `{}` has inconsistent suppression traits",
                    action.id
                );
            }
        }
    }
    actions
}

fn standard_nar_night_action_abilities(pack: &Pack) -> BTreeMap<&str, BTreeSet<IrAbility>> {
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
            .extend(standard_nar_night_order_abilities(action));
    }
    actions
}

fn standard_nar_night_ability_set(pack: &Pack) -> BTreeSet<IrAbility> {
    standard_nar_night_action_abilities(pack)
        .into_values()
        .flatten()
        .collect()
}

fn standard_nar_night_order_abilities(action: &ActionTemplate) -> Vec<IrAbility> {
    action
        .abilities()
        .filter(|ability| !(action.has_modifier(Modifier::Cpr) && *ability == IrAbility::Kill))
        .collect()
}

fn standard_nar_precedence_edges(
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

fn standard_nar_has_precedence_path(
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

fn standard_nar_generated_kill_triggers(pack: &Pack) -> Vec<&TriggerRule> {
    pack.triggers
        .iter()
        .filter(|trigger| trigger.produces.ability == IrAbility::Kill)
        .collect()
}

fn standard_nar_protect_source_ids(pack: &Pack) -> BTreeSet<&str> {
    pack.standard_nar
        .protect_action_ids
        .iter()
        .chain(pack.standard_nar.bodyguard_action_ids.iter())
        .chain(pack.standard_nar.martyr_action_ids.iter())
        .chain(pack.standard_nar.cpr_action_ids.iter())
        .chain(pack.standard_nar.jailkeep_action_ids.iter())
        .map(String::as_str)
        .collect()
}

fn standard_nar_block_source_ids(pack: &Pack) -> BTreeSet<&str> {
    pack.standard_nar
        .block_action_ids
        .iter()
        .chain(pack.standard_nar.jailkeep_action_ids.iter())
        .map(String::as_str)
        .collect()
}

fn standard_nar_generated_trigger_feed_actions(pack: &Pack) -> BTreeMap<&str, BTreeSet<&str>> {
    let generated_triggers = standard_nar_generated_kill_triggers(pack);
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

fn standard_nar_blocks_bypasses_contains(
    blocks: &[String],
    bypasses: &[String],
    cause: &str,
) -> bool {
    blocks.iter().any(|item| item == cause) || bypasses.iter().any(|item| item == cause)
}

fn standard_nar_suppression_contains(
    policy: &crate::pack::SuppressionPolicy,
    action_id: &str,
) -> bool {
    policy.suppresses.iter().any(|item| item == action_id)
        || policy.bypasses.iter().any(|item| item == action_id)
}

fn require_standard_nar_trigger_fixpoint_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let generated_sources = pack
        .triggers
        .iter()
        .filter(|trigger| trigger.produces.ability == IrAbility::Kill)
        .map(|trigger| (trigger.id.as_str(), trigger))
        .collect::<BTreeMap<_, _>>();
    for (&trigger_id, trigger) in &generated_sources {
        let Some(policy) = pack.standard_nar.trigger_fixpoint_policy.get(trigger_id) else {
            panic!(
                "invalid standard_nar trigger fixpoint policy: generated kill trigger `{trigger_id}` must declare trigger fixpoint policy"
            );
        };
        if policy.on.is_none() {
            panic!(
                "invalid standard_nar trigger fixpoint policy: trigger `{trigger_id}` must declare observed trigger on"
            );
        }
        if policy.on != Some(trigger.on) {
            panic!(
                "invalid standard_nar trigger fixpoint policy: trigger `{trigger_id}` on must match trigger rule"
            );
        }
        if !policy.produced_kill_reenters {
            panic!(
                "invalid standard_nar trigger fixpoint policy: generated kill trigger `{trigger_id}` must declare produced_kill_reenters true"
            );
        }
        if policy.loop_cap.is_none() {
            panic!(
                "invalid standard_nar trigger fixpoint policy: trigger `{trigger_id}` must declare loop_cap policy"
            );
        }
        if policy.loop_cap != Some(TriggerLoopCapPolicy::RedirectLoopCap) {
            panic!(
                "invalid standard_nar trigger fixpoint policy: trigger `{trigger_id}` loop_cap must use RedirectLoopCap"
            );
        }
        if !policy.trace {
            panic!(
                "invalid standard_nar trigger fixpoint policy: trigger `{trigger_id}` must declare trace true"
            );
        }
    }
    for source in pack.standard_nar.trigger_fixpoint_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid standard_nar trigger fixpoint policy: trigger fixpoint source id must not be empty"
            );
        }
        if !generated_sources.contains_key(source.as_str()) {
            panic!(
                "invalid standard_nar trigger fixpoint policy: unknown trigger fixpoint source `{source}`"
            );
        }
    }
}

fn require_standard_nar_hide_dependency_cause_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
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
        .standard_nar
        .kill_cause_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    for &action_id in &hide_sources {
        let Some(cause) = pack
            .standard_nar
            .hide_dependency_cause_policy
            .get(action_id)
        else {
            panic!(
                "invalid standard_nar hide dependency cause policy: hide dependency action `{action_id}` must declare dependency cause"
            );
        };
        if cause.trim().is_empty() {
            panic!(
                "invalid standard_nar hide dependency cause policy: hide dependency action `{action_id}` must declare non-empty dependency cause"
            );
        }
        if direct_kill_causes.contains(cause.as_str()) {
            panic!(
                "invalid standard_nar hide dependency cause policy: hide dependency action `{action_id}` cause `{cause}` must not reuse a direct kill cause"
            );
        }
    }
    for source in pack.standard_nar.hide_dependency_cause_policy.keys() {
        if source.trim().is_empty() {
            panic!(
                "invalid standard_nar hide dependency cause policy: hide dependency source id must not be empty"
            );
        }
        if !hide_sources.contains(source.as_str()) {
            panic!(
                "invalid standard_nar hide dependency cause policy: unknown hide dependency source `{source}`"
            );
        }
    }
}

fn standard_nar_target_state_gate_tags(pack: &Pack) -> BTreeSet<&str> {
    if pack.standard_nar.enabled {
        return pack
            .standard_nar
            .target_state_gate_tags
            .iter()
            .map(String::as_str)
            .collect();
    }
    standard_nar_derived_target_state_gate_tags(pack)
}

fn standard_nar_derived_target_state_gate_tags(pack: &Pack) -> BTreeSet<&str> {
    let mut tags = BTreeSet::new();
    for role in pack.roles.values() {
        for effect in &role.effects {
            record_standard_nar_target_state_gate_tag(&mut tags, effect);
        }
        for action in &role.actions {
            if let Some(effect) = action.effect.as_deref() {
                record_standard_nar_target_state_gate_tag(&mut tags, effect);
            }
        }
    }
    for effect in pack.effects.keys() {
        record_standard_nar_target_state_gate_tag(&mut tags, effect);
    }
    tags
}

fn record_standard_nar_target_state_gate_tag<'a>(tags: &mut BTreeSet<&'a str>, effect: &'a str) {
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

fn cooldown_counter_id(template_id: &str) -> String {
    format!("cooldown:{template_id}")
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
            && counter.phase_kind == input.state.phase_kind
            && input.state.phase_number
                <= counter
                    .phase_number
                    .saturating_add(u32::from(cooldown_cycles))
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
    counter_use_counted(
        &input.phase_id,
        input.state.phase_kind,
        input.state.phase_number,
        action_counter_id(&template_id),
        actor,
        template_id,
        action_id,
        "x_shot".to_string(),
        "game".to_string(),
        limit,
        used,
    )
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
        phase_kind: input.state.phase_kind,
        phase_number: input.state.phase_number,
    }
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
        phase_kind: input.state.phase_kind,
        phase_number: input.state.phase_number,
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
        phase_kind: input.state.phase_kind,
        phase_number: input.state.phase_number,
    }
}

fn counter_use_counted(
    phase_id: &PhaseId,
    phase_kind: PhaseKind,
    phase_number: u32,
    counter_id: String,
    actor: SlotId,
    template_id: String,
    consumed_action: String,
    cadence_policy: String,
    phase_scope: String,
    limit: u16,
    used: u16,
) -> InnerEvent {
    InnerEvent::ActionUseCounted {
        counter_id,
        actor,
        template_id,
        consumed_action,
        cadence_policy,
        phase_scope,
        limit,
        used,
        remaining: limit.saturating_sub(used),
        phase_id: phase_id.clone(),
        phase_kind,
        phase_number,
    }
}

fn phase_parity_matches(phase_number: u32, parity: PhaseParity) -> bool {
    match parity {
        PhaseParity::Odd => phase_number % 2 == 1,
        PhaseParity::Even => phase_number % 2 == 0,
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
        phase_kind: Some(input.state.phase_kind),
        phase_number: Some(input.state.phase_number),
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
    });
}

fn has_history_sensitive_modifier(action: &Action<'_>) -> bool {
    action.template.has_modifier(Modifier::NonConsecutive)
        || action.template.has_modifier(Modifier::Indecisive)
        || action.template.has_modifier(Modifier::Roaming)
        || action.template.has_modifier(Modifier::Compulsive)
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
            record.phase_kind == PhaseKind::Night
        } else {
            record.phase_kind == PhaseKind::Night
                && record.phase_number + 1 == input.state.phase_number
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
    let unique: std::collections::BTreeSet<&str> =
        action.targets.iter().map(String::as_str).collect();
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
    actions: &mut [Action],
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
        let tied_targets: Vec<SlotId> = votes
            .iter()
            .filter_map(|(target, indices)| (indices.len() == max_votes).then_some(target.clone()))
            .collect();

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
        .standard_nar
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
                phase_kind: input.state.phase_kind,
                phase_number: input.state.phase_number,
                status: "missing".to_string(),
            });
        }
    }
}

fn apply_action_constraints(
    input: &ResolutionInput,
    actions: &mut [Action],
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    let audience = alive_slot_ids(input);
    let mut base_role_submissions_seen: BTreeSet<(String, String)> = BTreeSet::new();
    for action in actions {
        if action.blocked {
            continue;
        }

        if base_role_submission(action) {
            let key = (action.sub.actor.clone(), action.template.id.clone());
            if !action.template.has_modifier(Modifier::Simultaneous)
                && !base_role_submissions_seen.insert(key)
            {
                action.blocked = true;
                events.push(InnerEvent::ActionInterfered {
                    actor: action.sub.actor.clone(),
                    reason: "duplicate_submission".to_string(),
                });
                continue;
            }
        }

        if let Some(reason) = target_shape_error(action) {
            action.blocked = true;
            events.push(InnerEvent::ActionInterfered {
                actor: action.sub.actor.clone(),
                reason: reason.to_string(),
            });
            continue;
        }

        if duplicate_target_error(action) {
            action.blocked = true;
            events.push(InnerEvent::ActionInterfered {
                actor: action.sub.actor.clone(),
                reason: "duplicate_target".to_string(),
            });
            continue;
        }

        if self_target_error(action) {
            action.blocked = true;
            events.push(InnerEvent::ActionInterfered {
                actor: action.sub.actor.clone(),
                reason: "self_target".to_string(),
            });
            continue;
        }

        if personal_target_error(action) {
            action.blocked = true;
            events.push(InnerEvent::ActionInterfered {
                actor: action.sub.actor.clone(),
                reason: "personal".to_string(),
            });
            continue;
        }

        if target_role_filter_error(input, action) {
            action.blocked = true;
            events.push(InnerEvent::ActionInterfered {
                actor: action.sub.actor.clone(),
                reason: "invalid_target_role".to_string(),
            });
            continue;
        }

        if disloyal_target_error(input, action) {
            action.blocked = true;
            trace_decisions.push(DecisionTrace {
                stage: "night:action_constraints".to_string(),
                source: format!("action:{}", action.sub.action_id),
                outcome: "action_suppressed".to_string(),
                detail: serde_json::json!({
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
            action.blocked = true;
            events.push(InnerEvent::ActionInterfered {
                actor: action.sub.actor.clone(),
                reason: "lazy".to_string(),
            });
            continue;
        }

        if disabled_endgame_error(input, action) {
            action.blocked = true;
            events.push(InnerEvent::ActionInterfered {
                actor: action.sub.actor.clone(),
                reason: "disabled_endgame".to_string(),
            });
            continue;
        }

        if role_modifier_team_kill_error(input, action) {
            action.blocked = true;
            events.push(InnerEvent::ActionInterfered {
                actor: action.sub.actor.clone(),
                reason: role_modifier_team_kill_reason(input, action).to_string(),
            });
            continue;
        }

        if let Some(parity) = action.template.constraints.phase_parity {
            if !phase_parity_matches(input.state.phase_number, parity) {
                action.blocked = true;
                events.push(InnerEvent::ActionInterfered {
                    actor: action.sub.actor.clone(),
                    reason: match parity {
                        PhaseParity::Odd => "odd_night".to_string(),
                        PhaseParity::Even => "even_night".to_string(),
                    },
                });
                continue;
            }
        }

        if let Some(parity) = action.template.constraints.cycle_parity {
            if !phase_parity_matches(input.state.phase_number, parity) {
                action.blocked = true;
                events.push(InnerEvent::ActionInterfered {
                    actor: action.sub.actor.clone(),
                    reason: match parity {
                        PhaseParity::Odd => "odd_cycle".to_string(),
                        PhaseParity::Even => "even_cycle".to_string(),
                    },
                });
                continue;
            }
        }

        if let Some(reason) = activation_gate_reason(
            action.template,
            input.state.phase_kind,
            input.state.phase_number,
        ) {
            action.blocked = true;
            events.push(InnerEvent::ActionInterfered {
                actor: action.sub.actor.clone(),
                reason: reason.to_string(),
            });
            continue;
        }

        if let Some(reason) = repeated_target_limiter_reason(input, action) {
            action.blocked = true;
            events.push(InnerEvent::ActionInterfered {
                actor: action.sub.actor.clone(),
                reason: reason.to_string(),
            });
            continue;
        }

        if let Some(limit) = action.template.constraints.x_shots {
            if action_counter_exhausted(input, &action.sub.actor, &action.template.id, limit) {
                action.blocked = true;
                events.push(InnerEvent::ActionInterfered {
                    actor: action.sub.actor.clone(),
                    reason: "x_shot_exhausted".to_string(),
                });
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
                action.blocked = true;
                events.push(InnerEvent::ActionInterfered {
                    actor: action.sub.actor.clone(),
                    reason: "cooldown".to_string(),
                });
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
            });
        }
        if action.template.has_modifier(Modifier::Announcing) {
            events.push(InnerEvent::EffectNotification {
                effect: "announcing".to_string(),
                status: action.template.id.clone(),
                audience: audience.clone(),
            });
        }
    }
}

fn record_history_sensitive_actions(
    input: &ResolutionInput,
    actions: &[Action<'_>],
    events: &mut Vec<InnerEvent>,
) {
    for action in actions {
        if !has_history_sensitive_modifier(action) {
            continue;
        }
        events.push(InnerEvent::ActionRecorded {
            actor: action.sub.actor.clone(),
            template_id: action.template.id.clone(),
            targets: action.targets.clone(),
            phase_id: input.phase_id.clone(),
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
            status: if action.blocked {
                "suppressed"
            } else {
                "resolved"
            }
            .to_string(),
        });
    }
}

/// Resolve a window's submissions into the full deterministic resolver output.
pub fn resolve(input: ResolutionInput) -> ResolutionOutput {
    let inner = resolve_inner(&input);
    finalize_resolution(input, inner)
}

/// Resolve command-time Instant submissions into the same validated envelope shape
/// as ordinary phase resolution. Instant actions are not replayed by
/// `resolve_inner`; callers must pass only the instant submissions being committed.
pub fn resolve_instant(input: ResolutionInput) -> ResolutionOutput {
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

fn finalize_resolution(input: ResolutionInput, mut inner: InnerResolution) -> ResolutionOutput {
    let mut events = inner.events;
    apply_treestump_policy(&input, &mut events, &mut inner.trace_decisions);
    let mut post_state = apply_events(&input.state, &events);
    if !has_win_reached(&events) {
        if let Some(win) = check_win(&post_state, &input.pack) {
            apply_win_triggers_before_final(
                &input,
                &mut events,
                &win,
                &mut inner.trace_decisions,
                &mut inner.trace_notes,
            );
            post_state = apply_events(&input.state, &events);
            let final_win = check_win(&post_state, &input.pack).unwrap_or(win);
            events.push(final_win);
            post_state = apply_events(&input.state, &events);
        }
    }

    let applied = wrap_resolution(&input, events);
    let trace = build_trace(
        &applied,
        inner.trace_edges,
        inner.trace_decisions,
        inner.trace_notes,
    );
    crate::events::validate_resolution_applied(&applied, RESULT_VERSION)
        .expect("resolver must produce a valid ResolutionApplied envelope");
    crate::events::validate_resolution_trace(&trace, crate::events::TRACE_VERSION)
        .expect("resolver must produce a valid ResolutionTrace envelope");

    ResolutionOutput {
        applied,
        trace,
        post_state,
    }
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
    let policy = &input.pack.treestump_policy;
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
                    detail: serde_json::json!({
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

/// Compatibility helper for callers that still compare only the inner event
/// sequence. New code should use [`resolve`] and persist the full output.
pub fn resolve_events(input: ResolutionInput) -> Vec<InnerEvent> {
    resolve(input)
        .applied
        .events
        .into_iter()
        .map(|indexed| indexed.event)
        .collect()
}

/// Resolve a window's submissions into ordered inner events.
///
/// Canonical inner-event ordering: the phase's own results, then the single
/// trailing `PhaseAnnouncement` (doc 10), then — iff the post-resolution state
/// satisfies a `WinPolicy` rule — a final `WinReached`. Win-check runs **once**,
/// at phase end, on the state produced by folding this resolution's events
/// (`apply_events`); it never runs mid-resolution.
fn resolve_inner(input: &ResolutionInput) -> InnerResolution {
    require_standard_nar_kill_cause_catalog(&input.pack);
    require_standard_nar_specialized_protect_action_policy(&input.pack);
    require_standard_nar_team_kill_action_policy(&input.pack);
    require_standard_nar_action_bucket_shapes(&input.pack);
    require_standard_nar_block_action_policy(&input.pack);
    require_standard_nar_target_state_save_catalog(&input.pack);
    require_standard_nar_target_state_save_policy(&input.pack);
    require_standard_nar_target_state_gate_catalog(&input.pack);
    require_standard_nar_kill_stacking_policy(&input.pack);
    require_standard_nar_strongman_bypass_policy(&input.pack);
    require_standard_nar_protect_action_policy(&input.pack);
    require_standard_nar_protection_cause_policy(&input.pack);
    require_conversion_policy(&input.pack);
    require_standard_nar_strongman_action_policy(&input.pack);
    require_standard_nar_chosen_retaliation_cause_policy(&input.pack);
    require_standard_nar_generated_kill_cause_policy(&input.pack);
    require_standard_nar_suppression_policy_shape(&input.pack);
    require_standard_nar_generated_kill_ownership(&input.pack);
    require_standard_nar_strongman_bypass_classifiers(&input.pack);
    require_standard_nar_kill_cause_classifiers(&input.pack);
    require_standard_nar_trigger_fixpoint_policy(&input.pack);
    let mut events = grant_consumption_events(input);
    let (mut ingest_events, mut ingest_decisions) = invalid_submission_ingest_halts(input);
    events.append(&mut ingest_events);
    let (mut window_events, mut window_decisions) = phase_window_mismatch_halts(input);
    events.append(&mut window_events);
    ingest_decisions.append(&mut window_decisions);
    let mut inner = match input.state.phase_kind {
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
            !(matches!(input.state.phase_kind, PhaseKind::Day | PhaseKind::Twilight)
                && sub.template_id == "day_vote")
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
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
            reason: reason.clone(),
            grant_id: grant_id.clone(),
        });
        decisions.push(DecisionTrace {
            stage: "submission_ingest".to_string(),
            source: format!("action:{}", sub.action_id),
            outcome: "submission_template_rejected".to_string(),
            detail: serde_json::json!({
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
        let Some(reason) = phase_window_mismatch_reason(template.window, input.state.phase_kind)
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
            detail: serde_json::json!({
                "action_id": sub.action_id,
                "actor": sub.actor,
                "template_id": sub.template_id,
                "phase_id": sub.phase_id,
                "phase_kind": input.state.phase_kind,
                "phase_number": input.state.phase_number,
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
        a.phase_number
            .cmp(&b.phase_number)
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
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
            remaining_uses,
        });
        if grant.kind == GrantKind::Item {
            events.push(inventory_use_counted(
                input,
                sub.actor.clone(),
                &grant_id,
                sub.template_id.clone(),
                sub.action_id.clone(),
                declared_grant_uses(&input.pack, &grant_id)
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
        phase_kind: input.state.phase_kind,
        phase_number: input.state.phase_number,
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

fn build_trace(
    applied: &ResolutionApplied,
    trace_edges: Vec<TraceEdge>,
    trace_decisions: Vec<DecisionTrace>,
    trace_notes: Vec<String>,
) -> ResolutionTrace {
    let mut decisions = Vec::new();
    decisions.push(DecisionTrace {
        stage: "result_contract".to_string(),
        source: format!("domain::resolve/result_version:{}", applied.result_version),
        outcome: format!("{} inner events validated", applied.counts.events),
        detail: serde_json::json!({
            "kills": applied.counts.kills,
            "saves": applied.counts.saves,
        }),
    });
    decisions.extend(trace_decisions);

    let mut effect_changes = Vec::new();
    let mut generated = Vec::new();
    let mut notes = Vec::new();

    for indexed in &applied.events {
        let outcome = match &indexed.event {
            InnerEvent::DayVoteOutcome(_) => "day_vote_outcome",
            InnerEvent::DayAnnouncement(note) => {
                notes.push(format!(
                    "day announcement for {} emitted at event_index {}",
                    note.player_id, indexed.index
                ));
                "day_announcement"
            }
            InnerEvent::LastWordsRecorded(note) => {
                notes.push(format!(
                    "last words for {} recorded at event_index {}",
                    note.player_id, indexed.index
                ));
                "last_words_recorded"
            }
            InnerEvent::HostPromptIssued(note) => {
                let prompt_id = &note.prompt_id;
                let kind = &note.kind;
                notes.push(format!(
                    "host prompt {prompt_id} ({kind}) emitted at event_index {}",
                    indexed.index
                ));
                "host_prompt_issued"
            }
            InnerEvent::PlayerKilled { .. } => "player_killed",
            InnerEvent::SlotStatusTagged {
                slot_id,
                tag,
                source,
            } => {
                effect_changes.push(EffectDeltaTrace {
                    effect: tag.clone(),
                    target: slot_id.clone(),
                    operation: "status_tag".to_string(),
                    detail: serde_json::json!({
                        "source": source,
                        "event_index": indexed.index,
                    }),
                });
                "slot_status_tagged"
            }
            InnerEvent::PlayerSaved { .. } => "player_saved",
            InnerEvent::PlayerConverted { .. } => "player_converted",
            InnerEvent::ConversionBlocked { .. } => "conversion_blocked",
            InnerEvent::EffectsMarked {
                effect,
                target,
                actor,
                source_action,
                phase_id,
                phase_kind,
                phase_number,
                duration,
                visibility,
            } => {
                effect_changes.push(EffectDeltaTrace {
                    effect: effect.clone(),
                    target: target.clone(),
                    operation: "mark".to_string(),
                    detail: serde_json::json!({
                        "actor": actor,
                        "event_index": indexed.index,
                        "source_action": source_action,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "duration": duration,
                        "visibility": visibility,
                    }),
                });
                "effects_marked"
            }
            InnerEvent::EffectsCleared {
                effect,
                targets,
                actor,
            } => {
                for target in targets {
                    effect_changes.push(EffectDeltaTrace {
                        effect: effect.clone(),
                        target: target.clone(),
                        operation: "clear".to_string(),
                        detail: serde_json::json!({
                            "actor": actor,
                            "event_index": indexed.index
                        }),
                    });
                }
                "effects_cleared"
            }
            InnerEvent::ActionGranted {
                grant_id,
                kind,
                actor,
                target,
                source_action,
                uses,
                vote_weight,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                generated.push(GeneratedActionTrace {
                    action_id: grant_id.clone(),
                    source: "ActionGranted".to_string(),
                    actor: actor.clone(),
                    targets: vec![target.clone()],
                    detail: serde_json::json!({
                        "kind": kind,
                        "source_action": source_action,
                        "uses": uses,
                        "vote_weight": vote_weight,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "event_index": indexed.index,
                    }),
                });
                "action_granted"
            }
            InnerEvent::ActionGrantConsumed {
                grant_id,
                actor,
                action_id,
                source_action,
                phase_id,
                phase_kind,
                phase_number,
                remaining_uses,
            } => {
                generated.push(GeneratedActionTrace {
                    action_id: action_id.clone(),
                    source: "ActionGrantConsumed".to_string(),
                    actor: actor.clone(),
                    targets: Vec::new(),
                    detail: serde_json::json!({
                        "grant_id": grant_id,
                        "source_action": source_action,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "remaining_uses": remaining_uses,
                        "event_index": indexed.index,
                    }),
                });
                "action_grant_consumed"
            }
            InnerEvent::BadgeChanged {
                badge_id,
                owner,
                previous_owner,
                vote_weight,
                actor,
                source_action,
                reason,
                destroyed,
                ..
            } => {
                notes.push(format!(
                    "badge {badge_id} changed at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: source_action.clone(),
                    source: "BadgeChanged".to_string(),
                    actor: actor.clone(),
                    targets: owner.clone().into_iter().collect(),
                    detail: serde_json::json!({
                        "badge_id": badge_id,
                        "previous_owner": previous_owner,
                        "vote_weight": vote_weight,
                        "reason": reason,
                        "destroyed": destroyed,
                        "event_index": indexed.index,
                    }),
                });
                "badge_changed"
            }
            InnerEvent::DuelResolved {
                knight,
                target,
                result,
                killed,
                source_action,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                notes.push(format!(
                    "duel {source_action} resolved at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: source_action.clone(),
                    source: "DuelResolved".to_string(),
                    actor: knight.clone(),
                    targets: vec![target.clone()],
                    detail: serde_json::json!({
                        "result": result,
                        "killed": killed,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "event_index": indexed.index,
                    }),
                });
                "duel_resolved"
            }
            InnerEvent::WolfSelfDestructed {
                wolf_id,
                target_id,
                cause,
                unstoppable,
                source_action,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                notes.push(format!(
                    "wolf self-destruct {source_action} resolved at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: source_action.clone(),
                    source: "WolfSelfDestructed".to_string(),
                    actor: wolf_id.clone(),
                    targets: vec![target_id.clone()],
                    detail: serde_json::json!({
                        "cause": cause,
                        "unstoppable": unstoppable,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "event_index": indexed.index,
                    }),
                });
                "wolf_self_destructed"
            }
            InnerEvent::WolfCarryQueued {
                owner_id,
                token_id,
                cause,
                role_key,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                notes.push(format!(
                    "wolf carry token {token_id} queued for {owner_id} at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: token_id.clone(),
                    source: "WolfCarryQueued".to_string(),
                    actor: owner_id.clone(),
                    targets: Vec::new(),
                    detail: serde_json::json!({
                        "cause": cause,
                        "role_key": role_key,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "event_index": indexed.index,
                    }),
                });
                "wolf_carry_queued"
            }
            InnerEvent::WolfCarryUsed {
                owner_id,
                target_id,
                source_action_id,
                effect_id,
                role_key,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                notes.push(format!(
                    "wolf carry {source_action_id} used by {owner_id} at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: source_action_id.clone(),
                    source: "WolfCarryUsed".to_string(),
                    actor: owner_id.clone(),
                    targets: vec![target_id.clone()],
                    detail: serde_json::json!({
                        "effect_id": effect_id,
                        "role_key": role_key,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "event_index": indexed.index,
                    }),
                });
                "wolf_carry_used"
            }
            InnerEvent::WolfBeautyMarked {
                beauty_id,
                target_id,
                effect,
                source_action,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                notes.push(format!(
                    "wolf beauty mark {source_action} recorded at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: source_action.clone(),
                    source: "WolfBeautyMarked".to_string(),
                    actor: beauty_id.clone(),
                    targets: vec![target_id.clone()],
                    detail: serde_json::json!({
                        "effect": effect,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "event_index": indexed.index,
                    }),
                });
                "wolf_beauty_marked"
            }
            InnerEvent::WolfBeautyDragged {
                beauty_id,
                dragged_ids,
                cause,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                notes.push(format!(
                    "wolf beauty drag by {beauty_id} resolved at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: format!("{beauty_id}:wolf_beauty_drag"),
                    source: "WolfBeautyDragged".to_string(),
                    actor: beauty_id.clone(),
                    targets: dragged_ids.clone(),
                    detail: serde_json::json!({
                        "cause": cause,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "event_index": indexed.index,
                    }),
                });
                "wolf_beauty_dragged"
            }
            InnerEvent::ItaSessionOpened {
                session_id,
                label,
                day,
                window,
                status,
                ..
            } => {
                notes.push(format!(
                    "ITA session {session_id} opened at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: session_id.clone(),
                    source: "ItaSessionOpened".to_string(),
                    actor: session_id.clone(),
                    targets: Vec::new(),
                    detail: serde_json::json!({
                        "label": label,
                        "day": day,
                        "window": window,
                        "status": status,
                        "event_index": indexed.index,
                    }),
                });
                "ita_session_opened"
            }
            InnerEvent::ItaSessionLifecycleChanged {
                session_id,
                control,
                from_status,
                to_status,
                message,
                recorded_at,
                ..
            } => {
                notes.push(format!(
                    "ITA session {session_id} lifecycle {from_status}->{to_status} at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: session_id.clone(),
                    source: "ItaSessionLifecycleChanged".to_string(),
                    actor: session_id.clone(),
                    targets: Vec::new(),
                    detail: serde_json::json!({
                        "control": control,
                        "from_status": from_status,
                        "to_status": to_status,
                        "message": message,
                        "recorded_at": recorded_at,
                        "event_index": indexed.index,
                    }),
                });
                "ita_session_lifecycle_changed"
            }
            InnerEvent::ItaSessionAnnouncement {
                session_id,
                status,
                message,
                recorded_at,
                ..
            } => {
                notes.push(format!(
                    "ITA session {session_id} announcement {status} at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: session_id.clone(),
                    source: "ItaSessionAnnouncement".to_string(),
                    actor: session_id.clone(),
                    targets: Vec::new(),
                    detail: serde_json::json!({
                        "status": status,
                        "message": message,
                        "recorded_at": recorded_at,
                        "event_index": indexed.index,
                    }),
                });
                "ita_session_announcement"
            }
            InnerEvent::ItaShotQueued {
                session_id,
                action_id,
                actor,
                targets,
                queue_position,
                queue_length,
                ..
            } => {
                generated.push(GeneratedActionTrace {
                    action_id: action_id.clone(),
                    source: "ItaShotQueued".to_string(),
                    actor: actor.clone(),
                    targets: targets.clone(),
                    detail: serde_json::json!({
                        "session_id": session_id,
                        "queue_position": queue_position,
                        "queue_length": queue_length,
                        "event_index": indexed.index,
                    }),
                });
                "ita_shot_queued"
            }
            InnerEvent::ItaShotBuffered {
                session_id,
                action_id,
                template_id,
                actor_id,
                targets,
                submitted_at,
                release_at,
                delay_ms,
            } => {
                generated.push(GeneratedActionTrace {
                    action_id: action_id.clone(),
                    source: "ItaShotBuffered".to_string(),
                    actor: actor_id.clone(),
                    targets: targets.clone(),
                    detail: serde_json::json!({
                        "session_id": session_id,
                        "template_id": template_id,
                        "submitted_at": submitted_at,
                        "release_at": release_at,
                        "delay_ms": delay_ms,
                        "event_index": indexed.index,
                    }),
                });
                "ita_shot_buffered"
            }
            InnerEvent::ItaShotInvalidated {
                session_id,
                action_id,
                actor_id,
                target_id,
                reason,
                invalidated_by,
                submitted_at,
                timestamp,
            } => {
                generated.push(GeneratedActionTrace {
                    action_id: action_id.clone(),
                    source: "ItaShotInvalidated".to_string(),
                    actor: actor_id.clone(),
                    targets: vec![target_id.clone()],
                    detail: serde_json::json!({
                        "session_id": session_id,
                        "reason": reason,
                        "invalidated_by": invalidated_by,
                        "submitted_at": submitted_at,
                        "timestamp": timestamp,
                        "event_index": indexed.index,
                    }),
                });
                "ita_shot_invalidated"
            }
            InnerEvent::ItaShotResolved {
                session_id,
                action_id,
                actor,
                target,
                outcome,
                hit_chance,
                roll,
                kill,
                shield_before,
                shield_after,
                shield_spent,
                hp_before,
                hp_after,
                protection_path,
                ..
            } => {
                let mut detail = serde_json::json!({
                    "session_id": session_id,
                    "outcome": outcome,
                    "hit_chance": hit_chance,
                    "roll": roll,
                    "kill": kill,
                    "event_index": indexed.index,
                });
                if shield_before.is_some() || shield_after.is_some() || *shield_spent {
                    detail["shield_before"] = serde_json::json!(shield_before);
                    detail["shield_after"] = serde_json::json!(shield_after);
                    detail["shield_spent"] = serde_json::json!(shield_spent);
                    detail["protection_path"] = serde_json::json!(protection_path);
                }
                if hp_before.is_some() || hp_after.is_some() {
                    detail["hp_before"] = serde_json::json!(hp_before);
                    detail["hp_after"] = serde_json::json!(hp_after);
                    detail["protection_path"] = serde_json::json!(protection_path);
                }
                generated.push(GeneratedActionTrace {
                    action_id: action_id.clone(),
                    source: "ItaShotResolved".to_string(),
                    actor: actor.clone(),
                    targets: vec![target.clone()],
                    detail,
                });
                "ita_shot_resolved"
            }
            InnerEvent::ItaShotRefunded {
                session_id,
                action_id,
                actor_id,
                target_id,
                reason,
                policy,
                hit_chance,
                roll,
                hp_before,
                hp_after,
                protection_path,
                submitted_at,
                timestamp,
                counters,
            } => {
                generated.push(GeneratedActionTrace {
                    action_id: action_id.clone(),
                    source: "ItaShotRefunded".to_string(),
                    actor: actor_id.clone(),
                    targets: vec![target_id.clone()],
                    detail: serde_json::json!({
                        "session_id": session_id,
                        "reason": reason,
                        "policy": policy,
                        "hit_chance": hit_chance,
                        "roll": roll,
                        "hp_before": hp_before,
                        "hp_after": hp_after,
                        "protection_path": protection_path,
                        "submitted_at": submitted_at,
                        "timestamp": timestamp,
                        "counters": counters,
                        "event_index": indexed.index,
                    }),
                });
                "ita_shot_refunded"
            }
            InnerEvent::ItaSessionUpdated {
                session_id,
                queue_length,
                shots_resolved,
                global_shots_fired,
                ..
            } => {
                notes.push(format!(
                    "ITA session {session_id} updated at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: session_id.clone(),
                    source: "ItaSessionUpdated".to_string(),
                    actor: session_id.clone(),
                    targets: Vec::new(),
                    detail: serde_json::json!({
                        "queue_length": queue_length,
                        "shots_resolved": shots_resolved,
                        "global_shots_fired": global_shots_fired,
                        "event_index": indexed.index,
                    }),
                });
                "ita_session_updated"
            }
            InnerEvent::ItaSessionClosed {
                session_id,
                last_status,
                ..
            } => {
                notes.push(format!(
                    "ITA session {session_id} closed at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: session_id.clone(),
                    source: "ItaSessionClosed".to_string(),
                    actor: session_id.clone(),
                    targets: Vec::new(),
                    detail: serde_json::json!({
                        "last_status": last_status,
                        "event_index": indexed.index,
                    }),
                });
                "ita_session_closed"
            }
            InnerEvent::InvestigationResult { .. } => "investigation_result",
            InnerEvent::InfoResult { .. } => "info_result",
            InnerEvent::InvestigationMemoryRecorded { .. } => "investigation_memory_recorded",
            InnerEvent::AlignmentRevealed { .. } => "alignment_revealed",
            InnerEvent::RoleRevealed { .. } => "role_revealed",
            InnerEvent::VoteDuelDeclared { .. } => "vote_duel_declared",
            InnerEvent::VoteVetoed {
                governor,
                target,
                source_action,
                ..
            } => {
                notes.push(format!(
                    "vote veto by {governor} saved {target} at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: source_action.clone(),
                    source: "VoteVetoed".to_string(),
                    actor: governor.clone(),
                    targets: vec![target.clone()],
                    detail: serde_json::json!({
                        "event_index": indexed.index,
                    }),
                });
                "vote_vetoed"
            }
            InnerEvent::ActionIngestHalted { .. } => "action_ingest_halted",
            InnerEvent::ActionInterfered { .. } => "action_interfered",
            InnerEvent::ActionUseCounted { .. } => "action_use_counted",
            InnerEvent::ActionRecorded { .. } => "action_recorded",
            InnerEvent::PlayersLinked { .. } => "players_linked",
            InnerEvent::RetaliationArmed { .. } => "retaliation_armed",
            InnerEvent::BackupTargeted { .. } => "backup_targeted",
            InnerEvent::TargetLynchWinTargeted { .. } => "target_lynch_win_targeted",
            InnerEvent::DelayedDeathQueued { .. } => "delayed_death_queued",
            InnerEvent::DelayedDeathResolved { .. } => "delayed_death_resolved",
            InnerEvent::VisitRecorded { .. } => "visit_recorded",
            InnerEvent::Trigger {
                trigger_id,
                payload,
            } => {
                notes.push(format!(
                    "trigger {trigger_id} emitted at event_index {}",
                    indexed.index
                ));
                let actor = payload
                    .get("produced_actor")
                    .and_then(|value| value.as_str())
                    .unwrap_or(trigger_id)
                    .to_string();
                let targets = payload
                    .get("produced_target")
                    .and_then(|value| value.as_str())
                    .map(|target| vec![target.to_string()])
                    .unwrap_or_default();
                generated.push(GeneratedActionTrace {
                    action_id: trigger_id.clone(),
                    source: "Trigger".to_string(),
                    actor,
                    targets,
                    detail: serde_json::json!({
                        "on": payload.get("on").cloned().unwrap_or(serde_json::Value::Null),
                        "source_target": payload.get("source_target").cloned().unwrap_or(serde_json::Value::Null),
                        "source_actor": payload.get("source_actor").cloned().unwrap_or(serde_json::Value::Null),
                        "source_cause": payload.get("source_cause").cloned().unwrap_or(serde_json::Value::Null),
                        "produced_actor": payload.get("produced_actor").cloned().unwrap_or(serde_json::Value::Null),
                        "produced_target": payload.get("produced_target").cloned().unwrap_or(serde_json::Value::Null),
                        "actor_filter": payload.get("actor_filter").cloned().unwrap_or(serde_json::Value::Null),
                        "event_index": indexed.index,
                    }),
                });
                "trigger"
            }
            InnerEvent::WinReached { metadata, .. } => {
                if let Some(awards) = metadata
                    .get("survival_awards")
                    .and_then(|value| value.as_array())
                {
                    for award in awards {
                        let source = award
                            .get("slot_id")
                            .and_then(|value| value.as_str())
                            .map(|slot_id| format!("slot:{slot_id}"))
                            .unwrap_or_else(|| format!("event_index:{}", indexed.index));
                        decisions.push(DecisionTrace {
                            stage: "win:survival".to_string(),
                            source,
                            outcome: "survival_win_awarded".to_string(),
                            detail: award.clone(),
                        });
                    }
                }
                "win_reached"
            }
            InnerEvent::DayVoteRecorded { .. } => "day_vote_recorded",
            InnerEvent::PhaseAnnouncement(_) => "phase_announcement",
            InnerEvent::EffectNotification { .. } => "effect_notification",
        };
        decisions.push(DecisionTrace {
            stage: "inner_event".to_string(),
            source: format!("event_index:{}", indexed.index),
            outcome: outcome.to_string(),
            detail: serde_json::Value::Null,
        });
    }
    notes.extend(trace_notes);

    ResolutionTrace {
        phase_id: applied.phase_id.clone(),
        run_id: applied.run_id.clone(),
        trace_version: crate::events::TRACE_VERSION,
        edges: trace_edges,
        generated,
        effect_changes,
        visibility: Vec::new(),
        decisions,
        notes,
    }
}

/// Evaluate the pack's `WinPolicy` against a (post-resolution) state. Rules are
/// tried in order; the FIRST match wins and yields a `WinReached`. Returns
/// `None` if no rule fires. PURE: a fold over alive-counts, no clock/RNG.
pub fn check_win(state: &StateSnapshot, pack: &Pack) -> Option<InnerEvent> {
    require_win_families(pack);
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

fn survival_win_metadata(state: &StateSnapshot, pack: &Pack) -> serde_json::Value {
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
            awards.push(serde_json::json!({
                "policy": award.id,
                "winner": award.winner,
                "slot_id": slot.slot_id,
                "role": slot.role_key,
                "source_event": source_event,
            }));
        }
    }
    if awards.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::json!({ "survival_awards": awards })
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
                detail: serde_json::json!({
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
                phase_kind: input.state.phase_kind,
                phase_number: input.state.phase_number,
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
                detail: serde_json::json!({
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
                phase_kind: input.state.phase_kind,
                phase_number: input.state.phase_number,
            });
            continue;
        }
        trace_decisions.push(DecisionTrace {
            stage: "night:pending_effect".to_string(),
            source: format!("delayed_death:{}", queued.queue_id),
            outcome: "pending_poison_applied".to_string(),
            detail: serde_json::json!({
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
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
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
    if !input.pack.backup_policy.enabled {
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
            phase_kind,
            phase_number,
        } = event
        {
            backup_targets.retain(|record| record.backup != *backup);
            backup_targets.push(BackupTargetRecord {
                backup: backup.clone(),
                source_target: source_target.clone(),
                source_role: source_role.clone(),
                source_action: source_action.clone(),
                phase_id: phase_id.clone(),
                phase_kind: *phase_kind,
                phase_number: *phase_number,
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
                                "target_phase_kind": record.phase_kind,
                                "target_phase_number": record.phase_number,
                            }),
                        )
                    })
            });
        let passive = backup.effects.iter().find_map(|effect| {
            let role = backup_role(&input.pack.backup_policy, effect)?;
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
        let Some((source, inherited_role, policy, policy_detail)) = targeted.or(passive) else {
            continue;
        };
        if backup.role_key == inherited_role {
            continue;
        }
        let new_alignment = input
            .pack
            .roles
            .get(&inherited_role)
            .and_then(|role| role.alignment.clone());
        trace_decisions.push(DecisionTrace {
            stage: "night:backup".to_string(),
            source: format!("slot:{source}"),
            outcome: "backup_inherited_role".to_string(),
            detail: serde_json::json!({
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
    let pack = &input.pack;
    require_conversion_policy(pack);
    require_visibility_families(pack);
    require_ninja_visibility_policy(pack);
    require_standard_nar_kill_cause_catalog(pack);
    require_standard_nar_specialized_protect_action_policy(pack);
    require_standard_nar_team_kill_action_policy(pack);
    require_standard_nar_action_bucket_shapes(pack);
    require_standard_nar_intercept_cause_policy(pack);
    require_standard_nar_guard_retaliation_cause_policy(pack);
    require_standard_nar_cpr_harm_cause_policy(pack);
    require_standard_nar_guard_dependency_cause_policy(pack);
    require_standard_nar_block_action_policy(pack);
    require_standard_nar_protect_action_policy(pack);
    require_standard_nar_jailkeep_action_policy(pack);
    require_standard_nar_strongman_action_policy(pack);
    require_standard_nar_kill_action_policy(pack);
    require_standard_nar_chosen_retaliation_cause_policy(pack);
    require_standard_nar_protection_cause_policy(pack);
    require_standard_nar_action_chance_policy(pack);
    require_standard_nar_suppression_policy_shape(pack);
    require_standard_nar_generated_kill_ownership(pack);
    require_standard_nar_strongman_bypass_classifiers(pack);
    require_standard_nar_kill_cause_classifiers(pack);
    require_standard_nar_hide_dependency_cause_policy(pack);
    require_standard_nar_trigger_fixpoint_policy(pack);
    require_standard_nar_target_state_save_catalog(pack);
    require_standard_nar_target_state_save_policy(pack);
    require_standard_nar_target_state_gate_catalog(pack);
    require_standard_nar_target_state_gate_policy(pack);
    require_standard_nar_conflict_families(pack);
    require_standard_nar_kill_stacking_policy(pack);
    require_standard_nar_strongman_bypass_policy(pack);
    require_standard_nar_suppression_classifiers(pack);
    require_valid_night_ability_order(pack);
    require_standard_nar_suppression_precedence(pack);

    // Build the action list from non-withdrawn submissions, resolving each to
    // its role's action template. Submissions whose template can't be found are
    // dropped (the platform owns submission legality; the engine is total).
    let mut actions: Vec<Action> = Vec::new();
    for sub in &input.submissions {
        if sub.withdrawn {
            continue;
        }
        let Some(template) = lookup_submission_template(input, sub) else {
            continue;
        };
        if !phase_window_matches(template.window, input.state.phase_kind) {
            continue;
        }
        actions.push(Action {
            sub,
            template,
            targets: sub.targets.clone(),
            blocked: false,
        });
    }

    let mut events: Vec<InnerEvent> = Vec::new();
    let mut trace_edges: Vec<TraceEdge> = Vec::new();
    let mut trace_decisions: Vec<DecisionTrace> = Vec::new();
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

    emit_missing_compulsive_actions(input, &actions, &mut events);
    apply_faction_action_coordination(input, &mut actions, &mut events);
    apply_action_constraints(input, &mut actions, &mut events, &mut trace_decisions);

    let stage_order = night_ability_order(pack)
        .unwrap_or_else(|err| panic!("invalid pack precedence for night resolution: {err}"));
    trace_decisions.push(DecisionTrace {
        stage: "night:stage_order".to_string(),
        source: "pack.precedence".to_string(),
        outcome: "pack_derived_stage_order".to_string(),
        detail: serde_json::json!({
            "order": stage_order
                .iter()
                .map(|stage| format!("{stage:?}"))
                .collect::<Vec<_>>(),
        }),
    });
    for stage in stage_order {
        match stage {
            IrAbility::Block => {
                // Block is a pack-priority/precedence stage: once resolved, it
                // suppresses pack-classified actions before later stages inspect them.
                let mut block_sources: BTreeMap<SlotId, Vec<BlockSource>> = BTreeMap::new();
                for idx in ability_order(&actions, IrAbility::Block) {
                    if actions[idx].blocked
                        || !standard_nar_block_participates(pack, actions[idx].template)
                    {
                        continue;
                    }
                    for t in &actions[idx].targets {
                        block_sources
                            .entry(t.clone())
                            .or_default()
                            .push(BlockSource {
                                actor: actions[idx].sub.actor.clone(),
                                source_action_id: actions[idx].sub.action_id.clone(),
                                template_id: actions[idx].template.id.clone(),
                            });
                    }
                }
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
                            let scope = standard_nar_block_suppression_scope(
                                pack,
                                source,
                                action.template,
                            )?;
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
                                consumed_first_match_sources.insert((
                                    action.sub.actor.clone(),
                                    source.source_action_id.clone(),
                                ));
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
                let block_candidate_idxs = block_candidates
                    .iter()
                    .map(|(idx, _)| *idx)
                    .collect::<BTreeSet<_>>();
                empowered_slots = collect_empowered_slots(&actions, pack, &block_candidate_idxs);

                let mut newly_blocked: Vec<(SlotId, String, String, Vec<BlockSource>)> = Vec::new();
                for (idx, sources) in block_candidates {
                    if empowered_slots.contains(&actions[idx].sub.actor) {
                        trace_decisions.push(DecisionTrace {
                            stage: "night:block".to_string(),
                            source: "standard_nar.empower_effects".to_string(),
                            outcome: "action_suppression_bypassed".to_string(),
                            detail: serde_json::json!({
                                "actor": actions[idx].sub.actor,
                                "action_id": actions[idx].sub.action_id,
                                "template_id": actions[idx].template.id,
                                "empower_effects": pack.standard_nar.empower_effects.clone(),
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
                        detail: serde_json::json!({
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
            }
            IrAbility::Redirect => {
                // Redirect rewrites target maps before later target-reading stages.
                if empowered_slots.is_empty() {
                    let blocked_idxs = actions
                        .iter()
                        .enumerate()
                        .filter_map(|(idx, action)| action.blocked.then_some(idx))
                        .collect::<BTreeSet<_>>();
                    empowered_slots = collect_empowered_slots(&actions, pack, &blocked_idxs);
                }
                let redirect_rules = build_redirect_rules(&actions, pack);
                if redirect_rules.truncated {
                    trace_notes.push(format!(
                        "redirect loop_cap ({}) reached; truncating redirect graph rules",
                        pack.redirects.loop_cap
                    ));
                }
                if !redirect_rules.rules.is_empty() {
                    for action in &mut actions {
                        if action.blocked {
                            continue;
                        }
                        if action.has_ability(IrAbility::Kill)
                            || action.has_ability(IrAbility::Protect)
                            || action.has_ability(IrAbility::Convert)
                            || action.has_ability(IrAbility::Grant)
                            || action.has_ability(IrAbility::Link)
                            || action.has_ability(IrAbility::Retaliate)
                            || action.has_ability(IrAbility::Visit)
                            || action.has_ability(IrAbility::Investigate)
                        {
                            let action_id = action.sub.action_id.clone();
                            let template_id = action.template.id.clone();
                            let actor = action.sub.actor.clone();
                            if empowered_slots.contains(&actor) {
                                let would_redirect = action.targets.iter().any(|target| {
                                    apply_redirect_rules(
                                        target,
                                        &redirect_rules.rules,
                                        pack.redirects.loop_cap,
                                    )
                                    .target
                                        != *target
                                });
                                if would_redirect {
                                    trace_decisions.push(DecisionTrace {
                                        stage: "night:redirect".to_string(),
                                        source: "standard_nar.empower_effects".to_string(),
                                        outcome: "action_redirect_bypassed".to_string(),
                                        detail: serde_json::json!({
                                            "actor": actor,
                                            "action_id": action_id,
                                            "template_id": template_id,
                                            "targets": action.targets.clone(),
                                            "empower_effects": pack.standard_nar.empower_effects.clone(),
                                        }),
                                    });
                                }
                                continue;
                            }
                            for (target_index, t) in action.targets.iter_mut().enumerate() {
                                let original = t.clone();
                                let applied = apply_redirect_rules(
                                    &original,
                                    &redirect_rules.rules,
                                    pack.redirects.loop_cap,
                                );
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
                                *t = applied.target;
                            }
                        }
                    }
                }
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
                        standard_nar_hide_dependency_cause(pack, actions[idx].template);
                    for target in actions[idx].targets.clone() {
                        let tags = target_tags(input, &transient_effects, &target);
                        if let Some(reason) = target_state_gate_reason(pack, &tags, IrAbility::Mark)
                        {
                            emit_action_interfered_by_target_state(
                                &mut trace_decisions,
                                &mut events,
                                &actions[idx],
                                &target,
                                IrAbility::Mark,
                                None,
                                reason,
                                &tags,
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
                        let is_wolf_beauty_mark = input.pack.wolf_beauty.enabled
                            && effect == input.pack.wolf_beauty.mark_effect
                            && slot_role(input, &actor).is_some_and(|role| {
                                input
                                    .pack
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
                                    phase_kind: input.state.phase_kind,
                                    phase_number: input.state.phase_number,
                                });
                            }
                            if is_wolf_beauty_mark {
                                events.push(InnerEvent::WolfBeautyMarked {
                                    beauty_id: actor.clone(),
                                    target_id: marked_target.clone(),
                                    effect: effect.clone(),
                                    source_action: actions[idx].sub.action_id.clone(),
                                    phase_id: input.phase_id.clone(),
                                    phase_kind: input.state.phase_kind,
                                    phase_number: input.state.phase_number,
                                });
                                wolf_beauty_marks.retain(|record| record.beauty_id != actor);
                                wolf_beauty_marks.push(WolfBeautyMarkRecord {
                                    beauty_id: actor.clone(),
                                    target_id: marked_target,
                                    effect: effect.clone(),
                                    source_action: actions[idx].sub.action_id.clone(),
                                    phase_id: input.phase_id.clone(),
                                    phase_kind: input.state.phase_kind,
                                    phase_number: input.state.phase_number,
                                });
                            }
                            if input.pack.backup_policy.enabled
                                && effect == input.pack.backup_policy.targeted_effect
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
                                        phase_kind: input.state.phase_kind,
                                        phase_number: input.state.phase_number,
                                    });
                                }
                            }
                        }
                        if let Some(actor_role) = slot_role(input, &actor) {
                            for policy in &input.pack.target_lynch_win_policies {
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
                                        phase_kind: input.state.phase_kind,
                                        phase_number: input.state.phase_number,
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
                    let Some(grant) =
                        selected_grant_for_submission(actions[idx].template, actions[idx].sub)
                            .cloned()
                    else {
                        continue;
                    };
                    let actor = actions[idx].sub.actor.clone();
                    for target in actions[idx].targets.clone() {
                        events.push(InnerEvent::ActionGranted {
                            grant_id: grant.grant_id.clone(),
                            kind: grant.kind,
                            actor: actor.clone(),
                            target: target.clone(),
                            source_action: actions[idx].sub.action_id.clone(),
                            uses: grant.uses,
                            vote_weight: grant.vote_weight,
                            phase_id: input.phase_id.clone(),
                            phase_kind: input.state.phase_kind,
                            phase_number: input.state.phase_number,
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
                    let policy = &input.pack.lover_policy;
                    if policy.enabled
                        && policy.lovers_known_to_each_other
                        && actions[idx].template.effect.as_deref() == Some(&policy.link_effect)
                    {
                        events.push(InnerEvent::EffectNotification {
                            effect: policy.link_effect.clone(),
                            status: actions[idx].sub.action_id.clone(),
                            audience: slots,
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
                            phase_kind: input.state.phase_kind,
                            phase_number: input.state.phase_number,
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
                            result: serde_json::Value::Object(result),
                            source_action: actions[idx].sub.action_id.clone(),
                            template_id: actions[idx].template.id.clone(),
                            phase_id: input.phase_id.clone(),
                            phase_kind: input.state.phase_kind,
                            phase_number: input.state.phase_number,
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
                        || !standard_nar_protect_participates(pack, actions[idx].template)
                    {
                        continue;
                    }
                    let actor = actions[idx].sub.actor.clone();
                    let intercept_cause = standard_nar_intercept_cause(pack, actions[idx].template);
                    let guard_retaliation_cause =
                        standard_nar_guard_retaliation_cause(pack, actions[idx].template);
                    let cpr_harm_cause = standard_nar_cpr_harm_cause(pack, actions[idx].template);
                    let guard_dependency_cause =
                        standard_nar_guard_dependency_cause(pack, actions[idx].template);
                    for t in actions[idx].targets.clone() {
                        let tags = target_tags(input, &transient_effects, &t);
                        if let Some(reason) =
                            target_state_gate_reason(pack, &tags, IrAbility::Protect)
                        {
                            emit_action_interfered_by_target_state(
                                &mut trace_decisions,
                                &mut events,
                                &actions[idx],
                                &t,
                                IrAbility::Protect,
                                None,
                                reason,
                                &tags,
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
                apply_guard_witch_same_target_policy(
                    input,
                    &protections,
                    &mut killed,
                    &mut kill_log,
                    &mut events,
                    &mut trace_decisions,
                );
            }
            IrAbility::Kill => {
                let strongman_bypasses_protect = protect_beats_kill_unless_strongman(pack);
                for idx in ability_order(&actions, IrAbility::Kill) {
                    if actions[idx].blocked {
                        continue;
                    }
                    if standard_nar_cpr_harm_cause(pack, actions[idx].template).is_some() {
                        continue;
                    }
                    if !standard_nar_kill_participates(pack, actions[idx].template) {
                        continue;
                    }
                    let cause = actions[idx].template.id.clone();
                    let attacker = actions[idx].sub.actor.clone();
                    let is_strongman = standard_nar_strongman_bypasses(pack, actions[idx].template);
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
                                        detail: serde_json::json!({
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
                        && input.pack.wolf_carry.enabled
                        && targets.len() > 1
                    {
                        let attacker_role = slot_role(input, &attacker);
                        let can_carry = attacker_role.is_some_and(|role| {
                            input
                                .pack
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
                                detail: serde_json::json!({
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
                            pack,
                            &input.phase_id,
                            input.state.phase_kind,
                            input.state.phase_number,
                            &victim,
                            &attacker,
                            &cause,
                            is_strongman && strongman_bypasses_protect,
                            death_reveal_mode(input, &victim, &cause),
                            &protections,
                            &target_tags,
                            &mut cpr_saves,
                            &mut events,
                            &mut killed,
                            &mut kill_log,
                            &mut trace_decisions,
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
                            phase_kind: input.state.phase_kind,
                            phase_number: input.state.phase_number,
                        });
                        let target_tags = target_tags(input, &transient_effects, &target);
                        if let Some(reason) =
                            target_state_gate_reason(pack, &target_tags, IrAbility::Kill)
                        {
                            trace_decisions.push(DecisionTrace {
                                stage: "kill_resolution".to_string(),
                                source: format!("cause:{}", input.pack.wolf_carry.cause),
                                outcome: "kill_skipped_by_target_state".to_string(),
                                detail: serde_json::json!({
                                    "action_id": source_action_id,
                                    "template_id": input.pack.wolf_carry.cause,
                                    "actor": token.owner_id,
                                    "target": target,
                                    "reason": reason,
                                    "target_tags": target_tags,
                                }),
                            });
                            continue;
                        }
                        resolve_one_kill(
                            pack,
                            &input.phase_id,
                            input.state.phase_kind,
                            input.state.phase_number,
                            &target,
                            &token.owner_id,
                            &input.pack.wolf_carry.cause,
                            is_strongman && strongman_bypasses_protect,
                            death_reveal_mode(input, &target, &input.pack.wolf_carry.cause),
                            &protections,
                            &target_tags,
                            &mut cpr_saves,
                            &mut events,
                            &mut killed,
                            &mut kill_log,
                            &mut trace_decisions,
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
                                detail: serde_json::json!({
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
                                        detail: serde_json::json!({
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
                                        detail: serde_json::json!({
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
                                detail: serde_json::json!({
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
                                        detail: serde_json::json!({
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
                            detail: serde_json::json!({
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
                                &actions[idx],
                                &target,
                                IrAbility::Investigate,
                                Some(mode),
                                reason,
                                &tags,
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
                                    let changed = previous
                                        .as_ref()
                                        .map(|previous| {
                                            previous != &serde_json::Value::String(result.clone())
                                        })
                                        .unwrap_or(false);
                                    if memory.is_some_and(|memory| {
                                        memory.output == ResultMemoryOutput::SameDifferent
                                    }) {
                                        if previous.is_some() {
                                            serde_json::Value::String(
                                                if changed { "different" } else { "same" }
                                                    .to_string(),
                                            )
                                        } else {
                                            serde_json::Value::String(visible_result)
                                        }
                                    } else {
                                        serde_json::json!({
                                            "previous": previous,
                                            "current": visible_result,
                                            "changed": changed,
                                        })
                                    }
                                } else {
                                    serde_json::Value::String(visible_result)
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
                                        result: serde_json::Value::String(result.clone()),
                                        source_action: actions[idx].sub.action_id.clone(),
                                        template_id: actions[idx].template.id.clone(),
                                        phase_id: input.phase_id.clone(),
                                        phase_kind: input.state.phase_kind,
                                        phase_number: input.state.phase_number,
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
                                    result: serde_json::json!({
                                        "vanilla": role_set_contains(
                                            &input.pack.investigation_results.role_sets.vanilla_roles,
                                            input,
                                            &target,
                                        ),
                                    }),
                                });
                            }
                            InvestigateMode::Neapolitan => {
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: serde_json::json!({
                                        "vanilla_town": role_set_contains(
                                            &input.pack.investigation_results.role_sets.vanilla_roles,
                                            input,
                                            &target,
                                        ) && matches!(
                                            slot_alignment(input, &target),
                                            Some(alignment) if alignment == "town"
                                        ),
                                    }),
                                });
                            }
                            InvestigateMode::Gunsmith => {
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: serde_json::json!({
                                        "has_gun": role_set_contains(
                                            &input.pack.investigation_results.role_sets.gun_bearing_roles,
                                            input,
                                            &target,
                                        ),
                                    }),
                                });
                            }
                            InvestigateMode::Killer => {
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: serde_json::json!({
                                        "killer": role_set_contains(
                                            &input.pack.investigation_results.role_sets.killer_roles,
                                            input,
                                            &target,
                                        ),
                                    }),
                                });
                            }
                            InvestigateMode::Specialist => {
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: serde_json::json!({
                                        "specialist": role_set_contains(
                                            &input.pack.investigation_results.role_sets.specialist_roles,
                                            input,
                                            &target,
                                        ),
                                    }),
                                });
                            }
                            InvestigateMode::PtAccess => {
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: serde_json::json!({
                                        "pt_access": private_topic_access(input, &target),
                                    }),
                                });
                            }
                            InvestigateMode::Role => {
                                let role = slot_role(input, &target).unwrap_or("");
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: serde_json::json!({
                                        "role": role,
                                    }),
                                });
                            }
                            InvestigateMode::FullRole => {
                                let role = slot_role(input, &target).unwrap_or("");
                                let alignment = slot_alignment(input, &target).unwrap_or("");
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target: target.clone(),
                                    result: serde_json::json!({
                                        "role": role,
                                        "alignment": alignment,
                                    }),
                                });
                            }
                            InvestigateMode::Track => {
                                let visited = tracked_visits(&actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: serde_json::json!({ "visited": visited }),
                                });
                            }
                            InvestigateMode::Watch => {
                                let visitors = watched_visitors(&actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: serde_json::json!({ "visitors": visitors }),
                                });
                            }
                            InvestigateMode::RoleWatcher => {
                                let visitor_roles =
                                    watched_visitor_roles(input, &actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: serde_json::json!({ "visitor_roles": visitor_roles }),
                                });
                            }
                            InvestigateMode::RoleGuard => {
                                let visitor_roles =
                                    watched_visitor_roles(input, &actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: serde_json::json!({ "visitor_roles": visitor_roles }),
                                });
                            }
                            InvestigateMode::SecurityGuard => {
                                let visitors = watched_visitors(&actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: serde_json::json!({ "visitors": visitors }),
                                });
                            }
                            InvestigateMode::Voyeur => {
                                let actions_seen = watched_action_ids(&actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: serde_json::json!({ "actions": actions_seen }),
                                });
                            }
                            InvestigateMode::ActionType => {
                                let action_types =
                                    followed_action_types(&actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: serde_json::json!({ "action_types": action_types }),
                                });
                            }
                            InvestigateMode::Motion => {
                                let active = detected_motion(&actions, idx, &target, pack);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: serde_json::json!({ "motion": active }),
                                });
                            }
                            InvestigateMode::PriorMotion => {
                                let active = prior_detected_motion(input, &target);
                                events.push(InnerEvent::InvestigationResult {
                                    mode,
                                    investigator: investigator.clone(),
                                    target,
                                    result: serde_json::json!({ "prior_motion": active }),
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

    // ── Phase 8: Triggers ── reactive abilities (doc 09). After core resolution,
    // fire every trigger whose `on` event was observed against a slot carrying
    // every tag in `if_target_has`, and resolve the action it `produces`
    // (actor/target chosen per ActorRef/TargetRef). Determinism: observations
    // are processed in event order; a produced kill becomes a new observation and
    // is re-examined, bounded by `redirects.loop_cap` (reused as the trigger loop
    // cap — see note). On reaching the cap the engine pushes a diagnostic note
    // and terminates deterministically.
    let loop_cap = pack.redirects.loop_cap as usize;
    let mut frontier: Vec<TriggerObservation> =
        kill_log.iter().flat_map(kill_observations).collect();
    frontier.extend(visit_observations(&actions));
    frontier.extend(effect_marked_observations);
    frontier.extend(phase_end_observations(input, &killed));
    let mut iterations = 0usize;
    while !frontier.is_empty() {
        if iterations >= loop_cap {
            trace_notes.push(format!(
                "trigger loop_cap ({loop_cap}) reached; terminating trigger fixpoint"
            ));
            break;
        }
        iterations += 1;
        let mut next_kills: Vec<KillRecord> = Vec::new();
        for observation in &frontier {
            for trig in &pack.triggers {
                if trig.on != observation.on {
                    continue;
                }
                if !standard_nar_trigger_participates_in_fixpoint(pack, trig) {
                    continue;
                }
                let Some(target_slot) = input
                    .state
                    .slots
                    .iter()
                    .find(|s| s.slot_id == observation.target)
                else {
                    continue;
                };
                let actor_slot = input
                    .state
                    .slots
                    .iter()
                    .find(|s| s.slot_id == observation.actor);
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
                if trig.produces.ability == IrAbility::Kill {
                    let strongman = standard_nar_generated_kill_bypasses_protect(pack, trig);
                    let target_tags = target_tags(input, &transient_effects, &produced_target);
                    if let Some(reason) =
                        target_state_gate_reason(pack, &target_tags, IrAbility::Kill)
                    {
                        trace_decisions.push(DecisionTrace {
                            stage: "kill_resolution".to_string(),
                            source: format!("cause:{}", trig.id),
                            outcome: "kill_skipped_by_target_state".to_string(),
                            detail: serde_json::json!({
                                "action_id": trig.id,
                                "template_id": trig.id,
                                "actor": produced_actor,
                                "target": produced_target,
                                "reason": reason,
                                "target_tags": target_tags,
                            }),
                        });
                        continue;
                    }
                    resolve_one_kill(
                        pack,
                        &input.phase_id,
                        input.state.phase_kind,
                        input.state.phase_number,
                        &produced_target,
                        &produced_actor,
                        &trig.id,
                        strongman,
                        death_reveal_mode(input, &produced_target, &trig.id),
                        &protections,
                        &target_tags,
                        &mut cpr_saves,
                        &mut events,
                        &mut killed,
                        &mut next_kills,
                        &mut trace_decisions,
                    );
                }
            }
        }
        next_kills.extend(apply_guard_dependency_deaths(
            input,
            &guard_dependencies,
            &mut killed,
            &mut kill_log,
            &mut events,
            &mut trace_decisions,
        ));
        next_kills.extend(apply_hide_dependency_deaths(
            input,
            &hide_dependencies,
            &mut killed,
            &mut kill_log,
            &mut events,
            &mut trace_decisions,
        ));
        frontier = next_kills.iter().flat_map(kill_observations).collect();
    }

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

    record_history_sensitive_actions(input, &actions, &mut events);

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

/// Build ordered target-rewrite rules. Each redirect action contributes rules
/// once, in action order; applying a target through this ordered list composes
/// redirects without re-applying the same action forever.
fn build_redirect_rules(actions: &[Action], pack: &Pack) -> RedirectRules {
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

fn collect_empowered_slots(
    actions: &[Action],
    pack: &Pack,
    blocked_action_idxs: &BTreeSet<usize>,
) -> BTreeSet<SlotId> {
    if pack.standard_nar.empower_effects.is_empty() {
        return BTreeSet::new();
    }

    let empower_effects = pack
        .standard_nar
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

fn redirect_target_space(actions: &[Action]) -> Vec<SlotId> {
    let mut target_space = Vec::new();
    for action in actions {
        if action.blocked || action.has_ability(IrAbility::Redirect) {
            continue;
        }
        if !(action.has_ability(IrAbility::Kill)
            || action.has_ability(IrAbility::Protect)
            || action.has_ability(IrAbility::Convert)
            || action.has_ability(IrAbility::Grant)
            || action.has_ability(IrAbility::Link)
            || action.has_ability(IrAbility::Retaliate)
            || action.has_ability(IrAbility::Visit)
            || action.has_ability(IrAbility::Investigate))
        {
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
        let action_type = action_type_category(&action.template);
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
            .investigation_results
            .parity
            .alignment_results
            .get(alignment)
            .cloned()
            .unwrap_or_else(|| {
                if alignment == "town" {
                    input.pack.investigation_results.parity.town.clone()
                } else {
                    input.pack.investigation_results.parity.non_town.clone()
                }
            }),
        None => input.pack.investigation_results.parity.non_town.clone(),
    };

    if let (Some(slot), Some(overrides)) = (slot, input.pack.investigation_overrides.as_ref()) {
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
    input
        .state
        .private_channels
        .iter()
        .filter(|record| &record.slot_id == target)
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
) -> Option<serde_json::Value> {
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
    if pack.standard_nar.enabled {
        return pack.standard_nar.strongman_bypasses_protect;
    }
    pack.precedence.iter().any(|rule| {
        rule.when.effect == IrAbility::Protect
            && rule.beats.contains(&IrAbility::Kill)
            && rule.unless_modifiers.contains(&Modifier::Strongman)
    })
}

fn standard_nar_block_participates(pack: &Pack, template: &ActionTemplate) -> bool {
    if !pack.standard_nar.enabled {
        return true;
    }
    pack.standard_nar
        .block_action_ids
        .iter()
        .chain(pack.standard_nar.jailkeep_action_ids.iter())
        .any(|action_id| action_id == &template.id)
}

fn standard_nar_block_suppression_scope(
    pack: &Pack,
    source: &BlockSource,
    target: &ActionTemplate,
) -> Option<SuppressionScope> {
    if !pack.standard_nar.enabled {
        return target
            .constraints
            .roleblockable
            .then_some(SuppressionScope::AllMatchingActions);
    }
    pack.standard_nar
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
                            "invalid standard_nar suppression policy: Block action `{}` must declare suppression scope",
                            source.template_id
                        )
                    })
                })
        })
}

fn standard_nar_protect_participates(pack: &Pack, template: &ActionTemplate) -> bool {
    if !pack.standard_nar.enabled {
        return true;
    }
    pack.standard_nar
        .protect_action_ids
        .iter()
        .chain(pack.standard_nar.bodyguard_action_ids.iter())
        .chain(pack.standard_nar.martyr_action_ids.iter())
        .chain(pack.standard_nar.cpr_action_ids.iter())
        .chain(pack.standard_nar.jailkeep_action_ids.iter())
        .any(|action_id| action_id == &template.id)
}

fn action_chance_allows(
    pack: &Pack,
    action: &Action<'_>,
    target: &SlotId,
    rng: &mut DetRng,
    trace_decisions: &mut Vec<DecisionTrace>,
) -> bool {
    let Some(policy) = pack.standard_nar.action_chance.get(&action.template.id) else {
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
        detail: serde_json::json!({
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

fn require_standard_nar_action_chance_policy(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    for (action_id, policy) in &pack.standard_nar.action_chance {
        if action_id.trim().is_empty() {
            panic!("invalid standard_nar action chance policy: action id must not be empty");
        }
        if !policy.chance.is_finite() || !(0.0..=1.0).contains(&policy.chance) {
            panic!(
                "invalid standard_nar action chance policy: action `{action_id}` chance must be finite and between 0.0 and 1.0"
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
                "invalid standard_nar action chance policy: unknown night/any action `{action_id}`"
            );
        }
    }
}

fn require_standard_nar_conflict_families(pack: &Pack) {
    if !pack.standard_nar.enabled {
        return;
    }
    let declared = pack
        .standard_nar
        .conflict_families
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    if declared.len() != pack.standard_nar.conflict_families.len() {
        panic!(
            "invalid standard_nar conflict families: conflict_families must not contain duplicates"
        );
    }
    if declared.is_empty() {
        panic!(
            "invalid standard_nar conflict families: enabled standard_nar policy must declare conflict_families"
        );
    }
    let required = standard_nar_required_conflict_families(pack);
    for family in &required {
        if !declared.contains(family) {
            panic!(
                "invalid standard_nar conflict families: conflict_families must include `{family:?}`"
            );
        }
    }
    for family in &declared {
        if !required.contains(family) {
            panic!(
                "invalid standard_nar conflict families: declared conflict family `{family:?}` has no matching policy surface"
            );
        }
    }
}

fn standard_nar_required_conflict_families(pack: &Pack) -> BTreeSet<StandardNarConflictFamily> {
    let policy = &pack.standard_nar;
    let mut required = BTreeSet::from([
        StandardNarConflictFamily::BlockSuppressesActions,
        StandardNarConflictFamily::ProtectBlocksKills,
        StandardNarConflictFamily::StrongmanBypassesProtect,
        StandardNarConflictFamily::KillStacking,
    ]);
    if !policy.intercept_cause_policy.is_empty()
        || !policy.bodyguard_action_ids.is_empty()
        || !policy.martyr_action_ids.is_empty()
    {
        required.insert(StandardNarConflictFamily::InterceptProtection);
    }
    if !policy.guard_retaliation_cause_policy.is_empty() {
        required.insert(StandardNarConflictFamily::GuardRetaliation);
    }
    if !policy.cpr_action_ids.is_empty() || !policy.cpr_harm_cause_policy.is_empty() {
        required.insert(StandardNarConflictFamily::CprProtection);
    }
    if !policy.guard_dependency_cause_policy.is_empty() {
        required.insert(StandardNarConflictFamily::GuardDependency);
    }
    if !policy.hide_dependency_cause_policy.is_empty() {
        required.insert(StandardNarConflictFamily::HideDependency);
    }
    if !policy.chosen_retaliation_cause_policy.is_empty() {
        required.insert(StandardNarConflictFamily::ChosenRetaliation);
    }
    if !policy.generated_kill_cause_policy.is_empty() || !policy.trigger_fixpoint_policy.is_empty()
    {
        required.insert(StandardNarConflictFamily::GeneratedKillReentry);
    }
    if !standard_nar_target_state_save_tags(pack).is_empty() {
        required.insert(StandardNarConflictFamily::TargetStateSave);
    }
    if !standard_nar_target_state_gate_tags(pack).is_empty() {
        required.insert(StandardNarConflictFamily::TargetStateGate);
    }
    if !policy.action_chance.is_empty() {
        required.insert(StandardNarConflictFamily::ActionChance);
    }
    required
}

fn standard_nar_cpr_harm_cause(pack: &Pack, template: &ActionTemplate) -> Option<String> {
    if pack.standard_nar.enabled {
        return pack
            .standard_nar
            .cpr_harm_cause_policy
            .get(&template.id)
            .cloned();
    }
    if template.has_modifier(Modifier::Cpr) {
        return Some(template.id.clone());
    }
    None
}

fn standard_nar_guard_dependency_cause(pack: &Pack, template: &ActionTemplate) -> Option<String> {
    if pack.standard_nar.enabled {
        return pack
            .standard_nar
            .guard_dependency_cause_policy
            .get(&template.id)
            .cloned();
    }
    if template.has_modifier(Modifier::Babysitter) {
        return Some(template.id.clone());
    }
    None
}

fn standard_nar_hide_dependency_cause(pack: &Pack, template: &ActionTemplate) -> Option<String> {
    if pack.standard_nar.enabled {
        return pack
            .standard_nar
            .hide_dependency_cause_policy
            .get(&template.id)
            .cloned();
    }
    if template.has_modifier(Modifier::Hider) {
        return Some(template.id.clone());
    }
    None
}

fn standard_nar_intercept_cause(pack: &Pack, template: &ActionTemplate) -> Option<String> {
    if pack.standard_nar.enabled {
        return pack
            .standard_nar
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

fn standard_nar_guard_retaliation_cause(pack: &Pack, template: &ActionTemplate) -> Option<String> {
    if pack.standard_nar.enabled {
        return pack
            .standard_nar
            .guard_retaliation_cause_policy
            .get(&template.id)
            .cloned();
    }
    None
}

fn standard_nar_strongman_bypasses(pack: &Pack, template: &ActionTemplate) -> bool {
    if pack.standard_nar.enabled {
        return pack
            .standard_nar
            .strongman_action_ids
            .iter()
            .any(|action_id| action_id == &template.id);
    }
    template.has_modifier(Modifier::Strongman)
}

fn standard_nar_kill_participates(pack: &Pack, template: &ActionTemplate) -> bool {
    if !pack.standard_nar.enabled {
        return true;
    }
    pack.standard_nar
        .kill_action_ids
        .iter()
        .chain(pack.standard_nar.strongman_action_ids.iter())
        .any(|action_id| action_id == &template.id)
}

fn standard_nar_chosen_retaliation_bypasses_protect(pack: &Pack, source_action: &str) -> bool {
    if pack.standard_nar.enabled {
        return pack
            .standard_nar
            .chosen_retaliation_cause_policy
            .get(source_action)
            .map(|policy| policy.strongman_bypasses_protect)
            .unwrap_or_else(|| {
                panic!(
                    "invalid standard_nar chosen retaliation cause policy: Retaliate action `{source_action}` must declare chosen retaliation cause policy"
                )
            });
    }
    false
}

fn standard_nar_generated_kill_bypasses_protect(pack: &Pack, trigger: &TriggerRule) -> bool {
    if pack.standard_nar.enabled {
        return pack
            .standard_nar
            .generated_kill_cause_policy
            .get(&trigger.id)
            .map(|policy| policy.strongman_bypasses_protect)
            .unwrap_or_else(|| {
                panic!(
                    "invalid standard_nar generated kill cause policy: generated kill trigger `{}` must declare generated kill cause policy",
                    trigger.id
                )
            });
    }
    trigger.produces.modifiers.contains(&Modifier::Strongman)
}

fn standard_nar_trigger_participates_in_fixpoint(pack: &Pack, trigger: &TriggerRule) -> bool {
    if trigger.produces.ability != IrAbility::Kill {
        return true;
    }
    if pack.standard_nar.enabled {
        return pack
            .standard_nar
            .trigger_fixpoint_policy
            .get(&trigger.id)
            .map(|policy| policy.produced_kill_reenters)
            .unwrap_or_else(|| {
                panic!(
                    "invalid standard_nar trigger fixpoint policy: generated kill trigger `{}` must declare trigger fixpoint policy",
                    trigger.id
                )
            });
    }
    true
}

fn standard_nar_aggregates_kill_attackers(pack: &Pack) -> bool {
    pack.standard_nar.enabled
        && matches!(
            pack.standard_nar.kill_stacking,
            Some(KillStackingPolicy::AggregateAttackers)
        )
}

fn protection_blocks_cause(pack: &Pack, cause: &str, source: &ProtectionSource) -> bool {
    if pack.standard_nar.enabled {
        return pack
            .standard_nar
            .protection_cause_policy
            .get(&source.template_id)
            .is_some_and(|policy| {
                policy.blocks.iter().any(|blocked| blocked == cause)
                    || policy.bypasses.iter().any(|bypassed| bypassed == cause)
            });
    }
    if pack.guard_policy.enabled
        && pack
            .guard_policy
            .guard_blockable_causes
            .iter()
            .any(|configured| configured == cause)
    {
        return pack
            .guard_policy
            .guard_action_ids
            .iter()
            .any(|action_id| action_id == &source.template_id);
    }
    true
}

#[allow(clippy::too_many_arguments)]
fn apply_guard_witch_same_target_policy(
    input: &ResolutionInput,
    protections: &BTreeMap<SlotId, Vec<ProtectionSource>>,
    killed: &mut Vec<SlotId>,
    log: &mut Vec<KillRecord>,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    if !input.pack.guard_policy.enabled
        || input.pack.guard_policy.same_target_witch != GuardWitchSameTargetPolicy::KillTarget
    {
        return;
    }
    let Some(cause) = input
        .pack
        .guard_policy
        .same_target_witch_kill_cause
        .as_deref()
    else {
        panic!("invalid guard policy: KillTarget same-target policy requires same_target_witch_kill_cause");
    };

    for (target, sources) in protections {
        if killed.contains(target) {
            continue;
        }
        let guard_sources: Vec<_> = sources
            .iter()
            .filter(|source| {
                input
                    .pack
                    .guard_policy
                    .guard_action_ids
                    .iter()
                    .any(|action_id| action_id == &source.template_id)
            })
            .collect();
        let witch_sources: Vec<_> = sources
            .iter()
            .filter(|source| {
                input
                    .pack
                    .guard_policy
                    .witch_heal_action_ids
                    .iter()
                    .any(|action_id| action_id == &source.template_id)
            })
            .collect();
        if guard_sources.is_empty() || witch_sources.is_empty() {
            continue;
        }

        let attackers = guard_sources
            .iter()
            .chain(witch_sources.iter())
            .map(|source| source.protector.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        trace_decisions.push(DecisionTrace {
            stage: "night:guard_policy".to_string(),
            source: "guard_policy.same_target_witch".to_string(),
            outcome: "guard_witch_same_target_killed".to_string(),
            detail: serde_json::json!({
                "target": target,
                "cause": cause,
                "policy": "KillTarget",
                "guard_sources": guard_sources.iter().map(|source| {
                    serde_json::json!({
                        "protector": source.protector,
                        "action_id": source.action_id,
                        "template_id": source.template_id,
                    })
                }).collect::<Vec<_>>(),
                "witch_sources": witch_sources.iter().map(|source| {
                    serde_json::json!({
                        "protector": source.protector,
                        "action_id": source.action_id,
                        "template_id": source.template_id,
                    })
                }).collect::<Vec<_>>(),
            }),
        });
        killed.push(target.clone());
        events.push(InnerEvent::PlayerKilled {
            slot_id: target.clone(),
            cause: cause.to_string(),
            attackers: attackers.clone(),
            unstoppable: true,
            death_reveal: death_reveal_mode(input, target, cause),
        });
        for attacker in attackers {
            log.push(KillRecord {
                target: target.clone(),
                attacker,
                cause: cause.to_string(),
            });
        }
    }
}

fn target_state_save_blocks_cause(
    pack: &Pack,
    cause: &str,
    save_tag: &str,
    unstoppable: bool,
) -> bool {
    if pack.standard_nar.enabled {
        if !pack
            .standard_nar
            .target_state_save_tags
            .iter()
            .any(|tag| tag == save_tag)
        {
            return false;
        }
        return pack
            .standard_nar
            .target_state_save_policy
            .get(save_tag)
            .is_some_and(|policy| policy.blocks.iter().any(|blocked| blocked == cause));
    }
    !unstoppable
}

/// Indices of actions with the given ability, ordered by descending
/// `Constraints.priority`, then by ascending `submitted_at`, then by `action_id`
/// for a total, stable order.
fn ability_order(actions: &[Action], ability: IrAbility) -> Vec<usize> {
    let mut idxs: Vec<usize> = actions
        .iter()
        .enumerate()
        .filter(|(_, a)| a.has_ability(ability))
        .map(|(i, _)| i)
        .collect();
    idxs.sort_by(|&a, &b| {
        let pa = actions[a].template.constraints.priority;
        let pb = actions[b].template.constraints.priority;
        pb.cmp(&pa)
            .then(
                actions[a]
                    .sub
                    .submitted_at
                    .cmp(&actions[b].sub.submitted_at),
            )
            .then(actions[a].sub.action_id.cmp(&actions[b].sub.action_id))
    });
    idxs
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
    let role = input.pack.roles.get(&slot.role_key)?;
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
    let template = input.pack.item_actions.get(&grant.grant_id)?;
    (template.id == sub.template_id).then_some(template)
}

fn selected_grant_for_submission<'a>(
    template: &'a ActionTemplate,
    sub: &Submission,
) -> Option<&'a GrantSpec> {
    if template.grant_options.is_empty() {
        return template.grant.as_ref();
    }
    let grant_id = sub.metadata.get("grant_id")?.as_str()?;
    template
        .grant_options
        .iter()
        .find(|grant| grant.grant_id == grant_id)
}

fn submission_item_grant_id(input: &ResolutionInput, sub: &Submission) -> Option<String> {
    let grant_id = sub.metadata.get("grant_id")?.as_str()?;
    let template = input.pack.item_actions.get(grant_id)?;
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
    let pack = &input.pack;
    require_visibility_families(pack);
    require_win_families(pack);
    let policy = &pack.vote;
    let mut events = Vec::new();
    let mut trace_decisions = Vec::new();
    let mut trace_notes = Vec::new();
    resolve_day_announcements(input, &mut events);
    resolve_reveal_town_actions(input, &mut events);
    let badges = resolve_badge_actions(input, &mut events);
    let badge_weights = active_badge_vote_weights(&badges);
    resolve_self_destruct_actions(input, &mut events);
    resolve_day_kill_actions(input, &mut events, &mut trace_decisions);
    require_ita_vote_conflict_policy(pack);
    resolve_ita_actions(input, &mut events, &mut trace_decisions);
    resolve_duel_actions(input, &mut events, &mut trace_decisions, &mut trace_notes);
    let vote_state = apply_events(&input.state, &events);
    let pre_vote_deaths = deaths_from_events(&events);
    let vote_duel = resolve_vote_duel_action(input, &vote_state, &mut events);

    // Weights: all alive slots carry a weight (Equal = 1.0 each), regardless of
    // whether they cast or withdrew a ballot.
    let mut weights: BTreeMap<SlotId, f64> = BTreeMap::new();
    for slot in &vote_state.slots {
        if slot.is_alive() {
            let mut role_weight = match &policy.weights {
                WeightPolicy::Equal => 1.0,
                WeightPolicy::PerRole(map) => map.get(&slot.role_key).copied().unwrap_or(1.0),
                WeightPolicy::Dynamic(dynamic) => {
                    dynamic_vote_weight(dynamic, slot, &vote_state.action_grants)
                }
            };
            if idiot_vote_loss_applies(pack, slot) {
                role_weight = 0.0;
            }
            let w = badge_weights
                .get(&slot.slot_id)
                .copied()
                .unwrap_or(role_weight);
            weights.insert(slot.slot_id.clone(), w);
        }
    }
    let total_weight: f64 = weights.values().sum();

    // Active ballots: latest non-withdrawn day_vote per actor, in submission
    // order. Withdrawn ballots are omitted entirely.
    const NO_LYNCH_TARGET: &str = "no_lynch";

    let mut valid_vote_targets: BTreeSet<&str> = vote_state
        .slots
        .iter()
        .filter(|slot| slot.is_alive())
        .map(|slot| slot.slot_id.as_str())
        .collect();
    let alive_candidates = valid_vote_targets.clone();
    if policy.no_lynch_allowed {
        valid_vote_targets.insert(NO_LYNCH_TARGET);
    }

    let majority = match &policy.method {
        VoteMethod::Plurality => None,
        VoteMethod::Majority => Some((total_weight / 2.0).floor() + 1.0),
        VoteMethod::Supermajority { num, den } => {
            Some((total_weight * (*num as f64) / (*den as f64)).ceil())
        }
    };
    let mut thresholds: BTreeMap<SlotId, f64> = BTreeMap::new();
    if let Some(base) = majority {
        for slot in vote_state.slots.iter().filter(|slot| slot.is_alive()) {
            let adjustment = policy
                .threshold_adjustments
                .get(&slot.role_key)
                .copied()
                .unwrap_or(0.0);
            let threshold = if vote_duel
                .as_ref()
                .is_some_and(|duel| duel.contains(&slot.slot_id))
            {
                1.0
            } else {
                (base + adjustment).max(1.0)
            };
            thresholds.insert(slot.slot_id.clone(), threshold);
        }
    }

    let mut votes: BTreeMap<SlotId, SlotId> = BTreeMap::new();
    let mut hammer_reached = false;
    let mut ordered: Vec<&Submission> = input
        .submissions
        .iter()
        .filter(|s| s.template_id == "day_vote")
        .collect();
    ordered.sort_by(|a, b| {
        a.submitted_at
            .cmp(&b.submitted_at)
            .then(a.action_id.cmp(&b.action_id))
    });
    for (index, sub) in ordered.iter().enumerate() {
        events.push(InnerEvent::DayVoteRecorded {
            actor: sub.actor.clone(),
            target: sub.targets.first().cloned(),
            withdrawn: sub.withdrawn,
            sequence: (index + 1) as u64,
        });
    }
    for sub in &ordered {
        if sub.withdrawn {
            votes.remove(&sub.actor);
            continue;
        }
        if !weights.contains_key(&sub.actor) {
            continue;
        }
        if let Some(target) = sub.targets.first() {
            if valid_vote_targets.contains(target.as_str()) {
                votes.insert(sub.actor.clone(), target.clone());
                if policy.hammer {
                    let mut hammer_votes = votes.clone();
                    if let Some(duel) = &vote_duel {
                        hammer_votes.retain(|_, target| duel.contains(target));
                    }
                    let hammer_tallies = tally_votes(&hammer_votes, &weights);
                    let threshold = majority.and_then(|base| {
                        if target == NO_LYNCH_TARGET {
                            Some(base)
                        } else {
                            thresholds.get(target).copied().or(Some(base))
                        }
                    });
                    if let Some(threshold) = threshold {
                        let tally = hammer_tallies.get(target).copied().unwrap_or(0.0);
                        if tally >= threshold {
                            votes = hammer_votes;
                            hammer_reached = true;
                            break;
                        }
                    }
                }
            }
        }
    }
    if !hammer_reached {
        if let Some(duel) = &vote_duel {
            votes.retain(|_, target| duel.contains(target));
        }
    }

    // Tally weighted counts per candidate.
    let mut tallies = tally_votes(&votes, &weights);
    if let Some(duel) = &vote_duel {
        for participant in duel {
            if valid_vote_targets.contains(participant.as_str()) {
                tallies.entry(participant.clone()).or_insert(0.0);
            }
        }
    }

    // Find the top tally and its contenders.
    let max_tally = tallies.values().cloned().fold(0.0_f64, f64::max);
    let mut contenders: Vec<SlotId> = if vote_duel.is_some() && max_tally <= 0.0 {
        tallies.keys().cloned().collect()
    } else {
        tallies
            .iter()
            .filter(|(_, &v)| max_tally > 0.0 && (v - max_tally).abs() < f64::EPSILON)
            .map(|(k, _)| k.clone())
            .collect()
    };
    contenders.sort();

    let duel_forced_elimination = vote_duel.is_some();
    let tie_breaker = if duel_forced_elimination {
        match policy
            .vote_duel_tie_breaker
            .expect("VoteDuel packs must declare vote.vote_duel_tie_breaker")
        {
            VoteDuelTieBreaker::Random => VoteTieBreaker::Random,
        }
    } else {
        policy.tie_breaker
    };
    let role_tiebreaker_winner =
        role_tiebreaker_winner(&vote_state, &contenders, &policy.tiebreaker_roles);

    let (status, winner, contenders, tiebreak, reason) = decide_outcome(
        &tallies,
        &contenders,
        max_tally,
        majority,
        &thresholds,
        tie_breaker,
        role_tiebreaker_winner,
        input.seed,
        NO_LYNCH_TARGET,
        duel_forced_elimination,
        hammer_reached,
    );

    let outcome = DayVoteOutcome {
        status,
        winner: winner.clone(),
        contenders,
        tallies,
        votes: votes.clone(),
        weights,
        majority,
        thresholds,
        total_weight,
        tiebreak,
        reason,
    };

    // R1: a lynch is a death like any other. We emit the structural
    // `DayVoteOutcome` (the authoritative tally + winner) AND a `PlayerKilled`
    // for the eliminated slot, so the death folds uniformly through
    // `apply_events`/`slot_state` — the lynch is no longer a special apply path.
    // `cause` is the action template id ("day_vote"); `attackers` is empty (the
    // town is the collective actor); `unstoppable` is true (a lynch cannot be
    // protected against). The trailing `PhaseAnnouncement` carries the semantic
    // `cause: "lynch"` Death.
    events.push(InnerEvent::DayVoteOutcome(outcome.clone()));
    let vetoed_winner = resolve_vote_veto_action(input, &vote_state, &outcome, &mut events);
    resolve_day_vote_prompts(input, &outcome, &mut events, &mut trace_decisions);
    let mut deaths = pre_vote_deaths;
    let mut trigger_frontier = Vec::new();
    if let Some(w) = &winner {
        if vetoed_winner.as_ref() == Some(w) {
            trace_decisions.push(DecisionTrace {
                stage: "day:veto".to_string(),
                source: format!("slot:{w}"),
                outcome: "lynch_vetoed".to_string(),
                detail: serde_json::json!({
                    "phase_id": input.phase_id,
                    "target": w,
                }),
            });
        } else if alive_candidates.contains(w.as_str()) {
            if idiot_survives_lynch(input, w) {
                events.push(InnerEvent::PlayerSaved {
                    slot_id: w.clone(),
                    reasons: vec![pack.idiot_policy.survival_reason.clone()],
                    sources: vec![w.clone()],
                });
                events.push(effects_marked(
                    input,
                    pack,
                    pack.idiot_policy.vote_loss_effect.clone(),
                    w.clone(),
                    w.clone(),
                    "day_vote".to_string(),
                    EffectDuration::Persistent,
                ));
            } else if let Some((role_key, original_alignment, target_alignment, survival_reason)) =
                saulus_conversion_on_lynch(input, &vote_state, w)
            {
                trace_decisions.push(DecisionTrace {
                    stage: "day:lynch_trigger".to_string(),
                    source: format!("slot:{w}"),
                    outcome: "saulus_alignment_flipped".to_string(),
                    detail: serde_json::json!({
                        "target": w,
                        "role": role_key,
                        "original_alignment": original_alignment,
                        "new_alignment": target_alignment,
                        "reason": survival_reason,
                    }),
                });
                events.push(InnerEvent::PlayerSaved {
                    slot_id: w.clone(),
                    reasons: vec![survival_reason],
                    sources: vec![w.clone()],
                });
                events.push(InnerEvent::PlayerConverted {
                    target: w.clone(),
                    new_role: role_key.clone(),
                    new_alignment: Some(target_alignment),
                    original_role: role_key,
                    original_alignment,
                    source: w.clone(),
                });
            } else {
                events.push(InnerEvent::PlayerKilled {
                    slot_id: w.clone(),
                    cause: "day_vote".to_string(),
                    attackers: Vec::new(),
                    unstoppable: true,
                    death_reveal: death_reveal_mode(input, w, "day_vote"),
                });
                let execution_actor = ordered
                    .iter()
                    .rev()
                    .find(|sub| {
                        !sub.withdrawn
                            && sub.targets.first() == Some(w)
                            && votes.get(&sub.actor) == Some(w)
                    })
                    .map(|sub| sub.actor.clone())
                    .unwrap_or_else(|| w.clone());
                trigger_frontier.push(TriggerObservation {
                    on: TriggerOn::Event(TriggerEvent::Lynch),
                    target: w.clone(),
                    actor: execution_actor.clone(),
                    cause: "lynch".to_string(),
                    target_tags: Vec::new(),
                    actor_tags: Vec::new(),
                });
                trigger_frontier.push(TriggerObservation {
                    on: TriggerOn::Event(TriggerEvent::Death),
                    target: w.clone(),
                    actor: execution_actor,
                    cause: "lynch".to_string(),
                    target_tags: Vec::new(),
                    actor_tags: Vec::new(),
                });
                if duel_forced_elimination {
                    if let Some((challenger, source_action)) =
                        vote_duel_instigator_for_target(&events, w)
                    {
                        trigger_frontier.push(TriggerObservation {
                            on: TriggerOn::Ability(IrAbility::VoteDuel),
                            target: w.clone(),
                            actor: challenger,
                            cause: source_action,
                            target_tags: Vec::new(),
                            actor_tags: Vec::new(),
                        });
                    }
                }
                deaths.push(Death {
                    slot_id: w.clone(),
                    cause: "lynch".to_string(),
                    template_id: None,
                    audience: None,
                });
                resolve_last_words(input, &outcome, w, &mut events);
                resolve_wolf_beauty_drag(
                    input,
                    w,
                    "lynch",
                    &mut events,
                    &mut deaths,
                    &mut trace_decisions,
                );
            }
        }
    }
    let mut killed: Vec<SlotId> = deaths.iter().map(|death| death.slot_id.clone()).collect();
    let mut kill_log: Vec<KillRecord> = deaths
        .iter()
        .map(|death| KillRecord {
            target: death.slot_id.clone(),
            attacker: death.slot_id.clone(),
            cause: death.cause.clone(),
        })
        .collect();
    let mut cpr_saves: BTreeSet<String> = BTreeSet::new();
    trigger_frontier.extend(phase_end_observations(input, &killed));
    let generated_kills = apply_trigger_fixpoint(
        input,
        trigger_frontier,
        &BTreeMap::new(),
        &BTreeMap::new(),
        &mut killed,
        &mut cpr_saves,
        &mut events,
        &mut trace_decisions,
        &mut trace_notes,
    );
    for record in generated_kills {
        deaths.push(Death {
            slot_id: record.target.clone(),
            cause: record.cause.clone(),
            template_id: None,
            audience: None,
        });
        kill_log.push(record);
    }
    let chosen_retaliation_start = kill_log.len();
    apply_chosen_retaliations(
        input,
        &BTreeMap::new(),
        &mut killed,
        &mut kill_log,
        &mut cpr_saves,
        &mut events,
        &mut trace_decisions,
    );
    for record in kill_log.iter().skip(chosen_retaliation_start) {
        deaths.push(Death {
            slot_id: record.target.clone(),
            cause: record.cause.clone(),
            template_id: None,
            audience: None,
        });
    }
    for slot_id in apply_lover_suicides(
        input,
        &mut killed,
        &mut kill_log,
        &mut events,
        &mut trace_decisions,
    ) {
        deaths.push(Death {
            slot_id,
            cause: pack.lover_policy.suicide_cause.clone(),
            template_id: None,
            audience: None,
        });
    }
    apply_effect_source_death_reveals(input, &killed, &mut events, &mut trace_decisions);
    resolve_beloved_princess_prompts(input, &mut events, &mut trace_decisions);
    events.push(InnerEvent::PhaseAnnouncement(phase_announcement(
        input, deaths,
    )));
    if let Some(winner) = winner.as_ref() {
        resolve_self_lynch_wins(input, winner, &mut events, &mut trace_decisions);
        if !has_win_reached(&events) {
            resolve_target_lynch_wins(input, winner, &mut events, &mut trace_decisions);
        }
    }
    InnerResolution {
        events,
        trace_edges: Vec::new(),
        trace_decisions,
        trace_notes,
    }
}

fn resolve_vote_veto_action(
    input: &ResolutionInput,
    vote_state: &StateSnapshot,
    outcome: &DayVoteOutcome,
    events: &mut Vec<InnerEvent>,
) -> Option<SlotId> {
    if input.state.phase_kind != PhaseKind::Day {
        return None;
    }
    if !matches!(outcome.status, VoteStatus::Lynch | VoteStatus::Hammer) {
        return None;
    }
    let winner = outcome.winner.as_ref()?;

    let mut submissions: Vec<(&Submission, &ActionTemplate)> = input
        .submissions
        .iter()
        .filter(|submission| !submission.withdrawn)
        .filter_map(|submission| {
            let template = lookup_submission_template(input, submission)?;
            if !phase_window_matches(template.window, input.state.phase_kind) {
                return None;
            }
            template
                .has_ability(IrAbility::Veto)
                .then_some((submission, template))
        })
        .collect();
    submissions.sort_by(|(left, left_template), (right, right_template)| {
        right_template
            .constraints
            .priority
            .cmp(&left_template.constraints.priority)
            .then(left.submitted_at.cmp(&right.submitted_at))
            .then(left.action_id.cmp(&right.action_id))
    });

    for (submission, template) in submissions {
        let Some(actor) = vote_state
            .slots
            .iter()
            .find(|slot| slot.slot_id == submission.actor && slot.is_alive())
        else {
            continue;
        };
        let Some(target) = submission.targets.first() else {
            events.push(InnerEvent::ActionInterfered {
                actor: submission.actor.clone(),
                reason: "veto_missing_target".to_string(),
            });
            continue;
        };
        if target != winner {
            events.push(InnerEvent::ActionInterfered {
                actor: submission.actor.clone(),
                reason: "veto_target_not_vote_winner".to_string(),
            });
            continue;
        }
        if let Some(limit) = template.constraints.x_shots {
            if action_counter_exhausted(input, &submission.actor, &template.id, limit) {
                events.push(InnerEvent::ActionInterfered {
                    actor: submission.actor.clone(),
                    reason: "x_shot_exhausted".to_string(),
                });
                continue;
            }
            events.push(action_use_counted(
                input,
                submission.actor.clone(),
                template.id.clone(),
                submission.action_id.clone(),
                limit,
            ));
        }
        events.push(InnerEvent::VoteVetoed {
            governor: actor.slot_id.clone(),
            target: target.clone(),
            source_action: submission.action_id.clone(),
            phase_id: input.phase_id.clone(),
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
        });
        return Some(target.clone());
    }
    None
}

fn resolve_reveal_town_actions(input: &ResolutionInput, events: &mut Vec<InnerEvent>) {
    if input.state.phase_kind != PhaseKind::Day {
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
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
        });
    }
}

fn apply_effect_source_death_reveals(
    input: &ResolutionInput,
    killed: &[SlotId],
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    if input.pack.effect_source_death_reveals.is_empty() || killed.is_empty() {
        return;
    }

    let killed: BTreeSet<&SlotId> = killed.iter().collect();
    let policies: BTreeMap<&str, _> = input
        .pack
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
                    detail: serde_json::json!({
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
                    phase_kind: input.state.phase_kind,
                    phase_number: input.state.phase_number,
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
                    detail: serde_json::json!({
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
                    phase_kind: input.state.phase_kind,
                    phase_number: input.state.phase_number,
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
    if input.state.phase_kind != PhaseKind::Day {
        return;
    }

    let mut ordered: Vec<(&Submission, &ActionTemplate)> = input
        .submissions
        .iter()
        .filter(|sub| !sub.withdrawn)
        .filter_map(|sub| {
            let template = lookup_submission_template(input, sub)?;
            if !phase_window_matches(template.window, input.state.phase_kind) {
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
                target_state_gate_reason(&input.pack, &target_tags, IrAbility::Kill)
            {
                trace_decisions.push(DecisionTrace {
                    stage: "day:kill_resolution".to_string(),
                    source: format!("action:{}", sub.action_id),
                    outcome: "kill_skipped_by_target_state".to_string(),
                    detail: serde_json::json!({
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

fn resolve_vote_duel_action(
    input: &ResolutionInput,
    vote_state: &StateSnapshot,
    events: &mut Vec<InnerEvent>,
) -> Option<BTreeSet<SlotId>> {
    if input.state.phase_kind != PhaseKind::Day {
        return None;
    }

    let mut submissions: Vec<&Submission> = input
        .submissions
        .iter()
        .filter(|submission| !submission.withdrawn)
        .filter(|submission| {
            lookup_submission_template(input, submission)
                .is_some_and(|template| template.has_ability(IrAbility::VoteDuel))
        })
        .collect();
    submissions.sort_by(|left, right| {
        left.submitted_at
            .cmp(&right.submitted_at)
            .then(left.action_id.cmp(&right.action_id))
    });

    for submission in submissions {
        let Some(target) = submission.targets.first().cloned() else {
            continue;
        };
        if target == submission.actor {
            continue;
        }
        let Some(actor_slot) = vote_state
            .slots
            .iter()
            .find(|slot| slot.slot_id == submission.actor && slot.is_alive())
        else {
            continue;
        };
        let Some(target_slot) = vote_state
            .slots
            .iter()
            .find(|slot| slot.slot_id == target && slot.is_alive())
        else {
            continue;
        };
        events.push(InnerEvent::VoteDuelDeclared {
            challenger: actor_slot.slot_id.clone(),
            target: target_slot.slot_id.clone(),
            source_action: submission.action_id.clone(),
            phase_id: input.phase_id.clone(),
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
        });
        return Some(BTreeSet::from([
            actor_slot.slot_id.clone(),
            target_slot.slot_id.clone(),
        ]));
    }

    None
}

fn vote_duel_instigator_for_target(
    events: &[InnerEvent],
    killed: &SlotId,
) -> Option<(SlotId, String)> {
    events.iter().rev().find_map(|event| {
        if let InnerEvent::VoteDuelDeclared {
            challenger,
            target,
            source_action,
            ..
        } = event
        {
            if challenger == killed || target == killed {
                return Some((challenger.clone(), source_action.clone()));
            }
        }
        None
    })
}

fn resolve_target_lynch_wins(
    input: &ResolutionInput,
    lynched: &SlotId,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    if input.pack.target_lynch_win_policies.is_empty() {
        return;
    }
    let mut matches = Vec::new();
    for record in input.state.target_lynch_win_targets.iter() {
        if &record.target != lynched {
            continue;
        }
        let Some(policy) = input
            .pack
            .target_lynch_win_policies
            .iter()
            .find(|policy| policy.id == record.policy && policy.target_effect == record.effect)
        else {
            continue;
        };
        let owner_is_eligible = input
            .state
            .slots
            .iter()
            .find(|slot| slot.slot_id == record.owner)
            .is_some_and(|slot| {
                slot.is_alive()
                    && policy
                        .eligible_roles
                        .iter()
                        .any(|role| role == &slot.role_key)
            });
        if owner_is_eligible {
            matches.push((record, policy));
        }
    }
    matches.sort_by(|(a, a_policy), (b, b_policy)| {
        a_policy
            .id
            .cmp(&b_policy.id)
            .then(a.owner.cmp(&b.owner))
            .then(a.target.cmp(&b.target))
            .then(a.source_action.cmp(&b.source_action))
    });

    for (record, policy) in matches {
        trace_decisions.push(DecisionTrace {
            stage: "day:lynch_trigger".to_string(),
            source: format!("action:{}", record.source_action),
            outcome: "target_lynch_win_reached".to_string(),
            detail: serde_json::json!({
                "policy": policy.id,
                "owner": record.owner,
                "target": record.target,
                "effect": record.effect,
                "winner": policy.winner,
                "source_action": record.source_action,
                "target_phase_id": record.phase_id,
                "target_phase_kind": record.phase_kind,
                "target_phase_number": record.phase_number,
            }),
        });
        events.push(InnerEvent::WinReached {
            winner: policy.winner.clone(),
            reason: format!(
                "{} {} target {} lynched",
                policy.id, record.owner, record.target
            ),
            metadata: serde_json::json!({
                "policy": policy.id,
                "owner": record.owner,
                "target": record.target,
                "effect": record.effect,
                "source_action": record.source_action,
                "target_phase_id": record.phase_id,
                "target_phase_kind": record.phase_kind,
                "target_phase_number": record.phase_number,
            }),
        });
    }
}

fn resolve_beloved_princess_prompt(
    input: &ResolutionInput,
    slot_id: &SlotId,
    cause: &str,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    let policy = &input.pack.beloved_princess_policy;
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
        detail: serde_json::json!({
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
        phase_kind: input.state.phase_kind,
        phase_number: input.state.phase_number,
        metadata: serde_json::json!({
            "policy": "beloved_princess",
            "death_cause": cause,
            "role": slot.role_key,
        }),
    }));
}

fn resolve_beloved_princess_prompts(
    input: &ResolutionInput,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    let policy = &input.pack.beloved_princess_policy;
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
    if input.state.phase_kind == PhaseKind::Day && cause == "day_vote" {
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

fn resolve_day_vote_prompts(
    input: &ResolutionInput,
    outcome: &DayVoteOutcome,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    if input.pack.day_vote_prompt_policies.is_empty() {
        return;
    }
    let status = outcome.status;
    for policy in &input.pack.day_vote_prompt_policies {
        if !policy.statuses.contains(&status) {
            continue;
        }
        let status_name = format!("{status:?}");
        let prompt_id = format!("{}:{}:{}", input.phase_id, policy.prompt_kind, status_name);
        trace_decisions.push(DecisionTrace {
            stage: "day:vote_prompt".to_string(),
            source: "day_vote".to_string(),
            outcome: "host_prompt_issued".to_string(),
            detail: serde_json::json!({
                "policy": policy.id,
                "prompt_id": prompt_id,
                "kind": policy.prompt_kind,
                "subject": null,
                "reason": policy.prompt_reason,
                "status": status_name,
                "contenders": outcome.contenders,
                "tiebreak": outcome.tiebreak,
                "outcome_reason": outcome.reason,
            }),
        });
        events.push(InnerEvent::HostPromptIssued(HostPromptIssued {
            prompt_id,
            kind: policy.prompt_kind.clone(),
            subject: None,
            reason: policy.prompt_reason.clone(),
            phase_id: input.phase_id.clone(),
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
            metadata: serde_json::json!({
                "policy": policy.id,
                "status": status_name,
                "contenders": outcome.contenders,
                "tiebreak": outcome.tiebreak,
                "outcome_reason": outcome.reason,
            }),
        }));
    }
}

fn idiot_vote_loss_applies(pack: &Pack, slot: &SlotState) -> bool {
    pack.idiot_policy.enabled
        && slot
            .effects
            .iter()
            .any(|effect| effect == &pack.idiot_policy.vote_loss_effect)
}

fn dynamic_vote_weight(
    policy: &crate::pack::DynamicVoteWeightPolicy,
    slot: &SlotState,
    action_grants: &[crate::state::ActionGrantRecord],
) -> f64 {
    let mut selected: Option<(i32, String, f64)> = None;
    for rule in &policy.effect_rules {
        if slot.effects.iter().any(|effect| effect == &rule.effect) {
            selected = max_vote_weight_rule(
                selected,
                (
                    rule.priority,
                    format!("effect:{}", rule.effect),
                    rule.weight,
                ),
            );
        }
    }
    for rule in &policy.grant_rules {
        for grant in action_grants {
            if grant.target == slot.slot_id
                && grant.kind == GrantKind::VoteWeight
                && grant.grant_id == rule.grant_id
                && grant.uses > 0
            {
                if let Some(weight) = grant.vote_weight {
                    selected = max_vote_weight_rule(
                        selected,
                        (rule.priority, format!("grant:{}", rule.grant_id), weight),
                    );
                }
            }
        }
    }
    selected.map(|(_, _, weight)| weight).unwrap_or(policy.base)
}

fn max_vote_weight_rule(
    current: Option<(i32, String, f64)>,
    candidate: (i32, String, f64),
) -> Option<(i32, String, f64)> {
    match current {
        Some(current)
            if current.0 > candidate.0
                || (current.0 == candidate.0 && current.1 >= candidate.1) =>
        {
            Some(current)
        }
        _ => Some(candidate),
    }
}

fn idiot_survives_lynch(input: &ResolutionInput, slot_id: &SlotId) -> bool {
    let policy = &input.pack.idiot_policy;
    if !policy.enabled {
        return false;
    }
    let Some(slot) = input
        .state
        .slots
        .iter()
        .find(|slot| &slot.slot_id == slot_id)
    else {
        return false;
    };
    policy
        .eligible_roles
        .iter()
        .any(|role| role == &slot.role_key)
        && !slot
            .effects
            .iter()
            .any(|effect| effect == &policy.vote_loss_effect)
}

fn saulus_conversion_on_lynch(
    input: &ResolutionInput,
    vote_state: &StateSnapshot,
    slot_id: &SlotId,
) -> Option<(String, Option<String>, String, String)> {
    let policy = &input.pack.saulus_policy;
    if !policy.enabled {
        return None;
    }
    let slot = vote_state
        .slots
        .iter()
        .find(|slot| &slot.slot_id == slot_id)?;
    if !policy
        .eligible_roles
        .iter()
        .any(|role| role == &slot.role_key)
    {
        return None;
    }
    if slot.alignment.as_deref() == Some(policy.target_alignment.as_str()) {
        return None;
    }
    Some((
        slot.role_key.clone(),
        slot.alignment.clone(),
        policy.target_alignment.clone(),
        policy.survival_reason.clone(),
    ))
}

fn resolve_day_announcements(input: &ResolutionInput, events: &mut Vec<InnerEvent>) {
    let policy = &input.pack.day_notes.announcements;
    if !policy.enabled || input.state.phase_kind != PhaseKind::Day {
        return;
    }

    let day = input.state.phase_number;
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

fn resolve_self_lynch_wins(
    input: &ResolutionInput,
    lynched: &SlotId,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    if input.pack.self_lynch_win_policies.is_empty() {
        return;
    }
    let Some(slot) = input
        .state
        .slots
        .iter()
        .find(|slot| &slot.slot_id == lynched)
    else {
        return;
    };
    let mut matches: Vec<_> = input
        .pack
        .self_lynch_win_policies
        .iter()
        .filter(|policy| {
            policy
                .eligible_roles
                .iter()
                .any(|role| role == &slot.role_key)
        })
        .collect();
    matches.sort_by(|a, b| a.id.cmp(&b.id));
    let Some(policy) = matches.first() else {
        return;
    };
    let source_event = policy
        .source_event
        .clone()
        .unwrap_or_else(|| format!("win.{}", policy.id));
    trace_decisions.push(DecisionTrace {
        stage: "day:lynch_trigger".to_string(),
        source: format!("slot:{lynched}"),
        outcome: "self_lynch_win_reached".to_string(),
        detail: serde_json::json!({
            "policy": policy.id,
            "winner": policy.winner,
            "target": lynched,
            "role": slot.role_key,
            "source_event": source_event,
        }),
    });
    events.push(InnerEvent::WinReached {
        winner: policy.winner.clone(),
        reason: format!("{} {} lynched", policy.id, lynched),
        metadata: serde_json::json!({
            "policy": policy.id,
            "target": lynched,
            "role": slot.role_key,
            "source_event": source_event,
        }),
    });
}

fn resolve_last_words(
    input: &ResolutionInput,
    outcome: &DayVoteOutcome,
    killed: &SlotId,
    events: &mut Vec<InnerEvent>,
) {
    if !input.pack.day_notes.last_words.day_deaths || input.state.phase_kind != PhaseKind::Day {
        return;
    }

    let sequence = events
        .iter()
        .filter(|event| matches!(event, InnerEvent::LastWordsRecorded(_)))
        .count() as u32;
    events.push(InnerEvent::LastWordsRecorded(LastWordsRecorded {
        player_id: killed.clone(),
        reason: "lynch".to_string(),
        template_id: input.pack.day_notes.last_words.template_id.clone(),
        audience: input.pack.day_notes.last_words.audience.clone(),
        window: input.pack.day_notes.last_words.window.clone(),
        sequence,
        day: input.state.phase_number,
        phase_id: input.phase_id.clone(),
        vote: LastWordsVoteSummary {
            status: outcome.status,
            winner: outcome.winner.clone(),
            tallies: outcome.tallies.clone(),
            majority: outcome.majority,
            total_weight: outcome.total_weight,
        },
    }));
}

fn resolve_wolf_beauty_drag(
    input: &ResolutionInput,
    beauty_id: &SlotId,
    day_death_cause: &str,
    events: &mut Vec<InnerEvent>,
    deaths: &mut Vec<Death>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    let policy = &input.pack.wolf_beauty;
    if !policy.enabled
        || !policy
            .death_causes
            .iter()
            .any(|cause| cause == day_death_cause)
    {
        return;
    }
    let Some(beauty_role) = slot_role(input, beauty_id) else {
        return;
    };
    if !policy.eligible_roles.iter().any(|role| role == beauty_role) {
        return;
    }
    let Some(mark) = input
        .state
        .wolf_beauty_marks
        .iter()
        .find(|record| &record.beauty_id == beauty_id && record.effect == policy.mark_effect)
    else {
        return;
    };
    let day_state = apply_events(&input.state, events);
    let Some(target_slot) = day_state
        .slots
        .iter()
        .find(|slot| slot.slot_id == mark.target_id)
    else {
        return;
    };
    if !target_slot.is_alive() || deaths.iter().any(|death| death.slot_id == mark.target_id) {
        return;
    }

    trace_decisions.push(DecisionTrace {
        stage: "death:cascade".to_string(),
        source: format!("action:{}", mark.source_action),
        outcome: "wolf_beauty_dragged".to_string(),
        detail: serde_json::json!({
            "beauty_id": beauty_id.clone(),
            "dragged_id": mark.target_id.clone(),
            "mark_effect": mark.effect.clone(),
            "mark_source_action": mark.source_action.clone(),
            "mark_phase_id": mark.phase_id.clone(),
            "mark_phase_kind": mark.phase_kind,
            "mark_phase_number": mark.phase_number,
            "trigger_cause": day_death_cause,
            "cause": policy.drag_cause.clone(),
        }),
    });
    events.push(InnerEvent::WolfBeautyDragged {
        beauty_id: beauty_id.clone(),
        dragged_ids: vec![mark.target_id.clone()],
        cause: policy.drag_cause.clone(),
        phase_id: input.phase_id.clone(),
        phase_kind: input.state.phase_kind,
        phase_number: input.state.phase_number,
    });
    events.push(InnerEvent::PlayerKilled {
        slot_id: mark.target_id.clone(),
        cause: policy.drag_cause.clone(),
        attackers: vec![beauty_id.clone()],
        unstoppable: true,
        death_reveal: death_reveal_mode(input, &mark.target_id, &policy.drag_cause),
    });
    deaths.push(Death {
        slot_id: mark.target_id.clone(),
        cause: policy.drag_cause.clone(),
        template_id: None,
        audience: None,
    });
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
            if !phase_window_matches(template.window, input.state.phase_kind) {
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
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
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
                phase_kind: input.state.phase_kind,
                phase_number: input.state.phase_number,
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
    if input.pack.ita.sessions.is_empty() {
        return;
    }
    let lifecycle = resolve_ita_lifecycle_controls(input, events, trace_decisions);

    let released_submissions = input
        .state
        .buffered_ita_shots
        .iter()
        .filter(|record| record.release_at <= input.logical_time)
        .filter(|record| {
            input.pack.ita.sessions.iter().any(|session| {
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
            if !phase_window_matches(template.window, input.state.phase_kind) {
                return None;
            }
            template
                .has_ability(IrAbility::ItaShot)
                .then_some((sub, template))
        })
        .collect();
    if ordered.is_empty() {
        if lifecycle.opened.is_empty() {
            return;
        }
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
                phase_kind: input.state.phase_kind,
                phase_number: input.state.phase_number,
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
                input.pack.ita.resolution_policy.on_target_already_dead,
                ItaTargetAlreadyDeadPolicy::RefundShot
            );
        if !target_slot.is_alive() {
            if invalidated_by.is_none() && !should_refund_dead_target {
                events.push(InnerEvent::ActionInterfered {
                    actor: sub.actor.clone(),
                    reason: "ita_target_dead".to_string(),
                });
                continue;
            }
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

    for session in &input.pack.ita.sessions {
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
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
        });
        if input.pack.ita.auto_close && buffered == 0 {
            events.push(InnerEvent::ItaSessionClosed {
                session_id: session.session_id.clone(),
                last_status: "open".to_string(),
                phase_id: input.phase_id.clone(),
                phase_kind: input.state.phase_kind,
                phase_number: input.state.phase_number,
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
                detail: serde_json::json!({
                    "control": control.control,
                    "recorded_at": control.recorded_at,
                }),
            });
            continue;
        };
        if !input.pack.ita.lifecycle.allows(control.control) {
            trace_decisions.push(DecisionTrace {
                stage: "ita_session_lifecycle".to_string(),
                source: control.session_id.clone(),
                outcome: "ignored_pack_policy".to_string(),
                detail: serde_json::json!({
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
                phase_kind: input.state.phase_kind,
                phase_number: input.state.phase_number,
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
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
        });
        events.push(InnerEvent::ItaSessionAnnouncement {
            session_id: control.session_id.clone(),
            status: to_status.clone(),
            message: control.message.clone(),
            recorded_at: control.recorded_at,
            phase_id: input.phase_id.clone(),
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
        });
        if matches!(control.control, ItaSessionControlKind::Close) {
            events.push(InnerEvent::ItaSessionClosed {
                session_id: control.session_id.clone(),
                last_status: from_status.clone(),
                phase_id: input.phase_id.clone(),
                phase_kind: input.state.phase_kind,
                phase_number: input.state.phase_number,
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
            detail: serde_json::json!({
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
        phase_window_matches(template.window, input.state.phase_kind)
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
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
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
            if input.pack.wolf_carry.enabled
                && input
                    .pack
                    .wolf_carry
                    .eligible_roles
                    .iter()
                    .any(|role| role == &actor_role)
            {
                self_events.push(InnerEvent::WolfCarryQueued {
                    owner_id: sub.actor.clone(),
                    token_id: input.pack.wolf_carry.token_id.clone(),
                    cause: input.pack.wolf_carry.cause.clone(),
                    role_key: actor_role.clone(),
                    phase_id: input.phase_id.clone(),
                    phase_kind: input.state.phase_kind,
                    phase_number: input.state.phase_number,
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
            input.pack.ita.sessions.iter().find(|session| {
                session.session_id == session_id && ita_session_active(input, session)
            })
        }
        None => input
            .pack
            .ita
            .sessions
            .iter()
            .find(|session| ita_session_active(input, session)),
    }
}

fn ita_session_active(input: &ResolutionInput, session: &ItaSessionSpec) -> bool {
    match session.day {
        Some(day) => day == input.state.phase_number,
        None => true,
    }
}

fn resolve_duel_actions(
    input: &ResolutionInput,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
    trace_notes: &mut Vec<String>,
) {
    let mut ordered: Vec<(&Submission, &ActionTemplate)> = input
        .submissions
        .iter()
        .filter(|sub| !sub.withdrawn)
        .filter_map(|sub| {
            let template = lookup_submission_template(input, sub)?;
            if !phase_window_matches(template.window, input.state.phase_kind) {
                return None;
            }
            template
                .has_ability(IrAbility::Duel)
                .then_some((sub, template))
        })
        .collect();
    ordered.sort_by(|(a, a_template), (b, b_template)| {
        b_template
            .constraints
            .priority
            .cmp(&a_template.constraints.priority)
            .then(a.submitted_at.cmp(&b.submitted_at))
            .then(a.action_id.cmp(&b.action_id))
    });

    let mut day_state = input.state.clone();
    for (sub, template) in ordered {
        let Some(duel) = &template.duel else {
            continue;
        };
        let Some(target) = sub.targets.first().cloned() else {
            continue;
        };
        let Some(actor_slot) = day_state
            .slots
            .iter()
            .find(|slot| slot.slot_id == sub.actor)
        else {
            continue;
        };
        if !actor_slot.is_alive() {
            continue;
        }
        let Some(target_slot) = day_state.slots.iter().find(|slot| slot.slot_id == target) else {
            continue;
        };
        if !target_slot.is_alive() {
            continue;
        }
        let mut duel_events = Vec::new();
        if let Some(limit) = template.constraints.x_shots {
            if action_counter_exhausted(input, &sub.actor, &template.id, limit) {
                events.push(InnerEvent::ActionInterfered {
                    actor: sub.actor.clone(),
                    reason: "x_shot_exhausted".to_string(),
                });
                continue;
            }
            duel_events.push(action_use_counted(
                input,
                sub.actor.clone(),
                template.id.clone(),
                sub.action_id.clone(),
                limit,
            ));
        }

        let success = target_slot.alignment.as_deref().is_some_and(|alignment| {
            duel.hostile_alignments
                .iter()
                .any(|hostile| hostile == alignment)
        });
        let (result, killed) = if success {
            (DuelResult::Success, target.clone())
        } else {
            (DuelResult::Failure, sub.actor.clone())
        };

        duel_events.push(InnerEvent::DuelResolved {
            knight: sub.actor.clone(),
            target: target.clone(),
            result,
            killed: killed.clone(),
            source_action: sub.action_id.clone(),
            phase_id: input.phase_id.clone(),
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
        });
        duel_events.push(InnerEvent::PlayerKilled {
            slot_id: killed.clone(),
            cause: template.id.clone(),
            attackers: vec![sub.actor.clone()],
            unstoppable: true,
            death_reveal: death_reveal_mode(input, &killed, &template.id),
        });
        let mut killed_slots = vec![killed.clone()];
        let mut cpr_saves = BTreeSet::new();
        let generated_kills = apply_trigger_fixpoint(
            input,
            vec![TriggerObservation {
                on: TriggerOn::Ability(IrAbility::Duel),
                target: killed.clone(),
                actor: sub.actor.clone(),
                cause: template.id.clone(),
                target_tags: Vec::new(),
                actor_tags: Vec::new(),
            }],
            &BTreeMap::new(),
            &BTreeMap::new(),
            &mut killed_slots,
            &mut cpr_saves,
            &mut duel_events,
            trace_decisions,
            trace_notes,
        );
        for record in generated_kills {
            trace_decisions.push(DecisionTrace {
                stage: "duel_resolution".to_string(),
                source: format!("trigger:{}", record.cause),
                outcome: "generated_kill_after_duel".to_string(),
                detail: serde_json::json!({
                    "source_action": sub.action_id.clone(),
                    "template_id": template.id.clone(),
                    "duel_killed": killed.clone(),
                    "generated_target": record.target,
                    "generated_attacker": record.attacker,
                    "generated_cause": record.cause,
                }),
            });
        }
        events.extend(duel_events.iter().cloned());
        day_state = apply_events(&day_state, &duel_events);
    }
}

fn ita_hit_chance(
    input: &ResolutionInput,
    session: &ItaSessionSpec,
    actor: &SlotState,
    target: &SlotState,
) -> f64 {
    let actor_override = input.pack.ita.effective_role_override(&actor.role_key);
    let target_override = input.pack.ita.effective_role_override(&target.role_key);
    let base = session
        .hit_chance
        .unwrap_or(input.pack.ita.default_hit_chance);
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

fn active_badge_vote_weights(badges: &[BadgeRecord]) -> BTreeMap<SlotId, f64> {
    badges
        .iter()
        .filter(|badge| !badge.destroyed)
        .filter_map(|badge| Some((badge.owner.clone()?, badge.vote_weight?)))
        .collect()
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
        day_death_announcement_metadata(&input.pack, input.state.phase_kind, deaths);
    PhaseAnnouncement {
        phase_id: input.phase_id.clone(),
        template_id,
        audience,
        deaths,
    }
}

fn tally_votes(
    votes: &BTreeMap<SlotId, SlotId>,
    weights: &BTreeMap<SlotId, f64>,
) -> BTreeMap<SlotId, f64> {
    let mut tallies = BTreeMap::new();
    for (voter, target) in votes {
        let w = weights.get(voter).copied().unwrap_or(0.0);
        *tallies.entry(target.clone()).or_insert(0.0) += w;
    }
    tallies
}

fn role_tiebreaker_winner(
    state: &StateSnapshot,
    contenders: &[SlotId],
    tiebreaker_roles: &[String],
) -> Option<SlotId> {
    if tiebreaker_roles.is_empty() {
        return None;
    }
    contenders.iter().find_map(|contender| {
        let slot = state.slots.iter().find(|slot| &slot.slot_id == contender)?;
        tiebreaker_roles
            .iter()
            .any(|role_key| role_key == &slot.role_key)
            .then(|| contender.clone())
    })
}

fn decide_outcome(
    tallies: &BTreeMap<SlotId, f64>,
    top_contenders: &[SlotId],
    max_tally: f64,
    majority: Option<f64>,
    thresholds: &BTreeMap<SlotId, f64>,
    tie_breaker: VoteTieBreaker,
    role_tiebreaker_winner: Option<SlotId>,
    seed: Seed,
    no_lynch_target: &str,
    force_top_contenders: bool,
    hammer_reached: bool,
) -> (
    VoteStatus,
    Option<SlotId>,
    Vec<SlotId>,
    Option<String>,
    Option<String>,
) {
    if top_contenders.is_empty() || (!force_top_contenders && max_tally <= 0.0) {
        return (VoteStatus::NoLynch, None, Vec::new(), None, None);
    }

    let contenders = if force_top_contenders {
        top_contenders.to_vec()
    } else if let Some(base_threshold) = majority {
        let mut eligible: Vec<(SlotId, f64)> = tallies
            .iter()
            .filter_map(|(slot_id, tally)| {
                let threshold = thresholds.get(slot_id).copied().unwrap_or(base_threshold);
                if *tally > 0.0 && *tally >= threshold {
                    Some((slot_id.clone(), *tally))
                } else {
                    None
                }
            })
            .collect();
        if eligible.is_empty() {
            return (
                VoteStatus::NoMajority,
                None,
                top_contenders.to_vec(),
                None,
                None,
            );
        }
        let eligible_max = eligible
            .iter()
            .map(|(_, tally)| *tally)
            .fold(0.0_f64, f64::max);
        eligible.retain(|(_, tally)| (*tally - eligible_max).abs() < f64::EPSILON);
        eligible
            .into_iter()
            .map(|(slot_id, _)| slot_id)
            .collect::<Vec<_>>()
    } else {
        top_contenders.to_vec()
    };

    if contenders.len() == 1 {
        if contenders[0] == no_lynch_target {
            return (
                VoteStatus::NoLynch,
                None,
                contenders,
                None,
                Some("no_lynch reached the vote threshold".to_string()),
            );
        }
        let status = if hammer_reached {
            VoteStatus::Hammer
        } else {
            VoteStatus::Lynch
        };
        return (status, Some(contenders[0].clone()), contenders, None, None);
    }

    // A tie among multiple contenders.
    if let Some(winner) = role_tiebreaker_winner.filter(|winner| contenders.contains(winner)) {
        return (
            VoteStatus::Lynch,
            Some(winner.clone()),
            contenders,
            Some("RoleTiebreaker".to_string()),
            Some(format!("role tiebreaker selected {winner}")),
        );
    }

    match tie_breaker {
        VoteTieBreaker::NoElimination => {
            let names = contenders.join(" and ");
            (
                VoteStatus::Tie,
                None,
                contenders,
                Some("NoElimination".to_string()),
                Some(format!(
                    "plurality tie between {names}; tie_breaker=NoElimination yields no elimination"
                )),
            )
        }
        // Other tie-breakers are typed but not exercised by the v1 goldens.
        VoteTieBreaker::EarliestReached => (
            VoteStatus::Tie,
            None,
            contenders,
            Some("EarliestReached".to_string()),
            None,
        ),
        VoteTieBreaker::HostDecides => (
            VoteStatus::Tie,
            None,
            contenders,
            Some("HostDecides".to_string()),
            None,
        ),
        VoteTieBreaker::Random => {
            let mut rng = DetRng::new(seed ^ 0x4441_595f_564f_5445);
            let index = (rng.next_u64() as usize) % contenders.len();
            let winner = contenders[index].clone();
            let status = if winner == no_lynch_target {
                VoteStatus::NoLynch
            } else {
                VoteStatus::Lynch
            };
            let eliminated = (status == VoteStatus::Lynch).then_some(winner.clone());
            (
                status,
                eliminated,
                contenders,
                Some("Random".to_string()),
                Some(format!("seeded random tie_breaker selected {winner}")),
            )
        }
    }
}

// Keep TieBreaker referenced for future redirect tie-breaks without a warning.
const _: TieBreaker = TieBreaker::Stable;
