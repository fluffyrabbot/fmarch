//! `api` — the first network boundary over the command pipeline.
//!
//! The command crate remains pre-HTTP. This crate owns HTTP/WebSocket decoding,
//! temporary dev-principal extraction, and mapping command outcomes into `wire`
//! messages.

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE, RETRY_AFTER};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use caps::{Capability, Principal};
use media::{
    IngestStatus, MediaError, MediaStore, VariantGenerationStatus, VariantLimits,
    VARIANT_RECIPE_REVISION,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPool;
use std::collections::{BTreeSet, HashSet};
use std::path::Path as FsPath;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
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
    media_store: MediaStore,
    variant_limits: VariantLimits,
    server_name: String,
    dev_auth_enabled: bool,
    auth_attempt_policy: AuthAttemptPolicy,
    live_projection_tx: broadcast::Sender<LiveProjectionUpdate>,
    live_projection_delivery_delay: Duration,
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
    window_seconds: i64,
    lockout_seconds: i64,
    retention_seconds: i64,
    trust_source_header: bool,
}

#[derive(Debug, Clone)]
struct AuthAttemptScope {
    source_scope_hash: String,
    account_scope_hash: Option<String>,
    policy: AuthAttemptPolicy,
}

const AUTH_ATTEMPT_SOURCE_HEADER: &str = "x-fmarch-auth-source";

impl ApiState {
    pub fn new(pool: PgPool, media_store: MediaStore) -> Self {
        let live_projection_capacity =
            env_i64("FMARCH_LIVE_PROJECTION_CAPACITY", 256, 1, 65_536) as usize;
        let live_projection_delivery_delay =
            Duration::from_millis(
                env_i64("FMARCH_LIVE_PROJECTION_DELIVERY_DELAY_MS", 0, 0, 60_000) as u64,
            );
        let (live_projection_tx, _) = broadcast::channel(live_projection_capacity);
        let _ = dummy_account_password_hash();
        ApiState {
            pool,
            media_store,
            variant_limits: VariantLimits::default(),
            server_name: "fmarch-dev".to_string(),
            dev_auth_enabled: std::env::var("FMARCH_DEV_AUTH").ok().as_deref() == Some("1"),
            auth_attempt_policy: auth_attempt_policy_from_env(),
            live_projection_tx,
            live_projection_delivery_delay,
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

    pub fn with_live_projection_capacity(mut self, capacity: usize) -> Self {
        let (live_projection_tx, _) = broadcast::channel(capacity.clamp(1, 65_536));
        self.live_projection_tx = live_projection_tx;
        self
    }

    pub fn with_live_projection_delivery_delay(mut self, delay: Duration) -> Self {
        self.live_projection_delivery_delay = delay.min(Duration::from_secs(60));
        self
    }
}

pub fn router(pool: PgPool, media_store: MediaStore) -> Router {
    router_with_state(ApiState::new(pool, media_store))
}

pub fn router_with_state(state: ApiState) -> Router {
    let media_upload_limit = state.media_store.limits().max_encoded_bytes();
    Router::new()
        .route("/healthz", get(healthz))
        .route("/auth/session", get(auth_session))
        .route("/auth/dev-session", post(create_dev_auth_session))
        .route("/auth/session-grants", post(create_auth_session_grant))
        .route("/auth/accounts", post(create_auth_account))
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
            "/auth/accounts/recovery-credential-revocations",
            post(revoke_auth_account_recovery_credential),
        )
        .route("/auth/accounts/recoveries", post(recover_auth_account))
        .route("/auth/accounts/disable", post(disable_auth_account))
        .route("/auth/accounts/enable", post(enable_auth_account))
        .route("/auth/session-rotations", post(rotate_auth_session))
        .route("/auth/session-revocations", post(revoke_auth_session))
        .route("/auth/invites", post(create_auth_invite))
        .route("/auth/invites/redeem", post(redeem_auth_invite))
        .route("/auth/invite-revocations", post(revoke_auth_invite))
        .route(
            "/media/uploads",
            post(media_upload).layer(DefaultBodyLimit::max(media_upload_limit)),
        )
        .route(
            "/auth/identity-lifecycle-audit",
            get(identity_lifecycle_audit),
        )
        .route("/commands", post(command))
        .route("/games/{game}/votecount", get(votecount))
        .route("/games/{game}/day-vote-outcomes", get(day_vote_outcomes))
        .route("/games/{game}/endgame-summary", get(endgame_summary))
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

async fn media_upload(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    require_active_enabled_account(&state, token).await?;
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
    let committed = tokio::task::spawn_blocking(move || {
        let prepared = store
            .prepare_upload(&encoded, variant_limits)
            .map_err(MediaUploadFailure::Prepare)?;
        store
            .commit_prepared_upload(prepared)
            .map_err(MediaUploadFailure::Commit)
    })
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "media upload worker failed");
        media_internal_error("media upload worker failed".to_string())
    })?
    .map_err(|error| match error {
        MediaUploadFailure::Prepare(error) => media_api_error(error),
        MediaUploadFailure::Commit(error) => {
            tracing::error!(error = %error, "media upload commit failed");
            media_internal_error("media upload commit failed".to_string())
        }
    })?;
    let ingest = committed.ingest();
    let variants = committed.variants();

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

