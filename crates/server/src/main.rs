use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use axum::middleware;
use sqlx::postgres::PgPoolOptions;

mod admission;

use admission::{enforce_http_admission, HttpAdmission};

#[derive(Debug, Clone)]
struct Config {
    database_url: String,
    bind: SocketAddr,
    media_root: PathBuf,
    database: DatabaseCapacity,
    http: HttpCapacity,
    bootstrap_admin: Option<BootstrapAdminConfig>,
}

#[derive(Clone)]
struct BootstrapAdminConfig {
    workos_user_id: String,
    display_label: Option<String>,
}

impl std::fmt::Debug for BootstrapAdminConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BootstrapAdminConfig")
            .field("workos_user_id", &self.workos_user_id)
            .field("display_label", &self.display_label)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DatabaseCapacity {
    max_connections: u32,
    acquire_timeout_ms: u64,
    statement_timeout_ms: u64,
    lock_timeout_ms: u64,
    idle_transaction_timeout_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct HttpCapacity {
    max_in_flight: usize,
    queue_timeout_ms: u64,
    request_timeout_ms: u64,
    retry_after_seconds: i64,
}

impl Config {
    fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        let database_url = env::var("DATABASE_URL")?;
        let bind = bind_from_values(
            env::var("FMARCH_BIND").ok().as_deref(),
            env::var("PORT").ok().as_deref(),
        )?;
        let media_root = env::var("FMARCH_MEDIA_ROOT")?;
        if media_root.trim().is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "FMARCH_MEDIA_ROOT must not be empty",
            )
            .into());
        }
        Ok(Config {
            database_url,
            bind,
            media_root: PathBuf::from(media_root),
            database: DatabaseCapacity {
                max_connections: bounded_env("FMARCH_DB_MAX_CONNECTIONS", 10, 1, 256)? as u32,
                acquire_timeout_ms: bounded_env("FMARCH_DB_ACQUIRE_TIMEOUT_MS", 250, 1, 60_000)?,
                statement_timeout_ms: bounded_env(
                    "FMARCH_DB_STATEMENT_TIMEOUT_MS",
                    5_000,
                    10,
                    300_000,
                )?,
                lock_timeout_ms: bounded_env("FMARCH_DB_LOCK_TIMEOUT_MS", 1_000, 1, 300_000)?,
                idle_transaction_timeout_ms: bounded_env(
                    "FMARCH_DB_IDLE_TRANSACTION_TIMEOUT_MS",
                    10_000,
                    10,
                    300_000,
                )?,
            },
            http: HttpCapacity {
                max_in_flight: bounded_env("FMARCH_HTTP_MAX_IN_FLIGHT", 128, 1, 65_536)? as usize,
                queue_timeout_ms: bounded_env("FMARCH_HTTP_QUEUE_TIMEOUT_MS", 50, 1, 60_000)?,
                request_timeout_ms: bounded_env(
                    "FMARCH_HTTP_REQUEST_TIMEOUT_MS",
                    15_000,
                    10,
                    300_000,
                )?,
                retry_after_seconds: bounded_env("FMARCH_HTTP_RETRY_AFTER_SECONDS", 1, 1, 300)?
                    as i64,
            },
            bootstrap_admin: bootstrap_admin_from_values(
                env::var("FMARCH_BOOTSTRAP_ADMIN_WORKOS_USER_ID").ok(),
                env::var("FMARCH_BOOTSTRAP_ADMIN_LABEL").ok(),
            )?,
        })
    }
}

fn bootstrap_admin_from_values(
    workos_user_id: Option<String>,
    display_label: Option<String>,
) -> Result<Option<BootstrapAdminConfig>, std::io::Error> {
    match workos_user_id {
        None if display_label.is_none() => Ok(None),
        Some(workos_user_id) if !workos_user_id.trim().is_empty() => {
            Ok(Some(BootstrapAdminConfig {
                workos_user_id: workos_user_id.trim().to_string(),
                display_label: display_label
                    .map(|label| label.trim().to_string())
                    .filter(|label| !label.is_empty()),
            }))
        }
        _ => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "FMARCH_BOOTSTRAP_ADMIN_WORKOS_USER_ID must be non-empty and is required when FMARCH_BOOTSTRAP_ADMIN_LABEL is set",
        )),
    }
}

fn bounded_env(
    name: &str,
    default: u64,
    minimum: u64,
    maximum: u64,
) -> Result<u64, std::io::Error> {
    let Some(raw) = env::var(name).ok() else {
        return Ok(default);
    };
    let parsed = raw.parse::<u64>().map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("{name} must be an integer between {minimum} and {maximum}"),
        )
    })?;
    if !(minimum..=maximum).contains(&parsed) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("{name} must be between {minimum} and {maximum}"),
        ));
    }
    Ok(parsed)
}

