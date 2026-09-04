//! Command submission and completed-game import HTTP boundary.
//!
//! This module owns wire-to-command adaptation, authenticated command admission,
//! media-reference preparation, idempotent dispatch, import authorization, and
//! the change-set handoff to live publication. Command decisioning remains in
//! `commands`; live update assembly and publication remain in `live_projection`.

use super::auth_http::{
    authorization_context, bearer_token, require_global_admin, require_global_admin_context,
    unauthorized_session, AuthHttpState, AuthenticatedRequest,
};
use super::live_projection::{self, LiveProjectionChangeSet, LiveProjectionPublisher};
use super::{program_library, ApiError, ApiState};
use axum::extract::{FromRef, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use caps::Principal;
use media::{ContentId, MediaRepository, VariantFormat, VariantLimits};
use sqlx::pool::PoolConnection;
use sqlx::{Connection as _, PgConnection, PgPool, Postgres, Transaction};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Weak};
use std::time::Duration;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use tokio::time::{timeout, timeout_at, Instant};
use uuid::Uuid;
use wire::{
    AckMsg, ClientEnvelope, RejectCode, RejectMsg, ServerEnvelope, ServerMsg, PROTOCOL_VERSION,
};

/// Commands may hold identity owner/session locks only inside this end-to-end
/// budget. The cleanup reserve is separate so a timed-out SQL future can be
/// dropped and its connection closed before a seven-second authority cutoff
/// gives up waiting for the same rows.
const COMMAND_AUTHORITY_LEASE_TIMEOUT: Duration = Duration::from_secs(5);
const COMMAND_AUTHORITY_CLEANUP_TIMEOUT: Duration = Duration::from_secs(1);

const _: () = assert!(
    COMMAND_AUTHORITY_LEASE_TIMEOUT.as_millis() + COMMAND_AUTHORITY_CLEANUP_TIMEOUT.as_millis()
        < identity::session::AUTHORITY_CUTOFF_LOCK_TIMEOUT.as_millis()
);

#[derive(Clone)]
pub(super) struct CommandHttpState {
    pool: PgPool,
    auth: AuthHttpState,
    media_store: MediaRepository,
    variant_limits: VariantLimits,
    live_projection: LiveProjectionPublisher,
    embed_lookup: crate::embed_http::YoutubeSnapshotLookup,
    command_slots: Arc<Semaphore>,
    command_principal_slots: Arc<Mutex<HashMap<principal::PrincipalId, Weak<Semaphore>>>>,
    command_lock_timeout: Duration,
    authority_transaction_slots: Arc<Semaphore>,
}

impl FromRef<CommandHttpState> for AuthHttpState {
    fn from_ref(state: &CommandHttpState) -> Self {
        state.auth.clone()
    }
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
            command_slots: state.command_slots.clone(),
            command_principal_slots: state.command_principal_slots.clone(),
            command_lock_timeout: state.command_lock_timeout,
            authority_transaction_slots: state.authority_transaction_slots.clone(),
        }
    }
}

/// Process-local admission bounds both total command preparation and one
/// principal's concurrency before any durable transaction is checked out.
struct CommandAdmission {
    _global_permit: OwnedSemaphorePermit,
    _principal_permit: OwnedSemaphorePermit,
}

impl CommandAdmission {
    async fn acquire(
        state: &CommandHttpState,
        principal_id: principal::PrincipalId,
    ) -> Result<Self, ApiError> {
        let global_permit = state
            .command_slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| ApiError::Unavailable {
                retry_after_seconds: 1,
                message: "command capacity is exhausted; retry shortly".to_string(),
            })?;
        let principal_slots = {
            let mut slots = state.command_principal_slots.lock().await;
            slots.retain(|_, slots| slots.strong_count() > 0);
            if let Some(existing) = slots.get(&principal_id).and_then(Weak::upgrade) {
                existing
            } else {
                let created = Arc::new(Semaphore::new(1));
                slots.insert(principal_id, Arc::downgrade(&created));
                created
            }
        };
        let principal_permit =
            principal_slots
                .try_acquire_owned()
                .map_err(|_| ApiError::Unavailable {
                    retry_after_seconds: 1,
                    message: "principal command capacity is exhausted; retry shortly".to_string(),
                })?;
        Ok(Self {
            _global_permit: global_permit,
            _principal_permit: principal_permit,
        })
    }
}

