import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePngScreenshot } from "./frontend_screenshot_pixels.mjs";
import {
  EXPECTED_COUNTS,
  MODERATOR_CRITICAL_CONFIRMATION_SCENARIO_IDS,
  PLANNED_INTERACTION_IDS,
  expectedStabilityCheckShape,
} from "./frontend_proof_expectations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-in-app-browser-imported-run");
const evidencePath = path.join(artifactDir, "imported-run.json");
const sources = {
  manifest: "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
  staticDom: "target/frontend-in-app-browser-static-dom/static-dom.json",
  replayHandoff: "target/frontend-in-app-browser-interactions/replay-handoff.json",
};
const expectedStabilityCheckIds = Object.freeze([
  "admin-operator-action-status-floors",
  "moderator-primary-action-status-floors",
]);

const sourceBrowserRun = sourcePathFromArgs();
const importedRoot = importedRootFromSource(sourceBrowserRun);
const manifest = await readJson(path.join(repoRoot, sources.manifest));
const staticDom = await readJson(path.join(repoRoot, sources.staticDom));
const replayHandoff = await readJson(path.join(repoRoot, sources.replayHandoff));
const browserRun = await readJson(sourceBrowserRun);

assert.equal(manifest.status, "page-generated");
assert.equal(staticDom.status, "passed");
assert.equal(replayHandoff.status, "handoff-ready");
assert.equal(browserRun.proof, "in-app-browser-file-fixture-smoke");
assert.equal(
  ["passed", "chromium-launch-blocked", "file-navigation-blocked"].includes(
    browserRun.status,
  ),
  true,
);
assertInAppBrowserPlannedInteractions(
  browserRun.plannedInteractions ?? plannedInteractionsFromManifest(manifest),
);
assertInAppBrowserPlannedStabilityChecks(
  browserRun.plannedStabilityChecks ?? manifest.stabilityChecks,
);

const imported = browserRun.status === "passed"
  ? await importedPassedEvidence()
  : sourceBlockedEvidence();

