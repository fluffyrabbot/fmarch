use sqlx::{PgConnection, PgPool};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::error::IdentityFlowError;
use crate::token::{generate_session_token, hash_token, APP_SESSION_TOKEN_PREFIX};
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

    pub fn idle_expiry(&self, now: i64, expires_at: i64) -> i64 {
        now.saturating_add(self.idle_ttl_seconds).min(expires_at)
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
    pub idle_expires_at: i64,
}

#[derive(Debug, Clone)]
pub struct IssuedSession {
    pub session_token: String,
    pub token_hash: String,
    pub principal_user_id: String,
    pub expires_at: i64,
    pub idle_expires_at: i64,
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
    if spec.idle_expires_at <= now || spec.idle_expires_at > spec.expires_at {
        return Err(IdentityFlowError::Invalid(
            "session idle expiry must be in the future and no later than absolute expiry"
                .to_string(),
        ));
    }
    let session_token = generate_session_token();
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
            assurance,
            authenticated_at
        )
        VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9)
        "#,
    )
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

/// Canonical request authorization resolved from one eligible backend-owned
/// app session. `session_reference` is the stored token hash, never a bearer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizationContext {
    pub principal_user_id: String,
    pub global_capabilities: Vec<String>,
    pub method: Option<(Uuid, MethodKind)>,
    pub assurance: Assurance,
    pub session_reference: String,
    pub created_at: i64,
    pub authenticated_at: i64,
    pub expires_at: i64,
    pub idle_expires_at: i64,
}

/// A successful atomic session rotation. Both references are hashes suitable
/// for lifecycle audit correlation; only `issued.session_token` is a bearer.
#[derive(Debug, Clone)]
pub struct RotatedSession {
    pub previous_session_reference: String,
    pub issued: IssuedSession,
    pub context: AuthorizationContext,
}

#[derive(Debug)]
struct EligibleSession {
    context: AuthorizationContext,
    session_capabilities: Vec<String>,
}

/// Validate a canonical app-session bearer. Prefix lookalikes and legacy
/// client-selected credentials are rejected before their hash reaches the
/// database.
pub async fn validate_session(
    pool: &PgPool,
    token: &str,
    policy: &SessionPolicy,
    now: i64,
) -> Result<AuthorizationContext, IdentityFlowError> {
    if !is_canonical_app_session_token(token) {
        return Err(IdentityFlowError::Unauthorized);
    }
    validate_session_reference(pool, hash_token(token).as_str(), policy, now).await
}

