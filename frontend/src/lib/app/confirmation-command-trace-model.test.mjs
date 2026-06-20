import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildConfirmationActionViewModel,
} from "./confirmation-action-model.mjs";
import {
  CONFIRMATION_COMMAND_TRACE_CONTRACT,
  attachConfirmationCommandTrace,
  buildConfirmationCommandTrace,
} from "./confirmation-command-trace-model.mjs";

test("confirmation command trace binds confirmation action to status key", () => {
  const confirmation = buildConfirmationActionViewModel({
    surface: "admin-setup",
    actionId: "session-grants",
    label: "Session grants",
    message: "Grant GlobalMod to mod_a",
    messageIdPrefix: "admin-command-confirmation-message",
    confirmTestId: "admin-command-confirm-session-grants",
    cancelTestId: "admin-command-cancel-session-grants",
    triggerTestId: "admin-command-trigger-session-grants",
  });
  const trace = buildConfirmationCommandTrace({
    surface: "admin-setup",
    actionId: "session-grants",
    statusKey: "session-grants",
    confirmation,
    dispatchKind: "grant_session",
  });

  assert.deepEqual(trace, {
    kind: CONFIRMATION_COMMAND_TRACE_CONTRACT.kind,
    confirmationKind: CONFIRMATION_COMMAND_TRACE_CONTRACT.confirmationKind,
    surface: "admin-setup",
    actionId: "session-grants",
    statusKey: "session-grants",
    dispatchKind: "grant_session",
  });
  assert.deepEqual(
    attachConfirmationCommandTrace(
      {
        state: "confirm",
        message: "Grant GlobalMod to mod_a",
      },
      trace,
    ),
    {
      state: "confirm",
      message: "Grant GlobalMod to mod_a",
      confirmationTrace: trace,
    },
  );
});

test("confirmation command trace rejects mismatched confirmation payloads", () => {
  const confirmation = buildConfirmationActionViewModel({
    surface: "moderator-host",
    actionId: "lock_thread",
    label: "Lock thread",
    message: "Lock Day 2 thread",
    messageIdPrefix: "host-action-confirmation-message",
    confirmTestId: "critical-host-action-confirm",
    cancelTestId: "critical-host-action-cancel",
    triggerTestId: "critical-host-action-trigger",
  });

  assert.throws(
    () =>
      buildConfirmationCommandTrace({
        surface: "admin-setup",
        actionId: "lock_thread",
        statusKey: "lock_thread",
        confirmation,
      }),
    /surface/,
  );
});
