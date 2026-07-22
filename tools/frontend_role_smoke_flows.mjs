// Data tables that drive the role-smoke browser lane. A new feature proof
// should extend these tables (and the scenario module) instead of adding
// bespoke code to tools/frontend_role_smoke.mjs.

// Step types the runner's flow executor implements. Interaction types may
// also appear inside restartSteps.
export const flowStepTypes = Object.freeze([
  "capture-geometry-baseline",
  "click",
  "fill",
  "wait-visible",
  "wait-data-state",
  "assert-data-state-now",
  "assert-visible-box",
  "assert-post-geometry",
  "screenshot",
  "assert-confirmation-focus",
  "assert-hit-target",
  "assert-status-region",
  "assert-form-contract",
  "assert-focused",
  "dispatch-command",
  "capture-pending-state",
  "capture-interrupted-recovery",
  "assert-command-continuity",
  "assert-command-activity",
  "assert-command-receipt",
  "hook",
  "find-request-command",
  "capture-text",
  "read-attr",
  "read-text",
  "set-from-value",
  "set-result",
]);

export const flowRestartStepTypes = Object.freeze(["click", "fill", "wait-visible"]);

// Hook names the runner registers for steps that read page globals or run
// bespoke sub-proofs that are not worth expressing as generic steps.
export const flowHookNames = Object.freeze([
  "moderatorHostPromptAck",
  "moderatorSlotLifecycleAck",
  "playerMediaNetwork",
  "playerLiveThreadEmit",
  "playerPrivateDisclosure",
  "adminAuditDetail",
]);

// Network harnesses installed per role before the page loads.
export const roleHarnesses = Object.freeze({
  player: Object.freeze(["playerMedia", "liveProjection"]),
});

// Post-screenshot link-click proofs per role, run after the role surface
// screenshot is captured.
export const linkClickProofHooks = Object.freeze({
  admin: Object.freeze(["adminAuditDetail"]),
});

// Roles whose surface carries the once-per-run phase ground contrast proof.
export const phaseContrastRoles = Object.freeze(["moderator"]);

export const commandMockScenarios = Object.freeze([
  Object.freeze({
    command: "ResolveHostPrompt",
    respond: Object.freeze({
      kind: "Ack",
      body: Object.freeze({ stream_seqs: Object.freeze([91]) }),
    }),
    effects: Object.freeze([Object.freeze({ set: "hostPromptPending", value: false })]),
  }),
  Object.freeze({
    command: "SetSlotStatus",
    respond: Object.freeze({
      kind: "Ack",
      body: Object.freeze({ stream_seqs: Object.freeze([73]) }),
    }),
    effects: Object.freeze([Object.freeze({ set: "slotStatus", fromCommandField: "status" })]),
  }),
  Object.freeze({
    command: "SubmitPost",
    respond: Object.freeze({
      kind: "Ack",
      body: Object.freeze({ stream_seqs: Object.freeze([72]) }),
    }),
  }),
]);

export const commandMockFallback = Object.freeze({
  status: 409,
  id: Object.freeze({ literal: 1 }),
  respond: Object.freeze({
    kind: "Reject",
    body: Object.freeze({
      error: "StreamConflict",
      retryable: true,
      message: "reload and retry",
    }),
  }),
});

export function createRoleMockState() {
  return {
    slotStatus: "alive",
    hostPromptPending: true,
  };
}

export const mockStateProjections = Object.freeze({
  hostConsoleState(state) {
    return {
      phase: {
        phase_id: "D01",
        locked: false,
        deadline: 1782000000,
      },
      slots: [
        {
          slot_id: "slot-7",
          occupant_user_id: "player-mira",
          status: state.slotStatus,
          alive: state.slotStatus === "alive",
        },
      ],
      thread_posts: [
        {
          author_slot: "slot-7",
        },
      ],
    };
  },
  hostPrompts(state) {
    return state.hostPromptPending
      ? [
          {
            id: "D01:skip_next_day:slot_1",
            label: "skip_next_day",
            status: "pending",
            decisionKind: "acknowledge",
          },
        ]
      : [];
  },
});

