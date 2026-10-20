import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPlayerCommandStatusLine } from "./player-command-status-line-model.mjs";

const roster = [
  { slot_id: "slot-1", alive: true, status: "alive", occupancies: [
    { began_seq: 1, ended_seq: null, names: [{ effective_seq: 1, public_name: "Juniper" }] },
  ] },
  { slot_id: "slot-2", alive: true, status: "alive", occupancies: [
    { began_seq: 1, ended_seq: null, names: [{ effective_seq: 1, public_name: "Ilya" }] },
  ] },
];
const voteCommands = [
  { action: "submit_vote", voteTarget: { Slot: "slot-1" } },
  { action: "submit_vote:slot-2", voteTarget: { Slot: "slot-2" } },
  { action: "submit_vote:no_lynch", voteTarget: "NoLynch" },
];
const line = (status, options = {}) =>
  buildPlayerCommandStatusLine({ status, voteCommands, roster, ...options });

test("nothing to say without a command", () => {
  assert.equal(line(null), null);
});

test("a vote is named by its target, never by its transport", () => {
  assert.equal(line({ state: "pending", actionId: "submit_vote" }).text, "Sending your vote for Juniper…");
  assert.equal(
    line({ state: "ack", actionId: "submit_vote:slot-2", message: "Ack: stream seqs 71" }).text,
    "Your vote for Ilya went through.",
  );
  assert.equal(line({ state: "ack", actionId: "submit_vote:no_lynch" }).text, "Your vote for No lynch went through.");
  assert.equal(line({ state: "ack", commandTrace: { actionId: "submit_post" } }).text, "Your post went through.");
  assert.equal(line({ state: "ack", message: "Ack" }, { actionId: "submit_post" }).actionId, "submit_post");
});

test("an interrupted vote offers Retry and Dismiss, keeping the original attempt", () => {
  const view = line({
    state: "interrupted",
    interruption: "timeout",
    retryable: true,
    actionId: "submit_vote:slot-2",
    commandId: "7b1f1d2e-0000-4000-8000-000000000001",
    message: "Command timed out",
  });
  assert.equal(view.text, "Your vote for Ilya may not have gone through.");
  assert.equal(view.ariaLive, "assertive");
  assert.deepEqual(
    [view.recovery.testId, view.recovery.retry.testId, view.recovery.dismiss.testId, view.recovery.outcome],
    [
      "command-recovery-submit_vote:slot-2",
      "command-recovery-retry-submit_vote:slot-2",
      "command-recovery-cancel-submit_vote:slot-2",
      "unknown",
    ],
  );
  assert.equal(view.recovery.commandId, "7b1f1d2e-0000-4000-8000-000000000001");
  assert.equal(view.dismiss, null, "an unresolved command is dismissed through recovery");
  assert.doesNotMatch(JSON.stringify(view), /identity|receipt|command id/iu);
});

test("a rejection gives a reason, and Retry only when the attempt is retained", () => {
  const status = {
    state: "reject",
    error: "StreamConflict",
    retryable: true,
    commandId: "7b1f1d2e-0000-4000-8000-000000000002",
    actionId: "submit_vote",
    message: "Reject StreamConflict: reload and retry",
  };
  const plain = line(status);
  assert.equal(plain.text, "Your vote for Juniper didn't go through: the game changed while it was on its way.");
  assert.equal(plain.recovery, null);
  assert.equal(plain.dismiss.testId, "player-command-status-dismiss");

  const retained = line(status, { retryAvailable: true, retryEnabled: false });
  assert.equal(retained.recovery.outcome, "confirmed-rejection");
  assert.equal(retained.recovery.retry.enabled, false);
});

test("every known rejection has a player reason; others still say it failed", () => {
  for (const [error, reason] of [
    ["PhaseLocked", "the phase has closed"],
    ["GameAlreadyCompleted", "the game is over"],
    ["NotYourSlot", "you no longer hold this seat"],
    ["ActionAlreadySubmitted", "you have already acted this phase"],
  ]) {
    assert.equal(
      line({ state: "reject", error, actionId: "submit_action:factional_kill" }).text,
      `Your night action didn't go through: ${reason}.`,
    );
  }
  assert.equal(
    line({ state: "reject", error: "Mystery", actionId: "withdraw_vote" }).text,
    "Your unvote didn't go through.",
  );
});
