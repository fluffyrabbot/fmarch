import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./+server.js";

test("same-origin command proxy derives bearer authority from the httpOnly session", async () => {
  const calls = [];
  const response = await POST({
    cookies: { get: (name) => (name === "fmarch_session" ? "opaque-session" : undefined) },
    request: new Request("https://app.example/commands", {
      method: "POST",
      body: JSON.stringify({ v: 1, id: 7, body: { kind: "Command", body: {} } }),
    }),
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ v: 1, id: 7, body: { kind: "Ack", body: {} } });
    },
  });

  assert.equal(response.status, 200);
  assert.equal(calls[0].init.headers.authorization, "Bearer opaque-session");
  assert.doesNotMatch(await response.text(), /opaque-session/u);
});

test("missing browser session is rejected before any privileged upstream request", async () => {
  const calls = [];
  const response = await POST({
    cookies: { get: () => undefined },
    request: new Request("https://app.example/commands", { method: "POST", body: "{}" }),
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ error: "NotAuthorized" }, { status: 401 });
    },
  });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});
