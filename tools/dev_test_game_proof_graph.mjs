import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameReleaseReadiness,
  validateDevTestGameAdminSpineProof,
  validateDevTestGameAdminSpineTerminalBatches,
} from "./dev_test_game_release_readiness.mjs";
import {
  assertDevTestGameNextAction,
  devTestGameIdentityAdminProofCommand,
  devTestGameLiveProofCommand,
  devTestGameNextActionPath,
  devTestGameReleaseReadinessPath,
  devTestGameSeedFixtureCommand,
  devTestGameSeedFixturePath,
  devTestGameSeedFixtureRoleUrl,
} from "./dev_test_game_next_action.mjs";
import { assertDevTestGameSpineManifest } from "./dev_test_game_spine_manifest.mjs";
import {
  assertProductionFacingSurfaceGraphCoverage,
  productionFacingSurfaceChecklistItems,
} from "./dev_test_game_production_surface_checklist.mjs";
import {
  featureSpineRowKind,
} from "./dev_test_game_feature_spine_targets.mjs";
import {
  hostedIdentityTerminalReceiptArtifactCase,
} from "./dev_test_game_proof_graph_receipt_artifact_rows.mjs";
import {
  proofGraphProductionFeatureDestinationSummary,
} from "./dev_test_game_proof_graph_production_feature_destinations.mjs";
import {
  productionFeatureGraphSourceNodeId as productionFeatureSourceGraphNodeId,
} from "./dev_test_game_production_feature_graph_sources.mjs";
import {
  coreLoopFeatureSpineSourceCheckId,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  coreLoopScenarioFamilyRows,
} from "./dev_test_game_core_loop_generated_from_families.mjs";
import {
  hardeningFeatureSpineSourceCheckId,
} from "./dev_test_game_hardening_feature_spine_targets.mjs";
import {
  identityFeatureSpineSourceCheckId,
} from "./dev_test_game_identity_feature_spine_targets.mjs";
import {
  hostSetupFeatureSpineSourceCheckId,
} from "./dev_test_game_host_setup_feature_spine_targets.mjs";
import {
  productionFeatureRoleSurfaceSourceCheckIds,
  productionFeatureRoleSurfaceSources,
  productionFeatureSourceForCheckId,
} from "./dev_test_game_production_feature_source_registry.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  proofGraphDiagnosticProofEdges,
  proofGraphDiagnosticProofNodes,
} from "./dev_test_game_proof_graph_handoff_cases.mjs";
import {
  assertProofGraphDiagnosticProofSummary,
  buildProofGraphDiagnosticProofSummary,
} from "./dev_test_game_proof_graph_diagnostic_summary.mjs";
import {
  devTestGameCoreLoopAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  assertProofGraphCoversRecoveryReceipt,
  buildRecoveryReceiptGraphEdges,
  buildRecoveryReceiptGraphNode,
  recoveryReceiptGraphDescriptorByReceiptKey,
  recoveryReceiptGraphDescriptors,
  validateRecoveryReceiptArtifact,
} from "./dev_test_game_recovery_receipt_catalog.mjs";
export {
  devTestGameProofGraphAdminProofCommand,
  devTestGameProofGraphAdminProofPath,
  devTestGameProofGraphCommand,
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import { devTestGameProofGraphPath } from "./dev_test_game_proof_graph_paths.mjs";
import {
  adminSpineProofPath as defaultAdminSpineProofPath,
  adminSpineTerminalBatchProofPath as defaultAdminSpineTerminalBatchProofPath,
  spineManifestPath as defaultSpineManifestPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_PROOF_GRAPH_VERSION = 1;

const proofGraphJsonPath = path.join(repoRoot, devTestGameProofGraphPath);

export function buildDevTestGameProofGraph(
  {
    spineManifest,
    adminSpineProof,
    adminSpineTerminalBatches = null,
    privateChannelRecoveryReceipt = null,
    replacementActionRecoveryReceipt = null,
    replacementHandoffRecoveryReceipt = null,
    replacementPrivateRecoveryReceipt = null,
    nextAction = null,
    releaseReadiness,
  },
  {
    generatedAt = new Date().toISOString(),
    spineManifestSource = defaultSpineManifestPath,
    adminSpineProofSource = defaultAdminSpineProofPath,
    adminSpineTerminalBatchesSource = defaultAdminSpineTerminalBatchProofPath,
    privateChannelRecoveryReceiptSource =
      defaultRecoveryReceiptPath("privateChannelRecoveryReceipt"),
    replacementActionRecoveryReceiptSource =
      defaultRecoveryReceiptPath("replacementActionRecoveryReceipt"),
    replacementHandoffRecoveryReceiptSource =
      defaultRecoveryReceiptPath("replacementHandoffRecoveryReceipt"),
    replacementPrivateRecoveryReceiptSource =
      defaultRecoveryReceiptPath("replacementPrivateRecoveryReceipt"),
    nextActionSource = devTestGameNextActionPath,
    releaseReadinessSource = devTestGameReleaseReadinessPath,
  } = {},
) {
  const manifest = assertDevTestGameSpineManifest(spineManifest);
  validateDevTestGameAdminSpineProof(adminSpineProof, {
    path: adminSpineProofSource,
  });
  const nextActionEvidence =
    nextAction === null ? null : assertDevTestGameNextAction(nextAction);
  const adminSpineTerminalBatchEvidence =
    adminSpineTerminalBatches === null
      ? null
      : validateDevTestGameAdminSpineTerminalBatches(adminSpineTerminalBatches, {
          path: adminSpineTerminalBatchesSource,
        });
  const recoveryReceiptEvidenceByKey =
    validateRecoveryReceiptsForProofGraph({
      privateChannelRecoveryReceipt,
      privateChannelRecoveryReceiptSource,
      replacementActionRecoveryReceipt,
      replacementActionRecoveryReceiptSource,
      replacementHandoffRecoveryReceipt,
      replacementHandoffRecoveryReceiptSource,
      replacementPrivateRecoveryReceipt,
      replacementPrivateRecoveryReceiptSource,
    });
  const privateChannelRecoveryReceiptEvidence =
    recoveryReceiptEvidenceByKey.privateChannelRecoveryReceipt;
  const replacementActionRecoveryReceiptEvidence =
    recoveryReceiptEvidenceByKey.replacementActionRecoveryReceipt;
  const replacementHandoffRecoveryReceiptEvidence =
    recoveryReceiptEvidenceByKey.replacementHandoffRecoveryReceipt;
  const replacementPrivateRecoveryReceiptEvidence =
    recoveryReceiptEvidenceByKey.replacementPrivateRecoveryReceipt;
  const releaseReadinessChecklist =
    assertDevTestGameReleaseReadiness(releaseReadiness);
  const adminSpine = adminSpineProof;
  const nodes = buildProofGraphNodes({
    manifest,
    adminSpine,
    adminSpineTerminalBatches: adminSpineTerminalBatchEvidence,
    adminSpineTerminalBatchesSource,
    privateChannelRecoveryReceipt: privateChannelRecoveryReceiptEvidence,
    privateChannelRecoveryReceiptSource,
    replacementActionRecoveryReceipt:
      replacementActionRecoveryReceiptEvidence,
    replacementActionRecoveryReceiptSource,
    replacementHandoffRecoveryReceipt:
      replacementHandoffRecoveryReceiptEvidence,
    replacementHandoffRecoveryReceiptSource,
    replacementPrivateRecoveryReceipt:
      replacementPrivateRecoveryReceiptEvidence,
    replacementPrivateRecoveryReceiptSource,
    releaseReadiness: releaseReadinessChecklist,
    releaseReadinessSource,
  });
  const edges = buildProofGraphEdges({
    nodes,
    nextAction: nextActionEvidence,
    adminSpineTerminalBatches: adminSpineTerminalBatchEvidence,
    privateChannelRecoveryReceipt: privateChannelRecoveryReceiptEvidence,
    replacementActionRecoveryReceipt:
      replacementActionRecoveryReceiptEvidence,
    replacementHandoffRecoveryReceipt:
      replacementHandoffRecoveryReceiptEvidence,
    replacementPrivateRecoveryReceipt:
      replacementPrivateRecoveryReceiptEvidence,
  });
  const evidence = {
    version: DEV_TEST_GAME_PROOF_GRAPH_VERSION,
    proof: "dev-test-game-proof-graph",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-proof-graph",
    proofBoundary:
      "Generated local proof graph for the dev-test-game development spine. It records local audit role URLs, production feature spine target role URLs, artifact paths, proof commands, dependencies, and recovery edges for seeded admin proof surfaces; it does not validate artifact contents, hosted identity, hosted operations, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      spineManifest: spineManifestSource,
      adminSpineProof: adminSpineProofSource,
      ...(adminSpineTerminalBatchEvidence === null
        ? {}
        : { adminSpineTerminalBatches: adminSpineTerminalBatchesSource }),
      ...recoveryReceiptGeneratedFromSources({
        privateChannelRecoveryReceipt: privateChannelRecoveryReceiptEvidence,
        privateChannelRecoveryReceiptSource,
        replacementActionRecoveryReceipt:
          replacementActionRecoveryReceiptEvidence,
        replacementActionRecoveryReceiptSource,
        replacementHandoffRecoveryReceipt:
          replacementHandoffRecoveryReceiptEvidence,
        replacementHandoffRecoveryReceiptSource,
        replacementPrivateRecoveryReceipt:
          replacementPrivateRecoveryReceiptEvidence,
        replacementPrivateRecoveryReceiptSource,
      }),
      ...(nextActionEvidence === null ? {} : { nextAction: nextActionSource }),
      releaseReadiness: releaseReadinessSource,
      manifestGeneratedAt: manifest.generatedAt,
      adminSpineGeneratedAt: adminSpine.generatedAt,
      ...(nextActionEvidence === null
        ? {}
        : { nextActionGeneratedAt: nextActionEvidence.generatedAt }),
      releaseReadinessGeneratedAt: releaseReadinessChecklist.generatedAt,
    },
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      roleUrlCount: nodes.filter((node) => node.roleUrl).length,
      recoveryTargetCount: nodes.filter((node) => node.recoveryCommand).length,
      roleSurfaceProofCount: nodes.filter(
        (node) => node.kind === "role-surface-proof",
      ).length,
      productionFeatureTargetCount: nodes.filter(
        (node) => node.kind === "production-feature-spine-target",
      ).length,
      productionFeatureDestinationSummary:
        proofGraphProductionFeatureDestinationSummary({
          nodes,
        }),
      diagnosticProofSummary: buildProofGraphDiagnosticProofSummary({ nodes }),
      coreLoopScenarioFamilyCount: nodes.filter(
        (node) => node.kind === "core-loop-scenario-family",
      ).length,
      terminalBatchCount: adminSpineTerminalBatchEvidence?.batchCount ?? 0,
      ...recoveryReceiptSummaryLaneCounts({
        privateChannelRecoveryReceipt: privateChannelRecoveryReceiptEvidence,
        replacementActionRecoveryReceipt:
          replacementActionRecoveryReceiptEvidence,
        replacementHandoffRecoveryReceipt:
          replacementHandoffRecoveryReceiptEvidence,
        replacementPrivateRecoveryReceipt:
          replacementPrivateRecoveryReceiptEvidence,
      }),
    },
    nodes,
    edges,
  };
  assertDevTestGameProofGraph(evidence, {
    adminSpineProof: adminSpine,
    releaseReadiness: releaseReadinessChecklist,
  });
  return evidence;
}

