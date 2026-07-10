import { buildAppShell } from "../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../lib/app/app-surface-header-model.mjs";
import { resolveSurfaceAccess } from "../../lib/app/capabilities.mjs";
import {
  loadAdminColdData,
  operatorProofRunUrl,
} from "../../lib/app/cold-load.mjs";
import {
  coreLoopLaneStatus,
  coreLoopSpineStatus,
  hardeningLaneStatus,
} from "../../lib/app/local-proof-lane-status.mjs";
import {
  selectedNextActionProofGraphNodeStatus,
  selectedNextActionProofGraphNodeSummary,
} from "../../lib/app/local-proof-handoff-status.mjs";
import {
  nextActionRelatedLinkDescriptors,
  nextActionRelatedLinkHrefKinds,
} from "../../lib/app/next-action-related-links.mjs";
import {
  proofGraphEdgeCheckId,
  proofGraphEdgeStatusText,
  selectedProofGraphDependencyApplies,
  selectedProofGraphDependencyDefinitions,
  selectedProofGraphDependencyEdgeRelatedLinkDescriptor,
} from "../../lib/app/selected-proof-graph-dependencies.mjs";
import {
  coverageDecisionCheckRows,
  selectedProductionFeatureGraphCheckRows,
  selectedProductionFeatureGraphRelatedLinkDescriptor,
  selectedProofGraphNodeCheckRows,
  selectedProofGraphNodeRelatedLinkDescriptor,
} from "../../lib/app/selected-proof-graph-destinations.mjs";
import {
  hardeningAuditLaneIds,
} from "../../../../tools/dev_test_game_hardening_scenarios.mjs";
import {
  playerRecoveryAuditLaneIds,
} from "../../../../tools/dev_test_game_player_recovery_scenarios.mjs";
import {
  completedGameHardeningLaneCases,
} from "../../../../tools/dev_test_game_core_loop_completed_scenarios.mjs";
import {
  coreLoopCompletedGameCoverageCheckId,
  coreLoopAuditLaneIds,
} from "../../../../tools/dev_test_game_core_loop_scenarios.mjs";
import {
  coreLoopScenarioFamilyRows,
} from "../../../../tools/dev_test_game_core_loop_generated_from_families.mjs";
import {
  coreLoopCommandProofRoleUrlAuditExpectation,
} from "../../../../tools/dev_test_game_core_loop_proof_shape_assertions.mjs";
import {
  buildHostVisibleInvalidActionRecoverySummary,
  buildHostVisibleRecoverySummaries,
  buildHostVisibleStaleTransitionRecoverySummaries,
  playerActionBoundaryLaneId,
  playerActionLoopLaneId,
  playerInvalidActionRecoveryLaneId,
} from "../../../../tools/dev_test_game_core_loop_action_scenarios.mjs";
import {
  proofGraphCoreLoopRecoveryDestinationProofTargetTestId,
  proofGraphCoreLoopRecoveryDestinationRowTestId,
  proofGraphCoreLoopRecoveryDestinationSectionHeading,
  proofGraphCoreLoopRecoveryDestinationSectionId,
  proofGraphCoreLoopRecoveryDestinationSummary,
} from "../../../../tools/dev_test_game_proof_graph_core_loop_recovery_destinations.mjs";
import {
  proofGraphProductionFeatureDestinationArtifactFields,
  proofGraphProductionFeatureDestinationArtifactTestId,
  proofGraphProductionFeatureDestinationRowTestId,
} from "../../../../tools/dev_test_game_proof_graph_production_feature_destinations.mjs";
import {
  hostedEvidenceHandoffInputRows,
} from "../../../../tools/dev_test_game_hosted_handoff_cases.mjs";
import {
  devTestGameHostedEvidenceOperatorChecklistPath,
  devTestGameHostedEvidenceOperatorChecklistProofCommand,
  devTestGameHostedEvidenceOperatorChecklistProofPath,
} from "../../../../tools/dev_test_game_hosted_evidence_operator_checklist.mjs";
import {
  hostedMatrixRawEvidenceTemplateDiagnosticFieldValues,
  hostedMatrixRawEvidenceTemplateDescriptorFieldValues,
  hostedMatrixRawEvidenceTemplateDescriptor,
} from "../../../../tools/dev_test_game_hosted_matrix_raw_evidence_template_proof.mjs";
import {
  devTestGameRealHostedObservabilityHandoffCommand,
  devTestGameRealHostedObservabilityHandoffPath,
  realHostedObservabilityBaselineEnv,
  realHostedObservabilityEvidenceEnv,
  realHostedObservabilityHandoffInputIds,
} from "../../../../tools/dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  localAdminAuditHandoffCheckIds,
  localAdminAuditIds,
} from "../../../../tools/dev_test_game_admin_audit_surface_ids.mjs";
import {
  buildAdminAuditHandoffPath,
} from "../../../../tools/dev_test_game_admin_audit_handoff_path.mjs";
import {
  normalizeProofGraphReceiptArtifactRows,
} from "../../../../tools/dev_test_game_proof_graph_receipt_artifact_rows.mjs";
import {
  proofGraphPrerequisiteDestinationProofTargetTestId,
  proofGraphPrerequisiteDestinationRowsFromNodes,
  proofGraphPrerequisiteDestinationSectionHeading,
  proofGraphPrerequisiteDestinationSectionId,
} from "../../../../tools/dev_test_game_proof_graph_prerequisite_destination_rows.mjs";
import {
  terminalReceiptContractRegistry,
} from "../../../../tools/dev_test_game_terminal_receipts.mjs";
import {
  normalizeLocalReadinessDependencyTrace,
  normalizePreReadinessTrace,
  preReadinessTraceCheckRows,
  preReadinessTraceKeys,
} from "../../../../tools/dev_test_game_pre_readiness_trace_registry.mjs";

const adminRouteTerminalReceiptContracts = Object.freeze(
  [...terminalReceiptContractRegistry].sort(
    (left, right) =>
      Number(left.adminRouteOrder ?? 0) - Number(right.adminRouteOrder ?? 0),
  ),
);
import {
  proofGraphDiagnosticProofSummaryRowTestId,
  proofGraphDiagnosticProofSummarySectionHeading,
  proofGraphDiagnosticProofSummarySectionId,
  proofGraphDiagnosticSummaryCheckRows,
  normalizeProofGraphDiagnosticProofSummary,
  normalizeProofGraphDiagnosticSummaryTrace,
} from "../../../../tools/dev_test_game_proof_graph_diagnostic_summary.mjs";
import {
  proofGraphHandoffPhaseOutputArtifactTestId,
  proofGraphHandoffPhaseOutputRowTestId,
  proofGraphHandoffPhaseOutputSectionHeading,
  proofGraphHandoffPhaseOutputSectionId,
} from "../../../../tools/dev_test_game_handoff_phase_outputs.mjs";
import {
  normalizeSelectionTrace,
  releaseReadinessTraceCheckRows,
  releaseReadinessTraceStrategy,
  selectionTraceCheckRows,
} from "../../../../tools/dev_test_game_next_action_priority_traces.mjs";
import {
  normalizeRecoveryTrace,
  recoveryTraceCheckRows,
  recoveryTraceKeys,
} from "../../../../tools/dev_test_game_next_action_recovery_traces.mjs";
import {
  devTestGameIdentityAdapterContractDiff,
  devTestGameIdentityAdapterProofVersion,
} from "../../../../tools/dev_test_game_identity_adapter_contract.mjs";
import {
  adminSpineProofPath,
  devTestGameProofGraphPath,
  devTestGameProofRunPath,
  devTestGameReleaseReadinessPath,
  nextActionPath,
  spineManifestPath,
} from "../../../../tools/dev_test_game_spine_artifact_paths.mjs";
import {
  devTestGameBackupRestoreDumpPath,
  devTestGameBackupRestoreProofPath,
  devTestGameHostedConcurrentRaceMatrixPath,
  devTestGameHostedEvidenceLaneDemoProofPath,
  devTestGameHostedEvidenceLanePath,
  devTestGameHostedIdentityEvidencePath,
  devTestGameHostedOpsSignalsPath,
  devTestGameHostedTargetPreflightPath,
  devTestGameIdentityAdapterProofPath,
  devTestGameOpsArtifactsPath,
  devTestGameRaceCoveragePath,
  devTestGameSeedFixturePath,
} from "../../../../tools/dev_test_game_adjacent_artifact_paths.mjs";
import {
  devTestGameReleaseRunbookPath,
} from "../../../../tools/dev_test_game_release_artifact_paths.mjs";
import {
  normalizeSpineRowKind,
  selectedSpineDeclarationStatus,
  selectedSpineDrilldownStatus,
  selectedSpineTargetStatus,
} from "./selected-spine-status.mjs";
import {
  ADMIN_ROUTE_CONTRACT,
} from "./admin-route-contract.mjs";

export { ADMIN_ROUTE_CONTRACT };

export const LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS = playerRecoveryAuditLaneIds;
export {
  proofGraphHandoffPhaseOutputSectionHeading,
  proofGraphHandoffPhaseOutputSectionId,
} from "../../../../tools/dev_test_game_handoff_phase_outputs.mjs";

const COMPLETED_GAME_HARDENING_LANE_CASES = Object.freeze(
  completedGameHardeningLaneCases(),
);
const COMPLETED_GAME_HARDENING_FAMILY_IDS = Object.freeze([
  ...new Set(
    COMPLETED_GAME_HARDENING_LANE_CASES.map((scenario) => scenario.family),
  ),
]);
const SETUP_COMMAND_EVIDENCE_KEYS = Object.freeze([
  "addSlot",
  "assignSlot",
  "assignRole",
  "setPostPolicy",
  "startGame",
]);
export const hostedHandoffReceiptHeadingRegistry = Object.freeze({
  [localAdminAuditIds.hostedEvidenceLane]: Object.freeze({
    blockedReceipt: "Hosted evidence blocked receipt",
    realHostedMatrixRawCaptureIntake: "Real hosted raw-capture intake",
    firstMissingOperatorArtifact: "First missing operator artifact",
  }),
  [localAdminAuditIds.hostedIdentityEvidence]: Object.freeze({
    blockedReceipt: "Hosted identity blocked receipt",
    firstMissingOperatorArtifact: "First missing operator artifact",
  }),
  [localAdminAuditIds.hostedConcurrentRaceMatrix]: Object.freeze({
    blockedReceipt: "Hosted matrix blocked receipt",
    firstMissingOperatorArtifact: "First missing operator artifact",
  }),
  [localAdminAuditIds.realHostedObservabilityHandoff]: Object.freeze({
    blockedReceipt: "Real hosted observability blocked receipt",
    firstMissingOperatorArtifact: "First missing operator artifact",
  }),
});
const defaultHostedHandoffReceiptHeadings = Object.freeze({
  blockedReceipt: "Hosted handoff blocked receipt",
  realHostedMatrixRawCaptureIntake: "Real hosted raw-capture intake",
  firstMissingOperatorArtifact: "First missing operator artifact",
});

export function hostedHandoffReceiptHeadingsForAudit(auditId) {
  return Object.freeze({
    ...defaultHostedHandoffReceiptHeadings,
    ...(hostedHandoffReceiptHeadingRegistry[String(auditId ?? "")] ?? {}),
  });
}

function hostedHandoffReceiptHeadingsForNextActionUnproven(unproven) {
  const roleUrl = String(unproven?.roleUrl ?? "");
  const unprovenId = String(unproven?.id ?? "");
  if (
    roleUrl.includes(localAdminAuditIds.hostedIdentityEvidence) ||
    unprovenId === "hosted-production-identity"
  ) {
    return hostedHandoffReceiptHeadingsForAudit(
      localAdminAuditIds.hostedIdentityEvidence,
    );
  }
  if (
    roleUrl.includes(localAdminAuditIds.hostedEvidenceLane) ||
    unprovenId === "hosted-deployment"
  ) {
    return hostedHandoffReceiptHeadingsForAudit(
      localAdminAuditIds.hostedEvidenceLane,
    );
  }
  if (roleUrl.includes(localAdminAuditIds.realHostedObservabilityHandoff)) {
    return hostedHandoffReceiptHeadingsForAudit(
      localAdminAuditIds.realHostedObservabilityHandoff,
    );
  }
  if (roleUrl.includes(localAdminAuditIds.hostedConcurrentRaceMatrix)) {
    return hostedHandoffReceiptHeadingsForAudit(
      localAdminAuditIds.hostedConcurrentRaceMatrix,
    );
  }
  return hostedHandoffReceiptHeadingsForAudit("");
}

function artifactSummaryValue({
  id,
  text,
  emphasized = false,
  href = "",
  testId = "",
  copyText = "",
}) {
  const normalizedHref = typeof href === "string" ? href : "";
  const normalizedTestId = typeof testId === "string" ? testId : "";
  const normalizedCopyText = typeof copyText === "string" ? copyText : "";
  return Object.freeze({
    id: String(id),
    text: String(text ?? ""),
    emphasized: emphasized === true,
    ...(normalizedHref === "" ? {} : { href: normalizedHref }),
    ...(normalizedTestId === "" ? {} : { testId: normalizedTestId }),
    ...(normalizedCopyText === "" ? {} : { copyText: normalizedCopyText }),
  });
}

function localProofArtifactHref({ game, artifact }) {
  const normalized = String(artifact ?? "");
  return normalized.startsWith("target/dev-test-game/") &&
    normalized.endsWith(".json")
    ? adminArtifactInspectHref({ game, artifact: normalized })
    : "";
}

function localProofArtifactValue({
  id,
  text,
  game,
  emphasized = false,
  testId = "",
}) {
  const artifact = String(text ?? "");
  const href = localProofArtifactHref({ game, artifact });
  return {
    id,
    text: artifact,
    emphasized,
    ...(href === "" ? {} : { href }),
    ...(href === "" || testId === "" ? {} : { testId }),
  };
}

function artifactSummarySubentry({ id, testId, values }) {
  return Object.freeze({
    id: String(id),
    testId: String(testId ?? `admin-audit-${id}`),
    values: Object.freeze(values.map((value) => artifactSummaryValue(value))),
  });
}

function artifactSummaryRow({ id, testId, values, subentries = [] }) {
  const normalizedSubentries = subentries.map((subentry) =>
    artifactSummarySubentry(subentry),
  );
  return Object.freeze({
    id: String(id),
    testId: String(testId ?? `admin-audit-${id}`),
    values: Object.freeze(values.map((value) => artifactSummaryValue(value))),
    ...(normalizedSubentries.length === 0
      ? {}
      : { subentries: Object.freeze(normalizedSubentries) }),
  });
}

function buildArtifactSummarySection({ id, heading, rows }) {
  return Object.freeze({
    id: String(id),
    heading: String(heading),
    testId: `admin-audit-detail-${id}`,
    rows: Object.freeze(rows.map((row) => artifactSummaryRow(row))),
  });
}

function buildSingleRowArtifactSummarySection({ id, heading, values }) {
  return buildArtifactSummarySection({
    id,
    heading,
    rows: [{ id: "summary", testId: `admin-audit-${id}`, values }],
  });
}

function buildLocalNextActionSummarySections({
  game,
  nextActionHandoffPair,
  frontendSetupWorkbenchReadiness,
  phaseLocalNextActionSnapshots,
}) {
  return Object.freeze([
    ...nextActionHandoffPairSummarySections(nextActionHandoffPair),
    ...frontendSetupWorkbenchReadinessSummarySections(
      frontendSetupWorkbenchReadiness,
    ),
    ...phaseLocalNextActionSummarySections(phaseLocalNextActionSnapshots, { game }),
  ]);
}

function nextActionHandoffPairSummarySections(pair) {
  if (pair === null) {
    return [];
  }
  return [
    buildArtifactSummarySection({
      id: "next-action-handoff-pair",
      heading: "Next action handoff",
      rows: [
        {
          id: "summary",
          testId: "admin-audit-next-action-handoff-pair-summary",
          values: [
            { id: "status", text: pair.status, emphasized: true },
            { id: "id", text: pair.id },
            { id: "proofBoundary", text: pair.proofBoundary },
          ],
        },
        ...[
          pair.defaultSequenceBlocker,
          pair.hostedIdentityPredicate,
        ].map((handoff) => ({
          id: handoff.id,
          testId: `admin-audit-next-action-handoff-pair-${handoff.id}`,
          values: [
            { id: "label", text: handoff.label, emphasized: true },
            { id: "status", text: handoff.status },
            { id: "proofId", text: handoff.proofId },
            { id: "expectedReason", text: handoff.expectedReason },
            {
              id: "expectedActionStatus",
              text: handoff.expectedActionStatus,
            },
            { id: "batchLabel", text: handoff.batchLabel },
            { id: "nextActionPath", text: handoff.nextActionPath },
            { id: "adminProofPath", text: handoff.adminProofPath },
          ],
        })),
      ],
    }),
  ];
}

function phaseLocalNextActionSummarySections(snapshots, { game }) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return [];
  }
  return [
    buildArtifactSummarySection({
      id: "phase-local-next-actions",
      heading: "Phase-local next-action snapshots",
      rows: snapshots.map((snapshot) => ({
        id: snapshot.id,
        testId: `admin-audit-phase-local-next-action-${snapshot.id}`,
        values: [
          { id: "status", text: snapshot.status, emphasized: true },
          { id: "phaseLocalNextActionId", text: snapshot.phaseLocalNextActionId },
          { id: "sequenceStage", text: snapshot.sequenceStage },
          {
            id: "artifact",
            text: snapshot.artifact,
            href: localProofArtifactHref({ game, artifact: snapshot.artifact }),
            testId: `admin-audit-phase-local-next-action-open-artifact-${snapshot.id}`,
          },
          { id: "canonicalArtifact", text: snapshot.canonicalArtifact },
          { id: "nextActionEdgeRowId", text: snapshot.nextActionEdgeRowId },
          { id: "manifestEdgeRowId", text: snapshot.manifestEdgeRowId },
          { id: "proofCommand", text: snapshot.proofCommand },
          { id: "proofBoundary", text: snapshot.proofBoundary },
        ],
      })),
    }),
  ];
}

function terminalReceiptSummarySections(terminalReceiptsByKey, { game } = {}) {
  return adminRouteTerminalReceiptContracts.flatMap((contract) => {
    const receipt = terminalReceiptsByKey[contract.terminalBatchesKey];
    if (receipt === null || receipt === undefined) {
      return [];
    }
    const rowFields = contract.rowFieldsForReceipt(receipt);
    const rowDefinitions = contract.rowDefinitionsForReceipt(receipt);
    return [
      buildArtifactSummarySection({
        id: contract.id,
        heading: contract.summaryHeading,
        rows: rowDefinitions.map((definition) =>
          terminalReceiptSummaryRow({
            contract,
            definition,
            fields: rowFields[definition.id],
            game,
          }),
        ),
      }),
    ];
  });
}

function terminalReceiptSummaryRow({ contract, definition, fields, game }) {
  return {
    id: definition.summaryRowId,
    testId: definition.testId,
    values: fields.map((field) => ({
      id: field.id,
      text: field.value,
      ...(field.emphasized === true ? { emphasized: true } : {}),
      ...(field.id !== contract.summaryLinkFieldId
        ? {}
        : {
            href: seededRoleUrlToAdminHref(field.value, { game }),
            testId: contract.summaryLinkTestId,
          }),
    })),
  };
}

function frontendSetupWorkbenchReadinessSummarySections(readiness) {
  if (readiness.id === "") {
    return [];
  }
  return [
    buildArtifactSummarySection({
      id: "frontend-setup-workbench",
      heading: "Frontend setup workbench",
      rows: [
        {
          id: "summary",
          testId: "admin-audit-frontend-setup-workbench-summary",
          values: [
            { id: "state", text: readiness.state, emphasized: true },
            { id: "route", text: readiness.route },
            { id: "localStatus", text: readiness.localStatus },
            { id: "importedStatus", text: readiness.importedStatus },
            { id: "proofBoundary", text: readiness.proofBoundary },
          ],
        },
        ...readiness.localViewportLayouts.map((layout) => ({
          id: layout.viewport,
          testId: `admin-audit-frontend-setup-workbench-${layout.viewport}`,
          values: [
            { id: "viewport", text: layout.viewport, emphasized: true },
            { id: "layout", text: layout.layout },
            { id: "slotCount", text: `${layout.slotCount} slots` },
            {
              id: "noHorizontalOverflow",
              text: layout.noHorizontalOverflow
                ? "no horizontal overflow"
                : "horizontal overflow",
            },
            { id: "screenshot", text: layout.screenshot },
          ],
        })),
      ],
    }),
  ];
}

function buildLocalProofGraphSummarySections(
  artifactSummary,
  { nodes, edges, game } = {},
) {
  return Object.freeze([
    ...diagnosticProofSummarySections(artifactSummary.diagnosticProofSummary),
    ...proofGraphHandoffPhaseOutputSections({ nodes, edges, game }),
    ...proofGraphPrerequisiteDestinationSections({ nodes, game }),
    ...proofGraphCoreLoopRecoveryDestinationSections({
      summary: artifactSummary.coreLoopRecoveryDestinationSummary,
      game,
    }),
  ]);
}

function proofGraphHandoffPhaseOutputSections({ nodes, edges, game } = {}) {
  const rows = proofGraphHandoffPhaseOutputRows({ nodes, edges });
  if (rows.length === 0) {
    return [];
  }
  return [
    buildArtifactSummarySection({
      id: proofGraphHandoffPhaseOutputSectionId,
      heading: proofGraphHandoffPhaseOutputSectionHeading,
      rows: rows.map((row) =>
        proofGraphHandoffPhaseOutputArtifactRow({ row, game }),
      ),
    }),
  ];
}

function proofGraphHandoffPhaseOutputRows({ nodes, edges } = {}) {
  const graphNodes = Array.isArray(nodes) ? nodes : [];
  const graphEdges = Array.isArray(edges) ? edges : [];
  return graphNodes
    .filter((node) => node?.kind === "handoff-phase-output")
    .map((node) => {
      const manifestEdge =
        graphEdges.find(
          (edge) =>
            edge.from === "spine-manifest" &&
            edge.to === node.id &&
            edge.relationship === "records-handoff-phase-output" &&
            edge.handoffPhaseOutputId === node.handoffPhaseOutputId,
        ) ?? null;
      return Object.freeze({
        id: String(node.id ?? ""),
        label: String(node.label ?? node.id ?? ""),
        status: String(node.status ?? "recorded"),
        artifact: String(node.artifact ?? ""),
        handoffPhaseId: String(node.handoffPhaseId ?? ""),
        handoffPhaseStep: String(node.handoffPhaseStep ?? ""),
        handoffPhaseOutputId: String(node.handoffPhaseOutputId ?? ""),
        proofCommand: String(node.proofCommand ?? ""),
        manifestEdgeRowId:
          manifestEdge === null ? "" : proofGraphEdgeCheckId(manifestEdge),
      });
    });
}

function proofGraphHandoffPhaseOutputArtifactRow({ row, game }) {
  return {
    id: row.id,
    testId: proofGraphHandoffPhaseOutputRowTestId(row.id),
    values: [
      { id: "label", text: row.label, emphasized: true },
      { id: "status", text: row.status },
      { id: "handoffPhaseId", text: row.handoffPhaseId },
      { id: "handoffPhaseStep", text: row.handoffPhaseStep },
      { id: "handoffPhaseOutputId", text: row.handoffPhaseOutputId },
      { id: "manifestEdgeRowId", text: row.manifestEdgeRowId },
      localProofArtifactValue({
        id: "artifact",
        text: row.artifact,
        game,
        testId: proofGraphHandoffPhaseOutputArtifactTestId(row.id),
      }),
      { id: "command", text: row.proofCommand },
    ],
  };
}

function proofGraphCoreLoopRecoveryDestinationSections({ summary, game } = {}) {
  const rows = Array.isArray(summary?.rows) ? summary.rows : [];
  if (rows.length === 0) {
    return [];
  }
  return [
    buildArtifactSummarySection({
      id: proofGraphCoreLoopRecoveryDestinationSectionId,
      heading: proofGraphCoreLoopRecoveryDestinationSectionHeading,
      rows: rows.map((row) =>
        proofGraphCoreLoopRecoveryDestinationArtifactRow({ row, game }),
      ),
    }),
  ];
}

function proofGraphCoreLoopRecoveryDestinationArtifactRow({ row, game }) {
  return {
    id: row.id,
    testId: proofGraphCoreLoopRecoveryDestinationRowTestId(row.id),
    values: [
      { id: "label", text: row.label, emphasized: true },
      { id: "status", text: row.status },
      { id: "recoveryCaseId", text: row.recoveryCaseId },
      { id: "graphNodeId", text: row.graphNodeId },
      { id: "adminRowId", text: row.adminRowId },
      { id: "proofEdgeRowId", text: row.proofEdgeRowId },
      { id: "graphEdgeRowId", text: row.graphEdgeRowId },
      { id: "nextActionEdgeRowId", text: row.nextActionEdgeRowId },
      localProofArtifactValue({
        id: "proofTarget",
        text: row.proofTarget,
        game,
        testId: proofGraphCoreLoopRecoveryDestinationProofTargetTestId(row.id),
      }),
      { id: "command", text: row.command },
      {
        id: "roleUrl",
        text: row.roleUrl,
        href: seededRoleUrlToAdminHref(row.roleUrl, { game }),
      },
    ],
  };
}

function proofGraphPrerequisiteDestinationSections({ nodes, game } = {}) {
  const rows = proofGraphPrerequisiteDestinationRowsFromNodes(nodes);
  if (rows.length === 0) {
    return [];
  }
  return [
    buildArtifactSummarySection({
      id: proofGraphPrerequisiteDestinationSectionId,
      heading: proofGraphPrerequisiteDestinationSectionHeading,
      rows: rows.map((row) =>
        proofGraphPrerequisiteDestinationArtifactRow({ row, game }),
      ),
    }),
  ];
}

function proofGraphPrerequisiteDestinationArtifactRow({ row, game }) {
  return {
    id: row.rowId,
    testId: row.rowTestId,
    values: [
      { id: "nodeId", text: row.nodeId, emphasized: true },
      { id: "destinationId", text: row.destinationId },
      { id: "auditId", text: row.auditId },
      localProofArtifactValue({
        id: "proofTarget",
        text: row.proofTarget,
        game,
        testId: proofGraphPrerequisiteDestinationProofTargetTestId(row.rowId),
      }),
      {
        id: "roleUrl",
        text: row.roleUrl,
        href: seededRoleUrlToAdminHref(row.roleUrl, { game }),
        testId: row.roleUrlTestId,
      },
    ],
  };
}

function diagnosticProofSummarySections(summary) {
  const rows = Array.isArray(summary?.rows) ? summary.rows : [];
  if (rows.length === 0) {
    return [];
  }
  return [
    buildArtifactSummarySection({
      id: proofGraphDiagnosticProofSummarySectionId,
      heading: proofGraphDiagnosticProofSummarySectionHeading,
      rows: rows.map((row) => ({
        id: row.id,
        testId: proofGraphDiagnosticProofSummaryRowTestId(row.id),
        values: [
          { id: "label", text: row.label, emphasized: true },
          { id: "status", text: row.status },
          { id: "diagnosticReason", text: row.diagnosticReason },
          { id: "artifact", text: row.artifact },
          {
            id: "promotesFreshness",
            text: row.promotesFreshness
              ? "freshness-promoting"
              : "non-freshness-promoting",
          },
          {
            id: "terminalArtifact",
            text: row.terminalArtifact
              ? "terminal artifact"
              : "non-terminal artifact",
          },
        ],
      })),
    }),
  ];
}

function buildHostedHandoffChecklistRows(checklist) {
  if (checklist === null || typeof checklist !== "object") {
    return Object.freeze([]);
  }
  return Object.freeze(
    [
      {
        id: "summary",
        testId: "admin-audit-hosted-handoff-summary",
        values: [
          { id: "status", text: checklist.status, emphasized: true },
          { id: "preflightStatus", text: checklist.preflightStatus },
          { id: "command", text: checklist.command },
          { id: "proofTarget", text: checklist.proofTarget },
        ],
      },
      ...hostedHandoffInputRows(checklist.inputs),
      ...hostedHandoffInputSectionRows(checklist.inputSections),
      ...hostedHandoffGroupRows(checklist.groups),
      ...hostedHandoffBlockedCheckRows(checklist.blockedChecks),
    ].map((row) => artifactSummaryRow(row)),
  );
}

function hostedHandoffInputRows(inputs) {
  return (Array.isArray(inputs) ? inputs : []).map((input) => ({
    id: `input-${input.id}`,
    testId: `admin-audit-hosted-handoff-input-${input.id}`,
    values: [
      { id: "label", text: input.label, emphasized: true },
      { id: "value", text: input.value },
      { id: "required", text: input.required ? "required" : "optional" },
    ],
  }));
}

function hostedHandoffInputSectionRows(sections) {
  return (Array.isArray(sections) ? sections : []).map((section) => ({
    id: `input-section-${section.id}`,
    testId: `admin-audit-hosted-handoff-input-section-${section.id}`,
    values: [
      { id: "label", text: section.label, emphasized: true },
      { id: "status", text: section.status },
      {
        id: "missingInputs",
        text: Array.isArray(section.missingInputs)
          ? section.missingInputs.join(", ")
          : "",
      },
    ],
    subentries: (Array.isArray(section.requiredInputIds)
      ? section.requiredInputIds
      : []
    ).map((inputId) => ({
      id: `input-section-${section.id}-${inputId}`,
      testId: `admin-audit-hosted-handoff-section-input-${section.id}-${inputId}`,
      values: [
        { id: "inputId", text: inputId, emphasized: true },
        {
          id: "status",
          text: hostedHandoffInputSectionStatus(section, inputId),
        },
      ],
    })),
  }));
}

function hostedHandoffInputSectionStatus(section, inputId) {
  return Array.isArray(section.providedInputIds) &&
    section.providedInputIds.includes(inputId)
    ? "provided"
    : "missing";
}

function hostedHandoffGroupRows(groups) {
  return (Array.isArray(groups) ? groups : []).map((group) => ({
    id: `group-${group.id}`,
    testId: `admin-audit-hosted-handoff-group-${group.id}`,
    values: [
      { id: "label", text: group.label, emphasized: true },
      { id: "status", text: group.status },
      {
        id: "blockedCheckCount",
        text: `${hostedHandoffBlockedCheckCount(group)} blocked`,
      },
      { id: "requiredEvidence", text: group.requiredEvidence },
    ],
  }));
}

function hostedHandoffBlockedCheckCount(group) {
  return Array.isArray(group.blockedCheckIds) ? group.blockedCheckIds.length : 0;
}

function hostedHandoffBlockedCheckRows(blockedChecks) {
  return (Array.isArray(blockedChecks) ? blockedChecks : []).map((check) => ({
    id: `blocked-check-${check.id}`,
    testId: `admin-audit-hosted-handoff-blocked-check-${check.id}`,
    values: [
      { id: "id", text: check.id, emphasized: true },
      { id: "status", text: check.status },
      { id: "requiredEvidence", text: check.requiredEvidence },
    ],
  }));
}

function buildHostedHandoffOperatorRows(checklist) {
  if (checklist === null || typeof checklist !== "object") {
    return Object.freeze([]);
  }
  return Object.freeze(
    [
      ...hostedIdentityOperatorGateRows(checklist.operatorEvidenceGate),
      ...hostedHandoffOperatorProofRows(checklist.operatorProofDrilldowns),
    ].map((row) => artifactSummaryRow(row)),
  );
}

function hostedIdentityOperatorGateRows(gate) {
  if (gate === null || typeof gate !== "object") {
    return [];
  }
  return [
    {
      id: `operator-gate-${gate.id}`,
      testId: `admin-audit-hosted-identity-operator-gate-${gate.id}`,
      values: [
        { id: "status", text: gate.status, emphasized: true },
        { id: "evidencePathEnv", text: gate.evidencePathEnv },
        {
          id: "requiredRawEvidencePathKind",
          text: gate.requiredRawEvidencePathKind,
        },
        {
          id: "rejectedRawEvidencePathKinds",
          text: gate.rejectedRawEvidencePathKinds.join(", "),
        },
        { id: "command", text: gate.command },
        { id: "proofTarget", text: gate.proofTarget },
        { id: "roleUrl", text: gate.roleUrl },
        { id: "localCapabilityRoleUrl", text: gate.localCapabilityRoleUrl },
        { id: "proofBoundary", text: gate.proofBoundary },
      ],
    },
    ...gate.requiredEvidenceFamilies.map((family) => ({
      id: `operator-gate-family-${family.id}`,
      testId: `admin-audit-hosted-identity-operator-gate-family-${family.id}`,
      values: [
        { id: "id", text: family.id, emphasized: true },
        { id: "field", text: family.field },
        { id: "checkId", text: family.checkId },
        { id: "requiredInputIds", text: family.requiredInputIds.join(", ") },
      ],
    })),
    ...hostedIdentityProviderBoundaryRows(gate.providerBoundary),
    ...gate.rejectedRawEvidencePathKinds.map((kind) => ({
      id: `operator-gate-rejected-path-kind-${kind}`,
      testId: `admin-audit-hosted-identity-operator-gate-rejected-path-kind-${kind}`,
      values: [
        { id: "kind", text: kind, emphasized: true },
        { id: "status", text: "rejected" },
      ],
    })),
  ];
}

function hostedIdentityProviderBoundaryRows(boundary) {
  if (boundary === null || typeof boundary !== "object") {
    return [];
  }
  return [
    {
      id: `provider-boundary-${boundary.id}`,
      testId: `admin-audit-hosted-identity-provider-boundary-${boundary.id}`,
      values: [
        { id: "status", text: boundary.status, emphasized: true },
        { id: "architectureId", text: boundary.architectureId },
        { id: "providerCount", text: `${boundary.providerCount} providers` },
        {
          id: "roleSurfaceArchitectureChanged",
          text: hostedIdentityRoleSurfaceArchitectureText(boundary),
        },
        { id: "proofBoundary", text: boundary.proofBoundary },
      ],
    },
    ...boundary.providers.map((provider) => ({
      id: `provider-boundary-provider-${provider.id}`,
      testId: `admin-audit-hosted-identity-provider-boundary-provider-${provider.id}`,
      values: [
        { id: "status", text: provider.status, emphasized: true },
        { id: "label", text: provider.label },
        { id: "mode", text: provider.mode },
        { id: "accountCredential", text: provider.accountCredential },
        { id: "inviteCredential", text: provider.inviteCredential },
        { id: "sessionCredential", text: provider.sessionCredential },
        { id: "loginBoundary", text: provider.loginBoundary },
        { id: "sessionBoundary", text: provider.sessionBoundary },
        { id: "sessionGrantBoundary", text: provider.sessionGrantBoundary },
        { id: "browserCookieName", text: provider.browserCookieName },
        { id: "rawCredentialPolicy", text: provider.rawCredentialPolicy },
        {
          id: "roleSurfaceArchitectureChanged",
          text: hostedIdentityRoleSurfaceArchitectureText(provider),
        },
        ...(provider.requiredEvidence === ""
          ? []
          : [{ id: "requiredEvidence", text: provider.requiredEvidence }]),
      ],
    })),
  ];
}

function hostedIdentityRoleSurfaceArchitectureText(item) {
  return item.roleSurfaceArchitectureChanged
    ? "role surface changed"
    : "role surface preserved";
}

function hostedHandoffOperatorProofRows(drilldowns) {
  const normalizedDrilldowns = Array.isArray(drilldowns) ? drilldowns : [];
  if (normalizedDrilldowns.length === 0) {
    return [];
  }
  return [
    {
      id: "operator-drilldowns",
      testId: "admin-audit-hosted-identity-operator-drilldowns",
      values: [
        {
          id: "heading",
          text: "Hosted identity operator drilldowns",
          emphasized: true,
        },
      ],
      subentries: normalizedDrilldowns.map((drilldown) => ({
        id: `operator-proof-${drilldown.id}`,
        testId: `admin-audit-hosted-handoff-operator-proof-${drilldown.id}`,
        values: [
          { id: "label", text: drilldown.label, emphasized: true },
          { id: "command", text: drilldown.command },
          { id: "progressionId", text: drilldown.progressionId },
          { id: "sourcePath", text: drilldown.sourcePath },
          { id: "proofTarget", text: drilldown.proofTarget },
          { id: "roleUrl", text: drilldown.roleUrl },
          ...hostedHandoffOperatorProofActionValues(drilldown),
          ...hostedHandoffOperatorRunSequenceValues(drilldown),
          { id: "firstMissingInputId", text: drilldown.firstMissingInputId },
          { id: "firstMissingCheckId", text: drilldown.firstMissingCheckId },
          { id: "proofBoundary", text: drilldown.proofBoundary },
        ],
      })),
    },
  ];
}

function hostedHandoffOperatorRunSequenceValues(drilldown) {
  return (Array.isArray(drilldown.operatorRunSequence)
    ? drilldown.operatorRunSequence
    : []
  ).flatMap((step, index) => [
    {
      id: `runSequence${index + 1}`,
      text: `${step.label}: ${step.command}`,
    },
    {
      id: `runSequence${index + 1}ProofTarget`,
      text: step.proofTarget,
    },
  ]);
}

function hostedHandoffOperatorProofActionValues(drilldown) {
  const baseTestId = `admin-audit-hosted-handoff-operator-proof-${drilldown.id}`;
  return [
    {
      id: "copyCommand",
      text: "Copy command",
      copyText: drilldown.command,
      testId: `${baseTestId}-copy-command`,
    },
    {
      id: "openSource",
      text: "Open doc",
      href: drilldown.sourcePath,
      testId: `${baseTestId}-open-doc`,
    },
    {
      id: "openProofTarget",
      text: "Open proof",
      href: drilldown.proofTarget,
      testId: `${baseTestId}-open-proof-target`,
    },
  ];
}

function buildHostedHandoffProgressionRows({ checklist, artifactSummary }) {
  if (artifactSummaryHasProgressionRows(artifactSummary)) {
    return Object.freeze([]);
  }
  const progressions = Array.isArray(
    checklist?.progressionSummary?.progressions,
  )
    ? checklist.progressionSummary.progressions
    : [];
  return Object.freeze(
    progressions.map((progression) =>
      artifactSummaryRow({
        id: `progression-${progression.id}`,
        testId: `admin-audit-hosted-identity-progression-${progression.id}`,
        values: [
          { id: "id", text: progression.id, emphasized: true },
          { id: "adminProofMode", text: progression.adminProofMode },
          {
            id: "adminProofFixturePath",
            text: progression.adminProofFixturePath,
          },
          { id: "proofCommand", text: progression.proofCommand },
          { id: "evidencePath", text: progression.evidencePath },
          { id: "adminProofTarget", text: progression.adminProofTarget },
          { id: "roleUrl", text: progression.roleUrl },
          { id: "firstMissingInputId", text: progression.firstMissingInputId },
          { id: "firstMissingCheckId", text: progression.firstMissingCheckId },
          { id: "proofBoundary", text: progression.proofBoundary },
        ],
      }),
    ),
  );
}

function artifactSummaryHasProgressionRows(artifactSummary) {
  return (
    Array.isArray(artifactSummary?.progressionSummary?.progressions) &&
    artifactSummary.progressionSummary.progressions.length > 0
  );
}

function buildHostedHandoffBlockedReceiptRows({ checklist, headings }) {
  const receipt = checklist?.blockedReceipt;
  if (receipt === null || typeof receipt !== "object") {
    return Object.freeze([]);
  }
  return Object.freeze([
    artifactSummaryRow({
      id: "blocked-receipt",
      testId: "admin-audit-hosted-handoff-blocked-receipt",
      values: [
        {
          id: "heading",
          text: headings.blockedReceipt,
          emphasized: true,
        },
        { id: "status", text: receipt.status, emphasized: true },
        { id: "operatorAction", text: receipt.operatorAction },
        {
          id: "localVsHostedBoundary",
          text: receipt.localVsHostedBoundary,
        },
        ...(typeof receipt.rawEvidenceContractSummary === "string"
          ? [
              {
                id: "rawEvidenceContractSummary",
                text: receipt.rawEvidenceContractSummary,
              },
            ]
          : []),
        {
          id: "missingRequiredInputs",
          text: receipt.missingRequiredInputs.join(", "),
        },
        { id: "nextProofTarget", text: receipt.nextProofTarget },
      ],
      subentries: [
        ...hostedHandoffRawCaptureIntakeSubentries({
          intake: receipt.realHostedMatrixRawCaptureIntake,
          heading: headings.realHostedMatrixRawCaptureIntake,
        }),
        ...hostedHandoffFirstMissingOperatorArtifactSubentries({
          artifact: receipt.firstMissingOperatorArtifact,
          heading: headings.firstMissingOperatorArtifact,
        }),
        ...hostedHandoffBlockedOperatorPacketSubentries({
          packet: receipt.blockedOperatorPacket,
        }),
      ],
    }),
  ]);
}

function hostedHandoffBlockedOperatorPacketSubentries({ packet }) {
  const row = hostedOperatorPacketDescriptorRow({
    packet,
    id: "blocked-receipt-operator-packet",
    testId: "admin-audit-hosted-handoff-blocked-receipt-operator-packet",
    heading: "Blocked operator packet",
  });
  return row === null ? [] : [row];
}

function buildSelectedOperatorHandoffRows(handoff, { game }) {
  if (handoff === null || typeof handoff !== "object") {
    return Object.freeze([]);
  }
  const packetRow = hostedOperatorPacketDescriptorRow({
    packet: handoff.blockedOperatorPacket,
    id: "selected-operator-handoff-packet",
    testId: "admin-audit-selected-operator-handoff-packet",
    heading: "Selected blocked operator packet",
  });
  return Object.freeze([
    artifactSummaryRow({
      id: "selected-operator-handoff",
      testId: "admin-audit-selected-operator-handoff",
      values: [
        {
          id: "heading",
          text: "Selected operator handoff",
          emphasized: true,
        },
        { id: "status", text: handoff.status },
        { id: "command", text: handoff.command },
        { id: "unprovenId", text: handoff.unprovenId },
        { id: "firstMissingInputId", text: handoff.firstMissingInputId },
        {
          id: "selectedProductionFeatureRoleUrl",
          text: handoff.selectedProductionFeatureRoleUrl,
          href: seededRoleUrlToAdminHref(
            handoff.selectedProductionFeatureRoleUrl,
            { game },
          ),
        },
        {
          id: "selectedProductionFeatureGraphNodeId",
          text: handoff.selectedProductionFeatureGraphNodeId,
        },
      ],
      subentries: packetRow === null ? [] : [packetRow],
    }),
  ]);
}

function hostedOperatorPacketDescriptorRow({
  packet,
  id,
  testId,
  heading,
}) {
  if (packet === null || typeof packet !== "object") {
    return null;
  }
  return {
    id,
    testId,
    values: [
      {
        id: "heading",
        text: heading,
        emphasized: true,
      },
      { id: "status", text: packet.status },
      { id: "operatorAction", text: packet.operatorAction },
      { id: "localVsHostedBoundary", text: packet.localVsHostedBoundary },
      { id: "firstMissingInputId", text: packet.firstMissingInputId },
      { id: "firstMissingCheckId", text: packet.firstMissingCheckId },
      {
        id: "firstMissingSectionId",
        text: packet.firstMissingSectionId,
      },
      {
        id: "selectedProductionFeatureRoleUrl",
        text: packet.selectedProductionFeatureRoleUrl,
      },
      {
        id: "selectedProductionFeatureGraphNodeId",
        text: packet.selectedProductionFeatureGraphNodeId,
      },
      {
        id: "rawEvidenceContractSummary",
        text: packet.rawEvidenceContractSummary,
      },
      {
        id: "rawEvidenceContractRequiredTopLevelFields",
        text: packet.rawEvidenceContractRequiredTopLevelFields.join(", "),
      },
      ...rawEvidenceTemplateDescriptorValues(packet.rawEvidenceTemplate),
      ...hostedEvidenceOperatorChecklistDescriptorValues(packet.operatorChecklist),
      { id: "proofTarget", text: packet.proofTarget },
      { id: "nextProofTarget", text: packet.nextProofTarget },
    ],
  };
}

function hostedEvidenceOperatorChecklistDescriptorValues(checklist) {
  if (checklist === null || checklist === undefined) {
    return [];
  }
  return [
    { id: "operatorChecklistId", text: checklist.id },
    { id: "operatorChecklistPath", text: checklist.path },
    {
      id: "operatorChecklistChecklistProofCommand",
      text: checklist.checklistProofCommand,
    },
    {
      id: "operatorChecklistChecklistProofTarget",
      text: checklist.checklistProofTarget,
    },
    { id: "operatorChecklistCommand", text: checklist.command },
    { id: "operatorChecklistProofTarget", text: checklist.proofTarget },
    { id: "operatorChecklistPreflightTarget", text: checklist.preflightTarget },
    {
      id: "operatorChecklistRawEvidenceTemplatePath",
      text: checklist.rawEvidenceTemplatePath,
    },
    {
      id: "operatorChecklistRawEvidenceTemplateProofCommand",
      text: checklist.rawEvidenceTemplateProofCommand,
    },
    {
      id: "operatorChecklistRawCaptureCommand",
      text: checklist.rawCaptureCommand,
    },
    {
      id: "operatorChecklistRawCaptureProofTarget",
      text: checklist.rawCaptureProofTarget,
    },
    ...(Array.isArray(checklist.operatorRunSequence)
      ? checklist.operatorRunSequence.flatMap((step, index) => [
          {
            id: `operatorChecklistRunSequence${index + 1}`,
            text: `${step.label}: ${step.command}`,
          },
          {
            id: `operatorChecklistRunSequence${index + 1}ProofTarget`,
            text: step.proofTarget,
          },
        ])
      : []),
  ];
}

function rawEvidenceTemplateDescriptorValues(template) {
  return hostedMatrixRawEvidenceTemplateDescriptorFieldValues(template).map(
    (field) => ({ id: field.rowId, text: field.value }),
  );
}

function normalizeRawEvidenceTemplateDescriptorObject(template) {
  if (template === null || typeof template !== "object") {
    return undefined;
  }
  return Object.freeze(
    Object.fromEntries(
      hostedMatrixRawEvidenceTemplateDescriptorFieldValues(template).map(
        (field) => [field.key, String(field.value ?? "")],
      ),
    ),
  );
}

function rawEvidenceTemplateDescriptorProperty(template) {
  const rawEvidenceTemplate =
    normalizeRawEvidenceTemplateDescriptorObject(template);
  return rawEvidenceTemplate === undefined ? {} : { rawEvidenceTemplate };
}

function hostedHandoffRawCaptureIntakeSubentries({ intake, heading }) {
  if (intake === null || typeof intake !== "object") {
    return [];
  }
  return [
    {
      id: "blocked-receipt-raw-capture-intake",
      testId: "admin-audit-hosted-handoff-blocked-receipt-raw-capture-intake",
      values: [
        { id: "heading", text: heading, emphasized: true },
        { id: "command", text: intake.command },
        { id: "proofTarget", text: intake.proofTarget },
        { id: "status", text: intake.status },
        { id: "blockedCheckIds", text: intake.blockedCheckIds.join(", ") },
      ],
    },
  ];
}

function hostedHandoffFirstMissingOperatorArtifactSubentries({
  artifact,
  heading,
}) {
  if (artifact === null || typeof artifact !== "object") {
    return [];
  }
  return [
    {
      id: "blocked-receipt-first-missing-operator-artifact",
      testId:
        "admin-audit-hosted-handoff-blocked-receipt-first-missing-operator-artifact",
      values: [
        { id: "heading", text: heading, emphasized: true },
        { id: "inputId", text: artifact.inputId },
        { id: "checkId", text: artifact.checkId },
        { id: "sectionId", text: artifact.sectionId },
        { id: "sectionLabel", text: artifact.sectionLabel },
        { id: "requiredEvidence", text: artifact.requiredEvidence },
        { id: "purpose", text: artifact.purpose },
        { id: "proofTarget", text: artifact.proofTarget },
        {
          id: "localCapabilityRoleUrl",
          text: artifact.roleSurfaceDrilldown.localCapabilityRoleUrl,
        },
        {
          id: "handoffRoleUrl",
          text: artifact.roleSurfaceDrilldown.handoffRoleUrl,
        },
        {
          id: "proofGraphNodeId",
          text: artifact.roleSurfaceDrilldown.proofGraphNodeId,
        },
        {
          id: "productionFeatureGraphNodeId",
          text: artifact.roleSurfaceDrilldown.productionFeatureGraphNodeId,
        },
        {
          id: "proofGraphEvidencePath",
          text: artifact.roleSurfaceDrilldown.proofGraphEvidencePath,
        },
      ],
    },
  ];
}

function buildSetupCommandEvidenceRows(setupCommandEvidence) {
  return Object.freeze(
    setupCommandEvidence.map((command) =>
      artifactSummaryRow({
        id: `setup-command-evidence-${command.id}`,
        testId: `admin-audit-setup-command-evidence-${command.id}`,
        values: [
          { id: "id", text: command.id, emphasized: true },
          { id: "status", text: command.status },
          { id: "commandKind", text: command.commandKind },
          { id: "readinessSummary", text: command.readinessSummary },
        ],
      }),
    ),
  );
}

function buildAdminAuditHandoffPathRows(handoffPath) {
  if (handoffPath === null || typeof handoffPath !== "object") {
    return Object.freeze([]);
  }
  return Object.freeze([
    artifactSummaryRow({
      id: "handoff-path",
      testId: "admin-audit-handoff-path",
      values: [
        {
          id: "downstreamStatus",
          text: handoffPath.downstreamStatus,
          emphasized: true,
        },
        { id: "upstreamLabel", text: handoffPath.upstreamLabel },
        { id: "upstreamAuditId", text: handoffPath.upstreamAuditId },
        {
          id: "localCapabilityAuditId",
          text: handoffPath.localCapabilityAuditId,
        },
        { id: "downstreamCommand", text: handoffPath.downstreamCommand },
        {
          id: "downstreamProofTarget",
          text: handoffPath.downstreamProofTarget,
        },
      ],
    }),
  ]);
}

function buildRealHostedEvidenceInputRows(realHostedEvidenceInputs) {
  return Object.freeze(
    realHostedEvidenceInputs.map((input) =>
      artifactSummaryRow({
        id: `real-hosted-evidence-input-${input.id}`,
        testId: `admin-audit-real-hosted-evidence-input-${input.id}`,
        values: [
          { id: "label", text: input.label, emphasized: true },
          { id: "value", text: input.value },
          { id: "required", text: input.required ? "required" : "optional" },
        ],
      }),
    ),
  );
}

function normalizeRawEvidenceTemplateDescriptor() {
  return hostedMatrixRawEvidenceTemplateDescriptor();
}

function buildRawEvidenceTemplateRows(template) {
  if (template === null || typeof template !== "object") {
    return Object.freeze([]);
  }
  return Object.freeze([
    artifactSummaryRow({
      id: "operator-template",
      testId: "admin-audit-raw-evidence-template-operator-template",
      values: [
        { id: "heading", text: "Raw evidence template", emphasized: true },
        { id: "status", text: template.status },
        { id: "path", text: template.path },
        { id: "proofCommand", text: template.proofCommand },
        { id: "proofTarget", text: template.proofTarget },
        { id: "copyToEnv", text: template.copyToEnv },
        { id: "validatorCommand", text: template.validatorCommand },
        { id: "validatorProofTarget", text: template.validatorProofTarget },
      ],
    }),
  ]);
}

function hostedReadinessText(value, label) {
  return value === true ? `${label} ready` : `${label} not ready`;
}

function buildHostedTargetPreflightSummarySections(artifactSummary) {
  return Object.freeze([
    buildSingleRowArtifactSummarySection({
      id: "hosted-target-preflight-summary",
      heading: "Hosted target preflight",
      values: [
        {
          id: "rawCaptureStatus",
          text: artifactSummary.rawCaptureStatus,
          emphasized: true,
        },
        { id: "rawCapturePath", text: artifactSummary.rawCapturePath },
        {
          id: "rawCaptureBlockedCheckIds",
          text: artifactSummary.rawCaptureBlockedCheckIds.join(", "),
        },
        { id: "rawEvidencePath", text: artifactSummary.rawEvidencePath },
        { id: "rawEvidenceStatus", text: artifactSummary.rawEvidenceStatus },
        { id: "nextCommand", text: artifactSummary.nextCommand },
        { id: "nextProofTarget", text: artifactSummary.nextProofTarget },
        {
          id: "releaseReady",
          text: hostedReadinessText(artifactSummary.releaseReady, "release"),
        },
        {
          id: "productionReady",
          text: hostedReadinessText(artifactSummary.productionReady, "production"),
        },
      ],
    }),
  ]);
}

function buildHostedEvidenceLaneSummarySections(artifactSummary) {
  return Object.freeze([
    buildSingleRowArtifactSummarySection({
      id: "hosted-evidence-lane-summary",
      heading: "Hosted evidence lane",
      values: [
        {
          id: "realHostedEvidenceStatus",
          text: artifactSummary.realHostedEvidenceStatus,
          emphasized: true,
        },
        { id: "hostedEvidenceMode", text: artifactSummary.hostedEvidenceMode },
        { id: "externalEvidencePath", text: artifactSummary.externalEvidencePath },
        { id: "rawEvidencePath", text: artifactSummary.rawEvidencePath },
        { id: "rawEvidenceStatus", text: artifactSummary.rawEvidenceStatus },
        { id: "nextCommand", text: artifactSummary.nextCommand },
        { id: "nextProofTarget", text: artifactSummary.nextProofTarget },
        {
          id: "releaseReady",
          text: hostedReadinessText(artifactSummary.releaseReady, "release"),
        },
        {
          id: "productionReady",
          text: hostedReadinessText(artifactSummary.productionReady, "production"),
        },
      ],
    }),
  ]);
}

function buildHostedIdentityEvidenceSummarySections(artifactSummary) {
  return Object.freeze([
    ...hostedIdentityPacketSummarySections(artifactSummary.redactedIntakePacket),
    ...hostedIdentityProgressionSummarySections(
      artifactSummary.progressionSummary,
    ),
    ...hostedIdentityRoleSurfaceContractSummarySections(
      artifactSummary.roleSurfaceContractDiff,
    ),
    ...hostedIdentityAdapterContractSummarySections(
      artifactSummary.identityAdapterContractComparison,
    ),
  ]);
}

function hostedIdentityPacketSummarySections(packet) {
  if (!Array.isArray(packet?.sections) || packet.sections.length === 0) {
    return [];
  }
  return [
    buildArtifactSummarySection({
      id: "hosted-identity-packet",
      heading: "Hosted identity packet",
      rows: [
        {
          id: "hosted-identity-packet-summary-status",
          values: [
            { id: "status", text: packet.status, emphasized: true },
            {
              id: "providedSections",
              text: `${packet.providedSectionCount}/${packet.sectionCount} sections provided`,
            },
            {
              id: "missingSections",
              text: `${packet.missingSectionCount} sections missing`,
            },
          ],
        },
        {
          id: "hosted-identity-packet-summary-inputs",
          values: [
            {
              id: "providedInputs",
              text: `${packet.providedInputCount}/${packet.requiredInputCount} inputs provided`,
              emphasized: true,
            },
            {
              id: "missingInputs",
              text: `${packet.missingInputCount} inputs missing`,
            },
          ],
        },
        {
          id: "hosted-identity-packet-summary-redacted-refs",
          values: [
            {
              id: "redactedRefs",
              text: `${packet.redactedEvidenceRefCount} redacted refs`,
              emphasized: true,
            },
          ],
        },
        ...packet.sections.map((section) =>
          hostedIdentityPacketSectionSummaryRow(section),
        ),
      ],
    }),
  ];
}

function hostedIdentityPacketSectionSummaryRow(section) {
  const requiredInputIds = Array.isArray(section?.requiredInputIds)
    ? section.requiredInputIds
    : [];
  const providedInputIds = Array.isArray(section?.providedInputIds)
    ? section.providedInputIds
    : [];
  const redactedEvidenceRefs = Array.isArray(section?.redactedEvidenceRefs)
    ? section.redactedEvidenceRefs
    : [];
  return {
    id: `hosted-identity-packet-section-${section.id}`,
    values: [
      { id: "label", text: section.label, emphasized: true },
      { id: "status", text: section.status },
      {
        id: "redactedEvidenceRefCount",
        text: `${section.redactedEvidenceRefCount} redacted refs`,
      },
      {
        id: "missingInputs",
        text: Array.isArray(section.missingInputs)
          ? section.missingInputs.join(", ")
          : "",
      },
    ],
    subentries: [
      ...requiredInputIds.map((inputId) => ({
        id: `hosted-identity-packet-input-${section.id}-${inputId}`,
        values: [
          { id: "inputId", text: inputId, emphasized: true },
          {
            id: "status",
            text: providedInputIds.includes(inputId) ? "provided" : "missing",
          },
        ],
      })),
      ...redactedEvidenceRefs.map((ref) => ({
        id: `hosted-identity-packet-ref-${section.id}-${ref.id}`,
        values: [
          { id: "evidenceFamily", text: ref.evidenceFamily, emphasized: true },
          { id: "kind", text: ref.kind },
          { id: "capturedAt", text: ref.capturedAt },
          { id: "retentionWindow", text: ref.retentionWindow },
          { id: "exportLocator", text: ref.exportLocator },
        ],
      })),
    ],
  };
}

function hostedIdentityProgressionSummarySections(summary) {
  if (!Array.isArray(summary?.progressions) || summary.progressions.length === 0) {
    return [];
  }
  return [
    buildArtifactSummarySection({
      id: "hosted-identity-progression-summary",
      heading: "Hosted identity recovery ladder",
      rows: [
        {
          id: "hosted-identity-progression-summary",
          values: [
            { id: "status", text: summary.status, emphasized: true },
            {
              id: "progressionCount",
              text: `${summary.progressionCount} progression rows`,
            },
            { id: "nextCommand", text: summary.nextCommand },
            { id: "nextProofTarget", text: summary.nextProofTarget },
            { id: "proofBoundary", text: summary.proofBoundary },
          ],
        },
        ...summary.progressions.map((progression) => ({
          id: `hosted-identity-progression-${progression.id}`,
          values: [
            { id: "field", text: progression.field, emphasized: true },
            { id: "checkId", text: progression.checkId },
            { id: "missingInputId", text: progression.missingInputId },
            { id: "adminProofMode", text: progression.adminProofMode },
            { id: "missingFixturePath", text: progression.missingFixturePath },
            { id: "recoveredFixturePath", text: progression.recoveredFixturePath },
            {
              id: "adminProofFixturePath",
              text: progression.adminProofFixturePath,
            },
            { id: "proofCommand", text: progression.proofCommand },
            { id: "evidencePath", text: progression.evidencePath },
            { id: "adminProofTarget", text: progression.adminProofTarget },
            { id: "roleUrl", text: progression.roleUrl },
            { id: "firstMissingInputId", text: progression.firstMissingInputId },
            { id: "firstMissingCheckId", text: progression.firstMissingCheckId },
          ],
        })),
      ],
    }),
  ];
}

function hostedIdentityRoleSurfaceContractSummarySections(diff) {
  if (diff === null || typeof diff !== "object") {
    return [];
  }
  return [
    buildArtifactSummarySection({
      id: "hosted-identity-role-surface-contract",
      heading: "Role-surface contract",
      rows: [
        {
          id: "hosted-identity-role-surface-contract-diff-summary",
          values: [
            { id: "status", text: diff.status, emphasized: true },
            { id: "architectureId", text: diff.architectureId },
            {
              id: "mismatchCount",
              text: `${diff.mismatchCount} mismatches`,
            },
          ],
        },
        ...(diff.mismatches ?? []).map((mismatch) => ({
          id: `hosted-identity-role-surface-contract-mismatch-${mismatch.id}`,
          values: [
            { id: "path", text: mismatch.path, emphasized: true },
            { id: "expected", text: mismatch.expected },
            { id: "actual", text: mismatch.actual },
          ],
        })),
      ],
    }),
  ];
}

function hostedIdentityAdapterContractSummarySections(comparison) {
  if (comparison === null || typeof comparison !== "object") {
    return [];
  }
  return [
    buildArtifactSummarySection({
      id: "hosted-identity-adapter-contract-comparison",
      heading: "Hosted adapter contract",
      rows: [
        {
          id: "hosted-identity-adapter-contract-comparison-summary",
          values: [
            { id: "status", text: comparison.status, emphasized: true },
            { id: "localAdapterId", text: comparison.localAdapterId },
            { id: "hostedAdapterId", text: comparison.hostedAdapterId },
            {
              id: "roleSurfaceContractStatus",
              text: comparison.roleSurfaceContractStatus,
            },
            {
              id: "mismatchCount",
              text: `${comparison.mismatchCount} mismatches`,
            },
          ],
        },
        ...(comparison.mismatches ?? []).map((mismatch) => ({
          id: `hosted-identity-adapter-contract-comparison-mismatch-${mismatch.id}`,
          values: [
            { id: "path", text: mismatch.path, emphasized: true },
            { id: "expected", text: mismatch.expected },
            { id: "actual", text: mismatch.actual },
          ],
        })),
      ],
    }),
  ];
}

function buildIdentityAdapterSummarySections(artifactSummary) {
  return Object.freeze([
    ...identityAdapterContractSummarySections(artifactSummary.adapterContract),
  ]);
}

function identityAdapterContractSummarySections(contract) {
  if (contract === null || typeof contract !== "object") {
    return [];
  }
  return [
    buildArtifactSummarySection({
      id: "identity-adapter-contract",
      heading: "Identity adapter contract",
      rows: [
        {
          id: "identity-adapter-contract-summary",
          values: [
            { id: "status", text: contract.status, emphasized: true },
            { id: "adapterId", text: contract.adapterId },
            {
              id: "roleSurfaceContractStatus",
              text: contract.roleSurfaceContractStatus,
            },
            {
              id: "mismatchCount",
              text: `${contract.mismatchCount} mismatches`,
            },
          ],
        },
        ...(contract.mismatches ?? []).map((mismatch) => ({
          id: `identity-adapter-contract-mismatch-${mismatch.id}`,
          values: [{ id: "path", text: mismatch.path, emphasized: true }],
        })),
      ],
    }),
  ];
}

function buildHostedMatrixSummarySections(artifactSummary) {
  const summary = artifactSummary.hostedMatrixSummary;
  return Object.freeze([
    buildArtifactSummarySection({
      id: "hosted-matrix-summary",
      heading: "Hosted race matrix",
      rows: [
        {
          id: "hosted-matrix-summary-coverage",
          values: [
            { id: "status", text: summary.status, emphasized: true },
            {
              id: "passedCells",
              text: `${summary.passedCellCount}/${summary.cellCount} cells passed`,
            },
            {
              id: "reloadCoverage",
              text: `${summary.reloadCoveredCellCount}/${summary.cellCount} reloads covered`,
            },
            {
              id: "reconnectLanes",
              text: `${summary.reconnectLaneCount} reconnect lanes`,
            },
            {
              id: "staleConflictLanes",
              text: `${summary.staleConflictLaneCount} stale conflict lanes`,
            },
          ],
        },
        {
          id: "hosted-matrix-summary-hosted-evidence",
          values: [
            {
              id: "hostedEvidenceStatus",
              text: summary.hostedEvidenceStatus,
              emphasized: true,
            },
            {
              id: "hostedDeploymentStatus",
              text: summary.hostedDeploymentStatus,
            },
            { id: "hostedEvidenceMode", text: summary.hostedEvidenceMode },
          ],
        },
        {
          id: "hosted-matrix-summary-missing-inputs",
          values: [
            {
              id: "missingHostedInputCount",
              text: `${summary.missingHostedInputCount} missing hosted inputs`,
              emphasized: true,
            },
            {
              id: "missingHostedInputIds",
              text: summary.missingHostedInputIds.join(", "),
            },
            {
              id: "localVsHostedBoundary",
              text: summary.localVsHostedBoundary,
            },
          ],
        },
      ],
    }),
  ]);
}

function buildRealHostedObservabilitySummarySections(artifactSummary) {
  const summary = artifactSummary.realHostedObservabilitySummary;
  return Object.freeze([
    buildArtifactSummarySection({
      id: "real-hosted-observability-summary",
      heading: "Real hosted observability",
      rows: [
        {
          id: "real-hosted-observability-summary-status",
          values: [
            { id: "status", text: summary.status, emphasized: true },
            {
              id: "passedChecks",
              text: `${summary.passedCheckCount}/${summary.checkCount} checks passed`,
            },
            {
              id: "blockedChecks",
              text: `${summary.blockedCheckCount} checks blocked`,
            },
          ],
        },
        {
          id: "real-hosted-observability-summary-inputs",
          values: [
            {
              id: "providedInputs",
              text: `${summary.providedInputCount}/${summary.requiredInputCount} inputs provided`,
              emphasized: true,
            },
            {
              id: "missingInputs",
              text: `${summary.missingInputCount} inputs missing`,
            },
          ],
        },
        {
          id: "real-hosted-observability-summary-baseline",
          values: [
            {
              id: "baselineStatus",
              text: summary.baselineStatus,
              emphasized: true,
            },
            {
              id: "localHostedOpsSignalsPath",
              text: summary.localHostedOpsSignalsPath,
            },
            {
              id: "localVsHostedBoundary",
              text: summary.localVsHostedBoundary,
            },
          ],
        },
      ],
    }),
  ]);
}

export async function buildAdminRouteData({
  principalUserId,
  capabilities = [],
  game = "midsummer",
  fetchImpl = null,
  apiBaseUrl = "",
  sessionToken = null,
  identityPrincipalUserId = "host_h",
  proofRun = null,
  opsArtifacts = null,
  seedFixtureSummary = null,
  releaseReadinessChecklist = null,
  releaseRunbook = null,
  backupRestoreProof = null,
  identityAdapterProof = null,
  spineManifest = null,
  adminSpineProof = null,
  adminSpineTerminalBatches = null,
  proofGraph = null,
  raceCoverage = null,
  hostedConcurrentRaceMatrix = null,
  hostedOpsSignals = null,
  realHostedObservabilityHandoff = null,
  hostedTargetPreflight = null,
  hostedEvidenceLane = null,
  hostedEvidenceLaneDemoProof = null,
  hostedIdentityEvidence = null,
  hostedIdentityProgressionSummary = null,
  nextAction = null,
  proofFreshness = null,
}) {
  const access = resolveSurfaceAccess({
    surface: "admin",
    game: null,
    capabilities,
  });
  const coldData = await loadAdminColdData({
    game,
    principalUserId,
    fetchImpl,
    apiBaseUrl,
    sessionToken,
    identityPrincipalUserId,
    fallback: adminFixtureColdLoad({ game, principalUserId }),
  });

  return Object.freeze({
    shell: buildAppShell({
      game,
      activeSurface: "admin",
      principalUserId,
      capabilities,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "admin",
      eyebrow: "Admin",
      title: "Operations",
      summary:
        "Game setup, scoped session grants, audit reports, and recovery queues.",
      capabilityLabel: access.capabilityLabel,
      capabilityTestId: ADMIN_ROUTE_CONTRACT.capabilityTestId,
    }),
    access,
    operator: Object.freeze({
      principalUserId,
      capabilityLabel: access.capabilityLabel,
    }),
    command: Object.freeze({
      endpoint: "/commands",
      createGame: Object.freeze({
        action: "create_game",
        game,
        pack: "mafiascum",
      }),
      cohost: Object.freeze({
        action: "add_cohost",
        game,
        user: "cohost_c",
      }),
      sessionGrant: Object.freeze({
        action: "grant_session",
        token: `session-grant-${game}`,
        principalUserId: "mod_a",
        expiresAt: 4_102_444_800,
        globalCapabilities: Object.freeze(["GlobalMod"]),
      }),
    }),
    gameSetup: Object.freeze([
      Object.freeze({
        id: "create-game",
        label: "Create game",
        value: "Pack mafiascum",
        authority: "GlobalAdmin",
        boundary: "Command pipeline",
        boundaryDetail: "/commands CreateGame Ack/Reject",
        commandAction: "create_game",
        confirmLabel: "Create game",
        confirmMessage: "Create game midsummer from pack mafiascum",
        buttonLabel: "Review",
      }),
      Object.freeze({
        id: "host-setup",
        label: "Host setup workflow",
        value: `/g/${game}/setup`,
        authority: "HostOf(game)",
        boundary: "Game-specific setup",
        boundaryDetail: "Roster, roles, policy, invites, and StartGame readiness",
        commandAction: "navigate",
        href: `/g/${game}/setup`,
        buttonLabel: "Open setup",
      }),
      Object.freeze({
        id: "session-grants",
        label: "Session grants",
        value: "GlobalMod for mod_a",
        authority: "GlobalAdmin",
        boundary: "Authenticated session grant",
        boundaryDetail: "/auth/session-grants requires active GlobalAdmin session",
        commandAction: "grant_session",
        confirmLabel: "Grant GlobalMod",
        confirmMessage: "Grant GlobalMod to mod_a",
        buttonLabel: "Review",
      }),
      Object.freeze({
        id: "cohost",
        label: "Cohost delegation",
        value: "cohost_c",
        authority: "HostOf(game)",
        boundary: "Command pipeline",
        boundaryDetail: "/commands AddCohost host-gated by committed game grants",
        commandAction: "add_cohost",
        confirmLabel: "Delegate cohost_c",
        confirmMessage: "Delegate cohost_c as cohost for this game",
        buttonLabel: "Review",
      }),
    ]),
    ...coldData,
    audit: withAdminAuditInspectLinks(
      appendLocalNextActionAudit(
        appendLocalRealHostedObservabilityHandoffAudit(
          appendLocalHostedOpsSignalsAudit(
            appendLocalHostedEvidenceLaneAudit(
              appendLocalHostedTargetPreflightAudit(
                appendLocalHostedConcurrentRaceMatrixAudit(
                  appendLocalRaceCoverageAudit(
                    appendLocalProofGraphAudit(
                      appendLocalProofFreshnessAudit(
                        appendLocalAdminSpineAudit(
                          appendLocalSpineManifestAudit(
                            appendLocalHostedIdentityEvidenceAudit(
                              appendLocalIdentityAdapterAudit(
                                appendLocalBackupRestoreAudit(
                                  appendLocalReleaseRunbookAudit(
                                    appendLocalHostSetupProofAudit(
                                      appendLocalReleaseReadinessAudit(
                                        appendLocalSeedFixtureAudit(
                                          appendLocalOpsArtifactsAudit(
                                            appendLocalPlayerRecoveryAudit(
                                              appendLocalHardeningAudit(
                                                appendLocalCoreLoopAudit(coldData.audit, proofRun, { game }),
                                                proofRun,
                                                { game },
                                              ),
                                              proofRun,
                                              { game },
                                            ),
                                            opsArtifacts,
                                            { game },
                                          ),
                                          seedFixtureSummary,
                                          { game },
                                        ),
                                        releaseReadinessChecklist,
                                        { game, nextAction },
                                      ),
                                      releaseReadinessChecklist,
                                      { game },
                                    ),
                                    releaseRunbook,
                                    { game },
                                  ),
                                  backupRestoreProof,
                                  { game },
                                ),
                                identityAdapterProof,
                                { game },
                              ),
                              hostedIdentityEvidence,
                              { game, hostedIdentityProgressionSummary },
                            ),
                            spineManifest,
                            { game },
                          ),
                          adminSpineProof,
                          { game, terminalBatchProof: adminSpineTerminalBatches },
                        ),
                        proofFreshness,
                        { game, nextAction },
                      ),
                      proofGraph,
                      { game },
                    ),
                    raceCoverage,
                    { game },
                  ),
                  hostedConcurrentRaceMatrix,
                  { game },
                ),
                hostedTargetPreflight,
                { game },
              ),
              hostedEvidenceLane,
              { game, hostedEvidenceLaneDemoProof },
            ),
            hostedOpsSignals,
            { game },
          ),
          realHostedObservabilityHandoff,
          { game },
        ),
        nextAction,
        { game, proofGraph },
      ),
      { game },
    ),
    recoveryTasks: Object.freeze([
      Object.freeze({
        id: "recovery-gate",
        label: "Recovery go/no-go",
        value: "Check saved production proof artifacts before recovery",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Read-only operator proof",
        boundaryDetail: "/operator/proof-runs/go-no-go machine-readable report",
        action: "check_recovery_gate",
        buttonLabel: "Check gate",
        confirmLabel: "Run check",
        confirmMessage: "Read saved go/no-go proof artifacts for this game",
        endpoint: operatorProofRunUrl({
          game,
          principalUserId,
          path: "operator/proof-runs/go-no-go",
        }),
      }),
    ]),
    escalations: Object.freeze([
      Object.freeze({
        id: "visibility",
        label: "Visibility review",
        value: "Private-channel bytes stay server-filtered",
      }),
      Object.freeze({
        id: "moderation",
        label: "Cross-game moderation",
        value: "GlobalMod only",
      }),
    ]),
  });
}

export async function buildAdminAuditDetailData({
  audit,
  principalUserId,
  capabilities = [],
  game = "midsummer",
  fetchImpl = null,
  apiBaseUrl = "",
  sessionToken = null,
  identityPrincipalUserId = "host_h",
  proofRun = null,
  opsArtifacts = null,
  seedFixtureSummary = null,
  releaseReadinessChecklist = null,
  releaseRunbook = null,
  backupRestoreProof = null,
  identityAdapterProof = null,
  spineManifest = null,
  adminSpineProof = null,
  adminSpineTerminalBatches = null,
  proofGraph = null,
  raceCoverage = null,
  hostedConcurrentRaceMatrix = null,
  hostedOpsSignals = null,
  realHostedObservabilityHandoff = null,
  hostedTargetPreflight = null,
  hostedEvidenceLane = null,
  hostedEvidenceLaneDemoProof = null,
  hostedIdentityEvidence = null,
  hostedIdentityProgressionSummary = null,
  nextAction = null,
  proofFreshness = null,
}) {
  const data = await buildAdminRouteData({
    principalUserId,
    capabilities,
    game,
    fetchImpl,
    apiBaseUrl,
    sessionToken,
    identityPrincipalUserId,
    proofRun,
    opsArtifacts,
    seedFixtureSummary,
    releaseReadinessChecklist,
    releaseRunbook,
    backupRestoreProof,
    identityAdapterProof,
    spineManifest,
    adminSpineProof,
    adminSpineTerminalBatches,
    proofGraph,
    raceCoverage,
    hostedConcurrentRaceMatrix,
    hostedOpsSignals,
    realHostedObservabilityHandoff,
    hostedTargetPreflight,
    hostedEvidenceLane,
    hostedEvidenceLaneDemoProof,
    hostedIdentityEvidence,
    hostedIdentityProgressionSummary,
    nextAction,
    proofFreshness,
  });
  const auditId = requiredAuditId(audit);
  const item = data.audit.find((candidate) => candidate.id === auditId);
  const detailAudit =
    item === undefined
      ? null
      : withAdminAuditDetailDisplayRows(item, { game });

  return Object.freeze({
    shell: data.shell,
    access: data.access,
    operator: data.operator,
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "admin",
      eyebrow: "Admin audit",
      title: item?.label ?? auditId,
      summary: item?.boundaryDetail ?? "Audit row unavailable.",
      capabilityLabel: data.operator.capabilityLabel,
      capabilityTestId: "admin-audit-detail-capability",
    }),
    game: Object.freeze({
      id: game,
      label: game,
    }),
    overviewHref: adminOverviewHref({ game }),
    audit: detailAudit,
    auditId,
    status: item === undefined ? "missing" : "available",
  });
}

function withAdminAuditDetailDisplayRows(item, { game }) {
  const checksRows = buildSimpleAdminAuditRows({
    items: item.checks,
    idPrefix: "check",
    testIdPrefix: "admin-audit-check",
    valuesForItem: (check) => [
      { id: "id", text: check.id, emphasized: true },
      { id: "status", text: check.status },
    ],
  });
  const sessionsRows = buildSimpleAdminAuditRows({
    items: item.sessions,
    idPrefix: "session",
    testIdPrefix: "admin-audit-session",
    itemId: (session) => session.role,
    valuesForItem: (session) => [
      { id: "role", text: session.role, emphasized: true },
      { id: "capabilities", text: session.capabilities.join(", ") },
    ],
  });
  const proofLaneCoverageRows = buildSimpleAdminAuditRows({
    items: item.proofLaneCoverage,
    idPrefix: "proof-lane-coverage",
    testIdPrefix: "admin-audit-proof-lane-coverage",
    valuesForItem: (coverage) => [
      { id: "label", text: coverage.label, emphasized: true },
      { id: "status", text: coverage.status },
      { id: "laneIds", text: coverage.laneIds.join(", ") },
    ],
  });
  const scenarioRows = buildSimpleAdminAuditRows({
    items: item.scenarios,
    idPrefix: "scenario",
    testIdPrefix: "admin-audit-scenario",
    valuesForItem: (scenario) => [
      { id: "title", text: scenario.title, emphasized: true },
      { id: "status", text: scenario.status },
      { id: "role", text: scenario.role },
    ],
  });
  const unprovenRows = buildUnprovenRows(item.unproven);
  const relatedLinkRows = buildRelatedLinkRows(item.relatedLinks);
  const reconnectLaneRows = buildSimpleAdminAuditRows({
    items: item.reconnectLanes,
    idPrefix: "reconnect-lane",
    testIdPrefix: "admin-audit-reconnect-lane",
    valuesForItem: (lane) => [
      { id: "label", text: lane.label, emphasized: true },
      { id: "status", text: lane.status },
    ],
  });
  const staleConflictLaneRows = buildSimpleAdminAuditRows({
    items: item.staleConflictLanes,
    idPrefix: "stale-conflict-lane",
    testIdPrefix: "admin-audit-stale-conflict-lane",
    valuesForItem: (lane) => [
      { id: "label", text: lane.label, emphasized: true },
      { id: "status", text: lane.status },
    ],
  });
  const scenarioFamilyRows = buildCoreLoopScenarioFamilyRows(
    item.scenarioFamilies,
  );
  const spineRecoveryHookRows = buildSimpleAdminAuditRows({
    items: item.spineRecoveryHooks,
    idPrefix: "spine-recovery-hook",
    testIdPrefix: "admin-audit-spine-recovery",
    valuesForItem: (hook) => [
      { id: "label", text: hook.label, emphasized: true },
      { id: "status", text: hook.status },
    ],
  });
  const spineCycleRows = buildCoreLoopSpineCycleRows(item.spineCycles);
  const commandProofRoleUrlAuditRows = buildCoreLoopCommandProofRoleUrlAuditRows(
    item.commandProofRoleUrlAudit,
  );
  const hostVisibleRecoveryRows = buildSimpleAdminAuditRows({
    items: item.hostVisibleRecoveries,
    idPrefix: "host-visible-recovery",
    testIdPrefix: "admin-audit-host-visible-recovery",
    valuesForItem: (summary) => [
      { id: "label", text: summary.label, emphasized: true },
      { id: "status", text: summary.status },
      { id: "group", text: summary.group },
      { id: "hook", text: summary.recoveryHookStatus },
      { id: "command", text: summary.commandKind },
      { id: "receipt", text: summary.receiptStatusText },
      { id: "refreshedPhase", text: summary.refreshedPhaseId ?? "" },
      { id: "hostRoleUrl", text: summary.hostRoleUrl },
      { id: "actionPlayerRoleUrl", text: summary.actionPlayerRoleUrl },
    ],
  });
  const localPrerequisiteRows = buildLocalPrerequisiteRows(
    item.localPrerequisites,
    { game },
  );
  const selectedOperatorHandoffRows = buildSelectedOperatorHandoffRows(
    item.selectedOperatorHandoff,
    { game },
  );
  const batchRows = buildAdminSpineBatchRows(item.batches);
  const terminalValidationRows = buildAdminSpineTerminalValidationRows(
    item.terminalValidations,
  );
  const productionFeatureDestinationSections =
    buildProductionFeatureDestinationSections(
      item.artifactSummary?.productionFeatureDestinationSummary,
      { game },
    );
  return Object.freeze({
    ...item,
    ...(checksRows.length === 0 ? {} : { checksRows }),
    ...(sessionsRows.length === 0 ? {} : { sessionsRows }),
    ...(proofLaneCoverageRows.length === 0 ? {} : { proofLaneCoverageRows }),
    ...(scenarioRows.length === 0 ? {} : { scenarioRows }),
    ...(unprovenRows.length === 0 ? {} : { unprovenRows }),
    ...(relatedLinkRows.length === 0 ? {} : { relatedLinkRows }),
    ...(reconnectLaneRows.length === 0 ? {} : { reconnectLaneRows }),
    ...(staleConflictLaneRows.length === 0 ? {} : { staleConflictLaneRows }),
    ...(scenarioFamilyRows.length === 0 ? {} : { scenarioFamilyRows }),
    ...(spineRecoveryHookRows.length === 0
      ? {}
      : { spineRecoveryHookRows }),
    ...(spineCycleRows.length === 0 ? {} : { spineCycleRows }),
    ...(commandProofRoleUrlAuditRows.length === 0
      ? {}
      : { commandProofRoleUrlAuditRows }),
    ...(hostVisibleRecoveryRows.length === 0
      ? {}
      : { hostVisibleRecoveryRows }),
    ...(localPrerequisiteRows.length === 0 ? {} : { localPrerequisiteRows }),
    ...(selectedOperatorHandoffRows.length === 0
      ? {}
      : { selectedOperatorHandoffRows }),
    ...(batchRows.length === 0 ? {} : { batchRows }),
    ...(terminalValidationRows.length === 0
      ? {}
      : { terminalValidationRows }),
    ...(productionFeatureDestinationSections.length === 0
      ? {}
      : { productionFeatureDestinationSections }),
  });
}

function buildSimpleAdminAuditRows({
  items,
  idPrefix,
  testIdPrefix,
  itemId = (item) => item.id,
  valuesForItem,
}) {
  return Object.freeze(
    (Array.isArray(items) ? items : []).map((item) => {
      const id = String(itemId(item) ?? "");
      return artifactSummaryRow({
        id: `${idPrefix}-${id}`,
        testId: `${testIdPrefix}-${id}`,
        values: valuesForItem(item),
      });
    }),
  );
}

function buildCoreLoopScenarioFamilyRows(scenarioFamilies) {
  return Object.freeze(
    (Array.isArray(scenarioFamilies) ? scenarioFamilies : []).map((family) =>
      artifactSummaryRow({
        id: `scenario-family-${family.id}`,
        testId: `admin-audit-scenario-family-${family.id}`,
        values: [
          { id: "label", text: family.label, emphasized: true },
          { id: "status", text: family.status },
          { id: "laneIds", text: joinedValue(family.laneIds) },
          { id: "surfaces", text: joinedValue(family.surfaces) },
          ...optionalJoinedValue("staleRejects", family.staleRejects),
          ...optionalJoinedValue("reloads", family.reloads),
          ...optionalJoinedValue("scenarios", family.scenarios),
          ...optionalJoinedValue("transitionTokens", family.transitionTokens),
        ],
      }),
    ),
  );
}

function joinedValue(values) {
  return (Array.isArray(values) ? values : []).join(", ");
}

function optionalJoinedValue(id, values) {
  return Array.isArray(values) && values.length > 0
    ? [{ id, text: joinedValue(values) }]
    : [];
}

function buildCoreLoopSpineCycleRows(spineCycles) {
  return Object.freeze(
    (Array.isArray(spineCycles) ? spineCycles : []).map((cycle) =>
      artifactSummaryRow({
        id: `spine-cycle-${cycle.id}`,
        testId: `admin-audit-spine-cycle-${cycle.id}`,
        values: [
          { id: "label", text: cycle.label, emphasized: true },
          { id: "game", text: cycle.game },
          { id: "status", text: cycle.status },
        ],
        subentries: [
          ...(Array.isArray(cycle.roleUrls) ? cycle.roleUrls : []).map(
            (roleUrl) => ({
              id: `role-url-${roleUrl.id}`,
              testId: `admin-audit-spine-role-url-entry-${cycle.id}-${roleUrl.id}`,
              values: [
                { id: "label", text: roleUrl.label, emphasized: true },
                {
                  id: "href",
                  text: roleUrl.href,
                  href: roleUrl.href,
                  testId: `admin-audit-spine-role-url-${cycle.id}-${roleUrl.id}`,
                },
              ],
            }),
          ),
          ...(Array.isArray(cycle.checkpoints) ? cycle.checkpoints : []).map(
            (checkpoint) => ({
              id: `checkpoint-${checkpoint.id}`,
              testId: `admin-audit-spine-checkpoint-${cycle.id}-${checkpoint.id}`,
              values: [
                { id: "label", text: checkpoint.label, emphasized: true },
                { id: "status", text: checkpoint.status },
              ],
            }),
          ),
        ],
      }),
    ),
  );
}

function buildCoreLoopCommandProofRoleUrlAuditRows(audit) {
  if (audit === null || typeof audit !== "object") {
    return Object.freeze([]);
  }
  return Object.freeze([
    artifactSummaryRow({
      id: "command-proof-role-url-audit",
      testId:
        "admin-audit-command-proof-role-url-audit-command-proof-role-url-audit",
      values: [
        { id: "label", text: "Command proof role URLs", emphasized: true },
        { id: "status", text: String(audit.status ?? "unknown") },
        {
          id: "checkedCount",
          text: `${Number(audit.checkedCount ?? 0)} checked`,
        },
      ],
    }),
  ]);
}

function buildUnprovenRows(unproven) {
  return Object.freeze(
    (Array.isArray(unproven) ? unproven : []).map((item) =>
      artifactSummaryRow({
        id: `unproven-${item.id}`,
        testId: `admin-audit-unproven-${item.id}`,
        values: [
          { id: "id", text: item.id, emphasized: true },
          { id: "status", text: item.status },
          { id: "requiredEvidence", text: item.requiredEvidence },
          ...optionalTextValue("command", item.command),
          ...optionalTextValue("proofTarget", item.proofTarget),
          ...optionalTextValue("roleUrl", item.roleUrl),
        ],
      }),
    ),
  );
}

function optionalTextValue(id, value) {
  return String(value ?? "") === "" ? [] : [{ id, text: value }];
}

function buildRelatedLinkRows(relatedLinks) {
  return Object.freeze(
    (Array.isArray(relatedLinks) ? relatedLinks : []).map((link) =>
      artifactSummaryRow({
        id: `related-link-${link.id}`,
        testId: `admin-audit-related-link-entry-${link.id}`,
        values: [
          {
            id: "label",
            text: link.label,
            href: link.href,
            testId: `admin-audit-related-link-${link.id}`,
          },
          { id: "status", text: link.status },
        ],
      }),
    ),
  );
}

function buildLocalPrerequisiteRows(localPrerequisites, { game }) {
  return Object.freeze(
    (Array.isArray(localPrerequisites) ? localPrerequisites : []).map(
      (prerequisite) =>
        artifactSummaryRow({
          id: `local-prerequisite-${prerequisite.id}`,
          testId: `admin-audit-local-prerequisite-${prerequisite.id}`,
          values: [
            { id: "label", text: prerequisite.label, emphasized: true },
            { id: "status", text: prerequisite.status },
            { id: "command", text: prerequisite.command },
            localProofArtifactValue({
              id: "proofTarget",
              text: prerequisite.proofTarget,
              game,
              testId: `admin-audit-local-prerequisite-proof-target-${prerequisite.id}`,
            }),
            localProofArtifactValue({
              id: "evidence",
              text: prerequisite.evidence,
              game,
              testId: `admin-audit-local-prerequisite-evidence-${prerequisite.id}`,
            }),
            { id: "requiredEvidence", text: prerequisite.requiredEvidence },
            {
              id: "roleUrl",
              text: prerequisite.roleUrl,
              href: seededRoleUrlToAdminHref(prerequisite.roleUrl, { game }),
              testId: `admin-audit-local-prerequisite-role-url-${prerequisite.id}`,
            },
          ],
        }),
    ),
  );
}

function buildAdminSpineBatchRows(batches) {
  return Object.freeze(
    (Array.isArray(batches) ? batches : []).map((batch) =>
      artifactSummaryRow({
        id: `admin-spine-batch-${batch.id}`,
        testId: `admin-audit-admin-spine-batch-${batch.id}`,
        values: [
          { id: "label", text: batch.label, emphasized: true },
          { id: "status", text: batch.status },
          { id: "caseCount", text: `${batch.caseCount} cases` },
          { id: "elapsedMs", text: `${batch.elapsedMs} ms` },
          {
            id: "sharedFrontendSession",
            text:
              batch.sharedFrontendSession === true
                ? "shared frontend"
                : "separate frontend",
          },
          {
            id: "sharedChromiumSession",
            text:
              batch.sharedChromiumSession === true
                ? "shared chromium"
                : "separate chromium",
          },
          { id: "reason", text: batch.reason },
        ],
        subentries: (Array.isArray(batch.artifactPaths)
          ? batch.artifactPaths
          : []
        ).map((artifactPath, index) => ({
          id: `artifact-path-${index + 1}`,
          testId: `admin-audit-admin-spine-batch-${batch.id}-artifact-path-${index + 1}`,
          values: [
            {
              id: "artifactPath",
              text: artifactPath,
              emphasized: true,
            },
          ],
        })),
      }),
    ),
  );
}

function buildAdminSpineTerminalValidationRows(validations) {
  return Object.freeze(
    (Array.isArray(validations) ? validations : []).map((validation) =>
      artifactSummaryRow({
        id: `admin-spine-terminal-validation-${validation.id}`,
        testId: `admin-audit-admin-spine-terminal-validation-${validation.id}`,
        values: [
          { id: "label", text: validation.label, emphasized: true },
          { id: "status", text: validation.status },
          { id: "proof", text: validation.proof },
          { id: "command", text: validation.command },
          { id: "artifactPath", text: validation.artifactPath },
          {
            id: "localDiagnosticCount",
            text: `${validation.localDiagnosticCount} diagnostics`,
          },
        ],
        subentries: validation.validatesArtifacts.map((artifactPath, index) => ({
          id: `validated-artifact-${index + 1}`,
          testId: `admin-audit-admin-spine-terminal-validation-${validation.id}-validated-artifact-${index + 1}`,
          values: [
            {
              id: "validatedArtifact",
              text: artifactPath,
              emphasized: true,
            },
          ],
        })),
      }),
    ),
  );
}

function buildProductionFeatureDestinationSections(summary, { game } = {}) {
  const rows = Array.isArray(summary?.rows) ? summary.rows : [];
  const primaryRows = rows.filter(
    (row) => !isHostedEvidenceProgressionDestinationRow(row),
  );
  const hostedEvidenceProgressionRows = rows.filter((row) =>
    isHostedEvidenceProgressionDestinationRow(row),
  );
  return Object.freeze([
    ...(primaryRows.length === 0
      ? []
      : [
          buildArtifactSummarySection({
            id: "production-feature-destinations",
            heading: "Production feature destinations",
            rows: primaryRows.map((row) =>
              productionFeatureDestinationDescriptorRow(row, { game }),
            ),
          }),
        ]),
    ...(hostedEvidenceProgressionRows.length === 0
      ? []
      : [
          buildArtifactSummarySection({
            id: "hosted-evidence-progression-destination-summary",
            heading: "Hosted evidence recovery ladder",
            rows: hostedEvidenceProgressionRows.map((row) =>
              productionFeatureDestinationDescriptorRow(row, { game }),
            ),
          }),
        ]),
  ]);
}

function isHostedEvidenceProgressionDestinationRow(row) {
  return String(row?.id ?? "").startsWith("hosted-evidence-progression:");
}

function productionFeatureDestinationDescriptorRow(row, { game } = {}) {
  return {
    id: row.id,
    testId: proofGraphProductionFeatureDestinationRowTestId(row.id),
    values: [
      { id: "label", text: row.label, emphasized: true },
      { id: "status", text: row.status },
      ...productionFeatureDestinationMetadataValues(row, { game }),
      ...proofGraphProductionFeatureDestinationArtifactFields.flatMap((field) =>
        row[field] === undefined || row[field] === ""
          ? []
          : [
              localProofArtifactValue({
                id: field,
                text: row[field],
                game,
                testId: proofGraphProductionFeatureDestinationArtifactTestId({
                  rowId: row.id,
                  field,
                }),
              }),
            ],
      ),
    ],
  };
}

function productionFeatureDestinationMetadataValues(row, { game } = {}) {
  return [
    optionalArtifactSummaryTextValue(row, "featureSlotId"),
    optionalArtifactSummaryTextValue(row, "sourceCheckId"),
    optionalArtifactSummaryTextValue(row, "adminCheckId"),
    optionalProductionFeatureDestinationRoleValue(row, "targetRoleUrl", {
      game,
    }),
    optionalProductionFeatureDestinationRoleValue(row, "detailRoleUrl", {
      game,
    }),
    optionalProductionFeatureDestinationRoleValue(row, "roleUrl", { game }),
    optionalArtifactSummaryTextValue(row, "sourceProofArtifactRef"),
    optionalArtifactSummaryTextValue(row, "recoveryCommand"),
    optionalArtifactSummaryTextValue(row, "proofCommand"),
    optionalArtifactSummaryTextValue(row, "progressionId"),
    optionalArtifactSummaryTextValue(row, "firstMissingInputId"),
    optionalArtifactSummaryTextValue(row, "firstMissingCheckId"),
  ].flatMap((value) => (value === null ? [] : [value]));
}

function optionalArtifactSummaryTextValue(row, field) {
  const text = String(row?.[field] ?? "");
  return text === "" ? null : { id: field, text };
}

function optionalProductionFeatureDestinationRoleValue(row, field, { game } = {}) {
  const text = String(row?.[field] ?? "");
  if (text === "") {
    return null;
  }
  return {
    id: field,
    text,
    href: seededRoleUrlToAdminHref(text, { game }),
  };
}

export function adminForbiddenMessage() {
  return "Admin operations require GlobalAdmin or GlobalMod capability.";
}

export function summarizeRecoveryGate(body) {
  if (body === null || typeof body !== "object") {
    return Object.freeze({
      state: "reject",
      message: "Recovery gate returned malformed proof data",
    });
  }

  const production = body.production ?? {};
  const trusted = Number(production.trusted ?? 0);
  const total = Number(production.total_artifact_rows ?? 0);
  const nonTrusted = Number(production.non_trusted ?? 0);
  if (body.ok === true && nonTrusted === 0) {
    return Object.freeze({
      state: "ack",
      message: `Recovery gate trusted: ${trusted}/${total} production artifacts trusted`,
      trusted,
      total,
      nonTrusted,
    });
  }

  return Object.freeze({
    state: "reject",
    message: `Recovery gate blocked: ${nonTrusted}/${total} production artifacts need review`,
    trusted,
    total,
    nonTrusted,
  });
}

function adminFixtureColdLoad({ game, principalUserId }) {
  return Object.freeze({
    audit: Object.freeze([
      Object.freeze({
        id: "proof-runs",
        label: "Proof runs",
        status: "Current local report available",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Read-only operator proof",
        boundaryDetail: "/operator/proof-runs machine-readable report",
        href: operatorProofRunUrl({ game, principalUserId }),
      }),
      Object.freeze({
        id: "command-receipts",
        label: "Command receipts",
        status: "Durable ack path live",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Committed command audit",
        boundaryDetail: "/operator command receipt inspection",
        href: operatorProofRunUrl({
          game,
          principalUserId,
          path: "operator",
        }),
      }),
      Object.freeze({
        id: "recovery",
        label: "Recovery queue",
        status: "No destructive action armed",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Read-only recovery proof",
        boundaryDetail: "/operator/proof-runs/go-no-go/view saved report",
        href: operatorProofRunUrl({
          game,
          principalUserId,
          path: "operator/proof-runs/go-no-go/view",
        }),
      }),
    ]),
  });
}

function withAdminAuditInspectLinks(audit, { game }) {
  return Object.freeze(
    audit.map((item) =>
      Object.freeze({
        ...item,
        inspectHref:
          typeof item.inspectHref === "string" && item.inspectHref.trim() !== ""
            ? item.inspectHref
            : adminAuditInspectHref({
                game,
                audit: item.id,
              }),
      }),
    ),
  );
}

export function appendLocalOpsArtifactsAudit(audit, opsArtifacts, { game }) {
  const row = normalizeLocalOpsArtifactsAudit(opsArtifacts, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalHostedOpsSignalsAudit(audit, hostedOpsSignals, { game }) {
  const row = normalizeLocalHostedOpsSignalsAudit(hostedOpsSignals, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalRealHostedObservabilityHandoffAudit(
  audit,
  realHostedObservabilityHandoff,
  { game },
) {
  const row = normalizeLocalRealHostedObservabilityHandoffAudit(
    realHostedObservabilityHandoff,
    { game },
  );
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalHostedTargetPreflightAudit(
  audit,
  hostedTargetPreflight,
  { game },
) {
  const row = normalizeLocalHostedTargetPreflightAudit(hostedTargetPreflight, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalHostedTargetPreflightAudit(
  hostedTargetPreflight,
  { game },
) {
  if (
    hostedTargetPreflight === null ||
    typeof hostedTargetPreflight !== "object" ||
    hostedTargetPreflight.version !== 1 ||
    hostedTargetPreflight.proof !== "dev-test-game-hosted-target-preflight" ||
    !["passed", "blocked"].includes(hostedTargetPreflight.status) ||
    hostedTargetPreflight.scope !== "hosted-target-preflight" ||
    hostedTargetPreflight.releaseReady !== false ||
    hostedTargetPreflight.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(hostedTargetPreflight.checks)
    ? hostedTargetPreflight.checks
    : [];
  const passedChecks = checks.filter((check) => check?.status === "passed");
  const blockedChecks = checks.filter((check) => check?.status === "blocked");
  const hostedHandoffChecklist = normalizeNextActionHostedHandoffChecklist({
    unproven: {
      hostedHandoffChecklist: hostedTargetPreflight.hostedHandoffChecklist,
    },
    realHostedEvidenceInputs: [],
    blockedReceipt: hostedTargetPreflight.blockedReceipt,
  });
  const artifactSummary = Object.freeze({
    frontendBaseUrl: String(hostedTargetPreflight.target?.frontendBaseUrl ?? ""),
    apiBaseUrl: String(hostedTargetPreflight.target?.apiBaseUrl ?? ""),
    groupId: String(hostedTargetPreflight.target?.groupId ?? ""),
    rawEvidencePath: String(hostedTargetPreflight.target?.rawEvidencePath ?? ""),
    rawEvidenceStatus: String(
      hostedTargetPreflight.target?.rawEvidenceStatus ?? "unknown",
    ),
    rawCaptureStatus: String(
      hostedTargetPreflight.target?.rawCaptureStatus ?? "unknown",
    ),
    rawCapturePath: String(hostedTargetPreflight.target?.rawCapturePath ?? ""),
    rawCaptureBlockedCheckIds: Object.freeze(
      (hostedTargetPreflight.target?.rawCaptureBlockedCheckIds ?? []).map((id) =>
        String(id),
      ),
    ),
    nextCommand: String(hostedTargetPreflight.nextCommand ?? ""),
    nextProofTarget: String(hostedTargetPreflight.nextProofTarget ?? ""),
    releaseReady: hostedTargetPreflight.releaseReady === true,
    productionReady: hostedTargetPreflight.productionReady === true,
  });
  return Object.freeze({
    id: localAdminAuditIds.hostedTargetPreflight,
    label: "Hosted target preflight",
    status: `${passedChecks.length} passed, ${blockedChecks.length} blocked`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Hosted target preflight",
    boundaryDetail:
      hostedTargetPreflight.proofBoundary ??
      "Hosted target preflight without hosted deployment or release claims.",
    href: devTestGameHostedTargetPreflightPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.hostedTargetPreflight,
    }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
        }),
      ),
    ),
    unproven: Object.freeze(
      blockedChecks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: "blocked",
          requiredEvidence: String(check.requiredEvidence ?? ""),
        }),
      ),
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.hostedConcurrentRaceMatrix,
        label: "Hosted matrix",
        href: adminAuditInspectHref({
          game,
          audit: localAdminAuditIds.hostedConcurrentRaceMatrix,
        }),
        status: String(hostedTargetPreflight.target?.rawEvidenceStatus ?? "unknown"),
        command: "test:dev-test-game-hosted-concurrent-race-matrix",
      }),
      Object.freeze({
        id: localAdminAuditIds.nextAction,
        label: "Ranked next action",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
        status: String(hostedTargetPreflight.status ?? "unknown"),
        command: "test:dev-test-game-next-action",
      }),
    ]),
    ...(hostedHandoffChecklist === null ? {} : { hostedHandoffChecklist }),
    ...(hostedHandoffChecklist === null
      ? {}
      : {
          hostedHandoffChecklistRows:
            buildHostedHandoffChecklistRows(hostedHandoffChecklist),
          hostedHandoffOperatorRows:
            buildHostedHandoffOperatorRows(hostedHandoffChecklist),
          hostedHandoffProgressionRows: buildHostedHandoffProgressionRows({
            checklist: hostedHandoffChecklist,
            artifactSummary,
          }),
          hostedHandoffBlockedReceiptRows: buildHostedHandoffBlockedReceiptRows({
            checklist: hostedHandoffChecklist,
            headings: hostedHandoffReceiptHeadingsForAudit(
              localAdminAuditIds.hostedTargetPreflight,
            ),
          }),
        }),
    artifactSummary,
    artifactSummarySections:
      buildHostedTargetPreflightSummarySections(artifactSummary),
  });
}

export function appendLocalHostedIdentityEvidenceAudit(
  audit,
  hostedIdentityEvidence,
  { game, hostedIdentityProgressionSummary = null },
) {
  const row = normalizeLocalHostedIdentityEvidenceAudit(hostedIdentityEvidence, {
    game,
    hostedIdentityProgressionSummary,
  });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalHostedIdentityEvidenceAudit(
  hostedIdentityEvidence,
  { game, hostedIdentityProgressionSummary = null },
) {
  if (
    hostedIdentityEvidence === null ||
    typeof hostedIdentityEvidence !== "object" ||
    hostedIdentityEvidence.version !== 1 ||
    hostedIdentityEvidence.proof !== "dev-test-game-hosted-identity-evidence" ||
    !["passed", "blocked"].includes(hostedIdentityEvidence.status) ||
    hostedIdentityEvidence.scope !== "hosted-identity-evidence-handoff" ||
    hostedIdentityEvidence.releaseReady !== false ||
    hostedIdentityEvidence.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(hostedIdentityEvidence.checks)
    ? hostedIdentityEvidence.checks
    : [];
  const passedChecks = checks.filter((check) => check?.status === "passed");
  const blockedCheckIds = Array.isArray(
    hostedIdentityEvidence.hostedHandoffChecklist?.blockedCheckIds,
  )
    ? hostedIdentityEvidence.hostedHandoffChecklist.blockedCheckIds.map((id) =>
        String(id),
      )
    : checks
        .filter((check) => check?.status === "blocked")
        .map((check) => String(check.id));
  const blockedCheckIdSet = new Set(blockedCheckIds);
  const hostedHandoffChecklist = normalizeHostedIdentityEvidenceHandoffChecklist({
    hostedIdentityEvidence,
    blockedChecks: checks.filter((check) =>
      blockedCheckIdSet.has(String(check.id)),
    ),
  });
  const progressionSummary =
    normalizeHostedIdentityProgressionSummary(
      hostedIdentityProgressionSummary,
    );
  const artifactSummary = Object.freeze({
    rawEvidencePath: String(hostedIdentityEvidence.target?.rawEvidencePath ?? ""),
    placeholderFixturePath: String(
      hostedIdentityEvidence.target?.placeholderFixturePath ??
        hostedIdentityEvidence.hostedHandoffChecklist?.placeholderFixturePath ??
        "",
    ),
    rawEvidenceStatus: String(
      hostedIdentityEvidence.target?.rawEvidenceStatus ?? "unknown",
    ),
    blockedCheckCount: blockedCheckIds.length,
    nextCommand: String(hostedIdentityEvidence.nextCommand ?? ""),
    nextProofTarget: String(hostedIdentityEvidence.nextProofTarget ?? ""),
    releaseReady: hostedIdentityEvidence.releaseReady === true,
    productionReady: hostedIdentityEvidence.productionReady === true,
    roleSurfaceContractDiff: normalizeHostedIdentityRoleSurfaceContractDiff(
      hostedIdentityEvidence.target?.roleSurfaceContractDiff,
    ),
    identityAdapterContractComparison:
      normalizeHostedIdentityAdapterContractComparison(
        hostedIdentityEvidence.target?.identityAdapterContractComparison,
      ),
    identityProviderBoundary: normalizeHostedIdentityProviderBoundary(
      hostedIdentityEvidence.target?.identityProviderBoundary,
    ),
    redactedIntakePacket: normalizeHostedIdentityRedactedIntakePacket(
      hostedIdentityEvidence.target?.redactedIntakePacket,
    ),
    ...(progressionSummary === null ? {} : { progressionSummary }),
  });
  const handoffPath = buildAdminAuditHandoffPath({
    upstreamAuditId: localAdminAuditIds.nextAction,
    localCapabilityAuditId: localAdminAuditIds.identityAdapter,
    downstreamStatus: String(hostedIdentityEvidence.status ?? "unknown"),
    downstreamCommand: String(hostedIdentityEvidence.nextCommand ?? ""),
    downstreamProofTarget: String(hostedIdentityEvidence.nextProofTarget ?? ""),
  });
  return Object.freeze({
    id: localAdminAuditIds.hostedIdentityEvidence,
    label: "Hosted identity evidence",
    status: `${hostedIdentityEvidence.status}: ${passedChecks.length} passed, ${blockedCheckIds.length} blocked`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Hosted identity evidence handoff",
    boundaryDetail:
      hostedIdentityEvidence.proofBoundary ??
      "Hosted identity evidence handoff without hosted identity or release claims.",
    href: devTestGameHostedIdentityEvidencePath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.hostedIdentityEvidence,
    }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
        }),
      ),
    ),
    unproven: Object.freeze(
      checks
        .filter((check) => blockedCheckIdSet.has(String(check.id)))
        .map((check) =>
          Object.freeze({
            id: String(check.id),
            status: "blocked",
            requiredEvidence: String(check.requiredEvidence ?? ""),
          }),
        ),
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.identityAdapter,
        label: "Local identity adapter",
        href: adminAuditInspectHref({
          game,
          audit: localAdminAuditIds.identityAdapter,
        }),
        status: "prerequisite",
        command: "test:dev-test-game-identity-admin-proof",
      }),
      Object.freeze({
        id: localAdminAuditIds.nextAction,
        label: "Ranked next action",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
        status: String(hostedIdentityEvidence.status ?? "unknown"),
        command: "test:dev-test-game-next-action",
      }),
    ]),
    handoffPath,
    handoffPathRows: buildAdminAuditHandoffPathRows(handoffPath),
    hostedHandoffChecklist,
    hostedHandoffChecklistRows:
      buildHostedHandoffChecklistRows(hostedHandoffChecklist),
    hostedHandoffOperatorRows:
      buildHostedHandoffOperatorRows(hostedHandoffChecklist),
    hostedHandoffProgressionRows: buildHostedHandoffProgressionRows({
      checklist: hostedHandoffChecklist,
      artifactSummary,
    }),
    hostedHandoffBlockedReceiptRows: buildHostedHandoffBlockedReceiptRows({
      checklist: hostedHandoffChecklist,
      headings: hostedHandoffReceiptHeadingsForAudit(
        localAdminAuditIds.hostedIdentityEvidence,
      ),
    }),
    hostedHandoffReceiptHeadings: hostedHandoffReceiptHeadingsForAudit(
      localAdminAuditIds.hostedIdentityEvidence,
    ),
    artifactSummary,
    artifactSummarySections:
      buildHostedIdentityEvidenceSummarySections(artifactSummary),
  });
}

function normalizeHostedIdentityProgressionSummary(summary) {
  if (
    summary === null ||
    typeof summary !== "object" ||
    summary.version !== 1 ||
    summary.proof !== "dev-test-game-hosted-identity-progression-summary" ||
    summary.status !== "passed" ||
    summary.scope !== "hosted-identity-evidence-family-progression-summary" ||
    summary.releaseReady !== false ||
    summary.productionReady !== false ||
    !Array.isArray(summary.progressions)
  ) {
    return null;
  }
  return Object.freeze({
    status: String(summary.status ?? "unknown"),
    progressionCount: Number(summary.progressionCount ?? summary.progressions.length),
    sourceCaseCount: Number(summary.sourceCaseCount ?? summary.progressions.length),
    nextCommand: String(summary.nextCommand ?? ""),
    nextProofTarget: String(summary.nextProofTarget ?? ""),
    proofBoundary: String(summary.proofBoundary ?? ""),
    releaseReady: summary.releaseReady === true,
    productionReady: summary.productionReady === true,
    progressions: Object.freeze(
      summary.progressions.map((progression) =>
        Object.freeze({
          id: String(progression?.id ?? ""),
          field: String(progression?.field ?? ""),
          checkId: String(progression?.checkId ?? ""),
          missingInputId: String(progression?.missingInputId ?? ""),
          adminProofMode: String(progression?.adminProofMode ?? ""),
          missingFixturePath: String(progression?.missingFixturePath ?? ""),
          recoveredFixturePath: String(
            progression?.recoveredFixturePath ?? "",
          ),
          adminProofFixturePath: String(
            progression?.adminProofFixturePath ?? "",
          ),
          proofCommand: String(progression?.proofCommand ?? ""),
          evidencePath: String(progression?.evidencePath ?? ""),
          adminProofTarget: String(progression?.adminProofTarget ?? ""),
          roleUrl: String(progression?.roleUrl ?? ""),
          firstMissingInputId: String(progression?.firstMissingInputId ?? ""),
          firstMissingCheckId: String(progression?.firstMissingCheckId ?? ""),
          proofBoundary: String(progression?.proofBoundary ?? ""),
        }),
      ),
    ),
  });
}

function normalizeHostedIdentityEvidenceHandoffChecklist({
  hostedIdentityEvidence,
  blockedChecks,
}) {
  const inputIds = Array.isArray(
    hostedIdentityEvidence.hostedHandoffChecklist?.inputIds,
  )
    ? hostedIdentityEvidence.hostedHandoffChecklist.inputIds
    : [];
  return Object.freeze({
    status: String(hostedIdentityEvidence.status ?? "unknown"),
    preflightStatus: String(
      hostedIdentityEvidence.hostedHandoffChecklist?.preflightStatus ??
        hostedIdentityEvidence.status ??
        "unknown",
    ),
    command: String(
      hostedIdentityEvidence.hostedHandoffChecklist?.command ??
        hostedIdentityEvidence.nextCommand ??
        "",
    ),
    proofTarget: String(
      hostedIdentityEvidence.hostedHandoffChecklist?.proofTarget ??
        hostedIdentityEvidence.nextProofTarget ??
        "",
    ),
    inputCount: inputIds.length,
    blockedCheckCount: blockedChecks.length,
    inputs: Object.freeze(
      inputIds.map((id) =>
        Object.freeze({
          id: String(id),
          label: String(id),
          value: hostedIdentityHandoffInputValue({
            id,
            hostedIdentityEvidence,
          }),
          required: true,
        }),
      ),
    ),
    blockedChecks: Object.freeze(
      blockedChecks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: "blocked",
          requiredEvidence: String(check.requiredEvidence ?? ""),
        }),
      ),
    ),
    groups: normalizeHostedHandoffGroups(
      hostedIdentityEvidence.hostedHandoffChecklist?.requirementGroups,
    ),
    inputSections: normalizeHostedHandoffInputSections(
      hostedIdentityEvidence.hostedHandoffChecklist?.inputSections,
    ),
    operatorEvidenceGate: normalizeHostedIdentityOperatorEvidenceGate(
      hostedIdentityEvidence.hostedHandoffChecklist?.operatorEvidenceGate,
    ),
    operatorProofDrilldowns: normalizeHostedHandoffOperatorProofDrilldowns(
      hostedIdentityEvidence.hostedHandoffChecklist?.operatorProofDrilldowns,
    ),
    progressionSummary: normalizeHostedHandoffProgressionSummary(
      hostedIdentityEvidence.hostedHandoffChecklist?.progressionSummary,
    ),
    blockedReceipt: normalizeHostedHandoffBlockedReceipt(
      hostedIdentityEvidence.hostedHandoffChecklist?.blockedReceipt,
    ),
  });
}

export function appendLocalHostedEvidenceLaneAudit(
  audit,
  hostedEvidenceLane,
  { game, hostedEvidenceLaneDemoProof = null },
) {
  const row = normalizeLocalHostedEvidenceLaneAudit(hostedEvidenceLane, {
    game,
    hostedEvidenceLaneDemoProof,
  });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalHostedEvidenceLaneAudit(
  hostedEvidenceLane,
  { game, hostedEvidenceLaneDemoProof = null },
) {
  if (
    hostedEvidenceLane === null ||
    typeof hostedEvidenceLane !== "object" ||
    hostedEvidenceLane.version !== 1 ||
    hostedEvidenceLane.proof !== "dev-test-game-hosted-evidence-lane" ||
    !["passed", "blocked"].includes(hostedEvidenceLane.status) ||
    hostedEvidenceLane.scope !== "hosted-evidence-lane" ||
    hostedEvidenceLane.releaseReady !== false ||
    hostedEvidenceLane.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(hostedEvidenceLane.checks)
    ? hostedEvidenceLane.checks
    : [];
  const passedChecks = checks.filter((check) => check?.status === "passed");
  const blockedChecks = checks.filter((check) => check?.status === "blocked");
  const blockedCheckIds = Array.isArray(hostedEvidenceLane.blockedCheckIds)
    ? hostedEvidenceLane.blockedCheckIds.map((id) => String(id))
    : blockedChecks.map((check) => String(check.id));
  const blockedCheckIdSet = new Set(blockedCheckIds);
  const demoProofSummary =
    normalizeLocalHostedEvidenceLaneDemoProofSummary(hostedEvidenceLaneDemoProof);
  const demoProofChecks =
    normalizeLocalHostedEvidenceLaneDemoProofChecks(hostedEvidenceLaneDemoProof);
  const realHostedEvidenceInputs = normalizeRealHostedEvidenceInputs(
    hostedEvidenceLane.hostedEvidence?.realHostedEvidenceInputs,
  );
  const hostedHandoffChecklist = normalizeHostedEvidenceLaneHandoffChecklist({
    hostedEvidenceLane,
    blockedChecks: checks.filter((check) => blockedCheckIdSet.has(String(check.id))),
    realHostedEvidenceInputs,
  });
  const rawEvidenceTemplate = normalizeRawEvidenceTemplateDescriptor();
  const artifactSummary = Object.freeze({
    preflightStatus: String(hostedEvidenceLane.preflightStatus ?? "unknown"),
    blockedCheckCount: blockedCheckIds.length,
    realHostedEvidenceStatus: String(
      hostedEvidenceLane.hostedEvidence?.realHostedEvidenceStatus ?? "unknown",
    ),
    hostedEvidenceMode: String(
      hostedEvidenceLane.hostedEvidence?.mode ?? "unknown",
    ),
    externalEvidencePath: String(
      hostedEvidenceLane.hostedEvidence?.externalEvidencePath ?? "",
    ),
    realHostedEvidenceCommand: String(
      hostedEvidenceLane.hostedEvidence?.realHostedEvidenceInputs?.command ?? "",
    ),
    realHostedEvidenceProofTarget: String(
      hostedEvidenceLane.hostedEvidence?.realHostedEvidenceInputs?.proofTarget ??
        "",
    ),
    ...(demoProofSummary === null ? {} : demoProofSummary),
    frontendBaseUrl: String(hostedEvidenceLane.target?.frontendBaseUrl ?? ""),
    apiBaseUrl: String(hostedEvidenceLane.target?.apiBaseUrl ?? ""),
    groupId: String(hostedEvidenceLane.target?.groupId ?? ""),
    rawEvidencePath: String(hostedEvidenceLane.target?.rawEvidencePath ?? ""),
    rawEvidenceStatus: String(
      hostedEvidenceLane.target?.rawEvidenceStatus ?? "unknown",
    ),
    nextCommand: String(hostedEvidenceLane.nextCommand ?? ""),
    nextProofTarget: String(hostedEvidenceLane.nextProofTarget ?? ""),
    releaseReady: hostedEvidenceLane.releaseReady === true,
    productionReady: hostedEvidenceLane.productionReady === true,
  });
  return Object.freeze({
    id: localAdminAuditIds.hostedEvidenceLane,
    label: "Hosted evidence lane",
    status: `${hostedEvidenceLane.status}: ${passedChecks.length} passed, ${blockedCheckIds.length} blocked`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Hosted evidence lane",
    boundaryDetail:
      hostedEvidenceLane.proofBoundary ??
      "Hosted evidence lane without hosted deployment or release claims.",
    href: devTestGameHostedEvidenceLanePath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.hostedEvidenceLane,
    }),
    checks: Object.freeze(
      [
        ...checks.map((check) =>
          Object.freeze({
            id: String(check.id),
            status: String(check.status),
          }),
        ),
        ...demoProofChecks,
      ],
    ),
    unproven: Object.freeze(
      checks
        .filter((check) => blockedCheckIdSet.has(String(check.id)))
        .map((check) =>
          Object.freeze({
            id: String(check.id),
            status: "blocked",
            requiredEvidence: String(check.requiredEvidence ?? ""),
          }),
        ),
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.hostedTargetPreflight,
        label: "Hosted target preflight",
        href: adminAuditInspectHref({
          game,
          audit: localAdminAuditIds.hostedTargetPreflight,
        }),
        status: String(hostedEvidenceLane.preflightStatus ?? "unknown"),
        command: "test:dev-test-game-hosted-target-preflight",
      }),
      Object.freeze({
        id: localAdminAuditIds.hostedConcurrentRaceMatrix,
        label: "Hosted matrix",
        href: adminAuditInspectHref({
          game,
          audit: localAdminAuditIds.hostedConcurrentRaceMatrix,
        }),
        status: String(hostedEvidenceLane.target?.rawEvidenceStatus ?? "unknown"),
        command: "test:dev-test-game-hosted-concurrent-race-matrix",
      }),
      Object.freeze({
        id: localAdminAuditIds.nextAction,
        label: "Ranked next action",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
        status: String(hostedEvidenceLane.status ?? "unknown"),
        command: "test:dev-test-game-next-action",
      }),
    ]),
    realHostedEvidenceInputs,
    realHostedEvidenceInputRows:
      buildRealHostedEvidenceInputRows(realHostedEvidenceInputs),
    rawEvidenceTemplate,
    rawEvidenceTemplateRows: buildRawEvidenceTemplateRows(rawEvidenceTemplate),
    hostedHandoffChecklist,
    hostedHandoffChecklistRows:
      buildHostedHandoffChecklistRows(hostedHandoffChecklist),
    hostedHandoffOperatorRows:
      buildHostedHandoffOperatorRows(hostedHandoffChecklist),
    hostedHandoffProgressionRows: buildHostedHandoffProgressionRows({
      checklist: hostedHandoffChecklist,
      artifactSummary,
    }),
    hostedHandoffBlockedReceiptRows: buildHostedHandoffBlockedReceiptRows({
      checklist: hostedHandoffChecklist,
      headings: hostedHandoffReceiptHeadingsForAudit(
        localAdminAuditIds.hostedEvidenceLane,
      ),
    }),
    hostedHandoffReceiptHeadings: hostedHandoffReceiptHeadingsForAudit(
      localAdminAuditIds.hostedEvidenceLane,
    ),
    artifactSummary,
    artifactSummarySections: buildHostedEvidenceLaneSummarySections(artifactSummary),
  });
}

function normalizeHostedEvidenceLaneHandoffChecklist({
  hostedEvidenceLane,
  blockedChecks,
  realHostedEvidenceInputs,
}) {
  const checklist =
    hostedEvidenceLane.hostedHandoffChecklist !== null &&
    typeof hostedEvidenceLane.hostedHandoffChecklist === "object"
      ? hostedEvidenceLane.hostedHandoffChecklist
      : null;
  return Object.freeze({
    status: String(checklist?.status ?? hostedEvidenceLane.status ?? "unknown"),
    preflightStatus: String(
      checklist?.preflightStatus ?? hostedEvidenceLane.preflightStatus ?? "unknown",
    ),
    command: String(
      checklist?.command ??
        hostedEvidenceLane.hostedEvidence?.realHostedEvidenceInputs?.command ??
        hostedEvidenceLane.nextCommand ??
        "",
    ),
    proofTarget: String(
      checklist?.proofTarget ??
        hostedEvidenceLane.hostedEvidence?.realHostedEvidenceInputs?.proofTarget ??
        hostedEvidenceLane.nextProofTarget ??
        "",
    ),
    inputCount: realHostedEvidenceInputs.length,
    blockedCheckCount: blockedChecks.length,
    inputs: Object.freeze(
      realHostedEvidenceInputs.map((input) =>
        Object.freeze({
          id: input.id,
          label: input.label,
          value: input.value,
          required: input.required,
        }),
      ),
    ),
    blockedChecks: Object.freeze(
      blockedChecks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: "blocked",
          requiredEvidence: String(check.requiredEvidence ?? ""),
        }),
      ),
    ),
    blockedReceipt: normalizeHostedHandoffBlockedReceipt(
      checklist?.blockedReceipt ?? hostedEvidenceLane.blockedReceipt,
    ),
    inputSections: normalizeHostedHandoffInputSections(checklist?.inputSections),
    operatorProofDrilldowns:
      normalizeHostedEvidenceOperatorChecklistProofDrilldowns(
        checklist?.blockedReceipt ?? hostedEvidenceLane.blockedReceipt,
      ),
  });
}

function normalizeHostedEvidenceOperatorChecklistProofDrilldowns(blockedReceipt) {
  const packet = blockedReceipt?.blockedOperatorPacket;
  const operatorChecklist =
    packet !== null && typeof packet === "object"
      ? packet.operatorChecklist
      : null;
  if (operatorChecklist === null || typeof operatorChecklist !== "object") {
    return Object.freeze([]);
  }
  const drilldown =
    packet.roleSurfaceDrilldown !== null &&
    typeof packet.roleSurfaceDrilldown === "object"
      ? packet.roleSurfaceDrilldown
      : {};
  return Object.freeze([
    Object.freeze({
      id: "hosted-evidence-operator-checklist",
      label: "Hosted evidence operator checklist proof",
      command: String(
        operatorChecklist.checklistProofCommand ??
          `npm run ${devTestGameHostedEvidenceOperatorChecklistProofCommand}`,
      ),
      progressionId: "hosted-deployment",
      sourcePath: String(
        operatorChecklist.path ?? devTestGameHostedEvidenceOperatorChecklistPath,
      ),
      proofTarget: String(
        operatorChecklist.checklistProofTarget ??
          devTestGameHostedEvidenceOperatorChecklistProofPath,
      ),
      operatorRunSequence: normalizeOperatorRunSequence(
        operatorChecklist.operatorRunSequence,
      ),
      roleUrl: String(
        drilldown.handoffRoleUrl ??
          operatorChecklist.roleUrl ??
          "",
      ),
      firstMissingInputId: String(packet.firstMissingInputId ?? ""),
      firstMissingCheckId: String(packet.firstMissingCheckId ?? ""),
      proofBoundary: String(operatorChecklist.localVsHostedBoundary ?? ""),
    }),
  ]);
}

function normalizeOperatorRunSequence(sequence) {
  return Object.freeze(
    (Array.isArray(sequence) ? sequence : []).map((step) =>
      Object.freeze({
        id: String(step.id ?? ""),
        label: String(step.label ?? ""),
        command: String(step.command ?? ""),
        proofTarget: String(step.proofTarget ?? ""),
      }),
    ),
  );
}

function normalizeLocalHostedEvidenceLaneDemoProofSummary(proof) {
  if (!isLocalHostedEvidenceLaneDemoProof(proof)) {
    return null;
  }
  return Object.freeze({
    demoProofStatus: String(proof.status),
    demoProofTarget: devTestGameHostedEvidenceLaneDemoProofPath,
    demoOnly: true,
    syntheticExternalTarget: true,
    demoBlockedLaneStatus: String(proof.blockedLane.status),
    demoSyntheticRejectedLaneStatus: String(proof.syntheticRejectedLane.status),
    demoExternalEvidencePath: String(proof.generatedFrom?.externalEvidence ?? ""),
    demoSyntheticRejectedRoleUrl: String(
      proof.handoff?.syntheticRejectedRoleUrl ?? "",
    ),
  });
}

function normalizeLocalHostedEvidenceLaneDemoProofChecks(proof) {
  if (!isLocalHostedEvidenceLaneDemoProof(proof) || !Array.isArray(proof.checks)) {
    return [];
  }
  return proof.checks.map((check) =>
    Object.freeze({
      id: `demo-proof:${String(check.id ?? "")}`,
      status: String(check.status ?? "unknown"),
    }),
  );
}

function isLocalHostedEvidenceLaneDemoProof(proof) {
  return (
    proof !== null &&
    typeof proof === "object" &&
    proof.version === 1 &&
    proof.proof === "dev-test-game-hosted-evidence-lane-demo-proof" &&
    proof.status === "passed" &&
    proof.scope === "local-dev-test-game-hosted-evidence-lane-demo-proof" &&
    proof.releaseReady === false &&
    proof.productionReady === false &&
    proof.target?.syntheticExternalTarget === true &&
    proof.blockedLane?.status === "blocked" &&
    proof.syntheticRejectedLane?.status === "blocked"
  );
}

export function normalizeLocalHostedOpsSignalsAudit(hostedOpsSignals, { game }) {
  if (
    hostedOpsSignals === null ||
    typeof hostedOpsSignals !== "object" ||
    hostedOpsSignals.version !== 1 ||
    hostedOpsSignals.proof !== "dev-test-game-hosted-ops-signals" ||
    hostedOpsSignals.status !== "passed" ||
    hostedOpsSignals.scope !== "local-hosted-like-ops-signals" ||
    hostedOpsSignals.releaseReady !== false ||
    hostedOpsSignals.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(hostedOpsSignals.checks)
    ? hostedOpsSignals.checks
    : [];
  const passedChecks = checks.filter((check) => check?.status === "passed");
  return Object.freeze({
    id: localAdminAuditIds.hostedOpsSignals,
    label: "Local hosted ops signals",
    status: `${passedChecks.length} hosted-like ops signals passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local hosted-like ops signal bundle",
    boundaryDetail:
      hostedOpsSignals.proofBoundary ??
      "Local hosted-like ops signal bundle without hosted telemetry or release claims.",
    href: devTestGameHostedOpsSignalsPath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.hostedOpsSignals }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
        }),
      ),
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.hostedConcurrentRaceMatrix,
        label: "Hosted matrix",
        href: adminAuditInspectHref({
          game,
          audit: localAdminAuditIds.hostedConcurrentRaceMatrix,
        }),
        status: String(hostedOpsSignals.matrix?.hostedEvidenceStatus ?? "unknown"),
        command: "test:dev-test-game-hosted-concurrent-race-matrix",
      }),
      Object.freeze({
        id: localAdminAuditIds.opsArtifacts,
        label: "Ops artifacts",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.opsArtifacts }),
        status: "passed",
        command: "test:dev-test-game-ops-artifacts",
      }),
    ]),
    artifactSummary: Object.freeze({
      game: String(hostedOpsSignals.target?.game ?? ""),
      cellCount: Number(hostedOpsSignals.matrix?.cellCount ?? 0),
      reconnectLaneCount: Number(hostedOpsSignals.matrix?.reconnectLaneCount ?? 0),
      staleConflictLaneCount: Number(
        hostedOpsSignals.matrix?.staleConflictLaneCount ?? 0,
      ),
      realHostedDeploymentStatus: String(
        hostedOpsSignals.target?.realHostedDeploymentStatus ?? "unknown",
      ),
      releaseReady: hostedOpsSignals.releaseReady === true,
      productionReady: hostedOpsSignals.productionReady === true,
    }),
  });
}

export function normalizeLocalRealHostedObservabilityHandoffAudit(
  realHostedObservabilityHandoff,
  { game },
) {
  if (
    realHostedObservabilityHandoff === null ||
    typeof realHostedObservabilityHandoff !== "object" ||
    realHostedObservabilityHandoff.version !== 1 ||
    realHostedObservabilityHandoff.proof !==
      "dev-test-game-real-hosted-observability-handoff" ||
    !["passed", "blocked"].includes(realHostedObservabilityHandoff.status) ||
    realHostedObservabilityHandoff.scope !== "real-hosted-observability-handoff" ||
    realHostedObservabilityHandoff.releaseReady !== false ||
    realHostedObservabilityHandoff.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(realHostedObservabilityHandoff.checks)
    ? realHostedObservabilityHandoff.checks
    : [];
  const passedChecks = checks.filter((check) => check?.status === "passed");
  const blockedCheckIds = Array.isArray(
    realHostedObservabilityHandoff.hostedHandoffChecklist?.blockedCheckIds,
  )
    ? realHostedObservabilityHandoff.hostedHandoffChecklist.blockedCheckIds.map(
        (id) => String(id),
      )
    : checks
        .filter((check) => check?.status === "blocked")
        .map((check) => String(check.id));
  const blockedCheckIdSet = new Set(blockedCheckIds);
  const hostedHandoffChecklist =
    normalizeRealHostedObservabilityHandoffChecklist({
      realHostedObservabilityHandoff,
      blockedChecks: checks.filter((check) =>
        blockedCheckIdSet.has(String(check.id)),
      ),
    });
  const realHostedObservabilitySummary =
    normalizeRealHostedObservabilitySummary({
      realHostedObservabilityHandoff,
      checks,
      passedChecks,
      blockedCheckIds,
      hostedHandoffChecklist,
    });
  const artifactSummary = Object.freeze({
    realHostedObservabilitySummary,
    game: String(realHostedObservabilityHandoff.generatedFrom?.game ?? ""),
    rawEvidencePath: String(
      realHostedObservabilityHandoff.target?.rawEvidencePath ?? "",
    ),
    rawEvidenceStatus: String(
      realHostedObservabilityHandoff.target?.rawEvidenceStatus ?? "unknown",
    ),
    localHostedOpsSignalsPath: String(
      realHostedObservabilityHandoff.target?.localHostedOpsSignalsPath ?? "",
    ),
    localHostedLikeSignalsOnlyBaseline:
      realHostedObservabilityHandoff.target?.localHostedLikeSignalsOnlyBaseline ===
      true,
    blockedCheckCount: blockedCheckIds.length,
    nextCommand: String(realHostedObservabilityHandoff.nextCommand ?? ""),
    nextProofTarget: String(realHostedObservabilityHandoff.nextProofTarget ?? ""),
    releaseReady: realHostedObservabilityHandoff.releaseReady === true,
    productionReady: realHostedObservabilityHandoff.productionReady === true,
  });
  const handoffPath = buildAdminAuditHandoffPath({
    upstreamAuditId: localAdminAuditIds.nextAction,
    localCapabilityAuditId: localAdminAuditIds.hostedOpsSignals,
    downstreamStatus: String(realHostedObservabilityHandoff.status ?? "unknown"),
    downstreamCommand: String(realHostedObservabilityHandoff.nextCommand ?? ""),
    downstreamProofTarget: String(
      realHostedObservabilityHandoff.nextProofTarget ?? "",
    ),
  });
  return Object.freeze({
    id: localAdminAuditIds.realHostedObservabilityHandoff,
    label: "Real hosted observability handoff",
    status: `${realHostedObservabilityHandoff.status}: ${passedChecks.length} passed, ${blockedCheckIds.length} blocked`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Real hosted observability handoff",
    boundaryDetail:
      realHostedObservabilityHandoff.proofBoundary ??
      "Real hosted observability handoff without hosted telemetry or release claims.",
    href: devTestGameRealHostedObservabilityHandoffPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.realHostedObservabilityHandoff,
    }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
        }),
      ),
    ),
    unproven: Object.freeze(
      checks
        .filter((check) => blockedCheckIdSet.has(String(check.id)))
        .map((check) =>
          Object.freeze({
            id: String(check.id),
            status: "blocked",
            requiredEvidence: String(check.requiredEvidence ?? ""),
          }),
        ),
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.hostedOpsSignals,
        label: "Local hosted ops signals",
        href: adminAuditInspectHref({
          game,
          audit: localAdminAuditIds.hostedOpsSignals,
        }),
        status: "baseline",
        command: "test:dev-test-game-hosted-ops-signals",
      }),
      Object.freeze({
        id: localAdminAuditIds.nextAction,
        label: "Ranked next action",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
        status: String(realHostedObservabilityHandoff.status ?? "unknown"),
        command: "test:dev-test-game-next-action",
      }),
    ]),
    handoffPath,
    handoffPathRows: buildAdminAuditHandoffPathRows(handoffPath),
    hostedHandoffChecklist,
    hostedHandoffChecklistRows:
      buildHostedHandoffChecklistRows(hostedHandoffChecklist),
    hostedHandoffOperatorRows:
      buildHostedHandoffOperatorRows(hostedHandoffChecklist),
    hostedHandoffProgressionRows: buildHostedHandoffProgressionRows({
      checklist: hostedHandoffChecklist,
      artifactSummary,
    }),
    hostedHandoffBlockedReceiptRows: buildHostedHandoffBlockedReceiptRows({
      checklist: hostedHandoffChecklist,
      headings: hostedHandoffReceiptHeadingsForAudit(
        localAdminAuditIds.realHostedObservabilityHandoff,
      ),
    }),
    hostedHandoffReceiptHeadings: hostedHandoffReceiptHeadingsForAudit(
      localAdminAuditIds.realHostedObservabilityHandoff,
    ),
    artifactSummary,
    artifactSummarySections:
      buildRealHostedObservabilitySummarySections(artifactSummary),
  });
}

function normalizeRealHostedObservabilitySummary({
  realHostedObservabilityHandoff,
  checks,
  passedChecks,
  blockedCheckIds,
  hostedHandoffChecklist,
}) {
  const inputSections = Array.isArray(hostedHandoffChecklist?.inputSections)
    ? hostedHandoffChecklist.inputSections
    : [];
  const requiredInputCount = inputSections.reduce(
    (total, section) => total + section.requiredInputIds.length,
    0,
  );
  const providedInputCount = inputSections.reduce(
    (total, section) => total + section.providedInputIds.length,
    0,
  );
  return Object.freeze({
    status: String(realHostedObservabilityHandoff.status ?? "unknown"),
    checkCount: checks.length,
    passedCheckCount: passedChecks.length,
    blockedCheckCount: blockedCheckIds.length,
    requiredInputCount,
    providedInputCount,
    missingInputCount: requiredInputCount - providedInputCount,
    baselineStatus:
      realHostedObservabilityHandoff.target?.localHostedLikeSignalsOnlyBaseline ===
      true
        ? "baseline only"
        : "baseline missing",
    localHostedOpsSignalsPath: String(
      realHostedObservabilityHandoff.target?.localHostedOpsSignalsPath ?? "",
    ),
    localVsHostedBoundary:
      "Local hosted-like signals cannot satisfy real hosted observability evidence.",
  });
}

function normalizeRealHostedObservabilityHandoffChecklist({
  realHostedObservabilityHandoff,
  blockedChecks,
}) {
  const checklist = realHostedObservabilityHandoff.hostedHandoffChecklist;
  const inputIds = Array.isArray(checklist?.inputIds)
    ? checklist.inputIds
    : realHostedObservabilityHandoffInputIds;
  return Object.freeze({
    status: String(realHostedObservabilityHandoff.status ?? "unknown"),
    preflightStatus: String(
      checklist?.preflightStatus ??
        realHostedObservabilityHandoff.status ??
        "unknown",
    ),
    command: String(
      checklist?.command ??
        realHostedObservabilityHandoff.nextCommand ??
        `npm run ${devTestGameRealHostedObservabilityHandoffCommand}`,
    ),
    proofTarget: String(
      checklist?.proofTarget ??
        realHostedObservabilityHandoff.nextProofTarget ??
        devTestGameRealHostedObservabilityHandoffPath,
    ),
    inputCount: inputIds.length,
    blockedCheckCount: blockedChecks.length,
    inputs: Object.freeze(
      inputIds.map((id) =>
        Object.freeze({
          id: String(id),
          label: String(id),
          value: realHostedObservabilityHandoffInputValue({
            id,
            realHostedObservabilityHandoff,
          }),
          required: true,
        }),
      ),
    ),
    blockedChecks: Object.freeze(
      blockedChecks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: "blocked",
          requiredEvidence: String(check.requiredEvidence ?? ""),
        }),
      ),
    ),
    groups: normalizeHostedHandoffGroups(checklist?.requirementGroups),
    inputSections: normalizeHostedHandoffInputSections(checklist?.inputSections),
    blockedReceipt: normalizeHostedHandoffBlockedReceipt(checklist?.blockedReceipt),
  });
}

export function appendLocalProofFreshnessAudit(
  audit,
  proofFreshness,
  { game, nextAction = null },
) {
  const row = normalizeLocalProofFreshnessAudit(proofFreshness, { game, nextAction });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalNextActionAudit(audit, nextAction, { game, proofGraph = null }) {
  const row = normalizeLocalNextActionAudit(nextAction, { game, proofGraph });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalProofGraphAudit(audit, proofGraph, { game }) {
  const row = normalizeLocalProofGraphAudit(proofGraph, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalRaceCoverageAudit(audit, raceCoverage, { game }) {
  const row = normalizeLocalRaceCoverageAudit(raceCoverage, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalHostedConcurrentRaceMatrixAudit(
  audit,
  hostedConcurrentRaceMatrix,
  { game },
) {
  const row = normalizeLocalHostedConcurrentRaceMatrixAudit(
    hostedConcurrentRaceMatrix,
    { game },
  );
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalHostedConcurrentRaceMatrixAudit(
  hostedConcurrentRaceMatrix,
  { game },
) {
  if (
    hostedConcurrentRaceMatrix === null ||
    typeof hostedConcurrentRaceMatrix !== "object" ||
    hostedConcurrentRaceMatrix.version !== 1 ||
    hostedConcurrentRaceMatrix.proof !==
      "dev-test-game-hosted-concurrent-race-matrix" ||
    hostedConcurrentRaceMatrix.status !== "passed" ||
    hostedConcurrentRaceMatrix.scope !== "local-hosted-like-concurrent-race-matrix" ||
    hostedConcurrentRaceMatrix.releaseReady !== false ||
    hostedConcurrentRaceMatrix.productionReady !== false
  ) {
    return null;
  }
  const cells = Array.isArray(hostedConcurrentRaceMatrix.cells)
    ? hostedConcurrentRaceMatrix.cells
    : [];
  const progress = Array.isArray(hostedConcurrentRaceMatrix.evidenceProgress)
    ? hostedConcurrentRaceMatrix.evidenceProgress
    : [];
  const roleSurfaces = Array.isArray(
    hostedConcurrentRaceMatrix.hostedLikeTarget?.roleSurfaces,
  )
    ? hostedConcurrentRaceMatrix.hostedLikeTarget.roleSurfaces
    : [];
  const reconnectLanes = Array.isArray(hostedConcurrentRaceMatrix.reconnectLanes)
    ? hostedConcurrentRaceMatrix.reconnectLanes
    : [];
  const staleConflictLanes = Array.isArray(
    hostedConcurrentRaceMatrix.staleConflictLanes,
  )
    ? hostedConcurrentRaceMatrix.staleConflictLanes
    : [];
  const remainingGaps = Array.isArray(hostedConcurrentRaceMatrix.remainingGaps)
    ? hostedConcurrentRaceMatrix.remainingGaps
    : [];
  const requestedEvidence =
    hostedConcurrentRaceMatrix.requestedEvidence !== null &&
    typeof hostedConcurrentRaceMatrix.requestedEvidence === "object"
      ? hostedConcurrentRaceMatrix.requestedEvidence
      : null;
  const realHostedEvidenceInputs = normalizeRealHostedEvidenceInputs(
    hostedConcurrentRaceMatrix.realHostedEvidenceInputs,
  );
  const hostedHandoffChecklist = normalizeHostedMatrixHandoffChecklist({
    hostedConcurrentRaceMatrix,
    realHostedEvidenceInputs,
  });
  const hostedMatrixSummary = normalizeHostedMatrixSummary({
    hostedConcurrentRaceMatrix,
    cells,
    hostedHandoffChecklist,
  });
  const artifactSummary = Object.freeze({
    hostedMatrixSummary,
    game: String(hostedConcurrentRaceMatrix.hostedLikeTarget?.game ?? ""),
    cellCount: Number(hostedConcurrentRaceMatrix.summary?.cellCount ?? cells.length),
    passedCellCount: Number(
      hostedConcurrentRaceMatrix.summary?.passedCellCount ?? 0,
    ),
    reloadCoveredCellCount: Number(
      hostedConcurrentRaceMatrix.summary?.reloadCoveredCellCount ?? 0,
    ),
    reconnectLaneCount: Number(
      hostedConcurrentRaceMatrix.summary?.reconnectLaneCount ?? 0,
    ),
    staleConflictLaneCount: Number(
      hostedConcurrentRaceMatrix.summary?.staleConflictLaneCount ?? 0,
    ),
    roleSurfaceCount: Number(
      hostedConcurrentRaceMatrix.summary?.roleSurfaceCount ?? roleSurfaces.length,
    ),
    hostedEvidenceStatus: String(
      hostedConcurrentRaceMatrix.summary?.hostedEvidenceStatus ?? "unknown",
    ),
    hostedEvidenceMode: String(
      hostedConcurrentRaceMatrix.summary?.hostedEvidenceMode ?? "unknown",
    ),
    localDemoHostedEvidenceStatus: String(
      hostedConcurrentRaceMatrix.summary?.localDemoHostedEvidenceStatus ??
        "unknown",
    ),
    realHostedEvidenceStatus: String(
      hostedConcurrentRaceMatrix.summary?.realHostedEvidenceStatus ?? "unknown",
    ),
    realHostedDeploymentStatus: String(
      hostedConcurrentRaceMatrix.summary?.realHostedDeploymentStatus ?? "unknown",
    ),
    externalHostedEvidenceStatus: String(
      hostedConcurrentRaceMatrix.externalHostedEvidence?.status ?? "unknown",
    ),
    realHostedEvidenceCommand: String(
      hostedConcurrentRaceMatrix.realHostedEvidenceInputs?.command ?? "",
    ),
    realHostedEvidenceProofTarget: String(
      hostedConcurrentRaceMatrix.realHostedEvidenceInputs?.proofTarget ?? "",
    ),
    nextCommand: String(hostedConcurrentRaceMatrix.nextBuildSlice?.command ?? ""),
    releaseReady: hostedConcurrentRaceMatrix.releaseReady === true,
    productionReady: hostedConcurrentRaceMatrix.productionReady === true,
  });
  const handoffPath = buildAdminAuditHandoffPath({
    upstreamAuditId: localAdminAuditIds.nextAction,
    localCapabilityAuditId: localAdminAuditIds.raceCoverage,
    downstreamStatus: String(
      hostedConcurrentRaceMatrix.summary?.realHostedEvidenceStatus ?? "unknown",
    ),
    downstreamCommand: String(
      hostedConcurrentRaceMatrix.realHostedEvidenceInputs?.command ?? "",
    ),
    downstreamProofTarget: String(
      hostedConcurrentRaceMatrix.realHostedEvidenceInputs?.proofTarget ?? "",
    ),
  });
  return Object.freeze({
    id: localAdminAuditIds.hostedConcurrentRaceMatrix,
    label: "Local hosted matrix",
    status: `${Number(
      hostedConcurrentRaceMatrix.summary?.passedCellCount ?? 0,
    )} hosted-like race cells passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local hosted-like concurrency matrix",
    boundaryDetail:
      hostedConcurrentRaceMatrix.proofBoundary ??
      "Local hosted-like concurrency matrix without hosted deployment or release claims.",
    href: devTestGameHostedConcurrentRaceMatrixPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.hostedConcurrentRaceMatrix,
    }),
    checks: Object.freeze(
      [
        ...progress.map((item) =>
          Object.freeze({
            id: String(item.id),
            status: String(item.status),
          }),
        ),
        ...cells.map((cell) =>
          Object.freeze({
            id: String(cell.id),
            status: String(cell.status),
          }),
        ),
      ],
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.raceCoverage,
        label: "Race coverage",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.raceCoverage }),
        status: String(
          hostedConcurrentRaceMatrix.generatedFrom?.raceCoveragePromotedMilestones
            ?.status ?? "unknown",
        ),
        command: "test:dev-test-game-race-coverage",
      }),
      Object.freeze({
        id: localAdminAuditIds.nextAction,
        label: "Ranked next action",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
        status: String(requestedEvidence?.status ?? "unknown"),
        command: String(hostedConcurrentRaceMatrix.nextBuildSlice?.command ?? ""),
      }),
    ]),
    handoffPath,
    handoffPathRows: buildAdminAuditHandoffPathRows(handoffPath),
    reconnectLanes: Object.freeze(
      reconnectLanes.map((lane) =>
        Object.freeze({
          id: String(lane.id),
          label: String(lane.label ?? lane.id ?? ""),
          status: String(lane.status ?? "unknown"),
        }),
      ),
    ),
    staleConflictLanes: Object.freeze(
      staleConflictLanes.map((lane) =>
        Object.freeze({
          id: String(lane.id),
          label: String(lane.label ?? lane.id ?? ""),
          status: String(lane.status ?? "unknown"),
        }),
      ),
    ),
    unproven: Object.freeze(
      [
        ...(requestedEvidence === null
          ? []
          : [
              Object.freeze({
                id: String(requestedEvidence.id),
                status: String(requestedEvidence.status ?? "unknown"),
                requiredEvidence: String(requestedEvidence.requiredEvidence ?? ""),
              }),
            ]),
        ...remainingGaps.map((gap, index) =>
          Object.freeze({
            id: `remaining-gap-${index + 1}`,
            status: "unproven",
            requiredEvidence: String(gap),
          }),
        ),
      ],
    ),
    realHostedEvidenceInputs,
    realHostedEvidenceInputRows:
      buildRealHostedEvidenceInputRows(realHostedEvidenceInputs),
    hostedHandoffChecklist,
    hostedHandoffChecklistRows:
      buildHostedHandoffChecklistRows(hostedHandoffChecklist),
    hostedHandoffOperatorRows:
      buildHostedHandoffOperatorRows(hostedHandoffChecklist),
    hostedHandoffProgressionRows: buildHostedHandoffProgressionRows({
      checklist: hostedHandoffChecklist,
      artifactSummary,
    }),
    hostedHandoffBlockedReceiptRows: buildHostedHandoffBlockedReceiptRows({
      checklist: hostedHandoffChecklist,
      headings: hostedHandoffReceiptHeadingsForAudit(
        localAdminAuditIds.hostedConcurrentRaceMatrix,
      ),
    }),
    hostedHandoffReceiptHeadings: hostedHandoffReceiptHeadingsForAudit(
      localAdminAuditIds.hostedConcurrentRaceMatrix,
    ),
    artifactSummary,
    artifactSummarySections: buildHostedMatrixSummarySections(artifactSummary),
  });
}

function normalizeHostedMatrixSummary({
  hostedConcurrentRaceMatrix,
  cells,
  hostedHandoffChecklist,
}) {
  const cellCount = Number(hostedConcurrentRaceMatrix.summary?.cellCount ?? cells.length);
  const passedCellCount = Number(
    hostedConcurrentRaceMatrix.summary?.passedCellCount ?? 0,
  );
  const reloadCoveredCellCount = Number(
    hostedConcurrentRaceMatrix.summary?.reloadCoveredCellCount ?? 0,
  );
  const missingHostedInputIds = Object.freeze([
    ...(hostedHandoffChecklist?.blockedReceipt?.missingRequiredInputs ?? []),
  ]);
  return Object.freeze({
    status: String(hostedConcurrentRaceMatrix.status ?? "unknown"),
    cellCount,
    passedCellCount,
    reloadCoveredCellCount,
    reconnectLaneCount: Number(
      hostedConcurrentRaceMatrix.summary?.reconnectLaneCount ?? 0,
    ),
    staleConflictLaneCount: Number(
      hostedConcurrentRaceMatrix.summary?.staleConflictLaneCount ?? 0,
    ),
    hostedEvidenceStatus: String(
      hostedConcurrentRaceMatrix.summary?.realHostedEvidenceStatus ?? "unknown",
    ),
    hostedDeploymentStatus: String(
      hostedConcurrentRaceMatrix.summary?.realHostedDeploymentStatus ?? "unknown",
    ),
    hostedEvidenceMode: String(
      hostedConcurrentRaceMatrix.summary?.hostedEvidenceMode ?? "unknown",
    ),
    missingHostedInputCount: missingHostedInputIds.length,
    missingHostedInputIds,
    localVsHostedBoundary:
      "Local hosted-like matrix evidence cannot satisfy real hosted race evidence.",
  });
}

function normalizeHostedMatrixHandoffChecklist({
  hostedConcurrentRaceMatrix,
  realHostedEvidenceInputs,
}) {
  const checklist = hostedConcurrentRaceMatrix.hostedHandoffChecklist;
  if (checklist === null || typeof checklist !== "object") {
    return null;
  }
  const blockedChecks = Array.isArray(checklist.blockedChecks)
    ? checklist.blockedChecks
    : [];
  const checklistInputs =
    realHostedEvidenceInputs.length > 0
      ? realHostedEvidenceInputs
      : Array.isArray(checklist.inputIds)
        ? checklist.inputIds.map((id) =>
            Object.freeze({
              id: String(id ?? ""),
              label: String(id ?? ""),
              value: "required",
              required: true,
            }),
          )
        : [];
  return Object.freeze({
    status: String(checklist.status ?? "unknown"),
    preflightStatus: String(checklist.preflightStatus ?? "unknown"),
    command: String(checklist.command ?? ""),
    proofTarget: String(checklist.proofTarget ?? ""),
    inputCount: checklistInputs.length,
    blockedCheckCount: blockedChecks.length,
    inputs: Object.freeze(
      checklistInputs.map((input) =>
        Object.freeze({
          id: input.id,
          label: input.label,
          value: input.value,
          required: input.required,
        }),
      ),
    ),
    blockedChecks: Object.freeze(
      blockedChecks.map((check) =>
        Object.freeze({
          id: String(check.id ?? ""),
          status: String(check.status ?? "unknown"),
          requiredEvidence: String(check.requiredEvidence ?? ""),
        }),
      ),
    ),
    blockedReceipt: normalizeHostedHandoffBlockedReceipt(
      checklist.blockedReceipt,
    ),
  });
}

export function normalizeLocalRaceCoverageAudit(raceCoverage, { game }) {
  if (
    raceCoverage === null ||
    typeof raceCoverage !== "object" ||
    raceCoverage.version !== 1 ||
    raceCoverage.proof !== "dev-test-game-race-coverage" ||
    raceCoverage.status !== "passed" ||
    raceCoverage.scope !== "local-dev-test-game-race-coverage" ||
    raceCoverage.releaseReady !== false ||
    raceCoverage.productionReady !== false
  ) {
    return null;
  }
  const cells = Array.isArray(raceCoverage.cells) ? raceCoverage.cells : [];
  const passedCells = cells.filter((cell) => cell?.status === "passed");
  return Object.freeze({
    id: localAdminAuditIds.raceCoverage,
    label: "Local race coverage",
    status: `${passedCells.length} race cells passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local race-coverage inventory",
    boundaryDetail:
      raceCoverage.proofBoundary ??
      "Generated local race-coverage inventory without hosted concurrency claims.",
    href: devTestGameRaceCoveragePath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.raceCoverage }),
    checks: Object.freeze(
      cells.map((cell) =>
        Object.freeze({
          id: String(cell.id),
          status: String(cell.status),
        }),
      ),
    ),
    artifactSummary: Object.freeze({
      game: String(raceCoverage.generatedFrom?.game ?? ""),
      cellCount: Number(raceCoverage.summary?.cellCount ?? cells.length),
      provenCellCount: Number(raceCoverage.summary?.provenCellCount ?? passedCells.length),
      unprovenCellCount: Number(raceCoverage.summary?.unprovenCellCount ?? 0),
      reloadRequiredCellCount: Number(
        raceCoverage.summary?.reloadRequiredCellCount ?? 0,
      ),
      reloadCoveredCellCount: Number(
        raceCoverage.summary?.reloadCoveredCellCount ?? 0,
      ),
      reloadGapCount: Number(raceCoverage.summary?.reloadGapCount ?? 0),
      releaseReady: raceCoverage.releaseReady === true,
      productionReady: raceCoverage.productionReady === true,
    }),
  });
}

export function normalizeLocalProofGraphAudit(proofGraph, { game }) {
  if (
    proofGraph === null ||
    typeof proofGraph !== "object" ||
    proofGraph.version !== 1 ||
    proofGraph.proof !== "dev-test-game-proof-graph" ||
    proofGraph.status !== "passed" ||
    proofGraph.scope !== "local-dev-test-game-proof-graph" ||
    proofGraph.releaseReady !== false ||
    proofGraph.productionReady !== false
  ) {
    return null;
  }
  const nodes = Array.isArray(proofGraph.nodes) ? proofGraph.nodes : [];
  const edges = Array.isArray(proofGraph.edges) ? proofGraph.edges : [];
  const roleNodes = nodes.filter(
    (node) => typeof node?.roleUrl === "string" && node.roleUrl.trim() !== "",
  );
  const artifactSummary = normalizeLocalProofGraphArtifactSummary(proofGraph, {
    nodes,
    edges,
    roleNodes,
  });
  return Object.freeze({
    id: localAdminAuditIds.proofGraph,
    label: "Local proof graph",
    status: `${nodes.length} proof nodes, ${edges.length} edges`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local development-spine proof graph",
    boundaryDetail:
      proofGraph.proofBoundary ??
      "Generated local proof graph without hosted or release-readiness claims.",
    href: localProofArtifactHref({ game, artifact: devTestGameProofGraphPath }),
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.proofGraph }),
    checks: normalizeLocalProofGraphCheckRows(proofGraph),
    relatedLinks: normalizeLocalProofGraphRelatedLinks(proofGraph, { game, nodes }),
    artifactSummary,
    artifactSummarySections: buildLocalProofGraphSummarySections(artifactSummary, {
      nodes,
      edges,
      game,
    }),
  });
}

export function normalizeLocalProofGraphCheckRows(proofGraph) {
  const nodes = Array.isArray(proofGraph?.nodes) ? proofGraph.nodes : [];
  const edges = Array.isArray(proofGraph?.edges) ? proofGraph.edges : [];
  return Object.freeze([
    ...nodes.flatMap((node) => normalizeLocalProofGraphNodeCheckRows(node)),
    ...edges.flatMap((edge) => normalizeLocalProofGraphEdgeCheckRows(edge)),
  ]);
}

export function normalizeLocalProofGraphNodeCheckRows(node) {
  const parentId = String(node?.id ?? "");
  return Object.freeze([
    Object.freeze({
      id: parentId,
      status: localProofGraphNodeCheckStatus(node),
    }),
    ...coverageDecisionCheckRows({
      parentId,
      coverageDecision: node?.coverageDecision,
    }),
    ...normalizedEvidenceObjectCheckRows({
      parentId,
      objects: node?.normalizedEvidenceObjects,
    }),
    ...proofGraphReceiptArtifactCheckRows({
      parentId,
      artifacts: node?.receiptArtifacts,
    }),
  ]);
}

function localProofGraphNodeCheckStatus(node) {
  const status = String(node?.status ?? "recorded");
  const roleUrl = String(node?.roleUrl ?? "").trim();
  const recoveryCommand = String(
    node?.recoveryCommand ?? node?.proofCommand ?? "",
  ).trim();
  const targetRoleUrl = String(node?.targetRoleUrl ?? "").trim();
  const browserProofCommand = String(node?.browserProofCommand ?? "").trim();
  const browserWorkbenchEvidence = String(
    node?.browserWorkbench?.requiredEvidence ?? "",
  ).trim();
  const firstMissingInputId = String(node?.firstMissingInputId ?? "").trim();
  const firstMissingCheckId = String(node?.firstMissingCheckId ?? "").trim();
  const rawEvidenceContractSummary = String(
    node?.rawEvidenceContractSummary ?? "",
  ).trim();
  const rawEvidenceTemplate =
    node?.rawEvidenceTemplate !== null &&
    typeof node?.rawEvidenceTemplate === "object"
      ? node.rawEvidenceTemplate
      : null;
  const proofTarget = String(node?.proofTarget ?? "").trim();
  const packetProofTarget = String(node?.packetProofTarget ?? "").trim();
  const nextProofTarget = String(node?.nextProofTarget ?? "").trim();
  const selectedProductionFeatureGraphNodeId = String(
    node?.selectedProductionFeatureGraphNodeId ?? "",
  ).trim();
  const selectedProductionFeatureRoleUrl = String(
    node?.selectedProductionFeatureRoleUrl ?? "",
  ).trim();
  const operatorAction = String(node?.operatorAction ?? "").trim();
  const localVsHostedBoundary = String(
    node?.localVsHostedBoundary ?? "",
  ).trim();
  const checkedCount =
    typeof node?.checkedCount === "number" ? node.checkedCount : null;
  return [
    status,
    ...(checkedCount === null ? [] : [`${checkedCount} checked`]),
    ...(firstMissingInputId === ""
      ? []
      : [`firstMissingInputId ${firstMissingInputId}`]),
    ...(firstMissingCheckId === ""
      ? []
      : [`firstMissingCheckId ${firstMissingCheckId}`]),
    ...(roleUrl === "" ? [] : [`roleUrl ${roleUrl}`]),
    ...(targetRoleUrl === "" ? [] : [`targetRoleUrl ${targetRoleUrl}`]),
    ...(selectedProductionFeatureGraphNodeId === ""
      ? []
      : [`selectedProductionFeatureGraphNodeId ${selectedProductionFeatureGraphNodeId}`]),
    ...(selectedProductionFeatureRoleUrl === ""
      ? []
      : [`selectedProductionFeatureRoleUrl ${selectedProductionFeatureRoleUrl}`]),
    ...(recoveryCommand === "" ? [] : [`recoveryCommand ${recoveryCommand}`]),
    ...(proofTarget === "" ? [] : [`proofTarget ${proofTarget}`]),
    ...(packetProofTarget === ""
      ? []
      : [`packetProofTarget ${packetProofTarget}`]),
    ...(nextProofTarget === "" ? [] : [`nextProofTarget ${nextProofTarget}`]),
    ...(rawEvidenceContractSummary === ""
      ? []
      : [`rawEvidenceContract ${rawEvidenceContractSummary}`]),
    ...(rawEvidenceTemplate === null
      ? []
      : hostedMatrixRawEvidenceTemplateDiagnosticFieldValues(
          rawEvidenceTemplate,
        ).map((field) => `${field.rowId} ${String(field.value ?? "").trim()}`)),
    ...(operatorAction === "" ? [] : [`operatorAction ${operatorAction}`]),
    ...(localVsHostedBoundary === ""
      ? []
      : [`localVsHostedBoundary ${localVsHostedBoundary}`]),
    ...(browserProofCommand === ""
      ? []
      : [`browserProofCommand ${browserProofCommand}`]),
    ...(browserWorkbenchEvidence === ""
      ? []
      : [`browserWorkbench ${browserWorkbenchEvidence}`]),
  ].join("\n");
}

export function normalizeLocalProofGraphEdgeCheckRows(edge) {
  return Object.freeze([
    Object.freeze({
      id: proofGraphEdgeCheckId(edge),
      status: proofGraphEdgeStatusText(edge),
    }),
  ]);
}

export function normalizeLocalProofGraphRelatedLinks(
  proofGraph,
  { game, nodes } = {},
) {
  const graphNodes = Array.isArray(nodes)
    ? nodes
    : Array.isArray(proofGraph?.nodes)
      ? proofGraph.nodes
      : [];
  const roleNodes = graphNodes.filter(
    (node) => typeof node?.roleUrl === "string" && node.roleUrl.trim() !== "",
  );
  const terminalBatchNode = graphNodes.find(
    (node) => node?.id === "admin-spine-terminal-batches",
  );
  return Object.freeze(
    [
      ...roleNodes.map((node) =>
        Object.freeze({
          id: String(node.id),
          label: String(node.label ?? node.id),
          href: seededRoleUrlToAdminHref(node.roleUrl, { game }),
          status: String(node.status ?? "recorded"),
          command: String(node.recoveryCommand ?? node.proofCommand ?? ""),
        }),
      ),
      ...(terminalBatchNode === undefined
        ? []
        : [
            Object.freeze({
              id: "next-action-sequence-handoff",
              label: "Next action handoff",
              href: adminAuditInspectHref({
                game,
                audit: localAdminAuditIds.nextAction,
              }),
              status: String(terminalBatchNode.status ?? "recorded"),
              command: "npm run test:dev-test-game-next-action-admin-proof",
            }),
          ]),
    ],
  );
}

export function normalizeLocalProofGraphArtifactSummary(
  proofGraph,
  { nodes, edges, roleNodes } = {},
) {
  const graphNodes = Array.isArray(nodes)
    ? nodes
    : Array.isArray(proofGraph?.nodes)
      ? proofGraph.nodes
      : [];
  const graphEdges = Array.isArray(edges)
    ? edges
    : Array.isArray(proofGraph?.edges)
      ? proofGraph.edges
      : [];
  const graphRoleNodes = Array.isArray(roleNodes)
    ? roleNodes
    : graphNodes.filter((node) => typeof node?.roleUrl === "string");
  return Object.freeze({
    nodeCount: Number(proofGraph?.summary?.nodeCount ?? graphNodes.length),
    edgeCount: Number(proofGraph?.summary?.edgeCount ?? graphEdges.length),
    roleUrlCount: Number(
      proofGraph?.summary?.roleUrlCount ?? graphRoleNodes.length,
    ),
    recoveryTargetCount: Number(proofGraph?.summary?.recoveryTargetCount ?? 0),
    diagnosticProofSummary: normalizeLocalProofGraphDiagnosticProofSummary({
      proofGraph,
      nodes: graphNodes,
    }),
    productionFeatureDestinationSummary:
      proofGraph?.summary?.productionFeatureDestinationSummary ?? null,
    coreLoopRecoveryDestinationSummary:
      proofGraphCoreLoopRecoveryDestinationSummary({
        nodes: graphNodes,
        edges: graphEdges,
      }),
    releaseReady: proofGraph?.releaseReady === true,
    productionReady: proofGraph?.productionReady === true,
  });
}

export function normalizeLocalProofGraphDiagnosticProofSummary({
  proofGraph,
  nodes,
} = {}) {
  return normalizeProofGraphDiagnosticProofSummary(
    proofGraph?.summary?.diagnosticProofSummary,
    { nodes },
  );
}

function normalizedEvidenceObjectCheckRows({ parentId, objects }) {
  return normalizeNormalizedEvidenceObjects(objects).map((object) =>
    Object.freeze({
      id: `evidence-object:${parentId}:${object.name}`,
      status: `${object.status}:${object.laneId}:${object.evidencePath}`,
      name: object.name,
      laneId: object.laneId,
      evidencePath: object.evidencePath,
    }),
  );
}

function proofGraphReceiptArtifactCheckRows({ parentId, artifacts }) {
  return normalizeProofGraphReceiptArtifactRows({ parentId, artifacts });
}

function normalizeNormalizedEvidenceObjects(objects) {
  return Object.freeze(
    (Array.isArray(objects) ? objects : [])
      .map((object) =>
        Object.freeze({
          name: String(object?.name ?? ""),
          laneId: String(object?.laneId ?? ""),
          status: String(object?.status ?? "unknown"),
          evidencePath: String(object?.evidencePath ?? ""),
        }),
      )
      .filter((object) => object.name !== ""),
  );
}

export function normalizeLocalNextActionAudit(nextAction, { game, proofGraph = null }) {
  if (
    nextAction === null ||
    typeof nextAction !== "object" ||
    nextAction.version !== 1 ||
    nextAction.proof !== "dev-test-game-next-action" ||
    nextAction.status !== "passed" ||
    nextAction.scope !== "local-dev-test-game-next-action" ||
    nextAction.releaseReady !== false ||
    nextAction.productionReady !== false
  ) {
    return null;
  }
  const action = nextAction.nextAction ?? {};
  const command = String(action.command ?? "");
  const reason = String(action.reason ?? "unknown");
  const actionStatus = String(action.status ?? "unknown");
  const artifact =
    action.artifact !== null && typeof action.artifact === "object"
      ? action.artifact
      : null;
  const artifactRoleUrl =
    typeof artifact?.roleUrl === "string" && artifact.roleUrl.trim() !== ""
      ? artifact.roleUrl
      : "";
  const artifactProofTarget = String(artifact?.proofTarget ?? artifact?.path ?? "");
  const localCheck =
    action.localCheck !== null && typeof action.localCheck === "object"
      ? action.localCheck
      : null;
  const unproven =
    action.unproven !== null && typeof action.unproven === "object"
      ? action.unproven
      : null;
  const seedProofLaneCoverage =
    action.seedProofLaneCoverage !== null &&
    typeof action.seedProofLaneCoverage === "object"
      ? action.seedProofLaneCoverage
      : null;
  const proofGraphDestinationSummary =
    action.proofGraphDestinationSummary !== null &&
    typeof action.proofGraphDestinationSummary === "object"
      ? action.proofGraphDestinationSummary
      : null;
  const sequenceDeferral =
    action.sequenceDeferral !== null &&
    typeof action.sequenceDeferral === "object"
      ? action.sequenceDeferral
      : null;
  const localCapabilityConfidence =
    sequenceDeferral?.localCapabilityConfidence !== null &&
    typeof sequenceDeferral?.localCapabilityConfidence === "object"
      ? sequenceDeferral.localCapabilityConfidence
      : null;
  const realHostedEvidenceInputs = normalizeRealHostedEvidenceInputs(
    unproven?.realHostedEvidenceInputs,
  );
  const hostedHandoffChecklist = normalizeNextActionHostedHandoffChecklist({
    unproven,
    realHostedEvidenceInputs,
  });
  const selectedOperatorHandoff =
    normalizeNextActionSelectedOperatorHandoff(
      nextAction.selectedOperatorHandoff,
    );
  const hostedIdentityFamilyBatch =
    normalizeNextActionHostedIdentityFamilyBatch(
      unproven?.hostedIdentityFamilyBatch,
    );
  const hostedIdentityProofGraphEdges =
    normalizeNextActionHostedIdentityProofGraphEdges(
      unproven?.hostedIdentityProofGraphEdges,
    );
  const localCheckRoleUrl =
    typeof localCheck?.roleUrl === "string" && localCheck.roleUrl.trim() !== ""
      ? localCheck.roleUrl
      : "";
  const unprovenRoleUrl =
    typeof unproven?.roleUrl === "string" && unproven.roleUrl.trim() !== ""
      ? unproven.roleUrl
      : "";
  const seedProofLaneCoverageRoleUrl =
    typeof seedProofLaneCoverage?.roleUrl === "string" &&
    seedProofLaneCoverage.roleUrl.trim() !== ""
      ? seedProofLaneCoverage.roleUrl
      : "";
  const sequenceDeferralRoleUrl =
    typeof sequenceDeferral?.deferredRoleUrl === "string" &&
    sequenceDeferral.deferredRoleUrl.trim() !== ""
      ? sequenceDeferral.deferredRoleUrl
      : "";
  const unprovenProofGraphNodeId =
    typeof unproven?.proofGraphNodeId === "string" &&
    unproven.proofGraphNodeId.trim() !== ""
      ? unproven.proofGraphNodeId
      : "";
  const selectedProofGraphNode = selectedNextActionProofGraphNodeSummary({
    nextAction,
    proofGraph,
  });
  const selectedProofGraphNodeStatus = selectedNextActionProofGraphNodeStatus({
    nextAction,
    proofGraph,
  });
  const selectedSpineTarget = normalizeNextActionSpineTarget(unproven?.spineTarget);
  const selectedSpineDrilldown = normalizeNextActionSpineDrilldown(
    unproven?.spineDrilldown,
  );
  const selectedProductionFeatureSpineTarget =
    normalizeNextActionFeatureSpineDeclaration(
      unproven?.productionFeatureSpineTarget,
    );
  const selectedProductionFeatureGraph =
    normalizeNextActionProductionFeatureGraph(
      unproven?.selectedProductionFeatureGraph,
    );
  const selectionTrace = normalizeNextActionSelectionTrace(nextAction.selectionTrace);
  const releaseReadinessTrace = normalizeNextActionReleaseReadinessTrace(
    nextAction.releaseReadinessTrace,
  );
  const selectedReleaseReadinessCandidate =
    releaseReadinessTrace.candidates.find((candidate) => candidate.selected) ??
    null;
  const localReadinessDependencyTrace =
    normalizeLocalNextActionLocalReadinessDependencyTrace(
      nextAction.localReadinessDependencyTrace,
    );
  const replacementRaceReloadTrace = normalizeNextActionReplacementRaceReloadTrace(
    nextAction.replacementRaceReloadTrace,
  );
  const hostConcurrentRaceReloadTrace =
    normalizeNextActionHostConcurrentRaceReloadTrace(
      nextAction.hostConcurrentRaceReloadTrace,
    );
  const playerConcurrentActionReloadTrace =
    normalizeNextActionPlayerConcurrentActionReloadTrace(
      nextAction.playerConcurrentActionReloadTrace,
    );
  const cohostDeadlineRaceReloadTrace =
    normalizeNextActionCohostDeadlineRaceReloadTrace(
      nextAction.cohostDeadlineRaceReloadTrace,
    );
  const raceCoveragePromotedMilestones =
    normalizeNextActionRaceCoveragePromotedMilestones(
      nextAction.raceCoveragePromotedMilestones,
    );
  const staleConflictMessageTrace = normalizeNextActionStaleConflictMessageTrace(
    nextAction.staleConflictMessageTrace,
  );
  const hostStaleControlTrace = normalizeNextActionHostStaleControlTrace(
    nextAction.hostStaleControlTrace,
  );
  const stabilityTrace = normalizePreReadinessTrace(
    preReadinessTraceKeys.proofStability,
    nextAction.stabilityTrace,
  );
  const seedProofLaneCoverageTrace = normalizePreReadinessTrace(
    preReadinessTraceKeys.seedProofLaneCoverage,
    nextAction.seedProofLaneCoverageTrace,
  );
  const proofGraphDestinationSummaryTrace = normalizePreReadinessTrace(
    preReadinessTraceKeys.proofGraphDestinationSummary,
    nextAction.proofGraphDestinationSummaryTrace,
  );
  const proofGraphDiagnosticSummaryTrace =
    normalizeProofGraphDiagnosticSummaryTrace(
      nextAction.proofGraphDiagnosticSummaryTrace,
    );
  const terminalBatchGraph = normalizeNextActionTerminalBatchGraph(
    nextAction.generatedFrom?.terminalBatchGraph,
  );
  const nextActionHandoffPair = normalizeAdminSpineNextActionHandoffPair(
    nextAction.generatedFrom?.nextActionHandoffPair,
  );
  const privateChannelRecoveryGraph =
    normalizeNextActionRecoveryReceiptGraph(
      nextAction.generatedFrom?.privateChannelRecoveryGraph,
    );
  const replacementActionRecoveryGraph =
    normalizeNextActionRecoveryReceiptGraph(
      nextAction.generatedFrom?.replacementActionRecoveryGraph,
    );
  const replacementHandoffRecoveryGraph =
    normalizeNextActionRecoveryReceiptGraph(
      nextAction.generatedFrom?.replacementHandoffRecoveryGraph,
    );
  const replacementPrivateRecoveryGraph =
    normalizeNextActionRecoveryReceiptGraph(
      nextAction.generatedFrom?.replacementPrivateRecoveryGraph,
    );
  const coreLoopRecoveryDestinationCoverage =
    normalizeNextActionCoreLoopRecoveryDestinationCoverage(
      nextAction.generatedFrom?.coreLoopRecoveryDestinationCoverage,
    );
  const phaseLocalNextActionSnapshots =
    normalizeLocalNextActionPhaseLocalSnapshots(proofGraph);
  const generatedSummary = normalizeLocalNextActionGeneratedSummary(nextAction);
  const stability =
    action.stability !== null && typeof action.stability === "object"
      ? action.stability
      : null;
  const checks = [
    Object.freeze({
      id: "next-command",
      status: command === "" ? "missing" : "available",
    }),
    Object.freeze({
      id: reason,
      status: actionStatus,
    }),
    ...(artifact === null
      ? []
      : [
          Object.freeze({
            id: String(artifact.id),
            status: String(artifact.status ?? "unknown"),
          }),
        ]),
    ...(localCheck === null
      ? []
      : [
          Object.freeze({
            id: String(localCheck.id),
            status: String(localCheck.status ?? "unknown"),
          }),
        ]),
    ...(unproven === null
      ? []
      : [
          Object.freeze({
            id: String(unproven.id),
            status: String(unproven.status ?? "unknown"),
          }),
        ]),
    ...(selectedReleaseReadinessCandidate?.id === "hosted-production-identity"
      ? [
          ...(hostedIdentityFamilyBatch === null
            ? []
            : [
                Object.freeze({
                  id: hostedIdentityFamilyBatch.id,
                  status: [
                    hostedIdentityFamilyBatch.status,
                    hostedIdentityFamilyBatch.command,
                    hostedIdentityFamilyBatch.firstPendingProgressionId,
                    ...hostedIdentityFamilyBatch.proofTargets,
                    hostedIdentityFamilyBatch.proofBoundary,
                  ]
                    .filter((part) => String(part ?? "") !== "")
                    .join("\n"),
                }),
              ]),
          ...(hostedIdentityProofGraphEdges === null
            ? []
            : [
                Object.freeze({
                  id: hostedIdentityProofGraphEdges.id,
                  status: [
                    hostedIdentityProofGraphEdges.status,
                    hostedIdentityProofGraphEdges.proofGraphRoleUrl,
                    hostedIdentityProofGraphEdges.familyBatchNodeId,
                    hostedIdentityProofGraphEdges.operatorPredicateNodeId,
                    hostedIdentityProofGraphEdges.adminSurfaceNodeId,
                    hostedIdentityProofGraphEdges.operatorProofTarget,
                    hostedIdentityProofGraphEdges.proofBoundary,
                  ]
                    .filter((part) => String(part ?? "") !== "")
                    .join("\n"),
                }),
                ...hostedIdentityProofGraphEdges.edges.map((edge) =>
                  Object.freeze({
                    id: edge.id,
                    status: [
                      edge.from,
                      edge.relationship,
                      edge.to,
                      edge.command,
                      edge.proofTarget,
                    ]
                      .filter((part) => String(part ?? "") !== "")
                      .join("\n"),
                  }),
                ),
              ]),
          Object.freeze({
            id: "selected-next-command",
            status: command,
          }),
          Object.freeze({
            id: "selected-proof-target",
            status: selectedReleaseReadinessCandidate.proofTarget,
          }),
          Object.freeze({
            id: "selected-proof-boundary",
            status: selectedReleaseReadinessCandidate.proofBoundary,
          }),
        ]
      : []),
    ...(selectedOperatorHandoff === null
      ? []
      : [
          Object.freeze({
            id: "selected-operator-handoff",
            status: `${selectedOperatorHandoff.status}:${selectedOperatorHandoff.firstMissingInputId}`,
          }),
          Object.freeze({
            id: "selected-operator-handoff-role-url",
            status: selectedOperatorHandoff.selectedProductionFeatureRoleUrl,
          }),
          Object.freeze({
            id: "selected-operator-handoff-feature-node",
            status: selectedOperatorHandoff.selectedProductionFeatureGraphNodeId,
          }),
        ]),
    ...normalizeLocalNextActionSelectedProofGraphCheckRows({
      selectedProofGraphNode,
      selectedProofGraphNodeStatus,
    }),
    ...normalizeLocalNextActionSelectedSpineCheckRows({
      selectedProductionFeatureSpineTarget,
      selectedSpineTarget,
      selectedSpineDrilldown,
    }),
    ...normalizeLocalNextActionSelectedProductionFeatureGraphCheckRows({
      selectedProductionFeatureGraph,
    }),
    ...(terminalBatchGraph.nodeId === ""
      ? []
      : [
          Object.freeze({
            id: "terminal-proof-batch-graph",
            status: `${terminalBatchGraph.status}:${terminalBatchGraph.edgeCount} edges`,
          }),
        ]),
    ...(nextActionHandoffPair === null
      ? []
      : [
          Object.freeze({
            id: nextActionHandoffPair.id,
            status: `${nextActionHandoffPair.defaultSequenceBlocker.status}:${nextActionHandoffPair.hostedIdentityPredicate.status}`,
          }),
        ]),
    ...(privateChannelRecoveryGraph.nodeId === ""
      ? []
      : [
          Object.freeze({
            id: "private-channel-recovery-graph",
            status: `${privateChannelRecoveryGraph.status}:${privateChannelRecoveryGraph.laneCount} lanes`,
          }),
        ]),
    ...(replacementActionRecoveryGraph.nodeId === ""
      ? []
      : [
          Object.freeze({
            id: "replacement-action-recovery-graph",
            status: `${replacementActionRecoveryGraph.status}:${replacementActionRecoveryGraph.laneCount} lanes`,
          }),
        ]),
    ...(replacementHandoffRecoveryGraph.nodeId === ""
      ? []
      : [
          Object.freeze({
            id: "replacement-handoff-recovery-graph",
            status: `${replacementHandoffRecoveryGraph.status}:${replacementHandoffRecoveryGraph.laneCount} lanes`,
          }),
        ]),
    ...(replacementPrivateRecoveryGraph.nodeId === ""
      ? []
      : [
          Object.freeze({
            id: "replacement-private-recovery-graph",
            status: `${replacementPrivateRecoveryGraph.status}:${replacementPrivateRecoveryGraph.laneCount} lanes`,
          }),
        ]),
    ...(coreLoopRecoveryDestinationCoverage.id === ""
      ? []
      : [
          Object.freeze({
            id: coreLoopRecoveryDestinationCoverage.id,
            status: `${coreLoopRecoveryDestinationCoverage.status}:${coreLoopRecoveryDestinationCoverage.coveredCount}/${coreLoopRecoveryDestinationCoverage.recoveryCount} recoveries`,
          }),
          ...coreLoopRecoveryDestinationCoverage.rows.map((row) =>
            Object.freeze({
              id: row.id,
              status: [
                row.status,
                row.adminRowId,
                row.proofGraphNodeId,
                row.nextActionEdgeRowId,
              ].join("\n"),
            }),
          ),
        ]),
    ...preReadinessTraceCheckRows(
      preReadinessTraceKeys.proofStability,
      stabilityTrace,
    ),
    ...normalizeLocalNextActionSeedProofLaneCoverageCheckRows({
      seedProofLaneCoverage,
    }),
    ...normalizeLocalNextActionProofGraphDestinationSummaryCheckRows({
      proofGraphDestinationSummary,
    }),
    ...(sequenceDeferral === null
      ? []
      : [
          Object.freeze({
            id: "hosted-identity-sequence-deferral",
            status: `${String(sequenceDeferral.currentSequenceStage ?? "unknown")}:${
              String(sequenceDeferral.deferredUnprovenId ?? "unknown")
            }`,
          }),
          Object.freeze({
            id: "hosted-identity-sequence-promotion",
            status: `${String(
              sequenceDeferral.sequenceTransition?.status ??
                sequenceDeferral.status ??
                "unknown",
            )}:${String(sequenceDeferral.nextLocalCommand ?? "")}`,
          }),
        ]),
    ...(localCapabilityConfidence === null
      ? []
      : [
          Object.freeze({
            id: "hosted-identity-local-capability-confidence",
            status: `${String(localCapabilityConfidence.status ?? "unknown")}:${
              Number(localCapabilityConfidence.passedCheckCount ?? 0)
            }/${Number(localCapabilityConfidence.checkCount ?? 0)}`,
          }),
          ...(
            Array.isArray(localCapabilityConfidence.checks)
              ? localCapabilityConfidence.checks
              : []
          ).map((check) =>
            Object.freeze({
              id: `hosted-identity-local-capability-${String(check.id ?? "")}`,
              status: String(check.status ?? "unknown"),
            }),
          ),
        ]),
    ...selectionTraceCheckRows(selectionTrace),
    ...releaseReadinessTraceCheckRows(releaseReadinessTrace),
    ...normalizeLocalNextActionSeedProofLaneCoverageTraceCheckRows({
      seedProofLaneCoverageTrace,
    }),
    ...normalizeLocalNextActionProofGraphDestinationSummaryTraceCheckRows({
      proofGraphDestinationSummaryTrace,
    }),
    ...(generatedSummary.frontendSetupWorkbenchReadiness.id === ""
      ? []
      : [
          Object.freeze({
            id: "frontend-host-setup-workbench",
            status: [
              generatedSummary.frontendSetupWorkbenchReadiness.state,
              generatedSummary.frontendSetupWorkbenchReadiness.localStatus,
              generatedSummary.frontendSetupWorkbenchReadiness.importedStatus,
            ].join(":"),
          }),
        ]),
    ...normalizeLocalNextActionProofGraphDiagnosticSummaryCheckRows({
      proofGraphDiagnosticSummaryTrace,
    }),
    ...normalizeLocalNextActionLocalReadinessDependencyCheckRows({
      localReadinessDependencyTrace,
    }),
    Object.freeze({
      id: "race-coverage-promoted-milestones",
      status: `${raceCoveragePromotedMilestones.passedGroupCount}/${raceCoveragePromotedMilestones.groupCount} groups, ${raceCoveragePromotedMilestones.coveredCellCount}/${raceCoveragePromotedMilestones.requiredCellCount} cells, ${raceCoveragePromotedMilestones.reloadCoveredCellCount}/${raceCoveragePromotedMilestones.cellCount} reloads`,
    }),
    ...recoveryTraceCheckRows(
      recoveryTraceKeys.replacementRaceReload,
      replacementRaceReloadTrace,
    ),
    ...recoveryTraceCheckRows(
      recoveryTraceKeys.hostConcurrentRaceReload,
      hostConcurrentRaceReloadTrace,
    ),
    ...recoveryTraceCheckRows(
      recoveryTraceKeys.playerConcurrentActionReload,
      playerConcurrentActionReloadTrace,
    ),
    ...recoveryTraceCheckRows(
      recoveryTraceKeys.cohostDeadlineRaceReload,
      cohostDeadlineRaceReloadTrace,
    ),
    ...recoveryTraceCheckRows(
      recoveryTraceKeys.staleConflictMessage,
      staleConflictMessageTrace,
    ),
    ...recoveryTraceCheckRows(
      recoveryTraceKeys.hostStaleControl,
      hostStaleControlTrace,
    ),
  ];
  return Object.freeze({
    id: localAdminAuditIds.nextAction,
    label: "Local next action",
    status:
      command === ""
        ? `${actionStatus}: command missing`
        : `${actionStatus}: ${command}`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local next-action receipt",
    boundaryDetail:
      nextAction.proofBoundary ??
      "Local dev-test-game next-action receipt without hosted, release, or production claims.",
    href: localProofArtifactHref({ game, artifact: nextActionPath }),
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
    checks: Object.freeze(checks),
    relatedLinks: normalizeLocalNextActionRelatedLinks({
      game,
      command,
      actionStatus,
      selectedProofGraphNode,
      selectedProductionFeatureGraph,
      unproven,
      unprovenRoleUrl,
      unprovenProofGraphNodeId,
      hostedIdentityProofGraphEdges,
      localCheck,
      localCheckRoleUrl,
      seedProofLaneCoverage,
      seedProofLaneCoverageRoleUrl,
      proofGraphDestinationSummary,
      sequenceDeferral,
      sequenceDeferralRoleUrl,
    }),
    realHostedEvidenceInputs,
    realHostedEvidenceInputRows:
      buildRealHostedEvidenceInputRows(realHostedEvidenceInputs),
    ...(hostedHandoffChecklist === null ? {} : { hostedHandoffChecklist }),
    ...(hostedHandoffChecklist === null
      ? {}
      : {
          hostedHandoffChecklistRows:
            buildHostedHandoffChecklistRows(hostedHandoffChecklist),
          hostedHandoffOperatorRows:
            buildHostedHandoffOperatorRows(hostedHandoffChecklist),
          hostedHandoffProgressionRows: buildHostedHandoffProgressionRows({
            checklist: hostedHandoffChecklist,
            artifactSummary: null,
          }),
          hostedHandoffBlockedReceiptRows: buildHostedHandoffBlockedReceiptRows({
            checklist: hostedHandoffChecklist,
            headings: hostedHandoffReceiptHeadingsForNextActionUnproven(unproven),
          }),
        }),
    ...(selectedOperatorHandoff === null
      ? {}
      : { selectedOperatorHandoff }),
    ...(hostedHandoffChecklist === null
      ? {}
      : {
          hostedHandoffReceiptHeadings:
            hostedHandoffReceiptHeadingsForNextActionUnproven(unproven),
        }),
    ...(hostedIdentityFamilyBatch === null
      ? {}
      : { hostedIdentityFamilyBatch }),
    ...(hostedIdentityProofGraphEdges === null
      ? {}
      : { hostedIdentityProofGraphEdges }),
    localPrerequisites:
      artifact === null || artifactRoleUrl === ""
        ? Object.freeze([])
        : Object.freeze([
            Object.freeze({
              id: String(artifact.id ?? ""),
              label: String(artifact.label ?? artifact.id ?? ""),
              status: String(artifact.status ?? "unknown"),
              evidence: String(artifact.path ?? ""),
              command,
              proofTarget: artifactProofTarget,
              roleUrl: artifactRoleUrl,
              requiredEvidence: String(artifact.requiredEvidence ?? ""),
              proofBoundary: String(artifact.proofBoundary ?? ""),
            }),
          ]),
    artifactSummarySections: buildLocalNextActionSummarySections({
      game,
      nextActionHandoffPair,
      frontendSetupWorkbenchReadiness:
        generatedSummary.frontendSetupWorkbenchReadiness,
      phaseLocalNextActionSnapshots,
    }),
    artifactSummary: Object.freeze({
      command,
      reason,
      actionStatus,
      selectedArtifactId: String(artifact?.id ?? ""),
      selectedArtifactStatus: String(artifact?.status ?? ""),
      selectedArtifactProofTarget: artifactProofTarget,
      selectedArtifactRoleUrl: artifactRoleUrl,
      selectedArtifactRoleHref:
        artifactRoleUrl === ""
          ? ""
          : seededRoleUrlToAdminHref(artifactRoleUrl, { game }),
      selectedArtifactBuildSlice: String(artifact?.buildSlice ?? ""),
      selectedArtifactRequiredEvidence: String(artifact?.requiredEvidence ?? ""),
      sourceManifest: generatedSummary.sourceManifest,
      artifactFreshnessStatus: generatedSummary.artifactFreshnessStatus,
      artifactCount: generatedSummary.artifactCount,
      freshCount: generatedSummary.freshCount,
      staleCount: generatedSummary.staleCount,
      missingCount: generatedSummary.missingCount,
      selectionTrace,
      releaseReadinessChecklist: generatedSummary.releaseReadinessChecklist,
      releaseReadinessStatus: generatedSummary.releaseReadinessStatus,
      frontendReadinessSummary: generatedSummary.frontendReadinessSummary,
      frontendSetupWorkbenchReadiness:
        generatedSummary.frontendSetupWorkbenchReadiness,
      unprovenCount: generatedSummary.unprovenCount,
      buildableUnprovenCount: generatedSummary.buildableUnprovenCount,
      localCheckCount: generatedSummary.localCheckCount,
      buildableLocalDependencyCount:
        generatedSummary.buildableLocalDependencyCount,
      phaseLocalNextActionSnapshotCount:
        phaseLocalNextActionSnapshots.length,
      selectedLocalCheckId: String(localCheck?.id ?? ""),
      selectedLocalCheckBuildSlice: String(localCheck?.buildSlice ?? ""),
      selectedLocalCheckProofTarget: String(localCheck?.proofTarget ?? ""),
      selectedLocalCheckRoleUrl: localCheckRoleUrl,
      selectedLocalCheckRoleHref:
        localCheckRoleUrl === ""
          ? ""
          : seededRoleUrlToAdminHref(localCheckRoleUrl, { game }),
      selectedSeedProofLaneCoverageSource: String(
        seedProofLaneCoverage?.source ?? "",
      ),
      selectedSeedProofLaneCoverageUnclassifiedCount: Number(
        seedProofLaneCoverage?.unclassifiedLaneCount ?? 0,
      ),
      selectedSeedProofLaneCoverageUnclassifiedLaneIds: Object.freeze(
        Array.isArray(seedProofLaneCoverage?.unclassifiedLaneIds)
          ? seedProofLaneCoverage.unclassifiedLaneIds.map((laneId) =>
              String(laneId),
            )
          : [],
      ),
      selectedSeedProofLaneCoverageBuildSlice: String(
        seedProofLaneCoverage?.buildSlice ?? "",
      ),
      selectedSeedProofLaneCoverageProofTarget: String(
        seedProofLaneCoverage?.proofTarget ?? "",
      ),
      selectedSeedProofLaneCoverageRoleUrl: seedProofLaneCoverageRoleUrl,
      selectedSeedProofLaneCoverageRoleHref:
        seedProofLaneCoverageRoleUrl === ""
          ? ""
          : seededRoleUrlToAdminHref(seedProofLaneCoverageRoleUrl, { game }),
      ...(proofGraphDestinationSummary === null
        ? {}
        : {
            selectedProofGraphDestinationSummarySource: String(
              proofGraphDestinationSummary.source ?? "",
            ),
            selectedProofGraphDestinationSummaryStatus: String(
              proofGraphDestinationSummary.summaryStatus ?? "",
            ),
            selectedProofGraphDestinationSummaryTotalDestinationCount: Number(
              proofGraphDestinationSummary.totalDestinationCount ?? 0,
            ),
            selectedProofGraphDestinationSummaryProductionFeatureTargetCount:
              Number(
                proofGraphDestinationSummary.productionFeatureTargetCount ?? 0,
              ),
            selectedProofGraphDestinationSummaryAdminAuditDestinationCount:
              Number(
                proofGraphDestinationSummary.adminAuditDestinationCount ?? 0,
              ),
            selectedProofGraphDestinationSummaryRoleUrlDestinationCount:
              Number(
                proofGraphDestinationSummary.roleUrlDestinationCount ?? 0,
              ),
            selectedProofGraphDestinationSummaryDriftCount: Number(
              proofGraphDestinationSummary.driftCount ?? 0,
            ),
            selectedProofGraphDestinationSummaryCoreLoopRecoveryDestinationRequiredCount:
              Number(
                proofGraphDestinationSummary
                  .coreLoopRecoveryDestinationRequiredCount ?? 0,
              ),
            selectedProofGraphDestinationSummaryCoreLoopRecoveryDestinationCoveredCount:
              Number(
                proofGraphDestinationSummary
                  .coreLoopRecoveryDestinationCoveredCount ?? 0,
              ),
            selectedProofGraphDestinationSummaryCoreLoopRecoveryDestinationMissingCount:
              Number(
                proofGraphDestinationSummary
                  .coreLoopRecoveryDestinationMissingCount ?? 0,
              ),
            selectedProofGraphDestinationSummaryCoreLoopRecoveryDestinationMissingIds:
              Object.freeze(
                Array.isArray(
                  proofGraphDestinationSummary
                    .coreLoopRecoveryDestinationMissingIds,
                )
                  ? proofGraphDestinationSummary.coreLoopRecoveryDestinationMissingIds.map(
                      (id) => String(id),
                    )
                  : [],
              ),
            selectedProofGraphDestinationSummaryBuildSlice: String(
              proofGraphDestinationSummary.buildSlice ?? "",
            ),
            selectedProofGraphDestinationSummaryProofTarget: String(
              proofGraphDestinationSummary.proofTarget ?? "",
            ),
          }),
      proofGraphDiagnosticSummaryStatus: proofGraphDiagnosticSummaryTrace.status,
      proofGraphDiagnosticCount:
        proofGraphDiagnosticSummaryTrace.diagnosticCount,
      proofGraphDiagnosticPromotesFreshnessCount:
        proofGraphDiagnosticSummaryTrace.promotesFreshnessCount,
      proofGraphDiagnosticTerminalArtifactCount:
        proofGraphDiagnosticSummaryTrace.terminalArtifactCount,
      ...(sequenceDeferral === null
        ? {}
        : {
            sequenceDeferralStatus: String(sequenceDeferral.status ?? ""),
            sequenceDeferralStage: String(
              sequenceDeferral.currentSequenceStage ?? "",
            ),
            sequenceRequiredStage: String(
              sequenceDeferral.requiredSequenceStage ?? "",
            ),
            sequenceDeferredUnprovenId: String(
              sequenceDeferral.deferredUnprovenId ?? "",
            ),
            sequenceDeferredCommand: String(
              sequenceDeferral.deferredCommand ?? "",
            ),
            sequenceDeferredProofTarget: String(
              sequenceDeferral.deferredProofTarget ?? "",
            ),
            sequenceDeferredRoleUrl: sequenceDeferralRoleUrl,
            sequenceDeferredRoleHref:
              sequenceDeferralRoleUrl === ""
                ? ""
                : seededRoleUrlToAdminHref(sequenceDeferralRoleUrl, { game }),
            sequenceNextLocalCommand: String(
              sequenceDeferral.nextLocalCommand ?? "",
            ),
            sequenceNextLocalProofTarget: String(
              sequenceDeferral.nextLocalProofTarget ?? "",
            ),
            sequenceBuildSlice: String(sequenceDeferral.buildSlice ?? ""),
            sequenceRequiredBeforeHostedIdentity: String(
              sequenceDeferral.requiredBeforeHostedIdentity ?? "",
            ),
            sequenceProofBoundary: String(sequenceDeferral.proofBoundary ?? ""),
            sequenceTransitionStatus: String(
              sequenceDeferral.sequenceTransition?.status ?? "",
            ),
            sequenceTransitionPromotionCommand: String(
              sequenceDeferral.sequenceTransition?.promotionCommand ?? "",
            ),
            sequenceTransitionPromotedStage: String(
              sequenceDeferral.sequenceTransition?.promotedSequenceStage ?? "",
            ),
            sequenceLocalCapabilityConfidenceStatus: String(
              localCapabilityConfidence?.status ?? "",
            ),
            sequenceLocalCapabilityConfidenceSource: String(
              localCapabilityConfidence?.source ?? "",
            ),
            sequenceLocalCapabilityConfidencePassedCheckCount: Number(
              localCapabilityConfidence?.passedCheckCount ?? 0,
            ),
            sequenceLocalCapabilityConfidenceCheckCount: Number(
              localCapabilityConfidence?.checkCount ?? 0,
            ),
            sequenceLocalCapabilityConfidenceRequiredCheckIds: Object.freeze(
              Array.isArray(localCapabilityConfidence?.requiredCheckIds)
                ? localCapabilityConfidence.requiredCheckIds.map((id) =>
                    String(id),
                  )
                : [],
            ),
            sequenceLocalCapabilityConfidenceChecks: Object.freeze(
              Array.isArray(localCapabilityConfidence?.checks)
                ? localCapabilityConfidence.checks.map((check) =>
                    Object.freeze({
                      id: String(check.id ?? ""),
                      label: String(check.label ?? ""),
                      status: String(check.status ?? ""),
                      evidence: String(check.evidence ?? ""),
                      roleUrl: String(check.roleUrl ?? ""),
                      proofBoundary: String(check.proofBoundary ?? ""),
                    }),
                  )
                : [],
            ),
            sequenceLocalCapabilityConfidenceProofBoundary: String(
              localCapabilityConfidence?.proofBoundary ?? "",
            ),
          }),
      selectedUnprovenId: String(unproven?.id ?? ""),
      selectedBuildSlice: String(unproven?.buildSlice ?? ""),
      selectedProofTarget: String(unproven?.proofTarget ?? ""),
      selectedProofBoundary: String(
        selectedReleaseReadinessCandidate?.proofBoundary ?? "",
      ),
      selectedHostedEvidenceMode: String(unproven?.hostedEvidenceMode ?? ""),
      selectedRealHostedEvidenceStatus: String(
        unproven?.realHostedEvidenceStatus ?? "",
      ),
      selectedRealHostedEvidenceCommand: String(
        unproven?.realHostedEvidenceInputs?.command ?? "",
      ),
      selectedRealHostedEvidenceProofTarget: String(
        unproven?.realHostedEvidenceInputs?.proofTarget ?? "",
      ),
      selectedProductionFeatureSpineTarget,
      selectedSpineDrilldown,
      selectedSpineTarget,
      selectedRoleUrl: unprovenRoleUrl,
      selectedRoleHref:
        unprovenRoleUrl === ""
          ? ""
          : seededRoleUrlToAdminHref(unprovenRoleUrl, { game }),
      selectedProofGraphNodeId: unprovenProofGraphNodeId,
      selectedProofGraphNodeStatus: String(
        selectedProofGraphNode?.status ?? "",
      ),
      selectedProofGraphNodeProofCommand: String(
        selectedProofGraphNode?.proofCommand ?? "",
      ),
      selectedProofGraphNodeRoleUrl: String(selectedProofGraphNode?.roleUrl ?? ""),
      selectedProofGraphNodeAuditId: String(selectedProofGraphNode?.auditId ?? ""),
      selectedProofGraphNodeHref:
        selectedProofGraphNode === null
          ? ""
          : adminAuditInspectHref({ game, audit: localAdminAuditIds.proofGraph }),
      ...(selectedOperatorHandoff === null
        ? {}
        : {
            selectedOperatorHandoffId: selectedOperatorHandoff.id,
            selectedOperatorHandoffStatus: selectedOperatorHandoff.status,
            selectedOperatorHandoffFirstMissingInputId:
              selectedOperatorHandoff.firstMissingInputId,
            selectedOperatorHandoffRoleUrl:
              selectedOperatorHandoff.selectedProductionFeatureRoleUrl,
            selectedOperatorHandoffRoleHref: seededRoleUrlToAdminHref(
              selectedOperatorHandoff.selectedProductionFeatureRoleUrl,
              { game },
            ),
            selectedOperatorHandoffProductionFeatureGraphNodeId:
              selectedOperatorHandoff.selectedProductionFeatureGraphNodeId,
          }),
      ...(terminalBatchGraph.nodeId === ""
        ? {}
        : { terminalProofBatchGraph: terminalBatchGraph }),
      ...(nextActionHandoffPair === null
        ? {}
        : { nextActionHandoffPair }),
      ...(privateChannelRecoveryGraph.nodeId === ""
        ? {}
        : { privateChannelRecoveryGraph }),
      ...(replacementActionRecoveryGraph.nodeId === ""
        ? {}
        : { replacementActionRecoveryGraph }),
      ...(replacementHandoffRecoveryGraph.nodeId === ""
        ? {}
        : { replacementHandoffRecoveryGraph }),
      ...(replacementPrivateRecoveryGraph.nodeId === ""
        ? {}
        : { replacementPrivateRecoveryGraph }),
      ...(coreLoopRecoveryDestinationCoverage.id === ""
        ? {}
        : { coreLoopRecoveryDestinationCoverage }),
      stabilitySource: String(stability?.source ?? ""),
      stabilityBuildSlice: String(stability?.buildSlice ?? ""),
      stabilityProofTarget: String(stability?.proofTarget ?? ""),
      stabilityTrace,
      seedProofLaneCoverageTrace,
      proofGraphDiagnosticSummaryTrace,
      ...(proofGraphDestinationSummaryTrace.status === "drifted"
        ? { proofGraphDestinationSummaryTrace }
        : {}),
      localReadinessDependencyTrace,
      releaseReadinessTrace,
      replacementRaceReloadTrace,
      hostConcurrentRaceReloadTrace,
      playerConcurrentActionReloadTrace,
      cohostDeadlineRaceReloadTrace,
      raceCoveragePromotedMilestones,
      staleConflictMessageTrace,
      hostStaleControlTrace,
      releaseReady: nextAction.releaseReady === true,
      productionReady: nextAction.productionReady === true,
    }),
  });
}

function normalizeNextActionHostedIdentityFamilyBatch(batch) {
  if (batch === null || typeof batch !== "object") {
    return null;
  }
  return Object.freeze({
    id: String(batch.id ?? ""),
    status: String(batch.status ?? "unknown"),
    command: String(batch.command ?? ""),
    firstPendingProgressionId:
      batch.firstPendingProgressionId === null
        ? null
        : String(batch.firstPendingProgressionId ?? ""),
    proofTargets: Object.freeze(
      (Array.isArray(batch.proofTargets) ? batch.proofTargets : []).map(
        (target) => String(target ?? ""),
      ),
    ),
    proofBoundary: String(batch.proofBoundary ?? ""),
  });
}

function normalizeNextActionHostedIdentityProofGraphEdges(dependency) {
  if (dependency === null || typeof dependency !== "object") {
    return null;
  }
  return Object.freeze({
    id: String(dependency.id ?? ""),
    status: String(dependency.status ?? "unknown"),
    proofGraphRoleUrl: String(dependency.proofGraphRoleUrl ?? ""),
    familyBatchNodeId: String(dependency.familyBatchNodeId ?? ""),
    operatorPredicateNodeId: String(dependency.operatorPredicateNodeId ?? ""),
    adminSurfaceNodeId: String(dependency.adminSurfaceNodeId ?? ""),
    familyProofTargets: Object.freeze(
      (Array.isArray(dependency.familyProofTargets)
        ? dependency.familyProofTargets
        : []
      ).map((target) => String(target ?? "")),
    ),
    operatorProofTarget: String(dependency.operatorProofTarget ?? ""),
    edges: Object.freeze(
      (Array.isArray(dependency.edges) ? dependency.edges : []).map((edge) =>
        Object.freeze({
          id: String(edge?.id ?? ""),
          from: String(edge?.from ?? ""),
          to: String(edge?.to ?? ""),
          relationship: String(edge?.relationship ?? ""),
          command: String(edge?.command ?? ""),
          proofTarget: String(edge?.proofTarget ?? ""),
        }),
      ),
    ),
    proofBoundary: String(dependency.proofBoundary ?? ""),
  });
}

export function normalizeLocalNextActionRelatedLinks({
  game,
  command = "",
  actionStatus = "unknown",
  selectedProofGraphNode = null,
  selectedProductionFeatureGraph = null,
  unproven = null,
  unprovenRoleUrl = "",
  unprovenProofGraphNodeId = "",
  hostedIdentityProofGraphEdges = null,
  localCheck = null,
  localCheckRoleUrl = "",
  seedProofLaneCoverage = null,
  seedProofLaneCoverageRoleUrl = "",
  proofGraphDestinationSummary = null,
  sequenceDeferral = null,
  sequenceDeferralRoleUrl = "",
} = {}) {
  if (
    unprovenRoleUrl === "" &&
    localCheckRoleUrl === "" &&
    seedProofLaneCoverageRoleUrl === "" &&
    proofGraphDestinationSummary === null &&
    sequenceDeferralRoleUrl === "" &&
    selectedProofGraphNode === null &&
    hostedIdentityProofGraphEdges === null &&
    String(selectedProductionFeatureGraph?.nodeId ?? "") === ""
  ) {
    return Object.freeze([]);
  }
  return Object.freeze([
    ...(selectedProofGraphNode === null
      ? []
      : [
          Object.freeze({
            ...selectedProofGraphNodeRelatedLinkDescriptor(
              selectedProofGraphNode,
            ),
            href: adminAuditInspectHref({
              game,
              audit: localAdminAuditIds.proofGraph,
            }),
          }),
        ]),
    ...selectedProofGraphDependencyRelatedLinks({
      game,
      command,
      actionStatus,
      selectedProofGraphNode,
      hostedIdentityProofGraphEdges,
      unprovenProofGraphNodeId,
      unproven,
      unprovenRoleUrl,
    }),
    ...(String(selectedProductionFeatureGraph?.nodeId ?? "") === ""
      ? []
      : [
          Object.freeze({
            ...selectedProductionFeatureGraphRelatedLinkDescriptor(
              selectedProductionFeatureGraph,
            ),
            href: adminAuditInspectHref({
              game,
              audit: localAdminAuditIds.proofGraph,
            }),
          }),
        ]),
    ...nextActionRelatedLinkDescriptors({
      command,
      actionStatus,
      unproven,
      unprovenRoleUrl,
      unprovenProofGraphNodeId,
      localCheck,
      localCheckRoleUrl,
      seedProofLaneCoverage,
      seedProofLaneCoverageRoleUrl,
      proofGraphDestinationSummary,
      sequenceDeferral,
      sequenceDeferralRoleUrl,
    }).map((descriptor) =>
      Object.freeze({
        id: descriptor.id,
        label: descriptor.label,
        href: nextActionRelatedLinkHref({
          descriptor,
          game,
        }),
        status: descriptor.status,
        command: descriptor.command,
      }),
    ),
  ]);
}

function nextActionRelatedLinkHref({ descriptor, game }) {
  if (descriptor.hrefKind === nextActionRelatedLinkHrefKinds.proofGraphAudit) {
    return adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.proofGraph,
    });
  }
  return seededRoleUrlToAdminHref(descriptor.roleUrl, { game });
}

function selectedProofGraphDependencyRelatedLinks({
  game,
  command,
  actionStatus,
  selectedProofGraphNode,
  hostedIdentityProofGraphEdges,
  unprovenProofGraphNodeId,
  unproven,
  unprovenRoleUrl,
}) {
  const selectedNodeId = String(
    selectedProofGraphNode?.id ?? unprovenProofGraphNodeId ?? "",
  );
  return selectedProofGraphDependencyDefinitions({
    command,
    actionStatus,
    hostedIdentityProofGraphEdges,
    unproven,
  })
    .filter((definition) =>
      selectedProofGraphDependencyApplies({
        definition,
        selectedNodeId,
        unproven,
        unprovenRoleUrl,
      }),
    )
    .flatMap((definition) =>
      definition.edges.map((edge) => {
        const descriptor = selectedProofGraphDependencyEdgeRelatedLinkDescriptor({
          definition,
          edge,
        });
        return Object.freeze({
          ...descriptor,
          href: adminAuditInspectHref({
            game,
            audit: localAdminAuditIds.proofGraph,
          }),
        });
      }),
    );
}

export function normalizeLocalNextActionSelectedProofGraphCheckRows({
  selectedProofGraphNode = null,
  selectedProofGraphNodeStatus = "",
} = {}) {
  return selectedProofGraphNodeCheckRows({
    selectedProofGraphNode,
    selectedProofGraphNodeStatus,
  });
}

export function normalizeLocalNextActionSelectedSpineCheckRows({
  selectedProductionFeatureSpineTarget = null,
  selectedSpineTarget = null,
  selectedSpineDrilldown = null,
} = {}) {
  return String(selectedSpineTarget?.checkpointId ?? "") === ""
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: "selected-feature-spine-declaration",
          status: selectedSpineDeclarationStatus(
            selectedProductionFeatureSpineTarget,
          ),
        }),
        Object.freeze({
          id: "selected-spine-target",
          status: selectedSpineTargetStatus(selectedSpineTarget),
        }),
        Object.freeze({
          id: "selected-spine-drilldown",
          status: selectedSpineDrilldownStatus(selectedSpineDrilldown),
        }),
        Object.freeze({
          id: "selected-spine-admin-check",
          status: String(selectedSpineDrilldown?.adminCheckId ?? ""),
        }),
        Object.freeze({
          id: "selected-spine-rerun-command",
          status: String(selectedSpineDrilldown?.rerunCommand ?? ""),
        }),
        Object.freeze({
          id: "selected-spine-browser-proof",
          status: String(selectedSpineTarget?.browserProofCommand ?? ""),
        }),
        Object.freeze({
          id: "selected-spine-source-artifact",
          status: String(
            selectedSpineTarget?.sourceProofArtifact ??
              selectedSpineDrilldown?.sourceProofArtifact ??
              "",
          ),
        }),
        ...coverageDecisionCheckRows({
          parentId: "selected-spine",
          rowId: "selected-spine-coverage-decision",
          coverageDecision: selectedSpineTarget?.coverageDecision,
        }),
      ]);
}

export function normalizeLocalNextActionSelectedProductionFeatureGraphCheckRows({
  selectedProductionFeatureGraph = null,
} = {}) {
  return selectedProductionFeatureGraphCheckRows({
    selectedProductionFeatureGraph,
  });
}

function normalizeBrowserWorkbench(browserWorkbench) {
  if (browserWorkbench === null || typeof browserWorkbench !== "object") {
    return null;
  }
  return Object.freeze({
    status: String(browserWorkbench.status ?? ""),
    route: String(browserWorkbench.route ?? ""),
    roleUrl: String(browserWorkbench.roleUrl ?? ""),
    roleSurface: String(browserWorkbench.roleSurface ?? ""),
    featureSlotId: String(browserWorkbench.featureSlotId ?? ""),
    requiredEvidence: String(browserWorkbench.requiredEvidence ?? ""),
  });
}

export function normalizeLocalNextActionSeedProofLaneCoverageCheckRows({
  seedProofLaneCoverage = null,
} = {}) {
  return seedProofLaneCoverage === null
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: "seed-proof-lane-coverage",
          status: `${Number(
            seedProofLaneCoverage.unclassifiedLaneCount ?? 0,
          )} unclassified lanes`,
        }),
      ]);
}

export function normalizeLocalNextActionProofGraphDestinationSummaryCheckRows({
  proofGraphDestinationSummary = null,
} = {}) {
  return proofGraphDestinationSummary === null
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: "proof-graph-destination-summary",
          status: `${Number(
            proofGraphDestinationSummary.totalDestinationCount ?? 0,
          )}/${Number(
            proofGraphDestinationSummary.productionFeatureTargetCount ?? 0,
          )} destinations`,
        }),
        Object.freeze({
          id: "proof-graph-destination-summary-drift-count",
          status: `${Number(proofGraphDestinationSummary.driftCount ?? 0)} drift`,
        }),
        Object.freeze({
          id: "proof-graph-destination-summary-core-loop-recovery-coverage",
          status: `${Number(
            proofGraphDestinationSummary
              .coreLoopRecoveryDestinationCoveredCount ?? 0,
          )}/${Number(
            proofGraphDestinationSummary
              .coreLoopRecoveryDestinationRequiredCount ?? 0,
          )} recoveries`,
        }),
      ]);
}

export function normalizeLocalNextActionSeedProofLaneCoverageTraceCheckRows({
  seedProofLaneCoverageTrace = null,
} = {}) {
  return preReadinessTraceCheckRows(
    preReadinessTraceKeys.seedProofLaneCoverage,
    seedProofLaneCoverageTrace,
  );
}

export function normalizeLocalNextActionProofGraphDestinationSummaryTraceCheckRows({
  proofGraphDestinationSummaryTrace = null,
} = {}) {
  return preReadinessTraceCheckRows(
    preReadinessTraceKeys.proofGraphDestinationSummary,
    proofGraphDestinationSummaryTrace,
  );
}

export function normalizeLocalNextActionProofGraphDiagnosticSummaryCheckRows({
  proofGraphDiagnosticSummaryTrace = null,
} = {}) {
  return proofGraphDiagnosticSummaryCheckRows(proofGraphDiagnosticSummaryTrace);
}

export function normalizeLocalNextActionLocalReadinessDependencyCheckRows({
  localReadinessDependencyTrace = null,
} = {}) {
  return preReadinessTraceCheckRows(
    preReadinessTraceKeys.localReadinessDependency,
    localReadinessDependencyTrace,
  );
}

function normalizeLocalNextActionLocalReadinessDependencyTrace(
  localReadinessDependencyTrace,
) {
  const normalized = normalizeLocalReadinessDependencyTrace(
    localReadinessDependencyTrace,
  );
  return Object.freeze({
    strategy: normalized.strategy,
    candidateCount: normalized.candidateCount,
    selectedCheckId: normalized.selectedCheckId,
    candidates: normalized.candidates,
  });
}

function normalizeLocalNextActionPhaseLocalSnapshots(proofGraph) {
  const nodes = Array.isArray(proofGraph?.nodes) ? proofGraph.nodes : [];
  const edges = Array.isArray(proofGraph?.edges) ? proofGraph.edges : [];
  return Object.freeze(
    nodes
      .filter((node) => node?.kind === "phase-local-next-action")
      .map((node) => {
        const nextActionEdge = phaseLocalNextActionEdge({
          edges,
          node,
          from: "next-action",
          relationship: "phase-local-snapshot",
        });
        const manifestEdge = phaseLocalNextActionEdge({
          edges,
          node,
          from: "spine-manifest",
          relationship: "records-phase-local-next-action",
        });
        return Object.freeze({
          id: String(node.id ?? ""),
          label: String(node.label ?? node.id ?? ""),
          status: String(node.status ?? "recorded"),
          artifact: String(node.artifact ?? ""),
          canonicalArtifact: String(node.canonicalArtifact ?? ""),
          phaseLocalNextActionId: String(node.phaseLocalNextActionId ?? ""),
          sequenceStage: String(node.sequenceStage ?? ""),
          proofCommand: String(node.proofCommand ?? ""),
          proofBoundary: String(node.proofBoundary ?? ""),
          nextActionEdgeRowId:
            nextActionEdge === null ? "" : proofGraphEdgeCheckId(nextActionEdge),
          manifestEdgeRowId:
            manifestEdge === null ? "" : proofGraphEdgeCheckId(manifestEdge),
        });
      }),
  );
}

function phaseLocalNextActionEdge({ edges, node, from, relationship }) {
  return (
    edges.find(
      (edge) =>
        edge.from === from &&
        edge.to === node.id &&
        edge.relationship === relationship &&
        edge.phaseLocalNextActionId === node.phaseLocalNextActionId,
    ) ?? null
  );
}

export function normalizeLocalNextActionGeneratedSummary(nextAction) {
  const freshnessSummary =
    nextAction?.generatedFrom?.artifactFreshnessSummary ?? {};
  const releaseReadinessSummary =
    nextAction?.generatedFrom?.releaseReadinessSummary ?? {};
  return Object.freeze({
    sourceManifest: String(nextAction?.generatedFrom?.spineManifest ?? ""),
    artifactFreshnessStatus: String(
      nextAction?.generatedFrom?.artifactFreshnessStatus ?? "unknown",
    ),
    artifactCount: Number(freshnessSummary.artifactCount ?? 0),
    freshCount: Number(freshnessSummary.freshCount ?? 0),
    staleCount: Number(freshnessSummary.staleCount ?? 0),
    missingCount: Number(freshnessSummary.missingCount ?? 0),
    releaseReadinessChecklist: String(
      nextAction?.generatedFrom?.releaseReadinessChecklist ?? "",
    ),
    releaseReadinessStatus: String(releaseReadinessSummary.status ?? "unknown"),
    frontendReadinessSummary: String(
      nextAction?.generatedFrom?.frontendReadinessSummary ?? "",
    ),
    frontendSetupWorkbenchReadiness:
      normalizeFrontendSetupWorkbenchReadiness(
        nextAction?.generatedFrom?.frontendSetupWorkbenchReadiness,
      ),
    unprovenCount: Number(releaseReadinessSummary.unprovenCount ?? 0),
    buildableUnprovenCount: Number(
      releaseReadinessSummary.buildableUnprovenCount ?? 0,
    ),
    localCheckCount: Number(releaseReadinessSummary.localCheckCount ?? 0),
    buildableLocalDependencyCount: Number(
      releaseReadinessSummary.buildableLocalDependencyCount ?? 0,
    ),
  });
}

function normalizeFrontendSetupWorkbenchReadiness(workbench) {
  if (workbench === null || typeof workbench !== "object") {
    return Object.freeze({
      id: "",
      label: "",
      state: "",
      route: "",
      localStatus: "",
      importedStatus: "",
      localViewportLayouts: Object.freeze([]),
      localScreenshotCount: 0,
      importedSetupCount: 0,
      importedScreenshotCheckCount: 0,
      proofBoundary: "",
    });
  }
  return Object.freeze({
    id: String(workbench.id ?? ""),
    label: String(workbench.label ?? ""),
    state: String(workbench.state ?? ""),
    route: String(workbench.route ?? ""),
    localStatus: String(workbench.localStatus ?? ""),
    importedStatus: String(workbench.importedStatus ?? ""),
    localViewportLayouts: Object.freeze(
      Array.isArray(workbench.localViewportLayouts)
        ? workbench.localViewportLayouts.map((entry) =>
            Object.freeze({
              viewport: String(entry.viewport ?? ""),
              layout: String(entry.layout ?? ""),
              slotCount: Number(entry.slotCount ?? 0),
              noHorizontalOverflow: entry.noHorizontalOverflow === true,
              screenshot: String(entry.screenshot ?? ""),
            }),
          )
        : [],
    ),
    localScreenshotCount: Number(workbench.localScreenshotCount ?? 0),
    importedSetupCount: Number(workbench.importedSetupCount ?? 0),
    importedScreenshotCheckCount: Number(
      workbench.importedScreenshotCheckCount ?? 0,
    ),
    proofBoundary: String(workbench.proofBoundary ?? ""),
  });
}

function normalizeNextActionTerminalBatchGraph(terminalBatchGraph) {
  if (terminalBatchGraph === null || typeof terminalBatchGraph !== "object") {
    return Object.freeze({
      nodeId: "",
      status: "",
      proofTarget: "",
      roleUrl: "",
      batchCount: 0,
      edgeCount: 0,
      edgeTargets: Object.freeze([]),
      receiptArtifacts: Object.freeze([]),
    });
  }
  return Object.freeze({
    nodeId: String(terminalBatchGraph.nodeId ?? ""),
    status: String(terminalBatchGraph.status ?? ""),
    proofTarget: String(terminalBatchGraph.proofTarget ?? ""),
    roleUrl: String(terminalBatchGraph.roleUrl ?? ""),
    batchCount: Number(terminalBatchGraph.batchCount ?? 0),
    edgeCount: Number(terminalBatchGraph.edgeCount ?? 0),
    edgeTargets: Object.freeze(
      Array.isArray(terminalBatchGraph.edgeTargets)
        ? terminalBatchGraph.edgeTargets.map((target) => String(target))
        : [],
    ),
    receiptArtifacts: Object.freeze(
      Array.isArray(terminalBatchGraph.receiptArtifacts)
        ? terminalBatchGraph.receiptArtifacts.map((artifact) =>
            Object.freeze({
              proofId: String(artifact?.proofId ?? ""),
              artifactPath: String(artifact?.artifactPath ?? ""),
              batchLabel: String(artifact?.batchLabel ?? ""),
            }),
          )
        : [],
    ),
  });
}

function normalizeNextActionRecoveryReceiptGraph(recoveryReceiptGraph) {
  if (
    recoveryReceiptGraph === null ||
    typeof recoveryReceiptGraph !== "object"
  ) {
    return Object.freeze({
      nodeId: "",
      status: "",
      proofTarget: "",
      roleUrl: "",
      familyId: "",
      laneCount: 0,
      laneIds: Object.freeze([]),
      edgeCount: 0,
      edgeTargets: Object.freeze([]),
    });
  }
  const normalizedEvidenceObjects = normalizeNormalizedEvidenceObjects(
    recoveryReceiptGraph.normalizedEvidenceObjects,
  );
  return Object.freeze({
    nodeId: String(recoveryReceiptGraph.nodeId ?? ""),
    status: String(recoveryReceiptGraph.status ?? ""),
    proofTarget: String(recoveryReceiptGraph.proofTarget ?? ""),
    roleUrl: String(recoveryReceiptGraph.roleUrl ?? ""),
    familyId: String(recoveryReceiptGraph.familyId ?? ""),
    laneCount: Number(recoveryReceiptGraph.laneCount ?? 0),
    laneIds: Object.freeze(
      Array.isArray(recoveryReceiptGraph.laneIds)
        ? recoveryReceiptGraph.laneIds.map((laneId) => String(laneId))
        : [],
    ),
    edgeCount: Number(recoveryReceiptGraph.edgeCount ?? 0),
    edgeTargets: Object.freeze(
      Array.isArray(recoveryReceiptGraph.edgeTargets)
        ? recoveryReceiptGraph.edgeTargets.map((target) =>
            String(target),
          )
        : [],
    ),
    ...(normalizedEvidenceObjects.length === 0
      ? {}
      : { normalizedEvidenceObjects }),
  });
}

function normalizeNextActionCoreLoopRecoveryDestinationCoverage(coverage) {
  if (coverage === null || typeof coverage !== "object") {
    return Object.freeze({
      id: "",
      status: "",
      source: "",
      recoveryCount: 0,
      coveredCount: 0,
      proofBoundary: "",
      rows: Object.freeze([]),
    });
  }
  return Object.freeze({
    id: String(coverage.id ?? ""),
    status: String(coverage.status ?? "unknown"),
    source: String(coverage.source ?? ""),
    recoveryCount: Number(coverage.recoveryCount ?? 0),
    coveredCount: Number(coverage.coveredCount ?? 0),
    proofBoundary: String(coverage.proofBoundary ?? ""),
    rows: Object.freeze(
      Array.isArray(coverage.rows)
        ? coverage.rows.map((row) =>
            Object.freeze({
              id: `core-loop-recovery-destination:${String(row?.id ?? "")}`,
              recoveryCaseId: String(row?.id ?? ""),
              label: String(row?.label ?? ""),
              status: String(row?.status ?? "unknown"),
              group: String(row?.group ?? ""),
              adminRowId: String(row?.adminRowId ?? ""),
              proofGraphNodeId: String(row?.proofGraphNodeId ?? ""),
              nextActionEdgeRowId: String(row?.nextActionEdgeRowId ?? ""),
              roleUrl: String(row?.roleUrl ?? ""),
              proofTarget: String(row?.proofTarget ?? ""),
              command: String(row?.command ?? ""),
            }),
          )
        : [],
    ),
  });
}

function normalizeNextActionHostedHandoffChecklist({
  unproven,
  realHostedEvidenceInputs,
  blockedReceipt = undefined,
}) {
  const checklist = unproven?.hostedHandoffChecklist;
  if (checklist === null || typeof checklist !== "object") {
    return null;
  }
  const blockedChecks = Array.isArray(checklist.blockedChecks)
    ? checklist.blockedChecks
    : [];
  const checklistInputs =
    realHostedEvidenceInputs.length > 0
      ? realHostedEvidenceInputs
      : Array.isArray(checklist.inputIds)
        ? checklist.inputIds.map((id) =>
            Object.freeze({
              id: String(id ?? ""),
              label: String(id ?? ""),
              value: "required",
              required: true,
            }),
          )
        : [];
  return Object.freeze({
    status: String(checklist.status ?? "unknown"),
    preflightStatus: String(checklist.preflightStatus ?? "unknown"),
    command: String(checklist.command ?? ""),
    proofTarget: String(checklist.proofTarget ?? ""),
    inputCount: checklistInputs.length,
    blockedCheckCount: blockedChecks.length,
    inputs: Object.freeze(
      checklistInputs.map((input) =>
        Object.freeze({
          id: input.id,
          label: input.label,
          value:
            input.id === "FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH"
              ? String(checklist.placeholderFixturePath ?? input.value)
              : input.value,
          required: input.required,
        }),
      ),
    ),
    blockedChecks: Object.freeze(
      blockedChecks.map((check) =>
        Object.freeze({
          id: String(check.id ?? ""),
          status: String(check.status ?? "unknown"),
          requiredEvidence: String(check.requiredEvidence ?? ""),
        }),
      ),
    ),
    blockedReceipt: normalizeHostedHandoffBlockedReceipt(
      blockedReceipt ?? checklist.blockedReceipt,
    ),
    groups: normalizeHostedHandoffGroups(checklist.requirementGroups),
    inputSections: normalizeHostedHandoffInputSections(checklist.inputSections),
    operatorEvidenceGate: normalizeHostedIdentityOperatorEvidenceGate(
      checklist.operatorEvidenceGate,
    ),
    operatorProofDrilldowns: normalizeHostedHandoffOperatorProofDrilldowns(
      checklist.operatorProofDrilldowns,
    ),
    progressionSummary: normalizeHostedHandoffProgressionSummary(
      checklist.progressionSummary,
    ),
  });
}

function normalizeHostedIdentityOperatorEvidenceGate(gate) {
  if (gate === null || typeof gate !== "object") {
    return null;
  }
  const families = Array.isArray(gate.requiredEvidenceFamilies)
    ? gate.requiredEvidenceFamilies
    : [];
  return Object.freeze({
    id: String(gate.id ?? ""),
    status: String(gate.status ?? "unknown"),
    evidencePathEnv: String(gate.evidencePathEnv ?? ""),
    requiredRawEvidencePathKind: String(gate.requiredRawEvidencePathKind ?? ""),
    rejectedRawEvidencePathKinds: Object.freeze(
      (Array.isArray(gate.rejectedRawEvidencePathKinds)
        ? gate.rejectedRawEvidencePathKinds
        : []
      ).map((kind) => String(kind)),
    ),
    command: String(gate.command ?? ""),
    proofTarget: String(gate.proofTarget ?? ""),
    roleUrl: String(gate.roleUrl ?? ""),
    localCapabilityAuditId: String(gate.localCapabilityAuditId ?? ""),
    localCapabilityRoleUrl: String(gate.localCapabilityRoleUrl ?? ""),
    requiredEvidenceFamilies: Object.freeze(
      families.map((family) =>
        Object.freeze({
          id: String(family?.id ?? ""),
          field: String(family?.field ?? ""),
          checkId: String(family?.checkId ?? ""),
          requiredInputIds: Object.freeze(
            (Array.isArray(family?.requiredInputIds)
              ? family.requiredInputIds
              : []
            ).map((inputId) => String(inputId)),
          ),
        }),
      ),
    ),
    providerBoundary: normalizeHostedIdentityProviderBoundary(
      gate.providerBoundary,
    ),
    proofBoundary: String(gate.proofBoundary ?? ""),
  });
}

function normalizeHostedIdentityProviderBoundary(boundary) {
  if (
    boundary === null ||
    typeof boundary !== "object" ||
    boundary.version !== 1 ||
    !Array.isArray(boundary.providers)
  ) {
    return null;
  }
  return Object.freeze({
    id: String(boundary.id ?? ""),
    status: String(boundary.status ?? "unknown"),
    architectureId: String(boundary.architectureId ?? ""),
    roleSurfaceArchitectureChanged:
      boundary.roleSurfaceArchitectureChanged === true,
    providerCount: boundary.providers.length,
    proofBoundary: String(boundary.proofBoundary ?? ""),
    providers: Object.freeze(
      boundary.providers.map((provider) =>
        Object.freeze({
          id: String(provider?.id ?? ""),
          label: String(provider?.label ?? ""),
          mode: String(provider?.mode ?? ""),
          status: String(provider?.status ?? "unknown"),
          accountCredential: String(provider?.accountCredential ?? ""),
          inviteCredential: String(provider?.inviteCredential ?? ""),
          sessionCredential: String(provider?.sessionCredential ?? ""),
          loginBoundary: String(provider?.loginBoundary ?? ""),
          sessionBoundary: String(provider?.sessionBoundary ?? ""),
          sessionGrantBoundary: String(provider?.sessionGrantBoundary ?? ""),
          browserCookieName: String(provider?.browserCookieName ?? ""),
          rawCredentialPolicy: String(provider?.rawCredentialPolicy ?? ""),
          roleSurfaceArchitectureChanged:
            provider?.roleSurfaceArchitectureChanged === true,
          requiredEvidence: String(provider?.requiredEvidence ?? ""),
        }),
      ),
    ),
  });
}

function normalizeHostedHandoffProgressionSummary(summary) {
  if (summary === null || typeof summary !== "object") {
    return null;
  }
  const progressions = Array.isArray(summary.progressions)
    ? summary.progressions
    : [];
  return Object.freeze({
    status: String(summary.status ?? "unknown"),
    command: String(summary.command ?? ""),
    proofTarget: String(summary.proofTarget ?? ""),
    roleUrl: String(summary.roleUrl ?? ""),
    progressionCount: Number(summary.progressionCount ?? progressions.length),
    progressionIds: Object.freeze(
      (Array.isArray(summary.progressionIds)
        ? summary.progressionIds
        : progressions.map((progression) => progression.id)
      ).map((id) => String(id ?? "")),
    ),
    progressionProofTargets: Object.freeze(
      (Array.isArray(summary.progressionProofTargets)
        ? summary.progressionProofTargets
        : progressions.map((progression) => progression.adminProofTarget)
      ).map((target) => String(target ?? "")),
    ),
    progressions: Object.freeze(
      progressions.map((progression) =>
        Object.freeze({
          id: String(progression?.id ?? ""),
          checkId: String(progression?.checkId ?? ""),
          missingInputId: String(progression?.missingInputId ?? ""),
          adminProofMode: String(progression?.adminProofMode ?? ""),
          adminProofFixturePath: String(
            progression?.adminProofFixturePath ?? "",
          ),
          proofCommand: String(progression?.proofCommand ?? ""),
          evidencePath: String(progression?.evidencePath ?? ""),
          adminProofTarget: String(progression?.adminProofTarget ?? ""),
          roleUrl: String(progression?.roleUrl ?? ""),
          firstMissingInputId: String(progression?.firstMissingInputId ?? ""),
          firstMissingCheckId: String(progression?.firstMissingCheckId ?? ""),
          proofBoundary: String(progression?.proofBoundary ?? ""),
        }),
      ),
    ),
    proofBoundary: String(summary.proofBoundary ?? ""),
  });
}

function normalizeHostedHandoffOperatorProofDrilldowns(drilldowns) {
  return Object.freeze(
    (Array.isArray(drilldowns) ? drilldowns : []).map((drilldown) =>
      Object.freeze({
        id: String(drilldown?.id ?? ""),
        label: String(drilldown?.label ?? ""),
        command: String(drilldown?.command ?? ""),
        progressionId: String(drilldown?.progressionId ?? ""),
        sourcePath: String(drilldown?.sourcePath ?? ""),
        proofTarget: String(drilldown?.proofTarget ?? ""),
        roleUrl: String(drilldown?.roleUrl ?? ""),
        firstMissingInputId: String(drilldown?.firstMissingInputId ?? ""),
        firstMissingCheckId: String(drilldown?.firstMissingCheckId ?? ""),
        proofBoundary: String(drilldown?.proofBoundary ?? ""),
      }),
    ),
  );
}

function normalizeHostedHandoffBlockedReceipt(receipt) {
  if (receipt === null || typeof receipt !== "object") {
    return null;
  }
  const requiredInputs = Array.isArray(receipt.requiredInputs)
    ? receipt.requiredInputs
    : [];
  return Object.freeze({
    status: String(receipt.status ?? "unknown"),
    command: String(receipt.command ?? ""),
    proofTarget: String(receipt.proofTarget ?? ""),
    nextProofTarget: String(receipt.nextProofTarget ?? ""),
    operatorAction: String(receipt.operatorAction ?? ""),
    localVsHostedBoundary: String(receipt.localVsHostedBoundary ?? ""),
    ...(typeof receipt.rawEvidenceContractSummary === "string" &&
    receipt.rawEvidenceContractSummary.trim() !== ""
      ? { rawEvidenceContractSummary: receipt.rawEvidenceContractSummary }
      : {}),
    ...(receipt.realHostedMatrixRawCaptureIntake === null ||
    typeof receipt.realHostedMatrixRawCaptureIntake !== "object"
      ? {}
      : {
          realHostedMatrixRawCaptureIntake: Object.freeze({
            command: String(
              receipt.realHostedMatrixRawCaptureIntake.command ?? "",
            ),
            proofTarget: String(
              receipt.realHostedMatrixRawCaptureIntake.proofTarget ?? "",
            ),
            status: String(
              receipt.realHostedMatrixRawCaptureIntake.status ?? "",
            ),
            blockedCheckIds: Object.freeze(
              (
                receipt.realHostedMatrixRawCaptureIntake.blockedCheckIds ?? []
              ).map((id) => String(id)),
            ),
          }),
        }),
    missingRequiredInputs: Object.freeze(
      (Array.isArray(receipt.missingRequiredInputs)
        ? receipt.missingRequiredInputs
        : []
      ).map((input) => String(input)),
    ),
    ...(receipt.firstMissingOperatorArtifact === null ||
    typeof receipt.firstMissingOperatorArtifact !== "object"
      ? {}
      : {
          firstMissingOperatorArtifact:
            normalizeHostedHandoffFirstMissingOperatorArtifact(
              receipt.firstMissingOperatorArtifact,
            ),
        }),
    ...(receipt.blockedOperatorPacket === null ||
    typeof receipt.blockedOperatorPacket !== "object"
      ? {}
      : {
          blockedOperatorPacket: normalizeHostedHandoffBlockedOperatorPacket(
            receipt.blockedOperatorPacket,
          ),
        }),
    requiredInputs: Object.freeze(
      requiredInputs.map((input) =>
        Object.freeze({
          name: String(input?.name ?? ""),
          value: input?.value === null ? "" : String(input?.value ?? ""),
          required: input?.required === true,
          purpose: String(input?.purpose ?? ""),
        }),
      ),
    ),
  });
}

function normalizeHostedHandoffBlockedOperatorPacket(packet) {
  const drilldown =
    packet.roleSurfaceDrilldown !== null &&
    typeof packet.roleSurfaceDrilldown === "object"
      ? packet.roleSurfaceDrilldown
      : {};
  return Object.freeze({
    status: String(packet.status ?? "unknown"),
    firstMissingInputId: String(packet.firstMissingInputId ?? ""),
    firstMissingCheckId: String(packet.firstMissingCheckId ?? ""),
    firstMissingSectionId: String(packet.firstMissingSectionId ?? ""),
    firstMissingSectionLabel: String(packet.firstMissingSectionLabel ?? ""),
    firstMissingRequiredEvidence: String(
      packet.firstMissingRequiredEvidence ?? "",
    ),
    rawEvidenceContractSummary: String(
      packet.rawEvidenceContractSummary ?? "",
    ),
    rawEvidenceContractRequiredTopLevelFields: Object.freeze(
      (Array.isArray(packet.rawEvidenceContractRequiredTopLevelFields)
        ? packet.rawEvidenceContractRequiredTopLevelFields
        : []
      ).map((field) => String(field)),
    ),
    ...rawEvidenceTemplateDescriptorProperty(packet.rawEvidenceTemplate),
    operatorAction: String(packet.operatorAction ?? ""),
    ...(packet.operatorChecklist === null ||
    typeof packet.operatorChecklist !== "object"
      ? {}
      : {
          operatorChecklist: normalizeHostedEvidenceOperatorChecklist(
            packet.operatorChecklist,
          ),
        }),
    localVsHostedBoundary: String(packet.localVsHostedBoundary ?? ""),
    proofTarget: String(packet.proofTarget ?? ""),
    nextProofTarget: String(packet.nextProofTarget ?? ""),
    missingRequiredInputs: Object.freeze(
      (Array.isArray(packet.missingRequiredInputs)
        ? packet.missingRequiredInputs
        : []
      ).map((input) => String(input)),
    ),
    selectedProductionFeatureGraphNodeId: String(
      packet.selectedProductionFeatureGraphNodeId ?? "",
    ),
    selectedProductionFeatureRoleUrl: String(
      packet.selectedProductionFeatureRoleUrl ?? "",
    ),
    roleSurfaceDrilldown: Object.freeze({
      localCapabilityAuditId: String(drilldown.localCapabilityAuditId ?? ""),
      localCapabilityRoleUrl: String(drilldown.localCapabilityRoleUrl ?? ""),
      handoffAuditId: String(drilldown.handoffAuditId ?? ""),
      handoffRoleUrl: String(drilldown.handoffRoleUrl ?? ""),
      proofGraphNodeId: String(drilldown.proofGraphNodeId ?? ""),
      productionFeatureGraphNodeId: String(
        drilldown.productionFeatureGraphNodeId ?? "",
      ),
      proofGraphEvidencePath: String(drilldown.proofGraphEvidencePath ?? ""),
    }),
  });
}

function normalizeHostedEvidenceOperatorChecklist(checklist) {
  return Object.freeze({
    id: String(checklist.id ?? ""),
    path: String(checklist.path ?? ""),
    status: String(checklist.status ?? ""),
    checklistProofCommand: String(checklist.checklistProofCommand ?? ""),
    checklistProofTarget: String(checklist.checklistProofTarget ?? ""),
    command: String(checklist.command ?? ""),
    proofTarget: String(checklist.proofTarget ?? ""),
    preflightTarget: String(checklist.preflightTarget ?? ""),
    rawEvidenceTemplatePath: String(checklist.rawEvidenceTemplatePath ?? ""),
    rawEvidenceTemplateProofCommand: String(
      checklist.rawEvidenceTemplateProofCommand ?? "",
    ),
    rawCaptureCommand: String(checklist.rawCaptureCommand ?? ""),
    rawCaptureProofTarget: String(checklist.rawCaptureProofTarget ?? ""),
    rawEvidenceContractSummary: String(
      checklist.rawEvidenceContractSummary ?? "",
    ),
    operatorRunSequence: Object.freeze(
      (Array.isArray(checklist.operatorRunSequence)
        ? checklist.operatorRunSequence
        : []
      ).map((step) =>
        Object.freeze({
          id: String(step?.id ?? ""),
          label: String(step?.label ?? ""),
          command: String(step?.command ?? ""),
          proofTarget: String(step?.proofTarget ?? ""),
        }),
      ),
    ),
    blockedCheckIds: Object.freeze(
      (Array.isArray(checklist.blockedCheckIds)
        ? checklist.blockedCheckIds
        : []
      ).map((id) => String(id)),
    ),
    inputSections: Object.freeze(
      (Array.isArray(checklist.inputSections)
        ? checklist.inputSections
        : []
      ).map((section) =>
        Object.freeze({
          id: String(section?.id ?? ""),
          label: String(section?.label ?? ""),
          requiredInputIds: Object.freeze(
            (Array.isArray(section?.requiredInputIds)
              ? section.requiredInputIds
              : []
            ).map((id) => String(id)),
          ),
        }),
      ),
    ),
    env: Object.freeze(
      (Array.isArray(checklist.env) ? checklist.env : []).map((input) =>
        Object.freeze({
          name: String(input?.name ?? ""),
          required: input?.required === true,
          purpose: String(input?.purpose ?? ""),
        }),
      ),
    ),
    localVsHostedBoundary: String(checklist.localVsHostedBoundary ?? ""),
  });
}

function normalizeNextActionSelectedOperatorHandoff(handoff) {
  if (handoff === null || typeof handoff !== "object") {
    return null;
  }
  const blockedOperatorPacket =
    handoff.blockedOperatorPacket === null ||
    typeof handoff.blockedOperatorPacket !== "object"
      ? null
      : normalizeHostedHandoffBlockedOperatorPacket(
          handoff.blockedOperatorPacket,
        );
  if (blockedOperatorPacket === null) {
    return null;
  }
  return Object.freeze({
    id: String(handoff.id ?? ""),
    status: String(handoff.status ?? "unknown"),
    reason: String(handoff.reason ?? ""),
    command: String(handoff.command ?? ""),
    unprovenId: String(handoff.unprovenId ?? ""),
    proofTarget: String(handoff.proofTarget ?? ""),
    roleUrl: String(handoff.roleUrl ?? ""),
    firstMissingInputId: String(handoff.firstMissingInputId ?? ""),
    selectedProductionFeatureGraphNodeId: String(
      handoff.selectedProductionFeatureGraphNodeId ?? "",
    ),
    selectedProductionFeatureRoleUrl: String(
      handoff.selectedProductionFeatureRoleUrl ?? "",
    ),
    blockedOperatorPacket,
  });
}

function normalizeHostedHandoffFirstMissingOperatorArtifact(artifact) {
  const drilldown =
    artifact.roleSurfaceDrilldown !== null &&
    typeof artifact.roleSurfaceDrilldown === "object"
      ? artifact.roleSurfaceDrilldown
      : {};
  return Object.freeze({
    inputId: String(artifact.inputId ?? ""),
    checkId: String(artifact.checkId ?? ""),
    sectionId: String(artifact.sectionId ?? ""),
    sectionLabel: String(artifact.sectionLabel ?? ""),
    requiredEvidence: String(artifact.requiredEvidence ?? ""),
    purpose: String(artifact.purpose ?? ""),
    proofTarget: String(artifact.proofTarget ?? ""),
    roleSurfaceDrilldown: Object.freeze({
      localCapabilityAuditId: String(drilldown.localCapabilityAuditId ?? ""),
      localCapabilityRoleUrl: String(drilldown.localCapabilityRoleUrl ?? ""),
      handoffAuditId: String(drilldown.handoffAuditId ?? ""),
      handoffRoleUrl: String(drilldown.handoffRoleUrl ?? ""),
      proofGraphNodeId: String(drilldown.proofGraphNodeId ?? ""),
      productionFeatureGraphNodeId: String(
        drilldown.productionFeatureGraphNodeId ?? "",
      ),
      proofGraphEvidencePath: String(drilldown.proofGraphEvidencePath ?? ""),
    }),
  });
}

function hostedIdentityHandoffInputValue({ id, hostedIdentityEvidence }) {
  return id === "FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH"
    ? String(
        hostedIdentityEvidence.target?.rawEvidencePath ??
          hostedIdentityEvidence.hostedHandoffChecklist?.placeholderFixturePath ??
          hostedIdentityEvidence.target?.placeholderFixturePath ??
          "required",
      )
    : "required";
}

function realHostedObservabilityHandoffInputValue({
  id,
  realHostedObservabilityHandoff,
}) {
  if (id === "command") {
    return String(
      realHostedObservabilityHandoff.hostedHandoffChecklist?.command ??
        realHostedObservabilityHandoff.nextCommand ??
        `npm run ${devTestGameRealHostedObservabilityHandoffCommand}`,
    );
  }
  if (id === "proof-target") {
    return String(
      realHostedObservabilityHandoff.hostedHandoffChecklist?.proofTarget ??
        realHostedObservabilityHandoff.nextProofTarget ??
        devTestGameRealHostedObservabilityHandoffPath,
    );
  }
  if (id === realHostedObservabilityEvidenceEnv) {
    return String(
      realHostedObservabilityHandoff.target?.rawEvidencePath ??
        "externally reachable hosted logs/metrics/traces/paging/SLO/incident-response evidence JSON",
    );
  }
  if (id === realHostedObservabilityBaselineEnv) {
    return String(
      realHostedObservabilityHandoff.target?.localHostedOpsSignalsPath ??
        devTestGameHostedOpsSignalsPath,
    );
  }
  return "required";
}

function normalizeHostedIdentityRedactedIntakePacket(packet) {
  if (packet === null || typeof packet !== "object") {
    return null;
  }
  return Object.freeze({
    kind: String(packet.kind ?? ""),
    status: String(packet.status ?? "unknown"),
    sectionCount: Number.isInteger(packet.sectionCount)
      ? packet.sectionCount
      : 0,
    providedSectionCount: Number.isInteger(packet.providedSectionCount)
      ? packet.providedSectionCount
      : 0,
    missingSectionCount: Number.isInteger(packet.missingSectionCount)
      ? packet.missingSectionCount
      : 0,
    requiredInputCount: Number.isInteger(packet.requiredInputCount)
      ? packet.requiredInputCount
      : 0,
    providedInputCount: Number.isInteger(packet.providedInputCount)
      ? packet.providedInputCount
      : 0,
    missingInputCount: Number.isInteger(packet.missingInputCount)
      ? packet.missingInputCount
      : 0,
    redactedEvidenceRefCount: Number.isInteger(packet.redactedEvidenceRefCount)
      ? packet.redactedEvidenceRefCount
      : 0,
    rawInviteTokensIncluded: packet.rawInviteTokensIncluded === true,
    rawSessionSecretsIncluded: packet.rawSessionSecretsIncluded === true,
    rawPasswordHashesIncluded: packet.rawPasswordHashesIncluded === true,
    rawPersonalContactIncluded: packet.rawPersonalContactIncluded === true,
    roleSurfaceArchitectureChanged:
      packet.roleSurfaceArchitectureChanged === true,
    sections: Object.freeze(
      (Array.isArray(packet.sections) ? packet.sections : []).map((section) =>
        Object.freeze({
          id: String(section.id ?? ""),
          checkId: String(section.checkId ?? ""),
          label: String(section.label ?? section.id ?? ""),
          status: String(section.status ?? "unknown"),
          requiredInputIds: Object.freeze(
            (Array.isArray(section.requiredInputIds)
              ? section.requiredInputIds
              : []
            ).map((id) => String(id)),
          ),
          providedInputIds: Object.freeze(
            (Array.isArray(section.providedInputIds)
              ? section.providedInputIds
              : []
            ).map((id) => String(id)),
          ),
          redactedEvidenceRefCount: Number.isInteger(
            section.redactedEvidenceRefCount,
          )
            ? section.redactedEvidenceRefCount
            : 0,
          redactedEvidenceRefs: Object.freeze(
            (Array.isArray(section.redactedEvidenceRefs)
              ? section.redactedEvidenceRefs
              : []
            ).map((ref) =>
              Object.freeze({
                id: String(ref.id ?? ""),
                kind: String(ref.kind ?? ""),
                evidenceFamily: String(ref.evidenceFamily ?? ""),
                capturedAt: String(ref.capturedAt ?? ""),
                retentionWindow: String(ref.retentionWindow ?? ""),
                locator: String(ref.locator ?? ""),
                exportLocator: String(ref.exportLocator ?? ""),
                redacted: ref.redacted === true,
              }),
            ),
          ),
          missingInputs: Object.freeze(
            (Array.isArray(section.missingInputs) ? section.missingInputs : []).map(
              (id) => String(id),
            ),
          ),
        }),
      ),
    ),
  });
}

function normalizeHostedIdentityRoleSurfaceContractDiff(diff) {
  if (diff === null || typeof diff !== "object") {
    return null;
  }
  return Object.freeze({
    status: String(diff.status ?? "unknown"),
    architectureId: String(diff.architectureId ?? ""),
    mismatchCount: Array.isArray(diff.mismatches) ? diff.mismatches.length : 0,
    mismatches: Object.freeze(
      (Array.isArray(diff.mismatches) ? diff.mismatches : []).map((mismatch) =>
        Object.freeze({
          id: String(mismatch.id ?? ""),
          path: String(mismatch.path ?? ""),
          expected: stringifyAuditValue(mismatch.expected),
          actual: stringifyAuditValue(mismatch.actual),
        }),
      ),
    ),
  });
}

function normalizeHostedIdentityAdapterContractComparison(comparison) {
  if (comparison === null || typeof comparison !== "object") {
    return null;
  }
  return Object.freeze({
    status: String(comparison.status ?? "unknown"),
    localAdapterId: String(comparison.localAdapterId ?? ""),
    hostedAdapterId: String(comparison.hostedAdapterId ?? ""),
    localStatus: String(comparison.localStatus ?? "unknown"),
    hostedStatus: String(comparison.hostedStatus ?? "unknown"),
    roleSurfaceContractStatus: String(
      comparison.roleSurfaceContractStatus ?? "unknown",
    ),
    mismatchCount: Array.isArray(comparison.mismatches)
      ? comparison.mismatches.length
      : 0,
    mismatches: Object.freeze(
      (Array.isArray(comparison.mismatches) ? comparison.mismatches : []).map(
        (mismatch) =>
          Object.freeze({
            id: String(mismatch.id ?? ""),
            path: String(mismatch.path ?? ""),
            expected: stringifyAuditValue(mismatch.expected),
            actual: stringifyAuditValue(mismatch.actual),
          }),
      ),
    ),
  });
}

function stringifyAuditValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return JSON.stringify(value);
}

function normalizeHostedHandoffGroups(groups) {
  return Object.freeze(
    (Array.isArray(groups) ? groups : []).map((group) =>
      Object.freeze({
        id: String(group.id ?? ""),
        label: String(group.label ?? group.id ?? ""),
        status: String(group.status ?? "unknown"),
        requiredEvidence: String(group.requiredEvidence ?? ""),
        checkIds: Object.freeze(
          (Array.isArray(group.checkIds) ? group.checkIds : []).map((id) =>
            String(id),
          ),
        ),
        blockedCheckIds: Object.freeze(
          (Array.isArray(group.blockedCheckIds)
            ? group.blockedCheckIds
            : []
          ).map((id) => String(id)),
        ),
      }),
    ),
  );
}

function normalizeHostedHandoffInputSections(sections) {
  return Object.freeze(
    (Array.isArray(sections) ? sections : []).map((section) =>
      Object.freeze({
        id: String(section.id ?? ""),
        label: String(section.label ?? section.id ?? ""),
        status: String(section.status ?? "unknown"),
        requiredInputIds: Object.freeze(
          (Array.isArray(section.requiredInputIds)
            ? section.requiredInputIds
            : []
          ).map((id) => String(id)),
        ),
        providedInputIds: Object.freeze(
          (Array.isArray(section.providedInputIds)
            ? section.providedInputIds
            : []
          ).map((id) => String(id)),
        ),
        missingInputs: Object.freeze(
          (Array.isArray(section.missingInputs) ? section.missingInputs : []).map(
            (id) => String(id),
          ),
        ),
      }),
    ),
  );
}

function seededRoleUrlToAdminHref(roleUrl, { game }) {
  return String(roleUrl).replace("<seeded-game>", encodeURIComponent(game));
}

function normalizeNextActionSelectionTrace(selectionTrace) {
  const normalized = normalizeSelectionTrace(selectionTrace);
  return Object.freeze({
    strategy: normalized.strategy,
    candidateCount: normalized.candidateCount,
    selectedArtifactId: normalized.selectedArtifactId,
    candidates: normalized.candidates,
  });
}

function normalizeNextActionReleaseReadinessTrace(releaseReadinessTrace) {
  if (
    releaseReadinessTrace === null ||
    typeof releaseReadinessTrace !== "object" ||
    releaseReadinessTrace.strategy !== releaseReadinessTraceStrategy ||
    !Array.isArray(releaseReadinessTrace.candidates)
  ) {
    return Object.freeze({
      strategy: "unknown",
      candidateCount: 0,
      selectedUnprovenId: null,
      candidates: Object.freeze([]),
    });
  }
  const candidates = releaseReadinessTrace.candidates
    .filter((candidate) => candidate !== null && typeof candidate === "object")
    .map((candidate) =>
      Object.freeze({
        rank: Number(candidate.rank ?? 0),
        id: String(candidate.id ?? "unknown"),
        status: String(candidate.status ?? "unknown"),
        priority: Number(candidate.priority ?? 0),
        selected: candidate.selected === true,
        command: String(candidate.command ?? ""),
        buildSlice: String(candidate.buildSlice ?? ""),
        proofTarget: String(candidate.proofTarget ?? ""),
        proofBoundary: String(candidate.proofBoundary ?? ""),
        roleUrl: String(candidate.roleUrl ?? ""),
        proofGraphNodeId: String(candidate.proofGraphNodeId ?? ""),
        productionFeatureSpineTarget: normalizeNextActionFeatureSpineDeclaration(
          candidate.productionFeatureSpineTarget,
        ),
        spineDrilldown: normalizeNextActionSpineDrilldown(
          candidate.spineDrilldown,
        ),
        spineTarget: normalizeNextActionSpineTarget(candidate.spineTarget),
        selectedProductionFeatureGraph:
          normalizeNextActionProductionFeatureGraph(
            candidate.selectedProductionFeatureGraph,
          ),
        ...(candidate.hostedEvidenceMode === undefined
          ? {}
          : { hostedEvidenceMode: String(candidate.hostedEvidenceMode) }),
        ...(candidate.realHostedEvidenceStatus === undefined
          ? {}
          : {
              realHostedEvidenceStatus: String(
                candidate.realHostedEvidenceStatus,
              ),
            }),
        ...(candidate.realHostedEvidenceInputs === undefined
          ? {}
          : {
              realHostedEvidenceInputs: normalizeRealHostedEvidenceInputs(
                candidate.realHostedEvidenceInputs,
              ),
            }),
      }),
    );
  return Object.freeze({
    strategy: releaseReadinessTrace.strategy,
    candidateCount: Number(releaseReadinessTrace.candidateCount ?? candidates.length),
    selectedUnprovenId:
      typeof releaseReadinessTrace.selectedUnprovenId === "string"
        ? releaseReadinessTrace.selectedUnprovenId
        : null,
    candidates: Object.freeze(candidates),
  });
}

function normalizeNextActionSpineTarget(spineTarget) {
  if (spineTarget === null || typeof spineTarget !== "object") {
    return Object.freeze({
      sourceCheckId: "",
      featureSlotId: "",
      detailRoleUrl: "",
      cycleId: "",
      roleUrlId: "",
      roleUrl: "",
      rowKind: "",
      checkpointId: "",
      recoveryHookId: "",
      adminCheckId: "",
      browserProofCommand: "",
      sourceProofArtifact: "",
      coverageDecision: null,
    });
  }
  return Object.freeze({
    sourceCheckId: String(spineTarget.sourceCheckId ?? ""),
    featureSlotId: String(spineTarget.featureSlotId ?? ""),
    detailRoleUrl: String(spineTarget.detailRoleUrl ?? ""),
    cycleId: String(spineTarget.cycleId ?? ""),
    roleUrlId: String(spineTarget.roleUrlId ?? ""),
    roleUrl: String(spineTarget.roleUrl ?? ""),
    rowKind: normalizeSpineRowKind(spineTarget),
    checkpointId: String(spineTarget.checkpointId ?? ""),
    recoveryHookId: String(spineTarget.recoveryHookId ?? ""),
    adminCheckId: String(spineTarget.adminCheckId ?? ""),
    browserProofCommand: String(spineTarget.browserProofCommand ?? ""),
    sourceProofArtifact: String(spineTarget.sourceProofArtifact ?? ""),
    coverageDecision: normalizeCoverageDecision(spineTarget.coverageDecision),
  });
}

function normalizeNextActionFeatureSpineDeclaration(declaration) {
  if (declaration === null || typeof declaration !== "object") {
    return Object.freeze({
      sourceCheckId: "",
      featureSlotId: "",
      cycleId: "",
      roleUrlId: "",
      rowKind: "",
      checkpointId: "",
      recoveryHookId: "",
      adminCheckId: "",
    });
  }
  return Object.freeze({
    sourceCheckId: String(declaration.sourceCheckId ?? ""),
    featureSlotId: String(declaration.featureSlotId ?? ""),
    cycleId: String(declaration.cycleId ?? ""),
    roleUrlId: String(declaration.roleUrlId ?? ""),
    rowKind: normalizeSpineRowKind(declaration),
    checkpointId: String(declaration.checkpointId ?? ""),
    recoveryHookId: String(declaration.recoveryHookId ?? ""),
    adminCheckId: String(declaration.adminCheckId ?? ""),
  });
}

function normalizeNextActionProductionFeatureGraph(graphSelection) {
  if (graphSelection === null || typeof graphSelection !== "object") {
    return Object.freeze({
      nodeId: "",
      status: "",
      sourceNodeId: "",
      edgeFrom: "",
      edgeTo: "",
      edgeRelationship: "",
      roleUrl: "",
      targetRoleUrl: "",
      edgeTargetRoleUrl: "",
      selectedSpineTargetRoleUrl: "",
      targetRoleUrlMatchesSelectedSpineTarget: false,
      browserProofCommand: "",
      proofTarget: "",
      coverageDecision: null,
    });
  }
  const edge =
    graphSelection.edge !== null && typeof graphSelection.edge === "object"
      ? graphSelection.edge
      : {};
  const browserWorkbench = normalizeBrowserWorkbench(
    graphSelection.browserWorkbench,
  );
  return Object.freeze({
    nodeId: String(graphSelection.nodeId ?? ""),
    status: String(graphSelection.status ?? "unknown"),
    sourceNodeId: String(graphSelection.sourceNodeId ?? ""),
    edgeFrom: String(edge.from ?? ""),
    edgeTo: String(edge.to ?? ""),
    edgeRelationship: String(edge.relationship ?? ""),
    roleUrl: String(graphSelection.roleUrl ?? ""),
    targetRoleUrl: String(graphSelection.targetRoleUrl ?? ""),
    edgeTargetRoleUrl: String(graphSelection.edgeTargetRoleUrl ?? ""),
    selectedSpineTargetRoleUrl: String(
      graphSelection.selectedSpineTargetRoleUrl ?? "",
    ),
    targetRoleUrlMatchesSelectedSpineTarget:
      graphSelection.targetRoleUrlMatchesSelectedSpineTarget === true,
    browserProofCommand: String(graphSelection.browserProofCommand ?? ""),
    ...(browserWorkbench === null ? {} : { browserWorkbench }),
    proofTarget: String(graphSelection.proofTarget ?? ""),
    coverageDecision: normalizeCoverageDecision(graphSelection.coverageDecision),
  });
}

function normalizeNextActionSpineDrilldown(drilldown) {
  if (drilldown === null || typeof drilldown !== "object") {
    return Object.freeze({
      featureSlotId: "",
      sourceCheckId: "",
      detailRoleUrl: "",
      cycleRowId: "",
      roleUrlRowId: "",
      rowKind: "",
      checkpointRowId: "",
      recoveryHookRowId: "",
      adminCheckId: "",
      roleUrl: "",
      rerunCommand: "",
      browserProofCommand: "",
      sourceProofArtifact: "",
      coverageDecision: null,
    });
  }
  return Object.freeze({
    featureSlotId: String(drilldown.featureSlotId ?? ""),
    sourceCheckId: String(drilldown.sourceCheckId ?? ""),
    detailRoleUrl: String(drilldown.detailRoleUrl ?? ""),
    cycleRowId: String(drilldown.cycleRowId ?? ""),
    roleUrlRowId: String(drilldown.roleUrlRowId ?? ""),
    rowKind: normalizeSpineRowKind(drilldown),
    checkpointRowId: String(drilldown.checkpointRowId ?? ""),
    recoveryHookRowId: String(drilldown.recoveryHookRowId ?? ""),
    adminCheckId: String(drilldown.adminCheckId ?? ""),
    roleUrl: String(drilldown.roleUrl ?? ""),
    rerunCommand: String(drilldown.rerunCommand ?? ""),
    browserProofCommand: String(drilldown.browserProofCommand ?? ""),
    sourceProofArtifact: String(drilldown.sourceProofArtifact ?? ""),
    coverageDecision: normalizeCoverageDecision(drilldown.coverageDecision),
  });
}

function normalizeCoverageDecision(coverageDecision) {
  if (coverageDecision === null || typeof coverageDecision !== "object") {
    return null;
  }
  return Object.freeze(
    Object.fromEntries(
      [
        "kind",
        "proofCommand",
        "reason",
        "nextDecisionTrigger",
        "prerequisiteCheckId",
        "recoveryCommand",
      ]
        .map((key) => [key, String(coverageDecision[key] ?? "")])
        .filter(([, value]) => value !== ""),
    ),
  );
}

function normalizeRealHostedEvidenceInputs(inputs) {
  return Object.freeze(
    hostedEvidenceHandoffInputRows(inputs).map((input) =>
      Object.freeze(input),
    ),
  );
}

function normalizeNextActionReplacementRaceReloadTrace(replacementRaceReloadTrace) {
  return normalizeNextActionRaceReloadTrace(
    recoveryTraceKeys.replacementRaceReload,
    replacementRaceReloadTrace,
  );
}

function normalizeNextActionHostConcurrentRaceReloadTrace(hostConcurrentRaceReloadTrace) {
  return normalizeNextActionRaceReloadTrace(
    recoveryTraceKeys.hostConcurrentRaceReload,
    hostConcurrentRaceReloadTrace,
  );
}

function normalizeNextActionPlayerConcurrentActionReloadTrace(
  playerConcurrentActionReloadTrace,
) {
  return normalizeNextActionRaceReloadTrace(
    recoveryTraceKeys.playerConcurrentActionReload,
    playerConcurrentActionReloadTrace,
  );
}

function normalizeNextActionCohostDeadlineRaceReloadTrace(
  cohostDeadlineRaceReloadTrace,
) {
  return normalizeNextActionRaceReloadTrace(
    recoveryTraceKeys.cohostDeadlineRaceReload,
    cohostDeadlineRaceReloadTrace,
  );
}

function normalizeNextActionRaceReloadTrace(key, trace) {
  const normalized = normalizeRecoveryTrace(key, trace);
  return Object.freeze({
    strategy: normalized.strategy,
    status: normalized.status,
    source: normalized.source,
    requiredCellCount: normalized.requiredCellCount,
    coveredCellCount: normalized.coveredCellCount,
    gapCount: normalized.gapCount,
    cells: normalized.cells,
  });
}

function normalizeNextActionRaceCoveragePromotedMilestones(promotedMilestones) {
  if (
    promotedMilestones === null ||
    typeof promotedMilestones !== "object" ||
    !Array.isArray(promotedMilestones.groups)
  ) {
    return Object.freeze({
      status: "unknown",
      cellCount: 0,
      provenCellCount: 0,
      reloadCoveredCellCount: 0,
      groupCount: 0,
      passedGroupCount: 0,
      requiredCellCount: 0,
      coveredCellCount: 0,
      gapCount: 0,
      groups: Object.freeze([]),
    });
  }
  const groups = promotedMilestones.groups
    .filter((group) => group !== null && typeof group === "object")
    .map((group) =>
      Object.freeze({
        id: String(group.id ?? "unknown"),
        label: String(group.label ?? "Unknown"),
        status: String(group.status ?? "unknown"),
        cellIds: Object.freeze(
          Array.isArray(group.cellIds)
            ? group.cellIds.map((cellId) => String(cellId))
            : [],
        ),
        requiredCellCount: Number(group.requiredCellCount ?? 0),
        coveredCellCount: Number(group.coveredCellCount ?? 0),
        gapCount: Number(group.gapCount ?? 0),
      }),
    );
  return Object.freeze({
    status: String(promotedMilestones.status ?? "unknown"),
    cellCount: Number(promotedMilestones.cellCount ?? 0),
    provenCellCount: Number(promotedMilestones.provenCellCount ?? 0),
    reloadCoveredCellCount: Number(promotedMilestones.reloadCoveredCellCount ?? 0),
    groupCount: Number(promotedMilestones.groupCount ?? groups.length),
    passedGroupCount: Number(promotedMilestones.passedGroupCount ?? 0),
    requiredCellCount: Number(promotedMilestones.requiredCellCount ?? 0),
    coveredCellCount: Number(promotedMilestones.coveredCellCount ?? 0),
    gapCount: Number(promotedMilestones.gapCount ?? 0),
    groups: Object.freeze(groups),
  });
}

function normalizeNextActionStaleConflictMessageTrace(staleConflictMessageTrace) {
  return normalizeRecoveryTrace(
    recoveryTraceKeys.staleConflictMessage,
    staleConflictMessageTrace,
  );
}

function normalizeNextActionHostStaleControlTrace(hostStaleControlTrace) {
  const normalized = normalizeRecoveryTrace(
    recoveryTraceKeys.hostStaleControl,
    hostStaleControlTrace,
  );
  return Object.freeze({
    strategy: normalized.strategy,
    status: normalized.status,
    source: normalized.source,
    requiredLaneCount: normalized.requiredLaneCount,
    coveredLaneCount: normalized.coveredLaneCount,
    gapCount: normalized.gapCount,
    laneIds: normalized.laneIds,
  });
}

export function normalizeLocalProofFreshnessAudit(
  proofFreshness,
  { game, nextAction = null },
) {
  if (
    proofFreshness === null ||
    typeof proofFreshness !== "object" ||
    proofFreshness.version !== 1 ||
    proofFreshness.proof !== "dev-test-game-proof-freshness" ||
    proofFreshness.scope !== "local-dev-test-game-proof-freshness" ||
    proofFreshness.releaseReady !== false ||
    proofFreshness.productionReady !== false
  ) {
    return null;
  }
  const artifacts = Array.isArray(proofFreshness.artifacts)
    ? proofFreshness.artifacts
    : [];
  const summary = proofFreshness.summary ?? {};
  const nextActionRow = normalizeLocalNextActionAudit(nextAction, { game });
  const nextActionHandoff =
    nextActionRow === null
      ? null
      : Object.freeze({
          id: localAdminAuditIds.nextAction,
          label: "Ranked next action",
          href: nextActionRow.inspectHref,
          status: nextActionRow.status,
          command: nextActionRow.artifactSummary.command,
          ...(nextActionRow.artifactSummary.reason ===
          "proof-graph-destination-summary-drift"
            ? {
                reason: nextActionRow.artifactSummary.reason,
                actionStatus: nextActionRow.artifactSummary.actionStatus,
                proofGraphDestinationSummary: {
                  status:
                    nextActionRow.artifactSummary
                      .selectedProofGraphDestinationSummaryStatus,
                  driftCount:
                    nextActionRow.artifactSummary
                      .selectedProofGraphDestinationSummaryDriftCount,
                  proofTarget:
                    nextActionRow.artifactSummary
                      .selectedProofGraphDestinationSummaryProofTarget,
                },
              }
            : {}),
        });
  return Object.freeze({
    id: localAdminAuditIds.proofFreshness,
    label: "Local proof freshness",
    status: `${Number(summary.freshCount ?? 0)} fresh, ${Number(
      summary.staleCount ?? 0,
    )} stale, ${Number(summary.missingCount ?? 0)} missing`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local proof freshness dashboard",
    boundaryDetail:
      proofFreshness.proofBoundary ??
      "Local dev-test-game artifact age dashboard without content validation or release claims.",
    href: localProofArtifactHref({
      game,
      artifact: devTestGameReleaseReadinessPath,
    }),
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.proofFreshness }),
    checks: Object.freeze(
      [
        ...artifacts.map((artifact) =>
          Object.freeze({
            id: String(artifact.id),
            status: String(artifact.status),
          }),
        ),
        ...(nextActionHandoff === null
          ? []
          : [
              Object.freeze({
                id: localAdminAuditHandoffCheckIds.nextAction,
                status: nextActionHandoff.status,
              }),
              ...(nextActionHandoff.reason ===
              "proof-graph-destination-summary-drift"
                ? [
                    Object.freeze({
                      id: `next-action-${nextActionHandoff.reason}`,
                      status: nextActionHandoff.actionStatus,
                    }),
                    Object.freeze({
                      id: "next-action-proof-graph-destination-summary",
                      status: `${nextActionHandoff.proofGraphDestinationSummary.status}:${nextActionHandoff.proofGraphDestinationSummary.driftCount} drift`,
                    }),
                  ]
                : []),
            ]),
      ],
    ),
    relatedLinks:
      nextActionHandoff === null ? Object.freeze([]) : Object.freeze([nextActionHandoff]),
    artifactSummary: Object.freeze({
      artifactCount: Number(summary.artifactCount ?? artifacts.length),
      freshCount: Number(summary.freshCount ?? 0),
      staleCount: Number(summary.staleCount ?? 0),
      missingCount: Number(summary.missingCount ?? 0),
      maxAgeHours: Number(proofFreshness.maxAgeHours ?? 0),
      nextActionCommand: nextActionHandoff?.command ?? "",
      nextActionInspectHref: nextActionHandoff?.href ?? "",
      ...(nextActionHandoff?.reason ===
      "proof-graph-destination-summary-drift"
        ? {
            nextActionReason: nextActionHandoff.reason,
            nextActionProofGraphDestinationSummaryStatus:
              nextActionHandoff.proofGraphDestinationSummary?.status ?? "",
            nextActionProofGraphDestinationSummaryDriftCount:
              nextActionHandoff.proofGraphDestinationSummary?.driftCount ?? 0,
            nextActionProofGraphDestinationSummaryProofTarget:
              nextActionHandoff.proofGraphDestinationSummary?.proofTarget ?? "",
          }
        : {}),
      releaseReady: proofFreshness.releaseReady === true,
      productionReady: proofFreshness.productionReady === true,
    }),
  });
}

export function normalizeLocalOpsArtifactsAudit(opsArtifacts, { game }) {
  if (
    opsArtifacts === null ||
    typeof opsArtifacts !== "object" ||
    opsArtifacts.version !== 3 ||
    opsArtifacts.proof !== "dev-test-game-ops-artifacts" ||
    opsArtifacts.status !== "passed"
  ) {
    return null;
  }
  const checks = Array.isArray(opsArtifacts.checks) ? opsArtifacts.checks : [];
  const passedChecks = checks.filter((check) => check?.status === "passed");
  return Object.freeze({
    id: localAdminAuditIds.opsArtifacts,
    label: "Local ops artifacts",
    status: `${passedChecks.length} local ops checks passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local ops artifact bundle",
    boundaryDetail:
      opsArtifacts.proofBoundary ??
      "Local dev-test-game ops artifact bundle without hosted observability claims.",
    href: devTestGameOpsArtifactsPath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.opsArtifacts }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
        }),
      ),
    ),
    artifactSummary: Object.freeze({
      game: String(opsArtifacts.run?.game ?? ""),
      laneCount: Number(opsArtifacts.proofRun?.laneCount ?? 0),
      roleCount: Number(opsArtifacts.run?.roleCount ?? 0),
      releaseReady: opsArtifacts.releaseReady === true,
      productionReady: opsArtifacts.productionReady === true,
    }),
  });
}

export function appendLocalSpineManifestAudit(audit, spineManifest, { game }) {
  const row = normalizeLocalSpineManifestAudit(spineManifest, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalSpineManifestAudit(spineManifest, { game }) {
  if (
    spineManifest === null ||
    typeof spineManifest !== "object" ||
    spineManifest.version !== 1 ||
    spineManifest.proof !== "dev-test-game-spine-manifest" ||
    spineManifest.status !== "passed" ||
    spineManifest.scope !== "local-dev-test-game-spine-manifest" ||
    spineManifest.releaseReady !== false ||
    spineManifest.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(spineManifest.checks) ? spineManifest.checks : [];
  const commands =
    spineManifest.commands !== null && typeof spineManifest.commands === "object"
      ? Object.entries(spineManifest.commands)
      : [];
  const artifacts = Array.isArray(spineManifest.artifacts)
    ? spineManifest.artifacts
    : [];
  const terminalArtifacts = Array.isArray(spineManifest.terminalArtifacts)
    ? spineManifest.terminalArtifacts
    : [];
  const artifactFreshness =
    spineManifest.artifactFreshness !== null &&
    typeof spineManifest.artifactFreshness === "object"
      ? spineManifest.artifactFreshness
      : {};
  const freshnessSummary =
    artifactFreshness.summary !== null && typeof artifactFreshness.summary === "object"
      ? artifactFreshness.summary
      : {};
  const spineManifestRelatedLinks = Object.freeze([
    Object.freeze({
      id: localAdminAuditIds.proofFreshness,
      label: "Proof freshness",
      href: adminAuditInspectHref({ game, audit: localAdminAuditIds.proofFreshness }),
      status: String(artifactFreshness.status ?? "unknown"),
      command: String(artifactFreshness.nextCommand ?? ""),
    }),
    Object.freeze({
      id: localAdminAuditIds.nextAction,
      label: "Ranked next action",
      href: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
      status: String(spineManifest.commands?.nextAction?.script ?? "unknown"),
      command: String(spineManifest.commands?.nextAction?.script ?? ""),
    }),
  ]);
  return Object.freeze({
    id: localAdminAuditIds.spineManifest,
    label: "Local spine manifest",
    status: `${checks.filter((check) => check?.status === "passed").length} manifest checks passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local development-spine manifest",
    boundaryDetail:
      spineManifest.proofBoundary ??
      "Generated local dev-test-game proof order and evidence wiring without release claims.",
    href: spineManifestPath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.spineManifest }),
    checks: Object.freeze(
      [
        ...checks.map((check) =>
          Object.freeze({
            id: String(check.id),
            status: String(check.status),
          }),
        ),
        Object.freeze({
          id: localAdminAuditHandoffCheckIds.proofFreshness,
          status: String(artifactFreshness.status ?? "unknown"),
        }),
        Object.freeze({
          id: localAdminAuditHandoffCheckIds.nextAction,
          status: String(spineManifest.commands?.nextAction?.script ?? "unknown"),
        }),
      ],
    ),
    relatedLinks: spineManifestRelatedLinks,
    artifactSummary: Object.freeze({
      commandCount: commands.length,
      artifactCount: artifacts.length,
      terminalArtifactCount: terminalArtifacts.length,
      adminSpineStepCount: Number(
        spineManifest.commands?.adminSpine?.plan?.length ?? 0,
      ),
      artifactFreshnessStatus: String(artifactFreshness.status ?? "unknown"),
      freshCount: Number(freshnessSummary.freshCount ?? 0),
      staleCount: Number(freshnessSummary.staleCount ?? 0),
      missingCount: Number(freshnessSummary.missingCount ?? 0),
      nextCommand: String(artifactFreshness.nextCommand ?? ""),
      nextActionInspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
      proofFreshnessInspectHref: adminAuditInspectHref({
        game,
        audit: localAdminAuditIds.proofFreshness,
      }),
      releaseReady: spineManifest.releaseReady === true,
      productionReady: spineManifest.productionReady === true,
    }),
  });
}

export function appendLocalAdminSpineAudit(
  audit,
  adminSpineProof,
  { game, terminalBatchProof = null },
) {
  const row = normalizeLocalAdminSpineAudit(adminSpineProof, {
    game,
    terminalBatchProof,
  });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalAdminSpineAudit(
  adminSpineProof,
  { game, terminalBatchProof = null },
) {
  if (
    adminSpineProof === null ||
    typeof adminSpineProof !== "object" ||
    adminSpineProof.version !== 1 ||
    adminSpineProof.proof !== "dev-test-game-admin-spine-proof" ||
    adminSpineProof.status !== "passed" ||
    adminSpineProof.scope !== "local-dev-test-game-admin-spine" ||
    adminSpineProof.releaseReady !== false ||
    adminSpineProof.productionReady !== false
  ) {
    return null;
  }
  const proofs = Array.isArray(adminSpineProof.adminProofs)
    ? adminSpineProof.adminProofs
    : [];
  const recovery =
    adminSpineProof.recovery !== null && typeof adminSpineProof.recovery === "object"
      ? adminSpineProof.recovery
      : {};
  const aggregateBatches = Array.isArray(adminSpineProof.batches)
    ? adminSpineProof.batches
    : [];
  const terminalBatches = validAdminSpineTerminalBatchProof(terminalBatchProof)
    ? terminalBatchProof.batches
    : [];
  const terminalValidations = validAdminSpineTerminalBatchProof(
    terminalBatchProof,
  )
    ? normalizeAdminSpineTerminalValidations(terminalBatchProof.terminalValidations)
    : [];
  const terminalNextActionHandoffPair = validAdminSpineTerminalBatchProof(
    terminalBatchProof,
  )
    ? normalizeAdminSpineNextActionHandoffPair(
        terminalBatchProof.nextActionHandoffPair,
      )
    : null;
  const terminalReceiptsByKey =
    normalizeAdminSpineTerminalReceipts(terminalBatchProof);
  const batches = [...aggregateBatches, ...terminalBatches].map((batch, index) =>
    normalizeAdminSpineBatch(batch, index),
  );
  const adminSpineRelatedLinks = Object.freeze([
    Object.freeze({
      id: localAdminAuditIds.spineManifest,
      label: "Spine manifest",
      href: adminAuditInspectHref({ game, audit: localAdminAuditIds.spineManifest }),
      status: String(
        proofs.find((proof) => proof?.id === "spine-manifest")?.status ?? "unknown",
      ),
      command:
        String(
          recovery.surfaces?.find((surface) => surface?.id === "spine-manifest")
            ?.rerunCommand ?? "",
        ),
    }),
  ]);
  return Object.freeze({
    id: localAdminAuditIds.adminSpine,
    label: "Local admin spine",
    status: `${proofs.filter((proof) => proof?.status === "passed").length} admin proof surfaces passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local aggregate admin proof",
    boundaryDetail:
      adminSpineProof.proofBoundary ??
      "Local aggregate admin proof without hosted or release-readiness claims.",
    href: adminSpineProofPath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.adminSpine }),
    checks: Object.freeze(
      [
        ...proofs.map((proof) =>
          Object.freeze({
            id: String(proof.id),
            status: String(proof.status),
            ...(proof.rerunCommand === undefined
              ? {}
              : { rerunCommand: String(proof.rerunCommand) }),
            ...(proof.refreshedInCurrentRun === undefined
              ? {}
              : { refreshedInCurrentRun: proof.refreshedInCurrentRun === true }),
          }),
        ),
        Object.freeze({
          id: "recovery",
          status: String(recovery.status ?? "unknown"),
          nextCommand: String(recovery.nextCommand ?? ""),
        }),
        Object.freeze({
          id: localAdminAuditHandoffCheckIds.spineManifest,
          status: String(
            proofs.find((proof) => proof?.id === "spine-manifest")?.status ?? "unknown",
          ),
        }),
        ...(terminalNextActionHandoffPair === null
          ? []
          : [
              Object.freeze({
                id: terminalNextActionHandoffPair.id,
                status: `${terminalNextActionHandoffPair.defaultSequenceBlocker.status}:${terminalNextActionHandoffPair.hostedIdentityPredicate.status}`,
              }),
            ]),
        ...adminRouteTerminalReceiptContracts.flatMap((contract) => {
          const receipt = terminalReceiptsByKey[contract.terminalBatchesKey];
          return receipt === null
            ? []
            : [
                Object.freeze({
                  id: receipt.id,
                  status: receipt.status,
                }),
              ];
        }),
      ],
    ),
    batches: Object.freeze(batches),
    terminalValidations,
    relatedLinks: adminSpineRelatedLinks,
    artifactSummary: Object.freeze({
      game: String(adminSpineProof.generatedFrom?.game ?? ""),
      proofCount: proofs.length,
      batchCount: batches.length,
      terminalValidationCount: terminalValidations.length,
      recoveryStatus: String(recovery.status ?? "unknown"),
      refreshedCount: Number(recovery.refreshedCount ?? 0),
      nextCommand: String(recovery.nextCommand ?? ""),
      spineManifestInspectHref: adminAuditInspectHref({
        game,
        audit: localAdminAuditIds.spineManifest,
      }),
      ...(terminalNextActionHandoffPair === null
        ? {}
        : { nextActionHandoffPair: terminalNextActionHandoffPair }),
      ...Object.fromEntries(
        adminRouteTerminalReceiptContracts.flatMap((contract) => {
          const receipt = terminalReceiptsByKey[contract.terminalBatchesKey];
          return receipt === null
            ? []
            : [[contract.terminalBatchesKey, receipt]];
        }),
      ),
      releaseReady: adminSpineProof.releaseReady === true,
      productionReady: adminSpineProof.productionReady === true,
    }),
    artifactSummarySections: terminalReceiptSummarySections(
      terminalReceiptsByKey,
      { game },
    ),
  });
}

function normalizeAdminSpineTerminalReceipts(terminalBatchProof) {
  if (!validAdminSpineTerminalBatchProof(terminalBatchProof)) {
    return Object.freeze(
      Object.fromEntries(
        terminalReceiptContractRegistry.map((contract) => [
          contract.terminalBatchesKey,
          null,
        ]),
      ),
    );
  }
  return Object.freeze(
    Object.fromEntries(
      terminalReceiptContractRegistry.map((contract) => [
        contract.terminalBatchesKey,
        normalizeAdminSpineTerminalReceipt({
          contract,
          receipt: terminalBatchProof[contract.terminalBatchesKey],
        }),
      ]),
    ),
  );
}

function normalizeAdminSpineTerminalReceipt({ contract, receipt }) {
  return typeof contract.normalizeReceipt === "function"
    ? contract.normalizeReceipt(receipt)
    : null;
}

function validAdminSpineTerminalBatchProof(proof) {
  return (
    proof !== null &&
    typeof proof === "object" &&
    proof.version === 1 &&
    proof.proof === "dev-test-game-admin-spine-terminal-batches" &&
    proof.status === "passed" &&
    proof.scope === "local-dev-test-game-admin-spine-terminal-batches" &&
    proof.releaseReady === false &&
    proof.productionReady === false &&
    Array.isArray(proof.batches)
  );
}

function normalizeAdminSpineTerminalValidations(validations) {
  return Object.freeze(
    (Array.isArray(validations) ? validations : []).map((validation, index) =>
      normalizeAdminSpineTerminalValidation(validation, index),
    ),
  );
}

function normalizeAdminSpineTerminalValidation(validation, index) {
  const id = String(validation?.id ?? `terminal-validation-${index + 1}`);
  return Object.freeze({
    id,
    label: String(validation?.label ?? id),
    status: String(validation?.status ?? "unknown"),
    proof: String(validation?.proof ?? ""),
    command: String(validation?.command ?? ""),
    artifactPath: String(validation?.artifactPath ?? ""),
    validatesArtifacts: Object.freeze(
      Array.isArray(validation?.validatesArtifacts)
        ? validation.validatesArtifacts.map((artifactPath) =>
            String(artifactPath),
          )
        : [],
    ),
    localDiagnosticCount: Number(validation?.localDiagnosticCount ?? 0),
    releaseReady: validation?.releaseReady === true,
    productionReady: validation?.productionReady === true,
  });
}

function normalizeAdminSpineBatch(batch, index) {
  const label = String(batch?.label ?? `Admin spine batch ${index + 1}`);
  return Object.freeze({
    id: adminSpineBatchId(label, index),
    label,
    reason: String(batch?.reason ?? ""),
    status: String(batch?.status ?? "unknown"),
    caseCount: Number(batch?.caseCount ?? 0),
    elapsedMs: Number(batch?.elapsedMs ?? 0),
    sharedFrontendSession: batch?.sharedFrontendSession === true,
    sharedChromiumSession: batch?.sharedChromiumSession === true,
    caseSmokeNames: Object.freeze(
      Array.isArray(batch?.caseSmokeNames)
        ? batch.caseSmokeNames.map((name) => String(name))
        : [],
    ),
    proofIds: Object.freeze(
      Array.isArray(batch?.proofIds) ? batch.proofIds.map((id) => String(id)) : [],
    ),
    artifactPaths: Object.freeze(
      Array.isArray(batch?.artifactPaths)
        ? batch.artifactPaths.map((artifactPath) => String(artifactPath))
        : [],
    ),
  });
}

function normalizeAdminSpineNextActionHandoffPair(pair) {
  if (pair === null || typeof pair !== "object") {
    return null;
  }
  const defaultSequenceBlocker = normalizeAdminSpineNextActionHandoffPairSide(
    pair.defaultSequenceBlocker,
  );
  const hostedIdentityPredicate = normalizeAdminSpineNextActionHandoffPairSide(
    pair.hostedIdentityPredicate,
  );
  if (defaultSequenceBlocker === null || hostedIdentityPredicate === null) {
    return null;
  }
  return Object.freeze({
    id: String(pair.id ?? ""),
    status: String(pair.status ?? "unknown"),
    proofBoundary: String(pair.proofBoundary ?? ""),
    defaultSequenceBlocker,
    hostedIdentityPredicate,
  });
}

function normalizeAdminSpineNextActionHandoffPairSide(side) {
  if (side === null || typeof side !== "object") {
    return null;
  }
  return Object.freeze({
    id: String(side.id ?? ""),
    label: String(side.label ?? ""),
    status: String(side.status ?? "unknown"),
    proofId: String(side.proofId ?? ""),
    nextActionPath: String(side.nextActionPath ?? ""),
    adminProofPath: String(side.adminProofPath ?? ""),
    batchLabel: String(side.batchLabel ?? ""),
    expectedReason: String(side.expectedReason ?? ""),
    expectedActionStatus: String(side.expectedActionStatus ?? ""),
  });
}

function adminSpineBatchId(label, index) {
  const normalized = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized === "" ? `admin-spine-batch-${index + 1}` : normalized;
}

export function appendLocalSeedFixtureAudit(audit, seedFixtureSummary, { game }) {
  const row = normalizeLocalSeedFixtureAudit(seedFixtureSummary, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalSeedFixtureAudit(seedFixtureSummary, { game }) {
  if (
    seedFixtureSummary === null ||
    typeof seedFixtureSummary !== "object" ||
    seedFixtureSummary.version !== 1 ||
    seedFixtureSummary.proof !== "dev-test-game-seed-fixture-summary" ||
    seedFixtureSummary.status !== "passed"
  ) {
    return null;
  }
  const scenarios = Array.isArray(seedFixtureSummary.demoScenarios)
    ? seedFixtureSummary.demoScenarios
    : [];
  const localScenarios = scenarios.filter(
    (scenario) => scenario?.status === "available_locally",
  );
  const proofLaneCoverage = normalizeProofLaneCoverage(
    seedFixtureSummary.proofLaneCoverage,
  );
  return Object.freeze({
    id: localAdminAuditIds.seedFixtures,
    label: "Local seed fixtures",
    status: `${localScenarios.length} demo scenarios available locally`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local seed/demo fixture inventory",
    boundaryDetail:
      seedFixtureSummary.proofBoundary ??
      "Local seed/demo fixture summary without hosted demo-data claims.",
    href: devTestGameSeedFixturePath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.seedFixtures }),
    scenarios: Object.freeze(
      scenarios.map((scenario) =>
        Object.freeze({
          id: String(scenario.id),
          title: String(scenario.title ?? scenario.id),
          status: String(scenario.status),
          role: String(scenario.role ?? ""),
        }),
      ),
    ),
    proofLaneCoverage,
    artifactSummary: Object.freeze({
      game: String(seedFixtureSummary.fixture?.game ?? ""),
      scenarioCount: scenarios.length,
      roleCount: Number(seedFixtureSummary.fixture?.roleCount ?? 0),
      slotCount: Number(seedFixtureSummary.fixture?.slots?.length ?? 0),
      proofLaneCount: Number(
        seedFixtureSummary.proofLaneCoverage?.passedLaneCount ?? 0,
      ),
      directSeededProofLaneCount: Number(
        seedFixtureSummary.proofLaneCoverage?.directSeeded?.count ?? 0,
      ),
      aliasOnlyProofLaneCount: Number(
        seedFixtureSummary.proofLaneCoverage?.aliasOnly?.count ?? 0,
      ),
      aggregateOnlyProofLaneCount: Number(
        seedFixtureSummary.proofLaneCoverage?.aggregateOnly?.count ?? 0,
      ),
      unclassifiedProofLaneCount: Number(
        seedFixtureSummary.proofLaneCoverage?.unclassified?.count ?? 0,
      ),
      releaseReady: seedFixtureSummary.releaseReady === true,
      productionReady: seedFixtureSummary.productionReady === true,
    }),
  });
}

function normalizeProofLaneCoverage(coverage) {
  if (coverage === null || typeof coverage !== "object") {
    return Object.freeze([]);
  }
  return Object.freeze(
    [
      ["direct-seeded", "Direct seeded proof lanes", coverage.directSeeded],
      ["alias-only", "Alias-only proof lanes", coverage.aliasOnly],
      ["aggregate-only", "Aggregate-only proof lanes", coverage.aggregateOnly],
      ["unclassified", "Unclassified proof lanes", coverage.unclassified],
    ].map(([id, label, entry]) =>
      Object.freeze({
        id,
        label,
        status: `${Number(entry?.count ?? 0)} lanes`,
        count: Number(entry?.count ?? 0),
        laneIds: Object.freeze(
          Array.isArray(entry?.laneIds)
            ? entry.laneIds.map((laneId) => String(laneId))
            : [],
        ),
      }),
    ),
  );
}

export function appendLocalReleaseReadinessAudit(
  audit,
  releaseReadinessChecklist,
  { game, nextAction = null },
) {
  const row = normalizeLocalReleaseReadinessAudit(releaseReadinessChecklist, {
    game,
    nextAction,
  });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalHostSetupProofAudit(
  audit,
  releaseReadinessChecklist,
  { game },
) {
  const row = normalizeLocalHostSetupProofAudit(releaseReadinessChecklist, {
    game,
  });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalReleaseReadinessAudit(
  releaseReadinessChecklist,
  { game, nextAction = null },
) {
  if (
    releaseReadinessChecklist === null ||
    typeof releaseReadinessChecklist !== "object" ||
    releaseReadinessChecklist.version !== 1 ||
    releaseReadinessChecklist.proof !== "dev-test-game-release-readiness" ||
    releaseReadinessChecklist.status !== "passed" ||
    releaseReadinessChecklist.releaseReady !== false ||
    releaseReadinessChecklist.productionReady !== false ||
    releaseReadinessChecklist.releaseReadiness?.status !== "not_ready"
  ) {
    return null;
  }
  const checks = Array.isArray(releaseReadinessChecklist.localDevelopmentSpine?.checks)
    ? releaseReadinessChecklist.localDevelopmentSpine.checks
    : [];
  const localPrerequisites = checks.filter(
    (check) => check?.dependencyGated === true,
  );
  const coverageSummary = localReleaseReadinessCoverageSummary(checks);
  const unproven = Array.isArray(releaseReadinessChecklist.releaseReadiness?.unproven)
    ? releaseReadinessChecklist.releaseReadiness.unproven
    : [];
  const diagnostics = normalizeLocalReleaseReadinessDiagnostics(
    releaseReadinessChecklist.localDevelopmentSpine?.diagnostics,
  );
  const roleUrlProductionFeatureAuditSummary =
    normalizeRoleUrlProductionFeatureAuditSummary(
      releaseReadinessChecklist.readinessSummary
        ?.roleUrlProductionFeatureAuditSummary,
    );
  const nextActionRow = normalizeLocalNextActionAudit(nextAction, { game });
  const selectedOperatorHandoff = nextActionRow?.selectedOperatorHandoff ?? null;
  const hostSetupProofEvidence =
    releaseReadinessChecklist.localDevelopmentSpine?.evidence?.hostSetupProof;
  const setupCommandEvidence = normalizeSetupCommandEvidenceRows(
    hostSetupProofEvidence?.setupCommandEvidence,
  );
  const statusPrefix =
    coverageSummary.driftCount === 0
      ? `${checks.length} local checks passed`
      : `coverage drift detected in ${coverageSummary.driftCount}/${coverageSummary.coverageCheckCount} groups`;
  return Object.freeze({
    id: localAdminAuditIds.releaseReadiness,
    label: "Local release readiness",
    status: `${statusPrefix}, ${unproven.length} release items unproven`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local release-readiness checklist",
    boundaryDetail:
      releaseReadinessChecklist.proofBoundary ??
      "Local dev-test-game release-readiness checklist without beta or production claims.",
    href: localProofArtifactHref({
      game,
      artifact: devTestGameReleaseReadinessPath,
    }),
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.releaseReadiness,
    }),
    checks: Object.freeze(
      [
        ...checks.flatMap((check) => [
          Object.freeze({
            id: String(check.id),
            status: localReleaseReadinessCheckStatus(check),
            dependencyGated: check.dependencyGated === true,
            laneIds: Object.freeze(
              Array.isArray(check.laneIds)
                ? check.laneIds.map((laneId) => String(laneId))
                : [],
            ),
            requiredLaneCount: Number(check.requiredLaneCount ?? 0),
            coveredLaneCount: Number(check.coveredLaneCount ?? 0),
            familyCount: Number(check.familyCount ?? 0),
            expectedLaneCount: Number(check.expectedLaneCount ?? 0),
            expectedFamilyCount: Number(check.expectedFamilyCount ?? 0),
          }),
          ...normalizedEvidenceObjectCheckRows({
            parentId: String(check.id),
            objects: check.normalizedEvidenceObjects,
          }),
        ]),
        ...(selectedOperatorHandoff === null
          ? []
          : [
              Object.freeze({
                id: "selected-operator-handoff",
                status: `${selectedOperatorHandoff.status}:${selectedOperatorHandoff.firstMissingInputId}`,
              }),
            ]),
      ],
    ),
    relatedLinks: Object.freeze(
      selectedOperatorHandoff === null
        ? []
        : [
            Object.freeze({
              id: "selected-operator-handoff",
              label: "Selected operator handoff",
              href: nextActionRow.inspectHref,
              status: `${selectedOperatorHandoff.status}:${selectedOperatorHandoff.firstMissingInputId}`,
              command: selectedOperatorHandoff.command,
            }),
          ],
    ),
    localPrerequisites: Object.freeze(
      localPrerequisites.map((check) =>
        Object.freeze({
          id: String(check.id),
          label: String(check.label ?? check.id ?? ""),
          status: String(check.status),
          evidence: String(check.evidence ?? ""),
          command: String(check.recovery?.command ?? ""),
          proofTarget: String(check.recovery?.proofTarget ?? ""),
          roleUrl: String(check.recovery?.roleUrl ?? ""),
          requiredEvidence: String(check.recovery?.requiredEvidence ?? ""),
          proofBoundary: String(check.recovery?.proofBoundary ?? ""),
        }),
      ),
    ),
    diagnostics,
    unproven: Object.freeze(
      unproven.map((item) =>
        Object.freeze({
          id: String(item.id),
          status: String(item.status),
          requiredEvidence: String(item.requiredEvidence ?? ""),
        }),
      ),
    ),
    setupCommandEvidence,
    setupCommandEvidenceRows:
      buildSetupCommandEvidenceRows(setupCommandEvidence),
    artifactSummary: Object.freeze({
      game: String(releaseReadinessChecklist.generatedFrom?.game ?? ""),
      localCheckCount: checks.length,
      coverageCheckCount: coverageSummary.coverageCheckCount,
      coverageDriftCount: coverageSummary.driftCount,
      coverageStatus: coverageSummary.status,
      localPrerequisiteCount: localPrerequisites.length,
      diagnosticCount: diagnostics.length,
      unprovenCount: unproven.length,
      ...(roleUrlProductionFeatureAuditSummary === null
        ? {}
        : { roleUrlProductionFeatureAuditSummary }),
      ...(selectedOperatorHandoff === null
        ? {}
        : {
            selectedOperatorHandoffFirstMissingInputId:
              selectedOperatorHandoff.firstMissingInputId,
            selectedOperatorHandoffRoleUrl:
              selectedOperatorHandoff.selectedProductionFeatureRoleUrl,
          }),
      releaseReady: releaseReadinessChecklist.releaseReady === true,
      productionReady: releaseReadinessChecklist.productionReady === true,
    }),
    artifactSummarySections:
      buildLocalReleaseReadinessSummarySections({
        diagnostics,
        roleUrlProductionFeatureAuditSummary,
      }),
  });
}

function normalizeRoleUrlProductionFeatureAuditSummary(summary) {
  if (summary === null || typeof summary !== "object") {
    return null;
  }
  return Object.freeze({
    status: String(summary.status ?? "unknown"),
    passedRoleUrlLaneCount: Number(summary.passedRoleUrlLaneCount ?? 0),
    productionFeatureLaneCount: Number(summary.productionFeatureLaneCount ?? 0),
    directProductionFeatureLaneCount: Number(
      summary.directProductionFeatureLaneCount ?? 0,
    ),
    aliasOnlyLaneCount: Number(summary.aliasOnlyLaneCount ?? 0),
    aggregateOnlyLaneCount: Number(summary.aggregateOnlyLaneCount ?? 0),
    unclassifiedLaneCount: Number(summary.unclassifiedLaneCount ?? 0),
  });
}

function normalizeLocalReleaseReadinessDiagnostics(diagnostics) {
  return Object.freeze(
    (Array.isArray(diagnostics) ? diagnostics : []).map((diagnostic) =>
      Object.freeze({
        id: String(diagnostic?.id ?? ""),
        label: String(diagnostic?.label ?? diagnostic?.id ?? ""),
        status: String(diagnostic?.status ?? "unknown"),
        kind: String(diagnostic?.kind ?? ""),
        sourceCheckId: String(diagnostic?.sourceCheckId ?? ""),
        evidence: String(diagnostic?.evidence ?? ""),
        command: String(diagnostic?.command ?? ""),
        roleUrl: String(diagnostic?.roleUrl ?? ""),
        reason: String(diagnostic?.reason ?? ""),
      }),
    ),
  );
}

function buildLocalReleaseReadinessSummarySections({
  diagnostics,
  roleUrlProductionFeatureAuditSummary,
}) {
  return Object.freeze([
    ...(roleUrlProductionFeatureAuditSummary === null
      ? []
      : [
          buildArtifactSummarySection({
            id: "role-url-production-feature-audit",
            heading: "Role URL production feature audit",
            rows: [
              {
                id: "summary",
                testId: "admin-audit-role-url-production-feature-audit-summary",
                values: [
                  {
                    id: "status",
                    text: roleUrlProductionFeatureAuditSummary.status,
                    emphasized: true,
                  },
                  {
                    id: "passedRoleUrlLaneCount",
                    text: `${roleUrlProductionFeatureAuditSummary.passedRoleUrlLaneCount} passed role URL lanes`,
                  },
                  {
                    id: "productionFeatureLaneCount",
                    text: `${roleUrlProductionFeatureAuditSummary.productionFeatureLaneCount} production feature lanes`,
                  },
                  {
                    id: "directProductionFeatureLaneCount",
                    text: `${roleUrlProductionFeatureAuditSummary.directProductionFeatureLaneCount} direct`,
                  },
                  {
                    id: "aliasOnlyLaneCount",
                    text: `${roleUrlProductionFeatureAuditSummary.aliasOnlyLaneCount} alias`,
                  },
                  {
                    id: "aggregateOnlyLaneCount",
                    text: `${roleUrlProductionFeatureAuditSummary.aggregateOnlyLaneCount} aggregate`,
                  },
                  {
                    id: "unclassifiedLaneCount",
                    text: `${roleUrlProductionFeatureAuditSummary.unclassifiedLaneCount} unclassified`,
                  },
                ],
              },
            ],
          }),
        ]),
    ...(diagnostics.length === 0
      ? []
      : [
          buildArtifactSummarySection({
            id: "local-release-readiness-diagnostics",
            heading: "Diagnostics, Not Gates",
            rows: diagnostics.map((diagnostic) => ({
              id: diagnostic.id,
              testId: `admin-audit-local-diagnostic-${diagnostic.id}`,
              values: [
                { id: "label", text: diagnostic.label, emphasized: true },
                { id: "status", text: diagnostic.status },
                { id: "kind", text: diagnostic.kind },
                { id: "sourceCheckId", text: diagnostic.sourceCheckId },
                { id: "evidence", text: diagnostic.evidence },
                { id: "command", text: diagnostic.command },
                ...optionalTextValue("roleUrl", diagnostic.roleUrl),
                { id: "reason", text: diagnostic.reason },
              ],
            })),
          }),
        ]),
  ]);
}

export function normalizeLocalHostSetupProofAudit(
  releaseReadinessChecklist,
  { game },
) {
  if (
    normalizeLocalReleaseReadinessAudit(releaseReadinessChecklist, { game }) ===
    null
  ) {
    return null;
  }
  const checks = Array.isArray(releaseReadinessChecklist.localDevelopmentSpine?.checks)
    ? releaseReadinessChecklist.localDevelopmentSpine.checks
    : [];
  const hostSetupCheck = checks.find(
    (check) => check?.id === localAdminAuditIds.hostSetupProof,
  );
  const hostSetupProofEvidence =
    releaseReadinessChecklist.localDevelopmentSpine?.evidence?.hostSetupProof;
  const setupCommandEvidence = normalizeSetupCommandEvidenceRows(
    hostSetupProofEvidence?.setupCommandEvidence,
  );
  if (
    hostSetupProofEvidence === null ||
    typeof hostSetupProofEvidence !== "object" ||
    setupCommandEvidence.length === 0
  ) {
    return null;
  }
  const readyCheckIds = Object.freeze(
    (Array.isArray(hostSetupProofEvidence.readyCheckIds)
      ? hostSetupProofEvidence.readyCheckIds
      : Array.isArray(hostSetupCheck?.readyCheckIds)
        ? hostSetupCheck.readyCheckIds
        : []
    ).map((readyCheckId) => String(readyCheckId)),
  );
  const hostSetupProofPath = String(
    releaseReadinessChecklist.generatedFrom?.hostSetupProof ??
      hostSetupProofEvidence.path ??
      hostSetupCheck?.evidence ??
      "target/dev-test-game/host-setup-proof.json",
  );
  return Object.freeze({
    id: localAdminAuditIds.hostSetupProof,
    label: "Local host setup proof",
    status: `${setupCommandEvidence.length} setup commands proven, ${readyCheckIds.length} ready checks covered`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local host setup role proof",
    boundaryDetail:
      hostSetupProofEvidence.proofBoundary ??
      hostSetupCheck?.proofBoundary ??
      "Local host setup role URL, setup command, and recovery proof without hosted or release claims.",
    href: hostSetupProofPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.hostSetupProof,
    }),
    checks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.hostSetupProof,
        status: localReleaseReadinessCheckStatus(hostSetupCheck),
        dependencyGated: hostSetupCheck?.dependencyGated === true,
        laneIds: Object.freeze(
          Array.isArray(hostSetupCheck?.laneIds)
            ? hostSetupCheck.laneIds.map((laneId) => String(laneId))
            : [],
        ),
        requiredLaneCount: Number(hostSetupCheck?.requiredLaneCount ?? 0),
        coveredLaneCount: Number(hostSetupCheck?.coveredLaneCount ?? 0),
        familyCount: Number(hostSetupCheck?.familyCount ?? 0),
        expectedLaneCount: Number(hostSetupCheck?.expectedLaneCount ?? 0),
        expectedFamilyCount: Number(hostSetupCheck?.expectedFamilyCount ?? 0),
      }),
      ...readyCheckIds.map((readyCheckId) =>
        Object.freeze({
          id: `ready-check:${readyCheckId}`,
          status: "covered by host setup proof",
          dependencyGated: false,
          laneIds: Object.freeze([]),
          requiredLaneCount: 0,
          coveredLaneCount: 0,
          familyCount: 0,
          expectedLaneCount: 0,
          expectedFamilyCount: 0,
        }),
      ),
    ]),
    setupCommandEvidence,
    setupCommandEvidenceRows:
      buildSetupCommandEvidenceRows(setupCommandEvidence),
    artifactSummary: Object.freeze({
      game: String(
        hostSetupProofEvidence.game ??
          releaseReadinessChecklist.generatedFrom?.game ??
          "",
      ),
      hostSetupProof: hostSetupProofPath,
      roleUrl: String(hostSetupProofEvidence.roleUrl ?? hostSetupCheck?.roleUrl ?? ""),
      capabilityLabel: String(hostSetupProofEvidence.capabilityLabel ?? ""),
      readyCheckCount: readyCheckIds.length,
      setupCommandEvidenceCount: setupCommandEvidence.length,
      policyCommandStatus: String(hostSetupProofEvidence.policyCommandStatus ?? ""),
      setupMutationStatus: String(
        hostSetupProofEvidence.setupMutationStatus ?? "",
      ),
      releaseReady: hostSetupProofEvidence.releaseReady === true,
      productionReady: hostSetupProofEvidence.productionReady === true,
    }),
  });
}

function normalizeSetupCommandEvidenceRows(evidence) {
  if (evidence === null || typeof evidence !== "object") {
    return Object.freeze([]);
  }
  return Object.freeze(
    SETUP_COMMAND_EVIDENCE_KEYS.map((id) => {
      const row = evidence[id];
      if (row === null || typeof row !== "object") {
        return null;
      }
      return Object.freeze({
        id,
        status: String(row.status ?? "unknown"),
        commandKind: String(row.commandKind ?? ""),
        readinessSummary: String(row.readinessSummary ?? ""),
      });
    }).filter((row) => row !== null),
  );
}

function localReleaseReadinessCoverageSummary(checks) {
  const coverageChecks = checks.filter((check) => {
    const laneIds = Array.isArray(check?.laneIds) ? check.laneIds : [];
    return laneIds.length > 0;
  });
  const driftCount = coverageChecks.filter((check) =>
    localReleaseReadinessCheckStatus(check).startsWith("drift:"),
  ).length;
  return Object.freeze({
    status: driftCount === 0 ? "coherent" : "drift",
    coverageCheckCount: coverageChecks.length,
    driftCount,
  });
}

function localReleaseReadinessCheckStatus(check) {
  const status = String(check?.status ?? "unknown");
  const laneIds = Array.isArray(check?.laneIds) ? check.laneIds : [];
  const coveredLaneCount = Number(check?.coveredLaneCount ?? 0);
  const requiredLaneCount = Number(check?.requiredLaneCount ?? laneIds.length);
  const familyCount = Number(check?.familyCount ?? 0);
  const expectedLaneCount = Number(check?.expectedLaneCount);
  const expectedFamilyCount = Number(check?.expectedFamilyCount);
  const hasCoverageCounts =
    laneIds.length > 0 &&
    Number.isFinite(coveredLaneCount) &&
    Number.isFinite(requiredLaneCount) &&
    Number.isFinite(familyCount) &&
    Number.isFinite(expectedLaneCount) &&
    Number.isFinite(expectedFamilyCount);
  if (!hasCoverageCounts) {
    return status;
  }
  const summary = `${status}: ${coveredLaneCount}/${requiredLaneCount} lanes across ${familyCount}/${expectedFamilyCount} shared families`;
  if (
    requiredLaneCount !== expectedLaneCount ||
    laneIds.length !== expectedLaneCount ||
    familyCount !== expectedFamilyCount
  ) {
    return `drift: ${summary}; expected ${expectedLaneCount} shared lanes`;
  }
  return summary;
}

export function appendLocalReleaseRunbookAudit(audit, releaseRunbook, { game }) {
  const row = normalizeLocalReleaseRunbookAudit(releaseRunbook, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalReleaseRunbookAudit(releaseRunbook, { game }) {
  if (
    releaseRunbook === null ||
    typeof releaseRunbook !== "object" ||
    releaseRunbook.version !== 1 ||
    releaseRunbook.proof !== "dev-test-game-release-runbook" ||
    releaseRunbook.status !== "passed" ||
    releaseRunbook.scope !== "local-dev-test-game-release-runbook-rehearsal" ||
    releaseRunbook.releaseReady !== false ||
    releaseRunbook.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(releaseRunbook.checks) ? releaseRunbook.checks : [];
  const runbookItems = Array.isArray(releaseRunbook.runbookItems)
    ? releaseRunbook.runbookItems
    : [];
  const passedChecks = checks.filter((check) => check?.status === "passed");
  return Object.freeze({
    id: localAdminAuditIds.releaseRunbook,
    label: "Local release runbook",
    status: `${passedChecks.length} runbook checks passed, ${runbookItems.length} gaps rehearsed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local release-runbook rehearsal",
    boundaryDetail:
      releaseRunbook.proofBoundary ??
      "Local release-runbook rehearsal without human approval or release claims.",
    href: devTestGameReleaseRunbookPath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.releaseRunbook }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
        }),
      ),
    ),
    unproven: Object.freeze(
      runbookItems.map((item) =>
        Object.freeze({
          id: String(item.id),
          status: String(item.status),
          requiredEvidence: String(item.requiredEvidence ?? ""),
          command: String(item.command ?? ""),
          proofTarget: String(item.proofTarget ?? ""),
          roleUrl: String(item.roleUrl ?? ""),
        }),
      ),
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.releaseReadiness,
        label: "Release readiness",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.releaseReadiness }),
        status: "not_ready",
        command: "test:dev-test-game-readiness",
      }),
    ]),
    artifactSummary: Object.freeze({
      game: String(releaseRunbook.generatedFrom?.game ?? ""),
      runbookItemCount: runbookItems.length,
      rollbackStatus: String(releaseRunbook.rollbackPath?.status ?? "unknown"),
      supportStatus: String(releaseRunbook.supportPath?.status ?? "unknown"),
      nextBuildCommand: String(releaseRunbook.nextBuildSlice?.command ?? ""),
      nextBuildProofTarget: String(
        releaseRunbook.nextBuildSlice?.proofTarget ?? "",
      ),
      nextBuildRoleUrl: String(releaseRunbook.nextBuildSlice?.roleUrl ?? ""),
      nextBuildOwner: String(releaseRunbook.nextBuildSlice?.owner ?? ""),
      nextBuildUnprovenId: String(
        releaseRunbook.nextBuildSlice?.unprovenId ?? "",
      ),
      releaseReady: releaseRunbook.releaseReady === true,
      productionReady: releaseRunbook.productionReady === true,
    }),
  });
}

export function appendLocalCoreLoopAudit(audit, proofRun, { game }) {
  const row = normalizeLocalCoreLoopAudit(proofRun, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalCoreLoopAudit(proofRun, { game }) {
  if (
    proofRun === null ||
    typeof proofRun !== "object" ||
    proofRun.version !== 1 ||
    proofRun.proof !== "dev-test-game-proof-run" ||
    proofRun.status !== "passed" ||
    proofRun.scope !== "local-dev-test-game-harness" ||
    proofRun.releaseReady !== false ||
    proofRun.productionReady !== false
  ) {
    return null;
  }
  const requiredLaneIds = coreLoopAuditLaneIds;
  const lanes = Array.isArray(proofRun.lanes) ? proofRun.lanes : [];
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  if (
    requiredLaneIds.some((id) => laneById.get(id)?.status !== "passed") ||
    proofRun.session?.verificationStatus !== "passed"
  ) {
    return null;
  }
  return Object.freeze({
    id: localAdminAuditIds.coreLoop,
    label: "Local core loop",
    status: `${requiredLaneIds.length} core loop lanes passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local core-loop proof",
    boundaryDetail:
      proofRun.proofBoundary ??
      "Local dev-test-game proof-run core loop lanes without hosted release claims.",
    href: proofRun.artifacts?.proofRun ?? devTestGameProofRunPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.coreLoop,
    }),
    checks: Object.freeze(
      [
        Object.freeze({
          id: "core-loop-spine",
          status: coreLoopSpineStatus(proofRun),
        }),
        Object.freeze({
          id: coreLoopCompletedGameCoverageCheckId,
          status: completedGameHardeningCoverageStatus(proofRun),
        }),
        ...requiredLaneIds.map((id) => {
          const lane = laneById.get(id);
          return Object.freeze({
            id,
            status: coreLoopLaneStatus(lane),
          });
        }),
      ],
    ),
    spineCycles: normalizeCoreLoopSpineCycles(proofRun),
    spineRecoveryHooks: normalizeCoreLoopSpineRecoveryHooks(proofRun),
    scenarioFamilies: coreLoopScenarioFamilyRows(),
    commandProofRoleUrlAudit: coreLoopCommandProofRoleUrlAuditExpectation,
    hostVisibleRecoveries: buildHostVisibleRecoverySummaries({
      proofRun,
      detailRoleUrl: adminAuditInspectHref({
        game,
        audit: localAdminAuditIds.coreLoop,
      }),
    }),
    hostVisibleInvalidActionRecovery:
      buildHostVisibleInvalidActionRecoverySummary({
        proofRun,
        detailRoleUrl: adminAuditInspectHref({
          game,
          audit: localAdminAuditIds.coreLoop,
        }),
      }),
    hostVisibleStaleTransitionRecoveries:
      buildHostVisibleStaleTransitionRecoverySummaries({
        proofRun,
        detailRoleUrl: adminAuditInspectHref({
          game,
          audit: localAdminAuditIds.coreLoop,
        }),
      }),
    artifactSummary: Object.freeze({
      game: String(proofRun.session?.game ?? ""),
      roleCount: Array.isArray(proofRun.session?.roles)
        ? proofRun.session.roles.length
        : 0,
      laneCount: lanes.length,
      completedGameCoverageStatus: String(
        proofRun.completedGameHardeningCoverage?.status ?? "unknown",
      ),
      completedGameCoverageLaneCount: Number(
        proofRun.completedGameHardeningCoverage?.laneCount ?? 0,
      ),
      completedGameCoverageFamilyCount: Number(
        proofRun.completedGameHardeningCoverage?.familyCount ?? 0,
      ),
      releaseReady: proofRun.releaseReady === true,
      productionReady: proofRun.productionReady === true,
    }),
  });
}

function completedGameHardeningCoverageStatus(proofRun) {
  const coverage = proofRun?.completedGameHardeningCoverage;
  const status = String(coverage?.status ?? "unknown");
  const passedLaneCount = Number(coverage?.passedLaneCount ?? 0);
  const laneCount = Number(coverage?.laneCount ?? 0);
  const familyCount = Number(coverage?.familyCount ?? 0);
  const artifactExpectedLaneCount = Number(coverage?.expectedLaneCount);
  const artifactExpectedFamilyCount = Number(coverage?.expectedFamilyCount);
  const sharedExpectedLaneCount = COMPLETED_GAME_HARDENING_LANE_CASES.length;
  const sharedExpectedFamilyCount = COMPLETED_GAME_HARDENING_FAMILY_IDS.length;
  if (
    laneCount !== artifactExpectedLaneCount ||
    familyCount !== artifactExpectedFamilyCount ||
    artifactExpectedLaneCount !== sharedExpectedLaneCount ||
    artifactExpectedFamilyCount !== sharedExpectedFamilyCount
  ) {
    return `drift: ${status} artifact reports ${passedLaneCount}/${laneCount} completed-game lanes across ${familyCount} families; expected ${sharedExpectedLaneCount} lanes across ${sharedExpectedFamilyCount} shared families`;
  }
  return `${status}: ${passedLaneCount}/${laneCount} completed-game lanes across ${familyCount} families`;
}

function normalizeCoreLoopSpineCycles(proofRun) {
  const cycles = Array.isArray(proofRun?.coreLoopSpine?.cycles)
    ? proofRun.coreLoopSpine.cycles
    : [];
  const normalized = cycles.map((cycle) => {
      const roleUrls =
        cycle?.roleUrls !== null && typeof cycle?.roleUrls === "object"
          ? cycle.roleUrls
          : {};
      const checkpoints = Array.isArray(cycle?.checkpoints)
        ? cycle.checkpoints
        : [];
      return Object.freeze({
        id: String(cycle?.id ?? ""),
        label: formatSpineLabel(cycle?.id),
        game: String(cycle?.game ?? ""),
        status: `${checkpoints.length} checkpoints`,
        roleUrls: Object.freeze(
          Object.entries(roleUrls).map(([id, href]) =>
            Object.freeze({
              id: String(id),
              label: formatSpineLabel(id),
              href: String(href ?? ""),
            }),
          ),
        ),
        checkpoints: Object.freeze(
          checkpoints.map((checkpoint) =>
            Object.freeze({
              id: String(checkpoint?.id ?? ""),
              label: formatSpineLabel(checkpoint?.id),
              status: formatCoreLoopSpineCheckpointStatus(checkpoint),
            }),
          ),
        ),
      });
    });
  const earliestReached = proofRun?.earliestReachedTie;
  if (
    earliestReached?.status === "passed" &&
    typeof earliestReached?.sourceRoleUrls?.host === "string"
  ) {
    normalized.push(
      Object.freeze({
        id: "earliest-reached",
        label: "Earliest reached",
        game: String(earliestReached.game ?? ""),
        status: "1 checkpoint",
        roleUrls: Object.freeze([
          Object.freeze({
            id: "host",
            label: "Host",
            href: String(earliestReached.sourceRoleUrls.host),
          }),
        ]),
        checkpoints: Object.freeze([
          Object.freeze({
            id: "d01-tie-resolved",
            label: "D01 tie resolved",
            status: [
              `winner ${String(earliestReached.outcome?.winner_slot ?? "unknown")}`,
              `tiebreak ${String(earliestReached.outcome?.tiebreak ?? "unknown")}`,
            ].join(", "),
          }),
        ]),
      }),
    );
  }
  return Object.freeze(normalized);
}

function normalizeCoreLoopSpineRecoveryHooks(proofRun) {
  const recoveryHooks =
    proofRun?.coreLoopSpine?.recoveryHooks !== null &&
    typeof proofRun?.coreLoopSpine?.recoveryHooks === "object"
      ? proofRun.coreLoopSpine.recoveryHooks
      : {};
  return Object.freeze(
    Object.entries(recoveryHooks).map(([id, status]) =>
      Object.freeze({
        id: String(id),
        label: formatSpineLabel(id),
        status: String(status ?? "unknown"),
      }),
    ),
  );
}

function formatCoreLoopSpineCheckpointStatus(checkpoint) {
  const parts = [];
  pushField(parts, "phase", checkpoint?.phase);
  if (typeof checkpoint?.locked === "boolean") {
    parts.push(checkpoint.locked ? "locked" : "open");
  }
  pushField(parts, "resolve", checkpoint?.resolveState);
  pushField(parts, "advance", checkpoint?.advanceState);
  pushField(parts, "reject", checkpoint?.rejectError);
  pushField(parts, "prompt", checkpoint?.promptId);
  pushField(parts, "stale action", checkpoint?.staleActionId);
  pushField(parts, "setup", checkpoint?.setupPromptStatus);
  pushField(parts, "prompt status", checkpoint?.promptStatusAfter);
  pushField(parts, "original prompt status", checkpoint?.originalPromptStatus);
  pushField(parts, "stream seqs", checkpoint?.streamSeqCount);
  pushField(parts, "action", checkpoint?.actionTemplate);
  pushField(parts, "action", checkpoint?.actionState);
  pushField(parts, "reject state", checkpoint?.rejectState);
  pushField(parts, "reload", checkpoint?.reloadPhase);
  pushField(parts, "template", checkpoint?.templateId);
  if (typeof checkpoint?.actionButtonVisible === "boolean") {
    parts.push(`action button ${checkpoint.actionButtonVisible ? "visible" : "hidden"}`);
  }
  pushField(parts, "normal reject", checkpoint?.normalPlayerDirectReject);
  pushField(parts, "target", checkpoint?.targetSlot);
  if (typeof checkpoint?.targetAlive === "boolean") {
    parts.push(`target ${checkpoint.targetAlive ? "alive" : "dead"}`);
  }
  pushField(parts, "target status", checkpoint?.targetStatus);
  pushField(parts, "receipt", checkpoint?.receiptStatus);
  pushField(parts, "actor", checkpoint?.actorSlot);
  pushField(parts, "vote target", checkpoint?.voteTarget);
  pushField(parts, "vote", checkpoint?.voteState);
  pushField(parts, "current vote", checkpoint?.currentVoteKind);
  pushField(parts, "outcome", checkpoint?.outcomeStatus);
  pushField(parts, "winner", checkpoint?.winnerSlot);
  pushField(parts, "count", checkpoint?.projectedCount);
  pushField(parts, "api phase", checkpoint?.apiPhase);
  pushField(parts, "api target", checkpoint?.apiTarget);
  pushField(parts, "api count", checkpoint?.apiCount);
  pushField(parts, "stale D03 target", checkpoint?.staleD03Target);
  pushField(parts, "stale D03 count", checkpoint?.staleD03Count);
  pushField(parts, "stale D03R1 no-lynch count", checkpoint?.staleD03R1NoLynchCount);
  pushField(parts, "action vote controls", checkpoint?.actionVoteControls);
  pushField(parts, "normal vote controls", checkpoint?.normalVoteControls);
  if (typeof checkpoint?.promptActionVisible === "boolean") {
    parts.push(`prompt action ${checkpoint.promptActionVisible ? "visible" : "hidden"}`);
  }
  if (typeof checkpoint?.setupActionVisible === "boolean") {
    parts.push(`setup action ${checkpoint.setupActionVisible ? "visible" : "hidden"}`);
  }
  if (typeof checkpoint?.promptActionVisibleAfterReject === "boolean") {
    parts.push(
      `post-reject prompt action ${
        checkpoint.promptActionVisibleAfterReject ? "visible" : "hidden"
      }`,
    );
  }
  if (typeof checkpoint?.reloadLocked === "boolean") {
    parts.push(checkpoint.reloadLocked ? "reload locked" : "reload open");
  }
  if (typeof checkpoint?.reloadResolveControlVisible === "boolean") {
    parts.push(
      `reload resolve control ${
        checkpoint.reloadResolveControlVisible ? "visible" : "hidden"
      }`,
    );
  }
  if (typeof checkpoint?.reloadStaleActionVisible === "boolean") {
    parts.push(
      `reload stale action ${
        checkpoint.reloadStaleActionVisible ? "visible" : "hidden"
      }`,
    );
  }
  pushField(parts, "route", checkpoint?.routeResponseStatus);
  pushField(parts, "reject receipt", checkpoint?.rejectReceiptStatus);
  if (typeof checkpoint?.normalPlayerFactionalKillVisible === "boolean") {
    parts.push(
      `normal factional kill ${checkpoint.normalPlayerFactionalKillVisible ? "visible" : "hidden"}`,
    );
  }
  if (typeof checkpoint?.advanceControlVisible === "boolean") {
    parts.push(
      `advance control ${checkpoint.advanceControlVisible ? "visible" : "hidden"}`,
    );
  }
  if (typeof checkpoint?.unlockControlVisible === "boolean") {
    parts.push(
      `unlock control ${checkpoint.unlockControlVisible ? "visible" : "hidden"}`,
    );
  }
  return parts.length === 0 ? "recorded" : parts.join(", ");
}

function pushField(parts, label, value) {
  if (value !== undefined && value !== null && value !== "") {
    parts.push(`${label} ${String(value)}`);
  }
}

function formatSpineLabel(value) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

export function appendLocalHardeningAudit(audit, proofRun, { game }) {
  const row = normalizeLocalHardeningAudit(proofRun, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalPlayerRecoveryAudit(audit, proofRun, { game }) {
  const row = normalizeLocalPlayerRecoveryAudit(proofRun, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalPlayerRecoveryAudit(proofRun, { game }) {
  if (
    proofRun === null ||
    typeof proofRun !== "object" ||
    proofRun.version !== 1 ||
    proofRun.proof !== "dev-test-game-proof-run" ||
    proofRun.status !== "passed" ||
    proofRun.scope !== "local-dev-test-game-harness" ||
    proofRun.releaseReady !== false ||
    proofRun.productionReady !== false
  ) {
    return null;
  }
  const lanes = Array.isArray(proofRun.lanes) ? proofRun.lanes : [];
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  if (
    LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS.some(
      (id) => laneById.get(id)?.status !== "passed",
    ) ||
    proofRun.session?.verificationStatus !== "passed"
  ) {
    return null;
  }
  return Object.freeze({
    id: localAdminAuditIds.playerRecovery,
    label: "Local player recovery",
    status: `${LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS.length} player recovery lanes passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local player-action recovery proof",
    boundaryDetail:
      "Focused local dev-test-game player action recovery, stale command, reload, and conflict lanes without hosted multiplayer claims.",
    href: proofRun.artifacts?.proofRun ?? devTestGameProofRunPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.playerRecovery,
    }),
    checks: Object.freeze(
      LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS.map((id) => {
        const lane = laneById.get(id);
        return Object.freeze({
          id,
          status: localPlayerRecoveryLaneStatus(lane),
        });
      }),
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.coreLoop,
        label: "Core loop",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.coreLoop }),
        status: "source proof",
        command: "test:dev-test-game-core-loop-admin-proof",
      }),
      Object.freeze({
        id: localAdminAuditIds.hardening,
        label: "Multiplayer hardening",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.hardening }),
        status: "parent proof",
        command: "test:dev-test-game-hardening-admin-proof",
      }),
    ]),
    artifactSummary: Object.freeze({
      game: String(proofRun.session?.game ?? ""),
      roleCount: Array.isArray(proofRun.session?.roles)
        ? proofRun.session.roles.length
        : 0,
      laneCount: lanes.length,
      playerRecoveryLaneCount: LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS.length,
      releaseReady: proofRun.releaseReady === true,
      productionReady: proofRun.productionReady === true,
    }),
  });
}

function localPlayerRecoveryLaneStatus(lane) {
  if (
    [
      playerActionLoopLaneId,
      playerInvalidActionRecoveryLaneId,
      "dead-player-recovery",
      playerActionBoundaryLaneId,
    ].includes(lane?.id)
  ) {
    return coreLoopLaneStatus(lane);
  }
  return hardeningLaneStatus(lane);
}

export function normalizeLocalHardeningAudit(proofRun, { game }) {
  if (
    proofRun === null ||
    typeof proofRun !== "object" ||
    proofRun.version !== 1 ||
    proofRun.proof !== "dev-test-game-proof-run" ||
    proofRun.status !== "passed" ||
    proofRun.scope !== "local-dev-test-game-harness" ||
    proofRun.releaseReady !== false ||
    proofRun.productionReady !== false
  ) {
    return null;
  }
  const requiredLaneIds = hardeningAuditLaneIds;
  const lanes = Array.isArray(proofRun.lanes) ? proofRun.lanes : [];
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  if (
    requiredLaneIds.some((id) => laneById.get(id)?.status !== "passed") ||
    proofRun.session?.verificationStatus !== "passed"
  ) {
    return null;
  }
  return Object.freeze({
    id: localAdminAuditIds.hardening,
    label: "Local multiplayer hardening",
    status: `${requiredLaneIds.length} hardening lanes passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local multiplayer-hardening proof",
    boundaryDetail:
      proofRun.proofBoundary ??
      "Local dev-test-game proof-run hardening lanes without exhaustive race claims.",
    href: proofRun.artifacts?.proofRun ?? devTestGameProofRunPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.hardening,
    }),
    checks: Object.freeze(
      requiredLaneIds.map((id) => {
        const lane = laneById.get(id);
        return Object.freeze({
          id,
          status: hardeningLaneStatus(lane),
        });
      }),
    ),
    artifactSummary: Object.freeze({
      game: String(proofRun.session?.game ?? ""),
      roleCount: Array.isArray(proofRun.session?.roles)
        ? proofRun.session.roles.length
        : 0,
      laneCount: lanes.length,
      releaseReady: proofRun.releaseReady === true,
      productionReady: proofRun.productionReady === true,
    }),
  });
}

export function appendLocalBackupRestoreAudit(audit, backupRestoreProof, { game }) {
  const row = normalizeLocalBackupRestoreAudit(backupRestoreProof, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalBackupRestoreAudit(backupRestoreProof, { game }) {
  if (
    backupRestoreProof === null ||
    typeof backupRestoreProof !== "object" ||
    backupRestoreProof.version !== 1 ||
    backupRestoreProof.status !== "passed" ||
    backupRestoreProof.scope !== "local-live-stack-backup-restore-drill" ||
    backupRestoreProof.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(backupRestoreProof.checks)
    ? backupRestoreProof.checks
    : [];
  const requiredChecks = [
    "dump-created",
    "event-log-restored",
    "projection-fingerprints-restored",
    "auth-sessions-restored",
    "restored-api-capabilities",
  ];
  const checkStatus = new Map(checks.map((check) => [check.id, check.status]));
  if (requiredChecks.some((id) => checkStatus.get(id) !== "passed")) {
    return null;
  }
  const sessions = Object.entries(
    backupRestoreProof.restoredApiEvidence?.restoredSessions ?? {},
  ).map(([role, capabilities]) =>
    Object.freeze({
      role,
      capabilities: Array.isArray(capabilities)
        ? Object.freeze(capabilities.map((capability) => String(capability)))
        : Object.freeze([]),
    }),
  );
  return Object.freeze({
    id: localAdminAuditIds.backupRestore,
    label: "Local backup restore",
    status: `${requiredChecks.length} backup restore checks passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local backup/restore drill",
    boundaryDetail:
      backupRestoreProof.proofBoundary ??
      "Local disposable Postgres backup/restore proof without production backup claims.",
    href:
      backupRestoreProof.artifact?.proof ??
      devTestGameBackupRestoreProofPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.backupRestore,
    }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
        }),
      ),
    ),
    sessions: Object.freeze(sessions),
    artifactSummary: Object.freeze({
      game: String(backupRestoreProof.game ?? ""),
      dump:
        backupRestoreProof.artifact?.dump ??
        devTestGameBackupRestoreDumpPath,
      eventRows: Number(backupRestoreProof.fingerprints?.source?.events?.total ?? 0),
      restoredEventRows: Number(
        backupRestoreProof.fingerprints?.restored?.events?.total ?? 0,
      ),
      sessionCount: sessions.length,
      productionReady: backupRestoreProof.productionReady === true,
    }),
  });
}

export function appendLocalIdentityAdapterAudit(audit, identityAdapterProof, { game }) {
  const row = normalizeLocalIdentityAdapterAudit(identityAdapterProof, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalIdentityAdapterAudit(identityAdapterProof, { game }) {
  if (
    identityAdapterProof === null ||
    typeof identityAdapterProof !== "object" ||
    identityAdapterProof.version !== devTestGameIdentityAdapterProofVersion ||
    identityAdapterProof.proof !== "auth-invite-role-proof" ||
    identityAdapterProof.status !== "passed" ||
    identityAdapterProof.scope !== "local-auth-invite-role-proof" ||
    identityAdapterProof.releaseReady !== false ||
    identityAdapterProof.productionReady !== false ||
    identityAdapterProof.identityAdapter?.replacesDevTokensWithoutRoleSurfaceChange !== true ||
    devTestGameIdentityAdapterContractDiff(
      identityAdapterProof.identityAdapterContract,
    ).status !== "passed"
  ) {
    return null;
  }
  const requiredRoleCapabilities = new Map([
    ["admin", "GlobalAdmin"],
    ["host", "HostOf"],
    ["player", "SlotOccupant"],
  ]);
  for (const [role, capability] of requiredRoleCapabilities) {
    if (!identityAdapterProof.roles?.[role]?.capabilityKinds?.includes(capability)) {
      return null;
    }
  }
  const roles = Object.entries(identityAdapterProof.roles ?? {}).map(([role, entry]) =>
    Object.freeze({
      role,
      capabilities: Array.isArray(entry?.capabilityKinds)
        ? Object.freeze(entry.capabilityKinds.map((capability) => String(capability)))
        : Object.freeze([]),
    }),
  );
  const lifecycleChecks = [
    ["account-login", identityAdapterProof.identityLifecycle?.accountLogin?.status],
    [
      "account-password-rotation",
      identityAdapterProof.identityLifecycle?.accountPasswordRotation?.status,
    ],
    ["account-recovery", identityAdapterProof.identityLifecycle?.accountRecovery?.status],
    [
      "credential-attempt-throttling",
      identityAdapterProof.identityLifecycle?.credentialAttemptThrottling?.status,
    ],
    [
      "account-lifecycle",
      identityAdapterProof.identityLifecycle?.accountLifecycle?.status,
    ],
    ["session-rotation", identityAdapterProof.identityLifecycle?.sessionRotation?.status],
    ["session-revocation", identityAdapterProof.identityLifecycle?.sessionRevocation?.status],
    ["invite-revocation", identityAdapterProof.identityLifecycle?.inviteRevocation?.status],
    [
      "host-scoped-invite-issuance",
      identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance?.status,
    ],
    ["audit-trail", identityAdapterProof.identityLifecycle?.auditTrail?.status],
    [
      "admin-audit-surface",
      identityAdapterProof.identityLifecycle?.adminAuditSurface?.status,
    ],
  ];
  if (
    roles.length === 0 ||
    lifecycleChecks.some(([, status]) => status !== "passed") ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance?.hostRoleSurface !==
      `/g/${identityAdapterProof.game}/host` ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance?.hostAction !==
      "?/issuePlayerInvite" ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance
      ?.clickedThroughFromHostRoleUrl !== true ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance
      ?.issuedByPrincipalUserId !== "host_h" ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance?.issuedForGame !==
      identityAdapterProof.game ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance?.storedGameScope !==
      identityAdapterProof.game ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance
      ?.globalCapabilitiesGranted !== 0 ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance?.rawInviteTokenStored !==
      false ||
    identityAdapterProof.identityLifecycle?.accountLogin?.principalUserId !== "host_h" ||
    !identityAdapterProof.identityLifecycle?.accountLogin?.capabilityKinds?.includes(
      "HostOf",
    ) ||
    identityAdapterProof.identityLifecycle?.accountLogin?.sameRoleSurface !== true ||
    identityAdapterProof.identityLifecycle?.accountLogin?.rawPasswordStored !== false ||
    identityAdapterProof.identityLifecycle?.accountPasswordRotation?.passwordAlgorithm !==
      "argon2id" ||
    identityAdapterProof.identityLifecycle?.accountPasswordRotation
      ?.securitySurfaceTestId !== "account-security-surface" ||
    identityAdapterProof.identityLifecycle?.accountPasswordRotation
      ?.staleSessionRejected !== true ||
    identityAdapterProof.identityLifecycle?.accountPasswordRotation
      ?.oldPasswordRejected !== true ||
    !identityAdapterProof.identityLifecycle?.accountPasswordRotation
      ?.newPasswordCapabilityKinds?.includes("HostOf") ||
    identityAdapterProof.identityLifecycle?.accountPasswordRotation?.sameRoleSurface !==
      true ||
    identityAdapterProof.identityLifecycle?.accountPasswordRotation
      ?.revokedSessionCount < 1 ||
    identityAdapterProof.identityLifecycle?.accountPasswordRotation?.rawPasswordStored !==
      false ||
    identityAdapterProof.identityLifecycle?.accountRecovery?.credentialKind !==
      "hashed-single-use-recovery-credential" ||
    identityAdapterProof.identityLifecycle?.accountRecovery?.passwordAlgorithm !==
      "argon2id" ||
    identityAdapterProof.identityLifecycle?.accountRecovery?.recoverySurfaceTestId !==
      "account-recovery-surface" ||
    identityAdapterProof.identityLifecycle?.accountRecovery?.rawCredentialVisibleOnce !==
      true ||
    identityAdapterProof.identityLifecycle?.accountRecovery?.rawCredentialStored !==
      false ||
    identityAdapterProof.identityLifecycle?.accountRecovery?.invalidCredentialRejected !==
      true ||
    identityAdapterProof.identityLifecycle?.accountRecovery?.expiredCredentialRejected !==
      true ||
    identityAdapterProof.identityLifecycle?.accountRecovery?.revokedCredentialRejected !==
      true ||
    identityAdapterProof.identityLifecycle?.accountRecovery?.replayedCredentialRejected !==
      true ||
    identityAdapterProof.identityLifecycle?.accountRecovery?.priorSessionRejected !==
      true ||
    identityAdapterProof.identityLifecycle?.accountRecovery?.priorPasswordRejected !==
      true ||
    !identityAdapterProof.identityLifecycle?.accountRecovery
      ?.recoveredPasswordCapabilityKinds?.includes("HostOf") ||
    identityAdapterProof.identityLifecycle?.accountRecovery?.sameRoleSurface !== true ||
    identityAdapterProof.identityLifecycle?.accountRecovery?.revokedSessionCount < 1 ||
    identityAdapterProof.identityLifecycle?.credentialAttemptThrottling?.policyKind !==
      "two-tier-postgres-account-source-lockout" ||
    identityAdapterProof.identityLifecycle?.credentialAttemptThrottling
      ?.retryTimingVisible !== true ||
    identityAdapterProof.identityLifecycle?.credentialAttemptThrottling?.hashedScopeStored !==
      true ||
    identityAdapterProof.identityLifecycle?.credentialAttemptThrottling
      ?.rawAccountOrSourceStored !== false ||
    identityAdapterProof.identityLifecycle?.credentialAttemptThrottling
      ?.successfulLoginClearedFailures !== true ||
    !identityAdapterProof.identityLifecycle?.credentialAttemptThrottling
      ?.postLockoutCapabilityKinds?.includes("HostOf") ||
    identityAdapterProof.identityLifecycle?.credentialAttemptThrottling?.sameRoleSurface !==
      true ||
    identityAdapterProof.identityLifecycle?.credentialAttemptThrottling?.storedScopeCount !==
      2 ||
    identityAdapterProof.identityLifecycle?.credentialAttemptThrottling?.blockedScopeCount !==
      1 ||
    identityAdapterProof.identityLifecycle?.credentialAttemptThrottling
      ?.unknownAccountBounding?.status !== "passed" ||
    identityAdapterProof.identityLifecycle?.credentialAttemptThrottling
      ?.unknownAccountBounding?.storedScopeCount !== 1 ||
    identityAdapterProof.identityLifecycle?.credentialAttemptThrottling
      ?.unknownAccountBounding?.spoofedSourceHeadersIgnored !== true ||
    identityAdapterProof.identityLifecycle?.credentialAttemptThrottling
      ?.unknownAccountBounding?.staleRowsPruned !== true ||
    identityAdapterProof.identityLifecycle?.credentialAttemptThrottling
      ?.unknownAccountBounding?.unknownCredentialWorkFactor !==
      "argon2id-dummy-verification" ||
    identityAdapterProof.identityLifecycle?.credentialAttemptThrottling
      ?.unknownAccountBounding?.sameRoleSurface !== true ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.adminControlSurface?.status !==
      "passed" ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.adminControlSurface
      ?.controlsTestId !== "admin-identity-account-controls" ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.adminControlSurface
      ?.visitedDetailRoleUrl !== true ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.disabledStatus !==
      "disabled" ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.enabledStatus !==
      "enabled" ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.disabledAccountRejected !==
      true ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.staleAccountSessionRejected !==
      true ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.staleAdminControlRejected !==
      true ||
    identityAdapterProof.identityLifecycle?.accountLifecycle
      ?.staleAdminControlReloadRecovered !== true ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.adminControlSurface
      ?.reloadRecoveryStatus !== "disabled" ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.adminControlSurface
      ?.reloadRecoveryDetailRoleUrl !==
      "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h" ||
    !String(
      identityAdapterProof.identityLifecycle?.accountLifecycle?.adminControlSurface
        ?.reloadRecoveryTargetText ?? "",
    ).includes("disabled") ||
    !identityAdapterProof.identityLifecycle?.accountLifecycle?.recoveryCapabilityKinds?.includes(
      "HostOf",
    ) ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.sameRoleSurface !== true ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.rawPasswordStored !== false ||
    identityAdapterProof.identityLifecycle?.auditTrail?.rawTokensStored !== false ||
    identityAdapterProof.identityLifecycle?.adminAuditSurface?.rawTokensVisible !== false
  ) {
    return null;
  }
  const controls = Array.isArray(identityAdapterProof.identityAdapter?.lifecycleControls)
    ? identityAdapterProof.identityAdapter.lifecycleControls
    : [];
  const artifactSummary = Object.freeze({
    game: String(identityAdapterProof.game ?? ""),
    adapterContract: normalizeIdentityAdapterContractSummary(
      identityAdapterProof.identityAdapterContract,
      identityAdapterProof.identityAdapterContractDiff,
    ),
    browserCookieName: String(identityAdapterProof.identityAdapter?.browserCookieName ?? ""),
    inviteCredentialKind: String(
      identityAdapterProof.identityAdapter?.inviteCredentialKind ?? "",
    ),
    sessionCredentialKind: String(
      identityAdapterProof.identityAdapter?.sessionCredentialKind ?? "",
    ),
    accountCredentialKind: String(
      identityAdapterProof.identityAdapter?.accountCredentialKind ?? "",
    ),
    accountPasswordAlgorithm: String(
      identityAdapterProof.identityAdapter?.accountPasswordAlgorithm ?? "",
    ),
    accountRecoveryCredentialKind: String(
      identityAdapterProof.identityAdapter?.accountRecoveryCredentialKind ?? "",
    ),
    credentialAttemptPolicyKind: String(
      identityAdapterProof.identityAdapter?.credentialAttemptPolicyKind ?? "",
    ),
    credentialAttemptSourceKind: String(
      identityAdapterProof.identityAdapter?.credentialAttemptSourceKind ?? "",
    ),
    lifecycleControls: Object.freeze(controls.map((control) => String(control))),
    delegatedIssuanceControls: Object.freeze(
      (Array.isArray(identityAdapterProof.identityAdapter?.delegatedIssuanceControls)
        ? identityAdapterProof.identityAdapter.delegatedIssuanceControls
        : []
      ).map((control) => String(control)),
    ),
    hostScopedInvite: Object.freeze({
      issuedByPrincipalUserId: String(
        identityAdapterProof.identityLifecycle.hostScopedInviteIssuance
          ?.issuedByPrincipalUserId ?? "",
      ),
      issuedForGame: String(
        identityAdapterProof.identityLifecycle.hostScopedInviteIssuance
          ?.issuedForGame ?? "",
      ),
      storedGameScope: String(
        identityAdapterProof.identityLifecycle.hostScopedInviteIssuance
          ?.storedGameScope ?? "",
      ),
      globalCapabilitiesGranted:
        identityAdapterProof.identityLifecycle.hostScopedInviteIssuance
          ?.globalCapabilitiesGranted ?? null,
      hostRoleSurface: String(
        identityAdapterProof.identityLifecycle.hostScopedInviteIssuance
          ?.hostRoleSurface ?? "",
      ),
      hostAction: String(
        identityAdapterProof.identityLifecycle.hostScopedInviteIssuance?.hostAction ??
          "",
      ),
      clickedThroughFromHostRoleUrl:
        identityAdapterProof.identityLifecycle.hostScopedInviteIssuance
          ?.clickedThroughFromHostRoleUrl === true,
    }),
    accountLogin: Object.freeze({
      principalUserId: String(
        identityAdapterProof.identityLifecycle.accountLogin?.principalUserId ?? "",
      ),
      accountId: String(
        identityAdapterProof.identityLifecycle.accountLogin?.accountId ?? "",
      ),
      sameRoleSurface:
        identityAdapterProof.identityLifecycle.accountLogin?.sameRoleSurface === true,
      cookieValuePrefix: String(
        identityAdapterProof.identityLifecycle.accountLogin?.cookieValuePrefix ?? "",
      ),
      rawPasswordStored:
        identityAdapterProof.identityLifecycle.accountLogin?.rawPasswordStored === true,
    }),
    accountPasswordRotation: Object.freeze({
      passwordAlgorithm: String(
        identityAdapterProof.identityLifecycle.accountPasswordRotation
          ?.passwordAlgorithm ?? "",
      ),
      securityRoleUrl: String(
        identityAdapterProof.identityLifecycle.accountPasswordRotation
          ?.securityRoleUrl ?? "",
      ),
      staleSessionRejected:
        identityAdapterProof.identityLifecycle.accountPasswordRotation
          ?.staleSessionRejected === true,
      oldPasswordRejected:
        identityAdapterProof.identityLifecycle.accountPasswordRotation
          ?.oldPasswordRejected === true,
      sameRoleSurface:
        identityAdapterProof.identityLifecycle.accountPasswordRotation
          ?.sameRoleSurface === true,
      revokedSessionCount:
        identityAdapterProof.identityLifecycle.accountPasswordRotation
          ?.revokedSessionCount ?? null,
      rawPasswordStored:
        identityAdapterProof.identityLifecycle.accountPasswordRotation
          ?.rawPasswordStored === true,
    }),
    accountRecovery: Object.freeze({
      credentialKind: String(
        identityAdapterProof.identityLifecycle.accountRecovery?.credentialKind ?? "",
      ),
      recoveryRoleUrl: String(
        identityAdapterProof.identityLifecycle.accountRecovery?.recoveryRoleUrl ?? "",
      ),
      invalidCredentialRejected:
        identityAdapterProof.identityLifecycle.accountRecovery
          ?.invalidCredentialRejected === true,
      expiredCredentialRejected:
        identityAdapterProof.identityLifecycle.accountRecovery
          ?.expiredCredentialRejected === true,
      revokedCredentialRejected:
        identityAdapterProof.identityLifecycle.accountRecovery
          ?.revokedCredentialRejected === true,
      replayedCredentialRejected:
        identityAdapterProof.identityLifecycle.accountRecovery
          ?.replayedCredentialRejected === true,
      priorSessionRejected:
        identityAdapterProof.identityLifecycle.accountRecovery?.priorSessionRejected ===
        true,
      sameRoleSurface:
        identityAdapterProof.identityLifecycle.accountRecovery?.sameRoleSurface === true,
      revokedSessionCount:
        identityAdapterProof.identityLifecycle.accountRecovery?.revokedSessionCount ??
        null,
      rawCredentialStored:
        identityAdapterProof.identityLifecycle.accountRecovery?.rawCredentialStored ===
        true,
    }),
    credentialAttemptThrottling: Object.freeze({
      policyKind: String(
        identityAdapterProof.identityLifecycle.credentialAttemptThrottling?.policyKind ??
          "",
      ),
      threshold:
        identityAdapterProof.identityLifecycle.credentialAttemptThrottling?.threshold ??
        null,
      sourceThreshold:
        identityAdapterProof.identityLifecycle.credentialAttemptThrottling
          ?.sourceThreshold ?? null,
      retentionSeconds:
        identityAdapterProof.identityLifecycle.credentialAttemptThrottling
          ?.retentionSeconds ?? null,
      retryTimingVisible:
        identityAdapterProof.identityLifecycle.credentialAttemptThrottling
          ?.retryTimingVisible === true,
      hashedScopeStored:
        identityAdapterProof.identityLifecycle.credentialAttemptThrottling
          ?.hashedScopeStored === true,
      storedScopeCount:
        identityAdapterProof.identityLifecycle.credentialAttemptThrottling
          ?.storedScopeCount ?? null,
      blockedScopeCount:
        identityAdapterProof.identityLifecycle.credentialAttemptThrottling
          ?.blockedScopeCount ?? null,
      rawAccountOrSourceStored:
        identityAdapterProof.identityLifecycle.credentialAttemptThrottling
          ?.rawAccountOrSourceStored === true,
      successfulLoginClearedFailures:
        identityAdapterProof.identityLifecycle.credentialAttemptThrottling
          ?.successfulLoginClearedFailures === true,
      sameRoleSurface:
        identityAdapterProof.identityLifecycle.credentialAttemptThrottling
          ?.sameRoleSurface === true,
      unknownAccountBounding: Object.freeze({
        identifierCount:
          identityAdapterProof.identityLifecycle.credentialAttemptThrottling
            ?.unknownAccountBounding?.identifierCount ?? null,
        storedScopeCount:
          identityAdapterProof.identityLifecycle.credentialAttemptThrottling
            ?.unknownAccountBounding?.storedScopeCount ?? null,
        spoofedSourceHeadersIgnored:
          identityAdapterProof.identityLifecycle.credentialAttemptThrottling
            ?.unknownAccountBounding?.spoofedSourceHeadersIgnored === true,
        staleRowsPruned:
          identityAdapterProof.identityLifecycle.credentialAttemptThrottling
            ?.unknownAccountBounding?.staleRowsPruned === true,
        unknownCredentialWorkFactor: String(
          identityAdapterProof.identityLifecycle.credentialAttemptThrottling
            ?.unknownAccountBounding?.unknownCredentialWorkFactor ?? "",
        ),
        sameRoleSurface:
          identityAdapterProof.identityLifecycle.credentialAttemptThrottling
            ?.unknownAccountBounding?.sameRoleSurface === true,
      }),
    }),
    accountLifecycle: Object.freeze({
      disabledStatus: String(
        identityAdapterProof.identityLifecycle.accountLifecycle?.disabledStatus ?? "",
      ),
      enabledStatus: String(
        identityAdapterProof.identityLifecycle.accountLifecycle?.enabledStatus ?? "",
      ),
      disabledAccountRejected:
        identityAdapterProof.identityLifecycle.accountLifecycle
          ?.disabledAccountRejected === true,
      staleAccountSessionRejected:
        identityAdapterProof.identityLifecycle.accountLifecycle
          ?.staleAccountSessionRejected === true,
      staleAdminControlRejected:
        identityAdapterProof.identityLifecycle.accountLifecycle
          ?.staleAdminControlRejected === true,
      staleAdminControlReloadRecovered:
        identityAdapterProof.identityLifecycle.accountLifecycle
          ?.staleAdminControlReloadRecovered === true,
      sameRoleSurface:
        identityAdapterProof.identityLifecycle.accountLifecycle?.sameRoleSurface ===
        true,
      revokedSessionCount:
        identityAdapterProof.identityLifecycle.accountLifecycle?.revokedSessionCount ??
        null,
      adminControlSurface: Object.freeze({
        detailRoleUrl: String(
          identityAdapterProof.identityLifecycle.accountLifecycle?.adminControlSurface
            ?.detailRoleUrl ?? "",
        ),
        controlsTestId: String(
          identityAdapterProof.identityLifecycle.accountLifecycle?.adminControlSurface
            ?.controlsTestId ?? "",
        ),
        visitedDetailRoleUrl:
          identityAdapterProof.identityLifecycle.accountLifecycle?.adminControlSurface
            ?.visitedDetailRoleUrl === true,
        staleConflictStatusText: String(
          identityAdapterProof.identityLifecycle.accountLifecycle?.adminControlSurface
            ?.staleConflictStatusText ?? "",
        ),
        reloadRecoveryStatus: String(
          identityAdapterProof.identityLifecycle.accountLifecycle?.adminControlSurface
            ?.reloadRecoveryStatus ?? "",
        ),
        reloadRecoveryDetailRoleUrl: String(
          identityAdapterProof.identityLifecycle.accountLifecycle?.adminControlSurface
            ?.reloadRecoveryDetailRoleUrl ?? "",
        ),
        reloadRecoveryTargetText: String(
          identityAdapterProof.identityLifecycle.accountLifecycle?.adminControlSurface
            ?.reloadRecoveryTargetText ?? "",
        ),
      }),
      rawPasswordStored:
        identityAdapterProof.identityLifecycle.accountLifecycle?.rawPasswordStored ===
        true,
    }),
    rawTokensStored: identityAdapterProof.identityLifecycle.auditTrail.rawTokensStored,
    rawTokensVisible:
      identityAdapterProof.identityLifecycle.adminAuditSurface.rawTokensVisible,
    releaseReady: identityAdapterProof.releaseReady === true,
    productionReady: identityAdapterProof.productionReady === true,
  });
  return Object.freeze({
    id: localAdminAuditIds.identityAdapter,
    label: "Local identity adapter",
    status: `${roles.length} role surfaces, ${controls.length} lifecycle controls`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local production-identity adapter proof",
    boundaryDetail:
      identityAdapterProof.proofBoundary ??
      "Local invite/session identity adapter proof without hosted account claims.",
    href: devTestGameIdentityAdapterProofPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.identityAdapter,
    }),
    checks: Object.freeze(
      lifecycleChecks.map(([id, status]) =>
        Object.freeze({
          id,
          status: String(status),
        }),
      ),
    ),
    sessions: Object.freeze(roles),
    artifactSummary,
    artifactSummarySections: buildIdentityAdapterSummarySections(artifactSummary),
  });
}

function normalizeIdentityAdapterContractSummary(packet, diff) {
  const computedDiff = devTestGameIdentityAdapterContractDiff(packet);
  const sourceDiff =
    diff !== null && typeof diff === "object" ? diff : computedDiff;
  return Object.freeze({
    status: String(packet?.status ?? "unknown"),
    adapterId: String(packet?.adapterId ?? sourceDiff.adapterId ?? ""),
    roleSurfaceArchitectureChanged:
      packet?.roleSurfaceArchitectureChanged === true,
    roleSurfaceContractStatus: String(
      sourceDiff.roleSurfaceContractDiff?.status ?? "unknown",
    ),
    mismatchCount: Array.isArray(sourceDiff.mismatches)
      ? sourceDiff.mismatches.length
      : 0,
    mismatches: Object.freeze(
      (Array.isArray(sourceDiff.mismatches) ? sourceDiff.mismatches : []).map(
        (mismatch) =>
          Object.freeze({
            id: String(mismatch.id ?? ""),
            path: String(mismatch.path ?? ""),
          }),
      ),
    ),
  });
}

export function adminAuditInspectHref({ game, audit }) {
  const params = new URLSearchParams({
    game: normalizeRoutePart(game, "game"),
  });
  return `/admin/audit/${encodeURIComponent(
    normalizeRoutePart(audit, "audit"),
  )}?${params.toString()}`;
}

export function adminArtifactInspectHref({ game, artifact }) {
  const params = new URLSearchParams({
    game: normalizeRoutePart(game, "game"),
    path: normalizeRoutePart(artifact, "artifact"),
  });
  return `/admin/artifact?${params.toString()}`;
}

export function adminOverviewHref({ game }) {
  const params = new URLSearchParams({
    game: normalizeRoutePart(game, "game"),
  });
  return `/admin?${params.toString()}`;
}

function requiredAuditId(audit) {
  return normalizeRoutePart(audit, "audit");
}

function normalizeRoutePart(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`admin ${field} must be a non-empty string`);
  }
  return value;
}
