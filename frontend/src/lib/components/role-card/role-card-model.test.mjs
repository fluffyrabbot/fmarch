import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLE_CATALOG } from "./role-catalog.mjs";
import { ROLE_CARD_CONTRACT, buildRoleCardViewModel, roleWindows } from "./role-card-model.mjs";

test("a full card carries alignment, ability constraints, traits and channels", () => {
  const card = buildRoleCardViewModel({ roleKey: "godfather" });
  assert.equal(card.variant, "full");
  assert.equal(card.framed, true);
  assert.equal(card.alignment.label, "Mafia");
  assert.equal(card.win, "The Mafia equal or outnumber everyone else.");
  assert.deepEqual(card.abilities.map((ability) => [ability.label, ability.window.id, ability.tags]), [
    ["Factional kill", "night", ["Every night", "Roleblockable", "Priority 30"]],
  ]);
  assert.deepEqual(card.traits.map((trait) => trait.text), ["Reads as Town to parity cops"]);
  assert.deepEqual(card.channels, [{ label: "Mafia chat", empty: false }]);
});

test("passive roles show a passive window and a public-only channel", () => {
  const card = buildRoleCardViewModel({ roleKey: "miller", variant: "compact", bare: true });
  assert.equal(card.variant, "compact");
  assert.equal(card.framed, false);
  assert.deepEqual(card.windows.map((window) => window.id), ["passive"]);
  assert.deepEqual(card.abilities, []);
  assert.deepEqual(card.channels, [{ label: "Public thread only", empty: true }]);
});

test("unknown variants fall back to full and unknown roles render nothing", () => {
  assert.equal(buildRoleCardViewModel({ roleKey: "town_cop", variant: "poster" }).variant, "full");
  assert.equal(buildRoleCardViewModel({ roleKey: "not_a_role" }), null);
  assert.deepEqual(ROLE_CARD_CONTRACT.variants, ["full", "compact", "chip"]);
});

test("every catalog role builds in every variant with an icon for each ability", () => {
  for (const role of ROLE_CATALOG) {
    for (const variant of ROLE_CARD_CONTRACT.variants) {
      const card = buildRoleCardViewModel({ role, variant });
      assert.equal(card.key, role.key);
      for (const ability of card.abilities) assert.match(ability.icon, /^M/);
    }
    assert.ok(roleWindows(role).length >= 1);
  }
});
