import assert from "node:assert/strict";

import { CANONICAL_RELEASE_TOPOLOGY } from "./release_coordinator_contract.mjs";

const DEFAULTS = Object.freeze({
  projectId: CANONICAL_RELEASE_TOPOLOGY.project_id,
  stagingEnvironmentId: CANONICAL_RELEASE_TOPOLOGY.environments.staging.id,
  productionEnvironmentId: CANONICAL_RELEASE_TOPOLOGY.environments.production.id,
  stagingApiUrl: CANONICAL_RELEASE_TOPOLOGY.environments.staging.origins.api,
  stagingFrontendUrl: CANONICAL_RELEASE_TOPOLOGY.environments.staging.origins.frontend,
  productionApiUrl: CANONICAL_RELEASE_TOPOLOGY.environments.production.origins.api,
  productionFrontendUrl: CANONICAL_RELEASE_TOPOLOGY.environments.production.origins.frontend,
  internalApiUrl: CANONICAL_RELEASE_TOPOLOGY.environments.staging.origins.internal_api,
});

export function validateEnvironmentDatabaseAuthorityVariables({
  environment,
  api,
  migrator,
  frontend,
}) {
  for (const [process, variables] of [
    ["API", api],
    ["migrator", migrator],
    ["frontend", frontend],
  ]) {
    for (const key of Object.keys(variables)) {
      assertSecretRelation(
        !key.startsWith("PG"),
        `${environment} ${process} must not receive ambient ${key}; the process-specific URL is authoritative`,
      );
    }
  }

  for (const key of [
    "DATABASE_URL",
    "DATABASE_MIGRATION_URL",
    "DATABASE_KEY_ADMIN_URL",
    "FMARCH_DATABASE_APPLICATION_PASSWORD",
    "FMARCH_DATABASE_KEY_ADMIN_PASSWORD",
    "FMARCH_PROFILE_HANDLE_INDEX_KEY",
    "FMARCH_PROFILE_HANDLE_INDEX_KID",
  ]) {
    assertSecretRelation(
      frontend[key] === undefined,
      `${environment} frontend must not receive ${key}`,
    );
  }

  assert.ok(api.DATABASE_URL, `${environment} API is missing DATABASE_URL`);
  for (const key of [
    "DATABASE_MIGRATION_URL",
    "DATABASE_KEY_ADMIN_URL",
    "FMARCH_DATABASE_APPLICATION_PASSWORD",
    "FMARCH_DATABASE_KEY_ADMIN_PASSWORD",
  ]) {
    assertSecretRelation(
      api[key] === undefined,
      `${environment} API must not receive ${key}`,
    );
  }

  for (const key of [
    "DATABASE_MIGRATION_URL",
    "FMARCH_DATABASE_APPLICATION_PASSWORD",
    "FMARCH_DATABASE_KEY_ADMIN_PASSWORD",
    "FMARCH_DATABASE_AUTHORITY_REVISION",
  ]) {
    assert.ok(migrator[key], `${environment} migrator is missing ${key}`);
  }
  for (const key of [
    "DATABASE_URL",
    "DATABASE_KEY_ADMIN_URL",
    "FMARCH_AUTH_SOURCE_SIGNING_KEY",
    "FMARCH_EVENT_WRAP_KEY",
    "FMARCH_EVENT_WRAP_KEYS",
    "FMARCH_EVENT_ARCHIVE_KEY",
    "FMARCH_EVENT_ARCHIVE_KEYS",
    "FMARCH_PROFILE_HANDLE_INDEX_KEY",
    "FMARCH_PROFILE_HANDLE_INDEX_KID",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "FMARCH_SUBJECT_AUTHORITY_ACCESS_KEY_ID",
    "FMARCH_SUBJECT_AUTHORITY_SECRET_ACCESS_KEY",
    "FMARCH_SUBJECT_AUTHORITY_WRAP_KEY",
    "FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY",
    "WORKOS_API_KEY",
    "WORKOS_COOKIE_PASSWORD",
    "FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN",
  ]) {
    assertSecretRelation(
      migrator[key] === undefined,
      `${environment} migrator must not receive ${key}`,
    );
  }

  const application = postgresCredential(api.DATABASE_URL, `${environment} API DATABASE_URL`);
  const migration = postgresCredential(
    migrator.DATABASE_MIGRATION_URL,
    `${environment} migrator DATABASE_MIGRATION_URL`,
  );
  assertSecretRelation(
    application.username === "fmarch_application",
    `${environment} API DATABASE_URL must use fmarch_application`,
  );
  assertSecretRelation(
    application.password === migrator.FMARCH_DATABASE_APPLICATION_PASSWORD,
    `${environment} API DATABASE_URL must derive from the migrator-held application password`,
  );
  assertSecretRelation(
    migration.username !== "fmarch_application" && migration.username !== "fmarch_key_admin",
    `${environment} migrator DATABASE_MIGRATION_URL must use the schema owner`,
  );
  assertSecretRelation(
    migration.password !== migrator.FMARCH_DATABASE_APPLICATION_PASSWORD,
    `${environment} schema-owner and application roles must use distinct passwords`,
  );
  assertSecretRelation(
    migration.password !== migrator.FMARCH_DATABASE_KEY_ADMIN_PASSWORD,
    `${environment} schema-owner and key-admin roles must use distinct passwords`,
  );
  assertSecretRelation(
    api.DATABASE_URL !== migrator.DATABASE_MIGRATION_URL,
    `${environment} application and migration URLs must be distinct`,
  );
  assertSecretRelation(
    application.databaseTarget === migration.databaseTarget,
    `${environment} application and migration URLs must target the same database`,
  );
  assertSecretRelation(
    application.tlsMode === migration.tlsMode,
    `${environment} application and migration URLs must use the same TLS mode`,
  );
  assertSecretRelation(
    migrator.FMARCH_DATABASE_APPLICATION_PASSWORD !==
      migrator.FMARCH_DATABASE_KEY_ADMIN_PASSWORD,
    `${environment} application and key-admin roles must use distinct passwords`,
  );
  for (const [label, value] of [
    ["application", migrator.FMARCH_DATABASE_APPLICATION_PASSWORD],
    ["key-admin", migrator.FMARCH_DATABASE_KEY_ADMIN_PASSWORD],
  ]) {
    assertSecretRelation(
      typeof value === "string" && value.length >= 32 && !value.includes("replace_me"),
      `${environment} ${label} database password must be a non-placeholder value of at least 32 characters`,
    );
  }
}

