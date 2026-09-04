//! `wire` — versioned transport types crossing the Rust/client boundary.
//!
//! Wire types are deliberately separate from domain and storage types. They are
//! the stable transport contract; server internals may evolve behind them.

use domain::phase::PhaseId;
use principal::PrincipalId;
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
        let principal_id = $crate::fixture_principal_id($user);
        let public_name = format!("Player {slot}");
        $crate::Command::SeatPersona {
            game: $game,
            public_name,
            principal_id,
            slot,
        }
    }};
}

/// Deterministic UUID-backed fixture authority for transport tests and proofs.
#[doc(hidden)]
pub fn fixture_principal_id(label: impl AsRef<str>) -> PrincipalId {
    commands::fixture_principal_id(label)
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
        principal_id: PrincipalId,
        public_name: String,
    },
    RenameGamePersona {
        game: Uuid,
        persona_id: Uuid,
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
        principal_id: PrincipalId,
    },
    GrantSpectator {
        game: Uuid,
        principal_id: PrincipalId,
    },
    RevokeSpectator {
        game: Uuid,
        principal_id: PrincipalId,
    },
    StartGame {
        game: Uuid,
        phase: PhaseId,
    },
    OpenDayPhase {
        game: Uuid,
        phase: PhaseId,
    },
    AdvancePhase {
        game: Uuid,
    },
    AdvancePhaseByDeadline {
        game: Uuid,
        phase: PhaseId,
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
        #[serde(default)]
        #[ts(optional)]
        mentions: Option<Vec<SubmitPostMention>>,
        #[serde(default)]
        #[ts(optional)]
        embed: Option<SubmitPostEmbed>,
    },
    ExtendDeadline {
        game: Uuid,
        phase: PhaseId,
        at: i64,
    },
    ProcessReplacement {
        game: Uuid,
        slot: String,
        outgoing_persona_id: Uuid,
        incoming_principal_id: PrincipalId,
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
                principal_id,
                public_name,
            } => commands::Command::SeatPersona {
                game,
                slot,
                principal_id,
                public_name,
            },
            Command::RenameGamePersona {
                game,
                persona_id,
                public_name,
            } => commands::Command::RenameGamePersona {
                game,
                persona_id: persona_id.into(),
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
            Command::AddCohost { game, principal_id } => {
                commands::Command::AddCohost { game, principal_id }
            }
            Command::GrantSpectator { game, principal_id } => {
                commands::Command::GrantSpectator { game, principal_id }
            }
            Command::RevokeSpectator { game, principal_id } => {
                commands::Command::RevokeSpectator { game, principal_id }
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
                mentions,
                embed,
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
                mentions: mentions
                    .unwrap_or_default()
                    .into_iter()
                    .map(SubmitPostMention::into)
                    .collect(),
                embed_url: embed
                    .map(|embed| embed.url)
                    .filter(|url| !url.trim().is_empty()),
                embed_snapshot: None,
            },
            Command::ExtendDeadline { game, phase, at } => {
                commands::Command::ExtendDeadline { game, phase, at }
            }
            Command::ProcessReplacement {
                game,
                slot,
                outgoing_persona_id,
                incoming_principal_id,
            } => commands::Command::ProcessReplacement {
                game,
                slot,
                outgoing_persona_id: outgoing_persona_id.into(),
                incoming_principal_id,
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
    InvalidArgument,
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
    pub phase_id: PhaseId,
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
    pub phase_id: PhaseId,
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
    pub phase_id: PhaseId,
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
    pub phase_id: Option<PhaseId>,
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
    pub principal_id: PrincipalId,
    pub capability: HostConsoleAuthorityKind,
    pub allowed_classes: Vec<CohostPermissionClass>,
    pub denied_classes: Vec<CohostPermissionClass>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HostConsolePhaseStateDelta {
    pub phase_id: PhaseId,
    pub locked: bool,
    pub deadline: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct HostConsoleSlotOccupancyDelta {
    pub slot_id: String,
    pub occupancy_id: String,
    pub persona_id: String,
    pub public_name: String,
    pub assigned_principal_id: PrincipalId,
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
    pub author: GameThreadAuthor,
    pub phase_id: Option<PhaseId>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub phase_id: Option<PhaseId>,
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
        phase_id: PhaseId,
        selected_slot: String,
        reason: String,
    },
    PhaseAdvance {
        source_phase_id: PhaseId,
        target_phase_id: PhaseId,
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        skipped_phase_id: Option<PhaseId>,
    },
    Acknowledged {
        phase_id: PhaseId,
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HostPromptDelta {
    pub game: Uuid,
    pub phase_id: PhaseId,
    pub event_index: i32,
    pub prompt_id: String,
    pub kind: String,
    pub subject_slot: Option<String>,
    pub reason: String,
    pub metadata: HostPromptMetadata,
    pub status: String,
    pub decision: Option<HostPromptRecordedDecision>,
    pub public_resolution: Option<HostPromptPublicResolution>,
    pub resolved_at: Option<i64>,
}

/// Fail-closed decode of a projection or inspection JSON column into a wire type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectionAdapterError {
    pub kind: &'static str,
    pub field: &'static str,
    pub source: String,
}

impl std::fmt::Display for ProjectionAdapterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "projection adapter failed to decode {} field `{}`: {}",
            self.kind, self.field, self.source
        )
    }
}

