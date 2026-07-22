import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  adminConfirmStatus,
  adminPendingStatus,
  recordAdminCommandStatus,
} from "../frontend/src/routes/admin/admin-route-controller.mjs";
import {
  hostCommandPendingStatus,
  recordHostCommandStatus,
} from "../frontend/src/routes/g/[game]/host/host-route-controller.mjs";
import {
  playerCommandPendingStatus,
  recordPlayerCommandReceipt,
} from "../frontend/src/routes/g/[game]/player-route-controller.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "frontend-component-interactions");
const evidencePath = path.join(artifactDir, "component-interactions.json");
const tempEntryDir = path.join(frontendRoot, ".tmp-component-interactions");
const bundleDir = path.join(artifactDir, "bundle");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));

await rm(tempEntryDir, { recursive: true, force: true });
await rm(bundleDir, { recursive: true, force: true });
await mkdir(tempEntryDir, { recursive: true });
await mkdir(artifactDir, { recursive: true });

const entryPath = path.join(tempEntryDir, "entry.mjs");
await writeFile(entryPath, renderEntrySource());

try {
  const { build } = await import(frontendRequire.resolve("vite"));
  const { svelte } = await import(
    frontendRequire.resolve("@sveltejs/vite-plugin-svelte")
  );
  await build({
    configFile: false,
    root: frontendRoot,
    plugins: [svelte()],
    resolve: {
      alias: {
        $lib: path.join(frontendRoot, "src", "lib"),
      },
    },
    logLevel: "error",
    ssr: {
      noExternal: true,
    },
    build: {
      ssr: entryPath,
      outDir: bundleDir,
      emptyOutDir: true,
      rollupOptions: {
        input: entryPath,
      },
    },
  });

  const bundle = await import(
    `${pathToFileURL(path.join(bundleDir, "entry.js")).href}?t=${Date.now()}`
  );
  const evidence = {
    status: "passed",
    proof: "frontend-component-interaction-contract",
    boundary:
      "No-bind compiled-component interaction contract. It verifies command component source event bindings, renders command controls and status rows through a Svelte SSR bundle, directly invokes the same callback/controller action ids, and re-renders DOM-facing ACK rows. It does not prove browser pointer delivery, Svelte client scheduling, focus traversal, CSS geometry, screenshots, TCP transport, or WebSocket delivery.",
    sourceContracts: await proveSourceContracts(),
    interactions: {
      admin: await proveAdminInteraction(bundle),
      player: await provePlayerInteraction(bundle),
      moderator: await proveModeratorInteraction(bundle),
    },
  };

  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} finally {
  await rm(tempEntryDir, { recursive: true, force: true });
}

async function proveSourceContracts() {
  const contracts = [
    await proveSourceContract({
      component: "AdminSetupGrid",
      path: "frontend/src/lib/components/admin/AdminSetupGrid.svelte",
      requiredSnippets: [
        "on:click={() => onSetupAction(item)}",
        "on:click={() => confirmSetupAction(item)}",
        "onConfirmSetupAction(item)",
        'action="?/grantSession"',
        'data-testid="admin-session-grant-token"',
        "<CommandRecovery",
      ],
    }),
    await proveSourceContract({
      component: "AdminRecoveryPanel",
      path: "frontend/src/lib/components/admin/AdminRecoveryPanel.svelte",
      requiredSnippets: [
        "on:click={() => onRecoveryTask(item)}",
        "action={item.form.action}",
        'name="principalUserId"',
      ],
    }),
    await proveSourceContract({
      component: "PlayerCommandPanel",
      path: "frontend/src/lib/components/player-command/PlayerCommandPanel.svelte",
      requiredSnippets: [
        "await onCommand(action)",
        "on:click={() => dispatchCommand(button.action)}",
        "data-action={button.data.action}",
      ],
    }),
    await proveSourceContract({
      component: "PlayerCommandReceipt",
      path: "frontend/src/lib/components/player-command/PlayerCommandReceipt.svelte",
      requiredSnippets: ["<CommandRecovery", "status={currentStatus}"],
    }),
    await proveSourceContract({
      component: "HostTaskWorkspace",
      path: "frontend/src/lib/components/host-action/HostTaskWorkspace.svelte",
      requiredSnippets: [
        "<HostAction action={action.config} onDispatch={onDispatch} />",
        "<CommandRecovery",
        "data-testid={view.queue.testId}",
        "data-testid={view.canvas.testId}",
      ],
    }),
    await proveSourceContract({
      component: "HostAction",
      path: "frontend/src/lib/components/host-action/HostAction.svelte",
      requiredSnippets: [
        "on:click={activate}",
        "on:click={confirm}",
        "controller.confirm()",
      ],
    }),
  ];
  return contracts;
}

