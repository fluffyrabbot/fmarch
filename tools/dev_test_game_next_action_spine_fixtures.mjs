import {
  releaseReadinessBuildableItemForId,
  releaseReadinessHostedConcurrentRaceMatrixProofGraphNodeId,
  releaseReadinessHostedConcurrentRaceMatrixRoleUrl,
  releaseReadinessProductionFeatureSpineTargetsBySlotId,
  releaseReadinessUnprovenItem,
} from "./dev_test_game_release_readiness_cases.mjs";

export const invalidActionRecoveryHostedConcurrentRaceMatrixUnprovenText =
  "Hosted or hosted-like concurrent command race matrix beyond the promoted local replacement, host, player, cohost deadline, lifecycle, and complete-game reload milestones, including multi-session reload/reconnect recovery and stale-client conflict evidence";

export const invalidActionRecoveryHostedConcurrentRaceMatrixBuildSlice =
  "Create the first hosted-like concurrent race matrix proof request from the promoted local race baseline.";

export const invalidActionRecoveryHostedConcurrentRaceMatrixRoleUrl =
  releaseReadinessHostedConcurrentRaceMatrixRoleUrl;

export const invalidActionRecoveryHostedConcurrentRaceMatrixProofGraphNodeId =
  releaseReadinessHostedConcurrentRaceMatrixProofGraphNodeId;

