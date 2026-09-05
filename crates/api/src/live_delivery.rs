//! Authenticated WebSocket live transport: tickets, admission, session loop,
//! LISTEN/NOTIFY wake, durable seq catch-up, terminal resync, and
//! binary-CBOR framing.
//!
//! Live change classification and broadcast publication remain in
//! `live_projection`. This module consumes that publisher plus narrow
//! game-read adapters.

use super::auth_http::{
    hash_session_token, unauthorized_session, unix_now_seconds, AuthHttpState,
    AuthenticatedRequest, AuthorizationContext,
};
use super::authentication::enforce_public_request_limit;
use super::live_projection::{self, LiveProjectionPublisher, LiveProjectionReceive};
use super::{capacity_unavailable_response, game_http, ApiError, ApiState};
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRef, Query, State};

use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use caps::{Capability, CapabilitySet, Principal};
use principal::PrincipalId;
use serde::{Deserialize, Serialize};
use sqlx::postgres::{PgListener, PgPool};
use sqlx::{Postgres, Transaction};
use std::collections::{BTreeSet, HashMap};
use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{broadcast, Mutex, OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;
use wire::{
    host_console_patches, CapabilityGrant, Hello, HostConsoleStateDelta, HostPromptDelta,
    HostPromptsDelta, LiveAudience, LiveProjectionDelta, LiveResyncRequired, LiveScope,
    PlayerInvestigationResultsDelta, PlayerNotificationsDelta, ProjectionDelta, RejectCode,
    ServerEnvelope, ServerMsg, SlotMentionsDelta, LIVE_HEARTBEAT_ENVELOPE_ID,
};

/// Wake source for the durable cross-instance event catch-up in the live
/// session loop.
///
/// `NotifyEventWake` waits on the process-wide LISTEN/NOTIFY hub and uses
/// `PollEventWake` only as a missed-notification fallback. The select! shape
/// that also receives live projection broadcasts stays the same.
pub(super) trait EventWake {
    fn wait(&mut self) -> impl std::future::Future<Output = ()> + Send;
}

/// Interval-based durable event wake used as a missed-NOTIFY fallback.
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

struct GameEventWakeInner {
    sender: broadcast::Sender<Uuid>,
}

/// Process-wide fan-out of committed game ids from one Postgres LISTEN.
#[derive(Clone)]
pub(super) struct GameEventWakeHub {
    inner: Arc<GameEventWakeInner>,
}

impl GameEventWakeHub {
    pub(super) fn new() -> Self {
        let (sender, _) = broadcast::channel(1_024);
        Self {
            inner: Arc::new(GameEventWakeInner { sender }),
        }
    }

    pub(super) fn subscribe(&self) -> broadcast::Receiver<Uuid> {
        self.inner.sender.subscribe()
    }

    pub(super) fn spawn_listener(&self, pool: PgPool) {
        if tokio::runtime::Handle::try_current().is_err() {
            return;
        }
        let weak = Arc::downgrade(&self.inner);
        tokio::spawn(async move {
            run_live_event_listener(pool, weak).await;
        });
    }

    #[cfg(test)]
    fn fan_out_game(&self, game: Uuid) {
        let _ = self.inner.sender.send(game);
    }
}

/// Shared LISTEN/NOTIFY wake plus a long interval fallback.
pub(super) struct NotifyEventWake {
    game: Uuid,
    notifications: broadcast::Receiver<Uuid>,
    fallback: PollEventWake,
    hub_closed: bool,
}

impl NotifyEventWake {
    pub(super) fn new(
        game: Uuid,
        notifications: broadcast::Receiver<Uuid>,
        fallback: Duration,
    ) -> Self {
        Self {
            game,
            notifications,
            fallback: PollEventWake::new(fallback),
            hub_closed: false,
        }
    }
}

impl EventWake for NotifyEventWake {
    async fn wait(&mut self) {
        if self.hub_closed {
            self.fallback.wait().await;
            return;
        }
        loop {
            tokio::select! {
                _ = self.fallback.wait() => return,
                received = self.notifications.recv() => {
                    match received {
                        Ok(game) if game == self.game => return,
                        Ok(_) => continue,
                        Err(broadcast::error::RecvError::Lagged(_)) => return,
                        Err(broadcast::error::RecvError::Closed) => {
                            self.hub_closed = true;
                            self.fallback.wait().await;
                            return;
                        }
                    }
                }
            }
        }
    }
}

async fn run_live_event_listener(pool: PgPool, inner: std::sync::Weak<GameEventWakeInner>) {
    loop {
        if inner.strong_count() == 0 {
            return;
        }
        match listen_live_events(&pool, &inner).await {
            Ok(()) => {}
            Err(error) => {
                tracing::warn!(
                    event = "live_event_listen_failed",
                    error = %error,
                    "live event LISTEN loop failed; retrying"
                );
            }
        }
        if inner.strong_count() == 0 {
            return;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

async fn listen_live_events(
    pool: &PgPool,
    inner: &std::sync::Weak<GameEventWakeInner>,
) -> Result<(), sqlx::Error> {
    let mut listener = PgListener::connect_with(pool).await?;
    listener
        .listen(projections::LIVE_EVENT_NOTIFY_CHANNEL)
        .await?;
    let mut owner_check = tokio::time::interval(Duration::from_secs(1));
    owner_check.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = owner_check.tick() => {
                if inner.strong_count() == 0 {
                    return Ok(());
                }
            }
            notification = listener.recv() => {
                let notification = notification?;
                let Ok(game) = Uuid::parse_str(notification.payload()) else {
                    continue;
                };
                let Some(hub) = inner.upgrade() else {
                    return Ok(());
                };
                let _ = hub.sender.send(game);
            }
        }
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
    live_principal_slots: Arc<Mutex<HashMap<PrincipalId, Arc<Semaphore>>>>,
    live_principal_limit: usize,
    live_delivery_transaction_slots: Arc<Semaphore>,
    authority_transaction_slots: Arc<Semaphore>,
    websocket_poll_interval: Duration,
    websocket_heartbeat_interval: Duration,
    live_event_wake: GameEventWakeHub,
}

impl FromRef<LiveDeliveryState> for AuthHttpState {
    fn from_ref(state: &LiveDeliveryState) -> Self {
        state.auth.clone()
    }
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
            live_delivery_transaction_slots: state.live_delivery_transaction_slots.clone(),
            authority_transaction_slots: state.authority_transaction_slots.clone(),
            websocket_poll_interval: state.websocket_poll_interval,
            websocket_heartbeat_interval: state.websocket_heartbeat_interval,
            live_event_wake: state.live_event_wake.clone(),
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
    principal_id: PrincipalId,
    scope: LiveScope,
    after_seq: i64,
}

struct WebsocketAdmission {
    claim: WebsocketTicketClaim,
    principal_slots: Arc<Semaphore>,
    principal_permit: OwnedSemaphorePermit,
}

fn default_live_channel() -> String {
    "main".to_string()
}

const WEBSOCKET_TICKET_CLEANUP_BATCH: i64 = 256;
const LIVE_DELIVERY_BATCH_TIMEOUT: Duration = Duration::from_secs(5);
const LIVE_CONTROL_SEND_TIMEOUT: Duration = Duration::from_secs(1);
const LIVE_CONTROL_FRAMES_PER_SECOND: u16 = 32;

struct ControlFrameBudget {
    window_started: tokio::time::Instant,
    accepted: u16,
}

impl ControlFrameBudget {
    fn new() -> Self {
        Self {
            window_started: tokio::time::Instant::now(),
            accepted: 0,
        }
    }

    fn admit_at(&mut self, now: tokio::time::Instant) -> bool {
        if now.duration_since(self.window_started) >= Duration::from_secs(1) {
            self.window_started = now;
            self.accepted = 0;
        }
        if self.accepted >= LIVE_CONTROL_FRAMES_PER_SECOND {
            return false;
        }
        self.accepted += 1;
        true
    }
}

fn live_delivery_deadline(valid_until: i64) -> Option<tokio::time::Instant> {
    // Sample monotonic time first so work between the two clock reads can only
    // move the mapped deadline earlier, never beyond the wall-clock expiry.
    let monotonic_now = tokio::time::Instant::now();
    live_delivery_deadline_at(valid_until, monotonic_now, SystemTime::now())
}

fn live_delivery_deadline_bounded_by(
    valid_until: i64,
    lease_deadline: tokio::time::Instant,
) -> Option<tokio::time::Instant> {
    let monotonic_now = tokio::time::Instant::now();
    live_delivery_deadline_bounded_by_at(
        valid_until,
        lease_deadline,
        monotonic_now,
        SystemTime::now(),
    )
}

fn live_delivery_deadline_bounded_by_at(
    valid_until: i64,
    lease_deadline: tokio::time::Instant,
    monotonic_now: tokio::time::Instant,
    wall_now: SystemTime,
) -> Option<tokio::time::Instant> {
    Some(live_delivery_deadline_at(valid_until, monotonic_now, wall_now)?.min(lease_deadline))
}

fn live_delivery_deadline_at(
    valid_until: i64,
    monotonic_now: tokio::time::Instant,
    wall_now: SystemTime,
) -> Option<tokio::time::Instant> {
    let valid_until = u64::try_from(valid_until).ok()?;
    let expires_at = UNIX_EPOCH.checked_add(Duration::from_secs(valid_until))?;
    let remaining = expires_at.duration_since(wall_now).ok()?;
    if remaining.is_zero() {
        return None;
    }
    Some(monotonic_now + remaining.min(LIVE_DELIVERY_BATCH_TIMEOUT))
}

trait DeliveryDeadline {
    fn deadline(&self) -> tokio::time::Instant;
}

async fn guarded_application_send<G, F, E>(guard: &G, send: F) -> bool
where
    G: DeliveryDeadline + ?Sized,
    F: Future<Output = Result<(), E>>,
{
    matches!(
        tokio::time::timeout_at(guard.deadline(), send).await,
        Ok(Ok(()))
    )
}

async fn bounded_control_send(socket: &mut WebSocket, frame: Message) -> bool {
    matches!(
        tokio::time::timeout(LIVE_CONTROL_SEND_TIMEOUT, socket.send(frame)).await,
        Ok(Ok(()))
    )
}

/// Bound durable ticket retention without turning a request into an unbounded
/// table sweep. Every successful mint can retire substantially more rows than
/// it creates. Redeemed tickets are removed atomically, so this table contains
/// outstanding bearer authority only.
async fn prune_stale_websocket_tickets(pool: &PgPool, now: i64) -> Result<u64, sqlx::Error> {
    let removed = sqlx::query(
        r#"
        WITH shortlist AS MATERIALIZED (
            SELECT token_hash
            FROM auth_websocket_ticket
            WHERE LEAST(expires_at, access_expires_at) <= $1
            ORDER BY LEAST(expires_at, access_expires_at), token_hash
            LIMIT $2
        ), candidates AS (
            SELECT token_hash
            FROM shortlist
            WHERE pg_catalog.pg_try_advisory_xact_lock(
                pg_catalog.hashtextextended(
                    $3 || token_hash,
                    0
                )
            )
        )
        DELETE FROM auth_websocket_ticket AS ticket
        USING candidates
        WHERE ticket.token_hash = candidates.token_hash
        "#,
    )
    .bind(now)
    .bind(WEBSOCKET_TICKET_CLEANUP_BATCH)
    .bind(identity::session::WEBSOCKET_TICKET_LOCK_NAMESPACE)
    .execute(pool)
    .await?;
    Ok(removed.rows_affected())
}

async fn create_websocket_ticket(
    State(state): State<LiveDeliveryState>,
    authorization: AuthenticatedRequest,
    Json(request): Json<CreateWebsocketTicket>,
) -> Result<Json<WebsocketTicketResponse>, ApiError> {
    let principal_id = authorization.context.principal_id;
    let ticket_scope =
        hash_session_token(format!("websocket-ticket-principal:{principal_id}").as_str());
    enforce_public_request_limit(
        &state.auth,
        ticket_scope.as_str(),
        state.auth.websocket_ticket_max_per_window,
        &state.auth.auth_attempt_policy,
    )
    .await?;
    let audience = request.audience.trim();
    let channel = request.channel.trim();
    let scope = LiveScope::new(
        request.game,
        channel,
        request
            .slot_id
            .as_deref()
            .map(str::trim)
            .map(str::to_string),
    );
    if audience != state.auth.websocket_audience
        || channel.len() > 256
        || request.after_seq < 0
        || request.after_seq > wire::MAX_SAFE_LIVE_INTEGER
        || request
            .slot_id
            .as_deref()
            .is_some_and(|slot| slot.len() > 256)
        || scope.is_err()
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
            Some(principal_id),
        )
        .await?;
    }
    if let Some(slot_id) = request.slot_id.as_deref().map(str::trim) {
        let capabilities = caps::resolve(
            &state.pool,
            &Principal::authenticated(principal_id),
            request.game,
        )
        .await?;
        if !capabilities.iter().any(
            |capability| matches!(capability, Capability::SlotOccupant(held) if held == slot_id),
        ) {
            return Err(ApiError::Reject {
                status: axum::http::StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "principal cannot mint the requested websocket scope".to_string(),
            });
        }
    }

    let ticket = format!("ws-ticket-{}-{}", Uuid::new_v4(), Uuid::new_v4());
    prune_stale_websocket_tickets(&state.pool, unix_now_seconds()).await?;
    let _authority_permit = state
        .authority_transaction_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::Unavailable {
            retry_after_seconds: 1,
            message: "authority transaction capacity is exhausted; retry shortly".to_string(),
        })?;
    let mut tx = state.pool.begin().await?;
    let locked_authorization = identity::session::validate_session_for_update(
        &mut tx,
        authorization.bearer.as_str(),
        &state.auth.session_policy,
    )
    .await
    .map_err(|_| unauthorized_session())?;
    if locked_authorization.principal_id != principal_id {
        return Err(unauthorized_session());
    }
    let issued_at = unix_now_seconds();
    if locked_authorization.expires_at <= issued_at
        || locked_authorization.idle_expires_at <= issued_at
    {
        return Err(unauthorized_session());
    }
    let access_expires_at = locked_authorization
        .idle_expires_at
        .min(locked_authorization.expires_at);
    let expires_at = issued_at
        .saturating_add(state.auth.websocket_ticket_ttl.as_secs() as i64)
        .min(access_expires_at);
    sqlx::query(
        r#"
        INSERT INTO auth_websocket_ticket (
            token_hash, session_reference, access_expires_at,
            audience,
            game_id, channel_id, slot_id, after_seq, issued_at, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
    )
    .bind(hash_session_token(ticket.as_str()))
    .bind(locked_authorization.session_reference)
    .bind(access_expires_at)
    .bind(audience)
    .bind(request.game)
    .bind(channel)
    .bind(request.slot_id.as_deref().map(str::trim))
    .bind(request.after_seq)
    .bind(issued_at)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(WebsocketTicketResponse {
        ticket,
        audience: audience.to_string(),
        expires_at,
    }))
}

