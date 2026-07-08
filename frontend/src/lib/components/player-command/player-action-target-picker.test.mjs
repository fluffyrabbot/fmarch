import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLAYER_ACTION_TARGET_PICKER_CONTRACT,
  buildPlayerActionTargetPicker,
} from "./player-action-target-picker.mjs";

const LEGAL_ACTION = Object.freeze({
  action: "submit_action:factional_kill",
  commandKind: "submit_action",
  actionId: "factional_kill",
  templateId: "factional_kill",
  ability: "Kill",
  window: "Night",
  label: "Submit factional kill",
  detail: "factional_kill -> slot-3",
  targets: ["slot-3"],
  targetOptions: ["slot-2", "slot-3"],
  grantId: "grant-factional-kill",
});

const INVALID_RECOVERY = Object.freeze({
  action: "submit_invalid_action:factional_kill",
  commandKind: "submit_invalid_action",
  label: "Try invalid self-action",
  detail: "factional_kill -> own slot",
  templateId: "factional_kill",
  targets: ["slot-7"],
});

test("picker splits legal actions from recovery commands", () => {
  const picker = buildPlayerActionTargetPicker({
    actionCommands: [LEGAL_ACTION, INVALID_RECOVERY],
  });
  assert.equal(picker.root.testId, "player-action-commands");
  assert.equal(picker.actions.length, 1);
  assert.equal(picker.recoveryCommands.length, 1);
  assert.equal(
    picker.recoveryCommands[0].data.action,
    "submit_invalid_action:factional_kill",
  );
});

test("picker options mirror target options with the current target checked", () => {
  const picker = buildPlayerActionTargetPicker({
    actionCommands: [LEGAL_ACTION],
  });
  const action = picker.actions[0];
  assert.equal(action.selectedTarget, "slot-3");
  assert.equal(action.hasTargetChoice, true);
  assert.deepEqual(
    action.options.map((option) => ({
      slot: option.slot,
      label: option.label,
      checked: option.checked,
      testId: option.testId,
    })),
    [
      {
        slot: "slot-2",
        label: "Slot 2",
        checked: false,
        testId: "player-action-target-factional_kill-slot-2",
      },
      {
        slot: "slot-3",
        label: "Slot 3",
        checked: true,
        testId: "player-action-target-factional_kill-slot-3",
      },
    ],
  );
  assert.match(
    action.options[0].className,
    /fm-choice/u,
  );
  assert.equal(
    action.options[0].minTouchTargetPx,
    PLAYER_ACTION_TARGET_PICKER_CONTRACT.minTouchTargetPx,
  );
});

test("picker trigger keeps the lane-visible submit_action data contract", () => {
  const picker = buildPlayerActionTargetPicker({
    actionCommands: [LEGAL_ACTION],
  });
  const trigger = picker.actions[0].trigger;
  assert.equal(trigger.testId, "player-action-trigger-factional_kill");
  assert.equal(trigger.data.action, "submit_action:factional_kill");
  assert.deepEqual(trigger.data.targetSlots, ["slot-3"]);
  assert.equal(trigger.disabled, false);
  assert.equal(trigger.ariaExpanded, "false");
});

test("picker confirmation carries the alertdialog contract for the confirming action", () => {
  const picker = buildPlayerActionTargetPicker({
    actionCommands: [LEGAL_ACTION],
    confirmingAction: "submit_action:factional_kill",
  });
  const action = picker.actions[0];
  assert.equal(action.confirming, true);
  assert.equal(action.trigger.ariaExpanded, "true");
  assert.equal(action.confirmation.role, "alertdialog");
  assert.equal(
    action.confirmation.confirmTestId,
    "player-action-confirm-factional_kill",
  );
  assert.equal(
    action.confirmation.cancelTestId,
    "player-action-cancel-factional_kill",
  );
  assert.equal(
    action.confirmation.confirmationTestId,
    "player-action-confirmation-factional_kill",
  );
  assert.match(action.confirmation.message, /factional_kill -> slot-3/u);
  assert.equal(action.confirmation.initialFocusTestId, action.confirmation.confirmTestId);
  assert.equal(action.confirmation.returnFocusTestId, action.trigger.testId);
});

test("picker disables triggers for dead or completed actors", () => {
  const picker = buildPlayerActionTargetPicker({
    actionCommands: [LEGAL_ACTION],
    disabled: true,
  });
  assert.equal(picker.actions[0].trigger.disabled, true);
});
