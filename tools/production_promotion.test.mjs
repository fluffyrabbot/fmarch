import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseArguments,
  localProofRuntime,
  railwayArguments,
  runtimeConfig,
  validateDatabaseAuthorityVariables,
  validateDeployment,
  validateDomainList,
  validateHostedVariables,
  validateCoordinatedServiceSources,
  validateProductionSourceCutover,
  validateRepositoryState,
  validateSecretCustodyPolicy,
} from "./production_promotion.mjs";

const apiServiceId = "api";
const migratorServiceId = "migrator";
const frontendServiceId = "frontend";
const serviceIds = { apiServiceId, migratorServiceId, frontendServiceId };

test("promotion arguments are fail closed", () => {
  assert.deepEqual(parseArguments([]), { checkOnly: false });
  assert.deepEqual(parseArguments(["--check"]), { checkOnly: true });
  assert.throws(() => parseArguments(["--force"]), /unknown production promotion argument/);
});

test("production promotion consumes the coordinated staging receipt", async () => {
  const source = await readFile(new URL("./production_promotion.mjs", import.meta.url), "utf8");
  const stagingReceipt = source.indexOf("const stagingReceipt = assertReleaseReceipt");
  const stagingValidation = source.indexOf("await validateCoordinatedEnvironment");
  const releasePush = source.indexOf(
    'run("git", ["push", "origin", `${head}:refs/heads/production`]',
  );
  const coordinator = source.indexOf('"tools/release_coordinator.mjs"');
  assert.equal(stagingReceipt >= 0, true);
  assert.equal(stagingValidation > stagingReceipt, true);
  assert.equal(releasePush > stagingValidation, true);
  assert.equal(coordinator > releasePush, true);
});

test("promotion proof preserves an explicit database or provisions the repo-local default", () => {
  const privileged = {
    DATABASE_MIGRATION_URL: "postgres://owner/private",
    DATABASE_KEY_ADMIN_URL: "postgres://key-admin/private",
    FMARCH_DATABASE_APPLICATION_PASSWORD: "application-secret",
    FMARCH_DATABASE_KEY_ADMIN_PASSWORD: "key-admin-secret",
    PGCONNECT_TIMEOUT: "1",
    PGOPTIONS: "-c search_path=attacker,public",
  };
  const explicit = localProofRuntime({
    DATABASE_URL: "postgres://explicit/db",
    KEEP: "yes",
    ...privileged,
  });
  assert.equal(explicit.startLocalPostgres, false);
  assert.equal(explicit.env.DATABASE_URL, "postgres://explicit/db");
  assert.equal(explicit.env.KEEP, "yes");
  for (const key of Object.keys(privileged)) assert.equal(explicit.env[key], undefined);

  const local = localProofRuntime({ KEEP: "yes" });
  assert.equal(local.startLocalPostgres, true);
  assert.equal(local.env.DATABASE_URL, "postgres://fmarch:fmarch@127.0.0.1:5544/fmarch");
  assert.equal(local.env.KEEP, "yes");
});

test("Railway commands use explicit project flags except after an explicit link", () => {
  assert.deepEqual(railwayArguments("project-id", ["environment", "config", "--json"]), [
    "environment",
    "config",
    "--json",
    "--project",
    "project-id",
  ]);
  assert.deepEqual(
    railwayArguments("project-id", ["environment", "config", "--json"], { linked: true }),
    ["environment", "config", "--json"],
  );
});

test("promotion requires the live migrator service UUID explicitly", () => {
  assert.throws(() => runtimeConfig({}), /FMARCH_RAILWAY_MIGRATOR_SERVICE_ID/);
  const configured = runtimeConfig({
    FMARCH_RAILWAY_MIGRATOR_SERVICE_ID: "11111111-2222-4333-8444-555555555555",
  });
  assert.equal(
    configured.migratorServiceId,
    "11111111-2222-4333-8444-555555555555",
  );
});

