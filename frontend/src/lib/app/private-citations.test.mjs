import assert from "node:assert/strict";
import { test } from "node:test";
import { hydratePrivateThreadPage, connectPrivateCitationHydration } from "./private-citations.mjs";
import { validatePrivateCitationBatch } from "./gameplay-response-schema.mjs";
import { createProjectionStore } from "./projection-store.mjs";

const game = "private-game", channel = "private:room";
const ref = source_seq => ({ kind: "game_post", scope_id: game, source_seq });
const page = (seq, count = 1) => ({ quoted: ref(seq), citation_count: count,
  citations: Array.from({ length: Math.min(count, 5) }, (_, index) => ({ quoting: ref(1000 - index), occurred_at: 100 })) });
const batch = pages => ({ game, channel, pages });
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const options = { game, channel };
function storeFor(posts) {
  return createProjectionStore({ initialSnapshot: { thread: { posts }, other: [] },
    coldLoads: { thread: { url: "/thread", normalize: value => value }, other: { url: "/other" } } });
}

test("private previews batch 50 targets, preserve total counts, and replace missing targets with authoritative zero", async () => {
  const requests = [];
  const posts = Array.from({ length: 102 }, (_, index) => ({ source_seq: index + 1, citation_count: 9 }));
  posts.push({ source_seq: 103, citation_count: 0 });
  const result = await hydratePrivateThreadPage({ posts }, { ...options, fetchImpl: async (url, init) => {
    const seqs = new URL(url, "https://local").searchParams.get("source_seqs").split(",").map(Number);
    requests.push(seqs);
    assert.equal(init.cache, "no-store");
    assert.match(url, /channels\/private%3Aroom\/citations/);
    return json(batch(seqs.filter(seq => seq !== 2).map(seq => page(seq, 9))));
  } });
  assert.deepEqual(requests.map(rows => rows.length), [50, 50, 2]);
  assert.equal(result.posts[0].citationPage.citations.length, 5);
  assert.equal(result.posts[0].citation_count, 9);
  assert.equal(result.posts[1].citation_count, 0);
  assert.equal(result.posts[102].citationPage.citation_count, 0);
  assert.ok(Object.isFrozen(result.posts[0].citationPage.citations[0].quoting));
  const normalized = await hydratePrivateThreadPage({ posts: [{ seq: 1, citationCount: 8 }] },
    { ...options, fetchImpl: async () => json(batch([page(1, 0)])) });
  assert.equal(normalized.posts[0].citationCount, 0);
  assert.equal(Object.hasOwn(normalized.posts[0], "citation_count"), false);
});

test("private batch validation rejects foreign scopes, unrequested targets, duplicate previews, order and count drift", () => {
  const expected = { ...options, sourceSeqs: [1] };
  assert.equal(validatePrivateCitationBatch(batch([page(1)]), expected), true);
  const invalid = [
    { ...batch([page(1)]), game: "other" }, { ...batch([page(1)]), channel: "main" },
    batch([page(2)]), batch([page(1), page(1)]),
    batch([{ ...page(1), citations: [] }]), batch([{ ...page(1), citation_count: -1 }]),
    batch([{ ...page(1), citations: [{ quoting: { ...ref(3), scope_id: "other" }, occurred_at: 1 }] }]),
    batch([{ ...page(1, 2), citations: [{ quoting: ref(2), occurred_at: 1 }, { quoting: ref(3), occurred_at: 1 }] }]),
    batch([{ ...page(1, 2), citations: [{ quoting: ref(3), occurred_at: 1 }, { quoting: ref(3), occurred_at: 1 }] }]),
  ];
  for (const value of invalid) assert.equal(validatePrivateCitationBatch(value, expected), false);
});

test("main thread hydration performs no private request", async () => {
  const input = { posts: [{ seq: 1, citationCount: 2 }] };
  assert.equal(await hydratePrivateThreadPage(input, { game, channel: "main", fetchImpl: () => assert.fail("private fetch") }), input);
});

test("newer live state wins over old preview responses and unrelated projections do not restart reads", async () => {
  const store = storeFor([{ seq: 1, citationCount: 1, citationPage: null }]);
  const reads = [];
  const stop = connectPrivateCitationHydration({ store, ...options, fetchImpl: () => {
    const read = deferred(); reads.push(read); return read.promise;
  } });
  await tick();
  store.applySnapshot({ other: ["changed"] });
  await tick();
  assert.equal(reads.length, 1);
  store.applySnapshot({ thread: { posts: [{ seq: 1, citationCount: 2, citationPage: null }] } });
  await tick();
  assert.equal(reads.length, 2);
  reads[1].resolve(json(batch([page(1, 2)])));
  await tick();
  reads[0].resolve(json(batch([page(1, 1)])));
  await tick();
  assert.equal(store.getSnapshot().thread.posts[0].citationCount, 2);
  assert.equal(store.getSnapshot().thread.posts[0].citationPage.citations.length, 2);
  stop();
});

test("current citation denial revokes authority; stopped or superseded denial cannot revoke newer state", async () => {
  for (const mode of ["current", "stopped", "superseded"]) {
    const store = storeFor([{ seq: 1, citationCount: 1, citationPage: null }]);
    const read = deferred();
    const stop = connectPrivateCitationHydration({ store, ...options, fetchImpl: () => read.promise });
    await tick();
    if (mode === "stopped") stop();
    if (mode === "superseded") store.applySnapshot({ thread: { posts: [] } });
    read.resolve(new Response(null, { status: 403 }));
    await tick();
    assert.equal(store.getHealth().state === "unavailable", mode === "current");
    stop();
  }
});

test("refresh hydration denial belongs to its original request even when superseded before the body arrives", async () => {
  const read = deferred();
  const store = createProjectionStore({ initialSnapshot: { thread: { posts: [] } }, coldLoads: {
    thread: { url: "/thread", hydrate: async () => { throw Object.assign(new Error("denied"), { status: 403 }); } },
  } });
  const refresh = store.refresh(["thread"], { fetchImpl: () => read.promise }).catch(error => error);
  store.applySnapshot({ thread: { posts: [{ seq: 99 }] } });
  read.resolve(json({ posts: [] }));
  await refresh;
  assert.equal(store.getHealth().state, "ready");
  assert.equal(store.getSnapshot().thread.posts[0].seq, 99);
});
