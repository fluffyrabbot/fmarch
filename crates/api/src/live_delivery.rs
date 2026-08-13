//! Authenticated WebSocket live transport: tickets, admission, session loop,
//! hydration, durable seq poll, lag resync, and binary-CBOR framing.
//!
//! Live change classification and broadcast publication remain in
//! `live_projection`. This module consumes that publisher plus narrow
//! game-read adapters.

use super::auth_http::{
    authorization_context, bearer_token, hash_session_token, unauthorized_session,
    unix_now_seconds, AuthHttpState, AuthorizationContext,
};
use super::authentication::enforce_public_request_limit;
use super::live_projection::{self, LiveProjectionPublisher, LiveProjectionReceive};
use super::{capacity_unavailable_response, game_http, ApiError, ApiState};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use caps::{Capability, Principal};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, Semaphore};
use uuid::Uuid;
use wire::{
    CapabilityGrant, Hello, HostConsoleStateDelta, HostPromptDelta, HostPromptsDelta,
    PlayerInvestigationResultsDelta, PlayerNotificationsDelta, ProjectionDelta, RejectCode,
    ServerEnvelope, ServerMsg, PROTOCOL_VERSION,
};

/// Wake source for the durable cross-instance event poll in the live session loop.
///
/// `PollEventWake` is the current interval-based implementation. A future
/// LISTEN/NOTIFY adapter can implement the same contract without changing the
/// select! shape that also receives live projection broadcasts.
pub(super) trait EventWake {
    fn wait(&mut self) -> impl std::future::Future<Output = ()> + Send;
}

/// Interval-based durable event wake used when no push notification path exists.
pub(super) struct PollEventWake {
    interval: tokio::time::Interval,
}

impl PollEventWake {
    pub(super) fn new(period: Duration) -> Self {
        let mut interval = tokio::time::interval(period);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        Self { interval }
    }
}

impl EventWake for PollEventWake {
    async fn wait(&mut self) {
        self.interval.tick().await;
    }
}

#[derive(Clone)]
pub(super) struct LiveDeliveryState {
    pool: PgPool,
    auth: AuthHttpState,
    server_name: String,
    live_projection: LiveProjectionPublisher,
    live_projection_delivery_delay: Duration,
    live_connection_slots: Arc<Semaphore>,
    live_principal_slots: Arc<Mutex<HashMap<String, Arc<Semaphore>>>>,
    live_principal_limit: usize,
    websocket_poll_interval: Duration,
}

impl LiveDeliveryState {
    fn new(state: &ApiState) -> Self {
        Self {
            pool: state.pool.clone(),
            auth: state.auth.clone(),
            server_name: state.server_name.clone(),
            live_projection: state.live_projection.clone(),
            live_projection_delivery_delay: state.live_projection_delivery_delay,
            live_connection_slots: state.live_connection_slots.clone(),
            live_principal_slots: state.live_principal_slots.clone(),
            live_principal_limit: state.live_principal_limit,
            websocket_poll_interval: state.websocket_poll_interval,
        }
    }
}

pub(super) fn routes(state: &ApiState) -> Router<ApiState> {
    Router::new()
        .route("/auth/websocket-tickets", post(create_websocket_ticket))
        .route("/ws", get(ws))
        .with_state(LiveDeliveryState::new(state))
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
}

#[derive(Debug, Clone)]
struct WebsocketTicketClaim {
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

fn authorization_kind(authorization: &AuthorizationContext) -> &'static str {
    match authorization.assurance {
        identity::Assurance::Password => "classic",
        identity::Assurance::ExternalSso => "workos",
        identity::Assurance::Dev => "dev",
        identity::Assurance::AdminGrant => "admin_grant",
    }
}

