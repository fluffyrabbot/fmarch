import { fail } from "@sveltejs/kit";
import { buildAppShell } from "../../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../../lib/app/app-surface-header-model.mjs";
import { SESSION_COOKIE_NAME } from "../../../lib/server/session-capabilities.mjs";

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
      hasSession: typeof locals.principalUserId === "string",
    },
  };
}

export const actions = {
  report: async ({ cookies, fetch, params, request }) => {
    const token = cookies.get(SESSION_COOKIE_NAME);
    if (typeof token !== "string" || token.trim() === "") {
      return fail(401, { id: "public-game-report", state: "reject", message: "Sign in to report public content" });
    }
    const form = await request.formData();
    const sourceSeq = optionalSequence(form.get("source_seq"));
    if (sourceSeq === null) {
      return fail(400, { id: "public-game-report", state: "reject", message: "Invalid public post" });
    }
    const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
    const response = await fetch(`${apiBaseUrl}/moderation/reports`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        target_kind: "game_post",
        scope_id: params.game,
        source_seq: Number(sourceSeq),
        reason_family: text(form.get("reason_family")),
        details: text(form.get("details")),
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return fail([400, 401, 404, 409, 429].includes(response.status) ? response.status : 502, {
        id: "public-game-report",
        state: "reject",
        message: payload?.message ?? "Unable to submit report",
      });
    }
    return {
      id: "public-game-report",
      state: "ack",
      sourceSeq,
      reportId: payload.report_id,
      message: "Report received. Your receipt is private to this account.",
    };
  },
};

function optionalSequence(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
