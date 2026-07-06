import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameProofGraph } from "./dev_test_game_proof_graph.mjs";
import {
  coreLoopScenarioFamilyRows,
} from "./dev_test_game_core_loop_generated_from_families.mjs";
import {
  assertProofGraphProductionFeatureProvenanceComparison,
  proofGraphProductionFeatureTargetDestinations,
} from "./dev_test_game_proof_graph_production_feature_destinations.mjs";
import {
  validateDevTestGameAdminSpineProof,
  validateDevTestGameAdminSpineTerminalBatches,
} from "./dev_test_game_release_readiness.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameHostedConcurrentRaceMatrixEvidence,
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import {
  devTestGameHostedEvidenceLaneDemoBlockedPath,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  assertDevTestGameHostedEvidenceLane,
} from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  hostedEvidenceProgressionHandoffSummary,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  assertVisibleAdminRoleSurfaceRows,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";
import {
  normalizedEvidenceObjectRowIdsForProofGraph,
} from "./dev_test_game_normalized_evidence_object_rows.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  hostSetupFeatureSpineSourceCheckId,
} from "./dev_test_game_host_setup_feature_spine_targets.mjs";
import {
  devTestGameHostSetupProofCommand,
} from "./dev_test_game_production_feature_source_registry.mjs";
import {
  proofGraphAdminFeatureTargetCases,
} from "./dev_test_game_proof_graph_feature_target_cases.mjs";
import {
  productionFeatureSpineTargetProvenanceBySlotId,
} from "./dev_test_game_production_feature_spine_target_provenance.mjs";
import {
  localNextActionAdminSurfaceCheckId,
  localProofFreshnessAdminSurfaceCheckId,
  localProofGraphAdminRoleHandoffsCheckId,
} from "./dev_test_game_local_readiness_dependencies.mjs";
import {
  assertAdminAuditRelatedHandoffs,
  requiredRelatedDestinationsForHandoffs,
} from "./dev_test_game_admin_audit_handoff_contract.mjs";
import { adminProofGraphRoleHandoffs } from "./dev_test_game_proof_graph_handoffs.mjs";
import {
  adminSpineProofPath as defaultAdminSpineProofPath,
  adminSpineTerminalBatchProofPath,
  devTestGameProofGraphAdminProofPath,
  devTestGameProofGraphPath,
  devTestGameProofRunPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  hostedIdentityTerminalReceiptArtifactCase,
  normalizeProofGraphReceiptArtifactRows,
  proofGraphReceiptArtifactRowIds,
  proofGraphTerminalReceiptParentId,
} from "./dev_test_game_proof_graph_receipt_artifact_rows.mjs";
import {
  devTestGameNextActionSequenceHandoffPair,
} from "./dev_test_game_next_action_sequence_handoff_pair.mjs";
import {
  selectedOperatorHandoffTerminalReceiptId,
} from "./dev_test_game_selected_operator_handoff_receipt.mjs";
import {
  normalizeProofGraphDiagnosticProofSummary,
  proofGraphDiagnosticProofSummaryRowIds,
} from "./dev_test_game_proof_graph_diagnostic_summary.mjs";
import {
  proofGraphPrerequisiteDestinationRowIds,
} from "./dev_test_game_proof_graph_prerequisite_destination_rows.mjs";
import {
  proofGraphAdminProofDescriptor,
} from "./dev_test_game_proof_graph_admin_proof_descriptor.mjs";

const proofGraphPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_GRAPH ??
    devTestGameProofGraphPath,
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? devTestGameProofRunPath,
);
const adminSpineProofPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF ??
    defaultAdminSpineProofPath,
);
const adminSpineTerminalBatchesPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_TERMINAL_BATCHES ??
    adminSpineTerminalBatchProofPath,
);
const hostedMatrixPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX ??
    devTestGameHostedConcurrentRaceMatrixPath,
);
const hostedEvidenceLanePath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE ??
    devTestGameHostedEvidenceLaneDemoBlockedPath,
);
const proofGraphRelativePath = path.relative(repoRoot, proofGraphPath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const adminSpineProofRelativePath = path.relative(repoRoot, adminSpineProofPath);
const adminSpineTerminalBatchesRelativePath = path.relative(
  repoRoot,
  adminSpineTerminalBatchesPath,
);
const hostedMatrixRelativePath = path.relative(repoRoot, hostedMatrixPath);
const hostedEvidenceLaneRelativePath = path.relative(
  repoRoot,
  hostedEvidenceLanePath,
);
const evidencePath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_GRAPH_ADMIN_PROOF ??
    devTestGameProofGraphAdminProofPath,
);

export function proofGraphAdminProofCase() {
  return {
    smokeName: proofGraphAdminProofDescriptor.smokeName,
    stage: proofGraphAdminProofDescriptor.stage,
    evidencePath,
    envOverrides: proofGraphAdminProofEnvOverrides(),
    loadSource: loadProofGraphAdminProofSource,
    prove: async ({ browser, frontendBaseUrl, source }) => {
      return await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        ...buildProofGraphAdminProofRequirements(source),
      });
    },
    buildEvidence: ({ source, adminRoleSurface }) => ({
      version: 1,
      proof: proofGraphAdminProofDescriptor.proof,
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: proofGraphAdminProofDescriptor.scope,
      proofBoundary: proofGraphAdminProofDescriptor.proofBoundary,
      generatedFrom: buildProofGraphAdminGeneratedFrom(source),
      adminRoleSurface,
    }),
    assertEvidence: assertProofGraphAdminProof,
  };
}

export function proofGraphAdminProofEnvOverrides({
  proofGraph = proofGraphRelativePath,
  adminSpineProof = adminSpineProofRelativePath,
  adminSpineTerminalBatches = adminSpineTerminalBatchesRelativePath,
  hostedConcurrentRaceMatrix = hostedMatrixRelativePath,
  hostedEvidenceLane = hostedEvidenceLaneRelativePath,
} = {}) {
  return {
    FMARCH_DEV_TEST_GAME_PROOF_GRAPH: proofGraph,
    FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF: adminSpineProof,
    FMARCH_DEV_TEST_GAME_ADMIN_SPINE_TERMINAL_BATCHES:
      adminSpineTerminalBatches,
    FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX:
      hostedConcurrentRaceMatrix,
    FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE: hostedEvidenceLane,
  };
}

