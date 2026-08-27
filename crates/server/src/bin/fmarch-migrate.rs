use std::{env, str::FromStr};

use serde_json::json;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use url::Url;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    if env::var_os("DATABASE_URL").is_some() || env::var_os("DATABASE_KEY_ADMIN_URL").is_some() {
        return Err("fmarch-migrate accepts only DATABASE_MIGRATION_URL; runtime and key-admin credentials must not enter the migrator environment".into());
    }
    server::reject_ambient_postgres_environment("fmarch-migrate", "DATABASE_MIGRATION_URL")?;
    let database_url = env::var("DATABASE_MIGRATION_URL")?;
    server::validate_database_transport(&database_url, "DATABASE_MIGRATION_URL")?;
    let application_password = env::var("FMARCH_DATABASE_APPLICATION_PASSWORD")?;
    let key_admin_password = env::var("FMARCH_DATABASE_KEY_ADMIN_PASSWORD")?;
    let migration_url = Url::parse(&database_url)?;
    if matches!(
        migration_url.username(),
        server::APPLICATION_DATABASE_ROLE | server::KEY_ADMIN_DATABASE_ROLE
    ) {
        return Err("DATABASE_MIGRATION_URL must use a distinct schema-owner login".into());
    }
    let migration_password = migration_url
        .password()
        .map(|password| {
            percent_encoding::percent_decode_str(password)
                .decode_utf8()
                .map(|password| password.into_owned())
        })
        .transpose()?;
    if migration_password
        .as_deref()
        .is_some_and(|password| password == application_password || password == key_admin_password)
    {
        return Err(
            "database migration, application, and key-admin passwords must all differ".into(),
        );
    }
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await?;
    sqlx::query("SELECT set_config('search_path', 'public', false)")
        .execute(&pool)
        .await?;
    sqlx::query("SELECT set_config('session_replication_role', 'origin', false)")
        .execute(&pool)
        .await?;
    server::verify_migration_authority(&pool).await?;
    server::MIGRATOR.run(&pool).await?;
    server::ensure_schema_ready(&pool).await?;
    server::reconcile_database_authority(&pool, &application_password, &key_admin_password).await?;

    let base_options = PgConnectOptions::from_str(&database_url)?;
    let application_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(
            base_options
                .clone()
                .username(server::APPLICATION_DATABASE_ROLE)
                .password(&application_password),
        )
        .await?;
    server::ensure_schema_ready(&application_pool).await?;
    server::verify_database_principal(&application_pool, server::DatabasePrincipal::Application)
        .await?;
    let key_admin_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(
            base_options
                .username(server::KEY_ADMIN_DATABASE_ROLE)
                .password(&key_admin_password),
        )
        .await?;
    server::ensure_schema_ready(&key_admin_pool).await?;
    server::verify_database_principal(&key_admin_pool, server::DatabasePrincipal::KeyAdmin).await?;
    println!(
        "{}",
        json!({
            "kind": "fmarch-database-migration-complete",
            "release_commit": api::release_commit(),
        })
    );
    tracing::info!("fmarch database migrations complete");
    Ok(())
}
