import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOST_LIFECYCLE_CONTROL_CHECKPOINT_CONTRACT,
  buildHostLifecycleControlCheckpoint,
} from "./host-lifecycle-control-checkpoint.mjs";

test("host lifecycle checkpoint points at the live host control row", () => {
  const checkpoint = buildHostLifecycleControlCheckpoint({
    phase: { id: "D02", label: "Day 2", state: "open", locked: false },
    replacement: { slotId: "slot-7", lifecycleLabel: "Alive" },
    commandContext: { capabilityLabel: "HostOf(midsummer)" },
    actionGroups: [
      {
        id: "phase",
        actions: [{ id: "resolve_phase" }, { id: "lock_thread" }],
      },
      {
        id: "slot-lifecycle",
        actions: [{ id: "mark_dead" }, { id: "modkill_slot" }],
      },
    ],
  });

  assert.equal(
    checkpoint.root.testId,
    HOST_LIFECYCLE_CONTROL_CHECKPOINT_CONTRACT.rootTestId,
  );
  assert.equal(checkpoint.root.data.proofCheckId, "host-lifecycle-control");
  assert.equal(checkpoint.root.data.phaseId, "D02");
  assert.equal(checkpoint.root.data.phaseState, "open");
  assert.equal(checkpoint.root.data.slotId, "slot-7");
  assert.equal(checkpoint.root.data.actionState, "enabled:mark_dead,modkill_slot");
  assert.equal(checkpoint.root.data.deadlineAffordance, "resolve_phase,lock_thread");
  assert.equal(checkpoint.actionState.value, "enabled:mark_dead,modkill_slot");
  assert.equal(checkpoint.deadlineAffordance.value, "resolve_phase,lock_thread");
  assert.equal(
    checkpoint.recovery.value,
    "Reject PhaseLocked: refresh host projection and use current lifecycle controls.",
  );
  assert.deepEqual(checkpoint.status, {
    testId: "host-lifecycle-control-status",
    state: "ack",
    message: "Host lifecycle controls are reachable from this role URL",
  });
});

test("host lifecycle checkpoint fails closed when controls are unavailable", () => {
  const checkpoint = buildHostLifecycleControlCheckpoint({
    phase: { id: "D02", state: "locked", locked: true },
    replacement: { slotId: "slot-7", lifecycleLabel: "Dead" },
    commandContext: { capabilityLabel: "HostOf(midsummer)" },
    actionGroups: [
      {
        id: "phase",
        actions: [{ id: "unlock_thread" }, { id: "advance_phase" }],
      },
      {
        id: "slot-lifecycle",
        actions: [],
      },
    ],
  });

  assert.equal(checkpoint.root.data.phaseState, "locked");
  assert.equal(checkpoint.root.data.actionState, "disabled:slot lifecycle is terminal");
  assert.equal(checkpoint.root.data.deadlineAffordance, "unlock_thread,advance_phase");
  assert.equal(checkpoint.status.state, "pending");
  assert.match(checkpoint.status.message, /slot lifecycle is terminal/);
});