/// Validate and lock one canonical app session inside a caller-owned
/// transaction. Security-sensitive mutations use this entry point so session,
/// principal, method, assurance, absolute-expiry, and idle-expiry checks cannot
/// be replaced by a weaker ad-hoc lookup between authorization and mutation.
pub async fn validate_session_for_update(
    conn: &mut PgConnection,
    token: &str,
    policy: &SessionPolicy,
) -> Result<AuthorizationContext, IdentityFlowError> {
    if !is_canonical_app_session_token(token) {
        return Err(IdentityFlowError::Unauthorized);
    }
    let session_reference = hash_token(token);
    let principal_user_id = discover_session_principal(conn, session_reference.as_str()).await?;
    let owner = crate::methods::lock_identity_mutation(
        conn,
        principal_user_id.as_str(),
        crate::methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    Ok(
        lock_eligible_session(conn, session_reference.as_str(), policy)
            .await?
            .context,
    )
}

/// Validate a trusted stored session reference, such as one captured by a
/// single-use websocket ticket. Callers must not treat hashes as bearer
/// credentials; raw request authentication goes through [`validate_session`].
pub async fn validate_session_reference(
    pool: &PgPool,
    session_reference: &str,
    policy: &SessionPolicy,
    now: i64,
) -> Result<AuthorizationContext, IdentityFlowError> {
    if !is_canonical_session_reference(session_reference) {
        return Err(IdentityFlowError::Unauthorized);
    }
    let mut conn = pool.acquire().await?;
    Ok(
        load_eligible_session(&mut conn, session_reference, policy, now, true)
            .await?
            .context,
    )
}

/// Replace one eligible canonical app session under a row lock. The successor
/// receives a server-generated credential, retains the authentication ceremony
/// and absolute deadline, and starts a fresh bounded idle window. Revocation,
/// insertion, and lifecycle audit commit atomically.
pub async fn rotate_session(
    pool: &PgPool,
    token: &str,
    policy: &SessionPolicy,
) -> Result<RotatedSession, IdentityFlowError> {
    if !is_canonical_app_session_token(token) {
        return Err(IdentityFlowError::Unauthorized);
    }
    let previous_session_reference = hash_token(token);
    let mut tx = pool.begin().await?;
    let principal_user_id =
        discover_session_principal(&mut tx, previous_session_reference.as_str()).await?;
    let owner = crate::methods::lock_identity_mutation(
        &mut tx,
        principal_user_id.as_str(),
        crate::methods::IdentityMutationExtent::Authentication,
    )
    .await?;
    owner.require_active()?;
    let eligible =
        lock_eligible_session(&mut tx, previous_session_reference.as_str(), policy).await?;
    let now = unix_now_seconds();

    let session_token = generate_session_token();
    let token_hash = hash_token(session_token.as_str());
    let idle_expires_at = policy.idle_expiry(now, eligible.context.expires_at);

    let revoked = sqlx::query(
        r#"
        UPDATE auth_session
        SET revoked_at = $1
        WHERE token_hash = $2
          AND revoked_at IS NULL
        "#,
    )
    .bind(now)
    .bind(previous_session_reference.as_str())
    .execute(&mut *tx)
    .await?;
    if revoked.rows_affected() != 1 {
        return Err(IdentityFlowError::Unauthorized);
    }

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
    .bind(token_hash.as_str())
    .bind(eligible.context.principal_user_id.as_str())
    .bind(now)
    .bind(eligible.context.expires_at)
    .bind(&eligible.session_capabilities)
    .bind(eligible.context.method.map(|(method_id, _)| method_id))
    .bind(idle_expires_at)
    .bind(eligible.context.assurance.as_str())
    .bind(eligible.context.authenticated_at)
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
    .bind(eligible.context.principal_user_id.as_str())
    .bind(eligible.context.principal_user_id.as_str())
    .bind(previous_session_reference.as_str())
    .bind(token_hash.as_str())
    .bind(
        serde_json::json!({
            "session_expires_at": eligible.context.expires_at,
            "global_capability_count": eligible.session_capabilities.len()
        })
        .to_string(),
    )
    .execute(&mut *tx)
    .await?;

    let issued = IssuedSession {
        session_token,
        token_hash: token_hash.clone(),
        principal_user_id: eligible.context.principal_user_id.clone(),
        expires_at: eligible.context.expires_at,
        idle_expires_at,
    };
    let context = AuthorizationContext {
        session_reference: token_hash,
        created_at: now,
        idle_expires_at,
        ..eligible.context
    };
    tx.commit().await?;
    Ok(RotatedSession {
        previous_session_reference,
        issued,
        context,
    })
}

/// Resolve only the owner identifier before taking any row lock. The binding
/// is deliberately untrusted until the canonical owner-first mutation lock is
/// held and [`lock_eligible_session`] revalidates the session.
async fn discover_session_principal(
    conn: &mut PgConnection,
    session_reference: &str,
) -> Result<String, IdentityFlowError> {
    sqlx::query_scalar("SELECT principal_user_id FROM auth_session WHERE token_hash = $1")
        .bind(session_reference)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(IdentityFlowError::Unauthorized)
}

async fn lock_eligible_session(
    conn: &mut PgConnection,
    session_reference: &str,
    policy: &SessionPolicy,
) -> Result<EligibleSession, IdentityFlowError> {
    sqlx::query_scalar::<_, String>(
        r#"
        SELECT token_hash
        FROM auth_session
        WHERE token_hash = $1
          AND revoked_at IS NULL
        FOR UPDATE
        "#,
    )
    .bind(session_reference)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    let now = unix_now_seconds();
    load_eligible_session(conn, session_reference, policy, now, false).await
}

/// One eligibility implementation for raw bearer validation, trusted
/// reference validation, and locked rotation. Principal and method rows are
/// deliberately re-read on every use rather than snapshotted into a token.
async fn load_eligible_session(
    conn: &mut PgConnection,
    session_reference: &str,
    policy: &SessionPolicy,
    now: i64,
    slide_idle: bool,
) -> Result<EligibleSession, IdentityFlowError> {
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
            Option<i64>,
            String,
            Option<i64>,
            Vec<String>,
            i64,
        ),
    >(ELIGIBLE_SESSION_SQL)
    .bind(session_reference)
    .bind(now)
    .fetch_optional(&mut *conn)
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
        method_principal_user_id,
        method_kind,
        method_status,
        method_disabled_at,
        principal_status,
        principal_disabled_at,
        principal_globals,
        authenticated_at,
    ) = row;
    if principal_status != "active" || principal_disabled_at.is_some() {
        return Err(IdentityFlowError::Unauthorized);
    }
    let assurance = assurance
        .as_deref()
        .and_then(Assurance::parse)
        .ok_or(IdentityFlowError::Unauthorized)?;
    let method = match method_id {
        Some(method_id) => {
            if method_principal_user_id.as_deref() != Some(principal_user_id.as_str())
                || method_status.as_deref() != Some("active")
                || method_disabled_at.is_some()
            {
                return Err(IdentityFlowError::Unauthorized);
            }
            let kind = method_kind
                .as_deref()
                .and_then(MethodKind::parse)
                .ok_or(IdentityFlowError::Unauthorized)?;
            let expected_assurance = match kind {
                MethodKind::ClassicPassword => Assurance::Password,
                MethodKind::Workos => Assurance::ExternalSso,
            };
            if assurance != expected_assurance {
                return Err(IdentityFlowError::Unauthorized);
            }
            Some((method_id, kind))
        }
        None => {
            if !matches!(assurance, Assurance::Dev | Assurance::AdminGrant) {
                return Err(IdentityFlowError::Unauthorized);
            }
            None
        }
    };

    let mut effective_idle_expires_at = idle_expires_at.ok_or(IdentityFlowError::Unauthorized)?;
    if slide_idle {
        let current_idle_expires_at = effective_idle_expires_at;
        let elapsed = policy
            .idle_ttl_seconds
            .saturating_sub(current_idle_expires_at.saturating_sub(now));
        if elapsed > policy.idle_ttl_seconds / 4 {
            let next_idle_expires_at = policy.idle_expiry(now, expires_at);
            if next_idle_expires_at > current_idle_expires_at {
                let updated = sqlx::query(
                    r#"
                        UPDATE auth_session
                        SET idle_expires_at = $2
                        WHERE token_hash = $1
                          AND revoked_at IS NULL
                          AND idle_expires_at = $3
                        "#,
                )
                .bind(session_reference)
                .bind(next_idle_expires_at)
                .bind(current_idle_expires_at)
                .execute(&mut *conn)
                .await?;
                if updated.rows_affected() == 1 {
                    effective_idle_expires_at = next_idle_expires_at;
                }
            }
        }
    }

    let mut global_capabilities = principal_globals;
    for capability in &snapshot_globals {
        if !global_capabilities.contains(capability) {
            global_capabilities.push(capability.clone());
        }
    }

    Ok(EligibleSession {
        context: AuthorizationContext {
            principal_user_id,
            global_capabilities,
            method,
            assurance,
            session_reference: session_reference.to_string(),
            created_at,
            authenticated_at,
            expires_at,
            idle_expires_at: effective_idle_expires_at,
        },
        session_capabilities: snapshot_globals,
    })
}

