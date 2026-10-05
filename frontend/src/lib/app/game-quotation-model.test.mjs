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
    { seq: 12, author: { kind: "slot", slotId: "slot-2" }, body: "Alpha signal analysis", quotations: [], citationCount: 1 },
    {
      seq: 18,
      author: { kind: "slot", slotId: "slot-7" },
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
      authorLabel: "slot-2",
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
  assert.equal(view.quotations[0].authorLabel, "slot-2");
  assert.equal(view.quotations[0].originalState, "loaded");
  assert.equal(view.quotations[0].href, "?post=12#thread-post-12");

  const quoted = buildGamePostQuoteView(posts[0], { posts });
  assert.equal(quoted.citationCount, 1);
  assert.equal(quoted.incomingCitations[0].sourceSeq, 18);
  assert.equal(quoted.incomingCitations[0].href, "?post=18#thread-post-18");
});

test("game quotation helpers leave off-page originals unresolved and cap attachments", () => {
  const hidden = buildGamePostQuoteView(
    {
      source_seq: 20,
      author: { kind: "slot", slot_id: "slot-2" },
      body: "Reply",
      quotations: [{ target: { source_seq: 3 }, excerpt: "gone" }],
    },
    { posts: [{ source_seq: 20, author: { kind: "slot", slot_id: "slot-2" }, body: "Reply" }] },
  );
  assert.equal(hidden.quotations[0].originalState, "unresolved");
  assert.equal(hidden.quotations[0].authorLabel, null);

  const long = "x".repeat(1200);
  assert.equal(excerptFromBody(long).length < long.length, true);
  assert.deepEqual(attachQuoteSeqs([1, 2], 2), [1, 2]);
  assert.equal(attachQuoteSeqs(Array.from({ length: GAME_MAX_QUOTATIONS }, (_, index) => index + 1), 99).length, 8);

  const attached = attachQuotation([], { seq: 12, author: { kind: "slot", slotId: "slot-2" }, body: "Alpha signal" }, game);
  assert.equal(removeAttachedQuotation(attached, 12).length, 0);
});

test("game quotation previews normalize tagged wire authors before rendering", () => {
  const view = buildGamePostQuoteView(
    {
      source_seq: 18,
      author: { kind: "slot", slot_id: "slot-3" },
      body: "Answering the signal",
      quotations: [{ target: { source_seq: 12 }, excerpt: "Alpha signal" }],
    },
    {
      posts: [
        {
          source_seq: 12,
          author: { kind: "slot", slot_id: "slot-2" },
          body: "Alpha signal",
        },
      ],
    },
  );

  assert.equal(view.quotations[0].authorLabel, "slot-2");
});

test("private channel citation previews retain the nested PostCitationPage contract", () => {
  const post = { source_seq: 12, citation_count: 3 };
  const view = buildGamePostQuoteView(post, {
    citations: {
      quoted: { kind: "game_post", scope_id: game, source_seq: 12 },
      citation_count: 3,
      citations: [{ quoting: { kind: "game_post", scope_id: game, source_seq: 18 }, occurred_at: 2 }],
    },
  });
  assert.equal(view.citationCount, 3);
  assert.equal(view.moreCitationCount, 2);
  assert.deepEqual(view.incomingCitations, [{ sourceSeq: 18, href: "?post=18#thread-post-18" }]);
});

test("reader authoritative zero and pending previews never derive stale incoming edges", () => {
  const target = { seq: 12, citationCount: 8, citationPage: { citation_count: 0, citations: [] } };
  const posts = [target, { seq: 18, quotations: [{ target: { kind: "game_post", scope_id: game, source_seq: 12 }, excerpt: "claim" }] }];
  const zero = buildGamePostQuoteView(target, { posts });
  assert.equal(zero.citationCount, 0);
  assert.deepEqual(zero.incomingCitations, []);
  const pending = buildGamePostQuoteView({ ...target, citationPage: null }, { posts });
  assert.equal(pending.citationCount, 8);
  assert.deepEqual(pending.incomingCitations, []);
});

test("only scoped removal evidence makes an unloaded quotation unavailable", () => {
  const post = { seq: 20, quotations: [{ target: { source_seq: 3 }, excerpt: "Preserved excerpt" }] };
  for (const [posts, unavailableSeqs, state] of [
    [[post], [], "unresolved"],
    [[post, { seq: 3, author: { kind: "slot", slotId: "slot-2" } }], [], "loaded"],
    [[post], ["3"], "unavailable"],
    [[post], ["4"], "unresolved"],
    [[post, { seq: 3 }], ["3"], "loaded"],
  ]) {
    const quote = buildGamePostQuoteView(post, { posts, unavailableSeqs }).quotations[0];
    assert.equal(quote.originalState, state);
    assert.equal(quote.excerpt, "Preserved excerpt");
    assert.equal(quote.href, "?post=3#thread-post-3");
  }
});