async fn redeem_websocket_ticket(
    state: &LiveDeliveryState,
    params: &WsParams,
) -> Result<WebsocketAdmission, ApiError> {
    let ticket = params.ticket.as_deref().ok_or_else(unauthorized_session)?;
    let audience = params
        .audience
        .as_deref()
        .ok_or_else(unauthorized_session)?;
    if audience != state.auth.websocket_audience || ticket.trim().is_empty() {
        return Err(unauthorized_session());
    }
    let ticket_hash = hash_session_token(ticket);
    let discovered_at = unix_now_seconds();
    let (session_reference, discovered_principal_id) = sqlx::query_as::<_, (String, Uuid)>(
        r#"
        SELECT ticket.session_reference, session.principal_id
        FROM auth_websocket_ticket AS ticket
        JOIN auth_session AS session
          ON session.token_hash = ticket.session_reference
        WHERE ticket.token_hash = $1
          AND ticket.audience = $2
          AND ticket.expires_at > $3
          AND ticket.access_expires_at > $3
        "#,
    )
    .bind(ticket_hash.as_str())
    .bind(audience)
    .bind(discovered_at)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(unauthorized_session)?;
    let discovered_principal_id = PrincipalId::from_uuid(discovered_principal_id);
    let (principal_slots, principal_permit) = {
        let mut slots = state.live_principal_slots.lock().await;
        slots.retain(|_, entry| {
            entry.available_permits() != state.live_principal_limit || Arc::strong_count(entry) > 1
        });
        let principal_slots = slots
            .entry(discovered_principal_id)
            .or_insert_with(|| Arc::new(Semaphore::new(state.live_principal_limit)))
            .clone();
        let principal_permit = principal_slots.clone().try_acquire_owned().map_err(|_| {
            tracing::warn!(
                event = "live_connection_rejected",
                reason = "principal_connection_capacity_exhausted",
                principal_id = %discovered_principal_id,
                "live connection admission rejected"
            );
            ApiError::Unavailable {
                retry_after_seconds: 1,
                message: "principal live connection capacity is exhausted; retry shortly"
                    .to_string(),
            }
        })?;
        // The permit must exist before this Arc escapes the map lock. Session
        // teardown removes only a full semaphore, so it cannot detach this Arc
        // and let a concurrent redemption install a second capacity budget.
        (principal_slots, principal_permit)
    };
    let _authority_permit = state
        .authority_transaction_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::Unavailable {
            retry_after_seconds: 1,
            message: "authority transaction capacity is exhausted; retry shortly".to_string(),
        })?;
    let mut tx = state.pool.begin().await?;
    let authorization = identity::session::validate_session_reference_for_update(
        &mut tx,
        session_reference.as_str(),
        &state.auth.session_policy,
        discovered_at,
    )
    .await
    .map_err(|_| unauthorized_session())?;
    if authorization.principal_id != discovered_principal_id {
        return Err(unauthorized_session());
    }
    identity::session::lock_websocket_ticket_mutation(&mut tx, ticket_hash.as_str())
        .await
        .map_err(|_| unauthorized_session())?;
    let locked_now = unix_now_seconds();
    let row = sqlx::query_as::<_, (i64, Uuid, String, Option<String>, i64)>(
        r#"
        DELETE FROM auth_websocket_ticket AS ticket
        WHERE ticket.token_hash = $1
          AND ticket.audience = $2
          AND ticket.expires_at > $3
          AND ticket.access_expires_at > $3
          AND ticket.session_reference = $4
        RETURNING ticket.access_expires_at, ticket.game_id,
                  ticket.channel_id, ticket.slot_id, ticket.after_seq
        "#,
    )
    .bind(ticket_hash)
    .bind(audience)
    .bind(locked_now)
    .bind(session_reference.as_str())
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(unauthorized_session)?;
    let scope = LiveScope::new(row.1, row.2, row.3).map_err(|error| {
        tracing::warn!(event = "live_ticket_scope_invalid", %error);
        unauthorized_session()
    })?;
    if !(0..=wire::MAX_SAFE_LIVE_INTEGER).contains(&row.4) {
        tracing::warn!(
            event = "live_ticket_cursor_invalid",
            ticket_after_seq = row.4,
        );
        return Err(unauthorized_session());
    }
    let claim = WebsocketTicketClaim {
        session_reference,
        access_expires_at: row.0,
        principal_id: authorization.principal_id,
        scope,
        after_seq: row.4,
    };
    tx.commit().await?;
    Ok(WebsocketAdmission {
        claim,
        principal_slots,
        principal_permit,
    })
}

