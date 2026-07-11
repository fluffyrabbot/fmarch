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
  productionFeatureBrowserWorkbenchEvidence,
} from "./dev_test_game_production_feature_spine_resolver.mjs";
import {
  hostedIdentityTerminalReceiptArtifactCase,
  normalizeProofGraphReceiptArtifactRows,
  proofGraphTerminalReceiptParentId,
  terminalProofGraphEdgeTargetIds,
} from "./dev_test_game_proof_graph_receipt_artifact_rows.mjs";
import {
  assertHostedIdentityProofGraphDependency,
  assertHostedIdentityProofGraphDependencyNodes,
  hostedIdentityOperatorDependencyProofGraphEdgeRows,
  hostedIdentityOperatorDependencyProofGraphNodes,
} from "./dev_test_game_hosted_identity_proof_graph_dependency.mjs";
import {
  assertProofGraphProductionFeatureProvenanceComparison,
  proofGraphProductionFeatureDestinationSummary,
  proofGraphProductionFeatureProvenanceComparison,
  proofGraphProductionFeatureTargetDestinations,
} from "./dev_test_game_proof_graph_production_feature_destinations.mjs";
import {
  productionFeatureGraphSourceNodeId as productionFeatureSourceGraphNodeId,
} from "./dev_test_game_production_feature_graph_sources.mjs";
import {
  coreLoopFeatureSpineSourceCheckId,
  devTestGameCoreLoopAdminProofCommand,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  hostedMatrixRawEvidenceTemplateDiagnosticFieldKeys,
  hostedMatrixRawEvidenceTemplateDiagnosticFieldValues,
} from "./dev_test_game_hosted_matrix_raw_evidence_template_proof.mjs";
import {
  assertHostedEvidenceOperatorChecklistDescriptor,
} from "./dev_test_game_hosted_evidence_operator_checklist.mjs";
import {
  assertCoreLoopCommandProofRoleUrlAuditExpectation,
  coreLoopCommandProofRoleUrlAuditExpectation,
} from "./dev_test_game_core_loop_proof_shape_assertions.mjs";
import {
  hostVisibleRecoverySummaryCases,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
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
  productionFeatureSourceCoverageDecisionSummaryForCheckId,
  productionFeatureSourceForCheckId,
} from "./dev_test_game_production_feature_source_registry.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand,
  devTestGameHostedEvidenceLaneRealCaptureAdminProofPath,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  devTestGameHostedConcurrentRaceMatrixCommand,
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import {
  devTestGameHostedEvidenceOperatorChecklistAdminProofPath,
  devTestGameHostedEvidenceOperatorChecklistProofPath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  devTestGameRealHostedObservabilityHandoffCommand,
  devTestGameRealHostedObservabilityHandoffPath,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  adminProofDestinationRequirementForLink,
  proofGraphDiagnosticProofEdges,
  proofGraphDiagnosticProofNodes,
} from "./dev_test_game_proof_graph_handoff_cases.mjs";
import {
  selectedOperatorHandoffFromNextAction,
} from "./dev_test_game_terminal_receipts.mjs";
import {
  assertProofGraphDiagnosticProofSummary,
  buildProofGraphDiagnosticProofSummary,
} from "./dev_test_game_proof_graph_diagnostic_summary.mjs";
import {
  proofGraphCoreLoopRecoveryDestinationEdgeRows,
  proofGraphCoreLoopRecoveryDestinationNodeId,
  proofGraphCoreLoopRecoveryDestinationNodes,
} from "./dev_test_game_proof_graph_core_loop_recovery_destinations.mjs";
import {
  proofGraphCoreLoopScenarioFamilyEdgeRows,
  proofGraphCoreLoopScenarioFamilyNodes,
} from "./dev_test_game_proof_graph_core_loop_scenario_families.mjs";
import {
  devTestGameCoreLoopAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  devTestGameReleaseAdminProofPath,
  devTestGameReleaseAdminProofContractPath,
} from "./dev_test_game_release_artifact_paths.mjs";
import {
  devTestGameReleaseAdminProofContractCommand,
} from "./dev_test_game_release_admin_proof_contract.mjs";
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
const selectedOperatorHandoffPacketNodeId = "selected-operator-handoff-packet";

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
    nextAction: nextActionEvidence,
    releaseReadiness: releaseReadinessChecklist,
    releaseReadinessSource,
  });
  const edges = buildProofGraphEdges({
    nodes,
    nextAction: nextActionEvidence,
    releaseReadiness: releaseReadinessChecklist,
    adminSpineTerminalBatches: adminSpineTerminalBatchEvidence,
    privateChannelRecoveryReceipt: privateChannelRecoveryReceiptEvidence,
    replacementActionRecoveryReceipt:
      replacementActionRecoveryReceiptEvidence,
    replacementHandoffRecoveryReceipt:
      replacementHandoffRecoveryReceiptEvidence,
    replacementPrivateRecoveryReceipt:
      replacementPrivateRecoveryReceiptEvidence,
  });
  const productionFeatureTargetDestinations =
    proofGraphProductionFeatureTargetDestinations({ nodes });
  const productionFeatureDestinationSummary =
    proofGraphProductionFeatureDestinationSummary({
      nodes,
    });
  const productionFeatureProvenanceComparison =
    proofGraphProductionFeatureProvenanceComparison({
      manifestSummary: manifest.productionFeatureProvenanceSummary,
      destinationSummary: productionFeatureDestinationSummary,
      destinations: productionFeatureTargetDestinations,
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
      "Generated local proof graph for the dev-test-game development spine. It records local audit role URLs, production feature spine target role URLs, artifact paths, proof commands, dependencies, and recovery edges for seeded admin proof surfaces; it does not validate artifact contents, live hosted identity, hosted operations, beta readiness, release readiness, or production readiness.",
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
      manifestProductionFeatureProvenanceSummary:
        manifest.productionFeatureProvenanceSummary,
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
      productionFeatureDestinationSummary,
      productionFeatureProvenanceComparison,
      diagnosticProofSummary: buildProofGraphDiagnosticProofSummary({ nodes }),
      coreLoopScenarioFamilyCount: nodes.filter(
        (node) => node.kind === "core-loop-scenario-family",
      ).length,
      commandProofRoleUrlAuditCount: nodes.filter(
        (node) => node.kind === "command-proof-role-url-audit",
      ).length,
      coreLoopHostVisibleRecoveryCount: nodes.filter(
        (node) => node.kind === "core-loop-host-visible-recovery",
      ).length,
      selectedOperatorHandoffPacketCount: nodes.filter(
        (node) => node.kind === "selected-operator-handoff-packet",
      ).length,
      phaseLocalNextActionCount: nodes.filter(
        (node) => node.kind === "phase-local-next-action",
      ).length,
      handoffPhaseOutputCount: nodes.filter(
        (node) => node.kind === "handoff-phase-output",
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
  assertProofGraphProductionFeatureProvenanceComparison(
    evidence.summary?.productionFeatureProvenanceComparison,
    {
      manifestSummary:
        evidence.generatedFrom?.manifestProductionFeatureProvenanceSummary,
      destinationSummary: evidence.summary?.productionFeatureDestinationSummary,
      destinations: proofGraphProductionFeatureTargetDestinations(evidence),
    },
  );
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
    assertProofGraphNodeLocalPrerequisiteDestinations(node);
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
  assertDevTestGameProofGraphCoversHostedEvidenceRealCaptureProof(evidence);
  assertDevTestGameProofGraphCoversHostedIdentityOperatorPrerequisites(evidence);
  assertDevTestGameProofGraphCoversPrivateChannelRecoveryReceipt(evidence);
  assertDevTestGameProofGraphCoversCoreLoopScenarioFamilies(evidence);
  assertDevTestGameProofGraphCoversCoreLoopCommandProofRoleUrlAudit(evidence);
  assertDevTestGameProofGraphCoversCoreLoopHostVisibleRecoveries(evidence);
  assertDevTestGameProofGraphCoversSelectedOperatorHandoffPacket(evidence);
  assertDevTestGameProofGraphCoversPhaseLocalNextActions(evidence);
  assertDevTestGameProofGraphCoversReplacementPrivateRecoveryReceipt(evidence);
  assertDevTestGameProofGraphCoversReplacementActionRecoveryReceipt(evidence);
  assertDevTestGameProofGraphCoversReplacementHandoffRecoveryReceipt(evidence);
  if (releaseReadiness !== undefined) {
    assertDevTestGameProofGraphCoversHostedEvidenceMatrixTransition(
      evidence,
      releaseReadiness,
    );
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

export function assertDevTestGameProofGraphCoversHostedEvidenceRealCaptureProof(
  graph,
) {
  const node = (graph.nodes ?? []).find(
    (candidate) =>
      candidate.id === "hosted-evidence-lane-real-capture-admin-proof",
  );
  if (
    node?.kind !== "optional-browser-proof" ||
    node.status !== "passed" ||
    node.artifact !== devTestGameHostedEvidenceLaneRealCaptureAdminProofPath ||
    node.roleUrl !== localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane) ||
    node.proofCommand !==
      devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand ||
    node.recoveryCommand !==
      devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand ||
    node.releaseReady !== false ||
    node.productionReady !== false
  ) {
    throw new Error(
      "proof graph hosted evidence lane real-capture proof node drifted",
    );
  }
  for (const edge of [
    {
      from: "admin-proof:hosted-evidence-lane",
      to: "hosted-evidence-lane-real-capture-admin-proof",
      relationship: "proves-positive-real-capture-path",
    },
    {
      from: "hosted-evidence-lane-real-capture-admin-proof",
      to: "proof-graph",
      relationship: "records",
    },
    {
      from: "hosted-evidence-lane-real-capture-admin-proof",
      to: "next-action",
      relationship: "summarizes-into",
    },
  ]) {
    if (
      !(graph.edges ?? []).some(
        (candidate) =>
          candidate.from === edge.from &&
          candidate.to === edge.to &&
          candidate.relationship === edge.relationship &&
          candidate.command ===
            devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand,
      )
    ) {
      throw new Error(
        `proof graph hosted evidence lane real-capture edge missing: ${edge.from}->${edge.to}`,
      );
    }
  }
  return graph;
}

export function assertDevTestGameProofGraphCoversHostedEvidenceMatrixTransition(
  graph,
  releaseReadiness,
) {
  const transition = hostedEvidenceMatrixTransitionFromReadiness(releaseReadiness);
  if (transition === null) {
    return graph;
  }
  const edge = (graph.edges ?? []).find(
    (candidate) =>
      candidate.from === "admin-proof:hosted-evidence-lane" &&
      candidate.to === "admin-proof:hosted-concurrent-race-matrix" &&
      candidate.relationship === "feeds-hosted-matrix-transition",
  );
  if (
    edge === undefined ||
    edge.command !== devTestGameHostedConcurrentRaceMatrixCommand ||
    edge.proofTarget !== devTestGameHostedConcurrentRaceMatrixPath ||
    edge.roleUrl !==
      localAdminAuditRoleUrl(localAdminAuditIds.hostedConcurrentRaceMatrix) ||
    edge.source !== transition.source ||
    edge.status !== transition.status ||
    edge.mode !== transition.mode ||
    edge.realHostedEvidenceStatus !== transition.realHostedEvidenceStatus ||
    edge.realHostedDeploymentStatus !== transition.realHostedDeploymentStatus ||
    (transition.sourcePath ?? null) !== (edge.sourcePath ?? null) ||
    (transition.externalEvidencePath ?? null) !==
      (edge.externalEvidencePath ?? null)
  ) {
    throw new Error(
      "proof graph hosted evidence lane to hosted matrix transition edge drifted",
    );
  }
  if (
    transition.source === "hosted-evidence-lane" &&
    (edge.status !== "passed" ||
      edge.mode !== "real-hosted" ||
      edge.realHostedDeploymentStatus !== "passed")
  ) {
    throw new Error(
      "proof graph hosted evidence lane transition edge must preserve passed real-hosted status",
    );
  }
  if (
    transition.source === "not_configured" &&
    (edge.status !== "not_configured" ||
      edge.mode !== "not_configured" ||
      edge.realHostedDeploymentStatus !== "unproven")
  ) {
    throw new Error(
      "proof graph hosted evidence lane transition edge must preserve blocked no-env status",
    );
  }
  return graph;
}

export function assertDevTestGameProofGraphCoversHostedIdentityOperatorPrerequisites(
  graph,
) {
  assertHostedIdentityProofGraphDependencyNodes(graph);
  assertHostedIdentityProofGraphDependency(graph);
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
  const expectedNodes = proofGraphCoreLoopScenarioFamilyNodes();
  const expectedEdgeRows = proofGraphCoreLoopScenarioFamilyEdgeRows({
    nodes: expectedNodes,
  });
  const nodes = (graph.nodes ?? []).filter(
    (node) => node.kind === "core-loop-scenario-family",
  );
  if (graph.summary?.coreLoopScenarioFamilyCount !== expectedNodes.length) {
    throw new Error("proof graph core-loop scenario family count drifted");
  }
  if (nodes.length !== expectedNodes.length) {
    throw new Error(
      `proof graph core-loop scenario family node count drifted: expected ${expectedNodes.length}, got ${nodes.length}`,
    );
  }
  const nodeByFamilyId = new Map(nodes.map((node) => [node.familyId, node]));
  for (const expectedNode of expectedNodes) {
    const node = nodeByFamilyId.get(expectedNode.familyId);
    if (
      node?.id !== expectedNode.id ||
      node.label !== expectedNode.label ||
      node.status !== expectedNode.status ||
      node.artifact !== expectedNode.artifact ||
      node.roleUrl !== expectedNode.roleUrl ||
      node.recoveryCommand !== expectedNode.recoveryCommand ||
      node.laneCount !== expectedNode.laneCount ||
      !sameStringArray(node.laneIds, expectedNode.laneIds) ||
      !sameStringArray(node.surfaceIds, expectedNode.surfaceIds) ||
      !sameStringArray(node.staleRejectIds, expectedNode.staleRejectIds) ||
      !sameStringArray(node.reloadIds, expectedNode.reloadIds) ||
      !sameStringArray(node.scenarioIds, expectedNode.scenarioIds) ||
      !sameStringArray(node.transitionTokenIds, expectedNode.transitionTokenIds)
    ) {
      throw new Error(
        `proof graph core-loop scenario family node drifted: ${expectedNode.familyId}`,
      );
    }
  }
  for (const [from, to, relationship, metadata] of expectedEdgeRows) {
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === from &&
          edge.to === to &&
          edge.relationship === relationship &&
          edge.familyId === metadata.familyId &&
          edge.roleUrl === metadata.roleUrl &&
          edge.command === metadata.command,
      )
    ) {
      throw new Error(
        `proof graph core-loop scenario family edge missing: ${metadata.familyId}`,
      );
    }
  }
  return graph;
}

export function assertDevTestGameProofGraphCoversCoreLoopCommandProofRoleUrlAudit(
  graph,
) {
  const node = (graph.nodes ?? []).find(
    (candidate) => candidate.id === "core-loop-command-proof-role-url-audit",
  );
  const expectedAudit = assertCoreLoopCommandProofRoleUrlAuditExpectation({
    audit: node,
    includeEvidenceInError: true,
  });
  if (
    node?.kind !== "command-proof-role-url-audit" ||
    node.label !== "Core-loop command proof role URL audit" ||
    node.status !== expectedAudit.status ||
    node.artifact !== devTestGameCoreLoopAdminProofPath ||
    node.roleUrl !== localAdminAuditRoleUrl(localAdminAuditIds.coreLoop) ||
    node.proofCommand !== devTestGameCoreLoopAdminProofCommand ||
    node.recoveryCommand !== devTestGameCoreLoopAdminProofCommand ||
    node.visibleAdminRowId !== "command-proof-role-url-audit" ||
    node.visibleAdminRowTestId !==
      "admin-audit-command-proof-role-url-audit-command-proof-role-url-audit"
  ) {
    throw new Error("proof graph core-loop command proof audit node drifted");
  }
  if (
    graph.summary?.commandProofRoleUrlAuditCount !== 1 ||
    !(graph.edges ?? []).some(
      (edge) =>
        edge.from === "admin-proof:core-loop" &&
        edge.to === "core-loop-command-proof-role-url-audit" &&
        edge.relationship === "audits-command-proof-role-urls" &&
        edge.roleUrl === localAdminAuditRoleUrl(localAdminAuditIds.coreLoop) &&
        edge.command === devTestGameCoreLoopAdminProofCommand &&
        edge.proofTarget === devTestGameCoreLoopAdminProofPath &&
        edge.checkedCount === expectedAudit.checkedCount,
    )
  ) {
    throw new Error("proof graph core-loop command proof audit edge drifted");
  }
  return graph;
}

export function assertDevTestGameProofGraphCoversCoreLoopHostVisibleRecoveries(
  graph,
) {
  const recoveryCases = hostVisibleRecoverySummaryCases();
  const nodes = (graph.nodes ?? []).filter(
    (node) => node.kind === "core-loop-host-visible-recovery",
  );
  if (graph.summary?.coreLoopHostVisibleRecoveryCount !== recoveryCases.length) {
    throw new Error("proof graph core-loop host-visible recovery count drifted");
  }
  if (nodes.length !== recoveryCases.length) {
    throw new Error(
      `proof graph core-loop host-visible recovery node count drifted: expected ${recoveryCases.length}, got ${nodes.length}`,
    );
  }
  const nodeByRecoveryCaseId = new Map(
    nodes.map((node) => [node.recoveryCaseId, node]),
  );
  for (const recoveryCase of recoveryCases) {
    const expectedNodeId = proofGraphCoreLoopRecoveryDestinationNodeId(
      recoveryCase.id,
    );
    const node = nodeByRecoveryCaseId.get(recoveryCase.id);
    if (
      node?.id !== expectedNodeId ||
      node.label !== recoveryCase.label ||
      node.status !== "passed" ||
      node.artifact !== devTestGameCoreLoopAdminProofPath ||
      node.roleUrl !== localAdminAuditRoleUrl(localAdminAuditIds.coreLoop) ||
      node.proofCommand !== devTestGameCoreLoopAdminProofCommand ||
      node.recoveryCommand !== devTestGameCoreLoopAdminProofCommand ||
      node.group !== recoveryCase.group ||
      node.adminCheckId !== recoveryCase.adminCheckId ||
      node.recoveryHookId !== recoveryCase.recoveryHookId ||
      node.recoveryHookStatus !== recoveryCase.recoveryHookStatus ||
      node.commandKind !== recoveryCase.commandKind ||
      node.visibleAdminRowId !== `host-visible-recovery-${recoveryCase.id}` ||
      node.visibleAdminRowTestId !==
        `admin-audit-host-visible-recovery-${recoveryCase.id}`
    ) {
      throw new Error(
        `proof graph core-loop host-visible recovery node drifted: ${recoveryCase.id}`,
      );
    }
    for (const [from, to, relationship] of [
      ["admin-proof:core-loop", expectedNodeId, "proves-host-visible-recovery"],
      [expectedNodeId, "proof-graph", "records"],
      [expectedNodeId, "next-action", "summarizes-into"],
    ]) {
      if (
        !(graph.edges ?? []).some(
          (edge) =>
            edge.from === from &&
            edge.to === to &&
            edge.relationship === relationship &&
            edge.roleUrl === localAdminAuditRoleUrl(localAdminAuditIds.coreLoop) &&
            edge.command === devTestGameCoreLoopAdminProofCommand &&
            edge.proofTarget === devTestGameCoreLoopAdminProofPath &&
            edge.recoveryCaseId === recoveryCase.id,
        )
      ) {
        throw new Error(
          `proof graph core-loop host-visible recovery edge missing: ${recoveryCase.id} ${from}->${to}`,
        );
      }
    }
  }
  return graph;
}

export function assertDevTestGameProofGraphCoversSelectedOperatorHandoffPacket(
  graph,
) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const node = nodes.find(
    (candidate) => candidate.id === selectedOperatorHandoffPacketNodeId,
  );
  const selectedEdge = edges.find(
    (edge) =>
      edge.from === "next-action" &&
      edge.relationship === "selected-operator-handoff",
  );
  if (selectedEdge === undefined) {
    if (node !== undefined) {
      throw new Error(
        "proof graph selected operator packet node has no selected edge",
      );
    }
    return graph;
  }
  if (
    node === undefined ||
    node.kind !== "selected-operator-handoff-packet" ||
    node.status !== "blocked" ||
    node.firstMissingInputId !== selectedEdge.firstMissingInputId ||
    node.selectedProductionFeatureGraphNodeId !== selectedEdge.to ||
    node.selectedProductionFeatureRoleUrl !== selectedEdge.roleUrl ||
    node.proofTarget !== selectedEdge.proofTarget ||
    node.unprovenId !== selectedEdge.unprovenId ||
    typeof node.rawEvidenceContractSummary !== "string" ||
    node.rawEvidenceContractSummary.trim() === "" ||
    !Array.isArray(node.rawEvidenceContractRequiredTopLevelFields) ||
    node.rawEvidenceContractRequiredTopLevelFields.length === 0 ||
    (node.rawEvidenceTemplate !== undefined &&
      rawEvidenceTemplateDiagnosticFieldsAreMissing(
        node.rawEvidenceTemplate,
      )) ||
    (node.unprovenId === "hosted-deployment" &&
      assertHostedEvidenceOperatorChecklistDescriptor(node.operatorChecklist) ===
        null)
  ) {
    throw new Error("proof graph selected operator packet node drifted");
  }
  if (
    !edges.some(
      (edge) =>
        edge.from === "next-action" &&
        edge.to === selectedOperatorHandoffPacketNodeId &&
        edge.relationship === "selected-operator-packet" &&
        edge.firstMissingInputId === node.firstMissingInputId &&
        edge.proofTarget === node.proofTarget,
    )
  ) {
    throw new Error("proof graph selected operator packet node is not linked");
  }
  if (
    !edges.some(
      (edge) =>
        edge.from === selectedOperatorHandoffPacketNodeId &&
        edge.to === node.selectedProductionFeatureGraphNodeId &&
        edge.relationship === "blocks-hosted-evidence-for" &&
        edge.firstMissingInputId === node.firstMissingInputId,
    )
  ) {
    throw new Error(
      "proof graph selected operator packet does not block its feature",
    );
  }
  return graph;
}

