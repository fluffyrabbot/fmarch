import assert from "node:assert/strict";
import { test } from "node:test";
import { fixturePackRoleReference } from "../../dev/pack-role-reference-fixture.mjs";
import { normalizeThreadPost } from "../../app/cold-load.mjs";
import { buildPlayerThreadPostViewModel } from "../player-thread/player-thread-model.mjs";
import { buildThreadRoleRevealViews, normalizeThreadRoleReveals } from "./thread-role-reveals.mjs";

const reference = (pack, key) => fixturePackRoleReference(pack).roles.find((role) => role.key === key);

const flipPost = (role_reveals) => ({
  game: "midsummer",
  source_seq: 41,
  stream_seq: 41,
  channel_id: "main",
  author: { kind: "system" },
  phase_id: "N01",
  body: "Phase N01 announcement: slot_1 (night_kill), slot_3 (janitor_kill).",
  media: [],
  quotations: [],
  mentions: [],
  role_reveals,
  citation_count: 0,
  occurred_at: 1,
});

test("a revealed role becomes a chip that opens its full card", () => {
  const [reveal] = buildThreadRoleRevealViews(
    [{ slot_id: "slot_1", role_key: "vanilla_townie", reference: reference("mafiascum", "vanilla_townie") }],
    { testIdPrefix: "thread-post-role-41" },
  );
  assert.equal(reveal.slotLabel, "Slot 1");
  assert.equal(reveal.roleLabel, "Vanilla Townie");
  assert.equal(reveal.ariaLabel, "Slot 1 was Vanilla Townie: open role card");
  assert.equal(reveal.testId, "thread-post-role-41-slot_1");
  assert.equal(reveal.chip.variant, "chip");
  assert.equal(reveal.chip.key, "vanilla_townie");
  assert.equal(reveal.card.variant, "full");
  assert.equal(reveal.card.alignment.id, "town");
  assert.equal(reveal.minTouchTargetPx, 44);
});

test("a reveal without a pack reference keeps its label and renders no chip", () => {
  const [reveal] = buildThreadRoleRevealViews(
    [{ slot_id: "slot_1", role_key: "vanilla_townie", reference: null }],
    { testIdPrefix: "p" },
  );
  assert.equal(reveal.roleLabel, "Vanilla townie");
  assert.equal(reveal.chip, null);
  assert.equal(reveal.card, null);
});

test("malformed reveals drop and a missing list is empty", () => {
  assert.deepEqual(normalizeThreadRoleReveals(undefined), []);
  assert.deepEqual(normalizeThreadRoleReveals(null), []);
  assert.deepEqual(
    normalizeThreadRoleReveals([{}, { slot_id: "slot_1" }, { role_key: "x" }, { slot_id: " ", role_key: "x" }]),
    [],
  );
});

test("normalization is idempotent over an already-normalized post", () => {
  const once = normalizeThreadPost(flipPost([
    { slot_id: "slot_1", role_key: "vanilla_townie", reference: reference("mafiascum", "vanilla_townie") },
  ]));
  const twice = normalizeThreadPost(once);
  assert.deepEqual(twice.roleReveals, once.roleReveals);
  assert.equal(twice.roleReveals[0].role.name, "Vanilla Townie");
});

test("the player thread renders only the roles the projection revealed", () => {
  const revealed = buildPlayerThreadPostViewModel(normalizeThreadPost(flipPost([
    { slot_id: "slot_1", role_key: "vanilla_townie", reference: reference("mafiascum", "vanilla_townie") },
  ])));
  assert.deepEqual(revealed.roleReveals.map((reveal) => [reveal.slotId, reveal.roleLabel]), [["slot_1", "Vanilla Townie"]]);
  assert.equal(revealed.roleReveals[0].testId, "thread-post-role-41-slot_1");

  // A concealed flip arrives with no reveal and carries the shape every
  // ordinary post has: no chip, and no role read out of the body.
  const concealed = normalizeThreadPost(flipPost([]));
  assert.equal(Object.hasOwn(concealed, "roleReveals"), false);
  assert.deepEqual(buildPlayerThreadPostViewModel(concealed).roleReveals, []);
});
