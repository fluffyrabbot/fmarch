import { normalizeThreadPost as normalizeProjectionThreadPost } from "./cold-load.mjs";
import { decode, encode } from "cbor-x";

export const LIVE_PROTOCOL_VERSION = 3;

export const COLD_LOAD_TRANSPORT_BOUNDARY = Object.freeze({
  status: "cold-load-refresh-only",
  protocol: "REST JSON",
  proof:
    "Live delta subscription is not connected for this surface; stores refresh from REST projections and apply server payloads after command ack.",
});

export const LIVE_TRANSPORT_BOUNDARY = Object.freeze({
  status: "cbor-ws-projection-deltas-with-resync-and-reconnect",
  protocol: "WebSocket CBOR",
  resyncPolicy: "generation-ending-reconnect-then-authoritative-refresh",
  reconnectPolicy:
    "exact-hello-plus-refresh-freshness-lease-and-exponential-backoff",
  proof:
    "Raw open remains unavailable until an exact protocol-v3 Hello and validated full refresh; generation-bound silence leases, audience-scoped deltas, generation-ending ResyncRequired recovery, exponential reconnect, and visibility/online/pageshow ticket reminting are proven over the typed CBOR boundary.",
});

export const LIVE_PROJECTION_PAGE_LIFECYCLE_EVENTS = Object.freeze([
  "visibilitychange",
  "online",
  "pageshow",
]);

export const LIVE_PROJECTION_RECONNECT_BACKOFF_CAP_EXPONENT = 5;
export const LIVE_PROJECTION_FRESHNESS_LEASE_MS = 30_000;
export const LIVE_PROJECTION_MAX_FRAME_BYTES = 1_048_576;
export const LIVE_PROJECTION_MAX_QUEUED_FRAMES = 64;

export const LIVE_PROJECTION_CONNECTING_STATUS = Object.freeze({
  state: "connecting",
  message: "Connecting live updates. Actions remain safe while we reconnect.",
});

