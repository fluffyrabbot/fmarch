import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { _loadBoardGameIndex, load } from "./+page.server.js";

const FIRST_GAME = "00000000-0000-0000-0000-000000000020";
const SECOND_GAME = "00000000-0000-0000-0000-000000000010";
const pageSource = readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");

test("board load opts into the root-owned shell with an API-backed public index", async () => {
  const data = await load({
    locals: {
      principalId: "player_mira",
      resolvedCapabilities: [
        { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      ],
    },
    fetch: async (url) => {
      assert.equal(url, "/games?limit=12");
      return Response.json({
        games: [
          {
            game: FIRST_GAME,
            pack: "mafiascum",
            status: "active",
            phase_id: "D02",
            updated_seq: 20,
            completed_seq: null,
          },
          {
            game: SECOND_GAME,
            pack: "mafia_universe",
            status: "completed",
            phase_id: "D01",
            updated_seq: 10,
            completed_seq: 10,
          },
        ],
        next_cursor: null,
      });
    },
    url: new URL("https://fmarch.local/"),
  });

  assert.equal(data.shellOwner, "layout");
  assert.equal(data.shell.activeSurface, "board");
  assert.equal(data.shell.session.viewerLabel, "Your account");
  assert.equal(data.board.status, "ready");
  assert.deepEqual(
    data.board.games.map((game) => [game.id, game.status, game.phaseLabel]),
    [
      [FIRST_GAME, "active", "Day 2"],
      [SECOND_GAME, "completed", "Completed"],
    ],
  );
  assert.equal(data.board.games[0].actions[0].href, `/games/${FIRST_GAME}`);
  assert.equal(data.board.games[0].actions[1].href, `/g/${FIRST_GAME}`);
  assert.equal(data.board.games[1].actions[0].navigation, "link");
  assert.equal(data.board.games[1].actions[1].navigation, "blocked");
  assert.equal(data.board.olderHref, null);
  assert.equal(data.routeState, null);
});

test("board load exposes fixture route state for root-owned shell proof", async () => {
  const original = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
  process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
  try {
    const data = await load({
      locals: {
        principalId: "player_mira",
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

test("a healthy empty page stays distinct from degraded board state", async () => {
  const data = await load({
    locals: { principalId: null, resolvedCapabilities: [] },
    fetch: async () => Response.json({ games: [], next_cursor: null }),
    url: new URL("https://fmarch.local/"),
  });

  assert.equal(data.board.status, "ready");
  assert.deepEqual(data.board.games, []);
  assert.equal(data.board.olderHref, null);
  assert.equal(data.board.degradation, undefined);
});

test("503 becomes an explicit degraded board with bounded retry metadata", async () => {
  const data = await load({
    locals: { principalId: null, resolvedCapabilities: [] },
    fetch: async () =>
      new Response("unavailable", {
        status: 503,
        headers: {
          "retry-after": "9999999999",
          "x-request-id": "board:req/7",
        },
      }),
    url: new URL("https://fmarch.local/?cursor=bad"),
  });

  assert.equal(data.board.status, "degraded");
  assert.deepEqual(data.board.games, []);
  assert.equal(data.board.olderHref, null);
  assert.deepEqual(data.board.degradation, {
    kind: "unavailable",
    upstreamStatus: 503,
    retryAfterSeconds: 86_400,
    requestId: "board:req/7",
  });
});

test("transport and document failures degrade instead of throwing or appearing empty", async () => {
  const cases = [
    async () => {
      throw new Error("ECONNRESET private detail");
    },
    async () => new Response("{}", { headers: { "content-type": "text/plain" } }),
    async () => new Response("{", { headers: { "content-type": "application/json" } }),
    async () => Response.json({}),
    async () =>
      Response.json({
        games: [{ ...gameEntry(), game: "other-scope" }],
        next_cursor: null,
      }),
  ];

  for (const fetchImpl of cases) {
    const data = await load({
      locals: { principalId: null, resolvedCapabilities: [] },
      fetch: fetchImpl,
      url: new URL("https://fmarch.local/"),
    });
    assert.equal(data.board.status, "degraded");
    assert.deepEqual(data.board.games, []);
    assert.equal(data.board.degradation.requestId, null);
  }
});

test("rows outside a requested cursor scope cannot masquerade as ready", async () => {
  const cursor = `10:${FIRST_GAME}`;
  const data = await load({
    locals: { principalId: null, resolvedCapabilities: [] },
    fetch: async (url) => {
      assert.equal(
        url,
        `/games?cursor=${encodeURIComponent(cursor)}&limit=12`,
      );
      return Response.json({
        games: [gameEntry({ game: SECOND_GAME, updated_seq: 11 })],
        next_cursor: null,
      });
    },
    url: new URL(`https://fmarch.local/?cursor=${encodeURIComponent(cursor)}`),
  });

  assert.equal(data.board.status, "degraded");
  assert.equal(data.board.degradation.kind, "invalid_response");
});

test("deadline and caller abort remain explicit unavailable outcomes", async () => {
  const timedOut = await _loadBoardGameIndex({
    fetchImpl: abortingFetch,
    apiBaseUrl: "",
    url: new URL("https://fmarch.local/"),
    timeoutMs: 5,
  });
  assert.equal(timedOut.kind, "unavailable");
  assert.equal(timedOut.reason, "timeout");

  const caller = new AbortController();
  caller.abort();
  const aborted = await _loadBoardGameIndex({
    fetchImpl: abortingFetch,
    apiBaseUrl: "",
    url: new URL("https://fmarch.local/"),
    signal: caller.signal,
  });
  assert.equal(aborted.kind, "unavailable");
  assert.equal(aborted.reason, "aborted");
});

test("the board surface renders a read-only degraded status with safe retry context", () => {
  assert.match(pageSource, /data\.board\.status === "degraded"/u);
  assert.match(pageSource, /role="status"/u);
  assert.match(pageSource, /data\.board\.degradation\.retryAfterSeconds/u);
  assert.match(pageSource, /data\.board\.degradation\.requestId/u);
  assert.doesNotMatch(pageSource, /data\.board\.status === "unavailable"/u);
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

async function abortingFetch(_url, { signal } = {}) {
  return await new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
