import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  APP_SHELL_CONTRACT,
  APP_NAVIGATION_PENDING_CONTRACT,
  BOARD_ROUTE_CONTRACT,
  buildNavigationPendingData,
  buildAppShell,
  buildBoardRouteData,
  fixtureBoardGameIndexPage,
  buildRouteErrorData,
  buildRouteLoadingData,
  buildShellKeyboardOrder,
  gameActionTestId,
  roleNavTestId,
  workbenchActionTestId,
} from "./app-shell-model.mjs";

test("app shell builds role navigation from resolved capabilities", () => {
  const shell = buildAppShell({
    game: "midsummer",
    activeSurface: "player",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      { kind: "HostOf", game: "other" },
    ],
    phase: { id: "N02", label: "Night 2" },
  });

  assert.equal(shell.sessionLabel, "@player_mira");
  assert.equal(shell.phase, "night");
  assert.equal(
    buildAppShell({ activeSurface: "board" }).phase,
    null,
  );
  assert.deepEqual(shell.session, {
    testId: "app-shell-session",
    principalTestId: "app-shell-session-principal",
    capabilityTestId: "app-shell-session-capabilities",
    gameTestId: "app-shell-session-game",
    state: "signed-in",
    href: "/auth/account/security",
    actionLabel: "Manage account security",
    principalLabel: "@player_mira",
    initials: "PM",
    contextLabel: "Playing midsummer",
    gameLabel: "midsummer",
    capabilityCount: 2,
    capabilityKinds: ["HostOf", "SlotOccupant"],
    capabilitySummary: "HostOf + SlotOccupant",
  });
  assert.deepEqual(
    shell.surfaces.map((surface) => surface.id),
    APP_SHELL_CONTRACT.surfaceOrder,
  );
  assert.equal(APP_SHELL_CONTRACT.component, "fm-app-shell");
  assert.equal(APP_SHELL_CONTRACT.navLabel, "Main navigation");
  assert.equal(APP_SHELL_CONTRACT.workspaceNavLabel, "Your workspaces");
  assert.equal(APP_SHELL_CONTRACT.skipLinkLabel, "Skip to app content");
  assert.equal(APP_SHELL_CONTRACT.skipLinkTestId, "app-shell-skip-link");
  assert.equal(APP_SHELL_CONTRACT.mainTargetId, "fm-main");
  assert.equal(APP_SHELL_CONTRACT.mainTargetTestId, "app-shell-main-target");
  assert.equal(APP_SHELL_CONTRACT.sessionTestId, "app-shell-session");
  assert.equal(APP_SHELL_CONTRACT.sessionPrincipalTestId, "app-shell-session-principal");
  assert.equal(APP_SHELL_CONTRACT.sessionCapabilityTestId, "app-shell-session-capabilities");
  assert.equal(APP_SHELL_CONTRACT.sessionGameTestId, "app-shell-session-game");
  assert.equal(APP_SHELL_CONTRACT.topbarTestId, "app-shell-topbar");
  assert.equal(APP_SHELL_CONTRACT.topbarMode, "compact-contextual-topbar");
  assert.equal(APP_SHELL_CONTRACT.topbarStickyTopPx, 0);
  assert.equal(APP_SHELL_CONTRACT.topbarBlockSizePx, 64);
  assert.equal(APP_SHELL_CONTRACT.stickyRailGapPx, 16);
  assert.equal(APP_SHELL_CONTRACT.minTouchTargetPx, 44);
  assert.deepEqual(
    shell.surfaces.map((surface) => [
      surface.id,
      surface.allowed,
      surface.testId,
      surface.minTouchTargetPx,
    ]),
    [
      ["board", true, "role-nav-board", 44],
      ["community", true, "role-nav-community", 44],
      ["search", true, "role-nav-search", 44],
      ["inbox", true, "role-nav-inbox", 44],
      ["player", true, "role-nav-player", 44],
      ["moderator", false, "role-nav-moderator", 44],
      ["admin", false, "role-nav-admin", 44],
    ],
  );
  assert.equal(roleNavTestId("moderator"), "role-nav-moderator");
  assert.equal(shell.surfaces[1].href, "/community");
  assert.equal(shell.surfaces[1].navigation, "link");
  assert.equal(shell.surfaces[2].href, "/search");
  assert.equal(shell.surfaces[3].href, "/inbox");
  assert.equal(shell.surfaces[4].href, "/g/midsummer");
  assert.equal(shell.surfaces[5].navigation, "blocked");
  assert.equal(shell.surfaces[5].ariaDisabled, "true");
  assert.equal(shell.surfaces[5].blockedReason, "Requires GlobalAdmin(midsummer) or GlobalMod(midsummer) or HostOf(midsummer) or CohostOf(midsummer)");
  assert.equal(shell.surfaces[6].navigation, "blocked");
});

