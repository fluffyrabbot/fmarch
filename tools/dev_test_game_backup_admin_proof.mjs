import path from "node:path";
import { validateDevTestGameBackupRestoreProof } from "./dev_test_game_release_readiness.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const backupProofPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF ??
    "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
);
const backupDumpPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP ??
    "target/live-stack-backup-restore-drill/local-live-stack.dump",
);
const backupProofRelativePath = path.relative(repoRoot, backupProofPath);
const backupDumpRelativePath = path.relative(repoRoot, backupDumpPath);
const evidencePath = path.join(artifactDir, "backup-admin-proof.json");
const requiredChecks = [
  "dump-created",
  "event-log-restored",
  "projection-fingerprints-restored",
  "auth-sessions-restored",
  "restored-api-capabilities",
];
const requiredSessions = ["host", "player", "admin"];

await runAdminAuditProof({
  smokeName: "dev-test-game-backup-admin-proof",
  stage: "backup-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_PROOF: backupProofRelativePath,
    FMARCH_DEV_TEST_GAME_BACKUP_RESTORE_DUMP: backupDumpRelativePath,
  },
  loadSource: async () => {
    const backupProof = await readJson(backupProofPath);
    validateDevTestGameBackupRestoreProof(backupProof, {
      proofPath: backupProofRelativePath,
      dumpPath: backupDumpRelativePath,
    });
    return backupProof;
  },
  prove: async ({ browser, frontendBaseUrl, source: backupProof }) =>
    await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: backupProof.game,
      auditId: "local-backup-restore",
      requiredChecks,
      requiredSessions,
    }),
  buildEvidence: ({ source: backupProof, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-backup-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-backup-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game backup/restore drill proof. Proves the local backup/restore drill is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with drill checks and restored role sessions visible; it does not prove hosted backup storage, PITR, key escrow, cross-region restore, multi-node failover, beta readiness, or production readiness.",
    generatedFrom: {
      backupRestoreProof: backupProofRelativePath,
      backupRestoreDump: backupDumpRelativePath,
      game: backupProof.game,
    },
    adminRoleSurface,
  }),
  assertEvidence: assertBackupAdminProof,
});

export function assertBackupAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-backup-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-backup-admin-surface"
  ) {
    throw new Error("backup admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("backup admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`backup admin proof missing visible check: ${checkId}`);
    }
  }
  for (const sessionRole of requiredSessions) {
    if (!evidence.adminRoleSurface?.visibleSessions?.includes(sessionRole)) {
      throw new Error(`backup admin proof missing visible session: ${sessionRole}`);
    }
  }
  return evidence;
}
