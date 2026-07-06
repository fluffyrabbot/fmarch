import {
  hostResolvePhaseTransitionCase,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

export const dayThreeVoteResolutionLaneId = "day-vote-resolution";
export const coreLoopVoteResolutionFamilyId = "core-loop-vote-resolution";
export const coreLoopVoteResolutionLaneIds = Object.freeze([
  dayThreeVoteResolutionLaneId,
]);

export function dayVoteResolutionFeatureSpineRow({ cycleId }) {
  return {
    targetKey: "dayVoteResolution",
    featureSlotId: dayThreeVoteResolutionLaneId,
    cycleId,
    role: "actionPlayer",
    checkpointId: `${cycleId}-d02-deciding-vote-submitted`,
    adminCheckId: dayThreeVoteResolutionLaneId,
    seedMembership: "demoOnly",
    seedOrder: 10,
    seedRoleOverride: "actionPlayer",
  };
}

const cloneVoteResolutionSurfaceCase = (surfaceCase) => ({
  ...surfaceCase,
  transitionFragments: [...surfaceCase.transitionFragments],
  playerVoteCase: { ...surfaceCase.playerVoteCase },
  hostResolutionCase: { ...surfaceCase.hostResolutionCase },
});

const dayThreeVoteResolutionSurfaceCaseDefinition = Object.freeze({
  transitionFragments: Object.freeze([
    "player:submit_vote:ack:907",
    "host:resolve_phase:ack:908",
  ]),
  playerVoteCase: Object.freeze({
    surfaceTestId: "player-surface",
    clickedAction: "submit_vote",
    commandKind: "SubmitVote",
    actorSlot: "slot-7",
    targetSlot: "slot-4",
    targetLabel: "slot-4 / Rowan",
    streamSeq: 907,
    expectedPhaseId: "D03",
    previousOutcomePhaseId: "D02",
    expectedBoundaryText: "Day 3 vote ACK",
    expectedRefreshKeys: Object.freeze(["votecount", "commandState"]),
    setupResyncFromSeq: 906,
    expectedReceiptRefreshKeys: "votecount,commandState",
  }),
  hostResolutionCase: Object.freeze({
    surfaceTestId: "host-console-surface",
    targetLabel: "slot-4 / Rowan",
    expectedCount: 2,
    expectedNeeded: 2,
    expectedOutcomeIndex: 1,
    expectedOutcomePhaseId: "D03",
    expectedOutcomeStatus: "Lynch",
    expectedWinnerSlot: "slot-4",
    resolveCase: Object.freeze(
      hostResolvePhaseTransitionCase({
        streamSeq: 908,
        expectedPhaseId: "D03",
      }),
    ),
  }),
});

export function dayThreeVoteResolutionSurfaceCase() {
  return cloneVoteResolutionSurfaceCase(
    dayThreeVoteResolutionSurfaceCaseDefinition,
  );
}

export function coreLoopVoteResolutionScenarioFamily() {
  return {
    id: coreLoopVoteResolutionFamilyId,
    laneIds: [...coreLoopVoteResolutionLaneIds],
    surfaces: {
      dayThreeVoteResolution: dayThreeVoteResolutionSurfaceCase(),
    },
  };
}

export function assertDayThreeVoteResolutionSurfaceCase({
  dayThreeVoteResolutionSurface,
  expectedGame,
  assertHostPhaseTransitionActionProof,
  includeEvidenceInError = false,
}) {
  const surfaceCase = dayThreeVoteResolutionSurfaceCaseDefinition;
  if (
    dayThreeVoteResolutionSurface?.status !== "passed" ||
    dayThreeVoteResolutionSurface.clickedThroughFromRoleUrl !== true ||
    dayThreeVoteResolutionSurface.releaseReady !== false ||
    dayThreeVoteResolutionSurface.productionReady !== false ||
    typeof dayThreeVoteResolutionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !dayThreeVoteResolutionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof dayThreeVoteResolutionSurface.sourceHostRoleUrl !== "string" ||
    !dayThreeVoteResolutionSurface.sourceHostRoleUrl.includes("/g/") ||
    !dayThreeVoteResolutionSurface.sourceHostRoleUrl.endsWith("/host") ||
    !surfaceCase.transitionFragments.every((fragment) =>
      String(dayThreeVoteResolutionSurface.transition ?? "").includes(fragment),
    )
  ) {
    throwVoteResolutionAssertionError({
      message: "core-loop admin proof missing Day 3 vote resolution surface",
      evidence: dayThreeVoteResolutionSurface,
      includeEvidenceInError,
    });
  }
  assertDayThreePlayerVoteProofCase({
    proof: dayThreeVoteResolutionSurface.playerVoteProof,
    expectedGame,
    sourceRoleUrl: dayThreeVoteResolutionSurface.sourceActionPlayerRoleUrl,
    includeEvidenceInError,
  });
  assertDayThreeHostVoteResolutionProofCase({
    proof: dayThreeVoteResolutionSurface.hostResolutionProof,
    expectedGame,
    sourceRoleUrl: dayThreeVoteResolutionSurface.sourceHostRoleUrl,
    assertHostPhaseTransitionActionProof,
    includeEvidenceInError,
  });
}

export function assertDayThreePlayerVoteProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  includeEvidenceInError = false,
}) {
  const voteCase = dayThreeVoteResolutionSurfaceCaseDefinition.playerVoteCase;
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
    proof.command.target?.Slot !== voteCase.targetSlot ||
    proof.commandStatus?.state !== "ack" ||
    !proof.commandStatus?.message?.includes(
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
    proof.projectionCommandState?.phase?.phaseId !== voteCase.expectedPhaseId ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.currentVote?.slotId !== voteCase.targetSlot ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      voteCase.expectedBoundaryText,
    ) ||
    proof.projectionVotecount?.[0]?.target !== voteCase.targetLabel ||
    proof.projectionVotecount?.[0]?.count !==
      dayThreeVoteResolutionSurfaceCaseDefinition.hostResolutionCase
        .expectedCount ||
    proof.projectionVotecount?.[0]?.needed !==
      dayThreeVoteResolutionSurfaceCaseDefinition.hostResolutionCase
        .expectedNeeded ||
    proof.projectionDayVoteOutcomes?.[0]?.phaseId !==
      voteCase.previousOutcomePhaseId ||
    proof.setupResyncFromSeq !== voteCase.setupResyncFromSeq ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== voteCase.expectedPhaseId ||
    proof.currentVote?.hasVote !== "true" ||
    !String(proof.currentVote?.text ?? "").includes("Slot 4") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(`ack: stream seqs ${voteCase.streamSeq}`) ||
    proof.receiptRefreshKeys !== voteCase.expectedReceiptRefreshKeys
  ) {
    throwVoteResolutionAssertionError({
      message: "core-loop admin proof missing Day 3 player vote ACK",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertDayThreeHostVoteResolutionProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  assertHostPhaseTransitionActionProof,
  includeEvidenceInError = false,
}) {
  const hostCase = dayThreeVoteResolutionSurfaceCaseDefinition.hostResolutionCase;
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== hostCase.surfaceTestId ||
    proof.hostVotecountProjection?.[0]?.target !== hostCase.targetLabel ||
    proof.hostVotecountProjection?.[0]?.count !== hostCase.expectedCount ||
    proof.hostVotecountProjection?.[0]?.needed !== hostCase.expectedNeeded ||
    proof.hostDayVoteOutcomesProjection?.[hostCase.expectedOutcomeIndex]?.phaseId !==
      hostCase.expectedOutcomePhaseId ||
    proof.hostDayVoteOutcomesProjection?.[hostCase.expectedOutcomeIndex]?.status !==
      hostCase.expectedOutcomeStatus ||
    proof.hostDayVoteOutcomesProjection?.[hostCase.expectedOutcomeIndex]
      ?.winnerSlot !== hostCase.expectedWinnerSlot
  ) {
    throwVoteResolutionAssertionError({
      message: "core-loop admin proof missing Day 3 host vote resolution surface",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.resolveProof,
    expectedGame,
    ...hostCase.resolveCase,
    sourceRoleUrl,
    includeEvidenceInError,
  });
  if (
    proof.resolveProof?.votecountProjection?.[0]?.target !== hostCase.targetLabel ||
    proof.resolveProof?.dayVoteOutcomesProjection?.[hostCase.expectedOutcomeIndex]
      ?.phaseId !== hostCase.expectedOutcomePhaseId
  ) {
    throwVoteResolutionAssertionError({
      message: "core-loop admin proof missing Day 3 host resolve projections",
      evidence: proof.resolveProof,
      includeEvidenceInError,
    });
  }
}

function throwVoteResolutionAssertionError({
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
