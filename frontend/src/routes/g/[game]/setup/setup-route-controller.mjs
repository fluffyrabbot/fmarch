import {
  buildDispatchBridgePlanFromRequest,
  normalizeConfirmationTrace,
} from "../../../../lib/app/command-dispatch-bridge.mjs";
import {
  attachConfirmationCommandTrace,
  buildConfirmationCommandTrace,
} from "../../../../lib/app/confirmation-command-trace-model.mjs";
import {
  buildAdminCommand,
  sendCommand,
} from "../../../../lib/app/command-boundary.mjs";
import {
  buildHostSetupReadiness,
  normalizeHostSetupState,
} from "./setup-route-model.mjs";

export function setupFormStatusKey(form) {
  if (form?.id === undefined || form?.id === null) {
    return "";
  }
  return `${form.id}:${form.state}:${form.message}`;
}

export function setupPendingStatus() {
  return Object.freeze({
    state: "pending",
    message: "Sending command",
  });
}

export function setupRejectStatus(error) {
  return Object.freeze({
    state: "reject",
    message: error instanceof Error ? error.message : String(error),
  });
}

export function setupConfirmStatus(actionId, message) {
  return attachConfirmationCommandTrace(
    {
      state: "confirm",
      message,
    },
    buildConfirmationCommandTrace({
      surface: "host-setup",
      actionId,
      statusKey: actionId,
      dispatchKind: actionId,
    }),
  );
}

export function recordSetupCommandStatus(commandStatuses, id, status) {
  return Object.freeze({
    ...commandStatuses,
    [id]: status,
  });
}

export function clearSetupCommandStatus(commandStatuses, id) {
  const next = { ...commandStatuses };
  delete next[id];
  return Object.freeze(next);
}

export function recordSetupFormStatus({
  commandStatuses,
  form,
  lastFormStatusKey,
}) {
  const nextFormStatusKey = setupFormStatusKey(form);
  if (nextFormStatusKey === "" || nextFormStatusKey === lastFormStatusKey) {
    return Object.freeze({
      commandStatuses,
      lastFormStatusKey,
      recorded: false,
    });
  }
  return Object.freeze({
    commandStatuses: recordSetupCommandStatus(commandStatuses, form.id, form),
    lastFormStatusKey: nextFormStatusKey,
    recorded: true,
  });
}

export function setupCommandConfigForAction({
  actionId,
  data,
  formData,
  setupState = data.setupState,
}) {
  const game = data.game.id;
  switch (actionId) {
    case "add-slot":
      return Object.freeze({
        action: "add_slot",
        game,
        slot: requiredFormValue(formData, "slotId"),
      });
    case "assign-slot":
      return Object.freeze({
        action: "assign_slot",
        game,
        slot: requiredFormValue(formData, "slotId"),
        user: requiredFormValue(formData, "principalUserId"),
      });
    case "assign-role":
      return Object.freeze({
        action: "assign_role",
        game,
        slot: requiredFormValue(formData, "slotId"),
        roleKey: requiredFormValue(formData, "roleKey"),
      });
    case "set-post-policy":
      return Object.freeze({
        action: "set_post_policy",
        game,
        channelId: requiredFormValue(formData, "channelId", "main"),
        allowMediaOnly: formData.get("allowMediaOnly") === "true",
      });
    case "attach-day-program": {
      const programId = requiredFormValue(formData, "programId");
      const option = setupState.programCatalog.find(
        (program) => `${program.id}@${program.version}` === programId,
      );
      if (option === undefined) {
        throw new TypeError(`unknown day program: ${programId}`);
      }
      if (option.compatibility?.attachable !== true) {
        throw new TypeError(`day program is incompatible with ${setupState.pack.key}: ${programId}`);
      }
      return Object.freeze({
        action: "attach_day_program",
        game,
        program: option.document,
      });
    }
    case "start-game":
      return Object.freeze({
        action: "start_game",
        game,
        phase: requiredFormValue(formData, "phase", data.start.defaultPhase),
      });
    default:
      throw new TypeError(`unsupported setup action: ${actionId}`);
  }
}

export async function sendHostSetupCommand({
  actionId,
  data,
  formData,
  setupState = data.setupState,
  fetchImpl,
  sendCommandImpl = sendCommand,
}) {
  const command = buildAdminCommand(
    setupCommandConfigForAction({ actionId, data, formData, setupState }),
  );
  return await sendCommandImpl({
    endpoint: data.commandEndpoint,
    command,
    fetchImpl,
  });
}

export function buildSetupCommandDispatchBridgePlan({
  actionId,
  data,
  formData,
  setupState = data.setupState,
  confirmationStatus,
  optimisticStatus,
  finalStatus,
}) {
  const trace = normalizeConfirmationTrace(confirmationStatus.confirmationTrace);
  return buildDispatchBridgePlanFromRequest({
    role: "host-setup",
    trace,
    request: {
      endpoint: data.commandEndpoint,
      command: buildAdminCommand(
        setupCommandConfigForAction({ actionId, data, formData, setupState }),
      ),
    },
    optimisticStatus,
    finalStatus,
    projectionRefreshKeys: Object.freeze(["setupState"]),
  });
}

export async function refreshSetupState({ data, fetchImpl }) {
  const response = await fetchImpl(data.setupStateEndpoint, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`setup state refresh failed with ${response.status}`);
  }
  const setupState = normalizeHostSetupState(await response.json(), {
    game: data.game.id,
  });
  return Object.freeze({
    setupState,
    readiness: buildHostSetupReadiness(setupState),
  });
}

export function exposeSetupRouteWindowState({
  windowRef,
  commandStatuses,
  setupState,
  readiness,
  outcome = null,
  plan = null,
}) {
  if (windowRef === undefined || windowRef === null) {
    return false;
  }
  windowRef.__fmarchHostSetupState = setupState;
  windowRef.__fmarchHostSetupReadiness = readiness;
  windowRef.__fmarchHostSetupCommandStatuses = commandStatuses;
  if (outcome !== null) {
    windowRef.__fmarchHostSetupCommandOutcome = outcome;
  }
  if (plan !== null) {
    windowRef.__fmarchHostSetupCommandDispatchBridgePlan = plan;
  }
  return true;
}

function requiredFormValue(formData, field, fallback = null) {
  const value = formData.get(field);
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  if (fallback !== null) {
    return fallback;
  }
  throw new TypeError(`${field} must be a non-empty string`);
}
