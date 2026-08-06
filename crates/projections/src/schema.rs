use sqlx::postgres::PgPool;
use std::collections::BTreeMap;

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// Fail closed unless the dedicated migrator has applied this projection
/// schema's complete migration set. This probe is read-only.
pub async fn ensure_schema_ready(pool: &PgPool) -> Result<(), sqlx::Error> {
    let expected_versions = MIGRATOR
        .migrations
        .iter()
        .map(|migration| migration.version)
        .collect::<Vec<_>>();
    let applied = sqlx::query_as::<_, (i64, Vec<u8>, bool)>(
        "SELECT version, checksum, success FROM _sqlx_migrations WHERE version = ANY($1)",
    )
    .bind(&expected_versions)
    .fetch_all(pool)
    .await?;
    let applied = applied
        .into_iter()
        .map(|(version, checksum, success)| (version, (checksum, success)))
        .collect::<BTreeMap<_, _>>();
    for migration in MIGRATOR.migrations.iter() {
        let Some((checksum, success)) = applied.get(&migration.version) else {
            return Err(sqlx::Error::Protocol(format!(
                "database schema is not ready: migration {} is missing",
                migration.version
            )));
        };
        if !success || checksum.as_slice() != migration.checksum.as_ref() {
            return Err(sqlx::Error::Protocol(format!(
                "database schema is not ready: migration {} failed or its checksum differs",
                migration.version
            )));
        }
    }
    Ok(())
}
