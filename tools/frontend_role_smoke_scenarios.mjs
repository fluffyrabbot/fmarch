import {
  APP_ROUTE_STATE_CONTRACT,
  routeStateActionTestId,
  routeStateStatusTestId,
  routeStateTestId,
} from "../frontend/src/lib/app/app-route-state-model.mjs";
import {
  BOARD_ROUTE_CONTRACT,
  buildAppShell,
  buildBoardRouteData,
  buildShellKeyboardOrder,
  fixtureBoardGameIndexPage,
  gameActionTestId,
  roleNavTestId,
} from "../frontend/src/lib/app/app-shell-model.mjs";
import {
  resolveFixtureSession,
} from "../frontend/src/lib/server/session-capabilities.mjs";
import {
  ADMIN_ROUTE_CONTRACT,
  adminForbiddenMessage,
} from "../frontend/src/routes/admin/admin-route-model.mjs";
import {
  ADMIN_OPERATOR_INBOX_CONTRACT,
} from "../frontend/src/routes/admin/admin-operator-inbox.mjs";
import {
  PLAYER_ROUTE_CONTRACT,
  playerForbiddenMessage,
} from "../frontend/src/routes/g/[game]/game-route-model.mjs";
import {
  HOST_CONSOLE_ROUTE_CONTRACT,
  hostConsoleForbiddenMessage,
} from "../frontend/src/routes/g/[game]/host/host-route-model.mjs";
import {
  HOST_SETUP_ROUTE_CONTRACT,
} from "../frontend/src/routes/g/[game]/setup/setup-route-model.mjs";
import {
  ADMIN_READINESS_STRIP_CONTRACT,
  adminReadinessStatusTestId,
  adminReadinessTestId,
} from "../frontend/src/lib/components/admin/admin-surface-model.mjs";
import {
  PUBLIC_GAME_PUBLICATION_CONTRACT,
} from "../frontend/src/routes/games/[game]/public-game-publication.mjs";

export const viewports = Object.freeze([
  Object.freeze({ name: "mobile", width: 390, height: 844 }),
  Object.freeze({ name: "tablet", width: 1024, height: 768 }),
  Object.freeze({ name: "tablet-wide", width: 1180, height: 820 }),
  Object.freeze({ name: "tablet-landscape", width: 1280, height: 900 }),
  Object.freeze({ name: "desktop", width: 1440, height: 920 }),
]);

export const setupViewports = Object.freeze([
  Object.freeze({ name: "mobile", width: 390, height: 844 }),
  Object.freeze({ name: "tablet", width: 1024, height: 768 }),
  Object.freeze({ name: "desktop", width: 1440, height: 920 }),
]);

export const publicationViewports = setupViewports;

export const accessibilitySurfaceContract = Object.freeze({
  viewport: Object.freeze({
    name: "desktop-200-percent-reflow",
    width: 720,
    height: 450,
    equivalentBaseWidth: 1440,
    zoomPercent: PUBLIC_GAME_PUBLICATION_CONTRACT.reflowZoomPercent,
  }),
  media: Object.freeze({ reducedMotion: "reduce", forcedColors: "active" }),
  admin: Object.freeze({
    token: "fixture-admin",
    path: "/admin?task=recovery%3Arecovery-gate",
    selectedTaskId: "recovery:recovery-gate",
    selectionMode: ADMIN_OPERATOR_INBOX_CONTRACT.selectionMode,
  }),
  publication: Object.freeze({
    token: null,
    path: "/games/midsummer",
    skipTestId: PUBLIC_GAME_PUBLICATION_CONTRACT.skipPostsTestId,
    firstPostTestId: "public-game-post-42",
    readingHeadingId: PUBLIC_GAME_PUBLICATION_CONTRACT.threadHeadingId,
  }),
});

export const publicGameScenario = Object.freeze({
  id: "public-game-publication",
  path: "/games/midsummer",
  surfaceTestId: "public-game-surface",
  publicationTestId: "public-game-publication",
  metadataTestId: "public-game-metadata",
  readingLaneTestId: "public-game-reading-lane",
  publicationMode: "reading-publication",
  postIds: Object.freeze([42, 41]),
  threadStartBudgetPx: Object.freeze({ mobile: 420, tablet: 380, desktop: 390 }),
  maxReadingMeasurePx: 760,
});

