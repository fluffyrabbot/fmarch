import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./+page.server.js";

test("public game route exposes only canonical public thread data", async () => {
  const data = await load({
    params: { game: "00000000-0000-0000-0000-000000000001" },
    locals: { principalUserId: null, resolvedCapabilities: [] },
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
