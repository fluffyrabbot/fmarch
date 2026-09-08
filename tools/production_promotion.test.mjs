import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  finalizeProductionPointer,
  revalidateCanonicalHostedVariables,
  revalidateCanonicalProductionHostedVariables,
  revalidatePromotionHostedVariables,
  parseArguments,
  productionPointerPushArguments,
  productionReceiptPathForLease,
  reconcilePromotionLockMutation,
  resumeProductionPromotionLock,
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
  withProductionPromotionLock,
} from "./production_promotion.mjs";
import { createProductionPromotionLockIntent } from "./release_git_authority.mjs";
import { revalidateProductionHostedVariableAuthority } from "./release_coordinator.mjs";
import { DATABASE_ONE_SHOT_TIMEOUT_VARIABLES } from "./release_coordinator_contract.mjs";

const canonicalProjectId = "9d285d67-c11b-4508-9efb-fad042787b4c";
const canonicalMigratorServiceId = "7c2c2665-2be2-4938-84e5-7580a964d610";

const apiServiceId = "api";
const migratorServiceId = "migrator";
const frontendServiceId = "frontend";
const serviceIds = { apiServiceId, migratorServiceId, frontendServiceId };

test("promotion arguments are fail closed", () => {
  assert.deepEqual(parseArguments([]), { checkOnly: false });
  assert.deepEqual(parseArguments(["--check"]), { checkOnly: true });
  assert.deepEqual(parseArguments(["--fleet-receipt", "receipt.json", "--fleet-job", "job"]), {
    checkOnly: false,
    fleetReceipt: "receipt.json",
    fleetJob: "job",
  });
  assert.deepEqual(parseArguments(["--resume-lock", "a".repeat(40)]), {
    checkOnly: false,
    resumeLock: "a".repeat(40),
  });
  assert.throws(() => parseArguments(["--force"]), /unknown production promotion argument/);
  assert.throws(() => parseArguments(["--fleet-receipt"]), /requires a value/);
  assert.throws(() => parseArguments(["--resume-lock", "main"]), /full lowercase Git SHA/);
  assert.throws(
    () => parseArguments(["--check", "--resume-lock", "a".repeat(40)]),
    /cannot adopt/,
  );
});

test("production promotion consumes the coordinated staging receipt", async () => {
  const source = await readFile(new URL("./production_promotion.mjs", import.meta.url), "utf8");
  const stagingReceipt = source.indexOf("const stagingReceipt = assertFreshStagingReleaseReceipt");
  const lock = source.indexOf("await withProductionPromotionLock");
  const stagingValidation = source.lastIndexOf("await validateCoordinatedEnvironment", lock);
  const receiptReplay = source.indexOf("if (existingProductionReceipt)");
  const coordinator = source.indexOf('"tools/release_coordinator.mjs"');
  const firstFreshValidation = source.indexOf(
    "await finalizeCanonicalProductionPointer",
  );
  const finalFreshValidation = source.lastIndexOf(
    "await finalizeCanonicalProductionPointer",
  );
  assert.equal(stagingReceipt >= 0, true);
  assert.equal(stagingValidation > stagingReceipt, true);
  assert.equal(lock > stagingValidation, true);
  assert.equal(receiptReplay > stagingValidation, true);
  assert.equal(receiptReplay > lock, true);
  assert.equal(firstFreshValidation > receiptReplay && firstFreshValidation < coordinator, true);
  assert.equal(coordinator > receiptReplay, true);
  assert.equal(coordinator > stagingValidation, true);
  assert.equal(finalFreshValidation > coordinator, true);
  assert.equal(source.includes('"proof:lanes"'), false);
  assert.equal(source.includes("disconnectProductionGitSources"), false);
  assert.match(source, /productionReceiptPathForLease/);
  assert.doesNotMatch(source, /FMARCH_PRODUCTION_RELEASE_RECEIPT/);
  assert.match(source, /existing production receipt was authorized by a different promotion lease/);
});

