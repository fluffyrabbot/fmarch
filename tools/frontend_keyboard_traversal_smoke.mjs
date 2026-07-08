import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import {
  boardScenario,
  routeStateScenarios,
  roles,
  viewports,
} from "./frontend_role_smoke_scenarios.mjs";
import { loadRenderCss } from "./frontend_render_css.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-keyboard-traversal");
const evidencePath = path.join(artifactDir, "keyboard-traversal.json");
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
    proof: "chromium-ssr-keyboard-traversal",
    boundary:
      "Loads build-mode Svelte SSR markup into Chromium with page.setContent, without opening a TCP listener. This proves real browser Tab traversal, visible focus outlines, disabled-control exclusion, and shared skip-link-first keyboard order for the board, admin, player, moderator, and route-state surfaces. It does not prove Svelte hydration, dev-server routing, command dispatch, pointer behavior, fetch mocks, TCP transport, or WebSocket delivery.",
    viewports,
    surfaces: [],
    routeStates: [],
  };

  for (const viewport of viewports) {
    for (const scenario of surfaceScenarios()) {
      const page = await newPage(viewport);
      const rendered = await bundle[scenario.render]();
      await setRenderedContent(page, rendered, css);
      await page.locator(scenario.rootSelector).waitFor({ state: "visible" });
      const traversal = await assertFocusTraversal(page, {
        label: `${scenario.id} ${viewport.name}`,
        ...scenario.focus,
      });
      evidence.surfaces.push({
        id: scenario.id,
        role: scenario.role,
        viewport,
        render: scenario.render,
        rootSelector: scenario.rootSelector,
        focusTraversal: traversal,
      });
      await page.close();
    }

    for (const scenario of routeStateScenarios) {
      const page = await newPage(viewport);
      const rendered = await bundle.renderScenario(scenario.role, scenario.state);
      await setRenderedContent(page, rendered, css);
      await page.getByTestId(scenario.rootTestId).waitFor({ state: "visible" });
      const traversal = await assertFocusTraversal(page, {
        label: `${scenario.id} ${viewport.name}`,
        ...scenario.focus,
      });
      evidence.routeStates.push({
        id: scenario.id,
        role: scenario.role,
        state: scenario.state,
        viewport,
        path: scenario.path,
        rootTestId: scenario.rootTestId,
        actionTestId: scenario.actionTestId,
        focusTraversal: traversal,
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
  return [
    {
      id: "board",
      role: "board",
      render: "renderBoardPlayerSurface",
      rootSelector: '[data-testid="board-surface"]',
      focus: boardScenario.focus,
    },
    ...roles.map((role) => ({
      id: role.id,
      role: role.id,
      render: roleRenderFunction(role.id),
      rootSelector: `[data-testid="${role.surfaceTestId}"]`,
      focus: role.focus,
    })),
  ];
}

function roleRenderFunction(role) {
  if (role === "admin") {
    return "renderAdminSurface";
  }
  if (role === "player") {
    return "renderPlayerSurface";
  }
  if (role === "moderator") {
    return "renderModeratorSurface";
  }
  throw new Error(`unknown keyboard traversal role ${role}`);
}

async function assertFocusTraversal(
  page,
  { label, expectedOrder, forbiddenTestIds = [], maxTabs = 48 },
) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  const sequence = [];
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab");
    const focus = await readFocusedElement(page);
    if (focus === null) {
      continue;
    }
    if (!focus.visibleOutline) {
      throw new Error(
        `${label} focus stop ${focus.label} did not expose a visible focus outline`,
      );
    }
    sequence.push(focus);
    if (containsOrderedFocus(sequence, expectedOrder)) {
      break;
    }
  }

  const focusedTestIds = sequence.map((item) => item.testId).filter(Boolean);
  for (const forbidden of forbiddenTestIds) {
    if (focusedTestIds.includes(forbidden)) {
      throw new Error(`${label} focused disabled or denied control ${forbidden}`);
    }
  }
  if (!containsOrderedFocus(sequence, expectedOrder)) {
    throw new Error(
      `${label} focus order missed ${expectedOrder.join(" -> ")}; saw ${sequence
        .map((item) => item.label)
        .join(" -> ")}`,
    );
  }

  return {
    expectedOrder,
    forbiddenTestIds,
    sequence: sequence.map((item) => item.label),
    stops: sequence.map((item) => ({
      label: item.label,
      testId: item.testId,
      tagName: item.tagName,
      outlineStyle: item.outlineStyle,
      outlineWidth: item.outlineWidth,
    })),
  };
}

async function readFocusedElement(page) {
  return page.evaluate(() => {
    const node = document.activeElement;
    if (!(node instanceof HTMLElement) || node === document.body) {
      return null;
    }
    const owner = node.closest("[data-testid]");
    const testId = owner?.getAttribute("data-testid") ?? null;
    const actionId = node.closest("[data-action-id]")?.getAttribute("data-action-id") ?? null;
    const dataAction = node.getAttribute("data-action");
    const label =
      testId ??
      dataAction ??
      actionId ??
      node.getAttribute("aria-label") ??
      node.textContent?.trim() ??
      node.tagName.toLowerCase();
    const style = window.getComputedStyle(node);
    const outlineWidth = Number.parseFloat(style.outlineWidth);
    const visibleOutline =
      style.outlineStyle !== "none" && Number.isFinite(outlineWidth) && outlineWidth > 0;
    return {
      label,
      testId,
      tagName: node.tagName.toLowerCase(),
      visibleOutline,
      outlineStyle: style.outlineStyle,
      outlineWidth,
    };
  });
}

function containsOrderedFocus(sequence, expectedOrder) {
  let cursor = 0;
  for (const item of sequence) {
    if (item.testId === expectedOrder[cursor] || item.label === expectedOrder[cursor]) {
      cursor += 1;
      if (cursor === expectedOrder.length) {
        return true;
      }
    }
  }
  return expectedOrder.length === 0;
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
    proof: "chromium-ssr-keyboard-traversal",
    boundary:
      "Build-mode Svelte SSR route-state render passed, but Chromium could not launch in this sandbox. No no-bind browser Tab traversal, visible focus outline, disabled-control exclusion, client hydration, pointer, or network behavior was exercised.",
    routeStateRenderArtifact:
      "target/frontend-route-state-render/route-state-render.json",
    surfaces: [],
    routeStates: [],
    error: {
      name: error?.name,
      message: error?.message,
    },
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `frontend keyboard traversal smoke blocked at Chromium launch; wrote ${path.relative(
      repoRoot,
      evidencePath,
    )}`,
  );
}
