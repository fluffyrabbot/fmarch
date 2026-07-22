use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path as FsPath, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const PROOF_RUN_MANIFEST_JSON: &str = include_str!("../../../docs/ops/proof-runs.json");
pub const PROOF_RUN_STATUS_CONTRACT_VERSION: u16 = 1;
pub const PROOF_RUN_STATUS_AUDIT_REPORT_ARTIFACT_VERSION: u16 = 1;
pub const PROOF_RUN_GO_NO_GO_REPORT_ARTIFACT_VERSION: u16 = 1;
pub const PROOF_RUN_GO_NO_GO_RETENTION_REPORT_ARTIFACT_VERSION: u16 = 1;
pub const PROJECTION_REBUILD_AUDIT_REPORT_ARTIFACT_VERSION: u16 = 1;
pub const RESOLUTION_DIFF_REPORT_ARTIFACT_VERSION: u16 = 1;
pub const COMMAND_PROJECTION_RESOLUTION_REPORT_ARTIFACT_VERSION: u16 = 1;
pub const TRACE_INSPECTION_REPORT_ARTIFACT_VERSION: u16 = 1;
pub const LARGE_ACTION_GRAPH_PERFORMANCE_REPORT_ARTIFACT_VERSION: u16 = 1;
pub const DETERMINISM_FUZZ_REPORT_ARTIFACT_VERSION: u16 = 1;
pub const GENERATED_SHRINK_MATRIX_REPORT_ARTIFACT_VERSION: u16 = 1;
pub const GENERATED_SHRINK_GAP_AUDIT_REPORT_ARTIFACT_VERSION: u16 = 1;
pub const GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT: usize = 29;
pub const GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT: usize = 58;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofRunManifest {
    pub version: u16,
    pub artifact_freshness_max_age_seconds: u64,
    pub database_url_example: String,
    pub families: Vec<ProofRunFamily>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofRunFamily {
    pub heading: String,
    pub runs: Vec<ProofRunSpec>,
    #[serde(default)]
    pub fixture: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofRunSpec {
    pub id: String,
    pub family: String,
    pub scope: String,
    pub command_template: String,
    #[serde(default)]
    pub test_selector: Option<String>,
    #[serde(default)]
    pub artifact_path: Option<String>,
    #[serde(default)]
    pub artifact_kind: ProofRunArtifactKind,
    #[serde(default)]
    pub audit_expected_path: Option<String>,
    #[serde(default)]
    pub audit_actual_path: Option<String>,
    pub proof_boundary: String,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProofRunArtifactKind {
    GameSpecificAuditBundle,
    OperatorProofStatusAuditReport,
    OperatorProofGoNoGoReport,
    OperatorProofGoNoGoRetentionReport,
    ProjectionRebuildAuditReport,
    ResolutionDiffReport,
    CommandProjectionResolutionReport,
    TraceInspectionReport,
    LargeActionGraphPerformanceReport,
    DeterminismFuzzReport,
    GeneratedShrinkMatrixReport,
    GeneratedShrinkGapAuditReport,
}

impl Default for ProofRunArtifactKind {
    fn default() -> Self {
        Self::GameSpecificAuditBundle
    }
}

#[derive(Debug, Clone, Deserialize)]
struct ProofRunArtifactReport {
    game_id: Uuid,
    manifest_version: u16,
    artifact_path: String,
    #[serde(default)]
    retention_comparison: Option<ProofRunRetentionComparison>,
}

#[derive(Debug, Clone, Deserialize)]
struct ProofRunRetentionComparison {
    normalized_match: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProofRunArtifactFreshness {
    pub modified_at_unix_seconds: u64,
    pub age_seconds: u64,
    pub max_age_seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProofRunArtifactState {
    Missing,
    Malformed,
    PathMismatch {
        reported_path: String,
    },
    VersionMismatch {
        artifact_manifest_version: u16,
        expected_manifest_version: u16,
    },
    Stale {
        freshness: ProofRunArtifactFreshness,
    },
    InputMismatch {
        expected_expected_path: String,
        expected_actual_path: String,
        reported_expected_path: String,
        reported_actual_path: String,
    },
    Drifted {
        diff_count: usize,
        freshness: ProofRunArtifactFreshness,
    },
    Present {
        game_id: Uuid,
        manifest_version: u16,
        normalized_match: Option<bool>,
        freshness: ProofRunArtifactFreshness,
    },
    AuditReportPresent {
        artifact_version: u16,
        expected_path: String,
        actual_path: String,
        diff_count: usize,
        freshness: ProofRunArtifactFreshness,
    },
    GoNoGoReportPresent {
        artifact_version: u16,
        freshness: ProofRunArtifactFreshness,
    },
    GoNoGoRetentionReportPresent {
        artifact_version: u16,
        freshness: ProofRunArtifactFreshness,
    },
    ProjectionRebuildAuditReportPresent {
        artifact_version: u16,
        game_id: Uuid,
        table_count: usize,
        diff_count: usize,
        freshness: ProofRunArtifactFreshness,
    },
    ResolutionDiffReportPresent {
        artifact_version: u16,
        game_id: Uuid,
        phase_count: usize,
        diff_count: usize,
        freshness: ProofRunArtifactFreshness,
    },
    CommandProjectionResolutionReportPresent {
        artifact_version: u16,
        game_id: Uuid,
        table_count: usize,
        phase_count: usize,
        diff_count: usize,
        freshness: ProofRunArtifactFreshness,
    },
    TraceInspectionReportPresent {
        artifact_version: u16,
        game_id: Uuid,
        trace_count: usize,
        detail_count: usize,
        freshness: ProofRunArtifactFreshness,
    },
    LargeActionGraphPerformanceReportPresent {
        artifact_version: u16,
        game_id: Uuid,
        resolve_elapsed_ms: u64,
        threshold_ms: u64,
        trace_row_count: usize,
        phase_trace_anchored: bool,
        decision_trace_anchored: bool,
        freshness: ProofRunArtifactFreshness,
    },
    DeterminismFuzzReportPresent {
        artifact_version: u16,
        family_count: usize,
        seed_count: usize,
        expected_family_count: usize,
        expected_seed_count: usize,
        family_manifest_matched: bool,
        freshness: ProofRunArtifactFreshness,
    },
    GeneratedShrinkMatrixReportPresent {
        artifact_version: u16,
        family_count: usize,
        case_count: usize,
        expected_family_count: usize,
        expected_case_count: usize,
        family_manifest_matched: bool,
        freshness: ProofRunArtifactFreshness,
    },
    GeneratedShrinkGapAuditReportPresent {
        artifact_version: u16,
        expected_family_count: usize,
        manifest_family_count: usize,
        expected_case_count: usize,
        manifest_case_count: usize,
        missing_family_count: usize,
        unexpected_family_count: usize,
        count_mismatch_count: usize,
        evidence_failure_count: usize,
        gap_audit_ok: bool,
        freshness: ProofRunArtifactFreshness,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct OperatorProofRunStatus {
    pub contract_version: u16,
    pub game: Uuid,
    pub manifest_version: u16,
    pub execution: &'static str,
    pub summary: OperatorProofRunSummary,
    pub families: Vec<OperatorProofRunStatusFamily>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OperatorProofRunStatusFamily {
    pub heading: String,
    pub fixture: bool,
    pub runs: Vec<OperatorProofRunStatusRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OperatorProofRunStatusRow {
    pub id: String,
    pub row_id: String,
    pub family: String,
    pub scope: String,
    pub fixture: bool,
    pub command: String,
    pub artifact: Option<OperatorProofRunArtifactStatus>,
    pub proof_boundary: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct OperatorProofRunSummary {
    pub production: OperatorProofRunArtifactCounts,
    pub fixtures: OperatorProofRunArtifactCounts,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct OperatorProofRunArtifactCounts {
    pub total_artifact_rows: u64,
    pub trusted: u64,
    pub stale: u64,
    pub missing: u64,
    pub malformed: u64,
    pub path_mismatch: u64,
    pub version_mismatch: u64,
    pub input_mismatch: u64,
    pub drifted: u64,
    pub non_trusted: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct OperatorProofRunArtifactStatus {
    pub path: String,
    pub state: OperatorProofRunArtifactStateKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reported_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_version: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_version: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at_unix_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub freshness_max_age_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reported_expected_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reported_actual_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trusted_metadata: Option<OperatorProofRunTrustedArtifactMetadata>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OperatorProofRunArtifactStateKind {
    Missing,
    Malformed,
    PathMismatch,
    VersionMismatch,
    InputMismatch,
    Drifted,
    Stale,
    Trusted,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct OperatorProofRunTrustedArtifactMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_version: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_comparison_normalized_match: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolve_elapsed_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub threshold_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_row_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase_trace_anchored: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision_trace_anchored: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projection_table_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_phase_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_family_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_seed_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family_manifest_matched: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub case_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_case_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_family_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_case_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_family_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unexpected_family_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count_mismatch_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_failure_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gap_audit_ok: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorProofRunStatusAuditReport {
    pub artifact_version: u16,
    pub artifact_path: String,
    pub ok: bool,
    pub expected_path: String,
    pub actual_path: String,
    pub normalized_fields: Vec<String>,
    pub diffs: Vec<OperatorProofRunStatusDiff>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
pub struct OperatorProofRunStatusDiff {
    pub path: String,
    pub expected: Value,
    pub actual: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorProofRunGoNoGoReport {
    pub artifact_version: u16,
    pub artifact_path: String,
    pub ok: bool,
    pub manifest_version: u16,
    pub production: OperatorProofRunArtifactCounts,
    pub fixtures: OperatorProofRunArtifactCounts,
    pub rows: Vec<OperatorProofRunGoNoGoRow>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorProofRunGoNoGoRow {
    pub id: String,
    pub row_id: String,
    pub family: String,
    pub scope: String,
    pub fixture: bool,
    pub command: String,
    pub artifact_path: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trusted_metadata: Option<OperatorProofRunTrustedArtifactMetadata>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorProofRunGoNoGoRetentionReport {
    pub artifact_version: u16,
    pub artifact_path: String,
    pub ok: bool,
    pub previous_path: String,
    pub latest_path: String,
    pub normalized_fields: Vec<String>,
    pub regressions: Vec<OperatorProofRunGoNoGoRetentionChange>,
    pub recoveries: Vec<OperatorProofRunGoNoGoRetentionChange>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
pub struct OperatorProofRunGoNoGoRetentionChange {
    pub row_id: String,
    pub artifact_path: String,
    pub previous_state: String,
    pub latest_state: String,
    pub command: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorProjectionRebuildAuditReport {
    pub artifact_version: u16,
    pub artifact_path: String,
    pub ok: bool,
    pub game_id: Uuid,
    pub isolation: String,
    pub table_count: usize,
    pub matched_table_count: usize,
    pub drifted_table_count: usize,
    pub tables: Vec<OperatorProjectionRebuildAuditTable>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
pub struct OperatorProjectionRebuildAuditTable {
    pub table: String,
    pub matches: bool,
    pub before_rows: usize,
    pub rebuilt_rows: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rebuilt: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorResolutionDiffReport {
    pub artifact_version: u16,
    pub artifact_path: String,
    pub ok: bool,
    pub game_id: Uuid,
    pub normalized_fields: Vec<String>,
    pub audited_phase_count: usize,
    pub matched_phase_count: usize,
    pub drifted_phase_count: usize,
    pub skipped_phase_count: usize,
    pub diff_count: usize,
    pub first_drift_paths: Vec<OperatorResolutionDiffPath>,
    pub phases: Vec<OperatorResolutionDiffPhase>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
pub struct OperatorResolutionDiffPath {
    pub phase_id: String,
    pub run_id: String,
    pub envelope: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
pub struct OperatorResolutionDiffPhase {
    pub phase_id: String,
    pub run_id: String,
    pub status: String,
    pub applied_matches: bool,
    pub trace_matches: bool,
    pub diff_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub diffs: Vec<OperatorResolutionDiff>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
pub struct OperatorResolutionDiff {
    pub envelope: String,
    pub path: String,
    pub expected: Value,
    pub actual: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorCommandProjectionResolutionReport {
    pub artifact_version: u16,
    pub artifact_path: String,
    pub ok: bool,
    pub game_id: Uuid,
    pub fixture_path: String,
    pub pack: String,
    pub phase: String,
    pub resolve_seed: u64,
    pub proof_boundary: String,
    pub projection_rebuild: OperatorProjectionRebuildAuditReport,
    pub resolution_diff: OperatorResolutionDiffReport,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorTraceInspectionReport {
    pub artifact_version: u16,
    pub artifact_path: String,
    pub ok: bool,
    pub game_id: Uuid,
    pub normalized_fields: Vec<String>,
    pub trace_count: usize,
    pub decision_count: usize,
    pub edge_count: usize,
    pub generated_count: usize,
    pub effect_change_count: usize,
    pub visibility_count: usize,
    pub note_count: usize,
    pub traces: Vec<OperatorTraceInspectionRun>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
pub struct OperatorTraceInspectionRun {
    pub phase_id: String,
    pub run_id: String,
    pub applied_stream_seq: Option<i64>,
    pub trace_stream_seq: i64,
    pub trace_version: u16,
    pub decision_count: usize,
    pub edge_count: usize,
    pub generated_count: usize,
    pub effect_change_count: usize,
    pub visibility_count: usize,
    pub note_count: usize,
    pub decisions: Vec<Value>,
    pub edges: Vec<Value>,
    pub generated: Vec<Value>,
    pub effect_changes: Vec<Value>,
    pub visibility: Vec<Value>,
    pub notes: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorLargeActionGraphPerformanceReport {
    pub artifact_version: u16,
    pub artifact_path: String,
    pub ok: bool,
    pub game_id: Uuid,
    pub pack: String,
    pub phase_id: String,
    pub seed: u64,
    pub resolve_seed: u64,
    pub roster_count: usize,
    pub submitted_action_count: usize,
    pub resolution_inner_event_count: usize,
    pub stream_event_count: i64,
    pub trace_row_count: usize,
    pub phase_trace_anchored: bool,
    pub decision_trace_anchored: bool,
    pub resolve_elapsed_ms: u64,
    pub threshold_ms: u64,
    pub replay_audit_ok: bool,
    pub replay_audited: usize,
    pub replay_skipped: usize,
    pub projection_rebuild_ok: bool,
    pub pgo_triggered: bool,
    pub babysitter_death: bool,
    pub hider_death: bool,
    pub lovers_linked: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorDeterminismFuzzReport {
    pub artifact_version: u16,
    pub artifact_path: String,
    pub ok: bool,
    pub command: String,
    pub test_filter: String,
    pub elapsed_ms: u64,
    pub family_count: usize,
    pub passed_family_count: usize,
    pub failed_family_count: usize,
    pub seed_count: usize,
    pub expected_family_count: usize,
    pub expected_seed_count: usize,
    pub family_manifest_matched: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_failing_seed: Option<u64>,
    pub proof_boundary: String,
    pub families: Vec<OperatorDeterminismFuzzFamily>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorGeneratedShrinkMatrixReport {
    pub artifact_version: u16,
    pub artifact_path: String,
    pub ok: bool,
    pub proof_boundary: String,
    pub family_count: usize,
    pub case_count: usize,
    pub expected_family_count: usize,
    pub expected_case_count: usize,
    pub family_manifest_matched: bool,
    pub families: BTreeMap<String, usize>,
    pub entries: Vec<OperatorGeneratedShrinkMatrixEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorGeneratedShrinkGapAuditReport {
    pub artifact_version: u16,
    pub artifact_path: String,
    pub ok: bool,
    pub expected_family_count: usize,
    pub manifest_family_count: usize,
    pub expected_case_count: usize,
    pub manifest_case_count: usize,
    pub missing_families: Vec<String>,
    pub unexpected_families: Vec<String>,
    pub count_mismatches: Vec<Value>,
    pub evidence_failures: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorGeneratedShrinkMatrixEntry {
    pub family: String,
    pub seed: u64,
    pub expectation_count: usize,
    pub success: OperatorGeneratedShrinkMatrixSuccess,
    pub bad_expectation: OperatorGeneratedShrinkMatrixBadExpectation,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorGeneratedShrinkMatrixSuccess {
    pub ok: bool,
    pub success_invariant_preserved: bool,
    pub promoted_success_fixture: bool,
    pub reduction_steps: usize,
    pub report_path: String,
    pub reduced_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OperatorGeneratedShrinkMatrixBadExpectation {
    pub ok: bool,
    pub failure_class: String,
    pub failure_class_preserved: bool,
    pub promoted_success_fixture: bool,
    pub reduction_steps: usize,
    pub report_path: String,
    pub reduced_path: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
pub struct OperatorDeterminismFuzzFamily {
    pub id: String,
    pub selector: String,
    pub pack: String,
    pub phase_scope: String,
    pub seeds: Vec<u64>,
    pub seed_count: usize,
    pub status: OperatorDeterminismFuzzFamilyStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_failing_seed: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperatorDeterminismFuzzFamilyStatus {
    Passed,
    Failed,
    NotRun,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum OperatorProofRunFixture {
    ArtifactProvenance,
    MalformedArtifact,
}

pub fn build_operator_proof_run_status(
    game: Uuid,
    fixture: Option<OperatorProofRunFixture>,
) -> OperatorProofRunStatus {
    let manifest = proof_run_manifest_with_fixture(fixture);
    build_operator_proof_run_status_from_manifest(game, &manifest)
}

pub fn build_operator_proof_run_go_no_go_report(
    game: Uuid,
    fixture: Option<OperatorProofRunFixture>,
    artifact_path: impl Into<String>,
) -> OperatorProofRunGoNoGoReport {
    let status = build_operator_proof_run_status(game, fixture);
    build_operator_proof_run_go_no_go_report_from_status(status, artifact_path)
}

pub fn build_operator_projection_rebuild_audit_report(
    artifact_path: impl Into<String>,
    report: projections::ProjectionAuditReport,
) -> OperatorProjectionRebuildAuditReport {
    let table_count = report.tables.len();
    let matched_table_count = report.tables.iter().filter(|table| table.matches).count();
    let drifted_table_count = table_count.saturating_sub(matched_table_count);
    OperatorProjectionRebuildAuditReport {
        artifact_version: PROJECTION_REBUILD_AUDIT_REPORT_ARTIFACT_VERSION,
        artifact_path: artifact_path.into(),
        ok: report.ok,
        game_id: report.game_id,
        isolation: "rollback-only transaction".to_string(),
        table_count,
        matched_table_count,
        drifted_table_count,
        tables: report
            .tables
            .into_iter()
            .map(|table| OperatorProjectionRebuildAuditTable {
                table: table.table,
                matches: table.matches,
                before_rows: table.before_rows,
                rebuilt_rows: table.rebuilt_rows,
                before: table.before,
                rebuilt: table.rebuilt,
            })
            .collect(),
    }
}

pub fn build_operator_resolution_diff_report(
    artifact_path: impl Into<String>,
    report: crate::ResolutionEnvelopeAuditReport,
) -> OperatorResolutionDiffReport {
    let phases = report
        .phases
        .into_iter()
        .map(|phase| {
            let diffs = phase
                .diffs
                .into_iter()
                .map(|diff| OperatorResolutionDiff {
                    envelope: format!("{:?}", diff.envelope).to_ascii_lowercase(),
                    path: diff.path,
                    expected: diff.expected,
                    actual: diff.actual,
                })
                .collect::<Vec<_>>();
            OperatorResolutionDiffPhase {
                phase_id: phase.phase_id,
                run_id: phase.run_id,
                status: format!("{:?}", phase.status).to_ascii_lowercase(),
                applied_matches: phase.applied_matches,
                trace_matches: phase.trace_matches,
                diff_count: diffs.len(),
                reason: phase.reason,
                diffs,
            }
        })
        .collect::<Vec<_>>();
    let diff_count = phases.iter().map(|phase| phase.diff_count).sum();
    OperatorResolutionDiffReport {
        artifact_version: RESOLUTION_DIFF_REPORT_ARTIFACT_VERSION,
        artifact_path: artifact_path.into(),
        ok: report.ok,
        game_id: report.game_id,
        normalized_fields: [
            "$.phases[*].applied_stream_seq",
            "$.phases[*].trace_stream_seq",
            "$.phases[*].stored_*",
            "$.phases[*].rebuilt_*",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
        audited_phase_count: report.audited,
        matched_phase_count: report.summary.matched,
        drifted_phase_count: report.summary.drifted,
        skipped_phase_count: report.summary.skipped,
        diff_count,
        first_drift_paths: report
            .summary
            .first_drift_paths
            .into_iter()
            .map(|path| OperatorResolutionDiffPath {
                phase_id: path.phase_id,
                run_id: path.run_id,
                envelope: format!("{:?}", path.envelope).to_ascii_lowercase(),
                path: path.path,
            })
            .collect(),
        phases,
    }
}

pub fn build_operator_command_projection_resolution_report(
    artifact_path: impl Into<String>,
    fixture_path: impl Into<String>,
    pack: impl Into<String>,
    phase: impl Into<String>,
    resolve_seed: u64,
    projection_rebuild: OperatorProjectionRebuildAuditReport,
    resolution_diff: OperatorResolutionDiffReport,
) -> OperatorCommandProjectionResolutionReport {
    let ok = projection_rebuild.ok
        && projection_rebuild.drifted_table_count == 0
        && resolution_diff.ok
        && resolution_diff.audited_phase_count > 0
        && resolution_diff.drifted_phase_count == 0
        && resolution_diff.diff_count == 0;
    let game_id = projection_rebuild.game_id;
    OperatorCommandProjectionResolutionReport {
        artifact_version: COMMAND_PROJECTION_RESOLUTION_REPORT_ARTIFACT_VERSION,
        artifact_path: artifact_path.into(),
        ok,
        game_id,
        fixture_path: fixture_path.into(),
        pack: pack.into(),
        phase: phase.into(),
        resolve_seed,
        proof_boundary: "Local-Postgres-only proof: seeds the checked fixture through commands::handle, runs Command::ResolvePhase against the local DATABASE_URL Postgres service, compares resolution replay and projection rebuild results for that generated game, writes this artifact under target/operator-proof, and does not prove hosted, multi-node, production, browser, or exhaustive state-space behavior.".to_string(),
        projection_rebuild,
        resolution_diff,
    }
}

pub fn build_operator_trace_inspection_report(
    artifact_path: impl Into<String>,
    report: crate::ResolutionTraceInspectionReport,
) -> OperatorTraceInspectionReport {
    let traces = report
        .traces
        .into_iter()
        .map(|trace| OperatorTraceInspectionRun {
            phase_id: trace.phase_id,
            run_id: trace.run_id,
            applied_stream_seq: trace.applied_stream_seq,
            trace_stream_seq: trace.trace_stream_seq,
            trace_version: trace.trace_version,
            decision_count: trace.decisions.len(),
            edge_count: trace.edges.len(),
            generated_count: trace.generated.len(),
            effect_change_count: trace.effect_changes.len(),
            visibility_count: trace.visibility.len(),
            note_count: trace.notes.len(),
            decisions: trace
                .decisions
                .into_iter()
                .map(|row| serde_json::to_value(row).expect("trace decision row serializes"))
                .collect(),
            edges: trace
                .edges
                .into_iter()
                .map(|row| serde_json::to_value(row).expect("trace edge row serializes"))
                .collect(),
            generated: trace
                .generated
                .into_iter()
                .map(|row| serde_json::to_value(row).expect("trace generated row serializes"))
                .collect(),
            effect_changes: trace
                .effect_changes
                .into_iter()
                .map(|row| serde_json::to_value(row).expect("trace effect row serializes"))
                .collect(),
            visibility: trace
                .visibility
                .into_iter()
                .map(|row| serde_json::to_value(row).expect("trace visibility row serializes"))
                .collect(),
            notes: trace
                .notes
                .into_iter()
                .map(|row| serde_json::to_value(row).expect("trace note row serializes"))
                .collect(),
        })
        .collect::<Vec<_>>();
    let trace_count = traces.len();
    let decision_count = traces.iter().map(|trace| trace.decision_count).sum();
    let edge_count = traces.iter().map(|trace| trace.edge_count).sum();
    let generated_count = traces.iter().map(|trace| trace.generated_count).sum();
    let effect_change_count = traces.iter().map(|trace| trace.effect_change_count).sum();
    let visibility_count = traces.iter().map(|trace| trace.visibility_count).sum();
    let note_count = traces.iter().map(|trace| trace.note_count).sum();
    OperatorTraceInspectionReport {
        artifact_version: TRACE_INSPECTION_REPORT_ARTIFACT_VERSION,
        artifact_path: artifact_path.into(),
        ok: trace_count > 0,
        game_id: report.game_id,
        normalized_fields: [
            "$.traces[*].applied_stream_seq",
            "$.traces[*].trace_stream_seq",
            "$.traces[*].decisions[*].applied_stream_seq",
            "$.traces[*].edges[*].applied_stream_seq",
            "$.traces[*].generated[*].applied_stream_seq",
            "$.traces[*].effect_changes[*].applied_stream_seq",
            "$.traces[*].visibility[*].applied_stream_seq",
            "$.traces[*].notes[*].applied_stream_seq",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
        trace_count,
        decision_count,
        edge_count,
        generated_count,
        effect_change_count,
        visibility_count,
        note_count,
        traces,
    }
}

pub fn build_operator_large_action_graph_performance_report(
    artifact_path: impl Into<String>,
    proof: crate::LargeActionGraphPerformanceProof,
) -> OperatorLargeActionGraphPerformanceReport {
    OperatorLargeActionGraphPerformanceReport {
        artifact_version: LARGE_ACTION_GRAPH_PERFORMANCE_REPORT_ARTIFACT_VERSION,
        artifact_path: artifact_path.into(),
        ok: proof.ok,
        game_id: proof.game_id,
        pack: proof.pack,
        phase_id: proof.phase_id,
        seed: proof.seed,
        resolve_seed: proof.resolve_seed,
        roster_count: proof.roster_count,
        submitted_action_count: proof.submitted_action_count,
        resolution_inner_event_count: proof.resolution_inner_event_count,
        stream_event_count: proof.stream_event_count,
        trace_row_count: proof.trace_row_count,
        phase_trace_anchored: proof.phase_trace_anchored,
        decision_trace_anchored: proof.decision_trace_anchored,
        resolve_elapsed_ms: proof.resolve_elapsed_ms,
        threshold_ms: proof.threshold_ms,
        replay_audit_ok: proof.replay_audit_ok,
        replay_audited: proof.replay_audited,
        replay_skipped: proof.replay_skipped,
        projection_rebuild_ok: proof.projection_rebuild_ok,
        pgo_triggered: proof.pgo_triggered,
        babysitter_death: proof.babysitter_death,
        hider_death: proof.hider_death,
        lovers_linked: proof.lovers_linked,
    }
}

pub fn build_operator_determinism_fuzz_report(
    artifact_path: impl Into<String>,
    command: impl Into<String>,
    test_filter: impl Into<String>,
    elapsed_ms: u64,
    success: bool,
    output: &str,
) -> OperatorDeterminismFuzzReport {
    let first_failing_seed = first_seed_in_text(output);
    let specs = determinism_fuzz_family_specs();
    let expected_family_count = specs.len();
    let expected_seed_count = specs.iter().map(|family| family.seeds.len()).sum();
    let families = specs
        .iter()
        .map(|spec| {
            let failed = output.contains(&format!("{} ... FAILED", spec.selector))
                || output.contains(&format!("{} stdout", spec.selector));
            let passed = output.contains(&format!("{} ... ok", spec.selector))
                || output.contains(&format!("test {} ... ok", spec.selector));
            let status = if failed {
                OperatorDeterminismFuzzFamilyStatus::Failed
            } else if passed {
                OperatorDeterminismFuzzFamilyStatus::Passed
            } else {
                OperatorDeterminismFuzzFamilyStatus::NotRun
            };
            let first_failing_seed = (status == OperatorDeterminismFuzzFamilyStatus::Failed)
                .then(|| first_seed_in_text(output))
                .flatten();
            OperatorDeterminismFuzzFamily {
                id: spec.id.to_string(),
                selector: spec.selector.to_string(),
                pack: spec.pack.to_string(),
                phase_scope: spec.phase_scope.to_string(),
                seeds: spec.seeds.to_vec(),
                seed_count: spec.seeds.len(),
                status,
                first_failing_seed,
            }
        })
        .collect::<Vec<_>>();
    let family_count = families.len();
    let passed_family_count = families
        .iter()
        .filter(|family| family.status == OperatorDeterminismFuzzFamilyStatus::Passed)
        .count();
    let failed_family_count = families
        .iter()
        .filter(|family| family.status == OperatorDeterminismFuzzFamilyStatus::Failed)
        .count();
    let seed_count = families.iter().map(|family| family.seed_count).sum();
    let family_manifest_matched = families.len() == specs.len()
        && families.iter().zip(specs.iter()).all(|(family, spec)| {
            family.id == spec.id
                && family.selector == spec.selector
                && family.pack == spec.pack
                && family.phase_scope == spec.phase_scope
                && family.seeds == spec.seeds
                && family.seed_count == spec.seeds.len()
        });
    let ok = success
        && family_count > 0
        && family_manifest_matched
        && family_count == expected_family_count
        && seed_count == expected_seed_count
        && passed_family_count == family_count
        && failed_family_count == 0
        && families
            .iter()
            .all(|family| family.status == OperatorDeterminismFuzzFamilyStatus::Passed);

    OperatorDeterminismFuzzReport {
        artifact_version: DETERMINISM_FUZZ_REPORT_ARTIFACT_VERSION,
        artifact_path: artifact_path.into(),
        ok,
        command: command.into(),
        test_filter: test_filter.into(),
        elapsed_ms,
        family_count,
        passed_family_count,
        failed_family_count,
        seed_count,
        expected_family_count,
        expected_seed_count,
        family_manifest_matched,
        first_failing_seed,
        proof_boundary: "Runs the known seeded command-pipeline replay/projection/trace scenario families as local Postgres integration tests; this is deterministic generator coverage, not exhaustive state-space verification.".to_string(),
        families,
    }
}

#[derive(Debug, Clone, Copy)]
pub struct OperatorDeterminismFuzzFamilySpec {
    pub id: &'static str,
    pub selector: &'static str,
    pub pack: &'static str,
    pub phase_scope: &'static str,
    pub seeds: &'static [u64],
}

pub fn determinism_fuzz_family_specs() -> Vec<OperatorDeterminismFuzzFamilySpec> {
    vec![
        OperatorDeterminismFuzzFamilySpec {
            id: "seeded-day-vote",
            selector: "seeded_day_vote_scenarios_replay_audit_and_rebuild_deterministically",
            pack: "mafiascum",
            phase_scope: "D01",
            seeds: &[101, 202, 303, 404, 505],
        },
        OperatorDeterminismFuzzFamilySpec {
            id: "seeded-mafiascum-night",
            selector: "seeded_night_action_graphs_replay_audit_and_rebuild_deterministically",
            pack: "mafiascum",
            phase_scope: "N01",
            seeds: &[6101, 6202, 6303, 6404, 6505],
        },
        OperatorDeterminismFuzzFamilySpec {
            id: "seeded-trigger-dependency",
            selector: "seeded_trigger_dependency_graphs_replay_audit_and_rebuild_deterministically",
            pack: "mafiascum",
            phase_scope: "N01",
            seeds: &[7101, 7202, 7303, 7404, 7505],
        },
        OperatorDeterminismFuzzFamilySpec {
            id: "seeded-persistent-trigger",
            selector: "seeded_persistent_trigger_state_replay_audit_and_rebuild_deterministically",
            pack: "mafiascum",
            phase_scope: "N01,N02",
            seeds: &[8101, 8202, 8303, 8404],
        },
        OperatorDeterminismFuzzFamilySpec {
            id: "seeded-day-trigger-policy",
            selector: "seeded_day_trigger_policy_replay_audit_and_rebuild_deterministically",
            pack: "mafiascum",
            phase_scope: "D01",
            seeds: &[8501, 8602],
        },
        OperatorDeterminismFuzzFamilySpec {
            id: "generated-mafiascum-night",
            selector: "generated_night_action_graphs_replay_audit_and_rebuild_deterministically",
            pack: "mafiascum",
            phase_scope: "N01",
            seeds: &[91001, 91113, 91227, 91331, 91447, 91559],
        },
        OperatorDeterminismFuzzFamilySpec {
            id: "generated-chinese-night",
            selector:
                "generated_chinese_structured_night_graphs_replay_audit_and_rebuild_deterministically",
            pack: "chinese_structured",
            phase_scope: "N01",
            seeds: &[92001, 92113, 92227, 92331, 92447, 92559],
        },
        OperatorDeterminismFuzzFamilySpec {
            id: "generated-chinese-day",
            selector:
                "generated_chinese_structured_day_graphs_replay_audit_and_rebuild_deterministically",
            pack: "chinese_structured",
            phase_scope: "D01",
            seeds: &[93001, 93113, 93227, 93331, 93447, 93559],
        },
        OperatorDeterminismFuzzFamilySpec {
            id: "generated-mafia-universe-ita",
            selector: "generated_mafia_universe_ita_sessions_replay_audit_and_rebuild_deterministically",
            pack: "mafia_universe",
            phase_scope: "D01",
            seeds: &[94001, 94113, 94227, 94331, 94447, 94559],
        },
        OperatorDeterminismFuzzFamilySpec {
            id: "generated-epicmafia-pk-night",
            selector: "generated_epicmafia_pk_bomb_cult_replay_audit_and_rebuild_deterministically",
            pack: "epicmafia",
            phase_scope: "D01,N01",
            seeds: &[95001, 95113, 95227, 96001, 96113, 96227],
        },
        OperatorDeterminismFuzzFamilySpec {
            id: "generated-default-open-night",
            selector: "generated_default_open_night_replay_audit_and_rebuild_deterministically",
            pack: "default_open",
            phase_scope: "N01",
            seeds: &[97101, 97211, 97307],
        },
        OperatorDeterminismFuzzFamilySpec {
            id: "generated-default-open-day",
            selector: "generated_default_open_day_replay_audit_and_rebuild_deterministically",
            pack: "default_open",
            phase_scope: "D01",
            seeds: &[97409, 97521, 97633],
        },
    ]
}

fn first_seed_in_text(output: &str) -> Option<u64> {
    output.split("seed ").find_map(|rest| {
        let digits = rest
            .chars()
            .take_while(|ch| ch.is_ascii_digit() || *ch == '_')
            .filter(|ch| *ch != '_')
            .collect::<String>();
        (!digits.is_empty()).then(|| digits.parse().ok()).flatten()
    })
}

pub fn build_operator_proof_run_go_no_go_report_from_status(
    status: OperatorProofRunStatus,
    artifact_path: impl Into<String>,
) -> OperatorProofRunGoNoGoReport {
    let rows = status
        .families
        .iter()
        .flat_map(|family| {
            family.runs.iter().filter_map(move |row| {
                let artifact = row.artifact.as_ref()?;
                Some(OperatorProofRunGoNoGoRow {
                    id: row.id.clone(),
                    row_id: row.row_id.clone(),
                    family: row.family.clone(),
                    scope: row.scope.clone(),
                    fixture: row.fixture,
                    command: row.command.clone(),
                    artifact_path: artifact.path.clone(),
                    state: proof_run_artifact_state_label(&artifact.state).to_string(),
                    trusted_metadata: artifact.trusted_metadata.clone(),
                })
            })
        })
        .collect();
    OperatorProofRunGoNoGoReport {
        artifact_version: PROOF_RUN_GO_NO_GO_REPORT_ARTIFACT_VERSION,
        artifact_path: artifact_path.into(),
        ok: status.summary.production.non_trusted == 0,
        manifest_version: status.manifest_version,
        production: status.summary.production,
        fixtures: status.summary.fixtures,
        rows,
    }
}

pub fn audit_operator_proof_run_go_no_go_retention(
    previous_path: impl Into<String>,
    previous: OperatorProofRunGoNoGoReport,
    latest_path: impl Into<String>,
    latest: OperatorProofRunGoNoGoReport,
    artifact_path: impl Into<String>,
) -> OperatorProofRunGoNoGoRetentionReport {
    let previous_path = previous_path.into();
    let latest_path = latest_path.into();
    let artifact_path = artifact_path.into();
    let mut regressions = Vec::new();
    let mut recoveries = Vec::new();
    for latest_row in latest.rows.iter().filter(|row| !row.fixture) {
        let Some(previous_row) = previous
            .rows
            .iter()
            .find(|row| !row.fixture && row.row_id == latest_row.row_id)
        else {
            continue;
        };
        if previous_row.state == latest_row.state {
            continue;
        }
        let change = OperatorProofRunGoNoGoRetentionChange {
            row_id: latest_row.row_id.clone(),
            artifact_path: latest_row.artifact_path.clone(),
            previous_state: previous_row.state.clone(),
            latest_state: latest_row.state.clone(),
            command: latest_row.command.clone(),
        };
        if previous_row.state == "trusted" && latest_row.state != "trusted" {
            regressions.push(change);
        } else if previous_row.state != "trusted" && latest_row.state == "trusted" {
            recoveries.push(change);
        }
    }
    OperatorProofRunGoNoGoRetentionReport {
        artifact_version: PROOF_RUN_GO_NO_GO_RETENTION_REPORT_ARTIFACT_VERSION,
        artifact_path,
        ok: regressions.is_empty(),
        previous_path,
        latest_path,
        normalized_fields: vec![
            "$.production.*".to_string(),
            "$.fixtures.*".to_string(),
            "$.rows[*].state".to_string(),
        ],
        regressions,
        recoveries,
    }
}

pub fn build_operator_proof_run_status_from_manifest(
    game: Uuid,
    manifest: &ProofRunManifest,
) -> OperatorProofRunStatus {
    let families: Vec<OperatorProofRunStatusFamily> = manifest
        .families
        .iter()
        .map(|family| OperatorProofRunStatusFamily {
            heading: family.heading.clone(),
            fixture: family.fixture,
            runs: family
                .runs
                .iter()
                .map(|row| {
                    let command = render_proof_run_command(
                        &row.command_template,
                        game,
                        &manifest.database_url_example,
                    );
                    let artifact = row.artifact_path.as_ref().map(|artifact_path| {
                        let state = proof_run_artifact_state_for_spec(
                            row,
                            manifest.version,
                            manifest.artifact_freshness_max_age_seconds,
                        );
                        proof_run_artifact_status(artifact_path, state)
                    });
                    OperatorProofRunStatusRow {
                        id: row.id.clone(),
                        row_id: proof_run_row_id(&row.id),
                        family: row.family.clone(),
                        scope: row.scope.clone(),
                        fixture: family.fixture,
                        command,
                        artifact,
                        proof_boundary: row.proof_boundary.clone(),
                    }
                })
                .collect(),
        })
        .collect();

    let summary = proof_run_summary(&families);

    OperatorProofRunStatus {
        contract_version: PROOF_RUN_STATUS_CONTRACT_VERSION,
        game,
        manifest_version: manifest.version,
        execution: "local-only command copy",
        summary,
        families,
    }
}

pub fn proof_run_summary(families: &[OperatorProofRunStatusFamily]) -> OperatorProofRunSummary {
    let mut summary = OperatorProofRunSummary::default();
    for family in families {
        for row in &family.runs {
            if let Some(artifact) = &row.artifact {
                let counts = if family.fixture {
                    &mut summary.fixtures
                } else {
                    &mut summary.production
                };
                counts.record(&artifact.state);
            }
        }
    }
    summary
}

impl OperatorProofRunArtifactCounts {
    pub fn record(&mut self, state: &OperatorProofRunArtifactStateKind) {
        self.total_artifact_rows += 1;
        match state {
            OperatorProofRunArtifactStateKind::Trusted => self.trusted += 1,
            OperatorProofRunArtifactStateKind::Stale => self.stale += 1,
            OperatorProofRunArtifactStateKind::Missing => self.missing += 1,
            OperatorProofRunArtifactStateKind::Malformed => self.malformed += 1,
            OperatorProofRunArtifactStateKind::PathMismatch => self.path_mismatch += 1,
            OperatorProofRunArtifactStateKind::VersionMismatch => self.version_mismatch += 1,
            OperatorProofRunArtifactStateKind::InputMismatch => self.input_mismatch += 1,
            OperatorProofRunArtifactStateKind::Drifted => self.drifted += 1,
        }
        self.non_trusted = self.total_artifact_rows.saturating_sub(self.trusted);
    }
}

pub fn proof_run_summary_label(counts: &OperatorProofRunArtifactCounts) -> String {
    format!(
        "trusted {} / {}; non_trusted {}; stale {}; missing {}; malformed {}; mismatches {}",
        counts.trusted,
        counts.total_artifact_rows,
        counts.non_trusted,
        counts.stale,
        counts.missing,
        counts.malformed,
        counts.path_mismatch + counts.version_mismatch + counts.input_mismatch + counts.drifted
    )
}

fn proof_run_artifact_state_label(state: &OperatorProofRunArtifactStateKind) -> &'static str {
    match state {
        OperatorProofRunArtifactStateKind::Missing => "missing",
        OperatorProofRunArtifactStateKind::Malformed => "malformed",
        OperatorProofRunArtifactStateKind::PathMismatch => "path_mismatch",
        OperatorProofRunArtifactStateKind::VersionMismatch => "version_mismatch",
        OperatorProofRunArtifactStateKind::InputMismatch => "input_mismatch",
        OperatorProofRunArtifactStateKind::Drifted => "drifted",
        OperatorProofRunArtifactStateKind::Stale => "stale",
        OperatorProofRunArtifactStateKind::Trusted => "trusted",
    }
}

pub fn proof_run_manifest() -> ProofRunManifest {
    serde_json::from_str(PROOF_RUN_MANIFEST_JSON).expect("valid docs/ops/proof-runs.json")
}

pub fn proof_run_manifest_with_fixture(
    fixture: Option<OperatorProofRunFixture>,
) -> ProofRunManifest {
    let mut manifest = proof_run_manifest();
    if let Some(fixture) = fixture {
        append_operator_proof_run_fixture(&mut manifest, fixture);
    }
    manifest
}

fn append_operator_proof_run_fixture(
    manifest: &mut ProofRunManifest,
    fixture: OperatorProofRunFixture,
) {
    match fixture {
        OperatorProofRunFixture::MalformedArtifact => {
            let artifact_path = "target/operator-proof/malformed-artifact-metadata-guard.json";
            manifest.families.push(ProofRunFamily {
                heading: "Operator Proof Fixtures".to_string(),
                fixture: true,
                runs: vec![ProofRunSpec {
                    id: "malformed-artifact-metadata-guard".to_string(),
                    family: "Malformed artifact metadata guard".to_string(),
                    scope: "Local-only".to_string(),
                    command_template: format!("printf '{{' > {artifact_path}"),
                    test_selector: None,
                    artifact_path: Some(artifact_path.to_string()),
                    proof_boundary: "Fixture-only row proving malformed local artifact JSON remains display-only and does not emit parsed metadata.".to_string(),
                    artifact_kind: ProofRunArtifactKind::GameSpecificAuditBundle,
                    audit_expected_path: None,
                    audit_actual_path: None,
                }],
            });
        }
        OperatorProofRunFixture::ArtifactProvenance => {
            manifest.families.push(ProofRunFamily {
                heading: "Operator Proof Fixtures".to_string(),
                fixture: true,
                runs: vec![
                    provenance_fixture_row(
                        "missing-artifact-provenance-guard",
                        "Missing artifact provenance guard",
                        "target/operator-proof/missing-artifact-provenance-guard.json",
                        "Fixture-only row proving absent local artifacts remain display-only.",
                    ),
                    provenance_fixture_row(
                        "malformed-artifact-metadata-guard",
                        "Malformed artifact metadata guard",
                        "target/operator-proof/malformed-artifact-metadata-guard.json",
                        "Fixture-only row proving malformed local artifact JSON remains display-only and does not emit parsed metadata.",
                    ),
                    provenance_fixture_row(
                        "stale-artifact-provenance-guard",
                        "Stale artifact provenance guard",
                        "target/operator-proof/stale-artifact-provenance-guard.json",
                        "Fixture-only row proving valid but old local artifacts remain display-only.",
                    ),
                    provenance_fixture_row(
                        "path-mismatch-artifact-provenance-guard",
                        "Path mismatch artifact provenance guard",
                        "target/operator-proof/path-mismatch-artifact-provenance-guard.json",
                        "Fixture-only row proving artifacts whose internal path does not match the manifest row remain display-only.",
                    ),
                    provenance_fixture_row(
                        "version-mismatch-artifact-provenance-guard",
                        "Version mismatch artifact provenance guard",
                        "target/operator-proof/version-mismatch-artifact-provenance-guard.json",
                        "Fixture-only row proving artifacts whose manifest version is incompatible remain display-only.",
                    ),
                    generated_shrink_gap_audit_fixture_row(
                        "generated-shrink-gap-audit-drift-guard",
                        "Generated shrink gap-audit drift guard",
                        "target/operator-proof/generated-shrink-gap-audit-drift-guard.json",
                        "Fixture-only row proving a valid but semantically failing generated-shrink gap-audit artifact renders as drifted without trusted metadata.",
                    ),
                ],
            });
        }
    }
}

pub fn proof_run_artifact_status(
    path: &str,
    state: ProofRunArtifactState,
) -> OperatorProofRunArtifactStatus {
    match state {
        ProofRunArtifactState::Missing => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Missing,
            reported_path: None,
            artifact_version: None,
            expected_version: None,
            modified_at_unix_seconds: None,
            age_seconds: None,
            freshness_max_age_seconds: None,
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: None,
            trusted_metadata: None,
        },
        ProofRunArtifactState::Malformed => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Malformed,
            reported_path: None,
            artifact_version: None,
            expected_version: None,
            modified_at_unix_seconds: None,
            age_seconds: None,
            freshness_max_age_seconds: None,
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: None,
            trusted_metadata: None,
        },
        ProofRunArtifactState::PathMismatch { reported_path } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::PathMismatch,
            reported_path: Some(reported_path),
            artifact_version: None,
            expected_version: None,
            modified_at_unix_seconds: None,
            age_seconds: None,
            freshness_max_age_seconds: None,
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: None,
            trusted_metadata: None,
        },
        ProofRunArtifactState::VersionMismatch {
            artifact_manifest_version,
            expected_manifest_version,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::VersionMismatch,
            reported_path: None,
            artifact_version: Some(artifact_manifest_version),
            expected_version: Some(expected_manifest_version),
            modified_at_unix_seconds: None,
            age_seconds: None,
            freshness_max_age_seconds: None,
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: None,
            trusted_metadata: None,
        },
        ProofRunArtifactState::Stale { freshness } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Stale,
            reported_path: None,
            artifact_version: None,
            expected_version: None,
            modified_at_unix_seconds: Some(freshness.modified_at_unix_seconds),
            age_seconds: Some(freshness.age_seconds),
            freshness_max_age_seconds: Some(freshness.max_age_seconds),
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: None,
            trusted_metadata: None,
        },
        ProofRunArtifactState::InputMismatch {
            expected_expected_path,
            expected_actual_path,
            reported_expected_path,
            reported_actual_path,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::InputMismatch,
            reported_path: None,
            artifact_version: None,
            expected_version: None,
            modified_at_unix_seconds: None,
            age_seconds: None,
            freshness_max_age_seconds: None,
            expected_path: Some(expected_expected_path),
            actual_path: Some(expected_actual_path),
            reported_expected_path: Some(reported_expected_path),
            reported_actual_path: Some(reported_actual_path),
            diff_count: None,
            trusted_metadata: None,
        },
        ProofRunArtifactState::Drifted {
            diff_count,
            freshness,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Drifted,
            reported_path: None,
            artifact_version: None,
            expected_version: None,
            modified_at_unix_seconds: Some(freshness.modified_at_unix_seconds),
            age_seconds: Some(freshness.age_seconds),
            freshness_max_age_seconds: Some(freshness.max_age_seconds),
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: Some(diff_count as u64),
            trusted_metadata: None,
        },
        ProofRunArtifactState::Present {
            game_id,
            manifest_version,
            normalized_match,
            freshness,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Trusted,
            reported_path: None,
            artifact_version: None,
            expected_version: None,
            modified_at_unix_seconds: Some(freshness.modified_at_unix_seconds),
            age_seconds: Some(freshness.age_seconds),
            freshness_max_age_seconds: Some(freshness.max_age_seconds),
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: None,
            trusted_metadata: Some(OperatorProofRunTrustedArtifactMetadata {
                game_id: Some(game_id),
                manifest_version: Some(manifest_version),
                retention_comparison_normalized_match: normalized_match,
                ..OperatorProofRunTrustedArtifactMetadata::default()
            }),
        },
        ProofRunArtifactState::AuditReportPresent {
            artifact_version,
            expected_path,
            actual_path,
            diff_count,
            freshness,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Trusted,
            reported_path: None,
            artifact_version: Some(artifact_version),
            expected_version: Some(PROOF_RUN_STATUS_AUDIT_REPORT_ARTIFACT_VERSION),
            modified_at_unix_seconds: Some(freshness.modified_at_unix_seconds),
            age_seconds: Some(freshness.age_seconds),
            freshness_max_age_seconds: Some(freshness.max_age_seconds),
            expected_path: Some(expected_path),
            actual_path: Some(actual_path),
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: Some(diff_count as u64),
            trusted_metadata: None,
        },
        ProofRunArtifactState::GoNoGoReportPresent {
            artifact_version,
            freshness,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Trusted,
            reported_path: None,
            artifact_version: Some(artifact_version),
            expected_version: Some(PROOF_RUN_GO_NO_GO_REPORT_ARTIFACT_VERSION),
            modified_at_unix_seconds: Some(freshness.modified_at_unix_seconds),
            age_seconds: Some(freshness.age_seconds),
            freshness_max_age_seconds: Some(freshness.max_age_seconds),
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: Some(0),
            trusted_metadata: None,
        },
        ProofRunArtifactState::GoNoGoRetentionReportPresent {
            artifact_version,
            freshness,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Trusted,
            reported_path: None,
            artifact_version: Some(artifact_version),
            expected_version: Some(PROOF_RUN_GO_NO_GO_RETENTION_REPORT_ARTIFACT_VERSION),
            modified_at_unix_seconds: Some(freshness.modified_at_unix_seconds),
            age_seconds: Some(freshness.age_seconds),
            freshness_max_age_seconds: Some(freshness.max_age_seconds),
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: Some(0),
            trusted_metadata: None,
        },
        ProofRunArtifactState::ProjectionRebuildAuditReportPresent {
            artifact_version,
            game_id: _,
            table_count: _,
            diff_count,
            freshness,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Trusted,
            reported_path: None,
            artifact_version: Some(artifact_version),
            expected_version: Some(PROJECTION_REBUILD_AUDIT_REPORT_ARTIFACT_VERSION),
            modified_at_unix_seconds: Some(freshness.modified_at_unix_seconds),
            age_seconds: Some(freshness.age_seconds),
            freshness_max_age_seconds: Some(freshness.max_age_seconds),
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: Some(diff_count as u64),
            trusted_metadata: None,
        },
        ProofRunArtifactState::ResolutionDiffReportPresent {
            artifact_version,
            game_id: _,
            phase_count: _,
            diff_count,
            freshness,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Trusted,
            reported_path: None,
            artifact_version: Some(artifact_version),
            expected_version: Some(RESOLUTION_DIFF_REPORT_ARTIFACT_VERSION),
            modified_at_unix_seconds: Some(freshness.modified_at_unix_seconds),
            age_seconds: Some(freshness.age_seconds),
            freshness_max_age_seconds: Some(freshness.max_age_seconds),
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: Some(diff_count as u64),
            trusted_metadata: None,
        },
        ProofRunArtifactState::CommandProjectionResolutionReportPresent {
            artifact_version,
            game_id,
            table_count,
            phase_count,
            diff_count,
            freshness,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Trusted,
            reported_path: None,
            artifact_version: Some(artifact_version),
            expected_version: Some(COMMAND_PROJECTION_RESOLUTION_REPORT_ARTIFACT_VERSION),
            modified_at_unix_seconds: Some(freshness.modified_at_unix_seconds),
            age_seconds: Some(freshness.age_seconds),
            freshness_max_age_seconds: Some(freshness.max_age_seconds),
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: Some(diff_count as u64),
            trusted_metadata: Some(OperatorProofRunTrustedArtifactMetadata {
                game_id: Some(game_id),
                projection_table_count: Some(table_count as u64),
                resolution_phase_count: Some(phase_count as u64),
                ..OperatorProofRunTrustedArtifactMetadata::default()
            }),
        },
        ProofRunArtifactState::TraceInspectionReportPresent {
            artifact_version,
            game_id: _,
            trace_count: _,
            detail_count: _,
            freshness,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Trusted,
            reported_path: None,
            artifact_version: Some(artifact_version),
            expected_version: Some(TRACE_INSPECTION_REPORT_ARTIFACT_VERSION),
            modified_at_unix_seconds: Some(freshness.modified_at_unix_seconds),
            age_seconds: Some(freshness.age_seconds),
            freshness_max_age_seconds: Some(freshness.max_age_seconds),
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: Some(0),
            trusted_metadata: None,
        },
        ProofRunArtifactState::LargeActionGraphPerformanceReportPresent {
            artifact_version,
            game_id,
            resolve_elapsed_ms,
            threshold_ms,
            trace_row_count,
            phase_trace_anchored,
            decision_trace_anchored,
            freshness,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Trusted,
            reported_path: None,
            artifact_version: Some(artifact_version),
            expected_version: Some(LARGE_ACTION_GRAPH_PERFORMANCE_REPORT_ARTIFACT_VERSION),
            modified_at_unix_seconds: Some(freshness.modified_at_unix_seconds),
            age_seconds: Some(freshness.age_seconds),
            freshness_max_age_seconds: Some(freshness.max_age_seconds),
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: Some(0),
            trusted_metadata: Some(OperatorProofRunTrustedArtifactMetadata {
                game_id: Some(game_id),
                resolve_elapsed_ms: Some(resolve_elapsed_ms),
                threshold_ms: Some(threshold_ms),
                trace_row_count: Some(trace_row_count as u64),
                phase_trace_anchored: Some(phase_trace_anchored),
                decision_trace_anchored: Some(decision_trace_anchored),
                ..OperatorProofRunTrustedArtifactMetadata::default()
            }),
        },
        ProofRunArtifactState::DeterminismFuzzReportPresent {
            artifact_version,
            family_count,
            seed_count,
            expected_family_count,
            expected_seed_count,
            family_manifest_matched,
            freshness,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Trusted,
            reported_path: None,
            artifact_version: Some(artifact_version),
            expected_version: Some(DETERMINISM_FUZZ_REPORT_ARTIFACT_VERSION),
            modified_at_unix_seconds: Some(freshness.modified_at_unix_seconds),
            age_seconds: Some(freshness.age_seconds),
            freshness_max_age_seconds: Some(freshness.max_age_seconds),
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: Some(0),
            trusted_metadata: Some(OperatorProofRunTrustedArtifactMetadata {
                family_count: Some(family_count as u64),
                seed_count: Some(seed_count as u64),
                expected_family_count: Some(expected_family_count as u64),
                expected_seed_count: Some(expected_seed_count as u64),
                family_manifest_matched: Some(family_manifest_matched),
                ..OperatorProofRunTrustedArtifactMetadata::default()
            }),
        },
        ProofRunArtifactState::GeneratedShrinkMatrixReportPresent {
            artifact_version,
            family_count,
            case_count,
            expected_family_count,
            expected_case_count,
            family_manifest_matched,
            freshness,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Trusted,
            reported_path: None,
            artifact_version: Some(artifact_version),
            expected_version: Some(GENERATED_SHRINK_MATRIX_REPORT_ARTIFACT_VERSION),
            modified_at_unix_seconds: Some(freshness.modified_at_unix_seconds),
            age_seconds: Some(freshness.age_seconds),
            freshness_max_age_seconds: Some(freshness.max_age_seconds),
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: Some(0),
            trusted_metadata: Some(OperatorProofRunTrustedArtifactMetadata {
                family_count: Some(family_count as u64),
                case_count: Some(case_count as u64),
                expected_family_count: Some(expected_family_count as u64),
                expected_case_count: Some(expected_case_count as u64),
                family_manifest_matched: Some(family_manifest_matched),
                ..OperatorProofRunTrustedArtifactMetadata::default()
            }),
        },
        ProofRunArtifactState::GeneratedShrinkGapAuditReportPresent {
            artifact_version,
            expected_family_count,
            manifest_family_count,
            expected_case_count,
            manifest_case_count,
            missing_family_count,
            unexpected_family_count,
            count_mismatch_count,
            evidence_failure_count,
            gap_audit_ok,
            freshness,
        } => OperatorProofRunArtifactStatus {
            path: path.to_string(),
            state: OperatorProofRunArtifactStateKind::Trusted,
            reported_path: None,
            artifact_version: Some(artifact_version),
            expected_version: Some(GENERATED_SHRINK_GAP_AUDIT_REPORT_ARTIFACT_VERSION),
            modified_at_unix_seconds: Some(freshness.modified_at_unix_seconds),
            age_seconds: Some(freshness.age_seconds),
            freshness_max_age_seconds: Some(freshness.max_age_seconds),
            expected_path: None,
            actual_path: None,
            reported_expected_path: None,
            reported_actual_path: None,
            diff_count: Some(0),
            trusted_metadata: Some(OperatorProofRunTrustedArtifactMetadata {
                expected_family_count: Some(expected_family_count as u64),
                manifest_family_count: Some(manifest_family_count as u64),
                expected_case_count: Some(expected_case_count as u64),
                manifest_case_count: Some(manifest_case_count as u64),
                family_count: Some(manifest_family_count as u64),
                case_count: Some(manifest_case_count as u64),
                missing_family_count: Some(missing_family_count as u64),
                unexpected_family_count: Some(unexpected_family_count as u64),
                count_mismatch_count: Some(count_mismatch_count as u64),
                evidence_failure_count: Some(evidence_failure_count as u64),
                gap_audit_ok: Some(gap_audit_ok),
                ..OperatorProofRunTrustedArtifactMetadata::default()
            }),
        },
    }
}

fn provenance_fixture_row(
    id: &str,
    family: &str,
    artifact_path: &str,
    proof_boundary: &str,
) -> ProofRunSpec {
    ProofRunSpec {
        id: id.to_string(),
        family: family.to_string(),
        scope: "Local-only".to_string(),
        command_template: format!("fixture writes {artifact_path}"),
        test_selector: None,
        artifact_path: Some(artifact_path.to_string()),
        artifact_kind: ProofRunArtifactKind::GameSpecificAuditBundle,
        audit_expected_path: None,
        audit_actual_path: None,
        proof_boundary: proof_boundary.to_string(),
    }
}

fn generated_shrink_gap_audit_fixture_row(
    id: &str,
    family: &str,
    artifact_path: &str,
    proof_boundary: &str,
) -> ProofRunSpec {
    ProofRunSpec {
        id: id.to_string(),
        family: family.to_string(),
        scope: "Local-only".to_string(),
        command_template: format!("fixture writes {artifact_path}"),
        test_selector: None,
        artifact_path: Some(artifact_path.to_string()),
        artifact_kind: ProofRunArtifactKind::GeneratedShrinkGapAuditReport,
        audit_expected_path: None,
        audit_actual_path: None,
        proof_boundary: proof_boundary.to_string(),
    }
}

pub fn render_proof_run_command(template: &str, game: Uuid, database_url: &str) -> String {
    template
        .replace("{database_url}", database_url)
        .replace("{game}", &game.to_string())
}

pub fn proof_run_row_id(id: &str) -> String {
    format!("proof-run-{id}")
}

pub fn proof_run_artifact_state(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
) -> ProofRunArtifactState {
    proof_run_artifact_state_at(
        path,
        expected_manifest_version,
        artifact_freshness_max_age_seconds,
        SystemTime::now(),
    )
}

pub fn proof_run_artifact_state_for_spec(
    spec: &ProofRunSpec,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
) -> ProofRunArtifactState {
    let Some(path) = spec.artifact_path.as_deref() else {
        return ProofRunArtifactState::Missing;
    };
    match spec.artifact_kind {
        ProofRunArtifactKind::GameSpecificAuditBundle => proof_run_artifact_state(
            path,
            expected_manifest_version,
            artifact_freshness_max_age_seconds,
        ),
        ProofRunArtifactKind::OperatorProofStatusAuditReport => {
            proof_run_status_audit_report_artifact_state(
                path,
                spec.audit_expected_path.as_deref().unwrap_or_default(),
                spec.audit_actual_path.as_deref().unwrap_or_default(),
                expected_manifest_version,
                artifact_freshness_max_age_seconds,
            )
        }
        ProofRunArtifactKind::OperatorProofGoNoGoReport => {
            proof_run_go_no_go_report_artifact_state(
                path,
                expected_manifest_version,
                artifact_freshness_max_age_seconds,
            )
        }
        ProofRunArtifactKind::OperatorProofGoNoGoRetentionReport => {
            proof_run_go_no_go_retention_report_artifact_state(
                path,
                expected_manifest_version,
                artifact_freshness_max_age_seconds,
            )
        }
        ProofRunArtifactKind::ProjectionRebuildAuditReport => {
            proof_run_projection_rebuild_audit_report_artifact_state(
                path,
                expected_manifest_version,
                artifact_freshness_max_age_seconds,
            )
        }
        ProofRunArtifactKind::ResolutionDiffReport => {
            proof_run_resolution_diff_report_artifact_state(
                path,
                expected_manifest_version,
                artifact_freshness_max_age_seconds,
            )
        }
        ProofRunArtifactKind::CommandProjectionResolutionReport => {
            proof_run_command_projection_resolution_report_artifact_state(
                path,
                expected_manifest_version,
                artifact_freshness_max_age_seconds,
            )
        }
        ProofRunArtifactKind::TraceInspectionReport => {
            proof_run_trace_inspection_report_artifact_state(
                path,
                expected_manifest_version,
                artifact_freshness_max_age_seconds,
            )
        }
        ProofRunArtifactKind::LargeActionGraphPerformanceReport => {
            proof_run_large_action_graph_performance_report_artifact_state(
                path,
                expected_manifest_version,
                artifact_freshness_max_age_seconds,
            )
        }
        ProofRunArtifactKind::DeterminismFuzzReport => {
            proof_run_determinism_fuzz_report_artifact_state(
                path,
                expected_manifest_version,
                artifact_freshness_max_age_seconds,
            )
        }
        ProofRunArtifactKind::GeneratedShrinkMatrixReport => {
            proof_run_generated_shrink_matrix_report_artifact_state(
                path,
                expected_manifest_version,
                artifact_freshness_max_age_seconds,
            )
        }
        ProofRunArtifactKind::GeneratedShrinkGapAuditReport => {
            proof_run_generated_shrink_gap_audit_report_artifact_state(
                path,
                expected_manifest_version,
                artifact_freshness_max_age_seconds,
            )
        }
    }
}

pub fn proof_run_artifact_state_at(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
    now: SystemTime,
) -> ProofRunArtifactState {
    let artifact_path = proof_run_artifact_fs_path(path);
    if !artifact_path.exists() {
        return ProofRunArtifactState::Missing;
    }
    let Ok(text) = fs::read_to_string(&artifact_path) else {
        return ProofRunArtifactState::Malformed;
    };
    let Ok(report) = serde_json::from_str::<ProofRunArtifactReport>(&text) else {
        return ProofRunArtifactState::Malformed;
    };
    if report.artifact_path != path {
        return ProofRunArtifactState::PathMismatch {
            reported_path: report.artifact_path,
        };
    }
    if report.manifest_version != expected_manifest_version {
        return ProofRunArtifactState::VersionMismatch {
            artifact_manifest_version: report.manifest_version,
            expected_manifest_version,
        };
    }
    let Ok(freshness) =
        proof_run_artifact_freshness(&artifact_path, artifact_freshness_max_age_seconds, now)
    else {
        return ProofRunArtifactState::Malformed;
    };
    if freshness.age_seconds > artifact_freshness_max_age_seconds {
        return ProofRunArtifactState::Stale { freshness };
    }
    ProofRunArtifactState::Present {
        game_id: report.game_id,
        manifest_version: report.manifest_version,
        normalized_match: report
            .retention_comparison
            .map(|comparison| comparison.normalized_match),
        freshness,
    }
}

pub fn proof_run_status_audit_report_artifact_state(
    path: &str,
    expected_report_expected_path: &str,
    expected_report_actual_path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
) -> ProofRunArtifactState {
    proof_run_status_audit_report_artifact_state_at(
        path,
        expected_report_expected_path,
        expected_report_actual_path,
        expected_manifest_version,
        artifact_freshness_max_age_seconds,
        SystemTime::now(),
    )
}

pub fn proof_run_go_no_go_report_artifact_state(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
) -> ProofRunArtifactState {
    proof_run_go_no_go_report_artifact_state_at(
        path,
        expected_manifest_version,
        artifact_freshness_max_age_seconds,
        SystemTime::now(),
    )
}

pub fn proof_run_go_no_go_retention_report_artifact_state(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
) -> ProofRunArtifactState {
    proof_run_go_no_go_retention_report_artifact_state_at(
        path,
        expected_manifest_version,
        artifact_freshness_max_age_seconds,
        SystemTime::now(),
    )
}

pub fn proof_run_projection_rebuild_audit_report_artifact_state(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
) -> ProofRunArtifactState {
    proof_run_projection_rebuild_audit_report_artifact_state_at(
        path,
        expected_manifest_version,
        artifact_freshness_max_age_seconds,
        SystemTime::now(),
    )
}

pub fn proof_run_resolution_diff_report_artifact_state(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
) -> ProofRunArtifactState {
    proof_run_resolution_diff_report_artifact_state_at(
        path,
        expected_manifest_version,
        artifact_freshness_max_age_seconds,
        SystemTime::now(),
    )
}

pub fn proof_run_command_projection_resolution_report_artifact_state(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
) -> ProofRunArtifactState {
    proof_run_command_projection_resolution_report_artifact_state_at(
        path,
        expected_manifest_version,
        artifact_freshness_max_age_seconds,
        SystemTime::now(),
    )
}

pub fn proof_run_trace_inspection_report_artifact_state(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
) -> ProofRunArtifactState {
    proof_run_trace_inspection_report_artifact_state_at(
        path,
        expected_manifest_version,
        artifact_freshness_max_age_seconds,
        SystemTime::now(),
    )
}

pub fn proof_run_large_action_graph_performance_report_artifact_state(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
) -> ProofRunArtifactState {
    proof_run_large_action_graph_performance_report_artifact_state_at(
        path,
        expected_manifest_version,
        artifact_freshness_max_age_seconds,
        SystemTime::now(),
    )
}

pub fn proof_run_determinism_fuzz_report_artifact_state(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
) -> ProofRunArtifactState {
    proof_run_determinism_fuzz_report_artifact_state_at(
        path,
        expected_manifest_version,
        artifact_freshness_max_age_seconds,
        SystemTime::now(),
    )
}

pub fn proof_run_generated_shrink_matrix_report_artifact_state(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
) -> ProofRunArtifactState {
    proof_run_generated_shrink_matrix_report_artifact_state_at(
        path,
        expected_manifest_version,
        artifact_freshness_max_age_seconds,
        SystemTime::now(),
    )
}

pub fn proof_run_generated_shrink_matrix_report_artifact_state_at(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
    now: SystemTime,
) -> ProofRunArtifactState {
    let artifact_path = proof_run_artifact_fs_path(path);
    if !artifact_path.exists() {
        return ProofRunArtifactState::Missing;
    }
    let Ok(text) = fs::read_to_string(&artifact_path) else {
        return ProofRunArtifactState::Malformed;
    };
    let Ok(report) = serde_json::from_str::<OperatorGeneratedShrinkMatrixReport>(&text) else {
        return ProofRunArtifactState::Malformed;
    };
    if report.artifact_path != path {
        return ProofRunArtifactState::PathMismatch {
            reported_path: report.artifact_path,
        };
    }
    if report.artifact_version != GENERATED_SHRINK_MATRIX_REPORT_ARTIFACT_VERSION {
        return ProofRunArtifactState::VersionMismatch {
            artifact_manifest_version: report.artifact_version,
            expected_manifest_version: GENERATED_SHRINK_MATRIX_REPORT_ARTIFACT_VERSION,
        };
    }
    if expected_manifest_version == 0 {
        return ProofRunArtifactState::Malformed;
    }
    let Ok(freshness) =
        proof_run_artifact_freshness(&artifact_path, artifact_freshness_max_age_seconds, now)
    else {
        return ProofRunArtifactState::Malformed;
    };
    if freshness.age_seconds > artifact_freshness_max_age_seconds {
        return ProofRunArtifactState::Stale { freshness };
    }

    let expected_families = generated_shrink_matrix_expected_families();
    let expected_family_count = expected_families.len();
    let expected_case_count: usize = expected_families.values().sum();
    let actual_family_counts =
        report
            .entries
            .iter()
            .fold(BTreeMap::<String, usize>::new(), |mut counts, entry| {
                *counts.entry(entry.family.clone()).or_default() += 1;
                counts
            });
    let family_manifest_matched = report.families == expected_families
        && actual_family_counts == expected_families
        && report.family_count == expected_family_count
        && report.expected_family_count == expected_family_count
        && report.case_count == expected_case_count
        && report.expected_case_count == expected_case_count
        && report.family_manifest_matched
        && report.entries.len() == expected_case_count;
    let entry_failures = report
        .entries
        .iter()
        .filter(|entry| {
            entry.expectation_count == 0
                || !entry.success.ok
                || !entry.success.success_invariant_preserved
                || !entry.success.promoted_success_fixture
                || entry.bad_expectation.ok
                || entry.bad_expectation.failure_class != "semantic_expectation"
                || !entry.bad_expectation.failure_class_preserved
                || entry.bad_expectation.promoted_success_fixture
                || entry.success.report_path.is_empty()
                || entry.success.reduced_path.is_empty()
                || entry.bad_expectation.report_path.is_empty()
                || entry.bad_expectation.reduced_path.is_empty()
        })
        .count();
    let semantic_failures = [
        usize::from(!report.ok),
        usize::from(!family_manifest_matched),
        entry_failures,
    ]
    .into_iter()
    .sum();
    if semantic_failures > 0 {
        return ProofRunArtifactState::Drifted {
            diff_count: semantic_failures,
            freshness,
        };
    }
    ProofRunArtifactState::GeneratedShrinkMatrixReportPresent {
        artifact_version: report.artifact_version,
        family_count: report.family_count,
        case_count: report.case_count,
        expected_family_count: report.expected_family_count,
        expected_case_count: report.expected_case_count,
        family_manifest_matched: report.family_manifest_matched,
        freshness,
    }
}

pub fn proof_run_generated_shrink_gap_audit_report_artifact_state(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
) -> ProofRunArtifactState {
    proof_run_generated_shrink_gap_audit_report_artifact_state_at(
        path,
        expected_manifest_version,
        artifact_freshness_max_age_seconds,
        SystemTime::now(),
    )
}

pub fn proof_run_generated_shrink_gap_audit_report_artifact_state_at(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
    now: SystemTime,
) -> ProofRunArtifactState {
    let artifact_path = proof_run_artifact_fs_path(path);
    if !artifact_path.exists() {
        return ProofRunArtifactState::Missing;
    }
    let Ok(text) = fs::read_to_string(&artifact_path) else {
        return ProofRunArtifactState::Malformed;
    };
    let Ok(report) = serde_json::from_str::<OperatorGeneratedShrinkGapAuditReport>(&text) else {
        return ProofRunArtifactState::Malformed;
    };
    if report.artifact_path != path {
        return ProofRunArtifactState::PathMismatch {
            reported_path: report.artifact_path,
        };
    }
    if report.artifact_version != GENERATED_SHRINK_GAP_AUDIT_REPORT_ARTIFACT_VERSION {
        return ProofRunArtifactState::VersionMismatch {
            artifact_manifest_version: report.artifact_version,
            expected_manifest_version: GENERATED_SHRINK_GAP_AUDIT_REPORT_ARTIFACT_VERSION,
        };
    }
    if expected_manifest_version == 0 {
        return ProofRunArtifactState::Malformed;
    }
    let Ok(freshness) =
        proof_run_artifact_freshness(&artifact_path, artifact_freshness_max_age_seconds, now)
    else {
        return ProofRunArtifactState::Malformed;
    };
    if freshness.age_seconds > artifact_freshness_max_age_seconds {
        return ProofRunArtifactState::Stale { freshness };
    }

    let expected_family_count = generated_shrink_matrix_expected_families().len();
    let expected_case_count: usize = generated_shrink_matrix_expected_families().values().sum();
    let drift_count = [
        usize::from(!report.ok),
        usize::from(report.expected_family_count != expected_family_count),
        usize::from(report.manifest_family_count != expected_family_count),
        usize::from(report.expected_case_count != expected_case_count),
        usize::from(report.manifest_case_count != expected_case_count),
        report.missing_families.len(),
        report.unexpected_families.len(),
        report.count_mismatches.len(),
        report.evidence_failures.len(),
    ]
    .into_iter()
    .sum();
    if drift_count > 0 {
        return ProofRunArtifactState::Drifted {
            diff_count: drift_count,
            freshness,
        };
    }

    ProofRunArtifactState::GeneratedShrinkGapAuditReportPresent {
        artifact_version: report.artifact_version,
        expected_family_count: report.expected_family_count,
        manifest_family_count: report.manifest_family_count,
        expected_case_count: report.expected_case_count,
        manifest_case_count: report.manifest_case_count,
        missing_family_count: report.missing_families.len(),
        unexpected_family_count: report.unexpected_families.len(),
        count_mismatch_count: report.count_mismatches.len(),
        evidence_failure_count: report.evidence_failures.len(),
        gap_audit_ok: report.ok,
        freshness,
    }
}

pub fn generated_shrink_matrix_expected_families() -> BTreeMap<String, usize> {
    [
        ("backup_inheritance", 2_usize),
        ("backup_projection_state", 2_usize),
        ("babysitter", 2_usize),
        ("babysitter_projection_state", 2),
        ("bodyguard_strongman_vengeful_fixpoint", 2),
        ("bodyguard_strongman_vengeful_projection_state", 2),
        ("bomb", 2),
        ("bomb_projection_state", 2),
        ("conversion_deprogramming", 2),
        ("conversion_projection_state", 2),
        ("extra_action", 2),
        ("hider", 2),
        ("hider_projection_state", 2),
        ("hunter", 2),
        ("hunter_projection_state", 2),
        ("ignite", 2),
        ("item_grant", 2),
        ("lovers", 2),
        ("lovers_projection_state", 2),
        ("mark_clear_expiry", 2),
        ("mark_clear_visibility", 2),
        ("poison_cure", 2),
        ("pgo", 2),
        ("pgo_projection_state", 2),
        ("private_notification", 2),
        ("strongman_vengeful_fixpoint", 2),
        ("strongman_vengeful_projection_state", 2),
        ("vengeful_fixpoint", 2),
        ("vengeful_projection_state", 2),
    ]
    .into_iter()
    .map(|(family, count)| (family.to_string(), count))
    .collect()
}

pub fn proof_run_determinism_fuzz_report_artifact_state_at(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
    now: SystemTime,
) -> ProofRunArtifactState {
    let artifact_path = proof_run_artifact_fs_path(path);
    if !artifact_path.exists() {
        return ProofRunArtifactState::Missing;
    }
    let Ok(text) = fs::read_to_string(&artifact_path) else {
        return ProofRunArtifactState::Malformed;
    };
    let Ok(report) = serde_json::from_str::<OperatorDeterminismFuzzReport>(&text) else {
        return ProofRunArtifactState::Malformed;
    };
    if report.artifact_path != path {
        return ProofRunArtifactState::PathMismatch {
            reported_path: report.artifact_path,
        };
    }
    if report.artifact_version != DETERMINISM_FUZZ_REPORT_ARTIFACT_VERSION {
        return ProofRunArtifactState::VersionMismatch {
            artifact_manifest_version: report.artifact_version,
            expected_manifest_version: DETERMINISM_FUZZ_REPORT_ARTIFACT_VERSION,
        };
    }
    if expected_manifest_version == 0 {
        return ProofRunArtifactState::Malformed;
    }
    let Ok(freshness) =
        proof_run_artifact_freshness(&artifact_path, artifact_freshness_max_age_seconds, now)
    else {
        return ProofRunArtifactState::Malformed;
    };
    if freshness.age_seconds > artifact_freshness_max_age_seconds {
        return ProofRunArtifactState::Stale { freshness };
    }
    let expected_seed_count: usize = determinism_fuzz_family_specs()
        .iter()
        .map(|family| family.seeds.len())
        .sum();
    let expected_family_count = determinism_fuzz_family_specs().len();
    let semantic_failures = [
        usize::from(!report.ok),
        report.failed_family_count,
        report
            .families
            .iter()
            .filter(|family| family.status != OperatorDeterminismFuzzFamilyStatus::Passed)
            .count(),
        usize::from(report.family_count != expected_family_count),
        usize::from(report.expected_family_count != expected_family_count),
        usize::from(report.seed_count != expected_seed_count),
        usize::from(report.expected_seed_count != expected_seed_count),
        usize::from(!report.family_manifest_matched),
    ]
    .into_iter()
    .sum();
    if semantic_failures > 0 {
        return ProofRunArtifactState::Drifted {
            diff_count: semantic_failures,
            freshness,
        };
    }
    ProofRunArtifactState::DeterminismFuzzReportPresent {
        artifact_version: report.artifact_version,
        family_count: report.family_count,
        seed_count: report.seed_count,
        expected_family_count: report.expected_family_count,
        expected_seed_count: report.expected_seed_count,
        family_manifest_matched: report.family_manifest_matched,
        freshness,
    }
}

pub fn proof_run_large_action_graph_performance_report_artifact_state_at(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
    now: SystemTime,
) -> ProofRunArtifactState {
    let artifact_path = proof_run_artifact_fs_path(path);
    if !artifact_path.exists() {
        return ProofRunArtifactState::Missing;
    }
    let Ok(text) = fs::read_to_string(&artifact_path) else {
        return ProofRunArtifactState::Malformed;
    };
    let Ok(report) = serde_json::from_str::<OperatorLargeActionGraphPerformanceReport>(&text)
    else {
        return ProofRunArtifactState::Malformed;
    };
    if report.artifact_path != path {
        return ProofRunArtifactState::PathMismatch {
            reported_path: report.artifact_path,
        };
    }
    if report.artifact_version != LARGE_ACTION_GRAPH_PERFORMANCE_REPORT_ARTIFACT_VERSION {
        return ProofRunArtifactState::VersionMismatch {
            artifact_manifest_version: report.artifact_version,
            expected_manifest_version: LARGE_ACTION_GRAPH_PERFORMANCE_REPORT_ARTIFACT_VERSION,
        };
    }
    if expected_manifest_version == 0 {
        return ProofRunArtifactState::Malformed;
    }
    let Ok(freshness) =
        proof_run_artifact_freshness(&artifact_path, artifact_freshness_max_age_seconds, now)
    else {
        return ProofRunArtifactState::Malformed;
    };
    if freshness.age_seconds > artifact_freshness_max_age_seconds {
        return ProofRunArtifactState::Stale { freshness };
    }
    let semantic_failures = [
        !report.ok,
        report.resolve_elapsed_ms > report.threshold_ms,
        !report.replay_audit_ok,
        report.replay_audited != 1,
        report.replay_skipped != 0,
        !report.projection_rebuild_ok,
        !report.phase_trace_anchored,
        !report.decision_trace_anchored,
        !report.pgo_triggered,
        !report.babysitter_death,
        !report.hider_death,
        !report.lovers_linked,
        report.resolution_inner_event_count >= 200,
        report.stream_event_count > 200,
        report.trace_row_count >= 5_000,
    ]
    .into_iter()
    .filter(|failed| *failed)
    .count();
    if semantic_failures > 0 {
        return ProofRunArtifactState::Drifted {
            diff_count: semantic_failures,
            freshness,
        };
    }
    ProofRunArtifactState::LargeActionGraphPerformanceReportPresent {
        artifact_version: report.artifact_version,
        game_id: report.game_id,
        resolve_elapsed_ms: report.resolve_elapsed_ms,
        threshold_ms: report.threshold_ms,
        trace_row_count: report.trace_row_count,
        phase_trace_anchored: report.phase_trace_anchored,
        decision_trace_anchored: report.decision_trace_anchored,
        freshness,
    }
}

pub fn proof_run_trace_inspection_report_artifact_state_at(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
    now: SystemTime,
) -> ProofRunArtifactState {
    let artifact_path = proof_run_artifact_fs_path(path);
    if !artifact_path.exists() {
        return ProofRunArtifactState::Missing;
    }
    let Ok(text) = fs::read_to_string(&artifact_path) else {
        return ProofRunArtifactState::Malformed;
    };
    let Ok(report) = serde_json::from_str::<OperatorTraceInspectionReport>(&text) else {
        return ProofRunArtifactState::Malformed;
    };
    if report.artifact_path != path {
        return ProofRunArtifactState::PathMismatch {
            reported_path: report.artifact_path,
        };
    }
    if report.artifact_version != TRACE_INSPECTION_REPORT_ARTIFACT_VERSION {
        return ProofRunArtifactState::VersionMismatch {
            artifact_manifest_version: report.artifact_version,
            expected_manifest_version: TRACE_INSPECTION_REPORT_ARTIFACT_VERSION,
        };
    }
    if expected_manifest_version == 0 {
        return ProofRunArtifactState::Malformed;
    }
    let Ok(freshness) =
        proof_run_artifact_freshness(&artifact_path, artifact_freshness_max_age_seconds, now)
    else {
        return ProofRunArtifactState::Malformed;
    };
    if freshness.age_seconds > artifact_freshness_max_age_seconds {
        return ProofRunArtifactState::Stale { freshness };
    }
    if !report.ok || report.trace_count == 0 {
        return ProofRunArtifactState::Drifted {
            diff_count: usize::from(report.trace_count == 0),
            freshness,
        };
    }
    ProofRunArtifactState::TraceInspectionReportPresent {
        artifact_version: report.artifact_version,
        game_id: report.game_id,
        trace_count: report.trace_count,
        detail_count: report.decision_count
            + report.edge_count
            + report.generated_count
            + report.effect_change_count
            + report.visibility_count
            + report.note_count,
        freshness,
    }
}

pub fn proof_run_resolution_diff_report_artifact_state_at(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
    now: SystemTime,
) -> ProofRunArtifactState {
    let artifact_path = proof_run_artifact_fs_path(path);
    if !artifact_path.exists() {
        return ProofRunArtifactState::Missing;
    }
    let Ok(text) = fs::read_to_string(&artifact_path) else {
        return ProofRunArtifactState::Malformed;
    };
    let Ok(report) = serde_json::from_str::<OperatorResolutionDiffReport>(&text) else {
        return ProofRunArtifactState::Malformed;
    };
    if report.artifact_path != path {
        return ProofRunArtifactState::PathMismatch {
            reported_path: report.artifact_path,
        };
    }
    if report.artifact_version != RESOLUTION_DIFF_REPORT_ARTIFACT_VERSION {
        return ProofRunArtifactState::VersionMismatch {
            artifact_manifest_version: report.artifact_version,
            expected_manifest_version: RESOLUTION_DIFF_REPORT_ARTIFACT_VERSION,
        };
    }
    if expected_manifest_version == 0 {
        return ProofRunArtifactState::Malformed;
    }
    let Ok(freshness) =
        proof_run_artifact_freshness(&artifact_path, artifact_freshness_max_age_seconds, now)
    else {
        return ProofRunArtifactState::Malformed;
    };
    if freshness.age_seconds > artifact_freshness_max_age_seconds {
        return ProofRunArtifactState::Stale { freshness };
    }
    if !report.ok || report.drifted_phase_count > 0 || report.diff_count > 0 {
        return ProofRunArtifactState::Drifted {
            diff_count: report.diff_count.max(report.drifted_phase_count),
            freshness,
        };
    }
    ProofRunArtifactState::ResolutionDiffReportPresent {
        artifact_version: report.artifact_version,
        game_id: report.game_id,
        phase_count: report.audited_phase_count,
        diff_count: report.diff_count,
        freshness,
    }
}

pub fn proof_run_projection_rebuild_audit_report_artifact_state_at(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
    now: SystemTime,
) -> ProofRunArtifactState {
    let artifact_path = proof_run_artifact_fs_path(path);
    if !artifact_path.exists() {
        return ProofRunArtifactState::Missing;
    }
    let Ok(text) = fs::read_to_string(&artifact_path) else {
        return ProofRunArtifactState::Malformed;
    };
    let Ok(report) = serde_json::from_str::<OperatorProjectionRebuildAuditReport>(&text) else {
        return ProofRunArtifactState::Malformed;
    };
    if report.artifact_path != path {
        return ProofRunArtifactState::PathMismatch {
            reported_path: report.artifact_path,
        };
    }
    if report.artifact_version != PROJECTION_REBUILD_AUDIT_REPORT_ARTIFACT_VERSION {
        return ProofRunArtifactState::VersionMismatch {
            artifact_manifest_version: report.artifact_version,
            expected_manifest_version: PROJECTION_REBUILD_AUDIT_REPORT_ARTIFACT_VERSION,
        };
    }
    if expected_manifest_version == 0 {
        return ProofRunArtifactState::Malformed;
    }
    let Ok(freshness) =
        proof_run_artifact_freshness(&artifact_path, artifact_freshness_max_age_seconds, now)
    else {
        return ProofRunArtifactState::Malformed;
    };
    if freshness.age_seconds > artifact_freshness_max_age_seconds {
        return ProofRunArtifactState::Stale { freshness };
    }
    if !report.ok || report.drifted_table_count > 0 {
        return ProofRunArtifactState::Drifted {
            diff_count: report.drifted_table_count,
            freshness,
        };
    }
    ProofRunArtifactState::ProjectionRebuildAuditReportPresent {
        artifact_version: report.artifact_version,
        game_id: report.game_id,
        table_count: report.table_count,
        diff_count: report.drifted_table_count,
        freshness,
    }
}

pub fn proof_run_command_projection_resolution_report_artifact_state_at(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
    now: SystemTime,
) -> ProofRunArtifactState {
    let artifact_path = proof_run_artifact_fs_path(path);
    if !artifact_path.exists() {
        return ProofRunArtifactState::Missing;
    }
    let Ok(text) = fs::read_to_string(&artifact_path) else {
        return ProofRunArtifactState::Malformed;
    };
    let Ok(report) = serde_json::from_str::<OperatorCommandProjectionResolutionReport>(&text)
    else {
        return ProofRunArtifactState::Malformed;
    };
    if report.artifact_path != path {
        return ProofRunArtifactState::PathMismatch {
            reported_path: report.artifact_path,
        };
    }
    if report.artifact_version != COMMAND_PROJECTION_RESOLUTION_REPORT_ARTIFACT_VERSION {
        return ProofRunArtifactState::VersionMismatch {
            artifact_manifest_version: report.artifact_version,
            expected_manifest_version: COMMAND_PROJECTION_RESOLUTION_REPORT_ARTIFACT_VERSION,
        };
    }
    if expected_manifest_version == 0 {
        return ProofRunArtifactState::Malformed;
    }
    let Ok(freshness) =
        proof_run_artifact_freshness(&artifact_path, artifact_freshness_max_age_seconds, now)
    else {
        return ProofRunArtifactState::Malformed;
    };
    if freshness.age_seconds > artifact_freshness_max_age_seconds {
        return ProofRunArtifactState::Stale { freshness };
    }
    let diff_count = report
        .projection_rebuild
        .drifted_table_count
        .saturating_add(report.resolution_diff.diff_count)
        .saturating_add(report.resolution_diff.drifted_phase_count);
    if !report.ok || diff_count > 0 {
        return ProofRunArtifactState::Drifted {
            diff_count,
            freshness,
        };
    }
    ProofRunArtifactState::CommandProjectionResolutionReportPresent {
        artifact_version: report.artifact_version,
        game_id: report.game_id,
        table_count: report.projection_rebuild.table_count,
        phase_count: report.resolution_diff.audited_phase_count,
        diff_count,
        freshness,
    }
}

pub fn proof_run_go_no_go_retention_report_artifact_state_at(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
    now: SystemTime,
) -> ProofRunArtifactState {
    let artifact_path = proof_run_artifact_fs_path(path);
    if !artifact_path.exists() {
        return ProofRunArtifactState::Missing;
    }
    let Ok(text) = fs::read_to_string(&artifact_path) else {
        return ProofRunArtifactState::Malformed;
    };
    let Ok(report) = serde_json::from_str::<OperatorProofRunGoNoGoRetentionReport>(&text) else {
        return ProofRunArtifactState::Malformed;
    };
    if report.artifact_path != path {
        return ProofRunArtifactState::PathMismatch {
            reported_path: report.artifact_path,
        };
    }
    if report.artifact_version != PROOF_RUN_GO_NO_GO_RETENTION_REPORT_ARTIFACT_VERSION {
        return ProofRunArtifactState::VersionMismatch {
            artifact_manifest_version: report.artifact_version,
            expected_manifest_version: PROOF_RUN_GO_NO_GO_RETENTION_REPORT_ARTIFACT_VERSION,
        };
    }
    if expected_manifest_version == 0 {
        return ProofRunArtifactState::Malformed;
    }
    let Ok(freshness) =
        proof_run_artifact_freshness(&artifact_path, artifact_freshness_max_age_seconds, now)
    else {
        return ProofRunArtifactState::Malformed;
    };
    if freshness.age_seconds > artifact_freshness_max_age_seconds {
        return ProofRunArtifactState::Stale { freshness };
    }
    if !report.ok || !report.regressions.is_empty() {
        return ProofRunArtifactState::Drifted {
            diff_count: report.regressions.len(),
            freshness,
        };
    }
    ProofRunArtifactState::GoNoGoRetentionReportPresent {
        artifact_version: report.artifact_version,
        freshness,
    }
}

pub fn proof_run_go_no_go_report_artifact_state_at(
    path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
    now: SystemTime,
) -> ProofRunArtifactState {
    let artifact_path = proof_run_artifact_fs_path(path);
    if !artifact_path.exists() {
        return ProofRunArtifactState::Missing;
    }
    let Ok(text) = fs::read_to_string(&artifact_path) else {
        return ProofRunArtifactState::Malformed;
    };
    let Ok(report) = serde_json::from_str::<OperatorProofRunGoNoGoReport>(&text) else {
        return ProofRunArtifactState::Malformed;
    };
    if report.artifact_path != path {
        return ProofRunArtifactState::PathMismatch {
            reported_path: report.artifact_path,
        };
    }
    if report.artifact_version != PROOF_RUN_GO_NO_GO_REPORT_ARTIFACT_VERSION {
        return ProofRunArtifactState::VersionMismatch {
            artifact_manifest_version: report.artifact_version,
            expected_manifest_version: PROOF_RUN_GO_NO_GO_REPORT_ARTIFACT_VERSION,
        };
    }
    if report.manifest_version != expected_manifest_version {
        return ProofRunArtifactState::VersionMismatch {
            artifact_manifest_version: report.manifest_version,
            expected_manifest_version,
        };
    }
    let Ok(freshness) =
        proof_run_artifact_freshness(&artifact_path, artifact_freshness_max_age_seconds, now)
    else {
        return ProofRunArtifactState::Malformed;
    };
    if freshness.age_seconds > artifact_freshness_max_age_seconds {
        return ProofRunArtifactState::Stale { freshness };
    }
    if !report.ok || report.production.non_trusted > 0 {
        return ProofRunArtifactState::Drifted {
            diff_count: report.production.non_trusted as usize,
            freshness,
        };
    }
    ProofRunArtifactState::GoNoGoReportPresent {
        artifact_version: report.artifact_version,
        freshness,
    }
}

pub fn proof_run_status_audit_report_artifact_state_at(
    path: &str,
    expected_report_expected_path: &str,
    expected_report_actual_path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
    now: SystemTime,
) -> ProofRunArtifactState {
    let artifact_path = proof_run_artifact_fs_path(path);
    if !artifact_path.exists() {
        return ProofRunArtifactState::Missing;
    }
    let Ok(text) = fs::read_to_string(&artifact_path) else {
        return ProofRunArtifactState::Malformed;
    };
    let Ok(report) = serde_json::from_str::<OperatorProofRunStatusAuditReport>(&text) else {
        return ProofRunArtifactState::Malformed;
    };
    proof_run_status_audit_report_artifact_state_from_report(
        path,
        expected_report_expected_path,
        expected_report_actual_path,
        expected_manifest_version,
        artifact_freshness_max_age_seconds,
        now,
        &artifact_path,
        &report,
    )
}

pub fn proof_run_status_audit_report_artifact_state_from_report(
    path: &str,
    expected_report_expected_path: &str,
    expected_report_actual_path: &str,
    expected_manifest_version: u16,
    artifact_freshness_max_age_seconds: u64,
    now: SystemTime,
    artifact_path: &FsPath,
    report: &OperatorProofRunStatusAuditReport,
) -> ProofRunArtifactState {
    if report.artifact_path != path {
        return ProofRunArtifactState::PathMismatch {
            reported_path: report.artifact_path.clone(),
        };
    }
    if report.artifact_version != expected_manifest_version {
        return ProofRunArtifactState::VersionMismatch {
            artifact_manifest_version: report.artifact_version,
            expected_manifest_version,
        };
    }
    if report.expected_path != expected_report_expected_path
        || report.actual_path != expected_report_actual_path
    {
        return ProofRunArtifactState::InputMismatch {
            expected_expected_path: expected_report_expected_path.to_string(),
            expected_actual_path: expected_report_actual_path.to_string(),
            reported_expected_path: report.expected_path.clone(),
            reported_actual_path: report.actual_path.clone(),
        };
    }
    let Ok(freshness) =
        proof_run_artifact_freshness(artifact_path, artifact_freshness_max_age_seconds, now)
    else {
        return ProofRunArtifactState::Malformed;
    };
    if freshness.age_seconds > artifact_freshness_max_age_seconds {
        return ProofRunArtifactState::Stale { freshness };
    }
    let diff_count = report.diffs.len();
    if !report.ok || diff_count > 0 {
        return ProofRunArtifactState::Drifted {
            diff_count,
            freshness,
        };
    }
    ProofRunArtifactState::AuditReportPresent {
        artifact_version: report.artifact_version,
        expected_path: report.expected_path.clone(),
        actual_path: report.actual_path.clone(),
        diff_count,
        freshness,
    }
}

pub fn proof_run_artifact_freshness(
    artifact_path: &FsPath,
    max_age_seconds: u64,
    now: SystemTime,
) -> Result<ProofRunArtifactFreshness, std::io::Error> {
    let modified = fs::metadata(artifact_path)?.modified()?;
    let modified_at_unix_seconds = modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let age_seconds = now.duration_since(modified).unwrap_or_default().as_secs();
    Ok(ProofRunArtifactFreshness {
        modified_at_unix_seconds,
        age_seconds,
        max_age_seconds,
    })
}

pub fn proof_run_artifact_fs_path(path: &str) -> PathBuf {
    let artifact_path = FsPath::new(path);
    if artifact_path.is_absolute() {
        artifact_path.to_path_buf()
    } else {
        FsPath::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(artifact_path)
    }
}

pub fn audit_operator_proof_status_values(
    expected_path: impl Into<String>,
    expected: Value,
    actual_path: impl Into<String>,
    actual: Value,
) -> OperatorProofRunStatusAuditReport {
    let mut expected = expected;
    let mut actual = actual;
    normalize_operator_proof_status_pair(&mut expected, &mut actual);
    let expected_projection = operator_proof_status_audit_projection(&expected);
    let actual_projection = operator_proof_status_audit_projection(&actual);
    let mut diffs = Vec::new();
    diff_values("$", &expected_projection, &actual_projection, &mut diffs);
    OperatorProofRunStatusAuditReport {
        artifact_version: PROOF_RUN_STATUS_AUDIT_REPORT_ARTIFACT_VERSION,
        artifact_path: String::new(),
        ok: diffs.is_empty(),
        expected_path: expected_path.into(),
        actual_path: actual_path.into(),
        normalized_fields: [
            "$.game",
            "$.families[*].runs[*].command.{game}",
            "$.families[*].runs[*].artifact.modified_at_unix_seconds",
            "$.families[*].runs[*].artifact.age_seconds",
            "$.families[*].runs[*].artifact.trusted_metadata.game_id",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
        diffs,
    }
}

fn normalize_operator_proof_status_pair(expected: &mut Value, actual: &mut Value) {
    let expected_game = expected
        .get("game")
        .and_then(Value::as_str)
        .map(str::to_string);
    let actual_game = actual
        .get("game")
        .and_then(Value::as_str)
        .map(str::to_string);
    for value in [expected, actual] {
        normalize_operator_proof_status_value(
            value,
            expected_game.as_deref(),
            actual_game.as_deref(),
        );
    }
}

fn normalize_operator_proof_status_value(
    value: &mut Value,
    expected_game: Option<&str>,
    actual_game: Option<&str>,
) {
    match value {
        Value::Object(object) => {
            if object.contains_key("modified_at_unix_seconds") {
                object.insert(
                    "modified_at_unix_seconds".to_string(),
                    Value::String("<normalized-mtime>".to_string()),
                );
            }
            if object.contains_key("age_seconds") {
                object.insert(
                    "age_seconds".to_string(),
                    Value::String("<normalized-age>".to_string()),
                );
            }
            if let Some(Value::Object(metadata)) = object.get_mut("trusted_metadata") {
                if metadata.get("game_id").and_then(Value::as_str).is_some() {
                    metadata.insert(
                        "game_id".to_string(),
                        Value::String("<normalized-artifact-game>".to_string()),
                    );
                }
            }
            for nested in object.values_mut() {
                normalize_operator_proof_status_value(nested, expected_game, actual_game);
            }
        }
        Value::Array(items) => {
            for item in items {
                normalize_operator_proof_status_value(item, expected_game, actual_game);
            }
        }
        Value::String(text) => {
            if let Some(game) = expected_game {
                if !game.is_empty() {
                    *text = text.replace(game, "<normalized-game>");
                }
            }
            if let Some(game) = actual_game {
                if !game.is_empty() {
                    *text = text.replace(game, "<normalized-game>");
                }
            }
        }
        _ => {}
    }
}

fn operator_proof_status_audit_projection(status: &Value) -> Value {
    let mut root = serde_json::Map::new();
    root.insert(
        "contract_version".to_string(),
        status
            .get("contract_version")
            .cloned()
            .unwrap_or(Value::Null),
    );
    root.insert(
        "game".to_string(),
        status.get("game").cloned().unwrap_or(Value::Null),
    );
    root.insert(
        "summary".to_string(),
        status.get("summary").cloned().unwrap_or(Value::Null),
    );
    let mut rows = serde_json::Map::new();
    if let Some(families) = status.get("families").and_then(Value::as_array) {
        for family in families {
            if let Some(runs) = family.get("runs").and_then(Value::as_array) {
                for run in runs {
                    let Some(id) = run.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    let mut row = serde_json::Map::new();
                    row.insert(
                        "command".to_string(),
                        run.get("command").cloned().unwrap_or(Value::Null),
                    );
                    row.insert(
                        "artifact".to_string(),
                        project_operator_proof_status_artifact(run.get("artifact")),
                    );
                    rows.insert(id.to_string(), Value::Object(row));
                }
            }
        }
    }
    root.insert("rows".to_string(), Value::Object(rows));
    Value::Object(root)
}

fn project_operator_proof_status_artifact(artifact: Option<&Value>) -> Value {
    let Some(artifact) = artifact else {
        return Value::Null;
    };
    if artifact.is_null() {
        return Value::Null;
    }
    let mut projected = serde_json::Map::new();
    for field in [
        "path",
        "state",
        "reported_path",
        "artifact_version",
        "expected_version",
        "freshness_max_age_seconds",
        "expected_path",
        "actual_path",
        "reported_expected_path",
        "reported_actual_path",
        "diff_count",
        "trusted_metadata",
    ] {
        if let Some(value) = artifact.get(field) {
            projected.insert(field.to_string(), value.clone());
        }
    }
    Value::Object(projected)
}

fn diff_values(
    path: &str,
    expected: &Value,
    actual: &Value,
    diffs: &mut Vec<OperatorProofRunStatusDiff>,
) {
    match (expected, actual) {
        (Value::Object(expected), Value::Object(actual)) => {
            let keys: BTreeSet<_> = expected.keys().chain(actual.keys()).collect();
            for key in keys {
                let child_path = json_path_child(path, key);
                match (expected.get(key), actual.get(key)) {
                    (Some(expected), Some(actual)) => {
                        diff_values(&child_path, expected, actual, diffs);
                    }
                    (Some(expected), None) => diffs.push(OperatorProofRunStatusDiff {
                        path: child_path,
                        expected: expected.clone(),
                        actual: Value::Null,
                    }),
                    (None, Some(actual)) => diffs.push(OperatorProofRunStatusDiff {
                        path: child_path,
                        expected: Value::Null,
                        actual: actual.clone(),
                    }),
                    (None, None) => {}
                }
            }
        }
        (Value::Array(expected), Value::Array(actual)) => {
            let max = expected.len().max(actual.len());
            for index in 0..max {
                let child_path = format!("{path}[{index}]");
                match (expected.get(index), actual.get(index)) {
                    (Some(expected), Some(actual)) => {
                        diff_values(&child_path, expected, actual, diffs);
                    }
                    (Some(expected), None) => diffs.push(OperatorProofRunStatusDiff {
                        path: child_path,
                        expected: expected.clone(),
                        actual: Value::Null,
                    }),
                    (None, Some(actual)) => diffs.push(OperatorProofRunStatusDiff {
                        path: child_path,
                        expected: Value::Null,
                        actual: actual.clone(),
                    }),
                    (None, None) => {}
                }
            }
        }
        _ if expected != actual => diffs.push(OperatorProofRunStatusDiff {
            path: path.to_string(),
            expected: expected.clone(),
            actual: actual.clone(),
        }),
        _ => {}
    }
}

fn json_path_child(parent: &str, key: &str) -> String {
    if is_json_path_identifier(key) {
        format!("{parent}.{key}")
    } else {
        format!("{parent}[{}]", serde_json::to_string(key).unwrap())
    }
}

fn is_json_path_identifier(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == '_')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

pub fn proof_run_command_placeholders(template: &str) -> Vec<String> {
    let mut placeholders = Vec::new();
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        rest = &rest[open + 1..];
        let Some(close) = rest.find('}') else {
            placeholders.push(rest.to_string());
            break;
        };
        placeholders.push(rest[..close].to_string());
        rest = &rest[close + 1..];
    }
    placeholders
}

pub fn proof_run_command_placeholder_errors(template: &str) -> Vec<String> {
    let mut errors = Vec::new();
    let mut rest = template;
    while !rest.is_empty() {
        let next_open = rest.find('{');
        let next_close = rest.find('}');
        match (next_open, next_close) {
            (None, None) => break,
            (None, Some(_)) => {
                errors.push("unmatched closing brace".to_string());
                break;
            }
            (Some(open), Some(close)) if close < open => {
                errors.push("unmatched closing brace".to_string());
                rest = &rest[close + 1..];
            }
            (Some(open), _) => {
                rest = &rest[open + 1..];
                let Some(close) = rest.find('}') else {
                    errors.push("unclosed placeholder".to_string());
                    break;
                };
                let placeholder = &rest[..close];
                if placeholder.is_empty() {
                    errors.push("empty placeholder".to_string());
                }
                if placeholder.contains('{') {
                    errors.push(format!("nested placeholder in {{{placeholder}}}"));
                }
                if !matches!(placeholder, "database_url" | "game") {
                    errors.push(format!("unknown placeholder {{{placeholder}}}"));
                }
                rest = &rest[close + 1..];
            }
        }
    }
    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashSet, env, fs, path::Path, process::Command as ProcessCommand};

    const COMMANDS_PIPELINE_RS: &str = include_str!("../tests/pipeline.rs");
    const ENGINE_AND_PACKS_MD: &str = include_str!("../../../docs/arch/09-engine-and-packs.md");
    const ENGINE_PORT_CHECKLIST_MD: &str =
        include_str!("../../../docs/arch/11-engine-port-checklist.md");

    #[test]
    fn proof_run_manifest_test_selectors_exist_in_commands_pipeline() {
        let manifest = proof_run_manifest();
        assert_eq!(manifest.version, 1);
        assert!(
            manifest.artifact_freshness_max_age_seconds > 0,
            "artifact freshness ceiling should be positive"
        );
        assert!(
            !manifest.families.is_empty(),
            "proof-run manifest should expose at least one family"
        );

        let mut selector_count = 0;
        let mut ids = HashSet::new();
        for family in &manifest.families {
            assert!(!family.heading.trim().is_empty(), "family heading required");
            assert!(
                !family.runs.is_empty(),
                "family {} should list at least one run",
                family.heading
            );
            for run in &family.runs {
                assert!(!run.id.trim().is_empty(), "run id required");
                assert!(
                    run.id
                        .chars()
                        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-'),
                    "proof-run id {} must use lowercase ascii, digits, and hyphens only",
                    run.id
                );
                assert!(
                    ids.insert(run.id.clone()),
                    "duplicate proof-run id {}",
                    run.id
                );
                assert!(!run.family.trim().is_empty(), "run family required");
                assert!(!run.scope.trim().is_empty(), "run scope required");
                assert!(
                    !run.command_template.trim().is_empty(),
                    "run command template required for {}",
                    run.family
                );
                assert!(
                    matches!(run.scope.as_str(), "Game-specific" | "Local-only"),
                    "unknown proof-run scope {} for {}",
                    run.scope,
                    run.family
                );
                let placeholders = proof_run_command_placeholders(&run.command_template);
                let placeholder_errors =
                    proof_run_command_placeholder_errors(&run.command_template);
                assert!(
                    placeholder_errors.is_empty(),
                    "invalid command template placeholders for {}: {}",
                    run.family,
                    placeholder_errors.join(", ")
                );
                if run.scope == "Game-specific" {
                    assert!(
                        placeholders.iter().any(|placeholder| placeholder == "game"),
                        "game-specific proof run {} must include {{game}}",
                        run.family
                    );
                } else {
                    assert!(
                        !placeholders.iter().any(|placeholder| placeholder == "game"),
                        "local-only proof run {} must not include {{game}}",
                        run.family
                    );
                }
                if run.command_template.contains(" cargo test ") {
                    assert!(
                        run.test_selector.is_some(),
                        "cargo test proof run {} must declare test_selector",
                        run.family
                    );
                }
                assert!(
                    !run.proof_boundary.trim().is_empty(),
                    "proof boundary required for {}",
                    run.family
                );
                if let Some(artifact_path) = &run.artifact_path {
                    assert_eq!(
                        run.scope, "Local-only",
                        "artifact path should only be listed for local-only proof runs"
                    );
                    assert!(
                        !artifact_path.contains('{') && !artifact_path.contains('}'),
                        "artifact path for {} must not contain placeholders",
                        run.family
                    );
                    assert!(
                        !FsPath::new(artifact_path).is_absolute(),
                        "artifact path for {} must be workspace-relative",
                        run.family
                    );
                    assert!(
                        run.command_template.contains(artifact_path),
                        "command template for {} must write listed artifact path",
                        run.family
                    );
                    assert_proof_run_artifact_doc_truth(run, artifact_path, &manifest);
                }
                if let Some(selector) = &run.test_selector {
                    selector_count += 1;
                    assert!(
                        run.command_template.contains(selector),
                        "command template should contain selector {selector}"
                    );
                    let async_fn = format!("async fn {selector}(");
                    assert!(
                        COMMANDS_PIPELINE_RS.contains(&async_fn),
                        "proof-run selector {selector} must exist in crates/commands/tests/pipeline.rs"
                    );
                }
            }
        }

        assert!(
            selector_count >= 1,
            "manifest should validate at least one cargo test selector"
        );
    }

    fn assert_proof_run_artifact_doc_truth(
        run: &ProofRunSpec,
        artifact_path: &str,
        manifest: &ProofRunManifest,
    ) {
        let rendered_command = render_proof_run_command(
            &run.command_template,
            Uuid::from_u128(0),
            &manifest.database_url_example,
        );
        for (doc_name, doc) in [
            ("docs/arch/09-engine-and-packs.md", ENGINE_AND_PACKS_MD),
            (
                "docs/arch/11-engine-port-checklist.md",
                ENGINE_PORT_CHECKLIST_MD,
            ),
        ] {
            assert!(
                doc.contains(&run.id),
                "{doc_name} should mention proof-run id {}",
                run.id
            );
            assert!(
                doc.contains(artifact_path),
                "{doc_name} should mention artifact path {artifact_path}"
            );
            assert!(
                normalized_contains(doc, &rendered_command),
                "{doc_name} should mention rendered command {rendered_command}"
            );
            assert!(
                normalized_contains(doc, &run.proof_boundary),
                "{doc_name} should mention proof boundary for {}",
                run.id
            );
            assert!(
                doc.contains("artifact state `trusted`"),
                "{doc_name} should record current trusted artifact state"
            );
            assert!(
                doc.contains("production.trusted = 13")
                    && doc.contains("production.non_trusted = 0"),
                "{doc_name} should record production artifact go/no-go counts"
            );
        }
    }

    fn normalized_contains(haystack: &str, needle: &str) -> bool {
        let normalize = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");
        normalize(haystack).contains(&normalize(needle))
    }

    #[derive(Default)]
    struct ContractArtifactCounts {
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

    impl ContractArtifactCounts {
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
                other => panic!("unknown artifact state {other}"),
            }
        }

        fn non_trusted(&self) -> u64 {
            self.total_artifact_rows.saturating_sub(self.trusted)
        }
    }

    fn assert_operator_proof_run_status_contract(status: &serde_json::Value) {
        assert_eq!(
            status["contract_version"].as_u64(),
            Some(PROOF_RUN_STATUS_CONTRACT_VERSION as u64),
            "status contract version should be explicit"
        );
        assert!(status["game"].as_str().is_some(), "game should be string");
        assert!(
            status["manifest_version"].as_u64().is_some(),
            "manifest_version should be numeric"
        );
        assert_eq!(status["execution"], "local-only command copy");

        let families = status["families"].as_array().expect("families array");
        let mut production = ContractArtifactCounts::default();
        let mut fixtures = ContractArtifactCounts::default();
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
                assert_eq!(
                    row["fixture"].as_bool(),
                    Some(family_fixture),
                    "row fixture flag should match family"
                );
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
                        assert_artifact_u64(artifact, "modified_at_unix_seconds");
                        assert_artifact_u64(artifact, "age_seconds");
                        assert_artifact_u64(artifact, "freshness_max_age_seconds");
                        if let Some(metadata) = artifact.get("trusted_metadata") {
                            let metadata = metadata.as_object().expect("trusted metadata object");
                            assert!(!metadata.is_empty(), "trusted metadata should not be empty");
                            assert_optional_metadata_string(metadata, "game_id");
                            for field in [
                                "manifest_version",
                                "resolve_elapsed_ms",
                                "threshold_ms",
                                "trace_row_count",
                                "projection_table_count",
                                "resolution_phase_count",
                                "family_count",
                                "seed_count",
                                "expected_family_count",
                                "expected_seed_count",
                                "case_count",
                                "expected_case_count",
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
                            assert_artifact_u64(artifact, "artifact_version");
                            assert_artifact_u64(artifact, "expected_version");
                            assert!(
                                artifact["expected_path"].as_str().is_some(),
                                "trusted audit report should expose expected_path"
                            );
                            assert!(
                                artifact["actual_path"].as_str().is_some(),
                                "trusted audit report should expose actual_path"
                            );
                            assert_artifact_u64(artifact, "diff_count");
                        }
                        assert!(artifact.get("reported_path").is_none());
                    }
                    "stale" => {
                        assert_artifact_u64(artifact, "modified_at_unix_seconds");
                        assert_artifact_u64(artifact, "age_seconds");
                        assert_artifact_u64(artifact, "freshness_max_age_seconds");
                        assert!(artifact.get("trusted_metadata").is_none());
                    }
                    "path_mismatch" => {
                        assert!(
                            artifact["reported_path"].as_str().is_some(),
                            "path mismatch should expose reported_path"
                        );
                        assert!(artifact.get("trusted_metadata").is_none());
                    }
                    "version_mismatch" => {
                        assert_artifact_u64(artifact, "artifact_version");
                        assert_artifact_u64(artifact, "expected_version");
                        assert!(artifact.get("trusted_metadata").is_none());
                    }
                    "input_mismatch" => {
                        assert!(
                            artifact["expected_path"].as_str().is_some(),
                            "input mismatch should expose expected_path"
                        );
                        assert!(
                            artifact["actual_path"].as_str().is_some(),
                            "input mismatch should expose actual_path"
                        );
                        assert!(
                            artifact["reported_expected_path"].as_str().is_some(),
                            "input mismatch should expose reported_expected_path"
                        );
                        assert!(
                            artifact["reported_actual_path"].as_str().is_some(),
                            "input mismatch should expose reported_actual_path"
                        );
                        assert!(artifact.get("trusted_metadata").is_none());
                    }
                    "drifted" => {
                        assert_artifact_u64(artifact, "diff_count");
                        assert_artifact_u64(artifact, "modified_at_unix_seconds");
                        assert_artifact_u64(artifact, "age_seconds");
                        assert_artifact_u64(artifact, "freshness_max_age_seconds");
                        assert!(artifact.get("trusted_metadata").is_none());
                    }
                    "missing" | "malformed" => {
                        assert!(artifact.get("trusted_metadata").is_none());
                    }
                    other => panic!("unknown artifact state {other}"),
                }
            }
        }
        assert_status_summary_counts(status, "production", &production);
        assert_status_summary_counts(status, "fixtures", &fixtures);
    }

    fn assert_artifact_u64(artifact: &serde_json::Value, field: &str) {
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

    fn assert_status_summary_counts(
        status: &serde_json::Value,
        scope: &str,
        expected: &ContractArtifactCounts,
    ) {
        let summary = &status["summary"][scope];
        let fields = [
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
        ];
        for (field, value) in fields {
            assert_eq!(
                summary[field].as_u64(),
                Some(value),
                "{scope}.{field} should match row-derived counts"
            );
        }
    }

    fn contract_status_row(
        id: &str,
        fixture: bool,
        artifact: OperatorProofRunArtifactStatus,
    ) -> OperatorProofRunStatusRow {
        OperatorProofRunStatusRow {
            id: id.to_string(),
            row_id: proof_run_row_id(id),
            family: if fixture { "Fixture" } else { "Production" }.to_string(),
            scope: "Local-only".to_string(),
            fixture,
            command: format!("run {id}"),
            artifact: Some(artifact),
            proof_boundary: format!("proof boundary for {id}"),
        }
    }

    #[test]
    fn proof_run_status_contract_covers_version_summary_rows_and_artifact_states() {
        let trusted_game = Uuid::from_u128(88);
        let production_rows = vec![
            contract_status_row(
                "trusted-artifact",
                false,
                proof_run_artifact_status(
                    "target/trusted.json",
                    ProofRunArtifactState::Present {
                        game_id: trusted_game,
                        manifest_version: 1,
                        normalized_match: Some(true),
                        freshness: ProofRunArtifactFreshness {
                            modified_at_unix_seconds: 20,
                            age_seconds: 3,
                            max_age_seconds: 86_400,
                        },
                    },
                ),
            ),
            contract_status_row(
                "missing-artifact",
                false,
                proof_run_artifact_status("target/missing.json", ProofRunArtifactState::Missing),
            ),
        ];
        let fixture_rows = vec![
            contract_status_row(
                "malformed-artifact",
                true,
                proof_run_artifact_status(
                    "target/malformed.json",
                    ProofRunArtifactState::Malformed,
                ),
            ),
            contract_status_row(
                "stale-artifact",
                true,
                proof_run_artifact_status(
                    "target/stale.json",
                    ProofRunArtifactState::Stale {
                        freshness: ProofRunArtifactFreshness {
                            modified_at_unix_seconds: 1,
                            age_seconds: 86_401,
                            max_age_seconds: 86_400,
                        },
                    },
                ),
            ),
            contract_status_row(
                "path-mismatch-artifact",
                true,
                proof_run_artifact_status(
                    "target/path-mismatch.json",
                    ProofRunArtifactState::PathMismatch {
                        reported_path: "target/other.json".to_string(),
                    },
                ),
            ),
            contract_status_row(
                "version-mismatch-artifact",
                true,
                proof_run_artifact_status(
                    "target/version-mismatch.json",
                    ProofRunArtifactState::VersionMismatch {
                        artifact_manifest_version: 2,
                        expected_manifest_version: 1,
                    },
                ),
            ),
            contract_status_row(
                "input-mismatch-artifact",
                true,
                proof_run_artifact_status(
                    "target/input-mismatch.json",
                    ProofRunArtifactState::InputMismatch {
                        expected_expected_path: "expected-snapshot.json".to_string(),
                        expected_actual_path: "expected-current.json".to_string(),
                        reported_expected_path: "other-snapshot.json".to_string(),
                        reported_actual_path: "other-current.json".to_string(),
                    },
                ),
            ),
            contract_status_row(
                "drifted-artifact",
                true,
                proof_run_artifact_status(
                    "target/drifted.json",
                    ProofRunArtifactState::Drifted {
                        diff_count: 2,
                        freshness: ProofRunArtifactFreshness {
                            modified_at_unix_seconds: 30,
                            age_seconds: 4,
                            max_age_seconds: 86_400,
                        },
                    },
                ),
            ),
        ];
        let families = vec![
            OperatorProofRunStatusFamily {
                heading: "Production".to_string(),
                fixture: false,
                runs: production_rows,
            },
            OperatorProofRunStatusFamily {
                heading: "Fixture".to_string(),
                fixture: true,
                runs: fixture_rows,
            },
        ];
        let summary = proof_run_summary(&families);
        let status = serde_json::to_value(OperatorProofRunStatus {
            contract_version: PROOF_RUN_STATUS_CONTRACT_VERSION,
            game: Uuid::from_u128(99),
            manifest_version: 1,
            execution: "local-only command copy",
            summary,
            families,
        })
        .unwrap();

        assert_operator_proof_run_status_contract(&status);
    }

    #[test]
    fn proof_run_artifact_status_exposes_metadata_only_when_trusted() {
        let path_mismatch = serde_json::to_value(proof_run_artifact_status(
            "target/report.json",
            ProofRunArtifactState::PathMismatch {
                reported_path: "target/other.json".to_string(),
            },
        ))
        .unwrap();
        assert_eq!(path_mismatch["state"], "path_mismatch");
        assert_eq!(path_mismatch["reported_path"], "target/other.json");
        assert!(path_mismatch.get("trusted_metadata").is_none());

        let version_mismatch = serde_json::to_value(proof_run_artifact_status(
            "target/report.json",
            ProofRunArtifactState::VersionMismatch {
                artifact_manifest_version: 2,
                expected_manifest_version: 1,
            },
        ))
        .unwrap();
        assert_eq!(version_mismatch["state"], "version_mismatch");
        assert_eq!(version_mismatch["artifact_version"], 2);
        assert_eq!(version_mismatch["expected_version"], 1);
        assert!(version_mismatch.get("trusted_metadata").is_none());

        let stale = serde_json::to_value(proof_run_artifact_status(
            "target/report.json",
            ProofRunArtifactState::Stale {
                freshness: ProofRunArtifactFreshness {
                    modified_at_unix_seconds: 10,
                    age_seconds: 86_401,
                    max_age_seconds: 86_400,
                },
            },
        ))
        .unwrap();
        assert_eq!(stale["state"], "stale");
        assert_eq!(stale["modified_at_unix_seconds"], 10);
        assert_eq!(stale["age_seconds"], 86401);
        assert_eq!(stale["freshness_max_age_seconds"], 86400);
        assert!(stale.get("trusted_metadata").is_none());

        let trusted_game = Uuid::from_u128(88);
        let trusted = serde_json::to_value(proof_run_artifact_status(
            "target/report.json",
            ProofRunArtifactState::Present {
                game_id: trusted_game,
                manifest_version: 1,
                normalized_match: Some(true),
                freshness: ProofRunArtifactFreshness {
                    modified_at_unix_seconds: 20,
                    age_seconds: 3,
                    max_age_seconds: 86_400,
                },
            },
        ))
        .unwrap();
        assert_eq!(trusted["state"], "trusted");
        assert_eq!(
            trusted["trusted_metadata"]["game_id"],
            trusted_game.to_string()
        );
        assert_eq!(trusted["trusted_metadata"]["manifest_version"], 1);
        assert_eq!(
            trusted["trusted_metadata"]["retention_comparison_normalized_match"],
            true
        );
        assert_eq!(trusted["modified_at_unix_seconds"], 20);
        assert_eq!(trusted["age_seconds"], 3);
        assert_eq!(trusted["freshness_max_age_seconds"], 86400);
        assert!(trusted.get("reported_path").is_none());
        assert!(trusted.get("artifact_version").is_none());

        let command_projection_game = Uuid::from_u128(89);
        let command_projection = serde_json::to_value(proof_run_artifact_status(
            "target/command-projection.json",
            ProofRunArtifactState::CommandProjectionResolutionReportPresent {
                artifact_version: COMMAND_PROJECTION_RESOLUTION_REPORT_ARTIFACT_VERSION,
                game_id: command_projection_game,
                table_count: 26,
                phase_count: 1,
                diff_count: 0,
                freshness: ProofRunArtifactFreshness {
                    modified_at_unix_seconds: 21,
                    age_seconds: 2,
                    max_age_seconds: 86_400,
                },
            },
        ))
        .unwrap();
        assert_eq!(command_projection["state"], "trusted");
        assert_eq!(command_projection["artifact_version"], 1);
        assert_eq!(command_projection["expected_version"], 1);
        assert_eq!(command_projection["diff_count"], 0);
        assert_eq!(
            command_projection["trusted_metadata"]["game_id"],
            command_projection_game.to_string()
        );
        assert_eq!(
            command_projection["trusted_metadata"]["projection_table_count"],
            26
        );
        assert_eq!(
            command_projection["trusted_metadata"]["resolution_phase_count"],
            1
        );

        let large_action_game = Uuid::from_u128(99);
        let large_action = serde_json::to_value(proof_run_artifact_status(
            "target/large-action.json",
            ProofRunArtifactState::LargeActionGraphPerformanceReportPresent {
                artifact_version: LARGE_ACTION_GRAPH_PERFORMANCE_REPORT_ARTIFACT_VERSION,
                game_id: large_action_game,
                resolve_elapsed_ms: 321,
                threshold_ms: 20_000,
                trace_row_count: 72,
                phase_trace_anchored: true,
                decision_trace_anchored: true,
                freshness: ProofRunArtifactFreshness {
                    modified_at_unix_seconds: 21,
                    age_seconds: 2,
                    max_age_seconds: 86_400,
                },
            },
        ))
        .unwrap();
        assert_eq!(large_action["state"], "trusted");
        assert_eq!(
            large_action["trusted_metadata"]["game_id"],
            large_action_game.to_string()
        );
        assert_eq!(large_action["trusted_metadata"]["resolve_elapsed_ms"], 321);
        assert_eq!(large_action["trusted_metadata"]["threshold_ms"], 20000);
        assert_eq!(large_action["trusted_metadata"]["trace_row_count"], 72);
        assert_eq!(
            large_action["trusted_metadata"]["phase_trace_anchored"],
            true
        );
        assert_eq!(
            large_action["trusted_metadata"]["decision_trace_anchored"],
            true
        );

        let determinism = serde_json::to_value(proof_run_artifact_status(
            "target/determinism.json",
            ProofRunArtifactState::DeterminismFuzzReportPresent {
                artifact_version: DETERMINISM_FUZZ_REPORT_ARTIFACT_VERSION,
                family_count: 12,
                seed_count: 57,
                expected_family_count: 12,
                expected_seed_count: 57,
                family_manifest_matched: true,
                freshness: ProofRunArtifactFreshness {
                    modified_at_unix_seconds: 22,
                    age_seconds: 1,
                    max_age_seconds: 86_400,
                },
            },
        ))
        .unwrap();
        assert_eq!(determinism["state"], "trusted");
        assert_eq!(determinism["trusted_metadata"]["family_count"], 12);
        assert_eq!(determinism["trusted_metadata"]["seed_count"], 57);
        assert_eq!(determinism["trusted_metadata"]["expected_family_count"], 12);
        assert_eq!(determinism["trusted_metadata"]["expected_seed_count"], 57);
        assert_eq!(
            determinism["trusted_metadata"]["family_manifest_matched"],
            true
        );
        assert!(determinism["trusted_metadata"].get("game_id").is_none());

        let generated_matrix = serde_json::to_value(proof_run_artifact_status(
            "target/generated-shrink-matrix.json",
            ProofRunArtifactState::GeneratedShrinkMatrixReportPresent {
                artifact_version: GENERATED_SHRINK_MATRIX_REPORT_ARTIFACT_VERSION,
                family_count: GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT,
                case_count: GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT,
                expected_family_count: GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT,
                expected_case_count: GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT,
                family_manifest_matched: true,
                freshness: ProofRunArtifactFreshness {
                    modified_at_unix_seconds: 23,
                    age_seconds: 1,
                    max_age_seconds: 86_400,
                },
            },
        ))
        .unwrap();
        assert_eq!(generated_matrix["state"], "trusted");
        assert_eq!(
            generated_matrix["trusted_metadata"]["family_count"],
            GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT
        );
        assert_eq!(
            generated_matrix["trusted_metadata"]["case_count"],
            GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT
        );
        assert_eq!(
            generated_matrix["trusted_metadata"]["expected_family_count"],
            GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT
        );
        assert_eq!(
            generated_matrix["trusted_metadata"]["expected_case_count"],
            GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT
        );
        assert_eq!(
            generated_matrix["trusted_metadata"]["family_manifest_matched"],
            true
        );

        let gap_audit = serde_json::to_value(proof_run_artifact_status(
            "target/generated-shrink-gap-audit.json",
            ProofRunArtifactState::GeneratedShrinkGapAuditReportPresent {
                artifact_version: GENERATED_SHRINK_GAP_AUDIT_REPORT_ARTIFACT_VERSION,
                expected_family_count: GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT,
                manifest_family_count: GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT,
                expected_case_count: GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT,
                manifest_case_count: GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT,
                missing_family_count: 0,
                unexpected_family_count: 0,
                count_mismatch_count: 0,
                evidence_failure_count: 0,
                gap_audit_ok: true,
                freshness: ProofRunArtifactFreshness {
                    modified_at_unix_seconds: 24,
                    age_seconds: 1,
                    max_age_seconds: 86_400,
                },
            },
        ))
        .unwrap();
        assert_eq!(gap_audit["state"], "trusted");
        assert_eq!(
            gap_audit["trusted_metadata"]["expected_family_count"],
            GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT
        );
        assert_eq!(
            gap_audit["trusted_metadata"]["manifest_family_count"],
            GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT
        );
        assert_eq!(
            gap_audit["trusted_metadata"]["expected_case_count"],
            GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT
        );
        assert_eq!(
            gap_audit["trusted_metadata"]["manifest_case_count"],
            GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT
        );
        assert_eq!(gap_audit["trusted_metadata"]["missing_family_count"], 0);
        assert_eq!(gap_audit["trusted_metadata"]["unexpected_family_count"], 0);
        assert_eq!(gap_audit["trusted_metadata"]["count_mismatch_count"], 0);
        assert_eq!(gap_audit["trusted_metadata"]["evidence_failure_count"], 0);
        assert_eq!(gap_audit["trusted_metadata"]["gap_audit_ok"], true);
    }

    #[test]
    fn proof_run_summary_counts_production_and_fixture_artifacts_separately() {
        let production_row = OperatorProofRunStatusRow {
            id: "prod".to_string(),
            row_id: "proof-run-prod".to_string(),
            family: "Production".to_string(),
            scope: "Local-only".to_string(),
            fixture: false,
            command: "prod".to_string(),
            artifact: Some(proof_run_artifact_status(
                "target/prod.json",
                ProofRunArtifactState::Present {
                    game_id: Uuid::from_u128(1),
                    manifest_version: 1,
                    normalized_match: None,
                    freshness: ProofRunArtifactFreshness {
                        modified_at_unix_seconds: 20,
                        age_seconds: 3,
                        max_age_seconds: 86_400,
                    },
                },
            )),
            proof_boundary: "prod".to_string(),
        };
        let fixture_row = OperatorProofRunStatusRow {
            id: "fixture".to_string(),
            row_id: "proof-run-fixture".to_string(),
            family: "Fixture".to_string(),
            scope: "Local-only".to_string(),
            fixture: true,
            command: "fixture".to_string(),
            artifact: Some(proof_run_artifact_status(
                "target/fixture.json",
                ProofRunArtifactState::Stale {
                    freshness: ProofRunArtifactFreshness {
                        modified_at_unix_seconds: 1,
                        age_seconds: 86_401,
                        max_age_seconds: 86_400,
                    },
                },
            )),
            proof_boundary: "fixture".to_string(),
        };
        let summary = proof_run_summary(&[
            OperatorProofRunStatusFamily {
                heading: "Production".to_string(),
                fixture: false,
                runs: vec![production_row],
            },
            OperatorProofRunStatusFamily {
                heading: "Fixture".to_string(),
                fixture: true,
                runs: vec![fixture_row],
            },
        ]);

        assert_eq!(summary.production.total_artifact_rows, 1);
        assert_eq!(summary.production.trusted, 1);
        assert_eq!(summary.production.non_trusted, 0);
        assert_eq!(summary.fixtures.total_artifact_rows, 1);
        assert_eq!(summary.fixtures.stale, 1);
        assert_eq!(summary.fixtures.non_trusted, 1);
    }

    #[test]
    fn proof_run_go_no_go_report_fails_on_non_trusted_production_artifacts() {
        let production_row = contract_status_row(
            "prod-stale",
            false,
            proof_run_artifact_status(
                "target/prod-stale.json",
                ProofRunArtifactState::Stale {
                    freshness: ProofRunArtifactFreshness {
                        modified_at_unix_seconds: 1,
                        age_seconds: 86_401,
                        max_age_seconds: 86_400,
                    },
                },
            ),
        );
        let fixture_row = contract_status_row(
            "fixture-missing",
            true,
            proof_run_artifact_status(
                "target/fixture-missing.json",
                ProofRunArtifactState::Missing,
            ),
        );
        let families = vec![
            OperatorProofRunStatusFamily {
                heading: "Production".to_string(),
                fixture: false,
                runs: vec![production_row],
            },
            OperatorProofRunStatusFamily {
                heading: "Fixtures".to_string(),
                fixture: true,
                runs: vec![fixture_row],
            },
        ];
        let summary = proof_run_summary(&families);
        let report = build_operator_proof_run_go_no_go_report_from_status(
            OperatorProofRunStatus {
                contract_version: PROOF_RUN_STATUS_CONTRACT_VERSION,
                game: Uuid::from_u128(9),
                manifest_version: 1,
                execution: "local-only command copy",
                summary,
                families,
            },
            "target/go-no-go.json",
        );

        assert!(!report.ok);
        assert_eq!(report.production.non_trusted, 1);
        assert_eq!(report.fixtures.non_trusted, 1);
        assert!(report
            .rows
            .iter()
            .any(|row| row.row_id == "proof-run-prod-stale"
                && row.state == "stale"
                && row.command == "run prod-stale"));
    }

    #[test]
    fn proof_run_go_no_go_report_blocks_drifted_generated_shrink_gap_audit() {
        let production_row = contract_status_row(
            "operator-proof-generated-shrink-gap-audit",
            false,
            proof_run_artifact_status(
                "target/operator-proof/current-generated-shrink-gap-audit-report.json",
                ProofRunArtifactState::Drifted {
                    diff_count: 2,
                    freshness: ProofRunArtifactFreshness {
                        modified_at_unix_seconds: 1,
                        age_seconds: 4,
                        max_age_seconds: 86_400,
                    },
                },
            ),
        );
        let families = vec![OperatorProofRunStatusFamily {
            heading: "Production".to_string(),
            fixture: false,
            runs: vec![production_row],
        }];
        let summary = proof_run_summary(&families);
        let report = build_operator_proof_run_go_no_go_report_from_status(
            OperatorProofRunStatus {
                contract_version: PROOF_RUN_STATUS_CONTRACT_VERSION,
                game: Uuid::from_u128(9),
                manifest_version: 1,
                execution: "local-only command copy",
                summary,
                families,
            },
            "target/go-no-go.json",
        );

        assert!(!report.ok);
        assert_eq!(report.production.drifted, 1);
        assert_eq!(report.production.non_trusted, 1);
        let row = report
            .rows
            .iter()
            .find(|row| row.row_id == "proof-run-operator-proof-generated-shrink-gap-audit")
            .expect("gap-audit row present in go/no-go report");
        assert_eq!(row.state, "drifted");
        assert!(row.trusted_metadata.is_none());
    }

    #[test]
    fn proof_run_go_no_go_report_carries_trusted_artifact_metadata() {
        let production_row = contract_status_row(
            "determinism",
            false,
            proof_run_artifact_status(
                "target/determinism.json",
                ProofRunArtifactState::DeterminismFuzzReportPresent {
                    artifact_version: DETERMINISM_FUZZ_REPORT_ARTIFACT_VERSION,
                    family_count: 12,
                    seed_count: 57,
                    expected_family_count: 12,
                    expected_seed_count: 57,
                    family_manifest_matched: true,
                    freshness: ProofRunArtifactFreshness {
                        modified_at_unix_seconds: 1,
                        age_seconds: 4,
                        max_age_seconds: 86_400,
                    },
                },
            ),
        );
        let families = vec![OperatorProofRunStatusFamily {
            heading: "Production".to_string(),
            fixture: false,
            runs: vec![production_row],
        }];
        let summary = proof_run_summary(&families);
        let report = build_operator_proof_run_go_no_go_report_from_status(
            OperatorProofRunStatus {
                contract_version: PROOF_RUN_STATUS_CONTRACT_VERSION,
                game: Uuid::from_u128(9),
                manifest_version: 1,
                execution: "local-only command copy",
                summary,
                families,
            },
            "target/go-no-go.json",
        );

        assert!(report.ok);
        let metadata = report.rows[0]
            .trusted_metadata
            .as_ref()
            .expect("trusted metadata carried into go/no-go row");
        assert_eq!(metadata.family_count, Some(12));
        assert_eq!(metadata.seed_count, Some(57));
        assert_eq!(metadata.expected_family_count, Some(12));
        assert_eq!(metadata.expected_seed_count, Some(57));
        assert_eq!(metadata.family_manifest_matched, Some(true));
    }

    #[test]
    fn proof_run_go_no_go_retention_reports_regressions_and_recoveries() {
        let mut previous = OperatorProofRunGoNoGoReport {
            artifact_version: PROOF_RUN_GO_NO_GO_REPORT_ARTIFACT_VERSION,
            artifact_path: "previous.json".to_string(),
            ok: true,
            manifest_version: 1,
            production: OperatorProofRunArtifactCounts::default(),
            fixtures: OperatorProofRunArtifactCounts::default(),
            rows: vec![
                OperatorProofRunGoNoGoRow {
                    id: "prod-a".to_string(),
                    row_id: "proof-run-prod-a".to_string(),
                    family: "Prod A".to_string(),
                    scope: "Local-only".to_string(),
                    fixture: false,
                    command: "run prod-a".to_string(),
                    artifact_path: "target/prod-a.json".to_string(),
                    state: "trusted".to_string(),
                    trusted_metadata: None,
                },
                OperatorProofRunGoNoGoRow {
                    id: "prod-b".to_string(),
                    row_id: "proof-run-prod-b".to_string(),
                    family: "Prod B".to_string(),
                    scope: "Local-only".to_string(),
                    fixture: false,
                    command: "run prod-b".to_string(),
                    artifact_path: "target/prod-b.json".to_string(),
                    state: "missing".to_string(),
                    trusted_metadata: None,
                },
            ],
        };
        let mut latest = previous.clone();
        latest.rows[0].state = "stale".to_string();
        latest.rows[1].state = "trusted".to_string();
        latest.ok = false;
        previous.production.total_artifact_rows = 2;
        previous.production.trusted = 1;
        previous.production.missing = 1;
        previous.production.non_trusted = 1;
        latest.production.total_artifact_rows = 2;
        latest.production.trusted = 1;
        latest.production.stale = 1;
        latest.production.non_trusted = 1;

        let report = audit_operator_proof_run_go_no_go_retention(
            "previous.json",
            previous,
            "latest.json",
            latest,
            "retention.json",
        );

        assert!(!report.ok);
        assert_eq!(report.regressions.len(), 1);
        assert_eq!(report.regressions[0].row_id, "proof-run-prod-a");
        assert_eq!(report.regressions[0].previous_state, "trusted");
        assert_eq!(report.regressions[0].latest_state, "stale");
        assert_eq!(report.recoveries.len(), 1);
        assert_eq!(report.recoveries[0].row_id, "proof-run-prod-b");
    }

    #[test]
    fn projection_rebuild_report_summarizes_and_classifies() {
        let game = Uuid::from_u128(42);
        let report = build_operator_projection_rebuild_audit_report(
            "target/rebuild.json",
            projections::ProjectionAuditReport {
                game_id: game,
                ok: false,
                tables: vec![
                    projections::ProjectionAuditTable {
                        table: "slot_state".to_string(),
                        matches: true,
                        before_rows: 2,
                        rebuilt_rows: 2,
                        before: None,
                        rebuilt: None,
                    },
                    projections::ProjectionAuditTable {
                        table: "vote_ballot".to_string(),
                        matches: false,
                        before_rows: 1,
                        rebuilt_rows: 0,
                        before: Some(serde_json::json!([{"slot_id": "slot_1"}])),
                        rebuilt: Some(serde_json::json!([])),
                    },
                ],
            },
        );

        assert!(!report.ok);
        assert_eq!(report.game_id, game);
        assert_eq!(report.table_count, 2);
        assert_eq!(report.matched_table_count, 1);
        assert_eq!(report.drifted_table_count, 1);
        assert_eq!(report.tables[1].table, "vote_ballot");

        let dir = env::temp_dir().join(format!("fmarch-rebuild-report-{}", Uuid::new_v4()));
        let artifact = dir.join("rebuild.json");
        fs::create_dir_all(&dir).expect("artifact dir");
        let artifact_text = artifact.to_string_lossy().to_string();
        let mut trusted = report.clone();
        trusted.artifact_path = artifact_text.clone();
        trusted.ok = true;
        trusted.drifted_table_count = 0;
        trusted.matched_table_count = trusted.table_count;
        trusted.tables[1].matches = true;
        fs::write(&artifact, serde_json::to_vec_pretty(&trusted).unwrap())
            .expect("rebuild report write");

        match proof_run_projection_rebuild_audit_report_artifact_state_at(
            &artifact_text,
            1,
            86_400,
            SystemTime::now(),
        ) {
            ProofRunArtifactState::ProjectionRebuildAuditReportPresent {
                artifact_version,
                game_id,
                table_count,
                diff_count,
                freshness,
            } => {
                assert_eq!(
                    artifact_version,
                    PROJECTION_REBUILD_AUDIT_REPORT_ARTIFACT_VERSION
                );
                assert_eq!(game_id, game);
                assert_eq!(table_count, 2);
                assert_eq!(diff_count, 0);
                assert_eq!(freshness.max_age_seconds, 86_400);
            }
            other => panic!("expected trusted rebuild report, got {other:?}"),
        }

        trusted.ok = false;
        trusted.drifted_table_count = 1;
        fs::write(&artifact, serde_json::to_vec_pretty(&trusted).unwrap())
            .expect("drifted rebuild report write");
        assert!(matches!(
            proof_run_projection_rebuild_audit_report_artifact_state_at(
                &artifact_text,
                1,
                86_400,
                SystemTime::now(),
            ),
            ProofRunArtifactState::Drifted { diff_count: 1, .. }
        ));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn resolution_diff_report_summarizes_and_classifies() {
        let game = Uuid::from_u128(43);
        let report = build_operator_resolution_diff_report(
            "target/resolution-diff.json",
            crate::ResolutionEnvelopeAuditReport {
                game_id: game,
                ok: false,
                audited: 2,
                skipped: 1,
                summary: crate::ResolutionEnvelopeAuditSummary {
                    matched: 1,
                    drifted: 1,
                    skipped: 1,
                    first_drift_paths: vec![crate::ResolutionEnvelopeAuditDriftPath {
                        phase_id: "D01".to_string(),
                        run_id: "resolution:D01".to_string(),
                        envelope: crate::ResolutionEnvelopeAuditEnvelope::Applied,
                        path: "$.events[0]".to_string(),
                    }],
                },
                phases: vec![
                    crate::ResolutionEnvelopeAuditPhase {
                        phase_id: "N01".to_string(),
                        run_id: "resolution:N01".to_string(),
                        applied_stream_seq: 10,
                        trace_stream_seq: Some(11),
                        status: crate::ResolutionEnvelopeAuditStatus::Matched,
                        applied_matches: true,
                        trace_matches: true,
                        reason: None,
                        diffs: Vec::new(),
                        stored_applied: Some(serde_json::json!({"stream_seq": 10})),
                        rebuilt_applied: Some(serde_json::json!({"stream_seq": 100})),
                        stored_trace: None,
                        rebuilt_trace: None,
                    },
                    crate::ResolutionEnvelopeAuditPhase {
                        phase_id: "D01".to_string(),
                        run_id: "resolution:D01".to_string(),
                        applied_stream_seq: 12,
                        trace_stream_seq: Some(13),
                        status: crate::ResolutionEnvelopeAuditStatus::Drifted,
                        applied_matches: false,
                        trace_matches: true,
                        reason: Some("fixture drift".to_string()),
                        diffs: vec![crate::ResolutionEnvelopeAuditDiff {
                            envelope: crate::ResolutionEnvelopeAuditEnvelope::Applied,
                            path: "$.events[0]".to_string(),
                            expected: serde_json::json!("slot_1"),
                            actual: serde_json::json!("slot_2"),
                        }],
                        stored_applied: None,
                        rebuilt_applied: None,
                        stored_trace: None,
                        rebuilt_trace: None,
                    },
                ],
            },
        );

        assert!(!report.ok);
        assert_eq!(report.game_id, game);
        assert_eq!(report.audited_phase_count, 2);
        assert_eq!(report.matched_phase_count, 1);
        assert_eq!(report.drifted_phase_count, 1);
        assert_eq!(report.skipped_phase_count, 1);
        assert_eq!(report.diff_count, 1);
        assert_eq!(report.first_drift_paths[0].envelope, "applied");
        assert_eq!(report.phases[1].status, "drifted");
        assert_eq!(report.phases[1].diffs[0].path, "$.events[0]");

        let dir = env::temp_dir().join(format!("fmarch-resolution-diff-{}", Uuid::new_v4()));
        let artifact = dir.join("diff.json");
        fs::create_dir_all(&dir).expect("artifact dir");
        let artifact_text = artifact.to_string_lossy().to_string();
        let mut trusted = report.clone();
        trusted.artifact_path = artifact_text.clone();
        trusted.ok = true;
        trusted.matched_phase_count = trusted.audited_phase_count;
        trusted.drifted_phase_count = 0;
        trusted.diff_count = 0;
        trusted.first_drift_paths.clear();
        trusted.phases[1].status = "matched".to_string();
        trusted.phases[1].applied_matches = true;
        trusted.phases[1].diff_count = 0;
        trusted.phases[1].diffs.clear();
        fs::write(&artifact, serde_json::to_vec_pretty(&trusted).unwrap())
            .expect("resolution diff report write");

        match proof_run_resolution_diff_report_artifact_state_at(
            &artifact_text,
            1,
            86_400,
            SystemTime::now(),
        ) {
            ProofRunArtifactState::ResolutionDiffReportPresent {
                artifact_version,
                game_id,
                phase_count,
                diff_count,
                freshness,
            } => {
                assert_eq!(artifact_version, RESOLUTION_DIFF_REPORT_ARTIFACT_VERSION);
                assert_eq!(game_id, game);
                assert_eq!(phase_count, 2);
                assert_eq!(diff_count, 0);
                assert_eq!(freshness.max_age_seconds, 86_400);
            }
            other => panic!("expected trusted resolution diff report, got {other:?}"),
        }

        trusted.ok = false;
        trusted.drifted_phase_count = 1;
        trusted.diff_count = 1;
        fs::write(&artifact, serde_json::to_vec_pretty(&trusted).unwrap())
            .expect("drifted resolution diff report write");
        assert!(matches!(
            proof_run_resolution_diff_report_artifact_state_at(
                &artifact_text,
                1,
                86_400,
                SystemTime::now(),
            ),
            ProofRunArtifactState::Drifted { diff_count: 1, .. }
        ));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn trace_inspection_report_summarizes_and_classifies() {
        let game = Uuid::from_u128(44);
        let report = build_operator_trace_inspection_report(
            "target/trace-inspection.json",
            crate::ResolutionTraceInspectionReport {
                game_id: game,
                traces: vec![crate::ResolutionTraceInspectionRun {
                    phase_id: "N01".to_string(),
                    run_id: "resolution:N01".to_string(),
                    applied_stream_seq: Some(10),
                    trace_stream_seq: 11,
                    trace_version: 1,
                    decisions: vec![crate::ResolutionTraceDecisionRow {
                        row_index: 0,
                        applied_stream_seq: Some(10),
                        event_index: Some(0),
                        stage: "resolve".to_string(),
                        source: "event_index:0".to_string(),
                        outcome: "applied".to_string(),
                        detail: serde_json::json!({"target": "slot_1"}),
                    }],
                    edges: vec![crate::ResolutionTraceEdgeRow {
                        row_index: 0,
                        applied_stream_seq: Some(10),
                        from: "slot_1".to_string(),
                        to: "slot_2".to_string(),
                        kind: "redirect".to_string(),
                        detail: serde_json::json!({}),
                    }],
                    generated: vec![crate::ResolutionTraceGeneratedRow {
                        row_index: 0,
                        applied_stream_seq: Some(10),
                        action_id: "generated:1".to_string(),
                        source: "trigger".to_string(),
                        actor: "slot_1".to_string(),
                        targets: vec!["slot_2".to_string()],
                        detail: serde_json::json!({}),
                    }],
                    effect_changes: vec![crate::ResolutionTraceEffectChangeRow {
                        row_index: 0,
                        applied_stream_seq: Some(10),
                        effect: "dead".to_string(),
                        target: "slot_2".to_string(),
                        operation: "insert".to_string(),
                        detail: serde_json::json!({}),
                    }],
                    visibility: Vec::new(),
                    notes: vec![crate::ResolutionTraceNoteRow {
                        row_index: 0,
                        applied_stream_seq: Some(10),
                        note: "loop cap not reached".to_string(),
                    }],
                }],
            },
        );

        assert!(report.ok);
        assert_eq!(report.game_id, game);
        assert_eq!(report.trace_count, 1);
        assert_eq!(report.decision_count, 1);
        assert_eq!(report.edge_count, 1);
        assert_eq!(report.generated_count, 1);
        assert_eq!(report.effect_change_count, 1);
        assert_eq!(report.visibility_count, 0);
        assert_eq!(report.note_count, 1);
        assert_eq!(report.traces[0].decision_count, 1);
        assert_eq!(report.traces[0].notes[0]["note"], "loop cap not reached");

        let dir = env::temp_dir().join(format!("fmarch-trace-inspection-{}", Uuid::new_v4()));
        let artifact = dir.join("trace.json");
        fs::create_dir_all(&dir).expect("artifact dir");
        let artifact_text = artifact.to_string_lossy().to_string();
        let mut trusted = report.clone();
        trusted.artifact_path = artifact_text.clone();
        fs::write(&artifact, serde_json::to_vec_pretty(&trusted).unwrap())
            .expect("trace report write");

        match proof_run_trace_inspection_report_artifact_state_at(
            &artifact_text,
            1,
            86_400,
            SystemTime::now(),
        ) {
            ProofRunArtifactState::TraceInspectionReportPresent {
                artifact_version,
                game_id,
                trace_count,
                detail_count,
                freshness,
            } => {
                assert_eq!(artifact_version, TRACE_INSPECTION_REPORT_ARTIFACT_VERSION);
                assert_eq!(game_id, game);
                assert_eq!(trace_count, 1);
                assert_eq!(detail_count, 5);
                assert_eq!(freshness.max_age_seconds, 86_400);
            }
            other => panic!("expected trusted trace report, got {other:?}"),
        }

        trusted.ok = false;
        trusted.trace_count = 0;
        trusted.traces.clear();
        fs::write(&artifact, serde_json::to_vec_pretty(&trusted).unwrap())
            .expect("empty trace report write");
        assert!(matches!(
            proof_run_trace_inspection_report_artifact_state_at(
                &artifact_text,
                1,
                86_400,
                SystemTime::now(),
            ),
            ProofRunArtifactState::Drifted { diff_count: 1, .. }
        ));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn determinism_fuzz_report_summarizes_and_classifies() {
        let output = determinism_fuzz_family_specs()
            .iter()
            .map(|family| format!("test {} ... ok", family.selector))
            .collect::<Vec<_>>()
            .join("\n");
        let report = build_operator_determinism_fuzz_report(
            "target/determinism-fuzz.json",
            "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands --test pipeline replay_audit_and_rebuild_deterministically -- --nocapture",
            "replay_audit_and_rebuild_deterministically",
            1234,
            true,
            &output,
        );

        assert!(report.ok);
        assert_eq!(report.family_count, 12);
        assert_eq!(report.passed_family_count, 12);
        assert_eq!(report.failed_family_count, 0);
        assert_eq!(report.seed_count, 57);
        assert_eq!(report.expected_family_count, 12);
        assert_eq!(report.expected_seed_count, 57);
        assert!(report.family_manifest_matched);
        assert!(report.first_failing_seed.is_none());
        assert_eq!(report.families[0].id, "seeded-day-vote");
        assert_eq!(report.families[0].seeds, vec![101, 202, 303, 404, 505]);

        let dir = env::temp_dir().join(format!("fmarch-determinism-fuzz-{}", Uuid::new_v4()));
        let artifact = dir.join("determinism.json");
        fs::create_dir_all(&dir).expect("artifact dir");
        let artifact_text = artifact.to_string_lossy().to_string();
        let mut trusted = report.clone();
        trusted.artifact_path = artifact_text.clone();
        fs::write(&artifact, serde_json::to_vec_pretty(&trusted).unwrap())
            .expect("determinism fuzz report write");

        match proof_run_determinism_fuzz_report_artifact_state_at(
            &artifact_text,
            1,
            86_400,
            SystemTime::now(),
        ) {
            ProofRunArtifactState::DeterminismFuzzReportPresent {
                artifact_version,
                family_count,
                seed_count,
                expected_family_count,
                expected_seed_count,
                family_manifest_matched,
                freshness,
            } => {
                assert_eq!(artifact_version, DETERMINISM_FUZZ_REPORT_ARTIFACT_VERSION);
                assert_eq!(family_count, 12);
                assert_eq!(seed_count, 57);
                assert_eq!(expected_family_count, 12);
                assert_eq!(expected_seed_count, 57);
                assert!(family_manifest_matched);
                assert_eq!(freshness.max_age_seconds, 86_400);
            }
            other => panic!("expected trusted determinism fuzz report, got {other:?}"),
        }

        trusted.ok = false;
        trusted.failed_family_count = 1;
        trusted.passed_family_count = trusted.passed_family_count.saturating_sub(1);
        trusted.first_failing_seed = Some(7101);
        trusted.families[2].status = OperatorDeterminismFuzzFamilyStatus::Failed;
        trusted.families[2].first_failing_seed = Some(7101);
        fs::write(&artifact, serde_json::to_vec_pretty(&trusted).unwrap())
            .expect("failed determinism fuzz report write");
        assert!(matches!(
            proof_run_determinism_fuzz_report_artifact_state_at(
                &artifact_text,
                1,
                86_400,
                SystemTime::now(),
            ),
            ProofRunArtifactState::Drifted { diff_count, .. } if diff_count >= 1
        ));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn large_action_graph_performance_report_summarizes_and_classifies() {
        let game = Uuid::from_u128(45);
        let report = build_operator_large_action_graph_performance_report(
            "target/large-action-graph-performance.json",
            crate::LargeActionGraphPerformanceProof {
                game_id: game,
                pack: "mafiascum".to_string(),
                phase_id: "N01".to_string(),
                seed: crate::LARGE_ACTION_GRAPH_PERFORMANCE_SEED,
                resolve_seed: crate::LARGE_ACTION_GRAPH_PERFORMANCE_SEED + 41_000,
                roster_count: 40,
                submitted_action_count: 29,
                resolution_inner_event_count: 12,
                stream_event_count: 115,
                trace_row_count: 74,
                phase_trace_anchored: true,
                decision_trace_anchored: true,
                resolve_elapsed_ms: 321,
                threshold_ms: crate::LARGE_ACTION_GRAPH_PERFORMANCE_THRESHOLD_MS,
                replay_audit_ok: true,
                replay_audited: 1,
                replay_skipped: 0,
                projection_rebuild_ok: true,
                pgo_triggered: true,
                babysitter_death: true,
                hider_death: true,
                lovers_linked: true,
                ok: true,
            },
        );

        assert!(report.ok);
        assert_eq!(report.game_id, game);
        assert_eq!(report.pack, "mafiascum");
        assert_eq!(report.roster_count, 40);
        assert_eq!(report.submitted_action_count, 29);
        assert_eq!(report.resolve_elapsed_ms, 321);

        let dir = env::temp_dir().join(format!("fmarch-large-graph-{}", Uuid::new_v4()));
        let artifact = dir.join("performance.json");
        fs::create_dir_all(&dir).expect("artifact dir");
        let artifact_text = artifact.to_string_lossy().to_string();
        let mut trusted = report.clone();
        trusted.artifact_path = artifact_text.clone();
        fs::write(&artifact, serde_json::to_vec_pretty(&trusted).unwrap())
            .expect("large graph performance report write");

        match proof_run_large_action_graph_performance_report_artifact_state_at(
            &artifact_text,
            1,
            86_400,
            SystemTime::now(),
        ) {
            ProofRunArtifactState::LargeActionGraphPerformanceReportPresent {
                artifact_version,
                game_id,
                resolve_elapsed_ms,
                threshold_ms,
                trace_row_count,
                phase_trace_anchored,
                decision_trace_anchored,
                freshness,
            } => {
                assert_eq!(
                    artifact_version,
                    LARGE_ACTION_GRAPH_PERFORMANCE_REPORT_ARTIFACT_VERSION
                );
                assert_eq!(game_id, game);
                assert_eq!(resolve_elapsed_ms, 321);
                assert_eq!(
                    threshold_ms,
                    crate::LARGE_ACTION_GRAPH_PERFORMANCE_THRESHOLD_MS
                );
                assert_eq!(trace_row_count, 74);
                assert!(phase_trace_anchored);
                assert!(decision_trace_anchored);
                assert_eq!(freshness.max_age_seconds, 86_400);
            }
            other => panic!("expected trusted large graph performance report, got {other:?}"),
        }

        trusted.ok = false;
        trusted.resolve_elapsed_ms = trusted.threshold_ms + 1;
        fs::write(&artifact, serde_json::to_vec_pretty(&trusted).unwrap())
            .expect("regressed large graph performance report write");
        assert!(matches!(
            proof_run_large_action_graph_performance_report_artifact_state_at(
                &artifact_text,
                1,
                86_400,
                SystemTime::now(),
            ),
            ProofRunArtifactState::Drifted { diff_count, .. } if diff_count >= 1
        ));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn generated_shrink_matrix_report_classifies_trusted_and_drifted() {
        let dir = env::temp_dir().join(format!("fmarch-generated-shrink-{}", Uuid::new_v4()));
        let artifact = dir.join("generated-shrink-matrix.json");
        fs::create_dir_all(&dir).expect("artifact dir");
        let artifact_text = artifact.to_string_lossy().to_string();
        let mut trusted = generated_shrink_matrix_bootstrap_report(&artifact_text);
        fs::write(&artifact, serde_json::to_vec_pretty(&trusted).unwrap())
            .expect("generated shrink matrix report write");

        match proof_run_generated_shrink_matrix_report_artifact_state_at(
            &artifact_text,
            1,
            86_400,
            SystemTime::now(),
        ) {
            ProofRunArtifactState::GeneratedShrinkMatrixReportPresent {
                artifact_version,
                family_count,
                case_count,
                expected_family_count,
                expected_case_count,
                family_manifest_matched,
                freshness,
            } => {
                assert_eq!(
                    artifact_version,
                    GENERATED_SHRINK_MATRIX_REPORT_ARTIFACT_VERSION
                );
                assert_eq!(family_count, GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT);
                assert_eq!(case_count, GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT);
                assert_eq!(
                    expected_family_count,
                    GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT
                );
                assert_eq!(
                    expected_case_count,
                    GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT
                );
                assert!(family_manifest_matched);
                assert_eq!(freshness.max_age_seconds, 86_400);
            }
            other => panic!("expected trusted generated shrink matrix report, got {other:?}"),
        }

        trusted.ok = false;
        trusted.entries[0].bad_expectation.failure_class = "wrong_failure".to_string();
        fs::write(&artifact, serde_json::to_vec_pretty(&trusted).unwrap())
            .expect("drifted generated shrink matrix report write");
        assert!(matches!(
            proof_run_generated_shrink_matrix_report_artifact_state_at(
                &artifact_text,
                1,
                86_400,
                SystemTime::now(),
            ),
            ProofRunArtifactState::Drifted { diff_count, .. } if diff_count >= 1
        ));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn generated_shrink_gap_audit_report_classifies_trusted_and_drifted() {
        let dir = env::temp_dir().join(format!("fmarch-generated-gap-{}", Uuid::new_v4()));
        let artifact = dir.join("generated-shrink-gap-audit.json");
        fs::create_dir_all(&dir).expect("artifact dir");
        let artifact_text = artifact.to_string_lossy().to_string();
        let mut trusted = generated_shrink_gap_audit_bootstrap_report(&artifact_text);
        fs::write(&artifact, serde_json::to_vec_pretty(&trusted).unwrap())
            .expect("generated shrink gap audit report write");

        match proof_run_generated_shrink_gap_audit_report_artifact_state_at(
            &artifact_text,
            1,
            86_400,
            SystemTime::now(),
        ) {
            ProofRunArtifactState::GeneratedShrinkGapAuditReportPresent {
                artifact_version,
                expected_family_count,
                manifest_family_count,
                expected_case_count,
                manifest_case_count,
                missing_family_count,
                unexpected_family_count,
                count_mismatch_count,
                evidence_failure_count,
                gap_audit_ok,
                freshness,
            } => {
                assert_eq!(
                    artifact_version,
                    GENERATED_SHRINK_GAP_AUDIT_REPORT_ARTIFACT_VERSION
                );
                assert_eq!(
                    expected_family_count,
                    GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT
                );
                assert_eq!(
                    manifest_family_count,
                    GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT
                );
                assert_eq!(
                    expected_case_count,
                    GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT
                );
                assert_eq!(
                    manifest_case_count,
                    GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT
                );
                assert_eq!(missing_family_count, 0);
                assert_eq!(unexpected_family_count, 0);
                assert_eq!(count_mismatch_count, 0);
                assert_eq!(evidence_failure_count, 0);
                assert!(gap_audit_ok);
                assert_eq!(freshness.max_age_seconds, 86_400);
            }
            other => panic!("expected trusted generated shrink gap audit report, got {other:?}"),
        }

        trusted.ok = false;
        trusted
            .missing_families
            .push("hider_projection_state".to_string());
        fs::write(&artifact, serde_json::to_vec_pretty(&trusted).unwrap())
            .expect("drifted generated shrink gap audit report write");
        assert!(matches!(
            proof_run_generated_shrink_gap_audit_report_artifact_state_at(
                &artifact_text,
                1,
                86_400,
                SystemTime::now(),
            ),
            ProofRunArtifactState::Drifted { diff_count, .. } if diff_count >= 2
        ));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn proof_run_artifact_state_classifies_local_artifacts() {
        let dir = env::temp_dir().join(format!("fmarch-proof-page-{}", Uuid::new_v4()));
        let artifact = dir.join("report.json");
        let malformed = dir.join("malformed.json");
        let artifact_text = artifact.to_string_lossy().to_string();
        let malformed_text = malformed.to_string_lossy().to_string();
        let now = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(100_000);

        assert_eq!(
            proof_run_artifact_state_at(&artifact_text, 1, 86_400, now),
            ProofRunArtifactState::Missing
        );

        fs::create_dir_all(&dir).expect("artifact dir");
        fs::write(&malformed, "{").expect("malformed artifact file");
        assert_eq!(
            proof_run_artifact_state_at(&malformed_text, 1, 86_400, now),
            ProofRunArtifactState::Malformed
        );

        let artifact_game = Uuid::from_u128(77);
        fs::write(
            &artifact,
            serde_json::json!({
                "game_id": artifact_game,
                "manifest_version": 1,
                "artifact_path": "wrong-path.json"
            })
            .to_string(),
        )
        .expect("path-mismatch artifact file");
        assert_eq!(
            proof_run_artifact_state_at(&artifact_text, 1, 86_400, now),
            ProofRunArtifactState::PathMismatch {
                reported_path: "wrong-path.json".to_string()
            }
        );

        fs::write(
            &artifact,
            serde_json::json!({
                "game_id": artifact_game,
                "manifest_version": 2,
                "artifact_path": artifact_text,
            })
            .to_string(),
        )
        .expect("version-mismatch artifact file");
        assert_eq!(
            proof_run_artifact_state_at(&artifact_text, 1, 86_400, now),
            ProofRunArtifactState::VersionMismatch {
                artifact_manifest_version: 2,
                expected_manifest_version: 1,
            }
        );

        fs::write(
            &artifact,
            serde_json::json!({
                "game_id": artifact_game,
                "manifest_version": 1,
                "artifact_path": artifact_text,
                "retention_comparison": {"normalized_match": true}
            })
            .to_string(),
        )
        .expect("artifact file");
        match proof_run_artifact_state_at(&artifact_text, 1, 86_400, SystemTime::now()) {
            ProofRunArtifactState::Present {
                game_id,
                manifest_version,
                normalized_match,
                freshness,
            } => {
                assert_eq!(game_id, artifact_game);
                assert_eq!(manifest_version, 1);
                assert_eq!(normalized_match, Some(true));
                assert_eq!(freshness.max_age_seconds, 86_400);
            }
            other => panic!("expected present artifact, got {other:?}"),
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn proof_run_status_audit_matches_saved_artifact_provenance_snapshot() {
        ensure_operator_proof_status_snapshot_artifacts();
        let expected: Value = serde_json::from_str(include_str!(
            "../fixtures/operator-proof-status-artifact-provenance.snapshot.json"
        ))
        .expect("snapshot parses");
        let actual = serde_json::to_value(build_operator_proof_run_status(
            Uuid::from_u128(0),
            Some(OperatorProofRunFixture::ArtifactProvenance),
        ))
        .expect("status serializes");

        let report = audit_operator_proof_status_values("snapshot", expected, "fresh", actual);

        assert!(report.ok, "unexpected status diffs: {:?}", report.diffs);
        assert!(report.diffs.is_empty());
    }

    #[test]
    fn proof_run_status_audit_reports_row_addressed_drift_paths() {
        ensure_operator_proof_status_snapshot_artifacts();
        let expected: Value = serde_json::from_str(include_str!(
            "../fixtures/operator-proof-status-artifact-provenance.snapshot.json"
        ))
        .expect("snapshot parses");
        let mut actual = serde_json::to_value(build_operator_proof_run_status(
            Uuid::from_u128(0),
            Some(OperatorProofRunFixture::ArtifactProvenance),
        ))
        .expect("status serializes");
        let run = actual["families"]
            .as_array_mut()
            .expect("families")
            .iter_mut()
            .flat_map(|family| family["runs"].as_array_mut().expect("runs"))
            .find(|run| run["id"] == "checked-game-specific-audit-bundle")
            .expect("checked bundle run");
        run["artifact"]["state"] = Value::String("missing".to_string());

        let report = audit_operator_proof_status_values("snapshot", expected, "fresh", actual);

        assert!(!report.ok);
        assert!(
            report.diffs.iter().any(|diff| {
                diff.path == "$.rows[\"checked-game-specific-audit-bundle\"].artifact.state"
                    && diff.expected == Value::String("trusted".to_string())
                    && diff.actual == Value::String("missing".to_string())
            }),
            "expected row-addressed state drift, got {:?}",
            report.diffs
        );
    }

    fn ensure_operator_proof_status_snapshot_artifacts() {
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
            write_workspace_json(artifact, report);
        }

        let malformed =
            workspace_path("target/operator-proof/malformed-artifact-metadata-guard.json");
        fs::create_dir_all(malformed.parent().unwrap()).expect("malformed parent");
        fs::write(malformed, "{").expect("malformed artifact");

        let missing =
            workspace_path("target/operator-proof/missing-artifact-provenance-guard.json");
        let _ = fs::remove_file(missing);

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
        write_workspace_json(
            "target/operator-proof/generated-shrink-gap-audit-drift-guard.json",
            serde_json::to_value(generated_shrink_gap_audit_drift_guard_report(
                "target/operator-proof/generated-shrink-gap-audit-drift-guard.json",
            ))
            .expect("generated shrink gap-audit drift guard serializes"),
        );

        write_workspace_json(
            "target/operator-proof/current-status-audit-report.json",
            serde_json::json!({
                "artifact_version": PROOF_RUN_STATUS_AUDIT_REPORT_ARTIFACT_VERSION,
                "artifact_path": "target/operator-proof/current-status-audit-report.json",
                "ok": true,
                "expected_path": "crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json",
                "actual_path": "target/operator-proof/current-status-audit-check.json",
                "normalized_fields": [
                    "$.game",
                    "$.families[*].runs[*].command.{game}",
                    "$.families[*].runs[*].artifact.modified_at_unix_seconds",
                    "$.families[*].runs[*].artifact.age_seconds",
                    "$.families[*].runs[*].artifact.trusted_metadata.game_id"
                ],
                "diffs": []
            }),
        );
        write_workspace_json(
            "target/operator-proof/current-artifact-go-no-go-report.json",
            serde_json::json!({
                "artifact_version": PROOF_RUN_GO_NO_GO_REPORT_ARTIFACT_VERSION,
                "artifact_path": "target/operator-proof/current-artifact-go-no-go-report.json",
                "ok": true,
                "manifest_version": 1,
                "production": {
                    "total_artifact_rows": 3,
                    "trusted": 3,
                    "stale": 0,
                    "missing": 0,
                    "malformed": 0,
                    "path_mismatch": 0,
                    "version_mismatch": 0,
                    "input_mismatch": 0,
                    "drifted": 0,
                    "non_trusted": 0
                },
                "fixtures": {
                    "total_artifact_rows": 6,
                    "trusted": 0,
                    "stale": 1,
                    "missing": 1,
                    "malformed": 1,
                    "path_mismatch": 1,
                    "version_mismatch": 1,
                    "input_mismatch": 0,
                    "drifted": 1,
                    "non_trusted": 6
                },
                "rows": []
            }),
        );
        write_workspace_json(
            "target/operator-proof/current-artifact-retention-report.json",
            serde_json::json!({
                "artifact_version": PROOF_RUN_GO_NO_GO_RETENTION_REPORT_ARTIFACT_VERSION,
                "artifact_path": "target/operator-proof/current-artifact-retention-report.json",
                "ok": true,
                "previous_path": "target/operator-proof/previous-artifact-go-no-go-report.json",
                "latest_path": "target/operator-proof/current-artifact-go-no-go-report.json",
                "normalized_fields": [
                    "$.production.*",
                    "$.fixtures.*",
                    "$.rows[*].state"
                ],
                "regressions": [],
                "recoveries": []
            }),
        );
        write_workspace_json(
            "target/operator-proof/current-projection-rebuild-report.json",
            serde_json::json!({
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
            }),
        );
        write_workspace_json(
            "target/operator-proof/current-resolution-diff-report.json",
            serde_json::json!({
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
            }),
        );
        write_workspace_json(
            "target/operator-proof/current-command-projection-resolution-report.json",
            serde_json::json!({
                "artifact_version": COMMAND_PROJECTION_RESOLUTION_REPORT_ARTIFACT_VERSION,
                "artifact_path": "target/operator-proof/current-command-projection-resolution-report.json",
                "ok": true,
                "game_id": "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
                "fixture_path": "crates/commands/fixtures/night-passing.json",
                "pack": "mafiascum",
                "phase": "N01",
                "resolve_seed": 1,
                "proof_boundary": "test fixture",
                "projection_rebuild": {
                    "artifact_version": PROJECTION_REBUILD_AUDIT_REPORT_ARTIFACT_VERSION,
                    "artifact_path": "target/operator-proof/current-command-projection-resolution-report.json",
                    "ok": true,
                    "game_id": "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
                    "isolation": "rollback-only transaction",
                    "table_count": 26,
                    "matched_table_count": 26,
                    "drifted_table_count": 0,
                    "tables": []
                },
                "resolution_diff": {
                    "artifact_version": RESOLUTION_DIFF_REPORT_ARTIFACT_VERSION,
                    "artifact_path": "target/operator-proof/current-command-projection-resolution-report.json",
                    "ok": true,
                    "game_id": "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
                    "normalized_fields": [],
                    "audited_phase_count": 1,
                    "matched_phase_count": 1,
                    "drifted_phase_count": 0,
                    "skipped_phase_count": 0,
                    "diff_count": 0,
                    "first_drift_paths": [],
                    "phases": []
                }
            }),
        );
        write_workspace_json(
            "target/operator-proof/current-trace-inspection-report.json",
            serde_json::json!({
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
            }),
        );
        write_workspace_json(
            "target/operator-proof/current-large-action-graph-performance-report.json",
            serde_json::json!({
                "artifact_version": LARGE_ACTION_GRAPH_PERFORMANCE_REPORT_ARTIFACT_VERSION,
                "artifact_path": "target/operator-proof/current-large-action-graph-performance-report.json",
                "ok": true,
                "game_id": "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
                "pack": "mafiascum",
                "phase_id": "N01",
                "seed": crate::LARGE_ACTION_GRAPH_PERFORMANCE_SEED,
                "resolve_seed": crate::LARGE_ACTION_GRAPH_PERFORMANCE_SEED + 41000,
                "roster_count": 40,
                "submitted_action_count": 29,
                "resolution_inner_event_count": 12,
                "stream_event_count": 115,
                "trace_row_count": 74,
                "phase_trace_anchored": true,
                "decision_trace_anchored": true,
                "resolve_elapsed_ms": 321,
                "threshold_ms": crate::LARGE_ACTION_GRAPH_PERFORMANCE_THRESHOLD_MS,
                "replay_audit_ok": true,
                "replay_audited": 1,
                "replay_skipped": 0,
                "projection_rebuild_ok": true,
                "pgo_triggered": true,
                "babysitter_death": true,
                "hider_death": true,
                "lovers_linked": true
            }),
        );
        write_workspace_json(
            "target/operator-proof/current-determinism-fuzz-report.json",
            serde_json::to_value(determinism_fuzz_bootstrap_report(
                "target/operator-proof/current-determinism-fuzz-report.json",
            ))
            .expect("determinism fuzz report serializes"),
        );
        write_workspace_json(
            "target/operator-proof/current-generated-shrink-matrix-report.tmp.json",
            serde_json::to_value(generated_shrink_matrix_bootstrap_report(
                "target/operator-proof/current-generated-shrink-matrix-report.tmp.json",
            ))
            .expect("generated shrink matrix report serializes"),
        );
        write_workspace_json(
            "target/operator-proof/current-generated-shrink-gap-audit-report.json",
            serde_json::to_value(generated_shrink_gap_audit_bootstrap_report(
                "target/operator-proof/current-generated-shrink-gap-audit-report.json",
            ))
            .expect("generated shrink gap audit report serializes"),
        );
    }

    fn determinism_fuzz_bootstrap_report(artifact_path: &str) -> OperatorDeterminismFuzzReport {
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

    fn generated_shrink_gap_audit_bootstrap_report(
        artifact_path: &str,
    ) -> OperatorGeneratedShrinkGapAuditReport {
        OperatorGeneratedShrinkGapAuditReport {
            artifact_version: GENERATED_SHRINK_GAP_AUDIT_REPORT_ARTIFACT_VERSION,
            artifact_path: artifact_path.to_string(),
            ok: true,
            expected_family_count: GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT,
            manifest_family_count: GENERATED_SHRINK_MATRIX_EXPECTED_FAMILY_COUNT,
            expected_case_count: GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT,
            manifest_case_count: GENERATED_SHRINK_MATRIX_EXPECTED_CASE_COUNT,
            missing_families: Vec::new(),
            unexpected_families: Vec::new(),
            count_mismatches: Vec::new(),
            evidence_failures: Vec::new(),
        }
    }

    fn generated_shrink_gap_audit_drift_guard_report(
        artifact_path: &str,
    ) -> OperatorGeneratedShrinkGapAuditReport {
        let mut report = generated_shrink_gap_audit_bootstrap_report(artifact_path);
        report.ok = false;
        report
            .missing_families
            .push("hider_projection_state".to_string());
        report
    }

    fn write_operator_provenance_fixture(path: &str, reported_path: &str, manifest_version: u16) {
        write_workspace_json(
            path,
            serde_json::json!({
                "ok": true,
                "manifest_version": manifest_version,
                "game_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "artifact_path": reported_path,
                "runs": []
            }),
        );
    }

    fn write_workspace_json(path: &str, value: Value) {
        let path = workspace_path(path);
        fs::create_dir_all(path.parent().unwrap()).expect("artifact parent");
        fs::write(path, serde_json::to_vec_pretty(&value).unwrap()).expect("artifact write");
    }

    fn make_operator_artifact_stale(path: &str) {
        let status = ProcessCommand::new("touch")
            .args(["-t", "200001010000"])
            .arg(workspace_path(path))
            .status()
            .expect("touch stale artifact");
        assert!(status.success(), "touch stale artifact should succeed");
    }

    fn workspace_path(path: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(path)
    }
}