export function validateDatabaseAuthorityVariables({
  stagingApi,
  stagingMigrator,
  stagingFrontend,
  productionApi,
  productionMigrator,
  productionFrontend,
}) {
  validateEnvironmentDatabaseAuthorityVariables({
    environment: "staging",
    api: stagingApi,
    migrator: stagingMigrator,
    frontend: stagingFrontend,
  });
  validateEnvironmentDatabaseAuthorityVariables({
    environment: "production",
    api: productionApi,
    migrator: productionMigrator,
    frontend: productionFrontend,
  });
  validateCrossEnvironmentDatabaseAuthorityVariables({
    stagingApi,
    stagingMigrator,
    productionApi,
    productionMigrator,
  });
}

function validateCrossEnvironmentDatabaseAuthorityVariables({
  stagingApi,
  stagingMigrator,
  productionApi,
  productionMigrator,
}) {
  for (const [label, staging, production] of [
    ["application database URL", stagingApi.DATABASE_URL, productionApi.DATABASE_URL],
    [
      "migration database URL",
      stagingMigrator.DATABASE_MIGRATION_URL,
      productionMigrator.DATABASE_MIGRATION_URL,
    ],
    [
      "application database password",
      stagingMigrator.FMARCH_DATABASE_APPLICATION_PASSWORD,
      productionMigrator.FMARCH_DATABASE_APPLICATION_PASSWORD,
    ],
    [
      "key-admin database password",
      stagingMigrator.FMARCH_DATABASE_KEY_ADMIN_PASSWORD,
      productionMigrator.FMARCH_DATABASE_KEY_ADMIN_PASSWORD,
    ],
    [
      "database authority revision",
      stagingMigrator.FMARCH_DATABASE_AUTHORITY_REVISION,
      productionMigrator.FMARCH_DATABASE_AUTHORITY_REVISION,
    ],
  ]) {
    assertSecretRelation(
      staging !== production,
      `staging and production must not share ${label}`,
    );
  }

  const stagingServer = postgresCredential(
    stagingMigrator.DATABASE_MIGRATION_URL,
    "staging migrator DATABASE_MIGRATION_URL",
  ).serverEndpoint;
  const productionServer = postgresCredential(
    productionMigrator.DATABASE_MIGRATION_URL,
    "production migrator DATABASE_MIGRATION_URL",
  ).serverEndpoint;
  assertSecretRelation(
    stagingServer !== productionServer,
    "staging and production must use separate PostgreSQL server endpoints because fixed database roles are cluster-global",
  );
}

