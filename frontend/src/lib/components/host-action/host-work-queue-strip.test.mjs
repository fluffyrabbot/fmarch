import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOST_WORK_QUEUE_STRIP_CONTRACT,
  buildHostWorkQueueStripViewModel,
  formatDeadlineCountdown,
} from "./host-work-queue-strip.mjs";

test("host work queue strip model exposes deadline votecount and replacement queues", () => {
  const view = buildHostWorkQueueStripViewModel({
    queues: [
      { id: "deadline", label: "Deadline", value: "Closes in 9h 41m" },
      { id: "votecount", label: "Votecount", value: "2 projected targets" },
      { id: "replacement", label: "Replacement", value: "Slot 7 / Mira" },
    ],
  });

  assert.equal(view.root.className, HOST_WORK_QUEUE_STRIP_CONTRACT.rootClassName);
  assert.equal(view.root.ariaLabel, "Host queues");
  assert.equal(view.root.data.component, "host-work-queue-strip");
  assert.deepEqual(
    view.queues.map((queue) => [
      queue.id,
      queue.label,
      queue.value,
      queue.testId,
      queue.minBlockPx,
    ]),
    [
      ["deadline", "Deadline", "Closes in 9h 41m", "host-work-queue-deadline", 112],
      ["votecount", "Votecount", "2 projected targets", "host-work-queue-votecount", 112],
      ["replacement", "Replacement", "Slot 7 / Mira", "host-work-queue-replacement", 112],
    ],
  );
});

test("deadline countdown is a pure projection of deadline and injected now", () => {
  assert.equal(
    formatDeadlineCountdown({ deadlineSeconds: 1781841600, nowSeconds: 1781806740 }),
    "Closes in 9h 41m",
  );
  assert.equal(
    formatDeadlineCountdown({ deadlineSeconds: 1781810340, nowSeconds: 1781806740 }),
    "Closes in 1h",
  );
  assert.equal(
    formatDeadlineCountdown({ deadlineSeconds: 1781809200, nowSeconds: 1781806740 }),
    "Closes in 41m",
  );
  assert.equal(
    formatDeadlineCountdown({ deadlineSeconds: 1781806780, nowSeconds: 1781806740 }),
    "Closes in under 1m",
  );
  assert.equal(
    formatDeadlineCountdown({ deadlineSeconds: 1781806740, nowSeconds: 1781806740 }),
    "Deadline passed",
  );
  assert.equal(
    formatDeadlineCountdown({ deadlineSeconds: 1781800000, nowSeconds: 1781806740 }),
    "Deadline passed",
  );
  assert.equal(
    formatDeadlineCountdown({ deadlineSeconds: null, nowSeconds: 1781806740 }),
    null,
  );
  assert.equal(
    formatDeadlineCountdown({ deadlineSeconds: 1781841600, nowSeconds: undefined }),
    null,
  );
  assert.equal(formatDeadlineCountdown(), null);
});

test("host work queue strip model normalizes missing queue fields", () => {
  const view = buildHostWorkQueueStripViewModel({
    queues: [{ label: "Needs Review!" }],
  });

  assert.deepEqual(view.queues, [
    {
      id: "queue",
      label: "Needs Review!",
      value: "No work queued",
      className: "host-console-critical-path__queue fm-section",
      testId: "host-work-queue-Needs-Review-",
      minBlockPx: 112,
    },
  ]);
});
