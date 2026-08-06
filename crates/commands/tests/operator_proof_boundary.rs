use std::path::PathBuf;

#[test]
fn status_audit_report_evaluation_has_one_immutable_request_boundary() {
    let source_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/operator_proof.rs");
    let source = std::fs::read_to_string(source_path).unwrap();

    for request_contract in [
        "struct ProofRunStatusAuditRequest<'a>",
        "declared_artifact_path: &'a str",
        "expected_report_expected_path: &'a str",
        "expected_report_actual_path: &'a str",
        "expected_manifest_version: u16",
        "artifact_freshness_max_age_seconds: u64",
        "now: SystemTime",
        "resolved_artifact_path: &'a FsPath",
        "report: &'a OperatorProofRunStatusAuditReport",
    ] {
        assert!(
            source.contains(request_contract),
            "missing status-audit request contract: {request_contract}"
        );
    }
    assert!(!source.contains("pub struct ProofRunStatusAuditRequest"));

    let loader_start = source
        .find("pub fn proof_run_status_audit_report_artifact_state_at(")
        .expect("status-audit filesystem entrypoint");
    let boundary_end = source[loader_start..]
        .find("pub fn proof_run_artifact_freshness(")
        .map(|offset| loader_start + offset)
        .expect("status-audit boundary end");
    let boundary = &source[loader_start..boundary_end];

    for loader_contract in [
        "let artifact_path = proof_run_artifact_fs_path(path);",
        "if !artifact_path.exists()",
        "fs::read_to_string(&artifact_path)",
        "serde_json::from_str::<OperatorProofRunStatusAuditReport>(&text)",
        "let request = ProofRunStatusAuditRequest {",
        "resolved_artifact_path: &artifact_path",
        "report: &report",
        "evaluate_proof_run_status_audit_report(&request)",
    ] {
        assert!(
            boundary.contains(loader_contract),
            "filesystem entrypoint lost contract: {loader_contract}"
        );
    }
    assert!(!boundary.contains("let mut request"));

    let evaluator_start = boundary
        .find("fn evaluate_proof_run_status_audit_report(")
        .expect("private status-audit evaluator");
    let evaluator = &boundary[evaluator_start..];
    assert!(evaluator.contains("request: &ProofRunStatusAuditRequest<'_>"));
    assert!(!evaluator.starts_with("pub fn"));

    let precedence = [
        "if report.artifact_path != request.declared_artifact_path",
        "if report.artifact_version != request.expected_manifest_version",
        "if report.expected_path != request.expected_report_expected_path",
        "proof_run_artifact_freshness(",
        "if freshness.age_seconds > request.artifact_freshness_max_age_seconds",
        "if !report.ok || diff_count > 0",
        "ProofRunArtifactState::AuditReportPresent",
    ];
    let mut previous = 0;
    for (index, contract) in precedence.into_iter().enumerate() {
        let position = evaluator
            .find(contract)
            .unwrap_or_else(|| panic!("status-audit evaluator lost precedence step: {contract}"));
        if index > 0 {
            assert!(
                position > previous,
                "status-audit precedence changed at {contract}"
            );
        }
        previous = position;
    }

    assert!(source.contains("pub fn proof_run_status_audit_report_artifact_state("));
    assert!(source.contains("pub fn proof_run_status_audit_report_artifact_state_at("));
    assert!(!source.contains("proof_run_status_audit_report_artifact_state_from_report"));
    assert!(!source.contains("clippy::too_many_arguments"));
    assert!(!source.contains(
        "artifact audit inputs remain explicit until the proof-report boundary gains a request context"
    ));
}
