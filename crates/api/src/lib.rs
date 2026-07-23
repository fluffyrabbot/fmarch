//! `api` — the first network boundary over the command pipeline.
//!
//! The command crate remains pre-HTTP. This crate owns HTTP/WebSocket decoding,
//! temporary dev-principal extraction, and mapping command outcomes into `wire`
//! messages.

pub mod identity_delivery;

use crate::identity_delivery::{
    delivery_aad, process_identity_delivery_intent, IdentityDeliveryError, IdentityDeliveryGateway,
    IdentityDeliveryKind, LocalDeterministicIdentityDeliveryGateway,
};
use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::header::{
    AUTHORIZATION, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, ETAG, IF_NONE_MATCH, RETRY_AFTER,
};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use caps::{Capability, Principal};
use eventstore::{ActorId, EventInput};
use identity::{AccessTokenVerifier, IdentityError, VerifiedIdentity};
use media::{
    ContentId, IngestStatus, MediaError, MediaStore, VariantFormat, VariantGenerationStatus,
    VariantKind, VariantLimits, VARIANT_RECIPE_REVISION,
};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path as FsPath;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{broadcast, Mutex, OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;
use wire::{
    AckMsg, AdvanceSubscriptionReadRequest, CapabilityGrant, ClientEnvelope, CommunityInboxPage,
    DayVoteOutcomeDelta, DiscussionArea, DiscussionPost, DiscussionThreadPage, DiscussionTopic,
    DiscussionTopicPage, GameIndexEntry, GameIndexPage, Hello, HostConsoleAuthorityDelta,
    HostConsoleAuthorityKind, HostConsolePhaseStateDelta, HostConsoleSlotOccupancyDelta,
    HostConsoleStateDelta, HostConsoleThreadPostDelta, HostPhaseControl, HostPromptDelta,
    HostPromptsDelta, HostTaskAllowedCommand, HostTaskCommandKind, HostTaskDelta, HostTaskKind,
    HostTaskState, HostTaskUrgency, ModerationCase, ModerationCaseDetail, ModerationCasePage,
    ModerationReportReceipt, PlayerInvestigationResult, PlayerInvestigationResultsDelta,
    PlayerNotification, PlayerNotificationsDelta, ProfileEditor, ProjectionDelta,
    PublicGameThreadPage, PublicProfile, PublicSearchPage, PublicSearchResult, RejectCode,
    RejectMsg, ServerEnvelope, ServerMsg, SubscriptionTargetState, ThreadPage, ThreadPost,
    ThreadPostsDelta, VoteCountClearedDelta, VoteCountDelta, PROTOCOL_VERSION,
};

#[derive(Clone)]
pub struct ApiState {
    pool: PgPool,
    media_store: MediaStore,
    variant_limits: VariantLimits,
    server_name: String,
    dev_auth_enabled: bool,
    auth_attempt_policy: AuthAttemptPolicy,
    identity_delivery_gateway: Arc<dyn IdentityDeliveryGateway>,
    live_projection_tx: broadcast::Sender<LiveProjectionUpdate>,
    live_projection_delivery_delay: Duration,
    live_connection_slots: Arc<Semaphore>,
    live_principal_slots: Arc<Mutex<HashMap<String, Arc<Semaphore>>>>,
    live_principal_limit: usize,
    password_slots: Arc<Semaphore>,
    media_slots: Arc<Semaphore>,
    media_account_quota_bytes: i64,
    websocket_audience: String,
    websocket_ticket_ttl: Duration,
    websocket_ticket_max_per_window: i32,
    websocket_poll_interval: Duration,
    access_token_verifier: Option<Arc<dyn AccessTokenVerifier>>,
    session_policy: identity::SessionPolicy,
    classic_enabled: bool,
    allow_jwt_bearer: bool,
}

#[derive(Debug, Clone)]
struct LiveProjectionUpdate {
    game: Uuid,
    deltas: Vec<ProjectionDelta>,
    thread_dirty: bool,
    host_console_dirty: bool,
    host_prompts_dirty: bool,
    player_private_dirty: bool,
    player_command_state_dirty: bool,
}

#[derive(Debug, Clone)]
struct AuthAttemptPolicy {
    account_max_failures: i32,
    source_max_failures: i32,
    registration_max_per_source: i32,
    window_seconds: i64,
    lockout_seconds: i64,
    retention_seconds: i64,
    trust_source_header: bool,
    source_signing_key: Option<Arc<[u8]>>,
}

#[derive(Debug, Clone)]
struct AuthAttemptScope {
    source_scope_hash: String,
    account_scope_hash: Option<String>,
    policy: AuthAttemptPolicy,
}

const AUTH_ATTEMPT_SOURCE_HEADER: &str = "x-fmarch-auth-source";
const AUTH_ATTEMPT_SOURCE_SIGNATURE_HEADER: &str = "x-fmarch-auth-source-signature";
const AUTH_ATTEMPT_SOURCE_TIMESTAMP_HEADER: &str = "x-fmarch-auth-source-timestamp";
const REGISTRATION_SESSION_TTL_SECONDS: i64 = 60 * 60 * 24 * 7;

impl ApiState {
    pub fn new(pool: PgPool, media_store: MediaStore) -> Self {
        let live_projection_capacity =
            env_i64("FMARCH_LIVE_PROJECTION_CAPACITY", 256, 1, 65_536) as usize;
        let live_projection_delivery_delay =
            Duration::from_millis(
                env_i64("FMARCH_LIVE_PROJECTION_DELIVERY_DELAY_MS", 0, 0, 60_000) as u64,
            );
        let live_connection_limit = env_i64("FMARCH_WS_MAX_CONNECTIONS", 512, 1, 65_536) as usize;
        let live_principal_limit =
            env_i64("FMARCH_WS_MAX_CONNECTIONS_PER_PRINCIPAL", 4, 1, 128) as usize;
        let (live_projection_tx, _) = broadcast::channel(live_projection_capacity);
        let _ = dummy_account_password_hash();
        ApiState {
            pool,
            media_store,
            variant_limits: VariantLimits::default(),
            server_name: "fmarch-dev".to_string(),
            dev_auth_enabled: std::env::var("FMARCH_DEV_AUTH").ok().as_deref() == Some("1"),
            auth_attempt_policy: auth_attempt_policy_from_env(),
            identity_delivery_gateway: Arc::new(
                LocalDeterministicIdentityDeliveryGateway::from_env(),
            ),
            live_projection_tx,
            live_projection_delivery_delay,
            live_connection_slots: Arc::new(Semaphore::new(live_connection_limit)),
            live_principal_slots: Arc::new(Mutex::new(HashMap::new())),
            live_principal_limit,
            password_slots: Arc::new(Semaphore::new(env_i64(
                "FMARCH_PASSWORD_MAX_IN_FLIGHT",
                4,
                1,
                64,
            ) as usize)),
            media_slots: Arc::new(Semaphore::new(
                env_i64("FMARCH_MEDIA_MAX_IN_FLIGHT", 2, 1, 32) as usize,
            )),
            media_account_quota_bytes: env_i64(
                "FMARCH_MEDIA_ACCOUNT_QUOTA_BYTES",
                256 * 1024 * 1024,
                12 * 1024 * 1024,
                10 * 1024 * 1024 * 1024,
            ),
            websocket_audience: std::env::var("FMARCH_WS_AUDIENCE")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "fmarch-live".to_string()),
            websocket_ticket_ttl: Duration::from_secs(env_i64(
                "FMARCH_WS_TICKET_TTL_SECONDS",
                30,
                5,
                120,
            ) as u64),
            websocket_ticket_max_per_window: env_i64(
                "FMARCH_WS_TICKET_MAX_PER_WINDOW",
                60,
                2,
                10_000,
            ) as i32,
            websocket_poll_interval: Duration::from_millis(env_i64(
                "FMARCH_WS_POLL_INTERVAL_MS",
                250,
                25,
                5_000,
            ) as u64),
            access_token_verifier: None,
            session_policy: identity::SessionPolicy::from_env(),
            classic_enabled: std::env::var("FMARCH_CLASSIC_AUTH").ok().as_deref() != Some("0"),
            allow_jwt_bearer: std::env::var("FMARCH_ALLOW_JWT_BEARER").ok().as_deref() == Some("1"),
        }
    }

    /// Classic (username + password) sign-in is a first-class method, enabled
    /// by default; a WorkOS-only deployment can switch it off.
    pub fn with_classic_auth(mut self, enabled: bool) -> Self {
        self.classic_enabled = enabled;
        self
    }

    /// Transitional: accept provider JWTs as general request bearers while
    /// clients migrate to the one-time session exchange. Removed once the
    /// frontend exchanges WorkOS tokens for app sessions.
    pub fn with_jwt_bearer_transition(mut self, enabled: bool) -> Self {
        self.allow_jwt_bearer = enabled;
        self
    }

    pub fn with_server_name(mut self, name: impl Into<String>) -> Self {
        self.server_name = name.into();
        self
    }

    pub fn with_dev_auth(mut self, enabled: bool) -> Self {
        self.dev_auth_enabled = enabled;
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
        self.auth_attempt_policy.account_max_failures = account_max_failures.clamp(2, 100);
        self.auth_attempt_policy.source_max_failures = source_max_failures.clamp(2, 10_000);
        self.auth_attempt_policy.window_seconds = window_seconds.clamp(1, 86_400);
        self.auth_attempt_policy.lockout_seconds = lockout_seconds.clamp(1, 86_400);
        self.auth_attempt_policy.retention_seconds = retention_seconds.clamp(
            self.auth_attempt_policy
                .window_seconds
                .max(self.auth_attempt_policy.lockout_seconds),
            31_536_000,
        );
        self
    }

    pub fn with_trusted_auth_attempt_source_header(mut self, trusted: bool) -> Self {
        self.auth_attempt_policy.trust_source_header = trusted;
        self
    }

    pub fn with_identity_delivery_gateway(
        mut self,
        gateway: Arc<dyn IdentityDeliveryGateway>,
    ) -> Self {
        self.identity_delivery_gateway = gateway;
        self
    }

    pub fn with_registration_source_limit(mut self, max_registrations: i32) -> Self {
        self.auth_attempt_policy.registration_max_per_source = max_registrations.clamp(2, 10_000);
        self
    }

    pub fn with_live_projection_capacity(mut self, capacity: usize) -> Self {
        let (live_projection_tx, _) = broadcast::channel(capacity.clamp(1, 65_536));
        self.live_projection_tx = live_projection_tx;
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
        self.password_slots = Arc::new(Semaphore::new(limit.clamp(1, 64)));
        self
    }

    pub fn with_media_limit(mut self, limit: usize) -> Self {
        self.media_slots = Arc::new(Semaphore::new(limit.clamp(1, 32)));
        self
    }

    pub fn with_websocket_audience(mut self, audience: impl Into<String>) -> Self {
        self.websocket_audience = audience.into();
        self
    }

    pub fn with_websocket_ticket_ttl(mut self, ttl: Duration) -> Self {
        self.websocket_ticket_ttl = ttl.clamp(Duration::from_secs(1), Duration::from_secs(120));
        self
    }

    pub fn with_websocket_poll_interval(mut self, interval: Duration) -> Self {
        self.websocket_poll_interval =
            interval.clamp(Duration::from_millis(10), Duration::from_secs(5));
        self
    }

    pub fn with_access_token_verifier(mut self, verifier: Arc<dyn AccessTokenVerifier>) -> Self {
        self.access_token_verifier = Some(verifier);
        self
    }

    pub fn uses_external_identity(&self) -> bool {
        self.access_token_verifier.is_some()
    }
}

pub fn router(pool: PgPool, media_store: MediaStore) -> Router {
    router_with_state(ApiState::new(pool, media_store))
}

pub fn router_with_state(state: ApiState) -> Router {
    let media_upload_limit = state.media_store.limits().max_encoded_bytes();
    // Classic and WorkOS coexist: every route is always mounted, and per-route
    // availability (classic disabled, dev-only, workos unconfigured) is a
    // runtime policy check inside the handler.
    let classic_identity_routes = Router::new()
        .route("/auth/dev-session", post(create_dev_auth_session))
        .route("/auth/session-grants", post(create_auth_session_grant))
        .route("/auth/accounts", post(create_auth_account))
        .route("/auth/accounts/registrations", post(register_auth_account))
        .route("/auth/accounts/login", post(login_auth_account))
        .route(
            "/auth/accounts/password-rotations",
            post(rotate_auth_account_password),
        )
        .route(
            "/auth/accounts/recovery-credentials",
            post(issue_auth_account_recovery_credential),
        )
        .route(
            "/auth/accounts/recovery-requests",
            post(request_auth_account_recovery),
        )
        .route(
            "/auth/accounts/recovery-credential-revocations",
            post(revoke_auth_account_recovery_credential),
        )
        .route("/auth/accounts/recoveries", post(recover_auth_account))
        .route("/auth/accounts/disable", post(disable_auth_account))
        .route("/auth/accounts/enable", post(enable_auth_account))
        .route("/auth/session-rotations", post(rotate_auth_session))
        .route("/auth/session-logout", post(logout_auth_session))
        .route("/auth/session-revocations", post(revoke_auth_session))
        .route("/auth/invites", post(create_auth_invite))
        .route("/auth/invites/redeem", post(redeem_auth_invite))
        .route("/auth/invite-revocations", post(revoke_auth_invite))
        .route("/admin/auth-deliveries", get(admin_auth_delivery_queue))
        .route(
            "/auth/delivery-intents/{delivery_id}/retry",
            post(retry_auth_delivery_intent),
        );
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/auth/session", get(auth_session))
        .route("/auth/sessions", post(create_auth_session))
        .route("/auth/account/methods", get(list_account_methods))
        .route("/auth/account/methods/classic", post(add_classic_method))
        .route("/auth/account/methods/workos", post(add_workos_method))
        .route(
            "/auth/account/methods/{method_id}/disable",
            post(disable_account_method),
        )
        .route("/auth/websocket-tickets", post(create_websocket_ticket))
        .route(
            "/media/uploads",
            post(media_upload).layer(DefaultBodyLimit::max(media_upload_limit)),
        )
        .route(
            "/media/thread/{game}/{channel}/{source_seq}/{content_id}/{asset}",
            get(media_thread_variant),
        )
        .route(
            "/auth/identity-lifecycle-audit",
            get(identity_lifecycle_audit),
        )
        .route("/commands", post(command))
        .route("/admin/games", get(admin_game_index))
        .route("/admin/game-bootstrap", get(admin_game_bootstrap))
        .route("/games", get(game_index))
        .route("/games/{game}", get(public_game_thread))
        .route("/games/import", post(import_completed_game_export))
        .route("/search", get(public_search))
        .route("/inbox", get(community_inbox))
        .route(
            "/subscriptions/{target_kind}/{scope_id}",
            get(subscription_target_state)
                .put(subscribe_to_target)
                .delete(unsubscribe_from_target),
        )
        .route(
            "/subscriptions/{target_kind}/{scope_id}/read",
            post(advance_subscription_read),
        )
        .route("/moderation/reports", post(submit_moderation_report))
        .route(
            "/moderation/reports/{report}",
            get(moderation_report_receipt),
        )
        .route("/moderation/cases", get(moderation_cases))
        .route("/moderation/cases/{case}", get(moderation_case))
        .route("/moderation/cases/{case}/actions", post(moderate_case))
        .route(
            "/discussions/areas",
            get(discussion_areas).post(create_discussion_area),
        )
        .route("/discussions/areas/{slug}", get(discussion_area_topics))
        .route(
            "/discussions/areas/{slug}/topics",
            post(create_discussion_topic),
        )
        .route(
            "/discussions/areas/{slug}/topics/{topic}",
            get(discussion_topic_thread),
        )
        .route(
            "/discussions/topics/{topic}/posts",
            post(create_discussion_post),
        )
        .route(
            "/discussions/topics/{topic}/moderation",
            post(moderate_discussion_topic),
        )
        .route("/profiles", post(create_profile))
        .route("/profiles/me/editor", get(current_profile_editor))
        .route("/profiles/{handle}/editor", get(profile_editor))
        .route(
            "/profiles/{handle}",
            get(public_profile).put(update_profile),
        )
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
    let app = app.merge(classic_identity_routes);
    app.with_state(state)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Health {
    pub ok: bool,
}

async fn healthz() -> Json<Health> {
    Json(Health { ok: true })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaUploadResponse {
    pub content_id: String,
    pub intrinsic_width: u32,
    pub intrinsic_height: u32,
    pub variant_recipe_revision: String,
    pub variants: Vec<MediaUploadVariant>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaUploadVariant {
    pub format: String,
    pub kind: String,
    pub mime_type: String,
    pub width: u32,
    pub height: u32,
    pub encoded_len: u64,
    pub blake3: String,
    pub has_alpha: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeclaredUploadFormat {
    Png,
    Jpeg,
}

enum MediaUploadFailure {
    Prepare(MediaError),
    Commit(MediaError),
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

async fn media_upload(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let principal_user_id = require_active_enabled_account(&state, token).await?;
    let _media_permit = acquire_workload_slot(
        &state.media_slots,
        "media processing capacity is exhausted; retry shortly",
    )?;
    let declared_format = declared_upload_format(&headers)?;
    if sniff_upload_format(&body) != Some(declared_format) {
        return Err(media_request_reject(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "declared media type does not match PNG/JPEG bytes",
        ));
    }

    let store = state.media_store.clone();
    let variant_limits = state.variant_limits;
    let encoded = body.to_vec();
    let upload_id =
        reserve_media_quota(&state, principal_user_id.as_str(), encoded.len() as i64).await?;
    let committed = tokio::task::spawn_blocking(move || {
        let prepared = store
            .prepare_upload(&encoded, variant_limits)
            .map_err(MediaUploadFailure::Prepare)?;
        store
            .commit_prepared_upload(prepared)
            .map_err(MediaUploadFailure::Commit)
    })
    .await;
    let committed = match committed {
        Ok(Ok(committed)) => committed,
        Err(error) => {
            tracing::error!(error = %error, "media upload worker failed");
            release_media_quota(&state.pool, upload_id).await;
            return Err(media_internal_error(
                "media upload worker failed".to_string(),
            ));
        }
        Ok(Err(MediaUploadFailure::Prepare(error))) => {
            release_media_quota(&state.pool, upload_id).await;
            return Err(media_api_error(error));
        }
        Ok(Err(MediaUploadFailure::Commit(error))) => {
            tracing::error!(error = %error, "media upload commit failed");
            release_media_quota(&state.pool, upload_id).await;
            return Err(media_internal_error(
                "media upload commit failed".to_string(),
            ));
        }
    };
    let ingest = committed.ingest();
    let variants = committed.variants();
    sqlx::query("UPDATE media_upload_ledger SET content_id = $2 WHERE upload_id = $1")
        .bind(upload_id)
        .bind(ingest.handle().id().to_string())
        .execute(&state.pool)
        .await?;

    let response = MediaUploadResponse {
        content_id: ingest.handle().id().to_string(),
        intrinsic_width: ingest.handle().width(),
        intrinsic_height: ingest.handle().height(),
        variant_recipe_revision: VARIANT_RECIPE_REVISION.to_string(),
        variants: variants
            .set()
            .variants()
            .iter()
            .map(|record| MediaUploadVariant {
                format: record.key().format().to_string(),
                kind: record.key().kind().to_string(),
                mime_type: record.mime_type().to_string(),
                width: record.width(),
                height: record.height(),
                encoded_len: record.encoded_len(),
                blake3: record.blake3().to_string(),
                has_alpha: record.has_alpha(),
            })
            .collect(),
    };
    let status = if ingest.status() == IngestStatus::Stored
        || variants.status() == VariantGenerationStatus::Stored
    {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(response)))
}

#[derive(Debug, Clone)]
struct AuthenticatedIdentity {
    principal_user_id: String,
    global_capabilities: Vec<String>,
    auth_kind: &'static str,
    session_reference: String,
    created_at: Option<i64>,
    authenticated_at: Option<i64>,
    expires_at: i64,
    idle_expires_at: Option<i64>,
}

fn session_auth_kind(session: &identity::session::SessionIdentity) -> &'static str {
    match session.method {
        Some((_, identity::MethodKind::ClassicPassword)) => "classic",
        Some((_, identity::MethodKind::Workos)) => "workos",
        None => "dev",
    }
}

async fn authenticate_token(
    state: &ApiState,
    token: &str,
) -> Result<AuthenticatedIdentity, ApiError> {
    if identity::token::is_app_session_token(token) {
        let session = identity::session::validate_session(
            &state.pool,
            token,
            &state.session_policy,
            unix_now_seconds(),
        )
        .await?;
        let auth_kind = session_auth_kind(&session);
        return Ok(AuthenticatedIdentity {
            auth_kind,
            principal_user_id: session.principal_user_id,
            global_capabilities: session.global_capabilities,
            session_reference: session.token_hash,
            created_at: Some(session.created_at),
            authenticated_at: Some(session.authenticated_at),
            expires_at: session.expires_at,
            idle_expires_at: session.idle_expires_at,
        });
    }
    if state.allow_jwt_bearer {
        if let Some(verifier) = state.access_token_verifier.as_ref() {
            let verified = verifier.verify(token).await.map_err(identity_api_error)?;
            return resolve_workos_principal(state, verified).await;
        }
    }
    authenticate_legacy_token(state, token).await
}

/// Transitional: a provider JWT presented as a general request bearer. The
/// go-forward path exchanges it once at POST /auth/sessions instead.
async fn resolve_workos_principal(
    state: &ApiState,
    verified: VerifiedIdentity,
) -> Result<AuthenticatedIdentity, ApiError> {
    let now = unix_now_seconds();
    let mut tx = state.pool.begin().await?;
    let resolution = identity::workos::resolve_subject(&mut tx, &verified, now)
        .await
        .map_err(|error| match error {
            identity::IdentityFlowError::Unauthorized => unauthorized_account(),
            other => ApiError::from(other),
        })?;
    tx.commit().await?;
    Ok(AuthenticatedIdentity {
        principal_user_id: resolution.principal_user_id,
        global_capabilities: resolution.global_capabilities,
        auth_kind: "workos",
        session_reference: verified.session_id,
        created_at: None,
        authenticated_at: None,
        expires_at: verified.expires_at,
        idle_expires_at: None,
    })
}

async fn authenticate_legacy_token(
    state: &ApiState,
    token: &str,
) -> Result<AuthenticatedIdentity, ApiError> {
    let token_hash = hash_session_token(token);
    let now = unix_now_seconds();
    let session = if state.dev_auth_enabled {
        sqlx::query_as::<_, (String, Vec<String>, i64, i64, i64)>(
            r#"
            SELECT session.principal_user_id, session.global_capabilities, session.expires_at,
                   session.created_at, session.authenticated_at
            FROM auth_session AS session
            WHERE session.token_hash = $1
              AND session.revoked_at IS NULL
              AND session.expires_at > $2
              AND (
                  NOT EXISTS (
                      SELECT 1 FROM auth_account AS account
                      WHERE account.principal_user_id = session.principal_user_id
                  )
                  OR EXISTS (
                      SELECT 1 FROM auth_account AS account
                      WHERE account.principal_user_id = session.principal_user_id
                        AND account.disabled_at IS NULL
                  )
              )
            "#,
        )
        .bind(token_hash.as_str())
        .bind(now)
        .fetch_optional(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, (String, Vec<String>, i64, i64, i64)>(
            r#"
            SELECT session.principal_user_id, session.global_capabilities, session.expires_at,
                   session.created_at, session.authenticated_at
            FROM auth_session AS session
            WHERE session.token_hash = $1
              AND session.revoked_at IS NULL
              AND session.expires_at > $2
              AND EXISTS (
                  SELECT 1 FROM auth_account AS account
                  WHERE account.principal_user_id = session.principal_user_id
                    AND account.disabled_at IS NULL
              )
            "#,
        )
        .bind(token_hash.as_str())
        .bind(now)
        .fetch_optional(&state.pool)
        .await?
    }
    .ok_or_else(unauthorized_account)?;
    Ok(AuthenticatedIdentity {
        principal_user_id: session.0,
        global_capabilities: session.1,
        auth_kind: "legacy-dev",
        session_reference: token_hash,
        created_at: Some(session.3),
        authenticated_at: Some(session.4),
        expires_at: session.2,
        idle_expires_at: None,
    })
}

fn identity_api_error(error: IdentityError) -> ApiError {
    match error {
        IdentityError::ProviderUnavailable(message) => {
            tracing::warn!(error = %message, "WorkOS token verification dependency unavailable");
            ApiError::Reject {
                status: StatusCode::SERVICE_UNAVAILABLE,
                error: RejectCode::Internal,
                message: "identity verification is temporarily unavailable".to_string(),
            }
        }
        _ => unauthorized_session(),
    }
}

async fn require_active_enabled_account(state: &ApiState, token: &str) -> Result<String, ApiError> {
    let identity = authenticate_token(state, token).await?;
    if matches!(identity.auth_kind, "classic" | "dev" | "legacy-dev") {
        let enabled = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM auth_account WHERE principal_user_id = $1 AND disabled_at IS NULL)",
        )
        .bind(identity.principal_user_id.as_str())
        .fetch_one(&state.pool)
        .await?;
        if !enabled {
            return Err(unauthorized_account());
        }
    }
    Ok(identity.principal_user_id)
}

async fn reserve_media_quota(
    state: &ApiState,
    principal_user_id: &str,
    encoded_bytes: i64,
) -> Result<Uuid, ApiError> {
    let upload_id = Uuid::new_v4();
    let now = unix_now_seconds();
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("media-quota:{principal_user_id}"))
        .execute(&mut *tx)
        .await?;
    let used = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(encoded_bytes), 0)::BIGINT FROM media_upload_ledger WHERE principal_user_id = $1",
    )
    .bind(principal_user_id)
    .fetch_one(&mut *tx)
    .await?;
    if used.saturating_add(encoded_bytes) > state.media_account_quota_bytes {
        return Err(ApiError::Reject {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            error: RejectCode::NotAuthorized,
            message: "account media storage quota is exhausted".to_string(),
        });
    }
    sqlx::query(
        "INSERT INTO media_upload_ledger (upload_id, principal_user_id, encoded_bytes, content_id, created_at) VALUES ($1, $2, $3, NULL, $4)",
    )
    .bind(upload_id)
    .bind(principal_user_id)
    .bind(encoded_bytes)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(upload_id)
}