export function assertDevTestGameProofGraph(
  evidence,
  { adminSpineProof, releaseReadiness } = {},
) {
  if (evidence?.version !== DEV_TEST_GAME_PROOF_GRAPH_VERSION) {
    throw new Error(`proof graph version drifted: ${evidence?.version}`);
  }
  if (evidence.proof !== "dev-test-game-proof-graph") {
    throw new Error(`unexpected proof graph id: ${evidence.proof}`);
  }
  if (evidence.status !== "passed") {
    throw new Error(`proof graph status is ${evidence.status}`);
  }
  if (evidence.scope !== "local-dev-test-game-proof-graph") {
    throw new Error(`proof graph scope drifted: ${evidence.scope}`);
  }
  if (evidence.releaseReady !== false || evidence.productionReady !== false) {
    throw new Error("proof graph must not claim production or release readiness");
  }
  if (!Array.isArray(evidence.nodes) || evidence.nodes.length < 4) {
    throw new Error("proof graph is missing local proof nodes");
  }
  if (!Array.isArray(evidence.edges) || evidence.edges.length < 3) {
    throw new Error("proof graph is missing local proof edges");
  }
  const nodesById = new Set(evidence.nodes.map((node) => node.id));
  if (nodesById.size !== evidence.nodes.length) {
    throw new Error("proof graph node ids must be unique");
  }
  const productionFeatureTargetNodes = evidence.nodes.filter(
    (node) => node.kind === "production-feature-spine-target",
  );
  if (
    evidence.summary?.productionFeatureTargetCount !==
    productionFeatureTargetNodes.length
  ) {
    throw new Error("proof graph production feature target count drifted");
  }
  for (const node of evidence.nodes) {
    if (typeof node.id !== "string" || node.id.trim() === "") {
      throw new Error("proof graph node is missing an id");
    }
    if (typeof node.artifact !== "string" || node.artifact.trim() === "") {
      throw new Error(`proof graph node ${node.id} is missing an artifact`);
    }
    if (node.roleUrl !== undefined && !seededGraphRoleUrl(node.roleUrl)) {
      throw new Error(`proof graph node ${node.id} role URL is not seeded`);
    }
    if (
      node.kind === "production-feature-spine-target" &&
      (typeof node.targetRoleUrl !== "string" || node.targetRoleUrl.trim() === "")
    ) {
      throw new Error(`proof graph production feature ${node.id} target role URL is missing`);
    }
  }
  for (const edge of evidence.edges) {
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) {
      throw new Error(`proof graph edge has an unknown endpoint: ${edge.from}->${edge.to}`);
    }
    if (edge.roleUrl !== undefined && !seededGraphRoleUrl(edge.roleUrl)) {
      throw new Error(`proof graph edge ${edge.from}->${edge.to} role URL is not seeded`);
    }
  }
  const seedCoverageRecoveryEdge = evidence.edges.find(
    (edge) =>
      edge.from === "next-action" &&
      edge.to === "admin-proof:seed" &&
      edge.relationship === "recovery-target",
  );
  if (seedCoverageRecoveryEdge !== undefined) {
    if (
      seedCoverageRecoveryEdge.reason !== "seed-proof-lane-coverage-drift" ||
      seedCoverageRecoveryEdge.command !== devTestGameSeedFixtureCommand ||
      seedCoverageRecoveryEdge.roleUrl !== devTestGameSeedFixtureRoleUrl ||
      seedCoverageRecoveryEdge.proofTarget !== devTestGameSeedFixturePath ||
      !Array.isArray(seedCoverageRecoveryEdge.unclassifiedLaneIds)
    ) {
      throw new Error("proof graph seed coverage recovery edge is malformed");
    }
  }
  if (adminSpineProof !== undefined) {
    assertDevTestGameProofGraphCoversAdminSpine(evidence, adminSpineProof);
  }
  assertDevTestGameProofGraphCoversTerminalBatches(evidence);
  assertDevTestGameProofGraphCoversDiagnosticProofs(evidence);
  assertDevTestGameProofGraphCoversPrivateChannelRecoveryReceipt(evidence);
  assertDevTestGameProofGraphCoversCoreLoopScenarioFamilies(evidence);
  assertDevTestGameProofGraphCoversReplacementPrivateRecoveryReceipt(evidence);
  assertDevTestGameProofGraphCoversReplacementActionRecoveryReceipt(evidence);
  assertDevTestGameProofGraphCoversReplacementHandoffRecoveryReceipt(evidence);
  if (releaseReadiness !== undefined) {
    assertDevTestGameProofGraphCoversProductionFeatureTargets(
      evidence,
      releaseReadiness,
    );
    assertDevTestGameProofGraphCoversRoleSurfaceProofs(
      evidence,
      releaseReadiness,
    );
  }
  assertProductionFacingSurfaceGraphCoverage({ proofGraph: evidence });
  return evidence;
}

