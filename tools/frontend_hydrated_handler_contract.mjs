import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAdminCommandActivityViewModel,
} from "../frontend/src/lib/components/admin/admin-surface-model.mjs";
import {
  buildHostCommandActivityViewModel,
} from "../frontend/src/lib/components/host-action/host-command-activity.mjs";
import {
  hostConfirmationCommandTrace,
} from "../frontend/src/lib/components/host-action/host-action-contract.mjs";
import {
  mapHostActionToWireCommand,
  projectHostConsoleState,
} from "../frontend/src/lib/components/host-action/host-command-boundary.mjs";
import {
  buildPlayerCommandReceiptViewModel,
} from "../frontend/src/lib/components/player-command/player-command-receipt-model.mjs";
import {
  adminConfirmStatus,
  adminPendingStatus,
  adminRejectStatus,
  buildAdminCommandDispatchBridgePlan,
  exposeAdminCommandDispatchBridgePlan,
  exposeAdminCommandOutcome,
  exposeAdminFormResult,
  recordAdminCommandStatus,
  recordAdminFormStatus,
  sendAdminSetupCommand,
} from "../frontend/src/routes/admin/admin-route-controller.mjs";
import {
  buildHostCommandDispatchBridgePlan,
  appendHostActionEvent,
  appendHostCommandOutcome,
  attachEventConfirmationTrace,
  hostCommandErrorOutcome,
  hostCommandPendingStatus,
  recordHostCommandStatus,
  sendHostRouteAction,
} from "../frontend/src/routes/g/[game]/host/host-route-controller.mjs";
import {
  exposeHostCommandDispatchBridgePlan,
  exposeHostRouteWindowState,
} from "../frontend/src/routes/g/[game]/host/host-route-browser-bridge.mjs";
import {
  buildPlayerCommandDispatchBridgePlan,
  playerCommandErrorStatus,
  playerCommandPendingStatus,
  recordPlayerCommandReceipt,
  submitPlayerRouteCommand,
} from "../frontend/src/routes/g/[game]/player-route-controller.mjs";
import {
  exposePlayerCommandDispatchBridgePlan,
  exposePlayerCommandReceipts,
  exposePlayerCommandStatus,
  exposePlayerProjection,
} from "../frontend/src/routes/g/[game]/player-route-browser-bridge.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-hydrated-handlers");
const evidencePath = path.join(artifactDir, "hydrated-handlers.json");

const evidence = {
  status: "passed",
  proof: "frontend-hydrated-handler-contract",
  boundary:
    "No-localhost command handler harness. It executes the same controller and browser-bridge functions used by hydrated admin, player, and moderator route handlers, then verifies DOM-facing view models and smoke-exposed bridge plans. It does not prove browser pointer events, Svelte hydration scheduling, focus traversal, pixels, TCP transport, or WebSocket delivery.",
  roles: {
    admin: await proveAdminHandlers(),
    player: await provePlayerHandlers(),
    moderator: await proveModeratorHandlers(),
  },
};

