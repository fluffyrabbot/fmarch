import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-in-app-browser-bundle-import");
const extractedRoot = path.join(artifactDir, "extracted");
const evidencePath = path.join(artifactDir, "bundle-import.json");
const sourceArchive = sourcePathFromArgs();

const archive = await readFile(sourceArchive);
const archiveSha256 = sha256(archive);
const entries = parseTar(archive);
const expectedPayload = [
  "target/frontend-in-app-browser-imported-run/imported-run.json",
  "target/frontend-in-app-browser-interactions/browser-run.json",
  "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
  "target/frontend-in-app-browser-interactions/interaction-page.html",
  "target/frontend-in-app-browser-interactions/replay-handoff.json",
  "target/frontend-in-app-browser-interactions/replay-handoff.md",
  "target/frontend-in-app-browser-localhost/browser-run.json",
];

assert.deepEqual(
  entries.map((entry) => entry.path).filter((entryPath) =>
    expectedPayload.includes(entryPath),
  ),
  expectedPayload,
);

await mkdir(extractedRoot, { recursive: true });
for (const entry of entries) {
  const outputPath = safeExtractPath(entry.path);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, entry.content);
}
const restoredLocalhostArtifacts = await restoreReturnedLocalhostArtifacts(entries);

const extractedBrowserRunPath = path.join(
  extractedRoot,
  "target",
  "frontend-in-app-browser-interactions",
  "browser-run.json",
);
await runImportedRunContract(extractedBrowserRunPath);

const importedRun = JSON.parse(
  await readFile(
    path.join(repoRoot, "target", "frontend-in-app-browser-imported-run", "imported-run.json"),
    "utf8",
  ),
);
const bundleImport = {
  status: importedRun.status === "imported-passed"
    ? "bundle-imported-passed"
    : "bundle-source-blocked",
  proof: "in-app-browser-fixture-bundle-import",
  boundary:
    "Validates a returned deterministic in-app browser fixture bundle without launching Chromium. It parses the tar payload, verifies required fixture/replay/import files, extracts the bundle into a local proof directory, restores returned localhost fixture browser-run artifacts, then runs the imported browser-run contract against the extracted file-backed browser-run.json. It promotes imported file evidence only when that imported-run contract is imported-passed, and it lets the browser-acceptance boundary separately evaluate the restored localhost fixture artifact. It does not prove Svelte hydration, command side effects, TCP transport, WebSocket delivery, dev-server routing, or full localhost app acceptance.",
  generatedFrom: {
    sourceArchive: relativeOrAbsolute(sourceArchive),
    importedRun: "target/frontend-in-app-browser-imported-run/imported-run.json",
    restoredLocalhostBrowserRun:
      "target/frontend-in-app-browser-localhost/browser-run.json",
  },
  archive: {
    path: relativeOrAbsolute(sourceArchive),
    sha256: archiveSha256,
    entryCount: entries.length,
    entries: entries.map(({ content, ...entry }) => entry),
  },
  extracted: {
    root: path.relative(repoRoot, extractedRoot),
    browserRun:
      "target/frontend-in-app-browser-bundle-import/extracted/target/frontend-in-app-browser-interactions/browser-run.json",
    localhostBrowserRun:
      "target/frontend-in-app-browser-bundle-import/extracted/target/frontend-in-app-browser-localhost/browser-run.json",
  },
  restored: {
    localhostArtifacts: restoredLocalhostArtifacts,
  },
  importedRun: {
    status: importedRun.status,
    promotionEligible: importedRun.promotionEligible,
    validated: importedRun.validated,
    blocking: importedRun.blocking,
  },
  promotionEligible: importedRun.status === "imported-passed",
};

await mkdir(artifactDir, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(bundleImport, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

function parseTar(buffer) {
  assert.equal(buffer.length % 512, 0);
  const parsed = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const entryPath = readHeaderString(header, 0, 100);
    const mode = readHeaderString(header, 100, 8);
    const mtime = Number.parseInt(readHeaderString(header, 136, 12), 8);
    const size = Number.parseInt(readHeaderString(header, 124, 12), 8);
    const typeFlag = readHeaderString(header, 156, 1);
    assert.equal(typeFlag, "0");
    assert.equal(mtime, 0);
    assert.equal(mode, "0000644");
    const contentStart = offset + 512;
    const content = buffer.subarray(contentStart, contentStart + size);
    parsed.push({
      path: entryPath,
      bytes: size,
      sha256: sha256(content),
      screenshot: entryPath.endsWith(".png"),
      content,
    });
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return parsed;
}

async function restoreReturnedLocalhostArtifacts(entries) {
  const restored = [];
  for (const entry of entries) {
    if (!entry.path.startsWith("target/frontend-in-app-browser-localhost/")) {
      continue;
    }
    const outputPath = safeRepoPath(entry.path);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, entry.content);
    restored.push(entry.path);
  }
  return restored.sort();
}

function readHeaderString(header, offset, length) {
  return header
    .subarray(offset, offset + length)
    .toString("ascii")
    .replace(/\0.*$/u, "")
    .trim();
}

function safeExtractPath(entryPath) {
  if (path.isAbsolute(entryPath) || entryPath.includes("..")) {
    throw new Error(`unsafe bundle path ${entryPath}`);
  }
  return path.join(extractedRoot, entryPath);
}

function safeRepoPath(entryPath) {
  if (path.isAbsolute(entryPath) || entryPath.includes("..")) {
    throw new Error(`unsafe bundle path ${entryPath}`);
  }
  return path.join(repoRoot, entryPath);
}

async function runImportedRunContract(extractedBrowserRunPath) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "tools/frontend_in_app_browser_imported_run_contract.mjs",
        "--source",
        extractedBrowserRunPath,
      ],
      {
        cwd: repoRoot,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`frontend imported browser-run contract failed with exit ${code}`);
  }
}

function sourcePathFromArgs() {
  const sourceIndex = process.argv.indexOf("--source");
  const source = sourceIndex === -1
    ? process.env.FMARCH_IAB_FIXTURE_BUNDLE_IMPORT ??
      "target/frontend-in-app-browser-bundle/fixture-replay-bundle.tar"
    : process.argv[sourceIndex + 1];
  if (source === undefined || source.length === 0) {
    throw new Error("--source requires a fixture-replay-bundle.tar path");
  }
  return path.resolve(repoRoot, source);
}

function relativeOrAbsolute(absolutePath) {
  const relative = path.relative(repoRoot, absolutePath);
  return relative.startsWith("..") ? absolutePath : relative;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
