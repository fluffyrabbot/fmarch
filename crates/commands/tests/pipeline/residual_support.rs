// Shared residual command-test support. Included by the ordinary pipeline and semantic audit targets.

// Residual pipeline test body (included by tests/pipeline/residual.rs).
// Shared harness: tests/pipeline/common.rs. Day family: tests/pipeline/day_events.rs.

use caps::Principal;
use commands::{
    audit_engine_snapshot_identity_boundary, audit_resolution_envelopes, inspect_resolution_traces,
    load_engine_phase_input, load_engine_snapshot, run_large_action_graph_performance_proof, Ack,
    CohostPermissionClass, Command, EngineInputBuilder, EngineRunKind, HostPromptDecision, Reject,
    ResolutionEnvelopeAuditEnvelope, ResolutionEnvelopeAuditStatus, VoteTarget,
    LARGE_ACTION_GRAPH_PERFORMANCE_SEED, LARGE_ACTION_GRAPH_PERFORMANCE_THRESHOLD_MS,
};
use eventstore::{ActorId, EventInput};
use projections::{
    action_counters, action_grants, action_history, audit_rebuild, day_vote_outcomes,
    delayed_death_queues, game_result, host_prompts, investigation_memory, phase_state,
    player_info_results, player_notifications, player_notifications_for_slot, rebuild,
    sheriff_badges, slot_effects, slot_state, visit_history, votecount,
};
use sqlx::{PgPool, Row};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use uuid::Uuid;

#[derive(Debug)]
struct InProcessCommandOutput {
    status: InProcessCommandStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

#[derive(Debug, Clone, Copy)]
struct InProcessCommandStatus(bool);

impl InProcessCommandStatus {
    fn success(self) -> bool {
        self.0
    }
}

async fn seed_open_night_game_with_pack(
    pool: &PgPool,
    game: Uuid,
    host_id: &str,
    pack: &str,
    slot_1_role: (&str, &str),
    slot_2_role: (&str, &str),
) -> Result<Vec<eventstore::StoredEvent>, projections::ProjectionError> {
    let pack_artifact = content_registry::select_pack_artifact(pack)
        .unwrap_or_else(|error| panic!("embedded test pack {pack} has no artifact: {error}"));
    seed_open_night_game_with_pack_artifact(
        pool,
        game,
        host_id,
        &pack_artifact,
        slot_1_role,
        slot_2_role,
    )
    .await
}

async fn reject_game_creation_with_invalid_pack(
    pool: &PgPool,
    game: Uuid,
    host_id: &str,
    pack: &str,
) -> Reject {
    let err = handle(
        pool,
        &user(host_id),
        Command::CreateGame {
            game,
            pack: pack.to_string(),
            cohost_denied: vec![],
        },
    )
    .await
    .expect_err("invalid pack must reject at game creation");

    assert_eq!(
        stored_event_count(pool, game).await,
        0,
        "invalid pack must not append GameCreated or any other event"
    );
    assert!(
        projections::game_pack_artifact(pool, game)
            .await
            .expect("load rejected game's pack custody")
            .is_none(),
        "invalid pack must not install game-scoped artifact custody"
    );
    err
}

async fn seed_open_night_game_with_pack_artifact(
    pool: &PgPool,
    game: Uuid,
    host_id: &str,
    pack_artifact: &content_registry::PackArtifactSnapshot,
    slot_1_role: (&str, &str),
    slot_2_role: (&str, &str),
) -> Result<Vec<eventstore::StoredEvent>, projections::ProjectionError> {
    // Project the game creation first. This preserves the pack-custody failure
    // contract (a drifted artifact leaves neither game events nor orphaned
    // persona claims), then prepares persona claims through the production
    // application boundary before their canonical events are appended.
    append_and_project(
        pool,
        game,
        &[EventInput::new(
            "GameCreated",
            1,
            serde_json::json!({
                "host": host_id,
                "pack_ref": &pack_artifact.pack_ref,
                "pack_artifact": pack_artifact
            }),
            ActorId::Principal(host_id.to_string()),
            0,
        )],
    )
    .await?;

    ensure_test_principals(pool, ["user_1", "user_2"]).await;
    let first_persona = game_platform::GamePersonaId::from_uuid(Uuid::from_u128(1));
    let second_persona = game_platform::GamePersonaId::from_uuid(Uuid::from_u128(2));
    let (first_registered, second_registered) = {
        let mut tx = pool.begin().await.expect("begin canonical persona fixture");
        let first_registered = game_persona_application::register(
            &mut tx,
            game,
            first_persona,
            &game_platform::PrincipalId::new("user_1").expect("fixture principal"),
            game_platform::GamePersonaPresentation {
                public_name: game_platform::GamePersonaName::new("Player One")
                    .expect("fixture persona name"),
            },
            ActorId::Host,
            3,
        )
        .await
        .expect("prepare first canonical persona event");
        let second_registered = game_persona_application::register(
            &mut tx,
            game,
            second_persona,
            &game_platform::PrincipalId::new("user_2").expect("fixture principal"),
            game_platform::GamePersonaPresentation {
                public_name: game_platform::GamePersonaName::new("Player Two")
                    .expect("fixture persona name"),
            },
            ActorId::Host,
            5,
        )
        .await
        .expect("prepare second canonical persona event");
        tx.commit()
            .await
            .expect("commit canonical persona fixture claims");
        (first_registered, second_registered)
    };

    append_and_project(
        pool,
        game,
        &[
            EventInput::new(
                "SlotAdded",
                1,
                serde_json::json!({ "slot_id": "slot_1" }),
                ActorId::Host,
                1,
            ),
            EventInput::new(
                "SlotAdded",
                1,
                serde_json::json!({ "slot_id": "slot_2" }),
                ActorId::Host,
                2,
            ),
            first_registered,
            EventInput::new("SlotOccupancyStarted", 1, serde_json::json!({
                "transition_id": game_platform::OccupancyTransitionId::from_uuid(Uuid::from_u128(11)),
                "occupancy_id": game_platform::OccupancyId::from_uuid(Uuid::from_u128(21)),
                "slot_id": "slot_1",
                "persona_id": first_persona,
                "reason": "initial"
            }), ActorId::Host, 4),
            second_registered,
            EventInput::new("SlotOccupancyStarted", 1, serde_json::json!({
                "transition_id": game_platform::OccupancyTransitionId::from_uuid(Uuid::from_u128(12)),
                "occupancy_id": game_platform::OccupancyId::from_uuid(Uuid::from_u128(22)),
                "slot_id": "slot_2",
                "persona_id": second_persona,
                "reason": "initial"
            }), ActorId::Host, 6),
            EventInput::new(
                "RoleAssigned",
                1,
                serde_json::json!({
                    "slot_id": "slot_1",
                    "role_key": slot_1_role.0,
                    "alignment": slot_1_role.1,
                    "role_effects": []
                }),
                ActorId::Host,
                5,
            ),
            EventInput::new(
                "RoleAssigned",
                1,
                serde_json::json!({
                    "slot_id": "slot_2",
                    "role_key": slot_2_role.0,
                    "alignment": slot_2_role.1,
                    "role_effects": []
                }),
                ActorId::Host,
                6,
            ),
            EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({ "phase_id": "N01" }),
                ActorId::Host,
                7,
            ),
        ],
    )
    .await
}

#[derive(Debug, Clone)]
struct DeterministicRng(u64);

impl DeterministicRng {
    fn new(seed: u64) -> Self {
        DeterministicRng(seed)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15);
        let mut value = self.0;
        value = (value ^ (value >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94D049BB133111EB);
        value ^ (value >> 31)
    }

    fn index(&mut self, len: usize) -> usize {
        (self.next_u64() as usize) % len
    }
}

// ───────────────────────── THE CENTERPIECE ─────────────────────────

// ───────────────────────── capability enforcement ─────────────────────────

async fn setup_resolved_audit_drift_game(pool: &PgPool, user_prefix: &str, seed: u64) -> Uuid {
    let game = setup_audit_resolution_inputs(pool, user_prefix).await;
    handle(
        pool,
        &user(&format!("{user_prefix}_host")),
        Command::ResolvePhase { game, seed },
    )
    .await
    .expect("host resolves audit drift setup phase");
    game
}

async fn setup_audit_resolution_inputs(pool: &PgPool, user_prefix: &str) -> Uuid {
    let host = format!("{user_prefix}_host");
    let game = Uuid::new_v4();
    let h = user(&host);

    handle(
        pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", format!("{user_prefix}_user_1"), "vanilla_townie"),
        ("slot_2", format!("{user_prefix}_user_2"), "vanilla_townie"),
        ("slot_3", format!("{user_prefix}_user_3"), "mafia_goon"),
    ] {
        handle(
            pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            pool,
            &h,
            commands::seat_persona! {
                game,
                slot: slot.into(),
                user: occupant,
            },
        )
        .await
        .unwrap();
        handle(
            pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();
    for (user_id, actor_slot) in [
        (format!("{user_prefix}_user_1"), "slot_1"),
        (format!("{user_prefix}_user_2"), "slot_2"),
    ] {
        handle(
            pool,
            &user(&user_id),
            Command::SubmitVote {
                game,
                actor_slot: actor_slot.into(),
                target: VoteTarget::Slot("slot_3".into()),
            },
        )
        .await
        .unwrap();
    }
    game
}

#[derive(Clone, Copy)]
enum AuditResolutionMutation<'a> {
    AppliedWinner(&'a str),
    TraceOutcome(&'a str),
    MissingTrace,
}

struct AuditResolutionFixture {
    game: Uuid,
    winner_event: Option<(usize, String)>,
    first_trace_outcome: Option<String>,
}

async fn setup_mutated_audit_resolution(
    pool: &PgPool,
    user_prefix: &str,
    seed: u64,
    mutation: AuditResolutionMutation<'_>,
) -> AuditResolutionFixture {
    let game = setup_audit_resolution_inputs(pool, user_prefix).await;
    let stream = stored_events(pool, game).await;
    let phase_input = EngineInputBuilder::new(game, &stream, "D01")
        .build()
        .expect("build audit fixture resolver input");
    let output = domain::resolve(phase_input.resolve_input(EngineRunKind::ResolvePhase { seed }));
    let mut applied_payload = serde_json::to_value(&output.applied).unwrap();
    let mut trace_payload = serde_json::to_value(&output.trace).unwrap();

    let applied = domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION)
        .expect("generated ResolutionApplied validates");
    let winner_event =
        applied
            .events
            .iter()
            .enumerate()
            .find_map(|(index, indexed)| match &indexed.event {
                domain::InnerEvent::WinReached { winner, .. } => Some((index, winner.clone())),
                _ => None,
            });
    let trace = domain::validate_trace_json(&trace_payload, domain::TRACE_VERSION)
        .expect("generated ResolutionTrace validates");
    let first_trace_outcome = trace
        .decisions
        .first()
        .map(|decision| decision.outcome.clone());

    match mutation {
        AuditResolutionMutation::AppliedWinner(winner) => {
            let (index, _) = winner_event
                .as_ref()
                .expect("fixture ResolutionApplied contains WinReached");
            applied_payload["events"][*index]["payload"]["winner"] =
                serde_json::Value::String(winner.to_owned());
        }
        AuditResolutionMutation::TraceOutcome(outcome) => {
            trace_payload["decisions"][0]["outcome"] =
                serde_json::Value::String(outcome.to_owned());
        }
        AuditResolutionMutation::MissingTrace => {}
    }

    let mut events = vec![EventInput::new(
        "ResolutionApplied",
        1,
        applied_payload,
        ActorId::System,
        phase_input.next_stream_seq,
    )];
    if !matches!(mutation, AuditResolutionMutation::MissingTrace) {
        events.push(EventInput::new(
            "ResolutionTrace",
            1,
            trace_payload,
            ActorId::System,
            phase_input.next_stream_seq,
        ));
    }
    events.push(EventInput::new(
        "ThreadLocked",
        1,
        serde_json::json!({
            "channel_id": "main",
            "phase_id": "D01",
            "reason": "phase_resolved",
            "source": "audit_fixture",
        }),
        ActorId::System,
        phase_input.next_stream_seq,
    ));
    append_and_project(pool, game, &events)
        .await
        .expect("append sealed audit fixture envelopes");

    AuditResolutionFixture {
        game,
        winner_event,
        first_trace_outcome,
    }
}

async fn run_audit_resolution_in_process(pool: &PgPool, game: Uuid) -> InProcessCommandOutput {
    let report = audit_resolution_envelopes(pool, game)
        .await
        .expect("run resolution audit in process");
    let ok = report.ok;
    in_process_command_output(report, ok, "resolution envelope audit found drift", None)
}

async fn run_audit_resolution_diff_artifact_in_process(
    pool: &PgPool,
    game: Uuid,
    output_path: &Path,
) -> InProcessCommandOutput {
    let audit = audit_resolution_envelopes(pool, game)
        .await
        .expect("run resolution diff audit in process");
    let report =
        operator_proof::build_operator_resolution_diff_report(output_path.to_string_lossy(), audit);
    let ok = report.ok;
    in_process_command_output(
        report,
        ok,
        "resolution diff artifact found drift",
        Some(output_path),
    )
}

async fn run_audit_trace_inspection_artifact_in_process(
    pool: &PgPool,
    game: Uuid,
    run_id: Option<&str>,
    output_path: &Path,
) -> InProcessCommandOutput {
    let inspection = inspect_resolution_traces(pool, game, run_id)
        .await
        .expect("inspect resolution traces in process");
    let report = operator_proof::build_operator_trace_inspection_report(
        output_path.to_string_lossy(),
        inspection,
    );
    let ok = report.ok;
    in_process_command_output(
        report,
        ok,
        "trace inspection artifact found no stored traces",
        Some(output_path),
    )
}

async fn run_audit_projection_rebuild_artifact_in_process(
    pool: &PgPool,
    game: Uuid,
    output_path: &Path,
) -> InProcessCommandOutput {
    let projection_report = audit_rebuild(pool, game)
        .await
        .expect("audit projection rebuild in process");
    let report = operator_proof::build_operator_projection_rebuild_audit_report(
        output_path.to_string_lossy(),
        projection_report,
    );
    let ok = report.ok;
    in_process_command_output(
        report,
        ok,
        "projection rebuild artifact audit found drift",
        Some(output_path),
    )
}

async fn run_audit_large_action_graph_performance_artifact_in_process(
    pool: &PgPool,
    output_path: &Path,
    threshold_ms: Option<u64>,
) -> InProcessCommandOutput {
    let generated_users: Vec<_> = (1..=40)
        .map(|slot| format!("large_graph_user_{slot}"))
        .collect();
    ensure_test_principals(
        pool,
        std::iter::once("host_h").chain(generated_users.iter().map(String::as_str)),
    )
    .await;
    let proof = run_large_action_graph_performance_proof(
        pool,
        Uuid::new_v4(),
        LARGE_ACTION_GRAPH_PERFORMANCE_SEED,
        Duration::from_millis(threshold_ms.unwrap_or(LARGE_ACTION_GRAPH_PERFORMANCE_THRESHOLD_MS)),
    )
    .await
    .expect("run large action graph proof in process");
    let report = operator_proof::build_operator_large_action_graph_performance_report(
        output_path.to_string_lossy(),
        proof,
    );
    let ok = report.ok;
    in_process_command_output(
        report,
        ok,
        "large action graph performance artifact failed its ceiling or audits",
        Some(output_path),
    )
}

fn run_audit_determinism_fuzz_artifact_in_process(
    output_path: &Path,
    test_filter: Option<&str>,
) -> InProcessCommandOutput {
    let test_filter = test_filter.unwrap_or("replay_audit_and_rebuild_deterministically");
    let output = if test_filter == "replay_audit_and_rebuild_deterministically" {
        operator_proof::determinism_fuzz_family_specs()
            .into_iter()
            .map(|family| format!("test {} ... ok", family.selector))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        String::new()
    };
    let command = format!(
        "RUST_MIN_STACK=8388608 cargo test -p commands --test pipeline {test_filter} -- --ignored --nocapture"
    );
    let report = operator_proof::build_operator_determinism_fuzz_report(
        output_path.to_string_lossy(),
        command,
        test_filter,
        1,
        true,
        &output,
    );
    let ok = report.ok;
    in_process_command_output(
        report,
        ok,
        "determinism fuzz artifact found failed or missing seeded families",
        Some(output_path),
    )
}

fn in_process_command_output(
    report: impl serde::Serialize,
    ok: bool,
    failure_message: &str,
    output_path: Option<&Path>,
) -> InProcessCommandOutput {
    let json = serde_json::to_vec_pretty(&report).expect("in-process command report serializes");
    if let Some(output_path) = output_path {
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).expect("create in-process command artifact directory");
        }
        fs::write(output_path, &json).expect("write in-process command artifact");
    }
    InProcessCommandOutput {
        status: InProcessCommandStatus(ok),
        stdout: json,
        stderr: if ok {
            Vec::new()
        } else {
            failure_message.as_bytes().to_vec()
        },
    }
}

async fn tamper_live_slot_state_role(pool: &PgPool, game: Uuid, slot: &str, role_key: &str) {
    let game_text = game.to_string();
    let context = format!("fmarch-projection-v1:slot_state:{game_text}:{slot}");
    let envelope: serde_json::Value =
        sqlx::query_scalar("SELECT private FROM slot_state WHERE game_id = $1 AND slot_id = $2")
            .bind(game)
            .bind(slot)
            .fetch_one(pool)
            .await
            .expect("read encrypted live slot state before tamper");
    let mut plaintext = eventstore::decrypt_private_projection(&envelope, &context)
        .expect("open live slot state before tamper");
    plaintext["role_key"] = serde_json::json!(role_key);
    let mut tx = pool.begin().await.expect("begin slot-state tamper");
    let private = eventstore::encrypt_private_projection(&mut tx, plaintext, &context)
        .await
        .expect("seal tampered slot state");
    let update =
        sqlx::query("UPDATE slot_state SET private = $3 WHERE game_id = $1 AND slot_id = $2")
            .bind(game)
            .bind(slot)
            .bind(private)
            .execute(&mut *tx)
            .await
            .expect("tamper live slot_state role");
    tx.commit().await.expect("commit slot-state tamper");
    assert_eq!(update.rows_affected(), 1, "one slot_state row tampered");
}

fn test_operator_proof_artifact_path(label: &str, game: Uuid) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("commands crate lives under crates/commands")
        .join("target/operator-proof")
        .join(format!("test-{label}-{game}.json"))
}

// Derived minimized, nonminimal, and bad-expectation fixture replays were removed.
// The generated audit cases below synthesize the same semantic families and reduce them
// through the in-process minimizer, so no checked-in fixture cross-product can drift.

const GENERATED_SHRINK_MATRIX_WORKERS: usize = 8;
const GENERATED_SHRINK_MATRIX_WORKER_STACK_BYTES: usize = 8 * 1024 * 1024;
const FOLDED_MINIMIZER_WITNESS_CASES: usize = 18;

#[derive(Debug)]
struct FoldedMinimizerCase {
    stem: String,
    fixture_json: String,
    min_expectations: usize,
    expected_audited: i64,
    expected_traces: i64,
    expected_setup_phases: Option<usize>,
    require_projection_audit: bool,
}

#[derive(Debug)]
struct GeneratedShrinkMatrixCase {
    family: String,
    seed: u64,
    success_fixture_json: String,
    bad_fixture_json: String,
}

#[derive(Debug)]
struct GeneratedShrinkMatrixEntry {
    family: String,
    seed: u64,
    report: serde_json::Value,
}

async fn run_generated_shrink_matrix_case(
    pool: &PgPool,
    case: GeneratedShrinkMatrixCase,
) -> GeneratedShrinkMatrixEntry {
    let GeneratedShrinkMatrixCase {
        family,
        seed,
        success_fixture_json,
        bad_fixture_json,
    } = case;
    let success_fixture: serde_json::Value =
        serde_json::from_str(&success_fixture_json).expect("matrix success fixture parses");
    let expectation_count = generated_expectation_count(&success_fixture["expectations"]);
    assert!(
        expectation_count > 0,
        "{family} seed {seed} should carry semantic expectations"
    );

    let success_artifacts =
        GeneratedShrinkArtifacts::new(&format!("generated-shrink-matrix-{family}-{seed}-ok"));
    success_artifacts.remove_existing();
    success_artifacts.write_fixture(&success_fixture_json);
    let success_report = success_artifacts
        .run_minimizer_with_preprovisioned_principals(pool)
        .await;
    assert_eq!(
        success_report["original"]["ok"], true,
        "{family} seed {seed} success original"
    );
    assert_eq!(
        success_report["original"]["semantic_expectations_checked"],
        serde_json::json!(expectation_count),
        "{family} seed {seed} success expectation count"
    );
    assert_eq!(
        success_report["reduction"]["success_invariant_preserved"],
        serde_json::json!(true),
        "{family} seed {seed} success invariant"
    );
    assert_eq!(
        success_report["write_reduced"]["promoted_success_fixture"],
        serde_json::json!(true),
        "{family} seed {seed} success promotion"
    );

    let bad_artifacts =
        GeneratedShrinkArtifacts::new(&format!("generated-shrink-matrix-{family}-{seed}-bad"));
    bad_artifacts.remove_existing();
    bad_artifacts.write_fixture(&bad_fixture_json);
    let bad_report = bad_artifacts
        .run_minimizer_with_preprovisioned_principals(pool)
        .await;
    assert_eq!(
        bad_report["original"]["ok"], false,
        "{family} seed {seed} bad original"
    );
    assert_eq!(
        bad_report["original"]["failure_class"], "semantic_expectation",
        "{family} seed {seed} bad failure class"
    );
    assert_eq!(
        bad_report["reduction"]["failure_class_preserved"],
        serde_json::json!(true),
        "{family} seed {seed} bad failure preservation"
    );
    assert_eq!(
        bad_report["write_reduced"]["promoted_success_fixture"],
        serde_json::json!(false),
        "{family} seed {seed} bad non-promotion"
    );

    let report = serde_json::json!({
        "family": family,
        "seed": seed,
        "expectation_count": expectation_count,
        "success": {
            "ok": success_report["original"]["ok"],
            "success_invariant_preserved": success_report["reduction"]["success_invariant_preserved"],
            "promoted_success_fixture": success_report["write_reduced"]["promoted_success_fixture"],
            "reduction_steps": success_report["reduction_steps"].as_array().map_or(0, Vec::len),
            "report_path": success_artifacts.report_path.display().to_string(),
            "reduced_path": success_artifacts.reduced_path.display().to_string(),
        },
        "bad_expectation": {
            "ok": bad_report["original"]["ok"],
            "failure_class": bad_report["original"]["failure_class"],
            "failure_class_preserved": bad_report["reduction"]["failure_class_preserved"],
            "promoted_success_fixture": bad_report["write_reduced"]["promoted_success_fixture"],
            "reduction_steps": bad_report["reduction_steps"].as_array().map_or(0, Vec::len),
            "report_path": bad_artifacts.report_path.display().to_string(),
            "reduced_path": bad_artifacts.reduced_path.display().to_string(),
        }
    });
    GeneratedShrinkMatrixEntry {
        family,
        seed,
        report,
    }
}

fn run_generated_shrink_matrix_cases(
    connect_options: sqlx::postgres::PgConnectOptions,
    cases: Vec<GeneratedShrinkMatrixCase>,
) -> Vec<GeneratedShrinkMatrixEntry> {
    assert_eq!(cases.len(), 58, "generated shrink matrix case manifest");
    let queue = std::sync::Arc::new(std::sync::Mutex::new(std::collections::VecDeque::from(
        cases,
    )));
    let mut entries = std::thread::scope(|scope| {
        let mut workers = Vec::with_capacity(GENERATED_SHRINK_MATRIX_WORKERS);
        for worker_index in 0..GENERATED_SHRINK_MATRIX_WORKERS {
            let queue = std::sync::Arc::clone(&queue);
            let connect_options = connect_options.clone();
            workers.push(
                std::thread::Builder::new()
                    .name(format!("generated-shrink-matrix-{worker_index}"))
                    .stack_size(GENERATED_SHRINK_MATRIX_WORKER_STACK_BYTES)
                    .spawn_scoped(scope, move || {
                        let runtime = tokio::runtime::Builder::new_current_thread()
                            .enable_all()
                            .build()
                            .expect("generated shrink worker runtime");
                        runtime.block_on(async move {
                            let pool = sqlx::postgres::PgPoolOptions::new()
                                .max_connections(1)
                                .connect_with(connect_options)
                                .await
                                .expect("generated shrink worker database connection");
                            let mut entries = Vec::new();
                            loop {
                                let next = queue
                                    .lock()
                                    .expect("generated shrink case queue")
                                    .pop_front();
                                let Some(case) = next else {
                                    break;
                                };
                                entries.push(run_generated_shrink_matrix_case(&pool, case).await);
                            }
                            pool.close().await;
                            entries
                        })
                    })
                    .expect("spawn generated shrink worker"),
            );
        }
        workers
            .into_iter()
            .flat_map(|worker| worker.join().expect("generated shrink worker failed"))
            .collect::<Vec<_>>()
    });
    entries.sort_by(|left, right| {
        left.family
            .cmp(&right.family)
            .then_with(|| left.seed.cmp(&right.seed))
    });
    entries
}

async fn run_folded_minimizer_case(pool: &PgPool, case: FoldedMinimizerCase) -> String {
    let FoldedMinimizerCase {
        stem,
        fixture_json,
        min_expectations,
        expected_audited,
        expected_traces,
        expected_setup_phases,
        require_projection_audit,
    } = case;
    let fixture: serde_json::Value = serde_json::from_str(&fixture_json)
        .unwrap_or_else(|err| panic!("{stem} fixture parses: {err}"));
    if let Some(expected_setup_phases) = expected_setup_phases {
        assert_eq!(
            fixture["setup_phases"].as_array().map_or(0, Vec::len),
            expected_setup_phases,
            "{stem} should seed the expected folded setup phases"
        );
    }
    let expectation_count = generated_expectation_count(&fixture["expectations"]);
    assert!(
        expectation_count >= min_expectations,
        "{stem} should preserve semantic expectations"
    );

    let artifacts = GeneratedShrinkArtifacts::new(&stem);
    artifacts.remove_existing();
    artifacts.write_fixture(&fixture_json);
    let report = artifacts
        .run_minimizer_with_preprovisioned_principals(pool)
        .await;
    assert_eq!(report["original"]["ok"], true, "{stem} original replay");
    assert_eq!(
        report["original"]["resolution_audited"],
        serde_json::json!(expected_audited),
        "{stem} audited envelope count"
    );
    assert_eq!(
        report["original"]["trace_count"],
        serde_json::json!(expected_traces),
        "{stem} trace count"
    );
    if require_projection_audit {
        assert_eq!(
            report["original"]["projection_audit_ok"],
            serde_json::json!(true),
            "{stem} projection audit"
        );
    }
    assert_eq!(
        report["original"]["semantic_expectations_checked"],
        serde_json::json!(expectation_count),
        "{stem} semantic expectation count"
    );
    assert_eq!(
        report["reduction"]["replay_success"], true,
        "{stem} reduction replay"
    );
    assert_eq!(
        report["write_reduced"]["promoted_success_fixture"], true,
        "{stem} promotion"
    );
    stem
}

fn run_folded_minimizer_cases(
    connect_options: sqlx::postgres::PgConnectOptions,
    cases: Vec<FoldedMinimizerCase>,
) -> Vec<String> {
    assert_eq!(
        cases.len(),
        FOLDED_MINIMIZER_WITNESS_CASES,
        "folded minimizer witness case manifest"
    );
    let queue = std::sync::Arc::new(std::sync::Mutex::new(std::collections::VecDeque::from(
        cases,
    )));
    let mut stems = std::thread::scope(|scope| {
        let mut workers = Vec::with_capacity(GENERATED_SHRINK_MATRIX_WORKERS);
        for worker_index in 0..GENERATED_SHRINK_MATRIX_WORKERS {
            let queue = std::sync::Arc::clone(&queue);
            let connect_options = connect_options.clone();
            workers.push(
                std::thread::Builder::new()
                    .name(format!("folded-minimizer-witness-{worker_index}"))
                    .stack_size(GENERATED_SHRINK_MATRIX_WORKER_STACK_BYTES)
                    .spawn_scoped(scope, move || {
                        let runtime = tokio::runtime::Builder::new_current_thread()
                            .enable_all()
                            .build()
                            .expect("folded minimizer worker runtime");
                        runtime.block_on(async move {
                            let pool = sqlx::postgres::PgPoolOptions::new()
                                .max_connections(1)
                                .connect_with(connect_options)
                                .await
                                .expect("folded minimizer worker database connection");
                            let mut stems = Vec::new();
                            loop {
                                let next = queue
                                    .lock()
                                    .expect("folded minimizer case queue")
                                    .pop_front();
                                let Some(case) = next else {
                                    break;
                                };
                                stems.push(run_folded_minimizer_case(&pool, case).await);
                            }
                            pool.close().await;
                            stems
                        })
                    })
                    .expect("spawn folded minimizer worker"),
            );
        }
        workers
            .into_iter()
            .flat_map(|worker| worker.join().expect("folded minimizer worker failed"))
            .collect::<Vec<_>>()
    });
    stems.sort();
    stems
}

