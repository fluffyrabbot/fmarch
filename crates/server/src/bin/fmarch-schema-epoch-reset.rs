use std::env;

use serde_json::json;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    if env::var_os("DATABASE_URL").is_some() || env::var_os("DATABASE_KEY_ADMIN_URL").is_some() {
        return Err("schema epoch reset accepts only DATABASE_MIGRATION_URL".into());
    }
    server::reject_ambient_postgres_environment(
        "fmarch-schema-epoch-reset",
        "DATABASE_MIGRATION_URL",
    )?;
    let execute = match env::args().skip(1).collect::<Vec<_>>().as_slice() {
        [] => false,
        [flag] if flag == "--execute" => true,
        _ => return Err("usage: fmarch-schema-epoch-reset [--execute]".into()),
    };
    let database_url = env::var("DATABASE_MIGRATION_URL")?;
    server::validate_database_transport(&database_url, "DATABASE_MIGRATION_URL")?;
    let environment = env::var("FMARCH_SCHEMA_EPOCH_RESET_ENVIRONMENT")?;
    if !matches!(environment.as_str(), "staging" | "production") {
        return Err("schema epoch reset environment must be staging or production".into());
    }
    let epoch: u64 = env::var("FMARCH_SCHEMA_EPOCH_RESET_EPOCH")?.parse()?;
    if epoch == 0 {
        return Err("schema epoch reset epoch must be positive".into());
    }
    let release_commit = api::release_commit();
    if !release_commit.bytes().all(|byte| byte.is_ascii_hexdigit()) || release_commit.len() != 40 {
        return Err("schema epoch reset requires an exact release build".into());
    }
    let expected_confirmation = format!("{environment}:{epoch}:{release_commit}");
    if env::var("FMARCH_SCHEMA_EPOCH_RESET_CONFIRM")? != expected_confirmation {
        return Err(
            "schema epoch reset confirmation does not match environment, epoch, and release commit"
                .into(),
        );
    }

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await?;
    sqlx::query("SELECT set_config('search_path', 'public', false)")
        .execute(&pool)
        .await?;
    server::verify_migration_authority(&pool).await?;
    let audit = sqlx::query_scalar::<_, serde_json::Value>(
        r#"
        SELECT jsonb_build_object(
            'platform_principal', (SELECT COUNT(*) FROM platform_principal),
            'member_profile', (SELECT COUNT(*) FROM member_profile),
            'profile_mute', (SELECT COUNT(*) FROM profile_mute),
            'events', (SELECT COUNT(*) FROM events),
            'public_search_document', (SELECT COUNT(*) FROM public_search_document),
            'sqlx_migrations', (SELECT COUNT(*) FROM _sqlx_migrations)
        )
        "#,
    )
    .fetch_one(&pool)
    .await?;
    println!(
        "{}",
        json!({
            "kind": "fmarch-schema-epoch-reset-audit",
            "environment": environment,
            "epoch": epoch,
            "release_commit": release_commit,
            "execute": execute,
            "counts": audit,
        })
    );
    if !execute {
        return Ok(());
    }

    let mut tx = pool.begin().await?;
    sqlx::query("DROP SCHEMA public CASCADE")
        .execute(&mut *tx)
        .await?;
    sqlx::query("CREATE SCHEMA public AUTHORIZATION CURRENT_USER")
        .execute(&mut *tx)
        .await?;
    sqlx::query("REVOKE ALL ON SCHEMA public FROM PUBLIC")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    println!(
        "{}",
        json!({
            "kind": "fmarch-schema-epoch-reset-complete",
            "environment": environment,
            "epoch": epoch,
            "release_commit": release_commit,
            "prior_counts": audit,
        })
    );
    Ok(())
}
