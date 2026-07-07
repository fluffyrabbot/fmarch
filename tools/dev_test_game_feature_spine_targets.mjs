import {
  productionFeatureSourceCheckIds,
} from "./dev_test_game_production_feature_source_registry.mjs";

export const featureSpineCheckpointRowKind = "checkpoint";
export const featureSpineRecoveryHookRowKind = "recovery-hook";
export const featureSpineSourceCheckIds = productionFeatureSourceCheckIds;

export function featureSpineCheckpointTarget({
  featureSlotId,
  sourceCheckId,
  cycleId,
  roleUrlId,
  checkpointId,
  adminCheckId,
  featureTargetKind,
}) {
  return Object.freeze({
    featureSlotId,
    sourceCheckId,
    cycleId,
    roleUrlId,
    rowKind: featureSpineCheckpointRowKind,
    checkpointId,
    adminCheckId,
    ...(featureTargetKind === undefined ? {} : { featureTargetKind }),
  });
}

export function featureSpineRecoveryHookTarget({
  featureSlotId,
  sourceCheckId,
  cycleId,
  roleUrlId,
  checkpointId,
  recoveryHookId,
  adminCheckId,
  featureTargetKind,
}) {
  return Object.freeze({
    featureSlotId,
    sourceCheckId,
    cycleId,
    roleUrlId,
    rowKind: featureSpineRecoveryHookRowKind,
    checkpointId,
    recoveryHookId,
    adminCheckId,
    ...(featureTargetKind === undefined ? {} : { featureTargetKind }),
  });
}

export function featureSpineRowKind(target) {
  return target?.rowKind === featureSpineRecoveryHookRowKind
    ? featureSpineRecoveryHookRowKind
    : featureSpineCheckpointRowKind;
}

export function validFeatureSpineDeclaration(declaration) {
  const rowKind = featureSpineRowKind(declaration);
  return (
    declaration !== null &&
    typeof declaration === "object" &&
    typeof declaration.featureSlotId === "string" &&
    declaration.featureSlotId.length > 0 &&
    featureSpineSourceCheckIds.includes(declaration.sourceCheckId) &&
    typeof declaration.cycleId === "string" &&
    declaration.cycleId.length > 0 &&
    typeof declaration.roleUrlId === "string" &&
    declaration.roleUrlId.length > 0 &&
    typeof declaration.checkpointId === "string" &&
    declaration.checkpointId.length > 0 &&
    (rowKind !== featureSpineRecoveryHookRowKind ||
      (typeof declaration.recoveryHookId === "string" &&
        declaration.recoveryHookId.length > 0)) &&
    typeof declaration.adminCheckId === "string" &&
    declaration.adminCheckId.length > 0
  );
}

export function featureSpineDeclarationRowsPresent({ declaration, sourceTarget }) {
  const rowKind = featureSpineRowKind(declaration);
  return (
    Array.isArray(sourceTarget?.cycleIds) &&
    sourceTarget.cycleIds.includes(declaration.cycleId) &&
    Array.isArray(sourceTarget?.roleUrlIds) &&
    sourceTarget.roleUrlIds.includes(declaration.roleUrlId) &&
    Array.isArray(sourceTarget?.checkpointIds) &&
    sourceTarget.checkpointIds.includes(declaration.checkpointId) &&
    (rowKind !== featureSpineRecoveryHookRowKind ||
      (Array.isArray(sourceTarget?.recoveryHookIds) &&
        sourceTarget.recoveryHookIds.includes(declaration.recoveryHookId))) &&
    Array.isArray(sourceTarget?.visibleAdminCheckIds) &&
    sourceTarget.visibleAdminCheckIds.includes(declaration.adminCheckId)
  );
}

export function featureSpineTargetBySlotId(targets) {
  return Object.freeze(
    Object.fromEntries(
      Object.values(targets).map((target) => [target.featureSlotId, target]),
    ),
  );
}