/// Read-only authority lease for one outbound WebSocket batch. The shared row
/// lock is held across the bounded socket write; revocation takes a conflicting
/// lock and therefore cannot return before an already-authorized batch ends.
struct SessionDeliveryGuard {
    tx: Transaction<'static, Postgres>,
    _delivery_permit: OwnedSemaphorePermit,
    _authority_permit: OwnedSemaphorePermit,
    capabilities: CapabilitySet,
    deadline: tokio::time::Instant,
}

impl SessionDeliveryGuard {
    async fn acquire(state: &LiveDeliveryState, claim: &WebsocketTicketClaim) -> Option<Self> {
        let checked_at = unix_now_seconds();
        if claim.access_expires_at <= checked_at {
            return None;
        }
        // This single absolute deadline covers every await from local capacity
        // admission through transaction acquisition, authority fencing, and
        // the eventual socket write/transaction finish. A queued semaphore or
        // exhausted pool must never turn a bounded authority lease into an
        // unbounded blocker for revocation.
        let lease_deadline = live_delivery_deadline(claim.access_expires_at)?;
        // Backpressure healthy fan-out instead of treating local DB-fence
        // capacity as an authorization failure. The outer delivery semaphore
        // keeps the shared pool queue bounded; the shared authority budget
        // leaves connections available for the revocation writer.
        let delivery_permit = match tokio::time::timeout_at(
            lease_deadline,
            state
                .live_delivery_transaction_slots
                .clone()
                .acquire_owned(),
        )
        .await
        {
            Ok(Ok(permit)) => permit,
            Ok(Err(error)) => {
                tracing::warn!(event = "live_delivery_semaphore_closed", %error);
                return None;
            }
            Err(_) => {
                tracing::warn!(event = "live_delivery_capacity_wait_timed_out");
                return None;
            }
        };
        let authority_permit = match tokio::time::timeout_at(
            lease_deadline,
            state.authority_transaction_slots.clone().acquire_owned(),
        )
        .await
        {
            Ok(Ok(permit)) => permit,
            Ok(Err(error)) => {
                tracing::warn!(event = "live_delivery_authority_semaphore_closed", %error);
                return None;
            }
            Err(_) => {
                tracing::warn!(event = "live_delivery_authority_capacity_wait_timed_out");
                return None;
            }
        };
        let mut tx = match tokio::time::timeout_at(lease_deadline, state.pool.begin()).await {
            Ok(Ok(tx)) => tx,
            Ok(Err(error)) => {
                tracing::warn!(event = "live_delivery_fence_failed", %error);
                return None;
            }
            Err(_) => {
                tracing::warn!(event = "live_delivery_pool_wait_timed_out");
                return None;
            }
        };
        // The five-second deadline bounds the complete authority lease, not
        // merely the eventual socket write. Starting it before the first
        // capacity wait prevents staged local/database blockers from extending
        // a principal/key retirement wait by one timeout per resource.
        let fenced = tokio::time::timeout_at(lease_deadline, async {
            if let Err(error) =
                identity::session::lock_live_delivery_cutoff_gates(&mut tx, &claim.principal_id)
                    .await
            {
                tracing::info!(event = "live_delivery_cutoff_gate_rejected", %error);
                return None;
            }
            let authorization = match identity::session::validate_session_reference_for_delivery(
                &mut tx,
                claim.session_reference.as_str(),
                &state.auth.session_policy,
                unix_now_seconds(),
            )
            .await
            {
                Ok(authorization) => authorization,
                Err(error) => {
                    tracing::info!(event = "live_delivery_authority_rejected", %error);
                    return None;
                }
            };
            if authorization.principal_id != claim.principal_id {
                return None;
            }
            let mut capabilities = match caps::resolve_live_delivery_in_tx(
                &mut tx,
                &Principal::authenticated(authorization.principal_id),
                claim.scope.game(),
            )
            .await
            {
                Ok(capabilities) => capabilities,
                Err(error) => {
                    tracing::warn!(event = "live_delivery_capability_fence_failed", %error);
                    return None;
                }
            };
            for capability in &authorization.global_capabilities {
                match capability.as_str() {
                    "GlobalAdmin" => capabilities.insert(Capability::GlobalAdmin),
                    "GlobalMod" => capabilities.insert(Capability::GlobalMod),
                    _ => {}
                }
            }
            if !delivery_claim_authorized(&capabilities, claim) {
                tracing::info!(
                    event = "live_delivery_scope_revoked",
                    principal_id = %claim.principal_id,
                    game_id = %claim.scope.game(),
                    channel = %claim.scope.channel(),
                    slot_id = ?claim.scope.slot_id(),
                );
                return None;
            }
            Some((authorization, capabilities))
        })
        .await;
        let (authorization, capabilities) = match fenced {
            Ok(Some(fenced)) => fenced,
            Ok(None) => {
                match tokio::time::timeout_at(lease_deadline, tx.rollback()).await {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => {
                        tracing::warn!(event = "live_delivery_fence_rollback_failed", %error);
                    }
                    Err(_) => {
                        tracing::warn!(event = "live_delivery_fence_rollback_timed_out");
                    }
                }
                return None;
            }
            Err(_) => {
                tracing::warn!(event = "live_delivery_authority_lease_timed_out");
                // Dropping the timed-out SQLx rollback future drops its owned
                // transaction. SQLx then queues rollback-on-drop before the
                // pooled connection can be reused, while the local permits are
                // released immediately with this failed guard acquisition.
                if tokio::time::timeout_at(lease_deadline, tx.rollback())
                    .await
                    .is_err()
                {
                    tracing::warn!(event = "live_delivery_fence_rollback_timed_out");
                }
                return None;
            }
        };
        let valid_until = claim
            .access_expires_at
            .min(authorization.expires_at)
            .min(authorization.idle_expires_at);
        let Some(deadline) = live_delivery_deadline_bounded_by(valid_until, lease_deadline) else {
            if tokio::time::timeout_at(lease_deadline, tx.rollback())
                .await
                .is_err()
            {
                tracing::warn!(event = "live_delivery_fence_rollback_timed_out");
            }
            return None;
        };
        Some(Self {
            tx,
            _delivery_permit: delivery_permit,
            _authority_permit: authority_permit,
            capabilities,
            deadline,
        })
    }

