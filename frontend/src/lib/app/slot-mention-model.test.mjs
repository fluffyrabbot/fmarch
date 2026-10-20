import assert from "node:assert/strict";
import test from "node:test";

import {
  applySlotMentionSelection,
  buildSlotMentionSegments,
  deriveSlotMentionSpans,
  MAX_MENTIONS_PER_POST,
  mentionSeat,
  normalizeSlotId,
  slotMentionQueryAtCaret,
  slotMentionSuggestions,
  submittedSlotMentionsPayload,
} from "./slot-mention-model.mjs";

test("a decided slot mention renders as a chip over its recorded span", () => {
  const segments = buildSlotMentionSegments("@slot_7 explain the wagon", [
    { slot_id: "slot_7", offset: 0, len: 7 },
  ]);
  assert.deepEqual(segments, [
    { kind: "mention", text: "@slot_7", slotId: "slot_7" },
    { kind: "text", text: " explain the wagon", href: null, displayName: null },
  ]);
});

test("a slot chip is never a link, because a seat has no page", () => {
  const [chip] = buildSlotMentionSegments("@slot_7 hi", [
    { slot_id: "slot_7", offset: 0, len: 7 },
  ]);
  assert.equal(chip.href, undefined);
  assert.equal(chip.displayName, undefined);
});

test("spans are byte offsets, so multi-byte prose still anchors correctly", () => {
  const body = "héllo @slot_2";
  const offset = new TextEncoder().encode("héllo ").byteLength;
  const segments = buildSlotMentionSegments(body, [
    { slot_id: "slot_2", offset, len: 7 },
  ]);
  assert.deepEqual(segments.map((segment) => segment.text), ["héllo ", "@slot_2"]);
});

test("a span that does not land on this body degrades to plain prose", () => {
  const segments = buildSlotMentionSegments("short", [
    { slot_id: "slot_2", offset: 40, len: 7 },
  ]);
  assert.deepEqual(segments, [{ kind: "text", text: "short", href: null, displayName: null }]);
});

test("overlapping spans are dropped rather than shifted", () => {
  const segments = buildSlotMentionSegments("@slot_1 x", [
    { slot_id: "slot_1", offset: 0, len: 7 },
    { slot_id: "slot_2", offset: 3, len: 4 },
  ]);
  assert.deepEqual(segments.map((segment) => segment.text), ["@slot_1", " x"]);
});

const ilya = mentionSeat("slot_2", "Ilya", "Ilya · S2");
const goon = mentionSeat("slot_5", "Goon B", "Goon B · S5");
const mira = mentionSeat("slot_7", "Mira", "Mira · S7");

test("a mentionable seat needs both a slot and a persona name", () => {
  assert.deepEqual(ilya, { slotId: "slot_2", name: "Ilya", label: "Ilya · S2" });
  assert.equal(mentionSeat("slot_2", "  "), null, "an empty seat cannot be written");
  assert.equal(mentionSeat("slot 2", "Ilya"), null);
  assert.equal(mentionSeat("slot_2", " Ilya ").name, "Ilya");
});

test("spans are re-derived from the body, never trusted from selection time", () => {
  assert.deepEqual(deriveSlotMentionSpans("@Mira hi", [mira]), [
    { slot_id: "slot_7", offset: 0, len: 5 },
  ]);
  assert.deepEqual(
    deriveSlotMentionSpans("the author deleted it", [mira]),
    [],
    "a seat removed from the prose stops being a mention",
  );
  assert.deepEqual(
    deriveSlotMentionSpans("@Miranda is not her", [mira]),
    [],
    "a name inside a longer word is not a mention",
  );
});

test("a name with spaces and accents spans its bytes", () => {
  const seat = mentionSeat("slot_9", "Zoë Ann");
  const body = "ask @Zoë Ann, then vote";
  assert.deepEqual(deriveSlotMentionSpans(body, [seat]), [
    { slot_id: "slot_9", offset: 4, len: new TextEncoder().encode("@Zoë Ann").byteLength },
  ]);
});

test("the per-post cap holds on the client too", () => {
  const seats = Array.from({ length: MAX_MENTIONS_PER_POST + 2 }, (_, index) =>
    mentionSeat(`slot_${index}`, `P${index}x`),
  );
  const body = seats.map((seat) => `@${seat.name}`).join(" ");
  assert.equal(deriveSlotMentionSpans(body, seats).length, MAX_MENTIONS_PER_POST);
});

test("the typeahead opens only on a fragment the author is still typing", () => {
  assert.deepEqual(slotMentionQueryAtCaret("@Il", 3), { start: 0, end: 3, fragment: "il" });
  assert.deepEqual(slotMentionQueryAtCaret("hey @Zoë", 8), { start: 4, end: 8, fragment: "zoë" });
  assert.equal(slotMentionQueryAtCaret("@", 1), null, "a bare @ is not yet a query");
  assert.equal(slotMentionQueryAtCaret("mail@slot", 9), null, "an email is not a mention");
  assert.equal(slotMentionQueryAtCaret("plain prose", 5), null);
});

test("suggestions come from the channel roster, by name or seat tag", () => {
  const roster = [mira, ilya, goon];
  assert.deepEqual(slotMentionSuggestions(roster, slotMentionQueryAtCaret("@i", 2)), [ilya]);
  assert.deepEqual(
    slotMentionSuggestions(roster, slotMentionQueryAtCaret("@b", 2)),
    [goon],
    "any word of a name matches",
  );
  assert.deepEqual(slotMentionSuggestions(roster, slotMentionQueryAtCaret("@s5", 3)), [goon]);
  assert.deepEqual(
    slotMentionSuggestions(roster, slotMentionQueryAtCaret("@s", 2)),
    [goon, ilya, mira],
    "matches sort by name",
  );
  assert.deepEqual(
    slotMentionSuggestions([], slotMentionQueryAtCaret("@i", 2)),
    [],
    "an empty roster suggests nothing rather than falling back to another corpus",
  );
});

test("selecting a seat writes its persona name and leaves the caret past it", () => {
  const query = slotMentionQueryAtCaret("say @go", 7);
  assert.deepEqual(applySlotMentionSelection("say @go", query, goon), {
    body: "say @Goon B ",
    caret: 12,
  });
});

test("the submit payload drops seats the roster cannot address", () => {
  const body = "@Ilya and @Mira";
  assert.deepEqual(
    submittedSlotMentionsPayload(body, ["slot_2", "slot_7"], [ilya, goon]),
    [{ slot_id: "slot_2", offset: 0, len: 5 }],
    "a seat outside the room never reaches the wire, and the server still decides",
  );
});

test("slot ids are normalized, and a non-seat is refused", () => {
  assert.equal(normalizeSlotId("@slot_7"), "slot_7");
  assert.equal(normalizeSlotId("  slot-7 "), "slot-7");
  assert.equal(normalizeSlotId("slot 7"), null);
  assert.equal(normalizeSlotId(""), null);
});
