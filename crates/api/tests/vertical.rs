use api::router;
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use commands::operator_proof::{
    audit_operator_proof_run_go_no_go_retention, build_operator_determinism_fuzz_report,
    build_operator_proof_run_go_no_go_report, build_operator_proof_run_status,
    determinism_fuzz_family_specs, generated_shrink_matrix_expected_families,
    OperatorGeneratedShrinkMatrixBadExpectation, OperatorGeneratedShrinkMatrixEntry,
    OperatorGeneratedShrinkMatrixReport, OperatorGeneratedShrinkMatrixSuccess,
    OperatorProofRunArtifactCounts, OperatorProofRunFixture, OperatorProofRunGoNoGoReport,
    OperatorProofRunGoNoGoRetentionReport, DETERMINISM_FUZZ_REPORT_ARTIFACT_VERSION,
    GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT, GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT,
    GENERATED_SHRINK_MATRIX_REPORT_ARTIFACT_VERSION,
    LARGE_ACTION_GRAPH_PERFORMANCE_REPORT_ARTIFACT_VERSION,
    PROJECTION_REBUILD_AUDIT_REPORT_ARTIFACT_VERSION, PROOF_RUN_GO_NO_GO_REPORT_ARTIFACT_VERSION,
    PROOF_RUN_GO_NO_GO_RETENTION_REPORT_ARTIFACT_VERSION,
    PROOF_RUN_STATUS_AUDIT_REPORT_ARTIFACT_VERSION, RESOLUTION_DIFF_REPORT_ARTIFACT_VERSION,
    TRACE_INSPECTION_REPORT_ARTIFACT_VERSION,
};
use futures_util::StreamExt;
use std::net::SocketAddr;
use std::process::Command as ProcessCommand;
use std::{fs, path::Path};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tower::ServiceExt;
use uuid::Uuid;
use wire::{
    ClientEnvelope, ClientMsg, Command, CommandMsg, HostPhaseControl, HostPromptDecision,
    PlayerInvestigationResult, PlayerNotification, ProjectionDelta, RejectCode, RejectMsg,
    ResolutionTraceInspectionReport, ServerEnvelope, ServerMsg, ThreadPage, VoteTarget,
    PROTOCOL_VERSION,
};

fn stable_command_id(id: u64) -> Uuid {
    Uuid::from_u128(id as u128)
}

fn command_envelope_with_command_id(
    id: u64,
    command_id: Uuid,
    principal_user_id: &str,
    command: Command,
) -> ClientEnvelope {
    ClientEnvelope::new(
        id,
        ClientMsg::Command(CommandMsg {
            command_id,
            principal_user_id: principal_user_id.to_string(),
            command,
        }),
    )
}

async fn post_command(
    app: axum::Router,
    id: u64,
    principal_user_id: &str,
    command: Command,
) -> ServerEnvelope {
    post_command_with_command_id(app, id, stable_command_id(id), principal_user_id, command).await
}

async fn post_command_with_command_id(
    app: axum::Router,
    id: u64,
    command_id: Uuid,
    principal_user_id: &str,
    command: Command,
) -> ServerEnvelope {
    let body = serde_json::to_vec(&command_envelope_with_command_id(
        id,
        command_id,
        principal_user_id,
        command,
    ))
    .unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/commands")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn http_get(addr: SocketAddr, path: &str) -> (u16, String) {
    let mut stream = tokio::net::TcpStream::connect(addr)
        .await
        .expect("connect smoke HTTP server");
    let request = format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .expect("write smoke HTTP request");

    let mut bytes = Vec::new();
    stream
        .read_to_end(&mut bytes)
        .await
        .expect("read smoke HTTP response");
    let response = String::from_utf8(bytes).expect("HTTP response is utf8");
    let (head, body) = response
        .split_once("\r\n\r\n")
        .expect("HTTP response has headers");
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .expect("HTTP response status code");
    let is_chunked = head
        .lines()
        .any(|line| line.eq_ignore_ascii_case("transfer-encoding: chunked"));
    let body = if is_chunked {
        decode_chunked_body(body)
    } else {
        body.to_string()
    };
    (status, body)
}

fn decode_chunked_body(input: &str) -> String {
    let mut rest = input.as_bytes();
    let mut body = Vec::new();
    loop {
        let line_end = rest
            .windows(2)
            .position(|window| window == b"\r\n")
            .expect("chunk has size line");
        let size_line = std::str::from_utf8(&rest[..line_end]).expect("chunk size is utf8");
        let size = usize::from_str_radix(size_line.split(';').next().unwrap_or("0"), 16)
            .expect("chunk size is hex");
        rest = &rest[line_end + 2..];
        if size == 0 {
            break;
        }
        body.extend_from_slice(&rest[..size]);
        rest = &rest[size + 2..];
    }
    String::from_utf8(body).expect("chunked body is utf8")
}

