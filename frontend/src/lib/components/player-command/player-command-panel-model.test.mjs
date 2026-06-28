import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlayerCommandPanelViewModel,
  PLAYER_COMMAND_PANEL_CONTRACT,
} from "./player-command-panel-model.mjs";

test("player command panel model exposes tablet touch command contracts", () => {
  const view = buildPlayerCommandPanelViewModel({
    composer: {
      defaultBody: "##vote slot-2",
      voteCommandLabel: "Vote slot-2",
      withdrawCommandLabel: "Withdraw vote",
      postCommandLabel: "Post",
      actionCommands: [
        {
          action: "submit_action",
          label: "Submit factional kill",
          detail: "factional_kill -> slot-2",
          templateId: "factional_kill",
          targets: ["slot-2"],
        },
      ],
    },
    phase: {
      label: "Day 2",
      state: "open",
      deadlineLabel: "Jun 19, 2026, 9:00 PM",
    },
    votecount: [{ target: "slot-2 / Ilya", count: 4, needed: 7 }],
    channel: {
      channel: "role-pm",
      label: "Role PM",
      capabilityLabel: "ChannelMember(role-pm)",
    },
    player: {
      slotId: "slot-7",
      capabilityLabel: "ChannelMember(role-pm)",
    },
  });

  assert.equal(view.root.className, PLAYER_COMMAND_PANEL_CONTRACT.rootClassName);
  assert.equal(view.root.data.component, "player-command-panel");
  assert.equal(view.root.data.thumbZone, "player-primary-actions");
  assert.equal(view.root.data.channelId, "role-pm");
  assert.equal(view.root.testId, "player-primary-action-zone");
  assert.deepEqual(view.composer.channelContext, {
    testId: PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
    channelId: "role-pm",
    channelLabel: "Role PM",
    capabilityLabel: "ChannelMember(role-pm)",
    slotId: "slot-7",
    actorAlive: "unknown",
    actorStatus: "",
    label: "Posting target",
    value: "Role PM as slot-7",
  });
  assert.deepEqual(view.deadline, {
    testId: "player-votecount-deadline",
    label: "Deadline",
    phaseLabel: "Day 2",
    value: "Jun 19, 2026, 9:00 PM",
    state: "open",
    isProjected: true,
  });
  assert.deepEqual(view.rows, [{ target: "slot-2 / Ilya", tally: "4/7" }]);
  assert.deepEqual(
    view.composer.buttons.map((button) => ({
      action: button.action,
      label: button.label,
      disabled: button.disabled,
      minTouchTargetPx: button.data.minTouchTargetPx,
    })),
    [
      { action: "submit_vote", label: "Vote slot-2", disabled: false, minTouchTargetPx: 44 },
      { action: "withdraw_vote", label: "Withdraw vote", disabled: false, minTouchTargetPx: 44 },
      { action: "submit_post", label: "Post", disabled: false, minTouchTargetPx: 44 },
    ],
  );
  assert.deepEqual(
    view.composer.actionButtons.map((button) => ({
      action: button.action,
      label: button.label,
      disabled: button.disabled,
      detail: button.detail,
      templateId: button.data.templateId,
      targetSlots: button.data.targetSlots,
      minTouchTargetPx: button.data.minTouchTargetPx,
    })),
    [
      {
        action: "submit_action",
        label: "Submit factional kill",
        disabled: false,
        detail: "factional_kill -> slot-2",
        templateId: "factional_kill",
        targetSlots: ["slot-2"],
        minTouchTargetPx: 44,
      },
    ],
  );
  assert.match(view.composer.buttons[1].className, /secondary/);
});

test("player command panel model disables command controls for dead actors", () => {
  const view = buildPlayerCommandPanelViewModel({
    composer: {
      voteCommandLabel: "Vote slot-2",
      withdrawCommandLabel: "Withdraw vote",
      postCommandLabel: "Post",
      actionCommands: [],
    },
    channel: { channel: "main", label: "Main thread" },
    player: {
      slotId: "slot-2",
      alive: false,
      status: "dead",
      capabilityLabel: "SlotOccupant(slot-2)",
    },
  });

  assert.deepEqual(view.composer.channelContext, {
    testId: PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
    channelId: "main",
    channelLabel: "Main thread",
    capabilityLabel: "SlotOccupant(slot-2)",
    slotId: "slot-2",
    actorAlive: "false",
    actorStatus: "dead",
    label: "Posting target",
    value: "Main thread as slot-2 (dead)",
  });
  assert.deepEqual(
    view.composer.buttons.map((button) => [button.action, button.disabled]),
    [
      ["submit_vote", true],
      ["withdraw_vote", true],
      ["submit_post", true],
    ],
  );
  assert.deepEqual(view.composer.actionButtons, []);
});

test("player command panel model surfaces replaced slot recovery context", () => {
  const view = buildPlayerCommandPanelViewModel({
    composer: {
      voteCommandLabel: "Vote slot-2",
      withdrawCommandLabel: "Withdraw vote",
      postCommandLabel: "Post",
      actionCommands: [],
    },
    channel: {
      channel: "main",
      label: "Main thread",
      capabilityLabel: "SlotOccupant or ChannelMember(main)",
    },
    player: {
      slotId: "slot-7",
      alive: false,
      status: "replaced",
      capabilityLabel: "No current SlotOccupant(slot-7)",
    },
  });

  assert.deepEqual(view.composer.channelContext, {
    testId: PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
    channelId: "main",
    channelLabel: "Main thread",
    capabilityLabel: "No current SlotOccupant(slot-7)",
    slotId: "slot-7",
    actorAlive: "false",
    actorStatus: "replaced",
    label: "Posting target",
    value: "Main thread as slot-7 (replaced)",
  });
  assert.deepEqual(
    view.composer.buttons.map((button) => [button.action, button.disabled]),
    [
      ["submit_vote", true],
      ["withdraw_vote", true],
      ["submit_post", true],
    ],
  );
});

test("player command panel model normalizes missing row and label data", () => {
  const view = buildPlayerCommandPanelViewModel({
    composer: {},
    votecount: [{}],
  });

  assert.deepEqual(view.rows, [{ target: "unknown", tally: "0/0" }]);
  assert.deepEqual(view.composer.channelContext, {
    testId: PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
    channelId: "main",
    channelLabel: "Main thread",
    capabilityLabel: "Scoped player capability",
    slotId: "slot",
    actorAlive: "unknown",
    actorStatus: "",
    label: "Posting target",
    value: "Main thread as slot",
  });
  assert.deepEqual(view.deadline, {
    testId: "player-votecount-deadline",
    label: "Deadline",
    phaseLabel: "Current phase",
    value: "No deadline projected",
    state: "unknown",
    isProjected: false,
  });
  assert.deepEqual(
    view.composer.buttons.map((button) => button.label),
    ["submit_vote", "withdraw_vote", "submit_post"],
  );
  assert.deepEqual(view.composer.actionButtons, []);
});