export async function loadProofGraphAdminProofSource({
  proofGraphPath: sourceProofGraphPath = proofGraphPath,
  proofRunPath: sourceProofRunPath = proofRunPath,
  adminSpineProofPath: sourceAdminSpineProofPath = adminSpineProofPath,
  adminSpineProofLabel = adminSpineProofRelativePath,
  adminSpineTerminalBatchesPath:
    sourceAdminSpineTerminalBatchesPath = adminSpineTerminalBatchesPath,
  adminSpineTerminalBatchesLabel = adminSpineTerminalBatchesRelativePath,
  hostedMatrixPath: sourceHostedMatrixPath = hostedMatrixPath,
  hostedEvidenceLanePath: sourceHostedEvidenceLanePath = hostedEvidenceLanePath,
} = {}) {
  const adminSpineProof = await readJson(sourceAdminSpineProofPath);
  const adminSpineTerminalBatches =
    await readOptionalAdminSpineTerminalBatches({
      path: sourceAdminSpineTerminalBatchesPath,
      label: adminSpineTerminalBatchesLabel,
    });
  return {
    proofGraph: assertDevTestGameProofGraph(
      await readJson(sourceProofGraphPath),
      {
        adminSpineProof,
      },
    ),
    proofRun: assertDevTestGameProofRun(await readJson(sourceProofRunPath)),
    adminSpineProof: validateDevTestGameAdminSpineProof(adminSpineProof, {
      path: adminSpineProofLabel,
    }),
    adminSpineTerminalBatches,
    hostedMatrix: assertDevTestGameHostedConcurrentRaceMatrixEvidence(
      await readJson(sourceHostedMatrixPath),
    ),
    hostedEvidenceLane: assertDevTestGameHostedEvidenceLane(
      await readJson(sourceHostedEvidenceLanePath),
    ),
  };
}

export function buildProofGraphAdminProofRequirements(source) {
  const roleHandoffs = bootstrapProofGraphAdminRoleHandoffs({
    proofGraph: source.proofGraph,
    hostedMatrix: source.hostedMatrix,
    hostedEvidenceLane: source.hostedEvidenceLane,
  });
  const coreLoopFamilyDestinations =
    proofGraphCoreLoopScenarioFamilyDestinations(source.proofGraph);
  const productionFeatureTargetDestinations =
    proofGraphProductionFeatureTargetDestinations(source.proofGraph);
  const productionFeatureDestinationSummary =
    source.proofGraph.summary.productionFeatureDestinationSummary;
  const diagnosticProofSummary = normalizeProofGraphDiagnosticProofSummary(
    source.proofGraph.summary?.diagnosticProofSummary,
    { nodes: source.proofGraph.nodes },
  );
  return {
    game: source.proofRun.session.game,
    auditId: localAdminAuditIds.proofGraph,
    requiredChecks: proofGraphVisibleCheckIds(source.proofGraph),
    requiredCheckStatuses: proofGraphVisibleCheckStatuses(source.proofGraph),
    requiredProductionFeatureDestinationSummaries:
      productionFeatureDestinationSummary.rows.map((row) => row.id),
    requiredText: ["Hosted evidence recovery ladder"],
    requiredDiagnosticProofSummaries:
      proofGraphDiagnosticProofSummaryRowIds(diagnosticProofSummary),
    requiredDiagnosticProofSummaryStatuses: Object.fromEntries(
      diagnosticProofSummary.rows.map((row) => [
        row.id,
        "non-terminal artifact",
      ]),
    ),
    requiredProofGraphPrerequisiteDestinations:
      proofGraphPrerequisiteDestinationRowIds(source.proofGraph),
    requiredRelatedLinks: source.proofGraph.nodes
      .filter(
        (node) =>
          typeof node.roleUrl === "string" && node.roleUrl.trim() !== "",
      )
      .map((node) => node.id)
      .concat(
        proofGraphIncludesTerminalBatchNode(source.proofGraph)
          ? ["next-action-sequence-handoff"]
          : [],
      ),
    requiredRelatedDestinations: [
      ...requiredRelatedDestinationsForHandoffs(roleHandoffs),
      ...coreLoopFamilyDestinations,
      ...productionFeatureTargetDestinations.filter(
        (destination) => destination.kind === "admin-audit",
      ),
      ...proofGraphNextActionHandoffDestinations(source.proofGraph),
      ...proofGraphAdminSpineTerminalReceiptDestinations(
        source.adminSpineTerminalBatches,
      ),
    ],
  };
}

