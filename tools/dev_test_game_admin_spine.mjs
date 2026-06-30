import { pathToFileURL } from "node:url";
import { devTestGameRaceCoveragePath } from "./dev_test_game_race_coverage.mjs";
import { devTestGameHostedConcurrentRaceMatrixPath } from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import { runAdminSpineProof } from "./dev_test_game_admin_spine_proof.mjs";
import {
  devTestGameProofGraphAdminProofPath,
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import { runNodeScript } from "./dev_test_game_spine_runner.mjs";

export const adminSpineProofPath = "target/dev-test-game/admin-spine-proof.json";

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
  FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: "target/dev-test-game/ops-artifacts.json",
  FMARCH_DEV_TEST_GAME_OPS_ADMIN_PROOF: "target/dev-test-game/ops-admin-proof.json",
  FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
    "target/dev-test-game/seed-fixture-summary.json",
  FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF: "target/dev-test-game/seed-admin-proof.json",
  FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF:
    "target/auth-invite-role-proof/invite-role-proof.json",
  FMARCH_DEV_TEST_GAME_IDENTITY_ADMIN_PROOF:
    "target/dev-test-game/identity-admin-proof.json",
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
  FMARCH_DEV_TEST_GAME_PROOF_GRAPH: devTestGameProofGraphPath,
  FMARCH_DEV_TEST_GAME_PROOF_GRAPH_ADMIN_PROOF: devTestGameProofGraphAdminProofPath,
};

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameAdminSpine();
}

export async function runDevTestGameAdminSpine() {
  await runNodeScript("tools/dev_test_game_race_coverage.mjs");
  await runNodeScript("tools/dev_test_game_release_readiness.mjs");
  await runNodeScript("tools/dev_test_game_hosted_concurrent_race_matrix.mjs");
  const evidence = await runAdminSpineProof();
  console.log(`wrote ${adminSpineProofPath} (${evidence.status})`);
  await runNodeScript("tools/dev_test_game_admin_spine_admin_proof.mjs");
  await runNodeScript("tools/dev_test_game_release_readiness.mjs", {
    env: adminSpineReadinessEvidenceEnv,
  });
  await runNodeScript("tools/dev_test_game_spine_manifest.mjs");
  await runNodeScript("tools/dev_test_game_next_action.mjs");
  await runNodeScript("tools/dev_test_game_proof_graph.mjs");
  await runNodeScript("tools/dev_test_game_proof_graph_admin_proof.mjs");
  await runNodeScript("tools/dev_test_game_proof_freshness_admin_proof.mjs");
  await runNodeScript("tools/dev_test_game_next_action_admin_proof.mjs");
}
