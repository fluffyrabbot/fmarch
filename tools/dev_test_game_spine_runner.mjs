import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertHostedIdentityProofGraphDependency,
} from "./dev_test_game_hosted_identity_proof_graph_dependency.mjs";
import {
  readinessFreshnessScopeEnv,
} from "./dev_test_game_readiness_freshness_scope.mjs";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const devTestGameNextActionScript = "tools/dev_test_game_next_action.mjs";

export function runNodeScript(scriptPath, options = {}) {
  return runCommand(process.execPath, [scriptPath], options);
}

export function runNpmScript(scriptName, options = {}) {
  return runCommand("npm", ["run", scriptName], options);
}

export async function runSpinePlan(plan, { custom = {}, checkpoint } = {}) {
  const checkpointRun = await startSpineCheckpointRun({ checkpoint, plan });
  for (const [index, step] of plan.entries()) {
    await checkpointRun?.record({ index, state: "running" });
    try {
      await runSpinePlanStep(step, { custom });
    } catch (error) {
      await checkpointRun?.record({
        index,
        state: "failed",
        error: String(error?.stack ?? error),
      });
      throw error;
    }
    await checkpointRun?.record({ index, state: "passed" });
  }
}

export function spineCheckpointPath(id, { root = repoRoot } = {}) {
  if (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
    throw new Error("spine checkpoint id must be lowercase kebab-case");
  }
  return path.join(root, "target", "dev-test-game", "spine-checkpoints", `${id}.json`);
}

async function startSpineCheckpointRun({ checkpoint, plan }) {
  if (checkpoint === undefined) {
    return null;
  }
  const id = checkpoint?.id;
  const defaultCheckpointPath = spineCheckpointPath(id);
  const checkpointPath = checkpoint?.path ?? defaultCheckpointPath;
  const startedAt = new Date().toISOString();
  const planFingerprint = createHash("sha256")
    .update(JSON.stringify(plan))
    .digest("hex");
  const completedSteps = [];

  const record = async ({ index, state, error }) => {
    if (state === "passed") {
      completedSteps.push(spineCheckpointStep(plan[index], index));
    }
    const completed = completedSteps.length === plan.length;
    const receiptState =
      state === "failed" ? "failed" : completed ? "passed" : "running";
    const activeStepIndex = state === "passed" ? index + 1 : index;
    const receipt = {
      schema: "fmarch.dev-test-game-spine-checkpoint.v1",
      id,
      state: receiptState,
      startedAt,
      updatedAt: new Date().toISOString(),
      planFingerprint,
      totalSteps: plan.length,
      completedSteps: [...completedSteps],
      ...(completed
        ? { completedAt: new Date().toISOString() }
        : { activeStep: spineCheckpointStep(plan[activeStepIndex], activeStepIndex) }),
      ...(error === undefined ? {} : { error }),
    };
    await writeJsonAtomically(checkpointPath, receipt);
  };

  return { record };
}

function spineCheckpointStep(step, index) {
  return {
    index,
    kind: step.kind ?? "node",
    script: step.script,
    ...(step.label === undefined ? {} : { label: step.label }),
  };
}

async function writeJsonAtomically(outputPath, value) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, outputPath);
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

export function handoffPhaseStep({
  phaseId,
  step,
  planStep,
  outputs = [],
} = {}) {
  if (typeof phaseId !== "string" || phaseId.trim() === "") {
    throw new Error("handoff phase spine step is missing a phase id");
  }
  if (typeof step !== "string" || step.trim() === "") {
    throw new Error("handoff phase spine step is missing a step id");
  }
  if (planStep === null || typeof planStep !== "object" || Array.isArray(planStep)) {
    throw new Error("handoff phase spine step is missing a plan step");
  }
  const normalizedOutputs = normalizeHandoffPhaseOutputs({
    outputs,
    planStep,
  });
  if (
    planStep.readinessReason !== undefined &&
    (!Array.isArray(planStep.changedInputs) || planStep.changedInputs.length === 0)
  ) {
    throw new Error("handoff phase readiness step is missing changed inputs");
  }
  return {
    ...planStep,
    handoffPhase: {
      id: phaseId,
      step,
      ...(normalizedOutputs.length === 0
        ? {}
        : { outputs: normalizedOutputs }),
    },
  };
}

export function handoffPhaseSteps({ phaseId, steps } = {}) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("handoff phase spine steps must be a non-empty array");
  }
  return steps.map((item) =>
    handoffPhaseStep({
      phaseId,
      step: item?.step,
      planStep: item?.planStep,
      outputs: item?.outputs,
    }),
  );
}

function normalizeHandoffPhaseOutputs({ outputs, planStep }) {
  const explicitOutputs = (Array.isArray(outputs) ? outputs : []).map((output) =>
    String(output ?? ""),
  );
  const implicitOutputs = [
    planStep?.phaseLocalNextAction?.outputPath,
  ].map((output) => String(output ?? ""));
  const normalized = [...explicitOutputs, ...implicitOutputs].filter(
    (output) => output !== "",
  );
  return [...new Set(normalized)];
}

async function runSpinePlanStep(step, { custom }) {
  await runSpinePlanStepPreconditions(step.preconditions);
  const kind = step.kind ?? "node";
  if (kind === "node") {
    await runNodeScript(step.script, { env: spinePlanStepEnv(step) });
    return;
  }
  if (kind === "npm") {
    await runNpmScript(step.script, { env: spinePlanStepEnv(step) });
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

export function spinePlanStepEnv(step) {
  if (step.readinessReason === undefined) {
    return step.env;
  }
  return {
    ...step.env,
    ...readinessFreshnessScopeEnv(step.changedInputs, { root: repoRoot }),
  };
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