    fn capabilities(&self) -> &CapabilitySet {
        &self.capabilities
    }

    async fn release(self) -> bool {
        let deadline = self.deadline;
        match tokio::time::timeout_at(deadline, self.tx.commit()).await {
            Ok(Ok(())) => true,
            Ok(Err(error)) => {
                tracing::warn!(event = "live_delivery_fence_release_failed", %error);
                false
            }
            Err(_) => {
                // Cancellation drops the owned transaction and invokes SQLx's
                // rollback-on-drop path; an indeterminate COMMIT is terminal
                // for this generation and no later frame may be sent.
                tracing::warn!(event = "live_delivery_fence_release_timed_out");
                false
            }
        }
    }

    async fn abort(self) {
        let deadline = self.deadline;
        match tokio::time::timeout_at(deadline, self.tx.rollback()).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                tracing::warn!(event = "live_delivery_fence_rollback_failed", %error);
            }
            Err(_) => {
                tracing::warn!(event = "live_delivery_fence_rollback_timed_out");
            }
        }
    }
}

impl DeliveryDeadline for SessionDeliveryGuard {
    fn deadline(&self) -> tokio::time::Instant {
        self.deadline
    }
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
    (authorization.principal_id == claim.principal_id).then_some(authorization)
}

async fn ws(
    State(state): State<LiveDeliveryState>,
    Query(params): Query<WsParams>,
    upgrade: WebSocketUpgrade,
) -> Response {
    if params
        .ticket
        .as_deref()
        .is_none_or(|ticket| ticket.trim().is_empty())
        || params.audience.as_deref() != Some(state.auth.websocket_audience.as_str())
    {
        return unauthorized_session().into_response();
    }
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
    let admission = match redeem_websocket_ticket(&state, &params).await {
        Ok(admission) => admission,
        Err(error) => return error.into_response(),
    };
    let WebsocketAdmission {
        claim,
        principal_slots,
        principal_permit,
    } = admission;
    upgrade
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            let principal_id = claim.principal_id;
            ws_session(socket, state.clone(), claim).await;
            drop(principal_permit);
            let mut slots = state.live_principal_slots.lock().await;
            if slots.get(&principal_id).is_some_and(|entry| {
                Arc::ptr_eq(entry, &principal_slots)
                    && entry.available_permits() == state.live_principal_limit
            }) {
                slots.remove(&principal_id);
            }
        })
        .into_response()
}

