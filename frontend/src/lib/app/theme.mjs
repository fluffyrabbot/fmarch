import { phaseThemeKey } from "./phase-theme.mjs";

export const THEMES = Object.freeze([
  Object.freeze({ id: "paper", label: "Paper", description: "Warm paper, serif headings, and lantern accents." }),
  Object.freeze({ id: "slate", label: "Slate", description: "Cool surfaces, sans-serif headings, and compact geometry." }),
]);
export const THEME_SCHEMES = Object.freeze([
  Object.freeze({ id: "game", label: "Follow game" }),
  Object.freeze({ id: "system", label: "System" }),
  Object.freeze({ id: "light", label: "Light" }),
  Object.freeze({ id: "dark", label: "Dark" }),
]);
export const DEFAULT_THEME_PREFERENCE = Object.freeze({ themeId: "paper", scheme: "game" });
export const THEME_COOKIE = "fmarch_appearance";

export function normalizeThemePreference(value) {
  return Object.freeze({
    themeId: THEMES.some(theme => theme.id === value?.themeId) ? value.themeId : "paper",
    scheme: THEME_SCHEMES.some(scheme => scheme.id === value?.scheme) ? value.scheme : "game",
  });
}
export function decodeThemePreference(value) {
  if (typeof value !== "string") return DEFAULT_THEME_PREFERENCE;
  const [themeId, scheme] = value.split(":");
  return normalizeThemePreference({ themeId, scheme });
}
export function encodeThemePreference(value) {
  const { themeId, scheme } = normalizeThemePreference(value);
  return `${themeId}:${scheme}`;
}

export function resolveTheme({ themeId, scheme, phaseId = null, systemScheme = "light" } = {}) {
  const preference = normalizeThemePreference({ themeId, scheme });
  const phase = phaseThemeKey(phaseId);
  const system = systemScheme === "dark" ? "dark" : "light";
  const resolvedScheme = preference.scheme === "game" && phase !== null
    ? (phase === "day" ? "light" : "dark")
    : ["light", "dark"].includes(preference.scheme) ? preference.scheme : system;
  const palette = preference.scheme === "game" && phase === "twilight"
    ? "twilight" : resolvedScheme === "dark" ? "night" : "day";
  return Object.freeze({ themeId: preference.themeId, preference: preference.scheme, scheme: resolvedScheme, palette, phase });
}
