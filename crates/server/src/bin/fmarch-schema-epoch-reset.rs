use std::env;

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use sqlx::{
    postgres::{PgConnection, PgPoolOptions},
    Acquire,
};

const EMBEDDED_SCHEMA_EPOCH_DOCUMENT: &str =
    include_str!("../../../database_schema/schema/epoch.json");

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum Mode {
    Audit,
    Execute,
    BindDatabaseIdentity,
}

#[derive(Debug)]
struct CompletionEvidence {
    release_commit: String,
    prior_counts: Value,
}

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
    let mode = match env::args().skip(1).collect::<Vec<_>>().as_slice() {
        [] => Mode::Audit,
        [flag] if flag == "--execute" => Mode::Execute,
        [flag] if flag == "--bind-database-identity" => Mode::BindDatabaseIdentity,
        _ => {
            return Err(
                "usage: fmarch-schema-epoch-reset [--execute|--bind-database-identity]".into(),
            )
        }
    };
    let database_url = env::var("DATABASE_MIGRATION_URL")?;
    server::validate_database_transport(&database_url, "DATABASE_MIGRATION_URL")?;
    let release_commit = exact_release_commit()?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await?;
    sqlx::query("SELECT set_config('search_path', 'public', false)")
        .execute(&pool)
        .await?;
    server::verify_migration_authority(&pool).await?;

    let (database_environment, project_id, environment_id) = database_identity_environment()?;
    if mode == Mode::BindDatabaseIdentity {
        let expected_confirmation =
            format!("{project_id}:{environment_id}:{database_environment}:{release_commit}");
        if env::var("FMARCH_DATABASE_IDENTITY_BIND_CONFIRM")? != expected_confirmation {
            return Err("database identity bootstrap confirmation does not match canonical project, environment, and release commit".into());
        }
        server::bind_database_environment_identity(
            &pool,
            &database_environment,
            &project_id,
            &environment_id,
        )
        .await?;
        println!(
            "{}",
            json!({
                "kind": "fmarch-database-environment-identity-bound",
                "project_id": project_id,
                "environment_id": environment_id,
                "environment": database_environment,
                "release_commit": release_commit,
            })
        );
        return Ok(());
    }

    let environment = env::var("FMARCH_SCHEMA_EPOCH_RESET_ENVIRONMENT")?;
    if environment != database_environment {
        return Err("schema reset and durable database environment identities differ".into());
    }
    let epoch: u64 = env::var("FMARCH_SCHEMA_EPOCH_RESET_EPOCH")?.parse()?;
    let embedded_epoch = embedded_schema_epoch()?;
    if epoch != embedded_epoch {
        return Err(format!(
            "schema epoch reset epoch {epoch} does not match embedded schema epoch {embedded_epoch}"
        )
        .into());
    }
    let epoch_i64 = i64::try_from(epoch)?;
    let expected_confirmation = format!("{environment}:{epoch}:{release_commit}");
    if env::var("FMARCH_SCHEMA_EPOCH_RESET_CONFIRM")? != expected_confirmation {
        return Err(
            "schema epoch reset confirmation does not match environment, epoch, and release commit"
                .into(),
        );
    }
    let expected_inventory = if mode == Mode::Execute {
        Some(load_expected_inventory()?)
    } else {
        None
    };
    let fail_after_commit = match env::var("FMARCH_SCHEMA_EPOCH_RESET_FAILPOINT") {
        Err(env::VarError::NotPresent) => false,
        Ok(value) if cfg!(debug_assertions) && value == "after-commit-before-output" => true,
        Ok(_) => return Err("schema epoch reset failpoint is unavailable in this build".into()),
        Err(error) => return Err(error.into()),
    };

    if mode == Mode::Audit {
        let mut tx = pool.begin().await?;
        lock_database_identity(&mut tx).await?;
        server::verify_database_environment_identity(
            &mut tx,
            &environment,
            &project_id,
            &environment_id,
        )
        .await?;
        if completion_store_exists(&mut tx).await? {
            if let Some(completion) = load_completion(&mut tx, &environment, epoch_i64).await? {
                assert_completion_commit(&completion, &release_commit)?;
                tx.commit().await?;
                emit_audit(
                    &environment,
                    epoch,
                    &release_commit,
                    false,
                    &completion.prior_counts,
                );
                return Ok(());
            }
        }
        let audit = audit_counts(&mut tx).await?;
        tx.commit().await?;
        emit_audit(&environment, epoch, &release_commit, false, &audit);
        return Ok(());
    }

    let expected_inventory = expected_inventory.expect("execute inventory was parsed");
    let mut tx = pool.begin().await?;
    lock_database_identity(&mut tx).await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("fmarch-schema-epoch-reset:{environment}"))
        .execute(&mut *tx)
        .await?;
    server::verify_database_environment_identity(
        &mut tx,
        &environment,
        &project_id,
        &environment_id,
    )
    .await?;
    ensure_completion_store(&mut tx).await?;
    if let Some(completion) = load_completion(&mut tx, &environment, epoch_i64).await? {
        assert_completion_commit(&completion, &release_commit)?;
        if completion.prior_counts != expected_inventory {
            return Err("completed schema reset inventory differs from this operation".into());
        }
        tx.commit().await?;
        emit_audit(
            &environment,
            epoch,
            &release_commit,
            true,
            &completion.prior_counts,
        );
        emit_completion(
            &environment,
            epoch,
            &release_commit,
            &completion.prior_counts,
        );
        return Ok(());
    }

    lock_public_data_relations(&mut tx).await?;
    server::verify_database_environment_identity(
        &mut tx,
        &environment,
        &project_id,
        &environment_id,
    )
    .await?;
    let audit = audit_counts(&mut tx).await?;
    if audit != expected_inventory {
        return Err("schema epoch reset inventory changed after the non-mutating audit".into());
    }
    emit_audit(&environment, epoch, &release_commit, true, &audit);
    sqlx::query("DROP SCHEMA public CASCADE")
        .execute(&mut *tx)
        .await?;
    sqlx::query("CREATE SCHEMA public AUTHORIZATION CURRENT_USER")
        .execute(&mut *tx)
        .await?;
    sqlx::query("REVOKE ALL ON SCHEMA public FROM PUBLIC")
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        r#"
        INSERT INTO fmarch_release_authority.schema_epoch_reset_completion
            (environment, epoch, release_commit, prior_counts)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(&environment)
    .bind(epoch_i64)
    .bind(&release_commit)
    .bind(&audit)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    if fail_after_commit {
        return Err("injected failure after reset commit and before completion output".into());
    }
    emit_completion(&environment, epoch, &release_commit, &audit);
    Ok(())
}

