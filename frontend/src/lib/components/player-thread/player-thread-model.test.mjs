import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLAYER_THREAD_MEDIA_CONTRACT,
  PLAYER_THREAD_PAGER_CONTRACT,
  buildPlayerThreadPagerViewModel,
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
          authorLabel: "host",
          body: "Official votecount for D01\n- slot_2: 1",
          meta: "live",
        },
        {
          seq: 11,
          authorLabel: "Mira",
          body: "Official votecount for D02\n- slot_4: 1",
          meta: "player",
        },
        {
          seq: 12,
          authorUser: "host",
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
        { seq: 1, authorLabel: "host", body: "regular host note" },
        { seq: 2, authorLabel: "Mira", body: "Official votecount for D01" },
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
        minTouchTargetPx: 44,
        nextBeforeSeq: 441,
      },
    },
  );

  assert.deepEqual(
    buildPlayerThreadPagerViewModel({ thread: { nextBeforeSeq: null } }).button,
    {
      testId: "player-thread-load-older",
      label: "Load older",
      disabled: true,
      ariaDisabled: "true",
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
        desktop: { url: "/media/desktop/receipt-1.jpg", width: 1600 },
        tablet: { url: "/media/tablet/receipt-1.jpg", width: 960, height: 720 },
        small: { url: "/media/small/receipt-1.jpg", width: 480, height: 360 },
      },
    },
  ]);

  assert.equal(PLAYER_THREAD_MEDIA_CONTRACT.component, "player-thread-media");
  assert.deepEqual(PLAYER_THREAD_MEDIA_CONTRACT.forbiddenVariants, [
    "original",
    "full",
    "desktop",
  ]);
  assert.deepEqual(media.items, [
    {
      id: "receipt-1",
      kind: "image",
      alt: "Vote receipt",
      src: "/media/tablet/receipt-1.jpg",
      srcset:
        "/media/tablet/receipt-1.jpg 960w, /media/small/receipt-1.jpg 480w",
      sizes: "(max-width: 1180px) 100vw, 720px",
      width: 960,
      height: 720,
      variant: "tablet",
      testId: "thread-post-media-receipt-1",
    },
  ]);
  assert.deepEqual(media.withheld, []);
  assert.equal(media.items[0].src.includes("original"), false);
  assert.equal(media.items[0].srcset.includes("original"), false);
  assert.equal(media.items[0].srcset.includes("desktop"), false);
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
        authorLabel: "Mira",
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
      reason: "missing tablet/small/thumb image variant",
    },
  ]);
  assert.equal(thread.posts[0].mediaBoundary.status, "tablet-variant-missing");
});
