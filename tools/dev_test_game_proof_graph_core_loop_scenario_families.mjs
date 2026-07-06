import {
  coreLoopScenarioFamilyRows,
} from "./dev_test_game_core_loop_generated_from_families.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGameCoreLoopAdminProofCommand,
} from "./dev_test_game_production_feature_source_rules.mjs";
import {
  devTestGameCoreLoopAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";

export function proofGraphCoreLoopScenarioFamilyNodeId(familyId) {
  return `core-loop-family:${String(familyId ?? "")}`;
}

export function proofGraphCoreLoopScenarioFamilyNodes({
  game = "<seeded-game>",
  recoveryCommand = devTestGameCoreLoopAdminProofCommand,
} = {}) {
  return Object.freeze(
    coreLoopScenarioFamilyRows().map((family) =>
      Object.freeze({
        id: proofGraphCoreLoopScenarioFamilyNodeId(family.id),
        label: family.label,
        kind: "core-loop-scenario-family",
        status: "passed",
        artifact: devTestGameCoreLoopAdminProofPath,
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop, { game }),
        proofCommand: recoveryCommand,
        recoveryCommand,
        familyId: family.id,
        laneCount: family.laneIds.length,
        laneIds: family.laneIds,
        surfaceIds: family.surfaces,
        staleRejectIds: family.staleRejects,
        reloadIds: family.reloads,
        scenarioIds: family.scenarios,
        transitionTokenIds: family.transitionTokens,
      }),
    ),
  );
}

export function proofGraphCoreLoopScenarioFamilyEdgeRows({
  nodes = proofGraphCoreLoopScenarioFamilyNodes(),
} = {}) {
  return Object.freeze(
    nodes
      .filter((node) => node.kind === "core-loop-scenario-family")
      .map((node) =>
        Object.freeze([
          "admin-proof:core-loop",
          node.id,
          "contains-scenario-family",
          Object.freeze({
            familyId: node.familyId,
            roleUrl: node.roleUrl,
            command: node.recoveryCommand,
          }),
        ]),
      ),
  );
}

export function proofGraphCoreLoopScenarioFamilyEdges(options = {}) {
  return Object.freeze(
    proofGraphCoreLoopScenarioFamilyEdgeRows(options).map(
      ([from, to, relationship, metadata]) =>
        Object.freeze({ from, to, relationship, ...metadata }),
    ),
  );
}

export function proofGraphCoreLoopScenarioFamilyEdgeRowIds(options = {}) {
  return Object.freeze(
    proofGraphCoreLoopScenarioFamilyEdgeRows(options).map(
      ([from, to, relationship]) => `edge:${from}:${relationship}:${to}`,
    ),
  );
}

export function proofGraphCoreLoopScenarioFamilyDestinations(proofGraph) {
  const nodesByFamilyId = new Map(
    (proofGraph?.nodes ?? [])
      .filter((node) => node.kind === "core-loop-scenario-family")
      .map((node) => [node.familyId, node]),
  );
  return Object.freeze(
    coreLoopScenarioFamilyRows().map((family) => {
      const node = nodesByFamilyId.get(family.id);
      if (node === undefined) {
        throw new Error(
          `proof graph missing core-loop scenario family: ${family.id}`,
        );
      }
      return Object.freeze({
        linkId: node.id,
        auditId: localAdminAuditIds.coreLoop,
        detailRoleUrl: node.roleUrl,
        familyId: family.id,
        requiredScenarioFamilies: Object.freeze([family.id]),
        requiredScenarioFamilyText: Object.freeze({
          [family.id]: proofGraphCoreLoopScenarioFamilyTextTokens(family),
        }),
      });
    }),
  );
}

export function proofGraphCoreLoopScenarioFamilyTextTokens(family) {
  return Object.freeze(
    [
      family.label,
      family.status,
      ...family.laneIds,
      ...family.surfaces,
      ...family.staleRejects,
      ...family.reloads,
      ...family.scenarios,
      ...family.transitionTokens,
    ].filter((token) => String(token ?? "") !== ""),
  );
}