test("app shell session summary models signed-out and multi-capability states", () => {
  const shell = buildAppShell({
    game: null,
    activeSurface: "board",
    capabilities: [
      { kind: "GlobalAdmin" },
      { kind: "HostOf", game: "midsummer" },
      { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      { kind: "SlotOccupant", game: "midsummer", slot: "slot-8" },
    ],
  });

  assert.equal(shell.sessionLabel, "Signed out");
  assert.deepEqual(shell.session, {
    testId: APP_SHELL_CONTRACT.sessionTestId,
    principalTestId: APP_SHELL_CONTRACT.sessionPrincipalTestId,
    capabilityTestId: APP_SHELL_CONTRACT.sessionCapabilityTestId,
    gameTestId: APP_SHELL_CONTRACT.sessionGameTestId,
    state: "signed-out",
    href: "/auth/login",
    actionLabel: "Sign in",
    principalLabel: "Signed out",
    initials: "?",
    contextLabel: "Site admin",
    gameLabel: "No game",
    capabilityCount: 4,
    capabilityKinds: ["GlobalAdmin", "HostOf", "SlotOccupant"],
    capabilitySummary: "GlobalAdmin + 2 roles",
  });
});

test("board route is an app surface with capability-gated role actions", () => {
  const data = buildBoardRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    gameIndexPage: fixtureBoardGameIndexPage("midsummer"),
  });

  assert.equal(data.shell.activeSurface, "board");
  assert.deepEqual(data.surfaceHeader, {
    component: "fm-surface-header",
    surface: "board",
    className: "fm-surface__masthead",
    eyebrowClassName: "fm-eyebrow",
    statusStackClassName: "fm-status-stack",
    eyebrow: "Board",
    title: "Games",
    summary: "Public active and completed games.",
    capability: { visible: false },
    liveStatus: { visible: false },
  });
  assert.equal(data.board.games[0].actions[0].href, "/games/midsummer");
  assert.equal(data.board.games[0].actions[0].navigation, "link");
  assert.equal(data.board.games[0].actions[1].href, "/g/midsummer");
  assert.equal(data.board.games[0].actions[1].navigation, "blocked");
  assert.equal(data.board.games[0].actions[2].href, "/moderation");
  assert.equal(data.board.games[0].actions[2].navigation, "link");
  assert.equal(BOARD_ROUTE_CONTRACT.surfaceTestId, "board-surface");
  assert.equal(BOARD_ROUTE_CONTRACT.requiredText, "Games");
  assert.equal(workbenchActionTestId("player"), "workbench-action-player");
  assert.equal(gameActionTestId("midsummer", "moderator"), "game-action-midsummer-moderator");
});

test("board actions block denied role transitions without links", () => {
  const data = buildBoardRouteData({
    principalUserId: "player_mira",
    capabilities: [{ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }],
    gameIndexPage: fixtureBoardGameIndexPage("midsummer"),
  });

  assert.deepEqual(
    data.board.games[0].actions.map((action) => [action.id, action.navigation]),
    [
      ["public-thread", "link"],
      ["player", "link"],
      ["moderator", "blocked"],
    ],
  );
  assert.equal(data.board.games[0].actions[2].ariaDisabled, "true");
});

