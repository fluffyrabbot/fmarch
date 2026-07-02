import {
  productionFeatureReadinessSourceKind,
  productionFeatureSourceCheckIds,
  productionFeatureSourceForCheckId,
} from "./dev_test_game_production_feature_source_registry.mjs";
import {
  identityFeatureSpineSourceCheckId,
  identityFeatureSpineTargetRows,
} from "./dev_test_game_identity_feature_spine_targets.mjs";

export function productionFeatureSourceTargetsByCheckIdFromReadiness(
  readiness,
  {
    defaultBrowserProofCommand = "",
    defaultRerunCommandBySourceCheckId = {},
  } = {},
) {
  return Object.fromEntries(
    productionFeatureSourceCheckIds
      .map((sourceCheckId) => [
        sourceCheckId,
        productionFeatureSourceTargetFromReadiness(readiness, sourceCheckId, {
          defaultBrowserProofCommand,
          defaultRerunCommandBySourceCheckId,
        }),
      ])
      .filter(([, sourceTarget]) => sourceTarget !== null),
  );
}

export function productionFeatureSourceTargetFromReadiness(
  readiness,
  sourceCheckId,
  {
    defaultBrowserProofCommand = "",
    defaultRerunCommandBySourceCheckId = {},
  } = {},
) {
  const source = productionFeatureSourceForCheckId(sourceCheckId);
  if (
    source.readinessSourceKind ===
    productionFeatureReadinessSourceKind.identityAdapter
  ) {
    return identityAdapterSourceTargetFromReadiness(readiness, {
      defaultBrowserProofCommand,
      defaultRerunCommand:
        defaultRerunCommandBySourceCheckId[sourceCheckId] ?? "",
    });
  }
  if (
    source.readinessSourceKind !==
    productionFeatureReadinessSourceKind.spineTargets
  ) {
    return null;
  }
  return spineTargetsSourceTargetFromReadiness(readiness, sourceCheckId);
}

function spineTargetsSourceTargetFromReadiness(readiness, sourceCheckId) {
  const sourceCheck = readiness?.localDevelopmentSpine?.checks?.find?.(
    (check) => check?.id === sourceCheckId,
  );
  const targets = sourceCheck?.spineTargets;
  if (targets === null || typeof targets !== "object") {
    return null;
  }
  const sourceTarget = {
    sourceCheckId,
    detailRoleUrl: String(targets.detailRoleUrl ?? ""),
    cycleId: String(targets.defaultCycleId ?? ""),
    roleUrlId: String(targets.defaultRoleUrlId ?? ""),
    roleUrl: String(targets.defaultRoleUrl ?? ""),
    checkpointId: String(targets.defaultCheckpointId ?? ""),
    browserProofCommand: String(targets.browserProofCommand ?? ""),
    cycleIds: [...(targets.cycleIds ?? [])].map((id) => String(id)),
    roleUrlIds: [...(targets.roleUrlIds ?? [])].map((id) => String(id)),
    checkpointIds: [...(targets.checkpointIds ?? [])].map((id) => String(id)),
    recoveryHookIds: [...(targets.recoveryHookIds ?? [])].map((id) =>
      String(id),
    ),
    visibleAdminCheckIds: [...(targets.visibleAdminCheckIds ?? [])].map((id) =>
      String(id),
    ),
    roleUrlHrefs:
      targets.roleUrlHrefs !== null && typeof targets.roleUrlHrefs === "object"
        ? Object.fromEntries(
            Object.entries(targets.roleUrlHrefs).map(([id, href]) => [
              String(id),
              String(href ?? ""),
            ]),
          )
        : {},
  };
  return validSourceTarget(sourceTarget) ? sourceTarget : null;
}

function identityAdapterSourceTargetFromReadiness(
  readiness,
  { defaultBrowserProofCommand, defaultRerunCommand },
) {
  const identityTarget = identityFeatureSpineTargetRows.identityAdapter;
  const sourceCheck = readiness?.localDevelopmentSpine?.checks?.find?.(
    (check) => check?.id === identityFeatureSpineSourceCheckId,
  );
  const detailRoleUrl = String(
    sourceCheck?.adminRoleSurface?.detailRoleUrl ?? "",
  );
  const visibleAdminCheckIds = [
    ...(sourceCheck?.adminRoleSurface?.visibleChecks ?? []),
  ].map((id) => String(id));
  const sourceTarget = {
    sourceCheckId: identityFeatureSpineSourceCheckId,
    detailRoleUrl,
    cycleId: identityTarget.cycleId,
    roleUrlId: identityTarget.roleUrlId,
    roleUrl: detailRoleUrl,
    checkpointId: identityTarget.checkpointId,
    browserProofCommand: defaultBrowserProofCommand,
    rerunCommand: defaultRerunCommand,
    cycleIds: [identityTarget.cycleId],
    roleUrlIds: [identityTarget.roleUrlId],
    checkpointIds: [identityTarget.checkpointId],
    recoveryHookIds: [],
    visibleAdminCheckIds,
    roleUrlHrefs: {
      [identityTarget.roleUrlId]: detailRoleUrl,
    },
  };
  return validSourceTarget(sourceTarget) && sourceTarget.rerunCommand !== ""
    ? sourceTarget
    : null;
}

function validSourceTarget(sourceTarget) {
  return [
    sourceTarget.sourceCheckId,
    sourceTarget.detailRoleUrl,
    sourceTarget.cycleId,
    sourceTarget.roleUrlId,
    sourceTarget.roleUrl,
    sourceTarget.checkpointId,
    sourceTarget.visibleAdminCheckIds.length > 0 ? "visible-admin-checks" : "",
    sourceTarget.browserProofCommand,
  ].every((value) => value !== "");
}
