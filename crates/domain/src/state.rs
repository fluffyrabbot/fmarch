//! Resolution input state (doc 09): StateSnapshot / SlotState / Submission.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::events::InnerEvent;
use crate::pack::{AlignmentKey, PhaseKind, RoleKey, Tag};

pub type SlotId = String;
pub type GameId = String;
pub type PhaseId = String;
pub type Seed = u64;
pub type LogicalTime = u64;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateSnapshot {
    pub phase_kind: PhaseKind,
    pub phase_number: u32,
    pub slots: Vec<SlotState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotState {
    pub slot_id: SlotId,
    pub role_key: RoleKey,
    #[serde(default)]
    pub alignment: Option<AlignmentKey>,
    /// "alive" | "dead" (pack-opaque status tag).
    pub status: String,
    #[serde(default)]
    pub effects: Vec<Tag>,
}

impl SlotState {
    pub fn is_alive(&self) -> bool {
        self.status == "alive"
    }
}

/// Deterministically fold a resolution's inner events onto a state to produce
/// the next state — the canonical "how state carries forward between
/// resolutions" (doc 09). PURE: no clock, no RNG; a plain left fold whose result
/// depends only on `(state, events)`.
///
/// Mutation contract (only these inner-event kinds change state; all others —
/// `PlayerSaved`, `InvestigationResult`, `DayVoteOutcome`, `PhaseAnnouncement`,
/// `WinReached`, … — are no-ops):
///
/// - `PlayerKilled`        → the slot's `status` becomes `"dead"`.
/// - `EffectsMarked`       → adds `effect` to the slot's `effects` (de-duplicated).
/// - `EffectsCleared`      → removes `effect` from each named slot's `effects`.
/// - `PlayerConverted`     → sets the slot's `role_key` to `new_role` AND its
///   `alignment` to `new_alignment` (R2: a conversion is a faction change, not
///   merely a role swap; the win-check reads alignment).
///
/// `phase_kind` / `phase_number` are carried through unchanged: advancing the
/// phase cursor is the engine/platform's job, not this fold's.
pub fn apply_events(state: &StateSnapshot, events: &[InnerEvent]) -> StateSnapshot {
    let mut next = state.clone();
    for event in events {
        match event {
            InnerEvent::PlayerKilled { slot_id, .. } => {
                if let Some(slot) = next.slots.iter_mut().find(|s| &s.slot_id == slot_id) {
                    slot.status = "dead".to_string();
                }
            }
            InnerEvent::EffectsMarked { effect, target, .. } => {
                if let Some(slot) = next.slots.iter_mut().find(|s| &s.slot_id == target) {
                    if !slot.effects.contains(effect) {
                        slot.effects.push(effect.clone());
                    }
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
            }
            InnerEvent::PlayerConverted {
                target,
                new_role,
                new_alignment,
                ..
            } => {
                if let Some(slot) = next.slots.iter_mut().find(|s| &s.slot_id == target) {
                    slot.role_key = new_role.clone();
                    slot.alignment = new_alignment.clone();
                }
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
