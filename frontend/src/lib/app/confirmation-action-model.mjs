export const CONFIRMATION_ACTION_CONTRACT = Object.freeze({
  kind: "confirmation-action",
  role: "alertdialog",
  ariaModal: "true",
  initialFocus: "confirm",
  returnFocus: "trigger",
  escapeCancels: true,
  defaultTabContainment: "local-confirmation-controls",
});

export function buildConfirmationActionViewModel({
  surface,
  actionId,
  label,
  message,
  messageIdPrefix,
  confirmTestId,
  cancelTestId,
  triggerTestId,
  messageTestId,
  confirmationTestId,
  className,
  actionsClassName,
  objectLabel = null,
  outcomeLabel = null,
  tabContainment = CONFIRMATION_ACTION_CONTRACT.defaultTabContainment,
} = {}) {
  const normalized = Object.freeze({
    surface: requiredString(surface, "surface"),
    actionId: requiredString(actionId, "actionId"),
    label: requiredString(label, "label"),
    message: requiredString(message, "message"),
    messageIdPrefix: requiredString(messageIdPrefix, "messageIdPrefix"),
    confirmTestId: requiredString(confirmTestId, "confirmTestId"),
    cancelTestId: requiredString(cancelTestId, "cancelTestId"),
    triggerTestId: requiredString(triggerTestId, "triggerTestId"),
    messageTestId: optionalString(messageTestId),
    confirmationTestId: optionalString(confirmationTestId),
    className: optionalString(className),
    actionsClassName: optionalString(actionsClassName),
    objectLabel: optionalString(objectLabel),
    outcomeLabel: optionalString(outcomeLabel),
    tabContainment: requiredString(tabContainment, "tabContainment"),
  });
  const messageId = `${normalized.messageIdPrefix}-${normalized.actionId}`;

  return Object.freeze({
    kind: CONFIRMATION_ACTION_CONTRACT.kind,
    surface: normalized.surface,
    actionId: normalized.actionId,
    role: CONFIRMATION_ACTION_CONTRACT.role,
    ariaModal: CONFIRMATION_ACTION_CONTRACT.ariaModal,
    ariaLabel: `Confirm ${normalized.label}`,
    label: normalized.label,
    message: normalized.message,
    messageId,
    messageTestId: normalized.messageTestId ?? messageId,
    confirmationTestId: normalized.confirmationTestId,
    confirmTestId: normalized.confirmTestId,
    cancelTestId: normalized.cancelTestId,
    triggerTestId: normalized.triggerTestId,
    initialFocusTestId: normalized.confirmTestId,
    returnFocusTestId: normalized.triggerTestId,
    escapeCancels: CONFIRMATION_ACTION_CONTRACT.escapeCancels,
    tabContainment: normalized.tabContainment,
    className: normalized.className,
    actionsClassName: normalized.actionsClassName,
    objectLabel: normalized.objectLabel,
    outcomeLabel: normalized.outcomeLabel,
  });
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`confirmation action ${fieldName} must be a non-empty string`);
  }
  return value;
}

function optionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(
      "confirmation action optional strings must be non-empty strings",
    );
  }
  return value;
}