export function buildProofGraphAdminGeneratedFrom(
  source,
  {
    proofGraph = proofGraphRelativePath,
    proofRun = proofRunRelativePath,
    adminSpineProof = adminSpineProofRelativePath,
    adminSpineTerminalBatches = adminSpineTerminalBatchesRelativePath,
    hostedConcurrentRaceMatrix = hostedMatrixRelativePath,
    hostedEvidenceLane = hostedEvidenceLaneRelativePath,
  } = {},
) {
  return {
    proofGraph,
    proofRun,
    adminSpineProof,
    ...(source.adminSpineTerminalBatches === null
      ? {}
      : {
          adminSpineTerminalBatches,
        }),
    hostedConcurrentRaceMatrix,
    hostedEvidenceLane,
    game: source.proofRun.session.game,
    nodeIds: source.proofGraph.nodes.map((node) => node.id),
    evidenceObjectRowIds: normalizedEvidenceObjectRowIdsForProofGraph(
      source.proofGraph,
    ),
    receiptArtifactRowIds: proofGraphReceiptArtifactRowIds(
      source.proofGraph,
    ),
    hostedIdentityTerminalReceiptArtifact:
      hostedIdentityTerminalReceiptArtifact(source.proofGraph),
    edgeRowIds: source.proofGraph.edges.map((edge) =>
      proofGraphEdgeCheckId(edge),
    ),
    edgeCount: source.proofGraph.edges.length,
    adminProofSurfaceIds: source.adminSpineProof.proofIds,
    adminProofRoleHandoffs: bootstrapProofGraphAdminRoleHandoffs({
      proofGraph: source.proofGraph,
      hostedMatrix: source.hostedMatrix,
      hostedEvidenceLane: source.hostedEvidenceLane,
    }),
    coreLoopScenarioFamilyDestinations:
      proofGraphCoreLoopScenarioFamilyDestinations(source.proofGraph),
    productionFeatureTargetDestinations:
      proofGraphProductionFeatureTargetDestinations(source.proofGraph),
    productionFeatureDestinationSummary:
      source.proofGraph.summary.productionFeatureDestinationSummary,
    manifestProductionFeatureProvenanceSummary:
      source.proofGraph.generatedFrom
        ?.manifestProductionFeatureProvenanceSummary,
    productionFeatureProvenanceComparison:
      source.proofGraph.summary.productionFeatureProvenanceComparison,
    diagnosticProofSummary: normalizeProofGraphDiagnosticProofSummary(
      source.proofGraph.summary?.diagnosticProofSummary,
      { nodes: source.proofGraph.nodes },
    ),
    proofGraphPrerequisiteDestinationRowIds:
      proofGraphPrerequisiteDestinationRowIds(source.proofGraph),
    ...(source.adminSpineTerminalBatches?.selectedOperatorHandoffReceipt
      ?.status === "passed"
      ? {
          selectedOperatorHandoffReceiptDestination:
            proofGraphSelectedOperatorHandoffReceiptDestination(
              source.adminSpineTerminalBatches
                .selectedOperatorHandoffReceipt,
            ),
        }
      : {}),
    ...proofGraphAdminSpineTerminalValidationDestinationEntry(
      source.adminSpineTerminalBatches,
    ),
    ...proofGraphAdminFeatureTargetEntries(source.proofGraph),
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(proofGraphAdminProofCase());
}

export function assertProofGraphAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== proofGraphAdminProofDescriptor.proof ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== proofGraphAdminProofDescriptor.scope ||
    evidence.proofBoundary !== proofGraphAdminProofDescriptor.proofBoundary
  ) {
    throw new Error("proof graph admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("proof graph admin proof did not prove admin overview click-through");
  }
  for (const nodeId of evidence.generatedFrom?.nodeIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(nodeId)) {
      throw new Error(`proof graph admin proof missing visible node: ${nodeId}`);
    }
  }
  for (const edgeRowId of evidence.generatedFrom?.edgeRowIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(edgeRowId)) {
      throw new Error(`proof graph admin proof missing visible edge: ${edgeRowId}`);
    }
  }
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.evidenceObjectRowIds,
    proofName: "proof graph admin proof",
    rowName: "evidence object",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.receiptArtifactRowIds,
    proofName: "proof graph admin proof",
    rowName: "receipt artifact",
  });
  if (proofGraphIncludesTerminalBatchReceipts(evidence)) {
    assertHostedIdentityTerminalReceiptArtifact(evidence);
  }
  const nodeIds = new Set(evidence.generatedFrom?.nodeIds ?? []);
  for (const surfaceId of evidence.generatedFrom?.adminProofSurfaceIds ?? []) {
    if (!nodeIds.has(`admin-proof:${surfaceId}`)) {
      throw new Error(`proof graph admin proof missing generated admin node: ${surfaceId}`);
    }
  }
  if (!Array.isArray(evidence.adminRoleSurface?.visibleRelatedLinks)) {
    throw new Error("proof graph admin proof did not prove related links");
  }
  for (const handoff of evidence.generatedFrom?.adminProofRoleHandoffs ?? []) {
    if (!evidence.adminRoleSurface.visibleRelatedLinks.includes(handoff.linkId)) {
      throw new Error(`proof graph admin proof missing related link: ${handoff.linkId}`);
    }
  }
  if (
    proofGraphIncludesTerminalBatchReceipts(evidence) &&
    !evidence.adminRoleSurface.visibleRelatedLinks.includes(
      "next-action-sequence-handoff",
    )
  ) {
    throw new Error("proof graph admin proof missing next-action handoff link");
  }
  assertProofGraphAdminProofCoversSelectedOperatorHandoffReceipt(evidence);
  assertProofGraphAdminProofCoversAdminSpineTerminalValidations(evidence);
  assertAdminAuditRelatedHandoffs({
    adminRoleSurface: evidence.adminRoleSurface,
    handoffs: evidence.generatedFrom?.adminProofRoleHandoffs,
    proofName: "proof graph admin proof",
  });
  assertProofGraphAdminProofCoversCoreLoopScenarioFamilies(evidence);
  assertProofGraphAdminProofCoversProductionFeatureDestinations(evidence);
  assertProofGraphAdminProofCoversProductionFeatureDestinationSummary(evidence);
  assertProofGraphAdminProofCoversProductionFeatureProvenanceComparison(evidence);
  assertProofGraphAdminProofCoversDiagnosticProofSummary(evidence);
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.proofGraphPrerequisiteDestinationRowIds,
    proofName: "proof graph admin proof",
    rowName: "proof graph prerequisite destination",
    surfaceKey: "visibleProofGraphPrerequisiteDestinations",
  });
  for (const featureTargetCase of proofGraphAdminFeatureTargetCases) {
    assertProofGraphAdminProofCoversFeatureTarget(evidence, featureTargetCase);
  }
  return evidence;
}

