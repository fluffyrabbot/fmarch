import { fail, redirect } from "@sveltejs/kit";
import { buildAppShell } from "../../lib/app/app-shell-model.mjs";
import { THEMES, THEME_SCHEMES, THEME_COOKIE, encodeThemePreference } from "../../lib/app/theme.mjs";

export function load({ locals }) {
  return { shellOwner: "layout", shell: buildAppShell({ activeSurface: "appearance", principalId: locals.principalId,
    viewerProfile: locals.viewerProfile, capabilities: locals.resolvedCapabilities }) };
}
export const actions = {
  async default({ request, cookies, url }) {
    if (request.headers.get("origin") !== url.origin) return fail(403, { error: "Please save appearance from this site." });
    const form = await request.formData();
    const themeId = form.get("themeId"), scheme = form.get("scheme");
    if (!THEMES.some(theme => theme.id === themeId) || !THEME_SCHEMES.some(item => item.id === scheme)) {
      return fail(400, { error: "Choose a listed theme and color preference." });
    }
    cookies.set(THEME_COOKIE, encodeThemePreference({ themeId, scheme }), {
      path: "/", httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", maxAge: 31536000,
    });
    throw redirect(303, "/appearance");
  },
};
