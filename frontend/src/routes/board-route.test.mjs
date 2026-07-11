import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./+page.server.js";

test("board load opts into the root-owned shell with an API-backed public index", async () => {
  const data = await load({
    locals: {
      principalUserId: "player_mira",
      resolvedCapabilities: [
        { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      ],
    },
    fetch: async (url) => {
      assert.equal(url, "/games?limit=12");
      return Response.json({
        games: [
          {
            game: "midsummer",
            pack: "mafiascum",
            status: "active",
            phase_id: "D02",
            updated_seq: 20,
            completed_seq: null,
          },
          {
            game: "solstice",
            pack: "mafia_universe",
            status: "completed",
            phase_id: "D01",
            updated_seq: 10,
            completed_seq: 10,
          },
        ],
        next_cursor: "10:solstice",
      });
    },
    url: new URL("https://fmarch.local/"),
  });

  assert.equal(data.shellOwner, "layout");
  assert.equal(data.shell.activeSurface, "board");
  assert.equal(data.shell.session.principalLabel, "player_mira");
  assert.equal(data.board.status, "ready");
  assert.deepEqual(
    data.board.games.map((game) => [game.id, game.status, game.phaseLabel]),
    [
      ["midsummer", "active", "D02"],
      ["solstice", "completed", "Completed"],
    ],
  );
  assert.equal(data.board.games[0].actions[0].href, "/g/midsummer");
  assert.equal(data.board.games[1].actions[0].navigation, "blocked");
  assert.equal(data.board.olderHref, "/?cursor=10%3Asolstice");
  assert.equal(data.routeState, null);
});

test("board load exposes fixture route state for root-owned shell proof", async () => {
  const original = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
  process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
  try {
    const data = await load({
      locals: {
        principalUserId: "player_mira",
        resolvedCapabilities: [
          { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
        ],
      },
      url: new URL("https://fmarch.local/?__fmarch_route_state=loading"),
    });

    assert.equal(data.shellOwner, "layout");
    assert.deepEqual(data.routeState, {
      surface: "board",
      state: "loading",
      message: null,
      actionHref: null,
    });
  } finally {
    if (original === undefined) {
      delete process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
    } else {
      process.env.FMARCH_FRONTEND_FIXTURE_SESSION = original;
    }
  }
});

test("board load keeps a failed public query explicit", async () => {
  const data = await load({
    locals: { principalUserId: null, resolvedCapabilities: [] },
    fetch: async () => new Response("unavailable", { status: 503 }),
    url: new URL("https://fmarch.local/?cursor=bad"),
  });

  assert.equal(data.board.status, "unavailable");
  assert.deepEqual(data.board.games, []);
  assert.equal(data.board.olderHref, null);
});
