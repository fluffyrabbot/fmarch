import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const migrationDirectory = "crates/database_schema/migrations";
export const schemaDirectory = "crates/database_schema/schema";
export const epochFilename = "epoch.json";
export const currentSchemaFilename = "current.sql";
export const authorityFingerprintFilename = "authority.json";
export const baselineFilename = "0001_current_schema.sql";
export const baselineSha256 = "afddc1a958bb210024626ce40ec97991c4f2a03e3bc6718d5590edbe8745381e";

const migrationFilenamePattern = /^(\d{4})_([a-z0-9_]+)\.sql$/u;
const requiredCatalogMarkers = Object.freeze([
  "CREATE TABLE public.events (",
  "CREATE TABLE public.event_stream_keys (",
  "CREATE TABLE public.public_search_document (",
  "CREATE FUNCTION public.events_forbid_mutation()",
  "CREATE FUNCTION public.event_direct_envelope_write_guard()",
  "CREATE VIEW public.event_direct_key_reference AS",
  "CREATE TRIGGER events_no_update",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function countLines(sql, pattern) {
  return sql.split("\n").filter((line) => pattern.test(line)).length;
}

function readBaseEpoch(root) {
  if (root !== repoRoot) return null;
  const relative = `${schemaDirectory}/${epochFilename}`;
  const result = spawnSync("git", ["show", `origin/main:${relative}`], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  return JSON.parse(result.stdout);
}

export function validateAppendOnlyEpoch(current, base, { allowEpochReset = false } = {}) {
  if (!base) return true;
  if (current.epoch !== base.epoch) {
    if (!allowEpochReset) {
      throw new Error(
        `schema epoch changed from ${base.epoch} to ${current.epoch} without an explicit epoch reset`,
      );
    }
    return true;
  }
  if (current.migrations.length < base.migrations.length) {
    throw new Error("append-only migration manifest deleted an existing migration");
  }
  for (let index = 0; index < base.migrations.length; index += 1) {
    if (JSON.stringify(current.migrations[index]) !== JSON.stringify(base.migrations[index])) {
      throw new Error(
        `append-only migration manifest changed existing entry ${base.migrations[index].filename}`,
      );
    }
  }
  return true;
}

export async function inspectDatabaseSchema({
  root = repoRoot,
  baseEpoch = undefined,
  allowEpochReset = false,
} = {}) {
  const migrationPath = path.resolve(root, migrationDirectory);
  const schemaPath = path.resolve(root, schemaDirectory);
  const epoch = JSON.parse(await readFile(path.join(schemaPath, epochFilename), "utf8"));
  if (epoch.version !== 1 || !Number.isSafeInteger(epoch.epoch) || epoch.epoch < 1) {
    throw new Error("database schema epoch manifest is invalid");
  }
  if (!Array.isArray(epoch.migrations) || epoch.migrations.length === 0) {
    throw new Error("database schema epoch must contain migrations");
  }
  validateAppendOnlyEpoch(
    epoch,
    baseEpoch === undefined ? readBaseEpoch(root) : baseEpoch,
    { allowEpochReset },
  );

  const files = (await readdir(migrationPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const manifestFiles = epoch.migrations.map((migration) => migration.filename);
  if (JSON.stringify(files) !== JSON.stringify(manifestFiles)) {
    throw new Error(
      `migration files must exactly match the epoch manifest; files=${files.join(", ")} manifest=${manifestFiles.join(", ")}`,
    );
  }

  for (let index = 0; index < epoch.migrations.length; index += 1) {
    const migration = epoch.migrations[index];
    const expectedVersion = index + 1;
    const match = migrationFilenamePattern.exec(migration.filename);
    if (
      migration.version !== expectedVersion ||
      !match ||
      Number.parseInt(match[1], 10) !== expectedVersion
    ) {
      throw new Error(
        `migration ${migration.filename} must be contiguous version ${String(expectedVersion).padStart(4, "0")}`,
      );
    }
    const sql = await readFile(path.join(migrationPath, migration.filename), "utf8");
    const actual = sha256(sql);
    if (actual !== migration.sha256) {
      throw new Error(
        `migration ${migration.filename} checksum drifted; expected ${migration.sha256}, found ${actual}`,
      );
    }
  }

  const baseline = epoch.migrations[0];
  if (epoch.epoch === 1 && (baseline.filename !== baselineFilename || baseline.sha256 !== baselineSha256)) {
    throw new Error("epoch-one 0001 migration is not the frozen immutable baseline");
  }

  const currentSchema = await readFile(path.join(schemaPath, currentSchemaFilename), "utf8");
  const currentSchemaSha256 = sha256(currentSchema);
  if (currentSchemaSha256 !== epoch.current_schema_sha256) {
    throw new Error(
      `schema/current.sql checksum drifted; expected ${epoch.current_schema_sha256}, found ${currentSchemaSha256}`,
    );
  }
  if (!currentSchema.startsWith("-- GENERATED FILE: canonical owner-neutral PostgreSQL schema")) {
    throw new Error("schema/current.sql is not the generated canonical snapshot");
  }
  for (const marker of requiredCatalogMarkers) {
    if (!currentSchema.includes(marker)) {
      throw new Error(`canonical current schema is missing ${marker}`);
    }
  }
  const tableCount = countLines(currentSchema, /^CREATE TABLE /u);
  const triggerCount = countLines(currentSchema, /^CREATE TRIGGER /u);
  const functionCount = countLines(currentSchema, /^CREATE FUNCTION /u);
  const viewCount = countLines(currentSchema, /^CREATE VIEW /u);
  if (tableCount !== 98 || triggerCount !== 33 || functionCount !== 13 || viewCount !== 1) {
    throw new Error(
      `canonical catalog counts drifted: tables=${tableCount} triggers=${triggerCount} functions=${functionCount} views=${viewCount}`,
    );
  }

  const authorityFingerprint = await readFile(
    path.join(schemaPath, authorityFingerprintFilename),
    "utf8",
  );
  const authorityFingerprintSha256 = sha256(authorityFingerprint);
  if (authorityFingerprintSha256 !== epoch.authority_fingerprint_sha256) {
    throw new Error(
      `schema/authority.json checksum drifted; expected ${epoch.authority_fingerprint_sha256}, found ${authorityFingerprintSha256}`,
    );
  }
  const authority = JSON.parse(authorityFingerprint);
  if (
    authority.version !== 1 ||
    authority.epoch !== epoch.epoch ||
    authority.roles?.schema_owner !== "$schema_owner" ||
    !Array.isArray(authority.rows)
  ) {
    throw new Error("schema/authority.json is not the normalized epoch authority fingerprint");
  }
  for (const role of ["$schema_owner", "fmarch_application", "fmarch_key_admin"]) {
    if (!authorityFingerprint.includes(role)) {
      throw new Error(`canonical authority fingerprint is missing ${role}`);
    }
  }

  return {
    ok: true,
    epoch: epoch.epoch,
    migration_directory: migrationDirectory,
    migration_head: manifestFiles.at(-1),
    migration_file_count: manifestFiles.length,
    current_schema_sha256: currentSchemaSha256,
    authority_fingerprint_sha256: authorityFingerprintSha256,
    table_count: tableCount,
    trigger_count: triggerCount,
    function_count: functionCount,
    view_count: viewCount,
  };
}

async function main() {
  console.log(JSON.stringify(await inspectDatabaseSchema(), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