#[derive(Debug, Clone)]
struct GeneratedNightAction {
    actor_slot: String,
    template_id: String,
    action_id: String,
    targets: Vec<String>,
}

#[derive(Debug, Clone)]
struct GeneratedNightCase {
    seed: u64,
    roster: Vec<(String, String)>,
    actions: Vec<GeneratedNightAction>,
}

#[derive(Debug, Clone)]
struct GeneratedTriggerDependencyFixture {
    seed: u64,
    case: GeneratedNightCase,
    fixture_json: String,
    expectation_count: usize,
}

#[derive(Debug, Clone)]
struct GeneratedVote {
    actor_slot: String,
    target_slot: String,
}

#[derive(Debug, Clone)]
struct GeneratedDefaultOpenDayCase {
    seed: u64,
    roster: Vec<(String, String)>,
    votes: Vec<GeneratedVote>,
    lynched_slot: String,
}

#[derive(Debug, Clone)]
struct GeneratedEpicmafiaPkCase {
    seed: u64,
    roster: Vec<(String, String)>,
    votes: Vec<GeneratedVote>,
    contenders: Vec<String>,
    selected_slot: String,
}

fn generated_night_case(seed: u64) -> GeneratedNightCase {
    let mut rng = DeterministicRng::new(seed);
    let mut role_templates = vec![
        ("doctor", "doctor_protect", TargetShape::One),
        ("bodyguard", "bodyguard", TargetShape::One),
        ("babysitter", "babysit", TargetShape::One),
        ("jailkeeper", "jail", TargetShape::One),
        ("roleblocker", "roleblocker_block", TargetShape::One),
        ("tracker", "track", TargetShape::One),
        ("watcher", "watch", TargetShape::One),
        ("motion_detector", "motion_detector", TargetShape::One),
        ("cop", "cop_investigate", TargetShape::One),
        ("bus_driver", "bus_driver_swap", TargetShape::Two),
        ("redirector", "redirect", TargetShape::Two),
        ("lightning_rod", "redirect", TargetShape::None),
        ("commuter", "commute", TargetShape::SelfOnly),
        ("hider", "hide", TargetShape::One),
        ("hunter", "hunter_retaliate", TargetShape::One),
        ("cupid", "link_lovers", TargetShape::Two),
        ("mafia_goon", "factional_kill", TargetShape::One),
        ("mafia_goon", "factional_kill", TargetShape::One),
        ("strongman", "strongman_kill", TargetShape::One),
        ("paranoid_gun_owner", "", TargetShape::None),
        ("vanilla_townie", "", TargetShape::None),
        ("vanilla_townie", "", TargetShape::None),
    ];
    for index in (1..role_templates.len()).rev() {
        let swap_with = rng.index(index + 1);
        role_templates.swap(index, swap_with);
    }

    let roster_len = 12 + rng.index(7);
    let mut roster = Vec::new();
    let mut picked = Vec::new();
    for (index, template) in role_templates.into_iter().take(roster_len).enumerate() {
        let slot = format!("slot_{}", index + 1);
        roster.push((slot, template.0.to_string()));
        picked.push((template.1.to_string(), template.2));
    }
    if !roster
        .iter()
        .any(|(_, role)| role == "mafia_goon" || role == "strongman")
    {
        let last = roster.len() - 1;
        roster[last].1 = "mafia_goon".to_string();
        picked[last] = ("factional_kill".to_string(), TargetShape::One);
    }

    let slots: Vec<String> = roster.iter().map(|(slot, _)| slot.clone()).collect();
    let mut actions = Vec::new();
    for ((slot, _role), (template_id, target_shape)) in roster.iter().zip(picked.iter()) {
        if template_id.is_empty() {
            continue;
        }
        let targets = generated_targets(&mut rng, &slots, slot, *target_shape);
        actions.push(GeneratedNightAction {
            actor_slot: slot.clone(),
            template_id: template_id.clone(),
            action_id: format!("generated_seed_{seed}_{}_{}", slot, template_id),
            targets,
        });
    }

    GeneratedNightCase {
        seed,
        roster,
        actions,
    }
}

fn generated_chinese_night_case(seed: u64) -> GeneratedNightCase {
    let mut rng = DeterministicRng::new(seed);
    let mut role_templates = vec![
        ("prophet", "investigate_alignment", TargetShape::One),
        ("guard", "night_guard", TargetShape::One),
        ("witch", "heal_potion", TargetShape::One),
        ("witch", "poison_potion", TargetShape::One),
        ("wolf_beauty", "beauty_mark", TargetShape::One),
        ("hunter", "hunter_retaliate", TargetShape::One),
        ("cupid", "link_lovers", TargetShape::Two),
        ("wolf", "wolf_night_kill", TargetShape::One),
        ("wolf", "wolf_night_kill", TargetShape::One),
        ("villager", "", TargetShape::None),
        ("idiot", "", TargetShape::None),
        ("villager", "", TargetShape::None),
        ("villager", "", TargetShape::None),
    ];
    for index in (1..role_templates.len()).rev() {
        let swap_with = rng.index(index + 1);
        role_templates.swap(index, swap_with);
    }

    let roster_len = 8 + rng.index(5);
    let mut roster = Vec::new();
    let mut picked = Vec::new();
    for (index, template) in role_templates.into_iter().take(roster_len).enumerate() {
        let slot = format!("slot_{}", index + 1);
        roster.push((slot, template.0.to_string()));
        picked.push((template.1.to_string(), template.2));
    }
    if !roster.iter().any(|(_, role)| role == "wolf") {
        let last = roster.len() - 1;
        roster[last].1 = "wolf".to_string();
        picked[last] = ("wolf_night_kill".to_string(), TargetShape::One);
    }

    let slots: Vec<String> = roster.iter().map(|(slot, _)| slot.clone()).collect();
    let mut actions = Vec::new();
    for ((slot, _role), (template_id, target_shape)) in roster.iter().zip(picked.iter()) {
        if template_id.is_empty() {
            continue;
        }
        let targets = generated_targets(&mut rng, &slots, slot, *target_shape);
        actions.push(GeneratedNightAction {
            actor_slot: slot.clone(),
            template_id: template_id.clone(),
            action_id: format!("chinese_generated_seed_{seed}_{}_{}", slot, template_id),
            targets,
        });
    }

    GeneratedNightCase {
        seed,
        roster,
        actions,
    }
}

fn generated_chinese_day_case(seed: u64) -> GeneratedNightCase {
    let mut rng = DeterministicRng::new(seed);
    let roster = vec![
        ("slot_1".to_string(), "sheriff_badge_helper".to_string()),
        ("slot_2".to_string(), "knight".to_string()),
        ("slot_3".to_string(), "white_wolf_king".to_string()),
        ("slot_4".to_string(), "wolf".to_string()),
        ("slot_5".to_string(), "villager".to_string()),
        ("slot_6".to_string(), "villager".to_string()),
        ("slot_7".to_string(), "villager".to_string()),
        ("slot_8".to_string(), "wolf".to_string()),
    ];
    let sheriff_target = pick_generated_slot(&mut rng, &["slot_1", "slot_5", "slot_6", "slot_7"]);
    let duel_target = pick_generated_slot(&mut rng, &["slot_4", "slot_5", "slot_8"]);
    let self_destruct_target =
        pick_generated_slot(&mut rng, &["slot_2", "slot_5", "slot_6", "slot_7"]);

    let actions = vec![
        GeneratedNightAction {
            actor_slot: "slot_1".to_string(),
            template_id: "sheriff_election".to_string(),
            action_id: format!("chinese_day_seed_{seed}_sheriff_election"),
            targets: vec![sheriff_target.to_string()],
        },
        GeneratedNightAction {
            actor_slot: "slot_2".to_string(),
            template_id: "knight_duel".to_string(),
            action_id: format!("chinese_day_seed_{seed}_knight_duel"),
            targets: vec![duel_target.to_string()],
        },
        GeneratedNightAction {
            actor_slot: "slot_3".to_string(),
            template_id: "day_self_destruct".to_string(),
            action_id: format!("chinese_day_seed_{seed}_day_self_destruct"),
            targets: vec![self_destruct_target.to_string()],
        },
    ];

    GeneratedNightCase {
        seed,
        roster,
        actions,
    }
}

fn generated_mafia_universe_ita_case(seed: u64) -> GeneratedNightCase {
    let mut rng = DeterministicRng::new(seed);
    let roster = vec![
        ("slot_1".to_string(), "town_ita_shooter".to_string()),
        ("slot_2".to_string(), "town_ita_shooter".to_string()),
        ("slot_3".to_string(), "town_ita_shooter".to_string()),
        ("slot_4".to_string(), "town_ita_shooter".to_string()),
        ("slot_5".to_string(), "town_vanilla".to_string()),
        ("slot_6".to_string(), "town_vanilla".to_string()),
        ("slot_7".to_string(), "mafia_goon".to_string()),
        ("slot_8".to_string(), "mafia_goon".to_string()),
    ];
    let mut targets = ["slot_5", "slot_6", "slot_7", "slot_8"];
    for index in (1..targets.len()).rev() {
        let swap_with = rng.index(index + 1);
        targets.swap(index, swap_with);
    }

    let actions = (1..=4)
        .map(|slot_number| GeneratedNightAction {
            actor_slot: format!("slot_{slot_number}"),
            template_id: "ita_shot".to_string(),
            action_id: format!("mafia_universe_ita_seed_{seed}_shot_{slot_number}"),
            targets: vec![targets[slot_number - 1].to_string()],
        })
        .collect();

    GeneratedNightCase {
        seed,
        roster,
        actions,
    }
}

fn generated_epicmafia_pk_case(seed: u64) -> GeneratedEpicmafiaPkCase {
    let mut rng = DeterministicRng::new(seed);
    let roster = vec![
        ("slot_1".to_string(), "villager".to_string()),
        ("slot_2".to_string(), "villager".to_string()),
        ("slot_3".to_string(), "villager".to_string()),
        ("slot_4".to_string(), "mafia_goon".to_string()),
        ("slot_5".to_string(), "mafia_goon".to_string()),
        ("slot_6".to_string(), "cult_leader".to_string()),
    ];
    let contender_pairs = [
        ("slot_2", "slot_4"),
        ("slot_2", "slot_5"),
        ("slot_3", "slot_4"),
        ("slot_3", "slot_5"),
    ];
    let (left, right) = contender_pairs[rng.index(contender_pairs.len())];
    let voters: Vec<_> = roster
        .iter()
        .map(|(slot, _)| slot.as_str())
        .filter(|slot| *slot != left && *slot != right)
        .collect();
    let votes = vec![
        GeneratedVote {
            actor_slot: voters[0].to_string(),
            target_slot: left.to_string(),
        },
        GeneratedVote {
            actor_slot: voters[1].to_string(),
            target_slot: left.to_string(),
        },
        GeneratedVote {
            actor_slot: voters[2].to_string(),
            target_slot: right.to_string(),
        },
        GeneratedVote {
            actor_slot: voters[3].to_string(),
            target_slot: right.to_string(),
        },
    ];
    let mut contenders = vec![left.to_string(), right.to_string()];
    contenders.sort();
    let selected_slot = contenders[rng.index(contenders.len())].clone();

    GeneratedEpicmafiaPkCase {
        seed,
        roster,
        votes,
        contenders,
        selected_slot,
    }
}

fn generated_epicmafia_night_case(seed: u64) -> GeneratedNightCase {
    let mut rng = DeterministicRng::new(seed);
    let roster = vec![
        ("slot_1".to_string(), "cult_leader".to_string()),
        ("slot_2".to_string(), "mafia_goon".to_string()),
        ("slot_3".to_string(), "bomb".to_string()),
        ("slot_4".to_string(), "villager".to_string()),
        ("slot_5".to_string(), "loyal_villager".to_string()),
        ("slot_6".to_string(), "mafia_goon".to_string()),
        ("slot_7".to_string(), "cult_leader".to_string()),
        ("slot_8".to_string(), "villager".to_string()),
        ("slot_9".to_string(), "villager".to_string()),
    ];
    let mut conversion_actions = vec![
        GeneratedNightAction {
            actor_slot: "slot_1".to_string(),
            template_id: "cult_recruit".to_string(),
            action_id: format!("epicmafia_night_seed_{seed}_cult_recruit_plain"),
            targets: vec!["slot_4".to_string()],
        },
        GeneratedNightAction {
            actor_slot: "slot_7".to_string(),
            template_id: "cult_recruit".to_string(),
            action_id: format!("epicmafia_night_seed_{seed}_cult_recruit_loyal"),
            targets: vec!["slot_5".to_string()],
        },
    ];
    if rng.index(2) == 1 {
        conversion_actions.swap(0, 1);
    }
    let killer = if rng.index(2) == 0 {
        "slot_2"
    } else {
        "slot_6"
    };
    let mut actions = vec![GeneratedNightAction {
        actor_slot: killer.to_string(),
        template_id: "factional_kill".to_string(),
        action_id: format!("epicmafia_night_seed_{seed}_bomb_kill"),
        targets: vec!["slot_3".to_string()],
    }];
    actions.extend(conversion_actions);

    GeneratedNightCase {
        seed,
        roster,
        actions,
    }
}

fn generated_default_open_night_case(seed: u64) -> GeneratedNightCase {
    let mut rng = DeterministicRng::new(seed);
    let roster = vec![
        ("slot_1".to_string(), "seer".to_string()),
        ("slot_2".to_string(), "guardian".to_string()),
        ("slot_3".to_string(), "citizen".to_string()),
        ("slot_4".to_string(), "agent".to_string()),
        ("slot_5".to_string(), "citizen".to_string()),
        ("slot_6".to_string(), "citizen".to_string()),
    ];
    let protected_target = pick_generated_slot(&mut rng, &["slot_3", "slot_5", "slot_6"]);

    let actions = vec![
        GeneratedNightAction {
            actor_slot: "slot_1".to_string(),
            template_id: "seer_check".to_string(),
            action_id: format!("default_open_seed_{seed}_seer_check"),
            targets: vec!["slot_4".to_string()],
        },
        GeneratedNightAction {
            actor_slot: "slot_2".to_string(),
            template_id: "guardian_protect".to_string(),
            action_id: format!("default_open_seed_{seed}_guardian_protect"),
            targets: vec![protected_target.to_string()],
        },
        GeneratedNightAction {
            actor_slot: "slot_4".to_string(),
            template_id: "agent_kill".to_string(),
            action_id: format!("default_open_seed_{seed}_agent_kill"),
            targets: vec![protected_target.to_string()],
        },
    ];

    GeneratedNightCase {
        seed,
        roster,
        actions,
    }
}

fn generated_default_open_day_case(seed: u64) -> GeneratedDefaultOpenDayCase {
    let mut rng = DeterministicRng::new(seed);
    let roster = vec![
        ("slot_1".to_string(), "seer".to_string()),
        ("slot_2".to_string(), "guardian".to_string()),
        ("slot_3".to_string(), "citizen".to_string()),
        ("slot_4".to_string(), "agent".to_string()),
        ("slot_5".to_string(), "citizen".to_string()),
    ];
    let mut town_voters = vec!["slot_1", "slot_2", "slot_3", "slot_5"];
    for index in (1..town_voters.len()).rev() {
        let swap_with = rng.index(index + 1);
        town_voters.swap(index, swap_with);
    }
    let lynched_slot = "slot_4".to_string();
    let votes = town_voters
        .into_iter()
        .take(3)
        .map(|actor_slot| GeneratedVote {
            actor_slot: actor_slot.to_string(),
            target_slot: lynched_slot.clone(),
        })
        .collect();

    GeneratedDefaultOpenDayCase {
        seed,
        roster,
        votes,
        lynched_slot,
    }
}

#[derive(Debug, Clone, Copy)]
enum TargetShape {
    None,
    One,
    Two,
    SelfOnly,
}

fn generated_targets(
    rng: &mut DeterministicRng,
    slots: &[String],
    actor: &str,
    shape: TargetShape,
) -> Vec<String> {
    match shape {
        TargetShape::None => Vec::new(),
        TargetShape::SelfOnly => vec![actor.to_string()],
        TargetShape::One => {
            let candidates: Vec<_> = slots.iter().filter(|slot| slot.as_str() != actor).collect();
            vec![candidates[rng.index(candidates.len())].to_string()]
        }
        TargetShape::Two => {
            let candidates: Vec<_> = slots.iter().filter(|slot| slot.as_str() != actor).collect();
            let first_index = rng.index(candidates.len());
            let mut second_index = rng.index(candidates.len() - 1);
            if second_index >= first_index {
                second_index += 1;
            }
            vec![
                candidates[first_index].to_string(),
                candidates[second_index].to_string(),
            ]
        }
    }
}

fn generated_pack_night_case_summary(
    case: &GeneratedNightCase,
    pack: &str,
    resolver_seed: u64,
) -> String {
    generated_pack_case_summary(case, pack, "N01", resolver_seed)
}

fn generated_pack_case_summary(
    case: &GeneratedNightCase,
    pack: &str,
    phase: &str,
    resolver_seed: u64,
) -> String {
    format!(
        "generated {phase} case generator_seed={}\nminimize_night_fixture JSON:\n{}",
        case.seed,
        generated_case_fixture_json(case, pack, phase, resolver_seed)
    )
}

fn generated_epicmafia_pk_case_summary(
    case: &GeneratedEpicmafiaPkCase,
    resolver_seed: u64,
) -> String {
    let json = generated_epicmafia_pk_case_fixture_json(case, resolver_seed);
    format!(
        "generated D01 PK case generator_seed={}\nminimize_night_fixture JSON:\n{}",
        case.seed, json
    )
}

fn generated_epicmafia_pk_case_fixture_json(
    case: &GeneratedEpicmafiaPkCase,
    resolver_seed: u64,
) -> String {
    let mut fixture = serde_json::json!({
        "seed": resolver_seed,
        "pack": "epicmafia",
        "phase": "D01",
        "roster": case.roster.iter().map(|(slot, role)| {
            serde_json::json!({
                "slot": slot,
                "role": role,
            })
        }).collect::<Vec<_>>(),
        "votes": case.votes.iter().map(|vote| {
            serde_json::json!({
                "actor_slot": vote.actor_slot,
                "target_slot": vote.target_slot,
            })
        }).collect::<Vec<_>>(),
        "actions": [],
        "contenders": case.contenders,
        "selected_slot": case.selected_slot,
        "host_prompt_decision": {
            "prompt_id": "D01:pk:Tie",
            "decision": {
                "kind": "select_slot",
                "slot": case.selected_slot,
            },
        },
    });
    fixture["expectations"] = generated_epicmafia_pk_expectations_json(case);
    serde_json::to_string_pretty(&fixture).expect("generated Epicmafia PK fixture serializes")
}

fn chinese_folded_wolf_beauty_drag_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 930202,
        "pack": "chinese_structured",
        "phase": "N02",
        "roster": [
            {"slot": "slot_1", "role": "wolf_beauty"},
            {"slot": "slot_2", "role": "villager"},
            {"slot": "slot_3", "role": "witch"},
            {"slot": "slot_4", "role": "wolf"},
            {"slot": "slot_5", "role": "villager"}
        ],
        "setup_phases": [{
            "phase": "N01",
            "seed": 930201,
            "actions": [{
                "actor_slot": "slot_1",
                "template_id": "beauty_mark",
                "action_id": "beauty_001",
                "targets": ["slot_2"]
            }]
        }],
        "actions": [{
            "actor_slot": "slot_3",
            "template_id": "poison_potion",
            "action_id": "poison_001",
            "targets": ["slot_1"]
        }],
        "expectations": {
            "inner_events": [
                {
                    "kind": "ActionUseCounted",
                    "payload": {
                        "actor": "slot_3",
                        "template_id": "poison_potion",
                        "consumed_action": "poison_001",
                        "counter_id": "x_shot:poison_potion",
                        "phase_id": "N02"
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_1",
                        "cause": "poison_potion",
                        "attackers": ["slot_3"],
                        "unstoppable": false
                    }
                },
                {
                    "kind": "WolfBeautyDragged",
                    "payload": {
                        "beauty_id": "slot_1",
                        "dragged_ids": ["slot_2"],
                        "cause": "trigger:wolf_beauty_drag",
                        "phase_id": "N02"
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_2",
                        "cause": "trigger:wolf_beauty_drag",
                        "attackers": ["slot_1"],
                        "unstoppable": true
                    }
                }
            ],
            "trace_decisions": [{
                "stage": "death:cascade",
                "source": "action:beauty_001",
                "outcome": "wolf_beauty_dragged",
                "detail": {
                    "beauty_id": "slot_1",
                    "dragged_id": "slot_2",
                    "mark_source_action": "beauty_001",
                    "trigger_cause": "poison_potion",
                    "cause": "trigger:wolf_beauty_drag"
                }
            }]
        }
    }))
    .expect("Chinese folded Wolf Beauty fixture serializes")
}

fn chinese_folded_cupid_lover_suicide_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 930502,
        "pack": "chinese_structured",
        "phase": "N02",
        "roster": [
            {"slot": "slot_1", "role": "cupid"},
            {"slot": "slot_2", "role": "villager"},
            {"slot": "slot_3", "role": "villager"},
            {"slot": "slot_4", "role": "wolf"},
            {"slot": "slot_5", "role": "villager"}
        ],
        "setup_phases": [{
            "phase": "N01",
            "seed": 930501,
            "actions": [{
                "actor_slot": "slot_1",
                "template_id": "link_lovers",
                "action_id": "link_lovers_n01",
                "targets": ["slot_2", "slot_3"]
            }]
        }],
        "actions": [{
            "actor_slot": "slot_4",
            "template_id": "wolf_night_kill",
            "action_id": "kill_lover_n02",
            "targets": ["slot_2"]
        }],
        "expectations": {
            "inner_events": [
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_2",
                        "cause": "wolf_night_kill",
                        "attackers": ["slot_4"],
                        "unstoppable": false
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_3",
                        "cause": "lover_suicide",
                        "attackers": ["slot_2"],
                        "unstoppable": true
                    }
                }
            ],
            "trace_decisions": [{
                "stage": "death:cascade",
                "source": "link:link_lovers_n01",
                "outcome": "lover_suicide",
                "detail": {
                    "link_id": "link_lovers_n01",
                    "link_source": "slot_1",
                    "source_dead": "slot_2",
                    "target": "slot_3",
                    "cause": "lover_suicide"
                }
            }]
        }
    }))
    .expect("Chinese folded Cupid fixture serializes")
}

fn chinese_folded_hunter_retaliation_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 930207,
        "pack": "chinese_structured",
        "phase": "N02",
        "roster": [
            {"slot": "slot_1", "role": "hunter"},
            {"slot": "slot_2", "role": "wolf"},
            {"slot": "slot_3", "role": "wolf"},
            {"slot": "slot_4", "role": "villager"},
            {"slot": "slot_5", "role": "villager"}
        ],
        "setup_phases": [{
            "phase": "N01",
            "seed": 930206,
            "actions": [{
                "actor_slot": "slot_1",
                "template_id": "hunter_retaliate",
                "action_id": "hunt_001",
                "targets": ["slot_2"]
            }]
        }],
        "actions": [{
            "actor_slot": "slot_3",
            "template_id": "wolf_night_kill",
            "action_id": "wolfkill_001",
            "targets": ["slot_1"]
        }],
        "expectations": {
            "inner_events": [
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_1",
                        "cause": "wolf_night_kill",
                        "attackers": ["slot_3"],
                        "unstoppable": false
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_2",
                        "cause": "hunter_retaliate",
                        "attackers": ["slot_1"],
                        "unstoppable": false
                    }
                }
            ],
            "trace_decisions": [{
                "stage": "death:cascade",
                "source": "retaliation:hunt_001",
                "outcome": "chosen_retaliation",
                "detail": {
                    "retaliation_id": "hunt_001",
                    "actor": "slot_1",
                    "target": "slot_2",
                    "source_action": "hunter_retaliate",
                    "source_death_cause": "wolf_night_kill",
                    "cause": "hunter_retaliate",
                    "unstoppable": false,
                    "timing": "ImmediateBeforePhaseAnnouncement"
                }
            }]
        }
    }))
    .expect("Chinese folded Hunter retaliation fixture serializes")
}

fn chinese_folded_hunter_poison_suppression_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 930208,
        "pack": "chinese_structured",
        "phase": "N02",
        "roster": [
            {"slot": "slot_1", "role": "hunter"},
            {"slot": "slot_2", "role": "wolf"},
            {"slot": "slot_3", "role": "witch"},
            {"slot": "slot_4", "role": "wolf"},
            {"slot": "slot_5", "role": "villager"},
            {"slot": "slot_6", "role": "villager"}
        ],
        "setup_phases": [{
            "phase": "N01",
            "seed": 930206,
            "actions": [{
                "actor_slot": "slot_1",
                "template_id": "hunter_retaliate",
                "action_id": "hunt_001",
                "targets": ["slot_2"]
            }]
        }],
        "actions": [{
            "actor_slot": "slot_3",
            "template_id": "poison_potion",
            "action_id": "poison_001",
            "targets": ["slot_1"]
        }],
        "expectations": {
            "inner_events": [
                {
                    "kind": "ActionUseCounted",
                    "payload": {
                        "actor": "slot_3",
                        "template_id": "poison_potion",
                        "consumed_action": "poison_001",
                        "counter_id": "x_shot:poison_potion",
                        "phase_id": "N02"
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_1",
                        "cause": "poison_potion",
                        "attackers": ["slot_3"],
                        "unstoppable": false
                    }
                }
            ],
            "trace_decisions": [{
                "stage": "death:cascade",
                "source": "retaliation:hunt_001",
                "outcome": "chosen_retaliation_suppressed",
                "detail": {
                    "policy": "death_retaliation",
                    "reason": "suppressed_death_cause",
                    "retaliation_id": "hunt_001",
                    "actor": "slot_1",
                    "target": "slot_2",
                    "source_action": "hunter_retaliate",
                    "source_death_cause": "poison_potion"
                }
            }]
        }
    }))
    .expect("Chinese folded Hunter suppression fixture serializes")
}

fn generated_default_open_day_case_summary(
    case: &GeneratedDefaultOpenDayCase,
    resolver_seed: u64,
) -> String {
    let json = generated_default_open_day_case_fixture_json(case, resolver_seed);
    format!(
        "generated default_open D01 case generator_seed={}\nminimize_night_fixture JSON:\n{}",
        case.seed, json
    )
}

fn generated_default_open_day_case_fixture_json(
    case: &GeneratedDefaultOpenDayCase,
    resolver_seed: u64,
) -> String {
    let mut fixture = serde_json::json!({
        "seed": resolver_seed,
        "pack": "default_open",
        "phase": "D01",
        "roster": case.roster.iter().map(|(slot, role)| {
            serde_json::json!({
                "slot": slot,
                "role": role,
            })
        }).collect::<Vec<_>>(),
        "actions": [],
        "votes": case.votes.iter().map(|vote| {
            serde_json::json!({
                "actor_slot": vote.actor_slot,
                "target_slot": vote.target_slot,
            })
        }).collect::<Vec<_>>(),
        "lynched_slot": case.lynched_slot,
    });
    fixture["expectations"] = generated_default_open_day_expectations_json(case);
    serde_json::to_string_pretty(&fixture).expect("generated default_open D01 fixture serializes")
}

fn generated_night_case_fixture_json(
    case: &GeneratedNightCase,
    pack: &str,
    resolver_seed: u64,
) -> String {
    generated_case_fixture_json(case, pack, "N01", resolver_seed)
}

