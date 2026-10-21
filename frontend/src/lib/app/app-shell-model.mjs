import { normalizeCapabilities, resolveSurfaceAccess } from "./capabilities.mjs";
import { canonicalPhaseId, phaseLabelFromId } from "../phase-id.mjs";
import { phaseThemeKey } from "./phase-theme.mjs";

import { buildAppSurfaceHeaderViewModel } from "./app-surface-header-model.mjs";
import { buildRouteStateViewModel } from "./app-route-state-model.mjs";
import { packLabel } from "./presentation-copy.mjs";
import { buildViewerPresentation } from "./viewer-presentation-model.mjs";

export const APP_SHELL_CONTRACT = Object.freeze({
  component: "fm-app-shell",
  navLabel: "Main navigation",
  workspaceNavLabel: "Your workspaces",
  skipLinkLabel: "Skip to app content",
  skipLinkTestId: "app-shell-skip-link",
  mainTargetId: "fm-main",
  mainTargetTestId: "app-shell-main-target",
  sessionTestId: "app-shell-session",
  sessionViewerTestId: "app-shell-session-viewer",
  sessionCapabilityTestId: "app-shell-session-capabilities",
  sessionGameTestId: "app-shell-session-game",
  topbarTestId: "app-shell-topbar",
  topbarMode: "compact-contextual-topbar",
  topbarStickyTopPx: 0,
  topbarBlockSizePx: 64,
  stickyRailGapPx: 16,
  surfaceOrder: Object.freeze(["board", "community", "inbox", "search", "player", "moderator", "admin"]),
  navTestIdPrefix: "role-nav",
  minTouchTargetPx: 44,
});

export const BOARD_ROUTE_CONTRACT = Object.freeze({
  surfaceTestId: "board-surface",
  requiredText: "Games",
  indexTestId: "board-game-index",
  emptyTestId: "board-game-index-empty",
  unavailableTestId: "board-game-index-unavailable",
  olderTestId: "board-game-index-older",
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
  principalId = null,
  viewerProfile = null,
  capabilities = [],
  phase = null,
}) {
  const hasCommunityModeration = Array.isArray(capabilities)
    && capabilities.some((capability) =>
      capability?.kind === "GlobalAdmin" || capability?.kind === "GlobalMod");
  const session = buildSessionSummary({
    game,
    principalId,
    viewerProfile,
    capabilities,
  });

  const surfaces = Object.freeze([
    surfaceItem({
      id: "board",
      label: "Games",
      href: "/",
      active: activeSurface === "board",
      allowed: true,
      group: "primary",
    }),
    surfaceItem({
      id: "community",
      label: "Community",
      href: "/community",
      active: activeSurface === "community",
      allowed: true,
      group: "primary",
    }),
    surfaceItem({
      id: "search",
      label: "Search",
      href: "/search",
      active: activeSurface === "search",
      allowed: true,
      group: "primary",
    }),
    surfaceItem({
      id: "inbox",
      label: "Inbox",
      href: "/inbox",
      active: activeSurface === "inbox",
      allowed: typeof principalId === "string" && principalId.trim() !== "",
      group: "primary",
    }),
    surfaceItem({
      id: "player",
      label: "Play",
      href: game === null ? "/" : `/g/${encodeURIComponent(game)}`,
      active: activeSurface === "player",
      ...surfaceSummary({ surface: "player", game, capabilities }),
      group: "workspace",
    }),
    surfaceItem({
      id: "moderator",
      label: hasCommunityModeration ? "Moderate" : "Host",
      href: hasCommunityModeration
        ? "/moderation"
        : game === null ? "/" : `/g/${encodeURIComponent(game)}/host`,
      active: activeSurface === "moderator",
      ...surfaceSummary({ surface: "moderator", game, capabilities }),
      group: "workspace",
    }),
    surfaceItem({
      id: "admin",
      label: "Admin",
      href: "/admin",
      active: activeSurface === "admin",
      ...surfaceSummary({ surface: "admin", game: null, capabilities }),
      group: "workspace",
    }),
  ]);

  return Object.freeze({
    activeSurface,
    game,
    phaseId: canonicalPhaseId(phase?.id),
    session,
    sessionLabel: session.viewerLabel,
    surfaces: Object.freeze(
      [...surfaces].sort(
        (a, b) =>
          APP_SHELL_CONTRACT.surfaceOrder.indexOf(a.id) -
          APP_SHELL_CONTRACT.surfaceOrder.indexOf(b.id),
      ),
    ),
  });
}

