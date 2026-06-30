const privateQueueBoundaryStatus = "principal-scoped-private-projections";

export function privateReceiptScenario(id) {
  const scenario = privateReceiptScenarios().find((entry) => entry.id === id);
  if (scenario === undefined) {
    throw new Error(`unknown private receipt scenario: ${id}`);
  }
  return scenario;
}

export function privateReceiptScenarios() {
  return [
    {
      id: "n01-target-receipt",
      slotField: "targetSlot",
      expectedSlot: "slot-2",
      principalUserId: "player_ilya",
      phaseId: "N01",
      phaseState: "locked",
      actorAlive: false,
      actorStatus: "dead",
      actionState: "disabled:actor is not alive",
      statusText: "actor is not alive",
      privateReceipt: true,
      privateReceiptStatus: "factional_kill",
      privateReceiptPhaseId: "N01",
      boundaryText: "target role received factional_kill private receipt",
      resyncFromSeq: 901,
      assertProjectionPhase: false,
      assertResyncSnapshotPhase: false,
      assertResyncNotificationStatus: false,
    },
    {
      id: "n01-normal-privacy",
      slotField: "normalSlot",
      expectedSlot: "slot-4",
      principalUserId: "player_rowan",
      phaseId: "N01",
      phaseState: "locked",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:phase locked",
      statusText: "phase locked",
      privateReceipt: false,
      privateReceiptStatus: "factional_kill",
      privateReceiptPhaseId: "N01",
      boundaryText: "normal role received no target-only private receipt",
      resyncFromSeq: 901,
      assertResyncSnapshotPhase: false,
    },
    {
      id: "d02-target-receipt",
      slotField: "targetSlot",
      expectedSlot: "slot-2",
      principalUserId: "player_ilya",
      phaseId: "D02",
      phaseState: "locked",
      actorAlive: false,
      actorStatus: "dead",
      actionState: "disabled:actor is not alive",
      statusText: "actor is not alive",
      privateReceipt: true,
      privateReceiptStatus: "day_vote",
      privateReceiptPhaseId: "D02",
      boundaryText: "target role received day_vote private receipt",
      resyncFromSeq: 902,
      assertResyncSnapshotPhase: false,
      assertResyncNotificationEffect: false,
    },
    {
      id: "d02-normal-privacy",
      slotField: "normalSlot",
      expectedSlot: "slot-4",
      principalUserId: "player_rowan",
      phaseId: "D02",
      phaseState: "locked",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:phase locked",
      statusText: "phase locked",
      privateReceipt: false,
      privateReceiptStatus: "day_vote",
      privateReceiptPhaseId: "D02",
      boundaryText: "normal role received no target-only private receipt",
      resyncFromSeq: 902,
      assertResyncSnapshotPhase: false,
    },
    {
      id: "n02-target-receipt",
      slotField: "targetSlot",
      expectedSlot: "slot-3",
      principalUserId: "player-seed",
      phaseId: "N02",
      phaseState: "locked",
      actorAlive: false,
      actorStatus: "dead",
      actionState: "disabled:actor is not alive",
      statusText: "actor is not alive",
      privateReceipt: true,
      privateReceiptStatus: "factional_kill",
      privateReceiptPhaseId: "N02",
      boundaryText: "night target role received factional_kill private receipt",
      resyncFromSeq: 904,
    },
    {
      id: "n02-normal-privacy",
      slotField: "normalSlot",
      expectedSlot: "slot-4",
      principalUserId: "player_rowan",
      phaseId: "N02",
      phaseState: "locked",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:phase locked",
      statusText: "phase locked",
      privateReceipt: false,
      privateReceiptStatus: "factional_kill",
      privateReceiptPhaseId: "N02",
      boundaryText: "normal role received no target-only private receipt",
      resyncFromSeq: 904,
    },
    {
      id: "d03-target-receipt",
      slotField: "targetSlot",
      expectedSlot: "slot-4",
      principalUserId: "player_rowan",
      phaseId: "D03",
      phaseState: "locked",
      actorAlive: false,
      actorStatus: "dead",
      actionState: "disabled:actor is not alive",
      statusText: "actor is not alive",
      privateReceipt: true,
      privateReceiptStatus: "day_vote",
      privateReceiptPhaseId: "D03",
      boundaryText: "target role received day_vote private receipt",
      resyncFromSeq: 908,
    },
    {
      id: "d03-action-player-privacy",
      slotField: "actionPlayerSlot",
      expectedSlot: "slot-7",
      principalUserId: "player_mira",
      phaseId: "D03",
      phaseState: "locked",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:phase locked",
      statusText: "phase locked",
      privateReceipt: false,
      privateReceiptStatus: "day_vote",
      privateReceiptPhaseId: "D03",
      boundaryText: "action player stayed alive",
      resyncFromSeq: 908,
    },
    {
      id: "n04-survivor-receipt",
      slotField: "survivorSlot",
      expectedSlot: "slot-5",
      principalUserId: "player_sage",
      phaseId: "N04",
      phaseState: "locked",
      actorAlive: false,
      actorStatus: "dead",
      actionState: "disabled:actor is not alive",
      statusText: "actor is not alive",
      privateReceipt: true,
      privateReceiptStatus: "factional_kill",
      privateReceiptPhaseId: "N04",
      boundaryText: "survivor target received factional_kill private receipt",
      resyncFromSeq: 916,
    },
    {
      id: "n04-action-player-privacy",
      slotField: "actionPlayerSlot",
      expectedSlot: "slot-7",
      principalUserId: "player_mira",
      phaseId: "N04",
      phaseState: "locked",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:phase locked",
      statusText: "phase locked",
      privateReceipt: false,
      privateReceiptStatus: "factional_kill",
      privateReceiptPhaseId: "N04",
      boundaryText: "action player stayed alive",
      resyncFromSeq: 916,
    },
  ];
}

