import { resolveSurfaceAccess } from "./capabilities.mjs";
import { phaseThemeKey } from "./phase-theme.mjs";
import { buildAppSurfaceHeaderViewModel } from "./app-surface-header-model.mjs";
import { buildRouteStateViewModel } from "./app-route-state-model.mjs";

export const APP_SHELL_CONTRACT = Object.freeze({
  component: "fm-app-shell",
  navLabel: "Role surfaces",
  skipLinkLabel: "Skip to app content",
  skipLinkTestId: "app-shell-skip-link",
  mainTargetId: "fm-main",
  mainTargetTestId: "app-shell-main-target",
  sessionTestId: "app-shell-session",
  sessionPrincipalTestId: "app-shell-session-principal",
  sessionCapabilityTestId: "app-shell-session-capabilities",
  sessionGameTestId: "app-shell-session-game",
  topbarTestId: "app-shell-topbar",
  topbarMode: "sticky-safe-area-role-session-topbar",
  topbarStickyTopPx: 0,
  topbarBlockSizePx: 76,
  stickyRailGapPx: 22,
  surfaceOrder: Object.freeze(["board", "player", "moderator", "admin"]),
  navTestIdPrefix: "role-nav",
  minTouchTargetPx: 44,
});

export const BOARD_ROUTE_CONTRACT = Object.freeze({
  surfaceTestId: "board-surface",
  requiredText: "Active games",
});

export const APP_NAVIGATION_PENDING_CONTRACT = Object.freeze({
  component: "fm-navigation-pending",
  rootTestId: "app-navigation-pending",
  statusTestId: "app-navigation-pending-status",
  label: "Route loading",
});

export function roleNavTestId(id) {
  return `${APP_SHELL_CONTRACT.navTestIdPrefix}-${id}`;
}

export function workbenchActionTestId(id) {
  return `workbench-action-${id}`;
}

export function gameActionTestId(game, id) {
  return `game-action-${game}-${id}`;
}

export function buildAppShell({
  game = null,
  activeSurface,
  principalUserId = null,
  capabilities = [],
  phase = null,
}) {
  const session = buildSessionSummary({
    game,
    principalUserId,
    capabilities,
  });

  const surfaces = Object.freeze([
    surfaceItem({
      id: "board",
      label: "Board",
      href: "/",
      active: activeSurface === "board",
      allowed: true,
      capabilityLabel: "Public",
    }),
    surfaceItem({
      id: "player",
      label: "Play",
      href: game === null ? "/" : `/g/${encodeURIComponent(game)}`,
      active: activeSurface === "player",
      ...surfaceSummary({ surface: "player", game, capabilities }),
    }),
    surfaceItem({
      id: "moderator",
      label: "Moderate",
      href: game === null ? "/" : `/g/${encodeURIComponent(game)}/host`,
      active: activeSurface === "moderator",
      ...surfaceSummary({ surface: "moderator", game, capabilities }),
    }),
    surfaceItem({
      id: "admin",
      label: "Admin",
      href: "/admin",
      active: activeSurface === "admin",
      ...surfaceSummary({ surface: "admin", game: null, capabilities }),
    }),
  ]);

  return Object.freeze({
    activeSurface,
    game,
    phase: phaseThemeKey(phase),
    session,
    sessionLabel: session.principalLabel,
    surfaces,
  });
}

export function buildBoardRouteData({
  principalUserId = null,
  capabilities = [],
  game = "midsummer",
} = {}) {
  const shell = buildAppShell({
    game,
    activeSurface: "board",
    principalUserId,
    capabilities,
  });

  return Object.freeze({
    shell,
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "board",
      eyebrow: "Board",
      title: "Active games",
      summary: "Active games, role queues, and proof-linked operation paths.",
    }),
    board: Object.freeze({
      label: "Active games",
      games: Object.freeze([
        Object.freeze({
          id: game,
          title: "Midsummer Invitational",
          phase: "Day 2",
          deadline: "Jun 19, 9:00 PM PT",
          activity: "14 new posts",
          actions: Object.freeze([
            boardAction(shell, {
              surface: "player",
              label: "Play",
              primary: true,
            }),
            boardAction(shell, {
              surface: "moderator",
              label: "Moderate",
            }),
          ]),
        }),
      ]),
    }),
    workbench: Object.freeze([
      Object.freeze({
        id: "player",
        label: "Player queue",
        value: "Vote pressure live",
        action: boardAction(shell, { surface: "player", label: "Open" }),
      }),
      Object.freeze({
        id: "moderator",
        label: "Moderator queue",
        value: "Replacement pending",
        action: boardAction(shell, { surface: "moderator", label: "Open" }),
      }),
      Object.freeze({
        id: "admin",
        label: "Admin queue",
        value: "Proof runs ready",
        action: boardAction(shell, { surface: "admin", label: "Open" }),
      }),
    ]),
  });
}

