import assert from "node:assert/strict";
import test from "node:test";
import { actions, load } from "./+page.server.js";

test("public game route loads quote blocks and citation disclosure without a Quote control", async () => {
  const requests = [];
  const data = await load({
    params: { game: "00000000-0000-0000-0000-000000000001" },
    locals: { principalId: null, resolvedCapabilities: [] },
    cookies: { get: () => undefined },
    url: new URL("http://localhost/games/00000000-0000-0000-0000-000000000001"),
    fetch: async (url) => {
      requests.push(String(url));
      if (String(url).includes("/citations")) {
        return Response.json({
          pages: [{
            quoted_surface_id: "00000000-0000-0000-0000-000000000001",
            quoted_source_seq: 4,
            citations: [{ quoting_surface_id: "00000000-0000-0000-0000-000000000001", quoting_source_seq: 8, occurred_at: 6 }],
            citation_count: 1,
          }],
        });
      }
      return {
        ok: true,
        json: async () => ({
          game: { game: "00000000-0000-0000-0000-000000000001", pack: "mafiascum", status: "active", phase_id: "D01" },
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
  assert.ok(requests.includes("/games/00000000-0000-0000-0000-000000000001/citations?source_seqs=4&limit=5"));
  assert.equal(data.publicGame.posts[0].incomingCitations[0].href,
    "/games/00000000-0000-0000-0000-000000000001?post=8#thread-post-8");
  assert.equal(
    requests.some((url) => url.includes("quote=")),
    false,
  );
});

const gameId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const routeContext = (overrides = {}) => ({
  params: { game: gameId },
  locals: { principalId: null, resolvedCapabilities: [] },
  cookies: { get: () => undefined },
  url: new URL(`http://localhost/games/${gameId}`),
  ...overrides,
});
const publicThread = (posts) => ({
  game: { game: gameId, pack: "mafiascum", status: "active", phase_id: "D01" },
  posts,
  next_before_seq: null,
  next_after_seq: null,
});

test("50 cited public posts use one authenticated batch and its current counts", async () => {
  const posts = Array.from({ length: 50 }, (_, index) => ({ source_seq: index + 1, citation_count: 7 }));
  const batches = [];
  const data = await load(routeContext({
    cookies: { get: () => "member-session" },
    fetch: async (url, options) => {
      if (url === `/games/${gameId}?limit=50`) return Response.json(publicThread(posts));
      if (url === `/subscriptions/${gameId}`) return Response.json(null);
      batches.push({ url, options });
      return Response.json({ pages: posts.map((post) => ({
        quoted_surface_id: gameId,
        quoted_source_seq: post.source_seq,
        citation_count: 2,
        citations: [{ quoting_surface_id: gameId, quoting_source_seq: 80, occurred_at: 2 }],
      })) });
    },
  }));
  assert.equal(batches.length, 1);
  const url = new URL(batches[0].url, "http://localhost");
  assert.equal(url.pathname, `/games/${gameId}/citations`);
  assert.equal(url.searchParams.get("source_seqs"), posts.map((post) => post.source_seq).join(","));
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal(batches[0].options.headers.authorization, "Bearer member-session");
  for (const post of data.publicGame.posts) {
    assert.equal(post.citationCount, 2);
    assert.equal(post.moreCitationCount, 1);
    assert.equal(post.incomingCitations[0].href, `/games/${gameId}?post=80#thread-post-80`);
  }
});

test("uncited public pages make no citation request", async () => {
  const requests = [];
  await load(routeContext({ fetch: async (url) => {
    requests.push(url);
    assert.equal(url, `/games/${gameId}?limit=50`);
    return Response.json(publicThread([{ source_seq: 40, citation_count: 0 }]));
  } }));
  assert.equal(requests.length, 1);
});

test("missing and zero-count targets suppress stale counts and locally visible quotation edges", async () => {
  const data = await load(routeContext({ fetch: async (url) => {
    if (url === `/games/${gameId}?limit=50`) return Response.json(publicThread([
      { source_seq: 40, citation_count: 7 },
      { source_seq: 80, citation_count: 3 },
      { source_seq: 90, quotations: [
        { target: { source_seq: 40 }, excerpt: "Earlier target" },
        { target: { source_seq: 80 }, excerpt: "Later target" },
      ] },
    ]));
    assert.equal(url, `/games/${gameId}/citations?source_seqs=40%2C80&limit=5`);
    return Response.json({ pages: [{
      quoted_surface_id: gameId, quoted_source_seq: 80, citation_count: 0, citations: [],
    }] });
  } }));
  for (const post of data.publicGame.posts) {
    assert.equal(post.citationCount, 0);
    assert.equal(post.moreCitationCount, 0);
    assert.deepEqual(post.incomingCitations, []);
  }
});

test("canonical loaded game identity owns batch matching and off-page post resolution", async () => {
  const requestedId = gameId.toUpperCase();
  const data = await load(routeContext({
    params: { game: requestedId },
    url: new URL(`http://localhost/games/${requestedId}?before_seq=50`),
    fetch: async (url) => {
      if (url === `/games/${requestedId}?limit=50&before_seq=50`) {
        return Response.json(publicThread([{ source_seq: 40, citation_count: 1 }]));
      }
      assert.equal(url, `/games/${gameId}/citations?source_seqs=40&limit=5`);
      return Response.json({ pages: [{
        quoted_surface_id: gameId, quoted_source_seq: 40, citation_count: 1,
        citations: [{ quoting_surface_id: gameId, quoting_source_seq: 80, occurred_at: 2 }],
      }] });
    },
  }));
  const href = data.publicGame.posts[0].incomingCitations[0].href;
  assert.equal(href, `/games/${gameId}?post=80#thread-post-80`);
  const addressed = await load(routeContext({
    url: new URL(href, "http://localhost"),
    fetch: async (url) => {
      assert.equal(url, `/games/${gameId}?limit=50&around_seq=80`);
      return Response.json(publicThread([{ source_seq: 80, body: "Quoted reply" }]));
    },
  }));
  assert.equal(addressed.publicGame.posts[0].source_seq, 80);
});

test("public game route exposes only canonical public thread data", async () => {
  const data = await load({
    params: { game: "00000000-0000-0000-0000-000000000001" },
    locals: { principalId: null, resolvedCapabilities: [] },
    cookies: { get: () => undefined },
    url: new URL("http://localhost/games/00000000-0000-0000-0000-000000000001"),
    fetch: async () => ({
      ok: true,
      json: async () => ({
        game: { game: "00000000-0000-0000-0000-000000000001", pack: "mafiascum", status: "active", phase_id: "D01" },
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

test("addressed public originals fail closed when the authorized page omits the target", async () => {
  await assert.rejects(load(routeContext({
    url: new URL(`http://localhost/games/${gameId}?post=3`),
    fetch: async () => Response.json(publicThread([{ source_seq: 4, body: "Neighbor" }])),
  })), error => error.status === 404);
});
