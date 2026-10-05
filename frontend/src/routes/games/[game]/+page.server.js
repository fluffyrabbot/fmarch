import { requestedPost } from "../../../lib/app/post-address.mjs";
import { error, fail } from "@sveltejs/kit";
import { buildAppShell } from "../../../lib/app/app-shell-model.mjs";
import { serverApiBaseUrl } from "../../../lib/server/api-base.mjs";
import { frontendFixtureMode } from "../../../lib/server/runtime-mode.mjs";
import { accessTokenForRequest } from "../../../lib/server/session-capabilities.mjs";
import {
  GAME_CITATION_PREVIEW_LIMIT,
  buildPublicGamePosts,
  buildPublicGamePublication,
} from "./public-game-publication.mjs";

export async function load({ params, locals, cookies, fetch, url }) {
  const apiBaseUrl = serverApiBaseUrl();
  const token = accessTokenForRequest({ locals, cookies });
  const search = new URLSearchParams({ limit: "50" });
  let aroundSeq;
  try { aroundSeq = requestedPost(url); } catch { throw error(400, "Invalid post address"); }
  if (aroundSeq !== null) search.set("around_seq", aroundSeq);
  const afterSeq = optionalSequence(url.searchParams.get("after_seq"));
  if (afterSeq !== null) search.set("after_seq", afterSeq);
  const beforeSeq = optionalSequence(url.searchParams.get("before_seq"));
  if (beforeSeq !== null) search.set("before_seq", beforeSeq);
  const fixtureMode = frontendFixtureMode();
  const response = fixtureMode && apiBaseUrl === ""
    ? null
    : await fetch(`${apiBaseUrl}/games/${encodeURIComponent(params.game)}?${search}`, {
        headers: readHeaders(token),
      });
  if (aroundSeq !== null && response && !response.ok) throw error(response.status, "This post is unavailable.");
  const page = fixtureMode && apiBaseUrl === ""
    ? fixturePublicGame(params.game)
    : response.ok ? await response.json().catch(() => null) : null;
  const available = page !== null && typeof page === "object";
  const gameId = page?.game?.game;
  const sourcePosts = available && Array.isArray(page.posts) ? page.posts : [];
  if (aroundSeq !== null && available && !sourcePosts.some(post => String(post.source_seq) === aroundSeq)) {
    throw error(404, "This post is unavailable.");
  }
  const citationPages = available
    ? await loadCitationPages({
        fetch,
        token,
        apiBaseUrl,
        game: gameId,
        posts: sourcePosts,
      })
    : {};
  const posts = available ? buildPublicGamePosts(sourcePosts, citationPages, gameId) : [];
  const subscription = available
    ? await loadSubscription({ locals, cookies, fetch, apiBaseUrl, game: gameId })
    : null;
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "board",
      principalId: locals.principalId,
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
      nextAfterSeq: optionalSequence(page?.next_after_seq),
      hasSession: typeof locals.principalId === "string",
      subscription,
    },
  };
}

async function loadCitationPages({ fetch, token, apiBaseUrl, game, posts }) {
  const cited = [...new Set(
    (Array.isArray(posts) ? posts : [])
      .filter((post) => Number(post?.citation_count ?? 0) > 0)
      .map((post) => Number(post.source_seq))
      .filter((seq) => Number.isSafeInteger(seq) && seq > 0),
  )].slice(0, 50);
  if (cited.length === 0) return {};
  const search = new URLSearchParams({
    source_seqs: cited.join(","),
    limit: String(GAME_CITATION_PREVIEW_LIMIT),
  });
  const response = await fetch(
    `${apiBaseUrl}/games/${encodeURIComponent(game)}/citations?${search}`,
    { headers: readHeaders(token) },
  );
  const batch = response.ok ? await response.json().catch(() => null) : null;
  return Object.fromEntries(
    (Array.isArray(batch?.pages) ? batch.pages : [])
      .filter((page) => page?.quoted_surface_id === game && cited.includes(page.quoted_source_seq))
      .map((page) => [page.quoted_source_seq, page]),
  );
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
    const apiBaseUrl = serverApiBaseUrl();
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
    const apiBaseUrl = serverApiBaseUrl();
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
      Object.freeze({ source_seq: 42, author: Object.freeze({ kind: "slot", slot_id: "slot_2" }), body: "The public record stays readable when the game gets complicated.", occurred_at: 1784707200 }),
      Object.freeze({ source_seq: 41, author: Object.freeze({ kind: "slot", slot_id: "slot_7" }), body: "One conversation, in chronological context.", occurred_at: 1784703600 }),
    ]),
    next_before_seq: 41,
  });
}
