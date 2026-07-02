import {
  hostGenericStaleControlLaneIds,
} from "./dev_test_game_host_stale_control_scenarios.mjs";

export const staleConflictMessageLaneIds = Object.freeze([
  "replacement-stale-conflict-message",
  "stale-action-conflict-message",
  "stale-dead-action-conflict",
  "stale-host-deadline",
  "stale-cohost-deadline",
]);

export const hostedMatrixStaleConflictLaneIds = Object.freeze([
  ...staleConflictMessageLaneIds,
  ...hostGenericStaleControlLaneIds,
]);