function rawEvidenceTemplateDiagnosticFieldsAreMissing(template) {
  const fields = hostedMatrixRawEvidenceTemplateDiagnosticFieldValues(template);
  return (
    fields.length !== hostedMatrixRawEvidenceTemplateDiagnosticFieldKeys.length ||
    fields.some(
      (field) => typeof field.value !== "string" || field.value.trim() === "",
    )
  );
}

export function assertDevTestGameProofGraphCoversTerminalBatches(graph) {
  const terminalNode = (graph?.nodes ?? []).find(
    (node) => node.id === proofGraphTerminalReceiptParentId,
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
    !terminalProofGraphEdgeTargetIds.every((target) =>
      terminalNode.proofIds.includes(target),
    ) ||
    !Array.isArray(terminalNode.receiptArtifacts) ||
    !terminalNode.receiptArtifacts.some(
      (artifact) =>
        artifact.rowId === hostedIdentityTerminalReceiptArtifactCase.rowId &&
        artifact.status === hostedIdentityTerminalReceiptArtifactCase.status,
    )
  ) {
    throw new Error("proof graph terminal batch node drifted");
  }
  for (const target of terminalProofGraphEdgeTargetIds) {
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === proofGraphTerminalReceiptParentId &&
          edge.to === target &&
          edge.relationship === "terminal-browser-proof",
      )
    ) {
      throw new Error(`proof graph terminal batch edge missing: ${target}`);
    }
  }
  const releaseValidation = (terminalNode.terminalValidations ?? []).find(
    (validation) => validation.id === "release-admin-proof-contract",
  );
  if (releaseValidation !== undefined) {
    if (
      releaseValidation.artifactPath !==
        devTestGameReleaseAdminProofContractPath ||
      releaseValidation.command !==
        devTestGameReleaseAdminProofContractCommand ||
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === proofGraphTerminalReceiptParentId &&
          edge.to === "release-admin-proof-contract" &&
          edge.relationship === "terminal-artifact-validation" &&
          edge.command === devTestGameReleaseAdminProofContractCommand &&
          edge.proofTarget === devTestGameReleaseAdminProofContractPath,
      )
    ) {
      throw new Error("proof graph terminal validation edge drifted");
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
    assertProofGraphAdminSurfacePrerequisites({
      node,
      expectedNodeId,
      id,
    });
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

function assertProofGraphAdminSurfacePrerequisites({ node, expectedNodeId, id }) {
  const requirement = adminProofDestinationRequirementForLink(expectedNodeId);
  const expectedDestinations =
    requirement?.requiredLocalPrerequisiteDestinations ?? [];
  const actualDestinations = node.requiredLocalPrerequisiteDestinations ?? [];
  if (
    JSON.stringify(actualDestinations) !== JSON.stringify(expectedDestinations)
  ) {
    throw new Error(
      `proof graph admin surface ${id} local prerequisite destinations drifted`,
    );
  }
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
      JSON.stringify(node.browserWorkbench ?? null) !==
        JSON.stringify(target.browserWorkbench ?? null) ||
      node.sourceProofArtifact !== target.sourceProofArtifact ||
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
    if (
      productionFeatureRoleSurfaceSourceCheckIds.includes(target.sourceCheckId) &&
      target.sourceCheckId !== hostSetupFeatureSpineSourceCheckId &&
      !validRoleSurfaceProductionFeatureDestinationMetadata(node, target)
    ) {
      throw new Error(
        `proof graph role-surface production feature destination metadata drifted: ${slotId}`,
      );
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
          edge.sourceProofArtifact === target.sourceProofArtifact &&
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

function validRoleSurfaceProductionFeatureDestinationMetadata(node, target) {
  return (
    node.readinessEvidence === target.sourceProofArtifact &&
    node.browserWorkbench !== null &&
    typeof node.browserWorkbench === "object" &&
    node.browserWorkbench.status === "passed" &&
    node.browserWorkbench.roleUrl === target.roleUrl &&
    node.browserWorkbench.featureSlotId === target.featureSlotId &&
    typeof node.browserWorkbench.requiredEvidence === "string" &&
    node.browserWorkbench.requiredEvidence.trim() !== ""
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
  nextAction,
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
    ...adminProofNodePrerequisiteMetadata(`admin-proof:${proof.id}`),
  }));
  const productionFeatureTargetNodes = buildProductionFeatureTargetNodes({
    releaseReadiness,
    releaseReadinessSource,
  });
  const roleSurfaceProofNodes = buildRoleSurfaceProofNodes({
    releaseReadiness,
  });
  const coreLoopScenarioFamilyNodes = proofGraphCoreLoopScenarioFamilyNodes({
    recoveryCommand: recoveryCommands.get("core-loop"),
  });
  const coreLoopCommandProofRoleUrlAuditNode =
    buildCoreLoopCommandProofRoleUrlAuditNode({
      recoveryCommand: recoveryCommands.get("core-loop"),
    });
  const coreLoopHostVisibleRecoveryNodes =
    proofGraphCoreLoopRecoveryDestinationNodes({
      recoveryCommand: recoveryCommands.get("core-loop"),
    });
  const hostedIdentityOperatorPrerequisiteNodes =
    hostedIdentityOperatorDependencyProofGraphNodes();
  const selectedOperatorHandoffPacketNode =
    buildSelectedOperatorHandoffPacketNode({ nextAction });
  const phaseLocalNextActionNodes =
    buildPhaseLocalNextActionSnapshotNodes(manifest);
  const handoffPhaseOutputNodes = buildHandoffPhaseOutputNodes(manifest);
  const hostedEvidenceRealCaptureProofNode = {
    id: "hosted-evidence-lane-real-capture-admin-proof",
    label: "Hosted evidence lane real-capture admin proof",
    kind: "optional-browser-proof",
    status: "passed",
    artifact:
      manifest.commands?.hostedEvidenceLaneRealCaptureAdminProof
        ?.proofArtifact ?? devTestGameHostedEvidenceLaneRealCaptureAdminProofPath,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane),
    proofCommand:
      manifest.commands?.hostedEvidenceLaneRealCaptureAdminProof?.script ??
      devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand,
    recoveryCommand:
      manifest.commands?.hostedEvidenceLaneRealCaptureAdminProof?.script ??
      devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand,
    releaseReady: false,
    productionReady: false,
  };
  const releaseAdminProofContractNode = {
    id: "release-admin-proof-contract",
    label: "Release admin proof diagnostics contract",
    kind: "terminal-validation",
    status: "passed",
    artifact:
      manifest.commands?.releaseAdminProofContract?.proofArtifact ??
      devTestGameReleaseAdminProofContractPath,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.releaseReadiness),
    proofCommand:
      manifest.commands?.releaseAdminProofContract?.script ??
      devTestGameReleaseAdminProofContractCommand,
    recoveryCommand:
      manifest.commands?.releaseAdminProofContract?.script ??
      devTestGameReleaseAdminProofContractCommand,
    validatesArtifacts: [
      releaseReadinessSource,
      devTestGameReleaseAdminProofPath,
    ],
    releaseReady: false,
    productionReady: false,
  };
  const terminalBatchNode =
    adminSpineTerminalBatches === null
      ? []
      : [
          {
            id: proofGraphTerminalReceiptParentId,
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
            terminalValidations:
              adminSpineTerminalBatches.terminalValidations ?? [],
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
    ...phaseLocalNextActionNodes,
    ...handoffPhaseOutputNodes,
    ...proofGraphDiagnosticProofNodes,
    ...terminalBatchNode,
    ...recoveryReceiptNodes,
    ...roleSurfaceProofNodes,
    ...adminProofNodes,
    ...selectedOperatorHandoffPacketNode,
    hostedEvidenceRealCaptureProofNode,
    releaseAdminProofContractNode,
    ...hostedIdentityOperatorPrerequisiteNodes,
    coreLoopCommandProofRoleUrlAuditNode,
    ...coreLoopHostVisibleRecoveryNodes,
    ...coreLoopScenarioFamilyNodes,
    ...productionFeatureTargetNodes,
  ].map((node) =>
    Object.fromEntries(
      Object.entries(node).filter(([, value]) => value !== undefined && value !== ""),
    ),
  );
}

