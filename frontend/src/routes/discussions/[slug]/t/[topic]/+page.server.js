import { fail, redirect } from "@sveltejs/kit";
import { buildAppShell } from "../../../../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../../../../lib/app/app-surface-header-model.mjs";
import { hasCapability } from "../../../../../lib/app/capabilities.mjs";
import { SESSION_COOKIE_NAME } from "../../../../../lib/server/session-capabilities.mjs";

export async function load({ params, locals, cookies, fetch, url }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const search = new URLSearchParams({ limit: "50" });
  const beforeSeq = optionalSequence(url.searchParams.get("before_seq"));
  if (beforeSeq !== null) search.set("before_seq", beforeSeq);
  const response = await fetch(
    `${apiBaseUrl}/discussions/areas/${encodeURIComponent(params.slug)}/topics/${encodeURIComponent(params.topic)}?${search}`,
  );
  const thread = response.ok ? await response.json().catch(() => null) : null;
  const profile = await loadCurrentProfile({ cookies, fetch, apiBaseUrl });
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "community",
      principalUserId: locals.principalUserId,
      capabilities: locals.resolvedCapabilities,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "board",
      eyebrow: "Community",
      title: thread?.topic?.title ?? "Discussion topic",
      summary: thread === null ? "This topic is unavailable." : thread.area.title,
    }),
    discussion: {
      status: thread === null ? "unavailable" : "ready",
      area: thread?.area ?? { slug: params.slug, title: "Discussion area", description: "" },
      thread,
      canPost: profile !== null,
      hasSession: typeof locals.principalUserId === "string",
      canModerate: hasCapability({ capabilities: locals.resolvedCapabilities, kind: "GlobalMod" })
        || hasCapability({ capabilities: locals.resolvedCapabilities, kind: "GlobalAdmin" }),
    },
  };
}

export const actions = {
  createPost: async ({ cookies, fetch, params, request }) => {
    const form = await request.formData();
    const response = await mutation({
      cookies,
      fetch,
      path: `/discussions/topics/${encodeURIComponent(params.topic)}/posts`,
      body: { body: text(form.get("body")) },
    });
    if (!response.ok) return mutationFailure(response, "Unable to post discussion reply");
    const topic = await response.json();
    const anchor = topic.last_post_seq === null ? "" : `#post-${topic.last_post_seq}`;
    throw redirect(303, `/discussions/${encodeURIComponent(params.slug)}/t/${encodeURIComponent(params.topic)}${anchor}`);
  },
  postingState: async ({ cookies, fetch, params, request }) => {
    const form = await request.formData();
    const response = await mutation({
      cookies,
      fetch,
      path: `/discussions/topics/${encodeURIComponent(params.topic)}/moderation`,
      body: { posting_state: text(form.get("posting_state")) },
    });
    if (!response.ok) return mutationFailure(response, "Unable to update topic posting state");
    throw redirect(303, `/discussions/${encodeURIComponent(params.slug)}/t/${encodeURIComponent(params.topic)}`);
  },
  visibility: async ({ cookies, fetch, params, request }) => {
    const form = await request.formData();
    const visibility = text(form.get("visibility"));
    const response = await mutation({
      cookies,
      fetch,
      path: `/discussions/topics/${encodeURIComponent(params.topic)}/moderation`,
      body: { visibility },
    });
    if (!response.ok) return mutationFailure(response, "Unable to update topic visibility");
    throw redirect(303, visibility === "hidden"
      ? `/discussions/${encodeURIComponent(params.slug)}`
      : `/discussions/${encodeURIComponent(params.slug)}/t/${encodeURIComponent(params.topic)}`);
  },
};

async function loadCurrentProfile({ cookies, fetch, apiBaseUrl }) {
  const token = cookies.get(SESSION_COOKIE_NAME);
  if (typeof token !== "string" || token.trim() === "") return null;
  const response = await fetch(`${apiBaseUrl}/profiles/me/editor`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  const profile = response.ok ? await response.json().catch(() => null) : null;
  return profile?.visibility === "public" ? profile : null;
}

async function mutation({ cookies, fetch, path, body }) {
  const token = cookies.get(SESSION_COOKIE_NAME);
  if (typeof token !== "string" || token.trim() === "") {
    return { ok: false, status: 401, json: async () => null };
  }
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  return fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function mutationFailure(response, fallback) {
  const payload = await response.json().catch(() => null);
  return fail([400, 401, 403, 409].includes(response.status) ? response.status : 502, {
    id: "discussion-mutation",
    state: "reject",
    message: typeof payload?.message === "string" ? payload.message : fallback,
  });
}

function optionalSequence(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/u.test(value) ? value : null;
}

function text(value) {
  return typeof value === "string" ? value : "";
}
