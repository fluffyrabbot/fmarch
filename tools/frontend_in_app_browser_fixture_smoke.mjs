import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { captureScreenshotEvidence } from "./frontend_screenshot_pixels.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serveLocalhost = process.argv.includes("--serve-localhost");
const sourceArtifactDir = path.join(
  repoRoot,
  "target",
  "frontend-in-app-browser-interactions",
);
const artifactDir = serveLocalhost
  ? path.join(repoRoot, "target", "frontend-in-app-browser-localhost")
  : sourceArtifactDir;
const evidencePath = path.join(artifactDir, "browser-run.json");
const manifestPath = path.join(sourceArtifactDir, "interaction-page-manifest.json");
const replayExistingFixture = process.argv.includes("--replay-existing");
const baseMode = replayExistingFixture ? "replay-existing" : "generate-and-run";
const mode = serveLocalhost ? `${baseMode}-localhost` : baseMode;
const regeneratedFixture = !replayExistingFixture;
const proof = serveLocalhost
  ? "in-app-browser-localhost-fixture-smoke"
  : "in-app-browser-file-fixture-smoke";

await mkdir(artifactDir, { recursive: true });
if (!replayExistingFixture) {
  await runInteractionPageContract();
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
let browser;
let fixtureServer;
let pageUrl = manifest.pageUrl;

try {
  if (serveLocalhost) {
    try {
      fixtureServer = await startFixtureServer(sourceArtifactDir);
      pageUrl = `${fixtureServer.origin}/interaction-page.html`;
    } catch (error) {
      await writeBlocked({
        status: "localhost-bind-blocked",
        boundary: replayExistingFixture
          ? "The existing in-app browser fixture manifest was loaded without regenerating SSR artifacts, but a localhost fixture server could not bind in this sandbox. No localhost browser navigation, native click delivery, focus landing, touch geometry, disclosure toggle, or screenshot pixels were exercised."
          : "The in-app browser fixture was generated, but a localhost fixture server could not bind in this sandbox. No localhost browser navigation, native click delivery, focus landing, touch geometry, disclosure toggle, or screenshot pixels were exercised.",
        error,
      });
      process.exit(0);
    }
  }

  try {
    browser = await chromium.launch();
  } catch (error) {
    await writeBlocked({
      status: "chromium-launch-blocked",
      boundary: blockedLaunchBoundary(),
      error,
    });
    process.exit(0);
  }

  const evidence = {
    status: "passed",
    proof,
    mode,
    regeneratedFixture,
    boundary: passedBoundary(),
    generatedFrom: {
      manifest: "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
      page: manifest.page,
      servedFrom: serveLocalhost ? "target/frontend-in-app-browser-interactions" : undefined,
    },
    pageUrl,
    sourcePageUrl: manifest.pageUrl,
    viewports: manifest.viewports,
    plannedInteractions: summarizePlannedInteractions(interactionScenarios(manifest)),
    plannedStabilityChecks: manifest.stabilityChecks ?? [],
    runs: [],
  };

  for (const viewport of manifest.viewports) {
    const context = await browser.newContext({
      hasTouch: true,
      viewport: {
        width: viewport.width,
        height: viewport.height,
      },
    });
    const page = await context.newPage();
    try {
      await page.goto(pageUrl, { waitUntil: "load" });
      await page.getByTestId("iab-proof-page").waitFor({ state: "visible" });
      const pageReady = await page.evaluate(() => ({
        status: globalThis.__fmarchIabProof?.status,
        scenarioCount: globalThis.__fmarchIabProof?.scenarios?.length ?? 0,
        hydratedScenarioCount:
          globalThis.__fmarchIabProof?.hydratedSurfaceScenarios?.length ?? 0,
      }));
      if (
        pageReady.status !== "ready" ||
        pageReady.scenarioCount < 17 ||
        pageReady.hydratedScenarioCount < 6
      ) {
        throw new Error(
          `${viewport.name} fixture script was not ready: ${JSON.stringify(pageReady)}`,
        );
      }

      const interactions = [];
      for (const scenario of interactionScenarios(manifest)) {
        interactions.push(await proveFixtureInteraction(page, scenario, viewport));
      }
      const stabilityChecks = [];
      for (const check of manifest.stabilityChecks ?? []) {
        stabilityChecks.push(await proveStabilityCheck(page, check, viewport));
      }
      const screenshotPath = path.join(artifactDir, `browser-run-${viewport.name}.png`);
      const screenshotPixels = await captureScreenshotEvidence(page, {
        path: screenshotPath,
        label: `in-app browser fixture ${viewport.name}`,
        viewport,
      });
      evidence.runs.push({
        viewport,
        pageReady,
        interactions,
        stabilityChecks,
        screenshot: path.relative(repoRoot, screenshotPath),
        screenshotPixels,
      });
    } finally {
      await context.close();
    }
  }

  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} catch (error) {
  await writeBlocked({
    status: serveLocalhost ? "localhost-navigation-blocked" : "file-navigation-blocked",
    boundary: navigationBlockedBoundary(),
    error,
  });
  process.exitCode = 1;
} finally {
  await browser?.close();
  await fixtureServer?.close();
}

function interactionScenarios(manifest) {
  const commandScenarios = manifest.scenarios.map((scenario) => ({
    id: scenario.id,
    role: scenario.role,
    source: "manifest.scenarios",
    rootSelector: `[data-iab-scenario-id="${scenario.id}"]`,
    targetSelector: scenario.targetSelector,
    targetTestId: scenario.targetTestId,
    targetAction: scenario.targetAction,
    expectedText: scenario.expectedText,
    minTouchTargetPx: scenario.minTouchTargetPx,
    route: scenario.route,
    errorSurface: scenario.errorSurface,
    confirmation: scenario.confirmation,
  }));
  return [
    ...commandScenarios,
    {
      id: "admin-audit-native-flow",
      role: "admin",
      source: "manifest.hydratedSurfaceScenarios",
      rootSelector: '[data-iab-hydrated-scenario-id="admin-audit-native-flow"]',
      targetSelector: '[data-testid="iab-admin-audit-detail-link"]',
      targetTestId: "iab-admin-audit-detail-link",
      expectedHref:
        manifest.hydratedSurfaceScenarios.find(
          (scenario) => scenario.id === "admin-audit-native-flow",
        )?.auditNavigation?.listHref,
      expectedText: "Proof runs",
      minTouchTargetPx: 44,
    },
    {
      id: "admin-operational-forms",
      role: "admin",
      source: "manifest.hydratedSurfaceScenarios",
      rootSelector: '[data-iab-hydrated-scenario-id="admin-operational-forms"]',
      targetSelector: '[data-testid="iab-admin-session-grant-ack"]',
      targetTestId: "iab-admin-session-grant-ack",
      expectedText: "Granted GlobalMod",
      minTouchTargetPx: 44,
    },
    {
      id: "player-private-disclosure-vote-and-post",
      role: "player",
      source: "manifest.hydratedSurfaceScenarios",
      rootSelector:
        '[data-iab-hydrated-scenario-id="player-private-disclosure-vote-and-post"]',
      targetSelector: '[data-testid="iab-player-private-toggle"]',
      targetTestId: "iab-player-private-toggle",
      expectedText: "Private item",
      minTouchTargetPx: 44,
      disclosure: {
        detailSelector: '[data-testid="iab-player-private-detail"]',
        expectedBefore: "false",
        expectedAfter: "true",
      },
    },
    {
      id: "moderator-host-prompt-confirmation",
      role: "moderator",
      source: "manifest.hydratedSurfaceScenarios",
      rootSelector:
        '[data-iab-hydrated-scenario-id="moderator-host-prompt-confirmation"]',
      targetSelector: '[data-testid="iab-moderator-prompt-confirm"]',
      targetTestId: "iab-moderator-prompt-confirm",
      expectedText: "Confirm host prompt",
      minTouchTargetPx: 44,
    },
    {
      id: "moderator-slot-lifecycle-confirmation",
      role: "moderator",
      source: "manifest.hydratedSurfaceScenarios",
      rootSelector:
        '[data-iab-hydrated-scenario-id="moderator-slot-lifecycle-confirmation"]',
      targetSelector: '[data-testid="iab-moderator-slot-lifecycle-confirm"]',
      targetTestId: "iab-moderator-slot-lifecycle-confirm",
      expectedText: "Confirm slot lifecycle",
      minTouchTargetPx: 44,
    },
  ];
}

async function proveFixtureInteraction(page, scenario, viewport) {
  const root = page.locator(scenario.rootSelector);
  await root.waitFor({ state: "visible" });
  const target = root.locator(scenario.targetSelector);
  const count = await target.count();
  if (count !== 1) {
    throw new Error(
      `${scenario.id} ${viewport.name} expected one target, found ${count}`,
    );
  }
  const text = await root.textContent();
  if (!text?.includes(scenario.expectedText)) {
    throw new Error(
      `${scenario.id} ${viewport.name} target text missed ${scenario.expectedText}`,
    );
  }
  if (scenario.expectedHref !== undefined) {
    const href = await target.getAttribute("href");
    if (href !== scenario.expectedHref) {
      throw new Error(
        `${scenario.id} ${viewport.name} href ${href}, expected ${scenario.expectedHref}`,
      );
    }
  }

  const disclosureBefore = scenario.disclosure
    ? await readDisclosure(page, scenario)
    : undefined;
  if (
    scenario.disclosure &&
    disclosureBefore.ariaExpanded !== scenario.disclosure.expectedBefore
  ) {
    throw new Error(
      `${scenario.id} ${viewport.name} disclosure before ${disclosureBefore.ariaExpanded}, expected ${scenario.disclosure.expectedBefore}`,
    );
  }

  const box = await target.boundingBox();
  if (box === null || box.width <= 0 || box.height <= 0) {
    throw new Error(`${scenario.id} ${viewport.name} target had no visible box`);
  }
  if (box.width < scenario.minTouchTargetPx || box.height < scenario.minTouchTargetPx) {
    throw new Error(
      `${scenario.id} ${viewport.name} target was ${box.width}x${box.height}, expected at least ${scenario.minTouchTargetPx}`,
    );
  }
  const routeEvidence = await proveRouteContract(page, scenario, viewport);
  const errorSurfaceEvidence = await proveErrorSurfaceContract(page, scenario, viewport);
  const confirmationEvidence = await proveConfirmationContract(page, scenario, viewport);

  await target.click();
  const click = await page.evaluate((scenarioId) => {
    const clicks = globalThis.__fmarchIabProof?.clicks ?? [];
    return clicks.findLast((entry) => entry.scenarioId === scenarioId) ?? null;
  }, scenario.id);
  if (click === null) {
    throw new Error(`${scenario.id} ${viewport.name} did not record fixture click`);
  }
  if (scenario.targetTestId !== undefined && click.testId !== scenario.targetTestId) {
    throw new Error(
      `${scenario.id} ${viewport.name} clicked ${click.testId}, expected ${scenario.targetTestId}`,
    );
  }
  if (scenario.targetAction !== undefined && click.action !== scenario.targetAction) {
    throw new Error(
      `${scenario.id} ${viewport.name} clicked ${click.action}, expected ${scenario.targetAction}`,
    );
  }

  const activeElement = await page.evaluate(() => {
    const element = document.activeElement;
    return {
      tagName: element?.tagName?.toLowerCase() ?? null,
      testId: element?.getAttribute("data-testid"),
      action: element?.getAttribute("data-action"),
    };
  });
  if (
    scenario.targetTestId !== undefined &&
    activeElement.testId !== scenario.targetTestId
  ) {
    throw new Error(
      `${scenario.id} ${viewport.name} focused ${activeElement.testId}, expected ${scenario.targetTestId}`,
    );
  }
  if (
    scenario.targetAction !== undefined &&
    activeElement.action !== scenario.targetAction
  ) {
    throw new Error(
      `${scenario.id} ${viewport.name} focused ${activeElement.action}, expected ${scenario.targetAction}`,
    );
  }

  const disclosureAfter = scenario.disclosure
    ? await readDisclosure(page, scenario)
    : undefined;
  if (
    scenario.disclosure &&
    disclosureAfter.ariaExpanded !== scenario.disclosure.expectedAfter
  ) {
    throw new Error(
      `${scenario.id} ${viewport.name} disclosure after ${disclosureAfter.ariaExpanded}, expected ${scenario.disclosure.expectedAfter}`,
    );
  }

  return {
    id: scenario.id,
    role: scenario.role,
    source: scenario.source,
    targetSelector: scenario.targetSelector,
    targetTestId: scenario.targetTestId,
    targetAction: scenario.targetAction,
    clicked: click,
    activeElement,
    minTouchTargetPx: scenario.minTouchTargetPx,
    targetBox: box,
    route: routeEvidence,
    errorSurface: errorSurfaceEvidence,
    confirmation: confirmationEvidence,
    disclosureBefore,
    disclosureAfter,
  };
}

async function proveConfirmationContract(page, scenario, viewport) {
  if (scenario.confirmation === undefined) {
    return undefined;
  }
  const root = page.locator(scenario.rootSelector);
  const confirmation = root.locator('[data-testid="critical-host-action-confirmation"]');
  const confirmationRole = await confirmation.getAttribute("role");
  if (confirmationRole !== "alertdialog") {
    throw new Error(
      `${scenario.id} ${viewport.name} confirmation role ${confirmationRole}, expected alertdialog`,
    );
  }
  const messageText = (await confirmation.textContent())?.trim().replace(/\s+/gu, " ") ?? "";
  for (const label of [
    scenario.confirmation.objectLabel,
    scenario.confirmation.outcomeLabel,
  ]) {
    if (!messageText.includes(label)) {
      throw new Error(
        `${scenario.id} ${viewport.name} confirmation text missed ${label}`,
      );
    }
  }
  return {
    actionId: scenario.confirmation.actionId,
    payloadKind: scenario.confirmation.payloadKind,
    objectLabel: scenario.confirmation.objectLabel,
    outcomeLabel: scenario.confirmation.outcomeLabel,
    role: confirmationRole,
    initialFocusTestId: await confirmation.getAttribute("data-initial-focus-testid"),
    returnFocusTestId: await confirmation.getAttribute("data-return-focus-testid"),
    escapeCancels: await confirmation.getAttribute("data-escape-cancels"),
    tabContainment: await confirmation.getAttribute("data-tab-containment"),
    messageText,
  };
}

async function proveRouteContract(page, scenario, viewport) {
  if (scenario.route === undefined) {
    return undefined;
  }
  const root = page.locator(scenario.rootSelector);
  const activeChannel = root.getByTestId(scenario.route.activeChannelTestId);
  await activeChannel.waitFor({ state: "visible" });
  const activeChannelHref = await activeChannel.getAttribute("href");
  const activeChannelCurrent = await activeChannel.getAttribute("aria-current");
  if (activeChannelHref !== scenario.route.activeChannelHref) {
    throw new Error(
      `${scenario.id} ${viewport.name} active channel href ${activeChannelHref}, expected ${scenario.route.activeChannelHref}`,
    );
  }
  if (activeChannelCurrent !== "page") {
    throw new Error(
      `${scenario.id} ${viewport.name} active channel aria-current ${activeChannelCurrent}, expected page`,
    );
  }

  const privateReview = root.locator(`a[href="${scenario.route.privateReviewHref}"]`);
  const privateReviewCount = await privateReview.count();
  if (privateReviewCount < 1) {
    throw new Error(
      `${scenario.id} ${viewport.name} expected private review href ${scenario.route.privateReviewHref}`,
    );
  }
  return {
    path: scenario.route.path,
    activeChannelTestId: scenario.route.activeChannelTestId,
    activeChannelHref,
    activeChannelCurrent,
    privateReviewHref: scenario.route.privateReviewHref,
  };
}

async function proveErrorSurfaceContract(page, scenario, viewport) {
  if (scenario.errorSurface === undefined) {
    return undefined;
  }
  const root = page.locator(scenario.rootSelector);
  const surface = root.getByTestId(scenario.errorSurface.surfaceTestId);
  await surface.waitFor({ state: "visible" });
  const status = await surface.getAttribute("data-status");
  if (status !== String(scenario.errorSurface.status)) {
    throw new Error(
      `${scenario.id} ${viewport.name} error status ${status}, expected ${scenario.errorSurface.status}`,
    );
  }
  const action = root.getByTestId(scenario.targetTestId);
  const href = await action.getAttribute("href");
  if (href !== scenario.errorSurface.actionHref) {
    throw new Error(
      `${scenario.id} ${viewport.name} action href ${href}, expected ${scenario.errorSurface.actionHref}`,
    );
  }
  const activeNav = root.getByTestId(scenario.errorSurface.activeNavTestId);
  const activeNavCurrent = await activeNav.getAttribute("aria-current");
  if (activeNavCurrent !== "page") {
    throw new Error(
      `${scenario.id} ${viewport.name} active nav ${activeNavCurrent}, expected page`,
    );
  }
  const text = await root.textContent();
  for (const expected of [
    scenario.errorSurface.path,
    scenario.errorSurface.sessionPrincipal,
    scenario.errorSurface.capabilitySummary,
  ]) {
    if (!text?.includes(expected)) {
      throw new Error(
        `${scenario.id} ${viewport.name} error surface missed ${expected}`,
      );
    }
  }
  return {
    path: scenario.errorSurface.path,
    status: scenario.errorSurface.status,
    surfaceTestId: scenario.errorSurface.surfaceTestId,
    panelTestId: scenario.errorSurface.panelTestId,
    actionHref: href,
    activeNavTestId: scenario.errorSurface.activeNavTestId,
    activeNavCurrent,
    sessionPrincipal: scenario.errorSurface.sessionPrincipal,
    capabilitySummary: scenario.errorSurface.capabilitySummary,
  };
}

async function readDisclosure(page, scenario) {
  return page.evaluate(
    ({ targetSelector, detailSelector }) => {
      const control = document.querySelector(targetSelector);
      const detail = document.querySelector(detailSelector);
      return {
        ariaExpanded: control?.getAttribute("aria-expanded") ?? null,
        detailHidden: detail?.hasAttribute("hidden") ?? null,
      };
    },
    {
      targetSelector: scenario.targetSelector,
      detailSelector: scenario.disclosure.detailSelector,
    },
  );
}

async function proveStabilityCheck(page, check, viewport) {
  const root = page.locator(check.rootSelector);
  await root.waitFor({ state: "visible" });
  const tiles = [];
  for (const tile of check.tiles) {
    const tileRoot = root.locator(tile.tileSelector);
    const trigger = tileRoot.locator(tile.triggerSelector).first();
    const floor = tileRoot.locator(tile.statusFloorSelector);
    if (await tileRoot.count() !== 1) {
      throw new Error(`${check.id} ${tile.id} ${viewport.name} tile missing`);
    }
    if (await floor.count() !== 1) {
      throw new Error(`${check.id} ${tile.id} ${viewport.name} status floor missing`);
    }
    const floorMin = await floor.getAttribute("data-status-floor-min-px");
    if (floorMin !== String(check.statusFloorMinBlockSizePx)) {
      throw new Error(
        `${check.id} ${tile.id} ${viewport.name} status floor metadata ${floorMin}, expected ${check.statusFloorMinBlockSizePx}`,
      );
    }
    const triggerBox = await trigger.boundingBox();
    const floorBox = await floor.boundingBox();
    if (triggerBox === null || floorBox === null) {
      throw new Error(`${check.id} ${tile.id} ${viewport.name} trigger/floor invisible`);
    }
    if (floorBox.height < check.statusFloorMinBlockSizePx) {
      throw new Error(
        `${check.id} ${tile.id} ${viewport.name} floor height ${floorBox.height}, expected at least ${check.statusFloorMinBlockSizePx}`,
      );
    }
    if (triggerBox.y > floorBox.y) {
      throw new Error(
        `${check.id} ${tile.id} ${viewport.name} trigger appeared below status floor`,
      );
    }
    tiles.push({
      id: tile.id,
      tileSelector: tile.tileSelector,
      triggerSelector: tile.triggerSelector,
      statusFloorSelector: tile.statusFloorSelector,
      triggerBox,
      statusFloorBox: floorBox,
      statusFloorMinBlockSizePx: Number(floorMin),
      triggerPrecedesStatusFloor: true,
    });
  }
  return {
    id: check.id,
    role: check.role,
    surfaceId: check.surfaceId,
    mode: check.mode,
    statusFloorMinBlockSizePx: check.statusFloorMinBlockSizePx,
    tileCount: tiles.length,
    tiles,
  };
}

async function runInteractionPageContract() {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["tools/frontend_in_app_browser_interaction_page.mjs"],
      {
        cwd: repoRoot,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`frontend in-app interaction page failed with exit ${code}`);
  }
}

