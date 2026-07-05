import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMAND_DISPATCH_BRIDGE_CONTRACT,
} from "../frontend/src/lib/app/command-dispatch-bridge.mjs";
import {
  hostConfirmationCommandTrace,
} from "../frontend/src/lib/components/host-action/host-action-contract.mjs";
import {
  mapHostActionToWireCommand,
} from "../frontend/src/lib/components/host-action/host-command-boundary.mjs";
import {
  adminConfirmStatus,
  buildAdminCommandDispatchBridgePlan,
  adminPendingStatus,
  adminRejectStatus,
  exposeAdminCommandDispatchBridgePlan,
  recordAdminCommandStatus,
  sendAdminSetupCommand,
} from "../frontend/src/routes/admin/admin-route-controller.mjs";
import {
  appendHostActionEvent,
  appendHostCommandOutcome,
  attachEventConfirmationTrace,
  buildHostCommandDispatchBridgePlan,
  hostCommandErrorOutcome,
  hostCommandPendingStatus,
  recordHostCommandStatus,
  sendHostRouteAction,
} from "../frontend/src/routes/g/[game]/host/host-route-controller.mjs";
import {
  exposeHostCommandDispatchBridgePlan,
} from "../frontend/src/routes/g/[game]/host/host-route-browser-bridge.mjs";
import {
  buildPlayerCommandDispatchBridgePlan,
  playerCommandPendingStatus,
  playerCommandTrace,
  recordPlayerCommandReceipt,
  submitPlayerRouteCommand,
} from "../frontend/src/routes/g/[game]/player-route-controller.mjs";
import {
  exposePlayerCommandDispatchBridgePlan,
} from "../frontend/src/routes/g/[game]/player-route-browser-bridge.mjs";
import {
  buildSetupCommandDispatchBridgePlan,
  exposeSetupRouteWindowState,
  recordSetupCommandStatus,
  sendHostSetupCommand,
  setupConfirmStatus,
  setupPendingStatus,
} from "../frontend/src/routes/g/[game]/setup/setup-route-controller.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-dispatch-bridge");
const evidencePath = path.join(artifactDir, "dispatch-bridge.json");

const evidence = {
  status: "passed",
  proof: COMMAND_DISPATCH_BRIDGE_CONTRACT.proof,
  boundary: COMMAND_DISPATCH_BRIDGE_CONTRACT.boundary,
  rolePlans: {
    admin: await proveAdminDispatchBridge(),
    player: await provePlayerDispatchBridge(),
    moderator: await proveModeratorDispatchBridge(),
    "host-setup": await proveHostSetupDispatchBridge(),
  },
  routeHandlerOwnership: await proveRouteHandlerOwnership(),
};

for (const role of COMMAND_DISPATCH_BRIDGE_CONTRACT.roles) {
  assert.equal(evidence.rolePlans[role]?.role, role, `missing ${role} plan`);
}

