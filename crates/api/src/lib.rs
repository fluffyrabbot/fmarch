//! `api` — the first network boundary over the command pipeline.
//!
//! The command crate remains pre-HTTP. This crate owns HTTP/WebSocket decoding,
//! temporary dev-principal extraction, and mapping command outcomes into `wire`
//! messages.

mod auth_http;
mod authentication;
mod community_http;
pub mod identity_delivery;
mod live_projection;
pub mod mash_scale;
mod media_http;
pub mod program_library;

pub use auth_http::{bootstrap_classic_global_admin, bootstrap_workos_global_admin};
pub use media_http::{MediaUploadResponse, MediaUploadVariant};

use auth_http::{
    authenticate_token, bearer_token, env_i64, hash_session_token, internal_auth_error,
    require_active_enabled_account, require_global_admin, require_global_operator,
    unauthorized_session, unix_now_seconds, AuthHttpState,
};

use authentication::enforce_public_request_limit;
use live_projection::{LiveProjectionChangeSet, LiveProjectionPublisher, LiveProjectionReceive};

use crate::identity_delivery::{IdentityDeliveryError, IdentityDeliveryGateway};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::header::RETRY_AFTER;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use caps::{Capability, Principal};
use identity::AccessTokenVerifier;
use media::{ContentId, MediaRepository, VariantFormat, VariantLimits};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path as FsPath;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;
use wire::{
    AckMsg, CapabilityGrant, ClientEnvelope, DayEventNarrativeDelta, DayEventRoomDelta,
    DayEventSchedulerDelta, DayVoteOutcomeDelta, GameIndexEntry, GameIndexPage, Hello,
    HostConsoleAuthorityDelta, HostConsoleAuthorityKind, HostConsolePhaseStateDelta,
    HostConsoleSlotOccupancyDelta, HostConsoleStateDelta, HostConsoleThreadPostDelta,
    HostDayEventDelta, HostPhaseControl, HostPromptDelta, HostPromptsDelta, HostTaskAllowedCommand,
    HostTaskCommandKind, HostTaskDelta, HostTaskKind, HostTaskState, HostTaskUrgency,
    PlayerInvestigationResult, PlayerInvestigationResultsDelta, PlayerNotification,
    PlayerNotificationsDelta, ProjectionDelta, PublicGameThreadPage, RejectCode, RejectMsg,
    ServerEnvelope, ServerMsg, ThreadPage, ThreadPost, ThreadPostsDelta, PROTOCOL_VERSION,
};

#[derive(Clone)]
pub struct ApiState {
    pool: PgPool,
    auth: AuthHttpState,
    media_store: MediaRepository,
    variant_limits: VariantLimits,
    server_name: String,
    live_projection: LiveProjectionPublisher,
    live_projection_delivery_delay: Duration,
    live_connection_slots: Arc<Semaphore>,
    live_principal_slots: Arc<Mutex<HashMap<String, Arc<Semaphore>>>>,
    live_principal_limit: usize,
    media_slots: Arc<Semaphore>,
    media_account_quota_bytes: i64,
    websocket_poll_interval: Duration,
}

const REGISTRATION_SESSION_TTL_SECONDS: i64 = 60 * 60 * 24 * 7;

impl ApiState {
    pub fn new(pool: PgPool, media_store: impl Into<MediaRepository>) -> Self {
        let live_projection_capacity =
            env_i64("FMARCH_LIVE_PROJECTION_CAPACITY", 256, 1, 65_536) as usize;
        let live_projection_delivery_delay =
            Duration::from_millis(
                env_i64("FMARCH_LIVE_PROJECTION_DELIVERY_DELAY_MS", 0, 0, 60_000) as u64,
            );
        let live_connection_limit = env_i64("FMARCH_WS_MAX_CONNECTIONS", 512, 1, 65_536) as usize;
        let live_principal_limit =
            env_i64("FMARCH_WS_MAX_CONNECTIONS_PER_PRINCIPAL", 4, 1, 128) as usize;
        let auth = AuthHttpState::new(pool.clone());
        ApiState {
            pool,
            auth,
            media_store: media_store.into(),
            variant_limits: VariantLimits::default(),
            server_name: "fmarch-dev".to_string(),
            live_projection: LiveProjectionPublisher::new(live_projection_capacity),
            live_projection_delivery_delay,
            live_connection_slots: Arc::new(Semaphore::new(live_connection_limit)),
            live_principal_slots: Arc::new(Mutex::new(HashMap::new())),
            live_principal_limit,
            media_slots: Arc::new(Semaphore::new(
                env_i64("FMARCH_MEDIA_MAX_IN_FLIGHT", 2, 1, 32) as usize,
            )),
            media_account_quota_bytes: env_i64(
                "FMARCH_MEDIA_ACCOUNT_QUOTA_BYTES",
                256 * 1024 * 1024,
                12 * 1024 * 1024,
                10 * 1024 * 1024 * 1024,
            ),
            websocket_poll_interval: Duration::from_millis(env_i64(
                "FMARCH_WS_POLL_INTERVAL_MS",
                250,
                25,
                5_000,
            ) as u64),
        }
    }

    /// Classic (username + password) sign-in is a first-class method, enabled
    /// by default; a WorkOS-only deployment can switch it off.
    pub fn with_classic_auth(mut self, enabled: bool) -> Self {
        self.auth.classic_enabled = enabled;
        self
    }

    /// Transitional: accept provider JWTs as general request bearers while
    /// clients migrate to the one-time session exchange. Removed once the
    /// frontend exchanges WorkOS tokens for app sessions.
    pub fn with_jwt_bearer_transition(mut self, enabled: bool) -> Self {
        self.auth.allow_jwt_bearer = enabled;
        self
    }

    pub fn with_server_name(mut self, name: impl Into<String>) -> Self {
        self.server_name = name.into();
        self
    }

    pub fn with_dev_auth(mut self, enabled: bool) -> Self {
        self.auth.dev_auth_enabled = enabled;
        self
    }

    pub fn with_variant_limits(mut self, limits: VariantLimits) -> Self {
        self.variant_limits = limits;
        self
    }

    pub fn with_auth_attempt_limits(
        mut self,
        account_max_failures: i32,
        source_max_failures: i32,
        window_seconds: i64,
        lockout_seconds: i64,
        retention_seconds: i64,
    ) -> Self {
        self.auth.auth_attempt_policy.account_max_failures = account_max_failures.clamp(2, 100);
        self.auth.auth_attempt_policy.source_max_failures = source_max_failures.clamp(2, 10_000);
        self.auth.auth_attempt_policy.window_seconds = window_seconds.clamp(1, 86_400);
        self.auth.auth_attempt_policy.lockout_seconds = lockout_seconds.clamp(1, 86_400);
        self.auth.auth_attempt_policy.retention_seconds = retention_seconds.clamp(
            self.auth
                .auth_attempt_policy
                .window_seconds
                .max(self.auth.auth_attempt_policy.lockout_seconds),
            31_536_000,
        );
        self
    }

    pub fn with_trusted_auth_attempt_source_header(mut self, trusted: bool) -> Self {
        self.auth.auth_attempt_policy.trust_source_header = trusted;
        self
    }

    pub fn with_identity_delivery_gateway(
        mut self,
        gateway: Arc<dyn IdentityDeliveryGateway>,
    ) -> Self {
        self.auth.identity_delivery_gateway = gateway;
        self
    }

    pub fn with_registration_source_limit(mut self, max_registrations: i32) -> Self {
        self.auth.auth_attempt_policy.registration_max_per_source =
            max_registrations.clamp(2, 10_000);
        self
    }

    pub fn with_live_projection_capacity(mut self, capacity: usize) -> Self {
        self.live_projection = LiveProjectionPublisher::new(capacity);
        self
    }

    pub fn with_live_projection_delivery_delay(mut self, delay: Duration) -> Self {
        self.live_projection_delivery_delay = delay.min(Duration::from_secs(60));
        self
    }

    pub fn with_live_connection_limit(mut self, limit: usize) -> Self {
        self.live_connection_slots = Arc::new(Semaphore::new(limit.clamp(1, 65_536)));
        self
    }

    pub fn with_password_limit(mut self, limit: usize) -> Self {
        self.auth.password_slots = Arc::new(Semaphore::new(limit.clamp(1, 64)));
        self
    }

    pub fn with_media_limit(mut self, limit: usize) -> Self {
        self.media_slots = Arc::new(Semaphore::new(limit.clamp(1, 32)));
        self
    }

    pub fn with_websocket_audience(mut self, audience: impl Into<String>) -> Self {
        self.auth.websocket_audience = audience.into();
        self
    }

    pub fn with_websocket_ticket_ttl(mut self, ttl: Duration) -> Self {
        self.auth.websocket_ticket_ttl =
            ttl.clamp(Duration::from_secs(1), Duration::from_secs(120));
        self
    }

    pub fn with_websocket_poll_interval(mut self, interval: Duration) -> Self {
        self.websocket_poll_interval =
            interval.clamp(Duration::from_millis(10), Duration::from_secs(5));
        self
    }

    pub fn with_access_token_verifier(mut self, verifier: Arc<dyn AccessTokenVerifier>) -> Self {
        self.auth.access_token_verifier = Some(verifier);
        self
    }

    pub fn uses_external_identity(&self) -> bool {
        self.auth.access_token_verifier.is_some()
    }
}

pub fn router(pool: PgPool, media_store: impl Into<MediaRepository>) -> Router {
    router_with_state(ApiState::new(pool, media_store))
}

pub fn router_with_state(state: ApiState) -> Router {
    let media_routes = media_http::routes(&state);
    let auth_routes = auth_http::routes(&state);
    let community_routes = community_http::routes(&state);
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/auth/websocket-tickets", post(create_websocket_ticket))
        .route("/commands", post(command))
        .route("/admin/games", get(admin_game_index))
        .route("/admin/game-bootstrap", get(admin_game_bootstrap))
        .route("/games", get(game_index))
        .route("/games/{game}", get(public_game_thread))
        .route("/games/import", post(import_completed_game_export))
        .route("/games/{game}/votecount", get(votecount))
        .route("/games/{game}/day-vote-outcomes", get(day_vote_outcomes))
        .route("/games/{game}/endgame-summary", get(endgame_summary))
        .route("/games/{game}/export", get(completed_game_export))
        .route("/games/{game}/thread", get(thread_view))
        .route(
            "/games/{game}/channels/{channel}/thread",
            get(channel_thread_view),
        )
        .route("/games/{game}/notifications", get(player_notifications))
        .route(
            "/games/{game}/investigation-results",
            get(player_investigation_results),
        )
        .route(
            "/games/{game}/player-command-state",
            get(player_command_state),
        )
        .route(
            "/games/{game}/host-phase-controls",
            get(host_phase_controls),
        )
        .route("/games/{game}/host-prompts", get(host_prompts))
        .route("/games/{game}/host-console-state", get(host_console_state))
        .route("/games/{game}/setup-state", get(host_setup_state))
        .route("/ws", get(ws));
    let app = app
        .merge(media_routes)
        .merge(auth_routes)
        .merge(community_routes);
    app.with_state(state)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Health {
    pub ok: bool,
}

async fn healthz() -> Json<Health> {
    Json(Health { ok: true })
}

fn acquire_workload_slot(
    slots: &Arc<Semaphore>,
    message: &'static str,
) -> Result<OwnedSemaphorePermit, ApiError> {
    slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::Unavailable {
            retry_after_seconds: 1,
            message: message.to_string(),
        })
}

enum PostMediaPreparationError {
    Invalid,
    Store,
    Invariant,
}

