import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { normalizeCommandResponse } from "../../frontend/src/lib/app/command-boundary.mjs";
import { assertDuplicatePlayerActionDurability, assertDuplicatePlayerSubmitOutcome } from "./duplicate_action_scenario.mjs";

test("separate browser requests may each use envelope 1 for the same durable action", () => {
  const fixture = duplicateFixture();
  assert.equal(fixture.firstOutcome.envelopeId, fixture.duplicateOutcome.envelopeId);
  assert.equal(assertDuplicatePlayerSubmitOutcome(fixture).requestBoundary, "separately-captured-http-request");
});

test("each response correlates to its own request even when the two envelope IDs differ", () => {
  const fixture = duplicateFixture(2);
  assert.equal(assertDuplicatePlayerSubmitOutcome(fixture).duplicateEnvelopeId, 2);
});

test("malformed response, mismatched capture, changed command or missing first commit cannot prove a duplicate", () => {
  for (const mutate of [
    (e) => { delete e.heldRequest; },
    (e) => { e.firstOutcome.serverEnvelope.body.kind = "Reject"; },
    (e) => { e.firstOutcome.serverEnvelope.id = 99; },
    (e) => { delete e.duplicateOutcome.serverEnvelope; },
    (e) => { e.duplicateOutcome.serverEnvelope.id = 99; },
    (e) => { e.duplicateOutcome.httpStatus = 503; },
    (e) => { e.duplicateOutcome.streamSeqs = [99]; e.duplicateOutcome.serverEnvelope.body.body.stream_seqs = [99]; },
    (e) => { e.duplicateOutcome.requestEnvelope.body.body.command.SubmitAction.targets = ["other"]; },
    (e) => { e.duplicateOutcome.requestEnvelope.body.body.command_id = "other"; },
    (e) => { e.heldRequest.requestEnvelope.id = 99; },
    (e) => { e.heldRequest.requestEnvelope.body.body.command.SubmitAction.targets = ["other"]; },
    (e) => { e.heldRequest.status = "captured"; },
    (e) => { e.heldRequest.pathname = "/other"; },
    (e) => { e.heldRequest.bodySha256 = "not-a-hash"; },
    (e) => { e.heldRequest.releasedBodySha256 = "0".repeat(64); },
    (e) => { e.heldRequest.competingCommand.streamSeqs = [99]; },
    (e) => { e.heldRequest.competingCommand.commandId = "other"; },
    (e) => { e.heldRequest.ordering.reverse(); },
  ]) {
    const fixture = duplicateFixture();
    mutate(fixture);
    assert.throws(() => assertDuplicatePlayerSubmitOutcome(fixture));
  }
});

function duplicateFixture(duplicateEnvelopeId = 1) {
  const commandId = "same-action-command";
  const envelope = (id) => ({ v: 3, id, body: { kind: "Command", body: {
    command_id: commandId, command: { SubmitAction: {
      game: "action-game", actor_slot: "slot_4", action_id: "role_factional_kill",
      template_id: "factional_kill", targets: ["slot-2"], grant_id: null,
    } },
  } } });
  const outcome = (id) => normalizeCommandResponse({
    commandId, requestEnvelope: envelope(id), response: { status: 200 },
    serverEnvelope: { v: 3, id, body: { kind: "Ack", body: { stream_seqs: [18] } } },
  });
  const requestEnvelope = envelope(duplicateEnvelopeId);
  const bytes = Buffer.from(JSON.stringify(requestEnvelope));
  const bodySha256 = createHash("sha256").update(bytes).digest("hex");
  return structuredClone({
    commandId,
    firstOutcome: outcome(1),
    duplicateOutcome: outcome(duplicateEnvelopeId),
    heldRequest: {
      status: "released", kind: "SubmitAction", game: "action-game", pathname: "/commands", commandId,
      requestEnvelope, bodySha256, releasedBodySha256: bodySha256, bodyBytes: bytes.length,
      competingCommand: { commandId, streamSeqs: [18] },
      ordering: ["captured-before-competing-command", "competing-command-acked", "continued-unchanged"],
    },
  });
}

test("durable duplicate evidence requires the actual single event, submission and exact receipt", () => {
  const firstOutcome = duplicateFixture().firstOutcome;
  const before = {
    eventCount: 18, maxEventSeq: 1000, maxStreamSeq: 18,
    actionSubmittedEvents: [{ seq: 1000, stream_seq: 18 }],
    actionSubmissions: [{
      game_id: "action-game", actor_slot: "slot_4", phase_id: "N01", action_id: "role_factional_kill",
      template_id: "factional_kill", grant_id: null, targets: ["slot-2"], instant_resolved: false,
    }],
    voteBallots: [],
    commandReceipts: [{ principal_id: "actor", command_id: firstOutcome.commandId, stream_id: "action-game", stream_seqs: [18] }],
  };
  assert.equal(assertDuplicatePlayerActionDurability({ firstOutcome, principalId: "actor", phaseId: "N01", before, after: structuredClone(before) }).status, "passed");
  for (const mutate of [
    (e) => { e.after.eventCount += 1; },
    (e) => { e.after.maxEventSeq += 1; },
    (e) => { e.after.maxStreamSeq += 1; },
    (e) => { e.after.actionSubmissions.push(structuredClone(e.after.actionSubmissions[0])); },
    (e) => { e.after.actionSubmissions[0].targets = ["other"]; },
    (e) => { e.after.commandReceipts.push(structuredClone(e.after.commandReceipts[0])); },
    (e) => { e.before.actionSubmittedEvents = []; e.after = structuredClone(e.before); },
    (e) => { e.before.actionSubmittedEvents[0].stream_seq = 17; e.after = structuredClone(e.before); },
    (e) => { e.before.actionSubmissions[0].action_id = "invented"; e.after = structuredClone(e.before); },
    (e) => { e.before.actionSubmissions[0].phase_id = "N02"; e.after = structuredClone(e.before); },
    (e) => { e.before.actionSubmissions[0].instant_resolved = true; e.after = structuredClone(e.before); },
    (e) => { e.before.commandReceipts[0].stream_seqs = [17]; e.after = structuredClone(e.before); },
    (e) => { e.before.commandReceipts[0].principal_id = "other"; e.after = structuredClone(e.before); },
    (e) => { e.before.commandReceipts[0].stream_id = "other"; e.after = structuredClone(e.before); },
  ]) {
    const fixture = { firstOutcome, principalId: "actor", phaseId: "N01", before: structuredClone(before), after: structuredClone(before) };
    mutate(fixture);
    assert.throws(() => assertDuplicatePlayerActionDurability(fixture));
  }
});
