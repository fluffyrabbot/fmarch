import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coreLoopHostControlFamilyId,
  coreLoopHostControlLaneIds,
  coreLoopHostControlScenarioFamily,
  hostAdvanceRaceScenario,
  hostDeadlineAdvanceRaceScenario,
  hostLifecycleRaceScenario,
  hostLifecycleControlScenario,
  hostModkillControlScenario,
  hostPublishRaceScenario,
  hostResolveRaceScenario,
} from "./dev_test_game_core_loop_host_control_scenarios.mjs";

test("host-control family shares lifecycle role surface and proof-run lane ids", () => {
  assert.equal(coreLoopHostControlFamilyId, "core-loop-host-control");
  assert.deepEqual(coreLoopHostControlLaneIds, [
    "host-lifecycle-control",
    "host-modkill-control",
    "concurrent-host-lifecycle-race",
    "concurrent-host-lifecycle-race-reload",
    "concurrent-host-publish-race",
    "concurrent-host-publish-race-reload",
    "concurrent-host-resolve-race",
    "concurrent-host-resolve-race-reload",
    "concurrent-host-advance-race",
    "concurrent-host-advance-race-reload",
    "concurrent-host-deadline-advance-race",
    "concurrent-host-deadline-advance-race-reload",
  ]);

  const family = coreLoopHostControlScenarioFamily();
  assert.equal(family.id, coreLoopHostControlFamilyId);
  assert.deepEqual(family.laneIds, coreLoopHostControlLaneIds);
  assert.deepEqual(
    family.surfaces.hostLifecycleControl,
    hostLifecycleControlScenario(),
  );
  assert.deepEqual(
    family.surfaces.hostModkillControl,
    hostModkillControlScenario(),
  );
  assert.deepEqual(
    family.surfaces.hostLifecycleRace,
    hostLifecycleRaceScenario(),
  );
  assert.deepEqual(
    family.surfaces.hostPublishRace,
    hostPublishRaceScenario(),
  );
  assert.deepEqual(
    family.surfaces.hostResolveRace,
    hostResolveRaceScenario(),
  );
  assert.deepEqual(
    family.surfaces.hostAdvanceRace,
    hostAdvanceRaceScenario(),
  );
  assert.deepEqual(
    family.surfaces.hostDeadlineAdvanceRace,
    hostDeadlineAdvanceRaceScenario(),
  );
  assert.deepEqual(family.proofRunLanes, {
    hostLifecycleControl: "host-lifecycle-control",
    hostModkillControl: "host-modkill-control",
    hostLifecycleRace: "concurrent-host-lifecycle-race",
    hostLifecycleRaceReload: "concurrent-host-lifecycle-race-reload",
    hostPublishRace: "concurrent-host-publish-race",
    hostPublishRaceReload: "concurrent-host-publish-race-reload",
    hostResolveRace: "concurrent-host-resolve-race",
    hostResolveRaceReload: "concurrent-host-resolve-race-reload",
    hostAdvanceRace: "concurrent-host-advance-race",
    hostAdvanceRaceReload: "concurrent-host-advance-race-reload",
    hostDeadlineAdvanceRace: "concurrent-host-deadline-advance-race",
    hostDeadlineAdvanceRaceReload:
      "concurrent-host-deadline-advance-race-reload",
  });
});
