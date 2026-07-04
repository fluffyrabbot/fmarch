import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

async function runSpinePlanStep(step, { custom }) {
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