/// Keep an owned pool connection armed for closure until its transaction has
/// definitely committed or rolled back. If the request future is cancelled at
/// any await, Rust drops the transaction first (queueing SQLx's rollback) and
/// this guard then prevents the possibly-busy connection from re-entering the
/// pool; SQLx closes it instead, forcing PostgreSQL to abort outstanding work.
struct CommandAuthorityConnection {
    connection: Option<PoolConnection<Postgres>>,
}

impl CommandAuthorityConnection {
    fn new(connection: PoolConnection<Postgres>) -> Self {
        Self {
            connection: Some(connection),
        }
    }

    fn connection_mut(&mut self) -> &mut PgConnection {
        self.connection
            .as_deref_mut()
            .expect("command authority connection is present until terminal cleanup")
    }

    fn release(mut self) {
        drop(self.connection.take());
    }

    async fn close(mut self, command_id: Uuid, reason: &'static str) {
        let Some(mut connection) = self.connection.take() else {
            return;
        };
        connection.close_on_drop();
        match timeout(COMMAND_AUTHORITY_CLEANUP_TIMEOUT, connection.close()).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                tracing::warn!(
                    event = "command_authority_connection_close_failed",
                    %command_id,
                    reason,
                    %error,
                    "command authority connection failed to close cleanly"
                );
            }
            Err(_) => {
                tracing::warn!(
                    event = "command_authority_connection_close_timed_out",
                    %command_id,
                    reason,
                    "command authority connection close exceeded its cleanup reserve"
                );
            }
        }
    }
}

impl Drop for CommandAuthorityConnection {
    fn drop(&mut self) {
        if let Some(connection) = self.connection.as_mut() {
            connection.close_on_drop();
        }
    }
}

/// One authority-bearing command operation. The transaction never escapes
/// `execute`, so callers cannot accidentally pause between session validation
/// and persistence or extend the identity-lock lifetime past its deadline.
struct AuthorizedCommandCommit<'a> {
    state: &'a CommandHttpState,
    bearer: &'a str,
    expected_principal_id: principal::PrincipalId,
    command_id: Uuid,
    command: commands::Command,
    requires_global_admin: bool,
}

enum AuthorizedCommandExecuteError {
    Boundary(ApiError),
    Reject(commands::Reject),
    LeaseExpired,
    CommitOutcomeUnknown,
}

impl From<ApiError> for AuthorizedCommandExecuteError {
    fn from(error: ApiError) -> Self {
        Self::Boundary(error)
    }
}

impl From<sqlx::Error> for AuthorizedCommandExecuteError {
    fn from(error: sqlx::Error) -> Self {
        Self::Boundary(ApiError::from(error))
    }
}

impl<'a> AuthorizedCommandCommit<'a> {
    fn new(
        state: &'a CommandHttpState,
        bearer: &'a str,
        expected_principal_id: principal::PrincipalId,
        command_id: Uuid,
        command: commands::Command,
        requires_global_admin: bool,
    ) -> Self {
        Self {
            state,
            bearer,
            expected_principal_id,
            command_id,
            command,
            requires_global_admin,
        }
    }

