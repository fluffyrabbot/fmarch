import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GET,
  _liveStackThreadAsset,
  _liveStackThreadVariant,
} from "./+server.js";

test("live-stack thread media serves a generated tablet variant", async () => {
  const response = GET({
    params: {
      asset: "live-faction-day-chat-receipt-tablet.png",
    },
  });
  const bytes = Buffer.from(await response.arrayBuffer());

  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(
    response.headers.get("cache-control"),
    "private, max-age=31536000, immutable",
  );
  assert.equal(
    response.headers.get("x-fmarch-media-content-address"),
    "live-stack-thread-faction-day-chat-receipt-canonical-raster",
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

test("live-stack thread media serves a generated small variant", () => {
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

  const served = _liveStackThreadVariant(asset);
  assert.equal(served.bytes.readUInt32BE(16), 480);
  assert.equal(served.bytes.readUInt32BE(20), 360);
  assert.match(served.etag, /^"[a-f0-9]{64}"$/);
});

test("live-stack thread media withholds original and unknown variants", () => {
  assert.equal(_liveStackThreadAsset("live-faction-day-chat-receipt-original.png"), null);
  assert.equal(_liveStackThreadAsset("live-role-pm-receipt-original.png"), null);
  assert.equal(_liveStackThreadAsset("live-role-pm-receipt-full.png"), null);
  assert.equal(_liveStackThreadAsset("unknown-tablet.png"), null);
});
