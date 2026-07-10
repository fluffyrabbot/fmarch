import { pathToFileURL } from "node:url";
import { readinessEvidenceEnv } from "./dev_test_game_ops_artifact_dependencies.mjs";
import { releaseReadinessStep } from "./dev_test_game_spine_readiness_steps.mjs";
import { runSpinePlan } from "./dev_test_game_spine_runner.mjs";

const seedFixtureReadinessArtifactIds = ["seedFixture", "seedAdminProof"];

export const seedFixtureSpineEnv = readinessEvidenceEnv(
  seedFixtureReadinessArtifactIds,
);

export const devTestGameSeedFixtureSpinePlan = [
  { kind: "node", script: "tools/dev_test_game_seed_fixture_summary.mjs" },
  { kind: "node", script: "tools/dev_test_game_seed_admin_proof.mjs" },
  releaseReadinessStep({
    reason: "seed-fixture-and-admin-surface",
    changedArtifactIds: seedFixtureReadinessArtifactIds,
    env: seedFixtureSpineEnv,
  }),
  {
    kind: "node",
    script: "tools/dev_test_game_next_action.mjs",
    env: seedFixtureSpineEnv,
  },
];

export async function runDevTestGameSeedFixtureSpine() {
  await runSpinePlan(devTestGameSeedFixtureSpinePlan);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameSeedFixtureSpine();
}
