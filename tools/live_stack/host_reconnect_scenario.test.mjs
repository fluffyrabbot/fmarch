import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { assertExplicitHostReconnect, proveExplicitHostReconnect } from "./host_reconnect_scenario.mjs";
import { explicitHostReconnectFixture } from "./host_reconnect_fixture.mjs";

test("a new explicit wake may recover with attempt zero or a later automatic attempt", () => {
  for (const attempt of [0, 1, 2]) {
    assert.deepEqual(assertExplicitHostReconnect(explicitHostReconnectFixture({ attempt })), { wakeIndex: 1, recoveryIndex: 2 });
  }
});

test("historical recovery, missing wake, failed recovery and unrefreshed count cannot qualify", () => {
  for (const mutate of [
    (e) => { e.after.events.pop(); e.after.eventCount--; },
    (e) => { e.after.events[1].reason = "close"; },
    (e) => { e.after.events[2].state = "failed"; },
    (e) => { e.after.events[2].attempt = -1; },
    (e) => { e.after.events[2].attempt = "0"; },
    (e) => { delete e.after.events[2].attempt; },
    (e) => { e.after.events[2].kind = "hello"; },
    (e) => { e.after.events.reverse(); },
    (e) => { e.after.endpoint = "/live/tickets?game=other"; },
    (e) => { e.after.health.state = "error"; },
    (e) => { e.after.projection[0].count = 9; },
    (e) => { e.triggerSnapshot = true; },
    (e) => { e.triggerSnapshot.votecount[0].count = 9; },
    (e) => { e.requests = []; },
    (e) => { e.responses[2].status = 503; },
    (e) => { e.responses[2].id = 99; },
    (e) => { e.responses[2].pathname = "/other/votecount"; },
    (e) => { e.sockets[0].closed = true; },
    (e) => { e.sockets[0].pathname = "/vite-hmr"; },
  ]) {
    const evidence = explicitHostReconnectFixture();
    mutate(evidence);
    assert.throws(() => assertExplicitHostReconnect(evidence));
  }
});

test("browser helper records real trigger, fresh scoped requests and ordered recovery, then removes listeners", async () => {
  const fixture = browserFixture();
  const evidence = await proveExplicitHostReconnect({ page: fixture.page, game: fixture.evidence.game, expectedCount: 1 });
  assert.equal(evidence.reconnectEvent.attempt, 0);
  assert.equal(evidence.eventStart, 1);
  assert.equal(evidence.requests.length, 3);
  assert.deepEqual(evidence.triggerSnapshot, fixture.evidence.triggerSnapshot);
  assert.equal(fixture.listeners.size, 0);
  assert.equal(JSON.stringify(evidence).includes("secret-ticket"), false);
});

test("failed trigger preserves scoped post-boundary diagnostics and removes listeners", async () => {
  const fixture = browserFixture({ fail: true });
  await assert.rejects(proveExplicitHostReconnect({ page: fixture.page, game: fixture.evidence.game, expectedCount: 1 }), (error) => {
    assert.match(error.message, /explicit host reconnect failed/);
    assert.match(error.message, /"health":\{"state":"error"\}/);
    assert.match(error.message, /"requests":\[/);
    assert.equal(error.cause.message, "actual reconnect failed");
    return true;
  });
  assert.equal(fixture.listeners.size, 0);
});

function browserFixture({ fail = false } = {}) {
  const evidence = explicitHostReconnectFixture();
  const listeners = new Map();
  const window = {
    __fmarchHostLiveProjectionEndpoint: evidence.before.endpoint,
    __fmarchHostLiveProjectionEvents: structuredClone(evidence.before.events),
    __fmarchHostVotecountProjection: evidence.before.projection,
    __fmarchHostLiveProjectionStatus: { state: "recovered" },
    async __fmarchReconnectHostLiveProjectionNow() {
      for (const request of evidence.requests) {
        const raw = { url: () => `https://fixture.invalid${request.pathname}${request.kind === "ticket" ? `?game=${evidence.game}` : ""}`, method: () => request.method };
        listeners.get("request")(raw);
        listeners.get("response")({ request: () => raw, status: () => 200 });
      }
      listeners.get("websocket")({ url: () => "wss://fixture.invalid/ws?ticket=secret-ticket", on() {} });
      window.__fmarchHostLiveProjectionEvents = structuredClone(evidence.after.events);
      if (fail) {
        window.__fmarchHostLiveProjectionStatus = { state: "error" };
        throw new Error("actual reconnect failed");
      }
      return evidence.triggerSnapshot;
    },
  };
  const evaluate = async (fn, argument) => structuredClone(await runInNewContext(`(${fn.toString()})(argument)`, { window, argument }));
  return { evidence, listeners, page: {
    evaluate,
    on(kind, listener) { listeners.set(kind, listener); },
    off(kind, listener) { assert.equal(listeners.get(kind), listener); listeners.delete(kind); },
    async waitForFunction(fn, argument) { assert.ok(await evaluate(fn, argument)); },
  } };
}
