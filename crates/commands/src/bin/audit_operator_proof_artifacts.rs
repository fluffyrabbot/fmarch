use std::{env, fs, io::Write, path::PathBuf};

use commands::operator_proof::{
    build_operator_proof_run_go_no_go_report, proof_run_manifest, OperatorProofRunArtifactCounts,
    OperatorProofRunFixture, OperatorProofRunGoNoGoReport,
    PROOF_RUN_GO_NO_GO_REPORT_ARTIFACT_VERSION,
};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Args {
    game: Uuid,
    output_path: Option<PathBuf>,
    fixture: Option<OperatorProofRunFixture>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse(env::args().skip(1))?;
    let artifact_path = args
        .output_path
        .as_ref()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    if let Some(path) = &args.output_path {
        let bootstrap = bootstrap_report(artifact_path.clone());
        write_atomic(path, serde_json::to_string_pretty(&bootstrap)?.as_bytes())?;
    }
    let report = build_operator_proof_run_go_no_go_report(args.game, args.fixture, artifact_path);
    let ok = report.ok;
    let json = serde_json::to_string_pretty(&report)?;
    if let Some(path) = &args.output_path {
        write_atomic(path, json.as_bytes())?;
    }
    println!("{json}");
    if ok {
        Ok(())
    } else {
        Err("operator proof artifacts are not go".into())
    }
}

fn bootstrap_report(artifact_path: String) -> OperatorProofRunGoNoGoReport {
    OperatorProofRunGoNoGoReport {
        artifact_version: PROOF_RUN_GO_NO_GO_REPORT_ARTIFACT_VERSION,
        artifact_path,
        ok: true,
        manifest_version: proof_run_manifest().version,
        production: OperatorProofRunArtifactCounts::default(),
        fixtures: OperatorProofRunArtifactCounts::default(),
        rows: Vec::new(),
    }
}

impl Args {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut game = None;
        let mut output_path = None;
        let mut fixture = Some(OperatorProofRunFixture::ArtifactProvenance);
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "-h" | "--help" => return Err(usage()),
                "--output" if output_path.is_none() => {
                    output_path = Some(PathBuf::from(args.next().ok_or_else(usage)?));
                }
                "--output" => return Err(usage()),
                "--fixture" => {
                    fixture = Some(parse_fixture(args.next().ok_or_else(usage)?.as_str())?);
                }
                "--no-fixture" => fixture = None,
                _ if arg.starts_with("--output=") && output_path.is_none() => {
                    let value = arg
                        .strip_prefix("--output=")
                        .filter(|value| !value.is_empty())
                        .ok_or_else(usage)?;
                    output_path = Some(PathBuf::from(value));
                }
                _ if arg.starts_with("--fixture=") => {
                    let value = arg
                        .strip_prefix("--fixture=")
                        .filter(|value| !value.is_empty())
                        .ok_or_else(usage)?;
                    fixture = Some(parse_fixture(value)?);
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
            output_path,
            fixture,
        })
    }
}

fn parse_fixture(value: &str) -> Result<OperatorProofRunFixture, String> {
    match value {
        "artifact-provenance" => Ok(OperatorProofRunFixture::ArtifactProvenance),
        "malformed-artifact" => Ok(OperatorProofRunFixture::MalformedArtifact),
        _ => Err(usage()),
    }
}

fn usage() -> String {
    "usage: audit_operator_proof_artifacts [--fixture artifact-provenance|malformed-artifact|--no-fixture] [--output PATH] <game-uuid>".to_string()
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