test("production pointer advancement is an exact expected-value CAS", () => {
  const commit = "a".repeat(40);
  const prior = "b".repeat(40);
  assert.deepEqual(productionPointerPushArguments(commit, prior), [
    `--force-with-lease=refs/heads/production:${prior}`,
    "https://github.com/fluffyrabbot/fmarch.git",
    `${commit}:refs/heads/production`,
  ]);
  assert.throws(() => productionPointerPushArguments("main", prior), /full lowercase Git SHA/);
});

test("production receipts are scoped to the exact lease for crash recovery", () => {
  const commit = "a".repeat(40);
  const firstLease = "b".repeat(40);
  const secondLease = "c".repeat(40);
  const first = productionReceiptPathForLease(commit, firstLease, "/release-root");
  const second = productionReceiptPathForLease(commit, secondLease, "/release-root");
  assert.equal(first, `/release-root/target/releases/production/${commit}.${firstLease}.json`);
  assert.notEqual(first, second);
});

test("production pointer refresh and CAS occur only after fresh live revalidation", async () => {
  const commit = "a".repeat(40);
  const prior = "b".repeat(40);
  const events = [];
  await finalizeProductionPointer({
    commit,
    expectedProductionCommit: prior,
    revalidateEvidence: async () => events.push("evidence"),
    revalidate: async () => events.push("live"),
    refreshProductionPointer: async () => {
      events.push("fetch");
      return prior;
    },
    pushPointer: async (arguments_) => {
      events.push("cas");
      assert.deepEqual(arguments_, productionPointerPushArguments(commit, prior));
    },
    assertLease: async () => events.push("lease"),
  });
  assert.deepEqual(events, ["evidence", "live", "fetch", "lease", "cas"]);
  await assert.rejects(
    finalizeProductionPointer({
      commit,
      expectedProductionCommit: prior,
      revalidate: async () => {},
      refreshProductionPointer: async () => "c".repeat(40),
      pushPointer: async () => assert.fail("CAS must not run after pointer drift"),
    }),
    /moved after promotion preflight/,
  );

  events.length = 0;
  await finalizeProductionPointer({
    commit,
    expectedProductionCommit: prior,
    pointerAlreadyAdvanced: true,
    revalidateEvidence: async () => events.push("evidence"),
    revalidate: async () => events.push("live"),
    refreshProductionPointer: async () => {
      events.push("fetch");
      return commit;
    },
    assertLease: async () => events.push("lease"),
    pushPointer: async () => assert.fail("an already-complete CAS must not be repeated"),
  });
  assert.deepEqual(events, ["evidence", "live", "fetch", "lease"]);
});

test("Railway commands always use the canonical explicit project", () => {
  assert.deepEqual(railwayArguments(canonicalProjectId, ["environment", "config", "--json"]), [
    "environment",
    "config",
    "--json",
    "--project",
    canonicalProjectId,
  ]);
  assert.throws(
    () => railwayArguments("attacker-project", ["environment", "config", "--json"]),
    /canonical release topology/,
  );
});

test("promotion pins the complete canonical Railway topology", () => {
  const configured = runtimeConfig({});
  assert.equal(configured.projectId, canonicalProjectId);
  assert.equal(configured.migratorServiceId, canonicalMigratorServiceId);
  assert.equal(configured.productionEnvironmentId, "c1378737-84cc-45ba-8474-9c868baf7cfb");
  assert.throws(
    () => runtimeConfig({ FMARCH_RAILWAY_MIGRATOR_SERVICE_ID: "11111111-2222-4333-8444-555555555555" }),
    /cannot override the canonical release topology/,
  );
});

test("production promotion lock releases only success and retains failures for exact resume", async () => {
  let owner = null;
  let releaseFirst;
  const acquire = async () => {
    assert.equal(owner, null, "promotion lock is held");
    owner = "token";
    return owner;
  };
  const release = async (token) => {
    assert.equal(token, owner);
    owner = null;
  };
  const first = withProductionPromotionLock(
    { acquire, release },
    async () => await new Promise((resolve) => {
      releaseFirst = resolve;
    }),
  );
  await Promise.resolve();
  await assert.rejects(
    withProductionPromotionLock({ acquire, release }, async () => {}),
    /promotion lock is held/,
  );
  releaseFirst();
  await first;
  await withProductionPromotionLock({ acquire, release }, async () => {});
  assert.equal(owner, null);

  await assert.rejects(
    withProductionPromotionLock({ acquire, release }, async () => {
      const timeout = new Error("subprocess timed out");
      timeout.code = "ETIMEDOUT";
      throw timeout;
    }),
    (error) => {
      assert.match(error.message, /timed out/);
      assert.match(error.message, /resume only with --resume-lock token/);
      assert.equal(error.promotionLockToken, "token");
      return true;
    },
  );
  assert.equal(owner, "token", "timeout must retain the exact promotion lease");
});

