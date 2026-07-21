import assert from "node:assert/strict";
import test from "node:test";
import { EXPECTED_COUNTS } from "./frontend_proof_expectations.mjs";
import {
  boardScenario,
  forbiddenRoutes,
  hostSetupScenario,
  navFocusCoverage,
  routeStateScenarios,
  roles,
  setupViewports,
  viewports,
} from "./frontend_role_smoke_scenarios.mjs";
import {
  APP_ROUTE_STATE_CONTRACT,
  routeStateActionTestId,
  routeStateStatusTestId,
  routeStateTestId,
} from "../frontend/src/lib/app/app-route-state-model.mjs";
import {
  APP_SHELL_CONTRACT,
  roleNavTestId,
} from "../frontend/src/lib/app/app-shell-model.mjs";

const expectedRoleIds = ["admin", "player", "moderator"];
const allowedStatusStates = new Set(["ack", "pending", "reject", "confirm"]);

test("role smoke scenario matrix covers tablet-first acceptance viewports", () => {
  assert.deepEqual(
    viewports.map((viewport) => [viewport.name, viewport.width, viewport.height]),
    [
      ["tablet", 1024, 768],
      ["tablet-wide", 1180, 820],
      ["tablet-landscape", 1280, 900],
      ["desktop", 1440, 920],
    ],
  );
  assert.equal(viewports.every(Object.isFrozen), true);
});

test("host setup scenario pins mobile stacking and workbench route identity", () => {
  assert.deepEqual(
    setupViewports.map((viewport) => [viewport.name, viewport.width, viewport.height]),
    [
      ["mobile", 390, 844],
      ["tablet", 1024, 768],
      ["desktop", 1440, 920],
    ],
  );
  assert.equal(setupViewports.every(Object.isFrozen), true);
  assert.deepEqual(hostSetupScenario, {
    id: "host-setup",
    role: "host-setup",
    token: "fixture-host",
    path: "/g/midsummer/setup",
    surfaceTestId: "host-setup-surface",
    capabilityTestId: "host-setup-capability",
    requiredText: "Setup still needs attention",
    slotIds: ["slot_1", "slot_2"],
  });
  assert.equal(Object.isFrozen(hostSetupScenario), true);
  assert.equal(Object.isFrozen(hostSetupScenario.slotIds), true);
});

test("board smoke scenario keeps allowed and blocked navigation explicit", () => {
  assert.equal(boardScenario.path, "/");
  assert.equal(boardScenario.surfaceTestId, "board-surface");
  assert.deepEqual(boardScenario.nav, {
    board: "link",
    community: "link",
    search: "link",
    inbox: "link",
    player: "link",
    moderator: "blocked",
    admin: "blocked",
  });
  assert.deepEqual(
    boardScenario.actions.map((action) => [action.testId, action.navigation]),
    [
      ["game-action-midsummer-public-thread", "link"],
      ["game-action-midsummer-player", "link"],
      ["game-action-midsummer-moderator", "blocked"],
      ["game-action-solstice-public-thread", "link"],
      ["game-action-solstice-player", "blocked"],
      ["game-action-solstice-moderator", "blocked"],
    ],
  );
  assert.deepEqual(
    boardScenario.actions
      .filter((action) => action.navigation === "link")
      .map((action) => action.hrefPath),
    ["/games/midsummer", "/g/midsummer", "/games/solstice"],
  );
  assert.deepEqual(
    boardScenario.actions
      .filter((action) => action.navigation === "blocked")
      .map((action) => [action.testId, action.blockedReason]),
    [
      [
        "game-action-midsummer-moderator",
        "Requires GlobalAdmin(midsummer) or GlobalMod(midsummer) or HostOf(midsummer) or CohostOf(midsummer)",
      ],
      ["game-action-solstice-player", "Requires SlotOccupant(solstice) or ChannelMember(solstice) or DeadViewer(solstice) or SpectatorOf(solstice)"],
      ["game-action-solstice-moderator", "Requires GlobalAdmin(solstice) or GlobalMod(solstice) or HostOf(solstice) or CohostOf(solstice)"],
    ],
  );
  assertFocusScenario(boardScenario.focus, "board");
  assertFocusMatchesNav(boardScenario.focus, boardScenario.nav, "board");
});

