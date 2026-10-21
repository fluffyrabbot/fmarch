import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ROLE_ALIGNMENTS, ROLE_CATALOG, ROLE_PACK, findRole } from "./role-catalog.mjs";

const pack = JSON.parse(readFileSync(new URL(`../../../../../packs/${ROLE_PACK.key}/pack.json`, import.meta.url), "utf8"));

test("every catalog role is a pack role with the pack's alignment and action mechanics", () => {
  for (const entry of ROLE_CATALOG) {
    const source = pack.roles[entry.key];
    assert.ok(source, `${entry.key} is not in the ${ROLE_PACK.key} pack`);
    assert.equal(entry.alignment, source.alignment, `${entry.key} alignment`);
    assert.equal(entry.actions.length, source.actions.length, `${entry.key} action count`);
    entry.actions.forEach((action, index) => {
      const sourceAction = source.actions[index];
      assert.equal(action.kind, sourceAction.ability, `${entry.key} ability`);
      assert.equal(action.window, sourceAction.window, `${entry.key} window`);
      assert.equal(action.roleblockable, sourceAction.constraints.roleblockable, `${entry.key} roleblockable`);
      assert.equal(action.priority, sourceAction.constraints.priority, `${entry.key} priority`);
      assert.equal(action.targets === "yourself", sourceAction.constraints.self_allowed && sourceAction.targets === "None", `${entry.key} targets`);
    });
  }
});

test("catalog keys are unique, alignments are known, and lookup is total", () => {
  const keys = ROLE_CATALOG.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length);
  const alignments = new Set(ROLE_ALIGNMENTS.map((alignment) => alignment.id));
  for (const entry of ROLE_CATALOG) assert.ok(alignments.has(entry.alignment), entry.key);
  assert.equal(findRole("godfather").name, "Godfather");
  assert.equal(findRole("nope"), null);
  assert.equal(findRole(undefined), null);
});
