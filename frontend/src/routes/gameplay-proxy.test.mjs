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

test("gameplay proxy forwards the canonical exact-game thread resource", async () => {
  const calls = [];
  const request = new Request(
    "https://app.example/api/gameplay/games/game-1?limit=50&before_seq=441",
  );
  const response = await GET({
    cookies: { get: () => "opaque-session" },
    fetch: async (url, init) => {
      calls.push({ url: url.toString(), init });
      return Response.json({ posts: [], next_before_seq: null });
    },
    params: { path: "games/game-1" },
    request,
    url: new URL(request.url),
  });

  assert.equal(response.status, 200);
  assert.equal(
    calls[0].url,
    "https://app.example/games/game-1?limit=50&before_seq=441",
  );
  assert.equal(calls[0].init.headers.authorization, "Bearer opaque-session");
});

test("gameplay proxy rejects legacy public-main thread aliases", async () => {
  for (const path of [
    "games/game-1/thread",
    "games/game-1/channels/main/thread",
  ]) {
    let called = false;
    const request = new Request(`https://app.example/api/gameplay/${path}?limit=50`);
    const response = await GET({
      cookies: { get: () => "opaque-session" },
      fetch: async () => {
        called = true;
      },
      params: { path },
      request,
      url: new URL(request.url),
    });

    assert.equal(response.status, 404, path);
    assert.equal(called, false, path);
  }
});

test("private gameplay proxy rejects client-selected principals before forwarding", async () => {
  for (const selector of ["principal_user_id", "principalUserId"]) {
    let called = false;
    const request = new Request(
      `https://app.example/api/gameplay/games/game-1/player-command-state?slot_id=slot-7&${selector}=forged-user`,
    );
    const response = await GET({
      cookies: { get: () => "opaque-session" },
      fetch: async () => {
        called = true;
      },
      params: { path: "games/game-1/player-command-state" },
      request,
      url: new URL(request.url),
    });

    assert.equal(response.status, 400, selector);
    assert.equal(called, false, selector);
  }
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
