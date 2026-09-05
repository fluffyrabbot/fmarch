import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CommandInterruptedError,
  CommandOutcomeUnknownError,
  CommandProjectionRecoveryTimeoutError,
  commandAttemptId,
  commandAttemptTimeoutMs,
  commandProjectionRecoveryTimeoutMs,
  commandInterruptionStatus,
  executeCommandAttempt,
  executeCommandProjectionRecovery,
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

test("unknown command outcome carries its request identity through interruption handling", async () => {
  const error = new CommandOutcomeUnknownError("response_parse_failure", {
    commandId: "stable-command-id",
    requestEnvelope: { v: 3, id: 9 },
    cause: new SyntaxError("truncated"),
  });
  await assert.rejects(
    executeCommandAttempt({
      operation: async () => {
        throw error;
      },
    }),
    (propagated) => propagated === error,
  );

  const status = commandInterruptionStatus(error, {
    actionId: "submit_post",
    commandId: "different-caller-id",
  });
  assert.equal(status.state, "interrupted");
  assert.equal(status.commandId, "stable-command-id");
  assert.equal(status.interruption, "connection_lost");
  assert.equal(status.outcome, "unknown");
  assert.equal(status.reason, "response_parse_failure");
});

test("confirmed command dispatch clears unknown-outcome timing before bounded projection recovery", async () => {
  const cleared = [];
  const ack = await executeCommandAttempt({
    timeoutMs: 12_000,
    operation: async () => ({ state: "ack", commandId: "confirmed-command" }),
    setTimeoutImpl() {
      return "dispatch-timeout";
    },
    clearTimeoutImpl(id) {
      cleared.push(id);
    },
  });

  assert.equal(ack.state, "ack");
  assert.deepEqual(cleared, ["dispatch-timeout"]);

  let recoveryTimeout;
  let recoverySignal;
  const recovery = executeCommandProjectionRecovery({
    timeoutMs: 12_000,
    operation: ({ signal }) => {
      recoverySignal = signal;
      return new Promise(() => {});
    },
    setTimeoutImpl(callback, timeoutMs) {
      assert.equal(timeoutMs, 12_000);
      recoveryTimeout = callback;
      return "projection-timeout";
    },
    clearTimeoutImpl(id) {
      cleared.push(id);
    },
  });
  await Promise.resolve();
  recoveryTimeout();

  await assert.rejects(recovery, CommandProjectionRecoveryTimeoutError);
  assert.equal(recoverySignal.aborted, true);
  assert.deepEqual(cleared, ["dispatch-timeout", "projection-timeout"]);
  assert.equal(commandProjectionRecoveryTimeoutMs(null), 12_000);
  assert.equal(
    commandProjectionRecoveryTimeoutMs({
      __fmarchCommandProjectionRecoveryTimeoutMs: 80,
    }),
    80,
  );
});
