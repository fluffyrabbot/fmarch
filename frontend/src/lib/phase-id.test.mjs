import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalPhaseId,
  phaseDetailsFromId,
  phaseLabelFromId,
} from "./phase-id.mjs";

test("phase presentation derives all display facts from a canonical PhaseId", () => {
  assert.deepEqual(phaseDetailsFromId("D03R2"), {
    id: "D03R2",
    kind: "Day",
    number: 3,
    revote: 2,
  });
  assert.equal(phaseLabelFromId("N12"), "Night 12");
  assert.equal(phaseLabelFromId("T01R1"), "Twilight 1 revote 1");
});

test("phase presentation does not normalize legacy or malformed phase strings", () => {
  for (const invalid of [
    null,
    "day-1",
    "D00",
    "D3",
    "D003",
    "D01junk",
    "D01R0",
    "D01R02",
    "D2147483648",
    "D01R4294967296",
  ]) {
    assert.equal(canonicalPhaseId(invalid), null);
    assert.equal(phaseLabelFromId(invalid), null);
  }
});
