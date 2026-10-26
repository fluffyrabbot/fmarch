import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOST_CONSOLE_BAR_CONTRACT,
  buildHostConsoleBarViewModel,
  formatDeadlineCountdown,
} from "./host-console-bar.mjs";

const tasks = ["deadline", "phase", "votecount", "replacement", "slot-lifecycle", "roles"].map((id) => ({ id }));

test("the bar names the phase, counts decisions, counts down the deadline and splits the tools by frequency", () => {
  const view = buildHostConsoleBarViewModel({
    game: { label: "Midsummer Invitational" },
    phase: { label: "Day 1", deadline: 1781841600, deadlineLabel: "June 18, 2026 at 9:00 PM PT" },
    nowSeconds: 1781806740,
    attentionCount: 3,
    tasks,
    decisions: [{ id: "replacement" }],
    postAvailable: true,
  });

  assert.equal(view.root.testId, HOST_CONSOLE_BAR_CONTRACT.rootTestId);
  assert.equal(view.gameLabel, "Midsummer Invitational");
  assert.equal(view.title, "Host · Day 1");
  assert.deepEqual(view.attention, {
    testId: "host-console-attention", count: 3, label: "Attention", value: "3 decisions", state: "attention",
  });
  assert.deepEqual(view.deadline, {
    testId: "host-console-bar-deadline", label: "Deadline", value: "Closes in 9h 41m", detail: "June 18, 2026 at 9:00 PM PT",
  });
  assert.deepEqual(view.post, { testId: "host-bar-post", label: "Post", available: true });
  assert.deepEqual(
    view.routine.map((tool) => [tool.id, tool.label, tool.testId, tool.available, tool.due]),
    [
      ["votecount", "Votecount", "host-tool-votecount", true, false],
      ["deadline", "Deadline", "host-tool-deadline", true, false],
      ["phase", "End phase", "host-tool-phase", true, false],
    ],
  );
  assert.equal(view.tools.testId, "host-tools");
  assert.equal(view.tools.label, "Tools");
  assert.deepEqual(
    view.tools.items.map((tool) => [tool.id, tool.label, tool.testId, tool.available, tool.due]),
    [
      ["replacement", "Replacement", "host-tool-replacement", true, true],
      ["slot-lifecycle", "Slot lifecycle", "host-tool-slot-lifecycle", true, false],
      ["roles", "Roles", "host-tool-roles", true, false],
    ],
  );
});

test("before the first phase the bar waits, has no deadline and withholds tools the host does not have", () => {
  const view = buildHostConsoleBarViewModel({ game: {}, tasks: [{ id: "deadline" }] });
  assert.equal(view.gameLabel, "Game");
  assert.equal(view.title, "Host · Awaiting first phase");
  assert.deepEqual(view.attention, {
    testId: "host-console-attention", count: 0, label: "Attention", value: "0 decisions", state: "idle",
  });
  assert.equal(view.deadline, null);
  assert.equal(view.post.available, false);
  assert.deepEqual(view.routine.map((tool) => tool.available), [false, true, false]);
  assert.deepEqual(view.tools.items.map((tool) => tool.available), [false, false, false]);
});

test("a phase without a deadline shows its deadline label instead of a countdown", () => {
  const view = buildHostConsoleBarViewModel({ phase: { label: "Night 1", deadlineLabel: "No deadline set" }, nowSeconds: 10 });
  assert.deepEqual(view.deadline, {
    testId: "host-console-bar-deadline", label: "Deadline", value: "No deadline set", detail: null,
  });
});

test("deadline countdown is a pure projection of deadline and injected now", () => {
  assert.equal(formatDeadlineCountdown({ deadlineSeconds: 1781841600, nowSeconds: 1781806740 }), "Closes in 9h 41m");
  assert.equal(formatDeadlineCountdown({ deadlineSeconds: 1781810340, nowSeconds: 1781806740 }), "Closes in 1h");
  assert.equal(formatDeadlineCountdown({ deadlineSeconds: 1781809200, nowSeconds: 1781806740 }), "Closes in 41m");
  assert.equal(formatDeadlineCountdown({ deadlineSeconds: 1781806780, nowSeconds: 1781806740 }), "Closes in under 1m");
  assert.equal(formatDeadlineCountdown({ deadlineSeconds: 1781806740, nowSeconds: 1781806740 }), "Deadline passed");
  assert.equal(formatDeadlineCountdown({ deadlineSeconds: 1781800000, nowSeconds: 1781806740 }), "Deadline passed");
  assert.equal(formatDeadlineCountdown({ deadlineSeconds: null, nowSeconds: 1781806740 }), null);
  assert.equal(formatDeadlineCountdown({ deadlineSeconds: 1781841600, nowSeconds: null }), null);
});
