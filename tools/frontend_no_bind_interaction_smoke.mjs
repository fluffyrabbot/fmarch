import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { viewports } from "./frontend_role_smoke_scenarios.mjs";
import { loadRenderCss } from "./frontend_render_css.mjs";
import { noBindCommandScenarioDefs } from "./frontend_proof_scenarios.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-no-bind-interactions");
const evidencePath = path.join(artifactDir, "no-bind-interactions.json");
const routeStateBundle = path.join(
  repoRoot,
  "target",
  "frontend-route-state-render",
  "bundle",
  "entry.js",
);
const MEDIA_FIXTURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGUlEQVR42mP8z8Dwn4GBgYGJgYGB4T8ABYsCBbpn0ZQAAAAASUVORK5CYII=",
  "base64",
);
const PLAYER_MEDIA_ALLOWED_VARIANTS = Object.freeze([
  "tablet",
  "small",
  "thumb",
  "thumbnail",
]);

await mkdir(artifactDir, { recursive: true });
await runRouteStateRenderContract();

const bundle = await import(`${pathToFileURL(routeStateBundle).href}?t=${Date.now()}`);
const css = await loadRenderCss({ repoRoot });
const scenarios = await interactionScenarios();
let browser;

try {
  try {
    browser = await chromium.launch();
  } catch (error) {
    await writeChromiumLaunchBlocked(error, scenarios);
    process.exit(0);
  }

  const evidence = {
    status: "passed",
    proof: "chromium-ssr-no-bind-interactions",
    boundary:
      "Loads build-mode Svelte SSR markup into Chromium with page.setContent, without opening a TCP listener. It proves real browser hit-testing, click delivery to the expected command controls, focus landing after click, and touch target geometry for representative admin, player, player private-channel controls plus every moderator critical host confirmation. It does not prove Svelte client hydration, Svelte event scheduling, command dispatch side effects, dev-server routing, TCP/network transport, or WebSocket delivery.",
    viewports,
    plannedInteractions: summarizeInteractionScenarios(scenarios),
    interactions: {
      admin: [],
      player: [],
      moderator: [],
    },
  };

  for (const viewport of viewports) {
    for (const scenario of scenarios) {
      const page = await newPage(viewport);
      const rendered = await bundle[scenario.render](...(scenario.renderArgs ?? []));
      await setRenderedContent(page, rendered, css);
      const result = await proveInteraction(page, scenario, viewport);
      evidence.interactions[scenario.role].push(result);
      await page.close();
    }
  }

  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} finally {
  await browser?.close();
}

async function interactionScenarios() {
  const manifest = await bundle.renderModeratorCriticalActionManifest();
  return [
    ...noBindCommandScenarioDefs(),
    ...manifest.actions.map(moderatorCriticalConfirmationScenario),
  ];
}

function moderatorCriticalConfirmationScenario(action) {
  return {
    id: `moderator-${action.id}-confirm-click`,
    role: "moderator",
    render: "renderModeratorActionConfirmation",
    renderArgs: [action.id],
    targetSelector: '[data-testid="critical-host-action-confirm"]',
    targetTestId: "critical-host-action-confirm",
    rootSelector: '[data-testid="critical-host-action-confirmation"]',
    expectedText: action.outcomeLabel,
    minTouchTargetPx: 44,
    confirmation: {
      actionId: action.id,
      payloadKind: action.payloadKind,
      objectLabel: action.objectLabel,
      outcomeLabel: action.outcomeLabel,
    },
  };
}

