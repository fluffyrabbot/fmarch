use std::{env, str::FromStr};

use serde_json::json;
use sqlx::{postgres::PgConnectOptions, PgPool};
use url::Url;

use server::one_shot_database::{
    application_name, debug_operation_delay, exact_operation_id, validate_debug_operation_delay,
    OneShotDatabaseTimeouts, OperationId,
};

type DynError = Box<dyn std::error::Error>;

#[tokio::main]
async fn main() -> Result<(), DynError> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let operation_id = parse_operation_id()?;
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

    let timeouts = OneShotDatabaseTimeouts::from_env()?;
    validate_debug_operation_delay()?;
    let session_name = application_name("fmarch-migrate", &operation_id);
    let base_options = PgConnectOptions::from_str(&database_url)?;
    let migration_pool = timeouts
        .pool_options(2)
        .connect_lazy_with(base_options.clone().application_name(&session_name));
    let application_pool = timeouts.pool_options(1).connect_lazy_with(
        base_options
            .clone()
            .username(server::APPLICATION_DATABASE_ROLE)
            .password(&application_password)
            .application_name(&session_name),
    );
    let key_admin_pool = timeouts.pool_options(1).connect_lazy_with(
        base_options
            .username(server::KEY_ADMIN_DATABASE_ROLE)
            .password(&key_admin_password)
            .application_name(&session_name),
    );
    let database_identity = server::configured_database_environment_identity("migration")?;

    let operation = tokio::time::timeout(
        timeouts.operation(),
        migrate(
            &migration_pool,
            &application_pool,
            &key_admin_pool,
            database_identity.as_ref(),
            &application_password,
            &key_admin_password,
            timeouts,
        ),
    )
    .await;
    let (migration_cleanup, application_cleanup, key_admin_cleanup) = tokio::join!(
        timeouts.close_pool(&migration_pool),
        timeouts.close_pool(&application_pool),
        timeouts.close_pool(&key_admin_pool),
    );
    let cleanup_errors = [
        migration_cleanup.err(),
        application_cleanup.err(),
        key_admin_cleanup.err(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("; ");
    let operation = match operation {
        Ok(result) => result,
        Err(_) => Err(format!(
            "fmarch-migrate operation {operation_id} exceeded its database operation deadline"
        )
        .into()),
    };
    match (operation, cleanup_errors.is_empty()) {
        (Err(error), false) => return Err(format!("{error}; {cleanup_errors}").into()),
        (Err(error), true) => return Err(error),
        (Ok(()), false) => return Err(cleanup_errors.into()),
        (Ok(()), true) => {}
    }

    println!(
        "{}",
        json!({
            "kind": "fmarch-database-migration-complete",
            "operation_id": operation_id.as_str(),
            "release_commit": api::release_commit(),
        })
    );
    tracing::info!(%operation_id, "fmarch database migrations complete");
    Ok(())
}

fn parse_operation_id() -> Result<OperationId, DynError> {
    match env::args().skip(1).collect::<Vec<_>>().as_slice() {
        [flag, operation_id] if flag == "--operation-id" => Ok(exact_operation_id(operation_id)?),
        _ => Err("usage: fmarch-migrate --operation-id <64-lowercase-hex>".into()),
    }
}

async fn migrate(
    migration_pool: &PgPool,
    application_pool: &PgPool,
    key_admin_pool: &PgPool,
    database_identity: Option<&server::DatabaseEnvironmentIdentity>,
    application_password: &str,
    key_admin_password: &str,
    timeouts: OneShotDatabaseTimeouts,
) -> Result<(), DynError> {
    let mut operation_lock = migration_pool.acquire().await?;
    // This connection owns a session advisory lock. It must never be returned
    // to the pool by cancellation or an early error.
    operation_lock.close_on_drop();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(server::DATABASE_IDENTITY_ADVISORY_LOCK)
        .execute(&mut *operation_lock)
        .await?;
    debug_operation_delay().await?;

    let operation = async {
        sqlx::query("SELECT set_config('search_path', 'public', false)")
            .execute(migration_pool)
            .await?;
        sqlx::query("SELECT set_config('session_replication_role', 'origin', false)")
            .execute(migration_pool)
            .await?;
        server::verify_migration_authority(migration_pool).await?;
        if let Some(identity) = database_identity {
            server::verify_database_environment_identity(
                &mut operation_lock,
                &identity.environment,
                &identity.project_id,
                &identity.environment_id,
            )
            .await?;
        }

        run_migrations(migration_pool, timeouts).await?;
        server::ensure_schema_ready(migration_pool).await?;
        server::reconcile_database_authority(
            migration_pool,
            application_password,
            key_admin_password,
        )
        .await?;

        server::ensure_schema_ready(application_pool).await?;
        server::verify_database_principal(application_pool, server::DatabasePrincipal::Application)
            .await?;
        server::ensure_schema_ready(key_admin_pool).await?;
        server::verify_database_principal(key_admin_pool, server::DatabasePrincipal::KeyAdmin)
            .await?;
        Ok::<_, DynError>(())
    }
    .await;

    let unlock = sqlx::query_scalar::<_, bool>("SELECT pg_advisory_unlock($1)")
        .bind(server::DATABASE_IDENTITY_ADVISORY_LOCK)
        .fetch_one(&mut *operation_lock)
        .await;
    match (operation, unlock) {
        (Ok(()), Ok(true)) => Ok(()),
        (Ok(()), Ok(false)) => Err("fmarch-migrate lost its database operation lock".into()),
        (Ok(()), Err(error)) => Err(error.into()),
        (Err(error), Ok(true)) => Err(error),
        (Err(error), Ok(false)) => Err(format!(
            "{error}; fmarch-migrate lost its database operation lock during failure cleanup"
        )
        .into()),
        (Err(error), Err(unlock_error)) => Err(format!(
            "{error}; fmarch-migrate could not release its database operation lock: {unlock_error}"
        )
        .into()),
    }
}

async fn run_migrations(pool: &PgPool, timeouts: OneShotDatabaseTimeouts) -> Result<(), DynError> {
    let mut connection = pool.acquire().await?;
    // SQLx's migrator uses its own session advisory lock, and the baseline SQL
    // can disable the session timeouts. Never return this physical session to
    // the pool, including when the enclosing operation future is cancelled.
    connection.close_on_drop();
    let migration =
        tokio::time::timeout(timeouts.statement(), server::MIGRATOR.run(&mut *connection)).await;
    let migration = match migration {
        Ok(Ok(())) => timeouts
            .apply_session(&mut connection)
            .await
            .map_err(|error| Box::new(error) as DynError),
        Ok(Err(error)) => Err(error.into()),
        Err(_) => {
            Err("fmarch-migrate baseline exceeded its process-side statement deadline".into())
        }
    };
    let cleanup = timeouts.close_connection(connection).await;
    match (migration, cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(error)) => Err(error.into()),
        (Err(error), Err(cleanup_error)) => Err(format!("{error}; {cleanup_error}").into()),
    }
}
