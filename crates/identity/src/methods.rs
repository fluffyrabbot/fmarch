use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::error::IdentityFlowError;
use crate::session::revoke_sessions_for_method;
use crate::{MethodKind, PrincipalId};

const CLASSIC_METHOD_UNIQUE_INDEX: &str = "authentication_method_classic_unique";

/// Sensitive method-lifecycle operations require a session younger than this
/// unless the caller re-verified a credential in the same request.
pub fn require_recent_authentication(
    session_created_at: i64,
    now: i64,
    max_age_seconds: i64,
) -> Result<(), IdentityFlowError> {
    if now.saturating_sub(session_created_at) > max_age_seconds {
        return Err(IdentityFlowError::RecentAuthRequired);
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct MethodSummary {
    pub method_id: Uuid,
    pub kind: MethodKind,
    pub status: String,
    pub created_at: i64,
    pub last_authenticated_at: Option<i64>,
    pub login_name: Option<String>,
    pub display_label: Option<String>,
}

pub async fn list_methods(
    pool: &PgPool,
    principal_id: &PrincipalId,
) -> Result<Vec<MethodSummary>, IdentityFlowError> {
    let rows = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            String,
            i64,
            Option<i64>,
            Option<String>,
            Option<String>,
        ),
    >(
        r#"
        SELECT method.method_id,
               method.kind,
               method.status,
               method.created_at,
               method.last_authenticated_at,
               account.account_id,
               external.display_label
        FROM authentication_method AS method
        LEFT JOIN auth_account AS account ON account.method_id = method.method_id
        LEFT JOIN external_identity AS external ON external.method_id = method.method_id
        WHERE method.principal_id = $1
        ORDER BY method.created_at, method.method_id
        "#,
    )
    .bind(principal_id.as_uuid())
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .filter_map(
            |(method_id, kind, status, created_at, last_authenticated_at, login_name, label)| {
                Some(MethodSummary {
                    method_id,
                    kind: MethodKind::parse(kind.as_str())?,
                    status,
                    created_at,
                    last_authenticated_at,
                    login_name,
                    display_label: label,
                })
            },
        )
        .collect())
}

#[derive(Debug, Clone)]
pub struct DisabledMethod {
    pub method_id: Uuid,
    pub kind: MethodKind,
    pub revoked_session_count: u64,
}

/// Disable one of the caller's authentication methods. An active principal
/// must retain at least one active method, and sessions authenticated through
/// the disabled method are revoked in the same transaction. Classic detail
/// rows mirror the disablement so credential login fails closed.
pub async fn disable_method(
    conn: &mut PgConnection,
    principal_id: &PrincipalId,
    method_id: Uuid,
    now: i64,
) -> Result<DisabledMethod, IdentityFlowError> {
    let methods = sqlx::query_as::<_, (Uuid, String, String)>(
        r#"
        SELECT method_id, kind, status
        FROM authentication_method
        WHERE principal_id = $1
        FOR UPDATE
        "#,
    )
    .bind(principal_id.as_uuid())
    .fetch_all(&mut *conn)
    .await?;
    let target = methods
        .iter()
        .find(|(id, _, _)| *id == method_id)
        .ok_or(IdentityFlowError::Unauthorized)?;
    if target.2 != "active" {
        return Err(IdentityFlowError::Invalid(
            "authentication method is already disabled".to_string(),
        ));
    }
    let kind = MethodKind::parse(target.1.as_str()).ok_or_else(|| {
        IdentityFlowError::Internal(format!("unknown authentication method kind: {}", target.1))
    })?;
    let other_active = methods
        .iter()
        .filter(|(id, _, status)| *id != method_id && status == "active")
        .count();
    if other_active == 0 {
        return Err(IdentityFlowError::LastActiveMethod);
    }
    if kind == MethodKind::Workos {
        // A disabled method may later be reactivated through a fresh provider
        // ceremony. Permanently seal every older provider session first so an
        // unused sibling assertion cannot become valid again after that
        // reactivation.
        sqlx::query(
            r#"
            WITH sealed AS (
                UPDATE workos_provider_session
                SET status = 'logged_out',
                    logged_out_at = GREATEST($2, last_seen_at)
                WHERE method_id = $1
                  AND principal_id = $3
                  AND status = 'active'
                RETURNING provider_session_id, logged_out_at
            )
            INSERT INTO workos_provider_session_tombstone (
                provider_session_hash,
                tombstoned_at,
                reason
            )
            SELECT encode(
                       sha256(convert_to(provider_session_id, 'UTF8')),
                       'hex'
                   ),
                   logged_out_at,
                   'method_disabled'
            FROM sealed
            "#,
        )
        .bind(method_id)
        .bind(now)
        .bind(principal_id.as_uuid())
        .execute(&mut *conn)
        .await?;
    }
    sqlx::query(
        "UPDATE authentication_method SET status = 'disabled', disabled_at = $2 WHERE method_id = $1",
    )
    .bind(method_id)
    .bind(now)
    .execute(&mut *conn)
    .await?;
    if kind == MethodKind::ClassicPassword {
        sqlx::query(
            "UPDATE auth_account SET disabled_at = $2 WHERE method_id = $1 AND disabled_at IS NULL",
        )
        .bind(method_id)
        .bind(now)
        .execute(&mut *conn)
        .await?;
    }
    let revoked_session_count = revoke_sessions_for_method(&mut *conn, method_id, now).await?;
    Ok(DisabledMethod {
        method_id,
        kind,
        revoked_session_count,
    })
}

