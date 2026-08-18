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
const runtimeKekRetirement = await readFile(
  path.join(repoRoot, migrationDirectory, "0026_runtime_kek_retirement.sql"),
  "utf8",
);
const eventstoreRuntimeKekRetirement = await readFile(
  path.join(repoRoot, "crates/eventstore/migrations/0004_runtime_kek_retirement.sql"),
  "utf8",
);

function runtimeKekCustodyCore(sql) {
  const startMarker = "DROP TRIGGER event_direct_key_sentinel_no_mutation";
  const endMarker = "event_stream_key_wrap_write_guard();";
  const start = sql.indexOf(startMarker);
  const end = sql.indexOf(endMarker, start);
  assert.notEqual(start, -1, "runtime KEK custody core start marker");
  assert.notEqual(end, -1, "runtime KEK custody core end marker");
  return sql
    .slice(start, end + endMarker.length)
    .replaceAll("public.", "");
}

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
    "0010_day_event_schedules.sql",
    "0011_day_event_scheduler.sql",
    "0012_day_event_auto_resolution.sql",
    "0013_day_event_narrative.sql",
    "0014_private_day_event_channels.sql",
    "0015_community_member_mutes.sql",
    "0016_member_lifecycle.sql",
    "0017_auth_session_integrity.sql",
    "0018_post_citation.sql",
    "0019_subject_privacy.sql",
    "0020_sealed_event_body.sql",
    "0021_game_pack_ref.sql",
    "0022_completed_game_detached_aliases.sql",
    "0023_erasure_outbox.sql",
    "0024_event_stream_keys.sql",
    "0025_pack_artifact_custody.sql",
    "0026_runtime_kek_retirement.sql",
    "0027_workos_session_lifecycle.sql",
    "0028_action_submission_and_engine_checkpoint.sql",
    "0029_post_embed.sql",
  ]);
  assert.equal(report.migration_file_count, 29);
  assert.ok(report.statement_count > 100);
});

test("runtime KEK retirement catalogs and fences every direct envelope column", () => {
  const envelopeColumns = [
    ["investigation_memory", "result_private", "result_private_kid"],
    ["player_info_result", "result_private", "result_private_kid"],
    ["player_investigation_result", "result_private", "result_private_kid"],
    ["private_channel_member", "private", "private_kid"],
    ["slot_state", "private", "private_kid"],
    ["thread_view", "body_private", "body_private_kid"],
    ["day_event_narrative", "body_template_private", "body_template_private_kid"],
    ["day_event_narrative", "rendered_body_private", "rendered_body_private_kid"],
    ["auth_delivery_intent", "credential_envelope", "credential_envelope_kid"],
  ];

  assert.match(
    runtimeKekRetirement,
    /lifecycle\s*=\s*'writable'[\s\S]+lifecycle\s*=\s*'retiring'[\s\S]+lifecycle\s*=\s*'retired'/u,
  );
  assert.match(runtimeKekRetirement, /retired event direct-key registry row is an immutable tombstone/u);
  assert.match(runtimeKekRetirement, /pg_advisory_xact_lock\(5065787916851041841\)/u);
  assert.match(runtimeKekRetirement, /another runtime KEK rotation is already in flight/u);
  assert.match(runtimeKekRetirement, /event_direct_key_sentinel_single_retiring_idx/u);
  assert.match(
    runtimeKekRetirement,
    /\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\*\$/u,
  );
  assert.match(
    runtimeKekRetirement,
    /\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\{0,127\}\$/u,
  );
  assert.match(
    runtimeKekRetirement,
    /event_stream_keys_wrap_kid_fkey[\s\S]+FOREIGN KEY \(wrap_kid\)[\s\S]+event_direct_key_sentinel \(kid\)[\s\S]+NOT VALID/u,
  );
  assert.match(
    runtimeKekRetirement,
    /CREATE TRIGGER event_stream_key_wrap_guard[\s\S]+BEFORE INSERT OR UPDATE OF wrap_version, wrap_kid, wrap_nonce, wrapped_dek/u,
  );
  assert.match(runtimeKekRetirement, /FOR SHARE/u);
  assert.match(runtimeKekRetirement, /CREATE VIEW public\.event_direct_key_reference/u);

  const orderedIndexes = [
    /investigation_memory \([\s\n]*result_private_kid, game_id, investigator_slot, target_slot, mode/u,
    /player_info_result \([\s\n]*result_private_kid, game_id, phase_id, event_index, audience_slot/u,
    /player_investigation_result \([\s\n]*result_private_kid, game_id, phase_id, event_index, audience_slot/u,
    /private_channel_member \([\s\n]*private_kid, game_id, channel_id, slot_id/u,
    /slot_state \(private_kid, game_id, slot_id\)/u,
    /thread_view \(body_private_kid, game_id, source_seq\)/u,
    /body_template_private_kid, game_id, event_id, lifecycle/u,
    /rendered_body_private_kid, game_id, event_id, lifecycle/u,
    /auth_delivery_intent \(credential_envelope_kid, delivery_id\)/u,
  ];
  for (const index of orderedIndexes) assert.match(runtimeKekRetirement, index);

  for (const [table, envelope, kid] of envelopeColumns) {
    assert.match(
      runtimeKekRetirement,
      new RegExp(`ALTER TABLE public\\.${table}[\\s\\S]+${kid} TEXT`, "u"),
      `${table}.${envelope} must expose a generated KID`,
    );
    assert.match(
      runtimeKekRetirement,
      new RegExp(`UPDATE OF ${envelope} ON public\\.${table}`, "u"),
      `${table}.${envelope} must be fenced by the lifecycle guard`,
    );
    assert.match(
      runtimeKekRetirement,
      new RegExp(`${table}\\.${envelope}`, "u"),
      `${table}.${envelope} must appear in the exact reference view`,
    );
  }
});

test("projection migration exactly mirrors the eventstore runtime KEK custody core", () => {
  assert.equal(
    runtimeKekCustodyCore(runtimeKekRetirement),
    runtimeKekCustodyCore(eventstoreRuntimeKekRetirement),
  );
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

test("sealed-event migration cannot erase existing event history", async () => {
  const files = { [baselineFilename]: checkedBaseline };
  for (let version = 2; version < 20; version += 1) {
    const prefix = String(version).padStart(4, "0");
    files[`${prefix}_constructive.sql`] =
      `-- ${prefix}_constructive.sql — constructive fixture.\nCREATE TABLE public.constructive_${prefix} (id bigint);`;
  }
  files["0020_sealed_event_body.sql"] =
    "-- 0020_sealed_event_body.sql — destructive fixture.\nTRUNCATE TABLE public.events;";

  await withMigrationDirectory(files, async (root) => {
    await assert.rejects(
      inspectProjectionBaseline({ root }),
      /TRUNCATE data migration/,
    );
  });
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
