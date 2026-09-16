import assert from "node:assert/strict";

export async function waitForPlayerVoteTerminal(page, previous = null) {
  await page.waitForFunction((previousJson) => {
    const outcome = window.__fmarchPlayerCommandStatus;
    return ["ack", "reject", "interrupted"].includes(outcome?.state) &&
      JSON.stringify(outcome) !== previousJson;
  }, JSON.stringify(previous));
  return await page.evaluate(() => window.__fmarchPlayerCommandStatus);
}

export function classifyContendedVoteRace(firstAttempts, game) {
  const actors = ["slot-7", "slot_4"];
  assert.equal(firstAttempts.length, 2);
  firstAttempts.forEach((outcome, index) => {
    assertVoteIdentity(outcome, game, actors[index]);
    assert.ok(outcome.state === "ack" || isRetryableStreamConflict(outcome),
      `unexpected first vote outcome: ${JSON.stringify(outcome)}`);
  });
  assert.notEqual(firstAttempts[0].commandId, firstAttempts[1].commandId,
    "different actors must submit distinct command IDs");
  const winner = firstAttempts.findIndex((outcome) => outcome.state === "ack");
  const loser = firstAttempts.findIndex(isRetryableStreamConflict);
  assert.ok(winner >= 0 && loser >= 0,
    "vote race must witness one committed ACK and one retryable StreamConflict");
  assertCommittedVote(firstAttempts[winner]);
  return { winner, loser };
}

export function assertSameVoteRetry(firstAttempt, finalOutcome) {
  assert.ok(isRetryableStreamConflict(firstAttempt), "only a retryable StreamConflict may be retried");
  assertCommittedVote(finalOutcome);
  assert.equal(finalOutcome.commandId, firstAttempt.commandId, "vote retry changed its command ID");
  assert.equal(finalOutcome.requestEnvelope?.v, firstAttempt.requestEnvelope?.v);
  assert.deepEqual(finalOutcome.requestEnvelope?.body, firstAttempt.requestEnvelope?.body,
    "vote retry changed its original command payload");
}

export function hasContendedVoteRaceEvidence(race) {
  try {
    const { winner, loser } = classifyContendedVoteRace(race.firstAttempts, race.game);
    assert.equal(race.winner, winner);
    assert.equal(race.loser, loser);
    assert.equal(race.contentionObserved, true);
    assert.equal(race.retry?.participant, loser);
    assert.equal(race.retry.controlTestId, "command-recovery-retry-submit_vote");
    assert.equal(race.retry.storedCommandId, race.firstAttempts[loser].commandId);
    assert.equal(race.retry.commandIdFactoryAbsent, true);
    const finals = [race.firstOutcome, race.secondOutcome];
    assert.deepEqual(finals[winner], race.firstAttempts[winner]);
    assertSameVoteRetry(race.firstAttempts[loser], finals[loser]);
    return true;
  } catch {
    return false;
  }
}

function isRetryableStreamConflict(outcome) {
  return outcome?.state === "reject" && outcome.error === "StreamConflict" && outcome.retryable === true;
}

function assertCommittedVote(outcome) {
  assert.equal(outcome?.state, "ack", "vote must finish with a real ACK");
  assert.ok(Array.isArray(outcome.streamSeqs) && outcome.streamSeqs.length > 0 &&
    outcome.streamSeqs.every((seq) => Number.isSafeInteger(seq) && seq > 0),
  "vote ACK requires committed stream sequences");
}

function assertVoteIdentity(outcome, game, actorSlot) {
  assert.equal(outcome?.requestEnvelope?.v, 3);
  const body = outcome.requestEnvelope.body;
  assert.equal(body?.kind, "Command");
  assert.equal(typeof outcome.commandId, "string");
  assert.ok(outcome.commandId.length > 0);
  assert.equal(body.body?.command_id, outcome.commandId);
  assert.deepEqual(body.body?.command, {
    SubmitVote: { game, actor_slot: actorSlot, target: { Slot: "slot_1" } },
  });
}
