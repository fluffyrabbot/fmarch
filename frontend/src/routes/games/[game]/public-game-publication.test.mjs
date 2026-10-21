import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_GAME_PUBLICATION_CONTRACT,
  buildPublicGamePosts,
  buildPublicGamePublication,
  buildPublicRoster,
} from "./public-game-publication.mjs";
import { fixturePackRoleReference } from "../../../lib/dev/pack-role-reference-fixture.mjs";

test("public game publication creates a reading-first live record", () => {
  const view = buildPublicGamePublication({
    game: { pack: "mafia_universe", status: "active", phase_id: "D02" },
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

test("public game posts keep stored excerpts when the original is off-page", () => {
  const posts = buildPublicGamePosts(
    [
      {
        source_seq: 8,
        author: { kind: "slot", slot_id: "slot-2" },
        body: "Reply",
        quotations: [{ target: { source_seq: 3 }, excerpt: "gone" }],
        citation_count: 0,
      },
    ],
    {},
  );
  assert.equal(posts[0].quotations[0].excerpt, "gone");
  assert.equal(posts[0].quotations[0].originalState, "unresolved");
  assert.equal(posts[0].quotations[0].href, "?post=3#thread-post-3");
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

test("a pre-phase public game remains distinct from a completed record", () => {
  const view = buildPublicGamePublication({
    game: { pack: "mafiascum", status: "setup", phase_id: null },
  });
  assert.equal(view.metadata.phaseLabel, "Awaiting first phase");
});

test("public roster names seats robustly from occupancy history", () => {
  const occupancy = (began, ended, ...names) => ({ began_seq: began, ended_seq: ended, names: names.map((public_name, i) => ({ effective_seq: began + i, public_name })) });
  const roster = buildPublicRoster([
    { slot_id: "s1", alive: true, status: "alive", occupancies: [occupancy(1, null, "Clover", "Sir Clover")] },
    { slot_id: "s2", alive: true, status: "alive", occupancies: [occupancy(1, 9, "Wisp"), occupancy(9, null, "Pip")] },
    { slot_id: "s3", alive: false, status: "dead", occupancies: [occupancy(1, null, "Thistle")] },
    { slot_id: "s4", alive: false, status: "modkilled", occupancies: [] },
    { slot_id: "s5", alive: true, status: "on_leave", occupancies: [occupancy(1, null, " ")] },
    { slot_id: "", alive: true, status: "alive", occupancies: [] },
    null,
  ]);
  assert.deepEqual(roster.map(({ name, formerly, replaced, alive, statusLabel }) => [name, formerly, replaced, alive, statusLabel]), [
    ["Sir Clover", "Clover", null, true, "Alive"],
    ["Pip", null, "Wisp", true, "Alive"],
    ["Thistle", null, null, false, "Found at dawn"],
    ["Unknown seat", null, null, false, "Removed by host"],
    ["Unknown seat", null, null, true, "On leave"],
  ]);
  assert.deepEqual(buildPublicRoster(undefined), []);
});

test("public flip posts render only the roles the projection revealed", () => {
  const reference = fixturePackRoleReference("mafiascum").roles.find((role) => role.key === "mafia_goon");
  const [revealed, concealed] = buildPublicGamePosts([
    {
      source_seq: 7,
      author: { kind: "system" },
      body: "Phase D01 announcement: slot_2 (day_vote).",
      role_reveals: [{ slot_id: "slot_2", role_key: "mafia_goon", reference }],
    },
    { source_seq: 8, author: { kind: "system" }, body: "Phase N01 announcement: slot_3 (janitor_kill)." },
  ], {}, "game-1");
  assert.deepEqual(
    revealed.roleReveals.map((reveal) => [reveal.testId, reveal.roleLabel, reveal.chip.variant]),
    [["public-game-post-role-7-slot_2", "Mafia Goon", "chip"]],
  );
  assert.deepEqual(concealed.roleReveals, []);
});
