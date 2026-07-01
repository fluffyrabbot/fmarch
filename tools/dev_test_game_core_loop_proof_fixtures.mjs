export function hostPhaseTransitionActionFixture({
  actionId,
  commandKind,
  streamSeq,
  phaseId,
  phaseState,
  deadlineAffordance,
  projectionRefreshKeys,
  command,
  dayVoteOutcomesProjection = [],
}) {
  return {
    status: "passed",
    clickedAction: actionId,
    commandKind,
    command,
    commandStatus: {
      state: "ack",
      message: `Ack: stream seqs ${streamSeq}`,
    },
    commandOutcome: {
      state: "ack",
      message: `Ack: stream seqs ${streamSeq}`,
    },
    bridgePlan: {
      role: "moderator",
      commandKind,
      commandEndpoint: "/commands",
      finalState: "ack",
      projectionRefreshKeys,
    },
    projection: {
      phase: {
        id: phaseId,
        state: phaseState,
        locked: phaseState === "locked",
      },
    },
    dayVoteOutcomesProjection,
    checkpointPhaseId: phaseId,
    checkpointPhaseState: phaseState,
    checkpointDeadlineAffordance: deadlineAffordance,
    activityStatusText: `Ack: stream seqs ${streamSeq}`,
  };
}

export function postDayThreePlayerSurfaceFixture({
  sourceRoleUrl,
  visitedRolePath,
  slotField,
  slot,
  principalUserId,
  phaseId,
  phaseState,
  actorAlive,
  actorStatus,
  gameCompleted = false,
  actionState,
  statusText,
  privateCount,
  privateReceipt,
  boundary,
  resyncFromSeq,
  commandStateEndpoint,
  notificationsEndpoint,
  voteButtonCount = 0,
  voteTargets = [],
  dayVoteOutcomes = [
    { phaseId: "D02", status: "Lynch" },
    { phaseId: "D03", status: "Lynch", winnerSlot: "slot-4" },
  ],
  privateReceiptStatus = "day_vote",
  privateReceiptPhaseId = "D03",
}) {
  const proof = {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    [slotField]: slot,
    principalUserId,
    checkpoint: {
      phaseId,
      phaseState,
      actorSlot: slot,
      actionState,
      receiptState: "idle",
      statusText,
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: privateCount,
      text:
        "Notifications and investigation results are loaded from principal-scoped endpoints only.",
    },
    voteButtonCount,
    projectionCommandState: {
      actorSlot: slot,
      actorAlive,
      actorStatus,
      gameCompleted,
      phase: {
        phaseId,
        locked: phaseState === "locked",
      },
      actions: [],
      voteTargets,
      boundary,
    },
    projectionNotifications: privateReceipt
      ? [
          {
            effect: "player_killed",
            status: privateReceiptStatus,
          },
        ]
      : [],
    projectionDayVoteOutcomes: dayVoteOutcomes,
    resyncFromSeq,
    resyncSnapshotCommandState: {
      actorSlot: slot,
      gameCompleted,
      phase: {
        phaseId,
      },
    },
    resyncSnapshotNotifications: privateReceipt
      ? [
          {
            status: privateReceiptStatus,
          },
        ]
      : [],
    coldLoadEndpoints: {
      notificationsEndpoint,
      commandStateEndpoint,
    },
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
  if (privateReceipt) {
    proof.privateNotice = {
      id: "notification-1",
      kind: "notification",
      text: `player_killed ${privateReceiptStatus}`,
      detailText: `Phase ${privateReceiptPhaseId}`,
    };
  } else {
    proof.privateEmptyText = "No private results visible";
  }
  return proof;
}

export function seededCoreLoopPlayerSurfaceFixture({
  game,
  roleUrlSuffix = "",
  visitedRolePathSuffix = roleUrlSuffix,
  slot,
  principalUserId,
  ...proofArgs
}) {
  return postDayThreePlayerSurfaceFixture({
    sourceRoleUrl: seededCoreLoopRoleUrl({ game, suffix: roleUrlSuffix }),
    visitedRolePath: seededCoreLoopRolePath({
      game,
      suffix: visitedRolePathSuffix,
    }),
    slot,
    principalUserId,
    commandStateEndpoint: seededCoreLoopCommandStateEndpoint({
      game,
      principalUserId,
      slot,
    }),
    notificationsEndpoint: seededCoreLoopNotificationsEndpoint({
      game,
      principalUserId,
    }),
    ...proofArgs,
  });
}

export function seededCoreLoopHostSurfaceFixture({
  game,
  setupResyncFromSeq,
  setupPhaseId,
  setupPhaseState,
  setupSnapshotHost,
  ...proofs
}) {
  const surface = {
    status: "passed",
    sourceRoleUrl: seededCoreLoopRoleUrl({ game, suffix: "/host" }),
    visitedRolePath: seededCoreLoopRolePath({ game, suffix: "/host" }),
    surfaceTestId: "host-console-surface",
    clickedThroughFromRoleUrl: true,
    ...proofs,
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
  if (setupResyncFromSeq !== undefined) {
    surface.setupResyncFromSeq = setupResyncFromSeq;
  }
  if (setupSnapshotHost !== undefined) {
    surface.setupSnapshotHost = setupSnapshotHost;
  } else if (setupPhaseId !== undefined || setupPhaseState !== undefined) {
    surface.setupSnapshotHost = {
      phase: {
        id: setupPhaseId,
        state: setupPhaseState,
      },
    };
  }
  return surface;
}

export function seededCoreLoopRoleUrl({ game, suffix = "" }) {
  return `http://127.0.0.1:5173/g/${game}${suffix}`;
}

export function seededCoreLoopRolePath({ game, suffix = "" }) {
  return `/g/${game}${suffix}`;
}

export function seededCoreLoopCommandStateEndpoint({
  game,
  principalUserId,
  slot,
}) {
  return `/games/${game}/player-command-state?principal_user_id=${principalUserId}&slot_id=${slot}`;
}

export function seededCoreLoopNotificationsEndpoint({ game, principalUserId }) {
  return `/games/${game}/notifications?principal_user_id=${principalUserId}`;
}
