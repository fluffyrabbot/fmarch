import {
  playerActionSubmissionScenario,
  playerInvalidActionRecoveryScenario,
  staleDayTwoVoteAfterTransitionRecoveryScenario,
  staleNightFourActionRecoveryScenario,
  staleNightOneActionAfterTransitionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";

export {
  playerActionBoundaryLaneId,
  playerActionBoundaryRecoveryHookId,
  playerActionLoopLaneId,
  playerActionSubmissionScenario,
  playerFactionalKillActionCommandFacts,
  playerInvalidActionRecoveryMessage,
  playerInvalidActionRecoveryLaneId,
  playerInvalidActionRecoveryScenario,
  playerStaleActionTransitionRecoveryMessage,
  playerStaleActionTransitionRecoveryHookId,
  playerStaleActionTransitionRecoveryFeatureSlotId,
  playerStaleVoteTransitionRecoveryMessage,
  playerStaleVoteTransitionRecoveryHookId,
  playerStaleVoteTransitionRecoveryFeatureSlotId,
  playerSlotVoteCommandFacts,
  staleActionTransitionRecoveryFeatureSpineRow,
  staleDayTwoVoteAfterTransitionRecoveryScenario,
  staleNightFourActionRecoveryScenario,
  staleNightOneActionAfterTransitionRecoveryScenario,
  staleVoteTransitionRecoveryFeatureSpineRow,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";

export {
  assertHostVisibleInvalidActionRecoverySummary,
  assertHostVisibleStaleTransitionRecoverySummaries,
  buildHostVisibleInvalidActionRecoverySummary,
  buildHostVisibleRecoverySummaries,
  buildHostVisibleStaleTransitionRecoverySummaries,
  completedGameStaleRecoverySummaryId,
  hostVisibleRecoverySummaryCases,
  hostVisibleStaleTransitionRecoveryCases,
  privateChannelInvalidActionRecoveryLaneId,
} from "./dev_test_game_core_loop_recovery_summary_registry.mjs";

export function assertPlayerActionSubmissionClickProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  visitedRolePath,
  scenario = playerActionSubmissionScenario(),
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    (sourceRoleUrl !== undefined && proof.sourceRoleUrl !== sourceRoleUrl) ||
    (visitedRolePath !== undefined &&
      proof.visitedRolePath !== visitedRolePath) ||
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
  sourceRoleUrl,
  visitedRolePath,
  scenario = playerInvalidActionRecoveryScenario(),
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    (sourceRoleUrl !== undefined && proof.sourceRoleUrl !== sourceRoleUrl) ||
    (visitedRolePath !== undefined &&
      proof.visitedRolePath !== visitedRolePath) ||
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
  sourceRoleUrl,
  visitedRolePath,
  scenario = staleDayTwoVoteAfterTransitionRecoveryScenario(),
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    (sourceRoleUrl !== undefined && proof.sourceRoleUrl !== sourceRoleUrl) ||
    (visitedRolePath !== undefined &&
      proof.visitedRolePath !== visitedRolePath) ||
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
  sourceRoleUrl,
  visitedRolePath,
  scenario = staleNightOneActionAfterTransitionRecoveryScenario(),
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    (sourceRoleUrl !== undefined && proof.sourceRoleUrl !== sourceRoleUrl) ||
    (visitedRolePath !== undefined &&
      proof.visitedRolePath !== visitedRolePath) ||
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
