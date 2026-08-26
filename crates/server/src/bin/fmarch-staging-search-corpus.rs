use std::{env, process};

use serde_json::json;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() {
    match run().await {
        Ok(receipt) => println!(
            "{}",
            serde_json::to_string(&receipt).expect("staging corpus receipt serializes")
        ),
        Err(error) => {
            eprintln!("{}", json!({"status": "error", "error": error}));
            process::exit(1);
        }
    }
}

async fn run() -> Result<server::staging_search_corpus::StagingSearchCorpusReceipt, String> {
    let operation = env::args().nth(1).unwrap_or_default();
    if operation != "reconcile" || env::args().nth(2).is_some() {
        return Err("usage: fmarch-staging-search-corpus reconcile".to_string());
    }
    let environment = env::var("RAILWAY_ENVIRONMENT_NAME")
        .map_err(|_| "RAILWAY_ENVIRONMENT_NAME is required".to_string())?;
    if environment != "staging" {
        return Err(format!(
            "fmarch-staging-search-corpus is staging-only; refusing environment {environment}"
        ));
    }
    if env::var_os("DATABASE_MIGRATION_URL").is_some()
        || env::var_os("DATABASE_KEY_ADMIN_URL").is_some()
        || env::var_os("FMARCH_DATABASE_APPLICATION_PASSWORD").is_some()
        || env::var_os("FMARCH_DATABASE_KEY_ADMIN_PASSWORD").is_some()
    {
        return Err(
            "fmarch-staging-search-corpus accepts only the application DATABASE_URL".to_string(),
        );
    }
    server::reject_ambient_postgres_environment("fmarch-staging-search-corpus", "DATABASE_URL")?;
    let database_url =
        env::var("DATABASE_URL").map_err(|_| "DATABASE_URL is required".to_string())?;
    server::validate_database_transport(&database_url, "DATABASE_URL")?;
    eventstore::require_secure_event_encryption_configuration()
        .map_err(|error| error.to_string())?;

    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .map_err(|error| format!("connect staging search corpus database: {error}"))?;
    server::ensure_schema_ready(&pool)
        .await
        .map_err(|error| format!("staging search corpus schema is not ready: {error}"))?;
    server::verify_database_principal(&pool, server::DatabasePrincipal::Application)
        .await
        .map_err(|error| format!("staging search corpus database authority is invalid: {error}"))?;
    eventstore::attest_active_runtime_kek(&pool)
        .await
        .map_err(|error| format!("staging search corpus event authority is invalid: {error}"))?;
    eventstore::audit_event_encryption_key_coverage(&pool)
        .await
        .map_err(|error| format!("staging search corpus event key coverage failed: {error}"))?;

    server::staging_search_corpus::reconcile(&pool).await
}
