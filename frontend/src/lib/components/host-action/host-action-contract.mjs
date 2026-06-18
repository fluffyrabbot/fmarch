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
  confirmationRole: "alertdialog",
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
        danger: String(normalized.requiresConfirmation),
      },
      label: normalized.label,
    },
    confirmation:
      confirmation === null
        ? null
        : {
            className: HOST_ACTION_CONTRACT.confirmationClassName,
            role: HOST_ACTION_CONTRACT.confirmationRole,
            objectLabel: confirmation.objectLabel,
            outcomeLabel: confirmation.outcomeLabel,
            message: confirmation.message,
            actionsClassName: HOST_ACTION_CONTRACT.confirmationActionsClassName,
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
    payload: Object.hasOwn(config, "payload") ? config.payload : null,
    requiresConfirmation:
      config.requiresConfirmation === true || config.irreversible === true,
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
  }

  return Object.freeze(normalized);
}

function buildConfirmation(config) {
  return Object.freeze({
    actionId: config.id,
    objectLabel: config.objectLabel,
    outcomeLabel: config.outcomeLabel,
    message: `${config.label}: ${config.outcomeLabel} for ${config.objectLabel}?`,
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