async function readOptionalAdminSpineTerminalBatches({
  path: sourcePath = adminSpineTerminalBatchesPath,
  label = adminSpineTerminalBatchesRelativePath,
} = {}) {
  let payload;
  try {
    payload = await readJson(sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return validateDevTestGameAdminSpineTerminalBatches(payload, {
    path: label,
  });
}

function assertProofGraphAdminProofCoversProductionFeatureProvenanceComparison(
  evidence,
) {
  assertProofGraphProductionFeatureProvenanceComparison(
    evidence.generatedFrom?.productionFeatureProvenanceComparison,
    {
      manifestSummary:
        evidence.generatedFrom?.manifestProductionFeatureProvenanceSummary,
      destinationSummary:
        evidence.generatedFrom?.productionFeatureDestinationSummary,
      destinations:
        evidence.generatedFrom?.productionFeatureTargetDestinations ?? [],
      requirePassed: true,
    },
  );
}

function assertProofGraphAdminProofCoversDiagnosticProofSummary(evidence) {
  const summary = evidence.generatedFrom?.diagnosticProofSummary;
  const rows = Array.isArray(summary?.rows) ? summary.rows : [];
  if (
    summary?.id !== "diagnostic-non-terminal" ||
    summary.diagnosticCount !== rows.length ||
    summary.promotesFreshnessCount !== 0 ||
    summary.terminalArtifactCount !== 0
  ) {
    throw new Error("proof graph admin proof diagnostic summary drifted");
  }
  for (const row of rows) {
    if (
      row.promotesFreshness !== false ||
      row.terminalArtifact !== false ||
      row.diagnosticReason === "" ||
      row.artifact === "" ||
      row.proofCommand === "" ||
      row.recoveryCommand === ""
    ) {
      throw new Error(
        `proof graph admin proof diagnostic row is not non-terminal: ${row.id}`,
      );
    }
    if (
      !evidence.adminRoleSurface
        ?.visibleDiagnosticProofSummaries?.includes(row.id)
    ) {
      throw new Error(
        `proof graph admin proof missing diagnostic summary row: ${row.id}`,
      );
    }
    const visibleStatus =
      evidence.adminRoleSurface?.visibleDiagnosticProofSummaryStatuses?.[
        row.id
      ] ?? "";
    for (const token of [
      row.status,
      row.diagnosticReason,
      row.artifact,
      "non-freshness-promoting",
      "non-terminal artifact",
    ]) {
      if (!visibleStatus.includes(token)) {
        throw new Error(
          `proof graph admin proof diagnostic summary row missing ${token}: ${row.id}`,
        );
      }
    }
  }
}

function assertProofGraphAdminProofCoversProductionFeatureDestinations(evidence) {
  const productionNodeIds = new Set(
    (evidence.generatedFrom?.nodeIds ?? []).filter((id) =>
      String(id).startsWith("production-feature:"),
    ),
  );
  const destinations =
    evidence.generatedFrom?.productionFeatureTargetDestinations ?? [];
  if (destinations.length !== productionNodeIds.size) {
    throw new Error(
      "proof graph admin proof production feature destination count drifted",
    );
  }
  assertProofGraphAdminProductionFeatureDestinationsMatchProvenance(
    destinations,
  );
  for (const destination of destinations) {
    if (
      !productionNodeIds.has(destination.linkId) ||
      !evidence.adminRoleSurface?.visibleRelatedLinks?.includes(
        destination.linkId,
      )
    ) {
      throw new Error(
        `proof graph admin proof missing production feature related link: ${destination.linkId}`,
      );
    }
    if (destination.kind !== "admin-audit") {
      if (
        destination.kind !== "role-url" ||
        typeof destination.roleUrl !== "string" ||
        destination.roleUrl.trim() === "" ||
        destination.targetRoleUrl !== destination.roleUrl
      ) {
        throw new Error(
          `proof graph admin proof has malformed production feature role destination: ${destination.linkId}`,
        );
      }
      if (
        destination.sourceCheckId === hostSetupFeatureSpineSourceCheckId &&
        !validHostSetupProductionFeatureDestination(destination)
      ) {
        throw new Error(
          `proof graph admin proof has malformed host setup production feature destination: ${destination.linkId}`,
        );
      }
      if (
        destination.sourceCheckId !== hostSetupFeatureSpineSourceCheckId &&
        !validRoleUrlProductionFeatureDestination(destination)
      ) {
        throw new Error(
          `proof graph admin proof has malformed role URL workbench production feature destination: ${destination.linkId}`,
        );
      }
      continue;
    }
    const visibleDestination =
      evidence.adminRoleSurface?.visibleRelatedDestinations?.find(
        (candidate) =>
          candidate.linkId === destination.linkId &&
          candidate.auditId === destination.auditId,
      );
    if (
      visibleDestination?.detailRoleUrl !== destination.detailRoleUrl ||
      !visibleDestination.visibleChecks?.includes(destination.adminCheckId)
    ) {
      throw new Error(
        `proof graph admin proof did not inspect production feature destination: ${destination.linkId}`,
      );
    }
  }
}

function assertProofGraphAdminProductionFeatureDestinationsMatchProvenance(
  destinations,
) {
  for (const destination of destinations) {
    const provenanceCase =
      productionFeatureSpineTargetProvenanceBySlotId[destination.featureSlotId];
    if (
      provenanceCase === undefined ||
      destination.linkId !==
        `production-feature:${provenanceCase.featureSlotId}` ||
      destination.sourceCheckId !== provenanceCase.sourceCheckId ||
      destination.adminCheckId !== provenanceCase.adminCheckId ||
      destination.sourceProofArtifact !== provenanceCase.proofArtifact ||
      !String(destination.targetRoleUrl ?? "").includes(
        provenanceCase.roleUrlIncludes,
      )
    ) {
      throw new Error(
        [
          "proof graph admin proof production feature provenance drifted",
          destination.featureSlotId,
          `linkId=${destination?.linkId ?? ""}`,
          `sourceCheckId=${destination?.sourceCheckId ?? ""}`,
          `adminCheckId=${destination?.adminCheckId ?? ""}`,
          `sourceProofArtifact=${destination?.sourceProofArtifact ?? ""}`,
          `targetRoleUrl=${destination?.targetRoleUrl ?? ""}`,
        ].join(": "),
      );
    }
  }
}

function validHostSetupProductionFeatureDestination(destination) {
  return (
    destination.featureSlotId === "host-setup-route" &&
    destination.adminCheckId === "start-phase" &&
    destination.adminDetailRoleUrl ===
      localAdminAuditRoleUrl(localAdminAuditIds.hostSetupProof) &&
    destination.recoveryCommand === devTestGameHostSetupProofCommand &&
    destination.readinessEvidence === "target/dev-test-game/host-setup-proof.json" &&
    destination.browserWorkbench?.status === "passed" &&
    destination.browserWorkbench.route === "/g/<seeded-game>/setup" &&
    destination.browserWorkbench.roleUrl === destination.targetRoleUrl &&
    destination.browserWorkbench.roleSurface === "host-setup" &&
    typeof destination.browserWorkbench.requiredEvidence === "string" &&
    destination.browserWorkbench.requiredEvidence.includes(
      "setup workbench browser surface",
    )
  );
}

function validRoleUrlProductionFeatureDestination(destination) {
  return (
    destination.readinessEvidence === destination.sourceProofArtifact &&
    destination.browserWorkbench !== null &&
    typeof destination.browserWorkbench === "object" &&
    destination.browserWorkbench.status === "passed" &&
    destination.browserWorkbench.roleUrl === destination.roleUrl &&
    destination.browserWorkbench.featureSlotId === destination.featureSlotId &&
    typeof destination.browserWorkbench.requiredEvidence === "string" &&
    destination.browserWorkbench.requiredEvidence.trim() !== ""
  );
}

function assertProofGraphAdminProofCoversProductionFeatureDestinationSummary(
  evidence,
) {
  const summary = evidence.generatedFrom?.productionFeatureDestinationSummary;
  const destinations =
    evidence.generatedFrom?.productionFeatureTargetDestinations ?? [];
  if (
    summary?.status !== "passed" ||
    summary.totalDestinationCount !== destinations.length ||
    summary.productionFeatureTargetCount !== destinations.length ||
    summary.adminAuditDestinationCount !==
      destinations.filter((destination) => destination.kind === "admin-audit")
        .length ||
    summary.roleUrlDestinationCount !==
      destinations.filter((destination) => destination.kind === "role-url")
        .length
  ) {
    throw new Error(
      "proof graph admin proof production feature destination summary drifted",
    );
  }
  assertProductionFeatureDestinationSummaryCoversHostedEvidenceProgressions(
    summary,
  );
  for (const row of summary.rows ?? []) {
    if (
      !evidence.adminRoleSurface
        ?.visibleProductionFeatureDestinationSummaries?.includes(row.id)
    ) {
      throw new Error(
        `proof graph admin proof missing production feature destination summary row: ${row.id}`,
      );
    }
    const visibleStatus =
      evidence.adminRoleSurface?.visibleProductionFeatureDestinationSummaryStatuses?.[
        row.id
      ] ?? "";
    if (!visibleProductionFeatureDestinationSummaryText(row, visibleStatus)) {
      throw new Error(
        `proof graph admin proof production feature destination summary text drifted: ${row.id}`,
      );
    }
  }
}

function assertProductionFeatureDestinationSummaryCoversHostedEvidenceProgressions(
  summary,
) {
  const expectedSummary = hostedEvidenceProgressionHandoffSummary();
  if (
    JSON.stringify(summary.hostedEvidenceProgressionSummary ?? null) !==
    JSON.stringify(expectedSummary)
  ) {
    throw new Error(
      "proof graph admin proof hosted evidence progression summary drifted",
    );
  }
  for (const progression of expectedSummary.progressions) {
    const rowId = `hosted-evidence-progression:${progression.id}`;
    const row = (summary.rows ?? []).find((candidate) => candidate.id === rowId);
    if (
      row?.progressionId !== progression.id ||
      row.proofCommand !== progression.proofCommand ||
      row.evidencePath !== progression.evidencePath ||
      row.adminProofTarget !== progression.adminProofTarget ||
      row.roleUrl !== progression.roleUrl ||
      row.firstMissingInputId !== progression.firstMissingInputId ||
      row.firstMissingCheckId !== progression.firstMissingCheckId
    ) {
      throw new Error(
        `proof graph admin proof hosted evidence progression row drifted: ${progression.id}`,
      );
    }
  }
}

function visibleProductionFeatureDestinationSummaryText(row, visibleStatus) {
  return [row.label, ...String(row.status ?? "").split("\n")]
    .map((token) => String(token ?? "").trim())
    .filter((token) => token !== "")
    .every((token) => String(visibleStatus ?? "").includes(token));
}

function assertProofGraphAdminProofCoversCoreLoopScenarioFamilies(evidence) {
  for (const destination of
    evidence.generatedFrom?.coreLoopScenarioFamilyDestinations ?? []) {
    if (
      !evidence.adminRoleSurface?.visibleRelatedLinks?.includes(
        destination.linkId,
      )
    ) {
      throw new Error(
        `proof graph admin proof missing core-loop family related link: ${destination.linkId}`,
      );
    }
    const visibleDestination =
      evidence.adminRoleSurface?.visibleRelatedDestinations?.find(
        (candidate) =>
          candidate.linkId === destination.linkId &&
          candidate.auditId === localAdminAuditIds.coreLoop,
      );
    if (
      visibleDestination?.detailRoleUrl !==
        `/admin/audit/${localAdminAuditIds.coreLoop}?game=<seeded-game>` ||
      !visibleDestination.visibleScenarioFamilies?.includes(
        destination.familyId,
      )
    ) {
      throw new Error(
        `proof graph admin proof did not inspect core-loop family destination: ${destination.familyId}`,
      );
    }
    const visibleText =
      visibleDestination.visibleScenarioFamilyText?.[destination.familyId] ?? "";
    for (const token of destination.requiredScenarioFamilyText?.[
      destination.familyId
    ] ?? []) {
      if (!visibleText.includes(token)) {
        throw new Error(
          `proof graph admin proof missing core-loop family destination text: ${destination.familyId} ${token}`,
        );
      }
    }
  }
}

function assertProofGraphAdminProofCoversFeatureTarget(
  evidence,
  featureTargetCase,
) {
  const target =
    evidence.generatedFrom?.[featureTargetCase.generatedFromKey];
  const expectedFeatureSlotId = featureTargetCase.targetRow.featureSlotId;
  if (
    target?.roleSurfaceNodeId !== featureTargetCase.source.graphSourceNodeId ||
    target.productionFeatureNodeId !==
      `production-feature:${expectedFeatureSlotId}` ||
    target.sourceCheckId !== featureTargetCase.source.sourceCheckId ||
    target.featureSlotId !== expectedFeatureSlotId ||
    !target.roleUrl?.includes(featureTargetCase.source.roleUrlIncludes) ||
    target.targetRoleUrl !== target.roleUrl ||
    target.checkpointId !== featureTargetCase.targetRow.checkpointId ||
    target.adminCheckId !== featureTargetCase.targetRow.adminCheckId ||
    !target.browserProofCommand?.includes("test:dev-test-game-core-live") ||
    target.sourceProofArtifact !== featureTargetCase.source.proofArtifact ||
    target.recoveryCommand !== featureTargetCase.source.rerunCommand ||
    JSON.stringify(target.coverageDecision ?? null) !==
      JSON.stringify(featureTargetCase.source.coverageDecision ?? null)
  ) {
    throw new Error(
      `proof graph admin proof missing ${featureTargetCase.label} feature target`,
    );
  }
  for (const rowId of [
    target.roleSurfaceNodeId,
    target.productionFeatureNodeId,
    target.edgeRowId,
    `coverage-decision:${target.productionFeatureNodeId}`,
  ]) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(rowId)) {
      throw new Error(
        `proof graph admin proof missing ${featureTargetCase.label} row: ${rowId}`,
      );
    }
  }
  for (const linkId of [
    target.roleSurfaceNodeId,
    target.productionFeatureNodeId,
  ]) {
    if (!evidence.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(
        `proof graph admin proof missing ${featureTargetCase.label} related link: ${linkId}`,
      );
    }
  }
}

