import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDayVoteOutcomePanelViewModel,
} from "./day-vote-outcome-panel.mjs";

test("day vote outcome panel summarizes the latest official result", () => {
  const view = buildDayVoteOutcomePanelViewModel({
    rootTestId: "player-day-vote-outcome",
    boundary: {
      status: "official-engine-result",
      command: "/day-vote-outcomes",
    },
    outcomes: [
      {
        phaseId: "D01",
        sourceSeq: 8,
        eventIndex: 0,
        status: "Lynch",
        winnerSlot: "slot-2",
        tallies: { "slot-2": 4, "slot-7": 2 },
        majority: 4,
      },
    ],
  });

  assert.equal(view.root.testId, "player-day-vote-outcome");
  assert.equal(view.root.data.state, "available");
  assert.deepEqual(view.boundary, {
    status: "official-engine-result",
    command: "/day-vote-outcomes",
    commandTestId: "player-day-vote-outcome-boundary",
  });
  assert.deepEqual(view.latest, {
    phaseId: "D01",
    status: "Lynch",
    winnerSlot: "slot-2",
    winnerLabel: "Slot 2",
    summary: "Slot 2 was eliminated by official vote.",
    reason: undefined,
    testId: "player-day-vote-outcome-latest",
  });
  assert.deepEqual(
    view.tallies.map((row) => [row.slot, row.count, row.majority, row.testId]),
    [
      ["slot-2", 4, 4, "player-day-vote-outcome-tally-slot-2"],
      ["slot-7", 2, 4, "player-day-vote-outcome-tally-slot-7"],
    ],
  );
});

test("day vote outcome panel has a stable empty state", () => {
  const view = buildDayVoteOutcomePanelViewModel();

  assert.equal(view.root.data.state, "empty");
  assert.equal(view.latest, null);
  assert.equal(view.empty.message, "No official day vote result");
  assert.deepEqual(view.tallies, []);
});
