import assert from "node:assert/strict";
import test from "node:test";
import {
  hasInvalidTargetRequestEvidence,
  hasInvalidTargetRequestThenLegalAction,
  proveInvalidSelfTargetRequest,
} from "./invalid_target_request_scenario.mjs";
import {
  invalidTargetCommandStateFixture,
  invalidTargetRequestFixture,
  legalActionAfterInvalidTargetFixture,
} from "./invalid_target_request_fixture.mjs";

test("authenticated request changes only self target and records real response plus unchanged durable state", async () => {
  const fixture = invalidTargetRequestFixture();
  const order = [];
  const options = {
    context: { request: { async post(url, request) {
      order.push("post");
      assert.equal(url, "https://fixture.invalid/commands");
      assert.deepEqual(Object.keys(request), ["data"], "reuse the context without auth or response overrides");
      assert.deepEqual(request.data, fixture.outcome.requestEnvelope);
      return { status: () => 200, json: async () => fixture.outcome.serverEnvelope };
    } } },
    commandUrl: "https://fixture.invalid/commands",
    commandState: invalidTargetCommandStateFixture(), templateId: "factional_kill",
    commandId: fixture.outcome.commandId, envelopeId: 1,
    readDurableState: async (commandId) => {
      assert.equal(commandId, fixture.outcome.commandId);
      order.push("durable");
      return structuredClone(fixture.durableBefore);
    },
  };
  const evidence = await proveInvalidSelfTargetRequest(options);
  assert.deepEqual(order, ["durable", "post", "durable"]);
  assert.deepEqual(evidence, fixture);
  assert.equal(hasInvalidTargetRequestThenLegalAction(evidence, legalActionAfterInvalidTargetFixture(evidence)), true);
});

test("a local rejection, wrong server result, wrong identity, or durable mutation cannot qualify", () => {
  for (const mutate of [
    (e) => { e.boundary = "browser-rendered-recovery"; },
    (e) => { delete e.outcome.serverEnvelope; },
    (e) => { e.outcome.serverEnvelope.id += 1; },
    (e) => { e.outcome.serverEnvelope.body.body.error = "NotAuthorized"; },
    (e) => { e.outcome.httpStatus = 503; },
    (e) => { e.outcome.requestEnvelope.body.body.command.SubmitAction.action_id = "invalid_self_factional_kill"; },
    (e) => { e.outcome.requestEnvelope.body.body.command.SubmitAction.actor_slot = "other"; },
    (e) => { e.outcome.requestEnvelope.body.body.command.SubmitAction.game = "other"; },
    (e) => { e.outcome.requestEnvelope.body.body.command.SubmitAction.targets = ["slot-2"]; },
    (e) => { e.authoritativeAction.targetOptions.push("slot_4"); },
    (e) => { e.durableAfter.eventCount += 1; },
    (e) => { e.durableAfter.maxEventSeq += 1; },
    (e) => { e.durableAfter.maxStreamSeq += 1; },
    (e) => { e.durableAfter.actionSubmissions.push({ targets: ["slot_4"] }); },
    (e) => { e.durableAfter.voteBallots.push({ target: "slot_4" }); },
    (e) => { e.durableAfter.commandReceipts.push({ command_id: e.outcome.commandId }); },
    (e) => { e.durableBefore.commandReceipts.push({ command_id: e.outcome.commandId }); e.durableAfter = structuredClone(e.durableBefore); },
  ]) {
    const evidence = structuredClone(invalidTargetRequestFixture());
    mutate(evidence);
    assert.equal(hasInvalidTargetRequestEvidence(evidence), false);
  }
  const evidence = invalidTargetRequestFixture();
  evidence.durableBefore.actionSubmissions = [{ action_id: "other", targets: ["slot-2"] }];
  evidence.durableAfter.actionSubmissions = [{ action_id: "other", targets: ["slot-3"] }];
  assert.equal(hasInvalidTargetRequestEvidence(evidence), false, "same-count row mutation must fail");
});

test("legal UI followup must commit a distinct command with the original valid action identity", () => {
  const evidence = invalidTargetRequestFixture();
  for (const mutate of [
    (outcome) => { outcome.state = "reject"; },
    (outcome) => { delete outcome.serverEnvelope; },
    (outcome) => { outcome.serverEnvelope.id += 1; },
    (outcome) => { outcome.streamSeqs = []; },
    (outcome) => { outcome.streamSeqs = [evidence.durableAfter.maxStreamSeq]; },
    (outcome) => { outcome.commandId = evidence.outcome.commandId; },
    (outcome) => { outcome.requestEnvelope.body.body.command.SubmitAction.action_id = "invented"; },
    (outcome) => { outcome.requestEnvelope.body.body.command.SubmitAction.targets = ["slot_4"]; },
  ]) {
    const outcome = structuredClone(legalActionAfterInvalidTargetFixture(evidence));
    mutate(outcome);
    assert.equal(hasInvalidTargetRequestThenLegalAction(evidence, outcome), false);
  }
});

test("legal ACK progress uses stream position independently of larger global event IDs", () => {
  const evidence = invalidTargetRequestFixture();
  const outcome = legalActionAfterInvalidTargetFixture(evidence);
  assert.equal(evidence.durableAfter.maxEventSeq, 1000);
  assert.equal(evidence.durableAfter.maxStreamSeq, 20);
  assert.deepEqual(outcome.streamSeqs, [21]);
  assert.equal(hasInvalidTargetRequestThenLegalAction(evidence, outcome), true);
  const stale = structuredClone(outcome);
  stale.streamSeqs = [20];
  stale.serverEnvelope.body.body.stream_seqs = [20];
  assert.equal(hasInvalidTargetRequestThenLegalAction(evidence, stale), false);
});
