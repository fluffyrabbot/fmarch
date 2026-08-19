import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./+server.js";
import { SESSION_COOKIE_NAME } from "../../../../lib/server/session-capabilities.mjs";

test("youtube embed resolve proxy forwards the session bearer", async () => {
  const calls = [];
  const response = await POST({
    cookies: cookieJar("session-token"),
    env: { FMARCH_API_BASE_URL: "http://api.test" },
    request: new Request("http://localhost/embeds/youtube/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://youtu.be/dQw4w9WgXcQ" }),
    }),
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ embed: { provider: "youtube" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://api.test/embeds/youtube/resolve");
  assert.equal(calls[0].init.headers.authorization, "Bearer session-token");
  assert.equal(response.status, 200);
});

test("youtube embed resolve proxy rejects a missing session", async () => {
  const response = await POST({
    cookies: cookieJar(null),
    request: new Request("http://localhost/embeds/youtube/resolve", {
      method: "POST",
      body: "{}",
    }),
    fetch: async () => {
      throw new Error("must not call api");
    },
  });
  assert.equal(response.status, 401);
});

function cookieJar(token) {
  return {
    get: (name) => (name === SESSION_COOKIE_NAME ? token : undefined),
  };
}
