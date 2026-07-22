use std::{
    env,
    ffi::OsString,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use caps::Principal;
use commands::{
    audit_resolution_envelopes, handle, load_engine_phase_input,
    operator_proof::{
        build_operator_command_projection_resolution_report,
        build_operator_projection_rebuild_audit_report, build_operator_resolution_diff_report,
    },
    Command,
};
use projections::audit_rebuild;
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

const DEFAULT_FIXTURE_PATH: &str = "crates/commands/fixtures/night-passing.json";
const DEFAULT_OUTPUT_PATH: &str =
    "target/operator-proof/current-command-projection-resolution-report.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct NightFixture {
    seed: u64,
    #[serde(default = "default_pack")]
    pack: String,
    #[serde(default = "default_phase")]
    phase: String,
    roster: Vec<FixtureSlot>,
    actions: Vec<FixtureAction>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct FixtureSlot {
    slot: String,
    role: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct FixtureAction {
    actor_slot: String,
    template_id: String,
    action_id: String,
    targets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Args {
    fixture_path: PathBuf,
    output_path: PathBuf,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse(env::args().skip(1))?;
    let fixture = read_fixture(&args.fixture_path)?;
    let artifact_path = args.output_path.to_string_lossy().to_string();
    let fixture_path = args.fixture_path.to_string_lossy().to_string();
    let database_url = env::var("DATABASE_URL")?;
    let pool = PgPoolOptions::new()
        // Command boundary locks intentionally hold connections while command
        // bodies read, append, project, and audit through the pool. Match the
        // small real-stack pool shape so this proof exercises serialization
        // instead of deadlocking its own single-connection harness.
        .max_connections(5)
        .connect(&database_url)
        .await?;
    sqlx::migrate!("../projections/migrations")
        .run(&pool)
        .await?;

    let game = seed_and_resolve_fixture_game(&pool, &fixture).await?;
    let projection_rebuild = build_operator_projection_rebuild_audit_report(
        artifact_path.clone(),
        audit_rebuild(&pool, game).await?,
    );
    let resolution_diff = build_operator_resolution_diff_report(
        artifact_path.clone(),
        audit_resolution_envelopes(&pool, game).await?,
    );
    let report = build_operator_command_projection_resolution_report(
        artifact_path.clone(),
        fixture_path,
        fixture.pack,
        fixture.phase,
        fixture.seed,
        projection_rebuild,
        resolution_diff,
    );
    let ok = report.ok;
    let json = serde_json::to_string_pretty(&report)?;
    write_report_atomic(&args.output_path, json.as_bytes())?;
    println!("{json}");
    if ok {
        Ok(())
    } else {
        Err("command/projection resolution proof found drift".into())
    }
}

impl Args {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut fixture_path = None;
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
                _ if fixture_path.is_none() => fixture_path = Some(PathBuf::from(arg)),
                _ => return Err(usage()),
            }
        }
        Ok(Args {
            fixture_path: fixture_path.unwrap_or_else(|| PathBuf::from(DEFAULT_FIXTURE_PATH)),
            output_path: output_path.unwrap_or_else(|| PathBuf::from(DEFAULT_OUTPUT_PATH)),
        })
    }
}

fn usage() -> String {
    "usage: prove_command_projection_resolution [--output report.json] [fixture.json]".to_string()
}

fn default_pack() -> String {
    "mafiascum".to_string()
}

fn default_phase() -> String {
    "N01".to_string()
}

fn read_fixture(path: &Path) -> Result<NightFixture, Box<dyn std::error::Error>> {
    let text = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&text)?)
}

async fn seed_and_resolve_fixture_game(
    pool: &PgPool,
    fixture: &NightFixture,
) -> Result<Uuid, Box<dyn std::error::Error>> {
    let game = Uuid::new_v4();
    let host = Principal::user("fixture_host");
    handle(
        pool,
        &host,
        Command::CreateGame {
            game,
            pack: fixture.pack.clone(),
            cohost_denied: vec![],
        },
    )
    .await?;

    for slot in &fixture.roster {
        handle(
            pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot.slot.clone(),
            },
        )
        .await?;
        handle(
            pool,
            &host,
            Command::AssignSlot {
                game,
                slot: slot.slot.clone(),
                user: format!("fixture_user_{}", slot_number(&slot.slot).unwrap_or(0)),
            },
        )
        .await?;
        handle(
            pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot.slot.clone(),
                role_key: slot.role.clone(),
            },
        )
        .await?;
    }

    handle(
        pool,
        &host,
        Command::StartGame {
            game,
            phase: fixture.phase.clone(),
        },
    )
    .await?;

    for action in &fixture.actions {
        handle(
            pool,
            &Principal::user(format!(
                "fixture_user_{}",
                slot_number(&action.actor_slot).unwrap_or(0)
            )),
            Command::SubmitAction {
                game,
                action_id: action.action_id.clone(),
                actor_slot: action.actor_slot.clone(),
                template_id: action.template_id.clone(),
                targets: action.targets.clone(),
                grant_id: None,
            },
        )
        .await?;
    }

    let phase_input = load_engine_phase_input(pool, game, &fixture.phase).await?;
    if phase_input.pack_name != fixture.pack {
        return Err(format!(
            "engine input builder loaded pack `{}` for fixture pack `{}`",
            phase_input.pack_name, fixture.pack
        )
        .into());
    }
    if phase_input.submissions.len() != fixture.actions.len() {
        return Err(format!(
            "engine input builder loaded {} submissions for {} fixture actions",
            phase_input.submissions.len(),
            fixture.actions.len()
        )
        .into());
    }

    handle(
        pool,
        &host,
        Command::ResolvePhase {
            game,
            seed: fixture.seed,
        },
    )
    .await?;
    Ok(game)
}

fn write_report_atomic(path: &Path, bytes: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let tmp = temporary_path_for(path);
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

fn temporary_path_for(path: &Path) -> PathBuf {
    let mut file_name = path
        .file_name()
        .map(OsString::from)
        .unwrap_or_else(|| OsString::from("command-projection-resolution-report"));
    file_name.push(".tmp");
    path.with_file_name(file_name)
}

fn slot_number(slot: &str) -> Option<usize> {
    slot.strip_prefix("slot_")
        .and_then(|number| number.parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_default_to_checked_fixture_and_operator_proof_report() {
        let args = Args::parse(Vec::<String>::new()).expect("parse defaults");
        assert_eq!(args.fixture_path, PathBuf::from(DEFAULT_FIXTURE_PATH));
        assert_eq!(args.output_path, PathBuf::from(DEFAULT_OUTPUT_PATH));
    }

    #[test]
    fn args_parse_output_and_fixture_path() {
        let args = Args::parse([
            "--output=target/operator-proof/custom.json".to_string(),
            "crates/commands/fixtures/night-passing.json".to_string(),
        ])
        .expect("parse args");
        assert_eq!(
            args.output_path,
            PathBuf::from("target/operator-proof/custom.json")
        );
        assert_eq!(
            args.fixture_path,
            PathBuf::from("crates/commands/fixtures/night-passing.json")
        );
    }
}
