import assert from "node:assert/strict";
import { test } from "node:test";
import { postSeedCommand } from "./seed_command_retry.mjs";

const conflict = () => Response.json({ body: { kind: "Reject", body: { error: "StreamConflict", retryable: true } } }, { status: 409 });
const ack = () => Response.json({ body: { kind: "Ack", body: { stream_seqs: [7] } } });
test("seed conflicts retry the identical command and return its acknowledgement", async () => {
  const requests = [], waits = [];
  const options = { method: "POST", body: JSON.stringify({ command_id: "stable-id", command: "seed" }) };
  const result = await postSeedCommand("http://proof/commands", options, {
    fetchResponse: async (url, request) => { requests.push({ url, body: request.body }); return requests.length < 3 ? conflict() : ack(); },
    pause: async ms => waits.push(ms),
  });
  assert.equal(result.body.kind, "Ack");
  assert.deepEqual(requests, Array(3).fill({ url: "http://proof/commands", body: options.body }));
  assert.deepEqual(waits, [25, 50]);
});
test("persistent conflict stops after five attempts", async () => {
  let calls = 0;
  await assert.rejects(postSeedCommand("http://proof/commands", {}, {
    fetchResponse: async () => { calls++; return conflict(); }, pause: async () => {},
  }), /after 5 attempt/);
  assert.equal(calls, 5);
});
test("other rejections and uncertain transport failures are never retried", async () => {
  for (const [status, error, retryable] of [[409, "Forbidden", true], [409, "StreamConflict", false], [503, "Overloaded", true]]) {
    let calls = 0;
    await assert.rejects(postSeedCommand("http://proof/commands", {}, {
      fetchResponse: async () => { calls++; return Response.json({ body: { kind: "Reject", body: { error, retryable } } }, { status }); },
      pause: async () => assert.fail("unexpected retry"),
    }), /after 1 attempt/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(postSeedCommand("http://proof/commands", {}, {
    fetchResponse: async () => { calls++; throw new Error("connection lost"); }, pause: async () => assert.fail("unexpected retry"),
  }), /connection lost/);
  assert.equal(calls, 1);
});