function postgresCredential(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    assert.fail(`${label} must be a valid PostgreSQL URL`);
  }
  assertSecretRelation(
    url.protocol === "postgres:" || url.protocol === "postgresql:",
    `${label} must use PostgreSQL`,
  );
  assertSecretRelation(url.hash === "", `${label} must not contain a URL fragment`);
  const queryNames = [...new Set(url.searchParams.keys())];
  assertSecretRelation(
    queryNames.every((name) => name === "sslmode") &&
      url.searchParams.getAll("sslmode").length <= 1,
    `${label} may contain only one sslmode query option`,
  );
  assertSecretRelation(
    url.searchParams.getAll("sslmode").length === 1,
    `${label} must set exactly one explicit sslmode`,
  );
  const tlsMode = url.searchParams.get("sslmode");
  assertSecretRelation(
    ["require", "verify-ca", "verify-full"].includes(tlsMode),
    `${label} sslmode must be require, verify-ca, or verify-full`,
  );
  let password;
  let database;
  try {
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname);
  } catch {
    assert.fail(`${label} credentials and database name must be URI encoded`);
  }
  assertSecretRelation(
    url.hostname.length > 0 &&
      url.username.length > 0 &&
      password.length > 0 &&
      /^\/[^/]+$/.test(database),
    `${label} needs credentials`,
  );
  const serverEndpoint = normalizedPostgresServerEndpoint(url, label);
  return {
    username: url.username,
    password,
    serverEndpoint,
    databaseTarget: `${serverEndpoint}${database}`,
    tlsMode,
  };
}

function normalizedPostgresServerEndpoint(url, label) {
  let hostname;
  try {
    // PostgreSQL is not a WHATWG "special" scheme, so its URL parser preserves
    // DNS case and non-canonical IP spelling. Canonicalize syntactically through
    // a special-scheme parser without resolving DNS or conflating distinct names.
    hostname = new URL(`http://${url.hostname}`).hostname.replace(/\.$/u, "");
  } catch {
    assert.fail(`${label} has an invalid hostname`);
  }
  assertSecretRelation(hostname.length > 0, `${label} has an invalid hostname`);
  return `${hostname}:${url.port || "5432"}`;
}

