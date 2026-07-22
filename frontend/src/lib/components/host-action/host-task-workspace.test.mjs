import assert from "node:assert/strict";
import test from "node:test";
import {
  HOST_TASK_WORKSPACE_CONTRACT,
  buildHostTaskWorkspaceViewModel,
} from "./host-task-workspace.mjs";

const groups = [
  {
    id: "phase",
    label: "Phase",
    value: "Advance or lock",
    authority: "HostOf(game)",
    boundary: "Typed commands",
    boundaryDetail: "AdvancePhase",
    emptyLabel: "No action",
    actions: [{ id: "advance", label: "Advance", outcomeLabel: "open the next phase" }],
  },
  {
    id: "deadline",
    label: "Deadline",
    value: "Extend the deadline",
    authority: "CohostOf(game)",
    boundary: "Typed command",
    boundaryDetail: "ExtendDeadline",
    emptyLabel: "No action",
    actions: [{ id: "extend", label: "Extend", outcomeLabel: "move the deadline" }],
  },
  {
    id: "host-prompts",
    label: "Host prompts",
    value: "Resolve pack policy",
    authority: "HostOf(game)",
    boundary: "Typed command",
    boundaryDetail: "ResolveHostPrompt",
    emptyLabel: "No prompt",
    actions: [{ id: "resolve", label: "Resolve", outcomeLabel: "apply pack policy" }],
  },
];

test("host task workspace prioritizes decisions and selects one canvas", () => {
  const view = buildHostTaskWorkspaceViewModel({
    groups,
    phase: { deadlineLabel: "Tonight, 9:00 PM" },
    hostPrompts: [{ status: "pending" }],
    commandContext: { gameId: "midsummer", principalUserId: "host_h" },
  });

  assert.equal(view.root.data.mode, "exception-queue-decision-canvas");
  assert.equal(view.root.testId, HOST_TASK_WORKSPACE_CONTRACT.thumbZoneTestId);
  assert.deepEqual(view.tasks.map((task) => task.id), ["deadline", "host-prompts", "phase"]);
  assert.equal(view.selectedTaskId, "deadline");
  assert.equal(view.selectedTask.consequence, "move the deadline");
  assert.equal(view.queue.attentionCount, 2);
  assert.equal(view.commandContext.value, "HostOf(game) · @host_h");
});

test("interrupted commands move their task to the front for recovery", () => {
  const view = buildHostTaskWorkspaceViewModel({
    groups,
    commandStatuses: {
      advance: { state: "interrupted", message: "Connection lost" },
    },
  });

  assert.equal(view.tasks[0].id, "phase");
  assert.equal(view.tasks[0].state, "interrupted");
  assert.equal(view.tasks[0].actions[0].config.disabled, true);
  assert.equal(view.tasks[0].actions[0].status.message, "Connection lost");
});

test("explicit task selection is preserved while the task exists", () => {
  const view = buildHostTaskWorkspaceViewModel({ groups, selectedTaskId: "host-prompts" });
  assert.equal(view.selectedTaskId, "host-prompts");
  assert.equal(view.selectedTask.label, "Host prompts");
});
