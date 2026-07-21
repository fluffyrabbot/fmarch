import assert from "node:assert/strict";
import test from "node:test";
import { actions, load } from "./+page.server.js";

test("public game route exposes only canonical public thread data", async () => {
  const data = await load({
    params: { game: "00000000-0000-0000-0000-000000000001" },
    locals: { principalUserId: null, resolvedCapabilities: [] },
    cookies: { get: () => undefined },
    url: new URL("http://localhost/games/00000000-0000-0000-0000-000000000001"),
    fetch: async () => ({
      ok: true,
      json: async () => ({
        game: { game: "00000000-0000-0000-0000-000000000001", pack: "mafiascum", status: "active", phase_id: "day-1" },
        posts: [{ source_seq: 4, author_slot: "slot-1", author_user: null, body: "Public signal", occurred_at: 5 }],
        next_before_seq: 4,
      }),
    }),
  });
  assert.equal(data.publicGame.status, "ready");
  assert.equal(data.publicGame.posts[0].body, "Public signal");
  assert.equal(data.shell.activeSurface, "board");
});

test("signed-in public game report maps only the canonical public post target", async () => {
  let mutation;
  const result = await actions.report({
    cookies: { get: () => "member-session" },
    params: { game: "00000000-0000-0000-0000-000000000001" },
    request: new Request("http://localhost/games/demo?/report", {
      method: "POST",
      body: new URLSearchParams({ source_seq: "41", reason_family: "spam", details: "repeated link" }),
    }),
    fetch: async (url, options) => {
      mutation = { url, options, body: JSON.parse(options.body) };
      return Response.json({ report_id: "report-1", status: "received", submitted_at: 1 }, { status: 201 });
    },
  });
  assert.equal(mutation.url, "/moderation/reports");
  assert.deepEqual(mutation.body, {
    target_kind: "game_post",
    scope_id: "00000000-0000-0000-0000-000000000001",
    source_seq: 41,
    reason_family: "spam",
    details: "repeated link",
  });
  assert.equal(result.reportId, "report-1");
});

test("signed-in public game watch uses the typed game-thread endpoint", async () => {
  let mutation;
  const result = await actions.watch({
    cookies: { get: () => "member-session" },
    params: { game: "00000000-0000-0000-0000-000000000001" },
    request: new Request("http://localhost/games/demo?/watch", {
      method: "POST",
      body: new URLSearchParams({ watch_action: "subscribe" }),
    }),
    fetch: async (url, options) => {
      mutation = { url, method: options.method };
      return Response.json({ subscribed: true });
    },
  });
  assert.deepEqual(mutation, {
    url: "/subscriptions/game_thread/00000000-0000-0000-0000-000000000001",
    method: "PUT",
  });
  assert.equal(result.subscribed, true);
});
