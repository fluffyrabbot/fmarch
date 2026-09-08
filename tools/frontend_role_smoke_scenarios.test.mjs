import assert from "node:assert/strict";
import test from "node:test";
import { EXPECTED_COUNTS } from "./frontend_proof_expectations.mjs";
import {
  accessibilitySurfaceContract,
  boardScenario,
  forbiddenRoutes,
  hostSetupScenario,
  navFocusCoverage,
  publicGameScenario,
  publicationViewports,
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
import {
  DURABLE_READING_CHECKPOINT_INITIALIZATION_TIMEOUT_MS,
  DURABLE_READING_CHECKPOINT_RESTORE_TIMEOUT_MS,
  initializeReadingCheckpointClientsSequentially,
  waitForReadingCheckpointRestoration,
} from "./frontend_role_smoke_reliability.mjs";

const expectedRoleIds = ["admin", "player", "moderator"];
const allowedStatusStates = new Set(["ack", "pending", "reject", "confirm"]);

test("durable reading checkpoint clients complete navigation and restoration serially", async () => {
  const events = [];
  const position = { source_seq: 20, offset_px: 110 };
  const page = label => ({
    async waitForFunction(predicate, expected, options) {
      events.push(`${label}:restore`);
      assert.match(predicate.toString(), /document\.activeElement/);
      assert.match(predicate.toString(), /getBoundingClientRect/);
      assert.deepEqual(expected, {
        sourceSeq: position.source_seq,
        offsetPx: position.offset_px,
        tolerancePx: 2,
        verifyOffset: true,
      });
      assert.deepEqual(options, { timeout: DURABLE_READING_CHECKPOINT_INITIALIZATION_TIMEOUT_MS });
    },
  });
  const primary = page("primary");
  const peer = page("peer");

  await initializeReadingCheckpointClientsSequentially({
    clients: [{ label: "primary", page: primary }, { label: "peer", page: peer }],
    navigate: async (_page, { label, timeout }) => {
      events.push(`${label}:navigate`);
      assert.equal(timeout, DURABLE_READING_CHECKPOINT_INITIALIZATION_TIMEOUT_MS);
    },
    position,
  });

  assert.deepEqual(events, [
    "primary:navigate",
    "primary:restore",
    "peer:navigate",
    "peer:restore",
  ]);
});

test("durable reading checkpoint restoration timeout reports browser and harness state", async () => {
  const cause = new Error("Timeout 30000ms exceeded");
  const page = {
    async waitForFunction() { throw cause; },
    async evaluate(_capture, expected) {
      assert.deepEqual(expected, { source_seq: 42, offset_px: 96 });
      return {
        active: { id: "player-thread" },
        document: { readyState: "complete", visibilityState: "visible" },
        expectedPost: null,
        recovery: { ariaBusy: "true", text: "Restoring your place" },
        url: "http://127.0.0.1/g/midsummer?checkpoint-proof=ready",
      };
    },
  };

  await assert.rejects(
    waitForReadingCheckpointRestoration(page, {
      diagnosticContext: () => ({ checkpointReads: { primary: 1, peer: 1 }, writes: 0 }),
      phase: "remote-resume:peer",
      position: { source_seq: 42, offset_px: 96 },
    }),
    error => {
      assert.equal(error.cause, cause);
      assert.match(error.message, /durable reading checkpoint phase failed/);
      assert.match(error.message, /"phase":"remote-resume:peer"/);
      assert.match(error.message, /"expected":\{"source_seq":42,"offset_px":96\}/);
      assert.match(error.message, /"active":\{"id":"player-thread"\}/);
      assert.match(error.message, /"checkpointReads":\{"primary":1,"peer":1\}/);
      assert.match(error.message, new RegExp(`"timeoutMs":${DURABLE_READING_CHECKPOINT_RESTORE_TIMEOUT_MS}`));
      assert.match(error.message, /"verifyOffset":true/);
      return true;
    },
  );
});

test("durable reading checkpoint focus-only phases retain their narrower contract", async () => {
  let expectation;
  const page = {
    async waitForFunction(_predicate, value, options) {
      expectation = { options, value };
    },
  };

  await waitForReadingCheckpointRestoration(page, {
    phase: "history-forward-repeat:peer",
    position: { source_seq: 42, offset_px: 96 },
    verifyOffset: false,
  });

  assert.deepEqual(expectation, {
    options: { timeout: DURABLE_READING_CHECKPOINT_RESTORE_TIMEOUT_MS },
    value: { sourceSeq: 42, offsetPx: 96, tolerancePx: 2, verifyOffset: false },
  });
});

test("durable reading checkpoint navigation failure stops before the next client", async () => {
  const events = [];
  const cause = new Error("navigation stalled");
  const primary = {
    async evaluate() {
      events.push("primary:diagnostics");
      return { document: { readyState: "interactive" }, url: "about:blank" };
    },
  };

  await assert.rejects(
    initializeReadingCheckpointClientsSequentially({
      clients: [{ label: "primary", page: primary }, { label: "peer", page: {} }],
      navigate: async (_page, { label }) => {
        events.push(`${label}:navigate`);
        throw cause;
      },
      position: { source_seq: 20, offset_px: 110 },
    }),
    error => {
      assert.equal(error.cause, cause);
      assert.match(error.message, /"phase":"initial-navigation:primary"/);
      return true;
    },
  );
  assert.deepEqual(events, ["primary:navigate", "primary:diagnostics"]);
});

test("role smoke scenario matrix covers tablet-first acceptance viewports", () => {
  assert.deepEqual(
    viewports.map((viewport) => [viewport.name, viewport.width, viewport.height]),
    [
      ["mobile", 390, 844],
      ["tablet", 1024, 768],
      ["tablet-wide", 1180, 820],
      ["tablet-landscape", 1280, 900],
      ["desktop", 1440, 920],
    ],
  );
  assert.equal(viewports.every(Object.isFrozen), true);
});

test("public game scenario pins publication density across responsive viewports", () => {
  assert.deepEqual(
    publicationViewports.map((viewport) => [viewport.name, viewport.width, viewport.height]),
    [["mobile", 390, 844], ["tablet", 1024, 768], ["desktop", 1440, 920]],
  );
  assert.equal(publicGameScenario.publicationMode, "reading-publication");
  assert.deepEqual(publicGameScenario.postIds, [42, 41]);
  assert.deepEqual(publicGameScenario.threadStartBudgetPx, {
    mobile: 420,
    tablet: 380,
    desktop: 390,
  });
  assert.equal(publicGameScenario.maxReadingMeasurePx, 760);
});

test("accessibility surface contract models 200 percent reflow and user media preferences", () => {
  assert.deepEqual(accessibilitySurfaceContract.viewport, {
    name: "desktop-200-percent-reflow",
    width: 720,
    height: 450,
    equivalentBaseWidth: 1440,
    zoomPercent: 200,
  });
  assert.deepEqual(accessibilitySurfaceContract.media, {
    reducedMotion: "reduce",
    forcedColors: "active",
  });
  assert.equal(accessibilitySurfaceContract.admin.selectedTaskId, "recovery:recovery-gate");
  assert.equal(accessibilitySurfaceContract.admin.selectionMode, "url-addressable-roving-tablist");
  assert.equal(accessibilitySurfaceContract.publication.readingHeadingId, "public-game-thread-title");
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
    requiredText: "Setup workflow",
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

    assert.equal(Array.isArray(role.statusRegions), true);
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
          ["admin-setup-action-zone", "admin-setup-actions", 2],
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
            3,
          ],
        ],
      ],
    ],
  );
});

