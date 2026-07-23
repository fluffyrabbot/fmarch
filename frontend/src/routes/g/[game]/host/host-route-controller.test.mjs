import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendHostActionEvent,
  appendHostCommandOutcome,
  buildHostCommandDispatchBridgePlan,
  buildHostDerivedState,
  buildHostProjectionColdLoads,
  buildHostProjectionInitialSnapshot,
  hostCommandErrorOutcome,
  hostCommandInterruptedOutcome,
  hostCommandPendingStatus,
  hostPostAckRefreshKeys,
  hostPostCommandRefreshKeys,
  hostProjectionResyncKeys,
  recordHostCommandStatus,
  clearHostCommandStatus,
  sendHostRouteAction,
} from "./host-route-controller.mjs";
import { CommandInterruptedError } from "../../../../lib/app/command-interruption.mjs";

test("host interrupted command keeps confirmation and can be dismissed", () => {
  const event = {
    actionId: "extend_deadline",
    confirmationTrace: {
      kind: "confirmation-command-trace",
      confirmationKind: "confirmation-action",
      surface: "moderator-host",
      actionId: "extend_deadline",
      statusKey: "extend_deadline",
      dispatchKind: "extend_deadline",
    },
  };
  const status = hostCommandInterruptedOutcome({
    actionId: event.actionId,
    commandId: "host-command-1",
    error: new CommandInterruptedError("timeout"),
    event,
  });

  assert.equal(status.state, "interrupted");
  assert.equal(status.commandId, "host-command-1");
  assert.equal(status.confirmationTrace.actionId, event.actionId);
  assert.deepEqual(
    clearHostCommandStatus({ [event.actionId]: status }, event.actionId),
    {},
  );
});

test("host route controller builds projection store boundaries from route data", () => {
  const data = fixtureData();

  assert.deepEqual(buildHostProjectionInitialSnapshot(data), {
    host: {
      authority: data.authority,
      completed: false,
      phase: data.phase,
      replacement: data.replacement,
      tasks: data.hostTasks,
      dayEvents: [],
      dayEventScheduler: null,
    },
    votecount: data.votecount,
    dayVoteOutcomes: data.dayVoteOutcomes,
    hostPrompts: data.hostPrompts,
  });
  assert.deepEqual(Object.keys(buildHostProjectionColdLoads(data)), [
    "host",
    "votecount",
    "dayVoteOutcomes",
    "hostPrompts",
  ]);
  assert.deepEqual(hostProjectionResyncKeys(), [
    "host",
    "votecount",
    "dayVoteOutcomes",
    "hostPrompts",
  ]);
});

