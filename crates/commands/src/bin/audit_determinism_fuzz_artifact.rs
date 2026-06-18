use std::{env, fs, io::Write, path::PathBuf, process::Command as ProcessCommand, time::Instant};

use commands::operator_proof::build_operator_determinism_fuzz_report;

const DEFAULT_TEST_FILTER: &str = "replay_audit_and_rebuild_deterministically";

#[derive(Debug, Clone, PartialEq, Eq)]
struct Args {
    output_path: Option<PathBuf>,
    test_filter: String,
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
    let command_text = format!(
        "DATABASE_URL={} cargo test -p commands --test pipeline {} -- --nocapture",
        database_url, args.test_filter
    );
    let started = Instant::now();
    let output = ProcessCommand::new("cargo")
        .env("DATABASE_URL", database_url)
        .args([
            "test",
            "-p",
            "commands",
            "--test",
            "pipeline",
            args.test_filter.as_str(),
            "--",
            "--nocapture",
        ])
        .output()?;
    let elapsed_ms = started.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}\n{stderr}");
    let report = build_operator_determinism_fuzz_report(
        artifact_path,
        command_text,
        args.test_filter,
        elapsed_ms,
        output.status.success(),
        &combined,
    );
    let ok = report.ok;
    let json = serde_json::to_string_pretty(&report)?;
    if let Some(path) = &args.output_path {
        write_atomic(path, json.as_bytes())?;
    }
    println!("{json}");
    if ok {
        Ok(())
    } else {
        Err("determinism fuzz artifact found failed or missing seeded families".into())
    }
}

impl Args {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut output_path = None;
        let mut test_filter = DEFAULT_TEST_FILTER.to_string();
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "-h" | "--help" => return Err(usage()),
                "--output" if output_path.is_none() => {
                    output_path = Some(PathBuf::from(args.next().ok_or_else(usage)?));
                }
                "--output" => return Err(usage()),
                "--test-filter" => {
                    test_filter = args.next().ok_or_else(usage)?;
                }
                _ if arg.starts_with("--output=") && output_path.is_none() => {
                    let value = arg
                        .strip_prefix("--output=")
                        .filter(|value| !value.is_empty())
                        .ok_or_else(usage)?;
                    output_path = Some(PathBuf::from(value));
                }
                _ if arg.starts_with("--test-filter=") => {
                    test_filter = arg
                        .strip_prefix("--test-filter=")
                        .filter(|value| !value.is_empty())
                        .ok_or_else(usage)?
                        .to_string();
                }
                _ => return Err(usage()),
            }
        }
        Ok(Args {
            output_path,
            test_filter,
        })
    }
}

fn usage() -> String {
    "usage: audit_determinism_fuzz_artifact [--output report.json] [--test-filter filter]"
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