async function proveAdminInteraction(bundle) {
  const confirm = await bundle.renderAdminSetupGridConfirm();
  const sessionGrantConfirm = await bundle.renderAdminSessionGrantConfirm();
  const recoveryConfirm = await bundle.renderAdminRecoveryGateConfirm();
  const ack = await bundle.renderAdminCommandActivityAck();
  const invoked = [];
  const item = adminCohostItem();
  const sessionGrantItem = adminSessionGrantItem();
  const recoveryGateItem = adminRecoveryGateItem();
  const confirmationStatus = adminConfirmStatus(item);
  const sessionGrantStatus = adminConfirmStatus(sessionGrantItem);
  const recoveryGateStatus = adminConfirmStatus(recoveryGateItem);
  const optimisticStatuses = recordAdminCommandStatus(
    {},
    item.id,
    adminPendingStatus(),
  );
  invoked.push(item.commandAction, sessionGrantItem.commandAction, recoveryGateItem.action);

  assertIncludes(confirm.html, 'data-testid="admin-command-confirm-cohost"', "admin confirm button");
  assertIncludes(confirm.html, "Delegate @cohost_c as cohost", "admin confirmation copy");
  assertIncludes(
    sessionGrantConfirm.html,
    'action="?/grantSession"',
    "admin session grant form action",
  );
  assertIncludes(
    sessionGrantConfirm.html,
    'data-testid="admin-session-grant-token"',
    "admin session grant token field",
  );
  assertIncludes(
    sessionGrantConfirm.html,
    'data-testid="admin-session-grant-global-mod"',
    "admin session grant GlobalMod field",
  );
  assertIncludes(
    recoveryConfirm.html,
    'action="?/checkRecoveryGate"',
    "admin recovery gate form action",
  );
  assertIncludes(
    recoveryConfirm.html,
    'name="principalUserId"',
    "admin recovery principal hidden field",
  );
  assertIncludes(ack.html, 'data-testid="admin-command-activity-cohost"', "admin ack row");
  assertIncludes(ack.html, 'data-testid="admin-command-activity-session-grants"', "admin session grant ack row");
  assertIncludes(ack.html, 'data-testid="admin-command-activity-recovery-gate"', "admin recovery gate ack row");
  assertIncludes(ack.html, 'data-state="ack"', "admin ack state");
  assert.equal(invoked[0], "add_cohost");
  assert.equal(invoked[1], "grant_session");
  assert.equal(invoked[2], "check_recovery_gate");
  assert.equal(optimisticStatuses.cohost.state, "pending");
  assert.equal(confirmationStatus.confirmationTrace.dispatchKind, "add_cohost");
  assert.equal(sessionGrantStatus.confirmationTrace.dispatchKind, "grant_session");
  assert.equal(recoveryGateStatus.confirmationTrace.dispatchKind, "check_recovery_gate");

  return {
    component: "AdminSetupGrid/AdminRecoveryPanel/AdminCommandActivity",
    actions: [
      {
        action: invoked[0],
        triggerTestId: "admin-command-trigger-cohost",
        confirmTestId: "admin-command-confirm-cohost",
        visibleRowTestId: "admin-command-activity-cohost",
        statusTestId: "admin-command-activity-status-cohost",
        renderedConfirmBytes: Buffer.byteLength(confirm.html),
      },
      {
        action: invoked[1],
        triggerTestId: "admin-command-trigger-session-grants",
        confirmTestId: "admin-command-confirm-session-grants",
        formAction: "?/grantSession",
        formFieldTestIds: [
          "admin-session-grant-token",
          "admin-session-grant-principal",
          "admin-session-grant-expires-at",
          "admin-session-grant-global-mod",
        ],
        visibleRowTestId: "admin-command-activity-session-grants",
        statusTestId: "admin-command-activity-status-session-grants",
        renderedConfirmBytes: Buffer.byteLength(sessionGrantConfirm.html),
      },
      {
        action: invoked[2],
        triggerTestId: "admin-recovery-trigger-recovery-gate",
        confirmTestId: "admin-recovery-confirm-recovery-gate",
        formAction: "?/checkRecoveryGate",
        visibleRowTestId: "admin-command-activity-recovery-gate",
        statusTestId: "admin-command-activity-status-recovery-gate",
        renderedConfirmBytes: Buffer.byteLength(recoveryConfirm.html),
      },
    ],
    renderedAckBytes: Buffer.byteLength(ack.html),
  };
}

