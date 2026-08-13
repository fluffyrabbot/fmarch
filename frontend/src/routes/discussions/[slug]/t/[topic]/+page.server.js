import { fail, redirect } from "@sveltejs/kit";
import { buildAppShell } from "../../../../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../../../../lib/app/app-surface-header-model.mjs";
import { hasCapability } from "../../../../../lib/app/capabilities.mjs";
import { accessTokenForRequest } from "../../../../../lib/server/session-capabilities.mjs";
import {
  DISCUSSION_CITATION_PREVIEW_LIMIT,
  buildDiscussionThreadView,
  parseQuoteSeqs,
  parseSubmittedQuotations,
} from "./discussion-thread-model.mjs";

export async function load({ params, locals, cookies, fetch, url }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const token = accessTokenForRequest({ locals, cookies });
  const search = new URLSearchParams({ limit: "50" });
  const beforeSeq = optionalSequence(url.searchParams.get("before_seq"));
  if (beforeSeq !== null) search.set("before_seq", beforeSeq);
  const response = await fetch(
    `${apiBaseUrl}/discussions/areas/${encodeURIComponent(params.slug)}/topics/${encodeURIComponent(params.topic)}?${search}`,
    { headers: readHeaders(token) },
  );
  const thread = response.ok ? await response.json().catch(() => null) : null;
  const profile = await loadCurrentProfile({ locals, cookies, fetch, apiBaseUrl });
  const subscription = thread === null
    ? null
    : await loadSubscription({
        cookies,
        locals,
        fetch,
        apiBaseUrl,
        targetKind: "discussion_topic",
        scopeId: params.topic,
      });
  const canPost = profile !== null;
  const citationPages = thread === null
    ? {}
    : await loadCitationPages({
        fetch,
        token,
        apiBaseUrl,
        topic: params.topic,
        posts: thread.posts,
      });
  const view = thread === null
    ? { posts: [], attachedQuotations: [], quotationsJson: "[]", quoteEnabled: false }
    : buildDiscussionThreadView({
        thread,
        quoteSeqs: parseQuoteSeqs(url.searchParams),
        citationPages,
        canPost,
        slug: params.slug,
        topicId: params.topic,
        beforeSeq,
      });
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
      posts: view.posts,
      attachedQuotations: view.attachedQuotations,
      quotationsJson: view.quotationsJson,
      quoteEnabled: view.quoteEnabled,
      canPost,
      hasSession: typeof locals.principalUserId === "string",
      subscription,
      canModerate: hasCapability({ capabilities: locals.resolvedCapabilities, kind: "GlobalMod" })
        || hasCapability({ capabilities: locals.resolvedCapabilities, kind: "GlobalAdmin" }),
    },
  };
}

async function loadCitationPages({ fetch, token, apiBaseUrl, topic, posts }) {
  const cited = (Array.isArray(posts) ? posts : []).filter(
    (post) => Number(post?.citation_count ?? 0) > 0,
  );
  const entries = await Promise.all(
    cited.map(async (post) => {
      const seq = Number(post.source_seq);
      const response = await fetch(
        `${apiBaseUrl}/discussions/topics/${encodeURIComponent(topic)}/posts/${seq}/citations?limit=${DISCUSSION_CITATION_PREVIEW_LIMIT}`,
        { headers: readHeaders(token) },
      );
      const page = response.ok ? await response.json().catch(() => null) : null;
      return [seq, page];
    }),
  );
  return Object.fromEntries(entries.filter(([, page]) => page !== null));
}

function readHeaders(token) {
  return typeof token === "string" && token.trim() !== ""
    ? { authorization: `Bearer ${token}`, accept: "application/json" }
    : { accept: "application/json" };
}

