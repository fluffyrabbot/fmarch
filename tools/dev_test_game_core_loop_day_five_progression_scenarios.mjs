import {
  hostAdvancePhaseCommandFacts,
  hostResolvePhaseCommandFacts,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

export const coreLoopDayFiveProgressionFamilyId =
  "core-loop-day-five-progression";
export const coreLoopDayFiveProgressionAdminCheckId = "core-loop";
export const coreLoopDayFiveProgressionCycleId = "d05-n05";
export const dayFiveNoLynchVoteSubmittedLaneId =
  "day-five-no-lynch-vote-submitted";
export const dayFiveNoLynchResolutionLaneId =
  "day-five-no-lynch-resolution";
export const nightFiveNoActionSurfaceLaneId = "night-five-no-action-surface";

export const coreLoopDayFiveProgressionLaneIds = Object.freeze([
  "day-vote-no-lynch",
  "action-loop",
]);

const dayFiveProgressionFeatureRowDefinitions = Object.freeze([
  Object.freeze({
    targetKey: "dayFiveNoLynchVoteSubmitted",
    featureSlotId: dayFiveNoLynchVoteSubmittedLaneId,
    role: "actionPlayer",
    checkpointId: "d05-no-lynch-vote-submitted",
  }),
  Object.freeze({
    targetKey: "dayFiveNoLynchResolution",
    featureSlotId: dayFiveNoLynchResolutionLaneId,
    role: "host",
    checkpointId: "d05-resolved-no-lynch",
  }),
  Object.freeze({
    targetKey: "nightFiveNoActionSurface",
    featureSlotId: nightFiveNoActionSurfaceLaneId,
    role: "actionPlayer",
    checkpointId: "n05-night-controls-return",
  }),
]);

const coreLoopDayFiveProgressionScenarioCaseDefinitions = Object.freeze([
  Object.freeze({
    key: "dayFiveNoLynchResolution",
    group: "surfaces",
    laneIds: Object.freeze([...coreLoopDayFiveProgressionLaneIds]),
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

const cloneDayFiveProgressionScenarioCase = (scenarioCase) => ({
  key: scenarioCase.key,
  group: scenarioCase.group,
  laneIds: [...scenarioCase.laneIds],
  scenario: scenarioCase.buildScenario(),
});

const cloneFeatureRow = (row) => ({ ...row });

export function coreLoopDayFiveProgressionScenarioCases() {
  return coreLoopDayFiveProgressionScenarioCaseDefinitions.map(
    cloneDayFiveProgressionScenarioCase,
  );
}

export function dayFiveProgressionFeatureSpineRows({
  cycleId = coreLoopDayFiveProgressionCycleId,
} = {}) {
  return dayFiveProgressionFeatureRowDefinitions.map((scenario) =>
    cloneFeatureRow(featureRowFromCase(scenario, { cycleId })),
  );
}

const dayFiveNoLynchResolutionSurfaceCaseDefinition = Object.freeze({
  transitionFragments: Object.freeze([
    "player:D05:no_lynch:ack:918",
    "host:D05:resolve_phase:ack:919",
    "host:advance_phase:ack:920",
    "actionPlayer:N05:no_action",
    "stale:D05:submit_vote:reject:PhaseLocked",
  ]),
  voteCase: Object.freeze({
    surfaceTestId: "player-surface",
    clickedAction: "submit_vote:no_lynch",
    commandKind: "SubmitVote",
    actorSlot: "slot-7",
    target: "NoLynch",
    setupResyncFromSeq: 917,
    setupPhaseId: "D05",
    streamSeq: 918,
    expectedRefreshKeys: Object.freeze(["votecount", "commandState"]),
    expectedBoundaryText: "Day 5 no-lynch vote ACK",
    expectedVotecountTarget: "No lynch",
    expectedVotecountCount: 1,
    expectedVotecountNeeded: 1,
    expectedPriorDayVoteOutcomePhaseId: "D04",
  }),
  hostTransitionCase: Object.freeze({
    surfaceTestId: "host-console-surface",
    setupResyncFromSeq: 918,
    setupPhaseId: "D05",
    setupPhaseState: "open",
    expectedVotecountTarget: "No lynch",
    expectedDayVoteOutcomePhaseId: "D05",
    expectedDayVoteOutcomeStatus: "NoLynch",
    resolveCase: Object.freeze({
      ...hostResolvePhaseCommandFacts(),
      streamSeq: 919,
      expectedPhaseId: "D05",
      expectedPhaseState: "locked",
      expectedDeadlineAffordance: "unlock_thread,advance_phase",
      expectedRefreshKeys: Object.freeze([
        "host",
        "votecount",
        "dayVoteOutcomes",
        "hostPrompts",
      ]),
    }),
    advanceCase: Object.freeze({
      ...hostAdvancePhaseCommandFacts(),
      streamSeq: 920,
      expectedPhaseId: "N05",
      expectedPhaseState: "open",
      expectedDeadlineAffordance: "resolve_phase,lock_thread",
      expectedRefreshKeys: Object.freeze([]),
    }),
  }),
  actionPlayerNightFiveCase: Object.freeze({
    proofField: "actionPlayerNightFiveProof",
    sourceRoleUrlField: "sourceActionPlayerRoleUrl",
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "N05",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "open Night 5 with no legal action",
    expectedResyncFromSeq: 920,
    expectedLastVoteOutcomePhaseId: "D05",
  }),
  staleDayFiveVoteCase: Object.freeze({
    surfaceTestId: "player-surface",
    clickedAction: "submit_vote:no_lynch",
    commandKind: "SubmitVote",
    actorSlot: "slot-7",
    target: "NoLynch",
    setupResyncFromSeq: 918,
    setupPhaseId: "D05",
    finalState: "reject",
    error: "PhaseLocked",
    messageIncludes: "stale vote state, refresh and use current vote controls",
    expectedRefreshKeys: Object.freeze([
      "votecount",
      "commandState",
      "dayVoteOutcomes",
    ]),
    refreshedPhaseId: "N05",
    refreshedBoundary: "stale D05 vote refreshed into current Night 5 controls",
    checkpointReceiptState: "reject:PhaseLocked",
    checkpointActionState: "disabled:no legal action available",
    checkpointTargetSlots: "",
  }),
});

const cloneRefreshCase = (scenario) => ({
  ...scenario,
  expectedRefreshKeys: [...scenario.expectedRefreshKeys],
});

export function dayFiveNoLynchResolutionSurfaceCase() {
  const surfaceCase = dayFiveNoLynchResolutionSurfaceCaseDefinition;
  return {
    transitionFragments: [...surfaceCase.transitionFragments],
    voteCase: cloneRefreshCase(surfaceCase.voteCase),
    hostTransitionCase: {
      ...surfaceCase.hostTransitionCase,
      resolveCase: cloneRefreshCase(surfaceCase.hostTransitionCase.resolveCase),
      advanceCase: cloneRefreshCase(surfaceCase.hostTransitionCase.advanceCase),
    },
    actionPlayerNightFiveCase: {
      ...surfaceCase.actionPlayerNightFiveCase,
    },
    staleDayFiveVoteCase: cloneRefreshCase(surfaceCase.staleDayFiveVoteCase),
  };
}

export function coreLoopDayFiveProgressionScenarioFamily() {
  const scenarioCases = coreLoopDayFiveProgressionScenarioCases();
  return {
    id: coreLoopDayFiveProgressionFamilyId,
    laneIds: [...coreLoopDayFiveProgressionLaneIds],
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

export function assertDayFiveNoLynchResolutionSurfaceProof({
  dayFiveNoLynchResolutionSurface,
  assertHostPhaseTransitionActionProof,
  assertPostDayThreePlayerSurfaceProof,
  includeEvidenceInError = false,
}) {
  const expectedGame = gameFromRoleUrl(
    dayFiveNoLynchResolutionSurface?.sourceHostRoleUrl,
  );
  const surfaceCase = dayFiveNoLynchResolutionSurfaceCaseDefinition;
  if (
    dayFiveNoLynchResolutionSurface?.status !== "passed" ||
    dayFiveNoLynchResolutionSurface.clickedThroughFromRoleUrl !== true ||
    dayFiveNoLynchResolutionSurface.releaseReady !== false ||
    dayFiveNoLynchResolutionSurface.productionReady !== false ||
    typeof dayFiveNoLynchResolutionSurface.sourceHostRoleUrl !== "string" ||
    !dayFiveNoLynchResolutionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    !surfaceCase.transitionFragments.every((fragment) =>
      String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
        fragment,
      ),
    )
  ) {
    throwDayFiveProgressionAssertionError({
      message: "core-loop admin proof missing Day 5 no-lynch resolution surface",
      evidence: dayFiveNoLynchResolutionSurface,
      includeEvidenceInError,
    });
  }
  assertDayFiveNoLynchVoteProofCase({
    proof: dayFiveNoLynchResolutionSurface.dayFiveVoteProof,
    expectedGame,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl,
    includeEvidenceInError,
  });
  assertDayFiveNoLynchHostTransitionProofCase({
    proof: dayFiveNoLynchResolutionSurface.hostTransitionProof,
    expectedGame,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceHostRoleUrl,
    assertHostPhaseTransitionActionProof,
    includeEvidenceInError,
  });
  const playerCase = surfaceCase.actionPlayerNightFiveCase;
  assertPostDayThreePlayerSurfaceProof({
    proof: dayFiveNoLynchResolutionSurface[playerCase.proofField],
    expectedGame,
    sourceRoleUrl:
      dayFiveNoLynchResolutionSurface[playerCase.sourceRoleUrlField],
    expectedSlot: playerCase.expectedSlot,
    slotField: playerCase.slotField,
    expectedPrincipalUserId: playerCase.expectedPrincipalUserId,
    expectedPhaseId: playerCase.expectedPhaseId,
    expectedPhaseState: playerCase.expectedPhaseState,
    expectedActorAlive: playerCase.expectedActorAlive,
    expectedActorStatus: playerCase.expectedActorStatus,
    expectedActionState: playerCase.expectedActionState,
    expectedStatusText: playerCase.expectedStatusText,
    expectedPrivateCount: playerCase.expectedPrivateCount,
    expectedPrivateReceipt: playerCase.expectedPrivateReceipt,
    expectedBoundaryText: playerCase.expectedBoundaryText,
    expectedResyncFromSeq: playerCase.expectedResyncFromSeq,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=${playerCase.expectedPrincipalUserId}&slot_id=${playerCase.expectedSlot}`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=${playerCase.expectedPrincipalUserId}`,
    expectedLastVoteOutcomePhaseId: playerCase.expectedLastVoteOutcomePhaseId,
    includeEvidenceInError,
  });
  assertStaleDayFiveVoteRecoveryProofCase({
    proof: dayFiveNoLynchResolutionSurface.staleDayFiveVoteRecoveryProof,
    expectedGame,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl,
    includeEvidenceInError,
  });
}

export function assertDayFiveNoLynchVoteProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  includeEvidenceInError = false,
}) {
  const voteCase = dayFiveNoLynchResolutionSurfaceCaseDefinition.voteCase;
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
    proof.receiptRefreshKeys !== voteCase.expectedRefreshKeys.join(",")
  ) {
    throwDayFiveProgressionAssertionError({
      message: "core-loop admin proof missing Day 5 no-lynch vote ACK",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertDayFiveNoLynchHostTransitionProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  assertHostPhaseTransitionActionProof,
  includeEvidenceInError = false,
}) {
  const hostCase =
    dayFiveNoLynchResolutionSurfaceCaseDefinition.hostTransitionCase;
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
    proof.setupResyncFromSeq !== hostCase.setupResyncFromSeq ||
    proof.setupSnapshotHost?.phase?.id !== hostCase.setupPhaseId ||
    proof.setupSnapshotHost?.phase?.state !== hostCase.setupPhaseState
  ) {
    throwDayFiveProgressionAssertionError({
      message: "core-loop admin proof missing Day 5 no-lynch host transition",
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
  assertHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    ...hostCase.advanceCase,
    sourceRoleUrl,
    includeEvidenceInError,
  });
  if (
    proof.resolveProof?.votecountProjection?.[0]?.target !==
      hostCase.expectedVotecountTarget ||
    proof.resolveProof?.dayVoteOutcomesProjection?.at?.(-1)?.phaseId !==
      hostCase.expectedDayVoteOutcomePhaseId ||
    proof.resolveProof?.dayVoteOutcomesProjection?.at?.(-1)?.status !==
      hostCase.expectedDayVoteOutcomeStatus
  ) {
    throwDayFiveProgressionAssertionError({
      message: "core-loop admin proof missing Day 5 no-lynch host projections",
      evidence: proof.resolveProof,
      includeEvidenceInError,
    });
  }
}

export function assertStaleDayFiveVoteRecoveryProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  includeEvidenceInError = false,
}) {
  const staleCase =
    dayFiveNoLynchResolutionSurfaceCaseDefinition.staleDayFiveVoteCase;
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
    proof.surfaceTestId !== staleCase.surfaceTestId ||
    proof.clickedAction !== staleCase.clickedAction ||
    proof.commandKind !== staleCase.commandKind ||
    proof.setupResyncFromSeq !== staleCase.setupResyncFromSeq ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== staleCase.setupPhaseId ||
    proof.setupSnapshotCommandState?.voteTargets?.[0]?.kind !== "no_lynch" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== staleCase.actorSlot ||
    proof.command.target !== staleCase.target ||
    proof.commandStatus?.state !== staleCase.finalState ||
    proof.commandStatus.error !== staleCase.error ||
    !String(proof.commandStatus.message ?? "").includes(
      staleCase.messageIncludes,
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== staleCase.commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== staleCase.finalState ||
    !sameStringArray(
      proof.bridgePlan.projectionRefreshKeys,
      staleCase.expectedRefreshKeys,
    ) ||
    proof.receipts?.at?.(-1)?.state !== staleCase.finalState ||
    proof.projectionCommandState?.actorSlot !== staleCase.actorSlot ||
    proof.projectionCommandState?.phase?.phaseId !== staleCase.refreshedPhaseId ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    proof.projectionCommandState?.voteTargets?.length !== 0 ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      staleCase.refreshedBoundary,
    ) ||
    proof.checkpointReceiptState !== staleCase.checkpointReceiptState ||
    proof.checkpointPhaseIdAfterReject !== staleCase.refreshedPhaseId ||
    proof.checkpointActionStateAfterReject !== staleCase.checkpointActionState ||
    proof.checkpointTargetSlotsAfterReject !== staleCase.checkpointTargetSlots ||
    !String(proof.recoveryText ?? "").includes(`Reject ${staleCase.error}`) ||
    !String(proof.recoveryText ?? "").includes("refresh") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(`reject ${staleCase.error.toLowerCase()}`)
  ) {
    throwDayFiveProgressionAssertionError({
      message: "core-loop admin proof missing stale Day 5 vote recovery",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

function throwDayFiveProgressionAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}

function gameFromRoleUrl(roleUrl) {
  const match = String(roleUrl ?? "").match(/\/g\/([^/?#]+)/);
  return match?.[1] ?? "";
}

function featureRowFromCase(scenario, { cycleId }) {
  return Object.freeze({
    targetKey: scenario.targetKey,
    featureSlotId: scenario.featureSlotId,
    cycleId,
    role: scenario.role,
    checkpointId: `${cycleId}-${scenario.checkpointId}`,
    adminCheckId: coreLoopDayFiveProgressionAdminCheckId,
  });
}

function sameStringArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}
