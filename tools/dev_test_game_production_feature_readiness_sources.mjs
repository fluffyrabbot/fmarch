import {
  featureSpineSourceCheckIds,
} from "./dev_test_game_feature_spine_targets.mjs";

export function productionFeatureSourceTargetsByCheckIdFromReadiness(
  readiness,
  {
    defaultBrowserProofCommand = "",
    defaultRerunCommandBySourceCheckId = {},
  } = {},
) {
  return Object.fromEntries(
    featureSpineSourceCheckIds
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
  if (sourceCheckId === "local-identity-adapter-proof") {
    return identityAdapterSourceTargetFromReadiness(readiness, {
      defaultBrowserProofCommand,
      defaultRerunCommand:
        defaultRerunCommandBySourceCheckId[sourceCheckId] ?? "",
    });
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
  const sourceCheck = readiness?.localDevelopmentSpine?.checks?.find?.(
    (check) => check?.id === "local-identity-adapter-proof",
  );
  const detailRoleUrl = String(
    sourceCheck?.adminRoleSurface?.detailRoleUrl ?? "",
  );
  const visibleAdminCheckIds = [
    ...(sourceCheck?.adminRoleSurface?.visibleChecks ?? []),
  ].map((id) => String(id));
  const sourceTarget = {
    sourceCheckId: "local-identity-adapter-proof",
    detailRoleUrl,
    cycleId: "identity-adapter",
    roleUrlId: "local-identity-adapter",
    roleUrl: detailRoleUrl,
    checkpointId: "account-login",
    browserProofCommand: defaultBrowserProofCommand,
    rerunCommand: defaultRerunCommand,
    cycleIds: ["identity-adapter"],
    roleUrlIds: ["local-identity-adapter"],
    checkpointIds: ["account-login"],
    recoveryHookIds: [],
    visibleAdminCheckIds,
    roleUrlHrefs: {
      "local-identity-adapter": detailRoleUrl,
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
