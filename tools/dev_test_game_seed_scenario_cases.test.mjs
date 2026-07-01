import assert from "node:assert/strict";
import { test } from "node:test";
import {
  seedDemoScenarioCatalog,
  seedDemoScenarioFixtureRows,
  seedDemoScenarioIds,
  seedDemoOnlyScenarioIds,
  seedDemoScenarioProofLaneCandidates,
  seedRequiredScenarioIds,
  seedScenarioCoverageGroups,
} from "./dev_test_game_seed_scenario_cases.mjs";

test("seed scenario cases expose one full shared required inventory", () => {
  assert.equal(seedRequiredScenarioIds.length, 82);
  assert.equal(new Set(seedRequiredScenarioIds).size, seedRequiredScenarioIds.length);
  assert.deepEqual(seedRequiredScenarioIds.slice(0, 8), [
    "host-phase-controls",
    "cohost-deadline-control",
    "player-vote-recovery",
    "player-action-denied",
    "invalid-action-recovery",
    "resolution-receipt",
    "dead-player-recovery",
    "night-action-loop",
  ]);
  assert.deepEqual(seedRequiredScenarioIds.slice(-4), [
    "private-channel-member",
    "private-channel-denied",
    "multiplayer-hardening",
    "local-ops-readiness",
  ]);
});

test("seed scenario cases include reload and stale-reject proof rows", () => {
  for (const scenarioId of [
    "concurrent-player-vote-resolve-race-reload",
    "stale-host-resolve-reload",
    "stale-host-complete-reload",
    "stale-player-complete-reload",
    "replacement-stale-conflict-message",
    "stale-action-conflict-message",
    "stale-dead-action-conflict",
  ]) {
    assert.ok(
      seedRequiredScenarioIds.includes(scenarioId),
      `missing shared seed scenario: ${scenarioId}`,
    );
  }
});

test("seed scenario cases expose generated demo scenario fixture rows", () => {
  assert.equal(seedDemoScenarioIds.length, 90);
  assert.deepEqual(seedDemoOnlyScenarioIds, [
    "day-vote-resolution",
    "day-vote-no-lynch",
    "host-deadline-advance",
    "stale-deadline-advance",
    "private-channel",
    "resolution-receipts",
    "player-action-boundary",
    "concurrent-vote-race-reload",
  ]);
  assert.deepEqual(seedScenarioCoverageGroups.required, seedRequiredScenarioIds);
  assert.deepEqual(seedScenarioCoverageGroups.demoOnly, seedDemoOnlyScenarioIds);
  assert.deepEqual(seedScenarioCoverageGroups.allDemo, seedDemoScenarioIds);
  assert.equal(new Set(seedDemoScenarioIds).size, seedDemoScenarioIds.length);
  assert.deepEqual(seedDemoScenarioIds.slice(0, 6), [
    "host-phase-controls",
    "cohost-deadline-control",
    "player-vote-recovery",
    "day-vote-resolution",
    "day-vote-no-lynch",
    "host-deadline-advance",
  ]);
  assert.deepEqual(seedDemoScenarioIds.slice(6, 9), [
    "stale-deadline-advance",
    "private-channel",
    "resolution-receipts",
  ]);
  assert.deepEqual(seedDemoScenarioIds.slice(9, 12), [
    "player-action-boundary",
    "player-action-denied",
    "invalid-action-recovery",
  ]);
  assert.equal(
    seedDemoScenarioIds.includes("concurrent-vote-race-reload"),
    true,
  );
  assert.deepEqual(
    seedDemoScenarioFixtureRows().map((scenario) => scenario.status),
    Array.from({ length: seedDemoScenarioIds.length }, () => "available_locally"),
  );
});

test("seed scenario cases expose production fixture metadata", () => {
  const scenarios = seedDemoScenarioCatalog({
    provenByForId: seedDemoScenarioProofLaneCandidates,
    roleUrlForRole: (role) => `/redacted/${role}`,
  });
  assert.equal(scenarios.length, seedDemoScenarioIds.length);
  assert.deepEqual(
    scenarios.map((scenario) => scenario.id),
    seedDemoScenarioIds,
  );
  assert.deepEqual(
    scenarios
      .filter((scenario) =>
        [
          "day-vote-resolution",
          "private-channel",
          "resolution-receipts",
          "player-action-boundary",
          "player-action-denied",
          "stale-deadline-advance",
          "replacement-idempotent-retry",
          "stale-dead-action-conflict",
        ].includes(scenario.id),
      )
      .map((scenario) => [scenario.id, scenario.role, scenario.roleUrlRedacted]),
    [
      ["day-vote-resolution", "actionPlayer", "/redacted/actionPlayer"],
      ["stale-deadline-advance", "host", "/redacted/host"],
      ["private-channel", "player", "/redacted/player"],
      ["resolution-receipts", "deniedPlayer", "/redacted/deniedPlayer"],
      ["player-action-boundary", "player", "/redacted/player"],
      ["player-action-denied", "player", "/redacted/player"],
      ["replacement-idempotent-retry", "host", "/redacted/host"],
      ["stale-dead-action-conflict", "actionPlayer", "/redacted/actionPlayer"],
    ],
  );
  assert.deepEqual(seedDemoScenarioProofLaneCandidates("host-phase-controls"), [
    "browser-entry",
    "core-loop",
  ]);
  assert.deepEqual(seedDemoScenarioProofLaneCandidates("concurrent-action-race"), [
    "concurrent-action-race",
  ]);
});
