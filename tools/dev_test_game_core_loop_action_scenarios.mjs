export const playerActionLoopLaneId = "action-loop";
export const playerInvalidActionRecoveryLaneId = "invalid-action-recovery";
export const playerActionBoundaryLaneId = "player-action-boundary";

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

export function assertPlayerActionSubmissionClickProofCase({
  proof,
  expectedGame,
  scenario = playerActionSubmissionScenario(),
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedAction !== scenario.clickedAction ||
    proof.commandKind !== scenario.commandKind ||
    proof.command?.game !== expectedGame ||
    proof.command.action_id !== scenario.actionId ||
    proof.command.actor_slot !== scenario.actorSlot ||
    proof.command.template_id !== scenario.templateId ||
    proof.command.targets?.[0] !== scenario.targetSlot ||
    proof.command.grant_id !== scenario.grantId ||
    proof.commandStatus?.state !== scenario.finalState ||
    !String(proof.commandStatus?.message ?? "").includes(
      `Ack: stream seqs ${scenario.streamSeq}`,
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== scenario.commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== scenario.finalState ||
    !sameStringArray(
      proof.bridgePlan.projectionRefreshKeys,
      scenario.expectedRefreshKeys,
    ) ||
    proof.receipts?.at?.(-1)?.state !== scenario.finalState ||
    proof.projectionCommandState?.phase?.phaseId !== scenario.refreshedPhaseId ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    !String(proof.checkpointReceiptState ?? "").startsWith("ack:") ||
    proof.checkpointActionStateAfterAck !== scenario.checkpointActionState ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(`ack: stream seqs ${scenario.streamSeq}`)
  ) {
    throwActionScenarioAssertionError({
      message: "core-loop admin proof missing player action click ACK",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertPlayerInvalidActionRecoveryProofCase({
  proof,
  expectedGame,
  scenario = playerInvalidActionRecoveryScenario(),
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedAction !== scenario.clickedAction ||
    proof.commandKind !== scenario.commandKind ||
    proof.command?.game !== expectedGame ||
    proof.command.action_id !== scenario.actionId ||
    proof.command.actor_slot !== scenario.actorSlot ||
    proof.command.template_id !== scenario.templateId ||
    proof.command.targets?.[0] !== scenario.targetSlot ||
    proof.command.grant_id !== scenario.grantId ||
    proof.commandStatus?.state !== scenario.finalState ||
    proof.commandStatus.error !== scenario.error ||
    !String(proof.commandStatus?.message ?? "").includes(
      scenario.messageIncludes,
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== scenario.commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== scenario.finalState ||
    !sameStringArray(
      proof.bridgePlan.projectionRefreshKeys,
      scenario.expectedRefreshKeys,
    ) ||
    proof.receipts?.at?.(-1)?.state !== scenario.finalState ||
    proof.projectionCommandState?.phase?.phaseId !== scenario.refreshedPhaseId ||
    proof.projectionCommandState?.actions?.[0]?.templateId !==
      scenario.refreshedActionTemplateId ||
    proof.checkpointReceiptState !== scenario.checkpointReceiptState ||
    proof.checkpointActionStateAfterReject !== scenario.checkpointActionState ||
    proof.checkpointTargetSlotsAfterReject !== scenario.checkpointTargetSlots ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(scenario.messageIncludes.toLowerCase())
  ) {
    throwActionScenarioAssertionError({
      message: "core-loop admin proof missing player invalid-action recovery",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertPlayerStaleVoteAfterTransitionProofCase({
  proof,
  expectedGame,
  scenario = staleDayTwoVoteAfterTransitionRecoveryScenario(),
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedAction !== scenario.clickedAction ||
    proof.commandKind !== scenario.commandKind ||
    proof.setupResyncFromSeq !== scenario.setupResyncFromSeq ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== scenario.setupPhaseId ||
    proof.setupSnapshotCommandState?.voteTargets?.[0]?.slotId !==
      scenario.targetSlot ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== scenario.actorSlot ||
    proof.command.target?.Slot !== scenario.targetSlot ||
    proof.commandStatus?.state !== scenario.finalState ||
    proof.commandStatus.error !== scenario.error ||
    !String(proof.commandStatus.message ?? "").includes(scenario.messageIncludes) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== scenario.commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== scenario.finalState ||
    !scenario.expectedRefreshKeys.every((key) =>
      proof.bridgePlan.projectionRefreshKeys?.includes(key),
    ) ||
    proof.receipts?.at?.(-1)?.state !== scenario.finalState ||
    proof.projectionCommandState?.phase?.phaseId !== scenario.refreshedPhaseId ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      scenario.refreshedBoundary,
    ) ||
    proof.checkpointReceiptState !== scenario.checkpointReceiptState ||
    proof.checkpointPhaseIdAfterReject !== scenario.refreshedPhaseId ||
    proof.checkpointActionStateAfterReject !== scenario.checkpointActionState ||
    proof.checkpointTargetSlotsAfterReject !== scenario.checkpointTargetSlots ||
    !String(proof.recoveryText ?? "").includes("Reject PhaseLocked") ||
    proof.receiptCount !== scenario.receiptCount ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(scenario.receiptStatusTextIncludes)
  ) {
    throwActionScenarioAssertionError({
      message:
        "core-loop admin proof missing stale player vote recovery after transition",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertPlayerStaleActionAfterTransitionProofCase({
  proof,
  expectedGame,
  scenario = staleNightOneActionAfterTransitionRecoveryScenario(),
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedAction !== scenario.clickedAction ||
    proof.commandKind !== scenario.commandKind ||
    proof.command?.game !== expectedGame ||
    proof.command.action_id !== scenario.actionId ||
    proof.command.actor_slot !== scenario.actorSlot ||
    proof.command.template_id !== scenario.templateId ||
    proof.command.targets?.[0] !== scenario.targetSlot ||
    proof.commandStatus?.state !== scenario.finalState ||
    proof.commandStatus.error !== scenario.error ||
    !String(proof.commandStatus.message ?? "").includes(scenario.messageIncludes) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== scenario.commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== scenario.finalState ||
    !scenario.expectedRefreshKeys.every((key) =>
      proof.bridgePlan.projectionRefreshKeys?.includes(key),
    ) ||
    proof.receipts?.at?.(-1)?.state !== scenario.finalState ||
    proof.projectionCommandState?.phase?.phaseId !== scenario.refreshedPhaseId ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      scenario.refreshedBoundary,
    ) ||
    proof.checkpointReceiptState !== scenario.checkpointReceiptState ||
    proof.checkpointPhaseIdAfterReject !== scenario.refreshedPhaseId ||
    proof.checkpointActionStateAfterReject !== scenario.checkpointActionState ||
    proof.checkpointTargetSlotsAfterReject !== scenario.checkpointTargetSlots ||
    !String(proof.recoveryText ?? "").includes("Reject PhaseLocked") ||
    proof.receiptCount !== scenario.receiptCount ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(scenario.receiptStatusTextIncludes)
  ) {
    throwActionScenarioAssertionError({
      message:
        "core-loop admin proof missing stale player action recovery after transition",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

function throwActionScenarioAssertionError({
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
