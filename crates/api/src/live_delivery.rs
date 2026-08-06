//! Authenticated WebSocket live transport: tickets, admission, session loop,
//! hydration, durable seq poll, lag resync, and binary-CBOR framing.
//!
//! Live change classification and broadcast publication remain in
//! `live_projection`. This module consumes that publisher plus narrow
//! game-read adapters.

use super::auth_http::{
    authenticate_token, bearer_token, hash_session_token, unauthorized_session, unix_now_seconds,
    AuthHttpState,
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

async fn create_websocket_ticket(
    State(state): State<LiveDeliveryState>,
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

async fn websocket_session_active(state: &LiveDeliveryState, claim: &WebsocketTicketClaim) -> bool {
    if state.auth.dev_auth_enabled && claim.session_reference == "dev-legacy" {
        return true;
    }
    let now = unix_now_seconds();
    if claim.access_expires_at <= now {
        return false;
    }
    match claim.auth_kind.as_str() {
        "classic" | "dev" => app_session_live(state, claim, now).await == Some(true),
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
            sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1
                    FROM auth_session
                    WHERE token_hash = $1
                      AND principal_user_id = $2
                      AND revoked_at IS NULL
                      AND expires_at > $3
                      AND (
                          $4::boolean
                          OR EXISTS (
                              SELECT 1
                              FROM auth_account
                              WHERE auth_account.principal_user_id = auth_session.principal_user_id
                                AND auth_account.disabled_at IS NULL
                          )
                      )
                )
                "#,
            )
                .bind(claim.session_reference.as_str())
                .bind(claim.principal_user_id.as_str())
                .bind(now)
                .bind(state.auth.dev_auth_enabled)
                .fetch_one(&state.pool)
                .await
                .unwrap_or(false)
        }
    }
}

/// Liveness of the app session a ticket references: Some(live) when a session
/// row matches the reference, None when the reference is not an app session.
async fn app_session_live(
    state: &LiveDeliveryState,
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
    State(state): State<LiveDeliveryState>,
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
    let mut next_envelope_id = 1;
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
            _ = event_wake.wait() => None,
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

async fn current_game_event_seq(state: &LiveDeliveryState, game: Uuid) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT COALESCE(MAX(seq), 0) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&state.pool)
        .await
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
    game_http::current_thread_posts_delta(&state.pool, game, channel)
        .await
        .ok()
}

async fn host_console_state_delta_for_ws(
    state: &LiveDeliveryState,
    game: Uuid,
    principal_user_id: Option<&str>,
    slot_id: Option<&str>,
) -> Option<ProjectionDelta> {
    let principal_user_id = principal_user_id?;
    let authority = game_http::resolve_host_console_authority(&state.pool, game, principal_user_id)
        .await
        .ok()??;
    game_http::load_host_console_state(&state.pool, game, authority, slot_id, Some(25))
        .await
        .ok()
        .map(HostConsoleStateDelta::from)
        .map(ProjectionDelta::HostConsoleStateChanged)
}

async fn host_prompts_delta_for_ws(
    state: &LiveDeliveryState,
    game: Uuid,
    principal_user_id: Option<&str>,
) -> Option<ProjectionDelta> {
    let principal_user_id = principal_user_id?;
    game_http::require_host_audit_access(
        &state.pool,
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
