import {
  assertPlayerStaleActionAfterTransitionProofCase,
  assertPlayerStaleVoteAfterTransitionProofCase,
  staleNightFourActionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  assertHostStaleAdvanceAfterTransitionProofCase,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

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
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 801,
    expectedPhaseId: "D02",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  assertHostPhaseTransitionActionProof({
    proof: advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
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

export function assertDayFiveNoLynchResolutionSurfaceProof({
  dayFiveNoLynchResolutionSurface,
  assertHostPhaseTransitionActionProof,
  assertPostDayThreePlayerSurfaceProof,
  includeEvidenceInError = false,
}) {
  const expectedGame = gameFromRoleUrl(
    dayFiveNoLynchResolutionSurface?.sourceHostRoleUrl,
  );
  if (
    dayFiveNoLynchResolutionSurface?.status !== "passed" ||
    dayFiveNoLynchResolutionSurface.clickedThroughFromRoleUrl !== true ||
    dayFiveNoLynchResolutionSurface.releaseReady !== false ||
    dayFiveNoLynchResolutionSurface.productionReady !== false ||
    typeof dayFiveNoLynchResolutionSurface.sourceHostRoleUrl !== "string" ||
    !dayFiveNoLynchResolutionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "player:D05:no_lynch:ack:918",
    ) ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "host:D05:resolve_phase:ack:919",
    ) ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "host:advance_phase:ack:920",
    ) ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "actionPlayer:N05:no_action",
    ) ||
    !String(dayFiveNoLynchResolutionSurface.transition ?? "").includes(
      "stale:D05:submit_vote:reject:PhaseLocked",
    )
  ) {
    throwTransitionRecoveryAssertionError({
      message: "core-loop admin proof missing Day 5 no-lynch resolution surface",
      evidence: dayFiveNoLynchResolutionSurface,
      includeEvidenceInError,
    });
  }
  assertDayFiveNoLynchVoteProofCase({
    proof: dayFiveNoLynchResolutionSurface.dayFiveVoteProof,
    expectedGame,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl,
    includeEvidenceInError,
  });
  assertDayFiveNoLynchHostTransitionProofCase({
    proof: dayFiveNoLynchResolutionSurface.hostTransitionProof,
    expectedGame,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceHostRoleUrl,
    assertHostPhaseTransitionActionProof,
    includeEvidenceInError,
  });
  assertPostDayThreePlayerSurfaceProof({
    proof: dayFiveNoLynchResolutionSurface.actionPlayerNightFiveProof,
    expectedGame,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl,
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "N05",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "open Night 5 with no legal action",
    expectedResyncFromSeq: 920,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
    expectedLastVoteOutcomePhaseId: "D05",
  });
  assertStaleDayFiveVoteRecoveryProofCase({
    proof: dayFiveNoLynchResolutionSurface.staleDayFiveVoteRecoveryProof,
    expectedGame,
    sourceRoleUrl: dayFiveNoLynchResolutionSurface.sourceActionPlayerRoleUrl,
    includeEvidenceInError,
  });
}

export function assertDayFiveNoLynchVoteProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
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
    proof.clickedAction !== "submit_vote:no_lynch" ||
    proof.commandKind !== "SubmitVote" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== "slot-7" ||
    proof.command.target !== "NoLynch" ||
    proof.commandStatus?.state !== "ack" ||
    !proof.commandStatus?.message?.includes("Ack: stream seqs 918") ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== "SubmitVote" ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, [
      "votecount",
      "commandState",
    ]) ||
    proof.receipts?.at?.(-1)?.state !== "ack" ||
    proof.projectionCommandState?.actorSlot !== "slot-7" ||
    proof.projectionCommandState?.phase?.phaseId !== "D05" ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.currentVote?.kind !== "no_lynch" ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      "Day 5 no-lynch vote ACK",
    ) ||
    proof.projectionVotecount?.[0]?.target !== "No lynch" ||
    proof.projectionVotecount?.[0]?.count !== 1 ||
    proof.projectionVotecount?.[0]?.needed !== 1 ||
    proof.projectionDayVoteOutcomes?.at?.(-1)?.phaseId !== "D04" ||
    proof.setupResyncFromSeq !== 917 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "D05" ||
    proof.currentVote?.hasVote !== "true" ||
    !String(proof.currentVote?.text ?? "").includes("No lynch") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("ack: stream seqs 918") ||
    proof.receiptRefreshKeys !== "votecount,commandState"
  ) {
    throwTransitionRecoveryAssertionError({
      message: "core-loop admin proof missing Day 5 no-lynch vote ACK",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertDayFiveNoLynchHostTransitionProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  assertHostPhaseTransitionActionProof,
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
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 918 ||
    proof.setupSnapshotHost?.phase?.id !== "D05" ||
    proof.setupSnapshotHost?.phase?.state !== "open"
  ) {
    throwTransitionRecoveryAssertionError({
      message: "core-loop admin proof missing Day 5 no-lynch host transition",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.resolveProof,
    expectedGame,
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 919,
    expectedPhaseId: "D05",
    expectedPhaseState: "locked",
    expectedDeadlineAffordance: "unlock_thread,advance_phase",
    expectedRefreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  });
  assertHostPhaseTransitionActionProof({
    proof: proof.advanceProof,
    expectedGame,
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
    streamSeq: 920,
    expectedPhaseId: "N05",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "resolve_phase,lock_thread",
    expectedRefreshKeys: [],
  });
  if (
    proof.resolveProof?.votecountProjection?.[0]?.target !== "No lynch" ||
    proof.resolveProof?.dayVoteOutcomesProjection?.at?.(-1)?.phaseId !== "D05" ||
    proof.resolveProof?.dayVoteOutcomesProjection?.at?.(-1)?.status !==
      "NoLynch"
  ) {
    throwTransitionRecoveryAssertionError({
      message: "core-loop admin proof missing Day 5 no-lynch host projections",
      evidence: proof.resolveProof,
      includeEvidenceInError,
    });
  }
}

export function assertStaleDayFiveVoteRecoveryProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
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
    proof.clickedAction !== "submit_vote:no_lynch" ||
    proof.commandKind !== "SubmitVote" ||
    proof.setupResyncFromSeq !== 918 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "D05" ||
    proof.setupSnapshotCommandState?.voteTargets?.[0]?.kind !== "no_lynch" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== "slot-7" ||
    proof.command.target !== "NoLynch" ||
    proof.commandStatus?.state !== "reject" ||
    proof.commandStatus.error !== "PhaseLocked" ||
    !String(proof.commandStatus.message ?? "").includes(
      "stale vote state, refresh and use current vote controls",
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== "SubmitVote" ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "reject" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, [
      "votecount",
      "commandState",
      "dayVoteOutcomes",
    ]) ||
    proof.receipts?.at?.(-1)?.state !== "reject" ||
    proof.projectionCommandState?.actorSlot !== "slot-7" ||
    proof.projectionCommandState?.phase?.phaseId !== "N05" ||
    proof.projectionCommandState?.phase?.locked !== false ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    proof.projectionCommandState?.voteTargets?.length !== 0 ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      "stale D05 vote refreshed into current Night 5 controls",
    ) ||
    proof.checkpointReceiptState !== "reject:PhaseLocked" ||
    proof.checkpointPhaseIdAfterReject !== "N05" ||
    proof.checkpointActionStateAfterReject !==
      "disabled:no legal action available" ||
    proof.checkpointTargetSlotsAfterReject !== "" ||
    !String(proof.recoveryText ?? "").includes("Reject PhaseLocked") ||
    !String(proof.recoveryText ?? "").includes("refresh") ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("reject phaselocked")
  ) {
    throwTransitionRecoveryAssertionError({
      message: "core-loop admin proof missing stale Day 5 vote recovery",
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