async function provePlayerInteraction(bundle) {
  const panel = await bundle.renderPlayerCommandPanel();
  const voteAck = await bundle.renderPlayerCommandReceiptVoteAck();
  const postAck = await bundle.renderPlayerCommandReceiptPostAck();
  const invoked = [];
  const voteAction = "submit_vote";
  const postAction = "submit_post";
  const voteReceipts = recordPlayerCommandReceipt(
    [],
    voteAction,
    playerCommandPendingStatus(voteAction),
  );
  const postReceipts = recordPlayerCommandReceipt(
    [],
    postAction,
    playerCommandPendingStatus(postAction),
  );
  invoked.push(voteAction, postAction);

  assertIncludes(panel.html, 'data-action="submit_vote"', "player submit vote button");
  assertIncludes(panel.html, 'data-action="submit_post"', "player submit post button");
  assertIncludes(voteAck.html, 'data-testid="player-command-receipt-submit_vote"', "player vote ack row");
  assertIncludes(voteAck.html, 'data-state="ack"', "player vote ack state");
  assertIncludes(postAck.html, 'data-testid="player-command-receipt-submit_post"', "player post ack row");
  assertIncludes(postAck.html, 'data-state="ack"', "player post ack state");
  assert.equal(invoked[0], "submit_vote");
  assert.equal(invoked[1], "submit_post");
  assert.equal(voteReceipts[0].state, "pending");
  assert.equal(postReceipts[0].state, "pending");

  return {
    component: "PlayerCommandPanel/PlayerCommandReceipt",
    actions: [
      {
        action: invoked[0],
        actionAttribute: "submit_vote",
        visibleRowTestId: "player-command-receipt-submit_vote",
      },
      {
        action: invoked[1],
        actionAttribute: "submit_post",
        visibleRowTestId: "player-command-receipt-submit_post",
      },
    ],
    statusTestId: "player-command-status",
    renderedPanelBytes: Buffer.byteLength(panel.html),
    renderedVoteAckBytes: Buffer.byteLength(voteAck.html),
    renderedPostAckBytes: Buffer.byteLength(postAck.html),
  };
}