async fn prepare_wire_command(
    state: &ApiState,
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
    state: &ApiState,
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
    State(state): State<ApiState>,
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

async fn votecount(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
) -> Result<Json<Vec<ProjectionDelta>>, ApiError> {
    Ok(Json(current_votecount_deltas(&state, game).await?))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EndgameSummaryResponse {
    pub game: Uuid,
    pub completed: bool,
    pub winner: Option<EndgameWinner>,
    pub slots: Vec<EndgameSlotReveal>,
    pub vote_history: Vec<EndgameDayVote>,
    pub boundary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EndgameWinner {
    pub alignment: String,
    pub reason: String,
    pub phase_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EndgameSlotReveal {
    pub slot_id: String,
    pub alive: bool,
    pub status: String,
    pub role_key: Option<String>,
    pub alignment: Option<String>,
    pub role_revealed: bool,
    pub alignment_revealed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EndgameDayVote {
    pub phase_id: String,
    pub source_seq: i64,
    pub event_index: i32,
    pub status: String,
    pub winner_slot: Option<String>,
    pub tallies: serde_json::Value,
    pub votes: serde_json::Value,
    pub majority: Option<f64>,
    pub reason: Option<String>,
}

/// Public game read in the votecount access class. Role and alignment facts
/// are gated per-slot by the projection's reveal flags, so mid-game death
/// flips honor pack death_reveal policy and full reveal arrives only when
/// GameCompleted/WinReached fold the flip.
async fn endgame_summary(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
) -> Result<Json<EndgameSummaryResponse>, ApiError> {
    let completed = commands::game_completed(&state.pool, game)
        .await
        .map_err(command_reject_api_error)?;
    let result = projections::game_result(&state.pool, game).await?;
    let vote_history = if completed {
        projections::day_vote_outcomes(&state.pool, game)
            .await?
            .into_iter()
            .map(|outcome| EndgameDayVote {
                phase_id: outcome.phase_id,
                source_seq: outcome.source_seq,
                event_index: outcome.event_index,
                status: outcome.status,
                winner_slot: outcome.winner_slot,
                tallies: outcome.tallies,
                votes: outcome.votes,
                majority: outcome.majority,
                reason: outcome.reason,
            })
            .collect()
    } else {
        Vec::new()
    };
    let slots = projections::slot_state(&state.pool, game)
        .await?
        .into_iter()
        .map(|slot| EndgameSlotReveal {
            slot_id: slot.slot_id,
            alive: slot.alive,
            status: slot.status,
            role_key: if slot.role_revealed {
                slot.role_key
            } else {
                None
            },
            alignment: if slot.alignment_revealed {
                slot.alignment
            } else {
                None
            },
            role_revealed: slot.role_revealed,
            alignment_revealed: slot.alignment_revealed,
        })
        .collect();
    Ok(Json(EndgameSummaryResponse {
        game,
        completed,
        winner: result.map(|row| EndgameWinner {
            alignment: row.winner,
            reason: row.reason,
            phase_id: row.phase_id,
        }),
        slots,
        vote_history,
        boundary: "Endgame summary is reveal-gated: per-slot role and alignment appear only \
                   after the projection's reveal flags flip (death_reveal policy mid-game, \
                   GameCompleted/WinReached at the end). Per-day vote history appears only \
                   after GameCompleted. The winner fact is folded from the engine's terminal \
                   WinReached."
            .to_string(),
    }))
}

async fn completed_game_export(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<LegacyPrincipalQuery>,
    headers: HeaderMap,
) -> Result<Json<eventstore::StreamExport>, ApiError> {
    let principal_user_id =
        authenticated_or_dev_query_principal(&state, &headers, query.principal_user_id.as_deref())
            .await?;
    let capabilities =
        caps::resolve(&state.pool, &Principal::user(principal_user_id), game).await?;
    if !capabilities.grants(&Capability::CohostOf(game)) {
        return Err(ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: "completed-game export requires HostOf(game) or CohostOf(game)".to_string(),
        });
    }
    Ok(Json(
        projections::export_completed_game(&state.pool, game).await?,
    ))
}

async fn import_completed_game_export(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(export): Json<eventstore::StreamExport>,
) -> Result<Json<projections::ProjectionAuditReport>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    require_global_admin(&state.auth, token, "completed-game import").await?;
    Ok(Json(
        projections::import_completed_game_export(&state.pool, &export).await?,
    ))
}

async fn current_votecount_deltas(
    state: &ApiState,
    game: Uuid,
) -> Result<Vec<ProjectionDelta>, projections::ProjectionError> {
    live_projection::vote_count_deltas(&state.pool, game).await
}

async fn day_vote_outcomes(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
) -> Result<Json<Vec<ProjectionDelta>>, ApiError> {
    let rows = projections::day_vote_outcomes(&state.pool, game).await?;
    Ok(Json(
        rows.into_iter()
            .map(DayVoteOutcomeDelta::from)
            .map(ProjectionDelta::DayVoteOutcomeApplied)
            .collect(),
    ))
}

#[derive(Debug, Clone, Deserialize)]
struct ThreadQuery {
    before_seq: Option<i64>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct GameIndexQuery {
    cursor: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct AdminGameBootstrapResponse {
    packs: Vec<AdminGameBootstrapPack>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct AdminGameBootstrapPack {
    key: String,
    name: String,
}

async fn game_index(
    State(state): State<ApiState>,
    Query(query): Query<GameIndexQuery>,
) -> Result<Json<GameIndexPage>, ApiError> {
    let cursor = query
        .cursor
        .as_deref()
        .map(parse_game_index_cursor)
        .transpose()?;
    Ok(Json(
        projections::game_index(&state.pool, cursor, query.limit.unwrap_or(12))
            .await?
            .into(),
    ))
}

async fn admin_game_index(
    State(state): State<ApiState>,
    Query(query): Query<GameIndexQuery>,
    headers: HeaderMap,
) -> Result<Json<GameIndexPage>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    require_global_operator(&state.auth, token, "admin game discovery").await?;
    let cursor = query
        .cursor
        .as_deref()
        .map(parse_game_index_cursor)
        .transpose()?;
    Ok(Json(
        projections::operator_game_index(&state.pool, cursor, query.limit.unwrap_or(100))
            .await?
            .into(),
    ))
}

async fn admin_game_bootstrap(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> Result<Json<AdminGameBootstrapResponse>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    require_global_admin(&state.auth, token, "game bootstrap").await?;
    Ok(Json(AdminGameBootstrapResponse {
        packs: product_pack_catalog()?,
    }))
}

async fn public_game_thread(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<ThreadQuery>,
    headers: HeaderMap,
) -> Result<Json<PublicGameThreadPage>, ApiError> {
    let viewer_principal_user_id =
        community_http::optional_authenticated_community_member(&state.auth, &headers).await?;
    let game_row = projections::public_game_by_id(&state.pool, game)
        .await?
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::UnknownGame,
            message: "public game was not found".to_string(),
        })?;
    let page = projections::public_thread_view(
        &state.pool,
        game,
        query.before_seq,
        query.limit.unwrap_or(50),
        viewer_principal_user_id.as_deref(),
    )
    .await?;
    Ok(Json(PublicGameThreadPage {
        game: GameIndexEntry::from(game_row),
        posts: page.posts.into_iter().map(ThreadPost::from).collect(),
        next_before_seq: page.next_before_seq,
    }))
}

fn parse_game_index_cursor(value: &str) -> Result<projections::GameIndexCursor, ApiError> {
    let (updated_seq, game_id) = value.split_once(':').ok_or_else(|| ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::StreamConflict,
        message: "invalid game index cursor; refresh the board and try again".to_string(),
    })?;
    let updated_seq = updated_seq.parse::<i64>().map_err(|_| ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::StreamConflict,
        message: "invalid game index cursor; refresh the board and try again".to_string(),
    })?;
    let game_id = Uuid::parse_str(game_id).map_err(|_| ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::StreamConflict,
        message: "invalid game index cursor; refresh the board and try again".to_string(),
    })?;
    Ok(projections::GameIndexCursor {
        updated_seq,
        game_id,
    })
}

#[derive(Debug, Clone, Deserialize)]
struct ChannelThreadQuery {
    before_seq: Option<i64>,
    limit: Option<i64>,
    #[serde(default)]
    principal_user_id: Option<String>,
}

async fn thread_view(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<ThreadQuery>,
) -> Result<Json<ThreadPage>, ApiError> {
    let page = projections::thread_view(
        &state.pool,
        game,
        query.before_seq,
        query.limit.unwrap_or(50),
    )
    .await?;
    Ok(Json(ThreadPage::from(page)))
}

async fn channel_thread_view(
    State(state): State<ApiState>,
    Path((game, channel)): Path<(Uuid, String)>,
    Query(query): Query<ChannelThreadQuery>,
    headers: HeaderMap,
) -> Result<Json<ThreadPage>, ApiError> {
    if channel != "main" {
        let principal_user_id = authenticated_or_dev_query_principal(
            &state,
            &headers,
            query.principal_user_id.as_deref(),
        )
        .await?;
        require_channel_thread_access(
            &state,
            game,
            channel.as_str(),
            Some(principal_user_id.as_str()),
        )
        .await?;
    }

    let page = projections::thread_view_for_channel(
        &state.pool,
        game,
        channel.as_str(),
        query.before_seq,
        query.limit.unwrap_or(50),
    )
    .await?;
    Ok(Json(ThreadPage::from(page)))
}

async fn current_thread_posts_delta(
    state: &ApiState,
    game: Uuid,
    channel: &str,
) -> Result<ProjectionDelta, projections::ProjectionError> {
    let page = projections::thread_view_for_channel(&state.pool, game, channel, None, 50).await?;
    Ok(ProjectionDelta::ThreadPostsChanged(ThreadPostsDelta {
        game,
        posts: page.posts.into_iter().map(ThreadPost::from).collect(),
    }))
}

async fn require_channel_thread_access(
    state: &ApiState,
    game: Uuid,
    channel: &str,
    principal_user_id: Option<&str>,
) -> Result<(), ApiError> {
    let Some(principal_user_id) = principal_user_id else {
        return Err(ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: "principal cannot read channel thread for this game".to_string(),
        });
    };

    let caps = caps::resolve(&state.pool, &Principal::user(principal_user_id), game).await?;
    let channel_cap = Capability::ChannelMember(channel.to_string());
    let dead_channel_cap = Capability::DeadViewer(game);
    let spectator_channel_cap = Capability::SpectatorOf(game);
    if caps.grants(&Capability::HostOf(game))
        || caps.grants(&Capability::CohostOf(game))
        || caps.grants(&channel_cap)
        || (channel == "dead" && caps.grants(&dead_channel_cap))
        || (channel == "spectator" && caps.grants(&spectator_channel_cap))
    {
        return Ok(());
    }

    Err(ApiError::Reject {
        status: StatusCode::FORBIDDEN,
        error: RejectCode::NotAuthorized,
        message: "principal cannot read channel thread for this game".to_string(),
    })
}

async fn player_notifications(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<LegacyPrincipalQuery>,
    headers: HeaderMap,
) -> Result<Json<Vec<PlayerNotification>>, ApiError> {
    let principal_user_id =
        authenticated_or_dev_query_principal(&state, &headers, query.principal_user_id.as_deref())
            .await?;
    Ok(Json(
        player_notifications_for_principal(&state, game, principal_user_id.as_str()).await?,
    ))
}

async fn player_investigation_results(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<LegacyPrincipalQuery>,
    headers: HeaderMap,
) -> Result<Json<Vec<PlayerInvestigationResult>>, ApiError> {
    let principal_user_id =
        authenticated_or_dev_query_principal(&state, &headers, query.principal_user_id.as_deref())
            .await?;
    Ok(Json(
        player_investigation_results_for_principal(&state, game, principal_user_id.as_str())
            .await?,
    ))
}

async fn player_notifications_for_principal(
    state: &ApiState,
    game: Uuid,
    principal_user_id: &str,
) -> Result<Vec<PlayerNotification>, ApiError> {
    let caps = caps::resolve(&state.pool, &Principal::user(principal_user_id), game).await?;
    let rows = if caps.grants(&Capability::CohostOf(game)) {
        projections::player_notifications(&state.pool, game).await?
    } else {
        let mut rows = Vec::new();
        let mut has_readable_slot = false;
        for cap in caps.iter() {
            let Capability::SlotOccupant(slot) = cap else {
                continue;
            };
            has_readable_slot = true;
            rows.extend(projections::player_notifications_for_slot(&state.pool, game, slot).await?);
        }
        if !has_readable_slot {
            return Err(ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "principal cannot read player notifications for this game".to_string(),
            });
        }
        rows
    };

    Ok(rows.into_iter().map(PlayerNotification::from).collect())
}

async fn player_investigation_results_for_principal(
    state: &ApiState,
    game: Uuid,
    principal_user_id: &str,
) -> Result<Vec<PlayerInvestigationResult>, ApiError> {
    let caps = caps::resolve(&state.pool, &Principal::user(principal_user_id), game).await?;
    let rows = if caps.grants(&Capability::CohostOf(game)) {
        projections::player_investigation_results(&state.pool, game).await?
    } else {
        let mut rows = Vec::new();
        let mut has_readable_slot = false;
        for cap in caps.iter() {
            let Capability::SlotOccupant(slot) = cap else {
                continue;
            };
            has_readable_slot = true;
            rows.extend(
                projections::player_investigation_results_for_slot(&state.pool, game, slot).await?,
            );
        }
        if !has_readable_slot {
            return Err(ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "principal cannot read investigation results for this game".to_string(),
            });
        }
        rows
    };

    Ok(rows
        .into_iter()
        .map(PlayerInvestigationResult::from)
        .collect())
}

#[derive(Debug, Clone, Deserialize)]
struct PlayerCommandStateQuery {
    #[serde(default)]
    principal_user_id: Option<String>,
    #[serde(default)]
    slot_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerCommandStateResponse {
    pub game: Uuid,
    pub actor_slot: Option<String>,
    pub actor_alive: bool,
    pub actor_status: String,
    pub role_key: Option<String>,
    pub role: Option<PlayerCommandRoleView>,
    pub game_completed: bool,
    pub phase: Option<PlayerCommandPhaseState>,
    pub actions: Vec<PlayerCommandAction>,
    pub current_actions: Vec<PlayerCommandCurrentAction>,
    pub vote_targets: Vec<PlayerVoteTarget>,
    pub current_vote: Option<PlayerVoteTarget>,
    /// At most one attention item per open DayEvent the slot can act on.
    pub day_events: Vec<PlayerDayEventAttention>,
    /// Self-scoped private DayEvent rooms for the current slot. Locked and
    /// terminal rooms remain visible as read-only history while membership is
    /// retained; revoked rooms disappear from this projection immediately.
    pub day_event_rooms: Vec<DayEventRoomDelta>,
    pub boundary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerCommandPhaseState {
    pub phase_id: String,
    pub phase_kind: String,
    pub phase_number: u32,
    pub locked: bool,
    pub deadline: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerCommandRoleView {
    pub key: String,
    pub alignment: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerCommandAction {
    pub source: String,
    pub template_id: String,
    pub ability: String,
    pub window: String,
    pub label: String,
    pub detail: String,
    pub targets: Vec<String>,
    pub target_options: Vec<String>,
    pub grant_id: Option<String>,
}

/// A night action the actor has already submitted this phase (and may withdraw).
/// Additive to the command-state read: the client renders the current pick and,
/// carrying `action_id`, can build a `WithdrawAction`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerCommandCurrentAction {
    pub action_id: String,
    pub template_id: String,
    pub targets: Vec<String>,
    pub grant_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerVoteTarget {
    pub kind: String,
    pub slot_id: Option<String>,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerDayEventAttention {
    pub event_id: String,
    pub template_key: String,
    pub phase_id: String,
    pub participation_status: String,
    pub participant_count: u32,
    pub minimum_participants: u32,
    pub maximum_participants: Option<u32>,
    pub reward_keys: Vec<String>,
    pub can_submit: bool,
    pub can_withdraw: bool,
}

async fn player_command_state(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<PlayerCommandStateQuery>,
    headers: HeaderMap,
) -> Result<Json<PlayerCommandStateResponse>, ApiError> {
    let principal_user_id =
        authenticated_or_dev_query_principal(&state, &headers, query.principal_user_id.as_deref())
            .await?;
    let caps = caps::resolve(
        &state.pool,
        &Principal::user(principal_user_id.as_str()),
        game,
    )
    .await?;
    let actor_slot = match query.slot_id {
        Some(slot) if caps.grants(&Capability::SlotOccupant(slot.clone())) => slot,
        Some(_) => {
            return Err(ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotYourSlot,
                message: "principal cannot act as requested slot".to_string(),
            });
        }
        None => caps
            .iter()
            .find_map(|cap| match cap {
                Capability::SlotOccupant(slot) => Some(slot.clone()),
                _ => None,
            })
            .ok_or_else(|| ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "principal cannot read player command state for this game".to_string(),
            })?,
    };

    let phase = projections::phase_state(&state.pool, game).await?;
    let slots = projections::slot_state(&state.pool, game).await?;
    let actor = slots
        .iter()
        .find(|slot| slot.slot_id == actor_slot)
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::UnknownSlot,
            message: "actor slot does not exist in this game".to_string(),
        })?;
    let role_key = actor.role_key.clone();
    let role = match role_key.as_deref() {
        Some(key) => player_role_view(&state, game, key).await,
        None => None,
    };
    let game_completed = commands::game_completed(&state.pool, game)
        .await
        .map_err(command_reject_api_error)?;
    let phase_view = phase
        .as_ref()
        .and_then(|phase| player_phase_state(phase).ok());
    let current_vote = match phase.as_ref() {
        Some(phase) if actor.alive && !game_completed => {
            current_player_vote(&state, game, &phase.phase_id, &actor.slot_id).await?
        }
        _ => None,
    };
    let vote_targets = if actor.alive && !game_completed {
        match phase.as_ref() {
            Some(phase)
                if !phase.locked
                    && phase_kind_for_id(&phase.phase_id)? == domain::pack::PhaseKind::Day =>
            {
                available_vote_targets(&state, game, &slots, actor).await?
            }
            _ => Vec::new(),
        }
    } else {
        Vec::new()
    };
    let (actions, current_actions) = if actor.alive && !game_completed {
        match (phase.as_ref(), role_key.as_deref()) {
            (Some(phase), Some(role_key)) if !phase.locked => {
                // One stream fold, two outputs: the templates still open to submit
                // (filtered by available_role_actions) and the actions already
                // submitted this phase (rendered as current_actions, withdrawable).
                let submitted = commands::active_actions_view_for_actor_phase(
                    &state.pool,
                    game,
                    &phase.phase_id,
                    &actor.slot_id,
                )
                .await
                .map_err(command_reject_api_error)?;
                let active_templates: BTreeSet<String> = submitted
                    .iter()
                    .map(|action| action.template_id.clone())
                    .collect();
                let actions = available_role_actions(
                    &state,
                    game,
                    phase,
                    &slots,
                    actor,
                    role_key,
                    &active_templates,
                )
                .await?;
                let current_actions = submitted
                    .into_iter()
                    .map(|action| PlayerCommandCurrentAction {
                        action_id: action.action_id,
                        template_id: action.template_id,
                        targets: action.targets,
                        grant_id: action.grant_id,
                    })
                    .collect();
                (actions, current_actions)
            }
            _ => (Vec::new(), Vec::new()),
        }
    } else {
        (Vec::new(), Vec::new())
    };
    let day_event_workspace =
        load_player_day_event_workspace(&state.pool, game, actor, game_completed).await?;

    Ok(Json(PlayerCommandStateResponse {
        game,
        actor_slot: Some(actor_slot),
        actor_alive: actor.alive,
        actor_status: actor.status.clone(),
        role_key,
        role,
        game_completed,
        phase: phase_view,
        actions,
        current_actions,
        vote_targets,
        current_vote,
        day_events: day_event_workspace.attention,
        day_event_rooms: day_event_workspace.rooms,
        boundary: if game_completed {
            "The game is complete; role actions, votes, and posts are closed while final role and alignment facts are public.".to_string()
        } else {
            "Role-action availability is derived from committed phase_state, slot_state, the actor role in the game pack, and conservative target candidates. Final command validation still happens at /commands.".to_string()
        },
    }))
}

/// Reusable authority-checked DayEvent attention read for local proof and
/// non-HTTP adapters. The returned items are assembled by the same function as
/// the player command-state handler.
pub async fn load_player_day_event_attention_for_principal(
    pool: &PgPool,
    game: Uuid,
    principal_user_id: &str,
    requested_slot: Option<&str>,
) -> Result<Vec<PlayerDayEventAttention>, ApiError> {
    let caps = caps::resolve(pool, &Principal::user(principal_user_id), game).await?;
    let actor_slot = match requested_slot {
        Some(slot) if caps.grants(&Capability::SlotOccupant(slot.to_string())) => slot.to_string(),
        Some(_) => {
            return Err(ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotYourSlot,
                message: "principal cannot act as requested slot".to_string(),
            });
        }
        None => caps
            .iter()
            .find_map(|cap| match cap {
                Capability::SlotOccupant(slot) => Some(slot.clone()),
                _ => None,
            })
            .ok_or_else(|| ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "principal cannot read player command state for this game".to_string(),
            })?,
    };
    let slots = projections::slot_state(pool, game).await?;
    let actor = slots
        .iter()
        .find(|slot| slot.slot_id == actor_slot)
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::UnknownSlot,
            message: "actor slot does not exist in this game".to_string(),
        })?;
    let game_completed = commands::game_completed(pool, game)
        .await
        .map_err(command_reject_api_error)?;
    Ok(
        load_player_day_event_workspace(pool, game, actor, game_completed)
            .await?
            .attention,
    )
}

