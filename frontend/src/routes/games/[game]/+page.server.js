import { buildAppShell } from "../../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../../lib/app/app-surface-header-model.mjs";

export async function load({ params, locals, fetch, url }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const search = new URLSearchParams({ limit: "50" });
  const beforeSeq = optionalSequence(url.searchParams.get("before_seq"));
  if (beforeSeq !== null) search.set("before_seq", beforeSeq);
  const response = await fetch(`${apiBaseUrl}/games/${encodeURIComponent(params.game)}?${search}`);
  const page = response.ok ? await response.json().catch(() => null) : null;
  const available = page !== null && typeof page === "object";
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "board",
      principalUserId: locals.principalUserId,
      capabilities: locals.resolvedCapabilities,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "board",
      eyebrow: "Public game",
      title: available ? `${page.game.pack} game` : "Game unavailable",
      summary: available
        ? "Public main-thread archive. Private channels and role data are excluded."
        : "This game is not active, completed, or publicly available.",
    }),
    publicGame: {
      status: available ? "ready" : "unavailable",
      game: available ? page.game : null,
      posts: Array.isArray(page?.posts) ? page.posts : [],
      nextBeforeSeq: optionalSequence(page?.next_before_seq),
    },
  };
}

function optionalSequence(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
}
