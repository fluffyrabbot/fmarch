import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArguments,
  localProofRuntime,
  railwayArguments,
  validateDeployment,
  validateDomainList,
  validateHostedVariables,
  validateRepositoryState,
  validateSecretCustodyPolicy,
  validateServiceBranches,
} from "./production_promotion.mjs";

const apiServiceId = "api";
const frontendServiceId = "frontend";
const serviceIds = { apiServiceId, frontendServiceId };

test("promotion arguments are fail closed", () => {
  assert.deepEqual(parseArguments([]), { checkOnly: false });
  assert.deepEqual(parseArguments(["--check"]), { checkOnly: true });
  assert.throws(() => parseArguments(["--force"]), /unknown production promotion argument/);
});

test("promotion proof preserves an explicit database or provisions the repo-local default", () => {
  const explicit = localProofRuntime({ DATABASE_URL: "postgres://explicit/db", KEEP: "yes" });
  assert.equal(explicit.startLocalPostgres, false);
  assert.equal(explicit.env.DATABASE_URL, "postgres://explicit/db");
  assert.equal(explicit.env.KEEP, "yes");

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

test("Railway services must watch the environment's canonical branch", () => {
  const config = {
    services: {
      [apiServiceId]: { source: { branch: "production" } },
      [frontendServiceId]: { source: { branch: "production" } },
    },
  };
  assert.doesNotThrow(() => validateServiceBranches(config, "production", serviceIds));
  config.services[frontendServiceId].source.branch = "main";
  assert.throws(() => validateServiceBranches(config, "production", serviceIds), /must watch/);
});

test("hosted variables require isolated production identity credentials", () => {
  const stagingApi = {
    FMARCH_AUTH_SOURCE_SIGNING_KEY: "staging-auth-source-key-at-least-32-bytes",
    FMARCH_AUTH_SOURCE_SIGNING_KID: "staging-auth-2026-08-04",
    FMARCH_EVENT_ENCRYPTION_KEY: "staging-event-key-at-least-32-bytes",
    FMARCH_EVENT_ENCRYPTION_KID: "staging-v1",
    FMARCH_OBJECT_STORAGE_CREDENTIAL_KID: "staging-storage-2026-08-04",
    FMARCH_SUBJECT_AUTHORITY_ENDPOINT: "https://staging-subjects.example.test",
    FMARCH_SUBJECT_AUTHORITY_REGION: "auto",
    FMARCH_SUBJECT_AUTHORITY_BUCKET: "staging-subject-authority",
    FMARCH_SUBJECT_AUTHORITY_ACCESS_KEY_ID: "staging-subject-access",
    FMARCH_SUBJECT_AUTHORITY_SECRET_ACCESS_KEY: "staging-subject-secret",
    FMARCH_SUBJECT_AUTHORITY_ID: "11111111-1111-4111-8111-111111111111",
    FMARCH_SUBJECT_AUTHORITY_WRAP_KID: "staging-wrap-v1",
    FMARCH_SUBJECT_AUTHORITY_WRAP_KEY: "staging-wrap-secret",
    FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID: "staging-journal-v1",
    FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY: "staging-journal-secret",
    FMARCH_SUBJECT_KEY_AUTHORITY_REVISION: "staging-subjects-2026-08-13",
    FMARCH_WORKOS_CREDENTIAL_KID: "staging-workos-2026-08-04",
    AWS_ACCESS_KEY_ID: "staging-access-key",
    AWS_SECRET_ACCESS_KEY: "staging-secret-key",
    AWS_S3_BUCKET_NAME: "staging-media",
    FMARCH_CLASSIC_AUTH: "0",
    WORKOS_CLIENT_ID: "staging-client",
    WORKOS_ISSUER: "https://api.workos.com/user_management/staging",
    WORKOS_JWKS_URL: "https://api.workos.com/sso/jwks/staging",
  };
  const stagingFrontend = {
    FMARCH_AUTH_SOURCE_SIGNING_KEY: "staging-auth-source-key-at-least-32-bytes",
    FMARCH_AUTH_SOURCE_SIGNING_KID: "staging-auth-2026-08-04",
    FMARCH_WORKOS_CREDENTIAL_KID: "staging-workos-2026-08-04",
    WORKOS_CLIENT_ID: "staging-client",
    WORKOS_API_KEY: "staging-key",
    WORKOS_COOKIE_PASSWORD: "staging-cookie-password-at-least-32-bytes",
  };
  const productionApi = {
    DATABASE_URL: "postgres://postgres.railway.internal/db",
    FMARCH_AUTH_SOURCE_SIGNING_KEY: "production-auth-source-key-at-least-32-bytes",
    FMARCH_AUTH_SOURCE_SIGNING_KID: "production-auth-2026-08-04",
    FMARCH_EVENT_ENCRYPTION_KEY: "production-event-key-at-least-32-bytes",
    FMARCH_EVENT_ENCRYPTION_KID: "production-v1",
    FMARCH_OBJECT_STORAGE_CREDENTIAL_KID: "production-storage-2026-08-04",
    FMARCH_SUBJECT_AUTHORITY_ENDPOINT: "https://production-subjects.example.test",
    FMARCH_SUBJECT_AUTHORITY_REGION: "auto",
    FMARCH_SUBJECT_AUTHORITY_BUCKET: "production-subject-authority",
    FMARCH_SUBJECT_AUTHORITY_ACCESS_KEY_ID: "production-subject-access",
    FMARCH_SUBJECT_AUTHORITY_SECRET_ACCESS_KEY: "production-subject-secret",
    FMARCH_SUBJECT_AUTHORITY_ID: "22222222-2222-4222-8222-222222222222",
    FMARCH_SUBJECT_AUTHORITY_WRAP_KID: "production-wrap-v1",
    FMARCH_SUBJECT_AUTHORITY_WRAP_KEY: "production-wrap-secret",
    FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID: "production-journal-v1",
    FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY: "production-journal-secret",
    FMARCH_SUBJECT_KEY_AUTHORITY_REVISION: "production-subjects-2026-08-13",
    FMARCH_WORKOS_CREDENTIAL_KID: "production-workos-2026-08-04",
    AWS_ACCESS_KEY_ID: "production-access-key",
    AWS_SECRET_ACCESS_KEY: "production-secret-key",
    AWS_S3_BUCKET_NAME: "production-media",
    FMARCH_CLASSIC_AUTH: "0",
    WORKOS_CLIENT_ID: "production-client",
    WORKOS_ISSUER: "https://api.workos.com/user_management/production",
    WORKOS_JWKS_URL: "https://api.workos.com/sso/jwks/production",
  };
  const productionFrontend = {
    FMARCH_API_BASE_URL: "https://fmarch-production.up.railway.app",
    FMARCH_API_INTERNAL_URL: "http://fmarch.railway.internal:4000",
    FMARCH_AUTH_SOURCE_SIGNING_KEY: "production-auth-source-key-at-least-32-bytes",
    FMARCH_AUTH_SOURCE_SIGNING_KID: "production-auth-2026-08-04",
    FMARCH_WORKOS_CREDENTIAL_KID: "production-workos-2026-08-04",
    ORIGIN: "https://fmarch-frontend-production.up.railway.app",
    WORKOS_API_KEY: "production-key",
    WORKOS_CLIENT_ID: "production-client",
    WORKOS_COOKIE_PASSWORD: "production-cookie-password-at-least-32-bytes",
    WORKOS_REDIRECT_URI:
      "https://fmarch-frontend-production.up.railway.app/auth/callback",
  };
  const ready = { stagingApi, stagingFrontend, productionApi, productionFrontend };
  assert.doesNotThrow(() => validateHostedVariables(ready));
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionFrontend: { ...productionFrontend, WORKOS_API_KEY: "staging-key" },
      }),
    /must not share the WorkOS API key/,
  );
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
        productionApi: { ...productionApi, WORKOS_CLIENT_ID: "different-production-client" },
      }),
    /same WorkOS client/,
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
});

test("secret custody policy names owners, consumers, rotation, and retirement", () => {
  const policy = {
    version: 1,
    environments: ["staging", "production"],
    rules: {
      environment_isolation_required: true,
      repository_secret_values_forbidden: true,
      rotation_marker_required: true,
      retirement_requires_successful_redeploy: true,
    },
    families: [
      ["auth-source-signing", "FMARCH_AUTH_SOURCE_SIGNING_KEY", "FMARCH_AUTH_SOURCE_SIGNING_KID"],
      ["event-encryption", "FMARCH_EVENT_ENCRYPTION_KEY", "FMARCH_EVENT_ENCRYPTION_KID"],
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
