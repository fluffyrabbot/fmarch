export const WIRE_PROTOCOL_VERSION = 1;

export function buildCommandEnvelope({
  principalUserId,
  command,
  commandId,
  envelopeId,
}) {
  return Object.freeze({
    v: WIRE_PROTOCOL_VERSION,
    id: envelopeId,
    body: Object.freeze({
      kind: "Command",
      body: Object.freeze({
        command_id: requiredString(commandId, "commandId"),
        principal_user_id: requiredString(principalUserId, "principalUserId"),
        command,
      }),
    }),
  });
}

export function buildPlayerCommand({
  action,
  game,
  channelId = "main",
  actorSlot,
  body,
  media = [],
  target,
  actionConfig = null,
}) {
  const commandKind = actionConfig?.commandKind ?? action;
  switch (commandKind) {
    case "submit_post":
      return Object.freeze({
        SubmitPost: Object.freeze({
          game: requiredString(game, "game"),
          channel_id: requiredString(channelId, "channelId"),
          actor_slot: requiredString(actorSlot, "actorSlot"),
          body: requiredString(body, "body"),
          ...(media.length > 0 ? { media } : {}),
        }),
      });
    case "submit_vote":
      return Object.freeze({
        SubmitVote: Object.freeze({
          game: requiredString(game, "game"),
          actor_slot: requiredString(actorSlot, "actorSlot"),
          target: voteTargetWire(actionConfig?.voteTarget ?? target),
        }),
      });
    case "withdraw_vote":
      return Object.freeze({
        WithdrawVote: Object.freeze({
          game: requiredString(game, "game"),
          actor_slot: requiredString(actorSlot, "actorSlot"),
        }),
      });
    case "submit_action":
    case "submit_invalid_action":
      return Object.freeze({
        SubmitAction: Object.freeze({
          game: requiredString(game, "game"),
          action_id: requiredString(
            actionConfig?.actionId ?? action,
            "actionConfig.actionId",
          ),
          actor_slot: requiredString(actorSlot, "actorSlot"),
          template_id: requiredString(
            actionConfig?.templateId,
            "actionConfig.templateId",
          ),
          targets: Object.freeze(
            normalizeTargets(actionConfig?.targets ?? actionConfig?.targetSlot),
          ),
          grant_id: actionConfig?.grantId ?? null,
        }),
      });
    default:
      throw new TypeError(`unsupported player command action: ${action}`);
  }
}

export function buildAdminCommand({
  action,
  game,
  pack = "mafiascum",
  user,
}) {
  switch (action) {
    case "create_game":
      return Object.freeze({
        CreateGame: Object.freeze({
          game: requiredString(game, "game"),
          pack: requiredString(pack, "pack"),
        }),
      });
    case "add_cohost":
      return Object.freeze({
        AddCohost: Object.freeze({
          game: requiredString(game, "game"),
          user: requiredString(user, "user"),
        }),
      });
    default:
      throw new TypeError(`unsupported admin command action: ${action}`);
  }
}

export async function sendCommand({
  principalUserId,
  command,
  endpoint = "/commands",
  fetchImpl = fetch,
  commandIdFactory = defaultCommandId,
  envelopeIdFactory = defaultEnvelopeId,
}) {
  const commandId = commandIdFactory();
  const envelopeId = envelopeIdFactory();
  const requestEnvelope = buildCommandEnvelope({
    principalUserId,
    command,
    commandId,
    envelopeId,
  });

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestEnvelope),
  });
  const serverEnvelope = await response.json();
  return normalizeCommandResponse({
    commandId,
    requestEnvelope,
    response,
    serverEnvelope,
  });
}

export function normalizeCommandResponse({
  commandId,
  requestEnvelope,
  response,
  serverEnvelope,
}) {
  const body = serverEnvelope?.body;
  if (body?.kind === "Ack") {
    const streamSeqs = body.body?.stream_seqs ?? [];
    return Object.freeze({
      state: "ack",
      commandId,
      envelopeId: requestEnvelope.id,
      httpStatus: response.status,
      streamSeqs: Object.freeze(streamSeqs),
      message: `Ack: stream seqs ${streamSeqs.join(", ")}`,
      requestEnvelope,
      serverEnvelope,
    });
  }

  if (body?.kind === "Reject") {
    const reject = body.body;
    const retryable = reject.retryable === true;
    return Object.freeze({
      state: "reject",
      commandId,
      envelopeId: requestEnvelope.id,
      httpStatus: response.status,
      error: reject.error,
      retryable,
      message: rejectMessage(reject, retryable, { requestEnvelope }),
      requestEnvelope,
      serverEnvelope,
    });
  }

  throw new TypeError("server response must be a wire Ack or Reject envelope");
}

function rejectMessage(reject, retryable, { requestEnvelope } = {}) {
  const base = `Reject ${reject.error}: ${reject.message}`;
  if (
    reject.error === "PhaseLocked" &&
    requestEnvelope?.body?.body?.command?.SubmitAction !== undefined
  ) {
    return `${base}; stale action state, refresh and use current action controls`;
  }
  if (reject.error === "PhaseLocked") {
    return `${base}; stale projection, refresh and use current controls`;
  }
  if (reject.error === "ActionAlreadySubmitted") {
    return `${base}; refresh and use current controls`;
  }
  if (
    reject.error === "InvalidTarget" &&
    requestEnvelope?.body?.body?.command?.SubmitVote !== undefined
  ) {
    return `${base}; vote target is no longer valid, refresh and use current vote controls`;
  }
  if (
    reject.error === "SlotNotAlive" &&
    requestEnvelope?.body?.body?.command?.SubmitAction !== undefined
  ) {
    return `${base}; actor is no longer alive, refresh and use current action controls`;
  }
  if (reject.error === "SlotNotAlive") {
    return `${base}; slot is no longer alive, refresh and use current controls`;
  }
  if (reject.error === "NotYourSlot") {
    return `${base}; slot ownership changed, refresh and use current role surface`;
  }
  return retryable ? `${base}; reload and retry` : base;
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function voteTargetWire(target) {
  if (target === "NoLynch") {
    return "NoLynch";
  }
  if (target?.kind === "NoLynch") {
    return "NoLynch";
  }
  const slot = target?.Slot ?? target?.slot ?? target;
  return Object.freeze({
    Slot: requiredString(slot, "target"),
  });
}

function normalizeTargets(value) {
  const targets = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  return targets.map((target, index) =>
    requiredString(target, `actionConfig.targets[${index}]`),
  );
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
