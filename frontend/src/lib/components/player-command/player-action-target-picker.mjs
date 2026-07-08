import { buildConfirmationActionViewModel } from "../../app/confirmation-action-model.mjs";

export const PLAYER_ACTION_TARGET_PICKER_CONTRACT = Object.freeze({
  componentName: "player-action-target-picker",
  rootClassName: "player-action-target-picker",
  actionClassName: "player-action-target-picker__action",
  optionsClassName: "player-action-target-picker__options",
  optionClassName: "player-action-target-picker__option fm-choice",
  confirmationClassName: "player-action-target-picker__confirmation fm-well",
  confirmationActionsClassName:
    "player-action-target-picker__confirmation-actions fm-touch-row",
  surface: "player",
  minTouchTargetPx: 44,
  optionTestIdPrefix: "player-action-target",
  triggerTestIdPrefix: "player-action-trigger",
  confirmTestIdPrefix: "player-action-confirm",
  cancelTestIdPrefix: "player-action-cancel",
  confirmationTestIdPrefix: "player-action-confirmation",
  messageIdPrefix: "player-action-confirmation-message",
});

// The picker owns the legal submit_action commands; recovery commands
// (submit_invalid_action proof controls) stay direct-dispatch buttons so the
// stale/invalid recovery lanes keep their one-click contract.
export function buildPlayerActionTargetPicker({
  actionCommands = [],
  confirmingAction = null,
  disabled = false,
} = {}) {
  const commands = Array.isArray(actionCommands) ? actionCommands : [];
  const submittable = commands.filter(isSubmitActionCommand);
  const recovery = commands.filter(
    (command) => !isSubmitActionCommand(command),
  );
  return Object.freeze({
    root: Object.freeze({
      className: PLAYER_ACTION_TARGET_PICKER_CONTRACT.rootClassName,
      testId: "player-action-commands",
      data: Object.freeze({
        component: PLAYER_ACTION_TARGET_PICKER_CONTRACT.componentName,
      }),
    }),
    actions: Object.freeze(
      submittable.map((command) =>
        pickerAction({ command, confirmingAction, disabled }),
      ),
    ),
    recoveryCommands: Object.freeze(recovery.map(recoveryCommandButton)),
  });
}

function isSubmitActionCommand(command) {
  const kind = String(command?.commandKind ?? "");
  if (kind !== "") {
    return kind === "submit_action";
  }
  return String(command?.action ?? "").startsWith("submit_action");
}

function pickerAction({ command, confirmingAction, disabled }) {
  const templateId = String(command.templateId ?? "");
  const action = String(command.action ?? `submit_action:${templateId}`);
  const targets = Object.freeze(
    Array.isArray(command.targets)
      ? command.targets.map((target) => String(target))
      : [],
  );
  const selectedTarget = targets[0] ?? null;
  const label = String(command.label ?? `Submit ${templateId}`);
  const detail = String(command.detail ?? "");
  const options = Object.freeze(
    (Array.isArray(command.targetOptions) ? command.targetOptions : []).map(
      (option) => {
        const slot = String(option);
        return Object.freeze({
          slot,
          label: slotLabel(slot),
          checked: slot === selectedTarget,
          name: `${PLAYER_ACTION_TARGET_PICKER_CONTRACT.optionTestIdPrefix}-${templateId}`,
          testId: `${PLAYER_ACTION_TARGET_PICKER_CONTRACT.optionTestIdPrefix}-${templateId}-${slot}`,
          className: PLAYER_ACTION_TARGET_PICKER_CONTRACT.optionClassName,
          minTouchTargetPx: PLAYER_ACTION_TARGET_PICKER_CONTRACT.minTouchTargetPx,
        });
      },
    ),
  );
  return Object.freeze({
    action,
    commandKind: String(command.commandKind ?? "submit_action"),
    templateId,
    label,
    detail,
    targets,
    selectedTarget,
    hasTargetChoice: options.length > 1,
    options,
    className: PLAYER_ACTION_TARGET_PICKER_CONTRACT.actionClassName,
    optionsClassName: PLAYER_ACTION_TARGET_PICKER_CONTRACT.optionsClassName,
    trigger: Object.freeze({
      testId: `${PLAYER_ACTION_TARGET_PICKER_CONTRACT.triggerTestIdPrefix}-${templateId}`,
      className: "fm-touch-button fm-touch-button--secondary",
      disabled: disabled === true,
      ariaExpanded: String(confirmingAction === action),
      data: Object.freeze({
        action,
        templateId,
        targetSlots: targets,
        minTouchTargetPx: PLAYER_ACTION_TARGET_PICKER_CONTRACT.minTouchTargetPx,
      }),
    }),
    confirming: confirmingAction === action,
    confirmation: Object.freeze({
      ...buildConfirmationActionViewModel({
        surface: PLAYER_ACTION_TARGET_PICKER_CONTRACT.surface,
        actionId: templateId,
        label,
        message: `${label}: ${detail === "" ? `${templateId} -> ${targets.join(", ")}` : detail}. This submits your action for the current phase.`,
        messageIdPrefix: PLAYER_ACTION_TARGET_PICKER_CONTRACT.messageIdPrefix,
        confirmTestId: `${PLAYER_ACTION_TARGET_PICKER_CONTRACT.confirmTestIdPrefix}-${templateId}`,
        cancelTestId: `${PLAYER_ACTION_TARGET_PICKER_CONTRACT.cancelTestIdPrefix}-${templateId}`,
        triggerTestId: `${PLAYER_ACTION_TARGET_PICKER_CONTRACT.triggerTestIdPrefix}-${templateId}`,
        confirmationTestId: `${PLAYER_ACTION_TARGET_PICKER_CONTRACT.confirmationTestIdPrefix}-${templateId}`,
        className: PLAYER_ACTION_TARGET_PICKER_CONTRACT.confirmationClassName,
        actionsClassName:
          PLAYER_ACTION_TARGET_PICKER_CONTRACT.confirmationActionsClassName,
        objectLabel: targets.join(", "),
        outcomeLabel: label,
      }),
      confirmClassName: "fm-touch-button",
      cancelClassName: "fm-touch-button fm-touch-button--secondary",
    }),
  });
}

function recoveryCommandButton(command) {
  const action = String(command?.action ?? "submit_invalid_action");
  return Object.freeze({
    action,
    commandKind: String(command?.commandKind ?? action),
    label: String(command?.label ?? action),
    detail: String(command?.detail ?? ""),
    disabled: false,
    className: "fm-touch-button fm-touch-button--secondary",
    data: Object.freeze({
      action,
      templateId: String(command?.templateId ?? ""),
      targetSlots: Object.freeze(
        Array.isArray(command?.targets)
          ? command.targets.map((target) => String(target))
          : [],
      ),
      minTouchTargetPx: PLAYER_ACTION_TARGET_PICKER_CONTRACT.minTouchTargetPx,
    }),
  });
}

function slotLabel(slot) {
  const match = /^slot[-_](.+)$/u.exec(slot);
  if (match === null) {
    return slot;
  }
  return `Slot ${match[1]}`;
}
