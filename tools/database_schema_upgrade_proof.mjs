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

const seedSql = String.raw`
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

export async function proveDatabaseSchemaUpgrade({ upgradeUrl, freshUrl, writeAuthority = false }) {
  assert.ok(upgradeUrl && freshUrl, "upgrade and fresh disposable database URLs are required");
  assert.notEqual(upgradeUrl, freshUrl, "upgrade proof databases must be isolated");
  const epoch = JSON.parse(await readFile(epochPath, "utf8"));
  assert.ok(epoch.migrations.length >= 2, "upgrade proof requires a previous and current migration set");
  const previousDirectory = await mkdtemp(path.join(os.tmpdir(), "fmarch-previous-migrations-"));
  try {
    for (const migration of epoch.migrations.slice(0, -1)) {
      await writeFile(
        path.join(previousDirectory, migration.filename),
        await readFile(path.join(migrationDirectory, migration.filename)),
      );
    }
    run(commandPath("sqlx"), [
      "migrate",
      "run",
      "--source",
      previousDirectory,
      "--database-url",
      upgradeUrl,
    ]);
    databaseCommand("psql", upgradeUrl, seedSql);

    run("cargo", ["build", "--quiet", "--locked", "-p", "server", "--bin", "fmarch-migrate"]);
    const migrator = path.join(repoRoot, "target", "debug", "fmarch-migrate");
    runMigrator(migrator, upgradeUrl);
    runMigrator(migrator, upgradeUrl);
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
    };
  } finally {
    await rm(previousDirectory, { recursive: true, force: true });
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
