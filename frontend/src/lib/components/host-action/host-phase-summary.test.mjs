import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOST_PHASE_SUMMARY_CONTRACT,
  buildHostPhaseSummaryViewModel,
} from "./host-phase-summary.mjs";

test("host phase summary model renders live phase and slot projection facts", () => {
  const view = buildHostPhaseSummaryViewModel({
    phase: {
      state: "open",
      label: "Day 2",
      summary: "Day 2 deadline is active.",
      deadlineLabel: "No deadline committed",
      lockedLabel: "Thread open",
    },
    projection: {
      phase: {
        deadlineLabel: "Jun 19, 2026, 9:00 PM",
        lockedLabel: "Thread locked",
      },
      replacement: {
        slotId: "slot-7",
        occupantLabel: "player-rowan",
        lifecycleLabel: "Modkilled",
        historyLabel: "Slot history remains attached to slot-7",
      },
      slots: [
        {
          role_revealed: true,
          alignment_revealed: true,
        },
        {
          role_revealed: true,
          alignment_revealed: true,
        },
      ],
    },
  });

  assert.equal(view.root.className, HOST_PHASE_SUMMARY_CONTRACT.rootClassName);
  assert.equal(view.root.data.component, "host-phase-summary");
  assert.equal(view.eyebrow, "open");
  assert.equal(view.heading, "Day 2");
  assert.deepEqual(
    view.facts.map((fact) => [fact.label, fact.value, fact.testId]),
    [
      ["Deadline", "Jun 19, 2026, 9:00 PM", "host-console-deadline"],
      ["Thread", "Thread locked", "host-console-thread-lock"],
      ["Slot 7 occupant", "player-rowan", "host-console-slot-occupant"],
      ["Lifecycle", "Modkilled", "host-console-slot-lifecycle"],
      [
        "Slot history",
        "Slot history remains attached to slot-7",
        "host-console-history",
      ],
      ["Endgame reveal", "All 2 slots revealed", "host-console-endgame-reveal"],
    ],
  );
});

test("host phase summary model falls back without inventing state", () => {
  const view = buildHostPhaseSummaryViewModel({
    phase: {
      label: "Day 1",
      deadlineLabel: "No deadline extension committed",
      lockedLabel: "Thread open",
    },
    projection: {
      replacement: { slotId: "slot_12" },
    },
  });

  assert.equal(view.eyebrow, "unknown");
  assert.equal(view.summary, "Phase state is loading.");
  assert.deepEqual(
    view.facts.map((fact) => [fact.label, fact.value]),
    [
      ["Deadline", "No deadline extension committed"],
      ["Thread", "Thread open"],
      ["Slot 12 occupant", "Unknown occupant"],
      ["Lifecycle", "Unknown lifecycle"],
      ["Slot history", "Slot history unavailable"],
      ["Endgame reveal", "Role sheet private"],
    ],
  );
});
