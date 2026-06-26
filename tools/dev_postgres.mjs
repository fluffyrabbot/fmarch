import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const defaultTargetDir = path.join(repoRoot, "target", "local-postgres");
export const defaultDataDir = path.join(defaultTargetDir, "data");
export const defaultLogPath = path.join(defaultTargetDir, "postgres.log");
export const defaultHost = "127.0.0.1";
export const defaultPort = 5544;
export const defaultUser = "fmarch";
export const defaultDatabase = "fmarch";
export const defaultPassword = "fmarch";

const pgCommands = ["pg_ctl", "initdb", "createdb", "pg_isready"];
const pgBinCandidates = [
  process.env.PG_BIN,
  "/opt/homebrew/opt/postgresql@16/bin",
  "/usr/local/opt/postgresql@16/bin",
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
].filter(Boolean);

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return 0;
  }

  const config = buildConfig(args, env);
  switch (args.command) {
    case "start":
      await startPostgres(config);
      printReady(config);
      return 0;
    case "stop":
      await stopPostgres(config);
      return 0;
    case "restart":
      await stopPostgres(config, { allowStopped: true });
      await startPostgres(config);
      printReady(config);
      return 0;
    case "status":
      await printStatus(config);
      return 0;
    case "print-env":
      console.log(`DATABASE_URL=${databaseUrl(config)}`);
      return 0;
    default:
      throw new Error(`unknown command '${args.command}'`);
  }
}

export function parseArgs(argv) {
  const args = { command: "status" };
  const takeValue = (index, flag) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--") && !args.commandWasSet) {
      args.command = arg;
      args.commandWasSet = true;
      continue;
    }
    switch (arg) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--host":
        args.host = takeValue(i, arg);
        i += 1;
        break;
      case "--port":
        args.port = parsePositiveInt(takeValue(i, arg), arg);
        i += 1;
        break;
      case "--database":
      case "--db":
        args.database = takeValue(i, arg);
        i += 1;
        break;
      case "--user":
        args.user = takeValue(i, arg);
        i += 1;
        break;
      case "--password":
        args.password = takeValue(i, arg);
        i += 1;
        break;
      case "--data-dir":
        args.dataDir = path.resolve(takeValue(i, arg));
        i += 1;
        break;
      case "--log":
        args.logPath = path.resolve(takeValue(i, arg));
        i += 1;
        break;
      case "--pg-bin":
        args.pgBin = path.resolve(takeValue(i, arg));
        i += 1;
        break;
      default:
        throw new Error(`unknown argument '${arg}'`);
    }
  }
  delete args.commandWasSet;
  return args;
}

export function buildConfig(args = {}, env = process.env) {
  const pgBin = args.pgBin ?? env.PG_BIN ?? findPgBin();
  return {
    host: args.host ?? env.FMARCH_DEV_POSTGRES_HOST ?? defaultHost,
    port: args.port ?? parseEnvPort(env.FMARCH_DEV_POSTGRES_PORT) ?? defaultPort,
    database: args.database ?? env.FMARCH_DEV_POSTGRES_DB ?? defaultDatabase,
    user: args.user ?? env.FMARCH_DEV_POSTGRES_USER ?? defaultUser,
    password: args.password ?? env.FMARCH_DEV_POSTGRES_PASSWORD ?? defaultPassword,
    dataDir: args.dataDir ?? env.FMARCH_DEV_POSTGRES_DATA ?? defaultDataDir,
    logPath: args.logPath ?? env.FMARCH_DEV_POSTGRES_LOG ?? defaultLogPath,
    pgBin,
  };
}

export function databaseUrl(config) {
  const password = encodeURIComponent(config.password);
  return `postgres://${encodeURIComponent(config.user)}:${password}@${config.host}:${config.port}/${encodeURIComponent(
    config.database,
  )}`;
}

export function findPgBin(candidates = pgBinCandidates) {
  for (const candidate of candidates) {
    if (pgCommands.every((command) => existsSync(path.join(candidate, command)))) {
      return candidate;
    }
  }
  return null;
}

async function startPostgres(config) {
  requirePgBin(config);
  await mkdir(path.dirname(config.logPath), { recursive: true });
  await initIfNeeded(config);

  if (await isReady(config)) {
    await ensureDatabase(config);
    return;
  }

  if (await canOpenTcp(config.host, config.port)) {
    throw new Error(
      `port ${config.host}:${config.port} is already open, but pg_isready did not accept ${config.user}/${config.database}`,
    );
  }

  await runPg(config, "pg_ctl", [
    "-D",
    config.dataDir,
    "-l",
    config.logPath,
    "-o",
    `-p ${config.port} -h ${config.host}`,
    "start",
  ]);
  await waitForReady(config);
  await ensureDatabase(config);
}

