import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  assertReleaseReceipt,
  assertFreshStagingReleaseReceipt,
  bindReleaseAttempt,
  buildReleaseReceipt,
  canonicalJson,
  receiptDigest,
  validateDeploymentArtifact,
  validateFleetProofReceipt,
  validateProductionReleaseReadiness,
  validateReleaseRepository,
} from "./release_coordinator_contract.mjs";
import { publishImmutableJson } from "./immutable_json_receipt.mjs";
import { validateReusableProductionReceipt } from "./production_promotion.mjs";
import {
  canonicalDeploymentPolicy,
  parseMigrationCompletion,
  serviceSourceCutoverAction,
  parseResetLogRows,
  releaseRuntimeValidation,
  runEpochResetJournal,
  runtimeConfig,
  validateEpochResetAudit,
  waitForNewDeployment,
  waitForMigrationCompletion,
  waitForResetLogRows,
  waitForStagingSentinelReceipt,
} from "./release_coordinator.mjs";

const commit = "a".repeat(40);
const runtimeDigest = `sha256:${"b".repeat(64)}`;
const frontendDigest = `sha256:${"c".repeat(64)}`;
const fleetJobId = "20260907T120000Z-release";
const fleetCompletedAt = "2026-09-07T12:30:00.000Z";
const releaseNow = new Date("2026-09-07T13:00:00.000Z");
const runtimeValidation = {
  status: "passed",
  policy: "immutable-linux-amd64-runtime-v1",
  runtime_reference: `ghcr.io/fluffyrabbot/fmarch-runtime@${runtimeDigest}`,
  runtime_digest: runtimeDigest,
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
  registry_hash: "d".repeat(64),
  host_registry_hash: "d".repeat(64),
  validation_report_sha256: "e".repeat(64),
};
const deployment = (id, digest, status = "SUCCESS") => ({
  id,
  status,
  meta: { imageDigest: digest },
});
const fleetWorkflow = {
  setup: ["npm ci --no-audit --no-fund"],
  verify: ["bash scripts/linux-proof.sh --mode full --force --jobs 2 --keep-going"],
};
const { privateKey: fleetPrivateKey, publicKey: fleetPublicKey } = generateKeyPairSync("ed25519");
const fleetPublicKeyPem = fleetPublicKey.export({ type: "spki", format: "pem" });
const fleetTrustRootSha256 = createHash("sha256")
  .update(fleetPublicKey.export({ type: "spki", format: "der" }))
  .digest("hex");

function signedFleetReceipt({
  releaseCommit = commit,
  mode = "audit",
  outcome = "finished",
  setupCommands = fleetWorkflow.setup,
  stepOk = true,
  signingKey = fleetPrivateKey,
  completedAt = fleetCompletedAt,
} = {}) {
  const comparisonCommit = "9".repeat(40);
  const jobId = "20260907T120000Z-release";
  const document = {
    schemaVersion: 1,
    taskId: jobId,
    jobId,
    host: "cachy",
    state: "finished",
    error: null,
    completedAt,
    task: {
      schemaVersion: 1,
      id: jobId,
      repository: "fmarch",
      host: "cachy",
      baseSha: releaseCommit,
      resultSha: releaseCommit,
      comparisonSha: comparisonCommit,
      verificationMode: mode,
      remoteRef: "ops/release-authority",
      state: "finished",
    },
    evidence: {
      schemaVersion: 1,
      taskId: jobId,
      repository: "fmarch",
      host: "cachy",
      platform: "linux",
      baseSha: releaseCommit,
      resultSha: releaseCommit,
      comparisonSha: comparisonCommit,
      verificationMode: mode,
      verifyOnly: true,
      outcome,
      error: null,
      workflow: {
        profile: "linux",
        environment: {
          FLEET_COMPARISON_SHA: comparisonCommit,
          FLEET_VERIFICATION_MODE: mode,
        },
        setup: fleetWorkflow.setup,
        verify: fleetWorkflow.verify,
      },
      steps: [
        ...setupCommands.map((command) => ({
          label: `setup: ${command}`,
          ok: true,
          status: 0,
          timedOut: false,
        })),
        {
          label: `verify: ${fleetWorkflow.verify[0]}`,
          ok: stepOk,
          status: stepOk ? 0 : 1,
          timedOut: false,
        },
      ],
    },
  };
  const signature = sign(null, Buffer.from(canonicalJson(document)), signingKey);
  return {
    queueState: "finished",
    document: {
      ...document,
      signature: { algorithm: "ed25519", value: signature.toString("base64") },
    },
  };
}

