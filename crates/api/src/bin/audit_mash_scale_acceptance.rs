use std::{env, fs, io::Write, path::PathBuf};

use api::mash_scale::run_mash_scale_acceptance;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output_path = parse_output_path(env::args().skip(1))?;
    let database_url = env::var("DATABASE_URL")?;
    let pool = PgPoolOptions::new()
        .max_connections(48)
        .connect(&database_url)
        .await?;
    database_schema::ensure_schema_ready(&pool).await?;
    database_schema::verify_database_principal(
        &pool,
        database_schema::DatabasePrincipal::Application,
    )
    .await?;

    let artifact_path = output_path.to_string_lossy().to_string();
    let report = run_mash_scale_acceptance(&pool, artifact_path).await?;
    let ok = report.ok;
    let json = serde_json::to_vec_pretty(&report)?;
    write_atomic(&output_path, &json)?;
    println!("{}", String::from_utf8_lossy(&json));
    pool.close().await;
    if ok {
        Ok(())
    } else {
        Err("mash scale acceptance exceeded a budget or violated an invariant".into())
    }
}

fn parse_output_path<I>(args: I) -> Result<PathBuf, String>
where
    I: IntoIterator<Item = String>,
{
    let mut args = args.into_iter();
    match (args.next().as_deref(), args.next(), args.next()) {
        (Some("--output"), Some(path), None) if !path.trim().is_empty() => Ok(PathBuf::from(path)),
        _ => Err(
            "usage: audit_mash_scale_acceptance --output target/mash-scale-acceptance/report.json"
                .to_string(),
        ),
    }
}

fn write_atomic(path: &PathBuf, bytes: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(tmp, path)?;
    Ok(())
}
