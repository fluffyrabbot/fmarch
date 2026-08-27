import assert from "node:assert/strict";
import test from "node:test";

import {
  assertGameDayReceipt,
  buildGameDayReceipt,
  REQUIRED_RELEASE_GAMEDAY_SCENARIOS,
  validateGameDayInputs,
} from "./release_gameday_contract.mjs";
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

function proofReceipt(commit, id) {
  return {
    schema: 2,
    id,
    state: "passed",
    context: { commit, mode: "full", manifest_sha256: "e".repeat(64) },
    finished_at: "2026-08-27T00:00:00.000Z",
  };
}

function releaseReceipt(commit, runtime, frontend, id) {
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
        event_encryption: true,
        object_storage: true,
        subject_authority: true,
      },
      frontend: { status: "ok", release_commit: commit },
    },
    schemaHead: "0002_profile_mute_durable_target.sql",
    proofReceipt: proofReceipt(commit, `${id}-proof`),
    attemptReceipt: bindReleaseAttempt({
      environment: "staging",
      commit,
      runtimeDigest: runtime,
      frontendDigest: frontend,
    }),
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
    }),
    /failed_migrator did not pass/,
  );
});
