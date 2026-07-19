import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOST_CONTROL_SURFACE_CONTRACT,
  buildHostControlSurfaceViewModel,
  commandStatusMessage,
} from "./host-control-surface.mjs";
import {
  buildHostConsoleActionGroups,
  buildHostConsoleCriticalActions,
} from "./host-console-critical-action.mjs";

test("host control surface model binds moderator control bays to action status", () => {
  const actions = buildHostConsoleCriticalActions("midsummer", {
    hostPrompts: [],
  });
  const groups = buildHostConsoleActionGroups({
    actions,
    pendingPromptCount: 0,
    votecountCount: 2,
  });
  const view = buildHostControlSurfaceViewModel({
    groups,
    commandContext: {
      gameId: "midsummer",
      principalUserId: "host_h",
      capabilityLabel: "HostOf(midsummer)",
      commandEndpoint: "/commands",
    },
    commandStatuses: {
      lock_thread: { state: "ack", message: "Ack: stream seqs 42" },
      modkill_slot: { state: "reject", message: "Reject Forbidden" },
    },
  });

  assert.equal(view.root.className, HOST_CONTROL_SURFACE_CONTRACT.rootClassName);
  assert.equal(view.root.ariaLabel, "Moderator controls");
  assert.equal(view.root.data.component, "host-control-surface");
  assert.equal(view.root.data.thumbZone, "moderator-primary-actions");
  assert.equal(view.root.data.actionPriority, "primary");
  assert.equal(view.root.data.controlRailMode, "flow-host-control-actions");
  assert.equal(view.root.data.stickyTopPx, 0);
  assert.equal(view.root.data.unstickBelowPx, 0);
  assert.equal(view.root.data.actionTileStabilityMode, "reserved-status-floor");
  assert.equal(view.root.data.gameId, "midsummer");
  assert.equal(view.root.data.principalUserId, "host_h");
  assert.equal(view.root.data.capabilityLabel, "HostOf(midsummer)");
  assert.equal(view.root.testId, "moderator-primary-action-zone");
  assert.deepEqual(view.commandContext, {
    testId: HOST_CONTROL_SURFACE_CONTRACT.commandContextTestId,
    summary: "Acting as host_h",
    label: "Moderator access",
    value: "HostOf(midsummer) as host_h",
    gameId: "midsummer",
    principalUserId: "host_h",
    capabilityLabel: "HostOf(midsummer)",
    commandEndpoint: "/commands",
  });
  assert.deepEqual(
    view.groups.map((group) => group.id),
    [
      "deadline",
      "phase",
      "votecount",
      "replacement",
      "host-prompts",
      "slot-lifecycle",
      "roles",
    ],
  );

  const phase = view.groups.find((group) => group.id === "phase");
  assert.deepEqual(
    phase.actions.map((action) => [action.config.id, action.statusMessage]),
    [
      ["resolve_phase", ""],
      ["lock_thread", "Lock thread completed."],
      ["unlock_thread", ""],
      ["advance_phase", ""],
    ],
  );
  assert.equal(phase.actions[1].statusTestId, "host-command-status-lock_thread");
  assert.equal(
    phase.actions[1].statusFloorTestId,
    "host-command-status-floor-lock_thread",
  );
  assert.equal(phase.actions[1].status.message, "Lock thread completed.");
  assert.equal(phase.actions[1].protocolStatusMessage, "Ack: stream seqs 42");
  assert.equal(phase.actions[1].statusFloorMinBlockSizePx, 44);
  assert.equal(
    phase.classes.actionTile,
    "host-console-critical-path__action-tile",
  );
  assert.equal(
    phase.classes.actionBay,
    "host-console-critical-path__action-bay fm-action-tray",
  );
  assert.equal(
    phase.classes.commandStatusFloor,
    "host-console-critical-path__command-status-floor",
  );
  assert.deepEqual(phase.diagnostics, {
    testId: "moderator-control-phase-diagnostics",
    summary: "Technical details",
    authority: "HostOf(game)",
    boundary: "Typed commands",
    protocol:
      "ResolvePhase, LockThread, UnlockThread, AdvancePhase, AdvancePhaseByDeadline",
    statuses: [{ action: "Lock thread", message: "Ack: stream seqs 42" }],
  });
  assert.equal(
    view.groups.find((group) => group.id === "slot-lifecycle").actions[1].status.state,
    "reject",
  );
});

test("host control surface model preserves empty host prompt bay", () => {
  const actions = buildHostConsoleCriticalActions("midsummer", {
    hostPrompts: [],
  });
  const view = buildHostControlSurfaceViewModel({
    groups: buildHostConsoleActionGroups({
      actions,
      pendingPromptCount: 0,
      votecountCount: 0,
    }),
  });
  const hostPrompts = view.groups.find((group) => group.id === "host-prompts");

  assert.equal(hostPrompts.actions.length, 0);
  assert.equal(hostPrompts.emptyLabel, "No pending host prompts.");
  assert.equal(hostPrompts.classes.empty, "host-console-critical-path__empty-action");
});

test("host control surface status message is empty until an action reports", () => {
  assert.equal(commandStatusMessage(undefined), "");
  assert.equal(commandStatusMessage(null), "");
  assert.equal(
    commandStatusMessage(
      { state: "pending", message: "Sending command" },
      "Resolve phase",
    ),
    "Resolve phase is in progress.",
  );
});

test("host control surface context falls back without claiming real authority", () => {
  const view = buildHostControlSurfaceViewModel();

  assert.deepEqual(view.commandContext, {
    testId: HOST_CONTROL_SURFACE_CONTRACT.commandContextTestId,
    summary: "Acting as host",
    label: "Moderator access",
    value: "HostOf(game) as host",
    gameId: "game",
    principalUserId: "host",
    capabilityLabel: "HostOf(game)",
    commandEndpoint: "/commands",
  });
});
