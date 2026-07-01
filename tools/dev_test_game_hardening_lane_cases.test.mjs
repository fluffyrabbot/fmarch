import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cohostDeadlineRecoveryLaneIds,
  hostCohostRaceRecoveryLaneIds,
  hostGenericStaleControlLaneIds,
  hostStaleControlLaneIds,
  hostPhaseStaleRecoveryLaneIds,
  hostPhaseStaleControlLaneIds,
  hostPromptStaleControlLaneIds,
  hostRaceReloadLaneIds,
  hostStandaloneStaleControlLaneIds,
  hostedMatrixReconnectLaneIds,
  hostedMatrixStaleConflictLaneIds,
  playerActionConflictRecoveryLaneIds,
  playerActionFoundationLaneIds,
  promotedStalePlayerCommandLaneIds,
  staleConflictMessageLaneIds,
  stalePlayerCommandLaneIds,
} from "./dev_test_game_hardening_lane_cases.mjs";

test("hardening lane cases share stale conflict-message IDs", () => {
  assert.deepEqual(staleConflictMessageLaneIds, [
    "replacement-stale-conflict-message",
    "stale-action-conflict-message",
    "stale-dead-action-conflict",
  ]);
});

test("hardening lane cases share host stale-control IDs", () => {
  assert.deepEqual(hostStandaloneStaleControlLaneIds, [
    "stale-host-publish",
    "stale-host-lifecycle",
    "stale-host-lifecycle-reload",
    "stale-host-modkill",
    "stale-host-modkill-reload",
  ]);
  assert.deepEqual(hostPromptStaleControlLaneIds, [
    "stale-host-prompt",
    "stale-host-prompt-reload",
  ]);
  assert.deepEqual(hostGenericStaleControlLaneIds, ["stale-host-control"]);
  assert.deepEqual(hostPhaseStaleControlLaneIds, [
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
  assert.deepEqual(hostStaleControlLaneIds, [
    ...hostStandaloneStaleControlLaneIds,
    ...hostPromptStaleControlLaneIds,
    "stale-host-complete",
    "stale-host-complete-reload",
    "stale-host-complete-reconnect-recovery",
    ...hostGenericStaleControlLaneIds,
    ...hostPhaseStaleControlLaneIds,
  ]);
});

test("hardening lane cases share host race/reload IDs", () => {
  assert.deepEqual(hostRaceReloadLaneIds, [
    "concurrent-host-resolve-race",
    "concurrent-host-resolve-race-reload",
    "concurrent-host-advance-race",
    "concurrent-host-advance-race-reload",
    "concurrent-host-deadline-advance-race",
    "concurrent-host-deadline-advance-race-reload",
    "concurrent-host-mixed-advance-race",
    "concurrent-host-mixed-advance-race-reload",
  ]);
});

test("hardening lane cases share host/cohost stale recovery IDs", () => {
  assert.deepEqual(hostPhaseStaleRecoveryLaneIds, [
    "stale-host-resolve-reload",
    "stale-host-resolve-reconnect-recovery",
    "stale-host-advance-reload",
    "stale-host-advance-reconnect-recovery",
    "stale-host-deadline-reload",
    "stale-host-deadline-reconnect-recovery",
  ]);
  assert.deepEqual(cohostDeadlineRecoveryLaneIds, [
    "stale-cohost-deadline-reload",
    "stale-cohost-deadline-reconnect-recovery",
  ]);
});

test("hardening lane cases share seed-order host/cohost race recovery IDs", () => {
  assert.deepEqual(hostCohostRaceRecoveryLaneIds, [
    "concurrent-host-resolve-race",
    "concurrent-host-resolve-race-reload",
    "stale-host-resolve-reload",
    "stale-host-resolve-reconnect-recovery",
    "concurrent-host-advance-race",
    "concurrent-host-advance-race-reload",
    "stale-host-advance-reload",
    "stale-host-advance-reconnect-recovery",
    "stale-host-deadline-reload",
    "stale-host-deadline-reconnect-recovery",
    "stale-cohost-deadline-reload",
    "stale-cohost-deadline-reconnect-recovery",
    "concurrent-host-deadline-advance-race",
    "concurrent-host-deadline-advance-race-reload",
    "concurrent-host-mixed-advance-race",
    "concurrent-host-mixed-advance-race-reload",
  ]);
});

test("hardening lane cases share player action foundation IDs", () => {
  assert.deepEqual(playerActionFoundationLaneIds, [
    "idempotent-retry",
    "action-idempotent-retry",
    "concurrent-action-race",
    "concurrent-action-race-reload",
    "reconnect-recovery",
  ]);
});

test("hardening lane cases share stale player command IDs", () => {
  assert.deepEqual(stalePlayerCommandLaneIds, [
    "stale-player-vote",
    "stale-player-vote-after-change",
    "stale-player-withdraw-after-change",
    "stale-player-withdraw-after-phase-closure",
    "stale-player-vote-after-phase-closure",
    "stale-player-post-after-phase-closure",
  ]);
  assert.deepEqual(promotedStalePlayerCommandLaneIds, ["stale-player-vote"]);
});

test("hardening lane cases share player action conflict recovery IDs", () => {
  assert.deepEqual(playerActionConflictRecoveryLaneIds, [
    "stale-same-action-recovery",
    "stale-action-conflict",
    "stale-action-reconnect-recovery",
  ]);
});

test("hardening lane cases derive hosted stale-conflict matrix IDs", () => {
  assert.deepEqual(hostedMatrixStaleConflictLaneIds, [
    ...staleConflictMessageLaneIds,
    "stale-host-control",
  ]);
});

test("hardening lane cases derive hosted matrix reconnect IDs", () => {
  assert.deepEqual(hostedMatrixReconnectLaneIds, [
    "reconnect-recovery",
    "replacement-reconnect-recovery",
    "replacement-action-reconnect",
    "replacement-stale-private-post-reconnect",
    "stale-action-reconnect-recovery",
    "stale-host-complete-reconnect-recovery",
    "stale-host-resolve-reconnect-recovery",
    "stale-host-advance-reconnect-recovery",
    "stale-host-deadline-reconnect-recovery",
    "stale-cohost-deadline-reconnect-recovery",
  ]);
});
