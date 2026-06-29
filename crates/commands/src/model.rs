//! Command / Ack / Reject types: the typed surface of the pipeline.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

/// A vote target: a slot, or the no-lynch sentinel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum VoteTarget {
    Slot(String),
    NoLynch,
}

/// Host/admin decision for a durable engine prompt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HostPromptDecision {
    /// Select a slot for a prompt that asks the host to choose a player, such
    /// as a PK / host-decided tied vote.
    SelectSlot { slot: String },
    /// Mark an operational prompt handled without emitting further engine
    /// effects. Useful for prompt kinds that drive external workflow.
    Acknowledge {
        #[serde(default)]
        metadata: serde_json::Value,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadPostMedia {
    pub id: String,
    pub kind: String,
    pub alt: String,
    pub variants: BTreeMap<String, ThreadPostMediaVariant>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadPostMediaVariant {
    pub url: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
}

/// The commands the pipeline accepts. Slice commands + the minimal bootstrap
/// lifecycle needed to stand a game up in tests (kept minimal, host-gated where
/// appropriate). `game` is the stream id (= game id).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Command {
    // ── bootstrap lifecycle ──
    /// Create a game; the issuing principal becomes the host. No prior authority.
    CreateGame { game: Uuid, pack: String },
    /// Add an (empty) slot to the game. Host-gated.
    AddSlot { game: Uuid, slot: String },
    /// Assign a user into a slot (occupancy begins). Host-gated.
    AssignSlot {
        game: Uuid,
        slot: String,
        user: String,
    },
    /// Assign a role to a slot. Host-gated.
    AssignRole {
        game: Uuid,
        slot: String,
        role_key: String,
    },
    /// Set a slot's resolver-visible lifecycle. Host-gated.
    SetSlotStatus {
        game: Uuid,
        slot: String,
        status: domain::SlotLifecycle,
    },
    /// Add a pack-visible status tag to a slot. Host-gated.
    AddSlotStatusTag {
        game: Uuid,
        slot: String,
        tag: String,
    },
    /// Remove a pack-visible status tag from a slot. Host-gated.
    RemoveSlotStatusTag {
        game: Uuid,
        slot: String,
        tag: String,
    },
    /// Delegate cohost authority to a user. Host-gated.
    AddCohost { game: Uuid, user: String },
    /// Freeze the roster and start the game at `phase`. Host-gated.
    StartGame { game: Uuid, phase: String },
    /// Open a Day phase (the votable window). Host-gated.
    OpenDayPhase { game: Uuid, phase: String },
    /// Advance from a resolved, locked phase to the next phase declared by the
    /// pack cadence. Host-gated.
    AdvancePhase { game: Uuid },
    /// Record deadline-expiry evidence and advance from a resolved, locked
    /// phase through the same pack-cadence derivation. Host-gated until a
    /// scheduler principal exists.
    AdvancePhaseByDeadline {
        game: Uuid,
        phase: String,
        observed_at: i64,
    },
    /// Lock the main thread (votes/posts blocked). Host-gated.
    LockThread { game: Uuid },
    /// Unlock the main thread. Host-gated.
    UnlockThread { game: Uuid },
    /// Resolve the current phase by loading snapshot + submissions and applying
    /// the domain resolver. Host-gated.
    ResolvePhase { game: Uuid, seed: u64 },
    /// Mark the game complete and reveal final role/alignment facts. Host-gated.
    CompleteGame { game: Uuid },
    /// Publish an official current-phase votecount post derived from projections. Host-gated.
    PublishVotecount { game: Uuid },
    /// Resolve a durable host/admin prompt emitted by the engine. Host-gated.
    ResolveHostPrompt {
        game: Uuid,
        prompt_id: String,
        decision: HostPromptDecision,
    },
    /// Record a host/admin ITA session lifecycle control for the current Day phase. Host-gated.
    ControlItaSession {
        game: Uuid,
        session_id: String,
        control: domain::ItaSessionControlKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },

    // ── slice commands ──
    /// Cast/overwrite a vote as `actor_slot`. Requires `SlotOccupant(actor_slot)`.
    SubmitVote {
        game: Uuid,
        actor_slot: String,
        target: VoteTarget,
    },
    /// Withdraw `actor_slot`'s current ballot. Requires `SlotOccupant`.
    WithdrawVote { game: Uuid, actor_slot: String },
    /// Submit or replace an action choice as `actor_slot`. Requires `SlotOccupant(actor_slot)`.
    SubmitAction {
        game: Uuid,
        action_id: String,
        actor_slot: String,
        template_id: String,
        targets: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        grant_id: Option<String>,
    },
    /// Withdraw an active action choice. Requires `SlotOccupant(actor_slot)`.
    WithdrawAction {
        game: Uuid,
        action_id: String,
        actor_slot: String,
    },
    /// Post as `actor_slot` into `channel_id` (attributed to the slot). Requires
    /// `SlotOccupant` and, for non-main channels, `ChannelMember(channel_id)`.
    SubmitPost {
        game: Uuid,
        channel_id: String,
        actor_slot: String,
        body: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        media: Vec<ThreadPostMedia>,
    },
    /// Extend a phase deadline. Requires `HostOf|CohostOf`.
    ExtendDeadline { game: Uuid, phase: String, at: i64 },
    /// Replace the human behind a slot (seat id unchanged). Requires `HostOf`.
    ProcessReplacement {
        game: Uuid,
        slot: String,
        outgoing_user: String,
        incoming_user: String,
    },
}

/// A successful command: the stream sequences appended (audit / read cursor).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ack {
    pub stream_seqs: Vec<i64>,
}

