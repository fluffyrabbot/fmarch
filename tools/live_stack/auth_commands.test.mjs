import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLiveStackAuth,
  createLiveStackCommandSender,
  hashSessionToken,
} from "./auth_commands.mjs";

test("enabled-account sessions are created and logged in through public auth", async () => {
  const requests = [];
  const auth = createLiveStackAuth({
    apiBaseUrl: "http://127.0.0.1:4000",
    rootAdminSessionToken: "root-token",
    uuid: sequence(["account-id", "password-id"]),
    fetchJson: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return url.endsWith("/login")
        ? {
            principal_user_id: "player-a",
            capabilities: [{ kind: "SlotOccupant" }],
          }
        : {};
    },
  });

  const session = await auth.createAccountSession({
    token: "player-token",
    principalUserId: "player-a",
    label: "player-a",
  });

  assert.equal(requests[0].url, "http://127.0.0.1:4000/auth/accounts");
  assert.equal(
    requests[0].options.headers.authorization,
    "Bearer root-token",
  );
  assert.equal(requests[1].url, "http://127.0.0.1:4000/auth/accounts/login");
  assert.equal(requests[1].body.session_token, "player-token");
  assert.equal(session.authentication, "enabled-account-login");
  assert.deepEqual(session.capabilityKinds, ["SlotOccupant"]);
});

test("granted sessions resolve their authoritative capability projection", async () => {
  const requests = [];
  const auth = createLiveStackAuth({
    apiBaseUrl: "http://127.0.0.1:4000",
    rootAdminSessionToken: "root-token",
    fetchJson: async (url, options) => {
      requests.push({ url, options });
      return {
        principal_user_id: "host-h",
        capabilities: [{ kind: "GlobalAdmin" }],
      };
    },
  });

  const session = await auth.createGrantedSession({
    token: "host-token",
    principalUserId: "host-h",
    globalCapabilities: ["GlobalAdmin"],
  });

  assert.equal(requests[0].url, "http://127.0.0.1:4000/auth/session-grants");
  assert.equal(JSON.parse(requests[0].options.body).token, "host-token");
  assert.equal(requests.length, 1);
  assert.deepEqual(session.capabilityKinds, ["GlobalAdmin"]);
});

test("command sender owns authenticated envelopes and rejects unknown actors", async () => {
  const requests = [];
  let envelopeId = 40;
  const sendCommand = createLiveStackCommandSender({
    apiBaseUrl: "http://127.0.0.1:4000",
    nextEnvelopeId: () => ++envelopeId,
    sessionTokenForPrincipal: (principal) =>
      principal === "host-h" ? "host-token" : null,
    uuid: () => "command-id",
    fetchJson: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return {
        body: {
          kind: "Ack",
          body: { stream_seqs: { game: 7 } },
        },
      };
    },
  });

  const command = { CreateGame: { game: "game-id", pack: "mafiascum" } };
  const receipt = await sendCommand("host-h", command);
  assert.equal(requests[0].body.id, 41);
  assert.equal(requests[0].body.body.body.command_id, "command-id");
  assert.equal(
    requests[0].options.headers.authorization,
    "Bearer host-token",
  );
  assert.deepEqual(receipt.streamSeqs, { game: 7 });
  await assert.rejects(
    sendCommand("missing", command),
    /command actor has no session/,
  );
});

test("session token hashing is stable and never retains plaintext", () => {
  const digest = hashSessionToken("secret-token");
  assert.equal(digest.length, 64);
  assert.equal(digest.includes("secret-token"), false);
  assert.equal(digest, hashSessionToken("secret-token"));
});

function sequence(values) {
  return () => {
    const value = values.shift();
    if (value === undefined) throw new Error("deterministic UUID sequence exhausted");
    return value;
  };
}
