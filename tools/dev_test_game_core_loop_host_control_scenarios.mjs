import {
  hostControlRaceScenarioCases,
  hostLifecycleControlScenario,
  hostModkillControlScenario,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

export {
  hostAdvanceRaceScenario,
  hostControlRaceScenarioCases,
  hostDeadlineAdvanceRaceScenario,
  hostLifecycleRaceScenario,
  hostLifecycleControlScenario,
  hostMixedAdvanceRaceScenario,
  hostModkillControlScenario,
  hostPublishRaceScenario,
  hostResolveRaceScenario,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

export const coreLoopHostControlFamilyId = "core-loop-host-control";
export const hostPhaseControlFeatureTargetKind = "host-phase-command";

export const coreLoopHostControlLaneIds = Object.freeze([
  "host-lifecycle-control",
  "host-modkill-control",
  ...hostControlRaceScenarioCases().flatMap((raceCase) => [
    raceCase.metadata.proofCheckId,
    raceCase.metadata.reloadProofCheckId,
  ]),
]);

export function hostPhaseControlFeatureSpineRow({ cycleId }) {
  return {
    targetKey: "hostPhaseControl",
    featureSlotId: "host-phase-control",
    cycleId,
    role: "host",
    checkpointId: `${cycleId}-d02-vote-open`,
    adminCheckId: "host-lifecycle-control",
    featureTargetKind: hostPhaseControlFeatureTargetKind,
  };
}

export function coreLoopHostControlScenarioFamily() {
  const raceCases = hostControlRaceScenarioCases();
  return {
    id: coreLoopHostControlFamilyId,
    laneIds: [...coreLoopHostControlLaneIds],
    surfaces: {
      hostLifecycleControl: hostLifecycleControlScenario(),
      hostModkillControl: hostModkillControlScenario(),
      ...Object.fromEntries(
        raceCases.map((raceCase) => [raceCase.surfaceKey, raceCase.scenario]),
      ),
    },
    proofRunLanes: {
      hostLifecycleControl: "host-lifecycle-control",
      hostModkillControl: "host-modkill-control",
      ...Object.assign({}, ...raceCases.map((raceCase) => raceCase.laneMap)),
    },
  };
}
