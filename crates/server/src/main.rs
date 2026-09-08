use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::middleware;
use sqlx::postgres::PgPoolOptions;

mod admission;
mod runtime_supervisor;

use admission::{enforce_http_admission, HttpAdmission};

// Live delivery holds an authority transaction across a socket write for at
// most five seconds. Keep the server-side idle transaction timeout above that
// protocol deadline so a valid fence cannot be killed before it commits.
const MIN_IDLE_TRANSACTION_TIMEOUT_MS: u64 = 10_000;
const MIN_DATABASE_POOL_CONNECTIONS: u64 = 5;

#[derive(Clone)]
struct RuntimeConfig {
    database_url: String,
    database_identity: Option<server::DatabaseEnvironmentIdentity>,
    bind: SocketAddr,
    media: MediaConfig,
    database: DatabaseCapacity,
    http: HttpCapacity,
    api: api::ApiRuntimeConfig,
    workers: WorkerBudget,
    operator_audit_max_in_flight: usize,
    scheduler: commands::day_scheduler::DayEventSchedulerConfig,
    bootstrap_admin: Option<BootstrapAdminConfig>,
    classic_enabled: bool,
    dev_auth_requested: bool,
    local_proof_secret: Option<String>,
    identity_delivery_gateway: std::sync::Arc<dyn api::identity_delivery::IdentityDeliveryGateway>,
}