await mkdir(artifactDir, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(imported, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

async function importedPassedEvidence() {
  assert.equal(
    ["generate-and-run", "replay-existing"].includes(browserRun.mode),
    true,
  );
  assert.deepEqual(browserRun.viewports, manifest.viewports);
  assert.equal(browserRun.runs.length, manifest.viewports.length);

  const screenshotChecks = [];
  for (const run of browserRun.runs) {
    assert.equal(run.pageReady.status, "ready");
    assert.equal(run.pageReady.scenarioCount >= EXPECTED_COUNTS.commandScenarios, true);
    assert.equal(run.pageReady.hydratedScenarioCount >= 6, true);
    assertImportedInteractions(run);
    assertImportedStabilityChecks(run);
    screenshotChecks.push(await validateScreenshot(run));
  }

  return {
    status: "imported-passed",
    proof: "in-app-browser-imported-run-contract",
    boundary:
      `Validates a passed file-backed in-app browser browser-run artifact without launching Chromium. It rechecks the current fixture manifest, static DOM contract, planned interaction matrix, per-viewport click/focus/touch evidence, all ${EXPECTED_COUNTS.moderatorCriticalActions} moderator critical host confirmation metadata records, player private-channel route/disclosure evidence, and referenced screenshot PNG pixels. It does not prove fixture freshness after the imported run, Svelte client hydration, command side effects, TCP transport, WebSocket delivery, dev-server routing, or localhost-backed app acceptance.`,
    generatedFrom: {
      ...sources,
      sourceBrowserRun: relativeOrAbsolute(sourceBrowserRun),
    },
    sourceBrowserRun: sourceSummary(),
    promotionEligible: true,
    validated: {
      viewportCount: browserRun.viewports.length,
      runCount: browserRun.runs.length,
      plannedInteractionCount: browserRun.plannedInteractions.length,
      plannedStabilityCheckCount: browserRun.plannedStabilityChecks.length,
      stabilityCheckTileCount: browserRun.plannedStabilityChecks.reduce(
        (sum, check) => sum + (check.tiles?.length ?? 0),
        0,
      ),
      moderatorCriticalConfirmationCount:
        EXPECTED_COUNTS.moderatorCriticalActions,
      screenshotChecks,
    },
    blocking: [],
  };
}

function sourceBlockedEvidence() {
  return {
    status: "source-blocked",
    proof: "in-app-browser-imported-run-contract",
    boundary:
      "The selected file-backed in-app browser browser-run artifact is not passed, so no imported browser evidence was promoted. This artifact preserves the source status and planned interaction matrix for a later Chromium-capable replay/import.",
    generatedFrom: {
      ...sources,
      sourceBrowserRun: relativeOrAbsolute(sourceBrowserRun),
    },
    sourceBrowserRun: sourceSummary(),
    promotionEligible: false,
    validated: {
      viewportCount: 0,
      runCount: 0,
      plannedInteractionCount:
        browserRun.plannedInteractions?.length ??
        plannedInteractionsFromManifest(manifest).length,
      plannedStabilityCheckCount:
        browserRun.plannedStabilityChecks?.length ??
        manifest.stabilityChecks?.length ??
        0,
      stabilityCheckTileCount:
        browserRun.plannedStabilityChecks?.reduce(
          (sum, check) => sum + (check.tiles?.length ?? 0),
          0,
        ) ??
        manifest.stabilityChecks?.reduce(
          (sum, check) => sum + (check.tiles?.length ?? 0),
          0,
        ) ??
        0,
      moderatorCriticalConfirmationCount:
        EXPECTED_COUNTS.moderatorCriticalActions,
      screenshotChecks: [],
    },
    blocking: [
      `source browser-run status is ${browserRun.status}, expected passed`,
      "Run npm run test:frontend-iab-fixture-replay in a Chromium-capable environment and import the resulting browser-run.json plus screenshots.",
    ],
  };
}

async function validateScreenshot(run) {
  assert.equal(typeof run.screenshot, "string");
  const screenshotPath = resolveImportedPath(run.screenshot);
  const png = await readFile(screenshotPath);
  const pixels = analyzePngScreenshot(
    png,
    `imported in-app browser fixture ${run.viewport.name}`,
  );
  assert.deepEqual(pixels, run.screenshotPixels);
  assert.equal(pixels.width, run.viewport.width);
  assert.equal(pixels.height >= run.viewport.height, true);
  assert.equal(pixels.uniqueColorBuckets >= 8, true);
  assert.equal(pixels.changedPixelRatio >= 0.005, true);
  return {
    viewport: run.viewport.name,
    screenshot: path.relative(repoRoot, screenshotPath),
    screenshotPixels: pixels,
  };
}

function assertImportedInteractions(run) {
  const ids = new Set((run.interactions ?? []).map((entry) => entry.id));
  for (const id of PLANNED_INTERACTION_IDS) {
    assert.equal(ids.has(id), true, `imported run missing ${id}`);
  }
  for (const entry of run.interactions ?? []) {
    assert.notEqual(entry.clicked, undefined, `${entry.id} missing clicked`);
    assert.notEqual(entry.activeElement, undefined, `${entry.id} missing activeElement`);
    assert.notEqual(entry.targetBox, undefined, `${entry.id} missing targetBox`);
    assert.equal(entry.targetBox.width >= entry.minTouchTargetPx, true);
    assert.equal(entry.targetBox.height >= entry.minTouchTargetPx, true);
  }
  for (const id of MODERATOR_CRITICAL_CONFIRMATION_SCENARIO_IDS) {
    const entry = run.interactions.find((interaction) => interaction.id === id);
    assert.equal(hasModeratorBrowserConfirmationEvidence(entry), true);
  }
  const playerPrivateChannel = run.interactions.find(
    (entry) => entry.id === "player-private-channel-submit-post-click",
  );
  assert.deepEqual(playerPrivateChannel.route, {
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    activeChannelTestId: "player-channel-private:role_pm:slot-7",
    activeChannelHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    activeChannelCurrent: "page",
    privateReviewHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1",
  });
  const routeError = run.interactions.find(
    (entry) => entry.id === "route-error-back-to-board-click",
  );
  assert.deepEqual(routeError.errorSurface, {
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    status: 403,
    surfaceTestId: "route-error-surface",
    panelTestId: "route-error-panel",
    actionHref: "/",
    activeNavTestId: "role-nav-player",
    activeNavCurrent: "page",
    sessionPrincipal: "player_mira",
    capabilitySummary: "ChannelMember + SlotOccupant",
  });
  const playerDisclosure = run.interactions.find(
    (entry) => entry.id === "player-private-disclosure-vote-and-post",
  );
  assert.equal(playerDisclosure.disclosureBefore.ariaExpanded, "false");
  assert.equal(playerDisclosure.disclosureAfter.ariaExpanded, "true");
  assert.equal(playerDisclosure.disclosureAfter.detailHidden, false);
}

function assertImportedStabilityChecks(run) {
  const ids = new Set((run.stabilityChecks ?? []).map((check) => check.id));
  for (const id of expectedStabilityCheckIds) {
    assert.equal(ids.has(id), true, `imported run missing stability check ${id}`);
  }
  for (const check of run.stabilityChecks ?? []) {
    assert.equal(check.mode, "reserved-status-floor");
    assert.equal(check.statusFloorMinBlockSizePx, 44);
    assert.equal(check.tileCount, check.tiles.length);
    for (const tile of check.tiles) {
      assert.equal(tile.triggerPrecedesStatusFloor, true);
      assert.notEqual(
        tile.statusFloorBox,
        undefined,
        `${check.id}/${tile.id} missing status floor box`,
      );
      assert.equal(
        tile.statusFloorBox.height >= check.statusFloorMinBlockSizePx,
        true,
        `${check.id}/${tile.id} floor height below contract`,
      );
    }
  }
}

function hasModeratorBrowserConfirmationEvidence(entry) {
  return (
    entry?.confirmation?.role === "alertdialog" &&
    entry.confirmation.initialFocusTestId === "critical-host-action-confirm" &&
    entry.confirmation.returnFocusTestId === "critical-host-action-trigger" &&
    entry.confirmation.escapeCancels === "true" &&
    entry.confirmation.tabContainment === "confirm-cancel" &&
    typeof entry.confirmation.actionId === "string" &&
    typeof entry.confirmation.payloadKind === "string" &&
    typeof entry.confirmation.messageText === "string" &&
    entry.confirmation.messageText.includes(entry.confirmation.objectLabel) &&
    entry.confirmation.messageText.includes(entry.confirmation.outcomeLabel)
  );
}

function assertInAppBrowserPlannedInteractions(plannedInteractions) {
  assert.deepEqual(
    plannedInteractions.map((entry) => entry.id),
    PLANNED_INTERACTION_IDS,
  );
}

function assertInAppBrowserPlannedStabilityChecks(plannedStabilityChecks) {
  assert.deepEqual(
    plannedStabilityChecks.map((entry) => [entry.id, entry.mode, entry.tiles.length]),
    expectedStabilityCheckShape(),
  );
}

function plannedInteractionsFromManifest(manifest) {
  return [
    ...manifest.scenarios,
    ...manifest.hydratedSurfaceScenarios.filter(
      (scenario) => scenario.id !== "shared-shell-header-coverage",
    ),
  ];
}

function sourceSummary() {
  return {
    path: relativeOrAbsolute(sourceBrowserRun),
    status: browserRun.status,
    mode: browserRun.mode,
    regeneratedFixture: browserRun.regeneratedFixture,
    pageUrl: browserRun.pageUrl,
    plannedInteractionCount:
      browserRun.plannedInteractions?.length ??
      plannedInteractionsFromManifest(manifest).length,
    plannedStabilityCheckCount:
      browserRun.plannedStabilityChecks?.length ??
      manifest.stabilityChecks?.length ??
      0,
  };
}

function sourcePathFromArgs() {
  const sourceIndex = process.argv.indexOf("--source");
  const source = sourceIndex === -1
    ? process.env.FMARCH_IAB_BROWSER_RUN_IMPORT ??
      "target/frontend-in-app-browser-interactions/browser-run.json"
    : process.argv[sourceIndex + 1];
  if (source === undefined || source.length === 0) {
    throw new Error("--source requires a browser-run.json path");
  }
  return path.resolve(repoRoot, source);
}

function resolveImportedPath(importedPath) {
  if (path.isAbsolute(importedPath)) {
    return importedPath;
  }
  return path.resolve(importedRoot, importedPath);
}

function relativeOrAbsolute(absolutePath) {
  const relative = path.relative(repoRoot, absolutePath);
  return relative.startsWith("..") ? absolutePath : relative;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function importedRootFromSource(sourcePath) {
  const browserRunSuffix = path.join(
    "target",
    "frontend-in-app-browser-interactions",
    "browser-run.json",
  );
  if (sourcePath.endsWith(browserRunSuffix)) {
    return sourcePath.slice(0, -browserRunSuffix.length).replace(/[\/\\]$/u, "");
  }
  return repoRoot;
}