export const boardScenario = buildBoardSmokeScenario({
  id: "board-player",
  token: "fixture-player",
  game: "midsummer",
});

const adminReadinessTargets = scanStripTargets({
  contract: ADMIN_READINESS_STRIP_CONTRACT,
  testIdFor: adminReadinessTestId,
  statusTestIdFor: adminReadinessStatusTestId,
  states: {
    authority: "ack",
    setup: "pending",
    audit: "pending",
    recovery: "pending",
  },
  staticStates: {
    audit: "ack",
  },
});

const adminLiveReadinessTargets = scanStripTargets({
  contract: ADMIN_READINESS_STRIP_CONTRACT,
  testIdFor: adminReadinessTestId,
  statusTestIdFor: adminReadinessStatusTestId,
  states: {
    authority: "ack",
    setup: "pending",
    audit: "pending",
    recovery: "pending",
  },
});

const adminShell = shellForFixture({
  token: "fixture-admin",
  game: "midsummer",
  activeSurface: "admin",
});
const adminNav = navFromSurfaces(adminShell.surfaces);
const playerShell = shellForFixture({
  token: "fixture-player",
  game: "midsummer",
  activeSurface: "player",
});
const playerNav = navFromSurfaces(playerShell.surfaces);
const moderatorShell = shellForFixture({
  token: "fixture-host",
  game: "midsummer",
  activeSurface: "moderator",
});
const moderatorNav = navFromSurfaces(moderatorShell.surfaces);
const playerPrivateChannelRoute = Object.freeze({
  id: "player-private-channel",
  role: "player-private-channel",
  token: "fixture-player",
  path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
  surface: "player",
  surfaceTestId: PLAYER_ROUTE_CONTRACT.surfaceTestId,
  nav: playerNav,
  focus: roleFocusScenario({
    shell: playerShell,
    expectedAfterNav: [
      "player-channel-main",
      "player-channel-private:role_pm:slot-7",
      "player-thread-load-older",
    ],
  }),
});

export const hostSetupScenario = Object.freeze({
  id: "host-setup",
  role: "host-setup",
  token: "fixture-host",
  path: "/g/midsummer/setup",
  surfaceTestId: HOST_SETUP_ROUTE_CONTRACT.surfaceTestId,
  capabilityTestId: HOST_SETUP_ROUTE_CONTRACT.capabilityTestId,
  requiredText: HOST_SETUP_ROUTE_CONTRACT.requiredText,
  slotIds: Object.freeze(["slot_1", "slot_2"]),
});

