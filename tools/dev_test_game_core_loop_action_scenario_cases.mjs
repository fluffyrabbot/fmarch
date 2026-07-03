export const playerActionLoopLaneId = "action-loop";
export const playerInvalidActionRecoveryLaneId = "invalid-action-recovery";
export const playerInvalidActionRecoveryHookId = "invalidActionReject";
export const playerActionBoundaryLaneId = "player-action-boundary";
export const playerActionBoundaryRecoveryHookId =
  "normalPlayerDirectActionReject";

export function playerActionSubmissionScenario() {
  return {
    clickedAction: "submit_action:factional_kill",
    commandKind: "SubmitAction",
    commandSelector: "SubmitAction",
    commandButtonSelector:
      '[data-testid="player-action-commands"] button[data-action="submit_action:factional_kill"]',
    actionId: "factional_kill",
    actorSlot: "slot-7",
    templateId: "factional_kill",
    targetSlot: "slot-3",
    grantId: "grant-factional-kill",
    streamSeq: 501,
    finalState: "ack",
    expectedRefreshKeys: [
      "notifications",
      "investigationResults",
      "commandState",
    ],
    refreshedPhaseId: "N02",
    checkpointActionState: "disabled:no legal action available",
  };
}

export function playerSlotVoteCommandFacts({
  actorSlot = "slot-7",
  targetSlot = "slot-2",
} = {}) {
  return {
    actorSlot,
    targetSlot,
    commandActionPrefix: "submit_vote",
    commandKind: "SubmitVote",
  };
}

export function playerFactionalKillActionCommandFacts({
  actorSlot = playerActionSubmissionScenario().actorSlot,
  targetSlot = playerActionSubmissionScenario().targetSlot,
  actionId = playerActionSubmissionScenario().actionId,
  phaseId,
} = {}) {
  const scenario = playerActionSubmissionScenario();
  return {
    actorSlot,
    targetSlot,
    actionId,
    commandAction: scenario.clickedAction,
    commandKind: scenario.commandKind,
    templateId: scenario.templateId,
    ...(phaseId === undefined ? {} : { phaseId }),
  };
}

export function playerInvalidActionRecoveryScenario() {
  return {
    clickedAction: "submit_invalid_action:factional_kill",
    commandKind: "SubmitAction",
    commandSelector: "SubmitAction",
    commandButtonSelector:
      '[data-testid="player-action-commands"] button[data-action="submit_invalid_action:factional_kill"]',
    actionId: "invalid_self_factional_kill",
    actorSlot: "slot-7",
    templateId: "factional_kill",
    targetSlot: "slot-7",
    grantId: "grant-factional-kill",
    finalState: "reject",
    error: "InvalidTarget",
    messageIncludes: "Reject InvalidTarget: invalid target",
    expectedRefreshKeys: [
      "notifications",
      "investigationResults",
      "commandState",
    ],
    refreshedPhaseId: "N02",
    refreshedActionTemplateId: "factional_kill",
    checkpointReceiptState: "reject:InvalidTarget",
    checkpointActionState: "enabled:submit_action:factional_kill",
    checkpointTargetSlots: "slot-3",
    recoveryHookId: playerInvalidActionRecoveryHookId,
  };
}

export function staleNightFourActionRecoveryScenario() {
  return {
    clickedAction: "submit_action:factional_kill",
    commandKind: "SubmitAction",
    commandSelector: "SubmitAction",
    commandButtonSelector:
      '[data-testid="player-action-commands"] button[data-action="submit_action:factional_kill"]',
    actionId: "factional_kill",
    actorSlot: "slot-7",
    templateId: "factional_kill",
    targetSlot: "slot-5",
    grantId: "grant-factional-kill-n04",
    setupResyncFromSeq: 916,
    setupPhaseId: "N04",
    finalState: "reject",
    error: "PhaseLocked",
    messageIncludes: "stale action state, refresh and use current action controls",
    expectedRefreshKeys: [
      "notifications",
      "investigationResults",
      "commandState",
      "dayVoteOutcomes",
    ],
    refreshedPhaseId: "D05",
    refreshedVoteTargetKind: "no_lynch",
    refreshedBoundary:
      "stale N04 action refreshed into current Day 5 controls",
    checkpointReceiptState: "reject:PhaseLocked",
    checkpointActionState: "disabled:no legal action available",
    checkpointTargetSlots: "",
  };
}

export function staleDayTwoVoteAfterTransitionRecoveryScenario() {
  return {
    clickedAction: "submit_vote",
    commandKind: "SubmitVote",
    actorSlot: "slot-7",
    targetSlot: "slot-2",
    setupResyncFromSeq: 801,
    setupPhaseId: "D02",
    finalState: "reject",
    error: "PhaseLocked",
    messageIncludes: "stale vote state, refresh and use current vote controls",
    expectedRefreshKeys: ["votecount", "commandState", "dayVoteOutcomes"],
    refreshedPhaseId: "N02",
    refreshedBoundary: "PhaseLocked recovery",
    checkpointReceiptState: "reject:PhaseLocked",
    checkpointActionState: "enabled:submit_action:factional_kill",
    checkpointTargetSlots: "slot-3",
    receiptCount: 1,
    receiptStatusTextIncludes: "stale vote state",
  };
}

export function staleNightOneActionAfterTransitionRecoveryScenario() {
  return {
    clickedAction: "submit_action:factional_kill",
    commandKind: "SubmitAction",
    actionId: "factional_kill",
    actorSlot: "slot-7",
    templateId: "factional_kill",
    targetSlot: "slot-3",
    finalState: "reject",
    error: "PhaseLocked",
    messageIncludes: "stale action state, refresh and use current action controls",
    expectedRefreshKeys: ["commandState"],
    refreshedPhaseId: "N02",
    refreshedBoundary: "PhaseLocked recovery",
    checkpointReceiptState: "reject:PhaseLocked",
    checkpointActionState: "enabled:submit_action:factional_kill",
    checkpointTargetSlots: "slot-3",
    receiptCount: 2,
    receiptStatusTextIncludes: "reject phaselocked: phase locked",
  };
}