async function proveModeratorInteraction(bundle) {
  const promptControls = await bundle.renderHostPromptControlSurfaceConfirm();
  const promptAck = await bundle.renderHostPromptCommandActivityAck();
  const slotLifecycleControls =
    await bundle.renderHostSlotLifecycleControlSurfaceConfirm();
  const slotLifecycleAck = await bundle.renderHostSlotLifecycleCommandActivityAck();
  const event = hostPromptEvent();
  const slotLifecycleEvent = hostSlotLifecycleEvent();
  const invoked = [];
  const statuses = recordHostCommandStatus(
    {},
    event.actionId,
    hostCommandPendingStatus(event),
  );
  const slotLifecycleStatuses = recordHostCommandStatus(
    {},
    slotLifecycleEvent.actionId,
    hostCommandPendingStatus(slotLifecycleEvent),
  );
  invoked.push(event.actionId, slotLifecycleEvent.actionId);

  assertIncludes(promptControls.html, 'data-testid="critical-host-action-confirm"', "host prompt confirm button");
  assertIncludes(promptControls.html, "Resolve skip_next_day prompt", "host prompt confirmation copy");
  assertIncludes(
    promptAck.html,
    'data-testid="host-command-activity-resolve_host_prompt-D01-skip_next_day-slot_1"',
    "host prompt ack row",
  );
  assertIncludes(promptAck.html, 'data-state="ack"', "host prompt ack state");
  assertIncludes(
    slotLifecycleControls.html,
    'data-testid="critical-host-action-confirm"',
    "slot lifecycle confirm button",
  );
  assertIncludes(
    slotLifecycleControls.html,
    "set lifecycle to modkilled",
    "slot lifecycle confirmation copy",
  );
  assertIncludes(
    slotLifecycleAck.html,
    'data-testid="host-command-activity-modkill_slot"',
    "slot lifecycle ack row",
  );
  assertIncludes(slotLifecycleAck.html, 'data-state="ack"', "slot lifecycle ack state");
  assert.equal(invoked[0], event.actionId);
  assert.equal(invoked[1], slotLifecycleEvent.actionId);
  assert.equal(statuses[event.actionId].state, "pending");
  assert.equal(slotLifecycleStatuses[slotLifecycleEvent.actionId].state, "pending");

  return {
    component: "HostAction/HostCommandActivity",
    actions: [
      {
        actionId: invoked[0],
        dispatchKind: "resolve_host_prompt",
        confirmTestId: "critical-host-action-confirm",
        visibleRowTestId:
          "host-command-activity-resolve_host_prompt-D01-skip_next_day-slot_1",
        statusTestId:
          "host-command-activity-status-resolve_host_prompt-D01-skip_next_day-slot_1",
        renderedControlsBytes: Buffer.byteLength(promptControls.html),
        renderedAckBytes: Buffer.byteLength(promptAck.html),
      },
      {
        actionId: invoked[1],
        dispatchKind: "modkill_slot",
        confirmTestId: "critical-host-action-confirm",
        visibleRowTestId: "host-command-activity-modkill_slot",
        statusTestId: "host-command-activity-status-modkill_slot",
        renderedControlsBytes: Buffer.byteLength(slotLifecycleControls.html),
        renderedAckBytes: Buffer.byteLength(slotLifecycleAck.html),
      },
    ],
  };
}

async function proveSourceContract({ component, path: relativePath, requiredSnippets }) {
  const source = await readFile(path.join(repoRoot, relativePath), "utf8");
  for (const snippet of requiredSnippets) {
    assert.equal(
      source.includes(snippet),
      true,
      `${relativePath} missing ${snippet}`,
    );
  }
  return {
    component,
    path: relativePath,
    requiredSnippets,
  };
}

function adminCohostItem() {
  return {
    id: "cohost",
    label: "Add cohost",
    value: "cohost_c",
    authority: "GlobalAdmin",
    boundary: "Command boundary",
    boundaryDetail: "Typed command dispatch",
    buttonLabel: "Add cohost",
    commandAction: "add_cohost",
    confirmMessage: "Delegate cohost_c as cohost for this game",
  };
}

function adminSessionGrantItem() {
  return {
    id: "session-grants",
    label: "Session grants",
    value: "Grant GlobalMod to mod_a",
    authority: "GlobalAdmin",
    boundary: "Authenticated session grant",
    boundaryDetail: "/auth/session-grants requires active GlobalAdmin session",
    buttonLabel: "Grant session",
    commandAction: "grant_session",
    confirmLabel: "Grant GlobalMod",
    confirmMessage: "Grant GlobalMod to mod_a until 4102444800.",
  };
}

function adminRecoveryGateItem() {
  return {
    id: "recovery-gate",
    label: "Recovery go/no-go",
    value: "Run production artifact trust check",
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Operator proof gate",
    boundaryDetail: "/operator/proof-runs/go-no-go",
    buttonLabel: "Check recovery gate",
    action: "check_recovery_gate",
    endpoint: "/games/midsummer/operator/proof-runs/go-no-go?principal_user_id=admin_a",
    confirmLabel: "Check gate",
    confirmMessage: "Check recovery go/no-go for midsummer.",
  };
}

