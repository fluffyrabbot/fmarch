import {
  buildGamePostQuoteView,
  excerptFromBody,
} from "../../app/game-quotation-model.mjs";
import { buildPlayerThreadEmbedView } from "../../app/youtube-embed.mjs";

export const PLAYER_THREAD_MEDIA_CONTRACT = Object.freeze({
  component: "player-thread-media",
  preferredVariants: Object.freeze(["tablet", "thumb", "full-bounded"]),
  responsiveVariants: Object.freeze(["thumb", "tablet", "full-bounded"]),
  forbiddenVariants: Object.freeze(["original"]),
  imageSizes: "(max-width: 1180px) 100vw, 720px",
  unavailableLabel: "Image unavailable on tablet",
});

export const PLAYER_THREAD_PAGER_CONTRACT = Object.freeze({
  component: "player-thread-pager",
  rootTestId: "player-thread-pager",
  cursorTestId: "player-thread-page-cursor",
  buttonTestId: "player-thread-load-older",
  minTouchTargetPx: 44,
});

export function mergeThreadPage(currentThread, olderPage) {
  const postsBySeq = new Map();
  for (const post of [...olderPage.posts, ...currentThread.posts]) {
    postsBySeq.set(post.seq, post);
  }
  return Object.freeze({
    nextBeforeSeq: olderPage.nextBeforeSeq,
    posts: Object.freeze(
      [...postsBySeq.values()].sort((left, right) => Number(left.seq) - Number(right.seq)),
    ),
  });
}

export function threadPageStatusForResult(olderPostCount) {
  const count = Number(olderPostCount);
  return Object.freeze({
    state: "ack",
    message: count === 1 ? "Loaded 1 older post" : `Loaded ${count} older posts`,
  });
}

export function buildPlayerThreadViewModel(
  thread = {},
  { threadPageStatus = null, quoteEnabled = false } = {},
) {
  const posts = Array.isArray(thread.posts) ? thread.posts : [];
  return Object.freeze({
    nextBeforeSeq: thread.nextBeforeSeq ?? null,
    pager: buildPlayerThreadPagerViewModel({ thread, threadPageStatus }),
    quoteEnabled: quoteEnabled === true,
    posts: Object.freeze(
      posts.map((post) => buildPlayerThreadPostViewModel(post, { posts, quoteEnabled })),
    ),
  });
}

export function buildPlayerThreadPagerViewModel({
  thread = {},
  threadPageStatus = null,
} = {}) {
  const nextBeforeSeq = thread.nextBeforeSeq ?? null;
  const pending = threadPageStatus?.state === "pending";
  const hasOlder = nextBeforeSeq !== null;
  const state = pending ? "pending" : hasOlder ? "ready" : "complete";
  const disabled = pending || !hasOlder;
  const disabledReason = pagerDisabledReason({
    pending,
    hasOlder,
    threadPageStatus,
  });

  return Object.freeze({
    root: Object.freeze({
      component: PLAYER_THREAD_PAGER_CONTRACT.component,
      testId: PLAYER_THREAD_PAGER_CONTRACT.rootTestId,
      state,
      busy: pending ? "true" : "false",
    }),
    cursor: Object.freeze({
      testId: PLAYER_THREAD_PAGER_CONTRACT.cursorTestId,
      label: hasOlder ? `Older before #${nextBeforeSeq}` : "At oldest loaded post",
      nextBeforeSeq,
    }),
    button: Object.freeze({
      testId: PLAYER_THREAD_PAGER_CONTRACT.buttonTestId,
      label: pending ? "Loading older" : hasOlder ? "Load older" : "No older posts",
      disabled,
      ariaDisabled: disabled ? "true" : "false",
      disabledReason,
      minTouchTargetPx: PLAYER_THREAD_PAGER_CONTRACT.minTouchTargetPx,
      nextBeforeSeq,
    }),
  });
}

function pagerDisabledReason({ pending, hasOlder, threadPageStatus }) {
  if (pending) {
    return String(threadPageStatus?.message ?? "Loading older posts");
  }
  if (!hasOlder) {
    return "At oldest loaded post";
  }
  return null;
}

export function buildPlayerThreadAuthorView(post = {}) {
  const name = String(post?.authorLabel ?? "").trim() || "Unknown";
  const seat = String(post?.authorSlot ?? "").trim();
  return Object.freeze({
    name,
    seat: seat !== "" && seat !== name ? seat : null,
  });
}

export function buildPlayerThreadPermalinkView(post = {}) {
  const seq = Number(post?.seq);
  if (!Number.isInteger(seq) || seq < 1) {
    return null;
  }
  const meta = String(post?.meta ?? "").trim();
  return Object.freeze({
    href: `#thread-post-${seq}`,
    testId: `thread-post-permalink-${seq}`,
    label: `#${seq}`,
    meta,
    ariaLabel: meta === "" ? `Permalink to post ${seq}` : `Permalink to post ${seq}, ${meta}`,
  });
}

