import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONFIRMATION_ACTION_CONTRACT,
  buildConfirmationActionViewModel,
} from "./confirmation-action-model.mjs";

test("confirmation action model builds the shared alertdialog payload", () => {
  assert.deepEqual(
    buildConfirmationActionViewModel({
      surface: "moderator-host",
      actionId: "lock_thread",
      label: "Lock thread",
      message: "Lock Day 2 thread: reject new public posts.",
      messageIdPrefix: "host-action-confirmation-message",
      confirmTestId: "critical-host-action-confirm",
      cancelTestId: "critical-host-action-cancel",
      triggerTestId: "critical-host-action-trigger",
      messageTestId: "critical-host-action-confirmation-message",
      confirmationTestId: "critical-host-action-confirmation",
      className: "host-action__confirmation",
      actionsClassName: "host-action__confirmation-actions",
      objectLabel: "Day 2 thread",
      outcomeLabel: "reject new public posts",
      tabContainment: "confirm-cancel",
    }),
    {
      kind: CONFIRMATION_ACTION_CONTRACT.kind,
      surface: "moderator-host",
      actionId: "lock_thread",
      role: CONFIRMATION_ACTION_CONTRACT.role,
      ariaModal: CONFIRMATION_ACTION_CONTRACT.ariaModal,
      ariaLabel: "Confirm Lock thread",
      label: "Lock thread",
      message: "Lock Day 2 thread: reject new public posts.",
      messageId: "host-action-confirmation-message-lock_thread",
      messageTestId: "critical-host-action-confirmation-message",
      confirmationTestId: "critical-host-action-confirmation",
      confirmTestId: "critical-host-action-confirm",
      cancelTestId: "critical-host-action-cancel",
      triggerTestId: "critical-host-action-trigger",
      initialFocusTestId: "critical-host-action-confirm",
      returnFocusTestId: "critical-host-action-trigger",
      escapeCancels: true,
      tabContainment: "confirm-cancel",
      className: "host-action__confirmation",
      actionsClassName: "host-action__confirmation-actions",
      objectLabel: "Day 2 thread",
      outcomeLabel: "reject new public posts",
    },
  );
});

test("confirmation action model rejects unnamed confirmation controls", () => {
  assert.throws(
    () =>
      buildConfirmationActionViewModel({
        surface: "admin-setup",
        actionId: "session-grants",
        label: "Session grants",
        message: "Grant GlobalMod to mod_a",
        messageIdPrefix: "admin-command-confirmation-message",
        confirmTestId: "",
        cancelTestId: "admin-command-cancel-session-grants",
        triggerTestId: "admin-command-trigger-session-grants",
      }),
    /confirmTestId/,
  );
});
