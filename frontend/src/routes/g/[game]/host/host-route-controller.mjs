import {
  buildDispatchBridgePlanFromRequest,
  normalizeConfirmationTrace,
} from "../../../../lib/app/command-dispatch-bridge.mjs";
import {
  attachConfirmationCommandTrace,
} from "../../../../lib/app/confirmation-command-trace-model.mjs";
import {
  normalizeHostPrompts,
  normalizeDayVoteOutcomes,
  normalizeVotecount,
} from "../../../../lib/app/cold-load.mjs";
import {
  buildHostConsoleActionGroups,
  buildHostConsoleCriticalActions,
} from "../../../../lib/components/host-action/host-console-critical-action.mjs";
import {
  mapHostActionToWireCommand,
  projectHostConsoleState,
  sendHostActionCommand,
} from "../../../../lib/components/host-action/host-command-boundary.mjs";
import { commandInterruptionStatus } from "../../../../lib/app/command-interruption.mjs";

export const HOST_PROJECTION_RESYNC_KEYS = Object.freeze([
  "host",
  "votecount",
  "dayVoteOutcomes",
  "hostPrompts",
]);

export function buildHostProjectionInitialSnapshot(data) {
  return Object.freeze({
    host: Object.freeze({
      authority: data.authority,
      completed: data.completed ?? false,
      phase: data.phase,
      replacement: data.replacement,
      tasks: data.hostTasks ?? [],
      dayEvents: data.hostDayEvents ?? [],
      dayEventScheduler: data.dayEventScheduler ?? null,
    }),
    votecount: data.votecount,
    dayVoteOutcomes: data.dayVoteOutcomes,
    hostPrompts: data.hostPrompts,
  });
}

export function buildHostProjectionColdLoads(data) {
  return Object.freeze({
    host: Object.freeze({
      url: data.hostConsoleStateEndpoint,
      normalize: projectHostConsoleState,
    }),
    votecount: Object.freeze({
      url: data.hostVotecountEndpoint,
      normalize: normalizeVotecount,
    }),
    dayVoteOutcomes: Object.freeze({
      url: data.dayVoteOutcomesEndpoint,
      normalize: normalizeDayVoteOutcomes,
    }),
    hostPrompts: Object.freeze({
      url: data.hostPromptEndpoint,
      normalize: normalizeHostPrompts,
    }),
  });
}

export function hostProjectionResyncKeys() {
  return HOST_PROJECTION_RESYNC_KEYS;
}

export function buildHostDerivedState({ gameId, snapshot, capabilityKind = "HostOf" }) {
  const projection = snapshot.host;
  const effectiveCapabilityKind =
    projection.authority?.capabilityKind ?? capabilityKind;
  const votecount = snapshot.votecount;
  const dayVoteOutcomes = Array.isArray(snapshot.dayVoteOutcomes)
    ? snapshot.dayVoteOutcomes
    : [];
  const hostPrompts = snapshot.hostPrompts;
  const criticalActions = buildHostConsoleCriticalActions(gameId, {
    hostPrompts,
    phase: projection.phase,
    replacement: projection.replacement,
    completed: projection.completed,
    capabilityKind: effectiveCapabilityKind,
    allowedPermissionClasses: projection.authority?.allowedClasses ?? [],
  });
  const moderatorActionGroups = buildHostConsoleActionGroups({
    actions: criticalActions,
    pendingPromptCount: pendingPromptCount(hostPrompts),
    votecountCount: votecount.length,
    capabilityKind: effectiveCapabilityKind,
  });

  return Object.freeze({
    projection,
    votecount,
    dayVoteOutcomes,
    hostPrompts,
    hostTasks: projection.tasks ?? [],
    hostDayEvents: projection.dayEvents ?? [],
    dayEventScheduler: projection.dayEventScheduler ?? null,
    criticalActions,
    moderatorActionGroups,
  });
}

export function appendHostActionEvent(dispatched, event) {
  return Object.freeze([...dispatched, event]);
}

export function appendHostCommandOutcome(commandOutcomes, outcome, event = null) {
  return Object.freeze([
    ...commandOutcomes,
    attachEventConfirmationTrace(outcome, event),
  ]);
}

export function recordHostCommandStatus(commandStatuses, actionId, status) {
  return Object.freeze({
    ...commandStatuses,
    [actionId]: status,
  });
}

export function clearHostCommandStatus(commandStatuses, actionId) {
  const next = { ...commandStatuses };
  delete next[actionId];
  return Object.freeze(next);
}

export function hostCommandPendingStatus(event = null) {
  return attachEventConfirmationTrace({
    state: "pending",
    message: "Sending command",
  }, event);
}

export function hostCommandErrorOutcome({ actionId, error, event = null }) {
  return attachEventConfirmationTrace({
    state: "reject",
    actionId,
    error: "Internal",
    retryable: false,
    message: errorMessage(error),
  }, event);
}

export function hostCommandInterruptedOutcome({ actionId, commandId, error, event = null }) {
  const status = commandInterruptionStatus(error, { actionId, commandId });
  return status === null ? null : attachEventConfirmationTrace(status, event);
}

