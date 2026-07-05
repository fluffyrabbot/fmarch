import {
  featureSpineDeclarationRowsPresent,
  featureSpineRecoveryHookRowKind,
  featureSpineRowKind,
  validFeatureSpineDeclaration,
} from "./dev_test_game_feature_spine_targets.mjs";
import {
  productionFeatureSourceCoverageDecisionSummaryForCheckId,
} from "./dev_test_game_production_feature_source_registry.mjs";

export function resolveProductionFeatureSpineTarget({
  itemId,
  declaration,
  sourceTargetsByCheckId,
  defaultRerunCommandBySourceCheckId = {},
}) {
  if (!validFeatureSpineDeclaration(declaration)) {
    throw new Error(
      `buildable release-readiness item ${itemId} is missing a production feature spine target`,
    );
  }
  const sourceTarget = sourceTargetsByCheckId?.[declaration.sourceCheckId] ?? null;
  if (sourceTarget === null) {
    throw new Error(
      `buildable release-readiness item ${itemId} has no ${declaration.sourceCheckId} spine target to resolve`,
    );
  }
  if (declaration.sourceCheckId !== sourceTarget.sourceCheckId) {
    throw new Error(
      `buildable release-readiness item ${itemId} production feature spine target drifted`,
    );
  }
  const rowKind = featureSpineRowKind(declaration);
  if (!featureSpineDeclarationRowsPresent({ declaration, sourceTarget })) {
    throw new Error(
      `buildable release-readiness item ${itemId} production feature spine target is not in ${declaration.sourceCheckId}`,
    );
  }
  const roleUrl = sourceTarget.roleUrlHrefs?.[declaration.roleUrlId];
  if (typeof roleUrl !== "string" || roleUrl === "") {
    throw new Error(
      `buildable release-readiness item ${itemId} production feature role URL is missing`,
    );
  }
  return {
    featureSlotId: declaration.featureSlotId,
    sourceCheckId: sourceTarget.sourceCheckId,
    coverageDecision: productionFeatureSourceCoverageDecisionSummaryForCheckId(
      sourceTarget.sourceCheckId,
    ),
    detailRoleUrl: sourceTarget.detailRoleUrl,
    cycleId: declaration.cycleId,
    roleUrlId: declaration.roleUrlId,
    roleUrl,
    rowKind,
    checkpointId: declaration.checkpointId,
    ...(rowKind === featureSpineRecoveryHookRowKind
      ? { recoveryHookId: declaration.recoveryHookId }
      : {}),
    adminCheckId: declaration.adminCheckId,
    browserProofCommand: sourceTarget.browserProofCommand,
    rerunCommand:
      sourceTarget.rerunCommand ??
      defaultRerunCommandBySourceCheckId[sourceTarget.sourceCheckId],
  };
}

export function buildProductionFeatureSpineDrilldown(spineTarget) {
  const rowKind = featureSpineRowKind(spineTarget);
  return {
    featureSlotId: spineTarget.featureSlotId,
    sourceCheckId: spineTarget.sourceCheckId,
    detailRoleUrl: spineTarget.detailRoleUrl,
    cycleRowId: spineTarget.cycleId,
    roleUrlRowId: spineTarget.roleUrlId,
    rowKind,
    checkpointRowId: spineTarget.checkpointId,
    ...(rowKind === featureSpineRecoveryHookRowKind
      ? { recoveryHookRowId: spineTarget.recoveryHookId }
      : {}),
    adminCheckId: spineTarget.adminCheckId,
    roleUrl: spineTarget.roleUrl,
    rerunCommand: spineTarget.rerunCommand,
    browserProofCommand: spineTarget.browserProofCommand,
    coverageDecision: spineTarget.coverageDecision,
  };
}

export function buildProductionFeatureSpineTargetCollection({
  declarations,
  sourceTarget,
  defaultRerunCommandBySourceCheckId = {},
}) {
  const targets = Object.values(declarations)
    .filter((declaration) => declaration.sourceCheckId === sourceTarget.sourceCheckId)
    .map((declaration) =>
      resolveProductionFeatureSpineTarget({
        itemId: declaration.featureSlotId,
        declaration,
        sourceTargetsByCheckId: {
          [sourceTarget.sourceCheckId]: sourceTarget,
        },
        defaultRerunCommandBySourceCheckId,
      }),
    );
  return {
    status: "passed",
    slotIds: targets.map((target) => target.featureSlotId),
    bySlotId: Object.fromEntries(
      targets.map((target) => [target.featureSlotId, target]),
    ),
  };
}

