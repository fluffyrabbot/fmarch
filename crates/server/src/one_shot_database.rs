use std::{env, fmt, time::Duration};

use sqlx::{
    pool::PoolConnection,
    postgres::{PgConnection, PgPoolOptions},
    PgPool, Postgres,
};

pub const ACQUIRE_TIMEOUT_VARIABLE: &str = "FMARCH_DB_ACQUIRE_TIMEOUT_MS";
pub const LOCK_TIMEOUT_VARIABLE: &str = "FMARCH_DB_LOCK_TIMEOUT_MS";
pub const STATEMENT_TIMEOUT_VARIABLE: &str = "FMARCH_DB_STATEMENT_TIMEOUT_MS";
pub const OPERATION_TIMEOUT_VARIABLE: &str = "FMARCH_DB_OPERATION_TIMEOUT_MS";
const OPERATION_DELAY_FAILPOINT_VARIABLE: &str = "FMARCH_DB_OPERATION_TEST_DELAY_MS";

pub const ACQUIRE_TIMEOUT_MS: u64 = 30_000;
pub const LOCK_TIMEOUT_MS: u64 = 60_000;
pub const STATEMENT_TIMEOUT_MS: u64 = 300_000;
pub const OPERATION_TIMEOUT_MS: u64 = 600_000;

const CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OneShotDatabaseTimeouts {
    acquire: Duration,
    lock: Duration,
    statement: Duration,
    operation: Duration,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperationId(String);

impl OperationId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for OperationId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl OneShotDatabaseTimeouts {
    pub fn from_env() -> Result<Self, String> {
        Self::from_values([
            Some(read_required_timeout(ACQUIRE_TIMEOUT_VARIABLE)?),
            Some(read_required_timeout(LOCK_TIMEOUT_VARIABLE)?),
            Some(read_required_timeout(STATEMENT_TIMEOUT_VARIABLE)?),
            Some(read_required_timeout(OPERATION_TIMEOUT_VARIABLE)?),
        ])
    }

    fn from_values(values: [Option<String>; 4]) -> Result<Self, String> {
        let acquire = parse_timeout(
            ACQUIRE_TIMEOUT_VARIABLE,
            values[0].as_deref(),
            ACQUIRE_TIMEOUT_MS,
        )?;
        let lock = parse_timeout(LOCK_TIMEOUT_VARIABLE, values[1].as_deref(), LOCK_TIMEOUT_MS)?;
        let statement = parse_timeout(
            STATEMENT_TIMEOUT_VARIABLE,
            values[2].as_deref(),
            STATEMENT_TIMEOUT_MS,
        )?;
        let operation = parse_timeout(
            OPERATION_TIMEOUT_VARIABLE,
            values[3].as_deref(),
            OPERATION_TIMEOUT_MS,
        )?;
        validate_timeout_order(acquire, lock, statement, operation)?;
        Ok(Self {
            acquire: Duration::from_millis(acquire),
            lock: Duration::from_millis(lock),
            statement: Duration::from_millis(statement),
            operation: Duration::from_millis(operation),
        })
    }

    pub fn operation(self) -> Duration {
        self.operation
    }

    pub fn statement(self) -> Duration {
        self.statement
    }

    pub fn pool_options(self, max_connections: u32) -> PgPoolOptions {
        PgPoolOptions::new()
            .max_connections(max_connections)
            .acquire_timeout(self.acquire)
            .after_connect(move |connection, _metadata| {
                Box::pin(async move { self.apply_session(connection).await })
            })
    }

    pub async fn apply_session(self, connection: &mut PgConnection) -> Result<(), sqlx::Error> {
        sqlx::query("SELECT set_config('statement_timeout', $1, false)")
            .bind(format!("{}ms", self.statement.as_millis()))
            .execute(&mut *connection)
            .await?;
        sqlx::query("SELECT set_config('lock_timeout', $1, false)")
            .bind(format!("{}ms", self.lock.as_millis()))
            .execute(&mut *connection)
            .await?;
        Ok(())
    }

    /// Close an entire one-shot pool after success, failure, or cancellation.
    /// Calling `Pool::close` synchronously marks the pool closed; a bounded
    /// wait then lets checked-out sessions return and close gracefully.
    pub async fn close_pool(self, pool: &PgPool) -> Result<(), String> {
        tokio::time::timeout(CLEANUP_TIMEOUT, pool.close())
            .await
            .map_err(|_| "one-shot database pool cleanup exceeded 5 seconds".to_string())
    }

    pub async fn close_connection(
        self,
        mut connection: PoolConnection<Postgres>,
    ) -> Result<(), String> {
        connection.close_on_drop();
        tokio::time::timeout(CLEANUP_TIMEOUT, connection.close())
            .await
            .map_err(|_| "one-shot database connection cleanup exceeded 5 seconds".to_string())?
            .map_err(|error| format!("one-shot database connection cleanup failed: {error}"))
    }
}

pub fn exact_operation_id(value: &str) -> Result<OperationId, String> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(OperationId(value.to_string()))
    } else {
        Err("--operation-id must be exactly 64 lowercase hexadecimal characters".to_string())
    }
}