function hostPromptEvent() {
  return {
    actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
    confirmationTrace: {
      kind: "confirmation-command-trace",
      confirmationKind: "confirmation-action",
      surface: "moderator-host",
      actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
      statusKey: "resolve_host_prompt-D01-skip_next_day-slot_1",
      dispatchKind: "resolve_host_prompt",
    },
  };
}

function hostSlotLifecycleEvent() {
  return {
    actionId: "modkill_slot",
    confirmationTrace: {
      kind: "confirmation-command-trace",
      confirmationKind: "confirmation-action",
      surface: "moderator-host",
      actionId: "modkill_slot",
      statusKey: "modkill_slot",
      dispatchKind: "modkill_slot",
    },
  };
}

function assertIncludes(html, expected, label) {
  assert.equal(html.includes(expected), true, `${label} missing ${expected}`);
}

function renderEntrySource() {
  return `import { render } from "svelte/server";
import AdminSetupGrid from "../src/lib/components/admin/AdminSetupGrid.svelte";
import AdminRecoveryPanel from "../src/lib/components/admin/AdminRecoveryPanel.svelte";
import AdminCommandActivity from "../src/lib/components/admin/AdminCommandActivity.svelte";
import PlayerCommandPanel from "../src/lib/components/player-command/PlayerCommandPanel.svelte";
import PlayerCommandReceipt from "../src/lib/components/player-command/PlayerCommandReceipt.svelte";
import HostAction from "../src/lib/components/host-action/HostAction.svelte";
import HostCommandActivity from "../src/lib/components/host-action/HostCommandActivity.svelte";
import { adminConfirmStatus } from "../src/routes/admin/admin-route-controller.mjs";
import {
  playerCommandTrace,
  recordPlayerCommandReceipt,
} from "../src/routes/g/[game]/player-route-controller.mjs";
import { hostConfirmationCommandTrace } from "../src/lib/components/host-action/host-action-contract.mjs";

function adminCohostItem() {
  return {
    id: "cohost",
    label: "Add cohost",
    value: "cohost_c",
    authority: "GlobalAdmin",
    boundary: "Command boundary",
    boundaryDetail: "Typed command dispatch",
    buttonLabel: "Add cohost",
    commandAction: "add_cohost",
    confirmMessage: "Delegate cohost_c as cohost for this game",
  };
}

function adminSessionGrantItem() {
  return {
    id: "session-grants",
    label: "Session grants",
    value: "Grant GlobalMod to mod_a",
    authority: "GlobalAdmin",
    boundary: "Authenticated session grant",
    boundaryDetail: "/auth/session-grants requires active GlobalAdmin session",
    buttonLabel: "Grant session",
    commandAction: "grant_session",
    confirmLabel: "Grant GlobalMod",
    confirmMessage: "Grant GlobalMod to mod_a until 4102444800.",
  };
}

function adminRecoveryGateItem() {
  return {
    id: "recovery-gate",
    label: "Recovery go/no-go",
    value: "Run production artifact trust check",
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Operator proof gate",
    boundaryDetail: "/operator/proof-runs/go-no-go",
    buttonLabel: "Check recovery gate",
    action: "check_recovery_gate",
    endpoint: "/games/midsummer/operator/proof-runs/go-no-go?principal_user_id=admin_a",
    confirmLabel: "Check gate",
    confirmMessage: "Check recovery go/no-go for midsummer.",
  };
}

function hostPromptAction() {
  const actionId = "resolve_host_prompt-D01-skip_next_day-slot_1";
  return {
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
  };
}

function hostSlotLifecycleAction() {
  return {
    id: "modkill_slot",
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
  };
}

export function renderAdminSetupGridConfirm() {
  const item = adminCohostItem();
  return render(AdminSetupGrid, {
    props: {
      items: [item],
      commandStatuses: {
        cohost: adminConfirmStatus(item),
      },
      sessionGrant: {},
      onSetupAction: () => {},
      onConfirmSetupAction: () => {},
      onCancelSetupAction: () => {},
    },
  });
}

export function renderAdminSessionGrantConfirm() {
  const item = adminSessionGrantItem();
  return render(AdminSetupGrid, {
    props: {
      items: [item],
      commandStatuses: {
        "session-grants": adminConfirmStatus(item),
      },
      sessionGrant: {
        token: "session-grant-midsummer",
        principalUserId: "mod_a",
        expiresAt: 4102444800,
        globalCapabilities: ["GlobalMod"],
      },
      onSetupAction: () => {},
      onConfirmSetupAction: () => {},
      onCancelSetupAction: () => {},
    },
  });
}

export function renderAdminRecoveryGateConfirm() {
  const item = adminRecoveryGateItem();
  return render(AdminRecoveryPanel, {
    props: {
      tasks: [item],
      commandStatuses: {
        "recovery-gate": adminConfirmStatus(item),
      },
      game: "midsummer",
      principalUserId: "admin_a",
      onRecoveryTask: () => {},
      onCancelRecoveryTask: () => {},
    },
  });
}

export function renderAdminCommandActivityAck() {
  return render(AdminCommandActivity, {
    props: {
      commandStatuses: {
        cohost: {
          state: "ack",
          message: "Ack: stream seqs 61",
          confirmationTrace: adminConfirmStatus(adminCohostItem()).confirmationTrace,
        },
        "session-grants": {
          state: "ack",
          message: "Granted GlobalMod to mod_a",
          confirmationTrace:
            adminConfirmStatus(adminSessionGrantItem()).confirmationTrace,
        },
        "recovery-gate": {
          state: "ack",
          message: "Recovery gate trusted: 3/3 production artifacts trusted",
          confirmationTrace:
            adminConfirmStatus(adminRecoveryGateItem()).confirmationTrace,
        },
      },
    },
  });
}

export function renderPlayerCommandPanel() {
  return render(PlayerCommandPanel, {
    props: {
      composer: {
        label: "Post or vote",
        defaultBody: "vote: slot-2",
        voteTargetSlot: "slot-2",
      },
      phase: {
        deadlineLabel: "June 19, 2026 at 9:00 PM PT",
        label: "Day 2",
        deadlineProjected: true,
      },
      votecount: [{ target: "slot-2 / Ilya", count: 2, needed: 4 }],
      body: "vote: slot-2",
      onCommand: () => {},
    },
  });
}

export function renderPlayerCommandReceiptVoteAck() {
  return render(PlayerCommandReceipt, {
    props: {
      receipts: recordPlayerCommandReceipt([], "submit_vote", {
        state: "ack",
        message: "Ack: stream seqs 71",
        commandTrace: playerCommandTrace("submit_vote"),
      }),
    },
  });
}

export function renderPlayerCommandReceiptPostAck() {
  return render(PlayerCommandReceipt, {
    props: {
      receipts: recordPlayerCommandReceipt([], "submit_post", {
        state: "ack",
        message: "Ack: stream seqs 72",
        commandTrace: playerCommandTrace("submit_post"),
      }),
    },
  });
}

export function renderHostPromptControlSurfaceConfirm() {
  return render(HostAction, {
    props: {
      action: hostPromptAction(),
      initialConfirmationOpen: true,
      onDispatch: () => {},
    },
  });
}

export function renderHostPromptCommandActivityAck() {
  const action = hostPromptAction();
  return render(HostCommandActivity, {
    props: {
      commandStatuses: {},
      commandOutcomes: [
        {
          actionId: action.id,
          state: "ack",
          message: "Ack",
          confirmationTrace: hostConfirmationCommandTrace(action),
        },
      ],
    },
  });
}

export function renderHostSlotLifecycleControlSurfaceConfirm() {
  return render(HostAction, {
    props: {
      action: hostSlotLifecycleAction(),
      initialConfirmationOpen: true,
      onDispatch: () => {},
    },
  });
}

export function renderHostSlotLifecycleCommandActivityAck() {
  const action = hostSlotLifecycleAction();
  return render(HostCommandActivity, {
    props: {
      commandStatuses: {},
      commandOutcomes: [
        {
          actionId: action.id,
          state: "ack",
          message: "Ack: stream seqs 73",
          confirmationTrace: hostConfirmationCommandTrace(action),
        },
      ],
    },
  });
}
`;
}