test("repository state requires clean synchronized main and an ancestor release pointer", () => {
  const ready = {
    status: "",
    branch: "main",
    head: "abc",
    originMain: "abc",
    productionIsAncestor: true,
  };
  assert.doesNotThrow(() => validateRepositoryState(ready));
  assert.throws(() => validateRepositoryState({ ...ready, status: " M file" }), /clean worktree/);
  assert.throws(() => validateRepositoryState({ ...ready, branch: "feature" }), /from main/);
  assert.throws(
    () => validateRepositoryState({ ...ready, productionIsAncestor: false }),
    /must be an ancestor/,
  );
});

test("Railway services use digest-pinned images without a racing Git source", () => {
  const runtime = `ghcr.io/fluffyrabbot/fmarch-runtime@sha256:${"a".repeat(64)}`;
  const frontend = `ghcr.io/fluffyrabbot/fmarch-frontend@sha256:${"b".repeat(64)}`;
  const config = {
    services: {
      [apiServiceId]: { source: { image: runtime } },
      [migratorServiceId]: { source: { image: runtime } },
      [frontendServiceId]: { source: { image: frontend } },
    },
  };
  assert.doesNotThrow(() => validateCoordinatedServiceSources(config, serviceIds));
  config.services[frontendServiceId].source.repo = "fluffyrabbot/fmarch";
  assert.throws(() => validateCoordinatedServiceSources(config, serviceIds), /must not retain/);
});

test("first coordinated production release permits only the canonical detachable Git source", () => {
  const config = {
    services: Object.fromEntries(
      [apiServiceId, migratorServiceId, frontendServiceId].map((serviceId) => [
        serviceId,
        { source: { image: null, repo: "fluffyrabbot/fmarch" } },
      ]),
    ),
  };
  assert.doesNotThrow(() => validateProductionSourceCutover(config, serviceIds));
  config.services[apiServiceId].source.repo = "attacker/fmarch";
  assert.throws(() => validateProductionSourceCutover(config, serviceIds), /safely detachable/);
});