/// Insert the principal row when it does not exist yet. Existing principals
/// are left untouched — capabilities on an established principal are managed
/// by explicit grants, never by a sign-in path.
pub async fn ensure_principal(
    conn: &mut PgConnection,
    principal_id: &PrincipalId,
    global_capabilities: &[String],
    now: i64,
) -> Result<(), IdentityFlowError> {
    sqlx::query(
        r#"
        INSERT INTO platform_principal (
            principal_id,
            status,
            global_capabilities,
            created_at,
            disabled_at
        )
        VALUES ($1, 'active', $2, $3, NULL)
        ON CONFLICT (principal_id) DO NOTHING
        "#,
    )
    .bind(principal_id.as_uuid())
    .bind(global_capabilities)
    .bind(now)
    .execute(&mut *conn)
    .await?;
    lock_active_principal_and_subject(conn, principal_id, now).await?;
    Ok(())
}

/// Hold the canonical principal -> privacy-subject ownership locks for an
/// authentication transaction. Authentication methods and their provider
/// detail rows must only be locked after this returns.
pub(crate) async fn lock_active_principal_and_subject(
    conn: &mut PgConnection,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<Vec<String>, IdentityFlowError> {
    use crate::{active_subject_key_store, SubjectId};

    let principal = sqlx::query_as::<_, (String, Vec<String>)>(
        "SELECT status, global_capabilities FROM platform_principal WHERE principal_id = $1 FOR UPDATE",
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    let (principal_status, global_capabilities) = principal;
    if principal_status != "active" {
        return Err(IdentityFlowError::Unauthorized);
    }
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT lifecycle_state FROM privacy_subject WHERE principal_id = $1 FOR UPDATE",
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(lifecycle_state) = existing {
        return if lifecycle_state == "active" {
            Ok(global_capabilities)
        } else {
            Err(IdentityFlowError::Unauthorized)
        };
    }
    // Defensive restore guard: even if an older backup lacks the permanent
    // privacy_subject owner row, lifecycle facts prevent minting a new subject.
    let destroyed_subject: Option<Uuid> = sqlx::query_scalar(
        "SELECT subject_id FROM member_lifecycle_event WHERE principal_id = $1 AND subject_id IS NOT NULL ORDER BY seq DESC LIMIT 1",
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut *conn)
    .await?;
    if destroyed_subject.is_some() {
        return Err(IdentityFlowError::Unauthorized);
    }

    let key_store = active_subject_key_store()
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let candidate = SubjectId::random();
    key_store
        .create(candidate)
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let inserted = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO privacy_subject (subject_id, principal_id, created_at) VALUES ($1,$2,$3) ON CONFLICT (principal_id) DO NOTHING RETURNING subject_id",
    )
    .bind(candidate.as_uuid())
    .bind(principal_id.as_uuid())
    .bind(now)
    .fetch_optional(&mut *conn)
    .await?;
    if inserted.is_none() {
        key_store
            .destroy(candidate)
            .await
            .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    }
    Ok(global_capabilities)
}

/// How far an identity mutation must advance through the canonical row-lock
/// order. Skipping a group is safe when the mutation never reads or writes
/// that group; callers must not acquire a skipped earlier group later.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityMutationExtent {
    Owner,
    Authentication,
    Complete,
}

