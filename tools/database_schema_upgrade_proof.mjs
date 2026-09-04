import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { normalizeSchemaDump } from "./database_schema_snapshot.mjs";
import { migrationDatabaseEnvironment } from "./run_fmarch_migrations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const epochPath = path.join(repoRoot, "crates", "database_schema", "schema", "epoch.json");
const snapshotPath = path.join(repoRoot, "crates", "database_schema", "schema", "current.sql");
const authorityPath = path.join(repoRoot, "crates", "database_schema", "schema", "authority.json");
const migrationDirectory = path.join(repoRoot, "crates", "database_schema", "migrations");

function run(command, args, { env = process.env, capture = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: capture || allowFailure ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    const diagnostic = String(result.stderr || result.stdout || "").trim().slice(-4_000);
    throw new Error(`${path.basename(command)} ${args[0] ?? ""} failed: ${diagnostic}`);
  }
  return result;
}

function commandPath(command) {
  return execFileSync("/usr/bin/which", [command], { encoding: "utf8" }).trim();
}

function databaseCommand(command, url, sql, { tuplesOnly = false } = {}) {
  const args = ["--set", "ON_ERROR_STOP=1", "--dbname", url];
  if (tuplesOnly) args.push("--tuples-only", "--no-align");
  args.push("--command", sql);
  return run(commandPath(command), args, { capture: true }).stdout.trim();
}

function migratorEnvironment(url) {
  return migrationDatabaseEnvironment({ migrationUrl: url, env: process.env });
}

function runMigrator(binary, url, { allowFailure = false } = {}) {
  return run(binary, [], {
    env: migratorEnvironment(url),
    capture: true,
    allowFailure,
  });
}

function dumpSchema(url, epoch) {
  const result = run(
    commandPath("pg_dump"),
    [
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      "--exclude-table=public._sqlx_migrations",
      "--dbname",
      url,
    ],
    { capture: true },
  );
  return normalizeSchemaDump(result.stdout, epoch);
}

const authorityFingerprintSql = String.raw`
WITH authority_rows AS (
  SELECT 'schema' AS kind, n.nspname AS namespace, n.nspname AS name,
         pg_get_userbyid(n.nspowner) AS owner, COALESCE(n.nspacl::text, '') AS acl
  FROM pg_namespace AS n
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'relation', n.nspname, c.relname, pg_get_userbyid(c.relowner), COALESCE(c.relacl::text, '')
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'function', n.nspname,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         pg_get_userbyid(p.proowner), COALESCE(p.proacl::text, '')
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'default_acl', COALESCE(n.nspname, ''), d.defaclobjtype::text,
         pg_get_userbyid(d.defaclrole), d.defaclacl::text
  FROM pg_default_acl AS d
  LEFT JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'kind', kind, 'namespace', namespace, 'name', name, 'owner', owner, 'acl', acl
) ORDER BY kind, namespace, name, owner, acl), '[]'::jsonb)::text
FROM authority_rows;
`;

// Behavioral fixtures are keyed by the migration version they prove. Each
// seed runs against the schema as it stood *before* that version, and its
// assertions run immediately after that version is applied and again after the
// whole chain. A single head-minus-one seed could only ever prove the newest
// migration, so every new migration silently retired its predecessor's
// data-cut proof; keying by version keeps all of them running.

const sharedSeedSql = String.raw`
INSERT INTO platform_principal (principal_id, created_at)
VALUES ('10000000-0000-4000-8000-000000000001', 1);
INSERT INTO privacy_subject (subject_id, principal_id, created_at)
VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1);
INSERT INTO subject_private_claim
  (claim_id, subject_id, claim_kind, scope_id, scope_key, envelope, created_at)
VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'profile', '40000000-0000-4000-8000-000000000001', NULL, '{}'::jsonb, 1);
INSERT INTO member_profile
  (profile_id, active_principal_id, handle_hmac, lifecycle, created_seq, updated_seq,
   revision, subject_id, current_claim_id)
VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   decode(repeat('00', 32), 'hex'), 'active', 1, 1, 1,
   '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001');
INSERT INTO public_profile
  (profile_id, handle, display_name, bio, created_seq, updated_seq, revision)
VALUES
  ('40000000-0000-4000-8000-000000000001', 'upgrade-target', 'Upgrade Target', '', 1, 1, 1);
INSERT INTO profile_mute
  (relationship_id, principal_id, target_profile_id, active, updated_seq, version)
VALUES
  ('50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001', true, 1, 1);
`;

