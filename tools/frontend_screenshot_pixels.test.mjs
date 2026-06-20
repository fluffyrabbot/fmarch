import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { analyzePngScreenshot } from "./frontend_screenshot_pixels.mjs";

test("PNG screenshot analyzer reports nonblank pixel variation", () => {
  const png = buildRgbPng({
    width: 4,
    height: 2,
    pixels: [
      [0, 0, 0],
      [32, 0, 0],
      [64, 16, 0],
      [96, 32, 0],
      [128, 48, 16],
      [160, 64, 32],
      [192, 80, 48],
      [224, 96, 64],
    ],
  });

  const pixels = analyzePngScreenshot(png, "varied fixture");
  assert.equal(pixels.width, 4);
  assert.equal(pixels.height, 2);
  assert.equal(pixels.colorType, 2);
  assert.equal(pixels.bitDepth, 8);
  assert.equal(pixels.uniqueColorBuckets >= 8, true);
  assert.equal(pixels.changedPixelRatio > 0.8, true);
});

test("PNG screenshot analyzer identifies a uniform blank-like image", () => {
  const png = buildRgbPng({
    width: 4,
    height: 2,
    pixels: Array.from({ length: 8 }, () => [240, 240, 240]),
  });

  const pixels = analyzePngScreenshot(png, "uniform fixture");
  assert.equal(pixels.uniqueColorBuckets, 1);
  assert.equal(pixels.changedPixelRatio, 0);
});

test("PNG screenshot analyzer rejects non-PNG bytes", () => {
  assert.throws(
    () => analyzePngScreenshot(Buffer.from("not a png"), "bad fixture"),
    /not a PNG/,
  );
});

function buildRgbPng({ width, height, pixels }) {
  assert.equal(pixels.length, width * height);
  const rows = [];
  for (let row = 0; row < height; row += 1) {
    const rowBytes = [0];
    for (let column = 0; column < width; column += 1) {
      rowBytes.push(...pixels[row * width + column]);
    }
    rows.push(Buffer.from(rowBytes));
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, data, Buffer.alloc(4)]);
}
