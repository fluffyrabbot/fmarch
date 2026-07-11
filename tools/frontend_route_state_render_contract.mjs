import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildRoleRouteStateMatrix } from "../frontend/src/lib/app/app-route-state-model.mjs";
import {
  APP_SHELL_CONTRACT,
  navBlockedLabel,
  roleNavTestId,
} from "../frontend/src/lib/app/app-shell-model.mjs";
import {
  PLAYER_COMMAND_PANEL_CONTRACT,
} from "../frontend/src/lib/components/player-command/player-command-panel-model.mjs";
import {
  PLAYER_COMMAND_RECEIPT_CONTRACT,
} from "../frontend/src/lib/components/player-command/player-command-receipt-model.mjs";
import {
  PLAYER_THREAD_MEDIA_CONTRACT,
  PLAYER_THREAD_PAGER_CONTRACT,
} from "../frontend/src/lib/components/player-thread/player-thread-model.mjs";
import {
  adminReadinessStatusTestId,
  adminReadinessTestId,
} from "../frontend/src/lib/components/admin/admin-surface-model.mjs";
import {
  HOST_CONTROL_SURFACE_CONTRACT,
} from "../frontend/src/lib/components/host-action/host-control-surface.mjs";
import {
  hostOperationStatusTestId,
  hostOperationTestId,
} from "../frontend/src/lib/components/host-action/host-operations-strip.mjs";
import {
  boardScenario,
  roles,
  routeStateScenarios,
} from "./frontend_role_smoke_scenarios.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "frontend-route-state-render");
const evidencePath = path.join(artifactDir, "route-state-render.json");
const tempEntryDir = path.join(frontendRoot, ".tmp-route-state-render");
const bundleDir = path.join(artifactDir, "bundle");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const stampPath = path.join(artifactDir, "input-stamp.json");

// Content-addressed skip: this contract is rerun by every harness that needs
// the SSR bundle, and its output is a pure function of the hashed inputs.
// FMARCH_FORCE_ROUTE_STATE_RENDER=1 bypasses the stamp.
const inputHash = await computeInputHash();
if (
  process.env.FMARCH_FORCE_ROUTE_STATE_RENDER !== "1" &&
  (await stampMatches(inputHash))
) {
  console.log(
    `route-state render up to date (inputs ${inputHash.slice(0, 12)}); skipping rebuild`,
  );
  process.exit(0);
}

await rm(tempEntryDir, { recursive: true, force: true });
await rm(bundleDir, { recursive: true, force: true });
await mkdir(tempEntryDir, { recursive: true });
await mkdir(artifactDir, { recursive: true });

const entryPath = path.join(tempEntryDir, "entry.mjs");
const appStoresPath = path.join(tempEntryDir, "app-stores.mjs");
const appRootShellPath = path.join(tempEntryDir, "AppRootShell.svelte");
await writeFile(entryPath, renderEntrySource());
await writeFile(appStoresPath, renderAppStoresSource());
await writeFile(appRootShellPath, renderAppRootShellSource());