const fleetReceipt = signedFleetReceipt();
const fleetProof = validateFleetProofReceipt(fleetReceipt, {
  expectedCommit: commit,
  expectedJobId: fleetJobId,
  now: releaseNow,
  publicKeyPem: fleetPublicKeyPem,
  expectedTrustRootSha256: fleetTrustRootSha256,
  expectedWorkflow: fleetWorkflow,
});
const attemptReceipt = bindReleaseAttempt({
  environment: "staging",
  commit,
  runtimeDigest,
  frontendDigest,
  fleetProof,
  createdAt: new Date("2026-09-07T12:35:00.000Z"),
});

function redigestReleaseReceipt(receipt) {
  const { receipt_sha256: _digest, ...base } = structuredClone(receipt);
  return { ...base, receipt_sha256: receiptDigest(base) };
}

test("repository validation rejects dirty, stale, or unpointed releases", () => {
  const valid = {
    status: "",
    branch: "main",
    commit,
    head: commit,
    originMain: commit,
    originProduction: commit,
    productionIsAncestor: true,
    pushed: true,
    environment: "staging",
  };
  assert.equal(validateReleaseRepository(valid), true);
  assert.equal(validateReleaseRepository({ ...valid, branch: "" }), true);
  assert.throws(() => validateReleaseRepository({ ...valid, branch: "feature" }), /release checkout/);
  assert.throws(() => validateReleaseRepository({ ...valid, status: " M file" }), /clean/);
  assert.throws(() => validateReleaseRepository({ ...valid, originMain: "e".repeat(40) }), /origin\/main/);
  assert.throws(
    () => validateReleaseRepository({ ...valid, environment: "production", productionIsAncestor: false }),
    /must be an ancestor/,
  );
  assert.equal(
    validateReleaseRepository({
      ...valid,
      environment: "production",
      originProduction: "e".repeat(40),
    }),
    true,
  );
});

test("release coordination pins project, environment, services, images, and origins", () => {
  const staging = runtimeConfig("staging", {});
  assert.equal(staging.projectId, "9d285d67-c11b-4508-9efb-fad042787b4c");
  assert.equal(staging.environmentId, "e109e500-2a4c-48a3-96f2-e92a9edb63e4");
  assert.equal(staging.migratorServiceId, "7c2c2665-2be2-4938-84e5-7580a964d610");
  assert.equal(staging.apiUrl, "https://fmarch-staging.up.railway.app");
  assert.throws(
    () => runtimeConfig("production", { FMARCH_PRODUCTION_API_URL: "https://attacker.test" }),
    /cannot override the canonical release topology/,
  );
});

