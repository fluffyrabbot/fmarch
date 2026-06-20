import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APP_STATUS_STRIP_CONTRACT,
  statusStripItemClassName,
  statusStripRootClassName,
  statusStripStatusClassName,
} from "./app-status-strip-model.mjs";

test("status strip contract composes shared and role-specific classes", () => {
  assert.equal(APP_STATUS_STRIP_CONTRACT.componentName, "app-status-strip");
  assert.equal(
    statusStripRootClassName("player-posture-strip"),
    "fm-status-strip player-posture-strip",
  );
  assert.equal(
    statusStripItemClassName("host-console-critical-path__operation"),
    "fm-status-strip__item host-console-critical-path__operation",
  );
  assert.equal(
    statusStripStatusClassName("player-posture-strip__status"),
    "fm-status-strip__status player-posture-strip__status",
  );
  assert.equal(statusStripRootClassName(), "fm-status-strip");
});
