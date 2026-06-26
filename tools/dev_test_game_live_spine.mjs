import { pathToFileURL } from "node:url";
import { runDevTestGameAdminSpine } from "./dev_test_game_admin_spine.mjs";
import { runDevTestGameBackupRestoreSpine } from "./dev_test_game_backup_restore_spine.mjs";
import { runDevTestGameIdentitySpine } from "./dev_test_game_identity_spine.mjs";
import { runNodeScript, runNpmScript } from "./dev_test_game_spine_runner.mjs";

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameLiveSpine();
}

export async function runDevTestGameLiveSpine() {
  await runNpmScript("dev:test-game:prebuild");
  await runNodeScript("tools/dev_test_game_live_proof.mjs");
  await runNodeScript("tools/dev_test_game_proof_contract.mjs");
  await runNodeScript("tools/dev_test_game_release_readiness.mjs");
  await runDevTestGameBackupRestoreSpine();
  await runDevTestGameIdentitySpine();
  await runDevTestGameAdminSpine();
}
