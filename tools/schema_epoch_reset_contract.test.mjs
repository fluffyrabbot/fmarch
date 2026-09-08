import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../crates/server/src/bin/fmarch-schema-epoch-reset.rs", import.meta.url),
  "utf8",
);
const authoritySource = await readFile(
  new URL("../crates/database_schema/src/authority.rs", import.meta.url),
  "utf8",
);

test("epoch reset is exact-release confirmed and never edits SQLx history", () => {
  assert.match(source, /FMARCH_SCHEMA_EPOCH_RESET_CONFIRM/);
  assert.match(source, /EMBEDDED_SCHEMA_EPOCH_DOCUMENT/);
  assert.match(source, /epoch != embedded_epoch/);
  assert.match(source, /format!\("\{environment\}:\{epoch\}:\{release_commit\}"\)/);
  assert.match(source, /verify_migration_authority/);
  assert.match(source, /DROP SCHEMA public CASCADE/);
  assert.match(source, /CREATE SCHEMA public AUTHORIZATION CURRENT_USER/);
  assert.doesNotMatch(source, /(?:UPDATE|DELETE FROM|INSERT INTO) _sqlx_migrations/i);
});

test("epoch reset atomically journals state outside public and recovers committed execution", () => {
  assert.match(source, /pg_class relation/);
  assert.match(source, /relation\.relkind NOT IN \('i', 'I', 'S', 'v'\)/);
  assert.match(source, /application_tables/);
  assert.match(source, /schema epoch reset refuses non-greenfield application table/);
  assert.match(source, /LOCK TABLE \{targets\} IN ACCESS EXCLUSIVE MODE/);
  assert.match(source, /FMARCH_SCHEMA_EPOCH_RESET_EXPECTED_INVENTORY_SHA256/);
  assert.match(source, /audit != expected_inventory/);
  const drop = source.indexOf('sqlx::query("DROP SCHEMA public CASCADE")');
  const executeAudit = source.lastIndexOf("emit_audit(", drop);
  const durableInsert = source.indexOf("INSERT INTO fmarch_release_authority.schema_epoch_reset_completion");
  const commit = source.indexOf("tx.commit().await?", durableInsert);
  assert.ok(executeAudit >= 0 && executeAudit < drop);
  assert.ok(drop < durableInsert && durableInsert < commit);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /PRIMARY KEY \(environment, epoch\)/);
  assert.match(source, /verify_schema_epoch_reset_completion_authority/);
  assert.match(authoritySource, /completion table shape drifted/);
  assert.match(authoritySource, /release authority schema must be owned solely by the database owner/);
  assert.match(authoritySource, /RELEASE_AUTHORITY_SCHEMA/);
  assert.ok(source.indexOf("load_completion") < source.indexOf("lock_public_data_relations"));
  assert.match(source, /after-commit-before-output/);
  assert.match(source, /verify_database_environment_identity/);
  assert.match(authoritySource, /acl\.grantee <> relation\.relowner/);
});

test("epoch reset confines dynamic SQL to quoted catalog relations", () => {
  assert.match(source, /struct PublicDataRelation/);
  assert.match(source, /PublicDataRelation::from_catalog\(name, &kind\)/);
  assert.match(source, /if !matches!\(kind, "r" \| "p"\)/);
  assert.match(source, /identifier\.replace\('\"', "\\\"\\\""\)/);
  assert.match(source, /struct Statement\(String\)/);
  assert.match(source, /sqlx::AssertSqlSafe\(self\.0\)/);
  assert.match(source, /sole dynamic-SQL trust boundary/);
  assert.doesNotMatch(source, /sqlx::query(?:_scalar)?\(&statement\)/);
});
