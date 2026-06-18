//! Resolution input state (doc 09): StateSnapshot / SlotState / Submission.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::events::InnerEvent;
use crate::ir::InvestigateMode;
use crate::pack::DeathRevealMode;
use crate::pack::{
    AlignmentKey, EffectDuration, EffectVisibility, GrantKind, PhaseKind, PhasePolicy,
    ResultMemoryScope, RoleKey, Tag,
};

pub type SlotId = String;
pub type GameId = String;
pub type PhaseId = String;
pub type Seed = u64;
pub type LogicalTime = u64;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateSnapshot {
    pub phase_id: PhaseId,
    pub phase_kind: PhaseKind,
    pub phase_number: u32,
    #[serde(default)]
    pub phase_deadline: Option<i64>,
    pub phase_policy: PhasePolicy,
    pub slots: Vec<SlotState>,
    /// Setup-time private channel membership/access folded from platform
    /// `PrivateChannelDeclared` events. Role changes after setup do not
    /// implicitly rewrite this surface.
    #[serde(default)]
    pub private_channels: Vec<PrivateChannelRecord>,
    /// Canonical active persistent effects with provenance and visibility
    /// metadata. `SlotState.effects` remains a derived tag index for hot
    /// resolver predicates; this surface preserves the source/expiry contract.
    #[serde(default)]
    pub effect_records: Vec<EffectRecord>,
    /// Cross-phase action attempts folded from prior `ActionRecorded` inner
    /// events. This is the minimal state needed for cadence constraints such as
    /// non-consecutive actions without re-reading the event log inside the pure
    /// resolver.
    #[serde(default)]
    pub action_history: Vec<ActionUseRecord>,
    /// Typed limited-use/counter state folded from `ActionUseCounted`.
    /// This replaces ad hoc `used:<template_id>` slot-effect tags for x-shot
    /// and similar capability counters.
    #[serde(default)]
    pub use_counters: Vec<ActionCounterRecord>,
    /// Prior investigation baselines folded from `InvestigationMemoryRecorded`.
    /// These are state-bearing resolver facts; `InvestigationResult` remains a
    /// player/admin-facing output event.
    #[serde(default)]
    pub investigation_memory: Vec<InvestigationMemoryRecord>,
    /// Source-aware delayed death queues folded from `DelayedDeathQueued` and
    /// consumed by `DelayedDeathResolved`. Persistent effect tags remain the
    /// visible/clearable handle; this is the future-affecting death state.
    #[serde(default)]
    pub delayed_deaths: Vec<DelayedDeathRecord>,
    /// Source-aware cross-phase visit ledger folded from `VisitRecorded`.
    /// Current tracker/watcher/motion still read the in-resolution action graph;
    /// later policies can read this durable prior-visit surface.
    #[serde(default)]
    pub visit_history: Vec<VisitRecord>,
    /// Cross-phase generated capabilities/items folded from `ActionGranted`.
    /// Command-side legality consumes this in later slices; the resolver owns
    /// deterministic creation and rebuildability.
    #[serde(default)]
    pub action_grants: Vec<ActionGrantRecord>,
    /// First known pre-conversion role/alignment per target slot, folded from
    /// `PlayerConverted`. Deprogramming reads this instead of guessing from the
    /// current role.
    #[serde(default)]
    pub conversion_origins: Vec<ConversionOriginRecord>,
    /// Cross-slot links folded from `PlayersLinked`. Lover suicide and later
    /// linked-state mechanics read this event-derived surface.
    #[serde(default)]
    pub linked_slots: Vec<LinkRecord>,
    /// Death-triggered chosen retaliation facts folded from `RetaliationArmed`.
    /// Hunter-style roles read this durable choice when the actor dies later.
    #[serde(default)]
    pub retaliations: Vec<RetaliationRecord>,
    /// Targeted backup source choices folded from `BackupTargeted`.
    #[serde(default)]
    pub backup_targets: Vec<BackupTargetRecord>,
    /// Target-lynch independent win owner-target assignments folded from
    /// `TargetLynchWinTargeted`.
    #[serde(default)]
    pub target_lynch_win_targets: Vec<TargetLynchWinTargetRecord>,
    /// Pending White Wolf carry tokens folded from `WolfCarryQueued` and consumed
    /// by `WolfCarryUsed`. This is cross-phase engine state, not a slot tag.
    #[serde(default)]
    pub wolf_carry_tokens: Vec<WolfCarryTokenRecord>,
    /// Current Wolf Beauty owner-target charm marks folded from `WolfBeautyMarked`.
    /// These preserve the owner relation that tag-only slot effects cannot hold.
    #[serde(default)]
    pub wolf_beauty_marks: Vec<WolfBeautyMarkRecord>,
    /// Durable badge ownership facts folded from `BadgeChanged`. Sheriff badge
    /// vote weight reads this state during later day vote resolutions.
    #[serde(default)]
    pub badges: Vec<BadgeRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionUseRecord {
    pub actor: SlotId,
    pub template_id: String,
    #[serde(default)]
    pub targets: Vec<SlotId>,
    pub phase_id: PhaseId,
    pub phase_kind: PhaseKind,
    pub phase_number: u32,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrivateChannelRecord {
    pub channel_id: String,
    pub kind: String,
    pub slot_id: SlotId,
    pub role_key: RoleKey,
    pub reveals_alignment: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionCounterRecord {
    pub counter_id: Tag,
    pub actor: SlotId,
    pub template_id: String,
    pub consumed_action: String,
    pub cadence_policy: String,
    pub phase_scope: String,
    pub limit: u16,
    pub used: u16,
    pub remaining: u16,
    pub phase_id: PhaseId,
    pub phase_kind: PhaseKind,
    pub phase_number: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InvestigationMemoryRecord {
    pub investigator: SlotId,
    pub target: SlotId,
    pub mode: InvestigateMode,
    #[serde(default)]
    pub scope: ResultMemoryScope,
    pub result: serde_json::Value,
    pub source_action: String,
    pub template_id: String,
    pub phase_id: PhaseId,
    pub phase_kind: PhaseKind,
    pub phase_number: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DelayedDeathRecord {
    pub queue_id: String,
    pub target: SlotId,
    pub cause: String,
    pub effect: Tag,
    pub source: SlotId,
    pub source_action: String,
    pub phase_id: PhaseId,
    pub phase_kind: PhaseKind,
    pub phase_number: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VisitRecord {
    pub actor: SlotId,
    pub target: SlotId,
    pub template_id: String,
    pub source_action: String,
    pub phase_id: PhaseId,
    pub phase_kind: PhaseKind,
    pub phase_number: u32,
    pub visible: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionGrantRecord {
    pub grant_id: Tag,
    pub kind: GrantKind,
    pub actor: SlotId,
    pub target: SlotId,
    pub source_action: String,
    pub uses: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vote_weight: Option<f64>,
    pub phase_id: PhaseId,
    pub phase_kind: PhaseKind,
    pub phase_number: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConversionOriginRecord {
    pub target: SlotId,
    pub original_role: RoleKey,
    #[serde(default)]
    pub original_alignment: Option<AlignmentKey>,
    pub source: SlotId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinkRecord {
    pub link_id: String,
    pub slots: Vec<SlotId>,
    pub source: SlotId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetaliationRecord {
    pub retaliation_id: String,
    pub actor: SlotId,
    pub target: SlotId,
    pub source_action: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackupTargetRecord {
    pub backup: SlotId,
    pub source_target: SlotId,
    pub source_role: RoleKey,
    pub source_action: String,
    pub phase_id: PhaseId,
    pub phase_kind: PhaseKind,
    pub phase_number: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetLynchWinTargetRecord {
    pub policy: String,
    pub owner: SlotId,
    pub target: SlotId,
    pub effect: Tag,
    pub source_action: String,
    pub phase_id: PhaseId,
    pub phase_kind: PhaseKind,
    pub phase_number: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WolfCarryTokenRecord {
    pub owner_id: SlotId,
    pub token_id: Tag,
    pub cause: String,
    pub role_key: RoleKey,
    pub phase_id: PhaseId,
    pub phase_kind: PhaseKind,
    pub phase_number: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WolfBeautyMarkRecord {
    pub beauty_id: SlotId,
    pub target_id: SlotId,
    pub effect: Tag,
    pub source_action: String,
    pub phase_id: PhaseId,
    pub phase_kind: PhaseKind,
    pub phase_number: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BadgeRecord {
    pub badge_id: Tag,
    #[serde(default)]
    pub owner: Option<SlotId>,
    #[serde(default)]
    pub vote_weight: Option<f64>,
    pub actor: SlotId,
    pub source_action: String,
    pub reason: String,
    pub destroyed: bool,
    pub phase_id: PhaseId,
    pub phase_kind: PhaseKind,
    pub phase_number: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EffectRecord {
    pub effect: Tag,
    pub target: SlotId,
    pub source: SlotId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_id: Option<PhaseId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_kind: Option<PhaseKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_number: Option<u32>,
    #[serde(default)]
    pub duration: EffectDuration,
    #[serde(default)]
    pub visibility: EffectVisibility,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlotLifecycle {
    Alive,
    Dead,
    Modkilled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RevealState {
    Private,
    Public,
}

fn default_reveal_state() -> RevealState {
    RevealState::Private
}

fn death_reveal_states(mode: DeathRevealMode) -> (RevealState, RevealState) {
    match mode {
        DeathRevealMode::Full => (RevealState::Public, RevealState::Public),
        DeathRevealMode::AlignmentOnly => (RevealState::Private, RevealState::Public),
        DeathRevealMode::Concealed => (RevealState::Private, RevealState::Private),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotState {
    pub slot_id: SlotId,
    pub role_key: RoleKey,
    #[serde(default)]
    pub alignment: Option<AlignmentKey>,
    #[serde(default = "default_reveal_state")]
    pub role_reveal: RevealState,
    #[serde(default = "default_reveal_state")]
    pub alignment_reveal: RevealState,
    /// Lifecycle status. Pack-visible modifiers live in `status_tags` instead
    /// of overloading liveness with role/effect facts.
    pub status: SlotLifecycle,
    #[serde(default)]
    pub status_tags: Vec<Tag>,
    #[serde(default)]
    pub effects: Vec<Tag>,
}

impl SlotState {
    pub fn is_alive(&self) -> bool {
        self.status == SlotLifecycle::Alive
    }
}

/// Deterministically fold a resolution's inner events onto a state to produce
/// the next state — the canonical "how state carries forward between
/// resolutions" (doc 09). PURE: no clock, no RNG; a plain left fold whose result
/// depends only on `(state, events)`.
///
/// Mutation contract (only these inner-event kinds change state; all others —
/// `PlayerSaved`, `InvestigationResult`, `DayVoteOutcome`,
/// `PhaseAnnouncement`, … — are no-ops):
///
/// - `PlayerKilled`        → the slot's `status` becomes `"dead"` and its
///   role/alignment reveal follows the event's pack-derived death reveal mode.
/// - `SlotStatusTagged`    → adds a durable, pack-visible status tag to a slot.
/// - `EffectsMarked`       → adds `effect` to the slot's `effects` index and upserts
///   an active `EffectRecord` with source/phase/expiry/visibility metadata.
/// - `EffectsCleared`      → removes `effect` from each named slot's `effects` index
///   and from active `EffectRecord`s for those targets.
/// - `PlayerConverted`     → sets the slot's `role_key` to `new_role` AND its
///   `alignment` to `new_alignment` (R2: a conversion is a faction change, not
///   merely a role swap; the win-check reads alignment) and records the first
///   conversion-origin fact for that target.
/// - `AlignmentRevealed`   → exposes a slot's alignment without exposing role.
/// - `RoleRevealed`        → exposes a slot's role without exposing alignment.
/// - `VoteDuelDeclared`    → resolution-scoped day vote restriction; no
///   cross-phase state is folded.
/// - `VoteVetoed`          → cancels a same-resolution day vote death; no
///   cross-phase state is folded.
/// - `ActionRecorded`      → appends a cross-phase action-use record.
/// - `ActionUseCounted`    → upserts a typed limited-use/counter fact.
/// - `InvestigationMemoryRecorded` → upserts a prior investigation baseline.
/// - `DelayedDeathQueued`  → upserts a future death queue fact.
/// - `DelayedDeathResolved` → consumes a future death queue fact.
/// - `VisitRecorded`       → appends a source-aware prior visit fact.
/// - `ActionGranted`       → appends a cross-phase generated capability/item fact.
/// - `ActionGrantConsumed` → decrements the explicitly sourced generated grant.
/// - `PlayersLinked`       → appends a cross-slot link fact if its id is new.
/// - `RetaliationArmed`    → upserts a death-triggered chosen retaliation fact.
/// - `WolfCarryQueued`     → upserts a pending carry token for the White Wolf owner.
/// - `WolfCarryUsed`       → consumes the pending carry token for the White Wolf owner.
/// - `WolfBeautyMarked`    → upserts the current Wolf Beauty owner-target mark.
/// - `BadgeChanged`        → upserts current badge owner/weight for later day votes.
/// - `WinReached`          → reveals every slot's role/alignment to public post-game state.
///
/// `phase_kind` / `phase_number` are carried through unchanged: advancing the
/// phase cursor is the engine/platform's job, not this fold's.
pub fn apply_events(state: &StateSnapshot, events: &[InnerEvent]) -> StateSnapshot {
    let mut next = state.clone();
    for event in events {
        match event {
            InnerEvent::PlayerKilled {
                slot_id,
                death_reveal,
                ..
            } => {
                if let Some(slot) = next.slots.iter_mut().find(|s| &s.slot_id == slot_id) {
                    slot.status = SlotLifecycle::Dead;
                    let (role_reveal, alignment_reveal) = death_reveal_states(*death_reveal);
                    slot.role_reveal = role_reveal;
                    slot.alignment_reveal = alignment_reveal;
                }
            }
            InnerEvent::SlotStatusTagged { slot_id, tag, .. } => {
                if let Some(slot) = next.slots.iter_mut().find(|s| &s.slot_id == slot_id) {
                    if !slot.status_tags.contains(tag) {
                        slot.status_tags.push(tag.clone());
                        slot.status_tags.sort();
                    }
                }
            }
            InnerEvent::WinReached { .. } => {
                for slot in &mut next.slots {
                    slot.role_reveal = RevealState::Public;
                    slot.alignment_reveal = RevealState::Public;
                }
            }
            InnerEvent::AlignmentRevealed {
                slot_id, alignment, ..
            } => {
                if let Some(slot) = next.slots.iter_mut().find(|s| &s.slot_id == slot_id) {
                    slot.alignment = Some(alignment.clone());
                    slot.alignment_reveal = RevealState::Public;
                }
            }
            InnerEvent::RoleRevealed {
                slot_id, role_key, ..
            } => {
                if let Some(slot) = next.slots.iter_mut().find(|s| &s.slot_id == slot_id) {
                    slot.role_key = role_key.clone();
                    slot.role_reveal = RevealState::Public;
                }
            }
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
                if *duration == EffectDuration::Persistent {
                    if let Some(slot) = next.slots.iter_mut().find(|s| &s.slot_id == target) {
                        if !slot.effects.contains(effect) {
                            slot.effects.push(effect.clone());
                        }
                    }
                    next.effect_records
                        .retain(|record| record.effect != *effect || record.target != *target);
                    next.effect_records.push(EffectRecord {
                        effect: effect.clone(),
                        target: target.clone(),
                        source: actor.clone(),
                        source_action: source_action.clone(),
                        phase_id: phase_id.clone(),
                        phase_kind: *phase_kind,
                        phase_number: *phase_number,
                        duration: *duration,
                        visibility: *visibility,
                    });
                }
            }
            InnerEvent::EffectsCleared {
                effect, targets, ..
            } => {
                for target in targets {
                    if let Some(slot) = next.slots.iter_mut().find(|s| &s.slot_id == target) {
                        slot.effects.retain(|e| e != effect);
                    }
                }
                next.effect_records.retain(|record| {
                    record.effect != *effect
                        || !targets.iter().any(|target| target == &record.target)
                });
            }
            InnerEvent::PlayerConverted {
                target,
                new_role,
                new_alignment,
                original_role,
                original_alignment,
                source,
                ..
            } => {
                if let Some(slot) = next.slots.iter_mut().find(|s| &s.slot_id == target) {
                    slot.role_key = new_role.clone();
                    slot.alignment = new_alignment.clone();
                }
                if !next
                    .conversion_origins
                    .iter()
                    .any(|origin| &origin.target == target)
                {
                    next.conversion_origins.push(ConversionOriginRecord {
                        target: target.clone(),
                        original_role: original_role.clone(),
                        original_alignment: original_alignment.clone(),
                        source: source.clone(),
                    });
                }
            }
            InnerEvent::ActionRecorded {
                actor,
                template_id,
                targets,
                phase_id,
                phase_kind,
                phase_number,
                status,
            } => {
                next.action_history.push(ActionUseRecord {
                    actor: actor.clone(),
                    template_id: template_id.clone(),
                    targets: targets.clone(),
                    phase_id: phase_id.clone(),
                    phase_kind: *phase_kind,
                    phase_number: *phase_number,
                    status: status.clone(),
                });
            }
            InnerEvent::ActionUseCounted {
                counter_id,
                actor,
                template_id,
                consumed_action,
                cadence_policy,
                phase_scope,
                limit,
                used,
                remaining,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                next.use_counters
                    .retain(|record| record.actor != *actor || record.counter_id != *counter_id);
                next.use_counters.push(ActionCounterRecord {
                    counter_id: counter_id.clone(),
                    actor: actor.clone(),
                    template_id: template_id.clone(),
                    consumed_action: consumed_action.clone(),
                    cadence_policy: cadence_policy.clone(),
                    phase_scope: phase_scope.clone(),
                    limit: *limit,
                    used: *used,
                    remaining: *remaining,
                    phase_id: phase_id.clone(),
                    phase_kind: *phase_kind,
                    phase_number: *phase_number,
                });
            }
            InnerEvent::InvestigationMemoryRecorded {
                investigator,
                target,
                mode,
                scope,
                result,
                source_action,
                template_id,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                next.investigation_memory.retain(|record| {
                    if *scope == ResultMemoryScope::Investigator {
                        record.investigator != *investigator || record.mode != *mode
                    } else {
                        record.investigator != *investigator
                            || record.target != *target
                            || record.mode != *mode
                    }
                });
                next.investigation_memory.push(InvestigationMemoryRecord {
                    investigator: investigator.clone(),
                    target: target.clone(),
                    mode: *mode,
                    scope: *scope,
                    result: result.clone(),
                    source_action: source_action.clone(),
                    template_id: template_id.clone(),
                    phase_id: phase_id.clone(),
                    phase_kind: *phase_kind,
                    phase_number: *phase_number,
                });
            }
            InnerEvent::DelayedDeathQueued {
                queue_id,
                target,
                cause,
                effect,
                source,
                source_action,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                next.delayed_deaths
                    .retain(|record| record.target != *target || record.effect != *effect);
                next.delayed_deaths.push(DelayedDeathRecord {
                    queue_id: queue_id.clone(),
                    target: target.clone(),
                    cause: cause.clone(),
                    effect: effect.clone(),
                    source: source.clone(),
                    source_action: source_action.clone(),
                    phase_id: phase_id.clone(),
                    phase_kind: *phase_kind,
                    phase_number: *phase_number,
                });
            }
            InnerEvent::DelayedDeathResolved { queue_id, .. } => {
                next.delayed_deaths
                    .retain(|record| record.queue_id != *queue_id);
            }
            InnerEvent::VisitRecorded {
                actor,
                target,
                template_id,
                source_action,
                phase_id,
                phase_kind,
                phase_number,
                visible,
            } => {
                if !next.visit_history.iter().any(|record| {
                    record.actor == *actor
                        && record.target == *target
                        && record.source_action == *source_action
                }) {
                    next.visit_history.push(VisitRecord {
                        actor: actor.clone(),
                        target: target.clone(),
                        template_id: template_id.clone(),
                        source_action: source_action.clone(),
                        phase_id: phase_id.clone(),
                        phase_kind: *phase_kind,
                        phase_number: *phase_number,
                        visible: *visible,
                    });
                }
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
                next.action_grants.push(ActionGrantRecord {
                    grant_id: grant_id.clone(),
                    kind: *kind,
                    actor: actor.clone(),
                    target: target.clone(),
                    source_action: source_action.clone(),
                    uses: *uses,
                    vote_weight: *vote_weight,
                    phase_id: phase_id.clone(),
                    phase_kind: *phase_kind,
                    phase_number: *phase_number,
                });
            }
            InnerEvent::ActionGrantConsumed {
                grant_id,
                actor,
                source_action,
                ..
            } => {
                if let Some(grant) = next
                    .action_grants
                    .iter_mut()
                    .filter(|grant| {
                        grant.target == *actor
                            && grant.grant_id == *grant_id
                            && grant.source_action == *source_action
                            && grant.uses > 0
                    })
                    .min_by(|a, b| {
                        a.phase_number
                            .cmp(&b.phase_number)
                            .then(a.phase_id.cmp(&b.phase_id))
                            .then(a.actor.cmp(&b.actor))
                    })
                {
                    grant.uses = grant.uses.saturating_sub(1);
                }
            }
            InnerEvent::PlayersLinked {
                link_id,
                slots,
                source,
            } => {
                if !next
                    .linked_slots
                    .iter()
                    .any(|link| &link.link_id == link_id)
                {
                    next.linked_slots.push(LinkRecord {
                        link_id: link_id.clone(),
                        slots: slots.clone(),
                        source: source.clone(),
                    });
                }
            }
            InnerEvent::RetaliationArmed {
                retaliation_id,
                actor,
                target,
                source_action,
            } => {
                next.retaliations
                    .retain(|record| record.retaliation_id != *retaliation_id);
                next.retaliations.push(RetaliationRecord {
                    retaliation_id: retaliation_id.clone(),
                    actor: actor.clone(),
                    target: target.clone(),
                    source_action: source_action.clone(),
                });
            }
            InnerEvent::BackupTargeted {
                backup,
                source_target,
                source_role,
                source_action,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                next.backup_targets
                    .retain(|record| record.backup != *backup);
                next.backup_targets.push(BackupTargetRecord {
                    backup: backup.clone(),
                    source_target: source_target.clone(),
                    source_role: source_role.clone(),
                    source_action: source_action.clone(),
                    phase_id: phase_id.clone(),
                    phase_kind: *phase_kind,
                    phase_number: *phase_number,
                });
            }
            InnerEvent::TargetLynchWinTargeted {
                policy,
                owner,
                target,
                effect,
                source_action,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                next.target_lynch_win_targets
                    .retain(|record| record.policy != *policy || record.owner != *owner);
                next.target_lynch_win_targets
                    .push(TargetLynchWinTargetRecord {
                        policy: policy.clone(),
                        owner: owner.clone(),
                        target: target.clone(),
                        effect: effect.clone(),
                        source_action: source_action.clone(),
                        phase_id: phase_id.clone(),
                        phase_kind: *phase_kind,
                        phase_number: *phase_number,
                    });
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
                next.wolf_carry_tokens
                    .retain(|record| record.owner_id != *owner_id);
                next.wolf_carry_tokens.push(WolfCarryTokenRecord {
                    owner_id: owner_id.clone(),
                    token_id: token_id.clone(),
                    cause: cause.clone(),
                    role_key: role_key.clone(),
                    phase_id: phase_id.clone(),
                    phase_kind: *phase_kind,
                    phase_number: *phase_number,
                });
            }
            InnerEvent::WolfCarryUsed { owner_id, .. } => {
                next.wolf_carry_tokens
                    .retain(|record| record.owner_id != *owner_id);
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
                next.wolf_beauty_marks
                    .retain(|record| record.beauty_id != *beauty_id);
                next.wolf_beauty_marks.push(WolfBeautyMarkRecord {
                    beauty_id: beauty_id.clone(),
                    target_id: target_id.clone(),
                    effect: effect.clone(),
                    source_action: source_action.clone(),
                    phase_id: phase_id.clone(),
                    phase_kind: *phase_kind,
                    phase_number: *phase_number,
                });
            }
            InnerEvent::BadgeChanged {
                badge_id,
                owner,
                vote_weight,
                actor,
                source_action,
                reason,
                destroyed,
                phase_id,
                phase_kind,
                phase_number,
                ..
            } => {
                next.badges.retain(|record| record.badge_id != *badge_id);
                next.badges.push(BadgeRecord {
                    badge_id: badge_id.clone(),
                    owner: owner.clone(),
                    vote_weight: *vote_weight,
                    actor: actor.clone(),
                    source_action: source_action.clone(),
                    reason: reason.clone(),
                    destroyed: *destroyed,
                    phase_id: phase_id.clone(),
                    phase_kind: *phase_kind,
                    phase_number: *phase_number,
                });
            }
            // All other inner events leave state unchanged.
            _ => {}
        }
    }
    next
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Submission {
    pub action_id: String,
    pub actor: SlotId,
    pub template_id: String,
    #[serde(default)]
    pub targets: Vec<SlotId>,
    pub phase_id: PhaseId,
    pub submitted_at: LogicalTime,
    #[serde(default)]
    pub withdrawn: bool,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}
