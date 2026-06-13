//! Resolution input state (doc 09): StateSnapshot / SlotState / Submission.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

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