test("host route controller derives action groups from live host projections", () => {
  const cohostDeadlineSeconds = 1782014400;
  const derived = buildHostDerivedState({
    gameId: "midsummer",
    snapshot: {
      host: {
        phase: { id: "D01", locked: false, state: "open" },
        replacement: null,
      },
      votecount: [{ target: "slot-2 / Ilya", count: 2, needed: 4 }],
      dayVoteOutcomes: [
        {
          phaseId: "D01",
          sourceSeq: 7,
          eventIndex: 0,
          status: "Lynch",
          winnerSlot: "slot-2",
        },
      ],
      hostPrompts: [
        {
          id: "D01:tie:slot_2",
          label: "tie",
          status: "pending",
          decisionKind: "select_slot",
          subjectSlot: "slot_2",
        },
        {
          id: "D01:deadline",
          label: "deadline",
          status: "resolved",
          decisionKind: "acknowledge",
        },
      ],
    },
  });

  assert.equal(derived.projection.phase.id, "D01");
  assert.equal(derived.dayVoteOutcomes[0].winnerSlot, "slot-2");
  assert.deepEqual(
    derived.criticalActions
      .filter((action) => action.id.startsWith("resolve_host_prompt-"))
      .map((action) => action.payload.promptId),
    ["D01:tie:slot_2"],
  );
  assert.equal(
    derived.moderatorActionGroups.find((group) => group.id === "host-prompts").value,
    "1 durable prompt pending",
  );
  assert.equal(
    derived.moderatorActionGroups.find((group) => group.id === "votecount").value,
    "1 projected target",
  );
  assert.deepEqual(
    derived.moderatorActionGroups
      .find((group) => group.id === "phase")
      .actions.map((action) => action.id),
    ["resolve_phase", "lock_thread"],
  );

  const locked = buildHostDerivedState({
    gameId: "midsummer",
    snapshot: {
      host: {
        phase: { id: "N01", locked: true, state: "locked" },
        replacement: null,
      },
      votecount: [],
      dayVoteOutcomes: [],
      hostPrompts: [],
    },
  });
  assert.deepEqual(
    locked.moderatorActionGroups
      .find((group) => group.id === "phase")
      .actions.map((action) => action.id),
    ["unlock_thread", "advance_phase"],
  );

  const cohost = buildHostDerivedState({
    gameId: "midsummer",
    capabilityKind: "CohostOf",
    snapshot: {
      host: {
        authority: {
          capabilityKind: "CohostOf",
          allowedClasses: ["deadline"],
          deniedClasses: ["phase_resolve"],
        },
        phase: {
          id: "D03R2",
          label: "Day 3 revote 2",
          locked: false,
          state: "open",
          deadline: cohostDeadlineSeconds,
        },
        replacement: null,
      },
      votecount: [{ target: "slot-2 / Ilya", count: 2, needed: 4 }],
      dayVoteOutcomes: [],
      hostPrompts: [
        {
          id: "D01:tie:slot_2",
          label: "tie",
          status: "pending",
          decisionKind: "select_slot",
          subjectSlot: "slot_2",
        },
      ],
    },
  });
  assert.deepEqual(
    cohost.criticalActions.map((action) => action.id),
    ["extend_deadline", "extend_deadline_24h", "extend_deadline_48h"],
  );
  assert.deepEqual(
    cohost.criticalActions.map((action) => [
      action.id,
      action.objectLabel,
      action.payload.phaseId,
      action.payload.extendsTo,
    ]),
    [
      [
        "extend_deadline",
        "Day 3 revote 2 deadline",
        "D03R2",
        new Date((cohostDeadlineSeconds + 24 * 3600) * 1000).toISOString(),
      ],
      [
        "extend_deadline_24h",
        "Day 3 revote 2 deadline",
        "D03R2",
        new Date((cohostDeadlineSeconds + 24 * 3600) * 1000).toISOString(),
      ],
      [
        "extend_deadline_48h",
        "Day 3 revote 2 deadline",
        "D03R2",
        new Date((cohostDeadlineSeconds + 48 * 3600) * 1000).toISOString(),
      ],
    ],
  );
  assert.deepEqual(
    cohost.moderatorActionGroups.map((group) => group.id),
    ["deadline"],
  );
});

test("host route controller records immutable local command state", () => {
  const event = {
    actionId: "lock_thread",
    confirmationTrace: {
      kind: "confirmation-command-trace",
      confirmationKind: "confirmation-action",
      surface: "moderator-host",
      actionId: "lock_thread",
      statusKey: "lock_thread",
      dispatchKind: "lock_thread",
    },
  };
  const outcome = { actionId: "lock_thread", state: "ack", message: "Ack" };

  assert.deepEqual(appendHostActionEvent([], event), [event]);
  assert.deepEqual(appendHostCommandOutcome([], outcome, event), [
    {
      ...outcome,
      confirmationTrace: event.confirmationTrace,
    },
  ]);
  assert.deepEqual(
    recordHostCommandStatus({}, "lock_thread", hostCommandPendingStatus(event)),
    {
      lock_thread: {
        state: "pending",
        message: "Sending command",
        confirmationTrace: event.confirmationTrace,
      },
    },
  );
  assert.deepEqual(
    hostCommandErrorOutcome({
      actionId: "lock_thread",
      error: new Error("network down"),
      event,
    }),
    {
      state: "reject",
      actionId: "lock_thread",
      error: "Internal",
      retryable: false,
      message: "network down",
      confirmationTrace: event.confirmationTrace,
    },
  );
});

