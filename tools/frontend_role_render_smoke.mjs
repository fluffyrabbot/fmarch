import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { captureScreenshotEvidence } from "./frontend_screenshot_pixels.mjs";
import {
  roles,
  routeStateScenarios,
  viewports,
} from "./frontend_role_smoke_scenarios.mjs";
import { loadRenderCss } from "./frontend_render_css.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-role-render-smoke");
const evidencePath = path.join(artifactDir, "render-smoke.json");
const routeStateBundle = path.join(
  repoRoot,
  "target",
  "frontend-route-state-render",
  "bundle",
  "entry.js",
);

await mkdir(artifactDir, { recursive: true });
await runRouteStateRenderContract();

const bundle = await import(`${pathToFileURL(routeStateBundle).href}?t=${Date.now()}`);
const css = await loadRenderCss({ repoRoot });
let browser;

try {
  try {
    browser = await chromium.launch();
  } catch (error) {
    await writeChromiumLaunchBlocked(error);
    process.exit(0);
  }
  const evidence = {
    status: "passed",
    proof: "chromium-ssr-no-bind-render",
    boundary:
      "Loads build-mode Svelte SSR markup into Chromium with page.setContent, without opening a TCP listener. This proves rendered DOM visibility, touch target geometry, obvious-overlap checks, active feedback-rail status geometry, and nonblank screenshots for the shared shell and role surfaces. It does not prove Svelte hydration, real navigation, pointer events, command dispatch, fetch mocks, WebSocket behavior, or focus traversal; the localhost browser smoke remains the authority for those when binding is available.",
    viewports,
    surfaces: [],
    feedbackRails: [],
    routeStates: [],
  };

  for (const viewport of viewports) {
    for (const surface of surfaceScenarios()) {
      const page = await newPage(viewport);
      const rendered = await bundle[surface.render]();
      await setRenderedContent(page, rendered, css);
      await page.getByTestId(surface.surfaceTestId).waitFor({ state: "visible" });
      const text = await page.textContent("body");
      for (const requiredText of surface.requiredText) {
        if (!text?.includes(requiredText)) {
          throw new Error(`${surface.id} ${viewport.name} missing ${requiredText}`);
        }
      }
      for (const selector of surface.requiredSelectors) {
        await page.locator(selector).waitFor({ state: "visible" });
      }
      const surfaceTarget = {
        label: `${surface.id} ${viewport.name}`,
        box: await assertVisibleBox(
          page.getByTestId(surface.surfaceTestId),
          `${surface.id} ${viewport.name}`,
        ),
      };
      const touchTargets = await assertTouchTargets(page, {
        id: surface.id,
        viewport,
      });
      const thumbZones = await assertThumbZones(page, surface, { viewport });
      await assertNoObviousOverlap([surfaceTarget, ...touchTargets, ...thumbZones.targets], {
        id: surface.id,
        viewport,
      });
      const screenshot = path.join(
        artifactDir,
        `${viewport.name}-${surface.id}.png`,
      );
      const screenshotPixels = await captureScreenshotEvidence(page, {
        path: screenshot,
        label: `${surface.id} ${viewport.name}`,
        viewport,
      });
      evidence.surfaces.push({
        id: surface.id,
        role: surface.role,
        viewport,
        path: surface.path,
        surfaceTestId: surface.surfaceTestId,
        requiredText: surface.requiredText,
        requiredSelectors: surface.requiredSelectors,
        touchTargetsChecked: touchTargets.length,
        thumbZones: thumbZones.zones,
        overlapCheckedTargets: 1 + touchTargets.length + thumbZones.targets.length,
        screenshot: path.relative(repoRoot, screenshot),
        screenshotPixels,
      });
      await page.close();
    }

    for (const rail of feedbackRailScenarios()) {
      const page = await newPage(viewport);
      const rendered = await bundle[rail.render]();
      await setRenderedContent(page, rendered, css);
      await page.getByTestId(rail.surfaceTestId).waitFor({ state: "visible" });
      const text = await page.textContent("body");
      for (const requiredText of rail.requiredText) {
        if (!text?.includes(requiredText)) {
          throw new Error(`${rail.id} ${viewport.name} missing ${requiredText}`);
        }
      }
      const geometry = await assertFeedbackRailGeometry(page, rail, { viewport });
      const screenshot = path.join(
        artifactDir,
        `${viewport.name}-${rail.id}.png`,
      );
      const screenshotPixels = await captureScreenshotEvidence(page, {
        path: screenshot,
        label: `${rail.id} ${viewport.name}`,
        viewport,
      });
      evidence.feedbackRails.push({
        id: rail.id,
        role: rail.role,
        viewport,
        render: rail.render,
        surfaceTestId: rail.surfaceTestId,
        itemTestId: rail.itemTestId,
        statusTestId: rail.statusTestId,
        statusState: rail.statusState,
        requiredText: rail.requiredText,
        visibleBoxesChecked: geometry.visibleBoxesChecked,
        screenshot: path.relative(repoRoot, screenshot),
        screenshotPixels,
      });
      await page.close();
    }

    for (const scenario of routeStateScenarios) {
      const page = await newPage(viewport);
      const rendered = await bundle.renderScenario(scenario.role, scenario.state);
      await setRenderedContent(page, rendered, css);
      await page.getByTestId(scenario.rootTestId).waitFor({ state: "visible" });
      await page.getByTestId(scenario.statusTestId).waitFor({ state: "visible" });
      const screenshot = path.join(
        artifactDir,
        `${viewport.name}-${scenario.id}.png`,
      );
      const screenshotPixels = await captureScreenshotEvidence(page, {
        path: screenshot,
        label: `${scenario.id} ${viewport.name}`,
        viewport,
      });
      evidence.routeStates.push({
        id: scenario.id,
        role: scenario.role,
        state: scenario.state,
        viewport,
        path: scenario.path,
        rootTestId: scenario.rootTestId,
        statusTestId: scenario.statusTestId,
        screenshot: path.relative(repoRoot, screenshot),
        screenshotPixels,
      });
      await page.close();
    }
  }

  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} finally {
  await browser?.close();
}