async fn create_websocket_ticket(
    State(state): State<LiveDeliveryState>,
    headers: HeaderMap,
    Json(request): Json<CreateWebsocketTicket>,
) -> Result<Json<WebsocketTicketResponse>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let authorization = authorization_context(&state.auth, token).await?;
    let principal_user_id = authorization.principal_user_id.clone();
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
            status: axum::http::StatusCode::BAD_REQUEST,
            error: RejectCode::NotAuthorized,
            message: "invalid websocket ticket scope".to_string(),
        });
    }

    // Validate the requested private scope before minting bearer authority.
    if channel != "main" {
        game_http::require_channel_thread_access(
            &state.pool,
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
                status: axum::http::StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "principal cannot mint the requested websocket scope".to_string(),
            });
        }
    }

    let issued_at = unix_now_seconds();
    if authorization.expires_at <= issued_at {
        return Err(unauthorized_session());
    }
    let expires_at = issued_at
        .saturating_add(state.auth.websocket_ticket_ttl.as_secs() as i64)
        .min(authorization.expires_at);
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
    .bind(authorization_kind(&authorization))
    .bind(authorization.session_reference)
    .bind(authorization.idle_expires_at.min(authorization.expires_at))
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
    state: &LiveDeliveryState,
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
    let row = sqlx::query_as::<_, (String, i64, String, Uuid, String, Option<String>, i64)>(
        r#"
        UPDATE auth_websocket_ticket AS ticket
        SET consumed_at = $3
        WHERE ticket.token_hash = $1
          AND ticket.audience = $2
          AND ticket.consumed_at IS NULL
          AND ticket.expires_at > $3
          AND ticket.access_expires_at > $3
        RETURNING ticket.session_reference, ticket.access_expires_at,
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
        session_reference: row.0,
        access_expires_at: row.1,
        principal_user_id: row.2,
        game: row.3,
        channel: row.4,
        slot_id: row.5,
        after_seq: row.6,
    };
    if !websocket_session_active(state, &claim).await {
        return Err(unauthorized_session());
    }
    Ok(claim)
}

async fn websocket_session_active(state: &LiveDeliveryState, claim: &WebsocketTicketClaim) -> bool {
    websocket_authorization_context(state, claim)
        .await
        .is_some()
}

async fn websocket_authorization_context(
    state: &LiveDeliveryState,
    claim: &WebsocketTicketClaim,
) -> Option<AuthorizationContext> {
    let now = unix_now_seconds();
    if claim.access_expires_at <= now {
        return None;
    }
    let authorization = identity::session::validate_session_reference(
        &state.pool,
        claim.session_reference.as_str(),
        &state.auth.session_policy,
        now,
    )
    .await
    .ok()?;
    (authorization.principal_user_id == claim.principal_user_id).then_some(authorization)
}

