import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertPlayerActionSubmissionClickProofCase,
  assertPlayerInvalidActionRecoveryProofCase,
  assertPlayerStaleActionAfterTransitionProofCase,
  assertPlayerStaleVoteAfterTransitionProofCase,
  playerActionBoundaryLaneId,
  playerActionLoopLaneId,
  playerActionSubmissionAckCheckpointPassed,
  playerActionSubmissionAckCheckpointRows,
  playerFactionalKillActionCommandFacts,
  playerActionSubmissionScenario,
  playerInvalidActionRecoveryLaneId,
  playerInvalidActionRecoveryScenario,
  playerStaleActionTransitionRecoveryHookId,
  playerStaleActionTransitionRecoveryFeatureSlotId,
  playerStaleVoteTransitionRecoveryHookId,
  playerStaleVoteTransitionRecoveryFeatureSlotId,
  playerSlotVoteCommandFacts,
  staleActionTransitionRecoveryFeatureSpineRow,
  staleDayTwoVoteAfterTransitionRecoveryScenario,
  staleNightOneActionAfterTransitionRecoveryScenario,
  staleVoteTransitionRecoveryFeatureSpineRow,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  playerActionSubmissionClickProofFixture,
} from "./dev_test_game_core_loop_role_surface_test_fixtures.mjs";

test("player action scenario module exports proof lane ids", () => {
  assert.equal(playerActionLoopLaneId, "action-loop");
  assert.equal(playerInvalidActionRecoveryLaneId, "invalid-action-recovery");
  assert.equal(playerActionBoundaryLaneId, "player-action-boundary");
  assert.equal(
    playerStaleVoteTransitionRecoveryFeatureSlotId,
    "stale-vote-transition-recovery",
  );
  assert.equal(
    playerStaleVoteTransitionRecoveryHookId,
    "staleVoteTransitionReject",
  );
  assert.equal(
    playerStaleActionTransitionRecoveryFeatureSlotId,
    "stale-action-transition-recovery",
  );
  assert.equal(
    playerStaleActionTransitionRecoveryHookId,
    "staleActionTransitionReject",
  );
});

test("player action assertions import case-only scenario definitions", async () => {
  const assertionSource = await readFile(
    "tools/dev_test_game_core_loop_action_scenarios.mjs",
    "utf8",
  );
  assert(
    assertionSource.includes(
      "./dev_test_game_core_loop_action_scenario_cases.mjs",
    ),
    "player action assertions should derive scenarios from the case-only module",
  );
  assert(
    !/export\s+function\s+playerInvalidActionRecoveryScenario\b/.test(
      assertionSource,
    ) &&
      !/export\s+function\s+staleNightFourActionRecoveryScenario\b/.test(
        assertionSource,
      ),
    "player action assertions should not redefine raw recovery scenarios",
  );
});

test("player command fact helpers derive reusable vote and action vocabulary", () => {
  assert.deepEqual(
    playerSlotVoteCommandFacts({
      actorSlot: "slot-4",
      targetSlot: "slot-2",
    }),
    {
      actorSlot: "slot-4",
      targetSlot: "slot-2",
      commandActionPrefix: "submit_vote",
      commandKind: "SubmitVote",
    },
  );
  assert.deepEqual(
    playerFactionalKillActionCommandFacts({
      actorSlot: "slot_4",
      targetSlot: "slot-2",
      actionId: "replacement_race_factional_kill",
      phaseId: "N01",
    }),
    {
      actorSlot: "slot_4",
      targetSlot: "slot-2",
      actionId: "replacement_race_factional_kill",
      commandAction: "submit_action:factional_kill",
      commandKind: "SubmitAction",
      templateId: "factional_kill",
      phaseId: "N01",
    },
  );
});

test("player stale transition recovery feature rows target the action-player role surface", () => {
  assert.deepEqual(
    staleVoteTransitionRecoveryFeatureSpineRow({ cycleId: "d02-n02" }),
    {
      targetKey: "staleVoteTransitionRecovery",
      featureSlotId: playerStaleVoteTransitionRecoveryFeatureSlotId,
      cycleId: "d02-n02",
      role: "actionPlayer",
      checkpointId: "d02-n02-n02-action-open",
      recoveryHookId: playerStaleVoteTransitionRecoveryHookId,
      adminCheckId: playerActionLoopLaneId,
    },
  );
  assert.deepEqual(
    staleActionTransitionRecoveryFeatureSpineRow({ cycleId: "d01-n01-d02" }),
    {
      targetKey: "staleActionTransitionRecovery",
      featureSlotId: playerStaleActionTransitionRecoveryFeatureSlotId,
      cycleId: "d01-n01-d02",
      role: "actionPlayer",
      checkpointId: "d01-n01-d02-n01-action-open",
      recoveryHookId: playerStaleActionTransitionRecoveryHookId,
      adminCheckId: playerActionLoopLaneId,
    },
  );
});

