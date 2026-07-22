import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_GAME_PUBLICATION_CONTRACT,
  buildPublicGamePublication,
} from "./public-game-publication.mjs";

test("public game publication creates a reading-first live record", () => {
  const view = buildPublicGamePublication({
    game: { pack: "mafia_universe", status: "active", phase_id: "day-2" },
    posts: [{ source_seq: 1 }, { source_seq: 2 }],
  });
  assert.equal(view.root.data.mode, "reading-publication");
  assert.equal(view.metadata.title, "Mafia universe game");
  assert.equal(view.metadata.statusLabel, "In progress");
  assert.equal(view.metadata.phaseLabel, "Day 2");
  assert.equal(view.readingLane.postCountLabel, "2 public posts");
  assert.equal(view.readingLane.maxMeasurePx, 760);
  assert.equal(view.readingLane.skipPostsTestId, "public-game-skip-posts");
  assert.equal(view.readingLane.headingId, "public-game-thread-title");
});

test("completed publications and unavailable games remain explicit", () => {
  const completed = buildPublicGamePublication({
    game: { pack: "mafiascum", status: "completed", phase_id: null },
    posts: [],
  });
  assert.equal(completed.metadata.eyebrow, "Completed public record");
  assert.equal(completed.metadata.phaseLabel, "Final record");
  assert.equal(completed.readingLane.postCountLabel, "0 public posts");
  assert.deepEqual(buildPublicGamePublication(), { status: "unavailable" });
  assert.deepEqual(PUBLIC_GAME_PUBLICATION_CONTRACT.threadStartBudgetPx, {
    mobile: 420,
    tablet: 380,
    desktop: 390,
  });
  assert.equal(PUBLIC_GAME_PUBLICATION_CONTRACT.reflowZoomPercent, 200);
  assert.deepEqual(PUBLIC_GAME_PUBLICATION_CONTRACT.preferenceMedia, [
    "prefers-reduced-motion",
    "forced-colors",
  ]);
});
