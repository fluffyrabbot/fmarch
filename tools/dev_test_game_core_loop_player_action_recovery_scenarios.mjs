import {
  assertPlayerActionSubmissionClickProofCase,
  assertPlayerInvalidActionRecoveryProofCase,
  playerActionBoundaryLaneId,
  playerActionLoopLaneId,
  playerActionSubmissionScenario,
  playerInvalidActionRecoveryLaneId,
  playerInvalidActionRecoveryScenario,
  staleDayTwoVoteAfterTransitionRecoveryScenario,
  staleNightOneActionAfterTransitionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenarios.mjs";

export {
  playerActionBoundaryLaneId,
  playerActionLoopLaneId,
  playerInvalidActionRecoveryLaneId,
  playerActionSubmissionScenario,
  playerInvalidActionRecoveryScenario,
  staleDayTwoVoteAfterTransitionRecoveryScenario,
  staleNightOneActionAfterTransitionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenarios.mjs";

export const coreLoopPlayerActionRecoveryFamilyId =
  "core-loop-player-action-recovery";

export const coreLoopPlayerActionRecoveryLaneIds = Object.freeze([
  playerActionLoopLaneId,
  playerInvalidActionRecoveryLaneId,
  playerActionBoundaryLaneId,
]);

export function coreLoopPlayerActionRecoveryScenarioFamily() {
  const actionSubmission = playerActionSubmissionScenario();
  const invalidActionRecovery = playerInvalidActionRecoveryScenario();
  const staleVoteAfterTransition =
    staleDayTwoVoteAfterTransitionRecoveryScenario();
  const staleActionAfterTransition =
    staleNightOneActionAfterTransitionRecoveryScenario();
  return {
    id: coreLoopPlayerActionRecoveryFamilyId,
    laneIds: [...coreLoopPlayerActionRecoveryLaneIds],
    surfaces: {
      actionSubmission,
    },
    recovery: {
      invalidActionRecovery,
      staleVoteAfterTransition,
      staleActionAfterTransition,
    },
  };
}

export function assertPlayerActionRoleSurfaceProof({
  playerRoleSurface,
  scenarioFamily = coreLoopPlayerActionRecoveryScenarioFamily(),
  includeEvidenceInError = false,
}) {
  const scenario = scenarioFamily.surfaces.actionSubmission;
  const checkpoint = playerRoleSurface?.playerActionSubmissionCheckpoint;
  const expectedGame = gameFromRoleUrl(playerRoleSurface?.sourceRoleUrl);
  if (
    playerRoleSurface?.status !== "passed" ||
    playerRoleSurface.clickedThroughFromRoleUrl !== true ||
    playerRoleSurface.releaseReady !== false ||
    playerRoleSurface.productionReady !== false ||
    typeof playerRoleSurface.sourceRoleUrl !== "string" ||
    !playerRoleSurface.sourceRoleUrl.includes("/g/") ||
    typeof playerRoleSurface.visitedRolePath !== "string" ||
    !playerRoleSurface.visitedRolePath.includes("/g/") ||
    playerRoleSurface.surfaceTestId !== "player-surface" ||
    playerRoleSurface.checkpointTestId !== "player-action-submission-checkpoint" ||
    checkpoint?.proofCheckId !== "player-action-submission" ||
    checkpoint.phaseId !== "N02" ||
    checkpoint.phaseState !== "open" ||
    checkpoint.actorSlot !== scenario.actorSlot ||
    checkpoint.actionState !== `enabled:${scenario.clickedAction}` ||
    checkpoint.selectedAction !== scenario.actionId ||
    checkpoint.targetSlots !== scenario.targetSlot ||
    checkpoint.receiptState !== "idle" ||
    !checkpoint.targetText?.includes(
      `${scenario.actionId} -> ${scenario.targetSlot}`,
    ) ||
    !checkpoint.recoveryText?.includes("Reject PhaseLocked") ||
    !String(checkpoint.statusText ?? "")
      .toLowerCase()
      .includes("player action submission is reachable from this role url")
  ) {
    throwPlayerActionRecoveryAssertionError({
      message: "core-loop admin proof missing player action role checkpoint",
      evidence: { playerRoleSurface, checkpoint },
      includeEvidenceInError,
    });
  }
  for (const rowId of [
    "phase",
    "actor",
    "actionState",
    "target",
    "receipt",
    "recovery",
  ]) {
    if (!checkpoint.visibleRows?.includes(rowId)) {
      throwPlayerActionRecoveryAssertionError({
        message: `player action checkpoint missing visible row: ${rowId}`,
        evidence: checkpoint,
        includeEvidenceInError,
      });
    }
  }
  assertPlayerActionSubmissionClickProofCase({
    proof: playerRoleSurface.playerActionSubmissionClickProof,
    expectedGame,
    scenario,
    includeEvidenceInError,
  });
  assertPlayerInvalidActionRecoveryProofCase({
    proof: playerRoleSurface.playerActionInvalidRecoveryProof,
    expectedGame,
    scenario: scenarioFamily.recovery.invalidActionRecovery,
    includeEvidenceInError,
  });
}

function gameFromRoleUrl(roleUrl) {
  const match = String(roleUrl ?? "").match(/\/g\/([^/?#]+)/);
  return match?.[1] ?? "";
}

function throwPlayerActionRecoveryAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
