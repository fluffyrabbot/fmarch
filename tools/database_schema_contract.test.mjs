import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  baselineFilename,
  baselineSha256,
  authorityFingerprintFilename,
  currentSchemaFilename,
  epochFilename,
  inspectDatabaseSchema,
  migrationDirectory,
  repoRoot,
  schemaDirectory,
} from "./database_schema_contract.mjs";

const checkedEpoch = JSON.parse(
  await readFile(path.join(repoRoot, schemaDirectory, epochFilename), "utf8"),
);
const checkedSnapshot = await readFile(
  path.join(repoRoot, schemaDirectory, currentSchemaFilename),
  "utf8",
);
const checkedAuthority = await readFile(
  path.join(repoRoot, schemaDirectory, authorityFingerprintFilename),
  "utf8",
);
const checkedMigrations = Object.fromEntries(
  await Promise.all(
    checkedEpoch.migrations.map(async ({ filename }) => [
      filename,
      await readFile(path.join(repoRoot, migrationDirectory, filename), "utf8"),
    ]),
  ),
);

async function withSchema({
  migrations = checkedMigrations,
  epoch = checkedEpoch,
  snapshot = checkedSnapshot,
  authority = checkedAuthority,
}, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "fmarch-database-schema-"));
  const migrationPath = path.join(root, migrationDirectory);
  const schemaPath = path.join(root, schemaDirectory);
  await mkdir(migrationPath, { recursive: true });
  await mkdir(schemaPath, { recursive: true });
  for (const [name, sql] of Object.entries(migrations)) {
    await writeFile(path.join(migrationPath, name), sql, "utf8");
  }
  await writeFile(path.join(schemaPath, epochFilename), `${JSON.stringify(epoch, null, 2)}\n`);
  await writeFile(path.join(schemaPath, currentSchemaFilename), snapshot);
  await writeFile(path.join(schemaPath, authorityFingerprintFilename), authority);
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("checked-in database schema is append-only with a generated current snapshot", async () => {
  const report = await inspectDatabaseSchema({ baseEpoch: checkedEpoch });
  assert.equal(report.ok, true);
  assert.equal(report.epoch, 1);
  assert.equal(report.migration_head, "0003_closed_community_admission.sql");
  assert.equal(report.migration_file_count, 3);
  assert.equal(checkedEpoch.migrations[0].filename, baselineFilename);
  assert.equal(checkedEpoch.migrations[0].sha256, baselineSha256);
  assert.equal(report.table_count, 98);
});

test("database schema permits a contiguous destructive forward migration", async () => {
  const nextVersion = checkedEpoch.migrations.length + 1;
  const filename = `${String(nextVersion).padStart(4, "0")}_remove_obsolete_projection.sql`;
  const sql = "DROP TABLE public.obsolete_projection;\n";
  const epoch = {
    ...checkedEpoch,
    migrations: [
      ...checkedEpoch.migrations,
      { version: nextVersion, filename, sha256: createHash("sha256").update(sql).digest("hex") },
    ],
  };
  await withSchema(
    { migrations: { ...checkedMigrations, [filename]: sql }, epoch },
    async (root) => assert.equal((await inspectDatabaseSchema({ root, baseEpoch: checkedEpoch })).ok, true),
  );
});

test("database schema rejects edits even when the manifest checksum is rewritten", async () => {
  const mutated = `${checkedMigrations[baselineFilename]}\n-- rewritten history\n`;
  const epoch = structuredClone(checkedEpoch);
  epoch.migrations[0].sha256 = createHash("sha256").update(mutated).digest("hex");
  await withSchema(
    { migrations: { ...checkedMigrations, [baselineFilename]: mutated }, epoch },
    async (root) => {
      await assert.rejects(
        inspectDatabaseSchema({ root, baseEpoch: checkedEpoch }),
        /changed existing entry/,
      );
    },
  );
});

test("database schema rejects checksum drift, gaps, and unmanifested files", async () => {
  await withSchema(
    { migrations: { ...checkedMigrations, [baselineFilename]: `${checkedMigrations[baselineFilename]}\n` } },
    async (root) => await assert.rejects(inspectDatabaseSchema({ root, baseEpoch: checkedEpoch }), /checksum drifted/),
  );
  const gapped = structuredClone(checkedEpoch);
  gapped.migrations[1] = { ...gapped.migrations[1], version: 4 };
  await withSchema(
    {
      migrations: {
        [baselineFilename]: checkedMigrations[baselineFilename],
        [gapped.migrations[1].filename]: checkedMigrations[checkedEpoch.migrations[1].filename],
        [checkedEpoch.migrations[2].filename]: checkedMigrations[checkedEpoch.migrations[2].filename],
      },
      epoch: gapped,
    },
    async (root) => await assert.rejects(inspectDatabaseSchema({ root, baseEpoch: null }), /contiguous version 0002/),
  );
  await withSchema(
    { migrations: { ...checkedMigrations, "0004_unmanifested.sql": "SELECT 1;\n" } },
    async (root) => await assert.rejects(inspectDatabaseSchema({ root, baseEpoch: checkedEpoch }), /exactly match/),
  );
});

test("database schema rejects generated snapshot drift", async () => {
  await withSchema(
    { snapshot: `${checkedSnapshot}\n-- drift\n` },
    async (root) => await assert.rejects(inspectDatabaseSchema({ root, baseEpoch: checkedEpoch }), /current\.sql checksum drifted/),
  );
});

test("database schema rejects normalized authority fingerprint drift", async () => {
  const authority = checkedAuthority.replace("fmarch_application", "fmarch_application_drift");
  await withSchema({ authority }, async (root) => {
    await assert.rejects(
      inspectDatabaseSchema({ root, baseEpoch: checkedEpoch }),
      /authority\.json checksum drifted/,
    );
  });
});

test("database schema owns event storage and KEK custody exactly once", () => {
  const eventsStart = checkedSnapshot.indexOf("CREATE TABLE public.events (");
  const eventsEnd = checkedSnapshot.indexOf("\n);", eventsStart);
  const eventsTable = checkedSnapshot.slice(eventsStart, eventsEnd);
  assert.notEqual(eventsStart, -1);
  assert.doesNotMatch(eventsTable, /\bpayload jsonb\b/u);
  assert.doesNotMatch(eventsTable, /\bactor jsonb\b/u);
  assert.match(eventsTable, /\bsealed_body bytea NOT NULL\b/u);
  assert.match(checkedSnapshot, /CREATE VIEW public\.event_direct_key_reference AS/u);
});
