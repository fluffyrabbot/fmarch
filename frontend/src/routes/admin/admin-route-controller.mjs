import {
  buildDispatchBridgePlanFromRequest,
  normalizeConfirmationTrace,
} from "../../lib/app/command-dispatch-bridge.mjs";
import {
  attachConfirmationCommandTrace,
  buildConfirmationCommandTrace,
} from "../../lib/app/confirmation-command-trace-model.mjs";
import {
  buildAdminCommand,
  sendCommand,
} from "../../lib/app/command-boundary.mjs";

export function adminFormStatusKey(form) {
  if (form?.id === undefined || form?.id === null) {
    return "";
  }
  return `${form.id}:${form.state}:${form.message}`;
}

export function recordAdminFormStatus({
  commandStatuses,
  form,
  lastFormStatusKey,
}) {
  const nextFormStatusKey = adminFormStatusKey(form);
  if (nextFormStatusKey === "" || nextFormStatusKey === lastFormStatusKey) {
    return Object.freeze({
      commandStatuses,
      lastFormStatusKey,
      recorded: false,
    });
  }
  return Object.freeze({
    commandStatuses: recordAdminCommandStatus(commandStatuses, form.id, form),
    lastFormStatusKey: nextFormStatusKey,
    recorded: true,
  });
}

export function adminSetupActionMode(item) {
  switch (item.commandAction) {
    case "create_game":
    case "add_cohost":
    case "grant_session":
      return "confirm";
    default:
      return "readonly";
  }
}

export function adminConfirmationSurface(item) {
  return item.commandAction === undefined ? "admin-recovery" : "admin-setup";
}

export function adminConfirmationDispatchKind(item) {
  return item.commandAction ?? "check_recovery_gate";
}

export function adminConfirmStatus(item, options = {}) {
  const trace = buildConfirmationCommandTrace({
    surface: options.surface ?? adminConfirmationSurface(item),
    actionId: item.id,
    statusKey: item.id,
    dispatchKind: options.dispatchKind ?? adminConfirmationDispatchKind(item),
  });
  return attachConfirmationCommandTrace(
    {
      state: "confirm",
      message: item.confirmMessage,
    },
    trace,
  );
}

export function adminReadOnlyStatus(item) {
  return Object.freeze({
    state: "idle",
    message: `${item.label} boundary is read-only`,
  });
}

export function adminPendingStatus() {
  return Object.freeze({
    state: "pending",
    message: "Sending command",
  });
}

export function adminRejectStatus(error) {
  return Object.freeze({
    state: "reject",
    message: errorMessage(error),
  });
}

export function recordAdminCommandStatus(commandStatuses, id, status) {
  return Object.freeze({
    ...commandStatuses,
    [id]: status,
  });
}

export function clearAdminCommandStatus(commandStatuses, id) {
  const next = { ...commandStatuses };
  delete next[id];
  return Object.freeze(next);
}

export function commandConfigForAdminItem({ item, data }) {
  if (item.commandAction === "create_game") {
    return data.command.createGame;
  }
  if (item.commandAction === "add_cohost") {
    return data.command.cohost;
  }
  if (item.commandAction === "grant_session") {
    throw new TypeError(
      "session grants submit through the authenticated server action",
    );
  }
  throw new TypeError(`unsupported admin command action: ${item.commandAction}`);
}

export function buildAdminCommandDispatchBridgePlan({
  item,
  data,
  confirmationStatus,
  optimisticStatus,
  finalStatus,
}) {
  const trace = normalizeConfirmationTrace(
    confirmationStatus?.confirmationTrace ?? adminConfirmStatus(item).confirmationTrace,
  );
  return buildDispatchBridgePlanFromRequest({
    role: "admin",
    trace,
    request: {
      principalUserId: data.operator.principalUserId,
      endpoint: data.command.endpoint,
      command: buildAdminCommand(commandConfigForAdminItem({ item, data })),
    },
    optimisticStatus,
    finalStatus,
  });
}

export async function sendAdminSetupCommand({
  item,
  data,
  fetchImpl,
  sendCommandImpl = sendCommand,
}) {
  const outcome = await sendCommandImpl({
    principalUserId: data.operator.principalUserId,
    endpoint: data.command.endpoint,
    command: buildAdminCommand(commandConfigForAdminItem({ item, data })),
    fetchImpl,
  });
  return Object.freeze({
    outcome,
  });
}

export function exposeAdminCommandOutcome({
  windowRef,
  commandStatuses,
  outcome,
}) {
  if (windowRef === undefined || windowRef === null) {
    return false;
  }
  windowRef.__fmarchAdminCommandStatuses = commandStatuses;
  windowRef.__fmarchAdminCommandOutcome = outcome;
  return true;
}

export function exposeAdminCommandDispatchBridgePlan({ windowRef, plan }) {
  if (windowRef === undefined || windowRef === null) {
    return false;
  }
  windowRef.__fmarchAdminCommandDispatchBridgePlan = plan;
  return true;
}

export function exposeAdminFormResult({ windowRef, form }) {
  if (windowRef === undefined || windowRef === null) {
    return false;
  }
  windowRef.__fmarchAdminFormResults = [
    ...(windowRef.__fmarchAdminFormResults ?? []),
    form,
  ];
  windowRef.__fmarchAdminLatestFormResult = form;
  if (form?.id === "session-grants") {
    windowRef.__fmarchAdminSessionGrantResult = form;
  }
  if (form?.id === "recovery-gate") {
    windowRef.__fmarchAdminRecoveryGateResult = form;
  }
  return true;
}

export function exposeAdminSessionGrantResult({ windowRef, form }) {
  return exposeAdminFormResult({ windowRef, form });
}

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
