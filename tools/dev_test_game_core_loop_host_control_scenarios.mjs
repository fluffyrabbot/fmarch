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
export const hostLifecycleControlCheckpointId =
  "host-lifecycle-control-checkpoint";
export const hostLifecycleControlLockedCheckpointId =
  "host-lifecycle-control-locked-checkpoint";
export const hostLifecycleControlUnlockedCheckpointId =
  "host-lifecycle-control-unlocked-checkpoint";
export const hostLifecycleControlStaleRejectCheckpointId =
  "host-lifecycle-control-stale-reject-checkpoint";
export const hostPhaseControlFeatureTargetKind = "host-phase-command";
export const hostPhaseLockedRecoveryFeatureTargetKind =
  "host-phase-locked-recovery";
export const hostPhaseUnlockedRecoveryFeatureTargetKind =
  "host-phase-unlocked-recovery";
export const hostPhaseStaleRejectFeatureTargetKind =
  "host-phase-stale-reject";

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
    checkpointId: `${cycleId}-${hostLifecycleControlCheckpointId}`,
    adminCheckId: "host-lifecycle-control",
    featureTargetKind: hostPhaseControlFeatureTargetKind,
  };
}

export function hostPhaseLockedRecoveryFeatureSpineRow({ cycleId }) {
  return {
    targetKey: "hostPhaseLockedRecovery",
    featureSlotId: "host-phase-locked-recovery",
    cycleId,
    role: "host",
    checkpointId: `${cycleId}-${hostLifecycleControlLockedCheckpointId}`,
    adminCheckId: "host-lifecycle-control",
    featureTargetKind: hostPhaseLockedRecoveryFeatureTargetKind,
  };
}

export function hostPhaseUnlockedRecoveryFeatureSpineRow({ cycleId }) {
  return {
    targetKey: "hostPhaseUnlockedRecovery",
    featureSlotId: "host-phase-unlocked-recovery",
    cycleId,
    role: "host",
    checkpointId: `${cycleId}-${hostLifecycleControlUnlockedCheckpointId}`,
    adminCheckId: "host-lifecycle-control",
    featureTargetKind: hostPhaseUnlockedRecoveryFeatureTargetKind,
  };
}

export function hostPhaseStaleRejectFeatureSpineRow({ cycleId }) {
  return {
    targetKey: "hostPhaseStaleReject",
    featureSlotId: "host-phase-stale-reject",
    cycleId,
    role: "host",
    checkpointId: `${cycleId}-${hostLifecycleControlStaleRejectCheckpointId}`,
    adminCheckId: "host-lifecycle-control",
    featureTargetKind: hostPhaseStaleRejectFeatureTargetKind,
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
