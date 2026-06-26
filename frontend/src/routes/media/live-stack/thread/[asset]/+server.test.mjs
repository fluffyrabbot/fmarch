import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GET,
  _liveStackThreadAsset,
  _liveStackThreadMediaReference,
  _liveStackThreadReferenceContext,
  _liveStackThreadUrl,
  _liveStackThreadVariant,
} from "./+server.js";

const GAME = "midsummer";
const CHANNEL = "private:mafia_day_chat";
const ASSET_NAME = "live-faction-day-chat-receipt-tablet.png";
const MEDIA_PATH = `/media/live-stack/thread/${ASSET_NAME}`;
const MEDIA_URL = `http://localhost${MEDIA_PATH}?game=${encodeURIComponent(
  GAME,
)}&channel=${encodeURIComponent(CHANNEL)}`;

test("live-stack thread media serves a projected private-channel tablet variant", async () => {
  const seen = [];
  const response = await GET(
    routeEvent({
      seen,
      capabilities: [
        {
          kind: "ChannelMember",
          body: { channel: CHANNEL },
        },
      ],
    }),
  );
  const bytes = Buffer.from(await response.arrayBuffer());

  assert.deepEqual(seen, [
    "http://api.test/auth/session?game=midsummer",
    "http://api.test/games/midsummer/channels/private%3Amafia_day_chat/thread?limit=100&principal_user_id=player_mira",
  ]);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(
    response.headers.get("cache-control"),
    "private, max-age=31536000, immutable",
  );
  assert.equal(
    response.headers.get("x-fmarch-media-content-address"),
    "live-stack-thread-faction-day-chat-receipt-canonical-raster",
  );
  assert.equal(response.headers.get("x-fmarch-media-channel"), CHANNEL);
  assert.equal(response.headers.get("x-fmarch-media-post-seq"), "100000");
  assert.equal(
    response.headers.get("x-fmarch-media-reference"),
    "midsummer/private:mafia_day_chat/100000/live-faction-day-chat-receipt",
  );
  assert.equal(response.headers.get("x-fmarch-media-variant"), "tablet");
  assert.match(response.headers.get("etag"), /^"[a-f0-9]{64}"$/);
  assert.deepEqual([...bytes.subarray(0, 8)], [
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  assert.equal(bytes.readUInt32BE(16), 960);
  assert.equal(bytes.readUInt32BE(20), 720);
  assert.ok(bytes.length > 1000, `expected real PNG bytes, got ${bytes.length}`);
});

test("live-stack thread media serves a generated small variant only when projected", async () => {
  const asset = _liveStackThreadAsset("live-faction-day-chat-receipt-small.png");
  assert.deepEqual(
    {
      id: asset?.id,
      variantName: asset?.variantName,
      width: asset?.width,
      height: asset?.height,
    },
    {
      id: "live-faction-day-chat-receipt",
      variantName: "small",
      width: 480,
      height: 360,
    },
  );

  const reference = await _liveStackThreadMediaReference({
    asset,
    request: requestFor(
      `http://localhost/media/live-stack/thread/live-faction-day-chat-receipt-small.png?game=${GAME}&channel=${encodeURIComponent(
        CHANNEL,
      )}`,
    ),
    cookies: cookieJar("player-token"),
    fetchImpl: routeFetch({
      capabilities: [
        {
          kind: "ChannelMember",
          body: { channel: CHANNEL },
        },
      ],
    }),
    env: { FMARCH_API_BASE_URL: "http://api.test" },
  });
  assert.deepEqual(reference, {
    status: "ready",
    game: GAME,
    channel: CHANNEL,
    sourceSeq: 100000,
    streamSeq: 100000,
  });

  const served = _liveStackThreadVariant(asset);
  assert.equal(served.bytes.readUInt32BE(16), 480);
  assert.equal(served.bytes.readUInt32BE(20), 360);
  assert.match(served.etag, /^"[a-f0-9]{64}"$/);
});

test("live-stack thread media denies private-channel media without channel capability", async () => {
  await assert.rejects(
    () =>
      GET(
        routeEvent({
          capabilities: [
            {
              kind: "SlotOccupant",
              body: { slot: "slot-7" },
            },
          ],
        }),
      ),
    (err) =>
      err?.status === 403 &&
      /media access denied for this thread reference/.test(err?.body?.message),
  );
});

test("live-stack thread media withholds unreferenced and forbidden variants", async () => {
  assert.equal(_liveStackThreadAsset("live-faction-day-chat-receipt-original.png"), null);
  assert.equal(_liveStackThreadAsset("live-role-pm-receipt-original.png"), null);
  assert.equal(_liveStackThreadAsset("live-role-pm-receipt-full.png"), null);
  assert.equal(_liveStackThreadAsset("unknown-tablet.png"), null);

  await assert.rejects(
    () =>
      GET(
        routeEvent({
          page: {
            posts: [
              {
                source_seq: 100000,
                stream_seq: 100000,
                media: [],
              },
            ],
          },
          capabilities: [
            {
              kind: "ChannelMember",
              body: { channel: CHANNEL },
            },
          ],
        }),
      ),
    (err) =>
      err?.status === 404 &&
      /media variant is not referenced by this thread/.test(err?.body?.message),
  );
});

test("live-stack thread media reference context accepts query params or route referer", () => {
  assert.deepEqual(
    _liveStackThreadReferenceContext({
      request: requestFor(MEDIA_URL),
    }),
    {
      game: GAME,
      channel: CHANNEL,
      pathname: MEDIA_PATH,
    },
  );
  assert.deepEqual(
    _liveStackThreadReferenceContext({
      request: requestFor(`http://localhost${MEDIA_PATH}`, {
        referer: `http://localhost/g/${GAME}/c/${encodeURIComponent(CHANNEL)}`,
      }),
    }),
    {
      game: GAME,
      channel: CHANNEL,
      pathname: MEDIA_PATH,
    },
  );
  assert.equal(_liveStackThreadReferenceContext({ request: requestFor(`http://localhost${MEDIA_PATH}`) }), null);
});

test("live-stack media thread URL keeps private-channel principal scoped", () => {
  assert.equal(
    _liveStackThreadUrl({
      apiBaseUrl: "http://api.test/",
      game: GAME,
      channel: CHANNEL,
      principalUserId: "player_mira",
    }),
    "http://api.test/games/midsummer/channels/private%3Amafia_day_chat/thread?limit=100&principal_user_id=player_mira",
  );
  assert.equal(
    _liveStackThreadUrl({
      apiBaseUrl: "http://api.test/",
      game: GAME,
      channel: "main",
      principalUserId: null,
    }),
    "http://api.test/games/midsummer/thread?limit=100",
  );
});

function routeEvent({
  seen = [],
  capabilities,
  page = projectedThreadPage(),
} = {}) {
  return {
    params: { asset: ASSET_NAME },
    request: requestFor(MEDIA_URL),
    cookies: cookieJar("player-token"),
    fetch: routeFetch({ seen, capabilities, page }),
    env: { FMARCH_API_BASE_URL: "http://api.test" },
  };
}

function routeFetch({ seen = [], capabilities = [], page = projectedThreadPage() } = {}) {
  return async (url) => {
    seen.push(url);
    if (url === "http://api.test/auth/session?game=midsummer") {
      return jsonResponse({
        principal_user_id: "player_mira",
        capabilities,
      });
    }
    if (
      url ===
      "http://api.test/games/midsummer/channels/private%3Amafia_day_chat/thread?limit=100&principal_user_id=player_mira"
    ) {
      return jsonResponse(page);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

function projectedThreadPage() {
  return {
    next_before_seq: null,
    posts: [
      {
        source_seq: 100000,
        stream_seq: 100000,
        channel_id: CHANNEL,
        media: [
          {
            id: "live-faction-day-chat-receipt",
            kind: "image",
            alt: "Live faction day chat tablet receipt",
            variants: {
              tablet: {
                url: MEDIA_PATH,
                width: 960,
                height: 720,
              },
              small: {
                url: "/media/live-stack/thread/live-faction-day-chat-receipt-small.png",
                width: 480,
                height: 360,
              },
              original: {
                url: "/media/live-stack/thread/live-faction-day-chat-receipt-original.png",
                width: 4000,
                height: 3000,
              },
            },
          },
        ],
      },
    ],
  };
}

function requestFor(url, headers = {}) {
  return {
    url,
    headers: {
      get(name) {
        return headers[name] ?? headers[name.toLowerCase()] ?? null;
      },
    },
  };
}

function cookieJar(value) {
  return {
    get(name) {
      return name === "fmarch_session" ? value : undefined;
    },
  };
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
  };
}
