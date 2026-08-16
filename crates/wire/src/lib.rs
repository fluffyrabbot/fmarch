//! `wire` — versioned transport types crossing the Rust/client boundary.
//!
//! Wire types are deliberately separate from domain and storage types. They are
//! the stable transport contract; server internals may evolve behind them.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;
use uuid::Uuid;

/// Compact fixture construction for a wire-level named seating command.
#[doc(hidden)]
#[macro_export]
macro_rules! seat_persona {
    ($game:ident, slot: $slot:expr, user: $user:expr $(,)?) => {{
        let slot: String = $slot;
        let principal_user_id: String = $user;
        let public_name = format!("Player {slot}");
        $crate::Command::SeatPersona {
            game: $game,
            public_name,
            principal_user_id,
            slot,
        }
    }};
}

pub const PROTOCOL_VERSION: u16 = 2;

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
#[expect(
    clippy::large_enum_variant,
    reason = "transport messages preserve direct payload ownership until the wire boundary is benchmarked as an allocation concern"
)]
pub enum ClientMsg {
    Command(CommandMsg),
    SubscribeGame { game: Uuid },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "body")]
#[expect(
    clippy::large_enum_variant,
    reason = "transport messages preserve direct payload ownership until the wire boundary is benchmarked as an allocation concern"
)]
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

/// Wire-local ITA session control kind. Domain's enum has no TS derive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ItaSessionControlKind {
    Open,
    Pause,
    Cancel,
    Update,
    Close,
}