    async fn execute(self) -> Result<commands::Ack, AuthorizedCommandExecuteError> {
        // Start before pool checkout/BEGIN: every wait capable of delaying the
        // first identity lock or extending an already-owned one consumes the
        // same lease.
        let deadline = Instant::now() + COMMAND_AUTHORITY_LEASE_TIMEOUT;
        let authority_permit = self
            .state
            .authority_transaction_slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| {
                AuthorizedCommandExecuteError::Boundary(ApiError::Unavailable {
                    retry_after_seconds: 1,
                    message: "authority transaction capacity is exhausted; retry shortly"
                        .to_string(),
                })
            })?;
        let connection = match timeout_at(deadline, self.state.pool.acquire()).await {
            Ok(Ok(connection)) => connection,
            Ok(Err(error)) => return Err(error.into()),
            Err(_) => return Err(AuthorizedCommandExecuteError::LeaseExpired),
        };
        let mut connection = CommandAuthorityConnection::new(connection);
        let mut tx = match timeout_at(deadline, connection.connection_mut().begin()).await {
            Ok(Ok(tx)) => tx,
            // The BEGIN future still carries the mutable connection borrow in
            // this match temporary. Returning leaves the cancellation guard
            // armed; its Drop marks the pooled connection close-on-drop so an
            // errored or indeterminate BEGIN can never re-enter the pool.
            Ok(Err(error)) => return Err(error.into()),
            Err(_) => return Err(AuthorizedCommandExecuteError::LeaseExpired),
        };

        let command_id = self.command_id;
        let operation = apply_authorized_command_in_tx(
            &mut tx,
            self.state,
            self.bearer,
            self.expected_principal_id,
            self.command_id,
            self.command,
            self.requires_global_admin,
        );
        let ack = match timeout_at(deadline, operation).await {
            Ok(Ok(ack)) => ack,
            Ok(Err(error)) => {
                if rollback_authority_transaction(tx, deadline, command_id, "command_rejected")
                    .await
                {
                    connection.release();
                } else {
                    connection.close(command_id, "command_rejected").await;
                }
                drop(authority_permit);
                return Err(error);
            }
            Err(_) => {
                drop(tx);
                connection
                    .close(command_id, "authority_lease_expired")
                    .await;
                drop(authority_permit);
                return Err(AuthorizedCommandExecuteError::LeaseExpired);
            }
        };

        match timeout_at(deadline, tx.commit()).await {
            Ok(Ok(())) => {
                connection.release();
                drop(authority_permit);
                Ok(ack)
            }
            Ok(Err(error)) => {
                tracing::error!(
                    event = "command_commit_outcome_unknown",
                    %command_id,
                    %error,
                    "command commit acknowledgement was lost; retry requires the same command id"
                );
                connection.close(command_id, "commit_failed").await;
                drop(authority_permit);
                Err(AuthorizedCommandExecuteError::CommitOutcomeUnknown)
            }
            Err(_) => {
                tracing::error!(
                    event = "command_commit_outcome_unknown",
                    %command_id,
                    "command commit exceeded its authority lease; retry requires the same command id"
                );
                connection.close(command_id, "commit_timed_out").await;
                drop(authority_permit);
                Err(AuthorizedCommandExecuteError::CommitOutcomeUnknown)
            }
        }
    }
}

