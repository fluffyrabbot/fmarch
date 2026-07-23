import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAYER_DAY_EVENT_RAIL_CONTRACT,
  buildPlayerDayEventRailViewModel,
} from "./player-day-event-rail-model.mjs";

test("player DayEvent rail exposes one touch action per attention item", () => {
  const view = buildPlayerDayEventRailViewModel({
    commands: [{
      action: "submit_day_event:event-cookie",
      eventId: "event-cookie",
      label: "Join Cookie raffle",
      detail: "2/5 joined · Cookie",
      status: "available",
    }],
    player: { readOnly: false, gameCompleted: false },
  });

  assert.equal(view.root.testId, PLAYER_DAY_EVENT_RAIL_CONTRACT.testId);
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].action, "submit_day_event:event-cookie");
  assert.equal(view.items[0].disabled, false);
  assert.equal(view.items[0].minTouchTargetPx, 44);
});

test("player DayEvent rail disables participation during pending commands", () => {
  const view = buildPlayerDayEventRailViewModel({
    commands: [{
      action: "withdraw_day_event:event-cookie",
      eventId: "event-cookie",
      label: "Leave Cookie raffle",
      status: "submitted",
    }],
    commandPending: true,
  });

  assert.equal(view.root.ariaBusy, "true");
  assert.equal(view.items[0].disabled, true);
});
