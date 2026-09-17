import { normalizeCommandResponse } from "../../frontend/src/lib/app/command-boundary.mjs";
import { fixturePrincipalAuthorityId } from "../principal_fixture.mjs";

export function hostReplacementFixture() {
  const expected = {
    game: "7a840998-445b-4b84-a1aa-58de466af2de",
    slotId: "slot-7", handle: "rowan",
    incomingPrincipalId: fixturePrincipalAuthorityId("player-rowan"),
    hostPrincipalId: fixturePrincipalAuthorityId("host_h"),
  };
  const outgoing = {
    slotId: expected.slotId, personaId: "2d3b3fe2-b1c7-4afc-8bb5-b221f3710bfd",
    assignedPrincipalId: fixturePrincipalAuthorityId("player-mira"), occupantLabel: "player-mira",
  };
  const candidate = {
    game: expected.game, slotId: expected.slotId, incomingPrincipalId: expected.incomingPrincipalId,
    handle: expected.handle, outgoing,
    lookup: {
      pathname: `/api/gameplay/games/${expected.game}/replacement-candidate`,
      method: "GET", status: 200, slotId: expected.slotId, handle: expected.handle,
      body: { slot_id: expected.slotId, outgoing_persona_id: outgoing.personaId,
        principal_id: expected.incomingPrincipalId, handle: expected.handle, display_name: "Rowan" },
    },
    renderedText: "Rowan @rowan replaces player-mira in Slot 7",
    renderedIdentity: { handle: expected.handle, slotId: expected.slotId, outgoingPersonaId: outgoing.personaId },
  };
  const requestEnvelope = { v: 3, id: 5, body: { kind: "Command", body: {
    command_id: "f2e2141b-f577-4fe2-8d3b-d596703a454b",
    command: { ProcessReplacement: { game: expected.game, slot: expected.slotId,
      outgoing_persona_id: outgoing.personaId, incoming_principal_id: expected.incomingPrincipalId } },
  } } };
  const commandStatus = structuredClone(normalizeCommandResponse({
    commandId: requestEnvelope.body.body.command_id, requestEnvelope, response: { status: 200 },
    serverEnvelope: { v: 3, id: 5, body: { kind: "Ack", body: { stream_seqs: [51, 52, 53] } } },
  }));
  const oldEpoch = {
    game_id: expected.game, slot_id: expected.slotId, persona_id: outgoing.personaId,
    principal_id: outgoing.assignedPrincipalId,
    occupancy_id: "a265ab7c-542c-4ef6-afb2-292d9b858732",
    transition_id: "22c0c1f2-ccf0-4f6f-acd1-1e899a6eb537",
    began_seq: 900, ended_seq: null, start_reason: "registration", end_reason: null,
  };
  const durableBefore = {
    events: [{ seq: 1000, stream_seq: 50, kind: "PhaseUnlocked" }],
    epochs: [oldEpoch], commandReceipts: [],
  };
  const durableAfter = {
    events: [...durableBefore.events,
      { seq: 1100, stream_seq: 51, kind: "GamePersonaRegistered" },
      { seq: 1101, stream_seq: 52, kind: "SlotOccupancyEnded" },
      { seq: 1102, stream_seq: 53, kind: "SlotOccupancyStarted" },
    ],
    epochs: [
      { ...oldEpoch, ended_seq: 1101, end_reason: "replaced" },
      { ...oldEpoch,
        occupancy_id: "dd87006c-c966-42ae-a603-18740bfdeaf8",
        persona_id: "71f12c1e-6adb-42cf-9d53-ef0b295f5873",
        transition_id: "5d51304b-0dcf-4f12-afdc-0d6bbe0891d9",
        principal_id: expected.incomingPrincipalId, began_seq: 1102, start_reason: "replacement",
      },
    ],
    commandReceipts: [{ principal_id: expected.hostPrincipalId, stream_id: expected.game,
      command_id: commandStatus.commandId, stream_seqs: commandStatus.streamSeqs }],
  };
  return {
    expected,
    evidence: structuredClone({ candidate, confirmationMessage: "Process replacement for slot-7 / player-mira: replace player-mira with Rowan (@rowan) and preserve slot history.",
      commandStatus, durableBefore, durableAfterLookup: structuredClone(durableBefore), durableAfter }),
  };
}
