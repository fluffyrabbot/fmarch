const cloneTransitionProofCase = (transitionCase) => ({
  ...transitionCase,
  expectedRefreshKeys: [...transitionCase.expectedRefreshKeys],
});

const clonePostNightFourTransitionSurfaceCase = (surfaceCase) => ({
  ...surfaceCase,
  transitionFragments: [...surfaceCase.transitionFragments],
  hostAdvanceCase: cloneTransitionProofCase(surfaceCase.hostAdvanceCase),
  playerObservationCases: surfaceCase.playerObservationCases.map(
    (playerCase) => ({
      ...playerCase,
    }),
  ),
});

const postNightFourTransitionSurfaceCaseDefinition = Object.freeze({
  surfaceTestId: "host-console-surface",
  transitionFragments: Object.freeze([
    "host:N04:advance_phase:ack:917",
    "deadPlayer:D05:dead_no_controls",
    "actionPlayer:D05:no_lynch_controls",
    "stale:N04:submit_action:reject:PhaseLocked",
  ]),
  hostAdvanceSetupResyncFromSeq: 916,
  hostAdvanceSetupPhaseId: "N04",
  hostAdvanceSetupPhaseState: "locked",
  expectedHostAdvanceDayVoteOutcomePhaseId: "D04",
  hostAdvanceCase: Object.freeze({
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 917,
    expectedPhaseId: "D05",
    expectedPhaseState: "open",
    expectedRefreshKeys: Object.freeze([]),
  }),
  playerObservationCases: Object.freeze([
    Object.freeze({
      proofField: "deadPlayerDayFiveProof",
      sourceRoleUrlField: "sourceDeadPlayerRoleUrl",
      expectedSlot: "slot-3",
      slotField: "deadPlayerSlot",
      expectedPrincipalUserId: "player-seed",
      expectedPhaseId: "D05",
      expectedPhaseState: "open",
      expectedActorAlive: false,
      expectedActorStatus: "dead",
      expectedActionState: "disabled:actor is not alive",
      expectedStatusText: "actor is not alive",
      expectedPrivateCount: 1,
      expectedPrivateReceipt: true,
      expectedBoundaryText:
        "dead player stayed dead from the N02 factional kill",
      expectedResyncFromSeq: 917,
      expectedVoteButtonCount: 0,
      expectedVoteTargetCount: 0,
      expectedLastVoteOutcomePhaseId: "D04",
      expectedPrivateReceiptStatus: "factional_kill",
      expectedPrivateReceiptPhaseId: "N02",
    }),
    Object.freeze({
      proofField: "actionPlayerDayFiveProof",
      sourceRoleUrlField: "sourceActionPlayerRoleUrl",
      expectedSlot: "slot-7",
      slotField: "actionPlayerSlot",
      expectedPrincipalUserId: "player_mira",
      expectedPhaseId: "D05",
      expectedPhaseState: "open",
      expectedActorAlive: true,
      expectedActorStatus: "alive",
      expectedActionState: "disabled:no legal action available",
      expectedStatusText: "no legal action available",
      expectedPrivateCount: 0,
      expectedPrivateReceipt: false,
      expectedBoundaryText: "open Day 5 no-lynch controls",
      expectedResyncFromSeq: 917,
      expectedVoteButtonCount: 1,
      expectedVoteTargetCount: 1,
      expectedLastVoteOutcomePhaseId: "D04",
      expectedPrivateReceiptStatus: "day_vote",
      expectedPrivateReceiptPhaseId: "D03",
    }),
  ]),
});

export function postNightFourTransitionSurfaceCase() {
  return clonePostNightFourTransitionSurfaceCase(
    postNightFourTransitionSurfaceCaseDefinition,
  );
}

export function assertPostNightFourTransitionSurfaceCase({
  postNightFourTransitionSurface,
  expectedGame,
  assertHostPhaseTransitionActionProof,
  assertPlayerSurfaceProof,
  assertStaleActionRecoveryProof,
  includeEvidenceInError = false,
}) {
  const surfaceCase = postNightFourTransitionSurfaceCaseDefinition;
  if (
    postNightFourTransitionSurface?.status !== "passed" ||
    postNightFourTransitionSurface.clickedThroughFromRoleUrl !== true ||
    postNightFourTransitionSurface.releaseReady !== false ||
    postNightFourTransitionSurface.productionReady !== false ||
    typeof postNightFourTransitionSurface.sourceHostRoleUrl !== "string" ||
    !postNightFourTransitionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof postNightFourTransitionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !postNightFourTransitionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof postNightFourTransitionSurface.sourceDeadPlayerRoleUrl !== "string" ||
    !postNightFourTransitionSurface.sourceDeadPlayerRoleUrl.includes("/g/") ||
    !surfaceCase.transitionFragments.every((fragment) =>
      String(postNightFourTransitionSurface.transition ?? "").includes(fragment),
    )
  ) {
    throwPostNightFourTransitionAssertionError({
      message: "core-loop admin proof missing post-Night 4 transition surface",
      evidence: postNightFourTransitionSurface,
      includeEvidenceInError,
    });
  }
  assertPostNightFourHostAdvanceProofCase({
    proof: postNightFourTransitionSurface.hostAdvanceProof,
    expectedGame,
    sourceRoleUrl: postNightFourTransitionSurface.sourceHostRoleUrl,
    assertHostPhaseTransitionActionProof,
    includeEvidenceInError,
  });
  for (const playerCase of surfaceCase.playerObservationCases) {
    assertPlayerSurfaceProof({
      proof: postNightFourTransitionSurface[playerCase.proofField],
      sourceRoleUrl:
        postNightFourTransitionSurface[playerCase.sourceRoleUrlField],
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
      expectedLastVoteOutcomePhaseId: playerCase.expectedLastVoteOutcomePhaseId,
      expectedPrivateReceiptStatus: playerCase.expectedPrivateReceiptStatus,
      expectedPrivateReceiptPhaseId: playerCase.expectedPrivateReceiptPhaseId,
      includeEvidenceInError,
    });
  }
  assertStaleActionRecoveryProof({
    proof: postNightFourTransitionSurface.staleNightFourActionRecoveryProof,
    expectedGame,
    sourceRoleUrl: postNightFourTransitionSurface.sourceActionPlayerRoleUrl,
    includeEvidenceInError,
  });
}

function assertPostNightFourHostAdvanceProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  assertHostPhaseTransitionActionProof,
  includeEvidenceInError,
}) {
  const surfaceCase = postNightFourTransitionSurfaceCaseDefinition;
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== surfaceCase.surfaceTestId ||
    proof.setupResyncFromSeq !== surfaceCase.hostAdvanceSetupResyncFromSeq ||
    proof.setupSnapshotHost?.phase?.id !== surfaceCase.hostAdvanceSetupPhaseId ||
    proof.setupSnapshotHost?.phase?.state !==
      surfaceCase.hostAdvanceSetupPhaseState
  ) {
    throwPostNightFourTransitionAssertionError({
      message: "core-loop admin proof missing post-Night 4 host advance",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    ...surfaceCase.hostAdvanceCase,
    sourceRoleUrl,
    includeEvidenceInError,
  });
  if (
    proof.advanceProof?.dayVoteOutcomesProjection?.at?.(-1)?.phaseId !==
    surfaceCase.expectedHostAdvanceDayVoteOutcomePhaseId
  ) {
    throwPostNightFourTransitionAssertionError({
      message: "core-loop admin proof missing post-Night 4 host outcome context",
      evidence: proof.advanceProof,
      includeEvidenceInError,
    });
  }
}

function throwPostNightFourTransitionAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
