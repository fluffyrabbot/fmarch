import {
  completedHostStaleCommandCases,
  completedPlayerReloadCases,
  staleCompletedGamePlayerCommandCases,
} from "./dev_test_game_core_loop_completed_recovery_scenario_cases.mjs";

export function completedGameDayVoteOutcomesFixture() {
  return [
    { phaseId: "D02", status: "Lynch" },
    { phaseId: "D03", status: "Lynch" },
    { phaseId: "D04", status: "NoLynch" },
    { phaseId: "D05", status: "NoLynch" },
  ];
}

export function completedHostReloadSnapshotFixture({
  dayVoteOutcomes = completedGameDayVoteOutcomesFixture(),
} = {}) {
  return {
    checkpoint: {
      phaseId: "N05",
      phaseState: "open",
      slotId: "slot-7",
      actionState: "disabled:no lifecycle command available",
      deadlineAffordance: "none",
    },
    projection: {
      completed: true,
      phase: {
        id: "N05",
        state: "open",
        locked: false,
      },
      slots: [
        {
          role_revealed: true,
          alignment_revealed: true,
        },
        {
          role_revealed: true,
          alignment_revealed: true,
        },
      ],
    },
    votecount: [],
    dayVoteOutcomes,
    hostPrompts: [],
    actionTiles: [],
    triggerButtons: [],
  };
}