const legacyAuthoritySeedSql = String.raw`
-- Behavioral fixtures for the 0004 authority cut. Ticket kinds are
-- deliberately mismatched so cleanup must follow the session reference.
INSERT INTO authentication_method
  (method_id, principal_id, kind, status, created_at, last_authenticated_at)
VALUES
  ('71000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'workos', 'active', 1, 1),
  ('71000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   'classic_password', 'active', 1, 1);
INSERT INTO external_identity
  (provider, subject, principal_id, created_at, last_seen_at, method_id)
VALUES
  ('workos', 'user_upgrade_admin', '10000000-0000-4000-8000-000000000001',
   1, 1, '71000000-0000-4000-8000-000000000001');
INSERT INTO workos_provider_session
  (provider_session_id, subject, principal_id, method_id, status,
   created_at, last_seen_at, access_expires_at)
VALUES
  ('session_01HQAG1HENBZMAZD82YRXDFC0B', 'user_upgrade_admin',
   '10000000-0000-4000-8000-000000000001',
   '71000000-0000-4000-8000-000000000001', 'active', 1, 1, 100);
INSERT INTO auth_session
  (token_hash, principal_id, created_at, expires_at, global_capabilities,
   idle_expires_at, assurance, authenticated_at)
VALUES
  (repeat('a', 64), '10000000-0000-4000-8000-000000000001', 1, 100,
   ARRAY['GlobalAdmin'], 100, 'admin_grant', 1);
INSERT INTO auth_session
  (token_hash, principal_id, created_at, expires_at, global_capabilities,
   idle_expires_at, assurance, authenticated_at)
VALUES
  (repeat('d', 64), '10000000-0000-4000-8000-000000000001', 1, 100,
   ARRAY[]::text[], 100, 'dev', 1);
INSERT INTO auth_session
  (token_hash, principal_id, created_at, expires_at, global_capabilities,
   authenticated_via_method_id, idle_expires_at, assurance, authenticated_at,
   workos_session_id)
VALUES
  (repeat('f', 64), '10000000-0000-4000-8000-000000000001', 1, 100,
   ARRAY[]::text[], '71000000-0000-4000-8000-000000000001', 100,
   'external_sso', 1, 'session_01HQAG1HENBZMAZD82YRXDFC0B');
INSERT INTO auth_session
  (token_hash, principal_id, created_at, expires_at, global_capabilities,
   authenticated_via_method_id, idle_expires_at, assurance, authenticated_at)
VALUES
  (repeat('b', 63) || '1', '10000000-0000-4000-8000-000000000001', 1, 100,
   ARRAY[]::text[], '71000000-0000-4000-8000-000000000002', 100,
   'password', 1);
-- A password label cannot launder a legacy session-local capability snapshot.
INSERT INTO auth_session
  (token_hash, principal_id, created_at, expires_at, global_capabilities,
   authenticated_via_method_id, idle_expires_at, assurance, authenticated_at)
VALUES
  (repeat('b', 63) || '7', '10000000-0000-4000-8000-000000000001', 1, 100,
   ARRAY['GlobalAdmin'], '71000000-0000-4000-8000-000000000002', 100,
   'password', 1);
INSERT INTO workos_session_exchange
  (provider_session_id, access_token_hash, exchanged_at, access_expires_at,
   linking_session_hash)
VALUES
  ('session_01HQAG1HENBZMAZD82YRXDFC0B', repeat('b', 64), 1, 100,
   repeat('a', 64));
INSERT INTO workos_session_exchange
  (provider_session_id, access_token_hash, exchanged_at, access_expires_at,
   linking_session_hash)
VALUES
  ('session_01HQAG1HENBZMAZD82YRXDFC0B', repeat('8', 64), 1, 100,
   repeat('f', 64));
INSERT INTO auth_websocket_ticket
  (token_hash, auth_kind, session_reference, access_expires_at, principal_id,
   audience, game_id, channel_id, after_seq, issued_at, expires_at)
VALUES
  (repeat('c', 64), 'classic', repeat('a', 64), 100,
   '10000000-0000-4000-8000-000000000001', 'fmarch-live',
   '72000000-0000-4000-8000-000000000001', 'main', 0, 1, 100);
INSERT INTO auth_websocket_ticket
  (token_hash, auth_kind, session_reference, access_expires_at, principal_id,
   audience, game_id, channel_id, after_seq, issued_at, expires_at)
VALUES
  (repeat('e', 64), 'workos', repeat('d', 64), 100,
   '10000000-0000-4000-8000-000000000001', 'fmarch-live',
   '72000000-0000-4000-8000-000000000001', 'main', 0, 1, 100);
INSERT INTO auth_websocket_ticket
  (token_hash, auth_kind, session_reference, access_expires_at, principal_id,
   audience, game_id, channel_id, after_seq, issued_at, expires_at)
VALUES
  (repeat('9', 64), 'classic', repeat('f', 64), 100,
   '10000000-0000-4000-8000-000000000001', 'fmarch-live',
   '72000000-0000-4000-8000-000000000001', 'main', 0, 1, 100);
INSERT INTO auth_websocket_ticket
  (token_hash, auth_kind, session_reference, access_expires_at, principal_id,
   audience, game_id, channel_id, after_seq, issued_at, expires_at)
VALUES
  (repeat('b', 63) || '2', 'classic', repeat('b', 63) || '1', 100,
   '10000000-0000-4000-8000-000000000001', 'fmarch-live',
   '72000000-0000-4000-8000-000000000001', 'main', 0, 1, 100),
  (repeat('b', 63) || '3', 'dev', repeat('b', 63) || '1', 100,
   '10000000-0000-4000-8000-000000000001', 'fmarch-live',
   '72000000-0000-4000-8000-000000000001', 'main', 0, 1, 100),
  (repeat('b', 63) || '4', 'admin_grant', repeat('b', 63) || '1', 100,
   '10000000-0000-4000-8000-000000000001', 'fmarch-live',
   '72000000-0000-4000-8000-000000000001', 'main', 0, 1, 100),
  (repeat('b', 63) || '5', 'classic', repeat('b', 63) || '6', 100,
   '10000000-0000-4000-8000-000000000001', 'fmarch-live',
   '72000000-0000-4000-8000-000000000001', 'main', 0, 1, 100),
  (repeat('b', 63) || '8', 'classic', repeat('b', 63) || '7', 100,
   '10000000-0000-4000-8000-000000000001', 'fmarch-live',
   '72000000-0000-4000-8000-000000000001', 'main', 0, 1, 100);
`;