export const roles = Object.freeze([
  Object.freeze({
    id: "admin",
    token: "fixture-admin",
    path: "/admin",
    surfaceTestId: ADMIN_ROUTE_CONTRACT.surfaceTestId,
    firstViewportSurface: ADMIN_READINESS_STRIP_CONTRACT.surface,
    capabilityTestId: ADMIN_ROUTE_CONTRACT.capabilityTestId,
    requiredText: ADMIN_ROUTE_CONTRACT.requiredText,
    mobileViewportBudget: Object.freeze({
      primaryActionSelector:
        '[data-testid="admin-command-trigger-create-game"]',
      maxPrimaryActionBottomViewportRatio: 1,
      maxDocumentHeightViewportRatio: 2.6,
    }),
    interactionGeometryBudget: Object.freeze({
      confirmation: Object.freeze({
        anchorSelector: '[data-testid="admin-command-trigger-session-grants"]',
        targetSelector: '[data-testid="admin-session-grant-form"]',
        maxAnchorShiftPx: 1,
        maxCombinedSpanViewportRatio: 0.6,
        maxDocumentGrowthViewportRatio: 0.5,
      }),
      feedback: Object.freeze({
        anchorSelector: '[data-testid="admin-command-trigger-create-game"]',
        targetSelector: '[data-testid="admin-command-status-create-game"]',
        maxAnchorShiftPx: 1,
        maxCombinedSpanViewportRatio: 0.35,
        maxDocumentGrowthViewportRatio: 0.25,
      }),
    }),
    commandContinuityBudget: Object.freeze({
      beforeFocusSelector: '[data-testid="command-recovery-retry-create-game"]',
      afterFocusSelector: '[data-testid="admin-command-trigger-create-game"]',
      statusSelector: '[data-testid="admin-command-status-create-game"]',
      maxScrollDeltaPx: 1,
      maxAnnouncementLatencyMs: 500,
      maxFocusSettleMs: 500,
      maxVisualViewportDeltaPx: 1,
      inputBoundary: "interrupted-command-recovery-control",
    }),
    pendingStateBudget: Object.freeze({
      triggerSelector: '[data-testid="admin-command-trigger-create-game"]',
      statusSelector: '[data-testid="admin-command-status-create-game"]',
      busySelector: '[data-testid="admin-setup-create-game"]',
      anchorSelector: '[data-testid="admin-command-trigger-create-game"]',
      targetSelector: '[data-testid="admin-command-status-create-game"]',
      maxAnchorShiftPx: 1,
      maxCombinedSpanViewportRatio: 0.35,
      maxDocumentGrowthViewportRatio: 0.25,
      maxEnterPendingMs: 500,
      inputBoundary: "confirmed-admin-command",
    }),
    interruptedStateBudget: Object.freeze({
      actionId: "create-game",
      statusSelector: '[data-testid="admin-command-status-create-game"]',
      anchorSelector: '[data-testid="admin-command-trigger-create-game"]',
      targetSelector: '[data-testid="command-recovery-create-game"]',
      returnFocusSelector: '[data-testid="admin-command-trigger-create-game"]',
      maxAnchorShiftPx: 1,
      maxCombinedSpanViewportRatio: 0.55,
      maxDocumentGrowthViewportRatio: 0.4,
    }),
    closedByDefault: Object.freeze([
      '[data-testid="admin-recovery-workflow"]',
      '[data-testid="admin-status-overview"]',
      '[data-testid="admin-supporting-evidence"]',
      '[data-testid="admin-recent-activity"]',
    ]),
    expandBeforeChecks: Object.freeze([
      '[data-testid="admin-recovery-workflow"]',
      '[data-testid="admin-status-overview"]',
      '[data-testid="admin-supporting-evidence"]',
      '[data-testid="admin-current-system-checks"]',
    ]),
    collapseBeforeCommands: Object.freeze([
      '[data-testid="admin-status-overview"]',
      '[data-testid="admin-supporting-evidence"]',
    ]),
    collapseBeforeScreenshot: Object.freeze([
      '[data-testid="admin-recovery-workflow"]',
      '[data-testid="admin-status-overview"]',
      '[data-testid="admin-supporting-evidence"]',
      '[data-testid="admin-current-system-checks"]',
    ]),
    touchSelectors: [
      '[data-testid="admin-setup-create-game"] button',
      '[data-testid="admin-setup-session-grants"] summary',
      '[data-testid="admin-audit-link-proof-runs"]',
      '[data-testid="admin-recovery-recovery-gate"] button',
      '[data-testid="admin-status-overview"] > summary',
      '[data-testid="admin-supporting-evidence"] > summary',
    ],
    thumbZones: Object.freeze([
      Object.freeze({
        testId: "admin-setup-action-zone",
        zone: "admin-setup-actions",
        targetSelectors: Object.freeze([
          '[data-testid="admin-command-trigger-create-game"]',
          '[data-testid="admin-command-trigger-session-grants"]',
          '[data-testid="admin-command-trigger-cohost"]',
        ]),
      }),
      Object.freeze({
        testId: "admin-recovery-action-zone",
        zone: "admin-recovery-actions",
        targetSelectors: Object.freeze([
          '[data-testid="admin-recovery-trigger-recovery-gate"]',
        ]),
      }),
    ]),
    visibleTestIds: [
      ...adminReadinessTargets.overlapTestIds,
      "admin-audit-link-proof-runs",
    ],
    overlapTestIds: adminReadinessTargets.overlapTestIds,
    statusRegions: [
      ...adminReadinessTargets.statusRegions,
      Object.freeze({
        testId: "admin-audit-status-proof-runs",
        state: "ack",
      }),
    ],
    staticStatusRegions: [
      ...adminReadinessTargets.staticStatusRegions,
      Object.freeze({
        testId: "admin-audit-status-proof-runs",
        state: "ack",
      }),
    ],
    linkAffordances: Object.freeze([
      Object.freeze({
        testId: "admin-audit-link-proof-runs",
        hrefPath: "/admin/audit/proof-runs",
        searchParams: Object.freeze({
          game: "midsummer",
        }),
      }),
    ]),
    nav: adminNav,
    focus: roleFocusScenario({
      shell: adminShell,
      expectedAfterNav: [
        "admin-command-trigger-create-game",
        "admin-command-trigger-session-grants",
      ],
    }),
    live: Object.freeze({
      path: "/admin?game=midsummer",
      commandFlowId: null,
      mobileViewportBudget: Object.freeze({
        primaryActionSelector: '[data-testid="admin-command-trigger-host-setup"]',
        maxPrimaryActionBottomViewportRatio: 1,
        maxDocumentHeightViewportRatio: 2.6,
      }),
      touchSelectors: Object.freeze([
        '[data-testid="admin-command-trigger-host-setup"]',
        '[data-testid="admin-audit-link-proof-runs"]',
        '[data-testid="admin-recovery-recovery-gate"] button',
        '[data-testid="admin-status-overview"] > summary',
        '[data-testid="admin-supporting-evidence"] > summary',
      ]),
      thumbZones: Object.freeze([
        Object.freeze({
          testId: "admin-setup-action-zone",
          zone: "admin-setup-actions",
          targetSelectors: Object.freeze([
            '[data-testid="admin-command-trigger-host-setup"]',
          ]),
        }),
        Object.freeze({
          testId: "admin-recovery-action-zone",
          zone: "admin-recovery-actions",
          targetSelectors: Object.freeze([
            '[data-testid="admin-recovery-trigger-recovery-gate"]',
          ]),
        }),
      ]),
      visibleTestIds: Object.freeze([
        ...adminLiveReadinessTargets.overlapTestIds,
        "admin-audit-link-proof-runs",
      ]),
      overlapTestIds: adminLiveReadinessTargets.overlapTestIds,
      statusRegions: Object.freeze([
        ...adminLiveReadinessTargets.statusRegions,
        Object.freeze({ testId: "admin-audit-status-proof-runs", state: "ack" }),
      ]),
      focus: Object.freeze({
        ...roleFocusScenario({
          shell: adminShell,
          expectedAfterNav: [
            "admin-command-trigger-host-setup",
            "admin-recovery-trigger-recovery-gate",
          ],
        }),
        maxTabs: 36,
      }),
    }),
  }),
  Object.freeze({
    id: "player",
    token: "fixture-player",
    path: "/g/midsummer",
    surfaceTestId: PLAYER_ROUTE_CONTRACT.surfaceTestId,
    firstViewportSurface: "workspace",
    capabilityTestId: PLAYER_ROUTE_CONTRACT.capabilityTestId,
    requiredText: PLAYER_ROUTE_CONTRACT.requiredText,
    mobileViewportBudget: Object.freeze({
      primaryActionSelector: '[data-action="submit_vote"]',
      maxPrimaryActionBottomViewportRatio: 1,
      maxDocumentHeightViewportRatio: 3.5,
    }),
    interactionGeometryBudget: Object.freeze({
      feedback: Object.freeze({
        anchorSelector: '[data-testid="player-primary-action-zone"]',
        targetSelector: '[data-testid="player-command-receipt-submit_vote"]',
        maxAnchorShiftPx: 1,
        maxCombinedSpanViewportRatio: 0.9,
        maxDocumentGrowthViewportRatio: 0.25,
      }),
    }),
    commandContinuityBudget: Object.freeze({
      beforeFocusSelector:
        '[data-testid="command-recovery-retry-submit_post"]',
      afterFocusSelector:
        '[data-testid="player-composer"] [data-action="submit_post"]',
      statusSelector: '[data-testid="player-command-status"]',
      maxScrollDeltaPx: 1,
      maxAnnouncementLatencyMs: 500,
      maxFocusSettleMs: 500,
      maxVisualViewportDeltaPx: 1,
      inputBoundary: "interrupted-command-recovery-control",
    }),
    pendingStateBudget: Object.freeze({
      triggerSelector:
        '[data-testid="player-composer"] [data-action="submit_post"]',
      statusSelector: '[data-testid="player-command-status"]',
      busySelector: '[data-testid="player-primary-action-zone"]',
      anchorSelector: '[data-testid="player-primary-action-zone"]',
      targetSelector: '[data-testid="player-command-status"]',
      maxAnchorShiftPx: 1,
      maxCombinedSpanViewportRatio: 1,
      maxDocumentGrowthViewportRatio: 0.25,
      maxEnterPendingMs: 500,
      inputBoundary: "player-command-surface",
    }),
    interruptedStateBudget: Object.freeze({
      actionId: "submit_post",
      statusSelector: '[data-testid="player-command-status"]',
      anchorSelector: '[data-testid="player-primary-action-zone"]',
      targetSelector: '[data-testid="command-recovery-submit_post"]',
      returnFocusSelector:
        '[data-testid="player-composer"] [data-action="submit_post"]',
      maxAnchorShiftPx: 1,
      maxCombinedSpanViewportRatio: 1.1,
      maxDocumentGrowthViewportRatio: 0.4,
    }),
    closedByDefault: Object.freeze([
      '[data-testid="player-media-composer"]',
      '[data-testid="player-game-record"]',
    ]),
    expandBeforeChecks: Object.freeze([
      '[data-testid="player-game-record"]',
    ]),
    collapseBeforeCommands: Object.freeze([
      '[data-testid="player-media-composer"]',
      '[data-testid="player-game-record"]',
    ]),
    collapseBeforeScreenshot: Object.freeze([
      '[data-testid="player-media-composer"]',
      '[data-testid="player-game-record"]',
    ]),
    visibleTestIds: [
      "player-game-bar",
      "player-channel-switcher",
      "player-primary-action-zone",
      "player-thread-pager",
      "player-private-boundary",
      "player-private-review-notification-1",
      "player-private-link-notification-1",
      "player-private-review-investigation-1",
      "player-private-link-investigation-1",
    ],
    overlapTestIds: [
      "player-game-bar",
      "player-channel-switcher",
      "player-primary-action-zone",
    ],
    statusRegions: [],
    touchSelectors: [
      '[data-testid="player-channel-main"]',
      '[data-testid="player-thread-load-older"]',
      '[data-testid="player-composer"] button',
      '[data-testid="player-private-link-notification-1"]',
      '[data-testid="player-media-composer"] > summary',
      '[data-testid="player-game-record"] > summary',
    ],
    thumbZones: Object.freeze([
      Object.freeze({
        testId: "player-primary-action-zone",
        zone: "player-primary-actions",
        targetSelectors: Object.freeze([
          '[data-action="submit_vote"]',
          '[data-action="submit_vote:no_lynch"]',
          '[data-testid="player-dock-reply"]',
        ]),
      }),
    ]),
    nav: playerNav,
    focus: roleFocusScenario({
      shell: playerShell,
      expectedAfterNav: [
        "player-channel-main",
        "player-channel-private:role_pm:slot-7",
        "player-thread-load-older",
      ],
    }),
  }),
  Object.freeze({
    id: "moderator",
    token: "fixture-host",
    path: "/g/midsummer/host",
    surfaceTestId: HOST_CONSOLE_ROUTE_CONTRACT.surfaceTestId,
    firstViewportSurface: "tasks",
    capabilityTestId: HOST_CONSOLE_ROUTE_CONTRACT.capabilityTestId,
    requiredText: HOST_CONSOLE_ROUTE_CONTRACT.requiredText,
    mobileViewportBudget: Object.freeze({
      primaryActionSelector:
        '[data-testid="critical-host-action-extend_deadline"] [data-testid="critical-host-action-trigger"]',
      maxPrimaryActionBottomViewportRatio: 1,
      maxDocumentHeightViewportRatio: 2.5,
    }),
    interactionGeometryBudget: Object.freeze({
      confirmation: Object.freeze({
        anchorSelector:
          '[data-testid="critical-host-action-extend_deadline"] [data-testid="critical-host-action-trigger"]',
        targetSelector:
          '[data-testid="critical-host-action-extend_deadline"] [data-testid="critical-host-action-confirmation"]',
        maxAnchorShiftPx: 1,
        maxCombinedSpanViewportRatio: 0.35,
        maxDocumentGrowthViewportRatio: 0.25,
      }),
      feedback: Object.freeze({
        anchorSelector:
          '[data-testid="critical-host-action-extend_deadline"] [data-testid="critical-host-action-trigger"]',
        targetSelector: '[data-testid="host-command-status-extend_deadline"]',
        maxAnchorShiftPx: 1,
        maxCombinedSpanViewportRatio: 0.5,
        maxDocumentGrowthViewportRatio: 0.25,
      }),
    }),
    commandContinuityBudget: Object.freeze({
      beforeFocusSelector:
        '[data-testid="command-recovery-retry-extend_deadline"]',
      afterFocusSelector:
        '[data-testid="critical-host-action-extend_deadline"] [data-testid="critical-host-action-trigger"]',
      statusSelector: '[data-testid="host-command-status-extend_deadline"]',
      maxScrollDeltaPx: 1,
      maxAnnouncementLatencyMs: 500,
      maxFocusSettleMs: 500,
      maxVisualViewportDeltaPx: 1,
      inputBoundary: "interrupted-command-recovery-control",
    }),
    pendingStateBudget: Object.freeze({
      triggerSelector:
        '[data-testid="critical-host-action-extend_deadline"] [data-testid="critical-host-action-trigger"]',
      statusSelector: '[data-testid="host-command-status-extend_deadline"]',
      busySelector: '[data-testid="critical-host-action-extend_deadline"]',
      anchorSelector:
        '[data-testid="critical-host-action-extend_deadline"] [data-testid="critical-host-action-trigger"]',
      targetSelector: '[data-testid="host-command-status-extend_deadline"]',
      maxAnchorShiftPx: 1,
      maxCombinedSpanViewportRatio: 0.5,
      maxDocumentGrowthViewportRatio: 0.25,
      maxEnterPendingMs: 500,
      inputBoundary: "confirmed-moderator-command",
    }),
    interruptedStateBudget: Object.freeze({
      actionId: "extend_deadline",
      statusSelector: '[data-testid="host-command-status-extend_deadline"]',
      anchorSelector:
        '[data-testid="critical-host-action-extend_deadline"] [data-testid="critical-host-action-trigger"]',
      targetSelector: '[data-testid="command-recovery-extend_deadline"]',
      returnFocusSelector:
        '[data-testid="critical-host-action-extend_deadline"] [data-testid="critical-host-action-trigger"]',
      maxAnchorShiftPx: 1,
      maxCombinedSpanViewportRatio: 0.7,
      maxDocumentGrowthViewportRatio: 0.4,
    }),
    closedByDefault: Object.freeze([
      '[data-testid="host-supporting-evidence"]',
      '[data-testid="host-invite-workflows"]',
    ]),
    expandBeforeChecks: Object.freeze([
      '[data-testid="host-supporting-evidence"]',
      '[data-testid="host-invite-workflows"]',
    ]),
    collapseBeforeScreenshot: Object.freeze([
      '[data-testid="host-supporting-evidence"]',
      '[data-testid="host-invite-workflows"]',
    ]),
    collapseBeforeCommands: Object.freeze([
      '[data-testid="host-supporting-evidence"]',
      '[data-testid="host-invite-workflows"]',
    ]),
    visibleTestIds: [
      "host-console-bar",
      "host-console-attention",
      "host-task-queue-summary",
      "host-task-queue",
      "host-decision-canvas",
    ],
    overlapTestIds: [
      "host-console-attention",
      "host-task-queue-summary",
      "host-decision-canvas",
    ],
    statusRegions: [],
    touchSelectors: [
      '[data-testid="host-task-deadline"]',
      '[data-testid="host-task-engine-host-prompt-D01-skip_next_day-slot_1"]',
      '[data-testid="host-task-replacement"]',
      '[data-testid="critical-host-action-extend_deadline"] [data-testid="critical-host-action-trigger"]',
      '[data-testid="host-console-votecount-row-slot-2_Ilya"]',
      '[data-testid="host-supporting-evidence"] > summary',
      '[data-testid="host-invite-workflows"] > summary',
    ],
    thumbZones: Object.freeze([
      Object.freeze({
        testId: "moderator-primary-action-zone",
        zone: "moderator-primary-actions",
        targetSelectors: Object.freeze([
          '[data-testid="critical-host-action-extend_deadline"] [data-testid="critical-host-action-trigger"]',
          '[data-testid="critical-host-action-extend_deadline_24h"] [data-testid="critical-host-action-trigger"]',
          '[data-testid="critical-host-action-extend_deadline_48h"] [data-testid="critical-host-action-trigger"]',
        ]),
      }),
    ]),
    nav: moderatorNav,
    focus: roleFocusScenario({
      shell: moderatorShell,
      expectedAfterNav: ["critical-host-action-trigger"],
    }),
  }),
]);

