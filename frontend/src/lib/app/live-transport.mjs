import { normalizeThreadPost as normalizeProjectionThreadPost } from "./cold-load.mjs";
import { decode, encode } from "cbor-x";

export const LIVE_PROTOCOL_VERSION = 1;

export const COLD_LOAD_TRANSPORT_BOUNDARY = Object.freeze({
  status: "cold-load-refresh-only",
  protocol: "REST JSON",
  proof:
    "Live delta subscription is not connected for this surface; stores refresh from REST projections and apply server payloads after command ack.",
});

export const LIVE_TRANSPORT_BOUNDARY = Object.freeze({
  status: "cbor-ws-projection-deltas-with-resync-and-reconnect",
  protocol: "WebSocket CBOR",
  resyncPolicy: "single-flight-latest-trailing-refresh",
  proof:
    "Initial binary-CBOR WebSocket Hello plus command-following projection delta, single-flight ResyncRequired recovery with one latest trailing refresh, and reconnect refresh recovery are proven over the versioned typed CBOR boundary.",
});

export const LIVE_PROJECTION_CONNECTING_STATUS = Object.freeze({
  state: "connecting",
  message: "Connecting live updates. Actions remain safe while we reconnect.",
});

export const EMPTY_LIVE_PROJECTION_METRICS = Object.freeze({
  resyncFramesReceived: 0,
  resyncRefreshesStarted: 0,
  resyncFramesCoalesced: 0,
  resyncTrailingRefreshesStarted: 0,
});

