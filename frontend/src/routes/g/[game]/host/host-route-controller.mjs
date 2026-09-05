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
import {
  CommandInterruptedError,
  commandInterruptionStatus,
  executeCommandProjectionRecovery,
} from "../../../../lib/app/command-interruption.mjs";
import {
  persistInterruptedCommandAttempts,
  readInterruptedCommandAttempts,
} from "../../../../lib/app/command-recovery-storage.mjs";
import {
  validateDayVoteOutcomesResponse,
  validateHostPromptsResponse,
  validateHostConsoleLiveDelta,
  validateHostConsoleStateResponse,
  validateVotecountResponse,
} from "../../../../lib/app/gameplay-response-schema.mjs";

export const HOST_RECONNECT_REFRESH_KEYS = Object.freeze([
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
      validate: (payload) =>
        validateHostConsoleStateResponse(payload, {
          game: data.game.id,
          expectedPrincipalId: data.commandPrincipalId,
          expectedCapabilityKind: data.access.capability?.kind,
        }),
      normalize: normalizeAuthoritativeHostProjection,
      validateNormalized: (projection) =>
        projection?.authority?.principalId === data.commandPrincipalId &&
        projection?.authority?.capabilityKind === data.access.capability?.kind,
      validateLiveDelta: (delta) =>
        validateHostConsoleLiveDelta(delta, {
          game: data.game.id,
          expectedPrincipalId: data.commandPrincipalId,
          expectedCapabilityKind: data.access.capability?.kind,
        }),
      revoke: revokedHostProjection,
    }),
    votecount: Object.freeze({
      url: data.hostVotecountEndpoint,
      validate: (payload) =>
        validateVotecountResponse(payload, { game: data.game.id }),
      normalize: normalizeVotecount,
    }),
    dayVoteOutcomes: Object.freeze({
      url: data.dayVoteOutcomesEndpoint,
      validate: (payload) =>
        validateDayVoteOutcomesResponse(payload, { game: data.game.id }),
      normalize: normalizeDayVoteOutcomes,
    }),
    hostPrompts: Object.freeze({
      url: data.hostPromptEndpoint,
      validate: (payload) =>
        validateHostPromptsResponse(payload, { game: data.game.id }),
      normalize: normalizeHostPrompts,
      revoke: Object.freeze([]),
    }),
  });
}

export function revokedHostProjection() {
  return Object.freeze({
    authority: null,
    authorityRevoked: true,
    completed: false,
    phase: null,
    replacement: null,
    tasks: Object.freeze([]),
    dayEvents: Object.freeze([]),
    dayEventScheduler: null,
    slots: Object.freeze([]),
    threadPosts: Object.freeze([]),
  });
}

function normalizeAuthoritativeHostProjection(payload, previous) {
  const previousReplacement = previous?.replacement ?? null;
  const normalized = projectHostConsoleState(payload, {
    ...previous,
    authority: previous?.authority ?? Object.freeze({}),
    replacement: previousReplacement ?? Object.freeze({}),
  });
  if (
    previousReplacement === null &&
    (!Array.isArray(payload?.slots) || payload.slots.length === 0)
  ) {
    return Object.freeze({ ...normalized, replacement: null });
  }
  return normalized;
}

export function hostReconnectRefreshKeys() {
  return HOST_RECONNECT_REFRESH_KEYS;
}

