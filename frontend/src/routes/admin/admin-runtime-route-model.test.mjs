import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAdminRuntimeRouteData,
  loadAdminGameBootstrap,
  loadAdminGameIndex,
  normalizeAdminGameSelection,
} from "./admin-runtime-route-model.mjs";

const gameIndexPage = Object.freeze({
  games: Object.freeze([
    Object.freeze({ game: "setup-game", pack: "mafiascum", status: "setup", phase_id: null }),
    Object.freeze({ game: "active-game", pack: "epicmafia", status: "active", phase_id: "D01" }),
    Object.freeze({ game: "old-game", pack: "mafiascum", status: "completed", phase_id: "D04" }),
  ]),
});

test("admin game selection includes setup games and prefers the requested workspace", () => {
  const selection = normalizeAdminGameSelection(gameIndexPage, "active-game");
  assert.equal(selection.status, "ready");
  assert.equal(selection.selectedGame, "active-game");
  assert.deepEqual(
    selection.options.map((game) => [game.id, game.status, game.selected, game.href]),
    [
      ["setup-game", "setup", false, "/admin?game=setup-game"],
      ["active-game", "active", true, "/admin?game=active-game"],
      ["old-game", "completed", false, "/admin?game=old-game"],
    ],
  );
});

test("admin route selects a live game without requiring a query parameter", async () => {
  const data = await buildAdminRuntimeRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    gameIndexPage,
  });
  assert.equal(data.gameSelection.selectedGame, "setup-game");
  assert.equal(data.shell.game, "setup-game");
  assert.equal(data.gameSetup[0].href, "/g/setup-game/setup");
});

test("admin game discovery uses the authenticated operator boundary", async () => {
  const observed = {};
  const page = await loadAdminGameIndex({
    apiBaseUrl: "http://api.internal",
    sessionToken: "admin-session",
    fetchImpl: async (url, init) => {
      observed.url = url;
      observed.headers = init.headers;
      return Response.json(gameIndexPage);
    },
  });
  assert.equal(observed.url, "http://api.internal/admin/games?limit=100");
  assert.equal(observed.headers.authorization, "Bearer admin-session");
  assert.deepEqual(page, gameIndexPage);
});

test("fresh-install admin receives a pack catalog without inventing a game workspace", async () => {
  const data = await buildAdminRuntimeRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    gameIndexPage: { games: [], next_cursor: null },
    bootstrapCatalog: {
      packs: [
        { key: "mafiascum", name: "Mafiascum" },
        { key: "mafia_universe", name: "Mafia Universe" },
      ],
    },
  });
  assert.equal(data.gameSelection.selectedGame, null);
  assert.equal(data.bootstrap.available, true);
  assert.equal(data.bootstrap.defaultPack, "mafiascum");
  assert.deepEqual(data.bootstrap.packs.map((pack) => pack.name), ["Mafiascum", "Mafia Universe"]);
  assert.deepEqual(data.gameSetup, []);
});

test("admin bootstrap catalog uses the authenticated GlobalAdmin boundary", async () => {
  const observed = {};
  const catalog = await loadAdminGameBootstrap({
    apiBaseUrl: "http://api.internal",
    sessionToken: "admin-session",
    fetchImpl: async (url, init) => {
      observed.url = url;
      observed.authorization = init.headers.authorization;
      return Response.json({ packs: [{ key: "mafiascum", name: "Mafiascum" }] });
    },
  });
  assert.equal(observed.url, "http://api.internal/admin/game-bootstrap");
  assert.equal(observed.authorization, "Bearer admin-session");
  assert.equal(catalog.packs[0].key, "mafiascum");
});
