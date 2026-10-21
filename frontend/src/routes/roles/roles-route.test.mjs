import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./+page.server.js";
import { buildRolesRouteData, parseRolesQuery, rolesHref } from "./roles-route-model.mjs";

const locals = { principalId: null, resolvedCapabilities: [] };
const at = (search) => load({ locals, url: new URL(`http://localhost/roles${search}`) });

test("the reference lists every catalog role and selects the first by default", () => {
  const data = at("");
  assert.equal(data.shellOwner, "layout");
  assert.equal(data.shell.activeSurface, "roles");
  assert.equal(data.roles.rows.length, 19);
  assert.equal(data.roles.resultLine, "Showing all 19 roles");
  assert.equal(data.roles.selected.key, data.roles.rows[0].key);
  assert.equal(data.roles.selected.card.variant, "full");
  assert.deepEqual(data.roles.counts.map((count) => [count.id, count.count]), [["town", 13], ["mafia", 5], ["independent", 1]]);
});

test("filters compose, keep the selection link stable, and drop unknown values", () => {
  const data = at("?alignment=mafia&acts=night&q=kill&role=godfather&view=cards");
  assert.deepEqual(data.roles.rows.map((row) => row.key), ["godfather", "mafia_goon", "mafia_janitor"]);
  assert.equal(data.roles.selected.key, "godfather");
  assert.equal(data.roles.rows[0].selected, true);
  assert.equal(data.roles.rows[1].href, "/roles?q=kill&alignment=mafia&acts=night&view=cards&role=mafia_goon");
  assert.equal(data.roles.alignmentOptions.find((option) => option.current).id, "mafia");
  assert.equal(data.roles.clearHref, "/roles?view=cards");

  const junk = parseRolesQuery(new URLSearchParams("alignment=wolves&acts=dusk&view=poster&role=nobody"));
  assert.deepEqual({ ...junk }, { q: "", alignment: "all", acts: "any", view: "table", role: null });
});

test("passive and day filters follow each role's action windows", () => {
  const passive = buildRolesRouteData({ query: parseRolesQuery(new URLSearchParams("acts=passive")) });
  assert.deepEqual(passive.rows.map((row) => row.key), ["mason", "miller", "town_vanilla"]);
  assert.equal(passive.rows[0].abilitiesText, "None");
  const day = buildRolesRouteData({ query: parseRolesQuery(new URLSearchParams("acts=day")) });
  assert.deepEqual(day.rows.map((row) => row.key), ["town_day_vigilante", "innocent_child"]);
});

test("an empty result keeps no selection and offers a clear link", () => {
  const data = at("?q=zzzz");
  assert.deepEqual(data.roles.rows, []);
  assert.equal(data.roles.selected, null);
  assert.equal(data.roles.clearHref, "/roles");
  assert.equal(rolesHref({ q: "", alignment: "all", acts: "any", view: "table", role: null }), "/roles");
});
