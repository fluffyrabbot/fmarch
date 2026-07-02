import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertPlayerActionRoleSurfaceProof,
  coreLoopPlayerActionRecoveryFamilyId,
  coreLoopPlayerActionRecoveryLaneIds,
  coreLoopPlayerActionRecoveryScenarioFamily,
  playerActionBoundaryLaneId,
  playerActionLoopLaneId,
  playerActionSubmissionScenario,
  playerInvalidActionRecoveryLaneId,
  playerInvalidActionRecoveryScenario,
  staleDayTwoVoteAfterTransitionRecoveryScenario,
  staleNightOneActionAfterTransitionRecoveryScenario,
} from "./dev_test_game_core_loop_player_action_recovery_scenarios.mjs";

test("player-action recovery family shares submission and recovery cases", () => {
  assert.equal(
    coreLoopPlayerActionRecoveryFamilyId,
    "core-loop-player-action-recovery",
  );
  assert.deepEqual(coreLoopPlayerActionRecoveryLaneIds, [
    playerActionLoopLaneId,
    playerInvalidActionRecoveryLaneId,
    playerActionBoundaryLaneId,
  ]);

  const family = coreLoopPlayerActionRecoveryScenarioFamily();
  assert.equal(family.id, coreLoopPlayerActionRecoveryFamilyId);
  assert.deepEqual(family.laneIds, coreLoopPlayerActionRecoveryLaneIds);
  assert.deepEqual(
    family.surfaces.actionSubmission,
    playerActionSubmissionScenario(),
  );
  assert.deepEqual(
    family.recovery.invalidActionRecovery,
    playerInvalidActionRecoveryScenario(),
  );
  assert.deepEqual(
    family.recovery.staleVoteAfterTransition,
    staleDayTwoVoteAfterTransitionRecoveryScenario(),
  );
  assert.deepEqual(
    family.recovery.staleActionAfterTransition,
    staleNightOneActionAfterTransitionRecoveryScenario(),
  );
});

test("player-action recovery family imports case-only scenario definitions", async () => {
  const source = await readFile(
    "tools/dev_test_game_core_loop_player_action_recovery_scenarios.mjs",
    "utf8",
  );
  assert(
    source.includes("./dev_test_game_core_loop_action_scenario_cases.mjs"),
    "player-action recovery family should derive raw scenarios from the case-only module",
  );
  assert(
    source.includes("./dev_test_game_core_loop_action_scenarios.mjs"),
    "player-action recovery family should keep importing assertion helpers",
  );
});

test("player-action role surface assertion uses the shared family cases", () => {
  const family = coreLoopPlayerActionRecoveryScenarioFamily();

  assert.doesNotThrow(() =>
    assertPlayerActionRoleSurfaceProof({
      playerRoleSurface: playerRoleSurfaceFixture(),
      scenarioFamily: family,
    }),
  );
  assert.throws(
    () =>
      assertPlayerActionRoleSurfaceProof({
        playerRoleSurface: {
          ...playerRoleSurfaceFixture(),
          playerActionSubmissionCheckpoint: {
            ...playerRoleSurfaceFixture().playerActionSubmissionCheckpoint,
            targetSlots: "slot-2",
          },
        },
        scenarioFamily: family,
      }),
    /player action role checkpoint/,
  );
});

function playerRoleSurfaceFixture() {
  const game = "game-a";
  const sourceRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  return {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath: `/g/${game}`,
    surfaceTestId: "player-surface",
    checkpointTestId: "player-action-submission-checkpoint",
    clickedThroughFromRoleUrl: true,
    playerActionSubmissionCheckpoint: {
      proofCheckId: "player-action-submission",
      phaseId: "N02",
      phaseState: "open",
      actorSlot: "slot-7",
      actionState: "enabled:submit_action:factional_kill",
      selectedAction: "factional_kill",
      targetSlots: "slot-3",
      receiptState: "idle",
      visibleRows: [
        "phase",
        "actor",
        "actionState",
        "target",
        "receipt",
        "recovery",
      ],
      targetText: "Selected target\nfactional_kill -> slot-3",
      recoveryText: "Reject PhaseLocked: refresh command state",
      statusText: "Player action submission is reachable from this role URL",
    },
    playerActionSubmissionClickProof: playerActionSubmissionProof({ game }),
    playerActionInvalidRecoveryProof: playerInvalidActionProof({ game }),
    releaseReady: false,
    productionReady: false,
  };
}

function playerActionSubmissionProof({ game }) {
  const scenario = playerActionSubmissionScenario();
  return {
    status: "passed",
    clickedAction: scenario.clickedAction,
    commandKind: scenario.commandKind,
    command: {
      game,
      action_id: scenario.actionId,
      actor_slot: scenario.actorSlot,
      template_id: scenario.templateId,
      targets: [scenario.targetSlot],
      grant_id: scenario.grantId,
    },
    commandStatus: {
      state: scenario.finalState,
      message: `Ack: stream seqs ${scenario.streamSeq}`,
    },
    bridgePlan: {
      role: "player",
      commandKind: scenario.commandKind,
      commandEndpoint: "/commands",
      finalState: scenario.finalState,
      projectionRefreshKeys: scenario.expectedRefreshKeys,
    },
    receipts: [{ state: scenario.finalState }],
    projectionCommandState: {
      phase: { phaseId: scenario.refreshedPhaseId },
      actions: [],
    },
    checkpointReceiptState: `ack:${scenario.streamSeq}`,
    checkpointActionStateAfterAck: scenario.checkpointActionState,
    receiptCount: 1,
    receiptStatusText: `Ack: stream seqs ${scenario.streamSeq}`,
  };
}

function playerInvalidActionProof({ game }) {
  const scenario = playerInvalidActionRecoveryScenario();
  return {
    status: "passed",
    clickedAction: scenario.clickedAction,
    commandKind: scenario.commandKind,
    command: {
      game,
      action_id: scenario.actionId,
      actor_slot: scenario.actorSlot,
      template_id: scenario.templateId,
      targets: [scenario.targetSlot],
      grant_id: scenario.grantId,
    },
    commandStatus: {
      state: scenario.finalState,
      error: scenario.error,
      message: scenario.messageIncludes,
    },
    bridgePlan: {
      role: "player",
      commandKind: scenario.commandKind,
      commandEndpoint: "/commands",
      finalState: scenario.finalState,
      projectionRefreshKeys: scenario.expectedRefreshKeys,
    },
    receipts: [{ state: scenario.finalState }],
    projectionCommandState: {
      phase: { phaseId: scenario.refreshedPhaseId },
      actions: [{ templateId: scenario.refreshedActionTemplateId }],
    },
    checkpointReceiptState: scenario.checkpointReceiptState,
    checkpointActionStateAfterReject: scenario.checkpointActionState,
    checkpointTargetSlotsAfterReject: scenario.checkpointTargetSlots,
    receiptCount: 1,
    receiptStatusText: scenario.messageIncludes,
  };
}
