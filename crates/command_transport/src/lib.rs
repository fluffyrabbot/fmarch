//! Command transport adapters. Wire declarations never depend on command execution.
use std::collections::BTreeMap;
use uuid::Uuid;
use wire::*;

pub fn vote_target(target: VoteTarget) -> commands::VoteTarget {
    match target {
        VoteTarget::Slot(slot) => commands::VoteTarget::Slot(slot),
        VoteTarget::NoLynch => commands::VoteTarget::NoLynch,
    }
}

pub fn host_prompt_decision(decision: HostPromptDecision) -> commands::HostPromptDecision {
    match decision {
        HostPromptDecision::SelectSlot { slot } => {
            commands::HostPromptDecision::SelectSlot { slot }
        }
        HostPromptDecision::SelectPolicy { policy } => commands::HostPromptDecision::SelectPolicy {
            policy,
            metadata: serde_json::json!({}),
        },
        HostPromptDecision::Acknowledge => commands::HostPromptDecision::Acknowledge {
            metadata: serde_json::json!({}),
        },
    }
}

pub fn cohost_permission_class(value: CohostPermissionClass) -> commands::CohostPermissionClass {
    match value {
        CohostPermissionClass::Setup => commands::CohostPermissionClass::Setup,
        CohostPermissionClass::PhaseResolve => commands::CohostPermissionClass::PhaseResolve,
        CohostPermissionClass::HostPromptResolve => {
            commands::CohostPermissionClass::HostPromptResolve
        }
        CohostPermissionClass::Lifecycle => commands::CohostPermissionClass::Lifecycle,
        CohostPermissionClass::Replacement => commands::CohostPermissionClass::Replacement,
        CohostPermissionClass::Deadline => commands::CohostPermissionClass::Deadline,
        CohostPermissionClass::Narrative => commands::CohostPermissionClass::Narrative,
        CohostPermissionClass::ItaControl => commands::CohostPermissionClass::ItaControl,
        CohostPermissionClass::EffectSpec => commands::CohostPermissionClass::EffectSpec,
        CohostPermissionClass::DayEventOps => commands::CohostPermissionClass::DayEventOps,
        CohostPermissionClass::DayEventResolve => commands::CohostPermissionClass::DayEventResolve,
        CohostPermissionClass::ProgramAttach => commands::CohostPermissionClass::ProgramAttach,
    }
}

pub fn wire_cohost_permission_class(
    value: commands::CohostPermissionClass,
) -> CohostPermissionClass {
    match value {
        commands::CohostPermissionClass::Setup => CohostPermissionClass::Setup,
        commands::CohostPermissionClass::PhaseResolve => CohostPermissionClass::PhaseResolve,
        commands::CohostPermissionClass::HostPromptResolve => {
            CohostPermissionClass::HostPromptResolve
        }
        commands::CohostPermissionClass::Lifecycle => CohostPermissionClass::Lifecycle,
        commands::CohostPermissionClass::Replacement => CohostPermissionClass::Replacement,
        commands::CohostPermissionClass::Deadline => CohostPermissionClass::Deadline,
        commands::CohostPermissionClass::Narrative => CohostPermissionClass::Narrative,
        commands::CohostPermissionClass::ItaControl => CohostPermissionClass::ItaControl,
        commands::CohostPermissionClass::EffectSpec => CohostPermissionClass::EffectSpec,
        commands::CohostPermissionClass::DayEventOps => CohostPermissionClass::DayEventOps,
        commands::CohostPermissionClass::DayEventResolve => CohostPermissionClass::DayEventResolve,
        commands::CohostPermissionClass::ProgramAttach => CohostPermissionClass::ProgramAttach,
    }
}

pub fn ack(ack: commands::Ack) -> AckMsg {
    AckMsg {
        stream_seqs: ack.stream_seqs,
    }
}

pub fn reject(reject: commands::Reject) -> RejectMsg {
    let retryable = reject.is_retryable();
    let message = reject.to_string();
    RejectMsg {
        error: reject_code(&reject),
        retryable,
        message,
    }
}

