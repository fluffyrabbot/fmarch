//! Command submission and completed-game import HTTP boundary.
//!
//! This module owns wire-to-command adaptation, authenticated command admission,
//! media-reference preparation, idempotent dispatch, import authorization, and
//! the change-set handoff to live publication. Command decisioning remains in
//! `commands`; live update assembly and publication remain in `live_projection`.

use super::auth_http::{
    authorization_context, bearer_token, require_global_admin, unauthorized_session, AuthHttpState,
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
use principal::PrincipalId;
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
    embed_lookup: crate::embed_http::YoutubeSnapshotLookup,
}

impl CommandHttpState {
    fn new(state: &ApiState) -> Self {
        Self {
            pool: state.pool.clone(),
            auth: state.auth.clone(),
            media_store: state.media_store.clone(),
            variant_limits: state.variant_limits,
            live_projection: state.live_projection.clone(),
            embed_lookup: state.embed_lookup.clone(),
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
    let command = prepare_command_media(state, command).await?;
    prepare_command_embed(state, command).await
}

async fn prepare_command_embed(
    state: &CommandHttpState,
    mut command: commands::Command,
) -> Result<commands::Command, commands::Reject> {
    let commands::Command::SubmitPost {
        embed_url,
        embed_snapshot,
        channel_id,
        ..
    } = &mut command
    else {
        return Ok(command);
    };
    let Some(url) = embed_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(command);
    };
    let resolved =
        crate::embed_http::resolve_youtube_snapshot(&state.embed_lookup, channel_id, url).await?;
    *embed_snapshot = resolved.snapshot;
    Ok(command)
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

    let principal_id = match authenticated_transport_principal(&state, &headers).await {
        Ok(principal_id) => principal_id,
        Err(error) => return command_api_error_response(envelope.id, error),
    };
    if matches!(&msg.command, wire::Command::CreateGame { .. }) {
        let token = bearer_token(&headers).expect("authenticated command has bearer token");
        if let Err(error) = require_global_admin(&state.auth, token, "game creation").await {
            return command_api_error_response(envelope.id, error);
        }
    }

    let classified = classify_command(&msg.command);
    let previous_votecount = if classified.dirty.votecount {
        live_projection::vote_count_rows(&state.pool, classified.game)
            .await
            .ok()
    } else {
        None
    };
    let thread_after_seq = if classified.dirty.thread {
        live_projection::thread_high_water_seq(&state.pool, classified.game)
            .await
            .ok()
    } else {
        None
    };
    let principal = Principal::authenticated(principal_id);
    let prepared_command = prepare_wire_command(&state, msg.command).await;
    let body = match prepared_command {
        Err(reject) => ServerMsg::Reject(RejectMsg::from(reject)),
        Ok(command) => {
            let _inflight = state.live_projection.inflight_guard(classified.game);
            match commands::handle_idempotent(&state.pool, &principal, msg.command_id, command)
                .await
            {
                Ok(ack) => {
                    state
                        .live_projection
                        .publish(
                            &state.pool,
                            LiveProjectionChangeSet {
                                game: classified.game,
                                previous_vote_counts: previous_votecount,
                                thread_after_seq,
                                thread_dirty: classified.dirty.thread,
                                host_console_dirty: classified.dirty.host_console,
                                host_prompts_dirty: classified.dirty.host_prompts,
                                player_private_dirty: classified.dirty.player_private,
                                player_command_state_dirty: classified.dirty.player_command_state,
                            },
                        )
                        .await;
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
    Json(export): Json<projections::CompletedGameExport>,
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
) -> Result<PrincipalId, ApiError> {
    let token = bearer_token(headers).ok_or_else(unauthorized_session)?;
    Ok(authorization_context(&state.auth, token)
        .await?
        .principal_id)
}

/// The single classification site for wire commands: which game a command
/// targets and which live-projection surfaces it can dirty. Adding a command
/// variant requires exactly one row here; exhaustiveness is compiler-enforced.
struct CommandClassification {
    game: Uuid,
    dirty: DirtySurfaces,
}

#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
struct DirtySurfaces {
    thread: bool,
    host_console: bool,
    host_prompts: bool,
    player_private: bool,
    player_command_state: bool,
    votecount: bool,
}

fn classify_command(command: &wire::Command) -> CommandClassification {
    use wire::Command;
    match command {
        Command::CreateGame { game, .. }
        | Command::AddCohost { game, .. }
        | Command::GrantSpectator { game, .. }
        | Command::RevokeSpectator { game, .. } => CommandClassification {
            game: *game,
            dirty: DirtySurfaces::default(),
        },
        Command::AddSlot { game, .. }
        | Command::SeatPersona { game, .. }
        | Command::RenameGamePersona { game, .. }
        | Command::ExtendDeadline { game, .. }
        | Command::SubmitDayEventParticipation { game, .. }
        | Command::WithdrawDayEventParticipation { game, .. } => CommandClassification {
            game: *game,
            dirty: DirtySurfaces {
                host_console: true,
                ..DirtySurfaces::default()
            },
        },
        Command::AssignRole { game, .. }
        | Command::AddSlotStatusTag { game, .. }
        | Command::RemoveSlotStatusTag { game, .. }
        | Command::StartGame { game, .. }
        | Command::OpenDayPhase { game, .. }
        | Command::AdvancePhase { game }
        | Command::AdvancePhaseByDeadline { game, .. }
        | Command::LockThread { game }
        | Command::UnlockThread { game }
        | Command::CompleteGame { game }
        | Command::SetPostPolicy { game, .. }
        | Command::ControlItaSession { game, .. }
        | Command::AttachDayProgram { game, .. }
        | Command::ScheduleDayEvent { game, .. }
        | Command::OpenDayEvent { game, .. }
        | Command::LockDayEvent { game, .. }
        | Command::CancelDayEvent { game, .. }
        | Command::ProcessReplacement { game, .. } => CommandClassification {
            game: *game,
            dirty: DirtySurfaces {
                host_console: true,
                player_command_state: true,
                ..DirtySurfaces::default()
            },
        },
        Command::SetSlotStatus { game, .. } => CommandClassification {
            game: *game,
            dirty: DirtySurfaces {
                host_console: true,
                host_prompts: true,
                player_command_state: true,
                ..DirtySurfaces::default()
            },
        },
        Command::ResolvePhase { game, .. } => CommandClassification {
            game: *game,
            dirty: DirtySurfaces {
                thread: true,
                host_console: true,
                host_prompts: true,
                player_private: true,
                player_command_state: true,
                votecount: true,
            },
        },
        Command::PublishVotecount { game } => CommandClassification {
            game: *game,
            dirty: DirtySurfaces {
                thread: true,
                host_console: true,
                ..DirtySurfaces::default()
            },
        },
        Command::ResolveHostPrompt { game, .. } => CommandClassification {
            game: *game,
            dirty: DirtySurfaces {
                host_console: true,
                host_prompts: true,
                player_private: true,
                player_command_state: true,
                ..DirtySurfaces::default()
            },
        },
        Command::PublishSpectatorPost { game, .. } | Command::SubmitPost { game, .. } => {
            CommandClassification {
                game: *game,
                dirty: DirtySurfaces {
                    thread: true,
                    ..DirtySurfaces::default()
                },
            }
        }
        Command::SubmitVote { game, .. } | Command::WithdrawVote { game, .. } => {
            CommandClassification {
                game: *game,
                dirty: DirtySurfaces {
                    votecount: true,
                    ..DirtySurfaces::default()
                },
            }
        }
        Command::SubmitAction { game, .. } => CommandClassification {
            game: *game,
            dirty: DirtySurfaces {
                thread: true,
                player_private: true,
                ..DirtySurfaces::default()
            },
        },
        Command::WithdrawAction { game, .. } => CommandClassification {
            game: *game,
            dirty: DirtySurfaces {
                player_private: true,
                ..DirtySurfaces::default()
            },
        },
        Command::ApplyEffectPlan { game, .. } => CommandClassification {
            game: *game,
            dirty: DirtySurfaces {
                host_console: true,
                host_prompts: true,
                player_private: true,
                player_command_state: true,
                votecount: true,
                ..DirtySurfaces::default()
            },
        },
        Command::ResolveDayEvent { game, .. } => CommandClassification {
            game: *game,
            dirty: DirtySurfaces {
                host_console: true,
                player_private: true,
                player_command_state: true,
                ..DirtySurfaces::default()
            },
        },
    }
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
        commands::Reject::PackValidation(_) => StatusCode::BAD_REQUEST,
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
    use super::{classify_command, DirtySurfaces};
    use uuid::Uuid;

    #[test]
    fn host_prompt_resolution_refreshes_player_command_and_outcome_state() {
        let game = Uuid::new_v4();
        let classified = classify_command(&wire::Command::ResolveHostPrompt {
            game,
            prompt_id: "D01:pk:Tie".to_string(),
            decision: wire::HostPromptDecision::SelectSlot {
                slot: "slot-2".to_string(),
            },
        });

        assert_eq!(classified.game, game);
        assert_eq!(
            classified.dirty,
            DirtySurfaces {
                host_console: true,
                host_prompts: true,
                player_private: true,
                player_command_state: true,
                ..DirtySurfaces::default()
            }
        );
    }

    #[test]
    fn effect_plan_routes_and_refreshes_every_state_surface_it_can_change() {
        let game = Uuid::new_v4();
        let classified = classify_command(&wire::Command::ApplyEffectPlan {
            game,
            effects: Vec::new(),
            reason: "classification fixture".to_string(),
        });

        assert_eq!(classified.game, game);
        assert_eq!(
            classified.dirty,
            DirtySurfaces {
                thread: false,
                host_console: true,
                host_prompts: true,
                player_private: true,
                player_command_state: true,
                votecount: true,
            }
        );
    }

    #[test]
    fn votes_dirty_only_votecounts_and_posts_never_dirty_host_console() {
        let vote = classify_command(&wire::Command::SubmitVote {
            game: Uuid::new_v4(),
            actor_slot: "slot-1".to_string(),
            target: wire::VoteTarget::NoLynch,
        });
        assert_eq!(
            vote.dirty,
            DirtySurfaces {
                votecount: true,
                ..DirtySurfaces::default()
            }
        );

        let post = classify_command(&wire::Command::SubmitPost {
            game: Uuid::new_v4(),
            channel_id: "main".to_string(),
            actor_slot: "slot-1".to_string(),
            body: "hi".to_string(),
            media: None,
            quotations: None,
            embed: None,
        });
        assert_eq!(
            post.dirty,
            DirtySurfaces {
                thread: true,
                ..DirtySurfaces::default()
            }
        );
    }
}
