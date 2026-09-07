use identity::SessionPolicy;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebSocketBudget {
    pub projection_capacity: usize,
    pub projection_delivery_delay: Duration,
    pub max_connections: usize,
    pub max_connections_per_principal: usize,
    pub delivery_max_in_flight: usize,
    pub poll_interval: Duration,
    pub heartbeat_interval: Duration,
    pub audience: String,
    pub ticket_ttl: Duration,
    pub ticket_max_per_window: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandBudget {
    pub max_in_flight: usize,
    pub lock_timeout: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorityBudget {
    pub transaction_max_in_flight: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaBudget {
    pub max_in_flight: usize,
    pub account_quota_bytes: i64,
}

#[derive(Clone)]
pub struct AuthBudget {
    pub password_max_in_flight: usize,
    pub workos_verification_max_in_flight: usize,
    pub workos_verification_max_per_source: i32,
    pub rate_limit_account_max_failures: i32,
    pub rate_limit_source_max_failures: i32,
    pub registration_max_per_source: i32,
    pub rate_limit_window_seconds: i64,
    pub rate_limit_lockout_seconds: i64,
    pub rate_limit_retention_seconds: i64,
    pub trust_source_header: bool,
    pub source_signing_key: Option<Arc<[u8]>>,
    pub session_policy: SessionPolicy,
    pub session_rotation_max_age_seconds: i64,
    pub recent_authentication_max_age_seconds: i64,
}

impl std::fmt::Debug for AuthBudget {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AuthBudget")
            .field("password_max_in_flight", &self.password_max_in_flight)
            .field(
                "workos_verification_max_in_flight",
                &self.workos_verification_max_in_flight,
            )
            .field(
                "workos_verification_max_per_source",
                &self.workos_verification_max_per_source,
            )
            .field(
                "rate_limit_account_max_failures",
                &self.rate_limit_account_max_failures,
            )
            .field(
                "rate_limit_source_max_failures",
                &self.rate_limit_source_max_failures,
            )
            .field(
                "registration_max_per_source",
                &self.registration_max_per_source,
            )
            .field("rate_limit_window_seconds", &self.rate_limit_window_seconds)
            .field(
                "rate_limit_lockout_seconds",
                &self.rate_limit_lockout_seconds,
            )
            .field(
                "rate_limit_retention_seconds",
                &self.rate_limit_retention_seconds,
            )
            .field("trust_source_header", &self.trust_source_header)
            .field(
                "source_signing_key",
                &self.source_signing_key.as_ref().map(|_| "<redacted>"),
            )
            .field("session_policy", &self.session_policy)
            .field(
                "session_rotation_max_age_seconds",
                &self.session_rotation_max_age_seconds,
            )
            .field(
                "recent_authentication_max_age_seconds",
                &self.recent_authentication_max_age_seconds,
            )
            .finish()
    }
}

#[derive(Debug, Clone)]
pub struct ApiRuntimeConfig {
    pub websocket: WebSocketBudget,
    pub command: CommandBudget,
    pub authority: AuthorityBudget,
    pub media: MediaBudget,
    pub auth: AuthBudget,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid API runtime configuration: {0}")]
pub struct ApiRuntimeConfigError(pub String);

impl ApiRuntimeConfig {
    pub fn validate(&self, database_pool_connections: usize) -> Result<(), ApiRuntimeConfigError> {
        if database_pool_connections < 5 {
            return Err(ApiRuntimeConfigError(
                "database pool must provide at least five connections".to_string(),
            ));
        }
        let authority_ceiling = database_pool_connections - 3;
        if !(2..=authority_ceiling).contains(&self.authority.transaction_max_in_flight) {
            return Err(ApiRuntimeConfigError(format!(
                "authority transaction budget must be between 2 and {authority_ceiling} for a {database_pool_connections}-connection pool"
            )));
        }
        if !(1..self.authority.transaction_max_in_flight)
            .contains(&self.websocket.delivery_max_in_flight)
        {
            return Err(ApiRuntimeConfigError(
                "WebSocket delivery transactions must leave at least one authority permit"
                    .to_string(),
            ));
        }
        if self.websocket.projection_capacity == 0
            || self.websocket.max_connections == 0
            || self.websocket.max_connections_per_principal == 0
            || self.command.max_in_flight == 0
            || self.media.max_in_flight == 0
            || self.auth.password_max_in_flight == 0
            || self.auth.workos_verification_max_in_flight == 0
        {
            return Err(ApiRuntimeConfigError(
                "all concurrency and queue budgets must be positive".to_string(),
            ));
        }
        if self.websocket.max_connections_per_principal > self.websocket.max_connections {
            return Err(ApiRuntimeConfigError(
                "per-principal WebSocket budget must not exceed the process budget".to_string(),
            ));
        }
        if self.websocket.poll_interval.is_zero()
            || self.websocket.heartbeat_interval.is_zero()
            || self.websocket.ticket_ttl.is_zero()
            || self.command.lock_timeout.is_zero()
        {
            return Err(ApiRuntimeConfigError(
                "all runtime deadlines and intervals must be positive".to_string(),
            ));
        }
        if self.websocket.audience.trim().is_empty() {
            return Err(ApiRuntimeConfigError(
                "WebSocket audience must not be empty".to_string(),
            ));
        }
        if self.media.account_quota_bytes < 12 * 1024 * 1024 {
            return Err(ApiRuntimeConfigError(
                "media account quota must fit one maximum canonical upload".to_string(),
            ));
        }
        if self.auth.rate_limit_retention_seconds
            < self
                .auth
                .rate_limit_window_seconds
                .max(self.auth.rate_limit_lockout_seconds)
        {
            return Err(ApiRuntimeConfigError(
                "auth-attempt retention must cover both window and lockout".to_string(),
            ));
        }
        if self.auth.trust_source_header && self.auth.source_signing_key.is_none() {
            return Err(ApiRuntimeConfigError(
                "trusted auth source headers require a signing key".to_string(),
            ));
        }
        Ok(())
    }
}

impl Default for ApiRuntimeConfig {
    fn default() -> Self {
        Self {
            websocket: WebSocketBudget {
                projection_capacity: 256,
                projection_delivery_delay: Duration::ZERO,
                max_connections: 512,
                max_connections_per_principal: 4,
                delivery_max_in_flight: 1,
                poll_interval: Duration::from_secs(5),
                heartbeat_interval: Duration::from_secs(10),
                audience: "fmarch-live".to_string(),
                ticket_ttl: Duration::from_secs(30),
                ticket_max_per_window: 60,
            },
            command: CommandBudget {
                max_in_flight: 32,
                lock_timeout: Duration::from_secs(5),
            },
            authority: AuthorityBudget {
                transaction_max_in_flight: 2,
            },
            media: MediaBudget {
                max_in_flight: 2,
                account_quota_bytes: 256 * 1024 * 1024,
            },
            auth: AuthBudget {
                password_max_in_flight: 4,
                workos_verification_max_in_flight: 8,
                workos_verification_max_per_source: 120,
                rate_limit_account_max_failures: 5,
                rate_limit_source_max_failures: 50,
                registration_max_per_source: 5,
                rate_limit_window_seconds: 900,
                rate_limit_lockout_seconds: 900,
                rate_limit_retention_seconds: 3_600,
                trust_source_header: false,
                source_signing_key: None,
                session_policy: SessionPolicy::default(),
                session_rotation_max_age_seconds: 86_400,
                recent_authentication_max_age_seconds: 600,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ApiRuntimeConfig;

    #[test]
    fn default_budget_matches_default_pool_contract() {
        ApiRuntimeConfig::default().validate(10).unwrap();
    }

    #[test]
    fn cross_budget_validation_rejects_starving_authority_work() {
        let mut config = ApiRuntimeConfig::default();
        config.websocket.delivery_max_in_flight = config.authority.transaction_max_in_flight;
        assert!(config.validate(10).is_err());
    }

    #[test]
    fn cross_budget_validation_rejects_untrusted_source_provenance() {
        let mut config = ApiRuntimeConfig::default();
        config.auth.trust_source_header = true;
        assert!(config.validate(10).is_err());
    }
}