test("role smoke pins collapsed support and mobile first-viewport budgets", () => {
  const expected = {
    admin: {
      primaryActionSelector: '[data-testid="admin-command-trigger-create-game"]',
      maxPrimaryActionBottomViewportRatio: 1,
      maxDocumentHeightViewportRatio: 2.6,
    },
    player: {
      primaryActionSelector: '[data-action="submit_vote"]',
      maxPrimaryActionBottomViewportRatio: 1,
      maxDocumentHeightViewportRatio: 3.5,
    },
    moderator: {
      primaryActionSelector:
        '[data-testid="critical-host-action-extend_deadline"] [data-testid="critical-host-action-trigger"]',
      maxPrimaryActionBottomViewportRatio: 1,
      maxDocumentHeightViewportRatio: 2.5,
    },
  };

  for (const role of roles) {
    assert.deepEqual(role.mobileViewportBudget, expected[role.id]);
    assert.equal(role.closedByDefault.length > 0, true);
    assert.equal(Object.isFrozen(role.closedByDefault), true);
    assert.equal(Object.isFrozen(role.mobileViewportBudget), true);
  }
});

test("role smoke pins confirmation and feedback geometry budgets", () => {
  for (const role of roles) {
    const budget = role.interactionGeometryBudget;
    assert.equal(Object.isFrozen(budget), true);
    assert.notEqual(budget.feedback, undefined);
    for (const phase of Object.values(budget)) {
      assert.equal(Object.isFrozen(phase), true);
      assert.equal(typeof phase.anchorSelector, "string");
      assert.equal(typeof phase.targetSelector, "string");
      assert.equal(phase.maxAnchorShiftPx <= 1, true);
      assert.equal(phase.maxCombinedSpanViewportRatio <= 1, true);
      assert.equal(phase.maxDocumentGrowthViewportRatio <= 0.75, true);
    }
  }
});

test("role smoke pins post-command scroll focus and announcement budgets", () => {
  for (const role of roles) {
    const budget = role.commandContinuityBudget;
    assert.equal(Object.isFrozen(budget), true);
    assert.equal(typeof budget.beforeFocusSelector, "string");
    assert.equal(typeof budget.afterFocusSelector, "string");
    assert.equal(typeof budget.statusSelector, "string");
    assert.equal(budget.maxScrollDeltaPx <= 1, true);
    assert.equal(budget.maxAnnouncementLatencyMs <= 500, true);
    assert.equal(budget.maxFocusSettleMs <= 500, true);
    assert.equal(budget.maxVisualViewportDeltaPx <= 1, true);
    assert.equal(typeof budget.inputBoundary, "string");
  }
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
