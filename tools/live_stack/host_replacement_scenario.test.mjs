import assert from "node:assert/strict";
import test from "node:test";
import { assertHostReplacementCandidate, assertHostReplacementEvidence, hasHostReplacementEvidence } from "./host_replacement_scenario.mjs";
import { hostReplacementFixture } from "./host_replacement_fixture.mjs";

test("real candidate read and correlated confirmed command produce exactly one immutable occupancy transition", () => {
  const { evidence, expected } = hostReplacementFixture();
  assert.equal(assertHostReplacementEvidence(evidence, expected), evidence);
  assert.equal(hasHostReplacementEvidence(evidence, expected), true);
  assert.ok(evidence.durableAfter.events.at(-1).seq > evidence.commandStatus.streamSeqs.at(-1));
});

test("wrong handle, seat, outgoing persona, member or failed lookup cannot select a candidate", () => {
  for (const mutate of [
    (c) => { c.lookup.pathname = "/api/gameplay/games/other/replacement-candidate"; },
    (c) => { c.lookup.method = "POST"; },
    (c) => { c.lookup.status = 404; },
    (c) => { c.lookup.slotId = "slot-2"; },
    (c) => { c.lookup.handle = "other"; },
    (c) => { c.lookup.body.slot_id = "slot-2"; },
    (c) => { c.lookup.body.outgoing_persona_id = "old-persona"; },
    (c) => { c.lookup.body.principal_id = "other-member"; },
    (c) => { c.lookup.body.handle = "other"; },
    (c) => { c.renderedText = "Rowan @rowan"; },
    (c) => { c.renderedText = "player-mira"; },
    (c) => { c.renderedIdentity.outgoingPersonaId = "stale-persona"; },
  ]) {
    const { evidence } = hostReplacementFixture();
    mutate(evidence.candidate);
    assert.throws(() => assertHostReplacementCandidate(evidence.candidate));
  }
});

test("lookup writes, mismatched ACK, extra transition and wrong durable authority fail", () => {
  for (const mutate of [
    (e) => { e.confirmationMessage = "Replace player-mira in slot-7 with Rowan?"; },
    (e) => { e.confirmationMessage = "Replace player-mira in slot-2 with Rowan (@rowan)?"; },
    (e) => { e.durableAfterLookup.events.push({ seq: 1100, stream_seq: 51, kind: "SlotOccupancyEnded" }); },
    (e) => { e.commandStatus.serverEnvelope.id++; },
    (e) => { e.commandStatus.httpStatus = 503; },
    (e) => { e.commandStatus.streamSeqs = [1100, 1101, 1102]; },
    (e) => { e.commandStatus.requestEnvelope.body.body.command.ProcessReplacement.outgoing_persona_id = "stale"; },
    (e) => { e.commandStatus.requestEnvelope.body.body.command.ProcessReplacement.incoming_principal_id = e.candidate.outgoing.assignedPrincipalId; },
    (e) => { e.durableAfter.events.push({ seq: 1103, stream_seq: 54, kind: "SlotOccupancyEnded" }); },
    (e) => { e.durableAfter.events[1].kind = "SlotOccupancyEnded"; },
    (e) => { e.durableAfter.events[2].stream_seq++; },
    (e) => { e.durableAfter.epochs[0].ended_seq = null; },
    (e) => { e.durableAfter.epochs[0].ended_seq = 52; },
    (e) => { e.durableAfter.epochs[1].began_seq = 53; },
    (e) => { e.durableAfter.epochs.push(structuredClone(e.durableAfter.epochs[1])); },
    (e) => { e.durableAfter.epochs[1].principal_id = "other"; },
    (e) => { e.durableAfter.epochs[1].slot_id = "slot-2"; },
    (e) => { e.durableAfter.commandReceipts = []; },
    (e) => { e.durableAfter.commandReceipts[0].principal_id = "other-host"; },
    (e) => { e.durableAfter.commandReceipts[0].command_id = "other-command"; },
  ]) {
    const { evidence, expected } = hostReplacementFixture();
    mutate(evidence);
    assert.equal(hasHostReplacementEvidence(evidence, expected), false);
  }
});
