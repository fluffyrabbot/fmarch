import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { captureHeldBrowserPost } from "./held_command_scenario.mjs";

const game = "held-game";
const initialRecovery = {
  game, channelId: "main", eventCount: 1,
  hello: { kind: "hello", state: "recovered", body: {
    protocol_v: 3, scope: { game, channel: "main" },
  } },
};
const envelope = {
  v: 3, id: 1, body: { kind: "Command", body: {
    command_id: "same-browser-command", command: { SubmitVote: { game, actor_slot: "slot-7", target: { Slot: "slot_1" } } },
  } },
};

test("real request remains held until competing commit and continues byte-for-byte without overrides", async () => {
  const fixture = pageFixture();
  const held = await capture(fixture);
  assert.equal(fixture.continued.length, 0);
  await assert.rejects(held.releaseAfter({ streamSeqs: [] }));
  assert.equal(fixture.continued.length, 0);
  const receipt = await held.releaseAfter({ commandId: "winner", streamSeqs: [42] });
  await held.completion;
  assert.deepEqual(fixture.continued, [[]]);
  assert.equal(receipt.commandId, "same-browser-command");
  assert.equal(receipt.bodySha256, createHash("sha256").update(JSON.stringify(envelope)).digest("hex"));
  assert.equal(receipt.releasedBodySha256, receipt.bodySha256);
  assert.deepEqual(receipt.ordering, ["captured-before-competing-command", "competing-command-acked", "continued-unchanged"]);
  assert.equal(fixture.unrouted(), 1);
  await held.dispose();
  assert.equal(fixture.unrouted(), 1);
  await assert.rejects(held.releaseAfter({ streamSeqs: [42] }));
});

test("failed competing operation can abort the captured request and remove routing", async () => {
  const fixture = pageFixture();
  const held = await capture(fixture);
  await held.dispose();
  assert.equal(fixture.aborted(), 1);
  assert.equal(fixture.unrouted(), 1);
  assert.equal(fixture.continued.length, 0);
});

test("only the expected game and typed command can be captured", async () => {
  for (const command of [{ SubmitVote: { game: "wrong" } }, { LockThread: { game } }]) {
    const fixture = pageFixture({ ...envelope, body: { ...envelope.body, body: { ...envelope.body.body, command } } });
    await assert.rejects(capture(fixture), /unexpected held SubmitVote/);
    assert.equal(fixture.aborted(), 1);
    assert.equal(fixture.unrouted(), 1);
  }
});

test("missing or wrong-scope recovered Hello cannot establish a held command boundary", async () => {
  for (const change of [
    { eventCount: 0 }, { game: "wrong" }, { channelId: "private" },
    { hello: { ...initialRecovery.hello, kind: "delta" } },
    { hello: { ...initialRecovery.hello, state: "connected" } },
    { hello: { ...initialRecovery.hello, body: { protocol_v: 3, scope: { game, channel: "private" } } } },
  ]) {
    const fixture = pageFixture();
    await assert.rejects(captureHeldBrowserPost(fixture.page, {
      game, kind: "SubmitVote", initialRecovery: { ...initialRecovery, ...change }, trigger: fixture.trigger,
    }), /requires recovered Hello/);
    assert.equal(fixture.routed(), 0);
  }
});

test("click failure removes the interceptor without inventing an emitted request", async () => {
  const fixture = pageFixture();
  await assert.rejects(captureHeldBrowserPost(fixture.page, {
    game, kind: "SubmitVote", initialRecovery,
    trigger: () => { throw new Error("control unavailable"); },
  }), /control unavailable/);
  assert.equal(fixture.unrouted(), 1);
  assert.equal(fixture.continued.length, 0);
});

test("invite holds only its actual form route and never parses or rewrites submitted form bytes", async () => {
  const fixture = pageFixture("accountId=account&principalId=original", `/g/${game}/host?/issuePlayerInvite`);
  const held = await captureHeldBrowserPost(fixture.page, {
    game, kind: "issuePlayerInvite", initialRecovery, trigger: fixture.trigger,
  });
  const receipt = await held.releaseAfter({ streamSeqs: [43] });
  assert.equal(receipt.commandId, null);
  assert.equal(receipt.releasedBodySha256, receipt.bodySha256);
  assert.deepEqual(fixture.continued, [[]]);
});

async function capture(fixture) {
  return await captureHeldBrowserPost(fixture.page, {
    game, kind: "SubmitVote", initialRecovery, trigger: fixture.trigger,
  });
}

function pageFixture(body = envelope, pathname = "/commands") {
  let handler;
  let matches;
  let aborts = 0;
  let removals = 0;
  let registrations = 0;
  const continued = [];
  const request = {
    method: () => "POST", url: () => `http://proof${pathname}`,
    postDataBuffer: () => Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
    postDataJSON: () => structuredClone(body),
  };
  return {
    continued, aborted: () => aborts, unrouted: () => removals, routed: () => registrations,
    page: {
      async route(match, callback) { registrations++; matches = match; handler = callback; },
      async unroute(match, callback) { assert.equal(match, matches); assert.equal(callback, handler); removals++; },
    },
    async trigger() {
      assert.equal(matches(new URL(request.url())), true);
      await handler({ request: () => request,
        continue: async (...args) => continued.push(args),
        abort: async () => { aborts++; },
        fallback: async () => assert.fail("unexpected fallback"),
      });
    },
  };
}