async fn require_active_enabled_account(state: &ApiState, token: &str) -> Result<String, ApiError> {
    let token_hash = hash_session_token(token);
    let now = unix_now_seconds();
    sqlx::query_scalar::<_, String>(
        r#"
        SELECT session.principal_user_id
        FROM auth_session AS session
        WHERE session.token_hash = $1
          AND session.revoked_at IS NULL
          AND session.expires_at > $2
          AND EXISTS (
              SELECT 1
              FROM auth_account AS account
              WHERE account.principal_user_id = session.principal_user_id
                AND account.disabled_at IS NULL
          )
        "#,
    )
    .bind(token_hash)
    .bind(now)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(unauthorized_account)
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

#[derive(Debug, Clone, Deserialize)]
struct LoginAuthAccount {
    account_id: String,
    password: String,
    session_token: String,
    expires_at: i64,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthAccountRecoveryCredentialResponse {
    status: String,
    recovery_id: Uuid,
    recovery_token: String,
    account_id: String,
    principal_user_id: String,
    expires_at: i64,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthAccountRecoveryResponse {
    status: String,
    recovery_id: Uuid,
    account_id: String,
    principal_user_id: String,
    revoked_session_count: i64,
    password_algorithm: String,
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

#[derive(Debug, Clone, Deserialize)]
struct RotateAuthSession {
    session_token: String,
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
}

#[derive(Debug, Clone, Deserialize)]
struct RedeemAuthInvite {
    invite_token: String,
    account_id: String,
    password: String,
    session_token: String,
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

async fn create_auth_account(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<CreateAuthAccount>,
) -> Result<Json<AuthAccountResponse>, ApiError> {
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

async fn login_auth_account(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<LoginAuthAccount>,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    let account_id = request.account_id.trim();
    let password = request.password.as_str();
    let session_token = request.session_token.trim();
    if account_id.is_empty() || password.trim().is_empty() || session_token.is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "account login requires account_id, password, and session_token".to_string(),
        });
    }
    validate_account_password_input(password)?;
    let now = unix_now_seconds();
    if request.expires_at <= now {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "account session expiry must be in the future".to_string(),
        });
    }
    let attempt_scope = enforce_auth_attempt_limit(&state, &headers, account_id).await?;

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
        record_failed_auth_attempt(&state, &attempt_scope, account_id, "account-login").await?;
        return Err(unauthorized_account());
    };

    if !verify_account_password(account.1.as_str(), password).await? {
        record_failed_auth_attempt(&state, &attempt_scope, account_id, "account-login").await?;
        return Err(unauthorized_account());
    }

    let session_hash = hash_session_token(session_token);
    let mut tx = state.pool.begin().await?;
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
    .bind(&session_hash)
    .bind(account.0.as_str())
    .bind(now)
    .bind(request.expires_at)
    .bind(&account.2)
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
            "session_expires_at": request.expires_at,
            "global_capability_count": account.2.len()
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;
    clear_auth_attempt_failures(&mut tx, &attempt_scope).await?;
    tx.commit().await?;

    Ok(Json(
        auth_session_response(&state, account.0, None, account.2).await?,
    ))
}

async fn rotate_auth_account_password(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RotateAuthAccountPassword>,
) -> Result<Json<AuthAccountPasswordRotationResponse>, ApiError> {
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
    .bind(recovery_hash)
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
    tx.commit().await?;

    Ok(Json(AuthAccountRecoveryCredentialResponse {
        status: "issued".to_string(),
        recovery_id,
        recovery_token,
        account_id: account_id.to_string(),
        principal_user_id,
        expires_at: request.expires_at,
    }))
}

