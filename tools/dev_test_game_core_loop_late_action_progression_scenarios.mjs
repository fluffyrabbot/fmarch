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
export const coreLoopLateActionProgressionCycleId = "n03-d04";
export const coreLoopLateActionProgressionEntryCheckpointId =
  "d04-day-controls-return";

const lateActionProgressionFeatureRowDefinitions = Object.freeze([
  Object.freeze({
    targetKey: "nightFourActionSubmission",
    featureSlotId: "night-four-action-submission",
    role: "actionPlayer",
  }),
  Object.freeze({
    targetKey: "nightFourResolutionReceipt",
    featureSlotId: "night-four-resolution-receipt",
    role: "host",
  }),
  Object.freeze({
    targetKey: "postNightFourTransition",
    featureSlotId: "post-night-four-transition",
    role: "host",
  }),
]);

const coreLoopLateActionProgressionScenarioCaseDefinitions = Object.freeze([
  Object.freeze({
    key: "nightFourActionSubmission",
    group: "surfaces",
    laneId: playerActionLoopLaneId,
    buildScenario: nightFourActionSubmissionSurfaceCase,
  }),
  Object.freeze({
    key: "nightFourResolutionReceipt",
    group: "surfaces",
    laneId: playerActionLoopLaneId,
    buildScenario: nightFourResolutionReceiptSurfaceCase,
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

const nightFourActionSubmissionSurfaceCaseDefinition = Object.freeze({
  transitionFragments: Object.freeze([
    "player:D04:no_lynch:ack:912",
    "host:D04:resolve_phase:ack:913",
    "host:advance_phase:ack:914",
    "player:N04:submit_action:slot-5:ack:915",
  ]),
  dayFourHostTransitionCase: Object.freeze(
    dayFourNoLynchHostTransitionProofCase(),
  ),
  actionSubmissionCase: Object.freeze({
    surfaceTestId: "player-surface",
    clickedAction: "submit_action:factional_kill",
    commandKind: "SubmitAction",
    actorSlot: "slot-7",
    actionId: "factional_kill",
    templateId: "factional_kill",
    targetSlot: "slot-5",
    grantId: "grant-factional-kill-n04",
    setupResyncFromSeq: 914,
    setupPhaseId: "N04",
    streamSeq: 915,
    expectedRefreshKeys: Object.freeze([
      "notifications",
      "investigationResults",
      "commandState",
    ]),
    expectedBoundaryText: "Night 4 action ACK",
    checkpointActionStateAfterAck: "disabled:no legal action available",
  }),
});

const nightFourResolutionReceiptSurfaceCaseDefinition = Object.freeze({
  transitionFragments: Object.freeze([
    "host:N04:resolve_phase:ack:916",
    "survivor:N04:factional_kill_receipt",
    "actionPlayer:N04:privacy",
  ]),
  hostResolutionCase: Object.freeze({
    surfaceTestId: "host-console-surface",
    setupResyncFromSeq: 915,
    setupPhaseId: "N04",
    setupPhaseState: "open",
    resolveCase: Object.freeze(
      hostResolvePhaseTransitionCase({
        streamSeq: 916,
        expectedPhaseId: "N04",
      }),
    ),
  }),
  survivorReceiptScenarioId: "n04-survivor-receipt",
  actionPlayerPrivacyScenarioId: "n04-action-player-privacy",
});

export function nightFourActionSubmissionSurfaceCase() {
  return {
    transitionFragments: [
      ...nightFourActionSubmissionSurfaceCaseDefinition.transitionFragments,
    ],
    dayFourHostTransitionCase: {
      ...nightFourActionSubmissionSurfaceCaseDefinition.dayFourHostTransitionCase,
    },
    actionSubmissionCase: {
      ...nightFourActionSubmissionSurfaceCaseDefinition.actionSubmissionCase,
      expectedRefreshKeys: [
        ...nightFourActionSubmissionSurfaceCaseDefinition.actionSubmissionCase
          .expectedRefreshKeys,
      ],
    },
  };
}

export function nightFourResolutionReceiptSurfaceCase() {
  const surfaceCase = nightFourResolutionReceiptSurfaceCaseDefinition;
  return {
    transitionFragments: [...surfaceCase.transitionFragments],
    hostResolutionCase: {
      ...surfaceCase.hostResolutionCase,
      resolveCase: cloneTransitionCase(surfaceCase.hostResolutionCase.resolveCase),
    },
    survivorReceiptScenario: clonePrivateReceiptScenario(
      privateReceiptScenario(surfaceCase.survivorReceiptScenarioId),
    ),
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

export function assertNightFourActionSubmissionSurfaceCase({
  nightFourActionSubmissionSurface,
  expectedGame,
  assertDayFourNoLynchVoteProof,
  assertDayFourNoLynchHostTransitionProof,
  includeEvidenceInError = false,
}) {
  const surfaceCase = nightFourActionSubmissionSurfaceCaseDefinition;
  if (
    nightFourActionSubmissionSurface?.status !== "passed" ||
    nightFourActionSubmissionSurface.clickedThroughFromRoleUrl !== true ||
    nightFourActionSubmissionSurface.releaseReady !== false ||
    nightFourActionSubmissionSurface.productionReady !== false ||
    typeof nightFourActionSubmissionSurface.sourceHostRoleUrl !== "string" ||
    !nightFourActionSubmissionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof nightFourActionSubmissionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !nightFourActionSubmissionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    !surfaceCase.transitionFragments.every((fragment) =>
      String(nightFourActionSubmissionSurface.transition ?? "").includes(
        fragment,
      ),
    )
  ) {
    throwLateActionProgressionAssertionError({
      message: "core-loop admin proof missing Night 4 action submission",
      evidence: nightFourActionSubmissionSurface,
      includeEvidenceInError,
    });
  }
  assertDayFourNoLynchVoteProof({
    proof: nightFourActionSubmissionSurface.dayFourVoteProof,
    expectedGame,
    sourceRoleUrl: nightFourActionSubmissionSurface.sourceActionPlayerRoleUrl,
    includeEvidenceInError,
  });
  assertDayFourNoLynchHostTransitionProof({
    proof: nightFourActionSubmissionSurface.hostTransitionProof,
    expectedGame,
    sourceRoleUrl: nightFourActionSubmissionSurface.sourceHostRoleUrl,
    includeEvidenceInError,
  });
  assertNightFourPlayerActionSubmissionProofCase({
    proof: nightFourActionSubmissionSurface.nightFourActionProof,
    expectedGame,
    sourceRoleUrl: nightFourActionSubmissionSurface.sourceActionPlayerRoleUrl,
    includeEvidenceInError,
  });
}

export function assertNightFourPlayerActionSubmissionProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  includeEvidenceInError = false,
}) {
  const actionCase =
    nightFourActionSubmissionSurfaceCaseDefinition.actionSubmissionCase;
  const clickProof = proof?.clickProof;
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== actionCase.surfaceTestId ||
    proof.setupResyncFromSeq !== actionCase.setupResyncFromSeq ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== actionCase.setupPhaseId ||
    proof.setupSnapshotCommandState?.actions?.[0]?.targets?.[0] !==
      actionCase.targetSlot ||
    clickProof?.status !== "passed" ||
    clickProof.clickedAction !== actionCase.clickedAction ||
    clickProof.commandKind !== actionCase.commandKind ||
    clickProof.command?.game !== expectedGame ||
    clickProof.command.actor_slot !== actionCase.actorSlot ||
    clickProof.command.action_id !== actionCase.actionId ||
    clickProof.command.template_id !== actionCase.templateId ||
    clickProof.command.targets?.[0] !== actionCase.targetSlot ||
    clickProof.command.grant_id !== actionCase.grantId ||
    clickProof.commandStatus?.state !== "ack" ||
    !String(clickProof.commandStatus?.message ?? "").includes(
      `Ack: stream seqs ${actionCase.streamSeq}`,
    ) ||
    clickProof.bridgePlan?.role !== "player" ||
    clickProof.bridgePlan.commandKind !== actionCase.commandKind ||
    clickProof.bridgePlan.commandEndpoint !== "/commands" ||
    clickProof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(
      clickProof.bridgePlan.projectionRefreshKeys,
      actionCase.expectedRefreshKeys,
    ) ||
    clickProof.receipts?.at?.(-1)?.state !== "ack" ||
    clickProof.projectionCommandState?.phase?.phaseId !== actionCase.setupPhaseId ||
    clickProof.projectionCommandState?.actions?.length !== 0 ||
    !String(clickProof.projectionCommandState?.boundary ?? "").includes(
      actionCase.expectedBoundaryText,
    ) ||
    !String(clickProof.checkpointReceiptState ?? "").includes(
      `Ack: stream seqs ${actionCase.streamSeq}`,
    ) ||
    clickProof.checkpointActionStateAfterAck !==
      actionCase.checkpointActionStateAfterAck ||
    clickProof.receiptCount !== 1 ||
    !String(clickProof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(`ack: stream seqs ${actionCase.streamSeq}`)
  ) {
    throwLateActionProgressionAssertionError({
      message: "core-loop admin proof missing Night 4 player action ACK",
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
    checkpointId: `${cycleId}-${coreLoopLateActionProgressionEntryCheckpointId}`,
    adminCheckId: coreLoopLateActionProgressionAdminCheckId,
  });
}

export function assertNightFourResolutionReceiptSurfaceCase({
  nightFourResolutionReceiptSurface,
  expectedGame,
  assertHostPhaseTransitionActionProof,
  includeEvidenceInError = false,
}) {
  const surfaceCase = nightFourResolutionReceiptSurfaceCaseDefinition;
  if (
    nightFourResolutionReceiptSurface?.status !== "passed" ||
    nightFourResolutionReceiptSurface.clickedThroughFromRoleUrl !== true ||
    nightFourResolutionReceiptSurface.releaseReady !== false ||
    nightFourResolutionReceiptSurface.productionReady !== false ||
    typeof nightFourResolutionReceiptSurface.sourceHostRoleUrl !== "string" ||
    !nightFourResolutionReceiptSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof nightFourResolutionReceiptSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !nightFourResolutionReceiptSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof nightFourResolutionReceiptSurface.sourceSurvivorRoleUrl !==
      "string" ||
    !nightFourResolutionReceiptSurface.sourceSurvivorRoleUrl.includes("/g/") ||
    !surfaceCase.transitionFragments.every((fragment) =>
      String(nightFourResolutionReceiptSurface.transition ?? "").includes(
        fragment,
      ),
    )
  ) {
    throwLateActionProgressionAssertionError({
      message: "core-loop admin proof missing Night 4 resolution receipt",
      evidence: nightFourResolutionReceiptSurface,
      includeEvidenceInError,
    });
  }
  assertNightFourHostResolutionProofCase({
    proof: nightFourResolutionReceiptSurface.hostResolutionProof,
    expectedGame,
    sourceRoleUrl: nightFourResolutionReceiptSurface.sourceHostRoleUrl,
    assertHostPhaseTransitionActionProof,
    includeEvidenceInError,
  });
  assertNightFourResolutionPlayerSurfaceProofCase({
    proof: nightFourResolutionReceiptSurface.survivorReceiptProof,
    ...privateReceiptAssertionArgs({
      scenario: privateReceiptScenario(surfaceCase.survivorReceiptScenarioId),
      expectedGame,
      sourceRoleUrl: nightFourResolutionReceiptSurface.sourceSurvivorRoleUrl,
    }),
    includeEvidenceInError,
  });
  assertNightFourResolutionPlayerSurfaceProofCase({
    proof: nightFourResolutionReceiptSurface.actionPlayerPrivacyProof,
    ...privateReceiptAssertionArgs({
      scenario: privateReceiptScenario(surfaceCase.actionPlayerPrivacyScenarioId),
      expectedGame,
      sourceRoleUrl: nightFourResolutionReceiptSurface.sourceActionPlayerRoleUrl,
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
    nightFourResolutionReceiptSurfaceCaseDefinition.hostResolutionCase;
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
      "principal-scoped endpoints",
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
      message: "core-loop admin proof leaked Night 4 target receipt",
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