export function buildPlayerThreadPostViewModel(
  post = {},
  { posts = [], quoteEnabled = false } = {},
) {
  const media = buildPlayerThreadMedia(post.media);
  const quote = buildGamePostQuoteView(post, { posts });
  const excerpt = excerptFromBody(post.body);
  return Object.freeze({
    ...post,
    author: buildPlayerThreadAuthorView(post),
    permalink: buildPlayerThreadPermalinkView(post),
    embed: buildPlayerThreadEmbedView(post.embed, post.seq),
    quotations: quote.quotations,
    citationCount: quote.citationCount,
    incomingCitations: quote.incomingCitations,
    moreCitationCount: quote.moreCitationCount,
    quoteEnabled: quoteEnabled === true && excerpt !== "",
    media,
    mediaBoundary: Object.freeze({
      status:
        media.items.length === 0 && media.withheld.length > 0
          ? "tablet-variant-missing"
          : "tablet-safe-media",
      renderedCount: media.items.length,
      withheldCount: media.withheld.length,
      preferredVariants: PLAYER_THREAD_MEDIA_CONTRACT.preferredVariants,
      forbiddenVariants: PLAYER_THREAD_MEDIA_CONTRACT.forbiddenVariants,
    }),
  });
}

export function buildPlayerThreadMedia(value) {
  const sourceItems = Array.isArray(value) ? value : [];
  const items = [];
  const withheld = [];
  for (const item of sourceItems) {
    if (String(item?.kind ?? "image") !== "image") {
      continue;
    }
    const selected = selectTabletThreadMediaVariant(item?.variants);
    if (selected === null) {
      withheld.push(
        Object.freeze({
          id: String(item?.id ?? `media-${withheld.length + 1}`),
          reason: "missing manifest-backed responsive image variants",
        }),
      );
      continue;
    }
    items.push(
      Object.freeze({
        id: String(item.id ?? `media-${items.length + 1}`),
        contentId: String(item.contentId ?? item.id ?? ""),
        kind: "image",
        alt: String(item.alt ?? "Thread image"),
        src: selected.webpUrl,
        sources: Object.freeze([
          Object.freeze({
            type: "image/avif",
            srcset: threadMediaSrcset(item.variants, "avifUrl"),
          }),
          Object.freeze({
            type: "image/webp",
            srcset: threadMediaSrcset(item.variants, "webpUrl"),
          }),
        ]),
        sizes: PLAYER_THREAD_MEDIA_CONTRACT.imageSizes,
        width: selected.width,
        height: selected.height,
        variant: selected.name,
        testId: `thread-post-media-${String(item.id ?? items.length + 1)}`,
      }),
    );
  }
  return Object.freeze({
    component: PLAYER_THREAD_MEDIA_CONTRACT.component,
    items: Object.freeze(items),
    withheld: Object.freeze(withheld),
  });
}

export function selectTabletThreadMediaVariant(variants = {}) {
  if (variants === null || typeof variants !== "object") {
    return null;
  }
  for (const name of PLAYER_THREAD_MEDIA_CONTRACT.preferredVariants) {
    const variant = variants[name];
    if (variant === null || typeof variant !== "object") {
      continue;
    }
    if (
      typeof variant.avifUrl === "string" &&
      variant.avifUrl.trim() !== "" &&
      typeof variant.webpUrl === "string" &&
      variant.webpUrl.trim() !== ""
    ) {
      return Object.freeze({
        name,
        avifUrl: variant.avifUrl,
        webpUrl: variant.webpUrl,
        width: Number.isFinite(Number(variant.width)) ? Number(variant.width) : null,
        height: Number.isFinite(Number(variant.height)) ? Number(variant.height) : null,
      });
    }
  }
  return null;
}

function threadMediaSrcset(variants = {}, urlField) {
  if (variants === null || typeof variants !== "object") {
    return null;
  }
  const byWidth = new Map();
  for (const name of PLAYER_THREAD_MEDIA_CONTRACT.responsiveVariants) {
    const variant = variants[name];
    if (typeof variant?.[urlField] !== "string" || variant[urlField].trim() === "") {
      continue;
    }
    const width = Number(variant.width);
    const key = Number.isFinite(width) && width > 0 ? width : name;
    if (!byWidth.has(key)) {
      byWidth.set(key, variant);
    }
  }
  const entries = [...byWidth.values()]
    .sort((left, right) => Number(left.width ?? 0) - Number(right.width ?? 0))
    .map((variant) => {
      const width = Number(variant.width);
      return Number.isFinite(width) && width > 0
        ? `${variant[urlField]} ${width}w`
        : variant[urlField];
    });
  return entries.length === 0 ? null : entries.join(", ");
}

export function buildLiveOfficialPost(thread = {}) {
  const posts = Array.isArray(thread.posts) ? thread.posts : [];
  const officialPost = posts
    .filter(isOfficialHostPost)
    .sort((left, right) => Number(right.seq) - Number(left.seq))[0];
  if (officialPost === undefined) {
    return null;
  }

  return Object.freeze({
    seq: officialPost.seq,
    label: "Official host post",
    value: String(officialPost.body ?? "").split("\n")[0],
    detail: officialPost.meta ?? "live thread projection",
  });
}

function isOfficialHostPost(post) {
  const author = String(post?.authorLabel ?? post?.authorUser ?? "").toLowerCase();
  return author === "host" && String(post?.body ?? "").startsWith("Official votecount");
}
