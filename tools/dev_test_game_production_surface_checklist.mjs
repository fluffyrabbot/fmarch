import {
  adminProofDestinationRequirementForLink,
} from "./dev_test_game_proof_graph_handoff_cases.mjs";
import {
  releaseReadinessBuildableItemForId,
  releaseReadinessBuildableItemIds,
  releaseReadinessUnprovenItem,
} from "./dev_test_game_release_readiness_cases.mjs";
import {
  validFeatureSpineDeclaration,
} from "./dev_test_game_feature_spine_targets.mjs";

export function productionFacingSurfaceChecklistItems() {
  return releaseReadinessBuildableItemIds.map((unprovenId) => {
    const buildable = releaseReadinessBuildableItemForId(unprovenId);
    const destination = adminProofDestinationRequirementForLink(
      buildable?.proofGraphNodeId,
    );
    return {
      unprovenId,
      command: buildable?.command ?? "",
      proofTarget: buildable?.proofTarget ?? "",
      roleUrl: buildable?.roleUrl ?? "",
      proofGraphNodeId: buildable?.proofGraphNodeId ?? "",
      adminAuditId: destination?.auditId ?? "",
      productionFeatureSpineTarget:
        buildable?.productionFeatureSpineTarget ?? null,
      proofBoundary: buildable?.proofBoundary ?? "",
      releaseReadinessRequiredEvidence:
        releaseReadinessUnprovenItem(unprovenId).requiredEvidence,
    };
  });
}

export function assertProductionFacingSurfaceChecklist(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("production-facing surface checklist is empty");
  }
  const ids = new Set();
  for (const item of items) {
    assertChecklistItemShape(item);
    if (ids.has(item.unprovenId)) {
      throw new Error(
        `production-facing surface checklist duplicate item: ${item.unprovenId}`,
      );
    }
    ids.add(item.unprovenId);
  }
  return items;
}

export function assertProductionFacingSurfaceGraphCoverage({
  checklist = productionFacingSurfaceChecklistItems(),
  proofGraph,
} = {}) {
  assertProductionFacingSurfaceChecklist(checklist);
  const graphNodeIds = new Set(
    Array.isArray(proofGraph?.nodes)
      ? proofGraph.nodes
          .map((node) => String(node?.id ?? ""))
          .filter((id) => id !== "")
      : [],
  );
  for (const item of checklist) {
    if (!graphNodeIds.has(item.proofGraphNodeId)) {
      throw new Error(
        `production-facing surface missing proof graph node: ${item.proofGraphNodeId}`,
      );
    }
    const featureSlotId = item.productionFeatureSpineTarget.featureSlotId;
    const featureNodeId = `production-feature:${featureSlotId}`;
    if (!graphNodeIds.has(featureNodeId)) {
      throw new Error(
        `production-facing surface missing production feature graph node: ${featureNodeId}`,
      );
    }
  }
  return true;
}

function assertChecklistItemShape(item) {
  const id = String(item?.unprovenId ?? "");
  if (id === "") {
    throw new Error("production-facing surface checklist item is missing an id");
  }
  if (
    typeof item.command !== "string" ||
    !item.command.startsWith("npm run test:")
  ) {
    throw new Error(`production-facing surface ${id} is missing a proof command`);
  }
  if (typeof item.proofTarget !== "string" || item.proofTarget.trim() === "") {
    throw new Error(`production-facing surface ${id} is missing a proof target`);
  }
  if (
    typeof item.roleUrl !== "string" ||
    !item.roleUrl.includes("/admin/audit/") ||
    !item.roleUrl.includes("?game=<seeded-game>")
  ) {
    throw new Error(`production-facing surface ${id} is missing a seeded role URL`);
  }
  const destination = adminProofDestinationRequirementForLink(item.proofGraphNodeId);
  if (destination === undefined) {
    throw new Error(
      `production-facing surface ${id} is missing an admin proof destination`,
    );
  }
  if (!item.roleUrl.includes(`/admin/audit/${destination.auditId}`)) {
    throw new Error(
      `production-facing surface ${id} role URL does not match its audit destination`,
    );
  }
  if (item.adminAuditId !== destination.auditId) {
    throw new Error(
      `production-facing surface ${id} admin audit id drifted from handoff catalog`,
    );
  }
  if (!validFeatureSpineTarget(item.productionFeatureSpineTarget)) {
    throw new Error(
      `production-facing surface ${id} is missing a seeded spine target`,
    );
  }
  if (
    typeof item.proofBoundary !== "string" ||
    !(
      item.proofBoundary.includes("does not") ||
      item.proofBoundary.includes("Passing requires")
    )
  ) {
    throw new Error(
      `production-facing surface ${id} is missing a truthful proof boundary`,
    );
  }
  if (
    typeof item.releaseReadinessRequiredEvidence !== "string" ||
    item.releaseReadinessRequiredEvidence.trim() === ""
  ) {
    throw new Error(
      `production-facing surface ${id} is missing readiness evidence text`,
    );
  }
}

function validFeatureSpineTarget(target) {
  return validFeatureSpineDeclaration(target);
}
