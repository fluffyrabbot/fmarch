import { fail } from "@sveltejs/kit";
import { buildAppShell } from "../../../lib/app/app-shell-model.mjs";
import { SESSION_COOKIE_NAME } from "../../../lib/server/session-capabilities.mjs";
import { buildPublicGamePublication } from "./public-game-publication.mjs";

export async function load({ params, locals, cookies, fetch, url }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const search = new URLSearchParams({ limit: "50" });
  const beforeSeq = optionalSequence(url.searchParams.get("before_seq"));
  if (beforeSeq !== null) search.set("before_seq", beforeSeq);
  const fixtureMode = process.env.FMARCH_FRONTEND_FIXTURE_SESSION === "1";
  const response = fixtureMode && apiBaseUrl === ""
    ? null
    : await fetch(`${apiBaseUrl}/games/${encodeURIComponent(params.game)}?${search}`);
  const page = fixtureMode && apiBaseUrl === ""
    ? fixturePublicGame(params.game)
    : response.ok ? await response.json().catch(() => null) : null;
  const available = page !== null && typeof page === "object";
  const subscription = available
    ? await loadSubscription({ cookies, fetch, apiBaseUrl, game: params.game })
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
      posts: page?.posts,
    }),
    publicGame: {
      status: available ? "ready" : "unavailable",
      game: available ? page.game : null,
      posts: Array.isArray(page?.posts) ? page.posts : [],
      nextBeforeSeq: optionalSequence(page?.next_before_seq),
      hasSession: typeof locals.principalUserId === "string",
      subscription,
    },
  };
}

export const actions = {
  watch: async ({ cookies, fetch, params, request }) => {
    const token = cookies.get(SESSION_COOKIE_NAME);
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
      `${apiBaseUrl}/subscriptions/game_thread/${encodeURIComponent(params.game)}`,
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

async function loadSubscription({ cookies, fetch, apiBaseUrl, game }) {
  const token = cookies.get(SESSION_COOKIE_NAME);
  if (typeof token !== "string" || token.trim() === "") return null;
  const response = await fetch(
    `${apiBaseUrl}/subscriptions/game_thread/${encodeURIComponent(game)}`,
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
