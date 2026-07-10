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
    statusLabel: "Official result",
    command: "/day-vote-outcomes",
    label: "Official record",
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

test("day vote outcome panel renders no-lynch without raw engine keys", () => {
  const view = buildDayVoteOutcomePanelViewModel({
    outcomes: [
      {
        phaseId: "D01",
        status: "NoLynch",
        winnerSlot: null,
        tallies: { no_lynch: 2 },
        majority: 2,
      },
    ],
  });

  assert.deepEqual(view.latest, {
    phaseId: "D01",
    status: "NoLynch",
    winnerSlot: null,
    winnerLabel: "No lynch",
    summary: "The official vote resolved without an elimination.",
    reason: undefined,
    testId: "day-vote-outcome-latest",
  });
  assert.deepEqual(
    view.tallies.map((row) => [row.slotLabel, row.count, row.majority, row.testId]),
    [["No lynch", 2, 2, "day-vote-outcome-tally-no_lynch"]],
  );
});

test("day vote outcome panel names the final HostDecides selection", () => {
  const view = buildDayVoteOutcomePanelViewModel({
    rootTestId: "player-day-vote-outcome",
    outcomes: [
      {
        phaseId: "D01",
        status: "Lynch",
        winnerSlot: "slot-2",
        tallies: { "slot-1": 2, "slot-2": 2 },
        majority: null,
        reason: "host_decides_tie",
      },
    ],
  });

  assert.equal(view.latest.summary, "Slot 2 was eliminated by official vote.");
  assert.equal(
    view.latest.reason,
    "HostDecides selected Slot 2 after the tied vote.",
  );
});