function adminProofNodePrerequisiteMetadata(linkId) {
  const requirement = adminProofDestinationRequirementForLink(linkId);
  const destinations = requirement?.requiredLocalPrerequisiteDestinations ?? [];
  return destinations.length === 0
    ? {}
    : {
        requiredLocalPrerequisiteDestinations: destinations.map(
          (destination) => ({ ...destination }),
        ),
      };
}

function assertProofGraphNodeLocalPrerequisiteDestinations(node) {
  if (node.requiredLocalPrerequisiteDestinations === undefined) {
    return;
  }
  const requirement = adminProofDestinationRequirementForLink(node.id);
  const expected = requirement?.requiredLocalPrerequisiteDestinations ?? [];
  if (
    JSON.stringify(node.requiredLocalPrerequisiteDestinations) !==
    JSON.stringify(expected)
  ) {
    throw new Error(
      `proof graph node ${node.id} local prerequisite destinations drifted`,
    );
  }
}

function buildProofGraphEdges({
  nodes,
  nextAction = null,
  releaseReadiness,
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
    ...releaseAdminProofContractEdges(nodes),
    ...buildRecoveryReceiptGraphEdgeRows({
      privateChannelRecoveryReceipt,
      replacementActionRecoveryReceipt,
      replacementHandoffRecoveryReceipt,
      replacementPrivateRecoveryReceipt,
    }),
    ...nextActionRecoveryEdges(nextAction),
    ...nodes
      .filter((node) => node.kind === "phase-local-next-action")
      .flatMap((node) => [
        [
          "spine-manifest",
          node.id,
          "records-phase-local-next-action",
          {
            command: node.proofCommand,
            proofTarget: node.artifact,
            phaseLocalNextActionId: node.phaseLocalNextActionId,
          },
        ],
        [
          "next-action",
          node.id,
          "phase-local-snapshot",
          {
            command: node.proofCommand,
            proofTarget: node.artifact,
            phaseLocalNextActionId: node.phaseLocalNextActionId,
            sequenceStage: node.sequenceStage,
          },
        ],
      ]),
    ...nodes
      .filter((node) => node.kind === "handoff-phase-output")
      .map((node) => [
        "spine-manifest",
        node.id,
        "records-handoff-phase-output",
        {
          command: node.proofCommand,
          proofTarget: node.artifact,
          handoffPhaseId: node.handoffPhaseId,
          handoffPhaseStep: node.handoffPhaseStep,
          handoffPhaseOutputId: node.handoffPhaseOutputId,
        },
      ]),
    ...nodes
      .filter((node) => node.kind === "role-surface-proof")
      .map((node) => ["spine-manifest", node.id, "records"]),
    ...nodes
      .filter((node) => node.kind === "admin-proof-surface")
      .map((node) => ["admin-spine", node.id, "aggregates"]),
    ...realHostedObservabilityDependencyEdges(nodes),
    ...hostedEvidenceLaneToHostedMatrixTransitionEdges({
      nodes,
      releaseReadiness,
    }),
    ...hostedEvidenceRealCaptureProofEdges(nodes),
    ...nodes
      .filter((node) => node.kind === "command-proof-role-url-audit")
      .map((node) => [
        "admin-proof:core-loop",
        node.id,
        "audits-command-proof-role-urls",
        {
          roleUrl: node.roleUrl,
          command: node.recoveryCommand,
          proofTarget: node.artifact,
          checkedCount: node.checkedCount,
        },
      ]),
    ...proofGraphCoreLoopRecoveryDestinationEdgeRows({ nodes }),
    ...proofGraphCoreLoopScenarioFamilyEdgeRows({ nodes }),
    ...selectedOperatorHandoffPacketEdges(nodes),
    ...hostedIdentityOperatorDependencyProofGraphEdgeRows(nodes),
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
          sourceProofArtifact: node.sourceProofArtifact,
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

function buildPhaseLocalNextActionSnapshotNodes(manifest) {
  return (manifest.terminalArtifacts ?? [])
    .filter((artifact) => artifact.phaseLocalNextAction !== undefined)
    .map((artifact) => ({
      id: artifact.id,
      label: artifact.label,
      kind: "phase-local-next-action",
      status: "recorded",
      artifact: artifact.path,
      canonicalArtifact: artifact.phaseLocalNextAction.canonicalPath,
      phaseLocalNextActionId: artifact.phaseLocalNextAction.id,
      sequenceStage: artifact.phaseLocalNextAction.sequenceStage,
      proofCommand: artifact.command,
      recoveryCommand: artifact.command,
      proofBoundary: artifact.boundary,
    }));
}

function buildHandoffPhaseOutputNodes(manifest) {
  return (manifest.handoffPhaseOutputs ?? []).map((output) => ({
    id: `handoff-phase-output:${proofGraphIdPart(output.id)}`,
    label: `Handoff phase output ${output.phaseId} ${output.step}`,
    kind: "handoff-phase-output",
    status: "recorded",
    artifact: output.artifact,
    handoffPhaseId: output.phaseId,
    handoffPhaseStep: output.step,
    handoffPhaseOutputId: output.id,
    proofCommand: output.script,
    recoveryCommand: output.script,
    ...(output.readinessReason === undefined
      ? {}
      : { readinessReason: output.readinessReason }),
    proofBoundary:
      "Handoff phase output recorded from the spine manifest. It records local harness artifact wiring only; it does not prove hosted deployment, release readiness, or production readiness.",
  }));
}

function proofGraphIdPart(value) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function assertDevTestGameProofGraphCoversPhaseLocalNextActions(graph) {
  const snapshots = (graph?.nodes ?? []).filter(
    (node) => node.kind === "phase-local-next-action",
  );
  if (graph.summary?.phaseLocalNextActionCount !== snapshots.length) {
    throw new Error("proof graph phase-local next-action summary drifted");
  }
  const expected = [
    {
      id: "next-action-hosted-evidence-operator-checklist",
      artifact:
        "target/dev-test-game/next-action-hosted-evidence-operator-checklist.json",
      phaseLocalNextActionId: "hosted-evidence-operator-checklist",
      sequenceStage: undefined,
    },
    {
      id: "next-action-hosted-identity",
      artifact: "target/dev-test-game/next-action-hosted-identity.json",
      phaseLocalNextActionId: "hosted-identity",
      sequenceStage: "hosted-identity",
    },
  ];
  const actual = snapshots.map((node) => ({
    id: node.id,
    artifact: node.artifact,
    canonicalArtifact: node.canonicalArtifact,
    phaseLocalNextActionId: node.phaseLocalNextActionId,
    sequenceStage: node.sequenceStage,
    proofCommand: node.proofCommand,
  }));
  const normalizedExpected = expected.map((node) => ({
    id: node.id,
    artifact: node.artifact,
    canonicalArtifact: devTestGameNextActionPath,
    phaseLocalNextActionId: node.phaseLocalNextActionId,
    sequenceStage: node.sequenceStage,
    proofCommand: "test:dev-test-game-next-action",
  }));
  if (JSON.stringify(actual) !== JSON.stringify(normalizedExpected)) {
    throw new Error(
      `proof graph phase-local next-action nodes drifted: ${JSON.stringify(actual)}`,
    );
  }
  for (const node of expected) {
    for (const [from, relationship] of [
      ["spine-manifest", "records-phase-local-next-action"],
      ["next-action", "phase-local-snapshot"],
    ]) {
      if (
        !(graph.edges ?? []).some(
          (edge) =>
            edge.from === from &&
            edge.to === node.id &&
            edge.relationship === relationship &&
            edge.phaseLocalNextActionId === node.phaseLocalNextActionId &&
            edge.proofTarget === node.artifact,
        )
      ) {
        throw new Error(
          `proof graph phase-local next-action edge missing: ${from}->${node.id}`,
        );
      }
    }
  }
  return graph;
}

export function assertDevTestGameProofGraphCoversHandoffPhaseOutputs(graph) {
  const outputs = (graph?.nodes ?? []).filter(
    (node) => node.kind === "handoff-phase-output",
  );
  if (graph.summary?.handoffPhaseOutputCount !== outputs.length) {
    throw new Error("proof graph handoff phase output summary drifted");
  }
  const expected = [
    {
      handoffPhaseId: "hosted-evidence-operator-checklist-handoff",
      handoffPhaseStep: "checklist-proof",
      artifact: devTestGameHostedEvidenceOperatorChecklistProofPath,
    },
    {
      handoffPhaseId: "hosted-evidence-operator-checklist-handoff",
      handoffPhaseStep: "phase-local-next-action",
      artifact:
        "target/dev-test-game/next-action-hosted-evidence-operator-checklist.json",
    },
    {
      handoffPhaseId: "hosted-evidence-operator-checklist-handoff",
      handoffPhaseStep: "admin-proof",
      artifact: devTestGameHostedEvidenceOperatorChecklistAdminProofPath,
    },
    {
      handoffPhaseId: "hosted-identity-handoff",
      handoffPhaseStep: "phase-local-next-action",
      artifact: "target/dev-test-game/next-action-hosted-identity.json",
    },
    {
      handoffPhaseId: "hosted-identity-handoff",
      handoffPhaseStep: "hosted-identity-next-action-admin-proof-batch",
      artifact: "target/dev-test-game/hosted-identity-next-action-admin-proof.json",
    },
    {
      handoffPhaseId: "hosted-identity-handoff",
      handoffPhaseStep: "default-next-action-refresh",
      artifact: "target/dev-test-game/next-action.json",
    },
    {
      handoffPhaseId: "hosted-identity-handoff",
      handoffPhaseStep: "terminal-refresh-admin-proof-batch",
      artifact: "target/dev-test-game/proof-freshness-admin-proof.json",
    },
    {
      handoffPhaseId: "hosted-identity-handoff",
      handoffPhaseStep: "terminal-refresh-admin-proof-batch",
      artifact: "target/dev-test-game/next-action-admin-proof.json",
    },
    {
      handoffPhaseId: "hosted-identity-handoff",
      handoffPhaseStep: "terminal-refresh-admin-proof-batch",
      artifact: "target/dev-test-game/admin-spine-terminal-batches.json",
    },
  ];
  const actual = outputs.map((node) => ({
    handoffPhaseId: node.handoffPhaseId,
    handoffPhaseStep: node.handoffPhaseStep,
    artifact: node.artifact,
    proofCommand: node.proofCommand,
  }));
  if (
    JSON.stringify(actual.map(({ proofCommand, ...row }) => row)) !==
    JSON.stringify(expected)
  ) {
    throw new Error(
      `proof graph handoff phase output nodes drifted: ${JSON.stringify(actual)}`,
    );
  }
  for (const node of outputs) {
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === "spine-manifest" &&
          edge.to === node.id &&
          edge.relationship === "records-handoff-phase-output" &&
          edge.handoffPhaseId === node.handoffPhaseId &&
          edge.handoffPhaseStep === node.handoffPhaseStep &&
          edge.handoffPhaseOutputId === node.handoffPhaseOutputId &&
          edge.proofTarget === node.artifact,
      )
    ) {
      throw new Error(
        `proof graph handoff phase output edge missing: spine-manifest->${node.id}`,
      );
    }
  }
  return graph;
}