pub fn reject_code(reject: &commands::Reject) -> RejectCode {
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
        commands::Reject::RateLimited { .. } => RejectCode::RateLimited,
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

pub fn resolution_trace_inspection_report(
    report: commands::ResolutionTraceInspectionReport,
) -> Result<ResolutionTraceInspectionReport, ProjectionAdapterError> {
    Ok(ResolutionTraceInspectionReport {
        game: report.game_id,
        traces: report
            .traces
            .into_iter()
            .map(resolution_trace_inspection_run)
            .collect::<Result<_, _>>()?,
    })
}

pub fn resolution_trace_inspection_run(
    run: commands::ResolutionTraceInspectionRun,
) -> Result<ResolutionTraceInspectionRun, ProjectionAdapterError> {
    Ok(ResolutionTraceInspectionRun {
        phase_id: run.phase_id,
        run_id: run.run_id,
        applied_stream_seq: run.applied_stream_seq,
        trace_stream_seq: run.trace_stream_seq,
        trace_version: run.trace_version,
        decisions: run
            .decisions
            .into_iter()
            .map(resolution_trace_decision_row)
            .collect::<Result<_, _>>()?,
        edges: run
            .edges
            .into_iter()
            .map(resolution_trace_edge_row)
            .collect::<Result<_, _>>()?,
        generated: run
            .generated
            .into_iter()
            .map(resolution_trace_generated_row)
            .collect::<Result<_, _>>()?,
        effect_changes: run
            .effect_changes
            .into_iter()
            .map(resolution_trace_effect_change_row)
            .collect::<Result<_, _>>()?,
        visibility: run
            .visibility
            .into_iter()
            .map(resolution_trace_visibility_row)
            .collect::<Result<_, _>>()?,
        notes: run
            .notes
            .into_iter()
            .map(resolution_trace_note_row)
            .collect(),
    })
}

pub fn resolution_trace_decision_row(
    row: commands::ResolutionTraceDecisionRow,
) -> Result<ResolutionTraceDecisionRow, ProjectionAdapterError> {
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

pub fn resolution_trace_edge_row(
    row: commands::ResolutionTraceEdgeRow,
) -> Result<ResolutionTraceEdgeRow, ProjectionAdapterError> {
    Ok(ResolutionTraceEdgeRow {
        row_index: row.row_index,
        applied_stream_seq: row.applied_stream_seq,
        from: row.from,
        to: row.to,
        kind: row.kind,
        detail: decode_field("ResolutionTraceEdge", "detail", row.detail)?,
    })
}

pub fn resolution_trace_generated_row(
    row: commands::ResolutionTraceGeneratedRow,
) -> Result<ResolutionTraceGeneratedRow, ProjectionAdapterError> {
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

pub fn resolution_trace_effect_change_row(
    row: commands::ResolutionTraceEffectChangeRow,
) -> Result<ResolutionTraceEffectChangeRow, ProjectionAdapterError> {
    Ok(ResolutionTraceEffectChangeRow {
        row_index: row.row_index,
        applied_stream_seq: row.applied_stream_seq,
        effect: row.effect,
        target: row.target,
        operation: row.operation,
        detail: decode_field("ResolutionTraceEffectChange", "detail", row.detail)?,
    })
}

pub fn resolution_trace_visibility_row(
    row: commands::ResolutionTraceVisibilityRow,
) -> Result<ResolutionTraceVisibilityRow, ProjectionAdapterError> {
    Ok(ResolutionTraceVisibilityRow {
        row_index: row.row_index,
        applied_stream_seq: row.applied_stream_seq,
        event_index: row.event_index,
        audience: row.audience,
        policy: row.policy,
        detail: decode_field("ResolutionTraceVisibility", "detail", row.detail)?,
    })
}

pub fn resolution_trace_note_row(row: commands::ResolutionTraceNoteRow) -> ResolutionTraceNoteRow {
    ResolutionTraceNoteRow {
        row_index: row.row_index,
        applied_stream_seq: row.applied_stream_seq,
        note: row.note,
    }
}

/// Transport commands either map directly to the command core or require an
/// adapter-owned immutable artifact lookup first.
#[derive(Debug, Clone, PartialEq)]
#[expect(
    clippy::large_enum_variant,
    reason = "dispatch owns the direct command until the HTTP adapter resolves immutable program references"
)]
pub enum CommandDispatch {
    Direct(commands::Command),
    AttachDayProgram {
        game: Uuid,
        program_ref: game_platform::DayProgramRef,
    },
}

pub trait CommandDispatchExt {
    fn into_dispatch(self) -> CommandDispatch;
}

impl CommandDispatchExt for Command {
    fn into_dispatch(self) -> CommandDispatch {
        let command = match self {
            Command::CreateGame {
                game,
                pack,
                cohost_denied,
                origin,
            } => commands::Command::CreateGame {
                game,
                pack,
                cohost_denied: cohost_denied
                    .into_iter()
                    .map(cohost_permission_class)
                    .collect(),
                origin: origin.map(|origin| {
                    content_reference::PublicContentRef::new(origin.surface_id, origin.source_seq)
                }),
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
                decision: host_prompt_decision(decision),
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
                target: vote_target(target),
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
mod trace_tests {
    use super::*;
    use serde_json::json;
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
    fn resolution_trace_detail_becomes_a_typed_atom_map() {
        let row = resolution_trace_decision_row(trace_decision_row(json!({
            "kills": 1,
            "saves": 0
        })))
        .expect("object detail");
        assert_eq!(row.detail.get("kills"), Some(&JsonAtom::Number(1.0)));
        assert_eq!(row.detail.get("saves"), Some(&JsonAtom::Number(0.0)));

        let empty = resolution_trace_decision_row(trace_decision_row(json!({})))
            .expect("empty object is a valid map");
        assert!(empty.detail.is_empty());
    }
    #[test]
    fn null_trace_detail_fails_closed() {
        let error = resolution_trace_decision_row(trace_decision_row(json!(null))).unwrap_err();
        assert_eq!(error.kind, "ResolutionTraceDecision");
        assert_eq!(error.field, "detail");
        assert!(!error.source.is_empty());
    }
}

#[cfg(test)]
mod response_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn responses_preserve_wire_fields_and_retry_semantics() {
        assert_eq!(
            serde_json::to_value(ack(commands::Ack {
                stream_seqs: vec![9, 10]
            }))
            .unwrap(),
            json!({"stream_seqs": [9, 10]})
        );
        let cases = [
            (
                commands::Reject::NotAuthorized,
                json!({"error": "NotAuthorized", "retryable": false, "message": "not authorized"}),
            ),
            (
                commands::Reject::StreamConflict,
                json!({"error": "StreamConflict", "retryable": true, "message": "stream conflict (retryable)"}),
            ),
            (
                commands::Reject::RateLimited {
                    retry_after_seconds: 7,
                },
                json!({"error": "RateLimited", "retryable": true, "message": "posting rate limit reached; retry in 7s"}),
            ),
        ];
        for (input, expected) in cases {
            assert_eq!(serde_json::to_value(reject(input)).unwrap(), expected);
        }
    }

    #[test]
    fn program_reference_remains_adapter_owned() {
        let command: Command = serde_json::from_value(json!({"AttachDayProgram": {
            "game": Uuid::from_u128(1),
            "program_ref": {"id": "raffle", "version": 1,
                "content_hash": "43ae91d9858580a74f00dfa91848821d4ce60a93a68ab8dbd972818a06d24800"}
        }}))
        .unwrap();
        let Command::AttachDayProgram { game, program_ref } = command.clone() else {
            panic!("wire variant")
        };
        assert_eq!(
            command.into_dispatch(),
            CommandDispatch::AttachDayProgram { game, program_ref }
        );
    }
}
