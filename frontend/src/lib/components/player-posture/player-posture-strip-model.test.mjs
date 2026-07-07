import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLAYER_POSTURE_STRIP_CONTRACT,
  buildPlayerPostureStripViewModel,
} from "./player-posture-strip-model.mjs";

test("player posture strip summarizes phase deadline and private posture", () => {
  const view = buildPlayerPostureStripViewModel({
    phase: {
      label: "Day 1",
      state: "open",
      deadlineLabel: "Jun 20, 2026, 5:00 PM",
      summary: "Day 1 is open.",
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 2,
    },
  });

  assert.equal(view.root.className, PLAYER_POSTURE_STRIP_CONTRACT.rootClassName);
  assert.equal(view.root.data.component, "player-posture-strip");
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
        "Day 1",
        "Day 1 is open.",
        "ack",
        "player-posture-phase",
        "player-posture-status-phase",
      ],
      [
        "deadline",
        "Jun 20, 2026, 5:00 PM",
        "The phase closes at this time",
        "ack",
        "player-posture-deadline",
        "player-posture-status-deadline",
      ],
      [
        "private",
        "2 private items",
        "For your eyes only",
        "pending",
        "player-posture-private",
        "player-posture-status-private",
      ],
    ],
  );
  assert.deepEqual(
    view.items.map((item) => [item.id, item.evidence]),
    [
      ["phase", null],
      ["deadline", null],
      ["private", "principal-scoped-private-projections"],
    ],
  );
});

test("player posture strip surfaces missing deadline and locked phase", () => {
  const view = buildPlayerPostureStripViewModel({
    phase: {
      label: "Night 2",
      state: "locked",
      deadlineLabel: "",
      summary: "Night 2 is locked.",
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 0,
    },
  });

  assert.deepEqual(
    view.items.map((item) => [item.id, item.status.state, item.status.message]),
    [
      ["phase", "pending", "The phase is locked"],
      ["deadline", "pending", "Deadline not committed"],
      ["private", "ack", "No private items visible"],
    ],
  );
  assert.equal(view.items[1].value, "No deadline committed");
  const allCopy = view.items
    .flatMap((item) => [item.label, item.value, item.detail, item.status.message])
    .join(" ");
  assert.doesNotMatch(allCopy, /host console|moderator|prompt/i);
});

test("player posture strip keeps transport vocabulary out of visible copy", () => {
  const view = buildPlayerPostureStripViewModel({
    phase: {
      label: "Day 1",
      state: "open",
      deadlineLabel: "Jun 20, 2026, 5:00 PM",
      summary: "Day 1 is open.",
    },
    privateQueueBoundary: { status: "principal-scoped-private-projections", count: 1 },
  });
  const visibleCopy = view.items
    .flatMap((item) => [item.label, item.value, item.detail, item.status.message])
    .join(" ");
  assert.doesNotMatch(visibleCopy, /json-ws|projection|endpoint|principal-scoped|\/games\//i);
});
