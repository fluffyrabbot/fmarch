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

export {
  playerActionConflictRecoveryLaneIds,
  playerActionFoundationLaneIds,
  promotedStalePlayerCommandLaneIds,
  stalePlayerCommandLaneIds,
} from "./dev_test_game_player_recovery_scenarios.mjs";

export const staleConflictMessageLaneIds = Object.freeze([
  "replacement-stale-conflict-message",
  "stale-action-conflict-message",
  "stale-dead-action-conflict",
]);

export const hostedMatrixStaleConflictLaneIds = Object.freeze([
  ...staleConflictMessageLaneIds,
  ...hostGenericStaleControlLaneIds,
]);