export function completedHostReloadProofFixture({
  sourceRoleUrl,
  visitedRolePath,
  snapshot,
}) {
  return {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "host-console-surface",
    clickedThroughFromRoleUrl: true,
    resyncFromSeq: 921,
    initialResyncSnapshotHost: snapshot.projection,
    reloadedResyncSnapshotHost: snapshot.projection,
    initialSnapshot: snapshot,
    reloadedSnapshot: snapshot,
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

export function completedHostStaleCommandProofFixtures({
  sourceRoleUrl,
  visitedRolePath,
  game,
  snapshot,
}) {
  return Object.fromEntries(
    completedHostStaleCommandCases().map((scenario) => [
      scenario.proofField,
      completedHostStaleCommandProofFixture({
        sourceRoleUrl,
        visitedRolePath,
        commandId: scenario.commandId,
        commandKind: scenario.commandKind,
        game,
        snapshot,
      }),
    ]),
  );
}

export function completedHostStaleCommandProofFixture({
  sourceRoleUrl,
  visitedRolePath,
  commandId,
  commandKind,
  game,
  snapshot,
}) {
  return {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "host-console-surface",
    clickedThroughFromRoleUrl: true,
    commandEndpoint: "/commands",
    commandKind,
    command: {
      game,
    },
    commandResponse: {
      ok: false,
      status: 409,
      body: {
        v: 1,
        id: commandId,
        body: {
          kind: "Reject",
          body: {
            error: "GameAlreadyCompleted",
            retryable: false,
            message: "Reject GameAlreadyCompleted: game already completed",
          },
        },
      },
    },
    setupResyncFromSeq: 921,
    setupResyncSnapshotHost: snapshot.projection,
    recoveryResyncFromSeq: 921,
    recoveryResyncSnapshotHost: snapshot.projection,
    recoverySnapshot: snapshot,
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

export function completedPlayerReloadSnapshotsFixture({
  game,
  dayVoteOutcomes = completedGameDayVoteOutcomesFixture(),
}) {
  return Object.fromEntries(
    completedPlayerReloadCases().map((scenario) => [
      scenario.proofField,
      completedPlayerReloadSnapshotFixture({
        game,
        dayVoteOutcomes,
        slot: scenario.expectedSlot,
        principalUserId: scenario.principalUserId,
        actorAlive: scenario.expectedActorAlive,
        actorStatus: scenario.expectedActorStatus,
        boundary: scenario.boundary,
      }),
    ]),
  );
}

export function completedPlayerReloadSnapshotFixture({
  game,
  dayVoteOutcomes,
  slot,
  principalUserId,
  boundary,
  actorAlive,
  actorStatus,
}) {
  const commandState = {
    actorSlot: slot,
    phase: {
      phaseId: "N05",
      locked: false,
    },
    gameCompleted: true,
    actions: [],
    voteTargets: [],
    boundary,
  };
  if (actorAlive !== undefined) {
    commandState.actorAlive = actorAlive;
  }
  if (actorStatus !== undefined) {
    commandState.actorStatus = actorStatus;
  }
  return {
    checkpoint: {
      phaseId: "N05",
      phaseState: "open",
      actorSlot: slot,
      actionState: "disabled:game complete",
      receiptState: "idle",
      targetSlots: "",
    },
    commandState,
    notifications: [],
    dayVoteOutcomes,
    coldLoadEndpoints: {
      commandStateEndpoint:
        `/games/${game}/player-command-state?principal_user_id=${principalUserId}&slot_id=${slot}`,
      notificationsEndpoint:
        `/games/${game}/notifications?principal_user_id=${principalUserId}`,
    },
    buttons: [{ action: "submit_post", disabled: true, text: "Post" }],
    enabledMutatingButtons: [],
    disabledMutatingButtons: [
      { action: "submit_post", disabled: true, text: "Post" },
    ],
  };
}

export function completedPlayerReloadProofFixtures({ roleUrls, snapshots }) {
  return Object.fromEntries(
    completedPlayerReloadCases().map((scenario) => {
      const sourceRoleUrl = roleUrls[scenario.sourceRoleUrlField];
      return [
        scenario.proofField,
        completedPlayerReloadProofFixture({
          sourceRoleUrl,
          visitedRolePath: pathAndSearchFromUrl(sourceRoleUrl),
          snapshot: snapshots[scenario.proofField],
        }),
      ];
    }),
  );
}

export function completedPlayerReloadProofFixture({
  sourceRoleUrl,
  visitedRolePath,
  snapshot,
}) {
  return {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    resyncFromSeq: 921,
    initialResyncSnapshotCommandState: snapshot.commandState,
    reloadedResyncSnapshotCommandState: snapshot.commandState,
    initialSnapshot: snapshot,
    reloadedSnapshot: snapshot,
    rawInviteTokensVisible: false,
    targetOnlyActionVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

export function completedDeadPlayerStaleVoteRecoveryProofFixture({
  sourceRoleUrl,
  visitedRolePath,
  game,
  reloadSnapshot,
  recoveryBoundary =
    "Seeded browser completed dead-player stale vote rejected into durable endgame controls.",
}) {
  return {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    commandEndpoint: "/commands",
    commandKind: "SubmitVote",
    command: {
      game,
      actor_slot: "slot-2",
      target: "NoLynch",
    },
    commandResponse: {
      ok: false,
      status: 409,
      body: {
        v: 1,
        id: "completed-dead-player-stale-vote",
        body: {
          kind: "Reject",
          body: {
            error: "GameAlreadyCompleted",
            retryable: false,
            message: "Reject GameAlreadyCompleted: game already completed",
          },
        },
      },
    },
    setupResyncFromSeq: 921,
    setupResyncSnapshotCommandState: reloadSnapshot.commandState,
    recoveryResyncFromSeq: 921,
    recoveryResyncSnapshotCommandState: reloadSnapshot.commandState,
    recoverySnapshot: {
      ...reloadSnapshot,
      commandState: {
        ...reloadSnapshot.commandState,
        boundary: recoveryBoundary,
      },
    },
    rawInviteTokensVisible: false,
    targetOnlyActionVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

export function staleCompletedPlayerCommandProofFixtures({
  sourceRoleUrl,
  visitedRolePath,
  game,
}) {
  return Object.fromEntries(
    staleCompletedGamePlayerCommandCases().map((scenario) => [
      scenario.proofField,
      staleCompletedPlayerCommandProofFixture({
        sourceRoleUrl,
        visitedRolePath,
        clickedAction: scenario.clickedAction,
        commandKind: scenario.commandKind,
        projectionRefreshKeys: scenario.expectedRefreshKeys,
        command: staleCompletedPlayerCommandFixture({ game, scenario }),
        boundary: scenario.rejectedBoundary,
        stalePostBody: scenario.postBody,
      }),
    ]),
  );
}

export function staleCompletedPlayerCommandFixture({ game, scenario }) {
  if (scenario.commandKind === "SubmitVote") {
    return {
      game,
      actor_slot: "slot-7",
      target: "NoLynch",
    };
  }
  if (scenario.commandKind === "SubmitPost") {
    return {
      game,
      actor_slot: "slot-7",
      channel_id: "main",
      body: scenario.postBody,
    };
  }
  throw new Error(`unknown stale completed player command: ${scenario.commandKind}`);
}

export function staleCompletedPlayerCommandProofFixture({
  sourceRoleUrl,
  visitedRolePath,
  clickedAction,
  commandKind,
  projectionRefreshKeys,
  command,
  boundary,
  stalePostBody,
}) {
  const proof = {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    clickedAction,
    commandKind,
    setupResyncFromSeq: 918,
    setupSnapshotCommandState: {
      phase: { phaseId: "D05" },
      voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
    },
    command,
    commandStatus: {
      state: "reject",
      error: "GameAlreadyCompleted",
      message: "Reject GameAlreadyCompleted: game already completed",
    },
    bridgePlan: {
      role: "player",
      commandKind,
      commandEndpoint: "/commands",
      finalState: "reject",
      projectionRefreshKeys,
    },
    receipts: [{ state: "reject" }],
    projectionCommandState: {
      actorSlot: "slot-7",
      phase: {
        phaseId: "N05",
        locked: false,
      },
      gameCompleted: true,
      actions: [],
      voteTargets: [],
      boundary,
    },
    checkpointReceiptState: "reject:GameAlreadyCompleted",
    checkpointPhaseIdAfterReject: "N05",
    checkpointActionStateAfterReject: "disabled:game complete",
    checkpointTargetSlotsAfterReject: "",
    receiptCount: 1,
    receiptStatusText: "Reject GameAlreadyCompleted",
    rawInviteTokensVisible: false,
    targetOnlyReceiptVisible: false,
    releaseReady: false,
    productionReady: false,
  };
  if (stalePostBody !== undefined) {
    proof.stalePostBody = stalePostBody;
  }
  return proof;
}

function pathAndSearchFromUrl(roleUrl) {
  const parsed = new URL(roleUrl);
  return `${parsed.pathname}${parsed.search}`;
}