function proofGraphEdgeCheckId(edge) {
  return `edge:${String(edge?.from ?? "")}:${String(
    edge?.relationship ?? "related",
  )}:${String(edge?.to ?? "")}`;
}

function proofGraphVisibleCheckIds(proofGraph) {
  return [
    ...proofGraph.nodes.map((node) => node.id),
    ...proofGraph.nodes.flatMap((node) =>
      node.coverageDecision === undefined
        ? []
        : [`coverage-decision:${node.id}`],
    ),
    ...normalizedEvidenceObjectRowIdsForProofGraph(proofGraph),
    ...proofGraphReceiptArtifactRowIds(proofGraph),
    ...proofGraph.edges.map((edge) => proofGraphEdgeCheckId(edge)),
  ];
}

function proofGraphVisibleCheckStatuses(proofGraph) {
  const hostedIdentityReceipt = hostedIdentityTerminalReceiptArtifact(proofGraph);
  const commandProofRoleUrlAuditStatuses = Object.fromEntries(
    proofGraph.nodes
      .filter(
        (node) =>
          node.kind === "command-proof-role-url-audit" &&
          typeof node.checkedCount === "number",
      )
      .map((node) => [node.id, `${node.checkedCount} checked`]),
  );
  const selectedOperatorHandoffEdgeStatuses = Object.fromEntries(
    proofGraph.edges
      .filter(
        (edge) =>
          edge.relationship === "selected-operator-handoff" &&
          typeof edge.firstMissingInputId === "string" &&
          edge.firstMissingInputId.trim() !== "",
      )
      .map((edge) => [
        proofGraphEdgeCheckId(edge),
        edge.firstMissingInputId,
      ]),
  );
  return {
    ...(hostedIdentityReceipt === null
      ? {}
      : { [hostedIdentityReceipt.rowId]: hostedIdentityReceipt.status }),
    ...commandProofRoleUrlAuditStatuses,
    ...selectedOperatorHandoffEdgeStatuses,
  };
}

