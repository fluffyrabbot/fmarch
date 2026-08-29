import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applicationDatabaseEnvironment,
  fmarchMigrationInvocation,
  keyAdminDatabaseEnvironment,
  localDatabaseAuthority,
  localDatabaseRoleNames,
  migrationDatabaseEnvironment,
  serverRuntimeEnvironment,
} from "./run_fmarch_migrations.mjs";

const migrationHarnessCallers = Object.freeze([
  "game_invitation_role_proof.mjs",
  "capacity_overload_proof.mjs",
  "community_moderation_role_proof.mjs",
  "public_watch_role_proof.mjs",
  "completed_game_export_role_proof.mjs",
  "dev_test_game.mjs",
  "discussion_role_proof.mjs",
  "game_index_role_proof.mjs",
  "host_console_live_stack_smoke.mjs",
  "host_console_tablet_smoke.mjs",
  "live_stack_backup_restore_drill.mjs",
  "mash_scale_acceptance.mjs",
  "operator_browser_smoke.mjs",
  "profile_role_proof.mjs",
  "public_search_role_proof.mjs",
]);
const ambientPostgresVariables = Object.freeze([
  "PGAPPNAME",
  "PGDATABASE",
  "PGHOST",
  "PGHOSTADDR",
  "PGOPTIONS",
  "PGPASSFILE",
  "PGPASSWORD",
  "PGPORT",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGSSLCERT",
  "PGSSLKEY",
  "PGSSLMODE",
  "PGSSLROOTCERT",
  "PGUSER",
  "PGCONNECT_TIMEOUT",
  "PGTARGETSESSIONATTRS",
  "PGCHANNELBINDING",
  "PGGSSENCMODE",
  "PGSSLMINPROTOCOLVERSION",
  "PGFUTURE_CONNECTION_AUTHORITY",
]);
const packageScripts = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).scripts;

test("local database authority derives fixed least-privilege role URLs", () => {
  const authority = localDatabaseAuthority({
    migrationUrl: "postgres://owner:owner-secret@127.0.0.1:5544/scratch?sslmode=disable",
    env: {
      FMARCH_DATABASE_APPLICATION_PASSWORD: "application:/?#[]@ secret",
      FMARCH_DATABASE_KEY_ADMIN_PASSWORD: "key-admin:/?#[]@ secret",
    },
  });

  assert.equal(authority.ownerUrl, authority.migrationUrl);
  assert.equal(new URL(authority.applicationUrl).username, localDatabaseRoleNames.application);
  assert.equal(new URL(authority.applicationUrl).password, "application%3A%2F%3F%23%5B%5D%40%20secret");
  assert.equal(new URL(authority.keyAdminUrl).username, localDatabaseRoleNames.keyAdmin);
  assert.equal(new URL(authority.keyAdminUrl).password, "key-admin%3A%2F%3F%23%5B%5D%40%20secret");
  assert.equal(new URL(authority.applicationUrl).pathname, "/scratch");
  assert.equal(new URL(authority.applicationUrl).search, "?sslmode=disable");

  const normalizedLoopback = localDatabaseAuthority({
    migrationUrl: "postgres://owner:owner-secret@127.0.0.1:5544/scratch",
    env: {
      FMARCH_DATABASE_APPLICATION_PASSWORD: "application-password",
      FMARCH_DATABASE_KEY_ADMIN_PASSWORD: "key-admin-password",
    },
  });
  assert.equal(new URL(normalizedLoopback.migrationUrl).search, "?sslmode=disable");
});

test("application child environment carries no migration or key-admin authority", () => {
  const env = applicationDatabaseEnvironment({
    applicationUrl: "postgres://fmarch_application:application@localhost/fmarch",
    env: contaminatedEnvironment(),
  });

  assert.equal(env.DATABASE_URL, "postgres://fmarch_application:application@localhost/fmarch");
  assert.equal(env.KEEP, "yes");
  assert.equal(env.DATABASE_MIGRATION_URL, undefined);
  assert.equal(env.DATABASE_RESTORE_MIGRATION_URL, undefined);
  assert.equal(env.DATABASE_KEY_ADMIN_URL, undefined);
  assert.equal(env.FMARCH_DATABASE_APPLICATION_PASSWORD, undefined);
  assert.equal(env.FMARCH_DATABASE_KEY_ADMIN_PASSWORD, undefined);
  assert.equal(env.FMARCH_PROFILE_HANDLE_INDEX_KEY, undefined);
  assert.equal(env.FMARCH_PROFILE_HANDLE_INDEX_KID, undefined);
  assert.equal(env.FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY, undefined);
  assertPostgresOwnerEnvironmentRemoved(env);
});

