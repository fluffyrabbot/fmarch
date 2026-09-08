import assert from "node:assert/strict";
import test from "node:test";

import {
  assertGameDayReceipt,
  buildGameDayReceipt,
  REQUIRED_RELEASE_GAMEDAY_SCENARIOS,
  validateGameDayInputs,
} from "./release_gameday_contract.mjs";
import {
  createGameDayDatabaseOneShotRunner,
  gameDayOutputPath,
  parseArguments,
  recoverCurrentRelease,
  revalidateCompletedGameDayState,
  gameDayOneShotVariables,
  withGameDayMutationAuthority,
} from "./release_gameday.mjs";
import {
  bindReleaseAttempt,
  buildReleaseReceipt,
  receiptDigest,
} from "./release_coordinator_contract.mjs";

const runtimeDigest = `sha256:${"a".repeat(64)}`;
const frontendDigest = `sha256:${"b".repeat(64)}`;
const priorRuntimeDigest = `sha256:${"c".repeat(64)}`;
const priorFrontendDigest = `sha256:${"d".repeat(64)}`;
const currentCommit = "1".repeat(40);
const priorCommit = "2".repeat(40);
const currentReleaseLease = "7".repeat(40);
const priorReleaseLease = "8".repeat(40);
const gameDayLeaseToken = "9".repeat(40);
const gameDayLease = {
  token: gameDayLeaseToken,
  releaseCommit: currentCommit,
  operationKind: "release-game-day",
  bindings: {},
  resumed: false,
};

test("game-day receipts always use the canonical lease-scoped output path", () => {
  assert.throws(
    () => parseArguments(["--output", "custom-game-day.json"]),
    /does not accept --output/,
  );
  assert.match(
    gameDayOutputPath({ commit: currentCommit }, gameDayLease),
    new RegExp(`${currentCommit}\\.${gameDayLeaseToken}\\.game-day\\.json$`, "u"),
  );
});

test("game-day cleanup resolves an outcome-unknown exact one-shot before restore dispatch", async () => {
  const events = [];
  const receipt = {
    commit: currentCommit,
    receipt_sha256: "e".repeat(64),
    images: { runtime: runtimeDigest },
  };
  let active = null;
  const activeOperations = {
    loadActive: async () => structuredClone(active),
    publishActive: async (_receipt, value) => {
      assert.equal(active, null, "active one-shot fence must be exclusive");
      active = structuredClone(value);
    },
    finishActive: async (_receipt, expected, result) => {
      assert.equal(active.receipt_sha256, expected.receipt_sha256);
      assert.equal(result.deployment.id, "exact-deployment");
      active = null;
    },
  };
  const interruptedProcess = createGameDayDatabaseOneShotRunner({
    stagingMutationLease: gameDayLease,
    ...activeOperations,
    runOneShot: async () => {
      events.push("v2-response-lost");
      throw new Error("injected lost Railway V2 response");
    },
  });

  await assert.rejects(
    interruptedProcess.run({ receipt, scenario: "delayed-migrator", startCommand: "fmarch-migrate" }),
    /lost Railway V2 response/,
  );
  assert.ok(active, "hard-crash recovery requires a durable active-operation fence");

  const restartedProcess = createGameDayDatabaseOneShotRunner({
    stagingMutationLease: { ...gameDayLease, resumed: true },
    ...activeOperations,
    runOneShot: async () => {
      events.push("exact-operation-adopted");
      return {
        deployment: { id: "exact-deployment" },
        intent: { operation_id: "f".repeat(64) },
      };
    },
  });
  await restartedProcess.resumePending(receipt);
  events.push("restore-migrator-dispatched");

  assert.deepEqual(events, [
    "v2-response-lost",
    "exact-operation-adopted",
    "restore-migrator-dispatched",
  ]);
  assert.equal(
    await restartedProcess.resumePending(receipt),
    null,
    "resolved operation must not be replayed",
  );
});

