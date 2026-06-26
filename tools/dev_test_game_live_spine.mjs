import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runDevTestGameAdminSpine } from "./dev_test_game_admin_spine.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameLiveSpine();
}

export async function runDevTestGameLiveSpine() {
  await runCommand("npm", ["run", "dev:test-game:prebuild"]);
  await runNodeScript("tools/dev_test_game_live_proof.mjs");
  await runNodeScript("tools/dev_test_game_proof_contract.mjs");
  await runNodeScript("tools/dev_test_game_release_readiness.mjs");
  await runCommand("npm", ["run", "test:dev-test-game-backup-restore"]);
  await runCommand("npm", ["run", "test:dev-test-game-identity"]);
  await runDevTestGameAdminSpine();
}

function runNodeScript(scriptPath) {
  return runCommand(process.execPath, [scriptPath]);
}

function runCommand(command, args, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}