#[derive(Debug, Clone)]
enum MediaConfig {
    S3(media::S3MediaConfig),
    LocalDebug(PathBuf),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IdentityDeliveryMode {
    Disabled,
    HttpJson,
    LocalDeterministic,
}

fn unix_now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock must be after Unix epoch")
        .as_secs() as i64
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkerBudget {
    subject_erasure_idle_interval: Duration,
    subject_erasure_error_backoff: Duration,
    media_reconciliation_interval: Duration,
    media_reconciliation_timeout: Duration,
    media_reconciliation_batch_size: i64,
    worker_restart_backoff: Duration,
    restart_limit: u32,
    readiness_grace: Duration,
    heartbeat_stale_after: Duration,
    shutdown_drain_timeout: Duration,
}

impl RuntimeConfig {
    fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        let database_url = env::var("DATABASE_URL")?;
        let database_identity = server::configured_database_environment_identity("fmarch-server")
            .map_err(invalid_runtime_config)?;
        let configured_bind = optional_env("FMARCH_BIND")?;
        let platform_port = optional_env("PORT")?;
        let bind = bind_from_values(configured_bind.as_deref(), platform_port.as_deref())?;
        let classic_enabled = strict_bool_env("FMARCH_CLASSIC_AUTH", true)?;
        let dev_auth_requested = strict_bool_env("FMARCH_DEV_AUTH", false)?;
        let local_proof_secret = optional_env("FMARCH_LOCAL_PROOF_SECRET")?;
        let media = media_config_from_env()?;
        let database = DatabaseCapacity {
            max_connections: bounded_env(
                "FMARCH_DB_MAX_CONNECTIONS",
                10,
                MIN_DATABASE_POOL_CONNECTIONS,
                256,
            )? as u32,
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
                MIN_IDLE_TRANSACTION_TIMEOUT_MS,
                300_000,
            )?,
        };
        let http = HttpCapacity {
            max_in_flight: bounded_env("FMARCH_HTTP_MAX_IN_FLIGHT", 128, 1, 65_536)? as usize,
            queue_timeout_ms: bounded_env("FMARCH_HTTP_QUEUE_TIMEOUT_MS", 50, 1, 60_000)?,
            request_timeout_ms: bounded_env("FMARCH_HTTP_REQUEST_TIMEOUT_MS", 15_000, 10, 300_000)?,
            retry_after_seconds: bounded_env("FMARCH_HTTP_RETRY_AFTER_SECONDS", 1, 1, 300)? as i64,
        };
        let authority_transaction_max_in_flight = bounded_env(
            "FMARCH_AUTHORITY_TRANSACTION_MAX_IN_FLIGHT",
            u64::from(database.max_connections - 3),
            2,
            u64::from(database.max_connections - 3),
        )? as usize;
        let auth_rate_window =
            bounded_env("FMARCH_AUTH_RATE_LIMIT_WINDOW_SECONDS", 900, 1, 86_400)? as i64;
        let auth_rate_lockout =
            bounded_env("FMARCH_AUTH_RATE_LIMIT_LOCKOUT_SECONDS", 900, 1, 86_400)? as i64;
        let source_signing_key = optional_env("FMARCH_AUTH_SOURCE_SIGNING_KEY")?
            .map(|value| {
                if value.len() < 32 {
                    Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "FMARCH_AUTH_SOURCE_SIGNING_KEY must contain at least 32 bytes",
                    ))
                } else {
                    Ok(std::sync::Arc::<[u8]>::from(value.into_bytes()))
                }
            })
            .transpose()?;
        let session_policy = identity::SessionPolicy::new(
            bounded_env("FMARCH_SESSION_TTL_SECONDS", 2_592_000, 60, 31_536_000)? as i64,
            bounded_env("FMARCH_WORKOS_SESSION_TTL_SECONDS", 86_400, 60, 86_400)? as i64,
            bounded_env("FMARCH_SESSION_IDLE_TTL_SECONDS", 604_800, 60, 31_536_000)? as i64,
        )
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?;
        let variant_limits = media::VariantLimits::default();
        let minimum_media_read_bytes =
            media::MediaReadLimits::required_in_flight_bytes(variant_limits)? as u64;
        let api = api::ApiRuntimeConfig {
            websocket: api::WebSocketBudget {
                projection_capacity: bounded_env("FMARCH_LIVE_PROJECTION_CAPACITY", 256, 1, 65_536)?
                    as usize,
                projection_delivery_delay: Duration::from_millis(bounded_env(
                    "FMARCH_LIVE_PROJECTION_DELIVERY_DELAY_MS",
                    0,
                    0,
                    60_000,
                )?),
                max_connections: bounded_env("FMARCH_WS_MAX_CONNECTIONS", 512, 1, 65_536)? as usize,
                max_connections_per_principal: bounded_env(
                    "FMARCH_WS_MAX_CONNECTIONS_PER_PRINCIPAL",
                    4,
                    1,
                    128,
                )? as usize,
                delivery_max_in_flight: bounded_env(
                    "FMARCH_WS_DELIVERY_MAX_IN_FLIGHT",
                    authority_transaction_max_in_flight.saturating_sub(1).min(4) as u64,
                    1,
                    authority_transaction_max_in_flight.saturating_sub(1) as u64,
                )? as usize,
                poll_interval: Duration::from_millis(bounded_env(
                    "FMARCH_WS_POLL_INTERVAL_MS",
                    5_000,
                    25,
                    5_000,
                )?),
                heartbeat_interval: Duration::from_millis(bounded_env(
                    "FMARCH_WS_HEARTBEAT_INTERVAL_MS",
                    10_000,
                    100,
                    60_000,
                )?),
                audience: optional_env("FMARCH_WS_AUDIENCE")?
                    .unwrap_or_else(|| "fmarch-live".to_string()),
                ticket_ttl: Duration::from_secs(bounded_env(
                    "FMARCH_WS_TICKET_TTL_SECONDS",
                    30,
                    5,
                    120,
                )?),
                ticket_max_per_window: bounded_env(
                    "FMARCH_WS_TICKET_MAX_PER_WINDOW",
                    60,
                    2,
                    10_000,
                )? as i32,
            },
            command: api::CommandBudget {
                max_in_flight: bounded_env("FMARCH_COMMAND_MAX_IN_FLIGHT", 32, 1, 1_024)? as usize,
                lock_timeout: Duration::from_millis(bounded_env(
                    "FMARCH_COMMAND_LOCK_TIMEOUT_MS",
                    5_000,
                    100,
                    30_000,
                )?),
            },
            authority: api::AuthorityBudget {
                transaction_max_in_flight: authority_transaction_max_in_flight,
            },
            media: api::MediaBudget {
                max_in_flight: bounded_env("FMARCH_MEDIA_MAX_IN_FLIGHT", 2, 1, 32)? as usize,
                account_quota_bytes: bounded_env(
                    "FMARCH_MEDIA_ACCOUNT_QUOTA_BYTES",
                    256 * 1024 * 1024,
                    12 * 1024 * 1024,
                    10 * 1024 * 1024 * 1024,
                )? as i64,
                upload_lease_seconds: bounded_env(
                    "FMARCH_MEDIA_UPLOAD_LEASE_SECONDS",
                    15 * 60,
                    60,
                    24 * 60 * 60,
                )? as i64,
                read_limits: media::MediaReadLimits::new(
                    required_bounded_env("FMARCH_MEDIA_READ_MAX_IN_FLIGHT", 1, 1_024)? as usize,
                    required_bounded_env(
                        "FMARCH_MEDIA_READ_MAX_IN_FLIGHT_BYTES",
                        minimum_media_read_bytes,
                        u32::MAX as u64,
                    )? as usize,
                )?,
                variant_limits,
            },
            auth: api::AuthBudget {
                identity_delivery_worker_config: identity_delivery_worker_config_from_env(
                    database.max_connections as usize,
                    authority_transaction_max_in_flight,
                )?,
                password_max_in_flight: bounded_env("FMARCH_PASSWORD_MAX_IN_FLIGHT", 4, 1, 64)?
                    as usize,
                workos_verification_max_in_flight: bounded_env(
                    "FMARCH_WORKOS_VERIFY_MAX_IN_FLIGHT",
                    8,
                    1,
                    128,
                )? as usize,
                workos_verification_max_per_source: bounded_env(
                    "FMARCH_WORKOS_VERIFY_MAX_PER_SOURCE",
                    120,
                    2,
                    10_000,
                )? as i32,
                rate_limit_account_max_failures: bounded_env(
                    "FMARCH_AUTH_RATE_LIMIT_MAX_FAILURES",
                    5,
                    2,
                    100,
                )? as i32,
                rate_limit_source_max_failures: bounded_env(
                    "FMARCH_AUTH_SOURCE_RATE_LIMIT_MAX_FAILURES",
                    50,
                    2,
                    10_000,
                )? as i32,
                registration_max_per_source: bounded_env(
                    "FMARCH_AUTH_REGISTRATION_SOURCE_LIMIT",
                    5,
                    2,
                    10_000,
                )? as i32,
                rate_limit_window_seconds: auth_rate_window,
                rate_limit_lockout_seconds: auth_rate_lockout,
                rate_limit_retention_seconds: bounded_env(
                    "FMARCH_AUTH_RATE_LIMIT_RETENTION_SECONDS",
                    auth_rate_window.max(auth_rate_lockout).saturating_mul(4) as u64,
                    auth_rate_window.max(auth_rate_lockout) as u64,
                    31_536_000,
                )? as i64,
                trust_source_header: strict_bool_env("FMARCH_TRUST_AUTH_SOURCE_HEADER", false)?,
                source_signing_key,
                session_policy,
                session_rotation_max_age_seconds: bounded_env(
                    "FMARCH_AUTH_SESSION_ROTATION_MAX_AGE_SECONDS",
                    86_400,
                    60,
                    604_800,
                )? as i64,
                recent_authentication_max_age_seconds: bounded_env(
                    "FMARCH_AUTH_RECENT_SECONDS",
                    600,
                    60,
                    86_400,
                )? as i64,
            },
        };
        api.validate(database.max_connections as usize)?;
        let identity_delivery_gateway = identity_delivery_gateway_from_env(
            classic_enabled,
            dev_auth_requested,
            cfg!(debug_assertions),
            api.auth.identity_delivery_worker_config.provider_timeout(),
        )?;
        let workers = WorkerBudget {
            subject_erasure_idle_interval: Duration::from_millis(bounded_env(
                "FMARCH_SUBJECT_ERASURE_IDLE_INTERVAL_MS",
                5_000,
                100,
                60_000,
            )?),
            subject_erasure_error_backoff: Duration::from_millis(bounded_env(
                "FMARCH_SUBJECT_ERASURE_ERROR_BACKOFF_MS",
                1_000,
                100,
                60_000,
            )?),
            media_reconciliation_interval: Duration::from_millis(bounded_env(
                "FMARCH_MEDIA_RECONCILIATION_INTERVAL_MS",
                5_000,
                100,
                60_000,
            )?),
            media_reconciliation_timeout: Duration::from_millis(bounded_env(
                "FMARCH_MEDIA_RECONCILIATION_TIMEOUT_MS",
                2_000,
                100,
                300_000,
            )?),
            media_reconciliation_batch_size: bounded_env(
                "FMARCH_MEDIA_RECONCILIATION_BATCH_SIZE",
                1,
                1,
                32,
            )? as i64,
            worker_restart_backoff: Duration::from_millis(bounded_env(
                "FMARCH_WORKER_RESTART_BACKOFF_MS",
                1_000,
                100,
                60_000,
            )?),
            restart_limit: bounded_env("FMARCH_WORKER_RESTART_LIMIT", 3, 0, 100)? as u32,
            readiness_grace: Duration::from_millis(bounded_env(
                "FMARCH_WORKER_READINESS_GRACE_MS",
                10_000,
                100,
                300_000,
            )?),
            heartbeat_stale_after: Duration::from_millis(bounded_env(
                "FMARCH_WORKER_HEARTBEAT_STALE_MS",
                30_000,
                1_000,
                600_000,
            )?),
            shutdown_drain_timeout: Duration::from_millis(bounded_env(
                "FMARCH_SHUTDOWN_DRAIN_TIMEOUT_MS",
                30_000,
                1_000,
                300_000,
            )?),
        };
        let config = RuntimeConfig {
            database_url,
            database_identity,
            bind,
            media,
            database,
            http,
            api,
            workers,
            operator_audit_max_in_flight: bounded_env(
                "FMARCH_OPERATOR_AUDIT_MAX_IN_FLIGHT",
                1,
                1,
                8,
            )? as usize,
            scheduler: commands::day_scheduler::DayEventSchedulerConfig {
                poll_interval: Duration::from_millis(bounded_env(
                    "FMARCH_DAY_EVENT_SCHEDULER_POLL_MS",
                    1_000,
                    100,
                    60_000,
                )?),
                batch_size: bounded_env("FMARCH_DAY_EVENT_SCHEDULER_BATCH_SIZE", 16, 1, 128)?
                    as i64,
                lease_seconds: bounded_env(
                    "FMARCH_DAY_EVENT_SCHEDULER_LEASE_SECONDS",
                    30,
                    1,
                    3_600,
                )? as i64,
                retry_base_seconds: bounded_env(
                    "FMARCH_DAY_EVENT_SCHEDULER_RETRY_BASE_SECONDS",
                    1,
                    1,
                    300,
                )? as i64,
                retry_max_seconds: bounded_env(
                    "FMARCH_DAY_EVENT_SCHEDULER_RETRY_MAX_SECONDS",
                    60,
                    1,
                    3_600,
                )? as i64,
            },
            bootstrap_admin: bootstrap_admin_from_values(
                optional_env("FMARCH_BOOTSTRAP_ADMIN_METHOD")?,
                optional_env("FMARCH_BOOTSTRAP_ADMIN_WORKOS_USER_ID")?,
                optional_env("FMARCH_BOOTSTRAP_ADMIN_LOGIN_NAME")?,
                optional_env("FMARCH_BOOTSTRAP_ADMIN_PASSWORD")?,
                optional_env("FMARCH_BOOTSTRAP_ADMIN_LABEL")?,
            )?,
            classic_enabled,
            dev_auth_requested,
            local_proof_secret,
            identity_delivery_gateway,
        };
        config.validate_cross_budgets()?;
        Ok(config)
    }

    fn validate_cross_budgets(&self) -> Result<(), std::io::Error> {
        self.scheduler.validate().map_err(|error| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, error.to_string())
        })?;
        let maximum_media_footprint = media::MediaLimits::default()
            .maximum_stored_footprint_bytes(self.api.media.variant_limits)
            .map_err(|error| {
                std::io::Error::new(std::io::ErrorKind::InvalidInput, error.to_string())
            })?;
        if u64::try_from(self.api.media.account_quota_bytes)
            .map_or(true, |quota| quota < maximum_media_footprint)
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!(
                    "FMARCH_MEDIA_ACCOUNT_QUOTA_BYTES must fit one maximum retained upload ({maximum_media_footprint} bytes)"
                ),
            ));
        }
        if self.api.command.lock_timeout > Duration::from_millis(self.http.request_timeout_ms) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "FMARCH_COMMAND_LOCK_TIMEOUT_MS must not exceed FMARCH_HTTP_REQUEST_TIMEOUT_MS",
            ));
        }
        let reconciliation_batch_timeout = self
            .workers
            .media_reconciliation_timeout
            .checked_mul(
                u32::try_from(self.workers.media_reconciliation_batch_size).map_err(|_| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "media reconciliation batch size does not fit deadline arithmetic",
                    )
                })?,
            )
            .ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "media reconciliation batch deadline overflowed",
                )
            })?;
        let longest_heartbeat_gap = self
            .workers
            .subject_erasure_idle_interval
            .max(self.scheduler.poll_interval)
            .max(
                self.workers
                    .media_reconciliation_interval
                    .saturating_add(reconciliation_batch_timeout),
            )
            .max(
                self.api
                    .auth
                    .identity_delivery_worker_config
                    .poll_interval(),
            )
            .max(Duration::from_secs(1));
        if self.workers.heartbeat_stale_after <= longest_heartbeat_gap {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "worker heartbeat staleness must exceed every normal worker heartbeat interval",
            ));
        }
        let startup_database_budget = Duration::from_millis(
            self.database
                .acquire_timeout_ms
                .saturating_add(self.database.statement_timeout_ms),
        );
        if self.workers.readiness_grace <= startup_database_budget {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "worker readiness grace must exceed one bounded database acquire and statement",
            ));
        }
        if self.workers.readiness_grace <= reconciliation_batch_timeout {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "worker readiness grace must exceed one media reconciliation batch deadline",
            ));
        }
        if Duration::from_secs(self.api.media.upload_lease_seconds as u64)
            <= Duration::from_millis(self.http.request_timeout_ms)
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "FMARCH_MEDIA_UPLOAD_LEASE_SECONDS must exceed FMARCH_HTTP_REQUEST_TIMEOUT_MS",
            ));
        }
        let identity_delivery = self.api.auth.identity_delivery_worker_config;
        if identity_delivery.database_timeout() <= startup_database_budget {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "identity delivery database timeout must cover one bounded database acquire and statement",
            ));
        }
        if self.workers.shutdown_drain_timeout <= identity_delivery.total_timeout() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "worker shutdown drain timeout must cover one bounded identity delivery preparation, provider call, and finalization",
            ));
        }
        Ok(())
    }
}