async fn release_media_quota(pool: &PgPool, upload_id: Uuid) {
    if let Err(error) = sqlx::query("DELETE FROM media_upload_ledger WHERE upload_id = $1")
        .bind(upload_id)
        .execute(pool)
        .await
    {
        tracing::error!(%error, %upload_id, "failed to release media quota reservation");
    }
}

fn declared_upload_format(headers: &HeaderMap) -> Result<DeclaredUploadFormat, ApiError> {
    let media_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim);
    match media_type {
        Some(value) if value.eq_ignore_ascii_case("image/png") => Ok(DeclaredUploadFormat::Png),
        Some(value) if value.eq_ignore_ascii_case("image/jpeg") => Ok(DeclaredUploadFormat::Jpeg),
        _ => Err(media_request_reject(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "content-type must be image/png or image/jpeg",
        )),
    }
}

fn sniff_upload_format(bytes: &[u8]) -> Option<DeclaredUploadFormat> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(DeclaredUploadFormat::Png)
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(DeclaredUploadFormat::Jpeg)
    } else {
        None
    }
}

fn media_api_error(error: MediaError) -> ApiError {
    match error {
        MediaError::EncodedInputTooLarge { .. } => media_request_reject(
            StatusCode::PAYLOAD_TOO_LARGE,
            "encoded media exceeds the upload limit",
        ),
        MediaError::UnsupportedFormat => media_request_reject(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "only PNG and JPEG uploads are supported",
        ),
        MediaError::MalformedImage(_)
        | MediaError::DimensionsExceeded { .. }
        | MediaError::PixelCountExceeded { .. }
        | MediaError::DecodedBytesExceeded { .. }
        | MediaError::DecoderResourceLimit(_)
        | MediaError::VariantDimensionsExceeded { .. }
        | MediaError::VariantPixelCountExceeded { .. }
        | MediaError::VariantEncodedBytesExceeded { .. }
        | MediaError::VariantAggregateBytesExceeded { .. } => media_request_reject(
            StatusCode::UNPROCESSABLE_ENTITY,
            "media cannot be processed within configured limits",
        ),
        other => {
            tracing::error!(error = %other, "media upload preparation failed");
            media_internal_error("media upload preparation failed".to_string())
        }
    }
}

fn media_request_reject(status: StatusCode, message: impl Into<String>) -> ApiError {
    ApiError::Reject {
        status,
        error: RejectCode::Internal,
        message: message.into(),
    }
}

fn media_internal_error(message: String) -> ApiError {
    ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ThreadMediaAsset {
    kind: VariantKind,
    format: VariantFormat,
}

async fn media_thread_variant(
    State(state): State<ApiState>,
    Path((game, channel, source_seq, content_id, asset)): Path<(Uuid, String, i64, String, String)>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let principal_user_id = require_active_enabled_account(&state, token).await?;
    if channel != "main" {
        require_channel_thread_access(
            &state,
            game,
            channel.as_str(),
            Some(principal_user_id.as_str()),
        )
        .await?;
    }

    let id = content_id
        .parse::<ContentId>()
        .map_err(|_| media_not_found("media reference unavailable"))?;
    let asset = parse_thread_media_asset(asset.as_str())
        .ok_or_else(|| media_not_found("media variant unavailable"))?;
    let projected_media = sqlx::query_scalar::<_, serde_json::Value>(
        r#"
        SELECT media
        FROM thread_view
        WHERE game_id = $1
          AND channel_id = $2
          AND source_seq = $3
        "#,
    )
    .bind(game)
    .bind(channel.as_str())
    .bind(source_seq)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| media_not_found("media reference unavailable"))?;
    if !projected_media_references_variant(&projected_media, id, asset.kind) {
        return Err(media_not_found(
            "media variant is not referenced by this post",
        ));
    }

    let store = state.media_store.clone();
    let limits = state.variant_limits;
    let stored = tokio::task::spawn_blocking(move || {
        store.lookup_variant(id, asset.format, asset.kind, limits)
    })
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "thread media lookup worker failed");
        media_internal_error("thread media lookup failed".to_string())
    })?
    .map_err(|error| {
        tracing::error!(error = %error, "thread media lookup failed");
        media_internal_error("thread media lookup failed".to_string())
    })?
    .ok_or_else(|| media_not_found("media variant unavailable"))?;

    let record = stored.record();
    let etag = format!("\"{}\"", record.blake3());
    let reference = format!("{game}/{channel}/{source_seq}/{id}");
    let not_modified = if_none_match_matches(&headers, etag.as_str());
    let mut response = if not_modified {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        (
            StatusCode::OK,
            Bytes::copy_from_slice(stored.encoded_bytes()),
        )
            .into_response()
    };
    let response_headers = response.headers_mut();
    response_headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static(asset.format.mime_type()),
    );
    response_headers.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-cache"));
    if !not_modified {
        response_headers.insert(
            CONTENT_LENGTH,
            header_value(record.encoded_len().to_string(), "media content length")?,
        );
    }
    response_headers.insert(ETAG, header_value(etag, "media etag")?);
    response_headers.insert(
        "x-fmarch-media-content-address",
        header_value(id.to_string(), "media content address")?,
    );
    response_headers.insert(
        "x-fmarch-media-channel",
        header_value(channel, "media channel")?,
    );
    response_headers.insert(
        "x-fmarch-media-post-seq",
        header_value(source_seq.to_string(), "media post sequence")?,
    );
    response_headers.insert(
        "x-fmarch-media-reference",
        header_value(reference, "media reference")?,
    );
    response_headers.insert(
        "x-fmarch-media-variant",
        HeaderValue::from_static(match asset.kind {
            VariantKind::Thumb => "thumb",
            VariantKind::Tablet => "tablet",
            VariantKind::FullBounded => "full-bounded",
        }),
    );
    response_headers.insert(
        "x-fmarch-media-format",
        HeaderValue::from_static(match asset.format {
            VariantFormat::Avif => "avif",
            VariantFormat::Webp => "webp",
        }),
    );
    Ok(response)
}

fn if_none_match_matches(headers: &HeaderMap, etag: &str) -> bool {
    let Some(value) = headers
        .get(IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    value.split(',').any(|candidate| {
        let candidate = candidate.trim();
        candidate == "*" || candidate.strip_prefix("W/").unwrap_or(candidate) == etag
    })
}

fn parse_thread_media_asset(value: &str) -> Option<ThreadMediaAsset> {
    let (kind, format) = value.rsplit_once('.')?;
    let kind = match kind {
        "thumb" => VariantKind::Thumb,
        "tablet" => VariantKind::Tablet,
        "full-bounded" => VariantKind::FullBounded,
        _ => return None,
    };
    let format = match format {
        "avif" => VariantFormat::Avif,
        "webp" => VariantFormat::Webp,
        _ => return None,
    };
    Some(ThreadMediaAsset { kind, format })
}

fn projected_media_references_variant(
    value: &serde_json::Value,
    id: ContentId,
    kind: VariantKind,
) -> bool {
    let Some(items) = value.as_array() else {
        return false;
    };
    let kind = match kind {
        VariantKind::Thumb => "thumb",
        VariantKind::Tablet => "tablet",
        VariantKind::FullBounded => "full-bounded",
    };
    let id = id.to_string();
    items.iter().any(|item| {
        item.get("content_id").and_then(serde_json::Value::as_str) == Some(id.as_str())
            && item
                .get("variants")
                .and_then(|variants| variants.get(kind))
                .is_some_and(serde_json::Value::is_object)
    })
}

fn header_value(value: impl AsRef<str>, label: &'static str) -> Result<HeaderValue, ApiError> {
    HeaderValue::from_str(value.as_ref()).map_err(|error| {
        tracing::error!(error = %error, label, "invalid media response header");
        media_internal_error("thread media response metadata is invalid".to_string())
    })
}

fn media_not_found(message: impl Into<String>) -> ApiError {
    ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::Internal,
        message: message.into(),
    }
}

#[derive(Debug, Clone, Deserialize)]
struct AuthSessionQuery {
    game: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthSessionResponse {
    principal_user_id: String,
    capabilities: Vec<CapabilityGrant>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    created_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    idle_expires_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rotation_required: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateDevAuthSession {
    token: Option<String>,
    principal_user_id: String,
    expires_at: i64,
    #[serde(default)]
    global_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateAuthSessionGrant {
    token: Option<String>,
    principal_user_id: String,
    expires_at: i64,
    #[serde(default)]
    global_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateAuthAccount {
    account_id: String,
    password: String,
    principal_user_id: String,
    #[serde(default)]
    global_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthAccountResponse {
    account_id: String,
    principal_user_id: String,
    global_capabilities: Vec<String>,
}

pub async fn bootstrap_workos_global_admin(
    pool: &PgPool,
    workos_user_id: &str,
    display_label: Option<&str>,
) -> Result<bool, String> {
    let workos_user_id = workos_user_id.trim();
    if workos_user_id.is_empty() {
        return Err("bootstrap WorkOS user id must not be empty".to_string());
    }
    let now = unix_now_seconds();
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(0x6d66_6172_6368_0007_i64)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    let admin_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM platform_principal WHERE status = 'active' AND global_capabilities @> ARRAY['GlobalAdmin']::TEXT[])",
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| error.to_string())?;
    if admin_exists {
        tx.commit().await.map_err(|error| error.to_string())?;
        return Ok(false);
    }
    let existing = sqlx::query_as::<_, (String, bool)>(
        r#"
        SELECT identity.principal_user_id,
               principal.global_capabilities @> ARRAY['GlobalAdmin']::TEXT[]
        FROM external_identity AS identity
        JOIN platform_principal AS principal
          ON principal.principal_user_id = identity.principal_user_id
        WHERE identity.provider = 'workos' AND identity.subject = $1
        "#,
    )
    .bind(workos_user_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| error.to_string())?;
    let (principal_user_id, already_admin) = match existing {
        Some(existing) => existing,
        None => {
            let principal_user_id = format!("principal-{}", Uuid::new_v4());
            sqlx::query(
                "INSERT INTO platform_principal (principal_user_id, status, global_capabilities, created_at, disabled_at) VALUES ($1, 'active', '{}'::TEXT[], $2, NULL)",
            )
            .bind(principal_user_id.as_str())
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
            sqlx::query(
                "INSERT INTO external_identity (provider, subject, principal_user_id, display_label, created_at, last_seen_at) VALUES ('workos', $1, $2, $3, $4, $4)",
            )
            .bind(workos_user_id)
            .bind(principal_user_id.as_str())
            .bind(display_label.map(str::trim).filter(|label| !label.is_empty()))
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
            (principal_user_id, false)
        }
    };
    if already_admin {
        tx.commit().await.map_err(|error| error.to_string())?;
        return Ok(false);
    }
    sqlx::query(
        "UPDATE platform_principal SET global_capabilities = array_append(global_capabilities, 'GlobalAdmin') WHERE principal_user_id = $1",
    )
    .bind(principal_user_id.as_str())
    .execute(&mut *tx)
    .await
    .map_err(|error| error.to_string())?;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at, event_kind, actor_user_id, principal_user_id,
            token_hash, related_token_hash, metadata
        )
        VALUES ($1, 'workos_admin_bootstrapped', NULL, $2, NULL, NULL, $3::JSONB)
        "#,
    )
    .bind(now)
    .bind(principal_user_id)
    .bind(serde_json::json!({ "provider": "workos", "subject": workos_user_id }).to_string())
    .execute(&mut *tx)
    .await
    .map_err(|error| error.to_string())?;
    tx.commit().await.map_err(|error| error.to_string())?;
    Ok(true)
}

/// Provider-neutral first-admin bootstrap for the classic method: create (or
/// find) the account, attach it to a principal with a classic authentication
/// method, and grant GlobalAdmin. No-ops when any active GlobalAdmin exists.
pub async fn bootstrap_classic_global_admin(
    pool: &PgPool,
    login_name: &str,
    password: &str,
) -> Result<bool, String> {
    let login_name = login_name.trim();
    if login_name.is_empty() {
        return Err("bootstrap admin login name must not be empty".to_string());
    }
    if password.trim().is_empty() {
        return Err("bootstrap admin password must not be empty".to_string());
    }
    let password_hash =
        identity::password::hash_password_sync(password).map_err(|error| error.to_string())?;
    let now = unix_now_seconds();
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(0x6d66_6172_6368_0007_i64)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    let admin_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM platform_principal WHERE status = 'active' AND global_capabilities @> ARRAY['GlobalAdmin']::TEXT[])",
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| error.to_string())?;
    if admin_exists {
        tx.commit().await.map_err(|error| error.to_string())?;
        return Ok(false);
    }
    let existing = sqlx::query_scalar::<_, String>(
        "SELECT principal_user_id FROM auth_account WHERE account_id = $1 AND disabled_at IS NULL",
    )
    .bind(login_name)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| error.to_string())?;
    let principal_user_id = match existing {
        Some(principal_user_id) => principal_user_id,
        None => {
            let principal_user_id = format!("principal-{}", Uuid::new_v4());
            sqlx::query(
                r#"
                INSERT INTO auth_account (
                    account_id, principal_user_id, password_hash, created_at, disabled_at,
                    global_capabilities
                )
                VALUES ($1, $2, $3, $4, NULL, ARRAY['GlobalAdmin'])
                "#,
            )
            .bind(login_name)
            .bind(principal_user_id.as_str())
            .bind(&password_hash)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
            principal_user_id
        }
    };
    identity::methods::link_classic_method(
        &mut *tx,
        login_name,
        principal_user_id.as_str(),
        &["GlobalAdmin".to_string()],
        now,
    )
    .await
    .map_err(|error| error.to_string())?;
    sqlx::query(
        r#"
        UPDATE platform_principal
        SET global_capabilities = array_append(global_capabilities, 'GlobalAdmin')
        WHERE principal_user_id = $1
          AND NOT (global_capabilities @> ARRAY['GlobalAdmin']::TEXT[])
        "#,
    )
    .bind(principal_user_id.as_str())
    .execute(&mut *tx)
    .await
    .map_err(|error| error.to_string())?;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at, event_kind, actor_user_id, principal_user_id,
            token_hash, related_token_hash, metadata
        )
        VALUES ($1, 'admin_bootstrapped', NULL, $2, NULL, NULL, $3::JSONB)
        "#,
    )
    .bind(now)
    .bind(principal_user_id.as_str())
    .bind(
        serde_json::json!({ "method_kind": "classic_password", "account_id": login_name })
            .to_string(),
    )
    .execute(&mut *tx)
    .await
    .map_err(|error| error.to_string())?;
    tx.commit().await.map_err(|error| error.to_string())?;
    Ok(true)
}