export function assertDevTestGameProofGraphCoversDiagnosticProofs(graph) {
  assertProofGraphDiagnosticProofSummary(graph.summary?.diagnosticProofSummary, {
    nodes: graph.nodes,
  });
  for (const diagnosticNode of proofGraphDiagnosticProofNodes) {
    const node = (graph.nodes ?? []).find(
      (candidate) => candidate.id === diagnosticNode.id,
    );
    if (
      node?.kind !== "diagnostic-browser-proof" ||
      node.status !== "passed" ||
      node.artifact !== diagnosticNode.artifact ||
      node.roleUrl !== diagnosticNode.roleUrl ||
      node.proofCommand !== diagnosticNode.proofCommand ||
      node.recoveryCommand !== diagnosticNode.recoveryCommand ||
      node.diagnostic !== true ||
      node.diagnosticReason !== diagnosticNode.diagnosticReason ||
      node.promotesFreshness !== false ||
      node.terminalArtifact !== false
    ) {
      throw new Error(`proof graph diagnostic node drifted: ${diagnosticNode.id}`);
    }
  }
  for (const diagnosticEdge of proofGraphDiagnosticProofEdges) {
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === diagnosticEdge.from &&
          edge.to === diagnosticEdge.to &&
          edge.relationship === diagnosticEdge.relationship &&
          edge.reason === diagnosticEdge.reason &&
          edge.command === diagnosticEdge.command,
      )
    ) {
      throw new Error(
        `proof graph diagnostic edge missing: ${diagnosticEdge.from}->${diagnosticEdge.to}`,
      );
    }
  }
  return graph;
}

export function assertDevTestGameProofGraphCoversReplacementActionRecoveryReceipt(
  graph,
) {
  return assertProofGraphCoversRecoveryReceipt(
    graph,
    recoveryReceiptGraphDescriptorByReceiptKey(
      "replacementActionRecoveryReceipt",
    ),
  );
}

export function assertDevTestGameProofGraphCoversReplacementHandoffRecoveryReceipt(
  graph,
) {
  return assertProofGraphCoversRecoveryReceipt(
    graph,
    recoveryReceiptGraphDescriptorByReceiptKey(
      "replacementHandoffRecoveryReceipt",
    ),
  );
}

export function assertDevTestGameProofGraphCoversReplacementPrivateRecoveryReceipt(
  graph,
) {
  return assertProofGraphCoversRecoveryReceipt(
    graph,
    recoveryReceiptGraphDescriptorByReceiptKey(
      "replacementPrivateRecoveryReceipt",
    ),
  );
}

export function assertDevTestGameProofGraphCoversPrivateChannelRecoveryReceipt(
  graph,
) {
  return assertProofGraphCoversRecoveryReceipt(
    graph,
    recoveryReceiptGraphDescriptorByReceiptKey("privateChannelRecoveryReceipt"),
  );
}

export function assertDevTestGameProofGraphCoversCoreLoopScenarioFamilies(graph) {
  const familyRows = coreLoopScenarioFamilyRows();
  const nodes = (graph.nodes ?? []).filter(
    (node) => node.kind === "core-loop-scenario-family",
  );
  if (graph.summary?.coreLoopScenarioFamilyCount !== familyRows.length) {
    throw new Error("proof graph core-loop scenario family count drifted");
  }
  if (nodes.length !== familyRows.length) {
    throw new Error(
      `proof graph core-loop scenario family node count drifted: expected ${familyRows.length}, got ${nodes.length}`,
    );
  }
  const nodeByFamilyId = new Map(nodes.map((node) => [node.familyId, node]));
  for (const family of familyRows) {
    const expectedNodeId = coreLoopScenarioFamilyNodeId(family.id);
    const node = nodeByFamilyId.get(family.id);
    if (
      node?.id !== expectedNodeId ||
      node.label !== family.label ||
      node.status !== "passed" ||
      node.artifact !== devTestGameCoreLoopAdminProofPath ||
      node.roleUrl !== localAdminAuditRoleUrl(localAdminAuditIds.coreLoop) ||
      node.recoveryCommand !==
        "npm run test:dev-test-game-core-loop-admin-proof" ||
      node.laneCount !== family.laneIds.length ||
      !sameStringArray(node.laneIds, family.laneIds) ||
      !sameStringArray(node.surfaceIds, family.surfaces) ||
      !sameStringArray(node.staleRejectIds, family.staleRejects) ||
      !sameStringArray(node.reloadIds, family.reloads) ||
      !sameStringArray(node.scenarioIds, family.scenarios) ||
      !sameStringArray(node.transitionTokenIds, family.transitionTokens)
    ) {
      throw new Error(
        `proof graph core-loop scenario family node drifted: ${family.id}`,
      );
    }
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === "admin-proof:core-loop" &&
          edge.to === expectedNodeId &&
          edge.relationship === "contains-scenario-family" &&
          edge.familyId === family.id &&
          edge.roleUrl === localAdminAuditRoleUrl(localAdminAuditIds.coreLoop) &&
          edge.command === "npm run test:dev-test-game-core-loop-admin-proof",
      )
    ) {
      throw new Error(
        `proof graph core-loop scenario family edge missing: ${family.id}`,
      );
    }
  }
  return graph;
}

