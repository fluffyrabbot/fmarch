import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPlayerVotePicker, voteActionForSlot } from "./player-vote-picker-model.mjs";

const NAMES = [
  "Juniper", "Ilya", "Rook", "Wren", "Lark", "Sable", "Mira",
  "Fenn", "Ash", "Corin", "Tamsin", "Bram", "Odile",
];

// A 13-seat game seen from slot-7 (Mira): every other seat and No lynch are
// legal targets, listed by the server in an arbitrary order.
const roster = NAMES.map((name, index) => ({
  slot_id: `slot-${index + 1}`,
  alive: true,
  status: "alive",
  occupancies: [{ began_seq: 1, ended_seq: null, names: [{ effective_seq: 1, public_name: name }] }],
}));
const voteCommands = [
  ...[12, 2, 10, 1, 3, 4, 5, 6, 8, 9, 11, 13].map((seat, index) => ({
    action: index === 0 ? "submit_vote" : `submit_vote:slot-${seat}`,
    voteTarget: { Slot: `slot-${seat}` },
  })),
  { action: "submit_vote:no_lynch", voteTarget: "NoLynch" },
];
const votecount = [
  { target: "slot-2", count: 3, needed: 7 },
  { target: "slot-7", count: 1, needed: 7 },
];

test("the picker lists every target in seat order with tallies, No lynch last", () => {
  const picker = buildPlayerVotePicker({ voteCommands, votecount, roster });
  assert.deepEqual(
    picker.rows.map((row) => row.key),
    [...Array.from({ length: 13 }, (_, index) => `slot-${index + 1}`), "no_lynch"],
  );
  const ilya = picker.rows.find((row) => row.key === "slot-2");
  assert.equal(ilya.label, "Ilya · S2");
  assert.equal(ilya.tally, "3/7");
  assert.equal(picker.rows.find((row) => row.key === "slot-13").tally, "0/7");
  assert.equal(picker.summary, "Votes · 7 to decide");
  assert.equal(picker.dock.label, "Vote");
  assert.equal(picker.unvote.disabled, true, "nothing to withdraw yet");
});

test("the viewer's own seat shows its tally but is never a target", () => {
  const picker = buildPlayerVotePicker({ voteCommands, votecount, roster });
  const self = picker.rows.find((row) => row.key === "slot-7");
  assert.equal(self.action, null);
  assert.equal(self.selectable, false);
  assert.equal(self.tally, "1/7");
  assert.equal(self.note, "Not a vote target");
});

test("selecting a row asks for confirmation before anything is dispatched", () => {
  const unselected = buildPlayerVotePicker({ voteCommands, votecount, roster });
  assert.ok(unselected.rows.every((row) => row.confirmation === null));

  const picker = buildPlayerVotePicker({
    voteCommands, votecount, roster, selectedAction: "submit_vote:slot-2",
  });
  const selected = picker.rows.filter((row) => row.selected);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].action, "submit_vote:slot-2");
  assert.deepEqual(selected[0].confirmation, { message: "Vote Ilya", confirmLabel: "Vote" });
});

test("changing a vote names both the old and the new target", () => {
  const picker = buildPlayerVotePicker({
    voteCommands,
    votecount,
    roster,
    currentVote: { kind: "slot", slotId: "slot-3" },
    selectedAction: "submit_vote:no_lynch",
  });
  assert.equal(picker.dock.label, "Voting Rook");
  const current = picker.rows.find((row) => row.key === "slot-3");
  assert.equal(current.current, true);
  assert.equal(current.selectable, false, "the current vote is not offered again");
  assert.equal(current.note, "Your vote");
  assert.deepEqual(
    picker.rows.find((row) => row.selected).confirmation,
    { message: "Change vote: Rook → No lynch", confirmLabel: "Change vote" },
  );
});

test("unvote confirms the same way and honours the withdraw state", () => {
  const currentVote = { kind: "no_lynch", slotId: null };
  const idle = buildPlayerVotePicker({ voteCommands, roster, currentVote, canWithdraw: true });
  assert.equal(idle.dock.label, "Voting No lynch");
  assert.equal(idle.unvote.selected, false);
  assert.equal(idle.unvote.confirmation, null);

  const armed = buildPlayerVotePicker({
    voteCommands, roster, currentVote, canWithdraw: true, selectedAction: "withdraw_vote",
  });
  assert.deepEqual(armed.unvote.confirmation, {
    message: "Remove your vote for No lynch",
    confirmLabel: "Unvote",
  });

  const locked = buildPlayerVotePicker({
    voteCommands, roster, currentVote, canWithdraw: false, withdrawReason: "Phase locked",
    selectedAction: "withdraw_vote",
  });
  assert.equal(locked.unvote.disabled, true);
  assert.equal(locked.unvote.reason, "Phase locked");
  assert.equal(locked.unvote.confirmation, null);
});

test("a disabled picker still shows the count but offers nothing", () => {
  const picker = buildPlayerVotePicker({
    voteCommands, votecount, roster, disabled: true, selectedAction: "submit_vote:slot-2",
  });
  assert.ok(picker.rows.every((row) => !row.selectable && row.confirmation === null));
  assert.equal(picker.rows.find((row) => row.key === "slot-2").tally, "3/7");
});

test("every wire spelling of No lynch is one row", () => {
  const picker = buildPlayerVotePicker({
    voteCommands,
    votecount: [{ target: "No lynch", count: 2, needed: 7 }],
    roster,
  });
  const noLynch = picker.rows.filter((row) => row.label === "No lynch");
  assert.equal(noLynch.length, 1);
  assert.equal(noLynch[0].tally, "2/7");
  assert.equal(noLynch[0].action, "submit_vote:no_lynch");
});

test("a post author resolves to their vote command", () => {
  assert.equal(voteActionForSlot(voteCommands, "slot-12"), "submit_vote");
  assert.equal(voteActionForSlot(voteCommands, "slot-4"), "submit_vote:slot-4");
  assert.equal(voteActionForSlot(voteCommands, "slot-7"), null);
});
