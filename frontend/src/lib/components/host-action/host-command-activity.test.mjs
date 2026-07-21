import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOST_COMMAND_ACTIVITY_CONTRACT,
  buildHostCommandActivityViewModel,
} from "./host-command-activity.mjs";

test("host command activity model exposes idle command posture", () => {
  const view = buildHostCommandActivityViewModel();

  assert.equal(view.root.className, HOST_COMMAND_ACTIVITY_CONTRACT.rootClassName);
  assert.equal(view.root.ariaLabel, "Host command activity");
  assert.equal(view.root.data.component, "host-command-activity");
  assert.equal(view.heading, "Command activity");
  assert.equal(view.summary, "Ready for host commands");
  assert.deepEqual(view.empty, {
    className: "fm-ledger__empty",
    testId: "host-command-activity-empty",
    state: "idle",
    message: "No host commands in flight.",
  });
  assert.deepEqual(view.items, []);
});

test("host command activity prioritizes pending actions before recent outcomes", () => {
  const view = buildHostCommandActivityViewModel({
    commandStatuses: {
      extend_deadline: {
        state: "pending",
        message: "Sending command",
        confirmationTrace: {
          kind: "confirmation-command-trace",
          confirmationKind: "confirmation-action",
          surface: "moderator-host",
          actionId: "extend_deadline",
          statusKey: "extend_deadline",
          dispatchKind: "extend_deadline",
        },
      },
      lock_thread: {
        state: "ack",
        message: "Ack: stream seqs 2",
      },
    },
    commandOutcomes: [
      {
        actionId: "advance_phase",
        state: "ack",
        message: "Ack: stream seqs 12",
      },
      {
        actionId: "modkill_slot",
        state: "reject",
        message: "Reject Forbidden",
      },
    ],
  });

  assert.equal(view.summary, "3 recent host command events");
  assert.deepEqual(
    view.items.map((item) => [
      item.actionId,
      item.source,
      item.state,
      item.label,
      item.message,
      item.statusTestId,
      item.confirmationTrace,
    ]),
    [
      [
        "extend_deadline",
        "status",
        "pending",
        "Extend deadline",
        "Extend deadline is in progress.",
        "host-command-activity-status-extend_deadline",
        {
          kind: "confirmation-command-trace",
          confirmationKind: "confirmation-action",
          surface: "moderator-host",
          actionId: "extend_deadline",
          statusKey: "extend_deadline",
          dispatchKind: "extend_deadline",
        },
      ],
      [
        "modkill_slot",
        "outcome",
        "reject",
        "Modkill slot",
        "Modkill slot could not be completed.",
        "host-command-activity-status-modkill_slot",
        null,
      ],
      [
        "advance_phase",
        "outcome",
        "ack",
        "Advance phase",
        "Advance phase completed.",
        "host-command-activity-status-advance_phase",
        null,
      ],
    ],
  );
});

test("host command activity caps recent rows and labels host prompt decisions", () => {
  const view = buildHostCommandActivityViewModel({
    commandOutcomes: [
      { actionId: "extend_deadline", state: "ack", message: "first" },
      { actionId: "lock_thread", state: "ack", message: "second" },
      {
        actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
        state: "ack",
        message: "Ack: host prompt resolved",
      },
      { actionId: "modkill_slot", state: "reject", message: "fourth" },
    ],
  });

  assert.equal(view.items.length, HOST_COMMAND_ACTIVITY_CONTRACT.maxItems);
  assert.deepEqual(
    view.items.map((item) => [item.actionId, item.label]),
    [
      ["modkill_slot", "Modkill slot"],
      [
        "resolve_host_prompt-D01-skip_next_day-slot_1",
        "Resolve host prompt",
      ],
      ["lock_thread", "Lock thread"],
    ],
  );
});