function releaseAdminProofContractEdges(nodes) {
  return nodes.some((node) => node.id === "release-admin-proof-contract")
    ? [
        [
          "spine-manifest",
          "release-admin-proof-contract",
          "records-terminal-validation",
          {
            command: devTestGameReleaseAdminProofContractCommand,
          },
        ],
        [
          "admin-proof:release",
          "release-admin-proof-contract",
          "validates-browser-diagnostics",
          {
            command: devTestGameReleaseAdminProofContractCommand,
            proofTarget: devTestGameReleaseAdminProofContractPath,
          },
        ],
      ]
    : [];
}

function realHostedObservabilityDependencyEdges(nodes) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (
    !nodeIds.has("admin-proof:hosted-ops-signals") ||
    !nodeIds.has("admin-proof:real-hosted-observability-handoff")
  ) {
    return [];
  }
  return [
    [
      "admin-proof:hosted-ops-signals",
      "admin-proof:real-hosted-observability-handoff",
      "feeds-real-hosted-observability-handoff",
      {
        command: `npm run ${devTestGameRealHostedObservabilityHandoffCommand}`,
        proofTarget: devTestGameRealHostedObservabilityHandoffPath,
        roleUrl: localAdminAuditRoleUrl(
          localAdminAuditIds.realHostedObservabilityHandoff,
        ),
        status: "blocked",
        source: "hosted-ops-signals",
      },
    ],
  ];
}

