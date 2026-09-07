import assert from "node:assert/strict";
import { test } from "node:test";
import { createReaderNavigation, readerNavigationState, readerNavigationSnapshot, readerNavigationFromSnapshot, restoreReaderOrigin, captureReaderOrigin } from "./reader-navigation.mjs";
const settle = () => new Promise(resolve => setImmediate(resolve));
test("Count and More share one reversible origin entry and retain unrelated history state", async () => {
  const stack = [{ url: new URL("https://example.test/g/g?post=443"), state: { existing: true } }];
  let index = 0; const restored = [], focused = [];
  let controller;
  const write = (url, state, push) => {
    const entry = { url: new URL(url || stack[index].url, stack[index].url), state };
    if (push) { stack.splice(++index); stack.push(entry); } else stack[index] = entry;
    controller.observe(entry);
  };
  controller = createReaderNavigation({ getPage: () => stack[index],
    push: (url,state) => write(url,state,true), replace: (url,state) => write(url,state,false),
    back: () => controller.observe(stack[--index]), capture: () => ({ id: "thread-post-443", top: 117 }),
    restore: origin => restored.push(origin), focusDestination: value => focused.push(value),
    afterRender: () => Promise.resolve(), onChange() {},
  });
  controller.open("count"); await settle();
  assert.equal(stack.length, 2); assert.equal(stack[1].state.existing, true);
  assert.deepEqual(focused, ["count"]); assert.deepEqual(restored, []);
  controller.open("private"); await settle();
  assert.equal(stack.length, 2); assert.deepEqual(focused, ["count", "private"]);
  controller.returnToThread(); await settle();
  assert.equal(index, 0); assert.deepEqual(restored, [{ id: "thread-post-443", top: 117 }]);
  controller.returnToThread(); assert.equal(index, 0);
  controller.observe(stack[++index]); await settle();
  assert.equal(focused.at(-1), "private"); controller.dispose();
});
test("origins cannot cross channels and teardown cancels scheduled restoration", async () => {
  const trip = { scope: "/g/g/c/private", origin: { id: "thread-post-1", top: 5 }, destination: null };
  assert.equal(readerNavigationState({ url: new URL("https://example.test/g/g"), state: { readerNavigation: trip } }), null);
  let restored = false;
  const controller = createReaderNavigation({ afterRender: () => Promise.resolve(), restore: () => { restored = true; }, onChange() {} });
  controller.observe({ url: new URL("https://example.test/g/g/c/private"), state: { readerNavigation: trip } });
  controller.dispose(); await settle(); assert.equal(restored, false);
});
test("return resolves current post geometry and never recreates a removed post", () => {
  const scrolls = []; let focused;
  const post = { focus: options => { focused = options; }, getBoundingClientRect: () => ({ top: 500 }) };
  assert.equal(restoreReaderOrigin({ id: "post", top: 100 }, { getElementById: () => post }, { scrollBy: value => scrolls.push(value) }), true);
  assert.deepEqual(scrolls, [{ top: 400, behavior: "instant" }]);
  assert.deepEqual(focused, { preventScroll: true });
  let fallback = false;
  const thread = { focus() {}, scrollIntoView() { fallback = true; } };
  assert.equal(restoreReaderOrigin({ id: "removed", top: 100 }, { getElementById: id => id === "player-thread" ? thread : null }, {}), false);
  assert.equal(fallback, true);
});

test("moving focus to the dock retains a visible focused post as the origin", () => {
  const preferred = { id: "thread-post-443", getBoundingClientRect: () => ({ top: 120, bottom: 200 }) };
  assert.deepEqual(captureReaderOrigin({ getElementById: () => preferred, defaultView: { innerHeight: 800 } }, preferred.id), { id: preferred.id, top: 120 });
});
test("repeated Return activation cannot traverse beyond the owned history entry", () => {
  const page = { url: new URL("https://example.test/g/g"), state: { readerNavigation: {
    scope: "/g/g", origin: { id: "thread-post-1", top: 10 }, destination: "count",
  } } };
  let backs = 0;
  const controller = createReaderNavigation({ getPage: () => page, back: () => ++backs });
  controller.returnToThread(); controller.returnToThread();
  assert.equal(backs, 1); controller.dispose();
});

