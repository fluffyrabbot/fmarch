use std::{env, fs, io::Write, path::PathBuf};

use commands::{inspect_resolution_traces, operator_proof::build_operator_trace_inspection_report};
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Args {
    game: Uuid,
    run_id: Option<String>,
    output_path: Option<PathBuf>,
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
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await?;
    sqlx::migrate!("../projections/migrations")
        .run(&pool)
        .await?;

    let inspection = inspect_resolution_traces(&pool, args.game, args.run_id.as_deref()).await?;
    let report = build_operator_trace_inspection_report(artifact_path, inspection);
    let ok = report.ok;
    let json = serde_json::to_string_pretty(&report)?;
    if let Some(path) = &args.output_path {
        write_atomic(path, json.as_bytes())?;
    }
    println!("{json}");
    if ok {
        Ok(())
    } else {
        Err("trace inspection artifact found no stored traces".into())
    }
}

impl Args {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut game = None;
        let mut run_id = None;
        let mut output_path = None;
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "-h" | "--help" => return Err(usage()),
                "--output" if output_path.is_none() => {
                    output_path = Some(PathBuf::from(args.next().ok_or_else(usage)?));
                }
                "--output" => return Err(usage()),
                "--run-id" if run_id.is_none() => {
                    run_id = Some(args.next().ok_or_else(usage)?);
                }
                "--run-id" => return Err(usage()),
                _ if arg.starts_with("--output=") && output_path.is_none() => {
                    let value = arg
                        .strip_prefix("--output=")
                        .filter(|value| !value.is_empty())
                        .ok_or_else(usage)?;
                    output_path = Some(PathBuf::from(value));
                }
                _ if arg.starts_with("--run-id=") && run_id.is_none() => {
                    let value = arg
                        .strip_prefix("--run-id=")
                        .filter(|value| !value.is_empty())
                        .ok_or_else(usage)?;
                    run_id = Some(value.to_string());
                }
                _ if arg.starts_with('-') => return Err(usage()),
                _ if game.is_none() => {
                    game = Some(
                        Uuid::parse_str(&arg)
                            .map_err(|err| format!("invalid game UUID {arg}: {err}"))?,
                    );
                }
                _ => return Err(usage()),
            }
        }
        Ok(Args {
            game: game.ok_or_else(usage)?,
            run_id,
            output_path,
        })
    }
}

fn usage() -> String {
    "usage: audit_trace_inspection_artifact [--output trace-report.json] [--run-id run] <game-uuid>"
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
