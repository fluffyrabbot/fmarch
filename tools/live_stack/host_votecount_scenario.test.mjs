import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { proveHostInitialVoteDelivery } from "./host_votecount_scenario.mjs";

const game = "host-vote-game";
const hello = {
  kind: "hello",
  state: "recovered",
  body: { protocol_v: 3, scope: { game } },
};
const voteDelta = {
  kind: "delta",
  delta: {
    kind: "VoteCountChanged",
    body: { game, candidate_slot: "slot_1", count: 1 },
  },
};
const projection = [{ target: "slot_1", count: 1, needed: 7 }];

test("host vote is submitted after Hello recovery and requires a new delta and projection", async () => {
  const fixture = pageFixture();
  let submitted = false;
  const evidence = await proveHostInitialVoteDelivery({
    page: fixture.page,
    game,
    sendCommand: async (principal, command) => {
      assert.equal(fixture.waits(), 1, "Hello recovery must precede the command");
      assert.equal(principal, "player-seed");
      assert.deepEqual(command, {
        SubmitVote: { game, actor_slot: "slot-3", target: { Slot: "slot_1" } },
      });
      submitted = true;
      fixture.window.__fmarchHostLiveProjectionEvents.push(voteDelta);
      fixture.window.__fmarchHostVotecountProjection = projection;
      return { command, streamSeqs: [42] };
    },
  });
  assert.equal(submitted, true);
  assert.equal(evidence.status, "passed");
  assert.deepEqual(evidence.command.streamSeqs, [42]);
  assert.equal(evidence.before.eventCount, 1);
  assert.equal(evidence.after.eventCount, 2);
  assert.deepEqual(evidence.before.projection, []);
  assert.deepEqual(evidence.after.projection, projection);
});

for (const invalidHello of [
  { ...hello, state: undefined },
  { ...hello, body: { protocol_v: 2, scope: { game } } },
  { ...hello, body: { protocol_v: 3, scope: { game: "other-game" } } },
]) {
  test(`no vote before recovered protocol-v3 Hello for this game: ${JSON.stringify(invalidHello)}`, async () => {
    const fixture = pageFixture([invalidHello]);
    let submitted = false;
    await assert.rejects(proveHostInitialVoteDelivery({
      page: fixture.page,
      game,
      sendCommand: async () => { submitted = true; },
    }), /host initial live vote delivery failed/);
    assert.equal(submitted, false);
  });
}

test("current count and repeated Hello cannot substitute for live delivery", async () => {
  const fixture = pageFixture();
  await assert.rejects(proveHostInitialVoteDelivery({
    page: fixture.page,
    game,
    sendCommand: async () => {
      fixture.window.__fmarchHostLiveProjectionEvents.push(hello);
      fixture.window.__fmarchHostVotecountProjection = projection;
      return { streamSeqs: [42] };
    },
  }), /host initial live vote delivery failed/);
});

test("a historical matching vote delta cannot satisfy the new command", async () => {
  const fixture = pageFixture([hello, voteDelta]);
  fixture.window.__fmarchHostVotecountProjection = projection;
  await assert.rejects(proveHostInitialVoteDelivery({
    page: fixture.page,
    game,
    sendCommand: async () => ({ streamSeqs: [42] }),
  }), /host initial live vote delivery failed/);
});

test("fresh live delivery still requires the host projection to update", async () => {
  const fixture = pageFixture();
  await assert.rejects(proveHostInitialVoteDelivery({
    page: fixture.page,
    game,
    sendCommand: async () => {
      fixture.window.__fmarchHostLiveProjectionEvents.push(voteDelta);
      return { streamSeqs: [42] };
    },
  }), /host initial live vote delivery failed/);
});

function pageFixture(events = [hello]) {
  const window = {
    __fmarchHostLiveProjectionEvents: structuredClone(events),
    __fmarchHostVotecountProjection: [],
  };
  let waits = 0;
  const evaluate = (fn, argument) => structuredClone(
    runInNewContext(`(${fn.toString()})(argument)`, { window, argument }),
  );
  return {
    window,
    waits: () => waits,
    page: {
      evaluate,
      async waitForFunction(fn, argument) {
        waits += 1;
        if (!evaluate(fn, argument)) throw new Error("browser wait did not converge");
      },
    },
  };
}
