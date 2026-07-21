import { roleNavTestId } from "../frontend/src/lib/app/app-shell-model.mjs";

// Single source for the rich per-command-scenario definitions. Each entry is
// the superset of fields any proof lane needs; the `lanes` array is the one
// intentional tripwire that governs which lanes a scenario runs in. The two
// generators (the in-app-browser interaction page and the no-bind interaction
// smoke) and the role-smoke artifact contract all DERIVE their per-lane
// scenario lists from this array through the projections below, so a scenario's
// id, render function, targets, form, route, media, and lane membership are
// declared exactly once.
//
// Moderator critical-host confirmations are NOT listed here: they are already
// single-sourced from MODERATOR_CRITICAL_ACTION_IDS in
// frontend_proof_expectations.mjs and appended by each consumer.
//
// The rendered-result fields a lane observes but does not declare (e.g. a
// no-bind entry's media.renderedVariant, or route.activeChannelCurrent) stay in
// the artifact contract as oracle checks; the generator proves them by real
// rendering, so they are deliberately not part of this definition manifest.
const MIN_TOUCH_TARGET_PX = 44;

export const COMMAND_SCENARIOS = Object.freeze([
  {
    id: "admin-cohost-confirm-click",
    role: "admin",
    render: "renderAdminSetupConfirmation",
    lanes: ["iab", "no-bind"],
    targetSelector: '[data-testid="admin-command-confirm-cohost"]',
    targetTestId: "admin-command-confirm-cohost",
    rootSelector: '[data-testid="admin-setup-cohost"]',
    expectedText: "Delegate @cohost_c as cohost",
  },
  {
    id: "admin-session-grant-confirm-click",
    role: "admin",
    render: "renderAdminSetupConfirmation",
    lanes: ["iab", "no-bind"],
    targetSelector: '[data-testid="admin-command-confirm-session-grants"]',
    targetTestId: "admin-command-confirm-session-grants",
    rootSelector: '[data-testid="admin-setup-session-grants"]',
    expectedText: "Grant community moderator access",
    form: {
      action: "?/grantSession",
      noBind: "testIds",
      fields: [
        { name: "token", value: "session-grant-midsummer", testId: "admin-session-grant-token" },
        { name: "principalUserId", value: "mod_a", testId: "admin-session-grant-principal" },
        { name: "expiresAt", value: "4102444800", testId: "admin-session-grant-expires-at" },
        { name: "globalCapability", value: "GlobalMod", testId: "admin-session-grant-global-mod" },
      ],
    },
    focusContract: {
      initialFocusTestId: "admin-command-confirm-session-grants",
      returnFocusTestId: "admin-command-trigger-session-grants",
      tabContainment: "local-confirmation-controls",
    },
  },
  {
    id: "admin-recovery-gate-confirm-click",
    role: "admin",
    render: "renderAdminRecoveryConfirmation",
    lanes: ["iab", "no-bind"],
    targetSelector: '[data-testid="admin-recovery-confirm-recovery-gate"]',
    targetTestId: "admin-recovery-confirm-recovery-gate",
    rootSelector: '[data-testid="admin-recovery-recovery-gate"]',
    expectedText: "Run check",
    form: {
      action: "?/checkRecoveryGate",
      noBind: "names",
      fields: [
        { name: "game", value: "midsummer" },
        { name: "principalUserId", value: "admin_a" },
      ],
    },
    focusContract: {
      initialFocusTestId: "admin-recovery-confirm-recovery-gate",
      returnFocusTestId: "admin-recovery-trigger-recovery-gate",
      tabContainment: "local-confirmation-controls",
    },
  },
  {
    id: "player-submit-vote-click",
    role: "player",
    render: "renderPlayerSurface",
    lanes: ["iab", "no-bind"],
    targetSelector: '[data-action="submit_vote"]',
    targetAction: "submit_vote",
    rootSelector: '[data-testid="player-surface"]',
    expectedText: "Full votecount",
  },
  {
    id: "player-submit-post-click",
    role: "player",
    render: "renderPlayerSurface",
    lanes: ["iab", "no-bind"],
    targetSelector: '[data-action="submit_post"]',
    targetAction: "submit_post",
    rootSelector: '[data-testid="player-surface"]',
    expectedText: "Post",
    media: {
      boundaryTestId: "thread-post-media-boundary-442",
      mediaTestId: "thread-post-media-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      expectedVariant: "tablet",
    },
  },
  {
    id: "player-private-channel-submit-post-click",
    role: "player",
    render: "renderPlayerPrivateChannelRoute",
    lanes: ["iab", "no-bind"],
    targetSelector: '[data-action="submit_post"]',
    targetAction: "submit_post",
    rootSelector: '[data-testid="player-surface"]',
    expectedText: "Post",
    route: {
      path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      activeChannelTestId: "player-channel-private:role_pm:slot-7",
      activeChannelHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      privateReviewHref: "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1",
    },
    media: {
      boundaryTestId: "thread-post-media-boundary-442",
      mediaTestId: "thread-post-media-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      expectedVariant: "tablet",
    },
  },
  {
    id: "player-action-target-pick-confirm-click",
    role: "player",
    render: "renderPlayerActionTargetConfirmation",
    lanes: ["iab", "no-bind"],
    targetSelector: '[data-testid="player-action-confirm-factional_kill"]',
    targetTestId: "player-action-confirm-factional_kill",
    rootSelector: '[data-testid="player-action-confirmation-factional_kill"]',
    expectedText: "factional_kill -> slot-2",
    focusContract: {
      initialFocusTestId: "player-action-confirm-factional_kill",
      returnFocusTestId: "player-action-trigger-factional_kill",
      tabContainment: "local-confirmation-controls",
    },
  },
  {
    id: "player-action-withdraw-confirm-click",
    role: "player",
    render: "renderPlayerActionWithdrawConfirmation",
    lanes: ["iab", "no-bind"],
    targetSelector: '[data-testid="player-action-withdraw-confirm-factional_kill"]',
    targetTestId: "player-action-withdraw-confirm-factional_kill",
    rootSelector: '[data-testid="player-action-withdraw-confirmation-factional_kill"]',
    expectedText: "withdraws your submitted factional_kill action",
    focusContract: {
      initialFocusTestId: "player-action-withdraw-confirm-factional_kill",
      returnFocusTestId: "player-action-withdraw-factional_kill",
      tabContainment: "local-confirmation-controls",
    },
  },
  {
    id: "route-error-back-to-board-click",
    role: "player",
    render: "renderRouteErrorSurface",
    lanes: ["iab"],
    targetSelector: '[data-testid="route-error-action"]',
    targetTestId: "route-error-action",
    expectedText: "Back to board",
    errorSurface: {
      path: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      status: 403,
      surfaceTestId: "route-error-surface",
      panelTestId: "route-error-panel",
      actionHref: "/",
      activeNavTestId: roleNavTestId("player"),
      sessionPrincipal: "player_mira",
      capabilitySummary: "ChannelMember + SlotOccupant",
    },
  },
]);