async fn apply_authorized_command_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    state: &CommandHttpState,
    bearer: &str,
    expected_principal_id: principal::PrincipalId,
    command_id: Uuid,
    command: commands::Command,
    requires_global_admin: bool,
) -> Result<commands::Ack, AuthorizedCommandExecuteError> {
    commands::set_command_lock_timeout_in_tx(
        tx,
        Some(
            state
                .command_lock_timeout
                .min(COMMAND_AUTHORITY_LEASE_TIMEOUT),
        ),
    )
    .await
    .map_err(AuthorizedCommandExecuteError::Reject)?;
    commands::try_lock_command_stream_in_tx(tx, &command)
        .await
        .map_err(AuthorizedCommandExecuteError::Reject)?;

    let mut identity_owners = commands::command_identity_targets(&command);
    identity_owners
        .entry(expected_principal_id)
        .and_modify(|policy| *policy = (*policy).max(commands::CommandIdentityTargetPolicy::Active))
        .or_insert(commands::CommandIdentityTargetPolicy::Active);
    for (principal_id, policy) in identity_owners {
        let is_actor = principal_id == expected_principal_id;
        let owner = match identity::methods::lock_identity_mutation(
            tx,
            &principal_id,
            identity::methods::IdentityMutationExtent::Owner,
        )
        .await
        {
            Ok(owner) => owner,
            Err(identity::IdentityFlowError::Unauthorized) if !is_actor => {
                return Err(AuthorizedCommandExecuteError::Reject(
                    commands::Reject::InvalidTarget,
                ));
            }
            Err(error) => {
                return Err(AuthorizedCommandExecuteError::Boundary(
                    command_identity_error(error, is_actor),
                ));
            }
        };
        if policy == commands::CommandIdentityTargetPolicy::Active {
            owner.require_active().map_err(|error| {
                AuthorizedCommandExecuteError::Boundary(command_identity_error(error, is_actor))
            })?;
        }
    }

    let authorization =
        identity::session::validate_session_for_update(tx, bearer, &state.auth.session_policy)
            .await
            .map_err(|error| {
                AuthorizedCommandExecuteError::Boundary(command_identity_error(error, true))
            })?;
    if authorization.principal_id != expected_principal_id {
        return Err(AuthorizedCommandExecuteError::Boundary(
            unauthorized_session(),
        ));
    }
    if requires_global_admin {
        require_global_admin_context(&authorization, "game creation")?;
    }

    commands::handle_idempotent_in_tx(
        tx,
        &Principal::authenticated(authorization.principal_id),
        command_id,
        command,
    )
    .await
    .map_err(|reject| {
        // A receipt-claim lock timeout (55P03) means the command exhausted its
        // authority lock budget. It must surface as a retryable lease expiry
        // (503), not a terminal internal reject (200): the Postgres lock_timeout
        // races the Rust lease deadline, and both outcomes must agree.
        if commands::reject_is_authority_lock_timeout(&reject) {
            AuthorizedCommandExecuteError::LeaseExpired
        } else {
            AuthorizedCommandExecuteError::Reject(reject)
        }
    })
}

async fn rollback_authority_transaction(
    tx: Transaction<'_, Postgres>,
    deadline: Instant,
    command_id: Uuid,
    reason: &'static str,
) -> bool {
    match timeout_at(deadline, tx.rollback()).await {
        Ok(Ok(())) => true,
        Ok(Err(error)) => {
            tracing::warn!(
                event = "command_authority_rollback_failed",
                %command_id,
                reason,
                %error,
                "command authority transaction failed to roll back cleanly"
            );
            false
        }
        Err(_) => false,
    }
}

fn command_identity_error(error: identity::IdentityFlowError, actor: bool) -> ApiError {
    match error {
        identity::IdentityFlowError::Unauthorized if !actor => {
            command_reject_api_error(commands::Reject::InvalidTarget)
        }
        identity::IdentityFlowError::Db(error)
            if error
                .as_database_error()
                .and_then(|error| error.code())
                .as_deref()
                == Some("55P03") =>
        {
            ApiError::Unavailable {
                retry_after_seconds: 1,
                message: "command authority is busy; retry shortly".to_string(),
            }
        }
        error => ApiError::from(error),
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

    let (token, initial_authorization) =
        match authenticated_transport_authorization(&state, &headers).await {
            Ok(authorization) => authorization,
            Err(error) => return command_api_error_response(envelope.id, error),
        };
    let requires_global_admin = matches!(&msg.command, wire::Command::CreateGame { .. });
    if requires_global_admin {
        if let Err(error) = require_global_admin_context(&initial_authorization, "game creation") {
            return command_api_error_response(envelope.id, error);
        }
    }

    let principal_id = initial_authorization.principal_id;
    let _admission = match CommandAdmission::acquire(&state, principal_id).await {
        Ok(admission) => admission,
        Err(error) => return command_api_error_response(envelope.id, error),
    };

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
    let prepared_command = prepare_wire_command(&state, msg.command).await;
    let body = match prepared_command {
        Err(reject) => ServerMsg::Reject(RejectMsg::from(reject)),
        Ok(command) => {
            let _inflight = state.live_projection.inflight_guard(classified.game);
            match AuthorizedCommandCommit::new(
                &state,
                token.as_str(),
                principal_id,
                msg.command_id,
                command,
                requires_global_admin,
            )
            .execute()
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
                Err(AuthorizedCommandExecuteError::Boundary(error)) => {
                    return command_api_error_response(envelope.id, error);
                }
                Err(AuthorizedCommandExecuteError::Reject(reject)) if reject.is_retryable() => {
                    return command_retryable_reject_response(envelope.id, reject);
                }
                Err(AuthorizedCommandExecuteError::Reject(reject)) => {
                    ServerMsg::Reject(RejectMsg::from(reject))
                }
                Err(AuthorizedCommandExecuteError::LeaseExpired) => {
                    return command_authority_lease_expired_response(envelope.id);
                }
                Err(AuthorizedCommandExecuteError::CommitOutcomeUnknown) => {
                    return command_commit_outcome_unknown_response(envelope.id);
                }
            }
        }
    };
    Json(ServerEnvelope::new(envelope.id, body)).into_response()
}