// Route loaders own surface/access state, while the root layout owns the
// viewer summary that is shared across surfaces. Re-presenting the shell here
// keeps a social profile optional without making public profile data part of
// the authority/session model.
export function applyViewerPresentationToShell(
  shell,
  { principalId = null, viewerProfile = null } = {},
) {
  if (shell === null || typeof shell !== "object" || shell.session === null || typeof shell.session !== "object") {
    return shell;
  }
  const session = withViewerPresentation(
    shell.session,
    buildViewerPresentation({ principalId, profile: viewerProfile }),
  );
  return Object.freeze({
    ...shell,
    session,
    sessionLabel: session.viewerLabel,
  });
}

export function buildBoardRouteData({
  principalId = null,
  viewerProfile = null,
  capabilities = [],
  gameIndexPage = null,
} = {}) {
  const board = normalizeBoardGameIndexPage(gameIndexPage);
  const game = preferredBoardGame({ capabilities });
  const shell = buildAppShell({
    game,
    activeSurface: "board",
    principalId,
    viewerProfile,
    capabilities,
  });

  return Object.freeze({
    shell,
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "board",
      eyebrow: "Board",
      title: "Games",
      summary: "Public active and completed games.",
    }),
    board: Object.freeze({
      ...board,
      games: Object.freeze(
        board.games.map((entry) => boardGameCard({ entry, capabilities })),
      ),
    }),
  });
}

export function normalizeBoardGameIndexPage(page) {
  if (page === null || typeof page !== "object") {
    return Object.freeze({
      status: "unavailable",
      games: Object.freeze([]),
      nextCursor: null,
      olderHref: null,
    });
  }
  const sourceGames = Array.isArray(page.games) ? page.games : [];
  const games = sourceGames
    .map((entry) => normalizeBoardGameIndexEntry(entry))
    .filter(Boolean);
  const nextCursor = nonemptyString(page.next_cursor, page.nextCursor);
  return Object.freeze({
    status: "ready",
    games: Object.freeze(games),
    nextCursor,
    olderHref:
      nextCursor === null ? null : `/?cursor=${encodeURIComponent(nextCursor)}`,
  });
}

export function fixtureBoardGameIndexPage(game = "midsummer") {
  return Object.freeze({
    games: Object.freeze([
      Object.freeze({
        game,
        pack: "mafiascum",
        status: "active",
        phase_id: "D02",
        deadline: 1781841600,
        seats_filled: 7,
        seats_total: 13,
        host_name: "Rowan",
        updated_seq: 2,
        completed_seq: null,
      }),
      Object.freeze({
        game: "solstice",
        pack: "mafia_universe",
        status: "completed",
        phase_id: "D01",
        deadline: null,
        seats_filled: 13,
        seats_total: 13,
        host_name: "Juniper",
        updated_seq: 1,
        completed_seq: 1,
      }),
    ]),
    next_cursor: null,
  });
}

function normalizeBoardGameIndexEntry(entry) {
  const id = nonemptyString(entry?.game, entry?.id);
  const pack = nonemptyString(entry?.pack);
  const status = nonemptyString(entry?.status);
  if (id === null || pack === null || !["active", "completed"].includes(status)) {
    return null;
  }
  const phaseId = canonicalPhaseId(entry?.phase_id);
  return Object.freeze({
    id,
    pack,
    title: entry.origin_topic?.title ?? `${packLabel(pack)} game`,
    deadline: Number.isFinite(entry.deadline) ? new Date(entry.deadline * 1000).toISOString() : null,
    seatsFilled: Number.isInteger(entry.seats_filled) ? entry.seats_filled : null,
    seatsTotal: Number.isInteger(entry.seats_total) ? entry.seats_total : null,
    hostName: entry.host_name ?? null,
    signupLabel: status === 'completed' ? 'Signups closed' : phaseId ? 'Game in progress' : 'Preparing to start',
    status,
    statusLabel: status === "active" ? "Active" : "Completed",
    phaseId,
    // Presentation key for phase chips: derived from the canonical id only.
    phaseKind: status === "completed" ? "completed" : phaseThemeKey(phaseId) ?? "waiting",
    phaseLabel:
      status === "completed"
        ? "Completed"
        : phaseId === null
          ? "Awaiting first phase"
          : phaseLabelFromId(phaseId),
  });
}

