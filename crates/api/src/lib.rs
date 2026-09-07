//! `api` — the first network boundary over the command pipeline.
//!
//! The command crate remains pre-HTTP. This crate owns HTTP/WebSocket decoding,
//! temporary dev-principal extraction, and mapping command outcomes into `wire`
//! messages.

mod auth_http;
mod authentication;
mod authority;
mod command_http;
mod embed_http;
mod game_http;
pub mod identity_delivery;
mod live_delivery;
mod live_projection;
pub mod mash_scale;
mod media_http;
mod membership_http;
pub mod program_library;
mod public_platform_http;
mod runtime_config;
mod runtime_health;

pub use auth_http::{
    bootstrap_classic_global_admin, bootstrap_workos_global_admin, LocalProofAuthVerifier,
    LOCAL_PROOF_AUTH_HEADER,
};
pub use embed_http::YoutubeSnapshotLookup;
pub use game_http::{
    load_host_console_state_for_principal, load_player_day_event_attention_for_principal,
    EndgameDayVote, EndgameSlotReveal, EndgameSummaryResponse, EndgameWinner,
    HostConsolePhaseState, HostConsoleSlotOccupancy, HostConsoleStateResponse,
    HostConsoleThreadPost, HostPrompt, HostSetupAttachedProgram, HostSetupPackState,
    HostSetupPostPolicyState, HostSetupProgramCompatibility, HostSetupProgramCompatibilityIssue,
    HostSetupProgramOption, HostSetupProgramSchedulePreview, HostSetupRoleOption,
    HostSetupSlotState, HostSetupStateResponse, PlayerCommandAction, PlayerCommandCurrentAction,
    PlayerCommandPhaseState, PlayerCommandRoleView, PlayerCommandStateResponse,
    PlayerDayEventAttention, PlayerVoteTarget,
};
pub use live_delivery::WebsocketTicketResponse;
pub use media_http::{MediaUploadResponse, MediaUploadVariant};
pub use runtime_config::{
    ApiRuntimeConfig, ApiRuntimeConfigError, AuthBudget, AuthorityBudget, CommandBudget,
    MediaBudget, WebSocketBudget,
};
pub use runtime_health::{RuntimeWorkerHealth, WorkerHealthView};

use auth_http::{internal_auth_error, unauthorized_session, unix_now_seconds, AuthHttpState};

use live_delivery::GameEventWakeHub;
use live_projection::LiveProjectionPublisher;

use crate::identity_delivery::{IdentityDeliveryError, IdentityDeliveryGateway};
use axum::extract::{FromRef, State};
use axum::http::header::RETRY_AFTER;
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use identity::{AccessTokenVerifier, FilesystemSubjectKeyStore, SubjectKeyStore};
use media::{MediaRepository, VariantLimits};
use principal::PrincipalId;
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;
use std::collections::HashMap;
use std::sync::{Arc, Weak};
use std::time::Duration;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;
use wire::{ProjectionAdapterError, RejectCode, RejectMsg};

#[derive(Clone)]
pub struct ApiState {
    pool: PgPool,
    auth: AuthHttpState,
    media_store: MediaRepository,
    subject_key_store: Option<Arc<dyn SubjectKeyStore>>,
    variant_limits: VariantLimits,
    server_name: String,
    live_projection: LiveProjectionPublisher,
    live_projection_delivery_delay: Duration,
    live_connection_slots: Arc<Semaphore>,
    live_principal_slots: Arc<Mutex<HashMap<PrincipalId, Arc<Semaphore>>>>,
    live_principal_limit: usize,
    live_delivery_transaction_slots: Arc<Semaphore>,
    live_delivery_transaction_limit: usize,
    command_slots: Arc<Semaphore>,
    command_principal_slots: Arc<Mutex<HashMap<PrincipalId, Weak<Semaphore>>>>,
    command_lock_timeout: Duration,
    authority_transaction_slots: Arc<Semaphore>,
    authority_transaction_limit: usize,
    media_slots: Arc<Semaphore>,
    media_account_quota_bytes: i64,
    media_upload_lease_seconds: i64,
    websocket_poll_interval: Duration,
    websocket_heartbeat_interval: Duration,
    live_event_wake: GameEventWakeHub,
    embed_lookup: embed_http::YoutubeSnapshotLookup,
    worker_health: RuntimeWorkerHealth,
}

