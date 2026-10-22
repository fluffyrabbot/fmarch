pub use database_schema::{
    bind_database_environment_identity, ensure_schema_ready, inspect_schema_readiness,
    read_database_environment_identity_marker, reconcile_database_authority,
    verify_database_environment_identity, verify_database_environment_identity_marker,
    verify_database_principal, verify_migration_authority,
    verify_schema_epoch_reset_completion_authority, DatabaseAuthorityError,
    DatabaseEnvironmentIdentity, DatabasePrincipal, SchemaReadiness, APPLICATION_DATABASE_ROLE,
    DATABASE_ENVIRONMENT_IDENTITY_TABLE, DATABASE_IDENTITY_ADVISORY_LOCK, KEY_ADMIN_DATABASE_ROLE,
    MIGRATOR, RELEASE_AUTHORITY_SCHEMA, SCHEMA_EPOCH_RESET_COMPLETION_TABLE,
};

pub fn configured_database_environment_identity(
    process_name: &str,
) -> Result<Option<DatabaseEnvironmentIdentity>, String> {
    let values = (
        std::env::var("FMARCH_DATABASE_ENVIRONMENT"),
        std::env::var("FMARCH_DATABASE_INSTANCE_ID"),
    );
    match values {
        (Ok(environment), Ok(instance_id)) => {
            DatabaseEnvironmentIdentity::new(environment, instance_id)
                .map(Some)
                .map_err(|error| error.to_string())
        }
        (Err(std::env::VarError::NotPresent), Err(std::env::VarError::NotPresent))
            if api::release_commit() == "development" =>
        {
            Ok(None)
        }
        _ => Err(format!(
            "exact release {process_name} requires the complete durable database environment and instance identity"
        )),
    }
}

pub mod one_shot_database;
pub mod staging_search_corpus;
pub mod storage_conformance;

/// S3-compatible media settings from the environment. Shared by the server
/// and the storage conformance tool so both read one definition.
pub fn media_s3_config_from_environment() -> Result<media::S3MediaConfig, String> {
    let required = |name: &str| {
        std::env::var(name)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("{name} is required"))
    };
    let endpoint = required("AWS_ENDPOINT_URL")?;
    let url_style = std::env::var("AWS_S3_URL_STYLE").unwrap_or_else(|_| "path".to_string());
    let virtual_hosted_style = virtual_hosted_style_from_value(&url_style)?;
    let allow_http_configured = match std::env::var("FMARCH_S3_ALLOW_HTTP") {
        Err(std::env::VarError::NotPresent) => false,
        Ok(value) if value.trim() == "1" => true,
        Ok(value) if value.trim() == "0" => false,
        _ => return Err("FMARCH_S3_ALLOW_HTTP must be exactly 0 or 1".to_string()),
    };
    let allow_http = endpoint.starts_with("http://") && allow_http_configured;
    if endpoint.starts_with("http://") && !allow_http {
        return Err("HTTP object storage requires explicit FMARCH_S3_ALLOW_HTTP=1".to_string());
    }
    Ok(media::S3MediaConfig {
        endpoint,
        region: required("AWS_DEFAULT_REGION")?,
        bucket: required("AWS_S3_BUCKET_NAME")?,
        access_key_id: required("AWS_ACCESS_KEY_ID")?,
        secret_access_key: required("AWS_SECRET_ACCESS_KEY")?,
        virtual_hosted_style,
        allow_http,
    })
}

pub fn virtual_hosted_style_from_value(value: &str) -> Result<bool, String> {
    match value {
        "path" => Ok(false),
        // `virtual-host` is the common provider spelling; the longer form is a
        // provider-neutral synonym for manually managed stores.
        "virtual-host" | "virtual-hosted" => Ok(true),
        _ => Err("AWS_S3_URL_STYLE must be path, virtual-host, or virtual-hosted".to_string()),
    }
}

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
    // A self-hosted database presents a certificate from the environment's
    // private CA, so verify-ca/verify-full may name that CA file. Ambient PG*
    // variables stay forbidden; the URL remains the sole connection authority.
    let query_error = || {
        format!(
            "{variable} must contain exactly one sslmode, at most one sslrootcert, and no other query options"
        )
    };
    let mut sslmode = None;
    let mut sslrootcert = None;
    for (name, value) in parsed.query_pairs() {
        let slot = match name.as_ref() {
            "sslmode" => &mut sslmode,
            "sslrootcert" => &mut sslrootcert,
            _ => return Err(query_error()),
        };
        if slot.replace(value.into_owned()).is_some() {
            return Err(query_error());
        }
    }
    let Some(mode) = sslmode else {
        return Err(query_error());
    };
    let mode = mode.as_str();
    if let Some(root) = sslrootcert {
        if !root.starts_with('/') || !matches!(mode, "verify-ca" | "verify-full") {
            return Err(format!(
                "{variable} sslrootcert must be an absolute path and requires sslmode=verify-ca or verify-full"
            ));
        }
    }
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
    use super::{validate_database_transport, virtual_hosted_style_from_value};

    #[test]
    fn s3_url_style_accepts_provider_spellings() {
        assert!(!virtual_hosted_style_from_value("path").unwrap());
        assert!(virtual_hosted_style_from_value("virtual-host").unwrap());
        assert!(virtual_hosted_style_from_value("virtual-hosted").unwrap());
        assert!(virtual_hosted_style_from_value("virtual").is_err());
    }

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
            "postgres://role:secret@db.example/fmarch?sslrootcert=/ca.crt",
            "postgres://role:secret@db.example/fmarch?sslmode=require&sslrootcert=/ca.crt",
            "postgres://role:secret@db.example/fmarch?sslmode=verify-full&sslrootcert=ca.crt",
            "postgres://role:secret@db.example/fmarch?sslmode=verify-full&sslmode=require",
            "postgres://role:secret@db.example/fmarch?sslmode=verify-full&sslrootcert=/a&sslrootcert=/b",
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
        for mode in ["verify-ca", "verify-full"] {
            validate_database_transport(
                &format!(
                    "postgres://role:secret@10.40.1.21:5432/fmarch?sslmode={mode}&sslrootcert=/etc/fmarch/pg-tls/ca.crt"
                ),
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
