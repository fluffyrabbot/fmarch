import { spawn } from "node:child_process";

export const localDatabaseRoleNames = Object.freeze({
  application: "fmarch_application",
  keyAdmin: "fmarch_key_admin",
});

const defaultApplicationPassword = "fmarch-local-application-password";
const defaultKeyAdminPassword = "fmarch-local-key-admin-password";
const defaultProfileHandleIndexKey = "fmarch-local-profile-index-key-material-v1";
const defaultProfileHandleIndexKid = "local-profile-index-v1";
const authorityOnlyEnvironmentKeys = Object.freeze([
  "DATABASE_MIGRATION_URL",
  "DATABASE_RESTORE_MIGRATION_URL",
  "DATABASE_KEY_ADMIN_URL",
  "FMARCH_DATABASE_APPLICATION_PASSWORD",
  "FMARCH_DATABASE_KEY_ADMIN_PASSWORD",
  "FMARCH_PROFILE_HANDLE_INDEX_KEY",
  "FMARCH_PROFILE_HANDLE_INDEX_KID",
  "FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY",
]);

/**
 * Derive the three local database authority URLs from an owner/migration URL.
 * Password fallbacks are deterministic because these URLs are only for disposable
 * local proof databases; hosted environments must provide both password vars.
 */
export function localDatabaseAuthority({ migrationUrl, env = process.env }) {
  const ownerUrl = explicitLocalTransport(requiredDatabaseUrl(migrationUrl));
  const applicationPassword = requiredPassword(
    env.FMARCH_DATABASE_APPLICATION_PASSWORD ?? defaultApplicationPassword,
    "FMARCH_DATABASE_APPLICATION_PASSWORD",
  );
  const keyAdminPassword = requiredPassword(
    env.FMARCH_DATABASE_KEY_ADMIN_PASSWORD ?? defaultKeyAdminPassword,
    "FMARCH_DATABASE_KEY_ADMIN_PASSWORD",
  );

  return Object.freeze({
    ownerUrl,
    migrationUrl: ownerUrl,
    applicationUrl: roleUrl(ownerUrl, localDatabaseRoleNames.application, applicationPassword),
    keyAdminUrl: roleUrl(ownerUrl, localDatabaseRoleNames.keyAdmin, keyAdminPassword),
    roleNames: localDatabaseRoleNames,
  });
}

function explicitLocalTransport(databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    url.search === "" &&
    ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)
  ) {
    url.searchParams.set("sslmode", "disable");
  }
  return url.toString();
}

/** Build the environment for an API/server child with only application authority. */
export function applicationDatabaseEnvironment({ applicationUrl, env = process.env }) {
  const childEnv = withoutAuthorityOnlyEnvironment(env);
  childEnv.DATABASE_URL = requiredDatabaseUrl(applicationUrl);
  return childEnv;
}

/**
 * Build the complete least-authority environment for a local server process.
 * The active profile handle-index key belongs only to the running application;
 * migration and maintenance processes must never inherit it. A deterministic
 * local key keeps disposable proof harnesses hermetic while callers can still
 * supply explicit custody material for an intentional local rehearsal.
 */
export function serverRuntimeEnvironment({ applicationUrl, env = process.env }) {
  const childEnv = applicationDatabaseEnvironment({ applicationUrl, env });
  childEnv.FMARCH_PROFILE_HANDLE_INDEX_KEY =
    env.FMARCH_PROFILE_HANDLE_INDEX_KEY ?? defaultProfileHandleIndexKey;
  childEnv.FMARCH_PROFILE_HANDLE_INDEX_KID =
    env.FMARCH_PROFILE_HANDLE_INDEX_KID ?? defaultProfileHandleIndexKid;
  return childEnv;
}

/** Build the environment for fmarch-event-key-admin with only key-admin authority. */
export function keyAdminDatabaseEnvironment({ keyAdminUrl, env = process.env }) {
  const childEnv = withoutAuthorityOnlyEnvironment(env);
  delete childEnv.DATABASE_URL;
  childEnv.DATABASE_KEY_ADMIN_URL = requiredDatabaseUrl(keyAdminUrl);
  return childEnv;
}

/** Build the environment for fmarch-migrate with only schema-owner authority. */
export function migrationDatabaseEnvironment({ migrationUrl, env = process.env }) {
  const authority = localDatabaseAuthority({ migrationUrl, env });
  return migrationDatabaseEnvironmentForAuthority(authority, env);
}

/** Run the explicit schema owner before starting any local API process. */
export async function runFmarchMigrations({ cwd, migrationUrl, env = process.env }) {
  const authority = localDatabaseAuthority({ migrationUrl, env });
  const migrationEnv = migrationDatabaseEnvironmentForAuthority(authority, env);

  await new Promise((resolve, reject) => {
    const child = spawn(
      "cargo",
      ["run", "--quiet", "-p", "server", "--bin", "fmarch-migrate"],
      {
        cwd,
        env: migrationEnv,
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`fmarch-migrate exited code=${code} signal=${signal ?? "none"}`));
    });
  });
  return authority;
}

function migrationDatabaseEnvironmentForAuthority(authority, env) {
  const migrationEnv = withoutAuthorityOnlyEnvironment(env);
  delete migrationEnv.DATABASE_URL;
  migrationEnv.DATABASE_MIGRATION_URL = authority.migrationUrl;
  migrationEnv.FMARCH_DATABASE_APPLICATION_PASSWORD =
    env.FMARCH_DATABASE_APPLICATION_PASSWORD ?? defaultApplicationPassword;
  migrationEnv.FMARCH_DATABASE_KEY_ADMIN_PASSWORD =
    env.FMARCH_DATABASE_KEY_ADMIN_PASSWORD ?? defaultKeyAdminPassword;
  return migrationEnv;
}

function withoutAuthorityOnlyEnvironment(env) {
  const childEnv = { ...env };
  for (const key of authorityOnlyEnvironmentKeys) {
    delete childEnv[key];
  }
  // libpq's environment surface evolves. Strip the entire PG* namespace so a
  // future connection, TLS, GSS, or startup-option variable cannot silently
  // become a second authority alongside the explicit URL.
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith("PG")) delete childEnv[key];
  }
  return childEnv;
}

function requiredDatabaseUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("an owner/migration database URL is required by the local database harness");
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`database URL must use postgres or postgresql, received ${parsed.protocol}`);
  }
  return parsed.toString();
}

function requiredPassword(value, name) {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${name} must not be empty`);
  }
  return value;
}

function roleUrl(databaseUrl, username, password) {
  const url = new URL(databaseUrl);
  url.username = username;
  url.password = password;
  return url.toString();
}