const reasonDerivedInboxSeedSql = String.raw`
-- Behavioral fixtures for the 0005 reason-derived inbox cut. The watcher is a
-- different principal than the post author, so the backfill must carry the row.
INSERT INTO publication_surface
  (surface_id, search_group, title, href, visible, updated_seq)
VALUES
  ('81000000-0000-4000-8000-000000000001', 'discussions', 'Upgrade Watch Target',
   '/d/upgrade', true, 1);
INSERT INTO public_publication
  (surface_id, source_seq, body, href, author_profile_id, occurred_at, visible)
VALUES
  ('81000000-0000-4000-8000-000000000001', 5, 'watched post', '/d/upgrade#5',
   '40000000-0000-4000-8000-000000000001', 5, true);
INSERT INTO public_watch
  (subscription_id, principal_id, surface_id, active, read_through_seq,
   created_seq, updated_seq, version)
VALUES
  ('82000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
   '81000000-0000-4000-8000-000000000001', true, 0, 1, 1, 1);
INSERT INTO public_watch_period (subscription_id, started_seq, ended_seq)
VALUES ('82000000-0000-4000-8000-000000000001', 1, NULL);
INSERT INTO public_inbox_item (subscription_id, source_seq, surface_id, occurred_at)
VALUES ('82000000-0000-4000-8000-000000000001', 5,
  '81000000-0000-4000-8000-000000000001', 5);
`;

const discussionPostMentionsSeedSql = String.raw`
-- Behavioral fixtures for the 0006 discussion-post mention edge. The post is
-- written before the mentions column exists; the upgrade must backfill it to
-- the empty list, which is also how pre-mention events upcast.
INSERT INTO discussion_area (area_id, slug, title, description, created_seq)
VALUES ('83000000-0000-4000-8000-000000000001', 'mentions', 'Mentions', '', 1);
INSERT INTO discussion_topic
  (topic_id, area_id, title, author_profile_id, posting_state, visibility,
   post_count, created_seq, updated_seq, version, created_at, updated_at)
VALUES ('84000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001',
  'Mention edges', '40000000-0000-4000-8000-000000000001', 'open', 'visible',
  1, 1, 1, 1, 1, 1);
INSERT INTO discussion_post (source_seq, topic_id, body, created_seq, author_profile_id, created_at)
VALUES (1, '84000000-0000-4000-8000-000000000001', 'hello', 1,
  '40000000-0000-4000-8000-000000000001', 1);
`;

