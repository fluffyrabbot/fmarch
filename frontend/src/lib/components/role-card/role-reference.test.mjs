import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fixturePackCatalog, fixturePackRoleReference } from "../../dev/pack-role-reference-fixture.mjs";
import {
  UNALIGNED,
  normalizePackCatalog,
  normalizePackRoleReference,
  normalizeRoleReference,
} from "./role-reference-model.mjs";

const repo = new URL("../../../../../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, repo), "utf8"));
const productPacks = readJson("packs/catalog.json").packs;

// The fixture is the endpoint's response, held to the Rust projection by
// content_registry; this holds it to the raw pack rules for every product pack.
test("every product pack's reference matches its pack.json mechanics", () => {
  const catalog = normalizePackCatalog(fixturePackCatalog());
  assert.deepEqual(catalog.map((pack) => pack.key).sort(), productPacks.map((pack) => pack.key).sort());
  for (const { key, file } of productPacks) {
    const pack = readJson(`packs/${file}`);
    const reference = normalizePackRoleReference(fixturePackRoleReference(key));
    assert.ok(reference, `${key} reference normalizes`);
    assert.deepEqual(reference.roles.map((role) => role.key), Object.keys(pack.roles).sort(), `${key} roles`);
    for (const role of reference.roles) {
      const source = pack.roles[role.key];
      const where = `${key}/${role.key}`;
      assert.equal(role.alignment.unaligned ? null : role.alignment.key, source.alignment ?? null, `${where} alignment`);
      assert.equal(role.actions.length, (source.actions ?? []).length, `${where} action count`);
      role.actions.forEach((action, index) => {
        const sourceAction = source.actions[index];
        assert.equal(action.id, sourceAction.id, `${where} action id`);
        assert.equal(action.kind, sourceAction.ability, `${where} ability`);
        assert.equal(action.window, sourceAction.window, `${where} window`);
        assert.equal(action.roleblockable, sourceAction.constraints.roleblockable, `${where} roleblockable`);
        assert.equal(action.priority, sourceAction.constraints.priority, `${where} priority`);
        assert.equal(action.uses, sourceAction.constraints.x_shots ?? null, `${where} uses`);
      });
      assert.ok(role.win !== "", `${where} has win copy`);
    }
  }
});

test("reference documents carry no game state", () => {
  const serialized = JSON.stringify(fixturePackRoleReference("mafiascum"));
  for (const field of ["slot_id", "principal", "occupant", "\"game\""]) {
    assert.equal(serialized.includes(field), false, field);
  }
});

test("invalid documents normalize to null, and unaligned roles are labelled", () => {
  assert.equal(normalizePackRoleReference(null), null);
  assert.equal(normalizePackRoleReference({ pack: { key: "x", name: "X", role_count: 1 }, alignments: [], roles: [{}] }), null);
  assert.equal(normalizePackCatalog({ packs: [{ key: "x" }] }), null);
  const lover = fixturePackRoleReference("mafiascum").roles.find((role) => role.key === "lover");
  const entry = normalizeRoleReference(lover);
  assert.equal(entry.alignment, UNALIGNED);
  assert.match(entry.win, /partner/u);
});
