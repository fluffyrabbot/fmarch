import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMAND_TRACE_CONTRACT,
} from "../frontend/src/lib/app/command-trace-model.mjs";
import {
  CONFIRMATION_ACTION_CONTRACT,
} from "../frontend/src/lib/app/confirmation-action-model.mjs";
import {
  CONFIRMATION_COMMAND_TRACE_CONTRACT,
} from "../frontend/src/lib/app/confirmation-command-trace-model.mjs";
import {
  buildAdminAuditPanelViewModel,
  ADMIN_CONFIRMATION_CONTRACT,
  buildAdminCommandActivityViewModel,
  buildAdminEscalationPanelViewModel,
  buildAdminReadinessStripViewModel,
  buildAdminRecoveryPanelViewModel,
  buildAdminSetupGridViewModel,
} from "../frontend/src/lib/components/admin/admin-surface-model.mjs";
import {
  createHostActionController,
  buildHostActionViewModel,
  hostConfirmationCommandTrace,
  HOST_ACTION_CONTRACT,
} from "../frontend/src/lib/components/host-action/host-action-contract.mjs";
import {
  HOST_CONTROL_SURFACE_CONTRACT,
  buildHostControlSurfaceViewModel,
} from "../frontend/src/lib/components/host-action/host-control-surface.mjs";
import {
  buildHostCommandActivityViewModel,
} from "../frontend/src/lib/components/host-action/host-command-activity.mjs";
import {
  buildHostOperationsStripViewModel,
} from "../frontend/src/lib/components/host-action/host-operations-strip.mjs";
import {
  buildHostPhaseSummaryViewModel,
} from "../frontend/src/lib/components/host-action/host-phase-summary.mjs";
import {
  buildHostVotecountPanelViewModel,
} from "../frontend/src/lib/components/host-action/host-votecount-panel.mjs";
import {
  buildHostWorkQueueStripViewModel,
} from "../frontend/src/lib/components/host-action/host-work-queue-strip.mjs";
import {
  buildPlayerChannelSwitcherViewModel,
} from "../frontend/src/lib/components/player-channel-switcher/player-channel-switcher-model.mjs";
import {
  PLAYER_THREAD_MEDIA_CONTRACT,
  PLAYER_THREAD_PAGER_CONTRACT,
  buildPlayerThreadViewModel,
} from "../frontend/src/lib/components/player-thread/player-thread-model.mjs";
import {
  PLAYER_COMMAND_PANEL_CONTRACT,
  buildPlayerCommandPanelViewModel,
} from "../frontend/src/lib/components/player-command/player-command-panel-model.mjs";
import {
  buildPlayerCommandReceiptViewModel,
} from "../frontend/src/lib/components/player-command/player-command-receipt-model.mjs";
import {
  buildPlayerPostureStripViewModel,
} from "../frontend/src/lib/components/player-posture/player-posture-strip-model.mjs";
import {
  buildPrivateQueue,
  buildPrivateQueueBoundary,
  buildPlayerPrivateQueueViewModel,
} from "../frontend/src/lib/components/player-private-queue/player-private-queue-model.mjs";
import {
  adminForbiddenMessage,
  buildAdminAuditDetailData,
  buildAdminRouteData,
} from "../frontend/src/routes/admin/admin-route-model.mjs";
import {
  adminConfirmStatus,
  adminSetupActionMode,
  sendAdminSetupCommand,
} from "../frontend/src/routes/admin/admin-route-controller.mjs";
import {
  APP_SHELL_CONTRACT,
  buildBoardRouteData,
  fixtureBoardGameIndexPage,
  roleNavTestId,
} from "../frontend/src/lib/app/app-shell-model.mjs";
import {
  APP_ROUTE_STATE_CONTRACT,
  buildRoleRouteStateMatrix,
} from "../frontend/src/lib/app/app-route-state-model.mjs";
import {
  buildAppStatusViewModel,
} from "../frontend/src/lib/app/app-status-model.mjs";
import {
  APP_STATUS_STRIP_CONTRACT,
  statusStripItemClassName,
  statusStripRootClassName,
  statusStripStatusClassName,
} from "../frontend/src/lib/app/app-status-strip-model.mjs";
import {
  APP_SURFACE_HEADER_CONTRACT,
} from "../frontend/src/lib/app/app-surface-header-model.mjs";
import {
  buildGameRouteData,
  playerForbiddenMessage,
} from "../frontend/src/routes/g/[game]/game-route-model.mjs";
import {
  playerCommandPendingStatus,
  playerCommandTrace,
  recordPlayerCommandReceipt,
  submitPlayerRouteCommand,
} from "../frontend/src/routes/g/[game]/player-route-controller.mjs";
import {
  buildHostConsoleRouteData,
  hostConsoleForbiddenMessage,
} from "../frontend/src/routes/g/[game]/host/host-route-model.mjs";
import {
  buildHostDerivedState,
  hostCommandPendingStatus,
  sendHostRouteAction,
} from "../frontend/src/routes/g/[game]/host/host-route-controller.mjs";
import {
  navFocusCoverage,
  routeStateScenarios,
  roles as roleSmokeRoles,
  viewports,
} from "./frontend_role_smoke_scenarios.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-static-role-contract");
const evidencePath = path.join(artifactDir, "role-contract.json");

const evidence = {
  status: "passed",
  proof: "static-no-bind-role-contract",
  boundary:
    "Builds route data and component view models without opening a TCP listener. This does not replace Playwright pixel, overlap, or browser interaction proof.",
  viewports,
  board: null,
  appShellContract: null,
  statusContract: null,
  statusStripContract: null,
  surfaceHeaderContract: null,
  surfaceHeaderCoverage: null,
  firstViewportSmokeCoverage: null,
  firstViewportLayoutContract: null,
  linkAffordanceCoverage: null,
  navFocusCoverage: null,
  routeStateCoverage: null,
  routeStateFixtureCoverage: null,
  touchControlContract: null,
  confirmationShellContract: null,
  confirmationActionContract: null,
  confirmationCommandTraceContract: null,
  commandTraceContract: null,
  confirmationCoverage: null,
  roles: [],
  forbidden: [],
  commandPaths: [],
};

await mkdir(artifactDir, { recursive: true });

evidence.board = proveBoardSurface();
evidence.appShellContract = await proveAppShellContract();
evidence.statusContract = proveStatusContract();
evidence.statusStripContract = await proveStatusStripContract();
evidence.surfaceHeaderContract = proveSurfaceHeaderContract();
evidence.touchControlContract = await proveSharedTouchControlCss();
evidence.confirmationShellContract = await proveConfirmationShellContract();
evidence.confirmationActionContract = await proveConfirmationActionContract();
evidence.confirmationCommandTraceContract = await proveConfirmationCommandTraceContract();
evidence.commandTraceContract = proveCommandTraceContract();

const admin = await proveAdminSurface();
evidence.roles.push(admin.role);
evidence.commandPaths.push(admin.commandPath);

const player = await provePlayerSurface();
evidence.roles.push(player.role);
evidence.commandPaths.push(player.commandPath);

const moderator = await proveModeratorSurface();
evidence.roles.push(moderator.role);
evidence.commandPaths.push(moderator.commandPath);

evidence.surfaceHeaderCoverage = proveSurfaceHeaderCoverage({
  board: evidence.board,
  roles: evidence.roles,
});
evidence.confirmationCoverage = proveConfirmationCoverage({
  admin: admin.confirmationCoverage,
  moderator: moderator.confirmationCoverage,
});
evidence.firstViewportSmokeCoverage = proveFirstViewportSmokeCoverage(evidence.roles);
evidence.firstViewportLayoutContract = await proveFirstViewportLayoutContract(
  evidence.roles,
);
evidence.linkAffordanceCoverage = proveLinkAffordanceCoverage(evidence.roles);
evidence.navFocusCoverage = proveNavFocusCoverage();
evidence.routeStateCoverage = proveRouteStateCoverage();
evidence.routeStateFixtureCoverage = proveRouteStateFixtureCoverage();
evidence.forbidden.push(await proveForbiddenRoutes());

await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

function proveBoardSurface() {
  const data = buildBoardRouteData({
    principalUserId: "player_mira",
    capabilities: [{ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }],
    gameIndexPage: fixtureBoardGameIndexPage(),
  });
  assert.equal(data.shell.activeSurface, "board");
  assert.deepEqual(
    data.shell.surfaces.map((item) => [item.id, item.navigation]),
    [
      ["board", "link"],
      ["player", "link"],
      ["moderator", "blocked"],
      ["admin", "blocked"],
    ],
  );
  assert.deepEqual(
    data.board.games[0].actions.map((action) => [action.id, action.navigation]),
    [
      ["player", "link"],
      ["moderator", "blocked"],
    ],
  );
  return {
    activeSurface: data.shell.activeSurface,
    surfaceHeader: surfaceHeaderSummary(data.surfaceHeader),
    navigationActions: data.shell.surfaces.map((item) => ({
      id: item.id,
      navigation: item.navigation,
    })),
    gameActions: data.board.games[0].actions.map((action) => ({
      id: action.id,
      navigation: action.navigation,
    })),
  };
}

