import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { FIXTURE_PRINCIPAL_IDS } from "../../../../lib/principal-id.mjs";
import {
  appendHostActionEvent,
  appendHostCommandOutcome,
  buildHostCommandDispatchBridgePlan,
  buildHostCommandRequest,
  buildHostDerivedState,
  buildHostProjectionColdLoads,
  buildHostProjectionInitialSnapshot,
  hostCommandErrorOutcome,
  hostCommandInterruptedOutcome,
  hostCommandPendingStatus,
  persistHostInterruptedCommands,
  hostPostAckRefreshKeys,
  hostPostCommandRefreshKeys,
  hostReconnectRefreshKeys,
  recordHostCommandStatus,
  revokedHostProjection,
  restoreHostInterruptedCommands,
  clearHostCommandStatus,
  dispatchHostRouteAction,
  recoverHostRouteAction,
  sendHostRouteAction,
} from "./host-route-controller.mjs";

const HOST_PRINCIPAL_ID = FIXTURE_PRINCIPAL_IDS.hostH;
import {
  CommandInterruptedError,
  CommandProjectionRecoveryTimeoutError,
} from "../../../../lib/app/command-interruption.mjs";

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

test("host interrupted commands survive sessionStorage reload with the same command id", () => {
  const storage = memoryStorage();
  const event = {
    actionId: "extend_deadline",
    hours: 12,
    confirmationTrace: {
      kind: "confirmation-command-trace",
      confirmationKind: "confirmation-action",
      surface: "moderator-host",
      actionId: "extend_deadline",
      statusKey: "extend_deadline",
      dispatchKind: "extend_deadline",
    },
  };
  persistHostInterruptedCommands({
    storage,
    game: "midsummer",
    principalId: HOST_PRINCIPAL_ID,
    attempts: {
      extend_deadline: {
        commandId: "host-command-1",
        actionId: "extend_deadline",
        interruption: "timeout",
        command: {
          ExtendDeadline: {
            game: "midsummer",
            phase: "D01",
            at: 1_800_000_000,
          },
        },
        event,
      },
    },
  });

  const restored = restoreHostInterruptedCommands({
    storage,
    game: "midsummer",
    principalId: HOST_PRINCIPAL_ID,
  });

  assert.equal(restored.attempts.extend_deadline.commandId, "host-command-1");
  assert.equal(restored.commandStatuses.extend_deadline.commandId, "host-command-1");
  assert.equal(restored.commandStatuses.extend_deadline.state, "interrupted");
  assert.equal(restored.attempts.extend_deadline.event.hours, 12);
  assert.deepEqual(restored.attempts.extend_deadline.command, {
    ExtendDeadline: {
      game: "midsummer",
      phase: "D01",
      at: 1_800_000_000,
    },
  });
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
  assert.deepEqual(hostReconnectRefreshKeys(), [
    "host",
    "votecount",
    "dayVoteOutcomes",
    "hostPrompts",
  ]);
  const coldLoads = buildHostProjectionColdLoads(data);
  assert.deepEqual(coldLoads.host.revoke(), revokedHostProjection());
  assert.deepEqual(coldLoads.hostPrompts.revoke, []);
  assert.deepEqual(
    buildHostDerivedState({
      gameId: data.game.id,
      snapshot: {
        host: coldLoads.host.revoke(),
        votecount: [],
        dayVoteOutcomes: [],
        hostPrompts: [],
      },
    }).criticalActions,
    [],
  );
});

