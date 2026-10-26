import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOST_WORK_QUEUE_STRIP_CONTRACT,
  buildHostWorkQueueStripViewModel,
} from "./host-work-queue-strip.mjs";

const decisions = [
  {
    id: "engine-host-prompt:D01:skip_next_day:slot_1",
    kind: "engine_host_prompt",
    sourceId: "D01:skip_next_day:slot_1",
    label: "Skip the next day?",
    meta: "Day 1 · Ilya · S1",
    urgency: "attention",
    urgencyLabel: "Needs decision",
    state: "ready",
    testId: "host-task-engine-host-prompt-D01-skip_next_day-slot_1",
  },
  {
    id: "replacement",
    kind: "replacement",
    label: "Replacement",
    meta: "Mira",
    urgency: "attention",
    urgencyLabel: "Player waiting",
    state: "ready",
    testId: "host-task-replacement",
  },
];

test("the queue lists each decision with its posture and marks the selected one", () => {
  const view = buildHostWorkQueueStripViewModel({
    decisions,
    selectedTaskId: "replacement",
    summary: "2 decisions need attention.",
  });

  assert.equal(view.root.className, HOST_WORK_QUEUE_STRIP_CONTRACT.rootClassName);
  assert.equal(view.root.ariaLabel, "Host task queue");
  assert.equal(view.root.testId, "host-task-queue");
  assert.deepEqual(view.root.data, { component: "host-task-queue", thumbZone: "moderator-primary-actions", layout: "strip" });
  assert.deepEqual(view.summary, {
    testId: "host-task-queue-summary",
    label: "Host queue",
    attentionCount: 2,
    attentionLabel: "2 decisions need attention",
    text: "2 decisions need attention.",
  });
  assert.deepEqual(
    view.tasks.map((task) => [task.id, task.testId, task.selected, task.minBlockPx, task.urgencyLabel]),
    [
      ["engine-host-prompt:D01:skip_next_day:slot_1", "host-task-engine-host-prompt-D01-skip_next_day-slot_1", false, 44, "Needs decision"],
      ["replacement", "host-task-replacement", true, 44, "Player waiting"],
    ],
  );
});

test("an idle queue says so and carries the rail layout when asked", () => {
  const view = buildHostWorkQueueStripViewModel({ layout: "rail" });
  assert.equal(view.root.data.layout, "rail");
  assert.equal(view.summary.attentionCount, 0);
  assert.equal(view.summary.attentionLabel, "0 decisions need attention");
  assert.equal(view.summary.text, "Nothing needs you right now");
  assert.deepEqual(view.tasks, []);
});
