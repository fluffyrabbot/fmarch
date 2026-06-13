//! Command / Ack / Reject types: the typed surface of the pipeline.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A vote target: a slot, or the no-lynch sentinel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum VoteTarget {
    Slot(String),
    NoLynch,
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
    /// Delegate cohost authority to a user. Host-gated.
    AddCohost { game: Uuid, user: String },
    /// Freeze the roster and start the game at `phase`. Host-gated.
    StartGame { game: Uuid, phase: String },
    /// Open a Day phase (the votable window). Host-gated.
    OpenDayPhase { game: Uuid, phase: String },
    /// Lock the main thread (votes/posts blocked). Host-gated.
    LockThread { game: Uuid },
    /// Unlock the main thread. Host-gated.
    UnlockThread { game: Uuid },

    // ── slice commands ──
    /// Cast/overwrite a vote as `actor_slot`. Requires `SlotOccupant(actor_slot)`.
    SubmitVote {
        game: Uuid,
        actor_slot: String,
        target: VoteTarget,
    },
    /// Withdraw `actor_slot`'s current ballot. Requires `SlotOccupant`.
    WithdrawVote { game: Uuid, actor_slot: String },
    /// Post as `actor_slot` (attributed to the slot). Requires `SlotOccupant`.
    SubmitPost {
        game: Uuid,
        actor_slot: String,
        body: String,
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
    /// The vote/action target is invalid.
    #[error("invalid target")]
    InvalidTarget,
    /// Optimistic-concurrency conflict — reload, revalidate, RETRY (bounded).
    #[error("stream conflict (retryable)")]
    StreamConflict,
    /// The referenced game does not exist.
    #[error("unknown game")]
    UnknownGame,
    /// The referenced slot does not exist in the game.
    #[error("unknown slot")]
    UnknownSlot,
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