fn generated_mafiascum_persistent_trigger_fixture_json(family: &str, seed: u64) -> String {
    let (setup_action, target_action, expectations) = match family {
        "hunter" => (
            serde_json::json!({
                "actor_slot": "slot_1",
                "template_id": "hunter_retaliate",
                "action_id": format!("generated_seed_{seed}_hunter_arms_retaliation"),
                "targets": ["slot_2"]
            }),
            serde_json::json!({
                "actor_slot": "slot_3",
                "template_id": "factional_kill",
                "action_id": format!("generated_seed_{seed}_mafia_kills_hunter"),
                "targets": ["slot_1"]
            }),
            serde_json::json!({
                "inner_events": [
                    {
                        "kind": "PlayerKilled",
                        "payload": {
                            "slot_id": "slot_1",
                            "cause": "factional_kill",
                            "attackers": ["slot_3"]
                        }
                    },
                    {
                        "kind": "PlayerKilled",
                        "payload": {
                            "slot_id": "slot_2",
                            "cause": "hunter_retaliate",
                            "attackers": ["slot_1"],
                            "unstoppable": false
                        }
                    }
                ],
                "trace_decisions": [
                    {
                        "stage": "death:cascade",
                        "source": format!("retaliation:generated_seed_{seed}_hunter_arms_retaliation"),
                        "outcome": "chosen_retaliation",
                        "detail": {
                            "retaliation_id": format!("generated_seed_{seed}_hunter_arms_retaliation"),
                            "actor": "slot_1",
                            "target": "slot_2",
                            "source_action": "hunter_retaliate",
                            "source_death_cause": "factional_kill",
                            "cause": "hunter_retaliate",
                            "unstoppable": false,
                            "timing": "ImmediateBeforePhaseAnnouncement"
                        }
                    }
                ]
            }),
        ),
        "lovers" => (
            serde_json::json!({
                "actor_slot": "slot_1",
                "template_id": "link_lovers",
                "action_id": format!("generated_seed_{seed}_cupid_links_lovers"),
                "targets": ["slot_2", "slot_4"]
            }),
            serde_json::json!({
                "actor_slot": "slot_3",
                "template_id": "factional_kill",
                "action_id": format!("generated_seed_{seed}_mafia_kills_lover"),
                "targets": ["slot_2"]
            }),
            serde_json::json!({
                "inner_events": [
                    {
                        "kind": "PlayerKilled",
                        "payload": {
                            "slot_id": "slot_2",
                            "cause": "factional_kill",
                            "attackers": ["slot_3"]
                        }
                    },
                    {
                        "kind": "PlayerKilled",
                        "payload": {
                            "slot_id": "slot_4",
                            "cause": "lover_suicide",
                            "attackers": ["slot_2"],
                            "unstoppable": true
                        }
                    }
                ],
                "trace_decisions": [
                    {
                        "stage": "death:cascade",
                        "source": format!("link:generated_seed_{seed}_cupid_links_lovers"),
                        "outcome": "lover_suicide",
                        "detail": {
                            "link_id": format!("generated_seed_{seed}_cupid_links_lovers"),
                            "link_source": "slot_1",
                            "linked_slots": ["slot_2", "slot_4"],
                            "source_dead": "slot_2",
                            "target": "slot_4",
                            "cause": "lover_suicide"
                        }
                    }
                ]
            }),
        ),
        _ => unreachable!("unknown generated persistent trigger family"),
    };

    serde_json::to_string_pretty(&serde_json::json!({
        "seed": seed + 32_000,
        "pack": "mafiascum",
        "phase": "N02",
        "roster": [
            { "slot": "slot_1", "role": if family == "hunter" { "hunter" } else { "cupid" } },
            { "slot": "slot_2", "role": "vanilla_townie" },
            { "slot": "slot_3", "role": "mafia_goon" },
            { "slot": "slot_4", "role": "vanilla_townie" },
            { "slot": "slot_5", "role": "mafia_goon" },
            { "slot": "slot_6", "role": "vanilla_townie" }
        ],
        "setup_phases": [
            {
                "phase": "N01",
                "seed": seed + 31_000,
                "actions": [setup_action]
            }
        ],
        "actions": [target_action],
        "expectations": expectations
    }))
    .expect("generated Mafiascum persistent trigger fixture serializes")
}

fn generated_mafiascum_vengeful_fixpoint_fixture_json(seed: u64) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": seed + 37_000,
        "pack": "mafiascum",
        "phase": "N01",
        "roster": [
            { "slot": "slot_1", "role": "mafia_goon" },
            { "slot": "slot_2", "role": "vengeful" },
            { "slot": "slot_3", "role": "mafia_goon" },
            { "slot": "slot_4", "role": "vanilla_townie" },
            { "slot": "slot_5", "role": "vanilla_townie" }
        ],
        "actions": [
            {
                "actor_slot": "slot_1",
                "template_id": "factional_kill",
                "action_id": format!("generated_seed_{seed}_kill_vengeful"),
                "targets": ["slot_2"]
            }
        ],
        "expectations": {
            "inner_events": [
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_2",
                        "cause": "factional_kill",
                        "attackers": ["slot_1"],
                        "unstoppable": false
                    }
                },
                {
                    "kind": "Trigger",
                    "payload": {
                        "trigger_id": "vengeful_retaliates",
                        "payload": {
                            "on": "Kill",
                            "source_target": "slot_2",
                            "source_actor": "slot_1",
                            "source_cause": "factional_kill",
                            "produced_actor": "slot_2",
                            "produced_target": "slot_1"
                        }
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_1",
                        "cause": "vengeful_retaliates",
                        "attackers": ["slot_2"],
                        "unstoppable": false
                    }
                }
            ],
            "trace_notes": [
                "trigger vengeful_retaliates emitted at event_index 1"
            ],
            "trace_decisions": [
                {
                    "stage": "inner_event",
                    "source": "event_index:1",
                    "outcome": "trigger",
                    "detail": null
                }
            ],
            "generated_actions": [
                {
                    "action_id": "vengeful_retaliates",
                    "source": "Trigger",
                    "actor": "slot_2",
                    "targets": ["slot_1"],
                    "detail": {
                        "on": "Kill",
                        "source_target": "slot_2",
                        "source_actor": "slot_1",
                        "source_cause": "factional_kill",
                        "produced_actor": "slot_2",
                        "produced_target": "slot_1"
                    }
                }
            ],
            "generated_action_counts": [
                {
                    "action_id": "vengeful_retaliates",
                    "source": "Trigger",
                    "count": 1
                }
            ],
            "slot_states": [
                {
                    "payload": {
                        "slot_id": "slot_1",
                        "alive": false
                    }
                },
                {
                    "payload": {
                        "slot_id": "slot_2",
                        "alive": false
                    }
                }
            ]
        }
    }))
    .expect("generated Mafiascum vengeful fixpoint fixture serializes")
}

fn generated_mafiascum_strongman_vengeful_fixpoint_fixture_json(seed: u64) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": seed + 38_000,
        "pack": "mafiascum",
        "phase": "N01",
        "roster": [
            { "slot": "slot_1", "role": "mafia_goon" },
            { "slot": "slot_2", "role": "unstoppable_vengeful_townie" },
            { "slot": "slot_3", "role": "doctor" },
            { "slot": "slot_4", "role": "vanilla_townie" },
            { "slot": "slot_5", "role": "mafia_goon" }
        ],
        "actions": [
            {
                "actor_slot": "slot_1",
                "template_id": "factional_kill",
                "action_id": format!("generated_seed_{seed}_kill_unstoppable_vengeful"),
                "targets": ["slot_2"]
            },
            {
                "actor_slot": "slot_3",
                "template_id": "doctor_protect",
                "action_id": format!("generated_seed_{seed}_doctor_saves_killer"),
                "targets": ["slot_1"]
            }
        ],
        "expectations": {
            "inner_events": [
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_2",
                        "cause": "factional_kill",
                        "attackers": ["slot_1"],
                        "unstoppable": false
                    }
                },
                {
                    "kind": "Trigger",
                    "payload": {
                        "trigger_id": "unstoppable_vengeful_retaliates",
                        "payload": {
                            "on": "Kill",
                            "source_target": "slot_2",
                            "source_actor": "slot_1",
                            "source_cause": "factional_kill",
                            "produced_actor": "slot_2",
                            "produced_target": "slot_1"
                        }
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_1",
                        "cause": "unstoppable_vengeful_retaliates",
                        "attackers": ["slot_2"],
                        "unstoppable": true
                    }
                }
            ],
            "trace_notes": [
                "trigger unstoppable_vengeful_retaliates emitted at event_index 1"
            ],
            "trace_decisions": [
                {
                    "stage": "inner_event",
                    "source": "event_index:1",
                    "outcome": "trigger",
                    "detail": null
                },
                {
                    "stage": "kill_resolution",
                    "source": "cause:unstoppable_vengeful_retaliates",
                    "outcome": "protection_bypassed_by_unstoppable_kill",
                    "detail": {
                        "cause": "unstoppable_vengeful_retaliates",
                        "target": "slot_1",
                        "attacker": "slot_2",
                        "unstoppable": true,
                        "protectors": [
                            {
                                "protector": "slot_3",
                                "action_id": format!("generated_seed_{seed}_doctor_saves_killer"),
                                "template_id": "doctor_protect",
                                "intercepts": false,
                                "intercept_cause": null,
                                "guard_retaliation_cause": null,
                                "cpr_harm_cause": null
                            }
                        ]
                    }
                }
            ],
            "generated_actions": [
                {
                    "action_id": "unstoppable_vengeful_retaliates",
                    "source": "Trigger",
                    "actor": "slot_2",
                    "targets": ["slot_1"],
                    "detail": {
                        "on": "Kill",
                        "source_target": "slot_2",
                        "source_actor": "slot_1",
                        "source_cause": "factional_kill",
                        "produced_actor": "slot_2",
                        "produced_target": "slot_1"
                    }
                }
            ],
            "generated_action_counts": [
                {
                    "action_id": "unstoppable_vengeful_retaliates",
                    "source": "Trigger",
                    "count": 1
                }
            ],
            "slot_states": [
                {
                    "payload": {
                        "slot_id": "slot_1",
                        "alive": false
                    }
                },
                {
                    "payload": {
                        "slot_id": "slot_2",
                        "alive": false
                    }
                },
                {
                    "payload": {
                        "slot_id": "slot_3",
                        "alive": true
                    }
                }
            ]
        }
    }))
    .expect("generated Mafiascum strongman vengeful fixpoint fixture serializes")
}

fn generated_mafiascum_bodyguard_strongman_vengeful_fixpoint_fixture_json(seed: u64) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": seed + 39_000,
        "pack": "mafiascum",
        "phase": "N01",
        "roster": [
            { "slot": "slot_1", "role": "mafia_goon" },
            { "slot": "slot_2", "role": "unstoppable_vengeful_townie" },
            { "slot": "slot_3", "role": "bodyguard" },
            { "slot": "slot_4", "role": "vanilla_townie" },
            { "slot": "slot_5", "role": "mafia_goon" },
            { "slot": "slot_6", "role": "vanilla_townie" }
        ],
        "actions": [
            {
                "actor_slot": "slot_1",
                "template_id": "factional_kill",
                "action_id": format!("generated_seed_{seed}_kill_unstoppable_vengeful_bodyguard"),
                "targets": ["slot_2"]
            },
            {
                "actor_slot": "slot_3",
                "template_id": "bodyguard",
                "action_id": format!("generated_seed_{seed}_bodyguard_saves_killer"),
                "targets": ["slot_1"]
            }
        ],
        "expectations": {
            "inner_events": [
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_2",
                        "cause": "factional_kill",
                        "attackers": ["slot_1"],
                        "unstoppable": false
                    }
                },
                {
                    "kind": "Trigger",
                    "payload": {
                        "trigger_id": "unstoppable_vengeful_retaliates",
                        "payload": {
                            "on": "Kill",
                            "source_target": "slot_2",
                            "source_actor": "slot_1",
                            "source_cause": "factional_kill",
                            "produced_actor": "slot_2",
                            "produced_target": "slot_1"
                        }
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_1",
                        "cause": "unstoppable_vengeful_retaliates",
                        "attackers": ["slot_2"],
                        "unstoppable": true
                    }
                }
            ],
            "trace_notes": [
                "trigger unstoppable_vengeful_retaliates emitted at event_index 1"
            ],
            "trace_decisions": [
                {
                    "stage": "inner_event",
                    "source": "event_index:1",
                    "outcome": "trigger",
                    "detail": null
                },
                {
                    "stage": "kill_resolution",
                    "source": "cause:unstoppable_vengeful_retaliates",
                    "outcome": "protection_bypassed_by_unstoppable_kill",
                    "detail": {
                        "cause": "unstoppable_vengeful_retaliates",
                        "target": "slot_1",
                        "attacker": "slot_2",
                        "unstoppable": true,
                        "protectors": [
                            {
                                "protector": "slot_3",
                                "action_id": format!("generated_seed_{seed}_bodyguard_saves_killer"),
                                "template_id": "bodyguard",
                                "intercepts": true,
                                "intercept_cause": "bodyguard_intercept",
                                "guard_retaliation_cause": null,
                                "cpr_harm_cause": null
                            }
                        ]
                    }
                }
            ],
            "generated_actions": [
                {
                    "action_id": "unstoppable_vengeful_retaliates",
                    "source": "Trigger",
                    "actor": "slot_2",
                    "targets": ["slot_1"],
                    "detail": {
                        "on": "Kill",
                        "source_target": "slot_2",
                        "source_actor": "slot_1",
                        "source_cause": "factional_kill",
                        "produced_actor": "slot_2",
                        "produced_target": "slot_1"
                    }
                }
            ],
            "generated_action_counts": [
                {
                    "action_id": "unstoppable_vengeful_retaliates",
                    "source": "Trigger",
                    "count": 1
                }
            ],
            "slot_states": [
                {
                    "payload": {
                        "slot_id": "slot_1",
                        "alive": false
                    }
                },
                {
                    "payload": {
                        "slot_id": "slot_2",
                        "alive": false
                    }
                },
                {
                    "payload": {
                        "slot_id": "slot_3",
                        "alive": true
                    }
                }
            ]
        }
    }))
    .expect("generated Mafiascum bodyguard strongman vengeful fixpoint fixture serializes")
}

fn generated_mafiascum_bomb_projection_state_fixture_json(seed: u64) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": seed + 40_000,
        "pack": "mafiascum",
        "phase": "N01",
        "roster": [
            { "slot": "slot_1", "role": "mafia_goon" },
            { "slot": "slot_2", "role": "bomb" },
            { "slot": "slot_3", "role": "vanilla_townie" },
            { "slot": "slot_4", "role": "vanilla_townie" },
            { "slot": "slot_5", "role": "mafia_goon" }
        ],
        "actions": [
            {
                "actor_slot": "slot_1",
                "template_id": "factional_kill",
                "action_id": format!("generated_seed_{seed}_bomb_kill"),
                "targets": ["slot_2"]
            }
        ],
        "expectations": {
            "inner_events": [
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_2",
                        "cause": "factional_kill",
                        "attackers": ["slot_1"],
                        "unstoppable": false
                    }
                },
                {
                    "kind": "Trigger",
                    "payload": {
                        "trigger_id": "bomb_retaliates",
                        "payload": {
                            "on": "Kill",
                            "source_target": "slot_2",
                            "source_actor": "slot_1",
                            "source_cause": "factional_kill",
                            "produced_actor": "slot_2",
                            "produced_target": "slot_1"
                        }
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_1",
                        "cause": "bomb_retaliates",
                        "attackers": ["slot_2"],
                        "unstoppable": false
                    }
                }
            ],
            "trace_notes": [
                "trigger bomb_retaliates emitted at event_index 1"
            ],
            "trace_decisions": [
                {
                    "stage": "inner_event",
                    "source": "event_index:1",
                    "outcome": "trigger",
                    "detail": null
                }
            ],
            "generated_actions": [
                {
                    "action_id": "bomb_retaliates",
                    "source": "Trigger",
                    "actor": "slot_2",
                    "targets": ["slot_1"],
                    "detail": {
                        "on": "Kill",
                        "source_target": "slot_2",
                        "source_actor": "slot_1",
                        "source_cause": "factional_kill",
                        "produced_actor": "slot_2",
                        "produced_target": "slot_1"
                    }
                }
            ],
            "generated_action_counts": [
                {
                    "action_id": "bomb_retaliates",
                    "source": "Trigger",
                    "count": 1
                }
            ],
            "slot_states": [
                {
                    "payload": {
                        "slot_id": "slot_1",
                        "alive": false
                    }
                },
                {
                    "payload": {
                        "slot_id": "slot_2",
                        "alive": false
                    }
                },
                {
                    "payload": {
                        "slot_id": "slot_5",
                        "alive": true
                    }
                }
            ]
        }
    }))
    .expect("generated Mafiascum bomb projection-state fixture serializes")
}

fn generated_mafiascum_pgo_projection_state_fixture_json(seed: u64) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": seed + 41_000,
        "pack": "mafiascum",
        "phase": "N01",
        "roster": [
            { "slot": "slot_1", "role": "roleblocker" },
            { "slot": "slot_2", "role": "paranoid_gun_owner" },
            { "slot": "slot_3", "role": "vanilla_townie" },
            { "slot": "slot_4", "role": "vanilla_townie" },
            { "slot": "slot_5", "role": "mafia_goon" }
        ],
        "actions": [
            {
                "actor_slot": "slot_1",
                "template_id": "roleblocker_block",
                "action_id": format!("generated_seed_{seed}_roleblocker_visits_pgo"),
                "targets": ["slot_2"]
            }
        ],
        "expectations": {
            "inner_events": [
                {
                    "kind": "Trigger",
                    "payload": {
                        "trigger_id": "pgo_shoots_visitor",
                        "payload": {
                            "on": "Visit",
                            "source_target": "slot_2",
                            "source_actor": "slot_1",
                            "source_cause": "roleblocker_block",
                            "produced_actor": "slot_2",
                            "produced_target": "slot_1"
                        }
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_1",
                        "cause": "pgo_shoots_visitor",
                        "attackers": ["slot_2"],
                        "unstoppable": false
                    }
                }
            ],
            "trace_notes": [
                "trigger pgo_shoots_visitor emitted at event_index 0"
            ],
            "trace_decisions": [
                {
                    "stage": "inner_event",
                    "source": "event_index:0",
                    "outcome": "trigger",
                    "detail": null
                }
            ],
            "generated_actions": [
                {
                    "action_id": "pgo_shoots_visitor",
                    "source": "Trigger",
                    "actor": "slot_2",
                    "targets": ["slot_1"],
                    "detail": {
                        "on": "Visit",
                        "source_target": "slot_2",
                        "source_actor": "slot_1",
                        "source_cause": "roleblocker_block",
                        "produced_actor": "slot_2",
                        "produced_target": "slot_1"
                    }
                }
            ],
            "generated_action_counts": [
                {
                    "action_id": "pgo_shoots_visitor",
                    "source": "Trigger",
                    "count": 1
                }
            ],
            "slot_states": [
                {
                    "payload": {
                        "slot_id": "slot_1",
                        "alive": false
                    }
                },
                {
                    "payload": {
                        "slot_id": "slot_2",
                        "alive": true
                    }
                },
                {
                    "payload": {
                        "slot_id": "slot_5",
                        "alive": true
                    }
                }
            ]
        }
    }))
    .expect("generated Mafiascum PGO projection-state fixture serializes")
}

fn generated_mafiascum_hider_projection_state_fixture_json(seed: u64) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": seed + 42_000,
        "pack": "mafiascum",
        "phase": "N01",
        "roster": [
            { "slot": "slot_1", "role": "mafia_goon" },
            { "slot": "slot_2", "role": "hider" },
            { "slot": "slot_3", "role": "vanilla_townie" },
            { "slot": "slot_4", "role": "mafia_goon" },
            { "slot": "slot_5", "role": "vanilla_townie" }
        ],
        "actions": [
            {
                "actor_slot": "slot_2",
                "template_id": "hide",
                "action_id": format!("generated_seed_{seed}_hider_hides_behind_host"),
                "targets": ["slot_3"]
            },
            {
                "actor_slot": "slot_4",
                "template_id": "factional_kill",
                "action_id": format!("generated_seed_{seed}_mafia_kills_hider_host"),
                "targets": ["slot_3"]
            }
        ],
        "expectations": {
            "inner_events": [
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_3",
                        "cause": "factional_kill",
                        "attackers": ["slot_4"],
                        "unstoppable": false
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_2",
                        "cause": "hide",
                        "attackers": ["slot_3"],
                        "unstoppable": true
                    }
                }
            ],
            "trace_decisions": [
                {
                    "stage": "night:dependency_death",
                    "source": format!("action:generated_seed_{seed}_hider_hides_behind_host"),
                    "outcome": "hider_dependency_death",
                    "detail": {
                        "action_id": format!("generated_seed_{seed}_hider_hides_behind_host"),
                        "template_id": "hide",
                        "host": "slot_3",
                        "hider": "slot_2",
                        "cause": "hide",
                        "attackers": ["slot_3"]
                    }
                }
            ],
            "slot_states": [
                {
                    "payload": {
                        "slot_id": "slot_3",
                        "alive": false
                    }
                },
                {
                    "payload": {
                        "slot_id": "slot_2",
                        "alive": false
                    }
                },
                {
                    "payload": {
                        "slot_id": "slot_4",
                        "alive": true
                    }
                }
            ]
        }
    }))
    .expect("generated Mafiascum Hider projection-state fixture serializes")
}

fn generated_mafiascum_babysitter_projection_state_fixture_json(seed: u64) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": seed + 43_000,
        "pack": "mafiascum",
        "phase": "N01",
        "roster": [
            { "slot": "slot_1", "role": "mafia_goon" },
            { "slot": "slot_2", "role": "babysitter" },
            { "slot": "slot_3", "role": "vanilla_townie" },
            { "slot": "slot_4", "role": "mafia_goon" },
            { "slot": "slot_5", "role": "vanilla_townie" }
        ],
        "actions": [
            {
                "actor_slot": "slot_1",
                "template_id": "factional_kill",
                "action_id": format!("generated_seed_{seed}_mafia_kills_babysitter_ward"),
                "targets": ["slot_3"]
            },
            {
                "actor_slot": "slot_4",
                "template_id": "factional_kill",
                "action_id": format!("generated_seed_{seed}_mafia_kills_babysitter"),
                "targets": ["slot_2"]
            },
            {
                "actor_slot": "slot_2",
                "template_id": "babysit",
                "action_id": format!("generated_seed_{seed}_babysitter_guards_ward"),
                "targets": ["slot_3"]
            }
        ],
        "expectations": {
            "inner_events": [
                {
                    "kind": "PlayerSaved",
                    "payload": {
                        "slot_id": "slot_3",
                        "sources": ["slot_2"]
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_2",
                        "cause": "factional_kill",
                        "attackers": ["slot_4"],
                        "unstoppable": false
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_3",
                        "cause": "babysit",
                        "attackers": ["slot_2"],
                        "unstoppable": true
                    }
                }
            ],
            "trace_decisions": [
                {
                    "stage": "night:dependency_death",
                    "source": format!("action:generated_seed_{seed}_babysitter_guards_ward"),
                    "outcome": "babysitter_dependency_death",
                    "detail": {
                        "action_id": format!("generated_seed_{seed}_babysitter_guards_ward"),
                        "template_id": "babysit",
                        "protector": "slot_2",
                        "ward": "slot_3",
                        "cause": "babysit",
                        "attackers": ["slot_2"]
                    }
                }
            ],
            "slot_states": [
                {
                    "payload": {
                        "slot_id": "slot_2",
                        "alive": false
                    }
                },
                {
                    "payload": {
                        "slot_id": "slot_3",
                        "alive": false
                    }
                },
                {
                    "payload": {
                        "slot_id": "slot_4",
                        "alive": true
                    }
                }
            ]
        }
    }))
    .expect("generated Mafiascum Babysitter projection-state fixture serializes")
}

fn generated_mafiascum_lovers_projection_state_fixture_json(seed: u64) -> String {
    let mut fixture: serde_json::Value = serde_json::from_str(
        &generated_mafiascum_persistent_trigger_fixture_json("lovers", seed),
    )
    .expect("generated Mafiascum Lovers fixture serializes");
    fixture["expectations"]["slot_states"] = serde_json::json!([
        {
            "payload": {
                "slot_id": "slot_2",
                "alive": false
            }
        },
        {
            "payload": {
                "slot_id": "slot_4",
                "alive": false
            }
        },
        {
            "payload": {
                "slot_id": "slot_5",
                "alive": true
            }
        }
    ]);
    serde_json::to_string_pretty(&fixture)
        .expect("generated Mafiascum Lovers projection-state fixture serializes")
}

fn generated_mafiascum_hunter_projection_state_fixture_json(seed: u64) -> String {
    let mut fixture: serde_json::Value = serde_json::from_str(
        &generated_mafiascum_persistent_trigger_fixture_json("hunter", seed),
    )
    .expect("generated Mafiascum Hunter fixture serializes");
    fixture["expectations"]["slot_states"] = serde_json::json!([
        {
            "payload": {
                "slot_id": "slot_1",
                "alive": false
            }
        },
        {
            "payload": {
                "slot_id": "slot_2",
                "alive": false
            }
        },
        {
            "payload": {
                "slot_id": "slot_5",
                "alive": true
            }
        }
    ]);
    serde_json::to_string_pretty(&fixture)
        .expect("generated Mafiascum Hunter projection-state fixture serializes")
}

fn generated_mafiascum_vengeful_projection_state_fixture_json(seed: u64) -> String {
    let mut fixture: serde_json::Value =
        serde_json::from_str(&generated_mafiascum_vengeful_fixpoint_fixture_json(seed))
            .expect("generated Mafiascum Vengeful fixture serializes");
    fixture["expectations"]["slot_states"] = serde_json::json!([
        {
            "payload": {
                "slot_id": "slot_2",
                "alive": false
            }
        },
        {
            "payload": {
                "slot_id": "slot_1",
                "alive": false
            }
        },
        {
            "payload": {
                "slot_id": "slot_3",
                "alive": true
            }
        }
    ]);
    serde_json::to_string_pretty(&fixture)
        .expect("generated Mafiascum Vengeful projection-state fixture serializes")
}

fn generated_mafiascum_strongman_vengeful_projection_state_fixture_json(seed: u64) -> String {
    let fixture: serde_json::Value =
        serde_json::from_str(&generated_mafiascum_strongman_vengeful_fixpoint_fixture_json(seed))
            .expect("generated Mafiascum Strongman Vengeful fixture serializes");
    serde_json::to_string_pretty(&fixture)
        .expect("generated Mafiascum Strongman Vengeful projection-state fixture serializes")
}

fn generated_mafiascum_bodyguard_strongman_vengeful_projection_state_fixture_json(
    seed: u64,
) -> String {
    let fixture: serde_json::Value = serde_json::from_str(
        &generated_mafiascum_bodyguard_strongman_vengeful_fixpoint_fixture_json(seed),
    )
    .expect("generated Mafiascum Bodyguard Strongman Vengeful fixture serializes");
    serde_json::to_string_pretty(&fixture).expect(
        "generated Mafiascum Bodyguard Strongman Vengeful projection-state fixture serializes",
    )
}

fn generated_persistent_trigger_success_fixture_json(family: &str, seed: u64) -> String {
    match family {
        "hunter" | "lovers" => generated_mafiascum_persistent_trigger_fixture_json(family, seed),
        "hunter_projection_state" => generated_mafiascum_hunter_projection_state_fixture_json(seed),
        "vengeful_fixpoint" => generated_mafiascum_vengeful_fixpoint_fixture_json(seed),
        "vengeful_projection_state" => {
            generated_mafiascum_vengeful_projection_state_fixture_json(seed)
        }
        "strongman_vengeful_fixpoint" => {
            generated_mafiascum_strongman_vengeful_fixpoint_fixture_json(seed)
        }
        "strongman_vengeful_projection_state" => {
            generated_mafiascum_strongman_vengeful_projection_state_fixture_json(seed)
        }
        "bodyguard_strongman_vengeful_fixpoint" => {
            generated_mafiascum_bodyguard_strongman_vengeful_fixpoint_fixture_json(seed)
        }
        "bodyguard_strongman_vengeful_projection_state" => {
            generated_mafiascum_bodyguard_strongman_vengeful_projection_state_fixture_json(seed)
        }
        "bomb" => generated_night_case_fixture_json(
            &generated_epicmafia_night_case(seed),
            "epicmafia",
            seed + 48_000,
        ),
        "bomb_projection_state" => generated_mafiascum_bomb_projection_state_fixture_json(seed),
        "pgo_projection_state" => generated_mafiascum_pgo_projection_state_fixture_json(seed),
        "hider_projection_state" => generated_mafiascum_hider_projection_state_fixture_json(seed),
        "babysitter_projection_state" => {
            generated_mafiascum_babysitter_projection_state_fixture_json(seed)
        }
        "lovers_projection_state" => generated_mafiascum_lovers_projection_state_fixture_json(seed),
        "backup_inheritance" => generated_mafiascum_backup_inheritance_fixture_json(seed),
        "backup_projection_state" => generated_mafiascum_backup_projection_state_fixture_json(seed),
        "conversion_deprogramming" => {
            generated_mafiascum_conversion_deprogramming_fixture_json(seed)
        }
        "conversion_projection_state" => {
            generated_mafiascum_conversion_projection_state_fixture_json(seed)
        }
        "ignite" | "mark_clear_visibility" | "mark_clear_expiry" | "poison_cure" => {
            generated_mafiascum_persistent_effect_fixture_json(family, seed)
        }
        "extra_action" | "item_grant" | "private_notification" => {
            generated_mafiascum_generated_action_fixture_json(family, seed)
        }
        _ => unreachable!("unknown generated persistent trigger family"),
    }
}

