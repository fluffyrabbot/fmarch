import {
  assertDayFourNoLynchHostTransitionProofCase,
  dayFourNoLynchHostTransitionProofCase,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  dayFiveNoLynchResolutionSurfaceCase,
} from "./dev_test_game_core_loop_day_five_progression_scenarios.mjs";

export {
  assertDayFourNoLynchHostTransitionProofCase,
  dayFourNoLynchHostTransitionProofCase,
};

export const coreLoopNoLynchProgressionFamilyId =
  "core-loop-no-lynch-progression";

export const coreLoopNoLynchProgressionLaneIds = Object.freeze([
  "day-vote-no-lynch",
  "action-loop",
]);

const coreLoopNoLynchProgressionScenarioCaseDefinitions = Object.freeze([
  Object.freeze({
    key: "dayFourNoLynchResolution",
    group: "surfaces",
    laneIds: Object.freeze(["day-vote-no-lynch", "action-loop"]),
    buildScenario: dayFourNoLynchResolutionSurfaceCase,
  }),
  Object.freeze({
    key: "dayFiveNoLynchResolution",
    group: "surfaces",
    laneIds: Object.freeze(["day-vote-no-lynch", "action-loop"]),
    buildScenario: dayFiveNoLynchResolutionSurfaceCase,
  }),
  Object.freeze({
    key: "staleDayFiveVote",
    group: "staleRejects",
    laneIds: Object.freeze(["action-loop"]),
    buildScenario: () =>
      dayFiveNoLynchResolutionSurfaceCase().staleDayFiveVoteCase,
  }),
]);

const cloneNoLynchProgressionScenarioCase = (scenarioCase) => ({
  key: scenarioCase.key,
  group: scenarioCase.group,
  laneIds: [...scenarioCase.laneIds],
  scenario: scenarioCase.buildScenario(),
});

export function coreLoopNoLynchProgressionScenarioCases() {
  return coreLoopNoLynchProgressionScenarioCaseDefinitions.map(
    cloneNoLynchProgressionScenarioCase,
  );
}

const dayFourNoLynchVoteProofCaseDefinition = Object.freeze({
  surfaceTestId: "player-surface",
  clickedAction: "submit_vote:no_lynch",
  commandKind: "SubmitVote",
  actorSlot: "slot-7",
  target: "NoLynch",
  setupResyncFromSeq: 911,
  setupPhaseId: "D04",
  streamSeq: 912,
  expectedRefreshKeys: Object.freeze(["votecount", "commandState"]),
  expectedBoundaryText: "Day 4 no-lynch vote ACK",
  expectedVotecountTarget: "No lynch",
  expectedVotecountCount: 1,
  expectedVotecountNeeded: 1,
  expectedPriorDayVoteOutcomePhaseId: "D03",
  expectedReceiptRefreshKeys: "votecount,commandState",
});

export function dayFourNoLynchVoteProofCase() {
  return {
    ...dayFourNoLynchVoteProofCaseDefinition,
    expectedRefreshKeys: [
      ...dayFourNoLynchVoteProofCaseDefinition.expectedRefreshKeys,
    ],
  };
}

export function dayFourNoLynchResolutionSurfaceCase() {
  return {
    transitionFragments: [
      "player:D04:no_lynch:ack:912",
      "host:D04:resolve_phase:ack:913",
      "host:advance_phase:ack:914",
    ],
    voteCase: dayFourNoLynchVoteProofCase(),
    hostTransitionCase: dayFourNoLynchHostTransitionProofCase(),
  };
}

export function coreLoopNoLynchProgressionScenarioFamily() {
  const scenarioCases = coreLoopNoLynchProgressionScenarioCases();
  return {
    id: coreLoopNoLynchProgressionFamilyId,
    laneIds: [...coreLoopNoLynchProgressionLaneIds],
    surfaces: Object.fromEntries(
      scenarioCases
        .filter((scenarioCase) => scenarioCase.group === "surfaces")
        .map((scenarioCase) => [scenarioCase.key, scenarioCase.scenario]),
    ),
    staleRejects: Object.fromEntries(
      scenarioCases
        .filter((scenarioCase) => scenarioCase.group === "staleRejects")
        .map((scenarioCase) => [scenarioCase.key, scenarioCase.scenario]),
    ),
  };
}

export function assertDayFourNoLynchVoteProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  includeEvidenceInError = false,
}) {
  const voteCase = dayFourNoLynchVoteProofCaseDefinition;
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyReceiptVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== voteCase.surfaceTestId ||
    proof.clickedAction !== voteCase.clickedAction ||
    proof.commandKind !== voteCase.commandKind ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== voteCase.actorSlot ||
    proof.command.target !== voteCase.target ||
    proof.commandStatus?.state !== "ack" ||
    !String(proof.commandStatus?.message ?? "").includes(
      `Ack: stream seqs ${voteCase.streamSeq}`,
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== voteCase.commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(
      proof.bridgePlan.projectionRefreshKeys,
      voteCase.expectedRefreshKeys,
    ) ||
    proof.receipts?.at?.(-1)?.state !== "ack" ||
    proof.projectionCommandState?.actorSlot !== voteCase.actorSlot ||
    proof.projectionCommandState?.phase?.phaseId !== voteCase.setupPhaseId ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.currentVote?.kind !== "no_lynch" ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      voteCase.expectedBoundaryText,
    ) ||
    proof.projectionVotecount?.[0]?.target !==
      voteCase.expectedVotecountTarget ||
    proof.projectionVotecount?.[0]?.count !== voteCase.expectedVotecountCount ||
    proof.projectionVotecount?.[0]?.needed !==
      voteCase.expectedVotecountNeeded ||
    proof.projectionDayVoteOutcomes?.at?.(-1)?.phaseId !==
      voteCase.expectedPriorDayVoteOutcomePhaseId ||
    proof.setupResyncFromSeq !== voteCase.setupResyncFromSeq ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== voteCase.setupPhaseId ||
    proof.currentVote?.hasVote !== "true" ||
    !String(proof.currentVote?.text ?? "").includes("No lynch") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(`ack: stream seqs ${voteCase.streamSeq}`) ||
    proof.receiptRefreshKeys !== voteCase.expectedReceiptRefreshKeys
  ) {
    throwNoLynchProgressionAssertionError({
      message: "core-loop admin proof missing Day 4 no-lynch vote ACK",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

function throwNoLynchProgressionAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}

function sameStringArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}
