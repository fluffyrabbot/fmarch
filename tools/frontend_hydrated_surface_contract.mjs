import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBoardRouteData,
  buildShellKeyboardOrder,
} from "../frontend/src/lib/app/app-shell-model.mjs";
import {
  buildAppSurfaceHeaderViewModel,
} from "../frontend/src/lib/app/app-surface-header-model.mjs";
import {
  buildAdminAuditDetailData,
  buildAdminRouteData,
} from "../frontend/src/routes/admin/admin-route-model.mjs";
import {
  adminConfirmStatus,
  adminPendingStatus,
  buildAdminCommandDispatchBridgePlan,
  exposeAdminCommandDispatchBridgePlan,
  exposeAdminCommandOutcome,
  exposeAdminFormResult,
  recordAdminCommandStatus,
  recordAdminFormStatus,
  sendAdminSetupCommand,
} from "../frontend/src/routes/admin/admin-route-controller.mjs";
import {
  buildAdminCommandActivityViewModel,
} from "../frontend/src/lib/components/admin/admin-surface-model.mjs";
import {
  buildGameRouteData,
} from "../frontend/src/routes/g/[game]/game-route-model.mjs";
import {
  buildPlayerCommandDispatchBridgePlan,
  loadOlderPlayerThreadPage,
  playerCommandPendingStatus,
  playerThreadErrorStatus,
  playerThreadPendingStatus,
  recordPlayerCommandReceipt,
  submitPlayerRouteCommand,
  togglePrivateItemExpansion,
} from "../frontend/src/routes/g/[game]/player-route-controller.mjs";
import {
  exposePlayerCommandDispatchBridgePlan,
  exposePlayerCommandReceipts,
  exposePlayerCommandStatus,
  exposePlayerProjection,
} from "../frontend/src/routes/g/[game]/player-route-browser-bridge.mjs";
import {
  buildPlayerCommandReceiptViewModel,
} from "../frontend/src/lib/components/player-command/player-command-receipt-model.mjs";
import {
  buildPlayerPrivateQueueViewModel,
} from "../frontend/src/lib/components/player-private-queue/player-private-queue-model.mjs";
import {
  buildPlayerThreadViewModel,
} from "../frontend/src/lib/components/player-thread/player-thread-model.mjs";
import {
  buildHostConsoleRouteData,
} from "../frontend/src/routes/g/[game]/host/host-route-model.mjs";
import {
  appendHostActionEvent,
  appendHostCommandOutcome,
  attachEventConfirmationTrace,
  buildHostCommandDispatchBridgePlan,
  buildHostDerivedState,
  hostCommandPendingStatus,
  recordHostCommandStatus,
  sendHostRouteAction,
} from "../frontend/src/routes/g/[game]/host/host-route-controller.mjs";
import {
  exposeHostCommandDispatchBridgePlan,
  exposeHostRouteWindowState,
} from "../frontend/src/routes/g/[game]/host/host-route-browser-bridge.mjs";
import {
  buildHostCommandActivityViewModel,
} from "../frontend/src/lib/components/host-action/host-command-activity.mjs";
import {
  createHostActionController,
} from "../frontend/src/lib/components/host-action/host-action-contract.mjs";
import {
  mapHostActionToWireCommand,
  projectHostConsoleState,
} from "../frontend/src/lib/components/host-action/host-command-boundary.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-hydrated-surfaces");
const evidencePath = path.join(artifactDir, "hydrated-surfaces.json");

