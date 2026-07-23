import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  baselineFilename,
  baselineSha256,
  inspectProjectionBaseline,
  migrationDirectory,
  repoRoot,
} from "./projection_baseline_contract.mjs";

const checkedBaseline = await readFile(
  path.join(repoRoot, migrationDirectory, baselineFilename),
  "utf8",
);

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

test("checked-in projection schema preserves its baseline and append-only sequence", async () => {
  const report = await inspectProjectionBaseline();
  assert.equal(report.ok, true);
  assert.equal(report.baseline, baselineFilename);
  assert.equal(report.baseline_sha256, baselineSha256);
  assert.deepEqual(report.migrations, [
    baselineFilename,
    "0002_runtime_identity.sql",
    "0003_authentication_methods.sql",
    "0004_game_cohost_policy.sql",
    "0005_identity_method_hardening.sql",
    "0006_encrypt_private_projections.sql",
    "0007_security_capacity_ledgers.sql",
    "0008_day_events.sql",
    "0009_day_programs.sql",
  ]);
  assert.equal(report.migration_file_count, 9);
  assert.ok(report.statement_count > 100);
});

test("projection migrations reject sequence gaps", async () => {
  await withMigrationDirectory(
    {
      [baselineFilename]: checkedBaseline,
      "0003_gap.sql": "-- 0003_gap.sql — invalid gap.\nCREATE TABLE public.example (id bigint);",
    },
    async (root) => {
      await assert.rejects(
        inspectProjectionBaseline({ root }),
        /contiguous append-only sequence; expected version 0002/,
      );
    },
  );
});

test("projection baseline rejects checksum drift", async () => {
  await withMigrationDirectory(
    { [baselineFilename]: `${checkedBaseline}\n-- rewritten after release\n` },
    async (root) => {
      await assert.rejects(inspectProjectionBaseline({ root }), /baseline is immutable/);
    },
  );
});

test("projection migrations reject destructive data and schema mutations", async () => {
  const forbidden = [
    "INSERT INTO public.example VALUES (1);",
    "DELETE FROM public.example;",
    "TRUNCATE TABLE public.example;",
    "ALTER TABLE public.example DROP COLUMN name;",
    "DROP TABLE public.example;",
  ];

  for (const statement of forbidden) {
    await withMigrationDirectory(
      {
        [baselineFilename]: checkedBaseline,
        "0002_invalid.sql": `-- 0002_invalid.sql — invalid mutation.\n${statement}`,
      },
      async (root) => {
        await assert.rejects(inspectProjectionBaseline({ root }));
      },
    );
  }
});

test("projection migrations permit constructive schema additions", async () => {
  await withMigrationDirectory(
    {
      [baselineFilename]: checkedBaseline,
      "0002_constructive.sql": "-- 0002_constructive.sql — additive schema.\nCREATE TABLE public.example (id bigint);\nALTER TABLE public.example ADD COLUMN fingerprint bytea;\nUPDATE public.example SET fingerprint = decode(repeat('00', 32), 'hex');\nALTER TABLE public.example ALTER COLUMN fingerprint SET NOT NULL;\nALTER TABLE ONLY public.example ADD CONSTRAINT example_pkey PRIMARY KEY (id);",
    },
    async (root) => {
      const report = await inspectProjectionBaseline({ root });
      assert.equal(report.ok, true);
      assert.equal(report.migration_file_count, 2);
      assert.ok(report.statement_count > 100);
    },
  );
});