async function writeBlocked({ status, boundary, error }) {
  const plannedInteractions = manifest === undefined
    ? []
    : summarizePlannedInteractions(interactionScenarios(manifest));
  const evidence = {
    status,
    proof,
    mode,
    regeneratedFixture,
    boundary,
    generatedFrom: {
      manifest: "target/frontend-in-app-browser-interactions/interaction-page-manifest.json",
      servedFrom: serveLocalhost ? "target/frontend-in-app-browser-interactions" : undefined,
    },
    pageUrl,
    sourcePageUrl: manifest?.pageUrl,
    plannedInteractions,
    plannedStabilityChecks: manifest?.stabilityChecks ?? [],
    runs: [],
    error: {
      name: error?.name,
      message: error?.message,
    },
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `frontend in-app browser fixture smoke ${status}; wrote ${path.relative(
      repoRoot,
      evidencePath,
    )}`,
  );
}

async function startFixtureServer(rootDir) {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = requestUrl.pathname === "/"
        ? "/interaction-page.html"
        : requestUrl.pathname;
      const filePath = path.resolve(rootDir, `.${pathname}`);
      if (!filePath.startsWith(`${path.resolve(rootDir)}${path.sep}`)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": contentType(filePath),
        "cache-control": "no-store",
      });
      response.end(body);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500);
      response.end(error?.code === "ENOENT" ? "Not found" : "Fixture server error");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function contentType(filePath) {
  switch (path.extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function blockedLaunchBoundary() {
  if (serveLocalhost) {
    return replayExistingFixture
      ? "The existing in-app browser fixture was served from localhost without regenerating SSR artifacts, but Chromium could not launch in this sandbox. No localhost browser navigation, native click delivery, focus landing, touch geometry, disclosure toggle, or screenshot pixels were exercised."
      : "The generated in-app browser fixture was served from localhost, but Chromium could not launch in this sandbox. No localhost browser navigation, native click delivery, focus landing, touch geometry, disclosure toggle, or screenshot pixels were exercised.";
  }
  return replayExistingFixture
    ? "The existing file-backed in-app browser fixture manifest was loaded without regenerating SSR artifacts, but Chromium could not launch in this sandbox. No file URL navigation, native click delivery, focus landing, touch geometry, disclosure toggle, or screenshot pixels were exercised."
    : "The file-backed in-app browser fixture was generated, but Chromium could not launch in this sandbox. No file URL navigation, native click delivery, focus landing, touch geometry, disclosure toggle, or screenshot pixels were exercised.";
}

function navigationBlockedBoundary() {
  if (serveLocalhost) {
    return replayExistingFixture
      ? "The existing in-app browser fixture was served from localhost without regenerating SSR artifacts and Chromium launched, but the browser-run proof could not complete localhost navigation or control exercise. No localhost browser evidence from this fixture should be promoted."
      : "The in-app browser fixture was generated, served from localhost, and Chromium launched, but the browser-run proof could not complete localhost navigation or control exercise. No localhost browser evidence from this fixture should be promoted.";
  }
  return replayExistingFixture
    ? "The existing file-backed in-app browser fixture was loaded without regenerating SSR artifacts and Chromium launched, but the browser-run proof could not complete file URL navigation or control exercise. No browser evidence from this fixture should be promoted."
    : "The file-backed in-app browser fixture was generated and Chromium launched, but the browser-run proof could not complete file URL navigation or control exercise. No browser evidence from this fixture should be promoted.";
}

function passedBoundary() {
  if (serveLocalhost) {
    return replayExistingFixture
      ? "Serves the existing in-app browser fixture over localhost without regenerating SSR artifacts first. It proves localhost browser navigation to the prepared page, click delivery, focus landing, 44px touch geometry, player private-channel route evidence, player disclosure toggle behavior, all 10 moderator critical host confirmation metadata records, and nonblank screenshot pixels for the fixture controls across the proof viewports. It does not prove fixture freshness, Svelte client hydration, Svelte event scheduling, command dispatch side effects, dev-server routing, TCP transport, WebSocket delivery, or full localhost app acceptance."
      : "Serves the generated in-app browser fixture over localhost. It proves localhost browser navigation to the prepared page, click delivery, focus landing, 44px touch geometry, player private-channel route evidence, player disclosure toggle behavior, all 10 moderator critical host confirmation metadata records, and nonblank screenshot pixels for the fixture controls across the proof viewports. It does not prove Svelte client hydration, Svelte event scheduling, command dispatch side effects, dev-server routing, TCP transport, WebSocket delivery, or full localhost app acceptance.";
  }
  return replayExistingFixture
    ? "Loads the existing file-backed in-app browser fixture in Chromium using its file URL without regenerating SSR artifacts first. It proves native browser navigation to the prepared page, click delivery, focus landing, 44px touch geometry, player private-channel route evidence, player disclosure toggle behavior, all 10 moderator critical host confirmation metadata records, and nonblank screenshot pixels for the fixture controls across the proof viewports. It does not prove fixture freshness, Svelte client hydration, Svelte event scheduling, command dispatch side effects, dev-server routing, TCP/network transport, WebSocket delivery, or localhost-backed app acceptance."
    : "Loads the generated file-backed in-app browser fixture in Chromium using its file URL. It proves native browser navigation to the prepared page, click delivery, focus landing, 44px touch geometry, player private-channel route evidence, player disclosure toggle behavior, all 10 moderator critical host confirmation metadata records, and nonblank screenshot pixels for the fixture controls across the proof viewports. It does not prove Svelte client hydration, Svelte event scheduling, command dispatch side effects, dev-server routing, TCP/network transport, WebSocket delivery, or localhost-backed app acceptance.";
}

function summarizePlannedInteractions(scenarios) {
  return scenarios.map((scenario) => ({
    id: scenario.id,
    role: scenario.role,
    source: scenario.source,
    targetSelector: scenario.targetSelector,
    targetTestId: scenario.targetTestId,
    targetAction: scenario.targetAction,
    minTouchTargetPx: scenario.minTouchTargetPx,
    route: scenario.route,
    errorSurface: scenario.errorSurface,
    confirmation: scenario.confirmation,
    disclosure: scenario.disclosure,
  }));
}
