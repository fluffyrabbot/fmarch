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
    /// Choose one of several pack-declared prompt resolution policies.
    SelectPolicy {
        policy: String,
        #[serde(default)]
        metadata: serde_json::Value,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadPostMedia {
    pub content_id: String,
    pub alt: String,
    pub variants: BTreeMap<String, ThreadPostMediaVariant>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadPostMediaVariant {
    pub width: u32,
    pub height: u32,
}

/// Permission classes a primary host may deny to cohosts at game creation
/// (doc 14). Empty denylist = full co-GM parity for game-run mutators.
/// Structural acts (grant cohost, edit denylist, transfer host) are never
/// grantable via this enum — they require [`Capability::HostOf`](caps::Capability).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CohostPermissionClass {
    /// Roster, roles, spectators, post policy during setup/run.
    Setup,
    /// Start/advance/resolve/complete phases, lock thread, publish votecount.
    PhaseResolve,
    /// Engine `ResolveHostPrompt`.
    HostPromptResolve,
    /// Slot lifecycle + status tags.
    Lifecycle,
    /// `ProcessReplacement`.
    Replacement,
    /// `ExtendDeadline`.
    Deadline,
    /// Host-authored narrative (spectator posts today; PublishNarrative later).
    Narrative,
    /// ITA session control.
    ItaControl,
    /// `ApplyEffectPlan` / mechanical fiat.
    EffectSpec,
    /// Future day-event open/lock/cancel.
    DayEventOps,
    /// Future day-event resolve with rewards.
    DayEventResolve,
    /// Future day-program attach.
    ProgramAttach,
}

impl CohostPermissionClass {
    pub const ALL: [Self; 12] = [
        Self::Setup,
        Self::PhaseResolve,
        Self::HostPromptResolve,
        Self::Lifecycle,
        Self::Replacement,
        Self::Deadline,
        Self::Narrative,
        Self::ItaControl,
        Self::EffectSpec,
        Self::DayEventOps,
        Self::DayEventResolve,
        Self::ProgramAttach,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Setup => "setup",
            Self::PhaseResolve => "phase_resolve",
            Self::HostPromptResolve => "host_prompt_resolve",
            Self::Lifecycle => "lifecycle",
            Self::Replacement => "replacement",
            Self::Deadline => "deadline",
            Self::Narrative => "narrative",
            Self::ItaControl => "ita_control",
            Self::EffectSpec => "effect_spec",
            Self::DayEventOps => "day_event_ops",
            Self::DayEventResolve => "day_event_resolve",
            Self::ProgramAttach => "program_attach",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "setup" => Some(Self::Setup),
            "phase_resolve" => Some(Self::PhaseResolve),
            "host_prompt_resolve" => Some(Self::HostPromptResolve),
            "lifecycle" => Some(Self::Lifecycle),
            "replacement" => Some(Self::Replacement),
            "deadline" => Some(Self::Deadline),
            "narrative" => Some(Self::Narrative),
            "ita_control" => Some(Self::ItaControl),
            "effect_spec" => Some(Self::EffectSpec),
            "day_event_ops" => Some(Self::DayEventOps),
            "day_event_resolve" => Some(Self::DayEventResolve),
            "program_attach" => Some(Self::ProgramAttach),
            _ => None,
        }
    }
}

