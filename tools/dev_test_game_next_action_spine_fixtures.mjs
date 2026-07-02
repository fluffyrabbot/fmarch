import {
  releaseReadinessProductionFeatureSpineTargetsBySlotId,
} from "./dev_test_game_release_readiness_cases.mjs";

export const invalidActionRecoveryHostedConcurrentRaceMatrixUnprovenText =
  "Hosted or hosted-like concurrent command race matrix beyond the promoted local replacement, host, player, cohost deadline, lifecycle, and complete-game reload milestones, including multi-session reload/reconnect recovery and stale-client conflict evidence";

export const invalidActionRecoveryHostedConcurrentRaceMatrixBuildSlice =
  "Create the first hosted-like concurrent race matrix proof request from the promoted local race baseline.";

export const invalidActionRecoveryHostedConcurrentRaceMatrixRoleUrl =
  "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>";

export const invalidActionRecoveryHostedConcurrentRaceMatrixProofGraphNodeId =
  "admin-proof:hosted-concurrent-race-matrix";

export function featureSpineFixture({
  slotId = "player-action-submission",
  detailRoleUrl = "/admin/audit/local-core-loop?game=<seeded-game>",
  roleUrl,
  browserProofCommand,
  rerunCommand = "npm run test:dev-test-game-core-loop-admin-proof",
  includeTargetRerunCommand = false,
  includeEmptyRecoveryHook = false,
}) {
  const declaredTarget =
    releaseReadinessProductionFeatureSpineTargetsBySlotId[slotId];
  if (declaredTarget === undefined) {
    throw new Error(`Unknown production feature spine target slot: ${slotId}`);
  }
  const declaration = { ...declaredTarget };
  const recoveryHookId =
    declaration.recoveryHookId ??
    (includeEmptyRecoveryHook ? "" : undefined);
  const productionFeatureSpineTarget = {
    ...declaration,
    ...(recoveryHookId === undefined ? {} : { recoveryHookId }),
  };
  const spineTarget = {
    sourceCheckId: declaration.sourceCheckId,
    featureSlotId: declaration.featureSlotId,
    detailRoleUrl,
    cycleId: declaration.cycleId,
    roleUrlId: declaration.roleUrlId,
    roleUrl,
    rowKind: declaration.rowKind,
    checkpointId: declaration.checkpointId,
    ...(recoveryHookId === undefined ? {} : { recoveryHookId }),
    adminCheckId: declaration.adminCheckId,
    browserProofCommand,
    ...(includeTargetRerunCommand ? { rerunCommand } : {}),
  };
  return {
    productionFeatureSpineTarget,
    spineTarget,
    spineDrilldown: {
      featureSlotId: declaration.featureSlotId,
      sourceCheckId: declaration.sourceCheckId,
      detailRoleUrl,
      cycleRowId: declaration.cycleId,
      roleUrlRowId: declaration.roleUrlId,
      rowKind: declaration.rowKind,
      checkpointRowId: declaration.checkpointId,
      ...(recoveryHookId === undefined
        ? {}
        : { recoveryHookRowId: recoveryHookId }),
      adminCheckId: declaration.adminCheckId,
      roleUrl,
      rerunCommand,
      browserProofCommand,
    },
  };
}

export function invalidActionRecoveryFeatureSpineFixture(options) {
  return featureSpineFixture({
    slotId: "invalid-action-recovery",
    ...options,
  });
}

export function invalidActionRecoveryHostedConcurrentRaceMatrixUnprovenFixture({
  proofTarget,
  roleUrl = invalidActionRecoveryHostedConcurrentRaceMatrixRoleUrl,
  proofGraphNodeId =
    invalidActionRecoveryHostedConcurrentRaceMatrixProofGraphNodeId,
  detailRoleUrl,
  spineRoleUrl,
  browserProofCommand,
  rerunCommand,
  includeTargetRerunCommand = false,
}) {
  const spine = invalidActionRecoveryFeatureSpineFixture({
    detailRoleUrl,
    roleUrl: spineRoleUrl,
    browserProofCommand,
    rerunCommand,
    includeTargetRerunCommand,
  });
  return {
    id: "hosted-concurrent-race-matrix",
    status: "unproven",
    requiredEvidence: invalidActionRecoveryHostedConcurrentRaceMatrixUnprovenText,
    buildSlice: invalidActionRecoveryHostedConcurrentRaceMatrixBuildSlice,
    proofTarget,
    roleUrl,
    proofGraphNodeId,
    ...spine,
  };
}