const ELIGIBLE_SESSION_SQL: &str = r#"
    SELECT session.principal_user_id,
           session.global_capabilities,
           session.created_at,
           session.expires_at,
           session.idle_expires_at,
           session.assurance,
           session.authenticated_via_method_id,
           method.principal_user_id,
           method.kind,
           method.status,
           method.disabled_at,
           principal.status,
           principal.disabled_at,
           principal.global_capabilities,
           session.authenticated_at
    FROM auth_session AS session
    INNER JOIN platform_principal AS principal
      ON principal.principal_user_id = session.principal_user_id
    LEFT JOIN authentication_method AS method
      ON method.method_id = session.authenticated_via_method_id
    WHERE session.token_hash = $1
      AND session.revoked_at IS NULL
      AND session.expires_at > $2
      AND session.idle_expires_at > $2
    "#;

fn is_canonical_app_session_token(token: &str) -> bool {
    token
        .strip_prefix(APP_SESSION_TOKEN_PREFIX)
        .is_some_and(is_lower_hex_256)
}

fn is_canonical_session_reference(reference: &str) -> bool {
    is_lower_hex_256(reference)
}

fn is_lower_hex_256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn unix_now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
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

#[cfg(test)]
mod tests {
    use super::{is_canonical_app_session_token, is_canonical_session_reference};
    use crate::token::{generate_session_token, hash_token};

    #[test]
    fn raw_validation_accepts_only_the_server_token_shape() {
        let canonical = generate_session_token();
        assert!(is_canonical_app_session_token(canonical.as_str()));
        assert!(is_canonical_session_reference(
            hash_token(canonical.as_str()).as_str()
        ));

        for invalid in [
            "fmss_",
            "fmss_short",
            "fmss_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "fmss_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "fmss_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "fmss_gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
            "legacy-client-selected-token",
        ] {
            assert!(!is_canonical_app_session_token(invalid), "{invalid}");
        }
    }
}
