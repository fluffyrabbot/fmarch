//! Authentication, account, session, invite, and credential-delivery HTTP boundary.

use super::{acquire_workload_slot, ApiError, ApiState, REGISTRATION_SESSION_TTL_SECONDS};
use crate::authentication::{
    auth_attempt_policy_from_env, cancel_auth_delivery_intent, clear_auth_attempt_failures,
    deliver_auth_credential, enforce_auth_attempt_limit, enforce_recovery_request_limit,
    enforce_registration_source_limit, record_failed_auth_attempt, AuthAttemptPolicy,
    AuthCredentialDeliveryRequest,
};
use crate::identity_delivery::{
    process_identity_delivery_intent, IdentityDeliveryGateway, IdentityDeliveryKind,
    LocalDeterministicIdentityDeliveryGateway,
};
use axum::extract::{Path, Query, State};
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use caps::{Capability, Principal};
use identity::{AccessTokenVerifier, IdentityError, MemberLifecycleCommand};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Semaphore;
use uuid::Uuid;
use wire::{CapabilityGrant, RejectCode};

#[derive(Clone)]
pub(super) struct AuthHttpState {
    pub(super) pool: PgPool,
    pub(super) dev_auth_enabled: bool,
    pub(super) auth_attempt_policy: AuthAttemptPolicy,
    pub(super) identity_delivery_gateway: Arc<dyn IdentityDeliveryGateway>,
    pub(super) password_slots: Arc<Semaphore>,
    pub(super) websocket_audience: String,
    pub(super) websocket_ticket_ttl: Duration,
    pub(super) websocket_ticket_max_per_window: i32,
    pub(super) access_token_verifier: Option<Arc<dyn AccessTokenVerifier>>,
    pub(super) session_policy: identity::SessionPolicy,
    pub(super) classic_enabled: bool,
}

impl AuthHttpState {
    pub(super) fn new(pool: PgPool) -> Self {
        let _ = dummy_account_password_hash();
        Self {
            pool,
            dev_auth_enabled: cfg!(debug_assertions)
                && std::env::var("FMARCH_DEV_AUTH").ok().as_deref() == Some("1"),
            auth_attempt_policy: auth_attempt_policy_from_env(),
            identity_delivery_gateway: Arc::new(
                LocalDeterministicIdentityDeliveryGateway::from_env(),
            ),
            password_slots: Arc::new(Semaphore::new(env_i64(
                "FMARCH_PASSWORD_MAX_IN_FLIGHT",
                4,
                1,
                64,
            ) as usize)),
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
            access_token_verifier: None,
            session_policy: identity::SessionPolicy::from_env(),
            classic_enabled: std::env::var("FMARCH_CLASSIC_AUTH").ok().as_deref() != Some("0"),
        }
    }
}

pub(super) fn routes(state: &ApiState) -> Router<ApiState> {
    Router::new()
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
        )
        .route("/auth/session", get(auth_session))
        .route("/auth/sessions", post(create_auth_session))
        .route("/auth/account/methods", get(list_account_methods))
        .route(
            "/auth/account/personal-exports",
            post(create_member_personal_export),
        )
        .route(
            "/auth/account/personal-exports/{export_id}",
            get(download_member_personal_export),
        )
        .route("/auth/account/deactivate", post(deactivate_member_account))
        .route("/auth/account/erasure", post(erase_member_account))
        .route("/auth/account/methods/classic", post(add_classic_method))
        .route("/auth/account/methods/workos", post(add_workos_method))
        .route(
            "/auth/account/methods/{method_id}/disable",
            post(disable_account_method),
        )
        .route(
            "/auth/identity-lifecycle-audit",
            get(identity_lifecycle_audit),
        )
        .with_state(state.auth.clone())
}

pub(super) use identity::AuthorizationContext;

/// Resolve the sole request-authorization representation from a canonical,
/// backend-issued app-session credential.
pub(super) async fn authorization_context(
    state: &AuthHttpState,
    token: &str,
) -> Result<AuthorizationContext, ApiError> {
    Ok(identity::session::validate_session(
        &state.pool,
        token,
        &state.session_policy,
        unix_now_seconds(),
    )
    .await?)
}

