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
    actions: [{
      id: "resolve",
      label: "Resolve",
      outcomeLabel: "apply pack policy",
      payload: {
        kind: "resolve_host_prompt",
        promptId: "prompt-1",
      },
    }],
  },
];

const hostTasks = [
  {
    id: "engine-host-prompt:prompt-1",
    kind: "engine_host_prompt",
    state: "ready",
    urgency: "attention",
    intent: "Resolve pack policy",
    consequence: "apply pack policy",
    phaseId: "D01",
    subjectSlot: "slot-1",
    sourceId: "prompt-1",
    allowedCommands: [
      {
        kind: "resolve_host_prompt",
        permissionClass: "host_prompt_resolve",
      },
    ],
    blockedReason: null,
  },
];

test("host task workspace prioritizes decisions and selects one canvas", () => {
  const view = buildHostTaskWorkspaceViewModel({
    groups,
    phase: { deadlineLabel: "Tonight, 9:00 PM" },
    hostPrompts: [{ id: "prompt-1", label: "Skip next day", status: "pending" }],
    hostTasks,
    commandContext: { gameId: "midsummer", principalUserId: "host_h" },
  });

  assert.equal(view.root.data.mode, "exception-queue-decision-canvas");
  assert.equal(view.root.testId, HOST_TASK_WORKSPACE_CONTRACT.thumbZoneTestId);
  assert.deepEqual(view.tasks.map((task) => task.id), [
    "deadline",
    "engine-host-prompt:prompt-1",
    "phase",
  ]);
  assert.equal(view.tasks[1].kind, "engine_host_prompt");
  assert.equal(view.tasks[1].sourceId, "prompt-1");
  assert.equal(view.tasks[1].actions.length, 1);
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
  const view = buildHostTaskWorkspaceViewModel({
    groups,
    hostPrompts: [{ id: "prompt-1", label: "Skip next day", status: "pending" }],
    hostTasks,
    selectedTaskId: "engine-host-prompt:prompt-1",
  });
  assert.equal(view.selectedTaskId, "engine-host-prompt:prompt-1");
  assert.equal(view.selectedTask.label, "Skip next day");
});

test("blocked task instances remain visible without leaking denied commands", () => {
  const view = buildHostTaskWorkspaceViewModel({
    groups,
    hostPrompts: [{ id: "prompt-1", label: "Skip next day", status: "pending" }],
    hostTasks: [{
      ...hostTasks[0],
      state: "blocked",
      allowedCommands: [],
      blockedReason: "cohost policy denies host_prompt_resolve",
    }],
  });

  assert.equal(view.tasks[0].id, "engine-host-prompt:prompt-1");
  assert.equal(view.tasks[0].state, "blocked");
  assert.equal(view.tasks[0].actions.length, 0);
  assert.equal(
    view.tasks[0].consequence,
    "cohost policy denies host_prompt_resolve",
  );
});