const boardData = buildBoardRouteData({
  game: "midsummer",
  principalUserId: "player_mira",
  capabilities: [{ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }],
});
const adminData = await buildAdminRouteData({
  principalUserId: "admin_a",
  capabilities: [{ kind: "GlobalAdmin" }],
});
const adminAuditDetailData = await buildAdminAuditDetailData({
  audit: "proof-runs",
  principalUserId: "admin_a",
  capabilities: [{ kind: "GlobalAdmin" }],
});
const playerData = await buildGameRouteData({
  game: "midsummer",
  principalUserId: "player_mira",
  capabilities: [
    { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
    { kind: "ChannelMember", game: "midsummer", channel: "role-pm" },
  ],
});
const moderatorData = await buildHostConsoleRouteData({
  game: "midsummer",
  principalUserId: "host_h",
  capabilities: [{ kind: "HostOf", game: "midsummer" }],
});

const evidence = {
  status: "passed",
  proof: "frontend-hydrated-surface-contract",
  boundary:
    "No-localhost hydrated-surface adapter contract. It executes real route data, shared surface headers, native audit navigation, player private disclosure, and representative admin/player/moderator command adapter flows through the same controller and browser-bridge functions used by hydrated Svelte pages. It does not prove Svelte client scheduling, DOM event delivery, focus traversal, CSS geometry, screenshots, TCP transport, or WebSocket delivery.",
  generatedFrom: {
    boardRouteData: "frontend/src/lib/app/app-shell-model.mjs",
    adminRouteData: "frontend/src/routes/admin/admin-route-model.mjs",
    playerRouteData: "frontend/src/routes/g/[game]/game-route-model.mjs",
    moderatorRouteData:
      "frontend/src/routes/g/[game]/host/host-route-model.mjs",
  },
  sharedShell: proveSharedShell(),
  admin: await proveAdminSurfaceAdapter(),
  player: await provePlayerSurfaceAdapter(),
  moderator: await proveModeratorSurfaceAdapter(),
};

await mkdir(artifactDir, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

function proveSharedShell() {
  const surfaces = [
    ["board", boardData],
    ["admin", adminData],
    ["admin-audit-detail", adminAuditDetailData],
    ["player", playerData],
    ["moderator", moderatorData],
  ].map(([id, data]) => {
    const header = buildAppSurfaceHeaderViewModel(data.surfaceHeader);
    assert.equal(header.component, "fm-surface-header");
    return {
      id,
      activeSurface: data.shell.activeSurface,
      headerTitle: header.title,
      capabilityTestId: header.capability.visible ? header.capability.testId : null,
      liveStatusTestId: header.liveStatus.visible ? header.liveStatus.testId : null,
      linkedNavTestIds: buildShellKeyboardOrder({
        shell: data.shell,
        contentTestIds: [`${id}-primary-control`],
      }).linkedNavTestIds,
    };
  });

  assert.deepEqual(
    surfaces.map((surface) => surface.id),
    ["board", "admin", "admin-audit-detail", "player", "moderator"],
  );
  assert.equal(surfaces.find((surface) => surface.id === "board").capabilityTestId, null);
  assert.equal(
    surfaces.find((surface) => surface.id === "player").liveStatusTestId,
    "player-live-status",
  );
  assert.equal(
    surfaces.find((surface) => surface.id === "moderator").liveStatusTestId,
    "host-live-status",
  );

  return {
    boundary:
      "Route data for every app-level first viewport carries the shared surface header and shell keyboard metadata before browser rendering.",
    surfaces,
  };
}

async function proveAdminSurfaceAdapter() {
  const item = adminData.gameSetup.find((candidate) => candidate.id === "cohost");
  assert.notEqual(item, undefined);
  const windowRef = {};
  const confirmationStatus = adminConfirmStatus(item);
  const optimisticStatus = adminPendingStatus();
  let commandStatuses = recordAdminCommandStatus(
    {},
    item.id,
    confirmationStatus,
  );
  commandStatuses = recordAdminCommandStatus(
    commandStatuses,
    item.id,
    optimisticStatus,
  );
  const sent = [];
  const result = await sendAdminSetupCommand({
    item,
    data: adminData,
    fetchImpl: async () => {
      throw new Error("hydrated admin surface proof uses injected sender");
    },
    sendCommandImpl: async (request) => {
      sent.push(request);
      return {
        state: "ack",
        message: "Ack: cohost delegated",
      };
    },
  });
  commandStatuses = recordAdminCommandStatus(
    commandStatuses,
    item.id,
    result.outcome,
  );
  const plan = buildAdminCommandDispatchBridgePlan({
    item,
    data: adminData,
    confirmationStatus,
    optimisticStatus,
    finalStatus: result.outcome,
  });
  exposeAdminCommandDispatchBridgePlan({ windowRef, plan });
  exposeAdminCommandOutcome({
    windowRef,
    commandStatuses,
    outcome: result.outcome,
  });
  const activity = buildAdminCommandActivityViewModel({ commandStatuses });
  const row = rowByAction(activity.items, item.id);

  const sessionGrantResult = {
    id: "session-grants",
    state: "ack",
    message: "Granted GlobalMod to mod_a",
    principalUserId: "mod_a",
    capabilityKinds: "GlobalMod",
  };
  const sessionGrant = recordAdminFormStatus({
    commandStatuses,
    form: sessionGrantResult,
    lastFormStatusKey: "",
  });
  commandStatuses = sessionGrant.commandStatuses;
  exposeAdminFormResult({ windowRef, form: sessionGrantResult });
  const recoveryGateResult = {
    id: "recovery-gate",
    state: "ack",
    message: "Recovery gate trusted: 3/3 production artifacts trusted",
    trusted: 3,
    total: 3,
    nonTrusted: 0,
  };
  const recoveryGate = recordAdminFormStatus({
    commandStatuses,
    form: recoveryGateResult,
    lastFormStatusKey: sessionGrant.lastFormStatusKey,
  });
  commandStatuses = recoveryGate.commandStatuses;
  exposeAdminFormResult({ windowRef, form: recoveryGateResult });
  const formActivity = buildAdminCommandActivityViewModel({ commandStatuses });
  const sessionGrantRow = rowByAction(formActivity.items, "session-grants");
  const recoveryGateRow = rowByAction(formActivity.items, "recovery-gate");

  assert.equal(adminData.audit[0].inspectHref, "/admin/audit/proof-runs?game=midsummer");
  assert.equal(adminAuditDetailData.overviewHref, "/admin?game=midsummer");
  assert.equal(adminAuditDetailData.surfaceHeader.title, "Proof runs");
  assert.equal(only(sent).command.AddCohost.user, "cohost_c");
  assert.equal(windowRef.__fmarchAdminCommandDispatchBridgePlan, plan);
  assert.equal(windowRef.__fmarchAdminSessionGrantResult.id, "session-grants");
  assert.equal(windowRef.__fmarchAdminRecoveryGateResult.id, "recovery-gate");
  assert.equal(row.state, "ack");
  assert.equal(sessionGrantRow.state, "ack");
  assert.equal(recoveryGateRow.state, "ack");

  return {
    header: headerSummary(adminData.surfaceHeader),
    auditNavigation: {
      listHref: adminData.audit[0].inspectHref,
      detailTitle: adminAuditDetailData.surfaceHeader.title,
      evidenceHref: adminAuditDetailData.audit.href,
      overviewHref: adminAuditDetailData.overviewHref,
    },
    command: {
      actionId: item.id,
      commandKind: plan.commandKind,
      exposureKey: "__fmarchAdminCommandDispatchBridgePlan",
      visible: visibleStatus(row),
    },
    forms: {
      sessionGrant: {
        actionId: "session-grants",
        exposureKey: "__fmarchAdminSessionGrantResult",
        visible: visibleStatus(sessionGrantRow),
      },
      recoveryGate: {
        actionId: "recovery-gate",
        exposureKey: "__fmarchAdminRecoveryGateResult",
        visible: visibleStatus(recoveryGateRow),
      },
    },
  };
}

async function provePlayerSurfaceAdapter() {
  const windowRef = {};
  const targetPrivateItem = playerData.privateQueue[0];
  const collapsed = buildPlayerPrivateQueueViewModel({
    boundary: playerData.privateQueueBoundary,
    items: playerData.privateQueue,
    expandedItems: playerData.privateQueueExpandedItems,
  });
  const expandedItems = togglePrivateItemExpansion(
    playerData.privateQueueExpandedItems,
    targetPrivateItem,
  );
  const expanded = buildPlayerPrivateQueueViewModel({
    boundary: playerData.privateQueueBoundary,
    items: playerData.privateQueue,
    expandedItems,
  });
  assert.equal(collapsed.items[0].ariaExpanded, "false");
  assert.equal(expanded.items[0].ariaExpanded, "true");
  assert.equal(JSON.stringify(expanded).includes("host prompt"), false);

  const voteCommand = await provePlayerCommandSurfacePath({
    action: "submit_vote",
    composerBody: playerData.composer.defaultBody,
    data: playerData,
    message: "Ack: vote submitted",
    windowRef,
  });
  const postCommand = await provePlayerCommandSurfacePath({
    action: "submit_post",
    composerBody: "private role note",
    data: {
      ...playerData,
      threadPager: {
        ...playerData.threadPager,
        channel: "role-pm",
      },
    },
    message: "Ack: post submitted",
    windowRef: {},
  });

  assert.equal(voteCommand.request.command.SubmitVote.target.Slot, "slot-2");
  assert.deepEqual(voteCommand.refreshed, [["votecount"]]);
  assert.deepEqual(postCommand.request.command.SubmitPost, {
    game: "midsummer",
    channel_id: "role-pm",
    actor_slot: "slot-7",
    body: "private role note",
  });
  assert.deepEqual(postCommand.refreshed, [["thread", "votecount"]]);
  const threadPager = await provePlayerThreadPagerLifecycle();

  return {
    header: headerSummary(playerData.surfaceHeader),
    privateDisclosure: {
      itemId: targetPrivateItem.id,
      before: collapsed.items[0].ariaExpanded,
      after: expanded.items[0].ariaExpanded,
      reviewHref: expanded.items[0].reviewHref,
      hostOnlyCopyPresent: false,
    },
    command: {
      actionId: voteCommand.action,
      commandKind: voteCommand.plan.commandKind,
      exposureKey: "__fmarchPlayerCommandDispatchBridgePlan",
      visible: voteCommand.visible,
      refreshed: voteCommand.refreshed[0],
    },
    postCommand: {
      actionId: postCommand.action,
      commandKind: postCommand.plan.commandKind,
      exposureKey: "__fmarchPlayerCommandDispatchBridgePlan",
      visible: postCommand.visible,
      refreshed: postCommand.refreshed[0],
      channelId: "role-pm",
    },
    threadPager,
  };
}

async function provePlayerThreadPagerLifecycle() {
  const pendingStatus = playerThreadPendingStatus();
  const pending = buildPlayerThreadViewModel(playerData.thread, {
    threadPageStatus: pendingStatus,
  }).pager;
  assert.equal(pending.root.state, "pending");
  assert.equal(pending.root.busy, "true");
  assert.equal(pending.button.disabled, true);
  assert.equal(pending.button.ariaDisabled, "true");
  assert.equal(pending.button.disabledReason, "Loading older posts");

  const ackStore = fakeProjectionStore({
    thread: playerData.thread,
    votecount: playerData.votecount,
  });
  const ack = await loadOlderPlayerThreadPage({
    data: playerData,
    fetchImpl: async () => jsonResponse({
      next_before_seq: null,
      posts: [
        { source_seq: 430, author_user: "Rowan", body: "older one" },
        { source_seq: 431, author_user: "Mira", body: "older two" },
      ],
    }),
    projectionStore: ackStore,
    thread: playerData.thread,
  });
  const ackPager = buildPlayerThreadViewModel(ack.snapshot.thread, {
    threadPageStatus: ack.threadPageStatus,
  }).pager;
  assert.equal(ack.threadPageStatus.state, "ack");
  assert.equal(ack.threadPageStatus.message, "Loaded 2 older posts");
  assert.equal(ackPager.root.state, "complete");
  assert.equal(ackPager.button.disabled, true);
  assert.equal(ackPager.button.label, "No older posts");
  assert.equal(ackPager.button.disabledReason, "At oldest loaded post");

  let rejectedStatus;
  try {
    await loadOlderPlayerThreadPage({
      data: playerData,
      fetchImpl: async () => ({ ok: false, status: 503 }),
      projectionStore: fakeProjectionStore({
        thread: playerData.thread,
        votecount: playerData.votecount,
      }),
      thread: playerData.thread,
    });
  } catch (error) {
    rejectedStatus = playerThreadErrorStatus(error);
  }
  assert.equal(rejectedStatus.state, "reject");
  assert.equal(rejectedStatus.message, "Thread page rejected: 503");
  const rejectedPager = buildPlayerThreadViewModel(playerData.thread, {
    threadPageStatus: rejectedStatus,
  }).pager;
  assert.equal(rejectedPager.root.state, "ready");
  assert.equal(rejectedPager.button.disabled, false);
  assert.equal(rejectedPager.button.disabledReason, null);

  return {
    pending: {
      status: pendingStatus,
      rootState: pending.root.state,
      busy: pending.root.busy,
      buttonLabel: pending.button.label,
      buttonDisabled: pending.button.disabled,
      buttonDisabledReason: pending.button.disabledReason,
      ariaDisabled: pending.button.ariaDisabled,
      minTouchTargetPx: pending.button.minTouchTargetPx,
      nextBeforeSeq: pending.button.nextBeforeSeq,
    },
    ack: {
      status: ack.threadPageStatus,
      rootState: ackPager.root.state,
      busy: ackPager.root.busy,
      buttonLabel: ackPager.button.label,
      buttonDisabled: ackPager.button.disabled,
      buttonDisabledReason: ackPager.button.disabledReason,
      postCount: ack.snapshot.thread.posts.length,
      nextBeforeSeq: ack.snapshot.thread.nextBeforeSeq,
    },
    reject: {
      status: rejectedStatus,
      rootState: rejectedPager.root.state,
      busy: rejectedPager.root.busy,
      buttonLabel: rejectedPager.button.label,
      buttonDisabled: rejectedPager.button.disabled,
      buttonDisabledReason: rejectedPager.button.disabledReason,
      nextBeforeSeq: rejectedPager.button.nextBeforeSeq,
    },
  };
}

async function provePlayerCommandSurfacePath({
  action,
  composerBody,
  data,
  message,
  windowRef,
}) {
  const optimisticStatus = playerCommandPendingStatus(action);
  let receipts = recordPlayerCommandReceipt([], action, optimisticStatus);
  const projectionStore = fakeProjectionStore({
    thread: data.thread,
    votecount: data.votecount,
    notifications: data.notifications,
    investigationResults: data.investigationResults,
  });
  const sent = [];
  const result = await submitPlayerRouteCommand({
    action,
    composerBody,
    data,
    fetchImpl: async () => {
      throw new Error("hydrated player surface proof uses injected sender");
    },
    projectionStore,
    sendCommandImpl: async (request) => {
      sent.push(request);
      return {
        state: "ack",
        message,
      };
    },
  });
  receipts = recordPlayerCommandReceipt(receipts, action, result.commandStatus);
  const plan = buildPlayerCommandDispatchBridgePlan({
    data,
    action,
    composerBody,
    optimisticStatus,
    finalStatus: result.commandStatus,
  });
  exposePlayerCommandDispatchBridgePlan({ windowRef, plan });
  exposePlayerCommandStatus({ windowRef, commandStatus: result.commandStatus });
  exposePlayerCommandReceipts({ windowRef, commandReceipts: receipts });
  exposePlayerProjection({ windowRef, snapshot: result.snapshot });
  const receiptView = buildPlayerCommandReceiptViewModel({ receipts });
  const row = rowByAction(receiptView.items, action);

  assert.equal(windowRef.__fmarchPlayerCommandDispatchBridgePlan, plan);
  assert.equal(row.state, "ack");

  return {
    action,
    plan,
    request: only(sent),
    visible: visibleStatus(row),
    refreshed: projectionStore.refreshed,
  };
}

async function proveModeratorSurfaceAdapter() {
  const windowRef = {};
  const action = moderatorData.criticalActions.find((candidate) =>
    candidate.id.startsWith("resolve_host_prompt-"),
  );
  assert.notEqual(action, undefined);
  const dispatched = [];
  const controller = createHostActionController(action, (event) => {
    dispatched.push(event);
  });
  const opened = controller.activate();
  const openView = controller.viewModel();
  controller.confirm();
  const event = only(dispatched);
  const optimisticStatus = hostCommandPendingStatus(event);
  let commandStatuses = recordHostCommandStatus(
    {},
    event.actionId,
    optimisticStatus,
  );
  let commandOutcomes = [];
  const projectionStore = fakeProjectionStore({
    host: {
      phase: moderatorData.phase,
      replacement: moderatorData.replacement,
    },
    votecount: moderatorData.votecount,
    hostPrompts: moderatorData.hostPrompts,
  });
  const result = await sendHostRouteAction({
    event,
    data: moderatorData,
    fetchImpl: async () => {
      throw new Error("hydrated moderator surface proof uses injected sender");
    },
    projectionStore,
    sendHostActionCommandImpl: async () => ({
      state: "ack",
      actionId: event.actionId,
      message: "Ack: host prompt resolved",
      projectionPatches: { hostPrompts: [] },
    }),
  });
  const finalStatus = attachEventConfirmationTrace(result.outcome, event);
  commandStatuses = recordHostCommandStatus(
    commandStatuses,
    event.actionId,
    finalStatus,
  );
  commandOutcomes = appendHostCommandOutcome(commandOutcomes, finalStatus, event);
  const plan = buildHostCommandDispatchBridgePlan({
    event,
    data: moderatorData,
    optimisticStatus,
    finalStatus,
  });
  exposeHostCommandDispatchBridgePlan({ windowRef, plan });
  exposeHostRouteWindowState({
    windowRef,
    dispatched: appendHostActionEvent([], event),
    commandOutcomes,
    commandStatuses,
    projection: result.snapshot.host,
    votecount: result.snapshot.votecount,
    hostPrompts: result.snapshot.hostPrompts,
  });
  const activity = buildHostCommandActivityViewModel({
    commandStatuses,
    commandOutcomes,
  });
  const row = rowByAction(activity.items, event.actionId);
  const derived = buildHostDerivedState({
    gameId: moderatorData.game.id,
    snapshot: result.snapshot,
  });

  assert.equal(opened.confirmationOpen, true);
  assert.equal(openView.confirmation.confirmTestId, "critical-host-action-confirm");
  assert.equal(event.confirmationTrace.dispatchKind, "resolve_host_prompt");
  assert.equal(windowRef.__fmarchHostCommandDispatchBridgePlan, plan);
  assert.equal(windowRef.__fmarchHostPromptsProjection.length, 0);
  assert.equal(
    derived.criticalActions.some((candidate) =>
      candidate.id.startsWith("resolve_host_prompt-"),
    ),
    false,
  );
  assert.equal(row.state, "ack");
  const slotLifecycle = await proveModeratorSlotLifecycleSurfacePath();
  assert.equal(slotLifecycle.command.commandKind, "SetSlotStatus");
  assert.equal(slotLifecycle.command.projection.lifecycleLabel, "Modkilled");

  return {
    header: headerSummary(moderatorData.surfaceHeader),
    confirmation: {
      actionId: event.actionId,
      confirmationOpen: opened.confirmationOpen,
      confirmTestId: openView.confirmation.confirmTestId,
      dispatchKind: event.confirmationTrace.dispatchKind,
    },
    command: {
      actionId: event.actionId,
      commandKind: plan.commandKind,
      exposureKey: "__fmarchHostCommandDispatchBridgePlan",
      visible: visibleStatus(row),
      remainingPromptActions: derived.criticalActions.filter((candidate) =>
        candidate.id.startsWith("resolve_host_prompt-"),
      ).length,
    },
    slotLifecycleCommand: slotLifecycle.command,
    slotLifecycleConfirmation: slotLifecycle.confirmation,
  };
}

async function proveModeratorSlotLifecycleSurfacePath() {
  const windowRef = {};
  const action = moderatorData.criticalActions.find(
    (candidate) => candidate.id === "modkill_slot",
  );
  assert.notEqual(action, undefined);
  const dispatched = [];
  const controller = createHostActionController(action, (event) => {
    dispatched.push(event);
  });
  const opened = controller.activate();
  const openView = controller.viewModel();
  controller.confirm();
  const event = only(dispatched);
  const optimisticStatus = hostCommandPendingStatus(event);
  let commandStatuses = recordHostCommandStatus(
    {},
    event.actionId,
    optimisticStatus,
  );
  let commandOutcomes = [];
  const projectionStore = fakeProjectionStore({
    host: {
      phase: moderatorData.phase,
      replacement: moderatorData.replacement,
    },
    votecount: moderatorData.votecount,
    hostPrompts: moderatorData.hostPrompts,
  });
  const result = await sendHostRouteAction({
    event,
    data: moderatorData,
    fetchImpl: async () => {
      throw new Error("hydrated moderator slot lifecycle proof uses injected sender");
    },
    projectionStore,
    sendHostActionCommandImpl: async () => ({
      state: "ack",
      actionId: event.actionId,
      message: "Ack: stream seqs 73",
      projectionState: hostConsoleModkilledProjectionState(),
    }),
  });
  const finalStatus = attachEventConfirmationTrace(result.outcome, event);
  commandStatuses = recordHostCommandStatus(
    commandStatuses,
    event.actionId,
    finalStatus,
  );
  commandOutcomes = appendHostCommandOutcome(commandOutcomes, finalStatus, event);
  const plan = buildHostCommandDispatchBridgePlan({
    event,
    data: moderatorData,
    optimisticStatus,
    finalStatus,
  });
  exposeHostCommandDispatchBridgePlan({ windowRef, plan });
  exposeHostRouteWindowState({
    windowRef,
    dispatched: appendHostActionEvent([], event),
    commandOutcomes,
    commandStatuses,
    projection: result.snapshot.host,
    votecount: result.snapshot.votecount,
    hostPrompts: result.snapshot.hostPrompts,
  });
  const activity = buildHostCommandActivityViewModel({
    commandStatuses,
    commandOutcomes,
  });
  const row = rowByAction(activity.items, event.actionId);
  const derived = buildHostDerivedState({
    gameId: moderatorData.game.id,
    snapshot: result.snapshot,
  });

  assert.equal(opened.confirmationOpen, true);
  assert.equal(openView.confirmation.confirmTestId, "critical-host-action-confirm");
  assert.equal(event.confirmationTrace.dispatchKind, "modkill_slot");
  const requestCommand = mapHostActionToWireCommand(event);
  assert.equal(requestCommand.SetSlotStatus.status, "modkilled");
  assert.equal(windowRef.__fmarchHostCommandDispatchBridgePlan, plan);
  assert.equal(row.state, "ack");
  assert.equal(derived.projection.replacement.lifecycleLabel, "Modkilled");

  return {
    confirmation: {
      actionId: event.actionId,
      confirmationOpen: opened.confirmationOpen,
      confirmTestId: openView.confirmation.confirmTestId,
      dispatchKind: event.confirmationTrace.dispatchKind,
    },
    command: {
      actionId: event.actionId,
      commandKind: plan.commandKind,
      exposureKey: "__fmarchHostCommandDispatchBridgePlan",
      visible: visibleStatus(row),
      refreshed: projectionStore.refreshed,
      requestCommand,
      projection: {
        lifecycleLabel: derived.projection.replacement.lifecycleLabel,
        historyLabel: derived.projection.replacement.historyLabel,
      },
    },
  };
}

function headerSummary(header) {
  const view = buildAppSurfaceHeaderViewModel(header);
  return {
    surface: view.surface,
    title: view.title,
    capabilityTestId: view.capability.visible ? view.capability.testId : null,
    capabilityMinTouchTargetPx: view.capability.visible
      ? view.capability.minTouchTargetPx
      : null,
    liveStatusTestId: view.liveStatus.visible ? view.liveStatus.testId : null,
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
    applySnapshot(patch) {
      snapshot = { ...snapshot, ...patch };
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

function refreshedValue(key) {
  switch (key) {
    case "thread":
      return { posts: [], nextBeforeSeq: null };
    case "votecount":
      return [{ target: "slot-2 / Ilya", count: 5, needed: 7 }];
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

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
  };
}

function only(items) {
  assert.equal(items.length, 1);
  return items[0];
}
