import { error } from "@sveltejs/kit";
import { buildAppSurfaceHeaderViewModel } from "../../../../../lib/app/app-surface-header-model.mjs";
import { serverApiBaseUrl } from "../../../../../lib/server/api-base.mjs";
import { accessTokenForRequest } from "../../../../../lib/server/session-capabilities.mjs";

export async function load({ params, locals, fetch, cookies }) {
  const principalUserId = locals.principalUserId;
  if (typeof principalUserId !== "string" || principalUserId.trim() === "") {
    throw error(403, "Completed-game export requires an authenticated host session.");
  }
  const sessionToken = accessTokenForRequest({ locals, cookies });
  const response = await fetch(
    `${serverApiBaseUrl()}/games/${encodeURIComponent(params.game)}/export`,
    { headers: { authorization: `Bearer ${sessionToken}`, accept: "application/json" } },
  );
  if (!response.ok) {
    throw error(response.status === 403 ? 403 : response.status === 404 ? 404 : 502, "Completed-game export is unavailable.");
  }
  const manifest = await response.json();
  return {
    shellOwner: "layout",
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "moderator",
      eyebrow: "Archive",
      title: "Completed-game export",
      summary: "Validated portable event manifest.",
    }),
    exportManifest: manifest,
  };
}