test("release proof requires an exact-commit signed Cachy audit envelope", () => {
  assert.equal(fleetProof.commit, commit);
  assert.equal(fleetProof.verification_mode, "audit");
  const substitutedAuthority = generateKeyPairSync("ed25519");
  assert.throws(
    () => validateFleetProofReceipt(
      signedFleetReceipt({ signingKey: substitutedAuthority.privateKey }),
      {
        expectedCommit: commit,
        expectedJobId: fleetJobId,
        now: releaseNow,
        publicKeyPem: substitutedAuthority.publicKey.export({ type: "spki", format: "pem" }),
        expectedTrustRootSha256: fleetTrustRootSha256,
        expectedWorkflow: fleetWorkflow,
      },
    ),
    /pinned Cachy trust root/,
  );
  const tampered = structuredClone(fleetReceipt);
  tampered.document.task.baseSha = "e".repeat(40);
  assert.throws(
    () => validateFleetProofReceipt(tampered, {
      expectedCommit: commit,
      expectedJobId: fleetJobId,
      now: releaseNow,
      publicKeyPem: fleetPublicKeyPem,
      expectedTrustRootSha256: fleetTrustRootSha256,
      expectedWorkflow: fleetWorkflow,
    }),
    /signature/,
  );
  assert.throws(
    () => validateFleetProofReceipt(signedFleetReceipt({ mode: "push" }), {
      expectedCommit: commit,
      expectedJobId: fleetJobId,
      now: releaseNow,
      publicKeyPem: fleetPublicKeyPem,
      expectedTrustRootSha256: fleetTrustRootSha256,
      expectedWorkflow: fleetWorkflow,
    }),
    /audit mode/,
  );
  assert.throws(
    () => validateFleetProofReceipt(signedFleetReceipt({ stepOk: false, outcome: "failed" }), {
      expectedCommit: commit,
      expectedJobId: fleetJobId,
      now: releaseNow,
      publicKeyPem: fleetPublicKeyPem,
      expectedTrustRootSha256: fleetTrustRootSha256,
      expectedWorkflow: fleetWorkflow,
    }),
    /did not finish/,
  );
  assert.throws(
    () => validateFleetProofReceipt(signedFleetReceipt({ setupCommands: [] }), {
      expectedCommit: commit,
      expectedJobId: fleetJobId,
      now: releaseNow,
      publicKeyPem: fleetPublicKeyPem,
      expectedTrustRootSha256: fleetTrustRootSha256,
      expectedWorkflow: fleetWorkflow,
    }),
    /setup commands are missing or differ/,
  );
  assert.throws(
    () =>
      validateFleetProofReceipt(fleetReceipt, {
        expectedCommit: commit,
        publicKeyPem: fleetPublicKeyPem,
        expectedTrustRootSha256: fleetTrustRootSha256,
        expectedWorkflow: fleetWorkflow,
        now: releaseNow,
      }),
    /expected fleet job id/,
  );
  assert.throws(
    () =>
      validateFleetProofReceipt(
        signedFleetReceipt({ completedAt: "2026-09-05T12:30:00.000Z" }),
        {
          expectedCommit: commit,
          expectedJobId: fleetJobId,
          publicKeyPem: fleetPublicKeyPem,
          expectedTrustRootSha256: fleetTrustRootSha256,
          expectedWorkflow: fleetWorkflow,
          now: releaseNow,
        },
      ),
    /older than the release freshness window/,
  );
});

test("production readiness rejects every incomplete required registry item", () => {
  const registry = {
    version: 1,
    sections: [
      { id: "platform", required_for: "platform" },
      { id: "release", required_for: "release" },
      { id: "optional", required_for: "optional" },
    ],
    items: [
      { id: "code", section: "platform", status: "complete" },
      { id: "approval", section: "release", status: "complete" },
      { id: "later", section: "optional", status: "deferred" },
    ],
  };
  const readiness = validateProductionReleaseReadiness(registry);
  assert.equal(readiness.status, "passed");
  assert.deepEqual(readiness.completed_items, ["approval", "code"]);
  assert.throws(
    () => validateProductionReleaseReadiness({
      ...registry,
      items: registry.items.map((item) => item.id === "approval" ? { ...item, status: "blocked" } : item),
    }),
    /approval=blocked/,
  );
});

