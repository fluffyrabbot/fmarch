import {
  applyHostConsoleLiveDelta,
  HOST_CONSOLE_LIVE_DELTA_KINDS,
} from "../components/host-action/host-command-boundary.mjs";
import {
  COLD_LOAD_TRANSPORT_BOUNDARY,
  LIVE_TRANSPORT_BOUNDARY,
  normalizeLiveProjectionScope,
  normalizeServerEnvelopeMessage,
  projectionPatchForLiveEnvelope,
  validateLiveProjectionMessageScope,
} from "./live-transport.mjs";

export { COLD_LOAD_TRANSPORT_BOUNDARY, LIVE_TRANSPORT_BOUNDARY };

export class ProjectionRefreshError extends Error {
  constructor(failures) {
    const normalizedFailures = Object.freeze(
      failures.map((failure) => Object.freeze({ ...failure })),
    );
    super(
      normalizedFailures.length === 1
        ? `authoritative projection refresh failed for ${normalizedFailures[0].key}`
        : `authoritative projection refresh failed for ${normalizedFailures.length} projections`,
    );
    this.name = "ProjectionRefreshError";
    this.code = "FMARCH_PROJECTION_REFRESH_FAILED";
    this.failures = normalizedFailures;
  }
}

export function createProjectionStore({
  initialSnapshot,
  coldLoads = {},
  liveTransport = COLD_LOAD_TRANSPORT_BOUNDARY,
  expectedScope = undefined,
}) {
  let snapshot = freezeSnapshot(requiredObject(initialSnapshot, "initialSnapshot"));
  let refreshNonce = 0;
  let refreshAttempt = 0;
  const registeredKeys = Object.freeze(Object.keys(coldLoads));
  const immutableExpectedScope = expectedScope === undefined
    ? null
    : normalizeLiveProjectionScope(expectedScope);
  const latestAttemptByKey = new Map(
    registeredKeys.map((key) => [key, 0]),
  );
  let health = initialProjectionHealth(registeredKeys);
  const subscribers = new Set();
  const healthSubscribers = new Set();

  function subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("projection store subscriber must be a function");
    }
    subscribers.add(listener);
    safelyNotifySubscriber(listener, snapshot);
    return () => subscribers.delete(listener);
  }

  function getSnapshot() {
    return snapshot;
  }

  function subscribeHealth(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("projection health subscriber must be a function");
    }
    healthSubscribers.add(listener);
    safelyNotifySubscriber(listener, health);
    return () => healthSubscribers.delete(listener);
  }

  function getHealth() {
    return health;
  }

  function isReady() {
    return health.ready === true;
  }

  function publishHealth({
    reason = health.reason,
    keyUpdates = {},
  } = {}) {
    const nextKeys = Object.freeze({ ...health.keys, ...keyUpdates });
    const keyStates = Object.values(nextKeys).map((entry) => entry.state);
    const ready = keyStates.every((state) => state === "ready");
    const state = ready
      ? "ready"
      : keyStates.includes("refreshing")
        ? "refreshing"
        : "unavailable";
    health = Object.freeze({
      state,
      ready,
      reason,
      revision: health.revision + 1,
      keys: nextKeys,
    });
    for (const subscriber of healthSubscribers) {
      safelyNotifySubscriber(subscriber, health);
    }
    return health;
  }

  function invalidate(
    keys = registeredKeys,
    { reason = "authoritative_projection_invalidated" } = {},
  ) {
    const invalidatedKeys = normalizeProjectionKeys(keys, registeredKeys);
    const attempt = supersedeProjectionKeys(invalidatedKeys);
    publishHealth({
      reason,
      keyUpdates: Object.fromEntries(
        invalidatedKeys.map((key) => [
          key,
          projectionKeyHealth("unavailable", attempt),
        ]),
      ),
    });
    return health;
  }

  function revokeAuthority({
    reason = "authoritative_authorization_lost",
    status = null,
  } = {}) {
    const revocationPatch = {};
    for (const key of registeredKeys) {
      const coldLoad = coldLoads[key];
      if (!Object.prototype.hasOwnProperty.call(coldLoad, "revoke")) {
        continue;
      }
      const configured = coldLoad.revoke;
      const revoked = typeof configured === "function"
        ? configured(snapshot[key], snapshot, { reason, status })
        : configured;
      if (revoked === undefined) {
        throw new TypeError(
          `projection authority revocation for ${key} must produce an explicit value`,
        );
      }
      if (
        typeof coldLoad.validateRevoked === "function" &&
        coldLoad.validateRevoked(revoked, snapshot[key]) !== true
      ) {
        throw new TypeError(
          `revoked projection for ${key} failed validation`,
        );
      }
      revocationPatch[key] = revoked;
    }

    const attempt = supersedeProjectionKeys(registeredKeys);
    if (Object.keys(revocationPatch).length > 0) {
      commitSnapshot(revocationPatch);
    }
    publishHealth({
      reason,
      keyUpdates: Object.fromEntries(
        registeredKeys.map((key) => [
          key,
          projectionKeyHealth("unavailable", attempt),
        ]),
      ),
    });
    return snapshot;
  }

  async function refresh(
    keys = Object.keys(coldLoads),
    {
      fetchImpl = globalThis.fetch,
      signal,
      restoreReadiness = true,
    } = {},
  ) {
    const refreshKeys = normalizeProjectionKeys(keys, registeredKeys);
    if (typeof fetchImpl !== "function") {
      invalidate(refreshKeys, { reason: "missing_fetch_implementation" });
      throw new TypeError("projection store refresh requires a fetch implementation");
    }

    const attempt = ++refreshAttempt;
    for (const key of refreshKeys) {
      latestAttemptByKey.set(key, attempt);
    }
    publishHealth({
      reason: "authoritative_refresh_in_progress",
      keyUpdates: Object.fromEntries(
        refreshKeys.map((key) => [key, projectionKeyHealth("refreshing", attempt)]),
      ),
    });

    const results = await Promise.all(
      refreshKeys.map(async (key) => {
        const coldLoad = coldLoads[key];
        try {
          const response = await fetchImpl(
            projectionRefreshUrl(coldLoad.url, ++refreshNonce),
            {
              cache: "no-store",
              headers: { accept: "application/json" },
              signal,
            },
          );
          if (!response?.ok) {
            const normalizedError = normalizeProjectionError({
              key,
              status: Number(response?.status ?? 0),
              previous: snapshot[key],
              coldLoad,
            });
            if (normalizedError.accepted) {
              return refreshSuccess(key, normalizedError.value);
            }
            return refreshFailure(key, "http_error", {
              status: Number(response?.status ?? 0),
            });
          }
          if (!isJsonResponse(response)) {
            return refreshFailure(key, "invalid_content_type", {
              status: Number(response?.status ?? 0),
            });
          }
          const payload = await response.json();
          return refreshSuccess(
            key,
            normalizeProjectionPayload({
              key,
              payload,
              previous: snapshot[key],
              coldLoad,
            }),
          );
        } catch (error) {
          return refreshFailure(key, "invalid_response", {
            message: errorMessage(error),
          });
        }
      }),
    );

    const currentResults = results.filter(
      (result) => latestAttemptByKey.get(result.key) === attempt,
    );
    if (currentResults.length !== results.length) {
      if (currentResults.length > 0) {
        publishHealth({
          reason: "authoritative_refresh_superseded",
          keyUpdates: Object.fromEntries(
            currentResults.map((result) => [
              result.key,
              projectionKeyHealth("unavailable", attempt),
            ]),
          ),
        });
      }
      throw new ProjectionRefreshError([
        refreshFailure("*", "superseded_refresh"),
      ]);
    }
    const failures = currentResults.filter((result) => result.kind === "failure");
    const successes = currentResults.filter((result) => result.kind === "success");
    const keyUpdates = Object.fromEntries(
      currentResults.map((result) => [
        result.key,
        projectionKeyHealth(
          result.kind === "success" ? "ready" : "unavailable",
          attempt,
        ),
      ]),
    );
    if (failures.length > 0) {
      publishHealth({
        reason: "authoritative_refresh_failed",
        keyUpdates: Object.fromEntries(
          currentResults.map((result) => [
            result.key,
            projectionKeyHealth("unavailable", attempt),
          ]),
        ),
      });
      throw new ProjectionRefreshError(failures);
    }
    if (successes.length > 0) {
      commitSnapshot(
        Object.fromEntries(successes.map((result) => [result.key, result.value])),
      );
    }
    publishHealth({
      reason: restoreReadiness === true
        ? "authoritative_refresh_succeeded"
        : "authoritative_refresh_applied_while_unavailable",
      keyUpdates: restoreReadiness === true
        ? keyUpdates
        : Object.fromEntries(
            currentResults.map((result) => [
              result.key,
              projectionKeyHealth("unavailable", attempt),
            ]),
          ),
    });
    return snapshot;
  }

  function applyPayload(key, payload) {
    const coldLoad = coldLoads[key];
    if (coldLoad === undefined) {
      throw new TypeError(`unknown projection payload key: ${key}`);
    }
    const attempt = supersedeProjectionKeys([key]);
    try {
      const nextSnapshot = commitSnapshot({
        [key]: normalizeProjectionPayload({ key, payload, previous: snapshot[key], coldLoad }),
      });
      publishHealth({
        reason: "authoritative_projection_applied",
        keyUpdates: {
          [key]: projectionKeyHealth("ready", attempt),
        },
      });
      return nextSnapshot;
    } catch (error) {
      invalidate([key], { reason: "invalid_live_projection_payload" });
      throw error;
    }
  }

  function applyNormalizedPayload(key, value) {
    const coldLoad = coldLoads[key];
    if (coldLoad === undefined) {
      throw new TypeError(`unknown normalized projection key: ${key}`);
    }
    const attempt = supersedeProjectionKeys([key]);
    try {
      validateNormalizedProjection({
        key,
        value,
        previous: snapshot[key],
        coldLoad,
      });
      const nextSnapshot = commitSnapshot({ [key]: value });
      publishHealth({
        reason: "authoritative_projection_applied",
        keyUpdates: {
          [key]: projectionKeyHealth("ready", attempt),
        },
      });
      return nextSnapshot;
    } catch (error) {
      invalidate([key], { reason: "invalid_live_projection_payload" });
      throw error;
    }
  }

  function applySnapshot(patch) {
    const nextPatch = requiredObject(patch, "projection patch");
    supersedeProjectionKeys(Object.keys(nextPatch));
    const nextSnapshot = commitSnapshot(nextPatch);
    publishHealth({
      reason: "authoritative_projection_applied",
      keyUpdates: Object.fromEntries(
        Object.keys(nextPatch)
          .filter((key) => registeredKeys.includes(key))
          .map((key) => [
            key,
            projectionKeyHealth("ready", latestAttemptByKey.get(key) ?? 0),
          ]),
      ),
    });
    return nextSnapshot;
  }

  function commitSnapshot(patch) {
    const nextPatch = requiredObject(patch, "projection patch");
    if (Object.keys(nextPatch).length === 0) {
      return snapshot;
    }
    snapshot = freezeSnapshot({ ...snapshot, ...nextPatch });
    for (const subscriber of subscribers) {
      safelyNotifySubscriber(subscriber, snapshot);
    }
    return snapshot;
  }

  function supersedeProjectionKeys(keys) {
    const attempt = ++refreshAttempt;
    for (const key of keys) {
      if (registeredKeys.includes(key)) {
        latestAttemptByKey.set(key, attempt);
      }
    }
    return attempt;
  }

  function applyLiveEnvelope(
    envelope,
    { expectedScope: envelopeExpectedScope = immutableExpectedScope } = {},
  ) {
    const message = normalizeServerEnvelopeMessage(envelope);
    if (message === null) {
      invalidate(undefined, { reason: "invalid_live_projection_envelope" });
      throw new TypeError("live projection envelope failed canonical validation");
    }
    const liveScope = envelopeExpectedScope === null || envelopeExpectedScope === undefined
      ? null
      : normalizeLiveProjectionScope(envelopeExpectedScope);
    if (message?.kind === "delta" && liveScope !== null) {
      validateLiveProjectionMessageScope(message, liveScope);
    }
    if (
      message?.kind === "delta" &&
      HOST_CONSOLE_LIVE_DELTA_KINDS.includes(message.delta.kind)
    ) {
      validateLiveProjectionDelta("host", message.delta, liveScope);
      if (message.delta.kind === "HostConsoleStateChanged") {
        return applyPayload("host", message.delta.body);
      }
      return applyNormalizedPayload(
        "host",
        applyHostConsoleLiveDelta(snapshot.host, message.delta),
      );
    }
    if (
      message?.kind === "delta" &&
      message.delta.kind === "HostPromptsChanged" &&
      coldLoads.hostPrompts !== undefined
    ) {
      validateLiveProjectionDelta("hostPrompts", message.delta, liveScope);
      return applyPayload(
        "hostPrompts",
        message.delta.body?.prompts ?? message.delta.body,
      );
    }
    if (
      message?.kind === "delta" &&
      message.delta.kind === "PlayerNotificationsChanged" &&
      coldLoads.notifications !== undefined
    ) {
      validateLiveProjectionDelta("notifications", message.delta, liveScope);
      return applyPayload(
        "notifications",
        message.delta.body?.notifications ?? message.delta.body,
      );
    }
    if (
      message?.kind === "delta" &&
      message.delta.kind === "PlayerInvestigationResultsChanged" &&
      coldLoads.investigationResults !== undefined
    ) {
      validateLiveProjectionDelta("investigationResults", message.delta, liveScope);
      return applyPayload(
        "investigationResults",
        message.delta.body?.results ?? message.delta.body,
      );
    }
    if (
      message?.kind === "delta" &&
      message.delta.kind === "SlotMentionsChanged" &&
      coldLoads.slotMentions !== undefined
    ) {
      validateLiveProjectionDelta("slotMentions", message.delta, liveScope);
      return applyPayload(
        "slotMentions",
        message.delta.body?.mentions ?? message.delta.body,
      );
    }
    if (
      message?.kind === "delta" &&
      message.delta.kind === "DayVoteOutcomeApplied" &&
      coldLoads.dayVoteOutcomes !== undefined
    ) {
      validateLiveProjectionDelta("dayVoteOutcomes", message.delta, liveScope);
      return applyPayload("dayVoteOutcomes", message.delta.body);
    }
    if (message?.kind === "delta") {
      const projectionKey = projectionKeyForLiveDelta(message.delta.kind);
      if (projectionKey !== null) {
        validateLiveProjectionDelta(projectionKey, message.delta, liveScope);
      }
    }
    const patch = projectionPatchForLiveEnvelope(envelope, snapshot);
    if (patch === null) {
      return snapshot;
    }
    return applySnapshot(patch);
  }

  function validateLiveProjectionDelta(key, delta, liveScope) {
    const coldLoad = coldLoads[key];
    const validator = coldLoad?.validateLiveDelta;
    try {
      if (typeof validator !== "function" && liveScope === null) {
        throw new TypeError(
          `live projection delta for ${key} requires a registered validator or immutable expected scope`,
        );
      }
      if (typeof validator === "function" && validator(delta, snapshot[key]) !== true) {
        throw new TypeError(`live projection delta for ${key} failed validation`);
      }
      supersedeProjectionKeys([key]);
    } catch (error) {
      if (registeredKeys.includes(key)) {
        invalidate([key], { reason: "invalid_live_projection_delta" });
      }
      throw error;
    }
  }

  return Object.freeze({
    liveTransport,
    subscribe,
    subscribeHealth,
    getSnapshot,
    getHealth,
    isReady,
    invalidate,
    revokeAuthority,
    refresh,
    applyPayload,
    applySnapshot,
    applyLiveEnvelope,
  });
}

