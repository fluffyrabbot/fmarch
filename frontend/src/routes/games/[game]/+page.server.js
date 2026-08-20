import { fail } from "@sveltejs/kit";
import { buildAppShell } from "../../../lib/app/app-shell-model.mjs";
import { accessTokenForRequest } from "../../../lib/server/session-capabilities.mjs";
import {
  GAME_CITATION_PREVIEW_LIMIT,
  buildPublicGamePosts,
  buildPublicGamePublication,
} from "./public-game-publication.mjs";

export async function load({ params, locals, cookies, fetch, url }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const token = accessTokenForRequest({ locals, cookies });
  const search = new URLSearchParams({ limit: "50" });
  const beforeSeq = optionalSequence(url.searchParams.get("before_seq"));
  if (beforeSeq !== null) search.set("before_seq", beforeSeq);
  const fixtureMode = process.env.FMARCH_FRONTEND_FIXTURE_SESSION === "1";
  const response = fixtureMode && apiBaseUrl === ""
    ? null
    : await fetch(`${apiBaseUrl}/games/${encodeURIComponent(params.game)}?${search}`, {
        headers: readHeaders(token),
      });
  const page = fixtureMode && apiBaseUrl === ""
    ? fixturePublicGame(params.game)
    : response.ok ? await response.json().catch(() => null) : null;
  const available = page !== null && typeof page === "object";
  const sourcePosts = available && Array.isArray(page.posts) ? page.posts : [];
  const citationPages = available
    ? await loadCitationPages({
        fetch,
        token,
        apiBaseUrl,
        game: params.game,
        posts: sourcePosts,
      })
    : {};
  const posts = available ? buildPublicGamePosts(sourcePosts, citationPages) : [];
  const subscription = available
    ? await loadSubscription({ locals, cookies, fetch, apiBaseUrl, game: params.game })
    : null;
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "board",
      principalUserId: locals.principalUserId,
      capabilities: locals.resolvedCapabilities,
    }),
    publication: buildPublicGamePublication({
      game: available ? page.game : null,
      posts,
    }),
    publicGame: {
      status: available ? "ready" : "unavailable",
      game: available ? page.game : null,
      posts,
      nextBeforeSeq: optionalSequence(page?.next_before_seq),
      hasSession: typeof locals.principalUserId === "string",
      subscription,
    },
  };
}

async function loadCitationPages({ fetch, token, apiBaseUrl, game, posts }) {
  const cited = (Array.isArray(posts) ? posts : []).filter(
    (post) => Number(post?.citation_count ?? post?.citationCount ?? 0) > 0,
  );
  const entries = await Promise.all(
    cited.map(async (post) => {
      const seq = Number(post.source_seq ?? post.sourceSeq);
      const response = await fetch(
        `${apiBaseUrl}/games/${encodeURIComponent(game)}/posts/${seq}/citations?limit=${GAME_CITATION_PREVIEW_LIMIT}`,
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
    const token = accessTokenForRequest({ locals, cookies });
    if (typeof token !== "string" || token.trim() === "") {
      return fail(401, { id: "public-game-watch", state: "reject", message: "Sign in to watch public games" });
    }
    const form = await request.formData();
    const action = text(form.get("watch_action"));
    if (!["subscribe", "unsubscribe"].includes(action)) {
      return fail(400, { id: "public-game-watch", state: "reject", message: "Invalid watch action" });
    }
    const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
    const response = await fetch(
      `${apiBaseUrl}/subscriptions/${encodeURIComponent(params.game)}`,
      {
        method: action === "subscribe" ? "PUT" : "DELETE",
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return fail([400, 401, 404, 409].includes(response.status) ? response.status : 502, {
        id: "public-game-watch",
        state: "reject",
        message: payload?.message ?? "Unable to update this watch",
      });
    }
    return {
      id: "public-game-watch",
      state: "ack",
      subscribed: payload.subscribed === true,
      message: payload.subscribed === true ? "Watching this public game" : "Game watch removed",
    };
  },
  report: async ({ locals, cookies, fetch, params, request }) => {
    const token = accessTokenForRequest({ locals, cookies });
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
        surface_id: params.game,
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

async function loadSubscription({ locals, cookies, fetch, apiBaseUrl, game }) {
  const token = accessTokenForRequest({ locals, cookies });
  if (typeof token !== "string" || token.trim() === "") return null;
  const response = await fetch(
    `${apiBaseUrl}/subscriptions/${encodeURIComponent(game)}`,
    { headers: { authorization: `Bearer ${token}`, accept: "application/json" } },
  );
  return response.ok ? response.json().catch(() => null) : null;
}

function optionalSequence(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function fixturePublicGame(game) {
  return Object.freeze({
    game: Object.freeze({ game, pack: "mafiascum", status: "active", phase_id: "D02" }),
    posts: Object.freeze([
      Object.freeze({ source_seq: 42, author_slot: "slot_2", author_user: "Ilya", body: "The public record stays readable when the game gets complicated.", occurred_at: 1784707200 }),
      Object.freeze({ source_seq: 41, author_slot: "slot_7", author_user: "Mira", body: "One conversation, in chronological context.", occurred_at: 1784703600 }),
    ]),
    next_before_seq: 41,
  });
}
