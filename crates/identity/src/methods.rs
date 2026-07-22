use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::error::IdentityFlowError;
use crate::session::revoke_sessions_for_method;
use crate::MethodKind;

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
    principal_user_id: &str,
) -> Result<Vec<MethodSummary>, IdentityFlowError> {
    let rows = sqlx::query_as::<
        _,
        (Uuid, String, String, i64, Option<i64>, Option<String>, Option<String>),
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
        WHERE method.principal_user_id = $1
        ORDER BY method.created_at, method.method_id
        "#,
    )
    .bind(principal_user_id)
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
    principal_user_id: &str,
    method_id: Uuid,
    now: i64,
) -> Result<DisabledMethod, IdentityFlowError> {
    let methods = sqlx::query_as::<_, (Uuid, String, String)>(
        r#"
        SELECT method_id, kind, status
        FROM authentication_method
        WHERE principal_user_id = $1
        FOR UPDATE
        "#,
    )
    .bind(principal_user_id)
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
    sqlx::query(
        "UPDATE authentication_method SET status = 'disabled', disabled_at = $2 WHERE method_id = $1",
    )
    .bind(method_id)
    .bind(now)
    .execute(&mut *conn)
    .await?;
    if kind == MethodKind::ClassicPassword {
        sqlx::query("UPDATE auth_account SET disabled_at = $2 WHERE method_id = $1 AND disabled_at IS NULL")
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
    principal_user_id: &str,
    global_capabilities: &[String],
    now: i64,
) -> Result<(), IdentityFlowError> {
    sqlx::query(
        r#"
        INSERT INTO platform_principal (
            principal_user_id,
            status,
            global_capabilities,
            created_at,
            disabled_at
        )
        VALUES ($1, 'active', $2, $3, NULL)
        ON CONFLICT (principal_user_id) DO NOTHING
        "#,
    )
    .bind(principal_user_id)
    .bind(global_capabilities)
    .bind(now)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Create the umbrella row for a new authentication method. The partial unique
/// index rejects a second classic method on one principal.
pub async fn create_method(
    conn: &mut PgConnection,
    principal_user_id: &str,
    kind: MethodKind,
    now: i64,
) -> Result<Uuid, IdentityFlowError> {
    let method_id = Uuid::new_v4();
    let inserted = sqlx::query(
        r#"
        INSERT INTO authentication_method (
            method_id,
            principal_user_id,
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
    .bind(principal_user_id)
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
    sqlx::query(
        "UPDATE authentication_method SET last_authenticated_at = $2 WHERE method_id = $1",
    )
    .bind(method_id)
    .bind(now)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Resolve the workos method for an external identity, lazily upgrading rows
/// that predate the authentication_method umbrella. Returns the method id
/// backing this (provider, subject) identity.
pub async fn link_workos_method(
    conn: &mut PgConnection,
    subject: &str,
    principal_user_id: &str,
    now: i64,
) -> Result<Uuid, IdentityFlowError> {
    if let Some(method_id) = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT method_id FROM external_identity WHERE provider = 'workos' AND subject = $1",
    )
    .bind(subject)
    .fetch_one(&mut *conn)
    .await?
    {
        touch_method(conn, method_id, now).await?;
        return Ok(method_id);
    }
    let method_id = create_method(conn, principal_user_id, MethodKind::Workos, now).await?;
    sqlx::query(
        "UPDATE external_identity SET method_id = $2 WHERE provider = 'workos' AND subject = $1",
    )
    .bind(subject)
    .bind(method_id)
    .execute(&mut *conn)
    .await?;
    touch_method(conn, method_id, now).await?;
    Ok(method_id)
}

/// Resolve the classic method for an existing account, lazily upgrading rows
/// that predate the authentication_method umbrella: ensure the principal row,
/// create the method, and link auth_account.method_id — all in the caller's
/// transaction. Returns the method id backing this account.
pub async fn link_classic_method(
    conn: &mut PgConnection,
    account_id: &str,
    principal_user_id: &str,
    global_capabilities: &[String],
    now: i64,
) -> Result<Uuid, IdentityFlowError> {
    if let Some(method_id) = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT method_id FROM auth_account WHERE account_id = $1",
    )
    .bind(account_id)
    .fetch_one(&mut *conn)
    .await?
    {
        touch_method(conn, method_id, now).await?;
        return Ok(method_id);
    }
    ensure_principal(conn, principal_user_id, global_capabilities, now).await?;
    let method_id = create_method(conn, principal_user_id, MethodKind::ClassicPassword, now).await?;
    sqlx::query("UPDATE auth_account SET method_id = $2 WHERE account_id = $1")
        .bind(account_id)
        .bind(method_id)
        .execute(&mut *conn)
        .await?;
    touch_method(conn, method_id, now).await?;
    Ok(method_id)
}
