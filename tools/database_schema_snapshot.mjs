import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildConfig,
  createDisposableDatabase,
  databaseUrl,
  dropDisposableDatabase,
} from "./dev_postgres.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const epochPath = path.join(repoRoot, "crates", "database_schema", "schema", "epoch.json");
const snapshotPath = path.join(repoRoot, "crates", "database_schema", "schema", "current.sql");
const migrationsPath = path.join(repoRoot, "crates", "database_schema", "migrations");

export function normalizeSchemaDump(dump, epoch) {
  const normalized = String(dump)
    .split("\n")
    .filter((line) => !line.startsWith("-- Dumped from database version "))
    .filter((line) => !line.startsWith("-- Dumped by pg_dump version "))
    .filter((line) => !line.startsWith("\\restrict ") && !line.startsWith("\\unrestrict "))
    .join("\n")
    .replaceAll(/\n{4,}/gu, "\n\n\n")
    .trimEnd();
  return `-- GENERATED FILE: canonical owner-neutral PostgreSQL schema for fmarch epoch ${epoch}.\n-- Regenerate with: npm run generate:database-schema\n\n${normalized}\n`;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 64 * 1024 * 1024,
  });
}

export async function generateCurrentSchema({ write = false, env = process.env } = {}) {
  const epoch = JSON.parse(await readFile(epochPath, "utf8"));
  const config = buildConfig({}, env);
  const database = `fmarch_proof_schema_snapshot_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  await createDisposableDatabase(config, database);
  try {
    const url = databaseUrl({ ...config, database });
    for (const migration of epoch.migrations) {
      run(path.join(config.pgBin, "psql"), [
        "--quiet",
        "--set",
        "ON_ERROR_STOP=1",
        "--dbname",
        url,
        "--file",
        path.join(migrationsPath, migration.filename),
      ]);
    }
    const dump = run(
      path.join(config.pgBin, "pg_dump"),
      ["--schema-only", "--no-owner", "--no-privileges", "--dbname", url],
      { capture: true },
    );
    const current = normalizeSchemaDump(dump, epoch.epoch);
    const sha256 = createHash("sha256").update(current).digest("hex");
    if (write) {
      await writeFile(snapshotPath, current);
      await writeFile(
        epochPath,
        `${JSON.stringify({ ...epoch, current_schema_sha256: sha256 }, null, 2)}\n`,
      );
    } else {
      const checked = await readFile(snapshotPath, "utf8");
      assert.equal(checked, current, "schema/current.sql drifted from the applied migration catalog");
      assert.equal(
        epoch.current_schema_sha256,
        sha256,
        "epoch current_schema_sha256 drifted from schema/current.sql",
      );
    }
    return { sha256, tableCount: (current.match(/^CREATE TABLE /gmu) ?? []).length };
  } finally {
    await dropDisposableDatabase(config, database);
  }
}

async function main(argv) {
  const unknown = argv.filter((argument) => argument !== "--write");
  assert.deepEqual(unknown, [], `unknown schema snapshot argument: ${unknown.join(", ")}`);
  const report = await generateCurrentSchema({ write: argv.includes("--write") });
  console.log(JSON.stringify(report, null, 2));
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`database schema snapshot failed: ${error.message}`);
    process.exitCode = 1;
  });
}
