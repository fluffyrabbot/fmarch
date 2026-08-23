import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertMashScaleAcceptance } from "./mash_scale_acceptance_contract.mjs";
import {
  applicationDatabaseEnvironment,
  runFmarchMigrations,
} from "./run_fmarch_migrations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.resolve(
  process.env.FMARCH_PROOF_ARTIFACT_DIR ??
    path.join(repoRoot, "target", "mash-scale-acceptance"),
);
const artifactPath = path.join(artifactDir, "report.json");
const sourceDatabaseUrl = process.env.DATABASE_MIGRATION_URL;
const runnerOwnsDatabase =
  process.env.FMARCH_PROOF_LANE_ID === "test:mash-scale-acceptance";

if (!sourceDatabaseUrl) {
  throw new Error(
    "DATABASE_MIGRATION_URL is required, e.g. postgres://fmarch:fmarch@127.0.0.1:5544/fmarch",
  );
}

await mkdir(artifactDir, { recursive: true });
const scratch = runnerOwnsDatabase
  ? runnerOwnedDatabase(sourceDatabaseUrl)
  : await createScratchDatabase(sourceDatabaseUrl);
try {
  const authority = await runFmarchMigrations({
    cwd: repoRoot,
    migrationUrl: scratch.url,
    env: process.env,
  });
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
    ...applicationDatabaseEnvironment({
      applicationUrl: authority.applicationUrl,
      env: process.env,
    }),
  });
  const report = assertMashScaleAcceptance(
    JSON.parse(await readFile(artifactPath, "utf8")),
  );
  console.log(
    `mash scale acceptance passed: ${report.program_ref.id}@${report.program_ref.version} ` +
      `(${report.program_ref.content_hash.slice(0, 12)}), ${report.roster_count} slots, ` +
      `${report.total_participation_rows} participation rows, ` +
      `${report.concurrency.elapsed_ms}ms contention, ` +
      `${report.rebuild.elapsed_ms}ms rebuild`,
  );
} finally {
  if (!scratch.runnerOwned) await dropScratchDatabase(scratch);
}

function runnerOwnedDatabase(url) {
  const name = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "");
  if (!name) throw new Error("runner-owned DATABASE_MIGRATION_URL must name a database");
  return { name, url, runnerOwned: true };
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
