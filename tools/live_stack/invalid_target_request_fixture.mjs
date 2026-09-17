import { buildCommandEnvelope, normalizeCommandResponse } from "../../frontend/src/lib/app/command-boundary.mjs";

export function invalidTargetCommandStateFixture() {
  return {
    game: "invalid-target-game", actorSlot: "slot_4", actorAlive: true, gameCompleted: false,
    phase: { phaseId: "N01", locked: false },
    actions: [{
      commandKind: "submit_action", actionId: "role_factional_kill", templateId: "factional_kill",
      targets: ["slot-2"], targetOptions: ["slot-2", "slot-3"], grantId: null,
    }],
  };
}

export function invalidTargetRequestFixture() {
  const state = invalidTargetCommandStateFixture();
  const commandId = "invalid-self-command";
  const legalCommand = { SubmitAction: {
    game: state.game, actor_slot: state.actorSlot, action_id: "role_factional_kill",
    template_id: "factional_kill", targets: ["slot-2"], grant_id: null,
  } };
  const requestEnvelope = buildCommandEnvelope({
    commandId, envelopeId: 1,
    command: { SubmitAction: { ...legalCommand.SubmitAction, targets: [state.actorSlot] } },
  });
  const outcome = normalizeCommandResponse({
    commandId, requestEnvelope, response: { status: 200 },
    serverEnvelope: { v: 3, id: 1, body: { kind: "Reject", body: {
      error: "InvalidTarget", retryable: false, message: "self target is not permitted",
    } } },
  });
  const durableBefore = {
    eventCount: 10, maxEventSeq: 1000, maxStreamSeq: 20,
    actionSubmissions: [], voteBallots: [], commandReceipts: [],
  };
  return {
    status: "passed", boundary: "authenticated-request", game: state.game, actorSlot: state.actorSlot,
    phaseId: "N01", authoritativeAction: state.actions[0], legalCommand, outcome,
    durableBefore, durableAfter: structuredClone(durableBefore),
  };
}

export function legalActionAfterInvalidTargetFixture(evidence = invalidTargetRequestFixture()) {
  const commandId = "legal-action-command";
  const requestEnvelope = buildCommandEnvelope({ commandId, envelopeId: 2, command: evidence.legalCommand });
  return normalizeCommandResponse({
    commandId, requestEnvelope, response: { status: 200 },
    serverEnvelope: { v: 3, id: 2, body: { kind: "Ack", body: { stream_seqs: [21] } } },
  });
}
