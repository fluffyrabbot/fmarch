//! Player-facing role reference read model (RFC 0009).
//!
//! These are the shapes every role surface renders: the public pack reference,
//! the player's own role card, and host setup's role picker. The content
//! registry builds them from pack rules and pack-owned copy; they carry rules
//! only, never which slot holds a role.

use serde::{Deserialize, Serialize};

/// The visual family an alignment renders with: crest shape and colour token.
/// Cultures name their factions freely (wolf, cult, jester); the family keeps
/// the theme vocabulary closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "snake_case")]
pub enum AlignmentFamily {
    Town,
    Mafia,
    Independent,
}

/// One pack in the public catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct PackSummary {
    pub key: String,
    pub name: String,
    pub role_count: u32,
}

/// `GET /packs/{key}/roles`: one pack's rules as player-facing reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct PackRoleReference {
    pub pack: PackSummary,
    pub alignments: Vec<AlignmentReference>,
    pub win_families: Vec<String>,
    pub roles: Vec<RoleReference>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct AlignmentReference {
    pub key: String,
    pub label: String,
    pub family: AlignmentFamily,
    pub win: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct RoleReference {
    pub key: String,
    pub pack_key: String,
    pub pack_name: String,
    pub name: String,
    pub summary: String,
    // `None` for unaligned roles such as Lover.
    pub alignment: Option<AlignmentReference>,
    pub win: String,
    pub actions: Vec<RoleActionReference>,
    pub traits: Vec<RoleTrait>,
    pub channels: Vec<RoleChannel>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct RoleActionReference {
    pub id: String,
    pub label: String,
    // IR ability tags, primary first (`Kill`, `Protect`, …).
    pub abilities: Vec<String>,
    // `Day`, `Night`, `Twilight`, `Instant` or `Any`.
    pub window: String,
    pub targets: RoleActionTargets,
    pub roleblockable: bool,
    pub priority: i32,
    // Limited uses per game, when the action has them.
    pub uses: Option<u16>,
    // Player-facing constraint notes (cooldowns, night parity, modifiers).
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct RoleActionTargets {
    // `None`, `One`, `Many` or `Group`.
    pub kind: String,
    pub max: u16,
    pub self_allowed: bool,
    pub self_only: bool,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct RoleTrait {
    pub text: String,
    pub short: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct RoleChannel {
    pub id: String,
    pub label: String,
    pub confirms_town: bool,
}