async function proveInteraction(page, scenario, viewport) {
  await page.locator(scenario.rootSelector).waitFor({ state: "visible" });
  const target = page.locator(scenario.targetSelector);
  const count = await target.count();
  if (count !== 1) {
    throw new Error(
      `${scenario.id} ${viewport.name} expected one target, found ${count}`,
    );
  }
  const text = await page.textContent("body");
  if (!text?.includes(scenario.expectedText)) {
    throw new Error(
      `${scenario.id} ${viewport.name} missing ${scenario.expectedText}`,
    );
  }

  await installClickProbe(page);
  const box = await target.boundingBox();
  if (box === null || box.width <= 0 || box.height <= 0) {
    throw new Error(`${scenario.id} ${viewport.name} target had no visible box`);
  }
  if (box.width < scenario.minTouchTargetPx || box.height < scenario.minTouchTargetPx) {
    throw new Error(
      `${scenario.id} ${viewport.name} target was ${box.width}x${box.height}, expected at least ${scenario.minTouchTargetPx}`,
    );
  }
  const formEvidence = await proveFormContract(page, scenario, viewport);
  const routeEvidence = await proveRouteContract(page, scenario, viewport);
  const mediaEvidence = await proveMediaContract(page, scenario, viewport);
  const confirmationEvidence = await proveConfirmationContract(page, scenario, viewport);

  await target.click();
  const clickProbe = await page.evaluate(() => globalThis.__fmarchClickProbe);
  if (clickProbe.length !== 1) {
    throw new Error(
      `${scenario.id} ${viewport.name} expected one click event, got ${clickProbe.length}`,
    );
  }
  const clicked = clickProbe[0];
  if (scenario.targetTestId !== undefined && clicked.testId !== scenario.targetTestId) {
    throw new Error(
      `${scenario.id} ${viewport.name} clicked ${clicked.testId}, expected ${scenario.targetTestId}`,
    );
  }
  if (scenario.targetAction !== undefined && clicked.action !== scenario.targetAction) {
    throw new Error(
      `${scenario.id} ${viewport.name} clicked ${clicked.action}, expected ${scenario.targetAction}`,
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

  return {
    id: scenario.id,
    role: scenario.role,
    viewport,
    render: scenario.render,
    renderArgs: scenario.renderArgs,
    targetSelector: scenario.targetSelector,
    targetTestId: scenario.targetTestId,
    targetAction: scenario.targetAction,
    form: formEvidence,
    route: routeEvidence,
    media: mediaEvidence,
    confirmation: confirmationEvidence,
    clicked,
    activeElement,
    minTouchTargetPx: scenario.minTouchTargetPx,
    targetBox: box,
  };
}

async function proveConfirmationContract(page, scenario, viewport) {
  if (scenario.confirmation === undefined) {
    return undefined;
  }
  const root = page.locator(
    `[data-component="host-action"][data-action-id="${scenario.confirmation.actionId}"]`,
  );
  const rootCount = await root.count();
  if (rootCount !== 1) {
    throw new Error(
      `${scenario.id} ${viewport.name} expected one host action root, found ${rootCount}`,
    );
  }
  const confirmation = page.locator(scenario.rootSelector);
  const confirmationRole = await confirmation.getAttribute("role");
  const message = confirmation.locator(
    '[data-testid="critical-host-action-confirmation-message"]',
  );
  const messageText = (await message.textContent())?.trim().replace(/\s+/gu, " ") ?? "";
  for (const label of [
    scenario.confirmation.objectLabel,
    scenario.confirmation.outcomeLabel,
  ]) {
    if (!messageText.includes(label)) {
      throw new Error(
        `${scenario.id} ${viewport.name} confirmation message missing ${label}`,
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
  const activeChannel = page.getByTestId(scenario.route.activeChannelTestId);
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

  const privateReview = page.locator(`a[href="${scenario.route.privateReviewHref}"]`);
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

async function proveMediaContract(page, scenario, viewport) {
  if (scenario.media === undefined) {
    return undefined;
  }
  const boundary = page.getByTestId(scenario.media.boundaryTestId);
  const media = page.getByTestId(scenario.media.mediaTestId);
  await boundary.waitFor({ state: "visible" });
  await media.waitFor({ state: "visible" });
  const box = await media.boundingBox();
  if (box === null || box.width <= 0 || box.height <= 0) {
    throw new Error(`${scenario.id} ${viewport.name} media had no visible box`);
  }
  const variant = await media.getAttribute("data-media-variant");
  if (variant !== scenario.media.expectedVariant) {
    throw new Error(
      `${scenario.id} ${viewport.name} media variant ${variant}, expected ${scenario.media.expectedVariant}`,
    );
  }
  const image = await media.locator("img").evaluate((node) => ({
    src: node.getAttribute("src"),
    srcset: node.getAttribute("srcset"),
    sizes: node.getAttribute("sizes"),
    currentSrc: node.currentSrc,
    complete: node.complete,
    naturalWidth: node.naturalWidth,
    naturalHeight: node.naturalHeight,
    alt: node.getAttribute("alt"),
  }));
  for (const [label, value] of [
    ["src", image.src],
    ["srcset", image.srcset],
    ["currentSrc", image.currentSrc],
  ]) {
    if (isForbiddenMediaUrl(value)) {
      throw new Error(`${scenario.id} ${viewport.name} media ${label} used ${value}`);
    }
  }
  const mediaRequests = page.__fmarchMediaRequests ?? [];
  const forbiddenRequests = mediaRequests.filter((request) =>
    isForbiddenMediaUrl(request.url),
  );
  if (forbiddenRequests.length > 0) {
    throw new Error(
      `${scenario.id} ${viewport.name} requested forbidden media ${JSON.stringify(
        forbiddenRequests,
      )}`,
    );
  }
  return {
    boundary:
      "No-bind Chromium proof over SSR markup verifies the player thread image element renders a tablet-safe variant, has a visible box, and does not expose original/full/desktop URLs in image attributes or routed media requests. This does not prove localhost app routing or Svelte hydration.",
    boundaryTestId: scenario.media.boundaryTestId,
    mediaTestId: scenario.media.mediaTestId,
    renderedVariant: variant,
    image,
    requested: mediaRequests.map((request) => ({ ...request })),
    allowedVariants: PLAYER_MEDIA_ALLOWED_VARIANTS,
    originalUrlRendered: false,
  };
}

async function proveFormContract(page, scenario, viewport) {
  if (scenario.form === undefined) {
    return undefined;
  }
  const form = page.locator(`${scenario.rootSelector} form`).first();
  const count = await form.count();
  if (count !== 1) {
    throw new Error(`${scenario.id} ${viewport.name} expected one form, found ${count}`);
  }
  const action = await form.getAttribute("action");
  if (action !== scenario.form.action) {
    throw new Error(
      `${scenario.id} ${viewport.name} form action ${action}, expected ${scenario.form.action}`,
    );
  }
  for (const testId of scenario.form.fieldTestIds ?? []) {
    const fieldCount = await form.locator(`[data-testid="${testId}"]`).count();
    if (fieldCount !== 1) {
      throw new Error(
        `${scenario.id} ${viewport.name} expected one form field ${testId}, found ${fieldCount}`,
      );
    }
  }
  for (const name of scenario.form.fieldNames ?? []) {
    const fieldCount = await form.locator(`[name="${name}"]`).count();
    if (fieldCount !== 1) {
      throw new Error(
        `${scenario.id} ${viewport.name} expected one form field name ${name}, found ${fieldCount}`,
      );
    }
  }
  return {
    action,
    fieldTestIds: scenario.form.fieldTestIds,
    fieldNames: scenario.form.fieldNames,
  };
}

async function installClickProbe(page) {
  await page.evaluate(() => {
    globalThis.__fmarchClickProbe = [];
    document.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
      },
      true,
    );
    document.addEventListener(
      "click",
      (event) => {
        const element = event.target.closest("[data-testid], [data-action]");
        globalThis.__fmarchClickProbe.push({
          tagName: element?.tagName?.toLowerCase() ?? null,
          testId: element?.getAttribute("data-testid"),
          action: element?.getAttribute("data-action"),
          text: element?.textContent?.trim().replace(/\s+/g, " ") ?? "",
        });
      },
      true,
    );
  });
}

async function newPage(viewport) {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
  });
  const page = await context.newPage();
  const mediaRequests = [];
  page.__fmarchMediaRequests = mediaRequests;
  await page.route("**/media/midsummer/thread/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    mediaRequests.push({
      url: requestUrl.pathname,
      variant: playerMediaVariantFromPath(requestUrl.pathname),
      resourceType: route.request().resourceType(),
    });
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: MEDIA_FIXTURE_PNG,
    });
  });
  page.on("close", () => context.close().catch(() => {}));
  return page;
}

