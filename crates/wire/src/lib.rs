//! `wire` — versioned transport types crossing the Rust/client boundary.
//!
//! Wire types are deliberately separate from domain and storage types. They are
//! the stable transport contract; server internals may evolve behind them.

use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
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
pub struct CommandMsg {
    pub command_id: Uuid,
    pub principal_user_id: String,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub enum Command {
    CreateGame {
        game: Uuid,
        pack: String,
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
    AddCohost {
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
    LockThread {
        game: Uuid,
    },
    UnlockThread {
        game: Uuid,
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
    SubmitPost {
        game: Uuid,
        actor_slot: String,
        body: String,
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
            Command::CreateGame { game, pack } => commands::Command::CreateGame { game, pack },
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
            Command::AddCohost { game, user } => commands::Command::AddCohost { game, user },
            Command::StartGame { game, phase } => commands::Command::StartGame { game, phase },
            Command::OpenDayPhase { game, phase } => {
                commands::Command::OpenDayPhase { game, phase }
            }
            Command::LockThread { game } => commands::Command::LockThread { game },
            Command::UnlockThread { game } => commands::Command::UnlockThread { game },
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
            Command::SubmitPost {
                game,
                actor_slot,
                body,
            } => commands::Command::SubmitPost {
                game,
                actor_slot,
                body,
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
    PhaseLocked,
    SlotNotAlive,
    InvalidTarget,
    StreamConflict,
    UnknownGame,
    UnknownSlot,
    Internal,
}

impl From<&commands::Reject> for RejectCode {
    fn from(reject: &commands::Reject) -> Self {
        match reject {
            commands::Reject::NotAuthorized => RejectCode::NotAuthorized,
            commands::Reject::NotYourSlot => RejectCode::NotYourSlot,
            commands::Reject::NotHost => RejectCode::NotHost,
            commands::Reject::PhaseLocked => RejectCode::PhaseLocked,
            commands::Reject::SlotNotAlive => RejectCode::SlotNotAlive,
            commands::Reject::InvalidTarget => RejectCode::InvalidTarget,
            commands::Reject::StreamConflict => RejectCode::StreamConflict,
            commands::Reject::UnknownGame => RejectCode::UnknownGame,
            commands::Reject::UnknownSlot => RejectCode::UnknownSlot,
            commands::Reject::Internal(_) => RejectCode::Internal,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "body")]
pub enum ProjectionDelta {
    VoteCountChanged(VoteCountDelta),
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
#[serde(tag = "kind", content = "body")]
pub enum CapabilityGrant {
    GlobalAdmin,
    GlobalMod,
    HostOf { game: Uuid },
    CohostOf { game: Uuid },
    SlotOccupant { slot: String },
    ChannelMember { channel: String },
    DeadViewer { game: Uuid },
}

pub mod typescript {
    use ts_rs::TS;

    use crate::{
        AckMsg, CapabilityGrant, ClientEnvelope, ClientMsg, Command, CommandMsg, Hello,
        ProjectionDelta, RejectCode, RejectMsg, ServerEnvelope, ServerMsg, VoteCountDelta,
        VoteTarget,
    };

    const HEADER: &str = "// This file is @generated by wire::typescript::render.\n// Run `cargo run -p wire --bin export_types` to regenerate.\n\n";

    pub fn render() -> String {
        let mut out = String::from(HEADER);
        push::<VoteTarget>(&mut out);
        push::<Command>(&mut out);
        push::<CommandMsg>(&mut out);
        push::<ClientMsg>(&mut out);
        push::<ClientEnvelope>(&mut out);
        push::<AckMsg>(&mut out);
        push::<RejectCode>(&mut out);
        push::<RejectMsg>(&mut out);
        push::<VoteCountDelta>(&mut out);
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
        out.push_str(&decl);
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
        }
    }
}