const mentionAbuseReasonSeedSql = String.raw`
-- Behavioral fixtures for the 0007 mention-abuse report reason. The report is
-- written while the CHECK set still excludes 'mention_abuse'; widening a closed
-- constraint must admit the new value without disturbing any report already
-- filed under an old one.
INSERT INTO moderation_case
  (case_id, surface_id, source_seq, status, report_count, opened_at, updated_at,
   updated_seq, version)
VALUES ('85000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001', 5, 'open', 1, 1, 1, 1, 1);
INSERT INTO moderation_report
  (report_id, case_id, reporter_principal_id, reason_family, details, active,
   submitted_seq, submitted_at)
VALUES ('86000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001', 'harassment', 'legacy report', true, 1, 1);
`;

const gameSlotMentionsSeedSql = String.raw`
-- Behavioral fixtures for the 0008 game slot mention edge and delivery. The
-- post is written before the mentions column exists; the upgrade must backfill
-- it to the empty list, which is also how pre-mention PostSubmitted events
-- upcast. The delivery table is new, so the fixture proves its shape rather
-- than its contents: it must address a seat and carry no principal.
INSERT INTO thread_view
  (game_id, source_seq, stream_seq, channel_id, author_kind, author_slot_id,
   phase_id, occurred_at, media, body, quotations)
VALUES ('87000000-0000-4000-8000-000000000001', 1, 1, 'main', 'slot', 'slot_1',
  'D01', 1, '[]'::jsonb, 'hello', '[]'::jsonb);
`;

