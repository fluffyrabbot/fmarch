import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLAYER_LAYOUTS,
  PLAYER_RAIL_MEDIA_QUERY,
  PLAYER_RAIL_MIN_WIDTH_PX,
  observePlayerLayout,
  playerLayoutFor,
} from "./player-layout.mjs";

test("the rail starts at 1100px and the media query says so", () => {
  assert.equal(PLAYER_RAIL_MIN_WIDTH_PX, 1100);
  assert.equal(PLAYER_RAIL_MEDIA_QUERY, "(min-width: 1100px)");
  assert.deepEqual([...PLAYER_LAYOUTS], ["flow", "sheet", "rail"]);
  assert.equal(playerLayoutFor(true), "rail");
  assert.equal(playerLayoutFor(false), "sheet");
});

test("observing the layout reports the current match and every crossing, then stops", () => {
  const listeners = new Set();
  const query = { matches: false, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  const seen = [];
  const dispose = observePlayerLayout({ matchMedia: value => { assert.equal(value, PLAYER_RAIL_MEDIA_QUERY); return query; } }, value => seen.push(value));
  assert.deepEqual(seen, ["sheet"]);
  query.matches = true;
  for (const fn of listeners) fn();
  assert.deepEqual(seen, ["sheet", "rail"]);
  dispose();
  assert.equal(listeners.size, 0);
});

test("a window without matchMedia gets the sheet layout once", () => {
  const seen = [];
  observePlayerLayout({}, value => seen.push(value));
  assert.deepEqual(seen, ["sheet"]);
});
