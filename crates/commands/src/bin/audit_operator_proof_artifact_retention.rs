use std::{env, fs, path::PathBuf};

use commands::operator_proof::{
    audit_operator_proof_run_go_no_go_retention, OperatorProofRunGoNoGoReport,
};

#[derive(Debug, Clone, PartialEq, Eq)]
struct Args {
    previous_path: PathBuf,
    latest_path: PathBuf,
    output_path: Option<PathBuf>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse(env::args().skip(1))?;
    let previous = read_report(&args.previous_path)?;
    let latest = read_report(&args.latest_path)?;
    let artifact_path = args
        .output_path
        .as_ref()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let report = audit_operator_proof_run_go_no_go_retention(
        args.previous_path.to_string_lossy().to_string(),
        previous,
        args.latest_path.to_string_lossy().to_string(),
        latest,
        artifact_path,
    );
    let ok = report.ok;
    let json = serde_json::to_string_pretty(&report)?;
    if let Some(path) = &args.output_path {
        write_report(path, &json)?;
    }
    println!("{json}");
    if ok {
        Ok(())
    } else {
        Err("operator proof artifact retention regressed".into())
    }
}

impl Args {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut previous_path = None;
        let mut latest_path = None;
        let mut output_path = None;
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "-h" | "--help" => return Err(usage()),
                "--output" if output_path.is_none() => {
                    output_path = Some(PathBuf::from(args.next().ok_or_else(usage)?));
                }
                "--output" => return Err(usage()),
                _ if arg.starts_with("--output=") && output_path.is_none() => {
                    let value = arg
                        .strip_prefix("--output=")
                        .filter(|value| !value.is_empty())
                        .ok_or_else(usage)?;
                    output_path = Some(PathBuf::from(value));
                }
                _ if arg.starts_with('-') => return Err(usage()),
                _ if previous_path.is_none() => previous_path = Some(PathBuf::from(arg)),
                _ if latest_path.is_none() => latest_path = Some(PathBuf::from(arg)),
                _ => return Err(usage()),
            }
        }
        Ok(Args {
            previous_path: previous_path.ok_or_else(usage)?,
            latest_path: latest_path.ok_or_else(usage)?,
            output_path,
        })
    }
}

fn read_report(path: &PathBuf) -> Result<OperatorProofRunGoNoGoReport, Box<dyn std::error::Error>> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn write_report(path: &PathBuf, json: &str) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, json)?;
    Ok(())
}

fn usage() -> String {
    "usage: audit_operator_proof_artifact_retention [--output retention-report.json] <previous-go-no-go.json> <latest-go-no-go.json>".to_string()
}