fn required_env(name: &str) -> Result<String, std::io::Error> {
    optional_env(name)?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, format!("{name} is required"))
        })
}

fn optional_env(name: &str) -> Result<Option<String>, std::io::Error> {
    match env::var(name) {
        Ok(value) => Ok(Some(value)),
        Err(env::VarError::NotPresent) => Ok(None),
        Err(error) => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("{name} is not valid UTF-8: {error}"),
        )),
    }
}

fn virtual_hosted_style_from_value(value: &str) -> Result<bool, std::io::Error> {
    match value {
        "path" => Ok(false),
        // Railway's S3-compatible bucket credential uses `virtual-host`; accept the
        // longer spelling as a provider-neutral synonym for manually managed stores.
        "virtual-host" | "virtual-hosted" => Ok(true),
        _ => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "AWS_S3_URL_STYLE must be path, virtual-host, or virtual-hosted",
        )),
    }
}

fn media_config_from_env() -> Result<MediaConfig, Box<dyn std::error::Error>> {
    if let Some(root) = optional_env("FMARCH_MEDIA_ROOT")? {
        if root.trim().is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "FMARCH_MEDIA_ROOT must not be empty",
            )
            .into());
        }
        return Ok(MediaConfig::LocalDebug(PathBuf::from(root)));
    }
    let endpoint = required_env("AWS_ENDPOINT_URL")?;
    let url_style = optional_env("AWS_S3_URL_STYLE")?.unwrap_or_else(|| "path".to_string());
    let virtual_hosted_style = virtual_hosted_style_from_value(&url_style)?;
    let allow_http_configured = strict_bool_env("FMARCH_S3_ALLOW_HTTP", false)?;
    let allow_http = endpoint.starts_with("http://") && allow_http_configured;
    if endpoint.starts_with("http://") && !allow_http {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "HTTP object storage requires explicit FMARCH_S3_ALLOW_HTTP=1",
        )
        .into());
    }
    Ok(MediaConfig::S3(media::S3MediaConfig {
        endpoint,
        region: required_env("AWS_DEFAULT_REGION")?,
        bucket: required_env("AWS_S3_BUCKET_NAME")?,
        access_key_id: required_env("AWS_ACCESS_KEY_ID")?,
        secret_access_key: required_env("AWS_SECRET_ACCESS_KEY")?,
        virtual_hosted_style,
        allow_http,
    }))
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
    let Some(raw) = optional_env(name)? else {
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

fn identity_delivery_worker_config_from_env(
    database_pool_connections: usize,
    authority_transaction_max_in_flight: usize,
) -> Result<api::identity_delivery::IdentityDeliveryWorkerConfig, std::io::Error> {
    let retry = api::identity_delivery::IdentityDeliveryRetryPolicy::new(
        Duration::from_secs(bounded_env(
            "FMARCH_IDENTITY_DELIVERY_RETRY_BASE_SECONDS",
            2,
            1,
            86_400,
        )?),
        Duration::from_secs(bounded_env(
            "FMARCH_IDENTITY_DELIVERY_RETRY_MAX_SECONDS",
            300,
            1,
            86_400,
        )?),
        bounded_env("FMARCH_IDENTITY_DELIVERY_MAX_ATTEMPTS", 8, 1, 100)? as i32,
    )
    .map_err(invalid_runtime_config)?;
    let max_concurrency =
        bounded_env("FMARCH_IDENTITY_DELIVERY_MAX_CONCURRENCY", 4, 1, 64)? as usize;
    let database_headroom = database_pool_connections
        .checked_sub(authority_transaction_max_in_flight.saturating_add(1))
        .filter(|headroom| *headroom > 0)
        .ok_or_else(|| {
            invalid_runtime_config(
                "identity delivery requires a database connection outside the authority budget and the process reserve"
                    .to_string(),
            )
        })?;
    api::identity_delivery::IdentityDeliveryWorkerConfig::new(
        max_concurrency,
        max_concurrency.min(database_headroom),
        Duration::from_millis(bounded_env(
            "FMARCH_IDENTITY_DELIVERY_POLL_INTERVAL_MS",
            100,
            1,
            60_000,
        )?),
        Duration::from_millis(bounded_env(
            "FMARCH_IDENTITY_DELIVERY_CLAIM_LEASE_MS",
            30_000,
            2_000,
            300_000,
        )?),
        Duration::from_millis(bounded_env(
            "FMARCH_IDENTITY_DELIVERY_PROVIDER_TIMEOUT_MS",
            10_000,
            1,
            120_000,
        )?),
        Duration::from_millis(bounded_env(
            "FMARCH_IDENTITY_DELIVERY_DATABASE_TIMEOUT_MS",
            6_000,
            1,
            120_000,
        )?),
        retry,
    )
    .map_err(invalid_runtime_config)
}

fn invalid_runtime_config(message: String) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidInput, message)
}

