import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLAYER_THREAD_MEDIA_CONTRACT,
  PLAYER_THREAD_PAGER_CONTRACT,
  buildPlayerThreadPagerViewModel,
  buildPlayerThreadPermalinkView,
  buildPlayerThreadViewModel,
  buildLiveOfficialPost,
  buildPlayerThreadMedia,
  mergeThreadPage,
  selectTabletThreadMediaVariant,
  threadPageStatusForResult,
} from "./player-thread-model.mjs";

test("player thread model highlights the latest official host votecount post", () => {
  assert.deepEqual(
    buildLiveOfficialPost({
      posts: [
        {
          seq: 10,
          author: { kind: "host_narrator" },
          body: "Official votecount for D01\n- slot_2: 1",
          meta: "live",
        },
        {
          seq: 11,
          author: { kind: "slot", slotId: "slot-7" },
          body: "Official votecount for D02\n- slot_4: 1",
          meta: "player",
        },
        {
          seq: 12,
          author: { kind: "host_narrator" },
          body: "Official votecount for D03\nNo active ballots.",
          meta: "later",
        },
      ],
    }),
    {
      seq: 12,
      label: "Official host post",
      value: "Official votecount for D03",
      detail: "later",
    },
  );
});

test("player thread model ignores non-host and non-official posts", () => {
  assert.equal(
    buildLiveOfficialPost({
      posts: [
        { seq: 1, author: { kind: "host_narrator" }, body: "regular host note" },
        { seq: 2, author: { kind: "slot", slotId: "slot-7" }, body: "Official votecount for D01" },
      ],
    }),
    null,
  );
  assert.equal(buildLiveOfficialPost({ posts: [] }), null);
});

test("player thread model merges older thread pages without duplicate seqs", () => {
  assert.deepEqual(
    mergeThreadPage(
      {
        nextBeforeSeq: 441,
        posts: [
          { seq: 442, body: "current 442" },
          { seq: 443, body: "current 443" },
        ],
      },
      {
        nextBeforeSeq: 300,
        posts: [
          { seq: 440, body: "older 440" },
          { seq: 442, body: "stale duplicate" },
        ],
      },
    ),
    {
      nextBeforeSeq: 300,
      posts: [
        { seq: 440, body: "older 440" },
        { seq: 442, body: "current 442" },
        { seq: 443, body: "current 443" },
      ],
    },
  );
});

test("player thread model reports older-page result status", () => {
  assert.deepEqual(threadPageStatusForResult(1), {
    state: "ack",
    message: "Loaded 1 older post",
  });
  assert.deepEqual(threadPageStatusForResult(2), {
    state: "ack",
    message: "Loaded 2 older posts",
  });
});

test("player thread pager models ready, pending, and complete touch states", () => {
  assert.deepEqual(PLAYER_THREAD_PAGER_CONTRACT, {
    component: "player-thread-pager",
    rootTestId: "player-thread-pager",
    cursorTestId: "player-thread-page-cursor",
    buttonTestId: "player-thread-load-older",
    minTouchTargetPx: 44,
  });

  assert.deepEqual(
    buildPlayerThreadPagerViewModel({
      thread: { nextBeforeSeq: 441 },
      threadPageStatus: null,
    }),
    {
      root: {
        component: "player-thread-pager",
        testId: "player-thread-pager",
        state: "ready",
        busy: "false",
      },
      cursor: {
        testId: "player-thread-page-cursor",
        label: "Older before #441",
        nextBeforeSeq: 441,
      },
      button: {
        testId: "player-thread-load-older",
        label: "Load older",
        disabled: false,
        ariaDisabled: "false",
        disabledReason: null,
        minTouchTargetPx: 44,
        nextBeforeSeq: 441,
      },
    },
  );

  assert.deepEqual(
    buildPlayerThreadViewModel(
      { nextBeforeSeq: 441, posts: [] },
      { threadPageStatus: { state: "pending", message: "Loading older posts" } },
    ).pager,
    {
      root: {
        component: "player-thread-pager",
        testId: "player-thread-pager",
        state: "pending",
        busy: "true",
      },
      cursor: {
        testId: "player-thread-page-cursor",
        label: "Older before #441",
        nextBeforeSeq: 441,
      },
      button: {
        testId: "player-thread-load-older",
        label: "Loading older",
        disabled: true,
        ariaDisabled: "true",
        disabledReason: "Loading older posts",
        minTouchTargetPx: 44,
        nextBeforeSeq: 441,
      },
    },
  );

  assert.deepEqual(
    buildPlayerThreadPagerViewModel({ thread: { nextBeforeSeq: null } }).button,
    {
      testId: "player-thread-load-older",
      label: "No older posts",
      disabled: true,
      ariaDisabled: "true",
      disabledReason: "At oldest loaded post",
      minTouchTargetPx: 44,
      nextBeforeSeq: null,
    },
  );
});

