import assert from "node:assert/strict";
import { test } from "node:test";
import { privateItemId, fetchPrivateAttention } from "./private-attention.mjs";
import { buildPrivateQueueRouteItems } from "../../routes/g/[game]/game-route-model.mjs";

test("private delivery identity survives reorder and changes across seats and phases", () => {
  const row = { phase_id: "N02", event_index: 0, audience_slot: "slot-7" };
  assert.equal(privateItemId("notification", row), "notification-N02-0-slot-7");
  assert.notEqual(privateItemId("notification", row), privateItemId("notification", { ...row, event_index: 1 }));
  assert.notEqual(privateItemId("notification", row), privateItemId("investigation", row));
  assert.notEqual(privateItemId("notification", row), privateItemId("notification", { ...row, audience_slot: "slot-8" }));
});

test("a private mention opens its source channel and addressed post", () => {
  const mentions = [{ source_seq: 20, audience_slot: "slot-7", channel_id: "private:role_pm:slot-7", phase_id: "N02" }];
  const item = buildPrivateQueueRouteItems({ slotMentions: mentions }, { game: "game-1", channel: "main" })[0];
  const url = new URL(item.reviewHref, "https://example.test");
  assert.equal(url.pathname, "/g/game-1/c/private%3Arole_pm%3Aslot-7");
  assert.equal(url.searchParams.get("post"), "20");
  assert.equal(url.hash, "#thread-post-20");
  assert.equal(item.id, "slot-mention-20-slot-7");
});

test("review receipt failures remain explicit and retries submit the same identity", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ reviewed_ids: ["notification-N02-0-slot-7"] }); };
  const request = { game: "game-1", itemId: "notification-N02-0-slot-7", fetchImpl };
  await fetchPrivateAttention(request); await fetchPrivateAttention(request);
  assert.deepEqual(calls[0], calls[1]);
  await assert.rejects(fetchPrivateAttention({ ...request, fetchImpl: async () => new Response(null, { status: 403 }) }));
});