/// The TYPED rejection taxonomy (doc 03: typed domain errors, never panics).
/// Every reject is actionable and crosses the boundary cleanly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
pub enum Reject {
    /// Authority for the action is absent (generic least-authority denial).
    #[error("not authorized")]
    NotAuthorized,
    /// The principal is not the slot's current occupant.
    #[error("not your slot")]
    NotYourSlot,
    /// The action needs host (or cohost) authority the principal lacks.
    #[error("not host")]
    NotHost,
    /// The phase is locked (or no votable phase is open).
    #[error("phase locked")]
    PhaseLocked,
    /// The acting slot is dead / not in play.
    #[error("slot not alive")]
    SlotNotAlive,
    /// The acting slot is alive but has no voting authority under the current pack state.
    #[error("vote not allowed")]
    VoteNotAllowed,
    /// The vote/action target is invalid.
    #[error("invalid target")]
    InvalidTarget,
    /// A non-simultaneous action for this actor/template is already active in the phase.
    #[error("action already submitted")]
    ActionAlreadySubmitted,
    /// The referenced role key does not exist in the game's pack.
    #[error("invalid role: {0}")]
    InvalidRole(String),
    /// Optimistic-concurrency conflict — reload, revalidate, RETRY (bounded).
    #[error("stream conflict (retryable)")]
    StreamConflict,
    /// The referenced game does not exist.
    #[error("unknown game")]
    UnknownGame,
    /// The referenced slot does not exist in the game.
    #[error("unknown slot")]
    UnknownSlot,
    /// The referenced host/admin prompt does not exist.
    #[error("unknown prompt")]
    UnknownPrompt,
    /// The host/admin prompt has already been resolved.
    #[error("prompt already resolved")]
    PromptAlreadyResolved,
    /// The game has already been completed.
    #[error("game already completed")]
    GameAlreadyCompleted,
    /// The prompt decision is malformed for the prompt kind.
    #[error("invalid prompt decision")]
    InvalidPromptDecision,
    /// An unexpected internal/storage error (not a domain rejection).
    #[error("internal error: {0}")]
    Internal(String),
}

impl Reject {
    /// Whether the caller should reload + revalidate + retry (bounded).
    pub fn is_retryable(&self) -> bool {
        matches!(self, Reject::StreamConflict)
    }
}
