import { pathToFileURL } from "node:url";
import { runDevTestGameAdminSpine } from "./dev_test_game_admin_spine.mjs";
import { runDevTestGameBackupRestoreSpine } from "./dev_test_game_backup_restore_spine.mjs";
import { runDevTestGameIdentitySpine } from "./dev_test_game_identity_spine.mjs";
import { runNodeScript, runNpmScript } from "./dev_test_game_spine_runner.mjs";

export const devTestGameLiveSpinePlan = [
  { kind: "npm", script: "dev:test-game:prebuild" },
  { kind: "node", script: "tools/dev_test_game_live_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_proof_contract.mjs" },
  { kind: "node", script: "tools/dev_test_game_core_loop_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_release_readiness.mjs" },
  { kind: "node", script: "tools/dev_test_game_seed_fixture_summary.mjs" },
  { kind: "node", script: "tools/dev_test_game_seed_admin_proof.mjs" },
  { kind: "node", script: "tools/dev_test_game_release_readiness.mjs" },
  { kind: "spine", script: "backup-restore" },
  { kind: "spine", script: "identity" },
  { kind: "spine", script: "admin" },
];

export async function runDevTestGameLiveSpine() {
  for (const step of devTestGameLiveSpinePlan) {
    await runLiveSpineStep(step);
  }
}

async function runLiveSpineStep(step) {
  if (step.kind === "npm") {
    await runNpmScript(step.script);
  } else if (step.kind === "node") {
    await runNodeScript(step.script);
  } else if (step.script === "backup-restore") {
    await runDevTestGameBackupRestoreSpine();
  } else if (step.script === "identity") {
    await runDevTestGameIdentitySpine();
  } else if (step.script === "admin") {
    await runDevTestGameAdminSpine();
  } else {
    throw new Error(`unknown live spine step: ${JSON.stringify(step)}`);
  }
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameLiveSpine();
}
