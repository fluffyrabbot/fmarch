import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_OPERATOR_INBOX_CONTRACT,
  buildAdminOperatorInbox,
} from "./admin-operator-inbox.mjs";

const setup = [{ id: "create-game", label: "Create game", value: "New game" }];
const recovery = [{ id: "recovery-gate", label: "Recovery gate", value: "Check proof" }];

test("admin inbox leads with exceptions and exposes one selected canvas", () => {
  const view = buildAdminOperatorInbox({
    gameSetup: setup,
    recoveryTasks: recovery,
    audit: [
      { id: "proof-runs", label: "Proof runs", status: "Operator status unavailable" },
      { id: "release", label: "Release", status: "Current" },
    ],
  });
  assert.equal(view.root.data.mode, "exception-inbox-decision-canvas");
  assert.equal(view.root.data.initialCanvasCount, "1");
  assert.equal(view.tasks[0].id, "audit:proof-runs");
  assert.equal(view.selectedTaskId, "audit:proof-runs");
  assert.equal(view.queue.attentionCount, 1);
});

test("admin inbox defaults to routine setup and preserves explicit selection when healthy", () => {
  const view = buildAdminOperatorInbox({
    gameSetup: setup,
    recoveryTasks: recovery,
    audit: [{ id: "proof-runs", label: "Proof runs", status: "Current" }],
    selectedTaskId: "recovery:recovery-gate",
  });
  assert.equal(view.selectedTaskId, "recovery:recovery-gate");
  assert.deepEqual(view.tasks.map((task) => task.kind), ["setup", "recovery", "audit"]);
  assert.equal(ADMIN_OPERATOR_INBOX_CONTRACT.stackBelowPx, 820);
});

test("interrupted commands move their operator task to the front", () => {
  const view = buildAdminOperatorInbox({
    gameSetup: setup,
    recoveryTasks: recovery,
    commandStatuses: { "recovery-gate": { state: "interrupted" } },
  });
  assert.equal(view.tasks[0].id, "recovery:recovery-gate");
  assert.equal(view.tasks[0].badge, "Needs recovery");
});
