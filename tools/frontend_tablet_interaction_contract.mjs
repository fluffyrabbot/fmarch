import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MODERATOR_CRITICAL_ACTION_IDS } from "./frontend_proof_expectations.mjs";
import {
  ADMIN_SURFACE_CONTRACT,
} from "../frontend/src/lib/components/admin/admin-surface-model.mjs";
import {
  APP_SHELL_CONTRACT,
} from "../frontend/src/lib/app/app-shell-model.mjs";
import {
  HOST_TASK_WORKSPACE_CONTRACT,
} from "../frontend/src/lib/components/host-action/host-task-workspace.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend", "src");
const artifactDir = path.join(repoRoot, "target", "frontend-tablet-interaction");
const evidencePath = path.join(artifactDir, "tablet-interaction.json");
const routeStateBundle = path.join(
  repoRoot,
  "target",
  "frontend-route-state-render",
  "bundle",
  "entry.js",
);

const scannedExtensions = new Set([".css", ".html", ".svelte", ".js", ".mjs"]);
const tokenFilePath = "frontend/src/lib/styles/tokens.css";
const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/u;
const forbiddenPatterns = [
  {
    id: "hover-preload-trigger",
    pattern: /data-sveltekit-preload-data=["']hover["']/u,
    rationale: "Tablet-first app navigation should not make hover the preload trigger.",
  },
  {
    id: "css-hover-selector",
    pattern: /(^|[^A-Za-z-]):hover\b/u,
    rationale: "Hover selectors create affordances that cannot be required on tablet.",
  },
  {
    id: "hover-media-query",
    pattern: /@media\s*\([^)]*\bhover\s*:/u,
    rationale: "Hover media queries split the primary tablet interaction contract.",
  },
  {
    id: "mouse-enter-handler",
    pattern: /\b(?:on:)?mouse(?:enter|leave|over|out)\b/u,
    rationale: "Mouse hover handlers are not a tablet-first interaction primitive.",
  },
  {
    id: "pointer-enter-handler",
    pattern: /\b(?:on:)?pointer(?:enter|leave|over|out)\b/u,
    rationale: "Pointer hover handlers can hide behavior from touch-only users.",
  },
];

await mkdir(artifactDir, { recursive: true });

const sources = await scanSources(frontendRoot);
const forbiddenMatches = findForbiddenMatches(sources);
assert.deepEqual(forbiddenMatches, []);
const rawColorMatches = findRawColorLiterals(sources);
assert.deepEqual(rawColorMatches, []);

const appCss = await readFile(
  path.join(frontendRoot, "lib", "styles", "app.css"),
  "utf8",
);
const appHtml = await readFile(path.join(frontendRoot, "app.html"), "utf8");
const touchControlCss = await readFile(
  path.join(frontendRoot, "lib", "components", "host-action", "touch-control.css"),
  "utf8",
);

const rootAppHtml = proveRootAppHtml(appHtml);
const sharedAppCss = proveSharedAppCss(appCss);
const adminOperatorSurfaceCss = proveAdminOperatorSurfaceCss(
  {
    route: sourceText(sources, "frontend/src/routes/admin/+page.svelte"),
    setupComponent: sourceText(
      sources,
      "frontend/src/lib/components/admin/AdminSetupGrid.svelte",
    ),
    recoveryComponent: sourceText(
      sources,
      "frontend/src/lib/components/admin/AdminRecoveryPanel.svelte",
    ),
  },
);
const playerRouteLayoutCss = provePlayerRouteLayoutCss({
  route: sourceText(sources, "frontend/src/routes/g/[game]/+page.svelte"),
  frame: sourceText(
    sources,
    "frontend/src/lib/components/gameplay/GameFrame.svelte",
  ),
  dock: sourceText(
    sources,
    "frontend/src/lib/components/gameplay/ActionDock.svelte",
  ),
});
const moderatorControlSurfaceCss = proveModeratorControlSurfaceCss({
  css: sourceText(
    sources,
    "frontend/src/lib/components/host-action/host-console-critical-path.css",
  ),
  component: sourceText(
    sources,
    "frontend/src/lib/components/host-action/HostTaskWorkspace.svelte",
  ),
  route: sourceText(sources, "frontend/src/routes/g/[game]/host/+page.svelte"),
});
const hostTouchCss = proveHostTouchCss(touchControlCss);
await runRouteStateRenderContract();
const bundle = await import(`${pathToFileURL(routeStateBundle).href}?t=${Date.now()}`);
const thumbZones = await proveThumbZonePlacement(bundle);

const evidence = {
  status: "passed",
  proof: "frontend-tablet-interaction-contract",
  boundary:
    "Scans the current frontend source for forbidden tap-first interaction regressions, including hover-triggered preload, hover-only selectors, hover media queries, and hover-style handlers; verifies the shared tablet touch/focus CSS contracts; and parses build-mode SSR role surfaces for explicit thumb-zone placement without opening localhost or launching Chromium. It proves source and SSR posture for tablet-first affordances, not browser pointer delivery, pixel overlap, Svelte hydration, or real focus traversal.",
  scanned: {
    root: "frontend/src",
    fileCount: sources.length,
    extensions: [...scannedExtensions].sort(),
  },
  forbiddenPatterns: forbiddenPatterns.map(({ id, rationale }) => ({
    id,
    rationale,
  })),
  forbiddenMatches,
  tokenOwnership: {
    tokenFile: tokenFilePath,
    rule: "raw color literals (hex/rgb/hsl) are only legal in the token file",
    rawColorMatches,
  },
  rootAppHtml,
  sharedAppCss,
  adminOperatorSurfaceCss,
  playerRouteLayoutCss,
  moderatorControlSurfaceCss,
  hostTouchCss,
  thumbZones,
};

await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

async function scanSources(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await scanSources(absolutePath));
      continue;
    }
    if (!entry.isFile() || !scannedExtensions.has(path.extname(entry.name))) {
      continue;
    }
    files.push({
      path: path.relative(repoRoot, absolutePath),
      text: await readFile(absolutePath, "utf8"),
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function findRawColorLiterals(sources) {
  const matches = [];
  for (const source of sources) {
    if (source.path === tokenFilePath) {
      continue;
    }
    const extension = path.extname(source.path);
    let cssText = null;
    if (extension === ".css") {
      cssText = source.text;
    } else if (extension === ".svelte") {
      cssText = (source.text.match(/<style>[\s\S]*?<\/style>/u) ?? [null])[0];
    }
    if (cssText === null) {
      continue;
    }
    const lines = cssText.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      if (rawColorPattern.test(line)) {
        matches.push({
          file: source.path,
          line: index + 1,
          pattern: "raw-color-literal-outside-tokens",
          text: line.trim(),
        });
      }
    }
  }
  return matches;
}

function findForbiddenMatches(sources) {
  const matches = [];
  for (const source of sources) {
    const lines = source.text.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      for (const forbidden of forbiddenPatterns) {
        if (forbidden.pattern.test(line)) {
          matches.push({
            file: source.path,
            line: index + 1,
            pattern: forbidden.id,
            text: line.trim(),
          });
        }
      }
    }
  }
  return matches;
}

