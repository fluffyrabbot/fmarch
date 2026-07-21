import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  baselineFilename,
  inspectProjectionBaseline,
  migrationDirectory,
} from "./projection_baseline_contract.mjs";

const header = "-- 0001_baseline.sql — complete greenfield test schema.\n";

async function withMigrationDirectory(files, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "fmarch-projection-baseline-"));
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

test("checked-in projection schema is one strict greenfield baseline", async () => {
  const report = await inspectProjectionBaseline();
  assert.equal(report.ok, true);
  assert.equal(report.baseline, baselineFilename);
  assert.equal(report.migration_file_count, 1);
  assert.ok(report.statement_count > 100);
});

test("projection baseline rejects incremental migration files", async () => {
  await withMigrationDirectory(
    {
      [baselineFilename]: `${header}CREATE TABLE public.example (id bigint);`,
      "0002_incremental.sql": "ALTER TABLE public.example ADD COLUMN name text;",
    },
    async (root) => {
      await assert.rejects(
        inspectProjectionBaseline({ root }),
        /must contain only 0001_baseline\.sql/,
      );
    },
  );
});

test("projection baseline rejects transitional data and column mutations", async () => {
  const forbidden = [
    "INSERT INTO public.example VALUES (1);",
    "UPDATE public.example SET id = 2;",
    "DELETE FROM public.example;",
    "TRUNCATE TABLE public.example;",
    "ALTER TABLE public.example ADD COLUMN name text;",
    "ALTER TABLE public.example DROP COLUMN name;",
    "DROP TABLE public.example;",
  ];

  for (const statement of forbidden) {
    await withMigrationDirectory(
      { [baselineFilename]: `${header}${statement}` },
      async (root) => {
        await assert.rejects(inspectProjectionBaseline({ root }));
      },
    );
  }
});

test("projection baseline permits constructive constraints", async () => {
  await withMigrationDirectory(
    {
      [baselineFilename]: `${header}CREATE TABLE public.example (id bigint);\nALTER TABLE ONLY public.example ADD CONSTRAINT example_pkey PRIMARY KEY (id);`,
    },
    async (root) => {
      const report = await inspectProjectionBaseline({ root });
      assert.equal(report.ok, true);
      assert.equal(report.statement_count, 2);
    },
  );
});