fn strict_bool_env(name: &str, default: bool) -> Result<bool, std::io::Error> {
    match env::var(name) {
        Err(env::VarError::NotPresent) => Ok(default),
        Err(error) => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("{name} is not valid UTF-8: {error}"),
        )),
        Ok(value) => match value.trim() {
            "1" => Ok(true),
            "0" => Ok(false),
            _ => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("{name} must be exactly 0 or 1"),
            )),
        },
    }
}

fn required_bounded_env(name: &str, minimum: u64, maximum: u64) -> Result<u64, std::io::Error> {
    let raw = optional_env(name)?.ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, format!("{name} is required"))
    })?;
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
                .map(|port| format!("[::]:{port}"))
        })
        .unwrap_or_else(|| "127.0.0.1:4000".to_string());
    bind.parse()
}

fn identity_delivery_mode(
    classic_enabled: bool,
    http_gateway_configured: bool,
    dev_auth_enabled: bool,
    debug_build: bool,
) -> Result<IdentityDeliveryMode, std::io::Error> {
    if !classic_enabled {
        return Ok(IdentityDeliveryMode::Disabled);
    }
    if http_gateway_configured {
        return Ok(IdentityDeliveryMode::HttpJson);
    }
    if dev_auth_enabled && debug_build {
        return Ok(IdentityDeliveryMode::LocalDeterministic);
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "classic authentication requires FMARCH_IDENTITY_DELIVERY_ENDPOINT; the local deterministic delivery gateway is available only with FMARCH_DEV_AUTH=1 in a debug build, or set FMARCH_CLASSIC_AUTH=0 for a WorkOS-only deployment",
    ))
}

