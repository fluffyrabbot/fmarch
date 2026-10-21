import assert from "node:assert/strict";
import { test } from "node:test";
import { fixturePackRoleReference } from "../../dev/pack-role-reference-fixture.mjs";
import { ROLE_CARD_CONTRACT, buildRoleCardViewModel, roleWindows } from "./role-card-model.mjs";
import { normalizePackRoleReference } from "./role-reference-model.mjs";

const wire = (pack, key) => fixturePackRoleReference(pack).roles.find((role) => role.key === key);

test("a full card carries alignment, ability constraints, traits and channels", () => {
  const card = buildRoleCardViewModel({ reference: wire("mafia_universe", "godfather") });
  assert.equal(card.variant, "full");
  assert.equal(card.framed, true);
  assert.equal(card.packName, "Mafia Universe");
  assert.equal(card.alignment.id, "mafia");
  assert.equal(card.alignment.label, "Mafia");
  assert.equal(card.win, "Wins when the Mafia equal or outnumber everyone else.");
  assert.deepEqual(card.abilities.map((ability) => [ability.label, ability.window.id, ability.targets, ability.tags]), [
    ["Factional kill", "night", "one other player", ["Every night", "Roleblockable", "Priority 30"]],
  ]);
  assert.deepEqual(card.traits.map((trait) => trait.text), ["Reads as Town to alignment checks"]);
  assert.deepEqual(card.channels, [{ label: "Public thread only", empty: true }]);
});

test("limited uses, constraint notes and declared channels become tags and facts", () => {
  const vigilante = buildRoleCardViewModel({ reference: wire("mafiascum", "vigilante") });
  assert.deepEqual(vigilante.abilities[0].tags, ["Once per game", "Roleblockable", "Priority 30"]);
  const novice = buildRoleCardViewModel({ reference: wire("mafiascum", "novice_cop") });
  assert.ok(novice.abilities[0].tags.includes("From Night 2"));
  const mason = buildRoleCardViewModel({ reference: wire("mafiascum", "mason") });
  assert.deepEqual(mason.channels, [{ label: "Mason chat", empty: false }]);
  const wolf = buildRoleCardViewModel({ reference: wire("chinese_structured", "wolf") });
  assert.equal(wolf.alignment.label, "Werewolf");
  assert.equal(wolf.alignment.id, "mafia");
});

test("passive and unaligned roles keep a distinct crest and a passive window", () => {
  const card = buildRoleCardViewModel({ reference: wire("mafiascum", "lover"), variant: "compact", bare: true });
  assert.equal(card.variant, "compact");
  assert.equal(card.framed, false);
  assert.equal(card.alignment.label, "Unaligned");
  assert.equal(card.alignment.icon, card.icons.passive);
  assert.deepEqual(card.windows.map((window) => window.id), ["passive"]);
  assert.deepEqual(card.abilities, []);
});

test("unknown variants fall back to full and absent roles render nothing", () => {
  assert.equal(buildRoleCardViewModel({ reference: wire("mafia_universe", "town_cop"), variant: "poster" }).variant, "full");
  assert.equal(buildRoleCardViewModel({}), null);
  assert.equal(buildRoleCardViewModel({ reference: { key: "broken" } }), null);
  assert.deepEqual(ROLE_CARD_CONTRACT.variants, ["full", "compact", "chip"]);
});

test("every product role builds in every variant with an icon for each ability", () => {
  for (const pack of ["chinese_structured", "default_open", "epicmafia", "mafia_universe", "mafiascum"]) {
    for (const role of normalizePackRoleReference(fixturePackRoleReference(pack)).roles) {
      for (const variant of ROLE_CARD_CONTRACT.variants) {
        const card = buildRoleCardViewModel({ role, variant });
        assert.equal(card.key, role.key);
        assert.match(card.alignment.icon, /^M/u);
        for (const ability of card.abilities) assert.match(ability.icon, /^M/u);
      }
      assert.ok(roleWindows(role).length >= 1);
    }
  }
});
