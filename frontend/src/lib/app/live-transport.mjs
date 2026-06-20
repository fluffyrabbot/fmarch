import { normalizeThreadPost as normalizeProjectionThreadPost } from "./cold-load.mjs";

export const COLD_LOAD_TRANSPORT_BOUNDARY = Object.freeze({
  status: "cold-load-refresh-only",
  protocol: "REST JSON",
  proof:
    "Live delta subscription is not connected for this surface; stores refresh from REST projections and apply server payloads after command ack.",
});

export const LIVE_TRANSPORT_BOUNDARY = Object.freeze({
  status: "json-ws-command-projection-deltas-with-resync",
  protocol: "WebSocket JSON",
  proof:
    "Initial WebSocket Hello plus command-following projection delta and ResyncRequired recovery frames are proven over the typed JSON websocket boundary.",
});

export const LIVE_PROJECTION_CONNECTING_STATUS = Object.freeze({
  state: "connecting",
  message: "Connecting live projection",
});

export function buildLiveProjectionUrl({
  apiBaseUrl = "",
  game,
  principalUserId,
  slotId = null,
}) {
  const params = new URLSearchParams({
    game: requiredString(game, "game"),
    principal_user_id: requiredString(principalUserId, "principalUserId"),
  });
  if (slotId !== null && slotId !== undefined) {
    params.set("slot_id", requiredString(slotId, "slotId"));
  }
  if (apiBaseUrl === "") {
    return `/ws?${params.toString()}`;
  }

  const url = new URL("/ws", apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = params.toString();
  return url.toString();
}

export function resolveWebSocketUrl(url, locationHref = globalThis.location?.href) {
  if (typeof url !== "string" || url.trim() === "") {
    throw new TypeError("websocket url must be a non-empty string");
  }
  if (url.startsWith("ws://") || url.startsWith("wss://")) {
    return url;
  }
  const base = new URL(locationHref ?? "http://127.0.0.1/");
  const resolved = new URL(url, base);
  resolved.protocol = resolved.protocol === "https:" ? "wss:" : "ws:";
  return resolved.toString();
}

export function normalizeServerEnvelopeMessage(envelope) {
  const body = envelope?.body;
  if (body?.kind === "Hello") {
    return Object.freeze({ kind: "hello", body: body.body ?? {} });
  }
  if (body?.kind === "Delta") {
    const delta = normalizeProjectionDelta(body.body);
    if (delta !== null) {
      if (delta.kind === "ResyncRequired") {
        return Object.freeze({
          kind: "resync-required",
          fromSeq: Number(delta.body?.from_seq ?? delta.body?.fromSeq ?? 0),
        });
      }
      return Object.freeze({ kind: "delta", delta });
    }
  }
  return null;
}

export function projectionPatchForLiveEnvelope(envelope, previousSnapshot) {
  const message = normalizeServerEnvelopeMessage(envelope);
  if (message?.kind !== "delta") {
    return null;
  }
  if (
    message.delta.kind !== "VoteCountChanged" &&
    message.delta.kind !== "VoteCountCleared" &&
    message.delta.kind !== "ThreadPostsChanged"
  ) {
    return null;
  }
  if (message.delta.kind === "ThreadPostsChanged") {
    return Object.freeze({
      thread: upsertThreadPosts(previousSnapshot?.thread, message.delta.body?.posts),
    });
  }
  return Object.freeze({
    votecount:
      message.delta.kind === "VoteCountCleared"
        ? clearVotecountRow(previousSnapshot?.votecount, message.delta.body)
        : upsertVotecountRow(previousSnapshot?.votecount, message.delta.body),
  });
}

export async function recoverLiveProjection({
  projectionStore,
  resyncKeys = undefined,
  fetchImpl = globalThis.fetch,
  message,
}) {
  const snapshot = await projectionStore.refresh(resyncKeys, { fetchImpl });
  return Object.freeze({
    message: Object.freeze({
      ...(message ?? { kind: "resync-required", fromSeq: 0 }),
      state: "recovered",
    }),
    snapshot,
  });
}

export function connectLiveProjection({
  url,
  projectionStore,
  WebSocketCtor = globalThis.WebSocket,
  fetchImpl = globalThis.fetch,
  resyncKeys = undefined,
  onEvent = () => {},
}) {
  if (typeof WebSocketCtor !== "function") {
    return null;
  }
  const socket = new WebSocketCtor(resolveWebSocketUrl(url));
  socket.addEventListener("open", () => {
    onEvent(Object.freeze({ kind: "open" }), projectionStore.getSnapshot());
  });
  socket.addEventListener("message", async (event) => {
    try {
      const envelope = JSON.parse(String(event.data));
      const message = normalizeServerEnvelopeMessage(envelope);
      if (message?.kind === "resync-required") {
        const recovery = await recoverLiveProjection({
          projectionStore,
          resyncKeys,
          fetchImpl,
          message,
        });
        onEvent(recovery.message, recovery.snapshot);
        return;
      }
      const snapshot = projectionStore.applyLiveEnvelope(envelope);
      onEvent(message, snapshot);
    } catch (error) {
      onEvent(Object.freeze({ kind: "error", message: error.message }), null);
    }
  });
  socket.addEventListener("error", () => {
    onEvent(Object.freeze({ kind: "error", message: "websocket error" }), null);
  });
  socket.addEventListener("close", () => {
    onEvent(Object.freeze({ kind: "close" }), null);
  });
  return Object.freeze({
    close() {
      socket.close();
    },
  });
}

export function liveProjectionStatusForEvent(
  message,
  previous = LIVE_PROJECTION_CONNECTING_STATUS,
) {
  if (message?.kind === "open") {
    return Object.freeze({
      state: "connected",
      message: "Live projection socket open",
    });
  }
  if (message?.kind === "hello") {
    return Object.freeze({
      state: "connected",
      message: "Live projection handshake received",
    });
  }
  if (message?.kind === "delta") {
    return Object.freeze({
      state: "updated",
      message: `Live projection updated: ${message.delta?.kind ?? "delta"}`,
    });
  }
  if (message?.kind === "resync-required" && message.state === "recovered") {
    return Object.freeze({
      state: "recovered",
      message: `Live projection resynced from ${message.fromSeq}`,
    });
  }
  if (message?.kind === "error") {
    return Object.freeze({
      state: "error",
      message: `Live projection error: ${message.message ?? "unknown"}`,
    });
  }
  if (message?.kind === "close") {
    return Object.freeze({
      state: "closed",
      message: "Live projection closed",
    });
  }
  return previous;
}

function normalizeProjectionDelta(delta) {
  if (delta?.kind === "VoteCountChanged") {
    return Object.freeze({
      kind: "VoteCountChanged",
      body: delta.body ?? {},
    });
  }
  if (delta?.kind === "VoteCountCleared") {
    return Object.freeze({
      kind: "VoteCountCleared",
      body: delta.body ?? {},
    });
  }
  if (delta?.kind === "ThreadPostsChanged") {
    return Object.freeze({
      kind: "ThreadPostsChanged",
      body: delta.body ?? {},
    });
  }
  if (delta?.kind === "HostConsoleStateChanged") {
    return Object.freeze({
      kind: "HostConsoleStateChanged",
      body: delta.body ?? {},
    });
  }
  if (delta?.kind === "HostPromptsChanged") {
    return Object.freeze({
      kind: "HostPromptsChanged",
      body: delta.body ?? {},
    });
  }
  if (delta?.kind === "PlayerNotificationsChanged") {
    return Object.freeze({
      kind: "PlayerNotificationsChanged",
      body: delta.body ?? {},
    });
  }
  if (delta?.kind === "PlayerInvestigationResultsChanged") {
    return Object.freeze({
      kind: "PlayerInvestigationResultsChanged",
      body: delta.body ?? {},
    });
  }
  if (delta?.kind === "ResyncRequired") {
    return Object.freeze({
      kind: "ResyncRequired",
      body: delta.body ?? {},
    });
  }
  if (delta?.VoteCountChanged !== undefined) {
    return Object.freeze({
      kind: "VoteCountChanged",
      body: delta.VoteCountChanged,
    });
  }
  if (delta?.VoteCountCleared !== undefined) {
    return Object.freeze({
      kind: "VoteCountCleared",
      body: delta.VoteCountCleared,
    });
  }
  if (delta?.ThreadPostsChanged !== undefined) {
    return Object.freeze({
      kind: "ThreadPostsChanged",
      body: delta.ThreadPostsChanged,
    });
  }
  if (delta?.HostConsoleStateChanged !== undefined) {
    return Object.freeze({
      kind: "HostConsoleStateChanged",
      body: delta.HostConsoleStateChanged,
    });
  }
  if (delta?.HostPromptsChanged !== undefined) {
    return Object.freeze({
      kind: "HostPromptsChanged",
      body: delta.HostPromptsChanged,
    });
  }
  if (delta?.PlayerNotificationsChanged !== undefined) {
    return Object.freeze({
      kind: "PlayerNotificationsChanged",
      body: delta.PlayerNotificationsChanged,
    });
  }
  if (delta?.PlayerInvestigationResultsChanged !== undefined) {
    return Object.freeze({
      kind: "PlayerInvestigationResultsChanged",
      body: delta.PlayerInvestigationResultsChanged,
    });
  }
  if (delta?.ResyncRequired !== undefined) {
    return Object.freeze({
      kind: "ResyncRequired",
      body: delta.ResyncRequired,
    });
  }
  return null;
}

function upsertVotecountRow(previousRows, delta) {
  const target = String(delta?.candidate_slot ?? delta?.candidateSlot ?? "unknown");
  const previous = Array.isArray(previousRows) ? previousRows : [];
  const existing = previous.find((row) => row.target === target);
  const nextRow = Object.freeze({
    target,
    count: Number(delta?.count ?? 0),
    needed: Number(delta?.majority ?? existing?.needed ?? 7),
  });
  const rows = previous.filter((row) => row.target !== target);
  if (nextRow.count > 0) {
    rows.push(nextRow);
  }
  return Object.freeze(rows);
}

function clearVotecountRow(previousRows, delta) {
  const target = String(delta?.candidate_slot ?? delta?.candidateSlot ?? "unknown");
  const previous = Array.isArray(previousRows) ? previousRows : [];
  return Object.freeze(previous.filter((row) => row.target !== target));
}

function upsertThreadPosts(previousThread, posts) {
  const previous = previousThread ?? {};
  const previousPosts = Array.isArray(previous.posts) ? previous.posts : [];
  const nextBySeq = new Map();
  for (const post of [...previousPosts, ...(Array.isArray(posts) ? posts : [])]) {
    const normalized = normalizeThreadPost(post);
    if (normalized.seq !== null) {
      nextBySeq.set(normalized.seq, normalized);
    }
  }
  return Object.freeze({
    ...previous,
    posts: Object.freeze(
      [...nextBySeq.values()].sort((left, right) => Number(left.seq) - Number(right.seq)),
    ),
  });
}

function normalizeThreadPost(post) {
  return normalizeProjectionThreadPost(post, { fallbackMeta: "live update" });
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}
