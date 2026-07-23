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
enum BootstrapAdminConfig {
    Workos {
        workos_user_id: String,
        display_label: Option<String>,
    },
    Classic {
        login_name: String,
        password: String,
    },
}

impl std::fmt::Debug for BootstrapAdminConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BootstrapAdminConfig::Workos {
                workos_user_id,
                display_label,
            } => formatter
                .debug_struct("BootstrapAdminConfig::Workos")
                .field("workos_user_id", &workos_user_id)
                .field("display_label", &display_label)
                .finish(),
            BootstrapAdminConfig::Classic { login_name, .. } => formatter
                .debug_struct("BootstrapAdminConfig::Classic")
                .field("login_name", &login_name)
                .field("password", &"<redacted>")
                .finish(),
        }
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
                env::var("FMARCH_BOOTSTRAP_ADMIN_METHOD").ok(),
                env::var("FMARCH_BOOTSTRAP_ADMIN_WORKOS_USER_ID").ok(),
                env::var("FMARCH_BOOTSTRAP_ADMIN_LOGIN_NAME").ok(),
                env::var("FMARCH_BOOTSTRAP_ADMIN_PASSWORD").ok(),
                env::var("FMARCH_BOOTSTRAP_ADMIN_LABEL").ok(),
            )?,
        })
    }
}