fn identity_delivery_gateway_from_env(
    classic_enabled: bool,
    dev_auth_requested: bool,
    debug_build: bool,
    provider_timeout: Duration,
) -> Result<std::sync::Arc<dyn api::identity_delivery::IdentityDeliveryGateway>, std::io::Error> {
    let endpoint = optional_env("FMARCH_IDENTITY_DELIVERY_ENDPOINT")?;
    let provider_id = optional_env("FMARCH_IDENTITY_DELIVERY_PROVIDER_ID")?;
    let auth_token = optional_env("FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN")?;
    let connect_timeout = optional_env("FMARCH_IDENTITY_DELIVERY_CONNECT_TIMEOUT_MS")?;
    let response_timeout = optional_env("FMARCH_IDENTITY_DELIVERY_RESPONSE_TIMEOUT_MS")?;
    let body_timeout = optional_env("FMARCH_IDENTITY_DELIVERY_BODY_TIMEOUT_MS")?;
    let total_timeout = optional_env("FMARCH_IDENTITY_DELIVERY_TOTAL_TIMEOUT_MS")?;
    let max_response_bytes = optional_env("FMARCH_IDENTITY_DELIVERY_MAX_RESPONSE_BYTES")?;
    let local_fail_first = optional_env("FMARCH_LOCAL_DELIVERY_FAIL_FIRST_ATTEMPT")?;
    let http_companion_configured = provider_id.is_some()
        || auth_token.is_some()
        || connect_timeout.is_some()
        || response_timeout.is_some()
        || body_timeout.is_some()
        || total_timeout.is_some()
        || max_response_bytes.is_some();

    if !classic_enabled {
        if endpoint.is_some() || http_companion_configured || local_fail_first.is_some() {
            return Err(invalid_runtime_config(
                "identity delivery settings must be absent when classic authentication is disabled"
                    .to_string(),
            ));
        }
        return Ok(std::sync::Arc::new(
            api::identity_delivery::DisabledIdentityDeliveryGateway,
        ));
    }
    if endpoint.is_none() && http_companion_configured {
        return Err(invalid_runtime_config(
            "identity delivery provider, token, and deadline settings require FMARCH_IDENTITY_DELIVERY_ENDPOINT"
                .to_string(),
        ));
    }

    match identity_delivery_mode(
        classic_enabled,
        endpoint.is_some(),
        dev_auth_requested,
        debug_build,
    )? {
        IdentityDeliveryMode::Disabled => Ok(std::sync::Arc::new(
            api::identity_delivery::DisabledIdentityDeliveryGateway,
        )),
        IdentityDeliveryMode::LocalDeterministic => {
            let fail_first_attempt = parse_optional_bool(
                "FMARCH_LOCAL_DELIVERY_FAIL_FIRST_ATTEMPT",
                local_fail_first.as_deref(),
                false,
            )?;
            Ok(std::sync::Arc::new(
                api::identity_delivery::LocalDeterministicIdentityDeliveryGateway::new(
                    fail_first_attempt,
                ),
            ))
        }
        IdentityDeliveryMode::HttpJson => {
            if local_fail_first.is_some() {
                return Err(invalid_runtime_config(
                    "FMARCH_LOCAL_DELIVERY_FAIL_FIRST_ATTEMPT is valid only for the local deterministic delivery gateway"
                        .to_string(),
                ));
            }
            let endpoint = endpoint
                .filter(|value| !value.trim().is_empty() && value.trim() == value)
                .ok_or_else(|| {
                    invalid_runtime_config(
                        "FMARCH_IDENTITY_DELIVERY_ENDPOINT must be non-empty and unpadded"
                            .to_string(),
                    )
                })?
                .parse::<url::Url>()
                .map_err(|error| {
                    invalid_runtime_config(format!(
                        "FMARCH_IDENTITY_DELIVERY_ENDPOINT is invalid: {error}"
                    ))
                })?;
            let provider_id = provider_id
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    invalid_runtime_config(
                        "FMARCH_IDENTITY_DELIVERY_PROVIDER_ID is required with the delivery endpoint"
                            .to_string(),
                    )
                })?;
            let auth_token = auth_token
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    invalid_runtime_config(
                        "FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN is required with the delivery endpoint"
                            .to_string(),
                    )
                })?;
            let timeouts = api::identity_delivery::IdentityDeliveryHttpTimeouts::new(
                Duration::from_millis(parse_optional_bounded_u64(
                    "FMARCH_IDENTITY_DELIVERY_CONNECT_TIMEOUT_MS",
                    connect_timeout.as_deref(),
                    1_000,
                    1,
                    120_000,
                )?),
                Duration::from_millis(parse_optional_bounded_u64(
                    "FMARCH_IDENTITY_DELIVERY_RESPONSE_TIMEOUT_MS",
                    response_timeout.as_deref(),
                    3_000,
                    1,
                    120_000,
                )?),
                Duration::from_millis(parse_optional_bounded_u64(
                    "FMARCH_IDENTITY_DELIVERY_BODY_TIMEOUT_MS",
                    body_timeout.as_deref(),
                    1_000,
                    1,
                    120_000,
                )?),
                Duration::from_millis(parse_optional_bounded_u64(
                    "FMARCH_IDENTITY_DELIVERY_TOTAL_TIMEOUT_MS",
                    total_timeout.as_deref(),
                    5_000,
                    1,
                    120_000,
                )?),
                parse_optional_bounded_u64(
                    "FMARCH_IDENTITY_DELIVERY_MAX_RESPONSE_BYTES",
                    max_response_bytes.as_deref(),
                    64 * 1024,
                    1,
                    1024 * 1024,
                )? as usize,
            )
            .map_err(invalid_runtime_config)?;
            if timeouts.total() > provider_timeout {
                return Err(invalid_runtime_config(
                    "identity delivery HTTP total timeout must not exceed the provider timeout"
                        .to_string(),
                ));
            }
            api::identity_delivery::HttpJsonIdentityDeliveryGateway::configured(
                provider_id,
                endpoint,
                Some(auth_token),
                timeouts,
            )
            .map(|gateway| std::sync::Arc::new(gateway) as _)
            .map_err(invalid_runtime_config)
        }
    }
}

fn parse_optional_bounded_u64(
    name: &str,
    raw: Option<&str>,
    default: u64,
    minimum: u64,
    maximum: u64,
) -> Result<u64, std::io::Error> {
    let Some(raw) = raw else {
        return Ok(default);
    };
    let parsed = raw.parse::<u64>().map_err(|_| {
        invalid_runtime_config(format!(
            "{name} must be an integer between {minimum} and {maximum}"
        ))
    })?;
    if !(minimum..=maximum).contains(&parsed) {
        return Err(invalid_runtime_config(format!(
            "{name} must be between {minimum} and {maximum}"
        )));
    }
    Ok(parsed)
}

fn parse_optional_bool(
    name: &str,
    raw: Option<&str>,
    default: bool,
) -> Result<bool, std::io::Error> {
    match raw {
        None => Ok(default),
        Some("1") => Ok(true),
        Some("0") => Ok(false),
        Some(_) => Err(invalid_runtime_config(format!(
            "{name} must be exactly 0 or 1"
        ))),
    }
}

