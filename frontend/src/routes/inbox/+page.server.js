import { error, fail, redirect } from "@sveltejs/kit";
import { buildAppShell } from "../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../lib/app/app-surface-header-model.mjs";
import { accessTokenForRequest } from "../../lib/server/session-capabilities.mjs";

export async function load({ cookies, locals, fetch, url }) {
  const token = accessTokenForRequest({ locals, cookies });
  if (typeof token !== "string" || token.trim() === "" || typeof locals.principalUserId !== "string") {
    throw error(401, "Inbox requires an authenticated account");
  }
  const search = new URLSearchParams({ limit: "50" });
  const beforeSeq = positiveSequence(url.searchParams.get("before_seq"));
  if (beforeSeq !== null) search.set("before_seq", beforeSeq);
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const response = await fetch(`${apiBaseUrl}/inbox?${search}`, {
    headers: authHeaders(token),
  });
  if (!response.ok) throw error(response.status, "Community inbox is unavailable");
  const page = await response.json();
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "inbox",
      principalUserId: locals.principalUserId,
      capabilities: locals.resolvedCapabilities,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "inbox",
      eyebrow: "Community",
      title: "Update inbox",
      summary: "Durable updates from public topics and game threads you watch.",
    }),
    inbox: {
      items: Array.isArray(page?.items) ? page.items : [],
      unreadCount: Number.isSafeInteger(page?.unread_count) ? page.unread_count : 0,
      nextCursor: positiveSequence(page?.next_cursor),
    },
  };
}

export const actions = {
  markRead: async ({ locals, cookies, fetch, request }) => {
    const form = await request.formData();
    const targetKind = subscriptionTargetKind(form.get("target_kind"));
    const scopeId = text(form.get("scope_id"));
    const sourceSeq = positiveSequence(form.get("source_seq"));
    if (targetKind === null || scopeId === "" || sourceSeq === null) {
      return fail(400, { id: "inbox-read", state: "reject", message: "Invalid inbox update" });
    }
    const response = await mutation({
      cookies,
      locals,
      fetch,
      path: `/subscriptions/${targetKind}/${encodeURIComponent(scopeId)}/read`,
      method: "POST",
      body: { read_through_seq: Number(sourceSeq) },
    });
    if (!response.ok) return mutationFailure(response, "Unable to mark this update read");
    throw redirect(303, "/inbox");
  },
  unwatch: async ({ locals, cookies, fetch, request }) => {
    const form = await request.formData();
    const targetKind = subscriptionTargetKind(form.get("target_kind"));
    const scopeId = text(form.get("scope_id"));
    if (targetKind === null || scopeId === "") {
      return fail(400, { id: "inbox-unwatch", state: "reject", message: "Invalid watch target" });
    }
    const response = await mutation({
      cookies,
      locals,
      fetch,
      path: `/subscriptions/${targetKind}/${encodeURIComponent(scopeId)}`,
      method: "DELETE",
    });
    if (!response.ok) return mutationFailure(response, "Unable to remove this watch");
    throw redirect(303, "/inbox");
  },
};

async function mutation({ locals, cookies, fetch, path, method, body = undefined }) {
  const token = accessTokenForRequest({ locals, cookies });
  if (typeof token !== "string" || token.trim() === "") {
    return { ok: false, status: 401, json: async () => null };
  }
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  return fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      ...authHeaders(token),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function mutationFailure(response, fallback) {
  const payload = await response.json().catch(() => null);
  return fail([400, 401, 404, 409].includes(response.status) ? response.status : 502, {
    id: "inbox-mutation",
    state: "reject",
    message: payload?.message ?? fallback,
  });
}

function authHeaders(token) {
  return { authorization: `Bearer ${token}`, accept: "application/json" };
}

function subscriptionTargetKind(value) {
  return ["discussion_topic", "game_thread"].includes(value) ? value : null;
}

function positiveSequence(value) {
  const normalized = value === null || value === undefined ? "" : String(value);
  return /^[1-9][0-9]*$/u.test(normalized) ? normalized : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