const migrationFixtures = [
  {
    version: 4,
    seed: legacyAuthoritySeedSql,
    assertions: [
      {
        sql: String.raw`SELECT
        (SELECT count(*) FROM auth_session WHERE token_hash = repeat('a', 64))::text || ':' ||
        (SELECT count(*) FROM workos_session_exchange WHERE linking_session_hash = repeat('a', 64))::text || ':' ||
        (SELECT count(*) FROM auth_websocket_ticket WHERE session_reference = repeat('a', 64))::text || ':' ||
        (SELECT count(*) FROM auth_session WHERE token_hash = repeat('d', 64))::text || ':' ||
        (SELECT count(*) FROM auth_websocket_ticket WHERE session_reference = repeat('d', 64))::text || ':' ||
        (SELECT count(*) FROM auth_session WHERE token_hash = repeat('f', 64))::text || ':' ||
        (SELECT count(*) FROM workos_session_exchange WHERE linking_session_hash = repeat('f', 64))::text || ':' ||
        (SELECT count(*) FROM auth_websocket_ticket WHERE session_reference = repeat('f', 64))::text || ':' ||
        (SELECT count(*) FROM workos_session_exchange WHERE access_token_hash = repeat('b', 64))::text || ':' ||
        (SELECT count(*) FROM workos_session_exchange WHERE access_token_hash = repeat('8', 64))::text`,
        expected: "0:0:0:0:0:0:0:0:1:1",
        message:
          "0004 must delete unproven AdminGrant, Dev, and WorkOS sessions, sever their references, and preserve one-time assertion replay evidence",
      },
      {
        sql: String.raw`SELECT
        (SELECT count(*) FROM authentication_method
         WHERE method_id = '71000000-0000-4000-8000-000000000002'
           AND kind = 'classic_password')::text || ':' ||
        (SELECT count(*) FROM auth_session
         WHERE token_hash = repeat('b', 63) || '1'
           AND authenticated_via_method_id = '71000000-0000-4000-8000-000000000002'
           AND assurance = 'password')::text || ':' ||
        (SELECT count(*) FROM auth_websocket_ticket
         WHERE token_hash = repeat('b', 63) || '2'
           AND session_reference = repeat('b', 63) || '1')::text`,
        expected: "1:1:1",
        message: "0004 must preserve a valid password method, its session, and its websocket ticket",
      },
      {
        sql: String.raw`SELECT
        (SELECT count(*) FROM auth_session
         WHERE token_hash = repeat('b', 63) || '7')::text || ':' ||
        (SELECT count(*) FROM auth_websocket_ticket
         WHERE token_hash = repeat('b', 63) || '8')::text`,
        expected: "0:0",
        message:
          "0004 must revoke a password-labeled session carrying a legacy capability snapshot and its derivative ticket",
      },
      {
        sql: String.raw`SELECT
        (SELECT count(*) FROM auth_websocket_ticket
         WHERE token_hash = repeat('b', 63) || '3')::text || ':' ||
        (SELECT count(*) FROM auth_websocket_ticket
         WHERE token_hash = repeat('b', 63) || '4')::text || ':' ||
        (SELECT count(*) FROM auth_websocket_ticket
         WHERE token_hash = repeat('b', 63) || '5')::text || ':' ||
        (SELECT count(*) FROM auth_session
         WHERE token_hash = repeat('b', 63) || '1')::text`,
        expected: "0:0:0:1",
        message:
          "0004 must remove Dev/AdminGrant-labeled and orphan tickets without deleting their valid password session",
      },
    ],
  },
  {
    version: 5,
    seed: reasonDerivedInboxSeedSql,
    assertions: [
      {
        sql: "SELECT principal_id::text || ':' || surface_id::text || ':' || source_seq::text || ':' || reason || ':' || occurred_at::text FROM member_inbox_item",
        expected:
          "60000000-0000-4000-8000-000000000001:81000000-0000-4000-8000-000000000001:5:watch:5",
        message: "0005 must backfill watch rows into the reason-derived member inbox",
      },
      {
        sql: String.raw`SELECT
        (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'public_inbox_item')::text || ':' ||
        (SELECT count(*)::text FROM member_inbox_cursor)::text`,
        expected: "0:0",
        message:
          "0005 must drop the subscription-keyed inbox table and start with an empty member inbox cursor",
      },
    ],
  },
  {
    version: 6,
    seed: discussionPostMentionsSeedSql,
    assertions: [
      {
        sql: String.raw`SELECT
        (SELECT mentions::text FROM discussion_post
         WHERE topic_id = '84000000-0000-4000-8000-000000000001')::text || ':' ||
        (SELECT is_nullable || ':' || column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'discussion_post'
           AND column_name = 'mentions')::text`,
        expected: "[]:NO:'[]'::jsonb",
        message:
          "0006 must backfill existing discussion posts to the empty mention list with a non-null default",
      },
    ],
  },
  {
    version: 7,
    seed: mentionAbuseReasonSeedSql,
    assertions: [
      {
        sql: String.raw`SELECT pg_get_constraintdef(oid)
        FROM pg_constraint WHERE conname = 'moderation_report_reason_family_check'`,
        expected:
          "CHECK ((reason_family = ANY (ARRAY['spam'::text, 'harassment'::text, 'hate'::text, 'sexual_content'::text, 'self_harm'::text, 'mention_abuse'::text, 'other'::text])))",
        message: "0007 must admit mention_abuse into the report reason family",
      },
      {
        sql: String.raw`SELECT reason_family || ':' || details FROM moderation_report
        WHERE report_id = '86000000-0000-4000-8000-000000000001'`,
        expected: "harassment:legacy report",
        message: "0007 must leave reports filed under the previous reason set untouched",
      },
    ],
  },
  {
    version: 8,
    seed: gameSlotMentionsSeedSql,
    assertions: [
      {
        sql: String.raw`SELECT
        (SELECT mentions::text FROM thread_view
         WHERE game_id = '87000000-0000-4000-8000-000000000001')::text || ':' ||
        (SELECT is_nullable || ':' || column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'thread_view'
           AND column_name = 'mentions')::text`,
        expected: "[]:NO:'[]'::jsonb",
        message:
          "0008 must backfill existing game posts to the empty mention list with a non-null default",
      },
      {
        sql: String.raw`SELECT pg_get_constraintdef(oid)
        FROM pg_constraint WHERE conname = 'slot_mention_notification_pkey'`,
        expected: "PRIMARY KEY (game_id, audience_slot, source_seq)",
        message: "0008 must key slot mention delivery by the seat and the addressing post",
      },
      {
        sql: String.raw`SELECT string_agg(column_name, ',' ORDER BY column_name)
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'slot_mention_notification'`,
        expected: "audience_slot,channel_id,game_id,occurred_at,phase_id,source_seq",
        message:
          "0008 must address a seat and store no principal, persona, or occupancy",
      },
      {
        sql: String.raw`SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'slot_mention_notification'
          AND column_name = 'phase_id'`,
        expected: "YES",
        message:
          "0008 must let setup discussion, which is deliberately outside a phase, still deliver",
      },
    ],
  },
];

