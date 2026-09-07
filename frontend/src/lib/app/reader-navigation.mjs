import { captureReadingPosition, restoreReadingPosition } from "./post-address.mjs";

export const readerScope = url => `${url.pathname}${url.search}`;
const destinations = new Set(["count", "private"]);
export function readerNavigationState(page) {
  const value = page.state?.readerNavigation;
  return value?.scope === readerScope(page.url)
    && (value.destination === null || destinations.has(value.destination))
    && typeof value.origin?.id === "string" && Number.isFinite(value.origin?.top)
    ? value : null;
}
// SvelteKit resets page.state on hydration; its supported snapshot lifecycle
// persists the excursion without depending on internal history-state keys.
export function readerNavigationSnapshot(page) {
  return { trip: readerNavigationState(page), hash: page.url.hash };
}
export function readerNavigationFromSnapshot(saved, page) {
  if (!saved || saved.hash !== page.url.hash || readerNavigationState(page)) return null;
  return readerNavigationState({ ...page, state: { readerNavigation: saved.trip } });
}
export function captureReaderOrigin(documentRef = document, preferredId = null) {
  const preferred = preferredId && documentRef.getElementById(preferredId);
  if (preferred) {
    const bounds = preferred.getBoundingClientRect();
    if (bounds.bottom > 0 && bounds.top < documentRef.defaultView.innerHeight) return { id: preferred.id, top: bounds.top };
  }
  const position = captureReadingPosition(documentRef);
  const thread = documentRef.getElementById("player-thread");
  return position ?? (thread ? { id: thread.id, top: thread.getBoundingClientRect().top } : null);
}
export function restoreReaderOrigin(origin, documentRef = document, windowRef = window) {
  const target = documentRef.getElementById(origin.id);
  if (target) {
    target.focus({ preventScroll: true });
    restoreReadingPosition(origin, documentRef, windowRef);
    return true;
  }
  focusReaderThread(documentRef);
  return false;
}
export function focusReaderThread(documentRef = document) {
  const thread = documentRef.getElementById("player-thread");
  thread?.focus({ preventScroll: true });
  thread?.scrollIntoView({ block: "start", behavior: "instant" });
}

// Only our own destination entry can request Back. No post text or private
// receipt state is copied into history, and an origin never crosses routes.
export function createReaderNavigation({ getPage, push, replace, back, capture,
  restore, reconcileOrigin = () => {}, focusNewest = () => {}, focusDestination, afterRender, onChange }) {
  let observed;
  let epoch = 0;
  let disposed = false;
  let returning = false;
  let recovery;
  let restoration = null;
  return {
    observe(page, intent = "origin") {
      if (disposed) return;
      const next = readerNavigationState(page);
      if (next === observed) return;
      observed = next;
      returning = false;
      restoration = null;
      recovery?.abort();
      recovery = new AbortController();
      const signal = recovery.signal;
      const generation = ++epoch;
      onChange(next);
      if (next) void afterRender().then(() => {
        if (disposed || generation !== epoch) return;
        if (next.destination === null) {
          restoration = { origin: next.origin, intent, forceReload: next.verify === true, signal, isCurrent: () => !disposed && generation === epoch };
          restore(next.origin, restoration);
        } else focusDestination(next.destination);
      });
    },
    checkpoint(origin, { resume = false, verify = false } = {}) {
      const page = getPage();
      if (disposed || readerNavigationState(page)?.destination) return;
      this.release();
      const trip = { scope: readerScope(page.url), origin, destination: null, verify };
      if (!resume) { observed = trip; onChange(trip); }
      replace("", { ...page.state, readerNavigation: trip });
    },
    recover(intent = "origin") {
      const page = getPage();
      if (disposed || !["origin", "newest"].includes(intent) || readerNavigationState(page)?.destination !== null) return;
      observed = undefined;
      this.observe(page, intent);
    },
    completeNewest() {
      if (disposed) return;
      const page = getPage();
      const scope = readerScope(page.url);
      const url = new URL(page.url);
      url.searchParams.delete("post");
      url.searchParams.delete("private");
      url.hash = "";
      const state = { ...page.state };
      delete state.readerNavigation;
      replace(`${url.pathname}${url.search}`, state);
      void afterRender().then(() => {
        if (!disposed && [scope, readerScope(url)].includes(readerScope(getPage().url)) && !readerNavigationState(getPage())) focusNewest();
      });
    },
    reconcile() {
      const pending = restoration;
      if (pending) void afterRender().then(() => {
        if (pending === restoration && pending.intent === "origin" && pending.isCurrent()) reconcileOrigin(pending.origin);
      });
    },
    release() {
      restoration = null;
      recovery?.abort();
      ++epoch;
    },
    open(destination) {
      if (disposed || returning || !destinations.has(destination)) return;
      const page = getPage();
      const current = readerNavigationState(page);
      const origin = current?.destination ? current.origin : capture();
      if (!origin) return;
      const base = { ...page.state };
      const trip = { scope: readerScope(page.url), origin, destination };
      const url = destination === "count" ? "#player-actions" : "#player-private-queue";
      if (current?.destination) replace(url, { ...base, readerNavigation: trip });
      else {
        replace("", { ...base, readerNavigation: { ...trip, destination: null } });
        push(url, { ...base, readerNavigation: trip });
      }
    },
    returnToThread() {
      if (!disposed && !returning && readerNavigationState(getPage())?.destination) {
        returning = true;
        back();
      }
    },
    dispose() { disposed = true; recovery?.abort(); ++epoch; },
  };
}
