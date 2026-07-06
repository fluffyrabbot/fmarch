import {
  devTestGameHardeningAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  completedGameHardeningSpineCycleId,
  completedGameStaleRecoverySpineLaneCase,
} from "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs";
import {
  replacementStaleConflictMessageSpineLaneCase,
} from "./dev_test_game_stale_conflict_scenarios.mjs";
import {
  hostStaleResolveReconnectLaneId,
  privateChannelStaleActionReconnectLaneId,
  stalePlayerActionReconnectLaneId,
} from "./dev_test_game_stale_client_reconnect_scenarios.mjs";

export const hardeningFeatureSpineSourceCheckId = "local-hardening-proof";
export const hardeningFeatureSpineCycleIds = Object.freeze({
  staleConflict: "hardening-stale-conflict",
  reconnectRecovery: "hardening-reconnect-recovery",
});
const completedGameStaleRecoverySpineLane =
  completedGameStaleRecoverySpineLaneCase();
const replacementStaleConflictMessageSpineLane =
  replacementStaleConflictMessageSpineLaneCase();
export const hardeningFeatureSpineTargetRows = Object.freeze({
  completedGameStaleRecovery: Object.freeze({
    featureSlotId: "completed-game-stale-recovery",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: completedGameHardeningSpineCycleId,
    roleUrlId: completedGameStaleRecoverySpineLane.id,
    checkpointId: completedGameStaleRecoverySpineLane.id,
    adminCheckId: completedGameStaleRecoverySpineLane.id,
  }),
  replacementStaleConflictMessage: Object.freeze({
    featureSlotId: "replacement-stale-conflict-message",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.staleConflict,
    roleUrlId: replacementStaleConflictMessageSpineLane.laneId,
    checkpointId: replacementStaleConflictMessageSpineLane.laneId,
    adminCheckId: replacementStaleConflictMessageSpineLane.laneId,
  }),
  staleActionReconnectRecovery: Object.freeze({
    featureSlotId: "stale-action-reconnect-recovery",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.reconnectRecovery,
    roleUrlId: stalePlayerActionReconnectLaneId,
    checkpointId: stalePlayerActionReconnectLaneId,
    adminCheckId: stalePlayerActionReconnectLaneId,
  }),
  privateChannelStaleActionReconnectRecovery: Object.freeze({
    featureSlotId: "private-channel-stale-action-reconnect-recovery",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.reconnectRecovery,
    roleUrlId: privateChannelStaleActionReconnectLaneId,
    checkpointId: privateChannelStaleActionReconnectLaneId,
    adminCheckId: privateChannelStaleActionReconnectLaneId,
  }),
  hostStaleResolveReconnectRecovery: Object.freeze({
    featureSlotId: "host-stale-resolve-reconnect-recovery",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.reconnectRecovery,
    roleUrlId: hostStaleResolveReconnectLaneId,
    checkpointId: hostStaleResolveReconnectLaneId,
    adminCheckId: hostStaleResolveReconnectLaneId,
  }),
});
export const hardeningDirectRoleUrlReconnectFeatureSpineTargetRows =
  Object.freeze([
    hardeningFeatureSpineTargetRows.staleActionReconnectRecovery,
    hardeningFeatureSpineTargetRows.privateChannelStaleActionReconnectRecovery,
  ]);
export const hardeningSynthesizedRoleUrlReconnectFeatureSpineTargetRows =
  Object.freeze([
    Object.freeze({
      row: hardeningFeatureSpineTargetRows.hostStaleResolveReconnectRecovery,
      role: "host",
    }),
  ]);
export const hardeningReconnectFeatureSpineTargetRows = Object.freeze([
  ...hardeningDirectRoleUrlReconnectFeatureSpineTargetRows,
  ...hardeningSynthesizedRoleUrlReconnectFeatureSpineTargetRows.map(
    (entry) => entry.row,
  ),
]);
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
