import assert from "node:assert/strict";
import { test } from "node:test";
import {
  seedDemoScenarioFixtureRows,
  seedDemoScenarioIds,
  seedRequiredScenarioIds,
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
  assert.equal(seedDemoScenarioIds.length, 85);
  assert.equal(new Set(seedDemoScenarioIds).size, seedDemoScenarioIds.length);
  assert.deepEqual(seedDemoScenarioIds.slice(0, 6), [
    "host-phase-controls",
    "cohost-deadline-control",
    "player-vote-recovery",
    "day-vote-resolution",
    "day-vote-no-lynch",
    "player-action-denied",
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