impl FromRef<ApiState> for AuthHttpState {
    fn from_ref(state: &ApiState) -> Self {
        state.auth.clone()
    }
}

impl ApiState {
    pub fn new(
        pool: PgPool,
        media_store: impl Into<MediaRepository>,
        runtime: ApiRuntimeConfig,
    ) -> Result<Self, ApiRuntimeConfigError> {
        let pool_capacity = pool.options().get_max_connections() as usize;
        runtime.validate(pool_capacity)?;
        let authority_transaction_limit = runtime.authority.transaction_max_in_flight;
        let live_delivery_transaction_limit = runtime.websocket.delivery_max_in_flight;
        let auth = AuthHttpState::new(pool.clone(), &runtime.auth, &runtime.websocket);
        let live_event_wake = GameEventWakeHub::new();
        Ok(ApiState {
            pool,
            auth,
            media_store: media_store.into(),
            subject_key_store: if cfg!(debug_assertions) {
                FilesystemSubjectKeyStore::from_environment()
                    .ok()
                    .map(|store| Arc::new(store) as Arc<dyn SubjectKeyStore>)
            } else {
                None
            },
            variant_limits: VariantLimits::default(),
            server_name: "fmarch-dev".to_string(),
            live_projection: LiveProjectionPublisher::new(runtime.websocket.projection_capacity),
            live_projection_delivery_delay: runtime.websocket.projection_delivery_delay,
            live_connection_slots: Arc::new(Semaphore::new(runtime.websocket.max_connections)),
            live_principal_slots: Arc::new(Mutex::new(HashMap::new())),
            live_principal_limit: runtime.websocket.max_connections_per_principal,
            live_delivery_transaction_slots: Arc::new(Semaphore::new(
                live_delivery_transaction_limit,
            )),
            live_delivery_transaction_limit,
            command_slots: Arc::new(Semaphore::new(runtime.command.max_in_flight)),
            command_principal_slots: Arc::new(Mutex::new(HashMap::new())),
            command_lock_timeout: runtime.command.lock_timeout,
            authority_transaction_slots: Arc::new(Semaphore::new(authority_transaction_limit)),
            authority_transaction_limit,
            media_slots: Arc::new(Semaphore::new(runtime.media.max_in_flight)),
            media_account_quota_bytes: runtime.media.account_quota_bytes,
            media_upload_lease_seconds: runtime.media.upload_lease_seconds,
            websocket_poll_interval: runtime.websocket.poll_interval,
            websocket_heartbeat_interval: runtime.websocket.heartbeat_interval,
            live_event_wake,
            embed_lookup: embed_http::YoutubeSnapshotLookup::http().expect("youtube oembed client"),
            worker_health: RuntimeWorkerHealth::default(),
        })
    }

    pub fn with_embed_lookup(mut self, lookup: embed_http::YoutubeSnapshotLookup) -> Self {
        self.embed_lookup = lookup;
        self
    }

    /// Classic (username + password) sign-in is a first-class method, enabled
    /// by default; a WorkOS-only deployment can switch it off.
    pub fn with_classic_auth(mut self, enabled: bool) -> Self {
        self.auth.classic_enabled = enabled;
        self
    }

    pub fn with_server_name(mut self, name: impl Into<String>) -> Self {
        self.server_name = name.into();
        self
    }

    pub fn with_local_proof_auth(mut self, verifier: LocalProofAuthVerifier) -> Self {
        #[cfg(debug_assertions)]
        {
            self.auth.session_policy = self
                .auth
                .session_policy
                .with_local_proof_instance(verifier.instance_id().clone());
            self.auth.local_proof_auth = Some(verifier);
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = verifier;
            self.auth.local_proof_auth = None;
            self.auth.session_policy = self.auth.session_policy.without_local_proof_instance();
        }
        self
    }

