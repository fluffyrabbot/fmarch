import { writable } from "svelte/store";

export const PHASE_THEME_CONTRACT = Object.freeze({
  attribute: "data-phase",
  phases: Object.freeze(["day", "night", "twilight"]),
});

/*
 * Maps a projected phase (id like "D01"/"N02", label like "Day 2") onto the
 * data-phase theme key. Returns null when no phase is projected — off-game
 * surfaces carry no data-phase and follow the user's light/dark preference.
 */
export function phaseThemeKey(phase) {
  if (phase === null || phase === undefined) {
    return null;
  }
  const source = `${phase.id ?? ""} ${phase.label ?? ""}`.toLowerCase();
  if (/twilight|dusk/.test(source) || /(^|\s)t\d/.test(source)) {
    return "twilight";
  }
  if (/night/.test(source) || /(^|\s)n\d/.test(source)) {
    return "night";
  }
  if (/day/.test(source) || /(^|\s)d\d/.test(source)) {
    return "day";
  }
  return null;
}

/*
 * Live projection override: game routes set this from projection updates so
 * the shell re-keys without a navigation; it resets to null on route destroy.
 */
export const activePhaseTheme = writable(null);
