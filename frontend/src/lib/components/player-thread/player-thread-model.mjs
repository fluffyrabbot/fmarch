export const PLAYER_THREAD_MEDIA_CONTRACT = Object.freeze({
  component: "player-thread-media",
  preferredVariants: Object.freeze(["tablet", "small", "thumb", "thumbnail"]),
  forbiddenVariants: Object.freeze(["original", "full", "desktop"]),
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

export function buildPlayerThreadViewModel(thread = {}, { threadPageStatus = null } = {}) {
  const posts = Array.isArray(thread.posts) ? thread.posts : [];
  return Object.freeze({
    nextBeforeSeq: thread.nextBeforeSeq ?? null,
    pager: buildPlayerThreadPagerViewModel({ thread, threadPageStatus }),
    posts: Object.freeze(posts.map((post) => buildPlayerThreadPostViewModel(post))),
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
      label: pending ? "Loading older" : "Load older",
      disabled,
      ariaDisabled: disabled ? "true" : "false",
      minTouchTargetPx: PLAYER_THREAD_PAGER_CONTRACT.minTouchTargetPx,
      nextBeforeSeq,
    }),
  });
}

export function buildPlayerThreadPostViewModel(post = {}) {
  const media = buildPlayerThreadMedia(post.media);
  return Object.freeze({
    ...post,
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
          reason: "missing tablet/small/thumb image variant",
        }),
      );
      continue;
    }
    items.push(
      Object.freeze({
        id: String(item.id ?? `media-${items.length + 1}`),
        kind: "image",
        alt: String(item.alt ?? "Thread image"),
        src: selected.url,
        srcset: tabletThreadMediaSrcset(item.variants),
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
    if (typeof variant.url === "string" && variant.url.trim() !== "") {
      return Object.freeze({
        name,
        url: variant.url,
        width: Number.isFinite(Number(variant.width)) ? Number(variant.width) : null,
        height: Number.isFinite(Number(variant.height)) ? Number(variant.height) : null,
      });
    }
  }
  return null;
}

function tabletThreadMediaSrcset(variants = {}) {
  if (variants === null || typeof variants !== "object") {
    return null;
  }
  const entries = PLAYER_THREAD_MEDIA_CONTRACT.preferredVariants
    .map((name) => [name, variants[name]])
    .filter(([, variant]) => typeof variant?.url === "string" && variant.url.trim() !== "")
    .map(([, variant]) => {
      const width = Number(variant.width);
      return Number.isFinite(width) && width > 0
        ? `${variant.url} ${width}w`
        : variant.url;
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