struct PlayerDayEventWorkspace {
    attention: Vec<PlayerDayEventAttention>,
    rooms: Vec<DayEventRoomDelta>,
}

async fn load_player_day_event_workspace(
    pool: &PgPool,
    game: Uuid,
    actor: &projections::SlotStateRow,
    game_completed: bool,
) -> Result<PlayerDayEventWorkspace, ApiError> {
    let event_rows = projections::day_events(pool, game).await?;
    let participation = projections::day_event_participation_for_game(pool, game).await?;
    let private_members = projections::private_channel_members(pool, game).await?;
    let mut attention = Vec::new();
    let mut rooms = Vec::new();

    for event in &event_rows {
        if let Some(room) = day_event_room_delta(event, &private_members) {
            if private_members.iter().any(|member| {
                member.channel_id == room.channel_id && member.slot_id == actor.slot_id
            }) {
                rooms.push(DayEventRoomDelta {
                    posting_allowed: room.posting_allowed && !game_completed,
                    ..room
                });
            }
        }

        if game_completed || event.state != "open" {
            continue;
        }
        let eligible = match event.definition.participation.who {
            game_platform::ParticipantFilter::AliveSlots => actor.alive,
            game_platform::ParticipantFilter::AllOccupied => true,
            game_platform::ParticipantFilter::HostInvited
            | game_platform::ParticipantFilter::ChannelMembers => false,
        };
        if !eligible {
            continue;
        }
        let event_participation = participation
            .iter()
            .filter(|row| row.event_id == event.event_id)
            .collect::<Vec<_>>();
        let submitted = event_participation
            .iter()
            .any(|row| row.actor_slot == actor.slot_id);
        let at_capacity = event
            .definition
            .participation
            .limits
            .maximum
            .is_some_and(|maximum| event_participation.len() >= maximum as usize);
        attention.push(PlayerDayEventAttention {
            event_id: event.event_id.clone(),
            template_key: event.definition.template_key.as_str().to_string(),
            phase_id: event.phase_id.clone().unwrap_or_default(),
            participation_status: if submitted {
                "submitted".to_string()
            } else {
                "available".to_string()
            },
            participant_count: event_participation.len() as u32,
            minimum_participants: event.definition.participation.limits.minimum,
            maximum_participants: event.definition.participation.limits.maximum,
            reward_keys: event
                .definition
                .rewards
                .iter()
                .map(|reward| reward.reward_key.as_str().to_string())
                .collect(),
            can_submit: !submitted && !at_capacity,
            can_withdraw: submitted,
        });
    }
    Ok(PlayerDayEventWorkspace { attention, rooms })
}

fn day_event_room_delta(
    event: &projections::DayEventRow,
    private_members: &[projections::PrivateChannelMemberRow],
) -> Option<DayEventRoomDelta> {
    let membership = event.definition.channel_policy.membership()?;
    let channel_id = event
        .definition
        .channel_policy
        .channel_id(&event.definition.id)
        .to_string();
    Some(DayEventRoomDelta {
        event_id: event.event_id.clone(),
        channel_id: channel_id.clone(),
        template_key: event.definition.template_key.as_str().to_string(),
        state: event.state.clone(),
        membership,
        member_count: private_members
            .iter()
            .filter(|member| member.channel_id == channel_id)
            .count() as u32,
        posting_allowed: event.state == "open",
    })
}

/// Self-scoped role identity for the requesting SlotOccupant. Reads only the
/// actor's own pack role; a missing pack or unknown role key degrades to None
/// rather than failing the whole command-state read.
async fn player_role_view(
    state: &ApiState,
    game: Uuid,
    role_key: &str,
) -> Option<PlayerCommandRoleView> {
    let pack = load_pack_for_game(state, game).await.ok()?;
    let role = pack.roles.get(role_key)?;
    Some(PlayerCommandRoleView {
        key: role_key.to_string(),
        alignment: role.alignment.clone(),
        description: role.description.clone(),
    })
}

async fn available_vote_targets(
    state: &ApiState,
    game: Uuid,
    slots: &[projections::SlotStateRow],
    actor: &projections::SlotStateRow,
) -> Result<Vec<PlayerVoteTarget>, ApiError> {
    let pack = load_pack_for_game(state, game).await?;
    let mut targets: Vec<PlayerVoteTarget> = slots
        .iter()
        .filter(|slot| slot.alive)
        .filter(|slot| pack.vote.self_vote_allowed || slot.slot_id != actor.slot_id)
        .map(|slot| PlayerVoteTarget {
            kind: "slot".to_string(),
            slot_id: Some(slot.slot_id.clone()),
            label: slot_label(&slot.slot_id),
        })
        .collect();
    targets.sort_by(|a, b| {
        slot_sort_key(a.slot_id.as_deref().unwrap_or_default())
            .cmp(&slot_sort_key(b.slot_id.as_deref().unwrap_or_default()))
    });
    if pack.vote.no_lynch_allowed {
        targets.push(PlayerVoteTarget {
            kind: "no_lynch".to_string(),
            slot_id: None,
            label: "No lynch".to_string(),
        });
    }
    Ok(targets)
}

async fn current_player_vote(
    state: &ApiState,
    game: Uuid,
    phase_id: &str,
    actor_slot: &str,
) -> Result<Option<PlayerVoteTarget>, ApiError> {
    let ballot = projections::current_ballot(&state.pool, game, phase_id, actor_slot).await?;
    Ok(ballot.map(|row| player_vote_target_from_projection_target(&row.target)))
}

fn player_vote_target_from_projection_target(target: &str) -> PlayerVoteTarget {
    if target == "no_lynch" {
        PlayerVoteTarget {
            kind: "no_lynch".to_string(),
            slot_id: None,
            label: "No lynch".to_string(),
        }
    } else {
        PlayerVoteTarget {
            kind: "slot".to_string(),
            slot_id: Some(target.to_string()),
            label: slot_label(target),
        }
    }
}

async fn available_role_actions(
    state: &ApiState,
    game: Uuid,
    phase: &projections::PhaseStateRow,
    slots: &[projections::SlotStateRow],
    actor: &projections::SlotStateRow,
    role_key: &str,
    active_templates: &std::collections::BTreeSet<String>,
) -> Result<Vec<PlayerCommandAction>, ApiError> {
    let pack = load_pack_for_game(state, game).await?;
    let role = pack.roles.get(role_key).ok_or_else(|| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: format!("role `{role_key}` is missing from game pack {}", pack.name),
    })?;
    let phase_kind = phase_kind_for_id(phase.phase_id.as_str())?;

    Ok(role
        .actions
        .iter()
        .filter(|action| action.window.matches_phase_kind(phase_kind))
        .filter(|action| {
            action.has_modifier(domain::Modifier::Simultaneous)
                || !active_templates.contains(&action.id)
        })
        .filter_map(|action| {
            let target_options = target_options_for_action(action, slots, actor);
            let targets = default_targets_for_action(action, &target_options)?;
            Some(PlayerCommandAction {
                source: "role".to_string(),
                template_id: action.id.clone(),
                ability: format!("{:?}", action.ability),
                window: format!("{:?}", action.window),
                label: action_label(action),
                detail: action_detail(action, &targets),
                targets,
                target_options,
                grant_id: None,
            })
        })
        .collect())
}

/// Canonical candidate ordering: sort by the trailing slot ordinal (so `slot_10`
/// sorts after `slot_2`), separator-agnostic, with the raw id as a stable
/// tiebreak. `slot_state` returns rows `ORDER BY slot_id`, which is
/// Postgres-collation dependent for raw TEXT ids; sorting candidates here makes
/// the default target (`target_options.first()` and the first vote candidate)
/// deterministic across environments regardless of hyphen/underscore separators.
fn slot_sort_key(slot_id: &str) -> (u64, &str) {
    let ordinal = slot_id
        .rsplit(['-', '_'])
        .next()
        .and_then(|tail| tail.parse::<u64>().ok())
        .unwrap_or(u64::MAX);
    (ordinal, slot_id)
}

fn target_options_for_action(
    action: &domain::pack::ActionTemplate,
    slots: &[projections::SlotStateRow],
    actor: &projections::SlotStateRow,
) -> Vec<String> {
    if action.targets == domain::pack::TargetSpec::None {
        return Vec::new();
    }
    let target_state = action
        .constraints
        .target_state
        .unwrap_or(domain::pack::TargetState::Alive);
    let mut options: Vec<String> = slots
        .iter()
        .filter(|slot| {
            if !action.constraints.self_allowed && slot.slot_id == actor.slot_id {
                return false;
            }
            match target_state {
                domain::pack::TargetState::Any => true,
                domain::pack::TargetState::Alive => slot.alive,
                domain::pack::TargetState::Dead => !slot.alive,
            }
        })
        .map(|slot| slot.slot_id.clone())
        .collect();
    options.sort_by(|a, b| slot_sort_key(a).cmp(&slot_sort_key(b)));
    options
}

fn default_targets_for_action(
    action: &domain::pack::ActionTemplate,
    target_options: &[String],
) -> Option<Vec<String>> {
    match action.targets {
        domain::pack::TargetSpec::None => Some(Vec::new()),
        domain::pack::TargetSpec::One => target_options.first().cloned().map(|target| vec![target]),
        domain::pack::TargetSpec::Many | domain::pack::TargetSpec::Group => {
            if target_options.is_empty() {
                None
            } else {
                Some(
                    target_options
                        .iter()
                        .take(action.constraints.max_targets as usize)
                        .cloned()
                        .collect(),
                )
            }
        }
    }
}

fn action_label(action: &domain::pack::ActionTemplate) -> String {
    let action_name = action.id.replace('_', " ");
    match action.ability {
        domain::IrAbility::Kill => format!("Submit {action_name}"),
        domain::IrAbility::Protect => format!("Submit {action_name}"),
        domain::IrAbility::Investigate => format!("Submit {action_name}"),
        _ => format!("Submit {action_name}"),
    }
}

fn slot_label(slot_id: &str) -> String {
    let suffix: String = slot_id.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if suffix.is_empty() {
        slot_id.to_string()
    } else {
        format!("Slot {suffix}")
    }
}

fn action_detail(action: &domain::pack::ActionTemplate, targets: &[String]) -> String {
    if targets.is_empty() {
        action.id.clone()
    } else {
        format!("{} -> {}", action.id, targets.join(", "))
    }
}

fn player_phase_state(
    phase: &projections::PhaseStateRow,
) -> Result<PlayerCommandPhaseState, ApiError> {
    let phase_kind = phase_kind_for_id(phase.phase_id.as_str())?;
    Ok(PlayerCommandPhaseState {
        phase_id: phase.phase_id.clone(),
        phase_kind: format!("{:?}", phase_kind),
        phase_number: phase_number_for_id(phase.phase_id.as_str())?,
        locked: phase.locked,
        deadline: phase.deadline,
    })
}

fn phase_kind_for_id(phase_id: &str) -> Result<domain::pack::PhaseKind, ApiError> {
    match phase_id.chars().next() {
        Some('D') => Ok(domain::pack::PhaseKind::Day),
        Some('N') => Ok(domain::pack::PhaseKind::Night),
        Some('T') => Ok(domain::pack::PhaseKind::Twilight),
        _ => Err(ApiError::Reject {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: RejectCode::Internal,
            message: format!("invalid phase id `{phase_id}`"),
        }),
    }
}