test("shared shell keyboard order starts with skip link before allowed role navigation", () => {
  const shell = buildAppShell({
    game: "midsummer",
    activeSurface: "player",
    principalUserId: "player_mira",
    capabilities: [{ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }],
  });

  const focus = buildShellKeyboardOrder({
    shell,
    contentTestIds: ["player-command-submit"],
    forbiddenContentTestIds: ["moderator-command-trigger"],
  });

  assert.equal(focus.skipLinkTestId, APP_SHELL_CONTRACT.skipLinkTestId);
  assert.equal(focus.mainTargetTestId, APP_SHELL_CONTRACT.mainTargetTestId);
  assert.deepEqual(focus.linkedNavTestIds, ["role-nav-board", "role-nav-community", "role-nav-search", "role-nav-inbox", "role-nav-player"]);
  assert.deepEqual(focus.expectedOrder, [
    "app-shell-skip-link",
    "role-nav-board",
    "role-nav-community",
    "role-nav-search",
    "role-nav-inbox",
    "role-nav-player",
    "player-command-submit",
  ]);
  assert.deepEqual(focus.forbiddenTestIds, [
    "role-nav-moderator",
    "role-nav-admin",
    "moderator-command-trigger",
  ]);
  assert.throws(
    () => buildShellKeyboardOrder({ shell: null }),
    /app shell keyboard order requires shell surfaces/,
  );
  assert.throws(
    () => buildShellKeyboardOrder({ shell, contentTestIds: [null] }),
    /contentTestIds must be an array of test ids/,
  );
});