export function assertDevTestGameProofGraphCoversTerminalBatches(graph) {
  const terminalNode = (graph?.nodes ?? []).find(
    (node) => node.id === "admin-spine-terminal-batches",
  );
  if (graph?.generatedFrom?.adminSpineTerminalBatches === undefined) {
    if (terminalNode !== undefined || graph.summary?.terminalBatchCount !== 0) {
      throw new Error("proof graph terminal batch summary drifted");
    }
    return graph;
  }
  if (
    terminalNode?.kind !== "terminal-proof-batch-receipt" ||
    terminalNode.status !== "passed" ||
    terminalNode.artifact !== graph.generatedFrom.adminSpineTerminalBatches ||
    terminalNode.roleUrl !== localAdminAuditRoleUrl(localAdminAuditIds.adminSpine) ||
    terminalNode.batchCount !== graph.summary?.terminalBatchCount ||
    !Array.isArray(terminalNode.proofIds) ||
    !terminalNode.proofIds.includes("proof-graph") ||
    !terminalNode.proofIds.includes("proof-freshness") ||
    !terminalNode.proofIds.includes("next-action") ||
    !Array.isArray(terminalNode.receiptArtifacts) ||
    !terminalNode.receiptArtifacts.some(
      (artifact) =>
        artifact.proofId === hostedIdentityTerminalReceiptArtifactCase.proofId &&
        artifact.artifactPath ===
          hostedIdentityTerminalReceiptArtifactCase.artifactPath &&
        artifact.batchLabel ===
          hostedIdentityTerminalReceiptArtifactCase.batchLabel,
    )
  ) {
    throw new Error("proof graph terminal batch node drifted");
  }
  for (const target of ["proof-graph", "proof-freshness", "next-action"]) {
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === "admin-spine-terminal-batches" &&
          edge.to === target &&
          edge.relationship === "terminal-browser-proof",
      )
    ) {
      throw new Error(`proof graph terminal batch edge missing: ${target}`);
    }
  }
  return graph;
}

export function assertDevTestGameProofGraphCoversAdminSpine(graph, adminSpineProof) {
  validateDevTestGameAdminSpineProof(adminSpineProof, {
    path: graph?.generatedFrom?.adminSpineProof,
  });
  const recoveryCommands = new Map(
    (adminSpineProof.recovery?.surfaces ?? []).map((surface) => [
      surface.id,
      surface.rerunCommand,
    ]),
  );
  const adminEntries = new Map(
    (adminSpineProof.adminProofs ?? []).map((entry) => [entry.id, entry]),
  );
  const graphAdminNodes = new Map(
    (graph.nodes ?? [])
      .filter((node) => node.kind === "admin-proof-surface")
      .map((node) => [node.surfaceId, node]),
  );
  if (adminEntries.size !== graphAdminNodes.size) {
    throw new Error(
      `proof graph admin surface count drifted: expected ${adminEntries.size}, got ${graphAdminNodes.size}`,
    );
  }
  for (const [id, entry] of adminEntries) {
    const node = graphAdminNodes.get(id);
    if (node === undefined) {
      throw new Error(`proof graph missing admin surface node: ${id}`);
    }
    const expectedNodeId = `admin-proof:${id}`;
    if (node.id !== expectedNodeId) {
      throw new Error(`proof graph admin surface ${id} node id drifted: ${node.id}`);
    }
    if (node.status !== entry.status) {
      throw new Error(`proof graph admin surface ${id} status drifted`);
    }
    if (node.artifact !== entry.path) {
      throw new Error(`proof graph admin surface ${id} artifact drifted`);
    }
    if (node.roleUrl !== entry.detailRoleUrl) {
      throw new Error(`proof graph admin surface ${id} role URL drifted`);
    }
    if (node.proofCommand !== entry.rerunCommand) {
      throw new Error(`proof graph admin surface ${id} proof command drifted`);
    }
    if (node.recoveryCommand !== recoveryCommands.get(id)) {
      throw new Error(`proof graph admin surface ${id} recovery command drifted`);
    }
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === "admin-spine" &&
          edge.to === expectedNodeId &&
          edge.relationship === "aggregates",
      )
    ) {
      throw new Error(`proof graph admin surface ${id} is missing aggregate edge`);
    }
  }
  return graph;
}

export function assertDevTestGameProofGraphCoversProductionFeatureTargets(
  graph,
  releaseReadiness,
) {
  const readiness = assertDevTestGameReleaseReadiness(releaseReadiness);
  const targets = productionFeatureTargetsForGraph(readiness);
  const evidenceObjectNamesByFeatureSlotId =
    productionFeatureEvidenceObjectNamesBySlotId(readiness);
  const nodes = (graph.nodes ?? []).filter(
    (node) => node.kind === "production-feature-spine-target",
  );
  if (nodes.length !== targets.length) {
    throw new Error(
      `proof graph production feature target count drifted: expected ${targets.length}, got ${nodes.length}`,
    );
  }
  const expectedDestinationSummary =
    proofGraphProductionFeatureDestinationSummary({
      nodes,
      summary: {
        productionFeatureTargetCount: targets.length,
      },
    });
  if (
    JSON.stringify(graph.summary?.productionFeatureDestinationSummary ?? null) !==
    JSON.stringify(expectedDestinationSummary)
  ) {
    throw new Error("proof graph production feature destination summary drifted");
  }
  const nodesBySlotId = new Map(nodes.map((node) => [node.featureSlotId, node]));
  for (const target of targets) {
    const slotId = target.featureSlotId;
    const node = nodesBySlotId.get(slotId);
    if (node === undefined) {
      throw new Error(`proof graph missing production feature target: ${slotId}`);
    }
    const expectedNodeId = `production-feature:${slotId}`;
    if (
      node.id !== expectedNodeId ||
      node.sourceCheckId !== target.sourceCheckId ||
      node.roleUrl !== target.detailRoleUrl ||
      node.targetRoleUrl !== target.roleUrl ||
      node.cycleId !== target.cycleId ||
      node.roleUrlId !== target.roleUrlId ||
      node.rowKind !== target.rowKind ||
      node.checkpointId !== target.checkpointId ||
      node.adminCheckId !== target.adminCheckId ||
      node.browserProofCommand !== target.browserProofCommand ||
      node.recoveryCommand !== target.rerunCommand ||
      JSON.stringify(node.coverageDecision ?? null) !==
        JSON.stringify(target.coverageDecision ?? null)
    ) {
      throw new Error(`proof graph production feature target drifted: ${slotId}`);
    }
    if (
      target.sourceCheckId === hostSetupFeatureSpineSourceCheckId &&
      !validHostSetupProductionFeatureDestinationMetadata(node)
    ) {
      throw new Error("proof graph host setup production feature destination metadata drifted");
    }
    if ((node.recoveryHookId ?? undefined) !== (target.recoveryHookId ?? undefined)) {
      throw new Error(`proof graph production feature recovery hook drifted: ${slotId}`);
    }
    const expectedEvidenceObjectNames =
      evidenceObjectNamesByFeatureSlotId[slotId] ?? [];
    if (
      expectedEvidenceObjectNames.length > 0 &&
      !sameStringArray(node.evidenceObjectNames, expectedEvidenceObjectNames)
    ) {
      throw new Error(
        `proof graph production feature evidence objects drifted: ${slotId}`,
      );
    }
    const sourceNodeId = productionFeatureSourceGraphNodeId(target.sourceCheckId);
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === sourceNodeId &&
          edge.to === expectedNodeId &&
          edge.relationship === "proves-production-feature" &&
          edge.roleUrl === target.detailRoleUrl &&
          edge.targetRoleUrl === target.roleUrl &&
          edge.command === target.browserProofCommand,
      )
    ) {
      throw new Error(`proof graph production feature ${slotId} is missing proof edge`);
    }
  }
  return graph;
}