test("role smoke scenarios expose first-viewport, touch, status, and focus targets", () => {
  assert.deepEqual(
    roles.map((role) => role.id),
    expectedRoleIds,
  );

  for (const role of roles) {
    assert.equal(typeof role.path, "string");
    assert.match(role.path, /^\/(?:admin|g\/midsummer(?:\/host)?)$/);
    assert.equal(typeof role.surfaceTestId, "string");
    assert.equal(typeof role.capabilityTestId, "string");
    assert.equal(typeof role.requiredText, "string");
    assert.equal(role.requiredText.length > 0, true);
    assert.equal(typeof role.firstViewportSurface, "string");
    assert.equal(role.firstViewportSurface.length > 0, true);

    assert.equal(role.overlapTestIds.length >= 3, true);
    assertUnique(role.overlapTestIds, `${role.id} overlap test ids`);
    assertUnique(role.visibleTestIds, `${role.id} visible test ids`);
    assert.equal(
      role.overlapTestIds.every((testId) => role.visibleTestIds.includes(testId)),
      true,
    );

    assert.equal(role.statusRegions.length >= role.overlapTestIds.length, true);
    assertUnique(
      role.statusRegions.map((statusRegion) => statusRegion.testId),
      `${role.id} status test ids`,
    );
    for (const statusRegion of role.statusRegions) {
      assert.equal(allowedStatusStates.has(statusRegion.state), true);
    }

    assert.equal(role.touchSelectors.length > 0, true);
    assertUnique(role.touchSelectors, `${role.id} touch selectors`);
    assert.equal(role.thumbZones.length > 0, true);
    assertUnique(
      role.thumbZones.map((zone) => zone.testId),
      `${role.id} thumb-zone test ids`,
    );
    for (const zone of role.thumbZones) {
      assert.equal(typeof zone.testId, "string");
      assert.equal(typeof zone.zone, "string");
      assert.equal(Array.isArray(zone.targetSelectors), true);
      assert.equal(zone.targetSelectors.length > 0, true);
      assertUnique(zone.targetSelectors, `${role.id} ${zone.testId} target selectors`);
    }
    for (const link of role.linkAffordances ?? []) {
      assert.equal(typeof link.testId, "string");
      assert.equal(role.visibleTestIds.includes(link.testId), true);
      assert.match(link.hrefPath, /^\//);
      assert.equal(link.searchParams === undefined || typeof link.searchParams === "object", true);
    }
    assertRoleNav(role.nav, role.id);
    assertFocusMatchesNav(role.focus, role.nav, role.id);
    assertFocusScenario(role.focus, role.id);
  }
});

test("role smoke scenarios pin tablet thumb-zone target counts", () => {
  assert.deepEqual(
    roles.map((role) => [
      role.id,
      role.thumbZones.map((zone) => [
        zone.testId,
        zone.zone,
        zone.targetSelectors.length,
      ]),
    ]),
    [
      [
        "admin",
        [
          ["admin-setup-action-zone", "admin-setup-actions", 3],
          ["admin-recovery-action-zone", "admin-recovery-actions", 1],
        ],
      ],
      [
        "player",
        [["player-primary-action-zone", "player-primary-actions", 3]],
      ],
      [
        "moderator",
        [
          [
            "moderator-primary-action-zone",
            "moderator-primary-actions",
            EXPECTED_COUNTS.moderatorCriticalActions,
          ],
        ],
      ],
    ],
  );
});

test("nav focus coverage is shared across static and browser smoke evidence", () => {
  assert.deepEqual(
    navFocusCoverage.surfaces.map((surface) => surface.id),
    ["board", ...expectedRoleIds],
  );
  assert.equal(Object.isFrozen(navFocusCoverage.surfaces), true);

  const scenarioById = new Map([
    ["board", boardScenario],
    ...roles.map((role) => [role.id, role]),
  ]);
  for (const coverage of navFocusCoverage.surfaces) {
    const scenario = scenarioById.get(coverage.id);
    assert.notEqual(scenario, undefined);
    assert.equal(coverage.path, scenario.path);
    assert.deepEqual(coverage.navigation, scenario.nav);
    assert.deepEqual(coverage.expectedFocusOrder, scenario.focus.expectedOrder);
    assert.deepEqual(
      coverage.forbiddenFocusTestIds,
      scenario.focus.forbiddenTestIds,
    );
    assert.deepEqual(
      coverage.linkedNavTestIds,
      Object.entries(scenario.nav)
        .filter(([, navigation]) => navigation === "link")
        .map(([surface]) => roleNavTestId(surface)),
    );
    assert.deepEqual(
      coverage.blockedNavTestIds,
      Object.entries(scenario.nav)
        .filter(([, navigation]) => navigation === "blocked")
        .map(([surface]) => roleNavTestId(surface)),
    );
  }
});

test("route-state smoke scenarios cover every role and route state", () => {
  assert.deepEqual(
    routeStateScenarios.map((scenario) => [scenario.role, scenario.state]),
    [
      ...APP_ROUTE_STATE_CONTRACT.states.map((state) => ["board", state]),
      ...expectedRoleIds.flatMap((role) =>
        APP_ROUTE_STATE_CONTRACT.states.map((state) => [role, state]),
      ),
      ...APP_ROUTE_STATE_CONTRACT.states.map((state) => [
        "player-private-channel",
        state,
      ]),
    ],
  );
  assertUnique(
    routeStateScenarios.map((scenario) => scenario.id),
    "route-state scenario ids",
  );

  for (const scenario of routeStateScenarios) {
    assert.equal(APP_ROUTE_STATE_CONTRACT.surfaces.includes(scenario.surface), true);
    assert.equal(scenario.path.includes(APP_ROUTE_STATE_CONTRACT.fixtureQueryParam), true);
    assert.equal(scenario.rootTestId, routeStateTestId(scenario.surface, scenario.state));
    assert.equal(
      scenario.statusTestId,
      routeStateStatusTestId(scenario.surface, scenario.state),
    );
    assert.equal(
      scenario.actionTestId,
      routeStateActionTestId(scenario.surface, scenario.state),
    );
    assert.equal(
      scenario.statusState,
      scenario.state === "loading" ? "pending" : scenario.state,
    );
    assert.equal(
      scenario.ariaLive,
      scenario.state === "reject" ? "assertive" : "polite",
    );
    assertRoleNav(scenario.nav, scenario.surface);
    assertFocusScenario(scenario.focus, scenario.id);
    assertFocusMatchesNav(scenario.focus, scenario.nav, scenario.id);
    assert.equal(
      scenario.focus.expectedOrder.includes(scenario.actionTestId),
      true,
      `${scenario.id} route-state action must be keyboard reachable`,
    );
  }
});

test("forbidden route scenarios cover denied admin, moderator, and signed-out player paths", () => {
  assert.deepEqual(
    forbiddenRoutes.map((route) => [route.id, route.path, route.status]),
    [
      ["admin-as-player", "/admin", "403"],
      ["moderator-as-player", "/g/midsummer/host", "403"],
      ["player-signed-out", "/g/midsummer", "403"],
    ],
  );

  assertUnique(
    forbiddenRoutes.map((route) => route.id),
    "forbidden route ids",
  );
  for (const route of forbiddenRoutes) {
    assert.equal(typeof route.message, "string");
    assert.equal(route.message.length > 16, true);
  }
});

function assertRoleNav(nav, roleId) {
  assert.deepEqual(Object.keys(nav).sort(), ["admin", "board", "community", "inbox", "moderator", "player", "search"]);
  assert.equal(nav.board, "link");
  assert.equal(nav.community, "link");
  assert.equal(nav.search, "link");
  assert.equal(nav[roleId], "link");
  assert.equal(Object.values(nav).includes("blocked"), true);
  for (const navigation of Object.values(nav)) {
    assert.equal(navigation === "link" || navigation === "blocked", true);
  }
}

function assertFocusScenario(focus, label) {
  assert.equal(focus.expectedOrder.length > 0, true, `${label} focus order is empty`);
  assert.equal(
    focus.expectedOrder[0],
    APP_SHELL_CONTRACT.skipLinkTestId,
    `${label} focus order must start with shell skip link`,
  );
  assert.equal(
    focus.skipLinkTestId,
    APP_SHELL_CONTRACT.skipLinkTestId,
    `${label} focus metadata must name the shell skip link`,
  );
  assert.equal(
    focus.mainTargetTestId,
    APP_SHELL_CONTRACT.mainTargetTestId,
    `${label} focus metadata must name the shell main target`,
  );
  assertUnique(focus.expectedOrder, `${label} focus order`);
  assertUnique(focus.forbiddenTestIds, `${label} forbidden focus ids`);
  assert.equal(
    focus.forbiddenTestIds.includes(APP_SHELL_CONTRACT.skipLinkTestId),
    false,
    `${label} skip link must not be forbidden`,
  );
  for (const forbiddenTestId of focus.forbiddenTestIds) {
    assert.equal(
      focus.expectedOrder.includes(forbiddenTestId),
      false,
      `${label} forbidden target is focusable: ${forbiddenTestId}`,
    );
  }
}

function assertFocusMatchesNav(focus, nav, label) {
  const linkedNav = Object.entries(nav)
    .filter(([, navigation]) => navigation === "link")
    .map(([surface]) => roleNavTestId(surface));
  const blockedNav = Object.entries(nav)
    .filter(([, navigation]) => navigation === "blocked")
    .map(([surface]) => roleNavTestId(surface));

  assert.deepEqual(
    focus.expectedOrder.slice(1, 1 + linkedNav.length),
    linkedNav,
    `${label} linked role nav focus order must follow shell order after skip link`,
  );
  for (const testId of blockedNav) {
    assert.equal(
      focus.forbiddenTestIds.includes(testId),
      true,
      `${label} blocked role nav must be forbidden: ${testId}`,
    );
  }
}

function assertUnique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}
