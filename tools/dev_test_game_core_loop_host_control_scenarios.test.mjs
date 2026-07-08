import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coreLoopHostControlFamilyId,
  coreLoopHostControlLaneIds,
  coreLoopHostControlScenarioFamily,
  hostControlRaceScenarioCases,
  hostControlRoleSurfaceCheckpointRows,
  hostLifecycleControlCheckpointPassed,
  hostLifecycleControlLockedCheckpointPassed,
  hostLifecycleControlScenario,
  hostLifecycleControlStaleRejectCheckpointPassed,
  hostLifecycleControlUnlockedCheckpointPassed,
  hostModkillControlScenario,
  hostPhaseAdvanceTransitionCheckpointPassed,
} from "./dev_test_game_core_loop_host_control_scenarios.mjs";
import {
  hostPhaseTransitionSurfaceFixture,
  hostRoleSurfaceCheckpointFixture,
} from "./dev_test_game_core_loop_role_surface_test_fixtures.mjs";

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

test("host-control checkpoint rows are scenario-owned", () => {
  const hostRoleSurface = hostRoleSurfaceCheckpointFixture();
  const hostPhaseTransitionSurface = hostPhaseTransitionSurfaceFixture();

  assert.equal(hostLifecycleControlCheckpointPassed(hostRoleSurface), true);
  assert.equal(hostLifecycleControlLockedCheckpointPassed(hostRoleSurface), true);
  assert.equal(
    hostLifecycleControlUnlockedCheckpointPassed(hostRoleSurface),
    true,
  );
  assert.equal(
    hostLifecycleControlStaleRejectCheckpointPassed(hostRoleSurface),
    true,
  );
  assert.equal(
    hostPhaseAdvanceTransitionCheckpointPassed(hostPhaseTransitionSurface),
    true,
  );
  assert.deepEqual(
    hostControlRoleSurfaceCheckpointRows({
      cycleId: "d02-n02",
      hostRoleSurface,
      hostPhaseTransitionSurface,
    }),
    [
      "d02-n02-host-lifecycle-control-checkpoint",
      "d02-n02-host-lifecycle-control-locked-checkpoint",
      "d02-n02-host-lifecycle-control-unlocked-checkpoint",
      "d02-n02-host-lifecycle-control-stale-reject-checkpoint",
      "d02-n02-host-phase-advance-transition-checkpoint",
    ],
  );
  assert.deepEqual(
    hostControlRoleSurfaceCheckpointRows({
      cycleId: "d02-n02",
      hostRoleSurface: {
        ...hostRoleSurface,
        hostLifecycleStaleRejectProof: {
          ...hostRoleSurface.hostLifecycleStaleRejectProof,
          recoveryText: "refresh",
        },
      },
      hostPhaseTransitionSurface: {
        ...hostPhaseTransitionSurface,
        transition: "advance_phase:ack:801",
      },
    }),
    [
      "d02-n02-host-lifecycle-control-checkpoint",
      "d02-n02-host-lifecycle-control-locked-checkpoint",
      "d02-n02-host-lifecycle-control-unlocked-checkpoint",
    ],
  );
});