try {
  const { build } = await import(frontendRequire.resolve("vite"));
  const { svelte } = await import(
    frontendRequire.resolve("@sveltejs/vite-plugin-svelte")
  );
  await build({
    configFile: false,
    root: frontendRoot,
    plugins: [svelte()],
    resolve: {
      alias: {
        $lib: path.join(frontendRoot, "src", "lib"),
        "$app/stores": appStoresPath,
      },
    },
    logLevel: "error",
    ssr: {
      noExternal: true,
    },
    build: {
      ssr: entryPath,
      outDir: bundleDir,
      emptyOutDir: true,
      rollupOptions: {
        input: entryPath,
      },
    },
  });

  const bundle = await import(
    `${pathToFileURL(path.join(bundleDir, "entry.js")).href}?t=${Date.now()}`
  );
  const matrix = buildRoleRouteStateMatrix();
  const scenarios = [];
  for (const scenario of routeStateScenarios) {
    const rendered = await bundle.renderScenario(scenario.role, scenario.state);
    const html = rendered.html;
    const view = matrix[scenario.surface][scenario.state];
    assertRenderedScenario({ html, scenario, view });
    scenarios.push({
      id: scenario.id,
      role: scenario.role,
      surface: scenario.surface,
      state: scenario.state,
      path: scenario.path,
      rootTestId: scenario.rootTestId,
      statusTestId: scenario.statusTestId,
      actionTestId: scenario.actionTestId,
      statusState: scenario.statusState,
      ariaLive: scenario.ariaLive,
      htmlBytes: Buffer.byteLength(html),
    });
  }
  const adminSurface = await proveRenderedAdminSurface(bundle);
  const adminAuditDetailSurface = await proveRenderedAdminAuditDetailSurface(bundle);
  const playerSurface = await proveRenderedPlayerSurface(bundle);
  const playerThreadPagerStates = await proveRenderedPlayerThreadPagerStates(bundle);
  const playerPrivateReviewRoute = await proveRenderedPlayerPrivateReviewRoute(bundle);
  const playerPrivateChannelRoute = await proveRenderedPlayerPrivateChannelRoute(bundle);
  const moderatorSurface = await proveRenderedModeratorSurface(bundle);
  const confirmationMarkup = await proveRenderedConfirmationMarkup(bundle);
  const feedbackRailMarkup = await proveRenderedFeedbackRailMarkup(bundle);
  const playerPrivateDisclosure = await proveRenderedPlayerPrivateDisclosure(bundle);
  const errorSurface = await proveRenderedRouteErrorSurface(bundle);
  const loadingSurface = await proveRenderedRouteLoadingSurface(bundle);
  const navigationPending = await proveRenderedNavigationPendingLayer(bundle);
  const shellNavCoverage = await proveRenderedShellNavCoverage(bundle);
  const singleRootShell = proveSingleRootShell(shellNavCoverage);

  const evidence = {
    status: "passed",
    proof: "svelte-ssr-route-state-render",
    boundary:
      "Build-mode Svelte SSR renders the board, admin, player, player private-channel, and moderator pages with fixture route-state data, including the native admin audit detail route, the shared route-loading component, the root navigation-pending layer, and the real SvelteKit error page with session-aware shell context. This proves page/component wiring and live-region/error markup without opening localhost; Chromium pixel, pointer, and focus traversal proof is still required.",
    appShellContract: {
      component: APP_SHELL_CONTRACT.component,
      navLabel: APP_SHELL_CONTRACT.navLabel,
      skipLinkLabel: APP_SHELL_CONTRACT.skipLinkLabel,
      skipLinkTestId: APP_SHELL_CONTRACT.skipLinkTestId,
      mainTargetId: APP_SHELL_CONTRACT.mainTargetId,
      mainTargetTestId: APP_SHELL_CONTRACT.mainTargetTestId,
      sessionTestId: APP_SHELL_CONTRACT.sessionTestId,
      sessionPrincipalTestId: APP_SHELL_CONTRACT.sessionPrincipalTestId,
      sessionCapabilityTestId: APP_SHELL_CONTRACT.sessionCapabilityTestId,
      sessionGameTestId: APP_SHELL_CONTRACT.sessionGameTestId,
      topbarTestId: APP_SHELL_CONTRACT.topbarTestId,
      topbarMode: APP_SHELL_CONTRACT.topbarMode,
      topbarStickyTopPx: APP_SHELL_CONTRACT.topbarStickyTopPx,
      topbarBlockSizePx: APP_SHELL_CONTRACT.topbarBlockSizePx,
      stickyRailGapPx: APP_SHELL_CONTRACT.stickyRailGapPx,
      surfaceOrder: APP_SHELL_CONTRACT.surfaceOrder,
      navTestIds: APP_SHELL_CONTRACT.surfaceOrder.map((surface) =>
        roleNavTestId(surface),
      ),
      minTouchTargetPx: APP_SHELL_CONTRACT.minTouchTargetPx,
    },
    scenarios,
    adminSurface,
    adminAuditDetailSurface,
    playerSurface,
    playerThreadPagerStates,
    playerPrivateReviewRoute,
    playerPrivateChannelRoute,
    moderatorSurface,
    feedbackRailMarkup,
    errorSurface,
    loadingSurface,
    navigationPending,
    shellNavCoverage,
    singleRootShell,
    confirmationMarkup,
    playerPrivateDisclosure,
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(
    stampPath,
    `${JSON.stringify({ hash: inputHash, generatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} finally {
  await rm(tempEntryDir, { recursive: true, force: true });
}

async function proveRenderedShellNavCoverage(bundle) {
  const renderedSurfaces = [
    {
      id: boardScenario.id,
      render: "renderBoardPlayerSurface",
      expectedNav: boardScenario.nav,
      rendered: await bundle.renderBoardPlayerSurface(),
    },
    ...(await Promise.all(
      roles.map(async (role) => ({
        id: role.id,
        render: renderFunctionForRole(role.id),
        expectedNav: role.nav,
        rendered: await bundle[renderFunctionForRole(role.id)](),
      })),
    )),
  ];

  const surfaces = renderedSurfaces.map(({ id, render, expectedNav, rendered }) =>
    assertRenderedShellNav({
      id,
      render,
      html: rendered.html,
      expectedNav,
    }),
  );

  const routeStates = [];
  for (const scenario of routeStateScenarios) {
    const rendered = await bundle.renderScenario(scenario.role, scenario.state);
    routeStates.push(
      assertRenderedShellNav({
        id: scenario.id,
        render: "renderScenario",
        html: rendered.html,
        expectedNav: scenario.nav,
      }),
    );
  }

  return {
    boundary:
      "Build-mode Svelte SSR proves the app shell rendered the same role navigation matrix as the shared fixture smoke scenarios for board, admin, player, moderator, and every route-state page. Browser focus traversal and pointer behavior remain covered by their own lanes.",
    surfaces,
    routeStates,
  };
}

function renderFunctionForRole(role) {
  if (role === "admin") {
    return "renderAdminSurface";
  }
  if (role === "player") {
    return "renderPlayerSurface";
  }
  if (role === "moderator") {
    return "renderModeratorSurface";
  }
  throw new Error(`unknown shell nav render role ${role}`);
}

function proveSingleRootShell(shellNavCoverage) {
  const surfaces = shellNavCoverage.surfaces.map((surface) => ({
    id: surface.id,
    render: surface.render,
    shellComponentCount: surface.shellComponentCount,
  }));
  const routeStates = shellNavCoverage.routeStates.map((surface) => ({
    id: surface.id,
    render: surface.render,
    shellComponentCount: surface.shellComponentCount,
  }));
  const all = [...surfaces, ...routeStates];
  assert.equal(all.length > 0, true, "single root shell proof has no routes");
  for (const entry of all) {
    assert.equal(
      entry.shellComponentCount,
      1,
      `${entry.id} did not render exactly one app shell`,
    );
  }

  return {
    status: "passed",
    proof: "single-root-app-shell",
    boundary:
      "Build-mode Svelte SSR renders every first-class app route and forced route-state page through the root layout with exactly one AppShell. The source-level route contract keeps first-class app route pages surface-only and requires their loaders to opt into shellOwner: layout. Error and standalone route-loading components still own their own isolated shell contexts.",
    sourceContract:
      "frontend/src/routes/root-shell-contract.test.mjs",
    surfaces,
    routeStates,
  };
}

async function proveRenderedFeedbackRailMarkup(bundle) {
  const admin = await proveRenderedAdminCommandActivity(bundle);
  const player = await proveRenderedPlayerCommandReceipt(bundle);
  const moderator = await proveRenderedModeratorCommandActivity(bundle);

  return {
    boundary:
      "Build-mode Svelte SSR renders active command feedback rails for admin, player, and moderator components. This proves component markup, live-region status rows, and stable test ids without client hydration, pointer behavior, command dispatch, or browser geometry.",
    admin,
    player,
    moderator,
  };
}

async function proveRenderedAdminCommandActivity(bundle) {
  const rendered = await bundle.renderAdminCommandActivity();
  const html = rendered.html;
  assertIncludes(
    html,
    'data-component="admin-command-activity"',
    "active admin command activity component",
  );
  assertIncludes(
    html,
    'data-testid="admin-command-activity-recovery-gate"',
    "active admin recovery activity row",
  );
  assertIncludes(
    html,
    'data-testid="admin-command-activity-status-recovery-gate"',
    "active admin recovery activity status",
  );
  assertIncludes(html, 'data-state="ack"', "active admin recovery activity ack");
  assertIncludes(html, "Recovery gate trusted", "active admin recovery activity message");
  const trace = assertConfirmationTraceAttributes(html, {
    testId: "admin-command-activity-recovery-gate",
    surface: "admin-recovery",
    actionId: "recovery-gate",
    statusKey: "recovery-gate",
    dispatchKind: "check_recovery_gate",
  });
  return {
    role: "admin",
    render: "renderAdminCommandActivity",
    component: "admin-command-activity",
    testId: "admin-command-activity",
    itemTestId: "admin-command-activity-recovery-gate",
    statusTestId: "admin-command-activity-status-recovery-gate",
    statusState: "ack",
    confirmationTrace: trace,
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedPlayerCommandReceipt(bundle) {
  const rendered = await bundle.renderPlayerCommandReceipt();
  const html = rendered.html;
  assertIncludes(
    html,
    'data-component="player-command-receipt"',
    "active player command receipt component",
  );
  assertIncludes(
    html,
    'data-testid="player-command-receipt-submit_vote"',
    "active player command receipt row",
  );
  assertIncludes(
    html,
    `data-testid="${PLAYER_COMMAND_RECEIPT_CONTRACT.currentStatusTestId}"`,
    "active player command receipt current status",
  );
  assertIncludes(html, 'data-state="reject"', "active player command receipt reject");
  assertIncludes(html, "Reject PhaseLocked", "active player command receipt message");
  const trace = assertCommandTraceAttributes(html, {
    testId: "player-command-receipt-submit_vote",
    surface: "player",
    actionId: "submit_vote",
    statusKey: "submit_vote",
    dispatchKind: "submit_vote",
    refreshKeys: "votecount,commandState",
  });
  return {
    role: "player",
    render: "renderPlayerCommandReceipt",
    component: "player-command-receipt",
    testId: "player-command-receipt",
    itemTestId: "player-command-receipt-submit_vote",
    statusTestId: PLAYER_COMMAND_RECEIPT_CONTRACT.currentStatusTestId,
    statusState: "reject",
    commandTrace: trace,
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedModeratorCommandActivity(bundle) {
  const rendered = await bundle.renderModeratorCommandActivity();
  const html = rendered.html;
  assertIncludes(
    html,
    'data-component="host-command-activity"',
    "active moderator command activity component",
  );
  assertIncludes(
    html,
    'data-testid="host-command-activity-resolve_host_prompt-D01-skip_next_day-slot_1"',
    "active moderator host prompt activity row",
  );
  assertIncludes(
    html,
    'data-testid="host-command-activity-status-resolve_host_prompt-D01-skip_next_day-slot_1"',
    "active moderator host prompt activity status",
  );
  assertIncludes(html, 'data-state="ack"', "active moderator activity ack");
  assertIncludes(html, "Ack: host prompt resolved", "active moderator activity message");
  const trace = assertConfirmationTraceAttributes(html, {
    testId: "host-command-activity-resolve_host_prompt-D01-skip_next_day-slot_1",
    surface: "moderator-host",
    actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
    statusKey: "resolve_host_prompt-D01-skip_next_day-slot_1",
    dispatchKind: "resolve_host_prompt",
  });
  return {
    role: "moderator",
    render: "renderModeratorCommandActivity",
    component: "host-command-activity",
    testId: "host-command-activity",
    itemTestId: "host-command-activity-resolve_host_prompt-D01-skip_next_day-slot_1",
    statusTestId:
      "host-command-activity-status-resolve_host_prompt-D01-skip_next_day-slot_1",
    statusState: "ack",
    confirmationTrace: trace,
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedPlayerPrivateDisclosure(bundle) {
  const collapsed = await bundle.renderPlayerPrivateDisclosure(false);
  const expanded = await bundle.renderPlayerPrivateDisclosure(true);
  const collapsedHtml = collapsed.html;
  const expandedHtml = expanded.html;

  assertIncludes(
    collapsedHtml,
    'data-component="player-private-queue"',
    "player private queue component",
  );
  assertIncludes(
    collapsedHtml,
    'data-boundary-status="principal-scoped-private-projections"',
    "player private queue boundary",
  );
  assertIncludes(
    collapsedHtml,
    'data-testid="player-private-review-notification-1"',
    "player private notification review",
  );
  assertIncludes(
    collapsedHtml,
    'data-testid="player-private-link-notification-1"',
    "player private notification review link",
  );
  assertIncludes(
    collapsedHtml,
    'href="/g/midsummer?private=notification-1"',
    "player private notification review href",
  );
  assertIncludes(
    collapsedHtml,
    "Open Commuted review",
    "player private notification review link label",
  );
  assertIncludes(
    collapsedHtml,
    'aria-expanded="false"',
    "collapsed player private disclosure state",
  );
  assertIncludes(
    collapsedHtml,
    'aria-controls="player-private-detail-notification-1"',
    "collapsed player private disclosure controls",
  );
  assertExcludes(
    collapsedHtml,
    'data-testid="player-private-detail-notification-1"',
    "collapsed player private detail",
  );
  assertPrivateDisclosureDoesNotLeakHostOnlyCopy(collapsedHtml, "collapsed private queue");

  assertIncludes(
    expandedHtml,
    'data-testid="player-private-review-notification-1"',
    "expanded player private notification review",
  );
  assertIncludes(
    expandedHtml,
    'aria-expanded="true"',
    "expanded player private disclosure state",
  );
  assertIncludes(
    expandedHtml,
    'id="player-private-detail-notification-1"',
    "expanded player private detail id",
  );
  assertIncludes(
    expandedHtml,
    'data-testid="player-private-detail-notification-1"',
    "expanded player private detail test id",
  );
  assertIncludes(expandedHtml, "Phase N02", "expanded player private detail");
  assertPrivateDisclosureDoesNotLeakHostOnlyCopy(expandedHtml, "expanded private queue");

  return {
    boundary:
      "Build-mode Svelte SSR renders player private queue disclosure markup in collapsed and expanded states. This proves principal-scoped disclosure attributes and host-copy exclusion, not hydrated click/focus behavior.",
    collapsed: {
      reviewTestId: "player-private-review-notification-1",
      reviewLinkTestId: "player-private-link-notification-1",
      reviewHref: "/g/midsummer?private=notification-1",
      reviewLinkLabel: "Open Commuted review",
      detailTestId: "player-private-detail-notification-1",
      ariaExpanded: "false",
      detailRendered: false,
      htmlBytes: Buffer.byteLength(collapsedHtml),
    },
    expanded: {
      reviewTestId: "player-private-review-notification-1",
      reviewLinkTestId: "player-private-link-notification-1",
      reviewHref: "/g/midsummer?private=notification-1",
      reviewLinkLabel: "Open Commuted review",
      detailTestId: "player-private-detail-notification-1",
      ariaExpanded: "true",
      detailRendered: true,
      htmlBytes: Buffer.byteLength(expandedHtml),
    },
    hostOnlyCopyExcluded: true,
  };
}

async function proveRenderedPlayerPrivateReviewRoute(bundle) {
  const rendered = await bundle.renderPlayerPrivateReviewRoute();
  const html = rendered.html;

  assertIncludes(html, 'data-component="fm-app-shell"', "player private review app shell");
  assertAppShellSkipLink(html, "player private review");
  assertIncludes(html, 'data-surface="player"', "player private review shell state");
  assertIncludes(html, 'data-testid="player-surface"', "player private review surface");
  assertIncludes(
    html,
    'data-testid="player-private-review-notification-1"',
    "player private review button",
  );
  assertIncludes(
    html,
    'data-testid="player-private-link-notification-1"',
    "player private review link",
  );
  assertIncludes(
    html,
    'href="/g/midsummer?private=notification-1"',
    "player private review href",
  );
  assertIncludes(html, "Open Commuted review", "player private review link label");
  assertIncludes(
    html,
    'aria-expanded="true"',
    "player private review URL expanded state",
  );
  assertIncludes(
    html,
    'data-testid="player-private-detail-notification-1"',
    "player private review URL detail",
  );
  assertIncludes(html, "Phase N02", "player private review URL detail text");
  assertPlayerRoutePrivateDetailDoesNotLeakHostOnlyCopy(
    html,
    "player private review route",
  );

  return {
    role: "player",
    path: "/g/midsummer?private=notification-1",
    surfaceTestId: "player-surface",
    reviewTestId: "player-private-review-notification-1",
    reviewLinkTestId: "player-private-link-notification-1",
    reviewHref: "/g/midsummer?private=notification-1",
    reviewLinkLabel: "Open Commuted review",
    detailTestId: "player-private-detail-notification-1",
    ariaExpanded: "true",
    detailRendered: true,
    hostOnlyCopyExcluded: true,
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedPlayerPrivateChannelRoute(bundle) {
  const rendered = await bundle.renderPlayerPrivateChannelRoute();
  const html = rendered.html;

  assertIncludes(html, 'data-component="fm-app-shell"', "player private channel app shell");
  assertAppShellSkipLink(html, "player private channel");
  assertIncludes(html, 'data-surface="player"', "player private channel shell state");
  assertIncludes(html, 'data-testid="player-surface"', "player private channel surface");
  assertIncludes(
    html,
    'data-testid="player-channel-private:role_pm:slot-7"',
    "player private channel active rail item",
  );
  assertIncludes(
    html,
    'href="/g/midsummer/c/private%3Arole_pm%3Aslot-7"',
    "player private channel private:role_pm:slot-7 href",
  );
  assertIncludes(html, 'aria-current="page"', "player private channel active state");
  assertIncludes(html, "Role PM", "player private channel label");
  assertIncludes(
    html,
    `data-testid="${PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId}"`,
    "player private channel command context",
  );
  assertIncludes(
    html,
    'data-channel-id="private:role_pm:slot-7"',
    "player private channel command target id",
  );
  assertIncludes(
    html,
    'data-capability-label="ChannelMember(private:role_pm:slot-7)"',
    "player private channel command capability",
  );
  assertIncludes(
    html,
    "Role PM as slot-7",
    "player private channel command target label",
  );
  assertIncludes(
    html,
    'data-testid="player-private-link-notification-1"',
    "player private channel review link",
  );
  assertIncludes(
    html,
    'href="/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1"',
    "player private channel scoped review href",
  );
  assertIncludes(
    html,
    "Open Commuted review",
    "player private channel review link label",
  );
  assertIncludes(
    html,
    'data-boundary-status="principal-scoped-private-projections"',
    "player private channel principal scoped private boundary",
  );
  assertIncludes(
    html,
    'data-component="player-thread-media"',
    "player private channel tablet media component",
  );
  assertIncludes(
    html,
    'data-media-variant="tablet"',
    "player private channel tablet media variant",
  );
  assertPlayerRoutePrivateDetailDoesNotLeakHostOnlyCopy(
    html,
    "player private channel route",
  );

  return {
    role: "player",
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    channel: "private:role_pm:slot-7",
    surfaceTestId: "player-surface",
    activeChannelTestId: "player-channel-private:role_pm:slot-7",
    activeChannelHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    commandChannelContext: {
      testId: PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
      channelId: "private:role_pm:slot-7",
      channelLabel: "Role PM",
      capabilityLabel: "ChannelMember(private:role_pm:slot-7)",
      actorSlot: "slot-7",
    },
    privateReviewLinkTestId: "player-private-link-notification-1",
    privateReviewHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1",
    privateReviewLinkLabel: "Open Commuted review",
    privateBoundaryStatus: "principal-scoped-private-projections",
    mediaVariant: "tablet",
    hostOnlyCopyExcluded: true,
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedRouteErrorSurface(bundle) {
  const rendered = await bundle.renderRouteErrorSurface();
  const html = rendered.html;
  const playerNavTag = tagWithTestId(html, roleNavTestId("player"));

  assertIncludes(html, 'data-component="fm-app-shell"', "route error app shell");
  assertAppShellSkipLink(html, "route error");
  assertIncludes(html, 'data-surface="player"', "route error shell state");
  assertIncludes(
    html,
    'data-testid="route-error-surface"',
    "route error surface",
  );
  assertIncludes(html, 'data-status="403"', "route error status attribute");
  assertIncludes(html, 'data-testid="route-error-panel"', "route error panel");
  assertIncludes(html, 'data-testid="route-error-action"', "route error action");
  assertIncludes(html, 'href="/"', "route error action href");
  assertIncludes(html, "Access blocked", "route error title");
  assertIncludes(
    html,
    "Channel private:role_pm:slot-7 is not visible.",
    "route error message",
  );
  assertIncludes(html, "/g/midsummer/c/private%3Arole_pm%3Aslot-7", "route error path");
  assertIncludes(
    html,
    `data-testid="${APP_SHELL_CONTRACT.sessionTestId}"`,
    "route error session capsule",
  );
  assertIncludes(
    html,
    `data-testid="${APP_SHELL_CONTRACT.sessionPrincipalTestId}">player_mira`,
    "route error session principal",
  );
  assertIncludes(
    html,
    `data-testid="${APP_SHELL_CONTRACT.sessionCapabilityTestId}">ChannelMember + SlotOccupant`,
    "route error session capabilities",
  );
  assert.notEqual(playerNavTag, null, "route error player nav missing");
  assert.equal(
    playerNavTag.includes('aria-current="page"'),
    true,
    "route error player nav is not active",
  );

  return {
    role: "player",
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    status: 403,
    surface: "player",
    surfaceTestId: "route-error-surface",
    panelTestId: "route-error-panel",
    actionTestId: "route-error-action",
    actionHref: "/",
    activeNavTestId: roleNavTestId("player"),
    sessionPrincipal: "player_mira",
    capabilitySummary: "ChannelMember + SlotOccupant",
    message: "Channel private:role_pm:slot-7 is not visible.",
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedRouteLoadingSurface(bundle) {
  const rendered = await bundle.renderRouteLoadingSurface();
  const html = rendered.html;
  const playerNavTag = tagWithTestId(html, roleNavTestId("player"));

  assertIncludes(html, 'data-component="fm-app-shell"', "route loading app shell");
  assertAppShellSkipLink(html, "route loading");
  assertIncludes(html, 'data-surface="player"', "route loading shell state");
  assertIncludes(
    html,
    'data-testid="route-loading-surface"',
    "route loading surface",
  );
  assertIncludes(
    html,
    'data-path="/g/midsummer/c/private%3Arole_pm%3Aslot-7"',
    "route loading path",
  );
  assertIncludes(
    html,
    'data-testid="route-state-player-loading"',
    "route loading state root",
  );
  assertIncludes(
    html,
    'data-testid="route-state-status-player-loading"',
    "route loading status",
  );
  assertIncludes(
    html,
    'data-testid="route-state-action-player-loading"',
    "route loading action",
  );
  assertIncludes(html, "Loading game surface", "route loading title");
  assertIncludes(
    html,
    "Fetching thread, channel, votecount, deadline, and private projection state.",
    "route loading message",
  );
  assert.notEqual(playerNavTag, null, "route loading player nav missing");
  assert.equal(
    playerNavTag.includes('aria-current="page"'),
    true,
    "route loading player nav is not active",
  );

  return {
    role: "player",
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    surface: "player",
    surfaceTestId: "route-loading-surface",
    routeStateTestId: "route-state-player-loading",
    statusTestId: "route-state-status-player-loading",
    actionTestId: "route-state-action-player-loading",
    activeNavTestId: roleNavTestId("player"),
    sessionPrincipal: "player_mira",
    capabilitySummary: "ChannelMember + SlotOccupant",
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedNavigationPendingLayer(bundle) {
  const rendered = await bundle.renderNavigationPendingLayer();
  const hidden = await bundle.renderNavigationPendingLayerHidden();
  const html = rendered.html;

  assertIncludes(
    html,
    'data-component="fm-navigation-pending"',
    "navigation pending component",
  );
  assertIncludes(
    html,
    'data-testid="app-navigation-pending"',
    "navigation pending root",
  );
  assertIncludes(html, 'data-surface="player"', "navigation pending surface");
  assertIncludes(
    html,
    'data-path="/g/midsummer/c/private%3Arole_pm%3Aslot-7"',
    "navigation pending path",
  );
  assertIncludes(
    html,
    'data-active-nav-testid="role-nav-player"',
    "navigation pending active nav",
  );
  assertIncludes(
    html,
    'data-session-principal="player_mira"',
    "navigation pending session principal",
  );
  assertIncludes(
    html,
    'data-capability-summary="ChannelMember + SlotOccupant"',
    "navigation pending capability summary",
  );
  assertIncludes(
    html,
    'data-testid="app-navigation-pending-status"',
    "navigation pending status",
  );
  assertIncludes(html, "Loading game surface", "navigation pending title");
  assertIncludes(
    html,
    "Fetching thread, channel, votecount, deadline, and private projection state.",
    "navigation pending message",
  );
  assert.equal(
    hidden.html.includes('data-testid="app-navigation-pending"'),
    false,
    "navigation pending hidden state rendered root",
  );

  return {
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    surface: "player",
    rootTestId: "app-navigation-pending",
    statusTestId: "app-navigation-pending-status",
    activeNavTestId: roleNavTestId("player"),
    sessionPrincipal: "player_mira",
    capabilitySummary: "ChannelMember + SlotOccupant",
    hiddenHtmlBytes: Buffer.byteLength(hidden.html),
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedConfirmationMarkup(bundle) {
  const adminSetup = await proveRenderedAdminSetupConfirmation(bundle);
  const adminRecovery = await proveRenderedAdminRecoveryConfirmation(bundle);
  const moderator = await proveRenderedModeratorConfirmation(bundle);
  const moderatorHostPrompt = await proveRenderedModeratorHostPromptConfirmation(bundle);
  const moderatorSlotLifecycle =
    await proveRenderedModeratorSlotLifecycleConfirmation(bundle);
  return {
    boundary:
      "Build-mode Svelte SSR renders already-open admin and moderator confirmations to prove alertdialog, aria, message, test-id wiring, and DOM-visible focus/escape/tab contract metadata. It still does not prove hydrated focus movement, Escape handling, Tab trapping, or pointer behavior.",
    adminSetup,
    adminRecovery,
    moderator,
    moderatorHostPrompt,
    moderatorSlotLifecycle,
  };
}

async function proveRenderedAdminSetupConfirmation(bundle) {
  const rendered = await bundle.renderAdminSetupConfirmation();
  const html = rendered.html;
  assertIncludes(html, 'role="alertdialog"', "admin setup confirmation role");
  assertIncludes(html, 'aria-modal="true"', "admin setup confirmation modal");
  assertIncludes(
    html,
    'aria-describedby="admin-command-confirmation-message-session-grants"',
    "admin session-grant described-by",
  );
  assertIncludes(
    html,
    'data-testid="admin-command-confirmation-message-session-grants"',
    "admin session-grant confirmation message",
  );
  assertIncludes(
    html,
    'data-testid="admin-command-trigger-session-grants"',
    "admin session-grant trigger",
  );
  assertIncludes(
    html,
    'data-testid="admin-command-confirm-session-grants"',
    "admin session-grant confirm",
  );
  assertConfirmationFocusContract(html, {
    initialFocusTestId: "admin-command-confirm-session-grants",
    returnFocusTestId: "admin-command-trigger-session-grants",
    tabContainment: "local-confirmation-controls",
    label: "admin session-grant",
  });
  assertIncludes(
    html,
    'data-testid="admin-session-grant-global-mod"',
    "admin session-grant global capability checkbox",
  );
  assertIncludes(
    html,
    'data-testid="admin-command-cancel-session-grants"',
    "admin session-grant cancel",
  );
  assertIncludes(
    html,
    'data-testid="admin-command-confirmation-message-cohost"',
    "admin cohost confirmation message",
  );
  assertIncludes(
    html,
    'data-testid="admin-command-trigger-cohost"',
    "admin cohost trigger",
  );
  assertIncludes(
    html,
    'data-testid="admin-command-confirm-cohost"',
    "admin cohost confirm",
  );
  assertConfirmationFocusContract(html, {
    initialFocusTestId: "admin-command-confirm-cohost",
    returnFocusTestId: "admin-command-trigger-cohost",
    tabContainment: "local-confirmation-controls",
    label: "admin cohost",
  });
  assertIncludes(
    html,
    'data-testid="admin-command-cancel-cohost"',
    "admin cohost cancel",
  );

  return {
    role: "admin",
    surface: "setup",
    confirmTestIds: [
      "admin-command-confirm-session-grants",
      "admin-command-confirm-cohost",
    ],
    cancelTestIds: [
      "admin-command-cancel-session-grants",
      "admin-command-cancel-cohost",
    ],
    messageTestIds: [
      "admin-command-confirmation-message-session-grants",
      "admin-command-confirmation-message-cohost",
    ],
    formFieldTestIds: [
      "admin-session-grant-token",
      "admin-session-grant-principal",
      "admin-session-grant-expires-at",
      "admin-session-grant-global-mod",
    ],
    focusContracts: [
      {
        initialFocusTestId: "admin-command-confirm-session-grants",
        returnFocusTestId: "admin-command-trigger-session-grants",
        escapeCancels: true,
        tabContainment: "local-confirmation-controls",
      },
      {
        initialFocusTestId: "admin-command-confirm-cohost",
        returnFocusTestId: "admin-command-trigger-cohost",
        escapeCancels: true,
        tabContainment: "local-confirmation-controls",
      },
    ],
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedAdminRecoveryConfirmation(bundle) {
  const rendered = await bundle.renderAdminRecoveryConfirmation();
  const html = rendered.html;
  assertIncludes(html, 'role="alertdialog"', "admin recovery confirmation role");
  assertIncludes(html, 'aria-modal="true"', "admin recovery confirmation modal");
  assertIncludes(
    html,
    'aria-describedby="admin-recovery-confirmation-message-recovery-gate"',
    "admin recovery described-by",
  );
  assertIncludes(
    html,
    'data-testid="admin-recovery-confirmation-message-recovery-gate"',
    "admin recovery confirmation message",
  );
  assertIncludes(
    html,
    'data-testid="admin-recovery-trigger-recovery-gate"',
    "admin recovery trigger",
  );
  assertIncludes(
    html,
    'data-testid="admin-recovery-confirm-recovery-gate"',
    "admin recovery confirm",
  );
  assertConfirmationFocusContract(html, {
    initialFocusTestId: "admin-recovery-confirm-recovery-gate",
    returnFocusTestId: "admin-recovery-trigger-recovery-gate",
    tabContainment: "local-confirmation-controls",
    label: "admin recovery",
  });
  assertIncludes(
    html,
    'data-testid="admin-recovery-cancel-recovery-gate"',
    "admin recovery cancel",
  );
  assertIncludes(
    html,
    'action="?/checkRecoveryGate"',
    "admin recovery form action",
  );

  return {
    role: "admin",
    surface: "recovery",
    confirmTestIds: ["admin-recovery-confirm-recovery-gate"],
    cancelTestIds: ["admin-recovery-cancel-recovery-gate"],
    messageTestIds: ["admin-recovery-confirmation-message-recovery-gate"],
    focusContracts: [
      {
        initialFocusTestId: "admin-recovery-confirm-recovery-gate",
        returnFocusTestId: "admin-recovery-trigger-recovery-gate",
        escapeCancels: true,
        tabContainment: "local-confirmation-controls",
      },
    ],
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedModeratorConfirmation(bundle) {
  const rendered = await bundle.renderModeratorConfirmation();
  const html = rendered.html;
  assertIncludes(html, 'role="alertdialog"', "moderator confirmation role");
  assertIncludes(html, 'aria-modal="true"', "moderator confirmation modal");
  assertIncludes(
    html,
    'aria-describedby="host-action-confirmation-message-extend_deadline"',
    "moderator confirmation described-by",
  );
  assertIncludes(
    html,
    'data-testid="critical-host-action-confirmation"',
    "moderator confirmation root",
  );
  assertIncludes(
    html,
    'data-testid="critical-host-action-confirmation-message"',
    "moderator confirmation message",
  );
  assertIncludes(
    html,
    'data-testid="critical-host-action-trigger"',
    "moderator confirmation trigger",
  );
  assertIncludes(
    html,
    'data-testid="critical-host-action-confirm"',
    "moderator confirmation confirm",
  );
  assertConfirmationFocusContract(html, {
    initialFocusTestId: "critical-host-action-confirm",
    returnFocusTestId: "critical-host-action-trigger",
    tabContainment: "confirm-cancel",
    label: "moderator",
  });
  assertIncludes(
    html,
    'data-testid="critical-host-action-cancel"',
    "moderator confirmation cancel",
  );
  assertIncludes(
    html,
    "move the deadline to June 19, 2026 at 9:00 PM PT",
    "moderator confirmation outcome",
  );

  return {
    role: "moderator",
    actionId: "extend_deadline",
    confirmTestIds: ["critical-host-action-confirm"],
    cancelTestIds: ["critical-host-action-cancel"],
    messageTestIds: ["critical-host-action-confirmation-message"],
    focusContracts: [
      {
        initialFocusTestId: "critical-host-action-confirm",
        returnFocusTestId: "critical-host-action-trigger",
        escapeCancels: true,
        tabContainment: "confirm-cancel",
      },
    ],
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedModeratorHostPromptConfirmation(bundle) {
  const rendered = await bundle.renderModeratorHostPromptConfirmation();
  const html = rendered.html;
  assertIncludes(html, 'role="alertdialog"', "host prompt confirmation role");
  assertIncludes(html, 'aria-modal="true"', "host prompt confirmation modal");
  assertIncludes(
    html,
    'aria-describedby="host-action-confirmation-message-resolve_host_prompt-D01-skip_next_day-slot_1"',
    "host prompt confirmation described-by",
  );
  assertIncludes(
    html,
    'data-testid="critical-host-action-confirmation"',
    "host prompt confirmation root",
  );
  assertIncludes(
    html,
    'data-testid="critical-host-action-confirmation-message"',
    "host prompt confirmation message",
  );
  assertIncludes(html, "Resolve skip_next_day", "host prompt confirmation prompt label");
  assertIncludes(
    html,
    "acknowledge prompt and apply pack policy",
    "host prompt confirmation outcome",
  );
  assertIncludes(
    html,
    'data-testid="critical-host-action-confirm"',
    "host prompt confirmation confirm",
  );
  assertConfirmationFocusContract(html, {
    initialFocusTestId: "critical-host-action-confirm",
    returnFocusTestId: "critical-host-action-trigger",
    tabContainment: "confirm-cancel",
    label: "host prompt",
  });
  assertIncludes(
    html,
    'data-testid="critical-host-action-cancel"',
    "host prompt confirmation cancel",
  );

  return {
    role: "moderator",
    actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
    confirmTestIds: ["critical-host-action-confirm"],
    cancelTestIds: ["critical-host-action-cancel"],
    messageTestIds: ["critical-host-action-confirmation-message"],
    focusContracts: [
      {
        initialFocusTestId: "critical-host-action-confirm",
        returnFocusTestId: "critical-host-action-trigger",
        escapeCancels: true,
        tabContainment: "confirm-cancel",
      },
    ],
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedModeratorSlotLifecycleConfirmation(bundle) {
  const rendered = await bundle.renderModeratorSlotLifecycleConfirmation();
  const html = rendered.html;
  assertIncludes(html, 'role="alertdialog"', "slot lifecycle confirmation role");
  assertIncludes(html, 'aria-modal="true"', "slot lifecycle confirmation modal");
  assertIncludes(
    html,
    'aria-describedby="host-action-confirmation-message-modkill_slot"',
    "slot lifecycle confirmation described-by",
  );
  assertIncludes(
    html,
    'data-testid="critical-host-action-confirmation"',
    "slot lifecycle confirmation root",
  );
  assertIncludes(
    html,
    'data-testid="critical-host-action-confirmation-message"',
    "slot lifecycle confirmation message",
  );
  assertIncludes(html, "Modkill Slot 7", "slot lifecycle confirmation label");
  assertIncludes(
    html,
    "set lifecycle to modkilled",
    "slot lifecycle confirmation outcome",
  );
  assertIncludes(
    html,
    'data-testid="critical-host-action-confirm"',
    "slot lifecycle confirmation confirm",
  );
  assertConfirmationFocusContract(html, {
    initialFocusTestId: "critical-host-action-confirm",
    returnFocusTestId: "critical-host-action-trigger",
    tabContainment: "confirm-cancel",
    label: "slot lifecycle",
  });
  assertIncludes(
    html,
    'data-testid="critical-host-action-cancel"',
    "slot lifecycle confirmation cancel",
  );

  return {
    role: "moderator",
    actionId: "modkill_slot",
    confirmTestIds: ["critical-host-action-confirm"],
    cancelTestIds: ["critical-host-action-cancel"],
    messageTestIds: ["critical-host-action-confirmation-message"],
    focusContracts: [
      {
        initialFocusTestId: "critical-host-action-confirm",
        returnFocusTestId: "critical-host-action-trigger",
        escapeCancels: true,
        tabContainment: "confirm-cancel",
      },
    ],
    htmlBytes: Buffer.byteLength(html),
  };
}

function assertConfirmationFocusContract(
  html,
  { initialFocusTestId, returnFocusTestId, tabContainment, label },
) {
  assertIncludes(
    html,
    `data-initial-focus-testid="${initialFocusTestId}"`,
    `${label} initial focus metadata`,
  );
  assertIncludes(
    html,
    `data-return-focus-testid="${returnFocusTestId}"`,
    `${label} return focus metadata`,
  );
  assertIncludes(
    html,
    'data-escape-cancels="true"',
    `${label} escape cancel metadata`,
  );
  assertIncludes(
    html,
    `data-tab-containment="${tabContainment}"`,
    `${label} tab containment metadata`,
  );
}

async function proveRenderedAdminSurface(bundle) {
  const rendered = await bundle.renderAdminSurface();
  const html = rendered.html;
  assertIncludes(html, 'data-component="fm-app-shell"', "admin surface app shell");
  assertAppShellSkipLink(html, "admin surface");
  assertIncludes(html, 'data-surface="admin"', "admin surface shell state");
  assertIncludes(html, 'data-testid="admin-surface"', "admin route surface");
  assertIncludes(html, 'data-testid="admin-capability"', "admin capability pill");
  assertIncludes(html, "GlobalAdmin", "admin capability label");
  assertIncludes(
    html,
    'data-component="admin-command-activity"',
    "admin command activity component",
  );
  assertIncludes(
    html,
    'data-testid="admin-command-activity"',
    "admin command activity surface",
  );
  assertIncludes(
    html,
    'data-testid="admin-command-activity-empty"',
    "admin command activity empty state",
  );
  assertIncludes(html, "Ready for admin commands", "admin command activity summary");
  for (const id of ["authority", "setup", "audit", "recovery"]) {
    assertIncludes(
      html,
      `data-testid="${adminReadinessTestId(id)}"`,
      `admin readiness ${id}`,
    );
    assertIncludes(
      html,
      `data-testid="${adminReadinessStatusTestId(id)}"`,
      `admin readiness status ${id}`,
    );
  }
  assertIncludes(html, 'data-testid="admin-setup-create-game"', "admin create-game setup");
  assertIncludes(
    html,
    'data-testid="admin-boundary-session-grants"',
    "admin session-grant boundary",
  );
  assertIncludes(
    html,
    'data-testid="admin-audit-link-proof-runs"',
    "admin proof-runs audit link",
  );
  assertIncludes(
    html,
    'href="/admin/audit/proof-runs?game=midsummer"',
    "admin proof-runs native audit route",
  );
  assertIncludes(
    html,
    'data-testid="admin-audit-boundary-proof-runs"',
    "admin proof-runs audit boundary",
  );
  assertIncludes(
    html,
    'data-testid="admin-audit-evidence-proof-runs"',
    "admin proof-runs audit evidence",
  );
  assertIncludes(html, "Read-only operator proof", "admin audit boundary label");
  assertIncludes(
    html,
    'data-testid="admin-recovery-recovery-gate"',
    "admin recovery gate",
  );
  assertIncludes(html, 'data-min-touch-target-px="44"', "admin touch floor");

  return {
    role: "admin",
    path: "/admin",
    surfaceTestId: "admin-surface",
    readinessTestIds: ["authority", "setup", "audit", "recovery"].map((id) =>
      adminReadinessTestId(id),
    ),
    setupTestId: "admin-setup-create-game",
    auditLinkTestId: "admin-audit-link-proof-runs",
    auditInspectHref: "/admin/audit/proof-runs?game=midsummer",
    auditBoundaryTestId: "admin-audit-boundary-proof-runs",
    auditEvidenceTestId: "admin-audit-evidence-proof-runs",
    recoveryTestId: "admin-recovery-recovery-gate",
    commandActivityTestId: "admin-command-activity",
    commandActivityEmptyTestId: "admin-command-activity-empty",
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedAdminAuditDetailSurface(bundle) {
  const rendered = await bundle.renderAdminAuditDetailSurface();
  const html = rendered.html;
  assertIncludes(html, 'data-component="fm-app-shell"', "admin audit detail app shell");
  assertAppShellSkipLink(html, "admin audit detail");
  assertIncludes(html, 'data-surface="admin"', "admin audit detail shell state");
  assertIncludes(
    html,
    'data-testid="admin-audit-detail-surface"',
    "admin audit detail surface",
  );
  assertIncludes(
    html,
    'data-audit-id="proof-runs"',
    "admin audit detail audit id",
  );
  assertIncludes(
    html,
    'data-testid="admin-audit-detail-capability"',
    "admin audit detail capability",
  );
  assertIncludes(html, "GlobalAdmin", "admin audit detail capability label");
  assertIncludes(
    html,
    'data-testid="admin-audit-detail-status"',
    "admin audit detail status",
  );
  assertIncludes(html, 'data-state="ack"', "admin audit detail status state");
  assertIncludes(
    html,
    'data-testid="admin-audit-detail-evidence"',
    "admin audit detail evidence link",
  );
  assertIncludes(
    html,
    'href="/games/midsummer/operator/proof-runs?principal_user_id=admin_a"',
    "admin audit detail machine evidence href",
  );
  assertIncludes(
    html,
    'data-testid="admin-audit-detail-back"',
    "admin audit detail back link",
  );
  assertIncludes(
    html,
    'href="/admin?game=midsummer"',
    "admin audit detail back href",
  );
  assertIncludes(html, "Read-only operator proof", "admin audit detail boundary");

  return {
    role: "admin",
    path: "/admin/audit/proof-runs?game=midsummer",
    surfaceTestId: "admin-audit-detail-surface",
    auditId: "proof-runs",
    capabilityTestId: "admin-audit-detail-capability",
    statusTestId: "admin-audit-detail-status",
    statusState: "ack",
    evidenceTestId: "admin-audit-detail-evidence",
    evidenceHref: "/games/midsummer/operator/proof-runs?principal_user_id=admin_a",
    backTestId: "admin-audit-detail-back",
    backHref: "/admin?game=midsummer",
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedPlayerSurface(bundle) {
  const rendered = await bundle.renderPlayerSurface();
  const html = rendered.html;
  assertIncludes(html, 'data-component="fm-app-shell"', "player surface app shell");
  assertAppShellSkipLink(html, "player surface");
  assertIncludes(html, 'data-surface="player"', "player surface shell state");
  assertIncludes(html, 'data-testid="player-surface"', "player route surface");
  assertIncludes(
    html,
    `data-testid="${PLAYER_COMMAND_PANEL_CONTRACT.deadlineTestId}"`,
    "player deadline test id",
  );
  assertIncludes(html, 'data-state="open"', "player deadline phase state");
  assertIncludes(html, 'data-projected="true"', "player projected deadline flag");
  assertIncludes(html, "Jun 19, 2026, 9:00 PM", "player deadline label");
  assertIncludes(html, "Day 2", "player deadline phase label");
  assertIncludes(html, "player-command-panel__vote-row", "player votecount rows");
  assertIncludes(
    html,
    'data-component="player-command-receipt"',
    "player command receipt component",
  );
  assertIncludes(
    html,
    'data-testid="player-command-receipt"',
    "player command receipt surface",
  );
  assertIncludes(
    html,
    'data-testid="player-command-receipt-empty"',
    "player command receipt empty state",
  );
  assertIncludes(html, "Ready for player commands", "player command receipt summary");
  assertIncludes(html, 'data-testid="player-composer"', "player composer");
  assertIncludes(
    html,
    `data-testid="${PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId}"`,
    "player command channel context",
  );
  assertIncludes(html, 'data-channel-id="main"', "player command main channel id");
  assertIncludes(html, "Posting target", "player command channel label");
  assertIncludes(html, "Main thread as slot-7", "player command channel value");
  assertIncludes(
    html,
    'data-capability-label="SlotOccupant or ChannelMember(main)"',
    "player command channel capability",
  );
  assertIncludes(html, 'data-min-touch-target-px="44"', "player command touch floor");
  assertRenderedOrder({
    html,
    before: 'data-testid="player-primary-action-zone"',
    after: 'data-testid="player-command-receipt"',
    label: "player command controls before live receipts",
  });
  assertIncludes(
    html,
    `data-component="${PLAYER_THREAD_MEDIA_CONTRACT.component}"`,
    "player thread media component",
  );
  assertIncludes(
    html,
    `data-component="${PLAYER_THREAD_PAGER_CONTRACT.component}"`,
    "player thread pager component",
  );
  assertIncludes(
    html,
    `data-testid="${PLAYER_THREAD_PAGER_CONTRACT.rootTestId}"`,
    "player thread pager root",
  );
  assertIncludes(html, 'data-state="ready"', "player thread pager ready state");
  assertIncludes(html, 'aria-busy="false"', "player thread pager idle busy state");
  assertIncludes(
    html,
    `data-testid="${PLAYER_THREAD_PAGER_CONTRACT.cursorTestId}"`,
    "player thread pager cursor",
  );
  assertIncludes(html, "Older before #441", "player thread pager cursor label");
  assertIncludes(
    html,
    `data-testid="${PLAYER_THREAD_PAGER_CONTRACT.buttonTestId}"`,
    "player thread pager load older button",
  );
  assertIncludes(
    html,
    `data-min-touch-target-px="${PLAYER_THREAD_PAGER_CONTRACT.minTouchTargetPx}"`,
    "player thread pager touch floor",
  );
  assertIncludes(
    html,
    `data-testid="thread-post-media-${"e".repeat(64)}"`,
    "player thread media item",
  );
  assertIncludes(
    html,
    'data-media-variant="tablet"',
    "player thread tablet media variant",
  );
  assertIncludes(
    html,
    'src="/media/midsummer/thread/receipt-442-tablet.png"',
    "player thread tablet image src",
  );
  assertIncludes(
    html,
    "/media/midsummer/thread/receipt-442-small.png 480w",
    "player thread small image srcset",
  );
  assertExcludes(
    html,
    "/media/midsummer/thread/receipt-442-original.png",
    "player thread original image URL",
  );

  return {
    role: "player",
    path: "/g/midsummer",
    surfaceTestId: "player-surface",
    deadlineTestId: PLAYER_COMMAND_PANEL_CONTRACT.deadlineTestId,
    deadlineValue: "Jun 19, 2026, 9:00 PM",
    deadlineState: "open",
    deadlineProjected: true,
    commandReceiptTestId: "player-command-receipt",
    commandReceiptEmptyTestId: "player-command-receipt-empty",
    commandReceiptCurrentStatusTestId:
      PLAYER_COMMAND_RECEIPT_CONTRACT.currentStatusTestId,
    commandChannelContext: {
      testId: PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
      channelId: "main",
      channelLabel: "Main thread",
      capabilityLabel: "SlotOccupant or ChannelMember(main)",
      actorSlot: "slot-7",
    },
    threadPager: {
      component: PLAYER_THREAD_PAGER_CONTRACT.component,
      rootTestId: PLAYER_THREAD_PAGER_CONTRACT.rootTestId,
      state: "ready",
      busy: "false",
      cursorTestId: PLAYER_THREAD_PAGER_CONTRACT.cursorTestId,
      cursorLabel: "Older before #441",
      buttonTestId: PLAYER_THREAD_PAGER_CONTRACT.buttonTestId,
      buttonLabel: "Load older",
      buttonDisabled: false,
      buttonDisabledReason: null,
      minTouchTargetPx: PLAYER_THREAD_PAGER_CONTRACT.minTouchTargetPx,
      nextBeforeSeq: 441,
    },
    primaryControlsBeforeReceipts: true,
    media: {
      component: PLAYER_THREAD_MEDIA_CONTRACT.component,
      renderedTestId: `thread-post-media-${"e".repeat(64)}`,
      renderedVariant: "tablet",
      renderedSrc: "/media/midsummer/thread/receipt-442-tablet.png",
      originalUrlRendered: false,
      preferredVariants: PLAYER_THREAD_MEDIA_CONTRACT.preferredVariants,
      forbiddenVariants: PLAYER_THREAD_MEDIA_CONTRACT.forbiddenVariants,
    },
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedPlayerThreadPagerStates(bundle) {
  const pending = await assertRenderedPlayerThreadPagerState({
    bundle,
    state: "pending",
    label: "Loading older",
    reason: "Loading older posts",
    busy: "true",
  });
  const complete = await assertRenderedPlayerThreadPagerState({
    bundle,
    state: "complete",
    label: "No older posts",
    reason: "At oldest loaded post",
    busy: "false",
  });

  return {
    boundary:
      "Build-mode Svelte SSR renders player thread pager disabled states with visible button reasons for pending duplicate-load prevention and complete oldest-page state. This proves the touch control does not rely on hidden title text; browser focus and pointer behavior remain covered by browser lanes.",
    states: [pending, complete],
  };
}

async function assertRenderedPlayerThreadPagerState({
  bundle,
  state,
  label,
  reason,
  busy,
}) {
  const rendered = await bundle.renderPlayerThreadPagerState(state);
  const html = rendered.html;
  assertIncludes(
    html,
    `data-component="${PLAYER_THREAD_PAGER_CONTRACT.component}"`,
    `player thread pager ${state} component`,
  );
  assertIncludes(
    html,
    `data-state="${state}"`,
    `player thread pager ${state} state`,
  );
  assertIncludes(
    html,
    `aria-busy="${busy}"`,
    `player thread pager ${state} busy`,
  );
  assertIncludes(
    html,
    `data-testid="${PLAYER_THREAD_PAGER_CONTRACT.buttonTestId}"`,
    `player thread pager ${state} button`,
  );
  assertIncludes(
    html,
    "fm-touch-button__label",
    `player thread pager ${state} label class`,
  );
  assertIncludes(
    html,
    label,
    `player thread pager ${state} label text`,
  );
  assertIncludes(
    html,
    "fm-touch-button__reason",
    `player thread pager ${state} reason class`,
  );
  assertIncludes(
    html,
    reason,
    `player thread pager ${state} reason text`,
  );
  assertIncludes(
    html,
    'aria-disabled="true"',
    `player thread pager ${state} aria disabled`,
  );
  assertExcludes(
    html,
    "title=",
    `player thread pager ${state} tooltip dependency`,
  );

  return {
    state,
    label,
    reason,
    busy,
    buttonTestId: PLAYER_THREAD_PAGER_CONTRACT.buttonTestId,
    htmlBytes: Buffer.byteLength(html),
  };
}

async function proveRenderedModeratorSurface(bundle) {
  const rendered = await bundle.renderModeratorSurface();
  const html = rendered.html;
  assertIncludes(html, 'data-component="fm-app-shell"', "moderator surface app shell");
  assertAppShellSkipLink(html, "moderator surface");
  assertIncludes(html, 'data-surface="moderator"', "moderator surface shell state");
  assertIncludes(html, 'data-testid="host-console-surface"', "moderator route surface");
  assertIncludes(html, 'data-testid="host-console-capability"', "moderator capability");
  assertIncludes(html, "HostOf(midsummer)", "moderator capability label");
  assertIncludes(
    html,
    `data-testid="${HOST_CONTROL_SURFACE_CONTRACT.commandContextTestId}"`,
    "moderator command authority context",
  );
  assertIncludes(html, "Command authority", "moderator command authority label");
  assertIncludes(
    html,
    "HostOf(midsummer) as host_h",
    "moderator command authority value",
  );
  assertIncludes(html, 'data-game-id="midsummer"', "moderator command authority game");
  assertIncludes(
    html,
    'data-principal-user-id="host_h"',
    "moderator command authority principal",
  );
  assertIncludes(
    html,
    'data-capability-label="HostOf(midsummer)"',
    "moderator command authority capability",
  );
  assertIncludes(
    html,
    'data-command-endpoint="/commands"',
    "moderator command authority endpoint",
  );
  for (const id of ["phase", "votecount", "prompts", "lifecycle"]) {
    assertIncludes(
      html,
      `data-testid="${hostOperationTestId(id)}"`,
      `moderator operation ${id}`,
    );
    assertIncludes(
      html,
      `data-testid="${hostOperationStatusTestId(id)}"`,
      `moderator operation status ${id}`,
    );
  }
  for (const actionId of [
    "critical-host-action-extend_deadline",
    "critical-host-action-resolve_phase",
    "critical-host-action-lock_thread",
    "critical-host-action-publish_votecount",
    "critical-host-action-process_replacement",
    "critical-host-action-mark_dead",
    "critical-host-action-modkill_slot",
    "critical-host-action-complete_game",
    "critical-host-action-resolve_host_prompt-D01-skip_next_day-slot_1",
  ]) {
    assertIncludes(html, `data-testid="${actionId}"`, `moderator ${actionId}`);
  }
  assertIncludes(
    html,
    'data-testid="moderator-control-host-prompts"',
    "moderator host prompts control bay",
  );
  assertIncludes(
    html,
    "Resolve prompt",
    "moderator host prompt action label",
  );
  assertIncludes(
    html,
    "ResolveHostPrompt preserves pack-defined policy",
    "moderator host prompt boundary",
  );
  assertIncludes(html, "official-votecount-live-ws", "moderator votecount boundary");
  assertIncludes(
    html,
    'data-component="host-command-activity"',
    "moderator command activity component",
  );
  assertIncludes(
    html,
    'data-testid="host-command-activity"',
    "moderator command activity surface",
  );
  assertIncludes(
    html,
    'data-testid="host-command-activity-empty"',
    "moderator command activity empty state",
  );
  assertIncludes(html, "Ready for host commands", "moderator command activity summary");
  assertIncludes(html, 'data-min-touch-target-px="44"', "moderator touch floor");

  return {
    role: "moderator",
    path: "/g/midsummer/host",
    surfaceTestId: "host-console-surface",
    operationTestIds: ["phase", "votecount", "prompts", "lifecycle"].map((id) =>
      hostOperationTestId(id),
    ),
    criticalActionTestIds: [
      "critical-host-action-extend_deadline",
      "critical-host-action-resolve_phase",
      "critical-host-action-lock_thread",
      "critical-host-action-publish_votecount",
      "critical-host-action-process_replacement",
      "critical-host-action-mark_dead",
      "critical-host-action-modkill_slot",
      "critical-host-action-complete_game",
      "critical-host-action-resolve_host_prompt-D01-skip_next_day-slot_1",
    ],
    hostPromptControlTestId: "moderator-control-host-prompts",
    hostPromptActionTestId:
      "critical-host-action-resolve_host_prompt-D01-skip_next_day-slot_1",
    commandContext: {
      testId: HOST_CONTROL_SURFACE_CONTRACT.commandContextTestId,
      gameId: "midsummer",
      principalUserId: "host_h",
      capabilityLabel: "HostOf(midsummer)",
      commandEndpoint: "/commands",
    },
    commandActivityTestId: "host-command-activity",
    commandActivityEmptyTestId: "host-command-activity-empty",
    htmlBytes: Buffer.byteLength(html),
  };
}

function assertRenderedScenario({ html, scenario, view }) {
  assertIncludes(html, 'data-component="fm-app-shell"', `${scenario.id} app shell`);
  assertAppShellSkipLink(html, scenario.id);
  assertAppShellTopbar(html, scenario.id);
  assertAppShellSession(html, scenario.id);
  assertIncludes(
    html,
    `aria-label="${APP_SHELL_CONTRACT.navLabel}"`,
    `${scenario.id} shell nav label`,
  );
  assertIncludes(
    html,
    `data-surface="${scenario.surface}"`,
    `${scenario.id} shell/route-state surface`,
  );
  assertIncludes(
    html,
    `data-testid="${scenario.surfaceTestId}"`,
    `${scenario.id} role surface`,
  );
  assertIncludes(
    html,
    `data-testid="${scenario.rootTestId}"`,
    `${scenario.id} route-state root`,
  );
  assertIncludes(
    html,
    `data-state="${scenario.state}"`,
    `${scenario.id} route-state data state`,
  );
  assertIncludes(html, escapeHtml(view.title), `${scenario.id} title`);
  assertIncludes(html, escapeHtml(view.message), `${scenario.id} message`);
  assertIncludes(
    html,
    `data-testid="${scenario.statusTestId}"`,
    `${scenario.id} status test id`,
  );
  assertIncludes(
    html,
    `data-state="${scenario.statusState}"`,
    `${scenario.id} status state`,
  );
  assertIncludes(html, 'role="status"', `${scenario.id} status role`);
  assertIncludes(
    html,
    `aria-live="${scenario.ariaLive}"`,
    `${scenario.id} aria-live`,
  );
  assertIncludes(html, 'aria-atomic="true"', `${scenario.id} aria-atomic`);
  assertIncludes(
    html,
    `data-testid="${scenario.actionTestId}"`,
    `${scenario.id} action test id`,
  );
  assertIncludes(html, 'href="/"', `${scenario.id} recovery href`);
  assertIncludes(
    html,
    "fm-touch-button fm-touch-button--secondary",
    `${scenario.id} touch action class`,
  );
  assertRenderedRoleNav({ html, scenario });
}

function assertAppShellSkipLink(html, label) {
  assertIncludes(
    html,
    `data-testid="${APP_SHELL_CONTRACT.skipLinkTestId}"`,
    `${label} shell skip link`,
  );
  assertIncludes(
    html,
    `href="#${APP_SHELL_CONTRACT.mainTargetId}"`,
    `${label} shell skip target href`,
  );
  assertIncludes(
    html,
    APP_SHELL_CONTRACT.skipLinkLabel,
    `${label} shell skip label`,
  );
  assertIncludes(
    html,
    `id="${APP_SHELL_CONTRACT.mainTargetId}"`,
    `${label} shell main target id`,
  );
  assertIncludes(
    html,
    `data-testid="${APP_SHELL_CONTRACT.mainTargetTestId}"`,
    `${label} shell main target test id`,
  );
  assertIncludes(html, 'tabindex="-1"', `${label} shell main target focus`);
}

function assertAppShellTopbar(html, label) {
  assertIncludes(
    html,
    `data-testid="${APP_SHELL_CONTRACT.topbarTestId}"`,
    `${label} shell topbar`,
  );
  assertIncludes(
    html,
    `data-topbar-mode="${APP_SHELL_CONTRACT.topbarMode}"`,
    `${label} shell sticky topbar mode`,
  );
  assertIncludes(
    html,
    `data-sticky-top-px="${APP_SHELL_CONTRACT.topbarStickyTopPx}"`,
    `${label} shell sticky topbar offset`,
  );
  assertIncludes(
    html,
    `data-block-size-px="${APP_SHELL_CONTRACT.topbarBlockSizePx}"`,
    `${label} shell sticky topbar block size`,
  );
}

function assertAppShellSession(html, label) {
  assertIncludes(
    html,
    `data-testid="${APP_SHELL_CONTRACT.sessionTestId}"`,
    `${label} shell session capsule`,
  );
  assertIncludes(
    html,
    `data-testid="${APP_SHELL_CONTRACT.sessionPrincipalTestId}"`,
    `${label} shell session principal`,
  );
  assertIncludes(
    html,
    `data-testid="${APP_SHELL_CONTRACT.sessionGameTestId}"`,
    `${label} shell session game`,
  );
  assertIncludes(
    html,
    `data-testid="${APP_SHELL_CONTRACT.sessionCapabilityTestId}"`,
    `${label} shell session capabilities`,
  );
  assertIncludes(
    html,
    "data-capability-count=",
    `${label} shell session capability count`,
  );
}

function assertRenderedRoleNav({ html, scenario }) {
  for (const [surface, navigation] of Object.entries(scenario.nav)) {
    assertIncludes(
      html,
      `data-testid="${roleNavTestId(surface)}"`,
      `${scenario.id} ${surface} nav test id`,
    );
    assertIncludes(
      html,
      `data-min-touch-target-px="${APP_SHELL_CONTRACT.minTouchTargetPx}"`,
      `${scenario.id} ${surface} nav touch floor`,
    );
    assertIncludes(
      html,
      `data-allowed="${navigation === "link"}"`,
      `${scenario.id} ${surface} nav allowed state`,
    );
    if (surface === scenario.surface) {
      assertIncludes(
        html,
        'aria-current="page"',
        `${scenario.id} active role nav`,
      );
    }
    if (navigation === "blocked") {
      assertIncludes(
        html,
        "data-blocked-reason=",
        `${scenario.id} blocked role reason`,
      );
      assertIncludes(
        html,
        'aria-disabled="true"',
        `${scenario.id} blocked role aria-disabled`,
      );
      assertIncludes(
        html,
        'class="fm-app-shell__nav-reason"',
        `${scenario.id} blocked role visible reason class`,
      );
    }
  }
}

function assertRenderedShellNav({ id, render, html, expectedNav }) {
  const shellComponentCount = countOccurrences(
    html,
    `data-component="${APP_SHELL_CONTRACT.component}"`,
  );
  assert.equal(shellComponentCount, 1, `${id} rendered duplicate app shells`);
  assertAppShellSession(html, id);
  const navItems = APP_SHELL_CONTRACT.surfaceOrder.map((surface) => {
    const testId = roleNavTestId(surface);
    const tag = tagWithTestId(html, testId);
    assert.notEqual(tag, null, `${id} ${surface} shell nav item missing`);
    assertIncludes(
      tag,
      `data-min-touch-target-px="${APP_SHELL_CONTRACT.minTouchTargetPx}"`,
      `${id} ${surface} shell nav touch floor`,
    );
    const rendered = renderedShellNavigation(tag);
    assert.equal(
      rendered.navigation,
      expectedNav[surface],
      `${id} ${surface} shell nav mismatch`,
    );
    if (rendered.navigation === "blocked") {
      assertIncludes(
        html,
        `<small class="fm-app-shell__nav-reason">${navBlockedLabel(surface)}</small>`,
        `${id} ${surface} shell nav visible blocked reason`,
      );
      assert.match(
        String(rendered.blockedReason ?? ""),
        /^Requires /,
        `${id} ${surface} shell nav capability grammar in data attribute`,
      );
      assertExcludes(
        tag,
        "title=",
        `${id} ${surface} shell nav tooltip dependency`,
      );
    }
    return {
      surface,
      testId,
      expected: expectedNav[surface],
      rendered: rendered.navigation,
      tagName: rendered.tagName,
      ...(rendered.href === null ? {} : { href: rendered.href }),
      ...(rendered.blockedReason === null
        ? {}
        : { blockedReason: rendered.blockedReason }),
    };
  });

  return {
    id,
    render,
    navigation: Object.fromEntries(
      navItems.map((item) => [item.surface, item.rendered]),
    ),
    linkedNavTestIds: navItems
      .filter((item) => item.rendered === "link")
      .map((item) => item.testId),
    blockedNavTestIds: navItems
      .filter((item) => item.rendered === "blocked")
      .map((item) => item.testId),
    blockedNavReasons: navItems
      .filter((item) => item.rendered === "blocked")
      .map((item) => ({
        testId: item.testId,
        blockedReason: item.blockedReason,
      })),
    sessionTestId: APP_SHELL_CONTRACT.sessionTestId,
    sessionPrincipalTestId: APP_SHELL_CONTRACT.sessionPrincipalTestId,
    sessionCapabilityTestId: APP_SHELL_CONTRACT.sessionCapabilityTestId,
    sessionGameTestId: APP_SHELL_CONTRACT.sessionGameTestId,
    shellComponentCount,
    navItems,
    ...(id === boardScenario.id
      ? { blockedActionReasons: assertBoardBlockedActionReasons({ id, html }) }
      : {}),
    htmlBytes: Buffer.byteLength(html),
  };
}

function assertBoardBlockedActionReasons({ id, html }) {
  return boardScenario.actions
    .filter((action) => action.navigation === "blocked")
    .map((action) => {
      const tag = tagWithTestId(html, action.testId);
      assert.notEqual(tag, null, `${id} blocked board action ${action.testId} missing`);
      assertIncludes(
        tag,
        `data-blocked-reason="${action.blockedReason}"`,
        `${id} blocked board action ${action.testId} reason attribute`,
      );
      assertIncludes(
        html,
        `>${action.blockedLabel}</small>`,
        `${id} blocked board action ${action.testId} visible reason`,
      );
      assertExcludes(
        tag,
        "title=",
        `${id} blocked board action ${action.testId} tooltip dependency`,
      );
      return {
        testId: action.testId,
        blockedReason: action.blockedReason,
        titleAttribute: false,
      };
    });
}

function countOccurrences(value, needle) {
  return String(value).split(needle).length - 1;
}

function renderedShellNavigation(tag) {
  const tagName = tag.match(/^<([a-z0-9:-]+)/iu)?.[1] ?? "unknown";
  const href = attributeValue(tag, "href");
  const allowed = attributeValue(tag, "data-allowed");
  if (allowed === "true") {
    assert.equal(tagName, "a", `allowed shell nav item should render as link: ${tag}`);
    assert.notEqual(href, null, `allowed shell nav item missing href: ${tag}`);
    return { tagName, href, navigation: "link" };
  }
  if (allowed === "false") {
    assert.equal(
      tag.includes('aria-disabled="true"'),
      true,
      `blocked shell nav item missing aria-disabled: ${tag}`,
    );
    const blockedReason = attributeValue(tag, "data-blocked-reason");
    assert.notEqual(
      blockedReason,
      null,
      `blocked shell nav item missing blocked reason: ${tag}`,
    );
    return { tagName, href, navigation: "blocked", blockedReason };
  }
  throw new Error(`unknown shell nav allowed state in ${tag}`);
}

function assertIncludes(haystack, needle, label) {
  assert.equal(
    haystack.includes(needle),
    true,
    `${label} missing ${needle}`,
  );
}

function assertRenderedOrder({ html, before, after, label }) {
  const beforeIndex = html.indexOf(before);
  const afterIndex = html.indexOf(after);
  assert.notEqual(beforeIndex, -1, `${label} missing before marker ${before}`);
  assert.notEqual(afterIndex, -1, `${label} missing after marker ${after}`);
  assert.equal(beforeIndex < afterIndex, true, label);
}

function assertExcludes(haystack, needle, label) {
  assert.equal(
    haystack.includes(needle),
    false,
    `${label} unexpectedly included ${needle}`,
  );
}

function assertCommandTraceAttributes(html, expected) {
  const tag = tagWithTestId(html, expected.testId);
  assert.notEqual(tag, null, `${expected.testId} command trace row missing`);
  const trace = {
    kind: attributeValue(tag, "data-command-trace-kind"),
    surface: attributeValue(tag, "data-command-surface"),
    actionId: attributeValue(tag, "data-command-action-id"),
    statusKey: attributeValue(tag, "data-command-status-key"),
    dispatchKind: attributeValue(tag, "data-command-dispatch-kind"),
    refreshKeys: attributeValue(tag, "data-command-refresh-keys"),
  };
  assert.deepEqual(trace, {
    kind: "command-trace",
    surface: expected.surface,
    actionId: expected.actionId,
    statusKey: expected.statusKey,
    dispatchKind: expected.dispatchKind,
    refreshKeys: expected.refreshKeys,
  });
  return trace;
}

function assertConfirmationTraceAttributes(html, expected) {
  const tag = tagWithTestId(html, expected.testId);
  assert.notEqual(tag, null, `${expected.testId} confirmation trace row missing`);
  const trace = {
    kind: attributeValue(tag, "data-confirmation-trace-kind"),
    surface: attributeValue(tag, "data-confirmation-surface"),
    actionId: attributeValue(tag, "data-confirmation-action-id"),
    statusKey: attributeValue(tag, "data-confirmation-status-key"),
    dispatchKind: attributeValue(tag, "data-confirmation-dispatch-kind"),
  };
  assert.deepEqual(trace, {
    kind: "confirmation-command-trace",
    surface: expected.surface,
    actionId: expected.actionId,
    statusKey: expected.statusKey,
    dispatchKind: expected.dispatchKind,
  });
  return trace;
}

function tagWithTestId(html, testId) {
  const pattern = new RegExp(`<[^>]+data-testid="${escapeRegExp(testId)}"[^>]*>`, "u");
  return html.match(pattern)?.[0] ?? null;
}

function attributeValue(tag, attribute) {
  return tag.match(new RegExp(`${escapeRegExp(attribute)}="([^"]*)"`, "u"))?.[1] ?? null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertPrivateDisclosureDoesNotLeakHostOnlyCopy(html, label) {
  for (const forbidden of ["host prompt", "moderator", "host-only", "resolve_host_prompt"]) {
    assert.equal(
      html.toLowerCase().includes(forbidden),
      false,
      `${label} leaked ${forbidden}`,
    );
  }
}

