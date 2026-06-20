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
  gameActionTestId,
  roleNavTestId,
  workbenchActionTestId,
} from "../frontend/src/lib/app/app-shell-model.mjs";
import {
  resolveFixtureSession,
} from "../frontend/src/lib/server/session-capabilities.mjs";
import {
  ADMIN_ROUTE_CONTRACT,
  adminForbiddenMessage,
} from "../frontend/src/routes/admin/admin-route-model.mjs";
import {
  PLAYER_ROUTE_CONTRACT,
  playerForbiddenMessage,
} from "../frontend/src/routes/g/[game]/game-route-model.mjs";
import {
  HOST_CONSOLE_ROUTE_CONTRACT,
  hostConsoleForbiddenMessage,
} from "../frontend/src/routes/g/[game]/host/host-route-model.mjs";
import {
  ADMIN_READINESS_STRIP_CONTRACT,
  adminReadinessStatusTestId,
  adminReadinessTestId,
} from "../frontend/src/lib/components/admin/admin-surface-model.mjs";
import {
  HOST_OPERATIONS_STRIP_CONTRACT,
  hostOperationStatusTestId,
  hostOperationTestId,
} from "../frontend/src/lib/components/host-action/host-operations-strip.mjs";
import {
  PLAYER_POSTURE_STRIP_CONTRACT,
  playerPostureStatusTestId,
  playerPostureTestId,
} from "../frontend/src/lib/components/player-posture/player-posture-strip-model.mjs";

export const viewports = Object.freeze([
  Object.freeze({ name: "tablet", width: 1024, height: 768 }),
  Object.freeze({ name: "tablet-wide", width: 1180, height: 820 }),
  Object.freeze({ name: "tablet-landscape", width: 1280, height: 900 }),
  Object.freeze({ name: "desktop", width: 1440, height: 920 }),
]);

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
    audit: "ack",
    recovery: "pending",
  },
});

const playerPostureTargets = scanStripTargets({
  contract: PLAYER_POSTURE_STRIP_CONTRACT,
  testIdFor: playerPostureTestId,
  statusTestIdFor: playerPostureStatusTestId,
  states: {
    channel: "ack",
    thread: "pending",
    votecount: "ack",
    private: "pending",
  },
});

