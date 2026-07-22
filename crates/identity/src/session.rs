use sqlx::PgConnection;
use uuid::Uuid;

use crate::error::IdentityFlowError;
use crate::token::{generate_session_token, hash_token};
use crate::Assurance;

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
    pub global_capabilities: &'a [String],
    pub authenticated_via_method_id: Option<Uuid>,
    pub assurance: Assurance,
    pub expires_at: i64,
    pub idle_expires_at: Option<i64>,
    /// Transitional: pre-refactor clients choose their own session token. When
    /// present it is honored (upsert semantics, matching the historic flows);
    /// when absent the backend generates the token. Removed once every caller
    /// reads the issued token from the response.
    pub client_supplied_token: Option<&'a str>,
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
    if spec.expires_at <= now {
        return Err(IdentityFlowError::Invalid(
            "session expiry must be in the future".to_string(),
        ));
    }
    let session_token = match spec.client_supplied_token {
        Some(token) => token.to_string(),
        None => generate_session_token(),
    };
    let token_hash = hash_token(session_token.as_str());
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
            assurance
        )
        VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8)
        ON CONFLICT (token_hash) DO UPDATE
        SET principal_user_id = EXCLUDED.principal_user_id,
            created_at = EXCLUDED.created_at,
            expires_at = EXCLUDED.expires_at,
            revoked_at = NULL,
            global_capabilities = EXCLUDED.global_capabilities,
            authenticated_via_method_id = EXCLUDED.authenticated_via_method_id,
            idle_expires_at = EXCLUDED.idle_expires_at,
            assurance = EXCLUDED.assurance
        "#,
    )
    .bind(&token_hash)
    .bind(spec.principal_user_id)
    .bind(now)
    .bind(spec.expires_at)
    .bind(spec.global_capabilities)
    .bind(spec.authenticated_via_method_id)
    .bind(spec.idle_expires_at)
    .bind(spec.assurance.as_str())
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