test("exact-token resume validates immutable intent and both unambiguous pointer states", () => {
  const commit = "a".repeat(40);
  const prior = "b".repeat(40);
  const token = "c".repeat(40);
  const fleetProof = {
    job_id: "job-123",
    receipt_sha256: "d".repeat(64),
  };
  const stagingReceipt = {
    receipt_sha256: "e".repeat(64),
    schema_epoch_reset: { epoch: 2 },
  };
  const leaseIntent = createProductionPromotionLockIntent({
    identity: "fmarch-production-promotion-00000000-0000-4000-8000-000000000000",
    releaseCommit: commit,
    expectedProductionCommit: prior,
    fleetJobId: fleetProof.job_id,
    fleetReceiptSha256: fleetProof.receipt_sha256,
    stagingReceiptSha256: stagingReceipt.receipt_sha256,
    schemaEpochReset: 2,
    createdAt: new Date("2026-09-07T12:00:00.000Z"),
  });
  let loaded = null;
  const options = {
    loadLease: (request) => {
      loaded = request;
      return leaseIntent;
    },
    loadCurrentProductionCommit: () => prior,
    isAncestor: (ancestor, descendant) => ancestor === prior && descendant === commit,
  };
  assert.deepEqual(
    resumeProductionPromotionLock({
      token,
      commit,
      fleetProof,
      stagingReceipt,
    }, options),
    { token, expectedProductionCommit: prior, pointerAlreadyAdvanced: false },
  );
  assert.deepEqual(loaded, { token, releaseCommit: commit });
  assert.deepEqual(
    resumeProductionPromotionLock(
      { token, commit, fleetProof, stagingReceipt },
      { ...options, loadCurrentProductionCommit: () => commit },
    ),
    { token, expectedProductionCommit: prior, pointerAlreadyAdvanced: true },
  );
  assert.throws(
    () => resumeProductionPromotionLock(
      { token, commit, fleetProof, stagingReceipt },
      { ...options, loadCurrentProductionCommit: () => "f".repeat(40) },
    ),
    /neither the promotion lock prior pointer nor its release commit/,
  );
  assert.throws(
    () => resumeProductionPromotionLock({
      token,
      commit,
      fleetProof,
      stagingReceipt: { ...stagingReceipt, receipt_sha256: "f".repeat(64) },
    }, options),
    /staging receipt drifted/,
  );
});

