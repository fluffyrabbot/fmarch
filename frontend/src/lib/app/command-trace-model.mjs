export const COMMAND_TRACE_CONTRACT = Object.freeze({
  kind: "command-trace",
});

export function buildCommandTrace({
  surface,
  actionId,
  statusKey = actionId,
  dispatchKind = actionId,
  projectionRefreshKeys = [],
} = {}) {
  return Object.freeze({
    kind: COMMAND_TRACE_CONTRACT.kind,
    surface: requiredString(surface, "surface"),
    actionId: requiredString(actionId, "actionId"),
    statusKey: requiredString(statusKey, "statusKey"),
    dispatchKind: requiredString(dispatchKind, "dispatchKind"),
    projectionRefreshKeys: Object.freeze(
      projectionRefreshKeys.map((key) => requiredString(key, "projectionRefreshKey")),
    ),
  });
}

export function attachCommandTrace(status, trace) {
  if (status === null || typeof status !== "object" || Array.isArray(status)) {
    throw new TypeError("command trace status must be an object");
  }
  assertCommandTrace(trace);
  return Object.freeze({
    ...status,
    commandTrace: trace,
  });
}

function assertCommandTrace(trace) {
  if (trace === null || typeof trace !== "object" || Array.isArray(trace)) {
    throw new TypeError("command trace must be an object");
  }
  if (trace.kind !== COMMAND_TRACE_CONTRACT.kind) {
    throw new TypeError("command trace has unsupported kind");
  }
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`command trace ${fieldName} must be a non-empty string`);
  }
  return value;
}
