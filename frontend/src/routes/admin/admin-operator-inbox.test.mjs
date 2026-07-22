import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_OPERATOR_INBOX_CONTRACT,
  adjacentAdminInboxTaskId,
  adminInboxTaskHref,
  adminInboxTaskId,
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

test("task selection round-trips through the admin URL without dropping workspace state", () => {
  const href = adminInboxTaskHref({
    url: "https://fmarch.test/admin?game=midsummer#operator",
    taskId: "recovery:recovery-gate",
  });
  assert.equal(
    href,
    "/admin?game=midsummer&task=recovery%3Arecovery-gate#operator",
  );
  assert.equal(adminInboxTaskId(href), "recovery:recovery-gate");
  assert.equal(ADMIN_OPERATOR_INBOX_CONTRACT.selectionMode, "url-addressable-roving-tablist");
});

test("roving task navigation wraps and supports both axis key families", () => {
  const tasks = ["audit:proof", "setup:game", "recovery:gate"].map((id) => ({ id }));
  assert.equal(adjacentAdminInboxTaskId({ tasks, selectedTaskId: tasks[0].id, key: "ArrowUp" }), tasks[2].id);
  assert.equal(adjacentAdminInboxTaskId({ tasks, selectedTaskId: tasks[2].id, key: "ArrowRight" }), tasks[0].id);
  assert.equal(adjacentAdminInboxTaskId({ tasks, selectedTaskId: tasks[1].id, key: "Home" }), tasks[0].id);
  assert.equal(adjacentAdminInboxTaskId({ tasks, selectedTaskId: tasks[1].id, key: "End" }), tasks[2].id);
  assert.equal(adjacentAdminInboxTaskId({ tasks, selectedTaskId: tasks[1].id, key: "Enter" }), null);
});
