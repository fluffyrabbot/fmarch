//! Wire ↔ commands::Command name parity.
//!
//! # Intentional non-isomorphisms (name-parity still holds)
//!
//! - **AttachDayProgram shape**: wire carries `program_ref: DayProgramRef` and
//!   dispatches via `CommandDispatch::AttachDayProgram` for adapter-owned
//!   immutable artifact lookup. Core accepts `program: DayProgram` after the
//!   adapter materializes the full program.
//! - **media Option vs Vec**: wire `PublishSpectatorPost` / `SubmitPost` use
//!   `Option<Vec<SubmitPostMedia>>` (omit-friendly, empty when absent). Core
//!   uses `Vec<ThreadPostMedia>` (always present, may be empty).
//! - **empty optional variants**: wire may omit empty `cohost_denied` /
//!   `message` / `media`; core may keep empty containers or skip-serialize.
//!
//! Everything else is name-parity after Wave 1 D3, including
//! `AddSlotStatusTag`, `RemoveSlotStatusTag`, and `ControlItaSession`.

use uuid::Uuid;
use wire::{Command, CommandDispatch, ItaSessionControlKind};

/// Core command variant names that intentionally have no wire counterpart.
/// After D3 this set MUST stay empty — prefer full wire coverage.
const ALLOWED_CORE_ONLY: &[&str] = &[];

#[test]
fn allowed_core_only_is_empty() {
    assert!(
        ALLOWED_CORE_ONLY.is_empty(),
        "core-only commands must be empty after wire parity; remaining: {ALLOWED_CORE_ONLY:?}"
    );
}

