export const CONFIRMATION_COMMAND_TRACE_CONTRACT = Object.freeze({
  kind: "confirmation-command-trace",
  confirmationKind: "confirmation-action",
});

export function buildConfirmationCommandTrace({
  surface,
  actionId,
  statusKey = actionId,
  confirmation,
  dispatchKind = null,
} = {}) {
  const normalized = Object.freeze({
    surface: requiredString(surface, "surface"),
    actionId: requiredString(actionId, "actionId"),
    statusKey: requiredString(statusKey, "statusKey"),
    dispatchKind: optionalString(dispatchKind),
  });

  if (confirmation !== undefined) {
    assertConfirmationMatchesTrace({ confirmation, normalized });
  }

  return Object.freeze({
    kind: CONFIRMATION_COMMAND_TRACE_CONTRACT.kind,
    confirmationKind: CONFIRMATION_COMMAND_TRACE_CONTRACT.confirmationKind,
    surface: normalized.surface,
    actionId: normalized.actionId,
    statusKey: normalized.statusKey,
    dispatchKind: normalized.dispatchKind,
  });
}

export function attachConfirmationCommandTrace(status, trace) {
  if (status === null || typeof status !== "object" || Array.isArray(status)) {
    throw new TypeError("confirmation command trace status must be an object");
  }
  assertTrace(trace);
  return Object.freeze({
    ...status,
    confirmationTrace: trace,
  });
}

function assertConfirmationMatchesTrace({ confirmation, normalized }) {
  if (
    confirmation === null ||
    typeof confirmation !== "object" ||
    Array.isArray(confirmation)
  ) {
    throw new TypeError("confirmation command trace requires a confirmation object");
  }
  if (confirmation.kind !== CONFIRMATION_COMMAND_TRACE_CONTRACT.confirmationKind) {
    throw new TypeError("confirmation command trace requires a confirmation-action");
  }
  if (confirmation.surface !== normalized.surface) {
    throw new TypeError("confirmation command trace surface must match confirmation");
  }
  if (confirmation.actionId !== normalized.actionId) {
    throw new TypeError("confirmation command trace actionId must match confirmation");
  }
}

function assertTrace(trace) {
  if (trace === null || typeof trace !== "object" || Array.isArray(trace)) {
    throw new TypeError("confirmation command trace must be an object");
  }
  if (trace.kind !== CONFIRMATION_COMMAND_TRACE_CONTRACT.kind) {
    throw new TypeError("confirmation command trace has unsupported kind");
  }
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(
      `confirmation command trace ${fieldName} must be a non-empty string`,
    );
  }
  return value;
}

function optionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(
      "confirmation command trace optional strings must be non-empty strings",
    );
  }
  return value;
}