async fn revoke_auth_account_recovery_credential(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RevokeAuthAccountRecoveryCredential>,
) -> Result<Json<AuthAccountRecoveryCredentialLifecycleResponse>, ApiError> {
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
    let attempt_scope = enforce_auth_attempt_limit(&state, &headers, account_id).await?;
    let now = unix_now_seconds();
    let recovery_hash = hash_session_token(recovery_token);
    let mut tx = state.pool.begin().await?;
    let credential = sqlx::query_as::<_, (Uuid, String)>(
        r#"
        SELECT recovery.recovery_id,
               account.principal_user_id
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
    let Some((recovery_id, principal_user_id)) = credential else {
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
    }))
}

async fn disable_auth_account(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<DisableAuthAccount>,
) -> Result<Json<AuthAccountLifecycleResponse>, ApiError> {
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
    let new_token = request.session_token.trim();
    if new_token.is_empty() {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "session rotation requires session_token".to_string(),
        });
    }
    let old_hash = hash_session_token(caller_token);
    let new_hash = hash_session_token(new_token);
    if old_hash == new_hash {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "session rotation requires a new token".to_string(),
        });
    }

    let now = unix_now_seconds();
    let mut tx = state.pool.begin().await?;
    let session = sqlx::query_as::<_, (String, i64, Vec<String>)>(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE token_hash = $2
          AND revoked_at IS NULL
          AND expires_at > $1
        RETURNING principal_user_id, expires_at, global_capabilities
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
            global_capabilities
        )
        VALUES ($1, $2, $3, $4, NULL, $5)
        "#,
    )
    .bind(&new_hash)
    .bind(session.0.as_str())
    .bind(now)
    .bind(session.1)
    .bind(&session.2)
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

    Ok(Json(
        auth_session_response(&state, session.0, None, session.2).await?,
    ))
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
    .bind(hash_session_token(invite_token))
    .bind(account_id)
    .bind(account_principal_user_id.as_str())
    .bind(request.game)
    .bind(now)
    .bind(request.expires_at)
    .bind(&global_capabilities)
    .bind(&invited_by_user_id)
    .execute(&state.pool)
    .await?;

    if inserted.rows_affected() != 1 {
        return Err(ApiError::Reject {
            status: StatusCode::CONFLICT,
            error: RejectCode::Internal,
            message: "invite token already exists".to_string(),
        });
    }

    Ok(Json(AuthInviteResponse {
        account_id: account_id.to_string(),
        principal_user_id: account_principal_user_id,
        expires_at: request.expires_at,
        game: request.game,
        global_capabilities,
        invited_by_user_id,
    }))
}

async fn redeem_auth_invite(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RedeemAuthInvite>,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    let invite_token = request.invite_token.trim();
    let account_id = request.account_id.trim();
    let password = request.password.as_str();
    let session_token = request.session_token.trim();
    if invite_token.is_empty()
        || account_id.is_empty()
        || password.trim().is_empty()
        || session_token.is_empty()
    {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message:
                "invite redemption requires invite_token, account_id, password, and session_token"
                    .to_string(),
        });
    }
    validate_account_password_input(password)?;
    let attempt_scope = enforce_auth_attempt_limit(&state, &headers, account_id).await?;

    let now = unix_now_seconds();
    let invite_hash = hash_session_token(invite_token);
    let session_hash = hash_session_token(session_token);
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
    .bind(&session_hash)
    .bind(invite.0.as_str())
    .bind(now)
    .bind(invite.1)
    .bind(&invite.2)
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

    Ok(Json(
        auth_session_response(&state, invite.0, None, invite.2).await?,
    ))
}

async fn revoke_auth_invite(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(request): Json<RevokeAuthInvite>,
) -> Result<Json<AuthLifecycleResponse>, ApiError> {
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

async fn enforce_auth_attempt_limit(
    state: &ApiState,
    headers: &HeaderMap,
    account_id: &str,
) -> Result<AuthAttemptScope, ApiError> {
    let policy = state.auth_attempt_policy.clone();
    let source = if policy.trust_source_header {
        headers
            .get(AUTH_ATTEMPT_SOURCE_HEADER)
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.len() <= 256)
            .unwrap_or("direct")
    } else {
        "direct"
    };
    let normalized_source = source.to_ascii_lowercase();
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
                "credential-account:{}\0source:{}",
                account_id.trim().to_ascii_lowercase(),
                normalized_source
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
    }
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

