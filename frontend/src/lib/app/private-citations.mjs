import { authenticatedGameReadUrl } from "./cold-load.mjs";
import { validatePrivateCitationBatch } from "./gameplay-response-schema.mjs";

const seqOf = post => Number(post.source_seq ?? post.seq);
const countOf = post => Number(post.citation_count ?? post.citationCount ?? 0);
const emptyPage = (game, seq) => Object.freeze({
  quoted: Object.freeze({ kind: "game_post", scope_id: game, source_seq: seq }),
  citations: Object.freeze([]), citation_count: 0,
});

// Used for SSR, reconnects, paging, addressed recovery, and pending live previews.
// A missing target is authoritative: no stale count or derived preview survives.
export async function hydratePrivateThreadPage(page, {
  game, channel, apiBaseUrl = "", fetchImpl = globalThis.fetch, signal,
}) {
  if (channel === "main") return page;
  const targets = [...new Set(page.posts.filter(post => countOf(post) > 0).map(seqOf))];
  const pages = new Map();
  for (let offset = 0; offset < targets.length; offset += 50) {
    signal?.throwIfAborted();
    const sourceSeqs = targets.slice(offset, offset + 50);
    const url = authenticatedGameReadUrl({ apiBaseUrl, game,
      path: `channels/${encodeURIComponent(channel)}/citations?source_seqs=${sourceSeqs.join(",")}&limit=5`,
    });
    const response = await fetchImpl(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) throw Object.assign(new Error(`Citation batch rejected: ${response.status}`), { status: response.status });
    const type = response.headers?.get?.("content-type")?.split(";", 1)[0].trim();
    if (type !== "application/json") throw new Error("Invalid citation batch content type");
    const batch = await response.json();
    signal?.throwIfAborted();
    if (!validatePrivateCitationBatch(batch, { game, channel, sourceSeqs })) throw new Error("Invalid private citation batch");
    for (const value of batch.pages) pages.set(value.quoted.source_seq, Object.freeze({
      ...value, quoted: Object.freeze(value.quoted),
      citations: Object.freeze(value.citations.map(citation => Object.freeze({ ...citation, quoting: Object.freeze(citation.quoting) }))),
    }));
  }
  return Object.freeze({ ...page, posts: Object.freeze(page.posts.map(post => {
    const citationPage = pages.get(seqOf(post)) ?? emptyPage(game, seqOf(post));
    return Object.freeze({ ...post, citationPage, ...(Object.hasOwn(post, "source_seq")
      ? { citation_count: citationPage.citation_count } : { citationCount: citationPage.citation_count }) });
  })) });
}

// Preview reads are owned by the same projection generation as their targets.
// Subscriptions coalesce a burst of deltas into bounded batches; an intervening
// snapshot or authority change aborts and supersedes the complete pending read.
export function connectPrivateCitationHydration({ store, game, channel, fetchImpl, onError = () => {} }) {
  if (channel === "main") return () => {};
  let closed = false, queued = false, generation = 0, controller = null;
  let observedThread, observedHealth, activeGuard;
  function schedule() {
    const thread = store.getSnapshot().thread;
    const health = store.getHealth().keys.thread;
    if (thread === observedThread && health === observedHealth && (!activeGuard || activeGuard())) return;
    observedThread = thread; observedHealth = health;
    generation += 1;
    controller?.abort();
    if (closed || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; void run(); });
  }
  async function run() {
    if (closed || store.getHealth().keys.thread?.state !== "ready") return;
    const thread = store.getSnapshot().thread;
    const pending = thread?.posts?.filter(post => post.citationPage === null) ?? [];
    if (!pending.length) return;
    const version = generation;
    const current = store.captureReadGuard(["thread"]);
    activeGuard = current;
    controller = new AbortController();
    try {
      const page = await hydratePrivateThreadPage({ posts: pending }, { game, channel, fetchImpl, signal: controller.signal });
      if (closed || version !== generation || !current() || store.getSnapshot().thread !== thread) return;
      const hydrated = new Map(page.posts.map(post => [seqOf(post), post]));
      store.applySnapshot({ thread: { ...thread, posts: thread.posts.map(post => hydrated.get(seqOf(post)) ?? post) } });
    } catch (error) {
      if (closed || version !== generation || !current()) return;
      if (error.status === 401 || error.status === 403) store.revokeAuthority({ reason: "private_citation_access_denied", status: error.status });
      onError(error);
    }
  }
  const unsubscribe = store.subscribe(schedule);
  const unsubscribeHealth = store.subscribeHealth(schedule);
  return () => { closed = true; generation += 1; controller?.abort(); unsubscribe(); unsubscribeHealth(); };
}
