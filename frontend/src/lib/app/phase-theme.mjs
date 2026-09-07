import { phaseDetailsFromId } from "../phase-id.mjs";

export const PHASE_THEME_CONTRACT = Object.freeze({
  attribute: "data-phase",
  phases: Object.freeze(["day", "night", "twilight"]),
});

// Domain identifier in; presentation text never participates in theme selection.
export function phaseThemeKey(phaseId) {
  const kind = phaseDetailsFromId(phaseId)?.kind;
  return kind === "Twilight" ? "twilight" : kind === "Night" ? "night" : kind === "Day" ? "day" : null;
}