function hostedIdentityTerminalReceiptArtifact(proofGraph) {
  return (
    normalizeProofGraphReceiptArtifactRows({
      parentId: proofGraphTerminalReceiptParentId,
      artifacts: proofGraph.nodes.find(
        (node) => node.id === proofGraphTerminalReceiptParentId,
      )?.receiptArtifacts,
    }).find(
      (artifact) =>
        artifact.proofId === hostedIdentityTerminalReceiptArtifactCase.proofId &&
        artifact.artifactPath ===
          hostedIdentityTerminalReceiptArtifactCase.artifactPath &&
        artifact.batchLabel ===
          hostedIdentityTerminalReceiptArtifactCase.batchLabel,
    ) ?? null
  );
}

function assertHostedIdentityTerminalReceiptArtifact(evidence) {
  const artifact = evidence.generatedFrom?.hostedIdentityTerminalReceiptArtifact;
  if (
    artifact?.rowId !== hostedIdentityTerminalReceiptArtifactCase.rowId ||
    artifact.proofId !== hostedIdentityTerminalReceiptArtifactCase.proofId ||
    artifact.artifactPath !==
      hostedIdentityTerminalReceiptArtifactCase.artifactPath ||
    artifact.batchLabel !== hostedIdentityTerminalReceiptArtifactCase.batchLabel ||
    artifact.status !== hostedIdentityTerminalReceiptArtifactCase.status
  ) {
    throw new Error(
      "proof graph admin proof missing hosted identity terminal receipt metadata",
    );
  }
  const visibleStatus =
    evidence.adminRoleSurface?.visibleCheckStatuses?.[artifact.rowId];
  if (
    typeof visibleStatus !== "string" ||
    !visibleStatus.includes(hostedIdentityTerminalReceiptArtifactCase.status)
  ) {
    throw new Error(
      "proof graph admin proof did not inspect hosted identity terminal receipt row",
    );
  }
}

function proofGraphIncludesTerminalBatchReceipts(evidence) {
  return (evidence.generatedFrom?.nodeIds ?? []).includes(
    proofGraphTerminalReceiptParentId,
  );
}

function proofGraphIncludesTerminalBatchNode(proofGraph) {
  return proofGraph.nodes.some(
    (node) => node.id === proofGraphTerminalReceiptParentId,
  );
}

function proofGraphNextActionHandoffDestinations(proofGraph) {
  if (!proofGraphIncludesTerminalBatchNode(proofGraph)) {
    return [];
  }
  const pair = devTestGameNextActionSequenceHandoffPair();
  return [
    {
      linkId: "next-action-sequence-handoff",
      auditId: localAdminAuditIds.nextAction,
      detailRoleUrl:
        `/admin/audit/${localAdminAuditIds.nextAction}?game=<seeded-game>`,
      requiredChecks: [pair.id],
      requiredCheckStatuses: {
        [pair.id]: [
          pair.defaultSequenceBlocker.status,
          pair.hostedIdentityPredicate.status,
        ].join(":"),
      },
      requiredNextActionHandoffPairRows: [
        "summary",
        pair.defaultSequenceBlocker.id,
        pair.hostedIdentityPredicate.id,
      ],
      requiredNextActionHandoffPairRowStatuses: {
        summary: pair.proofBoundary,
        [pair.defaultSequenceBlocker.id]: [
          pair.defaultSequenceBlocker.expectedReason,
          pair.defaultSequenceBlocker.expectedActionStatus,
        ].join("\n"),
        [pair.hostedIdentityPredicate.id]: [
          pair.hostedIdentityPredicate.expectedReason,
          pair.hostedIdentityPredicate.expectedActionStatus,
        ].join("\n"),
      },
    },
  ];
}

function proofGraphAdminSpineTerminalReceiptDestinations(
  adminSpineTerminalBatches,
) {
  const destination = proofGraphAdminSpineTerminalReceiptDestination(
    adminSpineTerminalBatches,
  );
  return destination === null ? [] : [destination];
}

function proofGraphAdminSpineTerminalReceiptDestination(
  adminSpineTerminalBatches,
) {
  const receipt = adminSpineTerminalBatches?.selectedOperatorHandoffReceipt;
  const terminalValidationDestination =
    proofGraphAdminSpineTerminalValidationDestination(
      adminSpineTerminalBatches,
    );
  if (receipt?.status !== "passed" && terminalValidationDestination === null) {
    return null;
  }
  return {
    linkId: "admin-spine-terminal-batches",
    auditId: localAdminAuditIds.adminSpine,
    detailRoleUrl:
      `/admin/audit/${localAdminAuditIds.adminSpine}?game=<seeded-game>`,
    ...(receipt?.status === "passed"
      ? proofGraphSelectedOperatorHandoffReceiptDestinationFields(receipt)
      : {}),
    ...(terminalValidationDestination ?? {}),
  };
}

