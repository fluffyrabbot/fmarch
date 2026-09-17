import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { captureHostResyncBoundary, hostNetworkDiagnostics, waitForHostCommandResync } from "./host_resync_scenario.mjs";

const game = "host-resync-game";
const expectations = [
  { kind: "phase", commandKind: "LockThread", phaseId: "D01", locked: true },
  { kind: "phase", commandKind: "UnlockThread", phaseId: "D01", locked: false },
  { kind: "replacement", commandKind: "ProcessReplacement", slotId: "slot-7", principalId: "canonical-principal" },
  { kind: "prompt", commandKind: "ResolvePhase", promptId: "D01:skip_next_day:slot_1", status: "pending" },
  { kind: "prompt", commandKind: "ResolveHostPrompt", promptId: "D01:skip_next_day:slot_1", status: "resolved" },
  { kind: "slot", commandKind: "SetSlotStatus", slotId: "slot-7", status: "modkilled", alive: false },
];

test("all six host command paths prove automatic scoped resync, fresh recovery and exact API state", async () => {
  for (const expected of expectations) {
    const fixture = await browserFixture(expected);
    const result = await waitForHostCommandResync(fixture.options);
    assert.equal(result.status, "passed");
    assert.equal(result.recovery.resyncIndex, fixture.options.before.eventCount);
    assert.equal(result.recovery.recoveryIndex, fixture.options.before.eventCount + 3);
    assert.equal(result.recovery.events[0].fromEventSeq, 100_000, "global resync cursor is independent of ACK stream sequence 49");
    assert.equal(result.commandReceipt.streamSeqs[0], 49);
    assert.equal(fixture.apiReads(), 1);
  }
});

test("historical or unscoped resync, manual wake, missing handshake recovery and REST-only state fail", async () => {
  for (const mutate of [
    (f) => { f.window.__fmarchHostLiveProjectionEvents.splice(4); },
    (f) => { f.window.__fmarchHostLiveProjectionEvents[4].scope.game = "other"; },
    (f) => { f.window.__fmarchHostLiveProjectionEvents[4].scope.channel = "dead"; },
    (f) => { f.window.__fmarchHostLiveProjectionEvents[4].audiences = [{ kind: "Thread", game, channel: "main" }]; },
    (f) => { f.window.__fmarchHostLiveProjectionEvents[4].fromEventSeq = -1; },
    (f) => { f.window.__fmarchHostLiveProjectionEvents[4] = { kind: "delta", delta: { kind: "HostConsoleHeaderChanged", body: { game, phase: { phase_id: "D01", locked: true } } } }; },
    (f) => { f.window.__fmarchHostLiveProjectionEvents[5].code = 1000; },
    (f) => { f.window.__fmarchHostLiveProjectionEvents[6].reason = "browser_proof"; },
    (f) => { f.window.__fmarchHostLiveProjectionEvents[6].reason = "online"; },
    (f) => { f.window.__fmarchHostLiveProjectionEvents[7].state = "failed"; },
    (f) => { f.window.__fmarchHostLiveProjectionEvents[7].attempt = 0; },
    (f) => { f.window.__fmarchHostLiveProjectionStatus.state = "error"; },
    (f) => { f.window.__fmarchHostProjection.phase.locked = false; },
    (f) => { f.options.commandReceipt.streamSeqs = []; },
    (f) => { f.options.commandReceipt.requestEnvelope.body.body.command.LockThread.game = "other"; },
    (f) => { f.apiState.phase.locked = false; },
    (f) => { f.network.tickets.pop(); },
    (f) => { f.network.sockets.at(-1).closed = true; },
    (f) => { f.network.projections.at(-1).status = 503; },
    (f) => { f.network.requests.splice(2); },
    (f) => { f.network.projections.at(-1).requestId = 1; },
    (f) => { f.options.before.game = "other"; },
  ]) {
    const fixture = await browserFixture(expectations[0]);
    mutate(fixture);
    await assert.rejects(waitForHostCommandResync(fixture.options), (error) => {
      assert.match(error.message, /host command resync failed/);
      const evidence = JSON.parse(error.message.slice("host command resync failed: ".length));
      assert.equal(evidence.boundary.eventCount, 4);
      assert.ok(evidence.commandReceipt);
      assert.ok(evidence.after.eventsSinceBoundary);
      assert.ok(evidence.apiState);
      assert.ok(error.cause);
      return true;
    });
  }
});

test("each command's expected identity and status must match both current browser and raw API", async () => {
  for (const expected of expectations.slice(2)) {
    const fixture = await browserFixture(expected);
    if (expected.kind === "replacement") fixture.apiState.slots[0].assigned_principal_id = "fixture-alias";
    if (expected.kind === "slot") fixture.apiState.slots[0].alive = true;
    if (expected.kind === "prompt") fixture.apiState[0].status = "other";
    await assert.rejects(waitForHostCommandResync(fixture.options), /host command resync failed/);
  }
  for (const expected of [expectations[2], expectations[4], expectations[5]]) {
    const fixture = await browserFixture(expected);
    const command = fixture.options.commandReceipt.requestEnvelope.body.body.command[expected.commandKind];
    if (expected.kind === "replacement") command.incoming_principal_id = "other";
    if (expected.kind === "slot") command.slot = "other";
    if (expected.kind === "prompt") command.prompt_id = "other";
    await assert.rejects(waitForHostCommandResync(fixture.options), /host command resync failed/);
  }
});

