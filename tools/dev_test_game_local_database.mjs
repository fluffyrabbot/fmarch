import {
  buildConfig,
  createDisposableDatabaseAtLocalEndpoint,
  databaseUrl,
  disposableDatabaseConfig,
  dropDisposableDatabase,
} from "./dev_postgres.mjs";

export function localProofDatabaseName(
  purpose,
  { pid = process.pid, timestamp = Date.now() } = {},
) {
  const normalizedPurpose = String(purpose)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .slice(0, 20);
  const suffix = `${normalizedPurpose || "local"}_${Number(pid).toString(36)}_${Number(timestamp).toString(36)}`;
  return `fmarch_proof_${suffix}`.slice(0, 61).replaceAll(/_+$/g, "");
}

export async function acquireLocalProofDatabase(
  purpose,
  env = process.env,
  options = {},
) {
  if (
    typeof env.DATABASE_MIGRATION_URL === "string" &&
    env.DATABASE_MIGRATION_URL !== ""
  ) {
    return externalDatabaseLease(env.DATABASE_MIGRATION_URL);
  }

  const baseConfig = buildConfig({}, env);
  const name = localProofDatabaseName(purpose, options);
  await createDisposableDatabaseAtLocalEndpoint(baseConfig, name);
  const disposableConfig = disposableDatabaseConfig(baseConfig, name);
  let released = false;

  return {
    url: databaseUrl(disposableConfig),
    database: name,
    owned: true,
    async release() {
      if (released) return;
      released = true;
      await dropDisposableDatabase(baseConfig, name);
    },
  };
}

function externalDatabaseLease(url) {
  return {
    url,
    database: null,
    owned: false,
    async release() {},
  };
}
