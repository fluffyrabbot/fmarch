import {
  hostGenericStaleControlLaneIds,
} from "./dev_test_game_host_stale_control_scenarios.mjs";
import {
  assertLaneCoverageSummary,
  buildLaneCoverageSummary,
  cloneLaneCoverageFamilies,
} from "./dev_test_game_lane_coverage.mjs";
import {
  staleActionConflictLaneId,
  staleSameActionRecoveryLaneId,
} from "./dev_test_game_player_recovery_scenarios.mjs";

const cloneScenarioCase = (scenario) => ({ ...scenario });
const cloneStatusExpectation = (expectation) => ({ ...expectation });

export const replacementStaleConflictMessageLaneId =
  "replacement-stale-conflict-message";
export const staleActionConflictMessageLaneId =
  "stale-action-conflict-message";
export const staleDeadActionConflictLaneId = "stale-dead-action-conflict";
export const staleHostDeadlineConflictLaneId = "stale-host-deadline";
export const staleCohostDeadlineConflictLaneId = "stale-cohost-deadline";

export const staleConflictMessageLaneIds = Object.freeze([
  replacementStaleConflictMessageLaneId,
  staleActionConflictMessageLaneId,
  staleDeadActionConflictLaneId,
  staleHostDeadlineConflictLaneId,
  staleCohostDeadlineConflictLaneId,
]);

export const staleConflictMessageCoverageFamilyDefinitions = Object.freeze([
  Object.freeze({
    id: "replacement-conflict-message",
    label: "Replacement stale conflict message",
    laneIds: Object.freeze([replacementStaleConflictMessageLaneId]),
  }),
  Object.freeze({
    id: "player-action-conflict-messages",
    label: "Player action stale conflict messages",
    laneIds: Object.freeze([
      staleActionConflictMessageLaneId,
      staleDeadActionConflictLaneId,
    ]),
  }),
  Object.freeze({
    id: "host-deadline-conflict-messages",
    label: "Host deadline stale conflict messages",
    laneIds: Object.freeze([
      staleHostDeadlineConflictLaneId,
      staleCohostDeadlineConflictLaneId,
    ]),
  }),
]);

export function staleConflictMessageCoverageFamilies() {
  return cloneLaneCoverageFamilies(
    staleConflictMessageCoverageFamilyDefinitions,
  );
}

export function buildStaleConflictMessageCoverageSummary(lanes) {
  return buildLaneCoverageSummary({
    lanes,
    laneIds: staleConflictMessageLaneIds,
    families: staleConflictMessageCoverageFamilyDefinitions,
  });
}

export function assertStaleConflictMessageCoverageSummary({ summary, lanes }) {
  return assertLaneCoverageSummary({
    summary,
    lanes,
    laneIds: staleConflictMessageLaneIds,
    familyDefinitions: staleConflictMessageCoverageFamilyDefinitions,
    label: "stale conflict-message",
  });
}

export const hostedMatrixStaleConflictLaneIds = Object.freeze([
  ...staleConflictMessageLaneIds,
  ...hostGenericStaleControlLaneIds,
]);