/// Exhaustive map of every `commands::Command` variant to its wire status.
/// Adding a core variant without updating this match fails compilation.
fn core_command_wire_status(cmd: &commands::Command) -> CoreWireStatus {
    match cmd {
        commands::Command::CreateGame { .. } => CoreWireStatus::Mapped("CreateGame"),
        commands::Command::AddSlot { .. } => CoreWireStatus::Mapped("AddSlot"),
        commands::Command::SeatPersona { .. } => CoreWireStatus::Mapped("SeatPersona"),
        commands::Command::RenameGamePersona { .. } => CoreWireStatus::Mapped("RenameGamePersona"),
        commands::Command::AssignRole { .. } => CoreWireStatus::Mapped("AssignRole"),
        commands::Command::SetSlotStatus { .. } => CoreWireStatus::Mapped("SetSlotStatus"),
        commands::Command::AddSlotStatusTag { .. } => CoreWireStatus::Mapped("AddSlotStatusTag"),
        commands::Command::RemoveSlotStatusTag { .. } => {
            CoreWireStatus::Mapped("RemoveSlotStatusTag")
        }
        commands::Command::AddCohost { .. } => CoreWireStatus::Mapped("AddCohost"),
        commands::Command::GrantSpectator { .. } => CoreWireStatus::Mapped("GrantSpectator"),
        commands::Command::RevokeSpectator { .. } => CoreWireStatus::Mapped("RevokeSpectator"),
        commands::Command::StartGame { .. } => CoreWireStatus::Mapped("StartGame"),
        commands::Command::OpenDayPhase { .. } => CoreWireStatus::Mapped("OpenDayPhase"),
        commands::Command::AdvancePhase { .. } => CoreWireStatus::Mapped("AdvancePhase"),
        commands::Command::AdvancePhaseByDeadline { .. } => {
            CoreWireStatus::Mapped("AdvancePhaseByDeadline")
        }
        commands::Command::LockThread { .. } => CoreWireStatus::Mapped("LockThread"),
        commands::Command::UnlockThread { .. } => CoreWireStatus::Mapped("UnlockThread"),
        commands::Command::ResolvePhase { .. } => CoreWireStatus::Mapped("ResolvePhase"),
        commands::Command::CompleteGame { .. } => CoreWireStatus::Mapped("CompleteGame"),
        commands::Command::PublishVotecount { .. } => CoreWireStatus::Mapped("PublishVotecount"),
        commands::Command::ResolveHostPrompt { .. } => CoreWireStatus::Mapped("ResolveHostPrompt"),
        commands::Command::SetPostPolicy { .. } => CoreWireStatus::Mapped("SetPostPolicy"),
        commands::Command::PublishSpectatorPost { .. } => {
            CoreWireStatus::Mapped("PublishSpectatorPost")
        }
        commands::Command::ControlItaSession { .. } => CoreWireStatus::Mapped("ControlItaSession"),
        commands::Command::ApplyEffectPlan { .. } => CoreWireStatus::Mapped("ApplyEffectPlan"),
        commands::Command::AttachDayProgram { .. } => CoreWireStatus::Mapped("AttachDayProgram"),
        commands::Command::ScheduleDayEvent { .. } => CoreWireStatus::Mapped("ScheduleDayEvent"),
        commands::Command::OpenDayEvent { .. } => CoreWireStatus::Mapped("OpenDayEvent"),
        commands::Command::LockDayEvent { .. } => CoreWireStatus::Mapped("LockDayEvent"),
        commands::Command::CancelDayEvent { .. } => CoreWireStatus::Mapped("CancelDayEvent"),
        commands::Command::SubmitDayEventParticipation { .. } => {
            CoreWireStatus::Mapped("SubmitDayEventParticipation")
        }
        commands::Command::WithdrawDayEventParticipation { .. } => {
            CoreWireStatus::Mapped("WithdrawDayEventParticipation")
        }
        commands::Command::ResolveDayEvent { .. } => CoreWireStatus::Mapped("ResolveDayEvent"),
        commands::Command::SubmitVote { .. } => CoreWireStatus::Mapped("SubmitVote"),
        commands::Command::WithdrawVote { .. } => CoreWireStatus::Mapped("WithdrawVote"),
        commands::Command::SubmitAction { .. } => CoreWireStatus::Mapped("SubmitAction"),
        commands::Command::WithdrawAction { .. } => CoreWireStatus::Mapped("WithdrawAction"),
        commands::Command::SubmitPost { .. } => CoreWireStatus::Mapped("SubmitPost"),
        commands::Command::ExtendDeadline { .. } => CoreWireStatus::Mapped("ExtendDeadline"),
        commands::Command::ProcessReplacement { .. } => {
            CoreWireStatus::Mapped("ProcessReplacement")
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CoreWireStatus {
    Mapped(&'static str),
    #[allow(dead_code)]
    CoreOnly(&'static str),
}

#[test]
fn every_core_command_is_wire_mapped_or_allowlisted() {
    // Keep the exhaustive mapper live so new core variants break the build.
    let _ = core_command_wire_status as fn(&commands::Command) -> CoreWireStatus;

    // Allowlist must only name CoreOnly variants (none after D3).
    for name in ALLOWED_CORE_ONLY {
        assert!(
            !name.is_empty(),
            "ALLOWED_CORE_ONLY entries must be non-empty variant names"
        );
    }
    assert!(
        ALLOWED_CORE_ONLY.is_empty(),
        "prefer full wire coverage; ALLOWED_CORE_ONLY must be empty after D3"
    );
}

#[test]
fn add_slot_status_tag_dispatches_direct() {
    let game = Uuid::nil();
    let dispatch = Command::AddSlotStatusTag {
        game,
        slot: "slot_1".into(),
        tag: "bomb".into(),
    }
    .into_dispatch();

    match dispatch {
        CommandDispatch::Direct(commands::Command::AddSlotStatusTag { game: g, slot, tag }) => {
            assert_eq!(g, game);
            assert_eq!(slot, "slot_1");
            assert_eq!(tag, "bomb");
        }
        other => panic!("expected Direct(AddSlotStatusTag), got {other:?}"),
    }
}

#[test]
fn remove_slot_status_tag_dispatches_direct() {
    let game = Uuid::nil();
    let dispatch = Command::RemoveSlotStatusTag {
        game,
        slot: "slot_2".into(),
        tag: "lover".into(),
    }
    .into_dispatch();

    match dispatch {
        CommandDispatch::Direct(commands::Command::RemoveSlotStatusTag { game: g, slot, tag }) => {
            assert_eq!(g, game);
            assert_eq!(slot, "slot_2");
            assert_eq!(tag, "lover");
        }
        other => panic!("expected Direct(RemoveSlotStatusTag), got {other:?}"),
    }
}

#[test]
fn control_ita_session_dispatches_direct() {
    let game = Uuid::nil();
    let dispatch = Command::ControlItaSession {
        game,
        session_id: "d1".into(),
        control: ItaSessionControlKind::Pause,
        message: Some("Pause for votecount correction".into()),
    }
    .into_dispatch();

    match dispatch {
        CommandDispatch::Direct(commands::Command::ControlItaSession {
            game: g,
            session_id,
            control,
            message,
        }) => {
            assert_eq!(g, game);
            assert_eq!(session_id, "d1");
            assert_eq!(control, domain::ItaSessionControlKind::Pause);
            assert_eq!(message.as_deref(), Some("Pause for votecount correction"));
        }
        other => panic!("expected Direct(ControlItaSession), got {other:?}"),
    }
}

#[test]
fn control_ita_session_omits_empty_message_on_wire() {
    let game = Uuid::nil();
    let value = serde_json::to_value(Command::ControlItaSession {
        game,
        session_id: "d1".into(),
        control: ItaSessionControlKind::Close,
        message: None,
    })
    .unwrap();

    assert_eq!(value["ControlItaSession"]["control"], "close");
    assert!(value["ControlItaSession"].get("message").is_none());
}

#[test]
fn ita_session_control_kind_maps_all_variants() {
    let pairs = [
        (
            ItaSessionControlKind::Open,
            domain::ItaSessionControlKind::Open,
        ),
        (
            ItaSessionControlKind::Pause,
            domain::ItaSessionControlKind::Pause,
        ),
        (
            ItaSessionControlKind::Cancel,
            domain::ItaSessionControlKind::Cancel,
        ),
        (
            ItaSessionControlKind::Update,
            domain::ItaSessionControlKind::Update,
        ),
        (
            ItaSessionControlKind::Close,
            domain::ItaSessionControlKind::Close,
        ),
    ];
    for (wire_kind, domain_kind) in pairs {
        assert_eq!(domain::ItaSessionControlKind::from(wire_kind), domain_kind);
    }
}