export function completedPrivateChannelReloadScenario() {
  return {
    transitionToken: "private:role-pm:reload:complete",
    resyncFromSeq: 921,
    routeBoundary:
      "Seeded browser completed private-channel role URL reloaded into durable endgame controls.",
    expectedBoundary: "completed private-channel role URL reloaded",
  };
}

export function privateChannelSubmitPostScenario() {
  return {
    clickedAction: "submit_post",
    commandKind: "SubmitPost",
    channelId: "role-pm",
    actorSlot: "slot-7",
    postBody: "Private role proof post",
    ackSeq: 701,
    expectedRefreshKeys: [
      "thread",
      "votecount",
      "commandState",
      "dayVoteOutcomes",
    ],
    routeBoundary: "Seeded browser private post ACK refreshed role-pm state.",
  };
}

export function stalePrivateChannelPostPhaseLockedScenario() {
  return {
    clickedAction: "submit_post",
    commandKind: "SubmitPost",
    channelId: "role-pm",
    actorSlot: "slot-7",
    stalePostBody: "Stale private phase proof post",
    commandError: "PhaseLocked",
    commandMessageFragment:
      "Reject PhaseLocked: phase locked; stale projection, refresh and use current controls",
    expectedRefreshKeys: [
      "thread",
      "votecount",
      "commandState",
      "dayVoteOutcomes",
    ],
    currentThreadBody: "Current role-pm thread after stale private post reject",
    expectedPhaseId: "D02",
    expectedLocked: true,
    expectedActionState: "disabled:phase locked",
    expectedReceiptState: "reject:PhaseLocked",
    expectedReceiptStatusFragment: "reject phaselocked: phase locked",
    routeBoundary:
      "Seeded browser private post PhaseLocked recovery refreshed role-pm into locked Day 2.",
  };
}

export function staleCompletedPrivatePostScenario() {
  return {
    transitionToken: "private:submit_post:reject:GameAlreadyCompleted",
    stalePostBody: "Stale completed private proof post",
    expectedRefreshKeys: [
      "thread",
      "votecount",
      "commandState",
      "dayVoteOutcomes",
    ],
    routeBoundary:
      "Seeded browser completed private-channel GameAlreadyCompleted recovery refreshed role-pm controls.",
    staleBoundary:
      "Seeded browser stale completed private-channel proof opened before completion refresh.",
    expectedBoundary: "GameAlreadyCompleted recovery refreshed role-pm controls",
  };
}

