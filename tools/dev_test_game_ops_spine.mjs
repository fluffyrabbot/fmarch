import { pathToFileURL } from "node:url";
import {
  devTestGameOpsAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  devTestGameOpsArtifactsPath,
} from "./dev_test_game_ops_artifacts.mjs";
import { releaseReadinessStep } from "./dev_test_game_spine_readiness_steps.mjs";
import { runSpinePlan } from "./dev_test_game_spine_runner.mjs";

export const opsSpineReadinessEnv = {
  FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
  FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF: devTestGameOpsAdminProofPath,
};

export const devTestGameOpsSpinePlan = [
  { kind: "node", script: "tools/dev_test_game_ops_artifacts.mjs" },
  { kind: "node", script: "tools/dev_test_game_ops_admin_proof.mjs" },
  releaseReadinessStep({
    reason: "ops-artifacts-and-admin-surface",
    changedInputs: [devTestGameOpsArtifactsPath, devTestGameOpsAdminProofPath],
    env: opsSpineReadinessEnv,
  }),
];

export async function runDevTestGameOpsSpine() {
  await runSpinePlan(devTestGameOpsSpinePlan);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameOpsSpine();
}
