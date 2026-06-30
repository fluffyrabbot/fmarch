import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT,
  buildPlayerActionSubmissionCheckpoint,
} from "./player-action-submission-checkpoint.mjs";

test("player action checkpoint points at the enabled action command", () => {
  const checkpoint = buildPlayerActionSubmissionCheckpoint({
    commandState: {
      actorSlot: "slot-7",
      actorAlive: true,
      actorStatus: "alive",
      phase: { phaseId: "N02", locked: false },
    },
    composer: {
      actionCommands: [
        {
          action: "submit_action:factional_kill",
          templateId: "factional_kill",
          targets: ["slot-2"],
        },
      ],
    },
    player: { slotId: "slot-7", alive: true, status: "alive" },
  });

  assert.equal(
    checkpoint.root.testId,
    PLAYER_ACTION_SUBMISSION_CHECKPOINT_CONTRACT.rootTestId,
  );
  assert.equal(checkpoint.root.data.proofCheckId, "player-action-submission");
  assert.equal(checkpoint.root.data.phaseId, "N02");
  assert.equal(checkpoint.root.data.phaseState, "open");
  assert.equal(checkpoint.root.data.actorSlot, "slot-7");
  assert.equal(
    checkpoint.root.data.actionState,
    "enabled:submit_action:factional_kill",
  );
  assert.equal(checkpoint.root.data.selectedAction, "factional_kill");
  assert.equal(checkpoint.root.data.targetSlots, "slot-2");
  assert.equal(checkpoint.root.data.receiptState, "idle");
  assert.equal(checkpoint.target.value, "factional_kill -> slot-2");
  assert.equal(
    checkpoint.recovery.value,
    "Reject PhaseLocked: refresh command state and use current action controls.",
  );
  assert.equal(checkpoint.status.state, "ack");
});

test("player action checkpoint fails closed without legal actions", () => {
  const checkpoint = buildPlayerActionSubmissionCheckpoint({
    commandState: {
      actorSlot: "slot-7",
      actorAlive: true,
      actorStatus: "alive",
      phase: { phaseId: "D02", locked: true },
    },
    composer: { actionCommands: [] },
    player: { slotId: "slot-7", alive: true, status: "alive" },
    commandStatus: { state: "reject", error: "PhaseLocked" },
  });

  assert.equal(checkpoint.root.data.phaseState, "locked");
  assert.equal(checkpoint.root.data.actionState, "disabled:phase locked");
  assert.equal(checkpoint.root.data.selectedAction, "");
  assert.equal(checkpoint.root.data.receiptState, "reject:PhaseLocked");
  assert.equal(checkpoint.status.state, "pending");
  assert.match(checkpoint.status.message, /phase locked/);
});