function hostedEvidenceLaneToHostedMatrixTransitionEdges({
  nodes,
  releaseReadiness,
}) {
  if (
    !nodes.some((node) => node.id === "admin-proof:hosted-evidence-lane") ||
    !nodes.some(
      (node) => node.id === "admin-proof:hosted-concurrent-race-matrix",
    )
  ) {
    return [];
  }
  const transition = hostedEvidenceMatrixTransitionFromReadiness(
    releaseReadiness,
  );
  if (transition === null) {
    return [];
  }
  return [
    [
      "admin-proof:hosted-evidence-lane",
      "admin-proof:hosted-concurrent-race-matrix",
      "feeds-hosted-matrix-transition",
      {
        source: transition.source,
        sourcePath: transition.sourcePath,
        status: transition.status,
        mode: transition.mode,
        realHostedEvidenceStatus: transition.realHostedEvidenceStatus,
        realHostedDeploymentStatus: transition.realHostedDeploymentStatus,
        externalEvidencePath: transition.externalEvidencePath,
        roleUrl: localAdminAuditRoleUrl(
          localAdminAuditIds.hostedConcurrentRaceMatrix,
        ),
        command: devTestGameHostedConcurrentRaceMatrixCommand,
        proofTarget: devTestGameHostedConcurrentRaceMatrixPath,
      },
    ],
  ];
}