fn local_proof_auth_from_values(
    enabled: bool,
    debug_build: bool,
    bind: SocketAddr,
    secret: Option<&str>,
) -> Result<Option<api::LocalProofAuthVerifier>, std::io::Error> {
    if !enabled {
        if secret.is_some() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "FMARCH_LOCAL_PROOF_SECRET must be absent unless FMARCH_DEV_AUTH=1",
            ));
        }
        return Ok(None);
    }
    if !debug_build {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "FMARCH_DEV_AUTH cannot be enabled in a release build",
        ));
    }
    if !bind.ip().is_loopback() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "FMARCH_DEV_AUTH requires an explicit loopback FMARCH_BIND; wildcard, platform PORT, and non-loopback listeners are forbidden",
        ));
    }
    let secret = secret.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "FMARCH_LOCAL_PROOF_SECRET is required when FMARCH_DEV_AUTH=1",
        )
    })?;
    let verifier = api::LocalProofAuthVerifier::from_secret(secret).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "FMARCH_LOCAL_PROOF_SECRET must be a freshly generated 32-byte lowercase-hex value",
        )
    })?;
    Ok(Some(verifier))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    // Content is a prerequisite of the process, not a deployment-side file.
    // This check intentionally precedes environment and database startup so the
    // exact runtime image can prove its embedded artifact closure in isolation.
    let content_check = content_registry::check_content_json()?;
    if env::args().skip(1).eq(["--check-content"]) {
        println!("{content_check}");
        return Ok(());
    }
    if env::args().skip(1).eq(["--bootstrap-subject-authority"]) {
        let manifest = identity::bootstrap_subject_key_authority_from_environment().await?;
        println!("{}", serde_json::to_string(&manifest)?);
        return Ok(());
    }

    if env::var_os("DATABASE_MIGRATION_URL").is_some()
        || env::var_os("DATABASE_KEY_ADMIN_URL").is_some()
        || env::var_os("FMARCH_DATABASE_APPLICATION_PASSWORD").is_some()
        || env::var_os("FMARCH_DATABASE_KEY_ADMIN_PASSWORD").is_some()
        || env::var_os("FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY").is_some()
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "fmarch-server accepts only the active application authorities; migration/key-admin credentials, role passwords, and profile-index replacement material must not enter the runtime environment",
        )
        .into());
    }
    server::reject_ambient_postgres_environment("fmarch-server", "DATABASE_URL")
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::PermissionDenied, message))?;

    let config = RuntimeConfig::from_env()?;
    let identity_delivery_gateway = std::sync::Arc::clone(&config.identity_delivery_gateway);
    server::validate_database_transport(&config.database_url, "DATABASE_URL")
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::PermissionDenied, message))?;
    // Reject absent, malformed, or placeholder profile-index custody before
    // touching external subject authority or opening a database connection.
    profile_application::require_profile_handle_index_configuration()?;
    // Validate the external erasure authority before opening a database
    // connection. `--check-content` intentionally exits above this requirement.
    let subject_authority = identity::configured_subject_key_authority().await?;
    identity::install_subject_key_store(subject_authority.key_store.clone())?;
    let local_proof_auth = local_proof_auth_from_values(
        config.dev_auth_requested,
        cfg!(debug_assertions),
        config.bind,
        config.local_proof_secret.as_deref(),
    )?;
    let dev_auth_enabled = local_proof_auth.is_some();
    let local_proof_instance_id = local_proof_auth
        .as_ref()
        .map(|verifier| verifier.instance_id().clone());
    eventstore::require_secure_event_encryption_configuration()?;
    if config.api.auth.source_signing_key.is_none() && !(dev_auth_enabled && cfg!(debug_assertions))
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "FMARCH_AUTH_SOURCE_SIGNING_KEY is required",
        )
        .into());
    }
    let media_read = config.api.media.read_limits;
    let media_store = match &config.media {
        MediaConfig::S3(config) => {
            media::MediaRepository::s3(config.clone(), media::MediaLimits::default(), media_read)?
        }
        MediaConfig::LocalDebug(root) => {
            if !cfg!(debug_assertions) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "FMARCH_MEDIA_ROOT is available only in debug builds",
                )
                .into());
            }
            media::MediaRepository::local(
                media::MediaStore::open(root, media::MediaLimits::default())?,
                media_read,
            )
        }
    };
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

    server::ensure_schema_ready(&pool).await?;
    server::verify_database_principal(&pool, server::DatabasePrincipal::Application).await?;
    let database_identity = match config.database_identity.as_ref() {
        Some(expected) => {
            let mut connection = pool.acquire().await?;
            Some(
                server::verify_database_environment_identity_marker(&mut connection, expected)
                    .await?,
            )
        }
        None => None,
    };
    let local_proof_revocation =
        identity::revoke_local_proof_sessions_for_startup(&pool, unix_now_seconds()).await?;
    if local_proof_revocation.sessions > 0 || local_proof_revocation.websocket_tickets > 0 {
        tracing::info!(
            revoked_local_proof_sessions = local_proof_revocation.sessions,
            removed_local_proof_websocket_tickets = local_proof_revocation.websocket_tickets,
            "invalidated stale local-proof authority before accepting traffic"
        );
    }
    eventstore::attest_active_runtime_kek(&pool).await?;
    eventstore::audit_event_encryption_key_coverage(&pool).await?;
    identity::prepare_subject_authority_for_service(&pool, &subject_authority).await?;
    profile_application::verify_profile_handle_index_consistency(&pool).await?;
    let workos_verifier = identity::WorkosAccessTokenVerifier::from_env()
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?;
    // Classic is a first-class method, enabled by default; WorkOS is additive.
    // Startup requires at least one enabled sign-in method. FMARCH_DEV_AUTH
    // unlocks only the loopback, secret-authenticated local-proof control.
    let classic_enabled = config.classic_enabled;
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
                tracing::info!(created, "WorkOS global admin bootstrap checked");
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
                tracing::info!(created, "classic global admin bootstrap checked");
            }
        }
    }

    // RuntimeConfig owns transport parsing and deadline validation before any
    // external authority or database side effects occur.
    let gateway = identity_delivery_gateway;
    let worker_health = api::RuntimeWorkerHealth::new(config.workers.heartbeat_stale_after)
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?;
    let mut api_state = api::ApiState::new(pool.clone(), media_store, config.api.clone())?
        .with_classic_auth(classic_enabled)
        .with_subject_key_store(subject_authority.key_store.clone())
        .with_identity_delivery_gateway(gateway.clone())
        .with_worker_health(worker_health.clone());
    if let Some(identity) = database_identity {
        api_state = api_state.with_database_environment_identity(identity);
    }
    if let Some(verifier) = local_proof_auth {
        api_state = api_state.with_local_proof_auth(verifier);
    }
    if let Some(verifier) = workos_verifier {
        api_state = api_state.with_access_token_verifier(std::sync::Arc::new(verifier));
    }
    let mut operator_state = operator_api::OperatorApiState::new(
        pool.clone(),
        config.api.auth.session_policy.clone(),
        config.operator_audit_max_in_flight,
    )
    .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?;
    if let Some(instance_id) = local_proof_instance_id {
        operator_state = operator_state.with_local_proof_instance(instance_id);
    }
    // Claim the listener before starting managed workers so a bind failure
    // cannot detach background work from the process lifecycle.
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    let identity_delivery_worker = if classic_enabled {
        Some(runtime_supervisor::IdentityDeliveryWorkerBinding::new(
            gateway,
            config.api.auth.identity_delivery_worker_config,
        ))
    } else {
        None
    };
    let mut supervisor = runtime_supervisor::RuntimeSupervisor::start(
        pool.clone(),
        api_state.clone(),
        identity_delivery_worker,
        config.scheduler.clone(),
        config.workers.clone(),
        worker_health,
    );
    if let Err(message) = supervisor.wait_until_ready().await {
        supervisor.request_shutdown();
        let shutdown_result = supervisor.shutdown().await;
        pool.close().await;
        if shutdown_result.is_err() {
            tracing::error!(
                event = "runtime_startup_abort_failed",
                "runtime workers failed while aborting startup"
            );
        }
        return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, message).into());
    }
    let app = api::router_with_state(api_state)
        .merge(operator_api::router_with_state(operator_state))
        .layer(middleware::from_fn_with_state(
            HttpAdmission::new(
                config.http.max_in_flight,
                Duration::from_millis(config.http.queue_timeout_ms),
                Duration::from_millis(config.http.request_timeout_ms),
                config.http.retry_after_seconds,
            ),
            enforce_http_admission,
        ));
    tracing::info!(addr = %config.bind, "fmarch server listening");
    let shutdown_receiver = supervisor.shutdown_receiver();
    let mut server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(wait_for_shutdown_request(shutdown_receiver))
            .await
    });

    enum StopReason {
        Signal(Result<&'static str, String>),
        Fatal(runtime_supervisor::SupervisorFailure),
        ServerExited(Result<(), String>),
        SupervisorExited,
    }

    let stop_reason = tokio::select! {
        result = &mut server => {
            StopReason::ServerExited(match result {
                Ok(Ok(())) => Ok(()),
                Ok(Err(error)) => Err(error.to_string()),
                Err(error) => Err(format!("HTTP server task join failed: {error}")),
            })
        }
        signal = process_shutdown_signal() => {
            StopReason::Signal(signal.map_err(|error| error.to_string()))
        }
        failure = supervisor.wait_for_fatal() => match failure {
            Some(failure) => StopReason::Fatal(failure),
            None => StopReason::SupervisorExited,
        },
    };
    supervisor.request_shutdown();
    let mut cleanup_failures = Vec::new();
    if !matches!(&stop_reason, StopReason::ServerExited(_)) {
        match tokio::time::timeout(config.workers.shutdown_drain_timeout, &mut server).await {
            Ok(Ok(Ok(()))) => {}
            Ok(Ok(Err(error))) => cleanup_failures.push(format!(
                "HTTP server failed during graceful shutdown: {error}"
            )),
            Ok(Err(error)) => cleanup_failures.push(format!(
                "HTTP server task join failed during graceful shutdown: {error}"
            )),
            Err(_) => {
                tracing::error!(
                    event = "http_graceful_shutdown_timed_out",
                    timeout_ms = config.workers.shutdown_drain_timeout.as_millis(),
                    "HTTP graceful-shutdown deadline elapsed; aborting remaining connections"
                );
                server.abort();
                match server.await {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => cleanup_failures.push(format!(
                        "aborted HTTP server returned an error while joining: {error}"
                    )),
                    Err(error) if error.is_cancelled() => {}
                    Err(error) => cleanup_failures.push(format!(
                        "aborted HTTP server task failed while joining: {error}"
                    )),
                }
            }
        }
    }
    if let Err(error) = supervisor.shutdown().await {
        cleanup_failures.push(format!("runtime supervisor shutdown failed: {error}"));
    }
    pool.close().await;

    let terminal_error = match stop_reason {
        StopReason::Signal(Ok(signal)) => {
            tracing::info!(signal, "fmarch server stopped gracefully");
            None
        }
        StopReason::Signal(Err(error)) => {
            Some(format!("process shutdown signal listener failed: {error}"))
        }
        StopReason::Fatal(failure) => Some(format!(
            "required runtime worker {} failed: {}",
            failure.worker, failure.reason
        )),
        StopReason::ServerExited(Ok(())) => {
            Some("HTTP server exited without an explicit shutdown request".to_string())
        }
        StopReason::ServerExited(Err(error)) => Some(format!("HTTP server failed: {error}")),
        StopReason::SupervisorExited => {
            Some("runtime supervisor stopped without a terminal worker report".to_string())
        }
    };
    if let Some(error) = terminal_error {
        cleanup_failures.insert(0, error);
    }
    if cleanup_failures.is_empty() {
        Ok(())
    } else {
        Err(std::io::Error::other(cleanup_failures.join("; ")).into())
    }
}