function surfaceScenarios() {
  const roleById = new Map(roles.map((role) => [role.id, role]));
  return [
    {
      id: "board",
      role: "board",
      path: "/",
      render: "renderBoardSurface",
      surfaceTestId: "board-surface",
      requiredText: ["Active games", "Midsummer Invitational"],
      requiredSelectors: ['[data-testid="game-action-midsummer-player"]'],
    },
    {
      id: "admin",
      role: "admin",
      path: "/admin",
      render: "renderAdminSurface",
      surfaceTestId: "admin-surface",
      requiredText: ["Game setup", "Recovery"],
      requiredSelectors: ['[data-testid="admin-setup-session-grants"]'],
      thumbZones: roleById.get("admin")?.thumbZones ?? [],
    },
    {
      id: "admin-audit-detail",
      role: "admin",
      path: "/admin/audit/proof-runs?game=midsummer",
      render: "renderAdminAuditDetailSurface",
      surfaceTestId: "admin-audit-detail-surface",
      requiredText: ["Proof runs", "midsummer"],
      requiredSelectors: ['[data-testid="admin-audit-detail-back"]'],
    },
    {
      id: "player",
      role: "player",
      path: "/g/midsummer",
      render: "renderPlayerSurface",
      surfaceTestId: "player-surface",
      requiredText: ["Votecount", "Private queue"],
      requiredSelectors: [
        '[data-testid="player-role-card"][data-role-state="unassigned"]',
        '[data-testid="player-private-link-notification-1"]',
        '[data-testid="thread-post-media-receipt-442"][data-media-variant="tablet"]',
      ],
      thumbZones: roleById.get("player")?.thumbZones ?? [],
    },
    {
      id: "player-private-review",
      role: "player",
      path: "/g/midsummer?private=notification-1",
      render: "renderPlayerPrivateReviewRoute",
      surfaceTestId: "player-surface",
      requiredText: ["Private queue", "Phase N02"],
      requiredSelectors: [
        '[data-testid="player-private-review-notification-1"][aria-expanded="true"]',
        '[data-testid="player-private-detail-notification-1"]',
      ],
    },
    {
      id: "player-private-channel",
      role: "player",
      path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      render: "renderPlayerPrivateChannelRoute",
      surfaceTestId: "player-surface",
      requiredText: ["Role PM", "Private queue"],
      requiredSelectors: [
        '[data-testid="player-channel-private:role_pm:slot-7"][aria-current="page"]',
        '[data-testid="player-private-link-notification-1"][href="/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1"]',
        '[data-testid="thread-post-media-receipt-442"][data-media-variant="tablet"]',
      ],
    },
    {
      id: "player-endgame",
      role: "player",
      path: "/g/midsummer",
      render: "renderPlayerEndgameSummary",
      surfaceTestId: "player-endgame-summary",
      requiredText: ["Town wins", "Mafia goon"],
      requiredSelectors: [
        '[data-testid="player-endgame-winner"]',
        '[data-testid="player-endgame-reveal-slot-2"]',
        '[data-testid="player-endgame-reveal-slot-7"]',
      ],
    },
    {
      id: "moderator",
      role: "moderator",
      path: "/g/midsummer/host",
      render: "renderModeratorSurface",
      surfaceTestId: "host-console-surface",
      requiredText: ["Host console", "Votecount"],
      requiredSelectors: ['[data-testid="critical-host-action-extend_deadline"]'],
      thumbZones: roleById.get("moderator")?.thumbZones ?? [],
    },
  ];
}

