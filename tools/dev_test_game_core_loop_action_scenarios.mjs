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
