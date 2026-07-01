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
    channelId: "role-pm",
    actorSlot: "slot-7",
    actorStatus: "alive",
    completedPhaseId: "N05",
    completedPhaseState: "open",
    completedActionState: "disabled:game complete",
    completedThreadBody: "Completed private channel remains readable.",
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
    clickedAction: "submit_post",
    commandKind: "SubmitPost",
    channelId: "role-pm",
    actorSlot: "slot-7",
    commandError: "GameAlreadyCompleted",
    commandMessage: "Reject GameAlreadyCompleted: game already completed",
    expectedReceiptStatusFragment: "reject gamealreadycompleted",
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

export function completedPrivateChannelSnapshot({
  scenario = completedPrivateChannelReloadScenario(),
  receiptState = "idle",
  boundary = scenario.routeBoundary,
} = {}) {
  return {
    checkpoint: {
      phaseId: scenario.completedPhaseId,
      phaseState: scenario.completedPhaseState,
      actorSlot: scenario.actorSlot,
      actionState: scenario.completedActionState,
      receiptState,
    },
    commandPanelChannelId: scenario.channelId,
    channelContext: {
      channelId: scenario.channelId,
      actorSlot: scenario.actorSlot,
      capabilityLabel: `ChannelMember(${scenario.channelId})`,
      actorStatus: scenario.actorStatus,
    },
    commandState: {
      actorSlot: scenario.actorSlot,
      gameCompleted: true,
      actions: [],
      voteTargets: [],
      boundary,
    },
    threadPostBodies: [scenario.completedThreadBody],
    buttons: [
      { action: "withdraw_vote", disabled: true, reason: "" },
      { action: "submit_post", disabled: true, reason: "" },
    ],
    enabledMutatingButtons: [],
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

export function completedPrivateChannelProofAssertionCases({
  proof,
  expectedGame,
  sourceRoleUrl,
  visitedRolePath,
  assertCompletedPrivateChannelReloadProof,
  assertStaleCompletedPrivatePostRecoveryProof,
}) {
  return [
    completedPrivateChannelReloadAssertionCase({
      proof,
      sourceRoleUrl,
      visitedRolePath,
      assertCompletedPrivateChannelReloadProof,
    }),
    staleCompletedPrivatePostAssertionCase({
      proof,
      expectedGame,
      sourceRoleUrl,
      visitedRolePath,
      assertStaleCompletedPrivatePostRecoveryProof,
    }),
  ];
}

export function completedPrivateChannelReloadAssertionCase({
  proof,
  sourceRoleUrl,
  visitedRolePath,
  assertCompletedPrivateChannelReloadProof,
}) {
  return {
    assertProof: assertCompletedPrivateChannelReloadProof,
    proof: proof?.reloadProof,
    ...completedPrivateChannelReloadProofArgs({
      sourceRoleUrl,
      visitedRolePath,
    }),
  };
}

export function completedPrivateChannelReloadProofArgs({
  sourceRoleUrl,
  visitedRolePath,
}) {
  return {
    sourceRoleUrl,
    visitedRolePath,
  };
}

export function staleCompletedPrivatePostAssertionCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  visitedRolePath,
  assertStaleCompletedPrivatePostRecoveryProof,
}) {
  return {
    assertProof: assertStaleCompletedPrivatePostRecoveryProof,
    proof: proof?.staleCompletedPostRecoveryProof,
    ...staleCompletedPrivatePostProofArgs({
      expectedGame,
      sourceRoleUrl,
      visitedRolePath,
    }),
  };
}

export function staleCompletedPrivatePostProofArgs({
  expectedGame,
  sourceRoleUrl,
  visitedRolePath,
}) {
  return {
    expectedGame,
    sourceRoleUrl,
    visitedRolePath,
  };
}

