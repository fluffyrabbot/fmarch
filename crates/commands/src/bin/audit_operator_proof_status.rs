use std::{env, fs, path::PathBuf};

use commands::operator_proof::audit_operator_proof_status_values;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Args {
    expected_path: PathBuf,
    actual_path: PathBuf,
    output_path: Option<PathBuf>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse(env::args().skip(1))?;
    let expected = read_json(&args.expected_path)?;
    let actual = read_json(&args.actual_path)?;
    let mut report = audit_operator_proof_status_values(
        args.expected_path.to_string_lossy().to_string(),
        expected,
        args.actual_path.to_string_lossy().to_string(),
        actual,
    );
    let ok = report.ok;
    if let Some(output_path) = &args.output_path {
        report.artifact_path = output_path.to_string_lossy().to_string();
    }
    let report_json = serde_json::to_string_pretty(&report)?;
    if let Some(output_path) = &args.output_path {
        write_report(output_path, &report_json)?;
    }
    println!("{report_json}");
    if ok {
        Ok(())
    } else {
        Err("operator proof-run status drifted".into())
    }
}

impl Args {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut expected_path = None;
        let mut actual_path = None;
        let mut output_path = None;
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "-h" | "--help" => return Err(usage()),
                "--output" => {
                    let value = args.next().ok_or_else(usage)?;
                    output_path = Some(PathBuf::from(value));
                }
                _ if arg.starts_with('-') => return Err(usage()),
                _ if expected_path.is_none() => expected_path = Some(PathBuf::from(arg)),
                _ if actual_path.is_none() => actual_path = Some(PathBuf::from(arg)),
                _ => return Err(usage()),
            }
        }
        Ok(Args {
            expected_path: expected_path.ok_or_else(usage)?,
            actual_path: actual_path.ok_or_else(usage)?,
            output_path,
        })
    }
}

fn read_json(path: &PathBuf) -> Result<Value, Box<dyn std::error::Error>> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn write_report(path: &PathBuf, report_json: &str) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, report_json)?;
    Ok(())
}

fn usage() -> String {
    "usage: audit_operator_proof_status [--output audit-report.json] <expected-status.json> <actual-status.json>"
        .to_string()
}
