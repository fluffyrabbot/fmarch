import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./+server.js";

test("media upload proxy forwards bounded image bytes with the account bearer token", async () => {
  const calls = [];
  const response = await POST({
    request: new Request("http://localhost/media/uploads", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71]),
    }),
    cookies: cookieJar("account-session"),
    env: { FMARCH_API_BASE_URL: "http://api.test" },
    async fetch(url, init) {
      calls.push({ url, init, body: new Uint8Array(init.body) });
      return Response.json(
        { content_id: "a".repeat(64), intrinsic_width: 1, intrinsic_height: 1 },
        { status: 201 },
      );
    },
  });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://api.test/media/uploads");
  assert.equal(calls[0].init.headers.authorization, "Bearer account-session");
  assert.equal(calls[0].init.headers["content-type"], "image/png");
  assert.deepEqual([...calls[0].body], [137, 80, 78, 71]);
  assert.equal((await response.json()).content_id, "a".repeat(64));
});

test("media upload proxy rejects missing sessions, unsupported types, and oversized bodies locally", async () => {
  let fetchCount = 0;
  const fetch = async () => {
    fetchCount += 1;
    return new Response();
  };
  const missing = await POST({
    request: new Request("http://localhost/media/uploads", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array([1]),
    }),
    cookies: cookieJar(null),
    fetch,
  });
  assert.equal(missing.status, 401);
  assert.equal((await missing.arrayBuffer()).byteLength, 0);

  const unsupported = await POST({
    request: new Request("http://localhost/media/uploads", {
      method: "POST",
      headers: { "content-type": "image/gif" },
      body: new Uint8Array([1]),
    }),
    cookies: cookieJar("account-session"),
    fetch,
  });
  assert.equal(unsupported.status, 415);

  const oversized = await POST({
    request: {
      headers: new Headers({
        "content-type": "image/png",
        "content-length": String(12 * 1024 * 1024 + 1),
      }),
      arrayBuffer() {
        throw new Error("oversized body must not be buffered");
      },
    },
    cookies: cookieJar("account-session"),
    fetch,
  });
  assert.equal(oversized.status, 413);
  assert.equal(fetchCount, 0);
});

function cookieJar(token) {
  return {
    get(name) {
      return name === "fmarch_session" ? token : undefined;
    },
  };
}
