import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  assertSameVoteRetry,
  classifyContendedVoteRace,
  hasContendedVoteRaceEvidence,
  waitForPlayerVoteTerminal,
} from "./vote_race_scenario.mjs";

const game = "vote-race-game";

for (const loser of [0, 1]) {
  test(`either player may lose contention; player ${loser} retries the original decision`, () => {
    const race = raceFixture(loser);
    assert.deepEqual(classifyContendedVoteRace(race.firstAttempts, game), { winner: 1 - loser, loser });
    assert.equal(hasContendedVoteRaceEvidence(race), true);
    const retry = [race.firstOutcome, race.secondOutcome][loser];
    assert.notEqual(retry.requestEnvelope.id, race.firstAttempts[loser].requestEnvelope.id);
    assertSameVoteRetry(race.firstAttempts[loser], retry);
  });
}

test("unrelated rejects, nonretryable conflicts and interrupted outcomes never count as contention", () => {
  for (const invalid of [
    { state: "reject", error: "NotYourSlot", retryable: true },
    { state: "reject", error: "StreamConflict", retryable: false },
    { state: "interrupted", interruption: "timeout" },
    { state: "pending" },
  ]) {
    const race = raceFixture();
    Object.assign(race.firstAttempts[1], invalid);
    assert.throws(() => classifyContendedVoteRace(race.firstAttempts, game));
    assert.equal(hasContendedVoteRaceEvidence(race), false);
  }
});

test("both first ACKs or both conflicts fail the deliberate contention witness", () => {
  for (const bothAck of [true, false]) {
    const attempts = [outcome(0, bothAck), outcome(1, bothAck)];
    assert.throws(() => classifyContendedVoteRace(attempts, game), /witness one committed ACK/);
  }
});

test("wrong game, actor, target or reused actor command ID cannot qualify a race", () => {
  for (const mutate of [
    (value) => { value.requestEnvelope.body.body.command.SubmitVote.game = "wrong"; },
    (value) => { value.requestEnvelope.body.body.command.SubmitVote.actor_slot = "slot-7"; },
    (value) => { value.requestEnvelope.body.body.command.SubmitVote.target.Slot = "slot_5"; },
    (value) => { value.commandId = "vote-0"; value.requestEnvelope.body.body.command_id = "vote-0"; },
  ]) {
    const race = raceFixture();
    mutate(race.firstAttempts[1]);
    assert.throws(() => classifyContendedVoteRace(race.firstAttempts, game));
  }
});

test("retry must ACK with the same command ID and entire inner payload", () => {
  for (const mutate of [
    (value) => { value.commandId = "new-id"; value.requestEnvelope.body.body.command_id = "new-id"; },
    (value) => { value.requestEnvelope.body.body.command.SubmitVote.target.Slot = "slot_5"; },
    (value) => { value.requestEnvelope.body.body.command.SubmitVote.actor_slot = "slot-7"; },
    (value) => { value.state = "reject"; value.error = "StreamConflict"; value.retryable = true; },
    (value) => { value.streamSeqs = []; },
  ]) {
    const race = raceFixture();
    mutate(race.secondOutcome);
    assert.throws(() => assertSameVoteRetry(race.firstAttempts[1], race.secondOutcome));
    assert.equal(hasContendedVoteRaceEvidence(race), false);
  }
});

test("a forced ID factory or missing retained UI identity cannot prove natural retry", () => {
  for (const change of [
    { commandIdFactoryAbsent: false }, { storedCommandId: "different-command" },
    { controlTestId: "ordinary-vote-control" }, { participant: 0 },
  ]) {
    const race = raceFixture();
    Object.assign(race.retry, change);
    assert.equal(hasContendedVoteRaceEvidence(race), false);
  }
});

test("terminal selection exposes a real reject immediately and cannot reuse it as a retry outcome", async () => {
  const window = { __fmarchPlayerCommandStatus: outcome(1, false) };
  const evaluate = (fn, argument) => structuredClone(runInNewContext(`(${fn.toString()})(argument)`, { window, argument }));
  const page = { evaluate, async waitForFunction(fn, argument) {
    if (!evaluate(fn, argument)) throw new Error("not a new terminal outcome");
  } };
  const first = await waitForPlayerVoteTerminal(page);
  assert.equal(first.error, "StreamConflict");
  await assert.rejects(waitForPlayerVoteTerminal(page, first), /not a new terminal/);
  window.__fmarchPlayerCommandStatus = outcome(1, true, 2);
  const retry = await waitForPlayerVoteTerminal(page, first);
  assertSameVoteRetry(first, retry);
});

function raceFixture(loser = 1) {
  const firstAttempts = [outcome(0, loser !== 0), outcome(1, loser !== 1)];
  const finals = structuredClone(firstAttempts);
  finals[loser] = outcome(loser, true, 2);
  return { game, firstAttempts, winner: 1 - loser, loser, contentionObserved: true,
    retry: { participant: loser, controlTestId: "command-recovery-retry-submit_vote",
      storedCommandId: firstAttempts[loser].commandId, commandIdFactoryAbsent: true },
    firstOutcome: finals[0], secondOutcome: finals[1] };
}

function outcome(index, ack, envelopeId = 1) {
  const commandId = `vote-${index}`;
  return {
    state: ack ? "ack" : "reject", commandId,
    ...(ack ? { streamSeqs: [42 + index] } : { error: "StreamConflict", retryable: true }),
    requestEnvelope: { v: 3, id: envelopeId, body: { kind: "Command", body: {
      command_id: commandId,
      command: { SubmitVote: { game, actor_slot: ["slot-7", "slot_4"][index], target: { Slot: "slot_1" } } },
    } } },
  };
}
