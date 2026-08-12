//! Command submission and completed-game import HTTP boundary.
//!
//! This module owns wire-to-command adaptation, authenticated command admission,
//! media-reference preparation, idempotent dispatch, import authorization, and
//! the change-set handoff to live publication. Command decisioning remains in
//! `commands`; live update assembly and publication remain in `live_projection`.

use super::auth_http::{
    authenticate_token, bearer_token, require_global_admin, unauthorized_session, AuthHttpState,
};
use super::live_projection::{self, LiveProjectionChangeSet, LiveProjectionPublisher};
use super::{program_library, ApiError, ApiState};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use caps::Principal;
use media::{ContentId, MediaRepository, VariantFormat, VariantLimits};
use sqlx::PgPool;
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;
use wire::{
    AckMsg, ClientEnvelope, RejectCode, RejectMsg, ServerEnvelope, ServerMsg, PROTOCOL_VERSION,
};

#[derive(Clone)]
pub(super) struct CommandHttpState {
    pool: PgPool,
    auth: AuthHttpState,
    media_store: MediaRepository,
    variant_limits: VariantLimits,
    live_projection: LiveProjectionPublisher,
}

impl CommandHttpState {
    fn new(state: &ApiState) -> Self {
        Self {
            pool: state.pool.clone(),
            auth: state.auth.clone(),
            media_store: state.media_store.clone(),
            variant_limits: state.variant_limits,
            live_projection: state.live_projection.clone(),
        }
    }
}

pub(super) fn routes(state: &ApiState) -> Router<ApiState> {
    Router::new()
        .route("/commands", post(command))
        .route("/games/import", post(import_completed_game_export))
        .with_state(CommandHttpState::new(state))
}

enum PostMediaPreparationError {
    Invalid,
    Store,
    Invariant,
}

async fn prepare_wire_command(
    state: &CommandHttpState,
    command: wire::Command,
) -> Result<commands::Command, commands::Reject> {
    let command = match command.into_dispatch() {
        wire::CommandDispatch::Direct(command) => command,
        wire::CommandDispatch::AttachDayProgram { game, program_ref } => {
            let library = program_library::load_checked_in_program_library().map_err(|error| {
                commands::Reject::Internal(format!("load checked-in day-program library: {error}"))
            })?;
            let artifact = library
                .resolve(&program_ref, program_library::ProgramAudience::Product)
                .map_err(|error| commands::Reject::DayProgramValidation(error.to_string()))?;
            commands::Command::AttachDayProgram {
                game,
                program: artifact.document.clone(),
            }
        }
    };
    prepare_command_media(state, command).await
}

async fn prepare_command_media(
    state: &CommandHttpState,
    mut command: commands::Command,
) -> Result<commands::Command, commands::Reject> {
    let media = match &mut command {
        commands::Command::SubmitPost { media, .. }
        | commands::Command::PublishSpectatorPost { media, .. } => media,
        _ => return Ok(command),
    };
    if media.is_empty() {
        return Ok(command);
    }
    if media.len() > 4 {
        return Err(commands::Reject::InvalidTarget);
    }
    let requested = std::mem::take(media);
    let limits = state.variant_limits;
    let mut content_ids = BTreeSet::new();
    let mut prepared = Vec::with_capacity(requested.len());
    for item in requested {
        let result: Result<(), PostMediaPreparationError> = async {
            if item.alt.trim().is_empty()
                || item.alt.len() > 1_000
                || !content_ids.insert(item.content_id.clone())
            {
                return Err(PostMediaPreparationError::Invalid);
            }
            let id = item
                .content_id
                .parse::<ContentId>()
                .map_err(|_| PostMediaPreparationError::Invalid)?;
            let set = state
                .media_store
                .lookup_variant_set(id, limits)
                .await
                .map_err(|_| PostMediaPreparationError::Store)?
                .ok_or(PostMediaPreparationError::Invalid)?;
            let mut dimensions = BTreeMap::<String, (u32, u32, usize)>::new();
            for record in set.variants() {
                let key = record.key().kind().to_string();
                let entry = dimensions
                    .entry(key)
                    .or_insert((record.width(), record.height(), 0));
                if (entry.0, entry.1) != (record.width(), record.height()) {
                    return Err(PostMediaPreparationError::Invariant);
                }
                entry.2 += 1;
            }
            let variants = ["thumb", "tablet", "full-bounded"]
                .into_iter()
                .map(|kind| {
                    let Some((width, height, count)) = dimensions.remove(kind) else {
                        return Err(PostMediaPreparationError::Invariant);
                    };
                    if count != VariantFormat::ALL.len() {
                        return Err(PostMediaPreparationError::Invariant);
                    }
                    Ok((
                        kind.to_string(),
                        commands::ThreadPostMediaVariant { width, height },
                    ))
                })
                .collect::<Result<BTreeMap<_, _>, _>>()?;
            if !dimensions.is_empty() {
                return Err(PostMediaPreparationError::Invariant);
            }
            prepared.push(commands::ThreadPostMedia {
                content_id: id.to_string(),
                alt: item.alt.trim().to_string(),
                variants,
            });
            Ok(())
        }
        .await;
        result.map_err(|error| match error {
            PostMediaPreparationError::Invalid => commands::Reject::InvalidTarget,
            PostMediaPreparationError::Store => {
                tracing::error!("post media lookup failed");
                commands::Reject::Internal("post media lookup failed".to_string())
            }
            PostMediaPreparationError::Invariant => {
                tracing::error!("post media invariant failed");
                commands::Reject::Internal("post media lookup failed".to_string())
            }
        })?;
    }
    *media = prepared;
    Ok(command)
}