fn phase_number_for_id(phase_id: &str) -> Result<u32, ApiError> {
    let digits: String = phase_id
        .chars()
        .skip(1)
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits
        .parse::<u32>()
        .ok()
        .filter(|number| *number > 0)
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: RejectCode::Internal,
            message: format!("invalid phase id `{phase_id}`"),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_number_for_id_accepts_revote_suffixes() {
        assert_eq!(phase_number_for_id("D03").unwrap(), 3);
        assert_eq!(phase_number_for_id("D03R1").unwrap(), 3);
        assert_eq!(phase_number_for_id("N12R2").unwrap(), 12);
        assert!(phase_number_for_id("DR1").is_err());
    }

    #[test]
    fn slot_sort_key_orders_candidates_by_numeric_ordinal() {
        let mut slots = vec!["slot_10", "slot-2", "slot_1", "slot-3"];
        slots.sort_by(|a, b| slot_sort_key(a).cmp(&slot_sort_key(b)));
        // Numeric, not lexical (lexical would sort "slot_10" before "slot-2"), and
        // separator-agnostic so mixed hyphen/underscore ids interleave by ordinal.
        assert_eq!(slots, ["slot_1", "slot-2", "slot-3", "slot_10"]);
    }

    #[test]
    fn host_console_authority_exposes_effective_cohost_policy() {
        let authority = build_host_console_authority(
            "cohost_c",
            false,
            BTreeSet::from([
                commands::CohostPermissionClass::Lifecycle,
                commands::CohostPermissionClass::PhaseResolve,
            ]),
        );

        assert_eq!(authority.capability, HostConsoleAuthorityKind::CohostOf);
        assert_eq!(
            authority.denied_classes,
            [
                wire::CohostPermissionClass::PhaseResolve,
                wire::CohostPermissionClass::Lifecycle,
            ]
        );
        assert!(!authority
            .allowed_classes
            .contains(&wire::CohostPermissionClass::PhaseResolve));
        assert!(authority
            .allowed_classes
            .contains(&wire::CohostPermissionClass::Deadline));

        let host = build_host_console_authority("host_h", true, BTreeSet::new());
        assert_eq!(host.capability, HostConsoleAuthorityKind::HostOf);
        assert_eq!(host.allowed_classes.len(), 12);
        assert!(host.denied_classes.is_empty());

        let operator = build_host_console_operator_authority("operator_o");
        assert_eq!(
            operator.capability,
            HostConsoleAuthorityKind::GlobalOperator
        );
        assert!(operator.allowed_classes.is_empty());
    }

    #[test]
    fn host_task_selector_uses_stable_instance_ids_and_effective_permissions() {
        let prompts = vec![
            host_prompt_row("prompt:one", "pending"),
            host_prompt_row("prompt:resolved", "resolved"),
        ];
        let host = build_host_console_authority("host_h", true, BTreeSet::new());
        let tasks = select_host_tasks(&prompts, &[], &host);

        assert_eq!(tasks.len(), 1, "resolved facts are history, not tasks");
        assert_eq!(tasks[0].id, "engine-host-prompt:prompt:one");
        assert_eq!(tasks[0].kind, HostTaskKind::EngineHostPrompt);
        assert_eq!(tasks[0].source_id, "prompt:one");
        assert_eq!(tasks[0].state, HostTaskState::Ready);
        assert_eq!(
            tasks[0].allowed_commands,
            [HostTaskAllowedCommand {
                kind: HostTaskCommandKind::ResolveHostPrompt,
                permission_class: wire::CohostPermissionClass::HostPromptResolve,
            }]
        );
        assert_eq!(tasks[0].blocked_reason, None);

        let denied_cohost = build_host_console_authority(
            "cohost_c",
            false,
            BTreeSet::from([commands::CohostPermissionClass::HostPromptResolve]),
        );
        let tasks = select_host_tasks(&prompts, &[], &denied_cohost);
        assert_eq!(tasks[0].id, "engine-host-prompt:prompt:one");
        assert_eq!(tasks[0].state, HostTaskState::Blocked);
        assert!(tasks[0].allowed_commands.is_empty());
        assert_eq!(
            tasks[0].blocked_reason.as_deref(),
            Some("cohost policy denies host_prompt_resolve")
        );
    }

    #[test]
    fn locked_day_event_selects_a_permission_aware_host_task() {
        let event = day_event_row("locked");
        let host = build_host_console_authority("host_h", true, BTreeSet::new());
        let tasks = select_host_tasks(&[], std::slice::from_ref(&event), &host);
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "day-event-resolve:event-cookie");
        assert_eq!(tasks[0].kind, HostTaskKind::DayEventResolve);
        assert_eq!(tasks[0].source_id, "event-cookie");
        assert_eq!(
            tasks[0].allowed_commands,
            [HostTaskAllowedCommand {
                kind: HostTaskCommandKind::ResolveDayEvent,
                permission_class: wire::CohostPermissionClass::DayEventResolve,
            }]
        );

        let denied = build_host_console_authority(
            "cohost_c",
            false,
            BTreeSet::from([commands::CohostPermissionClass::DayEventResolve]),
        );
        let tasks = select_host_tasks(&[], std::slice::from_ref(&event), &denied);
        assert_eq!(tasks[0].state, HostTaskState::Blocked);
        assert!(tasks[0].allowed_commands.is_empty());
        assert_eq!(
            tasks[0].blocked_reason.as_deref(),
            Some("cohost policy denies day_event_resolve")
        );

        let resolved = day_event_row("resolved");
        assert!(select_host_tasks(&[], &[resolved], &host).is_empty());
    }

    fn host_prompt_row(prompt_id: &str, status: &str) -> projections::HostPromptRow {
        projections::HostPromptRow {
            game_id: Uuid::nil(),
            phase_id: "D01".to_string(),
            event_index: 0,
            prompt_id: prompt_id.to_string(),
            kind: "skip_next_day".to_string(),
            subject_slot: Some("slot_1".to_string()),
            reason: "beloved_princess_death".to_string(),
            phase_kind: "Day".to_string(),
            phase_number: 1,
            metadata: serde_json::json!({}),
            status: status.to_string(),
            decision: None,
            public_resolution: None,
            resolved_by: None,
            resolved_at: None,
        }
    }

    fn day_event_row(state: &str) -> projections::DayEventRow {
        projections::DayEventRow {
            game_id: Uuid::nil(),
            event_id: "event-cookie".to_string(),
            definition: serde_json::from_value(serde_json::json!({
                "id": "event-cookie",
                "program_id": "program-bakery",
                "template_key": "theme.raffle",
                "phase_scope": { "kind": "during_day", "number": 1 },
                "schedule": { "kind": "host_opened" },
                "participation": {
                    "who": "alive_slots",
                    "mode": "opt_in",
                    "limits": { "minimum": 1, "maximum": null }
                },
                "state": "scheduled",
                "resolution": "host_decision",
                "rewards": [{
                    "reward_key": "cookie",
                    "display_name_theme_key": "theme.cookie",
                    "effects": [{
                        "recipient": { "kind": "winner" },
                        "operation": { "kind": "mark", "effect": "marked" }
                    }]
                }],
                "narrative": {
                    "opened": null,
                    "locked": null,
                    "resolved": null,
                    "cancelled": null
                },
                "channel_policy": { "visibility": "public_main" }
            }))
            .unwrap(),
            state: state.to_string(),
            phase_id: Some("D01".to_string()),
            opened_at: Some(1),
            locked_at: Some(2),
            open_due_at: None,
            open_observed_at: None,
            lock_due_at: None,
            lock_observed_at: None,
            auto_seed: None,
            cancelled_reason: None,
            decision: None,
            resolution_evidence: None,
            winner_slots: Vec::new(),
            reward_keys_applied: Vec::new(),
            scheduled_seq: 1,
            updated_seq: 2,
        }
    }
}

async fn load_pack_for_game(state: &ApiState, game: Uuid) -> Result<domain::Pack, ApiError> {
    let pack_name = sqlx::query_scalar::<_, Option<String>>(
        "SELECT payload->>'pack' FROM events WHERE stream_id = $1 AND kind = 'GameCreated' ORDER BY stream_seq ASC LIMIT 1",
    )
    .bind(game)
    .fetch_optional(&state.pool)
    .await?
    .flatten()
    .ok_or_else(|| ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::UnknownGame,
        message: "game stream has no GameCreated pack".to_string(),
    })?;
    let path = FsPath::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packs")
        .join(&pack_name)
        .join("pack.json");
    let raw = std::fs::read_to_string(&path).map_err(|err| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: format!("read pack {}: {err}", path.display()),
    })?;
    domain::load_pack_from_json(&raw).map_err(|err| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: format!("load pack {pack_name}: {err}"),
    })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostPrompt {
    pub game: Uuid,
    pub phase_id: String,
    pub event_index: i32,
    pub prompt_id: String,
    pub kind: String,
    pub subject_slot: Option<String>,
    pub reason: String,
    pub phase_kind: String,
    pub phase_number: i32,
    pub metadata: serde_json::Value,
    pub status: String,
    pub decision: Option<serde_json::Value>,
    pub public_resolution: Option<serde_json::Value>,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<i64>,
}

