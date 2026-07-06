import {
  assertCompletedGameEndgameSurfaceAssertionCases,
  assertCompletedGameEndgameTransition,
  completedActionPlayerSurfaceProofArgs,
  completedDeadPlayerStaleVoteCase,
  completedGameEndgameScenarioCaseFamilies,
  completedGameEndgameSurfaceAssertionCases,
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";
import {
  hostCompleteGameCommandFacts,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

export {
  assertCompletedGameEndgameSurfaceAssertionCases,
  assertCompletedGameEndgameTransition,
  assertCompletedPlayerReloadCases,
  assertCompletedStaleRejectCases,
  completedActionPlayerSurfaceAssertionCase,
  completedActionPlayerSurfaceProofArgs,
  completedDeadPlayerStaleVoteAssertionCase,
  completedDeadPlayerStaleVoteCase,
  completedDeadPlayerStaleVoteCaseDefinition,
  completedDeadPlayerStaleVoteProofArgs,
  completedGameEndgameScenarioCaseFamilies,
  completedGameEndgameScenarioCaseFamilyDefinitions,
  completedGameEndgameScenarioCaseFamilyEntries,
  completedGameEndgameScenarioCaseFamilyIds,
  completedGameHardeningLaneCaseDefinitions,
  completedGameHardeningLaneCase,
  completedGameHardeningLaneCases,
  completedGameHardeningLaneIdsFor,
  completedGameHardeningLaneIds,
  completedGameHardeningSpineTargetCases,
  completedGameRaceCoverageCellCases,
  completedGameRaceCoverageCellDefinitions,
  completedGameRaceCoverageCellIds,
  completedGameRaceCoverageCellIdsForPromotedGroup,
  completedGameEndgameStaleRejectAssertionCases,
  completedGameEndgameSurfaceAssertionCases,
  completedGameEndgameTransition,
  completedGameEndgameTransitionTokens,
  completedGameSeedDemoOnlyScenarioIds,
  completedGameSeedRequiredScenarioIds,
  completedHostRaceHardeningLaneIds,
  completedHostSeedDemoOnlyScenarioIds,
  completedHostStaleCommandAssertionCases,
  completedHostStaleCommandCaseDefinitions,
  completedHostStaleCommandCases,
  completedHostStaleCommandHardeningLaneIds,
  completedHostStaleCommandSeedRecoveryLaneIds,
  completedHostStaleCommandProofArgs,
  completedPlayerReloadAssertionCases,
  completedPlayerReloadCaseDefinitions,
  completedPlayerReloadCases,
  completedPlayerReloadCommandState,
  completedPlayerReloadProofCases,
  completedPlayerHardeningReloadLaneIds,
  completedPlayerRecoveryLaneIds,
  completedPlayerSeedDemoOnlyScenarioIds,
  completedPlayerSeedRequiredScenarioIds,
  staleCompletedGamePlayerCommandAssertionCases,
  staleCompletedGamePlayerCommandCaseDefinitions,
  staleCompletedGamePlayerCommandCases,
  staleCompletedGamePlayerCommandProofArgs,
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";

export function assertCompletedGameEndgameSurfaceProof({
  completedGameEndgameSurface,
  assertHostPhaseTransitionActionProof,
  assertPostDayThreePlayerSurfaceProof,
  scenarioFamilies = completedGameEndgameScenarioCaseFamilies(),
  includeEvidenceInError = false,
}) {
  const expectedGame = gameFromCompletedRoleUrl(
    completedGameEndgameSurface?.sourceHostRoleUrl,
  );
  if (
    completedGameEndgameSurface?.status !== "passed" ||
    completedGameEndgameSurface.clickedThroughFromRoleUrl !== true ||
    completedGameEndgameSurface.releaseReady !== false ||
    completedGameEndgameSurface.productionReady !== false ||
    typeof completedGameEndgameSurface.sourceHostRoleUrl !== "string" ||
    !completedGameEndgameSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof completedGameEndgameSurface.sourceActionPlayerRoleUrl !== "string" ||
    !completedGameEndgameSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    typeof completedGameEndgameSurface.sourceNormalPlayerRoleUrl !== "string" ||
    !completedGameEndgameSurface.sourceNormalPlayerRoleUrl.includes("/g/") ||
    typeof completedGameEndgameSurface.sourceDeadPlayerRoleUrl !== "string" ||
    !completedGameEndgameSurface.sourceDeadPlayerRoleUrl.includes("/g/")
  ) {
    throwCompletedScenarioAssertionError({
      message: "core-loop admin proof missing completed-game endgame surface",
      evidence: completedGameEndgameSurface,
      includeEvidenceInError,
    });
  }
  assertCompletedGameEndgameTransition({
    transition: completedGameEndgameSurface.transition,
    scenarioFamilies,
    failureMessage:
      "core-loop admin proof missing completed-game endgame transition",
  });
  assertCompletedGameEndgameSurfaceAssertionCases({
    completedGameEndgameSurface,
    includeEvidenceInError,
    cases: completedGameEndgameSurfaceAssertionCases({
      completedGameEndgameSurface,
      expectedGame,
      assertHostCompleteGameProof: (scenario) =>
        assertHostCompleteGameProofCase({
          ...scenario,
          assertHostPhaseTransitionActionProof,
          includeEvidenceInError,
        }),
      assertCompletedHostReloadProof: (scenario) =>
        assertCompletedHostReloadProofCase({
          ...scenario,
          includeEvidenceInError,
        }),
      assertActionPlayerCompletedProof: (scenario) =>
        assertCompletedActionPlayerSurfaceProofCase({
          ...scenario,
          assertPostDayThreePlayerSurfaceProof,
        }),
      assertCompletedHostStaleCommandRecoveryProof: (scenario) =>
        assertCompletedHostStaleCommandRecoveryProofCase({
          ...scenario,
          includeEvidenceInError,
        }),
      assertCompletedDeadPlayerStaleVoteRecoveryProof: (scenario) =>
        assertCompletedDeadPlayerStaleVoteRecoveryProofCase({
          ...scenario,
          includeEvidenceInError,
        }),
      assertCompletedPlayerReloadProof: (scenario) =>
        assertCompletedPlayerReloadProofCase({
          ...scenario,
          includeEvidenceInError,
        }),
      assertStaleCompletedGamePlayerCommandRecoveryProof: (scenario) =>
        assertStaleCompletedGamePlayerCommandRecoveryProofCase({
          ...scenario,
          includeEvidenceInError,
        }),
      scenarioFamilies,
    }),
  });
}

export function assertHostCompleteGameProofCase({
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
    proof.setupResyncFromSeq !== 920 ||
    proof.setupSnapshotHost?.phase?.id !== "N05" ||
    proof.setupSnapshotHost?.phase?.state !== "open" ||
    proof.setupSnapshotHost?.completed !== false
  ) {
    throwCompletedScenarioAssertionError({
      message: "core-loop admin proof missing host complete-game setup",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  assertHostPhaseTransitionActionProof({
    proof: proof.completeProof,
    expectedGame,
    ...hostCompleteGameCommandFacts(),
    sourceRoleUrl,
    streamSeq: 921,
    expectedPhaseId: "N05",
    expectedPhaseState: "open",
    expectedDeadlineAffordance: "none",
    expectedRefreshKeys: [],
  });
  if (
    proof.completeProof?.projection?.completed !== true ||
    proof.completeProof?.projection?.slots?.[0]?.role_revealed !== true ||
    proof.completeProof?.projection?.slots?.[0]?.alignment_revealed !== true
  ) {
    throwCompletedScenarioAssertionError({
      message: "core-loop admin proof missing completed host projection",
      evidence: proof.completeProof,
      includeEvidenceInError,
    });
  }
}

export function assertCompletedHostReloadProofCase({
  proof,
  sourceRoleUrl,
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
    proof.resyncFromSeq !== 921 ||
    proof.initialResyncSnapshotHost?.completed !== true ||
    proof.reloadedResyncSnapshotHost?.completed !== true
  ) {
    throwCompletedScenarioAssertionError({
      message: "core-loop admin proof missing completed host reload shell",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  for (const [label, snapshot] of [
    ["initial", proof.initialSnapshot],
    ["reloaded", proof.reloadedSnapshot],
  ]) {
    if (
      snapshot?.checkpoint?.phaseId !== "N05" ||
      snapshot.checkpoint.phaseState !== "open" ||
      snapshot.checkpoint.deadlineAffordance !== "none" ||
      !String(snapshot.checkpoint.actionState ?? "").startsWith("disabled:") ||
      snapshot.projection?.completed !== true ||
      snapshot.projection?.phase?.id !== "N05" ||
      snapshot.projection?.phase?.state !== "open" ||
      snapshot.projection?.slots?.[0]?.role_revealed !== true ||
      snapshot.projection?.slots?.[0]?.alignment_revealed !== true ||
      snapshot.projection?.slots?.[1]?.role_revealed !== true ||
      snapshot.projection?.slots?.[1]?.alignment_revealed !== true ||
      snapshot.dayVoteOutcomes?.at?.(-1)?.phaseId !== "D05" ||
      snapshot.hostPrompts?.length !== 0 ||
      snapshot.actionTiles?.length !== 0 ||
      snapshot.triggerButtons?.length !== 0
    ) {
      throwCompletedScenarioAssertionError({
        message: `core-loop admin proof missing ${label} completed host reload closure`,
        evidence: snapshot,
        includeEvidenceInError,
      });
    }
  }
}

export function assertCompletedActionPlayerSurfaceProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  assertPostDayThreePlayerSurfaceProof,
}) {
  assertPostDayThreePlayerSurfaceProof({
    proof,
    ...completedActionPlayerSurfaceProofArgs({
      expectedGame,
      sourceRoleUrl,
    }),
  });
}

export function assertCompletedHostStaleCommandRecoveryProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  expectedCommandKind,
  includeEvidenceInError = false,
}) {
  const snapshot = proof?.recoverySnapshot;
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
    proof.commandEndpoint !== "/commands" ||
    proof.commandKind !== expectedCommandKind ||
    proof.command?.game !== expectedGame ||
    proof.commandResponse?.ok !== false ||
    proof.commandResponse?.status !== 409 ||
    proof.commandResponse?.body?.body?.kind !== "Reject" ||
    proof.commandResponse?.body?.body?.body?.error !==
      "GameAlreadyCompleted" ||
    !String(proof.commandResponse?.body?.body?.body?.message ?? "").includes(
      "Reject GameAlreadyCompleted: game already completed",
    ) ||
    proof.setupResyncFromSeq !== 921 ||
    proof.setupResyncSnapshotHost?.completed !== true ||
    proof.setupResyncSnapshotHost?.phase?.id !== "N05" ||
    proof.recoveryResyncFromSeq !== 921 ||
    proof.recoveryResyncSnapshotHost?.completed !== true ||
    proof.recoveryResyncSnapshotHost?.phase?.id !== "N05" ||
    snapshot?.checkpoint?.phaseId !== "N05" ||
    snapshot.checkpoint.phaseState !== "open" ||
    snapshot.checkpoint.deadlineAffordance !== "none" ||
    !String(snapshot.checkpoint.actionState ?? "").startsWith("disabled:") ||
    snapshot.projection?.completed !== true ||
    snapshot.projection?.phase?.id !== "N05" ||
    snapshot.projection?.phase?.state !== "open" ||
    snapshot.projection?.slots?.[0]?.role_revealed !== true ||
    snapshot.projection?.slots?.[0]?.alignment_revealed !== true ||
    snapshot.projection?.slots?.[1]?.role_revealed !== true ||
    snapshot.projection?.slots?.[1]?.alignment_revealed !== true ||
    snapshot.dayVoteOutcomes?.at?.(-1)?.phaseId !== "D05" ||
    snapshot.hostPrompts?.length !== 0 ||
    snapshot.actionTiles?.length !== 0 ||
    snapshot.triggerButtons?.length !== 0
  ) {
    throwCompletedScenarioAssertionError({
      message: `core-loop admin proof missing completed host stale ${expectedCommandKind} recovery`,
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertCompletedPlayerReloadProofCase({
  proof,
  sourceRoleUrl,
  expectedSlot,
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
    proof.targetOnlyActionVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.resyncFromSeq !== 921 ||
    proof.initialResyncSnapshotCommandState?.gameCompleted !== true ||
    proof.reloadedResyncSnapshotCommandState?.gameCompleted !== true
  ) {
    throwCompletedScenarioAssertionError({
      message: "core-loop admin proof missing completed player reload shell",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  for (const [label, snapshot] of [
    ["initial", proof.initialSnapshot],
    ["reloaded", proof.reloadedSnapshot],
  ]) {
    if (
      snapshot?.checkpoint?.phaseId !== "N05" ||
      snapshot.checkpoint.phaseState !== "open" ||
      snapshot.checkpoint.actorSlot !== expectedSlot ||
      snapshot.checkpoint.actionState !== "disabled:game complete" ||
      snapshot.checkpoint.receiptState !== "idle" ||
      snapshot.commandState?.actorSlot !== expectedSlot ||
      snapshot.commandState?.phase?.phaseId !== "N05" ||
      snapshot.commandState?.gameCompleted !== true ||
      snapshot.commandState?.actions?.length !== 0 ||
      snapshot.commandState?.voteTargets?.length !== 0 ||
      !String(snapshot.commandState?.boundary ?? "").includes(
        expectedBoundaryText,
      ) ||
      snapshot.dayVoteOutcomes?.at?.(-1)?.phaseId !== "D05" ||
      snapshot.coldLoadEndpoints?.commandStateEndpoint !==
        expectedCommandStateEndpoint ||
      snapshot.coldLoadEndpoints?.notificationsEndpoint !==
        expectedNotificationsEndpoint ||
      snapshot.enabledMutatingButtons?.length !== 0 ||
      !snapshot.disabledMutatingButtons?.some(
        (button) => button.action === "submit_post" && button.disabled === true,
      )
    ) {
      throwCompletedScenarioAssertionError({
        message: `core-loop admin proof missing ${label} completed player reload closure`,
        evidence: snapshot,
        includeEvidenceInError,
      });
    }
  }
}

export function assertCompletedDeadPlayerStaleVoteRecoveryProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  scenario = completedDeadPlayerStaleVoteCase(),
  includeEvidenceInError = false,
}) {
  const snapshot = proof?.recoverySnapshot;
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyActionVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.commandEndpoint !== "/commands" ||
    proof.commandKind !== scenario.commandKind ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== scenario.expectedSlot ||
    proof.command.target !== "NoLynch" ||
    proof.commandResponse?.ok !== false ||
    proof.commandResponse?.status !== 409 ||
    proof.commandResponse?.body?.body?.kind !== "Reject" ||
    proof.commandResponse?.body?.body?.body?.error !==
      "GameAlreadyCompleted" ||
    !String(proof.commandResponse?.body?.body?.body?.message ?? "").includes(
      "Reject GameAlreadyCompleted: game already completed",
    ) ||
    proof.setupResyncFromSeq !== 921 ||
    proof.setupResyncSnapshotCommandState?.actorSlot !==
      scenario.expectedSlot ||
    proof.setupResyncSnapshotCommandState?.gameCompleted !== true ||
    proof.recoveryResyncFromSeq !== 921 ||
    proof.recoveryResyncSnapshotCommandState?.actorSlot !==
      scenario.expectedSlot ||
    proof.recoveryResyncSnapshotCommandState?.gameCompleted !== true ||
    snapshot?.checkpoint?.phaseId !== "N05" ||
    snapshot.checkpoint.phaseState !== "open" ||
    snapshot.checkpoint.actorSlot !== scenario.expectedSlot ||
    snapshot.checkpoint.actionState !== "disabled:game complete" ||
    snapshot.checkpoint.receiptState !== "idle" ||
    snapshot.commandState?.actorSlot !== scenario.expectedSlot ||
    snapshot.commandState?.actorAlive !== false ||
    snapshot.commandState?.actorStatus !== "dead" ||
    snapshot.commandState?.phase?.phaseId !== "N05" ||
    snapshot.commandState?.gameCompleted !== true ||
    snapshot.commandState?.actions?.length !== 0 ||
    snapshot.commandState?.voteTargets?.length !== 0 ||
    !String(snapshot.commandState?.boundary ?? "").includes(
      scenario.expectedBoundaryText,
    ) ||
    snapshot.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=${scenario.principalUserId}&slot_id=${scenario.expectedSlot}` ||
    snapshot.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=${scenario.principalUserId}` ||
    snapshot.enabledMutatingButtons?.length !== 0
  ) {
    throwCompletedScenarioAssertionError({
      message:
        "core-loop admin proof missing completed dead-player stale vote recovery",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertStaleCompletedGamePlayerCommandRecoveryProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  scenario,
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
    proof.setupResyncFromSeq !== 918 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "D05" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== "slot-7" ||
    proof.commandStatus?.state !== "reject" ||
    proof.commandStatus.error !== "GameAlreadyCompleted" ||
    !String(proof.commandStatus.message ?? "").includes(
      "Reject GameAlreadyCompleted: game already completed",
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
    proof.projectionCommandState?.actorSlot !== "slot-7" ||
    proof.projectionCommandState?.phase?.phaseId !== "N05" ||
    proof.projectionCommandState?.gameCompleted !== true ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    proof.projectionCommandState?.voteTargets?.length !== 0 ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      scenario.rejectedBoundary,
    ) ||
    proof.checkpointReceiptState !== "reject:GameAlreadyCompleted" ||
    proof.checkpointPhaseIdAfterReject !== "N05" ||
    proof.checkpointActionStateAfterReject !== "disabled:game complete" ||
    proof.checkpointTargetSlotsAfterReject !== "" ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("reject gamealreadycompleted")
  ) {
    throwCompletedScenarioAssertionError({
      message: `core-loop admin proof missing stale completed-game ${scenario.commandKind} recovery`,
      evidence: proof,
      includeEvidenceInError,
    });
  }
  if (scenario.commandKind === "SubmitVote") {
    if (
      proof.setupSnapshotCommandState?.voteTargets?.[0]?.kind !== "no_lynch" ||
      proof.command.target !== "NoLynch"
    ) {
      throwCompletedScenarioAssertionError({
        message: "core-loop admin proof missing stale completed-game vote command",
        evidence: proof,
        includeEvidenceInError,
      });
    }
  }
  if (scenario.commandKind === "SubmitPost") {
    if (
      proof.command.channel_id !== "main" ||
      proof.command.body !== scenario.postBody ||
      proof.stalePostBody !== scenario.postBody
    ) {
      throwCompletedScenarioAssertionError({
        message: "core-loop admin proof missing stale completed-game post command",
        evidence: proof,
        includeEvidenceInError,
      });
    }
  }
}

function throwCompletedScenarioAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}

function gameFromCompletedRoleUrl(roleUrl) {
  try {
    return new URL(roleUrl).pathname.split("/")[2] ?? "";
  } catch {
    return "";
  }
}

function sameStringArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}
