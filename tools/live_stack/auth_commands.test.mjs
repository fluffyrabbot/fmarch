import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLiveStackAuth,
  createLiveStackCommandSender,
  hashSessionToken,
} from "./auth_commands.mjs";
import { principalFixtureId } from "../principal_fixture.mjs";
import {
  createLocalProofAuth,
  localProofSecretHeader,
} from "../local_proof_auth.mjs";

test("local-proof authority bundles are unique, canonical, and override-proof", () => {
  const first = createLocalProofAuth();
  const second = createLocalProofAuth();
  const attackerValues = {
    FMARCH_DEV_AUTH: "0",
    FMARCH_LOCAL_PROOF_SECRET: "attacker-selected",
    KEEP: "yes",
  };
  const firstEnvironment = first.serverEnvironment(attackerValues);
  const secondEnvironment = second.serverEnvironment(attackerValues);
  const firstHeaders = first.requestHeaders({ [localProofSecretHeader]: "attacker-selected" });
  const secondHeaders = second.requestHeaders();

  assert.equal(firstEnvironment.FMARCH_DEV_AUTH, "1");
  assert.equal(firstEnvironment.KEEP, "yes");
  assert.match(firstEnvironment.FMARCH_LOCAL_PROOF_SECRET, /^[0-9a-f]{64}$/u);
  assert.match(secondEnvironment.FMARCH_LOCAL_PROOF_SECRET, /^[0-9a-f]{64}$/u);
  assert.notEqual(
    firstEnvironment.FMARCH_LOCAL_PROOF_SECRET,
    secondEnvironment.FMARCH_LOCAL_PROOF_SECRET,
  );
  assert.equal(
    firstHeaders[localProofSecretHeader],
    firstEnvironment.FMARCH_LOCAL_PROOF_SECRET,
  );
  assert.equal(
    secondHeaders[localProofSecretHeader],
    secondEnvironment.FMARCH_LOCAL_PROOF_SECRET,
  );
});

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
            principal_id: principalFixtureId("player-a"),
            capabilities: [{ kind: "SlotOccupant" }],
            session_token: "issued-player-token",
          }
        : {};
    },
  });

  const session = await auth.createAccountSession({
    principalId: "player-a",
    label: "player-a",
  });

  assert.equal(requests[0].url, "http://127.0.0.1:4000/auth/accounts");
  assert.equal(
    requests[0].options.headers.authorization,
    "Bearer root-token",
  );
  assert.equal(requests[1].url, "http://127.0.0.1:4000/auth/accounts/login");
  assert.equal(Object.hasOwn(requests[1].body, "session_token"), false);
  assert.equal(requests[0].body.principal_id, principalFixtureId("player-a"));
  assert.equal(session.authentication, "enabled-account-login");
  assert.equal(session.sessionToken, "issued-player-token");
  assert.deepEqual(session.capabilityKinds, ["SlotOccupant"]);
});

test("account login resolves its authoritative global capability projection", async () => {
  const requests = [];
  const auth = createLiveStackAuth({
    apiBaseUrl: "http://127.0.0.1:4000",
    rootAdminSessionToken: "root-token",
    uuid: sequence(["account-id", "password-id"]),
    fetchJson: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return url.endsWith("/login") ? {
        principal_id: principalFixtureId("host-h"),
        capabilities: [{ kind: "GlobalAdmin" }],
        session_token: "issued-host-token",
      } : {};
    },
  });

  const session = await auth.createAccountSession({
    principalId: "host-h",
    label: "host-h",
    globalCapabilities: ["GlobalAdmin"],
  });

  assert.equal(requests[0].url, "http://127.0.0.1:4000/auth/accounts");
  assert.deepEqual(requests[0].body.global_capabilities, ["GlobalAdmin"]);
  assert.equal(requests[1].url, "http://127.0.0.1:4000/auth/accounts/login");
  assert.equal(Object.hasOwn(requests[1].body, "token"), false);
  assert.equal(requests[0].body.principal_id, principalFixtureId("host-h"));
  assert.equal(requests[1].body.account_id, requests[0].body.account_id);
  assert.equal(requests[1].body.password, requests[0].body.password);
  assert.equal(requests[1].options.headers.authorization, undefined);
  assert.equal(requests.length, 2);
  assert.equal(session.authentication, "enabled-account-login");
  assert.equal(session.sessionToken, "issued-host-token");
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

test("command sender canonicalizes fixture principals and rejects malformed authority", async () => {
  const requests = [];
  const sendCommand = createLiveStackCommandSender({
    apiBaseUrl: "http://127.0.0.1:4000",
    nextEnvelopeId: () => 1,
    sessionTokenForPrincipal: () => "host-token",
    uuid: () => "command-id",
    fetchJson: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { body: { kind: "Ack", body: { stream_seqs: { game: 7 } } } };
    },
  });
  const command = {
    SeatPersona: {
      game: "game-id",
      slot: "slot_1",
      principal_id: "player-a",
      public_name: "Player A",
    },
  };

  await sendCommand("host-a", command);
  assert.equal(
    requests[0].body.body.command.SeatPersona.principal_id,
    principalFixtureId("player-a"),
  );
  assert.equal(command.SeatPersona.principal_id, "player-a");
  await assert.rejects(
    sendCommand("host-a", { FutureCommand: { principal_id: 42 } }),
    /fixture principal authority requires a non-empty string/,
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