export function buildHostCommandDispatchBridgePlan({
  event,
  data,
  optimisticStatus,
  finalStatus,
  projectionRefreshKeys = hostPostCommandRefreshKeys({
    event,
    outcome: finalStatus,
  }),
}) {
  const trace = normalizeConfirmationTrace(event.confirmationTrace);
  return buildDispatchBridgePlanFromRequest({
    role: "moderator",
    trace,
    request: {
      endpoint: data.commandEndpoint,
      command: mapHostActionToWireCommand(event),
    },
    optimisticStatus,
    finalStatus,
    projectionRefreshKeys,
  });
}

export function attachEventConfirmationTrace(status, event) {
  if (event?.confirmationTrace === undefined || event.confirmationTrace === null) {
    return Object.freeze(status);
  }
  return attachConfirmationCommandTrace(status, event.confirmationTrace);
}

export async function sendHostRouteAction({
  event,
  data,
  fetchImpl,
  commandIdFactory,
  signal,
  projectionStore,
  sendHostActionCommandImpl = sendHostActionCommand,
}) {
  const outcome = await sendHostActionCommandImpl({
    actionEvent: event,
    endpoint: data.commandEndpoint,
    stateEndpoint: data.hostConsoleStateEndpoint,
    fetchImpl,
    commandIdFactory,
    signal,
  });
  if (outcome.projectionState) {
    projectionStore.applyPayload("host", outcome.projectionState);
  }
  if (outcome.projectionPatches) {
    applyOutcomeProjectionPatches({
      patches: outcome.projectionPatches,
      projectionStore,
    });
  }
  const postOutcomeRefreshKeys = hostPostCommandRefreshKeys({
    event,
    outcome,
  });
  if (postOutcomeRefreshKeys.length > 0) {
    await projectionStore.refresh(postOutcomeRefreshKeys, { fetchImpl, signal });
  }
  return Object.freeze({
    outcome,
    snapshot: projectionStore.getSnapshot(),
  });
}

export function hostPostAckRefreshKeys({ event, outcome }) {
  if (outcome?.state !== "ack") {
    return Object.freeze([]);
  }
  if (event?.payload?.kind === "resolve_phase") {
    return Object.freeze(["host", "votecount", "dayVoteOutcomes", "hostPrompts"]);
  }
  if (event?.payload?.kind === "resolve_day_event") {
    return Object.freeze(
      outcome.projectionState === undefined ? ["host"] : [],
    );
  }
  if (event?.payload?.kind !== "resolve_host_prompt") {
    return Object.freeze([]);
  }
  return Object.freeze([
    ...(outcome.projectionState === undefined ? ["host"] : []),
    ...(outcome.projectionPatches?.hostPrompts === undefined
      ? ["hostPrompts"]
      : []),
  ]);
}

export function hostPostCommandRefreshKeys({ event, outcome }) {
  const ackRefreshKeys = hostPostAckRefreshKeys({ event, outcome });
  if (ackRefreshKeys.length > 0) {
    return ackRefreshKeys;
  }
  if (
    outcome?.state === "reject" &&
    (outcome?.error === "PhaseLocked" || outcome?.error === "InvalidTarget") &&
    isPhaseControlAction(event?.payload?.kind)
  ) {
    return Object.freeze(["host"]);
  }
  if (
    outcome?.state === "reject" &&
    outcome?.error === "PromptAlreadyResolved" &&
    event?.payload?.kind === "resolve_host_prompt"
  ) {
    return Object.freeze(["host", "hostPrompts"]);
  }
  if (
    outcome?.state === "reject" &&
    outcome?.error === "DayEventStateConflict" &&
    event?.payload?.kind === "resolve_day_event"
  ) {
    return Object.freeze(["host"]);
  }
  if (
    outcome?.state === "reject" &&
    outcome?.error === "GameAlreadyCompleted" &&
    event?.payload?.kind === "complete_game"
  ) {
    return Object.freeze(["host"]);
  }
  if (
    outcome?.state === "reject" &&
    (outcome?.retryable === true || outcome?.error === "StreamConflict")
  ) {
    return hostProjectionResyncKeys();
  }
  return Object.freeze([]);
}

function isPhaseControlAction(kind) {
  return [
    "resolve_phase",
    "lock_thread",
    "unlock_thread",
    "advance_phase",
    "advance_phase_by_deadline",
    "extend_deadline",
  ].includes(kind);
}

function applyOutcomeProjectionPatches({ patches, projectionStore }) {
  if (patches === null || typeof patches !== "object" || Array.isArray(patches)) {
    throw new TypeError("host command projectionPatches must be an object");
  }

  for (const [key, payload] of Object.entries(patches)) {
    if (!HOST_PROJECTION_RESYNC_KEYS.includes(key)) {
      throw new TypeError(`unsupported host projection patch key: ${key}`);
    }
    projectionStore.applyPayload(key, payload);
  }
}

function pendingPromptCount(hostPrompts) {
  return hostPrompts.filter((prompt) => prompt.status === "pending").length;
}

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
