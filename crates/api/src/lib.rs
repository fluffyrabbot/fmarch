//! `api` — the first network boundary over the command pipeline.
//!
//! The command crate remains pre-HTTP. This crate owns HTTP/WebSocket decoding,
//! temporary dev-principal extraction, and mapping command outcomes into `wire`
//! messages.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use caps::{Capability, Principal};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPool;
use std::collections::HashSet;
use std::path::Path as FsPath;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;
use uuid::Uuid;
use wire::{
    AckMsg, CapabilityGrant, ClientEnvelope, DayVoteOutcomeDelta, Hello,
    HostConsolePhaseStateDelta, HostConsoleSlotOccupancyDelta, HostConsoleStateDelta,
    HostConsoleThreadPostDelta, HostPhaseControl, HostPromptDelta, HostPromptsDelta,
    PlayerInvestigationResult, PlayerInvestigationResultsDelta, PlayerNotification,
    PlayerNotificationsDelta, ProjectionDelta, RejectCode, RejectMsg, ServerEnvelope, ServerMsg,
    ThreadPage, ThreadPost, ThreadPostsDelta, VoteCountClearedDelta, VoteCountDelta,
    PROTOCOL_VERSION,
};

#[derive(Clone)]
pub struct ApiState {
    pool: PgPool,
    server_name: String,
    dev_auth_enabled: bool,
    live_projection_tx: broadcast::Sender<LiveProjectionUpdate>,
}

#[derive(Debug, Clone)]
struct LiveProjectionUpdate {
    game: Uuid,
    deltas: Vec<ProjectionDelta>,
    thread_dirty: bool,
    host_console_dirty: bool,
    host_prompts_dirty: bool,
    player_private_dirty: bool,
}

impl ApiState {
    pub fn new(pool: PgPool) -> Self {
        let (live_projection_tx, _) = broadcast::channel(256);
        ApiState {
            pool,
            server_name: "fmarch-dev".to_string(),
            dev_auth_enabled: std::env::var("FMARCH_DEV_AUTH").ok().as_deref() == Some("1"),
            live_projection_tx,
        }
    }

    pub fn with_server_name(mut self, name: impl Into<String>) -> Self {
        self.server_name = name.into();
        self
    }

    pub fn with_dev_auth(mut self, enabled: bool) -> Self {
        self.dev_auth_enabled = enabled;
        self
    }
}

pub fn router(pool: PgPool) -> Router {
    router_with_state(ApiState::new(pool))
}

pub fn router_with_state(state: ApiState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/auth/session", get(auth_session))
        .route("/auth/dev-session", post(create_dev_auth_session))
        .route("/auth/session-grants", post(create_auth_session_grant))
        .route("/commands", post(command))
        .route("/games/{game}/votecount", get(votecount))
        .route("/games/{game}/day-vote-outcomes", get(day_vote_outcomes))
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
        .route("/ws", get(ws))
        .with_state(state)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Health {
    pub ok: bool,
}

async fn healthz() -> Json<Health> {
    Json(Health { ok: true })
}

#[derive(Debug, Clone, Deserialize)]
struct AuthSessionQuery {
    game: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthSessionResponse {
    principal_user_id: String,
    capabilities: Vec<CapabilityGrant>,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateDevAuthSession {
    token: String,
    principal_user_id: String,
    expires_at: i64,
    #[serde(default)]
    global_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateAuthSessionGrant {
    token: String,
    principal_user_id: String,
    expires_at: i64,
    #[serde(default)]
    global_capabilities: Vec<String>,
}

async fn auth_session(
    State(state): State<ApiState>,
    Query(query): Query<AuthSessionQuery>,
    headers: HeaderMap,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let token_hash = hash_session_token(token);
    let now = unix_now_seconds();
    let (principal_user_id, global_capabilities) = sqlx::query_as::<_, (String, Vec<String>)>(
        r#"
        SELECT principal_user_id, global_capabilities
        FROM auth_session
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > $2
        "#,
    )
    .bind(token_hash)
    .bind(now)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(unauthorized_session)?;

    Ok(Json(
        auth_session_response(&state, principal_user_id, query.game, global_capabilities).await?,
    ))
}

async fn create_dev_auth_session(
    State(state): State<ApiState>,
    Json(request): Json<CreateDevAuthSession>,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    if !state.dev_auth_enabled {
        return Err(ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::NotAuthorized,
            message: "dev auth session endpoint is disabled".to_string(),
        });
    }

    let token = request.token.trim();
    if token.is_empty() || request.principal_user_id.trim().is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "dev auth session requires token and principal_user_id".to_string(),
        });
    }
    let global_capabilities = normalize_dev_global_capabilities(&request.global_capabilities)?;

    let now = unix_now_seconds();
    sqlx::query(
        r#"
        INSERT INTO auth_session (
            token_hash,
            principal_user_id,
            created_at,
            expires_at,
            revoked_at,
            global_capabilities
        )
        VALUES ($1, $2, $3, $4, NULL, $5)
        ON CONFLICT (token_hash) DO UPDATE
        SET principal_user_id = EXCLUDED.principal_user_id,
            expires_at = EXCLUDED.expires_at,
            revoked_at = NULL,
            global_capabilities = EXCLUDED.global_capabilities
        "#,
    )
    .bind(hash_session_token(token))
    .bind(request.principal_user_id.as_str())
    .bind(now)
    .bind(request.expires_at)
    .bind(&global_capabilities)
    .execute(&state.pool)
    .await?;

    Ok(Json(
        auth_session_response(&state, request.principal_user_id, None, global_capabilities).await?,
    ))
}