test("ambiguous promotion lock pushes reconcile only the exact intended state", () => {
  const token = "a".repeat(40);
  const timedOut = () => {
    const error = new Error("push timed out");
    error.code = "ETIMEDOUT";
    throw error;
  };
  assert.equal(
    reconcilePromotionLockMutation({
      operation: "acquire",
      token,
      mutate: timedOut,
      inspect: () => token,
    }),
    token,
  );
  assert.equal(
    reconcilePromotionLockMutation({
      operation: "release",
      token,
      mutate: timedOut,
      inspect: () => null,
    }),
    null,
  );
  assert.throws(
    () => reconcilePromotionLockMutation({
      operation: "release",
      token,
      mutate: timedOut,
      inspect: () => "b".repeat(40),
    }),
    /push timed out/,
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

  const resumeLock = "d".repeat(40);
  assert.doesNotThrow(() => validateRepositoryState({
    ...ready,
    branch: "",
    head: "old-release",
    originMain: "advanced-main",
    resumeLock,
    headIsAncestorOfOriginMain: true,
  }));
  assert.throws(
    () => validateRepositoryState({
      ...ready,
      branch: "recovery",
      head: "unpublished-release",
      originMain: "advanced-main",
      resumeLock,
      headIsAncestorOfOriginMain: false,
    }),
    /reachable from origin\/main/,
  );
  assert.throws(
    () => validateRepositoryState({
      ...ready,
      head: "old-release",
      originMain: "advanced-main",
    }),
    /HEAD must equal origin\/main/,
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
  config.services[frontendServiceId].source.image =
    `ghcr.io/attacker/fmarch-frontend@sha256:${"b".repeat(64)}`;
  assert.throws(
    () => validateCoordinatedServiceSources(config, serviceIds),
    /canonical digest-pinned OCI image/,
  );
  config.services[frontendServiceId].source.image = frontend;
  config.services[frontendServiceId].source.repo = "fluffyrabbot/fmarch";
  assert.throws(() => validateCoordinatedServiceSources(config, serviceIds), /must not retain/);
});

test("production source validation accepts safe mixed and interrupted cutover states", () => {
  const config = {
    services: Object.fromEntries(
      [apiServiceId, migratorServiceId, frontendServiceId].map((serviceId) => [
        serviceId,
        { source: { image: null, repo: "fluffyrabbot/fmarch" } },
      ]),
    ),
  };
  assert.doesNotThrow(() => validateProductionSourceCutover(config, serviceIds));
  config.services[apiServiceId].source = null;
  config.services[migratorServiceId].source = {
    repo: null,
    image: `ghcr.io/fluffyrabbot/fmarch-runtime@sha256:${"a".repeat(64)}`,
  };
  assert.doesNotThrow(() => validateProductionSourceCutover(config, serviceIds));
  config.services[apiServiceId].source = { repo: "attacker/fmarch", image: null };
  assert.throws(() => validateProductionSourceCutover(config, serviceIds), /safely detachable/);
});

test("hosted variables require isolated production identity credentials", async () => {
  const stagingApi = {
    DATABASE_URL:
      "postgres://fmarch_application:staging-application-password-32-bytes@staging-db/fmarch?sslmode=require",
    FMARCH_DATABASE_PROJECT_ID: canonicalProjectId,
    FMARCH_DATABASE_ENVIRONMENT_ID: "e109e500-2a4c-48a3-96f2-e92a9edb63e4",
    FMARCH_DATABASE_ENVIRONMENT: "staging",
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
    FMARCH_MEDIA_READ_MAX_IN_FLIGHT: "16",
    FMARCH_MEDIA_READ_MAX_IN_FLIGHT_BYTES: "67108864",
    FMARCH_HTTP_REQUEST_TIMEOUT_MS: "40000",
    FMARCH_SHUTDOWN_DRAIN_TIMEOUT_MS: "45000",
    FMARCH_CLASSIC_AUTH: "0",
    FMARCH_IDENTITY_DELIVERY_ENDPOINT:
      "https://identity-delivery.staging.fmarch.app/v1/deliveries",
    FMARCH_IDENTITY_DELIVERY_PROVIDER_ID: "staging-mail-v1",
    FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN:
      "staging-identity-delivery-token-material-0001",
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
    FMARCH_DATABASE_PROJECT_ID: canonicalProjectId,
    FMARCH_DATABASE_ENVIRONMENT_ID: "e109e500-2a4c-48a3-96f2-e92a9edb63e4",
    FMARCH_DATABASE_ENVIRONMENT: "staging",
    ...DATABASE_ONE_SHOT_TIMEOUT_VARIABLES,
  };
  const productionApi = {
    DATABASE_URL:
      "postgres://fmarch_application:production-application-password-32-bytes@production-db/fmarch?sslmode=require",
    FMARCH_DATABASE_PROJECT_ID: canonicalProjectId,
    FMARCH_DATABASE_ENVIRONMENT_ID: "c1378737-84cc-45ba-8474-9c868baf7cfb",
    FMARCH_DATABASE_ENVIRONMENT: "production",
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
    FMARCH_MEDIA_READ_MAX_IN_FLIGHT: "16",
    FMARCH_MEDIA_READ_MAX_IN_FLIGHT_BYTES: "67108864",
    FMARCH_HTTP_REQUEST_TIMEOUT_MS: "40000",
    FMARCH_SHUTDOWN_DRAIN_TIMEOUT_MS: "45000",
    FMARCH_CLASSIC_AUTH: "0",
    FMARCH_IDENTITY_DELIVERY_ENDPOINT:
      "https://identity-delivery.production.fmarch.app/v1/deliveries",
    FMARCH_IDENTITY_DELIVERY_PROVIDER_ID: "production-mail-v1",
    FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN:
      "production-identity-delivery-token-material-01",
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
    FMARCH_DATABASE_PROJECT_ID: canonicalProjectId,
    FMARCH_DATABASE_ENVIRONMENT_ID: "c1378737-84cc-45ba-8474-9c868baf7cfb",
    FMARCH_DATABASE_ENVIRONMENT: "production",
    ...DATABASE_ONE_SHOT_TIMEOUT_VARIABLES,
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
  for (const key of Object.keys(DATABASE_ONE_SHOT_TIMEOUT_VARIABLES)) {
    assert.throws(
      () => validateHostedVariables({
        ...ready,
        productionMigrator: { ...productionMigrator, [key]: "1" },
      }),
      new RegExp(`canonical ${key}`),
    );
  }
  assert.throws(
    () => validateHostedVariables({
      ...ready,
      productionApi: {
        ...productionApi,
        FMARCH_DB_OPERATION_TIMEOUT_MS: "600000",
      },
    }),
    /production API must not receive FMARCH_DB_OPERATION_TIMEOUT_MS/,
  );
  const config = runtimeConfig();
  let current = ready;
  const load = async (_config, environmentId, serviceId) => {
    const environment = environmentId === config.stagingEnvironmentId ? "staging" : "production";
    const process = serviceId === config.apiServiceId
      ? "Api"
      : serviceId === config.migratorServiceId
        ? "Migrator"
        : "Frontend";
    return current[`${environment}${process}`];
  };
  await assert.doesNotReject(revalidateCanonicalHostedVariables(config, { load }));
  const productionLoads = [];
  const productionOnlyLoad = async (_config, environmentId, serviceId) => {
    assert.equal(
      environmentId,
      config.productionEnvironmentId,
      "resume must never load mutable staging variables",
    );
    productionLoads.push(serviceId);
    const process = serviceId === config.apiServiceId
      ? "Api"
      : serviceId === config.migratorServiceId
        ? "Migrator"
        : "Frontend";
    return ready[`production${process}`];
  };
  await assert.doesNotReject(
    revalidateCanonicalProductionHostedVariables(config, { load: productionOnlyLoad }),
  );
  await assert.doesNotReject(
    revalidatePromotionHostedVariables(
      config,
      { resumeLock: "a".repeat(40) },
      { load: productionOnlyLoad },
    ),
  );
  await assert.doesNotReject(
    revalidateProductionHostedVariableAuthority(config, { load: productionOnlyLoad }),
  );
  await assert.rejects(
    revalidatePromotionHostedVariables(config, {}, { load: productionOnlyLoad }),
    /resume must never load mutable staging variables/,
  );
  assert.deepEqual(
    new Set(productionLoads),
    new Set([config.apiServiceId, config.migratorServiceId, config.frontendServiceId]),
  );
  const productionDriftLoad = async (_config, environmentId, serviceId) => {
    const variables = await productionOnlyLoad(_config, environmentId, serviceId);
    return serviceId === config.apiServiceId
      ? { ...variables, FMARCH_DATABASE_ENVIRONMENT: "staging" }
      : variables;
  };
  await assert.rejects(
    revalidateCanonicalProductionHostedVariables(config, {
      load: productionDriftLoad,
    }),
    /production API database environment identity drifted/,
  );
  await assert.rejects(
    revalidateProductionHostedVariableAuthority(config, { load: productionDriftLoad }),
    /production API database environment identity drifted/,
  );
  current = {
    ...ready,
    productionApi: {
      ...productionApi,
      DATABASE_URL:
        "postgres://fmarch_application:production-application-password-32-bytes@staging-db/fmarch?sslmode=require",
    },
  };
  await assert.rejects(
    revalidateCanonicalHostedVariables(config, { load }),
    /application and migration URLs must target the same database/,
  );
  assert.throws(
    () => validateHostedVariables({
      ...ready,
      productionMigrator: {
        ...productionMigrator,
        FMARCH_DATABASE_ENVIRONMENT_ID: stagingMigrator.FMARCH_DATABASE_ENVIRONMENT_ID,
      },
    }),
    /production migrator database environment UUID drifted/,
  );
  for (const frontend of ["stagingFrontend", "productionFrontend"]) {
    assert.throws(
      () =>
        validateHostedVariables({
          ...ready,
          [frontend]: {
            ...ready[frontend],
            FMARCH_FRONTEND_FIXTURE_SESSION: "1",
          },
        }),
      /must not enable fixture sessions/,
    );
  }
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
  for (const key of [
    "FMARCH_IDENTITY_DELIVERY_ENDPOINT",
    "FMARCH_IDENTITY_DELIVERY_PROVIDER_ID",
    "FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN",
  ]) {
    assert.throws(
      () =>
        validateHostedVariables({
          ...ready,
          productionApi: {
            ...productionApi,
            [key]: undefined,
          },
        }),
      new RegExp(`identity delivery is missing ${key}`),
    );
  }
  assert.doesNotThrow(() =>
    validateHostedVariables({
      ...ready,
      productionApi: {
        ...productionApi,
        FMARCH_CLASSIC_AUTH: "1",
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
          FMARCH_IDENTITY_DELIVERY_ENDPOINT: "https://host/path?token=x",
        },
      }),
    /without embedded credentials, query strings, or fragments/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          FMARCH_IDENTITY_DELIVERY_ENDPOINT:
            "https://provider.example.test/v1/deliveries",
        },
      }),
    /must be a real hosted HTTPS URL/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN: "replace_me",
        },
      }),
    /identity-delivery authentication token must be a non-placeholder value of at least 32 characters/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          FMARCH_IDENTITY_DELIVERY_PROVIDER_ID: "http-json",
        },
      }),
    /provider id must name a versioned, environment-specific generation instead of a generic adapter/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          FMARCH_IDENTITY_DELIVERY_PROVIDER_ID:
            stagingApi.FMARCH_IDENTITY_DELIVERY_PROVIDER_ID,
        },
      }),
    /must not share the identity-delivery provider generation/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN:
            stagingApi.FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN,
        },
      }),
    /must not share the identity-delivery authentication token/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionFrontend: {
          ...productionFrontend,
          FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN:
            productionApi.FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN,
        },
      }),
    /production frontend must not receive FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN/,
  );
  const invalidIdentityDeliveryRanges = [
    ["FMARCH_IDENTITY_DELIVERY_CONNECT_TIMEOUT_MS", ["0", "120001"]],
    ["FMARCH_IDENTITY_DELIVERY_RESPONSE_TIMEOUT_MS", ["0", "120001"]],
    ["FMARCH_IDENTITY_DELIVERY_BODY_TIMEOUT_MS", ["0", "120001"]],
    ["FMARCH_IDENTITY_DELIVERY_TOTAL_TIMEOUT_MS", ["0", "120001"]],
    ["FMARCH_IDENTITY_DELIVERY_MAX_RESPONSE_BYTES", ["0", "1048577"]],
    ["FMARCH_IDENTITY_DELIVERY_MAX_CONCURRENCY", ["0", "65"]],
    ["FMARCH_IDENTITY_DELIVERY_POLL_INTERVAL_MS", ["0", "60001"]],
    ["FMARCH_IDENTITY_DELIVERY_CLAIM_LEASE_MS", ["1999", "300001"]],
    ["FMARCH_IDENTITY_DELIVERY_PROVIDER_CLOCK_SKEW_MARGIN_MS", ["999", "60001"]],
    ["FMARCH_IDENTITY_DELIVERY_PROVIDER_TIMEOUT_MS", ["0", "120001"]],
    ["FMARCH_IDENTITY_DELIVERY_DATABASE_TIMEOUT_MS", ["0", "120001"]],
    ["FMARCH_IDENTITY_DELIVERY_RETRY_BASE_SECONDS", ["0", "86401"]],
    ["FMARCH_IDENTITY_DELIVERY_RETRY_MAX_SECONDS", ["0", "86401"]],
    ["FMARCH_IDENTITY_DELIVERY_MAX_ATTEMPTS", ["0", "101"]],
  ];
  for (const [key, invalidValues] of invalidIdentityDeliveryRanges) {
    for (const value of invalidValues) {
      assert.throws(
        () =>
          validateHostedVariables({
            ...ready,
            productionApi: { ...productionApi, [key]: value },
          }),
        new RegExp(`${key} must be between`),
        `${key} must reject ${value}`,
      );
    }
  }
  const invalidIdentityDeliveryRelations = [
    [
      { FMARCH_IDENTITY_DELIVERY_CONNECT_TIMEOUT_MS: "3001" },
      /connect deadline must not exceed the response deadline/,
    ],
    [
      { FMARCH_IDENTITY_DELIVERY_RESPONSE_TIMEOUT_MS: "4001" },
      /total deadline must cover the response and body deadlines/,
    ],
    [
      { FMARCH_IDENTITY_DELIVERY_TOTAL_TIMEOUT_MS: "10001" },
      /HTTP total timeout must not exceed the provider timeout/,
    ],
    [
      { FMARCH_IDENTITY_DELIVERY_CLAIM_LEASE_MS: "34000" },
      /claim lease and provider clock-skew margin must use whole seconds/,
    ],
    [
      { FMARCH_IDENTITY_DELIVERY_CLAIM_LEASE_MS: "29000" },
      /claim lease and provider clock-skew margin must use whole seconds/,
    ],
    [
      { FMARCH_IDENTITY_DELIVERY_PROVIDER_CLOCK_SKEW_MARGIN_MS: "5500" },
      /claim lease and provider clock-skew margin must use whole seconds/,
    ],
    [
      { FMARCH_IDENTITY_DELIVERY_RETRY_BASE_SECONDS: "301" },
      /retry bounds must be whole-second values with 1s <= base <= max <= 24h/,
    ],
    [
      { FMARCH_IDENTITY_DELIVERY_DATABASE_TIMEOUT_MS: "5250" },
      /database timeout must cover one bounded database acquire and statement/,
    ],
  ];
  for (const [overrides, message] of invalidIdentityDeliveryRelations) {
    assert.throws(
      () =>
        validateHostedVariables({
          ...ready,
          productionApi: { ...productionApi, ...overrides },
        }),
      message,
    );
  }
  assert.doesNotThrow(() =>
    validateHostedVariables({
      ...ready,
      productionApi: {
        ...productionApi,
        FMARCH_DB_MAX_CONNECTIONS: "5",
        FMARCH_AUTHORITY_TRANSACTION_MAX_IN_FLIGHT: "2",
        FMARCH_IDENTITY_DELIVERY_MAX_CONCURRENCY: "64",
      },
    }),
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          FMARCH_HTTP_REQUEST_TIMEOUT_MS: "39250",
        },
      }),
    /must exceed one database acquisition, both request-authentication statements, the complete identity delivery claim, preparation, provider, and finalization budget/,
  );
  assert.doesNotThrow(() =>
    validateHostedVariables({
      ...ready,
      productionApi: {
        ...productionApi,
        FMARCH_HTTP_REQUEST_TIMEOUT_MS: "39251",
        FMARCH_SHUTDOWN_DRAIN_TIMEOUT_MS: "40252",
      },
    }),
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: {
          ...productionApi,
          FMARCH_SHUTDOWN_DRAIN_TIMEOUT_MS: "41000",
        },
      }),
    /FMARCH_SHUTDOWN_DRAIN_TIMEOUT_MS must exceed FMARCH_HTTP_REQUEST_TIMEOUT_MS plus a one-second process-drain margin/,
  );
  assert.doesNotThrow(() =>
    validateHostedVariables({
      ...ready,
      productionApi: {
        ...productionApi,
        FMARCH_SHUTDOWN_DRAIN_TIMEOUT_MS: "41001",
      },
    }),
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