function safelyNotifySubscriber(subscriber, value) {
  try {
    subscriber(value);
  } catch {
    // A view subscriber cannot own projection authority or block peer delivery.
  }
}

function normalizeProjectionPayload({ key, payload, previous, coldLoad }) {
  if (typeof coldLoad.validate === "function" && coldLoad.validate(payload) !== true) {
    throw new TypeError(`projection payload for ${key} failed validation`);
  }
  const value = typeof coldLoad.normalize === "function"
    ? coldLoad.normalize(payload, previous)
    : payload;
  if (value === undefined) {
    throw new TypeError(`projection payload for ${key} must not normalize to undefined`);
  }
  validateNormalizedProjection({ key, value, previous, coldLoad });
  return value;
}

function validateNormalizedProjection({ key, value, previous, coldLoad }) {
  if (
    typeof coldLoad.validateNormalized === "function" &&
    coldLoad.validateNormalized(value, previous) !== true
  ) {
    throw new TypeError(`normalized projection for ${key} failed validation`);
  }
}

function normalizeProjectionError({ key, status, previous, coldLoad }) {
  if (typeof coldLoad.normalizeError !== "function") {
    return Object.freeze({ accepted: false, value: undefined });
  }
  const value = coldLoad.normalizeError({ status, previous });
  if (value === undefined) {
    return Object.freeze({ accepted: false, value: undefined });
  }
  validateNormalizedProjection({ key, value, previous, coldLoad });
  return Object.freeze({ accepted: true, value });
}

