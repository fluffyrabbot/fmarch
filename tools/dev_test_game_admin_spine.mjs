import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runAdminSpineProof } from "./dev_test_game_admin_spine_proof.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminSpineProofPath = "target/dev-test-game/admin-spine-proof.json";

const readinessEvidenceEnv = {
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
  FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF: "target/dev-test-game/admin-spine-proof.json",
};

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameAdminSpine();
}

export async function runDevTestGameAdminSpine() {
  const evidence = await runAdminSpineProof();
  console.log(`wrote ${adminSpineProofPath} (${evidence.status})`);
  await runNodeScript("tools/dev_test_game_release_readiness.mjs", {
    env: readinessEvidenceEnv,
  });
}

function runNodeScript(scriptPath, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env,
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptPath} exited with code ${code}`));
      }
    });
  });
}