export function validateHostedVariables({
  stagingApi,
  stagingMigrator,
  stagingFrontend,
  productionApi,
  productionMigrator,
  productionFrontend,
}) {
  validateHostedEnvironmentVariables({
    environment: "staging",
    environmentId: DEFAULTS.stagingEnvironmentId,
    apiUrl: DEFAULTS.stagingApiUrl,
    frontendUrl: DEFAULTS.stagingFrontendUrl,
    api: stagingApi,
    migrator: stagingMigrator,
    frontend: stagingFrontend,
  });
  validateHostedEnvironmentVariables({
    environment: "production",
    environmentId: DEFAULTS.productionEnvironmentId,
    apiUrl: DEFAULTS.productionApiUrl,
    frontendUrl: DEFAULTS.productionFrontendUrl,
    api: productionApi,
    migrator: productionMigrator,
    frontend: productionFrontend,
  });
  validateCrossEnvironmentDatabaseAuthorityVariables({
    stagingApi,
    stagingMigrator,
    productionApi,
    productionMigrator,
  });
  assertSecretRelation(
    productionApi.FMARCH_AUTH_SOURCE_SIGNING_KEY !==
      stagingApi.FMARCH_AUTH_SOURCE_SIGNING_KEY,
    "production and staging must not share the auth-source signing key",
  );
  assertSecretRelation(
    productionApi.FMARCH_EVENT_WRAP_KEY !== stagingApi.FMARCH_EVENT_WRAP_KEY,
    "production and staging must not share the event wrapping key",
  );
  assertSecretRelation(
    productionApi.FMARCH_EVENT_ARCHIVE_KEY !== stagingApi.FMARCH_EVENT_ARCHIVE_KEY,
    "production and staging must not share the event archive key",
  );
  assertSecretRelation(
    productionApi.FMARCH_PROFILE_HANDLE_INDEX_KEY !== stagingApi.FMARCH_PROFILE_HANDLE_INDEX_KEY,
    "production and staging must not share the profile-handle index key",
  );
  assertSecretRelation(
    productionApi.FMARCH_SUBJECT_KEY_AUTHORITY_REVISION !==
      stagingApi.FMARCH_SUBJECT_KEY_AUTHORITY_REVISION,
    "production and staging must not share the subject-key authority revision",
  );
  assertSecretRelation(
    productionApi.FMARCH_SUBJECT_AUTHORITY_ID !== stagingApi.FMARCH_SUBJECT_AUTHORITY_ID &&
      productionApi.FMARCH_SUBJECT_AUTHORITY_BUCKET !==
        stagingApi.FMARCH_SUBJECT_AUTHORITY_BUCKET &&
      productionApi.FMARCH_SUBJECT_AUTHORITY_ACCESS_KEY_ID !==
        stagingApi.FMARCH_SUBJECT_AUTHORITY_ACCESS_KEY_ID &&
      productionApi.FMARCH_SUBJECT_AUTHORITY_SECRET_ACCESS_KEY !==
        stagingApi.FMARCH_SUBJECT_AUTHORITY_SECRET_ACCESS_KEY &&
      productionApi.FMARCH_SUBJECT_AUTHORITY_WRAP_KEY !==
        stagingApi.FMARCH_SUBJECT_AUTHORITY_WRAP_KEY &&
      productionApi.FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY !==
        stagingApi.FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY,
    "production and staging must use isolated subject authorities",
  );
  assertSecretRelation(
    productionApi.AWS_ACCESS_KEY_ID !== stagingApi.AWS_ACCESS_KEY_ID &&
      productionApi.AWS_SECRET_ACCESS_KEY !== stagingApi.AWS_SECRET_ACCESS_KEY &&
      productionApi.AWS_S3_BUCKET_NAME !== stagingApi.AWS_S3_BUCKET_NAME,
    "production and staging must use isolated object storage",
  );
  for (const [label, left, right] of [
    ["WorkOS client", productionApi.WORKOS_CLIENT_ID, stagingApi.WORKOS_CLIENT_ID],
    ["WorkOS API key", productionFrontend.WORKOS_API_KEY, stagingFrontend.WORKOS_API_KEY],
    [
      "WorkOS cookie password",
      productionFrontend.WORKOS_COOKIE_PASSWORD,
      stagingFrontend.WORKOS_COOKIE_PASSWORD,
    ],
  ]) {
    assertSecretRelation(left !== right, `production and staging must not share the ${label}`);
  }

  for (const [label, production, staging] of [
    [
      "auth-source signing KID",
      productionApi.FMARCH_AUTH_SOURCE_SIGNING_KID,
      stagingApi.FMARCH_AUTH_SOURCE_SIGNING_KID,
    ],
    [
      "event wrapping KID",
      productionApi.FMARCH_EVENT_WRAP_KID,
      stagingApi.FMARCH_EVENT_WRAP_KID,
    ],
    [
      "event archive KID",
      productionApi.FMARCH_EVENT_ARCHIVE_KID,
      stagingApi.FMARCH_EVENT_ARCHIVE_KID,
    ],
    [
      "profile-handle index KID",
      productionApi.FMARCH_PROFILE_HANDLE_INDEX_KID,
      stagingApi.FMARCH_PROFILE_HANDLE_INDEX_KID,
    ],
    [
      "object-storage credential KID",
      productionApi.FMARCH_OBJECT_STORAGE_CREDENTIAL_KID,
      stagingApi.FMARCH_OBJECT_STORAGE_CREDENTIAL_KID,
    ],
    [
      "WorkOS credential KID",
      productionApi.FMARCH_WORKOS_CREDENTIAL_KID,
      stagingApi.FMARCH_WORKOS_CREDENTIAL_KID,
    ],
  ]) {
    assertSecretRelation(production !== staging, `production and staging must not share ${label}`);
  }
}

