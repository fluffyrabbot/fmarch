import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GAME_MAX_QUOTATIONS,
  attachQuotation,
  attachQuoteSeqs,
  buildAttachedQuotations,
  buildGamePostQuoteView,
  excerptFromBody,
  removeAttachedQuotation,
  submittedQuotationsPayload,
} from "./game-quotation-model.mjs";

const game = "00000000-0000-0000-0000-000000000001";

test("game quotation helpers attach excerpts without copying them into body", () => {
  const posts = [
    { seq: 12, authorLabel: "Mira", body: "Alpha signal analysis", quotations: [], citationCount: 1 },
    {
      seq: 18,
      authorLabel: "Rowan",
      body: "Answering that claim",
      quotations: [{ target: { kind: "game_post", scope_id: game, source_seq: 12 }, excerpt: "Alpha signal" }],
      citationCount: 0,
    },
  ];
  const attached = buildAttachedQuotations({ posts, quoteSeqs: [12, 12, 99], gameId: game });
  assert.deepEqual(attached, [
    {
      sourceSeq: 12,
      excerpt: "Alpha signal analysis",
      authorLabel: "Mira",
      target: { kind: "game_post", scope_id: game, source_seq: 12 },
    },
  ]);
  assert.deepEqual(submittedQuotationsPayload(attached), [
    {
      target: { kind: "game_post", scope_id: game, source_seq: 12 },
      excerpt: "Alpha signal analysis",
    },
  ]);

  const view = buildGamePostQuoteView(posts[1], { posts });
  assert.equal(view.quotations[0].excerpt, "Alpha signal");
  assert.equal(view.quotations[0].authorLabel, "Mira");
  assert.equal(view.quotations[0].originalUnavailable, false);
  assert.equal(view.quotations[0].href, "#thread-post-12");

  const quoted = buildGamePostQuoteView(posts[0], { posts });
  assert.equal(quoted.citationCount, 1);
  assert.equal(quoted.incomingCitations[0].sourceSeq, 18);
  assert.equal(quoted.incomingCitations[0].href, "#thread-post-18");
});

test("game quotation helpers mark off-page originals unavailable and cap attachments", () => {
  const hidden = buildGamePostQuoteView(
    {
      source_seq: 20,
      author_slot: "slot-2",
      body: "Reply",
      quotations: [{ target: { source_seq: 3 }, excerpt: "gone" }],
    },
    { posts: [{ source_seq: 20, author_slot: "slot-2", body: "Reply" }] },
  );
  assert.equal(hidden.quotations[0].originalUnavailable, true);
  assert.equal(hidden.quotations[0].authorLabel, null);

  const long = "x".repeat(1200);
  assert.equal(excerptFromBody(long).length < long.length, true);
  assert.deepEqual(attachQuoteSeqs([1, 2], 2), [1, 2]);
  assert.equal(attachQuoteSeqs(Array.from({ length: GAME_MAX_QUOTATIONS }, (_, index) => index + 1), 99).length, 8);

  const attached = attachQuotation([], { seq: 12, authorLabel: "Mira", body: "Alpha signal" }, game);
  assert.equal(removeAttachedQuotation(attached, 12).length, 0);
});