export function buildShellKeyboardOrder({
  shell,
  contentTestIds = [],
  forbiddenContentTestIds = [],
}) {
  if (shell === null || typeof shell !== "object" || !Array.isArray(shell.surfaces)) {
    throw new TypeError("app shell keyboard order requires shell surfaces");
  }
  assertTestIdArray(contentTestIds, "contentTestIds");
  assertTestIdArray(forbiddenContentTestIds, "forbiddenContentTestIds");

  const linkedNavTestIds = shell.surfaces
    .filter((surface) => surface.navigation === "link")
    .map((surface) => surface.testId);
  const blockedNavTestIds = shell.surfaces
    .filter((surface) => surface.navigation === "blocked")
    .map((surface) => surface.testId);

  return Object.freeze({
    skipLinkTestId: APP_SHELL_CONTRACT.skipLinkTestId,
    mainTargetTestId: APP_SHELL_CONTRACT.mainTargetTestId,
    linkedNavTestIds: Object.freeze(linkedNavTestIds),
    expectedOrder: Object.freeze([
      APP_SHELL_CONTRACT.skipLinkTestId,
      ...linkedNavTestIds,
      ...contentTestIds,
    ]),
    forbiddenTestIds: Object.freeze([
      ...blockedNavTestIds,
      ...forbiddenContentTestIds,
    ]),
  });
}

export function buildRouteErrorData({
  status = 500,
  message = "The requested surface is unavailable.",
  path = "/",
  principalUserId = null,
  capabilities = [],
} = {}) {
  const route = classifyRoutePath(path);
  const shell = buildAppShell({
    game: route.game,
    activeSurface: route.activeSurface,
    principalUserId,
    capabilities,
  });

  return Object.freeze({
    shell,
    error: Object.freeze({
      status: Number(status),
      title: errorTitle(status),
      message: String(message ?? "The requested surface is unavailable."),
      path: route.path,
      actionHref: "/",
      actionLabel: "Back to board",
    }),
  });
}

export function buildRouteLoadingData({
  path = "/",
  principalUserId = null,
  capabilities = [],
} = {}) {
  const route = classifyRoutePath(path);
  const shell = buildAppShell({
    game: route.game,
    activeSurface: route.activeSurface,
    principalUserId,
    capabilities,
  });

  return Object.freeze({
    shell,
    routeState: buildRouteStateViewModel({
      surface: route.activeSurface,
      state: "loading",
    }),
    path: route.path,
  });
}

export function buildNavigationPendingData({
  path = null,
  principalUserId = null,
  capabilities = [],
} = {}) {
  if (path === null || path === undefined) {
    return Object.freeze({ visible: false });
  }

  const loading = buildRouteLoadingData({
    path,
    principalUserId,
    capabilities,
  });

  return Object.freeze({
    visible: true,
    component: APP_NAVIGATION_PENDING_CONTRACT.component,
    rootTestId: APP_NAVIGATION_PENDING_CONTRACT.rootTestId,
    statusTestId: APP_NAVIGATION_PENDING_CONTRACT.statusTestId,
    label: APP_NAVIGATION_PENDING_CONTRACT.label,
    path: loading.path,
    surface: loading.routeState.surface,
    title: loading.routeState.title,
    message: loading.routeState.message,
    activeNavTestId: roleNavTestId(loading.routeState.surface),
    sessionPrincipal: loading.shell.session.principalLabel,
    capabilitySummary: loading.shell.session.capabilitySummary,
    status: Object.freeze({
      ...loading.routeState.status,
      testId: APP_NAVIGATION_PENDING_CONTRACT.statusTestId,
    }),
  });
}

function surfaceSummary({ surface, game, capabilities }) {
  const access = resolveSurfaceAccess({ surface, game, capabilities });
  return {
    allowed: access.allowed,
    capabilityLabel: access.capabilityLabel ?? access.required.join(" or "),
  };
}