test("game-day one-shots inject canonical database identity and maintenance deadlines", () => {
  assert.deepEqual(gameDayOneShotVariables(), {
    FMARCH_DATABASE_ENVIRONMENT: "staging",
    FMARCH_DATABASE_PROJECT_ID: "9d285d67-c11b-4508-9efb-fad042787b4c",
    FMARCH_DATABASE_ENVIRONMENT_ID: "e109e500-2a4c-48a3-96f2-e92a9edb63e4",
    FMARCH_DB_ACQUIRE_TIMEOUT_MS: "30000",
    FMARCH_DB_LOCK_TIMEOUT_MS: "60000",
    FMARCH_DB_STATEMENT_TIMEOUT_MS: "300000",
    FMARCH_DB_OPERATION_TIMEOUT_MS: "600000",
  });
});

test("game-day recovery restores serving applications before one-shot reconciliation", async () => {
  const events = [];
  const oneShots = {
    resumePending: async () => {
      events.push("resume-pending-one-shot");
      throw new Error("outcome unknown");
    },
  };
  await assert.rejects(
    recoverCurrentRelease(
      { commit: currentCommit },
      oneShots,
      gameDayLease,
      {
        restoreApplication: async () => events.push("restore-application"),
        restoreMigrator: async () => events.push("restore-migrator"),
      },
    ),
    /outcome unknown/,
  );
  assert.deepEqual(events, ["restore-application", "resume-pending-one-shot"]);
});

test("game-day mutations revalidate the exact shared lease before every write", async () => {
  const events = [];
  const verification = {
    assertLease: async (lease) => {
      assert.equal(lease, gameDayLease);
      events.push("lease");
    },
  };
  await withGameDayMutationAuthority(
    gameDayLease,
    async () => events.push("mutation-1"),
    verification,
  );
  await withGameDayMutationAuthority(
    gameDayLease,
    async () => events.push("mutation-2"),
    verification,
  );
  assert.deepEqual(events, ["lease", "mutation-1", "lease", "mutation-2"]);
});

function fleetProof(commit, id) {
  return {
    version: 1,
    kind: "fmarch-fleet-release-proof",
    job_id: id,
    task_id: id,
    host: "cachy",
    repository: "fmarch",
    platform: "linux",
    verification_mode: "audit",
    commit,
    comparison_commit: "3".repeat(40),
    remote_ref: `release/${id}`,
    completed_at: "2026-08-27T00:00:00.000Z",
    trust_root_sha256: "a".repeat(64),
    receipt_sha256: "b".repeat(64),
  };
}

function runtimeValidation(runtime) {
  return {
    status: "passed",
    policy: "immutable-linux-amd64-runtime-v1",
    runtime_reference: `ghcr.io/fluffyrabbot/fmarch-runtime@${runtime}`,
    runtime_digest: runtime,
    platform: "linux/amd64",
    runtime_uid: 10001,
    binary_inventory: [
      "fmarch-server",
      "fmarch-migrate",
      "fmarch-schema-gate",
      "fmarch-schema-epoch-reset",
      "fmarch-staging-search-corpus",
      "fmarch-event-key-admin",
      "fmarch-profile-index-admin",
    ],
    runtime_content_directories: false,
    registry_hash: "c".repeat(64),
    host_registry_hash: "c".repeat(64),
    validation_report_sha256: "d".repeat(64),
  };
}

