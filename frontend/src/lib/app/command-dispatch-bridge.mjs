export const COMMAND_DISPATCH_BRIDGE_CONTRACT = Object.freeze({
  proof: "frontend-command-dispatch-bridge",
  boundary:
    "No-browser bridge contract for command trace metadata. It proves trace attributes can be normalized into role dispatch plans and reconciled with typed command requests, local feedback rows, and projection refresh keys. It does not prove pointer events, focus traversal, browser hydration, or network transport.",
  commandTraceKind: "command-trace",
  confirmationTraceKind: "confirmation-command-trace",
  roles: Object.freeze(["admin", "player", "moderator", "host-setup"]),
});

export function commandTraceFromAttributes(attributes) {
  const trace = Object.freeze({
    kind: requiredAttribute(attributes, "data-command-trace-kind"),
    surface: requiredAttribute(attributes, "data-command-surface"),
    actionId: requiredAttribute(attributes, "data-command-action-id"),
    statusKey: requiredAttribute(attributes, "data-command-status-key"),
    dispatchKind: requiredAttribute(attributes, "data-command-dispatch-kind"),
    projectionRefreshKeys: commaSeparatedAttribute(
      attributes,
      "data-command-refresh-keys",
    ),
  });
  if (trace.kind !== COMMAND_DISPATCH_BRIDGE_CONTRACT.commandTraceKind) {
    throw new TypeError(`unsupported command trace kind: ${trace.kind}`);
  }
  return trace;
}

export function confirmationTraceFromAttributes(attributes) {
  const trace = Object.freeze({
    kind: requiredAttribute(attributes, "data-confirmation-trace-kind"),
    surface: requiredAttribute(attributes, "data-confirmation-surface"),
    actionId: requiredAttribute(attributes, "data-confirmation-action-id"),
    statusKey: requiredAttribute(attributes, "data-confirmation-status-key"),
    dispatchKind: requiredAttribute(
      attributes,
      "data-confirmation-dispatch-kind",
    ),
  });
  if (trace.kind !== COMMAND_DISPATCH_BRIDGE_CONTRACT.confirmationTraceKind) {
    throw new TypeError(`unsupported confirmation trace kind: ${trace.kind}`);
  }
  return trace;
}

export function commandTraceAttributes(trace) {
  return Object.freeze({
    "data-command-trace-kind": requiredString(trace?.kind, "trace.kind"),
    "data-command-surface": requiredString(trace?.surface, "trace.surface"),
    "data-command-action-id": requiredString(trace?.actionId, "trace.actionId"),
    "data-command-status-key": requiredString(trace?.statusKey, "trace.statusKey"),
    "data-command-dispatch-kind": requiredString(
      trace?.dispatchKind,
      "trace.dispatchKind",
    ),
    "data-command-refresh-keys": (trace?.projectionRefreshKeys ?? []).join(","),
  });
}

export function confirmationTraceAttributes(trace) {
  return Object.freeze({
    "data-confirmation-trace-kind": requiredString(trace?.kind, "trace.kind"),
    "data-confirmation-surface": requiredString(trace?.surface, "trace.surface"),
    "data-confirmation-action-id": requiredString(
      trace?.actionId,
      "trace.actionId",
    ),
    "data-confirmation-status-key": requiredString(
      trace?.statusKey,
      "trace.statusKey",
    ),
    "data-confirmation-dispatch-kind": requiredString(
      trace?.dispatchKind,
      "trace.dispatchKind",
    ),
  });
}

export function normalizeCommandTrace(trace) {
  return commandTraceFromAttributes(commandTraceAttributes(trace));
}

export function normalizeConfirmationTrace(trace) {
  return confirmationTraceFromAttributes(confirmationTraceAttributes(trace));
}

export function buildDispatchBridgePlan({
  role,
  trace,
  commandKind,
  commandEndpoint,
  principalUserId,
  optimisticState,
  finalState,
  projectionRefreshKeys = [],
  boundary = COMMAND_DISPATCH_BRIDGE_CONTRACT.boundary,
}) {
  return Object.freeze({
    role: requiredRole(role),
    boundary,
    trace: Object.freeze({ ...trace }),
    commandKind: requiredString(commandKind, "commandKind"),
    commandEndpoint: requiredString(commandEndpoint, "commandEndpoint"),
    principalUserId: requiredString(principalUserId, "principalUserId"),
    optimisticState: requiredString(optimisticState, "optimisticState"),
    finalState: requiredString(finalState, "finalState"),
    projectionRefreshKeys: Object.freeze(
      projectionRefreshKeys.map((key) => requiredString(key, "refreshKey")),
    ),
  });
}

export function buildDispatchBridgePlanFromRequest({
  role,
  trace,
  request,
  optimisticStatus,
  finalStatus,
  projectionRefreshKeys = trace?.projectionRefreshKeys ?? [],
}) {
  return buildDispatchBridgePlan({
    role,
    trace,
    commandKind: commandKindForCommand(request?.command),
    commandEndpoint: request?.endpoint ?? "/commands",
    principalUserId: request?.principalUserId,
    optimisticState: statusState(optimisticStatus, "optimisticStatus"),
    finalState: statusState(finalStatus, "finalStatus"),
    projectionRefreshKeys,
  });
}

export function commandKindForCommand(command) {
  if (command === null || typeof command !== "object" || Array.isArray(command)) {
    throw new TypeError("command must be a wire command object");
  }
  const kinds = Object.keys(command);
  if (kinds.length !== 1) {
    throw new TypeError("command must contain exactly one wire command kind");
  }
  return requiredString(kinds[0], "commandKind");
}

function requiredRole(role) {
  const normalized = requiredString(role, "role");
  if (!COMMAND_DISPATCH_BRIDGE_CONTRACT.roles.includes(normalized)) {
    throw new TypeError(`unsupported command dispatch role: ${normalized}`);
  }
  return normalized;
}

function requiredAttribute(attributes, name) {
  return requiredString(attributes?.[name], name);
}

function commaSeparatedAttribute(attributes, name) {
  const value = attributes?.[name];
  if (value === undefined || value === null || value === "") {
    return Object.freeze([]);
  }
  return Object.freeze(
    String(value)
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== ""),
  );
}

function statusState(status, field) {
  return requiredString(status?.state, `${field}.state`);
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}