test("hosted variables require isolated production identity credentials", () => {
  const stagingApi = {
    DATABASE_URL:
      "postgres://fmarch_application:staging-application-password-32-bytes@staging-db/fmarch?sslmode=require",
    FMARCH_AUTH_SOURCE_SIGNING_KEY: "staging-auth-source-key-at-least-32-bytes",
    FMARCH_AUTH_SOURCE_SIGNING_KID: "staging-auth-2026-08-04",
    FMARCH_EVENT_WRAP_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
    FMARCH_EVENT_WRAP_KID: "staging-wrap-v1",
    FMARCH_EVENT_ARCHIVE_KEY: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=",
    FMARCH_EVENT_ARCHIVE_KID: "staging-archive-v1",
    FMARCH_PROFILE_HANDLE_INDEX_KEY: "staging-profile-index-key-material-00000001",
    FMARCH_PROFILE_HANDLE_INDEX_KID: "staging-profile-index-v1",
    FMARCH_OBJECT_STORAGE_CREDENTIAL_KID: "staging-storage-2026-08-04",
    FMARCH_SUBJECT_AUTHORITY_ENDPOINT: "https://staging-subjects.example.test",
    FMARCH_SUBJECT_AUTHORITY_REGION: "auto",
    FMARCH_SUBJECT_AUTHORITY_BUCKET: "staging-subject-authority",
    FMARCH_SUBJECT_AUTHORITY_ACCESS_KEY_ID: "staging-subject-access",
    FMARCH_SUBJECT_AUTHORITY_SECRET_ACCESS_KEY: "staging-subject-secret",
    FMARCH_SUBJECT_AUTHORITY_ID: "11111111-1111-4111-8111-111111111111",
    FMARCH_SUBJECT_AUTHORITY_WRAP_KID: "staging-subject-wrap-v1",
    FMARCH_SUBJECT_AUTHORITY_WRAP_KEY: "BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU=",
    FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID: "staging-journal-v1",
    FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY: "BgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgY=",
    FMARCH_SUBJECT_KEY_AUTHORITY_REVISION: "staging-subjects-2026-08-13",
    FMARCH_WORKOS_CREDENTIAL_KID: "staging-workos-2026-08-04",
    AWS_ACCESS_KEY_ID: "staging-access-key",
    AWS_SECRET_ACCESS_KEY: "staging-secret-key",
    AWS_S3_BUCKET_NAME: "staging-media",
    FMARCH_CLASSIC_AUTH: "0",
    WORKOS_CLIENT_ID: "client_01STAGING00000000000000000",
    WORKOS_ISSUER:
      "https://api.workos.com/user_management/client_01STAGING00000000000000000",
    WORKOS_JWKS_URL:
      "https://api.workos.com/sso/jwks/client_01STAGING00000000000000000",
  };
  const stagingFrontend = {
    FMARCH_API_BASE_URL: "https://fmarch-staging.up.railway.app",
    FMARCH_API_INTERNAL_URL: "http://fmarch.railway.internal:8080",
    FMARCH_AUTH_SOURCE_SIGNING_KEY: "staging-auth-source-key-at-least-32-bytes",
    FMARCH_AUTH_SOURCE_SIGNING_KID: "staging-auth-2026-08-04",
    FMARCH_WORKOS_CREDENTIAL_KID: "staging-workos-2026-08-04",
    ORIGIN: "https://fmarch-frontend-staging.up.railway.app",
    WORKOS_CLIENT_ID: "client_01STAGING00000000000000000",
    WORKOS_API_KEY: "staging-key",
    WORKOS_COOKIE_PASSWORD: "rQ7!vM2#xL9@cP4$kN8%tH5&wD3*zF6?",
    WORKOS_REDIRECT_URI: "https://fmarch-frontend-staging.up.railway.app/auth/callback",
  };
  const stagingMigrator = {
    DATABASE_MIGRATION_URL:
      "postgres://postgres:staging-owner-password@staging-db/fmarch?sslmode=require",
    FMARCH_DATABASE_APPLICATION_PASSWORD: "staging-application-password-32-bytes",
    FMARCH_DATABASE_KEY_ADMIN_PASSWORD: "staging-key-admin-password-32-bytes-ok",
    FMARCH_DATABASE_AUTHORITY_REVISION: "staging-db-2026-08-14",
  };
  const productionApi = {
    DATABASE_URL:
      "postgres://fmarch_application:production-application-password-32-bytes@production-db/fmarch?sslmode=require",
    FMARCH_AUTH_SOURCE_SIGNING_KEY: "production-auth-source-key-at-least-32-bytes",
    FMARCH_AUTH_SOURCE_SIGNING_KID: "production-auth-2026-08-04",
    FMARCH_EVENT_WRAP_KEY: "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=",
    FMARCH_EVENT_WRAP_KID: "production-wrap-v1",
    FMARCH_EVENT_ARCHIVE_KEY: "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ=",
    FMARCH_EVENT_ARCHIVE_KID: "production-archive-v1",
    FMARCH_PROFILE_HANDLE_INDEX_KEY: "production-profile-index-key-material-000001",
    FMARCH_PROFILE_HANDLE_INDEX_KID: "production-profile-index-v1",
    FMARCH_OBJECT_STORAGE_CREDENTIAL_KID: "production-storage-2026-08-04",
    FMARCH_SUBJECT_AUTHORITY_ENDPOINT: "https://production-subjects.example.test",
    FMARCH_SUBJECT_AUTHORITY_REGION: "auto",
    FMARCH_SUBJECT_AUTHORITY_BUCKET: "production-subject-authority",
    FMARCH_SUBJECT_AUTHORITY_ACCESS_KEY_ID: "production-subject-access",
    FMARCH_SUBJECT_AUTHORITY_SECRET_ACCESS_KEY: "production-subject-secret",
    FMARCH_SUBJECT_AUTHORITY_ID: "22222222-2222-4222-8222-222222222222",
    FMARCH_SUBJECT_AUTHORITY_WRAP_KID: "production-subject-wrap-v1",
    FMARCH_SUBJECT_AUTHORITY_WRAP_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
    FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID: "production-journal-v1",
    FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY: "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg=",
    FMARCH_SUBJECT_KEY_AUTHORITY_REVISION: "production-subjects-2026-08-13",
    FMARCH_WORKOS_CREDENTIAL_KID: "production-workos-2026-08-04",
    AWS_ACCESS_KEY_ID: "production-access-key",
    AWS_SECRET_ACCESS_KEY: "production-secret-key",
    AWS_S3_BUCKET_NAME: "production-media",
    FMARCH_CLASSIC_AUTH: "0",
    WORKOS_CLIENT_ID: "client_01PRODUCTION000000000000000",
    WORKOS_ISSUER:
      "https://api.workos.com/user_management/client_01PRODUCTION000000000000000",
    WORKOS_JWKS_URL:
      "https://api.workos.com/sso/jwks/client_01PRODUCTION000000000000000",
  };
  const productionFrontend = {
    FMARCH_API_BASE_URL: "https://fmarch-production.up.railway.app",
    FMARCH_API_INTERNAL_URL: "http://fmarch.railway.internal:8080",
    FMARCH_AUTH_SOURCE_SIGNING_KEY: "production-auth-source-key-at-least-32-bytes",
    FMARCH_AUTH_SOURCE_SIGNING_KID: "production-auth-2026-08-04",
    FMARCH_WORKOS_CREDENTIAL_KID: "production-workos-2026-08-04",
    ORIGIN: "https://fmarch-frontend-production.up.railway.app",
    WORKOS_API_KEY: "production-key",
    WORKOS_CLIENT_ID: "client_01PRODUCTION000000000000000",
    WORKOS_COOKIE_PASSWORD: "Z4!mK8#qR2@vT7$hC9%pL5&xN3*wB6?Y",
    WORKOS_REDIRECT_URI:
      "https://fmarch-frontend-production.up.railway.app/auth/callback",
  };
  const productionMigrator = {
    DATABASE_MIGRATION_URL:
      "postgres://postgres:production-owner-password@production-db/fmarch?sslmode=require",
    FMARCH_DATABASE_APPLICATION_PASSWORD: "production-application-password-32-bytes",
    FMARCH_DATABASE_KEY_ADMIN_PASSWORD: "production-key-admin-password-32-bytes-ok",
    FMARCH_DATABASE_AUTHORITY_REVISION: "production-db-2026-08-14",
  };
  const ready = {
    stagingApi,
    stagingMigrator,
    stagingFrontend,
    productionApi,
    productionMigrator,
    productionFrontend,
  };
  assert.doesNotThrow(() => validateHostedVariables(ready));
  assert.doesNotThrow(() =>
    validateHostedVariables({
      ...ready,
      stagingFrontend: {
        ...stagingFrontend,
        WORKOS_COOKIE_PASSWORD: "A7!pQ2#vN9@xK4$hR8%mT5&cL3*zD6?Y",
      },
    }),
  );
  assert.doesNotThrow(() => validateDatabaseAuthorityVariables(ready));
  assert.doesNotThrow(() =>
    validateDatabaseAuthorityVariables({
      ...ready,
      stagingApi: {
        ...stagingApi,
        DATABASE_URL:
          "postgres://fmarch_application:staging-application-password-32-bytes@staging-db:5432/fmarch?sslmode=require",
      },
    }),
  );
  for (const secureMode of ["verify-ca", "verify-full"]) {
    assert.doesNotThrow(() =>
      validateDatabaseAuthorityVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          DATABASE_URL: productionApi.DATABASE_URL.replace(
            "sslmode=require",
            `sslmode=${secureMode}`,
          ),
        },
        productionMigrator: {
          ...productionMigrator,
          DATABASE_MIGRATION_URL:
            productionMigrator.DATABASE_MIGRATION_URL.replace(
              "sslmode=require",
              `sslmode=${secureMode}`,
            ),
        },
      }),
    );
  }
  for (const process of ["API", "migrator"]) {
    for (const insecureMode of [undefined, "prefer", "allow", "disable"]) {
      const sourceUrl =
        process === "API"
          ? productionApi.DATABASE_URL
          : productionMigrator.DATABASE_MIGRATION_URL;
      const rejectedUrl = sourceUrl.replace(
        /\?sslmode=require$/u,
        insecureMode === undefined ? "" : `?sslmode=${insecureMode}`,
      );
      const override =
        process === "API"
          ? {
              productionApi: { ...productionApi, DATABASE_URL: rejectedUrl },
            }
          : {
              productionMigrator: {
                ...productionMigrator,
                DATABASE_MIGRATION_URL: rejectedUrl,
              },
            };
      assert.throws(
        () => validateDatabaseAuthorityVariables({ ...ready, ...override }),
        insecureMode === undefined
          ? /must set exactly one explicit sslmode/
          : /sslmode must be require, verify-ca, or verify-full/,
        `${process} must reject sslmode=${insecureMode ?? "omitted"}`,
      );
    }
  }
  assert.throws(
    () =>
      validateDatabaseAuthorityVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          DATABASE_URL:
            "postgres://fmarch_application:production-application-password-32-bytes@STAGING-DB:5432/fmarch_production?sslmode=require",
        },
        productionMigrator: {
          ...productionMigrator,
          DATABASE_MIGRATION_URL:
            "postgres://postgres:production-owner-password@STAGING-DB:5432/fmarch_production?sslmode=require",
        },
      }),
    /separate PostgreSQL server endpoints because fixed database roles are cluster-global/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          DATABASE_MIGRATION_URL: productionMigrator.DATABASE_MIGRATION_URL,
        },
      }),
    /API must not receive DATABASE_MIGRATION_URL/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionMigrator: {
          ...productionMigrator,
          DATABASE_KEY_ADMIN_URL:
            "postgres://fmarch_key_admin:private@production-db/fmarch",
        },
      }),
    /migrator must not receive DATABASE_KEY_ADMIN_URL/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          DATABASE_URL:
            "postgres://postgres:owner@production-db/fmarch?sslmode=require",
        },
      }),
    /must use fmarch_application/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionMigrator: {
          ...productionMigrator,
          DATABASE_MIGRATION_URL:
            "postgres://postgres:production-application-password-32-bytes@production-db/fmarch?sslmode=require",
        },
      }),
    /schema-owner and application roles must use distinct passwords/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionMigrator: {
          ...productionMigrator,
          DATABASE_MIGRATION_URL:
            "postgres://postgres:production-key-admin-password-32-bytes-ok@production-db/fmarch?sslmode=require",
        },
      }),
    /schema-owner and key-admin roles must use distinct passwords/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          DATABASE_URL:
            "postgres://fmarch_application:production-application-password-32-bytes@wrong-db/fmarch?sslmode=require",
        },
      }),
    /must target the same database/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          DATABASE_URL: `${productionApi.DATABASE_URL}&options=-csearch_path%3Dpublic`,
        },
      }),
    /only one sslmode query option/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          DATABASE_URL: productionApi.DATABASE_URL.replace(
            "sslmode=require",
            "sslmode=verify-full",
          ),
        },
      }),
    /must use the same TLS mode/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          DATABASE_URL: `${productionApi.DATABASE_URL}#alternate-authority`,
        },
      }),
    /must not contain a URL fragment/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionMigrator: {
          ...productionMigrator,
          FMARCH_AUTH_SOURCE_SIGNING_KEY: "must-not-enter-migrator",
        },
      }),
    /migrator must not receive FMARCH_AUTH_SOURCE_SIGNING_KEY/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionFrontend: {
          ...productionFrontend,
          FMARCH_PROFILE_HANDLE_INDEX_KEY: productionApi.FMARCH_PROFILE_HANDLE_INDEX_KEY,
        },
      }),
    /frontend must not receive FMARCH_PROFILE_HANDLE_INDEX_KEY/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionMigrator: {
          ...productionMigrator,
          FMARCH_PROFILE_HANDLE_INDEX_KID: productionApi.FMARCH_PROFILE_HANDLE_INDEX_KID,
        },
      }),
    /migrator must not receive FMARCH_PROFILE_HANDLE_INDEX_KID/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          PGOPTIONS: "-c search_path=attacker,public",
        },
      }),
    /must not receive ambient PGOPTIONS/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionMigrator: {
          ...productionMigrator,
          PGCONNECT_TIMEOUT: "1",
        },
      }),
    /must not receive ambient PGCONNECT_TIMEOUT/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionFrontend: { ...productionFrontend, WORKOS_API_KEY: "staging-key" },
      }),
    /must not share the WorkOS API key/,
  );
  for (const [environment, value] of [
    ["staging", "too-short"],
    ["staging", "replace_me______________________"],
    ["staging", "example-cookie-ceremony-secret-000000"],
    ["production", "CHANGE-ME-WORKOS-COOKIE-SECRET-0000"],
    ["production", "workos_cookie_password____________"],
    ["production", "${{WORKOS_COOKIE_PASSWORD}}-000000"],
  ]) {
    const frontendKey = `${environment}Frontend`;
    assert.throws(
      () =>
        validateHostedVariables({
          ...ready,
          [frontendKey]: {
            ...ready[frontendKey],
            WORKOS_COOKIE_PASSWORD: value,
          },
        }),
      new RegExp(`${environment} WorkOS cookie password.*at least 32 characters`),
    );
  }
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: { ...productionApi, WORKOS_CLIENT_ID: undefined },
      }),
    /missing WORKOS_CLIENT_ID/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          FMARCH_EVENT_WRAP_KEY: "long-but-not-canonical-base64-key-material",
        },
      }),
    /canonical padded base64 encoding exactly 32 bytes/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          FMARCH_PROFILE_HANDLE_INDEX_KEY: "replace_me______________________",
        },
      }),
    /profile-handle index key.*at least 32 characters/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          WORKOS_CLIENT_ID: "client_01DIFFERENTPRODUCTION000000000",
        },
      }),
    /same WorkOS client/,
  );
  for (const [key, value, message] of [
    ["FMARCH_API_BASE_URL", "https://wrong-api.example.test", /canonical public API URL/],
    ["FMARCH_API_INTERNAL_URL", "https://attacker.example.test", /canonical private API URL/],
    ["ORIGIN", "https://wrong-frontend.example.test", /canonical origin/],
    [
      "WORKOS_REDIRECT_URI",
      "https://wrong-frontend.example.test/auth/callback",
      /canonical WorkOS callback/,
    ],
  ]) {
    assert.throws(
      () =>
        validateHostedVariables({
          ...ready,
          stagingFrontend: { ...stagingFrontend, [key]: value },
        }),
      message,
    );
  }
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionFrontend: {
          ...productionFrontend,
          FMARCH_API_INTERNAL_URL: "http://staging-api.railway.internal:8080",
        },
      }),
    /production frontend must use the canonical private API URL/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        stagingFrontend: {
          ...stagingFrontend,
          WORKOS_CLIENT_ID: "client_01DIFFERENTSTAGING00000000000",
        },
      }),
    /staging API and frontend must use the same WorkOS client/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: { ...productionApi, FMARCH_CLASSIC_AUTH: undefined },
      }),
    /missing FMARCH_CLASSIC_AUTH/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: { ...productionApi, FMARCH_CLASSIC_AUTH: "1" },
      }),
    /classic mode is missing FMARCH_IDENTITY_DELIVERY_ENDPOINT/,
  );
  assert.doesNotThrow(() =>
    validateHostedVariables({
      ...ready,
      productionApi: {
        ...productionApi,
        FMARCH_CLASSIC_AUTH: "1",
        FMARCH_IDENTITY_DELIVERY_ENDPOINT:
          "https://identity-delivery.example.test/v1/deliveries",
        FMARCH_IDENTITY_DELIVERY_PROVIDER_ID: "http-json",
        FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN: "production-delivery-token",
      },
    }),
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          FMARCH_CLASSIC_AUTH: "1",
          FMARCH_IDENTITY_DELIVERY_ENDPOINT:
            "http://identity-delivery.example.test/v1/deliveries",
          FMARCH_IDENTITY_DELIVERY_PROVIDER_ID: "http-json",
          FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN: "production-delivery-token",
        },
      }),
    /must use HTTPS/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID:
            productionApi.FMARCH_SUBJECT_AUTHORITY_WRAP_KID,
        },
      }),
    /subject wrapping and journal KIDs must be separate/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY:
            productionApi.FMARCH_SUBJECT_AUTHORITY_WRAP_KEY,
        },
      }),
    /subject wrapping and journal keys must decode to separate material/,
  );
});

