import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10,
]);
const PNG_CACHE = new Map();

export function generatedThreadMediaPng(asset) {
  const cacheKey = `${asset.contentAddress}/${asset.variantName}`;
  const cached = PNG_CACHE.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const bytes = encodeThreadVariantPng(asset);
  const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
  const served = Object.freeze({ bytes, etag });
  PNG_CACHE.set(cacheKey, served);
  return served;
}

function encodeThreadVariantPng(asset) {
  const width = Number(asset.width);
  const height = Number(asset.height);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const { background, accent, secondary, stripe } = asset.palette;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 3 + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 3;
      const color = pixelColor({
        x,
        y,
        width,
        height,
        background,
        accent,
        secondary,
        stripe,
      });
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr(width, height)),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pixelColor({
  x,
  y,
  width,
  height,
  background,
  accent,
  secondary,
  stripe,
}) {
  const margin = Math.floor(Math.min(width, height) * 0.08);
  const headerHeight = Math.floor(height * 0.2);
  const innerRight = width - margin;
  const innerBottom = height - margin;
  if (x < margin || x >= innerRight || y < margin || y >= innerBottom) {
    return secondary;
  }
  if (y < margin + headerHeight) {
    return accent;
  }
  const lineHeight = Math.max(10, Math.floor(height * 0.045));
  for (let line = 0; line < 7; line += 1) {
    const lineTop = margin + headerHeight + Math.floor(height * 0.08) + line * lineHeight * 2;
    const lineWidth = innerRight - margin - Math.floor((line % 3) * width * 0.12);
    if (
      y >= lineTop &&
      y < lineTop + lineHeight &&
      x >= margin + lineHeight &&
      x < margin + lineWidth
    ) {
      return line % 2 === 0 ? stripe : accent;
    }
  }
  const footerTop = innerBottom - Math.floor(height * 0.16);
  if (
    y >= footerTop &&
    y < footerTop + Math.floor(height * 0.06) &&
    x >= margin + lineHeight &&
    x < innerRight - lineHeight
  ) {
    return secondary;
  }
  return background;
}

function ihdr(width, height) {
  const bytes = Buffer.alloc(13);
  bytes.writeUInt32BE(width, 0);
  bytes.writeUInt32BE(height, 4);
  bytes[8] = 8;
  bytes[9] = 2;
  bytes[10] = 0;
  bytes[11] = 0;
  bytes[12] = 0;
  return bytes;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
