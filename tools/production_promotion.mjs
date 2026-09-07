import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { preflightWorkosOidc } from "./workos_oidc_preflight.mjs";
import { loadCompletionRegistry, validateRegistry } from "./completeness_scorecard.mjs";
import { defaultFleetPublicKeyPath, loadFleetReleaseProof } from "./fleet_release_proof.mjs";
import {
  CANONICAL_RELEASE_TOPOLOGY,
  assertFullCommit,
  assertFreshReleaseEvidence,
  assertFreshStagingReleaseReceipt,
  assertReleaseReceipt,
  validateDeploymentArtifact,
  validateHealth,
  validateProductionReleaseReadiness,
} from "./release_coordinator_contract.mjs";
import {
  CANONICAL_RELEASE_REMOTE_URL,
  PRODUCTION_PROMOTION_LOCK_REF,
  assertCanonicalReleaseRemote,
  assertProductionPromotionLease,
  canonicalReleaseFetchArguments,
  createProductionPromotionLockIntent,
  productionPointerPushArgumentsForAuthority,
  releaseGitEnvironment,
} from "./release_git_authority.mjs";

export { PRODUCTION_PROMOTION_LOCK_REF } from "./release_git_authority.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const callerSession = `fmarch-production-promotion-${process.pid}`;
const SUBPROCESS_TIMEOUT_MS = Object.freeze({
  git: 2 * 60 * 1_000,
  railway: 5 * 60 * 1_000,
  node: 60 * 60 * 1_000,
});
const stagingTopology = CANONICAL_RELEASE_TOPOLOGY.environments.staging;
const productionTopology = CANONICAL_RELEASE_TOPOLOGY.environments.production;
const DEFAULTS = Object.freeze({
  projectId: CANONICAL_RELEASE_TOPOLOGY.project_id,
  apiServiceId: CANONICAL_RELEASE_TOPOLOGY.services.api,
  migratorServiceId: CANONICAL_RELEASE_TOPOLOGY.services.migrator,
  frontendServiceId: CANONICAL_RELEASE_TOPOLOGY.services.frontend,
  stagingEnvironment: stagingTopology.name,
  stagingEnvironmentId: stagingTopology.id,
  productionEnvironment: productionTopology.name,
  productionEnvironmentId: productionTopology.id,
  stagingApiUrl: stagingTopology.origins.api,
  stagingFrontendUrl: stagingTopology.origins.frontend,
  productionApiUrl: productionTopology.origins.api,
  productionFrontendUrl: productionTopology.origins.frontend,
  internalApiUrl: stagingTopology.origins.internal_api,
});