export function assertCompletedPrivateChannelProofCases({
  proof,
  sourceRoleUrl,
  visitedRolePath,
  cases,
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    proof.visitedRolePath !== visitedRolePath
  ) {
    throwPrivateChannelScenarioAssertionError({
      message: "core-loop admin proof missing completed private channel shell",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  assertCompletedPrivateChannelTransition({
    transition: proof.transition,
    failureMessage:
      "core-loop admin proof missing completed private channel transition",
  });
  for (const { assertProof, ...scenario } of cases) {
    assertProof(scenario);
  }
}

export function assertPrivateChannelSubmitPostProofCase({
  proof,
  expectedGame,
  scenario = privateChannelSubmitPostScenario(),
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedAction !== scenario.clickedAction ||
    proof.commandKind !== scenario.commandKind ||
    proof.command?.game !== expectedGame ||
    proof.command.channel_id !== scenario.channelId ||
    proof.command.actor_slot !== scenario.actorSlot ||
    proof.command.body !== proof.privatePostBody ||
    proof.privatePostBody !== scenario.postBody ||
    proof.commandStatus?.state !== "ack" ||
    !String(proof.commandStatus?.message ?? "").includes(
      `Ack: stream seqs ${scenario.ackSeq}`,
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== scenario.commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(
      proof.bridgePlan.projectionRefreshKeys,
      scenario.expectedRefreshKeys,
    ) ||
    proof.receipts?.at?.(-1)?.state !== "ack" ||
    proof.projectionThread?.posts?.at?.(-1)?.body !== proof.privatePostBody ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(`ack: stream seqs ${scenario.ackSeq}`) ||
    proof.receiptRefreshKeys !== scenario.expectedRefreshKeys.join(",")
  ) {
    throwPrivateChannelScenarioAssertionError({
      message: "core-loop admin proof missing private channel SubmitPost ACK",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertStalePrivateChannelPostPhaseLockedProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  visitedRolePath,
  scenario = stalePrivateChannelPostPhaseLockedScenario(),
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    proof.visitedRolePath !== visitedRolePath ||
    proof.clickedAction !== scenario.clickedAction ||
    proof.commandKind !== scenario.commandKind ||
    proof.command?.game !== expectedGame ||
    proof.command.channel_id !== scenario.channelId ||
    proof.command.actor_slot !== scenario.actorSlot ||
    proof.command.body !== proof.stalePrivatePostBody ||
    proof.stalePrivatePostBody !== scenario.stalePostBody ||
    proof.commandStatus?.state !== "reject" ||
    proof.commandStatus.error !== scenario.commandError ||
    !String(proof.commandStatus.message ?? "").includes(
      scenario.commandMessageFragment,
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== scenario.commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "reject" ||
    !sameStringArray(
      proof.bridgePlan.projectionRefreshKeys,
      scenario.expectedRefreshKeys,
    ) ||
    proof.receipts?.at?.(-1)?.state !== "reject" ||
    proof.projectionCommandState?.phase?.phaseId !==
      scenario.expectedPhaseId ||
    proof.projectionCommandState?.phase?.locked !== scenario.expectedLocked ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      "private post PhaseLocked recovery",
    ) ||
    proof.projectionThread?.posts?.at?.(-1)?.body !==
      scenario.currentThreadBody ||
    proof.projectionThread?.posts?.some?.(
      (post) => post?.body === proof.stalePrivatePostBody,
    ) === true ||
    !String(proof.currentThreadText ?? "").includes(scenario.currentThreadBody) ||
    proof.checkpointPhaseId !== scenario.expectedPhaseId ||
    proof.checkpointActionState !== scenario.expectedActionState ||
    proof.checkpointReceiptState !== scenario.expectedReceiptState ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(scenario.expectedReceiptStatusFragment) ||
    proof.receiptRefreshKeys !== scenario.expectedRefreshKeys.join(",") ||
    proof.rawInviteTokensVisible !== false
  ) {
    throwPrivateChannelScenarioAssertionError({
      message: "core-loop admin proof missing private channel stale post recovery",
      evidence: proof,
      includeEvidenceInError,
    });
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

export function assertCompletedPrivateChannelReloadProofCase({
  proof,
  sourceRoleUrl,
  visitedRolePath,
  scenario = completedPrivateChannelReloadScenario(),
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    proof.visitedRolePath !== visitedRolePath ||
    proof.surfaceTestId !== "player-surface" ||
    proof.resyncFromSeq !== scenario.resyncFromSeq ||
    proof.initialResyncSnapshotCommandState?.gameCompleted !== true ||
    proof.reloadedResyncSnapshotCommandState?.gameCompleted !== true
  ) {
    throwPrivateChannelScenarioAssertionError({
      message: "core-loop admin proof missing completed private reload shell",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  for (const snapshotCase of completedPrivateChannelReloadSnapshotAssertionCases({
    proof,
    scenario,
  })) {
    assertCompletedPrivateChannelSnapshotCase({
      ...snapshotCase,
      scenario,
      includeEvidenceInError,
    });
  }
}

export function assertStaleCompletedPrivatePostRecoveryProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  visitedRolePath,
  scenario = staleCompletedPrivatePostScenario(),
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    proof.visitedRolePath !== visitedRolePath ||
    proof.clickedAction !== scenario.clickedAction ||
    proof.commandKind !== scenario.commandKind ||
    proof.command?.game !== expectedGame ||
    proof.command.channel_id !== scenario.channelId ||
    proof.command.actor_slot !== scenario.actorSlot ||
    proof.command.body !== proof.stalePrivatePostBody ||
    proof.stalePrivatePostBody !== scenario.stalePostBody ||
    proof.submitDisabledBeforeReject !== false ||
    proof.commandStatus?.state !== "reject" ||
    proof.commandStatus.error !== scenario.commandError ||
    !String(proof.commandStatus.message ?? "").includes(
      scenario.commandMessage,
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== scenario.commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "reject" ||
    !sameStringArray(
      proof.bridgePlan.projectionRefreshKeys,
      scenario.expectedRefreshKeys,
    ) ||
    proof.receipts?.at?.(-1)?.state !== "reject" ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(scenario.expectedReceiptStatusFragment) ||
    proof.receiptRefreshKeys !== scenario.expectedRefreshKeys.join(",") ||
    proof.reloadedResyncSnapshotCommandState?.gameCompleted !== true
  ) {
    throwPrivateChannelScenarioAssertionError({
      message: "core-loop admin proof missing stale completed private post recovery",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  for (const snapshotCase of staleCompletedPrivatePostSnapshotAssertionCases({
    proof,
    scenario,
  })) {
    assertCompletedPrivateChannelSnapshotCase({
      ...snapshotCase,
      scenario: completedPrivateChannelReloadScenario(),
      includeEvidenceInError,
    });
  }
}

export function assertCompletedPrivateChannelSnapshotCase({
  snapshot,
  label,
  expectedBoundary,
  rejectedBody = null,
  scenario = completedPrivateChannelReloadScenario(),
  includeEvidenceInError = false,
}) {
  if (
    snapshot?.checkpoint?.phaseId !== scenario.completedPhaseId ||
    snapshot.checkpoint.phaseState !== scenario.completedPhaseState ||
    snapshot.checkpoint.actorSlot !== scenario.actorSlot ||
    snapshot.checkpoint.actionState !== scenario.completedActionState ||
    snapshot.commandPanelChannelId !== scenario.channelId ||
    snapshot.channelContext?.channelId !== scenario.channelId ||
    snapshot.channelContext?.actorSlot !== scenario.actorSlot ||
    snapshot.channelContext?.capabilityLabel !==
      `ChannelMember(${scenario.channelId})` ||
    snapshot.channelContext?.actorStatus !== scenario.actorStatus ||
    snapshot.commandState?.actorSlot !== scenario.actorSlot ||
    snapshot.commandState?.gameCompleted !== true ||
    snapshot.commandState?.actions?.length !== 0 ||
    snapshot.commandState?.voteTargets?.length !== 0 ||
    !String(snapshot.commandState?.boundary ?? "").includes(expectedBoundary) ||
    !snapshot.threadPostBodies?.includes(scenario.completedThreadBody) ||
    snapshot.enabledMutatingButtons?.length !== 0 ||
    !snapshot.buttons?.some(
      (button) => button.action === "submit_post" && button.disabled === true,
    ) ||
    (rejectedBody !== null &&
      snapshot.threadPostBodies?.includes(rejectedBody) === true)
  ) {
    throwPrivateChannelScenarioAssertionError({
      message: `core-loop admin proof missing ${label} completed private channel closure`,
      evidence: snapshot,
      includeEvidenceInError,
    });
  }
}

function throwPrivateChannelScenarioAssertionError({
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

export function assertPrivateReceiptRoleSurfaceCase({
  proof,
  sourceRoleUrl,
  expectedSlot,
  slotField,
  expectedPrincipalUserId,
  expectedPhaseId,
  expectedPhaseState,
  expectedActorAlive,
  expectedActorStatus,
  expectedActionState,
  expectedStatusText,
  expectedPrivateCount,
  expectedPrivateReceipt,
  expectedBoundaryText,
  expectedResyncFromSeq,
  expectedPrivateReceiptStatus,
  expectedPrivateReceiptPhaseId,
  expectedResyncNotificationEffect,
  expectedResyncNotificationStatus,
  expectedPrivateQueueBoundaryStatus,
  expectedProjectionPhaseId,
  expectedProjectionLocked,
  expectedResyncSnapshotPhaseId,
  expectedCommandStateEndpoint,
  expectedNotificationsEndpoint,
  errorMessage,
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof[slotField] !== expectedSlot ||
    proof.principalUserId !== expectedPrincipalUserId ||
    (!expectedPrivateReceipt && proof.targetReceiptVisible !== false) ||
    typeof proof.sourceRoleUrl !== "string" ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    !proof.sourceRoleUrl.includes("/g/") ||
    !proof.sourceRoleUrl.includes("private=notification-1") ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    !proof.visitedRolePath.includes("private=notification-1") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.checkpoint?.phaseId !== expectedPhaseId ||
    proof.checkpoint.phaseState !== expectedPhaseState ||
    proof.checkpoint.actorSlot !== expectedSlot ||
    proof.checkpoint.actionState !== expectedActionState ||
    proof.checkpoint.receiptState !== "idle" ||
    !String(proof.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes(`player action unavailable: ${expectedStatusText}`) ||
    proof.privateQueueBoundary?.status !== expectedPrivateQueueBoundaryStatus ||
    proof.privateQueueBoundary.count !== expectedPrivateCount ||
    !String(proof.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    proof.projectionCommandState?.actorSlot !== expectedSlot ||
    proof.projectionCommandState?.actorAlive !== expectedActorAlive ||
    proof.projectionCommandState?.actorStatus !== expectedActorStatus ||
    (expectedProjectionPhaseId !== null &&
      proof.projectionCommandState?.phase?.phaseId !== expectedProjectionPhaseId) ||
    (expectedProjectionLocked !== null &&
      proof.projectionCommandState?.phase?.locked !== expectedProjectionLocked) ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      expectedBoundaryText,
    ) ||
    proof.resyncFromSeq !== expectedResyncFromSeq ||
    proof.resyncSnapshotCommandState?.actorSlot !== expectedSlot ||
    (expectedResyncSnapshotPhaseId !== null &&
      proof.resyncSnapshotCommandState?.phase?.phaseId !==
        expectedResyncSnapshotPhaseId) ||
    proof.coldLoadEndpoints?.notificationsEndpoint !==
      expectedNotificationsEndpoint ||
    proof.coldLoadEndpoints?.commandStateEndpoint !== expectedCommandStateEndpoint
  ) {
    throwPrivateChannelScenarioAssertionError({
      message: errorMessage,
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
      (expectedResyncNotificationEffect !== null &&
        proof.resyncSnapshotNotifications?.[0]?.effect !==
          expectedResyncNotificationEffect) ||
      (expectedResyncNotificationStatus !== null &&
        proof.resyncSnapshotNotifications?.[0]?.status !==
          expectedResyncNotificationStatus))
  ) {
    throwPrivateChannelScenarioAssertionError({
      message: errorMessage,
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
    throwPrivateChannelScenarioAssertionError({
      message: errorMessage,
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertDayThreePlayerObservationProofCase({
  proof,
  sourceRoleUrl,
  expectedPrincipalUserId,
  expectedSlot,
  slotField,
  expectedActorAlive,
  expectedActorStatus,
  expectedActionState,
  expectedStatusText,
  expectedPrivateCount,
  expectedPrivateReceipt,
  expectedBoundaryText,
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
    proof.checkpoint?.phaseId !== "D03" ||
    proof.checkpoint.phaseState !== "open" ||
    proof.checkpoint.actorSlot !== expectedSlot ||
    proof.checkpoint.actionState !== expectedActionState ||
    proof.checkpoint.receiptState !== "idle" ||
    !String(proof.checkpoint.statusText ?? "")
      .toLowerCase()
      .includes(expectedStatusText) ||
    proof.privateQueueBoundary?.status !== privateQueueBoundaryStatus ||
    proof.privateQueueBoundary.count !== expectedPrivateCount ||
    !String(proof.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    proof.projectionCommandState?.actorSlot !== expectedSlot ||
    proof.projectionCommandState?.actorAlive !== expectedActorAlive ||
    proof.projectionCommandState?.actorStatus !== expectedActorStatus ||
    proof.projectionCommandState?.phase?.phaseId !== "D03" ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      expectedBoundaryText,
    ) ||
    proof.resyncFromSeq !== 906 ||
    proof.resyncSnapshotCommandState?.actorSlot !== expectedSlot ||
    proof.resyncSnapshotCommandState?.phase?.phaseId !== "D03" ||
    proof.coldLoadEndpoints?.notificationsEndpoint !==
      expectedNotificationsEndpoint ||
    proof.coldLoadEndpoints?.commandStateEndpoint !== expectedCommandStateEndpoint
  ) {
    throwPrivateChannelScenarioAssertionError({
      message: "core-loop admin proof missing Day 3 role observation",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  if (
    expectedPrivateReceipt &&
    (proof.privateNotice?.id !== "notification-1" ||
      proof.privateNotice.kind !== "notification" ||
      !String(proof.privateNotice.text ?? "").includes("player_killed") ||
      !String(proof.privateNotice.text ?? "").includes("factional_kill") ||
      proof.privateNotice.detailText !== "Phase N02" ||
      proof.projectionNotifications?.[0]?.effect !== "player_killed" ||
      proof.projectionNotifications?.[0]?.status !== "factional_kill" ||
      proof.resyncSnapshotNotifications?.[0]?.status !== "factional_kill")
  ) {
    throwPrivateChannelScenarioAssertionError({
      message: "core-loop admin proof missing Day 3 target private receipt",
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
    throwPrivateChannelScenarioAssertionError({
      message: "core-loop admin proof leaked Day 3 target receipt",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertPostDayThreePlayerSurfaceProofCase({
  proof,
  sourceRoleUrl,
  expectedSlot,
  slotField,
  expectedPrincipalUserId,
  expectedPhaseId,
  expectedPhaseState,
  expectedActorAlive,
  expectedActorStatus,
  expectedActionState,
  expectedStatusText,
  expectedPrivateCount,
  expectedPrivateReceipt,
  expectedBoundaryText,
  expectedResyncFromSeq,
  expectedCommandStateEndpoint,
  expectedNotificationsEndpoint,
  expectedVoteButtonCount = 0,
  expectedVoteTargetCount = 0,
  expectedLastVoteOutcomePhaseId = "D03",
  expectedPrivateReceiptStatus = "day_vote",
  expectedPrivateReceiptPhaseId = "D03",
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
    proof.privateQueueBoundary?.status !== privateQueueBoundaryStatus ||
    proof.privateQueueBoundary.count !== expectedPrivateCount ||
    !String(proof.privateQueueBoundary.text ?? "").includes(
      "principal-scoped endpoints",
    ) ||
    proof.voteButtonCount !== expectedVoteButtonCount ||
    proof.projectionCommandState?.actorSlot !== expectedSlot ||
    proof.projectionCommandState?.actorAlive !== expectedActorAlive ||
    proof.projectionCommandState?.actorStatus !== expectedActorStatus ||
    proof.projectionCommandState?.phase?.phaseId !== expectedPhaseId ||
    proof.projectionCommandState?.phase?.locked !==
      (expectedPhaseState === "locked") ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    proof.projectionCommandState?.voteTargets?.length !== expectedVoteTargetCount ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      expectedBoundaryText,
    ) ||
    proof.projectionDayVoteOutcomes?.at?.(-1)?.phaseId !==
      expectedLastVoteOutcomePhaseId ||
    proof.resyncFromSeq !== expectedResyncFromSeq ||
    proof.resyncSnapshotCommandState?.actorSlot !== expectedSlot ||
    proof.resyncSnapshotCommandState?.phase?.phaseId !== expectedPhaseId ||
    proof.coldLoadEndpoints?.notificationsEndpoint !==
      expectedNotificationsEndpoint ||
    proof.coldLoadEndpoints?.commandStateEndpoint !== expectedCommandStateEndpoint
  ) {
    throwPrivateChannelScenarioAssertionError({
      message: "core-loop admin proof missing post-Day 3 player surface",
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
    throwPrivateChannelScenarioAssertionError({
      message: "core-loop admin proof missing post-Day 3 target receipt",
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
    throwPrivateChannelScenarioAssertionError({
      message: "core-loop admin proof leaked post-Day 3 target receipt",
      evidence: proof,
      includeEvidenceInError,
    });
  }
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
