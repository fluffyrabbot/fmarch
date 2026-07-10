import { pathToFileURL } from "node:url";
import { readinessEvidenceEnv } from "./dev_test_game_ops_artifact_dependencies.mjs";
import { releaseReadinessStep } from "./dev_test_game_spine_readiness_steps.mjs";
import { runSpinePlan } from "./dev_test_game_spine_runner.mjs";

const backupRestoreReadinessArtifactIds = [
  "backupRestoreProof",
  "backupRestoreDump",
];
const opsReadinessArtifactIds = [
  ...backupRestoreReadinessArtifactIds,
  "opsArtifacts",
];
const seedReadinessArtifactIds = ["seedFixture", "seedAdminProof"];
const backupRestoreFinalReadinessArtifactIds = [
  ...backupRestoreReadinessArtifactIds,
  "backupAdminProof",
  "opsArtifacts",
  ...seedReadinessArtifactIds,
];

export const backupRestoreEvidenceEnv = readinessEvidenceEnv(
  backupRestoreReadinessArtifactIds,
);

export const backupAwareOpsEnv = {
  FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_PROOF:
    backupRestoreEvidenceEnv.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF,
  FMARCH_DEV_TEST_GAME_OPS_BACKUP_RESTORE_DUMP:
    backupRestoreEvidenceEnv.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP,
};

export const opsReadinessEnv = readinessEvidenceEnv(opsReadinessArtifactIds);

export const seedReadinessEnv = readinessEvidenceEnv(seedReadinessArtifactIds);

export const backupRestoreFinalReadinessEnv = readinessEvidenceEnv(
  backupRestoreFinalReadinessArtifactIds,
);

export const devTestGameBackupRestoreSpinePlan = [
  { kind: "node", script: "tools/live_stack_backup_restore_drill.mjs" },
  {
    kind: "node",
    script: "tools/dev_test_game_ops_artifacts.mjs",
    env: backupAwareOpsEnv,
  },
  releaseReadinessStep({
    reason: "backup-and-ops-artifacts-for-seed-fixtures",
    changedArtifactIds: opsReadinessArtifactIds,
    env: opsReadinessEnv,
  }),
  { kind: "node", script: "tools/dev_test_game_seed_fixture_summary.mjs" },
  { kind: "node", script: "tools/dev_test_game_seed_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_backup_admin_proof.mjs" },
  releaseReadinessStep({
    reason: "backup-seed-and-admin-surfaces-final",
    changedArtifactIds: [
      ...seedReadinessArtifactIds,
      "backupAdminProof",
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