async fn command(
    State(state): State<CommandHttpState>,
    headers: HeaderMap,
    Json(envelope): Json<ClientEnvelope>,
) -> Response {
    if envelope.v != PROTOCOL_VERSION {
        return Json(ServerEnvelope::new(
            envelope.id,
            ServerMsg::Reject(protocol_reject("unsupported protocol version")),
        ))
        .into_response();
    }

    let wire::ClientMsg::Command(msg) = envelope.body else {
        return Json(ServerEnvelope::new(
            envelope.id,
            ServerMsg::Reject(protocol_reject("expected command message")),
        ))
        .into_response();
    };

    let principal_user_id = match authenticated_transport_principal(&state, &headers).await {
        Ok(principal_user_id) => principal_user_id,
        Err(error) => return command_api_error_response(envelope.id, error),
    };
    if matches!(&msg.command, wire::Command::CreateGame { .. }) {
        let token = bearer_token(&headers).expect("authenticated command has bearer token");
        if let Err(error) = require_global_admin(&state.auth, token, "game creation").await {
            return command_api_error_response(envelope.id, error);
        }
    }

    let game = command_game(&msg.command);
    let thread_dirty = command_affects_thread(&msg.command);
    let host_console_dirty = command_affects_host_console(&msg.command);
    let host_prompts_dirty = command_affects_host_prompts(&msg.command);
    let player_private_dirty = command_affects_player_private(&msg.command);
    let player_command_state_dirty = command_affects_player_command_state(&msg.command);
    let previous_votecount = match game {
        Some(game) => live_projection::vote_count_rows(&state.pool, game)
            .await
            .ok(),
        None => None,
    };
    let principal = Principal::user(principal_user_id);
    let prepared_command = prepare_wire_command(&state, msg.command).await;
    let body = match prepared_command {
        Err(reject) => ServerMsg::Reject(RejectMsg::from(reject)),
        Ok(command) => {
            match commands::handle_idempotent(&state.pool, &principal, msg.command_id, command)
                .await
            {
                Ok(ack) => {
                    if let Some(game) = game {
                        state
                            .live_projection
                            .publish(
                                &state.pool,
                                LiveProjectionChangeSet {
                                    game,
                                    previous_vote_counts: previous_votecount,
                                    thread_dirty,
                                    host_console_dirty,
                                    host_prompts_dirty,
                                    player_private_dirty,
                                    player_command_state_dirty,
                                },
                            )
                            .await;
                    }
                    ServerMsg::Ack(AckMsg::from(ack))
                }
                Err(reject) => ServerMsg::Reject(RejectMsg::from(reject)),
            }
        }
    };
    Json(ServerEnvelope::new(envelope.id, body)).into_response()
}

fn command_api_error_response(id: u64, error: ApiError) -> Response {
    let (status, error_code, message) = match error {
        ApiError::Reject {
            status,
            error,
            message,
        } => (status, error, message),
        other => return other.into_response(),
    };
    (
        status,
        Json(ServerEnvelope::new(
            id,
            ServerMsg::Reject(RejectMsg {
                error: error_code,
                retryable: false,
                message,
            }),
        )),
    )
        .into_response()
}

async fn import_completed_game_export(
    State(state): State<CommandHttpState>,
    headers: HeaderMap,
    Json(export): Json<eventstore::StreamExport>,
) -> Result<Json<projections::ProjectionAuditReport>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    require_global_admin(&state.auth, token, "completed-game import").await?;
    Ok(Json(
        projections::import_completed_game_export(&state.pool, &export).await?,
    ))
}

