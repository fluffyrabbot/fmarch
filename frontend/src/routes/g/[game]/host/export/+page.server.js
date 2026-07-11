import { error } from "@sveltejs/kit";
import { buildAppSurfaceHeaderViewModel } from "../../../../../lib/app/app-surface-header-model.mjs";

export async function load({ params, locals, fetch }) {
  const principalUserId = locals.principalUserId;
  if (typeof principalUserId !== "string" || principalUserId.trim() === "") {
    throw error(403, "Completed-game export requires an authenticated host session.");
  }
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const response = await fetch(
    `${apiBaseUrl}/games/${encodeURIComponent(params.game)}/export?principal_user_id=${encodeURIComponent(principalUserId)}`,
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
