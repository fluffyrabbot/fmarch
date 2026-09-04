import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_MENTIONS_PER_POST,
  applyMentionSelection,
  buildMentionSegments,
  deriveMentionSpans,
  mentionQueryAtCaret,
  normalizeHandle,
  parseSubmittedMentions,
} from "./mention-model.mjs";

const alice = { handle: "alice", display_name: "Alice" };

test("mention segments anchor on recorded byte spans, not on parsed prose", () => {
  const segments = buildMentionSegments("hi @alice and @alice again", [
    { profile: alice, offset: 3, len: 6 },
  ]);
  assert.deepEqual(
    segments.map((segment) => [segment.kind, segment.text, segment.href]),
    [
      ["text", "hi ", null],
      ["mention", "@alice", "/u/alice"],
      ["text", " and @alice again", null],
    ],
  );
});

test("mention spans are byte offsets, so multibyte prose still anchors exactly", () => {
  const body = "é @alice";
  const segments = buildMentionSegments(body, [{ profile: alice, offset: 3, len: 6 }]);
  assert.deepEqual(segments.map((segment) => segment.text), ["é ", "@alice"]);
});

test("an unresolvable target keeps its span and loses its link", () => {
  const segments = buildMentionSegments("hi @alice", [{ profile: null, offset: 3, len: 6 }]);
  assert.deepEqual(
    segments.map((segment) => [segment.kind, segment.text, segment.href]),
    [
      ["text", "hi ", null],
      ["mention", "@alice", null],
    ],
  );
});

test("a span outside its body is dropped rather than shifted", () => {
  assert.deepEqual(
    buildMentionSegments("hi", [{ profile: alice, offset: 3, len: 6 }]).map((s) => s.text),
    ["hi"],
  );
});

test("derived spans ascend, dedupe by target, and cap at the per-post bound", () => {
  assert.deepEqual(deriveMentionSpans("@bob hi @alice", ["alice", "bob", "alice"]), [
    { handle: "bob", offset: 0, len: 4 },
    { handle: "alice", offset: 8, len: 6 },
  ]);
  const many = Array.from({ length: MAX_MENTIONS_PER_POST + 2 }, (_, index) => `member_${index}`);
  assert.equal(deriveMentionSpans(many.map((h) => `@${h}`).join(" "), many).length, MAX_MENTIONS_PER_POST);
});

test("a selected handle the author deleted stops being a mention", () => {
  assert.deepEqual(deriveMentionSpans("nothing here", ["alice"]), []);
});

test("a prefix handle does not claim a longer handle's span", () => {
  assert.deepEqual(deriveMentionSpans("@bobby speaks", ["bob"]), []);
  assert.deepEqual(deriveMentionSpans("@bobby speaks", ["bobby"]), [
    { handle: "bobby", offset: 0, len: 6 },
  ]);
});

test("caret query opens only inside a fresh @ fragment", () => {
  assert.deepEqual(mentionQueryAtCaret("hi @al", 6), { start: 3, end: 6, fragment: "al" });
  assert.equal(mentionQueryAtCaret("hi @", 4), null);
  assert.equal(mentionQueryAtCaret("mail@al", 7), null);
  assert.equal(mentionQueryAtCaret("hi @alice there", 15), null);
});

test("selecting a suggestion replaces the fragment and leaves the caret after it", () => {
  const query = mentionQueryAtCaret("hi @al", 6);
  assert.deepEqual(applyMentionSelection("hi @al", query, "alice"), {
    body: "hi @alice ",
    caret: 10,
  });
});

test("submitted mentions are re-validated as client-supplied text", () => {
  const form = new Map([[
    "mentions",
    JSON.stringify([
      { handle: "@Alice", offset: 3, len: 6 },
      { handle: "no", offset: 0, len: 3 },
      { handle: "bob", offset: -1, len: 4 },
    ]),
  ]]);
  assert.deepEqual(parseSubmittedMentions(form), [{ handle: "alice", offset: 3, len: 6 }]);
  assert.deepEqual(parseSubmittedMentions(new Map([["mentions", "{"]])), []);
  assert.equal(normalizeHandle("ab"), null);
});
