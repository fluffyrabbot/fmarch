import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const databaseUrl = process.env.DATABASE_URL;
const host = "127.0.0.1";
const port = process.env.FMARCH_BROWSER_SMOKE_PORT
  ? Number(process.env.FMARCH_BROWSER_SMOKE_PORT)
  : await freePort();
const baseUrl = `http://${host}:${port}`;
const artifactDir = path.join(root, "target", "operator-browser-smoke");
const proofArtifacts = [
  "target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json",
  "target/operator-proof/game-specific-audit-bundle-20260613T001500Z.json",
];
const missingProofArtifact =
  "target/operator-proof/missing-artifact-provenance-guard.json";
const malformedProofArtifact =
  "target/operator-proof/malformed-artifact-metadata-guard.json";
const staleProofArtifact =
  "target/operator-proof/stale-artifact-provenance-guard.json";
const pathMismatchProofArtifact =
  "target/operator-proof/path-mismatch-artifact-provenance-guard.json";
const versionMismatchProofArtifact =
  "target/operator-proof/version-mismatch-artifact-provenance-guard.json";
const statusAuditExport =
  "target/operator-proof/current-status-audit-check.json";
const statusAuditReport =
  "target/operator-proof/current-status-audit-report.json";
const goNoGoReport =
  "target/operator-proof/current-artifact-go-no-go-report.json";
const previousGoNoGoReport =
  "target/operator-proof/previous-artifact-go-no-go-report.json";
const retentionReport =
  "target/operator-proof/current-artifact-retention-report.json";
const rebuildReport =
  "target/operator-proof/current-projection-rebuild-report.json";
const resolutionDiffReport =
  "target/operator-proof/current-resolution-diff-report.json";
const traceInspectionReport =
  "target/operator-proof/current-trace-inspection-report.json";
const largeActionGraphPerformanceReport =
  "target/operator-proof/current-large-action-graph-performance-report.json";
const determinismFuzzReport =
  "target/operator-proof/current-determinism-fuzz-report.json";
const generatedShrinkMatrixReport =
  "target/operator-proof/current-generated-shrink-matrix-report.tmp.json";
const proofRunSelectors = await proofRunAnchorSelectors();
const checkedAuditGame = "08d8a45f-6c3b-4401-8e31-8d7637f36a82";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required, e.g. postgres://fmarch:fmarch@localhost:5544/fmarch");
}

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("FMARCH_BROWSER_SMOKE_PORT must be a TCP port number");
}

const game = crypto.randomUUID();
let commandId = 1;

