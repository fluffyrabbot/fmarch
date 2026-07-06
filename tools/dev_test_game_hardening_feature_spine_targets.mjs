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
  hostAdvanceRaceScenario,
  hostDeadlineAdvanceRaceScenario,
  hostMixedAdvanceRaceScenario,
  hostResolveRaceScenario,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  cohostHostRaceCoverageCellCases,
  playerHostRaceCoverageCellCases,
} from "./dev_test_game_cross_role_race_scenarios.mjs";
import {
  cohostStaleDeadlineReconnectLaneId,
  hostStaleAdvanceReconnectLaneId,
  hostStaleDeadlineReconnectLaneId,
  hostStaleResolveReconnectLaneId,
  privateChannelStaleActionReconnectLaneId,
  stalePlayerActionReconnectLaneId,
} from "./dev_test_game_stale_client_reconnect_scenarios.mjs";

export const hardeningFeatureSpineSourceCheckId = "local-hardening-proof";
export const hardeningFeatureSpineCycleIds = Object.freeze({
  staleConflict: "hardening-stale-conflict",
  reconnectRecovery: "hardening-reconnect-recovery",
  concurrentRace: "hardening-concurrent-race",
});
const completedGameStaleRecoverySpineLane =
  completedGameStaleRecoverySpineLaneCase();
const replacementStaleConflictMessageSpineLane =
  replacementStaleConflictMessageSpineLaneCase();
const hostResolveRaceSpineLane = hostResolveRaceScenario();
const hostAdvanceRaceSpineLane = hostAdvanceRaceScenario();
const hostDeadlineAdvanceRaceSpineLane = hostDeadlineAdvanceRaceScenario();
const hostMixedAdvanceRaceSpineLane = hostMixedAdvanceRaceScenario();
const crossRoleRaceCellById = new Map(
  [
    ...playerHostRaceCoverageCellCases(),
    ...cohostHostRaceCoverageCellCases(),
  ].map((cell) => [cell.id, cell]),
);
const playerVoteResolveRaceSpineCell = crossRoleRaceCellById.get(
  "player-vote-vs-host-resolve",
);
const playerActionAdvanceRaceSpineCell = crossRoleRaceCellById.get(
  "player-action-vs-host-advance",
);
const cohostDeadlineResolveRaceSpineCell = crossRoleRaceCellById.get(
  "cohost-deadline-vs-host-resolve",
);
export const replacementActionRaceReloadLaneId =
  "concurrent-replacement-action-race-reload";
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
  hostStaleAdvanceReconnectRecovery: Object.freeze({
    featureSlotId: "host-stale-advance-reconnect-recovery",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.reconnectRecovery,
    roleUrlId: hostStaleAdvanceReconnectLaneId,
    checkpointId: hostStaleAdvanceReconnectLaneId,
    adminCheckId: hostStaleAdvanceReconnectLaneId,
  }),
  hostStaleDeadlineReconnectRecovery: Object.freeze({
    featureSlotId: "host-stale-deadline-reconnect-recovery",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.reconnectRecovery,
    roleUrlId: hostStaleDeadlineReconnectLaneId,
    checkpointId: hostStaleDeadlineReconnectLaneId,
    adminCheckId: hostStaleDeadlineReconnectLaneId,
  }),
  cohostStaleDeadlineReconnectRecovery: Object.freeze({
    featureSlotId: "cohost-stale-deadline-reconnect-recovery",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.reconnectRecovery,
    roleUrlId: cohostStaleDeadlineReconnectLaneId,
    checkpointId: cohostStaleDeadlineReconnectLaneId,
    adminCheckId: cohostStaleDeadlineReconnectLaneId,
  }),
  hostConcurrentResolveRaceReload: Object.freeze({
    featureSlotId: "host-concurrent-resolve-race-reload",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.concurrentRace,
    roleUrlId: hostResolveRaceSpineLane.reloadProofCheckId,
    checkpointId: hostResolveRaceSpineLane.reloadProofCheckId,
    adminCheckId: hostResolveRaceSpineLane.reloadProofCheckId,
  }),
  hostConcurrentAdvanceRaceReload: Object.freeze({
    featureSlotId: "host-concurrent-advance-race-reload",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.concurrentRace,
    roleUrlId: hostAdvanceRaceSpineLane.reloadProofCheckId,
    checkpointId: hostAdvanceRaceSpineLane.reloadProofCheckId,
    adminCheckId: hostAdvanceRaceSpineLane.reloadProofCheckId,
  }),
  hostConcurrentDeadlineAdvanceRaceReload: Object.freeze({
    featureSlotId: "host-concurrent-deadline-advance-race-reload",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.concurrentRace,
    roleUrlId: hostDeadlineAdvanceRaceSpineLane.reloadProofCheckId,
    checkpointId: hostDeadlineAdvanceRaceSpineLane.reloadProofCheckId,
    adminCheckId: hostDeadlineAdvanceRaceSpineLane.reloadProofCheckId,
  }),
  hostConcurrentMixedAdvanceRaceReload: Object.freeze({
    featureSlotId: "host-concurrent-mixed-advance-race-reload",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.concurrentRace,
    roleUrlId: hostMixedAdvanceRaceSpineLane.reloadProofCheckId,
    checkpointId: hostMixedAdvanceRaceSpineLane.reloadProofCheckId,
    adminCheckId: hostMixedAdvanceRaceSpineLane.reloadProofCheckId,
  }),
  playerHostVoteResolveRaceReload: Object.freeze({
    featureSlotId: "player-host-vote-resolve-race-reload",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.concurrentRace,
    roleUrlId: playerVoteResolveRaceSpineCell.reloadLaneId,
    checkpointId: playerVoteResolveRaceSpineCell.reloadLaneId,
    adminCheckId: playerVoteResolveRaceSpineCell.reloadLaneId,
  }),
  playerHostActionAdvanceRaceReload: Object.freeze({
    featureSlotId: "player-host-action-advance-race-reload",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.concurrentRace,
    roleUrlId: playerActionAdvanceRaceSpineCell.reloadLaneId,
    checkpointId: playerActionAdvanceRaceSpineCell.reloadLaneId,
    adminCheckId: playerActionAdvanceRaceSpineCell.reloadLaneId,
  }),
  cohostHostDeadlineResolveRaceReload: Object.freeze({
    featureSlotId: "cohost-host-deadline-resolve-race-reload",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.concurrentRace,
    roleUrlId: cohostDeadlineResolveRaceSpineCell.reloadLaneId,
    checkpointId: cohostDeadlineResolveRaceSpineCell.reloadLaneId,
    adminCheckId: cohostDeadlineResolveRaceSpineCell.reloadLaneId,
  }),
  replacementActionRaceReload: Object.freeze({
    featureSlotId: "replacement-action-race-reload",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.concurrentRace,
    roleUrlId: replacementActionRaceReloadLaneId,
    checkpointId: replacementActionRaceReloadLaneId,
    adminCheckId: replacementActionRaceReloadLaneId,
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
    Object.freeze({
      row: hardeningFeatureSpineTargetRows.hostStaleAdvanceReconnectRecovery,
      role: "host",
    }),
    Object.freeze({
      row: hardeningFeatureSpineTargetRows.hostStaleDeadlineReconnectRecovery,
      role: "host",
    }),
    Object.freeze({
      row: hardeningFeatureSpineTargetRows.cohostStaleDeadlineReconnectRecovery,
      role: "host",
    }),
  ]);