async fn ws(
    State(state): State<LiveDeliveryState>,
    Query(params): Query<WsParams>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let claim = if params.ticket.is_some() || params.audience.is_some() {
        match redeem_websocket_ticket(&state, &params).await {
            Ok(claim) => claim,
            Err(error) => return error.into_response(),
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

async fn ws_session(mut socket: WebSocket, state: LiveDeliveryState, claim: WebsocketTicketClaim) {
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
    let mut event_wake = PollEventWake::new(state.websocket_poll_interval);
    let mut observed_seq = current_game_event_seq(&state, game)
        .await
        .unwrap_or(claim.after_seq);
    let mut observed_visibility_change_id = if claim.channel == "main" {
        current_thread_visibility_change_id(&state, game)
            .await
            .unwrap_or_default()
    } else {
        0
    };
    let mut next_envelope_id = 1;
    if claim.channel == "main" {
        let hidden_posts = current_hidden_thread_post_deltas(&state, game)
            .await
            .unwrap_or_default();
        if !hidden_posts.is_empty() {
            if !websocket_session_active(&state, &claim).await {
                return;
            }
            let sent_to = send_projection_deltas(&mut socket, next_envelope_id, hidden_posts).await;
            if sent_to == next_envelope_id {
                return;
            }
            next_envelope_id = sent_to;
        }
    }
    if let Ok(deltas) = game_http::current_votecount_deltas(&state.pool, game).await {
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
    if let Some(delta) =
        host_console_state_delta_for_ws(&state, &claim, claim.slot_id.as_deref()).await
    {
        if !websocket_session_active(&state, &claim).await {
            return;
        }
        next_envelope_id = send_projection_deltas(&mut socket, next_envelope_id, vec![delta]).await;
    }
    if let Some(delta) = host_prompts_delta_for_ws(&state, &claim).await {
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
            _ = event_wake.wait() => None,
        };
        if !websocket_session_active(&state, &claim).await {
            break;
        }
        let Some(receive) = receive else {
            let latest_seq = current_game_event_seq(&state, game)
                .await
                .unwrap_or(observed_seq);
            let visibility_changes = if claim.channel == "main" {
                thread_visibility_changes_after(&state, game, observed_visibility_change_id)
                    .await
                    .unwrap_or_default()
            } else {
                Vec::new()
            };
            if latest_seq <= observed_seq && visibility_changes.is_empty() {
                continue;
            }
            if !visibility_changes.is_empty() {
                let delivered_visibility_change_id = visibility_changes
                    .last()
                    .map_or(observed_visibility_change_id, |change| change.id);
                let tombstones = visibility_changes
                    .into_iter()
                    .filter(|change| change.visibility == "hidden")
                    .map(|change| {
                        ProjectionDelta::ThreadPostRemoved(wire::ThreadPostRemovedDelta {
                            game,
                            source_seq: change.source_seq,
                        })
                    })
                    .collect::<Vec<_>>();
                if !tombstones.is_empty() {
                    let sent_to =
                        send_projection_deltas(&mut socket, next_envelope_id, tombstones).await;
                    if sent_to == next_envelope_id {
                        break;
                    }
                    next_envelope_id = sent_to;
                }
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
                let sent_to =
                    send_projection_deltas(&mut socket, next_envelope_id, vec![delta]).await;
                if sent_to == next_envelope_id {
                    break;
                }
                next_envelope_id = sent_to;
                if let Some(delta) =
                    host_console_state_delta_for_ws(&state, &claim, claim.slot_id.as_deref()).await
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
                observed_visibility_change_id = delivered_visibility_change_id;
                if latest_seq <= observed_seq {
                    continue;
                }
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
            if let Some(delta) =
                host_console_state_delta_for_ws(&state, &claim, claim.slot_id.as_deref()).await
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
            if let Some(delta) = host_prompts_delta_for_ws(&state, &claim).await {
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

async fn current_game_event_seq(state: &LiveDeliveryState, game: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT COALESCE(MAX(seq), 0) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&state.pool)
        .await
}

#[derive(Debug)]
struct ThreadVisibilityChange {
    id: i64,
    source_seq: i64,
    visibility: String,
}

async fn current_thread_visibility_change_id(
    state: &LiveDeliveryState,
    game: Uuid,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(id), 0) FROM game_thread_visibility_change WHERE game_id = $1",
    )
    .bind(game)
    .fetch_one(&state.pool)
    .await
}

async fn current_hidden_thread_post_deltas(
    state: &LiveDeliveryState,
    game: Uuid,
) -> Result<Vec<ProjectionDelta>, sqlx::Error> {
    let source_seqs = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT source_seq
        FROM moderation_target_state
        WHERE target_kind = 'game_post'
          AND scope_id = $1
          AND visibility = 'hidden'
        ORDER BY source_seq
        "#,
    )
    .bind(game)
    .fetch_all(&state.pool)
    .await?;
    Ok(source_seqs
        .into_iter()
        .map(|source_seq| {
            ProjectionDelta::ThreadPostRemoved(wire::ThreadPostRemovedDelta { game, source_seq })
        })
        .collect())
}

async fn thread_visibility_changes_after(
    state: &LiveDeliveryState,
    game: Uuid,
    after_id: i64,
) -> Result<Vec<ThreadVisibilityChange>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (i64, i64, String)>(
        r#"
        SELECT id, source_seq, visibility
        FROM game_thread_visibility_change
        WHERE game_id = $1 AND id > $2
        ORDER BY id
        "#,
    )
    .bind(game)
    .bind(after_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, source_seq, visibility)| ThreadVisibilityChange {
            id,
            source_seq,
            visibility,
        })
        .collect())
}

async fn send_current_projection_snapshot(
    socket: &mut WebSocket,
    state: &LiveDeliveryState,
    claim: &WebsocketTicketClaim,
    mut next_envelope_id: u64,
) -> u64 {
    if let Ok(deltas) = game_http::current_votecount_deltas(&state.pool, claim.game).await {
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
    if let Some(delta) =
        host_console_state_delta_for_ws(state, claim, claim.slot_id.as_deref()).await
    {
        if !websocket_session_active(state, claim).await {
            return next_envelope_id;
        }
        next_envelope_id = send_projection_deltas(socket, next_envelope_id, vec![delta]).await;
    }
    if let Some(delta) = host_prompts_delta_for_ws(state, claim).await {
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
    state: &LiveDeliveryState,
    game: Uuid,
    principal_user_id: Option<&str>,
    channel: &str,
) -> Option<ProjectionDelta> {
    if channel != "main" {
        let principal_user_id = principal_user_id?;
        game_http::require_channel_thread_access(
            &state.pool,
            game,
            channel,
            Some(principal_user_id),
        )
        .await
        .ok()?;
    }
    game_http::current_thread_posts_delta(&state.pool, game, channel, principal_user_id)
        .await
        .ok()
}

async fn host_console_state_delta_for_ws(
    state: &LiveDeliveryState,
    claim: &WebsocketTicketClaim,
    slot_id: Option<&str>,
) -> Option<ProjectionDelta> {
    let authorization = websocket_authorization_context(state, claim).await?;
    let game_authorization = game_http::GameAuthorization::from_context(&authorization);
    let authority =
        game_http::resolve_host_console_authority(&state.pool, claim.game, &game_authorization)
            .await
            .ok()??;
    game_http::load_host_console_state(&state.pool, claim.game, authority, slot_id, Some(25))
        .await
        .ok()
        .map(HostConsoleStateDelta::from)
        .map(ProjectionDelta::HostConsoleStateChanged)
}

async fn host_prompts_delta_for_ws(
    state: &LiveDeliveryState,
    claim: &WebsocketTicketClaim,
) -> Option<ProjectionDelta> {
    let authorization = websocket_authorization_context(state, claim).await?;
    let game_authorization = game_http::GameAuthorization::from_context(&authorization);
    game_http::require_host_audit_access(
        &state.pool,
        claim.game,
        &game_authorization,
        "principal cannot read host prompts for this game",
    )
    .await
    .ok()?;

    projections::host_prompts(&state.pool, claim.game)
        .await
        .ok()
        .map(|rows| HostPromptsDelta {
            game: claim.game,
            prompts: rows.into_iter().map(HostPromptDelta::from).collect(),
        })
        .map(ProjectionDelta::HostPromptsChanged)
}

async fn player_private_deltas_for_ws(
    state: &LiveDeliveryState,
    game: Uuid,
    principal_user_id: Option<&str>,
) -> Vec<ProjectionDelta> {
    let Some(principal_user_id) = principal_user_id else {
        return Vec::new();
    };

    let mut deltas = Vec::new();
    if let Ok(notifications) =
        game_http::player_notifications_for_principal(&state.pool, game, principal_user_id).await
    {
        deltas.push(ProjectionDelta::PlayerNotificationsChanged(
            PlayerNotificationsDelta {
                game,
                notifications,
            },
        ));
    }
    if let Ok(results) =
        game_http::player_investigation_results_for_principal(&state.pool, game, principal_user_id)
            .await
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

async fn hello_for(
    state: &LiveDeliveryState,
    principal_user_id: Option<&str>,
    game: Option<Uuid>,
) -> Hello {
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