fn ensure_operator_proof_artifacts() {
    for (artifact, game_id, retention) in [
        (
            "target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json",
            "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
            None,
        ),
        (
            "target/operator-proof/game-specific-audit-bundle-20260613T001500Z.json",
            "3e3cccc1-c837-46d3-b0d6-1b83ae0cc82b",
            Some(true),
        ),
    ] {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(artifact);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut report = serde_json::json!({
            "ok": true,
            "manifest_version": 1,
            "game_id": game_id,
            "artifact_path": artifact,
            "runs": []
        });
        if let Some(normalized_match) = retention {
            report["retention_comparison"] = serde_json::json!({
                "normalized_match": normalized_match
            });
        }
        fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }

    let malformed_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/operator-proof/malformed-artifact-metadata-guard.json");
    fs::create_dir_all(malformed_path.parent().unwrap()).unwrap();
    fs::write(malformed_path, "{").unwrap();

    let missing_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/operator-proof/missing-artifact-provenance-guard.json");
    let _ = fs::remove_file(missing_path);

    write_operator_provenance_fixture(
        "target/operator-proof/path-mismatch-artifact-provenance-guard.json",
        "target/operator-proof/wrong-artifact-provenance-guard.json",
        1,
    );
    write_operator_provenance_fixture(
        "target/operator-proof/version-mismatch-artifact-provenance-guard.json",
        "target/operator-proof/version-mismatch-artifact-provenance-guard.json",
        2,
    );
    write_operator_provenance_fixture(
        "target/operator-proof/stale-artifact-provenance-guard.json",
        "target/operator-proof/stale-artifact-provenance-guard.json",
        1,
    );
    make_operator_artifact_stale("target/operator-proof/stale-artifact-provenance-guard.json");

    let report_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/operator-proof/current-status-audit-report.json");
    fs::create_dir_all(report_path.parent().unwrap()).unwrap();
    fs::write(
        &report_path,
        serde_json::to_vec_pretty(&serde_json::json!({
            "artifact_version": PROOF_RUN_STATUS_AUDIT_REPORT_ARTIFACT_VERSION,
            "artifact_path": "target/operator-proof/current-status-audit-report.json",
            "ok": true,
            "expected_path": "crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json",
            "actual_path": "target/operator-proof/current-status-audit-check.json",
            "normalized_fields": [
                "$.game",
                "$.families[*].runs[*].command.{game}",
                "$.families[*].runs[*].artifact.modified_at_unix_seconds",
                "$.families[*].runs[*].artifact.age_seconds"
            ],
            "diffs": []
        }))
        .unwrap(),
    )
    .unwrap();
    let go_no_go_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/operator-proof/current-artifact-go-no-go-report.json");
    let previous_go_no_go_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/operator-proof/previous-artifact-go-no-go-report.json");
    let retention_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/operator-proof/current-artifact-retention-report.json");
    let rebuild_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/operator-proof/current-projection-rebuild-report.json");
    let resolution_diff_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/operator-proof/current-resolution-diff-report.json");
    let trace_inspection_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/operator-proof/current-trace-inspection-report.json");
    let large_action_graph_performance_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/operator-proof/current-large-action-graph-performance-report.json");
    let determinism_fuzz_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/operator-proof/current-determinism-fuzz-report.json");
    let generated_shrink_matrix_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/operator-proof/current-generated-shrink-matrix-report.tmp.json");
    fs::write(
        &go_no_go_path,
        serde_json::to_vec_pretty(&OperatorProofRunGoNoGoReport {
            artifact_version: PROOF_RUN_GO_NO_GO_REPORT_ARTIFACT_VERSION,
            artifact_path: "target/operator-proof/current-artifact-go-no-go-report.json"
                .to_string(),
            ok: true,
            manifest_version: 1,
            production: OperatorProofRunArtifactCounts::default(),
            fixtures: OperatorProofRunArtifactCounts::default(),
            rows: Vec::new(),
        })
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &previous_go_no_go_path,
        serde_json::to_vec_pretty(&OperatorProofRunGoNoGoReport {
            artifact_version: PROOF_RUN_GO_NO_GO_REPORT_ARTIFACT_VERSION,
            artifact_path: "target/operator-proof/previous-artifact-go-no-go-report.json"
                .to_string(),
            ok: true,
            manifest_version: 1,
            production: OperatorProofRunArtifactCounts::default(),
            fixtures: OperatorProofRunArtifactCounts::default(),
            rows: Vec::new(),
        })
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &retention_path,
        serde_json::to_vec_pretty(&OperatorProofRunGoNoGoRetentionReport {
            artifact_version: PROOF_RUN_GO_NO_GO_RETENTION_REPORT_ARTIFACT_VERSION,
            artifact_path: "target/operator-proof/current-artifact-retention-report.json"
                .to_string(),
            ok: true,
            previous_path: "target/operator-proof/previous-artifact-go-no-go-report.json"
                .to_string(),
            latest_path: "target/operator-proof/current-artifact-go-no-go-report.json".to_string(),
            normalized_fields: vec![
                "$.production.*".to_string(),
                "$.fixtures.*".to_string(),
                "$.rows[*].state".to_string(),
            ],
            regressions: Vec::new(),
            recoveries: Vec::new(),
        })
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &rebuild_path,
        serde_json::to_vec_pretty(&serde_json::json!({
            "artifact_version": PROJECTION_REBUILD_AUDIT_REPORT_ARTIFACT_VERSION,
            "artifact_path": "target/operator-proof/current-projection-rebuild-report.json",
            "ok": true,
            "game_id": "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
            "isolation": "rollback-only transaction",
            "table_count": 13,
            "matched_table_count": 13,
            "drifted_table_count": 0,
            "tables": [
                {
                    "table": "slot_state",
                    "matches": true,
                    "before_rows": 6,
                    "rebuilt_rows": 6
                }
            ]
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &resolution_diff_path,
        serde_json::to_vec_pretty(&serde_json::json!({
            "artifact_version": RESOLUTION_DIFF_REPORT_ARTIFACT_VERSION,
            "artifact_path": "target/operator-proof/current-resolution-diff-report.json",
            "ok": true,
            "game_id": "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
            "normalized_fields": [
                "$.phases[*].applied_stream_seq",
                "$.phases[*].trace_stream_seq",
                "$.phases[*].stored_*",
                "$.phases[*].rebuilt_*"
            ],
            "audited_phase_count": 1,
            "matched_phase_count": 1,
            "drifted_phase_count": 0,
            "skipped_phase_count": 0,
            "diff_count": 0,
            "first_drift_paths": [],
            "phases": [
                {
                    "phase_id": "N01",
                    "run_id": "resolution:N01",
                    "status": "matched",
                    "applied_matches": true,
                    "trace_matches": true,
                    "diff_count": 0,
                    "diffs": []
                }
            ]
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &trace_inspection_path,
        serde_json::to_vec_pretty(&serde_json::json!({
            "artifact_version": TRACE_INSPECTION_REPORT_ARTIFACT_VERSION,
            "artifact_path": "target/operator-proof/current-trace-inspection-report.json",
            "ok": true,
            "game_id": "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
            "normalized_fields": [
                "$.traces[*].applied_stream_seq",
                "$.traces[*].trace_stream_seq",
                "$.traces[*].decisions[*].applied_stream_seq",
                "$.traces[*].edges[*].applied_stream_seq",
                "$.traces[*].generated[*].applied_stream_seq",
                "$.traces[*].effect_changes[*].applied_stream_seq",
                "$.traces[*].visibility[*].applied_stream_seq",
                "$.traces[*].notes[*].applied_stream_seq"
            ],
            "trace_count": 1,
            "decision_count": 1,
            "edge_count": 1,
            "generated_count": 1,
            "effect_change_count": 1,
            "visibility_count": 0,
            "note_count": 1,
            "traces": [
                {
                    "phase_id": "N01",
                    "run_id": "resolution:N01",
                    "applied_stream_seq": 14,
                    "trace_stream_seq": 15,
                    "trace_version": 1,
                    "decision_count": 1,
                    "edge_count": 1,
                    "generated_count": 1,
                    "effect_change_count": 1,
                    "visibility_count": 0,
                    "note_count": 1,
                    "decisions": [{"stage": "resolve", "outcome": "applied"}],
                    "edges": [{"from": "slot_1", "to": "slot_2", "kind": "visit"}],
                    "generated": [{"action_id": "generated:1", "actor": "slot_1"}],
                    "effect_changes": [{"effect": "dead", "target": "slot_2"}],
                    "visibility": [],
                    "notes": [{"note": "fixture trace"}]
                }
            ]
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &large_action_graph_performance_path,
        serde_json::to_vec_pretty(&serde_json::json!({
            "artifact_version": LARGE_ACTION_GRAPH_PERFORMANCE_REPORT_ARTIFACT_VERSION,
            "artifact_path": "target/operator-proof/current-large-action-graph-performance-report.json",
            "ok": true,
            "game_id": "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
            "pack": "mafiascum",
            "phase_id": "N01",
            "seed": commands::LARGE_ACTION_GRAPH_PERFORMANCE_SEED,
            "resolve_seed": commands::LARGE_ACTION_GRAPH_PERFORMANCE_SEED + 41000,
            "roster_count": 40,
            "submitted_action_count": 29,
            "resolution_inner_event_count": 12,
            "stream_event_count": 115,
            "trace_row_count": 74,
            "phase_trace_anchored": true,
            "decision_trace_anchored": true,
            "resolve_elapsed_ms": 321,
            "threshold_ms": commands::LARGE_ACTION_GRAPH_PERFORMANCE_THRESHOLD_MS,
            "replay_audit_ok": true,
            "replay_audited": 1,
            "replay_skipped": 0,
            "projection_rebuild_ok": true,
            "pgo_triggered": true,
            "babysitter_death": true,
            "hider_death": true,
            "lovers_linked": true
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &determinism_fuzz_path,
        serde_json::to_vec_pretty(&determinism_fuzz_bootstrap_report(
            "target/operator-proof/current-determinism-fuzz-report.json",
        ))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &generated_shrink_matrix_path,
        serde_json::to_vec_pretty(&generated_shrink_matrix_bootstrap_report(
            "target/operator-proof/current-generated-shrink-matrix-report.tmp.json",
        ))
        .unwrap(),
    )
    .unwrap();

    let status_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/operator-proof/current-status-audit-check.json");
    fs::create_dir_all(status_path.parent().unwrap()).unwrap();
    let mut trusted_production = OperatorProofRunArtifactCounts::default();
    trusted_production.total_artifact_rows = 12;
    trusted_production.trusted = 12;
    trusted_production.non_trusted = 0;

    let snapshot_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json");
    fs::write(&status_path, fs::read(&snapshot_path).unwrap()).unwrap();
    fs::write(
        &report_path,
        serde_json::to_vec_pretty(&serde_json::json!({
            "artifact_version": PROOF_RUN_STATUS_AUDIT_REPORT_ARTIFACT_VERSION,
            "artifact_path": "target/operator-proof/current-status-audit-report.json",
            "ok": true,
            "expected_path": "crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json",
            "actual_path": "target/operator-proof/current-status-audit-check.json",
            "normalized_fields": [
                "$.game",
                "$.families[*].runs[*].command.{game}",
                "$.families[*].runs[*].artifact.modified_at_unix_seconds",
                "$.families[*].runs[*].artifact.age_seconds"
            ],
            "diffs": []
        }))
        .unwrap(),
    )
    .unwrap();

    let bootstrap_go_no_go_report = OperatorProofRunGoNoGoReport {
        artifact_version: PROOF_RUN_GO_NO_GO_REPORT_ARTIFACT_VERSION,
        artifact_path: "target/operator-proof/current-artifact-go-no-go-report.json".to_string(),
        ok: true,
        manifest_version: 1,
        production: trusted_production,
        fixtures: OperatorProofRunArtifactCounts::default(),
        rows: Vec::new(),
    };
    fs::write(
        &go_no_go_path,
        serde_json::to_vec_pretty(&bootstrap_go_no_go_report).unwrap(),
    )
    .unwrap();
    fs::write(
        &previous_go_no_go_path,
        serde_json::to_vec_pretty(&bootstrap_go_no_go_report).unwrap(),
    )
    .unwrap();
    let go_no_go_report = build_operator_proof_run_go_no_go_report(
        Uuid::from_u128(0),
        Some(OperatorProofRunFixture::ArtifactProvenance),
        "target/operator-proof/current-artifact-go-no-go-report.json",
    );
    fs::write(
        &go_no_go_path,
        serde_json::to_vec_pretty(&go_no_go_report).unwrap(),
    )
    .unwrap();
    fs::write(
        &previous_go_no_go_path,
        serde_json::to_vec_pretty(&go_no_go_report).unwrap(),
    )
    .unwrap();
    let retention_report = audit_operator_proof_run_go_no_go_retention(
        "target/operator-proof/previous-artifact-go-no-go-report.json",
        go_no_go_report.clone(),
        "target/operator-proof/current-artifact-go-no-go-report.json",
        go_no_go_report,
        "target/operator-proof/current-artifact-retention-report.json",
    );
    fs::write(
        &retention_path,
        serde_json::to_vec_pretty(&retention_report).unwrap(),
    )
    .unwrap();
}

fn determinism_fuzz_bootstrap_report(
    artifact_path: &str,
) -> commands::operator_proof::OperatorDeterminismFuzzReport {
    let output = determinism_fuzz_family_specs()
        .iter()
        .map(|family| format!("test {} ... ok", family.selector))
        .collect::<Vec<_>>()
        .join("\n");
    build_operator_determinism_fuzz_report(
        artifact_path,
        "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin audit_determinism_fuzz_artifact -- --output target/operator-proof/current-determinism-fuzz-report.json",
        "replay_audit_and_rebuild_deterministically",
        1234,
        true,
        &output,
    )
}

fn generated_shrink_matrix_bootstrap_report(
    artifact_path: &str,
) -> OperatorGeneratedShrinkMatrixReport {
    let families = generated_shrink_matrix_expected_families();
    let entries = families
        .iter()
        .flat_map(|(family, count)| {
            (0..*count).map(move |index| {
                let seed = 90_000 + index as u64;
                OperatorGeneratedShrinkMatrixEntry {
                    family: family.clone(),
                    seed,
                    expectation_count: 3,
                    success: OperatorGeneratedShrinkMatrixSuccess {
                        ok: true,
                        success_invariant_preserved: true,
                        promoted_success_fixture: true,
                        reduction_steps: 2,
                        report_path: format!(
                            "target/operator-proof/generated-shrink-matrix-{family}-{seed}-ok.report.tmp.json"
                        ),
                        reduced_path: format!(
                            "target/operator-proof/generated-shrink-matrix-{family}-{seed}-ok.reduced.tmp.json"
                        ),
                    },
                    bad_expectation: OperatorGeneratedShrinkMatrixBadExpectation {
                        ok: false,
                        failure_class: "semantic_expectation".to_string(),
                        failure_class_preserved: true,
                        promoted_success_fixture: false,
                        reduction_steps: 1,
                        report_path: format!(
                            "target/operator-proof/generated-shrink-matrix-{family}-{seed}-bad.report.tmp.json"
                        ),
                        reduced_path: format!(
                            "target/operator-proof/generated-shrink-matrix-{family}-{seed}-bad.reduced.tmp.json"
                        ),
                    },
                }
            })
        })
        .collect::<Vec<_>>();
    OperatorGeneratedShrinkMatrixReport {
        artifact_version: GENERATED_SHRINK_MATRIX_REPORT_ARTIFACT_VERSION,
        artifact_path: artifact_path.to_string(),
        ok: true,
        proof_boundary: "fixture generated shrink matrix boundary".to_string(),
        family_count: GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT,
        case_count: GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT,
        expected_family_count: GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT,
        expected_case_count: GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT,
        family_manifest_matched: true,
        families,
        entries,
    }
}

fn write_operator_provenance_fixture(path: &str, reported_path: &str, manifest_version: u16) {
    let artifact_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path);
    fs::create_dir_all(artifact_path.parent().unwrap()).unwrap();
    fs::write(
        artifact_path,
        serde_json::to_vec_pretty(&serde_json::json!({
            "ok": true,
            "manifest_version": manifest_version,
            "game_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "artifact_path": reported_path,
            "runs": []
        }))
        .unwrap(),
    )
    .unwrap();
}

fn make_operator_artifact_stale(path: &str) {
    let artifact_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path);
    let status = ProcessCommand::new("touch")
        .args(["-t", "200001010000"])
        .arg(&artifact_path)
        .status()
        .expect("touch stale artifact");
    assert!(status.success(), "touch stale artifact should succeed");
}

fn table_row_for<'a>(html: &'a str, row_id: &str) -> &'a str {
    let needle = format!("id=\"{row_id}\"");
    let start = html.find(&needle).expect("row id should render");
    let tail = &html[start..];
    let end = tail.find("</tr>").expect("row should close");
    &tail[..end]
}

fn proof_status_row<'a>(status: &'a serde_json::Value, row_id: &str) -> &'a serde_json::Value {
    status["families"]
        .as_array()
        .expect("status families")
        .iter()
        .flat_map(|family| family["runs"].as_array().expect("status runs"))
        .find(|run| run["row_id"] == row_id)
        .unwrap_or_else(|| panic!("status row {row_id} should render"))
}

fn proof_go_no_go_row<'a>(report: &'a serde_json::Value, row_id: &str) -> &'a serde_json::Value {
    report["rows"]
        .as_array()
        .expect("go/no-go rows")
        .iter()
        .find(|row| row["row_id"] == row_id)
        .unwrap_or_else(|| panic!("go/no-go row {row_id} should render"))
}

fn assert_proof_status_contract(status: &serde_json::Value) {
    assert_eq!(status["contract_version"], 1);
    assert!(status["game"].as_str().is_some(), "game should be a string");
    assert!(
        status["manifest_version"].as_u64().is_some(),
        "manifest_version should be numeric"
    );
    assert_eq!(status["execution"], "local-only command copy");

    let families = status["families"].as_array().expect("families array");
    let mut production = ProofStatusCounts::default();
    let mut fixtures = ProofStatusCounts::default();
    for family in families {
        assert!(
            family["heading"].as_str().is_some(),
            "family heading should be string"
        );
        let family_fixture = family["fixture"].as_bool().expect("family fixture bool");
        let runs = family["runs"].as_array().expect("family runs array");
        for row in runs {
            for field in [
                "id",
                "row_id",
                "family",
                "scope",
                "command",
                "proof_boundary",
            ] {
                assert!(
                    row[field].as_str().is_some(),
                    "row {field} should be string"
                );
            }
            assert_eq!(row["fixture"].as_bool(), Some(family_fixture));
            let artifact = &row["artifact"];
            if artifact.is_null() {
                continue;
            }
            assert!(
                artifact["path"].as_str().is_some(),
                "artifact path should be string"
            );
            let state = artifact["state"]
                .as_str()
                .expect("artifact state should be string");
            if family_fixture {
                fixtures.record(state);
            } else {
                production.record(state);
            }
            match state {
                "trusted" => {
                    assert_artifact_number(artifact, "modified_at_unix_seconds");
                    assert_artifact_number(artifact, "age_seconds");
                    assert_artifact_number(artifact, "freshness_max_age_seconds");
                    if let Some(metadata) = artifact.get("trusted_metadata") {
                        let metadata = metadata.as_object().expect("trusted metadata object");
                        assert!(!metadata.is_empty(), "trusted metadata should not be empty");
                        assert_optional_metadata_string(metadata, "game_id");
                        for field in [
                            "manifest_version",
                            "resolve_elapsed_ms",
                            "threshold_ms",
                            "trace_row_count",
                            "family_count",
                            "seed_count",
                            "expected_family_count",
                            "expected_seed_count",
                        ] {
                            assert_optional_metadata_u64(metadata, field);
                        }
                        for field in [
                            "retention_comparison_normalized_match",
                            "phase_trace_anchored",
                            "decision_trace_anchored",
                            "family_manifest_matched",
                        ] {
                            assert_optional_metadata_bool(metadata, field);
                        }
                    } else {
                        assert_artifact_number(artifact, "artifact_version");
                        assert_artifact_number(artifact, "expected_version");
                        if artifact.get("expected_path").is_some() {
                            assert!(artifact["expected_path"].as_str().is_some());
                            assert!(artifact["actual_path"].as_str().is_some());
                        }
                        assert_artifact_number(artifact, "diff_count");
                    }
                    assert!(artifact.get("reported_path").is_none());
                }
                "stale" => {
                    assert_artifact_number(artifact, "modified_at_unix_seconds");
                    assert_artifact_number(artifact, "age_seconds");
                    assert_artifact_number(artifact, "freshness_max_age_seconds");
                    assert!(artifact.get("trusted_metadata").is_none());
                }
                "path_mismatch" => {
                    assert!(artifact["reported_path"].as_str().is_some());
                    assert!(artifact.get("trusted_metadata").is_none());
                }
                "version_mismatch" => {
                    assert_artifact_number(artifact, "artifact_version");
                    assert_artifact_number(artifact, "expected_version");
                    assert!(artifact.get("trusted_metadata").is_none());
                }
                "input_mismatch" => {
                    assert!(artifact["expected_path"].as_str().is_some());
                    assert!(artifact["actual_path"].as_str().is_some());
                    assert!(artifact["reported_expected_path"].as_str().is_some());
                    assert!(artifact["reported_actual_path"].as_str().is_some());
                    assert!(artifact.get("trusted_metadata").is_none());
                }
                "drifted" => {
                    assert_artifact_number(artifact, "diff_count");
                    assert_artifact_number(artifact, "modified_at_unix_seconds");
                    assert_artifact_number(artifact, "age_seconds");
                    assert_artifact_number(artifact, "freshness_max_age_seconds");
                    assert!(artifact.get("trusted_metadata").is_none());
                }
                "missing" | "malformed" => {
                    assert!(artifact.get("trusted_metadata").is_none());
                }
                other => panic!("unknown artifact status state {other}"),
            }
        }
    }
    assert_proof_status_counts(status, "production", &production);
    assert_proof_status_counts(status, "fixtures", &fixtures);
}

fn normalized_proof_status_for_compare(
    mut status: serde_json::Value,
    game: Uuid,
) -> serde_json::Value {
    normalize_proof_status_value(&mut status, game.to_string().as_str());
    status
}

fn normalize_proof_status_value(value: &mut serde_json::Value, game: &str) {
    match value {
        serde_json::Value::Object(object) => {
            if object.contains_key("modified_at_unix_seconds") {
                object.insert(
                    "modified_at_unix_seconds".to_string(),
                    serde_json::Value::String("<normalized-mtime>".to_string()),
                );
            }
            if object.contains_key("age_seconds") {
                object.insert(
                    "age_seconds".to_string(),
                    serde_json::Value::String("<normalized-age>".to_string()),
                );
            }
            for nested in object.values_mut() {
                normalize_proof_status_value(nested, game);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                normalize_proof_status_value(item, game);
            }
        }
        serde_json::Value::String(text) => {
            if text.contains(game) {
                *text = text.replace(game, "<normalized-game>");
            }
        }
        _ => {}
    }
}

#[derive(Default)]
struct ProofStatusCounts {
    total_artifact_rows: u64,
    trusted: u64,
    stale: u64,
    missing: u64,
    malformed: u64,
    path_mismatch: u64,
    version_mismatch: u64,
    input_mismatch: u64,
    drifted: u64,
}

impl ProofStatusCounts {
    fn record(&mut self, state: &str) {
        self.total_artifact_rows += 1;
        match state {
            "trusted" => self.trusted += 1,
            "stale" => self.stale += 1,
            "missing" => self.missing += 1,
            "malformed" => self.malformed += 1,
            "path_mismatch" => self.path_mismatch += 1,
            "version_mismatch" => self.version_mismatch += 1,
            "input_mismatch" => self.input_mismatch += 1,
            "drifted" => self.drifted += 1,
            other => panic!("unknown proof status state {other}"),
        }
    }

    fn non_trusted(&self) -> u64 {
        self.total_artifact_rows.saturating_sub(self.trusted)
    }
}

fn assert_artifact_number(artifact: &serde_json::Value, field: &str) {
    assert!(
        artifact[field].as_u64().is_some(),
        "artifact {field} should be numeric"
    );
}

fn assert_optional_metadata_string(
    metadata: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) {
    if let Some(value) = metadata.get(field) {
        assert!(
            value.as_str().is_some(),
            "trusted metadata {field} should be string"
        );
    }
}

fn assert_optional_metadata_u64(
    metadata: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) {
    if let Some(value) = metadata.get(field) {
        assert!(
            value.as_u64().is_some(),
            "trusted metadata {field} should be numeric"
        );
    }
}

fn assert_optional_metadata_bool(
    metadata: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) {
    if let Some(value) = metadata.get(field) {
        assert!(
            value.as_bool().is_some(),
            "trusted metadata {field} should be bool"
        );
    }
}

fn assert_proof_status_counts(
    status: &serde_json::Value,
    scope: &str,
    expected: &ProofStatusCounts,
) {
    let summary = &status["summary"][scope];
    for (field, value) in [
        ("total_artifact_rows", expected.total_artifact_rows),
        ("trusted", expected.trusted),
        ("stale", expected.stale),
        ("missing", expected.missing),
        ("malformed", expected.malformed),
        ("path_mismatch", expected.path_mismatch),
        ("version_mismatch", expected.version_mismatch),
        ("input_mismatch", expected.input_mismatch),
        ("drifted", expected.drifted),
        ("non_trusted", expected.non_trusted()),
    ] {
        assert_eq!(
            summary[field].as_u64(),
            Some(value),
            "{scope}.{field} should match status rows"
        );
    }
}

fn expect_ack(envelope: ServerEnvelope) -> Vec<i64> {
    match envelope.body {
        ServerMsg::Ack(ack) => {
            assert!(!ack.stream_seqs.is_empty());
            ack.stream_seqs
        }
        other => panic!("expected Ack, got {other:?}"),
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_command_boundary_updates_votecount(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            3,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_2".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            4,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: "user_a".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            5,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_1".into(),
                role_key: "vanilla_townie".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            6,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_2".into(),
                role_key: "vanilla_townie".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            7,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            8,
            "user_a",
            Command::SubmitVote {
                game,
                actor_slot: "slot_1".into(),
                target: VoteTarget::Slot("slot_2".into()),
            },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/votecount"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let deltas: Vec<ProjectionDelta> = serde_json::from_slice(&bytes).unwrap();

    assert!(deltas.iter().any(|delta| matches!(
        delta,
        ProjectionDelta::VoteCountChanged(v)
            if v.game == game
                && v.phase_id == "D01"
                && v.candidate_slot == "slot_2"
                && v.count == 1
    )));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_day_vote_outcomes_returns_canonical_engine_result(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            11,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    for (idx, slot, user_id, role) in [
        (12, "slot_1", "user_1", "vanilla_townie"),
        (16, "slot_2", "user_2", "vanilla_townie"),
        (20, "slot_3", "user_3", "mafia_goon"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                idx,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                idx + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user_id.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                idx + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            24,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );
    for (idx, user_id, actor_slot) in [(25, "user_1", "slot_1"), (26, "user_2", "slot_2")] {
        expect_ack(
            post_command(
                app.clone(),
                idx,
                user_id,
                Command::SubmitVote {
                    game,
                    actor_slot: actor_slot.into(),
                    target: VoteTarget::NoLynch,
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            27,
            "host_h",
            Command::ResolvePhase { game, seed: 606 },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/day-vote-outcomes"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let deltas: Vec<ProjectionDelta> = serde_json::from_slice(&bytes).unwrap();

    assert!(deltas.iter().any(|delta| matches!(
        delta,
        ProjectionDelta::DayVoteOutcomeApplied(outcome)
            if outcome.game == game
                && outcome.phase_id == "D01"
                && outcome.status == "NoLynch"
                && outcome.winner_slot.is_none()
                && outcome.tallies["no_lynch"] == serde_json::json!(2.0)
    )));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_projection_audit_is_host_audit_only_and_reports_drift(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            101,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            102,
            "host_h",
            Command::AddCohost {
                game,
                user: "cohost_c".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            103,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            104,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: "user_1".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            105,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_1".into(),
                role_key: "vanilla_townie".into(),
            },
        )
        .await,
    );

    let update = sqlx::query(
        "UPDATE slot_state SET role_key = 'tampered_role' \
         WHERE game_id = $1 AND slot_id = 'slot_1'",
    )
    .bind(game)
    .execute(&pool)
    .await
    .expect("tamper live slot_state row");
    assert_eq!(update.rows_affected(), 1, "one slot_state row tampered");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/projection-audit?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let report: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(report["game_id"], game.to_string());
    assert_eq!(report["ok"], false);
    let tables = report["tables"].as_array().unwrap();
    let slot_state_index = tables
        .iter()
        .position(|table| table["table"] == "slot_state")
        .expect("slot_state table audit");
    let slot_state = &tables[slot_state_index];
    assert_eq!(slot_state["matches"], false);
    assert_eq!(slot_state["before_rows"], 1);
    assert_eq!(slot_state["rebuilt_rows"], 1);
    assert_eq!(slot_state["before"][0]["role_key"], "tampered_role");
    assert_eq!(slot_state["rebuilt"][0]["role_key"], "vanilla_townie");

    let live_role: Option<String> = sqlx::query_scalar(
        "SELECT role_key FROM slot_state WHERE game_id = $1 AND slot_id = 'slot_1'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .expect("live slot_state after rollback audit");
    assert_eq!(
        live_role.as_deref(),
        Some("tampered_role"),
        "projection audit must not repair live rows"
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/projection-audit/view?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(html.contains("Projection Rebuild Audit"));
    assert!(html.contains("slot_state"));
    assert!(html.contains("tampered_role"));
    assert!(html.contains("vanilla_townie"));
    assert!(html.contains("before"));
    assert!(html.contains("rebuilt"));
    let table_row_id = format!("projection-table-row-{slot_state_index}");
    let before_id = format!("projection-table-before-{slot_state_index}");
    let rebuilt_id = format!("projection-table-rebuilt-{slot_state_index}");
    assert!(html.contains(&format!(
        "class=\"value projection-link drift\" href=\"#{table_row_id}\">1</a>"
    )));
    assert!(html.contains(&format!("id=\"{table_row_id}\"")));
    assert!(html.contains(&format!("href=\"#{table_row_id}\"")));
    assert!(html.contains(&format!("id=\"{before_id}\"")));
    assert!(html.contains(&format!("href=\"#{before_id}\"")));
    assert!(html.contains(&format!("id=\"{rebuilt_id}\"")));
    assert!(html.contains(&format!("href=\"#{rebuilt_id}\"")));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/projection-audit/view?principal_user_id=cohost_c"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let cohost_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(cohost_html.contains("slot_state"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/projection-audit?principal_user_id=user_1"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status-audit?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status-audit/view?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/projection-audit/view?principal_user_id=user_1"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/retention?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/projection-rebuild?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/resolution-diff?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/trace-inspection?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_operator_index_is_host_audit_only(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();
    ensure_operator_proof_artifacts();

    expect_ack(
        post_command(
            app.clone(),
            201,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            202,
            "host_h",
            Command::AddCohost {
                game,
                user: "cohost_c".into(),
            },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/operator?principal_user_id=host_h"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(html.contains("Operator Index"));
    assert!(html.contains("Projection Rebuild Audit"));
    assert!(html.contains("Resolution Replay Audit"));
    assert!(html.contains("Resolution Trace Inspection"));
    assert!(html.contains("Host Phase-Control Audit"));
    assert!(html.contains("Operator Proof-Run Index"));
    assert!(html.contains("Operator Proof-Run Status Audit"));
    assert!(html.contains("Operator Proof Artifact Go/No-Go"));
    assert!(html.contains("Operator Proof Artifact Retention"));
    assert!(html.contains("Operator Projection Rebuild Report"));
    assert!(html.contains("Operator Resolution Diff Report"));
    assert!(html.contains("Operator Trace Inspection Report"));
    assert!(html.contains(&format!(
        "/games/{game}/projection-audit/view?principal_user_id=host_h"
    )));
    assert!(html.contains(&format!(
        "/games/{game}/resolution-audit/view?principal_user_id=host_h"
    )));
    assert!(html.contains(&format!(
        "/games/{game}/resolution-traces/view?principal_user_id=host_h"
    )));
    assert!(html.contains(&format!(
        "/games/{game}/host-phase-controls?principal_user_id=host_h"
    )));
    assert!(html.contains(&format!(
        "/games/{game}/operator/proof-runs?principal_user_id=host_h"
    )));
    assert!(html.contains(&format!(
        "/games/{game}/operator/proof-runs/status-audit/view?principal_user_id=host_h"
    )));
    assert!(html.contains(&format!(
        "/games/{game}/operator/proof-runs/go-no-go/view?principal_user_id=host_h"
    )));
    assert!(html.contains(&format!(
        "/games/{game}/operator/proof-runs/retention/view?principal_user_id=host_h"
    )));
    assert!(html.contains(&format!(
        "/games/{game}/operator/proof-runs/projection-rebuild/view?principal_user_id=host_h"
    )));
    assert!(html.contains(&format!(
        "/games/{game}/operator/proof-runs/resolution-diff/view?principal_user_id=host_h"
    )));
    assert!(html.contains(&format!(
        "/games/{game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h"
    )));
    assert!(html.contains(&format!(
        "/games/{game}/operator/proof-runs/large-action-graph-performance/view?principal_user_id=host_h"
    )));
    assert!(html.contains(&format!(
        "/games/{game}/operator/proof-runs/determinism-fuzz/view?principal_user_id=host_h"
    )));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let proof_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(proof_html.contains("Operator Proof-Run Index"));
    assert!(proof_html.contains("Local-Only Regression Lanes"));
    assert!(proof_html.contains("Game-Specific Audits"));
    assert!(proof_html.contains("server page does not execute background jobs"));
    assert!(proof_html.contains("Production Artifacts"));
    assert!(proof_html.contains("trusted 12 / 12; non_trusted 0"));
    assert!(proof_html.contains("Fixture Artifacts"));
    assert!(proof_html.contains("trusted 0 / 0; non_trusted 0"));
    assert!(proof_html.contains("id=\"proof-run-large-action-graph-regression\""));
    assert!(proof_html.contains("href=\"#proof-run-large-action-graph-regression\""));
    assert!(proof_html.contains("id=\"proof-run-game-specific-audit-artifact-retention\""));
    assert!(proof_html.contains("id=\"proof-run-operator-proof-status-export\""));
    assert!(proof_html.contains("id=\"proof-run-operator-proof-status-snapshot-audit\""));
    assert!(proof_html.contains("id=\"proof-run-operator-proof-artifact-go-no-go\""));
    assert!(proof_html.contains("id=\"proof-run-operator-proof-artifact-retention\""));
    assert!(proof_html.contains("id=\"proof-run-operator-proof-projection-rebuild\""));
    assert!(proof_html.contains("id=\"proof-run-operator-proof-resolution-diff\""));
    assert!(proof_html.contains("id=\"proof-run-operator-proof-trace-inspection\""));
    assert!(proof_html.contains("id=\"proof-run-operator-proof-large-action-graph-performance\""));
    assert!(proof_html.contains("id=\"proof-run-operator-proof-determinism-fuzz\""));
    assert!(proof_html.contains("id=\"proof-run-operator-proof-generated-shrink-matrix\""));
    assert!(proof_html.contains(&format!(
        "cargo run -p commands --bin audit_resolution -- {game}"
    )));
    assert!(proof_html.contains(
        "cargo test -p commands large_action_graph_resolves_and_audits_within_regression_ceiling -- --nocapture"
    ));
    assert!(proof_html.contains(
        "cargo test -p commands --test pipeline generated_default_open_day_replay_audit_and_rebuild_deterministically -- --nocapture"
    ));
    assert!(proof_html
        .contains("target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json"));
    assert!(proof_html
        .contains("target/operator-proof/game-specific-audit-bundle-20260613T001500Z.json"));
    assert!(proof_html.contains("game_id: 08d8a45f-6c3b-4401-8e31-8d7637f36a82"));
    assert!(proof_html.contains("game_id: 3e3cccc1-c837-46d3-b0d6-1b83ae0cc82b"));
    assert!(proof_html.contains("manifest_version: 1"));
    assert!(proof_html.contains("retention_comparison.normalized_match: true"));
    assert!(proof_html.contains(
        "--compare-with target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json"
    ));
    assert!(proof_html.contains(
        "cargo run -q -p commands --bin export_operator_proof_status -- --fixture artifact-provenance --output target/operator-proof/current-status-audit-check.json 00000000-0000-0000-0000-000000000000"
    ));
    assert!(proof_html.contains(
        "cargo run -q -p commands --bin audit_operator_proof_status -- --output target/operator-proof/current-status-audit-report.json crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json target/operator-proof/current-status-audit-check.json"
    ));
    assert!(proof_html.contains(
        "cargo run -q -p commands --bin audit_operator_proof_artifact_retention -- --output target/operator-proof/current-artifact-retention-report.json target/operator-proof/previous-artifact-go-no-go-report.json target/operator-proof/current-artifact-go-no-go-report.json"
    ));
    assert!(proof_html.contains(
        "cargo run -q -p commands --bin audit_projection_rebuild_artifact -- --output target/operator-proof/current-projection-rebuild-report.json 08d8a45f-6c3b-4401-8e31-8d7637f36a82"
    ));
    assert!(proof_html.contains(
        "cargo run -q -p commands --bin audit_resolution_diff_artifact -- --output target/operator-proof/current-resolution-diff-report.json 08d8a45f-6c3b-4401-8e31-8d7637f36a82"
    ));
    assert!(proof_html.contains(
        "cargo run -q -p commands --bin audit_trace_inspection_artifact -- --output target/operator-proof/current-trace-inspection-report.json 08d8a45f-6c3b-4401-8e31-8d7637f36a82"
    ));
    assert!(proof_html.contains(
        "cargo run -q -p commands --bin audit_large_action_graph_performance_artifact -- --output target/operator-proof/current-large-action-graph-performance-report.json"
    ));
    assert!(proof_html.contains(
        "cargo run -q -p commands --bin audit_determinism_fuzz_artifact -- --output target/operator-proof/current-determinism-fuzz-report.json"
    ));
    assert!(proof_html.contains(
        "cargo test -p commands --test pipeline generated_shrink_matrix_writes_compact_operator_report -- --nocapture"
    ));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs?principal_user_id=host_h&fixture=artifact-provenance"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let fixture_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(fixture_html.contains("trusted 12 / 12; non_trusted 0"));
    assert!(fixture_html.contains("trusted 0 / 5; non_trusted 5"));
    let missing_row = table_row_for(&fixture_html, "proof-run-missing-artifact-provenance-guard");
    assert!(missing_row.contains("target/operator-proof/missing-artifact-provenance-guard.json"));
    assert!(missing_row.contains("artifact not present locally"));
    assert!(!missing_row.contains("game_id:"));
    assert!(!missing_row.contains("manifest_version:"));
    assert!(!missing_row.contains("retention_comparison.normalized_match:"));

    let malformed_row = table_row_for(&fixture_html, "proof-run-malformed-artifact-metadata-guard");
    assert!(malformed_row.contains("target/operator-proof/malformed-artifact-metadata-guard.json"));
    assert!(malformed_row.contains("artifact metadata unreadable"));
    assert!(!malformed_row.contains("game_id:"));
    assert!(!malformed_row.contains("manifest_version:"));
    assert!(!malformed_row.contains("retention_comparison.normalized_match:"));

    let stale_row = table_row_for(&fixture_html, "proof-run-stale-artifact-provenance-guard");
    assert!(stale_row.contains("target/operator-proof/stale-artifact-provenance-guard.json"));
    assert!(stale_row.contains("artifact stale"));
    assert!(stale_row.contains("modified_at_unix_seconds:"));
    assert!(stale_row.contains("age_seconds:"));
    assert!(stale_row.contains("freshness_max_age_seconds: 86400"));
    assert!(!stale_row.contains("game_id:"));
    assert!(!stale_row.contains("manifest_version:"));
    assert!(!stale_row.contains("retention_comparison.normalized_match:"));

    let path_mismatch_row = table_row_for(
        &fixture_html,
        "proof-run-path-mismatch-artifact-provenance-guard",
    );
    assert!(path_mismatch_row
        .contains("target/operator-proof/path-mismatch-artifact-provenance-guard.json"));
    assert!(path_mismatch_row.contains("artifact path mismatch"));
    assert!(path_mismatch_row
        .contains("reported_path: target/operator-proof/wrong-artifact-provenance-guard.json"));
    assert!(!path_mismatch_row.contains("game_id:"));
    assert!(!path_mismatch_row.contains("manifest_version:"));
    assert!(!path_mismatch_row.contains("retention_comparison.normalized_match:"));

    let version_mismatch_row = table_row_for(
        &fixture_html,
        "proof-run-version-mismatch-artifact-provenance-guard",
    );
    assert!(version_mismatch_row
        .contains("target/operator-proof/version-mismatch-artifact-provenance-guard.json"));
    assert!(version_mismatch_row.contains("artifact manifest version incompatible"));
    assert!(version_mismatch_row.contains("artifact_version: 2"));
    assert!(version_mismatch_row.contains("expected_version: 1"));
    assert!(!version_mismatch_row.contains("game_id:"));
    assert!(!version_mismatch_row.contains("manifest_version:"));
    assert!(!version_mismatch_row.contains("retention_comparison.normalized_match:"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status?principal_user_id=host_h&fixture=artifact-provenance"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let status: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_proof_status_contract(&status);
    let no_server_status = serde_json::to_value(build_operator_proof_run_status(
        game,
        Some(OperatorProofRunFixture::ArtifactProvenance),
    ))
    .unwrap();
    assert_eq!(
        normalized_proof_status_for_compare(status.clone(), game),
        normalized_proof_status_for_compare(no_server_status, game),
        "HTTP proof-run status should match the no-server exporter model"
    );
    assert_eq!(status["contract_version"], 1);
    assert_eq!(status["game"], game.to_string());
    assert_eq!(status["manifest_version"], 1);
    assert_eq!(status["execution"], "local-only command copy");
    assert_eq!(status["summary"]["production"]["total_artifact_rows"], 12);
    assert_eq!(status["summary"]["production"]["trusted"], 12);
    assert_eq!(status["summary"]["production"]["non_trusted"], 0);
    assert_eq!(status["summary"]["production"]["input_mismatch"], 0);
    assert_eq!(status["summary"]["production"]["drifted"], 0);
    assert_eq!(status["summary"]["fixtures"]["total_artifact_rows"], 5);
    assert_eq!(status["summary"]["fixtures"]["trusted"], 0);
    assert_eq!(status["summary"]["fixtures"]["non_trusted"], 5);
    assert_eq!(status["summary"]["fixtures"]["stale"], 1);
    assert_eq!(status["summary"]["fixtures"]["missing"], 1);
    assert_eq!(status["summary"]["fixtures"]["malformed"], 1);
    assert_eq!(status["summary"]["fixtures"]["path_mismatch"], 1);
    assert_eq!(status["summary"]["fixtures"]["version_mismatch"], 1);
    assert_eq!(status["summary"]["fixtures"]["input_mismatch"], 0);
    assert_eq!(status["summary"]["fixtures"]["drifted"], 0);

    let trusted_row = proof_status_row(&status, "proof-run-checked-game-specific-audit-bundle");
    assert_eq!(
        trusted_row["artifact"]["path"],
        "target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json"
    );
    assert_eq!(trusted_row["artifact"]["state"], "trusted");
    assert_eq!(trusted_row["artifact"]["freshness_max_age_seconds"], 86400);
    assert!(
        trusted_row["artifact"]["modified_at_unix_seconds"]
            .as_u64()
            .unwrap()
            > 0
    );
    assert_eq!(
        trusted_row["artifact"]["trusted_metadata"]["game_id"],
        "08d8a45f-6c3b-4401-8e31-8d7637f36a82"
    );
    assert_eq!(
        trusted_row["artifact"]["trusted_metadata"]["manifest_version"],
        1
    );

    let retention_row =
        proof_status_row(&status, "proof-run-game-specific-audit-artifact-retention");
    assert_eq!(retention_row["artifact"]["state"], "trusted");
    assert_eq!(
        retention_row["artifact"]["trusted_metadata"]["retention_comparison_normalized_match"],
        true
    );

    let missing_status_row =
        proof_status_row(&status, "proof-run-missing-artifact-provenance-guard");
    assert_eq!(missing_status_row["artifact"]["state"], "missing");
    assert!(missing_status_row["artifact"]
        .get("trusted_metadata")
        .is_none());

    let malformed_status_row =
        proof_status_row(&status, "proof-run-malformed-artifact-metadata-guard");
    assert_eq!(malformed_status_row["artifact"]["state"], "malformed");
    assert!(malformed_status_row["artifact"]
        .get("trusted_metadata")
        .is_none());

    let stale_status_row = proof_status_row(&status, "proof-run-stale-artifact-provenance-guard");
    assert_eq!(stale_status_row["artifact"]["state"], "stale");
    assert_eq!(
        stale_status_row["artifact"]["freshness_max_age_seconds"],
        86400
    );
    assert!(
        stale_status_row["artifact"]["age_seconds"]
            .as_u64()
            .unwrap()
            > 86400
    );
    assert!(stale_status_row["artifact"]
        .get("trusted_metadata")
        .is_none());

    let path_mismatch_status_row =
        proof_status_row(&status, "proof-run-path-mismatch-artifact-provenance-guard");
    assert_eq!(
        path_mismatch_status_row["artifact"]["state"],
        "path_mismatch"
    );
    assert_eq!(
        path_mismatch_status_row["artifact"]["reported_path"],
        "target/operator-proof/wrong-artifact-provenance-guard.json"
    );
    assert!(path_mismatch_status_row["artifact"]
        .get("trusted_metadata")
        .is_none());

    let version_mismatch_status_row = proof_status_row(
        &status,
        "proof-run-version-mismatch-artifact-provenance-guard",
    );
    assert_eq!(
        version_mismatch_status_row["artifact"]["state"],
        "version_mismatch"
    );
    assert_eq!(
        version_mismatch_status_row["artifact"]["artifact_version"],
        2
    );
    assert_eq!(
        version_mismatch_status_row["artifact"]["expected_version"],
        1
    );
    assert!(version_mismatch_status_row["artifact"]
        .get("trusted_metadata")
        .is_none());

    let status_export_row = proof_status_row(&status, "proof-run-operator-proof-status-export");
    assert!(status_export_row["artifact"].is_null());
    assert!(status_export_row["command"].as_str().unwrap().contains(
        "cargo run -q -p commands --bin export_operator_proof_status -- --fixture artifact-provenance --output target/operator-proof/current-status-audit-check.json 00000000-0000-0000-0000-000000000000"
    ));
    let status_audit_row =
        proof_status_row(&status, "proof-run-operator-proof-status-snapshot-audit");
    assert_eq!(status_audit_row["artifact"]["state"], "trusted");
    assert_eq!(
        status_audit_row["artifact"]["path"],
        "target/operator-proof/current-status-audit-report.json"
    );
    assert_eq!(status_audit_row["artifact"]["artifact_version"], 1);
    assert_eq!(status_audit_row["artifact"]["expected_version"], 1);
    assert_eq!(
        status_audit_row["artifact"]["expected_path"],
        "crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json"
    );
    assert_eq!(
        status_audit_row["artifact"]["actual_path"],
        "target/operator-proof/current-status-audit-check.json"
    );
    assert_eq!(status_audit_row["artifact"]["diff_count"], 0);
    assert!(status_audit_row["command"].as_str().unwrap().contains(
        "cargo run -q -p commands --bin audit_operator_proof_status -- --output target/operator-proof/current-status-audit-report.json crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json target/operator-proof/current-status-audit-check.json"
    ));
    let go_no_go_status_row =
        proof_status_row(&status, "proof-run-operator-proof-artifact-go-no-go");
    assert_eq!(go_no_go_status_row["artifact"]["state"], "trusted");
    assert_eq!(
        go_no_go_status_row["artifact"]["path"],
        "target/operator-proof/current-artifact-go-no-go-report.json"
    );
    assert_eq!(go_no_go_status_row["artifact"]["artifact_version"], 1);
    assert_eq!(go_no_go_status_row["artifact"]["expected_version"], 1);
    assert_eq!(go_no_go_status_row["artifact"]["diff_count"], 0);
    assert!(go_no_go_status_row["command"].as_str().unwrap().contains(
        "cargo run -q -p commands --bin audit_operator_proof_artifacts -- --output target/operator-proof/current-artifact-go-no-go-report.json 00000000-0000-0000-0000-000000000000"
    ));
    let retention_status_row =
        proof_status_row(&status, "proof-run-operator-proof-artifact-retention");
    assert_eq!(retention_status_row["artifact"]["state"], "trusted");
    assert_eq!(
        retention_status_row["artifact"]["path"],
        "target/operator-proof/current-artifact-retention-report.json"
    );
    assert_eq!(
        retention_status_row["artifact"]["artifact_version"],
        PROOF_RUN_GO_NO_GO_RETENTION_REPORT_ARTIFACT_VERSION
    );
    assert_eq!(
        retention_status_row["artifact"]["expected_version"],
        PROOF_RUN_GO_NO_GO_RETENTION_REPORT_ARTIFACT_VERSION
    );
    assert_eq!(retention_status_row["artifact"]["diff_count"], 0);
    assert!(retention_status_row["command"].as_str().unwrap().contains(
        "cargo run -q -p commands --bin audit_operator_proof_artifact_retention -- --output target/operator-proof/current-artifact-retention-report.json target/operator-proof/previous-artifact-go-no-go-report.json target/operator-proof/current-artifact-go-no-go-report.json"
    ));
    let rebuild_status_row =
        proof_status_row(&status, "proof-run-operator-proof-projection-rebuild");
    assert_eq!(rebuild_status_row["artifact"]["state"], "trusted");
    assert_eq!(
        rebuild_status_row["artifact"]["path"],
        "target/operator-proof/current-projection-rebuild-report.json"
    );
    assert_eq!(
        rebuild_status_row["artifact"]["artifact_version"],
        PROJECTION_REBUILD_AUDIT_REPORT_ARTIFACT_VERSION
    );
    assert_eq!(
        rebuild_status_row["artifact"]["expected_version"],
        PROJECTION_REBUILD_AUDIT_REPORT_ARTIFACT_VERSION
    );
    assert_eq!(rebuild_status_row["artifact"]["diff_count"], 0);
    assert!(rebuild_status_row["command"].as_str().unwrap().contains(
        "cargo run -q -p commands --bin audit_projection_rebuild_artifact -- --output target/operator-proof/current-projection-rebuild-report.json 08d8a45f-6c3b-4401-8e31-8d7637f36a82"
    ));
    let resolution_diff_status_row =
        proof_status_row(&status, "proof-run-operator-proof-resolution-diff");
    assert_eq!(resolution_diff_status_row["artifact"]["state"], "trusted");
    assert_eq!(
        resolution_diff_status_row["artifact"]["path"],
        "target/operator-proof/current-resolution-diff-report.json"
    );
    assert_eq!(
        resolution_diff_status_row["artifact"]["artifact_version"],
        RESOLUTION_DIFF_REPORT_ARTIFACT_VERSION
    );
    assert_eq!(
        resolution_diff_status_row["artifact"]["expected_version"],
        RESOLUTION_DIFF_REPORT_ARTIFACT_VERSION
    );
    assert_eq!(resolution_diff_status_row["artifact"]["diff_count"], 0);
    assert!(resolution_diff_status_row["command"].as_str().unwrap().contains(
        "cargo run -q -p commands --bin audit_resolution_diff_artifact -- --output target/operator-proof/current-resolution-diff-report.json 08d8a45f-6c3b-4401-8e31-8d7637f36a82"
    ));
    let trace_inspection_status_row =
        proof_status_row(&status, "proof-run-operator-proof-trace-inspection");
    assert_eq!(trace_inspection_status_row["artifact"]["state"], "trusted");
    assert_eq!(
        trace_inspection_status_row["artifact"]["path"],
        "target/operator-proof/current-trace-inspection-report.json"
    );
    assert_eq!(
        trace_inspection_status_row["artifact"]["artifact_version"],
        TRACE_INSPECTION_REPORT_ARTIFACT_VERSION
    );
    assert_eq!(
        trace_inspection_status_row["artifact"]["expected_version"],
        TRACE_INSPECTION_REPORT_ARTIFACT_VERSION
    );
    assert_eq!(trace_inspection_status_row["artifact"]["diff_count"], 0);
    assert!(trace_inspection_status_row["command"].as_str().unwrap().contains(
        "cargo run -q -p commands --bin audit_trace_inspection_artifact -- --output target/operator-proof/current-trace-inspection-report.json 08d8a45f-6c3b-4401-8e31-8d7637f36a82"
    ));
    let performance_status_row = proof_status_row(
        &status,
        "proof-run-operator-proof-large-action-graph-performance",
    );
    assert_eq!(performance_status_row["artifact"]["state"], "trusted");
    assert_eq!(
        performance_status_row["artifact"]["path"],
        "target/operator-proof/current-large-action-graph-performance-report.json"
    );
    assert_eq!(
        performance_status_row["artifact"]["artifact_version"],
        LARGE_ACTION_GRAPH_PERFORMANCE_REPORT_ARTIFACT_VERSION
    );
    assert_eq!(
        performance_status_row["artifact"]["expected_version"],
        LARGE_ACTION_GRAPH_PERFORMANCE_REPORT_ARTIFACT_VERSION
    );
    assert_eq!(performance_status_row["artifact"]["diff_count"], 0);
    assert_eq!(
        performance_status_row["artifact"]["trusted_metadata"]["game_id"],
        "08d8a45f-6c3b-4401-8e31-8d7637f36a82"
    );
    assert_eq!(
        performance_status_row["artifact"]["trusted_metadata"]["resolve_elapsed_ms"],
        321
    );
    assert_eq!(
        performance_status_row["artifact"]["trusted_metadata"]["threshold_ms"],
        20000
    );
    assert_eq!(
        performance_status_row["artifact"]["trusted_metadata"]["trace_row_count"],
        74
    );
    assert_eq!(
        performance_status_row["artifact"]["trusted_metadata"]["phase_trace_anchored"],
        true
    );
    assert_eq!(
        performance_status_row["artifact"]["trusted_metadata"]["decision_trace_anchored"],
        true
    );
    assert!(performance_status_row["command"].as_str().unwrap().contains(
        "cargo run -q -p commands --bin audit_large_action_graph_performance_artifact -- --output target/operator-proof/current-large-action-graph-performance-report.json"
    ));
    let determinism_status_row =
        proof_status_row(&status, "proof-run-operator-proof-determinism-fuzz");
    assert_eq!(determinism_status_row["artifact"]["state"], "trusted");
    assert_eq!(
        determinism_status_row["artifact"]["path"],
        "target/operator-proof/current-determinism-fuzz-report.json"
    );
    assert_eq!(
        determinism_status_row["artifact"]["artifact_version"],
        DETERMINISM_FUZZ_REPORT_ARTIFACT_VERSION
    );
    assert_eq!(
        determinism_status_row["artifact"]["expected_version"],
        DETERMINISM_FUZZ_REPORT_ARTIFACT_VERSION
    );
    assert_eq!(determinism_status_row["artifact"]["diff_count"], 0);
    assert_eq!(
        determinism_status_row["artifact"]["trusted_metadata"]["family_count"],
        12
    );
    assert_eq!(
        determinism_status_row["artifact"]["trusted_metadata"]["seed_count"],
        57
    );
    assert_eq!(
        determinism_status_row["artifact"]["trusted_metadata"]["expected_family_count"],
        12
    );
    assert_eq!(
        determinism_status_row["artifact"]["trusted_metadata"]["expected_seed_count"],
        57
    );
    assert_eq!(
        determinism_status_row["artifact"]["trusted_metadata"]["family_manifest_matched"],
        true
    );
    assert!(determinism_status_row["command"].as_str().unwrap().contains(
        "cargo run -q -p commands --bin audit_determinism_fuzz_artifact -- --output target/operator-proof/current-determinism-fuzz-report.json"
    ));
    let generated_shrink_status_row =
        proof_status_row(&status, "proof-run-operator-proof-generated-shrink-matrix");
    assert_eq!(generated_shrink_status_row["artifact"]["state"], "trusted");
    assert_eq!(
        generated_shrink_status_row["artifact"]["path"],
        "target/operator-proof/current-generated-shrink-matrix-report.tmp.json"
    );
    assert_eq!(
        generated_shrink_status_row["artifact"]["artifact_version"],
        GENERATED_SHRINK_MATRIX_REPORT_ARTIFACT_VERSION
    );
    assert_eq!(
        generated_shrink_status_row["artifact"]["expected_version"],
        GENERATED_SHRINK_MATRIX_REPORT_ARTIFACT_VERSION
    );
    assert_eq!(generated_shrink_status_row["artifact"]["diff_count"], 0);
    assert_eq!(
        generated_shrink_status_row["artifact"]["trusted_metadata"]["family_count"],
        GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT
    );
    assert_eq!(
        generated_shrink_status_row["artifact"]["trusted_metadata"]["case_count"],
        GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT
    );
    assert_eq!(
        generated_shrink_status_row["artifact"]["trusted_metadata"]["expected_family_count"],
        GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT
    );
    assert_eq!(
        generated_shrink_status_row["artifact"]["trusted_metadata"]["expected_case_count"],
        GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT
    );
    assert_eq!(
        generated_shrink_status_row["artifact"]["trusted_metadata"]["family_manifest_matched"],
        true
    );
    assert!(generated_shrink_status_row["command"].as_str().unwrap().contains(
        "cargo test -p commands --test pipeline generated_shrink_matrix_writes_compact_operator_report"
    ));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status-audit?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let status_audit: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(status_audit["ok"], true);
    assert_eq!(status_audit["artifact"]["state"], "trusted");
    assert_eq!(
        status_audit["artifact"]["path"],
        "target/operator-proof/current-status-audit-report.json"
    );
    assert_eq!(status_audit["artifact"]["diff_count"], 0);
    assert_eq!(status_audit["diffs"].as_array().unwrap().len(), 0);
    assert_eq!(
        status_audit["expected_path"],
        "crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json"
    );
    assert_eq!(
        status_audit["actual_path"],
        "target/operator-proof/current-status-audit-check.json"
    );
    assert!(status_audit["normalized_fields"]
        .as_array()
        .unwrap()
        .iter()
        .any(|field| field == "$.game"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status-audit/view?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let status_audit_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(status_audit_html.contains("Operator Proof-Run Status Audit"));
    assert!(status_audit_html.contains("matched"));
    assert!(status_audit_html.contains("Report Artifact"));
    assert!(status_audit_html.contains("artifact_version: 1"));
    assert!(status_audit_html.contains("diff_count: 0"));
    assert!(status_audit_html.contains("No status audit drift."));
    assert!(status_audit_html.contains("$.families[*].runs[*].artifact.age_seconds"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status-audit?principal_user_id=host_h&fixture=artifact-state-drift"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let drift_audit: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(drift_audit["ok"], false);
    assert_eq!(drift_audit["artifact"]["state"], "drifted");
    assert_eq!(drift_audit["artifact"]["diff_count"], 1);
    assert!(drift_audit["diffs"].as_array().unwrap().iter().any(|diff| {
        diff["path"] == "$.rows[\"checked-game-specific-audit-bundle\"].artifact.state"
            && diff["expected"] == "trusted"
            && diff["actual"] == "missing"
    }));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status-audit/view?principal_user_id=host_h&fixture=artifact-state-drift"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let drift_audit_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(drift_audit_html.contains("drifted"));
    assert!(drift_audit_html.contains("artifact drifted"));
    assert!(drift_audit_html.contains("diff_count: 1"));
    assert!(drift_audit_html
        .contains("$.rows[&quot;checked-game-specific-audit-bundle&quot;].artifact.state"));
    assert!(drift_audit_html.contains("&quot;trusted&quot;"));
    assert!(drift_audit_html.contains("&quot;missing&quot;"));

    for (fixture, state, marker) in [
        (
            "saved-report-malformed",
            "malformed",
            "artifact metadata unreadable",
        ),
        ("saved-report-stale", "stale", "artifact stale"),
        ("saved-report-drifted", "drifted", "artifact drifted"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/status-audit?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_audit: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(fixture_audit["artifact"]["state"], state);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/status-audit/view?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_html = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(fixture_html.contains(marker));
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/go-no-go?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let go_no_go: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(go_no_go["ok"], true);
    assert_eq!(
        go_no_go["artifact_path"],
        "target/operator-proof/current-artifact-go-no-go-report.json"
    );
    assert_eq!(go_no_go["production"]["trusted"], 12);
    assert_eq!(go_no_go["production"]["non_trusted"], 0);
    assert!(go_no_go["rows"].as_array().unwrap().iter().any(|row| {
        row["row_id"] == "proof-run-operator-proof-artifact-go-no-go"
            && row["state"] == "trusted"
            && row["command"]
                .as_str()
                .unwrap()
                .contains("audit_operator_proof_artifacts")
    }));
    assert!(go_no_go["rows"].as_array().unwrap().iter().any(|row| {
        row["row_id"] == "proof-run-operator-proof-artifact-retention"
            && row["state"] == "trusted"
            && row["command"]
                .as_str()
                .unwrap()
                .contains("audit_operator_proof_artifact_retention")
    }));
    assert!(go_no_go["rows"].as_array().unwrap().iter().any(|row| {
        row["row_id"] == "proof-run-operator-proof-projection-rebuild"
            && row["state"] == "trusted"
            && row["command"]
                .as_str()
                .unwrap()
                .contains("audit_projection_rebuild_artifact")
    }));
    assert!(go_no_go["rows"].as_array().unwrap().iter().any(|row| {
        row["row_id"] == "proof-run-operator-proof-resolution-diff"
            && row["state"] == "trusted"
            && row["command"]
                .as_str()
                .unwrap()
                .contains("audit_resolution_diff_artifact")
    }));
    assert!(go_no_go["rows"].as_array().unwrap().iter().any(|row| {
        row["row_id"] == "proof-run-operator-proof-trace-inspection"
            && row["state"] == "trusted"
            && row["command"]
                .as_str()
                .unwrap()
                .contains("audit_trace_inspection_artifact")
    }));
    assert!(go_no_go["rows"].as_array().unwrap().iter().any(|row| {
        row["row_id"] == "proof-run-operator-proof-large-action-graph-performance"
            && row["state"] == "trusted"
            && row["command"]
                .as_str()
                .unwrap()
                .contains("audit_large_action_graph_performance_artifact")
    }));
    assert!(go_no_go["rows"].as_array().unwrap().iter().any(|row| {
        row["row_id"] == "proof-run-operator-proof-determinism-fuzz"
            && row["state"] == "trusted"
            && row["command"]
                .as_str()
                .unwrap()
                .contains("audit_determinism_fuzz_artifact")
    }));
    assert!(go_no_go["rows"].as_array().unwrap().iter().any(|row| {
        row["row_id"] == "proof-run-operator-proof-generated-shrink-matrix"
            && row["state"] == "trusted"
            && row["command"]
                .as_str()
                .unwrap()
                .contains("generated_shrink_matrix_writes_compact_operator_report")
    }));
    let go_no_go_performance_row = proof_go_no_go_row(
        &go_no_go,
        "proof-run-operator-proof-large-action-graph-performance",
    );
    assert_eq!(
        go_no_go_performance_row["trusted_metadata"]["game_id"],
        "08d8a45f-6c3b-4401-8e31-8d7637f36a82"
    );
    assert_eq!(
        go_no_go_performance_row["trusted_metadata"]["resolve_elapsed_ms"],
        321
    );
    assert_eq!(
        go_no_go_performance_row["trusted_metadata"]["threshold_ms"],
        20000
    );
    assert_eq!(
        go_no_go_performance_row["trusted_metadata"]["trace_row_count"],
        74
    );
    assert_eq!(
        go_no_go_performance_row["trusted_metadata"]["phase_trace_anchored"],
        true
    );
    assert_eq!(
        go_no_go_performance_row["trusted_metadata"]["decision_trace_anchored"],
        true
    );
    let go_no_go_determinism_row =
        proof_go_no_go_row(&go_no_go, "proof-run-operator-proof-determinism-fuzz");
    assert_eq!(
        go_no_go_determinism_row["trusted_metadata"]["family_count"],
        12
    );
    assert_eq!(
        go_no_go_determinism_row["trusted_metadata"]["seed_count"],
        57
    );
    assert_eq!(
        go_no_go_determinism_row["trusted_metadata"]["expected_family_count"],
        12
    );
    assert_eq!(
        go_no_go_determinism_row["trusted_metadata"]["expected_seed_count"],
        57
    );
    assert_eq!(
        go_no_go_determinism_row["trusted_metadata"]["family_manifest_matched"],
        true
    );
    let go_no_go_generated_shrink_row = proof_go_no_go_row(
        &go_no_go,
        "proof-run-operator-proof-generated-shrink-matrix",
    );
    assert_eq!(
        go_no_go_generated_shrink_row["trusted_metadata"]["family_count"],
        GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT
    );
    assert_eq!(
        go_no_go_generated_shrink_row["trusted_metadata"]["case_count"],
        GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT
    );
    assert_eq!(
        go_no_go_generated_shrink_row["trusted_metadata"]["expected_family_count"],
        GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT
    );
    assert_eq!(
        go_no_go_generated_shrink_row["trusted_metadata"]["expected_case_count"],
        GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT
    );
    assert_eq!(
        go_no_go_generated_shrink_row["trusted_metadata"]["family_manifest_matched"],
        true
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/go-no-go/view?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let go_no_go_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(go_no_go_html.contains("Operator Proof Artifact Go/No-Go"));
    assert!(go_no_go_html.contains("go"));
    assert!(go_no_go_html.contains("trusted 12 / 12; non_trusted 0"));
    assert!(go_no_go_html.contains("proof-run-operator-proof-artifact-go-no-go"));
    assert!(go_no_go_html.contains("proof-run-operator-proof-artifact-retention"));
    assert!(go_no_go_html.contains("proof-run-operator-proof-projection-rebuild"));
    assert!(go_no_go_html.contains("proof-run-operator-proof-resolution-diff"));
    assert!(go_no_go_html.contains("proof-run-operator-proof-trace-inspection"));
    assert!(go_no_go_html.contains("proof-run-operator-proof-large-action-graph-performance"));
    assert!(go_no_go_html.contains("proof-run-operator-proof-determinism-fuzz"));
    assert!(go_no_go_html.contains("proof-run-operator-proof-generated-shrink-matrix"));
    assert!(go_no_go_html.contains("audit_operator_proof_artifacts"));
    let performance_go_no_go_html = table_row_for(
        &go_no_go_html,
        "proof-run-operator-proof-large-action-graph-performance",
    );
    assert!(performance_go_no_go_html.contains("resolve_elapsed_ms: 321"));
    assert!(performance_go_no_go_html.contains("threshold_ms: 20000"));
    assert!(performance_go_no_go_html.contains("trace_row_count: 74"));
    assert!(performance_go_no_go_html.contains("phase_trace_anchored: true"));
    assert!(performance_go_no_go_html.contains("decision_trace_anchored: true"));
    let determinism_go_no_go_html =
        table_row_for(&go_no_go_html, "proof-run-operator-proof-determinism-fuzz");
    assert!(determinism_go_no_go_html.contains("family_count: 12"));
    assert!(determinism_go_no_go_html.contains("seed_count: 57"));
    assert!(determinism_go_no_go_html.contains("expected_family_count: 12"));
    assert!(determinism_go_no_go_html.contains("expected_seed_count: 57"));
    assert!(determinism_go_no_go_html.contains("family_manifest_matched: true"));
    let generated_shrink_go_no_go_html = table_row_for(
        &go_no_go_html,
        "proof-run-operator-proof-generated-shrink-matrix",
    );
    assert!(generated_shrink_go_no_go_html.contains("family_count: 26"));
    assert!(generated_shrink_go_no_go_html.contains("case_count: 52"));
    assert!(generated_shrink_go_no_go_html.contains("expected_family_count: 26"));
    assert!(generated_shrink_go_no_go_html.contains("expected_case_count: 52"));
    assert!(generated_shrink_go_no_go_html.contains("family_manifest_matched: true"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/retention?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let retention: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(retention["ok"], true);
    assert_eq!(
        retention["artifact_path"],
        "target/operator-proof/current-artifact-retention-report.json"
    );
    assert_eq!(
        retention["previous_path"],
        "target/operator-proof/previous-artifact-go-no-go-report.json"
    );
    assert_eq!(
        retention["latest_path"],
        "target/operator-proof/current-artifact-go-no-go-report.json"
    );
    assert_eq!(retention["regressions"].as_array().unwrap().len(), 0);
    assert_eq!(retention["recoveries"].as_array().unwrap().len(), 0);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/retention/view?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let retention_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(retention_html.contains("Operator Proof Artifact Retention"));
    assert!(retention_html.contains("matched"));
    assert!(retention_html.contains("target/operator-proof/current-artifact-retention-report.json"));
    assert!(retention_html.contains("target/operator-proof/previous-artifact-go-no-go-report.json"));
    assert!(retention_html.contains("target/operator-proof/current-artifact-go-no-go-report.json"));

    for (fixture, expected_ok, marker) in [
        ("newly-missing-artifact", false, "missing"),
        ("stale-previously-trusted", false, "stale"),
        ("recovered-artifact", true, "trusted"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/retention?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_report: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(fixture_report["ok"], expected_ok);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/retention/view?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_html = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(fixture_html.contains("Operator Proof Artifact Retention"));
        assert!(fixture_html.contains(fixture));
        assert!(fixture_html.contains(marker));
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/projection-rebuild?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let rebuild: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(rebuild["ok"], true);
    assert_eq!(rebuild["artifact_state"], "trusted");
    assert_eq!(
        rebuild["artifact_path"],
        "target/operator-proof/current-projection-rebuild-report.json"
    );
    assert_eq!(rebuild["isolation"], "rollback-only transaction");
    assert_eq!(rebuild["table_count"], 13);
    assert_eq!(rebuild["drifted_table_count"], 0);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/projection-rebuild/view?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let rebuild_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(rebuild_html.contains("Operator Projection Rebuild Report"));
    assert!(rebuild_html.contains("matched"));
    assert!(rebuild_html.contains("target/operator-proof/current-projection-rebuild-report.json"));
    assert!(rebuild_html.contains("rollback-only transaction"));
    assert!(rebuild_html.contains("slot_state"));

    for (fixture, expected_ok, artifact_state, marker) in [
        ("missing-report", false, "missing", "No table rows."),
        ("stale-report", true, "stale", "stale-report"),
        ("drifted-report", false, "drifted", "slot_state"),
        ("recovered-report", true, "trusted", "recovered-report"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/projection-rebuild?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_report: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(fixture_report["ok"], expected_ok);
        assert_eq!(fixture_report["artifact_state"], artifact_state);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/projection-rebuild/view?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_html = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(fixture_html.contains("Operator Projection Rebuild Report"));
        assert!(fixture_html.contains(fixture));
        assert!(fixture_html.contains(artifact_state));
        assert!(fixture_html.contains(marker));
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/resolution-diff?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let resolution_diff: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(resolution_diff["ok"], true);
    assert_eq!(resolution_diff["artifact_state"], "trusted");
    assert_eq!(
        resolution_diff["artifact_path"],
        "target/operator-proof/current-resolution-diff-report.json"
    );
    assert_eq!(resolution_diff["audited_phase_count"], 1);
    assert_eq!(resolution_diff["diff_count"], 0);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/resolution-diff/view?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let resolution_diff_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(resolution_diff_html.contains("Operator Resolution Diff Report"));
    assert!(resolution_diff_html.contains("matched"));
    assert!(
        resolution_diff_html.contains("target/operator-proof/current-resolution-diff-report.json")
    );
    assert!(resolution_diff_html.contains("resolution:N01"));

    for (fixture, expected_ok, artifact_state, marker) in [
        ("missing-report", false, "missing", "No phase rows."),
        ("stale-report", true, "stale", "stale-report"),
        ("drifted-report", false, "drifted", "$.winner"),
        ("matched-report", true, "trusted", "matched-report"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/resolution-diff?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_report: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(fixture_report["ok"], expected_ok);
        assert_eq!(fixture_report["artifact_state"], artifact_state);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/resolution-diff/view?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_html = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(fixture_html.contains("Operator Resolution Diff Report"));
        assert!(fixture_html.contains(fixture));
        assert!(fixture_html.contains(artifact_state));
        assert!(fixture_html.contains(marker));
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/trace-inspection?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let trace_inspection: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(trace_inspection["ok"], true);
    assert_eq!(trace_inspection["artifact_state"], "trusted");
    assert_eq!(
        trace_inspection["artifact_path"],
        "target/operator-proof/current-trace-inspection-report.json"
    );
    assert_eq!(trace_inspection["trace_count"], 1);
    assert_eq!(trace_inspection["decision_count"], 1);
    assert_eq!(trace_inspection["edge_count"], 1);
    assert_eq!(trace_inspection["generated_count"], 1);
    assert_eq!(trace_inspection["effect_change_count"], 1);
    assert_eq!(trace_inspection["note_count"], 1);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let trace_inspection_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(trace_inspection_html.contains("Operator Trace Inspection Report"));
    assert!(trace_inspection_html.contains("available"));
    assert!(trace_inspection_html
        .contains("target/operator-proof/current-trace-inspection-report.json"));
    assert!(trace_inspection_html.contains("resolution:N01"));
    assert!(trace_inspection_html.contains("fixture trace"));

    for (fixture, expected_ok, artifact_state, marker) in [
        ("missing-report", false, "missing", "No trace rows."),
        ("stale-report", true, "stale", "stale-report"),
        ("malformed-report", false, "malformed", "malformed-report"),
        ("filtered-run", true, "trusted", "filtered:run"),
        ("empty-trace", false, "drifted", "No trace rows."),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/trace-inspection?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_report: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(fixture_report["ok"], expected_ok);
        assert_eq!(fixture_report["artifact_state"], artifact_state);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_html = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(fixture_html.contains("Operator Trace Inspection Report"));
        assert!(fixture_html.contains(fixture));
        assert!(fixture_html.contains(artifact_state));
        assert!(fixture_html.contains(marker));
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/large-action-graph-performance?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let performance: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(performance["ok"], true);
    assert_eq!(performance["artifact_state"], "trusted");
    assert_eq!(
        performance["artifact_path"],
        "target/operator-proof/current-large-action-graph-performance-report.json"
    );
    assert_eq!(performance["pack"], "mafiascum");
    assert_eq!(performance["roster_count"], 40);
    assert_eq!(performance["submitted_action_count"], 29);
    assert_eq!(performance["replay_audit_ok"], true);
    assert_eq!(performance["projection_rebuild_ok"], true);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/large-action-graph-performance/view?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let performance_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(performance_html.contains("Operator Large Action Graph Performance Report"));
    assert!(performance_html.contains("within ceiling"));
    assert!(performance_html
        .contains("target/operator-proof/current-large-action-graph-performance-report.json"));
    assert!(performance_html.contains("Roster slots"));
    assert!(performance_html.contains("Projection rebuild"));

    for (fixture, expected_ok, artifact_state, marker) in [
        ("missing-report", false, "missing", "Roster slots"),
        ("stale-report", true, "stale", "stale-report"),
        ("threshold-regressed", false, "drifted", "regressed"),
        ("recovered-report", true, "trusted", "recovered-report"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/large-action-graph-performance?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_report: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(fixture_report["ok"], expected_ok);
        assert_eq!(fixture_report["artifact_state"], artifact_state);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/large-action-graph-performance/view?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_html = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(fixture_html.contains("Operator Large Action Graph Performance Report"));
        assert!(fixture_html.contains(fixture));
        assert!(fixture_html.contains(artifact_state));
        assert!(fixture_html.contains(marker));
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/determinism-fuzz?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let determinism: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(determinism["ok"], true);
    assert_eq!(determinism["artifact_state"], "trusted");
    assert_eq!(
        determinism["artifact_path"],
        "target/operator-proof/current-determinism-fuzz-report.json"
    );
    assert_eq!(determinism["family_count"], 12);
    assert_eq!(determinism["seed_count"], 57);
    assert_eq!(
        determinism["families"][0]["selector"],
        "seeded_day_vote_scenarios_replay_audit_and_rebuild_deterministically"
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/determinism-fuzz/view?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let determinism_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(determinism_html.contains("Operator Determinism Fuzz Report"));
    assert!(determinism_html.contains("passed"));
    assert!(determinism_html.contains("target/operator-proof/current-determinism-fuzz-report.json"));
    assert!(determinism_html
        .contains("generated_default_open_day_replay_audit_and_rebuild_deterministically"));

    for (fixture, expected_ok, artifact_state, marker) in [
        ("missing-report", false, "missing", "No seed family rows."),
        ("stale-report", true, "stale", "stale-report"),
        ("failed-seed", false, "drifted", "First Failing Seed"),
        ("recovered-report", true, "trusted", "recovered-report"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/determinism-fuzz?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_report: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(fixture_report["ok"], expected_ok);
        assert_eq!(fixture_report["artifact_state"], artifact_state);
        if fixture == "failed-seed" {
            assert_eq!(fixture_report["first_failing_seed"], 7101);
        }

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/determinism-fuzz/view?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_html = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(fixture_html.contains("Operator Determinism Fuzz Report"));
        assert!(fixture_html.contains(fixture));
        assert!(fixture_html.contains(artifact_state));
        assert!(fixture_html.contains(marker));
    }

    for (fixture, state) in [
        ("missing-production-artifact", "missing"),
        ("stale-production-artifact", "stale"),
        ("drifted-production-artifact", "drifted"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/go-no-go?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_report: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(fixture_report["ok"], false);
        assert_eq!(fixture_report["production"]["non_trusted"], 1);
        assert!(fixture_report["rows"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["state"] == state && row["fixture"] == false));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!(
                        "/games/{game}/operator/proof-runs/go-no-go/view?principal_user_id=host_h&fixture={fixture}"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let fixture_html = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(fixture_html.contains("no-go"));
        assert!(fixture_html.contains(state));
        assert!(fixture_html.contains("non_trusted 1"));
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/operator?principal_user_id=cohost_c"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let cohost_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(cohost_html.contains("Operator Index"));
    assert!(cohost_html.contains("principal_user_id=cohost_c"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs?principal_user_id=cohost_c"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let cohost_proof_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(cohost_proof_html.contains("Operator Proof-Run Index"));
    assert!(cohost_proof_html.contains("cohost_c"));
    assert!(cohost_proof_html.contains("server page does not execute background jobs"));
    assert!(cohost_proof_html
        .contains("target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json"));
    assert!(cohost_proof_html
        .contains("target/operator-proof/game-specific-audit-bundle-20260613T001500Z.json"));
    assert!(cohost_proof_html.contains("game_id: 08d8a45f-6c3b-4401-8e31-8d7637f36a82"));
    assert!(cohost_proof_html.contains("retention_comparison.normalized_match: true"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/operator?principal_user_id=outsider"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/status?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/operator/proof-runs/go-no-go?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    for path in [
        format!("/games/{game}/operator/proof-runs/projection-rebuild?principal_user_id=outsider"),
        format!("/games/{game}/operator/proof-runs/trace-inspection?principal_user_id=outsider"),
        format!("/games/{game}/operator/proof-runs/large-action-graph-performance?principal_user_id=outsider"),
        format!("/games/{game}/operator/proof-runs/determinism-fuzz?principal_user_id=outsider"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(reject.error, RejectCode::NotAuthorized);
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_thread_cold_load_returns_paginated_posts(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            3,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: "user_a".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            4,
            "host_h",
            Command::AssignRole {
                game,
                slot: "slot_1".into(),
                role_key: "vanilla_townie".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            5,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );

    for (id, body) in [(6, "one"), (7, "two"), (8, "three")] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                "user_a",
                Command::SubmitPost {
                    game,
                    actor_slot: "slot_1".into(),
                    body: body.into(),
                },
            )
            .await,
        );
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/thread?limit=2"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let page: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        page.posts
            .iter()
            .map(|post| post.body.as_str())
            .collect::<Vec<_>>(),
        vec!["two", "three"]
    );
    assert_eq!(page.posts[0].author_slot.as_deref(), Some("slot_1"));
    let before = page.next_before_seq.expect("older page cursor");

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/games/{game}/thread?before_seq={before}&limit=2"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let older: ThreadPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(older.posts.len(), 1);
    assert_eq!(older.posts[0].body, "one");
    assert_eq!(older.next_before_seq, None);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn duplicate_command_id_returns_original_ack_without_duplicate_post(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::AddSlot {
                game,
                slot: "slot_1".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            3,
            "host_h",
            Command::AssignSlot {
                game,
                slot: "slot_1".into(),
                user: "user_a".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            4,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );

    let command_id = Uuid::new_v4();
    let command = Command::SubmitPost {
        game,
        actor_slot: "slot_1".into(),
        body: "commit happened; ack vanished".into(),
    };

    let first_ack = expect_ack(
        post_command_with_command_id(app.clone(), 5, command_id, "user_a", command.clone()).await,
    );
    let retry_ack =
        expect_ack(post_command_with_command_id(app, 6, command_id, "user_a", command).await);
    assert_eq!(retry_ack, first_ack);

    let post_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(post_count, 1, "retry must not append a duplicate post");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_notifications_are_capability_filtered(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "chinese_structured".into(),
            },
        )
        .await,
    );
    for (id, slot, user, role) in [
        (2, "slot_1", "user_1", "cupid"),
        (5, "slot_2", "user_2", "villager"),
        (8, "slot_3", "user_3", "prophet"),
        (11, "slot_4", "user_4", "wolf"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            20,
            "host_h",
            Command::StartGame {
                game,
                phase: "N01".into(),
            },
        )
        .await,
    );

    expect_ack(
        post_command(
            app.clone(),
            21,
            "user_1",
            Command::SubmitAction {
                game,
                action_id: "link_lovers_n01".into(),
                actor_slot: "slot_1".into(),
                template_id: "link_lovers".into(),
                targets: vec!["slot_2".into(), "slot_3".into()],
                grant_id: None,
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            22,
            "host_h",
            Command::ResolvePhase { game, seed: 930601 },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/notifications?principal_user_id=user_2"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_two: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_two.len(), 1);
    assert_eq!(user_two[0].audience_slot, "slot_2");
    assert_eq!(user_two[0].effect, "lovers_link");
    assert_eq!(user_two[0].status, "link_lovers_n01");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/notifications?principal_user_id=user_4"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_four: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert!(
        user_four.is_empty(),
        "unaddressed occupants see no private notice"
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/notifications?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let host: Vec<PlayerNotification> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(host.len(), 2);
    assert!(host.iter().any(|notice| notice.audience_slot == "slot_2"));
    assert!(host.iter().any(|notice| notice.audience_slot == "slot_3"));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/notifications?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_investigation_results_are_capability_filtered(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    for (id, slot, user, role) in [
        (2, "slot_1", "user_1", "cop"),
        (5, "slot_2", "user_2", "framer"),
        (8, "slot_3", "user_3", "vanilla_townie"),
        (11, "slot_4", "user_4", "godfather"),
        (14, "slot_5", "user_5", "miller"),
        (17, "slot_6", "user_6", "cop"),
        (20, "slot_7", "user_7", "cop"),
        (23, "slot_8", "user_8", "vanilla_townie"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            30,
            "host_h",
            Command::StartGame {
                game,
                phase: "N01".into(),
            },
        )
        .await,
    );

    for (id, user, actor_slot, action_id, template_id, target) in [
        (31, "user_2", "slot_2", "frame_n01", "frame", "slot_3"),
        (
            32,
            "user_1",
            "slot_1",
            "cop_godfather_n01",
            "cop_investigate",
            "slot_4",
        ),
        (
            33,
            "user_6",
            "slot_6",
            "cop_miller_n01",
            "cop_investigate",
            "slot_5",
        ),
        (
            34,
            "user_7",
            "slot_7",
            "cop_framed_n01",
            "cop_investigate",
            "slot_3",
        ),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                user,
                Command::SubmitAction {
                    game,
                    action_id: action_id.into(),
                    actor_slot: actor_slot.into(),
                    template_id: template_id.into(),
                    targets: vec![target.into()],
                    grant_id: None,
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            40,
            "host_h",
            Command::ResolvePhase { game, seed: 930801 },
        )
        .await,
    );
    projections::rebuild(&pool, game)
        .await
        .expect("investigation-result projection rebuild");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=user_1"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_one: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_one.len(), 1);
    assert_eq!(user_one[0].audience_slot, "slot_1");
    assert_eq!(user_one[0].mode, "Parity");
    assert_eq!(user_one[0].target_slot, "slot_4");
    assert_eq!(user_one[0].result, serde_json::json!("town"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=user_6"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_six: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_six.len(), 1);
    assert_eq!(user_six[0].audience_slot, "slot_6");
    assert_eq!(user_six[0].target_slot, "slot_5");
    assert_eq!(user_six[0].result, serde_json::json!("scum"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=user_7"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_seven: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(user_seven.len(), 1);
    assert_eq!(user_seven[0].audience_slot, "slot_7");
    assert_eq!(user_seven[0].target_slot, "slot_3");
    assert_eq!(user_seven[0].result, serde_json::json!("scum"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=user_8"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let user_eight: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert!(
        user_eight.is_empty(),
        "unaddressed occupants see no private investigation results"
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let host: Vec<PlayerInvestigationResult> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(host.len(), 3);
    assert!(host.iter().any(|result| result.audience_slot == "slot_1"
        && result.target_slot == "slot_4"
        && result.result == serde_json::json!("town")));
    assert!(host.iter().any(|result| result.audience_slot == "slot_6"
        && result.target_slot == "slot_5"
        && result.result == serde_json::json!("scum")));
    assert!(host.iter().any(|result| result.audience_slot == "slot_7"
        && result.target_slot == "slot_3"
        && result.result == serde_json::json!("scum")));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/investigation-results?principal_user_id=outsider"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_host_phase_controls_are_host_audit_only(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::AddCohost {
                game,
                user: "cohost_c".into(),
            },
        )
        .await,
    );
    for (idx, slot, user, role) in [
        ("1", "slot_1", "user_1", "beloved_princess"),
        ("2", "slot_2", "user_2", "vanilla_townie"),
        ("3", "slot_3", "user_3", "vanilla_townie"),
        ("4", "slot_4", "user_4", "mafia_goon"),
        ("5", "slot_5", "user_5", "mafia_goon"),
        ("6", "slot_6", "user_6", "vanilla_townie"),
    ] {
        let base = idx.parse::<u64>().unwrap() * 10;
        expect_ack(
            post_command(
                app.clone(),
                base,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                base + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                base + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            80,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );

    for (id, user, actor_slot) in [
        (81, "user_2", "slot_2"),
        (82, "user_3", "slot_3"),
        (83, "user_4", "slot_4"),
        (84, "user_5", "slot_5"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                user,
                Command::SubmitVote {
                    game,
                    actor_slot: actor_slot.into(),
                    target: VoteTarget::Slot("slot_1".into()),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            90,
            "host_h",
            Command::ResolvePhase { game, seed: 7421 },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            91,
            "host_h",
            Command::ResolveHostPrompt {
                game,
                prompt_id: "D01:skip_next_day:slot_1".into(),
                decision: HostPromptDecision::Acknowledge,
            },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/host-phase-controls?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let controls: Vec<HostPhaseControl> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(controls.len(), 1);
    assert_eq!(controls[0].prompt_id, "D01:skip_next_day:slot_1");
    assert_eq!(controls[0].prompt_kind.as_deref(), Some("skip_next_day"));
    assert_eq!(
        controls[0].prompt_reason.as_deref(),
        Some("beloved_princess_lynched")
    );
    assert_eq!(controls[0].source_phase_id, "D01");
    assert_eq!(controls[0].target_phase_id, "N02");
    assert_eq!(controls[0].skipped_phase_id.as_deref(), Some("D02"));
    assert_eq!(controls[0].resolved_by.as_deref(), Some("host_h"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/host-phase-controls/view?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(html.contains("Host Phase-Control Audit"));
    assert!(html.contains("D01:skip_next_day:slot_1"));
    assert!(html.contains("skip_next_day"));
    assert!(html.contains("beloved_princess_lynched"));
    assert!(html.contains("D01"));
    assert!(html.contains("N02"));
    assert!(html.contains("D02"));
    assert!(html.contains("host_h"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/host-phase-controls/view?principal_user_id=cohost_c"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let cohost_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(cohost_html.contains("D01:skip_next_day:slot_1"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/host-phase-controls?principal_user_id=user_2"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/host-phase-controls/view?principal_user_id=user_2"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_resolution_traces_are_host_audit_only(pool: sqlx::PgPool) {
    let app = router(pool);
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::AddCohost {
                game,
                user: "cohost_c".into(),
            },
        )
        .await,
    );
    for (id, slot, user, role) in [
        (10, "slot_1", "user_1", "vanilla_townie"),
        (20, "slot_2", "user_2", "vanilla_townie"),
        (30, "slot_3", "user_3", "mafia_goon"),
        (40, "slot_4", "user_4", "vanilla_townie"),
        (50, "slot_5", "user_5", "bus_driver"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            60,
            "host_h",
            Command::StartGame {
                game,
                phase: "N01".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            61,
            "user_5",
            Command::SubmitAction {
                game,
                action_id: "bus_swap_n01".into(),
                actor_slot: "slot_5".into(),
                template_id: "bus_driver_swap".into(),
                targets: vec!["slot_1".into(), "slot_2".into()],
                grant_id: None,
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            62,
            "user_3",
            Command::SubmitAction {
                game,
                action_id: "mafia_kill_n01".into(),
                actor_slot: "slot_3".into(),
                template_id: "factional_kill".into(),
                targets: vec!["slot_1".into()],
                grant_id: None,
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            63,
            "host_h",
            Command::ResolvePhase { game, seed: 7305 },
        )
        .await,
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-traces?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let report: ResolutionTraceInspectionReport = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(report.game, game);
    assert_eq!(report.traces.len(), 1);
    let run = &report.traces[0];
    assert_eq!(run.phase_id, "N01");
    assert!(run.applied_stream_seq.is_some());
    assert!(run.trace_stream_seq > run.applied_stream_seq.unwrap());
    assert!(run
        .decisions
        .iter()
        .any(|decision| decision.outcome == "player_killed"
            && decision.applied_stream_seq == run.applied_stream_seq
            && decision.event_index == Some(0)));
    let edge = run
        .edges
        .iter()
        .find(|edge| edge.kind == "redirect")
        .expect("redirect edge should be visible in JSON trace report");
    assert_eq!(edge.from, "mafia_kill_n01:target:0:slot_1");
    assert_eq!(edge.to, "mafia_kill_n01:target:0:slot_2");
    assert_eq!(edge.detail["action_id"], "mafia_kill_n01");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-traces?principal_user_id=host_h&run_id={}",
                    run.run_id
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let filtered: ResolutionTraceInspectionReport = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(filtered.traces.len(), 1);
    assert_eq!(filtered.traces[0].run_id, run.run_id);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-traces?principal_user_id=cohost_c&run_id={}",
                    run.run_id
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let cohost_json: ResolutionTraceInspectionReport = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(cohost_json.traces.len(), 1);
    assert_eq!(cohost_json.traces[0].run_id, run.run_id);
    assert!(cohost_json.traces[0]
        .edges
        .iter()
        .any(|edge| edge.kind == "redirect"
            && edge.from == "mafia_kill_n01:target:0:slot_1"
            && edge.to == "mafia_kill_n01:target:0:slot_2"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-traces/view?principal_user_id=host_h&run_id={}",
                    run.run_id
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(html.contains("Resolution Trace Inspection"));
    assert!(html.contains(&run.run_id));
    assert!(html.contains("player_killed"));
    assert!(html.contains("Redirect Edges"));
    assert!(html.contains("mafia_kill_n01:target:0:slot_1"));
    assert!(html.contains("mafia_kill_n01:target:0:slot_2"));
    assert!(html.contains("Generated Actions"));
    assert!(html.contains("Effect Changes"));
    assert!(html.contains("Visibility"));
    let run_anchor: String = run
        .run_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    for section in [
        "decisions",
        "redirect-edges",
        "generated-actions",
        "effect-changes",
        "visibility",
        "notes",
    ] {
        let id = format!("trace-{section}-{run_anchor}");
        assert!(html.contains(&format!("href=\"#{id}\"")));
        assert!(html.contains(&format!("id=\"{id}\"")));
    }
    let decision_row = run
        .decisions
        .iter()
        .find(|row| row.outcome == "player_killed")
        .expect("seeded trace should include a kill decision")
        .row_index;
    let decision_row_id = format!("trace-decision-row-{run_anchor}-{decision_row}");
    let decision_detail_id = format!("trace-decision-detail-{run_anchor}-{decision_row}");
    assert!(html.contains(&format!("id=\"{decision_row_id}\"")));
    assert!(html.contains(&format!("href=\"#{decision_row_id}\"")));
    assert!(html.contains(&format!("id=\"{decision_detail_id}\"")));
    assert!(html.contains(&format!("href=\"#{decision_detail_id}\"")));
    let edge_row = run
        .edges
        .iter()
        .find(|row| row.kind == "redirect")
        .expect("seeded trace should include a redirect edge")
        .row_index;
    let edge_row_id = format!("trace-edge-row-{run_anchor}-{edge_row}");
    let edge_detail_id = format!("trace-edge-detail-{run_anchor}-{edge_row}");
    assert!(html.contains(&format!("id=\"{edge_row_id}\"")));
    assert!(html.contains(&format!("href=\"#{edge_row_id}\"")));
    assert!(html.contains(&format!("id=\"{edge_detail_id}\"")));
    assert!(html.contains(&format!("href=\"#{edge_detail_id}\"")));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-traces/view?principal_user_id=cohost_c&run_id={}",
                    run.run_id
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let cohost_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(cohost_html.contains("mafia_kill_n01:target:0:slot_2"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-traces?principal_user_id=user_1"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-traces?principal_user_id=outsider&run_id={}",
                    run.run_id
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-traces/view?principal_user_id=user_1&run_id={}",
                    run.run_id
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-traces/view?principal_user_id=outsider&run_id={}",
                    run.run_id
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_resolution_audit_is_host_audit_only_and_reports_drift(pool: sqlx::PgPool) {
    let app = router(pool.clone());
    let game = Uuid::new_v4();

    expect_ack(
        post_command(
            app.clone(),
            1,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    expect_ack(
        post_command(
            app.clone(),
            2,
            "host_h",
            Command::AddCohost {
                game,
                user: "cohost_c".into(),
            },
        )
        .await,
    );
    for (id, slot, user, role) in [
        (10, "slot_1", "user_1", "vanilla_townie"),
        (20, "slot_2", "user_2", "vanilla_townie"),
        (30, "slot_3", "user_3", "mafia_goon"),
    ] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                app.clone(),
                id + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            40,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );
    for (id, user, actor_slot) in [(41, "user_1", "slot_1"), (42, "user_2", "slot_2")] {
        expect_ack(
            post_command(
                app.clone(),
                id,
                user,
                Command::SubmitVote {
                    game,
                    actor_slot: actor_slot.into(),
                    target: VoteTarget::Slot("slot_3".into()),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            app.clone(),
            43,
            "host_h",
            Command::ResolvePhase { game, seed: 778 },
        )
        .await,
    );

    let mut tx = pool.begin().await.unwrap();
    sqlx::query("ALTER TABLE events DISABLE TRIGGER events_no_update")
        .execute(&mut *tx)
        .await
        .expect("temporarily disable append-only guard for API drift");
    let update = sqlx::query(
        "WITH outcome AS ( \
             SELECT e.stream_id, e.stream_seq, (item.ordinality - 1)::text AS event_index \
             FROM events e, \
                  jsonb_array_elements(e.payload->'events') WITH ORDINALITY AS item(event, ordinality) \
             WHERE e.stream_id = $1 \
               AND e.kind = 'ResolutionApplied' \
               AND item.event->>'kind' = 'DayVoteOutcome' \
             LIMIT 1 \
         ) \
         UPDATE events e \
         SET payload = jsonb_set( \
             e.payload, \
             ARRAY['events', outcome.event_index, 'payload', 'winner'], \
             '\"slot_2\"'::jsonb, \
             false \
         ) \
         FROM outcome \
         WHERE e.stream_id = outcome.stream_id \
           AND e.stream_seq = outcome.stream_seq",
    )
    .bind(game)
    .execute(&mut *tx)
    .await
    .expect("perturb stored ResolutionApplied winner for API");
    assert_eq!(update.rows_affected(), 1, "one applied envelope perturbed");
    sqlx::query("ALTER TABLE events ENABLE TRIGGER events_no_update")
        .execute(&mut *tx)
        .await
        .expect("restore append-only guard after API drift");
    tx.commit().await.expect("commit API drift perturbation");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-audit?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let report: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(report["game_id"], game.to_string());
    assert_eq!(report["ok"], false);
    assert_eq!(report["summary"]["matched"], 0);
    assert_eq!(report["summary"]["drifted"], 1);
    assert_eq!(report["summary"]["skipped"], 0);
    assert_eq!(report["phases"][0]["status"], "drifted");
    assert_eq!(
        report["summary"]["first_drift_paths"][0]["envelope"],
        "applied"
    );
    assert_eq!(
        report["summary"]["first_drift_paths"][0]["path"],
        "$.events[2].payload.winner"
    );

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-audit/view?principal_user_id=host_h"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(html.contains("Resolution Replay Audit"));
    assert!(html.contains("Drifted"));
    assert!(html.contains("$.events[2].payload.winner"));
    assert!(html.contains("expected:"));
    assert!(html.contains("&quot;slot_3&quot;"));
    assert!(html.contains("actual:"));
    assert!(html.contains("&quot;slot_2&quot;"));
    assert!(html.contains("href=\"#audit-diff-row-0-0\""));
    assert!(html.contains("id=\"audit-diff-row-0-0\""));
    assert!(html.contains("href=\"#audit-diff-expected-0-0\""));
    assert!(html.contains("id=\"audit-diff-expected-0-0\""));
    assert!(html.contains("href=\"#audit-diff-actual-0-0\""));
    assert!(html.contains("id=\"audit-diff-actual-0-0\""));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-audit?principal_user_id=cohost_c"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let cohost_report: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(cohost_report["summary"], report["summary"]);
    assert_eq!(cohost_report["phases"][0]["status"], "drifted");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-audit/view?principal_user_id=cohost_c"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let cohost_html = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(cohost_html.contains("$.events[2].payload.winner"));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-audit?principal_user_id=user_1"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/games/{game}/resolution-audit/view?principal_user_id=user_1"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let reject: RejectMsg = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reject.error, RejectCode::NotAuthorized);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn vertical_operator_html_surfaces_render_from_seeded_http_server(pool: sqlx::PgPool) {
    let seed_app = router(pool.clone());
    let game = Uuid::new_v4();
    ensure_operator_proof_artifacts();

    expect_ack(
        post_command(
            seed_app.clone(),
            9001,
            "host_h",
            Command::CreateGame {
                game,
                pack: "mafiascum".into(),
            },
        )
        .await,
    );
    for (idx, slot, user, role) in [
        ("1", "slot_1", "user_1", "beloved_princess"),
        ("2", "slot_2", "user_2", "vanilla_townie"),
        ("3", "slot_3", "user_3", "vanilla_townie"),
        ("4", "slot_4", "user_4", "mafia_goon"),
        ("5", "slot_5", "user_5", "mafia_goon"),
        ("6", "slot_6", "user_6", "vanilla_townie"),
    ] {
        let base = 9100 + idx.parse::<u64>().unwrap() * 10;
        expect_ack(
            post_command(
                seed_app.clone(),
                base,
                "host_h",
                Command::AddSlot {
                    game,
                    slot: slot.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                seed_app.clone(),
                base + 1,
                "host_h",
                Command::AssignSlot {
                    game,
                    slot: slot.into(),
                    user: user.into(),
                },
            )
            .await,
        );
        expect_ack(
            post_command(
                seed_app.clone(),
                base + 2,
                "host_h",
                Command::AssignRole {
                    game,
                    slot: slot.into(),
                    role_key: role.into(),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            seed_app.clone(),
            9201,
            "host_h",
            Command::StartGame {
                game,
                phase: "D01".into(),
            },
        )
        .await,
    );
    for (id, user, actor_slot) in [
        (9202, "user_2", "slot_2"),
        (9203, "user_3", "slot_3"),
        (9204, "user_4", "slot_4"),
        (9205, "user_5", "slot_5"),
    ] {
        expect_ack(
            post_command(
                seed_app.clone(),
                id,
                user,
                Command::SubmitVote {
                    game,
                    actor_slot: actor_slot.into(),
                    target: VoteTarget::Slot("slot_1".into()),
                },
            )
            .await,
        );
    }
    expect_ack(
        post_command(
            seed_app.clone(),
            9206,
            "host_h",
            Command::ResolvePhase { game, seed: 7421 },
        )
        .await,
    );
    expect_ack(
        post_command(
            seed_app,
            9207,
            "host_h",
            Command::ResolveHostPrompt {
                game,
                prompt_id: "D01:skip_next_day:slot_1".into(),
                decision: HostPromptDecision::Acknowledge,
            },
        )
        .await,
    );

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, router(pool)).await.unwrap();
    });

    let smoke_pages: Vec<(String, Vec<&str>)> = vec![
        (
            format!("/games/{game}/operator?principal_user_id=host_h"),
            vec![
                "Operator Index",
                "Host Phase-Control View",
                "Operator Proof-Run Index",
                "Operator Proof-Run Status Audit",
                "Operator Proof Artifact Go/No-Go",
                "Operator Proof Artifact Retention",
                "Operator Projection Rebuild Report",
                "Operator Resolution Diff Report",
                "Operator Trace Inspection Report",
                "Operator Large Action Graph Performance Report",
                "Operator Determinism Fuzz Report",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs?principal_user_id=host_h"),
            vec![
                "Operator Proof-Run Index",
                "Local-Only Regression Lanes",
                "Production Artifacts",
                "trusted 12 / 12; non_trusted 0",
                "large_action_graph_resolves_and_audits_within_regression_ceiling",
                "target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json",
                "target/operator-proof/game-specific-audit-bundle-20260613T001500Z.json",
                "target/operator-proof/current-status-audit-report.json",
                "target/operator-proof/current-artifact-go-no-go-report.json",
                "target/operator-proof/current-artifact-retention-report.json",
                "target/operator-proof/current-projection-rebuild-report.json",
                "target/operator-proof/current-resolution-diff-report.json",
                "target/operator-proof/current-trace-inspection-report.json",
                "target/operator-proof/current-large-action-graph-performance-report.json",
                "target/operator-proof/current-determinism-fuzz-report.json",
                "target/operator-proof/current-generated-shrink-matrix-report.tmp.json",
                "game_id: 08d8a45f-6c3b-4401-8e31-8d7637f36a82",
                "game_id: 3e3cccc1-c837-46d3-b0d6-1b83ae0cc82b",
                "manifest_version: 1",
                "retention_comparison.normalized_match: true",
                "--compare-with target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json",
                "export_operator_proof_status -- --fixture artifact-provenance --output target/operator-proof/current-status-audit-check.json",
                "audit_operator_proof_status -- --output target/operator-proof/current-status-audit-report.json crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json target/operator-proof/current-status-audit-check.json",
                "audit_operator_proof_artifacts -- --output target/operator-proof/current-artifact-go-no-go-report.json",
                "audit_operator_proof_artifact_retention -- --output target/operator-proof/current-artifact-retention-report.json",
                "audit_projection_rebuild_artifact -- --output target/operator-proof/current-projection-rebuild-report.json",
                "audit_resolution_diff_artifact -- --output target/operator-proof/current-resolution-diff-report.json",
                "audit_trace_inspection_artifact -- --output target/operator-proof/current-trace-inspection-report.json",
                "audit_large_action_graph_performance_artifact -- --output target/operator-proof/current-large-action-graph-performance-report.json",
                "audit_determinism_fuzz_artifact -- --output target/operator-proof/current-determinism-fuzz-report.json",
                "generated_shrink_matrix_writes_compact_operator_report",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs?principal_user_id=host_h&fixture=artifact-provenance"),
            vec![
                "Operator Proof-Run Index",
                "Operator Proof Fixtures",
                "trusted 12 / 12; non_trusted 0",
                "trusted 0 / 5; non_trusted 5",
                "target/operator-proof/missing-artifact-provenance-guard.json",
                "artifact not present locally",
                "target/operator-proof/malformed-artifact-metadata-guard.json",
                "artifact metadata unreadable",
                "target/operator-proof/stale-artifact-provenance-guard.json",
                "artifact stale",
                "target/operator-proof/path-mismatch-artifact-provenance-guard.json",
                "artifact path mismatch",
                "reported_path: target/operator-proof/wrong-artifact-provenance-guard.json",
                "target/operator-proof/version-mismatch-artifact-provenance-guard.json",
                "artifact manifest version incompatible",
                "artifact_version: 2",
                "expected_version: 1",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/status?principal_user_id=host_h&fixture=artifact-provenance"),
            vec![
                "\"contract_version\":1",
                "\"execution\":\"local-only command copy\"",
                "\"summary\":",
                "\"production\":",
                "\"fixtures\":",
                "\"non_trusted\":0",
                "\"non_trusted\":5",
                "\"row_id\":\"proof-run-checked-game-specific-audit-bundle\"",
                "\"state\":\"trusted\"",
                "\"row_id\":\"proof-run-game-specific-audit-artifact-retention\"",
                "\"retention_comparison_normalized_match\":true",
                "\"row_id\":\"proof-run-operator-proof-status-export\"",
                "\"artifact\":null",
                "\"row_id\":\"proof-run-operator-proof-status-snapshot-audit\"",
                "\"path\":\"target/operator-proof/current-status-audit-report.json\"",
                "\"artifact_version\":1",
                "\"expected_path\":\"crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json\"",
                "\"actual_path\":\"target/operator-proof/current-status-audit-check.json\"",
                "\"diff_count\":0",
                "\"row_id\":\"proof-run-operator-proof-artifact-go-no-go\"",
                "\"path\":\"target/operator-proof/current-artifact-go-no-go-report.json\"",
                "\"command\":\"cargo run -q -p commands --bin audit_operator_proof_artifacts",
                "\"row_id\":\"proof-run-operator-proof-artifact-retention\"",
                "\"path\":\"target/operator-proof/current-artifact-retention-report.json\"",
                "\"command\":\"cargo run -q -p commands --bin audit_operator_proof_artifact_retention",
                "\"row_id\":\"proof-run-operator-proof-projection-rebuild\"",
                "\"path\":\"target/operator-proof/current-projection-rebuild-report.json\"",
                "\"command\":\"DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin audit_projection_rebuild_artifact",
                "\"row_id\":\"proof-run-operator-proof-resolution-diff\"",
                "\"path\":\"target/operator-proof/current-resolution-diff-report.json\"",
                "\"command\":\"DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin audit_resolution_diff_artifact",
                "\"row_id\":\"proof-run-operator-proof-trace-inspection\"",
                "\"path\":\"target/operator-proof/current-trace-inspection-report.json\"",
                "\"command\":\"DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin audit_trace_inspection_artifact",
                "\"row_id\":\"proof-run-operator-proof-large-action-graph-performance\"",
                "\"path\":\"target/operator-proof/current-large-action-graph-performance-report.json\"",
                "\"command\":\"DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin audit_large_action_graph_performance_artifact",
                "\"row_id\":\"proof-run-operator-proof-determinism-fuzz\"",
                "\"path\":\"target/operator-proof/current-determinism-fuzz-report.json\"",
                "\"command\":\"DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin audit_determinism_fuzz_artifact",
                "\"row_id\":\"proof-run-operator-proof-generated-shrink-matrix\"",
                "\"path\":\"target/operator-proof/current-generated-shrink-matrix-report.tmp.json\"",
                "\"command\":\"DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands --test pipeline generated_shrink_matrix_writes_compact_operator_report",
                "\"row_id\":\"proof-run-missing-artifact-provenance-guard\"",
                "\"state\":\"missing\"",
                "\"row_id\":\"proof-run-malformed-artifact-metadata-guard\"",
                "\"state\":\"malformed\"",
                "\"row_id\":\"proof-run-stale-artifact-provenance-guard\"",
                "\"state\":\"stale\"",
                "\"freshness_max_age_seconds\":86400",
                "\"row_id\":\"proof-run-path-mismatch-artifact-provenance-guard\"",
                "\"state\":\"path_mismatch\"",
                "\"reported_path\":\"target/operator-proof/wrong-artifact-provenance-guard.json\"",
                "\"row_id\":\"proof-run-version-mismatch-artifact-provenance-guard\"",
                "\"state\":\"version_mismatch\"",
                "\"artifact_version\":2",
                "\"expected_version\":1",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/status-audit?principal_user_id=host_h"),
            vec![
                "\"ok\":true",
                "\"expected_path\":\"crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json\"",
                "\"actual_path\":\"target/operator-proof/current-status-audit-check.json\"",
                "\"artifact\":{\"path\":\"target/operator-proof/current-status-audit-report.json\",\"state\":\"trusted\"",
                "\"normalized_fields\":",
                "\"diffs\":[]",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/status-audit/view?principal_user_id=host_h"),
            vec![
                "Operator Proof-Run Status Audit",
                "matched",
                "Report Artifact",
                "artifact_version: 1",
                "diff_count: 0",
                "No status audit drift.",
                "$.families[*].runs[*].artifact.age_seconds",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/status-audit/view?principal_user_id=host_h&fixture=artifact-state-drift"),
            vec![
                "Operator Proof-Run Status Audit",
                "drifted",
                "checked-game-specific-audit-bundle",
                "artifact.state",
                "&quot;trusted&quot;",
                "&quot;missing&quot;",
                "artifact drifted",
                "diff_count: 1",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/status-audit/view?principal_user_id=host_h&fixture=saved-report-malformed"),
            vec![
                "Operator Proof-Run Status Audit",
                "artifact metadata unreadable",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/status-audit/view?principal_user_id=host_h&fixture=saved-report-stale"),
            vec!["Operator Proof-Run Status Audit", "artifact stale"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/status-audit/view?principal_user_id=host_h&fixture=saved-report-drifted"),
            vec!["Operator Proof-Run Status Audit", "artifact drifted"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/go-no-go?principal_user_id=host_h"),
            vec![
                "\"ok\":true",
                "\"artifact_path\":\"target/operator-proof/current-artifact-go-no-go-report.json\"",
                "\"production\":{\"total_artifact_rows\":12,\"trusted\":12",
                "\"row_id\":\"proof-run-operator-proof-artifact-go-no-go\"",
                "\"row_id\":\"proof-run-operator-proof-artifact-retention\"",
                "\"row_id\":\"proof-run-operator-proof-projection-rebuild\"",
                "\"row_id\":\"proof-run-operator-proof-resolution-diff\"",
                "\"row_id\":\"proof-run-operator-proof-trace-inspection\"",
                "\"row_id\":\"proof-run-operator-proof-large-action-graph-performance\"",
                "\"row_id\":\"proof-run-operator-proof-determinism-fuzz\"",
                "\"row_id\":\"proof-run-operator-proof-generated-shrink-matrix\"",
                "\"resolve_elapsed_ms\":321",
                "\"threshold_ms\":20000",
                "\"trace_row_count\":74",
                "\"phase_trace_anchored\":true",
                "\"decision_trace_anchored\":true",
                "\"family_count\":12",
                "\"seed_count\":57",
                "\"expected_family_count\":12",
                "\"expected_seed_count\":57",
                "\"case_count\":12",
                "\"expected_case_count\":12",
                "\"family_manifest_matched\":true",
                "\"state\":\"trusted\"",
                "audit_operator_proof_artifacts",
                "audit_operator_proof_artifact_retention",
                "audit_projection_rebuild_artifact",
                "audit_resolution_diff_artifact",
                "audit_trace_inspection_artifact",
                "audit_large_action_graph_performance_artifact",
                "audit_determinism_fuzz_artifact",
                "generated_shrink_matrix_writes_compact_operator_report",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/go-no-go/view?principal_user_id=host_h"),
            vec![
                "Operator Proof Artifact Go/No-Go",
                "go",
                "trusted 12 / 12; non_trusted 0",
                "proof-run-operator-proof-artifact-go-no-go",
                "proof-run-operator-proof-artifact-retention",
                "proof-run-operator-proof-projection-rebuild",
                "proof-run-operator-proof-resolution-diff",
                "proof-run-operator-proof-trace-inspection",
                "proof-run-operator-proof-large-action-graph-performance",
                "proof-run-operator-proof-determinism-fuzz",
                "proof-run-operator-proof-generated-shrink-matrix",
                "resolve_elapsed_ms: 321",
                "threshold_ms: 20000",
                "trace_row_count: 74",
                "phase_trace_anchored: true",
                "decision_trace_anchored: true",
                "family_count: 12",
                "seed_count: 57",
                "expected_family_count: 12",
                "expected_seed_count: 57",
                "family_manifest_matched: true",
                "family_count: 26",
                "expected_family_count: 26",
                "case_count: 52",
                "expected_case_count: 52",
                "audit_operator_proof_artifacts",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/retention?principal_user_id=host_h"),
            vec![
                "\"ok\":true",
                "\"artifact_path\":\"target/operator-proof/current-artifact-retention-report.json\"",
                "\"previous_path\":\"target/operator-proof/previous-artifact-go-no-go-report.json\"",
                "\"latest_path\":\"target/operator-proof/current-artifact-go-no-go-report.json\"",
                "\"regressions\":[]",
                "\"recoveries\":[]",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/retention/view?principal_user_id=host_h"),
            vec![
                "Operator Proof Artifact Retention",
                "matched",
                "target/operator-proof/current-artifact-retention-report.json",
                "target/operator-proof/previous-artifact-go-no-go-report.json",
                "target/operator-proof/current-artifact-go-no-go-report.json",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/retention/view?principal_user_id=host_h&fixture=newly-missing-artifact"),
            vec!["Operator Proof Artifact Retention", "regressed", "newly-missing-artifact", "missing"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/retention/view?principal_user_id=host_h&fixture=stale-previously-trusted"),
            vec!["Operator Proof Artifact Retention", "regressed", "stale-previously-trusted", "stale"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/retention/view?principal_user_id=host_h&fixture=recovered-artifact"),
            vec!["Operator Proof Artifact Retention", "matched", "recovered-artifact", "trusted"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/projection-rebuild?principal_user_id=host_h"),
            vec![
                "\"ok\":true",
                "\"artifact_state\":\"trusted\"",
                "\"artifact_path\":\"target/operator-proof/current-projection-rebuild-report.json\"",
                "\"isolation\":\"rollback-only transaction\"",
                "\"table_count\":13",
                "\"drifted_table_count\":0",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/projection-rebuild/view?principal_user_id=host_h"),
            vec![
                "Operator Projection Rebuild Report",
                "matched",
                "target/operator-proof/current-projection-rebuild-report.json",
                "rollback-only transaction",
                "slot_state",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/projection-rebuild/view?principal_user_id=host_h&fixture=missing-report"),
            vec!["Operator Projection Rebuild Report", "missing-report", "missing", "No table rows."],
        ),
        (
            format!("/games/{game}/operator/proof-runs/projection-rebuild/view?principal_user_id=host_h&fixture=stale-report"),
            vec!["Operator Projection Rebuild Report", "stale-report", "stale"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/projection-rebuild/view?principal_user_id=host_h&fixture=drifted-report"),
            vec!["Operator Projection Rebuild Report", "drifted-report", "drifted", "slot_state"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/projection-rebuild/view?principal_user_id=host_h&fixture=recovered-report"),
            vec!["Operator Projection Rebuild Report", "recovered-report", "trusted"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/resolution-diff?principal_user_id=host_h"),
            vec![
                "\"ok\":true",
                "\"artifact_state\":\"trusted\"",
                "\"artifact_path\":\"target/operator-proof/current-resolution-diff-report.json\"",
                "\"audited_phase_count\":1",
                "\"diff_count\":0",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/resolution-diff/view?principal_user_id=host_h"),
            vec![
                "Operator Resolution Diff Report",
                "matched",
                "target/operator-proof/current-resolution-diff-report.json",
                "resolution:N01",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/resolution-diff/view?principal_user_id=host_h&fixture=missing-report"),
            vec!["Operator Resolution Diff Report", "missing-report", "missing", "No phase rows."],
        ),
        (
            format!("/games/{game}/operator/proof-runs/resolution-diff/view?principal_user_id=host_h&fixture=stale-report"),
            vec!["Operator Resolution Diff Report", "stale-report", "stale"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/resolution-diff/view?principal_user_id=host_h&fixture=drifted-report"),
            vec!["Operator Resolution Diff Report", "drifted-report", "drifted", "$.winner"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/resolution-diff/view?principal_user_id=host_h&fixture=matched-report"),
            vec!["Operator Resolution Diff Report", "matched-report", "trusted"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/trace-inspection?principal_user_id=host_h"),
            vec![
                "\"ok\":true",
                "\"artifact_state\":\"trusted\"",
                "\"artifact_path\":\"target/operator-proof/current-trace-inspection-report.json\"",
                "\"trace_count\":1",
                "\"decision_count\":1",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h"),
            vec![
                "Operator Trace Inspection Report",
                "available",
                "target/operator-proof/current-trace-inspection-report.json",
                "resolution:N01",
                "fixture trace",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h&fixture=missing-report"),
            vec!["Operator Trace Inspection Report", "missing-report", "missing", "No trace rows."],
        ),
        (
            format!("/games/{game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h&fixture=stale-report"),
            vec!["Operator Trace Inspection Report", "stale-report", "stale"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h&fixture=malformed-report"),
            vec!["Operator Trace Inspection Report", "malformed-report", "malformed"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h&fixture=filtered-run"),
            vec!["Operator Trace Inspection Report", "filtered-run", "trusted", "filtered:run"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h&fixture=empty-trace"),
            vec!["Operator Trace Inspection Report", "empty-trace", "drifted", "No trace rows."],
        ),
        (
            format!("/games/{game}/operator/proof-runs/large-action-graph-performance?principal_user_id=host_h"),
            vec![
                "\"ok\":true",
                "\"artifact_state\":\"trusted\"",
                "\"artifact_path\":\"target/operator-proof/current-large-action-graph-performance-report.json\"",
                "\"roster_count\":40",
                "\"submitted_action_count\":29",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/large-action-graph-performance/view?principal_user_id=host_h"),
            vec![
                "Operator Large Action Graph Performance Report",
                "within ceiling",
                "target/operator-proof/current-large-action-graph-performance-report.json",
                "Projection rebuild",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/large-action-graph-performance/view?principal_user_id=host_h&fixture=threshold-regressed"),
            vec![
                "Operator Large Action Graph Performance Report",
                "threshold-regressed",
                "drifted",
                "regressed",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/determinism-fuzz?principal_user_id=host_h"),
            vec![
                "\"ok\":true",
                "\"artifact_state\":\"trusted\"",
                "\"artifact_path\":\"target/operator-proof/current-determinism-fuzz-report.json\"",
                "\"family_count\":12",
                "\"seed_count\":57",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/determinism-fuzz/view?principal_user_id=host_h"),
            vec![
                "Operator Determinism Fuzz Report",
                "passed",
                "target/operator-proof/current-determinism-fuzz-report.json",
                "generated_default_open_day_replay_audit_and_rebuild_deterministically",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/determinism-fuzz/view?principal_user_id=host_h&fixture=failed-seed"),
            vec![
                "Operator Determinism Fuzz Report",
                "failed-seed",
                "drifted",
                "First Failing Seed",
            ],
        ),
        (
            format!("/games/{game}/operator/proof-runs/go-no-go/view?principal_user_id=host_h&fixture=missing-production-artifact"),
            vec!["Operator Proof Artifact Go/No-Go", "no-go", "missing", "non_trusted 1"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/go-no-go/view?principal_user_id=host_h&fixture=stale-production-artifact"),
            vec!["Operator Proof Artifact Go/No-Go", "no-go", "stale", "non_trusted 1"],
        ),
        (
            format!("/games/{game}/operator/proof-runs/go-no-go/view?principal_user_id=host_h&fixture=drifted-production-artifact"),
            vec!["Operator Proof Artifact Go/No-Go", "no-go", "drifted", "non_trusted 1"],
        ),
        (
            format!("/games/{game}/projection-audit/view?principal_user_id=host_h"),
            vec!["Projection Rebuild Audit", "matched"],
        ),
        (
            format!("/games/{game}/resolution-audit/view?principal_user_id=host_h"),
            vec!["Resolution Replay Audit", "D01"],
        ),
        (
            format!("/games/{game}/resolution-traces/view?principal_user_id=host_h"),
            vec![
                "Resolution Trace Inspection",
                "D01",
                "Decisions",
                "Redirect Edges",
                "JSON detail",
            ],
        ),
        (
            format!("/games/{game}/host-phase-controls/view?principal_user_id=host_h"),
            vec!["Host Phase-Control Audit", "D01:skip_next_day:slot_1"],
        ),
    ];

    let mut evidence_pages = Vec::new();
    for (path, expected) in smoke_pages {
        let (status, body) = http_get(addr, &path).await;
        assert_eq!(status, 200, "GET {path}");
        let mut checks = Vec::new();
        for needle in expected {
            let present = body.contains(needle);
            assert!(present, "GET {path} should render {needle}");
            checks.push(serde_json::json!({
                "needle": needle,
                "present": present,
            }));
        }
        if path.contains("fixture=artifact-provenance") && !path.contains("/status?") {
            for row_id in [
                "proof-run-missing-artifact-provenance-guard",
                "proof-run-malformed-artifact-metadata-guard",
                "proof-run-stale-artifact-provenance-guard",
                "proof-run-path-mismatch-artifact-provenance-guard",
                "proof-run-version-mismatch-artifact-provenance-guard",
            ] {
                let row = table_row_for(&body, row_id);
                for forbidden in [
                    "game_id:",
                    "manifest_version:",
                    "retention_comparison.normalized_match:",
                ] {
                    assert!(
                        !row.contains(forbidden),
                        "GET {path} {row_id} should not render {forbidden}"
                    );
                }
            }
            checks.push(serde_json::json!({
                "needle": "artifact provenance rows exclude parsed metadata",
                "present": true,
            }));
        }
        evidence_pages.push(serde_json::json!({
            "path": path,
            "status": status,
            "checks": checks,
        }));
    }

    let artifact_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("target/operator-browser-smoke");
    std::fs::create_dir_all(&artifact_dir).expect("create operator smoke artifact dir");
    std::fs::write(
        artifact_dir.join("live-http-dom-proof.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "game": game,
            "base_url": format!("http://{addr}"),
            "surfaces": evidence_pages,
        }))
        .expect("serialize operator smoke artifact"),
    )
    .expect("write operator smoke artifact");

    server.abort();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn websocket_hello_announces_protocol(pool: sqlx::PgPool) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, router(pool)).await.unwrap();
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ws"))
        .await
        .unwrap();
    let msg = socket.next().await.unwrap().unwrap();
    let text = msg.into_text().unwrap();
    let envelope: ServerEnvelope = serde_json::from_str(&text).unwrap();

    assert_eq!(envelope.v, PROTOCOL_VERSION);
    assert_eq!(envelope.id, 0);
    match envelope.body {
        ServerMsg::Hello(hello) => {
            assert_eq!(hello.protocol_v, PROTOCOL_VERSION);
            assert_eq!(hello.server, "fmarch-dev");
            assert!(hello.caps.is_empty());
        }
        other => panic!("expected Hello, got {other:?}"),
    }

    server.abort();
}