export const staleConflictMessageSurfaceCaseDefinitions = Object.freeze([
  Object.freeze({
    id: "replacement-stale-conflict-message-surface",
    checkId: "stale-conflict-message-surface-replacement-stale-conflict-message",
    laneId: replacementStaleConflictMessageLaneId,
    label: "Replacement stale conflict message surface",
    role: "host",
    expectedRejectError: "InvalidTarget",
    expectedReceiptFragment: "replacement target is stale",
    expectedActionId: "process_replacement_stale_success",
    expectedActivitySource: "outcome",
    expectedDispatchKind: "process_replacement",
    expectedCommandOutgoing: "player-mira",
    expectedCurrentOccupant: "player-rowan",
    proofBoundary:
      "Seeded host role URL proof that a stale replacement command rejects with an explicit InvalidTarget conflict message and preserves the current slot occupant.",
  }),
  Object.freeze({
    id: "stale-action-conflict-message-surface",
    checkId: "stale-conflict-message-surface-stale-action-conflict-message",
    laneId: staleActionConflictMessageLaneId,
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
    laneId: staleDeadActionConflictLaneId,
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
    laneId: staleHostDeadlineConflictLaneId,
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
  Object.freeze({
    id: "stale-cohost-deadline-surface",
    checkId: "stale-conflict-message-surface-stale-cohost-deadline",
    laneId: staleCohostDeadlineConflictLaneId,
    label: "Stale cohost deadline conflict message surface",
    role: "cohost",
    expectedRejectError: "PhaseLocked",
    expectedStalePhase: "D01",
    expectedReceiptFragment: "stale phase state",
    expectedStaleClickActionId: "extend_deadline",
    expectedStaleClickRefreshKeys: ["host"],
    expectedActivitySource: "outcome",
    expectedPhaseId: "D02",
    expectedCurrentActions: ["extend_deadline"],
    proofBoundary:
      "Seeded cohost role URL proof that a delegated stale deadline control rejects with an explicit PhaseLocked conflict message and refreshes into current delegated controls.",
  }),
]);

export const staleConflictMessageNoSurfaceYetDefinitions = Object.freeze([]);

export function staleConflictMessageSurfaceCases() {
  return staleConflictMessageSurfaceCaseDefinitions.map(cloneScenarioCase);
}

export function replacementStaleConflictMessageSpineLaneCase() {
  const cases = staleConflictMessageSurfaceCases().filter(
    (scenario) => scenario.laneId === replacementStaleConflictMessageLaneId,
  );
  if (cases.length !== 1) {
    throw new Error("replacement stale conflict-message spine lane drifted");
  }
  return cloneScenarioCase(cases[0]);
}

export function staleConflictMessageSurfaceCheckIds() {
  return staleConflictMessageSurfaceCases().map((scenario) => scenario.checkId);
}

export function staleConflictMessageNoSurfaceYetCases() {
  return staleConflictMessageNoSurfaceYetDefinitions.map(cloneScenarioCase);
}

function actionConflictReceiptText({ rejectError, receiptFragment }) {
  const reason = rejectError === "InvalidTarget" ? "invalid target" : "phase locked";
  return `Reject ${rejectError}: ${reason}; ${receiptFragment}, refresh and use current action controls`;
}

function conflictStatusExpectation(scenario) {
  if (scenario.laneId === staleActionConflictMessageLaneId) {
    return Object.freeze({
      laneId: scenario.laneId,
      role: scenario.role,
      rejectError: scenario.expectedRejectError,
      receiptStatusText: actionConflictReceiptText({
        rejectError: scenario.expectedRejectError,
        receiptFragment: scenario.expectedReceiptFragment,
      }),
      refreshedPhase: scenario.expectedRefreshedPhase,
    });
  }
  if (scenario.laneId === staleDeadActionConflictLaneId) {
    return Object.freeze({
      laneId: scenario.laneId,
      role: scenario.role,
      rejectError: scenario.expectedRejectError,
      rejectMessageFragment: scenario.expectedRejectMessageFragment,
      actorStatusAfterReject: scenario.expectedActorStatusAfterReject,
      actionVisibleAfterRefresh: scenario.expectedActionVisibleAfterRefresh,
    });
  }
  if (scenario.laneId === replacementStaleConflictMessageLaneId) {
    return Object.freeze({
      laneId: scenario.laneId,
      role: scenario.role,
      rejectError: scenario.expectedRejectError,
      receiptFragment: scenario.expectedReceiptFragment,
      currentOccupant: scenario.expectedCurrentOccupant,
    });
  }
  return Object.freeze({
    laneId: scenario.laneId,
    role: scenario.role,
    rejectError: scenario.expectedRejectError,
    receiptFragment: scenario.expectedReceiptFragment,
  });
}

export const staleConflictMessageStatusExpectationDefinitions = Object.freeze(
  staleConflictMessageSurfaceCaseDefinitions.map(conflictStatusExpectation),
);

export function staleConflictMessageStatusExpectations() {
  return staleConflictMessageStatusExpectationDefinitions.map(
    cloneStatusExpectation,
  );
}

export function staleConflictMessageStatusExpectationForLane(laneId) {
  const expectation = staleConflictMessageStatusExpectationDefinitions.find(
    (candidate) => candidate.laneId === laneId,
  );
  if (expectation === undefined) {
    throw new Error(`unknown stale conflict-message status lane: ${laneId}`);
  }
  return cloneStatusExpectation(expectation);
}

export const hardeningStaleConflictHighlightedLaneIds = Object.freeze([
  staleSameActionRecoveryLaneId,
  staleDeadActionConflictLaneId,
  staleActionConflictLaneId,
  staleActionConflictMessageLaneId,
]);

export function assertStaleConflictMessageSurfaceCoverage() {
  const expectedLaneIds = new Set(staleConflictMessageLaneIds);
  const surfaceLaneIds = staleConflictMessageSurfaceCases().map(
    (scenario) => scenario.laneId,
  );
  const noSurfaceYetLaneIds = staleConflictMessageNoSurfaceYetCases().map(
    (scenario) => scenario.laneId,
  );
  const coveredLaneIds = new Set([...surfaceLaneIds, ...noSurfaceYetLaneIds]);
  const duplicateLaneIds = [...surfaceLaneIds, ...noSurfaceYetLaneIds].filter(
    (laneId, index, laneIds) => laneIds.indexOf(laneId) !== index,
  );
  const missingLaneIds = staleConflictMessageLaneIds.filter(
    (laneId) => !coveredLaneIds.has(laneId),
  );
  const unexpectedLaneIds = [...coveredLaneIds].filter(
    (laneId) => !expectedLaneIds.has(laneId),
  );
  const missingNoSurfaceYetReasons = staleConflictMessageNoSurfaceYetCases()
    .filter(
      (scenario) =>
        typeof scenario.noSurfaceYet !== "string" ||
        scenario.noSurfaceYet.trim() === "",
    )
    .map((scenario) => scenario.laneId);

  if (
    duplicateLaneIds.length > 0 ||
    missingLaneIds.length > 0 ||
    unexpectedLaneIds.length > 0 ||
    missingNoSurfaceYetReasons.length > 0
  ) {
    throw new Error(
      [
        "stale conflict-message surface coverage drifted",
        `duplicates=${duplicateLaneIds.join(",") || "none"}`,
        `missing=${missingLaneIds.join(",") || "none"}`,
        `unexpected=${unexpectedLaneIds.join(",") || "none"}`,
        `missingNoSurfaceYetReasons=${
          missingNoSurfaceYetReasons.join(",") || "none"
        }`,
      ].join("; "),
    );
  }
}
