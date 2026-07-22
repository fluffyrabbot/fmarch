import assert from "node:assert/strict";
import { test } from "node:test";
import { actions } from "./+page.server.js";

test("GlobalAdmin creates the first game through the authenticated command boundary", async () => {
  const previous = process.env.FMARCH_API_BASE_URL;
  process.env.FMARCH_API_BASE_URL = "http://api.internal";
  const observed = {};
  try {
    await assert.rejects(
      actions.createGame({
        cookies: { get: (name) => (name === "fmarch_session" ? "fmss_admin-session" : null) },
        locals: {
          principalUserId: "admin_a",
          resolvedCapabilities: [{ kind: "GlobalAdmin" }],
        },
        request: formRequest({ pack: "mafiascum" }),
        fetch: async (url, init) => {
          observed.url = url;
          observed.authorization = init.headers.authorization;
          observed.envelope = JSON.parse(init.body);
          return Response.json({
            v: 1,
            id: observed.envelope.id,
            body: { kind: "Ack", body: { stream_seqs: [1] } },
          });
        },
      }),
      (redirect) => {
        assert.equal(redirect.status, 303);
        assert.match(redirect.location, /^\/g\/[0-9a-f-]{36}\/setup$/u);
        return true;
      },
    );
    assert.equal(observed.url, "http://api.internal/commands");
    assert.equal(observed.authorization, "Bearer fmss_admin-session");
    assert.equal(observed.envelope.body.kind, "Command");
    assert.equal(observed.envelope.body.body.command.CreateGame.pack, "mafiascum");
    assert.equal("principal_user_id" in observed.envelope.body.body, false);
  } finally {
    restoreEnv("FMARCH_API_BASE_URL", previous);
  }
});

test("non-admin sessions cannot invoke fresh-install bootstrap", async () => {
  const result = await actions.createGame({
    cookies: { get: () => "member-session" },
    locals: { principalUserId: "member_a", resolvedCapabilities: [] },
    request: formRequest({ pack: "mafiascum" }),
    fetch: async () => {
      throw new Error("unauthorized bootstrap must not reach API");
    },
  });
  assert.equal(result.status, 403);
  assert.equal(result.data.bootstrap.state, "reject");
});

function formRequest(fields) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("https://fmarch.local/admin?/createGame", { method: "POST", body });
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