await mkdir(artifactDir, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

async function proveAdminHandlers() {
  const item = {
    id: "cohost",
    commandAction: "add_cohost",
    confirmMessage: "Delegate cohost_c as cohost for this game",
  };
  const data = adminData();
  const windowRef = {};
  const confirmationStatus = adminConfirmStatus(item);
  const optimisticStatus = adminPendingStatus();
  let commandStatuses = recordAdminCommandStatus(
    {},
    item.id,
    optimisticStatus,
  );
  const sent = [];
  const result = await sendAdminSetupCommand({
    item,
    data,
    fetchImpl: async () => {
      throw new Error("admin handler harness should stay inside sendCommandImpl");
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
    item.id,
    result.outcome,
  );
  const ackPlan = buildAdminCommandDispatchBridgePlan({
    item,
    data,
    confirmationStatus,
    optimisticStatus,
    finalStatus: result.outcome,
  });
  exposeAdminCommandDispatchBridgePlan({ windowRef, plan: ackPlan });
  exposeAdminCommandOutcome({
    windowRef,
    commandStatuses,
    outcome: result.outcome,
  });
  const ackView = buildAdminCommandActivityViewModel({ commandStatuses });
  const ackRow = rowByAction(ackView.items, item.id);

  const rejectStatus = adminRejectStatus(
    new Error("Reject Unauthorized: cohost scope missing"),
  );
  const rejectPlan = buildAdminCommandDispatchBridgePlan({
    item,
    data,
    confirmationStatus,
    optimisticStatus,
    finalStatus: rejectStatus,
  });
  const rejectView = buildAdminCommandActivityViewModel({
    commandStatuses: recordAdminCommandStatus({}, item.id, rejectStatus),
  });
  const rejectRow = rowByAction(rejectView.items, item.id);

  assert.equal(only(sent).command.AddCohost.user, "cohost_c");
  assert.equal(ackRow.state, "ack");
  assert.equal(rejectRow.state, "reject");
  assert.equal(windowRef.__fmarchAdminCommandDispatchBridgePlan, ackPlan);
  assert.equal(windowRef.__fmarchAdminCommandOutcome.state, "ack");

  const sessionGrant = recordAdminFormStatus({
    commandStatuses,
    lastFormStatusKey: "",
    form: {
      id: "session-grants",
      state: "ack",
      message: "Granted GlobalMod to mod_a",
      principalUserId: "mod_a",
      capabilityKinds: "GlobalMod",
    },
  });
  commandStatuses = sessionGrant.commandStatuses;
  exposeAdminFormResult({
    windowRef,
    form: commandStatuses["session-grants"],
  });
  const recoveryGate = recordAdminFormStatus({
    commandStatuses,
    lastFormStatusKey: sessionGrant.lastFormStatusKey,
    form: {
      id: "recovery-gate",
      state: "ack",
      message: "Recovery gate trusted: 3/3 production artifacts trusted",
      trusted: 3,
      total: 3,
      nonTrusted: 0,
    },
  });
  commandStatuses = recoveryGate.commandStatuses;
  exposeAdminFormResult({
    windowRef,
    form: commandStatuses["recovery-gate"],
  });
  const formView = buildAdminCommandActivityViewModel({ commandStatuses });
  const sessionGrantRow = rowByAction(formView.items, "session-grants");
  const recoveryGateRow = rowByAction(formView.items, "recovery-gate");

  assert.equal(sessionGrantRow.state, "ack");
  assert.equal(recoveryGateRow.state, "ack");
  assert.equal(windowRef.__fmarchAdminSessionGrantResult.id, "session-grants");
  assert.equal(windowRef.__fmarchAdminRecoveryGateResult.id, "recovery-gate");
  assert.equal(windowRef.__fmarchAdminLatestFormResult.id, "recovery-gate");

  return {
    component: "admin-command-activity",
    actionId: item.id,
    commandKind: ackPlan.commandKind,
    exposureKey: "__fmarchAdminCommandDispatchBridgePlan",
    ack: visibleStatus(ackRow),
    reject: visibleStatus(rejectRow),
    forms: {
      sessionGrant: visibleStatus(sessionGrantRow),
      recoveryGate: visibleStatus(recoveryGateRow),
      exposureKeys: [
        "__fmarchAdminFormResults",
        "__fmarchAdminSessionGrantResult",
        "__fmarchAdminRecoveryGateResult",
      ],
    },
  };
}

async function provePlayerHandlers() {
  const voteData = playerData({ channel: "main" });
  const postData = playerData({ channel: "private:role_pm:slot-7" });
  const voteAck = await provePlayerHandlerPath({
    action: "submit_vote",
    composerBody: "vote: slot-2",
    data: voteData,
    outcome: {
      state: "ack",
      message: "Ack: stream seqs 71",
    },
  });
  const voteReject = await provePlayerHandlerPath({
    action: "submit_vote",
    composerBody: "vote: slot-2",
    data: voteData,
    outcome: {
      state: "reject",
      message: "Reject PhaseLocked: reload and retry",
    },
  });
  const postAck = await provePlayerHandlerPath({
    action: "submit_post",
    composerBody: "private role note",
    data: postData,
    outcome: {
      state: "ack",
      message: "Ack: stream seqs 72",
    },
  });

  assert.equal(voteAck.visible.state, "ack");
  assert.equal(voteReject.visible.state, "reject");
  assert.equal(postAck.visible.state, "ack");
  assert.deepEqual(voteAck.refreshed, [["votecount"]]);
  assert.deepEqual(voteReject.refreshed, []);
  assert.deepEqual(postAck.refreshed, [["thread", "votecount", "dayVoteOutcomes"]]);

  return {
    component: "player-command-receipt",
    exposureKey: "__fmarchPlayerCommandDispatchBridgePlan",
    commands: {
      vote: {
        actionId: "submit_vote",
        commandKind: voteAck.plan.commandKind,
        ack: voteAck.visible,
        reject: voteReject.visible,
        ackRefreshKeys: voteAck.refreshed[0],
        rejectRefreshKeys: voteReject.refreshed,
      },
      post: {
        actionId: "submit_post",
        commandKind: postAck.plan.commandKind,
        ack: postAck.visible,
        ackRefreshKeys: postAck.refreshed[0],
        channelId: "private:role_pm:slot-7",
      },
    },
  };
}

async function provePlayerHandlerPath({
  action,
  composerBody,
  data,
  outcome,
}) {
  const windowRef = {};
  const projectionStore = fakeProjectionStore({
    thread: { posts: [] },
    votecount: [],
    notifications: [],
    investigationResults: [],
  });
  const optimisticStatus = playerCommandPendingStatus(action);
  let commandReceipts = recordPlayerCommandReceipt([], action, optimisticStatus);
  let commandStatus;
  let snapshot;
  const sent = [];
  try {
    const result = await submitPlayerRouteCommand({
      action,
      composerBody,
      data,
      fetchImpl: async () => {
        throw new Error("player handler harness should stay inside sendCommandImpl");
      },
      projectionStore,
      sendCommandImpl: async (request) => {
        sent.push(request);
        return outcome;
      },
    });
    commandStatus = result.commandStatus;
    snapshot = result.snapshot;
  } catch (error) {
    commandStatus = playerCommandErrorStatus(error, action);
    snapshot = projectionStore.getSnapshot();
  }
  commandReceipts = recordPlayerCommandReceipt(
    commandReceipts,
    action,
    commandStatus,
  );
  const plan = buildPlayerCommandDispatchBridgePlan({
    data,
    action,
    composerBody,
    optimisticStatus,
    finalStatus: commandStatus,
  });
  exposePlayerCommandDispatchBridgePlan({ windowRef, plan });
  exposePlayerCommandStatus({ windowRef, commandStatus });
  exposePlayerCommandReceipts({ windowRef, commandReceipts });
  exposePlayerProjection({ windowRef, snapshot });
  const receiptView = buildPlayerCommandReceiptViewModel({
    receipts: commandReceipts,
  });
  const visible = rowByAction(receiptView.items, action);

  assertPlayerCommand({ request: only(sent), action, data, composerBody });
  assert.equal(windowRef.__fmarchPlayerCommandDispatchBridgePlan, plan);
  assert.equal(windowRef.__fmarchPlayerCommandStatus.state, outcome.state);
  assert.equal(visible.state, outcome.state);

  return {
    plan,
    visible: visibleStatus(visible),
    refreshed: projectionStore.refreshed,
  };
}

async function proveModeratorHandlers() {
  const data = moderatorData();
  const ack = await proveModeratorHandlerPath({
    data,
    event: moderatorHostPromptEvent(),
    outcome: {
      state: "ack",
      actionId: moderatorHostPromptEvent().actionId,
      message: "Ack",
    },
  });
  const reject = await proveModeratorHandlerPath({
    data,
    event: moderatorHostPromptEvent(),
    outcome: {
      state: "reject",
      actionId: moderatorHostPromptEvent().actionId,
      error: "PhaseLocked",
      retryable: true,
      message: "Reject PhaseLocked: prompt already resolved",
    },
  });
  const slotLifecycle = await proveModeratorHandlerPath({
    data,
    event: moderatorSlotLifecycleEvent(),
    outcome: {
      state: "ack",
      actionId: moderatorSlotLifecycleEvent().actionId,
      message: "Ack: stream seqs 73",
      projectionState: hostConsoleModkilledProjectionState(),
    },
  });

  assert.equal(ack.visible.state, "ack");
  assert.equal(reject.visible.state, "reject");
  assert.equal(slotLifecycle.visible.state, "ack");
  assert.deepEqual(ack.refreshed, [["hostPrompts"]]);
  assert.deepEqual(reject.refreshed, [
    ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
  ]);
  assert.deepEqual(slotLifecycle.refreshed, []);
  assert.deepEqual(slotLifecycle.requestCommand.SetSlotStatus, {
    game: "midsummer",
    slot: "slot-7",
    status: "modkilled",
  });
  assert.equal(
    slotLifecycle.snapshot.host.replacement.lifecycleLabel,
    "Modkilled",
  );

  return {
    component: "host-command-activity",
    exposureKey: "__fmarchHostCommandDispatchBridgePlan",
    commands: {
      hostPrompt: {
        actionId: moderatorHostPromptEvent().actionId,
        commandKind: ack.plan.commandKind,
        ack: ack.visible,
        reject: reject.visible,
        ackRefreshKeys: ack.refreshed[0],
        rejectRefreshKeys: reject.refreshed,
      },
      slotLifecycle: {
        actionId: moderatorSlotLifecycleEvent().actionId,
        commandKind: slotLifecycle.plan.commandKind,
        ack: slotLifecycle.visible,
        ackRefreshKeys: slotLifecycle.refreshed,
        requestCommand: slotLifecycle.requestCommand,
        projection: {
          lifecycleLabel: slotLifecycle.snapshot.host.replacement.lifecycleLabel,
          historyLabel: slotLifecycle.snapshot.host.replacement.historyLabel,
        },
      },
    },
  };
}

async function proveModeratorHandlerPath({ data, event, outcome }) {
  const windowRef = {};
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
  const sent = [];
  let tracedOutcome;
  try {
    const result = await sendHostRouteAction({
      event,
      data,
      fetchImpl: async () => {
        throw new Error("moderator handler harness should stay inside send impl");
      },
      projectionStore,
      sendHostActionCommandImpl: async (request) => {
        sent.push(request);
        return outcome;
      },
    });
    tracedOutcome = attachEventConfirmationTrace(result.outcome, event);
  } catch (error) {
    tracedOutcome = hostCommandErrorOutcome({
      actionId: event.actionId,
      error,
      event,
    });
  }
  commandOutcomes = appendHostCommandOutcome(commandOutcomes, tracedOutcome);
  commandStatuses = recordHostCommandStatus(
    commandStatuses,
    event.actionId,
    tracedOutcome,
  );
  const plan = buildHostCommandDispatchBridgePlan({
    event,
    data,
    optimisticStatus,
    finalStatus: tracedOutcome,
  });
  exposeHostCommandDispatchBridgePlan({ windowRef, plan });
  exposeHostRouteWindowState({
    windowRef,
    dispatched,
    commandOutcomes,
    commandStatuses,
    projection: projectionStore.getSnapshot().host,
    votecount: projectionStore.getSnapshot().votecount,
    hostPrompts: projectionStore.getSnapshot().hostPrompts,
  });
  const activityView = buildHostCommandActivityViewModel({
    commandStatuses,
    commandOutcomes,
  });
  const visible = rowByAction(activityView.items, event.actionId);

  assert.equal(only(sent).actionEvent.actionId, event.actionId);
  assert.equal(windowRef.__fmarchHostCommandDispatchBridgePlan, plan);
  assert.equal(windowRef.__fmarchHostCommandStatuses[event.actionId].state, outcome.state);
  assert.equal(visible.state, outcome.state);

  return {
    plan,
    visible: visibleStatus(visible),
    refreshed: projectionStore.refreshed,
    snapshot: projectionStore.getSnapshot(),
    requestCommand: mapHostActionToWireCommand(event),
  };
}

function adminData() {
  return {
    operator: {
      principalUserId: "admin_a",
    },
    command: {
      endpoint: "/commands",
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
      label: "Modkill Slot 7",
      objectLabel: "Slot 7",
      outcomeLabel: "set lifecycle to modkilled",
      confirmationText:
        "Modkill Slot 7: set lifecycle to modkilled for Slot 7.",
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

function hostConsoleModkilledProjectionState() {
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
        status: "modkilled",
        alive: false,
      },
    ],
    thread_posts: [
      {
        author_slot: "slot-7",
      },
    ],
  };
}

function fakeProjectionStore(snapshot) {
  return {
    refreshed: [],
    applyPayload(key, payload) {
      snapshot = {
        ...snapshot,
        [key]: key === "host"
          ? projectHostConsoleState(payload, snapshot.host)
          : payload,
      };
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
    case "votecount":
    case "hostPrompts":
      return [];
    default:
      return null;
  }
}

function rowByAction(items, actionId) {
  const row = items.find((item) => item.actionId === actionId);
  assert.equal(row !== undefined, true, `missing visible row ${actionId}`);
  return row;
}

function visibleStatus(row) {
  return {
    actionId: row.actionId,
    state: row.state,
    message: row.message,
    testId: row.testId,
    statusTestId: row.statusTestId,
  };
}

function assertPlayerCommand({ request, action, data, composerBody }) {
  if (action === "submit_vote") {
    assert.equal(request.command.SubmitVote.target.Slot, "slot-2");
    return;
  }
  assert.equal(action, "submit_post");
  assert.deepEqual(request.command.SubmitPost, {
    game: data.game.id,
    channel_id: data.threadPager.channel,
    actor_slot: data.player.slotId,
    body: composerBody,
  });
}

function only(items) {
  assert.equal(items.length, 1);
  return items[0];
}
