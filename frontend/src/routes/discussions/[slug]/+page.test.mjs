import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./+page.server.js";

const topic = "00000000-0000-0000-0000-000000000111";

test("discussion area loads public authorship and exposes canonical community navigation", async () => {
  const requests = [];
  const data = await load({
    params: { slug: "general" },
    locals: {
      principalId: "member_a",
      resolvedCapabilities: [{ kind: "GlobalMod", source: "auth-session" }],
    },
    fetch: async (url) => {
      requests.push(url);
      if (url === "/discussions/areas/general?limit=12") {
        return Response.json({
          area: { slug: "general", title: "General", description: "Public discussion" },
          topics: [{
            topic,
            title: "Welcome",
            author: { handle: "member_a", display_name: "Member A" },
            posting_state: "open",
            visibility: "visible",
            post_count: 1,
            updated_seq: 3,
          }],
          next_cursor: null,
        });
      }
      assert.equal(url, "/profiles/me/editor");
      return Response.json({ handle: "member_a", visibility: "public" });
    },
    cookies: { get: () => "session-token" },
    url: new URL("https://fmarch.local/discussions/general"),
  });

  assert.deepEqual(requests, [
    "/discussions/areas/general?limit=12",
    "/profiles/me/editor",
  ]);
  assert.equal(data.discussion.status, "ready");
  assert.equal(data.discussion.canPost, true);
  assert.equal(data.discussion.canModerate, true);
  assert.equal(data.discussion.topics[0].author.handle, "member_a");
  assert.equal(data.shell.activeSurface, "community");
});

test("discussion route keeps unavailable data explicit and does not invent moderation", async () => {
  const data = await load({
    params: { slug: "general" },
    locals: { principalId: null, resolvedCapabilities: [] },
    cookies: { get: () => undefined },
    fetch: async () => new Response(null, { status: 503 }),
    url: new URL("https://fmarch.local/discussions/general"),
  });

  assert.equal(data.discussion.status, "unavailable");
  assert.equal(data.discussion.canPost, false);
  assert.equal(data.discussion.canModerate, false);
});
