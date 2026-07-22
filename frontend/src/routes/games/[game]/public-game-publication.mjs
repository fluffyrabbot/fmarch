export const PUBLIC_GAME_PUBLICATION_CONTRACT = Object.freeze({
  componentName: "public-game-publication",
  mode: "reading-publication",
  rootTestId: "public-game-publication",
  metadataTestId: "public-game-metadata",
  readingLaneTestId: "public-game-reading-lane",
  skipPostsTestId: "public-game-skip-posts",
  threadHeadingId: "public-game-thread-title",
  maxReadingMeasurePx: 760,
  reflowZoomPercent: 200,
  preferenceMedia: Object.freeze(["prefers-reduced-motion", "forced-colors"]),
  threadStartBudgetPx: Object.freeze({ mobile: 420, tablet: 380, desktop: 390 }),
});

export function buildPublicGamePublication({ game = null, posts = [] } = {}) {
  if (game === null || typeof game !== "object") {
    return Object.freeze({ status: "unavailable" });
  }
  const normalizedPosts = Array.isArray(posts) ? posts : [];
  const packLabel = humanize(game.pack ?? "Game");
  const active = game.status === "active";
  const phase = game.phase_id == null ? "Final record" : humanize(game.phase_id);
  return Object.freeze({
    status: "ready",
    root: Object.freeze({
      testId: PUBLIC_GAME_PUBLICATION_CONTRACT.rootTestId,
      data: Object.freeze({
        component: PUBLIC_GAME_PUBLICATION_CONTRACT.componentName,
        mode: PUBLIC_GAME_PUBLICATION_CONTRACT.mode,
      }),
    }),
    metadata: Object.freeze({
      testId: PUBLIC_GAME_PUBLICATION_CONTRACT.metadataTestId,
      eyebrow: active ? "Live public record" : "Completed public record",
      title: `${packLabel} game`,
      deck: active
        ? "Follow the public conversation as the game unfolds."
        : "Read the preserved public conversation from this completed game.",
      statusLabel: active ? "In progress" : "Complete",
      phaseLabel: phase,
    }),
    readingLane: Object.freeze({
      testId: PUBLIC_GAME_PUBLICATION_CONTRACT.readingLaneTestId,
      skipPostsTestId: PUBLIC_GAME_PUBLICATION_CONTRACT.skipPostsTestId,
      headingId: PUBLIC_GAME_PUBLICATION_CONTRACT.threadHeadingId,
      heading: "Main thread",
      postCountLabel: countLabel(normalizedPosts.length, "public post", "public posts"),
      maxMeasurePx: PUBLIC_GAME_PUBLICATION_CONTRACT.maxReadingMeasurePx,
    }),
  });
}

function humanize(value) {
  const text = String(value).replaceAll(/[_-]+/gu, " ").trim();
  return text === "" ? "Game" : `${text[0].toUpperCase()}${text.slice(1)}`;
}

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}