function proofGraphSelectedOperatorHandoffReceiptDestination(receipt) {
  return {
    linkId: "admin-spine-terminal-batches",
    auditId: localAdminAuditIds.adminSpine,
    detailRoleUrl:
      `/admin/audit/${localAdminAuditIds.adminSpine}?game=<seeded-game>`,
    ...proofGraphSelectedOperatorHandoffReceiptDestinationFields(receipt),
  };
}

function proofGraphSelectedOperatorHandoffReceiptDestinationFields(receipt) {
  return {
    selectedOperatorHandoffReceiptId: receipt.id,
    selectedOperatorHandoffReceiptStatus: receipt.status,
    requiredSelectedOperatorHandoffTerminalReceiptRows: [
      "receipt",
      "selected",
      "edge",
      "readiness-link",
    ],
    requiredSelectedOperatorHandoffTerminalReceiptRowStatuses: {
      receipt: [
        receipt.status,
        receipt.id,
        receipt.proofBoundary,
        receipt.sourceArtifacts.nextAction,
        receipt.sourceArtifacts.nextActionAdminProof,
        receipt.sourceArtifacts.proofGraph,
        receipt.sourceArtifacts.releaseReadiness,
      ].join("\n"),
      selected: [
        receipt.selectedOperatorHandoff.status,
        receipt.selectedOperatorHandoff.command,
        receipt.selectedOperatorHandoff.firstMissingInputId,
        receipt.selectedOperatorHandoff.selectedProductionFeatureGraphNodeId,
      ].join("\n"),
      edge: [
        receipt.proofGraphEdge.from,
        receipt.proofGraphEdge.relationship,
        receipt.proofGraphEdge.to,
        receipt.proofGraphEdge.firstMissingInputId,
      ].join("\n"),
      "readiness-link": [
        receipt.readinessRelatedLink.id,
        receipt.readinessRelatedLink.sourceAuditId,
        receipt.readinessRelatedLink.destinationAuditId,
        receipt.readinessRelatedLink.status,
        receipt.readinessRelatedLink.command,
      ].join("\n"),
    },
  };
}

function proofGraphAdminSpineTerminalValidationDestinationEntry(
  adminSpineTerminalBatches,
) {
  const destination = proofGraphAdminSpineTerminalValidationDestination(
    adminSpineTerminalBatches,
  );
  return destination === null
    ? {}
    : { adminSpineTerminalValidationDestination: destination };
}

function proofGraphAdminSpineTerminalValidationDestination(
  adminSpineTerminalBatches,
) {
  const terminalValidations = adminSpineTerminalValidations(
    adminSpineTerminalBatches,
  );
  if (terminalValidations.length === 0) {
    return null;
  }
  return {
    linkId: "admin-spine-terminal-batches",
    auditId: localAdminAuditIds.adminSpine,
    detailRoleUrl:
      `/admin/audit/${localAdminAuditIds.adminSpine}?game=<seeded-game>`,
    terminalValidationIds: terminalValidations.map(
      (validation) => validation.id,
    ),
    terminalValidationArtifacts: terminalValidations.map((validation) => ({
      id: validation.id,
      artifactPath: validation.artifactPath,
      validatesArtifacts: validation.validatesArtifacts,
      localDiagnosticCount: validation.localDiagnosticCount,
    })),
    terminalValidationCommands: terminalValidations.map((validation) => ({
      id: validation.id,
      command: validation.command,
    })),
    requiredAdminSpineTerminalValidations: terminalValidations.map(
      (validation) => validation.id,
    ),
    requiredAdminSpineTerminalValidationStatuses: Object.fromEntries(
      terminalValidations.map((validation) => [
        validation.id,
        validation.status,
      ]),
    ),
  };
}

function adminSpineTerminalValidations(adminSpineTerminalBatches) {
  return Array.isArray(adminSpineTerminalBatches?.terminalValidations)
    ? adminSpineTerminalBatches.terminalValidations
    : [];
}

function assertProofGraphAdminProofCoversSelectedOperatorHandoffReceipt(
  evidence,
) {
  const destination =
    evidence.generatedFrom?.selectedOperatorHandoffReceiptDestination;
  if (destination === undefined) {
    return;
  }
  if (
    destination.selectedOperatorHandoffReceiptId !==
      selectedOperatorHandoffTerminalReceiptId ||
    destination.selectedOperatorHandoffReceiptStatus !== "passed" ||
    destination.linkId !== "admin-spine-terminal-batches" ||
    destination.auditId !== localAdminAuditIds.adminSpine
  ) {
    throw new Error(
      "proof graph admin proof selected operator receipt destination drifted",
    );
  }
  const visibleDestination =
    evidence.adminRoleSurface?.visibleRelatedDestinations?.find(
      (candidate) =>
        candidate.linkId === destination.linkId &&
        candidate.auditId === destination.auditId,
    );
  if (
    visibleDestination?.detailRoleUrl !== destination.detailRoleUrl ||
    !sameStringArray(
      visibleDestination.visibleSelectedOperatorHandoffTerminalReceiptRows,
      destination.requiredSelectedOperatorHandoffTerminalReceiptRows,
    ) ||
    JSON.stringify(
      visibleDestination
        .visibleSelectedOperatorHandoffTerminalReceiptRowStatuses ?? {},
    ) !==
      JSON.stringify(
        destination.requiredSelectedOperatorHandoffTerminalReceiptRowStatuses,
      )
  ) {
    throw new Error(
      "proof graph admin proof did not inspect selected operator handoff receipt",
    );
  }
}