async fn ws_session(mut socket: WebSocket, state: LiveDeliveryState, claim: WebsocketTicketClaim) {
    let connection_id = Uuid::new_v4();
    let game = claim.scope.game();

    // Subscribe before any durable baseline or Hello. A command that commits
    // during admission is therefore represented either by the durable cursor
    // comparison or by the subscribed wake stream, never lost in a handshake
    // gap.
    let mut live_projection_rx = state.live_projection.subscribe();
    let mut event_wake = NotifyEventWake::new(
        game,
        state.live_event_wake.subscribe(),
        state.websocket_poll_interval,
    );
    let Ok(mut observed_seq) = current_game_event_seq(&state, game).await else {
        return;
    };
    if !(0..=wire::MAX_SAFE_LIVE_INTEGER).contains(&observed_seq) {
        tracing::warn!(event = "live_durable_cursor_invalid", observed_seq);
        return;
    }
    if claim.after_seq > observed_seq {
        tracing::warn!(
            event = "live_ticket_cursor_ahead_of_durable_state",
            ticket_after_seq = claim.after_seq,
            observed_seq,
        );
        return;
    }
    let Ok(mut observed_visibility_change_id) = (if claim.scope.channel() == "main" {
        current_thread_visibility_change_id(&state, game).await
    } else {
        Ok(0)
    }) else {
        return;
    };

    let Some(guard) = SessionDeliveryGuard::acquire(&state, &claim).await else {
        return;
    };
    let Ok(Some(plan)) = LiveDeliveryPlan::from_capabilities(&state, &claim, guard.capabilities())
    else {
        guard.abort().await;
        return;
    };
    let Ok(frame) = server_envelope_frame(&ServerEnvelope::new(
        LIVE_HEARTBEAT_ENVELOPE_ID,
        ServerMsg::Hello(plan.hello.clone()),
    )) else {
        guard.abort().await;
        return;
    };
    if !guarded_application_send(&guard, socket.send(frame)).await {
        // A cancelled SinkExt::send may have already buffered the frame. Keep
        // the fence through rollback, then drop the socket without polling it
        // again so that buffered application data can never be flushed later.
        guard.abort().await;
        return;
    }
    if !guard.release().await {
        return;
    }

    let host_console_interested = plan
        .allowed_audiences
        .contains(&LiveAudience::Host { game });
    let mut last_envelope_id = LIVE_HEARTBEAT_ENVELOPE_ID;
    let mut last_host_console: Option<HostConsoleStateDelta> = None;

    macro_rules! send_deltas_or_break {
        ($deltas:expr) => {
            match send_projection_deltas(
                &mut socket,
                &state,
                &claim,
                &plan,
                last_envelope_id,
                $deltas,
            )
            .await
            {
                GuardedSendOutcome::Continue(last) => last,
                GuardedSendOutcome::Close(_) | GuardedSendOutcome::DropSocket => break,
            }
        };
    }

    macro_rules! assembly_or_break {
        ($result:expr) => {
            match $result {
                Ok(value) => value,
                Err(error) => {
                    tracing::warn!(event = "live_generation_assembly_failed", %error);
                    let _ = close_live_socket(
                        &mut socket,
                        last_envelope_id,
                        1011,
                        "live generation assembly failed",
                    )
                    .await;
                    break;
                }
            }
        };
    }

    if host_console_interested {
        let (_, current) = match host_console_deltas_for_ws(&state, &claim, None).await {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(event = "live_host_console_baseline_failed", %error);
                return;
            }
        };
        last_host_console = Some(current);
    }

    let mut control_budget = ControlFrameBudget::new();
    let mut heartbeat = tokio::time::interval_at(
        tokio::time::Instant::now() + state.websocket_heartbeat_interval,
        state.websocket_heartbeat_interval,
    );
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        let receive = tokio::select! {
            _ = heartbeat.tick() => {
                if !send_generation_heartbeat(&mut socket, &state, &claim, &plan).await {
                    break;
                }
                continue;
            }
            inbound = socket.recv() => {
                match inbound {
                    Some(Ok(Message::Ping(payload))) => {
                        if !control_budget.admit_at(tokio::time::Instant::now())
                            || !bounded_control_send(&mut socket, Message::Pong(payload)).await
                        {
                            break;
                        }
                        continue;
                    }
                    Some(Ok(Message::Pong(_))) => {
                        if !control_budget.admit_at(tokio::time::Instant::now()) {
                            break;
                        }
                        continue;
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(Message::Text(_) | Message::Binary(_))) => {
                        // The live socket is deliberately server-to-client only;
                        // application commands belong on authenticated HTTP.
                        let _ = bounded_control_send(&mut socket, Message::Close(None)).await;
                        break;
                    }
                }
            }
            update = live_projection::receive(&mut live_projection_rx) => Some(update),
            _ = event_wake.wait() => live_projection::try_receive(&mut live_projection_rx),
        };
        let Some(receive) = receive else {
            if state.live_projection.has_inflight(game) {
                continue;
            }
            let Ok(latest_seq) = current_game_event_seq(&state, game).await else {
                break;
            };
            if !(0..=wire::MAX_SAFE_LIVE_INTEGER).contains(&latest_seq) {
                let _ = close_live_socket(
                    &mut socket,
                    last_envelope_id,
                    1011,
                    "live durable cursor invalid",
                )
                .await;
                break;
            }
            let visibility_changes = if claim.scope.channel() == "main" {
                let Ok(changes) =
                    thread_visibility_changes_after(&state, game, observed_visibility_change_id)
                        .await
                else {
                    break;
                };
                changes
            } else {
                Vec::new()
            };
            if latest_seq <= observed_seq && visibility_changes.is_empty() {
                continue;
            }
            if latest_seq > observed_seq {
                eprintln!(
                    "RESYNC_TRIGGER no_receive observed_seq={} latest_seq={} game={} channel={} slot={:?}",
                    observed_seq,
                    latest_seq,
                    game,
                    claim.scope.channel(),
                    claim.scope.slot_id(),
                );
                let _ = send_resync_required(
                    &mut socket,
                    &state,
                    &claim,
                    &plan,
                    last_envelope_id,
                    observed_seq,
                )
                .await;
                break;
            }
            if !visibility_changes.is_empty() {
                let delivered_visibility_change_id = visibility_changes
                    .last()
                    .map_or(observed_visibility_change_id, |change| change.id);
                let hidden_quoting_seqs = visibility_changes
                    .iter()
                    .filter(|change| change.visibility == "hidden")
                    .map(|change| change.source_seq)
                    .collect::<Vec<_>>();
                let tombstones = visibility_changes
                    .into_iter()
                    .filter(|change| change.visibility == "hidden")
                    .map(|change| {
                        ProjectionDelta::ThreadPostRemoved(wire::ThreadPostRemovedDelta {
                            game,
                            channel: claim.scope.channel().to_string(),
                            source_seq: change.source_seq,
                        })
                    })
                    .collect::<Vec<_>>();
                let mut batch = tombstones;
                batch.push(assembly_or_break!(
                    thread_posts_delta_for_ws(
                        &state,
                        game,
                        Some(claim.principal_id),
                        claim.scope.channel(),
                    )
                    .await
                ));
                batch.extend(assembly_or_break!(
                    post_citations_deltas_for_ws(
                        &state,
                        game,
                        Some(claim.principal_id),
                        claim.scope.channel(),
                        &hidden_quoting_seqs,
                    )
                    .await
                ));
                let mut next_host_console = None;
                if host_console_interested {
                    let (deltas, current) = assembly_or_break!(
                        host_console_deltas_for_ws(&state, &claim, last_host_console.as_ref(),)
                            .await
                    );
                    batch.extend(deltas);
                    next_host_console = Some(current);
                }
                last_envelope_id = send_deltas_or_break!(batch);
                if let Some(current) = next_host_console {
                    last_host_console = Some(current);
                }
                observed_visibility_change_id = delivered_visibility_change_id;
                continue;
            }
            continue;
        };
        let update = match receive {
            LiveProjectionReceive::Update(update) => {
                eprintln!("LIVE_UPDATE_RECEIVED game={} deltas_len={} thread_dirty={} host_console_dirty={} host_prompts_dirty={} player_private_dirty={} player_command_state_dirty={}", update.game, update.deltas.len(), update.thread_dirty, update.host_console_dirty, update.host_prompts_dirty, update.player_private_dirty, update.player_command_state_dirty);
                update
            }
            LiveProjectionReceive::Lagged { dropped_messages } => {
                tracing::warn!(
                    event = "live_projection_receiver_lagged",
                    game_id = %game,
                    connection_id = %connection_id,
                    dropped_messages,
                    last_envelope_id,
                    "live projection receiver lagged; requesting client resync"
                );
                let _ = send_resync_required(
                    &mut socket,
                    &state,
                    &claim,
                    &plan,
                    last_envelope_id,
                    observed_seq,
                )
                .await;
                break;
            }
            LiveProjectionReceive::Closed => break,
        };
        if !state.live_projection_delivery_delay.is_zero() {
            tokio::time::sleep(state.live_projection_delivery_delay).await;
        }
        if update.game != game {
            continue;
        }
        let Ok(latest_seq) = current_game_event_seq(&state, game).await else {
            let _ = close_live_socket(
                &mut socket,
                last_envelope_id,
                1011,
                "live durable cursor unavailable",
            )
            .await;
            break;
        };
        if !(0..=wire::MAX_SAFE_LIVE_INTEGER).contains(&latest_seq) {
            let _ = close_live_socket(
                &mut socket,
                last_envelope_id,
                1011,
                "live durable cursor invalid",
            )
            .await;
            break;
        }
        if update.player_command_state_dirty {
            let _ = send_resync_required(
                &mut socket,
                &state,
                &claim,
                &plan,
                last_envelope_id,
                observed_seq,
            )
            .await;
            break;
        }
        let mut batch = update.deltas;
        let thread_delta = if let Some(after_seq) = update.thread_after_seq {
            assembly_or_break!(
                thread_posts_after_delta_for_ws(
                    &state,
                    game,
                    Some(claim.principal_id),
                    claim.scope.channel(),
                    after_seq,
                )
                .await
            )
        } else if update.thread_dirty {
            Some(assembly_or_break!(
                thread_posts_delta_for_ws(
                    &state,
                    game,
                    Some(claim.principal_id),
                    claim.scope.channel(),
                )
                .await
            ))
        } else {
            None
        };
        if let Some(delta) = thread_delta {
            batch.push(delta);
            batch.extend(assembly_or_break!(
                post_citations_deltas_for_ws(
                    &state,
                    game,
                    Some(claim.principal_id),
                    claim.scope.channel(),
                    &[],
                )
                .await
            ));
        }
        let mut next_host_console = None;
        if update.host_console_dirty && host_console_interested {
            let (deltas, current) = assembly_or_break!(
                host_console_deltas_for_ws(&state, &claim, last_host_console.as_ref()).await
            );
            batch.extend(deltas);
            next_host_console = Some(current);
        }
        if update.host_prompts_dirty && host_console_interested {
            batch.push(assembly_or_break!(
                host_prompts_delta_for_ws(&state, &claim).await
            ));
        }
        if update.player_private_dirty {
            batch.extend(assembly_or_break!(
                player_private_deltas_for_ws(&state, &claim).await
            ));
        }
        last_envelope_id = send_deltas_or_break!(batch);
        if let Some(current) = next_host_console {
            last_host_console = Some(current);
        }
        observed_seq = latest_seq;
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