function releaseReceipt(commit, runtime, frontend, id) {
  const proof = fleetProof(commit, `${id}-proof`);
  return buildReleaseReceipt({
    environment: "staging",
    commit,
    runtimeDigest: runtime,
    frontendDigest: frontend,
    deployments: {
      migrator: { id: `${id}-m`, status: "SUCCESS", meta: { imageDigest: runtime } },
      api: { id: `${id}-a`, status: "SUCCESS", meta: { imageDigest: runtime } },
      frontend: { id: `${id}-f`, status: "SUCCESS", meta: { imageDigest: frontend } },
    },
    health: {
      api: {
        ok: true,
        release_commit: commit,
        database_schema: true,
        database_identity: {
          project_id: "9d285d67-c11b-4508-9efb-fad042787b4c",
          environment_id: "e109e500-2a4c-48a3-96f2-e92a9edb63e4",
          environment: "staging",
        },
        event_encryption: true,
        object_storage: true,
        subject_authority: true,
      },
      frontend: { status: "ok", release_commit: commit },
    },
    schemaHead: "0002_profile_mute_durable_target.sql",
    fleetProof: proof,
    runtimeValidation: runtimeValidation(runtime),
    attemptReceipt: bindReleaseAttempt({
      environment: "staging",
      commit,
      runtimeDigest: runtime,
      frontendDigest: frontend,
      fleetProof: proof,
      stagingMutationLeaseCommit:
        id === "current" ? currentReleaseLease : priorReleaseLease,
      createdAt: new Date("2026-08-26T23:58:00.000Z"),
    }),
    hostedAcceptance: {status: 'passed', generatedAt: '2026-08-26T23:59:00.000Z', checkerCommit: commit, target: {commit, api: 'https://fmarch-staging.up.railway.app', frontend: 'https://fmarch-frontend-staging.up.railway.app'}, authenticatedJourneys: {status: 'passed', scope: 'live-authenticated-staging', commandAcknowledged: true, socketReconnected: true, missedUpdateRecovered: true, durableFreshContext: true, authenticatedPrivateDenial: true}},
    sentinel: { status: "passed", receipt_sha256: "f".repeat(64) },
    generatedAt: new Date("2026-08-27T00:00:00.000Z"),
  });
}

function scenarios() {
  return Object.fromEntries(
    REQUIRED_RELEASE_GAMEDAY_SCENARIOS.map((name) => [
      name,
      {
        name,
        status: "passed",
        started_at: "2026-08-27T00:00:00.000Z",
        finished_at: "2026-08-27T00:00:01.000Z",
        duration_milliseconds: 1_000,
      },
    ]),
  );
}

const current = releaseReceipt(currentCommit, runtimeDigest, frontendDigest, "current");
const prior = releaseReceipt(priorCommit, priorRuntimeDigest, priorFrontendDigest, "prior");

test("game day is explicitly bound to staging and two schema-compatible releases", () => {
  assert.equal(
    validateGameDayInputs({
      currentReceipt: current,
      rollbackReceipt: prior,
      confirmation: `staging:${currentCommit}`,
    }),
    true,
  );
  assert.throws(
    () => validateGameDayInputs({ currentReceipt: current, rollbackReceipt: prior, confirmation: "staging:wrong" }),
    /confirmation must bind staging/,
  );
  const incompatible = { ...prior, schema_head: "0001_current_schema.sql" };
  const { receipt_sha256: _digest, ...base } = incompatible;
  incompatible.receipt_sha256 = receiptDigest(base);
  assert.throws(
    () => validateGameDayInputs({
      currentReceipt: current,
      rollbackReceipt: incompatible,
      confirmation: `staging:${currentCommit}`,
    }),
    /must not cross a schema head/,
  );
});

test("game-day receipt binds every scenario, final restoration, and its own digest", () => {
  const receipt = buildGameDayReceipt({
    currentReceipt: current,
    rollbackReceipt: prior,
    scenarios: scenarios(),
    finalState: {
      environment: "staging",
      release_commit: currentCommit,
      runtime_digest: runtimeDigest,
      frontend_digest: frontendDigest,
      api_ready: true,
      frontend_healthy: true,
      search_sentinel: "passed",
      schema_head: "0002_profile_mute_durable_target.sql",
    },
    stagingMutationLeaseCommit: gameDayLeaseToken,
    generatedAt: new Date("2026-08-27T01:00:00.000Z"),
  });
  assert.equal(assertGameDayReceipt(receipt), receipt);
  assert.throws(
    () => assertGameDayReceipt({ ...receipt, receipt_sha256: "0".repeat(64) }),
    /digest does not match/,
  );
  assert.throws(
    () => buildGameDayReceipt({
      currentReceipt: current,
      rollbackReceipt: prior,
      scenarios: { ...scenarios(), failed_migrator: { ...scenarios().failed_migrator, status: "failed" } },
      finalState: {
        environment: "staging",
        release_commit: currentCommit,
        runtime_digest: runtimeDigest,
        frontend_digest: frontendDigest,
        api_ready: true,
        frontend_healthy: true,
        search_sentinel: "passed",
        schema_head: "0002_profile_mute_durable_target.sql",
      },
      stagingMutationLeaseCommit: gameDayLeaseToken,
    }),
    /failed_migrator did not pass/,
  );
});