async fn wait_for_shutdown_request(mut shutdown: tokio::sync::watch::Receiver<bool>) {
    if *shutdown.borrow() {
        return;
    }
    while shutdown.changed().await.is_ok() {
        if *shutdown.borrow() {
            return;
        }
    }
}

#[cfg(unix)]
async fn process_shutdown_signal() -> Result<&'static str, std::io::Error> {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {
        result = tokio::signal::ctrl_c() => {
            result?;
            Ok("SIGINT")
        }
        _ = terminate.recv() => Ok("SIGTERM"),
    }
}

#[cfg(not(unix))]
async fn process_shutdown_signal() -> Result<&'static str, std::io::Error> {
    tokio::signal::ctrl_c().await?;
    Ok("CTRL_C")
}

#[cfg(test)]
mod tests {
    use super::{
        bind_from_values, bootstrap_admin_from_values, bounded_env, identity_delivery_mode,
        local_proof_auth_from_values, required_bounded_env, strict_bool_env,
        virtual_hosted_style_from_value, wait_for_shutdown_request, IdentityDeliveryMode,
        MIN_DATABASE_POOL_CONNECTIONS, MIN_IDLE_TRANSACTION_TIMEOUT_MS,
    };

    const TEST_LOCAL_PROOF_SECRET: &str =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn identity_delivery_selection_is_explicit_and_fail_closed() {
        assert_eq!(
            identity_delivery_mode(false, false, false, false).unwrap(),
            IdentityDeliveryMode::Disabled
        );
        assert_eq!(
            identity_delivery_mode(true, true, false, false).unwrap(),
            IdentityDeliveryMode::HttpJson
        );
        assert_eq!(
            identity_delivery_mode(true, false, true, true).unwrap(),
            IdentityDeliveryMode::LocalDeterministic
        );
        assert!(identity_delivery_mode(true, false, false, true).is_err());
        assert!(identity_delivery_mode(true, false, true, false).is_err());
    }
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
    fn platform_port_binds_dual_stack_when_no_explicit_bind_exists() {
        assert_eq!(
            bind_from_values(None, Some("8080")).unwrap().to_string(),
            "[::]:8080"
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
    fn local_proof_auth_requires_debug_loopback_and_a_256_bit_hex_secret() {
        assert!(
            local_proof_auth_from_values(false, false, "[::]:8080".parse().unwrap(), None,)
                .unwrap()
                .is_none()
        );
        assert!(local_proof_auth_from_values(
            false,
            true,
            "127.0.0.1:4000".parse().unwrap(),
            Some(TEST_LOCAL_PROOF_SECRET),
        )
        .is_err());

        for bind in ["[::]:8080", "0.0.0.0:4000", "192.0.2.10:4000"] {
            let error = local_proof_auth_from_values(
                true,
                true,
                bind.parse().unwrap(),
                Some(TEST_LOCAL_PROOF_SECRET),
            )
            .unwrap_err();
            assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);
        }

        for bind in ["127.0.0.1:4000", "[::1]:4000"] {
            assert!(local_proof_auth_from_values(
                true,
                true,
                bind.parse().unwrap(),
                Some(TEST_LOCAL_PROOF_SECRET),
            )
            .unwrap()
            .is_some());
        }

        assert!(
            local_proof_auth_from_values(true, true, "127.0.0.1:4000".parse().unwrap(), None,)
                .is_err()
        );
        assert!(local_proof_auth_from_values(
            true,
            true,
            "127.0.0.1:4000".parse().unwrap(),
            Some("not-a-random-32-byte-hex-secret"),
        )
        .is_err());
        assert!(local_proof_auth_from_values(
            true,
            false,
            "127.0.0.1:4000".parse().unwrap(),
            Some(TEST_LOCAL_PROOF_SECRET),
        )
        .is_err());

        let first = local_proof_auth_from_values(
            true,
            true,
            "127.0.0.1:4000".parse().unwrap(),
            Some(TEST_LOCAL_PROOF_SECRET),
        )
        .unwrap()
        .unwrap();
        let same_credential = local_proof_auth_from_values(
            true,
            true,
            "127.0.0.1:4001".parse().unwrap(),
            Some(TEST_LOCAL_PROOF_SECRET),
        )
        .unwrap()
        .unwrap();
        let second = local_proof_auth_from_values(
            true,
            true,
            "127.0.0.1:4002".parse().unwrap(),
            Some("fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"),
        )
        .unwrap()
        .unwrap();
        assert_ne!(first.instance_id(), same_credential.instance_id());
        assert_ne!(first.instance_id(), second.instance_id());
        assert_eq!(first.instance_id().as_str().len(), 64);
    }

    #[test]
    fn bounded_capacity_values_reject_invalid_configuration() {
        std::env::set_var("FMARCH_TEST_CAPACITY_VALUE", "0");
        let error = bounded_env("FMARCH_TEST_CAPACITY_VALUE", 10, 1, 100).unwrap_err();
        std::env::remove_var("FMARCH_TEST_CAPACITY_VALUE");
        assert!(error.to_string().contains("between 1 and 100"));
    }

    #[test]
    fn ambiguous_boolean_configuration_is_rejected() {
        std::env::set_var("FMARCH_TEST_STRICT_BOOL", "true");
        let error = strict_bool_env("FMARCH_TEST_STRICT_BOOL", false).unwrap_err();
        std::env::remove_var("FMARCH_TEST_STRICT_BOOL");
        assert!(error.to_string().contains("exactly 0 or 1"));
    }

    #[tokio::test]
    async fn graceful_shutdown_watch_wakes_server_owner() {
        let (shutdown, receiver) = tokio::sync::watch::channel(false);
        let waiter = tokio::spawn(wait_for_shutdown_request(receiver));
        shutdown.send(true).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap();
    }

    #[test]
    fn required_media_read_capacity_has_no_ambient_default() {
        const NAME: &str = "FMARCH_TEST_REQUIRED_MEDIA_READ_CAPACITY";
        std::env::remove_var(NAME);
        assert_eq!(
            required_bounded_env(NAME, 1, 64).unwrap_err().kind(),
            std::io::ErrorKind::NotFound
        );
        std::env::set_var(NAME, "65");
        assert_eq!(
            required_bounded_env(NAME, 1, 64).unwrap_err().kind(),
            std::io::ErrorKind::InvalidInput
        );
        std::env::set_var(NAME, "16");
        assert_eq!(required_bounded_env(NAME, 1, 64).unwrap(), 16);
        std::env::remove_var(NAME);
    }

    #[test]
    fn idle_transaction_timeout_cannot_undercut_live_delivery_fence() {
        std::env::set_var(
            "FMARCH_TEST_IDLE_TRANSACTION_TIMEOUT_MS",
            (MIN_IDLE_TRANSACTION_TIMEOUT_MS - 1).to_string(),
        );
        let error = bounded_env(
            "FMARCH_TEST_IDLE_TRANSACTION_TIMEOUT_MS",
            MIN_IDLE_TRANSACTION_TIMEOUT_MS,
            MIN_IDLE_TRANSACTION_TIMEOUT_MS,
            300_000,
        )
        .unwrap_err();
        std::env::remove_var("FMARCH_TEST_IDLE_TRANSACTION_TIMEOUT_MS");
        assert!(error.to_string().contains("between 10000 and 300000"));
    }

    #[test]
    fn database_pool_capacity_accounts_for_listener_and_authority_headroom() {
        std::env::set_var(
            "FMARCH_TEST_DATABASE_POOL_CONNECTIONS",
            (MIN_DATABASE_POOL_CONNECTIONS - 1).to_string(),
        );
        let error = bounded_env(
            "FMARCH_TEST_DATABASE_POOL_CONNECTIONS",
            10,
            MIN_DATABASE_POOL_CONNECTIONS,
            256,
        )
        .unwrap_err();
        std::env::remove_var("FMARCH_TEST_DATABASE_POOL_CONNECTIONS");
        assert!(error.to_string().contains("between 5 and 256"));
    }

    #[test]
    fn s3_url_style_accepts_railway_and_provider_neutral_spellings() {
        assert!(!virtual_hosted_style_from_value("path").unwrap());
        assert!(virtual_hosted_style_from_value("virtual-host").unwrap());
        assert!(virtual_hosted_style_from_value("virtual-hosted").unwrap());
        assert!(virtual_hosted_style_from_value("virtual").is_err());
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