// A card's actions are only the ones the viewer can take, primary first:
// Play for an occupant, Host for a host, and Read for everyone.
function boardGameCard({ entry, capabilities }) {
  const scoped = normalizeCapabilities(capabilities).filter((cap) => cap.game === entry.id);
  const playing = scoped.some((cap) => cap.kind === "SlotOccupant");
  const hosting = scoped.some((cap) => cap.kind === "HostOf" || cap.kind === "CohostOf");
  const game = encodeURIComponent(entry.id);
  const actions = [
    ...(playing ? [{ id: "player", label: "Play", href: `/g/${game}` }] : []),
    ...(hosting ? [{ id: "moderator", label: "Host", href: `/g/${game}/host` }] : []),
    { id: "public-thread", label: "Read", href: `/games/${game}` },
  ];
  return Object.freeze({
    ...entry,
    relation: playing ? "You're playing" : hosting ? "You're hosting" : null,
    relationKind: playing || hosting ? "mine" : "none",
    // Paw pips stay legible only for ordinary table sizes; larger games show the count alone.
    seatPips:
      Number.isInteger(entry.seatsFilled) && Number.isInteger(entry.seatsTotal) &&
      entry.seatsTotal > 0 && entry.seatsTotal <= 16
        ? Object.freeze(Array.from({ length: entry.seatsTotal }, (_, index) => index < entry.seatsFilled))
        : null,
    actions: Object.freeze(
      actions.map((action, index) =>
        Object.freeze({
          ...action,
          className:
            index === 0 ? "fm-touch-button" : "fm-touch-button fm-touch-button--secondary",
        }),
      ),
    ),
  });
}

function preferredBoardGame({ capabilities }) {
  const normalized = normalizeCapabilities(capabilities);
  const capabilityGame = normalized.find((capability) => typeof capability.game === "string")
    ?.game;
  return capabilityGame ?? null;
}


function nonemptyString(...values) {
  return values.find((value) => typeof value === "string" && value.trim() !== "") ?? null;
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
    .filter((surface) => surface.navigation === "link" && surface.group === "primary" && !["player", "moderator"].includes(shell.activeSurface))
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
      "account-menu-toggle",
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
  principalId = null,
  viewerProfile = null,
  capabilities = [],
} = {}) {
  const route = classifyRoutePath(path);
  const shell = buildAppShell({
    game: route.game,
    activeSurface: route.activeSurface,
    principalId,
    viewerProfile,
    capabilities,
  });

  return Object.freeze({
    shell,
    error: Object.freeze({
      status: Number(status),
      title: errorTitle(status),
      message: Number(status) === 403
        ? "You do not have access to this page. Return to Games to choose an available game."
        : Number(status) === 404
          ? "This page could not be found. Return to Games to continue."
          : "This page could not be loaded. Try again, or return to Games.",
      path: route.path,
      actionHref: "/",
      actionLabel: "Back to Games",
    }),
  });
}

export function buildRouteLoadingData({
  path = "/",
  principalId = null,
  viewerProfile = null,
  capabilities = [],
} = {}) {
  const route = classifyRoutePath(path);
  const shell = buildAppShell({
    game: route.game,
    activeSurface: route.activeSurface,
    principalId,
    viewerProfile,
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
  principalId = null,
  viewerProfile = null,
  capabilities = [],
} = {}) {
  if (path === null || path === undefined) {
    return Object.freeze({ visible: false });
  }

  const loading = buildRouteLoadingData({
    path,
    principalId,
    viewerProfile,
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
    sessionViewer: loading.shell.session.viewerLabel,
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
    capability: access.capability,
  };
}

function buildSessionSummary({ game, principalId, viewerProfile, capabilities }) {
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
  return withViewerPresentation({
    testId: APP_SHELL_CONTRACT.sessionTestId,
    viewerTestId: APP_SHELL_CONTRACT.sessionViewerTestId,
    capabilityTestId: APP_SHELL_CONTRACT.sessionCapabilityTestId,
    gameTestId: APP_SHELL_CONTRACT.sessionGameTestId,
    gameLabel: game === null || game === undefined ? "No game" : String(game),
    capabilityCount: normalizedCapabilities.length,
    capabilityKinds,
    capabilitySummary: summarizeCapabilityKinds(capabilityKinds),
  }, buildViewerPresentation({ principalId, profile: viewerProfile }));
}

function withViewerPresentation(session, viewer) {
  return Object.freeze({
    ...session,
    state: viewer.state,
    href: viewer.state === "signed-out" ? "/auth/login" : "/auth/account/security",
    actionLabel:
      viewer.state === "signed-out" ? "Sign in" : "Manage account security",
    viewer,
    viewerLabel: viewer.label,
    initials: viewer.initials,
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

// Surfaces the viewer cannot use stay in the model as "blocked" so keyboard
// and smoke contracts can assert their absence; nothing renders them.
function surfaceItem(item) {
  const allowed = item.allowed !== false;
  return Object.freeze({
    ...item,
    testId: roleNavTestId(item.id),
    minTouchTargetPx: APP_SHELL_CONTRACT.minTouchTargetPx,
    navigation: allowed ? "link" : "blocked",
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
  if (normalizedPath.startsWith("/moderation")) {
    return Object.freeze({
      path: normalizedPath,
      activeSurface: "moderator",
      game: null,
    });
  }
  if (normalizedPath.startsWith("/inbox")) {
    return Object.freeze({
      path: normalizedPath,
      activeSurface: "inbox",
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