test("host route controller derives dispatch bridge plans from host actions", () => {
  const event = {
    actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
    confirmationTrace: {
      kind: "confirmation-command-trace",
      confirmationKind: "confirmation-action",
      surface: "moderator-host",
      actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
      statusKey: "resolve_host_prompt-D01-skip_next_day-slot_1",
      dispatchKind: "resolve_host_prompt",
    },
    payload: {
      kind: "resolve_host_prompt",
      gameId: "midsummer",
      promptId: "D01:skip_next_day:slot_1",
      decision: { kind: "acknowledge" },
    },
  };
  const plan = buildHostCommandDispatchBridgePlan({
    event,
    data: fixtureData(),
    optimisticStatus: hostCommandPendingStatus(event),
    finalStatus: {
      state: "ack",
      actionId: event.actionId,
      message: "Ack",
    },
  });

  assert.deepEqual(plan, {
    role: "moderator",
    boundary:
      "No-browser bridge contract for command trace metadata. It proves trace attributes can be normalized into role dispatch plans and reconciled with typed command requests, local feedback rows, and projection refresh keys. It does not prove pointer events, focus traversal, browser hydration, or network transport.",
    trace: {
      kind: "confirmation-command-trace",
      surface: "moderator-host",
      actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
      statusKey: "resolve_host_prompt-D01-skip_next_day-slot_1",
      dispatchKind: "resolve_host_prompt",
    },
    commandKind: "ResolveHostPrompt",
    commandEndpoint: "/commands",
    optimisticState: "pending",
    finalState: "ack",
    projectionRefreshKeys: ["host", "hostPrompts"],
  });
});

test("host route controller reports stale phase reject refreshes in dispatch plans", () => {
  const event = {
    actionId: "lock_thread",
    confirmationTrace: {
      kind: "confirmation-command-trace",
      confirmationKind: "confirmation-action",
      surface: "moderator-host",
      actionId: "lock_thread",
      statusKey: "lock_thread",
      dispatchKind: "lock_thread",
    },
    payload: {
      kind: "lock_thread",
      gameId: "midsummer",
    },
  };
  const plan = buildHostCommandDispatchBridgePlan({
    event,
    data: fixtureData(),
    optimisticStatus: hostCommandPendingStatus(event),
    finalStatus: {
      state: "reject",
      actionId: event.actionId,
      error: "PhaseLocked",
      message: "Reject PhaseLocked: phase locked",
    },
  });

  assert.equal(plan.finalState, "reject");
  assert.deepEqual(plan.projectionRefreshKeys, ["host"]);
});

test("host route controller sends commands and applies acked host projection state", async () => {
  const sent = [];
  const projectionStore = fakeProjectionStore({
    host: { phase: { id: "D01" }, replacement: null },
  });
  const projectionState = {
    phase: { id: "N01" },
    replacement: { slotId: "slot-7" },
  };

  const result = await sendHostRouteAction({
    event: { actionId: "advance_phase", payload: { kind: "advance_phase" } },
    data: fixtureData(),
    fetchImpl: async () => null,
    projectionStore,
    sendHostActionCommandImpl: async (request) => {
      sent.push(request);
      return {
        state: "ack",
        actionId: request.actionEvent.actionId,
        message: "Ack",
        projectionState,
      };
    },
  });

  assert.equal(sent.length, 1);
  assert.equal("principalUserId" in sent[0], false);
  assert.equal(sent[0].endpoint, "/commands");
  assert.equal(sent[0].stateEndpoint, "/games/midsummer/host-console-state");
  assert.equal(result.outcome.state, "ack");
  assert.deepEqual(result.snapshot.host, projectionState);
  assert.deepEqual(projectionStore.applied, [["host", projectionState]]);
});