async fn create_auth_session_grant(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<CreateAuthSessionGrant>,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let (_, caller_global_capabilities) =
        active_session_principal_and_globals(&state, caller_token).await?;
    if !caller_global_capabilities
        .iter()
        .any(|capability| capability == "GlobalAdmin")
    {
        return Err(ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: "session grants require GlobalAdmin".to_string(),
        });
    }

    let token = request.token.trim();
    if token.is_empty() || request.principal_user_id.trim().is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "session grant requires token and principal_user_id".to_string(),
        });
    }
    let global_capabilities = normalize_global_capabilities(&request.global_capabilities)?;

    upsert_auth_session(
        &state,
        token,
        request.principal_user_id.as_str(),
        request.expires_at,
        &global_capabilities,
    )
    .await?;

    Ok(Json(
        auth_session_response(&state, request.principal_user_id, None, global_capabilities).await?,
    ))
}

async fn auth_session_response(
    state: &ApiState,
    principal_user_id: String,
    game: Option<Uuid>,
    global_capabilities: Vec<String>,
) -> Result<AuthSessionResponse, ApiError> {
    let mut capabilities = global_capability_grants(&global_capabilities);
    let game_capabilities: Vec<_> = match game {
        Some(game) => caps::resolve(
            &state.pool,
            &Principal::user(principal_user_id.as_str()),
            game,
        )
        .await?
        .iter()
        .map(CapabilityGrant::from)
        .collect(),
        None => Vec::new(),
    };
    capabilities.extend(game_capabilities);

    Ok(AuthSessionResponse {
        principal_user_id,
        capabilities,
    })
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|token| !token.is_empty())
}

async fn active_session_principal_and_globals(
    state: &ApiState,
    token: &str,
) -> Result<(String, Vec<String>), ApiError> {
    let token_hash = hash_session_token(token);
    let now = unix_now_seconds();
    sqlx::query_as::<_, (String, Vec<String>)>(
        r#"
        SELECT principal_user_id, global_capabilities
        FROM auth_session
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > $2
        "#,
    )
    .bind(token_hash)
    .bind(now)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(unauthorized_session)
}

fn unauthorized_session() -> ApiError {
    ApiError::Reject {
        status: StatusCode::UNAUTHORIZED,
        error: RejectCode::NotAuthorized,
        message: "session token is missing, expired, or revoked".to_string(),
    }
}

fn normalize_dev_global_capabilities(values: &[String]) -> Result<Vec<String>, ApiError> {
    normalize_global_capabilities(values)
}

fn normalize_global_capabilities(values: &[String]) -> Result<Vec<String>, ApiError> {
    let mut normalized = Vec::new();
    for value in values {
        let capability = value.trim();
        match capability {
            "GlobalAdmin" | "GlobalMod" => {
                if !normalized.iter().any(|existing| existing == capability) {
                    normalized.push(capability.to_string());
                }
            }
            _ => {
                return Err(ApiError::Reject {
                    status: StatusCode::BAD_REQUEST,
                    error: RejectCode::Internal,
                    message: format!("unsupported global capability: {capability}"),
                });
            }
        }
    }
    Ok(normalized)
}

