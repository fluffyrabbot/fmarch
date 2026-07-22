import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "./api/gameplay/[...path]/+server.js";

test("private gameplay reads are allowlisted and bound to the httpOnly session", async () => {
  const calls = [];
  const request = new Request(
    "https://app.example/api/gameplay/games/game-1/channels/dead/thread?limit=20",
    { headers: { accept: "application/json" } },
  );
  const response = await GET({
    cookies: { get: () => "opaque-session" },
    fetch: async (url, init) => {
      calls.push({ url: url.toString(), init });
      return Response.json({ posts: [] });
    },
    params: { path: "games/game-1/channels/dead/thread" },
    request,
    url: new URL(request.url),
  });

  assert.equal(response.status, 200);
  assert.equal(calls[0].init.headers.authorization, "Bearer opaque-session");
  assert.equal(calls[0].url, "https://app.example/games/game-1/channels/dead/thread?limit=20");
});

test("private gameplay proxy emits no upstream request without a session", async () => {
  let called = false;
  const request = new Request("https://app.example/api/gameplay/games/game-1/notifications");
  const response = await GET({
    cookies: { get: () => undefined },
    fetch: async () => {
      called = true;
    },
    params: { path: "games/game-1/notifications" },
    request,
    url: new URL(request.url),
  });

  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("private gameplay proxy rejects unrecognized paths before session forwarding", async () => {
  let called = false;
  const request = new Request("https://app.example/api/gameplay/auth/accounts");
  const response = await GET({
    cookies: { get: () => "opaque-session" },
    fetch: async () => {
      called = true;
    },
    params: { path: "auth/accounts" },
    request,
    url: new URL(request.url),
  });

  assert.equal(response.status, 404);
  assert.equal(called, false);
});
