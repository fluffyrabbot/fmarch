import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-interactions",
);
const jsonPath = path.join(artifactDir, "replay-handoff.json");
const markdownPath = path.join(artifactDir, "replay-handoff.md");

const sources = {
  manifest: "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
  staticDom: "target/frontend-in-app-browser-static-dom/static-dom.json",
  browserRun: "target/frontend-in-app-browser-interactions/browser-run.json",
};

const manifest = await readArtifact(sources.manifest);
const staticDom = await readArtifact(sources.staticDom);
const browserRun = await readArtifact(sources.browserRun);

assert.equal(manifest.status, "page-generated");
assert.equal(manifest.proof, "in-app-browser-file-interaction-page");
assert.equal(staticDom.status, "passed");
assert.equal(staticDom.proof, "in-app-browser-static-dom-contract");
assert.equal(
  ["passed", "chromium-launch-blocked", "file-navigation-blocked"].includes(
    browserRun.status,
  ),
  true,
);
assert.equal(typeof manifest.pageUrl, "string");
assert.match(manifest.pageUrl, /^file:\/\//);
assert.equal(
  manifest.page,
  "target/frontend-in-app-browser-interactions/interaction-page.html",
);
assert.equal(staticDom.scenarioCount, manifest.scenarios.length);
assert.equal(
  staticDom.hydratedScenarioCount,
  manifest.hydratedSurfaceScenarios.length,
);

const plannedInteractionIds = plannedInteractions(manifest, browserRun).map(
  (entry) => entry.id,
);
assert.equal(plannedInteractionIds.length, 22);

const moderatorCriticalConfirmationIds = manifest.scenarios
  .filter((scenario) => scenario.role === "moderator" && scenario.confirmation)
  .map((scenario) => scenario.id);
assert.equal(moderatorCriticalConfirmationIds.length, 10);

const plannedStabilityChecks = summarizeStabilityChecks(
  browserRun.plannedStabilityChecks?.length > 0
    ? browserRun.plannedStabilityChecks
    : manifest.stabilityChecks,
);
assert.equal(plannedStabilityChecks.length, 2);
assert.equal(stabilityCheckTileCount(plannedStabilityChecks), 14);
assert.equal(
  plannedStabilityChecks.every(
    (check) =>
      check.mode === "reserved-status-floor" &&
      check.statusFloorMinBlockSizePx === 44,
  ),
  true,
);

const handoff = {
  status: "handoff-ready",
  proof: "in-app-browser-fixture-replay-handoff",
  boundary:
    "Portable handoff for replaying the generated file-backed in-app browser fixture in a Chromium-capable environment. It records the exact fixture file URL, replay command, expected output artifact, planned interaction matrix, and promotion checks. It does not prove browser behavior by itself, fixture freshness after edits, Svelte client hydration, command side effects, TCP transport, WebSocket delivery, dev-server routing, or localhost-backed app acceptance.",
  generatedFrom: sources,
  fixture: {
    page: manifest.page,
    pageUrl: manifest.pageUrl,
    viewportCount: manifest.viewports.length,
    commandScenarioCount: manifest.scenarios.length,
    hydratedScenarioCount: manifest.hydratedSurfaceScenarios.length,
    plannedInteractionCount: plannedInteractionIds.length,
    plannedInteractionIds,
    moderatorCriticalConfirmationIds,
    plannedStabilityCheckCount: plannedStabilityChecks.length,
    stabilityCheckTileCount: stabilityCheckTileCount(plannedStabilityChecks),
    plannedStabilityChecks,
  },
  replay: {
    command: "npm run test:frontend-iab-fixture-replay",
    expectedArtifact:
      "target/frontend-in-app-browser-interactions/browser-run.json",
    expectedPassedStatus: "passed",
    freshnessCommands: [
      "npm run test:frontend-iab-interaction-page",
      "npm run test:frontend-iab-static-dom",
    ],
  },
  latestBrowserRun: {
    status: browserRun.status,
    mode: browserRun.mode,
    regeneratedFixture: browserRun.regeneratedFixture,
    plannedInteractionCount: browserRun.plannedInteractions?.length ?? 0,
    plannedStabilityCheckCount:
      browserRun.plannedStabilityChecks?.length ?? plannedStabilityChecks.length,
    stabilityCheckTileCount: stabilityCheckTileCount(
      browserRun.plannedStabilityChecks?.length > 0
        ? summarizeStabilityChecks(browserRun.plannedStabilityChecks)
        : plannedStabilityChecks,
    ),
    promotionEligible: browserRun.status === "passed",
    errorName: browserRun.status === "passed" ? null : browserRun.error?.name ?? null,
    blockedReason: browserRun.status === "passed"
      ? null
      : browserRun.boundary,
  },
  promotionChecks: [
    "Run npm run test:frontend-iab-fixture-replay in a Chromium-capable environment.",
    "target/frontend-in-app-browser-interactions/browser-run.json has status passed.",
    "browser-run plannedInteractions includes 22 admin/player/moderator/error interactions.",
    "browser-run plannedStabilityChecks includes 2 reserved status-floor checks covering 14 admin/moderator action tiles.",
    "route-error interaction includes player private-channel 403 shell evidence.",
    "browser-run runs cover every fixture viewport.",
    "all reserved status floors advertise and render at least 44px before promotion.",
    "all 10 moderator critical host confirmation interactions include alertdialog focus metadata and object/outcome text.",
    "fixture screenshots include nonblank pixel evidence.",
    "Treat this as file-backed fixture proof only; full localhost app acceptance is tracked by the localhost dev-server role-smoke lane.",
  ],
};

await mkdir(artifactDir, { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(handoff, null, 2)}\n`);
await writeFile(markdownPath, `${renderMarkdown(handoff)}\n`);
console.log(`wrote ${path.relative(repoRoot, jsonPath)}`);
console.log(`wrote ${path.relative(repoRoot, markdownPath)}`);

function plannedInteractions(manifest, browserRun) {
  if (browserRun.plannedInteractions?.length > 0) {
    return browserRun.plannedInteractions;
  }
  const commandScenarios = manifest.scenarios.map((scenario) => ({
    id: scenario.id,
  }));
  const hydratedScenarios = manifest.hydratedSurfaceScenarios
    .filter((scenario) => scenario.id !== "shared-shell-header-coverage")
    .map((scenario) => ({
      id: scenario.id,
    }));
  return [...commandScenarios, ...hydratedScenarios];
}

function renderMarkdown(handoff) {
  return [
    "# In-App Browser Fixture Replay Handoff",
    "",
    `Status: \`${handoff.status}\``,
    "",
    `Fixture: ${handoff.fixture.pageUrl}`,
    "",
    "Freshen the fixture after frontend edits:",
    "",
    ...handoff.replay.freshnessCommands.map((command) => `- \`${command}\``),
    "",
    "Replay in a Chromium-capable environment:",
    "",
    `- \`${handoff.replay.command}\``,
    "",
    `Expected artifact: \`${handoff.replay.expectedArtifact}\``,
    "",
    `Planned interactions: ${handoff.fixture.plannedInteractionCount}`,
    `Moderator critical confirmations: ${handoff.fixture.moderatorCriticalConfirmationIds.length}`,
    `Planned stability checks: ${handoff.fixture.plannedStabilityCheckCount}`,
    `Reserved status-floor tiles: ${handoff.fixture.stabilityCheckTileCount}`,
    "",
    "Promotion checks:",
    "",
    ...handoff.promotionChecks.map((check) => `- ${check}`),
    "",
    "Latest browser-run snapshot:",
    "",
    `- status: \`${handoff.latestBrowserRun.status}\``,
    `- mode: \`${handoff.latestBrowserRun.mode}\``,
    `- regeneratedFixture: \`${handoff.latestBrowserRun.regeneratedFixture}\``,
  ].join("\n");
}

async function readArtifact(source) {
  return JSON.parse(await readFile(path.join(repoRoot, source), "utf8"));
}

function summarizeStabilityChecks(stabilityChecks = []) {
  return stabilityChecks.map((check) => ({
    id: check.id,
    role: check.role,
    surfaceId: check.surfaceId,
    mode: check.mode,
    statusFloorMinBlockSizePx: check.statusFloorMinBlockSizePx,
    tileCount: check.tiles.length,
    tileIds: check.tiles.map((tile) => tile.id),
  }));
}

function stabilityCheckTileCount(stabilityChecks) {
  return stabilityChecks.reduce((count, check) => count + check.tileCount, 0);
}