fn live_assembly_api_error(error: ApiError) -> String {
    format!("{error:?}")
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

async fn thread_posts_delta_for_ws(
    state: &LiveDeliveryState,
    game: Uuid,
    principal_id: Option<PrincipalId>,
    channel: &str,
) -> Result<ProjectionDelta, String> {
    if channel != "main" {
        let principal_id = principal_id
            .ok_or_else(|| "private thread delivery requires a principal".to_string())?;
        game_http::require_channel_thread_access(&state.pool, game, channel, Some(principal_id))
            .await
            .map_err(live_assembly_api_error)?;
    }
    game_http::current_thread_posts_delta(&state.pool, game, channel)
        .await
        .map_err(|error| error.to_string())
}

async fn thread_posts_after_delta_for_ws(
    state: &LiveDeliveryState,
    game: Uuid,
    principal_id: Option<PrincipalId>,
    channel: &str,
    after_seq: i64,
) -> Result<Option<ProjectionDelta>, String> {
    if channel != "main" {
        let principal_id = principal_id
            .ok_or_else(|| "private thread delivery requires a principal".to_string())?;
        game_http::require_channel_thread_access(&state.pool, game, channel, Some(principal_id))
            .await
            .map_err(live_assembly_api_error)?;
    }
    game_http::current_thread_posts_after_delta(&state.pool, game, channel, after_seq)
        .await
        .map_err(|error| error.to_string())
}

async fn post_citations_deltas_for_ws(
    state: &LiveDeliveryState,
    game: Uuid,
    principal_id: Option<PrincipalId>,
    channel: &str,
    extra_quoting_seqs: &[i64],
) -> Result<Vec<ProjectionDelta>, String> {
    if channel != "main" {
        let principal_id = principal_id
            .ok_or_else(|| "private citation delivery requires a principal".to_string())?;
        game_http::require_channel_thread_access(&state.pool, game, channel, Some(principal_id))
            .await
            .map_err(live_assembly_api_error)?;
    }
    game_http::current_post_citations_deltas(&state.pool, game, channel, extra_quoting_seqs)
        .await
        .map_err(|error| error.to_string())
}

fn socket_has_host_console_interest(capabilities: &CapabilitySet, game: Uuid) -> bool {
    capabilities.grants(&Capability::HostOf(game))
        || capabilities.grants(&Capability::CohostOf(game))
        || capabilities
            .iter()
            .any(|capability| matches!(capability, Capability::GlobalAdmin | Capability::GlobalMod))
}

async fn host_console_deltas_for_ws(
    state: &LiveDeliveryState,
    claim: &WebsocketTicketClaim,
    previous: Option<&HostConsoleStateDelta>,
) -> Result<(Vec<ProjectionDelta>, HostConsoleStateDelta), String> {
    let authorization = websocket_authorization_context(state, claim)
        .await
        .ok_or_else(|| "host-console session authority is no longer valid".to_string())?;
    let game_authorization = game_http::GameAuthorization::from_context(&authorization);
    let game = claim.scope.game();
    let authority =
        game_http::resolve_host_console_authority(&state.pool, game, &game_authorization)
            .await
            .map_err(live_assembly_api_error)?
            .ok_or_else(|| "host-console authority is no longer valid".to_string())?;
    let current = HostConsoleStateDelta::from(
        game_http::load_host_console_state(
            &state.pool,
            game,
            authority,
            claim.scope.slot_id(),
            Some(25),
        )
        .await
        .map_err(live_assembly_api_error)?,
    );
    Ok((host_console_patches(previous, &current), current))
}

async fn host_prompts_delta_for_ws(
    state: &LiveDeliveryState,
    claim: &WebsocketTicketClaim,
) -> Result<ProjectionDelta, String> {
    let authorization = websocket_authorization_context(state, claim)
        .await
        .ok_or_else(|| "host-prompt session authority is no longer valid".to_string())?;
    let game_authorization = game_http::GameAuthorization::from_context(&authorization);
    let game = claim.scope.game();
    game_http::require_host_audit_access(
        &state.pool,
        game,
        &game_authorization,
        "principal cannot read host prompts for this game",
    )
    .await
    .map_err(live_assembly_api_error)?;

    let prompts = projections::host_prompts(&state.pool, game)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(HostPromptDelta::try_from)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(ProjectionDelta::HostPromptsChanged(HostPromptsDelta {
        game,
        prompts,
    }))
}

async fn player_private_deltas_for_ws(
    state: &LiveDeliveryState,
    claim: &WebsocketTicketClaim,
) -> Result<Vec<ProjectionDelta>, String> {
    let Some(slot_id) = claim.scope.slot_id() else {
        return Ok(Vec::new());
    };
    let game = claim.scope.game();
    let principal_id = claim.principal_id;

    let mut deltas = Vec::new();
    let mut notifications =
        game_http::player_notifications_for_principal(&state.pool, game, principal_id)
            .await
            .map_err(live_assembly_api_error)?;
    notifications.retain(|notification| notification.audience_slot == slot_id);
    deltas.push(ProjectionDelta::PlayerNotificationsChanged(
        PlayerNotificationsDelta {
            game,
            notifications,
        },
    ));
    let mut results =
        game_http::player_investigation_results_for_principal(&state.pool, game, principal_id)
            .await
            .map_err(live_assembly_api_error)?;
    results.retain(|result| result.audience_slot == slot_id);
    deltas.push(ProjectionDelta::PlayerInvestigationResultsChanged(
        PlayerInvestigationResultsDelta { game, results },
    ));
    // The read resolves occupancy from this principal's capabilities, so the
    // seat this socket is scoped to is the only one it can be handed. The
    // retain is the same scope narrowing the sibling families apply, not a
    // second authorization.
    let mut mentions =
        game_http::slot_mention_notifications_for_principal(&state.pool, game, principal_id)
            .await
            .map_err(live_assembly_api_error)?;
    mentions.retain(|mention| mention.audience_slot == slot_id);
    deltas.push(ProjectionDelta::SlotMentionsChanged(SlotMentionsDelta {
        game,
        mentions,
    }));
    Ok(deltas)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GuardedSendOutcome {
    Continue(u64),
    Close(u64),
    DropSocket,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LiveDeliveryPlan {
    scope: LiveScope,
    hello: Hello,
    allowed_audiences: BTreeSet<LiveAudience>,
}

impl LiveDeliveryPlan {
    fn from_capabilities(
        state: &LiveDeliveryState,
        claim: &WebsocketTicketClaim,
        capabilities: &CapabilitySet,
    ) -> Result<Option<Self>, wire::LiveWireError> {
        if !delivery_claim_authorized(capabilities, claim) {
            return Ok(None);
        }
        let game = claim.scope.game();
        let caps = capabilities
            .iter()
            .filter(|capability| capability_applies_to_scope(capability, &claim.scope))
            .map(|capability| CapabilityGrant::for_game(capability, game))
            .collect::<Result<Vec<_>, _>>()?;
        let hello = Hello::new(state.server_name.clone(), claim.scope.clone(), caps)?;
        let mut allowed_audiences = BTreeSet::from([
            LiveAudience::Game { game },
            LiveAudience::Thread {
                game,
                channel: claim.scope.channel().to_string(),
            },
        ]);
        if claim.scope.slot_id().is_none() && socket_has_host_console_interest(capabilities, game) {
            allowed_audiences.insert(LiveAudience::Host { game });
        }
        if let Some(slot_id) = claim.scope.slot_id() {
            if capabilities.iter().any(
                |capability| matches!(capability, Capability::SlotOccupant(held) if held == slot_id),
            ) {
                allowed_audiences.insert(LiveAudience::PlayerSlot {
                    game,
                    slot_id: slot_id.to_string(),
                });
            }
        }
        Ok(Some(Self {
            scope: claim.scope.clone(),
            hello,
            allowed_audiences,
        }))
    }
}

fn capability_applies_to_scope(capability: &Capability, scope: &LiveScope) -> bool {
    match capability {
        Capability::GlobalAdmin | Capability::GlobalMod => true,
        Capability::HostOf(game) | Capability::CohostOf(game) => {
            *game == scope.game() && scope.slot_id().is_none()
        }
        Capability::SlotOccupant(slot_id) => scope.slot_id() == Some(slot_id.as_str()),
        Capability::ChannelMember(channel) => channel == scope.channel(),
        Capability::DeadViewer(game) => *game == scope.game() && scope.channel() == "dead",
        Capability::SpectatorOf(game) => *game == scope.game() && scope.channel() == "spectator",
    }
}

fn delivery_claim_authorized(capabilities: &CapabilitySet, claim: &WebsocketTicketClaim) -> bool {
    let game = claim.scope.game();
    let channel = claim.scope.channel();
    let game_operator = capabilities.grants(&Capability::CohostOf(game));
    let channel_authorized = channel == "main"
        || game_operator
        || capabilities.grants(&Capability::ChannelMember(channel.to_string()))
        || (channel == "dead" && capabilities.grants(&Capability::DeadViewer(game)))
        || (channel == "spectator" && capabilities.grants(&Capability::SpectatorOf(game)));
    let slot_authorized = claim.scope.slot_id().is_none_or(|slot_id| {
        capabilities.iter().any(
            |capability| matches!(capability, Capability::SlotOccupant(held) if held == slot_id),
        )
    });
    channel_authorized && slot_authorized
}

fn live_projection_delta_for_plan(
    plan: &LiveDeliveryPlan,
    delta: ProjectionDelta,
) -> Result<Option<LiveProjectionDelta>, wire::LiveWireError> {
    let game = plan.scope.game();
    let live = match delta {
        delta @ (ProjectionDelta::VoteCountChanged(_)
        | ProjectionDelta::VoteCountCleared(_)
        | ProjectionDelta::DayVoteOutcomeApplied(_)) => LiveProjectionDelta::game(game, delta)?,
        delta @ (ProjectionDelta::ThreadPostsChanged(_)
        | ProjectionDelta::ThreadPostRemoved(_)
        | ProjectionDelta::PostCitationsChanged(_)) => {
            LiveProjectionDelta::thread(game, plan.scope.channel(), delta)?
        }
        delta @ (ProjectionDelta::HostConsoleStateChanged(_)
        | ProjectionDelta::HostConsoleHeaderChanged(_)
        | ProjectionDelta::HostConsoleSlotsChanged(_)
        | ProjectionDelta::HostConsoleThreadPostsChanged(_)
        | ProjectionDelta::HostConsoleThreadPostRemoved(_)
        | ProjectionDelta::HostConsoleDayEventsChanged(_)
        | ProjectionDelta::HostConsoleSchedulerChanged(_)
        | ProjectionDelta::HostConsoleTasksChanged(_)
        | ProjectionDelta::HostPromptsChanged(_)) => {
            let audience = LiveAudience::Host { game };
            if !plan.allowed_audiences.contains(&audience) {
                return Ok(None);
            }
            LiveProjectionDelta::host(game, delta)?
        }
        ProjectionDelta::PlayerNotificationsChanged(mut body) => {
            let Some(slot_id) = plan.scope.slot_id() else {
                return Ok(None);
            };
            let audience = LiveAudience::PlayerSlot {
                game,
                slot_id: slot_id.to_string(),
            };
            if !plan.allowed_audiences.contains(&audience) {
                return Ok(None);
            }
            body.notifications
                .retain(|notification| notification.audience_slot == slot_id);
            LiveProjectionDelta::player_slot(
                game,
                slot_id,
                ProjectionDelta::PlayerNotificationsChanged(body),
            )?
        }
        ProjectionDelta::PlayerInvestigationResultsChanged(mut body) => {
            let Some(slot_id) = plan.scope.slot_id() else {
                return Ok(None);
            };
            let audience = LiveAudience::PlayerSlot {
                game,
                slot_id: slot_id.to_string(),
            };
            if !plan.allowed_audiences.contains(&audience) {
                return Ok(None);
            }
            body.results
                .retain(|result| result.audience_slot == slot_id);
            LiveProjectionDelta::player_slot(
                game,
                slot_id,
                ProjectionDelta::PlayerInvestigationResultsChanged(body),
            )?
        }
        ProjectionDelta::SlotMentionsChanged(mut body) => {
            let Some(slot_id) = plan.scope.slot_id() else {
                return Ok(None);
            };
            let audience = LiveAudience::PlayerSlot {
                game,
                slot_id: slot_id.to_string(),
            };
            if !plan.allowed_audiences.contains(&audience) {
                return Ok(None);
            }
            body.mentions
                .retain(|mention| mention.audience_slot == slot_id);
            LiveProjectionDelta::player_slot(
                game,
                slot_id,
                ProjectionDelta::SlotMentionsChanged(body),
            )?
        }
    };
    if plan.allowed_audiences.contains(live.audience()) {
        Ok(Some(live))
    } else {
        Ok(None)
    }
}

async fn send_projection_deltas(
    socket: &mut WebSocket,
    state: &LiveDeliveryState,
    claim: &WebsocketTicketClaim,
    plan: &LiveDeliveryPlan,
    last_envelope_id: u64,
    deltas: Vec<ProjectionDelta>,
) -> GuardedSendOutcome {
    let mut prepared = Vec::new();
    let mut prepared_last_id = last_envelope_id;
    for delta in deltas {
        let live = match live_projection_delta_for_plan(plan, delta) {
            Ok(Some(live)) => live,
            Ok(None) => continue,
            Err(error) => {
                tracing::warn!(event = "live_projection_delta_rejected", %error);
                return close_guarded_delivery(socket, last_envelope_id).await;
            }
        };
        let Some(envelope_id) = wire::next_live_data_envelope_id(prepared_last_id) else {
            tracing::warn!(event = "live_envelope_id_exhausted", last_envelope_id);
            return close_guarded_delivery(socket, last_envelope_id).await;
        };
        let envelope = ServerEnvelope::new(envelope_id, ServerMsg::Delta(live));
        let frame = match server_envelope_frame(&envelope) {
            Ok(frame) => frame,
            Err(error) => {
                tracing::warn!(event = "live_projection_encode_failed", %error);
                return close_guarded_delivery(socket, last_envelope_id).await;
            }
        };
        prepared.push(frame);
        prepared_last_id = envelope_id;
    }
    send_prepared_generation_frames(
        socket,
        state,
        claim,
        plan,
        last_envelope_id,
        prepared_last_id,
        prepared,
    )
    .await
}

async fn send_resync_required(
    socket: &mut WebSocket,
    state: &LiveDeliveryState,
    claim: &WebsocketTicketClaim,
    plan: &LiveDeliveryPlan,
    last_envelope_id: u64,
    from_event_seq: i64,
) -> GuardedSendOutcome {
    let resync = match LiveResyncRequired::new(
        plan.scope.clone(),
        plan.allowed_audiences.iter().cloned().collect(),
        from_event_seq,
    ) {
        Ok(resync) => resync,
        Err(error) => {
            tracing::warn!(event = "live_resync_rejected", %error);
            return close_guarded_delivery(socket, last_envelope_id).await;
        }
    };
    let Some(envelope_id) = wire::next_live_data_envelope_id(last_envelope_id) else {
        tracing::warn!(event = "live_envelope_id_exhausted", last_envelope_id);
        return close_guarded_delivery(socket, last_envelope_id).await;
    };
    let frame = match server_envelope_frame(&ServerEnvelope::new(
        envelope_id,
        ServerMsg::ResyncRequired(resync),
    )) {
        Ok(frame) => frame,
        Err(error) => {
            tracing::warn!(event = "live_resync_encode_failed", %error);
            return close_guarded_delivery(socket, last_envelope_id).await;
        }
    };
    let outcome = send_prepared_generation_frames(
        socket,
        state,
        claim,
        plan,
        last_envelope_id,
        envelope_id,
        vec![frame],
    )
    .await;
    match outcome {
        GuardedSendOutcome::Continue(last_id) => {
            close_live_socket(socket, last_id, 1012, "live resync required").await
        }
        other => other,
    }
}

async fn send_prepared_generation_frames(
    socket: &mut WebSocket,
    state: &LiveDeliveryState,
    claim: &WebsocketTicketClaim,
    plan: &LiveDeliveryPlan,
    previous_last_id: u64,
    prepared_last_id: u64,
    frames: Vec<Message>,
) -> GuardedSendOutcome {
    let Some(guard) = SessionDeliveryGuard::acquire(state, claim).await else {
        return close_guarded_delivery(socket, previous_last_id).await;
    };
    let current_plan = LiveDeliveryPlan::from_capabilities(state, claim, guard.capabilities());
    if !matches!(current_plan, Ok(Some(ref current)) if current == plan) {
        eprintln!(
            "PLAN_MISMATCH ticket_scope={:?} claim_slot={:?} claim_channel={} current={:?} expected={:?}",
            claim.scope,
            claim.scope.slot_id(),
            claim.scope.channel(),
            current_plan,
            plan,
        );
        guard.abort().await;
        return close_guarded_delivery(socket, previous_last_id).await;
    }
    // Even an empty batch is an authority checkpoint. Without this release,
    // an idle socket could outlive a revoked session until some unrelated
    // projection generated a frame.
    if frames.is_empty() {
        return if guard.release().await {
            GuardedSendOutcome::Continue(previous_last_id)
        } else {
            close_guarded_delivery(socket, previous_last_id).await
        };
    }
    for frame in frames {
        if !guarded_application_send(&guard, socket.send(frame)).await {
            // The send future is gone while the authorization fence is still
            // held. Roll back, then force the caller to drop this socket: a
            // cancellation-unsafe sink may retain this frame internally.
            guard.abort().await;
            return GuardedSendOutcome::DropSocket;
        }
    }
    if guard.release().await {
        GuardedSendOutcome::Continue(prepared_last_id)
    } else {
        // Bytes already accepted by the socket are irreversible, so preserve
        // the advanced cursor while refusing every later application batch.
        close_guarded_delivery(socket, prepared_last_id).await
    }
}

async fn send_generation_heartbeat(
    socket: &mut WebSocket,
    state: &LiveDeliveryState,
    claim: &WebsocketTicketClaim,
    plan: &LiveDeliveryPlan,
) -> bool {
    let frame = match server_envelope_frame(&ServerEnvelope::new(
        LIVE_HEARTBEAT_ENVELOPE_ID,
        ServerMsg::Hello(plan.hello.clone()),
    )) {
        Ok(frame) => frame,
        Err(error) => {
            tracing::warn!(event = "live_heartbeat_encode_failed", %error);
            return false;
        }
    };
    let Some(guard) = SessionDeliveryGuard::acquire(state, claim).await else {
        let _ = close_guarded_delivery(socket, LIVE_HEARTBEAT_ENVELOPE_ID).await;
        return false;
    };
    let current_plan = LiveDeliveryPlan::from_capabilities(state, claim, guard.capabilities());
    if !matches!(current_plan, Ok(Some(ref current)) if current == plan) {
        guard.abort().await;
        let _ = close_guarded_delivery(socket, LIVE_HEARTBEAT_ENVELOPE_ID).await;
        return false;
    }
    if !guarded_application_send(&guard, socket.send(frame)).await {
        guard.abort().await;
        return false;
    }
    guard.release().await
}

async fn close_guarded_delivery(
    socket: &mut WebSocket,
    last_envelope_id: u64,
) -> GuardedSendOutcome {
    close_live_socket(
        socket,
        last_envelope_id,
        1008,
        "live generation authority changed",
    )
    .await
}

async fn close_live_socket(
    socket: &mut WebSocket,
    last_envelope_id: u64,
    code: u16,
    reason: &'static str,
) -> GuardedSendOutcome {
    let _ = bounded_control_send(
        socket,
        Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        })),
    )
    .await;
    GuardedSendOutcome::Close(last_envelope_id)
}