    pub fn without_local_proof_auth(mut self) -> Self {
        self.auth.local_proof_auth = None;
        self.auth.session_policy = self.auth.session_policy.without_local_proof_instance();
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
        assert!((2..=100).contains(&account_max_failures));
        assert!((2..=10_000).contains(&source_max_failures));
        assert!((1..=86_400).contains(&window_seconds));
        assert!((1..=86_400).contains(&lockout_seconds));
        assert!(retention_seconds >= window_seconds.max(lockout_seconds));
        assert!(retention_seconds <= 31_536_000);
        self.auth.auth_attempt_policy.account_max_failures = account_max_failures;
        self.auth.auth_attempt_policy.source_max_failures = source_max_failures;
        self.auth.auth_attempt_policy.window_seconds = window_seconds;
        self.auth.auth_attempt_policy.lockout_seconds = lockout_seconds;
        self.auth.auth_attempt_policy.retention_seconds = retention_seconds;
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

    pub fn with_identity_delivery_worker_config(
        mut self,
        config: identity_delivery::IdentityDeliveryWorkerConfig,
    ) -> Self {
        self.auth.identity_delivery_worker_config = config;
        self
    }

    pub fn with_registration_source_limit(mut self, max_registrations: i32) -> Self {
        assert!((2..=10_000).contains(&max_registrations));
        self.auth.auth_attempt_policy.registration_max_per_source = max_registrations;
        self
    }

    pub fn with_live_projection_capacity(mut self, capacity: usize) -> Self {
        assert!((1..=65_536).contains(&capacity));
        self.live_projection = LiveProjectionPublisher::new(capacity);
        self
    }

    pub fn with_live_projection_delivery_delay(mut self, delay: Duration) -> Self {
        assert!(delay <= Duration::from_secs(60));
        self.live_projection_delivery_delay = delay;
        self
    }

    pub fn with_live_connection_limit(mut self, limit: usize) -> Self {
        assert!((1..=65_536).contains(&limit));
        self.live_connection_slots = Arc::new(Semaphore::new(limit));
        self
    }

    pub fn with_live_principal_connection_limit(mut self, limit: usize) -> Self {
        assert!((1..=1_024).contains(&limit));
        self.live_principal_limit = limit;
        self
    }

    pub fn with_live_delivery_transaction_limit(mut self, limit: usize) -> Self {
        assert!((1..self.authority_transaction_limit).contains(&limit));
        self.live_delivery_transaction_limit = limit;
        self.live_delivery_transaction_slots =
            Arc::new(Semaphore::new(self.live_delivery_transaction_limit));
        self
    }

    pub fn with_command_limit(mut self, limit: usize) -> Self {
        assert!((1..=1_024).contains(&limit));
        self.command_slots = Arc::new(Semaphore::new(limit));
        self
    }

    pub fn with_command_lock_timeout(mut self, timeout: Duration) -> Self {
        assert!((Duration::from_millis(100)..=Duration::from_secs(30)).contains(&timeout));
        self.command_lock_timeout = timeout;
        self
    }

    pub fn with_authority_transaction_limit(mut self, limit: usize) -> Self {
        let pool_capacity = self.pool.options().get_max_connections() as usize;
        let ceiling = pool_capacity
            .checked_sub(3)
            .expect("ApiState database pool reserve was validated at construction");
        assert!((2..=ceiling).contains(&limit));
        self.authority_transaction_limit = limit;
        self.authority_transaction_slots =
            Arc::new(Semaphore::new(self.authority_transaction_limit));
        self.live_delivery_transaction_limit = self
            .live_delivery_transaction_limit
            .min(self.authority_transaction_limit - 1);
        self.live_delivery_transaction_slots =
            Arc::new(Semaphore::new(self.live_delivery_transaction_limit));
        self
    }

    pub fn with_password_limit(mut self, limit: usize) -> Self {
        assert!((1..=64).contains(&limit));
        self.auth.password_slots = Arc::new(Semaphore::new(limit));
        self
    }

    pub fn with_workos_verification_limit(mut self, limit: usize) -> Self {
        assert!((1..=128).contains(&limit));
        self.auth.workos_verification_slots = Arc::new(Semaphore::new(limit));
        self
    }

    pub fn with_workos_verification_source_limit(mut self, limit: i32) -> Self {
        assert!((2..=10_000).contains(&limit));
        self.auth.workos_verification_max_per_source = limit;
        self
    }

    pub fn with_media_limit(mut self, limit: usize) -> Self {
        assert!((1..=32).contains(&limit));
        self.media_slots = Arc::new(Semaphore::new(limit));
        self
    }

    pub fn with_media_upload_lease_seconds(mut self, seconds: i64) -> Self {
        assert!((60..=24 * 60 * 60).contains(&seconds));
        self.media_upload_lease_seconds = seconds;
        self
    }

    pub fn with_websocket_audience(mut self, audience: impl Into<String>) -> Self {
        self.auth.websocket_audience = audience.into();
        self
    }

    pub fn with_websocket_ticket_ttl(mut self, ttl: Duration) -> Self {
        assert!((Duration::from_secs(1)..=Duration::from_secs(120)).contains(&ttl));
        self.auth.websocket_ticket_ttl = ttl;
        self
    }

    pub fn with_websocket_poll_interval(mut self, interval: Duration) -> Self {
        assert!((Duration::from_millis(10)..=Duration::from_secs(5)).contains(&interval));
        self.websocket_poll_interval = interval;
        self
    }

    pub fn with_websocket_heartbeat_interval(mut self, interval: Duration) -> Self {
        assert!((Duration::from_millis(10)..=Duration::from_secs(60)).contains(&interval));
        self.websocket_heartbeat_interval = interval;
        self
    }

    pub fn with_access_token_verifier(mut self, verifier: Arc<dyn AccessTokenVerifier>) -> Self {
        self.auth.access_token_verifier = Some(verifier);
        self
    }

    pub fn uses_external_identity(&self) -> bool {
        self.auth.access_token_verifier.is_some()
    }

    pub fn with_subject_key_store(mut self, store: Arc<dyn SubjectKeyStore>) -> Self {
        self.subject_key_store = Some(store);
        self
    }

    pub fn with_worker_health(mut self, worker_health: RuntimeWorkerHealth) -> Self {
        self.worker_health = worker_health;
        self
    }

    /// Runs the process-wide durable live-event wake listener. The process
    /// composition root owns this future and its restart/shutdown policy.
    pub async fn run_live_event_listener<F>(
        &self,
        shutdown: tokio::sync::watch::Receiver<bool>,
        heartbeat: F,
    ) -> Result<(), sqlx::Error>
    where
        F: Fn(u64) + Send + Sync,
    {
        self.live_event_wake
            .run_listener(self.pool.clone(), shutdown, heartbeat)
            .await
    }
}

pub fn router(
    pool: PgPool,
    media_store: impl Into<MediaRepository>,
    runtime: ApiRuntimeConfig,
) -> Result<Router, ApiRuntimeConfigError> {
    Ok(router_with_state(ApiState::new(
        pool,
        media_store,
        runtime,
    )?))
}

pub fn router_with_state(state: ApiState) -> Router {
    let media_routes = media_http::routes(&state);
    let auth_routes = auth_http::routes(&state);
    let command_routes = command_http::routes(&state);
    let public_platform_routes = public_platform_http::routes(&state);
    let embed_routes = embed_http::routes();
    let game_routes = game_http::routes(&state);
    let live_delivery_routes = live_delivery::routes(&state);
    let membership_routes = membership_http::routes(&state);
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz));
    let app = app
        .merge(media_routes)
        .merge(auth_routes)
        .merge(command_routes)
        .merge(public_platform_routes)
        .merge(embed_routes)
        .merge(game_routes)
        .merge(live_delivery_routes);
    let app = app.merge(membership_routes);
    app.with_state(state)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Health {
    pub ok: bool,
    pub release_commit: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Readiness {
    pub ok: bool,
    pub release_commit: String,
    pub database_schema: bool,
    pub event_encryption: bool,
    pub object_storage: bool,
    pub subject_authority: bool,
    pub required_workers: bool,
    pub workers: Vec<WorkerHealthView>,
}

async fn healthz() -> Json<Health> {
    Json(Health {
        ok: true,
        release_commit: release_commit().to_string(),
    })
}

async fn readyz(State(state): State<ApiState>) -> (StatusCode, Json<Readiness>) {
    let (database_schema, event_encryption, object_storage, subject_authority) = tokio::join!(
        database_schema::ensure_schema_ready(&state.pool),
        eventstore::ensure_event_encryption_key_readiness(&state.pool),
        state.media_store.check_readiness(),
        async {
            match state.subject_key_store.as_ref() {
                Some(store) => store.check_readiness().await,
                None => Err(identity::SubjectPrivacyError::Configuration(
                    "subject authority is not installed".to_string(),
                )),
            }
        },
    );
    let workers = state.worker_health.snapshot();
    let required_workers = workers
        .iter()
        .all(|worker| !worker.required || worker.healthy);
    let readiness = Readiness {
        ok: database_schema.is_ok()
            && event_encryption.is_ok()
            && object_storage.is_ok()
            && subject_authority.is_ok()
            && required_workers,
        release_commit: release_commit().to_string(),
        database_schema: database_schema.is_ok(),
        event_encryption: event_encryption.is_ok(),
        object_storage: object_storage.is_ok(),
        subject_authority: subject_authority.is_ok(),
        required_workers,
        workers,
    };
    if !readiness.ok {
        tracing::warn!(
            event = "readiness_failed",
            database_schema_ready = readiness.database_schema,
            event_encryption_ready = readiness.event_encryption,
            object_storage_ready = readiness.object_storage,
            subject_authority_ready = readiness.subject_authority,
            required_workers_ready = readiness.required_workers,
            "API dependency readiness failed"
        );
    }
    let status = if readiness.ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(readiness))
}