function hostedEvidenceMatrixTransitionFromReadiness(releaseReadiness) {
  const transition = releaseReadiness?.localDevelopmentSpine?.checks?.find(
    (check) => check.id === "local-hosted-concurrent-race-matrix-admin-surface",
  )?.hostedEvidenceTransition;
  if (transition === null || transition === undefined) {
    return null;
  }
  return {
    source: String(transition.source ?? ""),
    sourcePath:
      transition.sourcePath === null || transition.sourcePath === undefined
        ? null
        : String(transition.sourcePath),
    status: String(transition.status ?? ""),
    mode: String(transition.mode ?? ""),
    realHostedEvidenceStatus: String(transition.realHostedEvidenceStatus ?? ""),
    realHostedDeploymentStatus: String(
      transition.realHostedDeploymentStatus ?? "",
    ),
    externalEvidencePath:
      transition.externalEvidencePath === null ||
      transition.externalEvidencePath === undefined
        ? null
        : String(transition.externalEvidencePath),
  };
}

function hostedEvidenceRealCaptureProofEdges(nodes) {
  return nodes.some(
    (node) => node.id === "hosted-evidence-lane-real-capture-admin-proof",
  )
    ? [
        [
          "admin-proof:hosted-evidence-lane",
          "hosted-evidence-lane-real-capture-admin-proof",
          "proves-positive-real-capture-path",
          {
            command: devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand,
          },
        ],
        [
          "hosted-evidence-lane-real-capture-admin-proof",
          "proof-graph",
          "records",
          {
            command: devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand,
          },
        ],
        [
          "hosted-evidence-lane-real-capture-admin-proof",
          "next-action",
          "summarizes-into",
          {
            command: devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand,
          },
        ],
      ]
    : [];
}

