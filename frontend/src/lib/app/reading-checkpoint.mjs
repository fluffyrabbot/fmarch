export function readingPosition(value) {
  return value && Number.isSafeInteger(value.source_seq) && value.source_seq > 0
    && Number.isInteger(value.offset_px) && Math.abs(value.offset_px) <= 1_000_000 ? value : null;
}
export function checkpointView(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0
    || typeof value.available !== "boolean"
    || (value.position !== null && !readingPosition(value.position))
    || (value.revision === 0) !== (value.position === null)) throw new TypeError("Invalid reading checkpoint");
  return value;
}

// Broadcasts carry invalidations only. Every position comes from authenticated HTTP.
// A conflict consumes the stale intent; only a later gesture may write again.
export function createReadingCheckpoint({ game, channel, principal, fetchImpl = fetch,
  onInitial = () => {}, onDenied = () => {}, onStatus = () => {},
  windowRef = globalThis.window, documentRef = globalThis.document,
  BroadcastChannelImpl = globalThis.BroadcastChannel }) {
  const url = `/api/gameplay/games/${encodeURIComponent(game)}/channels/${encodeURIComponent(channel)}/reading-checkpoint`;
  const bus = BroadcastChannelImpl ? new BroadcastChannelImpl(`fmarch-reading:${principal}:${game}:${channel}`) : null;
  let current = null, disposed = false, initial = true, pending = null, writing = false;
  let refreshEpoch = 0, authorityEpoch = 0;
  const requests = new AbortController();
  const adopt = value => {
    const next = checkpointView(value);
    if (!current || next.revision >= current.revision) current = next;
    return current;
  };
  const denied = () => { ++authorityEpoch; ++refreshEpoch; current = null; pending = null; initial = false; onDenied(); onStatus("denied"); };
  async function refresh() {
    const epoch = ++refreshEpoch;
    try {
      const response = await fetchImpl(url, { cache: "no-store", signal: requests.signal });
      if (disposed || epoch !== refreshEpoch) return;
      if ([401, 403].includes(response.status)) { denied(); return; }
      if (!response.ok) throw new Error("Checkpoint unavailable");
      const value = await response.json();
      if (disposed || epoch !== refreshEpoch) return;
      adopt(value);
      if (initial) { initial = false; onInitial(current); }
      onStatus("ready");
    } catch { if (!disposed && epoch === refreshEpoch) onStatus("error"); }
  }
  async function drain() {
    if (writing || disposed) return;
    writing = true;
    try {
      while (pending && !disposed) {
        const authority = authorityEpoch;
        const intent = pending;
        pending = null;
        const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(intent), keepalive: true });
        if (disposed || authority !== authorityEpoch) return;
        if ([401, 403].includes(response.status)) { denied(); return; }
        if (!response.ok && response.status !== 409) throw new Error("Checkpoint not saved");
        const value = await response.json();
        if (disposed || authority !== authorityEpoch) return;
        adopt(value);
        if (response.status === 409) pending = null;
        else if (pending?.expected_revision === intent.expected_revision) {
          if (value.revision === intent.expected_revision + 1 && current.revision === value.revision) pending.expected_revision = value.revision;
          else pending = null;
        }
        bus?.postMessage({ type: "invalidate" });
        onStatus("ready");
      }
    } catch { pending = null; if (!disposed) onStatus("error"); }
    finally { writing = false; }
  }
  const onMessage = event => { if (event.data?.type === "invalidate") void refresh(); };
  const onVisible = () => { if (documentRef?.visibilityState === "visible") void refresh(); };
  bus?.addEventListener("message", onMessage);
  windowRef?.addEventListener("focus", refresh);
  windowRef?.addEventListener("pageshow", refresh);
  documentRef?.addEventListener("visibilitychange", onVisible);
  return {
    refresh,
    save(position) {
      initial = false;
      if (disposed || !current || !readingPosition(position)) return;
      if (current.position?.source_seq === position.source_seq && current.position?.offset_px === position.offset_px) return;
      pending = { expected_revision: current.revision, position: { ...position } };
      void drain();
    },
    interruptResume() { initial = false; },
    dispose() {
      disposed = true; requests.abort(); bus?.close();
      windowRef?.removeEventListener("focus", refresh);
      windowRef?.removeEventListener("pageshow", refresh);
      documentRef?.removeEventListener("visibilitychange", onVisible);
    },
  };
}

export function deliberateReadingOrigin(documentRef = document) {
  const header = documentRef.querySelector('[data-testid="app-shell-topbar"]');
  const top = header?.getBoundingClientRect().bottom ?? 80;
  const posts = [...documentRef.querySelectorAll('article[id^="thread-post-"]')];
  const post = posts.find(post => {
    const bounds = post.getBoundingClientRect();
    return bounds.bottom > top && bounds.top < documentRef.defaultView.innerHeight;
  });
  return post ? { id: post.id, top: Math.round(post.getBoundingClientRect().top) } : null;
}