function assertPlayerRoutePrivateDetailDoesNotLeakHostOnlyCopy(html, label) {
  for (const forbidden of ["host prompt", "host-only", "resolve_host_prompt"]) {
    assert.equal(
      html.toLowerCase().includes(forbidden),
      false,
      `${label} leaked ${forbidden}`,
    );
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderEntrySource() {
  return `import { render } from "svelte/server";
import { setPage } from "$app/stores";
	import AppRootShell from "./AppRootShell.svelte";
import BoardPage from "../src/routes/+page.svelte";
import ErrorPage from "../src/routes/+error.svelte";
import AppNavigationPending from "../src/lib/app/AppNavigationPending.svelte";
import RouteLoading from "../src/lib/app/RouteLoading.svelte";
import AdminPage from "../src/routes/admin/+page.svelte";
import AdminAuditDetailPage from "../src/routes/admin/audit/[audit]/+page.svelte";
import PlayerPage from "../src/routes/g/[game]/+page.svelte";
import PlayerChannelPage from "../src/routes/g/[game]/c/[channel]/+page.svelte";
import HostPage from "../src/routes/g/[game]/host/+page.svelte";
import AdminSetupGrid from "../src/lib/components/admin/AdminSetupGrid.svelte";
import AdminRecoveryPanel from "../src/lib/components/admin/AdminRecoveryPanel.svelte";
import AdminCommandActivity from "../src/lib/components/admin/AdminCommandActivity.svelte";
import HostAction from "../src/lib/components/host-action/HostAction.svelte";
import HostCommandActivity from "../src/lib/components/host-action/HostCommandActivity.svelte";
import PlayerCommandPanel from "../src/lib/components/player-command/PlayerCommandPanel.svelte";
import PlayerEndgameSummary from "../src/lib/components/player-endgame-summary/PlayerEndgameSummary.svelte";
import { buildPlayerEndgameSummaryViewModel } from "../src/lib/components/player-endgame-summary/player-endgame-summary-model.mjs";
import PlayerCommandReceipt from "../src/lib/components/player-command/PlayerCommandReceipt.svelte";
import PlayerPrivateQueue from "../src/lib/components/player-private-queue/PlayerPrivateQueue.svelte";
import PlayerThread from "../src/lib/components/player-thread/PlayerThread.svelte";
import {
  buildAdminAuditDetailData,
  buildAdminRouteData,
} from "../src/routes/admin/admin-route-model.mjs";
import { adminConfirmStatus } from "../src/routes/admin/admin-route-controller.mjs";
import {
  playerCommandTrace,
  recordPlayerCommandReceipt,
} from "../src/routes/g/[game]/player-route-controller.mjs";
import { hostConfirmationCommandTrace } from "../src/lib/components/host-action/host-action-contract.mjs";
import {
  buildGameRouteData,
  buildPlayerComposerView,
  playerActionOpenFixture,
  playerActionSubmittedFixture,
} from "../src/routes/g/[game]/game-route-model.mjs";
import { buildHostConsoleRouteData } from "../src/routes/g/[game]/host/host-route-model.mjs";
import { buildRouteStateRouteData } from "../src/lib/app/app-route-state-model.mjs";
import {
  buildBoardRouteData,
  fixtureBoardGameIndexPage,
} from "../src/lib/app/app-shell-model.mjs";
import { resolveFixtureSession } from "../src/lib/server/session-capabilities.mjs";
import {
  buildPlayerPrivateQueueViewModel,
  buildPrivateQueue,
  buildPrivateQueueBoundary,
} from "../src/lib/components/player-private-queue/player-private-queue-model.mjs";

function fixtureRouteInput({ token, game = "midsummer" }) {
  const session = resolveFixtureSession({ token, game });
  return {
    principalUserId: session.principalUserId,
    capabilities: session.resolvedCapabilities,
  };
}

	function fixtureRouteInputForRole(role) {
  if (role === "admin") {
    return fixtureRouteInput({ token: "fixture-admin" });
  }
  if (role === "player") {
    return fixtureRouteInput({ token: "fixture-player" });
  }
  if (role === "moderator") {
    return fixtureRouteInput({ token: "fixture-host" });
  }
	  throw new Error(\`unknown fixture route input role \${role}\`);
	}

	function rootRouteData(data) {
	  return {
	    ...data,
	    shellOwner: "layout",
	  };
	}

	function appSessionForData(data) {
	  return {
	    principalUserId: data.session?.principalUserId ??
	      data.operator?.principalUserId ??
	      (data.shell?.session?.principalLabel === "Signed out"
	        ? null
	        : data.shell?.session?.principalLabel ?? null),
	    resolvedCapabilities: data.session?.resolvedCapabilities ?? [],
	  };
	}

	function renderWithRootLayout({ page, data, url = "http://localhost/" }) {
	  const rootData = rootRouteData(data);
	  const appSession = appSessionForData(rootData);
	  setPage({
	    status: 200,
	    error: null,
	    url: new URL(url),
	    data: {
	      ...rootData,
	      appSession,
	    },
	  });
	  return render(AppRootShell, {
	    props: {
	      page,
	      data: rootData,
	      layoutData: { ...rootData, appSession },
	    },
	  });
	}

export async function renderBoardSurface() {
	  const data = buildBoardRouteData({
    principalUserId: "admin_a",
    capabilities: [
      { kind: "GlobalAdmin" },
      { kind: "HostOf", game: "midsummer" },
      { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
    ],
		gameIndexPage: fixtureBoardGameIndexPage("midsummer"),
	  });
	  return renderWithRootLayout({ page: "board", data });
	}

export async function renderBoardPlayerSurface() {
	  const data = buildBoardRouteData({
    ...fixtureRouteInput({ token: "fixture-player" }),
		gameIndexPage: fixtureBoardGameIndexPage("midsummer"),
	  });
	  return renderWithRootLayout({ page: "board", data });
	}

export async function renderRouteErrorSurface() {
  setPage({
    status: 403,
    error: {
      message: "Channel private:role_pm:slot-7 is not visible.",
    },
    url: new URL("http://localhost/g/midsummer/c/private%3Arole_pm%3Aslot-7"),
    data: {
      appSession: {
        principalUserId: "player_mira",
        resolvedCapabilities: [
          { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
          { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
        ],
      },
    },
  });
  return render(ErrorPage);
}

export async function renderRouteLoadingSurface() {
  return render(RouteLoading, {
    props: {
      path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      principalUserId: "player_mira",
      capabilities: [
        { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
        { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
      ],
    },
  });
}

export async function renderNavigationPendingLayer() {
  return render(AppNavigationPending, {
    props: {
      path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      principalUserId: "player_mira",
      capabilities: [
        { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
        { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
      ],
    },
  });
}

export async function renderNavigationPendingLayerHidden() {
  return render(AppNavigationPending, {
    props: {
      path: null,
      principalUserId: "player_mira",
      capabilities: [
        { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      ],
    },
  });
}

export async function renderScenario(role, state) {
	  if (role === "board") {
	    const data = {
	      ...buildBoardRouteData({
	        ...fixtureRouteInput({ token: "fixture-player" }),
	        gameIndexPage: fixtureBoardGameIndexPage("midsummer"),
	      }),
	      routeState: buildRouteStateRouteData({ surface: "board", state }),
	    };
	    return renderWithRootLayout({ page: "board", data });
	  }

  if (role === "admin") {
	    const data = {
	      ...(await buildAdminRouteData(fixtureRouteInputForRole("admin"))),
	      routeState: buildRouteStateRouteData({ surface: "admin", state }),
	    };
	    return renderWithRootLayout({ page: "admin", data, url: "http://localhost/admin" });
	  }

  if (role === "player") {
	    const data = {
	      ...(await buildGameRouteData({
	        game: "midsummer",
	        ...fixtureRouteInputForRole("player"),
	      })),
	      routeState: buildRouteStateRouteData({ surface: "player", state }),
	    };
	    return renderWithRootLayout({ page: "player", data, url: "http://localhost/g/midsummer" });
	  }

  if (role === "player-private-channel") {
	    const data = {
	      ...(await buildGameRouteData({
	        game: "midsummer",
	        activeChannel: "private:role_pm:slot-7",
	        ...fixtureRouteInputForRole("player"),
	      })),
	      routeState: buildRouteStateRouteData({ surface: "player", state }),
	    };
	    return renderWithRootLayout({
	      page: "player-channel",
	      data,
	      url: "http://localhost/g/midsummer/c/private%3Arole_pm%3Aslot-7",
	    });
	  }

  if (role === "moderator") {
	    const data = {
	      ...(await buildHostConsoleRouteData({
	        game: "midsummer",
	        ...fixtureRouteInputForRole("moderator"),
	      })),
	      routeState: buildRouteStateRouteData({ surface: "moderator", state }),
	    };
	    return renderWithRootLayout({
	      page: "moderator",
	      data,
	      url: "http://localhost/g/midsummer/host",
	    });
	  }

  throw new Error(\`unknown route-state render role \${role}\`);
}

	export async function renderPlayerSurface() {
	  const data = await buildGameRouteData({
	    game: "midsummer",
	    ...fixtureRouteInputForRole("player"),
	  });
	  return renderWithRootLayout({ page: "player", data, url: "http://localhost/g/midsummer" });
	}

export async function renderPlayerThreadPagerState(state) {
	  const data = await buildGameRouteData({
	    game: "midsummer",
	    ...fixtureRouteInputForRole("player"),
	  });
  const thread = state === "complete"
    ? { ...data.thread, nextBeforeSeq: null }
    : data.thread;
  const threadPageStatus = state === "pending"
    ? { state: "pending", message: "Loading older posts" }
    : state === "complete"
      ? { state: "ack", message: "Loaded 2 older posts" }
      : null;
  return render(PlayerThread, {
    props: {
      phase: data.phase,
      thread,
      liveOfficialPost: null,
      threadPageStatus,
    },
  });
}

export async function renderPlayerPrivateReviewRoute() {
	  const data = await buildGameRouteData({
	    game: "midsummer",
	    privateItem: "notification-1",
	    ...fixtureRouteInputForRole("player"),
	  });
	  return renderWithRootLayout({
	    page: "player",
	    data,
	    url: "http://localhost/g/midsummer?private=notification-1",
	  });
	}

export async function renderPlayerPrivateChannelRoute() {
	  const data = await buildGameRouteData({
	    game: "midsummer",
	    activeChannel: "private:role_pm:slot-7",
	    ...fixtureRouteInputForRole("player"),
	  });
	  return renderWithRootLayout({
	    page: "player-channel",
	    data,
	    url: "http://localhost/g/midsummer/c/private%3Arole_pm%3Aslot-7",
	  });
	}

export async function renderPlayerPrivateDisclosure(expanded) {
  const boundary = buildPrivateQueueBoundary({
    notifications: [{ effect: "Commuted", phase_id: "N02", status: "Delivered" }],
    investigationResults: [{ mode: "tracker", target_slot: "slot-4" }],
  });
  const items = buildPrivateQueue({
    notifications: [{ effect: "Commuted", phase_id: "N02", status: "Delivered" }],
    investigationResults: [{ mode: "tracker", target_slot: "slot-4" }],
  }).map((item) => ({
    ...item,
    reviewHref: item.id === "notification-1"
      ? "/g/midsummer?private=notification-1"
      : "/g/midsummer?private=investigation-1",
  }));
  const expandedItems = expanded ? { "notification-1": true } : {};
  buildPlayerPrivateQueueViewModel({ boundary, items, expandedItems });
  return render(PlayerPrivateQueue, {
    props: {
      boundary,
      items,
      expandedItems,
      onToggle: () => {},
    },
  });
}

export async function renderAdminCommandActivity() {
  const data = await buildAdminRouteData(fixtureRouteInputForRole("admin"));
  const sessionGrants = data.gameSetup.find((item) => item.id === "session-grants");
  const recoveryGate = data.recoveryTasks.find((item) => item.id === "recovery-gate");
  const recoveryStatus = {
    ...adminConfirmStatus(recoveryGate),
    state: "ack",
    message: "Recovery gate trusted: 4/4 production artifacts trusted",
  };
  return render(AdminCommandActivity, {
    props: {
      commandStatuses: {
        "session-grants": adminConfirmStatus(sessionGrants),
        "recovery-gate": recoveryStatus,
      },
    },
  });
}

export async function renderPlayerCommandReceipt() {
  return render(PlayerCommandReceipt, {
    props: {
      receipts: recordPlayerCommandReceipt([], "submit_vote", {
        actionId: "submit_vote",
        state: "reject",
        message: "Reject PhaseLocked: reload and retry",
        commandTrace: playerCommandTrace("submit_vote"),
      }),
    },
  });
}

export async function renderModeratorCommandActivity() {
  const promptActionId = "resolve_host_prompt-D01-skip_next_day-slot_1";
  return render(HostCommandActivity, {
    props: {
      commandStatuses: {
        extend_deadline: {
          state: "reject",
          message: "reload and retry",
          confirmationTrace: hostConfirmationCommandTrace({
            id: "extend_deadline",
            label: "Extend deadline",
            objectLabel: "Day 2 deadline",
            outcomeLabel: "move the deadline to June 19, 2026 at 9:00 PM PT",
            confirmationText:
              "Extend Day 2 deadline: move the deadline to June 19, 2026 at 9:00 PM PT for Day 2 deadline.",
            requiresConfirmation: true,
            payload: { kind: "extend_deadline", gameId: "midsummer" },
          }),
        },
      },
      commandOutcomes: [
        {
          actionId: promptActionId,
          state: "ack",
          message: "Ack: host prompt resolved",
          confirmationTrace: hostConfirmationCommandTrace({
            id: promptActionId,
            label: "Resolve prompt",
            objectLabel: "skip_next_day prompt",
            outcomeLabel: "acknowledge prompt",
            confirmationText:
              "Resolve skip_next_day prompt: acknowledge prompt for skip_next_day prompt.",
            requiresConfirmation: true,
            payload: {
              kind: "resolve_host_prompt",
              gameId: "midsummer",
              promptId: "D01:skip_next_day:slot_1",
              decision: { kind: "acknowledge" },
            },
          }),
        },
      ],
    },
  });
}

	export async function renderAdminSurface() {
	  const data = await buildAdminRouteData(fixtureRouteInputForRole("admin"));
	  return renderWithRootLayout({ page: "admin", data, url: "http://localhost/admin" });
	}

export async function renderAdminAuditDetailSurface() {
	  const data = await buildAdminAuditDetailData({
	    audit: "proof-runs",
	    game: "midsummer",
	    ...fixtureRouteInputForRole("admin"),
	  });
	  return renderWithRootLayout({
	    page: "admin-audit-detail",
	    data,
	    url: "http://localhost/admin/audit/proof-runs?game=midsummer",
	  });
	}

export async function renderAdminSetupConfirmation() {
  const data = await buildAdminRouteData(fixtureRouteInputForRole("admin"));
  const sessionGrants = data.gameSetup.find((item) => item.id === "session-grants");
  const cohost = data.gameSetup.find((item) => item.id === "cohost");
  return render(AdminSetupGrid, {
    props: {
      items: data.gameSetup,
      commandStatuses: {
        "session-grants": adminConfirmStatus(sessionGrants),
        cohost: adminConfirmStatus(cohost),
      },
      sessionGrant: data.command.sessionGrant,
      onSetupAction: () => {},
      onConfirmSetupAction: () => {},
      onCancelSetupAction: () => {},
    },
  });
}

export async function renderAdminRecoveryConfirmation() {
  const data = await buildAdminRouteData(fixtureRouteInputForRole("admin"));
  const recoveryGate = data.recoveryTasks.find((item) => item.id === "recovery-gate");
  return render(AdminRecoveryPanel, {
    props: {
      tasks: data.recoveryTasks,
      commandStatuses: {
        "recovery-gate": adminConfirmStatus(recoveryGate),
      },
      game: data.shell.game,
      principalUserId: data.operator.principalUserId,
      onRecoveryTask: () => {},
      onCancelRecoveryTask: () => {},
    },
  });
}

export async function renderModeratorSurface() {
	  const data = await buildHostConsoleRouteData({
	    game: "midsummer",
	    ...fixtureRouteInputForRole("moderator"),
	  });
	  return renderWithRootLayout({
	    page: "moderator",
	    data,
	    url: "http://localhost/g/midsummer/host",
	  });
	}

export async function renderModeratorConfirmation() {
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    ...fixtureRouteInputForRole("moderator"),
  });
  const action = data.criticalActions.find((item) => item.id === "extend_deadline");
  return render(HostAction, {
    props: {
      action,
      initialConfirmationOpen: true,
      onDispatch: () => {},
    },
  });
}

export async function renderModeratorCriticalActionManifest() {
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    ...fixtureRouteInputForRole("moderator"),
  });
  return {
    game: data.game.id,
    actionCount: data.criticalActions.length,
    actions: data.criticalActions.map((action) => ({
      id: action.id,
      label: action.label,
      objectLabel: action.objectLabel,
      outcomeLabel: action.outcomeLabel,
      confirmationText: action.confirmationText,
      payloadKind: action.payload?.kind,
      requiresConfirmation: action.requiresConfirmation,
      irreversible: action.irreversible,
    })),
  };
}

export async function renderPlayerEndgameSummary() {
  return render(PlayerEndgameSummary, {
    props: {
      view: buildPlayerEndgameSummaryViewModel({
        gameCompleted: true,
        endgameSummary: {
          completed: true,
          winner: {
            alignment: "town",
            reason: "all mafia eliminated",
            phaseId: "D05",
          },
          slots: [
            {
              slotId: "slot-2",
              alive: false,
              status: "dead",
              roleKey: "mafia_goon",
              alignment: "mafia",
              roleRevealed: true,
              alignmentRevealed: true,
            },
            {
              slotId: "slot-7",
              alive: true,
              status: "alive",
              roleKey: "vanilla_townie",
              alignment: "town",
              roleRevealed: true,
              alignmentRevealed: true,
            },
          ],
          voteHistory: [
            {
              phaseId: "D04",
              sourceSeq: 91,
              eventIndex: 0,
              status: "Lynch",
              winnerSlot: "slot-2",
              tallies: { "slot-2": 3 },
              votes: {
                "slot-3": "slot-2",
                "slot-7": "slot-2",
                slot_4: "slot-2",
              },
              majority: 3,
              reason: null,
            },
          ],
          boundary: "Endgame summary is reveal-gated.",
        },
      }),
    },
  });
}

export async function renderPlayerActionTargetConfirmation() {
  const coldLoad = playerActionOpenFixture();
  const commandState = coldLoad.commandState;
  const composer = buildPlayerComposerView(
    {
      defaultBody: "",
      postCommandLabel: "Post",
      voteCommandLabel: "Vote",
      withdrawCommandLabel: "Withdraw vote",
    },
    commandState,
    commandState.actorSlot,
    { factional_kill: "slot-2" },
  );
  return render(PlayerCommandPanel, {
    props: {
      composer,
      phase: { label: "Night 2", state: "open", deadlineLabel: "" },
      votecount: [],
      channel: { channel: "main", label: "Main thread" },
      player: {
        slotId: commandState.actorSlot,
        alive: true,
        status: "alive",
        capabilityLabel: "SlotOccupant(seeded-action-open)",
      },
      initialConfirmingAction: "submit_action:factional_kill",
      onCommand: () => {},
      onSelectTarget: () => {},
    },
  });
}

export async function renderPlayerActionWithdrawConfirmation() {
  const coldLoad = playerActionSubmittedFixture();
  const commandState = coldLoad.commandState;
  const composer = buildPlayerComposerView(
    {
      defaultBody: "",
      postCommandLabel: "Post",
      voteCommandLabel: "Vote",
      withdrawCommandLabel: "Withdraw vote",
    },
    commandState,
    commandState.actorSlot,
    {},
  );
  return render(PlayerCommandPanel, {
    props: {
      composer,
      phase: { label: "Night 2", state: "open", deadlineLabel: "" },
      votecount: [],
      channel: { channel: "main", label: "Main thread" },
      player: {
        slotId: commandState.actorSlot,
        alive: true,
        status: "alive",
        capabilityLabel: "SlotOccupant(seeded-action-submitted)",
      },
      initialConfirmingAction: "withdraw_action:factional_kill",
      onCommand: () => {},
      onSelectTarget: () => {},
    },
  });
}

export async function renderModeratorActionConfirmation(actionId) {
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    ...fixtureRouteInputForRole("moderator"),
  });
  const action = data.criticalActions.find((item) => item.id === actionId);
  if (action === undefined) {
    throw new Error(\`unknown moderator critical action \${actionId}\`);
  }
  return render(HostAction, {
    props: {
      action,
      initialConfirmationOpen: true,
      onDispatch: () => {},
    },
  });
}

export async function renderModeratorHostPromptConfirmation() {
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    ...fixtureRouteInputForRole("moderator"),
  });
  const action = data.criticalActions.find((item) =>
    item.id.startsWith("resolve_host_prompt-")
  );
  return render(HostAction, {
    props: {
      action,
      initialConfirmationOpen: true,
      onDispatch: () => {},
    },
  });
}

export async function renderModeratorSlotLifecycleConfirmation() {
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    ...fixtureRouteInputForRole("moderator"),
  });
  const action = data.criticalActions.find((item) => item.id === "modkill_slot");
  return render(HostAction, {
    props: {
      action,
      initialConfirmationOpen: true,
      onDispatch: () => {},
    },
  });
}
`;
}

function renderAppRootShellSource() {
  return `<script>
	  import RootLayout from "../src/routes/+layout.svelte";
	  import BoardPage from "../src/routes/+page.svelte";
	  import AdminPage from "../src/routes/admin/+page.svelte";
	  import AdminAuditDetailPage from "../src/routes/admin/audit/[audit]/+page.svelte";
	  import PlayerPage from "../src/routes/g/[game]/+page.svelte";
	  import PlayerChannelPage from "../src/routes/g/[game]/c/[channel]/+page.svelte";
	  import HostPage from "../src/routes/g/[game]/host/+page.svelte";
	
	  export let page;
	  export let data;
	  export let layoutData;
	</script>
	
	<RootLayout data={layoutData}>
	  {#if page === "board"}
	    <BoardPage {data} />
	  {:else if page === "admin"}
	    <AdminPage {data} />
	  {:else if page === "admin-audit-detail"}
	    <AdminAuditDetailPage {data} />
	  {:else if page === "player"}
	    <PlayerPage {data} />
	  {:else if page === "player-channel"}
	    <PlayerChannelPage {data} />
	  {:else if page === "moderator"}
	    <HostPage {data} />
	  {/if}
	</RootLayout>
	`;
}

function renderAppStoresSource() {
  return `import { readable, writable } from "svelte/store";

const pageState = writable({
  status: 403,
  error: {
    message: "Channel private:role_pm:slot-7 is not visible.",
  },
  url: new URL("http://localhost/g/midsummer/c/private%3Arole_pm%3Aslot-7"),
  data: {
    appSession: {
      principalUserId: "player_mira",
      resolvedCapabilities: [
        { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
        { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
      ],
    },
  },
});

export const page = {
  subscribe: pageState.subscribe,
};

export function setPage(nextPage) {
  pageState.set(nextPage);
}

export const navigating = readable(null);

export const updated = {
  subscribe: readable(false).subscribe,
  check: async () => false,
};
`;
}

async function computeInputHash() {
  const hash = createHash("sha256");
  const files = [
    path.join(repoRoot, "tools", "frontend_route_state_render_contract.mjs"),
    path.join(repoRoot, "tools", "frontend_role_smoke_scenarios.mjs"),
    path.join(frontendRoot, "package.json"),
    path.join(frontendRoot, "package-lock.json"),
    path.join(frontendRoot, "svelte.config.js"),
    path.join(frontendRoot, "vite.config.js"),
    ...(await sourceFiles(path.join(frontendRoot, "src"))),
  ];
  for (const file of files) {
    hash.update(path.relative(repoRoot, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function sourceFiles(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

async function stampMatches(hash) {
  try {
    const stamp = JSON.parse(await readFile(stampPath, "utf8"));
    if (stamp.hash !== hash) {
      return false;
    }
    await stat(evidencePath);
    await stat(path.join(bundleDir, "entry.js"));
    return true;
  } catch {
    return false;
  }
}
