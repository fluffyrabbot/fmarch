import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const migrationDirectory = "crates/database_schema/migrations";
export const baselineFilename = "0001_current_schema.sql";
export const baselineSha256 =
  "dfd6b606d2619c18378b7f41c8782c6c4b8709cfa5029289b9ad21a7433781d3";

const forbiddenTransitionPatterns = Object.freeze([
  ["data insertion", /^INSERT\s+INTO\b/im],
  ["data deletion", /^DELETE\s+FROM\b/im],
  ["data truncation", /^TRUNCATE(?:\s+TABLE)?\b/im],
  ["destructive table removal", /^DROP\s+TABLE\b/im],
  ["destructive column removal", /^ALTER\s+TABLE\b[^;]*\bDROP\s+COLUMN\b/im],
]);

const requiredCatalogMarkers = Object.freeze([
  "CREATE TABLE public.events (",
  "CREATE TABLE public.event_stream_keys (",
  "CREATE TABLE public.public_search_document (",
  "CREATE FUNCTION public.events_forbid_mutation()",
  "CREATE FUNCTION public.event_direct_envelope_write_guard()",
  "CREATE VIEW public.event_direct_key_reference AS",
  "CREATE TRIGGER events_no_update",
]);

function countLines(sql, pattern) {
  return sql.split("\n").filter((line) => pattern.test(line)).length;
}

export async function inspectDatabaseSchema({ root = repoRoot } = {}) {
  const directory = path.resolve(root, migrationDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  if (files.length !== 1 || files[0] !== baselineFilename) {
    throw new Error(
      `greenfield database schema must contain only ${baselineFilename}; found ${files.join(", ") || "no files"}`,
    );
  }

  const baselinePath = path.join(directory, baselineFilename);
  const sql = await readFile(baselinePath, "utf8");
  if (!sql.startsWith("-- 0001_current_schema.sql — complete greenfield")) {
    throw new Error("database baseline is missing its greenfield contract header");
  }
  const actualSha256 = createHash("sha256").update(sql).digest("hex");
  if (actualSha256 !== baselineSha256) {
    throw new Error(
      `database baseline changed without an intentional rebaseline; expected sha256 ${baselineSha256}, found ${actualSha256}`,
    );
  }
  if (/\bIF\s+NOT\s+EXISTS\b/i.test(sql)) {
    throw new Error("database baseline must fail closed instead of accepting catalog drift");
  }
  for (const [label, pattern] of forbiddenTransitionPatterns) {
    if (pattern.test(sql)) {
      throw new Error(`database baseline contains transitional ${label}`);
    }
  }
  for (const marker of requiredCatalogMarkers) {
    if (!sql.includes(marker)) {
      throw new Error(`database baseline is missing ${marker}`);
    }
  }

  const tableCount = countLines(sql, /^CREATE TABLE /u);
  const triggerCount = countLines(sql, /^CREATE TRIGGER /u);
  const functionCount = countLines(sql, /^CREATE FUNCTION /u);
  const viewCount = countLines(sql, /^CREATE VIEW /u);
  if (tableCount !== 94 || triggerCount !== 33 || functionCount !== 13 || viewCount !== 1) {
    throw new Error(
      `database baseline catalog counts drifted: tables=${tableCount} triggers=${triggerCount} functions=${functionCount} views=${viewCount}`,
    );
  }

  return {
    ok: true,
    migration_directory: migrationDirectory,
    baseline: baselineFilename,
    baseline_sha256: actualSha256,
    migration_file_count: files.length,
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
