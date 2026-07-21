import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const migrationDirectory = "crates/projections/migrations";
export const baselineFilename = "0001_baseline.sql";

const forbiddenStatements = Object.freeze([
  ["INSERT data migration", /^INSERT\s+INTO\b/i],
  ["UPDATE data migration", /^UPDATE\s+\S+\s+SET\b/i],
  ["DELETE data migration", /^DELETE\s+FROM\b/i],
  ["TRUNCATE data migration", /^TRUNCATE(?:\s+TABLE)?\b/i],
  ["destructive DROP statement", /^DROP\b/i],
  [
    "transitional column mutation",
    /^ALTER\s+TABLE\b[\s\S]*\b(?:ADD|DROP|RENAME)\s+COLUMN\b/i,
  ],
]);

function executableStatements(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function inspectProjectionBaseline({ root = repoRoot } = {}) {
  const directory = path.resolve(root, migrationDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  if (files.length !== 1 || files[0] !== baselineFilename) {
    throw new Error(
      `projection migrations must contain only ${baselineFilename}; found ${files.join(", ") || "no files"}`,
    );
  }

  const baselinePath = path.join(directory, baselineFilename);
  const sql = await readFile(baselinePath, "utf8");
  if (!sql.startsWith("-- 0001_baseline.sql — complete greenfield")) {
    throw new Error("projection baseline is missing its greenfield contract header");
  }
  if (/\bIF\s+NOT\s+EXISTS\b/i.test(sql)) {
    throw new Error("projection baseline must fail closed instead of using IF NOT EXISTS");
  }

  const statements = executableStatements(sql);
  for (const statement of statements) {
    for (const [label, pattern] of forbiddenStatements) {
      if (pattern.test(statement)) {
        throw new Error(`projection baseline contains ${label}: ${statement.slice(0, 120)}`);
      }
    }
  }

  return {
    ok: true,
    migration_directory: migrationDirectory,
    baseline: baselineFilename,
    migration_file_count: files.length,
    statement_count: statements.length,
  };
}

async function main() {
  const report = await inspectProjectionBaseline();
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