await mkdir(artifactDir, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

async function proveAdminDispatchBridge() {
  const item = {
    id: "cohost",
    commandAction: "add_cohost",
    confirmMessage: "Delegate cohost_c as cohost for this game",
  };
  const data = adminData();
  const confirmationStatus = adminConfirmStatus(item);
  const trace = confirmationStatus.confirmationTrace;
  const sent = [];
  let commandStatuses = {};
  const optimisticStatus = adminPendingStatus();
  commandStatuses = recordAdminCommandStatus(
    commandStatuses,
    trace.statusKey,
    optimisticStatus,
  );

  const ack = await sendAdminSetupCommand({
    item,
    data,
    fetchImpl: async () => {
      throw new Error("admin bridge proof should stay inside sendCommandImpl");
    },
    sendCommandImpl: async (request) => {
      sent.push(request);
      return {
        state: "ack",
        message: "Ack: stream seqs 61",
      };
    },
  });
  commandStatuses = recordAdminCommandStatus(
    commandStatuses,
    trace.statusKey,
    ack.outcome,
  );

  const rejectStatuses = recordAdminCommandStatus(
    recordAdminCommandStatus({}, trace.statusKey, optimisticStatus),
    trace.statusKey,
    adminRejectStatus(new Error("Reject Unauthorized: cohost scope missing")),
  );
  only(sent);
  const plan = buildAdminCommandDispatchBridgePlan({
    item,
    data,
    confirmationStatus,
    optimisticStatus,
    finalStatus: ack.outcome,
  });
  const windowRef = {};
  assert.equal(
    exposeAdminCommandDispatchBridgePlan({ windowRef, plan }),
    true,
  );

  assert.equal(trace.dispatchKind, "add_cohost");
  assert.equal(plan.commandKind, "AddCohost");
  assert.equal(commandStatuses[trace.statusKey].state, "ack");
  assert.equal(rejectStatuses[trace.statusKey].state, "reject");
  assert.equal(windowRef.__fmarchAdminCommandDispatchBridgePlan, plan);

  return {
    ...plan,
    exposureKey: "__fmarchAdminCommandDispatchBridgePlan",
    statusKey: trace.statusKey,
    ackStatus: commandStatuses[trace.statusKey],
    rejectStatus: rejectStatuses[trace.statusKey],
  };
}

async function proveRouteHandlerOwnership() {
  const routes = [
    await proveRouteSource({
      role: "admin",
      path: "frontend/src/routes/admin/+page.svelte",
      requiredSnippets: [
        "buildAdminCommandDispatchBridgePlan",
        "exposeAdminCommandDispatchBridgePlan",
        "exposeAdminFormResult",
        "confirmationStatus",
        "optimisticStatus",
      ],
      exposureKey: "__fmarchAdminCommandDispatchBridgePlan",
    }),
    await proveRouteSource({
      role: "player",
      path: "frontend/src/routes/g/[game]/+page.svelte",
      requiredSnippets: [
        "buildPlayerCommandDispatchBridgePlan",
        "exposePlayerCommandDispatchBridgePlan",
        "optimisticStatus",
        "finalStatus: commandStatus",
      ],
      exposureKey: "__fmarchPlayerCommandDispatchBridgePlan",
    }),
    await proveRouteSource({
      role: "moderator",
      path: "frontend/src/routes/g/[game]/host/+page.svelte",
      requiredSnippets: [
        "buildHostCommandDispatchBridgePlan",
        "exposeHostCommandDispatchBridgePlan",
        "optimisticStatus",
        "finalStatus: tracedOutcome",
      ],
      exposureKey: "__fmarchHostCommandDispatchBridgePlan",
    }),
    await proveRouteSource({
      role: "host-setup",
      path: "frontend/src/routes/g/[game]/setup/+page.svelte",
      requiredSnippets: [
        "buildSetupCommandDispatchBridgePlan",
        "exposeSetupRouteWindowState",
        "confirmationStatus",
        "optimisticStatus",
      ],
      exposureKey: "__fmarchHostSetupCommandDispatchBridgePlan",
    }),
  ];

  return {
    boundary:
      "Static source ownership proof that each Svelte route handler calls its role-owned dispatch bridge helper and exposes the resulting plan for smoke evidence. This does not prove browser event delivery.",
    routes,
  };
}

async function proveHostSetupDispatchBridge() {
  const actionId = "start-game";
  const data = hostSetupData();
  const formData = setupFormData({ phase: "D01" });
  const confirmationStatus = setupConfirmStatus(actionId, "Start midsummer at D01");
  const optimisticStatus = setupPendingStatus();
  let commandStatuses = recordSetupCommandStatus({}, actionId, optimisticStatus);
  const sent = [];
  const finalStatus = await sendHostSetupCommand({
    actionId,
    data,
    formData,
    fetchImpl: async () => {
      throw new Error("host setup bridge proof should stay inside sendCommandImpl");
    },
    sendCommandImpl: async (request) => {
      sent.push(request);
      return {
        state: "ack",
        message: "Ack: stream seqs 82",
      };
    },
  });
  commandStatuses = recordSetupCommandStatus(commandStatuses, actionId, finalStatus);
  const plan = buildSetupCommandDispatchBridgePlan({
    actionId,
    data,
    formData,
    confirmationStatus,
    optimisticStatus,
    finalStatus,
  });
  const windowRef = {};
  assert.equal(
    exposeSetupRouteWindowState({
      windowRef,
      commandStatuses,
      setupState: data.setupState,
      readiness: data.readiness,
      outcome: finalStatus,
      plan,
    }),
    true,
  );

  assert.equal(plan.role, "host-setup");
  assert.equal(plan.commandKind, "StartGame");
  assert.deepEqual(plan.projectionRefreshKeys, ["setupState"]);
  assert.deepEqual(only(sent).command.StartGame, {
    game: "midsummer",
    phase: "D01",
  });
  assert.equal(commandStatuses[actionId].state, "ack");
  assert.equal(windowRef.__fmarchHostSetupCommandDispatchBridgePlan, plan);

  return {
    ...plan,
    exposureKey: "__fmarchHostSetupCommandDispatchBridgePlan",
    statusKey: actionId,
    ackStatus: commandStatuses[actionId],
  };
}

async function provePlayerDispatchBridge() {
  const data = playerData({ channel: "main" });
  const trace = playerCommandTrace("submit_vote");
  const ackPath = await provePlayerPath({
    trace,
    data,
    composerBody: "vote: slot-2",
    outcome: {
      state: "ack",
      message: "Ack: stream seqs 71",
    },
  });
  const rejectPath = await provePlayerPath({
    trace,
    data,
    composerBody: "vote: slot-2",
    outcome: {
      state: "reject",
      message: "Reject PhaseLocked: reload and retry",
    },
  });
  const postTrace = playerCommandTrace("submit_post");
  const postPath = await provePlayerPath({
    trace: postTrace,
    data: playerData({ channel: "role-pm" }),
    composerBody: "private role note",
    outcome: {
      state: "ack",
      message: "Ack: stream seqs 72",
    },
  });
  const plan = buildPlayerCommandDispatchBridgePlan({
    data,
    action: trace.dispatchKind,
    composerBody: "vote: slot-2",
    optimisticStatus: ackPath.optimisticReceipt,
    finalStatus: ackPath.finalReceipt,
  });
  const windowRef = {};
  assert.equal(
    exposePlayerCommandDispatchBridgePlan({ windowRef, plan }),
    true,
  );

  assert.equal(trace.dispatchKind, "submit_vote");
  assert.equal(plan.commandKind, "SubmitVote");
  assert.deepEqual(ackPath.refreshed, [["votecount"]]);
  assert.deepEqual(rejectPath.refreshed, []);
  assert.equal(rejectPath.finalReceipt.state, "reject");
  assert.equal(commandKind(postPath.request.command), "SubmitPost");
  assert.deepEqual(postPath.refreshed, [["thread", "votecount", "dayVoteOutcomes"]]);
  assert.deepEqual(postPath.request.command.SubmitPost, {
    game: "midsummer",
    channel_id: "role-pm",
    actor_slot: "slot-7",
    body: "private role note",
  });
  assert.equal(windowRef.__fmarchPlayerCommandDispatchBridgePlan, plan);

  return {
    ...plan,
    exposureKey: "__fmarchPlayerCommandDispatchBridgePlan",
    ackPath: pathSummary(ackPath),
    rejectPath: pathSummary(rejectPath),
    postPath: pathSummary(postPath),
  };
}

async function provePlayerPath({ trace, data, composerBody, outcome }) {
  const sent = [];
  const projectionStore = fakeProjectionStore({
    thread: { posts: [] },
    votecount: [],
    notifications: [],
    investigationResults: [],
  });
  const pendingReceipts = recordPlayerCommandReceipt(
    [],
    trace.actionId,
    playerCommandPendingStatus(trace.dispatchKind),
  );
  const result = await submitPlayerRouteCommand({
    action: trace.dispatchKind,
    composerBody,
    data,
    fetchImpl: async () => {
      throw new Error("player bridge proof should stay inside sendCommandImpl");
    },
    projectionStore,
    sendCommandImpl: async (request) => {
      sent.push(request);
      return outcome;
    },
  });
  const commandReceipts = recordPlayerCommandReceipt(
    pendingReceipts,
    trace.actionId,
    result.commandStatus,
  );
  return {
    request: only(sent),
    optimisticReceipt: only(pendingReceipts),
    finalReceipt: commandReceipts[commandReceipts.length - 1],
    refreshed: projectionStore.refreshed,
    snapshot: result.snapshot,
  };
}

async function proveModeratorDispatchBridge() {
  const event = moderatorHostPromptEvent();
  const slotLifecycleEvent = moderatorSlotLifecycleEvent();
  const trace = event.confirmationTrace;
  const sent = [];
  const projectionStore = fakeProjectionStore({
    host: {
      phase: { id: "D01" },
      replacement: null,
    },
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
  let dispatched = appendHostActionEvent([], event);
  let commandOutcomes = [];
  const optimisticStatus = hostCommandPendingStatus(event);
  let commandStatuses = recordHostCommandStatus(
    {},
    event.actionId,
    optimisticStatus,
  );
  const result = await sendHostRouteAction({
    event,
    data: moderatorData(),
    fetchImpl: async () => {
      throw new Error("moderator bridge proof should stay inside send impl");
    },
    projectionStore,
    sendHostActionCommandImpl: async (request) => {
      sent.push(request);
      return {
        state: "ack",
        actionId: request.actionEvent.actionId,
        message: "Ack",
      };
    },
  });
  const tracedOutcome = attachEventConfirmationTrace(result.outcome, event);
  commandOutcomes = appendHostCommandOutcome(commandOutcomes, tracedOutcome);
  commandStatuses = recordHostCommandStatus(
    commandStatuses,
    event.actionId,
    tracedOutcome,
  );
  const rejectOutcome = hostCommandErrorOutcome({
    actionId: event.actionId,
    error: new Error("Reject PhaseLocked: prompt already resolved"),
    event,
  });
  only(sent);
  const plan = buildHostCommandDispatchBridgePlan({
    event,
    data: moderatorData(),
    optimisticStatus,
    finalStatus: tracedOutcome,
  });
  const windowRef = {};
  assert.equal(
    exposeHostCommandDispatchBridgePlan({ windowRef, plan }),
    true,
  );

  assert.equal(trace.dispatchKind, "resolve_host_prompt");
  assert.equal(plan.commandKind, "ResolveHostPrompt");
  assert.deepEqual(projectionStore.refreshed, [["hostPrompts"]]);
  assert.equal(commandStatuses[event.actionId].state, "ack");
  assert.equal(rejectOutcome.state, "reject");
  assert.equal(windowRef.__fmarchHostCommandDispatchBridgePlan, plan);

  const slotLifecyclePath = await proveModeratorSlotLifecyclePath({
    event: slotLifecycleEvent,
  });

  return {
    ...plan,
    exposureKey: "__fmarchHostCommandDispatchBridgePlan",
    dispatchedCount: dispatched.length,
    commandOutcomeCount: commandOutcomes.length,
    ackStatus: commandStatuses[event.actionId],
    rejectStatus: rejectOutcome,
    slotLifecyclePath,
  };
}

async function proveModeratorSlotLifecyclePath({ event }) {
  const sent = [];
  const projectionStore = fakeProjectionStore({
    host: {
      phase: { id: "D01" },
      replacement: {
        slotId: "slot-7",
        lifecycleLabel: "Alive",
        historyLabel: "Slot history remains attached to slot-7",
      },
    },
    votecount: [],
    hostPrompts: [],
  });
  let dispatched = appendHostActionEvent([], event);
  let commandOutcomes = [];
  const optimisticStatus = hostCommandPendingStatus(event);
  let commandStatuses = recordHostCommandStatus(
    {},
    event.actionId,
    optimisticStatus,
  );
  const result = await sendHostRouteAction({
    event,
    data: moderatorData(),
    fetchImpl: async () => {
      throw new Error("moderator slot lifecycle proof should stay inside send impl");
    },
    projectionStore,
    sendHostActionCommandImpl: async (request) => {
      sent.push(request);
      return {
        state: "ack",
        actionId: request.actionEvent.actionId,
        message: "Ack",
      };
    },
  });
  const tracedOutcome = attachEventConfirmationTrace(result.outcome, event);
  commandOutcomes = appendHostCommandOutcome(commandOutcomes, tracedOutcome);
  commandStatuses = recordHostCommandStatus(
    commandStatuses,
    event.actionId,
    tracedOutcome,
  );
  only(sent);
  const requestCommand = mapHostActionToWireCommand(event);
  const plan = buildHostCommandDispatchBridgePlan({
    event,
    data: moderatorData(),
    optimisticStatus,
    finalStatus: tracedOutcome,
  });
  const windowRef = {};
  assert.equal(
    exposeHostCommandDispatchBridgePlan({ windowRef, plan }),
    true,
  );

  assert.equal(event.confirmationTrace.dispatchKind, "modkill_slot");
  assert.equal(plan.commandKind, "SetSlotStatus");
  assert.deepEqual(requestCommand.SetSlotStatus, {
    game: "midsummer",
    slot: "slot-7",
    status: "modkilled",
  });
  assert.deepEqual(projectionStore.refreshed, []);
  assert.equal(commandStatuses[event.actionId].state, "ack");
  assert.equal(windowRef.__fmarchHostCommandDispatchBridgePlan, plan);

  return {
    ...plan,
    requestCommand,
    dispatchedCount: dispatched.length,
    commandOutcomeCount: commandOutcomes.length,
    ackStatus: commandStatuses[event.actionId],
    refreshed: projectionStore.refreshed,
  };
}

async function proveRouteSource({
  role,
  path: relativePath,
  requiredSnippets,
  exposureKey,
}) {
  const source = await readFile(path.join(repoRoot, relativePath), "utf8");
  for (const snippet of requiredSnippets) {
    assert.equal(
      source.includes(snippet),
      true,
      `${relativePath} missing ${snippet}`,
    );
  }
  return {
    role,
    path: relativePath,
    requiredSnippets,
    exposureKey,
  };
}

function adminData() {
  return {
    operator: {
      principalUserId: "admin_a",
    },
    command: {
      endpoint: "/commands",
      createGame: {
        action: "create_game",
        game: "midsummer",
        pack: "mafiascum",
      },
      cohost: {
        action: "add_cohost",
        game: "midsummer",
        user: "cohost_c",
      },
    },
  };
}

function playerData({ channel }) {
  return {
    game: { id: "midsummer" },
    player: { principalUserId: "player_mira", slotId: "slot-7" },
    composer: {
      commandEndpoint: "/commands",
      voteTargetSlot: "slot-2",
    },
    threadPager: { pageSize: 50, channel },
  };
}

function moderatorData() {
  return {
    game: { id: "midsummer" },
    session: { principalUserId: "host_h" },
    commandEndpoint: "/commands",
    hostConsoleStateEndpoint: "/games/midsummer/host-console-state",
    hostVotecountEndpoint: "/games/midsummer/votecount",
    hostPromptEndpoint: "/games/midsummer/host-prompts",
  };
}

function hostSetupData() {
  return {
    game: { id: "midsummer" },
    session: { principalUserId: "host_h" },
    commandEndpoint: "/commands",
    setupStateEndpoint: "/games/midsummer/setup-state?principal_user_id=host_h",
    start: { defaultPhase: "D01" },
    setupState: {
      game: "midsummer",
      phase: null,
      pack: {
        key: "mafiascum",
        name: "Mafiascum",
        valid: true,
        roleKeys: ["vanilla_townie", "mafia_goon"],
        startPhaseOptions: ["D01"],
      },
      slots: [
        {
          slotId: "slot_1",
          occupantUserId: "player_mira",
          roleKey: "vanilla_townie",
        },
      ],
      postPolicies: [{ channelId: "main", allowMediaOnly: true }],
    },
    readiness: {
      summary: "Ready to start",
      startAvailable: true,
    },
  };
}

function setupFormData(values) {
  return {
    get(field) {
      return values[field] ?? null;
    },
  };
}

function moderatorHostPromptEvent() {
  const actionId = "resolve_host_prompt-D01-skip_next_day-slot_1";
  return Object.freeze({
    actionId,
    confirmationTrace: hostConfirmationCommandTrace({
      id: actionId,
      label: "Resolve prompt",
      objectLabel: "skip_next_day prompt",
      outcomeLabel: "acknowledge prompt",
      confirmationText:
        "Resolve skip_next_day prompt: acknowledge prompt for skip_next_day prompt.",
      requiresConfirmation: true,
      payload: {
        kind: "resolve_host_prompt",
        gameId: "midsummer",
        promptId: "D01:skip_next_day:slot_1",
        decision: { kind: "acknowledge" },
      },
    }),
    payload: {
      kind: "resolve_host_prompt",
      gameId: "midsummer",
      promptId: "D01:skip_next_day:slot_1",
      decision: { kind: "acknowledge" },
    },
  });
}

function moderatorSlotLifecycleEvent() {
  const actionId = "modkill_slot";
  return Object.freeze({
    actionId,
    confirmationTrace: hostConfirmationCommandTrace({
      id: actionId,
      label: "Modkill slot",
      objectLabel: "slot-7",
      outcomeLabel: "modkilled",
      confirmationText: "Mark slot-7 as modkilled and preserve slot history.",
      requiresConfirmation: true,
      payload: {
        kind: "modkill_slot",
        gameId: "midsummer",
        slotId: "slot-7",
        status: "modkilled",
      },
    }),
    payload: {
      kind: "modkill_slot",
      gameId: "midsummer",
      slotId: "slot-7",
      status: "modkilled",
    },
  });
}

function fakeProjectionStore(snapshot) {
  return {
    refreshed: [],
    applyPayload(key, payload) {
      snapshot = { ...snapshot, [key]: payload };
      return snapshot;
    },
    async refresh(keys) {
      this.refreshed.push([...keys]);
      snapshot = {
        ...snapshot,
        ...Object.fromEntries(keys.map((key) => [key, refreshedValue(key)])),
      };
      return snapshot;
    },
    getSnapshot() {
      return snapshot;
    },
  };
}

function refreshedValue(key) {
  switch (key) {
    case "thread":
      return { posts: [], nextBeforeSeq: null };
    case "votecount":
    case "hostPrompts":
      return [];
    default:
      return null;
  }
}

function only(items) {
  assert.equal(items.length, 1);
  return items[0];
}

function commandKind(command) {
  return Object.keys(command)[0];
}

function pathSummary(pathEvidence) {
  return {
    commandKind: commandKind(pathEvidence.request.command),
    optimisticReceipt: pathEvidence.optimisticReceipt,
    finalReceipt: pathEvidence.finalReceipt,
    refreshed: pathEvidence.refreshed,
  };
}