pub fn application_name(process_name: &str, operation_id: &OperationId) -> String {
    // PostgreSQL limits application_name to 63 bytes. The process name plus a
    // 32-hex digest prefix is collision-resistant enough for session cleanup
    // diagnostics while the complete operation ID remains in durable output.
    let digest_prefix = operation_id.as_str().chars().take(32).collect::<String>();
    format!("{process_name}:{digest_prefix}")
}

pub fn validate_debug_operation_delay() -> Result<(), String> {
    debug_operation_delay_duration().map(|_| ())
}

/// Delay the start of a database operation so integration proof can exercise
/// the process-side deadline independently of PostgreSQL's shorter timeouts.
/// The failpoint is rejected by release binaries.
pub async fn debug_operation_delay() -> Result<(), String> {
    if let Some(delay) = debug_operation_delay_duration()? {
        tokio::time::sleep(delay).await;
    }
    Ok(())
}

fn debug_operation_delay_duration() -> Result<Option<Duration>, String> {
    match env::var(OPERATION_DELAY_FAILPOINT_VARIABLE) {
        Err(env::VarError::NotPresent) => Ok(None),
        Ok(raw) if cfg!(debug_assertions) => raw
            .parse::<u64>()
            .ok()
            .filter(|value| *value > 0 && *value <= 60_000)
            .map(Duration::from_millis)
            .map(Some)
            .ok_or_else(|| {
                format!(
                    "{OPERATION_DELAY_FAILPOINT_VARIABLE} must be between 1 and 60000 milliseconds"
                )
            }),
        Ok(_) => Err(format!(
            "{OPERATION_DELAY_FAILPOINT_VARIABLE} is unavailable in this build"
        )),
        Err(env::VarError::NotUnicode(_)) => Err(format!(
            "{OPERATION_DELAY_FAILPOINT_VARIABLE} must be valid UTF-8"
        )),
    }
}

fn read_required_timeout(name: &str) -> Result<String, String> {
    match env::var(name) {
        Ok(value) => Ok(value),
        Err(env::VarError::NotPresent) => Err(format!("{name} is required")),
        Err(env::VarError::NotUnicode(_)) => Err(format!("{name} must be valid UTF-8")),
    }
}

fn parse_timeout(name: &str, raw: Option<&str>, canonical: u64) -> Result<u64, String> {
    let Some(raw) = raw else {
        return Ok(canonical);
    };
    let value = raw
        .parse::<u64>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| format!("{name} must be a positive integer number of milliseconds"))?;
    if cfg!(debug_assertions) {
        if value > canonical {
            return Err(format!(
                "debug {name} may only shorten its canonical {canonical}ms deadline"
            ));
        }
    } else if raw != canonical.to_string() {
        return Err(format!(
            "{name} must equal its canonical release value {canonical}ms"
        ));
    }
    Ok(value)
}

fn validate_timeout_order(
    acquire: u64,
    lock: u64,
    statement: u64,
    operation: u64,
) -> Result<(), String> {
    if acquire < lock && lock < statement && statement < operation {
        Ok(())
    } else {
        Err(format!(
            "one-shot database timeouts must satisfy {ACQUIRE_TIMEOUT_VARIABLE} < {LOCK_TIMEOUT_VARIABLE} < {STATEMENT_TIMEOUT_VARIABLE} < {OPERATION_TIMEOUT_VARIABLE}"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(values: [&str; 4]) -> [Option<String>; 4] {
        values.map(|value| Some(value.to_string()))
    }

    #[test]
    fn canonical_timeouts_preserve_the_one_shot_budget_order() {
        let timeouts =
            OneShotDatabaseTimeouts::from_values(values(["30000", "60000", "300000", "600000"]))
                .unwrap();
        assert_eq!(timeouts.acquire, Duration::from_millis(30_000));
        assert_eq!(timeouts.lock, Duration::from_millis(60_000));
        assert_eq!(timeouts.statement, Duration::from_millis(300_000));
        assert_eq!(timeouts.operation, Duration::from_millis(600_000));
    }

    #[test]
    fn timeout_order_is_strict() {
        let error = validate_timeout_order(100, 100, 300, 400).unwrap_err();
        assert!(error.contains("must satisfy"));
    }

    #[test]
    fn operation_ids_are_exact_lowercase_digests() {
        assert!(exact_operation_id(&"a".repeat(64)).is_ok());
        assert!(exact_operation_id(&"A".repeat(64)).is_err());
        assert!(exact_operation_id(&"g".repeat(64)).is_err());
        assert!(exact_operation_id(&"a".repeat(63)).is_err());
    }

    #[test]
    fn debug_overrides_can_only_shorten_canonical_deadlines() {
        if cfg!(debug_assertions) {
            OneShotDatabaseTimeouts::from_values(values(["100", "200", "300", "400"])).unwrap();
            assert!(OneShotDatabaseTimeouts::from_values(values([
                "30001", "60000", "300000", "600000"
            ]))
            .is_err());
        }
    }
}
