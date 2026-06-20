import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMMAND_TRACE_CONTRACT,
  attachCommandTrace,
  buildCommandTrace,
} from "./command-trace-model.mjs";

test("command trace binds an action to status and refresh metadata", () => {
  const trace = buildCommandTrace({
    surface: "player",
    actionId: "submit_vote",
    statusKey: "submit_vote",
    dispatchKind: "submit_vote",
    projectionRefreshKeys: ["votecount"],
  });

  assert.deepEqual(trace, {
    kind: COMMAND_TRACE_CONTRACT.kind,
    surface: "player",
    actionId: "submit_vote",
    statusKey: "submit_vote",
    dispatchKind: "submit_vote",
    projectionRefreshKeys: ["votecount"],
  });
  assert.deepEqual(
    attachCommandTrace(
      {
        state: "pending",
        message: "Sending command",
      },
      trace,
    ),
    {
      state: "pending",
      message: "Sending command",
      commandTrace: trace,
    },
  );
});

test("command trace rejects unsupported trace payloads", () => {
  assert.throws(
    () =>
      attachCommandTrace(
        {
          state: "ack",
          message: "Ack",
        },
        { kind: "confirmation-command-trace" },
      ),
    /unsupported kind/,
  );
});
