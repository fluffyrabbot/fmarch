import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveRouteBrowserReconnect } from "./live-route-browser-reconnect.mjs";

test("browser reconnect bridge resolves only after a recovered new generation", async () => {
  const calls = [];
  const bridge = createLiveRouteBrowserReconnect({
    role: "player",
    connection: {
      reconnectNow(options) {
        calls.push(options);
        return true;
      },
    },
    setTimeoutImpl: () => 7,
    clearTimeoutImpl: (handle) => calls.push({ cleared: handle }),
  });
  const pending = bridge.reconnectNow();
  assert.equal(bridge.observe({ kind: "close" }, null), false);
  assert.equal(
    bridge.observe({ kind: "resync-required", state: "reconnecting" }, null),
    false,
  );
  const snapshot = { thread: { posts: [] } };
  assert.equal(
    bridge.observe({ kind: "reconnect", attempt: 1, state: "recovered" }, snapshot),
    true,
  );
  assert.equal(await pending, snapshot);
  assert.deepEqual(calls, [{ reason: "browser_proof" }, { cleared: 7 }]);
});

test("browser reconnect bridge coalesces callers and rejects a refused reconnect", async () => {
  const accepted = createLiveRouteBrowserReconnect({
    role: "host",
    connection: { reconnectNow: () => true },
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {},
  });
  const first = accepted.reconnectNow();
  assert.equal(accepted.reconnectNow(), first);
  accepted.observe({ kind: "reconnect", state: "recovered" }, { host: {} });
  await first;

  const refused = createLiveRouteBrowserReconnect({
    role: "host",
    connection: { reconnectNow: () => false },
    setTimeoutImpl: () => 2,
    clearTimeoutImpl: () => {},
  });
  await assert.rejects(refused.reconnectNow(), /reconnect was refused/);
});
