export const COMMAND_INTERRUPTION_CONTRACT = Object.freeze({
  defaultTimeoutMs: 12_000,
  states: Object.freeze(["timeout", "connection_lost"]),
  retryLabel: "Retry safely",
  cancelLabel: "Cancel retry",
});

export const COMMAND_PROJECTION_RECOVERY_CONTRACT = Object.freeze({
  defaultTimeoutMs: 12_000,
});

export const COMMAND_OUTCOME_UNKNOWN_REASONS = Object.freeze([
  "transport_failure",
  "unsupported_response",
  "response_parse_failure",
  "protocol_mismatch",
]);

export class CommandInterruptedError extends Error {
  constructor(kind, options = {}) {
    super(options.message ?? interruptionMessage(kind), options);
    this.name = "CommandInterruptedError";
    this.kind = requiredInterruptionKind(kind);
    this.retryable = true;
    if (options.commandId !== undefined) {
      this.commandId = requiredString(options.commandId, "commandId");
    }
  }
}

export class CommandOutcomeUnknownError extends CommandInterruptedError {
  constructor(reason, { commandId, requestEnvelope, cause } = {}) {
    const normalizedReason = requiredUnknownOutcomeReason(reason);
    const normalizedCommandId = requiredString(commandId, "commandId");
    super("connection_lost", {
      cause,
      commandId: normalizedCommandId,
      message:
        "Confirmation could not be authenticated. The command may still have reached the server; retry only with the same command ID.",
    });
    this.name = "CommandOutcomeUnknownError";
    this.outcome = "unknown";
    this.reason = normalizedReason;
    this.requestEnvelope = requestEnvelope;
  }
}

export class CommandProjectionRecoveryTimeoutError extends Error {
  constructor(options = {}) {
    super(
      options.message ??
        "The command outcome is confirmed, but authoritative projection recovery timed out.",
      options,
    );
    this.name = "CommandProjectionRecoveryTimeoutError";
    this.retryable = false;
  }
}

export async function executeCommandAttempt({
  operation,
  timeoutMs = COMMAND_INTERRUPTION_CONTRACT.defaultTimeoutMs,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  abortControllerFactory = () => new AbortController(),
} = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("command attempt operation must be a function");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("command attempt timeoutMs must be positive");
  }

  const controller = abortControllerFactory();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeoutImpl(() => {
      controller.abort();
      reject(new CommandInterruptedError("timeout"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation({ signal: controller.signal })),
      timeout,
    ]);
  } catch (error) {
    if (error instanceof CommandInterruptedError) {
      throw error;
    }
    if (isConnectionLoss(error)) {
      throw new CommandInterruptedError("connection_lost", { cause: error });
    }
    throw error;
  } finally {
    clearTimeoutImpl(timeoutId);
  }
}

export async function executeCommandProjectionRecovery({
  operation,
  timeoutMs = COMMAND_PROJECTION_RECOVERY_CONTRACT.defaultTimeoutMs,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  abortControllerFactory = () => new AbortController(),
} = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("command projection recovery operation must be a function");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("command projection recovery timeoutMs must be positive");
  }

  const controller = abortControllerFactory();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeoutImpl(() => {
      controller.abort();
      reject(new CommandProjectionRecoveryTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation({ signal: controller.signal })),
      timeout,
    ]);
  } finally {
    clearTimeoutImpl(timeoutId);
  }
}

export function commandInterruptionStatus(error, { actionId, commandId } = {}) {
  if (!(error instanceof CommandInterruptedError)) {
    return null;
  }
  return Object.freeze({
    state: "interrupted",
    interruption: error.kind,
    actionId: requiredString(actionId, "actionId"),
    commandId: requiredString(error.commandId ?? commandId, "commandId"),
    retryable: true,
    message: error.message,
    ...(error instanceof CommandOutcomeUnknownError
      ? { outcome: "unknown", reason: error.reason }
      : {}),
  });
}

export function commandAttemptId(factory = defaultCommandId) {
  if (typeof factory !== "function") {
    throw new TypeError("command id factory must be a function");
  }
  return requiredString(factory(), "commandId");
}

export function commandAttemptTimeoutMs(windowRef) {
  const override = Number(windowRef?.__fmarchCommandTimeoutMs);
  return Number.isFinite(override) && override > 0
    ? override
    : COMMAND_INTERRUPTION_CONTRACT.defaultTimeoutMs;
}

export function commandProjectionRecoveryTimeoutMs(windowRef) {
  const override = Number(windowRef?.__fmarchCommandProjectionRecoveryTimeoutMs);
  return Number.isFinite(override) && override > 0
    ? override
    : COMMAND_PROJECTION_RECOVERY_CONTRACT.defaultTimeoutMs;
}

export function isCommandInterruptionStatus(status) {
  return (
    status?.state === "interrupted" &&
    COMMAND_INTERRUPTION_CONTRACT.states.includes(status.interruption) &&
    status.retryable === true
  );
}

function isConnectionLoss(error) {
  return (
    error?.name === "AbortError" ||
    error instanceof TypeError && /fetch|network|load|connection|failed/i.test(error.message)
  );
}

function interruptionMessage(kind) {
  switch (requiredInterruptionKind(kind)) {
    case "timeout":
      return "No response yet. The command may still have reached the server.";
    case "connection_lost":
      return "Connection lost before confirmation. The command may still have reached the server.";
  }
}

function requiredInterruptionKind(value) {
  if (!COMMAND_INTERRUPTION_CONTRACT.states.includes(value)) {
    throw new TypeError(`unsupported command interruption: ${value}`);
  }
  return value;
}

function requiredUnknownOutcomeReason(value) {
  if (!COMMAND_OUTCOME_UNKNOWN_REASONS.includes(value)) {
    throw new TypeError(`unsupported unknown command outcome reason: ${value}`);
  }
  return value;
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function defaultCommandId() {
  return crypto.randomUUID();
}
