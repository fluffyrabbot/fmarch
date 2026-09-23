import { redirect } from "@sveltejs/kit";
import { buildAppShell } from "../../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../../lib/app/app-surface-header-model.mjs";
import { hasCapability } from "../../../lib/app/capabilities.mjs";
import { buildCommunityAuthorView } from "../../../lib/app/community-author-model.mjs";
import { serverApiBaseUrl } from "../../../lib/server/api-base.mjs";
import { accessTokenForRequest } from "../../../lib/server/session-capabilities.mjs";
import { discussionMutationFailure } from "../../../lib/server/discussion-mutation-failure.mjs";

export async function load({ params, locals, cookies, fetch, url }) {
  const apiBaseUrl = serverApiBaseUrl();
  const token = accessTokenForRequest({ locals, cookies });
  const search = new URLSearchParams({ limit: "12" });
  const cursor = optionalText(url.searchParams.get("cursor"));
  if (cursor !== null) search.set("cursor", cursor);
  const area = await loadJson(
    fetch,
    `${apiBaseUrl}/discussions/areas/${encodeURIComponent(params.slug)}?${search.toString()}`,
    readHeaders(token),
  );
  if (area === null) {
    return unavailableData(params.slug, locals);
  }
  const profile = await loadCurrentProfile({ locals, cookies, fetch, apiBaseUrl });
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "community",
      principalId: locals.principalId,
      capabilities: locals.resolvedCapabilities,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "board",
      eyebrow: "Community",
      title: area.area.title,
      summary: area.area.description,
    }),
    discussion: {
      status: "ready",
      area: area.area,
      topics: Array.isArray(area.topics)
        ? area.topics.map((topic) => Object.freeze({
            ...topic,
            author: buildCommunityAuthorView(topic?.author),
          }))
        : [],
      nextCursor: optionalText(area.next_cursor),
      canPost: profile !== null,
      hasSession: typeof locals.principalId === "string",
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
  createTopic: async ({ locals, cookies, fetch, params, request }) => {
    const form = await request.formData();
    const response = await discussionMutation({
      cookies,
      locals,
      fetch,
      path: `/discussions/areas/${encodeURIComponent(params.slug)}/topics`,
      body: { title: text(form.get("title")), body: text(form.get("body")) },
    });
    if (!response.ok) {
      return discussionMutationFailure(response, "Unable to create discussion topic", {
        draft: { target: "topic", title: text(form.get("title")), body: text(form.get("body")) },
      });
    }
    const topic = await response.json();
    throw redirect(303, `/discussions/${encodeURIComponent(params.slug)}/t/${encodeURIComponent(topic.topic)}`);
  },
};

function unavailableData(slug, locals) {
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "community",
      principalId: locals.principalId,
      capabilities: locals.resolvedCapabilities,
    }),
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
      canPost: false,
      hasSession: typeof locals.principalId === "string",
      canModerate: false,
    },
  };
}

async function discussionMutation({ locals, cookies, fetch, path, body }) {
  const token = accessTokenForRequest({ locals, cookies });
  if (typeof token !== "string" || token.trim() === "") {
    return { ok: false, status: 401, json: async () => null };
  }
    const apiBaseUrl = serverApiBaseUrl();
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

async function loadJson(fetch, url, headers = { accept: "application/json" }) {
  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  const value = await response.json().catch(() => null);
  return value !== null && typeof value === "object" ? value : null;
}

function readHeaders(token) {
  return typeof token === "string" && token.trim() !== ""
    ? { authorization: `Bearer ${token}`, accept: "application/json" }
    : { accept: "application/json" };
}

async function loadCurrentProfile({ locals, cookies, fetch, apiBaseUrl }) {
  const token = accessTokenForRequest({ locals, cookies });
  if (typeof token !== "string" || token.trim() === "") return null;
  const response = await fetch(`${apiBaseUrl}/profiles/me/editor`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  const profile = response.ok ? await response.json().catch(() => null) : null;
  return profile?.visibility === "public" ? profile : null;
}

function optionalText(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function text(value) {
  return typeof value === "string" ? value : "";
}
