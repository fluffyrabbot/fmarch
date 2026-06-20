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
      minTouchTargetPx: button.data.minTouchTargetPx,
    })),
    [
      { action: "submit_vote", label: "Vote slot-2", minTouchTargetPx: 44 },
      { action: "withdraw_vote", label: "Withdraw vote", minTouchTargetPx: 44 },
      { action: "submit_post", label: "Post", minTouchTargetPx: 44 },
    ],
  );
  assert.match(view.composer.buttons[1].className, /secondary/);
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
});
