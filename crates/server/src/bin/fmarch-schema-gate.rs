use std::{env, process, time::Duration};

use database_schema::{DatabaseAuthorityError, DatabasePrincipal, SchemaReadiness};
use serde_json::json;
use sqlx::postgres::PgPoolOptions;

const DEFAULT_TIMEOUT_MS: u64 = 180_000;
const DEFAULT_INTERVAL_MS: u64 = 1_000;

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{}", json!({"status": "error", "error": error}));
        process::exit(1);
    }
    println!("{}", json!({"status": "ready"}));
}

async fn run() -> Result<(), String> {
    if env::var_os("DATABASE_MIGRATION_URL").is_some()
        || env::var_os("DATABASE_KEY_ADMIN_URL").is_some()
        || env::var_os("FMARCH_DATABASE_APPLICATION_PASSWORD").is_some()
        || env::var_os("FMARCH_DATABASE_KEY_ADMIN_PASSWORD").is_some()
    {
        return Err(
            "fmarch-schema-gate accepts only the application DATABASE_URL; privileged database credentials must not enter its environment"
                .to_string(),
        );
    }
    server::reject_ambient_postgres_environment("fmarch-schema-gate", "DATABASE_URL")?;
    let database_url = env::var("DATABASE_URL")
        .map_err(|_| "DATABASE_URL is required by fmarch-schema-gate".to_string())?;
    server::validate_database_transport(&database_url, "DATABASE_URL")?;
    let timeout_ms = bounded_env_ms(
        "FMARCH_SCHEMA_GATE_TIMEOUT_MS",
        DEFAULT_TIMEOUT_MS,
        1_000,
        900_000,
    )?;
    let interval_ms = bounded_env_ms(
        "FMARCH_SCHEMA_GATE_INTERVAL_MS",
        DEFAULT_INTERVAL_MS,
        100,
        10_000,
    )?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_millis(interval_ms.max(1_000)))
        .connect_lazy(&database_url)
        .map_err(|error| format!("invalid DATABASE_URL: {error}"))?;
    let started = tokio::time::Instant::now();
    let deadline = started + Duration::from_millis(timeout_ms);
    let mut last_pending;
    loop {
        match database_schema::inspect_schema_readiness(&pool).await {
            Ok(SchemaReadiness::Ready) => {
                match database_schema::verify_database_principal(
                    &pool,
                    DatabasePrincipal::Application,
                )
                .await
                {
                    Ok(()) => return Ok(()),
                    Err(DatabaseAuthorityError::Configuration(message)) => {
                        last_pending =
                            format!("database ACL reconciliation is not ready: {message}");
                    }
                    Err(DatabaseAuthorityError::Storage(error)) => {
                        last_pending = format!("database authority is not queryable yet: {error}");
                    }
                }
            }
            Ok(SchemaReadiness::Pending { reason }) => last_pending = reason,
            Err(sqlx::Error::Protocol(message)) => return Err(message),
            Err(error) => last_pending = format!("database is not queryable yet: {error}"),
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "schema gate timed out after {timeout_ms}ms: {last_pending}"
            ));
        }
        tokio::time::sleep(Duration::from_millis(interval_ms)).await;
    }
}

fn bounded_env_ms(name: &str, default: u64, minimum: u64, maximum: u64) -> Result<u64, String> {
    let value = match env::var(name) {
        Ok(raw) => raw
            .parse::<u64>()
            .map_err(|_| format!("{name} must be an integer"))?,
        Err(env::VarError::NotPresent) => default,
        Err(error) => return Err(format!("cannot read {name}: {error}")),
    };
    if !(minimum..=maximum).contains(&value) {
        return Err(format!("{name} must be {minimum}..={maximum}"));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::bounded_env_ms;

    #[test]
    fn bounded_values_reject_out_of_range_inputs() {
        std::env::set_var("FMARCH_TEST_SCHEMA_GATE_MS", "99");
        let error = bounded_env_ms("FMARCH_TEST_SCHEMA_GATE_MS", 1_000, 100, 10_000)
            .expect_err("out-of-range value should fail");
        assert!(error.contains("100..=10000"));
        std::env::remove_var("FMARCH_TEST_SCHEMA_GATE_MS");
    }
}