function validateHostedEnvironmentVariables({
  environment,
  environmentId,
  apiUrl,
  frontendUrl,
  api,
  migrator,
  frontend,
}) {
  validateEnvironmentDatabaseAuthorityVariables({ environment, api, migrator, frontend });
  for (const [process, variables] of [
    ["API", api],
    ["migrator", migrator],
  ]) {
    assert.equal(
      variables.FMARCH_DATABASE_PROJECT_ID,
      DEFAULTS.projectId,
      `${environment} ${process} database project identity drifted`,
    );
    assert.equal(
      variables.FMARCH_DATABASE_ENVIRONMENT_ID,
      environmentId,
      `${environment} ${process} database environment UUID drifted`,
    );
    assert.equal(
      variables.FMARCH_DATABASE_ENVIRONMENT,
      environment,
      `${environment} ${process} database environment identity drifted`,
    );
  }
  for (const [name, variables, required] of [
    [
      `${environment} API`,
      api,
      [
        "DATABASE_URL",
        "FMARCH_AUTH_SOURCE_SIGNING_KEY",
        "FMARCH_AUTH_SOURCE_SIGNING_KID",
        "FMARCH_EVENT_WRAP_KEY",
        "FMARCH_EVENT_WRAP_KID",
        "FMARCH_EVENT_ARCHIVE_KEY",
        "FMARCH_EVENT_ARCHIVE_KID",
        "FMARCH_PROFILE_HANDLE_INDEX_KEY",
        "FMARCH_PROFILE_HANDLE_INDEX_KID",
        "FMARCH_OBJECT_STORAGE_CREDENTIAL_KID",
        "FMARCH_SUBJECT_AUTHORITY_ENDPOINT",
        "FMARCH_SUBJECT_AUTHORITY_REGION",
        "FMARCH_SUBJECT_AUTHORITY_BUCKET",
        "FMARCH_SUBJECT_AUTHORITY_ACCESS_KEY_ID",
        "FMARCH_SUBJECT_AUTHORITY_SECRET_ACCESS_KEY",
        "FMARCH_SUBJECT_AUTHORITY_ID",
        "FMARCH_SUBJECT_AUTHORITY_WRAP_KID",
        "FMARCH_SUBJECT_AUTHORITY_WRAP_KEY",
        "FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID",
        "FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY",
        "FMARCH_SUBJECT_KEY_AUTHORITY_REVISION",
        "FMARCH_WORKOS_CREDENTIAL_KID",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_S3_BUCKET_NAME",
        "FMARCH_MEDIA_READ_MAX_IN_FLIGHT",
        "FMARCH_MEDIA_READ_MAX_IN_FLIGHT_BYTES",
        "FMARCH_CLASSIC_AUTH",
        "WORKOS_CLIENT_ID",
        "WORKOS_ISSUER",
        "WORKOS_JWKS_URL",
      ],
    ],
    [
      `${environment} frontend`,
      frontend,
      [
        "FMARCH_API_BASE_URL",
        "FMARCH_API_INTERNAL_URL",
        "FMARCH_AUTH_SOURCE_SIGNING_KEY",
        "FMARCH_AUTH_SOURCE_SIGNING_KID",
        "FMARCH_WORKOS_CREDENTIAL_KID",
        "ORIGIN",
        "WORKOS_API_KEY",
        "WORKOS_CLIENT_ID",
        "WORKOS_COOKIE_PASSWORD",
        "WORKOS_REDIRECT_URI",
      ],
    ],
  ]) {
    for (const key of required) assert.ok(variables[key], `${name} is missing ${key}`);
    assert.equal(variables.FMARCH_DEV_AUTH, undefined, `${name} must not enable FMARCH_DEV_AUTH`);
    assert.equal(
      variables.FMARCH_FRONTEND_FIXTURE_SESSION,
      undefined,
      `${name} must not enable fixture sessions`,
    );
  }

  validateHostedIdentityDelivery(`${environment} API`, api);
  assert.equal(
    frontend.FMARCH_API_BASE_URL,
    apiUrl,
    `${environment} frontend must use the canonical public API URL`,
  );
  assert.equal(
    frontend.FMARCH_API_INTERNAL_URL,
    DEFAULTS.internalApiUrl,
    `${environment} frontend must use the canonical private API URL`,
  );
  assert.equal(frontend.ORIGIN, frontendUrl, `${environment} frontend must use the canonical origin`);
  assert.equal(
    frontend.WORKOS_REDIRECT_URI,
    `${frontendUrl}/auth/callback`,
    `${environment} frontend must use the canonical WorkOS callback`,
  );
  assertSecretRelation(
    api.WORKOS_CLIENT_ID === frontend.WORKOS_CLIENT_ID,
    `${environment} API and frontend must use the same WorkOS client`,
  );
  assertSecretRelation(
    api.FMARCH_AUTH_SOURCE_SIGNING_KEY === frontend.FMARCH_AUTH_SOURCE_SIGNING_KEY,
    `${environment} API and frontend must share the auth-source signing key`,
  );
  assertSecretRelation(
    api.FMARCH_AUTH_SOURCE_SIGNING_KID === frontend.FMARCH_AUTH_SOURCE_SIGNING_KID,
    `${environment} auth-source KID must match across API and frontend`,
  );
  assertSecretRelation(
    api.FMARCH_WORKOS_CREDENTIAL_KID === frontend.FMARCH_WORKOS_CREDENTIAL_KID,
    `${environment} WorkOS KID must match across API and frontend`,
  );
  assertSecretRelation(
    api.FMARCH_EVENT_WRAP_KEY !== api.FMARCH_EVENT_ARCHIVE_KEY,
    `${environment} event wrapping and archive keys must be separate`,
  );
  assertSecretRelation(
    api.FMARCH_PROFILE_HANDLE_INDEX_KEY !== api.FMARCH_EVENT_WRAP_KEY &&
      api.FMARCH_PROFILE_HANDLE_INDEX_KEY !== api.FMARCH_EVENT_ARCHIVE_KEY,
    `${environment} profile-handle index key must be distinct from event keys`,
  );
  assertSecretRelation(
    api.FMARCH_SUBJECT_AUTHORITY_BUCKET !== api.AWS_S3_BUCKET_NAME,
    `${environment} subject authority must not reuse its media bucket`,
  );
  assertSecretRelation(
    api.FMARCH_SUBJECT_AUTHORITY_WRAP_KID !== api.FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID,
    `${environment} subject wrapping and journal KIDs must be separate`,
  );
  for (const [purpose, value] of [
    ["wrapping", api.FMARCH_SUBJECT_AUTHORITY_WRAP_KEY],
    ["journal", api.FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY],
  ]) {
    assertSecretRelation(
      isCanonicalBase64Key(value),
      `${environment} subject ${purpose} key must be canonical padded base64 encoding exactly 32 bytes`,
    );
  }
  assertSecretRelation(
    !Buffer.from(api.FMARCH_SUBJECT_AUTHORITY_WRAP_KEY, "base64").equals(
      Buffer.from(api.FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY, "base64"),
    ),
    `${environment} subject wrapping and journal keys must decode to separate material`,
  );
  assertSecretRelation(
    typeof api.FMARCH_AUTH_SOURCE_SIGNING_KEY === "string" &&
      api.FMARCH_AUTH_SOURCE_SIGNING_KEY.length >= 32 &&
      !api.FMARCH_AUTH_SOURCE_SIGNING_KEY.includes("replace_me"),
    `${environment} auth-source signing key must be a non-placeholder value of at least 32 characters`,
  );
  assertSecretRelation(
    isStrongWorkosCookiePassword(frontend.WORKOS_COOKIE_PASSWORD),
    `${environment} WorkOS cookie password must be a non-placeholder value of at least 32 characters`,
  );
  assertSecretRelation(
    isStrongOpaqueSecret(api.FMARCH_PROFILE_HANDLE_INDEX_KEY),
    `${environment} profile-handle index key must be a non-placeholder value of at least 32 characters`,
  );
  for (const [purpose, value] of [
    ["event wrapping", api.FMARCH_EVENT_WRAP_KEY],
    ["event archive", api.FMARCH_EVENT_ARCHIVE_KEY],
  ]) {
    assertSecretRelation(
      isCanonicalBase64Key(value),
      `${environment} ${purpose} key must be canonical padded base64 encoding exactly 32 bytes`,
    );
  }
  return { api, migrator, frontend };
}

