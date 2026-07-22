use sqlx::PgConnection;
use uuid::Uuid;

use crate::error::IdentityFlowError;
use crate::MethodKind;

const CLASSIC_METHOD_UNIQUE_INDEX: &str = "authentication_method_classic_unique";

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
