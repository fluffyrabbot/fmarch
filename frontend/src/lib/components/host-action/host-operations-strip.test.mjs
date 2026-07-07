import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOST_OPERATIONS_STRIP_CONTRACT,
  buildHostOperationsStripViewModel,
} from "./host-operations-strip.mjs";

test("host operations strip summarizes projection-backed host posture", () => {
  const view = buildHostOperationsStripViewModel({
    access: { capabilityLabel: "HostOf(midsummer)" },
    phase: {
      label: "Day 2",
      deadlineLabel: "No deadline extension committed",
      lockedLabel: "Thread open",
    },
    projection: {
      phase: {
        deadlineLabel: "Jun 19, 2026, 9:00 PM",
        lockedLabel: "Thread locked",
      },
      replacement: {
        occupantLabel: "player-rowan",
        lifecycleLabel: "Alive",
        historyLabel: "Slot history remains attached to slot-7",
      },
    },
    votecountBoundary: {
      status: "json-ws-command-projection-deltas-with-resync",
      command: "official-votecount-live-ws",
    },
    votecount: [
      { target: "slot-2 / Ilya", count: 4, needed: 7 },
      { target: "slot-7 / Mira", count: 2, needed: 7 },
    ],
    hostPrompts: [],
  });

  assert.equal(view.root.className, HOST_OPERATIONS_STRIP_CONTRACT.rootClassName);
  assert.equal(view.root.data.component, "host-operations-strip");
  assert.deepEqual(
    view.items.map((item) => [
      item.id,
      item.value,
      item.detail,
      item.status.state,
      item.testId,
      item.statusTestId,
    ]),
    [
      [
        "phase",
        "Day 2",
        "Jun 19, 2026, 9:00 PM · Thread locked",
        "ack",
        "host-operation-phase",
        "host-operation-status-phase",
      ],
      [
        "votecount",
        "2 projected targets",
        "Live official tally",
        "ack",
        "host-operation-votecount",
        "host-operation-status-votecount",
      ],
      [
        "prompts",
        "0 pending prompts",
        "No pending host prompts",
        "ack",
        "host-operation-prompts",
        "host-operation-status-prompts",
      ],
      [
        "lifecycle",
        "Alive",
        "player-rowan · Slot history remains attached to slot-7",
        "ack",
        "host-operation-lifecycle",
        "host-operation-status-lifecycle",
      ],
    ],
  );
});

test("host operations strip marks host work as pending without inventing errors", () => {
  const view = buildHostOperationsStripViewModel({
    access: { capabilityLabel: "HostOf(midsummer)" },
    phase: {
      label: "Day 2",
      deadlineLabel: "No deadline extension committed",
      lockedLabel: "Thread open",
    },
    projection: {
      replacement: {
        occupantLabel: "player-mira",
        lifecycleLabel: "Alive",
        historyLabel: "Waiting for replacement command proof",
      },
    },
    votecountBoundary: {
      status: "json-ws-command-projection-deltas-with-resync",
      command: "official-votecount-live-ws",
    },
    votecount: [],
    hostPrompts: [
      {
        id: "D01:skip_next_day:slot_1",
        label: "skip_next_day",
        value: "beloved_princess_death",
        status: "pending",
      },
    ],
  });

  assert.deepEqual(
    view.items.map((item) => [item.id, item.status.state, item.status.message]),
    [
      ["phase", "pending", "Deadline needs host review"],
      ["votecount", "pending", "No active projected ballots"],
      ["prompts", "pending", "Host prompt requires resolution"],
      ["lifecycle", "pending", "Slot lifecycle needs host action"],
    ],
  );
  assert.equal(view.items[2].detail, "skip_next_day: beloved_princess_death");
});

test("host operations strip fails closed for missing lifecycle projection", () => {
  const view = buildHostOperationsStripViewModel({
    votecountBoundary: {},
  });

  assert.equal(
    view.items.find((item) => item.id === "lifecycle").status.state,
    "reject",
  );
  assert.equal(
    view.items.find((item) => item.id === "votecount").status.message,
    "Votecount live boundary not established",
  );
});