test("capture requires a healthy scoped host endpoint and a real existing event boundary", async () => {
  for (const mutate of [
    (window) => { window.__fmarchHostLiveProjectionStatus.state = "error"; },
    (window) => { window.__fmarchHostLiveProjectionEndpoint += "&channel=dead"; },
    (window) => { window.__fmarchHostLiveProjectionEndpoint += "&slot_id=slot-7"; },
    (window) => { window.__fmarchHostLiveProjectionEvents = []; },
  ]) {
    const fixture = await browserFixture(expectations[0]);
    mutate(fixture.window);
    await assert.rejects(captureHostResyncBoundary(fixture.options.page, () => fixture.network));
  }
});

test("network diagnostics retain status/activity while omitting ticket URLs, bodies and frames", () => {
  const evidence = hostNetworkDiagnostics({
    tickets: [{ url: "https://fixture.invalid/live/tickets?game=game", method: "POST", status: 200, body: { ticket: "secret-ticket" } }],
    sockets: [{ url: "wss://fixture.invalid/ws?ticket=secret-ticket", closed: true, errors: ["private error"], frames: ["private payload"] }],
    projections: [{ pathname: "/api/gameplay/games/game/host-console-state", method: "GET", status: 200 }],
    requests: [{ id: 0, pathname: "/live/tickets", game: "game", method: "POST" }],
  });
  assert.equal(JSON.stringify(evidence).includes("secret"), false);
  assert.equal(JSON.stringify(evidence).includes("private"), false);
  assert.equal(evidence.tickets[0].game, "game");
  assert.equal(evidence.sockets[0].frameCount, 1);
});

async function browserFixture(expected) {
  const cycle = () => [
    { kind: "resync-required", state: "reconnecting", scope: { game, channel: "main", slotId: null }, audiences: [{ kind: "Host", game }], fromEventSeq: 100_000 },
    { kind: "close", code: 4001, reason: "resync-required" },
    { kind: "reconnecting", reason: "close", attempt: 1 },
    { kind: "reconnect", state: "recovered", attempt: 1 },
  ];
  const window = {
    __fmarchHostLiveProjectionEndpoint: `/live/tickets?game=${game}`,
    __fmarchHostLiveProjectionEvents: cycle(),
    __fmarchHostProjection: { phase: { id: "D01", locked: expected.locked },
      replacement: { slotId: "slot-7", assignedPrincipalId: expected.principalId },
      slots: [{ slot_id: "slot-7", status: expected.status, alive: expected.alive }],
    },
    __fmarchHostPromptsProjection: [{ id: expected.promptId, status: expected.status }],
    __fmarchHostLiveProjectionStatus: { state: "recovered" },
    __fmarchGetHostLiveProjectionMetrics: () => ({ resyncFramesReceived: 2 }),
  };
  const apiState = expected.kind === "prompt" ? [{ prompt_id: expected.promptId, status: expected.status }] : {
    phase: { phase_id: "D01", locked: expected.locked },
    slots: [{ slot_id: "slot-7", assigned_principal_id: expected.principalId, status: expected.status, alive: expected.alive }],
  };
  const network = { tickets: [], sockets: [], projections: [], requests: [] };
  const addNetwork = () => {
    const ticketId = network.requests.length;
    const projectionId = ticketId + 1;
    const pathname = `/api/gameplay/games/${game}/${expected.kind === "prompt" ? "host-prompts" : "host-console-state"}`;
    network.requests.push({ id: ticketId, pathname: "/live/tickets", game, method: "POST" }, { id: projectionId, pathname, method: "GET" });
    network.tickets.push({ requestId: ticketId, pathname: "/live/tickets", game, method: "POST", status: 200 });
    network.sockets.push({ pathname: "/ws", closed: false, errorCount: 0, frameCount: 1 });
    network.projections.push({ requestId: projectionId, pathname, method: "GET", status: 200 });
  };
  addNetwork();
  const evaluate = async (fn, argument) => structuredClone(await runInNewContext(`(${fn.toString()})(argument)`, { window, argument }));
  const page = { evaluate, async waitForFunction(fn, argument) { if (!await evaluate(fn, argument)) throw new Error("automatic resync did not converge"); } };
  const before = await captureHostResyncBoundary(page, () => network);
  window.__fmarchHostLiveProjectionEvents.push(...cycle());
  addNetwork();
  let apiReads = 0;
  const command = { [expected.commandKind]: { game, slot: expected.slotId, incoming_principal_id: expected.principalId, status: expected.status, prompt_id: expected.promptId } };
  const commandReceipt = expected.commandKind === "ResolvePhase"
    ? { command, streamSeqs: [49] }
    : { state: "ack", requestEnvelope: { body: { body: { command } } }, streamSeqs: [49] };
  return { window, apiState, network, apiReads: () => apiReads, options: { page, game, expected, before, commandReceipt,
    readApiState: async () => { apiReads++; return apiState; }, diagnostics: () => network,
  } };
}
