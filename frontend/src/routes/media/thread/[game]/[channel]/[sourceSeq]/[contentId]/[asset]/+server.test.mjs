import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "./+server.js";

const CONTENT_ID = "b".repeat(64);
const PARAMS = Object.freeze({
  game: "7ec6279d-67e6-41d0-995b-1b0451f893cd",
  channel: "private:mafia_day_chat",
  sourceSeq: "42",
  contentId: CONTENT_ID,
  asset: "tablet.avif",
});

test("thread media proxy forwards the browser session and preserves private variant metadata", async () => {
  const calls = [];
  const response = await GET({
    params: PARAMS,
    cookies: cookieJar("member-session"),
    env: { FMARCH_API_BASE_URL: "http://api.test" },
    async fetch(url, init) {
      calls.push({ url, init });
      return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
        status: 200,
        headers: {
          "content-type": "image/avif",
          "cache-control": "private, no-cache",
          etag: '"variant-hash"',
          "x-fmarch-media-content-address": CONTENT_ID,
          "x-fmarch-media-channel": PARAMS.channel,
          "x-fmarch-media-post-seq": PARAMS.sourceSeq,
          "x-fmarch-media-reference": `${PARAMS.game}/${PARAMS.channel}/42/${CONTENT_ID}`,
          "x-fmarch-media-variant": "tablet",
          "x-fmarch-media-format": "avif",
        },
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `http://api.test/media/thread/${PARAMS.game}/private%3Amafia_day_chat/42/${CONTENT_ID}/tablet.avif`,
  );
  assert.equal(calls[0].init.headers.authorization, "Bearer member-session");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/avif");
  assert.equal(response.headers.get("cache-control"), "private, no-cache");
  assert.equal(response.headers.get("x-fmarch-media-variant"), "tablet");
  assert.equal((await response.arrayBuffer()).byteLength, 8);
});

test("thread media proxy revalidates cached bytes through the account boundary", async () => {
  const response = await GET({
    params: PARAMS,
    request: new Request("http://localhost/media", {
      headers: { "if-none-match": 'W/"variant-hash"' },
    }),
    cookies: cookieJar("member-session"),
    env: { FMARCH_API_BASE_URL: "http://api.test" },
    async fetch(_url, init) {
      assert.equal(init.headers["if-none-match"], 'W/"variant-hash"');
      return new Response(null, {
        status: 304,
        headers: {
          "cache-control": "private, no-cache",
          etag: '"variant-hash"',
        },
      });
    },
  });

  assert.equal(response.status, 304);
  assert.equal(response.headers.get("cache-control"), "private, no-cache");
  assert.equal(response.headers.get("etag"), '"variant-hash"');
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test("thread media proxy returns zero bytes for missing and non-member sessions", async () => {
  let fetchCount = 0;
  const missing = await GET({
    params: PARAMS,
    cookies: cookieJar(null),
    async fetch() {
      fetchCount += 1;
      return new Response();
    },
  });
  assert.equal(missing.status, 401);
  assert.equal((await missing.arrayBuffer()).byteLength, 0);

  const denied = await GET({
    params: PARAMS,
    cookies: cookieJar("nonmember-session"),
    async fetch() {
      fetchCount += 1;
      return Response.json({ message: "not authorized" }, { status: 403 });
    },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("content-length"), "0");
  assert.equal((await denied.arrayBuffer()).byteLength, 0);
  assert.equal(fetchCount, 1);
});

function cookieJar(token) {
  return {
    get(name) {
      return name === "fmarch_session" ? token : undefined;
    },
  };
}
