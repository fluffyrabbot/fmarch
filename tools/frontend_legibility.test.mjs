import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGIBILITY_MODE,
  legibilityEvidenceComplete,
  scanLegibility,
} from "./frontend_legibility.mjs";

const sample = (text, where = "thread-post-1") => ({ text, where, source: "text" });

test("engine identifiers are reported on every surface", () => {
  const violations = scanLegibility(
    [
      sample("slot-2 explain the wagon"),
      sample("Hosting as @aef8cdd1-0914-5e70-97fa-fdf58ecf0f55", "host-console-capability"),
      sample("HostOf(midsummer)"),
      sample("skip_next_day", "host-task-row"),
    ],
    { surface: "moderator" },
  );
  assert.deepEqual(
    violations.map((violation) => [violation.rule, violation.match, violation.where]),
    [
      ["seat-id", "slot-2", "thread-post-1"],
      ["uuid", "aef8cdd1-0914-5e70-97fa-fdf58ecf0f55", "host-console-capability"],
      ["capability-kind", "HostOf", "thread-post-1"],
      ["snake-case", "skip_next_day", "host-task-row"],
    ],
  );
});

test("transport jargon is a player-surface rule only", () => {
  const text = [sample("1 recent player command receipt"), sample("retry only with the same command ID")];
  assert.deepEqual(
    scanLegibility(text, { surface: "player" }).map((violation) => violation.match),
    ["command receipt", "command ID"],
  );
  assert.deepEqual(scanLegibility(text, { surface: "admin" }), []);
});

test("ordinary product copy is clean", () => {
  assert.deepEqual(
    scanLegibility(
      [sample("Mira · S7"), sample("Vote no lynch"), sample("Day 1 · Deadline Jun 20, 5:00 PM")],
      { surface: "player" },
    ),
    [],
  );
});

test("violations carry an excerpt around the match", () => {
  const [violation] = scanLegibility(
    [sample("Night results, notices, and seats you were addressed as are delivered to slot_7 alone.")],
    { surface: "player" },
  );
  assert.equal(violation.match, "slot_7");
  assert.match(violation.excerpt, /^….*slot_7 alone\.$/u);
});

test("report-mode evidence must prove a scan happened, not that it was clean", () => {
  const evidence = {
    mode: LEGIBILITY_MODE,
    surface: "player",
    sampleCount: 12,
    violations: scanLegibility([sample("slot-2")], { surface: "player" }),
  };
  assert.equal(legibilityEvidenceComplete(evidence, { surface: "player" }), true);
  assert.equal(legibilityEvidenceComplete(evidence, { surface: "admin" }), false);
  assert.equal(legibilityEvidenceComplete({ ...evidence, sampleCount: 0 }), false);
  assert.equal(legibilityEvidenceComplete({ ...evidence, mode: "gate" }), false);
  assert.equal(
    legibilityEvidenceComplete({ ...evidence, violations: [{ rule: "invented", match: "x" }] }),
    false,
  );
  assert.equal(legibilityEvidenceComplete(undefined), false);
});
