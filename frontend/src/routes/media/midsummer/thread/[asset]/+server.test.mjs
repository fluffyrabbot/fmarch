import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, _midsummerThreadAsset } from "./+server.js";

test("midsummer fixture media serves the seeded tablet receipt variant", async () => {
  const response = GET({
    params: { asset: "receipt-442-tablet.png" },
  });
  const bytes = Buffer.from(await response.arrayBuffer());

  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    response.headers.get("x-fmarch-media-content-address"),
    "midsummer-thread-receipt-442-canonical-raster",
  );
  assert.equal(response.headers.get("x-fmarch-media-fixture"), "midsummer");
  assert.equal(
    response.headers.get("x-fmarch-media-reference"),
    "midsummer/main/442/receipt-442",
  );
  assert.equal(response.headers.get("x-fmarch-media-variant"), "tablet");
  assert.match(response.headers.get("etag"), /^"[a-f0-9]{64}"$/);
  assert.deepEqual([...bytes.subarray(0, 8)], [
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  assert.equal(bytes.readUInt32BE(16), 960);
  assert.equal(bytes.readUInt32BE(20), 720);
  assert.ok(bytes.length > 1000, `expected generated PNG bytes, got ${bytes.length}`);
});

test("midsummer fixture media serves small and withholds original variants", () => {
  assert.deepEqual(
    {
      id: _midsummerThreadAsset("receipt-442-small.png")?.id,
      variantName: _midsummerThreadAsset("receipt-442-small.png")?.variantName,
      width: _midsummerThreadAsset("receipt-442-small.png")?.width,
      height: _midsummerThreadAsset("receipt-442-small.png")?.height,
    },
    {
      id: "receipt-442",
      variantName: "small",
      width: 480,
      height: 360,
    },
  );
  assert.equal(_midsummerThreadAsset("receipt-442-original.png"), null);
  assert.equal(_midsummerThreadAsset("receipt-442-full.png"), null);
  assert.equal(_midsummerThreadAsset("unknown-tablet.png"), null);
  assert.equal(_midsummerThreadAsset("receipt-442-tablet.jpg"), null);
});
