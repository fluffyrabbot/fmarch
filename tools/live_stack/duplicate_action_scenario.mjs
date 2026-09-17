import assert from "node:assert/strict";
import { normalizeCommandResponse } from "../../frontend/src/lib/app/command-boundary.mjs";

export function assertDuplicatePlayerSubmitOutcome({
  firstOutcome, duplicateOutcome, commandId, heldRequest,
}) {
  for (const outcome of [firstOutcome, duplicateOutcome]) {
    assert.equal(outcome.commandId, commandId);
    assert.equal(outcome.requestEnvelope.body.body.command_id, commandId);
    const decoded = normalizeCommandResponse({
      commandId,
      requestEnvelope: outcome.requestEnvelope,
      response: { status: outcome.httpStatus },
      serverEnvelope: outcome.serverEnvelope,
    });
    assert.equal(decoded.state, "ack");
    assert.equal(outcome.state, "ack");
    assert.equal(outcome.envelopeId, outcome.requestEnvelope.id);
    assert.deepEqual(outcome.streamSeqs, decoded.streamSeqs);
    assert.ok(outcome.streamSeqs.length > 0);
  }
  // Envelope counters belong to each browser context. The separately captured
  // HTTP request, not inequality of those counters, proves the second delivery.
  assert.equal(duplicateOutcome.requestEnvelope.v, firstOutcome.requestEnvelope.v);
  assert.deepEqual(duplicateOutcome.requestEnvelope.body, firstOutcome.requestEnvelope.body);
  assert.deepEqual(duplicateOutcome.streamSeqs, firstOutcome.streamSeqs);
  assert.equal(heldRequest.status, "released");
  assert.equal(heldRequest.kind, "SubmitAction");
  assert.equal(heldRequest.pathname, "/commands");
  assert.equal(heldRequest.game, firstOutcome.requestEnvelope.body.body.command.SubmitAction.game);
  assert.equal(heldRequest.commandId, commandId);
  assert.deepEqual(heldRequest.requestEnvelope, duplicateOutcome.requestEnvelope);
  assert.match(heldRequest.bodySha256, /^[0-9a-f]{64}$/u);
  assert.equal(heldRequest.releasedBodySha256, heldRequest.bodySha256);
  assert.ok(Number.isSafeInteger(heldRequest.bodyBytes) && heldRequest.bodyBytes > 0);
  assert.deepEqual(heldRequest.competingCommand, { commandId, streamSeqs: firstOutcome.streamSeqs });
  assert.deepEqual(heldRequest.ordering, [
    "captured-before-competing-command", "competing-command-acked", "continued-unchanged",
  ]);
  return {
    commandId,
    firstEnvelopeId: firstOutcome.envelopeId,
    duplicateEnvelopeId: duplicateOutcome.envelopeId,
    streamSeqs: duplicateOutcome.streamSeqs,
    requestBoundary: "separately-captured-http-request",
  };
}

export function assertDuplicatePlayerActionDurability({ firstOutcome, principalId, phaseId, before, after }) {
  assert.deepEqual(after, before, "duplicate delivery must not change the stream, action, ballot or receipt");
  assert.ok(Number.isSafeInteger(before.eventCount) && before.eventCount > 0);
  assert.ok(Number.isSafeInteger(before.maxEventSeq) && before.maxEventSeq > 0);
  assert.ok(Number.isSafeInteger(before.maxStreamSeq) && before.maxStreamSeq > 0);
  assert.ok(Array.isArray(before.voteBallots));
  const command = firstOutcome.requestEnvelope.body.body.command.SubmitAction;
  assert.equal(before.actionSubmittedEvents.length, 1);
  const event = before.actionSubmittedEvents[0];
  assert.ok(Number.isSafeInteger(event.seq) && event.seq > 0 && event.seq <= before.maxEventSeq);
  assert.ok(firstOutcome.streamSeqs.includes(event.stream_seq));
  assert.ok(event.stream_seq <= before.maxStreamSeq);
  assert.equal(before.actionSubmissions.length, 1);
  const action = before.actionSubmissions[0];
  assert.equal(action.game_id, command.game);
  assert.equal(typeof phaseId, "string");
  assert.ok(phaseId.length > 0);
  assert.equal(action.phase_id, phaseId);
  assert.equal(action.instant_resolved, false);
  assert.equal(action.actor_slot, command.actor_slot);
  assert.equal(action.action_id, command.action_id);
  assert.equal(action.template_id, command.template_id);
  assert.equal(action.grant_id, command.grant_id);
  assert.deepEqual(action.targets, command.targets);
  assert.equal(before.commandReceipts.length, 1);
  assert.equal(typeof principalId, "string");
  assert.ok(principalId.length > 0);
  assert.equal(before.commandReceipts[0].principal_id, principalId);
  assert.equal(before.commandReceipts[0].command_id, firstOutcome.commandId);
  assert.equal(before.commandReceipts[0].stream_id, command.game);
  assert.deepEqual(before.commandReceipts[0].stream_seqs, firstOutcome.streamSeqs);
  return { status: "passed", before, after };
}