export function buildHostDerivedState({
  gameId,
  snapshot,
  capabilityKind = "HostOf",
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const projection = snapshot.host;
  const effectiveCapabilityKind =
    projection.authority?.capabilityKind ?? capabilityKind;
  const votecount = snapshot.votecount;
  const dayVoteOutcomes = Array.isArray(snapshot.dayVoteOutcomes)
    ? snapshot.dayVoteOutcomes
    : [];
  const hostPrompts = snapshot.hostPrompts;
  const criticalActions = projection.authorityRevoked === true
    ? Object.freeze([])
    : buildHostConsoleCriticalActions(gameId, {
        hostPrompts,
        phase: projection.phase,
        replacement: projection.replacement,
        completed: projection.completed,
        capabilityKind: effectiveCapabilityKind,
        allowedPermissionClasses: projection.authority?.allowedClasses ?? [],
        nowSeconds,
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

export function persistHostInterruptedCommands({
  storage,
  game,
  principalId,
  attempts,
}) {
  return persistInterruptedCommandAttempts({
    storage,
    game,
    surface: "moderator",
    authority: hostRecoveryAuthority(principalId),
    attempts,
  });
}

export function restoreHostInterruptedCommands({ storage, game, principalId }) {
  const attempts = readInterruptedCommandAttempts({
    storage,
    game,
    surface: "moderator",
    authority: hostRecoveryAuthority(principalId),
  });
  const commandStatuses = {};
  for (const [actionId, attempt] of Object.entries(attempts)) {
    const status = hostCommandInterruptedOutcome({
      actionId,
      commandId: attempt.commandId,
      error: new CommandInterruptedError(attempt.interruption),
      event: attempt.event,
    });
    if (status !== null) {
      commandStatuses[actionId] = status;
    }
  }
  return Object.freeze({
    attempts,
    commandStatuses: Object.freeze(commandStatuses),
  });
}

export function buildHostCommandDispatchBridgePlan({
  event,
  data,
  optimisticStatus,
  finalStatus,
  preparedCommand = null,
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
      command: preparedCommand ?? mapHostActionToWireCommand(event),
    },
    optimisticStatus,
    finalStatus,
    projectionRefreshKeys,
  });
}

export function buildHostCommandRequest({ event, data }) {
  return Object.freeze({
    endpoint: data.commandEndpoint,
    command: mapHostActionToWireCommand(event),
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
  preparedCommand = null,
  projectionRecoveryTimeoutMs,
}) {
  const outcome = await dispatchHostRouteAction({
    event,
    data,
    fetchImpl,
    commandIdFactory,
    signal,
    projectionStore,
    sendHostActionCommandImpl,
    preparedCommand,
  });
  return recoverHostRouteAction({
    event,
    outcome,
    fetchImpl,
    projectionStore,
    projectionRecoveryTimeoutMs,
  });
}

export async function dispatchHostRouteAction({
  event,
  data,
  fetchImpl,
  commandIdFactory,
  signal,
  projectionStore,
  sendHostActionCommandImpl = sendHostActionCommand,
  preparedCommand = null,
  mapHostActionToWireCommandImpl = mapHostActionToWireCommand,
}) {
  if (data?.commandsEnabled !== true) {
    throw new Error("host commands are disabled without an authoritative route snapshot");
  }
  if (projectionStore?.isReady?.() !== true) {
    throw new Error(
      "host commands are disabled until authoritative projection freshness is restored",
    );
  }
  const currentDerivedState = buildHostDerivedState({
    gameId: data.game.id,
    snapshot: {
      votecount: [],
      dayVoteOutcomes: [],
      hostPrompts: [],
      ...projectionStore.getSnapshot(),
    },
    capabilityKind: data.access.capability?.kind,
    nowSeconds: data.deadlineClock?.nowSeconds,
  });
  if (!currentDerivedState.criticalActions.some((action) =>
    action.id === event?.actionId &&
    canonicalJson(action.payload) === canonicalJson(event?.payload)
  )) {
    throw new Error(`host action ${String(event?.actionId)} is no longer authoritative`);
  }
  const currentCommand = mapHostActionToWireCommandImpl(event);
  if (
    preparedCommand !== null &&
    canonicalJson(preparedCommand) !== canonicalJson(currentCommand)
  ) {
    throw new Error(
      `host action ${String(event?.actionId)} no longer matches the interrupted command body`,
    );
  }
  return sendHostActionCommandImpl({
    actionEvent: event,
    endpoint: data.commandEndpoint,
    fetchImpl,
    commandIdFactory,
    signal,
    preparedCommand: preparedCommand ?? currentCommand,
  });
}

export async function recoverHostRouteAction({
  event,
  outcome: confirmedOutcome,
  fetchImpl,
  projectionStore,
  projectionRecoveryTimeoutMs,
  executeProjectionRecoveryImpl = executeCommandProjectionRecovery,
}) {
  let outcome = confirmedOutcome;
  if (outcome?.state === "ack" && outcome?.projectionUnavailable === true) {
    projectionStore.invalidate(undefined, {
      reason: "committed_host_command_refresh_failed",
    });
  }
  try {
    if (outcome.projectionState) {
      projectionStore.applyPayload("host", outcome.projectionState);
    }
    if (outcome.projectionPatches) {
      applyOutcomeProjectionPatches({
        patches: outcome.projectionPatches,
        projectionStore,
      });
    }
  } catch (error) {
    projectionStore.invalidate(undefined, {
      reason: "committed_host_projection_invalid",
    });
    if (outcome.state === "ack") {
      outcome = committedHostOutcomeWithUnavailableProjection(outcome);
      return Object.freeze({
        outcome,
        snapshot: projectionStore.getSnapshot(),
      });
    }
    throw error;
  }
  const postOutcomeRefreshKeys = hostPostCommandRefreshKeys({
    event,
    outcome,
  });
  if (postOutcomeRefreshKeys.length > 0) {
    try {
      await executeProjectionRecoveryImpl({
        timeoutMs: projectionRecoveryTimeoutMs,
        operation: ({ signal }) =>
          projectionStore.refresh(postOutcomeRefreshKeys, { fetchImpl, signal }),
      });
    } catch (error) {
      projectionStore.invalidate?.(undefined, {
        reason: "confirmed_host_command_projection_recovery_failed",
      });
      outcome = outcome.state === "ack"
        ? committedHostOutcomeWithUnavailableProjection(outcome)
        : Object.freeze({
            ...outcome,
            retryable: false,
            projectionUnavailable: true,
            message: `${outcome.message}. Authoritative state refresh is unavailable.`,
          });
    }
  }
  return Object.freeze({
    outcome,
    snapshot: projectionStore.getSnapshot(),
  });
}

function committedHostOutcomeWithUnavailableProjection(outcome) {
  const { error: _error, ...committed } = outcome;
  return Object.freeze({
    ...committed,
    state: "ack",
    retryable: false,
    projectionUnavailable: true,
    message:
      "Command committed; authoritative host state refresh is unavailable. Do not retry.",
  });
}

function hostRecoveryAuthority(principalId) {
  const principal = String(principalId ?? "").trim();
  if (principal === "") {
    throw new TypeError("host command recovery requires a principal");
  }
  return `host:${principal}`;
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
    return hostReconnectRefreshKeys();
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
    if (!HOST_RECONNECT_REFRESH_KEYS.includes(key)) {
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

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