fn command_authority_lease_expired_response(id: u64) -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(ServerEnvelope::new(
            id,
            ServerMsg::Reject(RejectMsg {
                error: RejectCode::Internal,
                retryable: true,
                message:
                    "command authority lease expired before commit; retry the exact same command_id"
                        .to_string(),
            }),
        )),
    )
        .into_response()
}

fn command_commit_outcome_unknown_response(id: u64) -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(ServerEnvelope::new(
            id,
            ServerMsg::Reject(RejectMsg {
                error: RejectCode::Internal,
                retryable: true,
                message:
                    "command commit outcome is unknown; retry the exact same command_id to recover"
                        .to_string(),
            }),
        )),
    )
        .into_response()
}

fn command_retryable_reject_response(id: u64, reject: commands::Reject) -> Response {
    (
        command_reject_status(&reject),
        Json(ServerEnvelope::new(
            id,
            ServerMsg::Reject(RejectMsg::from(reject)),
        )),
    )
        .into_response()
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
    request: AuthenticatedRequest,
    Json(export): Json<projections::CompletedGameExport>,
) -> Result<Json<projections::ProjectionAuditReport>, ApiError> {
    require_global_admin(&state.auth, &request.bearer, "completed-game import").await?;
    Ok(Json(
        projections::import_completed_game_export(&state.pool, &export).await?,
    ))
}

async fn authenticated_transport_authorization(
    state: &CommandHttpState,
    headers: &HeaderMap,
) -> Result<(String, identity::AuthorizationContext), ApiError> {
    let token = bearer_token(headers)
        .ok_or_else(unauthorized_session)?
        .to_string();
    let authorization = authorization_context(&state.auth, token.as_str()).await?;
    Ok((token, authorization))
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
    let status = command_reject_status(&reject);
    let error = RejectCode::from(&reject);
    let message = reject.to_string();
    ApiError::Reject {
        status,
        error,
        message,
    }
}

fn command_reject_status(reject: &commands::Reject) -> StatusCode {
    match reject {
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
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_command, DirtySurfaces, COMMAND_AUTHORITY_CLEANUP_TIMEOUT,
        COMMAND_AUTHORITY_LEASE_TIMEOUT,
    };
    use uuid::Uuid;

    #[test]
    fn command_authority_lease_and_cleanup_fit_inside_cutoff_wait_budget() {
        assert!(
            COMMAND_AUTHORITY_LEASE_TIMEOUT + COMMAND_AUTHORITY_CLEANUP_TIMEOUT
                < identity::session::AUTHORITY_CUTOFF_LOCK_TIMEOUT
        );
    }

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
            mentions: None,
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