async fn authenticated_transport_principal(
    state: &CommandHttpState,
    headers: &HeaderMap,
) -> Result<String, ApiError> {
    let token = bearer_token(headers).ok_or_else(unauthorized_session)?;
    Ok(authenticate_token(&state.auth, token)
        .await?
        .principal_user_id)
}

fn command_game(command: &wire::Command) -> Option<Uuid> {
    match command {
        wire::Command::CreateGame { game, .. }
        | wire::Command::AddSlot { game, .. }
        | wire::Command::SeatPersona { game, .. }
        | wire::Command::RenameGamePersona { game, .. }
        | wire::Command::AssignRole { game, .. }
        | wire::Command::SetSlotStatus { game, .. }
        | wire::Command::AddSlotStatusTag { game, .. }
        | wire::Command::RemoveSlotStatusTag { game, .. }
        | wire::Command::AddCohost { game, .. }
        | wire::Command::GrantSpectator { game, .. }
        | wire::Command::RevokeSpectator { game, .. }
        | wire::Command::StartGame { game, .. }
        | wire::Command::OpenDayPhase { game, .. }
        | wire::Command::AdvancePhase { game }
        | wire::Command::AdvancePhaseByDeadline { game, .. }
        | wire::Command::LockThread { game }
        | wire::Command::UnlockThread { game }
        | wire::Command::ResolvePhase { game, .. }
        | wire::Command::CompleteGame { game }
        | wire::Command::PublishVotecount { game }
        | wire::Command::ResolveHostPrompt { game, .. }
        | wire::Command::SetPostPolicy { game, .. }
        | wire::Command::PublishSpectatorPost { game, .. }
        | wire::Command::ControlItaSession { game, .. }
        | wire::Command::SubmitVote { game, .. }
        | wire::Command::WithdrawVote { game, .. }
        | wire::Command::SubmitAction { game, .. }
        | wire::Command::WithdrawAction { game, .. }
        | wire::Command::SubmitPost { game, .. }
        | wire::Command::ExtendDeadline { game, .. }
        | wire::Command::ApplyEffectPlan { game, .. }
        | wire::Command::AttachDayProgram { game, .. }
        | wire::Command::ScheduleDayEvent { game, .. }
        | wire::Command::OpenDayEvent { game, .. }
        | wire::Command::LockDayEvent { game, .. }
        | wire::Command::CancelDayEvent { game, .. }
        | wire::Command::SubmitDayEventParticipation { game, .. }
        | wire::Command::WithdrawDayEventParticipation { game, .. }
        | wire::Command::ResolveDayEvent { game, .. }
        | wire::Command::ProcessReplacement { game, .. } => Some(*game),
    }
}

fn command_affects_host_console(command: &wire::Command) -> bool {
    matches!(
        command,
        wire::Command::AddSlot { .. }
            | wire::Command::SeatPersona { .. }
            | wire::Command::RenameGamePersona { .. }
            | wire::Command::AssignRole { .. }
            | wire::Command::SetSlotStatus { .. }
            | wire::Command::AddSlotStatusTag { .. }
            | wire::Command::RemoveSlotStatusTag { .. }
            | wire::Command::StartGame { .. }
            | wire::Command::OpenDayPhase { .. }
            | wire::Command::AdvancePhase { .. }
            | wire::Command::AdvancePhaseByDeadline { .. }
            | wire::Command::LockThread { .. }
            | wire::Command::UnlockThread { .. }
            | wire::Command::ResolvePhase { .. }
            | wire::Command::CompleteGame { .. }
            | wire::Command::PublishVotecount { .. }
            | wire::Command::ResolveHostPrompt { .. }
            | wire::Command::SetPostPolicy { .. }
            | wire::Command::ControlItaSession { .. }
            | wire::Command::SubmitPost { .. }
            | wire::Command::ExtendDeadline { .. }
            | wire::Command::ApplyEffectPlan { .. }
            | wire::Command::AttachDayProgram { .. }
            | wire::Command::ScheduleDayEvent { .. }
            | wire::Command::OpenDayEvent { .. }
            | wire::Command::LockDayEvent { .. }
            | wire::Command::CancelDayEvent { .. }
            | wire::Command::SubmitDayEventParticipation { .. }
            | wire::Command::WithdrawDayEventParticipation { .. }
            | wire::Command::ResolveDayEvent { .. }
            | wire::Command::ProcessReplacement { .. }
    )
}

