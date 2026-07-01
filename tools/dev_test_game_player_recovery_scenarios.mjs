import {
  completedPlayerRecoveryLaneIds as completedGamePlayerRecoveryLaneIds,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";

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

export const corePlayerRecoveryLaneIds = Object.freeze([
  "action-loop",
  "invalid-action-recovery",
  "dead-player-recovery",
  "player-action-boundary",
]);

export const playerRecoveryRaceLaneIds = Object.freeze([
  "concurrent-vote-race",
  "concurrent-vote-race-reload",
  "concurrent-player-vote-resolve-race",
  "concurrent-player-vote-resolve-race-reload",
  "concurrent-player-action-advance-race",
  "concurrent-player-action-advance-race-reload",
]);

export const completedPlayerRecoveryLaneIds = Object.freeze([
  ...completedGamePlayerRecoveryLaneIds(),
]);

export const playerActionConflictRecoveryLaneIds = Object.freeze([
  "stale-same-action-recovery",
  "stale-action-conflict",
  "stale-action-reconnect-recovery",
]);

export const playerRecoveryAuditLaneIds = Object.freeze([
  ...corePlayerRecoveryLaneIds,
  ...playerActionFoundationLaneIds,
  ...promotedStalePlayerCommandLaneIds,
  ...playerRecoveryRaceLaneIds,
  ...completedPlayerRecoveryLaneIds,
  "stale-dead-action-conflict",
  ...playerActionConflictRecoveryLaneIds,
  "stale-action-conflict-message",
]);