export const actions = {
  watch: async ({ locals, cookies, fetch, params, request }) => {
    const form = await request.formData();
    const action = text(form.get("watch_action"));
    if (!["subscribe", "unsubscribe"].includes(action)) {
      return fail(400, { id: "discussion-watch", state: "reject", message: "Invalid watch action" });
    }
    const response = await mutation({
      cookies,
      locals,
      fetch,
      path: `/subscriptions/discussion_topic/${encodeURIComponent(params.topic)}`,
      method: action === "subscribe" ? "PUT" : "DELETE",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return fail([400, 401, 404, 409].includes(response.status) ? response.status : 502, {
        id: "discussion-watch",
        state: "reject",
        message: payload?.message ?? "Unable to update this watch",
      });
    }
    return {
      id: "discussion-watch",
      state: "ack",
      subscribed: payload.subscribed === true,
      message: payload.subscribed === true ? "Watching this topic" : "Topic watch removed",
    };
  },
  report: async ({ locals, cookies, fetch, params, request }) => {
    const form = await request.formData();
    const sourceSeq = optionalSequence(form.get("source_seq"));
    if (sourceSeq === null) {
      return fail(400, { id: "discussion-report", state: "reject", message: "Invalid discussion post" });
    }
    const response = await mutation({
      cookies,
      locals,
      fetch,
      path: "/moderation/reports",
      body: {
        target_kind: "discussion_post",
        scope_id: params.topic,
        source_seq: Number(sourceSeq),
        reason_family: text(form.get("reason_family")),
        details: text(form.get("details")),
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return fail([400, 401, 404, 409, 429].includes(response.status) ? response.status : 502, {
        id: "discussion-report",
        state: "reject",
        message: payload?.message ?? "Unable to submit report",
      });
    }
    return {
      id: "discussion-report",
      state: "ack",
      reportId: payload.report_id,
      sourceSeq,
      message: "Report received. Your receipt is private to this account.",
    };
  },
  createPost: async ({ locals, cookies, fetch, params, request }) => {
    const form = await request.formData();
    const quotations = parseSubmittedQuotations(form, params.topic);
    const response = await mutation({
      cookies,
      locals,
      fetch,
      path: `/discussions/topics/${encodeURIComponent(params.topic)}/posts`,
      body: { body: text(form.get("body")), quotations },
    });
    if (!response.ok) return mutationFailure(response, "Unable to post discussion reply");
    const topic = await response.json();
    const anchor = topic.last_post_seq === null ? "" : `#post-${topic.last_post_seq}`;
    throw redirect(303, `/discussions/${encodeURIComponent(params.slug)}/t/${encodeURIComponent(params.topic)}${anchor}`);
  },
  postingState: async ({ locals, cookies, fetch, params, request }) => {
    const form = await request.formData();
    const response = await mutation({
      cookies,
      locals,
      fetch,
      path: `/discussions/topics/${encodeURIComponent(params.topic)}/moderation`,
      body: { posting_state: text(form.get("posting_state")) },
    });
    if (!response.ok) return mutationFailure(response, "Unable to update topic posting state");
    throw redirect(303, `/discussions/${encodeURIComponent(params.slug)}/t/${encodeURIComponent(params.topic)}`);
  },
  visibility: async ({ locals, cookies, fetch, params, request }) => {
    const form = await request.formData();
    const visibility = text(form.get("visibility"));
    const response = await mutation({
      cookies,
      locals,
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

async function loadCurrentProfile({ locals, cookies, fetch, apiBaseUrl }) {
  const token = accessTokenForRequest({ locals, cookies });
  if (typeof token !== "string" || token.trim() === "") return null;
  const response = await fetch(`${apiBaseUrl}/profiles/me/editor`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  const profile = response.ok ? await response.json().catch(() => null) : null;
  return profile?.visibility === "public" ? profile : null;
}

async function loadSubscription({ locals, cookies, fetch, apiBaseUrl, targetKind, scopeId }) {
  const token = accessTokenForRequest({ locals, cookies });
  if (typeof token !== "string" || token.trim() === "") return null;
  const response = await fetch(
    `${apiBaseUrl}/subscriptions/${encodeURIComponent(targetKind)}/${encodeURIComponent(scopeId)}`,
    { headers: { authorization: `Bearer ${token}`, accept: "application/json" } },
  );
  return response.ok ? response.json().catch(() => null) : null;
}

async function mutation({ locals, cookies, fetch, path, body = undefined, method = "POST" }) {
  const token = accessTokenForRequest({ locals, cookies });
  if (typeof token !== "string" || token.trim() === "") {
    return { ok: false, status: 401, json: async () => null };
  }
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  return fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