/// The commands the pipeline accepts. Slice commands + the minimal bootstrap
/// lifecycle needed to stand a game up in tests (kept minimal, host-gated where
/// appropriate). `game` is the stream id (= game id).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Command {
    // ── bootstrap lifecycle ──
    /// Create a game; the issuing principal becomes the host. No prior authority.
    /// Optional `cohost_denied` limits cohost game-run classes (default empty = full co-GM).
    CreateGame {
        game: Uuid,
        pack: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        cohost_denied: Vec<CohostPermissionClass>,
    },
    /// Add an (empty) slot to the game. Host-team (Setup class).
    AddSlot { game: Uuid, slot: String },
    /// Assign a user into a slot (occupancy begins). Host-team (Setup class).
    AssignSlot {
        game: Uuid,
        slot: String,
        user: String,
    },
    /// Assign a role to a slot. Host-team (Setup class).
    AssignRole {
        game: Uuid,
        slot: String,
        role_key: String,
    },
    /// Set a slot's resolver-visible lifecycle. Host-team (Lifecycle class).
    SetSlotStatus {
        game: Uuid,
        slot: String,
        status: domain::SlotLifecycle,
    },
    /// Add a pack-visible status tag to a slot. Host-team (Lifecycle class).
    AddSlotStatusTag {
        game: Uuid,
        slot: String,
        tag: String,
    },
    /// Remove a pack-visible status tag from a slot. Host-team (Lifecycle class).
    RemoveSlotStatusTag {
        game: Uuid,
        slot: String,
        tag: String,
    },
    /// Delegate cohost authority to a user. **Primary host only** (structural).
    AddCohost { game: Uuid, user: String },
    /// Grant read-only access to the fixed spectator room. Host-team (Setup class).
    GrantSpectator { game: Uuid, user: String },
    /// Revoke read-only access to the fixed spectator room. Host-team (Setup class).
    RevokeSpectator { game: Uuid, user: String },
    /// Freeze the roster and start the game at `phase`. Host-team (PhaseResolve).
    StartGame { game: Uuid, phase: String },
    /// Open a Day phase (the votable window). Host-team (PhaseResolve).
    OpenDayPhase { game: Uuid, phase: String },
    /// Advance from a resolved, locked phase to the next phase declared by the
    /// pack cadence. Host-team (PhaseResolve).
    AdvancePhase { game: Uuid },
    /// Record deadline-expiry evidence and advance from a resolved, locked
    /// phase through the same pack-cadence derivation. Host-team until a
    /// scheduler principal exists.
    AdvancePhaseByDeadline {
        game: Uuid,
        phase: String,
        observed_at: i64,
    },
    /// Lock the main thread (votes/posts blocked). Host-team (PhaseResolve).
    LockThread { game: Uuid },
    /// Unlock the main thread. Host-team (PhaseResolve).
    UnlockThread { game: Uuid },
    /// Resolve the current phase by loading snapshot + submissions and applying
    /// the domain resolver. Host-team (PhaseResolve).
    ResolvePhase { game: Uuid, seed: u64 },
    /// Mark the game complete and reveal final role/alignment facts. Host-team (PhaseResolve).
    CompleteGame { game: Uuid },
    /// Publish an official current-phase votecount post derived from projections. Host-team (PhaseResolve).
    PublishVotecount { game: Uuid },
    /// Resolve a durable host/admin prompt emitted by the engine. Host-team (HostPromptResolve).
    ResolveHostPrompt {
        game: Uuid,
        prompt_id: String,
        decision: HostPromptDecision,
    },
    /// Toggle channel-level post policy. Host-team (Setup class).
    SetPostPolicy {
        game: Uuid,
        channel_id: String,
        allow_media_only: bool,
    },
    /// Publish a host-authored post into the fixed spectator room. Host-team (Narrative).
    PublishSpectatorPost {
        game: Uuid,
        body: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        media: Vec<ThreadPostMedia>,
    },
    /// Record a host/admin ITA session lifecycle control for the current Day phase. Host-team (ItaControl).
    ControlItaSession {
        game: Uuid,
        session_id: String,
        control: domain::ItaSessionControlKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    /// Apply fully bound platform effects atomically. Host-team (EffectSpec).
    /// PR3 supports persistent Mark/Clear/Lifecycle; other catalog members
    /// remain typed but reject until their snapshot + projection adapters land.
    ApplyEffectPlan {
        game: Uuid,
        effects: Vec<game_platform::ConcreteEffect>,
        reason: String,
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
    /// Extend a phase deadline. Host-team (Deadline class).
    ExtendDeadline { game: Uuid, phase: String, at: i64 },
    /// Replace the human behind a slot (seat id unchanged). Host-team (Replacement class).
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
    /// Principal is a cohost but this permission class is denied on the game.
    #[error("cohost permission denied: {0}")]
    CohostPermissionDenied(String),
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
    /// The command id was already committed for a different command payload.
    #[error("command id already used for a different payload")]
    CommandIdConflict,
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
    /// A concrete effect plan is malformed or contains an effect whose adapter
    /// is not available yet.
    #[error("effect plan validation failed: {0}")]
    EffectSpecValidation(String),
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
