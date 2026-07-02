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
    completedCommandStateBoundary:
      "Role-action availability: game is complete.",
    completedCommandStateBoundaryFragment: "game is complete",
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

export function privateChannelSubmitPostCommandFacts({
  channelId = privateChannelSubmitPostScenario().channelId,
  actorSlot = privateChannelSubmitPostScenario().actorSlot,
} = {}) {
  const scenario = privateChannelSubmitPostScenario();
  return {
    channelId,
    actorSlot,
    commandAction: scenario.clickedAction,
    commandKind: scenario.commandKind,
  };
}

export function staleCompletedPrivatePostCommandFacts({
  channelId = staleCompletedPrivatePostScenario().channelId,
  actorSlot = staleCompletedPrivatePostScenario().actorSlot,
} = {}) {
  const scenario = staleCompletedPrivatePostScenario();
  const completedScenario = completedPrivateChannelReloadScenario();
  return {
    ...privateChannelSubmitPostCommandFacts({ channelId, actorSlot }),
    commandError: scenario.commandError,
    commandMessage: scenario.commandMessage,
    commandStateBoundary:
      completedScenario.completedCommandStateBoundary,
    commandStateBoundaryFragment:
      completedScenario.completedCommandStateBoundaryFragment,
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