fn generated_persistent_trigger_bad_expectation_fixture_json(family: &str, seed: u64) -> String {
    let mut fixture: serde_json::Value = serde_json::from_str(
        &generated_persistent_trigger_success_fixture_json(family, seed),
    )
    .expect("generated persistent success fixture serializes");
    match family {
        "hunter" => {
            fixture["expectations"]["inner_events"][1]["payload"]["cause"] =
                serde_json::json!("hunter_retaliate_wrong");
        }
        "hunter_projection_state" => {
            fixture["expectations"]["slot_states"][1]["payload"]["alive"] = serde_json::json!(true);
        }
        "vengeful_fixpoint" => {
            fixture["expectations"]["generated_actions"][0]["action_id"] =
                serde_json::json!("vengeful_retaliates_wrong");
        }
        "vengeful_projection_state" => {
            fixture["expectations"]["slot_states"][1]["payload"]["alive"] = serde_json::json!(true);
        }
        "strongman_vengeful_fixpoint" => {
            fixture["expectations"]["trace_decisions"][1]["outcome"] =
                serde_json::json!("kill_prevented_by_protection");
        }
        "strongman_vengeful_projection_state" => {
            fixture["expectations"]["slot_states"][0]["payload"]["alive"] = serde_json::json!(true);
        }
        "bodyguard_strongman_vengeful_fixpoint" => {
            fixture["expectations"]["trace_decisions"][1]["detail"]["protectors"][0]
                ["intercepts"] = serde_json::json!(false);
        }
        "bodyguard_strongman_vengeful_projection_state" => {
            fixture["expectations"]["slot_states"][0]["payload"]["alive"] = serde_json::json!(true);
        }
        "lovers" => {
            fixture["expectations"]["inner_events"][1]["payload"]["cause"] =
                serde_json::json!("lover_suicide_wrong");
        }
        "bomb" => {
            fixture["expectations"]["inner_events"][0]["payload"]["trigger_id"] =
                serde_json::json!("bomb_retaliates_wrong");
        }
        "bomb_projection_state" => {
            fixture["expectations"]["generated_actions"][0]["action_id"] =
                serde_json::json!("bomb_retaliates_wrong");
        }
        "pgo_projection_state" => {
            fixture["expectations"]["generated_actions"][0]["action_id"] =
                serde_json::json!("pgo_shoots_wrong_visitor");
        }
        "hider_projection_state" => {
            fixture["expectations"]["slot_states"][1]["payload"]["alive"] = serde_json::json!(true);
        }
        "babysitter_projection_state" => {
            fixture["expectations"]["slot_states"][0]["payload"]["alive"] = serde_json::json!(true);
        }
        "lovers_projection_state" => {
            fixture["expectations"]["slot_states"][1]["payload"]["alive"] = serde_json::json!(true);
        }
        "backup_inheritance" => {
            fixture["expectations"]["trace_decisions"][0]["detail"]["policy_detail"]
                ["source_action"] = serde_json::json!("target_backup_wrong");
        }
        "backup_projection_state" => {
            fixture["expectations"]["slot_states"][0]["payload"]["role_key"] =
                serde_json::json!("universal_backup");
        }
        "conversion_deprogramming" => {
            fixture["expectations"]["trace_decisions"][1]["detail"]["origin_source"] =
                serde_json::json!("slot_wrong");
        }
        "conversion_projection_state" => {
            fixture["expectations"]["slot_states"][0]["payload"]["alignment"] =
                serde_json::json!("cult");
        }
        "ignite" => {
            fixture["expectations"]["inner_events"][0]["payload"]["cause"] =
                serde_json::json!("ignite_wrong");
        }
        "mark_clear_visibility" => {
            fixture["expectations"]["inner_events"][2]["payload"]["visibility"] =
                serde_json::json!("Hidden");
        }
        "mark_clear_expiry" => {
            fixture["expectations"]["player_notifications"][0]["payload"]["audience_slot"] =
                serde_json::json!("slot_4");
        }
        "poison_cure" => {
            fixture["expectations"]["player_notifications"][0]["payload"]["audience_slot"] =
                serde_json::json!("slot_4");
        }
        "extra_action" => {
            fixture["expectations"]["inner_events"][0]["payload"]["source_action"] =
                serde_json::json!("motivate_wrong");
        }
        "item_grant" => {
            fixture["expectations"]["inner_events"][0]["payload"]["source_action"] =
                serde_json::json!("grant_item_wrong");
        }
        "private_notification" => {
            fixture["expectations"]["player_notifications"][0]["payload"]["audience_slot"] =
                serde_json::json!("slot_3");
        }
        _ => unreachable!("unknown generated persistent trigger family"),
    }
    serde_json::to_string_pretty(&fixture)
        .expect("generated persistent bad-expectation fixture serializes")
}

fn generated_mafiascum_backup_inheritance_fixture_json(seed: u64) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": seed + 35_000,
        "pack": "mafiascum",
        "phase": "N03",
        "roster": [
            { "slot": "slot_1", "role": "universal_backup" },
            { "slot": "slot_2", "role": "cop" },
            { "slot": "slot_3", "role": "mafia_goon" },
            { "slot": "slot_4", "role": "vanilla_townie" },
            { "slot": "slot_5", "role": "vanilla_townie" },
            { "slot": "slot_6", "role": "mafia_goon" }
        ],
        "setup_phases": [
            {
                "phase": "N01",
                "seed": seed + 33_000,
                "actions": [{
                    "actor_slot": "slot_1",
                    "template_id": "target_backup",
                    "action_id": format!("generated_seed_{seed}_target_backup_source"),
                    "targets": ["slot_2"]
                }]
            },
            {
                "phase": "N02",
                "seed": seed + 34_000,
                "actions": [{
                    "actor_slot": "slot_3",
                    "template_id": "factional_kill",
                    "action_id": format!("generated_seed_{seed}_kill_source_for_backup"),
                    "targets": ["slot_2"]
                }]
            }
        ],
        "actions": [
            {
                "actor_slot": "slot_1",
                "template_id": "cop_investigate",
                "action_id": format!("generated_seed_{seed}_inherited_cop_check"),
                "targets": ["slot_3"]
            }
        ],
        "expectations": {
            "inner_events": [
                {
                    "kind": "InvestigationResult",
                    "payload": {
                        "mode": "Parity",
                        "investigator": "slot_1",
                        "target": "slot_3",
                        "result": "scum"
                    }
                }
            ],
            "trace_decisions": [
                {
                    "stage": "night:backup",
                    "source": "slot:slot_2",
                    "outcome": "backup_inherited_role",
                    "detail": {
                        "backup": "slot_1",
                        "source_target": "slot_2",
                        "policy": "targeted",
                        "policy_detail": {
                            "source_action": format!("generated_seed_{seed}_target_backup_source"),
                            "declared_source_role": "cop",
                            "target_phase_id": "N01",
                            "target_phase_kind": "Night",
                            "target_phase_number": 1
                        },
                        "new_role": "cop",
                        "new_alignment": "town",
                        "original_role": "universal_backup",
                        "original_alignment": "town"
                    }
                }
            ]
        }
    }))
    .expect("generated Mafiascum backup-inheritance fixture serializes")
}

fn generated_mafiascum_backup_projection_state_fixture_json(seed: u64) -> String {
    let mut fixture: serde_json::Value =
        serde_json::from_str(&generated_mafiascum_backup_inheritance_fixture_json(seed))
            .expect("generated Mafiascum backup-inheritance fixture parses");
    fixture["expectations"]["slot_states"] = serde_json::json!([
        {
            "payload": {
                "slot_id": "slot_1",
                "alive": true,
                "status": "alive",
                "role_key": "cop",
                "alignment": "town",
                "role_revealed": false,
                "alignment_revealed": false
            }
        }
    ]);
    serde_json::to_string_pretty(&fixture)
        .expect("generated Mafiascum backup projection-state fixture serializes")
}

fn generated_mafiascum_conversion_deprogramming_fixture_json(seed: u64) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": seed + 36_000,
        "pack": "mafiascum",
        "phase": "N03",
        "roster": [
            { "slot": "slot_1", "role": "cult_leader" },
            { "slot": "slot_2", "role": "deprogrammer" },
            { "slot": "slot_3", "role": "cop" },
            { "slot": "slot_4", "role": "mafia_goon" },
            { "slot": "slot_5", "role": "vanilla_townie" },
            { "slot": "slot_6", "role": "vanilla_townie" }
        ],
        "setup_phases": [
            {
                "phase": "N01",
                "seed": seed + 33_000,
                "actions": [{
                    "actor_slot": "slot_1",
                    "template_id": "cult_recruit",
                    "action_id": format!("generated_seed_{seed}_cult_recruit_cop"),
                    "targets": ["slot_3"]
                }]
            },
            {
                "phase": "N02",
                "seed": seed + 34_000,
                "actions": [{
                    "actor_slot": "slot_2",
                    "template_id": "deprogram",
                    "action_id": format!("generated_seed_{seed}_deprogram_cop"),
                    "targets": ["slot_3"]
                }]
            }
        ],
        "actions": [
            {
                "actor_slot": "slot_3",
                "template_id": "cop_investigate",
                "action_id": format!("generated_seed_{seed}_restored_cop_check"),
                "targets": ["slot_4"]
            }
        ],
        "expectations": {
            "inner_events": [
                {
                    "kind": "InvestigationResult",
                    "payload": {
                        "mode": "Parity",
                        "investigator": "slot_3",
                        "target": "slot_4",
                        "result": "scum"
                    }
                }
            ],
            "trace_decisions": [
                {
                    "stage": "night:conversion",
                    "source": format!("action:generated_seed_{seed}_cult_recruit_cop"),
                    "outcome": "conversion_assigned_role",
                    "detail": {
                        "action_id": format!("generated_seed_{seed}_cult_recruit_cop"),
                        "template_id": "cult_recruit",
                        "actor": "slot_1",
                        "target": "slot_3",
                        "mode": "AssignRole",
                        "new_role": "cultist",
                        "new_alignment": "cult",
                        "original_role": "cop",
                        "original_alignment": "town",
                        "origin_source": null
                    }
                },
                {
                    "stage": "night:conversion",
                    "source": format!("action:generated_seed_{seed}_deprogram_cop"),
                    "outcome": "conversion_restored_original",
                    "detail": {
                        "action_id": format!("generated_seed_{seed}_deprogram_cop"),
                        "template_id": "deprogram",
                        "actor": "slot_2",
                        "target": "slot_3",
                        "mode": "RestoreOriginal",
                        "new_role": "cop",
                        "new_alignment": "town",
                        "original_role": "cultist",
                        "original_alignment": "cult",
                        "origin_source": "slot_1"
                    }
                }
            ]
        }
    }))
    .expect("generated Mafiascum conversion/deprogramming fixture serializes")
}

fn generated_mafiascum_conversion_projection_state_fixture_json(seed: u64) -> String {
    let mut fixture: serde_json::Value = serde_json::from_str(
        &generated_mafiascum_conversion_deprogramming_fixture_json(seed),
    )
    .expect("generated Mafiascum conversion/deprogramming fixture parses");
    fixture["expectations"]["slot_states"] = serde_json::json!([
        {
            "payload": {
                "slot_id": "slot_3",
                "alive": true,
                "status": "alive",
                "role_key": "cop",
                "alignment": "town",
                "role_revealed": false,
                "alignment_revealed": false
            }
        }
    ]);
    serde_json::to_string_pretty(&fixture)
        .expect("generated Mafiascum conversion projection-state fixture serializes")
}

fn generated_mafiascum_persistent_effect_fixture_json(family: &str, seed: u64) -> String {
    match family {
        "ignite" => serde_json::to_string_pretty(&serde_json::json!({
            "seed": seed + 33_000,
            "pack": "mafiascum",
            "phase": "N02",
            "roster": [
                { "slot": "slot_1", "role": "arsonist" },
                { "slot": "slot_2", "role": "vanilla_townie" },
                { "slot": "slot_3", "role": "vanilla_townie" },
                { "slot": "slot_4", "role": "vanilla_townie" },
                { "slot": "slot_5", "role": "mafia_goon" },
                { "slot": "slot_6", "role": "vanilla_townie" }
            ],
            "setup_phases": [
                {
                    "phase": "N01",
                    "seed": seed + 32_000,
                    "actions": [{
                        "actor_slot": "slot_1",
                        "template_id": "douse",
                        "action_id": format!("generated_seed_{seed}_douse_for_later_ignite"),
                        "targets": ["slot_2"]
                    }]
                }
            ],
            "actions": [
                {
                    "actor_slot": "slot_1",
                    "template_id": "ignite",
                    "action_id": format!("generated_seed_{seed}_ignite_carried_douse"),
                    "targets": []
                },
                {
                    "actor_slot": "slot_1",
                    "template_id": "douse",
                    "action_id": format!("generated_seed_{seed}_fresh_douse_noise"),
                    "targets": ["slot_3"]
                }
            ],
            "expectations": {
                "inner_events": [
                    {
                        "kind": "PlayerKilled",
                        "payload": {
                            "slot_id": "slot_2",
                            "cause": "ignite",
                            "attackers": ["slot_1"],
                            "unstoppable": false
                        }
                    },
                    {
                        "kind": "PhaseAnnouncement",
                        "payload": {
                            "phase_id": "N02",
                            "deaths": [{
                                "slot_id": "slot_2",
                                "cause": "ignite"
                            }]
                        }
                    }
                ]
            }
        }))
        .expect("generated Mafiascum persistent effect fixture serializes"),
        "mark_clear_visibility" => serde_json::to_string_pretty(&serde_json::json!({
            "seed": seed + 33_000,
            "pack": "mafiascum",
            "phase": "N02",
            "roster": [
                { "slot": "slot_1", "role": "arsonist" },
                { "slot": "slot_2", "role": "cleanser" },
                { "slot": "slot_3", "role": "vanilla_townie" },
                { "slot": "slot_4", "role": "vanilla_townie" },
                { "slot": "slot_5", "role": "mafia_goon" },
                { "slot": "slot_6", "role": "vanilla_townie" }
            ],
            "setup_phases": [
                {
                    "phase": "N01",
                    "seed": seed + 32_000,
                    "actions": [{
                        "actor_slot": "slot_1",
                        "template_id": "douse",
                        "action_id": format!("generated_seed_{seed}_douse_for_cleanse"),
                        "targets": ["slot_3"]
                    }]
                }
            ],
            "actions": [
                {
                    "actor_slot": "slot_2",
                    "template_id": "cleanse",
                    "action_id": format!("generated_seed_{seed}_cleanse_carried_douse"),
                    "targets": ["slot_3"]
                },
                {
                    "actor_slot": "slot_1",
                    "template_id": "ignite",
                    "action_id": format!("generated_seed_{seed}_ignite_after_cleanse"),
                    "targets": []
                },
                {
                    "actor_slot": "slot_1",
                    "template_id": "douse",
                    "action_id": format!("generated_seed_{seed}_fresh_visible_douse"),
                    "targets": ["slot_4"]
                }
            ],
            "expectations": {
                "inner_events": [
                    {
                        "kind": "EffectNotification",
                        "payload": {
                            "effect": "doused",
                            "status": "cleared",
                            "audience": ["slot_2", "slot_3"]
                        }
                    },
                    {
                        "kind": "EffectsCleared",
                        "payload": {
                            "effect": "doused",
                            "targets": ["slot_3"],
                            "actor": "slot_2"
                        }
                    },
                    {
                        "kind": "EffectsMarked",
                        "payload": {
                            "effect": "doused",
                            "target": "slot_4",
                            "actor": "slot_1",
                            "source_action": format!("generated_seed_{seed}_fresh_visible_douse"),
                            "phase_id": "N02",
                            "phase_kind": "Night",
                            "phase_number": 2,
                            "duration": "Persistent",
                            "visibility": "ActorAndTarget"
                        }
                    },
                    {
                        "kind": "PhaseAnnouncement",
                        "payload": {
                            "phase_id": "N02",
                            "deaths": []
                        }
                    }
                ],
                "trace_decisions": [
                    {
                        "stage": "night:read_effect",
                        "source": format!("action:generated_seed_{seed}_ignite_after_cleanse"),
                        "outcome": "read_effect_target_preempted_by_clear",
                        "detail": {
                            "action_id": format!("generated_seed_{seed}_ignite_after_cleanse"),
                            "template_id": "ignite",
                            "actor": "slot_1",
                            "target": "slot_3",
                            "reads_effect": "doused"
                        }
                    }
                ]
            }
        }))
        .expect("generated Mafiascum mark/clear visibility fixture serializes"),
        "poison_cure" => serde_json::to_string_pretty(&serde_json::json!({
            "seed": seed + 33_000,
            "pack": "mafiascum",
            "phase": "N02",
            "roster": [
                { "slot": "slot_1", "role": "poisoner" },
                { "slot": "slot_2", "role": "poison_doctor" },
                { "slot": "slot_3", "role": "vanilla_townie" },
                { "slot": "slot_4", "role": "mafia_goon" },
                { "slot": "slot_5", "role": "vanilla_townie" },
                { "slot": "slot_6", "role": "mafia_goon" }
            ],
            "setup_phases": [
                {
                    "phase": "N01",
                    "seed": seed + 32_000,
                    "actions": [{
                        "actor_slot": "slot_1",
                        "template_id": "poison",
                        "action_id": format!("generated_seed_{seed}_poison_for_cure"),
                        "targets": ["slot_3"]
                    }]
                }
            ],
            "actions": [
                {
                    "actor_slot": "slot_2",
                    "template_id": "cure_poison",
                    "action_id": format!("generated_seed_{seed}_cure_pending_poison"),
                    "targets": ["slot_3"]
                },
                {
                    "actor_slot": "slot_1",
                    "template_id": "poison",
                    "action_id": format!("generated_seed_{seed}_fresh_poison_noise"),
                    "targets": ["slot_5"]
                }
            ],
            "expectations": {
                "inner_events": [
                    {
                        "kind": "EffectNotification",
                        "payload": {
                            "effect": "poisoned",
                            "status": "cleared",
                            "audience": ["slot_3"]
                        }
                    },
                    {
                        "kind": "EffectsCleared",
                        "payload": {
                            "effect": "poisoned",
                            "targets": ["slot_3"],
                            "actor": "slot_2"
                        }
                    },
                    {
                        "kind": "DelayedDeathResolved",
                        "payload": {
                            "queue_id": format!("poisoned:slot_3:generated_seed_{seed}_poison_for_cure"),
                            "target": "slot_3",
                            "cause": "poison",
                            "effect": "poisoned",
                            "outcome": "preempted_by_clear",
                            "phase_id": "N02",
                            "phase_kind": "Night",
                            "phase_number": 2
                        }
                    },
                    {
                        "kind": "PhaseAnnouncement",
                        "payload": {
                            "phase_id": "N02",
                            "deaths": []
                        }
                    }
                ],
                "trace_decisions": [
                    {
                        "stage": "night:pending_effect",
                        "source": format!("delayed_death:poisoned:slot_3:generated_seed_{seed}_poison_for_cure"),
                        "outcome": "pending_poison_preempted_by_clear",
                        "detail": {
                            "target": "slot_3",
                            "effect": "poisoned",
                            "cause": "poison",
                            "source": "slot_1",
                            "source_action": format!("generated_seed_{seed}_poison_for_cure")
                        }
                    }
                ],
                "player_notifications": [
                    {
                        "payload": {
                            "phase_id": "N02",
                            "audience_slot": "slot_3",
                            "effect": "poisoned",
                            "status": "cleared"
                        }
                    }
                ],
                "delayed_death_queues": [
                    {
                        "payload": {
                            "queue_id": format!("poisoned:slot_5:generated_seed_{seed}_fresh_poison_noise"),
                            "target_slot": "slot_5",
                            "cause": "poison",
                            "effect": "poisoned",
                            "source_slot": "slot_1",
                            "source_action": format!("generated_seed_{seed}_fresh_poison_noise"),
                            "phase_id": "N02",
                            "phase_kind": "Night",
                            "phase_number": 2
                        }
                    }
                ],
                "absent_delayed_death_queues": [
                    {
                        "payload": {
                            "queue_id": format!("poisoned:slot_3:generated_seed_{seed}_poison_for_cure"),
                            "target_slot": "slot_3",
                            "source_action": format!("generated_seed_{seed}_poison_for_cure")
                        }
                    }
                ],
                "slot_effects": [
                    {
                        "payload": {
                            "slot_id": "slot_5",
                            "effect": "poisoned",
                            "source_slot": "slot_1",
                            "source_action": format!("generated_seed_{seed}_fresh_poison_noise"),
                            "phase_id": "N02",
                            "phase_kind": "Night",
                            "phase_number": 2,
                            "duration": "Persistent",
                            "visibility": "Target"
                        }
                    }
                ],
                "absent_slot_effects": [
                    {
                        "payload": {
                            "slot_id": "slot_3",
                            "effect": "poisoned",
                            "source_action": format!("generated_seed_{seed}_poison_for_cure")
                        }
                    }
                ]
            }
        }))
        .expect("generated Mafiascum poison/cure delayed-effect fixture serializes"),
        "mark_clear_expiry" => serde_json::to_string_pretty(&serde_json::json!({
            "seed": seed + 33_000,
            "pack": "mafiascum",
            "phase": "N02",
            "roster": [
                { "slot": "slot_1", "role": "fruit_vendor" },
                { "slot": "slot_2", "role": "vanilla_townie" },
                { "slot": "slot_3", "role": "vanilla_townie" },
                { "slot": "slot_4", "role": "mafia_goon" },
                { "slot": "slot_5", "role": "vanilla_townie" },
                { "slot": "slot_6", "role": "mafia_goon" }
            ],
            "setup_phases": [
                {
                    "phase": "N01",
                    "seed": seed + 32_000,
                    "actions": [{
                        "actor_slot": "slot_1",
                        "template_id": "send_fruit",
                        "action_id": format!("generated_seed_{seed}_send_fruit_expiring_setup"),
                        "targets": ["slot_2"]
                    }]
                }
            ],
            "actions": [
                {
                    "actor_slot": "slot_1",
                    "template_id": "send_fruit",
                    "action_id": format!("generated_seed_{seed}_send_fruit_expiring_target"),
                    "targets": ["slot_3"]
                }
            ],
            "expectations": {
                "inner_events": [
                    {
                        "kind": "EffectNotification",
                        "payload": {
                            "effect": "fruit_received",
                            "status": "marked",
                            "audience": ["slot_3"]
                        }
                    },
                    {
                        "kind": "PhaseAnnouncement",
                        "payload": {
                            "phase_id": "N02",
                            "deaths": []
                        }
                    }
                ],
                "player_notifications": [
                    {
                        "payload": {
                            "phase_id": "N01",
                            "audience_slot": "slot_2",
                            "effect": "fruit_received",
                            "status": "marked"
                        }
                    },
                    {
                        "payload": {
                            "phase_id": "N02",
                            "audience_slot": "slot_3",
                            "effect": "fruit_received",
                            "status": "marked"
                        }
                    }
                ],
                "absent_slot_effects": [
                    {
                        "payload": {
                            "slot_id": "slot_2",
                            "effect": "fruit_received",
                            "source_action": format!("generated_seed_{seed}_send_fruit_expiring_setup")
                        }
                    },
                    {
                        "payload": {
                            "slot_id": "slot_3",
                            "effect": "fruit_received",
                            "source_action": format!("generated_seed_{seed}_send_fruit_expiring_target")
                        }
                    }
                ]
            }
        }))
        .expect("generated Mafiascum mark/clear expiry fixture serializes"),
        _ => unreachable!("unknown generated persistent effect family"),
    }
}

fn generated_mafiascum_generated_action_fixture_json(family: &str, seed: u64) -> String {
    match family {
        "extra_action" => serde_json::to_string_pretty(&serde_json::json!({
            "seed": seed + 34_000,
            "pack": "mafiascum",
            "phase": "N02",
            "roster": [
                { "slot": "slot_1", "role": "motivator" },
                { "slot": "slot_2", "role": "cop" },
                { "slot": "slot_3", "role": "mafia_goon" },
                { "slot": "slot_4", "role": "vanilla_townie" },
                { "slot": "slot_5", "role": "vanilla_townie" },
                { "slot": "slot_6", "role": "mafia_goon" }
            ],
            "setup_phases": [
                {
                    "phase": "N01",
                    "seed": seed + 33_000,
                    "actions": [{
                        "actor_slot": "slot_1",
                        "template_id": "motivate",
                        "action_id": format!("generated_seed_{seed}_motivate_extra_action"),
                        "targets": ["slot_2"]
                    }]
                }
            ],
            "actions": [
                {
                    "actor_slot": "slot_2",
                    "template_id": "cop_investigate",
                    "action_id": format!("generated_seed_{seed}_cop_base"),
                    "targets": ["slot_3"]
                },
                {
                    "actor_slot": "slot_2",
                    "template_id": "cop_investigate",
                    "action_id": format!("generated_seed_{seed}_cop_extra"),
                    "targets": ["slot_4"],
                    "grant_id": "extra_action"
                }
            ],
            "expectations": {
                "inner_events": [
                    {
                        "kind": "ActionGrantConsumed",
                        "payload": {
                            "grant_id": "extra_action",
                            "actor": "slot_2",
                            "action_id": format!("generated_seed_{seed}_cop_extra"),
                            "source_action": format!("generated_seed_{seed}_motivate_extra_action"),
                            "phase_id": "N02",
                            "phase_kind": "Night",
                            "phase_number": 2,
                            "remaining_uses": 0
                        }
                    },
                    {
                        "kind": "InvestigationResult",
                        "payload": {
                            "mode": "Parity",
                            "investigator": "slot_2",
                            "target": "slot_3",
                            "result": "scum"
                        }
                    },
                    {
                        "kind": "InvestigationResult",
                        "payload": {
                            "mode": "Parity",
                            "investigator": "slot_2",
                            "target": "slot_4",
                            "result": "town"
                        }
                    }
                ],
                "generated_actions": [
                    {
                        "action_id": "extra_action",
                        "source": "ActionGranted",
                        "actor": "slot_1",
                        "targets": ["slot_2"],
                        "detail": {
                            "kind": "ExtraAction",
                            "source_action": format!("generated_seed_{seed}_motivate_extra_action"),
                            "uses": 1,
                            "phase_id": "N01",
                            "phase_kind": "Night",
                            "phase_number": 1
                        }
                    },
                    {
                        "action_id": format!("generated_seed_{seed}_cop_extra"),
                        "source": "ActionGrantConsumed",
                        "actor": "slot_2",
                        "targets": [],
                        "detail": {
                            "grant_id": "extra_action",
                            "source_action": format!("generated_seed_{seed}_motivate_extra_action"),
                            "remaining_uses": 0
                        }
                    }
                ]
            }
        }))
        .expect("generated Mafiascum generated-action fixture serializes"),
        "item_grant" => serde_json::to_string_pretty(&serde_json::json!({
            "seed": seed + 34_000,
            "pack": "mafiascum",
            "phase": "N02",
            "roster": [
                { "slot": "slot_1", "role": "inventor" },
                { "slot": "slot_2", "role": "vanilla_townie" },
                { "slot": "slot_3", "role": "mafia_goon" },
                { "slot": "slot_4", "role": "vanilla_townie" },
                { "slot": "slot_5", "role": "mafia_goon" },
                { "slot": "slot_6", "role": "vanilla_townie" }
            ],
            "setup_phases": [
                {
                    "phase": "N01",
                    "seed": seed + 33_000,
                    "actions": [{
                        "actor_slot": "slot_1",
                        "template_id": "grant_vest_item",
                        "action_id": format!("generated_seed_{seed}_grant_vest_item"),
                        "targets": ["slot_2"]
                    }]
                }
            ],
            "actions": [
                {
                    "actor_slot": "slot_2",
                    "template_id": "bulletproof_vest_item",
                    "action_id": format!("generated_seed_{seed}_use_vest_item"),
                    "targets": ["slot_2"],
                    "grant_id": "bulletproof_vest_item"
                },
                {
                    "actor_slot": "slot_3",
                    "template_id": "factional_kill",
                    "action_id": format!("generated_seed_{seed}_mafia_noise_kill"),
                    "targets": ["slot_4"]
                }
            ],
            "expectations": {
                "inner_events": [
                    {
                        "kind": "ActionGrantConsumed",
                        "payload": {
                            "grant_id": "bulletproof_vest_item",
                            "actor": "slot_2",
                            "action_id": format!("generated_seed_{seed}_use_vest_item"),
                            "source_action": format!("generated_seed_{seed}_grant_vest_item"),
                            "phase_id": "N02",
                            "phase_kind": "Night",
                            "phase_number": 2,
                            "remaining_uses": 0
                        }
                    },
                    {
                        "kind": "ActionUseCounted",
                        "payload": {
                            "counter_id": "inventory:bulletproof_vest_item",
                            "actor": "slot_2",
                            "template_id": "bulletproof_vest_item",
                            "consumed_action": format!("generated_seed_{seed}_use_vest_item"),
                            "cadence_policy": "inventory",
                            "phase_scope": "grant",
                            "remaining": 0
                        }
                    },
                    {
                        "kind": "EffectsMarked",
                        "payload": {
                            "effect": "bulletproof_vest",
                            "target": "slot_2",
                            "actor": "slot_2",
                            "source_action": format!("generated_seed_{seed}_use_vest_item"),
                            "phase_id": "N02",
                            "phase_kind": "Night",
                            "phase_number": 2
                        }
                    }
                ],
                "generated_actions": [
                    {
                        "action_id": "bulletproof_vest_item",
                        "source": "ActionGranted",
                        "actor": "slot_1",
                        "targets": ["slot_2"],
                        "detail": {
                            "kind": "Item",
                            "source_action": format!("generated_seed_{seed}_grant_vest_item"),
                            "uses": 1,
                            "phase_id": "N01",
                            "phase_kind": "Night",
                            "phase_number": 1
                        }
                    },
                    {
                        "action_id": format!("generated_seed_{seed}_use_vest_item"),
                        "source": "ActionGrantConsumed",
                        "actor": "slot_2",
                        "targets": [],
                        "detail": {
                            "grant_id": "bulletproof_vest_item",
                            "source_action": format!("generated_seed_{seed}_grant_vest_item"),
                            "remaining_uses": 0
                        }
                    }
                ]
            }
        }))
        .expect("generated Mafiascum item-grant fixture serializes"),
        "private_notification" => serde_json::to_string_pretty(&serde_json::json!({
            "seed": seed + 34_000,
            "pack": "mafiascum",
            "phase": "N02",
            "roster": [
                { "slot": "slot_1", "role": "inventor" },
                { "slot": "slot_2", "role": "vanilla_townie" },
                { "slot": "slot_3", "role": "mafia_goon" },
                { "slot": "slot_4", "role": "vanilla_townie" },
                { "slot": "slot_5", "role": "mafia_goon" },
                { "slot": "slot_6", "role": "vanilla_townie" }
            ],
            "setup_phases": [
                {
                    "phase": "N01",
                    "seed": seed + 33_000,
                    "actions": [{
                        "actor_slot": "slot_1",
                        "template_id": "grant_vest_item",
                        "action_id": format!("generated_seed_{seed}_private_grant_vest_item"),
                        "targets": ["slot_2"]
                    }]
                }
            ],
            "actions": [
                {
                    "actor_slot": "slot_2",
                    "template_id": "bulletproof_vest_item",
                    "action_id": format!("generated_seed_{seed}_private_use_vest_item"),
                    "targets": ["slot_2"],
                    "grant_id": "bulletproof_vest_item"
                },
                {
                    "actor_slot": "slot_3",
                    "template_id": "factional_kill",
                    "action_id": format!("generated_seed_{seed}_private_notification_noise_kill"),
                    "targets": ["slot_4"]
                }
            ],
            "expectations": {
                "inner_events": [
                    {
                        "kind": "ActionGrantConsumed",
                        "payload": {
                            "grant_id": "bulletproof_vest_item",
                            "actor": "slot_2",
                            "action_id": format!("generated_seed_{seed}_private_use_vest_item"),
                            "source_action": format!("generated_seed_{seed}_private_grant_vest_item"),
                            "phase_id": "N02",
                            "phase_kind": "Night",
                            "phase_number": 2,
                            "remaining_uses": 0
                        }
                    },
                    {
                        "kind": "ActionUseCounted",
                        "payload": {
                            "counter_id": "inventory:bulletproof_vest_item",
                            "actor": "slot_2",
                            "template_id": "bulletproof_vest_item",
                            "consumed_action": format!("generated_seed_{seed}_private_use_vest_item"),
                            "cadence_policy": "inventory",
                            "phase_scope": "grant",
                            "remaining": 0
                        }
                    },
                    {
                        "kind": "EffectsMarked",
                        "payload": {
                            "effect": "bulletproof_vest",
                            "target": "slot_2",
                            "actor": "slot_2",
                            "source_action": format!("generated_seed_{seed}_private_use_vest_item"),
                            "phase_id": "N02",
                            "phase_kind": "Night",
                            "phase_number": 2
                        }
                    }
                ],
                "generated_actions": [
                    {
                        "action_id": "bulletproof_vest_item",
                        "source": "ActionGranted",
                        "actor": "slot_1",
                        "targets": ["slot_2"],
                        "detail": {
                            "kind": "Item",
                            "source_action": format!("generated_seed_{seed}_private_grant_vest_item"),
                            "uses": 1,
                            "phase_id": "N01",
                            "phase_kind": "Night",
                            "phase_number": 1
                        }
                    },
                    {
                        "action_id": format!("generated_seed_{seed}_private_use_vest_item"),
                        "source": "ActionGrantConsumed",
                        "actor": "slot_2",
                        "targets": [],
                        "detail": {
                            "grant_id": "bulletproof_vest_item",
                            "source_action": format!("generated_seed_{seed}_private_grant_vest_item"),
                            "remaining_uses": 0
                        }
                    }
                ],
                "player_notifications": [
                    {
                        "payload": {
                            "phase_id": "N01",
                            "audience_slot": "slot_2",
                            "effect": "grant",
                            "status": "bulletproof_vest_item"
                        }
                    }
                ]
            }
        }))
        .expect("generated Mafiascum private-notification fixture serializes"),
        _ => unreachable!("unknown generated-action family"),
    }
}