function validHostSetupProductionFeatureDestinationMetadata(node) {
  return (
    node.adminDetailRoleUrl ===
      localAdminAuditRoleUrl(localAdminAuditIds.hostSetupProof) &&
    node.recoveryCommand === node.coverageDecision?.proofCommand &&
    node.readinessEvidence === "target/dev-test-game/host-setup-proof.json" &&
    node.browserWorkbench?.status === "passed" &&
    node.browserWorkbench.route === "/g/<seeded-game>/setup" &&
    node.browserWorkbench.roleUrl === node.targetRoleUrl &&
    node.browserWorkbench.roleSurface === "host-setup" &&
    typeof node.browserWorkbench.requiredEvidence === "string" &&
    node.browserWorkbench.requiredEvidence.includes(
      "setup workbench browser surface",
    )
  );
}

export function assertDevTestGameProofGraphCoversRoleSurfaceProofs(
  graph,
  releaseReadiness,
) {
  const readiness = assertDevTestGameReleaseReadiness(releaseReadiness);
  const roleSurfaceChecks = roleSurfaceProofChecksForGraph(readiness);
  const nodes = (graph.nodes ?? []).filter(
    (node) => node.kind === "role-surface-proof",
  );
  if (nodes.length !== roleSurfaceChecks.length) {
    throw new Error(
      `proof graph role-surface proof count drifted: expected ${roleSurfaceChecks.length}, got ${nodes.length}`,
    );
  }
  const nodesByCheckId = new Map(nodes.map((node) => [node.sourceCheckId, node]));
  for (const check of roleSurfaceChecks) {
    const node = nodesByCheckId.get(check.id);
    if (
      node?.id !== roleSurfaceProofGraphNodeId(check) ||
      node.status !== check.status ||
      node.artifact !== check.evidence ||
      node.roleUrl !== check.roleUrl ||
      node.proofBoundary !== check.proofBoundary ||
      node.recoveryCommand !== check.recoveryCommand
    ) {
      throw new Error(`proof graph role-surface proof drifted: ${check.id}`);
    }
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === "spine-manifest" &&
          edge.to === node.id &&
          edge.relationship === "records",
      )
    ) {
      throw new Error(`proof graph role-surface proof missing edge: ${check.id}`);
    }
  }
  return graph;
}

function sameStringArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

export async function writeDevTestGameProofGraph({
  generatedAt = new Date().toISOString(),
  spineManifestPath = process.env.FMARCH_DEV_TEST_GAME_SPINE_MANIFEST ??
    defaultSpineManifestPath,
  adminSpineProofPath = process.env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF ??
    defaultAdminSpineProofPath,
  adminSpineTerminalBatchesPath =
    process.env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_TERMINAL_BATCHES ??
    defaultAdminSpineTerminalBatchProofPath,
  privateChannelRecoveryReceiptPath =
    defaultRecoveryReceiptPath("privateChannelRecoveryReceipt"),
  replacementActionRecoveryReceiptPath =
    defaultRecoveryReceiptPath("replacementActionRecoveryReceipt"),
  replacementHandoffRecoveryReceiptPath =
    defaultRecoveryReceiptPath("replacementHandoffRecoveryReceipt"),
  replacementPrivateRecoveryReceiptPath =
    defaultRecoveryReceiptPath("replacementPrivateRecoveryReceipt"),
  nextActionPath = process.env.FMARCH_DEV_TEST_GAME_NEXT_ACTION ??
    devTestGameNextActionPath,
  releaseReadinessPath = process.env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS ??
    devTestGameReleaseReadinessPath,
} = {}) {
  const absoluteSpineManifestPath = path.resolve(repoRoot, spineManifestPath);
  const absoluteAdminSpineProofPath = path.resolve(repoRoot, adminSpineProofPath);
  const absoluteAdminSpineTerminalBatchesPath = path.resolve(
    repoRoot,
    adminSpineTerminalBatchesPath,
  );
  const recoveryReceiptPathInputs = {
    privateChannelRecoveryReceipt: privateChannelRecoveryReceiptPath,
    replacementActionRecoveryReceipt: replacementActionRecoveryReceiptPath,
    replacementHandoffRecoveryReceipt: replacementHandoffRecoveryReceiptPath,
    replacementPrivateRecoveryReceipt: replacementPrivateRecoveryReceiptPath,
  };
  const recoveryReceiptInputs = await readRecoveryReceiptInputs(
    recoveryReceiptPathInputs,
  );
  const absoluteNextActionPath = path.resolve(repoRoot, nextActionPath);
  const absoluteReleaseReadinessPath = path.resolve(repoRoot, releaseReadinessPath);
  const spineManifest = JSON.parse(await readFile(absoluteSpineManifestPath, "utf8"));
  const adminSpineProof = JSON.parse(await readFile(absoluteAdminSpineProofPath, "utf8"));
  const adminSpineTerminalBatches = await readOptionalJson(
    absoluteAdminSpineTerminalBatchesPath,
  );
  const nextAction = JSON.parse(await readFile(absoluteNextActionPath, "utf8"));
  const releaseReadiness = JSON.parse(
    await readFile(absoluteReleaseReadinessPath, "utf8"),
  );
  const evidence = buildDevTestGameProofGraph(
    {
      spineManifest,
      adminSpineProof,
      adminSpineTerminalBatches,
      ...recoveryReceiptInputs.receipts,
      nextAction,
      releaseReadiness,
    },
    {
      generatedAt,
      spineManifestSource: path.relative(repoRoot, absoluteSpineManifestPath),
      adminSpineProofSource: path.relative(repoRoot, absoluteAdminSpineProofPath),
      adminSpineTerminalBatchesSource: path.relative(
        repoRoot,
        absoluteAdminSpineTerminalBatchesPath,
      ),
      ...recoveryReceiptInputs.sources,
      nextActionSource: path.relative(repoRoot, absoluteNextActionPath),
      releaseReadinessSource: path.relative(repoRoot, absoluteReleaseReadinessPath),
    },
  );
  await mkdir(path.dirname(proofGraphJsonPath), { recursive: true });
  await writeFile(proofGraphJsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function buildProofGraphNodes({
  manifest,
  adminSpine,
  adminSpineTerminalBatches,
  adminSpineTerminalBatchesSource,
  privateChannelRecoveryReceipt,
  privateChannelRecoveryReceiptSource,
  replacementActionRecoveryReceipt,
  replacementActionRecoveryReceiptSource,
  replacementHandoffRecoveryReceipt,
  replacementHandoffRecoveryReceiptSource,
  replacementPrivateRecoveryReceipt,
  replacementPrivateRecoveryReceiptSource,
  releaseReadiness,
  releaseReadinessSource,
}) {
  const recoveryCommands = new Map(
    (adminSpine.recovery?.surfaces ?? []).map((surface) => [
      surface.id,
      surface.rerunCommand,
    ]),
  );
  const adminProofNodes = (adminSpine.adminProofs ?? []).map((proof) => ({
    id: `admin-proof:${proof.id}`,
    surfaceId: proof.id,
    label: proof.label,
    kind: "admin-proof-surface",
    status: proof.status,
    artifact: proof.path,
    roleUrl: proof.detailRoleUrl,
    proofCommand: proof.rerunCommand,
    recoveryCommand: recoveryCommands.get(proof.id) ?? proof.rerunCommand,
  }));
  const productionFeatureTargetNodes = buildProductionFeatureTargetNodes({
    releaseReadiness,
    releaseReadinessSource,
  });
  const roleSurfaceProofNodes = buildRoleSurfaceProofNodes({
    releaseReadiness,
  });
  const coreLoopScenarioFamilyNodes = buildCoreLoopScenarioFamilyNodes({
    recoveryCommand: recoveryCommands.get("core-loop"),
  });
  const terminalBatchNode =
    adminSpineTerminalBatches === null
      ? []
      : [
          {
            id: "admin-spine-terminal-batches",
            label: "Admin spine terminal proof batches",
            kind: "terminal-proof-batch-receipt",
            status: adminSpineTerminalBatches.status,
            artifact: adminSpineTerminalBatchesSource,
            roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.adminSpine),
            proofCommand: manifest.commands?.adminSpine?.script,
            recoveryCommand: adminSpine.recovery?.nextCommand,
            batchCount: adminSpineTerminalBatches.batchCount,
            proofIds: [
              ...new Set(
                adminSpineTerminalBatches.batches.flatMap(
                  (batch) => batch.proofIds,
                ),
              ),
            ],
            artifactPaths: [
              ...new Set(
                adminSpineTerminalBatches.batches.flatMap(
                  (batch) => batch.artifactPaths,
                ),
              ),
            ],
            receiptArtifacts: terminalBatchReceiptArtifacts(
              adminSpineTerminalBatches,
            ),
          },
        ];
  const recoveryReceiptNodes = buildRecoveryReceiptGraphNodes({
    privateChannelRecoveryReceipt,
    privateChannelRecoveryReceiptSource,
    replacementActionRecoveryReceipt,
    replacementActionRecoveryReceiptSource,
    replacementHandoffRecoveryReceipt,
    replacementHandoffRecoveryReceiptSource,
    replacementPrivateRecoveryReceipt,
    replacementPrivateRecoveryReceiptSource,
  });
  return [
    {
      id: "admin-spine",
      label: "Local admin spine",
      kind: "aggregate-proof",
      status: adminSpine.status,
      artifact: defaultAdminSpineProofPath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.adminSpine),
      proofCommand: manifest.commands?.adminSpine?.script,
      recoveryCommand: adminSpine.recovery?.nextCommand,
    },
    {
      id: "spine-manifest",
      label: "Local spine manifest",
      kind: "manifest",
      status: manifest.status,
      artifact: defaultSpineManifestPath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.spineManifest),
      proofCommand: "test:dev-test-game-spine-manifest",
      recoveryCommand: recoveryCommands.get("spine-manifest"),
    },
    {
      id: "proof-graph",
      label: "Local proof graph",
      kind: "proof-graph",
      status: "passed",
      artifact: manifest.commands?.proofGraph?.proofArtifact,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph),
      proofCommand: manifest.commands?.proofGraph?.script,
      recoveryCommand: manifest.commands?.proofGraph?.script,
    },
    {
      id: "proof-freshness",
      label: "Local proof freshness",
      kind: "freshness-dashboard",
      status: manifest.artifactFreshness?.status ?? "unknown",
      artifact: manifest.commands?.proofFreshness?.proofArtifact,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofFreshness),
      proofCommand: manifest.commands?.proofFreshness?.script,
      recoveryCommand: manifest.artifactFreshness?.nextCommand,
    },
    {
      id: "next-action",
      label: "Local next action",
      kind: "recovery-receipt",
      status: "recorded",
      artifact: manifest.commands?.nextAction?.proofArtifact,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.nextAction),
      proofCommand: manifest.commands?.nextAction?.script,
      recoveryCommand: manifest.commands?.proofFreshness?.script,
    },
    ...proofGraphDiagnosticProofNodes,
    ...terminalBatchNode,
    ...recoveryReceiptNodes,
    ...roleSurfaceProofNodes,
    ...adminProofNodes,
    ...coreLoopScenarioFamilyNodes,
    ...productionFeatureTargetNodes,
  ].map((node) =>
    Object.fromEntries(
      Object.entries(node).filter(([, value]) => value !== undefined && value !== ""),
    ),
  );
}

