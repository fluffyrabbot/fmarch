import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./+page.server.js";

const topic = "00000000-0000-0000-0000-000000000111";

test("canonical discussion topic keeps area scope, bylines, and older-post cursor", async () => {
  const requests = [];
  const data = await load({
    params: { slug: "general", topic },
    locals: {
      principalUserId: "member_a",
      resolvedCapabilities: [{ kind: "GlobalMod", source: "auth-session" }],
    },
    cookies: { get: () => "session-token" },
    fetch: async (url) => {
      requests.push(url);
      if (url === `/discussions/areas/general/topics/${topic}?limit=50&before_seq=41`) {
        return Response.json({
          area: { slug: "general", title: "General", description: "Public discussion" },
          topic: {
            topic,
            title: "Welcome",
            author: { handle: "member_a", display_name: "Member A" },
            posting_state: "open",
            visibility: "visible",
            post_count: 52,
            updated_seq: 80,
            last_post_seq: 80,
          },
          posts: [{
            source_seq: 40,
            author: { handle: "member_a", display_name: "Member A" },
            body: "Older opening",
            created_at: 1_800_000_000,
          }],
          next_before_seq: 20,
        });
      }
      assert.equal(url, "/profiles/me/editor");
      return Response.json({ handle: "member_a", visibility: "public" });
    },
    url: new URL(`https://fmarch.local/discussions/general/t/${topic}?before_seq=41`),
  });

  assert.deepEqual(requests, [
    `/discussions/areas/general/topics/${topic}?limit=50&before_seq=41`,
    "/profiles/me/editor",
  ]);
  assert.equal(data.discussion.thread.posts[0].author.handle, "member_a");
  assert.equal(data.discussion.thread.next_before_seq, 20);
  assert.equal(data.discussion.canPost, true);
  assert.equal(data.discussion.canModerate, true);
});

test("canonical discussion topic keeps wrong-area and hidden responses unavailable", async () => {
  const data = await load({
    params: { slug: "wrong", topic },
    locals: { principalUserId: null, resolvedCapabilities: [] },
    cookies: { get: () => undefined },
    fetch: async () => new Response(null, { status: 404 }),
    url: new URL(`https://fmarch.local/discussions/wrong/t/${topic}`),
  });
  assert.equal(data.discussion.status, "unavailable");
  assert.equal(data.discussion.canPost, false);
});