fn bind_from_values(
    configured_bind: Option<&str>,
    platform_port: Option<&str>,
) -> Result<SocketAddr, std::net::AddrParseError> {
    let bind = configured_bind
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .or_else(|| {
            platform_port
                .filter(|value| !value.trim().is_empty())
                .map(|port| format!("0.0.0.0:{port}"))
        })
        .unwrap_or_else(|| "127.0.0.1:4000".to_string());
    bind.parse()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Config::from_env()?;
    let media_store = media::MediaStore::open(&config.media_root, media::MediaLimits::default())?;
    let statement_timeout = format!("{}ms", config.database.statement_timeout_ms);
    let lock_timeout = format!("{}ms", config.database.lock_timeout_ms);
    let idle_transaction_timeout = format!("{}ms", config.database.idle_transaction_timeout_ms);
    let pool = PgPoolOptions::new()
        .max_connections(config.database.max_connections)
        .acquire_timeout(Duration::from_millis(config.database.acquire_timeout_ms))
        .after_connect(move |connection, _metadata| {
            let statement_timeout = statement_timeout.clone();
            let lock_timeout = lock_timeout.clone();
            let idle_transaction_timeout = idle_transaction_timeout.clone();
            Box::pin(async move {
                sqlx::query("SELECT set_config('statement_timeout', $1, false)")
                    .bind(statement_timeout)
                    .execute(&mut *connection)
                    .await?;
                sqlx::query("SELECT set_config('lock_timeout', $1, false)")
                    .bind(lock_timeout)
                    .execute(&mut *connection)
                    .await?;
                sqlx::query("SELECT set_config('idle_in_transaction_session_timeout', $1, false)")
                    .bind(idle_transaction_timeout)
                    .execute(&mut *connection)
                    .await?;
                Ok(())
            })
        })
        .connect(&config.database_url)
        .await?;

    sqlx::migrate!("../projections/migrations")
        .run(&pool)
        .await?;

    let workos_verifier = identity::WorkosAccessTokenVerifier::from_env()
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?;
    let dev_auth_enabled = env::var("FMARCH_DEV_AUTH").ok().as_deref() == Some("1");
    if workos_verifier.is_none() && !dev_auth_enabled {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "WorkOS identity is required: set WORKOS_CLIENT_ID, WORKOS_ISSUER, and WORKOS_JWKS_URL (or explicitly enable FMARCH_DEV_AUTH=1 for local proof)",
        )
        .into());
    }

    if let Some(bootstrap_admin) = &config.bootstrap_admin {
        if workos_verifier.is_none() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "WorkOS admin bootstrap requires WorkOS identity configuration",
            )
            .into());
        }
        let created = api::bootstrap_workos_global_admin(
            &pool,
            bootstrap_admin.workos_user_id.as_str(),
            bootstrap_admin.display_label.as_deref(),
        )
        .await
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?;
        tracing::info!(
            workos_user_id = %bootstrap_admin.workos_user_id,
            created,
            "WorkOS global admin bootstrap checked"
        );
    }

    let gateway: std::sync::Arc<dyn api::identity_delivery::IdentityDeliveryGateway> =
        if workos_verifier.is_some() {
            std::sync::Arc::new(
                api::identity_delivery::LocalDeterministicIdentityDeliveryGateway::new(false),
            )
        } else {
            match api::identity_delivery::HttpJsonIdentityDeliveryGateway::from_env()
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?
            {
                Some(gateway) => std::sync::Arc::new(gateway),
                None => std::sync::Arc::new(
                    api::identity_delivery::LocalDeterministicIdentityDeliveryGateway::from_env(),
                ),
            }
        };
    if dev_auth_enabled {
        api::identity_delivery::spawn_identity_delivery_worker(pool.clone(), gateway.clone());
    }
    let mut api_state = api::ApiState::new(pool.clone(), media_store)
        .with_dev_auth(dev_auth_enabled)
        .with_identity_delivery_gateway(gateway);
    if let Some(verifier) = workos_verifier {
        api_state = api_state.with_access_token_verifier(std::sync::Arc::new(verifier));
    }
    let app = api::router_with_state(api_state)
        .merge(operator_api::router(pool))
        .layer(middleware::from_fn_with_state(
            HttpAdmission::new(
                config.http.max_in_flight,
                Duration::from_millis(config.http.queue_timeout_ms),
                Duration::from_millis(config.http.request_timeout_ms),
                config.http.retry_after_seconds,
            ),
            enforce_http_admission,
        ));
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    tracing::info!(addr = %config.bind, "fmarch server listening");
    axum::serve(listener, app).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{bind_from_values, bootstrap_admin_from_values, bounded_env};
    #[test]
    fn configured_bind_overrides_platform_port() {
        assert_eq!(
            bind_from_values(Some("127.0.0.1:4512"), Some("8080"))
                .unwrap()
                .to_string(),
            "127.0.0.1:4512"
        );
    }

    #[test]
    fn platform_port_binds_publicly_when_no_explicit_bind_exists() {
        assert_eq!(
            bind_from_values(None, Some("8080")).unwrap().to_string(),
            "0.0.0.0:8080"
        );
    }

    #[test]
    fn local_default_remains_loopback_port_4000() {
        assert_eq!(
            bind_from_values(None, None).unwrap().to_string(),
            "127.0.0.1:4000"
        );
    }

    #[test]
    fn bounded_capacity_values_reject_invalid_configuration() {
        std::env::set_var("FMARCH_TEST_CAPACITY_VALUE", "0");
        let error = bounded_env("FMARCH_TEST_CAPACITY_VALUE", 10, 1, 100).unwrap_err();
        std::env::remove_var("FMARCH_TEST_CAPACITY_VALUE");
        assert!(error.to_string().contains("between 1 and 100"));
    }

    #[test]
    fn bootstrap_admin_configuration_requires_a_complete_secret_pair() {
        assert!(bootstrap_admin_from_values(None, None).unwrap().is_none());
        let configured = bootstrap_admin_from_values(
            Some("user_01HXYZ".to_string()),
            Some("Root operator".to_string()),
        )
        .unwrap()
        .unwrap();
        assert_eq!(configured.workos_user_id, "user_01HXYZ");
        assert_eq!(configured.display_label.as_deref(), Some("Root operator"));
        assert!(bootstrap_admin_from_values(None, Some("Root operator".to_string())).is_err());
    }
}
