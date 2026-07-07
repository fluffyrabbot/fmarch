import {
  playerActionLoopLaneId,
  staleNightFourActionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  hostResolvePhaseTransitionCase,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  postNightFourTransitionSurfaceCase,
} from "./dev_test_game_core_loop_post_night_four_transition_scenarios.mjs";
import {
  dayFourNoLynchHostTransitionProofCase,
} from "./dev_test_game_core_loop_no_lynch_progression_scenarios.mjs";
import {
  privateReceiptAssertionArgs,
  privateReceiptScenario,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";

export const coreLoopLateActionProgressionFamilyId =
  "core-loop-late-action-progression";
export const coreLoopLateActionProgressionAdminCheckId = "core-loop";
export const coreLoopLateActionProgressionCycleId = "d04-n04-d05";
export const dayFourNoLynchVoteSubmittedLaneId =
  "day-four-no-lynch-vote-submitted";
export const dayFourNoLynchResolutionLaneId =
  "day-four-no-lynch-resolution";

const lateActionProgressionFeatureRowDefinitions = Object.freeze([
  Object.freeze({
    targetKey: "dayFourNoLynchVoteSubmitted",
    featureSlotId: dayFourNoLynchVoteSubmittedLaneId,
    role: "actionPlayer",
    checkpointId: "d04-no-lynch-vote-submitted",
  }),
  Object.freeze({
    targetKey: "dayFourNoLynchResolution",
    featureSlotId: dayFourNoLynchResolutionLaneId,
    role: "host",
    checkpointId: "d04-resolved-no-lynch",
  }),
  Object.freeze({
    targetKey: "nightFourNoActionSurface",
    featureSlotId: "night-four-no-action-surface",
    role: "actionPlayer",
    checkpointId: "n04-no-action-open",
  }),
  Object.freeze({
    targetKey: "nightFourNoActionResolution",
    featureSlotId: "night-four-no-action-resolution",
    role: "host",
    checkpointId: "n04-resolved-no-action",
  }),
  Object.freeze({
    targetKey: "postNightFourTransition",
    featureSlotId: "post-night-four-transition",
    role: "actionPlayer",
    checkpointId: "d05-day-controls-return",
  }),
]);

const coreLoopLateActionProgressionScenarioCaseDefinitions = Object.freeze([
  Object.freeze({
    key: "nightFourNoAction",
    group: "surfaces",
    laneId: playerActionLoopLaneId,
    buildScenario: nightFourNoActionSurfaceCase,
  }),
  Object.freeze({
    key: "nightFourNoActionResolution",
    group: "surfaces",
    laneId: playerActionLoopLaneId,
    buildScenario: nightFourNoActionResolutionSurfaceCase,
  }),
  Object.freeze({
    key: "postNightFourTransition",
    group: "surfaces",
    laneId: playerActionLoopLaneId,
    buildScenario: postNightFourTransitionSurfaceCase,
  }),
  Object.freeze({
    key: "staleNightFourAction",
    group: "staleRejects",
    laneId: playerActionLoopLaneId,
    buildScenario: staleNightFourActionRecoveryScenario,
  }),
]);

const uniqueLaneIds = (scenarioCases) => [
  ...new Set(scenarioCases.map((scenarioCase) => scenarioCase.laneId)),
];

const cloneLateActionProgressionScenarioCase = (scenarioCase) => ({
  key: scenarioCase.key,
  group: scenarioCase.group,
  laneId: scenarioCase.laneId,
  scenario: scenarioCase.buildScenario(),
});

export function coreLoopLateActionProgressionScenarioCases() {
  return coreLoopLateActionProgressionScenarioCaseDefinitions.map(
    cloneLateActionProgressionScenarioCase,
  );
}

export const coreLoopLateActionProgressionLaneIds = Object.freeze([
  ...uniqueLaneIds(coreLoopLateActionProgressionScenarioCaseDefinitions),
]);

const cloneTransitionCase = (transitionCase) => ({
  ...transitionCase,
  expectedRefreshKeys: [...transitionCase.expectedRefreshKeys],
});

const clonePrivateReceiptScenario = (scenario) => ({ ...scenario });
const cloneFeatureRow = (row) => ({ ...row });

const nightFourNoActionSurfaceCaseDefinition = Object.freeze({
  transitionFragments: Object.freeze([
    "player:D04:no_lynch:ack:912",
    "host:D04:resolve_phase:ack:913",
    "host:advance_phase:ack:914",
    "actionPlayer:N04:no_action",
  ]),
  dayFourHostTransitionCase: Object.freeze(
    dayFourNoLynchHostTransitionProofCase(),
  ),
  noActionCase: Object.freeze({
    surfaceTestId: "player-surface",
    setupResyncFromSeq: 914,
    setupPhaseId: "N04",
    expectedSlot: "slot-7",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionCount: 0,
    expectedSubmitActionControls: 0,
    expectedVoteTargetCount: 0,
    expectedPrivateCount: 0,
    expectedBoundaryText: "Night 4 with no legal action",
  }),
});

const nightFourNoActionResolutionSurfaceCaseDefinition = Object.freeze({
  transitionFragments: Object.freeze([
    "host:N04:resolve_phase:ack:916",
    "actionPlayer:N04:no_action_privacy",
  ]),
  hostResolutionCase: Object.freeze({
    surfaceTestId: "host-console-surface",
    setupResyncFromSeq: 914,
    setupPhaseId: "N04",
    setupPhaseState: "open",
    resolveCase: Object.freeze(
      hostResolvePhaseTransitionCase({
        streamSeq: 916,
        expectedPhaseId: "N04",
      }),
    ),
  }),
  actionPlayerPrivacyScenarioId: "n04-action-player-privacy",
});

export function nightFourNoActionSurfaceCase() {
  return {
    transitionFragments: [
      ...nightFourNoActionSurfaceCaseDefinition.transitionFragments,
    ],
    dayFourHostTransitionCase: {
      ...nightFourNoActionSurfaceCaseDefinition.dayFourHostTransitionCase,
    },
    noActionCase: {
      ...nightFourNoActionSurfaceCaseDefinition.noActionCase,
    },
  };
}

export function nightFourNoActionResolutionSurfaceCase() {
  const surfaceCase = nightFourNoActionResolutionSurfaceCaseDefinition;
  return {
    transitionFragments: [...surfaceCase.transitionFragments],
    hostResolutionCase: {
      ...surfaceCase.hostResolutionCase,
      resolveCase: cloneTransitionCase(surfaceCase.hostResolutionCase.resolveCase),
    },
    actionPlayerPrivacyScenario: clonePrivateReceiptScenario(
      privateReceiptScenario(surfaceCase.actionPlayerPrivacyScenarioId),
    ),
  };
}

export function lateActionProgressionFeatureSpineRows({
  cycleId = coreLoopLateActionProgressionCycleId,
} = {}) {
  return lateActionProgressionFeatureRowDefinitions.map((scenario) =>
    cloneFeatureRow(featureRowFromCase(scenario, { cycleId })),
  );
}

export function coreLoopLateActionProgressionScenarioFamily() {
  const scenarioCases = coreLoopLateActionProgressionScenarioCases();
  return {
    id: coreLoopLateActionProgressionFamilyId,
    laneIds: [...coreLoopLateActionProgressionLaneIds],
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

export function assertNightFourNoActionSurfaceCase({
  nightFourNoActionSurface,
  expectedGame,
  assertDayFourNoLynchVoteProof,
  assertDayFourNoLynchHostTransitionProof,
  includeEvidenceInError = false,
}) {
  const surfaceCase = nightFourNoActionSurfaceCaseDefinition;
  if (
    nightFourNoActionSurface?.status !== "passed" ||
    nightFourNoActionSurface.clickedThroughFromRoleUrl !== true ||
    nightFourNoActionSurface.releaseReady !== false ||
    nightFourNoActionSurface.productionReady !== false ||
    typeof nightFourNoActionSurface.sourceHostRoleUrl !== "string" ||
    !nightFourNoActionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof nightFourNoActionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !nightFourNoActionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    !surfaceCase.transitionFragments.every((fragment) =>
      String(nightFourNoActionSurface.transition ?? "").includes(
        fragment,
      ),
    )
  ) {
    throwLateActionProgressionAssertionError({
      message: "core-loop admin proof missing Night 4 no-action surface",
      evidence: nightFourNoActionSurface,
      includeEvidenceInError,
    });
  }
  assertDayFourNoLynchVoteProof({
    proof: nightFourNoActionSurface.dayFourVoteProof,
    expectedGame,
    sourceRoleUrl: nightFourNoActionSurface.sourceActionPlayerRoleUrl,
    includeEvidenceInError,
  });
  assertDayFourNoLynchHostTransitionProof({
    proof: nightFourNoActionSurface.hostTransitionProof,
    expectedGame,
    sourceRoleUrl: nightFourNoActionSurface.sourceHostRoleUrl,
    includeEvidenceInError,
  });
  assertNightFourPlayerNoActionProofCase({
    proof: nightFourNoActionSurface.nightFourNoActionProof,
    expectedGame,
    sourceRoleUrl: nightFourNoActionSurface.sourceActionPlayerRoleUrl,
    includeEvidenceInError,
  });
}

export function assertNightFourPlayerNoActionProofCase({
  proof,
  sourceRoleUrl,
  includeEvidenceInError = false,
}) {
  const noActionCase = nightFourNoActionSurfaceCaseDefinition.noActionCase;
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== noActionCase.surfaceTestId ||
    proof.setupResyncFromSeq !== noActionCase.setupResyncFromSeq ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== noActionCase.setupPhaseId ||
    proof.setupSnapshotCommandState?.actions?.length !==
      noActionCase.expectedActionCount ||
    proof.checkpoint?.phaseId !== noActionCase.setupPhaseId ||
    proof.checkpoint?.phaseState !== noActionCase.expectedPhaseState ||
    proof.checkpoint?.actorSlot !== noActionCase.expectedSlot ||
    proof.checkpoint?.actionCount !== noActionCase.expectedActionCount ||
    proof.checkpoint?.submitActionControls !==
      noActionCase.expectedSubmitActionControls ||
    proof.checkpoint?.voteTargetCount !== noActionCase.expectedVoteTargetCount ||
    proof.checkpoint?.privateCount !== noActionCase.expectedPrivateCount ||
    proof.projectionCommandState?.actorSlot !== noActionCase.expectedSlot ||
    proof.projectionCommandState?.actorAlive !== noActionCase.expectedActorAlive ||
    proof.projectionCommandState?.actorStatus !==
      noActionCase.expectedActorStatus ||
    proof.projectionCommandState?.phase?.phaseId !== noActionCase.setupPhaseId ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.actions?.length !==
      noActionCase.expectedActionCount ||
    proof.projectionCommandState?.voteTargets?.length !==
      noActionCase.expectedVoteTargetCount ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      noActionCase.expectedBoundaryText,
    )
  ) {
    throwLateActionProgressionAssertionError({
      message: "core-loop admin proof missing Night 4 no-action player surface",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

function featureRowFromCase(scenario, { cycleId }) {
  return Object.freeze({
    targetKey: scenario.targetKey,
    featureSlotId: scenario.featureSlotId,
    cycleId,
    role: scenario.role,
    checkpointId: `${cycleId}-${scenario.checkpointId}`,
    adminCheckId: coreLoopLateActionProgressionAdminCheckId,
  });
}

export function assertNightFourNoActionResolutionSurfaceCase({
  nightFourNoActionResolutionSurface,
  expectedGame,
  assertHostPhaseTransitionActionProof,
  includeEvidenceInError = false,
}) {
  const surfaceCase = nightFourNoActionResolutionSurfaceCaseDefinition;
  if (
    nightFourNoActionResolutionSurface?.status !== "passed" ||
    nightFourNoActionResolutionSurface.clickedThroughFromRoleUrl !== true ||
    nightFourNoActionResolutionSurface.releaseReady !== false ||
    nightFourNoActionResolutionSurface.productionReady !== false ||
    typeof nightFourNoActionResolutionSurface.sourceHostRoleUrl !== "string" ||
    !nightFourNoActionResolutionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof nightFourNoActionResolutionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !nightFourNoActionResolutionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    !surfaceCase.transitionFragments.every((fragment) =>
      String(nightFourNoActionResolutionSurface.transition ?? "").includes(
        fragment,
      ),
    )
  ) {
    throwLateActionProgressionAssertionError({
      message: "core-loop admin proof missing Night 4 resolution receipt",
      evidence: nightFourNoActionResolutionSurface,
      includeEvidenceInError,
    });
  }
  assertNightFourHostResolutionProofCase({
    proof: nightFourNoActionResolutionSurface.hostResolutionProof,
    expectedGame,
    sourceRoleUrl: nightFourNoActionResolutionSurface.sourceHostRoleUrl,
    assertHostPhaseTransitionActionProof,
    includeEvidenceInError,
  });
  assertNightFourResolutionPlayerSurfaceProofCase({
    proof: nightFourNoActionResolutionSurface.actionPlayerPrivacyProof,
    ...privateReceiptAssertionArgs({
      scenario: privateReceiptScenario(surfaceCase.actionPlayerPrivacyScenarioId),
      expectedGame,
      sourceRoleUrl: nightFourNoActionResolutionSurface.sourceActionPlayerRoleUrl,
    }),
    includeEvidenceInError,
  });
}

export function assertNightFourHostResolutionProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  assertHostPhaseTransitionActionProof,
  includeEvidenceInError = false,
}) {
  const hostCase =
    nightFourNoActionResolutionSurfaceCaseDefinition.hostResolutionCase;
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
    throwLateActionProgressionAssertionError({
      message: "core-loop admin proof missing Night 4 host resolution",
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
}

export function assertNightFourResolutionPlayerSurfaceProofCase({
  proof,
  sourceRoleUrl,
  expectedSlot,
  slotField,
  expectedPrincipalUserId,
  expectedActorAlive,
  expectedActorStatus,
  expectedActionState,
  expectedStatusText,
  expectedPrivateCount,
  expectedPrivateReceipt,
  expectedBoundaryText,
  expectedPhaseId,
  expectedPhaseState,
  expectedResyncFromSeq,
  expectedPrivateReceiptStatus,
  expectedPrivateReceiptPhaseId,
  expectedPrivateQueueBoundaryStatus,
  expectedCommandStateEndpoint,
  expectedNotificationsEndpoint,
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof[slotField] !== expectedSlot ||
    proof.principalUserId !== expectedPrincipalUserId ||
    proof.checkpoint?.phaseId !== expectedPhaseId ||
    proof.checkpoint.phaseState !== expectedPhaseState ||
    proof.checkpoint.actorSlot !== expectedSlot ||
    proof.checkpoint.actionState !== expectedActionState ||
    proof.checkpoint.receiptState !== "idle" ||
    !String(proof.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes(expectedStatusText) ||
    proof.privateQueueBoundary?.status !== expectedPrivateQueueBoundaryStatus ||
    proof.privateQueueBoundary.count !== expectedPrivateCount ||
    !String(proof.privateQueueBoundary.text ?? "").includes(
      "delivered to you alone",
    ) ||
    proof.voteButtonCount !== 0 ||
    proof.projectionCommandState?.actorSlot !== expectedSlot ||
    proof.projectionCommandState?.actorAlive !== expectedActorAlive ||
    proof.projectionCommandState?.actorStatus !== expectedActorStatus ||
    proof.projectionCommandState?.phase?.phaseId !== expectedPhaseId ||
    proof.projectionCommandState?.phase?.locked !==
      (expectedPhaseState === "locked") ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    proof.projectionCommandState?.voteTargets?.length !== 0 ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      expectedBoundaryText,
    ) ||
    proof.projectionDayVoteOutcomes?.at?.(-1)?.phaseId !== "D04" ||
    proof.resyncFromSeq !== expectedResyncFromSeq ||
    proof.resyncSnapshotCommandState?.actorSlot !== expectedSlot ||
    proof.resyncSnapshotCommandState?.phase?.phaseId !== expectedPhaseId ||
    proof.coldLoadEndpoints?.notificationsEndpoint !==
      expectedNotificationsEndpoint ||
    proof.coldLoadEndpoints?.commandStateEndpoint !== expectedCommandStateEndpoint
  ) {
    throwLateActionProgressionAssertionError({
      message: "core-loop admin proof missing Night 4 player surface",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  if (
    expectedPrivateReceipt &&
    (proof.privateNotice?.id !== "notification-1" ||
      proof.privateNotice.kind !== "notification" ||
      !String(proof.privateNotice.text ?? "").includes("player_killed") ||
      !String(proof.privateNotice.text ?? "").includes(
        expectedPrivateReceiptStatus,
      ) ||
      proof.privateNotice.detailText !==
        `Phase ${expectedPrivateReceiptPhaseId}` ||
      proof.projectionNotifications?.[0]?.effect !== "player_killed" ||
      proof.projectionNotifications?.[0]?.status !==
        expectedPrivateReceiptStatus ||
      proof.resyncSnapshotNotifications?.[0]?.status !==
        expectedPrivateReceiptStatus)
  ) {
    throwLateActionProgressionAssertionError({
      message: "core-loop admin proof missing Night 4 survivor receipt",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  if (
    !expectedPrivateReceipt &&
    (!String(proof.privateEmptyText ?? "").includes("No private results visible") ||
      proof.projectionNotifications?.length !== 0 ||
      proof.resyncSnapshotNotifications?.length !== 0 ||
      proof.privateNotice !== undefined)
  ) {
    throwLateActionProgressionAssertionError({
      message: "core-loop admin proof leaked Night 4 no-action resolution",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

function throwLateActionProgressionAssertionError({
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