test("secret custody policy names owners, consumers, rotation, and retirement", () => {
  const policy = {
    version: 2,
    environments: ["staging", "production"],
    rules: {
      environment_isolation_required: true,
      repository_secret_values_forbidden: true,
      rotation_marker_required: true,
      retirement_requires_successful_redeploy: true,
    },
    families: [
      [
        "database-authority",
        "FMARCH_DATABASE_APPLICATION_PASSWORD",
        "FMARCH_DATABASE_AUTHORITY_REVISION",
      ],
      ["auth-source-signing", "FMARCH_AUTH_SOURCE_SIGNING_KEY", "FMARCH_AUTH_SOURCE_SIGNING_KID"],
      ["event-runtime-wrap", "FMARCH_EVENT_WRAP_KEY", "FMARCH_EVENT_WRAP_KID"],
      ["event-archive", "FMARCH_EVENT_ARCHIVE_KEY", "FMARCH_EVENT_ARCHIVE_KID"],
      [
        "profile-handle-index",
        "FMARCH_PROFILE_HANDLE_INDEX_KEY",
        "FMARCH_PROFILE_HANDLE_INDEX_KID",
      ],
      ["object-storage", "AWS_SECRET_ACCESS_KEY", "FMARCH_OBJECT_STORAGE_CREDENTIAL_KID"],
      [
        "subject-key-authority",
        "FMARCH_SUBJECT_AUTHORITY_SECRET_ACCESS_KEY",
        "FMARCH_SUBJECT_KEY_AUTHORITY_REVISION",
      ],
      ["workos", "WORKOS_API_KEY", "FMARCH_WORKOS_CREDENTIAL_KID"],
    ].map(([id, secret, marker]) => ({
      id,
      owner: "release operator",
      custody: "external secret store",
      secret_variables: [secret],
      rotation_marker: marker,
      consumers: ["api"],
      rotation: "deploy the replacement, verify it, then retire the prior value",
    })),
  };
  assert.doesNotThrow(() => validateSecretCustodyPolicy(policy));
  assert.throws(
    () =>
      validateSecretCustodyPolicy({
        ...policy,
        families: policy.families.map((family) =>
          family.id === "workos" ? { ...family, rotation: "replace it" } : family,
        ),
      }),
    /rotation must include deployment/,
  );
});

test("deployment and domain checks require the promoted commit and active canonical host", () => {
  const deployment = { status: "SUCCESS", meta: { commitHash: "abc" } };
  assert.doesNotThrow(() => validateDeployment(deployment, "abc", "staging API"));
  assert.throws(() => validateDeployment({ ...deployment, status: "BUILDING" }, "abc", "API"));
  assert.throws(() => validateDeployment(deployment, "def", "API"), /promoted commit/);

  const domains = { domains: [{ domain: "fmarch-staging.up.railway.app", syncStatus: "ACTIVE" }] };
  assert.doesNotThrow(() =>
    validateDomainList(domains, "fmarch-staging.up.railway.app", "staging API"),
  );
  assert.throws(() => validateDomainList(domains, "wrong.example", "API"), /missing/);
});
