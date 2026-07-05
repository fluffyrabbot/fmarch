import { pathToFileURL } from "node:url";
import {
  devTestGameBackupAdminProofPath,
  devTestGameSeedAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  devTestGameBackupRestoreDumpPath,
  devTestGameBackupRestoreProofPath,
  devTestGameOpsArtifactsPath,
  devTestGameSeedFixturePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import { releaseReadinessStep } from "./dev_test_game_spine_readiness_steps.mjs";
import { runSpinePlan } from "./dev_test_game_spine_runner.mjs";

export const backupRestoreEvidenceEnv = {
  FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF:
    devTestGameBackupRestoreProofPath,
  FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP:
    devTestGameBackupRestoreDumpPath,
};

export const backupAwareOpsEnv = {
  FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_PROOF:
    backupRestoreEvidenceEnv.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF,
  FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_DUMP:
    backupRestoreEvidenceEnv.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP,
};

export const opsReadinessEnv = {
  ...backupRestoreEvidenceEnv,
  FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: devTestGameOpsArtifactsPath,
};

export const seedReadinessEnv = {
  FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY: devTestGameSeedFixturePath,
  FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF: devTestGameSeedAdminProofPath,
};

export const backupRestoreFinalReadinessEnv = {
  ...backupRestoreEvidenceEnv,
  FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF:
    devTestGameBackupAdminProofPath,
  FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: opsReadinessEnv.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS,
  FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
    seedReadinessEnv.FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY,
  FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF:
    seedReadinessEnv.FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF,
};

export const devTestGameBackupRestoreSpinePlan = [
  { kind: "node", script: "tools/live_stack_backup_restore_drill.mjs" },
  releaseReadinessStep({
    reason: "backup-restore-evidence-for-ops-artifacts",
    changedInputs: [
      devTestGameBackupRestoreProofPath,
      devTestGameBackupRestoreDumpPath,
    ],
    env: backupRestoreEvidenceEnv,
  }),
  {
    kind: "node",
    script: "tools/dev_test_game_ops_artifacts.mjs",
    env: backupAwareOpsEnv,
  },
  releaseReadinessStep({
    reason: "ops-artifact-bundle-for-seed-fixtures",
    changedInputs: [devTestGameOpsArtifactsPath],
    env: opsReadinessEnv,
  }),
  { kind: "node", script: "tools/dev_test_game_seed_fixture_summary.mjs" },
  { kind: "node", script: "tools/dev_test_game_seed_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_backup_admin_proof.mjs" },
  releaseReadinessStep({
    reason: "backup-seed-and-admin-surfaces-final",
    changedInputs: [
      devTestGameSeedFixturePath,
      devTestGameSeedAdminProofPath,
      devTestGameBackupAdminProofPath,
    ],
    env: backupRestoreFinalReadinessEnv,
  }),
];

export async function runDevTestGameBackupRestoreSpine() {
  await runSpinePlan(devTestGameBackupRestoreSpinePlan);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameBackupRestoreSpine();
}