impl std::error::Error for ProjectionAdapterError {}

fn decode_field<T: serde::de::DeserializeOwned>(
    kind: &'static str,
    field: &'static str,
    value: serde_json::Value,
) -> Result<T, ProjectionAdapterError> {
    serde_json::from_value(value).map_err(|source| ProjectionAdapterError {
        kind,
        field,
        source: source.to_string(),
    })
}

fn decode_opt_field<T: serde::de::DeserializeOwned>(
    kind: &'static str,
    field: &'static str,
    value: Option<serde_json::Value>,
) -> Result<Option<T>, ProjectionAdapterError> {
    match value {
        None => Ok(None),
        Some(value) => Ok(Some(decode_field(kind, field, value)?)),
    }
}

impl TryFrom<projections::HostPromptRow> for HostPromptDelta {
    type Error = ProjectionAdapterError;

    fn try_from(row: projections::HostPromptRow) -> Result<Self, Self::Error> {
        const KIND: &str = "HostPrompt";
        Ok(HostPromptDelta {
            game: row.game_id,
            phase_id: row.phase_id,
            event_index: row.event_index,
            prompt_id: row.prompt_id,
            kind: row.kind,
            subject_slot: row.subject_slot,
            reason: row.reason,
            metadata: decode_field(KIND, "metadata", row.metadata)?,
            status: row.status,
            decision: decode_opt_field(KIND, "decision", row.decision)?,
            public_resolution: decode_opt_field(KIND, "public_resolution", row.public_resolution)?,
            resolved_at: row.resolved_at,
        })
    }
}

impl TryFrom<projections::DayVoteOutcomeRow> for DayVoteOutcomeDelta {
    type Error = ProjectionAdapterError;