test("completed game-day resume revalidates exact live restoration", async () => {
  const finalState = {
    environment: "staging",
    release_commit: currentCommit,
    runtime_digest: runtimeDigest,
    frontend_digest: frontendDigest,
    migrator_deployment_id: "final-migrator",
    api_deployment_id: "final-api",
    frontend_deployment_id: "final-frontend",
    api_ready: true,
    frontend_healthy: true,
    search_sentinel: "passed",
    search_sentinel_receipt_sha256: "6".repeat(64),
    schema_head: "0002_profile_mute_durable_target.sql",
  };
  const receipt = buildGameDayReceipt({
    currentReceipt: current,
    rollbackReceipt: prior,
    scenarios: scenarios(),
    finalState,
    stagingMutationLeaseCommit: gameDayLeaseToken,
    generatedAt: new Date("2026-08-27T01:00:00.000Z"),
  });
  const serviceIds = {
    migrator: "7c2c2665-2be2-4938-84e5-7580a964d610",
    api: "18b6f450-3739-4f21-8e01-f58c63cec834",
    frontend: "23787c98-db56-4ccc-869a-42dca74d7bc7",
  };
  const deploymentIds = {
    [serviceIds.migrator]: finalState.migrator_deployment_id,
    [serviceIds.api]: finalState.api_deployment_id,
    [serviceIds.frontend]: finalState.frontend_deployment_id,
  };
  const digests = {
    [serviceIds.migrator]: runtimeDigest,
    [serviceIds.api]: runtimeDigest,
    [serviceIds.frontend]: frontendDigest,
  };
  const repositories = {
    [serviceIds.migrator]: "ghcr.io/fluffyrabbot/fmarch-runtime",
    [serviceIds.api]: "ghcr.io/fluffyrabbot/fmarch-runtime",
    [serviceIds.frontend]: "ghcr.io/fluffyrabbot/fmarch-frontend",
  };
  const services = Object.values(serviceIds).map((serviceId) => ({
    id: serviceId,
    deploymentId: deploymentIds[serviceId],
    source: { repo: null, image: `${repositories[serviceId]}@${digests[serviceId]}` },
  }));
  const verification = {
    assertAuthority: async () => {},
    loadDeployment: async (deploymentId, serviceId) => ({
      id: deploymentId,
      status: "SUCCESS",
      meta: { imageDigest: digests[serviceId] },
    }),
    loadServices: async () => services,
    loadDomains: async (serviceId) => ({
      domains: [{
        domain: serviceId === serviceIds.api
          ? "fmarch-staging.up.railway.app"
          : "fmarch-frontend-staging.up.railway.app",
        syncStatus: "ACTIVE",
      }],
    }),
    loadServingHealth: async () => {},
  };
  assert.equal(
    await revalidateCompletedGameDayState(
      receipt,
      current,
      prior,
      gameDayLease,
      verification,
    ),
    true,
  );
  await assert.rejects(
    revalidateCompletedGameDayState(
      receipt,
      current,
      prior,
      gameDayLease,
      {
        ...verification,
        loadServices: async () => services.map((service) =>
          service.id === serviceIds.api
            ? { ...service, deploymentId: "drifted-api" }
            : service),
      },
    ),
    /completed game-day api deployment is stale/,
  );
});
