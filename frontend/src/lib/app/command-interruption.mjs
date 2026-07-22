export const COMMAND_INTERRUPTION_CONTRACT = Object.freeze({
  defaultTimeoutMs: 12_000,
  states: Object.freeze(["timeout", "connection_lost"]),
  retryLabel: "Retry safely",
  cancelLabel: "Cancel retry",
});

export class CommandInterruptedError extends Error {
  constructor(kind, options = {}) {
    super(interruptionMessage(kind), options);
    this.name = "CommandInterruptedError";
    this.kind = requiredInterruptionKind(kind);
    this.retryable = true;
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

export function commandInterruptionStatus(error, { actionId, commandId } = {}) {
  if (!(error instanceof CommandInterruptedError)) {
    return null;
  }
  return Object.freeze({
    state: "interrupted",
    interruption: error.kind,
    actionId: requiredString(actionId, "actionId"),
    commandId: requiredString(commandId, "commandId"),
    retryable: true,
    message: error.message,
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

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function defaultCommandId() {
  return crypto.randomUUID();
}
