import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { normalizeCommandResponse } from "../../frontend/src/lib/app/command-boundary.mjs";
import { assertHostDeadlineCommand, waitForHostDeadlineDelivery } from "./host_deadline_scenario.mjs";

const game = "deadline-game";

test("real deadline targets support dynamic dates and an existing deadline's 24-hour extension", async () => {
  for (const at of [Date.parse("2026-09-17T02:37:00Z") / 1000, Date.parse("2032-01-14T11:12:00Z") / 1000]) {
    for (const prior of [null, at - 86400]) {
      const fixture = browserFixture(at, prior);
      const result = await waitForHostDeadlineDelivery(fixture.options);
      assert.equal(result.command.at, at);
      assert.equal(result.delivery.observedEventIndex, 1);
      assert.equal(result.apiPhase.deadline, at);
      assert.equal(result.renderedLabel, fixture.label);
    }
  }
});

test("wrong ACK correlation, command scope, target, units or unchanged value cannot qualify", () => {
  for (const mutate of [
    (e) => { e.commandStatus.serverEnvelope.id = 99; },
    (e) => { e.commandStatus.httpStatus = 503; },
    (e) => { e.commandStatus.streamSeqs = []; },
    (e) => { e.commandStatus.requestEnvelope.body.body.command.ExtendDeadline.game = "other"; },
    (e) => { e.commandStatus.requestEnvelope.body.body.command.ExtendDeadline.phase = "D02"; },
    (e) => { e.commandStatus.requestEnvelope.body.body.command.ExtendDeadline.at += 1; },
    (e) => { e.commandStatus.requestEnvelope.body.body.command.ExtendDeadline.at *= 1000; },
    (e) => { e.commandStatus.requestEnvelope.body.body.command.ExtendDeadline.at = "1789000000"; },
    (e) => { e.commandStatus.requestEnvelope.body.body.command.ExtendDeadline.at = -1; },
    (e) => { e.before.phase.deadline = e.commandStatus.requestEnvelope.body.body.command.ExtendDeadline.at; },
    (e) => { e.rejectedCommandStatus.error = "NotAuthorized"; },
  ]) {
    const fixture = browserFixture(1900000000, 1900000000 - 86400);
    mutate(fixture.options);
    assert.throws(() => assertHostDeadlineCommand(fixture.options));
  }
});

test("pre-boundary header, wrong live scope or state and mismatched API or rendered deadline fail with diagnostics", async () => {
  for (const mutate of [
    (f) => { f.window.__fmarchHostLiveProjectionEvents.pop(); },
    (f) => { f.window.__fmarchHostLiveProjectionEvents[1].delta.body.game = "other"; },
    (f) => { f.window.__fmarchHostLiveProjectionEvents[1].delta.body.phase.phase_id = "D02"; },
    (f) => { f.window.__fmarchHostLiveProjectionEvents[1].delta.body.phase.deadline -= 1; },
    (f) => { f.window.__fmarchHostLiveProjectionEvents[1] = { kind: "reconnect", state: "recovered", attempt: 1 }; },
    (f) => { f.window.__fmarchHostProjection.phase.deadline -= 1; },
    (f) => { f.apiPhase.deadline -= 1; },
    (f) => { f.apiPhase.phase_id = "D02"; },
    (f) => { f.label = "Jun 19, 2026, 9:00 PM"; },
  ]) {
    const fixture = browserFixture(1900000000);
    mutate(fixture);
    await assert.rejects(waitForHostDeadlineDelivery(fixture.options), (error) => {
      assert.match(error.message, /host deadline live delivery failed/);
      const evidence = JSON.parse(error.message.slice("host deadline live delivery failed: ".length));
      assert.equal(evidence.commandStatus.state, "ack");
      assert.equal(evidence.before.eventCount, 1);
      assert.ok(evidence.after.eventsSinceBoundary);
      assert.ok(evidence.apiPhase);
      assert.ok(error.cause);
      return true;
    });
  }
});

function browserFixture(at, prior = null) {
  const requestEnvelope = { v: 3, id: 7, body: { kind: "Command", body: { command_id: "new-deadline-command", command: { ExtendDeadline: { game, phase: "D01", at } } } } };
  const commandStatus = structuredClone(normalizeCommandResponse({
    commandId: "new-deadline-command", requestEnvelope, response: { status: 200 },
    serverEnvelope: { v: 3, id: 7, body: { kind: "Ack", body: { stream_seqs: [52] } } },
  }));
  const rejectedCommandStatus = { state: "reject", error: "StreamConflict", retryable: true, requestEnvelope: structuredClone(requestEnvelope) };
  const header = () => ({ kind: "delta", delta: { kind: "HostConsoleHeaderChanged", body: { game, phase: { phase_id: "D01", deadline: at } } } });
  const window = {
    __fmarchHostLiveProjectionEvents: [header(), header()],
    __fmarchHostProjection: { phase: { id: "D01", deadline: at } },
    __fmarchHostLiveProjectionStatus: { state: "updated" },
  };
  const apiPhase = { phase_id: "D01", deadline: at };
  const fixture = { window, apiPhase, label: new Date(at * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" }) };
  const evaluate = async (fn, argument) => structuredClone(await runInNewContext(`(${fn.toString()})(argument)`, { window, argument }));
  const page = { evaluate,
    async waitForFunction(fn, argument) { if (!await evaluate(fn, argument)) throw new Error("fresh deadline header did not arrive"); },
    getByTestId(id) { assert.equal(id, "host-console-deadline"); return { textContent: async () => fixture.label }; },
  };
  fixture.options = { page, game, commandStatus, rejectedCommandStatus,
    before: { eventCount: 1, phase: { id: "D01", deadline: prior } },
    readApiPhase: async () => apiPhase, diagnostics: () => ({ tickets: [], sockets: [] }),
  };
  return fixture;
}