pub const fn release_commit() -> &'static str {
    match option_env!("FMARCH_RELEASE_COMMIT") {
        Some(commit) => commit,
        None => "development",
    }
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

#[derive(Debug)]
pub enum ApiError {
    Projection(projections::ProjectionError),
    Capability(caps::CapError),
    Db(sqlx::Error),
    WorkosProviderSessionLogoutRequired {
        session_id: identity::WorkosSessionId,
    },
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

#[derive(Debug, Serialize)]
struct WorkosProviderSessionLogoutRequiredResponse {
    error: &'static str,
    provider_logout_url: String,
}

impl From<projections::ProjectionError> for ApiError {
    fn from(err: projections::ProjectionError) -> Self {
        ApiError::Projection(err)
    }
}

impl From<ProjectionAdapterError> for ApiError {
    fn from(error: ProjectionAdapterError) -> Self {
        ApiError::Reject {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error: RejectCode::Internal,
            message: error.to_string(),
        }
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
            IdentityDeliveryError::Worker(_) => ApiError::Reject {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                error: RejectCode::Internal,
                message: "identity delivery worker task failed".to_string(),
            },
        }
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
            ApiError::WorkosProviderSessionLogoutRequired { session_id } => {
                return (
                    StatusCode::CONFLICT,
                    Json(WorkosProviderSessionLogoutRequiredResponse {
                        error: "WorkosProviderSessionLogoutRequired",
                        provider_logout_url: identity::workos::logout_url(&session_id),
                    }),
                )
                    .into_response();
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
            ApiError::WorkosProviderSessionLogoutRequired { .. } => unreachable!(),
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
    use axum::http::HeaderMap;

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
