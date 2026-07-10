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
      voteCommands: [
        { action: "submit_vote", label: "Vote slot-2" },
        { action: "submit_vote:no_lynch", label: "Vote no lynch" },
      ],
      withdrawCommandLabel: "Withdraw vote",
      currentVoteLabel: "Current vote: Slot 2",
      hasCurrentVote: true,
      canWithdrawVote: true,
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
      channel: "private:role_pm:slot-7",
      label: "Role PM",
      capabilityLabel: "ChannelMember(private:role_pm:slot-7)",
    },
    player: {
      slotId: "slot-7",
      capabilityLabel: "ChannelMember(private:role_pm:slot-7)",
    },
  });

  assert.equal(view.root.className, PLAYER_COMMAND_PANEL_CONTRACT.rootClassName);
  assert.equal(view.root.data.component, "player-command-panel");
  assert.equal(view.root.data.thumbZone, "player-primary-actions");
  assert.equal(view.root.data.channelId, "private:role_pm:slot-7");
  assert.equal(view.root.testId, "player-primary-action-zone");
  assert.deepEqual(view.composer.channelContext, {
    testId: PLAYER_COMMAND_PANEL_CONTRACT.channelContextTestId,
    channelId: "private:role_pm:slot-7",
    channelLabel: "Role PM",
    capabilityLabel: "ChannelMember(private:role_pm:slot-7)",
    slotId: "slot-7",
    actorAlive: "unknown",
    actorStatus: "",
    label: "Posting target",
    value: "Role PM as slot-7",
    audienceLabel: "Only this channel's members read this",
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
  assert.deepEqual(view.composer.currentVote, {
    testId: "player-current-vote",
    label: "Current vote",
    value: "Slot 2",
    hasVote: true,
  });
  assert.deepEqual(
    view.composer.buttons.map((button) => ({
      action: button.action,
      label: button.label,
      disabled: button.disabled,
      reason: button.reason,
      minTouchTargetPx: button.data.minTouchTargetPx,
    })),
    [
      {
        action: "submit_vote",
        label: "Vote slot-2",
        disabled: false,
        reason: "",
        minTouchTargetPx: 44,
      },
      {
        action: "submit_vote:no_lynch",
        label: "Vote no lynch",
        disabled: false,
        reason: "",
        minTouchTargetPx: 44,
      },
      {
        action: "withdraw_vote",
        label: "Withdraw vote",
        disabled: false,
        reason: "",
        minTouchTargetPx: 44,
      },
      {
        action: "submit_post",
        label: "Post",
        disabled: false,
        reason: "",
        minTouchTargetPx: 44,
      },
    ],
  );
  assert.deepEqual(
    view.composer.actionPicker.actions.map((pickerAction) => ({
      action: pickerAction.action,
      label: pickerAction.label,
      detail: pickerAction.detail,
      templateId: pickerAction.templateId,
      targets: pickerAction.targets,
      triggerTestId: pickerAction.trigger.testId,
      triggerDisabled: pickerAction.trigger.disabled,
      minTouchTargetPx: pickerAction.trigger.data.minTouchTargetPx,
      confirming: pickerAction.confirming,
    })),
    [
      {
        action: "submit_action",
        label: "Submit factional kill",
        detail: "factional_kill -> slot-2",
        templateId: "factional_kill",
        targets: ["slot-2"],
        triggerTestId: "player-action-trigger-factional_kill",
        triggerDisabled: false,
        minTouchTargetPx: 44,
        confirming: false,
      },
    ],
  );
  assert.deepEqual(view.composer.actionPicker.recoveryCommands, []);
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
    audienceLabel: "Everyone at the table reads this",
  });
  assert.deepEqual(
    view.composer.buttons.map((button) => [button.action, button.disabled]),
    [
      ["submit_vote", true],
      ["withdraw_vote", true],
      ["submit_post", true],
    ],
  );
  assert.deepEqual(view.composer.actionPicker.actions, []);
  assert.deepEqual(view.composer.actionPicker.recoveryCommands, []);
});

test("dead chat enables only posting for a dead actor", () => {
  const view = buildPlayerCommandPanelViewModel({
    composer: {
      voteCommandLabel: "Vote slot-2",
      withdrawCommandLabel: "Withdraw vote",
      postCommandLabel: "Post to dead chat",
      actionCommands: [
        {
          action: "submit_action",
          label: "Submit action",
          templateId: "night_action",
          targets: ["slot-2"],
        },
      ],
    },
    channel: {
      channel: "dead",
      label: "Dead chat",
      capabilityLabel: "DeadViewer(midsummer)",
    },
    player: {
      slotId: "slot-7",
      alive: false,
      status: "dead",
      capabilityLabel: "DeadViewer(midsummer)",
    },
  });

  assert.equal(view.composer.channelContext.channelId, "dead");
  assert.equal(view.composer.channelContext.actorAlive, "false");
  assert.deepEqual(
    view.composer.buttons.map((button) => [button.action, button.disabled]),
    [
      ["submit_vote", true],
      ["withdraw_vote", true],
      ["submit_post", false],
    ],
  );
  assert.equal(view.composer.actionPicker.actions[0].trigger.disabled, true);
});

test("player command panel disables withdraw until command state has a current vote", () => {
  const view = buildPlayerCommandPanelViewModel({
    composer: {
      voteCommandLabel: "Vote slot-2",
      withdrawCommandLabel: "Withdraw vote",
      withdrawDisabledReason: "No current vote",
      postCommandLabel: "Post",
      currentVoteLabel: "No current vote",
      hasCurrentVote: false,
      canWithdrawVote: false,
      actionCommands: [],
    },
    channel: { channel: "main", label: "Main thread" },
    player: {
      slotId: "slot-2",
      alive: true,
      status: "alive",
      capabilityLabel: "SlotOccupant(slot-2)",
    },
  });

  assert.deepEqual(view.composer.currentVote, {
    testId: "player-current-vote",
    label: "Current vote",
    value: "No current vote",
    hasVote: false,
  });
  assert.deepEqual(
    view.composer.buttons.map((button) => [
      button.action,
      button.disabled,
      button.reason,
    ]),
    [
      ["submit_vote", false, ""],
      ["withdraw_vote", true, "No current vote"],
      ["submit_post", false, ""],
    ],
  );
});

test("player command panel honors an explicitly empty live vote command list", () => {
  const view = buildPlayerCommandPanelViewModel({
    composer: {
      voteCommands: [],
      voteCommandLabel: "Vote slot-2",
      withdrawCommandLabel: "Withdraw vote",
      withdrawDisabledReason: "Phase locked",
      postCommandLabel: "Post",
      currentVoteLabel: "Current vote: Slot 2",
      hasCurrentVote: true,
      canWithdrawVote: false,
      actionCommands: [],
    },
    player: { alive: true, status: "alive", slotId: "slot-2" },
  });

  assert.deepEqual(
    view.composer.buttons.map((button) => [
      button.action,
      button.disabled,
      button.reason,
    ]),
    [
      ["withdraw_vote", true, "Phase locked"],
      ["submit_post", false, ""],
    ],
  );
});

test("player command panel model disables command controls after completion", () => {
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
      alive: true,
      status: "alive",
      gameCompleted: true,
      capabilityLabel: "SlotOccupant(slot-2)",
    },
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
    audienceLabel: "Everyone at the table reads this",
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
    audienceLabel: "Everyone at the table reads this",
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
  assert.deepEqual(view.composer.actionPicker.actions, []);
  assert.deepEqual(view.composer.actionPicker.recoveryCommands, []);
});
