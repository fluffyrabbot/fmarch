import {
  hostGenericStaleControlLaneIds,
} from "./dev_test_game_host_stale_control_scenarios.mjs";

export {
  cohostDeadlineRecoveryLaneIds,
  cohostDeadlineStaleControlCases,
  cohostDeadlineStaleControlCaseDefinitions,
  hostCohostRaceRecoveryLaneIds,
  hostGenericStaleControlLaneIds,
  hostPhaseStaleControlCaseDefinitions,
  hostPhaseStaleControlCases,
  hostPhaseStaleControlLaneIds,
  hostPhaseStaleRecoveryLaneIds,
  hostPromptStaleControlLaneIds,
  hostRaceReloadLaneIds,
  hostStandaloneStaleControlLaneIds,
  hostStaleControlLaneIds,
  hostedMatrixReconnectLaneIds,
} from "./dev_test_game_host_stale_control_scenarios.mjs";

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

export const hostedMatrixStaleConflictLaneIds = Object.freeze([
  ...staleConflictMessageLaneIds,
  ...hostGenericStaleControlLaneIds,
]);
