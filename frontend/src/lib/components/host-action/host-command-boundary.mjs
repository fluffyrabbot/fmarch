export const HOST_COMMAND_ENDPOINT = "/commands";
export const WIRE_PROTOCOL_VERSION = 1;

export function buildHostCommandEnvelope({
  actionEvent,
  principalUserId,
  commandId,
  envelopeId,
}) {
  return Object.freeze({
    v: WIRE_PROTOCOL_VERSION,
    id: envelopeId,
    body: Object.freeze({
      kind: "Command",
      body: Object.freeze({
        command_id: commandId,
        principal_user_id: requiredString(principalUserId, "principalUserId"),
        command: mapHostActionToWireCommand(actionEvent),
      }),
    }),
  });
}

export async function sendHostActionCommand({
  actionEvent,
  principalUserId,
  endpoint = HOST_COMMAND_ENDPOINT,
  stateEndpoint,
  fetchImpl = fetch,
  commandIdFactory = defaultCommandId,
  envelopeIdFactory = defaultEnvelopeId,
}) {
  const commandId = commandIdFactory();
  const envelopeId = envelopeIdFactory();
  const envelope = buildHostCommandEnvelope({
    actionEvent,
    principalUserId,
    commandId,
    envelopeId,
  });

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(envelope),
  });
  const serverEnvelope = await response.json();
  const outcome = normalizeServerCommandEnvelope({
    actionId: actionEvent.actionId,
    commandId,
    requestEnvelope: envelope,
    response,
    serverEnvelope,
  });
  if (outcome.state !== "ack" || stateEndpoint === undefined || stateEndpoint === null) {
    return outcome;
  }

  const stateResponse = await fetchImpl(stateEndpoint);
  if (!stateResponse.ok) {
    return Object.freeze({
      ...outcome,
      state: "reject",
      error: "StateRefreshFailed",
      retryable: true,
      message: `Ack committed, but host console state refresh failed with ${stateResponse.status}`,
    });
  }

  return Object.freeze({
    ...outcome,
    projectionState: await stateResponse.json(),
  });
}

export function mapHostActionToWireCommand(actionEvent) {
  if (actionEvent === null || typeof actionEvent !== "object") {
    throw new TypeError("host action event must be an object");
  }

  const payload = actionEvent.payload;
  if (payload === null || typeof payload !== "object") {
    throw new TypeError("host action payload must be an object");
  }

  switch (payload.kind) {
    case "extend_deadline":
      return Object.freeze({
        ExtendDeadline: Object.freeze({
          game: requiredString(payload.gameId, "payload.gameId"),
          phase: requiredString(payload.phaseId, "payload.phaseId"),
          at: secondsSinceEpoch(
            requiredString(payload.extendsTo, "payload.extendsTo"),
          ),
        }),
      });
    case "process_replacement":
      return Object.freeze({
        ProcessReplacement: Object.freeze({
          game: requiredString(payload.gameId, "payload.gameId"),
          slot: requiredString(payload.slotId, "payload.slotId"),
          outgoing_user: requiredString(
            payload.outgoingPlayerId,
            "payload.outgoingPlayerId",
          ),
          incoming_user: requiredString(
            payload.incomingPlayerId,
            "payload.incomingPlayerId",
          ),
        }),
      });
    default:
      throw new TypeError(`unsupported host action payload kind: ${payload.kind}`);
  }
}

export function normalizeServerCommandEnvelope({
  actionId,
  commandId,
  requestEnvelope,
  response,
  serverEnvelope,
}) {
  const body = serverEnvelope?.body;
  if (body?.kind === "Ack") {
    return Object.freeze({
      state: "ack",
      actionId,
      commandId,
      envelopeId: requestEnvelope.id,
      httpStatus: response.status,
      streamSeqs: Object.freeze(body.body.stream_seqs ?? []),
      message: `Ack: stream seqs ${(body.body.stream_seqs ?? []).join(", ")}`,
      requestEnvelope,
      serverEnvelope,
    });
  }

  if (body?.kind === "Reject") {
    const reject = body.body;
    return Object.freeze({
      state: "reject",
      actionId,
      commandId,
      envelopeId: requestEnvelope.id,
      httpStatus: response.status,
      error: reject.error,
      retryable: reject.retryable === true,
      message: `Reject ${reject.error}: ${reject.message}`,
      requestEnvelope,
      serverEnvelope,
    });
  }

  throw new TypeError("server response must be a wire Ack or Reject envelope");
}

export function buildHostConsoleStateEndpoint({
  gameId,
  principalUserId,
  slotId,
  apiBaseUrl = "",
}) {
  const params = new URLSearchParams({
    principal_user_id: requiredString(principalUserId, "principalUserId"),
  });
  if (slotId !== undefined && slotId !== null) {
    params.set("slot_id", requiredString(slotId, "slotId"));
  }
  return `${apiBaseUrl}/games/${encodeURIComponent(
    requiredString(gameId, "gameId"),
  )}/host-console-state?${params.toString()}`;
}

export function projectHostConsoleState(state, fallback) {
  if (state === null || typeof state !== "object") {
    return fallback;
  }

  const phase = state.phase ?? null;
  const slot = Array.isArray(state.slots) ? state.slots[0] : null;
  const posts = Array.isArray(state.thread_posts) ? state.thread_posts : [];
  const preservedSlotHistory =
    slot !== null && posts.some((post) => post?.author_slot === slot.slot_id);

  return Object.freeze({
    phase: Object.freeze({
      ...fallback.phase,
      id: phase?.phase_id ?? fallback.phase.id,
      deadlineLabel:
        typeof phase?.deadline === "number"
          ? formatDeadline(phase.deadline)
          : fallback.phase.deadlineLabel,
    }),
    replacement: Object.freeze({
      ...fallback.replacement,
      slotId: slot?.slot_id ?? fallback.replacement.slotId,
      occupantLabel: slot?.occupant_user_id ?? fallback.replacement.occupantLabel,
      historyLabel: preservedSlotHistory
        ? `Slot history remains attached to ${slot.slot_id}`
        : fallback.replacement.historyLabel,
    }),
  });
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function secondsSinceEpoch(isoString) {
  const milliseconds = Date.parse(isoString);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("payload.extendsTo must be an ISO timestamp");
  }
  return Math.floor(milliseconds / 1000);
}

function formatDeadline(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Los_Angeles",
  });
}

function defaultCommandId() {
  return crypto.randomUUID();
}

let nextEnvelopeId = 1;

function defaultEnvelopeId() {
  const id = nextEnvelopeId;
  nextEnvelopeId += 1;
  return id;
}
