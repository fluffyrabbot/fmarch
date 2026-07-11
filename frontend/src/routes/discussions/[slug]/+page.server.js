import { fail, redirect } from "@sveltejs/kit";
import { buildAppSurfaceHeaderViewModel } from "../../../lib/app/app-surface-header-model.mjs";
import { hasCapability } from "../../../lib/app/capabilities.mjs";
import { SESSION_COOKIE_NAME } from "../../../lib/server/session-capabilities.mjs";

export async function load({ params, locals, fetch, url }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const search = new URLSearchParams({ limit: "12" });
  const cursor = optionalText(url.searchParams.get("cursor"));
  if (cursor !== null) search.set("cursor", cursor);
  const area = await loadJson(
    fetch,
    `${apiBaseUrl}/discussions/areas/${encodeURIComponent(params.slug)}?${search.toString()}`,
  );
  if (area === null) {
    return unavailableData(params.slug, locals);
  }
  const selectedTopic = optionalId(url.searchParams.get("topic"));
  const thread =
    selectedTopic === null
      ? null
      : await loadJson(fetch, `${apiBaseUrl}/discussions/topics/${encodeURIComponent(selectedTopic)}?limit=50`);
  return {
    shellOwner: "layout",
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "board",
      eyebrow: "Community",
      title: area.area.title,
      summary: area.area.description,
    }),
    discussion: {
      status: "ready",
      area: area.area,
      topics: Array.isArray(area.topics) ? area.topics : [],
      nextCursor: optionalText(area.next_cursor),
      selectedTopic,
      thread: thread === null ? null : thread,
      canPost: typeof locals.principalUserId === "string",
      canModerate: hasCapability({
        capabilities: locals.resolvedCapabilities,
        kind: "GlobalMod",
      }) || hasCapability({
        capabilities: locals.resolvedCapabilities,
        kind: "GlobalAdmin",
      }),
    },
  };
}

export const actions = {
  createTopic: async ({ cookies, fetch, params, request, url }) => {
    const form = await request.formData();
    const response = await discussionMutation({
      cookies,
      fetch,
      path: `/discussions/areas/${encodeURIComponent(params.slug)}/topics`,
      body: { title: text(form.get("title")), body: text(form.get("body")) },
    });
    if (!response.ok) return mutationFailure(response, "Unable to create discussion topic");
    const topic = await response.json();
    throw redirect(303, `${url.pathname}?topic=${encodeURIComponent(topic.topic)}`);
  },
  createPost: async ({ cookies, fetch, request, url }) => {
    const form = await request.formData();
    const topic = optionalId(form.get("topic"));
    if (topic === null) return fail(400, mutationStatus("reject", "Choose a discussion topic before posting"));
    const response = await discussionMutation({
      cookies,
      fetch,
      path: `/discussions/topics/${encodeURIComponent(topic)}/posts`,
      body: { body: text(form.get("body")) },
    });
    if (!response.ok) return mutationFailure(response, "Unable to post discussion reply");
    throw redirect(303, `${url.pathname}?topic=${encodeURIComponent(topic)}`);
  },
  moderate: async ({ cookies, fetch, request, url }) => {
    const form = await request.formData();
    const topic = optionalId(form.get("topic"));
    if (topic === null) return fail(400, mutationStatus("reject", "Choose a discussion topic before moderating"));
    const response = await discussionMutation({
      cookies,
      fetch,
      path: `/discussions/topics/${encodeURIComponent(topic)}/moderation`,
      body: { status: text(form.get("status")) },
    });
    if (!response.ok) return mutationFailure(response, "Unable to update discussion moderation");
    throw redirect(303, `${url.pathname}?topic=${encodeURIComponent(topic)}`);
  },
};

function unavailableData(slug, locals) {
  return {
    shellOwner: "layout",
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "board",
      eyebrow: "Community",
      title: "Discussion area",
      summary: "Public non-game discussion.",
    }),
    discussion: {
      status: "unavailable",
      area: { slug, title: "Discussion area", description: "" },
      topics: [],
      nextCursor: null,
      selectedTopic: null,
      thread: null,
      canPost: typeof locals.principalUserId === "string",
      canModerate: false,
    },
  };
}

async function discussionMutation({ cookies, fetch, path, body }) {
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
  return fail(response.status === 401 || response.status === 403 || response.status === 400 || response.status === 409 ? response.status : 502, mutationStatus(
    "reject",
    typeof payload?.message === "string" ? payload.message : fallback,
  ));
}

function mutationStatus(state, message) {
  return { id: "discussion-mutation", state, message };
}

async function loadJson(fetch, url) {
  const response = await fetch(url);
  if (!response.ok) return null;
  const value = await response.json().catch(() => null);
  return value !== null && typeof value === "object" ? value : null;
}

function optionalId(value) {
  return typeof value === "string" && /^[0-9a-f-]{36}$/iu.test(value) ? value : null;
}

function optionalText(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function text(value) {
  return typeof value === "string" ? value : "";
}