test("host route controller applies acked host-prompt projection patches", async () => {
  const sent = [];
  const projectionStore = fakeProjectionStore({
    host: { phase: { id: "D01" }, replacement: null },
    votecount: [],
    hostPrompts: [
      {
        id: "D01:skip_next_day:slot_1",
        label: "skip_next_day",
        status: "pending",
        decisionKind: "acknowledge",
      },
    ],
  });
  const hostPromptPatch = [
    {
      id: "D01:skip_next_day:slot_1",
      label: "skip_next_day",
      status: "resolved",
      decisionKind: "acknowledge",
    },
  ];

  const result = await sendHostRouteAction({
    event: {
      actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
      payload: {
        kind: "resolve_host_prompt",
        gameId: "midsummer",
        promptId: "D01:skip_next_day:slot_1",
        decision: { kind: "acknowledge" },
      },
    },
    data: fixtureData(),
    fetchImpl: async () => null,
    projectionStore,
    sendHostActionCommandImpl: async (request) => {
      sent.push(request);
      return {
        state: "ack",
        actionId: request.actionEvent.actionId,
        message: "Ack",
        projectionPatches: {
          hostPrompts: hostPromptPatch,
        },
      };
    },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].actionEvent.payload.kind, "resolve_host_prompt");
  assert.equal(result.outcome.state, "ack");
  assert.deepEqual(result.snapshot.hostPrompts, hostPromptPatch);
  assert.deepEqual(projectionStore.applied, [["hostPrompts", hostPromptPatch]]);
  assert.equal(
    buildHostDerivedState({
      gameId: "midsummer",
      snapshot: result.snapshot,
    }).criticalActions.some((action) =>
      action.id.startsWith("resolve_host_prompt-"),
    ),
    false,
  );
  assert.deepEqual(projectionStore.refreshed, [["host"]]);
});

test("host route controller refreshes host prompts after hydrated prompt ACKs", async () => {
  const projectionStore = fakeProjectionStore({
    host: { phase: { id: "D01" }, replacement: null },
    votecount: [],
    hostPrompts: [
      {
        id: "D01:skip_next_day:slot_1",
        label: "skip_next_day",
        status: "pending",
        decisionKind: "acknowledge",
      },
    ],
  });

  const result = await sendHostRouteAction({
    event: {
      actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
      payload: {
        kind: "resolve_host_prompt",
        gameId: "midsummer",
        promptId: "D01:skip_next_day:slot_1",
        decision: { kind: "acknowledge" },
      },
    },
    data: fixtureData(),
    fetchImpl: async () => null,
    projectionStore,
    sendHostActionCommandImpl: async (request) => ({
      state: "ack",
      actionId: request.actionEvent.actionId,
      message: "Ack",
    }),
  });

  assert.equal(result.outcome.state, "ack");
  assert.deepEqual(projectionStore.refreshed, [["host", "hostPrompts"]]);
  assert.deepEqual(result.snapshot.hostPrompts, []);
  assert.equal(
    buildHostDerivedState({
      gameId: "midsummer",
      snapshot: result.snapshot,
    }).criticalActions.some((action) =>
      action.id.startsWith("resolve_host_prompt-"),
    ),
    false,
  );
});