function buildSelectedOperatorHandoffPacketNode({ nextAction }) {
  const handoff =
    nextAction?.selectedOperatorHandoff ??
    selectedOperatorHandoffFromNextAction(nextAction?.nextAction);
  if (handoff === null || typeof handoff !== "object") {
    return [];
  }
  const packet = handoff.blockedOperatorPacket;
  if (packet === null || typeof packet !== "object") {
    return [];
  }
  const roleSurfaceDrilldown =
    packet.roleSurfaceDrilldown !== null &&
    typeof packet.roleSurfaceDrilldown === "object"
      ? packet.roleSurfaceDrilldown
      : null;
  return [
    {
      id: selectedOperatorHandoffPacketNodeId,
      packetId: handoff.id,
      label: "Selected operator handoff packet",
      kind: "selected-operator-handoff-packet",
      status: packet.status,
      artifact: devTestGameNextActionPath,
      roleUrl: roleSurfaceDrilldown?.handoffRoleUrl ?? handoff.roleUrl,
      proofCommand: handoff.command,
      recoveryCommand: handoff.command,
      command: handoff.command,
      reason: handoff.reason,
      unprovenId: handoff.unprovenId,
      proofTarget: handoff.proofTarget,
      packetProofTarget: packet.proofTarget,
      nextProofTarget: packet.nextProofTarget,
      firstMissingInputId: packet.firstMissingInputId,
      firstMissingCheckId: packet.firstMissingCheckId,
      firstMissingSectionId: packet.firstMissingSectionId,
      firstMissingSectionLabel: packet.firstMissingSectionLabel,
      firstMissingRequiredEvidence: packet.firstMissingRequiredEvidence,
      rawEvidenceContractSummary: packet.rawEvidenceContractSummary,
      rawEvidenceContractRequiredTopLevelFields:
        packet.rawEvidenceContractRequiredTopLevelFields,
      ...(packet.rawEvidenceTemplate === undefined
        ? {}
        : { rawEvidenceTemplate: packet.rawEvidenceTemplate }),
      operatorAction: packet.operatorAction,
      operatorChecklist: packet.operatorChecklist,
      localVsHostedBoundary: packet.localVsHostedBoundary,
      selectedProductionFeatureGraphNodeId:
        packet.selectedProductionFeatureGraphNodeId,
      selectedProductionFeatureRoleUrl:
        packet.selectedProductionFeatureRoleUrl,
      roleSurfaceDrilldown: roleSurfaceDrilldown ?? undefined,
      releaseReady: false,
      productionReady: false,
    },
  ];
}

