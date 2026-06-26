import {
  COLD_LOAD_TRANSPORT_BOUNDARY,
  LIVE_TRANSPORT_BOUNDARY,
  normalizeServerEnvelopeMessage,
  projectionPatchForLiveEnvelope,
} from "./live-transport.mjs";

export { COLD_LOAD_TRANSPORT_BOUNDARY, LIVE_TRANSPORT_BOUNDARY };

export function createProjectionStore({
  initialSnapshot,
  coldLoads = {},
  liveTransport = COLD_LOAD_TRANSPORT_BOUNDARY,
}) {
  let snapshot = freezeSnapshot(requiredObject(initialSnapshot, "initialSnapshot"));
  let refreshNonce = 0;
  const subscribers = new Set();

  function subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("projection store subscriber must be a function");
    }
    subscribers.add(listener);
    listener(snapshot);
    return () => subscribers.delete(listener);
  }

  function getSnapshot() {
    return snapshot;
  }

  async function refresh(keys = Object.keys(coldLoads), { fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("projection store refresh requires a fetch implementation");
    }

    const refreshKeys = Array.isArray(keys) ? keys : [keys];
    const patches = await Promise.all(
      refreshKeys.map(async (key) => {
        const coldLoad = coldLoads[key];
        if (coldLoad === undefined) {
          throw new TypeError(`unknown projection cold-load key: ${key}`);
        }
        const response = await fetchImpl(
          projectionRefreshUrl(coldLoad.url, ++refreshNonce),
          {
            cache: "no-store",
            headers: { accept: "application/json" },
          },
        );
        if (!response?.ok) {
          return null;
        }
        return [
          key,
          normalizeProjectionPayload({
            key,
            payload: await response.json(),
            previous: snapshot[key],
            coldLoad,
          }),
        ];
      }),
    );

    return applySnapshot(Object.fromEntries(patches.filter(Boolean)));
  }

  function applyPayload(key, payload) {
    const coldLoad = coldLoads[key];
    if (coldLoad === undefined) {
      throw new TypeError(`unknown projection payload key: ${key}`);
    }
    return applySnapshot({
      [key]: normalizeProjectionPayload({
        key,
        payload,
        previous: snapshot[key],
        coldLoad,
      }),
    });
  }

  function applySnapshot(patch) {
    const nextPatch = requiredObject(patch, "projection patch");
    if (Object.keys(nextPatch).length === 0) {
      return snapshot;
    }
    snapshot = freezeSnapshot({ ...snapshot, ...nextPatch });
    for (const subscriber of subscribers) {
      subscriber(snapshot);
    }
    return snapshot;
  }

  function applyLiveEnvelope(envelope) {
    const message = normalizeServerEnvelopeMessage(envelope);
    if (message?.kind === "delta" && message.delta.kind === "HostConsoleStateChanged") {
      return applyPayload("host", message.delta.body);
    }
    if (
      message?.kind === "delta" &&
      message.delta.kind === "HostPromptsChanged" &&
      coldLoads.hostPrompts !== undefined
    ) {
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
      return applyPayload(
        "investigationResults",
        message.delta.body?.results ?? message.delta.body,
      );
    }
    const patch = projectionPatchForLiveEnvelope(envelope, snapshot);
    if (patch === null) {
      return snapshot;
    }
    return applySnapshot(patch);
  }

  return Object.freeze({
    liveTransport,
    subscribe,
    getSnapshot,
    refresh,
    applyPayload,
    applySnapshot,
    applyLiveEnvelope,
  });
}

function normalizeProjectionPayload({ key, payload, previous, coldLoad }) {
  if (typeof coldLoad.normalize === "function") {
    return coldLoad.normalize(payload, previous);
  }
  if (payload === undefined) {
    throw new TypeError(`projection payload for ${key} must not be undefined`);
  }
  return payload;
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

function freezeSnapshot(value) {
  return Object.freeze({ ...value });
}