function feedbackRailScenarios() {
  return [
    {
      id: "admin-command-activity-active",
      role: "admin",
      render: "renderAdminCommandActivity",
      surfaceTestId: "admin-command-activity",
      itemTestId: "admin-command-activity-recovery-gate",
      statusTestId: "admin-command-activity-status-recovery-gate",
      statusState: "ack",
      requiredText: ["Recovery gate trusted"],
    },
    {
      id: "player-command-receipt-active",
      role: "player",
      render: "renderPlayerCommandReceipt",
      surfaceTestId: "player-command-receipt",
      itemTestId: "player-command-receipt-submit_vote",
      statusTestId: "player-command-status",
      statusState: "reject",
      requiredText: ["Reject PhaseLocked"],
    },
    {
      id: "moderator-command-activity-active",
      role: "moderator",
      render: "renderModeratorCommandActivity",
      surfaceTestId: "host-command-activity",
      itemTestId: "host-command-activity-resolve_host_prompt-D01-skip_next_day-slot_1",
      statusTestId:
        "host-command-activity-status-resolve_host_prompt-D01-skip_next_day-slot_1",
      statusState: "ack",
      requiredText: ["Ack: host prompt resolved"],
    },
  ];
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
  page.on("close", () => context.close().catch(() => {}));
  return page;
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
  // fonts swapping in after load shifts boxes mid-measurement and flakes
  // the geometry checks; settle them before any boundingBox call
  await page.evaluate(() => document.fonts.ready);
}

async function assertFeedbackRailGeometry(page, rail, { viewport }) {
  const targets = [
    {
      label: `${rail.id} root`,
      locator: page.getByTestId(rail.surfaceTestId),
    },
    {
      label: `${rail.id} item`,
      locator: page.getByTestId(rail.itemTestId),
    },
    {
      label: `${rail.id} status`,
      locator: page.getByTestId(rail.statusTestId),
    },
  ];
  for (const target of targets) {
    const box = await assertVisibleBox(
      target.locator,
      `${target.label} ${viewport.name}`,
    );
    if (box.width > viewport.width || box.height > viewport.height) {
      throw new Error(
        `${target.label} ${viewport.name} exceeded viewport geometry ${box.width}x${box.height}`,
      );
    }
  }
  const status = page.getByTestId(rail.statusTestId);
  const state = await status.getAttribute("data-state");
  if (state !== rail.statusState) {
    throw new Error(
      `${rail.id} ${viewport.name} status was ${state}, expected ${rail.statusState}`,
    );
  }
  const ariaLive = await status.getAttribute("aria-live");
  if (!["polite", "assertive"].includes(ariaLive)) {
    throw new Error(`${rail.id} ${viewport.name} status missing live region`);
  }
  return {
    visibleBoxesChecked: targets.length,
  };
}

async function assertTouchTargets(page, { id, viewport }) {
  const handles = await page.locator("[data-min-touch-target-px]").elementHandles();
  if (handles.length === 0) {
    throw new Error(`${id} ${viewport.name} had no touch target metadata`);
  }
  const targets = [];
  for (let index = 0; index < handles.length; index += 1) {
    const handle = handles[index];
    const minTarget = Number(
      await handle.evaluate((node) => node.getAttribute("data-min-touch-target-px")),
    );
    const box = await handle.boundingBox();
    if (box === null) {
      continue;
    }
    if (box.width < minTarget || box.height < minTarget) {
      throw new Error(
        `${id} ${viewport.name} touch target ${index} was ${box.width}x${box.height}, expected at least ${minTarget}`,
      );
    }
    targets.push({
      label: `${id} touch target ${index}`,
      box,
    });
  }
  if (targets.length === 0) {
    throw new Error(`${id} ${viewport.name} had no visible touch targets`);
  }
  return targets;
}