fn bootstrap_admin_from_values(
    method: Option<String>,
    workos_user_id: Option<String>,
    login_name: Option<String>,
    password: Option<String>,
    display_label: Option<String>,
) -> Result<Option<BootstrapAdminConfig>, std::io::Error> {
    let non_empty = |value: Option<String>| {
        value
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let workos_user_id = non_empty(workos_user_id);
    let login_name = non_empty(login_name);
    // Passwords keep their exact bytes; only presence is checked.
    let password = password.filter(|value| !value.trim().is_empty());
    let display_label = non_empty(display_label);
    // Absent an explicit method, a configured WorkOS user id keeps its
    // pre-method-model meaning.
    let method = non_empty(method).unwrap_or_else(|| {
        if workos_user_id.is_some() {
            "workos".to_string()
        } else {
            String::new()
        }
    });
    match method.as_str() {
        "" => {
            if login_name.is_some() || password.is_some() || display_label.is_some() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "admin bootstrap requires FMARCH_BOOTSTRAP_ADMIN_METHOD=classic|workos",
                ));
            }
            Ok(None)
        }
        "workos" => match workos_user_id {
            Some(workos_user_id) => Ok(Some(BootstrapAdminConfig::Workos {
                workos_user_id,
                display_label,
            })),
            None => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "workos admin bootstrap requires FMARCH_BOOTSTRAP_ADMIN_WORKOS_USER_ID",
            )),
        },
        "classic" => match (login_name, password) {
            (Some(login_name), Some(password)) => Ok(Some(BootstrapAdminConfig::Classic {
                login_name,
                password,
            })),
            _ => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "classic admin bootstrap requires FMARCH_BOOTSTRAP_ADMIN_LOGIN_NAME and FMARCH_BOOTSTRAP_ADMIN_PASSWORD",
            )),
        },
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("unknown admin bootstrap method: {other}; expected classic or workos"),
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
    let dev_auth_enabled = env::var("FMARCH_DEV_AUTH").ok().as_deref() == Some("1");
    if dev_auth_enabled && !cfg!(debug_assertions) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "FMARCH_DEV_AUTH cannot be enabled in a release build",
        )
        .into());
    }
    eventstore::require_secure_event_encryption_configuration()?;
    let auth_source_key = env::var("FMARCH_AUTH_SOURCE_SIGNING_KEY").ok();
    if auth_source_key
        .as_deref()
        .is_some_and(|value| value.as_bytes().len() < 32)
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "FMARCH_AUTH_SOURCE_SIGNING_KEY must contain at least 32 bytes",
        )
        .into());
    }
    if auth_source_key.is_none() && !(dev_auth_enabled && cfg!(debug_assertions)) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "FMARCH_AUTH_SOURCE_SIGNING_KEY is required",
        )
        .into());
    }
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
    // Classic is a first-class method, enabled by default; WorkOS is additive.
    // Startup requires at least one enabled sign-in method. FMARCH_DEV_AUTH
    // only unlocks dev shortcuts (dev-session endpoint, query-param sockets).
    let classic_enabled = env::var("FMARCH_CLASSIC_AUTH").ok().as_deref() != Some("0");
    if !classic_enabled && workos_verifier.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "no authentication method is enabled: leave FMARCH_CLASSIC_AUTH on or configure WORKOS_CLIENT_ID, WORKOS_ISSUER, and WORKOS_JWKS_URL",
        )
        .into());
    }

    if let Some(bootstrap_admin) = &config.bootstrap_admin {
        match bootstrap_admin {
            BootstrapAdminConfig::Workos {
                workos_user_id,
                display_label,
            } => {
                if workos_verifier.is_none() {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "WorkOS admin bootstrap requires WorkOS identity configuration",
                    )
                    .into());
                }
                let created = api::bootstrap_workos_global_admin(
                    &pool,
                    workos_user_id.as_str(),
                    display_label.as_deref(),
                )
                .await
                .map_err(|message| {
                    std::io::Error::new(std::io::ErrorKind::InvalidInput, message)
                })?;
                tracing::info!(
                    workos_user_id = %workos_user_id,
                    created,
                    "WorkOS global admin bootstrap checked"
                );
            }
            BootstrapAdminConfig::Classic {
                login_name,
                password,
            } => {
                if !classic_enabled {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "classic admin bootstrap requires classic authentication to be enabled",
                    )
                    .into());
                }
                let created = api::bootstrap_classic_global_admin(
                    &pool,
                    login_name.as_str(),
                    password.as_str(),
                )
                .await
                .map_err(|message| {
                    std::io::Error::new(std::io::ErrorKind::InvalidInput, message)
                })?;
                tracing::info!(
                    login_name = %login_name,
                    created,
                    "classic global admin bootstrap checked"
                );
            }
        }
    }

    // Delivery transport is a classic-method concern (invite and recovery
    // credentials), independent of whether WorkOS is also configured.
    let gateway: std::sync::Arc<dyn api::identity_delivery::IdentityDeliveryGateway> =
        if classic_enabled {
            match api::identity_delivery::HttpJsonIdentityDeliveryGateway::from_env()
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?
            {
                Some(gateway) => std::sync::Arc::new(gateway),
                None => std::sync::Arc::new(
                    api::identity_delivery::LocalDeterministicIdentityDeliveryGateway::from_env(),
                ),
            }
        } else {
            std::sync::Arc::new(
                api::identity_delivery::LocalDeterministicIdentityDeliveryGateway::new(false),
            )
        };
    if classic_enabled {
        api::identity_delivery::spawn_identity_delivery_worker(pool.clone(), gateway.clone());
    }
    let mut api_state = api::ApiState::new(pool.clone(), media_store)
        .with_classic_auth(classic_enabled)
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
    fn bootstrap_admin_configuration_is_method_neutral() {
        use super::BootstrapAdminConfig;

        assert!(bootstrap_admin_from_values(None, None, None, None, None)
            .unwrap()
            .is_none());

        // A bare WorkOS user id keeps its pre-method-model meaning.
        let configured = bootstrap_admin_from_values(
            None,
            Some("user_01HXYZ".to_string()),
            None,
            None,
            Some("Root operator".to_string()),
        )
        .unwrap()
        .unwrap();
        match configured {
            BootstrapAdminConfig::Workos {
                workos_user_id,
                display_label,
            } => {
                assert_eq!(workos_user_id, "user_01HXYZ");
                assert_eq!(display_label.as_deref(), Some("Root operator"));
            }
            other => panic!("expected workos bootstrap, got {other:?}"),
        }

        let configured = bootstrap_admin_from_values(
            Some("classic".to_string()),
            None,
            Some("root@example.test".to_string()),
            Some("correct horse battery staple".to_string()),
            None,
        )
        .unwrap()
        .unwrap();
        match configured {
            BootstrapAdminConfig::Classic {
                login_name,
                password,
            } => {
                assert_eq!(login_name, "root@example.test");
                assert_eq!(password, "correct horse battery staple");
            }
            other => panic!("expected classic bootstrap, got {other:?}"),
        }

        // Incomplete or contradictory configurations fail closed.
        assert!(
            bootstrap_admin_from_values(None, None, None, None, Some("label".to_string())).is_err()
        );
        assert!(bootstrap_admin_from_values(
            Some("classic".to_string()),
            None,
            Some("root@example.test".to_string()),
            None,
            None
        )
        .is_err());
        assert!(
            bootstrap_admin_from_values(Some("workos".to_string()), None, None, None, None)
                .is_err()
        );
        assert!(bootstrap_admin_from_values(
            Some("saml".to_string()),
            Some("user".to_string()),
            None,
            None,
            None
        )
        .is_err());
    }
}