function assertProofGraphAdminProofCoversAdminSpineTerminalValidations(evidence) {
  const destination =
    evidence.generatedFrom?.adminSpineTerminalValidationDestination;
  if (destination === undefined) {
    return;
  }
  if (
    destination.linkId !== "admin-spine-terminal-batches" ||
    destination.auditId !== localAdminAuditIds.adminSpine ||
    destination.detailRoleUrl !==
      `/admin/audit/${localAdminAuditIds.adminSpine}?game=<seeded-game>` ||
    !Array.isArray(destination.requiredAdminSpineTerminalValidations) ||
    destination.requiredAdminSpineTerminalValidations.length === 0
  ) {
    throw new Error("proof graph admin proof terminal validation destination drifted");
  }
  const visibleDestination =
    evidence.adminRoleSurface?.visibleRelatedDestinations?.find(
      (candidate) =>
        candidate.linkId === destination.linkId &&
        candidate.auditId === destination.auditId,
    );
  if (
    visibleDestination?.detailRoleUrl !== destination.detailRoleUrl ||
    !sameStringArray(
      visibleDestination.visibleAdminSpineTerminalValidations,
      destination.requiredAdminSpineTerminalValidations,
    )
  ) {
    throw new Error(
      "proof graph admin proof did not inspect admin spine terminal validations",
    );
  }
  const visibleStatuses =
    visibleDestination.visibleAdminSpineTerminalValidationStatuses ?? {};
  const expectedStatuses =
    destination.requiredAdminSpineTerminalValidationStatuses ?? {};
  for (const validationId of destination.requiredAdminSpineTerminalValidations) {
    const visibleStatus = visibleStatuses[validationId] ?? "";
    const expectedStatus = expectedStatuses[validationId] ?? "";
    const command =
      destination.terminalValidationCommands?.find(
        (validation) => validation.id === validationId,
      )?.command ?? "";
    const artifact =
      destination.terminalValidationArtifacts?.find(
        (validation) => validation.id === validationId,
      ) ?? {};
    const requiredTokens = [
      expectedStatus,
      command,
      artifact.artifactPath,
      ...(artifact.localDiagnosticCount === undefined
        ? []
        : [`${artifact.localDiagnosticCount} diagnostics`]),
      ...(artifact.validatesArtifacts ?? []),
    ].filter((token) => String(token).trim() !== "");
    for (const token of requiredTokens) {
      if (!visibleStatus.includes(token)) {
        throw new Error(
          `proof graph admin proof terminal validation row missing ${token}: ${validationId}`,
        );
      }
    }
  }
}

function sameStringArray(actual, expected) {
  return JSON.stringify(actual ?? []) === JSON.stringify(expected ?? []);
}

function proofGraphAdminFeatureTargetEntries(proofGraph) {
  return Object.fromEntries(
    proofGraphAdminFeatureTargetCases.map((featureTargetCase) => [
      featureTargetCase.generatedFromKey,
      proofGraphFeatureTarget(proofGraph, featureTargetCase),
    ]),
  );
}

function proofGraphCoreLoopScenarioFamilyDestinations(proofGraph) {
  const nodesByFamilyId = new Map(
    proofGraph.nodes
      .filter((node) => node.kind === "core-loop-scenario-family")
      .map((node) => [node.familyId, node]),
  );
  return coreLoopScenarioFamilyRows().map((family) => {
    const node = nodesByFamilyId.get(family.id);
    if (node === undefined) {
      throw new Error(
        `proof graph missing core-loop scenario family: ${family.id}`,
      );
    }
    return {
      linkId: node.id,
      auditId: localAdminAuditIds.coreLoop,
      detailRoleUrl: `/admin/audit/${localAdminAuditIds.coreLoop}?game=<seeded-game>`,
      familyId: family.id,
      requiredScenarioFamilies: [family.id],
      requiredScenarioFamilyText: {
        [family.id]: coreLoopScenarioFamilyTextTokens(family),
      },
    };
  });
}

function coreLoopScenarioFamilyTextTokens(family) {
  return [
    family.label,
    family.status,
    ...family.laneIds,
    ...family.surfaces,
    ...family.staleRejects,
    ...family.reloads,
    ...family.scenarios,
    ...family.transitionTokens,
  ].filter((token) => String(token ?? "") !== "");
}

function proofGraphFeatureTarget(proofGraph, featureTargetCase) {
  const roleSurfaceNodeId = featureTargetCase.source.graphSourceNodeId;
  const expectedFeatureSlotId = featureTargetCase.targetRow.featureSlotId;
  const roleSurfaceNode = proofGraph.nodes.find(
    (node) => node.id === roleSurfaceNodeId,
  );
  const productionFeatureNode = proofGraph.nodes.find(
    (node) => node.id === `production-feature:${expectedFeatureSlotId}`,
  );
  const edge = proofGraph.edges.find(
    (candidate) =>
      candidate.from === roleSurfaceNodeId &&
      candidate.to === `production-feature:${expectedFeatureSlotId}` &&
      candidate.relationship === "proves-production-feature",
  );
  if (
    roleSurfaceNode === undefined ||
    productionFeatureNode === undefined ||
    edge === undefined
  ) {
    throw new Error(
      `proof graph missing ${featureTargetCase.label} feature target`,
    );
  }
  return {
    roleSurfaceNodeId: roleSurfaceNode.id,
    productionFeatureNodeId: productionFeatureNode.id,
    edgeRowId: proofGraphEdgeCheckId(edge),
    sourceCheckId: productionFeatureNode.sourceCheckId,
    featureSlotId: productionFeatureNode.featureSlotId,
    roleUrl: productionFeatureNode.roleUrl,
    targetRoleUrl: productionFeatureNode.targetRoleUrl,
    checkpointId: productionFeatureNode.checkpointId,
    adminCheckId: productionFeatureNode.adminCheckId,
    browserProofCommand: productionFeatureNode.browserProofCommand,
    sourceProofArtifact: productionFeatureNode.sourceProofArtifact,
    recoveryCommand: productionFeatureNode.recoveryCommand,
    coverageDecision: productionFeatureNode.coverageDecision,
  };
}

function bootstrapProofGraphAdminRoleHandoffs({
  proofGraph,
  hostedMatrix,
  hostedEvidenceLane,
}) {
  return adminProofGraphRoleHandoffs({
    proofGraph,
    hostedMatrix,
    hostedEvidenceLane,
  }).map(bootstrapProofGraphAdminRoleHandoff);
}

function bootstrapProofGraphAdminRoleHandoff(handoff) {
  if (handoff.linkId === "admin-proof:release") {
    return releaseReadinessBootstrapHandoff(handoff);
  }
  if (handoff.linkId === "admin-proof:release-runbook") {
    return releaseRunbookBootstrapHandoff(handoff);
  }
  return handoff;
}

function releaseReadinessBootstrapHandoff(handoff) {
  const bootstrapIds = new Set([
    localProofGraphAdminRoleHandoffsCheckId,
    localProofFreshnessAdminSurfaceCheckId,
    localNextActionAdminSurfaceCheckId,
  ]);
  return {
    ...handoff,
    requiredCheckIds: (handoff.requiredCheckIds ?? []).filter(
      (id) => !bootstrapIds.has(id),
    ),
    requiredLocalPrerequisiteDestinations: (
      handoff.requiredLocalPrerequisiteDestinations ?? []
    ).filter((item) => !bootstrapIds.has(item.id)),
  };
}

function releaseRunbookBootstrapHandoff(handoff) {
  return {
    ...handoff,
    requiredUnprovenIds: [],
  };
}