async function stopPostgres(config, { allowStopped = false } = {}) {
  requirePgBin(config);
  if (!existsSync(path.join(config.dataDir, "PG_VERSION"))) {
    if (allowStopped) {
      return;
    }
    throw new Error(`no repo-local Postgres data directory at ${config.dataDir}`);
  }
  const result = await runPg(config, "pg_ctl", ["-D", config.dataDir, "stop"], {
    allowFailure: true,
  });
  if (result.code !== 0 && !allowStopped && !/no server running/i.test(result.stderr + result.stdout)) {
    throw new Error((result.stderr || result.stdout || "pg_ctl stop failed").trim());
  }
}

async function printStatus(config) {
  requirePgBin(config);
  const initialized = existsSync(path.join(config.dataDir, "PG_VERSION"));
  const ready = initialized ? await isReady(config) : false;
  console.log(`status=${ready ? "ready" : initialized ? "stopped" : "uninitialized"}`);
  console.log(`dataDir=${config.dataDir}`);
  console.log(`log=${config.logPath}`);
  console.log(`DATABASE_URL=${databaseUrl(config)}`);
}

async function initIfNeeded(config) {
  if (existsSync(path.join(config.dataDir, "PG_VERSION"))) {
    return;
  }
  await mkdir(config.dataDir, { recursive: true });
  await runPg(config, "initdb", [
    "-D",
    config.dataDir,
    "--username",
    config.user,
    "--auth=trust",
    "--no-locale",
    "--encoding=UTF8",
  ]);
}

async function ensureDatabase(config) {
  const result = await runPg(
    config,
    "createdb",
    ["-h", config.host, "-p", String(config.port), "-U", config.user, config.database],
    { allowFailure: true },
  );
  const output = result.stderr + result.stdout;
  if (result.code !== 0 && !/already exists/i.test(output)) {
    throw new Error(output.trim() || "createdb failed");
  }
}

async function waitForReady(config) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (await isReady(config)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  let logTail = "";
  try {
    const log = await readFile(config.logPath, "utf8");
    logTail = `\n\npostgres log tail:\n${log.split("\n").slice(-20).join("\n")}`;
  } catch {
    // Missing logs already surfaced by pg_ctl in the common failure path.
  }
  throw new Error(`Postgres did not become ready at ${config.host}:${config.port}${logTail}`);
}

async function isReady(config) {
  const result = await runPg(
    config,
    "pg_isready",
    ["-h", config.host, "-p", String(config.port), "-U", config.user, "-d", config.database],
    { allowFailure: true },
  );
  return result.code === 0;
}

async function canOpenTcp(host, port) {
  return await new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function requirePgBin(config) {
  if (!config.pgBin) {
    throw new Error(
      [
        "Postgres binaries were not found.",
        "Install postgresql@16 with Homebrew or set PG_BIN to a directory containing pg_ctl, initdb, createdb, and pg_isready.",
      ].join(" "),
    );
  }
}

async function runPg(config, command, args, options = {}) {
  const result = await execFileResult(path.join(config.pgBin, command), args, {
    env: { ...process.env, PGPASSWORD: config.password },
  });
  if (result.code !== 0 && !options.allowFailure) {
    throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  }
  return result;
}

async function execFileResult(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
        return;
      }
      resolve({
        code: typeof error?.code === "number" ? error.code : 0,
        stdout,
        stderr,
      });
    });
  });
}

function printReady(config) {
  console.log("repo-local Postgres ready");
  console.log(`DATABASE_URL=${databaseUrl(config)}`);
  console.log(`dataDir=${config.dataDir}`);
  console.log(`log=${config.logPath}`);
}

function parseEnvPort(value) {
  if (!value) {
    return null;
  }
  return parsePositiveInt(value, "FMARCH_DEV_POSTGRES_PORT");
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== String(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function printUsage() {
  console.log(`Usage: npm run dev:postgres -- <command> [options]

Commands:
  start       Initialize target/local-postgres if needed, start Postgres, and create the fmarch database
  stop        Stop the repo-local Postgres cluster
  restart     Stop then start the repo-local Postgres cluster
  status      Print readiness, paths, and DATABASE_URL
  print-env   Print only the DATABASE_URL assignment

Options:
  --host HOST          Listen host (default: ${defaultHost})
  --port PORT          Listen port (default: ${defaultPort})
  --database NAME      Database name (default: ${defaultDatabase})
  --user USER          Database user (default: ${defaultUser})
  --password PASSWORD  DATABASE_URL password label (default: ${defaultPassword})
  --data-dir PATH      Postgres data directory (default: target/local-postgres/data)
  --log PATH           Postgres log path (default: target/local-postgres/postgres.log)
  --pg-bin PATH        Directory containing pg_ctl, initdb, createdb, and pg_isready
`);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
