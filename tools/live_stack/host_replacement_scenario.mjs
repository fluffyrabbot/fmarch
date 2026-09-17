import assert from "node:assert/strict";
import { normalizeCommandResponse } from "../../frontend/src/lib/app/command-boundary.mjs";

export function assertHostReplacementCandidate(candidate) {
  const { game, slotId, incomingPrincipalId, handle, outgoing, lookup, renderedText, renderedIdentity } = candidate;
  assert.equal(lookup.pathname, `/api/gameplay/games/${game}/replacement-candidate`);
  assert.equal(lookup.method, "GET");
  assert.equal(lookup.status, 200);
  assert.equal(lookup.slotId, slotId);
  assert.equal(lookup.handle, handle);
  assert.equal(outgoing.slotId, slotId);
  assert.ok(outgoing.personaId);
  assert.ok(outgoing.assignedPrincipalId);
  assert.notEqual(outgoing.assignedPrincipalId, incomingPrincipalId);
  assert.equal(lookup.body.slot_id, slotId);
  assert.equal(lookup.body.outgoing_persona_id, outgoing.personaId);
  assert.equal(lookup.body.principal_id, incomingPrincipalId);
  assert.equal(lookup.body.handle, handle);
  assert.ok(lookup.body.display_name);
  assert.ok(renderedText.includes(`@${handle}`));
  assert.ok(renderedText.includes(lookup.body.display_name));
  assert.ok(renderedText.includes(outgoing.occupantLabel));
  assert.deepEqual(renderedIdentity, { handle, slotId, outgoingPersonaId: outgoing.personaId });
  return candidate;
}

export function assertHostReplacementEvidence(evidence, expected) {
  const { candidate, confirmationMessage, commandStatus, durableBefore, durableAfterLookup, durableAfter } = evidence;
  assertHostReplacementCandidate(candidate);
  assert.equal(candidate.game, expected.game);
  assert.equal(candidate.slotId, expected.slotId);
  assert.equal(candidate.incomingPrincipalId, expected.incomingPrincipalId);
  assert.equal(candidate.handle, expected.handle);
  for (const text of [candidate.lookup.body.display_name, `@${expected.handle}`, candidate.outgoing.occupantLabel, expected.slotId]) {
    assert.ok(confirmationMessage.includes(text));
  }
  // Looking up a member is a read; only the later confirmed command may mutate.
  assert.deepEqual(durableAfterLookup, durableBefore);
  const normalized = normalizeCommandResponse({
    commandId: commandStatus.commandId,
    requestEnvelope: commandStatus.requestEnvelope,
    response: { status: commandStatus.httpStatus },
    serverEnvelope: commandStatus.serverEnvelope,
  });
  assert.equal(normalized.state, "ack");
  assert.equal(commandStatus.state, "ack");
  assert.deepEqual(commandStatus.streamSeqs, normalized.streamSeqs);
  assert.deepEqual(commandStatus.requestEnvelope.body.body.command, {
    ProcessReplacement: {
      game: expected.game,
      slot: expected.slotId,
      outgoing_persona_id: candidate.outgoing.personaId,
      incoming_principal_id: expected.incomingPrincipalId,
    },
  });
  const appended = durableAfter.events.slice(durableBefore.events.length);
  assert.deepEqual(durableAfter.events.slice(0, durableBefore.events.length), durableBefore.events);
  // This fixture's incoming member has never occupied this game: registration,
  // old-epoch closure and new-epoch opening are one confirmed transition.
  assert.deepEqual(appended.map((event) => event.kind), [
    "GamePersonaRegistered", "SlotOccupancyEnded", "SlotOccupancyStarted",
  ]);
  assert.deepEqual(appended.map((event) => event.stream_seq), commandStatus.streamSeqs);
  for (let index = 0; index < appended.length; index++) {
    const event = appended[index];
    assert.ok(Number.isSafeInteger(event.seq) && event.seq > 0);
    assert.ok(Number.isSafeInteger(event.stream_seq) && event.stream_seq > 0);
    const previous = index === 0 ? durableBefore.events.at(-1) : appended[index - 1];
    assert.ok(event.seq > (previous?.seq ?? 0));
    assert.equal(event.stream_seq, (previous?.stream_seq ?? 0) + 1);
  }
  assert.equal(durableBefore.epochs.length, 1);
  const oldEpoch = durableBefore.epochs[0];
  assert.equal(oldEpoch.game_id, expected.game);
  assert.equal(oldEpoch.slot_id, expected.slotId);
  assert.equal(oldEpoch.persona_id, candidate.outgoing.personaId);
  assert.equal(oldEpoch.principal_id, candidate.outgoing.assignedPrincipalId);
  assert.equal(oldEpoch.ended_seq, null);
  assert.equal(oldEpoch.end_reason, null);
  assert.equal(durableAfter.epochs.length, 2);
  const closed = durableAfter.epochs.find((epoch) => epoch.occupancy_id === oldEpoch.occupancy_id);
  assert.deepEqual(closed, { ...oldEpoch, ended_seq: appended[1].seq, end_reason: "replaced" });
  const incoming = durableAfter.epochs.find((epoch) => epoch.occupancy_id !== oldEpoch.occupancy_id);
  assert.ok(incoming.occupancy_id && incoming.persona_id && incoming.transition_id);
  assert.equal(incoming.game_id, expected.game);
  assert.equal(incoming.slot_id, expected.slotId);
  assert.equal(incoming.principal_id, expected.incomingPrincipalId);
  assert.notEqual(incoming.persona_id, oldEpoch.persona_id);
  assert.notEqual(incoming.transition_id, oldEpoch.transition_id);
  assert.equal(incoming.began_seq, appended[2].seq);
  assert.equal(incoming.start_reason, "replacement");
  assert.equal(incoming.ended_seq, null);
  assert.equal(incoming.end_reason, null);
  assert.deepEqual(durableBefore.commandReceipts, []);
  assert.deepEqual(durableAfter.commandReceipts, [{
    principal_id: expected.hostPrincipalId,
    stream_id: expected.game,
    command_id: commandStatus.commandId,
    stream_seqs: commandStatus.streamSeqs,
  }]);
  return evidence;
}

export function hasHostReplacementEvidence(evidence, expected) {
  try {
    assertHostReplacementEvidence(evidence, expected);
    return true;
  } catch {
    return false;
  }
}