function buildProofGraphEdges({
  nodes,
  nextAction = null,
  adminSpineTerminalBatches = null,
  privateChannelRecoveryReceipt = null,
  replacementActionRecoveryReceipt = null,
  replacementHandoffRecoveryReceipt = null,
  replacementPrivateRecoveryReceipt = null,
}) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [
    ["admin-spine", "spine-manifest", "aggregates"],
    ["spine-manifest", "proof-graph", "records"],
    ["spine-manifest", "proof-freshness", "records"],
    ["spine-manifest", "next-action", "records"],
    ["proof-freshness", "next-action", "recovers-through"],
    ...proofGraphDiagnosticProofEdges.map((edge) => [
      edge.from,
      edge.to,
      edge.relationship,
      {
        reason: edge.reason,
        command: edge.command,
      },
    ]),
    ...terminalBatchEdges(adminSpineTerminalBatches),
    ...buildRecoveryReceiptGraphEdgeRows({
      privateChannelRecoveryReceipt,
      replacementActionRecoveryReceipt,
      replacementHandoffRecoveryReceipt,
      replacementPrivateRecoveryReceipt,
    }),
    ...nextActionRecoveryEdges(nextAction),
    ...nodes
      .filter((node) => node.kind === "role-surface-proof")
      .map((node) => ["spine-manifest", node.id, "records"]),
    ...nodes
      .filter((node) => node.kind === "admin-proof-surface")
      .map((node) => ["admin-spine", node.id, "aggregates"]),
    ...nodes
      .filter((node) => node.kind === "core-loop-scenario-family")
      .map((node) => [
        "admin-proof:core-loop",
        node.id,
        "contains-scenario-family",
        {
          familyId: node.familyId,
          roleUrl: node.roleUrl,
          command: node.recoveryCommand,
        },
      ]),
    ...nodes
      .filter((node) => node.kind === "production-feature-spine-target")
      .map((node) => [
        productionFeatureSourceGraphNodeId(node.sourceCheckId),
        node.id,
        "proves-production-feature",
        {
          featureSlotId: node.featureSlotId,
          roleUrl: node.roleUrl,
          targetRoleUrl: node.targetRoleUrl,
          command: node.browserProofCommand,
        },
      ]),
  ];
  return edges
    .filter(([from, to]) => nodeIds.has(from) && nodeIds.has(to))
    .map(([from, to, relationship, metadata = {}]) =>
      Object.fromEntries(
        Object.entries({ from, to, relationship, ...metadata }).filter(
          ([, value]) => value !== undefined && value !== "",
        ),
      ),
  );
}

function buildCoreLoopScenarioFamilyNodes({ recoveryCommand }) {
  const command =
    recoveryCommand ?? "npm run test:dev-test-game-core-loop-admin-proof";
  return coreLoopScenarioFamilyRows().map((family) => ({
    id: coreLoopScenarioFamilyNodeId(family.id),
    label: family.label,
    kind: "core-loop-scenario-family",
    status: "passed",
    artifact: devTestGameCoreLoopAdminProofPath,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
    proofCommand: command,
    recoveryCommand: command,
    familyId: family.id,
    laneCount: family.laneIds.length,
    laneIds: family.laneIds,
    surfaceIds: family.surfaces,
    staleRejectIds: family.staleRejects,
    reloadIds: family.reloads,
    scenarioIds: family.scenarios,
    transitionTokenIds: family.transitionTokens,
  }));
}

