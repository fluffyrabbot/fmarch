use std::{collections::BTreeMap, env, fs, path::Path};

use caps::Principal;
use commands::{audit_resolution_envelopes, handle, inspect_resolution_traces, Command};
use projections::audit_rebuild;
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct NightFixture {
    seed: u64,
    #[serde(default = "default_pack")]
    pack: String,
    #[serde(default = "default_phase")]
    phase: String,
    roster: Vec<FixtureSlot>,
    actions: Vec<FixtureAction>,
    #[serde(default)]
    expectations: FixtureExpectations,
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

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct FixtureExpectations {
    #[serde(default)]
    inner_events: Vec<ExpectedInnerEvent>,
    #[serde(default)]
    trace_decisions: Vec<ExpectedTraceDecision>,
    #[serde(default)]
    trace_notes: Vec<String>,
    #[serde(default)]
    generated_actions: Vec<ExpectedGeneratedAction>,
}

impl FixtureExpectations {
    fn count(&self) -> usize {
        self.inner_events.len()
            + self.trace_decisions.len()
            + self.trace_notes.len()
            + self.generated_actions.len()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ExpectedInnerEvent {
    kind: String,
    #[serde(default)]
    payload: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ExpectedTraceDecision {
    stage: String,
    source: String,
    outcome: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    detail: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ExpectedGeneratedAction {
    action_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    actor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    targets: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    detail: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct ReductionStep {
    kind: &'static str,
    removed: String,
    roster_len: usize,
    action_len: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct ToolReport {
    original: RunReport,
    minimized: RunReport,
    reduction_steps: Vec<ReductionStep>,
    fixture: NightFixture,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct RunReport {
    ok: bool,
    failure_class: Option<FailureClass>,
    reason: Option<String>,
    game_id: Option<Uuid>,
    resolution_audited: Option<usize>,
    trace_count: Option<usize>,
    projection_audit_ok: Option<bool>,
    semantic_expectations_checked: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum FailureClass {
    Command,
    Resolve,
    ResolutionAudit,
    TraceInspection,
    SemanticExpectation,
    ProjectionAudit,
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

    let original = run_fixture(&pool, &fixture).await;
    let (fixture, steps, minimized) = if args.reduce && !original.ok {
        minimize_fixture(&pool, fixture.clone(), original.failure_class).await
    } else {
        (fixture, Vec::new(), original.clone())
    };

    println!(
        "{}",
        serde_json::to_string_pretty(&ToolReport {
            original,
            minimized,
            reduction_steps: steps,
            fixture,
        })?
    );
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Args {
    fixture_path: String,
    reduce: bool,
}

impl Args {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut fixture_path = None;
        let mut reduce = false;
        for arg in args {
            match arg.as_str() {
                "--reduce" => reduce = true,
                "-h" | "--help" => return Err(usage()),
                _ if arg.starts_with('-') => return Err(usage()),
                _ if fixture_path.is_none() => fixture_path = Some(arg),
                _ => return Err(usage()),
            }
        }
        Ok(Args {
            fixture_path: fixture_path.ok_or_else(usage)?,
            reduce,
        })
    }
}

fn usage() -> String {
    "usage: minimize_night_fixture [--reduce] <fixture.json>".to_string()
}

fn read_fixture(path: &str) -> Result<NightFixture, Box<dyn std::error::Error>> {
    let text = fs::read_to_string(Path::new(path))?;
    Ok(serde_json::from_str(&text)?)
}

async fn minimize_fixture(
    pool: &PgPool,
    mut fixture: NightFixture,
    failure_class: Option<FailureClass>,
) -> (NightFixture, Vec<ReductionStep>, RunReport) {
    let mut steps = Vec::new();
    let mut changed = true;
    while changed {
        changed = false;
        for index in 0..fixture.actions.len() {
            let mut candidate = fixture.clone();
            let removed = candidate.actions.remove(index);
            let report = run_fixture(pool, &candidate).await;
            if preserves_failure(&report, failure_class) {
                fixture = candidate;
                steps.push(ReductionStep {
                    kind: "action",
                    removed: removed.action_id,
                    roster_len: fixture.roster.len(),
                    action_len: fixture.actions.len(),
                });
                changed = true;
                break;
            }
        }
    }

    changed = true;
    while changed {
        changed = false;
        for index in 0..fixture.roster.len() {
            let mut candidate = fixture.clone();
            let removed = candidate.roster.remove(index);
            candidate.actions = candidate
                .actions
                .into_iter()
                .filter(|action| {
                    action.actor_slot != removed.slot
                        && action.targets.iter().all(|target| target != &removed.slot)
                })
                .collect();
            let report = run_fixture(pool, &candidate).await;
            if preserves_failure(&report, failure_class) {
                fixture = candidate;
                steps.push(ReductionStep {
                    kind: "slot",
                    removed: removed.slot,
                    roster_len: fixture.roster.len(),
                    action_len: fixture.actions.len(),
                });
                changed = true;
                break;
            }
        }
    }

    let minimized = run_fixture(pool, &fixture).await;
    (fixture, steps, minimized)
}

fn preserves_failure(report: &RunReport, failure_class: Option<FailureClass>) -> bool {
    !report.ok && report.failure_class == failure_class
}

async fn run_fixture(pool: &PgPool, fixture: &NightFixture) -> RunReport {
    let game = Uuid::new_v4();
    let host = Principal::user("fixture_host");
    if let Err(err) = handle(
        pool,
        &host,
        Command::CreateGame {
            game,
            pack: fixture.pack.clone(),
        },
    )
    .await
    {
        return failed(
            FailureClass::Command,
            format!("create game failed: {err}"),
            game,
        );
    }

    for slot in &fixture.roster {
        if let Err(err) = handle(
            pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot.slot.clone(),
            },
        )
        .await
        {
            return failed(
                FailureClass::Command,
                format!("add {} failed: {err}", slot.slot),
                game,
            );
        }
        if let Err(err) = handle(
            pool,
            &host,
            Command::AssignSlot {
                game,
                slot: slot.slot.clone(),
                user: format!("fixture_user_{}", slot_number(&slot.slot).unwrap_or(0)),
            },
        )
        .await
        {
            return failed(
                FailureClass::Command,
                format!("assign {} failed: {err}", slot.slot),
                game,
            );
        }
        if let Err(err) = handle(
            pool,
            &host,
            Command::AssignRole {
                game,
                slot: slot.slot.clone(),
                role_key: slot.role.clone(),
            },
        )
        .await
        {
            return failed(
                FailureClass::Command,
                format!("role {} failed: {err}", slot.slot),
                game,
            );
        }
    }

    if let Err(err) = handle(
        pool,
        &host,
        Command::StartGame {
            game,
            phase: fixture.phase.clone(),
        },
    )
    .await
    {
        return failed(FailureClass::Command, format!("start failed: {err}"), game);
    }

    for action in &fixture.actions {
        if let Err(err) = handle(
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
        .await
        {
            return failed(
                FailureClass::Command,
                format!("submit {} failed: {err}", action.action_id),
                game,
            );
        }
    }

    if let Err(err) = handle(
        pool,
        &host,
        Command::ResolvePhase {
            game,
            seed: fixture.seed,
        },
    )
    .await
    {
        return failed(
            FailureClass::Resolve,
            format!("resolve failed: {err}"),
            game,
        );
    }

    let resolution_audit = match audit_resolution_envelopes(pool, game).await {
        Ok(report) if report.ok => report,
        Ok(report) => {
            return RunReport {
                ok: false,
                failure_class: Some(FailureClass::ResolutionAudit),
                reason: Some("resolution envelope audit drifted".to_string()),
                game_id: Some(game),
                resolution_audited: Some(report.audited),
                trace_count: None,
                projection_audit_ok: None,
                semantic_expectations_checked: 0,
            }
        }
        Err(err) => {
            return failed(
                FailureClass::ResolutionAudit,
                format!("resolution audit failed: {err}"),
                game,
            )
        }
    };

    let trace_report = match inspect_resolution_traces(pool, game, None).await {
        Ok(report) => report,
        Err(err) => {
            return failed(
                FailureClass::TraceInspection,
                format!("trace inspection failed: {err}"),
                game,
            )
        }
    };
    if trace_report.traces.len() != 1
        || !trace_report.traces.iter().any(|trace| {
            trace.applied_stream_seq.is_some()
                && trace
                    .decisions
                    .iter()
                    .any(|decision| decision.applied_stream_seq.is_some())
        })
    {
        return RunReport {
            ok: false,
            failure_class: Some(FailureClass::TraceInspection),
            reason: Some("trace inspection missing anchored N01 trace".to_string()),
            game_id: Some(game),
            resolution_audited: Some(resolution_audit.audited),
            trace_count: Some(trace_report.traces.len()),
            projection_audit_ok: None,
            semantic_expectations_checked: 0,
        };
    }

    let semantic_expectations_checked = fixture.expectations.count();
    if semantic_expectations_checked > 0 {
        let applied_payload = match sqlx::query_scalar::<_, serde_json::Value>(
            "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
             AND payload->>'phase_id' = $2",
        )
        .bind(game)
        .bind(&fixture.phase)
        .fetch_one(pool)
        .await
        {
            Ok(payload) => payload,
            Err(err) => {
                return RunReport {
                    ok: false,
                    failure_class: Some(FailureClass::SemanticExpectation),
                    reason: Some(format!("fetch ResolutionApplied failed: {err}")),
                    game_id: Some(game),
                    resolution_audited: Some(resolution_audit.audited),
                    trace_count: Some(trace_report.traces.len()),
                    projection_audit_ok: None,
                    semantic_expectations_checked: 0,
                }
            }
        };
        let applied =
            match domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION) {
                Ok(applied) => applied,
                Err(err) => {
                    return RunReport {
                        ok: false,
                        failure_class: Some(FailureClass::SemanticExpectation),
                        reason: Some(format!("ResolutionApplied validation failed: {err}")),
                        game_id: Some(game),
                        resolution_audited: Some(resolution_audit.audited),
                        trace_count: Some(trace_report.traces.len()),
                        projection_audit_ok: None,
                        semantic_expectations_checked: 0,
                    }
                }
            };
        if let Err(reason) =
            validate_semantic_expectations(&fixture.expectations, &applied, &trace_report)
        {
            return RunReport {
                ok: false,
                failure_class: Some(FailureClass::SemanticExpectation),
                reason: Some(reason),
                game_id: Some(game),
                resolution_audited: Some(resolution_audit.audited),
                trace_count: Some(trace_report.traces.len()),
                projection_audit_ok: None,
                semantic_expectations_checked: 0,
            };
        }
    }

    match audit_rebuild(pool, game).await {
        Ok(report) if report.ok => RunReport {
            ok: true,
            failure_class: None,
            reason: None,
            game_id: Some(game),
            resolution_audited: Some(resolution_audit.audited),
            trace_count: Some(trace_report.traces.len()),
            projection_audit_ok: Some(true),
            semantic_expectations_checked,
        },
        Ok(_) => RunReport {
            ok: false,
            failure_class: Some(FailureClass::ProjectionAudit),
            reason: Some("projection rebuild audit drifted".to_string()),
            game_id: Some(game),
            resolution_audited: Some(resolution_audit.audited),
            trace_count: Some(trace_report.traces.len()),
            projection_audit_ok: Some(false),
            semantic_expectations_checked,
        },
        Err(err) => failed(
            FailureClass::ProjectionAudit,
            format!("projection audit failed: {err}"),
            game,
        ),
    }
}

fn validate_semantic_expectations(
    expectations: &FixtureExpectations,
    applied: &domain::ResolutionApplied,
    trace_report: &commands::ResolutionTraceInspectionReport,
) -> Result<(), String> {
    for expected in &expectations.inner_events {
        let found = applied.events.iter().any(|event| {
            let event_json = serde_json::to_value(&event.event)
                .expect("validated inner event should serialize for fixture matching");
            event_json["kind"].as_str() == Some(expected.kind.as_str())
                && expected.payload.iter().all(|(key, expected_value)| {
                    event_json["payload"].get(key).is_some_and(|actual_value| {
                        matches_expected_value(actual_value, expected_value)
                    })
                })
        });
        if !found {
            return Err(format!(
                "missing expected inner event kind={} payload_subset={}",
                expected.kind,
                serde_json::to_string(&expected.payload)
                    .unwrap_or_else(|_| "<unserializable>".to_string())
            ));
        }
    }

    for expected in &expectations.trace_decisions {
        let found = trace_report.traces.iter().any(|trace| {
            trace.decisions.iter().any(|decision| {
                decision.stage == expected.stage
                    && decision.source == expected.source
                    && decision.outcome == expected.outcome
                    && expected
                        .detail
                        .as_ref()
                        .is_none_or(|detail| matches_expected_value(&decision.detail, detail))
            })
        });
        if !found {
            return Err(format!(
                "missing expected trace decision stage={} source={} outcome={}",
                expected.stage, expected.source, expected.outcome
            ));
        }
    }

    for expected_note in &expectations.trace_notes {
        let found = trace_report.traces.iter().any(|trace| {
            trace
                .notes
                .iter()
                .any(|note| note.note == *expected_note && note.applied_stream_seq.is_some())
        });
        if !found {
            return Err(format!("missing expected trace note {expected_note:?}"));
        }
    }

    for expected in &expectations.generated_actions {
        let found = trace_report.traces.iter().any(|trace| {
            trace.generated.iter().any(|generated| {
                generated.action_id == expected.action_id
                    && expected
                        .source
                        .as_ref()
                        .is_none_or(|source| generated.source == *source)
                    && expected
                        .actor
                        .as_ref()
                        .is_none_or(|actor| generated.actor == *actor)
                    && expected
                        .targets
                        .as_ref()
                        .is_none_or(|targets| generated.targets == *targets)
                    && expected
                        .detail
                        .as_ref()
                        .is_none_or(|detail| matches_expected_value(&generated.detail, detail))
            })
        });
        if !found {
            return Err(format!(
                "missing expected generated action action_id={}",
                expected.action_id
            ));
        }
    }

    Ok(())
}

fn matches_expected_value(actual: &serde_json::Value, expected: &serde_json::Value) -> bool {
    match (actual, expected) {
        (serde_json::Value::Object(actual), serde_json::Value::Object(expected)) => {
            expected.iter().all(|(key, expected_value)| {
                actual.get(key).is_some_and(|actual_value| {
                    matches_expected_value(actual_value, expected_value)
                })
            })
        }
        _ => actual == expected,
    }
}

fn failed(class: FailureClass, reason: String, game: Uuid) -> RunReport {
    RunReport {
        ok: false,
        failure_class: Some(class),
        reason: Some(reason),
        game_id: Some(game),
        resolution_audited: None,
        trace_count: None,
        projection_audit_ok: None,
        semantic_expectations_checked: 0,
    }
}

fn slot_number(slot: &str) -> Option<usize> {
    slot.strip_prefix("slot_")
        .and_then(|number| number.parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fixture_defaults() {
        let fixture: NightFixture = serde_json::from_str(
            r#"{
              "seed": 7,
              "roster": [{"slot": "slot_1", "role": "doctor"}],
              "actions": [{
                "actor_slot": "slot_1",
                "template_id": "doctor_protect",
                "action_id": "protect_1",
                "targets": ["slot_1"]
              }]
            }"#,
        )
        .expect("fixture parses");
        assert_eq!(fixture.pack, "mafiascum");
        assert_eq!(fixture.phase, "N01");
        assert_eq!(fixture.seed, 7);
        assert_eq!(fixture.expectations.count(), 0);
    }

    #[test]
    fn arg_parser_accepts_reduce_flag() {
        let args =
            Args::parse(["--reduce".to_string(), "case.json".to_string()]).expect("args parse");
        assert!(args.reduce);
        assert_eq!(args.fixture_path, "case.json");
    }

    #[test]
    fn slot_pruning_removes_dependent_actions() {
        let fixture = NightFixture {
            seed: 1,
            pack: default_pack(),
            phase: default_phase(),
            roster: vec![
                FixtureSlot {
                    slot: "slot_1".to_string(),
                    role: "doctor".to_string(),
                },
                FixtureSlot {
                    slot: "slot_2".to_string(),
                    role: "mafia_goon".to_string(),
                },
            ],
            actions: vec![
                FixtureAction {
                    actor_slot: "slot_1".to_string(),
                    template_id: "doctor_protect".to_string(),
                    action_id: "protect".to_string(),
                    targets: vec!["slot_2".to_string()],
                },
                FixtureAction {
                    actor_slot: "slot_2".to_string(),
                    template_id: "factional_kill".to_string(),
                    action_id: "kill".to_string(),
                    targets: vec!["slot_1".to_string()],
                },
            ],
            expectations: FixtureExpectations::default(),
        };
        let removed = FixtureSlot {
            slot: "slot_2".to_string(),
            role: "mafia_goon".to_string(),
        };
        let pruned: Vec<_> = fixture
            .actions
            .into_iter()
            .filter(|action| {
                action.actor_slot != removed.slot
                    && action.targets.iter().all(|target| target != &removed.slot)
            })
            .collect();
        assert!(pruned.is_empty());
    }

    #[test]
    fn expected_values_match_object_subsets_recursively() {
        let actual = serde_json::json!({
            "slot_id": "slot_2",
            "payload": {
                "trigger_id": "pgo_shoots_visitor",
                "source": {
                    "actor": "slot_1",
                    "target": "slot_2"
                }
            }
        });
        let expected = serde_json::json!({
            "payload": {
                "source": {
                    "actor": "slot_1"
                }
            }
        });
        assert!(matches_expected_value(&actual, &expected));
        assert!(!matches_expected_value(
            &actual,
            &serde_json::json!({"payload": {"source": {"actor": "slot_3"}}})
        ));
    }

    #[test]
    fn minimized_dependency_fixtures_carry_semantic_expectations() {
        let babysitter: NightFixture = serde_json::from_str(include_str!(
            "../../fixtures/night-babysitter-dependency-minimized.json"
        ))
        .expect("babysitter fixture parses");
        assert_eq!(babysitter.expectations.inner_events.len(), 2);
        assert_eq!(babysitter.expectations.trace_decisions.len(), 1);
        assert_eq!(babysitter.expectations.count(), 3);

        let hider: NightFixture = serde_json::from_str(include_str!(
            "../../fixtures/night-hider-dependency-minimized.json"
        ))
        .expect("hider fixture parses");
        assert_eq!(hider.expectations.inner_events.len(), 2);
        assert_eq!(hider.expectations.trace_decisions.len(), 1);
        assert_eq!(hider.expectations.count(), 3);
    }
}
