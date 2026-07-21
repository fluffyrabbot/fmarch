import { error, fail, redirect } from "@sveltejs/kit";
import { buildAppShell } from "../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../lib/app/app-surface-header-model.mjs";
import { hasCapability } from "../../lib/app/capabilities.mjs";
import { SESSION_COOKIE_NAME } from "../../lib/server/session-capabilities.mjs";

export async function load({ cookies, locals, fetch, url }) {
  const capabilities = Array.isArray(locals.resolvedCapabilities)
    ? locals.resolvedCapabilities
    : [];
  const allowed = hasCapability({ capabilities, kind: "GlobalMod" })
    || hasCapability({ capabilities, kind: "GlobalAdmin" });
  if (!allowed) throw error(403, "Community moderation requires GlobalMod");
  const token = cookies.get(SESSION_COOKIE_NAME);
  if (typeof token !== "string" || token.trim() === "") {
    throw error(401, "Community moderation requires an authenticated session");
  }
  const status = moderationStatus(url.searchParams.get("status"));
  const search = new URLSearchParams({ status, limit: "25" });
  const cursor = url.searchParams.get("cursor");
  if (typeof cursor === "string" && cursor !== "") search.set("cursor", cursor);
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const queueResponse = await fetch(`${apiBaseUrl}/moderation/cases?${search}`, {
    headers: authHeaders(token),
  });
  if (!queueResponse.ok) throw error(queueResponse.status, "Moderation queue is unavailable");
  const queue = await queueResponse.json();
  const selectedCase = url.searchParams.get("case");
  let detail = null;
  if (selectedCase !== null && selectedCase !== "") {
    const detailResponse = await fetch(
      `${apiBaseUrl}/moderation/cases/${encodeURIComponent(selectedCase)}`,
      { headers: authHeaders(token) },
    );
    if (!detailResponse.ok) throw error(detailResponse.status, "Moderation case is unavailable");
    detail = await detailResponse.json();
  }
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "moderator",
      principalUserId: locals.principalUserId,
      capabilities,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "moderator",
      eyebrow: "Community operations",
      title: "Moderation queue",
      summary: "Review member reports, record reasoned decisions, and preserve an auditable history.",
    }),
    moderation: {
      status,
      cases: Array.isArray(queue?.cases) ? queue.cases : [],
      nextCursor: typeof queue?.next_cursor === "string" ? queue.next_cursor : null,
      detail,
    },
  };
}

export const actions = {
  caseAction: async ({ cookies, fetch, request, url }) => {
    const token = cookies.get(SESSION_COOKIE_NAME);
    if (typeof token !== "string" || token.trim() === "") {
      return fail(401, { id: "moderation-action", state: "reject", message: "Sign in again" });
    }
    const form = await request.formData();
    const caseId = text(form.get("case_id"));
    const action = text(form.get("moderation_action"));
    const reason = text(form.get("reason"));
    const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
    const response = await fetch(
      `${apiBaseUrl}/moderation/cases/${encodeURIComponent(caseId)}/actions`,
      {
        method: "POST",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify({ action, reason }),
      },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return fail([400, 401, 403, 404, 409].includes(response.status) ? response.status : 502, {
        id: "moderation-action",
        state: "reject",
        message: payload?.message ?? "Unable to action moderation case",
      });
    }
    const status = moderationStatus(url.searchParams.get("status"));
    throw redirect(303, `/moderation?status=${encodeURIComponent(status)}&case=${encodeURIComponent(caseId)}`);
  },
};

function authHeaders(token) {
  return { authorization: `Bearer ${token}`, accept: "application/json" };
}

function moderationStatus(value) {
  return ["all", "open", "hidden", "dismissed", "restored"].includes(value)
    ? value
    : "open";
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