function projectionRefreshUrl(url, nonce) {
  if (typeof url !== "string" || url.trim() === "") {
    return url;
  }
  const hashIndex = url.indexOf("#");
  const hasHash = hashIndex >= 0;
  const base = hasHash ? url.slice(0, hashIndex) : url;
  const hash = hasHash ? url.slice(hashIndex) : "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}_fmarch_projection_refresh=${encodeURIComponent(String(nonce))}${hash}`;
}

function requiredObject(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function normalizeProjectionKeys(value, registeredKeys) {
  const keys = value === undefined || value === null
    ? registeredKeys
    : Array.isArray(value)
      ? value
      : [value];
  const normalized = [...new Set(keys)];
  for (const key of normalized) {
    if (typeof key !== "string" || !registeredKeys.includes(key)) {
      throw new TypeError(`unknown projection cold-load key: ${String(key)}`);
    }
  }
  return Object.freeze(normalized);
}

function initialProjectionHealth(keys) {
  return Object.freeze({
    state: "ready",
    ready: true,
    reason: "authoritative_initial_snapshot",
    revision: 0,
    keys: Object.freeze(
      Object.fromEntries(keys.map((key) => [key, projectionKeyHealth("ready", 0)])),
    ),
  });
}

function projectionKeyHealth(state, attempt) {
  return Object.freeze({ state, attempt });
}

function refreshSuccess(key, value) {
  return Object.freeze({ kind: "success", key, value });
}

function refreshFailure(key, reason, detail = {}) {
  return Object.freeze({ kind: "failure", key, reason, ...detail });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isJsonResponse(response) {
  const contentType = response?.headers?.get?.("content-type");
  if (typeof contentType !== "string") {
    return false;
  }
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function projectionKeyForLiveDelta(kind) {
  if (
    kind === "ThreadPostsChanged" ||
    kind === "ThreadPostRemoved" ||
    kind === "PostCitationsChanged"
  ) {
    return "thread";
  }
  if (kind === "VoteCountChanged" || kind === "VoteCountCleared") {
    return "votecount";
  }
  return null;
}

function freezeSnapshot(value) {
  return Object.freeze({ ...value });
}
