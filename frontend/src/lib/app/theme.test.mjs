import assert from "node:assert/strict";
import { test } from "node:test";
import { get } from "svelte/store";
import { resolveTheme, decodeThemePreference, encodeThemePreference, THEMES } from "./theme.mjs";
import { createThemeContext } from "./theme-context.mjs";

test("explicit light/dark and system choices remain independent of phase", () => {
  for (const { id: themeId } of THEMES) for (const phaseId of [null, "D01", "N01", "T01"]) {
    assert.equal(resolveTheme({ themeId, phaseId, scheme: "light", systemScheme: "dark" }).scheme, "light");
    assert.equal(resolveTheme({ themeId, phaseId, scheme: "dark", systemScheme: "light" }).scheme, "dark");
    assert.equal(resolveTheme({ themeId, phaseId, scheme: "system", systemScheme: "dark" }).scheme, "dark");
  }
});
test("follow-game preserves phase palettes and uses system outside games", () => {
  for (const [phaseId, palette] of [["D01", "day"], ["N01", "night"], ["T01", "twilight"], [null, "night"]]) {
    assert.equal(resolveTheme({ phaseId, systemScheme: "dark" }).palette, palette);
  }
});
test("untrusted preferences cannot select arbitrary theme identifiers", () => {
  assert.deepEqual(decodeThemePreference("evil:unexpected"), { themeId: "paper", scheme: "game" });
  assert.equal(encodeThemePreference(decodeThemePreference("slate:dark")), "slate:dark");
});
test("late route teardown and updates cannot overwrite the successor", () => {
  const context = createThemeContext();
  context.setRoute("/g/one", "D01");
  const old = context.claim("/g/one"); old.update("N01");
  assert.equal(get(context.resolved).palette, "night");
  context.setRoute("/g/two", "D01");
  assert.equal(get(context.resolved).palette, "day");
  const next = context.claim("/g/two"); next.update("T01");
  old.update("N02"); old.release();
  assert.equal(get(context.resolved).palette, "twilight");
  next.update(null);
  assert.equal(get(context.resolved).phase, null);
  next.release();
  context.setRoute("/", null);
  assert.equal(get(context.resolved).phase, null);
});
test("theme contexts are isolated between roots and requests", () => {
  const first = createThemeContext(), second = createThemeContext();
  first.setRoute("/g/one", "N01");
  first.preferences.set({ themeId: "slate", scheme: "dark" });
  assert.equal(get(second.resolved).themeId, "paper");
  assert.equal(get(second.resolved).phase, null);
});