impl From<projections::HostPromptRow> for HostPrompt {
    fn from(row: projections::HostPromptRow) -> Self {
        HostPrompt {
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

#[derive(Debug, Clone, Deserialize)]
struct HostConsoleStateQuery {
    #[serde(default)]
    principal_user_id: Option<String>,
    #[serde(default)]
    slot_id: Option<String>,
    #[serde(default)]
    limit: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostConsoleStateResponse {
    pub game: Uuid,
    pub authority: HostConsoleAuthorityDelta,
    pub completed: bool,
    pub phase: Option<HostConsolePhaseState>,
    pub slots: Vec<HostConsoleSlotOccupancy>,
    pub thread_posts: Vec<HostConsoleThreadPost>,
    pub day_event_scheduler: Option<DayEventSchedulerDelta>,
    pub day_events: Vec<HostDayEventDelta>,
    pub tasks: Vec<HostTaskDelta>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostConsolePhaseState {
    pub phase_id: String,
    pub locked: bool,
    pub deadline: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostConsoleSlotOccupancy {
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostConsoleThreadPost {
    pub stream_seq: i64,
    pub author_slot: Option<String>,
    pub author_user: Option<String>,
    pub phase_id: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostSetupStateResponse {
    pub game: Uuid,
    pub created: bool,
    pub pack: HostSetupPackState,
    pub program_catalog: Vec<HostSetupProgramOption>,
    pub attached_programs: Vec<HostSetupAttachedProgram>,
    pub accounts: Vec<HostSetupAccountState>,
    pub phase: Option<HostConsolePhaseState>,
    pub slots: Vec<HostSetupSlotState>,
    pub post_policies: Vec<HostSetupPostPolicyState>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostSetupProgramOption {
    pub program_ref: game_platform::DayProgramRef,
    pub display_name: String,
    pub theme_ref: Option<String>,
    pub event_count: usize,
    pub compatibility: HostSetupProgramCompatibility,
    pub schedule_previews: Vec<HostSetupProgramSchedulePreview>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupProgramCompatibility {
    pub attachable: bool,
    pub issues: Vec<HostSetupProgramCompatibilityIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupProgramCompatibilityIssue {
    pub code: String,
    pub event_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupProgramSchedulePreview {
    pub event_id: String,
    pub template_key: String,
    pub participant_filter: String,
    pub participation_mode: String,
    pub resolution_mode: String,
    pub channel_policy: game_platform::EventChannelPolicy,
    pub reward_keys: Vec<String>,
    pub mode: String,
    pub phase_id: Option<String>,
    pub open_at: Option<i64>,
    pub open_offset: Option<i64>,
    pub lock_at: Option<i64>,
    pub lock_offset: Option<i64>,
    pub trigger: Option<game_platform::ProgramTrigger>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupAttachedProgram {
    pub program_id: String,
    pub version: i64,
    pub display_name: String,
    pub theme_ref: Option<String>,
    pub content_hash: String,
    pub event_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupPackState {
    pub key: String,
    pub name: String,
    pub valid: bool,
    pub role_keys: Vec<String>,
    pub roles: Vec<HostSetupRoleOption>,
    pub start_phase_options: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupRoleOption {
    pub key: String,
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupAccountState {
    pub account_id: String,
    pub principal_user_id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupSlotState {
    pub slot_id: String,
    pub occupant_user_id: Option<String>,
    pub alive: bool,
    pub status: String,
    pub status_tags: Vec<String>,
    pub role_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSetupPostPolicyState {
    pub channel_id: String,
    pub allow_media_only: bool,
}

impl From<HostConsoleStateResponse> for HostConsoleStateDelta {
    fn from(response: HostConsoleStateResponse) -> Self {
        HostConsoleStateDelta {
            game: response.game,
            authority: response.authority,
            completed: response.completed,
            phase: response.phase.map(HostConsolePhaseStateDelta::from),
            slots: response
                .slots
                .into_iter()
                .map(HostConsoleSlotOccupancyDelta::from)
                .collect(),
            thread_posts: response
                .thread_posts
                .into_iter()
                .map(HostConsoleThreadPostDelta::from)
                .collect(),
            day_event_scheduler: response.day_event_scheduler,
            day_events: response.day_events,
            tasks: response.tasks,
        }
    }
}

impl From<HostConsolePhaseState> for HostConsolePhaseStateDelta {
    fn from(phase: HostConsolePhaseState) -> Self {
        HostConsolePhaseStateDelta {
            phase_id: phase.phase_id,
            locked: phase.locked,
            deadline: phase.deadline,
        }
    }
}

impl From<HostConsoleSlotOccupancy> for HostConsoleSlotOccupancyDelta {
    fn from(slot: HostConsoleSlotOccupancy) -> Self {
        HostConsoleSlotOccupancyDelta {
            slot_id: slot.slot_id,
            occupant_user_id: slot.occupant_user_id,
            alive: slot.alive,
            status: slot.status,
            status_tags: slot.status_tags,
            role_key: slot.role_key,
            alignment: slot.alignment,
            role_revealed: slot.role_revealed,
            alignment_revealed: slot.alignment_revealed,
        }
    }
}

impl From<HostConsoleThreadPost> for HostConsoleThreadPostDelta {
    fn from(post: HostConsoleThreadPost) -> Self {
        HostConsoleThreadPostDelta {
            stream_seq: post.stream_seq,
            author_slot: post.author_slot,
            author_user: post.author_user,
            phase_id: post.phase_id,
            body: post.body,
        }
    }
}

async fn host_phase_controls(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<LegacyPrincipalQuery>,
    headers: HeaderMap,
) -> Result<Json<Vec<HostPhaseControl>>, ApiError> {
    let principal_user_id =
        authenticated_or_dev_query_principal(&state, &headers, query.principal_user_id.as_deref())
            .await?;
    require_host_audit_access(
        &state,
        game,
        principal_user_id.as_str(),
        "principal cannot read host phase-control audit for this game",
    )
    .await?;

    Ok(Json(
        projections::host_phase_controls(&state.pool, game)
            .await?
            .into_iter()
            .map(HostPhaseControl::from)
            .collect(),
    ))
}

async fn host_prompts(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<LegacyPrincipalQuery>,
    headers: HeaderMap,
) -> Result<Json<Vec<HostPrompt>>, ApiError> {
    let principal_user_id =
        authenticated_or_dev_query_principal(&state, &headers, query.principal_user_id.as_deref())
            .await?;
    require_host_audit_access(
        &state,
        game,
        principal_user_id.as_str(),
        "principal cannot read host prompts for this game",
    )
    .await?;

    Ok(Json(
        projections::host_prompts(&state.pool, game)
            .await?
            .into_iter()
            .map(HostPrompt::from)
            .collect(),
    ))
}

async fn host_console_state(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<HostConsoleStateQuery>,
    headers: HeaderMap,
) -> Result<Json<HostConsoleStateResponse>, ApiError> {
    let principal_user_id =
        authenticated_or_dev_query_principal(&state, &headers, query.principal_user_id.as_deref())
            .await?;
    let authority = resolve_host_console_authority(&state.pool, game, principal_user_id.as_str())
        .await?
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: "principal cannot read host console state for this game".to_string(),
        })?;

    Ok(Json(
        load_host_console_state(
            &state.pool,
            game,
            authority,
            query.slot_id.as_deref(),
            query.limit,
        )
        .await?,
    ))
}

/// Reusable authority-checked host-console read for local proof and non-HTTP
/// adapters. It preserves the same capability resolution and response assembly
/// as the network handler.
pub async fn load_host_console_state_for_principal(
    pool: &PgPool,
    game: Uuid,
    principal_user_id: &str,
    limit: Option<i64>,
) -> Result<HostConsoleStateResponse, ApiError> {
    let authority = resolve_host_console_authority(pool, game, principal_user_id)
        .await?
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: "principal cannot read host console state for this game".to_string(),
        })?;
    load_host_console_state(pool, game, authority, None, limit).await
}

async fn host_setup_state(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<LegacyPrincipalQuery>,
    headers: HeaderMap,
) -> Result<Json<HostSetupStateResponse>, ApiError> {
    let principal_user_id =
        authenticated_or_dev_query_principal(&state, &headers, query.principal_user_id.as_deref())
            .await?;
    require_host_audit_access(
        &state,
        game,
        principal_user_id.as_str(),
        "principal cannot read host setup state for this game",
    )
    .await?;

    Ok(Json(load_host_setup_state(&state, game).await?))
}

async fn load_host_console_state(
    pool: &PgPool,
    game: Uuid,
    authority: HostConsoleAuthorityDelta,
    slot_id: Option<&str>,
    limit: Option<i64>,
) -> Result<HostConsoleStateResponse, ApiError> {
    let completed = commands::game_completed(pool, game)
        .await
        .map_err(command_reject_api_error)?;
    let phase = projections::phase_state(pool, game)
        .await?
        .map(|row| HostConsolePhaseState {
            phase_id: row.phase_id,
            locked: row.locked,
            deadline: row.deadline,
        });

    let slot_states = projections::slot_state(pool, game).await?;
    let slots = projections::slot_occupancy(pool, game)
        .await?
        .into_iter()
        .filter(|row| slot_id.is_none_or(|slot_id| row.slot_id == slot_id))
        .map(|row| {
            let slot_state = slot_states
                .iter()
                .find(|state| state.slot_id == row.slot_id);
            HostConsoleSlotOccupancy {
                slot_id: row.slot_id,
                occupant_user_id: row.occupant_user_id,
                alive: slot_state.map(|state| state.alive).unwrap_or(true),
                status: slot_state
                    .map(|state| state.status.clone())
                    .unwrap_or_else(|| "alive".to_string()),
                status_tags: slot_state
                    .map(|state| state.status_tags.clone())
                    .unwrap_or_default(),
                role_key: slot_state.and_then(|state| state.role_key.clone()),
                alignment: slot_state.and_then(|state| state.alignment.clone()),
                role_revealed: slot_state.map(|state| state.role_revealed).unwrap_or(false),
                alignment_revealed: slot_state
                    .map(|state| state.alignment_revealed)
                    .unwrap_or(false),
            }
        })
        .collect();

    let thread_posts = projections::thread_view(pool, game, None, limit.unwrap_or(25))
        .await?
        .posts
        .into_iter()
        .filter(|post| slot_id.is_none_or(|slot_id| post.author_slot.as_deref() == Some(slot_id)))
        .map(|post| HostConsoleThreadPost {
            stream_seq: post.stream_seq,
            author_slot: post.author_slot,
            author_user: post.author_user,
            phase_id: post.phase_id,
            body: post.body,
        })
        .collect();
    let host_prompts = projections::host_prompts(pool, game).await?;
    let day_event_rows = projections::day_events(pool, game).await?;
    let day_event_scheduler =
        commands::day_scheduler::day_event_scheduler_status(pool, game, unix_now_seconds())
            .await
            .map_err(|error| ApiError::Reject {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                error: RejectCode::Internal,
                message: error.to_string(),
            })?
            .map(|status| DayEventSchedulerDelta {
                pending: status.pending,
                next_due_at: status.next_due_at,
                auto_resolve_pending: status.auto_resolve_pending,
                narrative_pending: status.narrative_pending,
                wake_seq: status.wake_seq,
                last_observed_wake_seq: status.last_observed_wake_seq,
                lease_until: status.lease_until,
                retry_not_before: status.retry_not_before,
                last_attempt_at: status.last_attempt_at,
                last_success_at: status.last_success_at,
                last_failure_at: status.last_failure_at,
                consecutive_failures: status.consecutive_failures,
                total_attempts: status.total_attempts,
                total_successes: status.total_successes,
                last_error: status.last_error,
            });
    let day_event_participation = projections::day_event_participation_for_game(pool, game).await?;
    let day_event_narratives = projections::day_event_narratives(pool, game).await?;
    let private_channel_members = projections::private_channel_members(pool, game).await?;
    let tasks = select_host_tasks(&host_prompts, &day_event_rows, &authority);
    let day_events = day_event_rows
        .iter()
        .map(|event| HostDayEventDelta {
            event_id: event.event_id.clone(),
            state: event.state.clone(),
            phase_id: event.phase_id.clone(),
            definition: event.definition.clone(),
            room: day_event_room_delta(event, &private_channel_members),
            participant_slots: day_event_participation
                .iter()
                .filter(|row| row.event_id == event.event_id)
                .map(|row| row.actor_slot.clone())
                .collect(),
            open_due_at: event.open_due_at,
            open_observed_at: event.open_observed_at,
            lock_due_at: event.lock_due_at,
            lock_observed_at: event.lock_observed_at,
            auto_seed: event.auto_seed,
            resolution_evidence: event.resolution_evidence.clone(),
            winner_slots: event.winner_slots.clone(),
            reward_keys_applied: event.reward_keys_applied.clone(),
            narratives: day_event_narratives
                .iter()
                .filter(|row| row.event_id == event.event_id)
                .map(|row| DayEventNarrativeDelta {
                    lifecycle: row.lifecycle,
                    template_key: row.template_key.clone(),
                    template_hash: row.template_hash.as_str().to_string(),
                    channel_id: row.channel_id.clone(),
                    status: row.status.clone(),
                    body: row.rendered_body.clone(),
                    source_seq: row.source_seq,
                    published_seq: row.published_seq,
                })
                .collect(),
        })
        .collect();

    Ok(HostConsoleStateResponse {
        game,
        authority,
        completed,
        phase,
        slots,
        thread_posts,
        day_event_scheduler,
        day_events,
        tasks,
    })
}

/// HostTasks are permission-aware selectors over authoritative projections,
/// never a second mutable rules model. Resolved prompts disappear because their
/// durable completion remains available in `host_prompt` history.
fn select_host_tasks(
    prompts: &[projections::HostPromptRow],
    day_events: &[projections::DayEventRow],
    authority: &HostConsoleAuthorityDelta,
) -> Vec<HostTaskDelta> {
    let can_resolve_prompt = authority
        .allowed_classes
        .contains(&wire::CohostPermissionClass::HostPromptResolve);
    let mut tasks: Vec<_> = prompts
        .iter()
        .filter(|prompt| prompt.status == "pending")
        .map(|prompt| {
            let (state, allowed_commands, blocked_reason) = if can_resolve_prompt {
                (
                    HostTaskState::Ready,
                    vec![HostTaskAllowedCommand {
                        kind: HostTaskCommandKind::ResolveHostPrompt,
                        permission_class: wire::CohostPermissionClass::HostPromptResolve,
                    }],
                    None,
                )
            } else {
                (
                    HostTaskState::Blocked,
                    Vec::new(),
                    Some(match authority.capability {
                        HostConsoleAuthorityKind::CohostOf => {
                            "cohost policy denies host_prompt_resolve".to_string()
                        }
                        HostConsoleAuthorityKind::GlobalOperator => {
                            "global operators have read-only host console access".to_string()
                        }
                        HostConsoleAuthorityKind::HostOf => {
                            "host prompt resolution is unavailable".to_string()
                        }
                    }),
                )
            };
            HostTaskDelta {
                id: format!("engine-host-prompt:{}", prompt.prompt_id),
                kind: HostTaskKind::EngineHostPrompt,
                state,
                urgency: HostTaskUrgency::Attention,
                intent: prompt.reason.clone(),
                consequence: format!("resolve pack-defined {} policy", prompt.kind),
                phase_id: prompt.phase_id.clone(),
                subject_slot: prompt.subject_slot.clone(),
                source_id: prompt.prompt_id.clone(),
                allowed_commands,
                blocked_reason,
            }
        })
        .collect();
    let can_resolve_day_event = authority
        .allowed_classes
        .contains(&wire::CohostPermissionClass::DayEventResolve);
    tasks.extend(
        day_events
            .iter()
            .filter(|event| {
                event.state == "locked"
                    && event.definition.resolution
                        == game_platform::DayEventResolutionMode::HostDecision
            })
            .map(|event| {
                let (state, allowed_commands, blocked_reason) = if can_resolve_day_event {
                    (
                        HostTaskState::Ready,
                        vec![HostTaskAllowedCommand {
                            kind: HostTaskCommandKind::ResolveDayEvent,
                            permission_class: wire::CohostPermissionClass::DayEventResolve,
                        }],
                        None,
                    )
                } else {
                    (
                        HostTaskState::Blocked,
                        Vec::new(),
                        Some(match authority.capability {
                            HostConsoleAuthorityKind::CohostOf => {
                                "cohost policy denies day_event_resolve".to_string()
                            }
                            HostConsoleAuthorityKind::GlobalOperator => {
                                "global operators have read-only host console access".to_string()
                            }
                            HostConsoleAuthorityKind::HostOf => {
                                "DayEvent resolution is unavailable".to_string()
                            }
                        }),
                    )
                };
                HostTaskDelta {
                    id: format!("day-event-resolve:{}", event.event_id),
                    kind: HostTaskKind::DayEventResolve,
                    state,
                    urgency: HostTaskUrgency::Attention,
                    intent: format!("Resolve {}", event.definition.template_key.as_str()),
                    consequence: format!(
                        "apply {} reward binding{} atomically",
                        event.definition.rewards.len(),
                        if event.definition.rewards.len() == 1 {
                            ""
                        } else {
                            "s"
                        }
                    ),
                    phase_id: event.phase_id.clone().unwrap_or_default(),
                    subject_slot: None,
                    source_id: event.event_id.clone(),
                    allowed_commands,
                    blocked_reason,
                }
            }),
    );
    tasks
}

async fn resolve_host_console_authority(
    pool: &PgPool,
    game: Uuid,
    principal_user_id: &str,
) -> Result<Option<HostConsoleAuthorityDelta>, ApiError> {
    let capabilities = caps::resolve(pool, &Principal::user(principal_user_id), game).await?;
    let is_host = capabilities
        .iter()
        .any(|cap| cap == &Capability::HostOf(game));
    let is_cohost = capabilities
        .iter()
        .any(|cap| cap == &Capability::CohostOf(game));
    if !is_host && !is_cohost {
        return if active_global_operator(pool, principal_user_id).await? {
            Ok(Some(build_host_console_operator_authority(
                principal_user_id,
            )))
        } else {
            Ok(None)
        };
    }
    let denied = if is_host {
        BTreeSet::new()
    } else {
        projections::cohost_denied_classes(pool, game)
            .await?
            .into_iter()
            .filter_map(|class| commands::CohostPermissionClass::parse(&class))
            .collect()
    };
    Ok(Some(build_host_console_authority(
        principal_user_id,
        is_host,
        denied,
    )))
}

fn build_host_console_authority(
    principal_user_id: &str,
    is_host: bool,
    denied: BTreeSet<commands::CohostPermissionClass>,
) -> HostConsoleAuthorityDelta {
    let allowed_classes = commands::CohostPermissionClass::ALL
        .into_iter()
        .filter(|class| !denied.contains(class))
        .map(wire::CohostPermissionClass::from)
        .collect();
    let denied_classes = denied
        .into_iter()
        .map(wire::CohostPermissionClass::from)
        .collect();

    HostConsoleAuthorityDelta {
        principal_user_id: principal_user_id.to_string(),
        capability: if is_host {
            HostConsoleAuthorityKind::HostOf
        } else {
            HostConsoleAuthorityKind::CohostOf
        },
        allowed_classes,
        denied_classes,
    }
}

fn build_host_console_operator_authority(principal_user_id: &str) -> HostConsoleAuthorityDelta {
    HostConsoleAuthorityDelta {
        principal_user_id: principal_user_id.to_string(),
        capability: HostConsoleAuthorityKind::GlobalOperator,
        allowed_classes: Vec::new(),
        denied_classes: Vec::new(),
    }
}

async fn load_host_setup_state(
    state: &ApiState,
    game: Uuid,
) -> Result<HostSetupStateResponse, ApiError> {
    let pack_key = pack_name_for_game(state, game).await?;
    let pack = load_pack_by_name(&pack_key)?;
    let program_catalog = product_day_program_catalog(&pack)?;
    let attached_programs = projections::day_programs(&state.pool, game)
        .await?
        .into_iter()
        .map(|row| HostSetupAttachedProgram {
            program_id: row.program_id,
            version: row.version,
            display_name: row.display_name,
            theme_ref: row.theme_ref,
            content_hash: row.content_hash,
            event_count: row.document.events.len(),
        })
        .collect();
    let phase = projections::phase_state(&state.pool, game)
        .await?
        .map(|row| HostConsolePhaseState {
            phase_id: row.phase_id,
            locked: row.locked,
            deadline: row.deadline,
        });
    let slot_occupancy = projections::slot_occupancy(&state.pool, game).await?;
    let slots = projections::slot_state(&state.pool, game)
        .await?
        .into_iter()
        .map(|slot| {
            let occupant_user_id = slot_occupancy
                .iter()
                .find(|occupancy| occupancy.slot_id == slot.slot_id)
                .map(|occupancy| occupancy.occupant_user_id.clone());
            HostSetupSlotState {
                slot_id: slot.slot_id,
                occupant_user_id,
                alive: slot.alive,
                status: slot.status,
                status_tags: slot.status_tags,
                role_key: slot.role_key,
            }
        })
        .collect();
    let main_policy = projections::post_policy(&state.pool, game, "main").await?;
    let accounts = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT label, principal_user_id
        FROM (
            SELECT COALESCE(identity.display_label, identity.subject) AS label,
                   identity.principal_user_id
            FROM external_identity AS identity
            JOIN platform_principal AS principal
              ON principal.principal_user_id = identity.principal_user_id
            WHERE identity.provider = 'workos'
              AND principal.status = 'active'
              AND principal.disabled_at IS NULL
            UNION ALL
            SELECT account_id AS label, principal_user_id
            FROM auth_account
            WHERE disabled_at IS NULL
        ) AS available_account
        ORDER BY lower(label), label
        "#,
    )
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .map(|(account_id, principal_user_id)| HostSetupAccountState {
        label: account_id.clone(),
        account_id,
        principal_user_id,
    })
    .collect();
    let roles = pack
        .roles
        .iter()
        .map(|(key, role)| HostSetupRoleOption {
            key: key.clone(),
            label: role_label(key, role.description.as_str()),
            description: role.description.clone(),
        })
        .collect();

    Ok(HostSetupStateResponse {
        game,
        created: true,
        pack: HostSetupPackState {
            key: pack_key,
            name: pack.name,
            valid: true,
            role_keys: pack.roles.keys().cloned().collect(),
            roles,
            start_phase_options: start_phase_options(&pack.phases),
        },
        program_catalog,
        attached_programs,
        accounts,
        phase,
        slots,
        post_policies: vec![HostSetupPostPolicyState {
            channel_id: main_policy.channel_id,
            allow_media_only: main_policy.allow_media_only,
        }],
    })
}

async fn pack_name_for_game(state: &ApiState, game: Uuid) -> Result<String, ApiError> {
    sqlx::query_scalar::<_, Option<String>>(
        "SELECT payload->>'pack' FROM events WHERE stream_id = $1 AND kind = 'GameCreated' ORDER BY stream_seq ASC LIMIT 1",
    )
    .bind(game)
    .fetch_optional(&state.pool)
    .await?
    .flatten()
    .ok_or_else(|| ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::UnknownGame,
        message: "game stream has no GameCreated pack".to_string(),
    })
}

fn load_pack_by_name(pack_name: &str) -> Result<domain::Pack, ApiError> {
    let path = FsPath::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packs")
        .join(pack_name)
        .join("pack.json");
    let raw = std::fs::read_to_string(&path).map_err(|err| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: format!("read pack {}: {err}", path.display()),
    })?;
    domain::load_pack_from_json(&raw).map_err(|err| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: format!("load pack {pack_name}: {err}"),
    })
}

fn product_day_program_catalog(
    pack: &domain::Pack,
) -> Result<Vec<HostSetupProgramOption>, ApiError> {
    let library =
        program_library::load_checked_in_program_library().map_err(|error| ApiError::Reject {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: RejectCode::Internal,
            message: format!("load checked-in day-program library: {error}"),
        })?;
    let mut programs = Vec::new();
    for artifact in library.for_audience(program_library::ProgramAudience::Product) {
        let compatibility = commands::day_program::inspect(pack, &artifact.document);
        let compilation = compatibility
            .compilation
            .as_ref()
            .ok_or_else(|| ApiError::Reject {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                error: RejectCode::Internal,
                message: format!(
                    "validate day program {}@{}: {}",
                    artifact.program_ref.id,
                    artifact.program_ref.version,
                    compatibility.summary()
                ),
            })?;
        let schedule_previews = compilation
            .events
            .iter()
            .map(|event| {
                let schedule = game_platform::day_schedule::compile(&event.schedule);
                let mut preview = HostSetupProgramSchedulePreview {
                    event_id: event.id.as_str().to_string(),
                    template_key: event.template_key.as_str().to_string(),
                    participant_filter: match event.participation.who {
                        game_platform::ParticipantFilter::AliveSlots => "alive_slots",
                        game_platform::ParticipantFilter::AllOccupied => "all_occupied",
                        game_platform::ParticipantFilter::HostInvited => "host_invited",
                        game_platform::ParticipantFilter::ChannelMembers => "channel_members",
                    }
                    .to_string(),
                    participation_mode: match event.participation.mode {
                        game_platform::ParticipationMode::OptIn => "opt_in",
                        game_platform::ParticipationMode::SubmitChoice => "submit_choice",
                        game_platform::ParticipationMode::SubmitFreeformRef => {
                            "submit_freeform_ref"
                        }
                        game_platform::ParticipationMode::VoteAmongOptions => "vote_among_options",
                    }
                    .to_string(),
                    resolution_mode: match event.resolution {
                        game_platform::DayEventResolutionMode::HostDecision => "host_decision",
                        game_platform::DayEventResolutionMode::Auto {
                            policy: game_platform::AutoResolvePolicy::FirstN { .. },
                        } => "auto_first_n",
                        game_platform::DayEventResolutionMode::Auto {
                            policy: game_platform::AutoResolvePolicy::SeededRandom { .. },
                        } => "auto_seeded_random",
                    }
                    .to_string(),
                    channel_policy: event.channel_policy,
                    reward_keys: event
                        .rewards
                        .iter()
                        .map(|reward| reward.reward_key.as_str().to_string())
                        .collect(),
                    mode: String::new(),
                    phase_id: None,
                    open_at: None,
                    open_offset: None,
                    lock_at: None,
                    lock_offset: None,
                    trigger: None,
                };
                match schedule.opening {
                    game_platform::day_schedule::ScheduleOpening::Manual => {
                        preview.mode = "host_opened".to_string();
                    }
                    game_platform::day_schedule::ScheduleOpening::Absolute { open_at } => {
                        preview.mode = "absolute".to_string();
                        preview.open_at = Some(open_at);
                    }
                    game_platform::day_schedule::ScheduleOpening::RelativeToPhase {
                        phase_id,
                        open_offset,
                    } => {
                        preview.mode = "relative_to_phase".to_string();
                        preview.phase_id = Some(phase_id);
                        preview.open_offset = Some(open_offset);
                    }
                    game_platform::day_schedule::ScheduleOpening::OnTrigger { trigger } => {
                        preview.mode = "on_trigger".to_string();
                        preview.trigger = Some(trigger);
                    }
                }
                match schedule.lock {
                    Some(game_platform::day_schedule::ScheduleLock::Absolute { lock_at }) => {
                        preview.lock_at = Some(lock_at);
                    }
                    Some(game_platform::day_schedule::ScheduleLock::RelativeToPhase {
                        lock_offset,
                        ..
                    }) => {
                        preview.lock_offset = Some(lock_offset);
                    }
                    None => {}
                }
                preview
            })
            .collect();
        let compatibility = HostSetupProgramCompatibility {
            attachable: compatibility.attachable(),
            issues: compatibility
                .issues
                .into_iter()
                .map(|issue| HostSetupProgramCompatibilityIssue {
                    code: issue.code.as_str().to_string(),
                    event_id: issue.event_id,
                    message: issue.message,
                })
                .collect(),
        };
        programs.push(HostSetupProgramOption {
            program_ref: artifact.program_ref.clone(),
            display_name: artifact.document.display_name.clone(),
            theme_ref: artifact
                .document
                .theme_ref
                .as_ref()
                .map(ToString::to_string),
            event_count: artifact.document.events.len(),
            compatibility,
            schedule_previews,
        });
    }
    programs.sort_by(|left, right| {
        left.program_ref
            .id
            .cmp(&right.program_ref.id)
            .then(left.program_ref.version.cmp(&right.program_ref.version))
    });
    Ok(programs)
}

#[cfg(test)]
mod day_program_catalog_tests {
    use super::*;

    #[test]
    fn setup_catalog_annotates_compatibility_for_every_product_pack() {
        let product_packs = product_pack_catalog().unwrap();
        assert_eq!(
            product_packs
                .iter()
                .map(|pack| pack.key.as_str())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "chinese_structured",
                "default_open",
                "epicmafia",
                "mafia_universe",
                "mafiascum",
            ]),
            "every newly shipped pack must declare the expected catalog compatibility"
        );
        for product_pack in product_packs {
            let pack_key = product_pack.key;
            let pack = load_pack_by_name(&pack_key).unwrap();
            let catalog = product_day_program_catalog(&pack).unwrap();
            assert_eq!(catalog.len(), 4);
            assert!(catalog
                .iter()
                .all(|option| option.compatibility.attachable
                    && option.compatibility.issues.is_empty()));
            let modes = catalog
                .iter()
                .map(|option| {
                    (
                        option.program_ref.id.as_str(),
                        option.schedule_previews[0].mode.as_str(),
                    )
                })
                .collect::<BTreeMap<_, _>>();
            assert_eq!(
                modes,
                BTreeMap::from([
                    ("host-judged-showcase", "on_trigger"),
                    ("opt-in-quest", "relative_to_phase"),
                    ("private-opt-in-circle", "host_opened"),
                    ("raffle", "host_opened"),
                ]),
                "unexpected product program schedule preview for {pack_key}"
            );
            let private_preview = catalog
                .iter()
                .find(|option| option.program_ref.id.as_str() == "private-opt-in-circle")
                .unwrap()
                .schedule_previews
                .first()
                .unwrap();
            assert_eq!(
                private_preview.channel_policy,
                game_platform::EventChannelPolicy::Private {
                    membership: game_platform::EventChannelMembership::Participants,
                }
            );
        }
    }
}

fn product_pack_catalog() -> Result<Vec<AdminGameBootstrapPack>, ApiError> {
    let root = FsPath::new(env!("CARGO_MANIFEST_DIR")).join("../../packs");
    let entries = std::fs::read_dir(&root).map_err(|err| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: format!("read pack catalog {}: {err}", root.display()),
    })?;
    let mut packs = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|err| ApiError::Reject {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: RejectCode::Internal,
            message: format!("read pack catalog entry: {err}"),
        })?;
        let key = entry.file_name().to_string_lossy().to_string();
        if key.starts_with("test_") || key.starts_with("dev_") || !entry.path().is_dir() {
            continue;
        }
        let pack = load_pack_by_name(key.as_str())?;
        packs.push(AdminGameBootstrapPack {
            key,
            name: humanize_identifier(pack.name.as_str()),
        });
    }
    packs.sort_by(|left, right| left.name.cmp(&right.name).then(left.key.cmp(&right.key)));
    Ok(packs)
}

fn role_label(key: &str, description: &str) -> String {
    description
        .split('.')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 80)
        .map(str::to_string)
        .unwrap_or_else(|| humanize_identifier(key))
}

fn humanize_identifier(value: &str) -> String {
    value
        .split(['_', '-'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut characters = part.chars();
            match characters.next() {
                Some(first) => first.to_uppercase().chain(characters).collect(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn start_phase_options(phases: &domain::pack::PhasePolicy) -> Vec<String> {
    let mut options = BTreeSet::new();
    for kind in &phases.cadence {
        let prefix = match kind {
            domain::pack::PhaseKind::Day => "D",
            domain::pack::PhaseKind::Night => "N",
            domain::pack::PhaseKind::Twilight => "T",
        };
        options.insert(format!("{prefix}01"));
    }
    if options.is_empty() {
        options.insert("D01".to_string());
    }
    options.into_iter().collect()
}

#[derive(Debug, Clone, Deserialize)]
struct CreateWebsocketTicket {
    audience: String,
    game: Uuid,
    #[serde(default = "default_live_channel")]
    channel: String,
    #[serde(default)]
    slot_id: Option<String>,
    #[serde(default)]
    after_seq: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct LegacyPrincipalQuery {
    #[serde(default)]
    principal_user_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebsocketTicketResponse {
    pub ticket: String,
    pub audience: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct WsParams {
    #[serde(default)]
    ticket: Option<String>,
    #[serde(default)]
    audience: Option<String>,
    #[serde(default)]
    principal_user_id: Option<String>,
    #[serde(default)]
    game: Option<Uuid>,
    #[serde(default)]
    slot_id: Option<String>,
    #[serde(default)]
    channel: Option<String>,
}

#[derive(Debug, Clone)]
struct WebsocketTicketClaim {
    auth_kind: String,
    session_reference: String,
    access_expires_at: i64,
    principal_user_id: String,
    game: Uuid,
    channel: String,
    slot_id: Option<String>,
    after_seq: i64,
}

fn default_live_channel() -> String {
    "main".to_string()
}

async fn authenticated_transport_principal(
    state: &ApiState,
    headers: &HeaderMap,
) -> Result<String, ApiError> {
    let token = bearer_token(headers).ok_or_else(unauthorized_session)?;
    Ok(authenticate_token(&state.auth, token)
        .await?
        .principal_user_id)
}

async fn authenticated_or_dev_query_principal(
    state: &ApiState,
    headers: &HeaderMap,
    legacy_principal_user_id: Option<&str>,
) -> Result<String, ApiError> {
    if bearer_token(headers).is_some() {
        return authenticated_transport_principal(state, headers).await;
    }
    if state.auth.dev_auth_enabled {
        if let Some(principal_user_id) = legacy_principal_user_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Ok(principal_user_id.to_string());
        }
    }
    Err(unauthorized_session())
}

async fn create_websocket_ticket(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<CreateWebsocketTicket>,
) -> Result<Json<WebsocketTicketResponse>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let identity = authenticate_token(&state.auth, token).await?;
    let principal_user_id = identity.principal_user_id.clone();
    let ticket_scope =
        hash_session_token(format!("websocket-ticket-principal:{principal_user_id}").as_str());
    enforce_public_request_limit(
        &state.auth,
        ticket_scope.as_str(),
        state.auth.websocket_ticket_max_per_window,
        &state.auth.auth_attempt_policy,
    )
    .await?;
    let audience = request.audience.trim();
    let channel = request.channel.trim();
    if audience != state.auth.websocket_audience
        || channel.is_empty()
        || channel.len() > 256
        || request.after_seq < 0
        || request
            .slot_id
            .as_deref()
            .is_some_and(|slot| slot.trim().is_empty() || slot.len() > 256)
    {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::NotAuthorized,
            message: "invalid websocket ticket scope".to_string(),
        });
    }

    // Validate the requested private scope before minting bearer authority.
    if channel != "main" {
        require_channel_thread_access(
            &state,
            request.game,
            channel,
            Some(principal_user_id.as_str()),
        )
        .await?;
    }
    if let Some(slot_id) = request.slot_id.as_deref() {
        let capabilities = caps::resolve(
            &state.pool,
            &Principal::user(principal_user_id.as_str()),
            request.game,
        )
        .await?;
        if !capabilities.grants(&Capability::SlotOccupant(slot_id.to_string()))
            && !capabilities.grants(&Capability::HostOf(request.game))
            && !capabilities.grants(&Capability::CohostOf(request.game))
        {
            return Err(ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "principal cannot mint the requested websocket scope".to_string(),
            });
        }
    }

    let issued_at = unix_now_seconds();
    if identity.expires_at <= issued_at {
        return Err(unauthorized_session());
    }
    let expires_at = issued_at
        .saturating_add(state.auth.websocket_ticket_ttl.as_secs() as i64)
        .min(identity.expires_at);
    let ticket = format!("ws-ticket-{}-{}", Uuid::new_v4(), Uuid::new_v4());
    sqlx::query(
        r#"
        INSERT INTO auth_websocket_ticket (
            token_hash, auth_kind, session_reference, access_expires_at,
            principal_user_id, audience,
            game_id, channel_id, slot_id, after_seq, issued_at, expires_at, consumed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL)
        "#,
    )
    .bind(hash_session_token(ticket.as_str()))
    .bind(identity.auth_kind)
    .bind(identity.session_reference)
    .bind(
        identity
            .idle_expires_at
            .map_or(identity.expires_at, |idle| idle.min(identity.expires_at)),
    )
    .bind(principal_user_id)
    .bind(audience)
    .bind(request.game)
    .bind(channel)
    .bind(request.slot_id.as_deref().map(str::trim))
    .bind(request.after_seq)
    .bind(issued_at)
    .bind(expires_at)
    .execute(&state.pool)
    .await?;

    Ok(Json(WebsocketTicketResponse {
        ticket,
        audience: audience.to_string(),
        expires_at,
    }))
}

async fn redeem_websocket_ticket(
    state: &ApiState,
    params: &WsParams,
) -> Result<WebsocketTicketClaim, ApiError> {
    let ticket = params.ticket.as_deref().ok_or_else(unauthorized_session)?;
    let audience = params
        .audience
        .as_deref()
        .ok_or_else(unauthorized_session)?;
    if audience != state.auth.websocket_audience || ticket.trim().is_empty() {
        return Err(unauthorized_session());
    }
    let now = unix_now_seconds();
    let row = sqlx::query_as::<
        _,
        (
            String,
            String,
            i64,
            String,
            Uuid,
            String,
            Option<String>,
            i64,
        ),
    >(
        r#"
        UPDATE auth_websocket_ticket AS ticket
        SET consumed_at = $3
        WHERE ticket.token_hash = $1
          AND ticket.audience = $2
          AND ticket.consumed_at IS NULL
          AND ticket.expires_at > $3
          AND ticket.access_expires_at > $3
        RETURNING ticket.auth_kind, ticket.session_reference, ticket.access_expires_at,
                  ticket.principal_user_id,
                  ticket.game_id, ticket.channel_id, ticket.slot_id, ticket.after_seq
        "#,
    )
    .bind(hash_session_token(ticket))
    .bind(audience)
    .bind(now)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(unauthorized_session)?;
    let claim = WebsocketTicketClaim {
        auth_kind: row.0,
        session_reference: row.1,
        access_expires_at: row.2,
        principal_user_id: row.3,
        game: row.4,
        channel: row.5,
        slot_id: row.6,
        after_seq: row.7,
    };
    if !websocket_session_active(state, &claim).await {
        return Err(unauthorized_session());
    }
    Ok(claim)
}

async fn websocket_session_active(state: &ApiState, claim: &WebsocketTicketClaim) -> bool {
    if state.auth.dev_auth_enabled && claim.session_reference == "dev-legacy" {
        return true;
    }
    let now = unix_now_seconds();
    if claim.access_expires_at <= now {
        return false;
    }
    match claim.auth_kind.as_str() {
        "classic" | "dev" => {
            app_session_live(state, claim, now).await == Some(true)
        }
        "workos" => match app_session_live(state, claim, now).await {
            Some(live) => live,
            // Transitional: JWT-bearer tickets reference the provider session
            // id rather than an app session; the principal's status is the
            // only revocation signal available for them.
            None => sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (SELECT 1 FROM platform_principal WHERE principal_user_id = $1 AND status = 'active' AND disabled_at IS NULL)",
            )
            .bind(claim.principal_user_id.as_str())
            .fetch_one(&state.pool)
            .await
            .unwrap_or(false),
        },
        _ => {
            let account_predicate = if state.auth.dev_auth_enabled {
                "TRUE"
            } else {
                "EXISTS (SELECT 1 FROM auth_account WHERE auth_account.principal_user_id = auth_session.principal_user_id AND auth_account.disabled_at IS NULL)"
            };
            let query = format!(
                "SELECT EXISTS (SELECT 1 FROM auth_session WHERE token_hash = $1 AND principal_user_id = $2 AND revoked_at IS NULL AND expires_at > $3 AND {account_predicate})"
            );
            sqlx::query_scalar::<_, bool>(query.as_str())
                .bind(claim.session_reference.as_str())
                .bind(claim.principal_user_id.as_str())
                .bind(now)
                .fetch_one(&state.pool)
                .await
                .unwrap_or(false)
        }
    }
}

/// Liveness of the app session a ticket references: Some(live) when a session
/// row matches the reference, None when the reference is not an app session.
async fn app_session_live(
    state: &ApiState,
    claim: &WebsocketTicketClaim,
    now: i64,
) -> Option<bool> {
    sqlx::query_scalar::<_, bool>(
        r#"
        SELECT (session.revoked_at IS NULL
            AND session.expires_at > $3
            AND (session.idle_expires_at IS NULL OR session.idle_expires_at > $3)
            AND (method.method_id IS NULL OR method.status = 'active')
            AND (principal.principal_user_id IS NULL OR principal.status = 'active'))
        FROM auth_session AS session
        LEFT JOIN authentication_method AS method
          ON method.method_id = session.authenticated_via_method_id
        LEFT JOIN platform_principal AS principal
          ON principal.principal_user_id = session.principal_user_id
        WHERE session.token_hash = $1
          AND session.principal_user_id = $2
        "#,
    )
    .bind(claim.session_reference.as_str())
    .bind(claim.principal_user_id.as_str())
    .bind(now)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten()
}

async fn ws(
    State(state): State<ApiState>,
    Query(params): Query<WsParams>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let claim = if params.ticket.is_some() || params.audience.is_some() {
        match redeem_websocket_ticket(&state, &params).await {
            Ok(claim) => claim,
            Err(error) => return error.into_response(),
        }
    } else if state.auth.dev_auth_enabled {
        let (Some(principal_user_id), Some(game)) = (params.principal_user_id.clone(), params.game)
        else {
            return unauthorized_session().into_response();
        };
        WebsocketTicketClaim {
            auth_kind: "legacy-dev".to_string(),
            session_reference: "dev-legacy".to_string(),
            access_expires_at: i64::MAX,
            principal_user_id,
            game,
            channel: params.channel.clone().unwrap_or_else(default_live_channel),
            slot_id: params.slot_id.clone(),
            after_seq: 0,
        }
    } else {
        return unauthorized_session().into_response();
    };
    let permit = match state.live_connection_slots.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            tracing::warn!(
                event = "live_connection_rejected",
                reason = "connection_capacity_exhausted",
                "live connection admission rejected"
            );
            return capacity_unavailable_response(
                "live connection capacity is exhausted; retry shortly",
                1,
            );
        }
    };
    let principal_slots = {
        let mut slots = state.live_principal_slots.lock().await;
        slots
            .entry(claim.principal_user_id.clone())
            .or_insert_with(|| Arc::new(Semaphore::new(state.live_principal_limit)))
            .clone()
    };
    let principal_permit = match principal_slots.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            tracing::warn!(
                event = "live_connection_rejected",
                reason = "principal_connection_capacity_exhausted",
                "live connection admission rejected"
            );
            return capacity_unavailable_response(
                "principal live connection capacity is exhausted; retry shortly",
                1,
            );
        }
    };
    upgrade
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            let principal_user_id = claim.principal_user_id.clone();
            ws_session(socket, state.clone(), claim).await;
            drop(principal_permit);
            let mut slots = state.live_principal_slots.lock().await;
            if slots.get(&principal_user_id).is_some_and(|entry| {
                Arc::ptr_eq(entry, &principal_slots)
                    && entry.available_permits() == state.live_principal_limit
            }) {
                slots.remove(&principal_user_id);
            }
        })
        .into_response()
}

