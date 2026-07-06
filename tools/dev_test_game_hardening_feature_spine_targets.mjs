import {
  devTestGameHardeningAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  completedGameHardeningSpineTargetCases,
} from "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs";
import {
  replacementStaleConflictMessageSpineLaneCase,
} from "./dev_test_game_stale_conflict_scenarios.mjs";
import {
  crossRoleRaceReloadSpineTargetCases,
} from "./dev_test_game_cross_role_race_scenarios.mjs";
import {
  hostPhaseRaceReloadSpineTargetCases,
  hostStandaloneRaceReloadSpineTargetCases,
} from "./dev_test_game_host_stale_recovery_scenarios.mjs";
import {
  replacementRaceReloadSpineTargetCases,
} from "./dev_test_game_replacement_private_scenario_cases.mjs";
import {
  reconnectHardeningSpineTargetCases,
} from "./dev_test_game_hardening_recovery_scenarios.mjs";

export const hardeningFeatureSpineSourceCheckId = "local-hardening-proof";
export const hardeningFeatureSpineCycleIds = Object.freeze({
  staleConflict: "hardening-stale-conflict",
  reconnectRecovery: "hardening-reconnect-recovery",
  concurrentRace: "hardening-concurrent-race",
});
const completedGameHardeningSpineTargets =
  completedGameHardeningSpineTargetCases();
const completedGameHardeningFeatureSpineTargetRows = Object.freeze(
  Object.fromEntries(
    completedGameHardeningSpineTargets.map((target) => [
      target.targetKey,
      Object.freeze({
        featureSlotId: target.featureSlotId,
        sourceCheckId: hardeningFeatureSpineSourceCheckId,
        cycleId: target.cycleId,
        roleUrlId: target.roleUrlId,
        checkpointId: target.checkpointId,
        adminCheckId: target.adminCheckId,
      }),
    ]),
  ),
);
const replacementStaleConflictMessageSpineLane =
  replacementStaleConflictMessageSpineLaneCase();
const reconnectHardeningSpineTargets = reconnectHardeningSpineTargetCases();
const reconnectHardeningFeatureSpineTargetRows = Object.freeze(
  Object.fromEntries(
    reconnectHardeningSpineTargets.map((target) => [
      target.targetKey,
      Object.freeze({
        featureSlotId: target.featureSlotId,
        sourceCheckId: hardeningFeatureSpineSourceCheckId,
        cycleId: hardeningFeatureSpineCycleIds.reconnectRecovery,
        roleUrlId: target.laneId,
        checkpointId: target.laneId,
        adminCheckId: target.laneId,
      }),
    ]),
  ),
);
const hostPhaseRaceReloadSpineTargets =
  hostPhaseRaceReloadSpineTargetCases();
const hostStandaloneRaceReloadSpineTargets =
  hostStandaloneRaceReloadSpineTargetCases();
const crossRoleRaceReloadSpineTargets =
  crossRoleRaceReloadSpineTargetCases();
const localRaceReloadSpineTargets = Object.freeze([
  ...hostPhaseRaceReloadSpineTargets,
  ...hostStandaloneRaceReloadSpineTargets,
  ...crossRoleRaceReloadSpineTargets,
]);
const localRaceReloadHardeningFeatureSpineTargetRows =
  hardeningConcurrentRaceRowsForTargets(localRaceReloadSpineTargets);
const replacementRaceReloadSpineTargets =
  replacementRaceReloadSpineTargetCases();
const replacementRaceReloadHardeningFeatureSpineTargetRows =
  hardeningConcurrentRaceRowsForTargets(replacementRaceReloadSpineTargets);

function hardeningConcurrentRaceRowsForTargets(targets) {
  return Object.freeze(
    Object.fromEntries(
      targets.map((target) => [
        target.targetKey,
        Object.freeze({
          featureSlotId: target.featureSlotId,
          sourceCheckId: hardeningFeatureSpineSourceCheckId,
          cycleId: hardeningFeatureSpineCycleIds.concurrentRace,
          roleUrlId: target.reloadLaneId,
          checkpointId: target.reloadLaneId,
          adminCheckId: target.reloadLaneId,
        }),
      ]),
    ),
  );
}

export const hardeningFeatureSpineTargetRows = Object.freeze({
  ...completedGameHardeningFeatureSpineTargetRows,
  replacementStaleConflictMessage: Object.freeze({
    featureSlotId: "replacement-stale-conflict-message",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.staleConflict,
    roleUrlId: replacementStaleConflictMessageSpineLane.laneId,
    checkpointId: replacementStaleConflictMessageSpineLane.laneId,
    adminCheckId: replacementStaleConflictMessageSpineLane.laneId,
  }),
  ...reconnectHardeningFeatureSpineTargetRows,
  ...localRaceReloadHardeningFeatureSpineTargetRows,
  ...replacementRaceReloadHardeningFeatureSpineTargetRows,
});
export const hardeningDirectRoleUrlReconnectFeatureSpineTargetRows =
  Object.freeze(
    reconnectHardeningSpineTargets
      .filter((target) => target.roleUrlSource === "direct")
      .map((target) => hardeningFeatureSpineTargetRows[target.targetKey]),
  );
export const hardeningSynthesizedRoleUrlReconnectFeatureSpineTargetRows =
  Object.freeze(
    reconnectHardeningSpineTargets
      .filter((target) => target.roleUrlSource === "synthesized")
      .map((target) =>
        Object.freeze({
          row: hardeningFeatureSpineTargetRows[target.targetKey],
          role: target.role,
          channelId: target.channelId,
        }),
      ),
  );
export const hardeningReconnectFeatureSpineTargetRows = Object.freeze([
  ...hardeningDirectRoleUrlReconnectFeatureSpineTargetRows,
  ...hardeningSynthesizedRoleUrlReconnectFeatureSpineTargetRows.map(
    (entry) => entry.row,
  ),
]);
export const hardeningSynthesizedRoleUrlConcurrentRaceFeatureSpineTargetRows =
  Object.freeze([
    ...localRaceReloadSpineTargets.map((target) =>
      Object.freeze({
        row: hardeningFeatureSpineTargetRows[target.targetKey],
        role: target.role,
      }),
    ),
    ...replacementRaceReloadSpineTargets.map((target) =>
      Object.freeze({
        row: hardeningFeatureSpineTargetRows[target.targetKey],
        role: target.role,
        channelId: target.channelId,
      }),
    ),
  ]);
export const hardeningConcurrentRaceFeatureSpineTargetRows = Object.freeze(
  hardeningSynthesizedRoleUrlConcurrentRaceFeatureSpineTargetRows.map(
    (entry) => entry.row,
  ),
);
export const devTestGameHardeningAdminProofCommand =
  "npm run test:dev-test-game-hardening-admin-proof";
export const hardeningFeatureSpineSource = Object.freeze({
  sourceCheckId: hardeningFeatureSpineSourceCheckId,
  graphSourceNodeId: "admin-proof:hardening",
  readinessSourceKind: "spine-targets",
  coverageDecision: Object.freeze({
    kind: "seeded-role-url-proof",
    proofCommand: devTestGameHardeningAdminProofCommand,
  }),
  detailRoleUrlIncludes: "/admin/audit/local-hardening",
  roleUrlIncludes: "/g/",
  proofArtifact: devTestGameHardeningAdminProofPath,
  rerunCommand: devTestGameHardeningAdminProofCommand,
});
