import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  devTestGameRaceCoverageAdminProofPath,
  devTestGameRaceCoveragePath,
} from "./dev_test_game_race_coverage.mjs";
import { devTestGameHostedConcurrentRaceMatrixPath } from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import { devTestGameHostedEvidenceLanePath } from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  devTestGameHostedEvidenceLaneAdminProofPath,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  devTestGameHostedEvidenceOperatorChecklistAdminProofPath,
} from "./dev_test_game_hosted_evidence_operator_checklist_admin_proof.mjs";
import {
  devTestGameHostedEvidenceOperatorChecklistProofPath,
} from "./dev_test_game_hosted_evidence_operator_checklist.mjs";
import {
  devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath,
} from "./dev_test_game_hosted_evidence_lane_operator_fixture_cases.mjs";
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
import {
  devTestGameHostedConcurrentRaceMatrixAdminProofPath,
} from "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs";
import {
  devTestGameHostedIdentityEvidenceAdminProofPath,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import { runAdminSpineProof } from "./dev_test_game_admin_spine_proof.mjs";
import {
  devTestGameProofGraphAdminProofPath,
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import {
  devTestGameRealHostedObservabilityHandoffAdminProofPath,
  devTestGameRealHostedObservabilityHandoffPath,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  devTestGameReleaseRunbookPath,
  devTestGameReleaseRunbookAdminProofPath,
  devTestGameReleaseAdminProofContractPath,
} from "./dev_test_game_release_artifact_paths.mjs";
import {
  assertReleaseAdminProofContractArtifact,
  devTestGameReleaseAdminProofContractCommand,
} from "./dev_test_game_release_admin_proof_contract.mjs";
import {
  devTestGameAdminSpineAdminProofPath,
  devTestGameBackupAdminProofPath,
  devTestGameCoreLoopAdminProofPath,
  devTestGameHardeningAdminProofPath,
  devTestGameHostSetupAdminProofPath,
  devTestGameIdentityAdminProofPath,
  devTestGameOpsAdminProofPath,
  devTestGameSeedAdminProofPath,
  devTestGameSpineManifestAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  hostedEvidenceOperatorChecklistNextActionPath,
  hostedIdentityNextActionAdminProofPath,
  hostedIdentityNextActionPath,
  nextActionAdminProofPath,
  proofFreshnessAdminProofPath,
} from "./dev_test_game_next_action_paths.mjs";
import {
  devTestGameBackupRestoreDumpPath,
  devTestGameBackupRestoreProofPath,
  devTestGameHostedEvidenceLaneDemoProofPath,
  devTestGameIdentityAdapterProofPath,
  devTestGameSeedFixturePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  adminSpineProofPath,
  adminSpineTerminalBatchProofPath,
  nextActionPath,
  spineManifestPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
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
import {
  terminalAdminProofBatchScript,
  terminalHostedIdentityNextActionAdminProofBatchScript,
  terminalProofGraphReceiptBatchRegistry,
  terminalRefreshAdminProofBatchScript,
} from "./dev_test_game_proof_graph_receipt_artifact_rows.mjs";
import {
  devTestGameNextActionSequenceHandoffPair,
} from "./dev_test_game_next_action_sequence_handoff_pair.mjs";
import {
  devTestGameHostedEvidenceOperatorChecklistHandoffPhaseSteps,
  devTestGameHostedEvidenceOperatorChecklistHandoffPhaseId,
  devTestGameHostedIdentityHandoffPhaseSteps,
  devTestGameHostedIdentityHandoffPhaseId,
} from "./dev_test_game_handoff_phase_outputs.mjs";
export {
  devTestGameHostedEvidenceOperatorChecklistHandoffPhaseId,
  devTestGameHostedIdentityHandoffPhaseId,
} from "./dev_test_game_handoff_phase_outputs.mjs";
import {
  buildSelectedLocalDependencyTerminalReceipt,
  buildSelectedOperatorHandoffTerminalReceipt,
} from "./dev_test_game_terminal_receipts.mjs";
import {
  handoffDescriptorPlanStep,
} from "./dev_test_game_handoff_phase_plan_builder.mjs";
import { releaseReadinessStep } from "./dev_test_game_spine_readiness_steps.mjs";
import {
  handoffPhaseSteps,
  runSpinePlan,
} from "./dev_test_game_spine_runner.mjs";
import {
  devTestGameHostedIdentityProgressionAdminProofBatchScript,
  hostedIdentityProgressionAdminProofBatchArtifactPaths,
} from "./dev_test_game_hosted_identity_progression_admin_proof_batch.mjs";
import {
  adminSpineCustomPlanStep,
  adminSpineProofCustomStep,
  adminSpineTerminalValidationReceiptCustomStep,
} from "./dev_test_game_admin_spine_custom_steps.mjs";

export { adminSpineProofPath, adminSpineTerminalBatchProofPath };

export const adminSpineReadinessEvidenceEnv = {
  FMARCH_DEV_TEST_GAME_CORE_LOOP_ADMIN_PROOF:
    devTestGameCoreLoopAdminProofPath,
  FMARCH_DEV_TEST_GAME_HARDENING_ADMIN_PROOF:
    devTestGameHardeningAdminProofPath,
  FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF:
    devTestGameBackupRestoreProofPath,
  FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP:
    devTestGameBackupRestoreDumpPath,
  FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF:
    devTestGameBackupAdminProofPath,
  FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
  FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF: devTestGameOpsAdminProofPath,
  FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS: devTestGameHostedOpsSignalsPath,
  FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS_ADMIN_PROOF:
    devTestGameHostedOpsSignalsAdminProofPath,
  FMARCH_DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF:
    devTestGameRealHostedObservabilityHandoffPath,
  FMARCH_DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF_ADMIN_PROOF:
    devTestGameRealHostedObservabilityHandoffAdminProofPath,
  FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
    devTestGameSeedFixturePath,
  FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF: devTestGameSeedAdminProofPath,
  FMARCH_DEV_TEST_GAME_HOST_SETUP_ADMIN_PROOF:
    devTestGameHostSetupAdminProofPath,
  FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK:
    devTestGameReleaseRunbookPath,
  FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK_ADMIN_PROOF:
    devTestGameReleaseRunbookAdminProofPath,
  FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF:
    devTestGameIdentityAdapterProofPath,
  FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF:
    devTestGameIdentityAdminProofPath,
  FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE:
    devTestGameHostedIdentityEvidencePath,
  FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_PROGRESSION_SUMMARY:
    devTestGameHostedIdentityProgressionSummaryPath,
  FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_ADMIN_PROOF:
    devTestGameHostedIdentityEvidenceAdminProofPath,
  FMARCH_DEV_TEST_GAME_SPINE_MANIFEST: spineManifestPath,
  FMARCH_DEV_TEST_GAME_SPINE_MANIFEST_ADMIN_PROOF:
    devTestGameSpineManifestAdminProofPath,
  FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF: adminSpineProofPath,
  FMARCH_DEV_TEST_GAME_ADMIN_SPINE_ADMIN_PROOF:
    devTestGameAdminSpineAdminProofPath,
  FMARCH_DEV_TEST_GAME_RACE_COVERAGE: devTestGameRaceCoveragePath,
  FMARCH_DEV_TEST_GAME_RACE_COVERAGE_ADMIN_PROOF:
    devTestGameRaceCoverageAdminProofPath,
  FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX:
    devTestGameHostedConcurrentRaceMatrixPath,
  FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX_ADMIN_PROOF:
    devTestGameHostedConcurrentRaceMatrixAdminProofPath,
  FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT:
    devTestGameHostedTargetPreflightPath,
  FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT_ADMIN_PROOF:
    devTestGameHostedTargetPreflightAdminProofPath,
  FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE:
    devTestGameHostedEvidenceLanePath,
  FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_OPERATOR_CHECKLIST_PROOF:
    devTestGameHostedEvidenceOperatorChecklistProofPath,
  FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_ADMIN_PROOF:
    devTestGameHostedEvidenceLaneAdminProofPath,
  FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_OPERATOR_CHECKLIST_ADMIN_PROOF:
    devTestGameHostedEvidenceOperatorChecklistAdminProofPath,
  FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_OPERATOR_FIXTURE_ADMIN_PROOF:
    devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath,
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
        "FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_OPERATOR_CHECKLIST_PROOF",
        "FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_OPERATOR_CHECKLIST_ADMIN_PROOF",
      ].includes(key),
  ),
);

export const adminSpineHostedOpsInputReadinessEnv = {
  FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
  FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX:
    devTestGameHostedConcurrentRaceMatrixPath,
};

const terminalAdminProofCaseFactories = Object.freeze({
  "proof-graph": proofGraphAdminProofCase,
  "proof-freshness": proofFreshnessAdminProofCase,
  "next-action": nextActionAdminProofCase,
  "hosted-identity-next-action": () =>
    nextActionAdminProofCase({
      nextActionSourcePath: hostedIdentityNextActionPath,
      evidenceSourcePath: hostedIdentityNextActionAdminProofPath,
      smokeName: "dev-test-game-hosted-identity-next-action-admin-proof",
      stage: "hosted-identity-next-action-admin-proof-listen",
    }),
});

export const terminalAdminProofBatchPlan =
  terminalAdminProofBatchPlanForScript(terminalAdminProofBatchScript);

export const terminalRefreshAdminProofBatchPlan =
  terminalAdminProofBatchPlanForScript(terminalRefreshAdminProofBatchScript);

export const terminalHostedIdentityNextActionAdminProofBatchPlan =
  terminalAdminProofBatchPlanForScript(
    terminalHostedIdentityNextActionAdminProofBatchScript,
  );

export const devTestGameHostedEvidenceOperatorChecklistHandoffPhase =
  handoffPhaseSteps({
    phaseId: devTestGameHostedEvidenceOperatorChecklistHandoffPhaseId,
    steps: devTestGameHostedEvidenceOperatorChecklistHandoffPhaseSteps.map(
      (descriptor) =>
        handoffDescriptorPlanStep(descriptor, {
          readinessEnv: adminSpineReadinessEvidenceEnv,
          customPlanForScript: terminalAdminProofBatchPlanForScript,
        }),
    ),
  });

export const devTestGameHostedIdentityHandoffPhase = handoffPhaseSteps({
  phaseId: devTestGameHostedIdentityHandoffPhaseId,
  steps: devTestGameHostedIdentityHandoffPhaseSteps.map(
    (descriptor) =>
      handoffDescriptorPlanStep(descriptor, {
        readinessEnv: adminSpineTerminalBatchReadinessEvidenceEnv,
        customPlanForScript: terminalAdminProofBatchPlanForScript,
      }),
  ),
});

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
  {
    kind: "node",
    script: devTestGameHostedIdentityProgressionAdminProofBatchScript,
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
  adminSpineCustomPlanStep(adminSpineProofCustomStep),
  { kind: "node", script: "tools/dev_test_game_admin_spine_admin_proof.mjs" },
  releaseReadinessStep({
    reason: "pre-graph-admin-surface-rollup",
    changedInputs: [
      devTestGameHostedConcurrentRaceMatrixPath,
      devTestGameHostedIdentityEvidencePath,
      devTestGameHostedIdentityProgressionSummaryPath,
      ...hostedIdentityProgressionAdminProofBatchArtifactPaths,
      devTestGameHostedTargetPreflightPath,
      devTestGameHostedEvidenceLanePath,
      devTestGameHostedEvidenceLaneDemoProofPath,
      devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath,
      devTestGameHostedOpsSignalsPath,
      devTestGameRealHostedObservabilityHandoffPath,
      devTestGameReleaseRunbookPath,
      adminSpineProofPath,
      devTestGameAdminSpineAdminProofPath,
    ],
    env: adminSpinePreGraphReadinessEvidenceEnv,
  }),
  { kind: "node", script: "tools/dev_test_game_spine_manifest.mjs" },
  { kind: "node", script: "tools/dev_test_game_next_action.mjs" },
  ...devTestGameHostedEvidenceOperatorChecklistHandoffPhase,
  { kind: "node", script: "tools/dev_test_game_proof_graph.mjs" },
  adminSpineCustomPlanStep(terminalAdminProofBatchPlan),
  releaseReadinessStep({
    reason: "terminal-graph-and-local-dependency-surfaces",
    changedInputs: [
      spineManifestPath,
      nextActionPath,
      devTestGameProofGraphPath,
      devTestGameProofGraphAdminProofPath,
      proofFreshnessAdminProofPath,
      nextActionAdminProofPath,
    ],
    env: adminSpineReadinessEvidenceEnv,
  }),
  ...devTestGameHostedIdentityHandoffPhase,
  { kind: "node", script: "tools/dev_test_game_next_action.mjs" },
  { kind: "node", script: "tools/dev_test_game_proof_graph.mjs" },
  { kind: "node", script: "tools/dev_test_game_proof_graph_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_next_action.mjs" },
  { kind: "node", script: "tools/dev_test_game_next_action_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_admin_spine_admin_proof.mjs" },
  releaseReadinessStep({
    reason: "terminal-batch-proof-graph-and-next-action-refresh",
    changedInputs: [
      nextActionPath,
      devTestGameProofGraphPath,
      devTestGameProofGraphAdminProofPath,
      proofFreshnessAdminProofPath,
      nextActionAdminProofPath,
      adminSpineTerminalBatchProofPath,
      devTestGameAdminSpineAdminProofPath,
    ],
    env: adminSpineTerminalBatchReadinessEvidenceEnv,
  }),
  { kind: "node", script: "tools/dev_test_game_release_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_release_admin_proof_contract.mjs" },
  adminSpineCustomPlanStep(adminSpineTerminalValidationReceiptCustomStep),
  { kind: "node", script: "tools/dev_test_game_proof_graph.mjs" },
  { kind: "node", script: "tools/dev_test_game_proof_graph_admin_proof.mjs" },
  releaseReadinessStep({
    reason: "terminal-validation-proof-graph-admin-surface",
    changedInputs: [
      adminSpineTerminalBatchProofPath,
      devTestGameProofGraphPath,
      devTestGameProofGraphAdminProofPath,
    ],
    env: adminSpineTerminalBatchReadinessEvidenceEnv,
  }),
  { kind: "node", script: "tools/dev_test_game_next_action.mjs" },
  { kind: "node", script: "tools/dev_test_game_proof_freshness_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_next_action_admin_proof.mjs" },
  releaseReadinessStep({
    reason: "final-next-action-guidance-refresh",
    changedInputs: [
      nextActionPath,
      proofFreshnessAdminProofPath,
      nextActionAdminProofPath,
    ],
    env: adminSpineTerminalBatchReadinessEvidenceEnv,
  }),
];

function terminalAdminProofBatchPlanForScript(script) {
  const batch = terminalProofGraphReceiptBatchRegistry.find(
    (candidate) => candidate.script === script,
  );
  if (batch === undefined) {
    throw new Error(`unknown terminal admin proof batch script: ${script}`);
  }
  return Object.freeze({
    label: batch.label,
    script: batch.script,
    reason: batch.reason,
    cases: Object.freeze(
      batch.proofIds.map((proofId) => {
        const factory = terminalAdminProofCaseFactories[proofId];
        if (factory === undefined) {
          throw new Error(
            `terminal admin proof batch ${batch.label} has unknown proof id: ${proofId}`,
          );
        }
        return factory;
      }),
    ),
  });
}

export async function runDevTestGameAdminSpine() {
  const terminalBatchEvidence = [];
  await clearAdminSpineTerminalBatchProof();
  await runSpinePlan(devTestGameAdminSpinePlan, {
    custom: {
      [adminSpineProofCustomStep.script]: async () => {
        const evidence = await runAdminSpineProof();
        console.log(`wrote ${adminSpineProofPath} (${evidence.status})`);
      },
      [terminalAdminProofBatchPlan.script]: async () => {
        terminalBatchEvidence.push(
          await runAdminAuditProofBatchPlan(terminalAdminProofBatchPlan),
        );
      },
      [terminalHostedIdentityNextActionAdminProofBatchPlan.script]: async () => {
        terminalBatchEvidence.push(
          await runAdminAuditProofBatchPlan(
            terminalHostedIdentityNextActionAdminProofBatchPlan,
          ),
        );
      },
      [terminalRefreshAdminProofBatchPlan.script]: async () => {
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
      [adminSpineTerminalValidationReceiptCustomStep.script]: async () => {
        const evidence = await writeAdminSpineTerminalBatchProof(
          terminalBatchEvidence,
          {
            terminalValidations: [
              await readReleaseAdminProofContractTerminalValidation(),
            ],
          },
        );
        console.log(
          `wrote ${adminSpineTerminalBatchProofPath} (${evidence.status}; ${evidence.terminalValidations.length} terminal validations)`,
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

async function writeAdminSpineTerminalBatchProof(
  batches,
  { terminalValidations = [] } = {},
) {
  const nextAction = await readOptionalJson(path.join(repoRoot, nextActionPath));
  const proofGraph = await readOptionalJson(
    path.join(repoRoot, devTestGameProofGraphPath),
  );
  const normalizedTerminalValidations = terminalValidations.map(
    normalizeTerminalValidation,
  );
  const evidence = {
    version: 1,
    proof: "dev-test-game-admin-spine-terminal-batches",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: new Date().toISOString(),
    scope: "local-dev-test-game-admin-spine-terminal-batches",
    proofBoundary:
      "Local admin spine terminal proof-batch receipt. It records the batched browser proofs for proof graph, proof freshness, and next-action admin surfaces plus terminal artifact validations after the terminal graph/refresh phase; it does not prove hosted deployment, hosted operations, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      adminSpineProof: adminSpineProofPath,
      proofGraph: devTestGameProofGraphPath,
      nextAction: nextActionPath,
      hostedEvidenceOperatorChecklistNextAction:
        hostedEvidenceOperatorChecklistNextActionPath,
      hostedIdentityNextAction: hostedIdentityNextActionPath,
      proofFreshnessAdminProof: proofFreshnessAdminProofPath,
      nextActionAdminProof: nextActionAdminProofPath,
      hostedIdentityNextActionAdminProof:
        hostedIdentityNextActionAdminProofPath,
      ...(normalizedTerminalValidations.length === 0
        ? {}
        : {
            releaseAdminProofContract:
              devTestGameReleaseAdminProofContractPath,
          }),
      batchCount: batches.length,
      terminalValidationCount: normalizedTerminalValidations.length,
    },
    nextActionHandoffPair: devTestGameNextActionSequenceHandoffPair(),
    selectedLocalDependencyTerminalReceipt:
      buildSelectedLocalDependencyTerminalReceipt({ nextAction }),
    selectedOperatorHandoffReceipt:
      buildSelectedOperatorHandoffTerminalReceipt({
        nextAction,
        proofGraph,
      }),
    ...(normalizedTerminalValidations.length === 0
      ? {}
      : { terminalValidations: normalizedTerminalValidations }),
    batches,
  };
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(repoRoot, adminSpineTerminalBatchProofPath),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return evidence;
}

async function readReleaseAdminProofContractTerminalValidation() {
  const contract = assertReleaseAdminProofContractArtifact(
    await readOptionalJson(path.join(repoRoot, devTestGameReleaseAdminProofContractPath)),
  );
  return {
    id: "release-admin-proof-contract",
    label: "Release admin proof diagnostics contract",
    status: contract.status,
    proof: contract.proof,
    command: devTestGameReleaseAdminProofContractCommand,
    artifactPath: devTestGameReleaseAdminProofContractPath,
    validatesArtifacts: [
      contract.generatedFrom.releaseReadinessChecklist,
      contract.generatedFrom.releaseAdminProof,
    ],
    localDiagnosticCount: contract.generatedFrom.localDiagnosticIds.length,
    releaseReady: false,
    productionReady: false,
  };
}

function normalizeTerminalValidation(validation) {
  return {
    id: String(validation.id),
    label: String(validation.label),
    status: String(validation.status),
    proof: String(validation.proof),
    command: String(validation.command),
    artifactPath: String(validation.artifactPath),
    validatesArtifacts: [...(validation.validatesArtifacts ?? [])],
    localDiagnosticCount: Number(validation.localDiagnosticCount),
    releaseReady: validation.releaseReady,
    productionReady: validation.productionReady,
  };
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameAdminSpine();
}