test("immutable release receipts publish atomically, replay identically, and refuse replacement", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fmarch-release-receipt-"));
  try {
    const output = path.join(directory, "receipt.json");
    await publishImmutableJson(output, { status: "passed" });
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { status: "passed" });
    assert.equal(await publishImmutableJson(output, { status: "passed" }), output);
    await assert.rejects(publishImmutableJson(output, { status: "different" }), /already exists/);

    const concurrent = path.join(directory, "concurrent.json");
    assert.deepEqual(
      await Promise.all(
        Array.from({ length: 4 }, () => publishImmutableJson(concurrent, { status: "same" })),
      ),
      Array(4).fill(concurrent),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deployment validation rejects failures and digest drift", () => {
  assert.equal(validateDeploymentArtifact(deployment("api", runtimeDigest), runtimeDigest, "API").id, "api");
  assert.throws(() => validateDeploymentArtifact(deployment("api", runtimeDigest, "FAILED"), runtimeDigest, "API"), /FAILED/);
  assert.throws(() => validateDeploymentArtifact(deployment("api", frontendDigest), runtimeDigest, "API"), /OCI digest/);
});

test("source cutover attaches once and updates image sources without detaching them", () => {
  assert.equal(
    serviceSourceCutoverAction({ repo: "fluffyrabbot/fmarch", image: null }, "image@sha256:new"),
    "disconnect",
  );
  assert.equal(
    serviceSourceCutoverAction({ repo: null, image: "image@sha256:old" }, "image@sha256:new"),
    "update",
  );
  assert.equal(
    serviceSourceCutoverAction({ repo: null, image: "image@sha256:new" }, "image@sha256:new"),
    "ready",
  );
  assert.equal(serviceSourceCutoverAction(null, "image@sha256:new"), "connect");
  assert.throws(
    () => serviceSourceCutoverAction({ repo: "attacker/fmarch", image: null }),
    /neither canonical Git/,
  );
});

test("image deployments restore the complete service safety policy", () => {
  assert.deepEqual(canonicalDeploymentPolicy("migrator"), {
    numReplicas: 1,
    restartPolicyType: "NEVER",
    restartPolicyMaxRetries: 0,
    preDeployCommand: null,
    healthcheckPath: null,
    healthcheckTimeout: null,
  });
  assert.deepEqual(canonicalDeploymentPolicy("api"), {
    numReplicas: 2,
    restartPolicyType: "ON_FAILURE",
    restartPolicyMaxRetries: 3,
    preDeployCommand: ["fmarch-schema-gate"],
    healthcheckPath: "/readyz",
    healthcheckTimeout: 120,
  });
  assert.deepEqual(canonicalDeploymentPolicy("frontend"), {
    numReplicas: 1,
    restartPolicyType: "ON_FAILURE",
    restartPolicyMaxRetries: 3,
    preDeployCommand: null,
    healthcheckPath: "/healthz",
    healthcheckTimeout: 120,
  });
  assert.throws(() => canonicalDeploymentPolicy("database"), /unknown Railway deployment policy/);
});

test("deployment sequencing waits through a slow migrator and stops on terminal failure", async () => {
  let clock = 0;
  const slowStates = [
    deployment("old", runtimeDigest),
    deployment("new", runtimeDigest, "BUILDING"),
    deployment("new", runtimeDigest, "DEPLOYING"),
    deployment("new", runtimeDigest),
  ];
  const completed = await waitForNewDeployment(
    {},
    "migrator",
    "old",
    runtimeDigest,
    "staging migrator",
    {
      load: () => slowStates.shift() ?? deployment("new", runtimeDigest),
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
      timeoutMilliseconds: 100,
      pollMilliseconds: 1,
    },
  );
  assert.equal(completed.id, "new");

  await assert.rejects(
    waitForNewDeployment(
      {},
      "api",
      "old",
      runtimeDigest,
      "staging API",
      {
        load: () => deployment("new", runtimeDigest, "FAILED"),
        now: () => 0,
        sleep: async () => {},
      },
    ),
    /FAILED/,
  );
});

