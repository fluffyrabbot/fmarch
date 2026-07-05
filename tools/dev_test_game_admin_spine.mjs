import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { devTestGameRaceCoveragePath } from "./dev_test_game_race_coverage.mjs";
import { devTestGameHostedConcurrentRaceMatrixPath } from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import { devTestGameHostedEvidenceLanePath } from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  devTestGameHostedEvidenceLaneAdminProofPath,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  devTestGameHostedIdentityEvidencePath,
  devTestGameHostedIdentityProgressionSummaryPath,
} from "./dev_test_game_hosted_identity_evidence.mjs";
import { devTestGameHostedTargetPreflightPath } from "./dev_test_game_hosted_target_preflight.mjs";
import {
  devTestGameHostedTargetPreflightAdminProofPath,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import { devTestGameOpsArtifactsPath } from "./dev_test_game_ops_artifacts.mjs";
import {
  devTestGameHostedOpsSignalsPath,
} from "./dev_test_game_hosted_ops_signals.mjs";
import {
  devTestGameHostedOpsSignalsAdminProofPath,
} from "./dev_test_game_hosted_ops_signal_cases.mjs";
import { runAdminSpineProof } from "./dev_test_game_admin_spine_proof.mjs";
import {
  devTestGameProofGraphAdminProofPath,
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import {
  devTestGameRealHostedObservabilityHandoffPath,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  devTestGameReleaseRunbookAdminProofPath,
} from "./dev_test_game_release_readiness_cases.mjs";
import {
  nextActionAdminProofPath,
  proofFreshnessAdminProofPath,
} from "./dev_test_game_next_action_paths.mjs";
import {
  artifactDir,
  repoRoot,
  runAdminAuditProofBatchPlan,
} from "./dev_test_game_admin_audit_proof_helper.mjs";
import {
  proofGraphAdminProofCase,
} from "./dev_test_game_proof_graph_admin_proof.mjs";
import {
  proofFreshnessAdminProofCase,
} from "./dev_test_game_proof_freshness_admin_proof.mjs";
import {
  nextActionAdminProofCase,
} from "./dev_test_game_next_action_admin_proof.mjs";
import { releaseReadinessStep } from "./dev_test_game_spine_readiness_steps.mjs";
import { runSpinePlan } from "./dev_test_game_spine_runner.mjs";

export const adminSpineProofPath = "target/dev-test-game/admin-spine-proof.json";
export const adminSpineTerminalBatchProofPath =
  "target/dev-test-game/admin-spine-terminal-batches.json";

export const adminSpineReadinessEvidenceEnv = {
  FMARCH_DEV_TEST_GAME_CORE_LOOP_ADMIN_PROOF:
    "target/dev-test-game/core-loop-admin-proof.json",
  FMARCH_DEV_TEST_GAME_HARDENING_ADMIN_PROOF:
    "target/dev-test-game/hardening-admin-proof.json",
  FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF:
    "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
  FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP:
    "target/live-stack-backup-restore-drill/local-live-stack.dump",
  FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF:
    "target/dev-test-game/backup-admin-proof.json",
  FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
  FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF: "target/dev-test-game/ops-admin-proof.json",
  FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS: devTestGameHostedOpsSignalsPath,
  FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS_ADMIN_PROOF:
    devTestGameHostedOpsSignalsAdminProofPath,
  FMARCH_DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF:
    devTestGameRealHostedObservabilityHandoffPath,
  FMARCH_DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF_ADMIN_PROOF:
    "target/dev-test-game/real-hosted-observability-handoff-admin-proof.json",
  FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
    "target/dev-test-game/seed-fixture-summary.json",
  FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF: "target/dev-test-game/seed-admin-proof.json",
  FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK:
    "target/dev-test-game/release-runbook.json",
  FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK_ADMIN_PROOF:
    devTestGameReleaseRunbookAdminProofPath,
  FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF:
    "target/auth-invite-role-proof/invite-role-proof.json",
  FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF:
    "target/dev-test-game/identity-admin-proof.json",
  FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE:
    devTestGameHostedIdentityEvidencePath,
  FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_PROGRESSION_SUMMARY:
    devTestGameHostedIdentityProgressionSummaryPath,
  FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_ADMIN_PROOF:
    "target/dev-test-game/hosted-identity-evidence-admin-proof.json",
  FMARCH_DEV_TEST_GAME_SPINE_MANIFEST: "target/dev-test-game/spine-manifest.json",
  FMARCH_DEV_TEST_GAME_SPINE_MANIFEST_ADMIN_PROOF:
    "target/dev-test-game/spine-manifest-admin-proof.json",
  FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF: "target/dev-test-game/admin-spine-proof.json",
  FMARCH_DEV_TEST_GAME_ADMIN_SPINE_ADMIN_PROOF:
    "target/dev-test-game/admin-spine-admin-proof.json",
  FMARCH_DEV_TEST_GAME_RACE_COVERAGE: devTestGameRaceCoveragePath,
  FMARCH_DEV_TEST_GAME_RACE_COVERAGE_ADMIN_PROOF:
    "target/dev-test-game/race-coverage-admin-proof.json",
  FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX:
    devTestGameHostedConcurrentRaceMatrixPath,
  FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX_ADMIN_PROOF:
    "target/dev-test-game/hosted-concurrent-race-matrix-admin-proof.json",
  FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT:
    devTestGameHostedTargetPreflightPath,
  FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT_ADMIN_PROOF:
    devTestGameHostedTargetPreflightAdminProofPath,
  FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE:
    devTestGameHostedEvidenceLanePath,
  FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_ADMIN_PROOF:
    devTestGameHostedEvidenceLaneAdminProofPath,
  FMARCH_DEV_TEST_GAME_PROOF_GRAPH: devTestGameProofGraphPath,
  FMARCH_DEV_TEST_GAME_PROOF_GRAPH_ADMIN_PROOF: devTestGameProofGraphAdminProofPath,
  FMARCH_DEV_TEST_GAME_PROOF_FRESHNESS_ADMIN_PROOF: proofFreshnessAdminProofPath,
  FMARCH_DEV_TEST_GAME_NEXT_ACTION_ADMIN_PROOF: nextActionAdminProofPath,
};

export const adminSpineTerminalBatchReadinessEvidenceEnv = {
  ...adminSpineReadinessEvidenceEnv,
  FMARCH_DEV_TEST_GAME_ADMIN_SPINE_TERMINAL_BATCHES:
    adminSpineTerminalBatchProofPath,
};

export const adminSpinePreGraphReadinessEvidenceEnv = Object.fromEntries(
  Object.entries(adminSpineReadinessEvidenceEnv).filter(
    ([key]) =>
      ![
        "FMARCH_DEV_TEST_GAME_PROOF_GRAPH",
        "FMARCH_DEV_TEST_GAME_PROOF_GRAPH_ADMIN_PROOF",
        "FMARCH_DEV_TEST_GAME_PROOF_FRESHNESS_ADMIN_PROOF",
        "FMARCH_DEV_TEST_GAME_NEXT_ACTION_ADMIN_PROOF",
      ].includes(key),
  ),
);

export const adminSpineHostedOpsInputReadinessEnv = {
  FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
  FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX:
    devTestGameHostedConcurrentRaceMatrixPath,
};

export const terminalAdminProofBatchPlan = {
  label: "Terminal admin proof batch",
  reason: "terminal graph, freshness, and next-action admin surfaces share the generated proof graph inputs",
  cases: [
    proofGraphAdminProofCase,
    proofFreshnessAdminProofCase,
    nextActionAdminProofCase,
  ],
};

export const terminalRefreshAdminProofBatchPlan = {
  label: "Terminal refresh admin proof batch",
  reason: "freshness and next-action admin surfaces share the refreshed next-action input",
  cases: [proofFreshnessAdminProofCase, nextActionAdminProofCase],
};

export const devTestGameAdminSpinePlan = [
  { kind: "node", script: "tools/dev_test_game_race_coverage.mjs" },
  releaseReadinessStep({
    reason: "race-coverage-for-hosted-matrix",
    changedInputs: [devTestGameRaceCoveragePath],
  }),
  {
    kind: "node",
    script: "tools/dev_test_game_hosted_concurrent_race_matrix.mjs",
  },
  { kind: "node", script: "tools/dev_test_game_ops_artifacts.mjs" },
  releaseReadinessStep({
    reason: "hosted-matrix-and-ops-inputs-for-hosted-signals",
    changedInputs: [
      devTestGameHostedConcurrentRaceMatrixPath,
      devTestGameOpsArtifactsPath,
    ],
    env: adminSpineHostedOpsInputReadinessEnv,
  }),
  { kind: "node", script: "tools/dev_test_game_hosted_identity_evidence.mjs" },
  {
    kind: "node",
    script: "tools/dev_test_game_hosted_identity_progression_summary.mjs",
  },
  { kind: "node", script: "tools/dev_test_game_hosted_target_preflight.mjs" },
  { kind: "node", script: "tools/dev_test_game_hosted_evidence_lane.mjs" },
  {
    kind: "node",
    script: "tools/dev_test_game_hosted_evidence_lane_demo_proof.mjs",
  },
  { kind: "node", script: "tools/dev_test_game_hosted_ops_signals.mjs" },
  {
    kind: "node",
    script: "tools/dev_test_game_real_hosted_observability_handoff.mjs",
  },
  { kind: "node", script: "tools/dev_test_game_release_runbook.mjs" },
  { kind: "custom", script: "admin-spine-proof", label: "Admin spine proof" },
  { kind: "node", script: "tools/dev_test_game_admin_spine_admin_proof.mjs" },
  releaseReadinessStep({
    reason: "pre-graph-admin-surface-rollup",
    changedInputs: [
      devTestGameHostedConcurrentRaceMatrixPath,
      devTestGameHostedIdentityEvidencePath,
      devTestGameHostedIdentityProgressionSummaryPath,
      devTestGameHostedTargetPreflightPath,
      devTestGameHostedEvidenceLanePath,
      "target/dev-test-game/hosted-evidence-lane-demo-proof.json",
      devTestGameHostedOpsSignalsPath,
      devTestGameRealHostedObservabilityHandoffPath,
      "target/dev-test-game/release-runbook.json",
      adminSpineProofPath,
      "target/dev-test-game/admin-spine-admin-proof.json",
    ],
    env: adminSpinePreGraphReadinessEvidenceEnv,
  }),
  { kind: "node", script: "tools/dev_test_game_spine_manifest.mjs" },
  { kind: "node", script: "tools/dev_test_game_next_action.mjs" },
  { kind: "node", script: "tools/dev_test_game_proof_graph.mjs" },
  {
    kind: "custom",
    script: "terminal-admin-proof-batch",
    label: "Terminal admin proof batch",
  },
  releaseReadinessStep({
    reason: "terminal-graph-and-local-dependency-surfaces",
    changedInputs: [
      "target/dev-test-game/spine-manifest.json",
      "target/dev-test-game/next-action.json",
      devTestGameProofGraphPath,
      devTestGameProofGraphAdminProofPath,
      proofFreshnessAdminProofPath,
      nextActionAdminProofPath,
    ],
    env: adminSpineReadinessEvidenceEnv,
  }),
  { kind: "node", script: "tools/dev_test_game_next_action.mjs" },
  {
    kind: "custom",
    script: "terminal-refresh-admin-proof-batch",
    label: "Terminal refresh admin proof batch",
  },
  { kind: "node", script: "tools/dev_test_game_proof_graph.mjs" },
  { kind: "node", script: "tools/dev_test_game_proof_graph_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_next_action.mjs" },
  { kind: "node", script: "tools/dev_test_game_next_action_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_admin_spine_admin_proof.mjs" },
  releaseReadinessStep({
    reason: "terminal-batch-proof-graph-and-next-action-refresh",
    changedInputs: [
      "target/dev-test-game/next-action.json",
      devTestGameProofGraphPath,
      devTestGameProofGraphAdminProofPath,
      proofFreshnessAdminProofPath,
      nextActionAdminProofPath,
      adminSpineTerminalBatchProofPath,
      "target/dev-test-game/admin-spine-admin-proof.json",
    ],
    env: adminSpineTerminalBatchReadinessEvidenceEnv,
  }),
];

export async function runDevTestGameAdminSpine() {
  const terminalBatchEvidence = [];
  await clearAdminSpineTerminalBatchProof();
  await runSpinePlan(devTestGameAdminSpinePlan, {
    custom: {
      "admin-spine-proof": async () => {
        const evidence = await runAdminSpineProof();
        console.log(`wrote ${adminSpineProofPath} (${evidence.status})`);
      },
      "terminal-admin-proof-batch": async () => {
        terminalBatchEvidence.push(
          await runAdminAuditProofBatchPlan(terminalAdminProofBatchPlan),
        );
      },
      "terminal-refresh-admin-proof-batch": async () => {
        terminalBatchEvidence.push(
          await runAdminAuditProofBatchPlan(terminalRefreshAdminProofBatchPlan),
        );
        const evidence = await writeAdminSpineTerminalBatchProof(
          terminalBatchEvidence,
        );
        console.log(
          `wrote ${adminSpineTerminalBatchProofPath} (${evidence.status})`,
        );
      },
    },
  });
}

async function clearAdminSpineTerminalBatchProof() {
  await rm(path.join(repoRoot, adminSpineTerminalBatchProofPath), {
    force: true,
  });
}

async function writeAdminSpineTerminalBatchProof(batches) {
  const evidence = {
    version: 1,
    proof: "dev-test-game-admin-spine-terminal-batches",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: new Date().toISOString(),
    scope: "local-dev-test-game-admin-spine-terminal-batches",
    proofBoundary:
      "Local admin spine terminal proof-batch receipt. It records the batched browser proofs for proof graph, proof freshness, and next-action admin surfaces after the terminal graph/refresh phase; it does not prove hosted deployment, hosted operations, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      adminSpineProof: adminSpineProofPath,
      proofGraph: devTestGameProofGraphPath,
      nextAction: "target/dev-test-game/next-action.json",
      proofFreshnessAdminProof: proofFreshnessAdminProofPath,
      nextActionAdminProof: nextActionAdminProofPath,
      batchCount: batches.length,
    },
    batches,
  };
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(repoRoot, adminSpineTerminalBatchProofPath),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return evidence;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameAdminSpine();
}
