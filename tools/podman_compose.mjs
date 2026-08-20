import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const podmanComposeProvider = "podman-compose";
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parsePodmanComposeArgs(argv) {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
    return { help: true, args: [] };
  }
  if (argv.length === 0) {
    throw new Error("a podman compose command is required; for example: up -d postgres");
  }
  return { help: false, args: [...argv] };
}

export function podmanComposeEnvironment(env = process.env) {
  return { ...env, PODMAN_COMPOSE_PROVIDER: podmanComposeProvider };
}

export function podmanComposeCommand(args, env = process.env) {
  return {
    command: "podman",
    args: ["compose", ...args],
    cwd: repoRoot,
    env: podmanComposeEnvironment(env),
  };
}

export async function requireExecutable(executable, { env = process.env, execFileFn = execFileAsync } = {}) {
  try {
    await execFileFn(executable, ["--version"], { env });
  } catch (error) {
    throw new Error(
      `fmarch's container-backed local database requires ${executable}; install Podman and podman-compose, then retry.`,
      { cause: error },
    );
  }
}

export async function requirePodmanCompose({ env = process.env, requireExecutableFn = requireExecutable } = {}) {
  await requireExecutableFn("podman", { env });
  await requireExecutableFn(podmanComposeProvider, { env });
}

export async function invokeCommand(command, args, { cwd = repoRoot, env = process.env, spawnFn = spawn } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawnFn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `${command} ${args.join(" ")} was terminated by ${signal}`
            : `${command} ${args.join(" ")} exited with status ${code}`,
        ),
      );
    });
  });
}

export async function runPodmanCompose(
  args,
  {
    env = process.env,
    requirePodmanComposeFn = requirePodmanCompose,
    invokeCommandFn = invokeCommand,
  } = {},
) {
  const command = podmanComposeCommand(args, env);
  await requirePodmanComposeFn({ env });
  await invokeCommandFn(command.command, command.args, { cwd: command.cwd, env: command.env });
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const parsed = parsePodmanComposeArgs(argv);
  if (parsed.help) {
    console.log("Usage: node tools/podman_compose.mjs <podman compose arguments>");
    console.log("Example: node tools/podman_compose.mjs up -d postgres");
    return;
  }
  await runPodmanCompose(parsed.args, options);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
