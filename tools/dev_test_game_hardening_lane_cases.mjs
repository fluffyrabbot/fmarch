import {
  completedHostStaleCommandHardeningLaneIds,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";

export const staleConflictMessageLaneIds = Object.freeze([
  "replacement-stale-conflict-message",
  "stale-action-conflict-message",
  "stale-dead-action-conflict",
]);

export const playerActionFoundationLaneIds = Object.freeze([
  "idempotent-retry",
  "action-idempotent-retry",
  "concurrent-action-race",
  "concurrent-action-race-reload",
  "reconnect-recovery",
]);

export const stalePlayerCommandLaneIds = Object.freeze([
  "stale-player-vote",
  "stale-player-vote-after-change",
  "stale-player-withdraw-after-change",
  "stale-player-withdraw-after-phase-closure",
  "stale-player-vote-after-phase-closure",
  "stale-player-post-after-phase-closure",
]);

export const promotedStalePlayerCommandLaneIds = Object.freeze(
  stalePlayerCommandLaneIds.slice(0, 1),
);

export const playerActionConflictRecoveryLaneIds = Object.freeze([
  "stale-same-action-recovery",
  "stale-action-conflict",
  "stale-action-reconnect-recovery",
]);

export const hostStaleControlLaneIds = Object.freeze([
  "stale-host-publish",
  "stale-host-lifecycle",
  "stale-host-modkill",
  "stale-host-prompt",
  "stale-host-prompt-reload",
  ...completedHostStaleCommandHardeningLaneIds(),
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

export const hostedMatrixStaleConflictLaneIds = Object.freeze([
  ...staleConflictMessageLaneIds,
  "stale-host-control",
]);
