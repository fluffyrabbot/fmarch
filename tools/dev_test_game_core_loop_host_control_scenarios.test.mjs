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

function hostRoleSurfaceCheckpointFixture() {
  return {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    checkpointTestId: "host-lifecycle-control-checkpoint",
    hostLifecycleControlCheckpoint: {
      proofCheckId: "host-lifecycle-control",
    },
    hostLifecycleControlClickProof: {
      status: "passed",
      commandKind: "LockThread",
      checkpointPhaseStateAfterAck: "locked",
      checkpointDeadlineAffordanceAfterAck: "unlock_thread,advance_phase",
    },
    hostLifecycleUnlockProof: {
      status: "passed",
      commandKind: "UnlockThread",
      checkpointPhaseStateAfterAck: "open",
      checkpointDeadlineAffordanceAfterAck: "resolve_phase,lock_thread",
    },
    hostLifecycleStaleRejectProof: {
      status: "passed",
      commandKind: "LockThread",
      commandStatus: {
        state: "reject",
        error: "PhaseLocked",
      },
      bridgePlan: {
        finalState: "reject",
        projectionRefreshKeys: ["host"],
      },
      checkpointPhaseStateAfterReject: "open",
      checkpointDeadlineAffordanceAfterReject: "resolve_phase,lock_thread",
      recoveryText: "Reject PhaseLocked",
    },
  };
}

function hostPhaseTransitionSurfaceFixture() {
  return {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    transition: "advance_phase:ack:802",
    advanceProof: {
      status: "passed",
      commandKind: "AdvancePhase",
      commandStatus: { state: "ack" },
      commandOutcome: { state: "ack" },
      bridgePlan: { finalState: "ack" },
      checkpointPhaseId: "N02",
      checkpointPhaseState: "open",
      checkpointDeadlineAffordance: "resolve_phase,lock_thread",
    },
  };
}
