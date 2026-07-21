import { pathToFileURL } from "node:url";
import { readinessEvidenceEnv } from "./dev_test_game_spine_artifact_dependencies.mjs";
import { releaseReadinessStep } from "./dev_test_game_spine_readiness_steps.mjs";
import { runSpinePlan } from "./dev_test_game_spine_runner.mjs";

const opsSpineReadinessArtifactIds = ["opsArtifacts", "opsAdminProof"];

export const opsSpineReadinessEnv = readinessEvidenceEnv(
  opsSpineReadinessArtifactIds,
);

export const devTestGameOpsSpinePlan = [
  { kind: "node", script: "tools/dev_test_game_ops_artifacts.mjs" },
  { kind: "node", script: "tools/dev_test_game_ops_admin_proof.mjs" },
  releaseReadinessStep({
    reason: "ops-artifacts-and-admin-surface",
    changedArtifactIds: opsSpineReadinessArtifactIds,
    env: opsSpineReadinessEnv,
  }),
];

export async function runDevTestGameOpsSpine() {
  await runSpinePlan(devTestGameOpsSpinePlan);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameOpsSpine();
}