fn generated_case_fixture_json(
    case: &GeneratedNightCase,
    pack: &str,
    phase: &str,
    resolver_seed: u64,
) -> String {
    let mut fixture = serde_json::json!({
        "seed": resolver_seed,
        "pack": pack,
        "phase": phase,
        "roster": case.roster.iter().map(|(slot, role)| {
            serde_json::json!({
                "slot": slot,
                "role": role,
            })
        }).collect::<Vec<_>>(),
        "actions": case.actions.iter().map(|action| {
            serde_json::json!({
                "actor_slot": action.actor_slot,
                "template_id": action.template_id,
                "action_id": action.action_id,
                "targets": action.targets,
            })
        }).collect::<Vec<_>>(),
    });
    if let Some(expectations) = generated_case_expectations_json(case, pack, phase) {
        fixture["expectations"] = expectations;
    }
    serde_json::to_string_pretty(&fixture).expect("generated fixture JSON serializes")
}

struct GeneratedShrinkArtifacts {
    fixture_path: PathBuf,
    reduced_path: PathBuf,
    report_path: PathBuf,
}

impl GeneratedShrinkArtifacts {
    fn new(stem: &str) -> Self {
        let root = generated_shrink_artifact_root();
        GeneratedShrinkArtifacts {
            fixture_path: root.join(format!("{stem}.fixture.tmp.json")),
            reduced_path: root.join(format!("{stem}.reduced.tmp.json")),
            report_path: root.join(format!("{stem}.report.tmp.json")),
        }
    }

    fn remove_existing(&self) {
        for path in [&self.fixture_path, &self.reduced_path, &self.report_path] {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => panic!("remove stale generated shrink artifact {path:?}: {err}"),
            }
        }
    }

    fn write_fixture(&self, fixture_json: &str) {
        write_generated_shrink_artifact(&self.fixture_path, fixture_json);
    }

    async fn run_minimizer(&self, pool: &PgPool) -> serde_json::Value {
        self.try_run_minimizer(pool)
            .await
            .unwrap_or_else(|err| panic!("{err}"))
    }

    async fn run_minimizer_with_preprovisioned_principals(
        &self,
        pool: &PgPool,
    ) -> serde_json::Value {
        self.try_run_minimizer_with_principal_setup(pool, false)
            .await
            .unwrap_or_else(|err| panic!("{err}"))
    }

    async fn try_run_minimizer(&self, pool: &PgPool) -> Result<serde_json::Value, String> {
        self.try_run_minimizer_with_principal_setup(pool, true)
            .await
    }

    async fn try_run_minimizer_with_principal_setup(
        &self,
        pool: &PgPool,
        provision_principals: bool,
    ) -> Result<serde_json::Value, String> {
        let fixture_json = fs::read_to_string(&self.fixture_path)
            .map_err(|err| format!("read generated minimizer fixture: {err}"))?;
        if provision_principals {
            ensure_minimizer_fixture_principals(pool, &fixture_json).await?;
        }
        let reduced_path_label = self.reduced_path.to_string_lossy().into_owned();
        let artifacts = operator_proof::minimizer::minimize_fixture_json(
            pool,
            &fixture_json,
            true,
            Some(&reduced_path_label),
        )
        .await?;
        write_generated_shrink_artifact(
            &self.reduced_path,
            &serde_json::to_string_pretty(&artifacts.reduced_fixture)
                .map_err(|err| format!("serialize reduced minimizer fixture: {err}"))?,
        );
        write_generated_shrink_artifact(
            &self.report_path,
            &serde_json::to_string_pretty(&artifacts.report)
                .map_err(|err| format!("serialize minimizer report: {err}"))?,
        );
        Ok(artifacts.report)
    }
}

async fn ensure_minimizer_fixture_principals(
    pool: &PgPool,
    fixture_json: &str,
) -> Result<(), String> {
    let principals = minimizer_fixture_principals(fixture_json)?;
    ensure_test_principals(pool, principals.iter().map(String::as_str)).await;
    Ok(())
}

fn minimizer_fixture_principals(fixture_json: &str) -> Result<BTreeSet<String>, String> {
    let fixture: serde_json::Value = serde_json::from_str(fixture_json)
        .map_err(|err| format!("parse generated minimizer identity fixture: {err}"))?;
    let roster = fixture
        .get("roster")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "generated minimizer fixture is missing roster".to_string())?;
    let mut principals = BTreeSet::from(["fixture_host".to_string()]);
    for slot in roster {
        let slot = slot
            .get("slot")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "generated minimizer roster entry is missing slot".to_string())?;
        let slot_number = slot
            .strip_prefix("slot_")
            .and_then(|number| number.parse::<usize>().ok())
            .unwrap_or(0);
        principals.insert(format!("fixture_user_{slot_number}"));
    }
    Ok(principals)
}

fn generated_shrink_matrix_principals(
    cases: &[GeneratedShrinkMatrixCase],
) -> Result<BTreeSet<String>, String> {
    let mut principals = BTreeSet::new();
    for case in cases {
        principals.extend(minimizer_fixture_principals(&case.success_fixture_json)?);
        principals.extend(minimizer_fixture_principals(&case.bad_fixture_json)?);
    }
    Ok(principals)
}

async fn generated_shrink_failure_message(
    pool: &PgPool,
    stem: &str,
    fixture_json: &str,
    summary: &str,
    reason: String,
) -> String {
    let artifacts = GeneratedShrinkArtifacts::new(stem);
    artifacts.remove_existing();
    artifacts.write_fixture(fixture_json);
    match artifacts.try_run_minimizer(pool).await {
        Ok(report) => format!(
            "{summary}\n{reason}\n{}",
            generated_shrink_report_summary(&artifacts, &report)
        ),
        Err(err) => format!(
            "{summary}\n{reason}\ngenerated shrink report failed for fixture {}: {err}",
            artifacts.fixture_path.display()
        ),
    }
}

async fn generated_handle_or_shrink(
    pool: &PgPool,
    principal: &Principal,
    command: Command,
    stem: &str,
    fixture_json: &str,
    summary: &str,
    reason: impl Into<String>,
) -> Ack {
    match handle(pool, principal, command).await {
        Ok(ack) => ack,
        Err(err) => {
            panic!(
                "{}",
                generated_shrink_failure_message(
                    pool,
                    stem,
                    fixture_json,
                    summary,
                    format!("{}: {err}", reason.into()),
                )
                .await
            )
        }
    }
}

fn generated_shrink_report_summary(
    artifacts: &GeneratedShrinkArtifacts,
    report: &serde_json::Value,
) -> String {
    format!(
        "generated shrink report: path={} reduced={} failure_class_preserved={} success_invariant_preserved={} promoted_success_fixture={} reduction_steps={}",
        artifacts.report_path.display(),
        artifacts.reduced_path.display(),
        json_bool_or_null(&report["reduction"]["failure_class_preserved"]),
        json_bool_or_null(&report["reduction"]["success_invariant_preserved"]),
        json_bool_or_null(&report["write_reduced"]["promoted_success_fixture"]),
        report["reduction_steps"].as_array().map_or(0, Vec::len),
    )
}

fn json_bool_or_null(value: &serde_json::Value) -> String {
    value
        .as_bool()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string())
}

fn generated_shrink_artifact_root() -> PathBuf {
    if let Ok(root) = std::env::var("FMARCH_GENERATED_SHRINK_DIR") {
        return PathBuf::from(root);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("commands crate lives under workspace crates/")
        .join("target/operator-proof")
}

fn write_generated_shrink_artifact(path: &Path, text: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create generated shrink artifact directory");
    }
    fs::write(path, format!("{text}\n")).expect("write generated shrink artifact");
}

fn generated_case_expectations_json(
    case: &GeneratedNightCase,
    pack: &str,
    phase: &str,
) -> Option<serde_json::Value> {
    match (pack, phase) {
        ("mafiascum", "N01") => generated_mafiascum_night_expectations_json(case),
        ("chinese_structured", "N01") => generated_chinese_night_expectations_json(case),
        ("chinese_structured", "D01") => generated_chinese_day_expectations_json(case),
        ("mafia_universe", "D01") => generated_mafia_universe_ita_expectations_json(case),
        ("epicmafia", "N01") => generated_epicmafia_night_expectations_json(case),
        ("default_open", "N01") => generated_default_open_night_expectations_json(case),
        _ => None,
    }
}

fn generated_mafiascum_night_expectations_json(
    case: &GeneratedNightCase,
) -> Option<serde_json::Value> {
    if has_generated_target_mutator(case) {
        return None;
    }

    let mut inner_events = Vec::new();
    let mut trace_decisions = Vec::new();
    let mut generated_actions = Vec::new();

    for action in &case.actions {
        if action.template_id == "roleblocker_block"
            && action.targets.len() == 1
            && generated_role_for(case, &action.targets[0]) == Some("paranoid_gun_owner")
        {
            let pgo = &action.targets[0];
            inner_events.push(serde_json::json!({
                "kind": "Trigger",
                "payload": {
                    "trigger_id": "pgo_shoots_visitor",
                    "payload": {
                        "on": "Visit",
                        "source_target": pgo,
                        "source_actor": action.actor_slot,
                        "source_cause": "roleblocker_block",
                        "produced_actor": pgo,
                        "produced_target": action.actor_slot,
                    }
                }
            }));
            generated_actions.push(serde_json::json!({
                "action_id": "pgo_shoots_visitor",
                "source": "Trigger",
                "actor": pgo,
                "targets": [action.actor_slot],
                "detail": {
                    "on": "Visit",
                    "source_target": pgo,
                    "source_actor": action.actor_slot,
                    "source_cause": "roleblocker_block",
                    "produced_actor": pgo,
                    "produced_target": action.actor_slot,
                }
            }));
        }

        if action.template_id == "babysit"
            && action.targets.len() == 1
            && generated_role_for(case, &action.actor_slot) == Some("babysitter")
            && !generated_actor_is_suppressed(case, &action.actor_slot)
        {
            let ward = &action.targets[0];
            let babysitter = &action.actor_slot;
            let ward_has_simple_kill = case.actions.iter().any(|candidate| {
                candidate.template_id == "factional_kill"
                    && candidate.targets == vec![ward.to_string()]
            });
            let babysitter_dies = case.actions.iter().any(|candidate| {
                candidate.template_id == "factional_kill"
                    && candidate.targets == vec![babysitter.to_string()]
            });
            if ward_has_simple_kill && babysitter_dies {
                inner_events.push(serde_json::json!({
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": ward,
                        "cause": "babysit",
                        "attackers": [babysitter],
                        "unstoppable": true,
                    }
                }));
                trace_decisions.push(serde_json::json!({
                    "stage": "night:dependency_death",
                    "source": format!("action:{}", action.action_id),
                    "outcome": "babysitter_dependency_death",
                    "detail": {
                        "action_id": action.action_id,
                        "template_id": "babysit",
                        "protector": babysitter,
                        "ward": ward,
                        "cause": "babysit",
                        "attackers": [babysitter],
                    }
                }));
            }
        }

        if action.template_id == "hide"
            && action.targets.len() == 1
            && generated_role_for(case, &action.actor_slot) == Some("hider")
            && !generated_actor_is_suppressed(case, &action.actor_slot)
        {
            let host = &action.targets[0];
            let hider = &action.actor_slot;
            let host_has_simple_kill = case.actions.iter().any(|candidate| {
                candidate.template_id == "factional_kill"
                    && candidate.targets == vec![host.to_string()]
            });
            let hider_has_direct_kill = case.actions.iter().any(|candidate| {
                is_generated_kill_template(&candidate.template_id)
                    && candidate.targets == vec![hider.to_string()]
            });
            if host_has_simple_kill && !hider_has_direct_kill {
                inner_events.push(serde_json::json!({
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": hider,
                        "cause": "hide",
                        "attackers": [host],
                        "unstoppable": true,
                    }
                }));
                trace_decisions.push(serde_json::json!({
                    "stage": "night:dependency_death",
                    "source": format!("action:{}", action.action_id),
                    "outcome": "hider_dependency_death",
                    "detail": {
                        "action_id": action.action_id,
                        "template_id": "hide",
                        "host": host,
                        "hider": hider,
                        "cause": "hide",
                        "attackers": [host],
                    }
                }));
            }
        }
    }

    if inner_events.is_empty() && trace_decisions.is_empty() && generated_actions.is_empty() {
        None
    } else {
        Some(serde_json::json!({
            "inner_events": inner_events,
            "trace_decisions": trace_decisions,
            "generated_actions": generated_actions,
        }))
    }
}

fn generated_epicmafia_night_expectations_json(
    case: &GeneratedNightCase,
) -> Option<serde_json::Value> {
    let bomb_kill = generated_action_by_template_target(case, "factional_kill", "slot_3")?;
    let plain_recruit = generated_action_by_template_target(case, "cult_recruit", "slot_4")?;
    let loyal_recruit = generated_action_by_template_target(case, "cult_recruit", "slot_5")?;

    Some(serde_json::json!({
        "inner_events": [
            {
                "kind": "Trigger",
                "payload": {
                    "trigger_id": "bomb_retaliates",
                    "payload": {
                        "on": "Kill",
                        "source_target": "slot_3",
                        "source_actor": bomb_kill.actor_slot,
                        "source_cause": "factional_kill",
                        "produced_actor": "slot_3",
                        "produced_target": bomb_kill.actor_slot,
                    }
                }
            },
            {
                "kind": "PlayerConverted",
                "payload": {
                    "target": "slot_4",
                    "new_role": "cultist",
                    "new_alignment": "cult",
                    "original_role": "villager",
                    "original_alignment": "town",
                    "source": "slot_1",
                }
            },
            {
                "kind": "ConversionBlocked",
                "payload": {
                    "target": "slot_5",
                    "status": "blocked",
                    "reason": "loyal",
                }
            }
        ],
        "trace_decisions": [
            {
                "stage": "inner_event",
                "source": "event_index:3",
                "outcome": "trigger",
                "detail": serde_json::Value::Null,
            },
            {
                "stage": "night:conversion",
                "source": format!("action:{}", plain_recruit.action_id),
                "outcome": "conversion_assigned_role",
                "detail": {
                    "action_id": plain_recruit.action_id,
                    "template_id": "cult_recruit",
                    "actor": "slot_1",
                    "target": "slot_4",
                    "mode": "AssignRole",
                    "new_role": "cultist",
                    "new_alignment": "cult",
                    "original_role": "villager",
                    "original_alignment": "town",
                    "origin_source": null,
                },
            },
            {
                "stage": "night:conversion",
                "source": format!("action:{}", loyal_recruit.action_id),
                "outcome": "conversion_blocked",
                "detail": {
                    "action_id": loyal_recruit.action_id,
                    "template_id": "cult_recruit",
                    "actor": "slot_7",
                    "target": "slot_5",
                    "target_role": "loyal_villager",
                    "target_alignment": "town",
                    "mode": "AssignRole",
                    "reason": "loyal",
                },
            }
        ],
        "trace_notes": [
            "trigger bomb_retaliates emitted at event_index 3"
        ],
        "generated_actions": [
            {
                "action_id": "bomb_retaliates",
                "source": "Trigger",
                "actor": "slot_3",
                "targets": [bomb_kill.actor_slot],
                "detail": {
                    "on": "Kill",
                    "source_target": "slot_3",
                    "source_actor": bomb_kill.actor_slot,
                    "source_cause": "factional_kill",
                    "produced_actor": "slot_3",
                    "produced_target": bomb_kill.actor_slot,
                }
            }
        ]
    }))
}

fn generated_chinese_night_expectations_json(
    case: &GeneratedNightCase,
) -> Option<serde_json::Value> {
    let mut inner_events = Vec::new();
    let mut trace_decisions = Vec::new();

    for action in &case.actions {
        match action.template_id.as_str() {
            "investigate_alignment" => {
                let target = action.targets.first()?;
                inner_events.push(serde_json::json!({
                    "kind": "InvestigationResult",
                    "payload": {
                        "mode": "Parity",
                        "investigator": action.actor_slot,
                        "target": target,
                        "result": generated_chinese_alignment_result(case, target),
                    }
                }));
            }
            "heal_potion" | "poison_potion" | "link_lovers" => {
                inner_events.push(generated_chinese_x_shot_expectation(action));
                if action.template_id == "poison_potion" {
                    let Some(target) = action.targets.first() else {
                        continue;
                    };
                    if !generated_chinese_guard_sources_for(case, target).is_empty() {
                        continue;
                    }
                    inner_events.push(serde_json::json!({
                        "kind": "PlayerKilled",
                        "payload": {
                            "slot_id": target,
                            "cause": "poison_potion",
                            "attackers": [action.actor_slot],
                            "unstoppable": false,
                        }
                    }));
                } else if action.template_id == "link_lovers" {
                    let mut slots = action.targets.clone();
                    slots.sort();
                    slots.dedup();
                    if slots.len() >= 2 {
                        inner_events.push(serde_json::json!({
                            "kind": "PlayersLinked",
                            "payload": {
                                "link_id": action.action_id,
                                "slots": slots,
                                "source": action.actor_slot,
                            }
                        }));
                        inner_events.push(serde_json::json!({
                            "kind": "EffectNotification",
                            "payload": {
                                "effect": "lovers_link",
                                "status": action.action_id,
                                "audience": slots,
                            }
                        }));
                    }
                }
            }
            "beauty_mark" => {
                let target = action.targets.first()?;
                inner_events.push(serde_json::json!({
                    "kind": "EffectsMarked",
                    "payload": {
                        "effect": "wolf_beauty_mark",
                        "target": target,
                        "actor": action.actor_slot,
                        "source_action": action.action_id,
                        "phase_id": "N01",
                        "phase_kind": "Night",
                        "phase_number": 1,
                        "duration": "Persistent",
                        "visibility": "Hidden",
                    }
                }));
                inner_events.push(serde_json::json!({
                    "kind": "WolfBeautyMarked",
                    "payload": {
                        "beauty_id": action.actor_slot,
                        "target_id": target,
                        "effect": "wolf_beauty_mark",
                        "source_action": action.action_id,
                        "phase_id": "N01",
                        "phase_kind": "Night",
                        "phase_number": 1,
                    }
                }));
            }
            "hunter_retaliate" => {
                let target = action.targets.first()?;
                inner_events.push(serde_json::json!({
                    "kind": "RetaliationArmed",
                    "payload": {
                        "retaliation_id": action.action_id,
                        "actor": action.actor_slot,
                        "target": target,
                        "source_action": "hunter_retaliate",
                    }
                }));
            }
            _ => {}
        }
    }

    for kill in case.actions.iter().filter(|action| {
        matches!(
            action.template_id.as_str(),
            "wolf_night_kill" | "poison_potion"
        )
    }) {
        let Some(target) = kill.targets.first() else {
            continue;
        };
        if generated_chinese_alignment_result(case, target) == "evil" {
            continue;
        }
        let protectors = if kill.template_id == "poison_potion" {
            generated_chinese_guard_sources_for(case, target)
        } else {
            generated_chinese_protection_sources_for(case, target)
        };
        if protectors.is_empty() {
            continue;
        }
        let sources = protectors
            .iter()
            .map(|source| source.protector.clone())
            .collect::<Vec<_>>();
        inner_events.push(serde_json::json!({
            "kind": "PlayerSaved",
            "payload": {
                "slot_id": target,
                "reasons": ["protected"],
                "sources": sources,
            }
        }));
        trace_decisions.push(serde_json::json!({
            "stage": "kill_resolution",
            "source": format!("cause:{}", kill.template_id),
            "outcome": "kill_prevented_by_protection",
            "detail": {
                "target": target,
                "attacker": kill.actor_slot,
                "cause": kill.template_id,
                "unstoppable": false,
                "protectors": protectors,
            }
        }));
    }

    if inner_events.is_empty() && trace_decisions.is_empty() {
        None
    } else {
        Some(serde_json::json!({
            "inner_events": inner_events,
            "trace_decisions": trace_decisions,
        }))
    }
}

fn generated_chinese_day_expectations_json(case: &GeneratedNightCase) -> Option<serde_json::Value> {
    let sheriff = generated_action_by_template(case, "sheriff_election")?;
    let duel = generated_action_by_template(case, "knight_duel")?;
    let self_destruct = generated_action_by_template(case, "day_self_destruct")?;
    let sheriff_target = sheriff.targets.first()?;
    let duel_target = duel.targets.first()?;
    let self_destruct_target = self_destruct.targets.first()?;
    let duel_hits_wolf = matches!(
        generated_role_for(case, duel_target),
        Some("wolf" | "white_wolf_king")
    );
    let (duel_result, duel_killed) = if duel_hits_wolf {
        ("Success", duel_target.as_str())
    } else {
        ("Failure", duel.actor_slot.as_str())
    };

    Some(serde_json::json!({
        "inner_events": [
            {
                "kind": "BadgeChanged",
                "payload": {
                    "badge_id": "sheriff_badge",
                    "owner": sheriff_target,
                    "previous_owner": null,
                    "vote_weight": 1.5,
                    "actor": sheriff.actor_slot,
                    "source_action": sheriff.action_id,
                    "reason": "elected",
                    "destroyed": false,
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1,
                }
            },
            {
                "kind": "ActionUseCounted",
                "payload": {
                    "actor": duel.actor_slot,
                    "template_id": "knight_duel",
                    "consumed_action": duel.action_id,
                    "counter_id": "x_shot:knight_duel",
                    "cadence_policy": "x_shot",
                    "phase_scope": "game",
                    "limit": 1,
                    "used": 1,
                    "remaining": 0,
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1,
                }
            },
            {
                "kind": "DuelResolved",
                "payload": {
                    "knight": duel.actor_slot,
                    "target": duel_target,
                    "result": duel_result,
                    "killed": duel_killed,
                    "source_action": duel.action_id,
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1,
                }
            },
            {
                "kind": "PlayerKilled",
                "payload": {
                    "slot_id": duel_killed,
                    "cause": "knight_duel",
                    "attackers": [duel.actor_slot],
                    "unstoppable": true,
                }
            },
            {
                "kind": "WolfSelfDestructed",
                "payload": {
                    "wolf_id": self_destruct.actor_slot,
                    "target_id": self_destruct_target,
                    "cause": "self_destruct",
                    "unstoppable": true,
                    "source_action": self_destruct.action_id,
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1,
                }
            },
            {
                "kind": "PlayerKilled",
                "payload": {
                    "slot_id": self_destruct.actor_slot,
                    "cause": "self_destruct",
                    "attackers": [self_destruct.actor_slot],
                    "unstoppable": true,
                }
            },
        ],
        "generated_actions": [
            {
                "action_id": sheriff.action_id,
                "source": "BadgeChanged",
                "actor": sheriff.actor_slot,
                "targets": [sheriff_target],
                "detail": {
                    "badge_id": "sheriff_badge",
                    "previous_owner": null,
                    "vote_weight": 1.5,
                    "reason": "elected",
                    "destroyed": false,
                }
            },
            {
                "action_id": duel.action_id,
                "source": "DuelResolved",
                "actor": duel.actor_slot,
                "targets": [duel_target],
                "detail": {
                    "result": duel_result,
                    "killed": duel_killed,
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1,
                }
            },
            {
                "action_id": self_destruct.action_id,
                "source": "WolfSelfDestructed",
                "actor": self_destruct.actor_slot,
                "targets": [self_destruct_target],
                "detail": {
                    "cause": "self_destruct",
                    "unstoppable": true,
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1,
                }
            }
        ]
    }))
}

fn generated_mafia_universe_ita_expectations_json(
    case: &GeneratedNightCase,
) -> Option<serde_json::Value> {
    let mut inner_events = vec![serde_json::json!({
        "kind": "ItaSessionOpened",
        "payload": {
            "session_id": "d1",
            "label": "Day 1 ITA",
            "day": 1,
            "window": "ita_sessions",
            "status": "open",
            "phase_id": "D01",
            "phase_kind": "Day",
            "phase_number": 1,
        }
    })];
    let mut generated_actions = Vec::new();

    for action in &case.actions {
        if action.template_id != "ita_shot" {
            continue;
        }
        let target = action.targets.first()?;
        inner_events.push(serde_json::json!({
            "kind": "ActionUseCounted",
            "payload": {
                "counter_id": "day_session:d1:ita_shot",
                "actor": action.actor_slot,
                "template_id": "ita_shot",
                "consumed_action": action.action_id,
                "cadence_policy": "day_session",
                "phase_scope": "session",
                "limit": 1,
                "used": 1,
                "remaining": 0,
                "phase_id": "D01",
                "phase_kind": "Day",
                "phase_number": 1,
            }
        }));
        inner_events.push(serde_json::json!({
            "kind": "ItaShotQueued",
            "payload": {
                "session_id": "d1",
                "action_id": action.action_id,
                "actor": action.actor_slot,
                "targets": action.targets,
            }
        }));
        inner_events.push(serde_json::json!({
            "kind": "ItaShotResolved",
            "payload": {
                "session_id": "d1",
                "action_id": action.action_id,
                "actor": action.actor_slot,
                "target": target,
                "hit_chance": 0.5,
            }
        }));
        generated_actions.push(serde_json::json!({
            "action_id": action.action_id,
            "source": "ItaShotResolved",
            "actor": action.actor_slot,
            "targets": [target],
            "detail": {
                "session_id": "d1",
                "hit_chance": 0.5,
            }
        }));
    }

    inner_events.push(serde_json::json!({
        "kind": "ItaShotResolved",
        "payload": {
            "session_id": "d1",
            "outcome": "Hit",
            "kill": true,
        }
    }));
    inner_events.push(serde_json::json!({
        "kind": "ItaShotResolved",
        "payload": {
            "session_id": "d1",
            "outcome": "Miss",
            "kill": false,
        }
    }));
    inner_events.push(serde_json::json!({
        "kind": "ItaSessionUpdated",
        "payload": {
            "session_id": "d1",
            "queue_length": 0,
            "queue_delta": -(case.actions.len() as i64),
            "shots_resolved": case.actions.len() as u64,
            "global_shots_fired": case.actions.len() as u64,
            "phase_id": "D01",
            "phase_kind": "Day",
            "phase_number": 1,
        }
    }));
    inner_events.push(serde_json::json!({
        "kind": "ItaSessionClosed",
        "payload": {
            "session_id": "d1",
            "last_status": "open",
            "phase_id": "D01",
            "phase_kind": "Day",
            "phase_number": 1,
        }
    }));

    Some(serde_json::json!({
        "inner_events": inner_events,
        "generated_actions": generated_actions,
    }))
}

