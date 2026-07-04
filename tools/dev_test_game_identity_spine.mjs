import { pathToFileURL } from "node:url";
import {
  devTestGameHostedIdentityEvidencePath,
} from "./dev_test_game_hosted_identity_evidence.mjs";
import { runSpinePlan } from "./dev_test_game_spine_runner.mjs";

export const identityReadinessEnv = {
  FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: "target/dev-test-game/ops-artifacts.json",
  FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
    "target/dev-test-game/seed-fixture-summary.json",
  FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF:
    "target/auth-invite-role-proof/invite-role-proof.json",
  FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF:
    "target/dev-test-game/identity-admin-proof.json",
  FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE:
    devTestGameHostedIdentityEvidencePath,
};

export const devTestGameIdentitySpinePlan = [
  { kind: "node", script: "tools/auth_invite_role_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_identity_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_hosted_identity_evidence.mjs" },
  {
    kind: "node",
    script: "tools/dev_test_game_release_readiness.mjs",
    env: identityReadinessEnv,
  },
];

export async function runDevTestGameIdentitySpine() {
  await runSpinePlan(devTestGameIdentitySpinePlan);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameIdentitySpine();
}
