use sqlx::postgres::PgPool;
use std::collections::{BTreeMap, BTreeSet};

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchemaReadiness {
    Ready,
    Pending { reason: String },
}

/// Inspect whether this binary's exact schema is present without treating a
/// concurrently running migrator as corruption. Missing migration state is a
/// retryable deployment dependency; failed, changed, or unknown migrations are
/// terminal because waiting cannot make that binary/database pair compatible.
pub async fn inspect_schema_readiness(pool: &PgPool) -> Result<SchemaReadiness, sqlx::Error> {
    let migrations_table = sqlx::query_scalar::<_, Option<String>>(
        "SELECT to_regclass('public._sqlx_migrations')::TEXT",
    )
    .fetch_one(pool)
    .await?;
    if migrations_table.is_none() {
        return Ok(SchemaReadiness::Pending {
            reason: "migration catalog is missing".to_string(),
        });
    }

    let expected_versions = MIGRATOR
        .migrations
        .iter()
        .map(|migration| migration.version)
        .collect::<Vec<_>>();
    let applied = sqlx::query_as::<_, (i64, Vec<u8>, bool)>(
        "SELECT version, checksum, success FROM public._sqlx_migrations",
    )
    .fetch_all(pool)
    .await?;
    let applied = applied
        .into_iter()
        .map(|(version, checksum, success)| (version, (checksum, success)))
        .collect::<BTreeMap<_, _>>();
    for migration in MIGRATOR.migrations.iter() {
        let Some((checksum, success)) = applied.get(&migration.version) else {
            return Ok(SchemaReadiness::Pending {
                reason: format!("migration {} is missing", migration.version),
            });
        };
        if !success || checksum.as_slice() != migration.checksum.as_ref() {
            return Err(sqlx::Error::Protocol(format!(
                "database schema is not ready: migration {} failed or its checksum differs",
                migration.version
            )));
        }
    }
    let expected_versions = expected_versions.into_iter().collect::<BTreeSet<_>>();
    if let Some(version) = applied
        .keys()
        .find(|version| !expected_versions.contains(version))
    {
        return Err(sqlx::Error::Protocol(format!(
            "database schema is newer than this binary: migration {version} is unknown"
        )));
    }
    Ok(SchemaReadiness::Ready)
}

/// Fail closed unless the dedicated migrator has applied this database
/// schema's complete migration set. This probe is read-only.
pub async fn ensure_schema_ready(pool: &PgPool) -> Result<(), sqlx::Error> {
    match inspect_schema_readiness(pool).await? {
        SchemaReadiness::Ready => Ok(()),
        SchemaReadiness::Pending { reason } => Err(sqlx::Error::Protocol(format!(
            "database schema is not ready: {reason}"
        ))),
    }
}