const pages = [
  {
    name: "operator-index",
    path: `/games/${game}/operator?principal_user_id=host_h`,
    checks: [
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
  },
  {
    name: "operator-proof-runs",
    path: `/games/${game}/operator/proof-runs?principal_user_id=host_h&fixture=artifact-provenance`,
    checks: [
      "Operator Proof-Run Index",
      "Local-Only Regression Lanes",
      "Operator Proof Fixtures",
      "PRODUCTION ARTIFACTS",
      "trusted 12 / 12; non_trusted 0",
      "FIXTURE ARTIFACTS",
      "trusted 0 / 5; non_trusted 5",
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
      generatedShrinkMatrixReport,
      "target/operator-proof/missing-artifact-provenance-guard.json",
      "artifact not present locally",
      "target/operator-proof/malformed-artifact-metadata-guard.json",
      "target/operator-proof/stale-artifact-provenance-guard.json",
      "artifact stale",
      "target/operator-proof/path-mismatch-artifact-provenance-guard.json",
      "artifact path mismatch",
      "reported_path: target/operator-proof/wrong-artifact-provenance-guard.json",
      "target/operator-proof/version-mismatch-artifact-provenance-guard.json",
      "artifact manifest version incompatible",
      "artifact_version: 2",
      "expected_version: 1",
      "game_id: 08d8a45f-6c3b-4401-8e31-8d7637f36a82",
      "game_id: 3e3cccc1-c837-46d3-b0d6-1b83ae0cc82b",
      "manifest_version: 1",
      "retention_comparison.normalized_match: true",
      "artifact metadata unreadable",
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
    selectors: [
      ...proofRunSelectors,
      "#proof-run-missing-artifact-provenance-guard",
      "#proof-run-malformed-artifact-metadata-guard",
      "#proof-run-stale-artifact-provenance-guard",
      "#proof-run-path-mismatch-artifact-provenance-guard",
      "#proof-run-version-mismatch-artifact-provenance-guard",
    ],
    rowChecks: [
      {
        selector: "#proof-run-missing-artifact-provenance-guard",
        required: [
          "target/operator-proof/missing-artifact-provenance-guard.json",
          "artifact not present locally",
        ],
        forbidden: [
          "game_id:",
          "manifest_version:",
          "retention_comparison.normalized_match:",
        ],
      },
      {
        selector: "#proof-run-malformed-artifact-metadata-guard",
        required: [
          "target/operator-proof/malformed-artifact-metadata-guard.json",
          "artifact metadata unreadable",
        ],
        forbidden: [
          "game_id:",
          "manifest_version:",
          "retention_comparison.normalized_match:",
        ],
      },
      {
        selector: "#proof-run-stale-artifact-provenance-guard",
        required: [
          "target/operator-proof/stale-artifact-provenance-guard.json",
          "artifact stale",
          "modified_at_unix_seconds:",
          "age_seconds:",
          "freshness_max_age_seconds: 86400",
        ],
        forbidden: [
          "game_id:",
          "manifest_version:",
          "retention_comparison.normalized_match:",
        ],
      },
      {
        selector: "#proof-run-path-mismatch-artifact-provenance-guard",
        required: [
          "target/operator-proof/path-mismatch-artifact-provenance-guard.json",
          "artifact path mismatch",
          "reported_path: target/operator-proof/wrong-artifact-provenance-guard.json",
        ],
        forbidden: [
          "game_id:",
          "manifest_version:",
          "retention_comparison.normalized_match:",
        ],
      },
      {
        selector: "#proof-run-version-mismatch-artifact-provenance-guard",
        required: [
          "target/operator-proof/version-mismatch-artifact-provenance-guard.json",
          "artifact manifest version incompatible",
          "artifact_version: 2",
          "expected_version: 1",
        ],
        forbidden: [
          "game_id:",
          "manifest_version:",
          "retention_comparison.normalized_match:",
        ],
      },
    ],
  },
  {
    name: "projection-audit",
    path: `/games/${game}/projection-audit/view?principal_user_id=host_h`,
    checks: ["Projection Rebuild Audit", "matched"],
  },
  {
    name: "resolution-audit",
    path: `/games/${game}/resolution-audit/view?principal_user_id=host_h`,
    checks: ["Resolution Replay Audit", "D01"],
  },
  {
    name: "resolution-traces",
    path: `/games/${game}/resolution-traces/view?principal_user_id=host_h`,
    checks: [
      "Resolution Trace Inspection",
      "D01",
      "Decisions",
      "Redirect Edges",
      "JSON detail",
    ],
  },
  {
    name: "host-phase-control",
    path: `/games/${game}/host-phase-controls/view?principal_user_id=host_h`,
    checks: ["Host Phase-Control Audit", "D01:skip_next_day:slot_1"],
  },
  {
    name: "operator-proof-status-audit",
    path: `/games/${game}/operator/proof-runs/status-audit/view?principal_user_id=host_h`,
    checks: [
      "Operator Proof-Run Status Audit",
      "matched",
      "No status audit drift.",
      "Report Artifact",
      "artifact_version: 1",
      "diff_count: 0",
      "$.families[*].runs[*].artifact.age_seconds",
      "target/operator-proof/current-status-audit-check.json",
      "target/operator-proof/current-status-audit-report.json",
    ],
  },
  {
    name: "operator-proof-status-audit-drift",
    path: `/games/${game}/operator/proof-runs/status-audit/view?principal_user_id=host_h&fixture=artifact-state-drift`,
    checks: [
      "Operator Proof-Run Status Audit",
      "drifted",
      "checked-game-specific-audit-bundle",
      "artifact.state",
      "\"trusted\"",
      "\"missing\"",
      "artifact drifted",
      "diff_count: 1",
    ],
  },
  {
    name: "operator-proof-status-audit-malformed-report",
    path: `/games/${game}/operator/proof-runs/status-audit/view?principal_user_id=host_h&fixture=saved-report-malformed`,
    checks: ["Operator Proof-Run Status Audit", "artifact metadata unreadable"],
  },
  {
    name: "operator-proof-status-audit-stale-report",
    path: `/games/${game}/operator/proof-runs/status-audit/view?principal_user_id=host_h&fixture=saved-report-stale`,
    checks: ["Operator Proof-Run Status Audit", "artifact stale"],
  },
  {
    name: "operator-proof-status-audit-drifted-report",
    path: `/games/${game}/operator/proof-runs/status-audit/view?principal_user_id=host_h&fixture=saved-report-drifted`,
    checks: ["Operator Proof-Run Status Audit", "artifact drifted"],
  },
  {
    name: "operator-proof-go-no-go",
    path: `/games/${game}/operator/proof-runs/go-no-go/view?principal_user_id=host_h`,
    checks: [
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
      "case_count: 16",
      "expected_case_count: 16",
      "audit_operator_proof_artifacts",
    ],
  },
  {
    name: "operator-proof-retention",
    path: `/games/${game}/operator/proof-runs/retention/view?principal_user_id=host_h`,
    checks: [
      "Operator Proof Artifact Retention",
      "matched",
      "target/operator-proof/current-artifact-retention-report.json",
      "target/operator-proof/previous-artifact-go-no-go-report.json",
      "target/operator-proof/current-artifact-go-no-go-report.json",
    ],
  },
  {
    name: "operator-proof-retention-newly-missing",
    path: `/games/${game}/operator/proof-runs/retention/view?principal_user_id=host_h&fixture=newly-missing-artifact`,
    checks: ["Operator Proof Artifact Retention", "regressed", "newly-missing-artifact", "missing"],
  },
  {
    name: "operator-proof-retention-stale",
    path: `/games/${game}/operator/proof-runs/retention/view?principal_user_id=host_h&fixture=stale-previously-trusted`,
    checks: ["Operator Proof Artifact Retention", "regressed", "stale-previously-trusted", "stale"],
  },
  {
    name: "operator-proof-retention-recovered",
    path: `/games/${game}/operator/proof-runs/retention/view?principal_user_id=host_h&fixture=recovered-artifact`,
    checks: ["Operator Proof Artifact Retention", "matched", "recovered-artifact", "trusted"],
  },
  {
    name: "operator-proof-projection-rebuild",
    path: `/games/${game}/operator/proof-runs/projection-rebuild/view?principal_user_id=host_h`,
    checks: [
      "Operator Projection Rebuild Report",
      "matched",
      "target/operator-proof/current-projection-rebuild-report.json",
      "rollback-only transaction",
      "slot_state",
    ],
  },
  {
    name: "operator-proof-projection-rebuild-missing",
    path: `/games/${game}/operator/proof-runs/projection-rebuild/view?principal_user_id=host_h&fixture=missing-report`,
    checks: ["Operator Projection Rebuild Report", "missing-report", "missing", "No table rows."],
  },
  {
    name: "operator-proof-projection-rebuild-stale",
    path: `/games/${game}/operator/proof-runs/projection-rebuild/view?principal_user_id=host_h&fixture=stale-report`,
    checks: ["Operator Projection Rebuild Report", "stale-report", "stale"],
  },
  {
    name: "operator-proof-projection-rebuild-drifted",
    path: `/games/${game}/operator/proof-runs/projection-rebuild/view?principal_user_id=host_h&fixture=drifted-report`,
    checks: ["Operator Projection Rebuild Report", "drifted-report", "drifted", "slot_state"],
  },
  {
    name: "operator-proof-projection-rebuild-recovered",
    path: `/games/${game}/operator/proof-runs/projection-rebuild/view?principal_user_id=host_h&fixture=recovered-report`,
    checks: ["Operator Projection Rebuild Report", "recovered-report", "trusted"],
  },
  {
    name: "operator-proof-resolution-diff",
    path: `/games/${game}/operator/proof-runs/resolution-diff/view?principal_user_id=host_h`,
    checks: [
      "Operator Resolution Diff Report",
      "matched",
      "target/operator-proof/current-resolution-diff-report.json",
      "N01",
    ],
  },
  {
    name: "operator-proof-resolution-diff-missing",
    path: `/games/${game}/operator/proof-runs/resolution-diff/view?principal_user_id=host_h&fixture=missing-report`,
    checks: ["Operator Resolution Diff Report", "missing-report", "missing", "No phase rows."],
  },
  {
    name: "operator-proof-resolution-diff-stale",
    path: `/games/${game}/operator/proof-runs/resolution-diff/view?principal_user_id=host_h&fixture=stale-report`,
    checks: ["Operator Resolution Diff Report", "stale-report", "stale"],
  },
  {
    name: "operator-proof-resolution-diff-drifted",
    path: `/games/${game}/operator/proof-runs/resolution-diff/view?principal_user_id=host_h&fixture=drifted-report`,
    checks: ["Operator Resolution Diff Report", "drifted-report", "drifted", "$.winner"],
  },
  {
    name: "operator-proof-resolution-diff-matched",
    path: `/games/${game}/operator/proof-runs/resolution-diff/view?principal_user_id=host_h&fixture=matched-report`,
    checks: ["Operator Resolution Diff Report", "matched-report", "trusted"],
  },
  {
    name: "operator-proof-trace-inspection",
    path: `/games/${game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h`,
    checks: [
      "Operator Trace Inspection Report",
      "available",
      "target/operator-proof/current-trace-inspection-report.json",
      "N01",
    ],
  },
  {
    name: "operator-proof-trace-inspection-missing",
    path: `/games/${game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h&fixture=missing-report`,
    checks: ["Operator Trace Inspection Report", "missing-report", "missing", "No trace rows."],
  },
  {
    name: "operator-proof-trace-inspection-stale",
    path: `/games/${game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h&fixture=stale-report`,
    checks: ["Operator Trace Inspection Report", "stale-report", "stale"],
  },
  {
    name: "operator-proof-trace-inspection-malformed",
    path: `/games/${game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h&fixture=malformed-report`,
    checks: ["Operator Trace Inspection Report", "malformed-report", "malformed"],
  },
  {
    name: "operator-proof-trace-inspection-filtered",
    path: `/games/${game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h&fixture=filtered-run`,
    checks: ["Operator Trace Inspection Report", "filtered-run", "trusted", "filtered:run"],
  },
  {
    name: "operator-proof-trace-inspection-empty",
    path: `/games/${game}/operator/proof-runs/trace-inspection/view?principal_user_id=host_h&fixture=empty-trace`,
    checks: ["Operator Trace Inspection Report", "empty-trace", "drifted", "No trace rows."],
  },
  {
    name: "operator-proof-large-action-graph-performance",
    path: `/games/${game}/operator/proof-runs/large-action-graph-performance/view?principal_user_id=host_h`,
    checks: [
      "Operator Large Action Graph Performance Report",
      "within ceiling",
      largeActionGraphPerformanceReport,
      "Projection rebuild",
    ],
  },
  {
    name: "operator-proof-large-action-graph-performance-missing",
    path: `/games/${game}/operator/proof-runs/large-action-graph-performance/view?principal_user_id=host_h&fixture=missing-report`,
    checks: ["Operator Large Action Graph Performance Report", "missing-report", "missing"],
  },
  {
    name: "operator-proof-large-action-graph-performance-stale",
    path: `/games/${game}/operator/proof-runs/large-action-graph-performance/view?principal_user_id=host_h&fixture=stale-report`,
    checks: ["Operator Large Action Graph Performance Report", "stale-report", "stale"],
  },
  {
    name: "operator-proof-large-action-graph-performance-regressed",
    path: `/games/${game}/operator/proof-runs/large-action-graph-performance/view?principal_user_id=host_h&fixture=threshold-regressed`,
    checks: ["Operator Large Action Graph Performance Report", "threshold-regressed", "drifted", "regressed"],
  },
  {
    name: "operator-proof-large-action-graph-performance-recovered",
    path: `/games/${game}/operator/proof-runs/large-action-graph-performance/view?principal_user_id=host_h&fixture=recovered-report`,
    checks: ["Operator Large Action Graph Performance Report", "recovered-report", "trusted"],
  },
  {
    name: "operator-proof-determinism-fuzz",
    path: `/games/${game}/operator/proof-runs/determinism-fuzz/view?principal_user_id=host_h`,
    checks: [
      "Operator Determinism Fuzz Report",
      "passed",
      determinismFuzzReport,
      "generated_default_open_day_replay_audit_and_rebuild_deterministically",
    ],
  },
  {
    name: "operator-proof-determinism-fuzz-failed",
    path: `/games/${game}/operator/proof-runs/determinism-fuzz/view?principal_user_id=host_h&fixture=failed-seed`,
    checks: ["Operator Determinism Fuzz Report", "failed-seed", "drifted", "FIRST FAILING SEED"],
  },
  {
    name: "operator-proof-go-no-go-missing",
    path: `/games/${game}/operator/proof-runs/go-no-go/view?principal_user_id=host_h&fixture=missing-production-artifact`,
    checks: ["Operator Proof Artifact Go/No-Go", "no-go", "missing", "non_trusted 1"],
  },
  {
    name: "operator-proof-go-no-go-stale",
    path: `/games/${game}/operator/proof-runs/go-no-go/view?principal_user_id=host_h&fixture=stale-production-artifact`,
    checks: ["Operator Proof Artifact Go/No-Go", "no-go", "stale", "non_trusted 1"],
  },
  {
    name: "operator-proof-go-no-go-drifted",
    path: `/games/${game}/operator/proof-runs/go-no-go/view?principal_user_id=host_h&fixture=drifted-production-artifact`,
    checks: ["Operator Proof Artifact Go/No-Go", "no-go", "drifted", "non_trusted 1"],
  },
];

const jsonPages = [
  {
    name: "operator-proof-run-status",
    path: `/games/${game}/operator/proof-runs/status?principal_user_id=host_h&fixture=artifact-provenance`,
    contractVersion: 1,
    summary: {
      production: {
        total_artifact_rows: 12,
        trusted: 12,
        non_trusted: 0,
      },
      fixtures: {
        total_artifact_rows: 5,
        trusted: 0,
        non_trusted: 5,
      },
    },
    rows: [
      {
        row_id: "proof-run-checked-game-specific-audit-bundle",
        state: "trusted",
        trusted: {
          game_id: "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
          manifest_version: 1,
        },
      },
      {
        row_id: "proof-run-game-specific-audit-artifact-retention",
        state: "trusted",
        trusted: {
          game_id: "3e3cccc1-c837-46d3-b0d6-1b83ae0cc82b",
          manifest_version: 1,
          retention_comparison_normalized_match: true,
        },
      },
      {
        row_id: "proof-run-operator-proof-status-export",
        noArtifact: true,
      },
      {
        row_id: "proof-run-operator-proof-status-snapshot-audit",
        state: "trusted",
        artifact_version: 1,
        expected_version: 1,
        audit_report: {
          expected_path:
            "crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json",
          actual_path: "target/operator-proof/current-status-audit-check.json",
          diff_count: 0,
        },
      },
      {
        row_id: "proof-run-operator-proof-artifact-go-no-go",
        state: "trusted",
        artifact_version: 1,
        expected_version: 1,
        audit_report: {
          diff_count: 0,
        },
      },
      {
        row_id: "proof-run-operator-proof-artifact-retention",
        state: "trusted",
        artifact_version: 1,
        expected_version: 1,
        audit_report: {
          diff_count: 0,
        },
      },
      {
        row_id: "proof-run-operator-proof-projection-rebuild",
        state: "trusted",
        artifact_version: 1,
        expected_version: 1,
        audit_report: {
          diff_count: 0,
        },
      },
      {
        row_id: "proof-run-operator-proof-resolution-diff",
        state: "trusted",
        artifact_version: 1,
        expected_version: 1,
        audit_report: {
          diff_count: 0,
        },
      },
      {
        row_id: "proof-run-operator-proof-trace-inspection",
        state: "trusted",
        artifact_version: 1,
        expected_version: 1,
        audit_report: {
          diff_count: 0,
        },
      },
      {
        row_id: "proof-run-operator-proof-large-action-graph-performance",
        state: "trusted",
        artifact_version: 1,
        expected_version: 1,
        trusted: {
          game_id: "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
          resolve_elapsed_ms: 321,
          threshold_ms: 20000,
          trace_row_count: 74,
          phase_trace_anchored: true,
          decision_trace_anchored: true,
        },
        audit_report: {
          diff_count: 0,
        },
      },
      {
        row_id: "proof-run-operator-proof-determinism-fuzz",
        state: "trusted",
        artifact_version: 1,
        expected_version: 1,
        trusted: {
          family_count: 12,
          seed_count: 57,
          expected_family_count: 12,
          expected_seed_count: 57,
          family_manifest_matched: true,
        },
        audit_report: {
          diff_count: 0,
        },
      },
      {
        row_id: "proof-run-operator-proof-generated-shrink-matrix",
        state: "trusted",
        artifact_version: 1,
        expected_version: 1,
        trusted: {
          family_count: 8,
          case_count: 16,
          expected_family_count: 8,
          expected_case_count: 16,
          family_manifest_matched: true,
        },
        audit_report: {
          diff_count: 0,
        },
      },
      {
        row_id: "proof-run-missing-artifact-provenance-guard",
        state: "missing",
      },
      {
        row_id: "proof-run-malformed-artifact-metadata-guard",
        state: "malformed",
      },
      {
        row_id: "proof-run-stale-artifact-provenance-guard",
        state: "stale",
        stale: {
          freshness_max_age_seconds: 86400,
        },
      },
      {
        row_id: "proof-run-path-mismatch-artifact-provenance-guard",
        state: "path_mismatch",
        reported_path: "target/operator-proof/wrong-artifact-provenance-guard.json",
      },
      {
        row_id: "proof-run-version-mismatch-artifact-provenance-guard",
        state: "version_mismatch",
        artifact_version: 2,
        expected_version: 1,
      },
    ],
  },
];

const determinismFuzzFamilies = [
  {
    id: "seeded-day-vote",
    selector: "seeded_day_vote_scenarios_replay_audit_and_rebuild_deterministically",
    pack: "mafiascum",
    phase_scope: "D01",
    seeds: [101, 202, 303, 404, 505],
  },
  {
    id: "seeded-mafiascum-night",
    selector: "seeded_night_action_graphs_replay_audit_and_rebuild_deterministically",
    pack: "mafiascum",
    phase_scope: "N01",
    seeds: [6101, 6202, 6303, 6404, 6505],
  },
  {
    id: "seeded-trigger-dependency",
    selector: "seeded_trigger_dependency_graphs_replay_audit_and_rebuild_deterministically",
    pack: "mafiascum",
    phase_scope: "N01",
    seeds: [7101, 7202, 7303, 7404, 7505],
  },
  {
    id: "seeded-persistent-trigger",
    selector: "seeded_persistent_trigger_state_replay_audit_and_rebuild_deterministically",
    pack: "mafiascum",
    phase_scope: "N01,N02",
    seeds: [8101, 8202, 8303, 8404],
  },
  {
    id: "seeded-day-trigger-policy",
    selector: "seeded_day_trigger_policy_replay_audit_and_rebuild_deterministically",
    pack: "mafiascum",
    phase_scope: "D01",
    seeds: [8501, 8602],
  },
  {
    id: "generated-mafiascum-night",
    selector: "generated_night_action_graphs_replay_audit_and_rebuild_deterministically",
    pack: "mafiascum",
    phase_scope: "N01",
    seeds: [91001, 91113, 91227, 91331, 91447, 91559],
  },
  {
    id: "generated-chinese-night",
    selector: "generated_chinese_structured_night_graphs_replay_audit_and_rebuild_deterministically",
    pack: "chinese_structured",
    phase_scope: "N01",
    seeds: [92001, 92113, 92227, 92331, 92447, 92559],
  },
  {
    id: "generated-chinese-day",
    selector: "generated_chinese_structured_day_graphs_replay_audit_and_rebuild_deterministically",
    pack: "chinese_structured",
    phase_scope: "D01",
    seeds: [93001, 93113, 93227, 93331, 93447, 93559],
  },
  {
    id: "generated-mafia-universe-ita",
    selector: "generated_mafia_universe_ita_sessions_replay_audit_and_rebuild_deterministically",
    pack: "mafia_universe",
    phase_scope: "D01",
    seeds: [94001, 94113, 94227, 94331, 94447, 94559],
  },
  {
    id: "generated-epicmafia-pk-night",
    selector: "generated_epicmafia_pk_bomb_cult_replay_audit_and_rebuild_deterministically",
    pack: "epicmafia",
    phase_scope: "D01,N01",
    seeds: [95001, 95113, 95227, 96001, 96113, 96227],
  },
  {
    id: "generated-default-open-night",
    selector: "generated_default_open_night_replay_audit_and_rebuild_deterministically",
    pack: "default_open",
    phase_scope: "N01",
    seeds: [97101, 97211, 97307],
  },
  {
    id: "generated-default-open-day",
    selector: "generated_default_open_day_replay_audit_and_rebuild_deterministically",
    pack: "default_open",
    phase_scope: "D01",
    seeds: [97409, 97521, 97633],
  },
];

function determinismFuzzBootstrapReport() {
  const families = determinismFuzzFamilies.map((family) => ({
    ...family,
    seed_count: family.seeds.length,
    status: "passed",
  }));
  const seedCount = families.reduce((sum, family) => sum + family.seed_count, 0);
  return {
    artifact_version: 1,
    artifact_path: determinismFuzzReport,
    ok: true,
    command:
      "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin audit_determinism_fuzz_artifact -- --output target/operator-proof/current-determinism-fuzz-report.json",
    test_filter: "replay_audit_and_rebuild_deterministically",
    elapsed_ms: 1234,
    family_count: families.length,
    passed_family_count: families.length,
    failed_family_count: 0,
    seed_count: seedCount,
    expected_family_count: determinismFuzzFamilies.length,
    expected_seed_count: seedCount,
    family_manifest_matched: true,
    proof_boundary:
      "Runs the known seeded command-pipeline replay/projection/trace scenario families as local Postgres integration tests; this is deterministic generator coverage, not exhaustive state-space verification.",
    families,
  };
}

function generatedShrinkMatrixBootstrapReport() {
  const families = {
    babysitter: 2,
    bomb: 2,
    extra_action: 2,
    hider: 2,
    hunter: 2,
    ignite: 2,
    lovers: 2,
    pgo: 2,
  };
  const entries = Object.entries(families).flatMap(([family, count]) =>
    Array.from({ length: count }, (_, index) => {
      const seed = 90000 + index;
      return {
        family,
        seed,
        expectation_count: 3,
        success: {
          ok: true,
          success_invariant_preserved: true,
          promoted_success_fixture: true,
          reduction_steps: 2,
          report_path: `target/operator-proof/generated-shrink-matrix-${family}-${seed}-ok.report.tmp.json`,
          reduced_path: `target/operator-proof/generated-shrink-matrix-${family}-${seed}-ok.reduced.tmp.json`,
        },
        bad_expectation: {
          ok: false,
          failure_class: "semantic_expectation",
          failure_class_preserved: true,
          promoted_success_fixture: false,
          reduction_steps: 1,
          report_path: `target/operator-proof/generated-shrink-matrix-${family}-${seed}-bad.report.tmp.json`,
          reduced_path: `target/operator-proof/generated-shrink-matrix-${family}-${seed}-bad.reduced.tmp.json`,
        },
      };
    }),
  );
  return {
    artifact_version: 1,
    artifact_path: generatedShrinkMatrixReport,
    ok: true,
    proof_boundary: "fixture generated shrink matrix boundary",
    family_count: 8,
    case_count: 16,
    expected_family_count: 8,
    expected_case_count: 16,
    family_manifest_matched: true,
    families,
    entries,
  };
}

function emptyArtifactCounts() {
  return {
    total_artifact_rows: 0,
    trusted: 0,
    stale: 0,
    missing: 0,
    malformed: 0,
    path_mismatch: 0,
    version_mismatch: 0,
    input_mismatch: 0,
    drifted: 0,
    non_trusted: 0,
  };
}

function recordArtifactCount(counts, state) {
  counts.total_artifact_rows += 1;
  if (!(state in counts) || state === "total_artifact_rows" || state === "non_trusted") {
    throw new Error(`unknown proof-run artifact state: ${state}`);
  }
  counts[state] += 1;
  counts.non_trusted = counts.total_artifact_rows - counts.trusted;
}

function assertNumber(value, label) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertOptionalNumber(object, field, label) {
  if (object[field] !== undefined) {
    assertNumber(object[field], `${label}.${field}`);
  }
}

function assertOptionalString(object, field, label) {
  if (object[field] !== undefined) {
    assertString(object[field], `${label}.${field}`);
  }
}

function assertOptionalBoolean(object, field, label) {
  if (object[field] !== undefined && typeof object[field] !== "boolean") {
    throw new Error(`${label}.${field} must be a boolean`);
  }
}

function assertProofRunStatusContract(name, body, expectedContractVersion) {
  if (body.contract_version !== expectedContractVersion) {
    throw new Error(
      `${name} contract_version ${body.contract_version} !== ${expectedContractVersion}`,
    );
  }
  assertString(body.game, `${name}.game`);
  assertNumber(body.manifest_version, `${name}.manifest_version`);
  if (body.execution !== "local-only command copy") {
    throw new Error(`${name}.execution ${body.execution} is not the documented execution mode`);
  }
  if (!Array.isArray(body.families)) {
    throw new Error(`${name}.families must be an array`);
  }

  const counts = {
    production: emptyArtifactCounts(),
    fixtures: emptyArtifactCounts(),
  };
  for (const [familyIndex, family] of body.families.entries()) {
    assertString(family.heading, `${name}.families[${familyIndex}].heading`);
    if (typeof family.fixture !== "boolean") {
      throw new Error(`${name}.families[${familyIndex}].fixture must be boolean`);
    }
    if (!Array.isArray(family.runs)) {
      throw new Error(`${name}.families[${familyIndex}].runs must be an array`);
    }
    for (const [rowIndex, row] of family.runs.entries()) {
      for (const field of ["id", "row_id", "family", "scope", "command", "proof_boundary"]) {
        assertString(row[field], `${name}.families[${familyIndex}].runs[${rowIndex}].${field}`);
      }
      if (row.fixture !== family.fixture) {
        throw new Error(`${name} row ${row.row_id} fixture flag does not match family`);
      }
      if (row.artifact === null || row.artifact === undefined) {
        continue;
      }
      const artifact = row.artifact;
      assertString(artifact.path, `${name} row ${row.row_id}.artifact.path`);
      assertString(artifact.state, `${name} row ${row.row_id}.artifact.state`);
      const scope = family.fixture ? "fixtures" : "production";
      recordArtifactCount(counts[scope], artifact.state);
      switch (artifact.state) {
        case "trusted": {
          assertNumber(
            artifact.modified_at_unix_seconds,
            `${name} row ${row.row_id}.modified_at_unix_seconds`,
          );
          assertNumber(artifact.age_seconds, `${name} row ${row.row_id}.age_seconds`);
          assertNumber(
            artifact.freshness_max_age_seconds,
            `${name} row ${row.row_id}.freshness_max_age_seconds`,
          );
          if (artifact.trusted_metadata !== undefined) {
            const metadata = artifact.trusted_metadata;
            if (Object.keys(metadata).length === 0) {
              throw new Error(`${name} row ${row.row_id}.trusted_metadata must not be empty`);
            }
            assertOptionalString(metadata, "game_id", `${name} row ${row.row_id}.trusted_metadata`);
            for (const field of [
              "manifest_version",
              "resolve_elapsed_ms",
              "threshold_ms",
              "trace_row_count",
              "family_count",
              "seed_count",
              "expected_family_count",
              "expected_seed_count",
              "case_count",
              "expected_case_count",
            ]) {
              assertOptionalNumber(metadata, field, `${name} row ${row.row_id}.trusted_metadata`);
            }
            for (const field of [
              "retention_comparison_normalized_match",
              "phase_trace_anchored",
              "decision_trace_anchored",
              "family_manifest_matched",
            ]) {
              assertOptionalBoolean(metadata, field, `${name} row ${row.row_id}.trusted_metadata`);
            }
            if (artifact.reported_path !== undefined) {
              throw new Error(`${name} row ${row.row_id} mixed trusted and mismatch fields`);
            }
          } else {
            assertNumber(artifact.artifact_version, `${name} row ${row.row_id}.artifact_version`);
            assertNumber(artifact.expected_version, `${name} row ${row.row_id}.expected_version`);
            if (artifact.expected_path !== undefined) {
              assertString(artifact.expected_path, `${name} row ${row.row_id}.expected_path`);
              assertString(artifact.actual_path, `${name} row ${row.row_id}.actual_path`);
            }
            assertNumber(artifact.diff_count, `${name} row ${row.row_id}.diff_count`);
          }
          break;
        }
        case "stale": {
          assertNumber(
            artifact.modified_at_unix_seconds,
            `${name} row ${row.row_id}.modified_at_unix_seconds`,
          );
          assertNumber(artifact.age_seconds, `${name} row ${row.row_id}.age_seconds`);
          assertNumber(
            artifact.freshness_max_age_seconds,
            `${name} row ${row.row_id}.freshness_max_age_seconds`,
          );
          if (artifact.trusted_metadata !== undefined) {
            throw new Error(`${name} row ${row.row_id} exposed trusted metadata while stale`);
          }
          break;
        }
        case "path_mismatch": {
          assertString(artifact.reported_path, `${name} row ${row.row_id}.reported_path`);
          if (artifact.trusted_metadata !== undefined) {
            throw new Error(`${name} row ${row.row_id} exposed trusted metadata on mismatch`);
          }
          break;
        }
        case "version_mismatch": {
          assertNumber(artifact.artifact_version, `${name} row ${row.row_id}.artifact_version`);
          assertNumber(artifact.expected_version, `${name} row ${row.row_id}.expected_version`);
          if (artifact.trusted_metadata !== undefined) {
            throw new Error(`${name} row ${row.row_id} exposed trusted metadata on mismatch`);
          }
          break;
        }
        case "input_mismatch": {
          assertString(artifact.expected_path, `${name} row ${row.row_id}.expected_path`);
          assertString(artifact.actual_path, `${name} row ${row.row_id}.actual_path`);
          assertString(
            artifact.reported_expected_path,
            `${name} row ${row.row_id}.reported_expected_path`,
          );
          assertString(
            artifact.reported_actual_path,
            `${name} row ${row.row_id}.reported_actual_path`,
          );
          if (artifact.trusted_metadata !== undefined) {
            throw new Error(`${name} row ${row.row_id} exposed trusted metadata on input mismatch`);
          }
          break;
        }
        case "drifted": {
          assertNumber(artifact.diff_count, `${name} row ${row.row_id}.diff_count`);
          assertNumber(
            artifact.modified_at_unix_seconds,
            `${name} row ${row.row_id}.modified_at_unix_seconds`,
          );
          assertNumber(artifact.age_seconds, `${name} row ${row.row_id}.age_seconds`);
          assertNumber(
            artifact.freshness_max_age_seconds,
            `${name} row ${row.row_id}.freshness_max_age_seconds`,
          );
          if (artifact.trusted_metadata !== undefined) {
            throw new Error(`${name} row ${row.row_id} exposed trusted metadata while drifted`);
          }
          break;
        }
        case "missing":
        case "malformed": {
          if (artifact.trusted_metadata !== undefined) {
            throw new Error(`${name} row ${row.row_id} exposed trusted metadata`);
          }
          break;
        }
        default:
          throw new Error(`${name} row ${row.row_id} unknown state ${artifact.state}`);
      }
    }
  }
  for (const [scope, expectedCounts] of Object.entries(counts)) {
    const actualCounts = body.summary?.[scope];
    if (!actualCounts) {
      throw new Error(`${name} missing ${scope} summary`);
    }
    for (const [field, value] of Object.entries(expectedCounts)) {
      if (actualCounts[field] !== value) {
        throw new Error(
          `${name} summary ${scope}.${field} ${actualCounts[field]} !== derived ${value}`,
        );
      }
    }
  }
}

async function main() {
  await mkdir(artifactDir, { recursive: true });
  await writeSmokeProgress({ stage: "write-provenance-proof-artifacts" });
  await writeProvenanceProofArtifacts();
  await writeSmokeProgress({ stage: "require-proof-artifacts" });
  await requireProofArtifacts();
  await writeSmokeProgress({ stage: "write-local-report-bootstraps" });
  await writeLocalReportBootstraps();
  await writeSmokeProgress({ stage: "start-server", port });
  const server = spawn("cargo", ["run", "-p", "server"], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      FMARCH_BIND: `${host}:${port}`,
      RUST_LOG: process.env.RUST_LOG ?? "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverOutput = "";
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  try {
    await writeSmokeProgress({ stage: "wait-for-health", port });
    await waitForHealth();
    await writeSmokeProgress({ stage: "seed-checked-audit-game" });
    await seedCheckedAuditGame();
    await writeSmokeProgress({ stage: "write-operator-reports" });
    await writeOperatorReports();
    await writeSmokeProgress({ stage: "seed-browser-game" });
    await seedGame();
    await writeSmokeProgress({ stage: "run-browser-proof" });
    const evidence = await runBrowserProof();
    const evidencePath = path.join(artifactDir, "playwright-dom-proof.json");
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
    await writeSmokeProgress({ stage: "complete", evidence: evidencePath });
    console.log(JSON.stringify({ ok: true, game, evidence: evidencePath }, null, 2));
  } catch (error) {
    error.serverOutput = serverOutput.slice(-4000);
    throw error;
  } finally {
    server.kill("SIGINT");
  }
}

async function writeSmokeProgress(progress) {
  await writeFile(
    path.join(artifactDir, "operator-browser-smoke-progress.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        ...progress,
      },
      null,
      2,
    ),
  );
}

async function writeOperatorReports() {
  await writeStatusAuditExport();
  await writeStatusAuditReport();
  await writeGoNoGoReport();
  await writePreviousGoNoGoReport();
  await writeRetentionReport();
  await writeProjectionRebuildReport();
  await writeResolutionDiffReport();
  await writeTraceInspectionReport();
  await writeDeterminismFuzzReport();
  await writeStatusAuditExport();
  await writeStatusAuditReport();
  await writeGoNoGoReport();
  await writePreviousGoNoGoReport();
  await writeRetentionReport();
  await writeProjectionRebuildReport();
  await writeResolutionDiffReport();
  await writeTraceInspectionReport();
}

async function requireProofArtifacts() {
  for (const artifact of proofArtifacts) {
    try {
      await access(path.join(root, artifact));
    } catch {
      throw new Error(
        `operator browser smoke requires existing proof artifact: ${artifact}`,
      );
    }
  }
}

async function writeProvenanceProofArtifacts() {
  await mkdir(path.join(root, "target", "operator-proof"), { recursive: true });
  await writeFile(path.join(root, malformedProofArtifact), "{");
  await rmIfExists(path.join(root, missingProofArtifact));
  await writeFile(
    path.join(root, staleProofArtifact),
    JSON.stringify(
      {
        ok: true,
        manifest_version: 1,
        game_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        artifact_path: staleProofArtifact,
        runs: [],
      },
      null,
      2,
    ),
  );
  const staleDate = new Date("2000-01-01T00:00:00Z");
  await utimes(path.join(root, staleProofArtifact), staleDate, staleDate);
  await writeFile(
    path.join(root, pathMismatchProofArtifact),
    JSON.stringify(
      {
        ok: true,
        manifest_version: 1,
        game_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        artifact_path: "target/operator-proof/wrong-artifact-provenance-guard.json",
        runs: [],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, versionMismatchProofArtifact),
    JSON.stringify(
      {
        ok: true,
        manifest_version: 2,
        game_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        artifact_path: versionMismatchProofArtifact,
        runs: [],
      },
      null,
      2,
    ),
  );
}

async function writeLocalReportBootstraps() {
  await writeFile(
    path.join(root, statusAuditReport),
    JSON.stringify(
      {
        artifact_version: 1,
        artifact_path: statusAuditReport,
        ok: true,
        expected_path:
          "crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json",
        actual_path: statusAuditExport,
        normalized_fields: [
          "$.game",
          "$.families[*].runs[*].command.{game}",
          "$.families[*].runs[*].artifact.modified_at_unix_seconds",
          "$.families[*].runs[*].artifact.age_seconds",
        ],
        diffs: [],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, goNoGoReport),
    JSON.stringify(
      {
        artifact_version: 1,
        artifact_path: goNoGoReport,
        ok: true,
        manifest_version: 1,
        production: emptyArtifactCounts(),
        fixtures: emptyArtifactCounts(),
        rows: [],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, previousGoNoGoReport),
    JSON.stringify(
      {
        artifact_version: 1,
        artifact_path: previousGoNoGoReport,
        ok: true,
        manifest_version: 1,
        production: emptyArtifactCounts(),
        fixtures: emptyArtifactCounts(),
        rows: [],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, retentionReport),
    JSON.stringify(
      {
        artifact_version: 1,
        artifact_path: retentionReport,
        ok: true,
        previous_path: previousGoNoGoReport,
        latest_path: goNoGoReport,
        normalized_fields: [
          "$.production.*",
          "$.fixtures.*",
          "$.rows[*].state",
        ],
        regressions: [],
        recoveries: [],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, rebuildReport),
    JSON.stringify(
      {
        artifact_version: 1,
        artifact_path: rebuildReport,
        ok: true,
        game_id: "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
        isolation: "rollback-only transaction",
        table_count: 13,
        matched_table_count: 13,
        drifted_table_count: 0,
        tables: [
          {
            table: "slot_state",
            matches: true,
            before_rows: 6,
            rebuilt_rows: 6,
          },
        ],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, resolutionDiffReport),
    JSON.stringify(
      {
        artifact_version: 1,
        artifact_path: resolutionDiffReport,
        ok: true,
        game_id: "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
        normalized_fields: [
          "$.phases[*].applied_stream_seq",
          "$.phases[*].trace_stream_seq",
          "$.phases[*].stored_*",
          "$.phases[*].rebuilt_*",
        ],
        audited_phase_count: 1,
        matched_phase_count: 1,
        drifted_phase_count: 0,
        skipped_phase_count: 0,
        diff_count: 0,
        first_drift_paths: [],
        phases: [
          {
            phase_id: "N01",
            run_id: "resolution:N01",
            status: "matched",
            applied_matches: true,
            trace_matches: true,
            diff_count: 0,
            diffs: [],
          },
        ],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, traceInspectionReport),
    JSON.stringify(
      {
        artifact_version: 1,
        artifact_path: traceInspectionReport,
        ok: true,
        game_id: "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
        normalized_fields: [
          "$.traces[*].applied_stream_seq",
          "$.traces[*].trace_stream_seq",
          "$.traces[*].decisions[*].applied_stream_seq",
          "$.traces[*].edges[*].applied_stream_seq",
          "$.traces[*].generated[*].applied_stream_seq",
          "$.traces[*].effect_changes[*].applied_stream_seq",
          "$.traces[*].visibility[*].applied_stream_seq",
          "$.traces[*].notes[*].applied_stream_seq",
        ],
        trace_count: 1,
        decision_count: 1,
        edge_count: 1,
        generated_count: 1,
        effect_change_count: 1,
        visibility_count: 0,
        note_count: 1,
        traces: [
          {
            phase_id: "N01",
            run_id: "resolution:N01",
            applied_stream_seq: 14,
            trace_stream_seq: 15,
            trace_version: 1,
            decision_count: 1,
            edge_count: 1,
            generated_count: 1,
            effect_change_count: 1,
            visibility_count: 0,
            note_count: 1,
            decisions: [{ stage: "resolve", outcome: "applied" }],
            edges: [{ from: "slot_1", to: "slot_2", kind: "visit" }],
            generated: [{ action_id: "generated:1", actor: "slot_1" }],
            effect_changes: [{ effect: "dead", target: "slot_2" }],
            visibility: [],
            notes: [{ note: "fixture trace" }],
          },
        ],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, largeActionGraphPerformanceReport),
    JSON.stringify(
      {
        artifact_version: 1,
        artifact_path: largeActionGraphPerformanceReport,
        ok: true,
        game_id: "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
        pack: "mafiascum",
        phase_id: "N01",
        seed: 90001,
        resolve_seed: 131001,
        roster_count: 40,
        submitted_action_count: 29,
        resolution_inner_event_count: 12,
        stream_event_count: 115,
        trace_row_count: 74,
        phase_trace_anchored: true,
        decision_trace_anchored: true,
        resolve_elapsed_ms: 321,
        threshold_ms: 20000,
        replay_audit_ok: true,
        replay_audited: 1,
        replay_skipped: 0,
        projection_rebuild_ok: true,
        pgo_triggered: true,
        babysitter_death: true,
        hider_death: true,
        lovers_linked: true,
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, determinismFuzzReport),
    JSON.stringify(determinismFuzzBootstrapReport(), null, 2),
  );
  await writeFile(
    path.join(root, generatedShrinkMatrixReport),
    JSON.stringify(generatedShrinkMatrixBootstrapReport(), null, 2),
  );
}

async function writeStatusAuditExport() {
  await runCheckedCommand("cargo", [
    "run",
    "-q",
    "-p",
    "commands",
    "--bin",
    "export_operator_proof_status",
    "--",
    "--fixture",
    "artifact-provenance",
    "--output",
    statusAuditExport,
    "00000000-0000-0000-0000-000000000000",
  ]);
}

async function writeStatusAuditReport() {
  await runCheckedCommand("cargo", [
    "run",
    "-q",
    "-p",
    "commands",
    "--bin",
    "audit_operator_proof_status",
    "--",
    "--output",
    statusAuditReport,
    "crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json",
    statusAuditExport,
  ]);
}

async function writeGoNoGoReport() {
  await runCheckedCommand("cargo", [
    "run",
    "-q",
    "-p",
    "commands",
    "--bin",
    "audit_operator_proof_artifacts",
    "--",
    "--output",
    goNoGoReport,
    "00000000-0000-0000-0000-000000000000",
  ]);
}

async function writePreviousGoNoGoReport() {
  await writeFile(
    path.join(root, previousGoNoGoReport),
    await readFile(path.join(root, goNoGoReport)),
  );
}

async function writeRetentionReport() {
  await runCheckedCommand("cargo", [
    "run",
    "-q",
    "-p",
    "commands",
    "--bin",
    "audit_operator_proof_artifact_retention",
    "--",
    "--output",
    retentionReport,
    previousGoNoGoReport,
    goNoGoReport,
  ]);
}

async function writeProjectionRebuildReport() {
  await runCheckedCommand("cargo", [
    "run",
    "-q",
    "-p",
    "commands",
    "--bin",
    "audit_projection_rebuild_artifact",
    "--",
    "--output",
    rebuildReport,
    "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
  ]);
}

async function writeResolutionDiffReport() {
  await runCheckedCommand("cargo", [
    "run",
    "-q",
    "-p",
    "commands",
    "--bin",
    "audit_resolution_diff_artifact",
    "--",
    "--output",
    resolutionDiffReport,
    "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
  ]);
}

async function writeTraceInspectionReport() {
  await runCheckedCommand("cargo", [
    "run",
    "-q",
    "-p",
    "commands",
    "--bin",
    "audit_trace_inspection_artifact",
    "--",
    "--output",
    traceInspectionReport,
    "08d8a45f-6c3b-4401-8e31-8d7637f36a82",
  ]);
}

async function writeLargeActionGraphPerformanceReport() {
  await runCheckedCommand("cargo", [
    "run",
    "-q",
    "-p",
    "commands",
    "--bin",
    "audit_large_action_graph_performance_artifact",
    "--",
    "--output",
    largeActionGraphPerformanceReport,
  ]);
}

async function writeDeterminismFuzzReport() {
  await runCheckedCommand("cargo", [
    "run",
    "-q",
    "-p",
    "commands",
    "--bin",
    "audit_determinism_fuzz_artifact",
    "--",
    "--output",
    determinismFuzzReport,
  ]);
}

async function runCheckedCommand(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${code}\n${stdout}\n${stderr}`,
    );
  }
}

async function rmIfExists(file) {
  try {
    await rm(file);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function waitForHealth() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/healthz`, {}, 1000);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still compiling or binding.
    }
    await delay(250);
  }
  throw new Error(`server did not become healthy at ${baseUrl}/healthz`);
}

async function sendCommand(principalUserId, command) {
  const response = await fetchWithTimeout(
    `${baseUrl}/commands`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        v: 1,
        id: commandId++,
        body: {
          kind: "Command",
          body: {
            command_id: crypto.randomUUID(),
            principal_user_id: principalUserId,
            command,
          },
        },
      }),
    },
    15000,
  );
  const envelope = await response.json();
  if (!response.ok || envelope.body?.kind !== "Ack") {
    throw new Error(`command rejected: ${JSON.stringify(envelope)}`);
  }
}

async function checkedAuditGameHasTrace() {
  const response = await fetchWithTimeout(
    `${baseUrl}/games/${checkedAuditGame}/resolution-traces?principal_user_id=fixture_host`,
    {},
    5000,
  );
  if (!response.ok) {
    return false;
  }
  const report = await response.json();
  return Array.isArray(report.traces) && report.traces.length > 0;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function seedCheckedAuditGame() {
  if (await checkedAuditGameHasTrace()) {
    return;
  }
  await sendCommand("fixture_host", {
    CreateGame: { game: checkedAuditGame, pack: "mafiascum" },
  });
  for (const [slot, user, role] of [
    ["slot_1", "fixture_user_1", "doctor"],
    ["slot_2", "fixture_user_2", "mafia_goon"],
    ["slot_3", "fixture_user_3", "vanilla_townie"],
  ]) {
    await sendCommand("fixture_host", { AddSlot: { game: checkedAuditGame, slot } });
    await sendCommand("fixture_host", {
      AssignSlot: { game: checkedAuditGame, slot, user },
    });
    await sendCommand("fixture_host", {
      AssignRole: { game: checkedAuditGame, slot, role_key: role },
    });
  }
  await sendCommand("fixture_host", {
    StartGame: { game: checkedAuditGame, phase: "N01" },
  });
  await sendCommand("fixture_user_1", {
    SubmitAction: {
      game: checkedAuditGame,
      action_id: "protect_slot_3",
      actor_slot: "slot_1",
      template_id: "doctor_protect",
      targets: ["slot_3"],
      grant_id: null,
    },
  });
  await sendCommand("fixture_user_2", {
    SubmitAction: {
      game: checkedAuditGame,
      action_id: "kill_slot_3",
      actor_slot: "slot_2",
      template_id: "factional_kill",
      targets: ["slot_3"],
      grant_id: null,
    },
  });
  await sendCommand("fixture_host", {
    ResolvePhase: { game: checkedAuditGame, seed: 77001 },
  });
}

async function seedGame() {
  await sendCommand("host_h", { CreateGame: { game, pack: "mafiascum" } });
  for (const [slot, user, role] of [
    ["slot_1", "user_1", "beloved_princess"],
    ["slot_2", "user_2", "vanilla_townie"],
    ["slot_3", "user_3", "vanilla_townie"],
    ["slot_4", "user_4", "mafia_goon"],
    ["slot_5", "user_5", "mafia_goon"],
    ["slot_6", "user_6", "vanilla_townie"],
  ]) {
    await sendCommand("host_h", { AddSlot: { game, slot } });
    await sendCommand("host_h", { AssignSlot: { game, slot, user } });
    await sendCommand("host_h", { AssignRole: { game, slot, role_key: role } });
  }
  await sendCommand("host_h", { StartGame: { game, phase: "D01" } });
  for (const [user, actorSlot] of [
    ["user_2", "slot_2"],
    ["user_3", "slot_3"],
    ["user_4", "slot_4"],
    ["user_5", "slot_5"],
  ]) {
    await sendCommand(user, {
      SubmitVote: {
        game,
        actor_slot: actorSlot,
        target: { Slot: "slot_1" },
      },
    });
  }
  await sendCommand("host_h", { ResolvePhase: { game, seed: 7421 } });
  await sendCommand("host_h", {
    ResolveHostPrompt: {
      game,
      prompt_id: "D01:skip_next_day:slot_1",
      decision: "Acknowledge",
    },
  });
}

async function runBrowserProof() {
  await writePlaywrightProgress({ stage: "launching-browser" });
  const browser = await withTimeout(
    chromium.launch({ headless: true }),
    30000,
    "launch chromium",
  );
  try {
    const page = await withTimeout(
      browser.newPage({ viewport: { width: 1280, height: 720 } }),
      15000,
      "create playwright page",
    );
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    const surfaces = [];
    for (const smokePage of pages) {
      const url = `${baseUrl}${smokePage.path}`;
      await writePlaywrightProgress({
        stage: "page",
        name: smokePage.name,
        url,
        completed_pages: surfaces.length,
      });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const text = await page.locator("body").innerText();
      const checks = smokePage.checks.map((needle) => ({
        needle,
        present: text.includes(needle),
      }));
      const missing = checks.filter((check) => !check.present).map((check) => check.needle);
      if (missing.length > 0) {
        throw new Error(`${smokePage.name} missing visible text: ${missing.join(", ")}`);
      }
      const selectors = [];
      for (const selector of smokePage.selectors ?? []) {
        const count = await page.locator(selector).count();
        const present = count > 0;
        selectors.push({ selector, present });
        if (!present) {
          throw new Error(`${smokePage.name} missing selector: ${selector}`);
        }
      }
      const rowChecks = [];
      for (const rowCheck of smokePage.rowChecks ?? []) {
        const rowText = await page.locator(rowCheck.selector).innerText();
        const required = rowCheck.required.map((needle) => ({
          needle,
          present: rowText.includes(needle),
        }));
        const forbidden = rowCheck.forbidden.map((needle) => ({
          needle,
          absent: !rowText.includes(needle),
        }));
        const missingRequired = required
          .filter((check) => !check.present)
          .map((check) => check.needle);
        if (missingRequired.length > 0) {
          throw new Error(
            `${smokePage.name} row ${rowCheck.selector} missing visible text: ${missingRequired.join(", ")}`,
          );
        }
        const presentForbidden = forbidden
          .filter((check) => !check.absent)
          .map((check) => check.needle);
        if (presentForbidden.length > 0) {
          throw new Error(
            `${smokePage.name} row ${rowCheck.selector} rendered forbidden text: ${presentForbidden.join(", ")}`,
          );
        }
        rowChecks.push({ selector: rowCheck.selector, required, forbidden });
      }
      const screenshot = path.join(artifactDir, `${smokePage.name}.png`);
      await page.screenshot({ path: screenshot });
      surfaces.push({
        name: smokePage.name,
        url,
        title: await page.title(),
        h1: await page.locator("h1").innerText(),
        checks,
        selectors,
        rowChecks,
        screenshot,
      });
    }
    const jsonSurfaces = [];
    for (const jsonPage of jsonPages) {
      const url = `${baseUrl}${jsonPage.path}`;
      await writePlaywrightProgress({
        stage: "json",
        name: jsonPage.name,
        url,
        completed_pages: surfaces.length,
        completed_json_surfaces: jsonSurfaces.length,
      });
      const response = await page.evaluate(async (targetUrl) => {
        const response = await fetch(targetUrl);
        return {
          ok: response.ok,
          status: response.status,
          body: await response.json(),
        };
      }, url);
      if (!response.ok) {
        throw new Error(`${jsonPage.name} returned HTTP ${response.status}`);
      }
      assertProofRunStatusContract(
        jsonPage.name,
        response.body,
        jsonPage.contractVersion,
      );
      const runs = response.body.families.flatMap((family) => family.runs);
      if (jsonPage.summary) {
        for (const [scope, expectedCounts] of Object.entries(jsonPage.summary)) {
          const actualCounts = response.body.summary?.[scope];
          if (!actualCounts) {
            throw new Error(`${jsonPage.name} missing ${scope} summary`);
          }
          for (const [key, value] of Object.entries(expectedCounts)) {
            if (actualCounts[key] !== value) {
              throw new Error(
                `${jsonPage.name} ${scope}.${key} ${actualCounts[key]} !== ${value}`,
              );
            }
          }
        }
      }
      const badProductionRows = runs.filter(
        (row) => !row.fixture && row.artifact && row.artifact.state !== "trusted",
      );
      if (badProductionRows.length > 0) {
        throw new Error(
          `${jsonPage.name} production artifact rows are not trusted: ${badProductionRows
            .map((row) => `${row.row_id}:${row.artifact.state}`)
            .join(", ")}`,
        );
      }
      const rowChecks = jsonPage.rows.map((expected) => {
        const row = runs.find((candidate) => candidate.row_id === expected.row_id);
        if (!row) {
          throw new Error(`${jsonPage.name} missing row ${expected.row_id}`);
        }
        if (expected.noArtifact) {
          if (row.artifact !== null) {
            throw new Error(`${jsonPage.name} row ${expected.row_id} should not expose artifact status`);
          }
          return {
            row_id: expected.row_id,
            state: null,
            trusted_metadata_present: false,
          };
        }
        const stateMatches = row.artifact?.state === expected.state;
        if (!stateMatches) {
          throw new Error(
            `${jsonPage.name} row ${expected.row_id} state ${row.artifact?.state} !== ${expected.state}`,
          );
        }
        if (expected.reported_path && row.artifact?.reported_path !== expected.reported_path) {
          throw new Error(`${jsonPage.name} row ${expected.row_id} reported_path mismatch`);
        }
        if (
          expected.artifact_version &&
          row.artifact?.artifact_version !== expected.artifact_version
        ) {
          throw new Error(`${jsonPage.name} row ${expected.row_id} artifact_version mismatch`);
        }
        if (
          expected.expected_version &&
          row.artifact?.expected_version !== expected.expected_version
        ) {
          throw new Error(`${jsonPage.name} row ${expected.row_id} expected_version mismatch`);
        }
        if (expected.stale) {
          if (
            row.artifact?.freshness_max_age_seconds !==
            expected.stale.freshness_max_age_seconds
          ) {
            throw new Error(`${jsonPage.name} row ${expected.row_id} freshness ceiling mismatch`);
          }
          if (!(row.artifact?.age_seconds > expected.stale.freshness_max_age_seconds)) {
            throw new Error(`${jsonPage.name} row ${expected.row_id} is not stale`);
          }
        }
        if (expected.trusted) {
          const trusted = row.artifact?.trusted_metadata;
          if (!trusted) {
            throw new Error(`${jsonPage.name} row ${expected.row_id} missing trusted metadata`);
          }
          for (const [key, value] of Object.entries(expected.trusted)) {
            if (trusted[key] !== value) {
              throw new Error(
                `${jsonPage.name} row ${expected.row_id} trusted ${key} ${trusted[key]} !== ${value}`,
              );
            }
          }
        } else if (row.artifact?.trusted_metadata !== undefined) {
          throw new Error(`${jsonPage.name} row ${expected.row_id} exposed trusted metadata`);
        }
        if (expected.audit_report) {
          for (const [key, value] of Object.entries(expected.audit_report)) {
            if (row.artifact?.[key] !== value) {
              throw new Error(
                `${jsonPage.name} row ${expected.row_id} audit report ${key} ${row.artifact?.[key]} !== ${value}`,
              );
            }
          }
        }
        return {
          row_id: expected.row_id,
          state: row.artifact?.state,
          trusted_metadata_present: row.artifact?.trusted_metadata !== undefined,
        };
      });
      jsonSurfaces.push({
        name: jsonPage.name,
        url,
        status: response.status,
        contract_version: response.body.contract_version,
        manifest_version: response.body.manifest_version,
        execution: response.body.execution,
        rowChecks,
        summary: response.body.summary,
      });
    }
    return {
      game,
      base_url: baseUrl,
      surfaces,
      jsonSurfaces,
    };
  } finally {
    await writePlaywrightProgress({ stage: "closing-browser" });
    await browser.close();
  }
}

async function writePlaywrightProgress(progress) {
  await writeFile(
    path.join(artifactDir, "playwright-progress.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        ...progress,
      },
      null,
      2,
    ),
  );
}

async function withTimeout(promise, timeoutMs, label) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = globalThis.setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function proofRunAnchorSelectors() {
  const manifestPath = path.join(root, "docs", "ops", "proof-runs.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const ids = manifest.families.flatMap((family) => family.runs.map((run) => run.id));
  return ids.map((id) => `#proof-run-${id}`);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  if (error.serverOutput) {
    console.error("\n--- server output tail ---");
    console.error(error.serverOutput);
  }
  process.exit(1);
});

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("could not allocate a free TCP port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}
