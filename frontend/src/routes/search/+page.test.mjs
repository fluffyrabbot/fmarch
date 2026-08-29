import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./+page.server.js";

const locals = { principalId: null, resolvedCapabilities: [] };

test("public search preserves filter, ranked result links, and stable cursor", async () => {
  const requests = [];
  const data = await load({
    locals,
    url: new URL("http://localhost/search?q=signal&filter=discussions"),
    fetch: async (url) => {
      requests.push(String(url));
      return {
        ok: true,
        json: async () => ({
          results: [{ kind: "discussion_post", title: "Reply in Signals", excerpt: [{ text: "signal", highlighted: true }, { text: " body", highlighted: false }], href: "/discussions/general/t/topic#post-4", published_at: 7 }],
          next_cursor: "opaque-cursor",
        }),
      };
    },
  });
  assert.match(requests[0], /\/search\?q=signal&filter=discussions&limit=20/);
  assert.equal(data.shell.activeSurface, "search");
  assert.equal(data.search.status, "ready");
  assert.equal(data.search.results[0].href, "/discussions/general/t/topic#post-4");
  assert.match(data.search.nextHref, /cursor=opaque-cursor/);
});

test("public search ignores a stale cookie after identity resolution falls back to anonymous", async () => {
  let headers;
  const data = await load({
    locals,
    cookies: { get: () => "stale-session" },
    url: new URL("http://localhost/search?q=signal"),
    fetch: async (_url, init) => {
      headers = new Headers(init.headers);
      return {
        ok: true,
        json: async () => ({ results: [], next_cursor: null }),
      };
    },
  });
  assert.equal(headers.has("authorization"), false);
  assert.equal(data.search.status, "ready");
});

test("public search distinguishes a stale cursor from service unavailability", async () => {
  const data = await load({
    locals,
    url: new URL("http://localhost/search?q=signal&filter=games&cursor=stale"),
    fetch: async () => ({ ok: false, status: 400 }),
  });
  assert.equal(data.search.status, "invalid-cursor");
  assert.deepEqual(data.search.results, []);
});

test("public search does not call the API before a valid query", async () => {
  let called = false;
  const data = await load({
    locals,
    url: new URL("http://localhost/search?q=x"),
    fetch: async () => { called = true; },
  });
  assert.equal(called, false);
  assert.equal(data.search.status, "invalid");
  assert.deepEqual(data.search.results, []);
});