test("migration completion requires exact-commit structured log evidence", async () => {
  const row = JSON.stringify({
    message: JSON.stringify({
      kind: "fmarch-database-migration-complete",
      release_commit: commit,
    }),
  });
  assert.equal(parseMigrationCompletion(row).release_commit, commit);
  assert.equal(parseMigrationCompletion(JSON.stringify({ message: "Starting Container" })), null);
  let clock = 0;
  const completion = await waitForMigrationCompletion(
    {},
    "deployment",
    "migrator",
    commit,
    {
      load: () => (clock === 0 ? "" : row),
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
      timeoutMilliseconds: 10,
      pollMilliseconds: 1,
    },
  );
  assert.equal(completion.release_commit, commit);
  await assert.rejects(
    waitForMigrationCompletion(
      {},
      "deployment",
      "migrator",
      commit,
      {
        load: () => JSON.stringify({ message: "/bin/false exited" }),
        now: () => clock,
        sleep: async (milliseconds) => { clock += milliseconds; },
        timeoutMilliseconds: 2,
        pollMilliseconds: 1,
      },
    ),
    /no exact-commit completion record/,
  );
});

test("release retries are bound to the original commit and exact image digests", () => {
  assert.equal(
    bindReleaseAttempt({
      environment: "staging",
      commit,
      runtimeDigest,
      frontendDigest,
      fleetProof,
      existing: attemptReceipt,
    }),
    attemptReceipt,
  );
  assert.throws(
    () => bindReleaseAttempt({
      environment: "staging",
      commit,
      runtimeDigest,
      frontendDigest: `sha256:${"e".repeat(64)}`,
      fleetProof,
      existing: attemptReceipt,
    }),
    /exact commit, proof, topology, and image digests/,
  );
  assert.throws(
    () => bindReleaseAttempt({
      environment: "staging",
      commit,
      runtimeDigest,
      frontendDigest,
      fleetProof,
      existing: { ...attemptReceipt, receipt_sha256: "0".repeat(64) },
    }),
    /tampered/,
  );
});

test("staging validates the immutable amd64 runtime while production reuses its attestation", () => {
  let validatedReference = null;
  assert.equal(
    releaseRuntimeValidation({
      environment: "staging",
      runtimeRepository: "ghcr.io/fluffyrabbot/fmarch-runtime",
      runtimeDigest,
      validate({ reference }) {
        validatedReference = reference;
        return runtimeValidation;
      },
    }),
    runtimeValidation,
  );
  assert.equal(
    validatedReference,
    `ghcr.io/fluffyrabbot/fmarch-runtime@${runtimeDigest}`,
  );
  assert.equal(
    releaseRuntimeValidation({
      environment: "production",
      runtimeRepository: "ghcr.io/fluffyrabbot/fmarch-runtime",
      runtimeDigest,
      reusedRuntimeValidation: runtimeValidation,
      validate() {
        throw new Error("production must not rebuild or revalidate");
      },
    }),
    runtimeValidation,
  );
  assert.throws(
    () => releaseRuntimeValidation({
      environment: "production",
      runtimeRepository: "ghcr.io/fluffyrabbot/fmarch-runtime",
      runtimeDigest,
    }),
    /staging runtime attestation/,
  );
});

test("epoch reset audit permits only identity-empty greenfield state", () => {
  const audit = {
    kind: "fmarch-schema-epoch-reset-audit",
    environment: "staging",
    epoch: 1,
    release_commit: commit,
    execute: false,
    counts: {
      platform_principal: 0,
      member_profile: 0,
      profile_mute: 0,
      events: 2,
      public_search_document: 1,
      sqlx_migrations: 1,
    },
  };
  assert.equal(
    validateEpochResetAudit(audit, { environment: "staging", epoch: 1, commit }),
    audit,
  );
  assert.throws(
    () => validateEpochResetAudit(
      { ...audit, counts: { ...audit.counts, platform_principal: 1 } },
      { environment: "staging", epoch: 1, commit },
    ),
    /non-greenfield platform_principal/,
  );
  assert.throws(
    () => validateEpochResetAudit({ ...audit, execute: true }, { environment: "staging", epoch: 1, commit }),
    /must not mutate/,
  );
});

