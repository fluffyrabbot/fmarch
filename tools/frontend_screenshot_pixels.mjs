import { writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

export async function captureScreenshotEvidence(
  page,
  { path: screenshotPath, label, viewport },
) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(50);
  const png = await page.screenshot({ fullPage: true });
  await writeFile(screenshotPath, png);
  const pixels = analyzePngScreenshot(png, label);
  if (pixels.width !== viewport.width) {
    throw new Error(
      `${label} screenshot width ${pixels.width}, expected viewport width ${viewport.width}`,
    );
  }
  if (pixels.height < viewport.height) {
    throw new Error(
      `${label} screenshot height ${pixels.height}, expected at least viewport height ${viewport.height}`,
    );
  }
  if (pixels.uniqueColorBuckets < 8) {
    throw new Error(
      `${label} screenshot had ${pixels.uniqueColorBuckets} color buckets, expected nonblank UI`,
    );
  }
  if (pixels.changedPixelRatio < 0.005) {
    throw new Error(
      `${label} screenshot changed pixel ratio ${pixels.changedPixelRatio}, expected nonblank UI`,
    );
  }
  return pixels;
}

export function analyzePngScreenshot(png, label = "screenshot") {
  const signature = "89504e470d0a1a0a";
  if (png.subarray(0, 8).toString("hex") !== signature) {
    throw new Error(`${label} screenshot is not a PNG`);
  }

  let offset = 8;
  let width = null;
  let height = null;
  let bitDepth = null;
  let colorType = null;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    }
    if (type === "IDAT") {
      idat.push(data);
    }
    if (type === "IEND") {
      break;
    }
  }

  if (width === null || height === null || bitDepth === null || colorType === null) {
    throw new Error(`${label} screenshot PNG was missing IHDR`);
  }
  if (bitDepth !== 8) {
    throw new Error(`${label} screenshot used unsupported PNG bit depth ${bitDepth}`);
  }

  const channels = pngChannels(colorType, label);
  const bytesPerPixel = channels;
  const stride = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idat));
  const expectedLength = (stride + 1) * height;
  if (inflated.length < expectedLength) {
    throw new Error(
      `${label} screenshot inflated to ${inflated.length} bytes, expected ${expectedLength}`,
    );
  }

  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  const firstPixel = [];
  const colorBuckets = new Set();
  let changedPixels = 0;
  let pixelCount = 0;
  let sourceOffset = 0;

  for (let row = 0; row < height; row += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    inflated.copy(current, 0, sourceOffset, sourceOffset + stride);
    sourceOffset += stride;
    defilterPngRow({ current, previous, filter, bytesPerPixel });

    for (let column = 0; column < width; column += 1) {
      const pixelOffset = column * bytesPerPixel;
      const rgb = readRgb(current, pixelOffset, colorType);
      if (firstPixel.length === 0) {
        firstPixel.push(...rgb);
      }
      const bucket = `${rgb[0] >> 4}:${rgb[1] >> 4}:${rgb[2] >> 4}`;
      colorBuckets.add(bucket);
      const delta =
        Math.abs(rgb[0] - firstPixel[0]) +
        Math.abs(rgb[1] - firstPixel[1]) +
        Math.abs(rgb[2] - firstPixel[2]);
      if (delta > 18) {
        changedPixels += 1;
      }
      pixelCount += 1;
    }

    current.copy(previous);
  }

  return {
    width,
    height,
    colorType,
    bitDepth,
    uniqueColorBuckets: colorBuckets.size,
    changedPixelRatio: Number((changedPixels / pixelCount).toFixed(6)),
  };
}

export function samplePngScreenshot(png, { label = "screenshot", columns = 12, rows = 12 } = {}) {
  const signature = "89504e470d0a1a0a";
  if (png.subarray(0, 8).toString("hex") !== signature) {
    throw new Error(`${label} screenshot is not a PNG`);
  }

  let offset = 8;
  let width = null;
  let height = null;
  let bitDepth = null;
  let colorType = null;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (width === null || height === null || bitDepth !== 8 || colorType === null) {
    throw new Error(`${label} screenshot has an unsupported PNG header`);
  }
  const channels = pngChannels(colorType, label);
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  const buckets = Array.from({ length: columns * rows }, () => [0, 0, 0, 0]);
  let sourceOffset = 0;

  for (let row = 0; row < height; row += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    inflated.copy(current, 0, sourceOffset, sourceOffset + stride);
    sourceOffset += stride;
    defilterPngRow({ current, previous, filter, bytesPerPixel: channels });

    for (let column = 0; column < width; column += 1) {
      const rgb = readRgb(current, column * channels, colorType);
      const bucketColumn = Math.min(columns - 1, Math.floor((column * columns) / width));
      const bucketRow = Math.min(rows - 1, Math.floor((row * rows) / height));
      const bucket = buckets[bucketRow * columns + bucketColumn];
      bucket[0] += rgb[0];
      bucket[1] += rgb[1];
      bucket[2] += rgb[2];
      bucket[3] += 1;
    }
    current.copy(previous);
  }

  return {
    width,
    height,
    columns,
    rows,
    pixels: buckets.flatMap(([red, green, blue, count]) => [
      Math.round(red / count),
      Math.round(green / count),
      Math.round(blue / count),
    ]),
  };
}

function pngChannels(colorType, label) {
  if (colorType === 0) {
    return 1;
  }
  if (colorType === 2) {
    return 3;
  }
  if (colorType === 4) {
    return 2;
  }
  if (colorType === 6) {
    return 4;
  }
  throw new Error(`${label} screenshot used unsupported PNG color type ${colorType}`);
}

function defilterPngRow({ current, previous, filter, bytesPerPixel }) {
  for (let index = 0; index < current.length; index += 1) {
    const left = index >= bytesPerPixel ? current[index - bytesPerPixel] : 0;
    const up = previous[index];
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
    if (filter === 1) {
      current[index] = (current[index] + left) & 0xff;
    } else if (filter === 2) {
      current[index] = (current[index] + up) & 0xff;
    } else if (filter === 3) {
      current[index] = (current[index] + Math.floor((left + up) / 2)) & 0xff;
    } else if (filter === 4) {
      current[index] = (current[index] + paethPredictor(left, up, upLeft)) & 0xff;
    } else if (filter !== 0) {
      throw new Error(`unsupported PNG filter ${filter}`);
    }
  }
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  if (upDistance <= upLeftDistance) {
    return up;
  }
  return upLeft;
}

function readRgb(row, offset, colorType) {
  if (colorType === 0) {
    return [row[offset], row[offset], row[offset]];
  }
  if (colorType === 2 || colorType === 6) {
    return [row[offset], row[offset + 1], row[offset + 2]];
  }
  if (colorType === 4) {
    return [row[offset], row[offset], row[offset]];
  }
  throw new Error(`unsupported PNG color type ${colorType}`);
}
