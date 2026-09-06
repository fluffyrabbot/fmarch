import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPrivateAttention } from "./private-attention.mjs";

test("private review status loads under the current session and failure stays distinct from new", async () => {
  const calls = [];
  const args = { game: "game-1", enabled: true, fixtureMode: false, apiBaseUrl: "https://api.example", cookies: { get: () => "session" } };
  const ready = await loadPrivateAttention({ ...args, fetch: async (url, init) => {
    calls.push({ url, init });
    return Response.json({ reviewed_ids: ["slot-mention-41-slot-7"] });
  } });
  assert.deepEqual(ready, { state: "ready", reviewedIds: ["slot-mention-41-slot-7"] });
  assert.equal(calls[0].url, "https://api.example/games/game-1/private-attention");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer session");
  assert.deepEqual(await loadPrivateAttention({ ...args, fetch: async () => new Response(null, { status: 503 }) }), { state: "unavailable", reviewedIds: [] });
  await loadPrivateAttention({ ...args, enabled: false, fetch: () => assert.fail("unseated reader must not fetch receipts") });
});