function coreLoopScenarioFamilyNodeId(familyId) {
  return `core-loop-family:${familyId}`;
}

function buildRecoveryReceiptGraphNodes(inputs) {
  return recoveryReceiptGraphDescriptors
    .map((descriptor) =>
      buildRecoveryReceiptGraphNode({
        descriptor,
        receipt: inputs[descriptor.receiptKey] ?? null,
        source: inputs[descriptor.sourceKey],
      }),
    )
    .filter((node) => node !== null);
}

function validateRecoveryReceiptsForProofGraph(inputs) {
  return Object.fromEntries(
    recoveryReceiptGraphDescriptors.map((descriptor) => {
      const receipt = inputs[descriptor.receiptKey];
      return [
        descriptor.receiptKey,
        receipt === null
          ? null
          : validateRecoveryReceiptArtifact(receipt, descriptor, {
              path: inputs[descriptor.sourceKey],
            }),
      ];
    }),
  );
}

function buildRecoveryReceiptGraphEdgeRows(inputs) {
  return recoveryReceiptGraphDescriptors.flatMap((descriptor) =>
    buildRecoveryReceiptGraphEdges({
      descriptor,
      receipt: inputs[descriptor.receiptKey] ?? null,
    }),
  );
}

function recoveryReceiptGeneratedFromSources(inputs) {
  return Object.fromEntries(
    recoveryReceiptGraphDescriptors.flatMap((descriptor) => {
      const receipt = inputs[descriptor.receiptKey];
      return receipt === null
        ? []
        : [[descriptor.receiptKey, inputs[descriptor.sourceKey]]];
    }),
  );
}

function recoveryReceiptSummaryLaneCounts(inputs) {
  return Object.fromEntries(
    recoveryReceiptGraphDescriptors.map((descriptor) => [
      descriptor.summaryLaneCountKey,
      inputs[descriptor.receiptKey]?.laneCount ?? 0,
    ]),
  );
}

async function readRecoveryReceiptInputs(pathInputs) {
  const entries = await Promise.all(
    recoveryReceiptGraphDescriptors.map(async (descriptor) => {
      const absolutePath = path.resolve(
        repoRoot,
        pathInputs[descriptor.receiptKey],
      );
      return [
        descriptor,
        absolutePath,
        await readOptionalJson(absolutePath),
      ];
    }),
  );
  return {
    receipts: Object.fromEntries(
      entries.map(([descriptor, , receipt]) => [descriptor.receiptKey, receipt]),
    ),
    sources: Object.fromEntries(
      entries.map(([descriptor, absolutePath]) => [
        descriptor.sourceKey,
        path.relative(repoRoot, absolutePath),
      ]),
    ),
  };
}

function defaultRecoveryReceiptPath(receiptKey) {
  const descriptor = recoveryReceiptGraphDescriptorByReceiptKey(receiptKey);
  return process.env[descriptor.envVar] ?? descriptor.proofTarget;
}

function terminalBatchEdges(adminSpineTerminalBatches) {
  if (adminSpineTerminalBatches === null) {
    return [];
  }
  return ["proof-graph", "proof-freshness", "next-action"].map((target) => [
    "admin-spine-terminal-batches",
    target,
    "terminal-browser-proof",
    {
      batchLabels: adminSpineTerminalBatches.batches
        .filter((batch) => batch.proofIds.includes(target))
        .map((batch) => batch.label),
    },
  ]);
}

