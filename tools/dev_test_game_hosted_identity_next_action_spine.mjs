import { pathToFileURL } from "node:url";
import {
  devTestGameHostedIdentityEvidencePath,
  devTestGameHostedIdentityProgressionSummaryPath,
} from "./dev_test_game_hosted_identity_evidence.mjs";
import {
  devTestGameIdentityAdapterProofPath,
  devTestGameOpsArtifactsPath,
  devTestGameSeedFixturePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  devTestGameIdentityAdminProofPath,
  devTestGameSeedAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  nextActionAdminProofPath,
  nextActionPath,
} from "./dev_test_game_next_action_paths.mjs";
import { devTestGameHostedIdentitySequenceStage } from "./dev_test_game_next_action.mjs";
import { releaseReadinessStep } from "./dev_test_game_spine_readiness_steps.mjs";
import {
  devTestGameNextActionScript,
  runSpinePlan,
} from "./dev_test_game_spine_runner.mjs";
import { identityReadinessEnv } from "./dev_test_game_identity_spine.mjs";

export const devTestGameHostedIdentityNextActionSpinePlan = [
  releaseReadinessStep({
    reason: "hosted-identity-sequence-local-capability-confidence",
    changedInputs: [
      devTestGameOpsArtifactsPath,
      devTestGameSeedFixturePath,
      devTestGameSeedAdminProofPath,
      devTestGameIdentityAdapterProofPath,
      devTestGameIdentityAdminProofPath,
      devTestGameHostedIdentityEvidencePath,
      devTestGameHostedIdentityProgressionSummaryPath,
    ],
    env: identityReadinessEnv,
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
    reason: "hosted-identity-sequence-next-action-admin-proof",
    changedInputs: [nextActionPath, nextActionAdminProofPath],
    env: identityReadinessEnv,
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
    reason: "hosted-identity-sequence-final-action-proof",
    changedInputs: [nextActionPath, nextActionAdminProofPath],
    env: identityReadinessEnv,
  }),
];

export async function runDevTestGameHostedIdentityNextActionSpine() {
  await runSpinePlan(devTestGameHostedIdentityNextActionSpinePlan);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameHostedIdentityNextActionSpine();
}