function buildSessionSummary({ game, principalUserId, capabilities }) {
  const normalizedCapabilities = Array.isArray(capabilities) ? capabilities : [];
  const capabilityKinds = Object.freeze(
    [...new Set(
      normalizedCapabilities
        .map((capability) =>
          typeof capability?.kind === "string" ? capability.kind.trim() : "",
        )
        .filter((kind) => kind.length > 0),
    )].sort(),
  );
  const principalLabel =
    principalUserId === null || principalUserId === undefined
      ? "Signed out"
      : String(principalUserId);

  return Object.freeze({
    testId: APP_SHELL_CONTRACT.sessionTestId,
    principalTestId: APP_SHELL_CONTRACT.sessionPrincipalTestId,
    capabilityTestId: APP_SHELL_CONTRACT.sessionCapabilityTestId,
    gameTestId: APP_SHELL_CONTRACT.sessionGameTestId,
    state:
      principalUserId === null || principalUserId === undefined
        ? "signed-out"
        : "signed-in",
    principalLabel,
    gameLabel: game === null || game === undefined ? "No game" : String(game),
    capabilityCount: normalizedCapabilities.length,
    capabilityKinds,
    capabilitySummary: summarizeCapabilityKinds(capabilityKinds),
  });
}

function summarizeCapabilityKinds(capabilityKinds) {
  if (capabilityKinds.length === 0) {
    return "No capabilities";
  }
  if (capabilityKinds.length <= 2) {
    return capabilityKinds.join(" + ");
  }
  return `${capabilityKinds[0]} + ${capabilityKinds.length - 1} roles`;
}

const NAV_ACCESS_LABELS = Object.freeze({
  board: "Public",
  player: "Your seat",
  moderator: "Your console",
  admin: "Operator access",
});

const NAV_BLOCKED_LABELS = Object.freeze({
  player: "Players only",
  moderator: "Hosts only",
  admin: "Operators only",
});

export function navBlockedLabel(surfaceId) {
  return NAV_BLOCKED_LABELS[surfaceId] ?? "Not open to you";
}

function surfaceItem(item) {
  const allowed = item.allowed !== false;
  return Object.freeze({
    ...item,
    testId: roleNavTestId(item.id),
    minTouchTargetPx: APP_SHELL_CONTRACT.minTouchTargetPx,
    navigation: allowed ? "link" : "blocked",
    ariaDisabled: allowed ? undefined : "true",
    blockedReason: allowed ? null : `Requires ${item.capabilityLabel}`,
    blockedLabel: allowed ? null : NAV_BLOCKED_LABELS[item.id] ?? "Not open to you",
    accessLabel: NAV_ACCESS_LABELS[item.id] ?? item.capabilityLabel,
  });
}

function boardAction(shell, { surface, label, primary = false }) {
  const surfaceItem = shell.surfaces.find((item) => item.id === surface);
  if (surfaceItem === undefined) {
    throw new TypeError(`unknown board surface action: ${surface}`);
  }
  return Object.freeze({
    id: surfaceItem.id,
    label,
    href: surfaceItem.href,
    allowed: surfaceItem.allowed,
    navigation: surfaceItem.navigation,
    ariaDisabled: surfaceItem.ariaDisabled,
    blockedReason: surfaceItem.blockedReason,
    blockedLabel: surfaceItem.blockedLabel,
    capabilityLabel: surfaceItem.capabilityLabel,
    className: primary
      ? "fm-touch-button"
      : "fm-touch-button fm-touch-button--secondary",
  });
}

function assertTestIdArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError(`${label} must be an array of test ids`);
  }
}

function classifyRoutePath(path) {
  const normalizedPath =
    typeof path === "string" && path.startsWith("/") ? path : "/";
  const gameMatch = normalizedPath.match(/^\/g\/([^/]+)(?:\/(host|c\/[^/]+))?\/?$/);
  if (normalizedPath.startsWith("/admin")) {
    return Object.freeze({
      path: normalizedPath,
      activeSurface: "admin",
      game: null,
    });
  }
  if (gameMatch !== null && gameMatch[2] === "host") {
    return Object.freeze({
      path: normalizedPath,
      activeSurface: "moderator",
      game: decodeURIComponent(gameMatch[1]),
    });
  }
  if (gameMatch !== null) {
    return Object.freeze({
      path: normalizedPath,
      activeSurface: "player",
      game: decodeURIComponent(gameMatch[1]),
    });
  }
  return Object.freeze({
    path: normalizedPath,
    activeSurface: "board",
    game: null,
  });
}

function errorTitle(status) {
  if (Number(status) === 403) {
    return "Access blocked";
  }
  if (Number(status) === 404) {
    return "Route not found";
  }
  return "Route unavailable";
}