async fn ws_session(mut socket: WebSocket, state: ApiState, claim: WebsocketTicketClaim) {
    let connection_id = Uuid::new_v4();
    if !websocket_session_active(&state, &claim).await {
        return;
    }
    let hello = hello_for(
        &state,
        Some(claim.principal_user_id.as_str()),
        Some(claim.game),
    )
    .await;
    if !websocket_session_active(&state, &claim).await {
        return;
    }
    if let Some(frame) = server_envelope_frame(&ServerEnvelope::new(0, ServerMsg::Hello(hello))) {
        let _ = socket.send(frame).await;
    }

    let game = claim.game;

    // Subscribe before hydration so commands cannot publish into a handshake gap.
    let mut live_projection_rx = state.live_projection.subscribe();
    let mut durable_poll = tokio::time::interval(state.websocket_poll_interval);
    durable_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut observed_seq = current_game_event_seq(&state, game)
        .await
        .unwrap_or(claim.after_seq);
    let mut next_envelope_id = 1;
    if let Ok(deltas) = current_votecount_deltas(&state, game).await {
        if !websocket_session_active(&state, &claim).await {
            return;
        }
        next_envelope_id = send_projection_deltas(&mut socket, next_envelope_id, deltas).await;
    }
    if let Some(delta) = thread_posts_delta_for_ws(
        &state,
        game,
        Some(claim.principal_user_id.as_str()),
        claim.channel.as_str(),
    )
    .await
    {
        if !websocket_session_active(&state, &claim).await {
            return;
        }
        next_envelope_id = send_projection_deltas(&mut socket, next_envelope_id, vec![delta]).await;
    }
    if let Some(delta) = host_console_state_delta_for_ws(
        &state,
        game,
        Some(claim.principal_user_id.as_str()),
        claim.slot_id.as_deref(),
    )
    .await
    {
        if !websocket_session_active(&state, &claim).await {
            return;
        }
        next_envelope_id = send_projection_deltas(&mut socket, next_envelope_id, vec![delta]).await;
    }
    if let Some(delta) =
        host_prompts_delta_for_ws(&state, game, Some(claim.principal_user_id.as_str())).await
    {
        if !websocket_session_active(&state, &claim).await {
            return;
        }
        next_envelope_id = send_projection_deltas(&mut socket, next_envelope_id, vec![delta]).await;
    }
    let private_deltas =
        player_private_deltas_for_ws(&state, game, Some(claim.principal_user_id.as_str())).await;
    if !private_deltas.is_empty() {
        if !websocket_session_active(&state, &claim).await {
            return;
        }
        next_envelope_id =
            send_projection_deltas(&mut socket, next_envelope_id, private_deltas).await;
    }

    loop {
        let receive = tokio::select! {
            update = live_projection::receive(&mut live_projection_rx) => Some(update),
            _ = durable_poll.tick() => None,
        };
        if !websocket_session_active(&state, &claim).await {
            break;
        }
        let Some(receive) = receive else {
            let latest_seq = current_game_event_seq(&state, game)
                .await
                .unwrap_or(observed_seq);
            if latest_seq <= observed_seq {
                continue;
            }
            observed_seq = latest_seq;
            let sent_to = send_projection_deltas(
                &mut socket,
                next_envelope_id,
                vec![ProjectionDelta::ResyncRequired {
                    from_seq: claim.after_seq,
                }],
            )
            .await;
            if sent_to == next_envelope_id {
                break;
            }
            next_envelope_id = sent_to;
            next_envelope_id =
                send_current_projection_snapshot(&mut socket, &state, &claim, next_envelope_id)
                    .await;
            continue;
        };
        observed_seq = current_game_event_seq(&state, game)
            .await
            .unwrap_or(observed_seq);
        let update = match receive {
            LiveProjectionReceive::Update(update) => update,
            LiveProjectionReceive::Lagged { dropped_messages } => {
                tracing::warn!(
                    event = "live_projection_receiver_lagged",
                    game_id = %game,
                    connection_id = %connection_id,
                    dropped_messages,
                    next_envelope_id,
                    "live projection receiver lagged; requesting client resync"
                );
                let sent_to = send_projection_deltas(
                    &mut socket,
                    next_envelope_id,
                    vec![ProjectionDelta::ResyncRequired { from_seq: 0 }],
                )
                .await;
                if sent_to == next_envelope_id {
                    break;
                }
                next_envelope_id = sent_to;
                continue;
            }
            LiveProjectionReceive::Closed => break,
        };
        if !state.live_projection_delivery_delay.is_zero() {
            tokio::time::sleep(state.live_projection_delivery_delay).await;
        }
        if update.game != game {
            continue;
        }
        if !websocket_session_active(&state, &claim).await {
            break;
        }
        let sent_to = send_projection_deltas(&mut socket, next_envelope_id, update.deltas).await;
        if sent_to == next_envelope_id
            && !update.thread_dirty
            && !update.host_console_dirty
            && !update.host_prompts_dirty
            && !update.player_private_dirty
            && !update.player_command_state_dirty
        {
            break;
        }
        next_envelope_id = sent_to;
        if update.thread_dirty {
            let Some(delta) = thread_posts_delta_for_ws(
                &state,
                game,
                Some(claim.principal_user_id.as_str()),
                claim.channel.as_str(),
            )
            .await
            else {
                continue;
            };
            if !websocket_session_active(&state, &claim).await {
                break;
            }
            let sent_to = send_projection_deltas(&mut socket, next_envelope_id, vec![delta]).await;
            if sent_to == next_envelope_id {
                break;
            }
            next_envelope_id = sent_to;
        }
        if update.host_console_dirty {
            if let Some(delta) = host_console_state_delta_for_ws(
                &state,
                game,
                Some(claim.principal_user_id.as_str()),
                claim.slot_id.as_deref(),
            )
            .await
            {
                if !websocket_session_active(&state, &claim).await {
                    break;
                }
                let sent_to =
                    send_projection_deltas(&mut socket, next_envelope_id, vec![delta]).await;
                if sent_to == next_envelope_id {
                    break;
                }
                next_envelope_id = sent_to;
            }
        }
        if update.host_prompts_dirty {
            if let Some(delta) =
                host_prompts_delta_for_ws(&state, game, Some(claim.principal_user_id.as_str()))
                    .await
            {
                if !websocket_session_active(&state, &claim).await {
                    break;
                }
                let sent_to =
                    send_projection_deltas(&mut socket, next_envelope_id, vec![delta]).await;
                if sent_to == next_envelope_id {
                    break;
                }
                next_envelope_id = sent_to;
            }
        }
        if update.player_private_dirty {
            let deltas =
                player_private_deltas_for_ws(&state, game, Some(claim.principal_user_id.as_str()))
                    .await;
            if deltas.is_empty() {
                continue;
            }
            if !websocket_session_active(&state, &claim).await {
                break;
            }
            let sent_to = send_projection_deltas(&mut socket, next_envelope_id, deltas).await;
            if sent_to == next_envelope_id {
                break;
            }
            next_envelope_id = sent_to;
        }
        if update.player_command_state_dirty {
            let sent_to = send_projection_deltas(
                &mut socket,
                next_envelope_id,
                vec![ProjectionDelta::ResyncRequired { from_seq: 0 }],
            )
            .await;
            if sent_to == next_envelope_id {
                break;
            }
            next_envelope_id = sent_to;
        }
    }
}

