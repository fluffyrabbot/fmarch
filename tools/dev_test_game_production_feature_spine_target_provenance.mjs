import {
  coreLoopFeatureSpineTargetProvenanceCases,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  hardeningFeatureSpineTargetProvenanceCases,
} from "./dev_test_game_hardening_feature_spine_targets.mjs";
import {
  identityFeatureSpineTargetProvenanceCases,
} from "./dev_test_game_identity_feature_spine_targets.mjs";
import {
  roleSurfaceFeatureSpineTargetProvenanceCases,
} from "./dev_test_game_role_surface_spine_cases.mjs";

export const allProductionFeatureSpineTargetProvenanceCases = Object.freeze([
  ...identityFeatureSpineTargetProvenanceCases,
  ...roleSurfaceFeatureSpineTargetProvenanceCases,
  ...coreLoopFeatureSpineTargetProvenanceCases,
  ...hardeningFeatureSpineTargetProvenanceCases,
]);

export const productionFeatureSpineTargetProvenanceBySlotId = Object.freeze(
  Object.fromEntries(
    allProductionFeatureSpineTargetProvenanceCases.map((provenanceCase) => [
      provenanceCase.featureSlotId,
      provenanceCase,
    ]),
  ),
);

export function productionFeatureSpineTargetProvenanceCaseForSlotId(slotId) {
  const provenanceCase =
    productionFeatureSpineTargetProvenanceBySlotId[String(slotId ?? "")];
  if (provenanceCase === undefined) {
    throw new Error(`unknown production feature spine target: ${slotId}`);
  }
  return provenanceCase;
}

export function selectedProductionFeatureSpineMatchesProvenance({
  provenanceCase,
  declaration,
  target,
  drilldown,
  graphSelection,
}) {
  if (
    provenanceCase === null ||
    typeof provenanceCase !== "object" ||
    declaration === null ||
    typeof declaration !== "object" ||
    target === null ||
    typeof target !== "object" ||
    drilldown === null ||
    typeof drilldown !== "object"
  ) {
    return false;
  }
  const rowKind =
    provenanceCase.recoveryHookId === undefined ? "checkpoint" : "recovery-hook";
  const baseMatches =
    declaration.featureSlotId === provenanceCase.featureSlotId &&
    declaration.sourceCheckId === provenanceCase.sourceCheckId &&
    declaration.cycleId === provenanceCase.cycleId &&
    declaration.roleUrlId === provenanceCase.roleUrlId &&
    declaration.rowKind === rowKind &&
    declaration.checkpointId === provenanceCase.checkpointId &&
    declaration.adminCheckId === provenanceCase.adminCheckId &&
    declaration.featureTargetKind === provenanceCase.featureTargetKind &&
    target.featureSlotId === provenanceCase.featureSlotId &&
    target.sourceCheckId === provenanceCase.sourceCheckId &&
    target.cycleId === provenanceCase.cycleId &&
    target.roleUrlId === provenanceCase.roleUrlId &&
    target.checkpointId === provenanceCase.checkpointId &&
    target.adminCheckId === provenanceCase.adminCheckId &&
    target.featureTargetKind === provenanceCase.featureTargetKind &&
    target.sourceProofArtifact === provenanceCase.proofArtifact &&
    target.rerunCommand === provenanceCase.rerunCommand &&
    drilldown.featureSlotId === provenanceCase.featureSlotId &&
    drilldown.sourceCheckId === provenanceCase.sourceCheckId &&
    drilldown.cycleRowId === provenanceCase.cycleId &&
    drilldown.roleUrlRowId === provenanceCase.roleUrlId &&
    drilldown.rowKind === rowKind &&
    drilldown.checkpointRowId === provenanceCase.checkpointId &&
    drilldown.adminCheckId === provenanceCase.adminCheckId &&
    drilldown.featureTargetKind === provenanceCase.featureTargetKind &&
    drilldown.sourceProofArtifact === provenanceCase.proofArtifact &&
    drilldown.rerunCommand === provenanceCase.rerunCommand;
  if (!baseMatches) {
    return false;
  }
  if (
    rowKind === "recovery-hook" &&
    (declaration.recoveryHookId !== provenanceCase.recoveryHookId ||
      target.recoveryHookId !== provenanceCase.recoveryHookId ||
      drilldown.recoveryHookRowId !== provenanceCase.recoveryHookId)
  ) {
    return false;
  }
  if (graphSelection === null || graphSelection === undefined) {
    return true;
  }
  return (
    graphSelection.sourceNodeId === provenanceCase.graphSourceNodeId &&
    graphSelection.nodeId ===
      `production-feature:${provenanceCase.featureSlotId}` &&
    graphSelection.featureTargetKind === provenanceCase.featureTargetKind &&
    graphSelection.sourceProofArtifact === provenanceCase.proofArtifact &&
    graphSelection.targetRoleUrlMatchesSelectedSpineTarget === true
  );
}
