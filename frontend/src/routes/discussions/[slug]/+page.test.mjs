import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./+page.server.js";

const topic = "00000000-0000-0000-0000-000000000111";

test("discussion route loads real public pages and exposes GlobalMod controls", async () => {
  const requests = [];
  const data = await load({
    params: { slug: "general" },
    locals: {
      principalUserId: "member_a",
      resolvedCapabilities: [{ kind: "GlobalMod", source: "auth-session" }],
    },
    fetch: async (url) => {
      requests.push(url);
      if (url === "/discussions/areas/general?limit=12") {
        return Response.json({
          area: { slug: "general", title: "General", description: "Public discussion" },
          topics: [{ topic, title: "Welcome", status: "open", post_count: 1, updated_seq: 3 }],
          next_cursor: null,
        });
      }
      assert.equal(url, `/discussions/topics/${topic}?limit=50`);
      return Response.json({
        topic: { topic, title: "Welcome", status: "open", post_count: 1, updated_seq: 3 },
        posts: [{ source_seq: 3, body: "Opening" }],
        next_before_seq: null,
      });
    },
    url: new URL(`https://fmarch.local/discussions/general?topic=${topic}`),
  });

  assert.deepEqual(requests, [
    "/discussions/areas/general?limit=12",
    `/discussions/topics/${topic}?limit=50`,
  ]);
  assert.equal(data.discussion.status, "ready");
  assert.equal(data.discussion.canPost, true);
  assert.equal(data.discussion.canModerate, true);
  assert.equal(data.discussion.thread.posts[0].body, "Opening");
});

test("discussion route keeps unavailable data explicit and does not invent moderation", async () => {
  const data = await load({
    params: { slug: "general" },
    locals: { principalUserId: null, resolvedCapabilities: [] },
    fetch: async () => new Response(null, { status: 503 }),
    url: new URL("https://fmarch.local/discussions/general"),
  });

  assert.equal(data.discussion.status, "unavailable");
  assert.equal(data.discussion.canPost, false);
  assert.equal(data.discussion.canModerate, false);
});
