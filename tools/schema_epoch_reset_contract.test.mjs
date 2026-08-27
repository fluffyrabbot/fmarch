import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../crates/server/src/bin/fmarch-schema-epoch-reset.rs", import.meta.url),
  "utf8",
);

test("epoch reset is exact-release confirmed and never edits SQLx history", () => {
  assert.match(source, /FMARCH_SCHEMA_EPOCH_RESET_CONFIRM/);
  assert.match(source, /format!\("\{environment\}:\{epoch\}:\{release_commit\}"\)/);
  assert.match(source, /verify_migration_authority/);
  assert.match(source, /DROP SCHEMA public CASCADE/);
  assert.match(source, /CREATE SCHEMA public AUTHORIZATION CURRENT_USER/);
  assert.doesNotMatch(source, /(?:UPDATE|DELETE FROM|INSERT INTO) _sqlx_migrations/i);
});

test("epoch reset records the state-bearing audit before execution", () => {
  for (const relation of [
    "platform_principal",
    "member_profile",
    "profile_mute",
    "events",
    "public_search_document",
    "_sqlx_migrations",
  ]) {
    assert.match(source, new RegExp(`COUNT\\(\\*\\) FROM ${relation}`));
  }
  assert.ok(source.indexOf("fmarch-schema-epoch-reset-audit") < source.indexOf("DROP SCHEMA"));
  assert.ok(source.indexOf("DROP SCHEMA") < source.indexOf("fmarch-schema-epoch-reset-complete"));
});
