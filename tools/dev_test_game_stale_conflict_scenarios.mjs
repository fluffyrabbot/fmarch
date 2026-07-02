import {
  hostGenericStaleControlLaneIds,
} from "./dev_test_game_host_stale_control_scenarios.mjs";

const cloneScenarioCase = (scenario) => ({ ...scenario });

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

export const staleConflictMessageSurfaceCaseDefinitions = Object.freeze([
  Object.freeze({
    id: "stale-action-conflict-message-surface",
    checkId: "stale-conflict-message-surface-stale-action-conflict-message",
    laneId: "stale-action-conflict-message",
    label: "Stale action conflict message surface",
    role: "player",
    expectedRejectError: "PhaseLocked",
    expectedTemplateId: "factional_kill",
    expectedStalePhase: "N01",
    expectedRefreshedPhase: "D02",
    expectedReceiptFragment: "stale action state",
    proofBoundary:
      "Seeded player role URL proof that a stale factional_kill action rejects with an explicit PhaseLocked conflict message and refreshes into current action controls.",
  }),
  Object.freeze({
    id: "stale-dead-action-conflict-surface",
    checkId: "stale-conflict-message-surface-stale-dead-action-conflict",
    laneId: "stale-dead-action-conflict",
    label: "Stale dead-action conflict message surface",
    role: "player",
    expectedRejectError: "SlotNotAlive",
    expectedTemplateId: "factional_kill",
    expectedStalePhase: "N01",
    expectedRejectMessageFragment: "actor is no longer alive",
    expectedActorStatusAfterReject: "dead",
    expectedActionVisibleAfterRefresh: false,
    expectedRestoredActorStatus: "alive",
    proofBoundary:
      "Seeded player role URL proof that a stale factional_kill action rejects after actor death with an explicit SlotNotAlive conflict message and refreshes with action controls removed.",
  }),
  Object.freeze({
    id: "stale-host-deadline-surface",
    checkId: "stale-conflict-message-surface-stale-host-deadline",
    laneId: "stale-host-deadline",
    label: "Stale host deadline conflict message surface",
    role: "host",
    expectedRejectError: "PhaseLocked",
    expectedStalePhase: "D01",
    expectedReceiptFragment: "stale phase state",
    expectedStaleClickActionId: "extend_deadline",
    expectedStaleClickRefreshKeys: ["host"],
    expectedActivitySource: "outcome",
    expectedPhaseId: "D02",
    expectedLocked: false,
    expectedDeadlineActions: ["extend_deadline"],
    expectedPhaseActions: ["lock_thread", "resolve_phase"],
    proofBoundary:
      "Seeded host role URL proof that a stale deadline control rejects with an explicit PhaseLocked conflict message and refreshes into current host phase controls.",
  }),
]);

export function staleConflictMessageSurfaceCases() {
  return staleConflictMessageSurfaceCaseDefinitions.map(cloneScenarioCase);
}

export function staleConflictMessageSurfaceCheckIds() {
  return staleConflictMessageSurfaceCases().map((scenario) => scenario.checkId);
}
