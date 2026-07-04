import {
  hostLifecycleControlScenario,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

export {
  hostLifecycleControlScenario,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

export const coreLoopHostControlFamilyId = "core-loop-host-control";

export const coreLoopHostControlLaneIds = Object.freeze([
  "host-lifecycle-control",
  "host-modkill-control",
]);

export function hostPhaseControlFeatureSpineRow({ cycleId }) {
  return {
    targetKey: "hostPhaseControl",
    featureSlotId: "host-phase-control",
    cycleId,
    role: "host",
    checkpointId: `${cycleId}-d02-vote-open`,
    adminCheckId: "host-lifecycle-control",
  };
}

export function coreLoopHostControlScenarioFamily() {
  return {
    id: coreLoopHostControlFamilyId,
    laneIds: [...coreLoopHostControlLaneIds],
    surfaces: {
      hostLifecycleControl: hostLifecycleControlScenario(),
    },
    proofRunLanes: {
      hostLifecycleControl: "host-lifecycle-control",
      hostModkillControl: "host-modkill-control",
    },
  };
}
