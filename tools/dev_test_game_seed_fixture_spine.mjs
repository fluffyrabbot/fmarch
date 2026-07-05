import { pathToFileURL } from "node:url";
import {
  devTestGameSeedFixturePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  devTestGameSeedAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import { releaseReadinessStep } from "./dev_test_game_spine_readiness_steps.mjs";
import { runSpinePlan } from "./dev_test_game_spine_runner.mjs";

export const seedFixtureSpineEnv = {
  FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY: devTestGameSeedFixturePath,
  FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF: devTestGameSeedAdminProofPath,
};

export const devTestGameSeedFixtureSpinePlan = [
  { kind: "node", script: "tools/dev_test_game_seed_fixture_summary.mjs" },
  { kind: "node", script: "tools/dev_test_game_seed_admin_proof.mjs" },
  releaseReadinessStep({
    reason: "seed-fixture-and-admin-surface",
    changedInputs: [devTestGameSeedFixturePath, devTestGameSeedAdminProofPath],
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
