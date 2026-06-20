import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAppStatusViewModel } from "./app-status-model.mjs";

test("app status hides absent state", () => {
  assert.deepEqual(buildAppStatusViewModel(), { visible: false });
});

test("app status exposes stable live-region metadata", () => {
  const view = buildAppStatusViewModel({
    status: { state: "pending", message: "Sending command" },
    testId: "command-status",
    className: "route-command-status",
  });

  assert.equal(view.visible, true);
  assert.equal(view.className, "fm-status route-command-status");
  assert.equal(view.state, "pending");
  assert.equal(view.message, "Sending command");
  assert.equal(view.testId, "command-status");
  assert.equal(view.role, "status");
  assert.equal(view.ariaLive, "polite");
  assert.equal(view.ariaAtomic, "true");
});

test("reject status announces assertively without changing role semantics", () => {
  const view = buildAppStatusViewModel({
    status: { state: "reject", message: "Reject Forbidden" },
  });

  assert.equal(view.role, "status");
  assert.equal(view.ariaLive, "assertive");
  assert.equal(view.message, "Reject Forbidden");
});
