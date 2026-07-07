import { pathToFileURL } from "node:url";
import {
  devTestGameHostedEvidenceOperatorChecklistAdminProofPath,
  devTestGameHostedEvidenceOperatorChecklistProofPath,
  devTestGameHostedTargetPreflightPath,
  devTestGameRealHostedMatrixRawCapturePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  nextActionAdminProofPath,
  nextActionPath,
} from "./dev_test_game_next_action_paths.mjs";
import { devTestGameHostedIdentitySequenceStage } from "./dev_test_game_next_action.mjs";
import { identityReadinessEnv } from "./dev_test_game_identity_spine.mjs";
import { releaseReadinessStep } from "./dev_test_game_spine_readiness_steps.mjs";
import {
  devTestGameNextActionScript,
  runSpinePlan,
} from "./dev_test_game_spine_runner.mjs";

export const realHostedMatrixRawCaptureReadinessEnv = {
  ...identityReadinessEnv,
  FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_OPERATOR_CHECKLIST_PROOF:
    devTestGameHostedEvidenceOperatorChecklistProofPath,
  FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_OPERATOR_CHECKLIST_ADMIN_PROOF:
    devTestGameHostedEvidenceOperatorChecklistAdminProofPath,
  FMARCH_DEV_TEST_GAME_REAL_HOSTED_MATRIX_RAW_CAPTURE:
    devTestGameRealHostedMatrixRawCapturePath,
  FMARCH_DEV_TEST_GAME_NEXT_ACTION_ADMIN_PROOF: nextActionAdminProofPath,
};

export const devTestGameRealHostedMatrixRawCaptureSpinePlan = [
  {
    kind: "node",
    script: "tools/dev_test_game_real_hosted_matrix_raw_capture.mjs",
  },
  releaseReadinessStep({
    reason: "real-hosted-matrix-raw-capture-intake",
    changedInputs: [devTestGameRealHostedMatrixRawCapturePath],
    env: realHostedMatrixRawCaptureReadinessEnv,
  }),
  {
    kind: "node",
    script: devTestGameNextActionScript,
    env: {
      FMARCH_DEV_TEST_GAME_SEQUENCE_STAGE:
        devTestGameHostedIdentitySequenceStage,
    },
  },
  { kind: "node", script: "tools/dev_test_game_next_action_admin_proof.mjs" },
  releaseReadinessStep({
    reason: "real-hosted-matrix-raw-capture-next-action-admin-proof",
    changedInputs: [
      devTestGameRealHostedMatrixRawCapturePath,
      nextActionPath,
      nextActionAdminProofPath,
    ],
    env: realHostedMatrixRawCaptureReadinessEnv,
  }),
  {
    kind: "node",
    script: "tools/dev_test_game_hosted_target_preflight.mjs",
  },
  releaseReadinessStep({
    reason: "real-hosted-matrix-raw-capture-target-preflight",
    changedInputs: [
      devTestGameRealHostedMatrixRawCapturePath,
      devTestGameHostedTargetPreflightPath,
    ],
    env: realHostedMatrixRawCaptureReadinessEnv,
  }),
  {
    kind: "node",
    script: devTestGameNextActionScript,
    env: {
      FMARCH_DEV_TEST_GAME_SEQUENCE_STAGE:
        devTestGameHostedIdentitySequenceStage,
    },
  },
  { kind: "node", script: "tools/dev_test_game_next_action_admin_proof.mjs" },
  releaseReadinessStep({
    reason: "real-hosted-matrix-raw-capture-final-action-proof",
    changedInputs: [
      devTestGameRealHostedMatrixRawCapturePath,
      nextActionPath,
      nextActionAdminProofPath,
    ],
    env: realHostedMatrixRawCaptureReadinessEnv,
  }),
];

export async function runDevTestGameRealHostedMatrixRawCaptureSpine() {
  await runSpinePlan(devTestGameRealHostedMatrixRawCaptureSpinePlan);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameRealHostedMatrixRawCaptureSpine();
}