#[derive(Debug, Clone, Deserialize)]
struct RegisterAuthAccount {
    account_id: String,
    password: String,
    session_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthAccountRegistrationResponse {
    account_id: String,
    principal_user_id: String,
    session_token: String,
    expires_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct LoginAuthAccount {
    account_id: String,
    password: String,
    session_token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RotateAuthAccountPassword {
    account_id: String,
    current_password: String,
    new_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthAccountPasswordRotationResponse {
    status: String,
    account_id: String,
    principal_user_id: String,
    revoked_session_count: i64,
    password_algorithm: String,
}

#[derive(Debug, Clone, Deserialize)]
struct IssueAuthAccountRecoveryCredential {
    account_id: String,
    current_password: String,
    expires_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct RequestAuthAccountRecovery {
    account_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthAccountRecoveryRequestResponse {
    status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthAccountRecoveryCredentialResponse {
    status: String,
    recovery_id: Uuid,
    recovery_token: String,
    account_id: String,
    principal_user_id: String,
    expires_at: i64,
    delivery_id: Uuid,
    delivery_status: String,
    delivery_attempt_count: i32,
    delivery_provider_id: String,
    delivery_outcome_kind: String,
    delivery_outcome_code: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RevokeAuthAccountRecoveryCredential {
    account_id: String,
    current_password: String,
    recovery_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthAccountRecoveryCredentialLifecycleResponse {
    status: String,
    recovery_id: Uuid,
    account_id: String,
    principal_user_id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct RecoverAuthAccount {
    account_id: String,
    recovery_token: String,
    new_password: String,
    session_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthAccountRecoveryResponse {
    status: String,
    recovery_id: Uuid,
    account_id: String,
    principal_user_id: String,
    revoked_session_count: i64,
    password_algorithm: String,
    session_token: String,
    session_expires_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct DisableAuthAccount {
    account_id: String,
    expected_disabled: Option<bool>,
    #[serde(default = "default_revoke_account_sessions")]
    revoke_sessions: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct EnableAuthAccount {
    account_id: String,
    expected_disabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthAccountLifecycleResponse {
    status: String,
    account_id: String,
    principal_user_id: String,
    disabled_at: Option<i64>,
    revoked_session_count: i64,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct RotateAuthSession {
    session_token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RevokeAuthSession {
    token: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateAuthInvite {
    invite_token: String,
    account_id: String,
    expected_principal_user_id: String,
    expires_at: i64,
    game: Option<Uuid>,
    #[serde(default)]
    global_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthInviteResponse {
    account_id: String,
    principal_user_id: String,
    expires_at: i64,
    game: Option<Uuid>,
    global_capabilities: Vec<String>,
    invited_by_user_id: String,
    delivery_id: Uuid,
    delivery_status: String,
    delivery_attempt_count: i32,
    delivery_provider_id: String,
    delivery_outcome_kind: String,
    delivery_outcome_code: Option<String>,
}

#[derive(Debug, Clone)]
struct AuthDeliveryReceipt {
    delivery_id: Uuid,
    status: String,
    attempt_count: i32,
    provider_id: String,
    outcome_kind: String,
    outcome_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthDeliveryRetryResponse {
    status: String,
    delivery_id: Uuid,
    delivery_kind: String,
    attempt_count: i32,
    delivery_provider_id: String,
    delivery_outcome_kind: String,
    delivery_outcome_code: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct AuthDeliveryQueueQuery {
    limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
struct AuthDeliveryQueueEntry {
    delivery_id: Uuid,
    delivery_kind: String,
    account_id: String,
    principal_user_id: String,
    status: String,
    attempt_count: i32,
    provider_id: String,
    outcome_kind: String,
    outcome_code: Option<String>,
    next_attempt_at: Option<i64>,
    credential_expires_at: i64,
    created_at: i64,
    updated_at: i64,
    retry_eligible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthDeliveryQueueResponse {
    deliveries: Vec<AuthDeliveryQueueEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct RedeemAuthInvite {
    invite_token: String,
    account_id: String,
    password: String,
    session_token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RevokeAuthInvite {
    invite_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthLifecycleResponse {
    status: String,
    principal_user_id: String,
}

#[derive(Debug, Clone, Deserialize)]
struct IdentityLifecycleAuditQuery {
    principal_user_id: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IdentityLifecycleAuditEntry {
    id: i64,
    event_at: i64,
    event_kind: String,
    actor_user_id: Option<String>,
    principal_user_id: String,
    metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IdentityLifecycleAuditResponse {
    entries: Vec<IdentityLifecycleAuditEntry>,
}

async fn auth_session(
    State(state): State<ApiState>,
    Query(query): Query<AuthSessionQuery>,
    headers: HeaderMap,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let now = unix_now_seconds();
    let identity = authenticate_token(&state, token).await?;
    let mut response = auth_session_response(
        &state,
        identity.principal_user_id,
        query.game,
        identity.global_capabilities,
    )
    .await?;
    response.expires_at = Some(identity.expires_at);
    response.idle_expires_at = identity.idle_expires_at;
    if let Some(created_at) = identity.created_at {
        response.created_at = Some(created_at);
        response.rotation_required =
            Some(now.saturating_sub(created_at) >= auth_session_rotation_max_age_seconds());
    }
    Ok(Json(response))
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

    if request.principal_user_id.trim().is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "dev auth session requires principal_user_id".to_string(),
        });
    }
    let global_capabilities = normalize_dev_global_capabilities(&request.global_capabilities)?;

    let now = unix_now_seconds();
    let mut conn = state.pool.acquire().await?;
    let spec = identity::SessionSpec {
        principal_user_id: request.principal_user_id.as_str(),
        session_capabilities: &global_capabilities,
        authenticated_via_method_id: None,
        assurance: identity::Assurance::Dev,
        authenticated_at: now,
        expires_at: request.expires_at,
        idle_expires_at: None,
    };
    let issued =
        issue_session_for_request(&state, &mut conn, spec, now, request.token.as_deref()).await?;
    drop(conn);

    let mut response =
        auth_session_response(&state, request.principal_user_id, None, global_capabilities).await?;
    response.session_token = Some(issued.session_token);
    response.expires_at = Some(issued.expires_at);
    Ok(Json(response))
}

async fn issue_session_for_request(
    state: &ApiState,
    conn: &mut sqlx::PgConnection,
    spec: identity::SessionSpec<'_>,
    now: i64,
    requested_debug_token: Option<&str>,
) -> Result<identity::IssuedSession, ApiError> {
    let requested_debug_token = requested_debug_token
        .map(str::trim)
        .filter(|token| !token.is_empty());
    if state.dev_auth_enabled && cfg!(debug_assertions) {
        if let Some(token) = requested_debug_token {
            return Ok(identity::session::issue_debug_session(conn, spec, now, token).await?);
        }
    }
    Ok(identity::session::issue_session(conn, spec, now).await?)
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

    if request.principal_user_id.trim().is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "session grant requires principal_user_id".to_string(),
        });
    }
    let global_capabilities = normalize_global_capabilities(&request.global_capabilities)?;

    let now = unix_now_seconds();
    let mut conn = state.pool.acquire().await?;
    let expires_at = request
        .expires_at
        .min(state.session_policy.classic_expiry(now));
    let issued = issue_session_for_request(
        &state,
        &mut conn,
        identity::SessionSpec {
            principal_user_id: request.principal_user_id.as_str(),
            session_capabilities: &global_capabilities,
            authenticated_via_method_id: None,
            assurance: identity::Assurance::AdminGrant,
            authenticated_at: now,
            expires_at,
            idle_expires_at: None,
        },
        now,
        request.token.as_deref(),
    )
    .await?;
    drop(conn);

    let mut response =
        auth_session_response(&state, request.principal_user_id, None, global_capabilities).await?;
    response.session_token = Some(issued.session_token);
    response.expires_at = Some(issued.expires_at);
    Ok(Json(response))
}

async fn create_auth_account(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<CreateAuthAccount>,
) -> Result<Json<AuthAccountResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let actor_user_id = require_global_admin(&state, caller_token, "account creation").await?;

    let account_id = request.account_id.trim();
    let password = request.password.as_str();
    let principal_user_id = request.principal_user_id.trim();
    if account_id.is_empty() || password.trim().is_empty() || principal_user_id.is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "account creation requires account_id, password, and principal_user_id"
                .to_string(),
        });
    }
    validate_new_account_password(password)?;
    let global_capabilities = normalize_global_capabilities(&request.global_capabilities)?;
    let _password_permit = acquire_workload_slot(
        &state.password_slots,
        "password processing capacity is exhausted; retry shortly",
    )?;
    let now = unix_now_seconds();
    let password_hash = hash_account_password(password).await?;
    let mut tx = state.pool.begin().await?;
    let inserted = sqlx::query(
        r#"
        INSERT INTO auth_account (
            account_id,
            principal_user_id,
            password_hash,
            created_at,
            disabled_at,
            global_capabilities
        )
        VALUES ($1, $2, $3, $4, NULL, $5)
        ON CONFLICT (account_id) DO NOTHING
        "#,
    )
    .bind(account_id)
    .bind(principal_user_id)
    .bind(&password_hash)
    .bind(now)
    .bind(&global_capabilities)
    .execute(&mut *tx)
    .await?;

    if inserted.rows_affected() != 1 {
        return Err(ApiError::Reject {
            status: StatusCode::CONFLICT,
            error: RejectCode::Internal,
            message: "account already exists".to_string(),
        });
    }

    identity::methods::link_classic_method(
        &mut *tx,
        account_id,
        principal_user_id,
        &global_capabilities,
        now,
    )
    .await?;

    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'account_created', $2, $3, NULL, NULL, $4::JSONB)
        "#,
    )
    .bind(now)
    .bind(actor_user_id.as_str())
    .bind(principal_user_id)
    .bind(
        serde_json::json!({
            "account_id": account_id,
            "global_capability_count": global_capabilities.len()
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(AuthAccountResponse {
        account_id: account_id.to_string(),
        principal_user_id: principal_user_id.to_string(),
        global_capabilities,
    }))
}

async fn register_auth_account(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RegisterAuthAccount>,
) -> Result<Json<AuthAccountRegistrationResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let account_id = normalize_registration_account_id(request.account_id.as_str())?;
    let password = request.password.as_str();
    validate_new_account_password(password)?;
    enforce_registration_source_limit(&state, &headers).await?;
    let _password_permit = acquire_workload_slot(
        &state.password_slots,
        "password processing capacity is exhausted; retry shortly",
    )?;

    let now = unix_now_seconds();
    let expires_at = now + REGISTRATION_SESSION_TTL_SECONDS;
    let principal_user_id = format!("registered-{}", Uuid::new_v4());
    let password_hash = hash_account_password(password).await?;
    let mut tx = state.pool.begin().await?;
    let inserted = sqlx::query(
        r#"
        INSERT INTO auth_account (
            account_id,
            principal_user_id,
            password_hash,
            created_at,
            disabled_at,
            global_capabilities
        )
        VALUES ($1, $2, $3, $4, NULL, '{}')
        ON CONFLICT (account_id) DO NOTHING
        "#,
    )
    .bind(account_id.as_str())
    .bind(principal_user_id.as_str())
    .bind(&password_hash)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() != 1 {
        return Err(ApiError::Reject {
            status: StatusCode::CONFLICT,
            error: RejectCode::Internal,
            message: "account already exists".to_string(),
        });
    }

    let method_id = identity::methods::link_classic_method(
        &mut *tx,
        account_id.as_str(),
        principal_user_id.as_str(),
        &[],
        now,
    )
    .await?;
    let issued = issue_session_for_request(
        &state,
        &mut *tx,
        identity::SessionSpec {
            principal_user_id: principal_user_id.as_str(),
            session_capabilities: &[],
            authenticated_via_method_id: Some(method_id),
            assurance: identity::Assurance::Password,
            authenticated_at: now,
            expires_at,
            idle_expires_at: None,
        },
        now,
        request.session_token.as_deref(),
    )
    .await?;
    let session_hash = issued.token_hash.clone();
    for (event_kind, metadata) in [
        (
            "account_registered",
            serde_json::json!({
                "account_id": account_id.as_str(),
                "global_capability_count": 0
            }),
        ),
        (
            "account_session_created",
            serde_json::json!({
                "account_id": account_id.as_str(),
                "session_expires_at": expires_at,
                "global_capability_count": 0,
                "registration": true
            }),
        ),
    ] {
        sqlx::query(
            r#"
            INSERT INTO identity_lifecycle_audit (
                event_at,
                event_kind,
                actor_user_id,
                principal_user_id,
                token_hash,
                related_token_hash,
                metadata
            )
            VALUES ($1, $2, $3, $4, $5, NULL, $6::JSONB)
            "#,
        )
        .bind(now)
        .bind(event_kind)
        .bind(principal_user_id.as_str())
        .bind(principal_user_id.as_str())
        .bind(&session_hash)
        .bind(metadata.to_string())
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    Ok(Json(AuthAccountRegistrationResponse {
        account_id,
        principal_user_id,
        session_token: issued.session_token,
        expires_at,
    }))
}

async fn login_auth_account(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<LoginAuthAccount>,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    let response = classic_password_session(
        &state,
        &headers,
        request.account_id.trim(),
        request.password.as_str(),
        request.session_token.as_deref(),
    )
    .await?;
    Ok(Json(response))
}

async fn classic_password_session(
    state: &ApiState,
    headers: &HeaderMap,
    account_id: &str,
    password: &str,
    requested_debug_token: Option<&str>,
) -> Result<AuthSessionResponse, ApiError> {
    require_classic_enabled(state)?;
    if account_id.is_empty() || password.trim().is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "account login requires account_id and password".to_string(),
        });
    }
    validate_account_password_input(password)?;
    let now = unix_now_seconds();
    let expires_at = state.session_policy.classic_expiry(now);
    let _password_permit = acquire_workload_slot(
        &state.password_slots,
        "password processing capacity is exhausted; retry shortly",
    )?;
    let attempt_scope = enforce_auth_attempt_limit(state, headers, account_id).await?;

    let account = sqlx::query_as::<_, (String, String, Vec<String>)>(
        r#"
        SELECT principal_user_id, password_hash, global_capabilities
        FROM auth_account
        WHERE account_id = $1
          AND disabled_at IS NULL
        "#,
    )
    .bind(account_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some(account) = account else {
        consume_dummy_password_verification(password).await?;
        record_failed_auth_attempt(state, &attempt_scope, account_id, "account-login").await?;
        return Err(unauthorized_account());
    };

    if !verify_account_password(account.1.as_str(), password).await? {
        record_failed_auth_attempt(state, &attempt_scope, account_id, "account-login").await?;
        return Err(unauthorized_account());
    }

    let mut tx = state.pool.begin().await?;
    let method_id = identity::methods::link_classic_method(
        &mut *tx,
        account_id,
        account.0.as_str(),
        &account.2,
        now,
    )
    .await?;
    let principal_global_capabilities = sqlx::query_scalar::<_, Vec<String>>(
        "SELECT global_capabilities FROM platform_principal WHERE principal_user_id = $1 AND status = 'active'",
    )
    .bind(account.0.as_str())
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(unauthorized_account)?;
    let issued = issue_session_for_request(
        state,
        &mut *tx,
        identity::SessionSpec {
            principal_user_id: account.0.as_str(),
            session_capabilities: &[],
            authenticated_via_method_id: Some(method_id),
            assurance: identity::Assurance::Password,
            authenticated_at: now,
            expires_at,
            idle_expires_at: Some(
                now.saturating_add(state.session_policy.idle_ttl_seconds)
                    .min(expires_at.max(now + 1)),
            ),
        },
        now,
        requested_debug_token,
    )
    .await?;
    let session_hash = issued.token_hash.clone();
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'account_session_created', $2, $3, $4, NULL, $5::JSONB)
        "#,
    )
    .bind(now)
    .bind(account.0.as_str())
    .bind(account.0.as_str())
    .bind(session_hash)
    .bind(
        serde_json::json!({
            "account_id": account_id,
            "session_expires_at": expires_at,
            "global_capability_count": principal_global_capabilities.len()
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;
    clear_auth_attempt_failures(&mut tx, &attempt_scope).await?;
    tx.commit().await?;

    let mut response =
        auth_session_response(state, account.0, None, principal_global_capabilities).await?;
    response.session_token = Some(issued.session_token);
    response.expires_at = Some(issued.expires_at);
    response.idle_expires_at = issued.idle_expires_at;
    Ok(response)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "method")]
enum CreateAuthSessionRequest {
    #[serde(rename = "classic")]
    Classic {
        login_name: String,
        password: String,
    },
    #[serde(rename = "workos")]
    Workos,
}

async fn create_auth_session(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<CreateAuthSessionRequest>,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    match request {
        CreateAuthSessionRequest::Classic {
            login_name,
            password,
        } => {
            let response = classic_password_session(
                &state,
                &headers,
                login_name.trim(),
                password.as_str(),
                None,
            )
            .await?;
            Ok(Json(response))
        }
        CreateAuthSessionRequest::Workos => {
            let verifier =
                state
                    .access_token_verifier
                    .as_ref()
                    .ok_or_else(|| ApiError::Reject {
                        status: StatusCode::NOT_FOUND,
                        error: RejectCode::NotAuthorized,
                        message: "workos authentication is not configured".to_string(),
                    })?;
            let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
            let verified = verifier.verify(token).await.map_err(identity_api_error)?;
            let now = unix_now_seconds();
            if verified.expires_at <= now {
                return Err(unauthorized_session());
            }
            let mut tx = state.pool.begin().await?;
            sqlx::query("DELETE FROM workos_session_exchange WHERE access_expires_at <= $1")
                .bind(now)
                .execute(&mut *tx)
                .await?;
            let exchanged = sqlx::query(
                r#"
                INSERT INTO workos_session_exchange (
                    provider_session_id, access_token_hash, subject,
                    exchanged_at, access_expires_at
                )
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT DO NOTHING
                "#,
            )
            .bind(verified.session_id.as_str())
            .bind(identity::token::hash_token(token))
            .bind(verified.subject.as_str())
            .bind(now)
            .bind(verified.expires_at)
            .execute(&mut *tx)
            .await?;
            if exchanged.rows_affected() != 1 {
                return Err(ApiError::Reject {
                    status: StatusCode::CONFLICT,
                    error: RejectCode::NotAuthorized,
                    message: "identity assertion was already exchanged".to_string(),
                });
            }
            let resolution = identity::workos::resolve_subject(&mut tx, &verified, now)
                .await
                .map_err(|error| match error {
                    identity::IdentityFlowError::Unauthorized => unauthorized_account(),
                    other => ApiError::from(other),
                })?;
            let expires_at = state.session_policy.workos_expiry(now);
            let issued = identity::session::issue_session(
                &mut *tx,
                identity::SessionSpec {
                    principal_user_id: resolution.principal_user_id.as_str(),
                    session_capabilities: &[],
                    authenticated_via_method_id: Some(resolution.method_id),
                    assurance: identity::Assurance::ExternalSso,
                    authenticated_at: now,
                    expires_at,
                    idle_expires_at: Some(
                        now.saturating_add(state.session_policy.idle_ttl_seconds)
                            .min(expires_at),
                    ),
                },
                now,
            )
            .await?;
            sqlx::query(
                r#"
                INSERT INTO identity_lifecycle_audit (
                    event_at, event_kind, actor_user_id, principal_user_id,
                    token_hash, related_token_hash, metadata
                )
                VALUES ($1, 'session_created', $2, $3, $4, NULL, $5::JSONB)
                "#,
            )
            .bind(now)
            .bind(resolution.principal_user_id.as_str())
            .bind(resolution.principal_user_id.as_str())
            .bind(issued.token_hash.as_str())
            .bind(
                serde_json::json!({
                    "method_kind": "workos",
                    "session_expires_at": issued.expires_at
                })
                .to_string(),
            )
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;

            let mut response = auth_session_response(
                &state,
                resolution.principal_user_id,
                None,
                resolution.global_capabilities,
            )
            .await?;
            response.session_token = Some(issued.session_token);
            response.expires_at = Some(issued.expires_at);
            response.idle_expires_at = issued.idle_expires_at;
            Ok(Json(response))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AccountMethodEntry {
    method_id: Uuid,
    kind: String,
    status: String,
    created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_authenticated_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    login_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AccountMethodsResponse {
    principal_user_id: String,
    methods: Vec<AccountMethodEntry>,
}

async fn list_account_methods(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> Result<Json<AccountMethodsResponse>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let identity = authenticate_token(&state, token).await?;
    let methods = identity::methods::list_methods(&state.pool, identity.principal_user_id.as_str())
        .await?
        .into_iter()
        .map(|method| AccountMethodEntry {
            method_id: method.method_id,
            kind: method.kind.as_str().to_string(),
            status: method.status,
            created_at: method.created_at,
            last_authenticated_at: method.last_authenticated_at,
            login_name: method.login_name,
            display_label: method.display_label,
        })
        .collect();
    Ok(Json(AccountMethodsResponse {
        principal_user_id: identity.principal_user_id,
        methods,
    }))
}

#[derive(Debug, Clone, Deserialize)]
struct AddClassicMethod {
    login_name: String,
    password: String,
    session_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AddClassicMethodResponse {
    status: String,
    method_id: Uuid,
    login_name: String,
    principal_user_id: String,
    recovery_codes: Vec<String>,
    recovery_codes_expire_at: i64,
    session_token: String,
    session_expires_at: i64,
}

const METHOD_RECOVERY_CODE_COUNT: usize = 3;
const METHOD_RECOVERY_CODE_TTL_SECONDS: i64 = 60 * 60 * 24 * 180;

async fn add_classic_method(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<AddClassicMethod>,
) -> Result<Json<AddClassicMethodResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let identity = authenticate_token(&state, token).await?;
    let now = unix_now_seconds();
    require_recent_authentication(&identity, now)?;
    let login_name = normalize_registration_account_id(request.login_name.as_str())?;
    validate_new_account_password(request.password.as_str())?;
    let _password_permit = acquire_workload_slot(
        &state.password_slots,
        "password processing capacity is exhausted; retry shortly",
    )?;
    let password_hash = hash_account_password(request.password.as_str()).await?;

    let mut tx = state.pool.begin().await?;
    let reactivated = identity::methods::reactivate_classic_method(
        &mut *tx,
        identity.principal_user_id.as_str(),
        login_name.as_str(),
        password_hash.as_str(),
        now,
    )
    .await?;
    let method_id = match reactivated {
        Some(method_id) => {
            sqlx::query(
                "UPDATE auth_account_recovery_credential SET revoked_at = $2 WHERE account_id = $1 AND used_at IS NULL AND revoked_at IS NULL",
            )
            .bind(login_name.as_str())
            .bind(now)
            .execute(&mut *tx)
            .await?;
            method_id
        }
        None => {
            let inserted = sqlx::query(
                r#"
                INSERT INTO auth_account (
                    account_id, principal_user_id, password_hash, created_at, disabled_at,
                    global_capabilities
                )
                VALUES ($1, $2, $3, $4, NULL, '{}')
                ON CONFLICT (account_id) DO NOTHING
                "#,
            )
            .bind(login_name.as_str())
            .bind(identity.principal_user_id.as_str())
            .bind(&password_hash)
            .bind(now)
            .execute(&mut *tx)
            .await?;
            if inserted.rows_affected() != 1 {
                return Err(ApiError::Reject {
                    status: StatusCode::CONFLICT,
                    error: RejectCode::Internal,
                    message: "account already exists".to_string(),
                });
            }
            identity::methods::link_classic_method(
                &mut *tx,
                login_name.as_str(),
                identity.principal_user_id.as_str(),
                &[],
                now,
            )
            .await?
        }
    };

    let recovery_expires_at = now + METHOD_RECOVERY_CODE_TTL_SECONDS;
    let mut recovery_codes = Vec::with_capacity(METHOD_RECOVERY_CODE_COUNT);
    for _ in 0..METHOD_RECOVERY_CODE_COUNT {
        let code = format!(
            "fmrc-{}-{}",
            Uuid::new_v4().simple(),
            Uuid::new_v4().simple()
        );
        sqlx::query(
            r#"
            INSERT INTO auth_account_recovery_credential (
                recovery_id, account_id, token_hash, created_at, expires_at, used_at, revoked_at
            )
            VALUES ($1, $2, $3, $4, $5, NULL, NULL)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(login_name.as_str())
        .bind(hash_session_token(code.as_str()))
        .bind(now)
        .bind(recovery_expires_at)
        .execute(&mut *tx)
        .await?;
        recovery_codes.push(code);
    }

    let session_expires_at = state.session_policy.classic_expiry(now);
    let issued = issue_session_for_request(
        &state,
        &mut *tx,
        identity::SessionSpec {
            principal_user_id: identity.principal_user_id.as_str(),
            session_capabilities: &[],
            authenticated_via_method_id: Some(method_id),
            assurance: identity::Assurance::Password,
            authenticated_at: now,
            expires_at: session_expires_at,
            idle_expires_at: Some(
                now.saturating_add(state.session_policy.idle_ttl_seconds)
                    .min(session_expires_at),
            ),
        },
        now,
        request.session_token.as_deref(),
    )
    .await?;

    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at, event_kind, actor_user_id, principal_user_id,
            token_hash, related_token_hash, metadata
        )
        VALUES ($1, $2, $3, $4, $5, NULL, $6::JSONB)
        "#,
    )
    .bind(now)
    .bind(if reactivated.is_some() {
        "method_reactivated"
    } else {
        "method_added"
    })
    .bind(identity.principal_user_id.as_str())
    .bind(identity.principal_user_id.as_str())
    .bind(issued.token_hash.as_str())
    .bind(
        serde_json::json!({
            "method_kind": "classic_password",
            "account_id": login_name.as_str(),
            "recovery_code_count": METHOD_RECOVERY_CODE_COUNT
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(AddClassicMethodResponse {
        status: "added".to_string(),
        method_id,
        login_name,
        principal_user_id: identity.principal_user_id,
        recovery_codes,
        recovery_codes_expire_at: recovery_expires_at,
        session_token: issued.session_token,
        session_expires_at,
    }))
}

#[derive(Debug, Clone, Deserialize)]
struct AddWorkosMethod {
    provider_assertion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AddWorkosMethodResponse {
    status: String,
    method_id: Uuid,
    principal_user_id: String,
}

async fn add_workos_method(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<AddWorkosMethod>,
) -> Result<Json<AddWorkosMethodResponse>, ApiError> {
    let verifier = state
        .access_token_verifier
        .as_ref()
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::NotAuthorized,
            message: "workos authentication is not configured".to_string(),
        })?;
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let identity = authenticate_token(&state, token).await?;
    let now = unix_now_seconds();
    require_recent_authentication(&identity, now)?;
    let provider_assertion = request.provider_assertion.trim();
    if provider_assertion.is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "a WorkOS provider assertion is required".to_string(),
        });
    }
    let verified = verifier
        .verify(provider_assertion)
        .await
        .map_err(identity_api_error)?;
    let mut tx = state.pool.begin().await?;
    let resolution = identity::workos::attach_subject(
        &mut tx,
        &verified,
        identity.principal_user_id.as_str(),
        now,
    )
    .await?;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at, event_kind, actor_user_id, principal_user_id,
            token_hash, related_token_hash, metadata
        )
        VALUES ($1, 'method_attached', $2, $3, $4, NULL, $5::JSONB)
        "#,
    )
    .bind(now)
    .bind(identity.principal_user_id.as_str())
    .bind(identity.principal_user_id.as_str())
    .bind(identity.session_reference.as_str())
    .bind(
        serde_json::json!({
            "method_kind": "workos",
            "provider": "workos"
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(AddWorkosMethodResponse {
        status: "attached".to_string(),
        method_id: resolution.method_id,
        principal_user_id: resolution.principal_user_id,
    }))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DisableMethodResponse {
    status: String,
    method_id: Uuid,
    kind: String,
    principal_user_id: String,
    revoked_session_count: i64,
}

async fn disable_account_method(
    State(state): State<ApiState>,
    Path(method_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<DisableMethodResponse>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let identity = authenticate_token(&state, token).await?;
    let now = unix_now_seconds();
    require_recent_authentication(&identity, now)?;

    let mut tx = state.pool.begin().await?;
    let disabled = identity::methods::disable_method(
        &mut *tx,
        identity.principal_user_id.as_str(),
        method_id,
        now,
    )
    .await?;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at, event_kind, actor_user_id, principal_user_id,
            token_hash, related_token_hash, metadata
        )
        VALUES ($1, 'method_disabled', $2, $3, $4, NULL, $5::JSONB)
        "#,
    )
    .bind(now)
    .bind(identity.principal_user_id.as_str())
    .bind(identity.principal_user_id.as_str())
    .bind(identity.session_reference.as_str())
    .bind(
        serde_json::json!({
            "method_kind": disabled.kind.as_str(),
            "revoked_session_count": disabled.revoked_session_count
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(DisableMethodResponse {
        status: "disabled".to_string(),
        method_id: disabled.method_id,
        kind: disabled.kind.as_str().to_string(),
        principal_user_id: identity.principal_user_id,
        revoked_session_count: disabled.revoked_session_count as i64,
    }))
}

async fn rotate_auth_account_password(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RotateAuthAccountPassword>,
) -> Result<Json<AuthAccountPasswordRotationResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let account_id = request.account_id.trim();
    let current_password = request.current_password.as_str();
    let new_password = request.new_password.as_str();
    if account_id.is_empty() || current_password.trim().is_empty() || new_password.trim().is_empty()
    {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "password rotation requires account_id, current_password, and new_password"
                .to_string(),
        });
    }
    if current_password == new_password {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "password rotation requires a new password".to_string(),
        });
    }
    validate_account_password_input(current_password)?;
    validate_new_account_password(new_password)?;
    let _password_permit = acquire_workload_slot(
        &state.password_slots,
        "password processing capacity is exhausted; retry shortly",
    )?;

    let now = unix_now_seconds();
    let caller_hash = hash_session_token(caller_token);
    let mut tx = state.pool.begin().await?;
    let caller_principal_user_id = authenticated_account_principal_for_update(
        &mut tx,
        &caller_hash,
        account_id,
        current_password,
        now,
    )
    .await?;

    let password_hash = hash_account_password(new_password).await?;
    sqlx::query("UPDATE auth_account SET password_hash = $2 WHERE account_id = $1")
        .bind(account_id)
        .bind(password_hash)
        .execute(&mut *tx)
        .await?;
    let revoked_session_count = sqlx::query(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE principal_user_id = $2
          AND revoked_at IS NULL
          AND expires_at > $1
        "#,
    )
    .bind(now)
    .bind(caller_principal_user_id.as_str())
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'account_password_rotated', $2, $3, $4, NULL, $5::JSONB)
        "#,
    )
    .bind(now)
    .bind(caller_principal_user_id.as_str())
    .bind(caller_principal_user_id.as_str())
    .bind(caller_hash)
    .bind(
        serde_json::json!({
            "account_id": account_id,
            "password_algorithm": "argon2id",
            "revoked_session_count": revoked_session_count
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(AuthAccountPasswordRotationResponse {
        status: "rotated".to_string(),
        account_id: account_id.to_string(),
        principal_user_id: caller_principal_user_id,
        revoked_session_count,
        password_algorithm: "argon2id".to_string(),
    }))
}

async fn issue_auth_account_recovery_credential(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<IssueAuthAccountRecoveryCredential>,
) -> Result<Json<AuthAccountRecoveryCredentialResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let account_id = request.account_id.trim();
    let current_password = request.current_password.as_str();
    if account_id.is_empty() || current_password.trim().is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "recovery credential issuance requires account_id and current_password"
                .to_string(),
        });
    }
    validate_account_password_input(current_password)?;
    let now = unix_now_seconds();
    if request.expires_at <= now || request.expires_at > now + 31_536_000 {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "recovery credential expiry must be within the next 365 days".to_string(),
        });
    }

    let caller_hash = hash_session_token(caller_token);
    let recovery_id = Uuid::new_v4();
    let recovery_token = format!("account-recovery-{}-{}", Uuid::new_v4(), Uuid::new_v4());
    let recovery_hash = hash_session_token(recovery_token.as_str());
    let mut tx = state.pool.begin().await?;
    let principal_user_id = authenticated_account_principal_for_update(
        &mut tx,
        &caller_hash,
        account_id,
        current_password,
        now,
    )
    .await?;
    sqlx::query(
        r#"
        INSERT INTO auth_account_recovery_credential (
            recovery_id,
            account_id,
            token_hash,
            created_at,
            expires_at,
            used_at,
            revoked_at
        )
        VALUES ($1, $2, $3, $4, $5, NULL, NULL)
        "#,
    )
    .bind(recovery_id)
    .bind(account_id)
    .bind(&recovery_hash)
    .bind(now)
    .bind(request.expires_at)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'account_recovery_credential_issued', $2, $3, $4, NULL, $5::JSONB)
        "#,
    )
    .bind(now)
    .bind(principal_user_id.as_str())
    .bind(principal_user_id.as_str())
    .bind(&recovery_hash)
    .bind(
        serde_json::json!({
            "account_id": account_id,
            "recovery_id": recovery_id,
            "expires_at": request.expires_at
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;
    let delivery = deliver_auth_credential(
        &state,
        &mut tx,
        IdentityDeliveryKind::Recovery,
        account_id,
        principal_user_id.as_str(),
        recovery_hash.as_str(),
        recovery_token.as_str(),
        request.expires_at,
        now,
    )
    .await?;
    tx.commit().await?;

    Ok(Json(AuthAccountRecoveryCredentialResponse {
        status: "issued".to_string(),
        recovery_id,
        recovery_token,
        account_id: account_id.to_string(),
        principal_user_id,
        expires_at: request.expires_at,
        delivery_id: delivery.delivery_id,
        delivery_status: delivery.status,
        delivery_attempt_count: delivery.attempt_count,
        delivery_provider_id: delivery.provider_id,
        delivery_outcome_kind: delivery.outcome_kind,
        delivery_outcome_code: delivery.outcome_code,
    }))
}

async fn request_auth_account_recovery(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RequestAuthAccountRecovery>,
) -> Result<Json<AuthAccountRecoveryRequestResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let account_id = normalize_registration_account_id(request.account_id.as_str())?;
    enforce_recovery_request_limit(&state, &headers, account_id.as_str()).await?;

    let account = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT account_id, principal_user_id
        FROM auth_account
        WHERE account_id = $1
          AND disabled_at IS NULL
        "#,
    )
    .bind(account_id.as_str())
    .fetch_optional(&state.pool)
    .await?;

    let Some((account_id, principal_user_id)) = account else {
        return Ok(Json(AuthAccountRecoveryRequestResponse {
            status: "accepted".to_string(),
        }));
    };

    let now = unix_now_seconds();
    let expires_at = now + 60 * 60;
    let recovery_id = Uuid::new_v4();
    let recovery_token = format!("account-recovery-{}-{}", Uuid::new_v4(), Uuid::new_v4());
    let recovery_hash = hash_session_token(recovery_token.as_str());
    let mut tx = state.pool.begin().await?;
    let rotated_recovery_hashes = sqlx::query_scalar::<_, String>(
        r#"
        UPDATE auth_account_recovery_credential
        SET revoked_at = $2
        WHERE account_id = $1
          AND used_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > $2
        RETURNING token_hash
        "#,
    )
    .bind(account_id.as_str())
    .bind(now)
    .fetch_all(&mut *tx)
    .await?;
    for rotated_recovery_hash in rotated_recovery_hashes {
        cancel_auth_delivery_intent(
            &mut tx,
            rotated_recovery_hash.as_str(),
            None,
            "credential_rotated",
            now,
        )
        .await?;
    }
    sqlx::query(
        r#"
        INSERT INTO auth_account_recovery_credential (
            recovery_id,
            account_id,
            token_hash,
            created_at,
            expires_at,
            used_at,
            revoked_at
        )
        VALUES ($1, $2, $3, $4, $5, NULL, NULL)
        "#,
    )
    .bind(recovery_id)
    .bind(account_id.as_str())
    .bind(recovery_hash.as_str())
    .bind(now)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'account_recovery_credential_issued', NULL, $2, $3, NULL, $4::JSONB)
        "#,
    )
    .bind(now)
    .bind(principal_user_id.as_str())
    .bind(recovery_hash.as_str())
    .bind(
        serde_json::json!({
            "account_id": account_id,
            "recovery_id": recovery_id,
            "expires_at": expires_at,
            "request_kind": "forgot-password"
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;
    deliver_auth_credential(
        &state,
        &mut tx,
        IdentityDeliveryKind::Recovery,
        account_id.as_str(),
        principal_user_id.as_str(),
        recovery_hash.as_str(),
        recovery_token.as_str(),
        expires_at,
        now,
    )
    .await?;
    tx.commit().await?;

    Ok(Json(AuthAccountRecoveryRequestResponse {
        status: "accepted".to_string(),
    }))
}

async fn revoke_auth_account_recovery_credential(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RevokeAuthAccountRecoveryCredential>,
) -> Result<Json<AuthAccountRecoveryCredentialLifecycleResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let account_id = request.account_id.trim();
    let current_password = request.current_password.as_str();
    if account_id.is_empty() || current_password.trim().is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "recovery credential revocation requires account_id and current_password"
                .to_string(),
        });
    }
    validate_account_password_input(current_password)?;
    let now = unix_now_seconds();
    let caller_hash = hash_session_token(caller_token);
    let mut tx = state.pool.begin().await?;
    let principal_user_id = authenticated_account_principal_for_update(
        &mut tx,
        &caller_hash,
        account_id,
        current_password,
        now,
    )
    .await?;
    let recovery_hash = sqlx::query_scalar::<_, String>(
        r#"
        UPDATE auth_account_recovery_credential
        SET revoked_at = $1
        WHERE recovery_id = $2
          AND account_id = $3
          AND used_at IS NULL
          AND revoked_at IS NULL
        RETURNING token_hash
        "#,
    )
    .bind(now)
    .bind(request.recovery_id)
    .bind(account_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(unauthorized_account_recovery)?;
    cancel_auth_delivery_intent(
        &mut tx,
        recovery_hash.as_str(),
        Some(principal_user_id.as_str()),
        "credential_revoked",
        now,
    )
    .await?;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'account_recovery_credential_revoked', $2, $3, $4, NULL, $5::JSONB)
        "#,
    )
    .bind(now)
    .bind(principal_user_id.as_str())
    .bind(principal_user_id.as_str())
    .bind(recovery_hash)
    .bind(
        serde_json::json!({
            "account_id": account_id,
            "recovery_id": request.recovery_id
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(AuthAccountRecoveryCredentialLifecycleResponse {
        status: "revoked".to_string(),
        recovery_id: request.recovery_id,
        account_id: account_id.to_string(),
        principal_user_id,
    }))
}

async fn recover_auth_account(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RecoverAuthAccount>,
) -> Result<Json<AuthAccountRecoveryResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let account_id = request.account_id.trim();
    let recovery_token = request.recovery_token.trim();
    let new_password = request.new_password.as_str();
    if account_id.is_empty() || recovery_token.is_empty() || new_password.trim().is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "account recovery requires account_id, recovery_token, and new_password"
                .to_string(),
        });
    }
    if recovery_token.len() > 256 {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "account recovery credentials cannot exceed 256 bytes".to_string(),
        });
    }
    validate_new_account_password(new_password)?;
    let _password_permit = acquire_workload_slot(
        &state.password_slots,
        "password processing capacity is exhausted; retry shortly",
    )?;
    let attempt_scope = enforce_auth_attempt_limit(&state, &headers, account_id).await?;
    let now = unix_now_seconds();
    let recovery_hash = hash_session_token(recovery_token);
    let mut tx = state.pool.begin().await?;
    let credential = sqlx::query_as::<_, (Uuid, String, Vec<String>)>(
        r#"
        SELECT recovery.recovery_id,
               account.principal_user_id,
               account.global_capabilities
        FROM auth_account_recovery_credential AS recovery
        JOIN auth_account AS account
          ON account.account_id = recovery.account_id
        WHERE recovery.account_id = $1
          AND recovery.token_hash = $2
          AND recovery.used_at IS NULL
          AND recovery.revoked_at IS NULL
          AND recovery.expires_at > $3
          AND account.disabled_at IS NULL
        FOR UPDATE OF recovery, account
        "#,
    )
    .bind(account_id)
    .bind(&recovery_hash)
    .bind(now)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((recovery_id, principal_user_id, account_global_capabilities)) = credential else {
        tx.rollback().await?;
        consume_dummy_password_verification(new_password).await?;
        record_account_recovery_rejection(&state.pool, account_id, recovery_hash.as_str(), now)
            .await?;
        record_failed_auth_attempt(&state, &attempt_scope, account_id, "account-recovery").await?;
        return Err(unauthorized_account_recovery());
    };

    let password_hash = hash_account_password(new_password).await?;
    sqlx::query(
        r#"
        UPDATE auth_account_recovery_credential
        SET used_at = $1
        WHERE recovery_id = $2
        "#,
    )
    .bind(now)
    .bind(recovery_id)
    .execute(&mut *tx)
    .await?;
    cancel_auth_delivery_intent(
        &mut tx,
        recovery_hash.as_str(),
        Some(principal_user_id.as_str()),
        "credential_consumed",
        now,
    )
    .await?;
    sqlx::query("UPDATE auth_account SET password_hash = $2 WHERE account_id = $1")
        .bind(account_id)
        .bind(password_hash)
        .execute(&mut *tx)
        .await?;
    let revoked_session_count = sqlx::query(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE principal_user_id = $2
          AND revoked_at IS NULL
          AND expires_at > $1
        "#,
    )
    .bind(now)
    .bind(principal_user_id.as_str())
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;
    let method_id = identity::methods::link_classic_method(
        &mut *tx,
        account_id,
        principal_user_id.as_str(),
        &account_global_capabilities,
        now,
    )
    .await?;
    let issued = issue_session_for_request(
        &state,
        &mut *tx,
        identity::SessionSpec {
            principal_user_id: principal_user_id.as_str(),
            session_capabilities: &[],
            authenticated_via_method_id: Some(method_id),
            assurance: identity::Assurance::Password,
            authenticated_at: now,
            expires_at: state.session_policy.classic_expiry(now),
            idle_expires_at: None,
        },
        now,
        request.session_token.as_deref(),
    )
    .await?;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'account_recovered', $2, $3, $4, NULL, $5::JSONB)
        "#,
    )
    .bind(now)
    .bind(principal_user_id.as_str())
    .bind(principal_user_id.as_str())
    .bind(&recovery_hash)
    .bind(
        serde_json::json!({
            "account_id": account_id,
            "recovery_id": recovery_id,
            "password_algorithm": "argon2id",
            "revoked_session_count": revoked_session_count
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;
    clear_auth_attempt_failures(&mut tx, &attempt_scope).await?;
    tx.commit().await?;

    Ok(Json(AuthAccountRecoveryResponse {
        status: "recovered".to_string(),
        recovery_id,
        account_id: account_id.to_string(),
        principal_user_id,
        revoked_session_count,
        password_algorithm: "argon2id".to_string(),
        session_token: issued.session_token,
        session_expires_at: issued.expires_at,
    }))
}

async fn disable_auth_account(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<DisableAuthAccount>,
) -> Result<Json<AuthAccountLifecycleResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let actor_user_id = require_global_admin(&state, caller_token, "account disable").await?;
    let account_id = request.account_id.trim();
    if account_id.is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "account disable requires account_id".to_string(),
        });
    }

    let now = unix_now_seconds();
    let mut tx = state.pool.begin().await?;
    let account = sqlx::query_as::<_, (String, Option<i64>)>(
        r#"
        SELECT principal_user_id, disabled_at
        FROM auth_account
        WHERE account_id = $1
        FOR UPDATE
        "#,
    )
    .bind(account_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(account_not_found)?;
    reject_stale_account_lifecycle(
        request.expected_disabled,
        account.1.is_some(),
        account_id,
        "disable",
    )?;

    let disabled_at = match account.1 {
        Some(disabled_at) => disabled_at,
        None => {
            sqlx::query("UPDATE auth_account SET disabled_at = $2 WHERE account_id = $1")
                .bind(account_id)
                .bind(now)
                .execute(&mut *tx)
                .await?;
            now
        }
    };
    let revoked_session_count = if request.revoke_sessions {
        sqlx::query(
            r#"
            UPDATE auth_session
            SET revoked_at = $1
            WHERE principal_user_id = $2
              AND revoked_at IS NULL
              AND expires_at > $1
            "#,
        )
        .bind(now)
        .bind(account.0.as_str())
        .execute(&mut *tx)
        .await?
        .rows_affected() as i64
    } else {
        0
    };

    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'account_disabled', $2, $3, NULL, NULL, $4::JSONB)
        "#,
    )
    .bind(now)
    .bind(actor_user_id.as_str())
    .bind(account.0.as_str())
    .bind(
        serde_json::json!({
            "account_id": account_id,
            "revoked_session_count": revoked_session_count
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(AuthAccountLifecycleResponse {
        status: if account.1.is_some() {
            "already_disabled".to_string()
        } else {
            "disabled".to_string()
        },
        account_id: account_id.to_string(),
        principal_user_id: account.0,
        disabled_at: Some(disabled_at),
        revoked_session_count,
    }))
}

async fn enable_auth_account(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<EnableAuthAccount>,
) -> Result<Json<AuthAccountLifecycleResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let actor_user_id = require_global_admin(&state, caller_token, "account enable").await?;
    let account_id = request.account_id.trim();
    if account_id.is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "account enable requires account_id".to_string(),
        });
    }

    let now = unix_now_seconds();
    let mut tx = state.pool.begin().await?;
    let account = sqlx::query_as::<_, (String, Option<i64>)>(
        r#"
        SELECT principal_user_id, disabled_at
        FROM auth_account
        WHERE account_id = $1
        FOR UPDATE
        "#,
    )
    .bind(account_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(account_not_found)?;
    reject_stale_account_lifecycle(
        request.expected_disabled,
        account.1.is_some(),
        account_id,
        "enable",
    )?;

    if account.1.is_some() {
        sqlx::query("UPDATE auth_account SET disabled_at = NULL WHERE account_id = $1")
            .bind(account_id)
            .execute(&mut *tx)
            .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'account_enabled', $2, $3, NULL, NULL, $4::JSONB)
        "#,
    )
    .bind(now)
    .bind(actor_user_id.as_str())
    .bind(account.0.as_str())
    .bind(
        serde_json::json!({
            "account_id": account_id,
            "was_disabled": account.1.is_some()
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(AuthAccountLifecycleResponse {
        status: if account.1.is_some() {
            "enabled".to_string()
        } else {
            "already_enabled".to_string()
        },
        account_id: account_id.to_string(),
        principal_user_id: account.0,
        disabled_at: None,
        revoked_session_count: 0,
    }))
}

async fn rotate_auth_session(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RotateAuthSession>,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let new_token = match request
        .session_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        Some(client_token) => client_token.to_string(),
        None => identity::token::generate_session_token(),
    };
    let old_hash = hash_session_token(caller_token);
    let new_hash = hash_session_token(new_token.as_str());
    if old_hash == new_hash {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "session rotation requires a new token".to_string(),
        });
    }

    let now = unix_now_seconds();
    let mut tx = state.pool.begin().await?;
    let session = sqlx::query_as::<
        _,
        (
            String,
            i64,
            Vec<String>,
            Option<Uuid>,
            Option<i64>,
            Option<String>,
            i64,
        ),
    >(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE token_hash = $2
          AND revoked_at IS NULL
          AND expires_at > $1
        RETURNING principal_user_id, expires_at, global_capabilities,
                  authenticated_via_method_id, idle_expires_at, assurance,
                  authenticated_at
        "#,
    )
    .bind(now)
    .bind(&old_hash)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(unauthorized_session)?;

    sqlx::query(
        r#"
        INSERT INTO auth_session (
            token_hash,
            principal_user_id,
            created_at,
            expires_at,
            revoked_at,
            global_capabilities,
            authenticated_via_method_id,
            idle_expires_at,
            assurance,
            authenticated_at
        )
        VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(&new_hash)
    .bind(session.0.as_str())
    .bind(now)
    .bind(session.1)
    .bind(&session.2)
    .bind(session.3)
    .bind(session.4)
    .bind(session.5.as_deref())
    .bind(session.6)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'session_rotated', $2, $3, $4, $5, $6::JSONB)
        "#,
    )
    .bind(now)
    .bind(session.0.as_str())
    .bind(session.0.as_str())
    .bind(old_hash)
    .bind(new_hash)
    .bind(
        serde_json::json!({
            "session_expires_at": session.1,
            "global_capability_count": session.2.len()
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let mut response = auth_session_response(&state, session.0, None, session.2).await?;
    response.session_token = Some(new_token);
    response.expires_at = Some(session.1);
    response.idle_expires_at = session.4;
    Ok(Json(response))
}

async fn logout_auth_session(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> Result<Json<AuthLifecycleResponse>, ApiError> {
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let token_hash = hash_session_token(caller_token);
    let now = unix_now_seconds();
    let mut tx = state.pool.begin().await?;
    let principal_user_id = sqlx::query_scalar::<_, String>(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE token_hash = $2
          AND revoked_at IS NULL
          AND expires_at > $1
        RETURNING principal_user_id
        "#,
    )
    .bind(now)
    .bind(&token_hash)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(unauthorized_session)?;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'session_logged_out', $2, $3, $4, NULL, '{}'::JSONB)
        "#,
    )
    .bind(now)
    .bind(principal_user_id.as_str())
    .bind(principal_user_id.as_str())
    .bind(token_hash)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(AuthLifecycleResponse {
        status: "logged_out".to_string(),
        principal_user_id,
    }))
}