fn server_envelope_frame(envelope: &ServerEnvelope) -> Result<Message, String> {
    envelope
        .validate_live()
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    ciborium::into_writer(envelope, &mut bytes).map_err(|error| error.to_string())?;
    Ok(Message::Binary(bytes.into()))
}

#[cfg(test)]
mod tests {
    use super::{
        delivery_claim_authorized, guarded_application_send, live_delivery_deadline_at,
        live_delivery_deadline_bounded_by_at, Capability, CapabilitySet, ControlFrameBudget,
        DeliveryDeadline, EventWake, GameEventWakeHub, LiveScope, NotifyEventWake, PrincipalId,
        WebsocketTicketClaim,
    };
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::task::{Context, Poll};
    use std::time::{Duration, UNIX_EPOCH};
    use uuid::Uuid;

    struct TestDeliveryDeadline {
        deadline: tokio::time::Instant,
        alive: Arc<AtomicBool>,
    }

    impl DeliveryDeadline for TestDeliveryDeadline {
        fn deadline(&self) -> tokio::time::Instant {
            self.deadline
        }
    }

    impl Drop for TestDeliveryDeadline {
        fn drop(&mut self) {
            self.alive.store(false, Ordering::SeqCst);
        }
    }

    struct CancellationUnsafeSend {
        guard_alive: Arc<AtomicBool>,
        buffered: Arc<AtomicBool>,
        cancelled: Arc<AtomicBool>,
        cancelled_while_guarded: Arc<AtomicBool>,
    }