function proveRootAppHtml(html) {
  assert.match(
    html,
    /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1,\s*viewport-fit=cover"\s*\/>/u,
  );
  assert.match(html, /<body\s+data-sveltekit-preload-data="tap">/u);

  return {
    viewportFit: "cover",
    preloadTrigger: "tap",
  };
}

function proveSharedAppCss(css) {
  assert.match(css, /html\s*\{[^}]*overscroll-behavior:\s*none;/s);
  assert.match(css, /body\s*\{[^}]*min-block-size:\s*100svh;/s);
  assert.match(css, /body\s*\{[^}]*overscroll-behavior:\s*contain;/s);
  assert.match(css, /\.fm-app-shell\s*\{[^}]*env\(safe-area-inset-top\)/s);
  assert.match(css, /\.fm-app-shell\s*\{[^}]*env\(safe-area-inset-right\)/s);
  assert.match(css, /\.fm-app-shell\s*\{[^}]*env\(safe-area-inset-bottom\)/s);
  assert.match(css, /\.fm-app-shell\s*\{[^}]*env\(safe-area-inset-left\)/s);
  assert.match(
    css,
    new RegExp(`--fm-app-topbar-block-size:\\s*${APP_SHELL_CONTRACT.topbarBlockSizePx}px`),
  );
  assert.match(
    css,
    new RegExp(`--fm-app-sticky-rail-gap:\\s*${APP_SHELL_CONTRACT.stickyRailGapPx}px`),
  );
  assert.match(css, /\.fm-app-shell__topbar\s*\{[^}]*position:\s*sticky;/s);
  assert.match(
    css,
    /\.fm-app-shell__topbar\s*\{[^}]*top:\s*env\(safe-area-inset-top\);/s,
  );
  assert.match(
    css,
    /\.fm-app-shell__topbar\s*\{[^}]*min-block-size:\s*var\(--fm-app-topbar-block-size\);/s,
  );
  assert.match(css, /\.fm-app-shell__topbar\s*\{[^}]*z-index:\s*11;/s);
  assert.match(css, /:focus-visible\s*\{\s*outline:\s*3px solid var\(--fm-focus-ring\);/s);
  assert.match(css, /outline-offset:\s*3px/);
  assert.match(css, /\.fm-skip-link:focus-visible\s*\{/);
  assert.match(
    css,
    /\.fm-app-shell__brand,\s*\.fm-app-shell__session,\s*\.fm-app-shell__nav-item,\s*\.fm-touch-button\s*\{[^}]*min-block-size:\s*44px;/s,
  );
  assert.match(css, /\.fm-touch-button\s*\{[^}]*min-inline-size:\s*44px;/s);
  assert.match(css, /\.fm-touch-button\s*\{[^}]*touch-action:\s*manipulation;/s);
  assert.match(css, /\.fm-touch-row\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(css, /\.fm-status-strip\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /@media \(min-width:\s*841px\) and \(max-width:\s*1180px\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(200px,\s*1fr\)\)/);
  assert.match(css, /\.fm-status-strip__item\s*\{[^}]*min-block-size:\s*112px/s);
  assert.match(
    css,
    /\.fm-status-strip__detail\s*\{[^}]*clip-path:\s*inset\(50%\)/s,
  );
  assert.match(css, /@media \(max-width:\s*840px\)/);
  assert.match(css, /\.fm-status-strip\s*\{\s*grid-template-columns:\s*1fr/s);
  assert.match(css, /overflow-wrap:\s*anywhere/);

  return {
    focusVisibleOutline: "3px solid var(--fm-focus-ring)",
    focusVisibleOffset: "3px",
    edgeToEdgeViewport: true,
    safeAreaInsets: ["top", "right", "bottom", "left"],
    stickyTopbar: {
      mode: APP_SHELL_CONTRACT.topbarMode,
      topPx: APP_SHELL_CONTRACT.topbarStickyTopPx,
      blockSizePx: APP_SHELL_CONTRACT.topbarBlockSizePx,
      railGapPx: APP_SHELL_CONTRACT.stickyRailGapPx,
      safeAreaAware: true,
    },
    overscroll: {
      html: "none",
      body: "contain",
    },
    skipLinkVisibleOnFocus: true,
    appShellTouchTargetMinPx: 44,
    touchButtonMinInlinePx: 44,
    touchAction: "manipulation",
    touchRowsWrap: true,
    scanStripColumns: {
      desktop: 4,
      tablet: "adaptive 200px minimum",
      narrow: 1,
    },
    tabletScanStripMinBlockSizePx: 112,
    tabletScanStripDetailMode: "visually-hidden",
    textWrapGuardrail: "overflow-wrap:anywhere",
  };
}

function provePlayerRouteLayoutCss({ route, frame, dock }) {
  assertPlayerReadingOrder(route);
  assert.doesNotMatch(route, /<PlayerCommandPanel\b/u);
  assert.doesNotMatch(route, /player-surface__command-stack/u);
  assert.match(frame, /max-inline-size:\s*760px/u);
  assert.match(frame, /padding-block-end:\s*calc\(76px \+ env\(safe-area-inset-bottom\)\)/u);
  assert.match(dock, /data-component="player-action-dock"/u);
  assert.match(dock, /data-thumb-zone="player-primary-actions"/u);
  assert.match(dock, /position:\s*fixed/u);
  assert.match(dock, /bottom:\s*calc\(10px \+ env\(safe-area-inset-bottom\)\)/u);

  return {
    commandRailMode: "fixed-context-navigation",
    stickyTopPx: null,
    topbarOffsetPx: APP_SHELL_CONTRACT.topbarBlockSizePx,
    safeAreaAware: true,
    internalScroll: false,
    overscroll: "document",
    unstickBelowPx: null,
    stabilityMode: "thread-width-stable",
    readingMeasurePx: 760,
    threadBeforeComposer: true,
  };
}

function assertPlayerReadingOrder(source) {
  const threadIndex = source.indexOf("<PlayerThread");
  const composerIndex = source.indexOf("<ComposeSheet");
  const voteIndex = source.indexOf("<VoteSheet");
  const contextIndex = source.indexOf("<ContextSheet");
  const dockIndex = source.indexOf("<ActionDock");
  for (const [label, index] of [
    ["thread", threadIndex],
    ["composer", composerIndex],
    ["vote detail", voteIndex],
    ["context", contextIndex],
    ["dock", dockIndex],
  ]) {
    assert.notEqual(index, -1, `player route must render ${label}`);
  }
  assert.equal(
    threadIndex < composerIndex && composerIndex < voteIndex && voteIndex < contextIndex,
    true,
    "player document order must keep thread content ahead of command and evidence surfaces",
  );
}

function proveAdminOperatorSurfaceCss({ route, setupComponent, recoveryComponent }) {
  assert.match(route, /data-control-rail-mode=\{ADMIN_SURFACE_CONTRACT\.operatorRailMode\}/s);
  assertAdminActionTilesReserveStatusFloor(setupComponent, "admin setup");
  assertAdminActionTilesReserveStatusFloor(recoveryComponent, "admin recovery");
  assertAdminOperatorRailBeforeStatusReadouts(route);
  assert.match(
    route,
    /\.admin-surface__operator-actions\s*\{[^}]*position:\s*static;/s,
  );
  assert.match(
    route,
    /\.admin-surface__operator-actions\s*\{[^}]*overflow:\s*visible;/s,
  );

  return {
    controlRailMode: "flow-admin-operator-actions",
    stickyTopPx: 0,
    topbarOffsetPx: APP_SHELL_CONTRACT.topbarBlockSizePx,
    safeAreaAware: false,
    internalScroll: false,
    overscroll: "visible",
    unstickBelowPx: 0,
    setupAndRecoveryBeforeStatusReadouts: true,
    actionTileStabilityMode: "reserved-status-floor",
    actionTileStatusFloorMinBlockSizePx: 44,
    primaryActionBeforeStatusFloor: true,
  };
}

function assertAdminActionTilesReserveStatusFloor(component, label) {
  assert.match(
    component,
    /data-action-tile-stability-mode=\{view\.root\.data\.actionTileStabilityMode\}/s,
  );
  assert.match(
    component,
    /\.admin-surface__action-tile\s*\{[^}]*grid-template-rows:\s*auto minmax\(44px,\s*auto\);/s,
  );
  assert.match(
    component,
    /\.admin-surface__command-status-floor\s*\{[^}]*min-block-size:\s*44px;/s,
  );
  assert.match(component, /data-status-floor-min-px=\{item\.statusFloorMinBlockSizePx\}/s);
  const triggerIndex = component.indexOf("data-testid={item.triggerTestId}");
  const statusFloorIndex = component.indexOf("data-testid={item.statusFloorTestId}");
  assert.notEqual(triggerIndex, -1, `${label} must render trigger`);
  assert.notEqual(statusFloorIndex, -1, `${label} must render reserved status floor`);
  assert.equal(
    triggerIndex < statusFloorIndex,
    true,
    `${label} trigger should render before the reserved command status floor`,
  );
}

function assertAdminOperatorRailBeforeStatusReadouts(source) {
  const setupIndex = source.indexOf("<AdminSetupGrid");
  const recoveryIndex = source.indexOf("<AdminRecoveryPanel");
  assert.notEqual(setupIndex, -1, "admin route must render AdminSetupGrid");
  assert.notEqual(recoveryIndex, -1, "admin route must render AdminRecoveryPanel");
  for (const marker of [
    "<AdminCommandActivity",
    "<AdminAuditPanel",
    "<AdminEscalationPanel",
  ]) {
    const index = source.indexOf(marker);
    assert.notEqual(index, -1, `admin route must render ${marker}`);
    assert.equal(
      setupIndex < index && recoveryIndex < index,
      true,
      `Admin setup and recovery actions should render before ${marker}`,
    );
  }
}

function proveModeratorControlSurfaceCss({ css, component, route }) {
  assert.match(
    component,
    /data-workspace-mode=\{view\.root\.data\.mode\}/s,
  );
  assert.match(component, /data-testid=\{view\.queue\.testId\}/s);
  assert.match(component, /data-testid=\{view\.canvas\.testId\}/s);
  assert.match(component, /hidden=\{task\.id !== view\.selectedTaskId\}/s);
  assertHostActionBeforeStatusFloor(component);
  assertHostControlBeforeStatusReadouts(route);
  assert.match(
    css,
    /\.host-task-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(220px,\s*280px\) minmax\(0,\s*1fr\);/s,
  );
  assert.match(
    css,
    /@media \(max-width:\s*760px\)[\s\S]*?\.host-task-workspace\s*\{[^}]*grid-template-columns:\s*1fr;/s,
  );
  assert.match(
    css,
    /\.host-task-workspace__task-list\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;/s,
  );
  assert.match(
    css,
    /\.host-task-workspace__action\s*\{[^}]*grid-template-rows:\s*auto minmax\(44px,\s*auto\);/s,
  );
  assert.match(
    component,
    /data-status-floor-min-px=\{action\.statusFloorMinBlockSizePx\}/s,
  );
  return {
    controlRailMode: "exception-queue-decision-canvas",
    stickyTopPx: null,
    topbarOffsetPx: APP_SHELL_CONTRACT.topbarBlockSizePx,
    safeAreaAware: false,
    internalScroll: false,
    overscroll: "document",
    unstickBelowPx: null,
    primaryControlsBeforeStatusReadouts: true,
    actionTileStabilityMode: "reserved-status-floor",
    actionTileStatusFloorMinBlockSizePx: 44,
    primaryActionBeforeStatusFloor: true,
    desktopComposition: "queue-canvas",
    mobileComposition: "stacked-horizontal-queue",
  };
}

function assertHostActionBeforeStatusFloor(component) {
  const actionIndex = component.indexOf("<HostAction");
  const statusFloorIndex = component.indexOf("data-testid={action.statusFloorTestId}");
  assert.notEqual(actionIndex, -1, "host controls must render HostAction");
  assert.notEqual(
    statusFloorIndex,
    -1,
    "host controls must render a reserved command status floor",
  );
  assert.equal(
    actionIndex < statusFloorIndex,
    true,
    "HostAction controls should render before the reserved command status floor",
  );
}

function assertHostControlBeforeStatusReadouts(route) {
  const controlIndex = route.indexOf("<HostTaskWorkspace");
  assert.notEqual(controlIndex, -1, "host route must render HostTaskWorkspace");
  const workQueueIndex = route.indexOf("<HostWorkQueueStrip");
  assert.notEqual(workQueueIndex, -1, "host route must render <HostWorkQueueStrip");
  assert.equal(
    controlIndex < workQueueIndex,
    true,
    "HostTaskWorkspace leads the console before supporting queue readouts",
  );
  const checkpointIndex = route.indexOf("<HostLifecycleControlCheckpoint");
  assert.notEqual(checkpointIndex, -1, "host route must render HostLifecycleControlCheckpoint");
  assert.equal(
    controlIndex < checkpointIndex,
    true,
    "HostTaskWorkspace leads the lifecycle proof checkpoint",
  );
  for (const marker of [
    "<HostCommandActivity",
    "<HostPhaseSummary",
    "<HostVotecountPanel",
  ]) {
    const index = route.indexOf(marker);
    assert.notEqual(index, -1, `host route must render ${marker}`);
    assert.equal(
      controlIndex < index,
      true,
      `HostTaskWorkspace should render before ${marker} for first-viewport moderator actions`,
    );
  }
}

function proveHostTouchCss(css) {
  assert.match(css, /--fm-touch-target-min:\s*44px/);
  assert.match(css, /--fm-touch-gap-min:\s*8px/);
  assert.match(css, /\.touch-control\s*\{[^}]*min-block-size:\s*var\(--fm-touch-target-min\)/s);
  assert.match(css, /\.touch-control\s*\{[^}]*min-inline-size:\s*var\(--fm-touch-target-min\)/s);
  assert.match(css, /\.touch-control\s*\{[^}]*touch-action:\s*manipulation;/s);
  assert.match(css, /\.touch-control:focus-visible\s*\{[^}]*outline:\s*3px solid Highlight;/s);
  assert.match(css, /\.host-action__confirmation-actions\s*\{[^}]*flex-wrap:\s*wrap;/s);

  return {
    touchTargetMinPx: 44,
    touchGapMinPx: 8,
    touchAction: "manipulation",
    focusVisibleOutline: "3px solid Highlight",
    confirmationActionsWrap: true,
  };
}

function sourceText(sources, sourcePath) {
  const source = sources.find((candidate) => candidate.path === sourcePath);
  assert.notEqual(source, undefined, `${sourcePath} must be scanned`);
  return source.text;
}

async function runRouteStateRenderContract() {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["tools/frontend_route_state_render_contract.mjs"],
      {
        cwd: repoRoot,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`frontend route-state render contract failed with exit ${code}`);
  }
}

async function proveThumbZonePlacement(bundle) {
  return {
    boundary:
      "Build-mode Svelte SSR proves primary admin, player, and moderator controls are descendants of explicit thumb-zone containers. Browser geometry is still required to prove physical thumb reach and overlap.",
    admin: proveRoleThumbZones({
      role: "admin",
      html: (await bundle.renderAdminSurface()).html,
      zones: [
        {
          testId: ADMIN_SURFACE_CONTRACT.setupThumbZoneTestId,
          zone: ADMIN_SURFACE_CONTRACT.setupThumbZone,
          requiredDescendants: [
            { kind: "testId", value: "admin-command-trigger-create-game" },
            { kind: "testId", value: "admin-command-trigger-session-grants" },
            { kind: "testId", value: "admin-command-trigger-cohost" },
          ],
        },
        {
          testId: ADMIN_SURFACE_CONTRACT.recoveryThumbZoneTestId,
          zone: ADMIN_SURFACE_CONTRACT.recoveryThumbZone,
          requiredDescendants: [
            { kind: "testId", value: "admin-recovery-trigger-recovery-gate" },
          ],
        },
      ],
    }),
    player: proveRoleThumbZones({
      role: "player",
      html: (await bundle.renderPlayerSurface()).html,
      zones: [
        {
          testId: "player-primary-action-zone",
          zone: "player-primary-actions",
          requiredDescendants: [
            { kind: "data-action", value: "submit_vote" },
            { kind: "data-action", value: "submit_vote:no_lynch" },
            { kind: "testId", value: "player-dock-reply" },
          ],
        },
      ],
    }),
    moderator: proveRoleThumbZones({
      role: "moderator",
      html: (await bundle.renderModeratorSurface()).html,
      zones: [
        {
          testId: HOST_TASK_WORKSPACE_CONTRACT.thumbZoneTestId,
          zone: HOST_TASK_WORKSPACE_CONTRACT.thumbZone,
          requiredDescendants: MODERATOR_CRITICAL_ACTION_IDS.map((id) => ({
            kind: "testId",
            value: `critical-host-action-${id}`,
          })),
        },
      ],
    }),
  };
}

function proveRoleThumbZones({ role, html, zones }) {
  const document = parseHtml(html);
  return {
    role,
    htmlBytes: Buffer.byteLength(html),
    zones: zones.map((zone) => proveThumbZone(document, { role, zone })),
  };
}

function proveThumbZone(document, { role, zone }) {
  const root = findByAttr(document, "data-testid", zone.testId);
  assert.notEqual(root, null, `${role} thumb zone missing ${zone.testId}`);
  assert.equal(
    root.attrs["data-thumb-zone"],
    zone.zone,
    `${role} thumb zone ${zone.testId} must expose ${zone.zone}`,
  );
  const descendants = zone.requiredDescendants.map((required) => {
    const target = findDescendantByRequirement(root, required);
    assert.notEqual(
      target,
      null,
      `${role} thumb zone ${zone.testId} missing descendant ${required.kind}:${required.value}`,
    );
    return {
      kind: required.kind,
      value: required.value,
      tag: target.tag,
      minTouchTargetPx: target.attrs["data-min-touch-target-px"] ?? null,
    };
  });
  return {
    testId: zone.testId,
    thumbZone: zone.zone,
    descendantCount: descendants.length,
    descendants,
  };
}

function findDescendantByRequirement(root, required) {
  if (required.kind === "testId") {
    return findByAttr(root, "data-testid", required.value);
  }
  if (required.kind === "data-action") {
    return findByAttr(root, "data-action", required.value);
  }
  throw new Error(`unsupported thumb-zone requirement kind ${required.kind}`);
}

function findByAttr(root, attr, value) {
  for (const node of walk(root)) {
    if (node.attrs[attr] === value) {
      return node;
    }
  }
  return null;
}

function* walk(node) {
  yield node;
  for (const child of node.children) {
    yield* walk(child);
  }
}

function parseHtml(html) {
  const root = element("root", {}, null);
  const stack = [root];
  const tagPattern = /<!--[\s\S]*?-->|<\/?([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/gu;
  let match;
  while ((match = tagPattern.exec(html)) !== null) {
    if (match[0].startsWith("<!--")) {
      continue;
    }
    const full = match[0];
    const tag = match[1].toLowerCase();
    if (full.startsWith("</")) {
      while (stack.length > 1 && stack.at(-1).tag !== tag) {
        stack.pop();
      }
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }

    const attrs = parseAttrs(match[2] ?? "");
    const parent = stack.at(-1);
    const node = element(tag, attrs, parent);
    parent.children.push(node);
    if (!isVoidElement(tag) && !full.endsWith("/>")) {
      stack.push(node);
    }
  }
  return root;
}

function element(tag, attrs, parent) {
  return {
    tag,
    attrs,
    parent,
    children: [],
  };
}

function parseAttrs(source) {
  const attrs = {};
  const pattern = /([:@A-Za-z_][:@A-Za-z0-9_.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/gu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function isVoidElement(tag) {
  return new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]).has(tag);
}
