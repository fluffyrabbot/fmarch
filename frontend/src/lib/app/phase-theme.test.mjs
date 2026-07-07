import assert from "node:assert/strict";
import { test } from "node:test";
import { get } from "svelte/store";
import {
  PHASE_THEME_CONTRACT,
  activePhaseTheme,
  phaseThemeKey,
} from "./phase-theme.mjs";

test("phase theme contract names the data-phase grammar", () => {
  assert.equal(PHASE_THEME_CONTRACT.attribute, "data-phase");
  assert.deepEqual([...PHASE_THEME_CONTRACT.phases], ["day", "night", "twilight"]);
});

test("phase theme key maps projected phases onto day night and twilight", () => {
  assert.equal(phaseThemeKey({ id: "D01", label: "Day 2" }), "day");
  assert.equal(phaseThemeKey({ label: "Day 2" }), "day");
  assert.equal(phaseThemeKey({ id: "D01" }), "day");
  assert.equal(phaseThemeKey({ id: "N02", label: "Night 2" }), "night");
  assert.equal(phaseThemeKey({ id: "N02" }), "night");
  assert.equal(phaseThemeKey({ id: "T01", label: "Twilight 1" }), "twilight");
  assert.equal(phaseThemeKey({ label: "Twilight 1" }), "twilight");
});

test("phase theme key is null off-game so user preference drives the palette", () => {
  assert.equal(phaseThemeKey(null), null);
  assert.equal(phaseThemeKey(undefined), null);
  assert.equal(phaseThemeKey({}), null);
  assert.equal(phaseThemeKey({ id: "", label: "" }), null);
  assert.equal(phaseThemeKey({ label: "Signups" }), null);
});

test("active phase theme store starts unset and round-trips", () => {
  assert.equal(get(activePhaseTheme), null);
  activePhaseTheme.set("night");
  assert.equal(get(activePhaseTheme), "night");
  activePhaseTheme.set(null);
  assert.equal(get(activePhaseTheme), null);
});
