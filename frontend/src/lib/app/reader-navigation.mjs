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
  const thread = documentRef.getElementById("player-thread");
  thread?.focus({ preventScroll: true });
  thread?.scrollIntoView({ block: "start", behavior: "instant" });
  return false;
}

// Only our own destination entry can request Back. No post text or private
// receipt state is copied into history, and an origin never crosses routes.
export function createReaderNavigation({ getPage, push, replace, back, capture,
  restore, focusDestination, afterRender, onChange }) {
  let observed;
  let epoch = 0;
  let disposed = false;
  let returning = false;
  return {
    observe(page) {
      if (disposed) return;
      const next = readerNavigationState(page);
      if (next === observed) return;
      observed = next;
      returning = false;
      const generation = ++epoch;
      onChange(next);
      if (next) void afterRender().then(() => {
        if (disposed || generation !== epoch) return;
        if (next.destination === null) restore(next.origin);
        else focusDestination(next.destination);
      });
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
    dispose() { disposed = true; ++epoch; },
  };
}
