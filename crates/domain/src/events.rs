//! Engine resolution events: the closed, enumerated inner event set (doc 10).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::ir::InvestigateMode;
use crate::pack::{RoleKey, Tag};
use crate::state::{PhaseId, Seed, SlotId};

/// The closed, enumerated set of inner domain events (doc 10).
///
/// Serializes as `{ "kind": <variant>, "payload": { .. } }` via the
/// adjacently-tagged representation, matching the goldens' event shape (the
/// outer `index` is attached at the `resolution.applied` envelope layer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload")]
pub enum InnerEvent {
    // ── Day flow ──
    DayVoteRecorded {
        actor: SlotId,
        target: SlotId,
        withdrawn: bool,
        sequence: u64,
    },
    DayVoteOutcome(DayVoteOutcome),
    PhaseAnnouncement(PhaseAnnouncement),

    // ── Core night results ──
    PlayerKilled {
        slot_id: SlotId,
        cause: String,
        attackers: Vec<SlotId>,
        unstoppable: bool,
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
    },
    EffectsCleared {
        effect: Tag,
        targets: Vec<SlotId>,
        actor: SlotId,
    },

    // ── Information ──
    InvestigationResult {
        mode: InvestigateMode,
        investigator: SlotId,
        target: SlotId,
        result: serde_json::Value,
    },
    EffectNotification {
        effect: Tag,
        status: String,
        audience: Vec<SlotId>,
    },

    // ── Interference ──
    ActionInterfered {
        actor: SlotId,
        reason: String,
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
pub struct DayVoteOutcome {
    pub status: VoteStatus,
    pub winner: Option<SlotId>,
    pub contenders: Vec<SlotId>,
    pub tallies: BTreeMap<SlotId, f64>,
    pub votes: BTreeMap<SlotId, SlotId>,
    pub weights: BTreeMap<SlotId, f64>,
    pub majority: Option<f64>,
    pub total_weight: f64,
    pub tiebreak: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PhaseAnnouncement {
    pub phase_id: PhaseId,
    pub deaths: Vec<Death>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Death {
    pub slot_id: SlotId,
    pub cause: String,
}

/// The `resolution.applied` envelope wrapping the ordered inner events (doc 10).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
pub struct IndexedEvent {
    pub index: usize,
    #[serde(flatten)]
    pub event: InnerEvent,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ResolutionCounts {
    pub events: usize,
    pub kills: usize,
    pub saves: usize,
}
