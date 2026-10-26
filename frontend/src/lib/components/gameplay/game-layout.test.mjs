import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GAME_LAYOUTS,
  GAME_LAYOUT_SETTLE_MS,
  GAME_RAIL_MEDIA_QUERY,
  GAME_RAIL_MIN_WIDTH_PX,
  observeGameLayout,
  gameLayoutFor,
} from "./game-layout.mjs";

test("the rail starts at 1100px and the media query says so", () => {
  assert.equal(GAME_RAIL_MIN_WIDTH_PX, 1100);
  assert.equal(GAME_RAIL_MEDIA_QUERY, "(min-width: 1100px)");
  assert.deepEqual([...GAME_LAYOUTS], ["flow", "sheet", "rail"]);
  assert.equal(GAME_LAYOUT_SETTLE_MS, 120);
  assert.equal(gameLayoutFor(true), "rail");
  assert.equal(gameLayoutFor(false), "sheet");
});

function fakeWindow() {
  const listeners = new Set();
  const timers = new Map();
  let nextTimer = 1;
  const query = { matches: false, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  const windowRef = {
    matchMedia: (value) => { assert.equal(value, GAME_RAIL_MEDIA_QUERY); return query; },
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const cross = (matches) => { query.matches = matches; for (const fn of listeners) fn(); };
  const elapse = () => { for (const [id, { fn }] of [...timers]) { timers.delete(id); fn(); } };
  return { windowRef, listeners, timers, cross, elapse };
}

test("observing the layout reports the current match now and a crossing once it settles, then stops", () => {
  const { windowRef, listeners, timers, cross, elapse } = fakeWindow();
  const seen = [];
  const dispose = observeGameLayout(windowRef, (value) => seen.push(value));
  assert.deepEqual(seen, ["sheet"]);
  cross(true);
  assert.deepEqual(seen, ["sheet"], "a crossing waits for the settle time");
  assert.deepEqual([...timers.values()].map((timer) => timer.ms), [GAME_LAYOUT_SETTLE_MS]);
  elapse();
  assert.deepEqual(seen, ["sheet", "rail"]);
  dispose();
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
});

test("a crossing that returns within the settle time is not a crossing", () => {
  const { windowRef, timers, cross, elapse } = fakeWindow();
  const seen = [];
  observeGameLayout(windowRef, (value) => seen.push(value));
  cross(true);
  cross(false);
  assert.equal(timers.size, 1, "the blip reschedules one settle");
  elapse();
  assert.deepEqual(seen, ["sheet"]);
});

test("a window without matchMedia gets the sheet layout once", () => {
  const seen = [];
  observeGameLayout({}, (value) => seen.push(value));
  assert.deepEqual(seen, ["sheet"]);
});
