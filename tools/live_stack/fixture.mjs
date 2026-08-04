import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function createLiveStackFixtureTools({
  artifactDir,
  cwd,
  host = "127.0.0.1",
  progressFilename = "live-stack-progress.json",
} = {}) {
  if (typeof cwd !== "string" || cwd.trim() === "") {
    throw new Error("live-stack fixture cwd is required");
  }

  const runProcess = async (command, args) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
    if (code !== 0) {
      throw new Error(`${command} ${args[0]} failed with exit ${code}:\n${output}`);
    }
    return output;
  };

  const createScratchDatabase = async (sourceDatabaseUrl) => {
    const source = new URL(sourceDatabaseUrl);
    const admin = new URL(sourceDatabaseUrl);
    admin.pathname = "/postgres";
    const scratch = new URL(sourceDatabaseUrl);
    const sourceName = source.pathname.replace(/^\/+/, "") || "fmarch";
    const name =
      `${sanitizeDatabaseName(sourceName)}_live_stack_${process.pid}_${Date.now()}`;
    scratch.pathname = `/${name}`;

    await runProcess("psql", [
      admin.toString(),
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `CREATE DATABASE "${name}"`,
    ]);

    return { name, adminUrl: admin.toString(), url: scratch.toString() };
  };

  const dropScratchDatabase = async ({ adminUrl, name }) => {
    await runProcess("psql", [
      adminUrl,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
    ]);
  };

  const runSql = async (url, sql) =>
    await runProcess("psql", [
      url,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ]);

  const runSqlScalar = async (url, sql) =>
    (
      await runProcess("psql", [
        url,
        "-v",
        "ON_ERROR_STOP=1",
        "-Atc",
        sql,
      ])
    ).trim();

  const freePort = async () =>
    await new Promise((resolve, reject) => {
      const portServer = net.createServer();
      portServer.on("error", reject);
      portServer.listen(0, host, () => {
        const address = portServer.address();
        portServer.close(() => {
          if (!address || typeof address === "string") {
            reject(new Error("could not allocate a free TCP port"));
            return;
          }
          resolve(address.port);
        });
      });
    });

  const writeProgress = async (progress) => {
    if (typeof artifactDir !== "string" || artifactDir.trim() === "") {
      throw new Error("live-stack fixture artifactDir is required for progress");
    }
    await writeFile(
      path.join(artifactDir, progressFilename),
      JSON.stringify({ at: new Date().toISOString(), ...progress }, null, 2),
    );
  };

  return Object.freeze({
    createScratchDatabase,
    dropScratchDatabase,
    freePort,
    runProcess,
    runSql,
    runSqlScalar,
    stopChild,
    writeProgress,
  });
}

export function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGINT");
  const stopped = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5000).then(() => "timeout"),
  ]);
  if (stopped === "timeout") {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

function sanitizeDatabaseName(name) {
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
  const prefix = sanitized === "" ? "fmarch" : sanitized;
  return prefix.slice(0, 24);
}