export function completedPrivateChannelTransitionTokens() {
  return [
    completedPrivateChannelReloadScenario().transitionToken,
    staleCompletedPrivatePostScenario().transitionToken,
  ];
}

export function completedPrivateChannelTransition() {
  return completedPrivateChannelTransitionTokens().join(" -> ");
}

export function assertCompletedPrivateChannelTransition({
  transition,
  failureMessage = "completed private-channel transition missing shared scenario tokens",
}) {
  const transitionText = String(transition ?? "");
  const missingTokens = completedPrivateChannelTransitionTokens().filter(
    (token) => !transitionText.includes(token),
  );
  if (missingTokens.length > 0) {
    throw new Error(`${failureMessage}: ${missingTokens.join(", ")}`);
  }
}

export function completedPrivateChannelReloadSnapshotAssertionCases({
  proof,
  scenario = completedPrivateChannelReloadScenario(),
}) {
  return [
    {
      label: "initial",
      snapshot: proof?.initialSnapshot,
      expectedBoundary: scenario.expectedBoundary,
    },
    {
      label: "reloaded",
      snapshot: proof?.reloadedSnapshot,
      expectedBoundary: scenario.expectedBoundary,
    },
  ];
}

export function staleCompletedPrivatePostSnapshotAssertionCases({
  proof,
  scenario = staleCompletedPrivatePostScenario(),
}) {
  return [
    {
      label: "afterReject",
      snapshot: proof?.snapshotAfterReject,
      expectedBoundary: scenario.expectedBoundary,
      rejectedBody: proof?.stalePrivatePostBody,
    },
    {
      label: "afterReload",
      snapshot: proof?.snapshotAfterReload,
      expectedBoundary: scenario.expectedBoundary,
      rejectedBody: proof?.stalePrivatePostBody,
    },
  ];
}

export function privateReceiptProofArgs(scenario) {
  return {
    expectedSlot: scenario.expectedSlot,
    principalUserId: scenario.principalUserId,
    slotField: scenario.slotField,
    notifications: privateReceiptNotifications(scenario),
    resyncFromSeq: scenario.resyncFromSeq,
  };
}

export function privateReceiptAssertionArgs({
  scenario,
  expectedGame,
  sourceRoleUrl,
}) {
  return {
    sourceRoleUrl,
    expectedSlot: scenario.expectedSlot,
    slotField: scenario.slotField,
    expectedPrincipalUserId: scenario.principalUserId,
    expectedPhaseId: scenario.phaseId,
    expectedPhaseState: scenario.phaseState,
    expectedActorAlive: scenario.actorAlive,
    expectedActorStatus: scenario.actorStatus,
    expectedActionState: scenario.actionState,
    expectedStatusText: scenario.statusText,
    expectedPrivateCount: scenario.privateReceipt ? 1 : 0,
    expectedPrivateReceipt: scenario.privateReceipt,
    expectedBoundaryText: scenario.boundaryText,
    expectedResyncFromSeq: scenario.resyncFromSeq,
    expectedPrivateReceiptStatus: scenario.privateReceiptStatus,
    expectedPrivateReceiptPhaseId: scenario.privateReceiptPhaseId,
    expectedResyncNotificationEffect:
      scenario.assertResyncNotificationEffect === false ? null : "player_killed",
    expectedResyncNotificationStatus:
      scenario.assertResyncNotificationStatus === false
        ? null
        : scenario.privateReceiptStatus,
    expectedPrivateQueueBoundaryStatus: privateQueueBoundaryStatus,
    expectedProjectionPhaseId:
      scenario.assertProjectionPhase === false ? null : scenario.phaseId,
    expectedProjectionLocked:
      scenario.assertProjectionPhase === false
        ? null
        : scenario.phaseState === "locked",
    expectedResyncSnapshotPhaseId:
      scenario.assertResyncSnapshotPhase === false ? null : scenario.phaseId,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=${scenario.principalUserId}&slot_id=${scenario.expectedSlot}`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=${scenario.principalUserId}`,
  };
}

function privateReceiptNotifications(scenario) {
  if (!scenario.privateReceipt) {
    return [];
  }
  return [
    {
      effect: "player_killed",
      phase_id: scenario.privateReceiptPhaseId,
      status: scenario.privateReceiptStatus,
    },
  ];
}
