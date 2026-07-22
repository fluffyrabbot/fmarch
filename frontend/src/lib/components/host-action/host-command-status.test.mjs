import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hostCommandStatusMessage,
  visibleHostCommandStatus,
} from "./host-command-status.mjs";

test("host command status presentation stays action-oriented", () => {
  assert.equal(hostCommandStatusMessage(null), "");
  assert.equal(
    hostCommandStatusMessage({ state: "pending" }, "Extend deadline"),
    "Extend deadline is in progress.",
  );
  assert.equal(
    hostCommandStatusMessage({ state: "ack" }, "Extend deadline"),
    "Extend deadline completed.",
  );
  assert.equal(
    hostCommandStatusMessage({ state: "reject", retryable: true }, "Extend deadline"),
    "Extend deadline could not be completed. Refresh and try again.",
  );
});

test("visible host status preserves transport state while replacing protocol copy", () => {
  assert.equal(visibleHostCommandStatus(undefined), null);
  assert.deepEqual(
    visibleHostCommandStatus(
      { state: "interrupted", message: "Connection lost", commandId: "cmd-1" },
      "Advance phase",
    ),
    { state: "interrupted", message: "Connection lost", commandId: "cmd-1" },
  );
});
