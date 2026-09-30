use super::*;
use std::time::Duration;
use tokio::{sync::Barrier, task::JoinSet};

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn concurrent_first_pack_installers_preserve_exact_custody(
    pool_options: PgPoolOptions,
    connect_options: PgConnectOptions,
) {
    const INSTALLERS: usize = 8;
    let pool = pool_options
        .max_connections(8)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(connect_options)
        .await
        .unwrap();

    // Each round starts without this identity. Synchronize before insertion so
    // both the hash primary key and composite identity key face first writers.
    for round in 0..8 {
        let artifact = Arc::new(test_pack_artifact(&format!("concurrent_pack_{round}")));
        let start = Arc::new(Barrier::new(INSTALLERS));
        let mut installers = JoinSet::new();
        for _ in 0..INSTALLERS {
            let pool = pool.clone();
            let artifact = Arc::clone(&artifact);
            let start = Arc::clone(&start);
            installers.spawn(async move {
                let mut tx = pool.begin().await?;
                start.wait().await;
                projections::install_pack_artifact_in_tx(&mut tx, &artifact).await?;
                // Commit immediately: losing inserts must be able to observe
                // the winning custody row before validating its exact bytes.
                tx.commit().await?;
                Ok::<(), ProjectionError>(())
            });
        }
        tokio::time::timeout(Duration::from_secs(10), async {
            while let Some(result) = installers.join_next().await {
                result
                    .expect("pack installer task must finish")
                    .unwrap_or_else(|error| panic!("pack installer round {round}: {error}"));
            }
        })
        .await
        .unwrap_or_else(|_| panic!("pack installer round {round} timed out"));

        let rows = sqlx::query_as::<_, (String, i64, i16, String)>(
            "SELECT pack_key, pack_version, artifact_schema_version, canonical_json \
             FROM pack_artifact WHERE content_hash = $1",
        )
        .bind(artifact.pack_ref.content_hash.as_str())
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            rows,
            vec![(
                artifact.pack_ref.key.clone(),
                i64::from(artifact.pack_ref.version),
                i16::try_from(artifact.schema_version).unwrap(),
                artifact.canonical_json.clone(),
            )],
            "all installers must share one exact immutable custody row"
        );
    }
    pool.close().await;
}
