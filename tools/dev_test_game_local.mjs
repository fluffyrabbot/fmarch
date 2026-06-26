import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localDatabaseUrl = "postgres://fmarch:fmarch@127.0.0.1:5544/fmarch";

let currentChild;
let stopping = false;

export async function main(args = process.argv.slice(2), env = process.env) {
  const databaseUrl = env.DATABASE_URL ?? localDatabaseUrl;
  installSignalHandler("SIGINT", 130);
  installSignalHandler("SIGTERM", 143);

  try {
    await run("npm", ["run", "dev:postgres", "--", "start"], { env });
    await run("npm", ["run", "dev:test-game:prebuild"], { env });
    return await run(
      "npm",
      ["run", "dev:test-game", "--", ...args],
      {
        env: {
          ...env,
          DATABASE_URL: databaseUrl,
        },
        allowFailure: true,
      },
    );
  } finally {
    await stopPostgres(env);
  }
}

async function run(command, args, { env, allowFailure = false } = {}) {
  const code = await spawnAndWait(command, args, { env });
  if (code !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} exited with ${code}`);
  }
  return code;
}

async function stopPostgres(env) {
  if (stopping) {
    return;
  }
  stopping = true;
  await spawnAndWait("npm", ["run", "dev:postgres", "--", "stop"], {
    env,
    allowSpawnError: true,
  });
}

async function spawnAndWait(command, args, { env, allowSpawnError = false } = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    stdio: "inherit",
  });
  currentChild = child;
  return await new Promise((resolve, reject) => {
    child.once("error", (error) => {
      currentChild = undefined;
      if (allowSpawnError) {
        resolve(1);
      } else {
        reject(error);
      }
    });
    child.once("exit", (code, signal) => {
      currentChild = undefined;
      if (signal === "SIGINT") {
        resolve(130);
      } else if (signal === "SIGTERM") {
        resolve(143);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

function installSignalHandler(signal, exitCode) {
  process.once(signal, async () => {
    if (currentChild !== undefined) {
      currentChild.kill(signal);
    }
    await stopPostgres(process.env);
    process.exit(exitCode);
  });
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().then((code) => {
    process.exit(code);
  }).catch(async (error) => {
    await stopPostgres(process.env);
    console.error(error);
    process.exit(1);
  });
}