test("epoch reset logs accept Railway structured fields and embedded JSON messages", () => {
  const structured = JSON.stringify({
    kind: "fmarch-schema-epoch-reset-audit",
    environment: "staging",
    epoch: 1,
    release_commit: commit,
    execute: false,
    counts: {},
    message: "",
  });
  const embedded = JSON.stringify({
    message: `prefix ${JSON.stringify({
      kind: "fmarch-schema-epoch-reset-complete",
      environment: "staging",
      epoch: 1,
      release_commit: commit,
    })}`,
  });
  const parsed = parseResetLogRows(`${structured}\n${embedded}`);
  assert.equal(parsed.audit.kind, "fmarch-schema-epoch-reset-audit");
  assert.equal(parsed.complete.kind, "fmarch-schema-epoch-reset-complete");
});

test("epoch reset evidence waits for Railway log propagation and stays bounded", async () => {
  let clock = 0;
  const outputs = ["", JSON.stringify({ kind: "fmarch-schema-epoch-reset-audit" })];
  const parsed = await waitForResetLogRows(
    {},
    "deployment",
    "service",
    ["audit"],
    "reset audit",
    {
      load: () => outputs.shift() ?? "",
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
      timeoutMilliseconds: 10,
      pollMilliseconds: 1,
    },
  );
  assert.equal(parsed.audit.kind, "fmarch-schema-epoch-reset-audit");

  await assert.rejects(
    waitForResetLogRows(
      {},
      "deployment",
      "service",
      ["audit", "complete"],
      "reset execution",
      {
        load: () => "",
        now: () => clock,
        sleep: async (milliseconds) => { clock += milliseconds; },
        timeoutMilliseconds: 2,
        pollMilliseconds: 1,
      },
    ),
    /audit and complete record/,
  );
});

test("schema epoch reset resumes from the durable destructive-phase fence", async () => {
  const operationBase = {
    version: 1,
    kind: "fmarch-schema-epoch-reset-operation",
    key: `staging:1:${commit}`,
    environment: "staging",
    epoch: 1,
    commit,
    runtime_digest: runtimeDigest,
    topology: runtimeConfig("staging", {}).topology,
  };
  const operation = {
    ...operationBase,
    receipt_sha256: receiptDigest(operationBase),
  };
  const phases = new Map();
  let destructiveExecutions = 0;
  let recoveries = 0;
  let remoteResetComplete = false;
  let migrations = 0;
  const dependencies = {
    operation,
    loadPhase: async (phase) => phases.get(phase) ?? null,
    publishPhase: async (phase, receipt) => {
      assert.equal(phases.has(phase), false, `phase ${phase} was replaced`);
      phases.set(phase, structuredClone(receipt));
    },
    audit: async () => ({ audit_deployment_id: "audit", prior_counts: {} }),
    planReset: async () => ({ previous_deployment_id: "before-reset" }),
    executeOrRecoverReset: async () => {
      if (!remoteResetComplete) {
        destructiveExecutions += 1;
        remoteResetComplete = true;
        throw new Error("injected crash after destructive reset");
      }
      recoveries += 1;
      return {
        schema_epoch_reset: {
          deployment_id: "reset",
          audit_deployment_id: "audit",
        },
      };
    },
    planMigration: async () => ({ previous_deployment_id: "reset" }),
    executeOrRecoverMigration: async () => {
      migrations += 1;
      return {
        deployment: {
          id: "migrator",
          status: "SUCCESS",
          meta: { imageDigest: runtimeDigest },
        },
      };
    },
  };

  await assert.rejects(
    runEpochResetJournal(dependencies),
    /injected crash after destructive reset/,
  );
  assert.equal(phases.has("reset-started"), true);
  assert.equal(phases.has("reset-complete"), false);

  const resumed = await runEpochResetJournal(dependencies);
  assert.equal(destructiveExecutions, 1, "resume repeated the destructive reset");
  assert.equal(recoveries, 1);
  assert.equal(migrations, 1);
  assert.equal(resumed.schemaEpochReset.deployment_id, "reset");
  assert.equal(resumed.migrator.id, "migrator");
});

