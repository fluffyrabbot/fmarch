import assert from "node:assert/strict";
import { test } from "node:test";
import { fixturePackCatalog, fixturePackRoleReference } from "../../lib/dev/pack-role-reference-fixture.mjs";
import { loadRoleReference, resolvePackKey } from "./roles-reference-loader.mjs";
import { buildRolesRouteData, parseRolesQuery, rolesHref } from "./roles-route-model.mjs";

async function at(search) {
  const query = parseRolesQuery(new URLSearchParams(search));
  const result = await loadRoleReference({ packKey: query.pack, fixture: true });
  return buildRolesRouteData({ query, catalog: result.catalog, reference: result.reference });
}

test("the reference defaults to Mafia Universe and selects the first role", async () => {
  const data = await at("");
  assert.equal(data.status, "ready");
  assert.equal(data.pack.key, "mafia_universe");
  assert.equal(data.rows.length, 111);
  assert.equal(data.resultLine, "Showing all 111 roles");
  assert.equal(data.selected.key, data.rows[0].key);
  assert.equal(data.selected.card.variant, "full");
  assert.deepEqual(data.counts.map((count) => [count.id, count.count]), [
    ["independent", 1], ["mafia", 52], ["town", 56], ["none", 2],
  ]);
  assert.equal(data.packOptions.length, 5);
  assert.equal(data.packOptions.find((pack) => pack.current).id, "mafia_universe");
});

test("pack and role deep links resolve, and switching packs resets filters", async () => {
  const data = await at("?pack=mafiascum&role=jester&alignment=jester");
  assert.equal(data.pack.key, "mafiascum");
  assert.equal(data.selected.key, "jester");
  assert.deepEqual(data.rows.map((row) => row.key), ["jester"]);
  assert.equal(data.selected.card.win, "Wins by getting lynched.");
  const chinese = data.packOptions.find((pack) => pack.id === "chinese_structured");
  assert.equal(chinese.href, "/roles?pack=chinese_structured");
  assert.equal(rolesHref({ pack: "mafia_universe", role: "godfather" }), "/roles?role=godfather");
});

test("filters compose, keep the selection link stable, and drop unknown values", async () => {
  const data = await at("?alignment=mafia&acts=day&q=shot&role=mafia_day_vigilante&view=cards");
  assert.deepEqual(data.rows.map((row) => row.key), ["mafia_day_desperado", "mafia_day_vigilante"]);
  assert.equal(data.selected.key, "mafia_day_vigilante");
  assert.equal(data.rows[1].selected, true);
  assert.equal(data.rows[0].href, "/roles?q=shot&alignment=mafia&acts=day&view=cards&role=mafia_day_desperado");
  assert.equal(data.alignmentOptions.find((option) => option.current).id, "mafia");
  assert.equal(data.clearHref, "/roles?view=cards");

  const junk = await at("?pack=../etc&alignment=wolves&acts=dusk&view=poster&role=nobody");
  assert.equal(junk.pack.key, "mafia_universe");
  assert.deepEqual(
    { alignment: junk.query.alignment, acts: junk.query.acts, view: junk.query.view, role: junk.query.role },
    { alignment: "all", acts: "any", view: "table", role: null },
  );
});

test("an empty result keeps no selection and offers a clear link", async () => {
  const data = await at("?pack=default_open&q=zzzz");
  assert.deepEqual(data.rows, []);
  assert.equal(data.selected, null);
  assert.equal(data.clearHref, "/roles?pack=default_open");
});

test("the upstream reads are game-free and failures degrade instead of emptying", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    const body = String(url).endsWith("/packs") ? fixturePackCatalog() : fixturePackRoleReference("epicmafia");
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await loadRoleReference({ fetchImpl, apiBaseUrl: "http://127.0.0.1:9", packKey: "epicmafia" });
  assert.equal(result.kind, "ok");
  assert.equal(result.reference.pack.key, "epicmafia");
  assert.deepEqual(requested, ["http://127.0.0.1:9/packs", "http://127.0.0.1:9/packs/epicmafia/roles"]);

  const down = await loadRoleReference({
    fetchImpl: async () => new Response("nope", { status: 503 }),
    apiBaseUrl: "http://127.0.0.1:9",
    packKey: "epicmafia",
  });
  assert.notEqual(down.kind, "ok");
  const degraded = buildRolesRouteData({ query: parseRolesQuery(new URLSearchParams()), reference: null });
  assert.equal(degraded.status, "unavailable");
  assert.equal(resolvePackKey([], "anything"), "mafia_universe");
});
