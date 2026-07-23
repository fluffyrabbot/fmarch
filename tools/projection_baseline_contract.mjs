import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const migrationDirectory = "crates/projections/migrations";
export const baselineFilename = "0001_baseline.sql";
export const baselineSha256 = "9cb4116bf12cfb96ba6a32c4065fd89d5abc0d1be10ce44e7330d2dd15385cae";

const migrationFilenamePattern = /^(\d{4})_[a-z0-9_]+\.sql$/u;

const forbiddenStatements = Object.freeze([
  ["INSERT data migration", /^INSERT\s+INTO\b/i],
  ["DELETE data migration", /^DELETE\s+FROM\b/i],
  ["TRUNCATE data migration", /^TRUNCATE(?:\s+TABLE)?\b/i],
  ["destructive DROP statement", /^DROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i],
  [
    "destructive column removal",
    /^ALTER\s+TABLE\b[\s\S]*\bDROP\s+COLUMN\b/i,
  ],
]);

const privateProjectionEncryptionMigration = "0006_encrypt_private_projections.sql";
const allowedPrivateProjectionErasureStatements = Object.freeze([
  /^TRUNCATE\s+TABLE\s+investigation_memory,\s*player_info_result,\s*player_investigation_result,\s*private_channel_member,\s*slot_state,\s*thread_view$/i,
  /^ALTER\s+TABLE\s+investigation_memory\s+DROP\s+COLUMN\s+result,\s*ADD\s+COLUMN\s+result_private\s+JSONB\s+NOT\s+NULL$/i,
  /^ALTER\s+TABLE\s+player_info_result\s+DROP\s+COLUMN\s+result,\s*ADD\s+COLUMN\s+result_private\s+JSONB\s+NOT\s+NULL$/i,
  /^ALTER\s+TABLE\s+player_investigation_result\s+DROP\s+COLUMN\s+result,\s*ADD\s+COLUMN\s+result_private\s+JSONB\s+NOT\s+NULL$/i,
  /^ALTER\s+TABLE\s+private_channel_member\s+DROP\s+COLUMN\s+role_key,\s*DROP\s+COLUMN\s+reveals_alignment,\s*ADD\s+COLUMN\s+private\s+JSONB\s+NOT\s+NULL$/i,
  /^ALTER\s+TABLE\s+slot_state\s+DROP\s+COLUMN\s+role_key,\s*DROP\s+COLUMN\s+alignment,\s*ADD\s+COLUMN\s+private\s+JSONB$/i,
  /^ALTER\s+TABLE\s+thread_view\s+DROP\s+COLUMN\s+body,\s*ADD\s+COLUMN\s+body\s+TEXT,\s*ADD\s+COLUMN\s+body_private\s+JSONB,\s*ADD\s+CONSTRAINT\s+thread_view_body_storage\s+CHECK\s*\([\s\S]+\)$/i,
]);

function isAllowedPrivateProjectionErasure(file, statement) {
  return file === privateProjectionEncryptionMigration
    && allowedPrivateProjectionErasureStatements.some((pattern) => pattern.test(statement));
}

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

  if (files.length === 0 || files[0] !== baselineFilename) {
    throw new Error(
      `projection migrations must begin with ${baselineFilename}; found ${files.join(", ") || "no files"}`,
    );
  }

  for (const [index, file] of files.entries()) {
    const match = migrationFilenamePattern.exec(file);
    const expectedVersion = String(index + 1).padStart(4, "0");
    if (match === null || match[1] !== expectedVersion) {
      throw new Error(
        `projection migrations must be a contiguous append-only sequence; expected version ${expectedVersion}, found ${file}`,
      );
    }
  }

  const baselinePath = path.join(directory, baselineFilename);
  const baselineSql = await readFile(baselinePath, "utf8");
  if (!baselineSql.startsWith("-- 0001_baseline.sql — complete greenfield")) {
    throw new Error("projection baseline is missing its greenfield contract header");
  }
  const actualBaselineSha256 = createHash("sha256").update(baselineSql).digest("hex");
  if (actualBaselineSha256 !== baselineSha256) {
    throw new Error(
      `projection baseline is immutable; expected sha256 ${baselineSha256}, found ${actualBaselineSha256}`,
    );
  }

  let statementCount = 0;
  for (const file of files) {
    const sql = file === baselineFilename
      ? baselineSql
      : await readFile(path.join(directory, file), "utf8");
    if (!sql.startsWith(`-- ${file} —`)) {
      throw new Error(`projection migration ${file} is missing its contract header`);
    }
    if (/\bIF\s+NOT\s+EXISTS\b/i.test(sql)) {
      throw new Error(`projection migration ${file} must fail closed instead of using IF NOT EXISTS`);
    }

    const statements = executableStatements(sql);
    statementCount += statements.length;
    for (const statement of statements) {
      for (const [label, pattern] of forbiddenStatements) {
        if (pattern.test(statement) && !isAllowedPrivateProjectionErasure(file, statement)) {
          throw new Error(
            `projection migration ${file} contains ${label}: ${statement.slice(0, 120)}`,
          );
        }
      }
    }
  }

  return {
    ok: true,
    migration_directory: migrationDirectory,
    baseline: baselineFilename,
    baseline_sha256: actualBaselineSha256,
    migrations: files,
    migration_file_count: files.length,
    statement_count: statementCount,
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
