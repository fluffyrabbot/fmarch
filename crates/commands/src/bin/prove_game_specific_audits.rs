use std::{
    env,
    ffi::OsString,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command as ProcessCommand,
};

use caps::Principal;
use commands::{handle, Command};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

const PROOF_RUN_MANIFEST_JSON: &str = include_str!("../../../../docs/ops/proof-runs.json");

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

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProofRunManifest {
    version: u16,
    #[allow(dead_code)]
    artifact_freshness_max_age_seconds: u64,
    #[allow(dead_code)]
    database_url_example: String,
    families: Vec<ProofRunFamily>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProofRunFamily {
    #[allow(dead_code)]
    heading: String,
    runs: Vec<ProofRunSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProofRunSpec {
    id: String,
    family: String,
    scope: String,
    command_template: String,
    #[allow(dead_code)]
    #[serde(default)]
    test_selector: Option<String>,
    #[allow(dead_code)]
    #[serde(default)]
    artifact_path: Option<String>,
    #[allow(dead_code)]
    #[serde(default)]
    artifact_kind: Option<String>,
    #[allow(dead_code)]
    #[serde(default)]
    audit_expected_path: Option<String>,
    #[allow(dead_code)]
    #[serde(default)]
    audit_actual_path: Option<String>,
    #[allow(dead_code)]
    proof_boundary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExpandedRun {
    id: String,
    family: String,
    command: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Args {
    fixture_path: String,
    output_path: Option<PathBuf>,
    compare_with: Option<PathBuf>,
}

const NORMALIZED_REPORT_FIELDS: &[&str] = &[
    "game_id",
    "artifact_path",
    "command_game_uuid",
    "run_id",
    "applied_stream_seq",
    "trace_stream_seq",
];

#[derive(Debug, Serialize)]
struct OperatorProofReport {
    ok: bool,
    manifest_version: u16,
    game_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    artifact_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retention_comparison: Option<RetentionComparison>,
    fixture: NightFixture,
    runs: Vec<RunReport>,
}

#[derive(Debug, Serialize)]
struct RetentionComparison {
    compared_with: String,
    normalized_match: bool,
    normalized_fields: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
struct RunReport {
    id: String,
    family: String,
    command: String,
    ok: bool,
    summary: Value,
}

fn default_pack() -> String {
    "mafiascum".to_string()
}

fn default_phase() -> String {
    "N01".to_string()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse(env::args().skip(1))?;
    let fixture = read_fixture(&args.fixture_path)?;
    let database_url = env::var("DATABASE_URL")?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await?;
    sqlx::migrate!("../projections/migrations")
        .run(&pool)
        .await?;

    let game = seed_fixture_game(&pool, &fixture).await?;
    let manifest = proof_run_manifest()?;
    let runs = expand_game_specific_runs(&manifest, &database_url, game)?;
    let mut reports = Vec::new();
    for run in runs {
        let output = run_shell_command(&run.command)?;
        let summary = parse_json_stdout(&output.stdout)?;
        validate_run_output(&run.id, game, &summary)?;
        reports.push(RunReport {
            id: run.id,
            family: run.family,
            command: run.command,
            ok: true,
            summary,
        });
    }

    let report = OperatorProofReport {
        ok: true,
        manifest_version: manifest.version,
        game_id: game,
        artifact_path: args
            .output_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        retention_comparison: None,
        fixture,
        runs: reports,
    };
    let mut report_value = serde_json::to_value(&report)?;
    if let Some(previous_path) = &args.compare_with {
        compare_reports(previous_path, &report_value)?;
        report_value["retention_comparison"] = serde_json::to_value(RetentionComparison {
            compared_with: previous_path.to_string_lossy().to_string(),
            normalized_match: true,
            normalized_fields: NORMALIZED_REPORT_FIELDS.to_vec(),
        })?;
    }
    let json = serde_json::to_string_pretty(&report_value)?;
    if let Some(path) = &args.output_path {
        write_report_atomic(path, json.as_bytes())?;
    }
    println!("{json}");
    Ok(())
}

impl Args {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut fixture_path = None;
        let mut output_path = None;
        let mut compare_with = None;
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "-h" | "--help" => return Err(usage()),
                "--output" if output_path.is_none() => {
                    let path = args.next().ok_or_else(usage)?;
                    output_path = Some(PathBuf::from(path));
                }
                "--output" => return Err(usage()),
                "--compare-with" if compare_with.is_none() => {
                    let path = args.next().ok_or_else(usage)?;
                    compare_with = Some(PathBuf::from(path));
                }
                "--compare-with" => return Err(usage()),
                _ if arg.starts_with("--output=") && output_path.is_none() => {
                    let path = arg
                        .strip_prefix("--output=")
                        .filter(|path| !path.is_empty())
                        .ok_or_else(usage)?;
                    output_path = Some(PathBuf::from(path));
                }
                _ if arg.starts_with("--compare-with=") && compare_with.is_none() => {
                    let path = arg
                        .strip_prefix("--compare-with=")
                        .filter(|path| !path.is_empty())
                        .ok_or_else(usage)?;
                    compare_with = Some(PathBuf::from(path));
                }
                _ if arg.starts_with('-') => return Err(usage()),
                _ if fixture_path.is_none() => fixture_path = Some(arg),
                _ => return Err(usage()),
            }
        }
        Ok(Args {
            fixture_path: fixture_path.ok_or_else(usage)?,
            output_path,
            compare_with,
        })
    }
}

fn usage() -> String {
    "usage: prove_game_specific_audits [--output <report.json>] [--compare-with <report.json>] <fixture.json>".to_string()
}

fn read_fixture(path: &str) -> Result<NightFixture, Box<dyn std::error::Error>> {
    let text = fs::read_to_string(Path::new(path))?;
    Ok(serde_json::from_str(&text)?)
}

async fn seed_fixture_game(
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

fn proof_run_manifest() -> Result<ProofRunManifest, serde_json::Error> {
    serde_json::from_str(PROOF_RUN_MANIFEST_JSON)
}

fn expand_game_specific_runs(
    manifest: &ProofRunManifest,
    database_url: &str,
    game: Uuid,
) -> Result<Vec<ExpandedRun>, String> {
    let runs: Vec<_> = manifest
        .families
        .iter()
        .flat_map(|family| &family.runs)
        .filter(|run| run.scope == "Game-specific")
        .map(|run| ExpandedRun {
            id: run.id.clone(),
            family: run.family.clone(),
            command: render_command(&run.command_template, database_url, game),
        })
        .collect();
    if runs.len() == 3 {
        Ok(runs)
    } else {
        Err(format!(
            "expected exactly 3 game-specific manifest runs, found {}",
            runs.len()
        ))
    }
}

fn render_command(template: &str, database_url: &str, game: Uuid) -> String {
    template
        .replace("{database_url}", database_url)
        .replace("{game}", &game.to_string())
}

fn run_shell_command(command: &str) -> Result<std::process::Output, Box<dyn std::error::Error>> {
    let output = ProcessCommand::new("sh").arg("-c").arg(command).output()?;
    if output.status.success() {
        Ok(output)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("command failed: {command}\n{stderr}").into())
    }
}

fn parse_json_stdout(stdout: &[u8]) -> Result<Value, Box<dyn std::error::Error>> {
    let text = std::str::from_utf8(stdout)?;
    let start = text
        .find('{')
        .ok_or_else(|| "command stdout did not contain a JSON object".to_string())?;
    Ok(serde_json::from_str(&text[start..])?)
}

fn compare_reports(
    previous_path: &Path,
    current: &Value,
) -> Result<(), Box<dyn std::error::Error>> {
    let previous_text = fs::read_to_string(previous_path)?;
    let previous: Value = serde_json::from_str(&previous_text)?;
    let previous_normalized = normalize_report(previous)?;
    let current_normalized = normalize_report(current.clone())?;
    if previous_normalized == current_normalized {
        Ok(())
    } else {
        Err("normalized proof artifact comparison failed".into())
    }
}

fn normalize_report(mut value: Value) -> Result<Value, Box<dyn std::error::Error>> {
    let game_id = value
        .get("game_id")
        .and_then(Value::as_str)
        .ok_or("proof report missing game_id")?
        .to_string();
    let artifact_path = value
        .get("artifact_path")
        .and_then(Value::as_str)
        .map(str::to_string);
    normalize_value(&mut value, None, &game_id, artifact_path.as_deref());
    Ok(value)
}

fn normalize_value(
    value: &mut Value,
    key: Option<&str>,
    game_id: &str,
    artifact_path: Option<&str>,
) {
    match value {
        Value::Object(map) => {
            map.remove("retention_comparison");
            for (child_key, child_value) in map.iter_mut() {
                normalize_value(child_value, Some(child_key), game_id, artifact_path);
            }
        }
        Value::Array(items) => {
            for item in items {
                normalize_value(item, key, game_id, artifact_path);
            }
        }
        Value::String(text) => {
            if matches!(key, Some("game_id")) {
                *text = "<game_id>".to_string();
            } else if matches!(key, Some("artifact_path")) {
                *text = "<artifact_path>".to_string();
            } else if matches!(key, Some("run_id")) {
                *text = "<run_id>".to_string();
            } else {
                *text = text.replace(game_id, "<game_id>");
                if let Some(artifact_path) = artifact_path {
                    *text = text.replace(artifact_path, "<artifact_path>");
                }
            }
        }
        Value::Number(_) if matches!(key, Some("applied_stream_seq" | "trace_stream_seq")) => {
            *value = Value::String("<stream_seq>".to_string());
        }
        _ => {}
    }
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
        .unwrap_or_else(|| OsString::from("proof-report"));
    file_name.push(".tmp");
    path.with_file_name(file_name)
}

fn validate_run_output(id: &str, game: Uuid, value: &Value) -> Result<(), String> {
    expect_string(value, "/game_id", &game.to_string())?;
    match id {
        "projection-rebuild-audit" => {
            expect_bool(value, "/ok", true)?;
            let tables = value
                .pointer("/tables")
                .and_then(Value::as_array)
                .ok_or_else(|| "projection audit missing tables[]".to_string())?;
            if tables.len() != 13 {
                return Err(format!(
                    "projection audit expected 13 rebuildable tables, got {}",
                    tables.len()
                ));
            }
            for table in tables {
                expect_bool(table, "/matches", true)?;
            }
        }
        "resolution-replay-audit" => {
            expect_bool(value, "/ok", true)?;
            expect_u64(value, "/audited", 1)?;
            expect_u64(value, "/skipped", 0)?;
            expect_u64(value, "/summary/matched", 1)?;
            expect_u64(value, "/summary/drifted", 0)?;
            expect_u64(value, "/summary/skipped", 0)?;
            expect_string(value, "/phases/0/phase_id", "N01")?;
            expect_string(value, "/phases/0/status", "matched")?;
        }
        "resolution-trace-inspection" => {
            let traces = value
                .pointer("/traces")
                .and_then(Value::as_array)
                .ok_or_else(|| "trace inspection missing traces[]".to_string())?;
            if traces.len() != 1 {
                return Err(format!(
                    "trace inspection expected 1 trace, got {}",
                    traces.len()
                ));
            }
            expect_string(&traces[0], "/phase_id", "N01")?;
            let decisions = traces[0]
                .pointer("/decisions")
                .and_then(Value::as_array)
                .ok_or_else(|| "trace inspection missing decisions[]".to_string())?;
            if decisions.len() != 4 {
                return Err(format!(
                    "trace inspection expected 4 decisions, got {}",
                    decisions.len()
                ));
            }
            expect_string(&decisions[0], "/stage", "result_contract")?;
            expect_string(&decisions[1], "/outcome", "kill_prevented_by_protection")?;
        }
        other => return Err(format!("unexpected game-specific proof run id {other}")),
    }
    Ok(())
}

fn expect_bool(value: &Value, pointer: &str, expected: bool) -> Result<(), String> {
    let actual = value
        .pointer(pointer)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("missing bool at {pointer}"))?;
    if actual == expected {
        Ok(())
    } else {
        Err(format!("expected {pointer} to be {expected}, got {actual}"))
    }
}

fn expect_u64(value: &Value, pointer: &str, expected: u64) -> Result<(), String> {
    let actual = value
        .pointer(pointer)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("missing unsigned integer at {pointer}"))?;
    if actual == expected {
        Ok(())
    } else {
        Err(format!("expected {pointer} to be {expected}, got {actual}"))
    }
}