test("server child environment owns only active profile handle-index custody", () => {
  const defaults = serverRuntimeEnvironment({
    applicationUrl: "postgres://fmarch_application:application@localhost/fmarch",
    env: { KEEP: "yes" },
  });
  assert.equal(defaults.FMARCH_PROFILE_HANDLE_INDEX_KEY, "fmarch-local-profile-index-key-material-v1");
  assert.equal(defaults.FMARCH_PROFILE_HANDLE_INDEX_KID, "local-profile-index-v1");
  assert.equal(defaults.FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY, undefined);

  const explicit = serverRuntimeEnvironment({
    applicationUrl: "postgres://fmarch_application:application@localhost/fmarch",
    env: {
      ...contaminatedEnvironment(),
      FMARCH_PROFILE_HANDLE_INDEX_KEY: "proof-profile-index-key-material-00000001",
      FMARCH_PROFILE_HANDLE_INDEX_KID: "proof-profile-index-v1",
      FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY: "retired-profile-index-key-material-0000002",
    },
  });
  assert.equal(explicit.FMARCH_PROFILE_HANDLE_INDEX_KEY, "proof-profile-index-key-material-00000001");
  assert.equal(explicit.FMARCH_PROFILE_HANDLE_INDEX_KID, "proof-profile-index-v1");
  assert.equal(explicit.FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY, undefined);
  assert.equal(explicit.DATABASE_RESTORE_MIGRATION_URL, undefined);
});

test("key-admin child environment carries neither runtime nor migration authority", () => {
  const env = keyAdminDatabaseEnvironment({
    keyAdminUrl: "postgres://fmarch_key_admin:key-admin@localhost/fmarch",
    env: contaminatedEnvironment(),
  });

  assert.equal(env.DATABASE_KEY_ADMIN_URL, "postgres://fmarch_key_admin:key-admin@localhost/fmarch");
  assert.equal(env.KEEP, "yes");
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.DATABASE_MIGRATION_URL, undefined);
  assert.equal(env.DATABASE_RESTORE_MIGRATION_URL, undefined);
  assert.equal(env.FMARCH_DATABASE_APPLICATION_PASSWORD, undefined);
  assert.equal(env.FMARCH_DATABASE_KEY_ADMIN_PASSWORD, undefined);
  assert.equal(env.FMARCH_PROFILE_HANDLE_INDEX_KEY, undefined);
  assert.equal(env.FMARCH_PROFILE_HANDLE_INDEX_KID, undefined);
  assert.equal(env.FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY, undefined);
  assertPostgresOwnerEnvironmentRemoved(env);
});

test("migrator child environment carries no runtime, key-admin, or ambient libpq authority", () => {
  const env = migrationDatabaseEnvironment({
    migrationUrl: "postgres://schema_owner:owner@localhost/fmarch",
    env: contaminatedEnvironment(),
  });

  assert.equal(
    env.DATABASE_MIGRATION_URL,
    "postgres://schema_owner:owner@localhost/fmarch?sslmode=disable",
  );
  assert.equal(env.FMARCH_DATABASE_APPLICATION_PASSWORD, "application-password");
  assert.equal(env.FMARCH_DATABASE_KEY_ADMIN_PASSWORD, "key-admin-password");
  assert.equal(env.KEEP, "yes");
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.DATABASE_KEY_ADMIN_URL, undefined);
  assert.equal(env.DATABASE_RESTORE_MIGRATION_URL, undefined);
  assert.equal(env.FMARCH_PROFILE_HANDLE_INDEX_KEY, undefined);
  assert.equal(env.FMARCH_PROFILE_HANDLE_INDEX_KID, undefined);
  assert.equal(env.FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY, undefined);
  assertPostgresOwnerEnvironmentRemoved(env);
});

