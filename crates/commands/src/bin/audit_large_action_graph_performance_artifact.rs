use std::{env, fs, io::Write, path::PathBuf, time::Duration};

use commands::{
    operator_proof::build_operator_large_action_graph_performance_report,
    run_large_action_graph_performance_proof, LARGE_ACTION_GRAPH_PERFORMANCE_SEED,
    LARGE_ACTION_GRAPH_PERFORMANCE_THRESHOLD_MS,
};
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Args {
    output_path: Option<PathBuf>,
    seed: u64,
    threshold_ms: u64,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse(env::args().skip(1))?;
    let artifact_path = args
        .output_path
        .as_ref()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let database_url = env::var("DATABASE_URL")?;
    // SubmitAction/ResolvePhase now keep their transaction-scoped lock, reads,
    // append, projections, and commit on one connection. Retain normal proof
    // headroom for harness queries and future parallel checks.
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;
    sqlx::migrate!("../projections/migrations")
        .run(&pool)
        .await?;

    let proof = run_large_action_graph_performance_proof(
        &pool,
        Uuid::new_v4(),
        args.seed,
        Duration::from_millis(args.threshold_ms),
    )
    .await?;
    let report = build_operator_large_action_graph_performance_report(artifact_path, proof);
    let ok = report.ok;
    let json = serde_json::to_string_pretty(&report)?;
    if let Some(path) = &args.output_path {
        write_atomic(path, json.as_bytes())?;
    }
    println!("{json}");
    if ok {
        Ok(())
    } else {
        Err("large action graph performance artifact failed its ceiling or audits".into())
    }
}

impl Args {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut output_path = None;
        let mut seed = LARGE_ACTION_GRAPH_PERFORMANCE_SEED;
        let mut threshold_ms = LARGE_ACTION_GRAPH_PERFORMANCE_THRESHOLD_MS;
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "-h" | "--help" => return Err(usage()),
                "--output" if output_path.is_none() => {
                    output_path = Some(PathBuf::from(args.next().ok_or_else(usage)?));
                }
                "--output" => return Err(usage()),
                "--seed" => {
                    seed = args
                        .next()
                        .ok_or_else(usage)?
                        .parse()
                        .map_err(|_| usage())?;
                }
                "--threshold-ms" => {
                    threshold_ms = args
                        .next()
                        .ok_or_else(usage)?
                        .parse()
                        .map_err(|_| usage())?;
                }
                _ if arg.starts_with("--output=") && output_path.is_none() => {
                    let value = arg
                        .strip_prefix("--output=")
                        .filter(|value| !value.is_empty())
                        .ok_or_else(usage)?;
                    output_path = Some(PathBuf::from(value));
                }
                _ if arg.starts_with("--seed=") => {
                    seed = arg
                        .strip_prefix("--seed=")
                        .filter(|value| !value.is_empty())
                        .ok_or_else(usage)?
                        .parse()
                        .map_err(|_| usage())?;
                }
                _ if arg.starts_with("--threshold-ms=") => {
                    threshold_ms = arg
                        .strip_prefix("--threshold-ms=")
                        .filter(|value| !value.is_empty())
                        .ok_or_else(usage)?
                        .parse()
                        .map_err(|_| usage())?;
                }
                _ => return Err(usage()),
            }
        }
        Ok(Args {
            output_path,
            seed,
            threshold_ms,
        })
    }
}

fn usage() -> String {
    "usage: audit_large_action_graph_performance_artifact [--output report.json] [--seed n] [--threshold-ms n]"
        .to_string()
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
