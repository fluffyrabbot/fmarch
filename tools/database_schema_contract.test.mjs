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
  assert.equal(report.migration_head, "0010_identity_delivery_claim_provenance.sql");
  assert.equal(report.migration_file_count, 10);
  assert.equal(checkedEpoch.migrations[0].filename, baselineFilename);
  assert.equal(checkedEpoch.migrations[0].sha256, baselineSha256);
  assert.equal(report.table_count, 101);
  assert.doesNotMatch(checkedSnapshot, /admin_grant/u);
  assert.match(
    checkedMigrations["0004_remove_admin_grant_assurance.sql"],
    /DELETE FROM public\.auth_session\s+WHERE assurance IN \('admin_grant', 'dev', 'external_sso'\)/u,
  );
  assert.match(
    checkedMigrations["0004_remove_admin_grant_assurance.sql"],
    /ADD COLUMN local_proof_instance_id text/u,
  );
  assert.match(
    checkedMigrations["0004_remove_admin_grant_assurance.sql"],
    /DROP COLUMN auth_kind/u,
  );
  assert.match(
    checkedMigrations["0004_remove_admin_grant_assurance.sql"],
    /FOREIGN KEY \(session_reference\)[\s\S]*ON DELETE CASCADE/u,
  );
  assert.match(
    checkedMigrations["0004_remove_admin_grant_assurance.sql"],
    /UPDATE public\.workos_session_exchange[\s\S]*SET linking_session_hash = NULL/u,
  );
  assert.match(
    checkedMigrations["0004_remove_admin_grant_assurance.sql"],
    /CREATE TABLE public\.workos_signing_key_tombstone/u,
  );
  assert.match(
    checkedMigrations["0004_remove_admin_grant_assurance.sql"],
    /DROP COLUMN principal_id,[\s\S]*DROP COLUMN consumed_at/u,
  );
  const mediaJournal = checkedMigrations["0009_media_upload_operation_journal.sql"];
  assert.match(mediaJournal, /RENAME COLUMN encoded_bytes TO stored_bytes/u);
  assert.match(mediaJournal, /DELETE FROM public\.media_upload_ledger[\s\S]*content_id IS NULL/u);
  assert.match(mediaJournal, /SET state = 'ready',[\s\S]*WHERE state IS NULL/u);
  assert.match(mediaJournal, /ALTER COLUMN content_id SET NOT NULL/u);
  assert.match(
    mediaJournal,
    /CHECK \(state IN \('installing', 'ready', 'reclaiming', 'failed'\)\)/u,
  );
  assert.match(
    mediaJournal,
    /state IN \('installing', 'reclaiming'\)[\s\S]*lease_token IS NOT NULL[\s\S]*lease_expires_at IS NOT NULL[\s\S]*state IN \('ready', 'failed'\)[\s\S]*lease_token IS NULL[\s\S]*lease_expires_at IS NULL/u,
  );
  assert.match(mediaJournal, /UNIQUE \(principal_id, content_id\)/u);
  assert.match(
    mediaJournal,
    /CREATE INDEX media_upload_ledger_active_lease_idx[\s\S]*WHERE state IN \('installing', 'reclaiming'\)/u,
  );
});

test("identity delivery claims persist one valid provenance shape", () => {
  const provenanceMigration =
    checkedMigrations["0010_identity_delivery_claim_provenance.sql"];
  assert.equal(typeof provenanceMigration, "string");
  assert.match(
    provenanceMigration,
    /ADD COLUMN claim_source text,[\s\S]*ADD COLUMN claim_actor_principal_id uuid/u,
  );
  assert.match(
    provenanceMigration,
    /UPDATE public\.auth_delivery_intent[\s\S]*SET claim_source = 'automatic'[\s\S]*WHERE status = 'processing'/u,
  );
  assert.match(
    provenanceMigration,
    /ADD CONSTRAINT auth_delivery_intent_claim_provenance_check[\s\S]*status = 'processing'[\s\S]*claim_source IS NOT NULL[\s\S]*claim_source = 'automatic' AND claim_actor_principal_id IS NULL[\s\S]*claim_source = 'explicit_retry' AND claim_actor_principal_id IS NOT NULL[\s\S]*status <> 'processing'[\s\S]*claim_source IS NULL[\s\S]*claim_actor_principal_id IS NULL/u,
  );
  assert.match(
    provenanceMigration,
    /CREATE FUNCTION public\.auth_delivery_intent_attempt_count_monotonic\(\)[\s\S]*NEW\.attempt_count < OLD\.attempt_count[\s\S]*CREATE TRIGGER auth_delivery_intent_attempt_count_guard[\s\S]*BEFORE UPDATE OF attempt_count/u,
  );

  const deliveryTableStart = checkedSnapshot.indexOf(
    "CREATE TABLE public.auth_delivery_intent (",
  );
  const deliveryTableEnd = checkedSnapshot.indexOf("\n);", deliveryTableStart);
  assert.notEqual(deliveryTableStart, -1);
  assert.notEqual(deliveryTableEnd, -1);
  const deliveryTable = checkedSnapshot.slice(
    deliveryTableStart,
    deliveryTableEnd,
  );
  assert.match(deliveryTable, /\bclaim_source text\b/u);
  assert.match(deliveryTable, /\bclaim_actor_principal_id uuid\b/u);
  assert.match(
    deliveryTable,
    /CONSTRAINT auth_delivery_intent_claim_provenance_check CHECK \([\s\S]*status = 'processing'::text[\s\S]*claim_source IS NOT NULL[\s\S]*claim_source = 'automatic'::text[\s\S]*claim_actor_principal_id IS NULL[\s\S]*claim_source = 'explicit_retry'::text[\s\S]*claim_actor_principal_id IS NOT NULL[\s\S]*status <> 'processing'::text[\s\S]*claim_source IS NULL[\s\S]*claim_actor_principal_id IS NULL/u,
  );
  assert.match(
    checkedSnapshot,
    /CREATE FUNCTION public\.auth_delivery_intent_attempt_count_monotonic\(\)[\s\S]*NEW\.attempt_count < OLD\.attempt_count/u,
  );
  assert.match(
    checkedSnapshot,
    /CREATE TRIGGER auth_delivery_intent_attempt_count_guard BEFORE UPDATE OF attempt_count ON public\.auth_delivery_intent[\s\S]*auth_delivery_intent_attempt_count_monotonic\(\)/u,
  );
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
      migrations: checkedMigrations,
      epoch: gapped,
    },
    async (root) => await assert.rejects(inspectDatabaseSchema({ root, baseEpoch: null }), /contiguous version 0002/),
  );
  await withSchema(
    { migrations: { ...checkedMigrations, "0005_unmanifested.sql": "SELECT 1;\n" } },
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
