use std::{env, fs, io::Write, path::PathBuf};

use commands::operator_proof::{build_operator_proof_run_status, OperatorProofRunFixture};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Args {
    game: Uuid,
    fixture: Option<OperatorProofRunFixture>,
    output_path: Option<PathBuf>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse(env::args().skip(1))?;
    let status = build_operator_proof_run_status(args.game, args.fixture);
    let json = serde_json::to_string_pretty(&status)?;
    if let Some(path) = &args.output_path {
        write_atomic(path, json.as_bytes())?;
    }
    println!("{json}");
    Ok(())
}

impl Args {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut game = None;
        let mut fixture = None;
        let mut output_path = None;
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "-h" | "--help" => return Err(usage()),
                "--fixture" if fixture.is_none() => {
                    fixture = Some(parse_fixture(args.next().ok_or_else(usage)?.as_str())?);
                }
                "--fixture" => return Err(usage()),
                "--output" if output_path.is_none() => {
                    output_path = Some(PathBuf::from(args.next().ok_or_else(usage)?));
                }
                "--output" => return Err(usage()),
                _ if arg.starts_with("--fixture=") && fixture.is_none() => {
                    let value = arg
                        .strip_prefix("--fixture=")
                        .filter(|value| !value.is_empty())
                        .ok_or_else(usage)?;
                    fixture = Some(parse_fixture(value)?);
                }
                _ if arg.starts_with("--output=") && output_path.is_none() => {
                    let value = arg
                        .strip_prefix("--output=")
                        .filter(|value| !value.is_empty())
                        .ok_or_else(usage)?;
                    output_path = Some(PathBuf::from(value));
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
            fixture,
            output_path,
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
    "usage: export_operator_proof_status [--fixture artifact-provenance|malformed-artifact] [--output PATH] <game-uuid>".to_string()
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
