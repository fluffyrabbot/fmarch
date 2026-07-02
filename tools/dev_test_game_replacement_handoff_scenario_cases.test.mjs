import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  replacementCoreLoopHandoffLaneIds,
  replacementHandoffHardeningLaneIds,
  replacementHandoffRecoveryLaneIds,
  replacementSessionRecoveryLaneIds,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";

test("replacement handoff lane IDs are shared in proof order", () => {
  assert.deepEqual(replacementCoreLoopHandoffLaneIds, [
    "replacement-host-issued-invite",
    "replacement-pending-player",
    "replacement-invalid-target-recovery",
    "replacement-console",
    "stale-host-invite-recovery",
    "replacement-stale-success-recovery",
    "replacement-stale-player",
    "replacement-stale-action",
    "replacement-stale-private-channel",
    "replacement-stale-private-receipts",
    "replacement-incoming-player",
  ]);
  assert.deepEqual(replacementSessionRecoveryLaneIds, [
    "replacement-redeemed-invite-recovery",
    "replacement-session-revocation-recovery",
    "replacement-session-refresh-recovery",
    "replacement-stale-session-after-refresh",
    "replacement-reconnect-recovery",
  ]);
  assert.deepEqual(replacementHandoffHardeningLaneIds, [
    ...replacementSessionRecoveryLaneIds,
    "replacement-idempotent-retry",
  ]);
  assert.deepEqual(replacementHandoffRecoveryLaneIds, [
    "replacement-host-issued-invite",
    "replacement-pending-player",
    ...replacementSessionRecoveryLaneIds,
    "stale-host-invite-recovery",
    "replacement-invalid-target-recovery",
    "replacement-console",
    "replacement-idempotent-retry",
    "replacement-stale-success-recovery",
    "replacement-stale-player",
    "replacement-stale-action",
    "replacement-stale-private-channel",
    "replacement-stale-private-receipts",
    "replacement-incoming-player",
  ]);
});

test("replacement handoff consumers import extracted lane IDs", async () => {
  const consumerPaths = [
    "tools/dev_test_game_core_loop_scenarios.mjs",
    "tools/dev_test_game_hardening_scenarios.mjs",
    "tools/dev_test_game_host_stale_control_scenarios.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game.test.mjs",
  ];
  const sources = await Promise.all(
    consumerPaths.map((consumerPath) => readFile(consumerPath, "utf8")),
  );
  for (const [index, source] of sources.entries()) {
    assert(
      source.includes("./dev_test_game_replacement_handoff_scenario_cases.mjs"),
      `${consumerPaths[index]} should import replacement handoff cases`,
    );
  }
});