async fn revoke_auth_session(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RevokeAuthSession>,
) -> Result<Json<AuthLifecycleResponse>, ApiError> {
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let actor_user_id = require_global_admin(&state, caller_token, "session revocation").await?;

    let token = request.token.trim();
    if token.is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "session revocation requires token".to_string(),
        });
    }
    let now = unix_now_seconds();
    let token_hash = hash_session_token(token);
    let mut tx = state.pool.begin().await?;
    let principal_user_id = sqlx::query_scalar::<_, String>(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE token_hash = $2
          AND revoked_at IS NULL
          AND expires_at > $1
        RETURNING principal_user_id
        "#,
    )
    .bind(now)
    .bind(&token_hash)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(unauthorized_session)?;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'session_revoked', $2, $3, $4, NULL, '{}'::JSONB)
        "#,
    )
    .bind(now)
    .bind(actor_user_id.as_str())
    .bind(principal_user_id.as_str())
    .bind(token_hash)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(AuthLifecycleResponse {
        status: "revoked".to_string(),
        principal_user_id,
    }))
}

async fn create_auth_invite(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<CreateAuthInvite>,
) -> Result<Json<AuthInviteResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let (invited_by_user_id, caller_global_capabilities) =
        active_session_principal_and_globals(&state, caller_token).await?;
    let caller_is_global_admin = caller_global_capabilities
        .iter()
        .any(|capability| capability == "GlobalAdmin");

    let invite_token = request.invite_token.trim();
    let account_id = request.account_id.trim();
    let expected_principal_user_id = request.expected_principal_user_id.trim();
    if invite_token.is_empty() || account_id.is_empty() || expected_principal_user_id.is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "invite requires invite_token, account_id, and expected_principal_user_id"
                .to_string(),
        });
    }
    let now = unix_now_seconds();
    if request.expires_at <= now {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "invite expiry must be in the future".to_string(),
        });
    }
    let global_capabilities = normalize_global_capabilities(&request.global_capabilities)?;
    if !caller_is_global_admin {
        let Some(game) = request.game else {
            return Err(ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "invite issuance requires GlobalAdmin or HostOf(game)".to_string(),
            });
        };
        if !global_capabilities.is_empty() {
            return Err(ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "host-issued invites cannot grant global capabilities".to_string(),
            });
        }
        let caps = caps::resolve(
            &state.pool,
            &Principal::user(invited_by_user_id.as_str()),
            game,
        )
        .await?;
        if !caps.grants(&Capability::HostOf(game)) {
            return Err(ApiError::Reject {
                status: StatusCode::FORBIDDEN,
                error: RejectCode::NotAuthorized,
                message: "invite issuance requires GlobalAdmin or HostOf(game)".to_string(),
            });
        }
    }
    let account_principal_user_id = sqlx::query_scalar::<_, String>(
        r#"
        SELECT principal_user_id
        FROM auth_account
        WHERE account_id = $1
          AND disabled_at IS NULL
        "#,
    )
    .bind(account_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(unauthorized_account)?;
    if account_principal_user_id != expected_principal_user_id {
        return Err(ApiError::Reject {
            status: StatusCode::CONFLICT,
            error: RejectCode::StreamConflict,
            message: "invite account no longer matches the expected principal; refresh the target and try again"
                .to_string(),
        });
    }

    let invite_hash = hash_session_token(invite_token);
    let mut tx = state.pool.begin().await?;
    let inserted = sqlx::query(
        r#"
        INSERT INTO auth_invite (
            token_hash,
            account_id,
            principal_user_id,
            game,
            created_at,
            expires_at,
            redeemed_at,
            redeemed_session_token_hash,
            global_capabilities,
            invited_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, $8)
        ON CONFLICT (token_hash) DO NOTHING
        "#,
    )
    .bind(&invite_hash)
    .bind(account_id)
    .bind(account_principal_user_id.as_str())
    .bind(request.game)
    .bind(now)
    .bind(request.expires_at)
    .bind(&global_capabilities)
    .bind(&invited_by_user_id)
    .execute(&mut *tx)
    .await?;

    if inserted.rows_affected() != 1 {
        return Err(ApiError::Reject {
            status: StatusCode::CONFLICT,
            error: RejectCode::Internal,
            message: "invite token already exists".to_string(),
        });
    }

    let delivery = deliver_auth_credential(
        &state,
        &mut tx,
        IdentityDeliveryKind::Invite,
        account_id,
        account_principal_user_id.as_str(),
        invite_hash.as_str(),
        invite_token,
        request.expires_at,
        now,
    )
    .await?;
    tx.commit().await?;

    Ok(Json(AuthInviteResponse {
        account_id: account_id.to_string(),
        principal_user_id: account_principal_user_id,
        expires_at: request.expires_at,
        game: request.game,
        global_capabilities,
        invited_by_user_id,
        delivery_id: delivery.delivery_id,
        delivery_status: delivery.status,
        delivery_attempt_count: delivery.attempt_count,
        delivery_provider_id: delivery.provider_id,
        delivery_outcome_kind: delivery.outcome_kind,
        delivery_outcome_code: delivery.outcome_code,
    }))
}

