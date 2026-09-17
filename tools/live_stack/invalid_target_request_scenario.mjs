import assert from "node:assert/strict";
import {
  buildCommandEnvelope,
  buildPlayerCommand,
  normalizeCommandResponse,
} from "../../frontend/src/lib/app/command-boundary.mjs";
import { phaseDetailsFromId } from "../../frontend/src/lib/phase-id.mjs";

// This probes server admission using the real player's cookie-bearing context.
// It does not click a synthetic control or claim rendered rejection/recovery.
export async function proveInvalidSelfTargetRequest({
  context, commandUrl, commandState, templateId, commandId, envelopeId, readDurableState,
}) {
  assert.equal(new URL(commandUrl).pathname, "/commands");
  assert.equal(commandState.actorAlive, true);
  assert.equal(commandState.gameCompleted, false);
  assert.equal(commandState.phase?.locked, false);
  assert.ok(phaseDetailsFromId(commandState.phase.phaseId));
  const matches = commandState.actions.filter((action) => action.templateId === templateId);
  assert.equal(matches.length, 1, "invalid-target fixture requires one current authoritative action");
  const authoritativeAction = structuredClone(matches[0]);
  const legalCommand = authoritativeCommand(commandState.game, commandState.actorSlot, authoritativeAction);
  const requestEnvelope = buildCommandEnvelope({
    commandId,
    envelopeId,
    command: { SubmitAction: { ...legalCommand.SubmitAction, targets: [commandState.actorSlot] } },
  });
  const durableBefore = await readDurableState(commandId);
  const response = await context.request.post(commandUrl, { data: requestEnvelope });
  const serverEnvelope = await response.json();
  const outcome = normalizeCommandResponse({
    commandId, requestEnvelope, response: { status: response.status() }, serverEnvelope,
  });
  const durableAfter = await readDurableState(commandId);
  const evidence = {
    status: "passed",
    boundary: "authenticated-request",
    game: commandState.game,
    actorSlot: commandState.actorSlot,
    phaseId: commandState.phase.phaseId,
    authoritativeAction,
    legalCommand,
    outcome,
    durableBefore,
    durableAfter,
  };
  assertInvalidTargetRequestEvidence(evidence);
  return evidence;
}

function authoritativeCommand(game, actorSlot, action) {
  assert.equal(action.commandKind, "submit_action");
  assert.ok(Array.isArray(action.targetOptions) && action.targetOptions.length > 0);
  assert.ok(!action.targetOptions.includes(actorSlot), "self must be excluded by current target options");
  assert.ok(Array.isArray(action.targets) && action.targets.length === 1);
  assert.ok(action.targets.every((target) => action.targetOptions.includes(target)));
  return buildPlayerCommand({ action: "submit_action", game, actorSlot, actionConfig: action });
}

export function assertInvalidTargetRequestEvidence(evidence) {
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.boundary, "authenticated-request");
  assert.ok(phaseDetailsFromId(evidence.phaseId));
  const legal = authoritativeCommand(evidence.game, evidence.actorSlot, evidence.authoritativeAction);
  assert.deepEqual(evidence.legalCommand, legal);
  const outcome = evidence.outcome;
  assert.deepEqual(outcome.requestEnvelope.body.body.command, {
    SubmitAction: { ...legal.SubmitAction, targets: [evidence.actorSlot] },
  }, "only the targets may differ from the current authoritative action");
  assert.equal(outcome.requestEnvelope.body.body.command_id, outcome.commandId);
  const decoded = normalizeCommandResponse({
    commandId: outcome.commandId,
    requestEnvelope: outcome.requestEnvelope,
    response: { status: outcome.httpStatus },
    serverEnvelope: outcome.serverEnvelope,
  });
  assert.deepEqual(outcome, decoded);
  assert.equal(outcome.httpStatus, 200);
  assert.equal(outcome.state, "reject");
  assert.equal(outcome.error, "InvalidTarget");
  assert.equal(outcome.retryable, false);
  const before = evidence.durableBefore;
  assert.ok(Number.isSafeInteger(before.eventCount) && before.eventCount > 0);
  assert.ok(Number.isSafeInteger(before.maxEventSeq) && before.maxEventSeq > 0);
  assert.ok(Number.isSafeInteger(before.maxStreamSeq) && before.maxStreamSeq > 0);
  assert.ok(Array.isArray(before.actionSubmissions));
  assert.ok(Array.isArray(before.voteBallots));
  assert.deepEqual(before.commandReceipts, []);
  assert.deepEqual(evidence.durableAfter, before, "rejected target must leave durable game state unchanged");
}

export function hasInvalidTargetRequestEvidence(evidence) {
  try {
    assertInvalidTargetRequestEvidence(evidence);
    return true;
  } catch {
    return false;
  }
}

export function assertLegalActionAfterInvalidTargetRequest(evidence, outcome) {
  assertInvalidTargetRequestEvidence(evidence);
  const decoded = normalizeCommandResponse({
    commandId: outcome.commandId,
    requestEnvelope: outcome.requestEnvelope,
    response: { status: outcome.httpStatus },
    serverEnvelope: outcome.serverEnvelope,
  });
  assert.equal(decoded.state, "ack");
  assert.deepEqual(outcome.streamSeqs, decoded.streamSeqs);
  assert.equal(outcome.state, "ack");
  assert.ok(Array.isArray(outcome.streamSeqs) && outcome.streamSeqs.length > 0);
  assert.ok(outcome.streamSeqs.every((seq) => Number.isSafeInteger(seq) && seq > evidence.durableAfter.maxStreamSeq));
  assert.notEqual(outcome.commandId, evidence.outcome.commandId);
  assert.equal(outcome.requestEnvelope.body.body.command_id, outcome.commandId);
  assert.deepEqual(outcome.requestEnvelope.body.body.command, evidence.legalCommand);
}

export function hasInvalidTargetRequestThenLegalAction(evidence, outcome) {
  try {
    assertLegalActionAfterInvalidTargetRequest(evidence, outcome);
    return true;
  } catch {
    return false;
  }
}