async fn current_game_event_seq(state: &ApiState, game: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT COALESCE(MAX(seq), 0) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&state.pool)
        .await
}

async fn send_current_projection_snapshot(
    socket: &mut WebSocket,
    state: &ApiState,
    claim: &WebsocketTicketClaim,
    mut next_envelope_id: u64,
) -> u64 {
    if let Ok(deltas) = current_votecount_deltas(state, claim.game).await {
        if !websocket_session_active(state, claim).await {
            return next_envelope_id;
        }
        next_envelope_id = send_projection_deltas(socket, next_envelope_id, deltas).await;
    }
    if let Some(delta) = thread_posts_delta_for_ws(
        state,
        claim.game,
        Some(claim.principal_user_id.as_str()),
        claim.channel.as_str(),
    )
    .await
    {
        if !websocket_session_active(state, claim).await {
            return next_envelope_id;
        }
        next_envelope_id = send_projection_deltas(socket, next_envelope_id, vec![delta]).await;
    }
    if let Some(delta) = host_console_state_delta_for_ws(
        state,
        claim.game,
        Some(claim.principal_user_id.as_str()),
        claim.slot_id.as_deref(),
    )
    .await
    {
        if !websocket_session_active(state, claim).await {
            return next_envelope_id;
        }
        next_envelope_id = send_projection_deltas(socket, next_envelope_id, vec![delta]).await;
    }
    if let Some(delta) =
        host_prompts_delta_for_ws(state, claim.game, Some(claim.principal_user_id.as_str())).await
    {
        if !websocket_session_active(state, claim).await {
            return next_envelope_id;
        }
        next_envelope_id = send_projection_deltas(socket, next_envelope_id, vec![delta]).await;
    }
    let deltas =
        player_private_deltas_for_ws(state, claim.game, Some(claim.principal_user_id.as_str()))
            .await;
    if !websocket_session_active(state, claim).await {
        return next_envelope_id;
    }
    send_projection_deltas(socket, next_envelope_id, deltas).await
}