export const hardeningReconnectFeatureSpineTargetRows = Object.freeze([
  ...hardeningDirectRoleUrlReconnectFeatureSpineTargetRows,
  ...hardeningSynthesizedRoleUrlReconnectFeatureSpineTargetRows.map(
    (entry) => entry.row,
  ),
]);
export const hardeningSynthesizedRoleUrlConcurrentRaceFeatureSpineTargetRows =
  Object.freeze([
    Object.freeze({
      row: hardeningFeatureSpineTargetRows.hostConcurrentResolveRaceReload,
      role: "host",
    }),
    Object.freeze({
      row: hardeningFeatureSpineTargetRows.hostConcurrentAdvanceRaceReload,
      role: "host",
    }),
    Object.freeze({
      row:
        hardeningFeatureSpineTargetRows
          .hostConcurrentDeadlineAdvanceRaceReload,
      role: "host",
    }),
    Object.freeze({
      row: hardeningFeatureSpineTargetRows.hostConcurrentMixedAdvanceRaceReload,
      role: "host",
    }),
    Object.freeze({
      row: hardeningFeatureSpineTargetRows.playerHostVoteResolveRaceReload,
      role: "host",
    }),
    Object.freeze({
      row: hardeningFeatureSpineTargetRows.playerHostActionAdvanceRaceReload,
      role: "host",
    }),
    Object.freeze({
      row: hardeningFeatureSpineTargetRows.cohostHostDeadlineResolveRaceReload,
      role: "host",
    }),
    Object.freeze({
      row: hardeningFeatureSpineTargetRows.replacementActionRaceReload,
      role: "player",
    }),
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