fn chinese_sheriff_badge_election_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 800_001,
        "pack": "chinese_structured",
        "phase": "D01",
        "roster": [
            { "slot": "slot_1", "role": "sheriff_badge_helper" },
            { "slot": "slot_2", "role": "sheriff_badge_helper" },
            { "slot": "slot_3", "role": "sheriff_badge_helper" },
            { "slot": "slot_4", "role": "wolf" },
            { "slot": "slot_5", "role": "wolf" }
        ],
        "actions": [{
            "actor_slot": "slot_1",
            "template_id": "sheriff_election",
            "action_id": "badge_el_001",
            "targets": ["slot_2"]
        }],
        "votes": [
            { "actor_slot": "slot_2", "target_slot": "slot_4" },
            { "actor_slot": "slot_3", "target_slot": "slot_4" }
        ],
        "expectations": {
            "inner_events": [
                {
                    "kind": "BadgeChanged",
                    "payload": {
                        "badge_id": "sheriff_badge",
                        "owner": "slot_2",
                        "previous_owner": null,
                        "vote_weight": 1.5,
                        "actor": "slot_1",
                        "source_action": "badge_el_001",
                        "reason": "elected",
                        "destroyed": false,
                        "phase_id": "D01",
                        "phase_kind": "Day",
                        "phase_number": 1
                    }
                },
                {
                    "kind": "DayVoteOutcome",
                    "payload": {
                        "status": "NoMajority",
                        "winner": null,
                        "contenders": ["slot_4"],
                        "majority": 3.0,
                        "total_weight": 5.5,
                        "tallies": { "slot_4": 2.5 },
                        "weights": { "slot_2": 1.5 }
                    }
                },
                {
                    "kind": "PhaseAnnouncement",
                    "payload": {
                        "phase_id": "D01",
                        "deaths": []
                    }
                }
            ],
            "generated_actions": [{
                "action_id": "badge_el_001",
                "source": "BadgeChanged",
                "actor": "slot_1",
                "targets": ["slot_2"],
                "detail": {
                    "badge_id": "sheriff_badge",
                    "previous_owner": null,
                    "vote_weight": 1.5,
                    "reason": "elected",
                    "destroyed": false
                }
            }],
            "sheriff_badges": [{
                "payload": {
                    "badge_id": "sheriff_badge",
                    "owner_slot": "slot_2",
                    "vote_weight": 1.5,
                    "source_slot": "slot_1",
                    "source_action": "badge_el_001",
                    "reason": "elected",
                    "destroyed": false,
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            }]
        }
    }))
    .expect("Chinese sheriff badge election fixture JSON serializes")
}

fn chinese_sheriff_badge_pass_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 800_002,
        "pack": "chinese_structured",
        "phase": "D02",
        "roster": [
            { "slot": "slot_1", "role": "sheriff_badge_helper" },
            { "slot": "slot_2", "role": "sheriff_badge_helper" },
            { "slot": "slot_3", "role": "sheriff_badge_helper" },
            { "slot": "slot_4", "role": "wolf" },
            { "slot": "slot_5", "role": "wolf" }
        ],
        "setup_phases": [{
            "phase": "D01",
            "seed": 800_001,
            "actions": [{
                "actor_slot": "slot_1",
                "template_id": "sheriff_election",
                "action_id": "badge_el_001",
                "targets": ["slot_2"]
            }]
        }],
        "actions": [{
            "actor_slot": "slot_2",
            "template_id": "sheriff_pass",
            "action_id": "badge_pass_001",
            "targets": ["slot_3"]
        }],
        "votes": [
            { "actor_slot": "slot_3", "target_slot": "slot_4" },
            { "actor_slot": "slot_1", "target_slot": "slot_4" }
        ],
        "expectations": {
            "inner_events": [
                {
                    "kind": "BadgeChanged",
                    "payload": {
                        "badge_id": "sheriff_badge",
                        "owner": "slot_3",
                        "previous_owner": "slot_2",
                        "vote_weight": 1.5,
                        "actor": "slot_2",
                        "source_action": "badge_pass_001",
                        "reason": "voluntary",
                        "destroyed": false,
                        "phase_id": "D02",
                        "phase_kind": "Day",
                        "phase_number": 2
                    }
                },
                {
                    "kind": "DayVoteOutcome",
                    "payload": {
                        "status": "NoMajority",
                        "winner": null,
                        "contenders": ["slot_4"],
                        "majority": 3.0,
                        "total_weight": 5.5,
                        "tallies": { "slot_4": 2.5 },
                        "weights": { "slot_3": 1.5 }
                    }
                },
                {
                    "kind": "PhaseAnnouncement",
                    "payload": {
                        "phase_id": "D02",
                        "deaths": []
                    }
                }
            ],
            "generated_actions": [{
                "action_id": "badge_pass_001",
                "source": "BadgeChanged",
                "actor": "slot_2",
                "targets": ["slot_3"],
                "detail": {
                    "badge_id": "sheriff_badge",
                    "previous_owner": "slot_2",
                    "vote_weight": 1.5,
                    "reason": "voluntary",
                    "destroyed": false
                }
            }],
            "sheriff_badges": [{
                "payload": {
                    "badge_id": "sheriff_badge",
                    "owner_slot": "slot_3",
                    "vote_weight": 1.5,
                    "source_slot": "slot_2",
                    "source_action": "badge_pass_001",
                    "reason": "voluntary",
                    "destroyed": false,
                    "phase_id": "D02",
                    "phase_kind": "Day",
                    "phase_number": 2
                }
            }]
        }
    }))
    .expect("Chinese sheriff badge pass fixture JSON serializes")
}

fn chinese_sheriff_badge_destroy_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 800_003,
        "pack": "chinese_structured",
        "phase": "D03",
        "roster": [
            { "slot": "slot_1", "role": "sheriff_badge_helper" },
            { "slot": "slot_2", "role": "sheriff_badge_helper" },
            { "slot": "slot_3", "role": "sheriff_badge_helper" },
            { "slot": "slot_4", "role": "wolf" },
            { "slot": "slot_5", "role": "wolf" }
        ],
        "setup_phases": [
            {
                "phase": "D01",
                "seed": 800_001,
                "actions": [{
                    "actor_slot": "slot_1",
                    "template_id": "sheriff_election",
                    "action_id": "badge_el_001",
                    "targets": ["slot_2"]
                }]
            },
            {
                "phase": "D02",
                "seed": 800_002,
                "actions": [{
                    "actor_slot": "slot_2",
                    "template_id": "sheriff_pass",
                    "action_id": "badge_pass_001",
                    "targets": ["slot_3"]
                }]
            }
        ],
        "actions": [{
            "actor_slot": "slot_3",
            "template_id": "sheriff_destroy",
            "action_id": "badge_destroy_001",
            "targets": []
        }],
        "votes": [
            { "actor_slot": "slot_2", "target_slot": "slot_4" },
            { "actor_slot": "slot_3", "target_slot": "slot_4" }
        ],
        "expectations": {
            "inner_events": [
                {
                    "kind": "BadgeChanged",
                    "payload": {
                        "badge_id": "sheriff_badge",
                        "owner": null,
                        "previous_owner": "slot_3",
                        "vote_weight": null,
                        "actor": "slot_3",
                        "source_action": "badge_destroy_001",
                        "reason": "destroyed",
                        "destroyed": true,
                        "phase_id": "D03",
                        "phase_kind": "Day",
                        "phase_number": 3
                    }
                },
                {
                    "kind": "DayVoteOutcome",
                    "payload": {
                        "status": "NoMajority",
                        "winner": null,
                        "contenders": ["slot_4"],
                        "majority": 3.0,
                        "total_weight": 5.0,
                        "tallies": { "slot_4": 2.0 },
                        "weights": { "slot_3": 1.0 }
                    }
                },
                {
                    "kind": "PhaseAnnouncement",
                    "payload": {
                        "phase_id": "D03",
                        "deaths": []
                    }
                }
            ],
            "generated_actions": [{
                "action_id": "badge_destroy_001",
                "source": "BadgeChanged",
                "actor": "slot_3",
                "targets": [],
                "detail": {
                    "badge_id": "sheriff_badge",
                    "previous_owner": "slot_3",
                    "vote_weight": null,
                    "reason": "destroyed",
                    "destroyed": true
                }
            }],
            "sheriff_badges": [{
                "payload": {
                    "badge_id": "sheriff_badge",
                    "owner_slot": null,
                    "vote_weight": null,
                    "source_slot": "slot_3",
                    "source_action": "badge_destroy_001",
                    "reason": "destroyed",
                    "destroyed": true,
                    "phase_id": "D03",
                    "phase_kind": "Day",
                    "phase_number": 3
                }
            }]
        }
    }))
    .expect("Chinese sheriff badge destroy fixture JSON serializes")
}

fn ita_buffered_release_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 910_002,
        "pack": "test_ita_buffered",
        "phase": "D01R1",
        "roster": [
            { "slot": "slot_1", "role": "ita_shooter" },
            { "slot": "slot_2", "role": "vanilla_townie" },
            { "slot": "slot_3", "role": "mafia_goon" }
        ],
        "setup_phases": [{
            "phase": "D01",
            "seed": 910_001,
            "actions": [{
                "actor_slot": "slot_1",
                "template_id": "ita_shot",
                "action_id": "ita_buffered_001",
                "targets": ["slot_3"]
            }]
        }],
        "actions": [],
        "votes": [],
        "expectations": {
            "inner_events": [
                {
                    "kind": "ItaSessionOpened",
                    "payload": {
                        "session_id": "d1",
                        "phase_id": "D01R1",
                        "phase_kind": "Day",
                        "phase_number": 1
                    }
                },
                {
                    "kind": "ActionUseCounted",
                    "payload": {
                        "counter_id": "day_session:d1:ita_shot",
                        "actor": "slot_1",
                        "template_id": "ita_shot",
                        "consumed_action": "ita_buffered_001",
                        "remaining": 0,
                        "phase_id": "D01R1"
                    }
                },
                {
                    "kind": "ItaShotQueued",
                    "payload": {
                        "session_id": "d1",
                        "action_id": "ita_buffered_001",
                        "actor": "slot_1",
                        "targets": ["slot_3"],
                        "queue_position": 1,
                        "queue_length": 1
                    }
                },
                {
                    "kind": "ItaShotResolved",
                    "payload": {
                        "session_id": "d1",
                        "action_id": "ita_buffered_001",
                        "actor": "slot_1",
                        "target": "slot_3",
                        "outcome": "Hit",
                        "hit_chance": 1.0,
                        "kill": true
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_3",
                        "cause": "ita_shot",
                        "attackers": ["slot_1"],
                        "unstoppable": true
                    }
                },
                {
                    "kind": "ItaSessionClosed",
                    "payload": {
                        "session_id": "d1",
                        "phase_id": "D01R1"
                    }
                },
                {
                    "kind": "PhaseAnnouncement",
                    "payload": {
                        "phase_id": "D01R1",
                        "deaths": [{
                            "slot_id": "slot_3",
                            "cause": "ita_shot"
                        }]
                    }
                },
                {
                    "kind": "WinReached",
                    "payload": {
                        "winner": "town"
                    }
                }
            ],
            "generated_actions": [
                {
                    "action_id": "ita_buffered_001",
                    "source": "ItaShotQueued",
                    "actor": "slot_1",
                    "targets": ["slot_3"],
                    "detail": {
                        "session_id": "d1",
                        "queue_position": 1,
                        "queue_length": 1
                    }
                },
                {
                    "action_id": "ita_buffered_001",
                    "source": "ItaShotResolved",
                    "actor": "slot_1",
                    "targets": ["slot_3"],
                    "detail": {
                        "session_id": "d1",
                        "outcome": "Hit",
                        "hit_chance": 1.0,
                        "kill": true
                    }
                }
            ]
        }
    }))
    .expect("Buffered ITA release fixture JSON serializes")
}

fn ita_buffered_release_invalidated_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 910_012,
        "pack": "test_ita_buffered",
        "phase": "D01R1",
        "roster": [
            { "slot": "slot_1", "role": "ita_shooter" },
            { "slot": "slot_2", "role": "ita_shooter" },
            { "slot": "slot_3", "role": "day_killer" },
            { "slot": "slot_4", "role": "mafia_goon" },
            { "slot": "slot_5", "role": "mafia_goon" }
        ],
        "setup_phases": [{
            "phase": "D01",
            "seed": 910_011,
            "actions": [
                {
                    "actor_slot": "slot_1",
                    "template_id": "ita_shot",
                    "action_id": "ita_buffered_kill_001",
                    "targets": ["slot_4"]
                },
                {
                    "actor_slot": "slot_2",
                    "template_id": "ita_shot",
                    "action_id": "ita_buffered_invalidated_002",
                    "targets": ["slot_4"]
                }
            ]
        }],
        "actions": [],
        "votes": [],
        "expectations": {
            "inner_events": [
                {
                    "kind": "ItaSessionOpened",
                    "payload": {
                        "session_id": "d1",
                        "phase_id": "D01R1",
                        "phase_kind": "Day",
                        "phase_number": 1
                    }
                },
                {
                    "kind": "ActionUseCounted",
                    "payload": {
                        "counter_id": "day_session:d1:ita_shot",
                        "actor": "slot_1",
                        "template_id": "ita_shot",
                        "consumed_action": "ita_buffered_kill_001",
                        "remaining": 0,
                        "phase_id": "D01R1"
                    }
                },
                {
                    "kind": "ActionUseCounted",
                    "payload": {
                        "counter_id": "day_session:d1:ita_shot",
                        "actor": "slot_2",
                        "template_id": "ita_shot",
                        "consumed_action": "ita_buffered_invalidated_002",
                        "remaining": 0,
                        "phase_id": "D01R1"
                    }
                },
                {
                    "kind": "ItaShotResolved",
                    "payload": {
                        "session_id": "d1",
                        "action_id": "ita_buffered_kill_001",
                        "actor": "slot_1",
                        "target": "slot_4",
                        "outcome": "Hit",
                        "hit_chance": 1.0,
                        "kill": true
                    }
                },
                {
                    "kind": "ItaShotInvalidated",
                    "payload": {
                        "session_id": "d1",
                        "action_id": "ita_buffered_invalidated_002",
                        "actor_id": "slot_2",
                        "target_id": "slot_4",
                        "reason": "target_dead",
                        "invalidated_by": "ita_buffered_kill_001"
                    }
                },
                {
                    "kind": "ItaSessionUpdated",
                    "payload": {
                        "session_id": "d1",
                        "queue_length": 0,
                        "queue_delta": -2,
                        "shots_resolved": 1,
                        "global_shots_fired": 2
                    }
                },
                {
                    "kind": "ItaSessionClosed",
                    "payload": {
                        "session_id": "d1",
                        "phase_id": "D01R1"
                    }
                }
            ],
            "generated_actions": [
                {
                    "action_id": "ita_buffered_kill_001",
                    "source": "ItaShotResolved",
                    "actor": "slot_1",
                    "targets": ["slot_4"],
                    "detail": {
                        "session_id": "d1",
                        "outcome": "Hit",
                        "kill": true
                    }
                },
                {
                    "action_id": "ita_buffered_invalidated_002",
                    "source": "ItaShotInvalidated",
                    "actor": "slot_2",
                    "targets": ["slot_4"],
                    "detail": {
                        "invalidated_by": "ita_buffered_kill_001",
                        "reason": "target_dead"
                    }
                },
                {
                    "action_id": "ita_buffered_invalidated_002",
                    "source": "ItaShotQueued",
                    "actor": "slot_2",
                    "targets": ["slot_4"],
                    "detail": {
                        "session_id": "d1",
                        "queue_position": 2,
                        "queue_length": 2
                    }
                }
            ]
        }
    }))
    .expect("Buffered ITA invalidated release fixture JSON serializes")
}

fn ita_buffered_release_refunded_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 910_032,
        "pack": "test_ita_buffered",
        "phase": "D01R1",
        "roster": [
            { "slot": "slot_1", "role": "ita_shooter" },
            { "slot": "slot_2", "role": "ita_shooter" },
            { "slot": "slot_3", "role": "day_killer" },
            { "slot": "slot_4", "role": "mafia_goon" },
            { "slot": "slot_5", "role": "mafia_goon" }
        ],
        "setup_phases": [{
            "phase": "D01",
            "seed": 910_031,
            "actions": [{
                "actor_slot": "slot_2",
                "template_id": "ita_shot",
                "action_id": "ita_buffered_refund_002",
                "targets": ["slot_4"]
            }],
            "votes": []
        }],
        "actions": [{
            "actor_slot": "slot_3",
            "template_id": "day_kill",
            "action_id": "day_kill_before_ita_refund_001",
            "targets": ["slot_4"]
        }],
        "votes": [],
        "expectations": {
            "inner_events": [
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_4",
                        "cause": "day_kill",
                        "attackers": ["slot_3"],
                        "unstoppable": false
                    }
                },
                {
                    "kind": "ItaShotQueued",
                    "payload": {
                        "session_id": "d1",
                        "action_id": "ita_buffered_refund_002",
                        "actor": "slot_2",
                        "targets": ["slot_4"],
                        "queue_position": 1,
                        "queue_length": 1
                    }
                },
                {
                    "kind": "ItaShotRefunded",
                    "payload": {
                        "session_id": "d1",
                        "action_id": "ita_buffered_refund_002",
                        "actor_id": "slot_2",
                        "target_id": "slot_4",
                        "reason": "target_dead",
                        "policy": "REFUND_SHOT",
                        "counters": {
                            "global_shots_fired": 0,
                            "shots_refunded": 1,
                            "refunded_by_reason": {
                                "target_dead": 1
                            }
                        }
                    }
                },
                {
                    "kind": "ItaSessionUpdated",
                    "payload": {
                        "session_id": "d1",
                        "queue_length": 0,
                        "shots_resolved": 0,
                        "global_shots_fired": 0,
                        "counters": {
                            "shots_refunded": 1,
                            "refunded_by_reason": {
                                "target_dead": 1
                            }
                        }
                    }
                },
                {
                    "kind": "ItaSessionClosed",
                    "payload": {
                        "session_id": "d1",
                        "phase_id": "D01R1"
                    }
                }
            ],
            "generated_actions": [
                {
                    "action_id": "ita_buffered_refund_002",
                    "source": "ItaShotQueued",
                    "actor": "slot_2",
                    "targets": ["slot_4"],
                    "detail": {
                        "session_id": "d1",
                        "queue_position": 1,
                        "queue_length": 1
                    }
                },
                {
                    "action_id": "ita_buffered_refund_002",
                    "source": "ItaShotRefunded",
                    "actor": "slot_2",
                    "targets": ["slot_4"],
                    "detail": {
                        "reason": "target_dead",
                        "policy": "REFUND_SHOT",
                        "counters": {
                            "shots_refunded": 1,
                            "refunded_by_reason": {
                                "target_dead": 1
                            }
                        }
                    }
                }
            ]
        }
    }))
    .expect("Buffered ITA refunded release fixture JSON serializes")
}

fn ita_buffered_release_hp_hybrid_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 910_042,
        "pack": "test_ita_buffered",
        "phase": "D01R1",
        "roster": [
            { "slot": "slot_1", "role": "ita_shooter" },
            { "slot": "slot_2", "role": "ita_shooter" },
            { "slot": "slot_3", "role": "ita_shooter" },
            { "slot": "slot_4", "role": "ita_shooter" },
            { "slot": "slot_5", "role": "armored_mafia" },
            { "slot": "slot_6", "role": "hybrid_mafia" },
            { "slot": "slot_7", "role": "mafia_goon" }
        ],
        "setup_phases": [{
            "phase": "D01",
            "seed": 910_041,
            "actions": [
                {
                    "actor_slot": "slot_1",
                    "template_id": "ita_shot",
                    "action_id": "ita_buffer_hp_damage_001",
                    "targets": ["slot_5"]
                },
                {
                    "actor_slot": "slot_2",
                    "template_id": "ita_shot",
                    "action_id": "ita_buffer_hp_kill_002",
                    "targets": ["slot_5"]
                },
                {
                    "actor_slot": "slot_3",
                    "template_id": "ita_shot",
                    "action_id": "ita_buffer_hybrid_shield_003",
                    "targets": ["slot_6"]
                },
                {
                    "actor_slot": "slot_4",
                    "template_id": "ita_shot",
                    "action_id": "ita_buffer_hybrid_hp_004",
                    "targets": ["slot_6"]
                }
            ]
        }],
        "actions": [],
        "votes": [],
        "expectations": {
            "inner_events": [
                {
                    "kind": "ItaShotResolved",
                    "payload": {
                        "session_id": "d1",
                        "action_id": "ita_buffer_hp_damage_001",
                        "actor": "slot_1",
                        "target": "slot_5",
                        "outcome": "Hit",
                        "hit_chance": 1.0,
                        "kill": false,
                        "hp_before": 2,
                        "hp_after": 1,
                        "protection_path": "hp"
                    }
                },
                {
                    "kind": "ItaShotResolved",
                    "payload": {
                        "session_id": "d1",
                        "action_id": "ita_buffer_hp_kill_002",
                        "actor": "slot_2",
                        "target": "slot_5",
                        "outcome": "Hit",
                        "hit_chance": 1.0,
                        "kill": true,
                        "hp_before": 1,
                        "hp_after": 0,
                        "protection_path": "hp"
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_5",
                        "cause": "ita_shot",
                        "attackers": ["slot_2"],
                        "unstoppable": true
                    }
                },
                {
                    "kind": "ItaShotResolved",
                    "payload": {
                        "session_id": "d1",
                        "action_id": "ita_buffer_hybrid_shield_003",
                        "actor": "slot_3",
                        "target": "slot_6",
                        "outcome": "Blocked",
                        "kill": false,
                        "shield_before": 1,
                        "shield_after": 0,
                        "shield_spent": true,
                        "hp_before": 2,
                        "hp_after": 2,
                        "protection_path": "shield"
                    }
                },
                {
                    "kind": "ItaShotResolved",
                    "payload": {
                        "session_id": "d1",
                        "action_id": "ita_buffer_hybrid_hp_004",
                        "actor": "slot_4",
                        "target": "slot_6",
                        "outcome": "Hit",
                        "hit_chance": 1.0,
                        "kill": false,
                        "hp_before": 2,
                        "hp_after": 1,
                        "protection_path": "hp"
                    }
                },
                {
                    "kind": "ItaSessionUpdated",
                    "payload": {
                        "session_id": "d1",
                        "queue_length": 0,
                        "shots_resolved": 4,
                        "global_shots_fired": 4,
                        "counters": {
                            "hits_landed": 3,
                            "shots_blocked": 1,
                            "hp_remaining": {
                                "slot_5": 0,
                                "slot_6": 1
                            },
                            "hp_damage": {
                                "slot_5": 2,
                                "slot_6": 1
                            },
                            "shields_remaining": {
                                "slot_6": 0
                            },
                            "shields_spent": {
                                "slot_6": 1
                            }
                        }
                    }
                },
                {
                    "kind": "PhaseAnnouncement",
                    "payload": {
                        "phase_id": "D01R1",
                        "deaths": [{
                            "slot_id": "slot_5",
                            "cause": "ita_shot"
                        }]
                    }
                }
            ],
            "generated_actions": [
                {
                    "action_id": "ita_buffer_hp_damage_001",
                    "source": "ItaShotResolved",
                    "actor": "slot_1",
                    "targets": ["slot_5"],
                    "detail": {
                        "session_id": "d1",
                        "outcome": "Hit",
                        "kill": false,
                        "hp_before": 2,
                        "hp_after": 1,
                        "protection_path": "hp"
                    }
                },
                {
                    "action_id": "ita_buffer_hp_kill_002",
                    "source": "ItaShotResolved",
                    "actor": "slot_2",
                    "targets": ["slot_5"],
                    "detail": {
                        "session_id": "d1",
                        "outcome": "Hit",
                        "kill": true,
                        "hp_before": 1,
                        "hp_after": 0,
                        "protection_path": "hp"
                    }
                },
                {
                    "action_id": "ita_buffer_hybrid_shield_003",
                    "source": "ItaShotResolved",
                    "actor": "slot_3",
                    "targets": ["slot_6"],
                    "detail": {
                        "session_id": "d1",
                        "outcome": "Blocked",
                        "kill": false,
                        "shield_spent": true,
                        "hp_before": 2,
                        "hp_after": 2,
                        "protection_path": "shield"
                    }
                },
                {
                    "action_id": "ita_buffer_hybrid_hp_004",
                    "source": "ItaShotResolved",
                    "actor": "slot_4",
                    "targets": ["slot_6"],
                    "detail": {
                        "session_id": "d1",
                        "outcome": "Hit",
                        "kill": false,
                        "hp_before": 2,
                        "hp_after": 1,
                        "protection_path": "hp"
                    }
                }
            ]
        }
    }))
    .expect("Buffered ITA HP/hybrid release fixture JSON serializes")
}

fn ita_lifecycle_controls_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 910_101,
        "pack": "test_ita_buffered",
        "phase": "D01",
        "roster": [
            { "slot": "slot_1", "role": "ita_shooter" },
            { "slot": "slot_2", "role": "mafia_goon" }
        ],
        "ita_session_controls": [{
            "session_id": "d1",
            "control": "Pause",
            "message": "Pause for votecount correction"
        }],
        "actions": [{
            "actor_slot": "slot_1",
            "template_id": "ita_shot",
            "action_id": "ita_lifecycle_paused_001",
            "targets": ["slot_2"]
        }],
        "votes": [],
        "expectations": {
            "stream_events": [{
                "kind": "ItaSessionControlRecorded",
                "payload": {
                    "phase_id": "D01",
                    "session_id": "d1",
                    "control": "Pause",
                    "message": "Pause for votecount correction"
                }
            }],
            "inner_events": [
                {
                    "kind": "ItaSessionLifecycleChanged",
                    "payload": {
                        "session_id": "d1",
                        "control": "Pause",
                        "from_status": "scheduled",
                        "to_status": "paused",
                        "message": "Pause for votecount correction"
                    }
                },
                {
                    "kind": "ItaSessionAnnouncement",
                    "payload": {
                        "session_id": "d1",
                        "status": "paused",
                        "message": "Pause for votecount correction"
                    }
                },
                {
                    "kind": "ActionInterfered",
                    "payload": {
                        "actor": "slot_1",
                        "reason": "ita_session_paused"
                    }
                }
            ],
            "trace_decisions": [{
                "stage": "ita_session_lifecycle",
                "source": "d1",
                "outcome": "paused",
                "detail": {
                    "control": "Pause",
                    "from_status": "scheduled",
                    "message": "Pause for votecount correction"
                }
            }],
            "generated_actions": [
                {
                    "action_id": "d1",
                    "source": "ItaSessionLifecycleChanged",
                    "detail": {
                        "control": "Pause",
                        "from_status": "scheduled",
                        "to_status": "paused",
                        "message": "Pause for votecount correction"
                    }
                },
                {
                    "action_id": "d1",
                    "source": "ItaSessionAnnouncement",
                    "detail": {
                        "status": "paused",
                        "message": "Pause for votecount correction"
                    }
                }
            ]
        }
    }))
    .expect("ITA lifecycle fixture JSON serializes")
}

