import { spawn } from "node:child_process";
import { appendFile, chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = path.join(repoRoot, "target");
const artifactDir = path.join(targetRoot, "database-tls-boundary");
const runtimeDir = await mkdtemp(path.join(targetRoot, "database-tls-runtime-"));
const dataDir = path.join(runtimeDir, "postgres");
const logPath = path.join(runtimeDir, "postgres.log");
const reportPath = path.join(artifactDir, "report.json");
let postgresRunning = false;

try {
  await mkdir(artifactDir, { recursive: true });
  const bindir = (await capture("pg_config", ["--bindir"])).trim();
  const initdb = path.join(bindir, "initdb");
  const pgCtl = path.join(bindir, "pg_ctl");
  const username = (await capture("id", ["-un"])).trim();
  const port = await unusedLoopbackPort();
  const certificate = path.join(dataDir, "server.crt");
  const privateKey = path.join(dataDir, "server.key");

  await run(initdb, [
    "-D",
    dataDir,
    "--username",
    username,
    "--auth-local=trust",
    "--auth-host=trust",
    "--no-locale",
    "--encoding=UTF8",
  ]);
  await run("openssl", [
    "req",
    "-new",
    "-x509",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-keyout",
    privateKey,
    "-out",
    certificate,
  ]);
  await chmod(privateKey, 0o600);
  await appendFile(
    path.join(dataDir, "postgresql.conf"),
    [
      "",
      "listen_addresses = '127.0.0.1'",
      `port = ${port}`,
      "ssl = on",
      `ssl_cert_file = '${postgresLiteral(certificate)}'`,
      `ssl_key_file = '${postgresLiteral(privateKey)}'`,
      `unix_socket_directories = '${postgresLiteral(runtimeDir)}'`,
      "",
    ].join("\n"),
  );
  await run(pgCtl, ["-D", dataDir, "-l", logPath, "-w", "start"]);
  postgresRunning = true;

  await run("cargo", [
    "build",
    "--release",
    "-p",
    "server",
    "--bin",
    "fmarch-migrate",
    "--bin",
    "fmarch-schema-gate",
  ]);

  const ownerPassword = "database-tls-owner-proof-password";
  const applicationPassword = "database-tls-application-proof-password";
  const keyAdminPassword = "database-tls-key-admin-proof-password";
  const ownerUrl = postgresUrl({
    username,
    password: ownerPassword,
    port,
    database: "postgres",
  });
  const applicationUrl = postgresUrl({
    username: "fmarch_application",
    password: applicationPassword,
    port,
    database: "postgres",
  });
  const releaseDir = path.join(repoRoot, "target", "release");
  await run(path.join(releaseDir, "fmarch-migrate"), [], {
    env: isolatedEnvironment({
      DATABASE_MIGRATION_URL: ownerUrl,
      FMARCH_DATABASE_APPLICATION_PASSWORD: applicationPassword,
      FMARCH_DATABASE_KEY_ADMIN_PASSWORD: keyAdminPassword,
    }),
  });
  await run(path.join(releaseDir, "fmarch-schema-gate"), [], {
    env: isolatedEnvironment({
      DATABASE_URL: applicationUrl,
      FMARCH_SCHEMA_GATE_TIMEOUT_MS: "10000",
      FMARCH_SCHEMA_GATE_INTERVAL_MS: "100",
    }),
  });
  const sslEvidence = (
    await capture(
      path.join(bindir, "psql"),
      [
        applicationUrl,
        "-At",
        "-c",
        "SELECT current_user || '|' || ssl::text FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
      ],
      { env: isolatedEnvironment() },
    )
  ).trim();
  if (sslEvidence !== "fmarch_application|true") {
    throw new Error(`unexpected TLS evidence: ${sslEvidence}`);
  }
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        ok: true,
        boundary: "release SQLx binaries negotiated required PostgreSQL TLS",
        principal: "fmarch_application",
        ssl: true,
        sslmode: "require",
      },
      null,
      2,
    )}\n`,
  );
  console.log(`database TLS boundary passed; wrote ${path.relative(repoRoot, reportPath)}`);
} finally {
  if (postgresRunning) {
    const bindir = (await capture("pg_config", ["--bindir"])).trim();
    await run(path.join(bindir, "pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
  }
  try {
    await copyFile(logPath, path.join(artifactDir, "postgres.log"));
  } catch {
    // No server log exists when setup fails before PostgreSQL starts.
  }
  await rm(runtimeDir, { recursive: true, force: true });
}

function postgresUrl({ username, password, port, database }) {
  const url = new URL("postgresql://127.0.0.1");
  url.username = username;
  url.password = password;
  url.port = String(port);
  url.pathname = `/${database}`;
  url.searchParams.set("sslmode", "require");
  return url.toString();
}

function isolatedEnvironment(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("PG") ||
      key === "DATABASE_URL" ||
      key === "DATABASE_MIGRATION_URL" ||
      key === "DATABASE_KEY_ADMIN_URL" ||
      key === "FMARCH_DATABASE_APPLICATION_PASSWORD" ||
      key === "FMARCH_DATABASE_KEY_ADMIN_PASSWORD"
    ) {
      delete env[key];
    }
  }
  return { ...env, ...extra };
}

function postgresLiteral(value) {
  return value.replaceAll("'", "''");
}

async function unusedLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("cannot allocate proof port");
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

function run(command, args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code ?? `via ${signal}`}`));
    });
  });
}

function capture(command, args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else {
        reject(
          new Error(
            `${command} exited ${code ?? `via ${signal}`}: ${Buffer.concat(stderr).toString("utf8")}`,
          ),
        );
      }
    });
  });
}