async fn thread_posts_delta_for_ws(
    state: &ApiState,
    game: Uuid,
    principal_user_id: Option<&str>,
    channel: &str,
) -> Option<ProjectionDelta> {
    if channel != "main" {
        let principal_user_id = principal_user_id?;
        require_channel_thread_access(state, game, channel, Some(principal_user_id))
            .await
            .ok()?;
    }
    current_thread_posts_delta(state, game, channel).await.ok()
}

async fn host_console_state_delta_for_ws(
    state: &ApiState,
    game: Uuid,
    principal_user_id: Option<&str>,
    slot_id: Option<&str>,
) -> Option<ProjectionDelta> {
    let principal_user_id = principal_user_id?;
    let authority = resolve_host_console_authority(&state.pool, game, principal_user_id)
        .await
        .ok()??;
    load_host_console_state(&state.pool, game, authority, slot_id, Some(25))
        .await
        .ok()
        .map(HostConsoleStateDelta::from)
        .map(ProjectionDelta::HostConsoleStateChanged)
}

async fn host_prompts_delta_for_ws(
    state: &ApiState,
    game: Uuid,
    principal_user_id: Option<&str>,
) -> Option<ProjectionDelta> {
    let principal_user_id = principal_user_id?;
    require_host_audit_access(
        state,
        game,
        principal_user_id,
        "principal cannot read host prompts for this game",
    )
    .await
    .ok()?;

    projections::host_prompts(&state.pool, game)
        .await
        .ok()
        .map(|rows| HostPromptsDelta {
            game,
            prompts: rows.into_iter().map(HostPromptDelta::from).collect(),
        })
        .map(ProjectionDelta::HostPromptsChanged)
}

async fn player_private_deltas_for_ws(
    state: &ApiState,
    game: Uuid,
    principal_user_id: Option<&str>,
) -> Vec<ProjectionDelta> {
    let Some(principal_user_id) = principal_user_id else {
        return Vec::new();
    };

    let mut deltas = Vec::new();
    if let Ok(notifications) =
        player_notifications_for_principal(state, game, principal_user_id).await
    {
        deltas.push(ProjectionDelta::PlayerNotificationsChanged(
            PlayerNotificationsDelta {
                game,
                notifications,
            },
        ));
    }
    if let Ok(results) =
        player_investigation_results_for_principal(state, game, principal_user_id).await
    {
        deltas.push(ProjectionDelta::PlayerInvestigationResultsChanged(
            PlayerInvestigationResultsDelta { game, results },
        ));
    }
    deltas
}

async fn send_projection_deltas(
    socket: &mut WebSocket,
    mut next_envelope_id: u64,
    deltas: Vec<ProjectionDelta>,
) -> u64 {
    for delta in deltas {
        let envelope = ServerEnvelope::new(next_envelope_id, ServerMsg::Delta(delta));
        let Some(frame) = server_envelope_frame(&envelope) else {
            continue;
        };
        if socket.send(frame).await.is_err() {
            return next_envelope_id;
        }
        next_envelope_id += 1;
    }
    next_envelope_id
}

fn server_envelope_frame(envelope: &ServerEnvelope) -> Option<Message> {
    let mut bytes = Vec::new();
    ciborium::into_writer(envelope, &mut bytes).ok()?;
    Some(Message::Binary(bytes.into()))
}

async fn hello_for(state: &ApiState, principal_user_id: Option<&str>, game: Option<Uuid>) -> Hello {
    let caps = match (principal_user_id, game) {
        (Some(user), Some(game)) => caps::resolve(&state.pool, &Principal::user(user), game)
            .await
            .map(|set| set.iter().map(CapabilityGrant::from).collect())
            .unwrap_or_default(),
        _ => Vec::new(),
    };

    Hello {
        protocol_v: PROTOCOL_VERSION,
        server: state.server_name.clone(),
        caps,
    }
}

fn command_game(command: &wire::Command) -> Option<Uuid> {
    match command {
        wire::Command::CreateGame { game, .. }
        | wire::Command::AddSlot { game, .. }
        | wire::Command::AssignSlot { game, .. }
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
            | wire::Command::AssignSlot { .. }
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

#[cfg(test)]
mod command_publication_classification_tests {
    use super::*;

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

async fn require_host_audit_access(
    state: &ApiState,
    game: Uuid,
    principal_user_id: &str,
    message: &'static str,
) -> Result<(), ApiError> {
    let caps = caps::resolve(&state.pool, &Principal::user(principal_user_id), game).await?;
    if caps.grants(&Capability::HostOf(game)) || caps.grants(&Capability::CohostOf(game)) {
        return Ok(());
    }
    if active_global_operator(&state.pool, principal_user_id).await? {
        return Ok(());
    }

    Err(ApiError::Reject {
        status: StatusCode::FORBIDDEN,
        error: RejectCode::NotAuthorized,
        message: message.to_string(),
    })
}

async fn active_global_operator(pool: &PgPool, principal_user_id: &str) -> Result<bool, ApiError> {
    let now = unix_now_seconds();
    let has_global = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM auth_session
            WHERE principal_user_id = $1
              AND revoked_at IS NULL
              AND expires_at > $2
              AND global_capabilities && ARRAY['GlobalAdmin', 'GlobalMod']::TEXT[]
            UNION ALL
            SELECT 1
            FROM platform_principal
            WHERE principal_user_id = $1
              AND status = 'active'
              AND disabled_at IS NULL
              AND global_capabilities && ARRAY['GlobalAdmin', 'GlobalMod']::TEXT[]
        )
        "#,
    )
    .bind(principal_user_id)
    .bind(now)
    .fetch_one(pool)
    .await?;
    Ok(has_global)
}

fn protocol_reject(message: impl Into<String>) -> RejectMsg {
    RejectMsg {
        error: RejectCode::Internal,
        retryable: false,
        message: message.into(),
    }
}

#[derive(Debug)]
pub enum ApiError {
    Projection(projections::ProjectionError),
    Capability(caps::CapError),
    Db(sqlx::Error),
    Reject {
        status: StatusCode,
        error: RejectCode,
        message: String,
    },
    RateLimited {
        retry_after_seconds: i64,
        message: String,
    },
    Unavailable {
        retry_after_seconds: i64,
        message: String,
    },
}

impl From<projections::ProjectionError> for ApiError {
    fn from(err: projections::ProjectionError) -> Self {
        ApiError::Projection(err)
    }
}

impl From<caps::CapError> for ApiError {
    fn from(err: caps::CapError) -> Self {
        ApiError::Capability(err)
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        ApiError::Db(err)
    }
}

impl From<identity::IdentityFlowError> for ApiError {
    fn from(error: identity::IdentityFlowError) -> Self {
        use identity::IdentityFlowError;
        match error {
            IdentityFlowError::Unauthorized => unauthorized_session(),
            IdentityFlowError::RecentAuthRequired => ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "recent_authentication_required".to_string(),
            },
            IdentityFlowError::AlreadyExists(subject) => ApiError::Reject {
                status: StatusCode::CONFLICT,
                error: RejectCode::Internal,
                message: format!("{subject} already exists"),
            },
            IdentityFlowError::LastActiveMethod => ApiError::Reject {
                status: StatusCode::CONFLICT,
                error: RejectCode::Internal,
                message:
                    "an active principal must retain at least one active authentication method"
                        .to_string(),
            },
            IdentityFlowError::Invalid(message) => ApiError::Reject {
                status: StatusCode::BAD_REQUEST,
                error: RejectCode::Internal,
                message,
            },
            IdentityFlowError::Internal(message) => internal_auth_error(message),
            IdentityFlowError::Db(error) => ApiError::Db(error),
        }
    }
}

impl From<IdentityDeliveryError> for ApiError {
    fn from(error: IdentityDeliveryError) -> Self {
        match error {
            IdentityDeliveryError::Database(error) => ApiError::Db(error),
            IdentityDeliveryError::Credential(error) => ApiError::Reject {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                error: RejectCode::Internal,
                message: format!("identity delivery credential boundary failed: {error}"),
            },
        }
    }
}

fn command_reject_api_error(reject: commands::Reject) -> ApiError {
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

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let self_ = match self {
            ApiError::Db(ref error) if sqlx_capacity_error(error) => {
                return capacity_unavailable_response(
                    "database capacity is temporarily unavailable; retry shortly",
                    1,
                );
            }
            ApiError::Projection(ref error) if projection_capacity_error(error) => {
                return capacity_unavailable_response(
                    "database capacity is temporarily unavailable; retry shortly",
                    1,
                );
            }
            ApiError::Capability(ref error) if capability_capacity_error(error) => {
                return capacity_unavailable_response(
                    "database capacity is temporarily unavailable; retry shortly",
                    1,
                );
            }
            ApiError::RateLimited {
                retry_after_seconds,
                message,
            } => {
                let retry_after_seconds = retry_after_seconds.max(1);
                let mut response = (
                    StatusCode::TOO_MANY_REQUESTS,
                    Json(RejectMsg {
                        error: RejectCode::NotAuthorized,
                        retryable: true,
                        message,
                    }),
                )
                    .into_response();
                response.headers_mut().insert(
                    RETRY_AFTER,
                    HeaderValue::from_str(retry_after_seconds.to_string().as_str())
                        .unwrap_or_else(|_| HeaderValue::from_static("1")),
                );
                return response;
            }
            ApiError::Unavailable {
                retry_after_seconds,
                message,
            } => {
                let mut response = (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(RejectMsg {
                        error: RejectCode::Internal,
                        retryable: true,
                        message,
                    }),
                )
                    .into_response();
                response.headers_mut().insert(
                    RETRY_AFTER,
                    HeaderValue::from_str(retry_after_seconds.max(1).to_string().as_str())
                        .unwrap_or_else(|_| HeaderValue::from_static("1")),
                );
                return response;
            }
            other => other,
        };
        let (status, error, message) = match self_ {
            ApiError::Projection(err) => opaque_internal_error("projection", err),
            ApiError::Capability(err) => opaque_internal_error("capability", err),
            ApiError::Db(err) => opaque_internal_error("database", err),
            ApiError::Reject {
                status,
                error,
                message,
            } => (status, error, message),
            ApiError::RateLimited { .. } => unreachable!(),
            ApiError::Unavailable { .. } => unreachable!(),
        };
        (
            status,
            Json(RejectMsg {
                error,
                retryable: false,
                message,
            }),
        )
            .into_response()
    }
}

fn opaque_internal_error(
    boundary: &'static str,
    _error: impl std::fmt::Display,
) -> (StatusCode, RejectCode, String) {
    let reference = Uuid::new_v4();
    tracing::error!(%reference, %boundary, "request failed internally");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        RejectCode::Internal,
        format!("internal request failure; reference {reference}"),
    )
}

/// Shared overload response for the HTTP and WebSocket admission boundaries.
/// This is deliberately distinct from caller-scoped `429` rate limiting.
pub fn capacity_unavailable_response(
    message: impl Into<String>,
    retry_after_seconds: i64,
) -> Response {
    ApiError::Unavailable {
        retry_after_seconds,
        message: message.into(),
    }
    .into_response()
}

fn sqlx_capacity_error(error: &sqlx::Error) -> bool {
    match error {
        sqlx::Error::PoolTimedOut | sqlx::Error::PoolClosed => true,
        sqlx::Error::Database(error) => matches!(error.code().as_deref(), Some("57014" | "55P03")),
        _ => false,
    }
}

fn projection_capacity_error(error: &projections::ProjectionError) -> bool {
    match error {
        projections::ProjectionError::Db(error) => sqlx_capacity_error(error),
        projections::ProjectionError::Store(eventstore::StoreError::Db(error)) => {
            sqlx_capacity_error(error)
        }
        _ => false,
    }
}

fn capability_capacity_error(error: &caps::CapError) -> bool {
    match error {
        caps::CapError::Db(error) => sqlx_capacity_error(error),
        caps::CapError::Projection(error) => projection_capacity_error(error),
    }
}

#[cfg(test)]
mod capacity_error_tests {
    use super::*;

    #[test]
    fn database_pool_timeout_is_a_retryable_503() {
        let response =
            ApiError::Projection(projections::ProjectionError::Db(sqlx::Error::PoolTimedOut))
                .into_response();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers()[RETRY_AFTER], "1");
    }

    #[test]
    fn signed_edge_source_is_accepted_and_spoofed_source_is_collapsed() {
        use super::authentication::{
            normalized_auth_attempt_source, AuthAttemptPolicy, AUTH_ATTEMPT_SOURCE_HEADER,
            AUTH_ATTEMPT_SOURCE_SIGNATURE_HEADER, AUTH_ATTEMPT_SOURCE_TIMESTAMP_HEADER,
        };
        use hmac::{Hmac, Mac};
        use sha2::Sha256;

        let key = b"test-auth-source-signing-key-with-32-bytes-minimum";
        let policy = AuthAttemptPolicy {
            account_max_failures: 5,
            source_max_failures: 50,
            registration_max_per_source: 5,
            window_seconds: 900,
            lockout_seconds: 900,
            retention_seconds: 3_600,
            trust_source_header: false,
            source_signing_key: Some(Arc::<[u8]>::from(key.to_vec())),
        };
        let source = "203.0.113.45";
        let timestamp = unix_now_seconds().to_string();
        let mut mac = Hmac::<Sha256>::new_from_slice(key).unwrap();
        mac.update(timestamp.as_bytes());
        mac.update(b"\n");
        mac.update(source.as_bytes());
        let signature = mac.finalize().into_bytes();
        let signature = signature
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let mut headers = HeaderMap::new();
        headers.insert(AUTH_ATTEMPT_SOURCE_HEADER, source.parse().unwrap());
        headers.insert(
            AUTH_ATTEMPT_SOURCE_TIMESTAMP_HEADER,
            timestamp.parse().unwrap(),
        );
        headers.insert(
            AUTH_ATTEMPT_SOURCE_SIGNATURE_HEADER,
            signature.parse().unwrap(),
        );
        assert_eq!(normalized_auth_attempt_source(&headers, &policy), source);

        headers.insert(
            AUTH_ATTEMPT_SOURCE_SIGNATURE_HEADER,
            "00".repeat(32).parse().unwrap(),
        );
        assert_eq!(
            normalized_auth_attempt_source(&headers, &policy),
            "unattributed"
        );
    }

    #[test]
    fn dedicated_workload_capacity_rejects_excess_parallel_work() {
        let slots = Arc::new(Semaphore::new(1));
        let _first = acquire_workload_slot(&slots, "busy").unwrap();
        assert!(matches!(
            acquire_workload_slot(&slots, "busy"),
            Err(ApiError::Unavailable { .. })
        ));
    }
}
