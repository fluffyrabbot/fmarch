import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./+page.server.js";

const locals = { principalUserId: null, resolvedCapabilities: [] };

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
          results: [{ kind: "discussion_post", title: "Reply in Signals", excerpt: "signal body", href: "/discussions/general/t/topic#post-4", published_at: 7 }],
          next_cursor: "9:7:discussion_post:key",
        }),
      };
    },
  });
  assert.match(requests[0], /\/search\?q=signal&filter=discussions&limit=20/);
  assert.equal(data.shell.activeSurface, "search");
  assert.equal(data.search.status, "ready");
  assert.equal(data.search.results[0].href, "/discussions/general/t/topic#post-4");
  assert.match(data.search.nextHref, /cursor=9%3A7%3Adiscussion_post%3Akey/);
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
