import assert from "node:assert/strict";
import { test } from "node:test";
import { phaseThemeKey } from "./phase-theme.mjs";

test("theme phase uses canonical domain identifiers only", () => {
  for (const [id, theme] of [["D01", "day"], ["N02", "night"], ["T01", "twilight"], [null, null], [undefined, null], ["Day 1", null], [{ label: "Night 1" }, null]]) {
    assert.equal(phaseThemeKey(id), theme);
  }
});
