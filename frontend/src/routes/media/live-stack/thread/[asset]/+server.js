import { error } from "@sveltejs/kit";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

const LIVE_STACK_THREAD_ASSETS = Object.freeze({
  "live-faction-day-chat-receipt": Object.freeze({
    kind: "image",
    contentAddress: "live-stack-thread-faction-day-chat-receipt-canonical-raster",
    variants: Object.freeze({
      tablet: Object.freeze({
        width: 960,
        height: 720,
        palette: Object.freeze({
          background: Object.freeze([249, 250, 247]),
          accent: Object.freeze([91, 65, 124]),
          secondary: Object.freeze([230, 226, 236]),
          stripe: Object.freeze([129, 96, 154]),
        }),
      }),
      small: Object.freeze({
        width: 480,
        height: 360,
        palette: Object.freeze({
          background: Object.freeze([251, 252, 248]),
          accent: Object.freeze([73, 103, 74]),
          secondary: Object.freeze([224, 236, 224]),
          stripe: Object.freeze([106, 139, 99]),
        }),
      }),
    }),
  }),
  "live-role-pm-receipt": Object.freeze({
    kind: "image",
    contentAddress: "live-stack-thread-role-pm-receipt-canonical-raster",
    variants: Object.freeze({
      tablet: Object.freeze({
        width: 960,
        height: 720,
        palette: Object.freeze({
          background: Object.freeze([248, 250, 252]),
          accent: Object.freeze([42, 91, 68]),
          secondary: Object.freeze([213, 232, 219]),
          stripe: Object.freeze([97, 133, 113]),
        }),
      }),
      small: Object.freeze({
        width: 480,
        height: 360,
        palette: Object.freeze({
          background: Object.freeze([250, 252, 250]),
          accent: Object.freeze([57, 94, 150]),
          secondary: Object.freeze([220, 231, 247]),
          stripe: Object.freeze([105, 132, 179]),
        }),
      }),
    }),
  }),
});

const PNG_SIGNATURE = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10,
]);
const PNG_CACHE = new Map();

export function GET({ params }) {
  const asset = _liveStackThreadAsset(params.asset);
  if (asset === null) {
    throw error(404, "media variant unavailable");
  }
  const served = _liveStackThreadVariant(asset);
  return new Response(served.bytes, {
    headers: {
      "cache-control": "private, max-age=31536000, immutable",
      "content-type": "image/png",
      etag: served.etag,
      "x-fmarch-media-content-address": asset.contentAddress,
      "x-fmarch-media-variant": asset.variantName,
    },
  });
}

export function _liveStackThreadAsset(assetName) {
  const match = /^(?<id>[a-z0-9-]+)-(?<variant>[a-z0-9-]+)\.png$/.exec(
    String(assetName ?? ""),
  );
  if (match === null) {
    return null;
  }
  const asset = LIVE_STACK_THREAD_ASSETS[match.groups.id];
  const variant = asset?.variants?.[match.groups.variant];
  if (asset === undefined || variant === undefined) {
    return null;
  }
  return Object.freeze({
    id: match.groups.id,
    kind: asset.kind,
    contentAddress: asset.contentAddress,
    variantName: match.groups.variant,
    ...variant,
  });
}

export function _liveStackThreadVariant(asset) {
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
