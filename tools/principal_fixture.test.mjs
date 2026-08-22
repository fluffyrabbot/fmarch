import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPrincipalTransport,
  fixturePrincipalAuthorityId,
  fixturePrincipalTransport,
  principalFixtureId,
} from "./principal_fixture.mjs";

test("fixture aliases derive the stable PrincipalId UUID-v5 authority", () => {
  assert.equal(
    principalFixtureId("host_h"),
    "aef8cdd1-0914-5e70-97fa-fdf58ecf0f55",
  );
  assert.equal(
    fixturePrincipalAuthorityId("host_h"),
    principalFixtureId("host_h"),
  );
  assert.equal(
    fixturePrincipalAuthorityId("aef8cdd1-0914-5e70-97fa-fdf58ecf0f55"),
    "aef8cdd1-0914-5e70-97fa-fdf58ecf0f55",
  );
});

test("command transport canonicalizes aliases once and guards raw labels", () => {
  const command = {
    ProcessReplacement: {
      game: "fixture-game",
      slot: "slot-7",
      incoming_principal_id: "player-rowan",
      public_name: "player-rowan",
    },
  };
  const transport = fixturePrincipalTransport(command, "fixture command");

  assert.equal(
    transport.ProcessReplacement.incoming_principal_id,
    principalFixtureId("player-rowan"),
  );
  assert.equal(transport.ProcessReplacement.public_name, "player-rowan");
  assert.equal(command.ProcessReplacement.incoming_principal_id, "player-rowan");
  assert.equal(assertPrincipalTransport(transport, "fixture command"), transport);
  assert.throws(
    () => assertPrincipalTransport(command, "raw browser command"),
    /requires a UUID principal authority/,
  );
});