test("every shared migrator launch registers with the host-wide heavyweight lane", () => {
  const invocation = fmarchMigrationInvocation({ cwd: "/workspace/fmarch" });

  assert.equal(invocation.command, "python3");
  assert.deepEqual(invocation.args, [
    "/workspace/fmarch/scripts/with-heavy-build-lock.py",
    "--",
    "cargo",
    "run",
    "--quiet",
    "-p",
    "server",
    "--bin",
    "fmarch-migrate",
  ]);
});

test("every local migrator caller gives each child only its required authority", () => {
  for (const filename of migrationHarnessCallers) {
    const source = readFileSync(new URL(filename, import.meta.url), "utf8");
    assert.match(source, /runFmarchMigrations\(\{/u, `${filename} must run the migrator`);
    assert.match(
      source,
      filename === "mash_scale_acceptance.mjs"
        ? /applicationDatabaseEnvironment\(\{/u
        : /serverRuntimeEnvironment\(\{/u,
      `${filename} must construct the right least-authority child environment`,
    );
    assert.doesNotMatch(
      source,
      /runFmarchMigrations\(\{[^}]*databaseUrl/u,
      `${filename} must pass an explicit migrationUrl`,
    );
    assert.doesNotMatch(
      source,
      /env:\s*\{\s*\.\.\.process\.env,\s*DATABASE_URL:/u,
      `${filename} must not pass ambient owner authority to a server`,
    );
  }
});

test("package harnesses pass schema-owner input only as DATABASE_MIGRATION_URL", () => {
  const commandsByCaller = new Map(
    migrationHarnessCallers.map((filename) => [filename, []]),
  );
  for (const [script, command] of Object.entries(packageScripts)) {
    for (const filename of migrationHarnessCallers) {
      if (command.includes(`tools/${filename}`)) {
        commandsByCaller.get(filename).push([script, command]);
      }
    }
  }

  for (const [filename, commands] of commandsByCaller) {
    assert.ok(commands.length > 0, `${filename} must have a package harness`);
    for (const [script, command] of commands) {
      assert.match(
        command,
        /(?:^|\s)DATABASE_MIGRATION_URL=/u,
        `${script} must provide the owner connection as DATABASE_MIGRATION_URL`,
      );
      assert.doesNotMatch(
        command,
        /(?:^|\s)DATABASE_URL=/u,
        `${script} must not provide owner authority as DATABASE_URL`,
      );
    }
  }

  assert.match(
    packageScripts["test:capacity-overload:local"],
    /DATABASE_MIGRATION_URL=.*\/fmarch_capacity_overload/u,
  );
  assert.doesNotMatch(
    packageScripts["test:capacity-overload:local"],
    /(?:^|\s)DATABASE_URL=/u,
  );
});

function assertPostgresOwnerEnvironmentRemoved(env) {
  for (const key of Object.keys(env)) {
    assert.ok(!key.startsWith("PG"), `${key} must not enter a least-privilege child`);
  }
}

function contaminatedEnvironment() {
  return {
    KEEP: "yes",
    DATABASE_URL: "postgres://owner/legacy-runtime",
    DATABASE_MIGRATION_URL: "postgres://owner/migration",
    DATABASE_RESTORE_MIGRATION_URL: "postgres://owner/restore-migration",
    DATABASE_KEY_ADMIN_URL: "postgres://key-admin/admin",
    FMARCH_DATABASE_APPLICATION_PASSWORD: "application-password",
    FMARCH_DATABASE_KEY_ADMIN_PASSWORD: "key-admin-password",
    FMARCH_PROFILE_HANDLE_INDEX_KEY: "ambient-profile-index-key-material-0000001",
    FMARCH_PROFILE_HANDLE_INDEX_KID: "ambient-profile-index-v1",
    FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY: "ambient-rotation-secret-material-00000002",
    ...Object.fromEntries(
      ambientPostgresVariables.map((key) => [key, `attacker-controlled-${key}`]),
    ),
  };
}