async fn hash_account_password(password: &str) -> Result<String, ApiError> {
    let password = password.to_string();
    tokio::task::spawn_blocking(move || hash_account_password_sync(password.as_str()))
        .await
        .map_err(|error| {
            internal_auth_error(format!("account password hashing task failed: {error}"))
        })?
}

fn hash_account_password_sync(password: &str) -> Result<String, ApiError> {
    let salt = SaltString::encode_b64(Uuid::new_v4().as_bytes()).map_err(|error| {
        internal_auth_error(format!("could not generate account password salt: {error}"))
    })?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| internal_auth_error(format!("could not hash account password: {error}")))
}

async fn verify_account_password(encoded_hash: &str, password: &str) -> Result<bool, ApiError> {
    let encoded_hash = encoded_hash.to_string();
    let password = password.to_string();
    tokio::task::spawn_blocking(move || {
        verify_account_password_sync(encoded_hash.as_str(), password.as_str())
    })
    .await
    .map_err(|error| {
        internal_auth_error(format!(
            "account password verification task failed: {error}"
        ))
    })
}

fn verify_account_password_sync(encoded_hash: &str, password: &str) -> bool {
    let Ok(parsed_hash) = PasswordHash::new(encoded_hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

fn dummy_account_password_hash() -> &'static str {
    static DUMMY_HASH: OnceLock<String> = OnceLock::new();
    DUMMY_HASH
        .get_or_init(|| {
            hash_account_password_sync("fmarch-dummy-account-password")
                .expect("dummy account password hash must initialize")
        })
        .as_str()
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
    let player_command_state_dirty = command_affects_player_command_state(&msg.command);
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
                    player_command_state_dirty,
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
    pub completed: bool,
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

#[derive(Debug, Clone, Deserialize)]
struct HostSetupStateQuery {
    principal_user_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostSetupStateResponse {
    pub game: Uuid,
    pub created: bool,
    pub pack: HostSetupPackState,
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
    pub start_phase_options: Vec<String>,
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

async fn host_setup_state(
    State(state): State<ApiState>,
    Path(game): Path<Uuid>,
    Query(query): Query<HostSetupStateQuery>,
) -> Result<Json<HostSetupStateResponse>, ApiError> {
    require_host_audit_access(
        &state,
        game,
        query.principal_user_id.as_str(),
        "principal cannot read host setup state for this game",
    )
    .await?;

    Ok(Json(load_host_setup_state(&state, game).await?))
}

async fn load_host_console_state(
    state: &ApiState,
    game: Uuid,
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

    Ok(HostConsoleStateResponse {
        game,
        completed,
        phase,
        slots,
        thread_posts,
    })
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

    Ok(HostSetupStateResponse {
        game,
        created: true,
        pack: HostSetupPackState {
            key: pack_key,
            name: pack.name,
            valid: true,
            role_keys: pack.roles.keys().cloned().collect(),
            start_phase_options: start_phase_options(&pack.phases),
        },
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
    let connection_id = Uuid::new_v4();
    let hello = hello_for(&state, params.principal_user_id.as_deref(), params.game).await;
    if let Ok(text) = serde_json::to_string(&ServerEnvelope::new(0, ServerMsg::Hello(hello))) {
        let _ = socket.send(Message::Text(text.into())).await;
    }

    let Some(game) = params.game else {
        return;
    };

    // Subscribe before hydration so commands cannot publish into a handshake gap.
    let mut live_projection_rx = state.live_projection_tx.subscribe();
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

    loop {
        let update = match receive_live_projection(&mut live_projection_rx).await {
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
        | wire::Command::SetPostPolicy { game, .. }
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
            | wire::Command::CompleteGame { .. }
            | wire::Command::SetPostPolicy { .. }
            | wire::Command::SubmitVote { .. }
            | wire::Command::WithdrawVote { .. }
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
    RateLimited {
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

fn command_reject_api_error(reject: commands::Reject) -> ApiError {
    let status = match &reject {
        commands::Reject::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        commands::Reject::UnknownGame | commands::Reject::UnknownSlot => StatusCode::NOT_FOUND,
        commands::Reject::NotAuthorized
        | commands::Reject::NotHost
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
            other => other,
        };
        let (status, error, message) = match self_ {
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
            ApiError::RateLimited { .. } => unreachable!(),
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
