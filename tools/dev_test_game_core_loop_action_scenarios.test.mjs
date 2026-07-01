import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPlayerActionSubmissionClickProofCase,
  assertPlayerInvalidActionRecoveryProofCase,
  playerActionSubmissionScenario,
  playerInvalidActionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenarios.mjs";

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
