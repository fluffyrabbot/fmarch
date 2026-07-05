import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const localSpineDatabaseUrl =
  "postgres://fmarch:fmarch@127.0.0.1:5544/fmarch";
const defaultScript = "test:dev-test-game-identity:operator";

let currentChild;
let stopping = false;

export function parseArgs(argv = []) {
  const args = {
    script: defaultScript,
    prebuild: false,
    passThrough: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--prebuild") {
      args.prebuild = true;
      continue;
    }
    if (arg === "--script") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--script requires a package script name");
      }
      args.script = value;
      index += 1;
      continue;
    }
    if (arg === "--") {
      args.passThrough = argv.slice(index + 1);
      break;
    }
    throw new Error(`unknown argument '${arg}'`);
  }
  return args;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return 0;
  }
  const databaseUrl = env.DATABASE_URL ?? localSpineDatabaseUrl;
  installSignalHandler("SIGINT", 130);
  installSignalHandler("SIGTERM", 143);

  try {
    await run("npm", ["run", "dev:postgres", "--", "start"], { env });
    if (args.prebuild) {
      await run("npm", ["run", "dev:test-game:prebuild"], { env });
    }
    return await run(
      "npm",
      ["run", args.script, "--", ...args.passThrough],
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

function printUsage() {
  console.log(`Usage: npm run test:dev-test-game-spine:local -- [options] [-- forwarded args]

Options:
  --script NAME   Package script to run with repo-local Postgres (default: ${defaultScript})
  --prebuild      Run dev:test-game:prebuild before the selected package script

Examples:
  npm run test:dev-test-game-core-live:local
  npm run test:dev-test-game-live:local
  npm run test:dev-test-game-identity:operator:local
  npm run test:dev-test-game-spine:local -- --script test:dev-test-game-identity:operator
`);
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