export const EMPTY_LIVE_PROJECTION_METRICS = Object.freeze({
  resyncFramesReceived: 0,
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
  if (
    !hasExactKeys(envelope, ["v", "id", "body"]) ||
    envelope?.v !== LIVE_PROTOCOL_VERSION ||
    !Number.isSafeInteger(envelope?.id) ||
    envelope.id < 0
  ) {
    return null;
  }
  const body = envelope?.body;
  if (body?.kind === "Hello") {
    if (!isExactProtocolHello(envelope)) {
      return null;
    }
    return Object.freeze({
      kind: "hello",
      body: Object.freeze({
        protocol_v: body.body.protocol_v,
        server: body.body.server,
        caps: Object.freeze([...body.body.caps]),
        scope: normalizeWireLiveScope(body.body.scope),
      }),
    });
  }
  if (body?.kind === "Delta") {
    if (
      envelope.id < 1 ||
      !hasExactKeys(body, ["kind", "body"]) ||
      body.kind !== "Delta"
    ) {
      return null;
    }
    if (!hasExactKeys(body.body, ["audience", "delta"])) {
      return null;
    }
    const audience = normalizeLiveAudience(body.body.audience);
    const delta = normalizeProjectionDelta(body.body.delta);
    if (audience !== null && delta !== null) {
      try {
        validateLiveAudienceDeltaPayload(audience, delta);
        return Object.freeze({ kind: "delta", audience, delta });
      } catch {
        return null;
      }
    }
  }
  if (body?.kind === "ResyncRequired") {
    if (
      envelope.id < 1 ||
      !hasExactKeys(body, ["kind", "body"]) ||
      !hasExactKeys(body.body, ["scope", "audiences", "from_event_seq"]) ||
      !isNonNegativeSafeInteger(body.body.from_event_seq) ||
      !Array.isArray(body.body.audiences)
    ) {
      return null;
    }
    try {
      const scope = normalizeWireLiveScope(body.body.scope);
      const audiences = body.body.audiences.map(normalizeLiveAudience);
      if (audiences.length === 0 || audiences.some((audience) => audience === null)) {
        return null;
      }
      const fingerprints = new Set();
      for (const audience of audiences) {
        validateLiveAudienceForScope(audience, scope);
        const fingerprint = canonicalJson(audience);
        if (fingerprints.has(fingerprint)) {
          return null;
        }
        fingerprints.add(fingerprint);
      }
      return Object.freeze({
        kind: "resync-required",
        scope,
        audiences: Object.freeze(audiences),
        fromEventSeq: body.body.from_event_seq,
      });
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeWireLiveScope(value) {
  if (!hasExactKeys(value, ["game", "channel", "slot_id"])) {
    throw new TypeError("live wire scope must contain exactly game, channel, and slot_id");
  }
  const game = requiredIdentifier(value.game, "live wire scope game");
  const channel = requiredIdentifier(value.channel, "live wire scope channel");
  const slotId = value.slot_id;
  if (slotId !== null && !isIdentifier(slotId)) {
    throw new TypeError("live wire scope slot_id must be null or a non-empty string");
  }
  return Object.freeze({ game, channel, slotId });
}

export function normalizeLiveProjectionScope(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("live projection scope must be an object");
  }
  const game = requiredIdentifier(value.game, "live projection scope game");
  const channel = requiredIdentifier(
    value.channel ?? "main",
    "live projection scope channel",
  );
  const slotId = value.slotId ?? value.slot_id ?? null;
  if (slotId !== null && !isIdentifier(slotId)) {
    throw new TypeError("live projection scope slotId must be a non-empty string");
  }
  return Object.freeze({
    game,
    channel,
    slotId,
  });
}

export function liveProjectionScopeFromUrl(
  url,
  {
    expectedScope = undefined,
    locationHref = globalThis.location?.href,
  } = {},
) {
  if (expectedScope !== undefined) {
    return normalizeLiveProjectionScope(expectedScope);
  }
  const parsed = new URL(
    requiredString(url, "url"),
    locationHref ?? "http://127.0.0.1/",
  );
  return normalizeLiveProjectionScope({
    game: parsed.searchParams.get("game"),
    channel: parsed.searchParams.get("channel") ?? "main",
    slotId: parsed.searchParams.get("slot_id"),
  });
}

export function validateLiveProjectionMessageScope(message, expectedScope) {
  const scope = normalizeLiveProjectionScope(expectedScope);
  if (message?.kind === "hello") {
    assertSameLiveScope(message.body?.scope, scope, "Hello");
    validateHelloCapabilities(message.body?.caps, scope);
    return true;
  }
  if (message?.kind === "resync-required") {
    assertSameLiveScope(message.scope, scope, "resync");
    if (message.audiences.length === 0) {
      throw new TypeError("live resync must identify at least one audience");
    }
    const fingerprints = new Set();
    for (const audience of message.audiences) {
      validateLiveAudienceForScope(audience, scope);
      const fingerprint = canonicalJson(audience);
      if (fingerprints.has(fingerprint)) {
        throw new TypeError("live resync audiences must be unique");
      }
      fingerprints.add(fingerprint);
    }
    return true;
  }
  if (message?.kind !== "delta") {
    throw new TypeError("unsupported live projection message scope");
  }
  validateLiveAudienceForScope(message.audience, scope, message.delta?.kind);
  const { kind, body } = message.delta;
  const actualGame = liveDeltaGame(kind, body);
  if (actualGame !== null && actualGame !== scope.game) {
    throw new TypeError(
      `live projection delta game mismatch: expected ${scope.game}`,
    );
  }
  if (kind === "ThreadPostsChanged") {
    if (!Array.isArray(body?.posts)) {
      throw new TypeError("live thread projection posts must be an array");
    }
    for (const post of body.posts) {
      if (String(post?.game ?? "") !== scope.game) {
        throw new TypeError("live thread post game does not match connection scope");
      }
      if (String(post?.channel_id ?? post?.channelId ?? "") !== scope.channel) {
        throw new TypeError("live thread post channel does not match connection scope");
      }
    }
  }
  if (
    (kind === "PlayerNotificationsChanged" ||
      kind === "PlayerInvestigationResultsChanged" ||
      kind === "SlotMentionsChanged") &&
    scope.slotId !== null
  ) {
    const rows = kind === "PlayerNotificationsChanged"
      ? body?.notifications
      : kind === "SlotMentionsChanged"
        ? body?.mentions
        : body?.results;
    if (!Array.isArray(rows)) {
      throw new TypeError("live player-private projection rows must be an array");
    }
    for (const row of rows) {
      if (String(row?.audience_slot ?? row?.audienceSlot ?? "") !== scope.slotId) {
        throw new TypeError(
          "live player-private projection audience does not match connection scope",
        );
      }
    }
  }
  return true;
}

function assertSameLiveScope(actual, expected, label) {
  if (
    actual?.game !== expected.game ||
    actual?.channel !== expected.channel ||
    actual?.slotId !== expected.slotId
  ) {
    throw new TypeError(`live ${label} scope does not match the ticket scope`);
  }
}

const LIVE_AUDIENCE_DELTA_KINDS = Object.freeze({
  Game: new Set(["VoteCountChanged", "VoteCountCleared", "DayVoteOutcomeApplied"]),
  Thread: new Set([
    "ThreadPostsChanged",
    "ThreadPostRemoved",
    "PostCitationsChanged",
  ]),
  Host: new Set([
    "HostConsoleStateChanged",
    "HostConsoleHeaderChanged",
    "HostConsoleSlotsChanged",
    "HostConsoleThreadPostsChanged",
    "HostConsoleThreadPostRemoved",
    "HostConsoleDayEventsChanged",
    "HostConsoleSchedulerChanged",
    "HostConsoleTasksChanged",
    "HostPromptsChanged",
  ]),
  PlayerSlot: new Set([
    "PlayerNotificationsChanged",
    "PlayerInvestigationResultsChanged",
    "SlotMentionsChanged",
  ]),
});

function normalizeLiveAudience(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const variants = Object.keys(value);
  if (variants.length !== 1 || LIVE_AUDIENCE_DELTA_KINDS[variants[0]] === undefined) {
    return null;
  }
  const kind = variants[0];
  const body = value[kind];
  const fields = kind === "Thread"
    ? ["game", "channel"]
    : kind === "PlayerSlot"
      ? ["game", "slot_id"]
      : ["game"];
  if (!hasExactKeys(body, fields) || !fields.every((field) => isIdentifier(body[field]))) {
    return null;
  }
  const normalizedBody = { game: body.game };
  if (kind === "Thread") normalizedBody.channel = body.channel;
  if (kind === "PlayerSlot") normalizedBody.slotId = body.slot_id;
  return Object.freeze({ kind, ...normalizedBody });
}

function validateLiveAudienceForScope(audience, scope, deltaKind = undefined) {
  if (audience === null || LIVE_AUDIENCE_DELTA_KINDS[audience?.kind] === undefined) {
    throw new TypeError("live message has an unsupported audience");
  }
  if (audience.game !== scope.game) {
    throw new TypeError("live audience game does not match connection scope");
  }
  if (audience.kind === "Thread" && audience.channel !== scope.channel) {
    throw new TypeError("live thread audience does not match connection channel");
  }
  if (audience.kind === "PlayerSlot" && audience.slotId !== scope.slotId) {
    throw new TypeError("live player audience does not match connection slot");
  }
  if (deltaKind !== undefined && !LIVE_AUDIENCE_DELTA_KINDS[audience.kind].has(deltaKind)) {
    throw new TypeError(`live ${deltaKind} delta is invalid for ${audience.kind} audience`);
  }
}

function validateLiveAudienceDeltaPayload(audience, delta) {
  if (!LIVE_AUDIENCE_DELTA_KINDS[audience.kind]?.has(delta.kind)) {
    throw new TypeError(`live ${delta.kind} delta is invalid for ${audience.kind} audience`);
  }
  const payloadGame = liveDeltaGame(delta.kind, delta.body);
  if (payloadGame !== audience.game) {
    throw new TypeError("live delta payload game does not match its audience");
  }
  if (audience.kind === "Thread" && delta.kind === "ThreadPostsChanged") {
    if (delta.body.posts.some((post) => post.channel_id !== audience.channel)) {
      throw new TypeError("live thread delta rows do not match their audience channel");
    }
  }
  if (
    audience.kind === "Thread" &&
    (delta.kind === "ThreadPostRemoved" || delta.kind === "PostCitationsChanged") &&
    delta.body.channel !== audience.channel
  ) {
    throw new TypeError("live thread delta does not match its audience channel");
  }
  if (audience.kind === "PlayerSlot") {
    const rows = delta.kind === "PlayerNotificationsChanged"
      ? delta.body.notifications
      : delta.kind === "SlotMentionsChanged"
        ? delta.body.mentions
        : delta.body.results;
    if (rows.some((row) => row.audience_slot !== audience.slotId)) {
      throw new TypeError("live player delta rows do not match their audience slot");
    }
  }
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
    if (frame.size > LIVE_PROJECTION_MAX_FRAME_BYTES) {
      throw new TypeError("live websocket frame exceeds the maximum byte length");
    }
    bytes = new Uint8Array(await frame.arrayBuffer());
  } else {
    throw new TypeError("live websocket frames must be binary CBOR");
  }
  if (bytes.byteLength > LIVE_PROJECTION_MAX_FRAME_BYTES) {
    throw new TypeError("live websocket frame exceeds the maximum byte length");
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
      thread: removeThreadPost(
        previousSnapshot?.thread,
        message.delta.body?.source_seq,
        message.delta.body?.channel,
      ),
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

export async function recoverAuthoritativeProjection({
  projectionStore,
  resyncKeys = undefined,
  fetchImpl = globalThis.fetch,
  message,
  signal,
}) {
  if (message?.kind !== "hello" && message?.kind !== "reconnect") {
    throw new TypeError(
      "authoritative live recovery requires a Hello or reconnect generation",
    );
  }
  const snapshot = await projectionStore.refresh(resyncKeys, { fetchImpl, signal });
  return Object.freeze({
    message: Object.freeze({
      ...message,
      state: "recovered",
    }),
    snapshot,
  });
}

export function liveProjectionReconnectDelayMs(
  attempt,
  baseMs,
  capExponent = LIVE_PROJECTION_RECONNECT_BACKOFF_CAP_EXPONENT,
) {
  if (!Number.isFinite(baseMs) || baseMs < 0) {
    throw new TypeError("reconnect base delay must be a non-negative number");
  }
  const exponent = Math.min(Math.max(0, Number(attempt) || 0), capExponent);
  return baseMs * 2 ** exponent;
}

export function shouldWakeLiveProjection(
  eventType,
  { visibilityState = "visible", persisted = false } = {},
) {
  if (eventType === "online") {
    return true;
  }
  if (eventType === "pageshow") {
    return persisted === true;
  }
  if (eventType === "visibilitychange") {
    return visibilityState !== "hidden";
  }
  return false;
}

export function attachLiveProjectionPageLifecycle({
  connection,
  target = globalThis,
  documentRef = target?.document ?? target,
} = {}) {
  if (
    connection === null ||
    connection === undefined ||
    typeof connection.reconnectNow !== "function"
  ) {
    return null;
  }
  if (
    typeof target?.addEventListener !== "function" ||
    typeof target?.removeEventListener !== "function"
  ) {
    return null;
  }
  const visibilityTarget =
    documentRef !== undefined &&
    documentRef !== null &&
    typeof documentRef.addEventListener === "function"
      ? documentRef
      : target;

  function wake(eventType, event) {
    if (
      !shouldWakeLiveProjection(eventType, {
        visibilityState: visibilityTarget?.visibilityState,
        persisted: event?.persisted === true,
      })
    ) {
      return false;
    }
    return connection.reconnectNow({ reason: eventType });
  }

  function onVisibility(event) {
    wake("visibilitychange", event);
  }
  function onOnline(event) {
    wake("online", event);
  }
  function onPageShow(event) {
    wake("pageshow", event);
  }

  visibilityTarget.addEventListener("visibilitychange", onVisibility);
  target.addEventListener("online", onOnline);
  target.addEventListener("pageshow", onPageShow);

  return Object.freeze({
    detach() {
      visibilityTarget.removeEventListener("visibilitychange", onVisibility);
      target.removeEventListener("online", onOnline);
      target.removeEventListener("pageshow", onPageShow);
    },
    wake,
  });
}

export function connectLiveProjection({
  url,
  projectionStore,
  WebSocketCtor = globalThis.WebSocket,
  fetchImpl = globalThis.fetch,
  resyncKeys = undefined,
  refreshKeysForEvent = () => [],
  onEvent = () => {},
  reconnect = true,
  reconnectDelayMs = 1000,
  recoveryTimeoutMs = 15_000,
  freshnessLeaseMs = LIVE_PROJECTION_FRESHNESS_LEASE_MS,
  expectedScope = undefined,
  scheduleReconnect = (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearReconnect = (handle) => globalThis.clearTimeout(handle),
  scheduleHandshakeTimeout = (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs),
  clearHandshakeTimeout = (handle) => globalThis.clearTimeout(handle),
  scheduleFreshnessLease = (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs),
  clearFreshnessLease = (handle) => globalThis.clearTimeout(handle),
}) {
  const emitEvent = (message, snapshot) => {
    try {
      onEvent(message, snapshot);
    } catch {
      // Consumer presentation failures never own transport cleanup or authority.
    }
  };
  let socket = null;
  let stopped = false;
  let reconnectHandle = null;
  let reconnectAttempt = 0;
  let handleSocketClose = () => {};
  let clearSocketHandshake = () => {};
  let establishment = null;
  let nextEstablishmentGeneration = 0;
  const metrics = { ...EMPTY_LIVE_PROJECTION_METRICS };
  const ticketEndpoint = requiredString(url, "url");
  let liveScope = null;
  let liveScopeError = null;
  try {
    liveScope = liveProjectionScopeFromUrl(ticketEndpoint, { expectedScope });
  } catch (error) {
    liveScopeError = error;
  }
  if (!Number.isFinite(freshnessLeaseMs) || freshnessLeaseMs <= 0) {
    liveScopeError = new TypeError(
      "live projection freshness lease must be a positive number",
    );
  }

  function currentMetrics() {
    return Object.freeze({ ...metrics });
  }

  function markConnectionHealthy() {
    reconnectAttempt = 0;
  }

  function invalidateProjection(reason) {
    if (stopped || typeof projectionStore.invalidate !== "function") {
      return;
    }
    projectionStore.invalidate(resyncKeys, { reason });
  }

  function cancelScheduledReconnect() {
    if (reconnectHandle === null) {
      return;
    }
    clearReconnect(reconnectHandle);
    reconnectHandle = null;
  }

  function beginEstablishment() {
    const controller = new AbortController();
    let rejectDeadline = () => {};
    const deadline = new Promise((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const generation = ++nextEstablishmentGeneration;
    const timeoutError = new Error("live ticket request timed out");
    const timeoutHandle = globalThis.setTimeout(() => {
      if (establishment?.generation !== generation) {
        return;
      }
      controller.abort(timeoutError);
      rejectDeadline(timeoutError);
    }, recoveryTimeoutMs);
    timeoutHandle?.unref?.();
    establishment = {
      generation,
      controller,
      deadline,
      rejectDeadline,
      timeoutHandle,
    };
    return establishment;
  }

  function isCurrentEstablishment(candidate) {
    return establishment === candidate && stopped !== true;
  }

  function finishEstablishment(candidate) {
    if (establishment !== candidate) {
      return;
    }
    globalThis.clearTimeout(candidate.timeoutHandle);
    establishment = null;
  }

  function retireEstablishment(reason) {
    const retired = establishment;
    if (retired === null) {
      return null;
    }
    establishment = null;
    globalThis.clearTimeout(retired.timeoutHandle);
    const error = reason instanceof Error ? reason : new Error(String(reason));
    retired.controller.abort(error);
    retired.rejectDeadline(error);
    return retired;
  }

  function abandonSocket() {
    const droppedSocket = socket;
    clearSocketHandshake();
    clearSocketHandshake = () => {};
    handleSocketClose = () => {};
    socket = null;
    droppedSocket?.close();
  }

  function retireCurrentSocket({
    expectedSocket = socket,
    notifyClose,
    closeSocket,
  }) {
    const retiredSocket = socket;
    if (retiredSocket === null || retiredSocket !== expectedSocket) {
      return null;
    }
    const notify = handleSocketClose;
    clearSocketHandshake();
    clearSocketHandshake = () => {};
    handleSocketClose = () => {};
    socket = null;
    if (notifyClose === true) {
      notify();
    }
    if (closeSocket === true) {
      retiredSocket.close();
    }
    return retiredSocket;
  }

  function reportEstablishmentFailure(error, reason) {
    if (stopped) {
      return;
    }
    invalidateProjection(reason);
    emitEvent(Object.freeze({ kind: "error", message: errorMessage(error) }), null);
    queueReconnect(error?.reconnectDelayMs);
  }

  async function openSocket({ recoverOnOpen = false } = {}) {
    if (establishment !== null) {
      return null;
    }
    const generation = beginEstablishment();
    try {
      return await Promise.race([
        openSocketBody({ recoverOnOpen, generation }),
        generation.deadline,
      ]);
    } catch (error) {
      if (isCurrentEstablishment(generation)) {
        reportEstablishmentFailure(
          error,
          error?.liveProjectionReason ?? "live_connection_establishment_failed",
        );
      }
      return null;
    } finally {
      finishEstablishment(generation);
    }
  }

  async function openSocketBody({ recoverOnOpen = false, generation }) {
    if (liveScopeError !== null) {
      reportEstablishmentFailure(
        liveScopeError,
        "live_projection_scope_unavailable",
      );
      return null;
    }
    if (typeof WebSocketCtor !== "function") {
      reportEstablishmentFailure(
        new TypeError("live websocket constructor is unavailable"),
        "live_websocket_unavailable",
      );
      return null;
    }
    let socketUrl = ticketEndpoint;
    if (!ticketEndpoint.startsWith("ws://") && !ticketEndpoint.startsWith("wss://") && !ticketEndpoint.startsWith("/ws?")) {
      try {
        const ticketResponse = await fetchImpl(ticketEndpoint, {
            method: "POST",
            headers: { accept: "application/json" },
            signal: generation.controller.signal,
        });
        if (!ticketResponse.ok) {
          if ([401, 403].includes(ticketResponse.status)) {
            const snapshot = typeof projectionStore.revokeAuthority === "function"
              ? projectionStore.revokeAuthority({
                  reason: "live_ticket_authorization_lost",
                  status: ticketResponse.status,
                })
              : null;
            invalidateProjection("live_ticket_authorization_lost");
            emitEvent(
              Object.freeze({
                kind: "authorization-lost",
                status: ticketResponse.status,
              }),
              snapshot,
            );
          }
          const error = new Error(
            `live ticket request failed with HTTP ${ticketResponse.status}`,
          );
          if ([429, 503].includes(ticketResponse.status)) {
            error.reconnectDelayMs = retryAfterMilliseconds({
              headers: ticketResponse.headers,
              fallbackMs: liveProjectionReconnectDelayMs(
                reconnectAttempt,
                reconnectDelayMs,
              ),
            });
          }
          throw error;
        }
        const ticket = await ticketResponse.json();
        socketUrl = requiredString(ticket?.url, "ticket.url");
      } catch (error) {
        const ticketError = error instanceof Error ? error : new Error(String(error));
        ticketError.liveProjectionReason = "live_ticket_unavailable";
        throw ticketError;
      }
    }
    if (!isCurrentEstablishment(generation)) {
      return null;
    }
    let openedSocket;
    try {
      openedSocket = new WebSocketCtor(resolveWebSocketUrl(socketUrl));
      openedSocket.binaryType = "arraybuffer";
    } catch (error) {
      reportEstablishmentFailure(error, "live_websocket_unavailable");
      return null;
    }
    socket = openedSocket;
    finishEstablishment(generation);
    let closeHandled = false;
    let socketOpened = false;
    let socketReady = false;
    let acceptedHelloFingerprint = null;
    let acceptedAudienceEntitlements = null;
    let messageHandling = Promise.resolve();
    let queuedFrameCount = 0;
    let lastDataEnvelopeId = 0;
    let freshnessLeaseHandle = null;
    const dependentRefreshController = new AbortController();
    let freshnessLeaseGeneration = 0;
    let handshakeTimeoutHandle = scheduleHandshakeTimeout(() => {
      if (acceptedHelloFingerprint !== null) {
        return;
      }
      invalidateSocketAfterRecoveryFailure(
        new Error("live websocket protocol-v3 Hello timed out"),
        "live_websocket_handshake_timeout",
      );
    }, recoveryTimeoutMs);
    handshakeTimeoutHandle?.unref?.();

    function clearHandshakeDeadline() {
      if (handshakeTimeoutHandle === null) {
        return;
      }
      clearHandshakeTimeout(handshakeTimeoutHandle);
      handshakeTimeoutHandle = null;
    }

    function clearFreshnessDeadline() {
      freshnessLeaseGeneration += 1;
      if (freshnessLeaseHandle === null) {
        return;
      }
      clearFreshnessLease(freshnessLeaseHandle);
      freshnessLeaseHandle = null;
    }

    function clearSocketDeadlines() {
      clearHandshakeDeadline();
      clearFreshnessDeadline();
      dependentRefreshController.abort(new Error("live socket generation retired"));
    }

    function renewFreshnessLease() {
      if (openedSocket !== socket || stopped || socketReady !== true) {
        return;
      }
      clearFreshnessDeadline();
      const leaseGeneration = freshnessLeaseGeneration;
      freshnessLeaseHandle = scheduleFreshnessLease(() => {
        if (leaseGeneration !== freshnessLeaseGeneration) {
          return;
        }
        invalidateSocketAfterRecoveryFailure(
          new Error("live projection freshness lease expired"),
          "live_projection_freshness_expired",
        );
      }, freshnessLeaseMs);
      freshnessLeaseHandle?.unref?.();
    }
    clearSocketHandshake = clearSocketDeadlines;

    async function recoverProjection(message) {
      const controller = new AbortController();
      const timeoutHandle = globalThis.setTimeout(
        () => controller.abort(new Error("live projection recovery timed out")),
        recoveryTimeoutMs,
      );
      try {
        return await recoverAuthoritativeProjection({
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

    function invalidateSocketAfterRecoveryFailure(
      error,
      reason = "live_projection_recovery_failed",
    ) {
      if (openedSocket !== socket || stopped) {
        return;
      }
      socketReady = false;
      invalidateProjection(reason);
      emitEvent(Object.freeze({ kind: "error", message: errorMessage(error) }), null);
      retireCurrentSocket({
        expectedSocket: openedSocket,
        notifyClose: true,
        closeSocket: true,
      });
    }

    handleSocketClose = (event = {}) => {
      if (closeHandled) {
        return;
      }
      closeHandled = true;
      if (typeof projectionStore.revokeAuthority === "function") {
        projectionStore.revokeAuthority({ reason: "live_connection_closed" });
      }
      invalidateProjection("live_connection_closed");
      const reconnectEvent = queueReconnect(undefined, { emit: false });
      const closeEvent = {
        kind: "close",
      };
      if (Number.isSafeInteger(event?.code)) closeEvent.code = event.code;
      if (typeof event?.reason === "string" && event.reason !== "") {
        closeEvent.reason = event.reason;
      }
      emitEvent(Object.freeze(closeEvent), null);
      if (reconnectEvent !== null) {
        emitEvent(reconnectEvent, projectionStore.getSnapshot());
      }
    };
    openedSocket.addEventListener("open", () => {
      if (openedSocket !== socket || stopped) {
        return;
      }
      socketOpened = true;
    });
    async function handleSocketMessage(event) {
      if (openedSocket !== socket) {
        return;
      }
      try {
        const envelope = await decodeServerEnvelopeFrame(event.data);
        if (openedSocket !== socket || stopped) {
          return;
        }
        const message = normalizeServerEnvelopeMessage(envelope);
        if (message === null) {
          throw new TypeError("unsupported live projection frame");
        }
        if (message.kind !== "hello") {
          if (envelope.id !== lastDataEnvelopeId + 1) {
            throw new TypeError(
              `live projection envelope id ${String(envelope.id)} is not contiguous after ${String(lastDataEnvelopeId)}`,
            );
          }
          lastDataEnvelopeId = envelope.id;
        }
        if (!socketReady) {
          if (socketOpened !== true) {
            throw new TypeError(
              "live websocket received a frame before the socket opened",
            );
          }
          if (message.kind !== "hello") {
            throw new TypeError(
              "live websocket first frame must be an exact protocol-v3 Hello",
            );
          }
          validateLiveProjectionMessageScope(message, liveScope);
          acceptedAudienceEntitlements = deriveLiveAudienceEntitlements(
            message.body.caps,
            message.body.scope,
          );
          acceptedHelloFingerprint = canonicalHelloFingerprint(message.body);
          clearHandshakeDeadline();
          const recoveryContext = recoverOnOpen
            ? { kind: "reconnect", attempt: reconnectAttempt }
            : message;
          let recovery;
          try {
            recovery = await recoverProjection(recoveryContext);
          } catch (error) {
            invalidateSocketAfterRecoveryFailure(error);
            return;
          }
          if (openedSocket !== socket || stopped) {
            return;
          }
          socketReady = true;
          markConnectionHealthy();
          renewFreshnessLease();
          emitEvent(
            recoverOnOpen
              ? recovery.message
              : Object.freeze({ ...message, state: "recovered" }),
            recovery.snapshot,
          );
          return;
        }
        validateLiveProjectionMessageScope(message, liveScope);
        validateMessageAudienceEntitlement(message, acceptedAudienceEntitlements, liveScope);
        if (message.kind === "hello") {
          if (canonicalHelloFingerprint(message.body) !== acceptedHelloFingerprint) {
            throw new TypeError(
              "live heartbeat Hello differs from the accepted handshake",
            );
          }
          renewFreshnessLease();
          emitEvent(message, projectionStore.getSnapshot());
          return;
        }
        if (message.kind === "resync-required") {
          metrics.resyncFramesReceived += 1;
          invalidateProjection("live_resync_required");
          const notify = handleSocketClose;
          retireCurrentSocket({
            expectedSocket: openedSocket,
            notifyClose: false,
            closeSocket: true,
          });
          emitEvent(Object.freeze({ ...message, state: "reconnecting" }), null);
          notify({ code: 4001, reason: "resync-required" });
          return;
        }
        let snapshot = projectionStore.applyLiveEnvelope(envelope, {
          expectedScope: liveScope,
        });
        const refreshKeys = normalizeRefreshKeys(refreshKeysForEvent(message, snapshot));
        if (refreshKeys.length > 0) {
          const refreshTimeout = globalThis.setTimeout(
            () => dependentRefreshController.abort(
              new Error("dependent live projection refresh timed out"),
            ),
            recoveryTimeoutMs,
          );
          refreshTimeout?.unref?.();
          try {
            snapshot = await projectionStore.refresh(refreshKeys, {
              fetchImpl,
              signal: dependentRefreshController.signal,
            });
          } finally {
            globalThis.clearTimeout(refreshTimeout);
          }
        }
        if (openedSocket !== socket || stopped) {
          return;
        }
        markConnectionHealthy();
        renewFreshnessLease();
        emitEvent(message, snapshot);
      } catch (error) {
        invalidateSocketAfterRecoveryFailure(
          error,
          socketReady
            ? "live_projection_recovery_failed"
            : "live_protocol_handshake_failed",
        );
      }
    }
    openedSocket.addEventListener("message", (event) => {
      if (queuedFrameCount >= LIVE_PROJECTION_MAX_QUEUED_FRAMES) {
        invalidateSocketAfterRecoveryFailure(
          new Error("live websocket frame queue exceeded its generation bound"),
          "live_projection_queue_overflow",
        );
        return;
      }
      queuedFrameCount += 1;
      const handled = messageHandling.then(() => handleSocketMessage(event));
      messageHandling = handled
        .finally(() => {
          queuedFrameCount -= 1;
        })
        .catch(() => {});
      return handled;
    });
    openedSocket.addEventListener("error", () => {
      if (openedSocket !== socket) {
        return;
      }
      invalidateSocketAfterRecoveryFailure(new Error("websocket error"));
    });
    openedSocket.addEventListener("close", (event) => {
      if (openedSocket !== socket) {
        return;
      }
      socketReady = false;
      const notify = handleSocketClose;
      retireCurrentSocket({
        expectedSocket: openedSocket,
        notifyClose: false,
        closeSocket: false,
      });
      notify(event);
    });
    return openedSocket;
  }

  function queueReconnect(delayMs, { emit = true } = {}) {
    if (stopped || reconnect !== true || reconnectHandle !== null) {
      return null;
    }
    const delay = Number.isFinite(delayMs)
      ? delayMs
      : liveProjectionReconnectDelayMs(reconnectAttempt, reconnectDelayMs);
    reconnectAttempt += 1;
    const event = Object.freeze({
      kind: "reconnecting",
      attempt: reconnectAttempt,
      reason: "close",
    });
    reconnectHandle = scheduleReconnect(() => {
      reconnectHandle = null;
      void openSocket({ recoverOnOpen: true });
    }, delay);
    if (emit) emitEvent(event, projectionStore.getSnapshot());
    return event;
  }

  function reconnectNow({ reason = "wake" } = {}) {
    if (stopped || reconnect !== true) {
      return false;
    }
    cancelScheduledReconnect();
    if (typeof projectionStore.revokeAuthority === "function") {
      projectionStore.revokeAuthority({
        reason: `live_reconnect_${reason}`,
      });
    }
    invalidateProjection(`live_reconnect_${reason}`);
    retireEstablishment(new Error(`live reconnect requested: ${reason}`));
    abandonSocket();
    emitEvent(
      Object.freeze({
        kind: "reconnecting",
        attempt: Math.max(reconnectAttempt, 1),
        reason,
      }),
      projectionStore.getSnapshot(),
    );
    void openSocket({ recoverOnOpen: true });
    return true;
  }

  invalidateProjection("live_connection_establishing");
  void openSocket();

  return Object.freeze({
    close() {
      invalidateProjection("live_connection_disposed");
      stopped = true;
      cancelScheduledReconnect();
      retireEstablishment(new Error("live connection disposed"));
      retireCurrentSocket({ notifyClose: true, closeSocket: true });
    },
    drop() {
      retireCurrentSocket({ notifyClose: true, closeSocket: true });
    },
    reconnectNow,
    metrics: currentMetrics,
  });
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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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
  if (!hasExactKeys(delta, ["kind", "body"])) {
    return null;
  }
  const validator = LIVE_DELTA_BODY_VALIDATORS[delta.kind];
  if (typeof validator !== "function" || validator(delta.body) !== true) {
    return null;
  }
  return Object.freeze({ kind: delta.kind, body: delta.body });
}

const LIVE_DELTA_BODY_VALIDATORS = Object.freeze({
  VoteCountChanged: (body) =>
    hasExactKeys(body, ["game", "phase_id", "candidate_slot", "count"]) &&
    isIdentifier(body.game) &&
    isIdentifier(body.phase_id) &&
    isIdentifier(body.candidate_slot) &&
    isNonNegativeSafeInteger(body.count),
  VoteCountCleared: (body) =>
    hasExactKeys(body, ["game", "phase_id", "candidate_slot"]) &&
    isIdentifier(body.game) &&
    isIdentifier(body.phase_id) &&
    isIdentifier(body.candidate_slot),
  ThreadPostsChanged: (body) =>
    hasExactKeys(body, ["game", "posts"]) &&
    isIdentifier(body.game) &&
    Array.isArray(body.posts) &&
    body.posts.every(isCanonicalThreadPost),
  ThreadPostRemoved: (body) =>
    hasExactKeys(body, ["game", "channel", "source_seq"]) &&
    isIdentifier(body.game) &&
    isIdentifier(body.channel) &&
    isPositiveSafeInteger(body.source_seq),
  PostCitationsChanged: (body) =>
    hasExactKeys(body, ["quoted", "channel", "citation_count"]) &&
    isCanonicalPostRef(body.quoted) &&
    isIdentifier(body.channel) &&
    body.quoted.kind === "game_post" &&
    isNonNegativeSafeInteger(body.citation_count),
  HostConsoleStateChanged: (body) =>
    hasExactKeys(body, [
      "game",
      "authority",
      "completed",
      "phase",
      "slots",
      "thread_posts",
      "day_event_scheduler",
      "day_events",
      "tasks",
    ]) &&
    isIdentifier(body.game) &&
    isCanonicalHostAuthority(body.authority) &&
    typeof body.completed === "boolean" &&
    isCanonicalHostPhase(body.phase) &&
    Array.isArray(body.slots) &&
    body.slots.every(isCanonicalHostSlot) &&
    Array.isArray(body.thread_posts) &&
    body.thread_posts.every(isCanonicalHostThreadPost) &&
    isCanonicalScheduler(body.day_event_scheduler) &&
    isPlainRecordArray(body.day_events) &&
    isPlainRecordArray(body.tasks),
  HostConsoleHeaderChanged: (body) =>
    hasExactKeys(body, ["game", "authority", "completed", "phase"]) &&
    isIdentifier(body.game) &&
    isCanonicalHostAuthority(body.authority) &&
    typeof body.completed === "boolean" &&
    isCanonicalHostPhase(body.phase),
  HostConsoleSlotsChanged: (body) =>
    hasExactKeys(body, ["game", "slots", "removed_slot_ids"]) &&
    isIdentifier(body.game) &&
    Array.isArray(body.slots) &&
    body.slots.every(isCanonicalHostSlot) &&
    isIdentifierArray(body.removed_slot_ids),
  HostConsoleThreadPostsChanged: (body) =>
    hasExactKeys(body, ["game", "posts"]) &&
    isIdentifier(body.game) &&
    Array.isArray(body.posts) &&
    body.posts.every(isCanonicalHostThreadPost),
  HostConsoleThreadPostRemoved: (body) =>
    hasExactKeys(body, ["game", "stream_seq"]) &&
    isIdentifier(body.game) &&
    isPositiveSafeInteger(body.stream_seq),
  HostConsoleDayEventsChanged: (body) =>
    hasExactKeys(body, ["game", "day_events", "removed_event_ids"]) &&
    isIdentifier(body.game) &&
    isPlainRecordArray(body.day_events) &&
    isIdentifierArray(body.removed_event_ids),
  HostConsoleSchedulerChanged: (body) =>
    hasExactKeys(body, ["game", "day_event_scheduler"]) &&
    isIdentifier(body.game) &&
    isCanonicalScheduler(body.day_event_scheduler),
  HostConsoleTasksChanged: (body) =>
    hasExactKeys(body, ["game", "tasks"]) &&
    isIdentifier(body.game) &&
    isPlainRecordArray(body.tasks),
  HostPromptsChanged: (body) =>
    hasExactKeys(body, ["game", "prompts"]) &&
    isIdentifier(body.game) &&
    isPlainRecordArray(body.prompts),
  PlayerNotificationsChanged: (body) =>
    hasExactKeys(body, ["game", "notifications"]) &&
    isIdentifier(body.game) &&
    Array.isArray(body.notifications) &&
    body.notifications.every(isCanonicalPlayerNotification),
  PlayerInvestigationResultsChanged: (body) =>
    hasExactKeys(body, ["game", "results"]) &&
    isIdentifier(body.game) &&
    Array.isArray(body.results) &&
    body.results.every(isCanonicalInvestigationResult),
  SlotMentionsChanged: (body) =>
    hasExactKeys(body, ["game", "mentions"]) &&
    isIdentifier(body.game) &&
    Array.isArray(body.mentions) &&
    body.mentions.every(isCanonicalSlotMention),
  DayVoteOutcomeApplied: isCanonicalDayVoteOutcome,
});

function isCanonicalThreadPost(post) {
  if (
    !hasExactKeys(
      post,
      [
        "game",
        "source_seq",
        "stream_seq",
        "channel_id",
        "author",
        "phase_id",
        "body",
        "media",
        "quotations",
        "citation_count",
        "occurred_at",
      ],
      ["embed"],
    ) ||
    !isIdentifier(post.game) ||
    !isPositiveSafeInteger(post.source_seq) ||
    !isPositiveSafeInteger(post.stream_seq) ||
    !isIdentifier(post.channel_id) ||
    !isCanonicalGameThreadAuthor(post.author) ||
    !isNullableIdentifier(post.phase_id) ||
    typeof post.body !== "string" ||
    !Array.isArray(post.media) ||
    !post.media.every(isCanonicalThreadPostMedia) ||
    !Array.isArray(post.quotations) ||
    !post.quotations.every(isCanonicalQuotation) ||
    !isNonNegativeSafeInteger(post.citation_count) ||
    !isNonNegativeSafeInteger(post.occurred_at)
  ) {
    return false;
  }
  return post.embed === undefined || isCanonicalPostEmbed(post.embed);
}

function isCanonicalGameThreadAuthor(author) {
  if (author?.kind === "slot") {
    return hasExactKeys(author, ["kind", "slot_id"]) && isIdentifier(author.slot_id);
  }
  return (
    (author?.kind === "host_narrator" || author?.kind === "system") &&
    hasExactKeys(author, ["kind"])
  );
}

function isCanonicalThreadPostMedia(media) {
  return (
    hasExactKeys(media, ["content_id", "alt", "variants"]) &&
    isIdentifier(media.content_id) &&
    typeof media.alt === "string" &&
    isPlainRecord(media.variants) &&
    Object.values(media.variants).every((variant) =>
      hasExactKeys(variant, ["avif_url", "webp_url", "width", "height"]) &&
      isIdentifier(variant.avif_url) &&
      isIdentifier(variant.webp_url) &&
      isPositiveSafeInteger(variant.width) &&
      isPositiveSafeInteger(variant.height)
    )
  );
}

function isCanonicalQuotation(quotation) {
  return (
    hasExactKeys(quotation, ["target", "excerpt"]) &&
    isCanonicalPostRef(quotation.target) &&
    typeof quotation.excerpt === "string"
  );
}

function isCanonicalPostRef(reference) {
  return (
    hasExactKeys(reference, ["kind", "scope_id", "source_seq"]) &&
    (reference.kind === "discussion_post" || reference.kind === "game_post") &&
    isIdentifier(reference.scope_id) &&
    isPositiveSafeInteger(reference.source_seq)
  );
}

function isCanonicalPostEmbed(embed) {
  return (
    hasExactKeys(embed, ["provider", "provider_id"], ["start_seconds", "snapshot"]) &&
    embed.provider === "youtube" &&
    isIdentifier(embed.provider_id) &&
    (embed.start_seconds === undefined || isNonNegativeSafeInteger(embed.start_seconds)) &&
    (embed.snapshot === undefined || isCanonicalEmbedSnapshot(embed.snapshot))
  );
}

function isCanonicalEmbedSnapshot(snapshot) {
  return (
    hasExactKeys(snapshot, ["title"], ["author", "poster"]) &&
    typeof snapshot.title === "string" &&
    (snapshot.author === undefined || typeof snapshot.author === "string") &&
    (snapshot.poster === undefined ||
      (hasExactKeys(snapshot.poster, ["content_id"]) &&
        isIdentifier(snapshot.poster.content_id)))
  );
}

function isCanonicalHostAuthority(authority) {
  return (
    hasExactKeys(authority, [
      "principal_id",
      "capability",
      "allowed_classes",
      "denied_classes",
    ]) &&
    isIdentifier(authority.principal_id) &&
    ["HostOf", "CohostOf", "GlobalOperator"].includes(authority.capability) &&
    isIdentifierArray(authority.allowed_classes) &&
    isIdentifierArray(authority.denied_classes)
  );
}

function isCanonicalHostPhase(phase) {
  return phase === null || (
    hasExactKeys(phase, ["phase_id", "locked", "deadline"]) &&
    isIdentifier(phase.phase_id) &&
    typeof phase.locked === "boolean" &&
    (phase.deadline === null || isNonNegativeSafeInteger(phase.deadline))
  );
}

function isCanonicalHostSlot(slot) {
  return (
    hasExactKeys(slot, [
      "slot_id",
      "occupancy_id",
      "persona_id",
      "public_name",
      "assigned_principal_id",
      "alive",
      "status",
      "status_tags",
      "role_key",
      "alignment",
      "role_revealed",
      "alignment_revealed",
    ]) &&
    isIdentifier(slot.slot_id) &&
    isIdentifier(slot.occupancy_id) &&
    isIdentifier(slot.persona_id) &&
    isIdentifier(slot.public_name) &&
    isIdentifier(slot.assigned_principal_id) &&
    typeof slot.alive === "boolean" &&
    isIdentifier(slot.status) &&
    isIdentifierArray(slot.status_tags) &&
    isNullableIdentifier(slot.role_key) &&
    isNullableIdentifier(slot.alignment) &&
    typeof slot.role_revealed === "boolean" &&
    typeof slot.alignment_revealed === "boolean"
  );
}

function isCanonicalHostThreadPost(post) {
  return (
    hasExactKeys(post, ["stream_seq", "author", "phase_id", "body", "quotations"]) &&
    isPositiveSafeInteger(post.stream_seq) &&
    isCanonicalGameThreadAuthor(post.author) &&
    isNullableIdentifier(post.phase_id) &&
    typeof post.body === "string" &&
    Array.isArray(post.quotations) &&
    post.quotations.every(isCanonicalQuotation)
  );
}

function isCanonicalScheduler(scheduler) {
  if (scheduler === null) {
    return true;
  }
  return (
    hasExactKeys(scheduler, [
      "pending",
      "next_due_at",
      "auto_resolve_pending",
      "narrative_pending",
      "wake_seq",
      "last_observed_wake_seq",
      "lease_until",
      "retry_not_before",
      "last_attempt_at",
      "last_success_at",
      "last_failure_at",
      "consecutive_failures",
      "total_attempts",
      "total_successes",
      "last_error",
    ]) &&
    typeof scheduler.pending === "boolean" &&
    typeof scheduler.auto_resolve_pending === "boolean" &&
    typeof scheduler.narrative_pending === "boolean" &&
    isNullableNonNegativeSafeInteger(scheduler.next_due_at) &&
    isNonNegativeSafeInteger(scheduler.wake_seq) &&
    isNonNegativeSafeInteger(scheduler.last_observed_wake_seq) &&
    isNullableNonNegativeSafeInteger(scheduler.lease_until) &&
    isNullableNonNegativeSafeInteger(scheduler.retry_not_before) &&
    isNullableNonNegativeSafeInteger(scheduler.last_attempt_at) &&
    isNullableNonNegativeSafeInteger(scheduler.last_success_at) &&
    isNullableNonNegativeSafeInteger(scheduler.last_failure_at) &&
    isNonNegativeSafeInteger(scheduler.consecutive_failures) &&
    isNonNegativeSafeInteger(scheduler.total_attempts) &&
    isNonNegativeSafeInteger(scheduler.total_successes) &&
    (scheduler.last_error === null || typeof scheduler.last_error === "string")
  );
}

function isCanonicalPlayerNotification(row) {
  return (
    hasExactKeys(row, [
      "game",
      "phase_id",
      "event_index",
      "audience_slot",
      "effect",
      "status",
    ]) &&
    isIdentifier(row.game) &&
    isIdentifier(row.phase_id) &&
    isNonNegativeSafeInteger(row.event_index) &&
    isIdentifier(row.audience_slot) &&
    isIdentifier(row.effect) &&
    isIdentifier(row.status)
  );
}

/// A delivered slot mention names a seat and the room it was addressed in.
/// `phase_id` is nullable because setup discussion sits outside a phase, and
/// there is deliberately no field here that could name an occupant.
function isCanonicalSlotMention(row) {
  return (
    hasExactKeys(row, [
      "game",
      "audience_slot",
      "channel_id",
      "source_seq",
      "phase_id",
      "occurred_at",
    ]) &&
    isIdentifier(row.game) &&
    isIdentifier(row.audience_slot) &&
    isIdentifier(row.channel_id) &&
    isPositiveSafeInteger(row.source_seq) &&
    (row.phase_id === null || isIdentifier(row.phase_id)) &&
    isNonNegativeSafeInteger(row.occurred_at)
  );
}

function isCanonicalInvestigationResult(row) {
  return (
    hasExactKeys(row, [
      "game",
      "phase_id",
      "event_index",
      "audience_slot",
      "mode",
      "target_slot",
      "result",
    ]) &&
    isIdentifier(row.game) &&
    isIdentifier(row.phase_id) &&
    isNonNegativeSafeInteger(row.event_index) &&
    isIdentifier(row.audience_slot) &&
    isIdentifier(row.mode) &&
    isIdentifier(row.target_slot) &&
    (typeof row.result === "string" || isPlainRecord(row.result))
  );
}

function isCanonicalDayVoteOutcome(body) {
  return (
    hasExactKeys(body, [
      "game",
      "phase_id",
      "source_seq",
      "event_index",
      "status",
      "winner_slot",
      "contenders",
      "tallies",
      "votes",
      "weights",
      "majority",
      "thresholds",
      "total_weight",
      "tiebreak",
      "reason",
    ]) &&
    isIdentifier(body.game) &&
    isIdentifier(body.phase_id) &&
    isPositiveSafeInteger(body.source_seq) &&
    isNonNegativeSafeInteger(body.event_index) &&
    isIdentifier(body.status) &&
    isNullableIdentifier(body.winner_slot) &&
    isIdentifierArray(body.contenders) &&
    isFiniteNonNegativeNumberMap(body.tallies) &&
    isIdentifierMap(body.votes) &&
    isFiniteNonNegativeNumberMap(body.weights) &&
    (body.majority === null || isFiniteNonNegativeNumber(body.majority)) &&
    isFiniteNonNegativeNumberMap(body.thresholds) &&
    isFiniteNonNegativeNumber(body.total_weight) &&
    isNullableIdentifier(body.tiebreak) &&
    (body.reason === null || typeof body.reason === "string")
  );
}

function hasExactKeys(value, requiredKeys, optionalKeys = []) {
  if (!isPlainRecord(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  return (
    requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    actual.every((key) => allowed.has(key))
  );
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainRecordArray(value) {
  return Array.isArray(value) && value.every(isPlainRecord);
}

function isIdentifier(value) {
  return (
    typeof value === "string" &&
    value !== "" &&
    !/(?:^\p{White_Space}|\p{White_Space}$)/u.test(value) &&
    !/\p{Cc}/u.test(value)
  );
}

function isNullableIdentifier(value) {
  return value === null || isIdentifier(value);
}

function isIdentifierArray(value) {
  return Array.isArray(value) && value.every(isIdentifier);
}

function isIdentifierMap(value) {
  return (
    isPlainRecord(value) &&
    Object.entries(value).every(([key, entry]) =>
      isIdentifier(key) && isIdentifier(entry)
    )
  );
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isNullableNonNegativeSafeInteger(value) {
  return value === null || isNonNegativeSafeInteger(value);
}

function isFiniteNonNegativeNumber(value) {
  return Number.isFinite(value) && value >= 0;
}

function isFiniteNonNegativeNumberMap(value) {
  return (
    isPlainRecord(value) &&
    Object.entries(value).every(([key, entry]) =>
      isIdentifier(key) && isFiniteNonNegativeNumber(entry)
    )
  );
}

function isExactProtocolHello(envelope) {
  const envelopeKeys = Object.keys(envelope ?? {}).sort();
  const messageKeys = Object.keys(envelope?.body ?? {}).sort();
  const hello = envelope?.body?.body;
  if (
    envelopeKeys.length !== 3 ||
    envelopeKeys[0] !== "body" ||
    envelopeKeys[1] !== "id" ||
    envelopeKeys[2] !== "v" ||
    messageKeys.length !== 2 ||
    messageKeys[0] !== "body" ||
    messageKeys[1] !== "kind" ||
    envelope.id !== 0 ||
    hello === null ||
    typeof hello !== "object" ||
    Array.isArray(hello)
  ) {
    return false;
  }
  const keys = Object.keys(hello).sort();
  return (
    keys.length === 4 &&
    keys[0] === "caps" &&
    keys[1] === "protocol_v" &&
    keys[2] === "scope" &&
    keys[3] === "server" &&
    hello.protocol_v === LIVE_PROTOCOL_VERSION &&
    isIdentifier(hello.server) &&
    Array.isArray(hello.caps) &&
    hello.caps.every(isExactCapabilityGrant) &&
    isExactWireLiveScope(hello.scope)
  );
}

function isExactWireLiveScope(value) {
  try {
    normalizeWireLiveScope(value);
    return true;
  } catch {
    return false;
  }
}

function isExactCapabilityGrant(capability) {
  if (
    capability === null ||
    typeof capability !== "object" ||
    Array.isArray(capability)
  ) {
    return false;
  }
  const kind = capability.kind;
  const keys = Object.keys(capability).sort();
  if (kind === "GlobalAdmin" || kind === "GlobalMod") {
    return keys.length === 1 && keys[0] === "kind";
  }
  if (
    kind !== "HostOf" &&
    kind !== "CohostOf" &&
    kind !== "SlotOccupant" &&
    kind !== "ChannelMember" &&
    kind !== "DeadViewer" &&
    kind !== "SpectatorOf"
  ) {
    return false;
  }
  if (
    keys.length !== 2 ||
    keys[0] !== "body" ||
    keys[1] !== "kind" ||
    capability.body === null ||
    typeof capability.body !== "object" ||
    Array.isArray(capability.body)
  ) {
    return false;
  }
  if (kind === "SlotOccupant" || kind === "ChannelMember") {
    const scopedField = kind === "SlotOccupant" ? "slot" : "channel";
    return (
      hasExactKeys(capability.body, ["game", scopedField]) &&
      isIdentifier(capability.body.game) &&
      isIdentifier(capability.body[scopedField])
    );
  }
  const field = "game";
  return (
    Object.keys(capability.body).length === 1 &&
    isIdentifier(capability.body[field])
  );
}

function liveDeltaGame(kind, body) {
  if (kind === "PostCitationsChanged") {
    const quotedKind = String(body?.quoted?.kind ?? "");
    const scopeId = String(body?.quoted?.scope_id ?? body?.quoted?.scopeId ?? "");
    if (quotedKind !== "game_post" || scopeId === "") {
      throw new TypeError("live citation delta lacks a game-scoped post reference");
    }
    return scopeId;
  }
  const game = String(body?.game ?? "");
  if (game === "") {
    throw new TypeError(`live ${kind} delta lacks a game scope`);
  }
  return game;
}

function validateHelloCapabilities(capabilities, scope) {
  if (!Array.isArray(capabilities)) {
    throw new TypeError("live Hello contains no authority for the connection scope");
  }
  if (capabilities.length === 0 && scope.channel === "main" && scope.slotId === null) {
    return;
  }
  const applicable = capabilities.some((capability) => {
    const kind = capability.kind;
    if (kind === "GlobalAdmin" || kind === "GlobalMod") {
      return true;
    }
    if (
      kind === "HostOf" ||
      kind === "CohostOf" ||
      kind === "DeadViewer" ||
      kind === "SpectatorOf"
    ) {
      return capability.body.game === scope.game;
    }
    if (kind === "SlotOccupant") {
      return capability.body.game === scope.game && (
        scope.slotId === null
          ? scope.channel === "main"
          : capability.body.slot === scope.slotId
      );
    }
    if (kind === "ChannelMember") {
      return capability.body.game === scope.game &&
        capability.body.channel === scope.channel;
    }
    return false;
  });
  if (!applicable) {
    throw new TypeError("live Hello authority does not match the connection scope");
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalHelloFingerprint(hello) {
  return canonicalJson({
    ...hello,
    caps: [...hello.caps].sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right))
    ),
  });
}

function deriveLiveAudienceEntitlements(capabilities, scope) {
  const entitlements = new Set(["Game", "Thread"]);
  const host = capabilities.some((capability) =>
    capability.kind === "GlobalAdmin" ||
    capability.kind === "GlobalMod" ||
    ((capability.kind === "HostOf" || capability.kind === "CohostOf") &&
      capability.body.game === scope.game)
  );
  if (host && scope.slotId === null) entitlements.add("Host");
  const player = capabilities.some((capability) =>
    capability.kind === "SlotOccupant" &&
    capability.body.game === scope.game &&
    capability.body.slot === scope.slotId
  );
  if (player && scope.slotId !== null) entitlements.add("PlayerSlot");
  return entitlements;
}

function validateMessageAudienceEntitlement(message, entitlements, scope) {
  if (message?.kind === "hello") return;
  if (!(entitlements instanceof Set)) {
    throw new TypeError("live generation has no accepted audience entitlements");
  }
  const audiences = message.kind === "delta" ? [message.audience] : message.audiences;
  for (const audience of audiences) {
    if (!entitlements.has(audience.kind)) {
      throw new TypeError(`live ${audience.kind} audience is not entitled by accepted Hello`);
    }
    if (audience.kind === "Host" && scope.slotId !== null) {
      throw new TypeError("live Host audience is forbidden on a slot-scoped generation");
    }
  }
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
    if (
      Number(post?.seq) !== quotedSeq ||
      (post?.channelId !== undefined && post.channelId !== delta.channel)
    ) {
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

function removeThreadPost(previousThread, sourceSeq, channel) {
  const previous = previousThread ?? {};
  const previousPosts = Array.isArray(previous.posts) ? previous.posts : [];
  return Object.freeze({
    ...previous,
    posts: Object.freeze(
      previousPosts.filter((post) =>
        String(post?.seq) !== String(sourceSeq) ||
        (post?.channelId !== undefined && post.channelId !== channel)
      ),
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

function requiredIdentifier(value, field) {
  if (!isIdentifier(value)) {
    throw new TypeError(`${field} must be a canonical non-empty identifier`);
  }
  return value;
}
