import { frontendFixtureMode } from "../lib/server/runtime-mode.mjs";
import { decodeThemePreference, THEME_COOKIE } from "../lib/app/theme.mjs";

export function load({ locals, cookies }) {
  const scenario = frontendFixtureMode() ? cookies?.get("fmarch_ui_preview") : null;
  return {
    preview: ["player", "player-normal", "moderator"].includes(scenario) ? { scenario, slotId: scenario === "player-normal" ? "slot-4" : "slot-7" } : null,
    themePreference: decodeThemePreference(cookies?.get(THEME_COOKIE)),
    appSession: {
      principalId: locals.principalId ?? null,
      viewerProfile: locals.viewerProfile ?? null,
      resolvedCapabilities: Array.isArray(locals.resolvedCapabilities)
        ? locals.resolvedCapabilities
        : [],
    },
  };
}
