import { phaseThemeKey } from "./phase-theme.mjs";

export const THEMES = Object.freeze([
  Object.freeze({ id: "den", label: "Moonlit Den", description: "Cozy werewolf village: rounded type, lantern pills, and phase-colored chips." }),
  Object.freeze({ id: "paper", label: "Paper", description: "Warm paper, serif headings, and lantern accents." }),
  Object.freeze({ id: "slate", label: "Slate", description: "Cool surfaces, sans-serif headings, and compact geometry." }),
]);
export const THEME_SCHEMES = Object.freeze([
  Object.freeze({ id: "game", label: "Follow game" }),
  Object.freeze({ id: "system", label: "System" }),
  Object.freeze({ id: "light", label: "Light" }),
  Object.freeze({ id: "dark", label: "Dark" }),
]);
export const DEFAULT_THEME_PREFERENCE = Object.freeze({ themeId: "den", scheme: "game" });
export const THEME_COOKIE = "fmarch_appearance";

export function normalizeThemePreference(value) {
  return Object.freeze({
    themeId: THEMES.some(theme => theme.id === value?.themeId) ? value.themeId : DEFAULT_THEME_PREFERENCE.themeId,
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

// The top-bar quick switch returns the viewer to the page they were on. Only a
// same-origin absolute path is honored; anything else lands on /appearance.
export function safeReturnPath(value) {
  if (typeof value !== "string" || value.length > 2048) return "/appearance";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/appearance";
  if (/[\u0000-\u001f\u007f\\]/u.test(value)) return "/appearance";
  return value;
}
