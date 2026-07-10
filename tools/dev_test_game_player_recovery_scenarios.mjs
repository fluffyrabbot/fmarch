import {
  completedPlayerRecoveryLaneIds as completedGamePlayerRecoveryLaneIds,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";
import {
  playerHostRaceLaneIds,
} from "./dev_test_game_cross_role_race_scenarios.mjs";
import {
  playerLiveLagResyncLaneId,
  playerLiveReconnectLaneId,
  privateChannelStaleActionReconnectLaneId,
  stalePlayerActionReconnectLaneId,
} from "./dev_test_game_stale_client_reconnect_scenarios.mjs";

const cloneStatusExpectation = (expectation) => ({ ...expectation });
const cloneSpineTargetCase = (target) => ({ ...target });

export const idempotentRetryLaneId = "idempotent-retry";
export const actionIdempotentRetryLaneId = "action-idempotent-retry";
export const concurrentActionRaceLaneId = "concurrent-action-race";
export const concurrentActionRaceReloadLaneId = "concurrent-action-race-reload";
export const staleSameActionRecoveryLaneId = "stale-same-action-recovery";
export const staleActionConflictLaneId = "stale-action-conflict";

export const playerActionFoundationLaneIds = Object.freeze([
  idempotentRetryLaneId,
  actionIdempotentRetryLaneId,
  concurrentActionRaceLaneId,
  concurrentActionRaceReloadLaneId,
  playerLiveReconnectLaneId,
  playerLiveLagResyncLaneId,
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
  ...playerHostRaceLaneIds,
]);

export const completedPlayerRecoveryLaneIds = Object.freeze([
  ...completedGamePlayerRecoveryLaneIds(),
]);

export const playerActionConflictRecoveryLaneIds = Object.freeze([
  staleSameActionRecoveryLaneId,
  staleActionConflictLaneId,
  stalePlayerActionReconnectLaneId,
  privateChannelStaleActionReconnectLaneId,
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

export const hardeningPlayerRecoveryHighlightedLaneIds = Object.freeze([
  concurrentActionRaceLaneId,
  concurrentActionRaceReloadLaneId,
]);

export const playerRecoveryStatusExpectationDefinitions = Object.freeze([
  Object.freeze({
    laneId: concurrentActionRaceLaneId,
    ackState: "ack",
    rejectError: "ActionAlreadySubmitted",
  }),
  Object.freeze({
    laneId: concurrentActionRaceReloadLaneId,
    targetSlot: "slot-2",
    apiTargetAlive: false,
  }),
  Object.freeze({
    laneId: staleSameActionRecoveryLaneId,
    rejectError: "ActionAlreadySubmitted",
    refreshedPhase: "N01",
    actionVisibleAfterRefresh: false,
  }),
  Object.freeze({
    laneId: staleActionConflictLaneId,
    rejectError: "PhaseLocked",
    refreshedPhase: "D02",
    actionVisibleAfterRefresh: false,
  }),
]);

const playerActionConflictSpineTargetCaseDefinitions = Object.freeze([
  Object.freeze({
    targetKey: "staleSameActionRecovery",
    sourceFactory: "playerActionConflictSpineTargetCases",
    laneId: staleSameActionRecoveryLaneId,
    featureSlotId: staleSameActionRecoveryLaneId,
    roleUrlId: staleSameActionRecoveryLaneId,
    checkpointId: staleSameActionRecoveryLaneId,
    adminCheckId: staleSameActionRecoveryLaneId,
  }),
]);

export function playerActionConflictSpineTargetCases() {
  return playerActionConflictSpineTargetCaseDefinitions.map(cloneSpineTargetCase);
}

export function playerRecoveryStatusExpectations() {
  return playerRecoveryStatusExpectationDefinitions.map(cloneStatusExpectation);
}

export function playerRecoveryStatusExpectationForLane(laneId) {
  const expectation = playerRecoveryStatusExpectationDefinitions.find(
    (candidate) => candidate.laneId === laneId,
  );
  if (expectation === undefined) {
    throw new Error(`unknown player recovery status lane: ${laneId}`);
  }
  return cloneStatusExpectation(expectation);
}
