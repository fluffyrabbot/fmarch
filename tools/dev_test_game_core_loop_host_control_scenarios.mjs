import {
  hostAdvancePhaseTransitionCase,
  hostControlRaceScenarioCases,
  hostDeadlineAffordanceForPhaseState,
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
export const hostDeadlineControlCheckpointId =
  "host-deadline-control-checkpoint";
export const hostLifecycleControlStaleRejectCheckpointId =
  "host-lifecycle-control-stale-reject-checkpoint";
export const hostPhaseAdvanceTransitionCheckpointId =
  "host-phase-advance-transition-checkpoint";
export const hostPhaseControlFeatureTargetKind = "host-phase-command";
export const hostPhaseLockedRecoveryFeatureTargetKind =
  "host-phase-locked-recovery";
export const hostPhaseUnlockedRecoveryFeatureTargetKind =
  "host-phase-unlocked-recovery";
export const hostDeadlineControlFeatureTargetKind =
  "host-deadline-control";
export const hostPhaseStaleRejectFeatureTargetKind =
  "host-phase-stale-reject";
export const hostPhaseAdvanceTransitionFeatureTargetKind =
  "host-phase-advance-transition";

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

export function hostDeadlineControlFeatureSpineRow({ cycleId }) {
  return {
    targetKey: "hostDeadlineControl",
    featureSlotId: "host-deadline-control",
    cycleId,
    role: "host",
    checkpointId: `${cycleId}-${hostDeadlineControlCheckpointId}`,
    adminCheckId: "host-lifecycle-control",
    featureTargetKind: hostDeadlineControlFeatureTargetKind,
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

export function hostPhaseAdvanceTransitionFeatureSpineRow({ cycleId }) {
  return {
    targetKey: "hostPhaseAdvanceTransition",
    featureSlotId: "host-phase-advance-transition",
    cycleId,
    role: "host",
    checkpointId: `${cycleId}-${hostPhaseAdvanceTransitionCheckpointId}`,
    adminCheckId: "core-loop",
    featureTargetKind: hostPhaseAdvanceTransitionFeatureTargetKind,
  };
}

export function hostControlRoleSurfaceCheckpointRows({
  cycleId,
  hostRoleSurface,
  hostPhaseTransitionSurface,
} = {}) {
  const rows = [];
  if (hostLifecycleControlCheckpointPassed(hostRoleSurface)) {
    rows.push(`${cycleId}-${hostLifecycleControlCheckpointId}`);
  }
  if (hostLifecycleControlLockedCheckpointPassed(hostRoleSurface)) {
    rows.push(`${cycleId}-${hostLifecycleControlLockedCheckpointId}`);
  }
  if (hostLifecycleControlUnlockedCheckpointPassed(hostRoleSurface)) {
    rows.push(`${cycleId}-${hostLifecycleControlUnlockedCheckpointId}`);
  }
  if (hostDeadlineControlCheckpointPassed(hostRoleSurface)) {
    rows.push(`${cycleId}-${hostDeadlineControlCheckpointId}`);
  }
  if (hostLifecycleControlStaleRejectCheckpointPassed(hostRoleSurface)) {
    rows.push(`${cycleId}-${hostLifecycleControlStaleRejectCheckpointId}`);
  }
  if (hostPhaseAdvanceTransitionCheckpointPassed(hostPhaseTransitionSurface)) {
    rows.push(`${cycleId}-${hostPhaseAdvanceTransitionCheckpointId}`);
  }
  return rows;
}

export function hostLifecycleControlCheckpointPassed(surface) {
  const scenario = hostLifecycleControlScenario();
  const checkpoint = surface?.hostLifecycleControlCheckpoint;
  return (
    surface?.status === "passed" &&
    surface.clickedThroughFromRoleUrl === true &&
    surface.checkpointTestId === scenario.checkpointTestId &&
    checkpoint?.proofCheckId === scenario.proofCheckId
  );
}

export function hostLifecycleControlLockedCheckpointPassed(surface) {
  const scenario = hostLifecycleControlScenario();
  const proof = surface?.hostLifecycleControlClickProof;
  return (
    proof?.status === "passed" &&
    proof.commandKind === scenario.commandKind &&
    proof.checkpointPhaseStateAfterAck === scenario.lockedPhaseState &&
    proof.checkpointDeadlineAffordanceAfterAck ===
      scenario.lockedDeadlineAffordance
  );
}

export function hostLifecycleControlUnlockedCheckpointPassed(surface) {
  const scenario = hostLifecycleControlScenario();
  const proof = surface?.hostLifecycleUnlockProof;
  return (
    proof?.status === "passed" &&
    proof.commandKind === scenario.unlockCommandKind &&
    proof.checkpointPhaseStateAfterAck === scenario.openPhaseState &&
    proof.checkpointDeadlineAffordanceAfterAck ===
      scenario.openDeadlineAffordance
  );
}

export function hostDeadlineControlCheckpointPassed(surface) {
  const scenario = hostLifecycleControlScenario();
  const proof = surface?.hostDeadlineControlProof;
  return (
    proof?.status === "passed" &&
    proof.commandKind === scenario.deadlineCommandKind &&
    proof.commandStatus?.state === "ack" &&
    proof.commandOutcome?.state === "ack" &&
    proof.bridgePlan?.finalState === "ack" &&
    proof.command?.phase === scenario.openPhaseId &&
    proof.command?.at === scenario.extendedDeadline &&
    proof.projection?.phase?.deadline === scenario.extendedDeadline &&
    proof.checkpointPhaseStateAfterAck === scenario.openPhaseState &&
    proof.checkpointDeadlineAffordanceAfterAck ===
      scenario.openDeadlineAffordance &&
    proof.checkpointDeadlineAfterAck === scenario.extendedDeadline
  );
}

export function hostLifecycleControlStaleRejectCheckpointPassed(surface) {
  const scenario = hostLifecycleControlScenario();
  const proof = surface?.hostLifecycleStaleRejectProof;
  return (
    proof?.status === "passed" &&
    proof.commandKind === scenario.commandKind &&
    proof.commandStatus?.state === "reject" &&
    proof.commandStatus?.error === "PhaseLocked" &&
    proof.bridgePlan?.finalState === "reject" &&
    proof.bridgePlan?.projectionRefreshKeys?.[0] === "host" &&
    proof.checkpointPhaseStateAfterReject === scenario.openPhaseState &&
    proof.checkpointDeadlineAffordanceAfterReject ===
      scenario.openDeadlineAffordance &&
    String(proof.recoveryText ?? "").includes("Reject PhaseLocked")
  );
}

export function hostPhaseAdvanceTransitionCheckpointPassed(surface) {
  const advanceCase = hostAdvancePhaseTransitionCase({
    streamSeq: 802,
    expectedPhaseId: "N02",
  });
  const proof = surface?.advanceProof;
  return (
    surface?.status === "passed" &&
    surface.clickedThroughFromRoleUrl === true &&
    proof?.status === "passed" &&
    proof.commandKind === advanceCase.commandKind &&
    proof.commandStatus?.state === "ack" &&
    proof.commandOutcome?.state === "ack" &&
    proof.bridgePlan?.finalState === "ack" &&
    proof.checkpointPhaseId === advanceCase.expectedPhaseId &&
    proof.checkpointPhaseState === advanceCase.expectedPhaseState &&
    proof.checkpointDeadlineAffordance ===
      hostDeadlineAffordanceForPhaseState(advanceCase.expectedPhaseState) &&
    String(surface.transition ?? "").includes(
      `${advanceCase.actionId}:ack:${advanceCase.streamSeq}`,
    )
  );
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