test("host route controller schedules projection refreshes for prompt ACKs and stale phase rejects", () => {
  assert.deepEqual(
    hostPostAckRefreshKeys({
      event: { payload: { kind: "resolve_host_prompt" } },
      outcome: { state: "ack" },
    }),
    ["host", "hostPrompts"],
  );
  assert.deepEqual(
    hostPostAckRefreshKeys({
      event: { payload: { kind: "resolve_host_prompt" } },
      outcome: { state: "reject" },
    }),
    [],
  );
  assert.deepEqual(
    hostPostAckRefreshKeys({
      event: { payload: { kind: "advance_phase" } },
      outcome: { state: "ack" },
    }),
    [],
  );
  assert.deepEqual(
    hostPostAckRefreshKeys({
      event: { payload: { kind: "resolve_phase" } },
      outcome: { state: "ack" },
    }),
    ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  );
  assert.deepEqual(
    hostPostAckRefreshKeys({
      event: { payload: { kind: "resolve_day_event" } },
      outcome: { state: "ack" },
    }),
    ["host"],
  );
  assert.deepEqual(
    hostPostAckRefreshKeys({
      event: { payload: { kind: "resolve_day_event" } },
      outcome: { state: "ack", projectionState: {} },
    }),
    [],
  );
  assert.deepEqual(
    hostPostAckRefreshKeys({
      event: { payload: { kind: "resolve_host_prompt" } },
      outcome: {
        state: "ack",
        projectionPatches: {
          hostPrompts: [],
        },
      },
    }),
    ["host"],
  );
  assert.deepEqual(
    hostPostCommandRefreshKeys({
      event: { payload: { kind: "lock_thread" } },
      outcome: { state: "reject", error: "PhaseLocked" },
    }),
    ["host"],
  );
  assert.deepEqual(
    hostPostCommandRefreshKeys({
      event: { payload: { kind: "extend_deadline" } },
      outcome: { state: "reject", error: "PhaseLocked" },
    }),
    ["host"],
  );
  assert.deepEqual(
    hostPostCommandRefreshKeys({
      event: { payload: { kind: "advance_phase_by_deadline" } },
      outcome: { state: "reject", error: "InvalidTarget" },
    }),
    ["host"],
  );
  assert.deepEqual(
    hostPostCommandRefreshKeys({
      event: { payload: { kind: "advance_phase" } },
      outcome: { state: "reject", error: "InvalidTarget" },
    }),
    ["host"],
  );
  assert.deepEqual(
    hostPostCommandRefreshKeys({
      event: { payload: { kind: "resolve_host_prompt" } },
      outcome: { state: "reject", error: "PromptAlreadyResolved" },
    }),
    ["host", "hostPrompts"],
  );
  assert.deepEqual(
    hostPostCommandRefreshKeys({
      event: { payload: { kind: "resolve_day_event" } },
      outcome: { state: "reject", error: "DayEventStateConflict" },
    }),
    ["host"],
  );
  assert.deepEqual(
    hostPostCommandRefreshKeys({
      event: { payload: { kind: "complete_game" } },
      outcome: { state: "reject", error: "GameAlreadyCompleted" },
    }),
    ["host"],
  );
  assert.deepEqual(
    hostPostCommandRefreshKeys({
      event: { payload: { kind: "process_replacement" } },
      outcome: { state: "reject", error: "InvalidTarget" },
    }),
    [],
  );
  assert.deepEqual(
    hostPostCommandRefreshKeys({
      event: { payload: { kind: "extend_deadline" } },
      outcome: { state: "reject", error: "StreamConflict", retryable: true },
    }),
    ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  );
});

test("host route controller refreshes host projection after stale phase rejects", async () => {
  const projectionStore = fakeProjectionStore({
    host: { phase: { id: "D01", locked: false, state: "open" }, replacement: null },
  });

  const result = await sendHostRouteAction({
    event: { actionId: "lock_thread", payload: { kind: "lock_thread" } },
    data: fixtureData(),
    fetchImpl: async () => null,
    projectionStore,
    sendHostActionCommandImpl: async () => ({
      state: "reject",
      actionId: "lock_thread",
      error: "PhaseLocked",
      message: "Reject PhaseLocked",
    }),
  });

  assert.equal(result.outcome.message, "Reject PhaseLocked");
  assert.deepEqual(projectionStore.applied, []);
  assert.deepEqual(projectionStore.refreshed, [["host"]]);
  assert.deepEqual(result.snapshot.host.phase, {
    id: "D01",
    locked: true,
    state: "locked",
  });
});

