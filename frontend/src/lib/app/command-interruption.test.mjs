import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CommandInterruptedError,
  commandAttemptId,
  commandAttemptTimeoutMs,
  commandInterruptionStatus,
  executeCommandAttempt,
  isCommandInterruptionStatus,
} from "./command-interruption.mjs";

test("command attempts time out deterministically and abort stale transport work", async () => {
  let timeoutCallback;
  let clearedTimeout;
  let observedSignal;
  const attempt = executeCommandAttempt({
    timeoutMs: 25,
    operation: ({ signal }) => {
      observedSignal = signal;
      return new Promise(() => {});
    },
    setTimeoutImpl(callback) {
      timeoutCallback = callback;
      return 17;
    },
    clearTimeoutImpl(id) {
      clearedTimeout = id;
    },
  });

  await Promise.resolve();
  timeoutCallback();
  await assert.rejects(attempt, (error) => {
    assert.equal(error instanceof CommandInterruptedError, true);
    assert.equal(error.kind, "timeout");
    return true;
  });
  assert.equal(observedSignal.aborted, true);
  assert.equal(clearedTimeout, 17);
});

test("command attempts classify fetch loss without hiding programming errors", async () => {
  await assert.rejects(
    executeCommandAttempt({
      operation: async () => {
        throw new TypeError("Failed to fetch");
      },
    }),
    (error) => error instanceof CommandInterruptedError && error.kind === "connection_lost",
  );
  await assert.rejects(
    executeCommandAttempt({
      operation: async () => {
        throw new Error("invalid command config");
      },
    }),
    /invalid command config/,
  );
});

test("interruption status preserves the command identity for idempotent retry", () => {
  const status = commandInterruptionStatus(
    new CommandInterruptedError("connection_lost"),
    { actionId: "submit_post", commandId: "stable-command-id" },
  );

  assert.equal(isCommandInterruptionStatus(status), true);
  assert.equal(status.commandId, "stable-command-id");
  assert.equal(status.retryable, true);
  assert.equal(commandAttemptId(() => "stable-command-id"), "stable-command-id");
  assert.equal(commandAttemptTimeoutMs({ __fmarchCommandTimeoutMs: 40 }), 40);
  assert.equal(commandInterruptionStatus(new Error("boom")), null);
});