test("shared app CSS makes disabled touch actions visibly inert", async () => {
  const css = await readFile(new URL("../styles/app.css", import.meta.url), "utf8");

  assert.match(css, /:focus-visible\s*\{/);
  assert.match(css, /overscroll-behavior:\s*none/);
  assert.match(css, /overscroll-behavior:\s*contain/);
  assert.match(css, /outline:\s*3px solid var\(--fm-focus-ring\)/);
  assert.match(css, /outline-offset:\s*3px/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-right\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /env\(safe-area-inset-left\)/);
  assert.match(css, /--fm-app-topbar-block-size:\s*64px/);
  assert.match(css, /--fm-app-sticky-rail-gap:\s*16px/);
  assert.match(css, /\.fm-app-shell__topbar\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.fm-app-shell__topbar\s*\{[^}]*top:\s*env\(safe-area-inset-top\)/s);
  assert.match(css, /\.fm-app-shell__topbar\s*\{[^}]*min-block-size:\s*var\(--fm-app-topbar-block-size\)/s);
  assert.match(css, /\.fm-app-shell__topbar\s*\{[^}]*z-index:\s*11/s);
  assert.match(css, /\.fm-skip-link\s*\{/);
  assert.match(css, /min-block-size:\s*44px/);
  assert.match(css, /\.fm-skip-link:focus-visible\s*\{/);
  assert.match(css, /transform:\s*translateY\(0\)/);
  assert.match(
    css,
    /\.fm-touch-button\[aria-disabled="true"\],\s*\.fm-touch-button:disabled\s*\{/,
  );
  assert.match(css, /cursor:\s*not-allowed/);
  assert.match(css, /opacity:\s*0\.[0-9]+/);
  assert.match(css, /touch-action:\s*manipulation/);
  assert.match(css, /text-decoration:\s*none/);
  assert.match(css, /\.fm-sr-only\s*\{/);
  assert.match(css, /font-weight:\s*800/);
  assert.match(css, /\.fm-touch-button__reason\s*\{/);
  assert.match(css, /\.fm-touch-button__label,\s*\.fm-touch-button__reason\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.fm-navigation-pending\s*\{/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /min-block-size:\s*52px/);
  assert.match(css, /\.fm-navigation-pending__status\s*\{/);
});

test("route error state keeps failed paths inside the shared app shell", () => {
  const hostError = buildRouteErrorData({
    status: 403,
    message: "Host console for midsummer requires HostOf(midsummer).",
    path: "/g/midsummer/host",
  });

  assert.equal(hostError.shell.activeSurface, "moderator");
  assert.equal(hostError.shell.game, "midsummer");
  assert.equal(hostError.error.title, "Access blocked");
  assert.equal(hostError.error.actionHref, "/");
  assert.equal(
    hostError.error.message,
    "Host console for midsummer requires HostOf(midsummer).",
  );

  const adminError = buildRouteErrorData({
    status: 403,
    message: "Admin operations require GlobalAdmin or GlobalMod capability.",
    path: "/admin",
  });
  assert.equal(adminError.shell.activeSurface, "admin");
  assert.equal(adminError.shell.game, null);

  const playerError = buildRouteErrorData({
    status: 404,
    message: "missing game",
    path: "/g/midsummer",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
    ],
  });
  assert.equal(playerError.shell.activeSurface, "player");
  assert.equal(playerError.shell.session.principalLabel, "@player_mira");
  assert.equal(playerError.shell.session.capabilitySummary, "ChannelMember + SlotOccupant");
  assert.equal(playerError.shell.surfaces.find((surface) => surface.id === "player").navigation, "link");
  assert.equal(playerError.error.title, "Route not found");

  const privateChannelError = buildRouteErrorData({
    status: 403,
    message: "Channel private:role_pm:slot-7 is not visible.",
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    principalUserId: "player_mira",
    capabilities: [{ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }],
  });
  assert.equal(privateChannelError.shell.activeSurface, "player");
  assert.equal(privateChannelError.shell.game, "midsummer");
  assert.equal(privateChannelError.error.title, "Access blocked");
});

test("route loading state keeps target paths inside the shared app shell", () => {
  const boardLoading = buildRouteLoadingData({
    path: "/",
    principalUserId: "player_mira",
    capabilities: [{ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }],
  });
  assert.equal(boardLoading.shell.activeSurface, "board");
  assert.equal(boardLoading.shell.game, null);
  assert.equal(boardLoading.routeState.surface, "board");
  assert.equal(boardLoading.routeState.state, "loading");
  assert.equal(boardLoading.routeState.rootTestId, "route-state-board-loading");

  const privateChannelLoading = buildRouteLoadingData({
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
    ],
  });
  assert.equal(privateChannelLoading.path, "/g/midsummer/c/private%3Arole_pm%3Aslot-7");
  assert.equal(privateChannelLoading.shell.activeSurface, "player");
  assert.equal(privateChannelLoading.shell.game, "midsummer");
  assert.equal(privateChannelLoading.routeState.surface, "player");
  assert.equal(
    privateChannelLoading.shell.session.capabilitySummary,
    "ChannelMember + SlotOccupant",
  );

  const hostLoading = buildRouteLoadingData({ path: "/g/midsummer/host" });
  assert.equal(hostLoading.shell.activeSurface, "moderator");
  assert.equal(hostLoading.routeState.rootTestId, "route-state-moderator-loading");
});

test("navigation pending data exposes route-aware status without a duplicate shell", () => {
  assert.deepEqual(buildNavigationPendingData(), { visible: false });

  const pending = buildNavigationPendingData({
    path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
    ],
  });

  assert.equal(pending.visible, true);
  assert.equal(pending.component, APP_NAVIGATION_PENDING_CONTRACT.component);
  assert.equal(pending.rootTestId, APP_NAVIGATION_PENDING_CONTRACT.rootTestId);
  assert.equal(pending.statusTestId, APP_NAVIGATION_PENDING_CONTRACT.statusTestId);
  assert.equal(pending.label, APP_NAVIGATION_PENDING_CONTRACT.label);
  assert.equal(pending.path, "/g/midsummer/c/private%3Arole_pm%3Aslot-7");
  assert.equal(pending.surface, "player");
  assert.equal(pending.title, "Loading game surface");
  assert.equal(
    pending.message,
    "Fetching thread, channel, votecount, deadline, and private projection state.",
  );
  assert.equal(pending.activeNavTestId, "role-nav-player");
  assert.equal(pending.sessionPrincipal, "@player_mira");
  assert.equal(pending.capabilitySummary, "ChannelMember + SlotOccupant");
  assert.equal(pending.status.state, "pending");
  assert.equal(pending.status.testId, APP_NAVIGATION_PENDING_CONTRACT.statusTestId);
});