fn identity_api_error(error: IdentityError) -> ApiError {
    match error {
        IdentityError::ProviderUnavailable(_) => {
            tracing::warn!(
                dependency = "workos-token-verification",
                "identity verification dependency unavailable"
            );
            ApiError::Reject {
                status: StatusCode::SERVICE_UNAVAILABLE,
                error: RejectCode::Internal,
                message: "identity verification is temporarily unavailable".to_string(),
            }
        }
        _ => unauthorized_session(),
    }
}

pub(super) async fn require_authorized_principal(
    state: &AuthHttpState,
    token: &str,
) -> Result<String, ApiError> {
    Ok(authorization_context(state, token).await?.principal_user_id)
}

/// Require a real, currently active sign-in method in addition to a valid
/// canonical session. Resource-owning account surfaces must not admit
/// methodless development or delegated-admin sessions.
pub(super) async fn require_method_authorization(
    state: &AuthHttpState,
    token: &str,
) -> Result<AuthorizationContext, ApiError> {
    let context = authorization_context(state, token).await?;
    if context.method.is_none() {
        return Err(unauthorized_account());
    }
    Ok(context)
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
#[serde(deny_unknown_fields)]
struct CreateDevAuthSession {
    principal_user_id: String,
    expires_at: i64,
    #[serde(default)]
    global_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateAuthSessionGrant {
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
        &mut tx,
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
#[serde(deny_unknown_fields)]
struct RegisterAuthAccount {
    account_id: String,
    password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthAccountRegistrationResponse {
    account_id: String,
    principal_user_id: String,
    session_token: String,
    expires_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct LoginAuthAccount {
    account_id: String,
    password: String,
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
#[serde(deny_unknown_fields)]
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
    session_token: String,
    session_expires_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct DisableAuthAccount {
    account_id: String,
    expected_disabled: Option<bool>,
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
#[serde(deny_unknown_fields)]
struct RotateAuthSession {}

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
pub(super) struct AuthDeliveryReceipt {
    pub(super) delivery_id: Uuid,
    pub(super) status: String,
    pub(super) attempt_count: i32,
    pub(super) provider_id: String,
    pub(super) outcome_kind: String,
    pub(super) outcome_code: Option<String>,
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
#[serde(deny_unknown_fields)]
struct RedeemAuthInvite {
    invite_token: String,
    account_id: String,
    password: String,
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
    State(state): State<AuthHttpState>,
    Query(query): Query<AuthSessionQuery>,
    headers: HeaderMap,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let now = unix_now_seconds();
    let identity = authorization_context(&state, token).await?;
    let mut response = auth_session_response(
        &state,
        identity.principal_user_id,
        query.game,
        identity.global_capabilities,
    )
    .await?;
    response.expires_at = Some(identity.expires_at);
    response.idle_expires_at = Some(identity.idle_expires_at);
    response.created_at = Some(identity.created_at);
    response.rotation_required =
        Some(now.saturating_sub(identity.created_at) >= auth_session_rotation_max_age_seconds());
    Ok(Json(response))
}

async fn create_dev_auth_session(
    State(state): State<AuthHttpState>,
    Json(request): Json<CreateDevAuthSession>,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    if !state.dev_auth_enabled || !cfg!(debug_assertions) {
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
    let expires_at = request
        .expires_at
        .min(state.session_policy.classic_expiry(now));
    let mut conn = state.pool.acquire().await?;
    identity::methods::ensure_principal(&mut conn, request.principal_user_id.as_str(), &[], now)
        .await?;
    let spec = identity::SessionSpec {
        principal_user_id: request.principal_user_id.as_str(),
        session_capabilities: &global_capabilities,
        authenticated_via_method_id: None,
        assurance: identity::Assurance::Dev,
        authenticated_at: now,
        expires_at,
        idle_expires_at: state.session_policy.idle_expiry(now, expires_at),
    };
    let issued = identity::session::issue_session(&mut conn, spec, now).await?;
    drop(conn);

    let mut response =
        auth_session_response(&state, request.principal_user_id, None, global_capabilities).await?;
    response.session_token = Some(issued.session_token);
    response.expires_at = Some(issued.expires_at);
    Ok(Json(response))
}

async fn create_auth_session_grant(
    State(state): State<AuthHttpState>,
    headers: HeaderMap,
    Json(request): Json<CreateAuthSessionGrant>,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let caller = authorization_context(&state, caller_token).await?;
    if !caller
        .global_capabilities
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
    identity::methods::ensure_principal(&mut conn, request.principal_user_id.as_str(), &[], now)
        .await?;
    let expires_at = request
        .expires_at
        .min(state.session_policy.classic_expiry(now));
    let issued = identity::session::issue_session(
        &mut conn,
        identity::SessionSpec {
            principal_user_id: request.principal_user_id.as_str(),
            session_capabilities: &global_capabilities,
            authenticated_via_method_id: None,
            assurance: identity::Assurance::AdminGrant,
            authenticated_at: now,
            expires_at,
            idle_expires_at: state.session_policy.idle_expiry(now, expires_at),
        },
        now,
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
    State(state): State<AuthHttpState>,
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
        &mut tx,
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
    State(state): State<AuthHttpState>,
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
    let expires_at =
        (now + REGISTRATION_SESSION_TTL_SECONDS).min(state.session_policy.classic_expiry(now));
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
        &mut tx,
        account_id.as_str(),
        principal_user_id.as_str(),
        &[],
        now,
    )
    .await?;
    let issued = identity::session::issue_session(
        &mut tx,
        identity::SessionSpec {
            principal_user_id: principal_user_id.as_str(),
            session_capabilities: &[],
            authenticated_via_method_id: Some(method_id),
            assurance: identity::Assurance::Password,
            authenticated_at: now,
            expires_at,
            idle_expires_at: state.session_policy.idle_expiry(now, expires_at),
        },
        now,
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
    State(state): State<AuthHttpState>,
    headers: HeaderMap,
    Json(request): Json<LoginAuthAccount>,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    let response = classic_password_session(
        &state,
        &headers,
        request.account_id.trim(),
        request.password.as_str(),
    )
    .await?;
    Ok(Json(response))
}

async fn classic_password_session(
    state: &AuthHttpState,
    headers: &HeaderMap,
    account_id: &str,
    password: &str,
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
        &mut tx,
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
    let issued = identity::session::issue_session(
        &mut tx,
        identity::SessionSpec {
            principal_user_id: account.0.as_str(),
            session_capabilities: &[],
            authenticated_via_method_id: Some(method_id),
            assurance: identity::Assurance::Password,
            authenticated_at: now,
            expires_at,
            idle_expires_at: state
                .session_policy
                .idle_expiry(now, expires_at.max(now + 1)),
        },
        now,
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
    response.idle_expires_at = Some(issued.idle_expires_at);
    Ok(response)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "method", deny_unknown_fields)]
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
    State(state): State<AuthHttpState>,
    headers: HeaderMap,
    Json(request): Json<CreateAuthSessionRequest>,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    match request {
        CreateAuthSessionRequest::Classic {
            login_name,
            password,
        } => {
            let response =
                classic_password_session(&state, &headers, login_name.trim(), password.as_str())
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
                &mut tx,
                identity::SessionSpec {
                    principal_user_id: resolution.principal_user_id.as_str(),
                    session_capabilities: &[],
                    authenticated_via_method_id: Some(resolution.method_id),
                    assurance: identity::Assurance::ExternalSso,
                    authenticated_at: now,
                    expires_at,
                    idle_expires_at: state.session_policy.idle_expiry(now, expires_at),
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
            response.idle_expires_at = Some(issued.idle_expires_at);
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

#[derive(Debug, Clone, Deserialize)]
struct DeactivateMemberAccount {
    #[serde(default)]
    reason: String,
}

#[derive(Debug, Clone, Serialize)]
struct MemberLifecycleResponse {
    status: String,
    principal_user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pseudonym: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct MemberPersonalExportResponse {
    status: String,
    export_id: String,
    principal_user_id: String,
    requested_at: i64,
    expires_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    artifact: Option<serde_json::Value>,
}

async fn create_member_personal_export(
    State(state): State<AuthHttpState>,
    headers: HeaderMap,
) -> Result<Json<MemberPersonalExportResponse>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let identity = authorization_context(&state, token).await?;
    let now = unix_now_seconds();
    require_recent_authentication(&identity, now)?;
    let export =
        identity::create_personal_export(&state.pool, identity.principal_user_id.as_str(), now)
            .await?;
    Ok(Json(MemberPersonalExportResponse {
        status: "ready".to_string(),
        export_id: export.export_id,
        principal_user_id: export.principal_user_id,
        requested_at: export.requested_at,
        expires_at: export.expires_at,
        artifact: Some(export.artifact),
    }))
}

async fn download_member_personal_export(
    State(state): State<AuthHttpState>,
    Path(export_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<MemberPersonalExportResponse>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let identity = authorization_context(&state, token).await?;
    let export = identity::load_personal_export(
        &state.pool,
        identity.principal_user_id.as_str(),
        export_id,
        unix_now_seconds(),
    )
    .await?
    .ok_or_else(|| ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::NotAuthorized,
        message: "personal export is unavailable or expired".to_string(),
    })?;
    Ok(Json(MemberPersonalExportResponse {
        status: "ready".to_string(),
        export_id: export.export_id,
        principal_user_id: export.principal_user_id,
        requested_at: export.requested_at,
        expires_at: export.expires_at,
        artifact: Some(export.artifact),
    }))
}

async fn deactivate_member_account(
    State(state): State<AuthHttpState>,
    headers: HeaderMap,
    Json(request): Json<DeactivateMemberAccount>,
) -> Result<Json<MemberLifecycleResponse>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let identity = authorization_context(&state, token).await?;
    let now = unix_now_seconds();
    require_recent_authentication(&identity, now)?;
    let reason = request.reason.trim();
    if reason.is_empty() || reason.len() > 280 {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "deactivation requires a reason no longer than 280 characters".to_string(),
        });
    }
    let status = identity::apply_member_lifecycle(
        &state.pool,
        identity.principal_user_id.as_str(),
        MemberLifecycleCommand::Deactivate {
            reason: reason.to_string(),
        },
        now,
    )
    .await?;
    Ok(Json(MemberLifecycleResponse {
        status: status.as_str().to_string(),
        principal_user_id: identity.principal_user_id,
        pseudonym: None,
    }))
}

async fn erase_member_account(
    State(state): State<AuthHttpState>,
    headers: HeaderMap,
) -> Result<Json<MemberLifecycleResponse>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let identity = authorization_context(&state, token).await?;
    let now = unix_now_seconds();
    require_recent_authentication(&identity, now)?;
    let erased =
        identity::erase_member(&state.pool, identity.principal_user_id.as_str(), now).await?;
    Ok(Json(MemberLifecycleResponse {
        status: erased.status.as_str().to_string(),
        principal_user_id: erased.principal_user_id,
        pseudonym: erased.pseudonym,
    }))
}

async fn list_account_methods(
    State(state): State<AuthHttpState>,
    headers: HeaderMap,
) -> Result<Json<AccountMethodsResponse>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let identity = authorization_context(&state, token).await?;
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
#[serde(deny_unknown_fields)]
struct AddClassicMethod {
    login_name: String,
    password: String,
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
    State(state): State<AuthHttpState>,
    headers: HeaderMap,
    Json(request): Json<AddClassicMethod>,
) -> Result<Json<AddClassicMethodResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let identity = authorization_context(&state, token).await?;
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
    let method_id = identity::methods::link_classic_method(
        &mut tx,
        login_name.as_str(),
        identity.principal_user_id.as_str(),
        &[],
        now,
    )
    .await?;

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
    let issued = identity::session::issue_session(
        &mut tx,
        identity::SessionSpec {
            principal_user_id: identity.principal_user_id.as_str(),
            session_capabilities: &[],
            authenticated_via_method_id: Some(method_id),
            assurance: identity::Assurance::Password,
            authenticated_at: now,
            expires_at: session_expires_at,
            idle_expires_at: state.session_policy.idle_expiry(now, session_expires_at),
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
        VALUES ($1, $2, $3, $4, $5, NULL, $6::JSONB)
        "#,
    )
    .bind(now)
    .bind("method_added")
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
    State(state): State<AuthHttpState>,
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
    let identity = authorization_context(&state, token).await?;
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
    State(state): State<AuthHttpState>,
    Path(method_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<DisableMethodResponse>, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let identity = authorization_context(&state, token).await?;
    let now = unix_now_seconds();
    require_recent_authentication(&identity, now)?;

    let mut tx = state.pool.begin().await?;
    let disabled = identity::methods::disable_method(
        &mut tx,
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
    State(state): State<AuthHttpState>,
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
    let mut tx = state.pool.begin().await?;
    let authorization = identity::session::validate_session_for_update(
        &mut tx,
        caller_token,
        &state.session_policy,
    )
    .await?;
    let caller_principal_user_id = authenticated_account_principal_for_update(
        &mut tx,
        &authorization,
        account_id,
        current_password,
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
    .bind(authorization.session_reference)
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
    State(state): State<AuthHttpState>,
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

    let recovery_id = Uuid::new_v4();
    let recovery_token = format!("account-recovery-{}-{}", Uuid::new_v4(), Uuid::new_v4());
    let recovery_hash = hash_session_token(recovery_token.as_str());
    let mut tx = state.pool.begin().await?;
    let authorization = identity::session::validate_session_for_update(
        &mut tx,
        caller_token,
        &state.session_policy,
    )
    .await?;
    let principal_user_id = authenticated_account_principal_for_update(
        &mut tx,
        &authorization,
        account_id,
        current_password,
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
        &AuthCredentialDeliveryRequest {
            delivery_kind: IdentityDeliveryKind::Recovery,
            account_id,
            principal_user_id: principal_user_id.as_str(),
            credential_hash: recovery_hash.as_str(),
            credential_material: recovery_token.as_str(),
            credential_expires_at: request.expires_at,
            now,
        },
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
    State(state): State<AuthHttpState>,
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
        &AuthCredentialDeliveryRequest {
            delivery_kind: IdentityDeliveryKind::Recovery,
            account_id: account_id.as_str(),
            principal_user_id: principal_user_id.as_str(),
            credential_hash: recovery_hash.as_str(),
            credential_material: recovery_token.as_str(),
            credential_expires_at: expires_at,
            now,
        },
    )
    .await?;
    tx.commit().await?;

    Ok(Json(AuthAccountRecoveryRequestResponse {
        status: "accepted".to_string(),
    }))
}

async fn revoke_auth_account_recovery_credential(
    State(state): State<AuthHttpState>,
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
    let mut tx = state.pool.begin().await?;
    let authorization = identity::session::validate_session_for_update(
        &mut tx,
        caller_token,
        &state.session_policy,
    )
    .await?;
    let principal_user_id = authenticated_account_principal_for_update(
        &mut tx,
        &authorization,
        account_id,
        current_password,
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
    State(state): State<AuthHttpState>,
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
        &mut tx,
        account_id,
        principal_user_id.as_str(),
        &account_global_capabilities,
        now,
    )
    .await?;
    let issued = identity::session::issue_session(
        &mut tx,
        identity::SessionSpec {
            principal_user_id: principal_user_id.as_str(),
            session_capabilities: &[],
            authenticated_via_method_id: Some(method_id),
            assurance: identity::Assurance::Password,
            authenticated_at: now,
            expires_at: state.session_policy.classic_expiry(now),
            idle_expires_at: state
                .session_policy
                .idle_expiry(now, state.session_policy.classic_expiry(now)),
        },
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
    State(state): State<AuthHttpState>,
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
    let account = sqlx::query_as::<_, (String, Option<i64>, Option<Uuid>)>(
        r#"
        SELECT principal_user_id, disabled_at, method_id
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
    if let Some(method_id) = account.2 {
        let updated = sqlx::query(
            r#"
            UPDATE authentication_method
            SET status = 'disabled',
                disabled_at = COALESCE(disabled_at, $2)
            WHERE method_id = $1
              AND principal_user_id = $3
            "#,
        )
        .bind(method_id)
        .bind(now)
        .bind(account.0.as_str())
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(ApiError::Reject {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                error: RejectCode::Internal,
                message: "classic account method ownership is invalid".to_string(),
            });
        }
    }
    let revoked_session_count = sqlx::query(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE revoked_at IS NULL
          AND expires_at > $1
          AND (
              ($3::UUID IS NOT NULL AND authenticated_via_method_id = $3)
              OR ($3::UUID IS NULL AND principal_user_id = $2)
          )
        "#,
    )
    .bind(now)
    .bind(account.0.as_str())
    .bind(account.2)
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
        VALUES ($1, 'account_disabled', $2, $3, NULL, NULL, $4::JSONB)
        "#,
    )
    .bind(now)
    .bind(actor_user_id.as_str())
    .bind(account.0.as_str())
    .bind(
        serde_json::json!({
            "account_id": account_id,
            "method_id": account.2,
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
    State(state): State<AuthHttpState>,
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
    let account = sqlx::query_as::<_, (String, Option<i64>, Option<Uuid>)>(
        r#"
        SELECT principal_user_id, disabled_at, method_id
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
    if let Some(method_id) = account.2 {
        let updated = sqlx::query(
            r#"
            UPDATE authentication_method
            SET status = 'active', disabled_at = NULL
            WHERE method_id = $1
              AND principal_user_id = $2
            "#,
        )
        .bind(method_id)
        .bind(account.0.as_str())
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(ApiError::Reject {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                error: RejectCode::Internal,
                message: "classic account method ownership is invalid".to_string(),
            });
        }
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
            "method_id": account.2,
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
    State(state): State<AuthHttpState>,
    headers: HeaderMap,
    Json(_request): Json<RotateAuthSession>,
) -> Result<Json<AuthSessionResponse>, ApiError> {
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let rotated =
        identity::session::rotate_session(&state.pool, caller_token, &state.session_policy).await?;
    let mut response = auth_session_response(
        &state,
        rotated.context.principal_user_id,
        None,
        rotated.context.global_capabilities,
    )
    .await?;
    response.session_token = Some(rotated.issued.session_token);
    response.created_at = Some(rotated.context.created_at);
    response.expires_at = Some(rotated.context.expires_at);
    response.idle_expires_at = Some(rotated.context.idle_expires_at);
    Ok(Json(response))
}

async fn logout_auth_session(
    State(state): State<AuthHttpState>,
    headers: HeaderMap,
) -> Result<Json<AuthLifecycleResponse>, ApiError> {
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let now = unix_now_seconds();
    let mut tx = state.pool.begin().await?;
    let authorization = identity::session::validate_session_for_update(
        &mut tx,
        caller_token,
        &state.session_policy,
    )
    .await?;
    let revoked = sqlx::query(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE token_hash = $2
          AND revoked_at IS NULL
        "#,
    )
    .bind(now)
    .bind(authorization.session_reference.as_str())
    .execute(&mut *tx)
    .await?;
    if revoked.rows_affected() != 1 {
        return Err(unauthorized_session());
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
        VALUES ($1, 'session_logged_out', $2, $3, $4, NULL, '{}'::JSONB)
        "#,
    )
    .bind(now)
    .bind(authorization.principal_user_id.as_str())
    .bind(authorization.principal_user_id.as_str())
    .bind(authorization.session_reference)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(AuthLifecycleResponse {
        status: "logged_out".to_string(),
        principal_user_id: authorization.principal_user_id,
    }))
}

async fn revoke_auth_session(
    State(state): State<AuthHttpState>,
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
    State(state): State<AuthHttpState>,
    headers: HeaderMap,
    Json(request): Json<CreateAuthInvite>,
) -> Result<Json<AuthInviteResponse>, ApiError> {
    require_classic_enabled(&state)?;
    let caller_token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let caller = authorization_context(&state, caller_token).await?;
    let caller_is_global_admin = caller
        .global_capabilities
        .iter()
        .any(|capability| capability == "GlobalAdmin");
    let invited_by_user_id = caller.principal_user_id;

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
    let maximum_invite_expiry = state.session_policy.classic_expiry(now);
    if request.expires_at <= now || request.expires_at > maximum_invite_expiry {
        return Err(ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::Internal,
            message: "invite expiry must be in the future and within the session policy"
                .to_string(),
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
        &AuthCredentialDeliveryRequest {
            delivery_kind: IdentityDeliveryKind::Invite,
            account_id,
            principal_user_id: account_principal_user_id.as_str(),
            credential_hash: invite_hash.as_str(),
            credential_material: invite_token,
            credential_expires_at: request.expires_at,
            now,
        },
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
    State(state): State<AuthHttpState>,
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
        &mut tx,
        account_id,
        invite.0.as_str(),
        &invite.2,
        now,
    )
    .await?;
    let session_expires_at = state.session_policy.classic_expiry(now);
    let issued = identity::session::issue_session(
        &mut tx,
        identity::SessionSpec {
            principal_user_id: invite.0.as_str(),
            session_capabilities: &invite.2,
            authenticated_via_method_id: Some(method_id),
            assurance: identity::Assurance::Password,
            authenticated_at: now,
            expires_at: session_expires_at,
            idle_expires_at: state.session_policy.idle_expiry(now, session_expires_at),
        },
        now,
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
    State(state): State<AuthHttpState>,
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
    State(state): State<AuthHttpState>,
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
    State(state): State<AuthHttpState>,
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
    State(state): State<AuthHttpState>,
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
    state: &AuthHttpState,
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

pub(super) fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|token| !token.is_empty())
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

fn require_classic_enabled(state: &AuthHttpState) -> Result<(), ApiError> {
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
    identity: &AuthorizationContext,
    now: i64,
) -> Result<(), ApiError> {
    identity::methods::require_recent_authentication(
        identity.authenticated_at,
        now,
        auth_recent_max_age_seconds(),
    )?;
    Ok(())
}

pub(super) fn env_i64(name: &str, default: i64, minimum: i64, maximum: i64) -> i64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(default)
        .clamp(minimum, maximum)
}

async fn authenticated_account_principal_for_update(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    authorization: &AuthorizationContext,
    account_id: &str,
    current_password: &str,
) -> Result<String, ApiError> {
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
    if account.0 != authorization.principal_user_id
        || !verify_account_password(account.1.as_str(), current_password).await?
    {
        return Err(unauthorized_account());
    }
    Ok(authorization.principal_user_id.clone())
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

pub(super) async fn require_global_admin(
    state: &AuthHttpState,
    token: &str,
    action: &str,
) -> Result<String, ApiError> {
    let authorization = authorization_context(state, token).await?;
    if !authorization
        .global_capabilities
        .iter()
        .any(|capability| capability == "GlobalAdmin")
    {
        return Err(ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: format!("{action} requires GlobalAdmin"),
        });
    }
    Ok(authorization.principal_user_id)
}

pub(super) async fn require_global_operator(
    state: &AuthHttpState,
    token: &str,
    action: &str,
) -> Result<String, ApiError> {
    let authorization = authorization_context(state, token).await?;
    if !authorization
        .global_capabilities
        .iter()
        .any(|capability| matches!(capability.as_str(), "GlobalAdmin" | "GlobalMod"))
    {
        return Err(ApiError::Reject {
            status: StatusCode::FORBIDDEN,
            error: RejectCode::NotAuthorized,
            message: format!("{action} requires GlobalAdmin or GlobalMod"),
        });
    }
    Ok(authorization.principal_user_id)
}

pub(super) fn unauthorized_session() -> ApiError {
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

pub(super) fn unauthorized_account() -> ApiError {
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

pub(super) fn rate_limited(retry_after_seconds: i64) -> ApiError {
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

pub(super) fn hash_session_token(token: &str) -> String {
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

pub(super) fn internal_auth_error(message: String) -> ApiError {
    ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message,
    }
}

pub(super) fn unix_now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