const postMigrationAuthorityInvariantSql = String.raw`
DO $proof$
BEGIN
  BEGIN
    INSERT INTO auth_session
      (token_hash, principal_id, created_at, expires_at,
       idle_expires_at, assurance, authenticated_at)
    VALUES
      (repeat('5', 64), '10000000-0000-4000-8000-000000000001', 1, 100,
       100, 'admin_grant', 1);
    RAISE EXCEPTION 'post-0004 auth_session accepted admin_grant';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO auth_session
      (token_hash, principal_id, created_at, expires_at,
       idle_expires_at, assurance, authenticated_at)
    VALUES
      (repeat('6', 64), '10000000-0000-4000-8000-000000000001', 1, 100,
       100, 'dev', 1);
    RAISE EXCEPTION 'post-0004 Dev session accepted without an instance id';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO auth_session
      (token_hash, principal_id, created_at, expires_at,
       idle_expires_at, assurance, authenticated_at, local_proof_instance_id)
    VALUES
      (repeat('7', 64), '10000000-0000-4000-8000-000000000001', 1, 100,
       100, 'password', 1, repeat('a', 64));
    RAISE EXCEPTION 'post-0004 non-Dev session accepted a local-proof instance id';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO auth_session
      (token_hash, principal_id, created_at, expires_at,
       authenticated_via_method_id, idle_expires_at, assurance, authenticated_at,
       workos_session_id)
    VALUES
      (repeat('0', 64), '10000000-0000-4000-8000-000000000001', 1, 100,
       '71000000-0000-4000-8000-000000000001', 100,
       'external_sso', 1, 'session_01HQAG1HENBZMAZD82YRXDFC0B');
    RAISE EXCEPTION 'post-0004 WorkOS session accepted without signing-key provenance';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO auth_websocket_ticket
      (token_hash, session_reference, access_expires_at,
       audience, game_id, channel_id, after_seq, issued_at, expires_at)
    VALUES
      (repeat('4', 64), repeat('3', 64), 100, 'fmarch-live',
       '72000000-0000-4000-8000-000000000001', 'main', 0, 1, 100);
    RAISE EXCEPTION 'post-0004 websocket ticket accepted an orphan session reference';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auth_websocket_ticket'
      AND column_name IN ('auth_kind', 'principal_id', 'consumed_at')
  ) THEN
    RAISE EXCEPTION 'post-0004 websocket ticket retained redundant authority metadata';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'global_capabilities'
      AND table_name IN ('auth_session', 'game_invitation', 'auth_account')
  ) THEN
    RAISE EXCEPTION 'post-0004 hosted identity rows retained global capability snapshots';
  END IF;
END
$proof$;

INSERT INTO workos_signing_key_tombstone
  (signing_key_id, retired_at, retired_by_principal_id, reason)
VALUES
  ('retired-upgrade-key', 2, '10000000-0000-4000-8000-000000000001',
   'upgrade retirement proof');
DO $proof$
BEGIN
  BEGIN
    UPDATE workos_signing_key_tombstone
    SET reason = 'rewritten'
    WHERE signing_key_id = 'retired-upgrade-key';
    RAISE EXCEPTION 'post-0004 WorkOS signing-key tombstone accepted update';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'post-0004%' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    DELETE FROM workos_signing_key_tombstone
    WHERE signing_key_id = 'retired-upgrade-key';
    RAISE EXCEPTION 'post-0004 WorkOS signing-key tombstone accepted deletion';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'post-0004%' THEN
      RAISE;
    END IF;
  END;
END
$proof$;

INSERT INTO auth_session
  (token_hash, principal_id, created_at, expires_at,
   idle_expires_at, assurance, authenticated_at, local_proof_instance_id)
VALUES
  (repeat('1', 64), '10000000-0000-4000-8000-000000000001', 1, 100,
   100, 'dev', 1, repeat('a', 64));
INSERT INTO auth_websocket_ticket
  (token_hash, session_reference, access_expires_at,
   audience, game_id, channel_id, after_seq, issued_at, expires_at)
VALUES
  (repeat('2', 64), repeat('1', 64), 100, 'fmarch-live',
   '72000000-0000-4000-8000-000000000001', 'main', 0, 1, 100);
DELETE FROM auth_session WHERE token_hash = repeat('1', 64);
DO $proof$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth_websocket_ticket WHERE token_hash = repeat('2', 64)
  ) THEN
    RAISE EXCEPTION 'auth-session deletion did not cascade to websocket ticket';
  END IF;
END
$proof$;
`;

