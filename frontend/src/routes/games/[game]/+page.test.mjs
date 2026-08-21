import assert from "node:assert/strict";
import test from "node:test";
import { actions, load } from "./+page.server.js";

test("public game route loads quote blocks and citation disclosure without a Quote control", async () => {
  const requests = [];
  const data = await load({
    params: { game: "00000000-0000-0000-0000-000000000001" },
    locals: { principalUserId: null, resolvedCapabilities: [] },
    cookies: { get: () => undefined },
    url: new URL("http://localhost/games/00000000-0000-0000-0000-000000000001"),
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url).includes("/citations")) {
        return Response.json({
          quoted: { kind: "game_post", scope_id: "00000000-0000-0000-0000-000000000001", source_seq: 4 },
          citations: [{ quoting: { kind: "game_post", scope_id: "00000000-0000-0000-0000-000000000001", source_seq: 8 }, occurred_at: 6 }],
          citation_count: 1,
        });
      }
      return {
        ok: true,
        json: async () => ({
          game: { game: "00000000-0000-0000-0000-000000000001", pack: "mafiascum", status: "active", phase_id: "day-1" },
          posts: [
            {
              source_seq: 4,
              author: { kind: "slot", slot_id: "slot-1" },
              body: "Public signal",
              quotations: [],
              citation_count: 1,
              occurred_at: 5,
            },
            {
              source_seq: 8,
              author: { kind: "slot", slot_id: "slot-2" },
              body: "Answering that claim",
              quotations: [{
                target: { kind: "game_post", scope_id: "00000000-0000-0000-0000-000000000001", source_seq: 4 },
                excerpt: "Public signal",
              }],
              citation_count: 0,
              occurred_at: 6,
            },
          ],
          next_before_seq: null,
        }),
      };
    },
  });

  assert.equal(data.publicGame.posts[0].citationCount, 1);
  assert.equal(data.publicGame.posts[0].incomingCitations[0].sourceSeq, 8);
  assert.equal(data.publicGame.posts[1].quotations[0].excerpt, "Public signal");
  assert.equal(data.publicGame.posts[1].quotations[0].authorLabel, "slot-1");
  assert.ok(requests.some((url) => url.includes("/posts/4/citations?limit=5")));
  assert.equal(
    requests.some((url) => url.includes("quote=")),
    false,
  );
});

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
        posts: [{ source_seq: 4, author: { kind: "slot", slot_id: "slot-1" }, body: "Public signal", occurred_at: 5 }],
        next_before_seq: 4,
      }),
    }),
  });
  assert.equal(data.publicGame.status, "ready");
  assert.equal(data.publicGame.posts[0].body, "Public signal");
  assert.equal(data.shell.activeSurface, "board");
  assert.equal(data.publication.root.data.mode, "reading-publication");
  assert.equal(data.publication.readingLane.postCountLabel, "1 public post");
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
    surface_id: "00000000-0000-0000-0000-000000000001",
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
    url: "/subscriptions/00000000-0000-0000-0000-000000000001",
    method: "PUT",
  });
  assert.equal(result.subscribed, true);
});