function playerMediaVariantFromPath(pathname) {
  const match = pathname.match(/-(tablet|small|thumb|thumbnail|original|full|desktop)\./);
  return match?.[1] ?? "unknown";
}

function isForbiddenMediaUrl(value) {
  const text = String(value ?? "").toLowerCase();
  return (
    text.includes("-original.") ||
    text.includes("-full.") ||
    text.includes("-desktop.") ||
    text.includes("/original/") ||
    text.includes("/full/") ||
    text.includes("/desktop/")
  );
}

async function setRenderedContent(page, rendered, css) {
  await page.setContent(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <base href="https://fmarch.invalid/">
    ${rendered.head ?? ""}
    <style>${css}</style>
  </head>
  <body>${rendered.html}</body>
</html>`,
    { waitUntil: "load" },
  );
}

async function runRouteStateRenderContract() {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["tools/frontend_route_state_render_contract.mjs"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`frontend route-state render contract failed with exit ${code}`);
  }
}

function summarizeInteractionScenarios(scenarios) {
  return {
    admin: scenarios
      .filter((scenario) => scenario.role === "admin")
      .map(summarizeInteractionScenario),
    player: scenarios
      .filter((scenario) => scenario.role === "player")
      .map(summarizeInteractionScenario),
    moderator: scenarios
      .filter((scenario) => scenario.role === "moderator")
      .map(summarizeInteractionScenario),
  };
}

function summarizeInteractionScenario(scenario) {
  return {
    id: scenario.id,
    role: scenario.role,
    render: scenario.render,
    renderArgs: scenario.renderArgs,
    targetSelector: scenario.targetSelector,
    targetTestId: scenario.targetTestId,
    targetAction: scenario.targetAction,
    minTouchTargetPx: scenario.minTouchTargetPx,
    confirmation: scenario.confirmation,
  };
}

async function writeChromiumLaunchBlocked(error, plannedScenarios) {
  const evidence = {
    status: "chromium-launch-blocked",
    proof: "chromium-ssr-no-bind-interactions",
    boundary:
      "Build-mode Svelte SSR route-state render passed, but Chromium could not launch in this sandbox. No no-bind browser click delivery, focus landing, touch target geometry, client hydration, pointer, or network behavior was exercised.",
    routeStateRenderArtifact:
      "target/frontend-route-state-render/route-state-render.json",
    plannedInteractions: summarizeInteractionScenarios(plannedScenarios),
    interactions: {
      admin: [],
      player: [],
      moderator: [],
    },
    error: {
      name: error?.name,
      message: error?.message,
    },
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `frontend no-bind interaction smoke blocked at Chromium launch; wrote ${path.relative(
      repoRoot,
      evidencePath,
    )}`,
  );
}