function authorityArtifact(epoch, rawFingerprint, schemaOwner) {
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
    }
    return typeof value === "string" ? value.replaceAll(schemaOwner, "$schema_owner") : value;
  };
  return `${JSON.stringify({
    version: 1,
    epoch,
    roles: {
      schema_owner: "$schema_owner",
      application: "fmarch_application",
      key_admin: "fmarch_key_admin",
    },
    rows: normalize(JSON.parse(rawFingerprint)),
  }, null, 2)}\n`;
}

function assertMigrationFixture(fixture, url, context) {
  if (!fixture) return;
  for (const check of fixture.assertions) {
    assert.equal(
      databaseCommand("psql", url, check.sql, { tuplesOnly: true }),
      check.expected,
      `${context}${check.message}`,
    );
  }
}

export async function proveDatabaseSchemaUpgrade({ upgradeUrl, freshUrl, writeAuthority = false }) {
  assert.ok(upgradeUrl && freshUrl, "upgrade and fresh disposable database URLs are required");
  assert.notEqual(upgradeUrl, freshUrl, "upgrade proof databases must be isolated");
  const epoch = JSON.parse(await readFile(epochPath, "utf8"));
  assert.ok(epoch.migrations.length >= 2, "upgrade proof requires a previous and current migration set");
  for (const fixture of migrationFixtures) {
    assert.ok(
      epoch.migrations.some((migration) => migration.version === fixture.version),
      `behavioral fixture claims migration version ${fixture.version}, which the epoch manifest does not list`,
    );
  }
  const stagedDirectory = await mkdtemp(path.join(os.tmpdir(), "fmarch-staged-migrations-"));
  try {
    run("cargo", ["build", "--quiet", "--locked", "-p", "server", "--bin", "fmarch-migrate"]);
    const migrator = path.join(repoRoot, "target", "debug", "fmarch-migrate");
    const headVersion = epoch.migrations.at(-1).version;
    const firstFixtureVersion = Math.min(...migrationFixtures.map((fixture) => fixture.version));

    // Walk the chain one migration at a time so each version's fixtures are
    // seeded against the schema that version actually upgraded from, and its
    // assertions run against the schema that version produced.
    for (const migration of epoch.migrations) {
      if (migration.version === firstFixtureVersion) {
        databaseCommand("psql", upgradeUrl, sharedSeedSql);
      }
      const fixture = migrationFixtures.find((candidate) => candidate.version === migration.version);
      if (fixture) {
        databaseCommand("psql", upgradeUrl, fixture.seed);
      }
      if (migration.version === headVersion) {
        // The shipped migrator, not sqlx, must be what upgrades a populated
        // database; the second run proves the head migration is idempotent.
        runMigrator(migrator, upgradeUrl);
        runMigrator(migrator, upgradeUrl);
      } else {
        await writeFile(
          path.join(stagedDirectory, migration.filename),
          await readFile(path.join(migrationDirectory, migration.filename)),
        );
        run(commandPath("sqlx"), [
          "migrate",
          "run",
          "--source",
          stagedDirectory,
          "--database-url",
          upgradeUrl,
        ]);
      }
      assertMigrationFixture(fixture, upgradeUrl, `${migration.filename}: `);
    }

    // Re-run every fixture against the fully migrated database: a later
    // migration must not quietly undo what an earlier one proved.
    for (const fixture of migrationFixtures) {
      assertMigrationFixture(fixture, upgradeUrl, "after the full migration chain, ");
    }

    runMigrator(migrator, freshUrl);

    const checkedSnapshot = await readFile(snapshotPath, "utf8");
    const upgradedSnapshot = dumpSchema(upgradeUrl, epoch.epoch);
    const freshSnapshot = dumpSchema(freshUrl, epoch.epoch);
    assert.equal(upgradedSnapshot, checkedSnapshot, "upgraded catalog differs from schema/current.sql");
    assert.equal(freshSnapshot, checkedSnapshot, "fresh catalog differs from schema/current.sql");
    assert.equal(upgradedSnapshot, freshSnapshot, "upgraded and fresh catalogs differ");

    const upgradedAuthority = databaseCommand("psql", upgradeUrl, authorityFingerprintSql, { tuplesOnly: true });
    const freshAuthority = databaseCommand("psql", freshUrl, authorityFingerprintSql, { tuplesOnly: true });
    assert.equal(upgradedAuthority, freshAuthority, "upgraded and fresh ACL/owner fingerprints differ");
    const schemaOwner = decodeURIComponent(new URL(freshUrl).username);
    assert.ok(schemaOwner, "fresh authority URL must identify the schema owner");
    const authority = authorityArtifact(epoch.epoch, freshAuthority, schemaOwner);
    const authoritySha256 = createHash("sha256").update(authority).digest("hex");
    if (writeAuthority) {
      await writeFile(authorityPath, authority);
      await writeFile(
        epochPath,
        `${JSON.stringify({ ...epoch, authority_fingerprint_sha256: authoritySha256 }, null, 2)}\n`,
      );
    } else {
      assert.equal(
        await readFile(authorityPath, "utf8"),
        authority,
        "schema/authority.json drifted from the fresh authority fingerprint",
      );
      assert.equal(
        epoch.authority_fingerprint_sha256,
        authoritySha256,
        "epoch authority_fingerprint_sha256 drifted from schema/authority.json",
      );
    }

    const preserved = databaseCommand(
      "psql",
      upgradeUrl,
      "SELECT relationship_id::text || ':' || active::text || ':' || version::text FROM profile_mute WHERE relationship_id = '50000000-0000-4000-8000-000000000001'",
      { tuplesOnly: true },
    );
    assert.equal(preserved, "50000000-0000-4000-8000-000000000001:true:1");
    databaseCommand("psql", upgradeUrl, postMigrationAuthorityInvariantSql);
    const targetConstraint = databaseCommand(
      "psql",
      upgradeUrl,
      "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'profile_mute_target_profile_id_fkey'",
      { tuplesOnly: true },
    );
    assert.match(targetConstraint, /REFERENCES member_profile\(profile_id\)/u);
    assert.match(targetConstraint, /ON DELETE RESTRICT/u);
    const migrationCount = databaseCommand(
      "psql",
      upgradeUrl,
      "SELECT count(*)::text FROM _sqlx_migrations WHERE success",
      { tuplesOnly: true },
    );
    assert.equal(Number.parseInt(migrationCount, 10), epoch.migrations.length);

    databaseCommand(
      "psql",
      upgradeUrl,
      "UPDATE _sqlx_migrations SET checksum = decode(repeat('00', 32), 'hex') WHERE version = 1",
    );
    const mismatch = runMigrator(migrator, upgradeUrl, { allowFailure: true });
    assert.notEqual(mismatch.status, 0, "checksum corruption unexpectedly passed migration readiness");
    assert.match(`${mismatch.stdout}\n${mismatch.stderr}`, /VersionMismatch\(1\)|version 1.*checksum/iu);

    return {
      status: "passed",
      previous_head: epoch.migrations.at(-2).filename,
      current_head: epoch.migrations.at(-1).filename,
      data_preserved: true,
      catalogs_equal: true,
      authority_equal: true,
      authority_fingerprint_sha256: authoritySha256,
      checksum_mismatch_terminal: true,
      migration_behavior_proofs: migrationFixtures.map((fixture) => ({
        version: fixture.version,
        assertions: fixture.assertions.length,
      })),
      workos_signing_key_retirement_monotonic: true,
      websocket_session_reference_enforced: true,
      websocket_redundant_authority_removed: true,
      websocket_session_delete_cascades: true,
    };
  } finally {
    await rm(stagedDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--write-authority");
  assert.deepEqual(unknown, [], `unknown database schema upgrade proof argument: ${unknown.join(", ")}`);
  const report = await proveDatabaseSchemaUpgrade({
    upgradeUrl: process.env.FMARCH_SCHEMA_UPGRADE_DATABASE_URL,
    freshUrl: process.env.FMARCH_SCHEMA_FRESH_DATABASE_URL,
    writeAuthority: process.argv.includes("--write-authority"),
  });
  console.log(JSON.stringify(report, null, 2));
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(`database schema upgrade proof failed: ${error.message}`);
    process.exitCode = 1;
  });
}
