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
]);

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
});
