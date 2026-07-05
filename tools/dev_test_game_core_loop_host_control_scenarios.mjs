import {
  hostLifecycleRaceScenario,
  hostLifecycleControlScenario,
  hostModkillControlScenario,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

export {
  hostLifecycleRaceScenario,
  hostLifecycleControlScenario,
  hostModkillControlScenario,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

export const coreLoopHostControlFamilyId = "core-loop-host-control";

export const coreLoopHostControlLaneIds = Object.freeze([
  "host-lifecycle-control",
  "host-modkill-control",
  "concurrent-host-lifecycle-race",
  "concurrent-host-lifecycle-race-reload",
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
      hostModkillControl: hostModkillControlScenario(),
      hostLifecycleRace: hostLifecycleRaceScenario(),
    },
    proofRunLanes: {
      hostLifecycleControl: "host-lifecycle-control",
      hostModkillControl: "host-modkill-control",
      hostLifecycleRace: "concurrent-host-lifecycle-race",
      hostLifecycleRaceReload: "concurrent-host-lifecycle-race-reload",
    },
  };
}
