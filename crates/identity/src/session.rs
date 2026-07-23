use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::error::IdentityFlowError;
use crate::token::{generate_session_token, hash_token};
use crate::{Assurance, MethodKind};

/// Backend-owned session lifetimes. Classic and WorkOS sessions share one
/// storage shape; WorkOS sessions default shorter because provider revocation
/// only takes effect at local expiry.
#[derive(Debug, Clone)]
pub struct SessionPolicy {
    pub absolute_ttl_seconds: i64,
    pub workos_absolute_ttl_seconds: i64,
    pub idle_ttl_seconds: i64,
}

impl SessionPolicy {
    pub fn from_env() -> Self {
        SessionPolicy {
            absolute_ttl_seconds: bounded_env_i64(
                "FMARCH_SESSION_TTL_SECONDS",
                60 * 60 * 24 * 30,
                60,
                60 * 60 * 24 * 365,
            ),
            workos_absolute_ttl_seconds: bounded_env_i64(
                "FMARCH_WORKOS_SESSION_TTL_SECONDS",
                60 * 60 * 24,
                60,
                60 * 60 * 24 * 365,
            ),
            idle_ttl_seconds: bounded_env_i64(
                "FMARCH_SESSION_IDLE_TTL_SECONDS",
                60 * 60 * 24 * 7,
                60,
                60 * 60 * 24 * 365,
            ),
        }
    }

    pub fn classic_expiry(&self, now: i64) -> i64 {
        now.saturating_add(self.absolute_ttl_seconds)
    }

    pub fn workos_expiry(&self, now: i64) -> i64 {
        now.saturating_add(self.workos_absolute_ttl_seconds)
    }
}

fn bounded_env_i64(name: &str, default: i64, min: i64, max: i64) -> i64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(default)
        .clamp(min, max)
}

#[derive(Debug, Clone)]
pub struct SessionSpec<'a> {
    pub principal_user_id: &'a str,
    /// Capabilities granted only for this session (for example an invite or
    /// explicit admin session grant). Durable principal capabilities are
    /// always read from platform_principal during validation and must never be
    /// copied here by an ordinary sign-in.
    pub session_capabilities: &'a [String],
    pub authenticated_via_method_id: Option<Uuid>,
    pub assurance: Assurance,
    pub authenticated_at: i64,
    pub expires_at: i64,
    pub idle_expires_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct IssuedSession {
    pub session_token: String,
    pub token_hash: String,
    pub principal_user_id: String,
    pub expires_at: i64,
    pub idle_expires_at: Option<i64>,
}

pub async fn issue_session(
    conn: &mut PgConnection,
    spec: SessionSpec<'_>,
    now: i64,
) -> Result<IssuedSession, IdentityFlowError> {
    issue_session_with_token(conn, spec, now, generate_session_token(), false).await
}

/// Deterministic credential seam for debug-only proof harnesses. Internet-facing
/// server startup rejects dev auth in release builds; ordinary callers cannot
/// select session credentials.
pub async fn issue_debug_session(
    conn: &mut PgConnection,
    spec: SessionSpec<'_>,
    now: i64,
    session_token: &str,
) -> Result<IssuedSession, IdentityFlowError> {
    if !cfg!(debug_assertions) || session_token.trim().is_empty() {
        return Err(IdentityFlowError::Invalid(
            "deterministic dev sessions require a debug build and non-empty token".to_string(),
        ));
    }
    issue_session_with_token(conn, spec, now, session_token.to_string(), true).await
}

async fn issue_session_with_token(
    conn: &mut PgConnection,
    spec: SessionSpec<'_>,
    now: i64,
    session_token: String,
    replace_existing: bool,
) -> Result<IssuedSession, IdentityFlowError> {
    if spec.expires_at <= now {
        return Err(IdentityFlowError::Invalid(
            "session expiry must be in the future".to_string(),
        ));
    }
    let token_hash = hash_token(session_token.as_str());
    let insert = if replace_existing {
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
        ON CONFLICT (token_hash) DO UPDATE SET
            principal_user_id = EXCLUDED.principal_user_id,
            created_at = EXCLUDED.created_at,
            expires_at = EXCLUDED.expires_at,
            revoked_at = NULL,
            global_capabilities = EXCLUDED.global_capabilities,
            authenticated_via_method_id = EXCLUDED.authenticated_via_method_id,
            idle_expires_at = EXCLUDED.idle_expires_at,
            assurance = EXCLUDED.assurance,
            authenticated_at = EXCLUDED.authenticated_at
        "#
    } else {
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
        "#
    };
    sqlx::query(insert)
        .bind(&token_hash)
        .bind(spec.principal_user_id)
        .bind(now)
        .bind(spec.expires_at)
        .bind(spec.session_capabilities)
        .bind(spec.authenticated_via_method_id)
        .bind(spec.idle_expires_at)
        .bind(spec.assurance.as_str())
        .bind(spec.authenticated_at)
        .execute(&mut *conn)
        .await?;
    Ok(IssuedSession {
        session_token,
        token_hash,
        principal_user_id: spec.principal_user_id.to_string(),
        expires_at: spec.expires_at,
        idle_expires_at: spec.idle_expires_at,
    })
}