const hostOperationTargets = scanStripTargets({
  contract: HOST_OPERATIONS_STRIP_CONTRACT,
  testIdFor: hostOperationTestId,
  statusTestIdFor: hostOperationStatusTestId,
  states: {
    phase: "pending",
    votecount: "ack",
    prompts: "pending",
    lifecycle: "pending",
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
  path: "/g/midsummer/c/role-pm",
  surface: "player",
  surfaceTestId: PLAYER_ROUTE_CONTRACT.surfaceTestId,
  nav: playerNav,
  focus: roleFocusScenario({
    shell: playerShell,
    expectedAfterNav: [
      "player-channel-main",
      "player-channel-role-pm",
      "player-thread-load-older",
    ],
  }),
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
    touchSelectors: [
      '[data-testid="admin-setup-create-game"] button',
      '[data-testid="admin-boundary-session-grants"]',
      '[data-testid="admin-audit-link-proof-runs"]',
      '[data-testid="admin-recovery-recovery-gate"] button',
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
      "admin-audit-boundary-proof-runs",
      "admin-audit-evidence-proof-runs",
    ],
    overlapTestIds: adminReadinessTargets.overlapTestIds,
    statusRegions: [
      ...adminReadinessTargets.statusRegions,
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
  }),
  Object.freeze({
    id: "player",
    token: "fixture-player",
    path: "/g/midsummer",
    surfaceTestId: PLAYER_ROUTE_CONTRACT.surfaceTestId,
    firstViewportSurface: PLAYER_POSTURE_STRIP_CONTRACT.surface,
    capabilityTestId: PLAYER_ROUTE_CONTRACT.capabilityTestId,
    requiredText: PLAYER_ROUTE_CONTRACT.requiredText,
    statusTestId: PLAYER_ROUTE_CONTRACT.liveStatusTestId,
    visibleTestIds: [
      ...playerPostureTargets.overlapTestIds,
      "player-votecount-deadline",
      "player-thread-pager",
      "player-private-boundary",
      "player-private-review-notification-1",
      "player-private-link-notification-1",
      "player-private-review-investigation-1",
      "player-private-link-investigation-1",
    ],
    overlapTestIds: playerPostureTargets.overlapTestIds,
    statusRegions: playerPostureTargets.statusRegions,
    touchSelectors: [
      '[data-testid="player-channel-main"]',
      '[data-testid="player-thread-load-older"]',
      '[data-testid="player-composer"] button',
      '[data-testid="player-private-link-notification-1"]',
    ],
    thumbZones: Object.freeze([
      Object.freeze({
        testId: "player-primary-action-zone",
        zone: "player-primary-actions",
        targetSelectors: Object.freeze([
          '[data-action="submit_vote"]',
          '[data-action="withdraw_vote"]',
          '[data-action="submit_post"]',
        ]),
      }),
    ]),
    nav: playerNav,
    focus: roleFocusScenario({
      shell: playerShell,
      expectedAfterNav: [
        "player-channel-main",
        "player-channel-role-pm",
        "player-thread-load-older",
      ],
    }),
  }),
  Object.freeze({
    id: "moderator",
    token: "fixture-host",
    path: "/g/midsummer/host",
    surfaceTestId: HOST_CONSOLE_ROUTE_CONTRACT.surfaceTestId,
    firstViewportSurface: HOST_OPERATIONS_STRIP_CONTRACT.surface,
    capabilityTestId: HOST_CONSOLE_ROUTE_CONTRACT.capabilityTestId,
    requiredText: HOST_CONSOLE_ROUTE_CONTRACT.requiredText,
    statusTestId: HOST_CONSOLE_ROUTE_CONTRACT.liveStatusTestId,
    visibleTestIds: hostOperationTargets.overlapTestIds,
    overlapTestIds: hostOperationTargets.overlapTestIds,
    statusRegions: hostOperationTargets.statusRegions,
    touchSelectors: [
      '[data-testid="critical-host-action-extend_deadline"] [data-testid="critical-host-action-trigger"]',
      '[data-testid="critical-host-action-lock_thread"] [data-testid="critical-host-action-trigger"]',
      '[data-testid="critical-host-action-advance_phase"] [data-testid="critical-host-action-trigger"]',
      '[data-testid="critical-host-action-publish_votecount"] [data-testid="critical-host-action-trigger"]',
      '[data-testid="critical-host-action-modkill_slot"] [data-testid="critical-host-action-trigger"]',
      '[data-testid="critical-host-action-complete_game"] [data-testid="critical-host-action-trigger"]',
      '[data-testid="critical-host-action-resolve_host_prompt-D01-skip_next_day-slot_1"] [data-testid="critical-host-action-trigger"]',
      '[data-testid="host-console-votecount-row-slot-2_Ilya"]',
      '[data-testid="moderator-control-phase"]',
      '[data-testid="moderator-control-roles"]',
    ],
    thumbZones: Object.freeze([
      Object.freeze({
        testId: "moderator-primary-action-zone",
        zone: "moderator-primary-actions",
        targetSelectors: Object.freeze([
          '[data-testid="critical-host-action-extend_deadline"] [data-testid="critical-host-action-trigger"]',
          '[data-testid="critical-host-action-process_replacement"] [data-testid="critical-host-action-trigger"]',
          '[data-testid="critical-host-action-lock_thread"] [data-testid="critical-host-action-trigger"]',
          '[data-testid="critical-host-action-unlock_thread"] [data-testid="critical-host-action-trigger"]',
          '[data-testid="critical-host-action-advance_phase"] [data-testid="critical-host-action-trigger"]',
          '[data-testid="critical-host-action-publish_votecount"] [data-testid="critical-host-action-trigger"]',
          '[data-testid="critical-host-action-mark_dead"] [data-testid="critical-host-action-trigger"]',
          '[data-testid="critical-host-action-modkill_slot"] [data-testid="critical-host-action-trigger"]',
          '[data-testid="critical-host-action-complete_game"] [data-testid="critical-host-action-trigger"]',
          '[data-testid="critical-host-action-resolve_host_prompt-D01-skip_next_day-slot_1"] [data-testid="critical-host-action-trigger"]',
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

function scanStripTargets({ contract, testIdFor, statusTestIdFor, states }) {
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
  });
}

function routeStatePath(path, state) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${APP_ROUTE_STATE_CONTRACT.fixtureQueryParam}=${state}`;
}

function buildBoardSmokeScenario({ id, token, game }) {
  const session = resolveFixtureSession({ token, game });
  const data = buildBoardRouteData({
    game,
    principalUserId: session.principalUserId,
    capabilities: session.resolvedCapabilities,
  });
  const actions = Object.freeze([
    ...data.workbench.map((item) =>
      boardActionScenario({
        testId: workbenchActionTestId(item.id),
        action: item.action,
      }),
    ),
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
    ...(action.navigation === "link" ? { hrefPath: action.href } : {}),
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