async function assertThumbZones(page, surface, { viewport }) {
  const zones = [];
  const targets = [];
  for (const zone of surface.thumbZones ?? []) {
    const zoneLocator = page.getByTestId(zone.testId);
    const zoneBox = await assertVisibleBox(
      zoneLocator,
      `${surface.id} ${zone.testId} ${viewport.name}`,
    );
    const actualZone = await zoneLocator.getAttribute("data-thumb-zone");
    if (actualZone !== zone.zone) {
      throw new Error(
        `${surface.id} ${zone.testId} ${viewport.name} thumb zone ${actualZone}, expected ${zone.zone}`,
      );
    }
    const targetSummaries = [];
    for (const selector of zone.targetSelectors) {
      const target = zoneLocator.locator(selector);
      const count = await target.count();
      if (count !== 1) {
        throw new Error(
          `${surface.id} ${zone.testId} ${viewport.name} selector ${selector} resolved ${count} targets`,
        );
      }
      const box = await assertVisibleBox(
        target,
        `${surface.id} ${zone.testId} ${selector} ${viewport.name}`,
      );
      const minTouchTargetPx = Number(
        await target.getAttribute("data-min-touch-target-px"),
      );
      if (
        Number.isFinite(minTouchTargetPx) &&
        (box.width < minTouchTargetPx || box.height < minTouchTargetPx)
      ) {
        throw new Error(
          `${surface.id} ${zone.testId} ${selector} ${viewport.name} rendered ${box.width}x${box.height}, expected at least ${minTouchTargetPx}`,
        );
      }
      targets.push({
        label: `${surface.id} ${zone.testId} ${selector}`,
        box,
      });
      targetSummaries.push({
        selector,
        minTouchTargetPx: Number.isFinite(minTouchTargetPx)
          ? minTouchTargetPx
          : null,
        box,
      });
    }
    zones.push({
      testId: zone.testId,
      thumbZone: zone.zone,
      targetCount: targetSummaries.length,
      zoneBox,
      targets: targetSummaries,
    });
  }
  return { zones, targets };
}

async function assertVisibleBox(locator, label) {
  const box = await locator.boundingBox();
  if (box === null || box.width <= 0 || box.height <= 0) {
    throw new Error(`${label} did not expose a visible box`);
  }
  return box;
}

async function assertNoObviousOverlap(targets, { id, viewport }) {
  for (let left = 0; left < targets.length; left += 1) {
    for (let right = left + 1; right < targets.length; right += 1) {
      const overlap = overlapArea(targets[left].box, targets[right].box);
      if (overlap === 0) {
        continue;
      }
      const smallerArea = Math.min(area(targets[left].box), area(targets[right].box));
      if (overlap >= smallerArea * 0.99) {
        // Full containment is a container wrapping its own controls (surface
        // root, thumb zone) or the same control measured by two collectors,
        // not a collision; only partial overlap indicates stacked targets.
        continue;
      }
      if (overlap / smallerArea > 0.65) {
        throw new Error(
          `${id} ${viewport.name} has overlapping targets ${targets[left].label} and ${targets[right].label} (${JSON.stringify(targets[left].box)} vs ${JSON.stringify(targets[right].box)})`,
        );
      }
    }
  }
}

function overlapArea(left, right) {
  const x = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const y = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  return x * y;
}

function area(box) {
  return box.width * box.height;
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

async function writeChromiumLaunchBlocked(error) {
  const evidence = {
    status: "chromium-launch-blocked",
    proof: "chromium-ssr-no-bind-render",
    boundary:
      "Build-mode Svelte SSR route-state render passed, including active feedback-rail markup, but Chromium could not launch in this sandbox. No no-bind Chromium pixels, geometry, overlap, focus, pointer, or hydration behavior were exercised.",
    routeStateRenderArtifact:
      "target/frontend-route-state-render/route-state-render.json",
    error: {
      name: error?.name,
      message: error?.message,
    },
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `frontend role render smoke blocked at Chromium launch; wrote ${path.relative(
      repoRoot,
      evidencePath,
    )}`,
  );
}