export const navFocusCoverage = Object.freeze({
  surfaces: Object.freeze([
    navFocusCoverageForScenario({
      id: "board",
      path: boardScenario.path,
      nav: boardScenario.nav,
      focus: boardScenario.focus,
    }),
    ...roles.map((role) =>
      navFocusCoverageForScenario({
        id: role.id,
        path: role.path,
        nav: role.nav,
        focus: role.focus,
      }),
    ),
  ]),
});

export const routeStateScenarios = Object.freeze(
  [
    Object.freeze({
      id: "board",
      role: "board",
      token: boardScenario.token,
      path: boardScenario.path,
      surface: "board",
      surfaceTestId: boardScenario.surfaceTestId,
      nav: boardScenario.nav,
      focus: boardScenario.focus,
    }),
    ...roles.map((role) =>
      Object.freeze({
        id: role.id,
        role: role.id,
        token: role.token,
        path: role.path,
        surface: role.id,
        surfaceTestId: role.surfaceTestId,
        nav: role.nav,
        focus: role.focus,
      }),
    ),
    playerPrivateChannelRoute,
  ].flatMap((route) =>
    APP_ROUTE_STATE_CONTRACT.states.map((state) =>
      routeStateScenario({ route, state }),
    ),
  ),
);

function routeStateScenario({ route, state }) {
  const actionTestId = routeStateActionTestId(route.surface, state);
  return Object.freeze({
    id: `${route.id}-${state}`,
    role: route.role,
    token: route.token,
    surface: route.surface,
    state,
    path: routeStatePath(route.path, state),
    surfaceTestId: route.surfaceTestId,
    rootTestId: routeStateTestId(route.surface, state),
    statusTestId: routeStateStatusTestId(route.surface, state),
    actionTestId,
    statusState: state === "loading" ? "pending" : state,
    ariaLive: state === "reject" ? "assertive" : "polite",
    nav: route.nav,
    focus: routeStateFocusScenario({
      role: route,
      actionTestId,
    }),
  });
}

