import assert from "node:assert/strict";
import test from "node:test";

import {
  applySlotMentionSelection,
  buildSlotMentionSegments,
  deriveSlotMentionSpans,
  MAX_MENTIONS_PER_POST,
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

test("spans are re-derived from the body, never trusted from selection time", () => {
  assert.deepEqual(deriveSlotMentionSpans("@slot_7 hi", ["slot_7"]), [
    { slot_id: "slot_7", offset: 0, len: 7 },
  ]);
  assert.deepEqual(
    deriveSlotMentionSpans("the author deleted it", ["slot_7"]),
    [],
    "a seat removed from the prose stops being a mention",
  );
});

test("the per-post cap holds on the client too", () => {
  const seats = Array.from({ length: MAX_MENTIONS_PER_POST + 2 }, (_, index) => `slot_${index}`);
  const body = seats.map((seat) => `@${seat}`).join(" ");
  assert.equal(deriveSlotMentionSpans(body, seats).length, MAX_MENTIONS_PER_POST);
});

test("the typeahead opens only on a fragment the author is still typing", () => {
  assert.deepEqual(slotMentionQueryAtCaret("@slo", 4), { start: 0, end: 4, fragment: "slo" });
  assert.equal(slotMentionQueryAtCaret("@", 1), null, "a bare @ is not yet a query");
  assert.equal(slotMentionQueryAtCaret("mail@slot", 9), null, "an email is not a mention");
  assert.equal(slotMentionQueryAtCaret("plain prose", 5), null);
});

test("suggestions come from the channel roster and nowhere else", () => {
  const roster = ["slot_1", "slot_2", "slot_12", "other"];
  const query = slotMentionQueryAtCaret("@slot_1", 7);
  assert.deepEqual(slotMentionSuggestions(roster, query), ["slot_1", "slot_12"]);
  assert.deepEqual(
    slotMentionSuggestions([], query),
    [],
    "an empty roster suggests nothing rather than falling back to another corpus",
  );
});

test("selecting a seat replaces the fragment and leaves the caret past it", () => {
  const query = slotMentionQueryAtCaret("say @slo", 8);
  assert.deepEqual(applySlotMentionSelection("say @slo", query, "slot_7"), {
    body: "say @slot_7 ",
    caret: 12,
  });
});

test("the submit payload drops seats the roster cannot address", () => {
  const body = "@slot_2 and @slot_9";
  assert.deepEqual(
    submittedSlotMentionsPayload(body, ["slot_2", "slot_9"], ["slot_1", "slot_2"]),
    [{ slot_id: "slot_2", offset: 0, len: 7 }],
    "a seat outside the room never reaches the wire, and the server still decides",
  );
});

test("slot ids are normalized, and a non-seat is refused", () => {
  assert.equal(normalizeSlotId("@slot_7"), "slot_7");
  assert.equal(normalizeSlotId("  slot-7 "), "slot-7");
  assert.equal(normalizeSlotId("slot 7"), null);
  assert.equal(normalizeSlotId(""), null);
});
