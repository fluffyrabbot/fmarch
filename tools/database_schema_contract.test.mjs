import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  baselineFilename,
  baselineSha256,
  inspectDatabaseSchema,
  migrationDirectory,
  repoRoot,
} from "./database_schema_contract.mjs";

const checkedBaseline = await readFile(
  path.join(repoRoot, migrationDirectory, baselineFilename),
  "utf8",
);

async function withSchemaFiles(files, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "fmarch-database-schema-"));
  const directory = path.join(root, migrationDirectory);
  await mkdir(directory, { recursive: true });
  for (const [name, sql] of Object.entries(files)) {
    await writeFile(path.join(directory, name), sql, "utf8");
  }
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("checked-in database schema is one exact current-state baseline", async () => {
  const report = await inspectDatabaseSchema();
  assert.equal(report.ok, true);
  assert.equal(report.baseline, baselineFilename);
  assert.equal(report.baseline_sha256, baselineSha256);
  assert.equal(report.migration_file_count, 1);
  assert.equal(report.table_count, 94);
  assert.equal(report.trigger_count, 33);
  assert.equal(report.function_count, 13);
  assert.equal(report.view_count, 1);
});

test("database schema rejects compatibility migrations beside the baseline", async () => {
  await withSchemaFiles(
    {
      [baselineFilename]: checkedBaseline,
      "0002_compatibility.sql": "CREATE TABLE public.legacy_bridge (id bigint);\n",
    },
    async (root) => {
      await assert.rejects(
        inspectDatabaseSchema({ root }),
        /must contain only 0001_current_schema\.sql/,
      );
    },
  );
});

test("database schema rejects unrecorded baseline drift", async () => {
  await withSchemaFiles(
    { [baselineFilename]: `${checkedBaseline}\n-- unrecorded drift\n` },
    async (root) => {
      await assert.rejects(
        inspectDatabaseSchema({ root }),
        /changed without an intentional rebaseline/,
      );
    },
  );
});

test("database schema rejects transitional data and destructive DDL", async () => {
  const forbidden = [
    "INSERT INTO public.events DEFAULT VALUES;",
    "DELETE FROM public.events;",
    "TRUNCATE TABLE public.events;",
    "DROP TABLE public.events;",
    "ALTER TABLE public.events DROP COLUMN kind;",
  ];
  for (const statement of forbidden) {
    const mutated = checkedBaseline.replace(
      "-- PostgreSQL database dump",
      `-- PostgreSQL database dump\n${statement}`,
    );
    await withSchemaFiles({ [baselineFilename]: mutated }, async (root) => {
      await assert.rejects(inspectDatabaseSchema({ root }));
    });
  }
});

test("database schema owns event storage and KEK custody exactly once", () => {
  const eventsStart = checkedBaseline.indexOf("CREATE TABLE public.events (");
  const eventsEnd = checkedBaseline.indexOf("\n);", eventsStart);
  assert.notEqual(eventsStart, -1);
  assert.notEqual(eventsEnd, -1);
  const eventsTable = checkedBaseline.slice(eventsStart, eventsEnd);
  assert.doesNotMatch(eventsTable, /\bpayload jsonb\b/u);
  assert.doesNotMatch(eventsTable, /\bactor jsonb\b/u);
  assert.match(eventsTable, /\bsealed_body bytea NOT NULL\b/u);
  assert.match(checkedBaseline, /CREATE TABLE public\.event_stream_keys \(/u);
  assert.match(checkedBaseline, /CREATE VIEW public\.event_direct_key_reference AS/u);
  assert.match(checkedBaseline, /retired event direct-key registry row is an immutable tombstone/u);
});