function scanStripTargets({
  contract,
  testIdFor,
  statusTestIdFor,
  states,
  staticStates = {},
}) {
  return Object.freeze({
    overlapTestIds: Object.freeze(contract.itemIds.map((id) => testIdFor(id))),
    statusRegions: Object.freeze(
      contract.itemIds.map((id) =>
        Object.freeze({
          testId: statusTestIdFor(id),
          state: states[id],
        }),
      ),
    ),
    staticStatusRegions: Object.freeze(
      contract.itemIds.map((id) =>
        Object.freeze({
          testId: statusTestIdFor(id),
          state: staticStates[id] ?? states[id],
        }),
      ),
    ),
  });
}

function routeStatePath(path, state) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${APP_ROUTE_STATE_CONTRACT.fixtureQueryParam}=${state}`;
}

function buildBoardSmokeScenario({ id, token, game }) {
  const session = resolveFixtureSession({ token, game });
  const data = buildBoardRouteData({
    principalUserId: session.principalUserId,
    capabilities: session.resolvedCapabilities,
    gameIndexPage: fixtureBoardGameIndexPage(game),
  });
  const actions = Object.freeze([
    ...data.board.games.flatMap((boardGame) =>
      boardGame.actions.map((action) =>
        boardActionScenario({
          testId: gameActionTestId(boardGame.id, action.id),
          action,
        }),
      ),
    ),
  ]);

  return Object.freeze({
    id,
    token,
    path: "/",
    surfaceTestId: BOARD_ROUTE_CONTRACT.surfaceTestId,
    requiredText: BOARD_ROUTE_CONTRACT.requiredText,
    nav: Object.freeze(
      navFromSurfaces(data.shell.surfaces),
    ),
    actions,
    focus: buildShellKeyboardOrder({
      shell: data.shell,
      contentTestIds: actions
        .filter((action) => action.navigation === "link")
        .map((action) => action.testId),
      forbiddenContentTestIds: actions
        .filter((action) => action.navigation === "blocked")
        .map((action) => action.testId),
    }),
  });
}

function shellForFixture({ token, game, activeSurface }) {
  const session = resolveFixtureSession({ token, game });
  return buildAppShell({
    game,
    activeSurface,
    principalUserId: session.principalUserId,
    capabilities: session.resolvedCapabilities,
  });
}

function navFromSurfaces(surfaces) {
  return Object.freeze(
    Object.fromEntries(
      surfaces.map((surface) => [surface.id, surface.navigation]),
    ),
  );
}

function roleFocusScenario({ shell, expectedAfterNav = [] }) {
  return buildShellKeyboardOrder({
    shell,
    contentTestIds: expectedAfterNav,
  });
}

function routeStateFocusScenario({ role, actionTestId }) {
  const linkedNavTestIds = navTestIds(role.nav, "link");
  return Object.freeze({
    skipLinkTestId: role.focus.skipLinkTestId,
    mainTargetTestId: role.focus.mainTargetTestId,
    linkedNavTestIds,
    expectedOrder: Object.freeze([
      role.focus.skipLinkTestId,
      ...linkedNavTestIds,
      actionTestId,
    ]),
    forbiddenTestIds: Object.freeze(navTestIds(role.nav, "blocked")),
  });
}

function navFocusCoverageForScenario({ id, path, nav, focus }) {
  return Object.freeze({
    id,
    path,
    navigation: nav,
    skipLinkTestId: focus.skipLinkTestId,
    mainTargetTestId: focus.mainTargetTestId,
    linkedNavTestIds: Object.freeze(navTestIds(nav, "link")),
    blockedNavTestIds: Object.freeze(navTestIds(nav, "blocked")),
    expectedFocusOrder: focus.expectedOrder,
    forbiddenFocusTestIds: focus.forbiddenTestIds,
  });
}

function navTestIds(nav, navigation) {
  return Object.entries(nav)
    .filter(([, value]) => value === navigation)
    .map(([surface]) => roleNavTestId(surface));
}

function boardActionScenario({ testId, action }) {
  return Object.freeze({
    testId,
    navigation: action.navigation,
    ...(action.navigation === "link"
      ? { hrefPath: action.href }
      : { blockedReason: action.blockedReason, blockedLabel: action.blockedLabel }),
  });
}

export const forbiddenRoutes = Object.freeze([
  Object.freeze({
    id: "admin-as-player",
    token: "fixture-player",
    path: "/admin",
    status: "403",
    message: adminForbiddenMessage(),
  }),
  Object.freeze({
    id: "moderator-as-player",
    token: "fixture-player",
    path: "/g/midsummer/host",
    status: "403",
    message: hostConsoleForbiddenMessage("midsummer"),
  }),
  Object.freeze({
    id: "player-signed-out",
    token: null,
    path: "/g/midsummer",
    status: "403",
    message: playerForbiddenMessage("midsummer"),
  }),
]);
