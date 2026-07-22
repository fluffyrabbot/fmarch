import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./+server.js";

test("live ticket proxy binds browser session and configured audience without exposing identity", async () => {
  const calls = [];
  const response = await POST({
    cookies: { get: () => "opaque-session" },
    url: new URL("https://app.example/live/tickets?game=game-1&channel=dead&after_seq=9"),
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return Response.json({ ticket: "opaque-ticket", audience: "fmarch-live", expires_at: 99 });
    },
  });
  const body = await response.json();

  assert.equal(calls[0].init.headers.authorization, "Bearer opaque-session");
  assert.deepEqual(calls[0].body, {
    audience: "fmarch-live",
    game: "game-1",
    channel: "dead",
    after_seq: 9,
  });
  assert.equal(
    body.url,
    "wss://app.example/ws?ticket=opaque-ticket&audience=fmarch-live",
  );
  assert.equal(JSON.stringify(body).includes("opaque-session"), false);
});

test("live ticket proxy emits no upstream request without a session", async () => {
  let called = false;
  const response = await POST({
    cookies: { get: () => undefined },
    url: new URL("https://app.example/live/tickets?game=game-1"),
    fetch: async () => {
      called = true;
    },
  });
  assert.equal(response.status, 401);
  assert.equal(called, false);
});
