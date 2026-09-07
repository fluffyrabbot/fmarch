import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  assertReleaseReceipt,
  bindReleaseAttempt,
  buildReleaseReceipt,
  canonicalJson,
  validateDeploymentArtifact,
  validateFleetProofReceipt,
  validateProductionReleaseReadiness,
  validateReleaseRepository,
} from "./release_coordinator_contract.mjs";
import { publishImmutableJson } from "./immutable_json_receipt.mjs";
import {
  canonicalDeploymentPolicy,
  parseMigrationCompletion,
  serviceSourceCutoverAction,
  parseResetLogRows,
  releaseRuntimeValidation,
  validateEpochResetAudit,
  waitForNewDeployment,
  waitForMigrationCompletion,
  waitForResetLogRows,
  waitForStagingSentinelReceipt,
} from "./release_coordinator.mjs";

const commit = "a".repeat(40);
const runtimeDigest = `sha256:${"b".repeat(64)}`;
const frontendDigest = `sha256:${"c".repeat(64)}`;
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
  outcome = "passed",
  stepOk = true,
  signingKey = fleetPrivateKey,
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
    completedAt: "2026-09-07T12:30:00.000Z",
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
  publicKeyPem: fleetPublicKeyPem,
  expectedTrustRootSha256: fleetTrustRootSha256,
  expectedWorkflow: fleetWorkflow,
});
const attemptReceipt = bindReleaseAttempt({
  environment: "staging",
  commit,
  runtimeDigest,
  frontendDigest,
});

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

test("release proof requires an exact-commit signed Cachy audit envelope", () => {
  assert.equal(fleetProof.commit, commit);
  assert.equal(fleetProof.verification_mode, "audit");
  const substitutedAuthority = generateKeyPairSync("ed25519");
  assert.throws(
    () => validateFleetProofReceipt(
      signedFleetReceipt({ signingKey: substitutedAuthority.privateKey }),
      {
        expectedCommit: commit,
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
      publicKeyPem: fleetPublicKeyPem,
      expectedTrustRootSha256: fleetTrustRootSha256,
      expectedWorkflow: fleetWorkflow,
    }),
    /signature/,
  );
  assert.throws(
    () => validateFleetProofReceipt(signedFleetReceipt({ mode: "push" }), {
      expectedCommit: commit,
      publicKeyPem: fleetPublicKeyPem,
      expectedTrustRootSha256: fleetTrustRootSha256,
      expectedWorkflow: fleetWorkflow,
    }),
    /audit mode/,
  );
  assert.throws(
    () => validateFleetProofReceipt(signedFleetReceipt({ stepOk: false, outcome: "failed" }), {
      expectedCommit: commit,
      publicKeyPem: fleetPublicKeyPem,
      expectedTrustRootSha256: fleetTrustRootSha256,
      expectedWorkflow: fleetWorkflow,
    }),
    /did not pass/,
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

test("immutable release receipts publish atomically and refuse replacement", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fmarch-release-receipt-"));
  try {
    const output = path.join(directory, "receipt.json");
    await publishImmutableJson(output, { status: "passed" });
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { status: "passed" });
    await assert.rejects(publishImmutableJson(output, { status: "different" }), /already exists/);
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
      existing: attemptReceipt,
    }),
    /exact commit and image digests/,
  );
  assert.throws(
    () => bindReleaseAttempt({
      environment: "staging",
      commit,
      runtimeDigest,
      frontendDigest,
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
  const receipt = buildReleaseReceipt({
    environment: "staging",
    commit,
    runtimeDigest,
    frontendDigest,
    deployments: {
      migrator: deployment("migrator", runtimeDigest),
      api: deployment("api", runtimeDigest),
      frontend: deployment("frontend", frontendDigest),
    },
    health: {
      api: {
        ok: true,
        release_commit: commit,
        database_schema: true,
        event_encryption: true,
        object_storage: true,
        subject_authority: true,
      },
      frontend: { status: "ok", release_commit: commit },
    },
    schemaHead: "0002_profile_mute_durable_target.sql",
    fleetProof,
    attemptReceipt,
    runtimeValidation,
    hostedAcceptance: {status: 'passed', checkerCommit: commit, target: {commit, api: 'https://fmarch-staging.up.railway.app', frontend: 'https://fmarch-frontend-staging.up.railway.app'}, authenticatedJourneys: {status: 'passed', scope: 'live-authenticated-staging', commandAcknowledged: true, socketReconnected: true, missedUpdateRecovered: true, durableFreshContext: true, authenticatedPrivateDenial: true}},
    sentinel: { status: "passed", receipt_sha256: "sentinel-receipt" },
    generatedAt: new Date("2026-08-26T00:00:00.000Z"),
  });
  assert.equal(assertReleaseReceipt(receipt), receipt);
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
});
