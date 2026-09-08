import { spawn } from "node:child_process";

const defaultTerminationGraceMs = 1_000;

export async function runBoundedProcess(
  command,
  args,
  {
    cwd,
    timeoutMs,
    terminationGraceMs = defaultTerminationGraceMs,
  } = {},
) {
  assertPositiveBudget(timeoutMs, "process timeout");
  assertPositiveBudget(terminationGraceMs, "process termination grace");

  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let finished = false;
  let timedOut = false;
  let forceKillTimer;
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      finished = true;
      resolve({ code, signal });
    });
  });
  const timeout = globalThis.setTimeout(() => {
    if (finished) return;
    timedOut = true;
    child.kill("SIGTERM");
    forceKillTimer = globalThis.setTimeout(() => {
      if (!finished) child.kill("SIGKILL");
    }, terminationGraceMs);
  }, timeoutMs);

  try {
    const { code, signal } = await completion;
    if (timedOut) {
      throw new Error(
        `${command} exceeded ${timeoutMs}ms and was terminated with ${signal ?? `exit ${code}`}`,
      );
    }
    if (code !== 0) {
      throw new Error(`${command} failed with exit ${code}:\n${output}`);
    }
    return output;
  } finally {
    globalThis.clearTimeout(timeout);
    if (forceKillTimer !== undefined) globalThis.clearTimeout(forceKillTimer);
  }
}

function assertPositiveBudget(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}
