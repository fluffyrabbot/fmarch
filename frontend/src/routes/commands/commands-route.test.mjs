import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./+server.js";

test("command proxy binds browser commands to the opaque session cookie", async () => {
  const previous = process.env.FMARCH_API_BASE_URL;
  process.env.FMARCH_API_BASE_URL = "http://api.internal";
  try {
    const envelope = { v: 1, id: 7, body: { kind: "Command", body: { command_id: "00000000-0000-0000-0000-000000000007", command: { AddSlot: { game: "00000000-0000-0000-0000-000000000001", slot: "slot_1" } } } } };
    const observed = {};
    const response = await POST({
      cookies: { get: () => "opaque-host-session" },
      request: new Request("https://fmarch.local/commands", { method: "POST", body: JSON.stringify(envelope) }),
      fetch: async (url, init) => {
        observed.url = url;
        observed.authorization = init.headers.authorization;
        observed.body = JSON.parse(new TextDecoder().decode(init.body));
        return Response.json({ v: 1, id: 7, body: { kind: "Ack", body: { stream_seqs: [2] } } });
      },
    });
    assert.equal(observed.url, "http://api.internal/commands");
    assert.equal(observed.authorization, "Bearer opaque-host-session");
    assert.deepEqual(observed.body, envelope);
    assert.equal(response.status, 200);
  } finally {
    restoreEnv("FMARCH_API_BASE_URL", previous);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
