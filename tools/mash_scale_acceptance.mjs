import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertMashScaleAcceptance } from "./mash_scale_acceptance_contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "mash-scale-acceptance");
const artifactPath = path.join(artifactDir, "report.json");
const sourceDatabaseUrl = process.env.DATABASE_URL;

if (!sourceDatabaseUrl) {
  throw new Error(
    "DATABASE_URL is required, e.g. postgres://fmarch:fmarch@127.0.0.1:5544/fmarch",
  );
}

await mkdir(artifactDir, { recursive: true });
const scratch = await createScratchDatabase(sourceDatabaseUrl);
try {
  await run("cargo", [
    "run",
    "-q",
    "-p",
    "api",
    "--bin",
    "audit_mash_scale_acceptance",
    "--",
    "--output",
    artifactPath,
  ], {
    ...process.env,
    DATABASE_URL: scratch.url,
  });
  const report = assertMashScaleAcceptance(
    JSON.parse(await readFile(artifactPath, "utf8")),
  );
  console.log(
    `mash scale acceptance passed: ${report.roster_count} slots, ` +
      `${report.total_participation_rows} participation rows, ` +
      `${report.concurrency.elapsed_ms}ms contention, ` +
      `${report.rebuild.elapsed_ms}ms rebuild`,
  );
} finally {
  await dropScratchDatabase(scratch);
}

async function createScratchDatabase(sourceUrl) {
  const admin = new URL(sourceUrl);
  admin.pathname = "/postgres";
  const name = `fmarch_mash_scale_${process.pid}_${Date.now()}`;
  const target = new URL(sourceUrl);
  target.pathname = `/${name}`;
  await run("psql", [
    admin.toString(),
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `CREATE DATABASE "${name}"`,
  ]);
  return { adminUrl: admin.toString(), name, url: target.toString() };
}

async function dropScratchDatabase(database) {
  await run("psql", [
    database.adminUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database.name}'`,
    "-c",
    `DROP DATABASE IF EXISTS "${database.name}"`,
  ]);
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code ?? `via ${signal}`}`));
    });
  });
}
