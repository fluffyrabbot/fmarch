import {
  hostGenericStaleControlLaneIds,
} from "./dev_test_game_host_stale_control_scenarios.mjs";
import {
  hardeningStaleConflictHighlightedLaneIds,
  staleConflictMessageLaneIds,
} from "./dev_test_game_stale_conflict_scenarios.mjs";
import {
  staleClientReconnectHighlightedLaneIds,
  staleClientReconnectLaneIds,
} from "./dev_test_game_stale_client_reconnect_scenarios.mjs";

export {
  assertStaleConflictMessageCoverageSummary,
  assertStaleConflictMessageSurfaceCoverage,
  buildStaleConflictMessageCoverageSummary,
  hardeningStaleConflictHighlightedLaneIds,
  privateChannelStaleActionConflictMessageLaneId,
  privateChannelStaleActionConflictMessageSpineLaneCase,
  replacementStaleConflictMessageLaneId,
  replacementStaleConflictMessageSpineLaneCase,
  staleConflictMessageSpineTargetCases,
  staleActionConflictMessageLaneId,
  staleCohostDeadlineConflictLaneId,
  staleConflictMessageCoverageFamilies,
  staleConflictMessageCoverageFamilyDefinitions,
  staleConflictMessageLaneIds,
  staleConflictMessageNoSurfaceYetCases,
  staleConflictMessageStatusExpectationForLane,
  staleConflictMessageStatusExpectations,
  staleConflictMessageSurfaceCases,
  staleConflictMessageSurfaceCheckIds,
  staleDeadActionConflictLaneId,
  staleHostDeadlineConflictLaneId,
} from "./dev_test_game_stale_conflict_scenarios.mjs";

export {
  cohostStaleDeadlineReconnectLaneId,
  completedHostStaleCompleteReconnectLaneId,
  hostStaleAdvanceReconnectLaneId,
  hostStaleDeadlineReconnectLaneId,
  hostStaleReconnectExpectationForLane,
  hostStaleReconnectExpectations,
  hostStaleResolveReconnectLaneId,
  playerLiveReconnectLaneId,
  privateChannelStaleActionReconnectExpectation,
  privateChannelStaleActionReconnectLaneId,
  replacementActionReconnectLaneId,
  replacementPrivatePostReconnectLaneId,
  replacementSessionReconnectLaneId,
  reconnectHardeningSpineTargetCases,
  staleClientReconnectCaseDefinitions,
  staleClientReconnectCases,
  staleClientReconnectHighlightedLaneIds,
  staleClientReconnectLaneIds,
  stalePlayerActionReconnectExpectation,
  stalePlayerActionReconnectLaneId,
} from "./dev_test_game_stale_client_reconnect_scenarios.mjs";

const uniqueLaneIds = (laneIds) => Object.freeze([...new Set(laneIds)]);

export const hardeningRecoveryAuditLaneIds = uniqueLaneIds([
  ...staleConflictMessageLaneIds,
  ...staleClientReconnectLaneIds(),
]);

export const hardeningRecoveryHighlightedLaneIds = uniqueLaneIds([
  ...hardeningStaleConflictHighlightedLaneIds,
  ...staleClientReconnectHighlightedLaneIds,
]);

export const hostedMatrixReconnectLaneIds = Object.freeze(
  staleClientReconnectLaneIds(),
);

export const hostedMatrixStaleConflictLaneIds = uniqueLaneIds([
  ...staleConflictMessageLaneIds,
  ...hostGenericStaleControlLaneIds,
]);

export const hostedMatrixRecoveryLaneIds = uniqueLaneIds([
  ...hostedMatrixReconnectLaneIds,
  ...hostedMatrixStaleConflictLaneIds,
]);
