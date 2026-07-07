export const coreLoopPostDayVoteAdvanceFamilyId =
  "core-loop-post-day-vote-advance";

export const coreLoopPostDayVoteAdvanceLaneIds = Object.freeze([
  "resolution-receipts",
]);

const postDayVoteAdvanceSurfaceCaseDefinitions = Object.freeze({
  targetPostDayVoteAdvance: Object.freeze({
    slotField: "targetSlot",
    expectedSlot: "slot-2",
    principalUserId: "player_ilya",
    phaseId: "N02",
    phaseState: "open",
    actorAlive: false,
    actorStatus: "dead",
    actionState: "disabled:actor is not alive",
    statusText: "actor is not alive",
    privateReceipt: true,
    privateReceiptStatus: "day_vote",
    privateReceiptPhaseId: "D02",
    boundaryText: "target role remained dead",
    resyncFromSeq: 903,
    errorMessage:
      "core-loop admin proof missing target post-day-vote advance surface",
  }),
  normalPostDayVoteAdvance: Object.freeze({
    slotField: "normalSlot",
    expectedSlot: "slot-4",
    principalUserId: "player_rowan",
    phaseId: "N02",
    phaseState: "open",
    actorAlive: true,
    actorStatus: "alive",
    actionState: "disabled:no legal action available",
    statusText: "no legal action available",
    privateReceipt: false,
    privateReceiptStatus: "day_vote",
    privateReceiptPhaseId: "D02",
    boundaryText: "normal role stayed alive",
    resyncFromSeq: 903,
    errorMessage:
      "core-loop admin proof missing normal post-day-vote advance surface",
  }),
});

export function postDayVoteAdvanceSurfaceCases() {
  return Object.fromEntries(
    Object.entries(postDayVoteAdvanceSurfaceCaseDefinitions).map(
      ([key, value]) => [key, { ...value }],
    ),
  );
}

export function coreLoopPostDayVoteAdvanceScenarioFamily() {
  return {
    id: coreLoopPostDayVoteAdvanceFamilyId,
    laneIds: [...coreLoopPostDayVoteAdvanceLaneIds],
    surfaces: postDayVoteAdvanceSurfaceCases(),
  };
}

export function assertTargetPostDayVoteAdvanceSurfaceProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  includeEvidenceInError = false,
}) {
  assertPostDayVoteAdvanceSurfaceProof({
    proof,
    expectedGame,
    sourceRoleUrl,
    surfaceCase:
      postDayVoteAdvanceSurfaceCaseDefinitions.targetPostDayVoteAdvance,
    includeEvidenceInError,
  });
}

export function assertNormalPostDayVoteAdvanceSurfaceProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  includeEvidenceInError = false,
}) {
  assertPostDayVoteAdvanceSurfaceProof({
    proof,
    expectedGame,
    sourceRoleUrl,
    surfaceCase:
      postDayVoteAdvanceSurfaceCaseDefinitions.normalPostDayVoteAdvance,
    includeEvidenceInError,
  });
}

function assertPostDayVoteAdvanceSurfaceProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  surfaceCase,
  includeEvidenceInError,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof[surfaceCase.slotField] !== surfaceCase.expectedSlot ||
    proof.principalUserId !== surfaceCase.principalUserId ||
    (!surfaceCase.privateReceipt && proof.targetReceiptVisible !== false) ||
    typeof proof.sourceRoleUrl !== "string" ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    !proof.sourceRoleUrl.includes("/g/") ||
    !proof.sourceRoleUrl.includes("private=notification-1") ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    !proof.visitedRolePath.includes("private=notification-1") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.checkpoint?.phaseId !== surfaceCase.phaseId ||
    proof.checkpoint.phaseState !== surfaceCase.phaseState ||
    proof.checkpoint.actorSlot !== surfaceCase.expectedSlot ||
    proof.checkpoint.actionState !== surfaceCase.actionState ||
    proof.checkpoint.receiptState !== "idle" ||
    !String(proof.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes(`player action unavailable: ${surfaceCase.statusText}`) ||
    proof.privateQueueBoundary?.status !==
      "principal-scoped-private-projections" ||
    proof.privateQueueBoundary.count !== (surfaceCase.privateReceipt ? 1 : 0) ||
    !String(proof.privateQueueBoundary.text ?? "").includes(
      "delivered to you alone",
    ) ||
    proof.projectionCommandState?.actorSlot !== surfaceCase.expectedSlot ||
    proof.projectionCommandState?.actorAlive !== surfaceCase.actorAlive ||
    proof.projectionCommandState?.actorStatus !== surfaceCase.actorStatus ||
    proof.projectionCommandState?.phase?.phaseId !== surfaceCase.phaseId ||
    proof.projectionCommandState?.phase?.locked !==
      (surfaceCase.phaseState === "locked") ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      surfaceCase.boundaryText,
    ) ||
    proof.resyncFromSeq !== surfaceCase.resyncFromSeq ||
    proof.resyncSnapshotCommandState?.actorSlot !== surfaceCase.expectedSlot ||
    proof.resyncSnapshotCommandState?.phase?.phaseId !== surfaceCase.phaseId ||
    proof.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=${surfaceCase.principalUserId}` ||
    proof.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=${surfaceCase.principalUserId}&slot_id=${surfaceCase.expectedSlot}`
  ) {
    throwPostDayVoteAdvanceAssertionError({
      message: surfaceCase.errorMessage,
      evidence: proof,
      includeEvidenceInError,
    });
  }
  if (
    surfaceCase.privateReceipt &&
    (proof.privateNotice?.id !== "notification-1" ||
      proof.privateNotice.kind !== "notification" ||
      !String(proof.privateNotice.text ?? "").includes("player_killed") ||
      !String(proof.privateNotice.text ?? "").includes(
        surfaceCase.privateReceiptStatus,
      ) ||
      proof.privateNotice.detailText !==
        `Phase ${surfaceCase.privateReceiptPhaseId}` ||
      proof.projectionNotifications?.[0]?.effect !== "player_killed" ||
      proof.projectionNotifications?.[0]?.status !==
        surfaceCase.privateReceiptStatus ||
      proof.resyncSnapshotNotifications?.[0]?.status !==
        surfaceCase.privateReceiptStatus)
  ) {
    throwPostDayVoteAdvanceAssertionError({
      message: surfaceCase.errorMessage,
      evidence: proof,
      includeEvidenceInError,
    });
  }
  if (
    !surfaceCase.privateReceipt &&
    (!String(proof.privateEmptyText ?? "").includes("No private results visible") ||
      proof.projectionNotifications?.length !== 0 ||
      proof.resyncSnapshotNotifications?.length !== 0 ||
      proof.privateNotice !== undefined)
  ) {
    throwPostDayVoteAdvanceAssertionError({
      message: surfaceCase.errorMessage,
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

function throwPostDayVoteAdvanceAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