async fn redeem_auth_invite(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RedeemAuthInvite>,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let invite_token = request.invite_token.trim();
    let account_id = request.account_id.trim();
    let password = request.password.as_str();
    if invite_token.is_empty() || account_id.is_empty() || password.trim().is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "invite redemption requires invite_token, account_id, and password"
                .to_string(),
        });
    }
    validate_account_password_input(password)?;
    let _password_permit = acquire_workload_slot(
        &state.password_slots,
        "password processing capacity is exhausted; retry shortly",
    )?;
    let attempt_scope = enforce_auth_attempt_limit(&state, &headers, account_id).await?;

    let now = unix_now_seconds();
    let invite_hash = hash_session_token(invite_token);
    let mut tx = state.pool.begin().await?;
    let invite = sqlx::query_as::<_, (String, i64, Vec<String>, String)>(
        r#"
        SELECT invite.principal_user_id,
               invite.expires_at,
               invite.global_capabilities,
               account.password_hash
        FROM auth_invite AS invite
        JOIN auth_account AS account
          ON account.account_id = invite.account_id
        WHERE invite.token_hash = $1
          AND invite.account_id = $2
          AND invite.redeemed_at IS NULL
          AND invite.revoked_at IS NULL
          AND invite.expires_at > $3
          AND account.disabled_at IS NULL
          AND account.principal_user_id = invite.principal_user_id
        FOR UPDATE OF invite
        "#,
    )
    .bind(&invite_hash)
    .bind(account_id)
    .bind(now)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(invite) = invite else {
        tx.rollback().await?;
        consume_dummy_password_verification(password).await?;
        record_failed_auth_attempt(&state, &attempt_scope, account_id, "invite-redemption").await?;
        return Err(unauthorized_invite());
    };

    if !verify_account_password(invite.3.as_str(), password).await? {
        tx.rollback().await?;
        record_failed_auth_attempt(&state, &attempt_scope, account_id, "invite-redemption").await?;
        return Err(unauthorized_invite());
    }

    let method_id = identity::methods::link_classic_method(
        &mut *tx,
        account_id,
        invite.0.as_str(),
        &invite.2,
        now,
    )
    .await?;
    let issued = issue_session_for_request(
        &state,
        &mut *tx,
        identity::SessionSpec {
            principal_user_id: invite.0.as_str(),
            session_capabilities: &invite.2,
            authenticated_via_method_id: Some(method_id),
            assurance: identity::Assurance::Password,
            authenticated_at: now,
            expires_at: invite.1,
            idle_expires_at: None,
        },
        now,
        request.session_token.as_deref(),
    )
    .await?;
    let session_hash = issued.token_hash.clone();

    sqlx::query(
        r#"
        UPDATE auth_invite
        SET redeemed_at = $1,
            redeemed_session_token_hash = $2
        WHERE token_hash = $3
        "#,
    )
    .bind(now)
    .bind(&session_hash)
    .bind(&invite_hash)
    .execute(&mut *tx)
    .await?;
    cancel_auth_delivery_intent(
        &mut tx,
        invite_hash.as_str(),
        Some(invite.0.as_str()),
        "invite_redeemed",
        now,
    )
    .await?;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'invite_redeemed', $2, $3, $4, $5, $6::JSONB)
        "#,
    )
    .bind(now)
    .bind(invite.0.as_str())
    .bind(invite.0.as_str())
    .bind(&invite_hash)
    .bind(&session_hash)
    .bind(serde_json::json!({ "account_id": account_id }).to_string())
    .execute(&mut *tx)
    .await?;
    clear_auth_attempt_failures(&mut tx, &attempt_scope).await?;
    tx.commit().await?;

    let mut response = auth_session_response(&state, invite.0, None, invite.2).await?;
    response.session_token = Some(issued.session_token);
    response.expires_at = Some(issued.expires_at);
    Ok(Json(response))
}

async fn revoke_auth_invite(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RevokeAuthInvite>,
) -> Result<Json<AuthLifecycleResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let actor_user_id = require_global_admin(&state, caller_token, "invite revocation").await?;

    let invite_token = request.invite_token.trim();
    if invite_token.is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "invite revocation requires invite_token".to_string(),
        });
    }
    let now = unix_now_seconds();
    let invite_hash = hash_session_token(invite_token);
    let mut tx = state.pool.begin().await?;
    let principal_user_id = sqlx::query_scalar::<_, String>(
        r#"
        UPDATE auth_invite
        SET revoked_at = $1
        WHERE token_hash = $2
          AND redeemed_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > $1
        RETURNING principal_user_id
        "#,
    )
    .bind(now)
    .bind(&invite_hash)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(unauthorized_invite)?;
    cancel_auth_delivery_intent(
        &mut tx,
        invite_hash.as_str(),
        Some(actor_user_id.as_str()),
        "invite_revoked",
        now,
    )
    .await?;
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'invite_revoked', $2, $3, $4, NULL, '{}'::JSONB)
        "#,
    )
    .bind(now)
    .bind(actor_user_id.as_str())
    .bind(principal_user_id.as_str())
    .bind(invite_hash)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(AuthLifecycleResponse {
        status: "revoked".to_string(),
        principal_user_id,
    }))
}

async fn admin_auth_delivery_queue(
    State(state): State<ApiState>,
    Query(query): Query<AuthDeliveryQueueQuery>,
    headers: HeaderMap,
) -> Result<Json<AuthDeliveryQueueResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    require_global_operator(&state, caller_token, "auth delivery queue").await?;
    let now = unix_now_seconds();
    let limit = query.limit.unwrap_or(100).clamp(1, 200);
    let deliveries = sqlx::query_as::<_, AuthDeliveryQueueEntry>(
        r#"
        SELECT delivery.delivery_id,
               delivery.delivery_kind,
               delivery.account_id,
               delivery.principal_user_id,
               delivery.status,
               delivery.attempt_count,
               delivery.provider_id,
               delivery.outcome_kind,
               delivery.outcome_code,
               delivery.next_attempt_at,
               delivery.credential_expires_at,
               delivery.created_at,
               delivery.updated_at,
               (
                   delivery.status = 'retryable_failed'
                   AND delivery.next_attempt_at <= $1
                   AND delivery.credential_expires_at > $1
                   AND CASE delivery.delivery_kind
                       WHEN 'invite' THEN EXISTS (
                           SELECT 1 FROM auth_invite
                           WHERE token_hash = delivery.credential_hash
                             AND redeemed_at IS NULL
                             AND revoked_at IS NULL
                       )
                       WHEN 'recovery' THEN EXISTS (
                           SELECT 1 FROM auth_account_recovery_credential
                           WHERE token_hash = delivery.credential_hash
                             AND used_at IS NULL
                             AND revoked_at IS NULL
                       )
                       ELSE FALSE
                   END
               ) AS retry_eligible
        FROM auth_delivery_intent AS delivery
        WHERE delivery.status IN ('retryable_failed', 'permanent_failed', 'cancelled')
        ORDER BY
            CASE delivery.status
                WHEN 'retryable_failed' THEN 0
                WHEN 'permanent_failed' THEN 1
                WHEN 'cancelled' THEN 2
                WHEN 'processing' THEN 3
                ELSE 4
            END,
            delivery.updated_at DESC,
            delivery.delivery_id DESC
        LIMIT $2
        "#,
    )
    .bind(now)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(AuthDeliveryQueueResponse { deliveries }))
}

async fn retry_auth_delivery_intent(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Path(delivery_id): Path<Uuid>,
) -> Result<Json<AuthDeliveryRetryResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let actor_user_id = require_global_admin(&state, caller_token, "delivery retry").await?;
    let now = unix_now_seconds();
    let receipt = process_identity_delivery_intent(
        &state.pool,
        state.identity_delivery_gateway.as_ref(),
        delivery_id,
        actor_user_id.as_str(),
        "auth_delivery_retried",
        now,
    )
    .await?
    .ok_or_else(|| ApiError::Reject {
        status: StatusCode::CONFLICT,
        error: RejectCode::StreamConflict,
        message: "delivery intent is not ready for retry; refresh delivery status and try again"
            .to_string(),
    })?;
    Ok(Json(AuthDeliveryRetryResponse {
        status: receipt.status,
        delivery_id,
        delivery_kind: receipt.delivery_kind,
        attempt_count: receipt.attempt_count,
        delivery_provider_id: receipt.provider_id,
        delivery_outcome_kind: receipt.outcome_kind,
        delivery_outcome_code: receipt.outcome_code,
    }))
}

async fn identity_lifecycle_audit(
    State(state): State<ApiState>,
    Query(query): Query<IdentityLifecycleAuditQuery>,
    headers: HeaderMap,
) -> Result<Json<IdentityLifecycleAuditResponse>, ApiError> {
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    require_global_admin(&state, caller_token, "identity lifecycle audit").await?;

    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let rows = sqlx::query_as::<_, (i64, i64, String, Option<String>, String, String)>(
        r#"
        SELECT id,
               event_at,
               event_kind,
               actor_user_id,
               principal_user_id,
               metadata::TEXT
        FROM identity_lifecycle_audit
        WHERE ($1::TEXT IS NULL OR principal_user_id = $1)
        ORDER BY id DESC
        LIMIT $2
        "#,
    )
    .bind(query.principal_user_id.as_deref())
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    let entries = rows
        .into_iter()
        .map(
            |(id, event_at, event_kind, actor_user_id, principal_user_id, metadata)| {
                IdentityLifecycleAuditEntry {
                    id,
                    event_at,
                    event_kind,
                    actor_user_id,
                    principal_user_id,
                    metadata: serde_json::from_str(&metadata).unwrap_or(serde_json::Value::Null),
                }
            },
        )
        .collect::<Vec<_>>();

    Ok(Json(IdentityLifecycleAuditResponse { entries }))
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
        session_token: None,
        created_at: None,
        expires_at: None,
        idle_expires_at: None,
        rotation_required: None,
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
    let identity = authenticate_token(state, token).await?;
    Ok((identity.principal_user_id, identity.global_capabilities))
}

async fn enforce_auth_attempt_limit(
    state: &ApiState,
    headers: &HeaderMap,
    account_id: &str,
) -> Result<AuthAttemptScope, ApiError> {
    let policy = state.auth_attempt_policy.clone();
    let normalized_source = normalized_auth_attempt_source(headers, &policy);
    let source_scope_hash =
        hash_session_token(format!("credential-source:\0{normalized_source}").as_str());
    let now = unix_now_seconds();
    if let Some(retry_after) =
        blocked_auth_attempt_retry_after(&state.pool, source_scope_hash.as_str(), now).await?
    {
        return Err(rate_limited(retry_after));
    }

    let account_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM auth_account WHERE account_id = $1)",
    )
    .bind(account_id)
    .fetch_one(&state.pool)
    .await?;
    let account_scope_hash = account_exists.then(|| {
        hash_session_token(
            format!(
                "credential-account:{}",
                account_id.trim().to_ascii_lowercase()
            )
            .as_str(),
        )
    });
    if let Some(account_scope_hash) = account_scope_hash.as_deref() {
        if let Some(retry_after) =
            blocked_auth_attempt_retry_after(&state.pool, account_scope_hash, now).await?
        {
            return Err(rate_limited(retry_after));
        }
    }
    Ok(AuthAttemptScope {
        source_scope_hash,
        account_scope_hash,
        policy,
    })
}

async fn enforce_registration_source_limit(
    state: &ApiState,
    headers: &HeaderMap,
) -> Result<(), ApiError> {
    let policy = state.auth_attempt_policy.clone();
    let normalized_source = normalized_auth_attempt_source(headers, &policy);
    let source_hash =
        hash_session_token(format!("account-registration-source:\0{normalized_source}").as_str());
    enforce_public_request_limit(
        state,
        source_hash.as_str(),
        policy.registration_max_per_source,
        &policy,
    )
    .await
}

async fn enforce_recovery_request_limit(
    state: &ApiState,
    headers: &HeaderMap,
    account_id: &str,
) -> Result<(), ApiError> {
    let policy = state.auth_attempt_policy.clone();
    let normalized_source = normalized_auth_attempt_source(headers, &policy);
    let scope_hash = hash_session_token(
        format!(
            "account-recovery-request:{}\0source:{}",
            account_id.trim().to_ascii_lowercase(),
            normalized_source
        )
        .as_str(),
    );
    enforce_public_request_limit(
        state,
        scope_hash.as_str(),
        policy.account_max_failures,
        &policy,
    )
    .await
}

async fn enforce_public_request_limit(
    state: &ApiState,
    scope_hash: &str,
    max_attempts: i32,
    policy: &AuthAttemptPolicy,
) -> Result<(), ApiError> {
    let now = unix_now_seconds();
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "DELETE FROM auth_registration_attempt WHERE updated_at < $1 AND (blocked_until IS NULL OR blocked_until <= $2)",
    )
    .bind(now - policy.retention_seconds)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    let blocked_until = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT blocked_until FROM auth_registration_attempt WHERE scope_hash = $1 FOR UPDATE",
    )
    .bind(scope_hash)
    .fetch_optional(&mut *tx)
    .await?
    .flatten();
    if let Some(blocked_until) = blocked_until.filter(|value| *value > now) {
        tx.commit().await?;
        return Err(rate_limited(blocked_until - now));
    }

    let (_, blocked_until) = sqlx::query_as::<_, (i32, Option<i64>)>(
        r#"
        INSERT INTO auth_registration_attempt (
            scope_hash,
            window_started_at,
            attempt_count,
            blocked_until,
            updated_at
        )
        VALUES ($1, $2, 1, NULL, $2)
        ON CONFLICT (scope_hash) DO UPDATE
        SET window_started_at = CASE
                WHEN auth_registration_attempt.window_started_at + $3 <= $2 THEN $2
                ELSE auth_registration_attempt.window_started_at
            END,
            attempt_count = CASE
                WHEN auth_registration_attempt.window_started_at + $3 <= $2 THEN 1
                ELSE auth_registration_attempt.attempt_count + 1
            END,
            blocked_until = CASE
                WHEN (
                    CASE
                        WHEN auth_registration_attempt.window_started_at + $3 <= $2 THEN 1
                        ELSE auth_registration_attempt.attempt_count + 1
                    END
                ) >= $4 THEN $2 + $5
                ELSE NULL
            END,
            updated_at = $2
        RETURNING attempt_count, blocked_until
        "#,
    )
    .bind(scope_hash)
    .bind(now)
    .bind(policy.window_seconds)
    .bind(max_attempts)
    .bind(policy.lockout_seconds)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    if let Some(blocked_until) = blocked_until.filter(|value| *value > now) {
        return Err(rate_limited(blocked_until - now));
    }
    Ok(())
}

fn normalized_auth_attempt_source(headers: &HeaderMap, policy: &AuthAttemptPolicy) -> String {
    let source = headers
        .get(AUTH_ATTEMPT_SOURCE_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 256)
        .map(str::to_ascii_lowercase);
    if policy.trust_source_header {
        return source.unwrap_or_else(|| "unattributed".to_string());
    }
    let Some(source) = source else {
        return "unattributed".to_string();
    };
    if signed_auth_source_valid(headers, &source, policy) {
        source
    } else {
        "unattributed".to_string()
    }
}

fn signed_auth_source_valid(headers: &HeaderMap, source: &str, policy: &AuthAttemptPolicy) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let Some(key) = policy.source_signing_key.as_deref() else {
        return false;
    };
    let Some(timestamp) = headers
        .get(AUTH_ATTEMPT_SOURCE_TIMESTAMP_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<i64>().ok())
    else {
        return false;
    };
    if unix_now_seconds().abs_diff(timestamp) > 60 {
        return false;
    }
    let Some(signature) = headers
        .get(AUTH_ATTEMPT_SOURCE_SIGNATURE_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(decode_hex_32)
    else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(key) else {
        return false;
    };
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b"\n");
    mac.update(source.as_bytes());
    mac.verify_slice(&signature).is_ok()
}

