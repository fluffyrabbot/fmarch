import { pathToFileURL } from "node:url";
import { runNodeScript } from "./dev_test_game_spine_runner.mjs";

export const backupRestoreEvidenceEnv = {
  FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF:
    "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
  FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP:
    "target/live-stack-backup-restore-drill/local-live-stack.dump",
};

export const backupAwareOpsEnv = {
  FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_PROOF:
    backupRestoreEvidenceEnv.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF,
  FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_DUMP:
    backupRestoreEvidenceEnv.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP,
};

export const opsReadinessEnv = {
  ...backupRestoreEvidenceEnv,
  FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: "target/dev-test-game/ops-artifacts.json",
};

export const seedReadinessEnv = {
  FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
    "target/dev-test-game/seed-fixture-summary.json",
  FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF: "target/dev-test-game/seed-admin-proof.json",
};

export const backupRestoreFinalReadinessEnv = {
  ...backupRestoreEvidenceEnv,
  FMARCH_DEV_TEST_GAME_BACKUP_ADMIN_PROOF:
    "target/dev-test-game/backup-admin-proof.json",
  FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: opsReadinessEnv.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS,
  FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY:
    seedReadinessEnv.FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY,
  FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF:
    seedReadinessEnv.FMARCH_DEV_TEST_GAME_SEED_ADMIN_PROOF,
};

export const devTestGameBackupRestoreSpinePlan = [
  { script: "tools/live_stack_backup_restore_drill.mjs" },
  {
    script: "tools/dev_test_game_release_readiness.mjs",
    env: backupRestoreEvidenceEnv,
  },
  { script: "tools/dev_test_game_ops_artifacts.mjs", env: backupAwareOpsEnv },
  { script: "tools/dev_test_game_release_readiness.mjs", env: opsReadinessEnv },
  { script: "tools/dev_test_game_seed_fixture_summary.mjs" },
  { script: "tools/dev_test_game_seed_admin_proof.mjs" },
  { script: "tools/dev_test_game_release_readiness.mjs", env: seedReadinessEnv },
  { script: "tools/dev_test_game_backup_admin_proof.mjs" },
  {
    script: "tools/dev_test_game_release_readiness.mjs",
    env: backupRestoreFinalReadinessEnv,
  },
];

export async function runDevTestGameBackupRestoreSpine() {
  for (const step of devTestGameBackupRestoreSpinePlan) {
    await runNodeScript(step.script, { env: step.env });
  }
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameBackupRestoreSpine();
}