    impl Future for CancellationUnsafeSend {
        type Output = Result<(), ()>;

        fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
            self.buffered.store(true, Ordering::SeqCst);
            Poll::Pending
        }
    }

    impl Drop for CancellationUnsafeSend {
        fn drop(&mut self) {
            self.cancelled.store(true, Ordering::SeqCst);
            self.cancelled_while_guarded
                .store(self.guard_alive.load(Ordering::SeqCst), Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn notify_event_wake_returns_on_matching_game() {
        let hub = GameEventWakeHub::new();
        let game = Uuid::new_v4();
        let mut wake = NotifyEventWake::new(game, hub.subscribe(), Duration::from_secs(5));
        wake.wait().await;
        let published = hub.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            published.fan_out_game(Uuid::new_v4());
            published.fan_out_game(game);
        });
        tokio::time::timeout(Duration::from_secs(1), wake.wait())
            .await
            .expect("matching NOTIFY woke the session");
    }

    #[test]
    fn delivery_scope_mirrors_dead_and_spectator_channel_authority() {
        let game = Uuid::new_v4();
        let claim = |channel: &str| WebsocketTicketClaim {
            session_reference: "0".repeat(64),
            access_expires_at: i64::MAX,
            principal_id: PrincipalId::random(),
            scope: LiveScope::new(game, channel, None).unwrap(),
            after_seq: 0,
        };

        let dead = CapabilitySet::from_iter([Capability::DeadViewer(game)]);
        assert!(delivery_claim_authorized(&dead, &claim("dead")));
        assert!(!delivery_claim_authorized(&dead, &claim("spectator")));

        let spectator = CapabilitySet::from_iter([Capability::SpectatorOf(game)]);
        assert!(delivery_claim_authorized(&spectator, &claim("spectator")));
        assert!(!delivery_claim_authorized(&spectator, &claim("dead")));
    }

    #[test]
    fn host_authority_cannot_impersonate_a_player_slot_scope() {
        let game = Uuid::new_v4();
        let claim = WebsocketTicketClaim {
            session_reference: "0".repeat(64),
            access_expires_at: i64::MAX,
            principal_id: PrincipalId::random(),
            scope: LiveScope::new(game, "main", Some("slot_7".to_string())).unwrap(),
            after_seq: 0,
        };

        let host = CapabilitySet::from_iter([Capability::HostOf(game)]);
        assert!(!delivery_claim_authorized(&host, &claim));

        let global = CapabilitySet::from_iter([Capability::GlobalAdmin]);
        assert!(!delivery_claim_authorized(&global, &claim));

        let occupant = CapabilitySet::from_iter([Capability::SlotOccupant("slot_7".into())]);
        assert!(delivery_claim_authorized(&occupant, &claim));

        let sibling = CapabilitySet::from_iter([Capability::SlotOccupant("slot_8".into())]);
        assert!(!delivery_claim_authorized(&sibling, &claim));
    }

    #[test]
    fn delivery_deadline_preserves_subsecond_expiry_boundary() {
        let valid_until = 1_800_000_000_i64;
        let expires_at = UNIX_EPOCH + Duration::from_secs(valid_until as u64);
        let monotonic_now = tokio::time::Instant::now();

        assert_eq!(
            live_delivery_deadline_at(
                valid_until,
                monotonic_now,
                expires_at - Duration::from_millis(1),
            ),
            Some(monotonic_now + Duration::from_millis(1))
        );
        assert_eq!(
            live_delivery_deadline_at(valid_until, monotonic_now, expires_at),
            None
        );
        assert_eq!(
            live_delivery_deadline_at(
                valid_until,
                monotonic_now,
                expires_at - Duration::from_secs(30),
            ),
            Some(monotonic_now + Duration::from_secs(5))
        );
    }

    #[test]
    fn authority_cutoff_timeouts_outlast_the_delivery_fence() {
        assert!(
            identity::session::AUTHORITY_CUTOFF_LOCK_TIMEOUT > super::LIVE_DELIVERY_BATCH_TIMEOUT
        );
        assert!(
            identity::session::AUTHORITY_CUTOFF_STATEMENT_TIMEOUT
                > identity::session::AUTHORITY_CUTOFF_LOCK_TIMEOUT
        );
    }

    #[test]
    fn authority_acquisition_consumes_the_same_delivery_lease() {
        let valid_until = 1_800_000_000_i64;
        let wall_start = UNIX_EPOCH + Duration::from_secs(valid_until as u64 - 30);
        let monotonic_start = tokio::time::Instant::now();
        let lease_deadline = monotonic_start + Duration::from_secs(5);

        assert_eq!(
            live_delivery_deadline_bounded_by_at(
                valid_until,
                lease_deadline,
                monotonic_start + Duration::from_secs(2),
                wall_start + Duration::from_secs(2),
            ),
            Some(lease_deadline),
            "two seconds spent acquiring authority must leave only three seconds to send"
        );
    }

    #[test]
    fn websocket_control_budget_is_bounded_and_recovers_next_window() {
        let started = tokio::time::Instant::now();
        let mut budget = ControlFrameBudget {
            window_started: started,
            accepted: 0,
        };
        for _ in 0..super::LIVE_CONTROL_FRAMES_PER_SECOND {
            assert!(budget.admit_at(started));
        }
        assert!(!budget.admit_at(started));
        assert!(budget.admit_at(started + Duration::from_secs(1)));
    }

    #[tokio::test]
    async fn timed_out_application_send_is_cancelled_while_guarded() {
        let guard_alive = Arc::new(AtomicBool::new(true));
        let buffered = Arc::new(AtomicBool::new(false));
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancelled_while_guarded = Arc::new(AtomicBool::new(false));
        let guard = TestDeliveryDeadline {
            deadline: tokio::time::Instant::now() + Duration::from_millis(25),
            alive: guard_alive.clone(),
        };

        let sent = guarded_application_send(
            &guard,
            CancellationUnsafeSend {
                guard_alive: guard_alive.clone(),
                buffered: buffered.clone(),
                cancelled: cancelled.clone(),
                cancelled_while_guarded: cancelled_while_guarded.clone(),
            },
        )
        .await;

        assert!(!sent);
        assert!(buffered.load(Ordering::SeqCst));
        assert!(cancelled.load(Ordering::SeqCst));
        assert!(cancelled_while_guarded.load(Ordering::SeqCst));
        assert!(guard_alive.load(Ordering::SeqCst));
    }
}