impl From<ItaSessionControlKind> for domain::ItaSessionControlKind {
    fn from(control: ItaSessionControlKind) -> Self {
        match control {
            ItaSessionControlKind::Open => domain::ItaSessionControlKind::Open,
            ItaSessionControlKind::Pause => domain::ItaSessionControlKind::Pause,
            ItaSessionControlKind::Cancel => domain::ItaSessionControlKind::Cancel,
            ItaSessionControlKind::Update => domain::ItaSessionControlKind::Update,
            ItaSessionControlKind::Close => domain::ItaSessionControlKind::Close,
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
    SeatPersona {
        game: Uuid,
        slot: String,
        principal_user_id: String,
        public_name: String,
    },
    RenameGamePersona {
        game: Uuid,
        persona_id: String,
        public_name: String,
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
    AddSlotStatusTag {
        game: Uuid,
        slot: String,
        tag: String,
    },
    RemoveSlotStatusTag {
        game: Uuid,
        slot: String,
        tag: String,
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
    ControlItaSession {
        game: Uuid,
        session_id: String,
        control: ItaSessionControlKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        message: Option<String>,
    },
    ApplyEffectPlan {
        game: Uuid,
        effects: Vec<game_platform::ConcreteEffect>,
        reason: String,
    },
    AttachDayProgram {
        game: Uuid,
        program_ref: game_platform::DayProgramRef,
    },
    ScheduleDayEvent {
        game: Uuid,
        event: game_platform::DayEvent,
    },
    OpenDayEvent {
        game: Uuid,
        event_id: game_platform::DayEventId,
    },
    LockDayEvent {
        game: Uuid,
        event_id: game_platform::DayEventId,
    },
    CancelDayEvent {
        game: Uuid,
        event_id: game_platform::DayEventId,
        reason: String,
    },
    SubmitDayEventParticipation {
        game: Uuid,
        event_id: game_platform::DayEventId,
        actor_slot: String,
        payload: game_platform::ParticipationPayload,
    },
    WithdrawDayEventParticipation {
        game: Uuid,
        event_id: game_platform::DayEventId,
        actor_slot: String,
    },
    ResolveDayEvent {
        game: Uuid,
        event_id: game_platform::DayEventId,
        decision: game_platform::DayEventDecision,
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
        #[serde(default)]
        #[ts(optional)]
        quotations: Option<Vec<Quotation>>,
    },
    ExtendDeadline {
        game: Uuid,
        phase: String,
        at: i64,
    },
    ProcessReplacement {
        game: Uuid,
        slot: String,
        outgoing_persona_id: String,
        incoming_principal_user_id: String,
    },
}

/// Transport commands either map directly to the command core or require an
/// adapter-owned immutable artifact lookup first.
#[derive(Debug, Clone, PartialEq)]
#[expect(
    clippy::large_enum_variant,
    reason = "dispatch preserves direct command ownership until adapter extraction establishes the final transport shape"
)]
pub enum CommandDispatch {
    Direct(commands::Command),
    AttachDayProgram {
        game: Uuid,
        program_ref: game_platform::DayProgramRef,
    },
}

impl Command {
    pub fn into_dispatch(self) -> CommandDispatch {
        let command = match self {
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
            Command::SeatPersona {
                game,
                slot,
                principal_user_id,
                public_name,
            } => commands::Command::SeatPersona {
                game,
                slot,
                principal_user_id,
                public_name,
            },
            Command::RenameGamePersona {
                game,
                persona_id,
                public_name,
            } => commands::Command::RenameGamePersona {
                game,
                persona_id,
                public_name,
            },
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
            Command::AddSlotStatusTag { game, slot, tag } => {
                commands::Command::AddSlotStatusTag { game, slot, tag }
            }
            Command::RemoveSlotStatusTag { game, slot, tag } => {
                commands::Command::RemoveSlotStatusTag { game, slot, tag }
            }
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
            Command::ControlItaSession {
                game,
                session_id,
                control,
                message,
            } => commands::Command::ControlItaSession {
                game,
                session_id,
                control: control.into(),
                message,
            },
            Command::ApplyEffectPlan {
                game,
                effects,
                reason,
            } => commands::Command::ApplyEffectPlan {
                game,
                effects,
                reason,
            },
            Command::AttachDayProgram { game, program_ref } => {
                return CommandDispatch::AttachDayProgram { game, program_ref };
            }
            Command::ScheduleDayEvent { game, event } => {
                commands::Command::ScheduleDayEvent { game, event }
            }
            Command::OpenDayEvent { game, event_id } => {
                commands::Command::OpenDayEvent { game, event_id }
            }
            Command::LockDayEvent { game, event_id } => {
                commands::Command::LockDayEvent { game, event_id }
            }
            Command::CancelDayEvent {
                game,
                event_id,
                reason,
            } => commands::Command::CancelDayEvent {
                game,
                event_id,
                reason,
            },
            Command::SubmitDayEventParticipation {
                game,
                event_id,
                actor_slot,
                payload,
            } => commands::Command::SubmitDayEventParticipation {
                game,
                event_id,
                actor_slot,
                payload,
            },
            Command::WithdrawDayEventParticipation {
                game,
                event_id,
                actor_slot,
            } => commands::Command::WithdrawDayEventParticipation {
                game,
                event_id,
                actor_slot,
            },
            Command::ResolveDayEvent {
                game,
                event_id,
                decision,
            } => commands::Command::ResolveDayEvent {
                game,
                event_id,
                decision,
            },
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
                quotations,
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
                quotations: quotations
                    .unwrap_or_default()
                    .into_iter()
                    .map(Quotation::into)
                    .collect(),
            },
            Command::ExtendDeadline { game, phase, at } => {
                commands::Command::ExtendDeadline { game, phase, at }
            }
            Command::ProcessReplacement {
                game,
                slot,
                outgoing_persona_id,
                incoming_principal_user_id,
            } => commands::Command::ProcessReplacement {
                game,
                slot,
                outgoing_persona_id,
                incoming_principal_user_id,
            },
        };
        CommandDispatch::Direct(command)
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
    UnknownDayEvent,
    DayEventAlreadyExists,
    DayEventStateConflict,
    DuplicateParticipation,
    ParticipationNotFound,
    ParticipationNotAllowed,
    DayEventValidation,
    DayProgramValidation,
    PackValidation,
    DayProgramAlreadyAttached,
    EffectSpecValidation,
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
            commands::Reject::UnknownDayEvent => RejectCode::UnknownDayEvent,
            commands::Reject::DayEventAlreadyExists => RejectCode::DayEventAlreadyExists,
            commands::Reject::DayEventStateConflict(_) => RejectCode::DayEventStateConflict,
            commands::Reject::DuplicateParticipation => RejectCode::DuplicateParticipation,
            commands::Reject::ParticipationNotFound => RejectCode::ParticipationNotFound,
            commands::Reject::ParticipationNotAllowed(_) => RejectCode::ParticipationNotAllowed,
            commands::Reject::DayEventValidation(_) => RejectCode::DayEventValidation,
            commands::Reject::DayProgramValidation(_) => RejectCode::DayProgramValidation,
            commands::Reject::PackValidation(_) => RejectCode::PackValidation,
            commands::Reject::DayProgramAlreadyAttached => RejectCode::DayProgramAlreadyAttached,
            commands::Reject::EffectSpecValidation(_) => RejectCode::EffectSpecValidation,
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
    ThreadPostRemoved(ThreadPostRemovedDelta),
    PostCitationsChanged(PostCitationsChangedDelta),
    HostConsoleStateChanged(HostConsoleStateDelta),
    HostConsoleHeaderChanged(HostConsoleHeaderDelta),
    HostConsoleSlotsChanged(HostConsoleSlotsDelta),
    HostConsoleThreadPostsChanged(HostConsoleThreadPostsDelta),
    HostConsoleThreadPostRemoved(HostConsoleThreadPostRemovedDelta),
    HostConsoleDayEventsChanged(HostConsoleDayEventsDelta),
    HostConsoleSchedulerChanged(HostConsoleSchedulerDelta),
    HostConsoleTasksChanged(HostConsoleTasksDelta),
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ThreadPostRemovedDelta {
    pub game: Uuid,
    pub source_seq: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PostCitationsChangedDelta {
    pub quoted: PostRef,
    pub citation_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct DayVoteOutcomeDelta {
    pub game: Uuid,
    pub phase_id: String,
    pub source_seq: i64,
    pub event_index: i32,
    pub status: String,
    pub winner_slot: Option<String>,
    pub contenders: Vec<String>,
    pub tallies: BTreeMap<String, f64>,
    pub votes: BTreeMap<String, String>,
    pub weights: BTreeMap<String, f64>,
    pub majority: Option<f64>,
    pub thresholds: BTreeMap<String, f64>,
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
    /// Operational scheduler posture for this game. This is worker state, not a
    /// second source of DayEvent truth.
    pub day_event_scheduler: Option<DayEventSchedulerDelta>,
    /// Authoritative DayEvent workspace rows. HostTasks reference these by
    /// `source_id`; the workspace owns definition and participation detail.
    pub day_events: Vec<HostDayEventDelta>,
    /// Permission-aware exception-queue selectors derived from authoritative
    /// projections. A task id identifies one decision instance; `kind` only
    /// identifies the family that knows how to render it.
    pub tasks: Vec<HostTaskDelta>,
}

/// Hello/resync keep [`HostConsoleStateChanged`]. Live ticks emit the cells below.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HostConsoleHeaderDelta {
    pub game: Uuid,
    pub authority: HostConsoleAuthorityDelta,
    pub completed: bool,
    pub phase: Option<HostConsolePhaseStateDelta>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HostConsoleSlotsDelta {
    pub game: Uuid,
    pub slots: Vec<HostConsoleSlotOccupancyDelta>,
    pub removed_slot_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HostConsoleThreadPostsDelta {
    pub game: Uuid,
    pub posts: Vec<HostConsoleThreadPostDelta>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HostConsoleThreadPostRemovedDelta {
    pub game: Uuid,
    pub stream_seq: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HostConsoleDayEventsDelta {
    pub game: Uuid,
    pub day_events: Vec<HostDayEventDelta>,
    pub removed_event_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HostConsoleSchedulerDelta {
    pub game: Uuid,
    pub day_event_scheduler: Option<DayEventSchedulerDelta>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HostConsoleTasksDelta {
    pub game: Uuid,
    pub tasks: Vec<HostTaskDelta>,
}

/// Diff two host-console snapshots into live cells. `None` previous is Hello/resync.
pub fn host_console_patches(
    previous: Option<&HostConsoleStateDelta>,
    current: &HostConsoleStateDelta,
) -> Vec<ProjectionDelta> {
    let Some(previous) = previous.filter(|previous| previous.game == current.game) else {
        return vec![ProjectionDelta::HostConsoleStateChanged(current.clone())];
    };

    let mut deltas = Vec::new();
    if previous.authority != current.authority
        || previous.completed != current.completed
        || previous.phase != current.phase
    {
        deltas.push(ProjectionDelta::HostConsoleHeaderChanged(
            HostConsoleHeaderDelta {
                game: current.game,
                authority: current.authority.clone(),
                completed: current.completed,
                phase: current.phase.clone(),
            },
        ));
    }

    let previous_slots = previous
        .slots
        .iter()
        .map(|slot| (slot.slot_id.as_str(), slot))
        .collect::<BTreeMap<_, _>>();
    let current_slots = current
        .slots
        .iter()
        .map(|slot| (slot.slot_id.as_str(), slot))
        .collect::<BTreeMap<_, _>>();
    let changed_slots = current
        .slots
        .iter()
        .filter(|slot| previous_slots.get(slot.slot_id.as_str()) != Some(slot))
        .cloned()
        .collect::<Vec<_>>();
    let removed_slot_ids = previous
        .slots
        .iter()
        .filter(|slot| !current_slots.contains_key(slot.slot_id.as_str()))
        .map(|slot| slot.slot_id.clone())
        .collect::<Vec<_>>();
    if !changed_slots.is_empty() || !removed_slot_ids.is_empty() {
        deltas.push(ProjectionDelta::HostConsoleSlotsChanged(
            HostConsoleSlotsDelta {
                game: current.game,
                slots: changed_slots,
                removed_slot_ids,
            },
        ));
    }

    let previous_posts = previous
        .thread_posts
        .iter()
        .map(|post| (post.stream_seq, post))
        .collect::<BTreeMap<_, _>>();
    let current_posts = current
        .thread_posts
        .iter()
        .map(|post| (post.stream_seq, post))
        .collect::<BTreeMap<_, _>>();
    let changed_posts = current
        .thread_posts
        .iter()
        .filter(|post| previous_posts.get(&post.stream_seq) != Some(post))
        .cloned()
        .collect::<Vec<_>>();
    if !changed_posts.is_empty() {
        deltas.push(ProjectionDelta::HostConsoleThreadPostsChanged(
            HostConsoleThreadPostsDelta {
                game: current.game,
                posts: changed_posts,
            },
        ));
    }
    deltas.extend(
        previous
            .thread_posts
            .iter()
            .filter(|post| !current_posts.contains_key(&post.stream_seq))
            .map(|post| {
                ProjectionDelta::HostConsoleThreadPostRemoved(HostConsoleThreadPostRemovedDelta {
                    game: current.game,
                    stream_seq: post.stream_seq,
                })
            }),
    );

    if previous.day_event_scheduler != current.day_event_scheduler {
        deltas.push(ProjectionDelta::HostConsoleSchedulerChanged(
            HostConsoleSchedulerDelta {
                game: current.game,
                day_event_scheduler: current.day_event_scheduler.clone(),
            },
        ));
    }

    let previous_events = previous
        .day_events
        .iter()
        .map(|event| (event.event_id.as_str(), event))
        .collect::<BTreeMap<_, _>>();
    let current_events = current
        .day_events
        .iter()
        .map(|event| (event.event_id.as_str(), event))
        .collect::<BTreeMap<_, _>>();
    let changed_events = current
        .day_events
        .iter()
        .filter(|event| previous_events.get(event.event_id.as_str()) != Some(event))
        .cloned()
        .collect::<Vec<_>>();
    let removed_event_ids = previous
        .day_events
        .iter()
        .filter(|event| !current_events.contains_key(event.event_id.as_str()))
        .map(|event| event.event_id.clone())
        .collect::<Vec<_>>();
    if !changed_events.is_empty() || !removed_event_ids.is_empty() {
        deltas.push(ProjectionDelta::HostConsoleDayEventsChanged(
            HostConsoleDayEventsDelta {
                game: current.game,
                day_events: changed_events,
                removed_event_ids,
            },
        ));
    }

    if previous.tasks != current.tasks {
        deltas.push(ProjectionDelta::HostConsoleTasksChanged(
            HostConsoleTasksDelta {
                game: current.game,
                tasks: current.tasks.clone(),
            },
        ));
    }

    deltas
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HostDayEventDelta {
    pub event_id: String,
    pub state: String,
    pub phase_id: Option<String>,
    pub definition: game_platform::DayEvent,
    /// The derived private room and its current membership posture. Public
    /// events have no room descriptor because their narratives live in main.
    pub room: Option<DayEventRoomDelta>,
    pub participant_slots: Vec<String>,
    pub open_due_at: Option<i64>,
    pub open_observed_at: Option<i64>,
    pub lock_due_at: Option<i64>,
    pub lock_observed_at: Option<i64>,
    pub auto_seed: Option<u64>,
    pub resolution_evidence: Option<game_platform::DayEventResolutionEvidence>,
    pub winner_slots: Vec<String>,
    pub reward_keys_applied: Vec<String>,
    pub narratives: Vec<DayEventNarrativeDelta>,
}

/// One derived private DayEvent room. This is a read projection, not ambient
/// authority: player responses include it only while the current slot remains
/// a projected member, and all thread/post boundaries still resolve capability
/// authority independently.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DayEventRoomDelta {
    pub event_id: String,
    pub channel_id: String,
    pub template_key: String,
    pub state: String,
    pub membership: game_platform::EventChannelMembership,
    pub member_count: u32,
    pub posting_allowed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DayEventNarrativeDelta {
    pub lifecycle: game_platform::NarrativeLifecycle,
    pub template_key: String,
    pub template_hash: String,
    pub channel_id: String,
    pub status: String,
    pub body: Option<String>,
    pub source_seq: Option<i64>,
    pub published_seq: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DayEventSchedulerDelta {
    pub pending: bool,
    pub next_due_at: Option<i64>,
    pub auto_resolve_pending: bool,
    pub narrative_pending: bool,
    pub wake_seq: i64,
    pub last_observed_wake_seq: i64,
    pub lease_until: Option<i64>,
    pub retry_not_before: Option<i64>,
    pub last_attempt_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub last_failure_at: Option<i64>,
    pub consecutive_failures: i32,
    pub total_attempts: i64,
    pub total_successes: i64,
    pub last_error: Option<String>,
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
    pub occupancy_id: String,
    pub persona_id: String,
    pub public_name: String,
    pub assigned_principal_user_id: String,
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
    #[serde(default)]
    pub quotations: Vec<Quotation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum HostTaskKind {
    EngineHostPrompt,
    DayEventResolve,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum HostTaskState {
    Ready,
    Blocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum HostTaskUrgency {
    Attention,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum HostTaskCommandKind {
    ResolveHostPrompt,
    ResolveDayEvent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HostTaskAllowedCommand {
    pub kind: HostTaskCommandKind,
    pub permission_class: CohostPermissionClass,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HostTaskDelta {
    /// Stable instance identity, distinct from [`HostTaskKind`].
    pub id: String,
    pub kind: HostTaskKind,
    pub state: HostTaskState,
    pub urgency: HostTaskUrgency,
    pub intent: String,
    pub consequence: String,
    pub phase_id: String,
    pub subject_slot: Option<String>,
    /// Identity of the authoritative fact from which this selector is derived.
    pub source_id: String,
    pub allowed_commands: Vec<HostTaskAllowedCommand>,
    pub blocked_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HostPromptsDelta {
    pub game: Uuid,
    pub prompts: Vec<HostPromptDelta>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
pub struct HostPromptMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub policy: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub contenders: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tiebreak: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub death_cause: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

/// Stored host-prompt decision as folded into the projection (snake_case tagged).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HostPromptRecordedDecision {
    SelectSlot { slot: String },
    SelectPolicy { policy: String },
    Acknowledge,
}

/// Public host-prompt resolution, matching [`domain::HostPromptPublicResolution`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HostPromptPublicResolution {
    DayVoteElimination {
        phase_id: String,
        selected_slot: String,
        reason: String,
    },
    PhaseAdvance {
        source_phase_id: String,
        target_phase_id: String,
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        skipped_phase_id: Option<String>,
    },
    Acknowledged {
        phase_id: String,
        reason: String,
    },
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
    pub metadata: HostPromptMetadata,
    pub status: String,
    pub decision: Option<HostPromptRecordedDecision>,
    pub public_resolution: Option<HostPromptPublicResolution>,
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
            metadata: json_value(row.metadata),
            status: row.status,
            decision: json_opt(row.decision),
            public_resolution: json_opt(row.public_resolution),
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
            contenders: json_value(row.contenders),
            tallies: json_value(row.tallies),
            votes: json_value(row.votes),
            weights: json_value(row.weights),
            majority: row.majority,
            thresholds: json_value(row.thresholds),
            total_weight: row.total_weight,
            tiebreak: row.tiebreak,
            reason: row.reason,
        }
    }
}

fn json_value<T: Default + serde::de::DeserializeOwned>(value: serde_json::Value) -> T {
    serde_json::from_value(value).unwrap_or_default()
}

fn json_opt<T: serde::de::DeserializeOwned>(value: Option<serde_json::Value>) -> Option<T> {
    value.and_then(|value| serde_json::from_value(value).ok())
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
    #[serde(default)]
    pub quotations: Vec<Quotation>,
    #[serde(default)]
    pub citation_count: i64,
    pub occurred_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SubmitPostMedia {
    pub content_id: String,
    pub alt: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PostKind {
    DiscussionPost,
    GamePost,
}

impl From<PostKind> for community::PostKind {
    fn from(kind: PostKind) -> Self {
        match kind {
            PostKind::DiscussionPost => community::PostKind::DiscussionPost,
            PostKind::GamePost => community::PostKind::GamePost,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PostRef {
    pub kind: PostKind,
    pub scope_id: Uuid,
    pub source_seq: i64,
}

impl From<PostRef> for community::PostRef {
    fn from(value: PostRef) -> Self {
        community::PostRef {
            kind: value.kind.into(),
            scope_id: value.scope_id,
            source_seq: value.source_seq,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Quotation {
    pub target: PostRef,
    pub excerpt: String,
}

impl From<Quotation> for community::Quotation {
    fn from(value: Quotation) -> Self {
        community::Quotation {
            target: value.target.into(),
            excerpt: value.excerpt,
        }
    }
}

impl From<community::PostKind> for PostKind {
    fn from(kind: community::PostKind) -> Self {
        match kind {
            community::PostKind::DiscussionPost => PostKind::DiscussionPost,
            community::PostKind::GamePost => PostKind::GamePost,
        }
    }
}

impl From<community::PostRef> for PostRef {
    fn from(value: community::PostRef) -> Self {
        PostRef {
            kind: value.kind.into(),
            scope_id: value.scope_id,
            source_seq: value.source_seq,
        }
    }
}

impl From<community::Quotation> for Quotation {
    fn from(value: community::Quotation) -> Self {
        Quotation {
            target: value.target.into(),
            excerpt: value.excerpt,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PostCitation {
    pub quoting: PostRef,
    pub occurred_at: i64,
}

impl From<projections::PostCitationRow> for PostCitation {
    fn from(row: projections::PostCitationRow) -> Self {
        PostCitation {
            quoting: row.quoting.into(),
            occurred_at: row.occurred_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PostCitationPage {
    pub quoted: PostRef,
    pub citations: Vec<PostCitation>,
    pub citation_count: i64,
}

impl From<projections::PostCitationPage> for PostCitationPage {
    fn from(page: projections::PostCitationPage) -> Self {
        PostCitationPage {
            quoted: page.quoted.into(),
            citations: page.citations.into_iter().map(PostCitation::from).collect(),
            citation_count: page.citation_count,
        }
    }
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
            quotations: row.quotations.into_iter().map(Quotation::from).collect(),
            citation_count: row.citation_count,
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
            pack: row.pack_ref.key,
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
    #[serde(default)]
    pub quotations: Vec<Quotation>,
    #[serde(default)]
    pub citation_count: i64,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct MemberMuteState {
    pub profile_id: Uuid,
    pub handle: String,
    pub display_name: String,
    pub muted: bool,
    pub updated_seq: i64,
}

impl From<projections::MemberMuteStateRow> for MemberMuteState {
    fn from(row: projections::MemberMuteStateRow) -> Self {
        Self {
            profile_id: row.profile_id,
            handle: row.handle,
            display_name: row.display_name,
            muted: row.muted,
            updated_seq: row.updated_seq,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct MemberMutePage {
    pub members: Vec<MemberMuteState>,
    pub next_cursor: Option<String>,
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
            quotations: post.quotations.into_iter().map(Quotation::from).collect(),
            citation_count: post.citation_count,
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

/// Player-facing investigation payload. Parity is a string label; every other
/// mode is a closed field bag matching the result-contract keys.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum InvestigationResultBody {
    Label(String),
    Fields(Box<InvestigationResultFields>),
}

impl Default for InvestigationResultBody {
    fn default() -> Self {
        Self::Fields(Box::default())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
pub struct InvestigationResultFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vanilla: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vanilla_town: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_gun: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub killer: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub specialist: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pt_access: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub visited: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub visitors: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub visitor_roles: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub action_types: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub motion: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prior_motion: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PlayerInvestigationResult {
    pub game: Uuid,
    pub phase_id: String,
    pub event_index: i32,
    pub audience_slot: String,
    pub mode: String,
    pub target_slot: String,
    pub result: InvestigationResultBody,
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

/// Closed JSON atom used by resolution-trace detail maps.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum JsonAtom {
    #[default]
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<JsonAtom>),
    Object(BTreeMap<String, JsonAtom>),
}

pub type ResolutionTraceDetail = BTreeMap<String, JsonAtom>;

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
    pub detail: ResolutionTraceDetail,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ResolutionTraceEdgeRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub from: String,
    pub to: String,
    pub kind: String,
    pub detail: ResolutionTraceDetail,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ResolutionTraceGeneratedRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub action_id: String,
    pub source: String,
    pub actor: String,
    pub targets: Vec<String>,
    pub detail: ResolutionTraceDetail,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ResolutionTraceEffectChangeRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub effect: String,
    pub target: String,
    pub operation: String,
    pub detail: ResolutionTraceDetail,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ResolutionTraceVisibilityRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub event_index: usize,
    pub audience: Vec<String>,
    pub policy: String,
    pub detail: ResolutionTraceDetail,
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
            detail: json_value(row.detail),
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
            detail: json_value(row.detail),
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
            detail: json_value(row.detail),
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
            detail: json_value(row.detail),
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
            detail: json_value(row.detail),
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
            result: json_value(row.result),
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
        DayEventId, DayEventResolutionMode, DayEventSchedule, DayEventState, DayEventTemplate,
        DayProgram, DurationSeconds, EffectOperationTemplate, EffectOrigin, EffectPlan,
        EffectVisibility, EventChannelMembership, EventChannelPolicy, GrantKind, GrantSpec,
        NarrativeLifecycle, NarrativeTemplate, NarrativeTemplates, OptionId, ParticipantFilter,
        ParticipationLimits, ParticipationMode, ParticipationPayload, ParticipationSpec, PhaseId,
        PhaseScope, PrincipalId, ProgramContentHash, ProgramId, ProgramTrigger, RecipientBindings,
        RecipientSelector, RewardAssignment, RewardBinding, RewardEffectTemplate, RewardKey,
        SlotId, SlotLifecycleEffect, Tag, TemplateKey, UnixSeconds,
    };
    use ts_rs::{Config, TS};

    use crate::{
        AckMsg, AdvanceSubscriptionReadRequest, CapabilityGrant, ClientEnvelope, ClientMsg,
        CohostPermissionClass, Command, CommandMsg, CommunityInboxItem, CommunityInboxPage,
        DayEventNarrativeDelta, DayEventRoomDelta, DayEventSchedulerDelta, DayVoteOutcomeDelta,
        DiscussionArea, DiscussionAuthor, DiscussionPost, DiscussionThreadPage, DiscussionTopic,
        DiscussionTopicPage, GameIndexEntry, GameIndexPage, Hello, HostConsoleAuthorityDelta,
        HostConsoleAuthorityKind, HostConsoleDayEventsDelta, HostConsoleHeaderDelta,
        HostConsolePhaseStateDelta, HostConsoleSchedulerDelta, HostConsoleSlotOccupancyDelta,
        HostConsoleSlotsDelta, HostConsoleStateDelta, HostConsoleTasksDelta,
        HostConsoleThreadPostDelta, HostConsoleThreadPostRemovedDelta, HostConsoleThreadPostsDelta,
        HostDayEventDelta, HostPhaseControl, HostPromptDecision, HostPromptDelta,
        HostPromptMetadata, HostPromptPublicResolution, HostPromptRecordedDecision,
        HostPromptsDelta, HostTaskAllowedCommand, HostTaskCommandKind, HostTaskDelta, HostTaskKind,
        HostTaskState, HostTaskUrgency, InvestigationResultBody, InvestigationResultFields,
        ItaSessionControlKind, JsonAtom, MemberMutePage, MemberMuteState, ModerationCase,
        ModerationCaseDetail, ModerationCasePage, ModerationHistory, ModerationReport,
        ModerationReportReceipt, PlayerInvestigationResult, PlayerNotification, PostCitation,
        PostCitationPage, PostCitationsChangedDelta, PostKind, PostRef, ProfileEditor,
        ProjectionDelta, PublicGameThreadPage, PublicProfile, PublicSearchPage, PublicSearchResult,
        Quotation, RejectCode, RejectMsg, ResolutionTraceDecisionRow, ResolutionTraceEdgeRow,
        ResolutionTraceEffectChangeRow, ResolutionTraceGeneratedRow,
        ResolutionTraceInspectionReport, ResolutionTraceInspectionRun, ResolutionTraceNoteRow,
        ResolutionTraceVisibilityRow, ServerEnvelope, ServerMsg, SlotLifecycle, SubmitPostMedia,
        SubscriptionTargetState, ThreadPage, ThreadPost, ThreadPostMedia, ThreadPostMediaVariant,
        ThreadPostsDelta, VoteCountClearedDelta, VoteCountDelta, VoteTarget,
    };

    const HEADER: &str = "// This file is @generated by wire::typescript::render.\n// Run `cargo run -p wire --bin export_types -- --write` to regenerate.\n\n";

    pub fn render() -> String {
        let mut out = String::from(HEADER);
        let config = Config::default();
        push::<DayEventId>(&mut out, &config);
        push::<ProgramId>(&mut out, &config);
        push::<ProgramContentHash>(&mut out, &config);
        push::<TemplateKey>(&mut out, &config);
        push::<RewardKey>(&mut out, &config);
        push::<SlotId>(&mut out, &config);
        push::<PhaseId>(&mut out, &config);
        push::<OptionId>(&mut out, &config);
        push::<Tag>(&mut out, &config);
        push::<ContentRef>(&mut out, &config);
        push::<ChannelId>(&mut out, &config);
        push::<PrincipalId>(&mut out, &config);
        push::<UnixSeconds>(&mut out, &config);
        push::<DurationSeconds>(&mut out, &config);
        push::<PhaseScope>(&mut out, &config);
        push::<ProgramTrigger>(&mut out, &config);
        push::<DayEventSchedule>(&mut out, &config);
        push::<DayEventState>(&mut out, &config);
        push::<DayEventResolutionMode>(&mut out, &config);
        push::<ParticipantFilter>(&mut out, &config);
        push::<ParticipationMode>(&mut out, &config);
        push::<ParticipationLimits>(&mut out, &config);
        push::<ParticipationSpec>(&mut out, &config);
        push::<ParticipationPayload>(&mut out, &config);
        push::<NarrativeTemplates>(&mut out, &config);
        push::<NarrativeLifecycle>(&mut out, &config);
        push::<NarrativeTemplate>(&mut out, &config);
        push::<EventChannelMembership>(&mut out, &config);
        push::<EventChannelPolicy>(&mut out, &config);
        push::<RecipientSelector>(&mut out, &config);
        push::<SlotLifecycleEffect>(&mut out, &config);
        push::<GrantKind>(&mut out, &config);
        push::<EffectVisibility>(&mut out, &config);
        push::<GrantSpec>(&mut out, &config);
        push::<EffectOperationTemplate>(&mut out, &config);
        push::<RewardEffectTemplate>(&mut out, &config);
        push::<RewardBinding>(&mut out, &config);
        push::<RecipientBindings>(&mut out, &config);
        push::<ConcreteEffect>(&mut out, &config);
        push::<EffectOrigin>(&mut out, &config);
        push::<EffectPlan>(&mut out, &config);
        push::<DayEvent>(&mut out, &config);
        push::<DayEventTemplate>(&mut out, &config);
        push::<DayProgram>(&mut out, &config);
        push::<RewardAssignment>(&mut out, &config);
        push::<DayEventDecision>(&mut out, &config);
        push::<DayEventEvent>(&mut out, &config);
        push::<VoteTarget>(&mut out, &config);
        push::<HostPromptDecision>(&mut out, &config);
        push::<HostPromptMetadata>(&mut out, &config);
        push::<HostPromptRecordedDecision>(&mut out, &config);
        push::<HostPromptPublicResolution>(&mut out, &config);
        push::<SlotLifecycle>(&mut out, &config);
        push::<ItaSessionControlKind>(&mut out, &config);
        push::<SubmitPostMedia>(&mut out, &config);
        push::<PostKind>(&mut out, &config);
        push::<PostRef>(&mut out, &config);
        push::<Quotation>(&mut out, &config);
        push::<PostCitation>(&mut out, &config);
        push::<PostCitationPage>(&mut out, &config);
        push::<CohostPermissionClass>(&mut out, &config);
        push::<Command>(&mut out, &config);
        push::<CommandMsg>(&mut out, &config);
        push::<ClientMsg>(&mut out, &config);
        push::<ClientEnvelope>(&mut out, &config);
        push::<AckMsg>(&mut out, &config);
        push::<RejectCode>(&mut out, &config);
        push::<RejectMsg>(&mut out, &config);
        push::<VoteCountDelta>(&mut out, &config);
        push::<VoteCountClearedDelta>(&mut out, &config);
        push::<ThreadPostsDelta>(&mut out, &config);
        push::<PostCitationsChangedDelta>(&mut out, &config);
        push::<DayVoteOutcomeDelta>(&mut out, &config);
        push::<HostConsoleAuthorityKind>(&mut out, &config);
        push::<HostConsoleAuthorityDelta>(&mut out, &config);
        push::<HostConsolePhaseStateDelta>(&mut out, &config);
        push::<HostConsoleSlotOccupancyDelta>(&mut out, &config);
        push::<HostConsoleSlotsDelta>(&mut out, &config);
        push::<HostConsoleThreadPostDelta>(&mut out, &config);
        push::<HostConsoleThreadPostsDelta>(&mut out, &config);
        push::<HostConsoleThreadPostRemovedDelta>(&mut out, &config);
        push::<HostConsoleHeaderDelta>(&mut out, &config);
        push::<HostConsoleSchedulerDelta>(&mut out, &config);
        push::<HostConsoleDayEventsDelta>(&mut out, &config);
        push::<HostConsoleTasksDelta>(&mut out, &config);
        push::<DayEventSchedulerDelta>(&mut out, &config);
        push::<DayEventRoomDelta>(&mut out, &config);
        push::<DayEventNarrativeDelta>(&mut out, &config);
        push::<HostDayEventDelta>(&mut out, &config);
        push::<HostTaskKind>(&mut out, &config);
        push::<HostTaskState>(&mut out, &config);
        push::<HostTaskUrgency>(&mut out, &config);
        push::<HostTaskCommandKind>(&mut out, &config);
        push::<HostTaskAllowedCommand>(&mut out, &config);
        push::<HostTaskDelta>(&mut out, &config);
        push::<HostConsoleStateDelta>(&mut out, &config);
        push::<HostPromptDelta>(&mut out, &config);
        push::<HostPromptsDelta>(&mut out, &config);
        push::<ThreadPost>(&mut out, &config);
        push::<ThreadPostMedia>(&mut out, &config);
        push::<ThreadPostMediaVariant>(&mut out, &config);
        push::<ThreadPage>(&mut out, &config);
        push::<GameIndexEntry>(&mut out, &config);
        push::<GameIndexPage>(&mut out, &config);
        push::<PublicGameThreadPage>(&mut out, &config);
        push::<PublicSearchResult>(&mut out, &config);
        push::<PublicSearchPage>(&mut out, &config);
        push::<DiscussionArea>(&mut out, &config);
        push::<DiscussionAuthor>(&mut out, &config);
        push::<DiscussionTopic>(&mut out, &config);
        push::<DiscussionTopicPage>(&mut out, &config);
        push::<DiscussionPost>(&mut out, &config);
        push::<DiscussionThreadPage>(&mut out, &config);
        push::<SubscriptionTargetState>(&mut out, &config);
        push::<AdvanceSubscriptionReadRequest>(&mut out, &config);
        push::<CommunityInboxItem>(&mut out, &config);
        push::<CommunityInboxPage>(&mut out, &config);
        push::<MemberMuteState>(&mut out, &config);
        push::<MemberMutePage>(&mut out, &config);
        push::<ModerationReportReceipt>(&mut out, &config);
        push::<ModerationCase>(&mut out, &config);
        push::<ModerationReport>(&mut out, &config);
        push::<ModerationHistory>(&mut out, &config);
        push::<ModerationCaseDetail>(&mut out, &config);
        push::<ModerationCasePage>(&mut out, &config);
        push::<PublicProfile>(&mut out, &config);
        push::<ProfileEditor>(&mut out, &config);
        push::<PlayerNotification>(&mut out, &config);
        push::<InvestigationResultFields>(&mut out, &config);
        push::<InvestigationResultBody>(&mut out, &config);
        push::<PlayerInvestigationResult>(&mut out, &config);
        push::<JsonAtom>(&mut out, &config);
        push::<HostPhaseControl>(&mut out, &config);
        push::<ResolutionTraceDecisionRow>(&mut out, &config);
        push::<ResolutionTraceEdgeRow>(&mut out, &config);
        push::<ResolutionTraceGeneratedRow>(&mut out, &config);
        push::<ResolutionTraceEffectChangeRow>(&mut out, &config);
        push::<ResolutionTraceVisibilityRow>(&mut out, &config);
        push::<ResolutionTraceNoteRow>(&mut out, &config);
        push::<ResolutionTraceInspectionRun>(&mut out, &config);
        push::<ResolutionTraceInspectionReport>(&mut out, &config);
        push::<ProjectionDelta>(&mut out, &config);
        push::<CapabilityGrant>(&mut out, &config);
        push::<Hello>(&mut out, &config);
        push::<ServerMsg>(&mut out, &config);
        push::<ServerEnvelope>(&mut out, &config);
        out.pop();
        out
    }

    fn push<T: TS>(out: &mut String, config: &Config) {
        let decl = T::decl(config);
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

#[cfg(test)]
mod host_console_patch_tests {
    use super::*;

    fn snapshot(game: Uuid) -> HostConsoleStateDelta {
        HostConsoleStateDelta {
            game,
            authority: HostConsoleAuthorityDelta {
                principal_user_id: "host".into(),
                capability: HostConsoleAuthorityKind::HostOf,
                allowed_classes: Vec::new(),
                denied_classes: Vec::new(),
            },
            completed: false,
            phase: Some(HostConsolePhaseStateDelta {
                phase_id: "D01".into(),
                locked: false,
                deadline: None,
            }),
            slots: vec![slot("slot-1", "alive", true)],
            thread_posts: vec![post(10, "hello")],
            day_event_scheduler: None,
            day_events: Vec::new(),
            tasks: Vec::new(),
        }
    }

    fn slot(slot_id: &str, status: &str, alive: bool) -> HostConsoleSlotOccupancyDelta {
        HostConsoleSlotOccupancyDelta {
            slot_id: slot_id.into(),
            occupancy_id: format!("{slot_id}-occ"),
            persona_id: format!("{slot_id}-persona"),
            public_name: slot_id.into(),
            assigned_principal_user_id: "player".into(),
            alive,
            status: status.into(),
            status_tags: Vec::new(),
            role_key: None,
            alignment: None,
            role_revealed: false,
            alignment_revealed: false,
        }
    }

    fn post(stream_seq: i64, body: &str) -> HostConsoleThreadPostDelta {
        HostConsoleThreadPostDelta {
            stream_seq,
            author_slot: Some("slot-1".into()),
            author_user: Some("player".into()),
            phase_id: "D01".into(),
            body: body.into(),
            quotations: Vec::new(),
        }
    }

    #[test]
    fn missing_previous_snapshot_is_the_full_hello_frame() {
        let game = Uuid::new_v4();
        let current = snapshot(game);
        assert_eq!(
            host_console_patches(None, &current),
            vec![ProjectionDelta::HostConsoleStateChanged(current)]
        );
    }

    #[test]
    fn unchanged_snapshot_emits_no_live_cells() {
        let current = snapshot(Uuid::new_v4());
        assert_eq!(host_console_patches(Some(&current), &current), Vec::new());
    }

    #[test]
    fn dirty_cells_are_the_only_live_frames() {
        let game = Uuid::new_v4();
        let previous = snapshot(game);
        let mut current = previous.clone();
        current.phase = Some(HostConsolePhaseStateDelta {
            phase_id: "D01".into(),
            locked: true,
            deadline: None,
        });
        current.slots = vec![slot("slot-1", "modkilled", false)];
        current.thread_posts = vec![post(11, "next")];
        current.completed = true;

        assert_eq!(
            host_console_patches(Some(&previous), &current),
            vec![
                ProjectionDelta::HostConsoleHeaderChanged(HostConsoleHeaderDelta {
                    game,
                    authority: current.authority.clone(),
                    completed: true,
                    phase: current.phase.clone(),
                }),
                ProjectionDelta::HostConsoleSlotsChanged(HostConsoleSlotsDelta {
                    game,
                    slots: vec![slot("slot-1", "modkilled", false)],
                    removed_slot_ids: Vec::new(),
                }),
                ProjectionDelta::HostConsoleThreadPostsChanged(HostConsoleThreadPostsDelta {
                    game,
                    posts: vec![post(11, "next")],
                }),
                ProjectionDelta::HostConsoleThreadPostRemoved(HostConsoleThreadPostRemovedDelta {
                    game,
                    stream_seq: 10,
                }),
            ]
        );
    }
}

#[cfg(test)]
mod live_json_map_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn day_vote_outcome_row_becomes_typed_maps() {
        let game = Uuid::new_v4();
        let delta = DayVoteOutcomeDelta::from(projections::DayVoteOutcomeRow {
            game_id: game,
            phase_id: "D01".into(),
            source_seq: 11,
            event_index: 0,
            status: "Lynch".into(),
            winner_slot: Some("slot-2".into()),
            contenders: json!(["slot-2", "slot-7"]),
            tallies: json!({ "slot-2": 4.0, "slot-7": 2.0 }),
            votes: json!({ "slot-1": "slot-2" }),
            weights: json!({ "slot-1": 1.0 }),
            majority: Some(3.0),
            thresholds: json!({ "slot-2": 3.0 }),
            total_weight: 6.0,
            tiebreak: None,
            reason: None,
        });
        assert_eq!(delta.contenders, vec!["slot-2", "slot-7"]);
        assert_eq!(delta.tallies.get("slot-2"), Some(&4.0));
        assert_eq!(
            delta.votes.get("slot-1").map(String::as_str),
            Some("slot-2")
        );
        assert_eq!(delta.weights.get("slot-1"), Some(&1.0));
        assert_eq!(delta.thresholds.get("slot-2"), Some(&3.0));
    }

    #[test]
    fn host_prompt_row_becomes_typed_decision_and_resolution() {
        let game = Uuid::new_v4();
        let delta = HostPromptDelta::from(projections::HostPromptRow {
            game_id: game,
            phase_id: "D01".into(),
            event_index: 0,
            prompt_id: "D01:pk:Tie".into(),
            kind: "pk".into(),
            subject_slot: None,
            reason: "host_decides_tie".into(),
            phase_kind: "Day".into(),
            phase_number: 1,
            metadata: json!({
                "policy": "pk_host_decides_tie",
                "status": "Tie",
                "contenders": ["slot-2", "slot-4"],
                "tiebreak": "HostDecides"
            }),
            status: "resolved".into(),
            decision: Some(json!({ "kind": "select_slot", "slot": "slot-2" })),
            public_resolution: Some(json!({
                "kind": "day_vote_elimination",
                "phase_id": "D01",
                "selected_slot": "slot-2",
                "reason": "host_decides_tie"
            })),
            resolved_by: Some("host".into()),
            resolved_at: Some(44),
        });
        assert_eq!(
            delta.metadata.contenders,
            vec!["slot-2".to_string(), "slot-4".to_string()]
        );
        assert_eq!(
            delta.metadata.policy.as_deref(),
            Some("pk_host_decides_tie")
        );
        assert_eq!(
            delta.decision,
            Some(HostPromptRecordedDecision::SelectSlot {
                slot: "slot-2".into()
            })
        );
        assert_eq!(
            delta.public_resolution,
            Some(HostPromptPublicResolution::DayVoteElimination {
                phase_id: "D01".into(),
                selected_slot: "slot-2".into(),
                reason: "host_decides_tie".into(),
            })
        );
    }

    #[test]
    fn investigation_result_row_becomes_typed_label_or_fields() {
        let game = Uuid::new_v4();
        let label = PlayerInvestigationResult::from(projections::PlayerInvestigationResultRow {
            game_id: game,
            phase_id: "N01".into(),
            event_index: 0,
            audience_slot: "slot-1".into(),
            mode: "Parity".into(),
            target_slot: "slot-2".into(),
            result: json!("town"),
        });
        assert_eq!(label.result, InvestigationResultBody::Label("town".into()));

        let fields = PlayerInvestigationResult::from(projections::PlayerInvestigationResultRow {
            game_id: game,
            phase_id: "N01".into(),
            event_index: 1,
            audience_slot: "slot-1".into(),
            mode: "Track".into(),
            target_slot: "slot-3".into(),
            result: json!({ "visited": ["slot-4"] }),
        });
        match fields.result {
            InvestigationResultBody::Fields(body) => {
                assert_eq!(body.visited, vec!["slot-4".to_string()]);
            }
            other => panic!("expected fields, got {other:?}"),
        }
    }

    #[test]
    fn resolution_trace_detail_becomes_a_typed_atom_map() {
        let row = ResolutionTraceDecisionRow::from(commands::ResolutionTraceDecisionRow {
            row_index: 0,
            applied_stream_seq: Some(12),
            event_index: Some(3),
            stage: "result_contract".into(),
            source: "domain::resolve/result_version:19".into(),
            outcome: "2 inner events validated".into(),
            detail: json!({ "kills": 1, "saves": 0 }),
        });
        assert_eq!(row.detail.get("kills"), Some(&JsonAtom::Number(1.0)));
        assert_eq!(row.detail.get("saves"), Some(&JsonAtom::Number(0.0)));
        let empty = ResolutionTraceDecisionRow::from(commands::ResolutionTraceDecisionRow {
            row_index: 1,
            applied_stream_seq: None,
            event_index: None,
            stage: "inner_event".into(),
            source: "event_index:0".into(),
            outcome: "phase_announcement".into(),
            detail: json!(null),
        });
        assert!(empty.detail.is_empty());
    }
}
