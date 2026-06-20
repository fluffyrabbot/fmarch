import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleDir = path.join(repoRoot, "target", "frontend-in-app-browser-bundle");
const manifestPath = path.join(bundleDir, "bundle-manifest.json");
const archivePath = path.join(bundleDir, "fixture-replay-bundle.tar");
const interactionsDir = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-interactions",
);
const localhostDir = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-localhost",
);

const requiredSources = [
  "target/frontend-in-app-browser-interactions/interaction-page.html",
  "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
  "target/frontend-in-app-browser-interactions/replay-handoff.json",
  "target/frontend-in-app-browser-interactions/replay-handoff.md",
  "target/frontend-in-app-browser-interactions/browser-run.json",
  "target/frontend-in-app-browser-localhost/browser-run.json",
  "target/frontend-in-app-browser-imported-run/imported-run.json",
];

const manifest = await readJson(
  "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
);
const handoff = await readJson(
  "target/frontend-in-app-browser-interactions/replay-handoff.json",
);
const browserRun = await readJson(
  "target/frontend-in-app-browser-interactions/browser-run.json",
);
const localhostBrowserRun = await readJson(
  "target/frontend-in-app-browser-localhost/browser-run.json",
);
const importedRun = await readJson(
  "target/frontend-in-app-browser-imported-run/imported-run.json",
);
assert.equal(manifest.status, "page-generated");
assert.equal(handoff.status, "handoff-ready");
assert.equal(browserRun.proof, "in-app-browser-file-fixture-smoke");
assert.equal(localhostBrowserRun.proof, "in-app-browser-localhost-fixture-smoke");
assert.equal(importedRun.proof, "in-app-browser-imported-run-contract");
assert.equal(handoff.fixture.plannedStabilityCheckCount, 2);
assert.equal(handoff.fixture.stabilityCheckTileCount, 14);

const optionalScreenshots = (await readdir(interactionsDir))
  .filter((entry) => /^browser-run-.+\.png$/u.test(entry))
  .sort()
  .map((entry) => `target/frontend-in-app-browser-interactions/${entry}`);
const optionalLocalhostScreenshots = (await readdir(localhostDir))
  .filter((entry) => /^browser-run-.+\.png$/u.test(entry))
  .sort()
  .map((entry) => `target/frontend-in-app-browser-localhost/${entry}`);

const sourcePaths = [
  ...requiredSources,
  ...optionalScreenshots,
  ...optionalLocalhostScreenshots,
];
const entries = [];
for (const source of sourcePaths) {
  const bytes = await readFile(path.join(repoRoot, source));
  entries.push({
    path: source,
    archivePath: source,
    required: requiredSources.includes(source),
    bytes: bytes.length,
    sha256: sha256(bytes),
    screenshot: source.endsWith(".png"),
    content: bytes,
  });
}
entries.sort((left, right) => left.archivePath.localeCompare(right.archivePath));

const archive = createTar(entries);
const archiveSha256 = sha256(archive);
const bundleManifest = {
  status: "bundle-ready",
  proof: "in-app-browser-fixture-replay-bundle",
  boundary:
    "Deterministic tar bundle for carrying the generated in-app browser fixture to a Chromium-capable environment and returning file-backed or localhost-served browser-run evidence for local import validation. The bundle includes the fixture HTML, manifest, replay handoff, latest file and localhost browser-run statuses, imported-run status, and any browser-run screenshot PNGs that exist. It does not prove browser behavior by itself, Svelte hydration, command side effects, TCP transport, WebSocket delivery, dev-server routing, or full localhost app acceptance.",
  generatedFrom: {
    manifest: "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
    replayHandoff: "target/frontend-in-app-browser-interactions/replay-handoff.json",
    browserRun: "target/frontend-in-app-browser-interactions/browser-run.json",
    localhostBrowserRun:
      "target/frontend-in-app-browser-localhost/browser-run.json",
    importedRun: "target/frontend-in-app-browser-imported-run/imported-run.json",
  },
  archive: "target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar",
  archiveFormat: "ustar",
  archiveSha256,
  deterministic: {
    order: "lexicographic archivePath",
    mtime: 0,
    uid: 0,
    gid: 0,
    mode: "0644",
  },
  contents: entries.map(({ content, ...entry }) => entry),
  fixture: {
    page: manifest.page,
    pageUrl: manifest.pageUrl,
    plannedInteractionCount:
      browserRun.plannedInteractions?.length ?? handoff.fixture.plannedInteractionCount,
    moderatorCriticalConfirmationCount:
      handoff.fixture.moderatorCriticalConfirmationIds.length,
    plannedStabilityCheckCount: handoff.fixture.plannedStabilityCheckCount,
    stabilityCheckTileCount: handoff.fixture.stabilityCheckTileCount,
    plannedStabilityChecks: handoff.fixture.plannedStabilityChecks,
    screenshotCount: optionalScreenshots.length,
    localhostScreenshotCount: optionalLocalhostScreenshots.length,
  },
  commands: {
    freshen: [
      "npm run test:frontend-iab-interaction-page",
      "npm run test:frontend-iab-static-dom",
      "npm run test:frontend-iab-localhost-fixture-smoke",
    ],
    replay: "npm run test:frontend-iab-fixture-replay",
    replayLocalhost: "npm run test:frontend-iab-localhost-fixture-smoke",
    import:
      "FMARCH_IAB_BROWSER_RUN_IMPORT=<returned>/target/frontend-in-app-browser-interactions/browser-run.json npm run test:frontend-iab-imported-run",
  },
  latest: {
    browserRunStatus: browserRun.status,
    localhostBrowserRunStatus: localhostBrowserRun.status,
    importedRunStatus: importedRun.status,
    importedPromotionEligible: importedRun.promotionEligible,
  },
};

await mkdir(bundleDir, { recursive: true });
await writeFile(archivePath, archive);
await writeFile(manifestPath, `${JSON.stringify(bundleManifest, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, archivePath)}`);
console.log(`wrote ${path.relative(repoRoot, manifestPath)}`);

function createTar(entries) {
  const chunks = [];
  for (const entry of entries) {
    chunks.push(tarHeader(entry.archivePath, entry.content.length));
    chunks.push(entry.content);
    chunks.push(Buffer.alloc(padLength(entry.content.length)));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function tarHeader(name, size) {
  if (Buffer.byteLength(name) > 100) {
    throw new Error(`tar path too long: ${name}`);
  }
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf8");
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar", 257, 5, "ascii");
  header.write("00", 263, 2, "ascii");
  header.write("root", 265, 32, "ascii");
  header.write("root", 297, 32, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const encodedChecksum = checksum.toString(8).padStart(6, "0");
  header.write(`${encodedChecksum}\0 `, 148, 8, "ascii");
  return header;
}

function writeOctal(buffer, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, "0");
  buffer.write(`${encoded}\0`, offset, length, "ascii");
}

function padLength(size) {
  return (512 - (size % 512)) % 512;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(source) {
  return JSON.parse(await readFile(path.join(repoRoot, source), "utf8"));
}
