import assert from "node:assert/strict";
import test from "node:test";

import { seatLabel, seatNames, seatNumber, seatTag, voteTargetLabel } from "./seat-presenter.mjs";

// slot-1: Mira seated at 3, renamed Rowan at 10, replaced by Wren (ended 20,
// began 21). slot-2: Lark, dead. slot-10: never seated.
const roster = Object.freeze([
  {
    slot_id: "slot-1",
    alive: true,
    status: "alive",
    occupancies: [
      {
        began_seq: 4,
        ended_seq: 20,
        names: [
          { effective_seq: 3, public_name: "Mira" },
          { effective_seq: 10, public_name: "Rowan" },
        ],
      },
      { began_seq: 21, ended_seq: null, names: [{ effective_seq: 19, public_name: "Wren" }] },
    ],
  },
  {
    slot_id: "slot-2",
    alive: false,
    status: "dead",
    occupancies: [
      { began_seq: 6, ended_seq: null, names: [{ effective_seq: 5, public_name: "Lark" }] },
    ],
  },
  { slot_id: "slot-10", alive: true, status: "alive", occupancies: [] },
]);

test("unnamed seats read as their ordinal in every spelling the wire uses", () => {
  for (const slotId of ["slot-7", "slot_7", "Slot7", "slot7"]) {
    assert.equal(seatLabel(slotId), "Slot 7");
  }
  assert.equal(seatLabel("p12"), "Slot 12");
  assert.equal(seatLabel("slot-a_b"), "Slot a b");
  assert.equal(seatLabel("narrator"), "narrator");
  assert.equal(seatLabel(""), "Unknown seat");
  assert.equal(seatNumber("slot_12"), "12");
  assert.equal(seatTag("slot_12"), "S12");
  assert.equal(seatTag("narrator"), null);
});

test("a named seat leads with the person and keeps the seat as a tag", () => {
  assert.equal(seatLabel("slot-7", { name: " Mira " }), "Mira · S7");
  assert.equal(seatLabel("narrator", { name: "Mira" }), "Mira");
  assert.equal(seatLabel("slot-7", { name: "  " }), "Slot 7");
});

test("the roster names a seat as of any sequence", () => {
  const names = seatNames(roster);
  assert.equal(names.label("slot-1", { at: 5 }), "Mira · S1");
  assert.equal(names.label("slot-1", { at: 12 }), "Rowan · S1", "a rename applies from its sequence");
  assert.equal(names.label("slot-1", { at: 19 }), "Rowan · S1", "the outgoing tenure runs until it ends");
  assert.equal(names.label("slot-1", { at: 30 }), "Wren · S1", "the replacement owns later posts");
  assert.equal(names.label("slot-1"), "Wren · S1", "no sequence means the current occupant");
  assert.equal(names.label("slot-2", { at: 40 }), "Lark · S2", "a dead seat keeps its name");
  assert.equal(names.label("slot-10"), "Slot 10", "an unseated seat has no name");
  assert.equal(names.label("slot-99"), "Slot 99", "an unknown seat is not guessed at");
  assert.equal(names.alive("slot-2"), false);
  assert.equal(names.alive("slot-99"), null);
});

test("presenters are memoized per roster", () => {
  assert.equal(seatNames(roster), seatNames(roster));
  assert.equal(seatNames(undefined).label("slot-3"), "Slot 3");
});

test("vote targets cover every wire shape", () => {
  const names = seatNames(roster);
  assert.equal(voteTargetLabel("NoLynch"), "No lynch");
  assert.equal(voteTargetLabel({ kind: "no_lynch" }, names), "No lynch");
  assert.equal(voteTargetLabel({ Slot: "slot-2" }, names), "Lark · S2");
  assert.equal(voteTargetLabel({ kind: "slot", slot_id: "slot-1" }, names), "Wren · S1");
  assert.equal(voteTargetLabel({ kind: "slot", slotId: "slot_2" }), "Slot 2");
  assert.equal(voteTargetLabel("slot-2"), "Slot 2");
});