function terminalBatchReceiptArtifacts(adminSpineTerminalBatches) {
  return adminSpineTerminalBatches.batches.flatMap((batch) =>
    batch.proofIds.map((proofId, index) => ({
      proofId,
      artifactPath: batch.artifactPaths[index],
      batchLabel: batch.label,
    })),
  );
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function buildProductionFeatureTargetNodes({
  releaseReadiness,
  releaseReadinessSource,
}) {
  const targets = productionFeatureTargetsForGraph(releaseReadiness);
  const evidenceObjectNamesByFeatureSlotId =
    productionFeatureEvidenceObjectNamesBySlotId(releaseReadiness);
  const destinationMetadataByFeatureSlotId =
    productionFeatureDestinationMetadataBySlotId(releaseReadiness);
  return targets.map((target) =>
    buildProductionFeatureTargetGraphNode({
      target,
      releaseReadinessSource,
      evidenceObjectNames:
        evidenceObjectNamesByFeatureSlotId[target.featureSlotId] ?? [],
      destinationMetadata:
        destinationMetadataByFeatureSlotId[target.featureSlotId] ?? {},
    }),
  );
}

export function buildProductionFeatureTargetGraphNode({
  target,
  releaseReadinessSource,
  evidenceObjectNames = [],
  destinationMetadata = {},
}) {
  return {
    id: `production-feature:${target.featureSlotId}`,
    featureSlotId: target.featureSlotId,
    label: `Production feature: ${target.featureSlotId}`,
    kind: "production-feature-spine-target",
    status: "passed",
    artifact: releaseReadinessSource,
    sourceCheckId: target.sourceCheckId,
    roleUrl: target.detailRoleUrl,
    targetRoleUrl: target.roleUrl,
    cycleId: target.cycleId,
    roleUrlId: target.roleUrlId,
    rowKind: target.rowKind,
    checkpointId: target.checkpointId,
    recoveryHookId: target.recoveryHookId,
    adminCheckId: target.adminCheckId,
    browserProofCommand: target.browserProofCommand,
    recoveryCommand: target.rerunCommand,
    coverageDecision: target.coverageDecision,
    ...(evidenceObjectNames.length === 0 ? {} : { evidenceObjectNames }),
    ...destinationMetadata,
  };
}

function productionFeatureDestinationMetadataBySlotId(releaseReadiness) {
  const hostSetupCheck = releaseReadiness.localDevelopmentSpine?.checks?.find(
    (check) => check.id === hostSetupFeatureSpineSourceCheckId,
  );
  if (hostSetupCheck === undefined) {
    return {};
  }
  const hostSetupTargets = hostSetupCheck.spineTargets?.productionFeatureTargets;
  if (!Array.isArray(hostSetupTargets?.slotIds)) {
    return {};
  }
  return Object.fromEntries(
    hostSetupTargets.slotIds.map((slotId) => [
      slotId,
      {
        adminDetailRoleUrl:
          hostSetupCheck.adminRoleSurface?.detailRoleUrl ??
          localAdminAuditRoleUrl(localAdminAuditIds.hostSetupProof),
        browserWorkbench: hostSetupCheck.browserWorkbench,
        readinessEvidence: hostSetupCheck.evidence,
      },
    ]),
  );
}

function buildRoleSurfaceProofNodes({ releaseReadiness }) {
  return roleSurfaceProofChecksForGraph(releaseReadiness).map((check) => ({
    id: roleSurfaceProofGraphNodeId(check),
    sourceCheckId: check.id,
    label: check.label,
    kind: "role-surface-proof",
    status: check.status,
    artifact: check.evidence,
    roleUrl: check.roleUrl,
    proofBoundary: check.proofBoundary,
    recoveryCommand: check.recoveryCommand,
  }));
}

function roleSurfaceProofChecksForGraph(releaseReadiness) {
  const roleSurfaceSourceCheckIds = new Set(
    productionFeatureRoleSurfaceSourceCheckIds,
  );
  return (releaseReadiness.localDevelopmentSpine?.checks ?? []).filter(
    (check) => roleSurfaceSourceCheckIds.has(check.id),
  );
}

function roleSurfaceProofGraphNodeId(check) {
  const source = productionFeatureSourceForCheckId(check.id);
  if (!source.graphSourceNodeId.startsWith("role-surface:")) {
    throw new Error(`proof graph source is not a role surface: ${check.id}`);
  }
  return source.graphSourceNodeId;
}

function productionFeatureEvidenceObjectNamesBySlotId(releaseReadiness) {
  const privateChannelMilestone =
    releaseReadiness.localDevelopmentSpine?.checks?.find(
      (check) => check.id === "local-private-channel-recovery-milestone",
    );
  const privateChannelEvidenceObjectNames =
    privateChannelMilestone?.normalizedEvidenceObjects
      ?.filter((object) => object.status === "passed")
      .map((object) => object.name) ?? [];
  return {
    ...(privateChannelEvidenceObjectNames.length === 0
      ? {}
      : { "private-channel": privateChannelEvidenceObjectNames }),
  };
}

function seededGraphRoleUrl(roleUrl) {
  return (
    roleUrl.includes("?game=<seeded-game>") ||
    roleUrl.endsWith("/g/<seeded-game>") ||
    roleUrl.endsWith("/g/<replacement-action-game>") ||
    roleUrl.includes("/g/<replacement-private-game>/") ||
    roleUrl.includes("/g/<seeded-game>/")
  );
}

function productionFeatureTargetsForGraph(releaseReadiness) {
  const coreLoopTargets = coreLoopProductionFeatureTargetCollection(releaseReadiness);
  const roleSurfaceTargets =
    roleSurfaceProductionFeatureTargetCollections(releaseReadiness);
  const hardeningTargets = hardeningProductionFeatureTargetCollection(
    releaseReadiness,
  );
  const targetsBySlotId = new Map(
    [
      coreLoopTargets,
      ...roleSurfaceTargets,
      hardeningTargets,
    ].flatMap((targets) =>
      targets.slotIds.map((slotId) => [slotId, targets.bySlotId[slotId]]),
    ),
  );
  for (const item of productionFacingSurfaceChecklistItems()) {
    const slotId = item.productionFeatureSpineTarget.featureSlotId;
    if (!targetsBySlotId.has(slotId)) {
      targetsBySlotId.set(
        slotId,
        resolveBuildableProductionFeatureTarget({
          declaration: item.productionFeatureSpineTarget,
          releaseReadiness,
        }),
      );
    }
  }
  return [...targetsBySlotId.values()];
}

function coreLoopProductionFeatureTargetCollection(releaseReadiness) {
  const coreLoopCheck = releaseReadiness.localDevelopmentSpine?.checks?.find(
    (check) => check.id === coreLoopFeatureSpineSourceCheckId,
  );
  const targets = coreLoopCheck?.spineTargets?.productionFeatureTargets;
  if (
    targets?.status !== "passed" ||
    !Array.isArray(targets.slotIds) ||
    targets.bySlotId === null ||
    typeof targets.bySlotId !== "object"
  ) {
    throw new Error("proof graph missing core-loop production feature targets");
  }
  return targets;
}

function hardeningProductionFeatureTargetCollection(releaseReadiness) {
  const hardeningCheck = releaseReadiness.localDevelopmentSpine?.checks?.find(
    (check) => check.id === hardeningFeatureSpineSourceCheckId,
  );
  const targets = hardeningCheck?.spineTargets?.productionFeatureTargets;
  if (
    targets?.status !== "passed" ||
    !Array.isArray(targets.slotIds) ||
    targets.bySlotId === null ||
    typeof targets.bySlotId !== "object"
  ) {
    throw new Error("proof graph missing hardening production feature targets");
  }
  return targets;
}

function roleSurfaceProductionFeatureTargetCollections(releaseReadiness) {
  return productionFeatureRoleSurfaceSources.map((source) =>
    roleSurfaceProductionFeatureTargetCollection(releaseReadiness, source),
  );
}

function roleSurfaceProductionFeatureTargetCollection(
  releaseReadiness,
  source,
) {
  const check = releaseReadiness.localDevelopmentSpine?.checks?.find(
    (item) => item.id === source.sourceCheckId,
  );
  const targets = check?.spineTargets?.productionFeatureTargets;
  if (
    targets?.status !== "passed" ||
    !Array.isArray(targets.slotIds) ||
    targets.bySlotId === null ||
    typeof targets.bySlotId !== "object"
  ) {
    if (source.sourceCheckId === hostSetupFeatureSpineSourceCheckId) {
      return { status: "passed", slotIds: [], bySlotId: {} };
    }
    throw new Error(
      `proof graph missing ${source.sourceCheckId} production feature targets`,
    );
  }
  return targets;
}

function resolveBuildableProductionFeatureTarget({ declaration, releaseReadiness }) {
  if (declaration.sourceCheckId === identityFeatureSpineSourceCheckId) {
    const identityCheck = releaseReadiness.localDevelopmentSpine?.checks?.find(
      (check) => check.id === declaration.sourceCheckId,
    );
    const detailRoleUrl = identityCheck?.adminRoleSurface?.detailRoleUrl;
    if (typeof detailRoleUrl !== "string" || detailRoleUrl.trim() === "") {
      throw new Error("proof graph missing identity adapter production feature target");
    }
    return {
      featureSlotId: declaration.featureSlotId,
      sourceCheckId: declaration.sourceCheckId,
      detailRoleUrl,
      cycleId: declaration.cycleId,
      roleUrlId: declaration.roleUrlId,
      roleUrl: detailRoleUrl,
      rowKind: featureSpineRowKind(declaration),
      checkpointId: declaration.checkpointId,
      adminCheckId: declaration.adminCheckId,
      browserProofCommand: devTestGameLiveProofCommand,
      rerunCommand: devTestGameIdentityAdminProofCommand,
    };
  }
  throw new Error(
    `proof graph cannot resolve production feature source check: ${declaration.sourceCheckId}`,
  );
}

function nextActionRecoveryEdges(nextAction) {
  if (nextAction?.nextAction?.reason !== "seed-proof-lane-coverage-drift") {
    return [];
  }
  const seedCoverage = nextAction.nextAction.seedProofLaneCoverage;
  return [
    [
      "next-action",
      "admin-proof:seed",
      "recovery-target",
      {
        reason: nextAction.nextAction.reason,
        command: nextAction.nextAction.command,
        roleUrl: seedCoverage?.roleUrl,
        proofTarget: seedCoverage?.proofTarget,
        buildSlice: seedCoverage?.buildSlice,
        unclassifiedLaneCount: seedCoverage?.unclassifiedLaneCount,
        unclassifiedLaneIds: seedCoverage?.unclassifiedLaneIds,
      },
    ],
  ];
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidence = await writeDevTestGameProofGraph();
  console.log(`wrote ${devTestGameProofGraphPath} (${evidence.status})`);
}