async function proveAppShellContract() {
  const css = await readFile(
    path.join(repoRoot, "frontend", "src", "lib", "styles", "app.css"),
    "utf8",
  );
  const data = buildBoardRouteData({
    principalUserId: "player_mira",
    capabilities: [{ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }],
    game: "midsummer",
  });

  assert.equal(APP_SHELL_CONTRACT.component, "fm-app-shell");
  assert.equal(APP_SHELL_CONTRACT.navLabel, "Role surfaces");
  assert.equal(APP_SHELL_CONTRACT.skipLinkLabel, "Skip to app content");
  assert.equal(APP_SHELL_CONTRACT.skipLinkTestId, "app-shell-skip-link");
  assert.equal(APP_SHELL_CONTRACT.mainTargetId, "fm-main");
  assert.equal(APP_SHELL_CONTRACT.mainTargetTestId, "app-shell-main-target");
  assert.equal(APP_SHELL_CONTRACT.sessionTestId, "app-shell-session");
  assert.equal(APP_SHELL_CONTRACT.sessionPrincipalTestId, "app-shell-session-principal");
  assert.equal(APP_SHELL_CONTRACT.sessionCapabilityTestId, "app-shell-session-capabilities");
  assert.equal(APP_SHELL_CONTRACT.sessionGameTestId, "app-shell-session-game");
  assert.equal(APP_SHELL_CONTRACT.topbarTestId, "app-shell-topbar");
  assert.equal(APP_SHELL_CONTRACT.topbarMode, "sticky-safe-area-role-session-topbar");
  assert.equal(APP_SHELL_CONTRACT.topbarStickyTopPx, 0);
  assert.equal(APP_SHELL_CONTRACT.topbarBlockSizePx, 76);
  assert.equal(APP_SHELL_CONTRACT.stickyRailGapPx, 22);
  assert.deepEqual(data.shell.session, {
    testId: APP_SHELL_CONTRACT.sessionTestId,
    principalTestId: APP_SHELL_CONTRACT.sessionPrincipalTestId,
    capabilityTestId: APP_SHELL_CONTRACT.sessionCapabilityTestId,
    gameTestId: APP_SHELL_CONTRACT.sessionGameTestId,
    state: "signed-in",
    principalLabel: "player_mira",
    gameLabel: "midsummer",
    capabilityCount: 1,
    capabilityKinds: ["SlotOccupant"],
    capabilitySummary: "SlotOccupant",
  });
  assert.deepEqual(
    data.shell.surfaces.map((surface) => surface.id),
    APP_SHELL_CONTRACT.surfaceOrder,
  );
  assert.deepEqual(
    data.shell.surfaces.map((surface) => [
      surface.id,
      surface.testId,
      surface.minTouchTargetPx,
    ]),
    APP_SHELL_CONTRACT.surfaceOrder.map((surface) => [
      surface,
      roleNavTestId(surface),
      APP_SHELL_CONTRACT.minTouchTargetPx,
    ]),
  );
  assert.match(css, /\.fm-app-shell__nav\s*\{/);
  assert.match(css, /--fm-app-topbar-block-size:\s*76px/);
  assert.match(css, /--fm-app-sticky-rail-gap:\s*22px/);
  assert.match(css, /\.fm-app-shell__topbar\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.fm-app-shell__topbar\s*\{[^}]*top:\s*env\(safe-area-inset-top\)/s);
  assert.match(css, /\.fm-app-shell__topbar\s*\{[^}]*z-index:\s*11/s);
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(
    css,
    /\.fm-app-shell__brand,\s*\.fm-app-shell__session,\s*\.fm-app-shell__nav-item,\s*\.fm-touch-button\s*\{/,
  );
  assert.match(css, /min-block-size:\s*44px/);
  assert.match(css, /\.fm-skip-link\s*\{/);
  assert.match(css, /\.fm-skip-link:focus-visible\s*\{/);
  assert.match(css, /\.fm-app-shell__nav-item\[data-allowed="false"\]/);
  assert.match(css, /\.fm-app-shell__nav-reason\s*\{/);
  assert.match(css, /\.fm-app-shell__session small\s*\{/);
  assert.match(css, /overflow-wrap:\s*anywhere/);

  return {
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
    sessionModel: data.shell.session,
    minTouchTargetPx: APP_SHELL_CONTRACT.minTouchTargetPx,
    responsiveColumns: "4/1",
    deniedNavVisibleInert: true,
    deniedNavVisibleReason: true,
  };
}

function proveStatusContract() {
  const pending = buildAppStatusViewModel({
    status: { state: "pending", message: "Sending command" },
    testId: "status-pending",
  });
  assert.equal(pending.role, "status");
  assert.equal(pending.ariaLive, "polite");
  assert.equal(pending.ariaAtomic, "true");

  const reject = buildAppStatusViewModel({
    status: { state: "reject", message: "Reject Forbidden" },
    testId: "status-reject",
  });
  assert.equal(reject.role, "status");
  assert.equal(reject.ariaLive, "assertive");
  assert.equal(reject.ariaAtomic, "true");

  const empty = buildAppStatusViewModel();
  assert.equal(empty.visible, false);

  return {
    pending: {
      role: pending.role,
      ariaLive: pending.ariaLive,
      ariaAtomic: pending.ariaAtomic,
    },
    reject: {
      role: reject.role,
      ariaLive: reject.ariaLive,
      ariaAtomic: reject.ariaAtomic,
    },
    emptyVisible: empty.visible,
  };
}

async function proveStatusStripContract() {
  const css = await readFile(
    path.join(repoRoot, "frontend", "src", "lib", "styles", "app.css"),
    "utf8",
  );

  assert.equal(APP_STATUS_STRIP_CONTRACT.rootClassName, "fm-status-strip");
  assert.equal(
    statusStripRootClassName("player-posture-strip"),
    "fm-status-strip player-posture-strip",
  );
  assert.equal(
    statusStripItemClassName("host-console-critical-path__operation"),
    "fm-status-strip__item host-console-critical-path__operation",
  );
  assert.equal(
    statusStripStatusClassName("admin-readiness-strip__status"),
    "fm-status-strip__status admin-readiness-strip__status",
  );
  assert.match(css, /\.fm-status-strip\s*\{/);
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.fm-status-strip__item\[data-state="pending"\]/);
  assert.match(css, /\.fm-status-strip__item\[data-state="reject"\]/);
  assert.match(css, /min-block-size:\s*136px/);
  assert.match(css, /overflow-wrap:\s*anywhere/);

  return {
    rootClassName: APP_STATUS_STRIP_CONTRACT.rootClassName,
    itemClassName: APP_STATUS_STRIP_CONTRACT.itemClassName,
    statusClassName: APP_STATUS_STRIP_CONTRACT.statusClassName,
    roleSpecificClassComposition: true,
    responsiveColumns: "4/2/1",
    stateTones: ["pending", "reject"],
  };
}

function proveSurfaceHeaderContract() {
  assert.equal(APP_SURFACE_HEADER_CONTRACT.component, "fm-surface-header");
  assert.equal(APP_SURFACE_HEADER_CONTRACT.defaultClassName, "fm-surface__masthead");
  assert.equal(APP_SURFACE_HEADER_CONTRACT.capabilityClassName, "fm-capability-pill");
  assert.equal(APP_SURFACE_HEADER_CONTRACT.liveStatusClassName, "fm-live-status");
  assert.equal(APP_SURFACE_HEADER_CONTRACT.statusStackClassName, "fm-status-stack");
  assert.equal(APP_SURFACE_HEADER_CONTRACT.minTouchTargetPx, 44);

  return {
    component: APP_SURFACE_HEADER_CONTRACT.component,
    defaultClassName: APP_SURFACE_HEADER_CONTRACT.defaultClassName,
    capabilityClassName: APP_SURFACE_HEADER_CONTRACT.capabilityClassName,
    liveStatusClassName: APP_SURFACE_HEADER_CONTRACT.liveStatusClassName,
    statusStackClassName: APP_SURFACE_HEADER_CONTRACT.statusStackClassName,
    minTouchTargetPx: APP_SURFACE_HEADER_CONTRACT.minTouchTargetPx,
  };
}

function proveFirstViewportSmokeCoverage(roleSurfaces) {
  const roleEntries = new Map(roleSurfaces.map((role) => [role.id, role]));
  const coverage = roleSmokeRoles.map((roleConfig) => {
    const role = roleEntries.get(roleConfig.id);
    assert.notEqual(role, undefined, `${roleConfig.id} static role surface missing`);
    const items = firstViewportItemsForRole(role, roleConfig.firstViewportSurface);
    assert.equal(items.length >= 3, true);
    assert.equal(items.length, roleConfig.overlapTestIds.length);
    const overlapTestIds = items.map((item) => item.testId);
    const statusRegions = items.map((item) => ({
      testId: item.statusTestId,
      state: item.state,
    }));
    assertUnique(
      overlapTestIds,
      `${roleConfig.id} ${roleConfig.firstViewportSurface} tile test ids`,
    );
    assertUnique(
      statusRegions.map((statusRegion) => statusRegion.testId),
      `${roleConfig.id} ${roleConfig.firstViewportSurface} status test ids`,
    );
    assert.equal(
      items.every((item) => item.testId.length > 0 && item.statusTestId.length > 0),
      true,
    );
    assert.deepEqual(roleConfig.overlapTestIds, overlapTestIds);
    assert.equal(
      roleConfig.overlapTestIds.every((testId) =>
        roleConfig.visibleTestIds.includes(testId),
      ),
      true,
    );

    const firstViewportStatusRegionIds = new Set(
      statusRegions.map((statusRegion) => statusRegion.testId),
    );
    assert.deepEqual(
      (roleConfig.staticStatusRegions ?? roleConfig.statusRegions)
        .filter((statusRegion) => firstViewportStatusRegionIds.has(statusRegion.testId))
        .map((statusRegion) => ({
          testId: statusRegion.testId,
          state: statusRegion.state,
        })),
      statusRegions,
    );

    return {
      role: roleConfig.id,
      path: roleConfig.path,
      surface: roleConfig.firstViewportSurface,
      viewportNames: viewports.map((viewport) => viewport.name),
      overlapTestIds,
      statusRegions,
    };
  });

  return {
    boundary:
      "Static fallback proves the model-owned first-viewport target ids and status-region states. Browser smoke is still required for actual visibility, pixel screenshots, overlap checks, focus traversal, and pointer interaction.",
    roles: coverage,
  };
}

async function proveFirstViewportLayoutContract(roleSurfaces) {
  const css = await readFile(
    path.join(repoRoot, "frontend", "src", "lib", "styles", "app.css"),
    "utf8",
  );
  assert.match(css, /\.fm-status-strip\s*\{/);
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.fm-status-strip__item\s*\{/);
  assert.match(css, /min-block-size:\s*136px/);
  assert.match(css, /min-inline-size:\s*0/);
  assert.match(css, /\.fm-status-strip__item strong\s*\{/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width:\s*840px\)/);
  assert.match(css, /\.fm-status-strip\s*\{\s*grid-template-columns:\s*1fr/s);
  assert.match(css, /@media \(min-width:\s*841px\) and \(max-width:\s*1180px\)/);
  assert.match(
    css,
    /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(200px,\s*1fr\)\)/,
  );
  assert.match(css, /\.fm-status-strip__item\s*\{[^}]*min-block-size:\s*112px/s);
  assert.match(
    css,
    /\.fm-status-strip__detail\s*\{[^}]*clip-path:\s*inset\(50%\)/s,
  );

  const roleEntries = new Map(roleSurfaces.map((role) => [role.id, role]));
  const roles = roleSmokeRoles.map((roleConfig) => {
    const role = roleEntries.get(roleConfig.id);
    assert.notEqual(role, undefined, `${roleConfig.id} static role surface missing`);
    const items = firstViewportItemsForRole(role, roleConfig.firstViewportSurface);
    assert.equal(items.length >= 3, true);
    assert.equal(items.length, roleConfig.overlapTestIds.length);
    const normalizedItems = items.map((item) => {
      assert.equal(item.labelLength <= 24, true);
      assert.equal(item.valueLength <= 80, true);
      assert.equal(item.detailLength <= 140, true);
      assert.equal(item.statusMessageLength <= 96, true);
      return {
        id: item.id,
        testId: item.testId,
        statusTestId: item.statusTestId,
        state: item.state,
        labelLength: item.labelLength,
        valueLength: item.valueLength,
        detailLength: item.detailLength,
        statusMessageLength: item.statusMessageLength,
      };
    });

    assertUnique(
      normalizedItems.map((item) => item.testId),
      `${roleConfig.id} layout tile test ids`,
    );
    assertUnique(
      normalizedItems.map((item) => item.statusTestId),
      `${roleConfig.id} layout tile status ids`,
    );

    return {
      role: roleConfig.id,
      path: roleConfig.path,
      surface: roleConfig.firstViewportSurface,
      itemCount: normalizedItems.length,
      itemIds: normalizedItems.map((item) => item.id),
      items: normalizedItems,
      viewportColumns: viewports.map((viewport) => ({
        name: viewport.name,
        width: viewport.width,
        expectedColumns: statusStripColumnsForWidth(viewport.width),
      })),
    };
  });

  return {
    boundary:
      "Static model/CSS contract for tablet-first first-viewport scan strips. It proves stable scan-strip models, adaptive compact tablet columns, 4-column desktop and 1-column mobile rules, minimum tile heights, min-inline-size:0, and overflow-wrap guardrails. Browser smoke remains required for actual pixel geometry and overlap.",
    css: {
      rootClassName: APP_STATUS_STRIP_CONTRACT.rootClassName,
      itemClassName: APP_STATUS_STRIP_CONTRACT.itemClassName,
      desktopColumns: 4,
      tabletColumns: "adaptive 200px minimum",
      mobileColumns: 1,
      tabletBreakpointPx: 1180,
      mobileBreakpointPx: 840,
      minBlockSizePx: 136,
      tabletMinBlockSizePx: 112,
      minInlineSizeZero: true,
      overflowWrapAnywhere: true,
    },
    roles,
  };
}

function statusStripColumnsForWidth(width) {
  if (width <= 840) {
    return 1;
  }
  if (width <= 1180) {
    return "adaptive";
  }
  return 4;
}

function surfaceHeaderSummary(header) {
  assert.equal(header.component, APP_SURFACE_HEADER_CONTRACT.component);
  assert.equal(header.className, APP_SURFACE_HEADER_CONTRACT.defaultClassName);
  if (header.capability.visible) {
    assert.equal(
      header.capability.minTouchTargetPx,
      APP_SURFACE_HEADER_CONTRACT.minTouchTargetPx,
    );
  }

  return {
    component: header.component,
    surface: header.surface,
    eyebrow: header.eyebrow,
    title: header.title,
    summary: header.summary,
    capabilityTestId: header.capability.visible ? header.capability.testId : null,
    capabilityMinTouchTargetPx: header.capability.visible
      ? header.capability.minTouchTargetPx
      : null,
    liveStatusTestId: header.liveStatus.visible ? header.liveStatus.testId : null,
  };
}

function proveSurfaceHeaderCoverage({ board, roles }) {
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const entries = [
    ["board", board.surfaceHeader],
    ["admin", roleById.get("admin")?.surfaceHeader],
    ["admin-audit-detail", roleById.get("admin")?.auditDetailSurfaceHeader],
    ["player", roleById.get("player")?.surfaceHeader],
    ["moderator", roleById.get("moderator")?.surfaceHeader],
  ].map(([id, header]) => {
    assert.notEqual(header, undefined, `${id} surface header missing`);
    assert.equal(header.component, APP_SURFACE_HEADER_CONTRACT.component);
    return {
      id,
      surface: header.surface,
      title: header.title,
      capabilityTestId: header.capabilityTestId,
      capabilityMinTouchTargetPx: header.capabilityMinTouchTargetPx,
      liveStatusTestId: header.liveStatusTestId,
    };
  });

  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["board", "admin", "admin-audit-detail", "player", "moderator"],
  );
  assert.deepEqual(
    entries.map((entry) => [entry.id, entry.capabilityMinTouchTargetPx]),
    [
      ["board", null],
      ["admin", 44],
      ["admin-audit-detail", 44],
      ["player", 44],
      ["moderator", 44],
    ],
  );

  return {
    boundary:
      "Static model contract proves every app-level first-viewport masthead is described by the shared AppSurfaceHeader view model. Browser proof is still required for rendered geometry and focus behavior.",
    entries,
  };
}

function firstViewportItemsForRole(role, surface) {
  if (surface === "readiness") {
    return role.surfaces.readiness;
  }
  if (surface === "posture") {
    return role.posture;
  }
  if (surface === "operations") {
    return role.operations;
  }
  throw new Error(`unknown first viewport surface ${surface}`);
}

function textFitSummary(item) {
  const label = String(item.label);
  const value = String(item.value);
  const detail = String(item.detail);
  const statusMessage = String(item.status.message);
  for (const [name, text] of [
    ["label", label],
    ["value", value],
    ["detail", detail],
    ["statusMessage", statusMessage],
  ]) {
    assert.equal(text.includes("\n"), false, `${item.id} ${name} must be single-line`);
  }
  return {
    labelLength: label.length,
    valueLength: value.length,
    detailLength: detail.length,
    statusMessageLength: statusMessage.length,
  };
}

function proveLinkAffordanceCoverage(roleSurfaces) {
  const roleEntries = new Map(roleSurfaces.map((role) => [role.id, role]));
  const coverage = roleSmokeRoles
    .filter((roleConfig) => (roleConfig.linkAffordances ?? []).length > 0)
    .map((roleConfig) => {
      const role = roleEntries.get(roleConfig.id);
      assert.notEqual(role, undefined, `${roleConfig.id} static role surface missing`);
      return {
        role: roleConfig.id,
        path: roleConfig.path,
        links: roleConfig.linkAffordances.map((link) => {
          assert.equal(roleConfig.visibleTestIds.includes(link.testId), true);
          if (roleConfig.id === "admin" && link.testId === "admin-audit-link-proof-runs") {
            const proofRuns = role.surfaces.audit.find((item) => item.id === "proof-runs");
            assert.notEqual(proofRuns, undefined);
            assert.equal(proofRuns.linkTestId, link.testId);
            assert.equal(proofRuns.inspectHref, `${link.hrefPath}?game=midsummer`);
            assert.equal(
              proofRuns.href,
              "/games/midsummer/operator/proof-runs?principal_user_id=admin_a",
            );
          }
          return {
            testId: link.testId,
            hrefPath: link.hrefPath,
            searchParams: link.searchParams ?? null,
          };
        }),
      };
    });

  return {
    boundary:
      "Static fallback records model-owned role link affordance targets. Browser smoke is still required to prove rendered anchors, hit target geometry, and real navigation behavior.",
    roles: coverage,
  };
}

function proveNavFocusCoverage() {
  const coverage = navFocusCoverage.surfaces.map((surface) => {
    assert.equal(surface.linkedNavTestIds.length > 0, true);
    assert.equal(surface.blockedNavTestIds.length > 0, true);
    assert.equal(surface.skipLinkTestId, APP_SHELL_CONTRACT.skipLinkTestId);
    assert.equal(surface.mainTargetTestId, APP_SHELL_CONTRACT.mainTargetTestId);
    assert.equal(
      surface.expectedFocusOrder[0],
      APP_SHELL_CONTRACT.skipLinkTestId,
      `${surface.id} focus order must start with the shell skip link`,
    );
    assertUnique(surface.linkedNavTestIds, `${surface.id} linked nav targets`);
    assertUnique(surface.blockedNavTestIds, `${surface.id} blocked nav targets`);
    assert.deepEqual(
      surface.expectedFocusOrder.slice(1, 1 + surface.linkedNavTestIds.length),
      surface.linkedNavTestIds,
      `${surface.id} linked nav focus order must follow shell order after skip link`,
    );
    for (const testId of surface.blockedNavTestIds) {
      assert.equal(
        surface.forbiddenFocusTestIds.includes(testId),
        true,
        `${surface.id} blocked nav must be forbidden: ${testId}`,
      );
      assert.equal(
        surface.expectedFocusOrder.includes(testId),
        false,
        `${surface.id} blocked nav must not be focusable: ${testId}`,
      );
    }
    assertUnique(surface.expectedFocusOrder, `${surface.id} expected focus order`);
    assertUnique(surface.forbiddenFocusTestIds, `${surface.id} forbidden focus ids`);

    return surface;
  });

  return {
    boundary:
      "Static fallback records model-derived shell nav and focus expectations. Browser smoke is still required to prove real tab traversal, visible rings, and disabled-control behavior in Chromium.",
    surfaces: coverage,
  };
}

function proveRouteStateCoverage() {
  const matrix = buildRoleRouteStateMatrix();
  const surfaces = APP_ROUTE_STATE_CONTRACT.surfaces.map((surface) => {
    const states = APP_ROUTE_STATE_CONTRACT.states.map((state) => {
      const view = matrix[surface][state];
      assert.equal(view.surface, surface);
      assert.equal(view.state, state);
      assert.equal(view.action.minTouchTargetPx, 44);
      assert.equal(view.status.role, "status");
      assert.equal(view.status.ariaAtomic, "true");
      assert.equal(view.status.message, view.message);
      assert.equal(
        view.status.ariaLive,
        state === "reject" ? "assertive" : "polite",
      );
      assert.equal(view.status.state, state === "loading" ? "pending" : state);

      return {
        state,
        rootTestId: view.rootTestId,
        statusTestId: view.status.testId,
        statusState: view.status.state,
        ariaLive: view.status.ariaLive,
        actionTestId: view.action.testId,
        actionHref: view.action.href,
        minTouchTargetPx: view.action.minTouchTargetPx,
      };
    });
    return {
      surface,
      states,
    };
  });

  return {
    boundary:
      "Static fallback records shared empty, loading, and reject route-state semantics for board and role surfaces. Browser smoke is still required to prove rendered layout and focus behavior.",
    surfaces,
  };
}

function proveRouteStateFixtureCoverage() {
  const matrix = buildRoleRouteStateMatrix();
  const surfaceIds = APP_ROUTE_STATE_CONTRACT.surfaces;
  const coveredSurfaceIds = new Set(routeStateScenarios.map((scenario) => scenario.surface));
  assert.deepEqual(
    [...coveredSurfaceIds].sort(),
    [...APP_ROUTE_STATE_CONTRACT.surfaces].sort(),
  );
  assert.equal(routeStateScenarios.length % APP_ROUTE_STATE_CONTRACT.states.length, 0);

  const scenarios = routeStateScenarios.map((scenario) => {
    assert.equal(surfaceIds.includes(scenario.surface), true);
    assert.equal(scenario.path.includes(APP_ROUTE_STATE_CONTRACT.fixtureQueryParam), true);
    const view = matrix[scenario.surface][scenario.state];
    assert.equal(scenario.rootTestId, view.rootTestId);
    assert.equal(scenario.statusTestId, view.status.testId);
    assert.equal(scenario.actionTestId, view.action.testId);
    assert.equal(scenario.statusState, view.status.state);
    assert.equal(scenario.ariaLive, view.status.ariaLive);
    assert.equal(view.action.minTouchTargetPx, 44);
    assert.equal(scenario.focus.skipLinkTestId, APP_SHELL_CONTRACT.skipLinkTestId);
    assert.equal(scenario.focus.mainTargetTestId, APP_SHELL_CONTRACT.mainTargetTestId);
    assert.equal(
      scenario.focus.expectedOrder[0],
      APP_SHELL_CONTRACT.skipLinkTestId,
      `${scenario.id} route-state focus order must start with shell skip link`,
    );
    assert.equal(
      scenario.focus.expectedOrder.includes(scenario.actionTestId),
      true,
      `${scenario.id} route-state action must be keyboard reachable`,
    );

    return {
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
      focus: scenario.focus,
    };
  });

  return {
    boundary:
      "Static fallback proves fixture routes can address every shared route-state scenario. Browser smoke is still required to prove those states render as visible DOM.",
    queryParam: APP_ROUTE_STATE_CONTRACT.fixtureQueryParam,
    scenarios,
  };
}

async function proveSharedTouchControlCss() {
  const css = await readFile(
    path.join(repoRoot, "frontend", "src", "lib", "styles", "app.css"),
    "utf8",
  );

  assert.match(
    css,
    /\.fm-touch-button\[aria-disabled="true"\],\s*\.fm-touch-button:disabled\s*\{/,
  );
  assert.match(css, /:focus-visible\s*\{/);
  assert.match(css, /outline:\s*3px solid var\(--fm-focus-ring\)/);
  assert.match(css, /outline-offset:\s*3px/);
  assert.match(css, /\.fm-route-state\s*\{/);
  assert.match(css, /min-block-size:\s*220px/);
  assert.match(css, /\.fm-route-state\[data-state="loading"\]/);
  assert.match(css, /\.fm-route-state\[data-state="reject"\]/);
  assert.match(css, /\.fm-route-state__status\[data-state="reject"\]/);
  assert.match(css, /cursor:\s*not-allowed/);
  assert.match(css, /opacity:\s*0\.[0-9]+/);
  assert.match(css, /touch-action:\s*manipulation/);
  assert.match(css, /text-decoration:\s*none/);

  return {
    disabledSelector:
      '.fm-touch-button[aria-disabled="true"], .fm-touch-button:disabled',
    cursor: "not-allowed",
    opacityBelowOne: true,
    focusVisibleOutline: "3px solid var(--fm-focus-ring)",
    focusVisibleOffset: "3px",
    routeStateMinBlockPx: 220,
    touchAction: "manipulation",
    linkDecorationRemoved: true,
  };
}

async function proveConfirmationShellContract() {
  const shellPath = path.join(
    repoRoot,
    "frontend",
    "src",
    "lib",
    "app",
    "ConfirmationShell.svelte",
  );
  const shell = await readFile(shellPath, "utf8");
  const shellOwnedAttributes = [
    "role",
    "aria-modal",
    "aria-label",
    "aria-describedby",
    "data-initial-focus-testid",
    "data-return-focus-testid",
    "data-escape-cancels",
    "data-tab-containment",
    "data-testid",
  ];

  assert.match(shell, /<svelte:element/);
  assert.match(shell, /this=\{element\}/);
  assert.match(shell, /\.\.\.elementAttributes/);
  for (const attribute of shellOwnedAttributes) {
    assert.equal(
      shell.includes(`${attribute}:`) || shell.includes(`"${attribute}":`),
      true,
      `ConfirmationShell must own ${attribute}`,
    );
  }

  const users = [
    {
      id: "admin-setup",
      path: path.join(
        repoRoot,
        "frontend",
        "src",
        "lib",
        "components",
        "admin",
        "AdminSetupGrid.svelte",
      ),
      expectedUsages: 2,
    },
    {
      id: "admin-recovery",
      path: path.join(
        repoRoot,
        "frontend",
        "src",
        "lib",
        "components",
        "admin",
        "AdminRecoveryPanel.svelte",
      ),
      expectedUsages: 1,
    },
    {
      id: "host-action",
      path: path.join(
        repoRoot,
        "frontend",
        "src",
        "lib",
        "components",
        "host-action",
        "HostAction.svelte",
      ),
      expectedUsages: 1,
    },
  ];

  const rawAttributePatterns = [
    "data-initial-focus-testid=",
    "data-return-focus-testid=",
    "data-escape-cancels=",
    "data-tab-containment=",
    "aria-modal=",
    "aria-describedby=",
  ];
  const surfaces = [];
  for (const user of users) {
    const source = await readFile(user.path, "utf8");
    assert.match(
      source,
      /import ConfirmationShell from "\$lib\/app\/ConfirmationShell\.svelte";/,
      `${user.id} must import ConfirmationShell`,
    );
    const usageCount = [...source.matchAll(/<ConfirmationShell\b/g)].length;
    assert.equal(usageCount, user.expectedUsages, `${user.id} shell usage count`);
    for (const attribute of rawAttributePatterns) {
      assert.equal(
        source.includes(attribute),
        false,
        `${user.id} must not re-declare ${attribute}`,
      );
    }
    surfaces.push({
      id: user.id,
      shellUsages: usageCount,
      rawAttributesAbsent: rawAttributePatterns,
    });
  }

  return {
    boundary:
      "Static source contract proves admin and moderator confirmations use the shared ConfirmationShell wrapper for alertdialog, aria, test-id, and focus-contract attributes. Browser smoke is still required to prove runtime focus behavior.",
    component: "ConfirmationShell",
    element: "svelte:element",
    shellOwnedAttributes,
    surfaces,
  };
}

async function proveConfirmationActionContract() {
  const sources = [
    {
      id: "admin-model",
      path: path.join(
        repoRoot,
        "frontend",
        "src",
        "lib",
        "components",
        "admin",
        "admin-surface-model.mjs",
      ),
      importNeedle: "../../app/confirmation-action-model.mjs",
    },
    {
      id: "host-model",
      path: path.join(
        repoRoot,
        "frontend",
        "src",
        "lib",
        "components",
        "host-action",
        "host-action-contract.mjs",
      ),
      importNeedle: "../../app/confirmation-action-model.mjs",
    },
  ];
  for (const sourceInfo of sources) {
    const source = await readFile(sourceInfo.path, "utf8");
    assert.equal(
      source.includes(sourceInfo.importNeedle),
      true,
      `${sourceInfo.id} must import the shared confirmation action model`,
    );
    assert.match(
      source,
      /buildConfirmationActionViewModel/,
      `${sourceInfo.id} must build confirmation payloads through the shared model`,
    );
  }

  const adminSetup = buildAdminSetupGridViewModel({
    items: [
      {
        id: "session-grants",
        label: "Session grants",
        authority: "GlobalAdmin",
        boundary: "Authenticated session grant",
        boundaryDetail: "/auth/session-grants requires active GlobalAdmin session",
        commandAction: "grant_session",
        buttonLabel: "Review",
        confirmLabel: "Grant GlobalMod",
      },
    ],
    commandStatuses: {
      "session-grants": {
        state: "confirm",
        message: "Grant GlobalMod to mod_a",
      },
    },
  });
  const adminRecovery = buildAdminRecoveryPanelViewModel({
    tasks: [
      {
        id: "recovery-gate",
        label: "Recovery go/no-go",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Read-only operator proof",
        boundaryDetail: "/operator/proof-runs/go-no-go",
        buttonLabel: "Check gate",
        confirmLabel: "Run check",
      },
    ],
    commandStatuses: {
      "recovery-gate": {
        state: "confirm",
        message: "Read saved go/no-go proof artifacts for this game",
      },
    },
    game: "midsummer",
    principalUserId: "admin_a",
  });
  const hostAction = createHostActionController(
    {
      id: "modkill-slot",
      label: "Modkill",
      objectLabel: "Slot 7 / Mira",
      outcomeLabel: "mark dead and lock voting power",
      confirmationText:
        "Modkill Slot 7 / Mira: mark dead and lock voting power.",
      irreversible: true,
      payload: { slotId: "slot-7" },
    },
    () => {},
  );
  hostAction.activate();

  const confirmations = [
    adminSetup.items[0].confirmation,
    adminRecovery.items[0].confirmation,
    hostAction.viewModel().confirmation,
  ];

  for (const confirmation of confirmations) {
    assert.equal(confirmation.kind, CONFIRMATION_ACTION_CONTRACT.kind);
    assert.equal(confirmation.role, CONFIRMATION_ACTION_CONTRACT.role);
    assert.equal(confirmation.ariaModal, CONFIRMATION_ACTION_CONTRACT.ariaModal);
    assert.equal(
      confirmation.initialFocusTestId,
      confirmation.confirmTestId,
      `${confirmation.surface}:${confirmation.actionId} initial focus target`,
    );
    assert.equal(
      confirmation.returnFocusTestId,
      confirmation.triggerTestId,
      `${confirmation.surface}:${confirmation.actionId} return focus target`,
    );
    assert.equal(
      confirmation.escapeCancels,
      CONFIRMATION_ACTION_CONTRACT.escapeCancels,
    );
  }

  return {
    boundary:
      "Static model contract proves admin and moderator confirmations are shaped by the shared confirmation action model before the ConfirmationShell renders them. Browser smoke is still required to prove runtime focus traversal and pointer behavior.",
    model: "confirmation-action-model",
    kind: CONFIRMATION_ACTION_CONTRACT.kind,
    role: CONFIRMATION_ACTION_CONTRACT.role,
    ariaModal: CONFIRMATION_ACTION_CONTRACT.ariaModal,
    focusContract: {
      initialFocus: CONFIRMATION_ACTION_CONTRACT.initialFocus,
      returnFocus: CONFIRMATION_ACTION_CONTRACT.returnFocus,
      escapeCancels: CONFIRMATION_ACTION_CONTRACT.escapeCancels,
    },
    surfaces: confirmations.map((confirmation) => ({
      surface: confirmation.surface,
      actionId: confirmation.actionId,
      messageId: confirmation.messageId,
      confirmTestId: confirmation.confirmTestId,
      cancelTestId: confirmation.cancelTestId,
      triggerTestId: confirmation.triggerTestId,
      tabContainment: confirmation.tabContainment,
    })),
  };
}

async function proveConfirmationCommandTraceContract() {
  const adminActivity = buildAdminCommandActivityViewModel({
    commandStatuses: {
      "session-grants": adminConfirmStatus({
        id: "session-grants",
        commandAction: "grant_session",
        confirmMessage: "Grant GlobalMod to mod_a",
      }),
      "recovery-gate": adminConfirmStatus({
        id: "recovery-gate",
        confirmMessage: "Read saved go/no-go proof artifacts for this game",
      }),
    },
  });
  const hostTrace = hostConfirmationCommandTrace({
    id: "extend_deadline",
    label: "Extend deadline",
    objectLabel: "Day 2 deadline",
    outcomeLabel: "move the deadline to June 19, 2026 at 9:00 PM PT",
    confirmationText:
      "Extend Day 2 deadline: move the deadline to June 19, 2026 at 9:00 PM PT for Day 2 deadline.",
    requiresConfirmation: true,
    payload: { kind: "extend_deadline", gameId: "midsummer" },
  });
  const hostActivity = buildHostCommandActivityViewModel({
    commandStatuses: {
      extend_deadline: hostCommandPendingStatus({
        actionId: "extend_deadline",
        confirmationTrace: hostTrace,
      }),
    },
  });
  const traces = [
    ...adminActivity.items.map((item) => item.confirmationTrace),
    ...hostActivity.items.map((item) => item.confirmationTrace),
  ];

  for (const trace of traces) {
    assert.equal(trace.kind, CONFIRMATION_COMMAND_TRACE_CONTRACT.kind);
    assert.equal(
      trace.confirmationKind,
      CONFIRMATION_COMMAND_TRACE_CONTRACT.confirmationKind,
    );
    assert.equal(trace.actionId, trace.statusKey);
  }

  return {
    boundary:
      "Static model contract proves admin and moderator command activity rows carry shared confirmation-command traces that bind confirmation action ids to command status keys. Browser smoke is still required to prove hydrated confirm-to-dispatch interaction.",
    model: "confirmation-command-trace-model",
    kind: CONFIRMATION_COMMAND_TRACE_CONTRACT.kind,
    confirmationKind: CONFIRMATION_COMMAND_TRACE_CONTRACT.confirmationKind,
    surfaces: traces.map((trace) => ({
      surface: trace.surface,
      actionId: trace.actionId,
      statusKey: trace.statusKey,
      dispatchKind: trace.dispatchKind,
    })),
  };
}

function proveCommandTraceContract() {
  const receipts = recordPlayerCommandReceipt(
    recordPlayerCommandReceipt(
      [],
      "submit_post",
      {
        state: "ack",
        message: "Ack: stream seqs 51",
      },
    ),
    "submit_vote",
    playerCommandPendingStatus("submit_vote"),
  );
  const receipt = buildPlayerCommandReceiptViewModel({ receipts });
  const traces = receipt.items.map((item) => item.commandTrace);

  for (const trace of traces) {
    assert.equal(trace.kind, COMMAND_TRACE_CONTRACT.kind);
    assert.equal(trace.surface, "player");
    assert.equal(trace.actionId, trace.statusKey);
    assert.equal(trace.dispatchKind, trace.actionId);
  }

  return {
    boundary:
      "Static model contract proves player command receipt rows carry shared command traces that bind action ids to status keys, dispatch kinds, and projection refresh keys. Browser smoke is still required to prove hydrated click-to-dispatch interaction.",
    model: "command-trace-model",
    kind: COMMAND_TRACE_CONTRACT.kind,
    surfaces: traces.map((trace) => ({
      surface: trace.surface,
      actionId: trace.actionId,
      statusKey: trace.statusKey,
      dispatchKind: trace.dispatchKind,
      projectionRefreshKeys: trace.projectionRefreshKeys,
    })),
  };
}

async function proveAdminSurface() {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
  });
  const auditDetailData = await buildAdminAuditDetailData({
    audit: "proof-runs",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
  });
  assert.equal(data.access.allowed, true);
  assert.equal(data.shell.activeSurface, "admin");
  assert.equal(auditDetailData.status, "available");
  assert.equal(auditDetailData.surfaceHeader.title, "Proof runs");

  const gameSetupById = new Map(data.gameSetup.map((item) => [item.id, item]));
  const commandStatuses = {
    "create-game": adminConfirmStatus(gameSetupById.get("create-game")),
    "session-grants": adminConfirmStatus(gameSetupById.get("session-grants")),
    cohost: adminConfirmStatus(gameSetupById.get("cohost")),
    "recovery-gate": adminConfirmStatus(data.recoveryTasks[0]),
  };
  const setup = buildAdminSetupGridViewModel({
    items: data.gameSetup,
    commandStatuses,
    sessionGrant: data.command.sessionGrant,
  });
  const readiness = buildAdminReadinessStripViewModel({
    operator: data.operator,
    gameSetup: data.gameSetup,
    audit: data.audit,
    recoveryTasks: data.recoveryTasks,
  });
  const audit = buildAdminAuditPanelViewModel({ audit: data.audit });
  const recovery = buildAdminRecoveryPanelViewModel({
    tasks: data.recoveryTasks,
    commandStatuses,
    game: data.shell.game,
    principalUserId: data.operator.principalUserId,
  });
  const activity = buildAdminCommandActivityViewModel({ commandStatuses });
  const escalation = buildAdminEscalationPanelViewModel({
    escalations: data.escalations,
  });

  assert.deepEqual(
    setup.items.map((item) => item.id),
    ["create-game", "host-setup", "session-grants", "cohost"],
  );
  assert.equal(audit.items.length >= 1, true);
  assert.equal(recovery.items.length, 1);
  assert.equal(escalation.items.length >= 1, true);
  assert.deepEqual(
    readiness.items.map((item) => [item.id, item.status.state]),
    [
      ["authority", "ack"],
      ["setup", "pending"],
      ["audit", "ack"],
      ["recovery", "pending"],
    ],
  );
  assert.equal(audit.items[0].statusView.state, "ack");
  assert.equal(audit.items[0].statusTestId, "admin-audit-status-proof-runs");
  assert.equal(audit.items[0].linkTestId, "admin-audit-link-proof-runs");
  assert.equal(audit.items[0].boundaryTestId, "admin-audit-boundary-proof-runs");
  assert.equal(audit.items[0].evidenceTestId, "admin-audit-evidence-proof-runs");
  assert.equal(audit.items[0].authority, "GlobalAdmin or GlobalMod");
  assert.equal(audit.items[0].boundary, "Read-only operator proof");
  assert.equal(audit.items[0].boundaryDetail.includes("/operator/proof-runs"), true);
  assertTouchTargets([
    ...setup.items.map((item) => item.minTouchTargetPx),
    ...audit.items.map((item) => item.minTouchTargetPx),
    ...recovery.items.map((item) => item.minTouchTargetPx),
  ]);
  assert.equal(setup.items.find((item) => item.id === "session-grants").isSessionGrant, true);
  assert.equal(recovery.items[0].form.action, "?/checkRecoveryGate");
  assert.equal(activity.root.data.component, "admin-command-activity");
  assert.equal(activity.summary, "4 recent admin command events");
  assert.deepEqual(
    activity.items.map((item) => item.statusTestId),
    [
      "admin-command-activity-status-recovery-gate",
      "admin-command-activity-status-cohost",
      "admin-command-activity-status-session-grants",
      "admin-command-activity-status-create-game",
    ],
  );
  const confirmationCoverage = proveAdminConfirmationCoverage({
    data,
    setup,
    recovery,
  });

  const command = await sendAdminSetupCommand({
    item: data.gameSetup.find((item) => item.id === "create-game"),
    data,
    fetchImpl: async () => {
      throw new Error("static admin proof uses injected command sender");
    },
    sendCommandImpl: async (request) => {
      assert.equal(request.principalUserId, "admin_a");
      assert.equal(request.endpoint, "/commands");
      assert.deepEqual(request.command, {
        CreateGame: {
          game: "midsummer",
          pack: "mafiascum",
        },
      });
      return {
        state: "reject",
        message: "Reject DuplicateGame: already exists",
      };
    },
  });
  assert.equal(command.outcome.state, "reject");

  return {
    role: {
      id: "admin",
      activeSurface: data.shell.activeSurface,
      capability: data.operator.capabilityLabel,
      surfaceHeader: surfaceHeaderSummary(data.surfaceHeader),
      auditDetailSurfaceHeader: surfaceHeaderSummary(auditDetailData.surfaceHeader),
      surfaces: {
        readiness: readiness.items.map((item) => ({
          id: item.id,
          state: item.status.state,
          testId: item.testId,
          statusTestId: item.statusTestId,
          ...textFitSummary(item),
        })),
        setup: setup.items.map((item) => item.id),
        audit: audit.items.map((item) => ({
          id: item.id,
          statusState: item.statusView.state,
          statusTestId: item.statusTestId,
          linkTestId: item.linkTestId,
          href: item.href,
          inspectHref: item.inspectHref,
          boundaryTestId: item.boundaryTestId,
          evidenceTestId: item.evidenceTestId,
          authority: item.authority,
          boundary: item.boundary,
        })),
        recovery: recovery.items.map((item) => item.id),
        escalation: escalation.items.map((item) => item.id),
      },
      commandActivity: {
        component: activity.root.data.component,
        summary: activity.summary,
        itemTestIds: activity.items.map((item) => item.testId),
        confirmationTraces: activity.items.map((item) => ({
          actionId: item.actionId,
          statusTestId: item.statusTestId,
          trace: item.confirmationTrace,
        })),
      },
      touchTargetFloorPx: 44,
    },
    confirmationCoverage,
    commandPath: {
      role: "admin",
      action: "create_game",
      state: command.outcome.state,
      message: command.outcome.message,
    },
  };
}

async function provePlayerSurface() {
  const capabilities = [
    { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
    { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
  ];
  const data = await buildGameRouteData({
    game: "midsummer",
    principalUserId: "player_mira",
    capabilities,
  });
  assert.equal(data.access.allowed, true);
  assert.equal(data.shell.activeSurface, "player");
  assert.deepEqual(
    data.shell.surfaces
      .filter((surface) => surface.id === "moderator" || surface.id === "admin")
      .map((surface) => [surface.id, surface.navigation]),
    [
      ["moderator", "blocked"],
      ["admin", "blocked"],
    ],
  );
  assert.equal(Object.hasOwn(data, "criticalActions"), false);
  assert.equal(Object.hasOwn(data, "moderatorActionGroups"), false);
  assert.equal(Object.hasOwn(data, "hostPrompts"), false);

  const channels = buildPlayerChannelSwitcherViewModel({ channels: data.channels });
  const commandPanel = buildPlayerCommandPanelViewModel({
    composer: data.composer,
    phase: data.phase,
    votecount: data.votecount,
    channel: data.channel,
    player: data.player,
  });
  const commandReceipt = buildPlayerCommandReceiptViewModel({
    receipts: recordPlayerCommandReceipt(
      [],
      "submit_vote",
      playerCommandPendingStatus(),
    ),
  });
  const posture = buildPlayerPostureStripViewModel({
    phase: data.phase,
    privateQueueBoundary: data.privateQueueBoundary,
  });
  const privateQueue = buildPlayerPrivateQueueViewModel({
    boundary: data.privateQueueBoundary,
    items: data.privateQueue,
  });
  const privateDisclosure = buildPlayerPrivateQueueViewModel({
    boundary: buildPrivateQueueBoundary({
      notifications: [{ effect: "Commuted", phase_id: "N02", status: "Delivered" }],
      investigationResults: [],
    }),
    items: buildPrivateQueue({
      notifications: [{ effect: "Commuted", phase_id: "N02", status: "Delivered" }],
      investigationResults: [],
    }).map((item) => ({
      ...item,
      reviewHref: "/g/midsummer?private=notification-1",
    })),
  });

  assert.equal(data.thread.posts.length > 0, true);
  const threadView = buildPlayerThreadViewModel(data.thread);
  assert.deepEqual(threadView.pager.button, {
    testId: PLAYER_THREAD_PAGER_CONTRACT.buttonTestId,
    label: "Load older",
    disabled: false,
    ariaDisabled: "false",
    disabledReason: null,
    minTouchTargetPx: PLAYER_THREAD_PAGER_CONTRACT.minTouchTargetPx,
    nextBeforeSeq: 441,
  });
  const mediaPost = threadView.posts.find((post) => post.media.items.length > 0);
  assert.notEqual(mediaPost, undefined, "player fixture must include tablet media");
  assert.equal(mediaPost.media.items[0].variant, "tablet");
  assert.equal(
    mediaPost.media.items[0].src,
    "/media/midsummer/thread/receipt-442-tablet.png",
  );
  assert.equal(
    mediaPost.media.items[0].sources.some((source) =>
      source.srcset?.includes("/media/midsummer/thread/receipt-442-small.png"),
    ),
    true,
  );
  assert.equal(mediaPost.media.items[0].src.includes("original"), false);
  assert.equal(
    mediaPost.media.items[0].sources.some((source) =>
      source.srcset?.includes("original"),
    ),
    false,
  );
  const originalOnlyMedia = buildPlayerThreadViewModel({
    posts: [
      {
        seq: 999,
        media: [
          {
            id: "unsafe-original",
            kind: "image",
            variants: {
              original: { url: "/media/original/unsafe.jpg", width: 4000 },
            },
          },
        ],
      },
    ],
  });
  assert.equal(originalOnlyMedia.posts[0].media.items.length, 0);
  assert.equal(originalOnlyMedia.posts[0].media.withheld.length, 1);
  assert.equal(
    originalOnlyMedia.posts[0].mediaBoundary.status,
    "tablet-variant-missing",
  );
  assert.equal(data.phase.deadlineLabel.length > 0, true);
  assert.deepEqual(commandPanel.composer.channelContext, {
    testId: PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
    channelId: "main",
    channelLabel: "Main thread",
    capabilityLabel: "SlotOccupant or ChannelMember(main)",
    slotId: "slot-7",
    actorAlive: "unknown",
    actorStatus: "",
    label: "Posting target",
    value: "Main thread as slot-7",
    audienceLabel: "Everyone at the table reads this",
  });
  assert.equal(commandPanel.context.deadline.testId, "player-votecount-deadline");
  assert.equal(commandPanel.context.deadline.value, data.phase.deadlineLabel);
  assert.equal(commandPanel.context.deadline.phaseLabel, data.phase.label);
  assert.equal(commandPanel.context.deadline.isProjected, true);
  assert.equal(commandPanel.votecount.rows.length > 0, true);
  assert.equal(commandReceipt.root.data.component, "player-command-receipt");
  assert.equal(commandReceipt.items[0].testId, "player-command-receipt-submit_vote");
  assert.equal(commandReceipt.items[0].statusTestId, "player-command-status");
  assert.deepEqual(
    posture.items.map((item) => [item.id, item.status.state]),
    [
      ["phase", "ack"],
      ["deadline", "ack"],
      ["private", "pending"],
    ],
  );
  assert.equal(privateQueue.root.data.boundaryStatus, "principal-scoped-private-projections");
  assert.equal(channels.channels.every((channel) => channel.minTouchTargetPx >= 44), true);
  assertTouchTargets(
    [...commandPanel.quickActions.buttons, ...commandPanel.composer.buttons].map(
      (button) => button.data.minTouchTargetPx,
    ),
  );
  assert.equal(privateQueue.items.every((item) => item.minTouchTargetPx >= 44), true);
  assert.equal(privateDisclosure.items[0].ariaExpanded, "false");
  assert.equal(privateDisclosure.items[0].reviewLabel, "Review Commuted");
  assert.equal(privateDisclosure.items[0].reviewLinkLabel, "Open Commuted review");
  assert.equal(
    privateDisclosure.items[0].reviewLinkTestId,
    "player-private-link-notification-1",
  );
  assert.equal(
    privateDisclosure.items[0].reviewHref,
    "/g/midsummer?private=notification-1",
  );
  assert.equal(
    privateDisclosure.items[0].detailTestId,
    "player-private-detail-notification-1",
  );
  assert.equal(data.layout.root.data.mode, "tablet-two-zone-channel-switcher");
  assert.equal(data.layout.root.data.minTabletViewportPx, 1024);
  assert.equal(data.layout.root.data.collapseBelowPx < data.layout.root.data.minTabletViewportPx, true);
  assert.deepEqual(data.layout.regions, ["channels", "thread", "commands"]);
  const rolePmRoute = await buildGameRouteData({
    game: "midsummer",
    activeChannel: "private:role_pm:slot-7",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
    ],
  });
  assert.equal(rolePmRoute.channel.supported, true);
  assert.equal(rolePmRoute.channel.allowed, true);
  assert.equal(rolePmRoute.channels[0].active, true);
  assert.equal(Object.hasOwn(rolePmRoute, "hostPrompts"), false);

  const postRefreshed = [];
  const postProjectionStore = {
    getSnapshot() {
      return { thread: rolePmRoute.thread, votecount: rolePmRoute.votecount };
    },
    async refresh(keys) {
      postRefreshed.push(keys);
    },
  };
  const privatePost = await submitPlayerRouteCommand({
    action: "submit_post",
    composerBody: "private role note",
    data: rolePmRoute,
    fetchImpl: async () => null,
    projectionStore: postProjectionStore,
    sendCommandImpl: async (request) => {
      assert.deepEqual(request.command.SubmitPost, {
        game: "midsummer",
        channel_id: "private:role_pm:slot-7",
        actor_slot: "slot-7",
        body: "private role note",
      });
      return {
        state: "ack",
        message: "Ack: stream seqs 51",
      };
    },
  });
  assert.equal(privatePost.commandStatus.state, "ack");
  assert.deepEqual(postRefreshed, [["thread", "votecount", "dayVoteOutcomes"]]);

  const refreshed = [];
  const projectionStore = {
    getSnapshot() {
      return { thread: data.thread, votecount: data.votecount };
    },
    async refresh(keys) {
      refreshed.push(keys);
    },
  };
  const command = await submitPlayerRouteCommand({
    action: "submit_vote",
    composerBody: data.composer.defaultBody,
    data,
    fetchImpl: async () => null,
    projectionStore,
    sendCommandImpl: async (request) => {
      assert.equal(request.command.SubmitVote.game, "midsummer");
      return {
        state: "reject",
        message: "Reject PhaseLocked: reload and retry",
      };
    },
  });
  assert.equal(command.commandStatus.state, "reject");
  assert.deepEqual(refreshed, []);

  return {
    role: {
      id: "player",
      activeSurface: data.shell.activeSurface,
      capability: data.player.capabilityLabel,
      surfaceHeader: surfaceHeaderSummary(data.surfaceHeader),
      posture: posture.items.map((item) => ({
        id: item.id,
        state: item.status.state,
        testId: item.testId,
        statusTestId: item.statusTestId,
        ...textFitSummary(item),
      })),
      channels: channels.channels.map((channel) => channel.id),
      threadPosts: data.thread.posts.length,
      threadPager: {
        component: PLAYER_THREAD_PAGER_CONTRACT.component,
        rootTestId: threadView.pager.root.testId,
        state: threadView.pager.root.state,
        busy: threadView.pager.root.busy,
        cursorTestId: threadView.pager.cursor.testId,
        cursorLabel: threadView.pager.cursor.label,
        buttonTestId: threadView.pager.button.testId,
        buttonLabel: threadView.pager.button.label,
        buttonDisabled: threadView.pager.button.disabled,
        buttonDisabledReason: threadView.pager.button.disabledReason,
        minTouchTargetPx: threadView.pager.button.minTouchTargetPx,
        nextBeforeSeq: threadView.pager.button.nextBeforeSeq,
      },
      media: {
        component: PLAYER_THREAD_MEDIA_CONTRACT.component,
        preferredVariants: PLAYER_THREAD_MEDIA_CONTRACT.preferredVariants,
        forbiddenVariants: PLAYER_THREAD_MEDIA_CONTRACT.forbiddenVariants,
        fixtureIncludesOriginalVariant: false,
        renderedVariant: mediaPost.media.items[0].variant,
        renderedSrc: mediaPost.media.items[0].src,
        renderedSrcset: mediaPost.media.items[0].sources.find(
          (source) => source.type === "image/webp",
        )?.srcset,
        originalUrlRendered: false,
        originalOnlyWithheld: true,
      },
      votecountRows: commandPanel.votecount.rows.length,
      deadline: {
        testId: commandPanel.context.deadline.testId,
        value: commandPanel.context.deadline.value,
        phaseLabel: commandPanel.context.deadline.phaseLabel,
        state: commandPanel.context.deadline.state,
      },
      privateBoundary: privateQueue.root.data.boundaryStatus,
        privateDisclosure: {
          reviewLabel: privateDisclosure.items[0].reviewLabel,
          reviewLinkLabel: privateDisclosure.items[0].reviewLinkLabel,
          reviewLinkTestId: privateDisclosure.items[0].reviewLinkTestId,
          reviewHref: privateDisclosure.items[0].reviewHref,
        ariaExpanded: privateDisclosure.items[0].ariaExpanded,
        detailTestId: privateDisclosure.items[0].detailTestId,
      },
      commandReceipt: {
        component: commandReceipt.root.data.component,
        summary: commandReceipt.summary,
        itemTestIds: commandReceipt.items.map((item) => item.testId),
        currentStatusTestId: commandReceipt.items[0].statusTestId,
        commandTraces: commandReceipt.items.map((item) => ({
          actionId: item.actionId,
          statusTestId: item.statusTestId,
          trace: item.commandTrace,
        })),
      },
      commandChannelContext: commandPanel.composer.channelContext,
      blockedSurfaces: data.shell.surfaces
        .filter((surface) => surface.navigation === "blocked")
        .map((surface) => surface.id),
      layout: data.layout.root.data.mode,
      collapseBelowPx: data.layout.root.data.collapseBelowPx,
      commandRailStabilityMode: data.layout.commandRail.data.stabilityMode,
      privateChannelRoute: rolePmRoute.channel.href,
      privateChannelThreadEndpoint: rolePmRoute.coldLoad.threadEndpoint,
      privateChannelPostState: privatePost.commandStatus.state,
      touchTargetFloorPx: 44,
    },
    commandPath: {
      role: "player",
      action: "submit_vote",
      state: command.commandStatus.state,
      message: command.commandStatus.message,
      trace: playerCommandTrace("submit_vote"),
    },
  };
}

async function proveModeratorSurface() {
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    principalUserId: "host_h",
    capabilities: [{ kind: "HostOf", game: "midsummer" }],
  });
  assert.equal(data.access.allowed, true);
  assert.equal(data.shell.activeSurface, "moderator");

  const derived = buildHostDerivedState({
    gameId: data.game.id,
    snapshot: {
      host: {
        phase: data.phase,
        replacement: data.replacement,
      },
      votecount: data.votecount,
      hostPrompts: data.hostPrompts,
    },
  });
  const phase = buildHostPhaseSummaryViewModel({
    phase: data.phase,
    projection: derived.projection,
  });
  const operations = buildHostOperationsStripViewModel({
    access: data.access,
    phase: data.phase,
    projection: derived.projection,
    votecountBoundary: data.votecountBoundary,
    votecount: derived.votecount,
    hostPrompts: derived.hostPrompts,
  });
  const queues = buildHostWorkQueueStripViewModel({ queues: data.workQueues });
  const votecount = buildHostVotecountPanelViewModel({
    boundary: data.votecountBoundary,
    rows: derived.votecount,
  });
  const extendDeadlineAction = data.criticalActions.find(
    (action) => action.id === "extend_deadline",
  );
  const extendDeadlineTrace = hostConfirmationCommandTrace(extendDeadlineAction);
  const extendDeadlineEvent = {
    actionId: "extend_deadline",
    confirmationTrace: extendDeadlineTrace,
  };
  const controls = buildHostControlSurfaceViewModel({
    groups: derived.moderatorActionGroups,
    commandContext: data.commandContext,
    commandStatuses: {
      extend_deadline: hostCommandPendingStatus(extendDeadlineEvent),
    },
  });
  const activity = buildHostCommandActivityViewModel({
    commandStatuses: {
      extend_deadline: hostCommandPendingStatus(extendDeadlineEvent),
    },
    commandOutcomes: [
      {
        actionId: "advance_phase",
        state: "ack",
        message: "Ack: stream seqs 12",
      },
    ],
  });

  assert.equal(phase.facts.length >= 5, true);
  assert.deepEqual(
    operations.items.map((item) => [item.id, item.status.state]),
    [
      ["phase", "pending"],
      ["votecount", "ack"],
      ["prompts", "pending"],
      ["lifecycle", "pending"],
    ],
  );
  assert.equal(queues.queues.length >= 3, true);
  assert.equal(votecount.rows.length > 0, true);
  assert.equal(controls.groups.length >= 6, true);
  assert.deepEqual(controls.commandContext, {
    testId: HOST_CONTROL_SURFACE_CONTRACT.commandContextTestId,
    summary: "Acting as host_h",
    label: "Moderator access",
    value: "HostOf(midsummer) as host_h",
    gameId: "midsummer",
    principalUserId: "host_h",
    capabilityLabel: "HostOf(midsummer)",
    commandEndpoint: "/commands",
  });
  assert.deepEqual(
    activity.items.map((item) => [item.actionId, item.state, item.statusTestId]),
    [
      [
        "extend_deadline",
        "pending",
        "host-command-activity-status-extend_deadline",
      ],
      ["advance_phase", "ack", "host-command-activity-status-advance_phase"],
    ],
  );
  assert.equal(queues.queues.every((queue) => queue.minBlockPx >= 112), true);
  assert.equal(votecount.rows.every((row) => row.minTargetPx >= 44), true);
  assert.equal(
    controls.groups.some((group) =>
      group.actions.some((action) => action.config.id.startsWith("resolve_host_prompt-")),
    ),
    true,
  );

  const irreversibleAction = extendDeadlineAction;
  const hostAction = buildHostActionViewModel(irreversibleAction);
  assert.equal(hostAction.trigger.data.danger, "true");
  const dispatched = [];
  const controller = createHostActionController(irreversibleAction, (event) => {
    dispatched.push(event);
  });
  controller.activate();
  assert.equal(controller.state.confirmationOpen, true);
  controller.confirm();
  assert.equal(dispatched.length, 1);
  const confirmationCoverage = proveModeratorConfirmationCoverage({
    actions: data.criticalActions,
  });
  const hostPromptAction = data.criticalActions.find((action) =>
    action.id.startsWith("resolve_host_prompt-"),
  );
  assert.notEqual(hostPromptAction, undefined);

  const projectionStore = fakeHostProjectionStore({
    host: {
      phase: data.phase,
      replacement: data.replacement,
    },
    votecount: data.votecount,
    hostPrompts: data.hostPrompts,
  });
  const command = await sendHostRouteAction({
    event: {
      actionId: "advance_phase",
      payload: { kind: "advance_phase", gameId: "midsummer" },
    },
    data,
    fetchImpl: async () => null,
    projectionStore,
    sendHostActionCommandImpl: async (request) => {
      assert.equal(request.principalUserId, "host_h");
      return {
        state: "ack",
        actionId: request.actionEvent.actionId,
        message: "Ack: stream seqs 12",
        projectionState: {
          phase: { ...data.phase, label: "Night 2" },
          replacement: data.replacement,
        },
      };
    },
  });
  assert.equal(command.outcome.state, "ack");
  assert.equal(projectionStore.applied.length, 1);

  const promptProjectionStore = fakeHostProjectionStore({
    host: {
      phase: data.phase,
      replacement: data.replacement,
    },
    votecount: data.votecount,
    hostPrompts: data.hostPrompts,
  });
  const hostPromptCommand = await sendHostRouteAction({
    event: {
      actionId: hostPromptAction.id,
      payload: hostPromptAction.payload,
    },
    data,
    fetchImpl: async () => null,
    projectionStore: promptProjectionStore,
    sendHostActionCommandImpl: async (request) => {
      assert.equal(request.principalUserId, "host_h");
      assert.equal(request.actionEvent.payload.kind, "resolve_host_prompt");
      assert.equal(request.actionEvent.payload.promptId, "D01:skip_next_day:slot_1");
      return {
        state: "ack",
        actionId: request.actionEvent.actionId,
        message: "Ack: host prompt resolved",
        projectionPatches: {
          hostPrompts: [],
        },
      };
    },
  });
  assert.equal(hostPromptCommand.outcome.state, "ack");
  assert.deepEqual(promptProjectionStore.applied, [["hostPrompts", []]]);
  assert.equal(hostPromptCommand.snapshot.hostPrompts.length, 0);
  const afterPromptAck = buildHostDerivedState({
    gameId: data.game.id,
    snapshot: hostPromptCommand.snapshot,
  });
  assert.equal(
    afterPromptAck.criticalActions.some((action) =>
      action.id.startsWith("resolve_host_prompt-"),
    ),
    false,
  );
  const hydratedPromptProjectionStore = fakeHostProjectionStore({
    host: {
      phase: data.phase,
      replacement: data.replacement,
    },
    votecount: data.votecount,
    hostPrompts: data.hostPrompts,
  });
  const hydratedHostPromptCommand = await sendHostRouteAction({
    event: {
      actionId: hostPromptAction.id,
      payload: hostPromptAction.payload,
    },
    data,
    fetchImpl: async () => null,
    projectionStore: hydratedPromptProjectionStore,
    sendHostActionCommandImpl: async (request) => {
      assert.equal(request.principalUserId, "host_h");
      assert.equal(request.actionEvent.payload.kind, "resolve_host_prompt");
      return {
        state: "ack",
        actionId: request.actionEvent.actionId,
        message: "Ack: host prompt resolved",
      };
    },
  });
  assert.deepEqual(hydratedPromptProjectionStore.refreshed, [["hostPrompts"]]);
  assert.equal(hydratedHostPromptCommand.snapshot.hostPrompts.length, 0);
  const afterHydratedPromptAck = buildHostDerivedState({
    gameId: data.game.id,
    snapshot: hydratedHostPromptCommand.snapshot,
  });
  assert.equal(
    afterHydratedPromptAck.criticalActions.some((action) =>
      action.id.startsWith("resolve_host_prompt-"),
    ),
    false,
  );

  return {
    role: {
      id: "moderator",
      activeSurface: data.shell.activeSurface,
      capability: data.access.capabilityLabel,
      surfaceHeader: surfaceHeaderSummary(data.surfaceHeader),
      operations: operations.items.map((item) => ({
        id: item.id,
        state: item.status.state,
        testId: item.testId,
        statusTestId: item.statusTestId,
        ...textFitSummary(item),
      })),
      phaseFacts: phase.facts.map((fact) => fact.testId),
      queues: queues.queues.map((queue) => queue.id),
      votecountRows: votecount.rows.length,
      commandActivity: {
        component: activity.root.data.component,
        summary: activity.summary,
        itemTestIds: activity.items.map((item) => item.testId),
        confirmationTraces: activity.items.map((item) => ({
          actionId: item.actionId,
          statusTestId: item.statusTestId,
          trace: item.confirmationTrace,
        })),
      },
      controls: controls.groups.map((group) => group.id),
      commandContext: controls.commandContext,
      touchTargetFloorPx: 44,
    },
    confirmationCoverage,
    commandPath: {
      role: "moderator",
      action: "advance_phase",
      state: command.outcome.state,
      message: command.outcome.message,
      projectionApplied: projectionStore.applied.length,
      hostPrompt: {
        action: hostPromptAction.id,
        state: hostPromptCommand.outcome.state,
        message: hostPromptCommand.outcome.message,
        promptProjectionApplied: promptProjectionStore.applied.length,
        remainingPromptActions: afterPromptAck.criticalActions.filter((action) =>
          action.id.startsWith("resolve_host_prompt-"),
        ).length,
        hydratedRefreshApplied: hydratedPromptProjectionStore.refreshed.length,
        hydratedRemainingPromptActions:
          afterHydratedPromptAck.criticalActions.filter((action) =>
            action.id.startsWith("resolve_host_prompt-"),
          ).length,
      },
    },
  };
}

function proveConfirmationCoverage({ admin, moderator }) {
  assert.equal(admin.setup.length, 3);
  assert.equal(admin.recovery.length, 1);
  assert.equal(moderator.actions.length >= 9, true);
  assert.equal(
    moderator.actions.some((action) =>
      action.id.startsWith("resolve_host_prompt-"),
    ),
    true,
  );
  assert.equal(
    moderator.actions.every((action) => action.confirmationRole === "alertdialog"),
    true,
  );
  assert.equal(
    moderator.actions.every((action) => action.initialFocusTestId === action.confirmTestId),
    true,
  );
  assert.equal(
    moderator.actions.every(
      (action) => action.returnFocusTestId === HOST_ACTION_CONTRACT.triggerTestId,
    ),
    true,
  );

  return {
    boundary:
      "Static fallback opens model-owned confirmation controllers without dispatching. Browser smoke is still required to prove pointer/focus behavior, dialog pixels, and hydrated cancel/confirm interaction in Chromium.",
    admin,
    moderator,
  };
}

function proveAdminConfirmationCoverage({ data, setup, recovery }) {
  const setupById = new Map(setup.items.map((item) => [item.id, item]));
  const confirmableSetup = data.gameSetup.filter(
    (item) => adminSetupActionMode(item) === "confirm",
  );
  assert.deepEqual(
    confirmableSetup.map((item) => item.id),
    ["create-game", "session-grants", "cohost"],
  );

  const setupCoverage = confirmableSetup.map((source) => {
    const item = setupById.get(source.id);
    assert.notEqual(item, undefined, `${source.id} setup item missing`);
    assert.equal(item.status.state, "confirm");
    assert.equal(item.status.message, source.confirmMessage);
    assert.equal(item.confirmLabel, source.confirmLabel);
    assert.equal(item.confirmMessage, source.confirmMessage);
    assert.equal(item.confirmTestId, `admin-command-confirm-${source.id}`);
    assert.equal(item.cancelTestId, `admin-command-cancel-${source.id}`);
    assert.equal(item.triggerTestId, `admin-command-trigger-${source.id}`);
    assertAdminConfirmationBehavior(item.confirmation, {
      confirmTestId: item.confirmTestId,
      returnFocusTestId: item.triggerTestId,
    });
    assert.equal(item.minTouchTargetPx >= 44, true);
    assert.equal(typeof item.authority, "string");
    assert.equal(item.authority.length > 0, true);
    assert.equal(typeof item.boundary, "string");
    assert.equal(item.boundary.length > 0, true);
    assert.equal(typeof item.boundaryDetail, "string");
    assert.equal(item.boundaryDetail.length > 0, true);

    if (source.id === "session-grants") {
      assert.equal(item.isSessionGrant, true);
      assert.equal(item.boundaryDetail.includes("/auth/session-grants"), true);
      assert.equal(data.command.sessionGrant.action, "grant_session");
    }

    return {
      id: item.id,
      commandAction: item.commandAction,
      statusState: item.status.state,
      message: item.status.message,
      confirmLabel: item.confirmLabel,
      confirmTestId: item.confirmTestId,
      cancelTestId: item.cancelTestId,
      triggerTestId: item.triggerTestId,
      confirmationRole: item.confirmation.role,
      ariaModal: item.confirmation.ariaModal,
      messageTestId: item.confirmation.messageTestId,
      initialFocusTestId: item.confirmation.initialFocusTestId,
      returnFocusTestId: item.confirmation.returnFocusTestId,
      escapeCancels: item.confirmation.escapeCancels,
      tabContainment: item.confirmation.tabContainment,
      minTouchTargetPx: item.minTouchTargetPx,
      authority: item.authority,
      boundary: item.boundary,
    };
  });

  const recoveryCoverage = recovery.items.map((item) => {
    assert.equal(item.status.state, "confirm");
    assert.equal(item.status.message, item.confirmMessage);
    assert.equal(item.confirmTestId, `admin-recovery-confirm-${item.id}`);
    assert.equal(item.cancelTestId, `admin-recovery-cancel-${item.id}`);
    assert.equal(item.triggerTestId, `admin-recovery-trigger-${item.id}`);
    assertAdminConfirmationBehavior(item.confirmation, {
      confirmTestId: item.confirmTestId,
      returnFocusTestId: item.triggerTestId,
    });
    assert.equal(item.form.action, "?/checkRecoveryGate");
    assert.equal(item.minTouchTargetPx >= 44, true);
    assert.equal(item.boundaryDetail.includes("/operator/proof-runs/go-no-go"), true);

    return {
      id: item.id,
      action: item.action,
      statusState: item.status.state,
      message: item.status.message,
      confirmLabel: item.confirmLabel,
      confirmTestId: item.confirmTestId,
      cancelTestId: item.cancelTestId,
      triggerTestId: item.triggerTestId,
      confirmationRole: item.confirmation.role,
      ariaModal: item.confirmation.ariaModal,
      messageTestId: item.confirmation.messageTestId,
      initialFocusTestId: item.confirmation.initialFocusTestId,
      returnFocusTestId: item.confirmation.returnFocusTestId,
      escapeCancels: item.confirmation.escapeCancels,
      tabContainment: item.confirmation.tabContainment,
      formAction: item.form.action,
      minTouchTargetPx: item.minTouchTargetPx,
      authority: item.authority,
      boundary: item.boundary,
    };
  });

  return {
    setup: setupCoverage,
    recovery: recoveryCoverage,
  };
}

function proveModeratorConfirmationCoverage({ actions }) {
  return {
    actions: actions.map((actionConfig) => {
      const dispatched = [];
      const controller = createHostActionController(actionConfig, (event) => {
        dispatched.push(event);
      });
      const closedView = controller.viewModel();
      assert.equal(
        closedView.trigger.data.danger,
        String(actionConfig.irreversible === true),
      );
      assert.equal(closedView.trigger.ariaExpanded, "false");

      controller.activate();
      assert.equal(dispatched.length, 0);
      assert.equal(controller.state.confirmationOpen, true);
      const openView = controller.viewModel();
      assert.equal(openView.trigger.ariaExpanded, "true");
      assert.equal(openView.confirmation.role, "alertdialog");
      assert.equal(
        openView.confirmation.ariaModal,
        HOST_ACTION_CONTRACT.confirmationAriaModal,
      );
      assert.equal(openView.confirmation.message, actionConfig.confirmationText);
      assert.equal(openView.confirmation.objectLabel, actionConfig.objectLabel);
      assert.equal(openView.confirmation.outcomeLabel, actionConfig.outcomeLabel);
      assert.equal(
        openView.confirmation.message.includes(actionConfig.objectLabel),
        true,
      );
      assert.equal(
        openView.confirmation.message.includes(actionConfig.outcomeLabel),
        true,
      );

      controller.confirm();
      assert.equal(dispatched.length, 1);
      assert.equal(dispatched[0].actionId, actionConfig.id);
      assert.deepEqual(dispatched[0].payload, actionConfig.payload);

      return {
        id: actionConfig.id,
        objectLabel: actionConfig.objectLabel,
        outcomeLabel: actionConfig.outcomeLabel,
        confirmationRole: openView.confirmation.role,
        ariaModal: openView.confirmation.ariaModal,
        confirmationMessage: openView.confirmation.message,
        confirmationTestId: openView.confirmation.confirmationTestId,
        messageTestId: openView.confirmation.messageTestId,
        confirmTestId: openView.confirmation.confirmTestId,
        cancelTestId: openView.confirmation.cancelTestId,
        initialFocusTestId: openView.confirmation.initialFocusTestId,
        returnFocusTestId: openView.confirmation.returnFocusTestId,
        escapeCancels: openView.confirmation.escapeCancels,
        tabContainment: openView.confirmation.tabContainment,
        triggerDanger: closedView.trigger.data.danger,
        payloadKind: actionConfig.payload.kind,
      };
    }),
  };
}

function assertAdminConfirmationBehavior(confirmation, {
  confirmTestId,
  returnFocusTestId,
}) {
  assert.equal(confirmation.role, ADMIN_CONFIRMATION_CONTRACT.role);
  assert.equal(confirmation.ariaModal, ADMIN_CONFIRMATION_CONTRACT.ariaModal);
  assert.equal(confirmation.initialFocusTestId, confirmTestId);
  assert.equal(confirmation.returnFocusTestId, returnFocusTestId);
  assert.equal(confirmation.escapeCancels, true);
  assert.equal(confirmation.tabContainment, "local-confirmation-controls");
}

async function proveForbiddenRoutes() {
  const adminData = await buildAdminRouteData({
    principalUserId: "player_mira",
    capabilities: [{ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }],
  });
  assert.equal(adminData.access.allowed, false);

  const playerData = await buildGameRouteData({
    game: "midsummer",
    principalUserId: null,
    capabilities: [],
  });
  assert.equal(playerData.access.allowed, false);

  const hostData = await buildHostConsoleRouteData({
    game: "midsummer",
    principalUserId: "player_mira",
    capabilities: [{ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }],
  });
  assert.equal(hostData.access.allowed, false);

  return {
    adminAsPlayer: adminForbiddenMessage(),
    playerSignedOut: playerForbiddenMessage("midsummer"),
    moderatorAsPlayer: hostConsoleForbiddenMessage("midsummer"),
  };
}

function assertTouchTargets(values) {
  assert.equal(values.length > 0, true);
  for (const value of values) {
    assert.equal(Number(value) >= 44, true);
  }
}

function assertUnique(values, label) {
  assert.equal(values.length > 0, true);
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

function fakeHostProjectionStore(snapshot) {
  return {
    applied: [],
    refreshed: [],
    applyPayload(key, payload) {
      this.applied.push([key, payload]);
      snapshot = { ...snapshot, [key]: payload };
      return snapshot;
    },
    async refresh(keys) {
      this.refreshed.push(keys);
      snapshot = { ...snapshot, hostPrompts: [] };
      return snapshot;
    },
    getSnapshot() {
      return snapshot;
    },
  };
}
