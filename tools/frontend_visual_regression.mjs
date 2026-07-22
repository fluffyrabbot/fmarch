import assert from "node:assert/strict";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { samplePngScreenshot } from "./frontend_screenshot_pixels.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-role-smoke");
const baselineDir = path.join(repoRoot, "tools", "fixtures", "frontend-visual-baselines");
const reportDir = path.join(repoRoot, "target", "frontend-visual-regression");
const reportPath = path.join(reportDir, "visual-regression.json");
const writeBaseline = process.argv.includes("--write");
const selectedScreenshots = Object.freeze([
  "mobile-board-player.png",
  "mobile-admin.png",
  "mobile-admin-confirmation.png",
  "mobile-admin-pending.png",
  "mobile-player.png",
  "mobile-player-receipt.png",
  "mobile-player-composer-ack.png",
  "mobile-player-pending.png",
  "mobile-moderator.png",
  "mobile-moderator-confirmation.png",
  "mobile-moderator-pending.png",
  "mobile-route-state-player-reject.png",
  "mobile-forbidden-player-signed-out.png",
  "tablet-player.png",
  "tablet-moderator.png",
  "desktop-admin.png",
]);

function baselineFileName(screenshotName) {
  return `${screenshotName.replace(/\.png$/, "")}.json`;
}

function serializeBaselineSample(screenshotName, sample) {
  const intsPerRow = sample.columns * 3;
  const pixelRows = [];
  for (let row = 0; row < sample.rows; row += 1) {
    const start = row * intsPerRow;
    pixelRows.push(`    ${sample.pixels.slice(start, start + intsPerRow).join(", ")}`);
  }
  return [
    "{",
    '  "version": 1,',
    `  "screenshot": ${JSON.stringify(screenshotName)},`,
    `  "width": ${sample.width},`,
    `  "height": ${sample.height},`,
    `  "columns": ${sample.columns},`,
    `  "rows": ${sample.rows},`,
    '  "pixels": [',
    pixelRows.join(",\n"),
    "  ]",
    "}",
    "",
  ].join("\n");
}

const current = Object.fromEntries(
  await Promise.all(
    selectedScreenshots.map(async (name) => {
      const png = await readFile(path.join(artifactDir, name));
      return [name, samplePngScreenshot(png, { label: name })];
    }),
  ),
);

if (writeBaseline) {
  await mkdir(baselineDir, { recursive: true });
  const expectedFiles = new Set(selectedScreenshots.map(baselineFileName));
  for (const name of selectedScreenshots) {
    await writeFile(path.join(baselineDir, baselineFileName(name)), serializeBaselineSample(name, current[name]));
  }
  for (const entry of await readdir(baselineDir)) {
    if (entry.endsWith(".json") && !expectedFiles.has(entry)) {
      await unlink(path.join(baselineDir, entry));
    }
  }
  console.log(`wrote ${expectedFiles.size} baselines under ${path.relative(repoRoot, baselineDir)}`);
  process.exit(0);
}

const baselineFiles = (await readdir(baselineDir)).filter((entry) => entry.endsWith(".json"));
assert.deepEqual(
  [...baselineFiles].sort(),
  selectedScreenshots.map(baselineFileName).sort(),
  "baseline directory must contain exactly one file per selected screenshot; rerun write:frontend-visual-baseline",
);
const baseline = Object.fromEntries(
  await Promise.all(
    selectedScreenshots.map(async (name) => {
      const sample = JSON.parse(await readFile(path.join(baselineDir, baselineFileName(name)), "utf8"));
      assert.equal(sample.screenshot, name, `${baselineFileName(name)} names screenshot ${sample.screenshot}`);
      return [name, sample];
    }),
  ),
);
const comparisons = selectedScreenshots.map((name) => compareSamples(name, baseline[name], current[name]));
const failed = comparisons.filter((comparison) => comparison.status !== "passed");
await mkdir(reportDir, { recursive: true });
await writeFile(
  reportPath,
  `${JSON.stringify({
    status: failed.length === 0 ? "passed" : "failed",
    boundary:
      "Perceptual pixel baselines compare a 12x12 RGB sampling grid and full-page geometry for selected mobile, tablet, and desktop product surfaces.",
    comparisons,
  }, null, 2)}\n`,
);
if (failed.length > 0) {
  throw new Error(
    `visual regression detected in ${failed.map((comparison) => comparison.name).join(", ")}; review ${path.relative(repoRoot, reportPath)}`,
  );
}
console.log(`wrote ${path.relative(repoRoot, reportPath)}`);

function compareSamples(name, expected, actual) {
  assert.equal(expected.width, actual.width, `${name} width changed`);
  const heightDelta = Math.abs(actual.height - expected.height) / expected.height;
  const pixelDelta = expected.pixels.reduce(
    (sum, value, index) => sum + Math.abs(value - actual.pixels[index]),
    0,
  ) / (expected.pixels.length * 255);
  const status = heightDelta <= 0.02 && pixelDelta <= 0.015 ? "passed" : "failed";
  return {
    name,
    status,
    expectedHeight: expected.height,
    actualHeight: actual.height,
    heightDelta: Number(heightDelta.toFixed(6)),
    pixelDelta: Number(pixelDelta.toFixed(6)),
    heightThreshold: 0.02,
    pixelThreshold: 0.015,
  };
}