fn expect_string(value: &Value, pointer: &str, expected: &str) -> Result<(), String> {
    let actual = value
        .pointer(pointer)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing string at {pointer}"))?;
    if actual == expected {
        Ok(())
    } else {
        Err(format!("expected {pointer} to be {expected}, got {actual}"))
    }
}

fn slot_number(slot: &str) -> Option<usize> {
    slot.strip_prefix("slot_")
        .and_then(|number| number.parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fake_manifest(command_template: &str, run_count: usize) -> ProofRunManifest {
        let specs = [
            ("projection-rebuild-audit", "Projection rebuild audit"),
            ("resolution-replay-audit", "Resolution replay audit"),
            ("resolution-trace-inspection", "Resolution trace inspection"),
        ]
        .into_iter()
        .take(run_count)
        .map(|(id, family)| ProofRunSpec {
            id: id.to_string(),
            family: family.to_string(),
            scope: "Game-specific".to_string(),
            command_template: command_template.to_string(),
            test_selector: None,
            artifact_path: None,
            artifact_kind: None,
            audit_expected_path: None,
            audit_actual_path: None,
            proof_boundary: "boundary".to_string(),
        })
        .collect();
        ProofRunManifest {
            version: 1,
            artifact_freshness_max_age_seconds: 86_400,
            database_url_example: "postgres://example".to_string(),
            families: vec![ProofRunFamily {
                heading: "Game-Specific Audits".to_string(),
                runs: specs,
            }],
        }
    }

    #[test]
    fn arg_parser_requires_fixture_path() {
        assert_eq!(Args::parse(Vec::<String>::new()), Err(usage()));
        let args = Args::parse([
            "--output=target/operator-proof/report.json".to_string(),
            "crates/commands/fixtures/night-passing.json".to_string(),
        ])
        .expect("args parse");
        assert_eq!(
            args.fixture_path,
            "crates/commands/fixtures/night-passing.json"
        );
        assert_eq!(
            args.output_path,
            Some(PathBuf::from("target/operator-proof/report.json"))
        );
        assert_eq!(args.compare_with, None);
        let args = Args::parse([
            "--compare-with".to_string(),
            "target/operator-proof/old.json".to_string(),
            "--output".to_string(),
            "target/operator-proof/new.json".to_string(),
            "crates/commands/fixtures/night-passing.json".to_string(),
        ])
        .expect("args parse");
        assert_eq!(
            args.compare_with,
            Some(PathBuf::from("target/operator-proof/old.json"))
        );
    }

    #[test]
    fn expands_game_specific_runs_from_manifest_templates() {
        let game = Uuid::from_u128(7);
        let manifest = fake_manifest(
            "DATABASE_URL={database_url} cargo run -p changed --bin sentinel -- {game}",
            3,
        );
        let runs = expand_game_specific_runs(&manifest, "postgres://db", game).expect("runs");
        assert_eq!(runs.len(), 3);
        assert!(runs
            .iter()
            .all(|run| run.command.contains("cargo run -p changed --bin sentinel")));
        assert!(runs
            .iter()
            .all(|run| run.command.contains(&game.to_string())));
        assert!(runs
            .iter()
            .all(|run| run.command.starts_with("DATABASE_URL=postgres://db ")));
    }

    #[test]
    fn rejects_template_expansion_when_manifest_count_changes() {
        let game = Uuid::from_u128(7);
        let manifest = fake_manifest(
            "DATABASE_URL={database_url} cargo run -p changed --bin sentinel -- {game}",
            2,
        );
        let err = expand_game_specific_runs(&manifest, "postgres://db", game).unwrap_err();
        assert_eq!(
            err,
            "expected exactly 3 game-specific manifest runs, found 2"
        );
    }

    #[test]
    fn actual_manifest_expands_three_game_specific_commands() {
        let manifest = proof_run_manifest().expect("manifest parses");
        let game = Uuid::from_u128(42);
        let runs =
            expand_game_specific_runs(&manifest, &manifest.database_url_example, game).unwrap();
        let commands: Vec<_> = runs.iter().map(|run| run.command.as_str()).collect();
        assert_eq!(runs.len(), 3);
        assert!(commands
            .iter()
            .any(|command| command.contains("cargo run -p projections --bin audit_rebuild")));
        assert!(commands
            .iter()
            .any(|command| command.contains("cargo run -p commands --bin audit_resolution")));
        assert!(commands
            .iter()
            .any(|command| command.contains("cargo run -p commands --bin inspect_trace")));
    }

    #[test]
    fn validates_expected_game_specific_outputs() {
        let game = Uuid::from_u128(99);
        validate_run_output(
            "projection-rebuild-audit",
            game,
            &json!({
                "game_id": game,
                "ok": true,
                "tables": (0..13).map(|index| json!({
                    "table": format!("table_{index}"),
                    "matches": true
                })).collect::<Vec<_>>()
            }),
        )
        .expect("projection output valid");
        validate_run_output(
            "resolution-replay-audit",
            game,
            &json!({
                "game_id": game,
                "ok": true,
                "audited": 1,
                "skipped": 0,
                "summary": {"matched": 1, "drifted": 0, "skipped": 0},
                "phases": [{"phase_id": "N01", "status": "matched"}]
            }),
        )
        .expect("resolution output valid");
        validate_run_output(
            "resolution-trace-inspection",
            game,
            &json!({
                "game_id": game,
                "traces": [{
                    "phase_id": "N01",
                    "decisions": [
                        {"stage": "result_contract"},
                        {"outcome": "kill_prevented_by_protection"},
                        {"stage": "inner_event"},
                        {"stage": "inner_event"}
                    ]
                }]
            }),
        )
        .expect("trace output valid");
    }

    #[test]
    fn writes_report_atomically() {
        let dir = env::temp_dir().join(format!("fmarch-proof-{}", Uuid::new_v4()));
        let path = dir.join("nested").join("report.json");
        write_report_atomic(&path, br#"{"ok":true}"#).expect("report writes");
        let text = fs::read_to_string(&path).expect("report readable");
        assert_eq!(text, r#"{"ok":true}"#);
        assert!(
            !temporary_path_for(&path).exists(),
            "temporary file renamed away"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn normalizes_expected_retention_drift() {
        let old = json!({
            "ok": true,
            "manifest_version": 1,
            "game_id": "11111111-1111-1111-1111-111111111111",
            "artifact_path": "target/operator-proof/old.json",
            "fixture": {"seed": 77001},
            "runs": [{
                "id": "resolution-replay-audit",
                "command": "DATABASE_URL=db cargo run -p commands --bin audit_resolution -- 11111111-1111-1111-1111-111111111111",
                "ok": true,
                "summary": {
                    "game_id": "11111111-1111-1111-1111-111111111111",
                    "phases": [{
                        "run_id": "resolution:11111111-1111-1111-1111-111111111111:N01:77001:14",
                        "applied_stream_seq": 14,
                        "trace_stream_seq": 15
                    }]
                }
            }]
        });
        let new = json!({
            "ok": true,
            "manifest_version": 1,
            "game_id": "22222222-2222-2222-2222-222222222222",
            "artifact_path": "target/operator-proof/new.json",
            "retention_comparison": {"normalized_match": true},
            "fixture": {"seed": 77001},
            "runs": [{
                "id": "resolution-replay-audit",
                "command": "DATABASE_URL=db cargo run -p commands --bin audit_resolution -- 22222222-2222-2222-2222-222222222222",
                "ok": true,
                "summary": {
                    "game_id": "22222222-2222-2222-2222-222222222222",
                    "phases": [{
                        "run_id": "resolution:22222222-2222-2222-2222-222222222222:N01:77001:21",
                        "applied_stream_seq": 21,
                        "trace_stream_seq": 22
                    }]
                }
            }]
        });
        assert_eq!(
            normalize_report(old).expect("old normalizes"),
            normalize_report(new).expect("new normalizes")
        );
    }

    #[test]
    fn retention_comparison_rejects_semantic_drift() {
        let old = json!({
            "ok": true,
            "game_id": "11111111-1111-1111-1111-111111111111",
            "runs": [{"id": "resolution-replay-audit", "ok": true}]
        });
        let mut new = old.clone();
        new["runs"][0]["ok"] = json!(false);
        assert_ne!(
            normalize_report(old).expect("old normalizes"),
            normalize_report(new).expect("new normalizes")
        );
    }
}