test("player action submission assertion covers factional kill ACK", () => {
  const scenario = playerActionSubmissionScenario();
  const proof = {
    status: "passed",
    clickedAction: scenario.clickedAction,
    commandKind: scenario.commandKind,
    command: {
      game: "game-a",
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

  assert.doesNotThrow(() =>
    assertPlayerActionSubmissionClickProofCase({
      proof,
      expectedGame: "game-a",
    }),
  );
  assert.throws(
    () =>
      assertPlayerActionSubmissionClickProofCase({
        proof: {
          ...proof,
          bridgePlan: {
            ...proof.bridgePlan,
            projectionRefreshKeys: ["commandState"],
          },
        },
        expectedGame: "game-a",
      }),
    /player action click ACK/,
  );
});

test("player action submission checkpoint rows are scenario-owned", () => {
  const proof = playerActionSubmissionClickProofFixture();
  const playerRoleSurface = {
    playerActionSubmissionClickProof: proof,
  };

  assert.equal(
    playerActionSubmissionAckCheckpointPassed(playerRoleSurface),
    true,
  );
  assert.deepEqual(
    playerActionSubmissionAckCheckpointRows({
      cycleId: "d02-n02",
      playerRoleSurface,
    }),
    ["d02-n02-player-action-submission-ack-checkpoint"],
  );
  assert.deepEqual(
    playerActionSubmissionAckCheckpointRows({
      cycleId: "d02-n02",
      playerRoleSurface: {
        playerActionSubmissionClickProof: {
          ...proof,
          receiptStatusText: "Ack: stream seqs 500",
        },
      },
    }),
    [],
  );
});

test("player invalid-action recovery assertion covers InvalidTarget refresh", () => {
  const scenario = playerInvalidActionRecoveryScenario();
  const proof = {
    status: "passed",
    clickedAction: scenario.clickedAction,
    commandKind: scenario.commandKind,
    command: {
      game: "game-a",
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

  assert.doesNotThrow(() =>
    assertPlayerInvalidActionRecoveryProofCase({
      proof,
      expectedGame: "game-a",
    }),
  );
  assert.throws(
    () =>
      assertPlayerInvalidActionRecoveryProofCase({
        proof: {
          ...proof,
          projectionCommandState: {
            ...proof.projectionCommandState,
            actions: [],
          },
        },
        expectedGame: "game-a",
      }),
    /player invalid-action recovery/,
  );
});

test("player stale vote recovery assertion covers PhaseLocked transition reject", () => {
  const scenario = staleDayTwoVoteAfterTransitionRecoveryScenario();
  const proof = {
    status: "passed",
    clickedAction: scenario.clickedAction,
    commandKind: scenario.commandKind,
    setupResyncFromSeq: scenario.setupResyncFromSeq,
    setupSnapshotCommandState: {
      phase: { phaseId: scenario.setupPhaseId },
      voteTargets: [{ slotId: scenario.targetSlot }],
    },
    command: {
      game: "game-a",
      actor_slot: scenario.actorSlot,
      target: { Slot: scenario.targetSlot },
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
      boundary: `${scenario.refreshedBoundary} refreshed player controls`,
    },
    checkpointReceiptState: scenario.checkpointReceiptState,
    checkpointPhaseIdAfterReject: scenario.refreshedPhaseId,
    checkpointActionStateAfterReject: scenario.checkpointActionState,
    checkpointTargetSlotsAfterReject: scenario.checkpointTargetSlots,
    recoveryText: "Reject PhaseLocked",
    receiptCount: scenario.receiptCount,
    receiptStatusText: scenario.receiptStatusTextIncludes,
  };

  assert.doesNotThrow(() =>
    assertPlayerStaleVoteAfterTransitionProofCase({
      proof,
      expectedGame: "game-a",
    }),
  );
  assert.throws(
    () =>
      assertPlayerStaleVoteAfterTransitionProofCase({
        proof: {
          ...proof,
          bridgePlan: {
            ...proof.bridgePlan,
            projectionRefreshKeys: ["commandState", "dayVoteOutcomes"],
          },
        },
        expectedGame: "game-a",
      }),
    /stale player vote recovery after transition/,
  );
});

test("player stale action recovery assertion covers PhaseLocked transition reject", () => {
  const scenario = staleNightOneActionAfterTransitionRecoveryScenario();
  const proof = {
    status: "passed",
    clickedAction: scenario.clickedAction,
    commandKind: scenario.commandKind,
    command: {
      game: "game-a",
      action_id: scenario.actionId,
      actor_slot: scenario.actorSlot,
      template_id: scenario.templateId,
      targets: [scenario.targetSlot],
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
      boundary: `${scenario.refreshedBoundary} refreshed action controls`,
    },
    checkpointReceiptState: scenario.checkpointReceiptState,
    checkpointPhaseIdAfterReject: scenario.refreshedPhaseId,
    checkpointActionStateAfterReject: scenario.checkpointActionState,
    checkpointTargetSlotsAfterReject: scenario.checkpointTargetSlots,
    recoveryText: "Reject PhaseLocked",
    receiptCount: scenario.receiptCount,
    receiptStatusText: scenario.receiptStatusTextIncludes,
  };

  assert.doesNotThrow(() =>
    assertPlayerStaleActionAfterTransitionProofCase({
      proof,
      expectedGame: "game-a",
    }),
  );
  assert.throws(
    () =>
      assertPlayerStaleActionAfterTransitionProofCase({
        proof: {
          ...proof,
          receiptCount: 1,
        },
        expectedGame: "game-a",
      }),
    /stale player action recovery after transition/,
  );
});
