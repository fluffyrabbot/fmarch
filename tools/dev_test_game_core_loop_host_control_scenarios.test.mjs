import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coreLoopHostControlFamilyId,
  coreLoopHostControlLaneIds,
  coreLoopHostControlScenarioFamily,
  hostLifecycleRaceScenario,
  hostLifecycleControlScenario,
  hostModkillControlScenario,
} from "./dev_test_game_core_loop_host_control_scenarios.mjs";

test("host-control family shares lifecycle role surface and proof-run lane ids", () => {
  assert.equal(coreLoopHostControlFamilyId, "core-loop-host-control");
  assert.deepEqual(coreLoopHostControlLaneIds, [
    "host-lifecycle-control",
    "host-modkill-control",
    "concurrent-host-lifecycle-race",
    "concurrent-host-lifecycle-race-reload",
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
  assert.deepEqual(family.proofRunLanes, {
    hostLifecycleControl: "host-lifecycle-control",
    hostModkillControl: "host-modkill-control",
    hostLifecycleRace: "concurrent-host-lifecycle-race",
    hostLifecycleRaceReload: "concurrent-host-lifecycle-race-reload",
  });
});