export const COMMAND_SCENARIO_IDS = Object.freeze(
  COMMAND_SCENARIOS.map((scenario) => scenario.id),
);

export function commandScenariosForLane(lane) {
  return COMMAND_SCENARIOS.filter((scenario) => scenario.lanes.includes(lane));
}

function baseDef(scenario) {
  const def = {
    id: scenario.id,
    role: scenario.role,
    render: scenario.render,
    targetSelector: scenario.targetSelector,
  };
  if (scenario.targetTestId !== undefined) {
    def.targetTestId = scenario.targetTestId;
  }
  if (scenario.targetAction !== undefined) {
    def.targetAction = scenario.targetAction;
  }
  return def;
}

// Projection for tools/frontend_in_app_browser_interaction_page.mjs. The
// generator spreads the rendered fragment (html/head) onto each of these.
export function iabCommandScenarioDefs() {
  return commandScenariosForLane("iab").map((scenario) => {
    const def = baseDef(scenario);
    def.expectedText = scenario.expectedText;
    def.minTouchTargetPx = MIN_TOUCH_TARGET_PX;
    if (scenario.form) {
      def.form = {
        action: scenario.form.action,
        fields: Object.fromEntries(
          scenario.form.fields.map((field) => [field.name, field.value]),
        ),
      };
    }
    if (scenario.focusContract) {
      def.focusContract = scenario.focusContract;
    }
    if (scenario.route) {
      def.route = scenario.route;
    }
    if (scenario.errorSurface) {
      def.errorSurface = scenario.errorSurface;
    }
    return def;
  });
}

// Projection for tools/frontend_no_bind_interaction_smoke.mjs.
export function noBindCommandScenarioDefs() {
  return commandScenariosForLane("no-bind").map((scenario) => {
    const def = baseDef(scenario);
    def.rootSelector = scenario.rootSelector;
    def.expectedText = scenario.expectedText;
    def.minTouchTargetPx = MIN_TOUCH_TARGET_PX;
    if (scenario.form) {
      def.form =
        scenario.form.noBind === "testIds"
          ? {
              action: scenario.form.action,
              fieldTestIds: scenario.form.fields.map((field) => field.testId),
            }
          : {
              action: scenario.form.action,
              fieldNames: scenario.form.fields.map((field) => field.name),
            };
    }
    if (scenario.route) {
      def.route = scenario.route;
    }
    if (scenario.media) {
      def.media = scenario.media;
    }
    return def;
  });
}
