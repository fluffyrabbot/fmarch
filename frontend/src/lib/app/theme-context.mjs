import { derived, writable } from "svelte/store";
import { canonicalPhaseId } from "../phase-id.mjs";
import { DEFAULT_THEME_PREFERENCE, resolveTheme } from "./theme.mjs";

export const THEME_CONTEXT = Symbol("fmarch-theme");

// One instance per root layout/request. A stale publisher cannot clear or
// overwrite its successor, and a different route cannot inherit its phase.
export function createThemeContext(preference = DEFAULT_THEME_PREFERENCE) {
  const route = writable({ scope: "", phaseId: null });
  const preferences = writable(preference);
  const system = writable("light");
  const projection = writable(null);
  let owner = null;
  const resolved = derived([route, preferences, system, projection], ([route, preference, systemScheme, projection]) =>
    resolveTheme({ ...preference, systemScheme,
      phaseId: projection?.scope === route.scope ? projection.phaseId : route.phaseId,
    }));
  return {
    resolved, preferences, system,
    setRoute(scope, phaseId) { route.set({ scope, phaseId: canonicalPhaseId(phaseId) }); },
    claim(scope) {
      const token = Symbol(scope);
      owner = token;
      return {
        update(phaseId) {
          if (owner === token) projection.set({ scope, phaseId: canonicalPhaseId(phaseId) });
        },
        release() {
          if (owner === token) { owner = null; projection.set(null); }
        },
      };
    },
  };
}