test("host cold load normalizes an empty game after authority revocation", () => {
  const data = fixtureData();
  const host = buildHostProjectionColdLoads(data).host.normalize(
    {
      game: "midsummer",
      authority: {
        principal_id: HOST_PRINCIPAL_ID,
        capability: "HostOf",
        allowed_classes: [],
        denied_classes: [],
      },
      completed: false,
      phase: null,
      slots: [],
      thread_posts: [],
      day_event_scheduler: null,
      day_events: [],
      tasks: [],
    },
    revokedHostProjection(),
  );

  assert.equal(host.replacement, null);
  assert.equal(host.authority.principalId, HOST_PRINCIPAL_ID);
  assert.equal(host.authority.capabilityKind, "HostOf");
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

test("host route controller refuses commands before dispatch when route authority is disabled", async () => {
  let fetchCalls = 0;
  let sendCalls = 0;

  await assert.rejects(
    sendHostRouteAction({
      event: {
        actionId: "lock_thread",
        payload: { kind: "lock_thread", gameId: "midsummer" },
      },
      data: {
        ...fixtureData(),
        commandsEnabled: false,
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("disabled host commands must not reach fetch");
      },
      projectionStore: fakeProjectionStore(),
      sendHostActionCommandImpl: async () => {
        sendCalls += 1;
        throw new Error("disabled host commands must not reach dispatch");
      },
    }),
    /host commands are disabled without an authoritative route snapshot/,
  );

  assert.equal(fetchCalls, 0);
  assert.equal(sendCalls, 0);
});

test("host interrupted retry sends the persisted wire body or refuses mapper drift locally", async () => {
  const event = {
    actionId: "lock_thread",
    payload: { kind: "lock_thread", gameId: "midsummer" },
  };
  const data = fixtureData();
  const preparedCommand = buildHostCommandRequest({ event, data }).command;
  const sent = [];

  const outcome = await dispatchHostRouteAction({
    event,
    data,
    projectionStore: fakeProjectionStore(buildHostProjectionInitialSnapshot(data)),
    preparedCommand,
    commandIdFactory: () => "persisted-host-command-id",
    sendHostActionCommandImpl: async (request) => {
      sent.push(request);
      return { state: "ack", commandId: request.commandIdFactory(), message: "Ack" };
    },
  });
  assert.equal(outcome.state, "ack");
  assert.equal(sent[0].preparedCommand, preparedCommand);
  assert.equal(sent[0].commandIdFactory(), "persisted-host-command-id");
  assert.equal("stateEndpoint" in sent[0], false);

  let driftedSendCalls = 0;
  await assert.rejects(
    dispatchHostRouteAction({
      event,
      data,
      projectionStore: fakeProjectionStore(buildHostProjectionInitialSnapshot(data)),
      preparedCommand,
      mapHostActionToWireCommandImpl: () => ({
        LockThreadV2: { game: "midsummer", expected_revision: 4 },
      }),
      sendHostActionCommandImpl: async () => {
        driftedSendCalls += 1;
        return { state: "ack", message: "must not dispatch" };
      },
    }),
    /no longer matches the interrupted command body/,
  );
  assert.equal(driftedSendCalls, 0);
});

test("host ACK remains committed when projection recovery exceeds its independent 12s lease", async () => {
  let refreshStarted = false;
  const projectionStore = fakeProjectionStore();
  projectionStore.refresh = () => {
    refreshStarted = true;
    return new Promise(() => {});
  };

  const result = await recoverHostRouteAction({
    event: {
      actionId: "resolve_phase",
      payload: { kind: "resolve_phase", gameId: "midsummer" },
    },
    outcome: {
      state: "ack",
      commandId: "confirmed-host-command",
      message: "Ack: stream seq 8",
    },
    projectionStore,
    projectionRecoveryTimeoutMs: 12_000,
    executeProjectionRecoveryImpl: async ({ timeoutMs, operation }) => {
      assert.equal(timeoutMs, 12_000);
      operation({ signal: new AbortController().signal });
      throw new CommandProjectionRecoveryTimeoutError();
    },
  });

  assert.equal(refreshStarted, true);
  assert.equal(result.outcome.state, "ack");
  assert.equal(result.outcome.commandId, "confirmed-host-command");
  assert.equal(result.outcome.projectionUnavailable, true);
  assert.equal(result.outcome.retryable, false);
  assert.match(result.outcome.message, /Do not retry/);
  assert.equal(
    projectionStore.invalidated.at(-1)[1].reason,
    "confirmed_host_command_projection_recovery_failed",
  );
});

test("host page journals exact wire commands and clears recovery before projection recovery", async () => {
  const source = await readFile(new URL("./+page.svelte", import.meta.url), "utf8");
  const handler = source.slice(
    source.indexOf("async function handleDispatch"),
    source.indexOf("async function retryHostCommand"),
  );

  assert.match(
    handler,
    /command: buildHostCommandRequest\(\{ event, data \}\)\.command/u,
  );
  assert.match(
    handler,
    /const recoveryPersisted = commitHostCommandRecovery\(\{[\s\S]*?\[event\.actionId\]:[\s\S]*?\}\);\s*if \(recoveryPersisted !== true\) \{[\s\S]*?return;\s*\}\s*try \{\s*const confirmedOutcome = await executeCommandAttempt/u,
  );
  assert.match(handler, /preparedCommand: attempt\.command/u);
  assert.match(
    handler,
    /delete nextAttempts\[event\.actionId\];\s*commitHostCommandRecovery\(nextAttempts\);\s*const result = await recoverHostRouteAction/u,
  );
});

test("host route controller sends commands and applies acked host projection state", async () => {
  const sent = [];
  const projectionStore = fakeProjectionStore({
    host: { phase: { id: "D01", locked: true, state: "locked" }, replacement: null },
  });
  const projectionState = {
    phase: { id: "N01" },
    replacement: { slotId: "slot-7" },
  };

  const result = await sendHostRouteAction({
    event: {
      actionId: "advance_phase",
      payload: { kind: "advance_phase", gameId: "midsummer" },
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
        projectionState,
      };
    },
  });

  assert.equal(sent.length, 1);
  assert.equal("principalId" in sent[0], false);
  assert.equal(sent[0].endpoint, "/commands");
  assert.equal("stateEndpoint" in sent[0], false);
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
    event: {
      actionId: "lock_thread",
      payload: { kind: "lock_thread", gameId: "midsummer" },
    },
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
      payload: {
        kind: "advance_phase_by_deadline",
        gameId: "midsummer",
        phaseId: "D01",
        observedAt: 1781928001,
      },
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
      payload: { kind: "advance_phase", gameId: "midsummer" },
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
      actionId: "publish_votecount",
      payload: { kind: "publish_votecount", gameId: "midsummer" },
    },
    data: fixtureData(),
    fetchImpl: async () => null,
    projectionStore,
    sendHostActionCommandImpl: async () => ({
      state: "reject",
      actionId: "publish_votecount",
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
    commandsEnabled: true,
    game: { id: "midsummer" },
    deadlineClock: { nowSeconds: 1781928001 },
    commandPrincipalId: HOST_PRINCIPAL_ID,
    access: {
      allowed: true,
      capability: { kind: "HostOf", game: "midsummer" },
    },
    session: { principalId: HOST_PRINCIPAL_ID },
    commandEndpoint: "/commands",
    hostConsoleStateEndpoint: "/games/midsummer/host-console-state",
    hostVotecountEndpoint: "/api/gameplay/games/midsummer/votecount",
    dayVoteOutcomesEndpoint:
      "/api/gameplay/games/midsummer/day-vote-outcomes",
    hostPromptEndpoint: "/games/midsummer/host-prompts",
    authority: {
      principalId: HOST_PRINCIPAL_ID,
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
    invalidated: [],
    isReady() {
      return true;
    },
    invalidate(keys, options) {
      this.invalidated.push([keys, options]);
    },
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

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}
