import {
  CONFIRMATION_ACTION_CONTRACT,
  buildConfirmationActionViewModel,
} from "../../app/confirmation-action-model.mjs";
import {
  buildConfirmationCommandTrace,
} from "../../app/confirmation-command-trace-model.mjs";

export const TOUCH_CONTROL_CONTRACT = Object.freeze({
  className: "touch-control",
  minTargetVar: "--fm-touch-target-min",
  minTargetValue: "44px",
  minGapVar: "--fm-touch-gap-min",
  minGapValue: "8px",
});

export const HOST_ACTION_CONTRACT = Object.freeze({
  rootClassName: "host-action",
  triggerClassName: "host-action__trigger",
  confirmationClassName: "host-action__confirmation",
  confirmationActionsClassName: "host-action__confirmation-actions",
  componentName: "host-action",
  triggerRole: "button",
  confirmationRole: CONFIRMATION_ACTION_CONTRACT.role,
  confirmationAriaModal: CONFIRMATION_ACTION_CONTRACT.ariaModal,
  triggerTestId: "critical-host-action-trigger",
  confirmationTestId: "critical-host-action-confirmation",
  confirmationMessageTestId: "critical-host-action-confirmation-message",
  confirmTestId: "critical-host-action-confirm",
  cancelTestId: "critical-host-action-cancel",
  initialFocusTestId: "critical-host-action-confirm",
  returnFocusTestId: "critical-host-action-trigger",
  escapeCancels: CONFIRMATION_ACTION_CONTRACT.escapeCancels,
  tabContainment: "confirm-cancel",
});

export function createHostActionController(config, dispatch) {
  const normalized = normalizeHostActionConfig(config);
  if (typeof dispatch !== "function") {
    throw new TypeError("host action dispatch must be a function");
  }

  let confirmation = null;

  function dispatchAction() {
    dispatch({
      type: "host-action/dispatch",
      actionId: normalized.id,
      label: normalized.label,
      objectLabel: normalized.objectLabel,
      outcomeLabel: normalized.outcomeLabel,
      payload: normalized.payload,
      confirmationTrace: normalized.requiresConfirmation
        ? hostConfirmationCommandTrace(normalized)
        : null,
    });
  }

  function stateSnapshot() {
    return Object.freeze({
      confirmationOpen: confirmation !== null,
      confirmation,
    });
  }

  return {
    get state() {
      return stateSnapshot();
    },

    viewModel() {
      return buildHostActionViewModel(normalized, confirmation);
    },

    activate() {
      if (normalized.disabled) {
        return stateSnapshot();
      }

      if (!normalized.requiresConfirmation) {
        dispatchAction();
        return stateSnapshot();
      }

      confirmation = buildConfirmation(normalized);
      return stateSnapshot();
    },

    confirm() {
      if (confirmation === null) {
        return stateSnapshot();
      }

      confirmation = null;
      dispatchAction();
      return stateSnapshot();
    },

    cancel() {
      confirmation = null;
      return stateSnapshot();
    },
  };
}

export function shouldPreserveHostActionConfirmation(
  previousConfig,
  nextConfig,
  confirmationOpen,
) {
  if (confirmationOpen !== true) {
    return false;
  }
  const previous = normalizeHostActionConfig(previousConfig);
  const next = normalizeHostActionConfig(nextConfig);
  return (
    previous.id === next.id &&
    previous.requiresConfirmation &&
    next.requiresConfirmation &&
    next.disabled === false
  );
}

export function hostConfirmationCommandTrace(action) {
  const normalized = normalizeHostActionConfig(action);
  return buildConfirmationCommandTrace({
    surface: "moderator-host",
    actionId: normalized.id,
    statusKey: normalized.id,
    dispatchKind: normalized.payload?.kind ?? normalized.id,
  });
}

