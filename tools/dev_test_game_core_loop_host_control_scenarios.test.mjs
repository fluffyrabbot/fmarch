import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coreLoopHostControlFamilyId,
  coreLoopHostControlLaneIds,
  coreLoopHostControlScenarioFamily,
  hostControlRaceScenarioCases,
  hostLifecycleControlScenario,
  hostModkillControlScenario,
} from "./dev_test_game_core_loop_host_control_scenarios.mjs";

test("host-control family shares lifecycle role surface and proof-run lane ids", () => {
  const raceCases = hostControlRaceScenarioCases();
  const raceLaneIds = raceCases.flatMap((raceCase) => [
    raceCase.metadata.proofCheckId,
    raceCase.metadata.reloadProofCheckId,
  ]);
  const raceSurfaces = Object.fromEntries(
    raceCases.map((raceCase) => [raceCase.surfaceKey, raceCase.scenario]),
  );
  const raceProofRunLanes = Object.assign(
    {},
    ...raceCases.map((raceCase) => raceCase.laneMap),
  );

  assert.equal(coreLoopHostControlFamilyId, "core-loop-host-control");
  assert.deepEqual(coreLoopHostControlLaneIds, [
    "host-lifecycle-control",
    "host-modkill-control",
    ...raceLaneIds,
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
  assert.deepEqual(family.surfaces, {
    hostLifecycleControl: hostLifecycleControlScenario(),
    hostModkillControl: hostModkillControlScenario(),
    ...raceSurfaces,
  });
  assert.deepEqual(family.proofRunLanes, {
    hostLifecycleControl: "host-lifecycle-control",
    hostModkillControl: "host-modkill-control",
    ...raceProofRunLanes,
  });
});