export function validateProductionHostedVariables({
  productionApi,
  productionMigrator,
  productionFrontend,
}) {
  validateHostedEnvironmentVariables({
    environment: "production",
    environmentId: DEFAULTS.productionEnvironmentId,
    apiUrl: DEFAULTS.productionApiUrl,
    frontendUrl: DEFAULTS.productionFrontendUrl,
    api: productionApi,
    migrator: productionMigrator,
    frontend: productionFrontend,
  });
  return { productionApi, productionMigrator, productionFrontend };
}

export async function loadCanonicalHostedVariables(
  config,
  { load } = {},
) {
  assert.equal(
    config.projectId,
    CANONICAL_RELEASE_TOPOLOGY.project_id,
    "hosted variable authority requires the canonical Railway project",
  );
  assert.equal(typeof load, "function", "hosted variable authority requires a loader");
  const stagingEnvironmentId = CANONICAL_RELEASE_TOPOLOGY.environments.staging.id;
  const productionEnvironmentId = CANONICAL_RELEASE_TOPOLOGY.environments.production.id;
  const { api, migrator, frontend } = CANONICAL_RELEASE_TOPOLOGY.services;
  const [
    stagingApi,
    stagingMigrator,
    stagingFrontend,
    productionApi,
    productionMigrator,
    productionFrontend,
  ] = await Promise.all([
    load(config, stagingEnvironmentId, api),
    load(config, stagingEnvironmentId, migrator),
    load(config, stagingEnvironmentId, frontend),
    load(config, productionEnvironmentId, api),
    load(config, productionEnvironmentId, migrator),
    load(config, productionEnvironmentId, frontend),
  ]);
  return {
    stagingApi,
    stagingMigrator,
    stagingFrontend,
    productionApi,
    productionMigrator,
    productionFrontend,
  };
}