export function validProductionFeatureSpineTarget(
  target,
  { sourceCheckRules = {} } = {},
) {
  const rowKind = featureSpineRowKind(target);
  if (
    target === null ||
    typeof target !== "object" ||
    !validFeatureSpineDeclaration(target) ||
    typeof target.detailRoleUrl !== "string" ||
    typeof target.roleUrl !== "string" ||
    typeof target.browserProofCommand !== "string" ||
    !target.browserProofCommand.includes("test:dev-test-game-core-live") ||
    !validCoverageDecision(target.coverageDecision, target.sourceCheckId)
  ) {
    return false;
  }
  if (
    rowKind === featureSpineRecoveryHookRowKind &&
    (typeof target.recoveryHookId !== "string" ||
      target.recoveryHookId.length === 0)
  ) {
    return false;
  }
  return validProductionFeatureSourceRule(target, sourceCheckRules);
}

export function validProductionFeatureSpineDeclaration(declaration) {
  return validFeatureSpineDeclaration(declaration);
}

export function validProductionFeatureSpineDrilldown(
  drilldown,
  { sourceCheckRules = {} } = {},
) {
  const rowKind = featureSpineRowKind(drilldown);
  if (
    drilldown === null ||
    typeof drilldown !== "object" ||
    typeof drilldown.featureSlotId !== "string" ||
    drilldown.featureSlotId.length === 0 ||
    typeof drilldown.sourceCheckId !== "string" ||
    typeof drilldown.detailRoleUrl !== "string" ||
    typeof drilldown.cycleRowId !== "string" ||
    drilldown.cycleRowId.length === 0 ||
    typeof drilldown.roleUrlRowId !== "string" ||
    drilldown.roleUrlRowId.length === 0 ||
    typeof drilldown.checkpointRowId !== "string" ||
    drilldown.checkpointRowId.length === 0 ||
    (rowKind === featureSpineRecoveryHookRowKind &&
      (typeof drilldown.recoveryHookRowId !== "string" ||
        drilldown.recoveryHookRowId.length === 0)) ||
    typeof drilldown.adminCheckId !== "string" ||
    drilldown.adminCheckId.length === 0 ||
    typeof drilldown.roleUrl !== "string" ||
    typeof drilldown.browserProofCommand !== "string" ||
    !drilldown.browserProofCommand.includes("test:dev-test-game-core-live") ||
    !validCoverageDecision(drilldown.coverageDecision, drilldown.sourceCheckId)
  ) {
    return false;
  }
  return validProductionFeatureSourceRule(drilldown, sourceCheckRules);
}

export function validProductionFeatureSpineTargetCollection(
  productionFeatureTargets,
  { declarations, sourceCheckRules = {} } = {},
) {
  if (
    productionFeatureTargets === null ||
    typeof productionFeatureTargets !== "object" ||
    productionFeatureTargets.status !== "passed" ||
    !Array.isArray(productionFeatureTargets.slotIds) ||
    productionFeatureTargets.slotIds.length !== declarations.length ||
    productionFeatureTargets.bySlotId === null ||
    typeof productionFeatureTargets.bySlotId !== "object"
  ) {
    return false;
  }
  for (const declaration of declarations) {
    const target = productionFeatureTargets.bySlotId[declaration.featureSlotId];
    if (
      !productionFeatureTargets.slotIds.includes(declaration.featureSlotId) ||
      !validProductionFeatureSpineTarget(target, { sourceCheckRules }) ||
      target.featureSlotId !== declaration.featureSlotId ||
      target.sourceCheckId !== declaration.sourceCheckId ||
      target.cycleId !== declaration.cycleId ||
      target.roleUrlId !== declaration.roleUrlId ||
      target.checkpointId !== declaration.checkpointId ||
      target.adminCheckId !== declaration.adminCheckId ||
      featureSpineRowKind(target) !== featureSpineRowKind(declaration) ||
      (featureSpineRowKind(declaration) === featureSpineRecoveryHookRowKind &&
        target.recoveryHookId !== declaration.recoveryHookId)
    ) {
      return false;
    }
  }
  return true;
}

function validProductionFeatureSourceRule(item, sourceCheckRules) {
  const rule = sourceCheckRules[item.sourceCheckId];
  if (rule === undefined) {
    return false;
  }
  return (
    item.detailRoleUrl.includes(rule.detailRoleUrlIncludes) &&
    item.roleUrl.includes(rule.roleUrlIncludes) &&
    (rule.rerunCommand === undefined || item.rerunCommand === rule.rerunCommand)
  );
}

function validCoverageDecision(decision, sourceCheckId) {
  return (
    decision !== null &&
    typeof decision === "object" &&
    JSON.stringify(decision) ===
      JSON.stringify(
        productionFeatureSourceCoverageDecisionSummaryForCheckId(sourceCheckId),
      )
  );
}