function selectedOperatorHandoffPacketEdges(nodes) {
  const node = nodes.find(
    (candidate) => candidate.id === selectedOperatorHandoffPacketNodeId,
  );
  if (node === undefined) {
    return [];
  }
  return [
    [
      "next-action",
      node.id,
      "selected-operator-packet",
      {
        command: node.command,
        firstMissingInputId: node.firstMissingInputId,
        roleUrl: node.roleUrl,
        proofTarget: node.proofTarget,
        unprovenId: node.unprovenId,
      },
    ],
    [
      node.id,
      node.selectedProductionFeatureGraphNodeId,
      "blocks-hosted-evidence-for",
      {
        command: node.command,
        firstMissingInputId: node.firstMissingInputId,
        roleUrl: node.selectedProductionFeatureRoleUrl,
        proofTarget: node.proofTarget,
        unprovenId: node.unprovenId,
      },
    ],
  ];
}

function buildCoreLoopCommandProofRoleUrlAuditNode({ recoveryCommand }) {
  const command = recoveryCommand ?? devTestGameCoreLoopAdminProofCommand;
  return {
    id: "core-loop-command-proof-role-url-audit",
    label: "Core-loop command proof role URL audit",
    kind: "command-proof-role-url-audit",
    artifact: devTestGameCoreLoopAdminProofPath,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
    proofCommand: command,
    recoveryCommand: command,
    visibleAdminRowId: "command-proof-role-url-audit",
    visibleAdminRowTestId:
      "admin-audit-command-proof-role-url-audit-command-proof-role-url-audit",
    ...coreLoopCommandProofRoleUrlAuditExpectation,
  };
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
  return [
    ...terminalProofGraphEdgeTargetIds.map((target) => [
      proofGraphTerminalReceiptParentId,
      target,
      "terminal-browser-proof",
      {
        batchLabels: adminSpineTerminalBatches.batches
          .filter((batch) => batch.proofIds.includes(target))
          .map((batch) => batch.label),
      },
    ]),
    ...(adminSpineTerminalBatches.terminalValidations ?? []).map(
      (validation) => [
        proofGraphTerminalReceiptParentId,
        validation.id,
        "terminal-artifact-validation",
        {
          command: validation.command,
          proofTarget: validation.artifactPath,
          localDiagnosticCount: validation.localDiagnosticCount,
        },
      ],
    ),
  ];
}

function terminalBatchReceiptArtifacts(adminSpineTerminalBatches) {
  return normalizeProofGraphReceiptArtifactRows({
    parentId: proofGraphTerminalReceiptParentId,
    artifacts: adminSpineTerminalBatches.batches.flatMap((batch) =>
      batch.proofIds.map((proofId, index) => ({
        proofId,
        artifactPath: batch.artifactPaths[index],
        batchLabel: batch.label,
      })),
    ),
  });
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
    ...(target.featureTargetKind === undefined
      ? {}
      : { featureTargetKind: target.featureTargetKind }),
    browserProofCommand: target.browserProofCommand,
    ...(target.browserWorkbench === undefined
      ? {}
      : { browserWorkbench: target.browserWorkbench }),
    sourceProofArtifact: target.sourceProofArtifact,
    recoveryCommand: target.rerunCommand,
    coverageDecision: target.coverageDecision,
    ...(evidenceObjectNames.length === 0 ? {} : { evidenceObjectNames }),
    ...destinationMetadata,
  };
}

function productionFeatureDestinationMetadataBySlotId(releaseReadiness) {
  const roleSurfaceSourceCheckIds = new Set(
    productionFeatureRoleSurfaceSourceCheckIds,
  );
  return Object.fromEntries(
    (releaseReadiness.localDevelopmentSpine?.checks ?? [])
      .filter((check) => roleSurfaceSourceCheckIds.has(check.id))
      .flatMap((check) => {
        const targets = check.spineTargets?.productionFeatureTargets;
        if (!Array.isArray(targets?.slotIds)) {
          return [];
        }
        const browserWorkbench =
          check.spineTargets?.browserWorkbench ?? check.browserWorkbench;
        return targets.slotIds.map((slotId) => [
          slotId,
          {
            ...(check.id === hostSetupFeatureSpineSourceCheckId
              ? {
                  adminDetailRoleUrl:
                    check.adminRoleSurface?.detailRoleUrl ??
                    localAdminAuditRoleUrl(localAdminAuditIds.hostSetupProof),
                }
              : {}),
            ...(browserWorkbench === undefined ? {} : { browserWorkbench }),
            readinessEvidence: check.evidence,
          },
        ]);
      }),
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
    const target = {
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
      sourceProofArtifact: productionFeatureSourceForCheckId(
        declaration.sourceCheckId,
      ).proofArtifact,
      rerunCommand: devTestGameIdentityAdminProofCommand,
      coverageDecision: productionFeatureSourceCoverageDecisionSummaryForCheckId(
        declaration.sourceCheckId,
      ),
    };
    return {
      ...target,
      browserWorkbench: productionFeatureBrowserWorkbenchEvidence(target),
    };
  }
  throw new Error(
    `proof graph cannot resolve production feature source check: ${declaration.sourceCheckId}`,
  );
}

function nextActionRecoveryEdges(nextAction) {
  return [
    ...nextActionSeedCoverageRecoveryEdges(nextAction),
    ...nextActionSelectedOperatorHandoffEdges(nextAction),
  ];
}

function nextActionSeedCoverageRecoveryEdges(nextAction) {
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

function nextActionSelectedOperatorHandoffEdges(nextAction) {
  const handoff = nextAction?.selectedOperatorHandoff;
  if (handoff === null || typeof handoff !== "object") {
    return [];
  }
  return [
    [
      "next-action",
      handoff.selectedProductionFeatureGraphNodeId,
      "selected-operator-handoff",
      {
        command: handoff.command,
        firstMissingInputId: handoff.firstMissingInputId,
        roleUrl: handoff.selectedProductionFeatureRoleUrl,
        proofTarget: handoff.proofTarget,
        unprovenId: handoff.unprovenId,
      },
    ],
  ];
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidence = await writeDevTestGameProofGraph();
  console.log(`wrote ${devTestGameProofGraphPath} (${evidence.status})`);
}
