import {
  hostAdvanceRaceScenario,
  hostDeadlineAdvanceRaceScenario,
  hostLifecycleRaceScenario,
  hostLifecycleControlScenario,
  hostMixedAdvanceRaceScenario,
  hostModkillControlScenario,
  hostPublishRaceScenario,
  hostResolveRaceScenario,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

export {
  hostAdvanceRaceScenario,
  hostDeadlineAdvanceRaceScenario,
  hostLifecycleRaceScenario,
  hostLifecycleControlScenario,
  hostMixedAdvanceRaceScenario,
  hostModkillControlScenario,
  hostPublishRaceScenario,
  hostResolveRaceScenario,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

export const coreLoopHostControlFamilyId = "core-loop-host-control";

export const coreLoopHostControlLaneIds = Object.freeze([
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
  "concurrent-host-mixed-advance-race",
  "concurrent-host-mixed-advance-race-reload",
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
      hostPublishRace: hostPublishRaceScenario(),
      hostResolveRace: hostResolveRaceScenario(),
      hostAdvanceRace: hostAdvanceRaceScenario(),
      hostDeadlineAdvanceRace: hostDeadlineAdvanceRaceScenario(),
      hostMixedAdvanceRace: hostMixedAdvanceRaceScenario(),
    },
    proofRunLanes: {
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
      hostMixedAdvanceRace: "concurrent-host-mixed-advance-race",
      hostMixedAdvanceRaceReload: "concurrent-host-mixed-advance-race-reload",
    },
  };
}