export function buildLiveProjectionUrl({
  game,
  slotId = null,
  channel = "main",
}) {
  const params = new URLSearchParams({
    game: requiredString(game, "game"),
  });
  if (slotId !== null && slotId !== undefined) {
    params.set("slot_id", requiredString(slotId, "slotId"));
  }
  if (channel !== "main") {
    params.set("channel", requiredString(channel, "channel"));
  }
  return `/live/tickets?${params.toString()}`;
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
  if (envelope?.v !== LIVE_PROTOCOL_VERSION) {
    return null;
  }
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

export function encodeServerEnvelopeFrame(envelope) {
  return encode(envelope);
}

export async function decodeServerEnvelopeFrame(frame) {
  let bytes;
  if (frame instanceof ArrayBuffer) {
    bytes = new Uint8Array(frame);
  } else if (ArrayBuffer.isView(frame)) {
    bytes = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
  } else if (typeof Blob !== "undefined" && frame instanceof Blob) {
    bytes = new Uint8Array(await frame.arrayBuffer());
  } else {
    throw new TypeError("live websocket frames must be binary CBOR");
  }
  return decode(bytes);
}

export function projectionPatchForLiveEnvelope(envelope, previousSnapshot) {
  const message = normalizeServerEnvelopeMessage(envelope);
  if (message?.kind !== "delta") {
    return null;
  }
  if (
    message.delta.kind !== "VoteCountChanged" &&
    message.delta.kind !== "VoteCountCleared" &&
    message.delta.kind !== "ThreadPostsChanged" &&
    message.delta.kind !== "ThreadPostRemoved" &&
    message.delta.kind !== "PostCitationsChanged"
  ) {
    return null;
  }
  if (message.delta.kind === "ThreadPostsChanged") {
    return Object.freeze({
      thread: upsertThreadPosts(previousSnapshot?.thread, message.delta.body?.posts),
    });
  }
  if (message.delta.kind === "ThreadPostRemoved") {
    return Object.freeze({
      thread: removeThreadPost(previousSnapshot?.thread, message.delta.body?.source_seq),
    });
  }
  if (message.delta.kind === "PostCitationsChanged") {
    return Object.freeze({
      thread: applyPostCitations(previousSnapshot?.thread, message.delta.body),
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
  signal,
}) {
  const snapshot = await projectionStore.refresh(resyncKeys, { fetchImpl, signal });
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
  authorizationLossRefreshKeys = [],
  refreshKeysForEvent = () => [],
  onEvent = () => {},
  reconnect = true,
  reconnectDelayMs = 1000,
  recoveryTimeoutMs = 15_000,
  scheduleReconnect = (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearReconnect = (handle) => globalThis.clearTimeout(handle),
}) {
  if (typeof WebSocketCtor !== "function") {
    return null;
  }

  let socket = null;
  let stopped = false;
  let reconnectHandle = null;
  let reconnectAttempt = 0;
  let handleSocketClose = () => {};
  const metrics = { ...EMPTY_LIVE_PROJECTION_METRICS };
  const ticketEndpoint = requiredString(url, "url");

  function currentMetrics() {
    return Object.freeze({ ...metrics });
  }

  async function openSocket({ recoverOnOpen = false } = {}) {
    let socketUrl = ticketEndpoint;
    if (!ticketEndpoint.startsWith("ws://") && !ticketEndpoint.startsWith("wss://") && !ticketEndpoint.startsWith("/ws?")) {
      try {
        const ticketResponse = await fetchWithAbortTimeout({
          fetchImpl,
          input: ticketEndpoint,
          init: {
            method: "POST",
            headers: { accept: "application/json" },
          },
          timeoutMs: recoveryTimeoutMs,
          timeoutMessage: "live ticket request timed out",
        });
        if (!ticketResponse.ok) {
          if ([401, 403].includes(ticketResponse.status)) {
            const refreshKeys = normalizeRefreshKeys(
              authorizationLossRefreshKeys,
            );
            if (refreshKeys.length > 0) {
              const snapshot = await projectionStore.refresh(refreshKeys, {
                fetchImpl,
              });
              onEvent(
                Object.freeze({
                  kind: "authorization-lost",
                  status: ticketResponse.status,
                }),
                snapshot,
              );
            }
          }
          const error = new Error(
            `live ticket request failed with HTTP ${ticketResponse.status}`,
          );
          if ([429, 503].includes(ticketResponse.status)) {
            error.reconnectDelayMs = retryAfterMilliseconds({
              headers: ticketResponse.headers,
              fallbackMs:
                reconnectDelayMs * 2 ** Math.min(reconnectAttempt, 5),
            });
          }
          throw error;
        }
        const ticket = await ticketResponse.json();
        socketUrl = requiredString(ticket?.url, "ticket.url");
      } catch (error) {
        if (!stopped) {
          onEvent(Object.freeze({ kind: "error", message: error.message }), null);
          queueReconnect(error.reconnectDelayMs);
        }
        return null;
      }
    }
    if (stopped) {
      return null;
    }
    const openedSocket = new WebSocketCtor(resolveWebSocketUrl(socketUrl));
    openedSocket.binaryType = "arraybuffer";
    socket = openedSocket;
    let closeHandled = false;
    let pendingResyncMessage = null;
    let resyncRecoveryPromise = null;

    async function recoverProjection(message) {
      const controller = new AbortController();
      const timeoutHandle = globalThis.setTimeout(
        () => controller.abort(new Error("live projection recovery timed out")),
        recoveryTimeoutMs,
      );
      try {
        return await recoverLiveProjection({
          projectionStore,
          resyncKeys,
          fetchImpl,
          message,
          signal: controller.signal,
        });
      } finally {
        globalThis.clearTimeout(timeoutHandle);
      }
    }

    function invalidateSocketAfterRecoveryFailure(error) {
      if (openedSocket !== socket || stopped) {
        return;
      }
      onEvent(Object.freeze({ kind: "error", message: error.message }), null);
      handleSocketClose();
      socket = null;
      openedSocket.close();
    }

    async function queueResyncRecovery(message) {
      if (resyncRecoveryPromise !== null) {
        metrics.resyncFramesCoalesced += 1;
      }
      pendingResyncMessage = message;
      if (resyncRecoveryPromise !== null) {
        return await resyncRecoveryPromise;
      }

      resyncRecoveryPromise = (async () => {
        let refreshIndex = 0;
        while (pendingResyncMessage !== null) {
          const nextMessage = pendingResyncMessage;
          pendingResyncMessage = null;
          metrics.resyncRefreshesStarted += 1;
          if (refreshIndex > 0) {
            metrics.resyncTrailingRefreshesStarted += 1;
          }
          refreshIndex += 1;
          try {
            const recovery = await recoverProjection(nextMessage);
            if (openedSocket !== socket || stopped) {
              return;
            }
            onEvent(recovery.message, recovery.snapshot);
          } catch (error) {
            if (openedSocket !== socket || stopped) {
              return;
            }
            invalidateSocketAfterRecoveryFailure(error);
            return;
          }
        }
      })();
      try {
        return await resyncRecoveryPromise;
      } finally {
        resyncRecoveryPromise = null;
      }
    }

    handleSocketClose = () => {
      if (closeHandled) {
        return;
      }
      closeHandled = true;
      onEvent(Object.freeze({ kind: "close" }), null);
      queueReconnect();
    };
    openedSocket.addEventListener("open", async () => {
      if (openedSocket !== socket) {
        return;
      }
      if (!recoverOnOpen) {
        onEvent(Object.freeze({ kind: "open" }), projectionStore.getSnapshot());
        return;
      }
      try {
        const recovery = await recoverProjection({
          kind: "reconnect",
          attempt: reconnectAttempt,
        });
        onEvent(recovery.message, recovery.snapshot);
      } catch (error) {
        invalidateSocketAfterRecoveryFailure(error);
      }
    });
    openedSocket.addEventListener("message", async (event) => {
      if (openedSocket !== socket) {
        return;
      }
      try {
        const envelope = await decodeServerEnvelopeFrame(event.data);
        const message = normalizeServerEnvelopeMessage(envelope);
        if (message?.kind === "resync-required") {
          metrics.resyncFramesReceived += 1;
          await queueResyncRecovery(message);
          return;
        }
        let snapshot = projectionStore.applyLiveEnvelope(envelope);
        const refreshKeys = normalizeRefreshKeys(refreshKeysForEvent(message, snapshot));
        if (refreshKeys.length > 0) {
          snapshot = await projectionStore.refresh(refreshKeys, { fetchImpl });
        }
        onEvent(message, snapshot);
      } catch (error) {
        onEvent(Object.freeze({ kind: "error", message: error.message }), null);
      }
    });
    openedSocket.addEventListener("error", () => {
      if (openedSocket !== socket) {
        return;
      }
      onEvent(Object.freeze({ kind: "error", message: "websocket error" }), null);
    });
    openedSocket.addEventListener("close", () => {
      if (openedSocket !== socket) {
        return;
      }
      handleSocketClose();
    });
    return openedSocket;
  }

  function queueReconnect(delayMs = reconnectDelayMs) {
    if (stopped || reconnect !== true || reconnectHandle !== null) {
      return;
    }
    reconnectAttempt += 1;
    onEvent(
      Object.freeze({ kind: "reconnecting", attempt: reconnectAttempt }),
      projectionStore.getSnapshot(),
    );
    reconnectHandle = scheduleReconnect(() => {
      reconnectHandle = null;
      openSocket({ recoverOnOpen: true });
    }, delayMs);
  }

  void openSocket();

  return Object.freeze({
    close() {
      stopped = true;
      if (reconnectHandle !== null) {
        clearReconnect(reconnectHandle);
        reconnectHandle = null;
      }
      socket?.close();
    },
    drop() {
      const droppedSocket = socket;
      handleSocketClose();
      socket = null;
      droppedSocket?.close();
    },
    metrics: currentMetrics,
  });
}

async function fetchWithAbortTimeout({
  fetchImpl,
  input,
  init,
  timeoutMs,
  timeoutMessage,
}) {
  const controller = new AbortController();
  const timeoutHandle = globalThis.setTimeout(
    () => controller.abort(new Error(timeoutMessage)),
    timeoutMs,
  );
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeoutHandle);
  }
}

function retryAfterMilliseconds({ headers, fallbackMs }) {
  const value = headers?.get?.("retry-after")?.trim();
  if (value !== undefined && /^\d+$/.test(value)) {
    return Math.max(fallbackMs, Number(value) * 1000);
  }
  if (value !== undefined) {
    const retryAt = Date.parse(value);
    if (Number.isFinite(retryAt)) {
      return Math.max(fallbackMs, retryAt - Date.now());
    }
  }
  return fallbackMs;
}

function normalizeRefreshKeys(value) {
  if (value === undefined || value === null) {
    return Object.freeze([]);
  }
  const keys = Array.isArray(value) ? value : [value];
  return Object.freeze(keys.filter((key) => typeof key === "string" && key !== ""));
}

export function liveProjectionStatusForEvent(
  message,
  previous = LIVE_PROJECTION_CONNECTING_STATUS,
) {
  if (message?.kind === "open") {
    return Object.freeze({
      state: "connected",
      message: "Live updates connected",
    });
  }
  if (message?.kind === "hello") {
    return Object.freeze({
      state: "connected",
      message: "Live updates connected",
    });
  }
  if (message?.kind === "delta") {
    return Object.freeze({
      state: "updated",
      message: "Game updated",
    });
  }
  if (message?.kind === "resync-required" && message.state === "recovered") {
    return Object.freeze({
      state: "recovered",
      message: "Live updates restored",
    });
  }
  if (message?.kind === "reconnecting") {
    return Object.freeze({
      state: "reconnecting",
      message: "Reconnecting live updates. Actions remain safe.",
    });
  }
  if (message?.kind === "reconnect" && message.state === "recovered") {
    return Object.freeze({
      state: "recovered",
      message: "Live updates restored",
    });
  }
  if (message?.kind === "error") {
    return Object.freeze({
      state: "error",
      message: "Live updates paused. Refresh if this continues.",
    });
  }
  if (message?.kind === "close") {
    return Object.freeze({
      state: "closed",
      message: "Live updates paused. Reconnecting automatically.",
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
  if (delta?.kind === "ThreadPostRemoved") {
    return Object.freeze({
      kind: "ThreadPostRemoved",
      body: delta.body ?? {},
    });
  }
  if (delta?.kind === "PostCitationsChanged") {
    return Object.freeze({
      kind: "PostCitationsChanged",
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
  if (delta?.kind === "DayVoteOutcomeApplied") {
    return Object.freeze({
      kind: "DayVoteOutcomeApplied",
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
  if (delta?.PostCitationsChanged !== undefined) {
    return Object.freeze({
      kind: "PostCitationsChanged",
      body: delta.PostCitationsChanged,
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
  if (delta?.DayVoteOutcomeApplied !== undefined) {
    return Object.freeze({
      kind: "DayVoteOutcomeApplied",
      body: delta.DayVoteOutcomeApplied,
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
  for (const post of previousPosts) {
    if (post?.seq !== null && post?.seq !== undefined) {
      nextBySeq.set(post.seq, post);
    }
  }
  for (const post of Array.isArray(posts) ? posts : []) {
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

function applyPostCitations(previousThread, delta) {
  const previous = previousThread ?? {};
  const previousPosts = Array.isArray(previous.posts) ? previous.posts : [];
  const quotedSeq = Number(
    delta?.quoted?.source_seq ?? delta?.quoted?.sourceSeq,
  );
  const citationCount = Number(delta?.citation_count ?? delta?.citationCount);
  if (!Number.isInteger(quotedSeq) || quotedSeq < 1 || !Number.isFinite(citationCount)) {
    return previousThread;
  }
  let changed = false;
  const posts = previousPosts.map((post) => {
    if (Number(post?.seq) !== quotedSeq) {
      return post;
    }
    changed = true;
    return Object.freeze({
      ...post,
      citationCount,
    });
  });
  if (!changed) {
    return previousThread;
  }
  return Object.freeze({
    ...previous,
    posts: Object.freeze(posts),
  });
}

function removeThreadPost(previousThread, sourceSeq) {
  const previous = previousThread ?? {};
  const previousPosts = Array.isArray(previous.posts) ? previous.posts : [];
  return Object.freeze({
    ...previous,
    posts: Object.freeze(
      previousPosts.filter((post) => String(post?.seq) !== String(sourceSeq)),
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
