import {
  assertPlayerStaleActionAfterTransitionProofCase,
  assertPlayerStaleVoteAfterTransitionProofCase,
  staleNightFourActionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  assertHostStaleAdvanceAfterTransitionProofCase,
  hostAdvancePhaseCommandFacts,
  hostResolvePhaseCommandFacts,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

export {
  assertDayFiveNoLynchHostTransitionProofCase,
  assertDayFiveNoLynchResolutionSurfaceProof,
  assertDayFiveNoLynchVoteProofCase,
  assertStaleDayFiveVoteRecoveryProofCase,
  coreLoopDayFiveProgressionFamilyId,
  coreLoopDayFiveProgressionLaneIds,
  coreLoopDayFiveProgressionScenarioFamily,
  dayFiveNoLynchResolutionSurfaceCase,
} from "./dev_test_game_core_loop_day_five_progression_scenarios.mjs";

export function assertHostPhaseTransitionSurfaceProof({
  hostPhaseTransitionSurface,
  assertHostPhaseTransitionActionProof,
  includeEvidenceInError = false,
}) {
  const expectedGame = gameFromRoleUrl(
    hostPhaseTransitionSurface?.sourceHostRoleUrl,
  );
  const resolveProof = hostPhaseTransitionSurface?.resolveProof;
  const advanceProof = hostPhaseTransitionSurface?.advanceProof;
  const staleHostAdvanceRecoveryProof =
    hostPhaseTransitionSurface?.staleHostAdvanceRecoveryProof;
  const playerObservationProof =
    hostPhaseTransitionSurface?.playerObservationProof;
  if (
    hostPhaseTransitionSurface?.status !== "passed" ||
    hostPhaseTransitionSurface.clickedThroughFromRoleUrl !== true ||
    hostPhaseTransitionSurface.releaseReady !== false ||
    hostPhaseTransitionSurface.productionReady !== false ||
    typeof hostPhaseTransitionSurface.sourceHostRoleUrl !== "string" ||
    !hostPhaseTransitionSurface.sourceHostRoleUrl.includes("/g/") ||
    !hostPhaseTransitionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof hostPhaseTransitionSurface.sourcePlayerRoleUrl !== "string" ||
    !hostPhaseTransitionSurface.sourcePlayerRoleUrl.includes("/g/") ||
    typeof hostPhaseTransitionSurface.visitedHostRolePath !== "string" ||
    !hostPhaseTransitionSurface.visitedHostRolePath.endsWith("/host") ||
    hostPhaseTransitionSurface.surfaceTestId !== "host-console-surface" ||
    !String(hostPhaseTransitionSurface.transition ?? "").includes(
      "resolve_phase:ack:801",
    ) ||
    !String(hostPhaseTransitionSurface.transition ?? "").includes(
      "advance_phase:ack:802",
    ) ||
    !String(hostPhaseTransitionSurface.transition ?? "").includes("player:N02")
  ) {
    throwTransitionRecoveryAssertionError({
      message: "core-loop admin proof missing host phase transition surface",
      evidence: hostPhaseTransitionSurface,
      includeEvidenceInError,
    });
  }
  assertHostPhaseTransitionActionProof({
    proof: resolveProof,
    expectedGame,
    ...hostResolvePhaseCommandFacts(),
    streamSeq: 801,
    expectedPhaseId: "D02",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  assertHostPhaseTransitionActionProof({
    proof: advanceProof,
    expectedGame,
    ...hostAdvancePhaseCommandFacts(),
    streamSeq: 802,
    expectedPhaseId: "N02",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
  });
  assertHostStaleAdvanceAfterTransitionProofCase({
    proof: staleHostAdvanceRecoveryProof,
    expectedGame,
    includeEvidenceInError,
  });
  assertPhaseTransitionPlayerObservationProof({
    playerObservationProof,
    hostPhaseTransitionSurface,
    includeEvidenceInError,
  });
  assertPlayerStaleVoteAfterTransitionProofCase({
    proof: playerObservationProof.staleVoteRecoveryProof,
    expectedGame,
    includeEvidenceInError,
  });
  assertPlayerStaleActionAfterTransitionProofCase({
    proof: playerObservationProof.staleActionRecoveryProof,
    expectedGame,
    includeEvidenceInError,
  });
}

export function assertStaleNightFourActionRecoveryProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  scenario = staleNightFourActionRecoveryScenario(),
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyReceiptVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.clickedAction !== scenario.clickedAction ||
    proof.commandKind !== scenario.commandKind ||
    proof.setupResyncFromSeq !== scenario.setupResyncFromSeq ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== scenario.setupPhaseId ||
    proof.setupSnapshotCommandState?.actions?.[0]?.targets?.[0] !==
      scenario.targetSlot ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== scenario.actorSlot ||
    proof.command.action_id !== scenario.actionId ||
    proof.command.template_id !== scenario.templateId ||
    proof.command.targets?.[0] !== scenario.targetSlot ||
    proof.command.grant_id !== scenario.grantId ||
    proof.commandStatus?.state !== scenario.finalState ||
    proof.commandStatus.error !== scenario.error ||
    !String(proof.commandStatus.message ?? "").includes(
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
    proof.projectionCommandState?.actorSlot !== scenario.actorSlot ||
    proof.projectionCommandState?.phase?.phaseId !== scenario.refreshedPhaseId ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    proof.projectionCommandState?.voteTargets?.[0]?.kind !== "no_lynch" ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      scenario.refreshedBoundary,
    ) ||
    proof.checkpointReceiptState !== scenario.checkpointReceiptState ||
    proof.checkpointPhaseIdAfterReject !== scenario.refreshedPhaseId ||
    proof.checkpointActionStateAfterReject !==
      scenario.checkpointActionState ||
    proof.checkpointTargetSlotsAfterReject !== scenario.checkpointTargetSlots ||
    !String(proof.recoveryText ?? "").includes(`Reject ${scenario.error}`) ||
    !String(proof.recoveryText ?? "").includes("refresh") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes(`reject ${scenario.error.toLowerCase()}`)
  ) {
    throwTransitionRecoveryAssertionError({
      message: "core-loop admin proof missing stale Night 4 action recovery",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

function assertPhaseTransitionPlayerObservationProof({
  playerObservationProof,
  hostPhaseTransitionSurface,
  includeEvidenceInError,
}) {
  if (
    playerObservationProof?.status !== "passed" ||
    playerObservationProof.releaseReady !== false ||
    playerObservationProof.productionReady !== false ||
    playerObservationProof.sourceRoleUrl !==
      hostPhaseTransitionSurface.sourcePlayerRoleUrl ||
    !playerObservationProof.visitedRolePath?.includes("/g/") ||
    playerObservationProof.surfaceTestId !== "player-surface" ||
    playerObservationProof.resyncFromSeq !== 802 ||
    !playerObservationProof.resyncKeys?.includes("commandState") ||
    playerObservationProof.resyncSnapshotCommandState?.phase?.phaseId !== "N02" ||
    playerObservationProof.projectionCommandState?.phase?.phaseId !== "N02" ||
    !String(playerObservationProof.projectionCommandState?.boundary ?? "").includes(
      "AdvancePhase",
    ) ||
    playerObservationProof.checkpointPhaseId !== "N02" ||
    playerObservationProof.checkpointPhaseState !== "open" ||
    playerObservationProof.checkpointActionState !==
      "enabled:submit_action:factional_kill" ||
    playerObservationProof.checkpointTargetSlots !== "slot-3" ||
    playerObservationProof.checkpointReceiptState !== "reject:PhaseLocked"
  ) {
    throwTransitionRecoveryAssertionError({
      message: "core-loop admin proof missing player phase transition observation",
      evidence: playerObservationProof,
      includeEvidenceInError,
    });
  }
}

function throwTransitionRecoveryAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}

function gameFromRoleUrl(roleUrl) {
  const match = String(roleUrl ?? "").match(/\/g\/([^/?#]+)/);
  return match?.[1] ?? "";
}

function sameStringArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}
