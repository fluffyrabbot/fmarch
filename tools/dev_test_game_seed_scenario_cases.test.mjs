import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assertSeedProofLaneCoverage,
  seedAggregateOnlyProofLaneIds,
  seedAliasOnlyProofLaneIds,
  directSeedProofLaneIds,
  seedDemoScenarioClassifiedProofLaneIds,
  seedDemoScenarioCatalog,
  seedDemoScenarioFixtureRows,
  seedDemoScenarioIds,
  seedDemoOnlyScenarioIds,
  seedDemoScenarioProofLaneCandidates,
  seedNonDirectProofLaneIds,
  seedProofLaneCoverageCountSummary,
  seedProofLaneCoverageForPassedLanes,
  seedRequiredScenarioIds,
  seedScenarioCoverageGroups,
  unclassifiedSeedProofLaneIds,
} from "./dev_test_game_seed_scenario_cases.mjs";

test("seed scenario cases expose one full shared required inventory", () => {
  assert.equal(seedRequiredScenarioIds.length, 86);
  assert.equal(new Set(seedRequiredScenarioIds).size, seedRequiredScenarioIds.length);
  assert.deepEqual(seedRequiredScenarioIds.slice(0, 8), [
    "host-phase-controls",
    "host-setup-role",
    "cohost-deadline-control",
    "player-vote-recovery",
    "player-action-denied",
    "invalid-action-recovery",
    "resolution-receipt",
    "dead-player-recovery",
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
  assert.equal(seedDemoScenarioIds.length, 125);
  assert.deepEqual(seedDemoOnlyScenarioIds, [
    "day-vote-resolution",
    "day-vote-no-lynch",
    "host-deadline-advance",
    "stale-deadline-advance",
    "private-channel",
    "private-channel-stale-post-after-transition",
    "private-channel-completed-game-recovery",
    "private-channel-invalid-action-recovery",
    "resolution-receipts",
    "player-action-boundary",
    "host-votecount-publication",
    "concurrent-host-publish-race",
    "concurrent-host-publish-race-reload",
    "host-lifecycle-control",
    "host-modkill-control",
    "stale-host-publish-after-change",
    "stale-host-publish",
    "stale-host-lifecycle",
    "stale-host-lifecycle-reload",
    "stale-host-modkill",
    "stale-host-modkill-reload",
    "stale-host-prompt",
    "stale-host-complete",
    "stale-host-control",
    "stale-host-resolve",
    "stale-host-advance",
    "stale-host-deadline",
    "stale-cohost-deadline",
    "stale-player-vote",
    "stale-player-vote-after-change",
    "stale-player-post-after-phase-closure",
    "stale-player-withdraw-after-change",
    "stale-player-withdraw-after-phase-closure",
    "stale-player-vote-after-phase-closure",
    "stale-player-complete",
    "stale-dead-target-vote",
    "dead-current-vote",
    "concurrent-vote-race",
    "concurrent-vote-race-reload",
  ]);
  assert.deepEqual(seedScenarioCoverageGroups.required, seedRequiredScenarioIds);
  assert.deepEqual(seedScenarioCoverageGroups.demoOnly, seedDemoOnlyScenarioIds);
  assert.deepEqual(seedScenarioCoverageGroups.allDemo, seedDemoScenarioIds);
  assert.deepEqual(seedScenarioCoverageGroups.completedGameRequired, [
    "stale-host-complete-reload",
    "stale-host-complete-reconnect-recovery",
    "concurrent-host-complete-race",
    "concurrent-host-complete-race-reload",
    "concurrent-player-complete-race",
    "public-player-complete-reload",
    "stale-player-complete-reload",
  ]);
  assert.deepEqual(seedScenarioCoverageGroups.completedGameDemoOnly, [
    "stale-host-complete",
    "stale-player-complete",
  ]);
  assert.equal(new Set(seedDemoScenarioIds).size, seedDemoScenarioIds.length);
  assert.deepEqual(seedDemoScenarioIds.slice(0, 6), [
    "host-phase-controls",
    "host-setup-role",
    "cohost-deadline-control",
    "day-vote-resolution",
    "day-vote-no-lynch",
    "host-deadline-advance",
  ]);
  assert.deepEqual(seedDemoScenarioIds.slice(5, 10), [
    "host-deadline-advance",
    "stale-deadline-advance",
    "private-channel",
    "private-channel-stale-post-after-transition",
    "private-channel-completed-game-recovery",
  ]);
  assert.deepEqual(seedDemoScenarioIds.slice(10, 14), [
    "private-channel-invalid-action-recovery",
    "resolution-receipts",
    "player-action-boundary",
    "host-votecount-publication",
  ]);
  assert.deepEqual(seedDemoScenarioIds.slice(14, 17), [
    "concurrent-host-publish-race",
    "concurrent-host-publish-race-reload",
    "host-lifecycle-control",
  ]);
  assert.deepEqual(seedDemoScenarioIds.slice(17, 20), [
    "host-modkill-control",
    "stale-host-publish-after-change",
    "stale-host-publish",
  ]);
  assert.deepEqual(seedDemoScenarioIds.slice(20, 23), [
    "stale-host-lifecycle",
    "stale-host-lifecycle-reload",
    "stale-host-modkill",
  ]);
  assert.deepEqual(seedDemoScenarioIds.slice(23, 26), [
    "stale-host-modkill-reload",
    "stale-host-prompt",
    "stale-host-complete",
  ]);
  assert.deepEqual(seedDemoScenarioIds.slice(26, 29), [
    "stale-host-control",
    "stale-host-resolve",
    "stale-host-advance",
  ]);
  assert.deepEqual(seedDemoScenarioIds.slice(29, 32), [
    "stale-host-deadline",
    "stale-cohost-deadline",
    "stale-player-vote",
  ]);
  assert.deepEqual(seedDemoScenarioIds.slice(32, 35), [
    "stale-player-vote-after-change",
    "stale-player-post-after-phase-closure",
    "stale-player-withdraw-after-change",
  ]);
  assert.deepEqual(seedDemoScenarioIds.slice(35, 38), [
    "player-vote-recovery",
    "player-action-denied",
    "invalid-action-recovery",
  ]);
  assert.deepEqual(seedDemoScenarioIds.slice(43, 45), [
    "stale-player-withdraw-after-phase-closure",
    "stale-player-vote-after-phase-closure",
  ]);
  assert.deepEqual(seedDemoScenarioIds.slice(44, 47), [
    "stale-player-vote-after-phase-closure",
    "stale-player-complete",
    "stale-dead-target-vote",
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
          "private-channel-stale-post-after-transition",
          "private-channel-completed-game-recovery",
          "private-channel-invalid-action-recovery",
          "resolution-receipts",
          "player-action-boundary",
          "host-votecount-publication",
          "concurrent-host-publish-race",
          "concurrent-host-publish-race-reload",
          "host-lifecycle-control",
          "host-modkill-control",
          "stale-host-publish-after-change",
          "stale-host-publish",
          "stale-host-lifecycle",
          "stale-host-lifecycle-reload",
          "stale-host-modkill",
          "stale-host-modkill-reload",
          "stale-host-prompt",
          "stale-host-complete",
          "stale-host-control",
          "stale-host-resolve",
          "stale-host-advance",
          "stale-host-deadline",
          "stale-cohost-deadline",
          "stale-player-vote",
          "stale-player-vote-after-change",
          "stale-player-post-after-phase-closure",
          "stale-player-withdraw-after-change",
          "stale-player-withdraw-after-phase-closure",
          "stale-player-vote-after-phase-closure",
          "stale-player-complete",
          "stale-dead-target-vote",
          "dead-current-vote",
          "concurrent-vote-race",
          "player-action-denied",
          "stale-deadline-advance",
          "replacement-idempotent-retry",
          "private-channel-stale-action-reconnect-recovery",
          "stale-dead-action-conflict",
        ].includes(scenario.id),
      )
      .map((scenario) => [scenario.id, scenario.role, scenario.roleUrlRedacted]),
    [
      ["day-vote-resolution", "actionPlayer", "/redacted/actionPlayer"],
      ["stale-deadline-advance", "host", "/redacted/host"],
      ["private-channel", "player", "/redacted/player"],
      [
        "private-channel-stale-post-after-transition",
        "player",
        "/redacted/player",
      ],
      [
        "private-channel-completed-game-recovery",
        "player",
        "/redacted/player",
      ],
      [
        "private-channel-invalid-action-recovery",
        "actionPlayer",
        "/redacted/actionPlayer",
      ],
      ["resolution-receipts", "deniedPlayer", "/redacted/deniedPlayer"],
      ["player-action-boundary", "player", "/redacted/player"],
      ["host-votecount-publication", "host", "/redacted/host"],
      ["concurrent-host-publish-race", "host", "/redacted/host"],
      ["concurrent-host-publish-race-reload", "host", "/redacted/host"],
      ["host-lifecycle-control", "host", "/redacted/host"],
      ["host-modkill-control", "host", "/redacted/host"],
      ["stale-host-publish-after-change", "host", "/redacted/host"],
      ["stale-host-publish", "host", "/redacted/host"],
      ["stale-host-lifecycle", "host", "/redacted/host"],
      ["stale-host-lifecycle-reload", "host", "/redacted/host"],
      ["stale-host-modkill", "host", "/redacted/host"],
      ["stale-host-modkill-reload", "host", "/redacted/host"],
      ["stale-host-prompt", "host", "/redacted/host"],
      ["stale-host-complete", "host", "/redacted/host"],
      ["stale-host-control", "host", "/redacted/host"],
      ["stale-host-resolve", "host", "/redacted/host"],
      ["stale-host-advance", "host", "/redacted/host"],
      ["stale-host-deadline", "host", "/redacted/host"],
      ["stale-cohost-deadline", "cohost", "/redacted/cohost"],
      ["stale-player-vote", "player", "/redacted/player"],
      ["stale-player-vote-after-change", "player", "/redacted/player"],
      ["stale-player-post-after-phase-closure", "player", "/redacted/player"],
      ["stale-player-withdraw-after-change", "player", "/redacted/player"],
      ["player-action-denied", "player", "/redacted/player"],
      [
        "stale-player-withdraw-after-phase-closure",
        "player",
        "/redacted/player",
      ],
      ["stale-player-vote-after-phase-closure", "player", "/redacted/player"],
      ["stale-player-complete", "player", "/redacted/player"],
      ["stale-dead-target-vote", "player", "/redacted/player"],
      ["dead-current-vote", "player", "/redacted/player"],
      ["concurrent-vote-race", "player", "/redacted/player"],
      ["replacement-idempotent-retry", "host", "/redacted/host"],
      [
        "private-channel-stale-action-reconnect-recovery",
        "actionPlayer",
        "/redacted/actionPlayer",
      ],
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

test("seed scenario cases classify every passed proof lane", () => {
  const proofRun = JSON.parse(
    readFileSync("target/dev-test-game/proof-run.json", "utf8"),
  );
  const passedLaneIds = (proofRun.lanes ?? [])
    .filter((lane) => lane.status === "passed")
    .map((lane) => lane.id);
  const directScenarioIds = new Set(seedScenarioCoverageGroups.allDemo);
  const aliasCoveredLaneIds = new Set(
    seedScenarioCoverageGroups.allDemo.flatMap((id) =>
      seedDemoScenarioProofLaneCandidates(id),
    ),
  );

  const nonDirectPassedLaneIds = passedLaneIds.filter(
    (id) => !directScenarioIds.has(id),
  );
  assert.deepEqual(
    [...nonDirectPassedLaneIds].sort(),
    [...seedNonDirectProofLaneIds].sort(),
  );
  assert.deepEqual(seedAliasOnlyProofLaneIds, [
    "browser-entry",
    "cohost-console",
    "core-loop",
    "action-loop",
    "stale-action-conflict",
  ]);
  assert.deepEqual(seedAggregateOnlyProofLaneIds, [
    "replacement-console",
    "idempotent-retry",
    "reconnect-recovery",
  ]);
  for (const laneId of seedAliasOnlyProofLaneIds) {
    assert.equal(aliasCoveredLaneIds.has(laneId), true);
  }
  for (const laneId of seedAggregateOnlyProofLaneIds) {
    assert.equal(aliasCoveredLaneIds.has(laneId), false);
  }
  assert.deepEqual(
    [...seedDemoScenarioClassifiedProofLaneIds()]
      .filter((id) => seedAggregateOnlyProofLaneIds.includes(id))
      .sort(),
    [...seedAggregateOnlyProofLaneIds].sort(),
  );
  assert.deepEqual(unclassifiedSeedProofLaneIds({ proofLaneIds: passedLaneIds }), []);
  const coverage = seedProofLaneCoverageForPassedLanes(passedLaneIds);
  assert.equal(coverage.status, "passed");
  assert.equal(coverage.passedLaneCount, passedLaneIds.length);
  assert.deepEqual(
    coverage.directSeeded.laneIds,
    passedLaneIds.filter((id) => directSeedProofLaneIds().includes(id)),
  );
  assert.deepEqual(coverage.aliasOnly.laneIds, seedAliasOnlyProofLaneIds);
  assert.deepEqual(coverage.aggregateOnly.laneIds, seedAggregateOnlyProofLaneIds);
  assert.deepEqual(coverage.unclassified.laneIds, []);
  assert.deepEqual(seedProofLaneCoverageCountSummary(coverage), {
    passedLaneCount: passedLaneIds.length,
    directSeededLaneCount: coverage.directSeeded.count,
    aliasOnlyLaneCount: coverage.aliasOnly.count,
    aggregateOnlyLaneCount: coverage.aggregateOnly.count,
    unclassifiedLaneCount: 0,
  });
  assert.deepEqual(assertSeedProofLaneCoverage(coverage), coverage);
  assert.throws(
    () =>
      assertSeedProofLaneCoverage({
        ...coverage,
        passedLaneCount: coverage.passedLaneCount - 1,
        aliasOnly: {
          count: coverage.aliasOnly.count - 1,
          laneIds: coverage.aliasOnly.laneIds.slice(1),
        },
      }),
    /missing aliasOnly lane: browser-entry/,
  );
  assert.throws(
    () =>
      assertSeedProofLaneCoverage({
        ...coverage,
        status: "failed",
        passedLaneCount: coverage.passedLaneCount + 1,
        unclassified: {
          count: 1,
          laneIds: ["new-production-proof-lane"],
        },
      }, { requirePassed: false }),
    /has unclassified lanes: new-production-proof-lane/,
  );
});