fn decode_hex_32(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64 {
        return None;
    }
    let mut decoded = [0_u8; 32];
    for (index, byte) in decoded.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(decoded)
}

async fn record_failed_auth_attempt(
    state: &ApiState,
    scope: &AuthAttemptScope,
    account_id: &str,
    operation: &str,
) -> Result<(), ApiError> {
    let now = unix_now_seconds();
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        r#"
        DELETE FROM auth_credential_attempt
        WHERE updated_at < $1
          AND (blocked_until IS NULL OR blocked_until <= $2)
        "#,
    )
    .bind(now - scope.policy.retention_seconds)
    .bind(now)
    .execute(&mut *tx)
    .await?;

    let source_result = upsert_auth_attempt_scope(
        &mut tx,
        scope.source_scope_hash.as_str(),
        now,
        &scope.policy,
        scope.policy.source_max_failures,
    )
    .await?;
    let account_result = match scope.account_scope_hash.as_deref() {
        Some(account_scope_hash) => Some(
            upsert_auth_attempt_scope(
                &mut tx,
                account_scope_hash,
                now,
                &scope.policy,
                scope.policy.account_max_failures,
            )
            .await?,
        ),
        None => None,
    };
    let limited = account_result
        .filter(|(_, blocked_until)| blocked_until.is_some_and(|value| value > now))
        .map(|result| {
            (
                "account",
                scope.account_scope_hash.as_deref().unwrap_or_default(),
                scope.policy.account_max_failures,
                result,
            )
        })
        .or_else(|| {
            (source_result.1.is_some_and(|value| value > now)).then_some((
                "source",
                scope.source_scope_hash.as_str(),
                scope.policy.source_max_failures,
                source_result,
            ))
        });
    if let Some((scope_kind, scope_hash, max_failures, (failure_count, blocked_until))) = limited {
        let blocked_until = blocked_until.unwrap_or(now + scope.policy.lockout_seconds);
        if failure_count == max_failures && scope.account_scope_hash.is_some() {
            record_auth_attempt_rate_limited(
                &mut tx,
                scope,
                scope_hash,
                scope_kind,
                max_failures,
                account_id,
                operation,
                now,
                blocked_until,
            )
            .await?;
        }
        tx.commit().await?;
        return Err(rate_limited(blocked_until - now));
    }
    tx.commit().await?;
    Ok(())
}

async fn upsert_auth_attempt_scope(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    scope_hash: &str,
    now: i64,
    policy: &AuthAttemptPolicy,
    max_failures: i32,
) -> Result<(i32, Option<i64>), ApiError> {
    Ok(sqlx::query_as::<_, (i32, Option<i64>)>(
        r#"
        INSERT INTO auth_credential_attempt (
            scope_hash,
            window_started_at,
            failure_count,
            blocked_until,
            updated_at
        )
        VALUES ($1, $2, 1, NULL, $2)
        ON CONFLICT (scope_hash) DO UPDATE
        SET window_started_at = CASE
                WHEN auth_credential_attempt.window_started_at + $3 <= $2 THEN $2
                ELSE auth_credential_attempt.window_started_at
            END,
            failure_count = CASE
                WHEN auth_credential_attempt.window_started_at + $3 <= $2 THEN 1
                ELSE auth_credential_attempt.failure_count + 1
            END,
            blocked_until = CASE
                WHEN (
                    CASE
                        WHEN auth_credential_attempt.window_started_at + $3 <= $2 THEN 1
                        ELSE auth_credential_attempt.failure_count + 1
                    END
                ) >= $4 THEN $2 + $5
                ELSE NULL
            END,
            updated_at = $2
        RETURNING failure_count, blocked_until
        "#,
    )
    .bind(scope_hash)
    .bind(now)
    .bind(policy.window_seconds)
    .bind(max_failures)
    .bind(policy.lockout_seconds)
    .fetch_one(&mut **tx)
    .await?)
}

async fn blocked_auth_attempt_retry_after(
    pool: &PgPool,
    scope_hash: &str,
    now: i64,
) -> Result<Option<i64>, ApiError> {
    Ok(sqlx::query_scalar::<_, Option<i64>>(
        "SELECT blocked_until FROM auth_credential_attempt WHERE scope_hash = $1",
    )
    .bind(scope_hash)
    .fetch_optional(pool)
    .await?
    .flatten()
    .filter(|blocked_until| *blocked_until > now)
    .map(|blocked_until| blocked_until - now))
}

async fn clear_auth_attempt_failures(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    scope: &AuthAttemptScope,
) -> Result<(), ApiError> {
    sqlx::query("DELETE FROM auth_credential_attempt WHERE scope_hash = $1 OR scope_hash = $2")
        .bind(scope.source_scope_hash.as_str())
        .bind(scope.account_scope_hash.as_deref())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn record_auth_attempt_rate_limited(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    scope: &AuthAttemptScope,
    scope_hash: &str,
    scope_kind: &str,
    max_failures: i32,
    account_id: &str,
    operation: &str,
    now: i64,
    blocked_until: i64,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        SELECT $1,
               'auth_attempt_rate_limited',
               NULL,
               principal_user_id,
               $2,
               NULL,
               $3::JSONB
        FROM auth_account
        WHERE account_id = $4
        "#,
    )
    .bind(now)
    .bind(scope_hash)
    .bind(
        serde_json::json!({
            "account_id": account_id,
            "operation": operation,
            "scope_kind": scope_kind,
            "max_failures": max_failures,
            "account_max_failures": scope.policy.account_max_failures,
            "source_max_failures": scope.policy.source_max_failures,
            "window_seconds": scope.policy.window_seconds,
            "lockout_seconds": scope.policy.lockout_seconds,
            "retention_seconds": scope.policy.retention_seconds,
            "blocked_until": blocked_until,
            "trusted_source_header": scope.policy.trust_source_header
        })
        .to_string(),
    )
    .bind(account_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn auth_attempt_policy_from_env() -> AuthAttemptPolicy {
    let window_seconds = env_i64("FMARCH_AUTH_RATE_LIMIT_WINDOW_SECONDS", 900, 1, 86_400);
    let lockout_seconds = env_i64("FMARCH_AUTH_RATE_LIMIT_LOCKOUT_SECONDS", 900, 1, 86_400);
    let minimum_retention = window_seconds.max(lockout_seconds);
    AuthAttemptPolicy {
        account_max_failures: env_i64("FMARCH_AUTH_RATE_LIMIT_MAX_FAILURES", 5, 2, 100) as i32,
        source_max_failures: env_i64("FMARCH_AUTH_SOURCE_RATE_LIMIT_MAX_FAILURES", 50, 2, 10_000)
            as i32,
        registration_max_per_source: env_i64("FMARCH_AUTH_REGISTRATION_SOURCE_LIMIT", 5, 2, 10_000)
            as i32,
        window_seconds,
        lockout_seconds,
        retention_seconds: env_i64(
            "FMARCH_AUTH_RATE_LIMIT_RETENTION_SECONDS",
            minimum_retention.saturating_mul(4),
            minimum_retention,
            31_536_000,
        ),
        trust_source_header: std::env::var("FMARCH_TRUST_AUTH_SOURCE_HEADER")
            .ok()
            .as_deref()
            == Some("1"),
        source_signing_key: std::env::var("FMARCH_AUTH_SOURCE_SIGNING_KEY")
            .ok()
            .filter(|value| value.as_bytes().len() >= 32)
            .map(|value| Arc::<[u8]>::from(value.into_bytes())),
    }
}

fn auth_session_rotation_max_age_seconds() -> i64 {
    env_i64(
        "FMARCH_AUTH_SESSION_ROTATION_MAX_AGE_SECONDS",
        86_400,
        60,
        604_800,
    )
}

fn auth_recent_max_age_seconds() -> i64 {
    env_i64("FMARCH_AUTH_RECENT_SECONDS", 600, 60, 86_400)
}

fn require_classic_enabled(state: &ApiState) -> Result<(), ApiError> {
    if state.classic_enabled {
        Ok(())
    } else {
        Err(ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::NotAuthorized,
            message: "classic authentication is disabled".to_string(),
        })
    }
}

fn require_recent_authentication(
    identity: &AuthenticatedIdentity,
    now: i64,
) -> Result<(), ApiError> {
    let authenticated_at = identity
        .authenticated_at
        .ok_or(identity::IdentityFlowError::RecentAuthRequired)?;
    identity::methods::require_recent_authentication(
        authenticated_at,
        now,
        auth_recent_max_age_seconds(),
    )?;
    Ok(())
}

fn env_i64(name: &str, default: i64, minimum: i64, maximum: i64) -> i64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(default)
        .clamp(minimum, maximum)
}

async fn authenticated_account_principal_for_update(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    caller_hash: &str,
    account_id: &str,
    current_password: &str,
    now: i64,
) -> Result<String, ApiError> {
    let caller_principal_user_id = sqlx::query_scalar::<_, String>(
        r#"
        SELECT principal_user_id
        FROM auth_session
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > $2
        FOR UPDATE
        "#,
    )
    .bind(caller_hash)
    .bind(now)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(unauthorized_session)?;
    let account = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT principal_user_id, password_hash
        FROM auth_account
        WHERE account_id = $1
          AND disabled_at IS NULL
        FOR UPDATE
        "#,
    )
    .bind(account_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(unauthorized_account)?;
    if account.0 != caller_principal_user_id
        || !verify_account_password(account.1.as_str(), current_password).await?
    {
        return Err(unauthorized_account());
    }
    Ok(caller_principal_user_id)
}

async fn deliver_auth_credential(
    state: &ApiState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    delivery_kind: IdentityDeliveryKind,
    account_id: &str,
    principal_user_id: &str,
    credential_hash: &str,
    credential_material: &str,
    credential_expires_at: i64,
    now: i64,
) -> Result<AuthDeliveryReceipt, ApiError> {
    let delivery_id = Uuid::new_v4();
    let provider_id = state.identity_delivery_gateway.provider_id().to_string();
    let credential_envelope = eventstore::encrypt_delivery_credential(
        credential_material,
        &delivery_aad(delivery_id, delivery_kind),
    )
    .map_err(|error| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: format!("identity delivery payload could not be sealed: {error}"),
    })?;
    sqlx::query(
        r#"
        INSERT INTO auth_delivery_intent (
            delivery_id,
            delivery_kind,
            account_id,
            principal_user_id,
            credential_hash,
            credential_expires_at,
            credential_envelope,
            status,
            provider_id,
            outcome_kind,
            outcome_code,
            attempt_count,
            next_attempt_at,
            delivered_at,
            last_error,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB, 'queued', $8, 'queued', NULL, 0, $9, NULL, NULL, $9, $9)
        "#,
    )
    .bind(delivery_id)
    .bind(delivery_kind.as_str())
    .bind(account_id)
    .bind(principal_user_id)
    .bind(credential_hash)
    .bind(credential_expires_at)
    .bind(credential_envelope.to_string())
    .bind(&provider_id)
    .bind(now)
    .execute(&mut **tx)
    .await?;
    record_auth_delivery_audit(
        tx,
        "auth_delivery_queued",
        delivery_kind.as_str(),
        account_id,
        principal_user_id,
        principal_user_id,
        credential_hash,
        delivery_id,
        now,
        provider_id.as_str(),
        "queued",
        None,
    )
    .await?;
    Ok(AuthDeliveryReceipt {
        delivery_id,
        status: "queued".to_string(),
        attempt_count: 0,
        provider_id,
        outcome_kind: "queued".to_string(),
        outcome_code: None,
    })
}

async fn cancel_auth_delivery_intent(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    credential_hash: &str,
    actor_user_id: Option<&str>,
    outcome_code: &str,
    now: i64,
) -> Result<i64, ApiError> {
    let cancelled = sqlx::query_as::<_, (Uuid, String, String, String, String)>(
        r#"
        UPDATE auth_delivery_intent
        SET status = 'cancelled',
            outcome_kind = 'cancelled',
            outcome_code = $2,
            next_attempt_at = NULL,
            delivered_at = NULL,
            last_error = $2,
            provider_receipt_id = NULL,
            claim_token = NULL,
            claim_expires_at = NULL,
            credential_envelope = NULL,
            updated_at = $3
        WHERE credential_hash = $1
          AND status IN ('queued', 'retryable_failed', 'processing')
        RETURNING delivery_id, delivery_kind, account_id, principal_user_id, provider_id
        "#,
    )
    .bind(credential_hash)
    .bind(outcome_code)
    .bind(now)
    .fetch_all(&mut **tx)
    .await?;
    for (delivery_id, delivery_kind, account_id, principal_user_id, provider_id) in &cancelled {
        record_auth_delivery_audit(
            tx,
            "auth_delivery_cancelled",
            delivery_kind.as_str(),
            account_id.as_str(),
            actor_user_id.unwrap_or(principal_user_id.as_str()),
            principal_user_id.as_str(),
            credential_hash,
            *delivery_id,
            now,
            provider_id.as_str(),
            "cancelled",
            Some(outcome_code),
        )
        .await?;
    }
    Ok(cancelled.len() as i64)
}

async fn record_auth_delivery_audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event_kind: &str,
    delivery_kind: &str,
    account_id: &str,
    actor_user_id: &str,
    principal_user_id: &str,
    credential_hash: &str,
    delivery_id: Uuid,
    now: i64,
    provider_id: &str,
    outcome_kind: &str,
    outcome_code: Option<&str>,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, $2, $3, $4, $5, NULL, $6::JSONB)
        "#,
    )
    .bind(now)
    .bind(event_kind)
    .bind(actor_user_id)
    .bind(principal_user_id)
    .bind(credential_hash)
    .bind(
        serde_json::json!({
            "delivery_id": delivery_id,
            "delivery_kind": delivery_kind,
            "account_id": account_id,
            "adapter": provider_id,
            "provider_id": provider_id,
            "outcome_kind": outcome_kind,
            "outcome_code": outcome_code
        })
        .to_string(),
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn record_account_recovery_rejection(
    pool: &PgPool,
    account_id: &str,
    recovery_hash: &str,
    now: i64,
) -> Result<(), ApiError> {
    let principal_user_id = sqlx::query_scalar::<_, String>(
        "SELECT principal_user_id FROM auth_account WHERE account_id = $1",
    )
    .bind(account_id)
    .fetch_optional(pool)
    .await?;
    let Some(principal_user_id) = principal_user_id else {
        return Ok(());
    };
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_user_id,
            principal_user_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, 'account_recovery_rejected', NULL, $2, $3, NULL, $4::JSONB)
        "#,
    )
    .bind(now)
    .bind(principal_user_id)
    .bind(recovery_hash)
    .bind(
        serde_json::json!({
            "account_id": account_id,
            "reason": "invalid_expired_revoked_or_used"
        })
        .to_string(),
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn require_global_admin(
    state: &ApiState,
    token: &str,
    action: &str,
) -> Result<String, ApiError> {
    let (principal_user_id, global_capabilities) =
        active_session_principal_and_globals(state, token).await?;
    if !global_capabilities
        .iter()
        .any(|capability| capability == "GlobalAdmin")
    {
        return Err(ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: format!("{action} requires GlobalAdmin"),
        });
    }
    Ok(principal_user_id)
}

async fn require_global_operator(
    state: &ApiState,
    token: &str,
    action: &str,
) -> Result<String, ApiError> {
    let (principal_user_id, global_capabilities) =
        active_session_principal_and_globals(state, token).await?;
    if !global_capabilities
        .iter()
        .any(|capability| matches!(capability.as_str(), "GlobalAdmin" | "GlobalMod"))
    {
        return Err(ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: format!("{action} requires GlobalAdmin or GlobalMod"),
        });
    }
    Ok(principal_user_id)
}

fn unauthorized_session() -> ApiError {
    ApiError::Reject {
        status: StatusCode::UNAUTHORIZED,
        error: RejectCode::NotAuthorized,
        message: "session token is missing, expired, or revoked".to_string(),
    }
}

fn unauthorized_invite() -> ApiError {
    ApiError::Reject {
        status: StatusCode::UNAUTHORIZED,
        error: RejectCode::NotAuthorized,
        message: "invite token is missing, expired, revoked, or already redeemed".to_string(),
    }
}

fn unauthorized_account() -> ApiError {
    ApiError::Reject {
        status: StatusCode::UNAUTHORIZED,
        error: RejectCode::NotAuthorized,
        message: "account credentials are missing, disabled, or invalid".to_string(),
    }
}

fn unauthorized_account_recovery() -> ApiError {
    ApiError::Reject {
        status: StatusCode::UNAUTHORIZED,
        error: RejectCode::NotAuthorized,
        message: "account recovery credential is missing, expired, revoked, used, or invalid"
            .to_string(),
    }
}

fn rate_limited(retry_after_seconds: i64) -> ApiError {
    ApiError::RateLimited {
        retry_after_seconds,
        message: "too many credential attempts; wait before trying again".to_string(),
    }
}

fn account_not_found() -> ApiError {
    ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::NotAuthorized,
        message: "account was not found".to_string(),
    }
}

fn reject_stale_account_lifecycle(
    expected_disabled: Option<bool>,
    actual_disabled: bool,
    account_id: &str,
    action: &str,
) -> Result<(), ApiError> {
    if let Some(expected_disabled) = expected_disabled {
        if expected_disabled != actual_disabled {
            return Err(ApiError::Reject {
                status: StatusCode::CONFLICT,
                error: RejectCode::StreamConflict,
                message: format!(
                    "stale account lifecycle state for {account_id}; refresh and use current account controls before {action}"
                ),
            });
        }
    }
    Ok(())
}

fn default_revoke_account_sessions() -> bool {
    true
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
    identity::token::hash_token(token)
}

async fn hash_account_password(password: &str) -> Result<String, ApiError> {
    let password = password.to_string();
    tokio::task::spawn_blocking(move || {
        identity::password::hash_password_sync(password.as_str()).map_err(ApiError::from)
    })
    .await
    .map_err(|error| {
        internal_auth_error(format!("account password hashing task failed: {error}"))
    })?
}

async fn verify_account_password(encoded_hash: &str, password: &str) -> Result<bool, ApiError> {
    let encoded_hash = encoded_hash.to_string();
    let password = password.to_string();
    tokio::task::spawn_blocking(move || {
        identity::password::verify_password_sync(encoded_hash.as_str(), password.as_str())
    })
    .await
    .map_err(|error| {
        internal_auth_error(format!(
            "account password verification task failed: {error}"
        ))
    })
}

fn dummy_account_password_hash() -> &'static str {
    identity::password::dummy_password_hash()
}

async fn consume_dummy_password_verification(password: &str) -> Result<(), ApiError> {
    let _ = verify_account_password(dummy_account_password_hash(), password).await?;
    Ok(())
}

fn validate_new_account_password(password: &str) -> Result<(), ApiError> {
    if !(12..=1024).contains(&password.len()) {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "account passwords must contain 12 to 1024 bytes".to_string(),
        });
    }
    Ok(())
}

fn normalize_registration_account_id(value: &str) -> Result<String, ApiError> {
    let account_id = value.trim();
    let Some((local, domain)) = account_id.split_once('@') else {
        return Err(invalid_registration_account_id());
    };
    if account_id.len() > 320
        || local.is_empty()
        || local.len() > 64
        || domain.is_empty()
        || domain.len() > 255
        || domain.contains('@')
        || !local
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'+' | b'-'))
        || !valid_registration_domain(domain)
    {
        return Err(invalid_registration_account_id());
    }
    Ok(account_id.to_ascii_lowercase())
}

fn valid_registration_domain(domain: &str) -> bool {
    domain.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    })
}

fn invalid_registration_account_id() -> ApiError {
    ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::Internal,
        message: "account registration requires a valid email-style account_id".to_string(),
    }
}

fn validate_account_password_input(password: &str) -> Result<(), ApiError> {
    if password.len() > 1024 {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "account passwords cannot exceed 1024 bytes".to_string(),
        });
    }
    Ok(())
}

fn internal_auth_error(message: String) -> ApiError {
    ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message,
    }
}

fn unix_now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

