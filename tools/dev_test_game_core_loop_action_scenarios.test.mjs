import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPlayerActionSubmissionClickProofCase,
  assertPlayerInvalidActionRecoveryProofCase,
  assertPlayerStaleActionAfterTransitionProofCase,
  assertPlayerStaleVoteAfterTransitionProofCase,
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

test("player stale vote recovery assertion covers PhaseLocked transition reject", () => {
  const proof = {
    status: "passed",
    clickedAction: "submit_vote",
    commandKind: "SubmitVote",
    setupResyncFromSeq: 801,
    setupSnapshotCommandState: {
      phase: { phaseId: "D02" },
      voteTargets: [{ slotId: "slot-2" }],
    },
    command: {
      game: "game-a",
      actor_slot: "slot-7",
      target: { Slot: "slot-2" },
    },
    commandStatus: {
      state: "reject",
      error: "PhaseLocked",
      message: "stale vote state, refresh and use current vote controls",
    },
    bridgePlan: {
      role: "player",
      commandKind: "SubmitVote",
      commandEndpoint: "/commands",
      finalState: "reject",
      projectionRefreshKeys: ["votecount", "commandState", "dayVoteOutcomes"],
    },
    receipts: [{ state: "reject" }],
    projectionCommandState: {
      phase: { phaseId: "N02" },
      boundary: "PhaseLocked recovery refreshed player controls",
    },
    checkpointReceiptState: "reject:PhaseLocked",
    checkpointPhaseIdAfterReject: "N02",
    checkpointActionStateAfterReject: "enabled:submit_action:factional_kill",
    checkpointTargetSlotsAfterReject: "slot-3",
    recoveryText: "Reject PhaseLocked",
    receiptCount: 1,
    receiptStatusText: "stale vote state",
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
  const proof = {
    status: "passed",
    clickedAction: "submit_action:factional_kill",
    commandKind: "SubmitAction",
    command: {
      game: "game-a",
      action_id: "factional_kill",
      actor_slot: "slot-7",
      template_id: "factional_kill",
      targets: ["slot-3"],
    },
    commandStatus: {
      state: "reject",
      error: "PhaseLocked",
      message: "stale action state, refresh and use current action controls",
    },
    bridgePlan: {
      role: "player",
      commandKind: "SubmitAction",
      commandEndpoint: "/commands",
      finalState: "reject",
      projectionRefreshKeys: ["commandState"],
    },
    receipts: [{ state: "reject" }],
    projectionCommandState: {
      phase: { phaseId: "N02" },
      boundary: "PhaseLocked recovery refreshed action controls",
    },
    checkpointReceiptState: "reject:PhaseLocked",
    checkpointPhaseIdAfterReject: "N02",
    checkpointActionStateAfterReject: "enabled:submit_action:factional_kill",
    checkpointTargetSlotsAfterReject: "slot-3",
    recoveryText: "Reject PhaseLocked",
    receiptCount: 2,
    receiptStatusText: "Reject PhaseLocked: phase locked",
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