async fn upsert_auth_session(
    state: &ApiState,
    token: &str,
    principal_user_id: &str,
    expires_at: i64,
    global_capabilities: &[String],
) -> Result<(), ApiError> {
    let now = unix_now_seconds();
    sqlx::query(
        r#"
        INSERT INTO auth_session (
            token_hash,
            principal_user_id,
            created_at,
            expires_at,
            revoked_at,
            global_capabilities
        )
        VALUES ($1, $2, $3, $4, NULL, $5)
        ON CONFLICT (token_hash) DO UPDATE
        SET principal_user_id = EXCLUDED.principal_user_id,
            expires_at = EXCLUDED.expires_at,
            revoked_at = NULL,
            global_capabilities = EXCLUDED.global_capabilities
        "#,
    )
    .bind(hash_session_token(token))
    .bind(principal_user_id)
    .bind(now)
    .bind(expires_at)
    .bind(global_capabilities)
    .execute(&state.pool)
    .await?;
    Ok(())
}

fn global_capability_grants(values: &[String]) -> Vec<CapabilityGrant> {
    values
        .iter()
        .filter_map(|value| match value.as_str() {
            "GlobalAdmin" => Some(CapabilityGrant::GlobalAdmin),
            "GlobalMod" => Some(CapabilityGrant::GlobalMod),
            _ => None,
        })
        .collect()
}

fn hash_session_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

fn unix_now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

async fn command(
    State(state): State<ApiState>,
    Json(envelope): Json<ClientEnvelope>,
) -> impl IntoResponse {
    if envelope.v != PROTOCOL_VERSION {
        return Json(ServerEnvelope::new(
            envelope.id,
            ServerMsg::Reject(protocol_reject("unsupported protocol version")),
        ));
    }

    let wire::ClientMsg::Command(msg) = envelope.body else {
        return Json(ServerEnvelope::new(
            envelope.id,
            ServerMsg::Reject(protocol_reject("expected command message")),
        ));
    };

    let game = command_game(&msg.command);
    let thread_dirty = command_affects_thread(&msg.command);
    let host_console_dirty = command_affects_host_console(&msg.command);
    let host_prompts_dirty = command_affects_host_prompts(&msg.command);
    let player_private_dirty = command_affects_player_private(&msg.command);
    let previous_votecount = match game {
        Some(game) => current_votecount_rows(&state, game).await.ok(),
        None => None,
    };
    let principal = Principal::user(msg.principal_user_id);
    let body = match commands::handle_idempotent(
        &state.pool,
        &principal,
        msg.command_id,
        msg.command.into(),
    )
    .await
    {
        Ok(ack) => {
            if let Some(game) = game {
                publish_live_projection_change(
                    &state,
                    game,
                    previous_votecount,
                    thread_dirty,
                    host_console_dirty,
                    host_prompts_dirty,
                    player_private_dirty,
                )
                .await;
            }
            ServerMsg::Ack(AckMsg::from(ack))
        }
        Err(reject) => ServerMsg::Reject(RejectMsg::from(reject)),
    };
    Json(ServerEnvelope::new(envelope.id, body))
}

async fn publish_live_projection_change(
    state: &ApiState,
    game: Uuid,
    previous: Option<Vec<VoteCountDelta>>,
    thread_dirty: bool,
    host_console_dirty: bool,
    host_prompts_dirty: bool,
    player_private_dirty: bool,
) {
    let Ok(current) = current_votecount_rows(state, game).await else {
        return;
    };
    let mut deltas: Vec<_> = current
        .iter()
        .cloned()
        .map(ProjectionDelta::VoteCountChanged)
        .collect();

    if let Some(previous) = previous {
        let current_keys: HashSet<_> = current
            .iter()
            .map(|delta| (delta.phase_id.as_str(), delta.candidate_slot.as_str()))
            .collect();
        deltas.extend(
            previous
                .into_iter()
                .filter(|delta| {
                    !current_keys
                        .contains(&(delta.phase_id.as_str(), delta.candidate_slot.as_str()))
                })
                .map(VoteCountClearedDelta::from)
                .map(ProjectionDelta::VoteCountCleared),
        );
    }

    if deltas.is_empty()
        && !thread_dirty
        && !host_console_dirty
        && !host_prompts_dirty
        && !player_private_dirty
    {
        return;
    }
    let _ = state.live_projection_tx.send(LiveProjectionUpdate {
        game,
        deltas,
        thread_dirty,
        host_console_dirty,
        host_prompts_dirty,
        player_private_dirty,
    });
}