enum PostMediaPreparationError {
    Invalid,
    Store(MediaError),
    Invariant(&'static str),
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
    let store = state.media_store.clone();
    let limits = state.variant_limits;
    let prepared = tokio::task::spawn_blocking(move || {
        let mut content_ids = BTreeSet::new();
        let mut prepared = Vec::with_capacity(requested.len());
        for item in requested {
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
            let set = store
                .lookup_variant_set(id, limits)
                .map_err(PostMediaPreparationError::Store)?
                .ok_or(PostMediaPreparationError::Invalid)?;
            let mut dimensions = BTreeMap::<String, (u32, u32, usize)>::new();
            for record in set.variants() {
                let key = record.key().kind().to_string();
                let entry = dimensions
                    .entry(key)
                    .or_insert((record.width(), record.height(), 0));
                if (entry.0, entry.1) != (record.width(), record.height()) {
                    return Err(PostMediaPreparationError::Invariant(
                        "variant formats disagree on dimensions",
                    ));
                }
                entry.2 += 1;
            }
            let variants = ["thumb", "tablet", "full-bounded"]
                .into_iter()
                .map(|kind| {
                    let Some((width, height, count)) = dimensions.remove(kind) else {
                        return Err(PostMediaPreparationError::Invariant(
                            "fixed variant role is missing",
                        ));
                    };
                    if count != VariantFormat::ALL.len() {
                        return Err(PostMediaPreparationError::Invariant(
                            "fixed variant format is missing",
                        ));
                    }
                    Ok((
                        kind.to_string(),
                        commands::ThreadPostMediaVariant { width, height },
                    ))
                })
                .collect::<Result<BTreeMap<_, _>, _>>()?;
            if !dimensions.is_empty() {
                return Err(PostMediaPreparationError::Invariant(
                    "unexpected variant role is present",
                ));
            }
            prepared.push(commands::ThreadPostMedia {
                content_id: id.to_string(),
                alt: item.alt.trim().to_string(),
                variants,
            });
        }
        Ok(prepared)
    })
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "post media preparation worker failed");
        commands::Reject::Internal("post media preparation failed".to_string())
    })?
    .map_err(|error| match error {
        PostMediaPreparationError::Invalid => commands::Reject::InvalidTarget,
        PostMediaPreparationError::Store(error) => {
            tracing::error!(error = %error, "post media lookup failed");
            commands::Reject::Internal("post media lookup failed".to_string())
        }
        PostMediaPreparationError::Invariant(message) => {
            tracing::error!(message, "post media invariant failed");
            commands::Reject::Internal("post media lookup failed".to_string())
        }
    })?;
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
        if let Err(error) = require_global_admin(&state, token, "game creation").await {
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
        Some(game) => current_votecount_rows(&state, game).await.ok(),
        None => None,
    };
    let principal = Principal::user(principal_user_id);
    let prepared_command = prepare_command_media(&state, msg.command.into()).await;
    let body = match prepared_command {
        Err(reject) => ServerMsg::Reject(RejectMsg::from(reject)),
        Ok(command) => {
            match commands::handle_idempotent(&state.pool, &principal, msg.command_id, command)
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
                            player_command_state_dirty,
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

async fn publish_live_projection_change(
    state: &ApiState,
    game: Uuid,
    previous: Option<Vec<VoteCountDelta>>,
    thread_dirty: bool,
    host_console_dirty: bool,
    host_prompts_dirty: bool,
    player_private_dirty: bool,
    player_command_state_dirty: bool,
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
        && !player_command_state_dirty
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
        player_command_state_dirty,
    });
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
    require_global_admin(&state, token, "completed-game import").await?;
    Ok(Json(
        projections::import_completed_game_export(&state.pool, &export).await?,
    ))
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

#[derive(Debug, Clone, Deserialize)]
struct PublicSearchQuery {
    q: String,
    filter: Option<String>,
    cursor: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct CommunityInboxQuery {
    before_seq: Option<i64>,
    limit: Option<i64>,
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
    require_global_operator(&state, token, "admin game discovery").await?;
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
    require_global_admin(&state, token, "game bootstrap").await?;
    Ok(Json(AdminGameBootstrapResponse {
        packs: product_pack_catalog()?,
    }))
}

async fn public_game_thread(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<ThreadQuery>,
) -> Result<Json<PublicGameThreadPage>, ApiError> {
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
    )
    .await?;
    Ok(Json(PublicGameThreadPage {
        game: GameIndexEntry::from(game_row),
        posts: page.posts.into_iter().map(ThreadPost::from).collect(),
        next_before_seq: page.next_before_seq,
    }))
}

async fn subscription_target_state(
    State(state): State<ApiState>,
    Path((target_kind, scope_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<SubscriptionTargetState>, ApiError> {
    let principal_user_id = authenticated_community_member(&state, &headers).await?;
    let target = subscription_target(target_kind.as_str(), scope_id)?;
    Ok(Json(
        projections::subscription_target_state(&state.pool, principal_user_id.as_str(), target)
            .await
            .map_err(subscription_projection_api_error)?
            .into(),
    ))
}

async fn subscribe_to_target(
    State(state): State<ApiState>,
    Path((target_kind, scope_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<SubscriptionTargetState>, ApiError> {
    let principal_user_id = authenticated_community_member(&state, &headers).await?;
    let target = subscription_target(target_kind.as_str(), scope_id)?;
    let state = projections::subscribe_to_public_target(
        &state.pool,
        target,
        principal_user_id.as_str(),
        unix_now_seconds(),
    )
    .await
    .map_err(subscription_projection_api_error)?;
    Ok(Json(state.into()))
}

async fn unsubscribe_from_target(
    State(state): State<ApiState>,
    Path((target_kind, scope_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<SubscriptionTargetState>, ApiError> {
    let principal_user_id = authenticated_community_member(&state, &headers).await?;
    let target = subscription_target(target_kind.as_str(), scope_id)?;
    let state = projections::unsubscribe_from_public_target(
        &state.pool,
        target,
        principal_user_id.as_str(),
        unix_now_seconds(),
    )
    .await
    .map_err(subscription_projection_api_error)?;
    Ok(Json(state.into()))
}

async fn advance_subscription_read(
    State(state): State<ApiState>,
    Path((target_kind, scope_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(request): Json<AdvanceSubscriptionReadRequest>,
) -> Result<Json<SubscriptionTargetState>, ApiError> {
    let principal_user_id = authenticated_community_member(&state, &headers).await?;
    let target = subscription_target(target_kind.as_str(), scope_id)?;
    let state = projections::advance_subscription_read_cursor(
        &state.pool,
        target,
        principal_user_id.as_str(),
        request.read_through_seq,
        unix_now_seconds(),
    )
    .await
    .map_err(subscription_projection_api_error)?;
    Ok(Json(state.into()))
}

async fn community_inbox(
    State(state): State<ApiState>,
    Query(query): Query<CommunityInboxQuery>,
    headers: HeaderMap,
) -> Result<Json<CommunityInboxPage>, ApiError> {
    let principal_user_id = authenticated_community_member(&state, &headers).await?;
    if query.before_seq.is_some_and(|seq| seq <= 0) {
        return Err(subscription_bad_request(
            "inbox before_seq must be a positive event sequence",
        ));
    }
    Ok(Json(
        projections::community_inbox(
            &state.pool,
            principal_user_id.as_str(),
            query.before_seq,
            query.limit.unwrap_or(50),
        )
        .await?
        .into(),
    ))
}

async fn authenticated_community_member(
    state: &ApiState,
    headers: &HeaderMap,
) -> Result<String, ApiError> {
    let token = bearer_token(headers).ok_or_else(unauthorized_account)?;
    require_active_enabled_account(state, token).await
}

fn subscription_target(
    target_kind: &str,
    scope_id: Uuid,
) -> Result<community::SubscriptionTarget, ApiError> {
    Ok(community::SubscriptionTarget {
        kind: community::SubscriptionTargetKind::parse(target_kind)
            .map_err(|_| subscription_bad_request("invalid subscription target kind"))?,
        scope_id,
    })
}

fn subscription_projection_api_error(error: projections::ProjectionError) -> ApiError {
    match error {
        projections::ProjectionError::SubscriptionTargetNotPublic => ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::Internal,
            message: "subscription target is not public".to_string(),
        },
        projections::ProjectionError::AlreadySubscribed => ApiError::Reject {
            status: StatusCode::CONFLICT,
            error: RejectCode::Internal,
            message: "member is already subscribed to this target".to_string(),
        },
        projections::ProjectionError::NotSubscribed => ApiError::Reject {
            status: StatusCode::CONFLICT,
            error: RejectCode::Internal,
            message: "member is not subscribed to this target".to_string(),
        },
        projections::ProjectionError::InvalidSubscriptionReadCursor => {
            subscription_bad_request("read cursor must advance within the public target")
        }
        projections::ProjectionError::Store(eventstore::StoreError::Conflict { .. }) => {
            ApiError::Reject {
                status: StatusCode::CONFLICT,
                error: RejectCode::StreamConflict,
                message: "subscription changed concurrently; refresh and try again".to_string(),
            }
        }
        error => ApiError::Projection(error),
    }
}

fn subscription_bad_request(message: &str) -> ApiError {
    ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::Internal,
        message: message.to_string(),
    }
}

async fn public_search(
    State(state): State<ApiState>,
    Query(query): Query<PublicSearchQuery>,
) -> Result<Json<PublicSearchPage>, ApiError> {
    let normalized_query = query.q.trim();
    if normalized_query.chars().count() < 2 || normalized_query.chars().count() > 200 {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "search query must contain between 2 and 200 characters".to_string(),
        });
    }
    let (filter, filter_label) = match query.filter.as_deref().unwrap_or("all") {
        "all" => (projections::PublicSearchFilter::All, "all"),
        "discussions" => (projections::PublicSearchFilter::Discussions, "discussions"),
        "profiles" => (projections::PublicSearchFilter::Profiles, "profiles"),
        "games" => (projections::PublicSearchFilter::Games, "games"),
        _ => {
            return Err(ApiError::Reject {
                status: StatusCode::BAD_REQUEST,
                error: RejectCode::Internal,
                message: "search filter must be all, discussions, profiles, or games".to_string(),
            })
        }
    };
    let cursor = query
        .cursor
        .as_deref()
        .map(parse_public_search_cursor)
        .transpose()?;
    let page = projections::public_search(
        &state.pool,
        normalized_query,
        filter,
        cursor,
        query.limit.unwrap_or(20),
    )
    .await?;
    Ok(Json(PublicSearchPage {
        query: normalized_query.to_string(),
        filter: filter_label.to_string(),
        results: page
            .results
            .into_iter()
            .map(PublicSearchResult::from)
            .collect(),
        next_cursor: page.next_cursor.map(|cursor| {
            format!(
                "{}:{}:{}:{}",
                cursor.rank, cursor.updated_seq, cursor.document_kind, cursor.document_key
            )
        }),
    }))
}

fn parse_public_search_cursor(value: &str) -> Result<projections::PublicSearchCursor, ApiError> {
    let mut parts = value.splitn(4, ':');
    let rank = parts
        .next()
        .ok_or_else(invalid_public_search_cursor)?
        .parse::<i64>()
        .map_err(|_| invalid_public_search_cursor())?;
    let updated_seq = parts
        .next()
        .ok_or_else(invalid_public_search_cursor)?
        .parse::<i64>()
        .map_err(|_| invalid_public_search_cursor())?;
    let document_kind = parts
        .next()
        .ok_or_else(invalid_public_search_cursor)?
        .to_string();
    let document_key = parts
        .next()
        .filter(|part| !part.is_empty())
        .ok_or_else(invalid_public_search_cursor)?;
    if !matches!(
        document_kind.as_str(),
        "discussion_topic" | "discussion_post" | "profile" | "game" | "game_post"
    ) {
        return Err(invalid_public_search_cursor());
    }
    Ok(projections::PublicSearchCursor {
        rank,
        updated_seq,
        document_kind,
        document_key: document_key.to_string(),
    })
}

fn invalid_public_search_cursor() -> ApiError {
    ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::StreamConflict,
        message: "invalid search cursor; restart the search and try again".to_string(),
    }
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
struct DiscussionPageQuery {
    cursor: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct DiscussionPostQuery {
    before_seq: Option<i64>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateDiscussionAreaRequest {
    slug: String,
    title: String,
    description: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateDiscussionTopicRequest {
    title: String,
    body: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateDiscussionPostRequest {
    body: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ModerateDiscussionTopicRequest {
    posting_state: Option<String>,
    visibility: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct SubmitModerationReportRequest {
    target_kind: String,
    scope_id: Uuid,
    source_seq: i64,
    reason_family: String,
    #[serde(default)]
    details: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ModerationCaseQuery {
    status: Option<String>,
    cursor: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct ModerateCaseRequest {
    action: String,
    reason: String,
}

async fn discussion_areas(
    State(state): State<ApiState>,
) -> Result<Json<Vec<DiscussionArea>>, ApiError> {
    Ok(Json(
        projections::discussion_areas(&state.pool)
            .await?
            .into_iter()
            .map(DiscussionArea::from)
            .collect(),
    ))
}

async fn discussion_area_topics(
    State(state): State<ApiState>,
    Path(slug): Path<String>,
    Query(query): Query<DiscussionPageQuery>,
) -> Result<Json<DiscussionTopicPage>, ApiError> {
    let area = projections::discussion_area_by_slug(&state.pool, slug.as_str())
        .await?
        .ok_or_else(|| discussion_not_found("discussion area"))?;
    let cursor = query
        .cursor
        .as_deref()
        .map(parse_discussion_topic_cursor)
        .transpose()?;
    let page = projections::discussion_topics(
        &state.pool,
        area.area_id,
        cursor,
        query.limit.unwrap_or(20),
    )
    .await?;
    Ok(Json(DiscussionTopicPage {
        area: DiscussionArea::from(area),
        topics: page.topics.into_iter().map(DiscussionTopic::from).collect(),
        next_cursor: page
            .next_cursor
            .map(|cursor| format!("{}:{}", cursor.updated_seq, cursor.topic_id)),
    }))
}

async fn discussion_topic_thread(
    State(state): State<ApiState>,
    Path((slug, topic)): Path<(String, Uuid)>,
    Query(query): Query<DiscussionPostQuery>,
) -> Result<Json<DiscussionThreadPage>, ApiError> {
    let area = projections::discussion_area_by_slug(&state.pool, slug.as_str())
        .await?
        .ok_or_else(|| discussion_not_found("discussion area"))?;
    let topic = visible_discussion_topic(&state, topic).await?;
    if topic.area_id != area.area_id {
        return Err(discussion_not_found("discussion topic"));
    }
    let page = projections::discussion_posts(
        &state.pool,
        topic.topic_id,
        query.before_seq,
        query.limit.unwrap_or(50),
    )
    .await?;
    Ok(Json(DiscussionThreadPage {
        area: DiscussionArea::from(area),
        topic: DiscussionTopic::from(topic),
        posts: page.posts.into_iter().map(DiscussionPost::from).collect(),
        next_before_seq: page.next_before_seq,
    }))
}

async fn create_discussion_area(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<CreateDiscussionAreaRequest>,
) -> Result<(StatusCode, Json<DiscussionArea>), ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let principal_user_id = require_global_mod(&state, token, "discussion area creation").await?;
    let slug = validate_discussion_slug(request.slug.as_str())?;
    let title = validate_discussion_text(request.title.as_str(), "discussion area title", 160)?;
    let description = validate_discussion_text(
        request.description.as_str(),
        "discussion area description",
        500,
    )?;
    if projections::discussion_area_by_slug(&state.pool, slug.as_str())
        .await?
        .is_some()
    {
        return Err(discussion_conflict(
            "discussion area already exists; choose a new area slug",
        ));
    }
    let area_id = Uuid::new_v4();
    let created = community::AreaCreated {
        slug: slug.clone(),
        title,
        description,
    };
    projections::append_discussion_and_project(
        &state.pool,
        area_id,
        &[EventInput::new(
            created.kind(),
            1,
            created.payload(),
            ActorId::User(principal_user_id),
            unix_now_seconds(),
        )],
    )
    .await?;
    let area = projections::discussion_area_by_slug(&state.pool, slug.as_str())
        .await?
        .expect("projected discussion area is readable");
    Ok((StatusCode::CREATED, Json(DiscussionArea::from(area))))
}

async fn create_discussion_topic(
    State(state): State<ApiState>,
    Path(slug): Path<String>,
    headers: HeaderMap,
    Json(request): Json<CreateDiscussionTopicRequest>,
) -> Result<(StatusCode, Json<DiscussionTopic>), ApiError> {
    let profile = authenticated_discussion_profile(&state, &headers).await?;
    let area = projections::discussion_area_by_slug(&state.pool, slug.as_str())
        .await?
        .ok_or_else(|| discussion_not_found("discussion area"))?;
    let title = validate_discussion_text(request.title.as_str(), "discussion topic title", 180)?;
    let body = validate_discussion_text(request.body.as_str(), "discussion post", 10_000)?;
    let topic_id = Uuid::new_v4();
    let events = community::decide_topic(
        None,
        community::TopicCommand::Create {
            topic_id,
            area_id: area.area_id,
            title,
            opening_body: body,
            author_profile_id: profile.profile_id,
        },
    )
    .map_err(community_reject_api_error)?;
    append_community_events(&state.pool, topic_id, 0, events, profile.principal_user_id).await?;
    let topic = projections::discussion_topic_by_id(&state.pool, topic_id)
        .await?
        .expect("projected discussion topic is readable");
    Ok((StatusCode::CREATED, Json(DiscussionTopic::from(topic))))
}

async fn create_discussion_post(
    State(state): State<ApiState>,
    Path(topic): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<CreateDiscussionPostRequest>,
) -> Result<(StatusCode, Json<DiscussionTopic>), ApiError> {
    let profile = authenticated_discussion_profile(&state, &headers).await?;
    let current = projections::discussion_topic_by_id(&state.pool, topic)
        .await?
        .ok_or_else(|| discussion_not_found("discussion topic"))?;
    let body = validate_discussion_text(request.body.as_str(), "discussion post", 10_000)?;
    let topic_state = community_topic_state(&current)?;
    let events = community::decide_topic(
        Some(&topic_state),
        community::TopicCommand::SubmitPost {
            body,
            author_profile_id: profile.profile_id,
        },
    )
    .map_err(community_reject_api_error)?;
    append_community_events(
        &state.pool,
        topic,
        current.version,
        events,
        profile.principal_user_id,
    )
    .await?;
    let topic = projections::discussion_topic_by_id(&state.pool, topic)
        .await?
        .expect("projected discussion topic is readable");
    Ok((StatusCode::CREATED, Json(DiscussionTopic::from(topic))))
}

async fn moderate_discussion_topic(
    State(state): State<ApiState>,
    Path(topic): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<ModerateDiscussionTopicRequest>,
) -> Result<Json<DiscussionTopic>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let principal_user_id = require_global_mod(&state, token, "discussion moderation").await?;
    let current = projections::discussion_topic_by_id(&state.pool, topic)
        .await?
        .ok_or_else(|| discussion_not_found("discussion topic"))?;
    let topic_state = community_topic_state(&current)?;
    let command =
        match (
            request.posting_state.as_deref(),
            request.visibility.as_deref(),
        ) {
            (Some(posting_state), None) => community::TopicCommand::SetPostingState {
                posting_state: community::PostingState::parse(posting_state)
                    .map_err(community_reject_api_error)?,
            },
            (None, Some(visibility)) => community::TopicCommand::SetVisibility {
                visibility: community::TopicVisibility::parse(visibility)
                    .map_err(community_reject_api_error)?,
            },
            _ => return Err(ApiError::Reject {
                status: StatusCode::BAD_REQUEST,
                error: RejectCode::Internal,
                message:
                    "discussion moderation must change exactly one of posting_state or visibility"
                        .to_string(),
            }),
        };
    let events =
        community::decide_topic(Some(&topic_state), command).map_err(community_reject_api_error)?;
    append_community_events(
        &state.pool,
        topic,
        current.version,
        events,
        principal_user_id,
    )
    .await?;
    let topic = projections::discussion_topic_by_id(&state.pool, topic)
        .await?
        .expect("projected discussion topic is readable");
    Ok(Json(DiscussionTopic::from(topic)))
}

async fn submit_moderation_report(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<SubmitModerationReportRequest>,
) -> Result<(StatusCode, Json<ModerationReportReceipt>), ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_account)?;
    let principal_user_id = require_active_enabled_account(&state, token).await?;
    if request.source_seq <= 0 {
        return Err(moderation_bad_request("report source_seq must be positive"));
    }
    let details = request.details.trim();
    if details.len() > 1_000 {
        return Err(moderation_bad_request(
            "report details must contain at most 1000 bytes",
        ));
    }
    let target = community::ModerationTarget {
        kind: community::ModerationTargetKind::parse(request.target_kind.as_str())
            .map_err(moderation_reject_api_error)?,
        scope_id: request.scope_id,
        source_seq: request.source_seq,
    };
    let reason = community::ReportReasonFamily::parse(request.reason_family.as_str())
        .map_err(moderation_reject_api_error)?;
    let receipt = projections::submit_moderation_report(
        &state.pool,
        target,
        Uuid::new_v4(),
        principal_user_id.as_str(),
        reason,
        details.to_string(),
        unix_now_seconds(),
    )
    .await
    .map_err(moderation_projection_api_error)?;
    Ok((StatusCode::CREATED, Json(receipt.into())))
}

async fn moderation_report_receipt(
    State(state): State<ApiState>,
    Path(report): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<ModerationReportReceipt>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_account)?;
    let principal_user_id = require_active_enabled_account(&state, token).await?;
    let receipt =
        projections::moderation_report_receipt(&state.pool, report, principal_user_id.as_str())
            .await?
            .ok_or_else(|| discussion_not_found("moderation report receipt"))?;
    Ok(Json(receipt.into()))
}

async fn moderation_cases(
    State(state): State<ApiState>,
    Query(query): Query<ModerationCaseQuery>,
    headers: HeaderMap,
) -> Result<Json<ModerationCasePage>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    require_global_mod(&state, token, "moderation queue access").await?;
    let status = match query.status.as_deref().unwrap_or("open") {
        "all" => None,
        value => {
            community::ModerationCaseStatus::parse(value).map_err(moderation_reject_api_error)?;
            Some(value)
        }
    };
    let cursor = query
        .cursor
        .as_deref()
        .map(parse_moderation_case_cursor)
        .transpose()?;
    let page =
        projections::moderation_cases(&state.pool, status, cursor, query.limit.unwrap_or(25))
            .await?;
    Ok(Json(ModerationCasePage {
        cases: page.cases.into_iter().map(ModerationCase::from).collect(),
        next_cursor: page
            .next_cursor
            .map(|cursor| format!("{}:{}", cursor.updated_seq, cursor.case_id)),
    }))
}

async fn moderation_case(
    State(state): State<ApiState>,
    Path(case): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<ModerationCaseDetail>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    require_global_mod(&state, token, "moderation case access").await?;
    let detail = projections::moderation_case_by_id(&state.pool, case)
        .await?
        .ok_or_else(|| discussion_not_found("moderation case"))?;
    Ok(Json(detail.into()))
}

async fn moderate_case(
    State(state): State<ApiState>,
    Path(case): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<ModerateCaseRequest>,
) -> Result<Json<ModerationCaseDetail>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let principal_user_id = require_global_mod(&state, token, "moderation case action").await?;
    let reason = validate_discussion_text(request.reason.as_str(), "moderation reason", 500)?;
    let current = projections::moderation_case_state(&state.pool, case)
        .await?
        .ok_or_else(|| discussion_not_found("moderation case"))?;
    let command = match request.action.as_str() {
        "hide" => community::ModerationCommand::Hide { reason },
        "dismiss" => community::ModerationCommand::Dismiss { reason },
        "restore" => community::ModerationCommand::Restore { reason },
        _ => {
            return Err(moderation_bad_request(
                "moderation action must be hide, dismiss, or restore",
            ))
        }
    };
    let events = community::decide_moderation(Some(&current), command)
        .map_err(moderation_reject_api_error)?;
    match projections::append_moderation_and_project_expected(
        &state.pool,
        case,
        current.version,
        events,
        principal_user_id.as_str(),
        unix_now_seconds(),
    )
    .await
    {
        Ok(()) => {}
        Err(projections::ProjectionError::Store(eventstore::StoreError::Conflict { .. })) => {
            return Err(discussion_conflict(
                "moderation case changed concurrently; refresh and try again",
            ));
        }
        Err(error) => return Err(ApiError::Projection(error)),
    }
    let detail = projections::moderation_case_by_id(&state.pool, case)
        .await?
        .expect("actioned moderation case is readable");
    Ok(Json(detail.into()))
}

fn parse_moderation_case_cursor(
    value: &str,
) -> Result<projections::ModerationCaseCursor, ApiError> {
    let (updated_seq, case_id) = value
        .split_once(':')
        .ok_or_else(|| moderation_bad_request("invalid moderation cursor"))?;
    Ok(projections::ModerationCaseCursor {
        updated_seq: updated_seq
            .parse()
            .map_err(|_| moderation_bad_request("invalid moderation cursor"))?,
        case_id: Uuid::parse_str(case_id)
            .map_err(|_| moderation_bad_request("invalid moderation cursor"))?,
    })
}

fn moderation_projection_api_error(error: projections::ProjectionError) -> ApiError {
    match error {
        projections::ProjectionError::DuplicateModerationReport => ApiError::Reject {
            status: StatusCode::CONFLICT,
            error: RejectCode::StreamConflict,
            message: "this active report already exists".to_string(),
        },
        projections::ProjectionError::ModerationReportRateLimited => ApiError::RateLimited {
            retry_after_seconds: 86_400,
            message: "the reporter submission limit has been reached".to_string(),
        },
        projections::ProjectionError::ModerationTargetNotPublic => ApiError::Reject {
            status: StatusCode::NOT_FOUND,
            error: RejectCode::NotAuthorized,
            message: "the moderation target is not public".to_string(),
        },
        error => ApiError::Projection(error),
    }
}

fn moderation_reject_api_error(reject: community::CommunityReject) -> ApiError {
    match reject {
        community::CommunityReject::InvalidModerationTarget
        | community::CommunityReject::InvalidReportReason
        | community::CommunityReject::InvalidModerationCaseStatus => {
            moderation_bad_request(reject.to_string())
        }
        _ => discussion_conflict(reject.to_string().as_str()),
    }
}

fn moderation_bad_request(message: impl Into<String>) -> ApiError {
    ApiError::Reject {
        status: StatusCode::BAD_REQUEST,
        error: RejectCode::Internal,
        message: message.into(),
    }
}

async fn visible_discussion_topic(
    state: &ApiState,
    topic_id: Uuid,
) -> Result<projections::DiscussionTopicRow, ApiError> {
    let topic = projections::discussion_topic_by_id(&state.pool, topic_id)
        .await?
        .ok_or_else(|| discussion_not_found("discussion topic"))?;
    if topic.visibility != community::TopicVisibility::Visible.as_str() {
        return Err(discussion_not_found("discussion topic"));
    }
    Ok(topic)
}

async fn authenticated_discussion_profile(
    state: &ApiState,
    headers: &HeaderMap,
) -> Result<projections::ProfileEditorRow, ApiError> {
    let token = bearer_token(headers).ok_or_else(unauthorized_account)?;
    let principal_user_id = require_active_enabled_account(state, token).await?;
    let profile = projections::profile_editor_by_principal(&state.pool, principal_user_id.as_str())
        .await?
        .ok_or_else(|| discussion_conflict("create a community profile before posting"))?;
    if profile.visibility != "public" {
        return Err(discussion_conflict(
            "make the community profile public before posting publicly",
        ));
    }
    Ok(profile)
}

async fn require_global_mod(
    state: &ApiState,
    token: &str,
    action: &str,
) -> Result<String, ApiError> {
    let principal_user_id = require_active_enabled_account(state, token).await?;
    let (_, globals) = active_session_principal_and_globals(state, token).await?;
    if globals
        .iter()
        .any(|capability| matches!(capability.as_str(), "GlobalAdmin" | "GlobalMod"))
    {
        return Ok(principal_user_id);
    }
    Err(ApiError::Reject {
        status: StatusCode::FORBIDDEN,
        error: RejectCode::NotAuthorized,
        message: format!("{action} requires GlobalMod"),
    })
}

fn parse_discussion_topic_cursor(
    value: &str,
) -> Result<projections::DiscussionTopicCursor, ApiError> {
    let (updated_seq, topic_id) = value.split_once(':').ok_or_else(|| {
        discussion_conflict("invalid discussion cursor; refresh the area and try again")
    })?;
    let updated_seq = updated_seq.parse::<i64>().map_err(|_| {
        discussion_conflict("invalid discussion cursor; refresh the area and try again")
    })?;
    let topic_id = Uuid::parse_str(topic_id).map_err(|_| {
        discussion_conflict("invalid discussion cursor; refresh the area and try again")
    })?;
    Ok(projections::DiscussionTopicCursor {
        updated_seq,
        topic_id,
    })
}

fn validate_discussion_slug(value: &str) -> Result<String, ApiError> {
    let slug = value.trim().to_ascii_lowercase();
    if !(2..=48).contains(&slug.len())
        || slug.starts_with('-')
        || slug.ends_with('-')
        || !slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "discussion area slug must be 2 to 48 lowercase letters, digits, or hyphens"
                .to_string(),
        });
    }
    Ok(slug)
}

fn validate_discussion_text(value: &str, label: &str, max_len: usize) -> Result<String, ApiError> {
    let text = value.trim();
    if text.is_empty() || text.len() > max_len {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: format!("{label} must contain 1 to {max_len} bytes"),
        });
    }
    Ok(text.to_string())
}

fn community_topic_state(
    topic: &projections::DiscussionTopicRow,
) -> Result<community::TopicState, ApiError> {
    Ok(community::TopicState {
        topic_id: topic.topic_id,
        area_id: topic.area_id,
        posting_state: community::PostingState::parse(topic.posting_state.as_str())
            .map_err(community_reject_api_error)?,
        visibility: community::TopicVisibility::parse(topic.visibility.as_str())
            .map_err(community_reject_api_error)?,
        version: topic.version,
    })
}

async fn append_community_events(
    pool: &PgPool,
    topic_id: Uuid,
    expected_version: i64,
    events: Vec<community::TopicEvent>,
    principal_user_id: String,
) -> Result<(), ApiError> {
    let occurred_at = unix_now_seconds();
    let events: Vec<_> = events
        .into_iter()
        .map(|event| {
            EventInput::new(
                event.kind(),
                1,
                event.payload(),
                ActorId::User(principal_user_id.clone()),
                occurred_at,
            )
        })
        .collect();
    match projections::append_discussion_and_project_expected(
        pool,
        topic_id,
        expected_version,
        events.as_slice(),
    )
    .await
    {
        Ok(_) => Ok(()),
        Err(projections::ProjectionError::Store(eventstore::StoreError::Conflict { .. })) => Err(
            discussion_conflict("discussion changed concurrently; refresh and try again"),
        ),
        Err(error) => Err(ApiError::Projection(error)),
    }
}

fn community_reject_api_error(reject: community::CommunityReject) -> ApiError {
    let status = match reject {
        community::CommunityReject::InvalidPostingState
        | community::CommunityReject::InvalidVisibility => StatusCode::BAD_REQUEST,
        community::CommunityReject::TopicNotFound => StatusCode::NOT_FOUND,
        _ => StatusCode::CONFLICT,
    };
    ApiError::Reject {
        status,
        error: if status == StatusCode::NOT_FOUND {
            RejectCode::NotAuthorized
        } else if status == StatusCode::BAD_REQUEST {
            RejectCode::Internal
        } else {
            RejectCode::StreamConflict
        },
        message: reject.to_string(),
    }
}

fn discussion_not_found(resource: &str) -> ApiError {
    ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::NotAuthorized,
        message: format!("{resource} was not found"),
    }
}

fn discussion_conflict(message: &str) -> ApiError {
    ApiError::Reject {
        status: StatusCode::CONFLICT,
        error: RejectCode::StreamConflict,
        message: message.to_string(),
    }
}

#[derive(Debug, Clone, Deserialize)]
struct CreateProfileRequest {
    handle: String,
    display_name: String,
    bio: String,
    visibility: String,
}

#[derive(Debug, Clone, Deserialize)]
struct UpdateProfileRequest {
    display_name: String,
    bio: String,
    visibility: String,
}

async fn public_profile(
    State(state): State<ApiState>,
    Path(handle): Path<String>,
) -> Result<Json<PublicProfile>, ApiError> {
    let profile = projections::public_profile_by_handle(&state.pool, handle.as_str())
        .await?
        .ok_or_else(|| profile_not_found())?;
    Ok(Json(PublicProfile::from(profile)))
}

async fn current_profile_editor(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> Result<Json<ProfileEditor>, ApiError> {
    let principal_user_id = authenticated_profile_principal(&state, &headers).await?;
    let profile = projections::profile_editor_by_principal(&state.pool, principal_user_id.as_str())
        .await?
        .ok_or_else(|| profile_not_found())?;
    Ok(Json(ProfileEditor::from(profile)))
}

async fn profile_editor(
    State(state): State<ApiState>,
    Path(handle): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ProfileEditor>, ApiError> {
    let principal_user_id = authenticated_profile_principal(&state, &headers).await?;
    let profile = projections::profile_editor_by_handle(&state.pool, handle.as_str())
        .await?
        .ok_or_else(|| profile_not_found())?;
    require_profile_owner(&profile, principal_user_id.as_str())?;
    Ok(Json(ProfileEditor::from(profile)))
}

async fn create_profile(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<CreateProfileRequest>,
) -> Result<(StatusCode, Json<ProfileEditor>), ApiError> {
    let principal_user_id = authenticated_profile_principal(&state, &headers).await?;
    if projections::profile_editor_by_principal(&state.pool, principal_user_id.as_str())
        .await?
        .is_some()
    {
        return Err(profile_conflict(
            "this account already has a profile; edit its current profile",
        ));
    }
    let handle = validate_profile_handle(request.handle.as_str())?;
    if projections::profile_editor_by_handle(&state.pool, handle.as_str())
        .await?
        .is_some()
    {
        return Err(profile_conflict(
            "profile handle is already in use; choose another handle",
        ));
    }
    let display_name =
        validate_profile_text(request.display_name.as_str(), "profile display name", 80)?;
    let bio = validate_profile_text(request.bio.as_str(), "profile bio", 1_000)?;
    let visibility = validate_profile_visibility(request.visibility.as_str())?;
    let profile_id = Uuid::new_v4();
    projections::append_profile_and_project(
        &state.pool,
        profile_id,
        &[EventInput::new(
            "ProfileCreated",
            1,
            serde_json::json!({
                "principal_user_id": principal_user_id,
                "handle": handle,
                "display_name": display_name,
                "bio": bio,
                "visibility": visibility,
            }),
            ActorId::User(principal_user_id.clone()),
            unix_now_seconds(),
        )],
    )
    .await?;
    let profile = projections::profile_editor_by_principal(&state.pool, principal_user_id.as_str())
        .await?
        .expect("projected profile editor is readable");
    Ok((StatusCode::CREATED, Json(ProfileEditor::from(profile))))
}

async fn update_profile(
    State(state): State<ApiState>,
    Path(handle): Path<String>,
    headers: HeaderMap,
    Json(request): Json<UpdateProfileRequest>,
) -> Result<Json<ProfileEditor>, ApiError> {
    let principal_user_id = authenticated_profile_principal(&state, &headers).await?;
    let profile = projections::profile_editor_by_handle(&state.pool, handle.as_str())
        .await?
        .ok_or_else(|| profile_not_found())?;
    require_profile_owner(&profile, principal_user_id.as_str())?;
    let display_name =
        validate_profile_text(request.display_name.as_str(), "profile display name", 80)?;
    let bio = validate_profile_text(request.bio.as_str(), "profile bio", 1_000)?;
    let visibility = validate_profile_visibility(request.visibility.as_str())?;
    projections::append_profile_and_project(
        &state.pool,
        profile.profile_id,
        &[EventInput::new(
            "ProfileUpdated",
            1,
            serde_json::json!({
                "display_name": display_name,
                "bio": bio,
                "visibility": visibility,
            }),
            ActorId::User(principal_user_id),
            unix_now_seconds(),
        )],
    )
    .await?;
    let profile = projections::profile_editor_by_handle(&state.pool, handle.as_str())
        .await?
        .expect("updated profile editor is readable");
    Ok(Json(ProfileEditor::from(profile)))
}

async fn authenticated_profile_principal(
    state: &ApiState,
    headers: &HeaderMap,
) -> Result<String, ApiError> {
    let token = bearer_token(headers).ok_or_else(unauthorized_account)?;
    require_active_enabled_account(state, token).await
}

fn require_profile_owner(
    profile: &projections::ProfileEditorRow,
    principal_user_id: &str,
) -> Result<(), ApiError> {
    if profile.principal_user_id == principal_user_id {
        return Ok(());
    }
    Err(ApiError::Reject {
        status: StatusCode::FORBIDDEN,
        error: RejectCode::NotAuthorized,
        message: "profile editing requires the owning account".to_string(),
    })
}

fn validate_profile_handle(value: &str) -> Result<String, ApiError> {
    let handle = value.trim().to_ascii_lowercase();
    if !(3..=32).contains(&handle.len())
        || !handle
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "profile handle must be 3 to 32 lowercase letters, digits, or underscores"
                .to_string(),
        });
    }
    Ok(handle)
}

fn validate_profile_text(value: &str, label: &str, max_len: usize) -> Result<String, ApiError> {
    let text = value.trim();
    if text.is_empty() || text.len() > max_len {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: format!("{label} must contain 1 to {max_len} bytes"),
        });
    }
    Ok(text.to_string())
}

