//! `wire` — versioned transport types crossing the Rust/client boundary.
//!
//! Wire types are deliberately separate from domain and storage types. They are
//! the stable transport contract; server internals may evolve behind them.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;
use uuid::Uuid;

pub const PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Envelope<T> {
    pub v: u16,
    pub id: u64,
    pub body: T,
}

impl<T> Envelope<T> {
    pub fn new(id: u64, body: T) -> Self {
        Envelope {
            v: PROTOCOL_VERSION,
            id,
            body,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ClientEnvelope {
    pub v: u16,
    pub id: u64,
    pub body: ClientMsg,
}

impl ClientEnvelope {
    pub fn new(id: u64, body: ClientMsg) -> Self {
        ClientEnvelope {
            v: PROTOCOL_VERSION,
            id,
            body,
        }
    }
}

impl From<ClientEnvelope> for Envelope<ClientMsg> {
    fn from(envelope: ClientEnvelope) -> Self {
        Envelope {
            v: envelope.v,
            id: envelope.id,
            body: envelope.body,
        }
    }
}

impl From<Envelope<ClientMsg>> for ClientEnvelope {
    fn from(envelope: Envelope<ClientMsg>) -> Self {
        ClientEnvelope {
            v: envelope.v,
            id: envelope.id,
            body: envelope.body,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ServerEnvelope {
    pub v: u16,
    pub id: u64,
    pub body: ServerMsg,
}

impl ServerEnvelope {
    pub fn new(id: u64, body: ServerMsg) -> Self {
        ServerEnvelope {
            v: PROTOCOL_VERSION,
            id,
            body,
        }
    }
}

impl From<ServerEnvelope> for Envelope<ServerMsg> {
    fn from(envelope: ServerEnvelope) -> Self {
        Envelope {
            v: envelope.v,
            id: envelope.id,
            body: envelope.body,
        }
    }
}

impl From<Envelope<ServerMsg>> for ServerEnvelope {
    fn from(envelope: Envelope<ServerMsg>) -> Self {
        ServerEnvelope {
            v: envelope.v,
            id: envelope.id,
            body: envelope.body,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "body")]
pub enum ClientMsg {
    Command(CommandMsg),
    SubscribeGame { game: Uuid },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "body")]
pub enum ServerMsg {
    Hello(Hello),
    Ack(AckMsg),
    Reject(RejectMsg),
    Delta(ProjectionDelta),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Hello {
    pub protocol_v: u16,
    pub server: String,
    pub caps: Vec<CapabilityGrant>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CommandMsg {
    pub command_id: Uuid,
    pub command: Command,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum VoteTarget {
    Slot(String),
    NoLynch,
}

impl From<VoteTarget> for commands::VoteTarget {
    fn from(target: VoteTarget) -> Self {
        match target {
            VoteTarget::Slot(slot) => commands::VoteTarget::Slot(slot),
            VoteTarget::NoLynch => commands::VoteTarget::NoLynch,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum HostPromptDecision {
    SelectSlot { slot: String },
    SelectPolicy { policy: String },
    Acknowledge,
}

impl From<HostPromptDecision> for commands::HostPromptDecision {
    fn from(decision: HostPromptDecision) -> Self {
        match decision {
            HostPromptDecision::SelectSlot { slot } => {
                commands::HostPromptDecision::SelectSlot { slot }
            }
            HostPromptDecision::SelectPolicy { policy } => {
                commands::HostPromptDecision::SelectPolicy {
                    policy,
                    metadata: serde_json::json!({}),
                }
            }
            HostPromptDecision::Acknowledge => commands::HostPromptDecision::Acknowledge {
                metadata: serde_json::json!({}),
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum SlotLifecycle {
    Alive,
    Dead,
    Modkilled,
}

impl From<SlotLifecycle> for domain::SlotLifecycle {
    fn from(status: SlotLifecycle) -> Self {
        match status {
            SlotLifecycle::Alive => domain::SlotLifecycle::Alive,
            SlotLifecycle::Dead => domain::SlotLifecycle::Dead,
            SlotLifecycle::Modkilled => domain::SlotLifecycle::Modkilled,
        }
    }
}

/// Permission classes a primary host may deny to cohosts at game creation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum CohostPermissionClass {
    Setup,
    PhaseResolve,
    HostPromptResolve,
    Lifecycle,
    Replacement,
    Deadline,
    Narrative,
    ItaControl,
    EffectSpec,
    DayEventOps,
    DayEventResolve,
    ProgramAttach,
}

impl From<CohostPermissionClass> for commands::CohostPermissionClass {
    fn from(value: CohostPermissionClass) -> Self {
        match value {
            CohostPermissionClass::Setup => Self::Setup,
            CohostPermissionClass::PhaseResolve => Self::PhaseResolve,
            CohostPermissionClass::HostPromptResolve => Self::HostPromptResolve,
            CohostPermissionClass::Lifecycle => Self::Lifecycle,
            CohostPermissionClass::Replacement => Self::Replacement,
            CohostPermissionClass::Deadline => Self::Deadline,
            CohostPermissionClass::Narrative => Self::Narrative,
            CohostPermissionClass::ItaControl => Self::ItaControl,
            CohostPermissionClass::EffectSpec => Self::EffectSpec,
            CohostPermissionClass::DayEventOps => Self::DayEventOps,
            CohostPermissionClass::DayEventResolve => Self::DayEventResolve,
            CohostPermissionClass::ProgramAttach => Self::ProgramAttach,
        }
    }
}

impl From<commands::CohostPermissionClass> for CohostPermissionClass {
    fn from(value: commands::CohostPermissionClass) -> Self {
        match value {
            commands::CohostPermissionClass::Setup => Self::Setup,
            commands::CohostPermissionClass::PhaseResolve => Self::PhaseResolve,
            commands::CohostPermissionClass::HostPromptResolve => Self::HostPromptResolve,
            commands::CohostPermissionClass::Lifecycle => Self::Lifecycle,
            commands::CohostPermissionClass::Replacement => Self::Replacement,
            commands::CohostPermissionClass::Deadline => Self::Deadline,
            commands::CohostPermissionClass::Narrative => Self::Narrative,
            commands::CohostPermissionClass::ItaControl => Self::ItaControl,
            commands::CohostPermissionClass::EffectSpec => Self::EffectSpec,
            commands::CohostPermissionClass::DayEventOps => Self::DayEventOps,
            commands::CohostPermissionClass::DayEventResolve => Self::DayEventResolve,
            commands::CohostPermissionClass::ProgramAttach => Self::ProgramAttach,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum Command {
    CreateGame {
        game: Uuid,
        pack: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        cohost_denied: Vec<CohostPermissionClass>,
    },
    AddSlot {
        game: Uuid,
        slot: String,
    },
    AssignSlot {
        game: Uuid,
        slot: String,
        user: String,
    },
    AssignRole {
        game: Uuid,
        slot: String,
        role_key: String,
    },
    SetSlotStatus {
        game: Uuid,
        slot: String,
        status: SlotLifecycle,
    },
    AddCohost {
        game: Uuid,
        user: String,
    },
    GrantSpectator {
        game: Uuid,
        user: String,
    },
    RevokeSpectator {
        game: Uuid,
        user: String,
    },
    StartGame {
        game: Uuid,
        phase: String,
    },
    OpenDayPhase {
        game: Uuid,
        phase: String,
    },
    AdvancePhase {
        game: Uuid,
    },
    AdvancePhaseByDeadline {
        game: Uuid,
        phase: String,
        observed_at: i64,
    },
    LockThread {
        game: Uuid,
    },
    UnlockThread {
        game: Uuid,
    },
    ResolvePhase {
        game: Uuid,
        seed: u64,
    },
    CompleteGame {
        game: Uuid,
    },
    PublishVotecount {
        game: Uuid,
    },
    ResolveHostPrompt {
        game: Uuid,
        prompt_id: String,
        decision: HostPromptDecision,
    },
    SetPostPolicy {
        game: Uuid,
        channel_id: String,
        allow_media_only: bool,
    },
    PublishSpectatorPost {
        game: Uuid,
        body: String,
        #[serde(default)]
        #[ts(optional)]
        media: Option<Vec<SubmitPostMedia>>,
    },
    SubmitVote {
        game: Uuid,
        actor_slot: String,
        target: VoteTarget,
    },
    WithdrawVote {
        game: Uuid,
        actor_slot: String,
    },
    SubmitAction {
        game: Uuid,
        action_id: String,
        actor_slot: String,
        template_id: String,
        targets: Vec<String>,
        #[serde(default)]
        grant_id: Option<String>,
    },
    WithdrawAction {
        game: Uuid,
        action_id: String,
        actor_slot: String,
    },
    SubmitPost {
        game: Uuid,
        channel_id: String,
        actor_slot: String,
        body: String,
        #[serde(default)]
        #[ts(optional)]
        media: Option<Vec<SubmitPostMedia>>,
    },
    ExtendDeadline {
        game: Uuid,
        phase: String,
        at: i64,
    },
    ProcessReplacement {
        game: Uuid,
        slot: String,
        outgoing_user: String,
        incoming_user: String,
    },
}

impl From<Command> for commands::Command {
    fn from(command: Command) -> Self {
        match command {
            Command::CreateGame {
                game,
                pack,
                cohost_denied,
            } => commands::Command::CreateGame {
                game,
                pack,
                cohost_denied: cohost_denied.into_iter().map(Into::into).collect(),
            },
            Command::AddSlot { game, slot } => commands::Command::AddSlot { game, slot },
            Command::AssignSlot { game, slot, user } => {
                commands::Command::AssignSlot { game, slot, user }
            }
            Command::AssignRole {
                game,
                slot,
                role_key,
            } => commands::Command::AssignRole {
                game,
                slot,
                role_key,
            },
            Command::SetSlotStatus { game, slot, status } => commands::Command::SetSlotStatus {
                game,
                slot,
                status: status.into(),
            },
            Command::AddCohost { game, user } => commands::Command::AddCohost { game, user },
            Command::GrantSpectator { game, user } => {
                commands::Command::GrantSpectator { game, user }
            }
            Command::RevokeSpectator { game, user } => {
                commands::Command::RevokeSpectator { game, user }
            }
            Command::StartGame { game, phase } => commands::Command::StartGame { game, phase },
            Command::OpenDayPhase { game, phase } => {
                commands::Command::OpenDayPhase { game, phase }
            }
            Command::AdvancePhase { game } => commands::Command::AdvancePhase { game },
            Command::AdvancePhaseByDeadline {
                game,
                phase,
                observed_at,
            } => commands::Command::AdvancePhaseByDeadline {
                game,
                phase,
                observed_at,
            },
            Command::LockThread { game } => commands::Command::LockThread { game },
            Command::UnlockThread { game } => commands::Command::UnlockThread { game },
            Command::ResolvePhase { game, seed } => commands::Command::ResolvePhase { game, seed },
            Command::CompleteGame { game } => commands::Command::CompleteGame { game },
            Command::PublishVotecount { game } => commands::Command::PublishVotecount { game },
            Command::ResolveHostPrompt {
                game,
                prompt_id,
                decision,
            } => commands::Command::ResolveHostPrompt {
                game,
                prompt_id,
                decision: decision.into(),
            },
            Command::SetPostPolicy {
                game,
                channel_id,
                allow_media_only,
            } => commands::Command::SetPostPolicy {
                game,
                channel_id,
                allow_media_only,
            },
            Command::PublishSpectatorPost { game, body, media } => {
                commands::Command::PublishSpectatorPost {
                    game,
                    body,
                    media: media
                        .unwrap_or_default()
                        .into_iter()
                        .map(|media| commands::ThreadPostMedia {
                            content_id: media.content_id,
                            alt: media.alt,
                            variants: BTreeMap::new(),
                        })
                        .collect(),
                }
            }
            Command::SubmitVote {
                game,
                actor_slot,
                target,
            } => commands::Command::SubmitVote {
                game,
                actor_slot,
                target: target.into(),
            },
            Command::WithdrawVote { game, actor_slot } => {
                commands::Command::WithdrawVote { game, actor_slot }
            }
            Command::SubmitAction {
                game,
                action_id,
                actor_slot,
                template_id,
                targets,
                grant_id,
            } => commands::Command::SubmitAction {
                game,
                action_id,
                actor_slot,
                template_id,
                targets,
                grant_id,
            },
            Command::WithdrawAction {
                game,
                action_id,
                actor_slot,
            } => commands::Command::WithdrawAction {
                game,
                action_id,
                actor_slot,
            },
            Command::SubmitPost {
                game,
                channel_id,
                actor_slot,
                body,
                media,
            } => commands::Command::SubmitPost {
                game,
                channel_id,
                actor_slot,
                body,
                media: media
                    .unwrap_or_default()
                    .into_iter()
                    .map(|media| commands::ThreadPostMedia {
                        content_id: media.content_id,
                        alt: media.alt,
                        variants: BTreeMap::new(),
                    })
                    .collect(),
            },
            Command::ExtendDeadline { game, phase, at } => {
                commands::Command::ExtendDeadline { game, phase, at }
            }
            Command::ProcessReplacement {
                game,
                slot,
                outgoing_user,
                incoming_user,
            } => commands::Command::ProcessReplacement {
                game,
                slot,
                outgoing_user,
                incoming_user,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AckMsg {
    pub stream_seqs: Vec<i64>,
}

impl From<commands::Ack> for AckMsg {
    fn from(ack: commands::Ack) -> Self {
        AckMsg {
            stream_seqs: ack.stream_seqs,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RejectMsg {
    pub error: RejectCode,
    pub retryable: bool,
    pub message: String,
}

impl From<commands::Reject> for RejectMsg {
    fn from(reject: commands::Reject) -> Self {
        let retryable = reject.is_retryable();
        let message = reject.to_string();
        RejectMsg {
            error: RejectCode::from(&reject),
            retryable,
            message,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum RejectCode {
    NotAuthorized,
    NotYourSlot,
    NotHost,
    CohostPermissionDenied,
    PhaseLocked,
    SlotNotAlive,
    VoteNotAllowed,
    InvalidTarget,
    ActionAlreadySubmitted,
    InvalidRole,
    StreamConflict,
    CommandIdConflict,
    UnknownGame,
    UnknownSlot,
    UnknownPrompt,
    PromptAlreadyResolved,
    GameAlreadyCompleted,
    InvalidPromptDecision,
    Internal,
}

impl From<&commands::Reject> for RejectCode {
    fn from(reject: &commands::Reject) -> Self {
        match reject {
            commands::Reject::NotAuthorized => RejectCode::NotAuthorized,
            commands::Reject::NotYourSlot => RejectCode::NotYourSlot,
            commands::Reject::NotHost => RejectCode::NotHost,
            commands::Reject::CohostPermissionDenied(_) => RejectCode::CohostPermissionDenied,
            commands::Reject::PhaseLocked => RejectCode::PhaseLocked,
            commands::Reject::SlotNotAlive => RejectCode::SlotNotAlive,
            commands::Reject::VoteNotAllowed => RejectCode::VoteNotAllowed,
            commands::Reject::InvalidTarget => RejectCode::InvalidTarget,
            commands::Reject::ActionAlreadySubmitted => RejectCode::ActionAlreadySubmitted,
            commands::Reject::InvalidRole(_) => RejectCode::InvalidRole,
            commands::Reject::StreamConflict => RejectCode::StreamConflict,
            commands::Reject::CommandIdConflict => RejectCode::CommandIdConflict,
            commands::Reject::UnknownGame => RejectCode::UnknownGame,
            commands::Reject::UnknownSlot => RejectCode::UnknownSlot,
            commands::Reject::UnknownPrompt => RejectCode::UnknownPrompt,
            commands::Reject::PromptAlreadyResolved => RejectCode::PromptAlreadyResolved,
            commands::Reject::GameAlreadyCompleted => RejectCode::GameAlreadyCompleted,
            commands::Reject::InvalidPromptDecision => RejectCode::InvalidPromptDecision,
            commands::Reject::Internal(_) => RejectCode::Internal,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "body")]
pub enum ProjectionDelta {
    VoteCountChanged(VoteCountDelta),
    VoteCountCleared(VoteCountClearedDelta),
    ThreadPostsChanged(ThreadPostsDelta),
    HostConsoleStateChanged(HostConsoleStateDelta),
    HostPromptsChanged(HostPromptsDelta),
    PlayerNotificationsChanged(PlayerNotificationsDelta),
    PlayerInvestigationResultsChanged(PlayerInvestigationResultsDelta),
    DayVoteOutcomeApplied(DayVoteOutcomeDelta),
    ResyncRequired { from_seq: i64 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct VoteCountDelta {
    pub game: Uuid,
    pub phase_id: String,
    pub candidate_slot: String,
    pub count: i64,
}

impl From<projections::VoteCountRow> for VoteCountDelta {
    fn from(row: projections::VoteCountRow) -> Self {
        VoteCountDelta {
            game: row.game_id,
            phase_id: row.phase_id,
            candidate_slot: row.candidate_slot,
            count: row.count,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct VoteCountClearedDelta {
    pub game: Uuid,
    pub phase_id: String,
    pub candidate_slot: String,
}

impl From<VoteCountDelta> for VoteCountClearedDelta {
    fn from(delta: VoteCountDelta) -> Self {
        VoteCountClearedDelta {
            game: delta.game,
            phase_id: delta.phase_id,
            candidate_slot: delta.candidate_slot,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ThreadPostsDelta {
    pub game: Uuid,
    pub posts: Vec<ThreadPost>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct DayVoteOutcomeDelta {
    pub game: Uuid,
    pub phase_id: String,
    pub source_seq: i64,
    pub event_index: i32,
    pub status: String,
    pub winner_slot: Option<String>,
    #[ts(type = "unknown")]
    pub contenders: serde_json::Value,
    #[ts(type = "unknown")]
    pub tallies: serde_json::Value,
    #[ts(type = "unknown")]
    pub votes: serde_json::Value,
    #[ts(type = "unknown")]
    pub weights: serde_json::Value,
    pub majority: Option<f64>,
    #[ts(type = "unknown")]
    pub thresholds: serde_json::Value,
    pub total_weight: f64,
    pub tiebreak: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HostConsoleStateDelta {
    pub game: Uuid,
    pub authority: HostConsoleAuthorityDelta,
    pub completed: bool,
    pub phase: Option<HostConsolePhaseStateDelta>,
    pub slots: Vec<HostConsoleSlotOccupancyDelta>,
    pub thread_posts: Vec<HostConsoleThreadPostDelta>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum HostConsoleAuthorityKind {
    HostOf,
    CohostOf,
    GlobalOperator,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HostConsoleAuthorityDelta {
    pub principal_user_id: String,
    pub capability: HostConsoleAuthorityKind,
    pub allowed_classes: Vec<CohostPermissionClass>,
    pub denied_classes: Vec<CohostPermissionClass>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HostConsolePhaseStateDelta {
    pub phase_id: String,
    pub locked: bool,
    pub deadline: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HostConsoleSlotOccupancyDelta {
    pub slot_id: String,
    pub occupant_user_id: String,
    pub alive: bool,
    pub status: String,
    pub status_tags: Vec<String>,
    pub role_key: Option<String>,
    pub alignment: Option<String>,
    pub role_revealed: bool,
    pub alignment_revealed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HostConsoleThreadPostDelta {
    pub stream_seq: i64,
    pub author_slot: Option<String>,
    pub author_user: Option<String>,
    pub phase_id: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HostPromptsDelta {
    pub game: Uuid,
    pub prompts: Vec<HostPromptDelta>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HostPromptDelta {
    pub game: Uuid,
    pub phase_id: String,
    pub event_index: i32,
    pub prompt_id: String,
    pub kind: String,
    pub subject_slot: Option<String>,
    pub reason: String,
    pub phase_kind: String,
    pub phase_number: i32,
    #[ts(type = "unknown")]
    pub metadata: serde_json::Value,
    pub status: String,
    #[ts(type = "unknown")]
    pub decision: Option<serde_json::Value>,
    #[ts(type = "unknown")]
    pub public_resolution: Option<serde_json::Value>,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<i64>,
}

impl From<projections::HostPromptRow> for HostPromptDelta {
    fn from(row: projections::HostPromptRow) -> Self {
        HostPromptDelta {
            game: row.game_id,
            phase_id: row.phase_id,
            event_index: row.event_index,
            prompt_id: row.prompt_id,
            kind: row.kind,
            subject_slot: row.subject_slot,
            reason: row.reason,
            phase_kind: row.phase_kind,
            phase_number: row.phase_number,
            metadata: row.metadata,
            status: row.status,
            decision: row.decision,
            public_resolution: row.public_resolution,
            resolved_by: row.resolved_by,
            resolved_at: row.resolved_at,
        }
    }
}

impl From<projections::DayVoteOutcomeRow> for DayVoteOutcomeDelta {
    fn from(row: projections::DayVoteOutcomeRow) -> Self {
        DayVoteOutcomeDelta {
            game: row.game_id,
            phase_id: row.phase_id,
            source_seq: row.source_seq,
            event_index: row.event_index,
            status: row.status,
            winner_slot: row.winner_slot,
            contenders: row.contenders,
            tallies: row.tallies,
            votes: row.votes,
            weights: row.weights,
            majority: row.majority,
            thresholds: row.thresholds,
            total_weight: row.total_weight,
            tiebreak: row.tiebreak,
            reason: row.reason,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ThreadPost {
    pub game: Uuid,
    pub source_seq: i64,
    pub stream_seq: i64,
    pub channel_id: String,
    pub author_slot: Option<String>,
    pub author_user: Option<String>,
    pub phase_id: String,
    pub body: String,
    pub media: Vec<ThreadPostMedia>,
    pub occurred_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SubmitPostMedia {
    pub content_id: String,
    pub alt: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ThreadPostMedia {
    pub content_id: String,
    pub alt: String,
    pub variants: BTreeMap<String, ThreadPostMediaVariant>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ThreadPostMediaVariant {
    pub avif_url: String,
    pub webp_url: String,
    pub width: u32,
    pub height: u32,
}

impl From<projections::ThreadPostRow> for ThreadPost {
    fn from(row: projections::ThreadPostRow) -> Self {
        let media = thread_post_media(
            row.game_id,
            row.source_seq,
            row.channel_id.as_str(),
            &row.media,
        );
        ThreadPost {
            game: row.game_id,
            source_seq: row.source_seq,
            stream_seq: row.stream_seq,
            channel_id: row.channel_id,
            author_slot: row.author_slot,
            author_user: row.author_user,
            phase_id: row.phase_id,
            body: row.body,
            media,
            occurred_at: row.occurred_at,
        }
    }
}

fn thread_post_media(
    game: Uuid,
    source_seq: i64,
    channel: &str,
    value: &serde_json::Value,
) -> Vec<ThreadPostMedia> {
    let serde_json::Value::Array(items) = value else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| thread_post_media_item(game, source_seq, channel, item))
        .collect()
}

fn thread_post_media_item(
    game: Uuid,
    source_seq: i64,
    channel: &str,
    value: &serde_json::Value,
) -> Option<ThreadPostMedia> {
    let serde_json::Value::Object(object) = value else {
        return None;
    };
    let content_id = object.get("content_id")?.as_str()?.to_string();
    if !valid_media_content_id(content_id.as_str()) {
        return None;
    }
    let alt = object.get("alt")?.as_str()?.to_string();
    let variants = thread_post_media_variants(
        game,
        source_seq,
        channel,
        content_id.as_str(),
        object.get("variants")?,
    );
    let required = ["thumb", "tablet", "full-bounded"];
    if variants.len() != required.len() || required.iter().any(|kind| !variants.contains_key(*kind))
    {
        return None;
    }
    Some(ThreadPostMedia {
        content_id,
        alt,
        variants,
    })
}

fn valid_media_content_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn thread_post_media_variants(
    game: Uuid,
    source_seq: i64,
    channel: &str,
    content_id: &str,
    value: &serde_json::Value,
) -> BTreeMap<String, ThreadPostMediaVariant> {
    let serde_json::Value::Object(variants) = value else {
        return BTreeMap::new();
    };
    variants
        .iter()
        .filter_map(|(name, value)| {
            thread_post_media_variant(game, source_seq, channel, content_id, name, value)
                .map(|variant| (name.clone(), variant))
        })
        .collect()
}

fn thread_post_media_variant(
    game: Uuid,
    source_seq: i64,
    channel: &str,
    content_id: &str,
    kind: &str,
    value: &serde_json::Value,
) -> Option<ThreadPostMediaVariant> {
    let serde_json::Value::Object(object) = value else {
        return None;
    };
    let width = u32::try_from(object.get("width")?.as_u64()?).ok()?;
    let height = u32::try_from(object.get("height")?.as_u64()?).ok()?;
    if width == 0 || height == 0 {
        return None;
    }
    let prefix = format!(
        "/media/thread/{game}/{}/{source_seq}/{content_id}/{kind}",
        percent_encode_path_segment(channel),
    );
    Some(ThreadPostMediaVariant {
        avif_url: format!("{prefix}.avif"),
        webp_url: format!("{prefix}.webp"),
        width,
        height,
    })
}

fn percent_encode_path_segment(value: &str) -> String {
    use std::fmt::Write as _;

    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            write!(&mut encoded, "%{byte:02X}").expect("write to String");
        }
    }
    encoded
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ThreadPage {
    pub posts: Vec<ThreadPost>,
    pub next_before_seq: Option<i64>,
}

impl From<projections::ThreadViewPage> for ThreadPage {
    fn from(page: projections::ThreadViewPage) -> Self {
        ThreadPage {
            posts: page.posts.into_iter().map(ThreadPost::from).collect(),
            next_before_seq: page.next_before_seq,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct GameIndexEntry {
    pub game: Uuid,
    pub pack: String,
    pub status: String,
    pub phase_id: Option<String>,
    pub updated_seq: i64,
    pub completed_seq: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct GameIndexPage {
    pub games: Vec<GameIndexEntry>,
    pub next_cursor: Option<String>,
}

impl From<projections::GameIndexRow> for GameIndexEntry {
    fn from(row: projections::GameIndexRow) -> Self {
        GameIndexEntry {
            game: row.game_id,
            pack: row.pack,
            status: row.status,
            phase_id: row.phase_id,
            updated_seq: row.updated_seq,
            completed_seq: row.completed_seq,
        }
    }
}

impl From<projections::GameIndexPage> for GameIndexPage {
    fn from(page: projections::GameIndexPage) -> Self {
        GameIndexPage {
            games: page.games.into_iter().map(GameIndexEntry::from).collect(),
            next_cursor: page
                .next_cursor
                .map(|cursor| format!("{}:{}", cursor.updated_seq, cursor.game_id)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PublicGameThreadPage {
    pub game: GameIndexEntry,
    pub posts: Vec<ThreadPost>,
    pub next_before_seq: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PublicSearchResult {
    pub kind: String,
    pub title: String,
    pub excerpt: String,
    pub href: String,
    pub published_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PublicSearchPage {
    pub query: String,
    pub filter: String,
    pub results: Vec<PublicSearchResult>,
    pub next_cursor: Option<String>,
}

impl From<projections::PublicSearchRow> for PublicSearchResult {
    fn from(row: projections::PublicSearchRow) -> Self {
        PublicSearchResult {
            kind: row.kind,
            title: row.title,
            excerpt: row.excerpt,
            href: row.href,
            published_at: row.published_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DiscussionArea {
    pub slug: String,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DiscussionAuthor {
    pub handle: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DiscussionTopic {
    pub topic: Uuid,
    pub title: String,
    pub author: Option<DiscussionAuthor>,
    pub posting_state: String,
    pub visibility: String,
    pub post_count: i64,
    pub updated_seq: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_post_seq: Option<i64>,
    pub last_post_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DiscussionTopicPage {
    pub area: DiscussionArea,
    pub topics: Vec<DiscussionTopic>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DiscussionPost {
    pub source_seq: i64,
    pub author: Option<DiscussionAuthor>,
    pub body: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DiscussionThreadPage {
    pub area: DiscussionArea,
    pub topic: DiscussionTopic,
    pub posts: Vec<DiscussionPost>,
    pub next_before_seq: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SubscriptionTargetState {
    pub target_kind: String,
    pub scope_id: Uuid,
    pub subscribed: bool,
    pub read_through_seq: i64,
    pub latest_source_seq: i64,
    pub unread_count: i64,
}

impl From<projections::SubscriptionTargetStateRow> for SubscriptionTargetState {
    fn from(row: projections::SubscriptionTargetStateRow) -> Self {
        Self {
            target_kind: row.target_kind,
            scope_id: row.scope_id,
            subscribed: row.subscribed,
            read_through_seq: row.read_through_seq,
            latest_source_seq: row.latest_source_seq,
            unread_count: row.unread_count,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AdvanceSubscriptionReadRequest {
    pub read_through_seq: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct CommunityInboxItem {
    pub target_kind: String,
    pub scope_id: Uuid,
    pub source_seq: i64,
    pub title: String,
    pub href: String,
    pub occurred_at: i64,
    pub unread: bool,
    pub subscribed: bool,
}

impl From<projections::CommunityInboxItemRow> for CommunityInboxItem {
    fn from(row: projections::CommunityInboxItemRow) -> Self {
        Self {
            target_kind: row.target_kind,
            scope_id: row.scope_id,
            source_seq: row.source_seq,
            title: row.title,
            href: row.href,
            occurred_at: row.occurred_at,
            unread: row.unread,
            subscribed: row.subscribed,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct CommunityInboxPage {
    pub items: Vec<CommunityInboxItem>,
    pub unread_count: i64,
    pub next_cursor: Option<i64>,
}

impl From<projections::CommunityInboxPage> for CommunityInboxPage {
    fn from(page: projections::CommunityInboxPage) -> Self {
        Self {
            items: page
                .items
                .into_iter()
                .map(CommunityInboxItem::from)
                .collect(),
            unread_count: page.unread_count,
            next_cursor: page.next_cursor,
        }
    }
}

impl From<projections::DiscussionAreaRow> for DiscussionArea {
    fn from(area: projections::DiscussionAreaRow) -> Self {
        DiscussionArea {
            slug: area.slug,
            title: area.title,
            description: area.description,
        }
    }
}

impl From<projections::DiscussionTopicRow> for DiscussionTopic {
    fn from(topic: projections::DiscussionTopicRow) -> Self {
        DiscussionTopic {
            topic: topic.topic_id,
            title: topic.title,
            author: topic.author.map(DiscussionAuthor::from),
            posting_state: topic.posting_state,
            visibility: topic.visibility,
            post_count: topic.post_count,
            updated_seq: topic.updated_seq,
            created_at: topic.created_at,
            updated_at: topic.updated_at,
            last_post_seq: topic.last_post_seq,
            last_post_at: topic.last_post_at,
        }
    }
}

impl From<projections::DiscussionPostRow> for DiscussionPost {
    fn from(post: projections::DiscussionPostRow) -> Self {
        DiscussionPost {
            source_seq: post.source_seq,
            author: post.author.map(DiscussionAuthor::from),
            body: post.body,
            created_at: post.created_at,
        }
    }
}

impl From<projections::DiscussionAuthorRow> for DiscussionAuthor {
    fn from(author: projections::DiscussionAuthorRow) -> Self {
        DiscussionAuthor {
            handle: author.handle,
            display_name: author.display_name,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ModerationReportReceipt {
    pub report_id: Uuid,
    pub status: String,
    pub submitted_at: i64,
}

impl From<projections::ModerationReportReceiptRow> for ModerationReportReceipt {
    fn from(row: projections::ModerationReportReceiptRow) -> Self {
        Self {
            report_id: row.report_id,
            status: row.status,
            submitted_at: row.submitted_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ModerationCase {
    pub case_id: Uuid,
    pub target_kind: String,
    pub scope_id: Uuid,
    pub source_seq: i64,
    pub target_href: String,
    pub target_body: String,
    pub status: String,
    pub report_count: i64,
    pub opened_at: i64,
    pub updated_at: i64,
    pub updated_seq: i64,
    pub action_reason: Option<String>,
}

impl From<projections::ModerationCaseRow> for ModerationCase {
    fn from(row: projections::ModerationCaseRow) -> Self {
        Self {
            case_id: row.case_id,
            target_kind: row.target_kind,
            scope_id: row.scope_id,
            source_seq: row.source_seq,
            target_href: row.target_href,
            target_body: row.target_body,
            status: row.status,
            report_count: row.report_count,
            opened_at: row.opened_at,
            updated_at: row.updated_at,
            updated_seq: row.updated_seq,
            action_reason: row.action_reason,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ModerationReport {
    pub report_id: Uuid,
    pub reporter_principal_id: String,
    pub reason_family: String,
    pub details: String,
    pub active: bool,
    pub submitted_at: i64,
}

impl From<projections::ModerationReportRow> for ModerationReport {
    fn from(row: projections::ModerationReportRow) -> Self {
        Self {
            report_id: row.report_id,
            reporter_principal_id: row.reporter_principal_id,
            reason_family: row.reason_family,
            details: row.details,
            active: row.active,
            submitted_at: row.submitted_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ModerationHistory {
    pub source_seq: i64,
    pub event_kind: String,
    pub actor_principal_id: String,
    pub reason: Option<String>,
    pub occurred_at: i64,
}

impl From<projections::ModerationHistoryRow> for ModerationHistory {
    fn from(row: projections::ModerationHistoryRow) -> Self {
        Self {
            source_seq: row.source_seq,
            event_kind: row.event_kind,
            actor_principal_id: row.actor_principal_id,
            reason: row.reason,
            occurred_at: row.occurred_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ModerationCaseDetail {
    pub case: ModerationCase,
    pub reports: Vec<ModerationReport>,
    pub history: Vec<ModerationHistory>,
}

impl From<projections::ModerationCaseDetailRow> for ModerationCaseDetail {
    fn from(row: projections::ModerationCaseDetailRow) -> Self {
        Self {
            case: row.case.into(),
            reports: row.reports.into_iter().map(Into::into).collect(),
            history: row.history.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ModerationCasePage {
    pub cases: Vec<ModerationCase>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PublicProfile {
    pub handle: String,
    pub display_name: String,
    pub bio: String,
    pub updated_seq: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ProfileEditor {
    pub handle: String,
    pub display_name: String,
    pub bio: String,
    pub visibility: String,
    pub updated_seq: i64,
}

impl From<projections::PublicProfileRow> for PublicProfile {
    fn from(profile: projections::PublicProfileRow) -> Self {
        PublicProfile {
            handle: profile.handle,
            display_name: profile.display_name,
            bio: profile.bio,
            updated_seq: profile.updated_seq,
        }
    }
}

impl From<projections::ProfileEditorRow> for ProfileEditor {
    fn from(profile: projections::ProfileEditorRow) -> Self {
        ProfileEditor {
            handle: profile.handle,
            display_name: profile.display_name,
            bio: profile.bio,
            visibility: profile.visibility,
            updated_seq: profile.updated_seq,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PlayerNotification {
    pub game: Uuid,
    pub phase_id: String,
    pub event_index: i32,
    pub audience_slot: String,
    pub effect: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PlayerNotificationsDelta {
    pub game: Uuid,
    pub notifications: Vec<PlayerNotification>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PlayerInvestigationResult {
    pub game: Uuid,
    pub phase_id: String,
    pub event_index: i32,
    pub audience_slot: String,
    pub mode: String,
    pub target_slot: String,
    #[ts(type = "unknown")]
    pub result: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PlayerInvestigationResultsDelta {
    pub game: Uuid,
    pub results: Vec<PlayerInvestigationResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HostPhaseControl {
    pub game: Uuid,
    pub source_seq: i64,
    pub stream_seq: i64,
    pub prompt_id: String,
    pub prompt_kind: Option<String>,
    pub prompt_reason: Option<String>,
    pub source_phase_id: String,
    pub target_phase_id: String,
    pub reason: String,
    pub skipped_phase_id: Option<String>,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<i64>,
    pub occurred_at: i64,
}

impl From<projections::HostPhaseControlRow> for HostPhaseControl {
    fn from(row: projections::HostPhaseControlRow) -> Self {
        HostPhaseControl {
            game: row.game_id,
            source_seq: row.source_seq,
            stream_seq: row.stream_seq,
            prompt_id: row.prompt_id,
            prompt_kind: row.prompt_kind,
            prompt_reason: row.prompt_reason,
            source_phase_id: row.source_phase_id,
            target_phase_id: row.target_phase_id,
            reason: row.reason,
            skipped_phase_id: row.skipped_phase_id,
            resolved_by: row.resolved_by,
            resolved_at: row.resolved_at,
            occurred_at: row.occurred_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ResolutionTraceInspectionReport {
    pub game: Uuid,
    pub traces: Vec<ResolutionTraceInspectionRun>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ResolutionTraceInspectionRun {
    pub phase_id: String,
    pub run_id: String,
    pub applied_stream_seq: Option<i64>,
    pub trace_stream_seq: i64,
    pub trace_version: u16,
    pub decisions: Vec<ResolutionTraceDecisionRow>,
    pub edges: Vec<ResolutionTraceEdgeRow>,
    pub generated: Vec<ResolutionTraceGeneratedRow>,
    pub effect_changes: Vec<ResolutionTraceEffectChangeRow>,
    pub visibility: Vec<ResolutionTraceVisibilityRow>,
    pub notes: Vec<ResolutionTraceNoteRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ResolutionTraceDecisionRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub event_index: Option<usize>,
    pub stage: String,
    pub source: String,
    pub outcome: String,
    #[ts(type = "unknown")]
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ResolutionTraceEdgeRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub from: String,
    pub to: String,
    pub kind: String,
    #[ts(type = "unknown")]
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ResolutionTraceGeneratedRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub action_id: String,
    pub source: String,
    pub actor: String,
    pub targets: Vec<String>,
    #[ts(type = "unknown")]
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ResolutionTraceEffectChangeRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub effect: String,
    pub target: String,
    pub operation: String,
    #[ts(type = "unknown")]
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ResolutionTraceVisibilityRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub event_index: usize,
    pub audience: Vec<String>,
    pub policy: String,
    #[ts(type = "unknown")]
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ResolutionTraceNoteRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub note: String,
}

impl From<commands::ResolutionTraceInspectionReport> for ResolutionTraceInspectionReport {
    fn from(report: commands::ResolutionTraceInspectionReport) -> Self {
        ResolutionTraceInspectionReport {
            game: report.game_id,
            traces: report.traces.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<commands::ResolutionTraceInspectionRun> for ResolutionTraceInspectionRun {
    fn from(run: commands::ResolutionTraceInspectionRun) -> Self {
        ResolutionTraceInspectionRun {
            phase_id: run.phase_id,
            run_id: run.run_id,
            applied_stream_seq: run.applied_stream_seq,
            trace_stream_seq: run.trace_stream_seq,
            trace_version: run.trace_version,
            decisions: run.decisions.into_iter().map(Into::into).collect(),
            edges: run.edges.into_iter().map(Into::into).collect(),
            generated: run.generated.into_iter().map(Into::into).collect(),
            effect_changes: run.effect_changes.into_iter().map(Into::into).collect(),
            visibility: run.visibility.into_iter().map(Into::into).collect(),
            notes: run.notes.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<commands::ResolutionTraceDecisionRow> for ResolutionTraceDecisionRow {
    fn from(row: commands::ResolutionTraceDecisionRow) -> Self {
        ResolutionTraceDecisionRow {
            row_index: row.row_index,
            applied_stream_seq: row.applied_stream_seq,
            event_index: row.event_index,
            stage: row.stage,
            source: row.source,
            outcome: row.outcome,
            detail: row.detail,
        }
    }
}

impl From<commands::ResolutionTraceEdgeRow> for ResolutionTraceEdgeRow {
    fn from(row: commands::ResolutionTraceEdgeRow) -> Self {
        ResolutionTraceEdgeRow {
            row_index: row.row_index,
            applied_stream_seq: row.applied_stream_seq,
            from: row.from,
            to: row.to,
            kind: row.kind,
            detail: row.detail,
        }
    }
}

impl From<commands::ResolutionTraceGeneratedRow> for ResolutionTraceGeneratedRow {
    fn from(row: commands::ResolutionTraceGeneratedRow) -> Self {
        ResolutionTraceGeneratedRow {
            row_index: row.row_index,
            applied_stream_seq: row.applied_stream_seq,
            action_id: row.action_id,
            source: row.source,
            actor: row.actor,
            targets: row.targets,
            detail: row.detail,
        }
    }
}

impl From<commands::ResolutionTraceEffectChangeRow> for ResolutionTraceEffectChangeRow {
    fn from(row: commands::ResolutionTraceEffectChangeRow) -> Self {
        ResolutionTraceEffectChangeRow {
            row_index: row.row_index,
            applied_stream_seq: row.applied_stream_seq,
            effect: row.effect,
            target: row.target,
            operation: row.operation,
            detail: row.detail,
        }
    }
}

impl From<commands::ResolutionTraceVisibilityRow> for ResolutionTraceVisibilityRow {
    fn from(row: commands::ResolutionTraceVisibilityRow) -> Self {
        ResolutionTraceVisibilityRow {
            row_index: row.row_index,
            applied_stream_seq: row.applied_stream_seq,
            event_index: row.event_index,
            audience: row.audience,
            policy: row.policy,
            detail: row.detail,
        }
    }
}

impl From<commands::ResolutionTraceNoteRow> for ResolutionTraceNoteRow {
    fn from(row: commands::ResolutionTraceNoteRow) -> Self {
        ResolutionTraceNoteRow {
            row_index: row.row_index,
            applied_stream_seq: row.applied_stream_seq,
            note: row.note,
        }
    }
}

impl From<projections::PlayerNotificationRow> for PlayerNotification {
    fn from(row: projections::PlayerNotificationRow) -> Self {
        PlayerNotification {
            game: row.game_id,
            phase_id: row.phase_id,
            event_index: row.event_index,
            audience_slot: row.audience_slot,
            effect: row.effect,
            status: row.status,
        }
    }
}

impl From<projections::PlayerInvestigationResultRow> for PlayerInvestigationResult {
    fn from(row: projections::PlayerInvestigationResultRow) -> Self {
        PlayerInvestigationResult {
            game: row.game_id,
            phase_id: row.phase_id,
            event_index: row.event_index,
            audience_slot: row.audience_slot,
            mode: row.mode,
            target_slot: row.target_slot,
            result: row.result,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "body")]
pub enum CapabilityGrant {
    GlobalAdmin,
    GlobalMod,
    HostOf { game: Uuid },
    CohostOf { game: Uuid },
    SlotOccupant { slot: String },
    ChannelMember { channel: String },
    DeadViewer { game: Uuid },
    SpectatorOf { game: Uuid },
}

pub mod typescript {
    use game_platform::{
        ChannelId, ConcreteEffect, ContentRef, DayEvent, DayEventDecision, DayEventEvent,
        DayEventId, DayEventResolutionMode, DayEventSchedule, DayEventState, DurationSeconds,
        EffectOperationTemplate, EffectOrigin, EffectPlan, EffectVisibility, EventChannelPolicy,
        GrantKind, GrantSpec, NarrativeTemplates, OptionId, ParticipantFilter, ParticipationLimits,
        ParticipationMode, ParticipationPayload, ParticipationSpec, PhaseId, PhaseScope,
        PrincipalId, ProgramId, ProgramTrigger, RecipientBindings, RecipientSelector,
        RewardAssignment, RewardBinding, RewardEffectTemplate, RewardKey, SlotId,
        SlotLifecycleEffect, Tag, TemplateKey, UnixSeconds,
    };
    use ts_rs::TS;

    use crate::{
        AckMsg, AdvanceSubscriptionReadRequest, CapabilityGrant, ClientEnvelope, ClientMsg,
        CohostPermissionClass, Command, CommandMsg, CommunityInboxItem, CommunityInboxPage,
        DayVoteOutcomeDelta, DiscussionArea, DiscussionAuthor, DiscussionPost,
        DiscussionThreadPage, DiscussionTopic, DiscussionTopicPage, GameIndexEntry, GameIndexPage,
        Hello, HostConsoleAuthorityDelta, HostConsoleAuthorityKind, HostConsolePhaseStateDelta,
        HostConsoleSlotOccupancyDelta, HostConsoleStateDelta, HostConsoleThreadPostDelta,
        HostPhaseControl, HostPromptDecision, HostPromptDelta, HostPromptsDelta, ModerationCase,
        ModerationCaseDetail, ModerationCasePage, ModerationHistory, ModerationReport,
        ModerationReportReceipt, PlayerInvestigationResult, PlayerNotification, ProfileEditor,
        ProjectionDelta, PublicGameThreadPage, PublicProfile, PublicSearchPage, PublicSearchResult,
        RejectCode, RejectMsg, ResolutionTraceDecisionRow, ResolutionTraceEdgeRow,
        ResolutionTraceEffectChangeRow, ResolutionTraceGeneratedRow,
        ResolutionTraceInspectionReport, ResolutionTraceInspectionRun, ResolutionTraceNoteRow,
        ResolutionTraceVisibilityRow, ServerEnvelope, ServerMsg, SlotLifecycle, SubmitPostMedia,
        SubscriptionTargetState, ThreadPage, ThreadPost, ThreadPostMedia, ThreadPostMediaVariant,
        ThreadPostsDelta, VoteCountClearedDelta, VoteCountDelta, VoteTarget,
    };

    const HEADER: &str = "// This file is @generated by wire::typescript::render.\n// Run `cargo run -p wire --bin export_types` to regenerate.\n\n";

    pub fn render() -> String {
        let mut out = String::from(HEADER);
        push::<DayEventId>(&mut out);
        push::<ProgramId>(&mut out);
        push::<TemplateKey>(&mut out);
        push::<RewardKey>(&mut out);
        push::<SlotId>(&mut out);
        push::<PhaseId>(&mut out);
        push::<OptionId>(&mut out);
        push::<Tag>(&mut out);
        push::<ContentRef>(&mut out);
        push::<ChannelId>(&mut out);
        push::<PrincipalId>(&mut out);
        push::<UnixSeconds>(&mut out);
        push::<DurationSeconds>(&mut out);
        push::<PhaseScope>(&mut out);
        push::<ProgramTrigger>(&mut out);
        push::<DayEventSchedule>(&mut out);
        push::<DayEventState>(&mut out);
        push::<DayEventResolutionMode>(&mut out);
        push::<ParticipantFilter>(&mut out);
        push::<ParticipationMode>(&mut out);
        push::<ParticipationLimits>(&mut out);
        push::<ParticipationSpec>(&mut out);
        push::<ParticipationPayload>(&mut out);
        push::<NarrativeTemplates>(&mut out);
        push::<EventChannelPolicy>(&mut out);
        push::<RecipientSelector>(&mut out);
        push::<SlotLifecycleEffect>(&mut out);
        push::<GrantKind>(&mut out);
        push::<EffectVisibility>(&mut out);
        push::<GrantSpec>(&mut out);
        push::<EffectOperationTemplate>(&mut out);
        push::<RewardEffectTemplate>(&mut out);
        push::<RewardBinding>(&mut out);
        push::<RecipientBindings>(&mut out);
        push::<ConcreteEffect>(&mut out);
        push::<EffectOrigin>(&mut out);
        push::<EffectPlan>(&mut out);
        push::<DayEvent>(&mut out);
        push::<RewardAssignment>(&mut out);
        push::<DayEventDecision>(&mut out);
        push::<DayEventEvent>(&mut out);
        push::<VoteTarget>(&mut out);
        push::<HostPromptDecision>(&mut out);
        push::<SlotLifecycle>(&mut out);
        push::<SubmitPostMedia>(&mut out);
        push::<CohostPermissionClass>(&mut out);
        push::<Command>(&mut out);
        push::<CommandMsg>(&mut out);
        push::<ClientMsg>(&mut out);
        push::<ClientEnvelope>(&mut out);
        push::<AckMsg>(&mut out);
        push::<RejectCode>(&mut out);
        push::<RejectMsg>(&mut out);
        push::<VoteCountDelta>(&mut out);
        push::<VoteCountClearedDelta>(&mut out);
        push::<ThreadPostsDelta>(&mut out);
        push::<DayVoteOutcomeDelta>(&mut out);
        push::<HostConsoleAuthorityKind>(&mut out);
        push::<HostConsoleAuthorityDelta>(&mut out);
        push::<HostConsolePhaseStateDelta>(&mut out);
        push::<HostConsoleSlotOccupancyDelta>(&mut out);
        push::<HostConsoleThreadPostDelta>(&mut out);
        push::<HostConsoleStateDelta>(&mut out);
        push::<HostPromptDelta>(&mut out);
        push::<HostPromptsDelta>(&mut out);
        push::<ThreadPost>(&mut out);
        push::<ThreadPostMedia>(&mut out);
        push::<ThreadPostMediaVariant>(&mut out);
        push::<ThreadPage>(&mut out);
        push::<GameIndexEntry>(&mut out);
        push::<GameIndexPage>(&mut out);
        push::<PublicGameThreadPage>(&mut out);
        push::<PublicSearchResult>(&mut out);
        push::<PublicSearchPage>(&mut out);
        push::<DiscussionArea>(&mut out);
        push::<DiscussionAuthor>(&mut out);
        push::<DiscussionTopic>(&mut out);
        push::<DiscussionTopicPage>(&mut out);
        push::<DiscussionPost>(&mut out);
        push::<DiscussionThreadPage>(&mut out);
        push::<SubscriptionTargetState>(&mut out);
        push::<AdvanceSubscriptionReadRequest>(&mut out);
        push::<CommunityInboxItem>(&mut out);
        push::<CommunityInboxPage>(&mut out);
        push::<ModerationReportReceipt>(&mut out);
        push::<ModerationCase>(&mut out);
        push::<ModerationReport>(&mut out);
        push::<ModerationHistory>(&mut out);
        push::<ModerationCaseDetail>(&mut out);
        push::<ModerationCasePage>(&mut out);
        push::<PublicProfile>(&mut out);
        push::<ProfileEditor>(&mut out);
        push::<PlayerNotification>(&mut out);
        push::<PlayerInvestigationResult>(&mut out);
        push::<HostPhaseControl>(&mut out);
        push::<ResolutionTraceDecisionRow>(&mut out);
        push::<ResolutionTraceEdgeRow>(&mut out);
        push::<ResolutionTraceGeneratedRow>(&mut out);
        push::<ResolutionTraceEffectChangeRow>(&mut out);
        push::<ResolutionTraceVisibilityRow>(&mut out);
        push::<ResolutionTraceNoteRow>(&mut out);
        push::<ResolutionTraceInspectionRun>(&mut out);
        push::<ResolutionTraceInspectionReport>(&mut out);
        push::<ProjectionDelta>(&mut out);
        push::<CapabilityGrant>(&mut out);
        push::<Hello>(&mut out);
        push::<ServerMsg>(&mut out);
        push::<ServerEnvelope>(&mut out);
        out
    }

    fn push<T: TS>(out: &mut String) {
        let decl = T::decl();
        if decl.starts_with("type ") {
            out.push_str("export ");
        }
        for (idx, line) in decl.lines().enumerate() {
            if idx > 0 {
                out.push('\n');
            }
            out.push_str(line.trim_end());
        }
        out.push_str("\n\n");
    }
}

impl From<&caps::Capability> for CapabilityGrant {
    fn from(cap: &caps::Capability) -> Self {
        match cap {
            caps::Capability::GlobalAdmin => CapabilityGrant::GlobalAdmin,
            caps::Capability::GlobalMod => CapabilityGrant::GlobalMod,
            caps::Capability::HostOf(game) => CapabilityGrant::HostOf { game: *game },
            caps::Capability::CohostOf(game) => CapabilityGrant::CohostOf { game: *game },
            caps::Capability::SlotOccupant(slot) => {
                CapabilityGrant::SlotOccupant { slot: slot.clone() }
            }
            caps::Capability::ChannelMember(channel) => CapabilityGrant::ChannelMember {
                channel: channel.clone(),
            },
            caps::Capability::DeadViewer(game) => CapabilityGrant::DeadViewer { game: *game },
            caps::Capability::SpectatorOf(game) => CapabilityGrant::SpectatorOf { game: *game },
        }
    }
}