fn command_affects_thread(command: &wire::Command) -> bool {
    matches!(
        command,
        wire::Command::ResolvePhase { .. }
            | wire::Command::SubmitAction { .. }
            | wire::Command::SubmitPost { .. }
            | wire::Command::PublishSpectatorPost { .. }
            | wire::Command::PublishVotecount { .. }
    )
}

fn command_affects_host_prompts(command: &wire::Command) -> bool {
    matches!(
        command,
        wire::Command::SetSlotStatus { .. }
            | wire::Command::ApplyEffectPlan { .. }
            | wire::Command::ResolvePhase { .. }
            | wire::Command::ResolveHostPrompt { .. }
    )
}

fn command_affects_player_private(command: &wire::Command) -> bool {
    matches!(
        command,
        wire::Command::ResolvePhase { .. }
            | wire::Command::ResolveHostPrompt { .. }
            | wire::Command::ApplyEffectPlan { .. }
            | wire::Command::ResolveDayEvent { .. }
            | wire::Command::SubmitAction { .. }
            | wire::Command::WithdrawAction { .. }
    )
}

fn command_affects_player_command_state(command: &wire::Command) -> bool {
    matches!(
        command,
        wire::Command::AssignRole { .. }
            | wire::Command::SetSlotStatus { .. }
            | wire::Command::AddSlotStatusTag { .. }
            | wire::Command::RemoveSlotStatusTag { .. }
            | wire::Command::StartGame { .. }
            | wire::Command::OpenDayPhase { .. }
            | wire::Command::AdvancePhase { .. }
            | wire::Command::AdvancePhaseByDeadline { .. }
            | wire::Command::LockThread { .. }
            | wire::Command::UnlockThread { .. }
            | wire::Command::ResolvePhase { .. }
            | wire::Command::ResolveHostPrompt { .. }
            | wire::Command::CompleteGame { .. }
            | wire::Command::SetPostPolicy { .. }
            | wire::Command::ControlItaSession { .. }
            | wire::Command::SubmitVote { .. }
            | wire::Command::WithdrawVote { .. }
            | wire::Command::ApplyEffectPlan { .. }
            | wire::Command::AttachDayProgram { .. }
            | wire::Command::ScheduleDayEvent { .. }
            | wire::Command::OpenDayEvent { .. }
            | wire::Command::LockDayEvent { .. }
            | wire::Command::CancelDayEvent { .. }
            | wire::Command::SubmitDayEventParticipation { .. }
            | wire::Command::WithdrawDayEventParticipation { .. }
            | wire::Command::ResolveDayEvent { .. }
            | wire::Command::ProcessReplacement { .. }
    )
}

fn protocol_reject(message: impl Into<String>) -> RejectMsg {
    RejectMsg {
        error: RejectCode::Internal,
        retryable: false,
        message: message.into(),
    }
}

pub(super) fn command_reject_api_error(reject: commands::Reject) -> ApiError {
    let status = match &reject {
        commands::Reject::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        commands::Reject::UnknownGame
        | commands::Reject::UnknownSlot
        | commands::Reject::UnknownDayEvent => StatusCode::NOT_FOUND,
        commands::Reject::NotAuthorized
        | commands::Reject::NotHost
        | commands::Reject::CohostPermissionDenied(_)
        | commands::Reject::NotYourSlot => StatusCode::FORBIDDEN,
        _ => StatusCode::CONFLICT,
    };
    let error = RejectCode::from(&reject);
    let message = reject.to_string();
    ApiError::Reject {
        status,
        error,
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        command_affects_host_console, command_affects_host_prompts,
        command_affects_player_command_state, command_affects_player_private,
        command_affects_thread, command_game,
    };
    use uuid::Uuid;

    #[test]
    fn host_prompt_resolution_refreshes_player_command_and_outcome_state() {
        assert!(command_affects_player_command_state(
            &wire::Command::ResolveHostPrompt {
                game: Uuid::new_v4(),
                prompt_id: "D01:pk:Tie".to_string(),
                decision: wire::HostPromptDecision::SelectSlot {
                    slot: "slot-2".to_string(),
                },
            },
        ));
    }

    #[test]
    fn effect_plan_routes_and_refreshes_every_state_surface_it_can_change() {
        let game = Uuid::new_v4();
        let command = wire::Command::ApplyEffectPlan {
            game,
            effects: Vec::new(),
            reason: "classification fixture".to_string(),
        };

        assert_eq!(command_game(&command), Some(game));
        assert!(command_affects_host_console(&command));
        assert!(command_affects_host_prompts(&command));
        assert!(command_affects_player_private(&command));
        assert!(command_affects_player_command_state(&command));
        assert!(!command_affects_thread(&command));
    }
}