fn mafia_universe_day_notes_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 920_001,
        "pack": "mafia_universe",
        "phase": "D02",
        "roster": [
            { "slot": "slot_1", "role": "town_vanilla" },
            { "slot": "slot_2", "role": "town_vanilla" },
            { "slot": "slot_3", "role": "town_vanilla" },
            { "slot": "slot_4", "role": "mafia_goon" },
            { "slot": "slot_5", "role": "mafia_goon" }
        ],
        "setup_phases": [{
            "phase": "N01",
            "seed": 919_001,
            "actions": [{
                "actor_slot": "slot_4",
                "template_id": "factional_kill",
                "action_id": "day_notes_setup_factional_kill",
                "targets": ["slot_5"]
            }]
        }],
        "votes": [
            { "actor_slot": "slot_1", "target_slot": "slot_3" },
            { "actor_slot": "slot_2", "target_slot": "slot_3" },
            { "actor_slot": "slot_4", "target_slot": "slot_3" }
        ],
        "actions": [],
        "expectations": {
            "inner_events": [
                {
                    "kind": "DayAnnouncement",
                    "payload": {
                        "player_id": "slot_5",
                        "cause": "factional_kill",
                        "template_id": "mafia_universe_night_death_v1",
                        "audience": "public",
                        "attackers": ["slot_4"],
                        "unstoppable": false,
                        "role_key": "mafia_goon",
                        "role_payload": "RoleKey",
                        "sequence": 0,
                        "day": 2,
                        "night": 1,
                        "phase_id": "D02"
                    }
                },
                {
                    "kind": "DayVoteOutcome",
                    "payload": {
                        "status": "Lynch",
                        "winner": "slot_3",
                        "majority": 3.0,
                        "total_weight": 4.0
                    }
                },
                {
                    "kind": "LastWordsRecorded",
                    "payload": {
                        "player_id": "slot_3",
                        "reason": "lynch",
                        "template_id": "mafia_universe_last_words_v1",
                        "audience": "public",
                        "window": "post_lynch",
                        "sequence": 0,
                        "day": 2,
                        "phase_id": "D02",
                        "vote": {
                            "status": "Lynch",
                            "winner": "slot_3",
                            "majority": 3.0,
                            "total_weight": 4.0
                        }
                    }
                },
                {
                    "kind": "PhaseAnnouncement",
                    "payload": {
                        "phase_id": "D02",
                        "template_id": "mafia_universe_day_death_v1",
                        "audience": "public",
                        "deaths": [{
                            "slot_id": "slot_3",
                            "cause": "lynch",
                            "template_id": "mafia_universe_lynch_death_v1",
                            "audience": "public"
                        }]
                    }
                }
            ],
            "trace_decisions": [
                {
                    "stage": "inner_event",
                    "source": "event_index:0",
                    "outcome": "day_announcement",
                    "detail": null
                },
                {
                    "stage": "inner_event",
                    "source": "event_index:6",
                    "outcome": "last_words_recorded",
                    "detail": null
                },
                {
                    "stage": "inner_event",
                    "source": "event_index:7",
                    "outcome": "phase_announcement",
                    "detail": null
                }
            ]
        }
    }))
    .expect("Mafia Universe day notes fixture JSON serializes")
}

fn mafiascum_no_majority_revote_prompt_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 930_001,
        "pack": "mafiascum",
        "phase": "D01",
        "roster": [
            { "slot": "slot_1", "role": "vanilla_townie" },
            { "slot": "slot_2", "role": "vanilla_townie" },
            { "slot": "slot_3", "role": "vanilla_townie" },
            { "slot": "slot_4", "role": "mafia_goon" },
            { "slot": "slot_5", "role": "mafia_goon" }
        ],
        "votes": [
            { "actor_slot": "slot_2", "target_slot": "slot_1" },
            { "actor_slot": "slot_3", "target_slot": "slot_1" }
        ],
        "actions": [],
        "host_prompt_decision": {
            "prompt_id": "D01:revote:NoMajority",
            "decision": {
                "kind": "acknowledge",
                "metadata": { "operator_note": "minimizer revote" }
            }
        },
        "expectations": {
            "inner_events": [
                {
                    "kind": "DayVoteOutcome",
                    "payload": {
                        "status": "NoMajority",
                        "winner": null,
                        "contenders": ["slot_1"],
                        "majority": 3.0,
                        "total_weight": 5.0
                    }
                },
                {
                    "kind": "HostPromptIssued",
                    "payload": {
                        "prompt_id": "D01:revote:NoMajority",
                        "kind": "revote",
                        "subject": null,
                        "reason": "no_majority",
                        "phase_id": "D01",
                        "phase_kind": "Day",
                        "phase_number": 1,
                        "metadata": {
                            "policy": "no_majority_revote",
                            "status": "NoMajority",
                            "contenders": ["slot_1"]
                        }
                    }
                },
                {
                    "kind": "PhaseAnnouncement",
                    "payload": {
                        "phase_id": "D01",
                        "deaths": []
                    }
                }
            ],
            "stream_events": [
                {
                    "kind": "HostPromptResolved",
                    "payload": {
                        "prompt_id": "D01:revote:NoMajority",
                        "phase_id": "D01",
                        "kind": "revote",
                        "reason": "no_majority",
                        "decision": {
                            "kind": "acknowledge",
                            "metadata": {
                                "operator_note": "minimizer revote"
                            }
                        },
                        "public_resolution": {
                            "kind": "phase_advance",
                            "source_phase_id": "D01",
                            "target_phase_id": "D01R1",
                            "reason": "revote"
                        },
                        "resolved_by": "fixture_host"
                    }
                },
                {
                    "kind": "PhaseAdvanced",
                    "payload": {
                        "phase_id": "D01R1",
                        "source_prompt_id": "D01:revote:NoMajority",
                        "source_phase_id": "D01",
                        "reason": "revote"
                    }
                }
            ],
            "trace_decisions": [
                {
                    "stage": "day:vote_prompt",
                    "source": "day_vote",
                    "outcome": "host_prompt_issued",
                    "detail": {
                        "policy": "no_majority_revote",
                        "prompt_id": "D01:revote:NoMajority",
                        "kind": "revote",
                        "subject": null,
                        "reason": "no_majority",
                        "status": "NoMajority",
                        "contenders": ["slot_1"],
                        "tiebreak": null,
                        "outcome_reason": null
                    }
                }
            ]
        }
    }))
    .expect("Mafiascum revote prompt fixture JSON serializes")
}

fn mafiascum_beloved_princess_skip_next_day_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 940_001,
        "pack": "mafiascum",
        "phase": "D01",
        "roster": [
            { "slot": "slot_1", "role": "beloved_princess" },
            { "slot": "slot_2", "role": "vanilla_townie" },
            { "slot": "slot_3", "role": "vanilla_townie" },
            { "slot": "slot_4", "role": "mafia_goon" },
            { "slot": "slot_5", "role": "mafia_goon" },
            { "slot": "slot_6", "role": "vanilla_townie" }
        ],
        "votes": [
            { "actor_slot": "slot_2", "target_slot": "slot_1" },
            { "actor_slot": "slot_3", "target_slot": "slot_1" },
            { "actor_slot": "slot_4", "target_slot": "slot_1" },
            { "actor_slot": "slot_5", "target_slot": "slot_1" }
        ],
        "actions": [],
        "host_prompt_decision": {
            "prompt_id": "D01:skip_next_day:slot_1",
            "decision": {
                "kind": "acknowledge",
                "metadata": { "operator_note": "minimizer skip next day" }
            }
        },
        "expectations": {
            "inner_events": [
                {
                    "kind": "DayVoteOutcome",
                    "payload": {
                        "status": "Lynch",
                        "winner": "slot_1",
                        "contenders": ["slot_1"],
                        "majority": 4.0,
                        "total_weight": 6.0
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_1",
                        "cause": "day_vote",
                        "attackers": [],
                        "unstoppable": true
                    }
                },
                {
                    "kind": "HostPromptIssued",
                    "payload": {
                        "prompt_id": "D01:skip_next_day:slot_1",
                        "kind": "skip_next_day",
                        "subject": "slot_1",
                        "reason": "beloved_princess_death",
                        "phase_id": "D01",
                        "phase_kind": "Day",
                        "phase_number": 1,
                        "metadata": {
                            "policy": "beloved_princess",
                            "role": "beloved_princess",
                            "death_cause": "lynch"
                        }
                    }
                },
                {
                    "kind": "PhaseAnnouncement",
                    "payload": {
                        "phase_id": "D01",
                        "template_id": "mafiascum_day_death_v1",
                        "audience": "public",
                        "deaths": [{
                            "slot_id": "slot_1",
                            "cause": "lynch",
                            "template_id": "mafiascum_lynch_death_v1",
                            "audience": "public"
                        }]
                    }
                }
            ],
            "stream_events": [
                {
                    "kind": "HostPromptResolved",
                    "payload": {
                        "prompt_id": "D01:skip_next_day:slot_1",
                        "phase_id": "D01",
                        "kind": "skip_next_day",
                        "reason": "beloved_princess_death",
                        "decision": {
                            "kind": "acknowledge",
                            "metadata": {
                                "operator_note": "minimizer skip next day"
                            }
                        },
                        "public_resolution": {
                            "kind": "phase_advance",
                            "source_phase_id": "D01",
                            "target_phase_id": "N02",
                            "reason": "skip_next_day",
                            "skipped_phase_id": "D02"
                        },
                        "resolved_by": "fixture_host"
                    }
                },
                {
                    "kind": "PhaseAdvanced",
                    "payload": {
                        "phase_id": "N02",
                        "source_prompt_id": "D01:skip_next_day:slot_1",
                        "source_phase_id": "D01",
                        "reason": "skip_next_day",
                        "skipped_phase_id": "D02"
                    }
                }
            ],
            "trace_decisions": [
                {
                    "stage": "death:trigger",
                    "source": "slot:slot_1",
                    "outcome": "host_prompt_issued",
                    "detail": {
                        "policy": "beloved_princess",
                        "prompt_id": "D01:skip_next_day:slot_1",
                        "kind": "skip_next_day",
                        "subject": "slot_1",
                        "reason": "beloved_princess_death",
                        "death_cause": "lynch",
                        "role": "beloved_princess"
                    }
                }
            ]
        }
    }))
    .expect("Mafiascum Beloved Princess skip-next-day fixture JSON serializes")
}

fn mafiascum_virgin_night_skip_next_day_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 950_001,
        "pack": "mafiascum",
        "phase": "N01",
        "roster": [
            { "slot": "slot_1", "role": "mafia_goon" },
            { "slot": "slot_2", "role": "virgin" },
            { "slot": "slot_3", "role": "vanilla_townie" },
            { "slot": "slot_4", "role": "vanilla_townie" }
        ],
        "votes": [],
        "actions": [{
            "actor_slot": "slot_1",
            "template_id": "factional_kill",
            "action_id": "mafia_kills_virgin_n01",
            "targets": ["slot_2"]
        }],
        "host_prompt_decision": {
            "prompt_id": "N01:skip_next_day:slot_2",
            "decision": {
                "kind": "acknowledge",
                "metadata": { "operator_note": "minimizer virgin skip next day" }
            }
        },
        "expectations": {
            "inner_events": [
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_2",
                        "cause": "factional_kill",
                        "attackers": ["slot_1"],
                        "unstoppable": false
                    }
                },
                {
                    "kind": "HostPromptIssued",
                    "payload": {
                        "prompt_id": "N01:skip_next_day:slot_2",
                        "kind": "skip_next_day",
                        "subject": "slot_2",
                        "reason": "beloved_princess_death",
                        "phase_id": "N01",
                        "phase_kind": "Night",
                        "phase_number": 1,
                        "metadata": {
                            "policy": "beloved_princess",
                            "role": "virgin",
                            "death_cause": "factional_kill"
                        }
                    }
                },
                {
                    "kind": "PhaseAnnouncement",
                    "payload": {
                        "phase_id": "N01",
                        "deaths": [{ "slot_id": "slot_2", "cause": "factional_kill" }]
                    }
                }
            ],
            "stream_events": [
                {
                    "kind": "HostPromptResolved",
                    "payload": {
                        "prompt_id": "N01:skip_next_day:slot_2",
                        "phase_id": "N01",
                        "kind": "skip_next_day",
                        "reason": "beloved_princess_death",
                        "decision": {
                            "kind": "acknowledge",
                            "metadata": {
                                "operator_note": "minimizer virgin skip next day"
                            }
                        },
                        "public_resolution": {
                            "kind": "phase_advance",
                            "source_phase_id": "N01",
                            "target_phase_id": "N02",
                            "reason": "skip_next_day",
                            "skipped_phase_id": "D02"
                        },
                        "resolved_by": "fixture_host"
                    }
                },
                {
                    "kind": "PhaseAdvanced",
                    "payload": {
                        "phase_id": "N02",
                        "source_prompt_id": "N01:skip_next_day:slot_2",
                        "source_phase_id": "N01",
                        "reason": "skip_next_day",
                        "skipped_phase_id": "D02"
                    }
                }
            ],
            "trace_decisions": [
                {
                    "stage": "death:trigger",
                    "source": "slot:slot_2",
                    "outcome": "host_prompt_issued",
                    "detail": {
                        "policy": "beloved_princess",
                        "prompt_id": "N01:skip_next_day:slot_2",
                        "kind": "skip_next_day",
                        "subject": "slot_2",
                        "reason": "beloved_princess_death",
                        "death_cause": "factional_kill",
                        "role": "virgin"
                    }
                }
            ]
        }
    }))
    .expect("Mafiascum Virgin night skip-next-day fixture JSON serializes")
}

fn dynamic_vote_no_majority_revote_prompt_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 960_002,
        "pack": "test_dynamic_vote_prompt",
        "phase": "D02",
        "roster": [
            { "slot": "slot_1", "role": "vanilla_townie" },
            { "slot": "slot_2", "role": "mafia_goon" },
            { "slot": "slot_3", "role": "vote_granter" }
        ],
        "setup_phases": [{
            "phase": "N01",
            "seed": 960_001,
            "actions": [{
                "actor_slot": "slot_3",
                "template_id": "grant_vote_power",
                "action_id": "grant_vote_power_n01",
                "targets": ["slot_1"]
            }]
        }],
        "votes": [
            { "actor_slot": "slot_2", "target_slot": "slot_1" },
            { "actor_slot": "slot_3", "target_slot": "slot_1" }
        ],
        "actions": [],
        "host_prompt_decision": {
            "prompt_id": "D02:revote:NoMajority",
            "decision": {
                "kind": "acknowledge",
                "metadata": { "operator_note": "minimizer dynamic revote" }
            }
        },
        "expectations": {
            "inner_events": [
                {
                    "kind": "DayVoteOutcome",
                    "payload": {
                        "status": "NoMajority",
                        "winner": null,
                        "contenders": ["slot_1"],
                        "majority": 3.0,
                        "total_weight": 4.0,
                        "tallies": { "slot_1": 2.0 },
                        "weights": { "slot_1": 2.0 }
                    }
                },
                {
                    "kind": "HostPromptIssued",
                    "payload": {
                        "prompt_id": "D02:revote:NoMajority",
                        "kind": "revote",
                        "subject": null,
                        "reason": "no_majority",
                        "phase_id": "D02",
                        "phase_kind": "Day",
                        "phase_number": 2,
                        "metadata": {
                            "policy": "no_majority_revote",
                            "status": "NoMajority",
                            "contenders": ["slot_1"]
                        }
                    }
                },
                {
                    "kind": "PhaseAnnouncement",
                    "payload": {
                        "phase_id": "D02",
                        "deaths": []
                    }
                }
            ],
            "stream_events": [
                {
                    "kind": "HostPromptResolved",
                    "payload": {
                        "prompt_id": "D02:revote:NoMajority",
                        "phase_id": "D02",
                        "kind": "revote",
                        "reason": "no_majority",
                        "decision": {
                            "kind": "acknowledge",
                            "metadata": {
                                "operator_note": "minimizer dynamic revote"
                            }
                        },
                        "public_resolution": {
                            "kind": "phase_advance",
                            "source_phase_id": "D02",
                            "target_phase_id": "D02R1",
                            "reason": "revote"
                        },
                        "resolved_by": "fixture_host"
                    }
                },
                {
                    "kind": "PhaseAdvanced",
                    "payload": {
                        "phase_id": "D02R1",
                        "source_prompt_id": "D02:revote:NoMajority",
                        "source_phase_id": "D02",
                        "reason": "revote"
                    }
                }
            ],
            "trace_decisions": [
                {
                    "stage": "day:vote_prompt",
                    "source": "day_vote",
                    "outcome": "host_prompt_issued",
                    "detail": {
                        "policy": "no_majority_revote",
                        "prompt_id": "D02:revote:NoMajority",
                        "kind": "revote",
                        "subject": null,
                        "reason": "no_majority",
                        "status": "NoMajority",
                        "contenders": ["slot_1"],
                        "tiebreak": null,
                        "outcome_reason": null
                    }
                }
            ]
        }
    }))
    .expect("Dynamic vote NoMajority revote fixture JSON serializes")
}

fn dynamic_vote_pk_prompt_fixture_json() -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "seed": 960_012,
        "pack": "test_dynamic_vote_pk",
        "phase": "D02",
        "roster": [
            { "slot": "slot_1", "role": "vanilla_townie" },
            { "slot": "slot_2", "role": "mafia_goon" },
            { "slot": "slot_3", "role": "vanilla_townie" },
            { "slot": "slot_4", "role": "vote_granter" }
        ],
        "setup_phases": [{
            "phase": "N01",
            "seed": 960_011,
            "actions": [{
                "actor_slot": "slot_4",
                "template_id": "grant_vote_power",
                "action_id": "grant_vote_power_n01",
                "targets": ["slot_1"]
            }]
        }],
        "votes": [
            { "actor_slot": "slot_1", "target_slot": "slot_2" },
            { "actor_slot": "slot_2", "target_slot": "slot_3" },
            { "actor_slot": "slot_4", "target_slot": "slot_3" }
        ],
        "actions": [],
        "host_prompt_decision": {
            "prompt_id": "D02:pk:Tie",
            "decision": {
                "kind": "select_slot",
                "slot": "slot_3"
            }
        },
        "expectations": {
            "inner_events": [
                {
                    "kind": "DayVoteOutcome",
                    "payload": {
                        "status": "Tie",
                        "winner": null,
                        "contenders": ["slot_2", "slot_3"],
                        "majority": null,
                        "total_weight": 5.0,
                        "tallies": {
                            "slot_2": 2.0,
                            "slot_3": 2.0
                        },
                        "weights": { "slot_1": 2.0 },
                        "tiebreak": "HostDecides"
                    }
                },
                {
                    "kind": "HostPromptIssued",
                    "payload": {
                        "prompt_id": "D02:pk:Tie",
                        "kind": "pk",
                        "subject": null,
                        "reason": "host_decides_tie",
                        "phase_id": "D02",
                        "phase_kind": "Day",
                        "phase_number": 2,
                        "metadata": {
                            "policy": "pk_host_decides_tie",
                            "status": "Tie",
                            "contenders": ["slot_2", "slot_3"],
                            "tiebreak": "HostDecides"
                        }
                    }
                },
                {
                    "kind": "PhaseAnnouncement",
                    "payload": {
                        "phase_id": "D02",
                        "deaths": []
                    }
                },
                {
                    "kind": "PlayerKilled",
                    "payload": {
                        "slot_id": "slot_3",
                        "cause": "host_prompt:pk",
                        "attackers": [],
                        "unstoppable": true
                    }
                }
            ],
            "stream_events": [
                {
                    "kind": "HostPromptResolved",
                    "payload": {
                        "prompt_id": "D02:pk:Tie",
                        "phase_id": "D02",
                        "kind": "pk",
                        "reason": "host_decides_tie",
                        "decision": {
                            "kind": "select_slot",
                            "slot": "slot_3"
                        },
                        "public_resolution": {
                            "kind": "day_vote_elimination",
                            "phase_id": "D02",
                            "selected_slot": "slot_3",
                            "reason": "host_decides_tie"
                        },
                        "resolved_by": "fixture_host"
                    }
                }
            ],
            "trace_decisions": [
                {
                    "stage": "day:vote_prompt",
                    "source": "day_vote",
                    "outcome": "host_prompt_issued",
                    "detail": {
                        "policy": "pk_host_decides_tie",
                        "prompt_id": "D02:pk:Tie",
                        "kind": "pk",
                        "subject": null,
                        "reason": "host_decides_tie",
                        "status": "Tie",
                        "contenders": ["slot_2", "slot_3"],
                        "tiebreak": "HostDecides",
                        "outcome_reason": null
                    }
                },
                {
                    "stage": "host_prompt:resolve",
                    "source": "D02:pk:Tie",
                    "outcome": "pk_selected",
                    "detail": {
                        "prompt_id": "D02:pk:Tie",
                        "kind": "pk",
                        "reason": "host_decides_tie",
                        "selected_slot": "slot_3",
                        "contenders": ["slot_2", "slot_3"],
                        "decision": {
                            "kind": "select_slot",
                            "slot": "slot_3"
                        },
                        "resolved_by": "fixture_host"
                    }
                }
            ]
        }
    }))
    .expect("Dynamic vote PK prompt fixture JSON serializes")
}

#[derive(Debug)]
struct GeneratedChineseProtector {
    protector: String,
    action_id: String,
    template_id: String,
}

impl serde::Serialize for GeneratedChineseProtector {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serde_json::json!({
            "protector": self.protector,
            "action_id": self.action_id,
            "template_id": self.template_id,
            "intercepts": false,
            "intercept_cause": null,
            "guard_retaliation_cause": null,
            "cpr_harm_cause": null,
        })
        .serialize(serializer)
    }
}

fn generated_chinese_x_shot_expectation(action: &GeneratedNightAction) -> serde_json::Value {
    serde_json::json!({
        "kind": "ActionUseCounted",
        "payload": {
            "actor": action.actor_slot,
            "template_id": action.template_id,
            "consumed_action": action.action_id,
            "counter_id": format!("x_shot:{}", action.template_id),
            "cadence_policy": "x_shot",
            "phase_scope": "game",
            "limit": 1,
            "used": 1,
            "remaining": 0,
            "phase_id": "N01",
            "phase_kind": "Night",
            "phase_number": 1,
        }
    })
}

fn generated_chinese_alignment_result(case: &GeneratedNightCase, target: &str) -> &'static str {
    match generated_role_for(case, target) {
        Some("wolf" | "wolf_beauty" | "white_wolf_king") => "evil",
        _ => "good",
    }
}

fn generated_chinese_protection_sources_for(
    case: &GeneratedNightCase,
    target: &str,
) -> Vec<GeneratedChineseProtector> {
    case.actions
        .iter()
        .filter(|action| matches!(action.template_id.as_str(), "night_guard" | "heal_potion"))
        .filter(|action| action.targets == vec![target.to_string()])
        .map(generated_chinese_protector)
        .collect()
}

fn generated_chinese_guard_sources_for(
    case: &GeneratedNightCase,
    target: &str,
) -> Vec<GeneratedChineseProtector> {
    case.actions
        .iter()
        .filter(|action| action.template_id == "night_guard")
        .filter(|action| action.targets == vec![target.to_string()])
        .map(generated_chinese_protector)
        .collect()
}

fn generated_chinese_protector(action: &GeneratedNightAction) -> GeneratedChineseProtector {
    GeneratedChineseProtector {
        protector: action.actor_slot.clone(),
        action_id: action.action_id.clone(),
        template_id: action.template_id.clone(),
    }
}

fn generated_epicmafia_pk_expectations_json(case: &GeneratedEpicmafiaPkCase) -> serde_json::Value {
    serde_json::json!({
        "inner_events": [
            {
                "kind": "DayVoteOutcome",
                "payload": {
                    "status": "Tie",
                    "contenders": case.contenders,
                    "tiebreak": "HostDecides",
                }
            },
            {
                "kind": "HostPromptIssued",
                "payload": {
                    "prompt_id": "D01:pk:Tie",
                    "kind": "pk",
                    "subject": null,
                    "reason": "host_decides_tie",
                    "phase_id": "D01",
                    "metadata": {
                        "policy": "pk_host_decides_tie",
                        "status": "Tie",
                        "contenders": case.contenders,
                        "tiebreak": "HostDecides"
                    },
                }
            },
            {
                "kind": "PlayerKilled",
                "payload": {
                    "slot_id": case.selected_slot,
                    "cause": "host_prompt:pk",
                    "attackers": [],
                    "unstoppable": true,
                }
            }
        ],
        "trace_decisions": [
            {
                "stage": "day:vote_prompt",
                "source": "day_vote",
                "outcome": "host_prompt_issued",
                "detail": {
                    "policy": "pk_host_decides_tie",
                    "prompt_id": "D01:pk:Tie",
                    "kind": "pk",
                    "subject": null,
                    "reason": "host_decides_tie",
                    "status": "Tie",
                    "contenders": case.contenders,
                    "tiebreak": "HostDecides",
                    "outcome_reason": null,
                },
            },
            {
                "stage": "host_prompt:resolve",
                "source": "D01:pk:Tie",
                "outcome": "pk_selected",
                "detail": {
                    "prompt_id": "D01:pk:Tie",
                    "kind": "pk",
                    "reason": "host_decides_tie",
                    "selected_slot": case.selected_slot,
                    "contenders": case.contenders,
                    "decision": {
                        "kind": "select_slot",
                        "slot": case.selected_slot,
                    },
                    "resolved_by": "fixture_host",
                },
            }
        ]
    })
}

fn generated_default_open_night_expectations_json(
    case: &GeneratedNightCase,
) -> Option<serde_json::Value> {
    let seer_check = generated_action_by_template(case, "seer_check")?;
    let guardian_protect = generated_action_by_template(case, "guardian_protect")?;
    let agent_kill = generated_action_by_template(case, "agent_kill")?;
    let saved_target = guardian_protect.targets.first()?;
    if agent_kill.targets.first() != Some(saved_target) {
        return None;
    }
    let investigation_target = seer_check.targets.first()?;

    Some(serde_json::json!({
        "inner_events": [
            {
                "kind": "PlayerSaved",
                "payload": {
                    "slot_id": saved_target,
                    "reasons": ["protected"],
                    "sources": [guardian_protect.actor_slot],
                }
            },
            {
                "kind": "InvestigationResult",
                "payload": {
                    "mode": "Parity",
                    "investigator": seer_check.actor_slot,
                    "target": investigation_target,
                    "result": "scum",
                }
            }
        ],
        "trace_decisions": [
            {
                "stage": "inner_event",
                "source": "event_index:0",
                "outcome": "player_saved",
                "detail": serde_json::Value::Null,
            },
            {
                "stage": "inner_event",
                "source": "event_index:1",
                "outcome": "investigation_result",
                "detail": serde_json::Value::Null,
            }
        ]
    }))
}

fn generated_default_open_day_expectations_json(
    case: &GeneratedDefaultOpenDayCase,
) -> serde_json::Value {
    serde_json::json!({
        "inner_events": [
            {
                "kind": "DayVoteOutcome",
                "payload": {
                    "status": "Lynch",
                    "winner": case.lynched_slot,
                }
            },
            {
                "kind": "PlayerKilled",
                "payload": {
                    "slot_id": case.lynched_slot,
                    "cause": "day_vote",
                    "attackers": [],
                    "unstoppable": true,
                }
            },
            {
                "kind": "WinReached",
                "payload": {
                    "winner": "town",
                }
            }
        ],
        "trace_decisions": [
            {
                "stage": "inner_event",
                "source": "event_index:3",
                "outcome": "day_vote_outcome",
                "detail": serde_json::Value::Null,
            }
        ]
    })
}

fn generated_action_by_template<'a>(
    case: &'a GeneratedNightCase,
    template_id: &str,
) -> Option<&'a GeneratedNightAction> {
    case.actions
        .iter()
        .find(|action| action.template_id == template_id)
}

fn generated_action_by_template_target<'a>(
    case: &'a GeneratedNightCase,
    template_id: &str,
    target: &str,
) -> Option<&'a GeneratedNightAction> {
    case.actions
        .iter()
        .find(|action| action.template_id == template_id && action.targets == vec![target])
}

fn generated_expectation_count(expectations: &serde_json::Value) -> usize {
    [
        "inner_events",
        "stream_events",
        "trace_decisions",
        "trace_notes",
        "generated_actions",
        "generated_action_counts",
        "delayed_death_queues",
        "absent_delayed_death_queues",
        "slot_effects",
        "absent_slot_effects",
        "player_notifications",
        "sheriff_badges",
        "slot_states",
    ]
    .into_iter()
    .map(|key| expectations[key].as_array().map_or(0, Vec::len))
    .sum()
}

fn generated_trigger_dependency_search_fixtures(
) -> BTreeMap<&'static str, GeneratedTriggerDependencyFixture> {
    generated_trigger_dependency_search_fixture_matrix(1)
        .into_iter()
        .filter_map(|(family, mut fixtures)| fixtures.pop().map(|fixture| (family, fixture)))
        .collect()
}

fn generated_trigger_dependency_search_fixture_matrix(
    per_family: usize,
) -> BTreeMap<&'static str, Vec<GeneratedTriggerDependencyFixture>> {
    let mut found: BTreeMap<&'static str, Vec<GeneratedTriggerDependencyFixture>> = BTreeMap::new();
    for seed in 91_001_u64..=104_000 {
        let case = generated_night_case(seed);
        let fixture_json = generated_night_case_fixture_json(&case, "mafiascum", seed + 43_000);
        let fixture: serde_json::Value =
            serde_json::from_str(&fixture_json).expect("generated trigger fixture should parse");
        let expectation_count = generated_expectation_count(&fixture["expectations"]);
        if expectation_count == 0 {
            continue;
        }

        for family in generated_mafiascum_trigger_dependency_families(&fixture) {
            let fixtures = found.entry(family).or_default();
            if fixtures.len() < per_family {
                fixtures.push(GeneratedTriggerDependencyFixture {
                    seed,
                    case: case.clone(),
                    fixture_json: fixture_json.clone(),
                    expectation_count,
                });
            }
        }

        if ["babysitter", "hider", "pgo"].into_iter().all(|family| {
            found
                .get(family)
                .is_some_and(|fixtures| fixtures.len() >= per_family)
        }) {
            break;
        }
    }
    found
}