export async function revalidateCanonicalHostedVariables(config, options = {}) {
  const hostedVariables = await loadCanonicalHostedVariables(config, options);
  validateHostedVariables(hostedVariables);
  return hostedVariables;
}

export async function loadCanonicalProductionHostedVariables(
  config,
  { load } = {},
) {
  assert.equal(
    config.projectId,
    CANONICAL_RELEASE_TOPOLOGY.project_id,
    "production hosted variable authority requires the canonical Railway project",
  );
  assert.equal(typeof load, "function", "production hosted variable authority requires a loader");
  const productionEnvironmentId = CANONICAL_RELEASE_TOPOLOGY.environments.production.id;
  const { api, migrator, frontend } = CANONICAL_RELEASE_TOPOLOGY.services;
  const [productionApi, productionMigrator, productionFrontend] = await Promise.all([
    load(config, productionEnvironmentId, api),
    load(config, productionEnvironmentId, migrator),
    load(config, productionEnvironmentId, frontend),
  ]);
  return { productionApi, productionMigrator, productionFrontend };
}

export async function revalidateCanonicalProductionHostedVariables(config, options = {}) {
  const hostedVariables = await loadCanonicalProductionHostedVariables(config, options);
  return validateProductionHostedVariables(hostedVariables);
}

function isStrongWorkosCookiePassword(value) {
  return isStrongOpaqueSecret(value) && !/cookie[\s_-]*password/iu.test(value);
}

function isStrongOpaqueSecret(value) {
  if (typeof value !== "string" || value.length < 32 || value !== value.trim()) {
    return false;
  }
  return !/(?:replace[\s_-]*me|change[\s_-]*me|placeholder|example|at[\s_-]*least[\s_-]*32|\$\{\{?[^}]+\}?\})/iu.test(
    value,
  );
}

function isCanonicalBase64Key(value) {
  if (typeof value !== "string") return false;
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.byteLength === 32 && decoded.toString("base64") === value;
  } catch {
    return false;
  }
}

function validateHostedIdentityDelivery(name, variables) {
  const mode = variables.FMARCH_CLASSIC_AUTH;
  assert.ok(
    mode === "0" || mode === "1",
    `${name} must set FMARCH_CLASSIC_AUTH explicitly to 0 or 1`,
  );
  const deliveryVariables = [
    "FMARCH_IDENTITY_DELIVERY_ENDPOINT",
    "FMARCH_IDENTITY_DELIVERY_PROVIDER_ID",
    "FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN",
  ];
  if (mode === "0") {
    for (const key of deliveryVariables) {
      assert.equal(
        variables[key],
        undefined,
        `${name} WorkOS-only mode must not retain ${key}`,
      );
    }
    return;
  }

  for (const key of deliveryVariables) {
    assert.ok(variables[key], `${name} classic mode is missing ${key}`);
  }
  let endpoint;
  try {
    endpoint = new URL(variables.FMARCH_IDENTITY_DELIVERY_ENDPOINT);
  } catch {
    assert.fail(`${name} classic delivery endpoint is not a valid URL`);
  }
  assert.equal(
    endpoint.protocol,
    "https:",
    `${name} classic delivery endpoint must use HTTPS`,
  );
}

function assertSecretRelation(condition, message) {
  // Boolean-only assertions prevent assertion diagnostics from echoing either
  // side of a secret comparison into terminal logs or retained artifacts.
  assert.ok(condition, message);
}