fn validate_profile_visibility(value: &str) -> Result<String, ApiError> {
    match value.trim() {
        "public" | "members" => Ok(value.trim().to_string()),
        _ => Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "profile visibility must be public or members".to_string(),
        }),
    }
}

fn profile_not_found() -> ApiError {
    ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::NotAuthorized,
        message: "profile was not found or is not public".to_string(),
    }
}

fn profile_conflict(message: &str) -> ApiError {
    ApiError::Reject {
        status: StatusCode::CONFLICT,
        error: RejectCode::StreamConflict,
        message: message.to_string(),
    }
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
    let mut day_events = Vec::new();
    if !game_completed {
        for event in projections::day_events(&state.pool, game).await? {
            if event.state != "open" {
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
            let participation =
                projections::day_event_participation(&state.pool, game, event.event_id.as_str())
                    .await?;
            let submitted = participation
                .iter()
                .any(|row| row.actor_slot == actor.slot_id);
            let at_capacity = event
                .definition
                .participation
                .limits
                .maximum
                .is_some_and(|maximum| participation.len() >= maximum as usize);
            day_events.push(PlayerDayEventAttention {
                event_id: event.event_id,
                template_key: event.definition.template_key.as_str().to_string(),
                phase_id: event.phase_id.unwrap_or_default(),
                participation_status: if submitted {
                    "submitted".to_string()
                } else {
                    "available".to_string()
                },
                can_submit: !submitted && !at_capacity,
                can_withdraw: submitted,
            });
        }
    }

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
        day_events,
        boundary: if game_completed {
            "The game is complete; role actions, votes, and posts are closed while final role and alignment facts are public.".to_string()
        } else {
            "Role-action availability is derived from committed phase_state, slot_state, the actor role in the game pack, and conservative target candidates. Final command validation still happens at /commands.".to_string()
        },
    }))
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
        .rsplit(|c| c == '-' || c == '_')
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
                "channel_policy": { "allowed_channels": ["spectator"] }
            }))
            .unwrap(),
            state: state.to_string(),
            phase_id: Some("D01".to_string()),
            opened_at: Some(1),
            locked_at: Some(2),
            cancelled_reason: None,
            decision: None,
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
    pub accounts: Vec<HostSetupAccountState>,
    pub phase: Option<HostConsolePhaseState>,
    pub slots: Vec<HostSetupSlotState>,
    pub post_policies: Vec<HostSetupPostPolicyState>,
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
    let authority = resolve_host_console_authority(&state, game, principal_user_id.as_str())
        .await?
        .ok_or_else(|| ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: "principal cannot read host console state for this game".to_string(),
        })?;

    Ok(Json(
        load_host_console_state(
            &state,
            game,
            authority,
            query.slot_id.as_deref(),
            query.limit,
        )
        .await?,
    ))
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
    state: &ApiState,
    game: Uuid,
    authority: HostConsoleAuthorityDelta,
    slot_id: Option<&str>,
    limit: Option<i64>,
) -> Result<HostConsoleStateResponse, ApiError> {
    let completed = commands::game_completed(&state.pool, game)
        .await
        .map_err(command_reject_api_error)?;
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
                role_key: slot_state.and_then(|state| state.role_key.clone()),
                alignment: slot_state.and_then(|state| state.alignment.clone()),
                role_revealed: slot_state.map(|state| state.role_revealed).unwrap_or(false),
                alignment_revealed: slot_state
                    .map(|state| state.alignment_revealed)
                    .unwrap_or(false),
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
    let host_prompts = projections::host_prompts(&state.pool, game).await?;
    let day_events = projections::day_events(&state.pool, game).await?;
    let tasks = select_host_tasks(&host_prompts, &day_events, &authority);

    Ok(HostConsoleStateResponse {
        game,
        authority,
        completed,
        phase,
        slots,
        thread_posts,
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
    state: &ApiState,
    game: Uuid,
    principal_user_id: &str,
) -> Result<Option<HostConsoleAuthorityDelta>, ApiError> {
    let capabilities =
        caps::resolve(&state.pool, &Principal::user(principal_user_id), game).await?;
    let is_host = capabilities
        .iter()
        .any(|cap| cap == &Capability::HostOf(game));
    let is_cohost = capabilities
        .iter()
        .any(|cap| cap == &Capability::CohostOf(game));
    if !is_host && !is_cohost {
        return if active_global_operator(&state.pool, principal_user_id).await? {
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
        projections::cohost_denied_classes(&state.pool, game)
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
    Ok(authenticate_token(state, token).await?.principal_user_id)
}

async fn authenticated_or_dev_query_principal(
    state: &ApiState,
    headers: &HeaderMap,
    legacy_principal_user_id: Option<&str>,
) -> Result<String, ApiError> {
    if bearer_token(headers).is_some() {
        return authenticated_transport_principal(state, headers).await;
    }
    if state.dev_auth_enabled {
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
    let identity = authenticate_token(&state, token).await?;
    let principal_user_id = identity.principal_user_id.clone();
    let ticket_scope =
        hash_session_token(format!("websocket-ticket-principal:{principal_user_id}").as_str());
    enforce_public_request_limit(
        &state,
        ticket_scope.as_str(),
        state.websocket_ticket_max_per_window,
        &state.auth_attempt_policy,
    )
    .await?;
    let audience = request.audience.trim();
    let channel = request.channel.trim();
    if audience != state.websocket_audience
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
        .saturating_add(state.websocket_ticket_ttl.as_secs() as i64)
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
    if audience != state.websocket_audience || ticket.trim().is_empty() {
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
    if state.dev_auth_enabled && claim.session_reference == "dev-legacy" {
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
            let account_predicate = if state.dev_auth_enabled {
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
    } else if state.dev_auth_enabled {
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
                principal_user_id = %claim.principal_user_id,
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
    if let Ok(text) = serde_json::to_string(&ServerEnvelope::new(0, ServerMsg::Hello(hello))) {
        let _ = socket.send(Message::Text(text.into())).await;
    }

    let game = claim.game;

    // Subscribe before hydration so commands cannot publish into a handshake gap.
    let mut live_projection_rx = state.live_projection_tx.subscribe();
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
            update = receive_live_projection(&mut live_projection_rx) => Some(update),
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

enum LiveProjectionReceive {
    Update(LiveProjectionUpdate),
    Lagged { dropped_messages: u64 },
    Closed,
}

async fn receive_live_projection(
    receiver: &mut broadcast::Receiver<LiveProjectionUpdate>,
) -> LiveProjectionReceive {
    match receiver.recv().await {
        Ok(update) => LiveProjectionReceive::Update(update),
        Err(broadcast::error::RecvError::Lagged(dropped_messages)) => {
            LiveProjectionReceive::Lagged { dropped_messages }
        }
        Err(broadcast::error::RecvError::Closed) => LiveProjectionReceive::Closed,
    }
}

async fn host_console_state_delta_for_ws(
    state: &ApiState,
    game: Uuid,
    principal_user_id: Option<&str>,
    slot_id: Option<&str>,
) -> Option<ProjectionDelta> {
    let principal_user_id = principal_user_id?;
    let authority = resolve_host_console_authority(state, game, principal_user_id)
        .await
        .ok()??;
    load_host_console_state(state, game, authority, slot_id, Some(25))
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
        | wire::Command::SubmitVote { game, .. }
        | wire::Command::WithdrawVote { game, .. }
        | wire::Command::SubmitAction { game, .. }
        | wire::Command::WithdrawAction { game, .. }
        | wire::Command::SubmitPost { game, .. }
        | wire::Command::ExtendDeadline { game, .. }
        | wire::Command::ApplyEffectPlan { game, .. }
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
            | wire::Command::SubmitPost { .. }
            | wire::Command::ExtendDeadline { .. }
            | wire::Command::ApplyEffectPlan { .. }
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
            | wire::Command::SubmitVote { .. }
            | wire::Command::WithdrawVote { .. }
            | wire::Command::ApplyEffectPlan { .. }
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
mod live_projection_tests {
    use super::*;

    fn live_update(game: Uuid) -> LiveProjectionUpdate {
        LiveProjectionUpdate {
            game,
            deltas: Vec::new(),
            thread_dirty: true,
            host_console_dirty: false,
            host_prompts_dirty: false,
            player_private_dirty: false,
            player_command_state_dirty: false,
        }
    }

    #[tokio::test]
    async fn bounded_live_projection_receiver_reports_lag_and_then_continues() {
        let (sender, _) = broadcast::channel(1);
        let mut receiver = sender.subscribe();
        let game = Uuid::new_v4();
        sender.send(live_update(game)).unwrap();
        sender.send(live_update(game)).unwrap();

        assert!(matches!(
            receive_live_projection(&mut receiver).await,
            LiveProjectionReceive::Lagged {
                dropped_messages: 1
            }
        ));
        assert!(matches!(
            receive_live_projection(&mut receiver).await,
            LiveProjectionReceive::Update(update) if update.game == game
        ));
    }

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
    error: impl std::fmt::Display,
) -> (StatusCode, RejectCode, String) {
    let reference = Uuid::new_v4();
    tracing::error!(%reference, %boundary, error = %error, "request failed internally");
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
