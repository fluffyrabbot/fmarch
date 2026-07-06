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
const hostStandaloneRaceReloadSpineTargets =
  hostStandaloneRaceReloadSpineTargetCases();
const hostStandaloneRaceReloadHardeningFeatureSpineTargetRows = Object.freeze(
  Object.fromEntries(
    hostStandaloneRaceReloadSpineTargets.map((target) => [
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
const replacementRaceReloadSpineTargets =
  replacementRaceReloadSpineTargetCases();
const replacementRaceReloadHardeningFeatureSpineTargetRows = Object.freeze(
  Object.fromEntries(
    replacementRaceReloadSpineTargets.map((target) => [
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
  ...hostStandaloneRaceReloadHardeningFeatureSpineTargetRows,
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
    ...hostStandaloneRaceReloadSpineTargets.map((target) =>
      Object.freeze({
        row: hardeningFeatureSpineTargetRows[target.targetKey],
        role: target.role,
      }),
    ),
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
