import { fetchPrivateAttention } from "./private-attention.mjs";

// Invalidation carries no delivery IDs or private content. Every reader fetches
// their own authorized state, including after a session or seat changes.
export function createPrivateAttentionController({
  game, initial, onChange, request = fetchPrivateAttention,
  windowRef = window, documentRef = document,
  channelFactory = name => typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(name),
}) {
  let attention = initial;
  let pending = false;
  let disposed = false;
  let refreshRequested = false;
  let work = Promise.resolve();
  const channel = channelFactory(`fmarch-private-attention:${game}`);
  const publish = (message = "") => {
    if (!disposed) onChange({ attention, pending, message });
  };
  async function run(itemId = null) {
    pending = true;
    publish();
    let success = false;
    let message = "";
    try {
      attention = await request({ game, itemId });
      success = true;
      if (!disposed && itemId !== null) channel?.postMessage("invalidate");
      message = itemId === null ? "" : "Marked reviewed.";
    } catch (error) {
      if (itemId === null) attention = { state: "unavailable", reviewedIds: [] };
      message = error.message;
    } finally {
      pending = false;
    }
    if (!disposed && refreshRequested) {
      refreshRequested = false;
      await run();
    } else {
      publish(message);
    }
    return success;
  }
  function refresh() {
    if (disposed) return Promise.resolve();
    if (pending) { refreshRequested = true; return work; }
    work = run();
    return work;
  }
  const visible = () => { if (documentRef.visibilityState !== "hidden") void refresh(); };
  const invalidated = event => { if (event.data === "invalidate") void refresh(); };
  channel?.addEventListener("message", invalidated);
  windowRef.addEventListener("focus", visible);
  windowRef.addEventListener("pageshow", visible);
  documentRef.addEventListener("visibilitychange", visible);
  return {
    refresh,
    review(itemId) {
      if (disposed || pending) return Promise.resolve(false);
      work = run(itemId);
      return work;
    },
    dispose() {
      disposed = true;
      channel?.removeEventListener("message", invalidated);
      channel?.close();
      windowRef.removeEventListener("focus", visible);
      windowRef.removeEventListener("pageshow", visible);
      documentRef.removeEventListener("visibilitychange", visible);
    },
  };
}
