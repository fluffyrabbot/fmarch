import assert from "node:assert/strict";
import { test } from "node:test";
import { createPrivateAttentionController } from "./private-attention-controller.mjs";
const ready = reviewedIds => ({ state: "ready", reviewedIds });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function environment() {
  const channels = new Set();
  const messages = [];
  return { messages, channels, channelFactory() {
    const channel = new EventTarget();
    channel.postMessage = data => {
      messages.push(data);
      for (const peer of channels) if (peer !== channel) peer.dispatchEvent(new MessageEvent("message", { data }));
    };
    channel.close = () => channels.delete(channel);
    channels.add(channel);
    return channel;
  } };
}
function reader(env, request) {
  const windowRef = new EventTarget();
  const documentRef = new EventTarget();
  documentRef.visibilityState = "visible";
  let latest;
  const controller = createPrivateAttentionController({ game: "g", initial: ready([]), request,
    channelFactory: env.channelFactory, windowRef, documentRef, onChange: value => { latest = value; } });
  return { ...controller, windowRef, documentRef, latest: () => latest };
}

test("concurrent tab reviews converge despite responses that omit the other write", async () => {
  const env = environment();
  const writes = [deferred(), deferred()];
  const durable = new Set();
  const request = index => async ({ itemId }) => {
    if (itemId !== null) { durable.add(itemId); return writes[index].promise; }
    return ready([...durable]);
  };
  const a = reader(env, request(0)), b = reader(env, request(1));
  const pendingA = a.review("a"), pendingB = b.review("b");
  writes[0].resolve(ready(["a"]));
  await pendingA;
  writes[1].resolve(ready(["b"]));
  await pendingB;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(new Set(a.latest().attention.reviewedIds), new Set(["a", "b"]));
  assert.deepEqual(new Set(b.latest().attention.reviewedIds), new Set(["a", "b"]));
  assert.deepEqual(env.messages, ["invalidate", "invalidate"]);
  a.dispose(); b.dispose();
  assert.equal(env.channels.size, 0);
});

test("invalidation during a stale read schedules a fresh authorized read", async () => {
  const env = environment(), stale = deferred(); let calls = 0;
  const a = reader(env, async () => ++calls === 1 ? stale.promise : ready(["new"]));
  const work = a.refresh();
  a.windowRef.dispatchEvent(new Event("focus"));
  stale.resolve(ready([]));
  await work;
  assert.equal(calls, 2);
  assert.deepEqual(a.latest().attention.reviewedIds, ["new"]);
  a.dispose();
});

test("visibility refresh clears denied state and disposed readers ignore in-flight responses", async () => {
  const env = environment(); let denied = false;
  const a = reader(env, async () => { if (denied) throw new Error("Denied"); return ready(["a"]); });
  await a.refresh(); denied = true;
  a.documentRef.dispatchEvent(new Event("visibilitychange"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(a.latest().attention.state, "unavailable");
  assert.deepEqual(a.latest().attention.reviewedIds, []);
  assert.equal(a.latest().message, "Denied");
  a.dispose();
  const late = deferred(), b = reader(env, () => late.promise);
  const work = b.review("b"), before = b.latest(); b.dispose();
  late.resolve(ready(["b"])); await work;
  assert.equal(b.latest(), before);
  assert.deepEqual(env.messages, []);
});
