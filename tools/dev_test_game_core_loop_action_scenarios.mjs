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
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedAction !== "submit_vote" ||
    proof.commandKind !== "SubmitVote" ||
    proof.setupResyncFromSeq !== 801 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "D02" ||
    proof.setupSnapshotCommandState?.voteTargets?.[0]?.slotId !== "slot-2" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== "slot-7" ||
    proof.command.target?.Slot !== "slot-2" ||
    proof.commandStatus?.state !== "reject" ||
    proof.commandStatus.error !== "PhaseLocked" ||
    !String(proof.commandStatus.message ?? "").includes(
      "stale vote state, refresh and use current vote controls",
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== "SubmitVote" ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "reject" ||
    !proof.bridgePlan.projectionRefreshKeys?.includes("votecount") ||
    !proof.bridgePlan.projectionRefreshKeys?.includes("commandState") ||
    !proof.bridgePlan.projectionRefreshKeys?.includes("dayVoteOutcomes") ||
    proof.receipts?.at?.(-1)?.state !== "reject" ||
    proof.projectionCommandState?.phase?.phaseId !== "N02" ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      "PhaseLocked recovery",
    ) ||
    proof.checkpointReceiptState !== "reject:PhaseLocked" ||
    proof.checkpointPhaseIdAfterReject !== "N02" ||
    proof.checkpointActionStateAfterReject !==
      "enabled:submit_action:factional_kill" ||
    proof.checkpointTargetSlotsAfterReject !== "slot-3" ||
    !String(proof.recoveryText ?? "").includes("Reject PhaseLocked") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("stale vote state")
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
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedAction !== "submit_action:factional_kill" ||
    proof.commandKind !== "SubmitAction" ||
    proof.command?.game !== expectedGame ||
    proof.command.action_id !== "factional_kill" ||
    proof.command.actor_slot !== "slot-7" ||
    proof.command.template_id !== "factional_kill" ||
    proof.command.targets?.[0] !== "slot-3" ||
    proof.commandStatus?.state !== "reject" ||
    proof.commandStatus.error !== "PhaseLocked" ||
    !String(proof.commandStatus.message ?? "").includes(
      "stale action state, refresh and use current action controls",
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== "SubmitAction" ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "reject" ||
    !proof.bridgePlan.projectionRefreshKeys?.includes("commandState") ||
    proof.receipts?.at?.(-1)?.state !== "reject" ||
    proof.projectionCommandState?.phase?.phaseId !== "N02" ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      "PhaseLocked recovery",
    ) ||
    proof.checkpointReceiptState !== "reject:PhaseLocked" ||
    proof.checkpointPhaseIdAfterReject !== "N02" ||
    proof.checkpointActionStateAfterReject !==
      "enabled:submit_action:factional_kill" ||
    proof.checkpointTargetSlotsAfterReject !== "slot-3" ||
    !String(proof.recoveryText ?? "").includes("Reject PhaseLocked") ||
    proof.receiptCount !== 2 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("reject phaselocked: phase locked")
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
