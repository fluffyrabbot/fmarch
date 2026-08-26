pub use database_schema::{
    ensure_schema_ready, inspect_schema_readiness, reconcile_database_authority,
    verify_database_principal, verify_migration_authority, DatabaseAuthorityError,
    DatabasePrincipal, SchemaReadiness, APPLICATION_DATABASE_ROLE, KEY_ADMIN_DATABASE_ROLE,
    MIGRATOR,
};

/// Reject every ambient libpq-style authority input. Matching the `PG` prefix
/// is deliberate: libpq adds variables over time, and a fixed allow/deny list
/// would silently inherit new connection, TLS, GSS, or startup-option inputs.
pub fn reject_ambient_postgres_environment(
    process_name: &str,
    sole_connection_variable: &str,
) -> Result<(), String> {
    if let Some(name) = std::env::vars_os()
        .map(|(name, _)| name.to_string_lossy().into_owned())
        .find(|name| name.starts_with("PG"))
    {
        return Err(format!(
            "{process_name} rejects ambient {name}; {sole_connection_variable} is the sole connection authority"
        ));
    }
    Ok(())
}

/// Require an explicit, non-downgradable PostgreSQL transport policy. Debug
/// tools may deliberately disable TLS only for a loopback endpoint; hosted and
/// release processes must use a protecting mode.
pub fn validate_database_transport(database_url: &str, variable: &str) -> Result<(), String> {
    let parsed = url::Url::parse(database_url)
        .map_err(|_| format!("{variable} must be a valid PostgreSQL URL"))?;
    if !matches!(parsed.scheme(), "postgres" | "postgresql") {
        return Err(format!("{variable} must use PostgreSQL"));
    }
    if parsed.username().is_empty()
        || parsed.password().is_none_or(str::is_empty)
        || parsed.host_str().is_none_or(str::is_empty)
        || !matches!(parsed.path().strip_prefix('/'), Some(database) if !database.is_empty() && !database.contains('/'))
        || parsed.fragment().is_some()
    {
        return Err(format!(
            "{variable} must embed one username, password, host, and database and must not contain a fragment"
        ));
    }
    let query = parsed.query_pairs().collect::<Vec<_>>();
    if query.len() != 1 || query[0].0 != "sslmode" {
        return Err(format!(
            "{variable} must contain exactly one sslmode and no other query options"
        ));
    }
    let mode = query[0].1.as_ref();
    if matches!(mode, "require" | "verify-ca" | "verify-full") {
        return Ok(());
    }
    let loopback = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if cfg!(debug_assertions) && loopback && mode == "disable" {
        return Ok(());
    }
    Err(format!(
        "{variable} sslmode must be require, verify-ca, or verify-full; debug loopback may explicitly use disable"
    ))
}

#[cfg(test)]
mod tests {
    use super::validate_database_transport;

    #[test]
    fn database_transport_rejects_implicit_and_downgradable_modes() {
        for url in [
            "postgres://role:secret@db.example/fmarch",
            "postgres://role:secret@db.example/fmarch?sslmode=disable",
            "postgres://role:secret@db.example/fmarch?sslmode=allow",
            "postgres://role:secret@db.example/fmarch?sslmode=prefer",
            "postgres://role:secret@db.example/fmarch?sslmode=require&options=unsafe",
            "postgres://role@db.example/fmarch?sslmode=require",
            "postgres://role:secret@db.example/?sslmode=require",
            "postgres://role:secret@db.example/fmarch?sslmode=require#fragment",
        ] {
            assert!(validate_database_transport(url, "DATABASE_URL").is_err());
        }
        for mode in ["require", "verify-ca", "verify-full"] {
            validate_database_transport(
                &format!("postgres://role:secret@db.example/fmarch?sslmode={mode}"),
                "DATABASE_URL",
            )
            .unwrap();
        }
        let loopback_disable = validate_database_transport(
            "postgres://role:secret@127.0.0.1:5544/fmarch?sslmode=disable",
            "DATABASE_URL",
        );
        if cfg!(debug_assertions) {
            loopback_disable.unwrap();
        } else {
            assert!(loopback_disable.is_err());
        }
    }
}
