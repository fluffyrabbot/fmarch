import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertProofGraphAdminProof,
} from "./dev_test_game_proof_graph_admin_proof.mjs";
import {
  selectedOperatorHandoffTerminalBatchFixturePath,
} from "./dev_test_game_spine_artifact_paths.mjs";
export {
  selectedOperatorHandoffReceiptAdminProofCommand,
  selectedOperatorHandoffReceiptAdminProofPath,
} from "./dev_test_game_selected_operator_handoff_receipt_admin_proof_paths.mjs";
import {
  selectedOperatorHandoffReceiptAdminProofPath,
} from "./dev_test_game_selected_operator_handoff_receipt_admin_proof_paths.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";
import {
  writeSelectedOperatorHandoffTerminalBatchesFixture,
} from "./dev_test_game_selected_operator_handoff_receipt_fixture.mjs";

export async function runSelectedOperatorHandoffReceiptAdminProof() {
  await writeSelectedOperatorHandoffTerminalBatchesFixture();
  const proofEnv = {
    ...process.env,
    FMARCH_DEV_TEST_GAME_ADMIN_SPINE_TERMINAL_BATCHES:
      selectedOperatorHandoffTerminalBatchFixturePath,
    FMARCH_DEV_TEST_GAME_PROOF_GRAPH_ADMIN_PROOF:
      selectedOperatorHandoffReceiptAdminProofPath,
  };
  await runNodeScript("tools/dev_test_game_proof_graph_admin_proof.mjs", {
    env: proofEnv,
  });
  const proof = assertProofGraphAdminProof(
    JSON.parse(
      await readFile(
        path.resolve(repoRoot, selectedOperatorHandoffReceiptAdminProofPath),
        "utf8",
      ),
    ),
  );
  if (
    proof.generatedFrom?.selectedOperatorHandoffReceiptDestination
      ?.selectedOperatorHandoffReceiptStatus !== "passed"
  ) {
    throw new Error(
      "selected operator handoff receipt admin proof did not cover the passed fixture",
    );
  }
  return proof;
}

function runNodeScript(script, { env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(repoRoot, script)], {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal === null
            ? `${script} exited with ${code}`
            : `${script} exited with signal ${signal}`,
        ),
      );
    });
  });
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runSelectedOperatorHandoffReceiptAdminProof();
}
