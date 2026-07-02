import {
  hostAdvancePhaseTransitionCase,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  privateReceiptAssertionArgs,
  privateReceiptScenario,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";

const clonePostDayThreeResolutionSurfaceCase = (surfaceCase) => ({
  ...surfaceCase,
  transitionFragments: [...surfaceCase.transitionFragments],
  targetReceiptScenarioId: surfaceCase.targetReceiptScenarioId,
  actionPlayerPrivacyScenarioId: surfaceCase.actionPlayerPrivacyScenarioId,
  hostAdvanceCase: {
    ...surfaceCase.hostAdvanceCase,
    advanceCase: {
      ...surfaceCase.hostAdvanceCase.advanceCase,
      expectedRefreshKeys: [
        ...surfaceCase.hostAdvanceCase.advanceCase.expectedRefreshKeys,
      ],
    },
  },
  actionPlayerNightThreeCase: { ...surfaceCase.actionPlayerNightThreeCase },
});

const postDayThreeResolutionSurfaceCaseDefinition = Object.freeze({
  transitionFragments: Object.freeze([
    "target:D03:day_vote",
    "host:advance_phase:ack:909",
    "actionPlayer:N03",
  ]),
  targetReceiptScenarioId: "d03-target-receipt",
  actionPlayerPrivacyScenarioId: "d03-action-player-privacy",
  hostAdvanceCase: Object.freeze({
    surfaceTestId: "host-console-surface",
    setupResyncFromSeq: 908,
    setupPhaseId: "D03",
    setupPhaseState: "locked",
    advanceCase: Object.freeze(
      hostAdvancePhaseTransitionCase({
        streamSeq: 909,
        expectedPhaseId: "N03",
      }),
    ),
  }),
  actionPlayerNightThreeCase: Object.freeze({
    proofField: "actionPlayerNightThreeProof",
    sourceRoleUrlField: "sourceActionPlayerRoleUrl",
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "N03",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "observed host AdvancePhase",
    expectedResyncFromSeq: 909,
    expectedVoteButtonCount: 0,
    expectedVoteTargetCount: 0,
  }),
});

export function postDayThreeResolutionSurfaceCase() {
  return clonePostDayThreeResolutionSurfaceCase(
    postDayThreeResolutionSurfaceCaseDefinition,
  );
}

export function assertPostDayThreeResolutionSurfaceCase({
  postDayThreeResolutionSurface,
  expectedGame,
  assertPostDayThreePlayerSurfaceProof,
  assertHostPhaseTransitionActionProof,
  includeEvidenceInError = false,
}) {
  const surfaceCase = postDayThreeResolutionSurfaceCaseDefinition;
  if (
    postDayThreeResolutionSurface?.status !== "passed" ||
    postDayThreeResolutionSurface.clickedThroughFromRoleUrl !== true ||
    postDayThreeResolutionSurface.releaseReady !== false ||
    postDayThreeResolutionSurface.productionReady !== false ||
    typeof postDayThreeResolutionSurface.sourceHostRoleUrl !== "string" ||
    !postDayThreeResolutionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof postDayThreeResolutionSurface.sourceActionPlayerRoleUrl !== "string" ||
    !postDayThreeResolutionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof postDayThreeResolutionSurface.sourceTargetRoleUrl !== "string" ||
    !postDayThreeResolutionSurface.sourceTargetRoleUrl.includes("/g/") ||
    !surfaceCase.transitionFragments.every((fragment) =>
      String(postDayThreeResolutionSurface.transition ?? "").includes(fragment),
    )
  ) {
    throwPostDayThreeScenarioAssertionError({
      message: "core-loop admin proof missing post-Day 3 resolution surface",
      evidence: postDayThreeResolutionSurface,
      includeEvidenceInError,
    });
  }
  assertPostDayThreePlayerSurfaceProof({
    proof: postDayThreeResolutionSurface.targetReceiptProof,
    ...privateReceiptAssertionArgs({
      scenario: privateReceiptScenario(surfaceCase.targetReceiptScenarioId),
      expectedGame,
      sourceRoleUrl: postDayThreeResolutionSurface.sourceTargetRoleUrl,
    }),
    includeEvidenceInError,
  });
  assertPostDayThreePlayerSurfaceProof({
    proof: postDayThreeResolutionSurface.actionPlayerPrivacyProof,
    ...privateReceiptAssertionArgs({
      scenario: privateReceiptScenario(surfaceCase.actionPlayerPrivacyScenarioId),
      expectedGame,
      sourceRoleUrl: postDayThreeResolutionSurface.sourceActionPlayerRoleUrl,
    }),
    includeEvidenceInError,
  });
  assertPostDayThreeHostAdvanceProofCase({
    proof: postDayThreeResolutionSurface.hostAdvanceProof,
    expectedGame,
    sourceRoleUrl: postDayThreeResolutionSurface.sourceHostRoleUrl,
    assertHostPhaseTransitionActionProof,
    includeEvidenceInError,
  });
  assertActionPlayerNightThreeProof({
    postDayThreeResolutionSurface,
    expectedGame,
    assertPostDayThreePlayerSurfaceProof,
    includeEvidenceInError,
  });
}

function assertPostDayThreeHostAdvanceProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  assertHostPhaseTransitionActionProof,
  includeEvidenceInError,
}) {
  const hostCase = postDayThreeResolutionSurfaceCaseDefinition.hostAdvanceCase;
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
    throwPostDayThreeScenarioAssertionError({
      message: "core-loop admin proof missing post-Day 3 host advance surface",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    ...hostCase.advanceCase,
    includeEvidenceInError,
  });
}

function assertActionPlayerNightThreeProof({
  postDayThreeResolutionSurface,
  expectedGame,
  assertPostDayThreePlayerSurfaceProof,
  includeEvidenceInError,
}) {
  const playerCase =
    postDayThreeResolutionSurfaceCaseDefinition.actionPlayerNightThreeCase;
  assertPostDayThreePlayerSurfaceProof({
    proof: postDayThreeResolutionSurface[playerCase.proofField],
    expectedGame,
    sourceRoleUrl:
      postDayThreeResolutionSurface[playerCase.sourceRoleUrlField],
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
    expectedVoteButtonCount: playerCase.expectedVoteButtonCount,
    expectedVoteTargetCount: playerCase.expectedVoteTargetCount,
    includeEvidenceInError,
  });
}

function throwPostDayThreeScenarioAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
