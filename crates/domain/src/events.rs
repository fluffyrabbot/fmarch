//! Engine resolution events: the closed, enumerated inner event set (doc 10).

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::ir::InvestigateMode;
use crate::pack::{
    default_death_reveal_mode, is_default_death_reveal_mode, DeathRevealMode, EffectDuration,
    EffectVisibility, GrantKind, PhaseKind, RoleKey, Tag,
};
use crate::state::{LogicalTime, PhaseId, Seed, SlotId};

/// The closed, enumerated set of inner domain events (doc 10).
///
/// Serializes as `{ "kind": <variant>, "payload": { .. } }` via the
/// adjacently-tagged representation, matching the goldens' event shape (the
/// outer `index` is attached at the `resolution.applied` envelope layer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload")]
#[serde(deny_unknown_fields)]
pub enum InnerEvent {
    // ── Day flow ──
    DayVoteRecorded {
        actor: SlotId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target: Option<SlotId>,
        withdrawn: bool,
        sequence: u64,
    },
    DayVoteOutcome(DayVoteOutcome),
    VoteVetoed {
        governor: SlotId,
        target: SlotId,
        source_action: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    DayAnnouncement(DayAnnouncement),
    LastWordsRecorded(LastWordsRecorded),
    HostPromptIssued(HostPromptIssued),
    PhaseAnnouncement(PhaseAnnouncement),

    // ── Core night results ──
    PlayerKilled {
        slot_id: SlotId,
        cause: String,
        attackers: Vec<SlotId>,
        unstoppable: bool,
        #[serde(
            default = "default_death_reveal_mode",
            skip_serializing_if = "is_default_death_reveal_mode"
        )]
        death_reveal: DeathRevealMode,
    },
    SlotStatusTagged {
        slot_id: SlotId,
        tag: Tag,
        source: String,
    },
    PlayerSaved {
        slot_id: SlotId,
        reasons: Vec<String>,
        sources: Vec<SlotId>,
    },
    PlayerConverted {
        target: SlotId,
        new_role: RoleKey,
        new_alignment: Option<crate::pack::AlignmentKey>,
        original_role: RoleKey,
        original_alignment: Option<crate::pack::AlignmentKey>,
        source: SlotId,
    },
    ConversionBlocked {
        target: SlotId,
        status: String,
        reason: String,
    },

    // ── Persistent effects (Mark/Clear) ──
    EffectsMarked {
        effect: Tag,
        target: SlotId,
        actor: SlotId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source_action: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        phase_id: Option<PhaseId>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        phase_kind: Option<PhaseKind>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        phase_number: Option<u32>,
        #[serde(default)]
        duration: EffectDuration,
        #[serde(default)]
        visibility: EffectVisibility,
    },
    EffectsCleared {
        effect: Tag,
        targets: Vec<SlotId>,
        actor: SlotId,
    },
    ActionGranted {
        grant_id: Tag,
        kind: GrantKind,
        actor: SlotId,
        target: SlotId,
        source_action: String,
        uses: u16,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        vote_weight: Option<f64>,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    ActionGrantConsumed {
        grant_id: Tag,
        actor: SlotId,
        action_id: String,
        source_action: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
        remaining_uses: u16,
    },
    ActionUseCounted {
        counter_id: Tag,
        actor: SlotId,
        template_id: String,
        consumed_action: String,
        cadence_policy: String,
        phase_scope: String,
        limit: u16,
        used: u16,
        remaining: u16,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    BadgeChanged {
        badge_id: Tag,
        owner: Option<SlotId>,
        previous_owner: Option<SlotId>,
        vote_weight: Option<f64>,
        actor: SlotId,
        source_action: String,
        reason: String,
        destroyed: bool,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    DuelResolved {
        knight: SlotId,
        target: SlotId,
        result: DuelResult,
        killed: SlotId,
        source_action: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    WolfSelfDestructed {
        wolf_id: SlotId,
        target_id: SlotId,
        cause: String,
        unstoppable: bool,
        source_action: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    WolfCarryQueued {
        owner_id: SlotId,
        token_id: Tag,
        cause: String,
        role_key: RoleKey,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    WolfCarryUsed {
        owner_id: SlotId,
        target_id: SlotId,
        source_action_id: String,
        effect_id: String,
        role_key: RoleKey,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    WolfBeautyMarked {
        beauty_id: SlotId,
        target_id: SlotId,
        effect: Tag,
        source_action: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    WolfBeautyDragged {
        beauty_id: SlotId,
        dragged_ids: Vec<SlotId>,
        cause: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    ItaSessionOpened {
        session_id: String,
        label: Option<String>,
        day: Option<u32>,
        window: Option<String>,
        status: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    ItaSessionLifecycleChanged {
        session_id: String,
        control: crate::pack::ItaSessionControlKind,
        from_status: String,
        to_status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        recorded_at: crate::state::LogicalTime,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    ItaSessionAnnouncement {
        session_id: String,
        status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        recorded_at: crate::state::LogicalTime,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    ItaShotQueued {
        session_id: String,
        action_id: String,
        actor: SlotId,
        targets: Vec<SlotId>,
        submitted_at: u64,
        queue_position: u32,
        queue_length: u32,
        previous_queue_length: u32,
        counters: ItaCounters,
    },
    ItaShotBuffered {
        session_id: String,
        action_id: String,
        template_id: String,
        actor_id: SlotId,
        targets: Vec<SlotId>,
        submitted_at: u64,
        release_at: u64,
        delay_ms: u64,
    },
    ItaShotInvalidated {
        session_id: String,
        action_id: String,
        actor_id: SlotId,
        target_id: SlotId,
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        invalidated_by: Option<String>,
        submitted_at: u64,
        timestamp: u64,
    },
    ItaShotResolved {
        session_id: String,
        action_id: String,
        actor: SlotId,
        target: SlotId,
        outcome: ItaShotOutcome,
        hit_chance: f64,
        roll: f64,
        kill: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        shield_before: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        shield_after: Option<u32>,
        #[serde(default, skip_serializing_if = "is_false")]
        shield_spent: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hp_before: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hp_after: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        protection_path: Option<String>,
        submitted_at: u64,
        timestamp: u64,
        counters: ItaCounters,
    },
    ItaShotRefunded {
        session_id: String,
        action_id: String,
        actor_id: SlotId,
        target_id: SlotId,
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        policy: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hit_chance: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        roll: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hp_before: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hp_after: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        protection_path: Option<String>,
        submitted_at: u64,
        timestamp: u64,
        counters: ItaCounters,
    },
    ItaSessionUpdated {
        session_id: String,
        queue_length: u32,
        queue_delta: i32,
        shots_resolved: u32,
        global_shots_fired: u32,
        counters: ItaCounters,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    ItaSessionClosed {
        session_id: String,
        last_status: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    PlayersLinked {
        link_id: String,
        slots: Vec<SlotId>,
        source: SlotId,
    },
    RetaliationArmed {
        retaliation_id: String,
        actor: SlotId,
        target: SlotId,
        source_action: String,
    },
    BackupTargeted {
        backup: SlotId,
        source_target: SlotId,
        source_role: RoleKey,
        source_action: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    TargetLynchWinTargeted {
        policy: String,
        owner: SlotId,
        target: SlotId,
        effect: Tag,
        source_action: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    DelayedDeathQueued {
        queue_id: String,
        target: SlotId,
        cause: String,
        effect: Tag,
        source: SlotId,
        source_action: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    DelayedDeathResolved {
        queue_id: String,
        target: SlotId,
        cause: String,
        effect: Tag,
        outcome: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    VisitRecorded {
        actor: SlotId,
        target: SlotId,
        template_id: String,
        source_action: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
        visible: bool,
    },

    // ── Information ──
    InvestigationResult {
        mode: InvestigateMode,
        investigator: SlotId,
        target: SlotId,
        result: serde_json::Value,
    },
    InfoResult {
        actor: SlotId,
        target: SlotId,
        kind: String,
        audience: Vec<SlotId>,
        result: serde_json::Value,
        source_action: String,
        template_id: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    InvestigationMemoryRecorded {
        investigator: SlotId,
        target: SlotId,
        mode: InvestigateMode,
        #[serde(
            default,
            skip_serializing_if = "crate::pack::ResultMemoryScope::is_default"
        )]
        scope: crate::pack::ResultMemoryScope,
        result: serde_json::Value,
        source_action: String,
        template_id: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    AlignmentRevealed {
        slot_id: SlotId,
        alignment: crate::pack::AlignmentKey,
        source_action: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    RoleRevealed {
        slot_id: SlotId,
        role_key: RoleKey,
        source_action: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    VoteDuelDeclared {
        challenger: SlotId,
        target: SlotId,
        source_action: String,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
    },
    EffectNotification {
        effect: Tag,
        status: String,
        audience: Vec<SlotId>,
    },

    // ── Interference ──
    ActionIngestHalted {
        action_id: String,
        actor: SlotId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        actor_role: Option<RoleKey>,
        template_id: String,
        targets: Vec<SlotId>,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        grant_id: Option<String>,
    },
    ActionInterfered {
        actor: SlotId,
        reason: String,
    },
    ActionRecorded {
        actor: SlotId,
        template_id: String,
        targets: Vec<SlotId>,
        phase_id: PhaseId,
        phase_kind: crate::pack::PhaseKind,
        phase_number: u32,
        status: String,
    },

    // ── Reactive ──
    Trigger {
        trigger_id: String,
        payload: serde_json::Value,
    },

    // ── Win conditions ──
    WinReached {
        winner: String,
        reason: String,
        metadata: serde_json::Value,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VoteStatus {
    Lynch,
    NoLynch,
    NoMajority,
    Tie,
    Hammer,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DayVoteOutcome {
    pub status: VoteStatus,
    pub winner: Option<SlotId>,
    pub contenders: Vec<SlotId>,
    pub tallies: BTreeMap<SlotId, f64>,
    pub votes: BTreeMap<SlotId, SlotId>,
    pub weights: BTreeMap<SlotId, f64>,
    pub majority: Option<f64>,
    pub thresholds: BTreeMap<SlotId, f64>,
    pub total_weight: f64,
    pub tiebreak: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DayAnnouncement {
    pub player_id: SlotId,
    pub cause: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audience: Option<String>,
    pub source_action_id: Option<String>,
    pub attackers: Vec<SlotId>,
    pub unstoppable: bool,
    pub role_key: Option<RoleKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_payload: Option<crate::pack::DayNoteRolePayload>,
    pub recorded_at: Option<LogicalTime>,
    pub sequence: u32,
    pub day: u32,
    pub night: u32,
    pub phase_id: PhaseId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LastWordsRecorded {
    pub player_id: SlotId,
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audience: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
    pub sequence: u32,
    pub day: u32,
    pub phase_id: PhaseId,
    pub vote: LastWordsVoteSummary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LastWordsVoteSummary {
    pub status: VoteStatus,
    pub winner: Option<SlotId>,
    pub tallies: BTreeMap<SlotId, f64>,
    pub majority: Option<f64>,
    pub total_weight: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostPromptIssued {
    pub prompt_id: String,
    pub kind: String,
    pub subject: Option<SlotId>,
    pub reason: String,
    pub phase_id: PhaseId,
    pub phase_kind: crate::pack::PhaseKind,
    pub phase_number: u32,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PhaseAnnouncement {
    pub phase_id: PhaseId,
    pub deaths: Vec<Death>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Death {
    pub slot_id: SlotId,
    pub cause: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DuelResult {
    Success,
    Failure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ItaShotOutcome {
    Hit,
    Miss,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct ItaCounters {
    pub global_shots_fired: u32,
    pub shots_resolved: u32,
    pub hits_landed: u32,
    pub shots_missed: u32,
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub shots_blocked: u32,
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub shots_refunded: u32,
    #[serde(default)]
    pub per_shooter: BTreeMap<SlotId, u32>,
    #[serde(default)]
    pub per_target: BTreeMap<SlotId, u32>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub shields_remaining: BTreeMap<SlotId, u32>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub shields_spent: BTreeMap<SlotId, u32>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub hp_remaining: BTreeMap<SlotId, u32>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub hp_damage: BTreeMap<SlotId, u32>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub refunded_by_reason: BTreeMap<String, u32>,
}

fn is_zero_u32(value: &u32) -> bool {
    *value == 0
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// The `resolution.applied` envelope wrapping the ordered inner events (doc 10).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolutionApplied {
    pub phase_id: PhaseId,
    pub phase_kind: crate::pack::PhaseKind,
    pub phase_number: u32,
    pub run_id: String,
    pub result_version: u16,
    pub seed: Seed,
    pub counts: ResolutionCounts,
    pub events: Vec<IndexedEvent>,
    pub started_at: crate::state::LogicalTime,
    pub finished_at: crate::state::LogicalTime,
}

/// An inner event with its stable index, as carried in `resolution.applied`.
/// Serializes as `{ "index": N, "kind": .., "payload": .. }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IndexedEvent {
    pub index: usize,
    #[serde(flatten)]
    pub event: InnerEvent,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolutionCounts {
    pub events: usize,
    pub kills: usize,
    pub saves: usize,
}

pub const TRACE_VERSION: u16 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolutionTrace {
    pub phase_id: PhaseId,
    pub run_id: String,
    pub trace_version: u16,
    pub edges: Vec<TraceEdge>,
    pub generated: Vec<GeneratedActionTrace>,
    pub effect_changes: Vec<EffectDeltaTrace>,
    pub visibility: Vec<VisibilityTrace>,
    pub decisions: Vec<DecisionTrace>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TraceEdge {
    pub from: String,
    pub to: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeneratedActionTrace {
    pub action_id: String,
    pub source: String,
    pub actor: SlotId,
    pub targets: Vec<SlotId>,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EffectDeltaTrace {
    pub effect: Tag,
    pub target: SlotId,
    pub operation: String,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VisibilityTrace {
    pub audience: Vec<SlotId>,
    pub event_index: usize,
    pub policy: String,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DecisionTrace {
    pub stage: String,
    pub source: String,
    pub outcome: String,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResultValidationError {
    MalformedJson(String),
    MalformedTraceJson(String),
    UnsupportedResultVersion {
        expected: u16,
        actual: u16,
    },
    UnsupportedTraceVersion {
        expected: u16,
        actual: u16,
    },
    EmptyRunId,
    CountMismatch {
        field: &'static str,
        expected: usize,
        actual: usize,
    },
    IndexMismatch {
        expected: usize,
        actual: usize,
    },
    TimeOrder {
        started_at: u64,
        finished_at: u64,
    },
    InvestigationResultInvariant(String),
    PhaseAnnouncementInvariant(String),
}

impl fmt::Display for ResultValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ResultValidationError::MalformedJson(message) => {
                write!(f, "malformed resolution payload: {message}")
            }
            ResultValidationError::MalformedTraceJson(message) => {
                write!(f, "malformed resolution trace payload: {message}")
            }
            ResultValidationError::UnsupportedResultVersion { expected, actual } => {
                write!(
                    f,
                    "unsupported result_version {actual}; expected {expected}"
                )
            }
            ResultValidationError::UnsupportedTraceVersion { expected, actual } => {
                write!(f, "unsupported trace_version {actual}; expected {expected}")
            }
            ResultValidationError::EmptyRunId => write!(f, "run_id must not be empty"),
            ResultValidationError::CountMismatch {
                field,
                expected,
                actual,
            } => write!(
                f,
                "counts.{field} mismatch: expected {expected}, got {actual}"
            ),
            ResultValidationError::IndexMismatch { expected, actual } => {
                write!(f, "event index mismatch: expected {expected}, got {actual}")
            }
            ResultValidationError::TimeOrder {
                started_at,
                finished_at,
            } => write!(
                f,
                "finished_at {finished_at} must be >= started_at {started_at}"
            ),
            ResultValidationError::InvestigationResultInvariant(message) => {
                write!(f, "investigation result invariant failed: {message}")
            }
            ResultValidationError::PhaseAnnouncementInvariant(message) => {
                write!(f, "phase announcement invariant failed: {message}")
            }
        }
    }
}

impl std::error::Error for ResultValidationError {}

/// Validate a raw `ResolutionApplied` JSON payload before it crosses a storage
/// boundary. Unknown inner event kinds, missing payload fields, and unknown
/// extra fields fail during strict serde decoding; aggregate and ordering
/// invariants are checked below.
pub fn validate_resolution_json(
    value: &serde_json::Value,
    expected_result_version: u16,
) -> Result<ResolutionApplied, ResultValidationError> {
    let applied: ResolutionApplied = serde_json::from_value(value.clone())
        .map_err(|err| ResultValidationError::MalformedJson(err.to_string()))?;
    validate_resolution_applied(&applied, expected_result_version)?;
    Ok(applied)
}

pub fn validate_resolution_applied(
    applied: &ResolutionApplied,
    expected_result_version: u16,
) -> Result<(), ResultValidationError> {
    if applied.result_version != expected_result_version {
        return Err(ResultValidationError::UnsupportedResultVersion {
            expected: expected_result_version,
            actual: applied.result_version,
        });
    }
    if applied.run_id.is_empty() {
        return Err(ResultValidationError::EmptyRunId);
    }
    if applied.finished_at < applied.started_at {
        return Err(ResultValidationError::TimeOrder {
            started_at: applied.started_at,
            finished_at: applied.finished_at,
        });
    }

    for (expected, indexed) in applied.events.iter().enumerate() {
        if indexed.index != expected {
            return Err(ResultValidationError::IndexMismatch {
                expected,
                actual: indexed.index,
            });
        }
    }

    let events = applied.events.len();
    if applied.counts.events != events {
        return Err(ResultValidationError::CountMismatch {
            field: "events",
            expected: events,
            actual: applied.counts.events,
        });
    }

    let kills = applied
        .events
        .iter()
        .filter(|indexed| matches!(indexed.event, InnerEvent::PlayerKilled { .. }))
        .count();
    if applied.counts.kills != kills {
        return Err(ResultValidationError::CountMismatch {
            field: "kills",
            expected: kills,
            actual: applied.counts.kills,
        });
    }

    let saves = applied
        .events
        .iter()
        .filter(|indexed| matches!(indexed.event, InnerEvent::PlayerSaved { .. }))
        .count();
    if applied.counts.saves != saves {
        return Err(ResultValidationError::CountMismatch {
            field: "saves",
            expected: saves,
            actual: applied.counts.saves,
        });
    }

    validate_investigation_result_invariant(applied)?;
    validate_phase_announcement_invariant(applied)?;

    Ok(())
}

fn validate_investigation_result_invariant(
    applied: &ResolutionApplied,
) -> Result<(), ResultValidationError> {
    for indexed in &applied.events {
        let InnerEvent::InvestigationResult { mode, result, .. } = &indexed.event else {
            continue;
        };
        if matches!(mode, crate::ir::InvestigateMode::Parity) {
            if result.as_str().is_some() {
                continue;
            }
            if let Some(object) = result.as_object() {
                validate_investigation_result_object(
                    indexed.index,
                    *mode,
                    object,
                    &["changed", "current", "previous"],
                )?;
                continue;
            }
            if result.as_str().is_none() {
                return Err(ResultValidationError::InvestigationResultInvariant(
                    format!(
                        "event {} mode {mode:?} result must be a string or comparison object",
                        indexed.index
                    ),
                ));
            }
            continue;
        }
        let object = result.as_object().ok_or_else(|| {
            ResultValidationError::InvestigationResultInvariant(format!(
                "event {} mode {mode:?} result must be an object",
                indexed.index
            ))
        })?;
        let expected_keys: &[&str] = match mode {
            crate::ir::InvestigateMode::Vanilla => &["vanilla"],
            crate::ir::InvestigateMode::Neapolitan => &["vanilla_town"],
            crate::ir::InvestigateMode::Gunsmith => &["has_gun"],
            crate::ir::InvestigateMode::Killer => &["killer"],
            crate::ir::InvestigateMode::Specialist => &["specialist"],
            crate::ir::InvestigateMode::PtAccess => &["pt_access"],
            crate::ir::InvestigateMode::Role => &["role"],
            crate::ir::InvestigateMode::FullRole => &["alignment", "role"],
            crate::ir::InvestigateMode::Track => &["visited"],
            crate::ir::InvestigateMode::Watch => &["visitors"],
            crate::ir::InvestigateMode::RoleWatcher | crate::ir::InvestigateMode::RoleGuard => {
                &["visitor_roles"]
            }
            crate::ir::InvestigateMode::SecurityGuard => &["visitors"],
            crate::ir::InvestigateMode::Voyeur => &["actions"],
            crate::ir::InvestigateMode::ActionType => &["action_types"],
            crate::ir::InvestigateMode::Motion => &["motion"],
            crate::ir::InvestigateMode::PriorMotion => &["prior_motion"],
            crate::ir::InvestigateMode::Parity => unreachable!("Parity handled above"),
        };
        validate_investigation_result_object(indexed.index, *mode, object, expected_keys)?;
    }
    Ok(())
}

fn validate_investigation_result_object(
    event_index: usize,
    mode: crate::ir::InvestigateMode,
    object: &serde_json::Map<String, serde_json::Value>,
    expected_keys: &[&str],
) -> Result<(), ResultValidationError> {
    for key in object.keys() {
        if !expected_keys.contains(&key.as_str()) {
            return Err(ResultValidationError::InvestigationResultInvariant(
                format!("event {event_index} mode {mode:?} has unknown result key `{key}`"),
            ));
        }
    }
    for key in expected_keys {
        let Some(value) = object.get(*key) else {
            return Err(ResultValidationError::InvestigationResultInvariant(
                format!("event {event_index} mode {mode:?} missing result key `{key}`"),
            ));
        };
        let valid = match *key {
            "alignment" | "role" | "current" => value.as_str().is_some(),
            "previous" => value.is_null() || value.as_str().is_some(),
            "changed" | "vanilla" | "vanilla_town" | "has_gun" | "killer" | "specialist"
            | "motion" | "prior_motion" => value.as_bool().is_some(),
            "action_types" | "actions" | "pt_access" | "visited" | "visitors" | "visitor_roles" => {
                value
                    .as_array()
                    .is_some_and(|items| items.iter().all(|item| item.as_str().is_some()))
            }
            _ => false,
        };
        if !valid {
            return Err(ResultValidationError::InvestigationResultInvariant(
                format!("event {event_index} mode {mode:?} result key `{key}` has invalid shape"),
            ));
        }
    }
    Ok(())
}

fn validate_phase_announcement_invariant(
    applied: &ResolutionApplied,
) -> Result<(), ResultValidationError> {
    let announcement_indexes: Vec<usize> = applied
        .events
        .iter()
        .enumerate()
        .filter_map(|(index, indexed)| {
            matches!(indexed.event, InnerEvent::PhaseAnnouncement(_)).then_some(index)
        })
        .collect();
    if announcement_indexes.len() != 1 {
        return Err(ResultValidationError::PhaseAnnouncementInvariant(format!(
            "expected exactly one PhaseAnnouncement, found {}",
            announcement_indexes.len()
        )));
    }

    let announcement_index = announcement_indexes[0];
    let win_indexes: Vec<usize> = applied
        .events
        .iter()
        .enumerate()
        .filter_map(|(index, indexed)| {
            matches!(indexed.event, InnerEvent::WinReached { .. }).then_some(index)
        })
        .collect();
    if win_indexes.len() > 1 {
        return Err(ResultValidationError::PhaseAnnouncementInvariant(format!(
            "expected at most one trailing WinReached, found {}",
            win_indexes.len()
        )));
    }

    let expected_announcement_index = if let Some(win_index) = win_indexes.first().copied() {
        if win_index + 1 != applied.events.len() {
            return Err(ResultValidationError::PhaseAnnouncementInvariant(
                "WinReached must be the final event".to_string(),
            ));
        }
        win_index.checked_sub(1).ok_or_else(|| {
            ResultValidationError::PhaseAnnouncementInvariant(
                "PhaseAnnouncement must precede final WinReached".to_string(),
            )
        })?
    } else {
        applied.events.len().checked_sub(1).ok_or_else(|| {
            ResultValidationError::PhaseAnnouncementInvariant(
                "PhaseAnnouncement must be the final event".to_string(),
            )
        })?
    };
    if announcement_index != expected_announcement_index {
        return Err(ResultValidationError::PhaseAnnouncementInvariant(format!(
            "PhaseAnnouncement must be at index {expected_announcement_index}, found {announcement_index}"
        )));
    }

    let InnerEvent::PhaseAnnouncement(announcement) = &applied.events[announcement_index].event
    else {
        unreachable!("announcement_index was derived from PhaseAnnouncement")
    };
    if announcement.phase_id != applied.phase_id {
        return Err(ResultValidationError::PhaseAnnouncementInvariant(format!(
            "PhaseAnnouncement.phase_id `{}` must match envelope phase_id `{}`",
            announcement.phase_id, applied.phase_id
        )));
    }

    Ok(())
}

pub fn validate_trace_json(
    value: &serde_json::Value,
    expected_trace_version: u16,
) -> Result<ResolutionTrace, ResultValidationError> {
    let trace: ResolutionTrace = serde_json::from_value(value.clone())
        .map_err(|err| ResultValidationError::MalformedTraceJson(err.to_string()))?;
    validate_resolution_trace(&trace, expected_trace_version)?;
    Ok(trace)
}

pub fn validate_resolution_trace(
    trace: &ResolutionTrace,
    expected_trace_version: u16,
) -> Result<(), ResultValidationError> {
    if trace.trace_version != expected_trace_version {
        return Err(ResultValidationError::UnsupportedTraceVersion {
            expected: expected_trace_version,
            actual: trace.trace_version,
        });
    }
    if trace.run_id.is_empty() {
        return Err(ResultValidationError::EmptyRunId);
    }
    Ok(())
}
