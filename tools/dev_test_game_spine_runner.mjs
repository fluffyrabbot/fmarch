import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertHostedIdentityProofGraphDependency,
} from "./dev_test_game_hosted_identity_proof_graph_dependency.mjs";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const devTestGameNextActionScript = "tools/dev_test_game_next_action.mjs";

export function runNodeScript(scriptPath, options = {}) {
  return runCommand(process.execPath, [scriptPath], options);
}

export function runNpmScript(scriptName, options = {}) {
  return runCommand("npm", ["run", scriptName], options);
}

export async function runSpinePlan(plan, { custom = {} } = {}) {
  for (const step of plan) {
    await runSpinePlanStep(step, { custom });
  }
}

export function phaseLocalNextActionStep({ id, outputPath, sequenceStage } = {}) {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("phase-local next-action spine step is missing an id");
  }
  if (typeof outputPath !== "string" || outputPath.trim() === "") {
    throw new Error("phase-local next-action spine step is missing an output path");
  }
  if (
    sequenceStage !== undefined &&
    (typeof sequenceStage !== "string" || sequenceStage.trim() === "")
  ) {
    throw new Error("phase-local next-action spine step has an invalid sequence stage");
  }
  return {
    kind: "node",
    script: devTestGameNextActionScript,
    env: {
      ...(sequenceStage === undefined
        ? {}
        : { FMARCH_DEV_TEST_GAME_SEQUENCE_STAGE: sequenceStage }),
      FMARCH_DEV_TEST_GAME_NEXT_ACTION: outputPath,
    },
    phaseLocalNextAction: {
      id,
      outputPath,
      ...(sequenceStage === undefined ? {} : { sequenceStage }),
    },
  };
}

async function runSpinePlanStep(step, { custom }) {
  await runSpinePlanStepPreconditions(step.preconditions);
  const kind = step.kind ?? "node";
  if (kind === "node") {
    await runNodeScript(step.script, { env: step.env });
    return;
  }
  if (kind === "npm") {
    await runNpmScript(step.script, { env: step.env });
    return;
  }
  if (kind === "custom") {
    const handler = custom[step.script];
    if (typeof handler !== "function") {
      throw new Error(`unknown custom spine plan step: ${step.script}`);
    }
    await handler(step);
    return;
  }
  throw new Error(`unknown spine plan step kind: ${kind}`);
}

async function runSpinePlanStepPreconditions(preconditions = []) {
  if (!Array.isArray(preconditions)) {
    throw new Error("spine plan step preconditions must be an array");
  }
  for (const precondition of preconditions) {
    await runSpinePlanStepPrecondition(precondition);
  }
}

async function runSpinePlanStepPrecondition(precondition) {
  const kind = precondition?.kind;
  if (kind === "hosted-identity-proof-graph-dependency") {
    if (
      typeof precondition.path !== "string" ||
      precondition.path.trim() === ""
    ) {
      throw new Error("hosted identity proof graph precondition is missing a path");
    }
    const proofGraphPath = path.resolve(repoRoot, precondition.path);
    assertHostedIdentityProofGraphDependency(
      JSON.parse(await readFile(proofGraphPath, "utf8")),
    );
    return;
  }
  throw new Error(`unknown spine plan precondition kind: ${kind}`);
}

export function runCommand(command, args, { env = {} } = {}) {
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