// Installed in array order; Playwright matches the most recently registered
// route first, so the paginated thread entry must stay last to shadow the
// generic thread entry, which passes paginated requests through to it.
export const fixtureApiRoutes = Object.freeze([
  Object.freeze({
    pattern: "**/live/tickets?*",
    body: Object.freeze({
      url: "/ws?ticket=fmarch-smoke-ticket&audience=fmarch-live",
      expires_at: 4_102_444_800,
    }),
  }),
  Object.freeze({
    pattern: "**/games/*/thread?*",
    passthroughWhen: Object.freeze({ urlIncludes: "before_seq=" }),
    body: Object.freeze({
      next_before_seq: 440,
      posts: [
        {
          source_seq: 445,
          stream_seq: 92,
          author_slot: "slot-7",
          author_user: "Mira",
          body: "Browser smoke refreshed player post.",
          occurred_at: 1781938800,
          media: [
            {
              id: "browser-refresh-445",
              kind: "image",
              alt: "Browser refreshed post receipt",
              variants: {
                tablet: {
                  url: "/media/midsummer/thread/browser-refresh-445-tablet.jpg",
                  width: 960,
                  height: 720,
                },
                small: {
                  url: "/media/midsummer/thread/browser-refresh-445-small.jpg",
                  width: 480,
                  height: 360,
                },
                original: {
                  url: "/media/midsummer/thread/browser-refresh-445-original.jpg",
                  width: 4000,
                  height: 3000,
                },
              },
            },
          ],
        },
        {
          source_seq: 444,
          stream_seq: 91,
          author_slot: "host",
          author_user: "Host",
          body: "Official votecount for D01\n- slot_2: 1",
          occurred_at: 1781935200,
        },
      ],
    }),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/votecount(?:\?.*)?$/,
    body: Object.freeze([
      {
        target: "slot-2 / Ilya",
        count: 3,
        needed: 5,
      },
    ]),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/day-vote-outcomes(?:\?.*)?$/,
    body: Object.freeze([]),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/player-command-state(?:\?.*)?$/,
    body: Object.freeze({
      game: "midsummer",
      actor_slot: "slot-7",
      actor_alive: true,
      actor_status: "alive",
      phase: {
        phase_id: "D01",
        phase_kind: "Day",
        phase_number: 1,
        locked: false,
      },
      actions: [],
      vote_targets: [],
    }),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/host-console-state(?:\?.*)?$/,
    bodyFrom: "hostConsoleState",
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/host-prompts(?:\?.*)?$/,
    bodyFrom: "hostPrompts",
  }),
  Object.freeze({
    pattern: "**/games/*/thread?*before_seq=*",
    body: Object.freeze({
      next_before_seq: null,
      posts: [
        {
          source_seq: 440,
          stream_seq: 88,
          author_slot: "slot-3",
          author_user: "Tamsin",
          body: "Older context for the live thread.",
          occurred_at: 1781924400,
        },
      ],
    }),
  }),
]);

export const privateChannelCommandMockScenarios = Object.freeze([
  Object.freeze({
    command: "SubmitPost",
    respond: Object.freeze({
      kind: "Ack",
      body: Object.freeze({ stream_seqs: Object.freeze([172]) }),
    }),
  }),
]);

export const privateChannelCommandMockFallback = Object.freeze({
  status: 409,
  id: Object.freeze({ fromEnvelope: true, fallback: 1 }),
  respond: Object.freeze({
    kind: "Reject",
    body: Object.freeze({
      error: "WrongPrivateChannelCommand",
      retryable: false,
      message: "private-channel smoke only accepts SubmitPost",
    }),
  }),
});

export const privateChannelFixtureApiRoutes = Object.freeze([
  Object.freeze({
    pattern: "**/games/*/channels/*/thread?*",
    body: Object.freeze({
      next_before_seq: 440,
      posts: [
        {
          source_seq: 446,
          stream_seq: 172,
          author_slot: "slot-7",
          author_user: "Mira",
          body: "Browser smoke refreshed private channel post.",
          occurred_at: 1781939100,
        },
      ],
    }),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/votecount(?:\?.*)?$/,
    body: Object.freeze([
      {
        target: "slot-2 / Ilya",
        count: 3,
        needed: 5,
      },
    ]),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/day-vote-outcomes(?:\?.*)?$/,
    body: Object.freeze([]),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/player-command-state(?:\?.*)?$/,
    body: Object.freeze({
      game: "midsummer",
      actor_slot: "slot-7",
      actor_alive: true,
      actor_status: "alive",
      phase: {
        phase_id: "D01",
        phase_kind: "Day",
        phase_number: 1,
        locked: false,
      },
      actions: [],
      vote_targets: [],
    }),
  }),
]);

// Command flows keyed by role id. Steps run in order; a step with an `id`
// stores its output for later steps (`baselineId`, `actionIdFrom`,
// `set-from-value`, ...). Trailing read/set steps assemble the flow result in
// the exact key order the artifact contract expects. `budgetRef` and
// `actionRootTestId`-style selectors resolve against the role object from
// frontend_role_smoke_scenarios.mjs, so budgets stay single-sourced there.
const moderatorActionTarget = (testId) =>
  Object.freeze({ within: "critical-host-action-extend_deadline", testId });