test("player thread media prefers tablet variants and excludes originals", () => {
  const media = buildPlayerThreadMedia([
    {
      id: "receipt-1",
      kind: "image",
      alt: "Vote receipt",
      variants: {
        original: { url: "/media/original/receipt-1.jpg", width: 4000 },
        thumb: {
          avifUrl: "/media/thread/receipt-1/thumb.avif",
          webpUrl: "/media/thread/receipt-1/thumb.webp",
          width: 256,
          height: 192,
        },
        tablet: {
          avifUrl: "/media/thread/receipt-1/tablet.avif",
          webpUrl: "/media/thread/receipt-1/tablet.webp",
          width: 960,
          height: 720,
        },
        "full-bounded": {
          avifUrl: "/media/thread/receipt-1/full-bounded.avif",
          webpUrl: "/media/thread/receipt-1/full-bounded.webp",
          width: 1600,
          height: 1200,
        },
      },
    },
  ]);

  assert.equal(PLAYER_THREAD_MEDIA_CONTRACT.component, "player-thread-media");
  assert.deepEqual(PLAYER_THREAD_MEDIA_CONTRACT.forbiddenVariants, ["original"]);
  assert.deepEqual(media.items, [
    {
      id: "receipt-1",
      contentId: "receipt-1",
      kind: "image",
      alt: "Vote receipt",
      src: "/media/thread/receipt-1/tablet.webp",
      sources: [
        {
          type: "image/avif",
          srcset:
            "/media/thread/receipt-1/thumb.avif 256w, /media/thread/receipt-1/tablet.avif 960w, /media/thread/receipt-1/full-bounded.avif 1600w",
        },
        {
          type: "image/webp",
          srcset:
            "/media/thread/receipt-1/thumb.webp 256w, /media/thread/receipt-1/tablet.webp 960w, /media/thread/receipt-1/full-bounded.webp 1600w",
        },
      ],
      sizes: "(max-width: 1180px) 100vw, 720px",
      width: 960,
      height: 720,
      variant: "tablet",
      testId: "thread-post-media-receipt-1",
    },
  ]);
  assert.deepEqual(media.withheld, []);
  assert.equal(media.items[0].src.includes("original"), false);
  assert.equal(media.items[0].sources.some((source) => source.srcset.includes("original")), false);
});

test("player thread model renders quote blocks and incoming citation disclosure", () => {
  const thread = buildPlayerThreadViewModel(
    {
      nextBeforeSeq: null,
      posts: [
        {
          seq: 12,
          author: { kind: "slot", slotId: "slot-7" },
          body: "Alpha signal analysis",
          quotations: [],
          citationCount: 1,
        },
        {
          seq: 18,
          author: { kind: "slot", slotId: "slot-3" },
          body: "Answering that claim",
          quotations: [
            {
              target: { kind: "game_post", scopeId: "midsummer", sourceSeq: 12 },
              excerpt: "Alpha signal",
            },
          ],
          citationCount: 0,
        },
      ],
    },
    { quoteEnabled: true },
  );

  assert.equal(thread.posts[0].quoteEnabled, true);
  assert.equal(thread.posts[0].citationCount, 1);
  assert.equal(thread.posts[0].incomingCitations[0].sourceSeq, 18);
  assert.equal(thread.posts[1].quotations[0].excerpt, "Alpha signal");
  assert.equal(thread.posts[1].quotations[0].authorLabel, "slot-7");
  assert.equal(thread.posts[1].quotations[0].href, "#thread-post-12");
  assert.equal(thread.quoteEnabled, true);
  assert.deepEqual(thread.posts[0].author, { kind: "slot", slotId: "slot-7" });
  assert.equal(thread.posts[0].authorLabel, "slot-7");
  assert.deepEqual(thread.posts[0].permalink, {
    href: "#thread-post-12",
    testId: "thread-post-permalink-12",
    label: "#12",
    meta: "",
    ariaLabel: "Permalink to post 12",
  });
});

test("player thread model renders tagged author attribution without person identity", () => {
  const thread = buildPlayerThreadViewModel({
    posts: [
      { seq: 1, author: { kind: "slot", slotId: "slot-7" } },
      { seq: 2, author: { kind: "host_narrator" } },
      { seq: 3, author: { kind: "system" } },
      { seq: 4, author: { kind: "slot", slotId: "  " } },
    ],
  });

  assert.deepEqual(thread.posts.map((post) => post.authorLabel), [
    "slot-7",
    "Host",
    "System",
    "Unknown",
  ]);
  assert.deepEqual(
    buildPlayerThreadPermalinkView({
      seq: 443,
      meta: "1 min ago",
    }),
    {
      href: "#thread-post-443",
      testId: "thread-post-permalink-443",
      label: "#443",
      meta: "1 min ago",
      ariaLabel: "Permalink to post 443, 1 min ago",
    },
  );
  assert.equal(buildPlayerThreadPermalinkView({ seq: "pending" }), null);
});

test("player thread media withholds original-only images", () => {
  assert.equal(
    selectTabletThreadMediaVariant({
      original: { url: "/media/original/full.jpg", width: 4000 },
    }),
    null,
  );
  const thread = buildPlayerThreadViewModel({
    nextBeforeSeq: null,
    posts: [
      {
        seq: 7,
        author: { kind: "slot", slotId: "slot-7" },
        body: "receipt attached",
        media: [
          {
            id: "unsafe-original",
            kind: "image",
            variants: {
              original: { url: "/media/original/full.jpg", width: 4000 },
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(thread.posts[0].media.items, []);
  assert.deepEqual(thread.posts[0].media.withheld, [
    {
      id: "unsafe-original",
      reason: "missing manifest-backed responsive image variants",
    },
  ]);
  assert.equal(thread.posts[0].mediaBoundary.status, "tablet-variant-missing");
});