export function featureSpineFixture({
  slotId = "player-action-submission",
  detailRoleUrl = "/admin/audit/local-core-loop?game=<seeded-game>",
  roleUrl,
  roleUrlsById,
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
  const resolvedRoleUrl = roleUrl ?? roleUrlsById?.[declaration.roleUrlId];
  if (resolvedRoleUrl === undefined) {
    throw new Error(
      `Missing role URL for production feature spine target slot: ${slotId}`,
    );
  }
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
    roleUrl: resolvedRoleUrl,
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
      roleUrl: resolvedRoleUrl,
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
  return releaseReadinessUnprovenFixture({
    id: "hosted-concurrent-race-matrix",
    requiredEvidence: invalidActionRecoveryHostedConcurrentRaceMatrixUnprovenText,
    buildSlice: invalidActionRecoveryHostedConcurrentRaceMatrixBuildSlice,
    proofTarget,
    roleUrl,
    proofGraphNodeId,
    detailRoleUrl,
    spineRoleUrl,
    browserProofCommand,
    rerunCommand,
    includeTargetRerunCommand,
  });
}

export function hostedEvidenceLaneUnprovenFixture({
  proofTarget,
  roleUrl,
  proofGraphNodeId,
  detailRoleUrl,
  spineRoleUrl,
  roleUrlsById,
  browserProofCommand,
  rerunCommand,
  includeTargetRerunCommand = false,
  requiredEvidence,
  hostedHandoffChecklist,
  hostedTargetPreflight,
  realHostedEvidenceInputs,
} = {}) {
  return releaseReadinessUnprovenFixture({
    id: "hosted-deployment",
    requiredEvidence,
    proofTarget,
    roleUrl,
    proofGraphNodeId,
    detailRoleUrl,
    spineRoleUrl,
    roleUrlsById,
    browserProofCommand,
    rerunCommand,
    includeTargetRerunCommand,
    hostedHandoffChecklist,
    hostedTargetPreflight,
    realHostedEvidenceInputs,
  });
}

export function hostedProductionIdentityUnprovenFixture({
  proofTarget,
  roleUrl,
  proofGraphNodeId,
  detailRoleUrl = "/admin/audit/local-identity-adapter?game=<seeded-game>",
  spineRoleUrl = "/admin/audit/local-identity-adapter?game=<seeded-game>",
  browserProofCommand,
  rerunCommand,
  includeTargetRerunCommand = false,
  requiredEvidence,
  hostedHandoffChecklist,
} = {}) {
  return releaseReadinessUnprovenFixture({
    id: "hosted-production-identity",
    requiredEvidence,
    proofTarget,
    roleUrl,
    proofGraphNodeId,
    detailRoleUrl,
    spineRoleUrl,
    browserProofCommand,
    rerunCommand,
    includeTargetRerunCommand,
    hostedHandoffChecklist,
  });
}

export function releaseReadinessTraceCandidateFixture({
  rank,
  selected,
  priority,
  command,
  actionStatus,
  proofBoundary,
  ...unprovenOptions
}) {
  const buildable = releaseReadinessBuildableItemForId(unprovenOptions.id, {
    hostedTargetPreflight: unprovenOptions.hostedTargetPreflight,
  });
  const unproven = releaseReadinessUnprovenFixture(unprovenOptions);
  return {
    rank,
    id: unproven.id,
    status: unproven.status,
    priority: priority ?? buildable.priority,
    selected,
    command: command ?? buildable.command,
    buildSlice: unproven.buildSlice,
    proofTarget: unproven.proofTarget,
    roleUrl: unproven.roleUrl,
    proofGraphNodeId: unproven.proofGraphNodeId,
    productionFeatureSpineTarget: unproven.productionFeatureSpineTarget,
    spineDrilldown: unproven.spineDrilldown,
    spineTarget: unproven.spineTarget,
    actionStatus: actionStatus ?? actionStatusForBuildable(buildable),
    proofBoundary: proofBoundary ?? buildable.proofBoundary,
    requiredEvidence: unproven.requiredEvidence,
    ...(unproven.hostedEvidenceMode === undefined
      ? {}
      : { hostedEvidenceMode: unproven.hostedEvidenceMode }),
    ...(unproven.realHostedEvidenceStatus === undefined
      ? {}
      : { realHostedEvidenceStatus: unproven.realHostedEvidenceStatus }),
    ...(unproven.realHostedEvidenceInputs === undefined
      ? {}
      : { realHostedEvidenceInputs: unproven.realHostedEvidenceInputs }),
    ...(unproven.hostedHandoffChecklist === undefined
      ? {}
      : { hostedHandoffChecklist: unproven.hostedHandoffChecklist }),
  };
}

export function releaseReadinessUnprovenFixture({
  id,
  requiredEvidence,
  buildSlice,
  proofTarget,
  roleUrl,
  proofGraphNodeId,
  detailRoleUrl,
  spineRoleUrl,
  roleUrlsById,
  browserProofCommand,
  rerunCommand,
  includeTargetRerunCommand = false,
  hostedHandoffChecklist,
  hostedTargetPreflight,
  realHostedEvidenceInputs,
} = {}) {
  const item = releaseReadinessUnprovenItem(id);
  const buildable = releaseReadinessBuildableItemForId(id, {
    hostedTargetPreflight,
  });
  if (buildable === undefined) {
    throw new Error(`release-readiness item is not buildable: ${id}`);
  }
  const identityAdapterSpine =
    buildable.productionFeatureSpineTarget.sourceCheckId ===
    "local-identity-adapter-proof";
  const resolvedDetailRoleUrl =
    detailRoleUrl ??
    (identityAdapterSpine
      ? "/admin/audit/local-identity-adapter?game=<seeded-game>"
      : undefined);
  const resolvedSpineRoleUrl =
    spineRoleUrl ??
    (identityAdapterSpine
      ? "/admin/audit/local-identity-adapter?game=<seeded-game>"
      : undefined);
  const spine = featureSpineFixture({
    slotId: buildable.productionFeatureSpineTarget.featureSlotId,
    detailRoleUrl: resolvedDetailRoleUrl,
    roleUrl: resolvedSpineRoleUrl,
    roleUrlsById,
    browserProofCommand,
    rerunCommand,
    includeTargetRerunCommand,
  });
  const resolvedRealHostedEvidenceInputs =
    realHostedEvidenceInputs ?? buildable.realHostedEvidenceInputs;
  const resolvedHostedHandoffChecklist =
    hostedHandoffChecklist ?? buildable.hostedHandoffChecklist;
  return {
    id: item.id,
    status: "unproven",
    requiredEvidence: requiredEvidence ?? item.requiredEvidence,
    buildSlice: buildSlice ?? buildable.buildSlice,
    proofTarget: proofTarget ?? buildable.proofTarget,
    roleUrl: roleUrl ?? buildable.roleUrl,
    proofGraphNodeId: proofGraphNodeId ?? buildable.proofGraphNodeId,
    ...spine,
    ...(buildable.hostedEvidenceMode === undefined
      ? {}
      : { hostedEvidenceMode: buildable.hostedEvidenceMode }),
    ...(buildable.realHostedEvidenceStatus === undefined
      ? {}
      : { realHostedEvidenceStatus: buildable.realHostedEvidenceStatus }),
    ...(resolvedRealHostedEvidenceInputs === undefined
      ? {}
      : { realHostedEvidenceInputs: resolvedRealHostedEvidenceInputs }),
    ...(resolvedHostedHandoffChecklist === undefined
      ? {}
      : { hostedHandoffChecklist: resolvedHostedHandoffChecklist }),
  };
}

function actionStatusForBuildable(buildable) {
  return buildable?.hostedHandoffChecklist?.status === "blocked" ||
    buildable?.realHostedEvidenceStatus === "unproven"
    ? "blocked"
    : "ready";
}
