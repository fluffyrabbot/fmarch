import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertReleaseReceipt,
  bindReleaseAttempt,
  buildReleaseReceipt,
  validateDeploymentArtifact,
  validateProofReceipt,
  validateReleaseRepository,
} from "./release_coordinator_contract.mjs";
import {
  serviceSourceCutoverAction,
  validateEpochResetAudit,
  waitForNewDeployment,
} from "./release_coordinator.mjs";

const commit = "a".repeat(40);
const runtimeDigest = `sha256:${"b".repeat(64)}`;
const frontendDigest = `sha256:${"c".repeat(64)}`;
const deployment = (id, digest, status = "SUCCESS") => ({
  id,
  status,
  meta: { imageDigest: digest },
});
const proofReceipt = {
  schema: 2,
  id: "full-proof",
  state: "passed",
  context: { commit, mode: "full", manifest_sha256: "d".repeat(64) },
  finished_at: "2026-08-26T00:00:00.000Z",
};
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
    pushed: true,
    environment: "staging",
  };
  assert.equal(validateReleaseRepository(valid), true);
  assert.equal(validateReleaseRepository({ ...valid, branch: "" }), true);
  assert.throws(() => validateReleaseRepository({ ...valid, branch: "feature" }), /release checkout/);
  assert.throws(() => validateReleaseRepository({ ...valid, status: " M file" }), /clean/);
  assert.throws(() => validateReleaseRepository({ ...valid, originMain: "e".repeat(40) }), /origin\/main/);
  assert.throws(
    () => validateReleaseRepository({ ...valid, environment: "production", originProduction: "e".repeat(40) }),
    /production pointer/,
  );
});

test("proof receipt is exact-commit and full-mode bound", () => {
  assert.equal(validateProofReceipt(proofReceipt, commit), true);
  assert.throws(() => validateProofReceipt({ ...proofReceipt, context: { ...proofReceipt.context, mode: "push" } }, commit), /full/);
  assert.throws(() => validateProofReceipt(proofReceipt, "e".repeat(40)), /commit/);
});

test("deployment validation rejects failures and digest drift", () => {
  assert.equal(validateDeploymentArtifact(deployment("api", runtimeDigest), runtimeDigest, "API").id, "api");
  assert.throws(() => validateDeploymentArtifact(deployment("api", runtimeDigest, "FAILED"), runtimeDigest, "API"), /FAILED/);
  assert.throws(() => validateDeploymentArtifact(deployment("api", frontendDigest), runtimeDigest, "API"), /OCI digest/);
});

test("source cutover detaches canonical sources before attaching an exact image", () => {
  assert.equal(
    serviceSourceCutoverAction({ repo: "fluffyrabbot/fmarch", image: null }),
    "disconnect",
  );
  assert.equal(
    serviceSourceCutoverAction({ repo: null, image: "ghcr.io/fluffyrabbot/fmarch-runtime@sha256:abc" }),
    "disconnect",
  );
  assert.equal(serviceSourceCutoverAction(null), "connect");
  assert.throws(
    () => serviceSourceCutoverAction({ repo: "attacker/fmarch", image: null }),
    /neither canonical Git/,
  );
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
    proofReceipt,
    attemptReceipt,
    sentinel: { status: "passed", receipt_sha256: "sentinel-receipt" },
    generatedAt: new Date("2026-08-26T00:00:00.000Z"),
  });
  assert.equal(assertReleaseReceipt(receipt), receipt);
  assert.equal(receipt.images.runtime, runtimeDigest);
  assert.equal(receipt.images.migrator_api_digest_equal, true);
  assert.throws(
    () => assertReleaseReceipt({ ...receipt, commit: "e".repeat(40) }),
    /digest does not match/,
  );
});
