import { pathToFileURL } from "node:url";
import { runDevTestGameAdminSpine } from "./dev_test_game_admin_spine.mjs";
import { runDevTestGameBackupRestoreSpine } from "./dev_test_game_backup_restore_spine.mjs";
import { runDevTestGameIdentitySpine } from "./dev_test_game_identity_spine.mjs";
import { runSpinePlan } from "./dev_test_game_spine_runner.mjs";

export const devTestGameCoreLiveSpinePlan = [
  { kind: "npm", script: "dev:test-game:prebuild" },
  { kind: "node", script: "tools/dev_test_game_live_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_proof_contract.mjs" },
  { kind: "node", script: "tools/dev_test_game_core_loop_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_hardening_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_release_readiness.mjs" },
];

export const devTestGameLiveSpinePlan = [
  ...devTestGameCoreLiveSpinePlan,
  { kind: "node", script: "tools/dev_test_game_seed_fixture_summary.mjs" },
  { kind: "node", script: "tools/dev_test_game_seed_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_release_readiness.mjs" },
  { kind: "custom", script: "backup-restore", label: "Backup/restore spine" },
  { kind: "custom", script: "identity", label: "Identity spine" },
  { kind: "custom", script: "admin", label: "Admin spine" },
];

export async function runDevTestGameCoreLiveSpine() {
  await runSpinePlan(devTestGameCoreLiveSpinePlan);
}

export async function runDevTestGameLiveSpine() {
  await runSpinePlan(devTestGameLiveSpinePlan, {
    custom: {
      "backup-restore": runDevTestGameBackupRestoreSpine,
      identity: runDevTestGameIdentitySpine,
      admin: runDevTestGameAdminSpine,
    },
  });
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  if (process.argv.includes("--core")) {
    await runDevTestGameCoreLiveSpine();
  } else {
    await runDevTestGameLiveSpine();
  }
}
