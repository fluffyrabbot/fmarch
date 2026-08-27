import assert from "node:assert/strict";

import {
  assertImageDigest,
  assertReleaseReceipt,
  receiptDigest,
} from "./release_coordinator_contract.mjs";

export const RELEASE_GAMEDAY_VERSION = 1;
export const REQUIRED_RELEASE_GAMEDAY_SCENARIOS = Object.freeze([
  "delayed_migrator",
  "failed_migrator",
  "exact_digest_retry",
  "api_readiness_failure",
  "wrong_digest_detection",
  "application_rollback",
  "current_release_restore",
]);

export function validateGameDayInputs({ currentReceipt, rollbackReceipt, confirmation }) {
  assertReleaseReceipt(currentReceipt);
  assertReleaseReceipt(rollbackReceipt);
  assert.equal(currentReceipt.environment, "staging", "game day is staging-only");
  assert.equal(rollbackReceipt.environment, "staging", "rollback receipt must be from staging");
  assert.notEqual(
    currentReceipt.commit,
    rollbackReceipt.commit,
    "rollback receipt must name a prior release",
  );
  assert.equal(
    currentReceipt.schema_head,
    rollbackReceipt.schema_head,
    "application rollback must not cross a schema head",
  );
  assert.equal(
    confirmation,
    `staging:${currentReceipt.commit}`,
    "game day confirmation must bind staging and the exact current release",
  );
  return true;
}

export function validateGameDayScenario(scenario, expectedName) {
  assert.equal(scenario?.name, expectedName, `missing ${expectedName} scenario`);
  assert.equal(scenario.status, "passed", `${expectedName} did not pass`);
  assert.ok(
    Number.isSafeInteger(scenario.duration_milliseconds) && scenario.duration_milliseconds >= 0,
    `${expectedName} duration is invalid`,
  );
  assert.ok(scenario.started_at, `${expectedName} start timestamp is missing`);
  assert.ok(scenario.finished_at, `${expectedName} finish timestamp is missing`);
  return true;
}

export function buildGameDayReceipt({
  currentReceipt,
  rollbackReceipt,
  scenarios,
  finalState,
  generatedAt = new Date(),
}) {
  assertReleaseReceipt(currentReceipt);
  assertReleaseReceipt(rollbackReceipt);
  for (const name of REQUIRED_RELEASE_GAMEDAY_SCENARIOS) {
    validateGameDayScenario(scenarios[name], name);
  }
  assert.equal(finalState?.environment, "staging", "final state must be staging");
  assert.equal(finalState?.release_commit, currentReceipt.commit, "staging was not restored");
  assert.equal(finalState?.api_ready, true, "API was not restored ready");
  assert.equal(finalState?.frontend_healthy, true, "frontend was not restored healthy");
  assert.equal(finalState?.search_sentinel, "passed", "search sentinel did not pass after restore");
  assert.equal(finalState?.schema_head, currentReceipt.schema_head, "schema head changed during game day");
  assert.equal(
    assertImageDigest(finalState?.runtime_digest, "final runtime digest"),
    currentReceipt.images.runtime,
    "runtime digest was not restored",
  );
  assert.equal(
    assertImageDigest(finalState?.frontend_digest, "final frontend digest"),
    currentReceipt.images.frontend,
    "frontend digest was not restored",
  );
  const base = {
    version: RELEASE_GAMEDAY_VERSION,
    kind: "fmarch-staging-release-game-day",
    environment: "staging",
    generated_at: generatedAt.toISOString(),
    current_release: {
      commit: currentReceipt.commit,
      receipt_sha256: currentReceipt.receipt_sha256,
      runtime_digest: currentReceipt.images.runtime,
      frontend_digest: currentReceipt.images.frontend,
    },
    rollback_release: {
      commit: rollbackReceipt.commit,
      receipt_sha256: rollbackReceipt.receipt_sha256,
      runtime_digest: rollbackReceipt.images.runtime,
      frontend_digest: rollbackReceipt.images.frontend,
    },
    scenarios,
    final_state: finalState,
    conclusion: {
      automatic_main_trigger_recommended: false,
      reason:
        "Keep local release authority until platform health checks and the game-day lane are enforced automatically on every coordinated staging release.",
    },
  };
  return { ...base, receipt_sha256: receiptDigest(base) };
}

export function assertGameDayReceipt(receipt) {
  assert.equal(receipt?.version, RELEASE_GAMEDAY_VERSION, "game-day receipt version drifted");
  assert.equal(receipt.kind, "fmarch-staging-release-game-day", "game-day receipt kind drifted");
  assert.equal(receipt.environment, "staging", "game-day receipt is not staging-scoped");
  const { receipt_sha256: actual, ...base } = receipt;
  assert.equal(actual, receiptDigest(base), "game-day receipt digest does not match its contents");
  for (const name of REQUIRED_RELEASE_GAMEDAY_SCENARIOS) {
    validateGameDayScenario(receipt.scenarios?.[name], name);
  }
  const serialized = JSON.stringify(receipt).toUpperCase();
  for (const forbidden of ["DATABASE_URL", "PASSWORD", "TOKEN", "SECRET", "PRIVATE_KEY"]) {
    assert.equal(serialized.includes(forbidden), false, `game-day receipt contains forbidden ${forbidden}`);
  }
  return receipt;
}