/// The authenticated identity behind a backend-issued app-session token.
#[derive(Debug, Clone)]
pub struct SessionIdentity {
    pub principal_user_id: String,
    pub global_capabilities: Vec<String>,
    pub method: Option<(Uuid, MethodKind)>,
    pub assurance: Option<Assurance>,
    pub token_hash: String,
    pub created_at: i64,
    pub authenticated_at: i64,
    pub expires_at: i64,
    pub idle_expires_at: Option<i64>,
}

/// Validate an app-session bearer: liveness, idle window, and — defense in
/// depth beyond explicit revocation — the backing method and principal must
/// still be active. Global capabilities are the union of the principal's
/// durable capabilities and the session-scoped grants: the principal row is
/// canonical authority, while the session grants preserve intentional
/// elevations (invite-granted and admin-granted capabilities) that
/// intentionally live only as long as the session. The idle window slides:
/// once a quarter of it has elapsed, a successful validation extends it,
/// bounding write amplification.
pub async fn validate_session(
    pool: &PgPool,
    token: &str,
    policy: &SessionPolicy,
    now: i64,
) -> Result<SessionIdentity, IdentityFlowError> {
    let token_hash = hash_token(token);
    let row = sqlx::query_as::<
        _,
        (
            String,
            Vec<String>,
            i64,
            i64,
            Option<i64>,
            Option<String>,
            Option<Uuid>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<Vec<String>>,
            i64,
        ),
    >(
        r#"
        SELECT session.principal_user_id,
               session.global_capabilities,
               session.created_at,
               session.expires_at,
               session.idle_expires_at,
               session.assurance,
               session.authenticated_via_method_id,
               method.kind,
               method.status,
               principal.status,
               principal.global_capabilities,
               session.authenticated_at
        FROM auth_session AS session
        LEFT JOIN authentication_method AS method
          ON method.method_id = session.authenticated_via_method_id
        LEFT JOIN platform_principal AS principal
          ON principal.principal_user_id = session.principal_user_id
        WHERE session.token_hash = $1
          AND session.revoked_at IS NULL
          AND session.expires_at > $2
          AND (session.idle_expires_at IS NULL OR session.idle_expires_at > $2)
        "#,
    )
    .bind(token_hash.as_str())
    .bind(now)
    .fetch_optional(pool)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;

    let (
        principal_user_id,
        snapshot_globals,
        created_at,
        expires_at,
        idle_expires_at,
        assurance,
        method_id,
        method_kind,
        method_status,
        principal_status,
        principal_globals,
        authenticated_at,
    ) = row;
    if let Some(status) = method_status.as_deref() {
        if status != "active" {
            return Err(IdentityFlowError::Unauthorized);
        }
    }
    if let Some(status) = principal_status.as_deref() {
        if status != "active" {
            return Err(IdentityFlowError::Unauthorized);
        }
    }
    let method = match (
        method_id,
        method_kind.as_deref().and_then(MethodKind::parse),
    ) {
        (Some(method_id), Some(kind)) => Some((method_id, kind)),
        _ => None,
    };

    if let Some(idle_expires_at) = idle_expires_at {
        let elapsed = policy
            .idle_ttl_seconds
            .saturating_sub(idle_expires_at.saturating_sub(now));
        if elapsed > policy.idle_ttl_seconds / 4 {
            sqlx::query(
                r#"
                UPDATE auth_session
                SET idle_expires_at = $2
                WHERE token_hash = $1
                  AND revoked_at IS NULL
                "#,
            )
            .bind(token_hash.as_str())
            .bind(now.saturating_add(policy.idle_ttl_seconds))
            .execute(pool)
            .await?;
        }
    }

    let mut global_capabilities = principal_globals.unwrap_or_default();
    for capability in snapshot_globals {
        if !global_capabilities.contains(&capability) {
            global_capabilities.push(capability);
        }
    }

    Ok(SessionIdentity {
        principal_user_id,
        global_capabilities,
        method,
        assurance: assurance.as_deref().and_then(Assurance::parse),
        token_hash,
        created_at,
        authenticated_at,
        expires_at,
        idle_expires_at,
    })
}

pub async fn revoke_sessions_for_principal(
    conn: &mut PgConnection,
    principal_user_id: &str,
    now: i64,
) -> Result<u64, IdentityFlowError> {
    let revoked = sqlx::query(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE principal_user_id = $2
          AND revoked_at IS NULL
          AND expires_at > $1
        "#,
    )
    .bind(now)
    .bind(principal_user_id)
    .execute(&mut *conn)
    .await?;
    Ok(revoked.rows_affected())
}

pub async fn revoke_sessions_for_method(
    conn: &mut PgConnection,
    method_id: Uuid,
    now: i64,
) -> Result<u64, IdentityFlowError> {
    let revoked = sqlx::query(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE authenticated_via_method_id = $2
          AND revoked_at IS NULL
          AND expires_at > $1
        "#,
    )
    .bind(now)
    .bind(method_id)
    .execute(&mut *conn)
    .await?;
    Ok(revoked.rows_affected())
}