test("host route controller refreshes host projection after stale deadline target rejects", async () => {
  const projectionStore = fakeProjectionStore({
    host: { phase: { id: "D01", locked: true, deadline: 1781928000 }, replacement: null },
  });

  const result = await sendHostRouteAction({
    event: {
      actionId: "advance_phase_by_deadline",
      payload: { kind: "advance_phase_by_deadline" },
    },
    data: fixtureData(),
    fetchImpl: async () => null,
    projectionStore,
    sendHostActionCommandImpl: async () => ({
      state: "reject",
      actionId: "advance_phase_by_deadline",
      error: "InvalidTarget",
      message: "Reject InvalidTarget",
    }),
  });

  assert.equal(result.outcome.message, "Reject InvalidTarget");
  assert.deepEqual(projectionStore.applied, []);
  assert.deepEqual(projectionStore.refreshed, [["host"]]);
  assert.deepEqual(result.snapshot.host.phase, {
    id: "D01",
    locked: true,
    state: "locked",
  });
});

test("host route controller refreshes host projection after stale advance target rejects", async () => {
  const projectionStore = fakeProjectionStore({
    host: { phase: { id: "D02", locked: true, state: "locked" }, replacement: null },
  });

  const result = await sendHostRouteAction({
    event: {
      actionId: "advance_phase",
      payload: { kind: "advance_phase" },
    },
    data: fixtureData(),
    fetchImpl: async () => null,
    projectionStore,
    sendHostActionCommandImpl: async () => ({
      state: "reject",
      actionId: "advance_phase",
      error: "InvalidTarget",
      message: "Reject InvalidTarget",
    }),
  });

  assert.equal(result.outcome.message, "Reject InvalidTarget");
  assert.deepEqual(projectionStore.applied, []);
  assert.deepEqual(projectionStore.refreshed, [["host"]]);
  assert.deepEqual(result.snapshot.host.phase, {
    id: "D01",
    locked: true,
    state: "locked",
  });
});

test("host route controller preserves non-phase reject outcomes without projection refresh", async () => {
  const projectionStore = fakeProjectionStore({
    host: { phase: { id: "D01", locked: false, state: "open" }, replacement: null },
  });

  const result = await sendHostRouteAction({
    event: {
      actionId: "process_replacement",
      payload: { kind: "process_replacement" },
    },
    data: fixtureData(),
    fetchImpl: async () => null,
    projectionStore,
    sendHostActionCommandImpl: async () => ({
      state: "reject",
      actionId: "process_replacement",
      error: "InvalidTarget",
      message: "Reject InvalidTarget",
    }),
  });

  assert.equal(result.outcome.message, "Reject InvalidTarget");
  assert.deepEqual(projectionStore.applied, []);
  assert.deepEqual(projectionStore.refreshed, []);
  assert.deepEqual(result.snapshot.host.phase, {
    id: "D01",
    locked: false,
    state: "open",
  });
});

function fixtureData(overrides = {}) {
  return {
    game: { id: "midsummer" },
    session: { principalUserId: "host_h" },
    commandEndpoint: "/commands",
    hostConsoleStateEndpoint: "/games/midsummer/host-console-state",
    hostVotecountEndpoint: "/games/midsummer/votecount",
    dayVoteOutcomesEndpoint: "/games/midsummer/day-vote-outcomes",
    hostPromptEndpoint: "/games/midsummer/host-prompts",
    authority: {
      principalUserId: "host_h",
      capabilityKind: "HostOf",
      allowedClasses: [],
      deniedClasses: [],
    },
    phase: { id: "D01", label: "Day 1", locked: false, state: "open" },
    replacement: null,
    votecount: [],
    dayVoteOutcomes: [],
    hostPrompts: [],
    hostTasks: [],
    ...overrides,
  };
}

function fakeProjectionStore(snapshot) {
  return {
    applied: [],
    refreshed: [],
    applyPayload(key, payload) {
      this.applied.push([key, payload]);
      snapshot = { ...snapshot, [key]: payload };
      return snapshot;
    },
    async refresh(keys) {
      this.refreshed.push(keys);
      snapshot = {
        ...snapshot,
        ...(keys.includes("host")
          ? {
              host: {
                phase: { id: "D01", locked: true, state: "locked" },
                replacement: null,
                tasks: [],
              },
            }
          : {}),
        ...(keys.includes("hostPrompts") ? { hostPrompts: [] } : {}),
      };
      return snapshot;
    },
    getSnapshot() {
      return snapshot;
    },
  };
}
