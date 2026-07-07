import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOST_WORK_QUEUE_STRIP_CONTRACT,
  buildHostWorkQueueStripViewModel,
} from "./host-work-queue-strip.mjs";

test("host work queue strip model exposes deadline votecount and replacement queues", () => {
  const view = buildHostWorkQueueStripViewModel({
    queues: [
      { id: "deadline", label: "Deadline", value: "Active extension pending" },
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
      ["deadline", "Deadline", "Active extension pending", "host-work-queue-deadline", 112],
      ["votecount", "Votecount", "2 projected targets", "host-work-queue-votecount", 112],
      ["replacement", "Replacement", "Slot 7 / Mira", "host-work-queue-replacement", 112],
    ],
  );
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
