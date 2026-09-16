import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { normalizeSchemaDump } from "./database_schema_snapshot.mjs";
import {
  localMigrationOperationId,
  migrationDatabaseEnvironment,
} from "./run_fmarch_migrations.mjs";

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

function rejectedDatabaseCommand(command, url, sql) {
  return run(
    commandPath(command),
    ["--set", "ON_ERROR_STOP=1", "--dbname", url, "--command", sql],
    { capture: true, allowFailure: true },
  );
}

function migratorEnvironment(url) {
  return migrationDatabaseEnvironment({ migrationUrl: url, env: process.env });
}

function runMigrator(binary, url, { allowFailure = false } = {}) {
  return run(binary, ["--operation-id", localMigrationOperationId], {
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

// Behavioral fixtures are keyed by the migration version they prove. A seed,
// when present, runs against the schema as it stood *before* that version, and
// its assertions run immediately after that version is applied and again after
// the whole chain. A single head-minus-one seed could only ever prove the newest
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

const mediaUploadJournalSeedSql = String.raw`
-- Behavioral fixtures for the 0009 recoverable media operation journal. The
-- legacy ledger admitted identity-less rows, malformed keys, duplicate final
-- charges, and prefixed in-flight charges. The upgrade must reject impossible
-- evidence, retain completed evidence, and expose interrupted work under an
-- expired lease that a reconciler can safely claim.
INSERT INTO media_upload_ledger
  (upload_id, principal_id, encoded_bytes, content_id, created_at)
VALUES
  ('88000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 11, NULL, 10),
  ('88000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000001', 12, 'not-a-content-id', 11),
  ('88000000-0000-4000-8000-000000000003',
   '10000000-0000-4000-8000-000000000001', 20, repeat('a', 64), 20),
  ('88000000-0000-4000-8000-000000000004',
   '10000000-0000-4000-8000-000000000001', 25, repeat('a', 64), 21),
  ('88000000-0000-4000-8000-000000000005',
   '10000000-0000-4000-8000-000000000001', 30,
   'pending:' || repeat('a', 64), 22),
  ('88000000-0000-4000-8000-000000000006',
   '10000000-0000-4000-8000-000000000001', 40,
   'pending:' || repeat('b', 64), 30),
  ('88000000-0000-4000-8000-000000000007',
   '10000000-0000-4000-8000-000000000001', 50, repeat('c', 64), 40);
`;

const identityDeliveryClaimProvenanceSeedSql = String.raw`
-- Behavioral fixtures for the 0010 claim-provenance cut and the following
-- 0011 provider-authority cut. The live row proves 0010 provenance and that
-- 0011 refuses pre-v2 in-flight work; the terminal row proves provider
-- generations remain retained when no call can be in flight.
INSERT INTO auth_delivery_intent
  (delivery_id, delivery_kind, account_id, principal_id, credential_hash,
   status, attempt_count, next_attempt_at, delivered_at, last_error,
   created_at, updated_at, provider_id, outcome_kind, outcome_code,
   provider_receipt_id, claim_token, claim_expires_at, credential_envelope,
   credential_expires_at)
VALUES
  ('89000000-0000-4000-8000-000000000001', 'recovery',
   'processing-upgrade@example.invalid',
   '10000000-0000-4000-8000-000000000001', repeat('1', 64),
   'processing', 2, NULL, NULL, NULL, 100, 130,
   'upgrade-processing-v1', 'processing', NULL, NULL,
   '89000000-0000-4000-8000-0000000000a1', 160, NULL, 1000),
  ('89000000-0000-4000-8000-000000000002', 'recovery',
   'delivered-upgrade@example.invalid',
   '10000000-0000-4000-8000-000000000001', repeat('2', 64),
   'delivered', 1, NULL, 120, NULL, 90, 120,
   'upgrade-terminal-v1', 'delivered', NULL, 'upgrade-receipt-1',
   NULL, NULL, NULL, 1000);
`;

const attentionDeliveryOrderSeedSql = String.raw`
-- Source 100 was watched at creation, first mentioned the reader at edit 300,
-- retained that mention at 350, removed it at 400, then re-added it at 450.
-- Source 150 mentioned the reader at creation and later removed the mention.
-- Source 200 is newer content that the reader has already read. Event order,
-- not the intentionally skewed timestamps or immutable destination, must win.
INSERT INTO discussion_area (area_id, slug, title, description, created_seq)
VALUES ('91000000-0000-4000-8000-000000000001', 'delivery-upgrade', 'Delivery Upgrade', '', 90);
INSERT INTO discussion_topic
  (topic_id, area_id, title, post_count, created_seq, updated_seq, version, created_at, updated_at)
VALUES ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
  'Delivery order', 3, 90, 200, 9, 90, 200);
INSERT INTO publication_surface
  (surface_id, search_group, title, href, visible, updated_seq)
VALUES ('92000000-0000-4000-8000-000000000001', 'discussions', 'Delivery order',
  '/d/delivery-upgrade', true, 450);
INSERT INTO discussion_post
  (source_seq, topic_id, body, created_seq, created_at, mentions, revision, edited_at)
VALUES
  (100, '92000000-0000-4000-8000-000000000001', '@reader re-added', 100, 100,
   '[{"profile_id":"40000000-0000-4000-8000-000000000001","span":{"offset":0,"len":7}}]'::jsonb, 4, 80),
  (150, '92000000-0000-4000-8000-000000000001', 'mention removed', 150, 150,
   '[]'::jsonb, 1, 160),
  (200, '92000000-0000-4000-8000-000000000001', 'newer post', 200, 200,
   '[]'::jsonb, 0, NULL);
INSERT INTO discussion_post_revision
  (source_seq, revision, body, mentions, superseded_seq, superseded_at)
VALUES
  (100, 0, 'no mention yet', '[]'::jsonb, 300, 50),
  (100, 1, '@reader first delivery',
   '[{"profile_id":"40000000-0000-4000-8000-000000000001","span":{"offset":0,"len":7}}]'::jsonb, 350, 60),
  (100, 2, '@reader unchanged mention',
   '[{"profile_id":"40000000-0000-4000-8000-000000000001","span":{"offset":0,"len":7}}]'::jsonb, 400, 70),
  (100, 3, 'mention removed', '[]'::jsonb, 450, 80),
  (150, 0, '@reader original mention',
   '[{"profile_id":"40000000-0000-4000-8000-000000000001","span":{"offset":0,"len":7}}]'::jsonb, 250, 160);
INSERT INTO public_publication
  (surface_id, source_seq, body, href, occurred_at, visible)
SELECT topic_id, source_seq, body, '/d/delivery-upgrade#post-' || source_seq::text, created_at, true
FROM discussion_post WHERE topic_id = '92000000-0000-4000-8000-000000000001';
INSERT INTO public_watch
  (subscription_id, principal_id, surface_id, active, read_through_seq, created_seq, updated_seq, version)
VALUES ('93000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001', true, 200, 95, 280, 2);
INSERT INTO public_watch_period (subscription_id, started_seq, ended_seq)
VALUES ('93000000-0000-4000-8000-000000000001', 95, NULL);
INSERT INTO member_inbox_cursor (principal_id, read_through_seq, updated_seq, version)
VALUES ('10000000-0000-4000-8000-000000000001', 200, 290, 1);
INSERT INTO member_inbox_item (principal_id, surface_id, source_seq, reason, occurred_at)
VALUES
  ('10000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 100, 'watch', 100),
  ('10000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 100, 'mention', 50),
  ('10000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 150, 'watch', 150),
  ('10000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 150, 'mention', 150),
  ('10000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 200, 'watch', 200);
`;

const gameOriginSeedSql = String.raw`
-- A legacy public game and ordinary topic have no origin relationship. The
-- additive migration must retain that absence and every old post destination.
INSERT INTO pack_artifact
  (content_hash, pack_key, pack_version, artifact_schema_version, canonical_json)
VALUES (repeat('9', 64), 'origin-upgrade', 1, 1, '{}');
INSERT INTO game_index
  (game_id, pack_key, pack_version, pack_content_hash, status, phase_id,
   created_seq, started_seq, completed_seq, updated_seq)
VALUES ('94000000-0000-4000-8000-000000000001', 'origin-upgrade', 1, repeat('9', 64),
  'active', 'D01', 600, 700, NULL, 700);
INSERT INTO discussion_area (area_id, slug, title, description, created_seq)
VALUES ('95000000-0000-4000-8000-000000000001', 'origin-upgrade', 'Origin Upgrade', '', 500);
INSERT INTO discussion_topic
  (topic_id, area_id, title, author_profile_id, post_count, created_seq, updated_seq,
   version, created_at, updated_at)
VALUES ('96000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001',
  'An ordinary topic', '40000000-0000-4000-8000-000000000001', 0, 510, 510, 1, 510, 510);
INSERT INTO publication_surface
  (surface_id, search_group, title, href, visible, updated_seq)
VALUES
  ('94000000-0000-4000-8000-000000000001', 'games', 'Legacy game',
   '/games/94000000-0000-4000-8000-000000000001', true, 700),
  ('96000000-0000-4000-8000-000000000001', 'discussions', 'An ordinary topic',
   '/discussions/origin-upgrade/t/96000000-0000-4000-8000-000000000001', true, 510);
INSERT INTO public_publication
  (surface_id, source_seq, body, href, occurred_at, visible)
VALUES ('94000000-0000-4000-8000-000000000001', 710, 'Legacy public game post',
  '/games/94000000-0000-4000-8000-000000000001#post-710', 710, true);
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
        sql: "SELECT principal_id::text || ':' || surface_id::text || ':' || source_seq::text || ':' || reason || ':' || occurred_at::text FROM member_inbox_item WHERE surface_id = '81000000-0000-4000-8000-000000000001'",
        expected:
          "60000000-0000-4000-8000-000000000001:81000000-0000-4000-8000-000000000001:5:watch:5",
        message: "0005 must backfill watch rows into the reason-derived member inbox",
      },
      {
        sql: String.raw`SELECT
        (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'public_inbox_item')::text || ':' ||
        (SELECT count(*)::text FROM member_inbox_cursor
         WHERE principal_id = '60000000-0000-4000-8000-000000000001')::text`,
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
  {
    version: 9,
    seed: mediaUploadJournalSeedSql,
    assertions: [
      {
        sql: String.raw`SELECT string_agg(
          upload_id::text || ':' || content_id || ':' || state || ':' ||
          stored_bytes::text || ':' || COALESCE(lease_token::text, '-') || ':' ||
          COALESCE(lease_expires_at::text, '-') || ':' || updated_at::text,
          ',' ORDER BY content_id)
        FROM media_upload_ledger
        WHERE principal_id = '10000000-0000-4000-8000-000000000001'`,
        expected:
          "88000000-0000-4000-8000-000000000004:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:ready:30:-:-:21,88000000-0000-4000-8000-000000000006:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:installing:40:88000000-0000-4000-8000-000000000006:30:30,88000000-0000-4000-8000-000000000007:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc:ready:50:-:-:40",
        message:
          "0009 must delete impossible evidence, converge duplicates conservatively, preserve ready content, and expose interrupted installs under expired leases",
      },
      {
        sql: String.raw`SELECT string_agg(
          column_name || ':' || data_type || ':' || is_nullable,
          ',' ORDER BY ordinal_position)
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'media_upload_ledger'`,
        expected:
          "upload_id:uuid:NO,principal_id:uuid:NO,stored_bytes:bigint:NO,content_id:text:NO,created_at:bigint:NO,state:text:NO,lease_token:uuid:YES,lease_expires_at:bigint:YES,updated_at:bigint:NO",
        message: "0009 must install the exact recoverable media journal columns",
      },
      {
        sql: String.raw`SELECT count(*)::text
        FROM pg_constraint
        WHERE conrelid = 'media_upload_ledger'::regclass
          AND conname IN (
            'media_upload_ledger_content_id_check',
            'media_upload_ledger_state_check',
            'media_upload_ledger_lease_shape_check',
            'media_upload_ledger_updated_at_check',
            'media_upload_ledger_principal_content_key'
          )`,
        expected: "5",
        message: "0009 must enforce journal identity, state, lease, time, and uniqueness",
      },
    ],
  },
  {
    version: 10,
    seed: identityDeliveryClaimProvenanceSeedSql,
    transitionalAssertions: [
      {
        sql: String.raw`SELECT string_agg(
          delivery_id::text || ':' || status || ':' ||
          COALESCE(claim_source, '-') || ':' ||
          COALESCE(claim_actor_principal_id::text, '-'),
          ',' ORDER BY delivery_id)
        FROM auth_delivery_intent
        WHERE delivery_id IN (
          '89000000-0000-4000-8000-000000000001',
          '89000000-0000-4000-8000-000000000002'
        )`,
        expected:
          "89000000-0000-4000-8000-000000000001:processing:automatic:-,89000000-0000-4000-8000-000000000002:delivered:-:-",
        message:
          "0010 must classify a legacy live claim as automatic without manufacturing authority for terminal history",
      },
    ],
  },
  {
    version: 11,
    failure: {
      seed: String.raw`SELECT 1`,
      cleanup: String.raw`DELETE FROM auth_delivery_intent
        WHERE delivery_id = '89000000-0000-4000-8000-000000000001'`,
      expectedError: /provider-authority migration requires a drained processing queue/iu,
      rollbackAssertions: [
        {
          sql: String.raw`SELECT
            (to_regclass('public.auth_delivery_provider_authority') IS NULL)::text || ':' ||
            (SELECT count(*)::text FROM _sqlx_migrations WHERE version = 11)`,
          expected: "true:0",
          message:
            "0011 failure must roll back its provider catalog and migration ledger entry",
        },
      ],
    },
    assertions: [
      {
        sql: String.raw`SELECT string_agg(
          generation_id || ':' || activated_at::text || ':' ||
          last_bound_at::text || ':' || retired_at::text || ':' ||
          (configuration_fingerprint = repeat('0', 64))::text,
          ',' ORDER BY generation_id)
        FROM auth_delivery_provider_authority
        WHERE generation_id = 'upgrade-terminal-v1'`,
        expected:
          "upgrade-terminal-v1:90:120:120:true",
        message:
          "0011 must retain terminal provider generations as immutable retired history after the processing queue drains",
      },
      {
        sql: String.raw`SELECT
          (SELECT count(*)::text FROM pg_constraint
           WHERE conname IN (
               'auth_delivery_intent_provider_generation_fkey',
               'auth_delivery_provider_attempt_fence_generation_fkey'
             )
             AND contype = 'f') || ':' ||
          (SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'auth_delivery_provider_attempt_fence')`,
        expected: "2:attempt_token,generation_id,started_at,expires_at",
        message:
          "0011 must install both provider-generation foreign keys and keep future fences anonymous",
      },
      {
        rejectedSql: String.raw`DELETE FROM auth_delivery_provider_authority
          WHERE generation_id = 'upgrade-terminal-v1'`,
        expectedError: /auth_delivery_intent_provider_generation_fkey/iu,
        message:
          "0011 must prevent deletion of retained generations referenced by delivery history",
      },
      {
        rejectedSql: String.raw`INSERT INTO auth_delivery_intent
          (delivery_id, delivery_kind, account_id, principal_id, credential_hash,
           status, attempt_count, next_attempt_at, delivered_at, last_error,
           created_at, updated_at, provider_id, outcome_kind, outcome_code,
           provider_receipt_id, claim_token, claim_expires_at,
           credential_envelope, credential_expires_at, claim_source,
           claim_actor_principal_id)
        VALUES
          ('89000000-0000-4000-8000-000000000004', 'recovery',
           'nonqueued-upgrade@example.invalid',
           '10000000-0000-4000-8000-000000000001', repeat('4', 64),
           'delivered', 1, NULL, 180, NULL, 180, 180,
           'upgrade-terminal-v1', 'delivered', NULL, 'upgrade-receipt-2',
           NULL, NULL, NULL, 1000, NULL, NULL)`,
        expectedError: /identity delivery intents must enter through queued state/iu,
        message: "0011 must reject direct insertion into every non-queued state",
      },
    ],
  },
  {
    version: 12,
    assertions: [
      {
        sql: String.raw`SELECT revision::text || ':' || coalesce(edited_at::text, 'null') || ':' ||
          coalesce(retracted_at::text, 'null') || ':' || body
        FROM discussion_post WHERE source_seq = 1`,
        expected: "0:null:null:hello",
        message:
          "0012 must backfill existing discussion posts as unedited revision 0 with no overlay",
      },
      {
        sql: String.raw`SELECT pg_get_constraintdef(oid)
        FROM pg_constraint WHERE conname = 'discussion_post_revision_pkey'`,
        expected: "PRIMARY KEY (source_seq, revision)",
        message: "0012 must key superseded revisions by the post and its revision number",
      },
      {
        rejectedSql: String.raw`UPDATE discussion_post SET revision = 1 WHERE source_seq = 1`,
        expectedError: /discussion_post_edited_check/iu,
        message: "0012 must tie a non-zero revision to a recorded edit time",
      },
      {
        rejectedSql: String.raw`INSERT INTO discussion_post_revision
          (source_seq, revision, body, mentions, superseded_seq, superseded_at)
        VALUES (999999, 0, 'orphan', '[]'::jsonb, 2, 2)`,
        expectedError: /discussion_post_revision_source_seq_fkey/iu,
        message: "0012 must refuse revision history that names no post",
      },
    ],
  },
  {
    version: 13,
    assertions: [
      {
        sql: String.raw`SELECT pinned::text || ':' ||
          (SELECT is_nullable || ':' || column_default FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'discussion_topic'
             AND column_name = 'pinned')
        FROM discussion_topic WHERE topic_id = '84000000-0000-4000-8000-000000000001'`,
        expected: "false:NO:false",
        message: "0013 must backfill existing topics as unpinned with a non-null default",
      },
      {
        sql: String.raw`SELECT pg_get_indexdef(indexrelid) FROM pg_index
        JOIN pg_class ON pg_class.oid = indexrelid
        WHERE relname = 'discussion_topic_area_pinned_idx'`,
        expected:
          "CREATE INDEX discussion_topic_area_pinned_idx ON public.discussion_topic USING btree (area_id, updated_seq DESC, topic_id DESC) WHERE pinned",
        message: "0013 must index pinned topics per area in keyset order",
      },
    ],
  },
  {
    version: 14,
    assertions: [
      {
        sql: String.raw`SELECT evidence::text FROM moderation_report LIMIT 1`,
        expected: '{"status": "not_captured"}',
        message: "0014 must preserve historical absence instead of inventing report evidence",
      },
      {
        sql: String.raw`SELECT is_nullable || ':' || COALESCE(column_default, 'none')
          FROM information_schema.columns WHERE table_schema = 'public'
          AND table_name = 'moderation_report' AND column_name = 'evidence'`,
        expected: "NO:none",
        message: "0014 must require explicit evidence on every new report row",
      },
      {
        rejectedSql: String.raw`UPDATE moderation_report SET evidence = '{}'::jsonb`,
        expectedError: /moderation_report_evidence_shape/iu,
        message: "0014 must reject unclassified evidence",
      },
    ],
  },
  {
    version: 15,
    seed: attentionDeliveryOrderSeedSql,
    assertions: [
      {
        sql: String.raw`SELECT string_agg(source_seq::text || ':' || reason || ':' ||
          delivery_seq::text || ':' || occurred_at::text, ',' ORDER BY source_seq, reason)
        FROM member_inbox_item WHERE surface_id = '92000000-0000-4000-8000-000000000001'`,
        expected: "100:mention:300:50,100:watch:100:100,150:mention:150:150,150:watch:150:150,200:watch:200:200",
        message: "0015 must recover the first mention event while preserving watch positions, original mentions, timestamps, and remove/re-add deduplication",
      },
      {
        sql: String.raw`WITH delivered AS (
          SELECT surface_id, source_seq, MAX(delivery_seq) AS delivery_seq,
                 CASE WHEN BOOL_OR(reason = 'mention') THEN 'mention' ELSE 'watch' END AS reason
          FROM member_inbox_item
          WHERE principal_id = '10000000-0000-4000-8000-000000000001'
            AND surface_id = '92000000-0000-4000-8000-000000000001'
          GROUP BY surface_id, source_seq
        )
        SELECT string_agg(item.source_seq::text || ':' || item.delivery_seq::text || ':' ||
          item.reason || ':' || (item.delivery_seq > cursor.read_through_seq
            AND item.delivery_seq > watch.read_through_seq)::text || ':' || publication.href,
          ',' ORDER BY item.delivery_seq DESC)
        FROM delivered AS item
        JOIN public_publication AS publication USING (surface_id, source_seq)
        JOIN public_watch AS watch ON watch.surface_id = item.surface_id
          AND watch.principal_id = '10000000-0000-4000-8000-000000000001'
        JOIN member_inbox_cursor AS cursor ON cursor.principal_id = watch.principal_id`,
        expected: "100:300:mention:true:/d/delivery-upgrade#post-100,200:200:watch:false:/d/delivery-upgrade#post-200,150:150:mention:false:/d/delivery-upgrade#post-150",
        message: "0015 must deliver one grouped old-post item above newer read posts without changing its destination or treating historical watch delivery as another unread item",
      },
      {
        sql: String.raw`WITH delivered AS (
          SELECT source_seq, MAX(delivery_seq) AS delivery_seq
          FROM member_inbox_item
          WHERE principal_id = '10000000-0000-4000-8000-000000000001'
            AND surface_id = '92000000-0000-4000-8000-000000000001'
          GROUP BY source_seq
        )
        SELECT (COUNT(*) FILTER (WHERE delivery_seq > 200 AND delivery_seq > 200))::text || ':' ||
          (COUNT(*) FILTER (WHERE delivery_seq > 300 AND delivery_seq > 200))::text || ':' ||
          (COUNT(*) FILTER (WHERE delivery_seq > 200 AND delivery_seq > 300))::text || ':' ||
          (SELECT read_through_seq::text FROM member_inbox_cursor
           WHERE principal_id = '10000000-0000-4000-8000-000000000001') || ':' ||
          (SELECT read_through_seq::text FROM public_watch
           WHERE subscription_id = '93000000-0000-4000-8000-000000000001')
        FROM delivered`,
        expected: "1:0:0:200:200",
        message: "0015 must leave durable read claims unchanged; advancing either global or surface delivery cursor through the edit clears the one unread destination",
      },
      {
        sql: String.raw`SELECT string_agg(source_seq::text, ',' ORDER BY delivery_seq DESC)
        FROM (
          SELECT source_seq, MAX(delivery_seq) AS delivery_seq
          FROM member_inbox_item
          WHERE principal_id = '10000000-0000-4000-8000-000000000001'
            AND surface_id = '92000000-0000-4000-8000-000000000001'
          GROUP BY source_seq
        ) AS item WHERE delivery_seq < 300`,
        expected: "200,150",
        message: "0015 delivery keyset paging must retain older items after the old post moves to the first page",
      },
      {
        sql: String.raw`SELECT is_nullable || ':' || COALESCE(column_default, 'none')
        FROM information_schema.columns WHERE table_schema = 'public'
          AND table_name = 'member_inbox_item' AND column_name = 'delivery_seq'`,
        expected: "NO:none",
        message: "0015 must require every new delivery writer to supply its event position explicitly",
      },
      {
        sql: String.raw`SELECT pg_get_indexdef(indexrelid) FROM pg_index
        JOIN pg_class ON pg_class.oid = indexrelid WHERE relname = 'member_inbox_item_page_idx'`,
        expected: "CREATE INDEX member_inbox_item_page_idx ON public.member_inbox_item USING btree (principal_id, delivery_seq DESC)",
        message: "0015 must index recipient delivery order instead of immutable post identity",
      },
      {
        rejectedSql: String.raw`UPDATE member_inbox_item SET delivery_seq = source_seq - 1
        WHERE surface_id = '92000000-0000-4000-8000-000000000001' AND source_seq = 100`,
        expectedError: /member_inbox_item_delivery_seq_check/iu,
        message: "0015 must reject a delivery position before its destination was created",
      },
      {
        rejectedSql: String.raw`INSERT INTO member_inbox_item
          (principal_id, surface_id, source_seq, delivery_seq, reason, occurred_at)
        VALUES ('10000000-0000-4000-8000-000000000001',
          '92000000-0000-4000-8000-000000000001', 100, 450, 'mention', 80)`,
        expectedError: /member_inbox_item_pkey/iu,
        message: "0015 must keep mention deduplication on the destination and reason, so a later event cannot create a second delivery identity",
      },
    ],
  },
  {
    version: 16,
    seed: gameOriginSeedSql,
    assertions: [
      {
        sql: String.raw`SELECT (origin_topic_id IS NULL)::text || ':' ||
          (SELECT COUNT(*)::text FROM discussion_topic_spawned_game
           WHERE topic_id = '96000000-0000-4000-8000-000000000001')
        FROM game_index WHERE game_id = '94000000-0000-4000-8000-000000000001'`,
        expected: "true:0",
        message: "0016 must not invent an origin relationship for a pre-existing game or topic",
      },
      {
        sql: String.raw`SELECT is_nullable || ':' || COALESCE(column_default, 'none')
        FROM information_schema.columns WHERE table_schema = 'public'
          AND table_name = 'game_index' AND column_name = 'origin_topic_id'`,
        expected: "YES:none",
        message: "0016 must leave legacy origin absence explicit rather than install a default topic",
      },
      {
        sql: String.raw`SELECT COUNT(*) FROM (
          (SELECT surface_id, source_seq, href, author_profile_id, visible FROM public_publication
           EXCEPT ALL SELECT surface_id, source_seq, href, author_profile_id, visible FROM attention_destination)
          UNION ALL
          (SELECT surface_id, source_seq, href, author_profile_id, visible FROM attention_destination
           EXCEPT ALL SELECT surface_id, source_seq, href, author_profile_id, visible FROM public_publication)
        ) AS difference`,
        expected: "0",
        message: "0016 must preserve every pre-existing public attention destination exactly, without fabricating game announcements",
      },
      {
        sql: String.raw`SELECT target.relname || ':' || constraint_row.confdeltype::text
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS target ON target.oid = constraint_row.confrelid
        WHERE constraint_row.conrelid = 'public.discussion_topic_spawned_game'::regclass
          AND constraint_row.contype = 'f'`,
        expected: "game_index:c",
        message: "0016 origin edges must cascade with their owning game and have no foreign key to the independently rebuilt topic",
      },
      {
        sql: String.raw`SELECT pg_get_indexdef(indexrelid) FROM pg_index
        JOIN pg_class ON pg_class.oid = indexrelid
        WHERE relname = 'discussion_topic_spawned_game_topic_idx'`,
        expected: "CREATE INDEX discussion_topic_spawned_game_topic_idx ON public.discussion_topic_spawned_game USING btree (topic_id, started_seq, game_id)",
        message: "0016 must index reverse topic lookups in publication order",
      },
      {
        sql: String.raw`DO $proof$
        DECLARE
          topic uuid := '96000000-0000-4000-8000-000000000001';
          game uuid := '97000000-0000-4000-8000-000000000001';
        BEGIN
          INSERT INTO game_index
            (game_id, pack_key, pack_version, pack_content_hash, status,
             created_seq, updated_seq, origin_topic_id)
          VALUES (game, 'origin-upgrade', 1, repeat('9', 64), 'setup', 800, 800, topic);
          INSERT INTO discussion_topic_spawned_game
            (game_id, topic_id, created_seq, host_principal_id)
          VALUES (game, topic, 800, '10000000-0000-4000-8000-000000000001');
          IF EXISTS (SELECT 1 FROM attention_destination WHERE surface_id = topic AND source_seq = 800) THEN
            RAISE EXCEPTION '0016 setup without a public game surface exposed an attention destination';
          END IF;
          INSERT INTO publication_surface
            (surface_id, search_group, title, href, visible, updated_seq)
          VALUES (game, 'games', 'Origin game', '/games/' || game::text, false, 800);
          IF EXISTS (SELECT 1 FROM attention_destination WHERE surface_id = topic AND source_seq = 800 AND visible) THEN
            RAISE EXCEPTION '0016 setup game became a visible announcement';
          END IF;
          UPDATE game_index SET status = 'active', phase_id = 'D01', started_seq = 900,
            updated_seq = 900 WHERE game_id = game;
          UPDATE publication_surface SET visible = true, updated_seq = 900 WHERE surface_id = game;
          IF EXISTS (SELECT 1 FROM attention_destination WHERE surface_id = topic AND source_seq = 800 AND visible) THEN
            RAISE EXCEPTION '0016 announcement became visible before its start fact';
          END IF;
          UPDATE discussion_topic_spawned_game SET started_seq = 900, started_at = 80 WHERE game_id = game;
          INSERT INTO member_inbox_item
            (principal_id, surface_id, source_seq, delivery_seq, reason, occurred_at)
          VALUES ('60000000-0000-4000-8000-000000000001', topic, 800, 900,
            'game_spawned_from_watched_topic', 80);
          IF (SELECT COUNT(*) FROM attention_destination
              WHERE surface_id = topic AND source_seq = 800 AND visible
                AND href = '/games/' || game::text
                AND author_profile_id = '40000000-0000-4000-8000-000000000001') <> 1 THEN
            RAISE EXCEPTION '0016 started game lost its stable origin-scoped identity, author, or game destination';
          END IF;
          IF NOT EXISTS (SELECT 1 FROM member_inbox_item AS item
            JOIN attention_destination AS destination USING (surface_id, source_seq)
            WHERE item.surface_id = topic AND item.source_seq = 800 AND item.delivery_seq = 900
              AND item.reason = 'game_spawned_from_watched_topic' AND destination.visible) THEN
            RAISE EXCEPTION '0016 launch delivery could not address the creation identity with the start event position';
          END IF;
          IF EXISTS (SELECT 1 FROM public_publication WHERE surface_id = topic AND source_seq = 800) THEN
            RAISE EXCEPTION '0016 attention adapter manufactured a forum post';
          END IF;
          UPDATE discussion_topic SET visibility = 'hidden' WHERE topic_id = topic;
          IF EXISTS (SELECT 1 FROM attention_destination WHERE surface_id = topic AND source_seq = 800 AND visible) THEN
            RAISE EXCEPTION '0016 hidden topic retained a visible launch destination';
          END IF;
          UPDATE discussion_topic SET visibility = 'visible' WHERE topic_id = topic;
          UPDATE publication_surface SET visible = false WHERE surface_id = game;
          IF EXISTS (SELECT 1 FROM attention_destination WHERE surface_id = topic AND source_seq = 800 AND visible) THEN
            RAISE EXCEPTION '0016 hidden game surface retained a visible launch destination';
          END IF;
          UPDATE publication_surface SET visible = true WHERE surface_id = game;
          UPDATE game_index SET status = 'completed', completed_seq = 1000, updated_seq = 1000 WHERE game_id = game;
          IF NOT EXISTS (SELECT 1 FROM attention_destination WHERE surface_id = topic AND source_seq = 800 AND visible) THEN
            RAISE EXCEPTION '0016 completion lost the public launch destination';
          END IF;
          DELETE FROM discussion_topic WHERE topic_id = topic;
          IF NOT EXISTS (SELECT 1 FROM discussion_topic_spawned_game WHERE game_id = game)
            OR NOT EXISTS (SELECT 1 FROM game_index WHERE game_id = game AND origin_topic_id = topic) THEN
            RAISE EXCEPTION '0016 topic rebuild deletion erased a game-owned origin fact';
          END IF;
          IF EXISTS (SELECT 1 FROM attention_destination WHERE surface_id = topic AND source_seq = 800) THEN
            RAISE EXCEPTION '0016 missing topic retained a launch destination';
          END IF;
          INSERT INTO discussion_topic
            (topic_id, area_id, title, author_profile_id, post_count, created_seq, updated_seq,
             version, created_at, updated_at)
          VALUES (topic, '95000000-0000-4000-8000-000000000001', 'An ordinary topic',
            '40000000-0000-4000-8000-000000000001', 0, 510, 510, 1, 510, 510);
          IF NOT EXISTS (SELECT 1 FROM attention_destination WHERE surface_id = topic AND source_seq = 800 AND visible) THEN
            RAISE EXCEPTION '0016 topic restoration failed to restore the retained launch destination';
          END IF;
          DELETE FROM game_index WHERE game_id = game;
          IF EXISTS (SELECT 1 FROM discussion_topic_spawned_game WHERE game_id = game)
            OR EXISTS (SELECT 1 FROM attention_destination WHERE surface_id = topic AND source_seq = 800) THEN
            RAISE EXCEPTION '0016 owning-game deletion failed to remove the reverse edge and destination';
          END IF;
          DELETE FROM member_inbox_item WHERE surface_id = topic AND source_seq = 800;
          DELETE FROM publication_surface WHERE surface_id = game;
        END
        $proof$;`,
        expected: "DO",
        message: "0016 must gate launch destinations on public start/visibility, retain creation identity with start delivery order, and preserve source ownership through deletion and restoration",
      },
      {
        rejectedSql: String.raw`INSERT INTO discussion_topic_spawned_game
          (game_id, topic_id, created_seq, host_principal_id, started_seq)
        VALUES ('94000000-0000-4000-8000-000000000001',
          '96000000-0000-4000-8000-000000000001', 600,
          '10000000-0000-4000-8000-000000000001', 700)`,
        expectedError: /discussion_topic_spawned_game_start_shape/iu,
        message: "0016 must reject a start event without its matching timestamp",
      },
      {
        rejectedSql: String.raw`INSERT INTO discussion_topic_spawned_game
          (game_id, topic_id, created_seq, host_principal_id)
        VALUES ('98000000-0000-4000-8000-000000000001',
          '96000000-0000-4000-8000-000000000001', 600,
          '10000000-0000-4000-8000-000000000001')`,
        expectedError: /discussion_topic_spawned_game_game_id_fkey/iu,
        message: "0016 must refuse an origin edge whose owning game does not exist",
      },
      {
        rejectedSql: String.raw`INSERT INTO member_inbox_item
          (principal_id, surface_id, source_seq, delivery_seq, reason, occurred_at)
        VALUES ('60000000-0000-4000-8000-000000000001',
          '96000000-0000-4000-8000-000000000001', 800, 900, 'invented_reason', 80)`,
        expectedError: /member_inbox_item_reason_check/iu,
        message: "0016 must extend the closed reason set without admitting unknown attention reasons",
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

function assertMigrationFixture(fixture, url, context, { includeTransitional = false } = {}) {
  if (!fixture) return;
  const checks = [
    ...(fixture.assertions ?? []),
    ...(includeTransitional ? (fixture.transitionalAssertions ?? []) : []),
  ];
  for (const check of checks) {
    if (check.rejectedSql) {
      const rejection = rejectedDatabaseCommand("psql", url, check.rejectedSql);
      assert.notEqual(rejection.status, 0, `${context}${check.message}`);
      assert.match(
        `${rejection.stdout}\n${rejection.stderr}`,
        check.expectedError,
        `${context}${check.message}`,
      );
      continue;
    }
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
      if (fixture?.seed) {
        databaseCommand("psql", upgradeUrl, fixture.seed);
      }
      if (fixture?.failure) {
        databaseCommand("psql", upgradeUrl, fixture.failure.seed);
        let failedMigration;
        if (migration.version === headVersion) {
          failedMigration = runMigrator(migrator, upgradeUrl, { allowFailure: true });
        } else {
          await writeFile(
            path.join(stagedDirectory, migration.filename),
            await readFile(path.join(migrationDirectory, migration.filename)),
          );
          failedMigration = run(
            commandPath("sqlx"),
            [
              "migrate",
              "run",
              "--source",
              stagedDirectory,
              "--database-url",
              upgradeUrl,
            ],
            { capture: true, allowFailure: true },
          );
        }
        assert.notEqual(
          failedMigration.status,
          0,
          `${migration.filename}: unsafe legacy provider work unexpectedly migrated`,
        );
        assert.match(
          `${failedMigration.stdout}\n${failedMigration.stderr}`,
          fixture.failure.expectedError,
          `${migration.filename}: migration failure did not identify unsafe legacy provider work`,
        );
        for (const check of fixture.failure.rollbackAssertions) {
          assert.equal(
            databaseCommand("psql", upgradeUrl, check.sql, { tuplesOnly: true }),
            check.expected,
            `${migration.filename}: ${check.message}`,
          );
        }
        databaseCommand("psql", upgradeUrl, fixture.failure.cleanup);
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
      assertMigrationFixture(fixture, upgradeUrl, `${migration.filename}: `, {
        includeTransitional: true,
      });
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
        assertions:
          (fixture.assertions ?? []).length + (fixture.transitionalAssertions ?? []).length,
      })),
      migration_failure_proofs: migrationFixtures
        .filter((fixture) => fixture.failure)
        .map((fixture) => ({
          version: fixture.version,
          rollback_assertions: fixture.failure.rollbackAssertions.length,
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