    fn try_from(row: projections::DayVoteOutcomeRow) -> Result<Self, Self::Error> {
        const KIND: &str = "DayVoteOutcome";
        Ok(DayVoteOutcomeDelta {
            game: row.game_id,
            phase_id: row.phase_id,
            source_seq: row.source_seq,
            event_index: row.event_index,
            status: row.status,
            winner_slot: row.winner_slot,
            contenders: decode_field(KIND, "contenders", row.contenders)?,
            tallies: decode_field(KIND, "tallies", row.tallies)?,
            votes: decode_field(KIND, "votes", row.votes)?,
            weights: decode_field(KIND, "weights", row.weights)?,
            majority: row.majority,
            thresholds: decode_field(KIND, "thresholds", row.thresholds)?,
            total_weight: row.total_weight,
            tiebreak: row.tiebreak,
            reason: row.reason,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GameThreadAuthor {
    Slot { slot_id: String },
    HostNarrator,
    System,
}

impl From<projections::GameThreadAuthor> for GameThreadAuthor {
    fn from(author: projections::GameThreadAuthor) -> Self {
        match author {
            projections::GameThreadAuthor::Slot { slot_id } => Self::Slot { slot_id },
            projections::GameThreadAuthor::HostNarrator => Self::HostNarrator,
            projections::GameThreadAuthor::System => Self::System,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ThreadPost {
    pub game: Uuid,
    pub source_seq: i64,
    pub stream_seq: i64,
    pub channel_id: String,
    pub author: GameThreadAuthor,
    pub phase_id: Option<PhaseId>,
    pub body: String,
    pub media: Vec<ThreadPostMedia>,
    #[serde(default)]
    pub quotations: Vec<Quotation>,
    #[serde(default)]
    pub mentions: Vec<ThreadPostMention>,
    #[serde(default)]
    #[ts(optional)]
    pub embed: Option<PostEmbed>,
    #[serde(default)]
    pub citation_count: i64,
    pub occurred_at: i64,
}

/// One decided game mention over a byte span of the post it annotates. It names
/// the seat and nothing else: the reader's own roster supplies the label, so no
/// persona, profile, or principal crosses this boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ThreadPostMention {
    pub slot_id: String,
    pub offset: i64,
    pub len: i64,
}

impl From<content_reference::SlotMention> for ThreadPostMention {
    fn from(value: content_reference::SlotMention) -> Self {
        ThreadPostMention {
            slot_id: value.slot_id,
            offset: value.span.offset as i64,
            len: value.span.len as i64,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SubmitPostMedia {
    pub content_id: String,
    pub alt: String,
}

/// A slot address the game composer claimed, over a byte span of the body it
/// is submitting. The client sends `slot_id` because a game thread addresses a
/// seat; there is deliberately no shape here that could carry a profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SubmitPostMention {
    pub slot_id: String,
    pub offset: i64,
    pub len: i64,
}

impl From<SubmitPostMention> for content_reference::SlotMentionCandidate {
    fn from(value: SubmitPostMention) -> Self {
        content_reference::SlotMentionCandidate {
            slot_id: value.slot_id,
            offset: value.offset.max(0) as usize,
            len: value.len.max(0) as usize,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SubmitPostEmbed {
    pub url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum EmbedProvider {
    Youtube,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PostEmbed {
    pub provider: EmbedProvider,
    pub provider_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub start_seconds: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub snapshot: Option<EmbedSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct EmbedSnapshot {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub poster: Option<EmbedPoster>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct EmbedPoster {
    pub content_id: String,
}

impl From<game_platform::embed::PostEmbed> for PostEmbed {
    fn from(value: game_platform::embed::PostEmbed) -> Self {
        PostEmbed {
            provider: EmbedProvider::Youtube,
            provider_id: value.provider_id,
            start_seconds: value.start_seconds,
            snapshot: value.snapshot.map(EmbedSnapshot::from),
        }
    }
}

impl From<game_platform::embed::EmbedSnapshot> for EmbedSnapshot {
    fn from(value: game_platform::embed::EmbedSnapshot) -> Self {
        EmbedSnapshot {
            title: value.title,
            author: value.author,
            poster: value.poster.map(|poster| EmbedPoster {
                content_id: poster.content_id,
            }),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PostKind {
    DiscussionPost,
    GamePost,
}

impl From<PostKind> for content_reference::PostKind {
    fn from(kind: PostKind) -> Self {
        match kind {
            PostKind::DiscussionPost => content_reference::PostKind::DiscussionPost,
            PostKind::GamePost => content_reference::PostKind::GamePost,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PostRef {
    pub kind: PostKind,
    pub scope_id: Uuid,
    pub source_seq: i64,
}

impl From<PostRef> for content_reference::PostRef {
    fn from(value: PostRef) -> Self {
        content_reference::PostRef {
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

impl From<Quotation> for content_reference::Quotation {
    fn from(value: Quotation) -> Self {
        content_reference::Quotation {
            target: value.target.into(),
            excerpt: value.excerpt,
        }
    }
}

impl From<content_reference::PostKind> for PostKind {
    fn from(kind: content_reference::PostKind) -> Self {
        match kind {
            content_reference::PostKind::DiscussionPost => PostKind::DiscussionPost,
            content_reference::PostKind::GamePost => PostKind::GamePost,
        }
    }
}

impl From<content_reference::PostRef> for PostRef {
    fn from(value: content_reference::PostRef) -> Self {
        PostRef {
            kind: value.kind.into(),
            scope_id: value.scope_id,
            source_seq: value.source_seq,
        }
    }
}

impl From<content_reference::Quotation> for Quotation {
    fn from(value: content_reference::Quotation) -> Self {
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PublicPostCitation {
    pub quoting_surface_id: Uuid,
    pub quoting_source_seq: i64,
    pub occurred_at: i64,
}

impl From<projections::PublicCitationRow> for PublicPostCitation {
    fn from(row: projections::PublicCitationRow) -> Self {
        Self {
            quoting_surface_id: row.quoting.surface_id,
            quoting_source_seq: row.quoting.source_seq,
            occurred_at: row.occurred_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PublicPostCitationPage {
    pub quoted_surface_id: Uuid,
    pub quoted_source_seq: i64,
    pub citations: Vec<PublicPostCitation>,
    pub citation_count: i64,
}

impl From<projections::PublicCitationPage> for PublicPostCitationPage {
    fn from(page: projections::PublicCitationPage) -> Self {
        Self {
            quoted_surface_id: page.quoted.surface_id,
            quoted_source_seq: page.quoted.source_seq,
            citations: page
                .citations
                .into_iter()
                .map(PublicPostCitation::from)
                .collect(),
            citation_count: page.citation_count,
        }
    }
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
            author: row.author.into(),
            phase_id: row.phase_id,
            body: row.body,
            media,
            quotations: row.quotations.into_iter().map(Quotation::from).collect(),
            mentions: row
                .mentions
                .into_iter()
                .map(ThreadPostMention::from)
                .collect(),
            embed: row.embed.map(PostEmbed::from),
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
    pub phase_id: Option<PhaseId>,
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
#[serde(rename_all = "snake_case")]
pub enum PublicSearchResultKind {
    Discussion,
    DiscussionPost,
    Profile,
    Game,
    GamePost,
}

impl From<projections::PublicSearchDocumentType> for PublicSearchResultKind {
    fn from(value: projections::PublicSearchDocumentType) -> Self {
        match value {
            projections::PublicSearchDocumentType::Discussion => Self::Discussion,
            projections::PublicSearchDocumentType::DiscussionPost => Self::DiscussionPost,
            projections::PublicSearchDocumentType::Profile => Self::Profile,
            projections::PublicSearchDocumentType::Game => Self::Game,
            projections::PublicSearchDocumentType::GamePost => Self::GamePost,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum PublicSearchFilterValue {
    All,
    Discussions,
    Profiles,
    Games,
}

impl PublicSearchFilterValue {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Discussions => "discussions",
            Self::Profiles => "profiles",
            Self::Games => "games",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PublicSearchExcerptSegment {
    pub text: String,
    pub highlighted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PublicSearchResult {
    pub kind: PublicSearchResultKind,
    pub title: String,
    pub excerpt: Vec<PublicSearchExcerptSegment>,
    pub href: String,
    pub published_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PublicSearchPage {
    pub query: String,
    pub filter: PublicSearchFilterValue,
    pub results: Vec<PublicSearchResult>,
    pub next_cursor: Option<String>,
}

impl From<projections::PublicSearchRow> for PublicSearchResult {
    fn from(row: projections::PublicSearchRow) -> Self {
        PublicSearchResult {
            kind: row.kind.into(),
            title: row.title,
            excerpt: row
                .excerpt
                .into_iter()
                .map(|segment| PublicSearchExcerptSegment {
                    text: segment.text,
                    highlighted: segment.highlighted,
                })
                .collect(),
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

/// Bounded typeahead answer for the composer. The entries are exactly the
/// currently public profiles a mention may address, so an empty list is the
/// only thing an unknown, private, or redacted handle can produce.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct MentionSuggestionPage {
    pub suggestions: Vec<DiscussionAuthor>,
}

/// One decided community mention over a byte span of the post it annotates.
/// `profile` is `None` when the target is no longer publicly resolvable, which
/// the renderer shows as plain text: the span survives, the anchor does not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DiscussionPostMention {
    pub profile: Option<DiscussionAuthor>,
    pub offset: i64,
    pub len: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DiscussionPost {
    pub source_seq: i64,
    pub author: Option<DiscussionAuthor>,
    pub body: String,
    #[serde(default)]
    pub quotations: Vec<Quotation>,
    #[serde(default)]
    pub mentions: Vec<DiscussionPostMention>,
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
    pub surface_id: Uuid,
    pub subscribed: bool,
    pub read_through_seq: i64,
    pub latest_source_seq: i64,
    pub unread_count: i64,
}

impl From<projections::SubscriptionTargetStateRow> for SubscriptionTargetState {
    fn from(row: projections::SubscriptionTargetStateRow) -> Self {
        Self {
            surface_id: row.surface_id,
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

/// "Mark all read" for the member inbox. The client sends the highest sequence
/// it was actually shown, so the principal cursor never claims to have read
/// past the page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AdvanceInboxReadRequest {
    pub read_through_seq: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PublicInboxItem {
    pub surface_id: Uuid,
    pub source_seq: i64,
    pub title: String,
    pub href: String,
    /// `watch` | `mention`. One list, one badge, rows labelled by reason.
    pub reason: String,
    pub occurred_at: i64,
    pub unread: bool,
    pub subscribed: bool,
}

impl From<projections::PublicInboxItemRow> for PublicInboxItem {
    fn from(row: projections::PublicInboxItemRow) -> Self {
        Self {
            surface_id: row.surface_id,
            source_seq: row.source_seq,
            title: row.title,
            href: row.href,
            reason: row.reason,
            occurred_at: row.occurred_at,
            unread: row.unread,
            subscribed: row.subscribed,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PublicInboxPage {
    pub items: Vec<PublicInboxItem>,
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

impl From<projections::PublicInboxPage> for PublicInboxPage {
    fn from(page: projections::PublicInboxPage) -> Self {
        Self {
            items: page.items.into_iter().map(PublicInboxItem::from).collect(),
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
            mentions: post
                .mentions
                .into_iter()
                .map(DiscussionPostMention::from)
                .collect(),
            citation_count: post.citation_count,
            created_at: post.created_at,
        }
    }
}

impl From<projections::DiscussionPostMentionRow> for DiscussionPostMention {
    fn from(mention: projections::DiscussionPostMentionRow) -> Self {
        DiscussionPostMention {
            profile: mention.profile.map(DiscussionAuthor::from),
            offset: mention.offset,
            len: mention.len,
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
    pub surface_id: Uuid,
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
            surface_id: row.surface_id,
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
    pub reporter_principal_id: PrincipalId,
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
    pub actor_principal_id: PrincipalId,
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
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ProfileEditor {
    pub handle: String,
    pub display_name: String,
    pub bio: String,
    pub visibility: String,
    pub revision: i64,
}

impl From<projections::PublicProfileRow> for PublicProfile {
    fn from(profile: projections::PublicProfileRow) -> Self {
        PublicProfile {
            handle: profile.handle,
            display_name: profile.display_name,
            bio: profile.bio,
            revision: profile.revision,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PlayerNotification {
    pub game: Uuid,
    pub phase_id: PhaseId,
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
    pub phase_id: PhaseId,
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
    pub source_phase_id: PhaseId,
    pub target_phase_id: PhaseId,
    pub reason: String,
    pub skipped_phase_id: Option<PhaseId>,
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
    pub phase_id: PhaseId,
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

impl TryFrom<commands::ResolutionTraceInspectionReport> for ResolutionTraceInspectionReport {
    type Error = ProjectionAdapterError;

    fn try_from(report: commands::ResolutionTraceInspectionReport) -> Result<Self, Self::Error> {
        Ok(ResolutionTraceInspectionReport {
            game: report.game_id,
            traces: report
                .traces
                .into_iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
        })
    }
}

impl TryFrom<commands::ResolutionTraceInspectionRun> for ResolutionTraceInspectionRun {
    type Error = ProjectionAdapterError;

    fn try_from(run: commands::ResolutionTraceInspectionRun) -> Result<Self, Self::Error> {
        Ok(ResolutionTraceInspectionRun {
            phase_id: run.phase_id,
            run_id: run.run_id,
            applied_stream_seq: run.applied_stream_seq,
            trace_stream_seq: run.trace_stream_seq,
            trace_version: run.trace_version,
            decisions: run
                .decisions
                .into_iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
            edges: run
                .edges
                .into_iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
            generated: run
                .generated
                .into_iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
            effect_changes: run
                .effect_changes
                .into_iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
            visibility: run
                .visibility
                .into_iter()
                .map(TryInto::try_into)
                .collect::<Result<_, _>>()?,
            notes: run.notes.into_iter().map(Into::into).collect(),
        })
    }
}

impl TryFrom<commands::ResolutionTraceDecisionRow> for ResolutionTraceDecisionRow {
    type Error = ProjectionAdapterError;

    fn try_from(row: commands::ResolutionTraceDecisionRow) -> Result<Self, Self::Error> {
        Ok(ResolutionTraceDecisionRow {
            row_index: row.row_index,
            applied_stream_seq: row.applied_stream_seq,
            event_index: row.event_index,
            stage: row.stage,
            source: row.source,
            outcome: row.outcome,
            detail: decode_field("ResolutionTraceDecision", "detail", row.detail)?,
        })
    }
}

impl TryFrom<commands::ResolutionTraceEdgeRow> for ResolutionTraceEdgeRow {
    type Error = ProjectionAdapterError;

    fn try_from(row: commands::ResolutionTraceEdgeRow) -> Result<Self, Self::Error> {
        Ok(ResolutionTraceEdgeRow {
            row_index: row.row_index,
            applied_stream_seq: row.applied_stream_seq,
            from: row.from,
            to: row.to,
            kind: row.kind,
            detail: decode_field("ResolutionTraceEdge", "detail", row.detail)?,
        })
    }
}

impl TryFrom<commands::ResolutionTraceGeneratedRow> for ResolutionTraceGeneratedRow {
    type Error = ProjectionAdapterError;

    fn try_from(row: commands::ResolutionTraceGeneratedRow) -> Result<Self, Self::Error> {
        Ok(ResolutionTraceGeneratedRow {
            row_index: row.row_index,
            applied_stream_seq: row.applied_stream_seq,
            action_id: row.action_id,
            source: row.source,
            actor: row.actor,
            targets: row.targets,
            detail: decode_field("ResolutionTraceGenerated", "detail", row.detail)?,
        })
    }
}

impl TryFrom<commands::ResolutionTraceEffectChangeRow> for ResolutionTraceEffectChangeRow {
    type Error = ProjectionAdapterError;

    fn try_from(row: commands::ResolutionTraceEffectChangeRow) -> Result<Self, Self::Error> {
        Ok(ResolutionTraceEffectChangeRow {
            row_index: row.row_index,
            applied_stream_seq: row.applied_stream_seq,
            effect: row.effect,
            target: row.target,
            operation: row.operation,
            detail: decode_field("ResolutionTraceEffectChange", "detail", row.detail)?,
        })
    }
}

impl TryFrom<commands::ResolutionTraceVisibilityRow> for ResolutionTraceVisibilityRow {
    type Error = ProjectionAdapterError;

    fn try_from(row: commands::ResolutionTraceVisibilityRow) -> Result<Self, Self::Error> {
        Ok(ResolutionTraceVisibilityRow {
            row_index: row.row_index,
            applied_stream_seq: row.applied_stream_seq,
            event_index: row.event_index,
            audience: row.audience,
            policy: row.policy,
            detail: decode_field("ResolutionTraceVisibility", "detail", row.detail)?,
        })
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

impl TryFrom<projections::PlayerInvestigationResultRow> for PlayerInvestigationResult {
    type Error = ProjectionAdapterError;

    fn try_from(row: projections::PlayerInvestigationResultRow) -> Result<Self, Self::Error> {
        Ok(PlayerInvestigationResult {
            game: row.game_id,
            phase_id: row.phase_id,
            event_index: row.event_index,
            audience_slot: row.audience_slot,
            mode: row.mode,
            target_slot: row.target_slot,
            result: decode_field("PlayerInvestigationResult", "result", row.result)?,
        })
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
    use domain::phase::PhaseId;
    use game_platform::{
        ChannelId, ConcreteEffect, ContentRef, DayEvent, DayEventDecision, DayEventEvent,
        DayEventId, DayEventResolutionMode, DayEventSchedule, DayEventState, DayEventTemplate,
        DayProgram, DurationSeconds, EffectOperationTemplate, EffectOrigin, EffectPlan,
        EffectVisibility, EventChannelMembership, EventChannelPolicy, GrantKind, GrantSpec,
        NarrativeLifecycle, NarrativeTemplate, NarrativeTemplates, OptionId, ParticipantFilter,
        ParticipationLimits, ParticipationMode, ParticipationPayload, ParticipationSpec,
        PhaseScope, PrincipalId, ProgramContentHash, ProgramId, ProgramTrigger, RecipientBindings,
        RecipientSelector, RewardAssignment, RewardBinding, RewardEffectTemplate, RewardKey,
        SlotId, SlotLifecycleEffect, Tag, TemplateKey, UnixSeconds,
    };
    use ts_rs::{Config, TS};

    use crate::{
        AckMsg, AdvanceInboxReadRequest, AdvanceSubscriptionReadRequest, CapabilityGrant,
        ClientEnvelope, ClientMsg, CohostPermissionClass, Command, CommandMsg,
        DayEventNarrativeDelta, DayEventRoomDelta, DayEventSchedulerDelta, DayVoteOutcomeDelta,
        DiscussionArea, DiscussionAuthor, DiscussionPost, DiscussionPostMention,
        DiscussionThreadPage, DiscussionTopic, DiscussionTopicPage, EmbedPoster, EmbedProvider,
        EmbedSnapshot, GameIndexEntry, GameIndexPage, GameThreadAuthor, Hello,
        HostConsoleAuthorityDelta, HostConsoleAuthorityKind, HostConsoleDayEventsDelta,
        HostConsoleHeaderDelta, HostConsolePhaseStateDelta, HostConsoleSchedulerDelta,
        HostConsoleSlotOccupancyDelta, HostConsoleSlotsDelta, HostConsoleStateDelta,
        HostConsoleTasksDelta, HostConsoleThreadPostDelta, HostConsoleThreadPostRemovedDelta,
        HostConsoleThreadPostsDelta, HostDayEventDelta, HostPhaseControl, HostPromptDecision,
        HostPromptDelta, HostPromptMetadata, HostPromptPublicResolution,
        HostPromptRecordedDecision, HostPromptsDelta, HostTaskAllowedCommand, HostTaskCommandKind,
        HostTaskDelta, HostTaskKind, HostTaskState, HostTaskUrgency, InvestigationResultBody,
        InvestigationResultFields, ItaSessionControlKind, JsonAtom, MemberMutePage,
        MemberMuteState, MentionSuggestionPage, ModerationCase, ModerationCaseDetail,
        ModerationCasePage, ModerationHistory, ModerationReport, ModerationReportReceipt,
        PlayerInvestigationResult, PlayerNotification, PostCitation, PostCitationPage,
        PostCitationsChangedDelta, PostEmbed, PostKind, PostRef, ProfileEditor, ProjectionDelta,
        PublicGameThreadPage, PublicInboxItem, PublicInboxPage, PublicPostCitation,
        PublicPostCitationPage, PublicProfile, PublicSearchExcerptSegment, PublicSearchFilterValue,
        PublicSearchPage, PublicSearchResult, PublicSearchResultKind, Quotation, RejectCode,
        RejectMsg, ResolutionTraceDecisionRow, ResolutionTraceEdgeRow,
        ResolutionTraceEffectChangeRow, ResolutionTraceGeneratedRow,
        ResolutionTraceInspectionReport, ResolutionTraceInspectionRun, ResolutionTraceNoteRow,
        ResolutionTraceVisibilityRow, ServerEnvelope, ServerMsg, SlotLifecycle, SubmitPostEmbed,
        SubmitPostMedia, SubmitPostMention, SubscriptionTargetState, ThreadPage, ThreadPost,
        ThreadPostMedia, ThreadPostMediaVariant, ThreadPostMention, ThreadPostsDelta,
        VoteCountClearedDelta, VoteCountDelta, VoteTarget,
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
        push::<SubmitPostMention>(&mut out, &config);
        push::<SubmitPostEmbed>(&mut out, &config);
        push::<EmbedProvider>(&mut out, &config);
        push::<EmbedPoster>(&mut out, &config);
        push::<EmbedSnapshot>(&mut out, &config);
        push::<PostEmbed>(&mut out, &config);
        push::<PostKind>(&mut out, &config);
        push::<PostRef>(&mut out, &config);
        push::<Quotation>(&mut out, &config);
        push::<PostCitation>(&mut out, &config);
        push::<PostCitationPage>(&mut out, &config);
        push::<PublicPostCitation>(&mut out, &config);
        push::<PublicPostCitationPage>(&mut out, &config);
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
        push::<GameThreadAuthor>(&mut out, &config);
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
        push::<ThreadPostMention>(&mut out, &config);
        push::<ThreadPost>(&mut out, &config);
        push::<ThreadPostMedia>(&mut out, &config);
        push::<ThreadPostMediaVariant>(&mut out, &config);
        push::<ThreadPage>(&mut out, &config);
        push::<GameIndexEntry>(&mut out, &config);
        push::<GameIndexPage>(&mut out, &config);
        push::<PublicGameThreadPage>(&mut out, &config);
        push::<PublicSearchExcerptSegment>(&mut out, &config);
        push::<PublicSearchResultKind>(&mut out, &config);
        push::<PublicSearchFilterValue>(&mut out, &config);
        push::<PublicSearchResult>(&mut out, &config);
        push::<PublicSearchPage>(&mut out, &config);
        push::<DiscussionArea>(&mut out, &config);
        push::<DiscussionAuthor>(&mut out, &config);
        push::<DiscussionTopic>(&mut out, &config);
        push::<DiscussionTopicPage>(&mut out, &config);
        push::<MentionSuggestionPage>(&mut out, &config);
        push::<DiscussionPostMention>(&mut out, &config);
        push::<DiscussionPost>(&mut out, &config);
        push::<DiscussionThreadPage>(&mut out, &config);
        push::<SubscriptionTargetState>(&mut out, &config);
        push::<AdvanceSubscriptionReadRequest>(&mut out, &config);
        push::<AdvanceInboxReadRequest>(&mut out, &config);
        push::<PublicInboxItem>(&mut out, &config);
        push::<PublicInboxPage>(&mut out, &config);
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
mod phase_id_ingress_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lifecycle_commands_deserialize_only_canonical_phase_ids_and_preserve_them_to_commands() {
        let game = Uuid::nil();
        let command: Command = serde_json::from_value(json!({
            "StartGame": { "game": game, "phase": "D01" }
        }))
        .expect("canonical phase id crosses the wire");

        match command.into_dispatch() {
            CommandDispatch::Direct(commands::Command::StartGame { phase, .. }) => {
                assert_eq!(phase.as_str(), "D01");
            }
            other => panic!("unexpected dispatch: {other:?}"),
        }

        for invalid in ["D00", "D3", "D003", "D01junk", "D01R0", "D01R02"] {
            let raw = json!({
                "StartGame": { "game": game, "phase": invalid }
            });
            assert!(
                serde_json::from_value::<Command>(raw).is_err(),
                "wire must reject noncanonical phase id {invalid}"
            );
        }
    }
}

#[cfg(test)]
mod host_console_patch_tests {
    use super::*;

    fn phase(value: &str) -> PhaseId {
        PhaseId::parse(value).expect("static test phase id is canonical")
    }

    fn snapshot(game: Uuid) -> HostConsoleStateDelta {
        HostConsoleStateDelta {
            game,
            authority: HostConsoleAuthorityDelta {
                principal_id: PrincipalId::fixture("host"),
                capability: HostConsoleAuthorityKind::HostOf,
                allowed_classes: Vec::new(),
                denied_classes: Vec::new(),
            },
            completed: false,
            phase: Some(HostConsolePhaseStateDelta {
                phase_id: phase("D01"),
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
            assigned_principal_id: PrincipalId::fixture("player"),
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
            author: GameThreadAuthor::Slot {
                slot_id: "slot-1".into(),
            },
            phase_id: Some(phase("D01")),
            body: body.into(),
            quotations: Vec::new(),
        }
    }

    #[test]
    fn game_thread_author_is_a_closed_tagged_union() {
        assert_eq!(
            serde_json::to_value(GameThreadAuthor::Slot {
                slot_id: "slot-1".into(),
            })
            .unwrap(),
            serde_json::json!({ "kind": "slot", "slot_id": "slot-1" })
        );
        assert!(
            serde_json::from_value::<GameThreadAuthor>(serde_json::json!({
                "kind": "profile",
                "profile_id": "must-not-cross-the-game-boundary"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<GameThreadAuthor>(serde_json::json!({
                "author_slot": "slot-1",
                "author_user": "must-not-cross-the-game-boundary"
            }))
            .is_err()
        );
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
            phase_id: phase("D01"),
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

    fn phase(value: &str) -> PhaseId {
        PhaseId::parse(value).expect("static test phase id is canonical")
    }

    fn vote_row(tallies: serde_json::Value) -> projections::DayVoteOutcomeRow {
        projections::DayVoteOutcomeRow {
            game_id: Uuid::nil(),
            phase_id: phase("D01"),
            source_seq: 11,
            event_index: 0,
            status: "Lynch".into(),
            winner_slot: Some("slot-2".into()),
            contenders: json!(["slot-2"]),
            tallies,
            votes: json!({ "slot-1": "slot-2" }),
            weights: json!({ "slot-1": 1.0 }),
            majority: Some(3.0),
            thresholds: json!({ "slot-2": 3.0 }),
            total_weight: 6.0,
            tiebreak: None,
            reason: None,
        }
    }

    fn host_prompt_row(decision: Option<serde_json::Value>) -> projections::HostPromptRow {
        projections::HostPromptRow {
            game_id: Uuid::nil(),
            phase_id: phase("D01"),
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
            decision,
            public_resolution: Some(json!({
                "kind": "day_vote_elimination",
                "phase_id": "D01",
                "selected_slot": "slot-2",
                "reason": "host_decides_tie"
            })),
            resolved_at: Some(44),
        }
    }

    fn investigation_row(result: serde_json::Value) -> projections::PlayerInvestigationResultRow {
        projections::PlayerInvestigationResultRow {
            game_id: Uuid::nil(),
            phase_id: phase("N01"),
            event_index: 0,
            audience_slot: "slot-1".into(),
            mode: "Track".into(),
            target_slot: "slot-3".into(),
            result,
        }
    }

    fn trace_decision_row(detail: serde_json::Value) -> commands::ResolutionTraceDecisionRow {
        commands::ResolutionTraceDecisionRow {
            row_index: 0,
            applied_stream_seq: Some(12),
            event_index: Some(3),
            stage: "result_contract".into(),
            source: "domain::resolve/result_version:19".into(),
            outcome: "2 inner events validated".into(),
            detail,
        }
    }

    #[test]
    fn day_vote_outcome_row_becomes_typed_maps() {
        let delta = DayVoteOutcomeDelta::try_from(vote_row(json!({
            "slot-2": 4.0,
            "slot-7": 2.0
        })))
        .expect("valid official tallies");
        assert_eq!(delta.contenders, vec!["slot-2"]);
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
        let delta = HostPromptDelta::try_from(host_prompt_row(Some(json!({
            "kind": "select_slot",
            "slot": "slot-2"
        }))))
        .expect("valid host prompt");
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
                phase_id: PhaseId::parse("D01").expect("static phase id is canonical"),
                selected_slot: "slot-2".into(),
                reason: "host_decides_tie".into(),
            })
        );
    }

    #[test]
    fn host_prompt_projection_decode_rejects_noncanonical_public_resolution_phase_ids() {
        let mut row = host_prompt_row(None);
        row.public_resolution = Some(json!({
            "kind": "phase_advance",
            "source_phase_id": "D01",
            "target_phase_id": "D01R02",
            "reason": "revote"
        }));

        let error = HostPromptDelta::try_from(row)
            .expect_err("projection adapter must reject a malformed phase id");
        assert_eq!(error.kind, "HostPrompt");
        assert_eq!(error.field, "public_resolution");
    }

    #[test]
    fn host_prompt_wire_decode_rejects_noncanonical_prompt_phase_id() {
        let raw = json!({
            "game": Uuid::nil(),
            "phase_id": "D01R02",
            "event_index": 0,
            "prompt_id": "D01:pk:Tie",
            "kind": "pk",
            "subject_slot": null,
            "reason": "host_decides_tie",
            "metadata": {},
            "status": "pending",
            "decision": null,
            "public_resolution": null,
            "resolved_at": null
        });
        assert!(serde_json::from_value::<HostPromptDelta>(raw).is_err());
    }

    #[test]
    fn investigation_result_row_becomes_typed_label_or_fields() {
        let label =
            PlayerInvestigationResult::try_from(projections::PlayerInvestigationResultRow {
                game_id: Uuid::nil(),
                phase_id: phase("N01"),
                event_index: 0,
                audience_slot: "slot-1".into(),
                mode: "Parity".into(),
                target_slot: "slot-2".into(),
                result: json!("town"),
            })
            .expect("parity label");
        assert_eq!(label.result, InvestigationResultBody::Label("town".into()));

        let fields = PlayerInvestigationResult::try_from(investigation_row(json!({
            "visited": ["slot-4"]
        })))
        .expect("track fields");
        match fields.result {
            InvestigationResultBody::Fields(body) => {
                assert_eq!(body.visited, vec!["slot-4".to_string()]);
            }
            other => panic!("expected fields, got {other:?}"),
        }
    }

    #[test]
    fn resolution_trace_detail_becomes_a_typed_atom_map() {
        let row = ResolutionTraceDecisionRow::try_from(trace_decision_row(json!({
            "kills": 1,
            "saves": 0
        })))
        .expect("object detail");
        assert_eq!(row.detail.get("kills"), Some(&JsonAtom::Number(1.0)));
        assert_eq!(row.detail.get("saves"), Some(&JsonAtom::Number(0.0)));

        let empty = ResolutionTraceDecisionRow::try_from(trace_decision_row(json!({})))
            .expect("empty object is a valid map");
        assert!(empty.detail.is_empty());
    }

    #[test]
    fn projection_adapter_rejects_malformed_json_columns() {
        struct Case {
            name: &'static str,
            kind: &'static str,
            field: &'static str,
            run: fn() -> Result<(), ProjectionAdapterError>,
        }

        let cases = [
            Case {
                name: "type-wrong tallies",
                kind: "DayVoteOutcome",
                field: "tallies",
                run: || {
                    DayVoteOutcomeDelta::try_from(vote_row(json!({ "slot_5": "3" }))).map(|_| ())
                },
            },
            Case {
                name: "null investigation result",
                kind: "PlayerInvestigationResult",
                field: "result",
                run: || {
                    PlayerInvestigationResult::try_from(investigation_row(json!(null))).map(|_| ())
                },
            },
            Case {
                name: "visitor_roles item is not a string",
                kind: "PlayerInvestigationResult",
                field: "result",
                run: || {
                    PlayerInvestigationResult::try_from(investigation_row(json!({
                        "visitor_roles": ["doctor", 7]
                    })))
                    .map(|_| ())
                },
            },
            Case {
                name: "unknown host-prompt decision kind",
                kind: "HostPrompt",
                field: "decision",
                run: || {
                    HostPromptDelta::try_from(host_prompt_row(Some(json!({ "kind": "nope" }))))
                        .map(|_| ())
                },
            },
            Case {
                name: "null trace detail is not an empty map",
                kind: "ResolutionTraceDecision",
                field: "detail",
                run: || {
                    ResolutionTraceDecisionRow::try_from(trace_decision_row(json!(null)))
                        .map(|_| ())
                },
            },
        ];

        for case in cases {
            let err = (case.run)().expect_err(case.name);
            assert_eq!(err.kind, case.kind, "{}", case.name);
            assert_eq!(err.field, case.field, "{}", case.name);
            assert!(
                !err.source.is_empty(),
                "{} should surface the serde diagnostic",
                case.name
            );
        }
    }
}
