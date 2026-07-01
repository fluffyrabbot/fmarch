import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hostStaleControlLaneIds,
  hostedMatrixStaleConflictLaneIds,
  staleConflictMessageLaneIds,
} from "./dev_test_game_hardening_lane_cases.mjs";

test("hardening lane cases share stale conflict-message IDs", () => {
  assert.deepEqual(staleConflictMessageLaneIds, [
    "replacement-stale-conflict-message",
    "stale-action-conflict-message",
    "stale-dead-action-conflict",
  ]);
});

test("hardening lane cases share host stale-control IDs", () => {
  assert.deepEqual(hostStaleControlLaneIds, [
    "stale-host-publish",
    "stale-host-lifecycle",
    "stale-host-modkill",
    "stale-host-prompt",
    "stale-host-prompt-reload",
    "stale-host-complete",
    "stale-host-complete-reload",
    "stale-host-complete-reconnect-recovery",
    "stale-host-control",
    "stale-host-resolve",
    "stale-host-resolve-reload",
    "stale-host-resolve-reconnect-recovery",
    "stale-host-advance",
    "stale-host-advance-reload",
    "stale-host-advance-reconnect-recovery",
    "stale-host-deadline",
    "stale-host-deadline-reload",
    "stale-host-deadline-reconnect-recovery",
  ]);
});

test("hardening lane cases derive hosted stale-conflict matrix IDs", () => {
  assert.deepEqual(hostedMatrixStaleConflictLaneIds, [
    ...staleConflictMessageLaneIds,
    "stale-host-control",
  ]);
});