export const commandFlows = Object.freeze({
  moderator: Object.freeze({
    steps: Object.freeze([
      {
        type: "capture-geometry-baseline",
        id: "confirmationGeometryBaseline",
        budgetRef: "interactionGeometryBudget.confirmation",
        label: "moderator extend deadline confirmation",
      },
      {
        type: "capture-geometry-baseline",
        id: "feedbackGeometryBaseline",
        budgetRef: "interactionGeometryBudget.feedback",
        label: "moderator extend deadline feedback",
      },
      { type: "click", target: moderatorActionTarget("critical-host-action-trigger") },
      {
        type: "wait-visible",
        target: moderatorActionTarget("critical-host-action-confirmation"),
      },
      {
        type: "assert-post-geometry",
        id: "confirmationGeometry",
        baselineId: "confirmationGeometryBaseline",
        budgetRef: "interactionGeometryBudget.confirmation",
        label: "moderator extend deadline confirmation",
      },
      {
        type: "screenshot",
        id: "confirmationShot",
        name: "moderator-confirmation",
        labelPrefix: "moderator confirmation",
      },
      {
        type: "assert-confirmation-focus",
        id: "focus",
        variant: "host",
        within: "critical-host-action-extend_deadline",
        options: {
          label: "moderator extend deadline",
          escapeCancels: true,
          tabSequenceTestIds: [
            "critical-host-action-cancel",
            "critical-host-action-confirm",
            "critical-host-action-cancel",
          ],
        },
      },
      { type: "click", target: moderatorActionTarget("critical-host-action-trigger") },
      {
        type: "wait-visible",
        target: moderatorActionTarget("critical-host-action-confirmation"),
      },
      {
        type: "assert-hit-target",
        target: moderatorActionTarget("critical-host-action-confirm"),
        label: "moderator confirm",
      },
      {
        type: "capture-geometry-baseline",
        id: "pendingGeometryBaseline",
        budgetRef: "pendingStateBudget",
        label: "moderator extend deadline pending state",
      },
      {
        type: "dispatch-command",
        latencyLabel: "moderator extend-deadline command",
        interruptionLabel: "moderator extend-deadline connection loss",
        click: moderatorActionTarget("critical-host-action-confirm"),
      },
      {
        type: "capture-pending-state",
        id: "pendingState",
        budgetRef: "pendingStateBudget",
        geometryBaselineId: "pendingGeometryBaseline",
      },
      {
        type: "capture-interrupted-recovery",
        id: "interruptedState",
        budgetRef: "interruptedStateBudget",
        geometryBaselineId: "pendingGeometryBaseline",
        continuityBudgetRef: "commandContinuityBudget",
        restartSteps: [
          { type: "click", target: moderatorActionTarget("critical-host-action-trigger") },
          {
            type: "wait-visible",
            target: moderatorActionTarget("critical-host-action-confirmation"),
          },
          { type: "click", target: moderatorActionTarget("critical-host-action-confirm") },
        ],
      },
      { type: "wait-visible", target: { testId: "host-command-status-extend_deadline" } },
      {
        type: "wait-data-state",
        target: { testId: "host-command-status-extend_deadline" },
        state: "reject",
      },
      {
        type: "assert-status-region",
        id: "statusRegion",
        target: { testId: "host-command-status-extend_deadline" },
        options: {
          label: "moderator extend-deadline reject status",
          expectedState: "reject",
          expectedAriaLive: "assertive",
        },
      },
      {
        type: "assert-command-continuity",
        id: "commandContinuity",
        budgetRef: "commandContinuityBudget",
        interruptedId: "interruptedState",
        statusRegionId: "statusRegion",
        label: "moderator extend deadline command continuity",
      },
      {
        type: "assert-post-geometry",
        id: "feedbackGeometry",
        baselineId: "feedbackGeometryBaseline",
        budgetRef: "interactionGeometryBudget.feedback",
        label: "moderator extend deadline feedback",
      },
      {
        type: "assert-command-activity",
        id: "rejectedActivity",
        prefix: "host",
        actionId: "extend_deadline",
        expectedState: "reject",
      },
      { type: "hook", id: "hostPrompt", name: "moderatorHostPromptAck" },
      {
        type: "assert-command-activity",
        id: "acknowledgedActivity",
        prefix: "host",
        actionIdFrom: { id: "hostPrompt", path: "actionId" },
        expectedState: "ack",
      },
      { type: "hook", id: "slotLifecycle", name: "moderatorSlotLifecycleAck" },
      {
        type: "assert-command-activity",
        id: "slotLifecycleActivity",
        prefix: "host",
        actionIdFrom: { id: "slotLifecycle", path: "actionId" },
        expectedState: "ack",
      },
      {
        type: "read-attr",
        target: { testId: "host-command-status-extend_deadline" },
        attr: "data-state",
        resultPath: "state",
      },
      {
        type: "read-text",
        target: { testId: "host-command-status-extend_deadline" },
        resultPath: "message",
      },
      { type: "set-from-value", from: { id: "statusRegion" }, resultPath: "statusRegion" },
      { type: "set-from-value", from: { id: "rejectedActivity" }, resultPath: "activity.rejected" },
      {
        type: "set-from-value",
        from: { id: "acknowledgedActivity" },
        resultPath: "activity.acknowledged",
      },
      {
        type: "set-from-value",
        from: { id: "slotLifecycleActivity" },
        resultPath: "activity.slotLifecycle",
      },
      { type: "set-from-value", from: { id: "focus" }, resultPath: "focus" },
      {
        type: "set-from-value",
        from: { id: "confirmationShot", path: "screenshot" },
        resultPath: "confirmationScreenshot",
      },
      {
        type: "set-from-value",
        from: { id: "confirmationShot", path: "pixels" },
        resultPath: "confirmationScreenshotPixels",
      },
      { type: "set-from-value", from: { id: "hostPrompt" }, resultPath: "hostPrompt" },
      { type: "set-from-value", from: { id: "slotLifecycle" }, resultPath: "slotLifecycle" },
      {
        type: "set-from-value",
        from: { id: "confirmationGeometry" },
        resultPath: "interactionGeometry.confirmation",
      },
      {
        type: "set-from-value",
        from: { id: "feedbackGeometry" },
        resultPath: "interactionGeometry.feedback",
      },
      {
        type: "set-from-value",
        from: { id: "commandContinuity" },
        resultPath: "commandContinuity",
      },
      { type: "set-from-value", from: { id: "pendingState" }, resultPath: "pendingState" },
      {
        type: "set-from-value",
        from: { id: "interruptedState" },
        resultPath: "interruptedState",
      },
    ]),
  }),
  admin: Object.freeze({
    steps: Object.freeze([
      {
        type: "capture-geometry-baseline",
        id: "createGeometryBaseline",
        budgetRef: "interactionGeometryBudget.feedback",
        label: "admin create-game feedback",
      },
      { type: "click", target: { within: "admin-setup-create-game", selector: "button" } },
      { type: "wait-visible", target: { testId: "admin-command-status-create-game" } },
      {
        type: "assert-data-state-now",
        target: { testId: "admin-command-status-create-game" },
        state: "confirm",
        errorMessage: "admin create-game did not require confirmation",
      },
      {
        type: "capture-geometry-baseline",
        id: "pendingGeometryBaseline",
        budgetRef: "pendingStateBudget",
        label: "admin create-game pending state",
      },
      {
        type: "dispatch-command",
        latencyLabel: "admin create-game command",
        interruptionLabel: "admin create-game connection loss",
        click: { testId: "admin-command-confirm-create-game" },
      },
      {
        type: "capture-pending-state",
        id: "pendingState",
        budgetRef: "pendingStateBudget",
        geometryBaselineId: "pendingGeometryBaseline",
      },
      {
        type: "capture-interrupted-recovery",
        id: "interruptedState",
        budgetRef: "interruptedStateBudget",
        geometryBaselineId: "pendingGeometryBaseline",
        continuityBudgetRef: "commandContinuityBudget",
        restartSteps: [
          { type: "click", target: { within: "admin-setup-create-game", selector: "button" } },
          { type: "wait-visible", target: { testId: "admin-command-confirm-create-game" } },
          { type: "click", target: { testId: "admin-command-confirm-create-game" } },
        ],
      },
      {
        type: "wait-data-state",
        target: { testId: "admin-command-status-create-game" },
        state: "reject",
      },
      {
        type: "assert-status-region",
        id: "createRegion",
        target: { testId: "admin-command-status-create-game" },
        options: {
          label: "admin create-game reject status",
          expectedState: "reject",
          expectedAriaLive: "assertive",
        },
      },
      {
        type: "assert-command-continuity",
        id: "commandContinuity",
        budgetRef: "commandContinuityBudget",
        interruptedId: "interruptedState",
        statusRegionId: "createRegion",
        label: "admin create-game command continuity",
      },
      {
        type: "assert-post-geometry",
        id: "feedbackGeometry",
        baselineId: "createGeometryBaseline",
        budgetRef: "interactionGeometryBudget.feedback",
        label: "admin create-game feedback",
      },
      {
        type: "capture-geometry-baseline",
        id: "confirmationGeometryBaseline",
        budgetRef: "interactionGeometryBudget.confirmation",
        label: "admin session grant confirmation",
      },
      { type: "click", target: { within: "admin-setup-session-grants", selector: "button" } },
      { type: "wait-visible", target: { testId: "admin-command-status-session-grants" } },
      {
        type: "assert-data-state-now",
        target: { testId: "admin-command-status-session-grants" },
        state: "confirm",
        errorMessage: "session grant did not require confirmation",
      },
      {
        type: "assert-status-region",
        id: "sessionGrantRegion",
        target: { testId: "admin-command-status-session-grants" },
        options: {
          label: "admin session-grants confirm status",
          expectedState: "confirm",
          expectedAriaLive: "polite",
        },
      },
      {
        type: "capture-text",
        id: "sessionGrantMessage",
        target: { testId: "admin-command-status-session-grants" },
      },
      {
        type: "assert-form-contract",
        id: "sessionGrantForm",
        options: {
          label: "admin session grant form",
          formTestId: "admin-session-grant-form",
          action: "?/grantSession",
          fieldTestIds: [
            "admin-session-grant-token",
            "admin-session-grant-principal",
            "admin-session-grant-expires-at",
            "admin-session-grant-global-mod",
          ],
        },
      },
      {
        type: "assert-post-geometry",
        id: "confirmationGeometry",
        baselineId: "confirmationGeometryBaseline",
        budgetRef: "interactionGeometryBudget.confirmation",
        label: "admin session grant confirmation",
      },
      {
        type: "screenshot",
        id: "confirmationShot",
        name: "admin-confirmation",
        labelPrefix: "admin confirmation",
      },
      {
        type: "assert-confirmation-focus",
        id: "sessionGrantFocus",
        variant: "admin",
        options: {
          label: "admin session grant",
          dialogTestId: "admin-session-grant-form",
          confirmTestId: "admin-command-confirm-session-grants",
          cancelTestId: "admin-command-cancel-session-grants",
          returnFocusTestId: "admin-command-trigger-session-grants",
          escapeCancels: true,
          tabSequenceTestIds: [
            "admin-command-cancel-session-grants",
            "admin-session-grant-token",
            "admin-session-grant-principal",
            "admin-session-grant-expires-at",
            "admin-session-grant-global-mod",
            "admin-command-confirm-session-grants",
          ],
          shiftTabFromFirstTestId: "admin-session-grant-token",
          shiftTabReturnTestId: "admin-command-cancel-session-grants",
        },
      },
      { type: "click", target: { within: "admin-setup-session-grants", selector: "button" } },
      { type: "wait-visible", target: { testId: "admin-command-status-session-grants" } },
      {
        type: "assert-hit-target",
        target: { testId: "admin-command-confirm-session-grants" },
        label: "admin session grant confirm",
      },
      { type: "click", target: { testId: "admin-command-cancel-session-grants" } },
      {
        type: "assert-focused",
        testId: "admin-command-trigger-session-grants",
        label: "admin session grant cancel focus return",
      },
      { type: "click", target: { within: "admin-setup-cohost", selector: "button" } },
      { type: "wait-visible", target: { testId: "admin-command-status-cohost" } },
      {
        type: "assert-data-state-now",
        target: { testId: "admin-command-status-cohost" },
        state: "confirm",
        errorMessage: "cohost delegation did not require confirmation",
      },
      {
        type: "assert-status-region",
        id: "cohostConfirmRegion",
        target: { testId: "admin-command-status-cohost" },
        options: {
          label: "admin cohost confirm status",
          expectedState: "confirm",
          expectedAriaLive: "polite",
        },
      },
      {
        type: "assert-confirmation-focus",
        id: "cohostFocus",
        variant: "admin",
        options: {
          label: "admin cohost",
          confirmTestId: "admin-command-confirm-cohost",
          cancelTestId: "admin-command-cancel-cohost",
          returnFocusTestId: "admin-command-trigger-cohost",
          escapeCancels: true,
          tabSequenceTestIds: [
            "admin-command-cancel-cohost",
            "admin-command-confirm-cohost",
            "admin-command-cancel-cohost",
          ],
        },
      },
      { type: "click", target: { within: "admin-setup-cohost", selector: "button" } },
      { type: "wait-visible", target: { testId: "admin-command-status-cohost" } },
      {
        type: "assert-hit-target",
        target: { testId: "admin-command-confirm-cohost" },
        label: "admin cohost confirm",
      },
      { type: "click", target: { testId: "admin-command-confirm-cohost" } },
      {
        type: "wait-data-state",
        target: { testId: "admin-command-status-cohost" },
        state: "reject",
      },
      {
        type: "assert-status-region",
        id: "cohostRejectRegion",
        target: { testId: "admin-command-status-cohost" },
        options: {
          label: "admin cohost reject status",
          expectedState: "reject",
          expectedAriaLive: "assertive",
        },
      },
      {
        type: "assert-command-activity",
        id: "cohostActivity",
        prefix: "admin",
        actionId: "cohost",
        expectedState: "reject",
      },
      {
        type: "read-attr",
        target: { testId: "admin-command-status-create-game" },
        attr: "data-state",
        resultPath: "create.state",
      },
      {
        type: "read-text",
        target: { testId: "admin-command-status-create-game" },
        resultPath: "create.message",
      },
      { type: "set-from-value", from: { id: "createRegion" }, resultPath: "create.statusRegion" },
      {
        type: "set-from-value",
        from: { id: "sessionGrantRegion", path: "state" },
        resultPath: "sessionGrant.state",
      },
      {
        type: "set-from-value",
        from: { id: "sessionGrantMessage" },
        resultPath: "sessionGrant.message",
      },
      {
        type: "set-from-value",
        from: { id: "sessionGrantRegion" },
        resultPath: "sessionGrant.statusRegion",
      },
      { type: "set-from-value", from: { id: "sessionGrantFocus" }, resultPath: "sessionGrant.focus" },
      { type: "set-from-value", from: { id: "sessionGrantForm" }, resultPath: "sessionGrant.form" },
      {
        type: "set-from-value",
        from: { id: "confirmationShot", path: "screenshot" },
        resultPath: "sessionGrant.confirmationScreenshot",
      },
      {
        type: "set-from-value",
        from: { id: "confirmationShot", path: "pixels" },
        resultPath: "sessionGrant.confirmationScreenshotPixels",
      },
      {
        type: "read-attr",
        target: { testId: "admin-command-status-cohost" },
        attr: "data-state",
        resultPath: "cohost.state",
      },
      {
        type: "read-text",
        target: { testId: "admin-command-status-cohost" },
        resultPath: "cohost.message",
      },
      {
        type: "set-from-value",
        from: { id: "cohostConfirmRegion" },
        resultPath: "cohost.confirmStatusRegion",
      },
      {
        type: "set-from-value",
        from: { id: "cohostRejectRegion" },
        resultPath: "cohost.rejectStatusRegion",
      },
      { type: "set-from-value", from: { id: "cohostFocus" }, resultPath: "cohost.focus" },
      { type: "click", target: { within: "admin-recovery-recovery-gate", selector: "button" } },
      { type: "wait-visible", target: { testId: "admin-recovery-status-recovery-gate" } },
      {
        type: "assert-data-state-now",
        target: { testId: "admin-recovery-status-recovery-gate" },
        state: "confirm",
        errorMessage: "recovery gate did not require confirmation",
      },
      {
        type: "assert-status-region",
        id: "recoveryConfirmRegion",
        target: { testId: "admin-recovery-status-recovery-gate" },
        options: {
          label: "admin recovery confirm status",
          expectedState: "confirm",
          expectedAriaLive: "polite",
        },
      },
      {
        type: "assert-form-contract",
        id: "recoveryForm",
        options: {
          label: "admin recovery gate form",
          formTestId: "admin-recovery-form-recovery-gate",
          action: "?/checkRecoveryGate",
          fieldNames: ["game", "principalUserId"],
        },
      },
      {
        type: "assert-confirmation-focus",
        id: "recoveryFocus",
        variant: "admin",
        options: {
          label: "admin recovery gate",
          dialogTestId: "admin-recovery-form-recovery-gate",
          confirmTestId: "admin-recovery-confirm-recovery-gate",
          cancelTestId: "admin-recovery-cancel-recovery-gate",
          returnFocusTestId: "admin-recovery-trigger-recovery-gate",
          escapeCancels: true,
          tabSequenceTestIds: [
            "admin-recovery-cancel-recovery-gate",
            "admin-recovery-confirm-recovery-gate",
            "admin-recovery-cancel-recovery-gate",
          ],
        },
      },
      { type: "click", target: { within: "admin-recovery-recovery-gate", selector: "button" } },
      { type: "wait-visible", target: { testId: "admin-recovery-status-recovery-gate" } },
      {
        type: "assert-hit-target",
        target: { testId: "admin-recovery-confirm-recovery-gate" },
        label: "admin recovery gate confirm",
      },
      { type: "click", target: { testId: "admin-recovery-confirm-recovery-gate" } },
      {
        type: "wait-data-state",
        target: { testId: "admin-recovery-status-recovery-gate" },
        state: "ack",
      },
      {
        type: "assert-status-region",
        id: "recoveryAckRegion",
        target: { testId: "admin-recovery-status-recovery-gate" },
        options: {
          label: "admin recovery ack status",
          expectedState: "ack",
          expectedAriaLive: "polite",
        },
      },
      {
        type: "assert-command-activity",
        id: "recoveryActivity",
        prefix: "admin",
        actionId: "recovery-gate",
        expectedState: "ack",
      },
      {
        type: "read-attr",
        target: { testId: "admin-recovery-status-recovery-gate" },
        attr: "data-state",
        resultPath: "recovery.state",
      },
      {
        type: "read-text",
        target: { testId: "admin-recovery-status-recovery-gate" },
        resultPath: "recovery.message",
      },
      {
        type: "set-from-value",
        from: { id: "recoveryConfirmRegion" },
        resultPath: "recovery.confirmStatusRegion",
      },
      {
        type: "set-from-value",
        from: { id: "recoveryAckRegion" },
        resultPath: "recovery.ackStatusRegion",
      },
      { type: "set-from-value", from: { id: "recoveryFocus" }, resultPath: "recovery.focus" },
      { type: "set-from-value", from: { id: "recoveryForm" }, resultPath: "recovery.form" },
      { type: "set-from-value", from: { id: "cohostActivity" }, resultPath: "activity.rejected" },
      {
        type: "set-from-value",
        from: { id: "recoveryActivity" },
        resultPath: "activity.acknowledged",
      },
      {
        type: "set-from-value",
        from: { id: "confirmationGeometry" },
        resultPath: "interactionGeometry.confirmation",
      },
      {
        type: "set-from-value",
        from: { id: "feedbackGeometry" },
        resultPath: "interactionGeometry.feedback",
      },
      { type: "set-from-value", from: { id: "commandContinuity" }, resultPath: "commandContinuity" },
      { type: "set-from-value", from: { id: "pendingState" }, resultPath: "pendingState" },
      { type: "set-from-value", from: { id: "interruptedState" }, resultPath: "interruptedState" },
    ]),
  }),
  player: Object.freeze({
    steps: Object.freeze([
      { type: "hook", id: "media", name: "playerMediaNetwork" },
      { type: "hook", name: "playerLiveThreadEmit" },
      { type: "wait-visible", target: { testId: "player-live-official-post" } },
      {
        type: "assert-visible-box",
        target: { testId: "player-live-official-post" },
        label: "player live official post",
      },
      { type: "wait-visible", target: { testId: "thread-post-444" } },
      { type: "hook", id: "privateDisclosure", name: "playerPrivateDisclosure" },
      { type: "click", target: { testId: "player-thread-load-older" } },
      { type: "wait-visible", target: { testId: "player-thread-page-status" } },
      {
        type: "wait-data-state",
        target: { testId: "player-thread-page-status" },
        state: "ack",
      },
      {
        type: "assert-status-region",
        id: "pageStatusRegion",
        target: { testId: "player-thread-page-status" },
        options: {
          label: "player thread page ack status",
          expectedState: "ack",
          expectedAriaLive: "polite",
        },
      },
      { type: "wait-visible", target: { testId: "thread-post-440" } },
      {
        type: "capture-geometry-baseline",
        id: "feedbackGeometryBaseline",
        budgetRef: "interactionGeometryBudget.feedback",
        label: "player vote receipt",
      },
      {
        type: "click",
        target: { within: "player-quick-vote-actions", selector: '[data-action="submit_vote"]' },
      },
      { type: "wait-visible", target: { testId: "player-command-status" } },
      {
        type: "wait-data-state",
        target: { testId: "player-command-status" },
        state: "reject",
      },
      {
        type: "assert-status-region",
        id: "commandStatusRegion",
        target: { testId: "player-command-status" },
        options: {
          label: "player command reject status",
          expectedState: "reject",
          expectedAriaLive: "assertive",
        },
      },
      {
        type: "assert-command-receipt",
        id: "commandReceipt",
        actionId: "submit_vote",
        expectedState: "reject",
      },
      {
        type: "assert-post-geometry",
        id: "feedbackGeometry",
        baselineId: "feedbackGeometryBaseline",
        budgetRef: "interactionGeometryBudget.feedback",
        label: "player vote receipt",
      },
      {
        type: "screenshot",
        id: "receiptShot",
        name: "player-receipt",
        labelPrefix: "player receipt",
      },
      {
        type: "fill",
        target: { within: "player-composer", selector: "textarea" },
        value: "Browser smoke player post",
      },
      {
        type: "capture-geometry-baseline",
        id: "pendingGeometryBaseline",
        budgetRef: "pendingStateBudget",
        label: "player submit-post pending state",
      },
      {
        type: "dispatch-command",
        latencyLabel: "player submit-post command",
        interruptionLabel: "player submit-post connection loss",
        click: { within: "player-composer", selector: '[data-action="submit_post"]' },
      },
      {
        type: "capture-pending-state",
        id: "pendingState",
        budgetRef: "pendingStateBudget",
        geometryBaselineId: "pendingGeometryBaseline",
      },
      {
        type: "capture-interrupted-recovery",
        id: "interruptedState",
        budgetRef: "interruptedStateBudget",
        geometryBaselineId: "pendingGeometryBaseline",
        continuityBudgetRef: "commandContinuityBudget",
        restartSteps: [
          {
            type: "click",
            target: { within: "player-composer", selector: '[data-action="submit_post"]' },
          },
        ],
      },
      {
        type: "wait-data-state",
        target: { testId: "player-command-status" },
        state: "ack",
      },
      {
        type: "assert-status-region",
        id: "postCommandStatusRegion",
        target: { testId: "player-command-status" },
        options: {
          label: "player post command ack status",
          expectedState: "ack",
          expectedAriaLive: "polite",
        },
      },
      {
        type: "assert-command-continuity",
        id: "commandContinuity",
        budgetRef: "commandContinuityBudget",
        interruptedId: "interruptedState",
        statusRegionId: "postCommandStatusRegion",
        label: "player composer command continuity",
      },
      {
        type: "assert-command-receipt",
        id: "postCommandReceipt",
        actionId: "submit_post",
        expectedState: "ack",
      },
      {
        type: "screenshot",
        id: "composerAckShot",
        name: "player-composer-ack",
        labelPrefix: "player composer acknowledgement",
      },
      { type: "wait-visible", target: { testId: "thread-post-445" } },
      { type: "find-request-command", id: "postRequest", commandKey: "SubmitPost" },
      { type: "set-from-value", from: { id: "media" }, resultPath: "media" },
      {
        type: "read-text",
        target: { testId: "player-live-official-post" },
        resultPath: "liveThread.officialPost",
      },
      {
        type: "read-text",
        target: { testId: "thread-post-444" },
        resultPath: "liveThread.renderedPost",
      },
      {
        type: "read-text",
        target: { testId: "thread-post-445" },
        resultPath: "liveThread.refreshedPost",
      },
      {
        type: "set-from-value",
        from: { id: "privateDisclosure" },
        resultPath: "privateDisclosure",
      },
      {
        type: "read-attr",
        target: { testId: "player-thread-page-status" },
        attr: "data-state",
        resultPath: "page.state",
      },
      {
        type: "read-text",
        target: { testId: "player-thread-page-status" },
        resultPath: "page.message",
      },
      { type: "set-from-value", from: { id: "pageStatusRegion" }, resultPath: "page.statusRegion" },
      {
        type: "read-attr",
        target: { testId: "player-command-status" },
        attr: "data-state",
        resultPath: "command.state",
      },
      {
        type: "read-text",
        target: { testId: "player-command-status" },
        resultPath: "command.message",
      },
      {
        type: "set-from-value",
        from: { id: "commandStatusRegion" },
        resultPath: "command.statusRegion",
      },
      { type: "set-from-value", from: { id: "commandReceipt" }, resultPath: "commandReceipt" },
      { type: "set-result", resultPath: "interactionGeometry.confirmation", value: null },
      {
        type: "set-from-value",
        from: { id: "feedbackGeometry" },
        resultPath: "interactionGeometry.feedback",
      },
      { type: "set-from-value", from: { id: "commandContinuity" }, resultPath: "commandContinuity" },
      { type: "set-from-value", from: { id: "pendingState" }, resultPath: "pendingState" },
      { type: "set-from-value", from: { id: "interruptedState" }, resultPath: "interruptedState" },
      {
        type: "set-from-value",
        from: { id: "receiptShot", path: "screenshot" },
        resultPath: "receiptScreenshot",
      },
      {
        type: "set-from-value",
        from: { id: "receiptShot", path: "pixels" },
        resultPath: "receiptScreenshotPixels",
      },
      {
        type: "set-from-value",
        from: { id: "composerAckShot", path: "screenshot" },
        resultPath: "composerAckScreenshot",
      },
      {
        type: "set-from-value",
        from: { id: "composerAckShot", path: "pixels" },
        resultPath: "composerAckScreenshotPixels",
      },
      {
        type: "read-attr",
        target: { testId: "player-command-status" },
        attr: "data-state",
        resultPath: "postCommand.state",
      },
      {
        type: "read-text",
        target: { testId: "player-command-status" },
        resultPath: "postCommand.message",
      },
      {
        type: "set-from-value",
        from: { id: "postCommandStatusRegion" },
        resultPath: "postCommand.statusRegion",
      },
      { type: "set-from-value", from: { id: "postRequest" }, resultPath: "postCommand.requestCommand" },
      { type: "set-result", resultPath: "postCommand.refreshedPostTestId", value: "thread-post-445" },
      { type: "set-from-value", from: { id: "postCommandReceipt" }, resultPath: "postCommandReceipt" },
    ]),
  }),
});