fn exact_release_commit() -> Result<String, Box<dyn std::error::Error>> {
    let release_commit = if cfg!(debug_assertions) {
        env::var("FMARCH_SCHEMA_EPOCH_RESET_TEST_RELEASE_COMMIT")
            .unwrap_or_else(|_| api::release_commit().to_string())
    } else {
        api::release_commit().to_string()
    };
    if release_commit.len() != 40
        || !release_commit
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("schema epoch reset requires an exact release build".into());
    }
    Ok(release_commit)
}

fn database_identity_environment() -> Result<(String, String, String), Box<dyn std::error::Error>> {
    Ok((
        env::var("FMARCH_DATABASE_ENVIRONMENT")?,
        env::var("FMARCH_DATABASE_PROJECT_ID")?,
        env::var("FMARCH_DATABASE_ENVIRONMENT_ID")?,
    ))
}

async fn lock_database_identity(
    connection: &mut PgConnection,
) -> Result<(), Box<dyn std::error::Error>> {
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(server::DATABASE_IDENTITY_ADVISORY_LOCK)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

fn embedded_schema_epoch() -> Result<u64, Box<dyn std::error::Error>> {
    let document: Value = serde_json::from_str(EMBEDDED_SCHEMA_EPOCH_DOCUMENT)?;
    document
        .get("epoch")
        .and_then(Value::as_u64)
        .filter(|epoch| *epoch > 0)
        .ok_or_else(|| "embedded database schema epoch is invalid".into())
}

async fn ensure_completion_store(
    connection: &mut PgConnection,
) -> Result<(), Box<dyn std::error::Error>> {
    let schema_exists: bool = sqlx::query_scalar("SELECT to_regnamespace($1) IS NOT NULL")
        .bind(server::RELEASE_AUTHORITY_SCHEMA)
        .fetch_one(&mut *connection)
        .await?;
    if !schema_exists {
        return Err("durable database identity schema disappeared before reset".into());
    }
    if !completion_store_exists(connection).await? {
        sqlx::query(
            r#"
            CREATE TABLE fmarch_release_authority.schema_epoch_reset_completion (
                environment text NOT NULL CHECK (environment IN ('staging', 'production')),
                epoch bigint NOT NULL CHECK (epoch > 0),
                release_commit text NOT NULL CHECK (release_commit ~ '^[0-9a-f]{40}$'),
                prior_counts jsonb NOT NULL CHECK (jsonb_typeof(prior_counts) = 'object'),
                completed_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
                PRIMARY KEY (environment, epoch)
            )
            "#,
        )
        .execute(&mut *connection)
        .await?;
        sqlx::query(
            "REVOKE ALL ON TABLE fmarch_release_authority.schema_epoch_reset_completion FROM PUBLIC",
        )
        .execute(&mut *connection)
        .await?;
    }
    if !completion_store_exists(connection).await? {
        return Err("schema epoch reset completion store was not created".into());
    }
    Ok(())
}

async fn completion_store_exists(
    connection: &mut PgConnection,
) -> Result<bool, Box<dyn std::error::Error>> {
    Ok(server::verify_schema_epoch_reset_completion_authority(connection).await?)
}

async fn load_completion(
    connection: &mut PgConnection,
    environment: &str,
    epoch: i64,
) -> Result<Option<CompletionEvidence>, Box<dyn std::error::Error>> {
    let row: Option<(String, Value)> = sqlx::query_as(
        r#"
        SELECT release_commit, prior_counts
        FROM fmarch_release_authority.schema_epoch_reset_completion
        WHERE environment = $1 AND epoch = $2
        "#,
    )
    .bind(environment)
    .bind(epoch)
    .fetch_optional(&mut *connection)
    .await?;
    row.map(|(release_commit, prior_counts)| {
        validate_prior_counts(&prior_counts)?;
        Ok(CompletionEvidence {
            release_commit,
            prior_counts,
        })
    })
    .transpose()
}

async fn public_data_relations(
    connection: &mut PgConnection,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"
        SELECT relation.relname, relation.relkind::text
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind NOT IN ('i', 'I', 'S', 'v')
        ORDER BY relation.relname
        "#,
    )
    .fetch_all(&mut *connection)
    .await?;
    let mut relations = Vec::with_capacity(rows.len());
    for (name, kind) in rows {
        if !matches!(kind.as_str(), "r" | "p") {
            return Err(format!(
                "schema epoch reset encountered unclassified public relation {name} of kind {kind}"
            )
            .into());
        }
        relations.push(name);
    }
    Ok(relations)
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

async fn lock_public_data_relations(
    connection: &mut PgConnection,
) -> Result<(), Box<dyn std::error::Error>> {
    let relations = public_data_relations(connection).await?;
    if relations.is_empty() {
        return Err("schema epoch reset found no public data relations".into());
    }
    let targets = relations
        .iter()
        .map(|name| format!("public.{}", quote_identifier(name)))
        .collect::<Vec<_>>()
        .join(", ");
    let statement = format!("LOCK TABLE {targets} IN ACCESS EXCLUSIVE MODE");
    sqlx::query(&statement).execute(&mut *connection).await?;
    Ok(())
}

async fn audit_counts(connection: &mut PgConnection) -> Result<Value, Box<dyn std::error::Error>> {
    let relations = public_data_relations(connection).await?;
    let mut application_tables = Map::new();
    let mut sqlx_migrations = None;
    for relation in relations {
        let statement = format!(
            "SELECT COUNT(*) FROM public.{}",
            quote_identifier(&relation)
        );
        let count: i64 = sqlx::query_scalar(&statement)
            .fetch_one(&mut *connection)
            .await?;
        let count = u64::try_from(count)?;
        if relation == "_sqlx_migrations" {
            sqlx_migrations = Some(count);
        } else {
            application_tables.insert(relation, json!(count));
        }
    }
    let audit = json!({
        "application_tables": application_tables,
        "sqlx_migrations": sqlx_migrations.ok_or("schema epoch reset found no SQLx history table")?,
    });
    validate_prior_counts(&audit)?;
    Ok(audit)
}

fn validate_prior_counts(counts: &Value) -> Result<(), Box<dyn std::error::Error>> {
    let object = counts
        .as_object()
        .ok_or("schema epoch reset inventory is not an object")?;
    if object.len() != 2
        || object
            .get("sqlx_migrations")
            .and_then(Value::as_u64)
            .is_none()
    {
        return Err("schema epoch reset inventory has invalid shape".into());
    }
    let application_tables = object
        .get("application_tables")
        .and_then(Value::as_object)
        .filter(|tables| !tables.is_empty())
        .ok_or("schema epoch reset application inventory is empty or invalid")?;
    for (table, count) in application_tables {
        let count = count
            .as_u64()
            .ok_or("schema epoch reset application table count is invalid")?;
        if count != 0 {
            return Err(format!(
                "schema epoch reset refuses non-greenfield application table {table} with {count} rows"
            )
            .into());
        }
    }
    Ok(())
}

fn inventory_digest(value: &Value) -> String {
    format!("{:x}", Sha256::digest(value.to_string().as_bytes()))
}

fn load_expected_inventory() -> Result<Value, Box<dyn std::error::Error>> {
    let raw = env::var("FMARCH_SCHEMA_EPOCH_RESET_EXPECTED_INVENTORY")?;
    let supplied_digest = env::var("FMARCH_SCHEMA_EPOCH_RESET_EXPECTED_INVENTORY_SHA256")?;
    let actual_digest = format!("{:x}", Sha256::digest(raw.as_bytes()));
    if supplied_digest != actual_digest {
        return Err("schema epoch reset expected inventory digest is invalid".into());
    }
    let expected: Value = serde_json::from_str(&raw)?;
    validate_prior_counts(&expected)?;
    Ok(expected)
}

fn assert_completion_commit(
    completion: &CompletionEvidence,
    release_commit: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    if completion.release_commit != release_commit {
        return Err(format!(
            "schema epoch was already reset by release {}; refusing release {release_commit}",
            completion.release_commit
        )
        .into());
    }
    Ok(())
}

fn emit_audit(environment: &str, epoch: u64, release_commit: &str, execute: bool, counts: &Value) {
    println!(
        "{}",
        json!({
            "kind": "fmarch-schema-epoch-reset-audit",
            "environment": environment,
            "epoch": epoch,
            "release_commit": release_commit,
            "execute": execute,
            "inventory_sha256": inventory_digest(counts),
            "counts": counts,
        })
    );
}

fn emit_completion(environment: &str, epoch: u64, release_commit: &str, counts: &Value) {
    println!(
        "{}",
        json!({
            "kind": "fmarch-schema-epoch-reset-complete",
            "environment": environment,
            "epoch": epoch,
            "release_commit": release_commit,
            "prior_counts": counts,
        })
    );
}
