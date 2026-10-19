import assert from "node:assert/strict";
import test from "node:test";

import { seatLabel, seatNumber, voteTargetLabel } from "./seat-presenter.mjs";

test("seat ids read as their ordinal in every spelling the wire uses", () => {
  for (const slotId of ["slot-7", "slot_7", "Slot7", "slot7"]) {
    assert.equal(seatLabel(slotId), "Slot 7");
  }
  assert.equal(seatLabel("p12"), "Slot 12");
  assert.equal(seatLabel("slot-a_b"), "Slot a b");
});

test("unnumbered or missing seat ids are not guessed at", () => {
  assert.equal(seatLabel("narrator"), "narrator");
  assert.equal(seatLabel(""), "Unknown seat");
  assert.equal(seatLabel(null), "Unknown seat");
  assert.equal(seatNumber("narrator"), null);
  assert.equal(seatNumber("slot_12"), "12");
});

test("a persona name joins the seat label", () => {
  assert.equal(seatLabel("slot-7", { name: " Mira " }), "Slot 7 / Mira");
  assert.equal(seatLabel("slot-7", { name: "  " }), "Slot 7");
});

test("vote targets cover every wire shape", () => {
  assert.equal(voteTargetLabel("NoLynch"), "No lynch");
  assert.equal(voteTargetLabel("no_lynch"), "No lynch");
  assert.equal(voteTargetLabel({ kind: "no_lynch" }), "No lynch");
  assert.equal(voteTargetLabel({ Slot: "slot-2" }), "Slot 2");
  assert.equal(voteTargetLabel({ kind: "slot", slot_id: "slot_2" }), "Slot 2");
  assert.equal(voteTargetLabel("slot-2"), "Slot 2");
});