test("staging sentinel waits for telemetry propagation without rerunning its canary", async () => {
  let clock = 0;
  let loads = 0;
  const receipt = await waitForStagingSentinelReceipt({
    load: async () => {
      loads += 1;
      return { status: loads < 3 ? "insufficient" : "passed" };
    },
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    timeoutMilliseconds: 10,
    pollMilliseconds: 1,
  });
  assert.equal(receipt.status, "passed");
  assert.equal(loads, 3);
  await assert.rejects(
    waitForStagingSentinelReceipt({
      load: async () => ({ status: "failed" }),
      now: () => 0,
      sleep: async () => {},
      timeoutMilliseconds: 1,
      pollMilliseconds: 1,
    }),
    /sentinel failed/,
  );
});

test("release receipt binds exact artifacts, health, proof, and staging sentinel", () => {
  const health = {
    api: {
      ok: true,
      release_commit: commit,
      database_schema: true,
      event_encryption: true,
      object_storage: true,
      subject_authority: true,
    },
    frontend: { status: "ok", release_commit: commit },
  };
  const hostedAcceptance = {
    status: "passed",
    generatedAt: "2026-09-07T12:45:00.000Z",
    checkerCommit: commit,
    target: {
      commit,
      api: "https://fmarch-staging.up.railway.app",
      frontend: "https://fmarch-frontend-staging.up.railway.app",
    },
    authenticatedJourneys: {
      status: "passed",
      scope: "live-authenticated-staging",
      commandAcknowledged: true,
      socketReconnected: true,
      missedUpdateRecovered: true,
      durableFreshContext: true,
      authenticatedPrivateDenial: true,
    },
  };
  const receipt = buildReleaseReceipt({
    environment: "staging",
    commit,
    runtimeDigest,
    frontendDigest,
    fleetProof,
    createdAt: new Date("2026-09-07T12:40:00.000Z"),
    deployments: {
      migrator: deployment("migrator", runtimeDigest),
      api: deployment("api", runtimeDigest),
      frontend: deployment("frontend", frontendDigest),
    },
    health,
    schemaHead: "0002_profile_mute_durable_target.sql",
    fleetProof,
    attemptReceipt,
    runtimeValidation,
    hostedAcceptance,
    sentinel: { status: "passed", receipt_sha256: "sentinel-receipt" },
    generatedAt: new Date("2026-09-07T12:50:00.000Z"),
  });
  assert.equal(assertReleaseReceipt(receipt), receipt);
  assert.equal(assertFreshStagingReleaseReceipt(receipt, { now: releaseNow }), receipt);
  assert.throws(
    () =>
      assertFreshStagingReleaseReceipt(receipt, {
        now: new Date("2026-09-09T13:00:00.000Z"),
      }),
    /older than the release freshness window/,
  );
  assert.throws(
    () =>
      assertReleaseReceipt(
        redigestReleaseReceipt({
          ...receipt,
          topology: {
            ...receipt.topology,
            project_id: "00000000-0000-0000-0000-000000000000",
          },
        }),
      ),
    /canonical Railway authority/,
  );
  assert.equal(receipt.images.runtime, runtimeDigest);
  assert.equal(receipt.runtime_validation, runtimeValidation);
  assert.equal(receipt.images.migrator_api_digest_equal, true);
  assert.throws(
    () => assertReleaseReceipt({ ...receipt, commit: "e".repeat(40) }),
    /commit drifted/,
  );
  assert.throws(
    () => assertReleaseReceipt({
      ...receipt,
      runtime_validation: { ...runtimeValidation, platform: "linux/arm64" },
    }),
    /platform drifted/,
  );

  const tamperedHealth = redigestReleaseReceipt({
    ...receipt,
    health: { ...receipt.health, api: { ...receipt.health.api, ok: false } },
  });
  assert.throws(() => assertReleaseReceipt(tamperedHealth), /readiness field ok/);
  assert.throws(
    () => assertReleaseReceipt(redigestReleaseReceipt({ ...receipt, deployments: { ...receipt.deployments, api: "" } })),
    /API deployment id|api deployment id/iu,
  );
  assert.throws(
    () => assertReleaseReceipt(redigestReleaseReceipt({ ...receipt, schema_head: "latest.sql" })),
    /schema head/,
  );
  assert.throws(
    () => assertReleaseReceipt(redigestReleaseReceipt({ ...receipt, sentinel: null })),
    /passed search sentinel/,
  );

  const alteredAttemptBase = {
    ...receipt.attempt,
    images: { ...receipt.attempt.images, frontend: `sha256:${"f".repeat(64)}` },
  };
  delete alteredAttemptBase.receipt_sha256;
  const alteredAttempt = {
    ...alteredAttemptBase,
    receipt_sha256: receiptDigest(alteredAttemptBase),
  };
  assert.throws(
    () => assertReleaseReceipt(redigestReleaseReceipt({
      ...receipt,
      attempt: alteredAttempt,
      attempt_receipt_sha256: alteredAttempt.receipt_sha256,
    })),
    /exact commit, proof, topology, and image digests/,
  );

  const releaseReadiness = validateProductionReleaseReadiness({
    version: 1,
    sections: [{ id: "release", required_for: "release" }],
    items: [{ id: "approval", section: "release", status: "complete" }],
  });
  const productionAttempt = bindReleaseAttempt({
    environment: "production",
    commit,
    runtimeDigest,
    frontendDigest,
    fleetProof,
    createdAt: new Date("2026-09-07T12:40:00.000Z"),
  });
  const productionReceipt = buildReleaseReceipt({
    environment: "production",
    commit,
    runtimeDigest,
    frontendDigest,
    deployments: {
      migrator: deployment("production-migrator", runtimeDigest),
      api: deployment("production-api", runtimeDigest),
      frontend: deployment("production-frontend", frontendDigest),
    },
    health,
    schemaHead: "0002_profile_mute_durable_target.sql",
    fleetProof,
    attemptReceipt: productionAttempt,
    runtimeValidation,
    releaseReadiness,
    generatedAt: new Date("2026-09-07T12:55:00.000Z"),
  });
  assert.equal(
    validateReusableProductionReceipt(productionReceipt, {
      commit,
      stagingReceipt: receipt,
      fleetProof,
      releaseReadiness,
    }),
    productionReceipt,
  );
  assert.throws(
    () => assertReleaseReceipt(redigestReleaseReceipt({
      ...productionReceipt,
      sentinel: { status: "passed" },
    })),
    /must not contain a staging sentinel/,
  );
  const alternateProductionAttempt = bindReleaseAttempt({
    environment: "production",
    commit,
    runtimeDigest,
    frontendDigest: `sha256:${"f".repeat(64)}`,
    fleetProof,
    createdAt: new Date("2026-09-07T12:45:00.000Z"),
  });
  assert.throws(
    () => validateReusableProductionReceipt(redigestReleaseReceipt({
      ...productionReceipt,
      images: { ...productionReceipt.images, frontend: `sha256:${"f".repeat(64)}` },
      attempt: alternateProductionAttempt,
      attempt_receipt_sha256: alternateProductionAttempt.receipt_sha256,
    }), {
      commit,
      stagingReceipt: receipt,
      fleetProof,
      releaseReadiness,
    }),
    /frontend image drifted from staging/,
  );
});
