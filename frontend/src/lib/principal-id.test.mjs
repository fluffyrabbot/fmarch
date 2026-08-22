import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalPrincipalId,
  FIXTURE_PRINCIPAL_IDS,
  FIXTURE_SESSION_PRINCIPAL_IDS,
  isCanonicalPrincipalId,
} from "./principal-id.mjs";
import { principalFixtureId } from "../../../tools/principal_fixture.mjs";

const PRINCIPAL_ID = "a0000000-0000-5000-8000-000000000001";

test("principal IDs accept only canonical UUID authority values", () => {
  assert.equal(canonicalPrincipalId(PRINCIPAL_ID), PRINCIPAL_ID);
  assert.equal(isCanonicalPrincipalId(PRINCIPAL_ID), true);

  for (const invalid of [
    "host_h",
    "00000000-0000-5000-8000-000000000001 ",
    "00000000-0000-5000-8000-00000000000",
    "00000000-0000-5000-8000-00000000000G",
    PRINCIPAL_ID.toUpperCase(),
    null,
  ]) {
    assert.equal(canonicalPrincipalId(invalid), null);
    assert.equal(isCanonicalPrincipalId(invalid), false);
  }
});

test("local fixture principal authorities are canonical UUIDs", () => {
  for (const principalId of [
    ...Object.values(FIXTURE_PRINCIPAL_IDS),
    ...Object.values(FIXTURE_SESSION_PRINCIPAL_IDS),
  ]) {
    assert.equal(canonicalPrincipalId(principalId), principalId);
  }
});

test("fixture principal maps match the shared Rust and proof-tool UUID-v5 derivation", () => {
  const aliases = {
    hostH: "host_h",
    cohostC: "cohost_c",
    playerMira: "player-mira",
    playerRowan: "player-rowan",
    setupPlayerMira: "player_mira",
    setupPlayerGoon: "player_goon",
  };
  const sessionAliases = {
    admin: "admin_a",
    player: "player_mira",
    target: "player_ilya",
    nightTarget: "player-seed",
    normal: "player_rowan",
    survivor: "player_sage",
    host: "host_h",
  };

  for (const [name, alias] of Object.entries(aliases)) {
    assert.equal(FIXTURE_PRINCIPAL_IDS[name], principalFixtureId(alias), name);
  }
  for (const [name, alias] of Object.entries(sessionAliases)) {
    assert.equal(FIXTURE_SESSION_PRINCIPAL_IDS[name], principalFixtureId(alias), name);
  }
});