async fn votecount(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
) -> Result<Json<Vec<ProjectionDelta>>, ApiError> {
    Ok(Json(current_votecount_deltas(&state, game).await?))
}

async fn current_votecount_deltas(
    state: &ApiState,
    game: Uuid,
) -> Result<Vec<ProjectionDelta>, projections::ProjectionError> {
    Ok(current_votecount_rows(state, game)
        .await?
        .into_iter()
        .map(ProjectionDelta::VoteCountChanged)
        .collect())
}

async fn current_votecount_rows(
    state: &ApiState,
    game: Uuid,
) -> Result<Vec<VoteCountDelta>, projections::ProjectionError> {
    let rows = projections::votecount(&state.pool, game).await?;
    Ok(rows.into_iter().map(VoteCountDelta::from).collect())
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
struct ChannelThreadQuery {
    before_seq: Option<i64>,
    limit: Option<i64>,
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
) -> Result<Json<ThreadPage>, ApiError> {
    if channel != "main" {
        require_channel_thread_access(
            &state,
            game,
            channel.as_str(),
            query.principal_user_id.as_deref(),
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
) -> Result<ProjectionDelta, projections::ProjectionError> {
    let page = projections::thread_view(&state.pool, game, None, 50).await?;
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
    if caps.grants(&Capability::HostOf(game))
        || caps.grants(&Capability::CohostOf(game))
        || caps.grants(&channel_cap)
        || (channel == "dead" && caps.grants(&dead_channel_cap))
    {
        return Ok(());
    }

    Err(ApiError::Reject {
        status: StatusCode::FORBIDDEN,
        error: RejectCode::NotAuthorized,
        message: "principal cannot read channel thread for this game".to_string(),
    })
}

#[derive(Debug, Clone, Deserialize)]
struct NotificationQuery {
    principal_user_id: String,
}

async fn player_notifications(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<NotificationQuery>,
) -> Result<Json<Vec<PlayerNotification>>, ApiError> {
    Ok(Json(
        player_notifications_for_principal(&state, game, query.principal_user_id.as_str()).await?,
    ))
}

async fn player_investigation_results(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<NotificationQuery>,
) -> Result<Json<Vec<PlayerInvestigationResult>>, ApiError> {
    Ok(Json(
        player_investigation_results_for_principal(&state, game, query.principal_user_id.as_str())
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
    principal_user_id: String,
    #[serde(default)]
    slot_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerCommandStateResponse {
    pub game: Uuid,
    pub actor_slot: Option<String>,
    pub role_key: Option<String>,
    pub phase: Option<PlayerCommandPhaseState>,
    pub actions: Vec<PlayerCommandAction>,
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

async fn player_command_state(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<PlayerCommandStateQuery>,
) -> Result<Json<PlayerCommandStateResponse>, ApiError> {
    let caps = caps::resolve(
        &state.pool,
        &Principal::user(query.principal_user_id.as_str()),
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
    let phase_view = phase
        .as_ref()
        .and_then(|phase| player_phase_state(phase).ok());
    let actions = if actor.alive {
        match (phase.as_ref(), role_key.as_deref()) {
            (Some(phase), Some(role_key)) if !phase.locked => {
                available_role_actions(&state, game, phase, &slots, actor, role_key).await?
            }
            _ => Vec::new(),
        }
    } else {
        Vec::new()
    };

    Ok(Json(PlayerCommandStateResponse {
        game,
        actor_slot: Some(actor_slot),
        role_key,
        phase: phase_view,
        actions,
        boundary: "Role-action availability is derived from committed phase_state, slot_state, the actor role in the game pack, and conservative target candidates. Final command validation still happens at /commands.".to_string(),
    }))
}

async fn available_role_actions(
    state: &ApiState,
    game: Uuid,
    phase: &projections::PhaseStateRow,
    slots: &[projections::SlotStateRow],
    actor: &projections::SlotStateRow,
    role_key: &str,
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
    slots
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
        .collect()
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
    phase_id
        .get(1..)
        .and_then(|raw| raw.parse::<u32>().ok())
        .filter(|number| *number > 0)
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: RejectCode::Internal,
            message: format!("invalid phase id `{phase_id}`"),
        })
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

#[derive(Debug, Clone, Deserialize)]
struct HostPhaseControlQuery {
    principal_user_id: String,
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
            resolved_by: row.resolved_by,
            resolved_at: row.resolved_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct HostConsoleStateQuery {
    principal_user_id: String,
    #[serde(default)]
    slot_id: Option<String>,
    #[serde(default)]
    limit: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostConsoleStateResponse {
    pub game: Uuid,
    pub phase: Option<HostConsolePhaseState>,
    pub slots: Vec<HostConsoleSlotOccupancy>,
    pub thread_posts: Vec<HostConsoleThreadPost>,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostConsoleThreadPost {
    pub stream_seq: i64,
    pub author_slot: Option<String>,
    pub author_user: Option<String>,
    pub phase_id: String,
    pub body: String,
}

impl From<HostConsoleStateResponse> for HostConsoleStateDelta {
    fn from(response: HostConsoleStateResponse) -> Self {
        HostConsoleStateDelta {
            game: response.game,
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
    Query(query): Query<HostPhaseControlQuery>,
) -> Result<Json<Vec<HostPhaseControl>>, ApiError> {
    require_host_audit_access(
        &state,
        game,
        query.principal_user_id.as_str(),
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
    Query(query): Query<HostPhaseControlQuery>,
) -> Result<Json<Vec<HostPrompt>>, ApiError> {
    require_host_audit_access(
        &state,
        game,
        query.principal_user_id.as_str(),
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
) -> Result<Json<HostConsoleStateResponse>, ApiError> {
    require_host_audit_access(
        &state,
        game,
        query.principal_user_id.as_str(),
        "principal cannot read host console state for this game",
    )
    .await?;

    Ok(Json(
        load_host_console_state(&state, game, query.slot_id.as_deref(), query.limit).await?,
    ))
}

async fn load_host_console_state(
    state: &ApiState,
    game: Uuid,
    slot_id: Option<&str>,
    limit: Option<i64>,
) -> Result<HostConsoleStateResponse, ApiError> {
    let phase = projections::phase_state(&state.pool, game)
        .await?
        .map(|row| HostConsolePhaseState {
            phase_id: row.phase_id,
            locked: row.locked,
            deadline: row.deadline,
        });

    let slot_states = projections::slot_state(&state.pool, game).await?;
    let slots = projections::slot_occupancy(&state.pool, game)
        .await?
        .into_iter()
        .filter(|row| slot_id.map_or(true, |slot_id| row.slot_id == slot_id))
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
            }
        })
        .collect();

    let thread_posts = projections::thread_view(&state.pool, game, None, limit.unwrap_or(25))
        .await?
        .posts
        .into_iter()
        .filter(|post| slot_id.map_or(true, |slot_id| post.author_slot.as_deref() == Some(slot_id)))
        .map(|post| HostConsoleThreadPost {
            stream_seq: post.stream_seq,
            author_slot: post.author_slot,
            author_user: post.author_user,
            phase_id: post.phase_id,
            body: post.body,
        })
        .collect();

    Ok(HostConsoleStateResponse {
        game,
        phase,
        slots,
        thread_posts,
    })
}

#[derive(Debug, Clone, Deserialize)]
struct WsParams {
    principal_user_id: Option<String>,
    game: Option<Uuid>,
    slot_id: Option<String>,
}

async fn ws(
    State(state): State<ApiState>,
    Query(params): Query<WsParams>,
    upgrade: WebSocketUpgrade,
) -> impl IntoResponse {
    upgrade.on_upgrade(move |socket| ws_session(socket, state, params))
}

async fn ws_session(mut socket: WebSocket, state: ApiState, params: WsParams) {
    let hello = hello_for(&state, params.principal_user_id.as_deref(), params.game).await;
    if let Ok(text) = serde_json::to_string(&ServerEnvelope::new(0, ServerMsg::Hello(hello))) {
        let _ = socket.send(Message::Text(text.into())).await;
    }

    let Some(game) = params.game else {
        return;
    };

    let mut next_envelope_id = 1;
    if let Ok(deltas) = current_votecount_deltas(&state, game).await {
        next_envelope_id = send_projection_deltas(&mut socket, next_envelope_id, deltas).await;
    }
    if let Ok(delta) = current_thread_posts_delta(&state, game).await {
        next_envelope_id = send_projection_deltas(&mut socket, next_envelope_id, vec![delta]).await;
    }
    if let Some(delta) = host_console_state_delta_for_ws(
        &state,
        game,
        params.principal_user_id.as_deref(),
        params.slot_id.as_deref(),
    )
    .await
    {
        next_envelope_id = send_projection_deltas(&mut socket, next_envelope_id, vec![delta]).await;
    }
    if let Some(delta) =
        host_prompts_delta_for_ws(&state, game, params.principal_user_id.as_deref()).await
    {
        next_envelope_id = send_projection_deltas(&mut socket, next_envelope_id, vec![delta]).await;
    }
    let private_deltas =
        player_private_deltas_for_ws(&state, game, params.principal_user_id.as_deref()).await;
    if !private_deltas.is_empty() {
        next_envelope_id =
            send_projection_deltas(&mut socket, next_envelope_id, private_deltas).await;
    }

    let mut live_projection_rx = state.live_projection_tx.subscribe();
    while let Ok(update) = live_projection_rx.recv().await {
        if update.game != game {
            continue;
        }
        let sent_to = send_projection_deltas(&mut socket, next_envelope_id, update.deltas).await;
        if sent_to == next_envelope_id
            && !update.thread_dirty
            && !update.host_console_dirty
            && !update.host_prompts_dirty
            && !update.player_private_dirty
        {
            break;
        }
        next_envelope_id = sent_to;
        if update.thread_dirty {
            let Ok(delta) = current_thread_posts_delta(&state, game).await else {
                continue;
            };
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
                params.principal_user_id.as_deref(),
                params.slot_id.as_deref(),
            )
            .await
            {
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
                host_prompts_delta_for_ws(&state, game, params.principal_user_id.as_deref()).await
            {
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
                player_private_deltas_for_ws(&state, game, params.principal_user_id.as_deref())
                    .await;
            if deltas.is_empty() {
                continue;
            }
            let sent_to = send_projection_deltas(&mut socket, next_envelope_id, deltas).await;
            if sent_to == next_envelope_id {
                break;
            }
            next_envelope_id = sent_to;
        }
    }
}

async fn host_console_state_delta_for_ws(
    state: &ApiState,
    game: Uuid,
    principal_user_id: Option<&str>,
    slot_id: Option<&str>,
) -> Option<ProjectionDelta> {
    let principal_user_id = principal_user_id?;
    require_host_audit_access(
        state,
        game,
        principal_user_id,
        "principal cannot read host console state for this game",
    )
    .await
    .ok()?;
    load_host_console_state(state, game, slot_id, Some(25))
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
        let Ok(text) = serde_json::to_string(&envelope) else {
            continue;
        };
        if socket.send(Message::Text(text.into())).await.is_err() {
            return next_envelope_id;
        }
        next_envelope_id += 1;
    }
    next_envelope_id
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
        | wire::Command::AddCohost { game, .. }
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
        | wire::Command::SubmitVote { game, .. }
        | wire::Command::WithdrawVote { game, .. }
        | wire::Command::SubmitAction { game, .. }
        | wire::Command::WithdrawAction { game, .. }
        | wire::Command::SubmitPost { game, .. }
        | wire::Command::ExtendDeadline { game, .. }
        | wire::Command::ProcessReplacement { game, .. } => Some(*game),
    }
}

fn command_affects_host_console(command: &wire::Command) -> bool {
    matches!(
        command,
        wire::Command::SetSlotStatus { .. }
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
            | wire::Command::SubmitPost { .. }
            | wire::Command::ExtendDeadline { .. }
            | wire::Command::ProcessReplacement { .. }
    )
}

fn command_affects_thread(command: &wire::Command) -> bool {
    matches!(
        command,
        wire::Command::ResolvePhase { .. }
            | wire::Command::SubmitAction { .. }
            | wire::Command::SubmitPost { .. }
            | wire::Command::PublishVotecount { .. }
    )
}

fn command_affects_host_prompts(command: &wire::Command) -> bool {
    matches!(
        command,
        wire::Command::SetSlotStatus { .. }
            | wire::Command::ResolvePhase { .. }
            | wire::Command::ResolveHostPrompt { .. }
    )
}

fn command_affects_player_private(command: &wire::Command) -> bool {
    matches!(
        command,
        wire::Command::ResolvePhase { .. }
            | wire::Command::ResolveHostPrompt { .. }
            | wire::Command::SubmitAction { .. }
            | wire::Command::WithdrawAction { .. }
    )
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

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let (status, error, message) = match self {
            ApiError::Projection(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                RejectCode::Internal,
                err.to_string(),
            ),
            ApiError::Capability(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                RejectCode::Internal,
                err.to_string(),
            ),
            ApiError::Db(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                RejectCode::Internal,
                err.to_string(),
            ),
            ApiError::Reject {
                status,
                error,
                message,
            } => (status, error, message),
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
