use std::{collections::BTreeMap, env, fs, path::Path};

use caps::Principal;
use commands::{
    audit_resolution_envelopes, handle, inspect_resolution_traces, Command, HostPromptDecision,
    VoteTarget,
};
use projections::{
    audit_rebuild, delayed_death_queues, player_notifications, sheriff_badges, slot_effects,
};
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct NightFixture {
    seed: u64,
    #[serde(default = "default_pack")]
    pack: String,
    #[serde(default = "default_phase")]
    phase: String,
    roster: Vec<FixtureSlot>,
    #[serde(default)]
    votes: Vec<FixtureVote>,
    #[serde(default)]
    ita_session_controls: Vec<FixtureItaSessionControl>,
    actions: Vec<FixtureAction>,
    #[serde(default)]
    setup_phases: Vec<FixturePhase>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    host_prompt_decision: Option<FixtureHostPromptDecision>,
    #[serde(default)]
    expectations: FixtureExpectations,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct FixturePhase {
    phase: String,
    seed: u64,
    #[serde(default)]
    votes: Vec<FixtureVote>,
    #[serde(default)]
    ita_session_controls: Vec<FixtureItaSessionControl>,
    #[serde(default)]
    actions: Vec<FixtureAction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    host_prompt_decision: Option<FixtureHostPromptDecision>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    grant_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct FixtureVote {
    actor_slot: String,
    target_slot: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct FixtureItaSessionControl {
    session_id: String,
    control: domain::ItaSessionControlKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct FixtureHostPromptDecision {
    prompt_id: String,
    decision: HostPromptDecision,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct FixtureExpectations {
    #[serde(default)]
    inner_events: Vec<ExpectedInnerEvent>,
    #[serde(default)]
    stream_events: Vec<ExpectedStreamEvent>,
    #[serde(default)]
    trace_decisions: Vec<ExpectedTraceDecision>,
    #[serde(default)]
    trace_notes: Vec<String>,
    #[serde(default)]
    generated_actions: Vec<ExpectedGeneratedAction>,
    #[serde(default)]
    delayed_death_queues: Vec<ExpectedProjectionRow>,
    #[serde(default)]
    absent_delayed_death_queues: Vec<ExpectedProjectionRow>,
    #[serde(default)]
    slot_effects: Vec<ExpectedProjectionRow>,
    #[serde(default)]
    absent_slot_effects: Vec<ExpectedProjectionRow>,
    #[serde(default)]
    player_notifications: Vec<ExpectedProjectionRow>,
    #[serde(default)]
    sheriff_badges: Vec<ExpectedProjectionRow>,
}

impl FixtureExpectations {
    fn count(&self) -> usize {
        self.inner_events.len()
            + self.stream_events.len()
            + self.trace_decisions.len()
            + self.trace_notes.len()
            + self.generated_actions.len()
            + self.delayed_death_queues.len()
            + self.absent_delayed_death_queues.len()
            + self.slot_effects.len()
            + self.absent_slot_effects.len()
            + self.player_notifications.len()
            + self.sheriff_badges.len()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ExpectedInnerEvent {
    kind: String,
    #[serde(default)]
    payload: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ExpectedStreamEvent {
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ExpectedProjectionRow {
    #[serde(default)]
    payload: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct ReductionStep {
    kind: &'static str,
    removed: String,
    roster_len: usize,
    action_len: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
struct ToolReport {
    original: RunReport,
    minimized: RunReport,
    reduction_steps: Vec<ReductionStep>,
    reduction: ReductionReport,
    #[serde(skip_serializing_if = "Option::is_none")]
    write_reduced: Option<WriteReducedReport>,
    fixture: NightFixture,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct ReductionReport {
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<ReductionTargetReport>,
    replay_success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure_class_preserved: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    success_invariant_preserved: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
enum ReductionTargetReport {
    FailureClass { failure_class: Option<FailureClass> },
    SuccessExpectations { expectation_count: usize },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct WriteReducedReport {
    path: String,
    wrote: bool,
    promoted_success_fixture: bool,
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
    let reduction_target = ReductionTarget::from_report(&fixture, &original);
    let (fixture, steps, minimized) = if args.reduce && reduction_target.is_some() {
        minimize_fixture(
            &pool,
            fixture.clone(),
            reduction_target.expect("checked reduction target"),
        )
        .await
    } else {
        (fixture, Vec::new(), original.clone())
    };
    let reduction = ReductionReport::new(reduction_target, &minimized);
    let write_reduced = if let Some(write_reduced_path) = &args.write_reduced_path {
        write_fixture(write_reduced_path, &fixture)?;
        Some(WriteReducedReport::new(write_reduced_path, &reduction))
    } else {
        None
    };

    let report = ToolReport {
        original,
        minimized,
        reduction_steps: steps,
        reduction,
        write_reduced,
        fixture,
    };
    let report_json = format!("{}\n", serde_json::to_string_pretty(&report)?);
    if let Some(write_report_path) = &args.write_report_path {
        write_text(write_report_path, &report_json)?;
    }
    print!("{report_json}");
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Args {
    fixture_path: String,
    reduce: bool,
    write_reduced_path: Option<String>,
    write_report_path: Option<String>,
}

impl Args {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut fixture_path = None;
        let mut reduce = false;
        let mut write_reduced_path = None;
        let mut write_report_path = None;
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--reduce" => reduce = true,
                "--write-reduced" => {
                    let path = args.next().ok_or_else(usage)?;
                    if path.starts_with('-') {
                        return Err(usage());
                    }
                    write_reduced_path = Some(path);
                }
                "--write-report" => {
                    let path = args.next().ok_or_else(usage)?;
                    if path.starts_with('-') {
                        return Err(usage());
                    }
                    write_report_path = Some(path);
                }
                "-h" | "--help" => return Err(usage()),
                _ if arg.starts_with('-') => return Err(usage()),
                _ if fixture_path.is_none() => fixture_path = Some(arg),
                _ => return Err(usage()),
            }
        }
        Ok(Args {
            fixture_path: fixture_path.ok_or_else(usage)?,
            reduce,
            write_reduced_path,
            write_report_path,
        })
    }
}

fn usage() -> String {
    "usage: minimize_night_fixture [--reduce] [--write-reduced <path>] [--write-report <path>] <fixture.json>".to_string()
}

fn read_fixture(path: &str) -> Result<NightFixture, Box<dyn std::error::Error>> {
    let text = fs::read_to_string(Path::new(path))?;
    Ok(serde_json::from_str(&text)?)
}

fn write_fixture(path: &str, fixture: &NightFixture) -> Result<(), Box<dyn std::error::Error>> {
    write_text(
        path,
        &format!("{}\n", serde_json::to_string_pretty(fixture)?),
    )?;
    Ok(())
}

fn write_text(path: &str, text: &str) -> Result<(), Box<dyn std::error::Error>> {
    fs::write(Path::new(path), text)?;
    Ok(())
}

async fn minimize_fixture(
    pool: &PgPool,
    mut fixture: NightFixture,
    target: ReductionTarget,
) -> (NightFixture, Vec<ReductionStep>, RunReport) {
    let mut steps = Vec::new();
    let mut changed = true;
    while changed {
        changed = false;
        for index in 0..fixture.votes.len() {
            let mut candidate = fixture.clone();
            let removed = candidate.votes.remove(index);
            let report = run_fixture(pool, &candidate).await;
            if target.is_preserved_by(&report) {
                fixture = candidate;
                steps.push(ReductionStep {
                    kind: "vote",
                    removed: format!("{}->{}", removed.actor_slot, removed.target_slot),
                    roster_len: fixture.roster.len(),
                    action_len: fixture_action_len(&fixture),
                });
                changed = true;
                break;
            }
        }
        if changed {
            continue;
        }
        for index in 0..fixture.actions.len() {
            let mut candidate = fixture.clone();
            let removed = candidate.actions.remove(index);
            let report = run_fixture(pool, &candidate).await;
            if target.is_preserved_by(&report) {
                fixture = candidate;
                steps.push(ReductionStep {
                    kind: "action",
                    removed: removed.action_id,
                    roster_len: fixture.roster.len(),
                    action_len: fixture_action_len(&fixture),
                });
                changed = true;
                break;
            }
        }
        if changed {
            continue;
        }
        for phase_index in 0..fixture.setup_phases.len() {
            for action_index in 0..fixture.setup_phases[phase_index].actions.len() {
                let mut candidate = fixture.clone();
                let removed = candidate.setup_phases[phase_index]
                    .actions
                    .remove(action_index);
                let report = run_fixture(pool, &candidate).await;
                if target.is_preserved_by(&report) {
                    fixture = candidate;
                    steps.push(ReductionStep {
                        kind: "setup_action",
                        removed: removed.action_id,
                        roster_len: fixture.roster.len(),
                        action_len: fixture_action_len(&fixture),
                    });
                    changed = true;
                    break;
                }
            }
            if changed {
                break;
            }
        }
        if changed {
            continue;
        }
        for phase_index in 0..fixture.setup_phases.len() {
            for vote_index in 0..fixture.setup_phases[phase_index].votes.len() {
                let mut candidate = fixture.clone();
                let removed = candidate.setup_phases[phase_index].votes.remove(vote_index);
                let report = run_fixture(pool, &candidate).await;
                if target.is_preserved_by(&report) {
                    fixture = candidate;
                    steps.push(ReductionStep {
                        kind: "setup_vote",
                        removed: format!("{}->{}", removed.actor_slot, removed.target_slot),
                        roster_len: fixture.roster.len(),
                        action_len: fixture_action_len(&fixture),
                    });
                    changed = true;
                    break;
                }
            }
            if changed {
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
            prune_slot_references(&mut candidate, &removed.slot);
            let report = run_fixture(pool, &candidate).await;
            if target.is_preserved_by(&report) {
                fixture = candidate;
                steps.push(ReductionStep {
                    kind: "slot",
                    removed: removed.slot,
                    roster_len: fixture.roster.len(),
                    action_len: fixture_action_len(&fixture),
                });
                changed = true;
                break;
            }
        }
    }

    let minimized = run_fixture(pool, &fixture).await;
    (fixture, steps, minimized)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReductionTarget {
    FailureClass(Option<FailureClass>),
    SuccessExpectations { expectation_count: usize },
}

impl ReductionTarget {
    fn from_report(fixture: &NightFixture, report: &RunReport) -> Option<Self> {
        if !report.ok {
            return Some(ReductionTarget::FailureClass(report.failure_class));
        }
        let expectation_count = fixture.expectations.count();
        (expectation_count > 0)
            .then_some(ReductionTarget::SuccessExpectations { expectation_count })
    }

    fn is_preserved_by(self, report: &RunReport) -> bool {
        match self {
            ReductionTarget::FailureClass(failure_class) => {
                !report.ok && report.failure_class == failure_class
            }
            ReductionTarget::SuccessExpectations { expectation_count } => {
                report.ok && report.semantic_expectations_checked == expectation_count
            }
        }
    }
}

impl ReductionReport {
    fn new(target: Option<ReductionTarget>, minimized: &RunReport) -> Self {
        let failure_class_preserved = match target {
            Some(ReductionTarget::FailureClass(failure_class)) => {
                Some(!minimized.ok && minimized.failure_class == failure_class)
            }
            _ => None,
        };
        let success_invariant_preserved = match target {
            Some(ReductionTarget::SuccessExpectations { expectation_count }) => {
                Some(minimized.ok && minimized.semantic_expectations_checked == expectation_count)
            }
            _ => None,
        };
        ReductionReport {
            target: target.map(ReductionTargetReport::from),
            replay_success: minimized.ok,
            failure_class_preserved,
            success_invariant_preserved,
        }
    }
}

impl From<ReductionTarget> for ReductionTargetReport {
    fn from(target: ReductionTarget) -> Self {
        match target {
            ReductionTarget::FailureClass(failure_class) => {
                ReductionTargetReport::FailureClass { failure_class }
            }
            ReductionTarget::SuccessExpectations { expectation_count } => {
                ReductionTargetReport::SuccessExpectations { expectation_count }
            }
        }
    }
}

impl WriteReducedReport {
    fn new(path: &str, reduction: &ReductionReport) -> Self {
        WriteReducedReport {
            path: path.to_string(),
            wrote: true,
            promoted_success_fixture: reduction.success_invariant_preserved == Some(true),
        }
    }
}

fn fixture_action_len(fixture: &NightFixture) -> usize {
    fixture.actions.len()
        + fixture
            .setup_phases
            .iter()
            .map(|phase| phase.actions.len())
            .sum::<usize>()
}

fn prune_slot_references(fixture: &mut NightFixture, removed_slot: &str) {
    fixture
        .votes
        .retain(|vote| vote.actor_slot != removed_slot && vote.target_slot != removed_slot);
    fixture.actions.retain(|action| {
        action.actor_slot != removed_slot
            && action.targets.iter().all(|target| target != removed_slot)
    });
    for phase in &mut fixture.setup_phases {
        phase
            .votes
            .retain(|vote| vote.actor_slot != removed_slot && vote.target_slot != removed_slot);
        phase.actions.retain(|action| {
            action.actor_slot != removed_slot
                && action.targets.iter().all(|target| target != removed_slot)
        });
    }
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

    for phase in &fixture.setup_phases {
        if let Err(report) = run_fixture_phase(pool, game, &host, phase).await {
            return report;
        }
    }

    let target_phase = FixturePhase {
        phase: fixture.phase.clone(),
        seed: fixture.seed,
        votes: fixture.votes.clone(),
        ita_session_controls: fixture.ita_session_controls.clone(),
        actions: fixture.actions.clone(),
        host_prompt_decision: fixture.host_prompt_decision.clone(),
    };
    if let Err(report) = run_fixture_phase(pool, game, &host, &target_phase).await {
        return report;
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
    let target_phase = FixturePhase {
        phase: fixture.phase.clone(),
        seed: fixture.seed,
        votes: fixture.votes.clone(),
        ita_session_controls: fixture.ita_session_controls.clone(),
        actions: fixture.actions.clone(),
        host_prompt_decision: fixture.host_prompt_decision.clone(),
    };
    let expected_trace_count = fixture
        .setup_phases
        .iter()
        .map(expected_phase_trace_count)
        .sum::<usize>()
        + expected_phase_trace_count(&target_phase);
    if trace_report.traces.len() != expected_trace_count
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
            reason: Some(format!(
                "trace inspection missing anchored trace set: expected {expected_trace_count}, got {}",
                trace_report.traces.len()
            )),
            game_id: Some(game),
            resolution_audited: Some(resolution_audit.audited),
            trace_count: Some(trace_report.traces.len()),
            projection_audit_ok: None,
            semantic_expectations_checked: 0,
        };
    }

    let semantic_expectations_checked = fixture.expectations.count();
    if semantic_expectations_checked > 0 {
        let applied_payloads = match sqlx::query_scalar::<_, serde_json::Value>(
            "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
             AND payload->>'phase_id' = $2 ORDER BY stream_seq",
        )
        .bind(game)
        .bind(&fixture.phase)
        .fetch_all(pool)
        .await
        {
            Ok(payloads) if !payloads.is_empty() => payloads,
            Ok(_) => {
                return RunReport {
                    ok: false,
                    failure_class: Some(FailureClass::SemanticExpectation),
                    reason: Some("fetch ResolutionApplied returned no phase payloads".to_string()),
                    game_id: Some(game),
                    resolution_audited: Some(resolution_audit.audited),
                    trace_count: Some(trace_report.traces.len()),
                    projection_audit_ok: None,
                    semantic_expectations_checked: 0,
                }
            }
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
        let mut applied = Vec::new();
        for applied_payload in applied_payloads {
            match domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION) {
                Ok(payload) => applied.push(payload),
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
        }
        if let Err(reason) = validate_semantic_expectations(
            pool,
            game,
            &fixture.expectations,
            &applied,
            &trace_report,
        )
        .await
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

async fn run_fixture_phase(
    pool: &PgPool,
    game: Uuid,
    host: &Principal,
    phase: &FixturePhase,
) -> Result<(), RunReport> {
    if let Err(err) = handle(
        pool,
        host,
        Command::StartGame {
            game,
            phase: phase.phase.clone(),
        },
    )
    .await
    {
        return Err(failed(
            FailureClass::Command,
            format!("start {} failed: {err}", phase.phase),
            game,
        ));
    }

    for control in &phase.ita_session_controls {
        if let Err(err) = handle(
            pool,
            host,
            Command::ControlItaSession {
                game,
                session_id: control.session_id.clone(),
                control: control.control,
                message: control.message.clone(),
            },
        )
        .await
        {
            return Err(failed(
                FailureClass::Command,
                format!(
                    "control ITA session {} in {} failed: {err}",
                    control.session_id, phase.phase
                ),
                game,
            ));
        }
    }

    for action in &phase.actions {
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
                grant_id: action.grant_id.clone(),
            },
        )
        .await
        {
            return Err(failed(
                FailureClass::Command,
                format!(
                    "submit {} in {} failed: {err}",
                    action.action_id, phase.phase
                ),
                game,
            ));
        }
    }

    for vote in &phase.votes {
        if let Err(err) = handle(
            pool,
            &Principal::user(format!(
                "fixture_user_{}",
                slot_number(&vote.actor_slot).unwrap_or(0)
            )),
            Command::SubmitVote {
                game,
                actor_slot: vote.actor_slot.clone(),
                target: VoteTarget::Slot(vote.target_slot.clone()),
            },
        )
        .await
        {
            return Err(failed(
                FailureClass::Command,
                format!(
                    "submit vote {} -> {} in {} failed: {err}",
                    vote.actor_slot, vote.target_slot, phase.phase
                ),
                game,
            ));
        }
    }

    if let Err(err) = handle(
        pool,
        host,
        Command::ResolvePhase {
            game,
            seed: phase.seed,
        },
    )
    .await
    {
        return Err(failed(
            FailureClass::Resolve,
            format!("resolve {} failed: {err}", phase.phase),
            game,
        ));
    }

    if let Some(decision) = &phase.host_prompt_decision {
        if let Err(err) = handle(
            pool,
            host,
            Command::ResolveHostPrompt {
                game,
                prompt_id: decision.prompt_id.clone(),
                decision: decision.decision.clone(),
            },
        )
        .await
        {
            return Err(failed(
                FailureClass::Resolve,
                format!(
                    "resolve host prompt {} in {} failed: {err}",
                    decision.prompt_id, phase.phase
                ),
                game,
            ));
        }
    }

    Ok(())
}

fn expected_phase_trace_count(phase: &FixturePhase) -> usize {
    1 + usize::from(
        phase.host_prompt_decision.as_ref().is_some_and(|decision| {
            matches!(decision.decision, HostPromptDecision::SelectSlot { .. })
        }),
    )
}

async fn validate_semantic_expectations(
    pool: &PgPool,
    game: Uuid,
    expectations: &FixtureExpectations,
    applied: &[domain::ResolutionApplied],
    trace_report: &commands::ResolutionTraceInspectionReport,
) -> Result<(), String> {
    for expected in &expectations.inner_events {
        let found = applied.iter().any(|applied| {
            applied.events.iter().any(|event| {
                let event_json = serde_json::to_value(&event.event)
                    .expect("validated inner event should serialize for fixture matching");
                event_json["kind"].as_str() == Some(expected.kind.as_str())
                    && expected.payload.iter().all(|(key, expected_value)| {
                        event_json["payload"].get(key).is_some_and(|actual_value| {
                            matches_expected_value(actual_value, expected_value)
                        })
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

    if !expectations.stream_events.is_empty() {
        let stream_events = sqlx::query_as::<_, (String, serde_json::Value)>(
            "SELECT kind, payload FROM events WHERE stream_id = $1 ORDER BY stream_seq",
        )
        .bind(game)
        .fetch_all(pool)
        .await
        .map_err(|err| format!("fetch stream events failed: {err}"))?;
        for expected in &expectations.stream_events {
            let found = stream_events.iter().any(|(kind, payload)| {
                kind == &expected.kind
                    && expected.payload.iter().all(|(key, expected_value)| {
                        payload.get(key).is_some_and(|actual_value| {
                            matches_expected_value(actual_value, expected_value)
                        })
                    })
            });
            if !found {
                return Err(format!(
                    "missing expected stream event kind={} payload_subset={}",
                    expected.kind,
                    serde_json::to_string(&expected.payload)
                        .unwrap_or_else(|_| "<unserializable>".to_string())
                ));
            }
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

    if !expectations.sheriff_badges.is_empty() {
        let rows = sheriff_badges(pool, game)
            .await
            .map_err(|err| format!("fetch sheriff_badges failed: {err}"))?
            .into_iter()
            .map(|row| {
                serde_json::to_value(row)
                    .expect("sheriff badge projection row should serialize for fixture matching")
            })
            .collect::<Vec<_>>();
        for expected in &expectations.sheriff_badges {
            let found = rows.iter().any(|actual| {
                expected.payload.iter().all(|(key, expected_value)| {
                    actual.get(key).is_some_and(|actual_value| {
                        matches_expected_value(actual_value, expected_value)
                    })
                })
            });
            if !found {
                return Err(format!(
                    "missing expected sheriff_badge payload_subset={}",
                    serde_json::to_string(&expected.payload)
                        .unwrap_or_else(|_| "<unserializable>".to_string())
                ));
            }
        }
    }

    let delayed_death_rows = if expectations.delayed_death_queues.is_empty()
        && expectations.absent_delayed_death_queues.is_empty()
    {
        Vec::new()
    } else {
        delayed_death_queues(pool, game)
            .await
            .map_err(|err| format!("fetch delayed_death_queues failed: {err}"))?
            .into_iter()
            .map(|row| {
                serde_json::to_value(row)
                    .expect("delayed death queue row should serialize for fixture matching")
            })
            .collect::<Vec<_>>()
    };
    validate_projection_rows_present(
        "delayed_death_queue",
        &delayed_death_rows,
        &expectations.delayed_death_queues,
    )?;
    validate_projection_rows_absent(
        "delayed_death_queue",
        &delayed_death_rows,
        &expectations.absent_delayed_death_queues,
    )?;

    let slot_effect_rows =
        if expectations.slot_effects.is_empty() && expectations.absent_slot_effects.is_empty() {
            Vec::new()
        } else {
            slot_effects(pool, game)
                .await
                .map_err(|err| format!("fetch slot_effects failed: {err}"))?
                .into_iter()
                .map(|row| {
                    serde_json::to_value(row)
                        .expect("slot effect row should serialize for fixture matching")
                })
                .collect::<Vec<_>>()
        };
    validate_projection_rows_present("slot_effect", &slot_effect_rows, &expectations.slot_effects)?;
    validate_projection_rows_absent(
        "slot_effect",
        &slot_effect_rows,
        &expectations.absent_slot_effects,
    )?;

    if !expectations.player_notifications.is_empty() {
        let rows = player_notifications(pool, game)
            .await
            .map_err(|err| format!("fetch player_notifications failed: {err}"))?
            .into_iter()
            .map(|row| {
                serde_json::to_value(row).expect(
                    "player notification projection row should serialize for fixture matching",
                )
            })
            .collect::<Vec<_>>();
        for expected in &expectations.player_notifications {
            let found = rows.iter().any(|actual| {
                expected.payload.iter().all(|(key, expected_value)| {
                    actual.get(key).is_some_and(|actual_value| {
                        matches_expected_value(actual_value, expected_value)
                    })
                })
            });
            if !found {
                return Err(format!(
                    "missing expected player_notification payload_subset={}",
                    serde_json::to_string(&expected.payload)
                        .unwrap_or_else(|_| "<unserializable>".to_string())
                ));
            }
        }
    }

    Ok(())
}

fn validate_projection_rows_present(
    label: &str,
    rows: &[serde_json::Value],
    expected_rows: &[ExpectedProjectionRow],
) -> Result<(), String> {
    for expected in expected_rows {
        if !rows
            .iter()
            .any(|actual| projection_row_matches(actual, expected))
        {
            return Err(format!(
                "missing expected {label} payload_subset={}",
                serde_json::to_string(&expected.payload)
                    .unwrap_or_else(|_| "<unserializable>".to_string())
            ));
        }
    }
    Ok(())
}

fn validate_projection_rows_absent(
    label: &str,
    rows: &[serde_json::Value],
    expected_rows: &[ExpectedProjectionRow],
) -> Result<(), String> {
    for expected in expected_rows {
        if rows
            .iter()
            .any(|actual| projection_row_matches(actual, expected))
        {
            return Err(format!(
                "unexpected {label} payload_subset={}",
                serde_json::to_string(&expected.payload)
                    .unwrap_or_else(|_| "<unserializable>".to_string())
            ));
        }
    }
    Ok(())
}

fn projection_row_matches(actual: &serde_json::Value, expected: &ExpectedProjectionRow) -> bool {
    expected.payload.iter().all(|(key, expected_value)| {
        actual
            .get(key)
            .is_some_and(|actual_value| matches_expected_value(actual_value, expected_value))
    })
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
        assert_eq!(fixture.actions[0].grant_id, None);
    }

    #[test]
    fn fixture_action_accepts_explicit_grant_id() {
        let fixture: NightFixture = serde_json::from_str(
            r#"{
              "seed": 8,
              "roster": [{"slot": "slot_1", "role": "cop"}],
              "actions": [{
                "actor_slot": "slot_1",
                "template_id": "cop_investigate",
                "action_id": "extra_check",
                "targets": ["slot_1"],
                "grant_id": "extra_action"
              }]
            }"#,
        )
        .expect("fixture with grant id parses");
        assert_eq!(fixture.actions[0].grant_id.as_deref(), Some("extra_action"));
    }

    #[test]
    fn arg_parser_accepts_reduce_flag() {
        let args =
            Args::parse(["--reduce".to_string(), "case.json".to_string()]).expect("args parse");
        assert!(args.reduce);
        assert_eq!(args.fixture_path, "case.json");
        assert_eq!(args.write_reduced_path, None);
    }

    #[test]
    fn arg_parser_accepts_write_reduced_path() {
        let args = Args::parse([
            "--reduce".to_string(),
            "--write-reduced".to_string(),
            "reduced.json".to_string(),
            "--write-report".to_string(),
            "report.json".to_string(),
            "case.json".to_string(),
        ])
        .expect("args parse");
        assert!(args.reduce);
        assert_eq!(args.write_reduced_path.as_deref(), Some("reduced.json"));
        assert_eq!(args.write_report_path.as_deref(), Some("report.json"));
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
            votes: Vec::new(),
            ita_session_controls: Vec::new(),
            actions: vec![
                FixtureAction {
                    actor_slot: "slot_1".to_string(),
                    template_id: "doctor_protect".to_string(),
                    action_id: "protect".to_string(),
                    targets: vec!["slot_2".to_string()],
                    grant_id: None,
                },
                FixtureAction {
                    actor_slot: "slot_2".to_string(),
                    template_id: "factional_kill".to_string(),
                    action_id: "kill".to_string(),
                    targets: vec!["slot_1".to_string()],
                    grant_id: None,
                },
            ],
            setup_phases: Vec::new(),
            host_prompt_decision: None,
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
    fn setup_phase_fixture_prunes_dependent_actions() {
        let mut fixture: NightFixture = serde_json::from_str(
            r#"{
              "seed": 2,
              "phase": "N02",
              "roster": [
                {"slot": "slot_1", "role": "hunter"},
                {"slot": "slot_2", "role": "mafia_goon"},
                {"slot": "slot_3", "role": "mafia_goon"}
              ],
              "setup_phases": [{
                "phase": "N01",
                "seed": 1,
                "actions": [{
                  "actor_slot": "slot_1",
                  "template_id": "hunter_retaliate",
                  "action_id": "hunt_n01",
                  "targets": ["slot_2"]
                }]
              }],
              "actions": [{
                "actor_slot": "slot_3",
                "template_id": "factional_kill",
                "action_id": "kill_hunter_n02",
                "targets": ["slot_1"]
              }]
            }"#,
        )
        .expect("setup phase fixture parses");
        assert_eq!(fixture.setup_phases.len(), 1);
        assert_eq!(fixture_action_len(&fixture), 2);

        prune_slot_references(&mut fixture, "slot_2");
        assert!(fixture.setup_phases[0].actions.is_empty());
        assert_eq!(fixture.actions.len(), 1);
        assert_eq!(fixture_action_len(&fixture), 1);
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

        let pgo: NightFixture = serde_json::from_str(include_str!(
            "../../fixtures/night-pgo-trigger-minimized.json"
        ))
        .expect("pgo fixture parses");
        assert_eq!(pgo.expectations.inner_events.len(), 2);
        assert_eq!(pgo.expectations.trace_notes.len(), 1);
        assert_eq!(pgo.expectations.generated_actions.len(), 1);
        assert_eq!(pgo.expectations.count(), 4);

        let pgo_nonminimal: NightFixture = serde_json::from_str(include_str!(
            "../../fixtures/night-pgo-trigger-nonminimal.json"
        ))
        .expect("nonminimal pgo fixture parses");
        assert_eq!(pgo_nonminimal.roster.len(), 3);
        assert_eq!(pgo_nonminimal.expectations.count(), 4);

        let babysitter_nonminimal: NightFixture = serde_json::from_str(include_str!(
            "../../fixtures/night-babysitter-dependency-nonminimal.json"
        ))
        .expect("nonminimal babysitter fixture parses");
        assert_eq!(babysitter_nonminimal.roster.len(), 5);
        assert_eq!(babysitter_nonminimal.expectations.count(), 3);

        let hider_nonminimal: NightFixture = serde_json::from_str(include_str!(
            "../../fixtures/night-hider-dependency-nonminimal.json"
        ))
        .expect("nonminimal hider fixture parses");
        assert_eq!(hider_nonminimal.roster.len(), 4);
        assert_eq!(hider_nonminimal.expectations.count(), 3);

        let pgo_bad_expectation: NightFixture = serde_json::from_str(include_str!(
            "../../fixtures/night-pgo-trigger-bad-expectation.json"
        ))
        .expect("bad-expectation pgo fixture parses");
        assert_eq!(pgo_bad_expectation.roster.len(), 3);
        assert_eq!(pgo_bad_expectation.expectations.count(), 4);
    }

    #[test]
    fn reduction_target_preserves_success_expectations() {
        let fixture = NightFixture {
            seed: 1,
            pack: default_pack(),
            phase: default_phase(),
            roster: Vec::new(),
            votes: Vec::new(),
            ita_session_controls: Vec::new(),
            actions: Vec::new(),
            setup_phases: Vec::new(),
            host_prompt_decision: None,
            expectations: FixtureExpectations {
                inner_events: vec![ExpectedInnerEvent {
                    kind: "Trigger".to_string(),
                    payload: BTreeMap::new(),
                }],
                stream_events: Vec::new(),
                trace_decisions: Vec::new(),
                trace_notes: Vec::new(),
                generated_actions: Vec::new(),
                delayed_death_queues: Vec::new(),
                absent_delayed_death_queues: Vec::new(),
                slot_effects: Vec::new(),
                absent_slot_effects: Vec::new(),
                player_notifications: Vec::new(),
                sheriff_badges: Vec::new(),
            },
        };
        let report = RunReport {
            ok: true,
            failure_class: None,
            reason: None,
            game_id: None,
            resolution_audited: Some(1),
            trace_count: Some(1),
            projection_audit_ok: Some(true),
            semantic_expectations_checked: 1,
        };
        let target =
            ReductionTarget::from_report(&fixture, &report).expect("success target exists");
        assert!(target.is_preserved_by(&report));

        let missing_expectation_report = RunReport {
            semantic_expectations_checked: 0,
            ..report.clone()
        };
        assert!(!target.is_preserved_by(&missing_expectation_report));

        let failed_report = RunReport {
            ok: false,
            failure_class: Some(FailureClass::SemanticExpectation),
            reason: Some("missing expected Trigger".to_string()),
            ..report
        };
        assert!(!target.is_preserved_by(&failed_report));
    }

    #[test]
    fn write_reduced_report_does_not_bless_semantic_expectation_failure() {
        let target = ReductionTarget::FailureClass(Some(FailureClass::SemanticExpectation));
        let minimized = RunReport {
            ok: false,
            failure_class: Some(FailureClass::SemanticExpectation),
            reason: Some("missing expected Trigger".to_string()),
            game_id: None,
            resolution_audited: Some(1),
            trace_count: Some(1),
            projection_audit_ok: None,
            semantic_expectations_checked: 0,
        };

        let reduction = ReductionReport::new(Some(target), &minimized);
        assert!(!reduction.replay_success);
        assert_eq!(reduction.failure_class_preserved, Some(true));
        assert_eq!(reduction.success_invariant_preserved, None);

        let write_reduced = WriteReducedReport::new("reduced.json", &reduction);
        assert!(write_reduced.wrote);
        assert!(!write_reduced.promoted_success_fixture);
    }
}
