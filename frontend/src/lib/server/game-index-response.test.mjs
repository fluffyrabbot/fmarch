import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeGameIndexPage } from "./game-index-response.mjs";

const FIRST_GAME = "00000000-0000-0000-0000-000000000020";
const SECOND_GAME = "00000000-0000-0000-0000-000000000010";

test("the exact GameIndexPage decoder accepts a healthy immutable page", () => {
  const decoded = decodeGameIndexPage({
    games: [
      gameEntry({ game: FIRST_GAME, updated_seq: 20 }),
      gameEntry({
        game: SECOND_GAME,
        status: "completed",
        phase_id: "D03",
        updated_seq: 10,
        completed_seq: 10,
      }),
    ],
    next_cursor: null,
  });

  assert.deepEqual(decoded, {
    games: [
      gameEntry({ game: FIRST_GAME, updated_seq: 20 }),
      gameEntry({
        game: SECOND_GAME,
        status: "completed",
        phase_id: "D03",
        updated_seq: 10,
        completed_seq: 10,
      }),
    ],
    next_cursor: null,
  });
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(Object.isFrozen(decoded.games), true);
  assert.equal(Object.isFrozen(decoded.games[0]), true);
});

test("empty is valid only when the complete page envelope is present", () => {
  assert.deepEqual(decodeGameIndexPage({ games: [], next_cursor: null }), {
    games: [],
    next_cursor: null,
  });
  for (const invalid of [
    {},
    { games: [] },
    { games: [], next_cursor: null, authority: "admin" },
    { games: {}, next_cursor: null },
  ]) {
    assert.equal(decodeGameIndexPage(invalid), null);
  }
});

test("rows enforce exact fields and Rust DTO invariants", () => {
  const valid = gameEntry();
  for (const invalid of [
    { ...valid, game: "not-a-uuid" },
    { ...valid, game: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA" },
    { ...valid, status: "setup" },
    { ...valid, phase_id: "Day 1" },
    { ...valid, updated_seq: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, completed_seq: 1 },
    { ...valid, unexpected: true },
    {
      ...valid,
      status: "completed",
      completed_seq: valid.updated_seq - 1,
    },
  ]) {
    assert.equal(
      decodeGameIndexPage({ games: [invalid], next_cursor: null }),
      null,
    );
  }
});

test("page order, request scope, uniqueness, and continuation cursor are bound", () => {
  const scopedCursor = `30:${FIRST_GAME}`;
  const scoped = decodeGameIndexPage(
    {
      games: [gameEntry({ game: FIRST_GAME, updated_seq: 20 })],
      next_cursor: null,
    },
    { cursor: scopedCursor },
  );
  assert.notEqual(scoped, null);

  for (const games of [
    [
      gameEntry({ game: FIRST_GAME, updated_seq: 10 }),
      gameEntry({ game: SECOND_GAME, updated_seq: 20 }),
    ],
    [gameEntry(), gameEntry()],
  ]) {
    assert.equal(decodeGameIndexPage({ games, next_cursor: null }), null);
  }

  assert.equal(
    decodeGameIndexPage(
      {
        games: [gameEntry({ game: FIRST_GAME, updated_seq: 31 })],
        next_cursor: null,
      },
      { cursor: scopedCursor },
    ),
    null,
  );

  const fullPage = Array.from({ length: 12 }, (_, index) =>
    gameEntry({
      game: `00000000-0000-0000-0000-${String(20 - index).padStart(12, "0")}`,
      updated_seq: 20 - index,
    }),
  );
  assert.notEqual(
    decodeGameIndexPage({
      games: fullPage,
      next_cursor: `9:${fullPage.at(-1).game}`,
    }),
    null,
  );
  assert.equal(
    decodeGameIndexPage({
      games: fullPage,
      next_cursor: `10:${fullPage.at(-1).game}`,
    }),
    null,
  );
  assert.equal(
    decodeGameIndexPage({
      games: fullPage.slice(0, 1),
      next_cursor: `20:${fullPage[0].game}`,
    }),
    null,
  );
});

function gameEntry(overrides = {}) {
  return {
    game: FIRST_GAME,
    pack: "mafiascum",
    status: "active",
    phase_id: "D02",
    updated_seq: 20,
    completed_seq: null,
    ...overrides,
  };
}