const terminalDeploymentStates = new Set([
  "SUCCESS",
  "FAILED",
  "CRASHED",
  "NEEDS_APPROVAL",
  "SLEEPING",
  "SKIPPED",
  "REMOVED",
  "REMOVING",
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function parseArguments(argv) {
  const result = { checkOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") result.checkOnly = true;
    else if (argument === "--fleet-receipt") result.fleetReceipt = requiredValue(argv, ++index, argument);
    else if (argument === "--fleet-public-key") result.fleetPublicKey = requiredValue(argv, ++index, argument);
    else if (argument === "--fleet-job") result.fleetJob = requiredValue(argv, ++index, argument);
    else throw new Error(`unknown production promotion argument: ${argument}`);
  }
  return result;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  assert.ok(value && !value.startsWith("--"), `${flag} requires a value`);
  return value;
}

export function validateRepositoryState({
  status,
  branch,
  head,
  originMain,
  productionIsAncestor,
}) {
  assert.equal(status, "", "production promotion requires a clean worktree");
  assert.equal(branch, "main", "production promotion must run from main");
  assert.equal(head, originMain, "HEAD must equal origin/main before production promotion");
  assert.equal(
    productionIsAncestor,
    true,
    "origin/production must be an ancestor of the promoted main commit",
  );
}

export function validateCoordinatedServiceSources(config, serviceIds = DEFAULTS, receipt = null) {
  const services = config.services ?? config;
  for (const [label, serviceId, repository] of [
    ["migrator", serviceIds.migratorServiceId, CANONICAL_RELEASE_TOPOLOGY.images.runtime],
    ["API", serviceIds.apiServiceId, CANONICAL_RELEASE_TOPOLOGY.images.runtime],
    ["frontend", serviceIds.frontendServiceId, CANONICAL_RELEASE_TOPOLOGY.images.frontend],
  ]) {
    assert.ok(serviceId, `Railway ${label} service id is required`);
    const source = services[serviceId]?.source ?? {};
    assert.equal(source.repo ?? null, null, `Railway ${label} must not retain a racing Git source`);
    assert.match(
      source.image ?? "",
      new RegExp(`^${escapeRegex(repository)}@sha256:[0-9a-f]{64}$`, "u"),
      `Railway ${label} must use its canonical digest-pinned OCI image`,
    );
  }
  if (receipt) {
    assert.equal(
      services[serviceIds.migratorServiceId].source.image,
      services[serviceIds.apiServiceId].source.image,
      "migrator and API must use the same runtime image reference",
    );
    assert.equal(
      services[serviceIds.apiServiceId].source.image,
      `${CANONICAL_RELEASE_TOPOLOGY.images.runtime}@${receipt.images.runtime}`,
      `${receipt.environment} API image does not exactly match the canonical release receipt`,
    );
    assert.equal(
      services[serviceIds.frontendServiceId].source.image,
      `${CANONICAL_RELEASE_TOPOLOGY.images.frontend}@${receipt.images.frontend}`,
      `${receipt.environment} frontend image does not exactly match the canonical release receipt`,
    );
  }
}

export function validateProductionSourceCutover(config, serviceIds = DEFAULTS) {
  const services = config.services ?? config;
  for (const [label, serviceId, repository] of [
    ["migrator", serviceIds.migratorServiceId, CANONICAL_RELEASE_TOPOLOGY.images.runtime],
    ["API", serviceIds.apiServiceId, CANONICAL_RELEASE_TOPOLOGY.images.runtime],
    ["frontend", serviceIds.frontendServiceId, CANONICAL_RELEASE_TOPOLOGY.images.frontend],
  ]) {
    assert.ok(services[serviceId], `Railway production ${label} service is missing`);
    const source = services[serviceId]?.source ?? {};
    const coordinated = new RegExp(
      `^${escapeRegex(repository)}@sha256:[0-9a-f]{64}$`,
      "u",
    ).test(source.image ?? "");
    const detachable = source.repo === "fluffyrabbot/fmarch" && source.image == null;
    const interruptedCutover = source.repo == null && source.image == null;
    assert.equal(
      coordinated || detachable || interruptedCutover,
      true,
      `Railway production ${label} source is neither coordinated, safely detachable, nor an interrupted cutover`,
    );
  }
}

export function validateSecretCustodyPolicy(policy) {
  assert.equal(policy?.version, 2, "secret custody policy version must be 2");
  assert.deepEqual(policy.environments, ["staging", "production"]);
  assert.equal(policy.rules?.environment_isolation_required, true);
  assert.equal(policy.rules?.repository_secret_values_forbidden, true);
  assert.equal(policy.rules?.rotation_marker_required, true);
  assert.equal(policy.rules?.retirement_requires_successful_redeploy, true);
  assert.deepEqual(
    policy.families?.map((family) => family.id),
    [
      "database-authority",
      "auth-source-signing",
      "event-runtime-wrap",
      "event-archive",
      "profile-handle-index",
      "object-storage",
      "subject-key-authority",
      "workos",
    ],
  );
  for (const family of policy.families ?? []) {
    assert.ok(family.owner, `${family.id} must name an owner`);
    assert.ok(family.custody, `${family.id} must name its custody boundary`);
    assert.ok(family.secret_variables?.length > 0, `${family.id} must name secret variables`);
    assert.match(
      family.rotation_marker ?? "",
      /^[A-Z][A-Z0-9_]+(?:KID|REVISION)$/,
      `${family.id} must name a non-secret rotation marker`,
    );
    assert.ok(family.consumers?.length > 0, `${family.id} must name consumers`);
    assert.ok(family.rotation?.includes("deploy"), `${family.id} rotation must include deployment`);
    assert.ok(
      family.rotation?.match(/retire|revoke/),
      `${family.id} rotation must define retirement`,
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
  for (const [environment, api, migrator, frontend] of [
    ["staging", stagingApi, stagingMigrator, stagingFrontend],
    ["production", productionApi, productionMigrator, productionFrontend],
  ]) {
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

    const application = postgresCredential(
      api.DATABASE_URL,
      `${environment} API DATABASE_URL`,
    );
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
      migration.username !== "fmarch_application" &&
        migration.username !== "fmarch_key_admin",
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
        typeof value === "string" &&
          value.length >= 32 &&
          !value.includes("replace_me"),
        `${environment} ${label} database password must be a non-placeholder value of at least 32 characters`,
      );
    }
  }

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
  validateDatabaseAuthorityVariables({
    stagingApi,
    stagingMigrator,
    stagingFrontend,
    productionApi,
    productionMigrator,
    productionFrontend,
  });
  for (const [environment, variables, environmentId] of [
    ["staging", stagingMigrator, DEFAULTS.stagingEnvironmentId],
    ["production", productionMigrator, DEFAULTS.productionEnvironmentId],
  ]) {
    assert.equal(
      variables.FMARCH_DATABASE_PROJECT_ID,
      DEFAULTS.projectId,
      `${environment} database project identity drifted`,
    );
    assert.equal(
      variables.FMARCH_DATABASE_ENVIRONMENT_ID,
      environmentId,
      `${environment} database environment UUID drifted`,
    );
    assert.equal(
      variables.FMARCH_DATABASE_ENVIRONMENT,
      environment,
      `${environment} database environment identity drifted`,
    );
  }
  for (const [name, variables, required] of [
    [
      "staging API",
      stagingApi,
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
      "staging frontend",
      stagingFrontend,
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
    [
      "production API",
      productionApi,
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
      "production frontend",
      productionFrontend,
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
    for (const key of required) {
      assert.ok(variables[key], `${name} is missing ${key}`);
    }
    assert.equal(variables.FMARCH_DEV_AUTH, undefined, `${name} must not enable FMARCH_DEV_AUTH`);
    assert.equal(
      variables.FMARCH_FRONTEND_FIXTURE_SESSION,
      undefined,
      `${name} must not enable fixture sessions`,
    );
  }

  validateHostedIdentityDelivery("staging API", stagingApi);
  validateHostedIdentityDelivery("production API", productionApi);

  for (const [environment, api, frontend, apiUrl, frontendUrl] of [
    [
      "staging",
      stagingApi,
      stagingFrontend,
      DEFAULTS.stagingApiUrl,
      DEFAULTS.stagingFrontendUrl,
    ],
    [
      "production",
      productionApi,
      productionFrontend,
      DEFAULTS.productionApiUrl,
      DEFAULTS.productionFrontendUrl,
    ],
  ]) {
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
    assert.equal(
      frontend.ORIGIN,
      frontendUrl,
      `${environment} frontend must use the canonical origin`,
    );
    assert.equal(
      frontend.WORKOS_REDIRECT_URI,
      `${frontendUrl}/auth/callback`,
      `${environment} frontend must use the canonical WorkOS callback`,
    );
    assertSecretRelation(
      api.WORKOS_CLIENT_ID === frontend.WORKOS_CLIENT_ID,
      `${environment} API and frontend must use the same WorkOS client`,
    );
  }
  assertSecretRelation(
    stagingApi.FMARCH_AUTH_SOURCE_SIGNING_KEY ===
      stagingFrontend.FMARCH_AUTH_SOURCE_SIGNING_KEY,
    "staging API and frontend must share the auth-source signing key",
  );
  assertSecretRelation(
    productionApi.FMARCH_AUTH_SOURCE_SIGNING_KEY ===
      productionFrontend.FMARCH_AUTH_SOURCE_SIGNING_KEY,
    "production API and frontend must share the auth-source signing key",
  );
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
  for (const [label, variables] of [
    ["staging", stagingApi],
    ["production", productionApi],
  ]) {
    assertSecretRelation(
      variables.FMARCH_EVENT_WRAP_KEY !== variables.FMARCH_EVENT_ARCHIVE_KEY,
      `${label} event wrapping and archive keys must be separate`,
    );
    assertSecretRelation(
      variables.FMARCH_PROFILE_HANDLE_INDEX_KEY !== variables.FMARCH_EVENT_WRAP_KEY &&
        variables.FMARCH_PROFILE_HANDLE_INDEX_KEY !== variables.FMARCH_EVENT_ARCHIVE_KEY,
      `${label} profile-handle index key must be distinct from event keys`,
    );
  }
  assertSecretRelation(
    productionApi.FMARCH_EVENT_WRAP_KID !== stagingApi.FMARCH_EVENT_WRAP_KID,
    "production and staging must not share the event wrapping KID",
  );
  assertSecretRelation(
    productionApi.FMARCH_EVENT_ARCHIVE_KID !== stagingApi.FMARCH_EVENT_ARCHIVE_KID,
    "production and staging must not share the event archive KID",
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
  for (const [name, variables] of [
    ["staging", stagingApi],
    ["production", productionApi],
  ]) {
    assertSecretRelation(
      variables.FMARCH_SUBJECT_AUTHORITY_BUCKET !== variables.AWS_S3_BUCKET_NAME,
      `${name} subject authority must not reuse its media bucket`,
    );
    assertSecretRelation(
      variables.FMARCH_SUBJECT_AUTHORITY_WRAP_KID !==
        variables.FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID,
      `${name} subject wrapping and journal KIDs must be separate`,
    );
    for (const [purpose, value] of [
      ["wrapping", variables.FMARCH_SUBJECT_AUTHORITY_WRAP_KEY],
      ["journal", variables.FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY],
    ]) {
      assertSecretRelation(
        isCanonicalBase64Key(value),
        `${name} subject ${purpose} key must be canonical padded base64 encoding exactly 32 bytes`,
      );
    }
    const subjectWrapKey = Buffer.from(variables.FMARCH_SUBJECT_AUTHORITY_WRAP_KEY, "base64");
    const subjectJournalKey = Buffer.from(
      variables.FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY,
      "base64",
    );
    assertSecretRelation(
      !subjectWrapKey.equals(subjectJournalKey),
      `${name} subject wrapping and journal keys must decode to separate material`,
    );
  }
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

  for (const [label, api, frontend] of [
    ["staging auth-source KID", stagingApi, stagingFrontend],
    ["production auth-source KID", productionApi, productionFrontend],
  ]) {
    assertSecretRelation(
      api.FMARCH_AUTH_SOURCE_SIGNING_KID === frontend.FMARCH_AUTH_SOURCE_SIGNING_KID,
      `${label} must match across API and frontend`,
    );
  }
  for (const [label, api, frontend] of [
    ["staging WorkOS KID", stagingApi, stagingFrontend],
    ["production WorkOS KID", productionApi, productionFrontend],
  ]) {
    assertSecretRelation(
      api.FMARCH_WORKOS_CREDENTIAL_KID === frontend.FMARCH_WORKOS_CREDENTIAL_KID,
      `${label} must match across API and frontend`,
    );
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

  for (const [label, value] of [
    ["staging auth-source signing key", stagingApi.FMARCH_AUTH_SOURCE_SIGNING_KEY],
    ["production auth-source signing key", productionApi.FMARCH_AUTH_SOURCE_SIGNING_KEY],
  ]) {
    assertSecretRelation(
      typeof value === "string" && value.length >= 32 && !value.includes("replace_me"),
      `${label} must be a non-placeholder value of at least 32 characters`,
    );
  }
  for (const [label, value] of [
    ["staging WorkOS cookie password", stagingFrontend.WORKOS_COOKIE_PASSWORD],
    ["production WorkOS cookie password", productionFrontend.WORKOS_COOKIE_PASSWORD],
  ]) {
    assertSecretRelation(
      isStrongWorkosCookiePassword(value),
      `${label} must be a non-placeholder value of at least 32 characters`,
    );
  }
  for (const [label, value] of [
    ["staging profile-handle index key", stagingApi.FMARCH_PROFILE_HANDLE_INDEX_KEY],
    ["production profile-handle index key", productionApi.FMARCH_PROFILE_HANDLE_INDEX_KEY],
  ]) {
    assertSecretRelation(
      isStrongOpaqueSecret(value),
      `${label} must be a non-placeholder value of at least 32 characters`,
    );
  }
  for (const [label, value] of [
    ["staging event wrapping key", stagingApi.FMARCH_EVENT_WRAP_KEY],
    ["production event wrapping key", productionApi.FMARCH_EVENT_WRAP_KEY],
    ["staging event archive key", stagingApi.FMARCH_EVENT_ARCHIVE_KEY],
    ["production event archive key", productionApi.FMARCH_EVENT_ARCHIVE_KEY],
  ]) {
    assertSecretRelation(
      isCanonicalBase64Key(value),
      `${label} must be canonical padded base64 encoding exactly 32 bytes`,
    );
  }
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

function secretCustodyPolicy() {
  return JSON.parse(
    readFileSync(
      new URL("../docs/ops/release-secret-custody.json", import.meta.url),
      "utf8",
    ),
  );
}

export function validateDeployment(deployment, expectedCommit, label) {
  assert.ok(deployment, `${label} has no Railway deployment`);
  assert.equal(deployment.status, "SUCCESS", `${label} deployment is ${deployment.status}`);
  assert.equal(
    deployment.meta?.commitHash,
    expectedCommit,
    `${label} does not run the promoted commit`,
  );
}

export function validateDomainList(result, expectedDomain, label) {
  const domain = result.domains?.find((candidate) => candidate.domain === expectedDomain);
  assert.ok(domain, `${label} is missing ${expectedDomain}`);
  assert.equal(domain.syncStatus, "ACTIVE", `${label} domain is ${domain.syncStatus}`);
}

function scrubPrivilegedDatabaseEnvironment(env) {
  const scrubbed = { ...env };
  for (const key of Object.keys(scrubbed)) {
    if (key.startsWith("PG")) delete scrubbed[key];
  }
  for (const key of [
    "DATABASE_MIGRATION_URL",
    "DATABASE_KEY_ADMIN_URL",
    "FMARCH_DATABASE_APPLICATION_PASSWORD",
    "FMARCH_DATABASE_KEY_ADMIN_PASSWORD",
  ]) {
    delete scrubbed[key];
  }
  return {
    ...scrubbed,
    RAILWAY_CALLER: "skill:use-railway@1.4.0",
    RAILWAY_AGENT_SESSION: callerSession,
  };
}

export function railwayArguments(projectId, args) {
  assert.equal(
    projectId,
    CANONICAL_RELEASE_TOPOLOGY.project_id,
    "Railway command project drifted from the canonical release topology",
  );
  return [...args, "--project", projectId];
}

export function productionPointerPushArguments(commit, expectedProductionCommit) {
  return productionPointerPushArgumentsForAuthority(commit, expectedProductionCommit);
}

export function productionReceiptPathForLease(commit, promotionLockToken, root = repoRoot) {
  assertFullCommit(commit);
  assertFullCommit(promotionLockToken, "production promotion lock token");
  return path.resolve(
    root,
    "target",
    "releases",
    "production",
    `${commit}.${promotionLockToken}.json`,
  );
}

export async function finalizeProductionPointer({
  commit,
  expectedProductionCommit,
  revalidate,
  revalidateEvidence = async () => {},
  assertLease = async () => {},
  refreshProductionPointer,
  pushPointer,
}) {
  await revalidateEvidence();
  await revalidate();
  const currentProductionCommit = await refreshProductionPointer();
  assert.equal(
    currentProductionCommit,
    expectedProductionCommit,
    "production pointer moved after promotion preflight",
  );
  await assertLease();
  await pushPointer(productionPointerPushArguments(commit, expectedProductionCommit));
}

export async function withProductionPromotionLock({ acquire, release }, action) {
  const token = await acquire();
  let actionError = null;
  try {
    return await action(token);
  } catch (error) {
    actionError = error;
    throw error;
  } finally {
    try {
      await release(token);
    } catch (releaseError) {
      if (actionError) actionError.cause = releaseError;
      else throw releaseError;
    }
  }
}

export function reconcilePromotionLockMutation({ operation, token, mutate, inspect }) {
  assert.ok(["acquire", "release"].includes(operation), "unknown promotion lock mutation");
  let mutationError = null;
  try {
    mutate();
  } catch (error) {
    mutationError = error;
  }
  const observed = inspect();
  const expected = operation === "acquire" ? token : null;
  if (observed === expected) return expected;
  if (mutationError) throw mutationError;
  assert.equal(
    observed,
    expected,
    `production promotion lock ${operation} did not reach its exact state`,
  );
  return expected;
}

function remotePromotionLock() {
  assertCanonicalReleaseRemote();
  const output = text("git", [
    "ls-remote",
    "--refs",
    CANONICAL_RELEASE_REMOTE_URL,
    PRODUCTION_PROMOTION_LOCK_REF,
  ]);
  if (!output) return null;
  const [commit, ref, ...extra] = output.split(/\s+/u);
  assert.equal(ref, PRODUCTION_PROMOTION_LOCK_REF, "production promotion lock ref drifted");
  assert.equal(extra.length, 0, "production promotion lock returned ambiguous state");
  assert.match(commit, /^[0-9a-f]{40}$/u, "production promotion lock token is invalid");
  return commit;
}

function acquireProductionPromotionLock({
  commit,
  expectedProductionCommit,
  fleetProof,
  stagingReceipt,
}) {
  assertCanonicalReleaseRemote();
  const existing = remotePromotionLock();
  assert.equal(
    existing,
    null,
    `production promotion is already locked by ${existing}; recover that exact operation before retrying`,
  );
  const identity = `fmarch-production-promotion-${randomUUID()}`;
  const message = JSON.stringify(createProductionPromotionLockIntent({
    identity,
    releaseCommit: commit,
    expectedProductionCommit,
    fleetJobId: fleetProof.job_id,
    fleetReceiptSha256: fleetProof.receipt_sha256,
    stagingReceiptSha256: stagingReceipt.receipt_sha256,
    schemaEpochReset: stagingReceipt.schema_epoch_reset?.epoch ?? null,
  }));
  const tokenResult = spawnSync(
    "git",
    ["commit-tree", `${commit}^{tree}`, "-p", commit],
    {
      cwd: repoRoot,
      encoding: "utf8",
      input: `${message}\n`,
      timeout: SUBPROCESS_TIMEOUT_MS.git,
      env: {
        ...releaseGitEnvironment(),
        GIT_AUTHOR_NAME: "fmarch release coordinator",
        GIT_AUTHOR_EMAIL: "release@fmarch.invalid",
        GIT_COMMITTER_NAME: "fmarch release coordinator",
        GIT_COMMITTER_EMAIL: "release@fmarch.invalid",
      },
    },
  );
  assert.equal(tokenResult.status, 0, "could not create the production promotion lock token");
  const token = String(tokenResult.stdout).trim();
  assert.match(token, /^[0-9a-f]{40}$/u, "production promotion lock token is invalid");
  reconcilePromotionLockMutation({
    operation: "acquire",
    token,
    mutate: () => run(
      "git",
      [
        "push",
        `--force-with-lease=${PRODUCTION_PROMOTION_LOCK_REF}:`,
        CANONICAL_RELEASE_REMOTE_URL,
        `${token}:${PRODUCTION_PROMOTION_LOCK_REF}`,
      ],
      { stdio: "inherit" },
    ),
    inspect: remotePromotionLock,
  });
  return token;
}

function releaseProductionPromotionLock(token) {
  assertCanonicalReleaseRemote();
  reconcilePromotionLockMutation({
    operation: "release",
    token,
    mutate: () => run(
      "git",
      [
        "push",
        `--force-with-lease=${PRODUCTION_PROMOTION_LOCK_REF}:${token}`,
        CANONICAL_RELEASE_REMOTE_URL,
        `:${PRODUCTION_PROMOTION_LOCK_REF}`,
      ],
      { stdio: "inherit" },
    ),
    inspect: remotePromotionLock,
  });
}

export function validateReusableProductionReceipt(
  receipt,
  { commit, stagingReceipt, fleetProof, releaseReadiness },
) {
  const validated = assertReleaseReceipt(receipt);
  assert.equal(validated.environment, "production", "only a production receipt can resume promotion");
  assert.equal(validated.commit, commit, "existing production receipt commit drifted");
  assert.equal(
    validated.images.runtime,
    stagingReceipt.images.runtime,
    "existing production runtime image drifted from staging",
  );
  assert.equal(
    validated.images.frontend,
    stagingReceipt.images.frontend,
    "existing production frontend image drifted from staging",
  );
  assert.deepEqual(
    validated.runtime_validation,
    stagingReceipt.runtime_validation,
    "existing production runtime validation drifted from staging",
  );
  assert.deepEqual(
    validated.fleet_proof,
    fleetProof,
    "existing production fleet proof drifted",
  );
  assert.deepEqual(
    validated.release_readiness,
    releaseReadiness,
    "existing production readiness drifted",
  );
  assert.equal(
    validated.schema_epoch_reset?.epoch ?? null,
    stagingReceipt.schema_epoch_reset?.epoch ?? null,
    "existing production schema epoch reset drifted from staging",
  );
  return validated;
}

function optionalReceipt(receiptPath) {
  try {
    return JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function revalidateCanonicalProduction(config, receipt) {
  const productionConfig = await railwayJson(config, [
    "environment",
    "config",
    "--environment",
    config.productionEnvironmentId,
    "--json",
  ]);
  validateCoordinatedServiceSources(productionConfig, config, receipt);
  await validateCoordinatedEnvironment(
    config,
    { id: config.productionEnvironmentId, name: config.productionEnvironment },
    receipt,
    {
      apiUrl: config.productionApiUrl,
      frontendUrl: config.productionFrontendUrl,
    },
  );
}

function promotionLeaseExpectation({
  token,
  commit,
  expectedProductionCommit,
  fleetProof,
  stagingReceipt,
}) {
  return {
    token,
    releaseCommit: commit,
    expectedProductionCommit,
    fleetJobId: fleetProof.job_id,
    fleetReceiptSha256: fleetProof.receipt_sha256,
    stagingReceiptSha256: stagingReceipt.receipt_sha256,
    schemaEpochReset: stagingReceipt.schema_epoch_reset?.epoch ?? null,
  };
}

export async function revalidatePromotionEvidence({
  stagingReceiptPath,
  stagingReceipt,
  productionReceipt,
  fleetReceiptPath,
  fleetPublicKeyPath,
  expectedFleetJob,
  commit,
}) {
  const currentStagingReceipt = assertFreshStagingReleaseReceipt(
    JSON.parse(readFileSync(stagingReceiptPath, "utf8")),
  );
  assert.equal(
    currentStagingReceipt.receipt_sha256,
    stagingReceipt.receipt_sha256,
    "staging receipt changed during production promotion",
  );
  const currentFleetProof = await loadFleetReleaseProof({
    repoRoot,
    commit,
    receiptPath: fleetReceiptPath,
    publicKeyPath: fleetPublicKeyPath,
    expectedJobId: expectedFleetJob,
  });
  assert.deepEqual(currentFleetProof, stagingReceipt.fleet_proof, "fleet proof changed during promotion");
  assertFreshReleaseEvidence(
    productionReceipt.attempt.created_at,
    "production release intent time",
  );
  assertFreshReleaseEvidence(
    productionReceipt.generated_at,
    "production release generation time",
  );
}

async function finalizeCanonicalProductionPointer(
  config,
  receipt,
  commit,
  expectedProductionCommit,
  authority,
) {
  await finalizeProductionPointer({
    commit,
    expectedProductionCommit,
    revalidate: () => revalidateCanonicalProduction(config, receipt),
    refreshProductionPointer: () => {
      assertCanonicalReleaseRemote();
      run("git", canonicalReleaseFetchArguments(["production"]));
      return text("git", ["rev-parse", "origin/production"]);
    },
    revalidateEvidence: () => revalidatePromotionEvidence({
      ...authority,
      productionReceipt: receipt,
      commit,
    }),
    assertLease: () => assertProductionPromotionLease(
      promotionLeaseExpectation({
        token: authority.promotionLockToken,
        commit,
        expectedProductionCommit,
        fleetProof: authority.fleetProof,
        stagingReceipt: authority.stagingReceipt,
      }),
    ),
    pushPointer: (arguments_) => run("git", ["push", ...arguments_], { stdio: "inherit" }),
  });
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const { checkOnly } = args;
  const config = runtimeConfig();
  validateSecretCustodyPolicy(secretCustodyPolicy());

  assertCanonicalReleaseRemote();
  run("git", canonicalReleaseFetchArguments(["main", "production"]));
  const head = text("git", ["rev-parse", "HEAD"]);
  const originProduction = text("git", ["rev-parse", "origin/production"]);
  const stagingReceiptPath = path.resolve(
    process.env.FMARCH_STAGING_RELEASE_RECEIPT ??
      path.join(
        repoRoot,
        "target",
        "releases",
        "staging",
        `${head}.json`,
      ),
  );
  const stagingReceipt = assertFreshStagingReleaseReceipt(
    JSON.parse(readFileSync(stagingReceiptPath, "utf8")),
  );
  assert.equal(stagingReceipt.environment, "staging");
  assert.equal(stagingReceipt.commit, head, "staging receipt does not match the promoted commit");
  const productionIsAncestor =
    spawnSync("git", ["merge-base", "--is-ancestor", "origin/production", head], {
      cwd: repoRoot,
      env: releaseGitEnvironment(),
      timeout: SUBPROCESS_TIMEOUT_MS.git,
    }).status === 0;
  validateRepositoryState({
    status: text("git", ["status", "--porcelain"]),
    branch: text("git", ["branch", "--show-current"]),
    head,
    originMain: text("git", ["rev-parse", "origin/main"]),
    productionIsAncestor,
  });
  const fleetReceiptPath = args.fleetReceipt ?? process.env.FMARCH_FLEET_RECEIPT;
  const fleetPublicKeyPath =
    args.fleetPublicKey ??
    process.env.FMARCH_FLEET_PUBLIC_KEY ??
    defaultFleetPublicKeyPath();
  const expectedFleetJob = args.fleetJob ?? process.env.FMARCH_FLEET_JOB_ID;
  assert.ok(expectedFleetJob, "production promotion requires --fleet-job or FMARCH_FLEET_JOB_ID");
  const fleetProof = await loadFleetReleaseProof({
    repoRoot,
    commit: head,
    receiptPath: fleetReceiptPath,
    publicKeyPath: fleetPublicKeyPath,
    expectedJobId: expectedFleetJob,
  });
  assert.deepEqual(
    stagingReceipt.fleet_proof,
    fleetProof,
    "production must reuse the exact signed fleet proof bound by staging",
  );
  const completionRegistry = await loadCompletionRegistry();
  await validateRegistry(completionRegistry);
  const releaseReadiness = validateProductionReleaseReadiness(completionRegistry);

  const [stagingConfig, productionConfig] = await Promise.all([
    railwayJson(
      config,
      ["environment", "config", "--environment", config.stagingEnvironmentId, "--json"],
    ),
    railwayJson(
      config,
      [
        "environment",
        "config",
        "--environment",
        config.productionEnvironmentId,
        "--json",
      ],
    ),
  ]);
  validateCoordinatedServiceSources(stagingConfig, config, stagingReceipt);
  validateProductionSourceCutover(productionConfig, config);

  const [
    stagingApi,
    stagingMigrator,
    stagingFrontend,
    productionApi,
    productionMigrator,
    productionFrontend,
  ] = await Promise.all([
    variables(config, config.stagingEnvironmentId, config.apiServiceId),
    variables(config, config.stagingEnvironmentId, config.migratorServiceId),
    variables(config, config.stagingEnvironmentId, config.frontendServiceId),
    variables(config, config.productionEnvironmentId, config.apiServiceId),
    variables(config, config.productionEnvironmentId, config.migratorServiceId),
    variables(config, config.productionEnvironmentId, config.frontendServiceId),
  ]);
  validateHostedVariables({
    stagingApi,
    stagingMigrator,
    stagingFrontend,
    productionApi,
    productionMigrator,
    productionFrontend,
  });
  await Promise.all([
    preflightWorkosOidc({
      label: "staging",
      clientId: stagingApi.WORKOS_CLIENT_ID,
      issuer: stagingApi.WORKOS_ISSUER,
      jwksUrl: stagingApi.WORKOS_JWKS_URL,
    }),
    preflightWorkosOidc({
      label: "production",
      clientId: productionApi.WORKOS_CLIENT_ID,
      issuer: productionApi.WORKOS_ISSUER,
      jwksUrl: productionApi.WORKOS_JWKS_URL,
    }),
  ]);

  await validateCoordinatedEnvironment(
    config,
    { id: config.stagingEnvironmentId, name: config.stagingEnvironment },
    stagingReceipt,
    {
    apiUrl: config.stagingApiUrl,
    frontendUrl: config.stagingFrontendUrl,
    },
  );

  if (checkOnly) {
    console.log(`production promotion check passed for ${head}`);
    return;
  }

  await withProductionPromotionLock(
    {
      acquire: () => acquireProductionPromotionLock({
        commit: head,
        expectedProductionCommit: originProduction,
        fleetProof,
        stagingReceipt,
      }),
      release: (token) => releaseProductionPromotionLock(token),
    },
    async (promotionLockToken) => {
      const promotionAuthority = {
        promotionLockToken,
        stagingReceiptPath,
        stagingReceipt,
        fleetProof,
        fleetReceiptPath,
        fleetPublicKeyPath,
        expectedFleetJob,
      };
      assertProductionPromotionLease(promotionLeaseExpectation({
        token: promotionLockToken,
        commit: head,
        expectedProductionCommit: originProduction,
        fleetProof,
        stagingReceipt,
      }));
      const productionReceiptPath = productionReceiptPathForLease(
        head,
        promotionLockToken,
      );
      const existingProductionReceipt = optionalReceipt(productionReceiptPath);
      if (existingProductionReceipt) {
        const reusable = validateReusableProductionReceipt(existingProductionReceipt, {
          commit: head,
          stagingReceipt,
          fleetProof,
          releaseReadiness,
        });
        assert.equal(
          reusable.attempt.promotion_lease_commit,
          promotionLockToken,
          "existing production receipt was authorized by a different promotion lease",
        );
        await finalizeCanonicalProductionPointer(
          config,
          reusable,
          head,
          originProduction,
          promotionAuthority,
        );
        console.log(`production promotion resumed from durable receipt for ${head}`);
        return;
      }

      const coordinatorArguments = [
        "tools/release_coordinator.mjs",
        "--environment",
        "production",
        "--commit",
        head,
        "--reuse-staging-receipt",
        stagingReceiptPath,
        "--fleet-receipt",
        fleetReceiptPath,
        "--fleet-public-key",
        fleetPublicKeyPath,
        "--fleet-job",
        expectedFleetJob,
        "--production-lock",
        promotionLockToken,
        "--output",
        productionReceiptPath,
      ];
      if (stagingReceipt.schema_epoch_reset) {
        coordinatorArguments.push(
          "--schema-epoch-reset",
          String(stagingReceipt.schema_epoch_reset.epoch),
        );
      }
      run(process.execPath, coordinatorArguments, {
        env: scrubPrivilegedDatabaseEnvironment(process.env),
        stdio: "inherit",
      });
      const productionReceipt = validateReusableProductionReceipt(
        JSON.parse(readFileSync(productionReceiptPath, "utf8")),
        { commit: head, stagingReceipt, fleetProof, releaseReadiness },
      );
      assert.equal(
        productionReceipt.attempt.promotion_lease_commit,
        promotionLockToken,
        "production receipt was not authorized by the held promotion lease",
      );
      await finalizeCanonicalProductionPointer(
        config,
        productionReceipt,
        head,
        originProduction,
        promotionAuthority,
      );
      console.log(`production promotion completed for ${head}`);
    },
  );
}

export function runtimeConfig(env = process.env) {
  const legacyOverrides = {
    FMARCH_RAILWAY_PROJECT_ID: DEFAULTS.projectId,
    FMARCH_RAILWAY_MIGRATOR_SERVICE_ID: DEFAULTS.migratorServiceId,
    FMARCH_RAILWAY_API_SERVICE_ID: DEFAULTS.apiServiceId,
    FMARCH_RAILWAY_FRONTEND_SERVICE_ID: DEFAULTS.frontendServiceId,
    FMARCH_RAILWAY_STAGING_ENVIRONMENT: DEFAULTS.stagingEnvironment,
    FMARCH_RAILWAY_STAGING_ENVIRONMENT_ID: DEFAULTS.stagingEnvironmentId,
    FMARCH_RAILWAY_PRODUCTION_ENVIRONMENT: DEFAULTS.productionEnvironment,
    FMARCH_RAILWAY_PRODUCTION_ENVIRONMENT_ID: DEFAULTS.productionEnvironmentId,
    FMARCH_STAGING_API_URL: DEFAULTS.stagingApiUrl,
    FMARCH_STAGING_FRONTEND_URL: DEFAULTS.stagingFrontendUrl,
    FMARCH_PRODUCTION_API_URL: DEFAULTS.productionApiUrl,
    FMARCH_PRODUCTION_FRONTEND_URL: DEFAULTS.productionFrontendUrl,
  };
  for (const [key, expected] of Object.entries(legacyOverrides)) {
    if (env[key] !== undefined) {
      assert.equal(env[key], expected, `${key} cannot override the canonical release topology`);
    }
  }
  return { ...DEFAULTS };
}

async function validateCoordinatedEnvironment(config, environment, receipt, urls) {
  const { id: environmentId, name: environmentName } = environment;
  const [migratorDeployment, apiDeployment, frontendDeployment, apiDomains, frontendDomains] =
    await Promise.all([
      latestDeployment(config, environmentId, config.migratorServiceId),
      latestDeployment(config, environmentId, config.apiServiceId),
      latestDeployment(config, environmentId, config.frontendServiceId),
      domains(config, environmentId, config.apiServiceId),
      domains(config, environmentId, config.frontendServiceId),
    ]);
  validateDeploymentArtifact(migratorDeployment, receipt.images.runtime, `${environmentName} migrator`);
  validateDeploymentArtifact(apiDeployment, receipt.images.runtime, `${environmentName} API`);
  validateDeploymentArtifact(frontendDeployment, receipt.images.frontend, `${environmentName} frontend`);
  assert.equal(
    migratorDeployment.id,
    receipt.deployments.migrator,
    `${environmentName} migrator receipt is stale`,
  );
  assert.equal(apiDeployment.id, receipt.deployments.api, `${environmentName} API receipt is stale`);
  assert.equal(
    frontendDeployment.id,
    receipt.deployments.frontend,
    `${environmentName} frontend receipt is stale`,
  );
  validateDomainList(apiDomains, new URL(urls.apiUrl).host, `${environmentName} API`);
  validateDomainList(frontendDomains, new URL(urls.frontendUrl).host, `${environmentName} frontend`);
  const [apiBody, frontendBody] = await Promise.all([
    health(`${urls.apiUrl}/readyz`, () => true, `${environmentName} API`),
    health(`${urls.frontendUrl}/healthz`, () => true, `${environmentName} frontend`),
  ]);
  validateHealth(apiBody, receipt.commit, "api");
  validateHealth(frontendBody, receipt.commit, "frontend");
}

async function validateEnvironment(config, environment, commit, urls) {
  const [
    migratorDeployment,
    apiDeployment,
    frontendDeployment,
    apiDomains,
    frontendDomains,
  ] = await Promise.all([
    latestDeployment(config, environment, config.migratorServiceId),
    latestDeployment(config, environment, config.apiServiceId),
    latestDeployment(config, environment, config.frontendServiceId),
    domains(config, environment, config.apiServiceId),
    domains(config, environment, config.frontendServiceId),
  ]);
  validateDeployment(migratorDeployment, commit, `${environment} migrator`);
  validateDeployment(apiDeployment, commit, `${environment} API`);
  validateDeployment(frontendDeployment, commit, `${environment} frontend`);
  validateDomainList(apiDomains, new URL(urls.apiUrl).host, `${environment} API`);
  validateDomainList(frontendDomains, new URL(urls.frontendUrl).host, `${environment} frontend`);
  await Promise.all([
    health(
      `${urls.apiUrl}/readyz`,
      (body) =>
        body.ok === true &&
        body.database_schema === true &&
        body.object_storage === true &&
        body.subject_authority === true,
      `${environment} API`,
    ),
    health(
      `${urls.frontendUrl}/healthz`,
      (body) => body.status === "ok",
      `${environment} frontend`,
    ),
  ]);
}

async function waitForProduction(config, commit) {
  const deadline = Date.now() + 15 * 60 * 1000;
  const services = [
    [config.migratorServiceId, "production migrator"],
    [config.apiServiceId, "production API"],
    [config.frontendServiceId, "production frontend"],
  ];
  const completed = new Set();

  while (Date.now() < deadline && completed.size !== services.length) {
    for (const [serviceId, label] of services) {
      if (completed.has(serviceId)) continue;
      const deployment = await latestDeployment(
        config,
        config.productionEnvironment,
        serviceId,
      );
      if (deployment?.meta?.commitHash !== commit) continue;
      if (!terminalDeploymentStates.has(deployment.status)) continue;
      validateDeployment(deployment, commit, label);
      completed.add(serviceId);
    }
    if (completed.size !== services.length) await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  assert.equal(completed.size, services.length, "production deployments did not finish in 15 minutes");
}

async function health(url, predicate, label) {
  const expected = new URL(url);
  const response = await fetch(expected, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.ok, true, `${label} health returned ${response.status}`);
  assert.equal(response.url, expected.href, `${label} health response URL drifted`);
  assert.equal(new URL(response.url).origin, expected.origin, `${label} health origin drifted`);
  const body = await response.json();
  assert.equal(predicate(body), true, `${label} health payload was not ready`);
  return body;
}

async function variables(config, environment, service) {
  return await railwayJson(config, [
    "variable",
    "list",
    "--environment",
    environment,
    "--service",
    service,
    "--json",
  ]);
}

async function domains(config, environment, service) {
  return await railwayJson(config, [
    "domain",
    "list",
    "--environment",
    environment,
    "--service",
    service,
    "--json",
  ]);
}

async function latestDeployment(config, environment, service) {
  const deployments = await railwayJson(config, [
    "deployment",
    "list",
    "--environment",
    environment,
    "--service",
    service,
    "--limit",
    "1",
    "--json",
  ]);
  return deployments[0];
}

async function railwayJson(config, args) {
  const output = execFileSync("railway", railwayArguments(config.projectId, args), {
    cwd: repoRoot,
    encoding: "utf8",
    env: scrubPrivilegedDatabaseEnvironment(process.env),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: SUBPROCESS_TIMEOUT_MS.railway,
  });
  return JSON.parse(output);
}

function text(command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    env: path.basename(command) === "git" ? releaseGitEnvironment() : process.env,
    encoding: "utf8",
    timeout: SUBPROCESS_TIMEOUT_MS[command] ?? 2 * 60 * 1_000,
  }).trim();
}

function run(command, args, options = {}) {
  const timeout = options.timeout ?? SUBPROCESS_TIMEOUT_MS[path.basename(command)] ?? 2 * 60 * 1_000;
  const baseEnvironment = options.env ?? process.env;
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    ...options,
    env: path.basename(command) === "git" ? releaseGitEnvironment(baseEnvironment) : baseEnvironment,
    encoding: "utf8",
    timeout,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed${result.error?.code === "ETIMEDOUT" ? ` after ${timeout}ms` : ""}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`production promotion blocked: ${error.message}`);
    process.exitCode = 1;
  }
}
