import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameProofGraph } from "./dev_test_game_proof_graph.mjs";
import {
  coreLoopScenarioFamilyRows,
} from "./dev_test_game_core_loop_generated_from_families.mjs";
import {
  proofGraphProductionFeatureTargetDestinations,
} from "./dev_test_game_proof_graph_production_feature_destinations.mjs";
import { validateDevTestGameAdminSpineProof } from "./dev_test_game_release_readiness.mjs";
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
  assertVisibleAdminRoleSurfaceRows,
  artifactDir,
  normalizedEvidenceObjectRowIds,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";
import {
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  proofGraphAdminFeatureTargetCases,
} from "./dev_test_game_proof_graph_feature_target_cases.mjs";
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
  devTestGameProofGraphPath,
  devTestGameProofRunPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  hostedIdentityTerminalReceiptArtifactCase,
  normalizeProofGraphReceiptArtifactRows,
  proofGraphTerminalReceiptParentId,
} from "./dev_test_game_proof_graph_receipt_artifact_rows.mjs";
import {
  devTestGameNextActionSequenceHandoffPair,
} from "./dev_test_game_next_action_sequence_handoff_pair.mjs";
import {
  normalizeProofGraphDiagnosticProofSummary,
} from "./dev_test_game_proof_graph_diagnostic_summary.mjs";

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
const hostedMatrixRelativePath = path.relative(repoRoot, hostedMatrixPath);
const hostedEvidenceLaneRelativePath = path.relative(
  repoRoot,
  hostedEvidenceLanePath,
);
const evidencePath = path.join(artifactDir, "proof-graph-admin-proof.json");

export function proofGraphAdminProofCase() {
  return {
    smokeName: "dev-test-game-proof-graph-admin-proof",
    stage: "proof-graph-admin-proof-listen",
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_PROOF_GRAPH: proofGraphRelativePath,
      FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF: adminSpineProofRelativePath,
      FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX:
        hostedMatrixRelativePath,
      FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE: hostedEvidenceLaneRelativePath,
    },
    loadSource: async () => {
      const adminSpineProof = await readJson(adminSpineProofPath);
      return {
        proofGraph: assertDevTestGameProofGraph(await readJson(proofGraphPath), {
          adminSpineProof,
        }),
        proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
        adminSpineProof: validateDevTestGameAdminSpineProof(adminSpineProof, {
          path: adminSpineProofRelativePath,
        }),
        hostedMatrix: assertDevTestGameHostedConcurrentRaceMatrixEvidence(
          await readJson(hostedMatrixPath),
        ),
        hostedEvidenceLane: assertDevTestGameHostedEvidenceLane(
          await readJson(hostedEvidenceLanePath),
        ),
      };
    },
    prove: async ({ browser, frontendBaseUrl, source }) => {
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
      return await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: source.proofRun.session.game,
        auditId: localAdminAuditIds.proofGraph,
        requiredChecks: proofGraphVisibleCheckIds(source.proofGraph),
        requiredCheckStatuses: proofGraphVisibleCheckStatuses(source.proofGraph),
        requiredProductionFeatureDestinationSummaries:
          productionFeatureDestinationSummary.rows.map((row) => row.id),
        requiredDiagnosticProofSummaries: diagnosticProofSummary.rows.map(
          (row) => row.id,
        ),
        requiredDiagnosticProofSummaryStatuses: Object.fromEntries(
          diagnosticProofSummary.rows.map((row) => [
            row.id,
            "non-terminal artifact",
          ]),
        ),
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
        ],
      });
    },
    buildEvidence: ({ source, adminRoleSurface }) => ({
      version: 1,
      proof: "dev-test-game-proof-graph-admin-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: "local-dev-test-game-proof-graph-admin-surface",
      proofBoundary:
        "Local SvelteKit admin role URL with fixture admin authority over the generated dev-test-game proof graph. Proves the machine-readable proof graph, recovery receipt evidence-object rows, and role handoffs are discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted operations, beta readiness, release readiness, or production readiness.",
      generatedFrom: {
        proofGraph: proofGraphRelativePath,
        proofRun: proofRunRelativePath,
        adminSpineProof: adminSpineProofRelativePath,
        hostedConcurrentRaceMatrix: hostedMatrixRelativePath,
        hostedEvidenceLane: hostedEvidenceLaneRelativePath,
        game: source.proofRun.session.game,
        nodeIds: source.proofGraph.nodes.map((node) => node.id),
        evidenceObjectRowIds: proofGraphEvidenceObjectRowIds(source.proofGraph),
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
        diagnosticProofSummary: normalizeProofGraphDiagnosticProofSummary(
          source.proofGraph.summary?.diagnosticProofSummary,
          { nodes: source.proofGraph.nodes },
        ),
        ...proofGraphAdminFeatureTargetEntries(source.proofGraph),
      },
      adminRoleSurface,
    }),
    assertEvidence: assertProofGraphAdminProof,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(proofGraphAdminProofCase());
}

export function assertProofGraphAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-proof-graph-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-proof-graph-admin-surface"
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
  assertAdminAuditRelatedHandoffs({
    adminRoleSurface: evidence.adminRoleSurface,
    handoffs: evidence.generatedFrom?.adminProofRoleHandoffs,
    proofName: "proof graph admin proof",
  });
  assertProofGraphAdminProofCoversCoreLoopScenarioFamilies(evidence);
  assertProofGraphAdminProofCoversProductionFeatureDestinations(evidence);
  assertProofGraphAdminProofCoversProductionFeatureDestinationSummary(evidence);
  assertProofGraphAdminProofCoversDiagnosticProofSummary(evidence);
  for (const featureTargetCase of proofGraphAdminFeatureTargetCases) {
    assertProofGraphAdminProofCoversFeatureTarget(evidence, featureTargetCase);
  }
  return evidence;
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
  for (const row of summary.rows ?? []) {
    if (
      !evidence.adminRoleSurface
        ?.visibleProductionFeatureDestinationSummaries?.includes(row.id)
    ) {
      throw new Error(
        `proof graph admin proof missing production feature destination summary row: ${row.id}`,
      );
    }
  }
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
    ...proofGraphEvidenceObjectRowIds(proofGraph),
    ...proofGraphReceiptArtifactRowIds(proofGraph),
    ...proofGraph.edges.map((edge) => proofGraphEdgeCheckId(edge)),
  ];
}

function proofGraphVisibleCheckStatuses(proofGraph) {
  const hostedIdentityReceipt = hostedIdentityTerminalReceiptArtifact(proofGraph);
  return hostedIdentityReceipt === null
    ? {}
    : {
        [hostedIdentityReceipt.rowId]: hostedIdentityReceipt.status,
      };
}

function proofGraphEvidenceObjectRowIds(proofGraph) {
  return proofGraph.nodes.flatMap((node) =>
    normalizedEvidenceObjectRowIds({
      parentId: node.id,
      objects: node.normalizedEvidenceObjects,
    }),
  );
}

function proofGraphReceiptArtifactRowIds(proofGraph) {
  return proofGraph.nodes.flatMap((node) =>
    normalizeProofGraphReceiptArtifactRows({
      parentId: node.id,
      artifacts: node.receiptArtifacts,
    }).map((artifact) => artifact.rowId),
  );
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
