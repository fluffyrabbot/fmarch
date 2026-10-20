import assert from "node:assert/strict";
import { test } from "node:test";

import { deadlineCountdown } from "./deadline-countdown.mjs";

const NOW_MS = 1_782_000_000_000;
const at = (seconds) => NOW_MS / 1000 + seconds;

test("a countdown reads in the largest two units that matter", () => {
  assert.equal(deadlineCountdown(at(2 * 86400 + 3 * 3600 + 59), NOW_MS), "2d 3h left");
  assert.equal(deadlineCountdown(at(86400), NOW_MS), "1d left");
  assert.equal(deadlineCountdown(at(4 * 3600 + 12 * 60), NOW_MS), "4h 12m left");
  assert.equal(deadlineCountdown(at(3600), NOW_MS), "1h left");
  assert.equal(deadlineCountdown(at(12 * 60 + 30), NOW_MS), "12m left");
  assert.equal(deadlineCountdown(at(30), NOW_MS), "Under a minute left");
});

test("a passed or missing deadline says so", () => {
  assert.equal(deadlineCountdown(at(0), NOW_MS), "Passed");
  assert.equal(deadlineCountdown(at(-600), NOW_MS), "Passed");
  assert.equal(deadlineCountdown(null, NOW_MS), null);
  assert.equal(deadlineCountdown(undefined, NOW_MS), null);
});