export function buildHostActionViewModel(config, confirmation = null) {
  const normalized = normalizeHostActionConfig(config);
  return {
    root: {
      className: HOST_ACTION_CONTRACT.rootClassName,
      role: "group",
      data: {
        component: HOST_ACTION_CONTRACT.componentName,
        actionId: normalized.id,
      },
    },
    trigger: {
      className: [
        TOUCH_CONTROL_CONTRACT.className,
        HOST_ACTION_CONTRACT.triggerClassName,
      ].join(" "),
      role: HOST_ACTION_CONTRACT.triggerRole,
      disabled: normalized.disabled,
      ariaDisabled: normalized.disabled ? "true" : undefined,
      ariaExpanded: normalized.requiresConfirmation
        ? String(confirmation !== null)
        : undefined,
      data: {
        danger: String(normalized.irreversible),
      },
      label: normalized.label,
    },
    confirmation:
      confirmation === null
        ? null
        : {
            ...buildConfirmationActionViewModel({
              surface: "moderator-host",
              actionId: normalized.id,
              label: normalized.label,
              message: confirmation.message,
              messageIdPrefix: "host-action-confirmation-message",
              confirmTestId: HOST_ACTION_CONTRACT.confirmTestId,
              cancelTestId: HOST_ACTION_CONTRACT.cancelTestId,
              triggerTestId: HOST_ACTION_CONTRACT.triggerTestId,
              messageTestId: HOST_ACTION_CONTRACT.confirmationMessageTestId,
              confirmationTestId: HOST_ACTION_CONTRACT.confirmationTestId,
              className: HOST_ACTION_CONTRACT.confirmationClassName,
              actionsClassName: HOST_ACTION_CONTRACT.confirmationActionsClassName,
              objectLabel: confirmation.objectLabel,
              outcomeLabel: confirmation.outcomeLabel,
              tabContainment: HOST_ACTION_CONTRACT.tabContainment,
            }),
            className: HOST_ACTION_CONTRACT.confirmationClassName,
            objectLabel: confirmation.objectLabel,
            outcomeLabel: confirmation.outcomeLabel,
            actionsClassName: HOST_ACTION_CONTRACT.confirmationActionsClassName,
            confirmClassName: normalized.irreversible
              ? "touch-control touch-control--danger"
              : "touch-control",
          },
  };
}

function normalizeHostActionConfig(config) {
  if (config === null || typeof config !== "object") {
    throw new TypeError("host action config must be an object");
  }

  const normalized = {
    id: requiredString(config.id, "id"),
    label: requiredString(config.label, "label"),
    objectLabel: optionalString(config.objectLabel),
    outcomeLabel: optionalString(config.outcomeLabel),
    confirmationText: optionalString(config.confirmationText),
    payload: Object.hasOwn(config, "payload") ? config.payload : null,
    requiresConfirmation:
      config.requiresConfirmation === true || config.irreversible === true,
    irreversible: config.irreversible === true,
    disabled: config.disabled === true,
  };

  if (normalized.requiresConfirmation) {
    if (normalized.objectLabel === null) {
      throw new TypeError(
        "irreversible host actions must name the affected object",
      );
    }
    if (normalized.outcomeLabel === null) {
      throw new TypeError(
        "irreversible host actions must name the intended outcome",
      );
    }
    if (normalized.confirmationText === null) {
      throw new TypeError(
        "irreversible host actions must provide explicit confirmation text",
      );
    }
    if (!normalized.confirmationText.includes(normalized.objectLabel)) {
      throw new TypeError(
        "irreversible host action confirmation text must name the affected object",
      );
    }
    if (!normalized.confirmationText.includes(normalized.outcomeLabel)) {
      throw new TypeError(
        "irreversible host action confirmation text must name the intended outcome",
      );
    }
  }

  return Object.freeze(normalized);
}

function buildConfirmation(config) {
  return Object.freeze({
    actionId: config.id,
    objectLabel: config.objectLabel,
    outcomeLabel: config.outcomeLabel,
    message: config.confirmationText,
  });
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`host action ${fieldName} must be a non-empty string`);
  }
  return value;
}

function optionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("optional host action labels must be non-empty strings");
  }
  return value;
}