/// Owner state captured while the canonical identity mutation locks are held.
/// Callers use this to revalidate a non-locking identifier discovery after
/// serialization with erasure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityMutationOwner {
    pub principal_id: PrincipalId,
    pub principal_status: String,
    pub global_capabilities: Vec<String>,
    pub subject_id: Uuid,
    pub subject_lifecycle_state: String,
}

impl IdentityMutationOwner {
    pub fn require_active(&self) -> Result<(), IdentityFlowError> {
        if self.principal_status == "active" && self.subject_lifecycle_state == "active" {
            Ok(())
        } else {
            Err(IdentityFlowError::Unauthorized)
        }
    }
}

/// Serialize every identity mutation on its owner before taking subordinate
/// locks. The order is deliberately centralized here:
///
/// principal -> privacy subject -> sessions -> methods -> accounts ->
/// recovery/invites/delivery -> external identities -> projections.
///
/// Identifiers such as a session hash, account id, invite hash, or recovery
/// hash must be discovered without a row lock, then their owner is passed here.
/// The caller must re-read and validate the identifier after this returns.
pub async fn lock_identity_mutation(
    conn: &mut PgConnection,
    principal_id: &PrincipalId,
    extent: IdentityMutationExtent,
) -> Result<IdentityMutationOwner, IdentityFlowError> {
    let (principal_status, global_capabilities) = sqlx::query_as::<_, (String, Vec<String>)>(
        r#"
            SELECT status, global_capabilities
            FROM platform_principal
            WHERE principal_id = $1
            FOR UPDATE
            "#,
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    let (subject_id, subject_lifecycle_state) = sqlx::query_as::<_, (Uuid, String)>(
        r#"
        SELECT subject_id, lifecycle_state
        FROM privacy_subject
        WHERE principal_id = $1
        FOR UPDATE
        "#,
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;

    if matches!(
        extent,
        IdentityMutationExtent::Authentication | IdentityMutationExtent::Complete
    ) {
        // Sessions (including credentials derived from a session).
        sqlx::query_scalar::<_, String>(
            "SELECT token_hash FROM auth_session WHERE principal_id = $1 ORDER BY token_hash FOR UPDATE",
        )
        .bind(principal_id.as_uuid())
        .fetch_all(&mut *conn)
        .await?;
        sqlx::query_scalar::<_, String>(
            "SELECT token_hash FROM auth_websocket_ticket WHERE principal_id = $1 ORDER BY token_hash FOR UPDATE",
        )
        .bind(principal_id.as_uuid())
        .fetch_all(&mut *conn)
        .await?;

        // Authentication methods.
        sqlx::query_scalar::<_, Uuid>(
            "SELECT method_id FROM authentication_method WHERE principal_id = $1 ORDER BY method_id FOR UPDATE",
        )
        .bind(principal_id.as_uuid())
        .fetch_all(&mut *conn)
        .await?;

        // Classic account details.
        sqlx::query_scalar::<_, String>(
            "SELECT account_id FROM auth_account WHERE principal_id = $1 ORDER BY account_id FOR UPDATE",
        )
        .bind(principal_id.as_uuid())
        .fetch_all(&mut *conn)
        .await?;

        // One-time recovery, invite, and delivery material.
        sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT recovery.recovery_id
            FROM auth_account_recovery_credential AS recovery
            JOIN auth_account AS account USING (account_id)
            WHERE account.principal_id = $1
            ORDER BY recovery.recovery_id
            FOR UPDATE OF recovery
            "#,
        )
        .bind(principal_id.as_uuid())
        .fetch_all(&mut *conn)
        .await?;
        sqlx::query_scalar::<_, String>(
            "SELECT token_hash FROM auth_invite WHERE principal_id = $1 ORDER BY token_hash FOR UPDATE",
        )
        .bind(principal_id.as_uuid())
        .fetch_all(&mut *conn)
        .await?;
        sqlx::query_scalar::<_, Uuid>(
            "SELECT delivery_id FROM auth_delivery_intent WHERE principal_id = $1 ORDER BY delivery_id FOR UPDATE",
        )
        .bind(principal_id.as_uuid())
        .fetch_all(&mut *conn)
        .await?;
    }

    if extent == IdentityMutationExtent::Complete {
        // External identity details come after all local authentication rows.
        sqlx::query_as::<_, (String, String)>(
            "SELECT provider, subject FROM external_identity WHERE principal_id = $1 ORDER BY provider, subject FOR UPDATE",
        )
        .bind(principal_id.as_uuid())
        .fetch_all(&mut *conn)
        .await?;

        // Lifecycle projection is the serialization point for event appends
        // and rebuilds. Subject ownership already excludes new sealed claims.
        sqlx::query_scalar::<_, Uuid>(
            "SELECT principal_id FROM member_lifecycle_projection WHERE principal_id = $1 FOR UPDATE",
        )
        .bind(principal_id.as_uuid())
        .fetch_optional(&mut *conn)
        .await?;
    }

    Ok(IdentityMutationOwner {
        principal_id: *principal_id,
        principal_status,
        global_capabilities,
        subject_id,
        subject_lifecycle_state,
    })
}

/// Create the umbrella row for a new authentication method. The partial unique
/// index rejects a second classic method on one principal.
pub async fn create_method(
    conn: &mut PgConnection,
    principal_id: &PrincipalId,
    kind: MethodKind,
    now: i64,
) -> Result<Uuid, IdentityFlowError> {
    let method_id = Uuid::new_v4();
    let inserted = sqlx::query(
        r#"
        INSERT INTO authentication_method (
            method_id,
            principal_id,
            kind,
            status,
            created_at,
            disabled_at,
            last_authenticated_at
        )
        VALUES ($1, $2, $3, 'active', $4, NULL, NULL)
        "#,
    )
    .bind(method_id)
    .bind(principal_id.as_uuid())
    .bind(kind.as_str())
    .bind(now)
    .execute(&mut *conn)
    .await;
    match inserted {
        Ok(_) => Ok(method_id),
        Err(sqlx::Error::Database(db_error))
            if db_error.constraint() == Some(CLASSIC_METHOD_UNIQUE_INDEX) =>
        {
            Err(IdentityFlowError::AlreadyExists(
                "a classic authentication method for this principal",
            ))
        }
        Err(error) => Err(error.into()),
    }
}

pub async fn touch_method(
    conn: &mut PgConnection,
    method_id: Uuid,
    now: i64,
) -> Result<(), IdentityFlowError> {
    sqlx::query("UPDATE authentication_method SET last_authenticated_at = $2 WHERE method_id = $1")
        .bind(method_id)
        .bind(now)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Lock and touch an already-established active classic method.
///
/// The account detail row owns an immutable non-null method reference from its
/// first insert. Authentication may never create or attach a method as a
/// recovery path: a malformed or incomplete stored owner fails closed instead.
pub async fn touch_active_classic_method(
    conn: &mut PgConnection,
    account_id: &str,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<Uuid, IdentityFlowError> {
    let method = sqlx::query_as::<_, (Uuid, Uuid, String, String)>(
        r#"
        SELECT method.method_id, method.principal_id, method.kind, method.status
        FROM auth_account AS account
        JOIN authentication_method AS method ON method.method_id = account.method_id
        WHERE account.account_id = $1
          AND account.principal_id = $2
          AND account.disabled_at IS NULL
        FOR UPDATE OF account, method
        "#,
    )
    .bind(account_id)
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(IdentityFlowError::Unauthorized)?;
    let (method_id, method_principal_id, kind, status) = method;
    if method_principal_id != principal_id.as_uuid()
        || kind != MethodKind::ClassicPassword.as_str()
        || status != "active"
    {
        return Err(IdentityFlowError::Unauthorized);
    }
    touch_method(conn, method_id, now).await?;
    Ok(method_id)
}