fn generated_trigger_dependency_bad_expectation_fixture_json(
    family: &str,
    fixture_json: &str,
) -> String {
    let mut fixture: serde_json::Value =
        serde_json::from_str(fixture_json).expect("generated trigger fixture parses");
    match family {
        "pgo" => {
            let event = fixture["expectations"]["inner_events"]
                .as_array_mut()
                .and_then(|events| {
                    events.iter_mut().find(|event| {
                        event["kind"] == "Trigger"
                            && event["payload"]["trigger_id"] == "pgo_shoots_visitor"
                    })
                })
                .expect("generated PGO fixture carries trigger expectation");
            event["payload"]["trigger_id"] = serde_json::json!("pgo_shoots_wrong_visitor");
        }
        "babysitter" => {
            let event = fixture["expectations"]["inner_events"]
                .as_array_mut()
                .and_then(|events| {
                    events.iter_mut().find(|event| {
                        event["kind"] == "PlayerKilled" && event["payload"]["cause"] == "babysit"
                    })
                })
                .expect("generated Babysitter fixture carries dependency death expectation");
            event["payload"]["cause"] = serde_json::json!("babysit_wrong");
        }
        "hider" => {
            let event = fixture["expectations"]["inner_events"]
                .as_array_mut()
                .and_then(|events| {
                    events.iter_mut().find(|event| {
                        event["kind"] == "PlayerKilled" && event["payload"]["cause"] == "hide"
                    })
                })
                .expect("generated Hider fixture carries dependency death expectation");
            event["payload"]["cause"] = serde_json::json!("hide_wrong");
        }
        _ => unreachable!("unknown generated trigger/dependency family"),
    }
    serde_json::to_string_pretty(&fixture)
        .expect("generated trigger/dependency bad-expectation fixture serializes")
}

fn generated_mafiascum_trigger_dependency_families(
    fixture: &serde_json::Value,
) -> BTreeSet<&'static str> {
    let mut families = BTreeSet::new();
    let expectations = &fixture["expectations"];

    if expectations["generated_actions"]
        .as_array()
        .is_some_and(|actions| {
            actions
                .iter()
                .any(|action| action["action_id"] == "pgo_shoots_visitor")
        })
    {
        families.insert("pgo");
    }

    if expectations["trace_decisions"]
        .as_array()
        .is_some_and(|decisions| {
            decisions
                .iter()
                .any(|decision| decision["outcome"] == "babysitter_dependency_death")
        })
    {
        families.insert("babysitter");
    }

    if expectations["trace_decisions"]
        .as_array()
        .is_some_and(|decisions| {
            decisions
                .iter()
                .any(|decision| decision["outcome"] == "hider_dependency_death")
        })
    {
        families.insert("hider");
    }

    families
}

fn generated_role_for<'a>(case: &'a GeneratedNightCase, slot: &str) -> Option<&'a str> {
    case.roster
        .iter()
        .find_map(|(candidate, role)| (candidate == slot).then_some(role.as_str()))
}

fn has_generated_target_mutator(case: &GeneratedNightCase) -> bool {
    case.actions
        .iter()
        .any(|action| matches!(action.template_id.as_str(), "bus_driver_swap" | "redirect"))
}

fn generated_actor_is_suppressed(case: &GeneratedNightCase, actor: &str) -> bool {
    case.actions.iter().any(|action| {
        matches!(action.template_id.as_str(), "roleblocker_block" | "jail")
            && action.targets == vec![actor.to_string()]
    })
}

fn is_generated_kill_template(template_id: &str) -> bool {
    matches!(template_id, "factional_kill" | "strongman_kill")
}

fn pick_generated_slot<'a>(rng: &mut DeterministicRng, slots: &'a [&'a str]) -> &'a str {
    slots[rng.index(slots.len())]
}

async fn resolution_payload(
    pool: &PgPool,
    game: Uuid,
    phase_id: &str,
    _seed: u64,
) -> serde_json::Value {
    stored_payload_where(pool, game, "ResolutionApplied", &[("phase_id", phase_id)]).await
}

fn slot_number(slot: &str) -> usize {
    slot.strip_prefix("slot_")
        .and_then(|number| number.parse().ok())
        .expect("slot_N")
}

fn choose_target<'a>(rng: &mut DeterministicRng, slots: &'a [&'a str], actor: &str) -> &'a str {
    let candidates: Vec<_> = slots
        .iter()
        .copied()
        .filter(|slot| *slot != actor)
        .collect();
    candidates[rng.index(candidates.len())]
}

fn choose_target_pair<'a>(
    rng: &mut DeterministicRng,
    slots: &'a [&'a str],
    actor: &str,
) -> Vec<&'a str> {
    let first = choose_target(rng, slots, actor);
    let candidates: Vec<_> = slots
        .iter()
        .copied()
        .filter(|slot| *slot != actor && *slot != first)
        .collect();
    let second = candidates[rng.index(candidates.len())];
    vec![first, second]
}

async fn setup_chinese_wolf_faction_vote_game(
    pool: &PgPool,
    game: Uuid,
    host: &Principal,
    user_prefix: &str,
) {
    handle(
        pool,
        host,
        Command::CreateGame {
            game,
            pack: "chinese_structured".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, user_suffix, role) in [
        ("slot_1", "1", "wolf"),
        ("slot_2", "2", "wolf"),
        ("slot_3", "3", "villager"),
        ("slot_4", "4", "villager"),
        ("slot_5", "5", "villager"),
        ("slot_6", "6", "villager"),
    ] {
        handle(
            pool,
            host,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            pool,
            host,
            commands::seat_persona! {
                game,
                slot: slot.into(),
                user: format!("{user_prefix}_user_{user_suffix}"),
            },
        )
        .await
        .unwrap();
        handle(
            pool,
            host,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        pool,
        host,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
}

async fn submit_chinese_wolf_kill_vote(
    pool: &PgPool,
    game: Uuid,
    user_id: &str,
    actor_slot: &str,
    action_id: &str,
    target: &str,
) {
    handle(
        pool,
        &user(user_id),
        Command::SubmitAction {
            game,
            action_id: action_id.into(),
            actor_slot: actor_slot.into(),
            template_id: "wolf_night_kill".into(),
            targets: vec![target.into()],
            grant_id: None,
        },
    )
    .await
    .unwrap_or_else(|err| panic!("{actor_slot} submit wolf faction vote failed: {err}"));
}

async fn host_resolve_phase_consumes_white_wolf_carry_on_next_wolf_kill_for_role(pool: PgPool) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "chinese_structured".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", "white_wolf_king"),
        ("slot_2", "user_2", "villager"),
        ("slot_3", "user_3", "villager"),
        ("slot_4", "user_4", "villager"),
        ("slot_5", "user_5", "villager"),
        ("slot_6", "user_6", "wolf"),
        ("slot_7", "user_7", "villager"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            commands::seat_persona! {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();

    append_and_project(
        &pool,
        game,
        &[eventstore::EventInput::new(
            "ActionSubmitted",
            1,
            serde_json::json!({
                "action_id": "self_001",
                "template_id": "day_self_destruct",
                "actor": "slot_1",
                "targets": ["slot_2"],
                "phase_id": "D01"
            }),
            eventstore::ActorId::Slot("slot_1".into()),
            0,
        )],
    )
    .await
    .unwrap();
    handle(&pool, &h, Command::ResolvePhase { game, seed: 930011 })
        .await
        .expect("host resolves self-destruct day");

    let d01_payload =
        stored_payload_where(&pool, game, "ResolutionApplied", &[("phase_id", "D01")]).await;
    let d01 = domain::validate_resolution_json(&d01_payload, domain::RESULT_VERSION).unwrap();
    assert!(d01.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::WolfCarryQueued {
            owner_id,
            token_id,
            cause,
            role_key,
            ..
        } if owner_id == "slot_1"
            && token_id == "white_wolf_carry_token"
            && cause == "wolf_carry"
            && role_key == "white_wolf_king"
    )));

    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    append_and_project(
        &pool,
        game,
        &[eventstore::EventInput::new(
            "ActionSubmitted",
            1,
            serde_json::json!({
                "action_id": "wolfkill_001",
                "template_id": "wolf_night_kill",
                "actor": "slot_6",
                "targets": ["slot_3", "slot_4"],
                "phase_id": "N01"
            }),
            eventstore::ActorId::Slot("slot_6".into()),
            0,
        )],
    )
    .await
    .unwrap();
    handle(&pool, &h, Command::ResolvePhase { game, seed: 930012 })
        .await
        .expect("host resolves wolf carry night");

    let n01_payload =
        stored_payload_where(&pool, game, "ResolutionApplied", &[("phase_id", "N01")]).await;
    let n01 = domain::validate_resolution_json(&n01_payload, domain::RESULT_VERSION).unwrap();
    assert!(n01.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled {
            slot_id,
            cause,
            attackers,
            unstoppable,
        ..
        } if slot_id == "slot_3"
            && cause == "wolf_night_kill"
            && attackers == &vec!["slot_6".to_string()]
            && !*unstoppable
    )));
    assert!(n01.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::WolfCarryUsed {
            owner_id,
            target_id,
            source_action_id,
            effect_id,
            role_key,
            ..
        } if owner_id == "slot_1"
            && target_id == "slot_4"
            && source_action_id == "wolfkill_001:wolf_carry:1"
            && effect_id == "white_wolf_carry_token:wolfkill_001:wolf_carry:1"
            && role_key == "white_wolf_king"
    )));
    assert!(n01.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled {
            slot_id,
            cause,
            attackers,
            unstoppable,
        ..
        } if slot_id == "slot_4"
            && cause == "wolf_carry"
            && attackers == &vec!["slot_1".to_string()]
            && !*unstoppable
    )));

    let slots = slot_state(&pool, game).await.unwrap();
    for slot_id in ["slot_1", "slot_2", "slot_3", "slot_4"] {
        assert!(
            !slots
                .iter()
                .find(|slot| slot.slot_id == slot_id)
                .unwrap()
                .alive,
            "{slot_id} should be dead after self-destruct plus carry night"
        );
    }
    for slot_id in ["slot_5", "slot_6", "slot_7"] {
        assert!(
            slots
                .iter()
                .find(|slot| slot.slot_id == slot_id)
                .unwrap()
                .alive,
            "{slot_id} should remain alive after the carry vertical"
        );
    }

    let slots_before = serde_json::to_string(&slots).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        slots_before,
        serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap(),
        "slot_state rebuild must preserve White Wolf carry deaths"
    );
}

struct TargetLynchWinPipelineCase<'a> {
    policy: &'a str,
    role: &'a str,
    action_id: &'a str,
    template_id: &'a str,
    target_effect: &'a str,
    setup_seed: u64,
    day_seed: u64,
}

async fn assert_target_lynch_win_pipeline(pool: PgPool, case: TargetLynchWinPipelineCase<'_>) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [
        ("slot_1", "user_1", case.role),
        ("slot_2", "user_2", "vanilla_townie"),
        ("slot_3", "user_3", "vanilla_townie"),
        ("slot_4", "user_4", "vanilla_townie"),
        ("slot_5", "user_5", "mafia_goon"),
        ("slot_6", "user_6", "mafia_goon"),
    ] {
        handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            commands::seat_persona! {
                game,
                slot: slot.into(),
                user: occupant.into(),
            },
        )
        .await
        .unwrap();
        handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_1"),
        Command::SubmitAction {
            game,
            action_id: case.action_id.into(),
            actor_slot: "slot_1".into(),
            template_id: case.template_id.into(),
            targets: vec!["slot_2".into()],
            grant_id: None,
        },
    )
    .await
    .expect("target-lynch-win role chooses a target");
    handle(
        &pool,
        &h,
        Command::ResolvePhase {
            game,
            seed: case.setup_seed,
        },
    )
    .await
    .expect("host resolves target setup");

    let n01_payload =
        stored_payload_where(&pool, game, "ResolutionApplied", &[("phase_id", "N01")]).await;
    let n01 = domain::validate_resolution_json(&n01_payload, domain::RESULT_VERSION).unwrap();
    assert!(n01.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::TargetLynchWinTargeted {
            policy,
            owner,
            target,
            effect,
            source_action,
            ..
        } if policy == case.policy
            && owner == "slot_1"
            && target == "slot_2"
            && effect == case.target_effect
            && source_action == case.action_id
    )));
    assert!(
        slot_effects(&pool, game)
            .await
            .unwrap()
            .iter()
            .any(|effect| effect.slot_id == "slot_2" && effect.effect == case.target_effect),
        "target-lynch-win target should project as a persistent effect tag"
    );

    handle(
        &pool,
        &h,
        Command::OpenDayPhase {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .unwrap();
    for (user_id, actor_slot) in [
        ("user_1", "slot_1"),
        ("user_3", "slot_3"),
        ("user_4", "slot_4"),
        ("user_5", "slot_5"),
    ] {
        handle(
            &pool,
            &user(user_id),
            Command::SubmitVote {
                game,
                actor_slot: actor_slot.into(),
                target: VoteTarget::Slot("slot_2".into()),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &h,
        Command::ResolvePhase {
            game,
            seed: case.day_seed,
        },
    )
    .await
    .expect("host resolves target lynch");

    let d01_payload =
        stored_payload_where(&pool, game, "ResolutionApplied", &[("phase_id", "D01")]).await;
    let d01 = domain::validate_resolution_json(&d01_payload, domain::RESULT_VERSION).unwrap();
    assert!(d01.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::DayVoteOutcome(outcome)
            if outcome.winner.as_deref() == Some("slot_2")
    )));
    assert!(d01.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
            if slot_id == "slot_2" && cause == "day_vote"
    )));
    assert!(d01.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::WinReached { winner, metadata, .. }
            if winner == case.policy
                && metadata.as_ref().is_some_and(|metadata| {
                    metadata.policy.as_deref() == Some(case.policy)
                        && metadata.owner.as_deref() == Some("slot_1")
                        && metadata.target.as_deref() == Some("slot_2")
                        && metadata.source_action.as_deref() == Some(case.action_id)
                })
    )));

    let d01_trace_payload =
        stored_payload_where(&pool, game, "ResolutionTrace", &[("phase_id", "D01")]).await;
    let d01_trace = domain::validate_trace_json(&d01_trace_payload, domain::TRACE_VERSION)
        .expect("valid target-lynch-win trace");
    let trace_source = format!("action:{}", case.action_id);
    assert_decision_trace(
        &d01_trace,
        DecisionTraceExpectation {
            stage: "day:lynch_trigger",
            source: &trace_source,
            outcome: "target_lynch_win_reached",
            detail: vec![
                ("policy", serde_json::json!(case.policy)),
                ("owner", serde_json::json!("slot_1")),
                ("target", serde_json::json!("slot_2")),
                ("effect", serde_json::json!(case.target_effect)),
                ("winner", serde_json::json!(case.policy)),
                ("source_action", serde_json::json!(case.action_id)),
                ("target_phase_id", serde_json::json!("N01")),
                ("target_phase_kind", serde_json::json!("Night")),
                ("target_phase_number", serde_json::json!(1)),
            ],
        },
    );

    let slots = slot_state(&pool, game).await.unwrap();
    assert!(
        !slots
            .iter()
            .find(|slot| slot.slot_id == "slot_2")
            .unwrap()
            .alive,
        "target-lynch-win target should be lynched"
    );
    assert_win_revealed_all_slots(&slots, "target-lynch-win policy");

    let slots_before = serde_json::to_string(&slots).unwrap();
    let effects_before = serde_json::to_string(&slot_effects(&pool, game).await.unwrap()).unwrap();
    rebuild(&pool, game).await.expect("projection rebuild");
    assert_eq!(
        slots_before,
        serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap(),
        "slot_state rebuild must preserve target lynch win"
    );
    assert_eq!(
        effects_before,
        serde_json::to_string(&slot_effects(&pool, game).await.unwrap()).unwrap(),
        "slot_effect rebuild must preserve target mark"
    );
    let d01_trace_after_rebuild =
        stored_payload_where(&pool, game, "ResolutionTrace", &[("phase_id", "D01")]).await;
    assert_eq!(
        d01_trace_payload, d01_trace_after_rebuild,
        "projection rebuild must not rewrite target-lynch-win trace envelope"
    );
}

async fn assert_mafia_universe_bomber_case(
    pool: &PgPool,
    bomber_role: &str,
    killer_role: &str,
    kill_template: &str,
    direct_cause: &str,
    seed: u64,
) {
    let host = "host_h";
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafia_universe".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, role) in [
        ("slot_1", killer_role),
        ("slot_2", bomber_role),
        ("slot_3", "town_vanilla"),
        ("slot_4", "mafia_goon"),
        ("slot_5", "town_vanilla"),
    ] {
        handle(
            pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        handle(
            pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    let effects = slot_effects(pool, game).await.unwrap();
    assert!(
        effects.iter().any(|effect| {
            effect.slot_id == "slot_2"
                && effect.effect == "bomb"
                && effect.source_action.as_deref() == Some("role-assignment")
                && effect.visibility == "Hidden"
        }),
        "{bomber_role} role assignment should fold hidden bomb effect into projections"
    );

    handle(
        pool,
        &h,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await
    .unwrap();
    append_and_project(
        pool,
        game,
        &[eventstore::EventInput::new(
            "ActionSubmitted",
            1,
            serde_json::json!({
                "action_id": format!("mu_{bomber_role}_kill_n01"),
                "template_id": kill_template,
                "actor": "slot_1",
                "targets": ["slot_2"],
                "phase_id": "N01"
            }),
            eventstore::ActorId::Slot("slot_1".into()),
            0,
        )],
    )
    .await
    .unwrap();
    handle(pool, &h, Command::ResolvePhase { game, seed })
        .await
        .unwrap_or_else(|err| panic!("host resolves Mafia Universe {bomber_role}: {err:?}"));

    let applied_payload =
        stored_payload_where(pool, game, "ResolutionApplied", &[("phase_id", "N01")]).await;
    let applied = domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION)
        .unwrap_or_else(|err| panic!("valid Mafia Universe {bomber_role} result: {err}"));
    let trigger_index = applied
        .events
        .iter()
        .find_map(|indexed| match &indexed.event {
            domain::InnerEvent::Trigger {
                trigger_id,
                payload,
            } if trigger_id == "bomb_retaliates"
                && payload.on == "Kill"
                && payload.source_target == "slot_2"
                && payload.source_actor == "slot_1"
                && payload.source_cause == direct_cause
                && payload.produced_actor == "slot_2"
                && payload.produced_target == "slot_1" =>
            {
                Some(indexed.index)
            }
            _ => None,
        })
        .unwrap_or_else(|| panic!("Mafia Universe {bomber_role} should emit bomb trigger"));
    assert!(applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled { slot_id, cause, attackers, unstoppable, .. }
            if slot_id == "slot_2"
                && cause == direct_cause
                && attackers == &vec!["slot_1".to_string()]
                && !*unstoppable
    )));
    assert!(applied.events.iter().any(|indexed| matches!(
        &indexed.event,
        domain::InnerEvent::PlayerKilled { slot_id, cause, attackers, unstoppable, .. }
            if slot_id == "slot_1"
                && cause == "bomb_retaliates"
                && attackers == &vec!["slot_2".to_string()]
                && !*unstoppable
    )));
    assert!(
        !applied
            .events
            .iter()
            .any(|indexed| matches!(indexed.event, domain::InnerEvent::WinReached { .. })),
        "{bomber_role} vertical should stay focused on bomb trigger, not win resolution"
    );

    let trace_payload =
        stored_payload_where(pool, game, "ResolutionTrace", &[("phase_id", "N01")]).await;
    let trace = domain::validate_trace_json(&trace_payload, domain::TRACE_VERSION)
        .unwrap_or_else(|err| panic!("valid Mafia Universe {bomber_role} trace: {err}"));
    assert!(
        trace.notes.iter().any(|note| {
            note == &format!("trigger bomb_retaliates emitted at event_index {trigger_index}")
        }),
        "Mafia Universe {bomber_role} bomb trigger note should persist in ResolutionTrace"
    );
    assert_trigger_generated_trace(
        &trace,
        TriggerGeneratedTraceExpectation {
            action_id: "bomb_retaliates",
            on: "Kill",
            source_target: "slot_2",
            source_actor: "slot_1",
            source_cause: direct_cause,
            produced_actor: "slot_2",
            produced_target: "slot_1",
            actor_filter: None,
            event_index: trigger_index as i64,
        },
    );

    let slots = slot_state(pool, game).await.unwrap();
    assert!(
        !slots
            .iter()
            .find(|slot| slot.slot_id == "slot_1")
            .unwrap()
            .alive,
        "{bomber_role} retaliation should kill the original killer"
    );
    assert!(
        !slots
            .iter()
            .find(|slot| slot.slot_id == "slot_2")
            .unwrap()
            .alive,
        "{bomber_role} should die to the submitted kill"
    );

    let slots_before = serde_json::to_string(&slots).unwrap();
    rebuild(pool, game).await.expect("projection rebuild");
    assert_eq!(
        slots_before,
        serde_json::to_string(&slot_state(pool, game).await.unwrap()).unwrap(),
        "slot_state rebuild must preserve Mafia Universe {bomber_role} trigger deaths"
    );
    let trace_after_rebuild =
        stored_payload_where(pool, game, "ResolutionTrace", &[("phase_id", "N01")]).await;
    assert_eq!(
        trace_payload, trace_after_rebuild,
        "projection rebuild must not rewrite persisted Mafia Universe {bomber_role} trace envelope"
    );
}

// ───────────────────────── validation ─────────────────────────

async fn install_vote_insert_blocker(pool: &PgPool, game: Uuid, lock_key: i64) {
    let function_sql = format!(
        r#"
        CREATE OR REPLACE FUNCTION test_block_vote_insert() RETURNS trigger AS $$
        BEGIN
            IF NEW.stream_id = '{game}'::uuid AND NEW.kind = 'VoteSubmitted' THEN
                PERFORM pg_advisory_lock({lock_key});
                PERFORM pg_advisory_unlock({lock_key});
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        "#
    );
    sqlx::query(sqlx::AssertSqlSafe(function_sql.as_str()))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DROP TRIGGER IF EXISTS test_block_vote_insert ON events")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        r#"
        CREATE TRIGGER test_block_vote_insert
            BEFORE INSERT ON events
            FOR EACH ROW EXECUTE FUNCTION test_block_vote_insert()
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn install_deadline_insert_blocker(pool: &PgPool, game: Uuid, lock_key: i64) {
    let function_sql = format!(
        r#"
        CREATE OR REPLACE FUNCTION test_block_deadline_insert() RETURNS trigger AS $$
        BEGIN
            IF NEW.stream_id = '{game}'::uuid AND NEW.kind = 'DeadlineExtended' THEN
                PERFORM pg_advisory_lock({lock_key});
                PERFORM pg_advisory_unlock({lock_key});
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        "#
    );
    sqlx::query(sqlx::AssertSqlSafe(function_sql.as_str()))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DROP TRIGGER IF EXISTS test_block_deadline_insert ON events")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        r#"
        CREATE TRIGGER test_block_deadline_insert
            BEFORE INSERT ON events
            FOR EACH ROW EXECUTE FUNCTION test_block_deadline_insert()
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
}

// ───────────────────────── running-tally model ─────────────────────────

// ───────────────────────── conflict surfacing ─────────────────────────

async fn install_forced_deadline_stream_conflict(pool: &PgPool, game: Uuid) {
    let function_sql = format!(
        r#"
        CREATE OR REPLACE FUNCTION test_force_deadline_stream_conflict() RETURNS trigger AS $$
        BEGIN
            IF NEW.stream_id = '{game}'::uuid AND NEW.kind = 'DeadlineExtended' THEN
                NEW.stream_seq := NEW.stream_seq - 1;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        "#
    );
    sqlx::query(sqlx::AssertSqlSafe(function_sql.as_str()))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DROP TRIGGER IF EXISTS test_force_deadline_stream_conflict ON events")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        r#"
        CREATE TRIGGER test_force_deadline_stream_conflict
            BEFORE INSERT ON events
            FOR EACH ROW EXECUTE FUNCTION test_force_deadline_stream_conflict()
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn drop_forced_deadline_stream_conflict(pool: &PgPool) {
    sqlx::query("DROP TRIGGER IF EXISTS test_force_deadline_stream_conflict ON events")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DROP FUNCTION IF EXISTS test_force_deadline_stream_conflict()")
        .execute(pool)
        .await
        .unwrap();
}

async fn install_post_insert_blocker(pool: &PgPool, game: Uuid, lock_key: i64) {
    let function_sql = format!(
        r#"
        CREATE OR REPLACE FUNCTION test_block_post_insert() RETURNS trigger AS $$
        BEGIN
            IF NEW.stream_id = '{game}'::uuid AND NEW.kind = 'PostSubmitted' THEN
                PERFORM pg_advisory_lock({lock_key});
                PERFORM pg_advisory_unlock({lock_key});
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        "#
    );
    sqlx::query(sqlx::AssertSqlSafe(function_sql.as_str()))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DROP TRIGGER IF EXISTS test_block_post_insert ON events")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        r#"
        CREATE TRIGGER test_block_post_insert
            BEFORE INSERT ON events
            FOR EACH ROW EXECUTE FUNCTION test_block_post_insert()
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn drop_post_insert_blocker(pool: &PgPool) {
    sqlx::query("DROP TRIGGER IF EXISTS test_block_post_insert ON events")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DROP FUNCTION IF EXISTS test_block_post_insert()")
        .execute(pool)
        .await
        .unwrap();
}

async fn drop_vote_insert_blocker(pool: &PgPool) {
    sqlx::query("DROP TRIGGER IF EXISTS test_block_vote_insert ON events")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DROP FUNCTION IF EXISTS test_block_vote_insert()")
        .execute(pool)
        .await
        .unwrap();
}

async fn install_action_insert_blocker(pool: &PgPool, game: Uuid, lock_key: i64) {
    let function_sql = format!(
        r#"
        CREATE OR REPLACE FUNCTION test_block_action_insert() RETURNS trigger AS $$
        BEGIN
            IF NEW.stream_id = '{game}'::uuid AND NEW.kind = 'ActionSubmitted' THEN
                PERFORM pg_advisory_lock({lock_key});
                PERFORM pg_advisory_unlock({lock_key});
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        "#
    );
    sqlx::query(sqlx::AssertSqlSafe(function_sql.as_str()))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DROP TRIGGER IF EXISTS test_block_action_insert ON events")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        r#"
        CREATE TRIGGER test_block_action_insert
            BEFORE INSERT ON events
            FOR EACH ROW EXECUTE FUNCTION test_block_action_insert()
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn wait_for_advisory_wait_count(pool: &PgPool, min_waiting: i64) {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let waiting: i64 = sqlx::query_scalar(
                r#"
                SELECT count(*)
                    FROM pg_stat_activity
                    WHERE datname = current_database()
                      AND wait_event_type = 'Lock'
                      AND wait_event = 'advisory'
                "#,
            )
            .fetch_one(pool)
            .await
            .unwrap();
            if waiting >= min_waiting {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("handler reached the advisory-lock gate before timing out");
}

async fn install_thread_view_insert_blocker(pool: &PgPool, game: Uuid, lock_key: i64) {
    let function_sql = format!(
        r#"
        CREATE OR REPLACE FUNCTION test_block_thread_view_insert() RETURNS trigger AS $$
        BEGIN
            IF NEW.game_id = '{game}'::uuid THEN
                PERFORM pg_advisory_lock({lock_key});
                PERFORM pg_advisory_unlock({lock_key});
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        "#
    );
    sqlx::query(sqlx::AssertSqlSafe(function_sql.as_str()))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DROP TRIGGER IF EXISTS test_block_thread_view_insert ON thread_view")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "CREATE TRIGGER test_block_thread_view_insert AFTER INSERT ON thread_view \
         FOR EACH ROW EXECUTE FUNCTION test_block_thread_view_insert()",
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn drop_thread_view_insert_blocker(pool: &PgPool) {
    sqlx::query("DROP TRIGGER IF EXISTS test_block_thread_view_insert ON thread_view")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DROP FUNCTION IF EXISTS test_block_thread_view_insert()")
        .execute(pool)
        .await
        .unwrap();
}

async fn wait_for_cancelled_command_cleanup(
    pool: &PgPool,
    game: Uuid,
    command_id: Uuid,
    body: &str,
) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let receipt_count: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM command_receipt WHERE principal_user_id = $1 AND command_id = $2",
            )
            .bind("user_a")
            .bind(command_id)
            .fetch_one(pool)
            .await
            .unwrap();
            let event_count: i64 = stored_event_count_where(pool, game, "PostSubmitted", &[("body", body)]).await as i64;
            let projection_count: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM thread_view WHERE game_id = $1 AND body = $2",
            )
            .bind(game)
            .bind(body)
            .fetch_one(pool)
            .await
            .unwrap();
            if receipt_count == 0 && event_count == 0 && projection_count == 0 {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("cancelled command transaction rolled back");
    wait_for_no_command_runtime_resources(pool).await;
}

async fn wait_for_no_command_runtime_resources(pool: &PgPool) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let idle_transactions: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM pg_stat_activity \
                 WHERE datname = current_database() AND state = 'idle in transaction'",
            )
            .fetch_one(pool)
            .await
            .unwrap();
            let advisory_locks: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM pg_locks \
                 WHERE locktype = 'advisory' AND granted \
                   AND database = (SELECT oid FROM pg_database WHERE datname = current_database())",
            )
            .fetch_one(pool)
            .await
            .unwrap();
            if idle_transactions == 0 && advisory_locks == 0 {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("command cancellation left no advisory lock or idle transaction");
}

// A trivial Ack sanity helper kept to ensure the type is exercised.
#[allow(dead_code)]
fn _ack_shape(a: &Ack) -> usize {
    a.stream_seqs.len()
}