test("leaving an origin aborts recovery and invalidates its publication guard", async () => {
  let context;
  const controller = createReaderNavigation({ afterRender: () => Promise.resolve(),
    restore: (_, value) => { context = value; }, onChange() {}, focusDestination() {} });
  const entry = { url: new URL("https://example.test/g/g"), state: { readerNavigation: {
    scope: "/g/g", origin: { id: "thread-post-10", top: 90 }, destination: null,
  } } };
  controller.observe(entry); await settle();
  assert.equal(context.isCurrent(), true);
  controller.observe({ ...entry, state: {} });
  assert.equal(context.signal.aborted, true);
  assert.equal(context.isCurrent(), false);
  controller.dispose();
});

test("reload snapshots restore only the same scoped destination without replacing current history state", () => {
  const page = { url: new URL("https://example.test/g/g#player-actions"), state: { readerNavigation: {
    scope: "/g/g", origin: { id: "thread-post-10", top: 123 }, destination: "count",
  } } };
  const saved = JSON.parse(JSON.stringify(readerNavigationSnapshot(page)));
  assert.deepEqual(readerNavigationFromSnapshot(saved, { ...page, state: {} }), page.state.readerNavigation);
  assert.equal(readerNavigationFromSnapshot(saved, page), null);
  assert.equal(readerNavigationFromSnapshot(saved, { url: new URL("https://example.test/g/g"), state: {} }), null);
  assert.equal(readerNavigationFromSnapshot(saved, { url: new URL("https://example.test/g/g/c/private#player-actions"), state: {} }), null);
});

test("initial live replacement reconciles the anchor until the reader interacts", async () => {
  let reconciled = 0;
  const controller = createReaderNavigation({ afterRender: () => Promise.resolve(), restore() {},
    reconcileOrigin: () => ++reconciled, onChange() {} });
  controller.observe({ url: new URL("https://example.test/g/g"), state: { readerNavigation: {
    scope: "/g/g", origin: { id: "thread-post-10", top: 90 }, destination: null,
  } } });
  await settle(); controller.reconcile(); await settle();
  assert.equal(reconciled, 1);
  controller.reconcile(); controller.release(); await settle();
  controller.reconcile(); await settle();
  assert.equal(reconciled, 1);
  controller.dispose();
});

test("retry preserves the anchor, supersedes a cancelled attempt, and newest completion clears only navigation state", async () => {
  let page = { url: new URL("https://example.test/g/g?post=10&private=receipt"), state: { unrelated: 1, readerNavigation: {
    scope: "/g/g?post=10&private=receipt", origin: { id: "thread-post-10", top: 90 }, destination: null,
  } } };
  const attempts = []; let focused = 0;
  const controller = createReaderNavigation({ getPage: () => page, afterRender: () => Promise.resolve(),
    restore: (origin, context) => attempts.push({ origin, context }), onChange() {},
    replace: (url, state) => { page = { url: new URL(url, page.url), state }; controller.observe(page); },
    focusNewest: () => ++focused,
  });
  controller.observe(page); await settle(); controller.release();
  controller.recover(); await settle();
  assert.deepEqual(attempts[1].origin, attempts[0].origin);
  assert.equal(attempts[0].context.isCurrent(), false);
  controller.recover("newest"); await settle();
  assert.equal(attempts[1].context.signal.aborted, true);
  assert.equal(attempts[2].context.intent, "newest");
  assert.equal(page.state.readerNavigation.origin.id, "thread-post-10");
  controller.completeNewest(); await settle();
  assert.equal(page.url.href, "https://example.test/g/g");
  assert.deepEqual(page.state, { unrelated: 1 }); assert.equal(focused, 1);
  controller.dispose();
});

test("deliberate checkpoints replace stale origins without restoring; initial resume restores once", async () => {
  let page = { url: new URL("https://example.test/g/g"), state: { other: 1 } }, controller;
  const restores = [];
  controller = createReaderNavigation({ getPage: () => page,
    replace: (_, state) => { page = { ...page, state }; controller.observe(page); },
    onChange() {}, afterRender: () => Promise.resolve(), restore: origin => restores.push(origin) });
  controller.checkpoint({ id: "thread-post-10", top: 100 }, { resume: true }); await settle();
  controller.checkpoint({ id: "thread-post-20", top: 90 }); await settle();
  assert.equal(restores.length, 1); assert.equal(page.state.readerNavigation.origin.id, "thread-post-20");
  assert.equal(page.state.other, 1); controller.dispose();
});
