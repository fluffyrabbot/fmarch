import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameNextAction } from "./dev_test_game_next_action.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameHostedConcurrentRaceMatrixEvidence,
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import {
  assertDevTestGameProofGraph,
} from "./dev_test_game_proof_graph.mjs";
import {
  assertAdminRoleSurfaceEvidenceArtifact,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";
import {
  assertAdminAuditRelatedHandoff,
  requiredRelatedDestinationsForHandoffs,
} from "./dev_test_game_admin_audit_handoff_contract.mjs";
import {
  hostedMatrixHandoffSummary,
  selectedNextActionProofGraphNodeStatus,
  selectedNextActionProofGraphNodeSummary,
} from "../frontend/src/lib/app/local-proof-handoff-status.mjs";
import {
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  assertSelectedGraphDestinationCaseSurface,
  selectedGraphDestinationHandoffSummary,
  selectedGraphDestinationSubject,
  selectedNextActionGraphDestinationCases,
} from "./dev_test_game_next_action_graph_destination_assertions.mjs";
import {
  assertRecoveryReceiptGraphSummary,
  recoveryReceiptGraphDescriptors,
} from "./dev_test_game_recovery_receipt_catalog.mjs";
import {
  devTestGameProofRunPath,
  nextActionAdminProofPath,
  nextActionPath as defaultNextActionPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  devTestGameProofGraphCommand,
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import {
  cleanProofStabilityTrace,
} from "./dev_test_game_proof_stability_trace.mjs";
import {
  buildProofGraphDestinationSummaryTrace,
  normalizeProofGraphDestinationSummaryTrace,
  proofGraphDestinationSummaryTraceStrategy,
} from "./dev_test_game_proof_graph_destination_summary_trace.mjs";
import {
  assertProofGraphDiagnosticSummaryVisibleChecks,
  normalizeProofGraphDiagnosticSummaryTrace,
  proofGraphDiagnosticSummaryCheckIds,
} from "./dev_test_game_proof_graph_diagnostic_summary.mjs";
import {
  cleanSeedProofLaneCoverageTrace,
} from "./dev_test_game_seed_proof_lane_coverage_trace.mjs";
import {
  assertPreReadinessTrace,
  assertPreReadinessTraceVisibleChecks,
  localReadinessDependencyTraceStrategy,
  preReadinessTraceCheckIds,
  preReadinessTraceKeys,
} from "./dev_test_game_pre_readiness_trace_registry.mjs";
import {
  assertPriorityTraceVisibleChecks,
  assertReleaseReadinessTrace,
  assertSelectionTrace,
  releaseReadinessTraceCheckIds,
  releaseReadinessTraceStrategy,
  selectionTraceCheckIds,
  selectionTraceStrategy,
} from "./dev_test_game_next_action_priority_traces.mjs";
import {
  assertRecoveryTrace,
  recoveryTraceCheckIds,
  recoveryTraceKeys,
} from "./dev_test_game_next_action_recovery_traces.mjs";
import {
  proofGraphDestinationSummaryDriftNextActionAdminProofPath,
  proofGraphDestinationSummaryDriftNextActionPath,
} from "./dev_test_game_next_action_admin_proof_paths.mjs";
import {
  selectedProductionFeatureSpineMatchesProvenance,
} from "./dev_test_game_production_feature_spine_target_provenance.mjs";
import {
  visibleBlockedOperatorPacket,
} from "./dev_test_game_hosted_operator_packet.mjs";
export {
  proofGraphDestinationSummaryDriftNextActionAdminProofPath,
  proofGraphDestinationSummaryDriftNextActionPath,
} from "./dev_test_game_next_action_admin_proof_paths.mjs";

const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? devTestGameProofRunPath,
);
const proofGraphPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_GRAPH ?? devTestGameProofGraphPath,
);
const hostedMatrixPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX ??
    devTestGameHostedConcurrentRaceMatrixPath,
);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const proofGraphRelativePath = path.relative(repoRoot, proofGraphPath);
const hostedMatrixRelativePath = path.relative(repoRoot, hostedMatrixPath);

export function nextActionAdminProofCase({
  nextActionSourcePath =
    process.env.FMARCH_DEV_TEST_GAME_NEXT_ACTION ?? defaultNextActionPath,
  evidenceSourcePath =
    process.env.FMARCH_DEV_TEST_GAME_NEXT_ACTION_ADMIN_PROOF ??
    nextActionAdminProofPath,
  smokeName = "dev-test-game-next-action-admin-proof",
  stage = "next-action-admin-proof-listen",
} = {}) {
  const nextActionPath = path.resolve(repoRoot, nextActionSourcePath);
  const nextActionRelativePath = path.relative(repoRoot, nextActionPath);
  const evidencePath = path.resolve(repoRoot, evidenceSourcePath);
  const evidenceRelativePath = path.relative(repoRoot, evidencePath);
  return {
    smokeName,
    stage,
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_NEXT_ACTION: nextActionRelativePath,
      FMARCH_DEV_TEST_GAME_NEXT_ACTION_ADMIN_PROOF: evidenceRelativePath,
      FMARCH_DEV_TEST_GAME_PROOF_GRAPH: proofGraphRelativePath,
      FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX:
        hostedMatrixRelativePath,
    },
    loadSource: async () => ({
      nextAction: assertDevTestGameNextAction(await readJson(nextActionPath)),
      proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
      proofGraph: assertDevTestGameProofGraph(await readJson(proofGraphPath)),
      hostedMatrix: assertDevTestGameHostedConcurrentRaceMatrixEvidence(
        await readJson(hostedMatrixPath),
      ),
    }),
    prove: async ({ browser, frontendBaseUrl, source }) =>
      await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: source.proofRun.session.game,
        auditId: localAdminAuditIds.nextAction,
        requiredChecks: requiredChecksForNextAction(source.nextAction),
        requiredCheckStatuses: requiredCheckStatusesForNextAction(
          source.nextAction,
          source.proofGraph,
        ),
        requiredRelatedLinks: requiredRelatedLinksForNextAction(source.nextAction),
        requiredHostedHandoffInputs: requiredHostedHandoffInputIdsForNextAction(
          source.nextAction,
        ),
        requiredHostedHandoffInputValues:
          requiredHostedHandoffInputValuesForNextAction(source.nextAction),
        requiredHostedHandoffBlockedChecks:
          requiredHostedHandoffBlockedCheckIdsForNextAction(source.nextAction),
        requiredHostedHandoffGroups:
          requiredHostedHandoffGroupIdsForNextAction(source.nextAction),
        requiredHostedHandoffSummary:
          requiredHostedHandoffSummaryForNextAction(source.nextAction),
        requiredHostedHandoffBlockedReceipt:
          requiredHostedHandoffBlockedReceiptForNextAction(source.nextAction),
        requiredHostedHandoffInputSections:
          requiredHostedHandoffInputSectionIdsForNextAction(source.nextAction),
        requiredHostedHandoffInputSectionStatuses:
          requiredHostedHandoffInputSectionStatusesForNextAction(source.nextAction),
        requiredHostedHandoffSectionInputs:
          requiredHostedHandoffSectionInputIdsForNextAction(source.nextAction),
        requiredHostedHandoffSectionInputStatuses:
          requiredHostedHandoffSectionInputStatusesForNextAction(source.nextAction),
        requiredHostedIdentityProgressions:
          requiredHostedIdentityProgressionIdsForNextAction(source.nextAction),
        requiredHostedIdentityProgressionStatuses:
          requiredHostedIdentityProgressionStatusesForNextAction(
            source.nextAction,
          ),
        requiredNextActionHandoffPairRows:
          requiredNextActionHandoffPairRowsForNextAction(source.nextAction),
        requiredNextActionHandoffPairRowStatuses:
          requiredNextActionHandoffPairRowStatusesForNextAction(
            source.nextAction,
          ),
        requiredPhaseLocalNextActionSnapshots:
          requiredPhaseLocalNextActionSnapshotRowsForProofGraph(
            source.proofGraph,
          ),
        requiredPhaseLocalNextActionSnapshotStatuses:
          requiredPhaseLocalNextActionSnapshotStatusesForProofGraph(
            source.proofGraph,
          ),
        requiredPhaseLocalNextActionDrilldowns:
          phaseLocalNextActionSnapshotsForProofGraph(source.proofGraph),
        requiredEvidenceArtifact: {
          artifact: defaultNextActionPath,
          requiredText:
            nextActionRelativePath === defaultNextActionPath
              ? [
                  "dev-test-game-next-action",
                  source.nextAction.nextAction.command,
                  source.nextAction.nextAction.reason,
                ]
              : ["dev-test-game-next-action"],
        },
        requiredHostedIdentityOperatorGate:
          requiredHostedIdentityOperatorGateForNextAction(source.nextAction),
        requiredText: requiredSelectedOperatorHandoffTextForNextAction(
          source.nextAction,
        ),
        requiredRelatedDestinations: requiredRelatedDestinationsForHandoffs(
          relatedHandoffsForNextAction({
            nextAction: source.nextAction,
            proofGraph: source.proofGraph,
            hostedMatrix: source.hostedMatrix,
          }),
        ),
      }),
    buildEvidence: ({ source, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-next-action-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-next-action-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the generated dev-test-game next-action receipt. Proves the receipt is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted operations, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      nextAction: nextActionRelativePath,
      proofRun: proofRunRelativePath,
      proofGraph: proofGraphRelativePath,
      hostedConcurrentRaceMatrix: hostedMatrixRelativePath,
      game: source.proofRun.session.game,
      command: source.nextAction.nextAction.command,
      reason: source.nextAction.nextAction.reason,
      actionStatus: source.nextAction.nextAction.status,
      artifactId: source.nextAction.nextAction.artifact?.id ?? null,
      localCheckId: source.nextAction.nextAction.localCheck?.id ?? null,
      localCheckRoleUrl: source.nextAction.nextAction.localCheck?.roleUrl ?? null,
      seedProofLaneCoverageRoleUrl:
        source.nextAction.nextAction.seedProofLaneCoverage?.roleUrl ?? null,
      seedProofLaneCoverageSource:
        source.nextAction.nextAction.seedProofLaneCoverage?.source ?? null,
      seedProofLaneCoverageUnclassifiedLaneIds:
        source.nextAction.nextAction.seedProofLaneCoverage
          ?.unclassifiedLaneIds ?? [],
      proofGraphDestinationSummary:
        source.nextAction.nextAction.proofGraphDestinationSummary ?? null,
      sequenceDeferral:
        source.nextAction.nextAction.sequenceDeferral ?? null,
      unprovenId: source.nextAction.nextAction.unproven?.id ?? null,
      unprovenRoleUrl: source.nextAction.nextAction.unproven?.roleUrl ?? null,
      unprovenProofGraphNodeId:
        source.nextAction.nextAction.unproven?.proofGraphNodeId ?? null,
      unprovenProductionFeatureSpineTarget:
        source.nextAction.nextAction.unproven?.productionFeatureSpineTarget ?? null,
      unprovenSpineDrilldown:
        source.nextAction.nextAction.unproven?.spineDrilldown ?? null,
      unprovenSpineTarget:
        source.nextAction.nextAction.unproven?.spineTarget ?? null,
      unprovenSpineProvenance:
        source.nextAction.nextAction.unproven?.selectedSpineProvenance ?? null,
      unprovenSelectedProductionFeatureGraph:
        source.nextAction.nextAction.unproven?.selectedProductionFeatureGraph ??
        null,
      unprovenHostedHandoffChecklist:
        source.nextAction.nextAction.unproven?.hostedHandoffChecklist ?? null,
      selectedOperatorHandoff:
        source.nextAction.selectedOperatorHandoff ?? null,
      unprovenHostedIdentityFamilyBatch:
        source.nextAction.nextAction.unproven?.hostedIdentityFamilyBatch ?? null,
      unprovenHostedIdentityProofGraphEdges:
        source.nextAction.nextAction.unproven?.hostedIdentityProofGraphEdges ??
        null,
      unprovenHostedIdentityProgressionSummary:
        source.nextAction.nextAction.unproven?.hostedHandoffChecklist
          ?.progressionSummary ?? null,
      selectedProofGraphNode: selectedNextActionProofGraphNodeSummary({
        nextAction: source.nextAction,
        proofGraph: source.proofGraph,
      }),
      terminalBatchGraph: source.nextAction.generatedFrom?.terminalBatchGraph ?? null,
      nextActionHandoffPair:
        source.nextAction.generatedFrom?.nextActionHandoffPair ?? null,
      phaseLocalNextActionSnapshots:
        phaseLocalNextActionSnapshotsForProofGraph(source.proofGraph),
      coreLoopRecoveryDestinationCoverage:
        source.nextAction.generatedFrom?.coreLoopRecoveryDestinationCoverage ??
        null,
      ...recoveryReceiptGraphGeneratedFrom(source.nextAction),
      relatedHandoffs: relatedHandoffsForNextAction({
        nextAction: source.nextAction,
        proofGraph: source.proofGraph,
        hostedMatrix: source.hostedMatrix,
      }),
      stabilityStatus: source.nextAction.stabilityTrace.status,
      selectionTrace: {
        strategy: selectionTraceStrategy,
        candidateCount: source.nextAction.selectionTrace.candidateCount,
        selectedArtifactId: source.nextAction.selectionTrace.selectedArtifactId,
        candidateIds: source.nextAction.selectionTrace.candidates.map(
          (candidate) => candidate.id,
        ),
      },
      releaseReadinessTrace: {
        strategy: releaseReadinessTraceStrategy,
        candidateCount: source.nextAction.releaseReadinessTrace.candidateCount,
        selectedUnprovenId:
          source.nextAction.releaseReadinessTrace.selectedUnprovenId,
        candidateIds: source.nextAction.releaseReadinessTrace.candidates.map(
          (candidate) => candidate.id,
        ),
        selectedCandidate:
          selectedReleaseReadinessCandidateForNextAction(source.nextAction),
      },
      localReadinessDependencyTrace: {
        strategy: source.nextAction.localReadinessDependencyTrace.strategy,
        candidateCount:
          source.nextAction.localReadinessDependencyTrace.candidateCount,
        selectedCheckId:
          source.nextAction.localReadinessDependencyTrace.selectedCheckId,
        candidateIds: source.nextAction.localReadinessDependencyTrace.candidates.map(
          (candidate) => candidate.id,
        ),
      },
      stabilityTrace: {
        strategy: source.nextAction.stabilityTrace.strategy,
        status: source.nextAction.stabilityTrace.status,
        selected: source.nextAction.stabilityTrace.selected,
        retryClickCount: source.nextAction.stabilityTrace.retryClickCount,
        domFallbackCount: source.nextAction.stabilityTrace.domFallbackCount,
        forceFallbackCount: source.nextAction.stabilityTrace.forceFallbackCount,
        failureCount: source.nextAction.stabilityTrace.failureCount,
      },
      seedProofLaneCoverageTrace: {
        strategy: source.nextAction.seedProofLaneCoverageTrace.strategy,
        status: source.nextAction.seedProofLaneCoverageTrace.status,
        selected: source.nextAction.seedProofLaneCoverageTrace.selected,
        unclassifiedLaneCount:
          source.nextAction.seedProofLaneCoverageTrace.unclassifiedLaneCount,
        unclassifiedLaneIds:
          source.nextAction.seedProofLaneCoverageTrace.unclassifiedLaneIds,
      },
      proofGraphDestinationSummaryTrace:
        normalizeProofGraphDestinationSummaryTrace(
          source.nextAction.proofGraphDestinationSummaryTrace,
        ),
      proofGraphDiagnosticSummaryTrace: {
        strategy: source.nextAction.proofGraphDiagnosticSummaryTrace.strategy,
        status: source.nextAction.proofGraphDiagnosticSummaryTrace.status,
        source: source.nextAction.proofGraphDiagnosticSummaryTrace.source,
        selected: source.nextAction.proofGraphDiagnosticSummaryTrace.selected,
        diagnosticCount:
          source.nextAction.proofGraphDiagnosticSummaryTrace.diagnosticCount,
        promotesFreshnessCount:
          source.nextAction.proofGraphDiagnosticSummaryTrace
            .promotesFreshnessCount,
        terminalArtifactCount:
          source.nextAction.proofGraphDiagnosticSummaryTrace
            .terminalArtifactCount,
        rows: source.nextAction.proofGraphDiagnosticSummaryTrace.rows.map(
          (row) => ({
            id: row.id,
            status: row.status,
            artifact: row.artifact,
            diagnosticReason: row.diagnosticReason,
            proofCommand: row.proofCommand,
            recoveryCommand: row.recoveryCommand,
            promotesFreshness: row.promotesFreshness,
            terminalArtifact: row.terminalArtifact,
          }),
        ),
      },
      replacementRaceReloadTrace: {
        strategy: source.nextAction.replacementRaceReloadTrace.strategy,
        status: source.nextAction.replacementRaceReloadTrace.status,
        requiredCellCount:
          source.nextAction.replacementRaceReloadTrace.requiredCellCount,
        coveredCellCount:
          source.nextAction.replacementRaceReloadTrace.coveredCellCount,
        gapCount: source.nextAction.replacementRaceReloadTrace.gapCount,
        cellIds: source.nextAction.replacementRaceReloadTrace.cells.map(
          (cell) => cell.id,
        ),
      },
      hostConcurrentRaceReloadTrace: {
        strategy: source.nextAction.hostConcurrentRaceReloadTrace.strategy,
        status: source.nextAction.hostConcurrentRaceReloadTrace.status,
        requiredCellCount:
          source.nextAction.hostConcurrentRaceReloadTrace.requiredCellCount,
        coveredCellCount:
          source.nextAction.hostConcurrentRaceReloadTrace.coveredCellCount,
        gapCount: source.nextAction.hostConcurrentRaceReloadTrace.gapCount,
        cellIds: source.nextAction.hostConcurrentRaceReloadTrace.cells.map(
          (cell) => cell.id,
        ),
      },
      playerConcurrentActionReloadTrace: {
        strategy: source.nextAction.playerConcurrentActionReloadTrace.strategy,
        status: source.nextAction.playerConcurrentActionReloadTrace.status,
        requiredCellCount:
          source.nextAction.playerConcurrentActionReloadTrace.requiredCellCount,
        coveredCellCount:
          source.nextAction.playerConcurrentActionReloadTrace.coveredCellCount,
        gapCount: source.nextAction.playerConcurrentActionReloadTrace.gapCount,
        cellIds: source.nextAction.playerConcurrentActionReloadTrace.cells.map(
          (cell) => cell.id,
        ),
      },
      cohostDeadlineRaceReloadTrace: {
        strategy: source.nextAction.cohostDeadlineRaceReloadTrace.strategy,
        status: source.nextAction.cohostDeadlineRaceReloadTrace.status,
        requiredCellCount:
          source.nextAction.cohostDeadlineRaceReloadTrace.requiredCellCount,
        coveredCellCount:
          source.nextAction.cohostDeadlineRaceReloadTrace.coveredCellCount,
        gapCount: source.nextAction.cohostDeadlineRaceReloadTrace.gapCount,
        cellIds: source.nextAction.cohostDeadlineRaceReloadTrace.cells.map(
          (cell) => cell.id,
        ),
      },
      raceCoveragePromotedMilestones: {
        status: source.nextAction.raceCoveragePromotedMilestones.status,
        cellCount: source.nextAction.raceCoveragePromotedMilestones.cellCount,
        provenCellCount:
          source.nextAction.raceCoveragePromotedMilestones.provenCellCount,
        reloadCoveredCellCount:
          source.nextAction.raceCoveragePromotedMilestones.reloadCoveredCellCount,
        groupCount: source.nextAction.raceCoveragePromotedMilestones.groupCount,
        passedGroupCount:
          source.nextAction.raceCoveragePromotedMilestones.passedGroupCount,
        requiredCellCount:
          source.nextAction.raceCoveragePromotedMilestones.requiredCellCount,
        coveredCellCount:
          source.nextAction.raceCoveragePromotedMilestones.coveredCellCount,
        gapCount: source.nextAction.raceCoveragePromotedMilestones.gapCount,
        groupIds: source.nextAction.raceCoveragePromotedMilestones.groups.map(
          (group) => group.id,
        ),
      },
      staleConflictMessageTrace: {
        strategy: source.nextAction.staleConflictMessageTrace.strategy,
        status: source.nextAction.staleConflictMessageTrace.status,
        requiredLaneCount: source.nextAction.staleConflictMessageTrace.requiredLaneCount,
        coveredLaneCount: source.nextAction.staleConflictMessageTrace.coveredLaneCount,
        gapCount: source.nextAction.staleConflictMessageTrace.gapCount,
        laneIds: source.nextAction.staleConflictMessageTrace.laneIds,
        surfaceCoverage: source.nextAction.staleConflictMessageTrace.surfaceCoverage,
        surfaces: source.nextAction.staleConflictMessageTrace.surfaces,
      },
      hostStaleControlTrace: {
        strategy: source.nextAction.hostStaleControlTrace.strategy,
        status: source.nextAction.hostStaleControlTrace.status,
        requiredLaneCount: source.nextAction.hostStaleControlTrace.requiredLaneCount,
        coveredLaneCount: source.nextAction.hostStaleControlTrace.coveredLaneCount,
        gapCount: source.nextAction.hostStaleControlTrace.gapCount,
        laneIds: source.nextAction.hostStaleControlTrace.laneIds,
      },
    },
    adminRoleSurface,
    }),
    assertEvidence: assertNextActionAdminProof,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(nextActionAdminProofCase());
  const driftNextActionPath =
    await writeProofGraphDestinationSummaryDriftNextActionFixture();
  await runAdminAuditProof(
    nextActionAdminProofCase({
      nextActionSourcePath: driftNextActionPath,
      evidenceSourcePath:
        proofGraphDestinationSummaryDriftNextActionAdminProofPath,
      smokeName:
        "dev-test-game-next-action-admin-proof:proof-graph-destination-summary-drift",
      stage: "next-action-admin-proof-destination-summary-drift-listen",
    }),
  );
}

export async function writeProofGraphDestinationSummaryDriftNextActionFixture({
  sourcePath = process.env.FMARCH_DEV_TEST_GAME_NEXT_ACTION ??
    defaultNextActionPath,
  outputPath = proofGraphDestinationSummaryDriftNextActionPath,
} = {}) {
  const absoluteSourcePath = path.resolve(repoRoot, sourcePath);
  const absoluteOutputPath = path.resolve(repoRoot, outputPath);
  const source = JSON.parse(await readFile(absoluteSourcePath, "utf8"));
  const fixture = proofGraphDestinationSummaryDriftNextActionFixture(source);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(fixture, null, 2)}\n`);
  return path.relative(repoRoot, absoluteOutputPath);
}

export function proofGraphDestinationSummaryDriftNextActionFixture(nextAction) {
  const source = assertDevTestGameNextAction(nextAction);
  const sourceTrace = source.proofGraphDestinationSummaryTrace ?? {};
  const productionFeatureTargetCount = Math.max(
    1,
    Number(sourceTrace.productionFeatureTargetCount ?? 0),
  );
  const roleUrlDestinationCount = Number(
    sourceTrace.roleUrlDestinationCount ?? 0,
  );
  const totalDestinationCount = productionFeatureTargetCount + 1;
  const adminAuditDestinationCount = Math.max(
    0,
    totalDestinationCount - roleUrlDestinationCount,
  );
  const driftCount = 1;
  const proofGraphDestinationSummary = {
    source: sourceTrace.source || devTestGameProofGraphPath,
    summaryStatus: "drift",
    totalDestinationCount,
    productionFeatureTargetCount,
    adminAuditDestinationCount,
    roleUrlDestinationCount,
    driftCount,
    coreLoopRecoveryDestinationRequiredCount:
      sourceTrace.coreLoopRecoveryDestinationRequiredCount ?? 0,
    coreLoopRecoveryDestinationCoveredCount:
      sourceTrace.coreLoopRecoveryDestinationCoveredCount ?? 0,
    coreLoopRecoveryDestinationMissingCount:
      sourceTrace.coreLoopRecoveryDestinationMissingCount ?? 0,
    coreLoopRecoveryDestinationMissingIds:
      sourceTrace.coreLoopRecoveryDestinationMissingIds ?? [],
    buildSlice:
      "Refresh the proof graph so its production-feature destination summary and core-loop recovery destinations match the shared proof registries before next-action or readiness guidance is trusted.",
    proofTarget: devTestGameProofGraphPath,
  };
  return assertDevTestGameNextAction({
    ...source,
    generatedFrom: {
      ...source.generatedFrom,
      proofGraph: source.generatedFrom?.proofGraph ?? devTestGameProofGraphPath,
      proofGraphDestinationSummaryStatus: "drifted",
      proofGraphDestinationSummaryDriftCount: driftCount,
      coreLoopRecoveryDestinationMissingCount:
        proofGraphDestinationSummary.coreLoopRecoveryDestinationMissingCount,
      syntheticNextActionFixture:
        "proof-graph-destination-summary-drift-admin-proof",
    },
    nextAction: {
      command: `npm run ${devTestGameProofGraphCommand}`,
      reason: "proof-graph-destination-summary-drift",
      status: "blocked",
      proofGraphDestinationSummary,
    },
    selectedOperatorHandoff: null,
    selectionTrace: {
      strategy: selectionTraceStrategy,
      candidateCount: 0,
      selectedArtifactId: null,
      candidates: [],
    },
    stabilityTrace: cleanProofStabilityTrace(source.stabilityTrace),
    proofGraphDestinationSummaryTrace: buildProofGraphDestinationSummaryTrace({
      strategy: proofGraphDestinationSummaryTraceStrategy,
      status: "drifted",
      source: proofGraphDestinationSummary.source,
      summaryStatus: proofGraphDestinationSummary.summaryStatus,
      totalDestinationCount,
      productionFeatureTargetCount,
      adminAuditDestinationCount,
      roleUrlDestinationCount,
      driftCount,
      coreLoopRecoveryDestinationRequiredCount:
        proofGraphDestinationSummary.coreLoopRecoveryDestinationRequiredCount,
      coreLoopRecoveryDestinationCoveredCount:
        proofGraphDestinationSummary.coreLoopRecoveryDestinationCoveredCount,
      coreLoopRecoveryDestinationMissingCount:
        proofGraphDestinationSummary.coreLoopRecoveryDestinationMissingCount,
      coreLoopRecoveryDestinationMissingIds:
        proofGraphDestinationSummary.coreLoopRecoveryDestinationMissingIds,
    }),
    proofGraphDiagnosticSummaryTrace: normalizeProofGraphDiagnosticSummaryTrace(
      source.proofGraphDiagnosticSummaryTrace,
    ),
    seedProofLaneCoverageTrace: cleanSeedProofLaneCoverageTrace(
      source.seedProofLaneCoverageTrace,
    ),
    localReadinessDependencyTrace: {
      strategy: localReadinessDependencyTraceStrategy,
      candidateCount: 0,
      selectedCheckId: null,
      candidates: [],
    },
  });
}

export function assertNextActionAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-next-action-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-next-action-admin-surface"
  ) {
    throw new Error("next-action admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("next-action admin proof did not prove admin overview click-through");
  }
  assertSelectionTrace(evidence.generatedFrom?.selectionTrace, {
    label: "next-action admin proof selection trace",
  });
  assertReleaseReadinessTrace(evidence.generatedFrom?.releaseReadinessTrace, {
    label: "next-action admin proof release-readiness trace",
  });
  assertPriorityTraceVisibleChecks(
    "selection",
    evidence.generatedFrom?.selectionTrace,
    evidence.adminRoleSurface?.visibleChecks,
    { label: "next-action admin proof selection trace" },
  );
  assertPriorityTraceVisibleChecks(
    "releaseReadiness",
    evidence.generatedFrom?.releaseReadinessTrace,
    evidence.adminRoleSurface?.visibleChecks,
    { label: "next-action admin proof release-readiness trace" },
  );
  const selectedCandidate =
    evidence.generatedFrom.releaseReadinessTrace.selectedCandidate;
  const selectedOperatorHandoff = evidence.generatedFrom?.selectedOperatorHandoff;
  if (selectedOperatorHandoff !== null && selectedOperatorHandoff !== undefined) {
    const statuses = evidence.adminRoleSurface?.visibleCheckStatuses ?? {};
    if (
      !String(statuses["selected-operator-handoff"] ?? "").includes(
        selectedOperatorHandoff.firstMissingInputId,
      ) ||
      !String(statuses["selected-operator-handoff-role-url"] ?? "").includes(
        selectedOperatorHandoff.selectedProductionFeatureRoleUrl,
      ) ||
      !String(statuses["selected-operator-handoff-feature-node"] ?? "").includes(
        selectedOperatorHandoff.selectedProductionFeatureGraphNodeId,
      )
    ) {
      throw new Error(
        "next-action admin proof missing selected operator handoff rows",
      );
    }
  }
  if (
    selectedCandidate?.id === "hosted-production-identity" &&
    evidence.generatedFrom?.command?.includes(
      "test:dev-test-game-identity:operator",
    )
  ) {
    const statuses = evidence.adminRoleSurface?.visibleCheckStatuses ?? {};
    if (
      !String(statuses["selected-next-command"] ?? "").includes(
        evidence.generatedFrom.command,
      ) ||
      !String(statuses["selected-proof-target"] ?? "").includes(
        selectedCandidate.proofTarget,
      ) ||
      !String(statuses["selected-proof-boundary"] ?? "").includes(
        selectedCandidate.proofBoundary,
      ) ||
      evidence.generatedFrom.unprovenId !== "hosted-production-identity"
    ) {
      throw new Error(
        "next-action admin proof missing operator-aware hosted identity recommendation rows",
      );
    }
  }
  assertPreReadinessTrace(
    preReadinessTraceKeys.proofStability,
    evidence.generatedFrom?.stabilityTrace,
    { label: "next-action admin proof stability trace" },
  );
  assertPreReadinessTraceVisibleChecks(
    preReadinessTraceKeys.seedProofLaneCoverage,
    evidence.generatedFrom?.seedProofLaneCoverageTrace,
    evidence.adminRoleSurface?.visibleChecks,
    { label: "next-action admin proof seed proof-lane coverage trace" },
  );
  assertPreReadinessTraceVisibleChecks(
    preReadinessTraceKeys.proofGraphDestinationSummary,
    evidence.generatedFrom?.proofGraphDestinationSummaryTrace,
    evidence.adminRoleSurface?.visibleChecks,
    { label: "next-action admin proof destination-summary trace" },
  );
  assertPreReadinessTraceVisibleChecks(
    preReadinessTraceKeys.localReadinessDependency,
    evidence.generatedFrom?.localReadinessDependencyTrace,
    evidence.adminRoleSurface?.visibleChecks,
    { label: "next-action admin proof local readiness dependency trace" },
  );
  assertNextActionAdminProofGraphDiagnosticSummaryTrace(evidence);
  assertNextActionAdminPhaseLocalNextActionSnapshots(evidence);
  assertNextActionAdminCoreLoopRecoveryDestinationCoverage(evidence);
  assertRecoveryTrace(
    recoveryTraceKeys.replacementRaceReload,
    evidence.generatedFrom?.replacementRaceReloadTrace,
    {
      label: "next-action admin proof replacement-race reload trace",
      requireFullTrace: false,
    },
  );
  assertRecoveryTrace(
    recoveryTraceKeys.hostConcurrentRaceReload,
    evidence.generatedFrom?.hostConcurrentRaceReloadTrace,
    {
      label: "next-action admin proof host concurrent race-reload trace",
      requireFullTrace: false,
    },
  );
  assertRecoveryTrace(
    recoveryTraceKeys.playerConcurrentActionReload,
    evidence.generatedFrom?.playerConcurrentActionReloadTrace,
    {
      label: "next-action admin proof player concurrent action reload trace",
      requireFullTrace: false,
    },
  );
  assertRecoveryTrace(
    recoveryTraceKeys.cohostDeadlineRaceReload,
    evidence.generatedFrom?.cohostDeadlineRaceReloadTrace,
    {
      label: "next-action admin proof cohost deadline race reload trace",
      requireFullTrace: false,
    },
  );
  if (
    !["passed", "gapped", "unavailable"].includes(
      evidence.generatedFrom?.raceCoveragePromotedMilestones?.status,
    ) ||
    !Number.isInteger(
      evidence.generatedFrom.raceCoveragePromotedMilestones.cellCount,
    ) ||
    !Number.isInteger(
      evidence.generatedFrom.raceCoveragePromotedMilestones.groupCount,
    ) ||
    !Array.isArray(evidence.generatedFrom.raceCoveragePromotedMilestones.groupIds)
  ) {
    throw new Error(
      "next-action admin proof is missing race coverage promoted milestone evidence",
    );
  }
  assertRecoveryTrace(
    recoveryTraceKeys.staleConflictMessage,
    evidence.generatedFrom?.staleConflictMessageTrace,
    { label: "next-action admin proof stale conflict-message trace" },
  );
  assertRecoveryTrace(
    recoveryTraceKeys.hostStaleControl,
    evidence.generatedFrom?.hostStaleControlTrace,
    { label: "next-action admin proof host stale-control trace" },
  );
  assertNextActionAdminRecoveryReceiptGraphs(evidence.generatedFrom);
  assertAdminRoleSurfaceEvidenceArtifact({
    adminRoleSurface: evidence.adminRoleSurface,
    artifact: defaultNextActionPath,
    proofName: "next-action admin proof",
  });
  for (const checkId of requiredChecksForEvidence(evidence)) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`next-action admin proof missing visible check: ${checkId}`);
    }
  }
  const hostedIdentityFamilyBatch =
    evidence.generatedFrom?.unprovenHostedIdentityFamilyBatch;
  if (hostedIdentityFamilyBatch !== null && hostedIdentityFamilyBatch !== undefined) {
    const visibleText =
      evidence.adminRoleSurface?.visibleCheckStatuses?.[
        hostedIdentityFamilyBatch.id
      ] ?? "";
    const expectedText = hostedIdentityFamilyBatchStatusText(
      hostedIdentityFamilyBatch,
    );
    if (!String(visibleText).includes(expectedText)) {
      throw new Error(
        "next-action admin proof missing hosted identity family batch predicate row",
      );
    }
  }
  const hostedIdentityProofGraphEdges =
    evidence.generatedFrom?.unprovenHostedIdentityProofGraphEdges;
  if (
    hostedIdentityProofGraphEdges !== null &&
    hostedIdentityProofGraphEdges !== undefined
  ) {
    const expectedRows = hostedIdentityProofGraphDependencyStatuses(
      hostedIdentityProofGraphEdges,
    );
    for (const [rowId, expectedText] of Object.entries(expectedRows)) {
      const visibleText =
        evidence.adminRoleSurface?.visibleCheckStatuses?.[rowId] ?? "";
      if (!String(visibleText).includes(expectedText)) {
        throw new Error(
          `next-action admin proof missing hosted identity proof graph dependency row: ${rowId}`,
        );
      }
    }
  }
  const relatedLinkId = evidence.generatedFrom?.unprovenProofGraphNodeId;
  if (
    typeof relatedLinkId === "string" &&
    !evidence.adminRoleSurface?.visibleRelatedLinks?.includes(relatedLinkId)
  ) {
    throw new Error("next-action admin proof missing selected role URL handoff");
  }
  assertSelectedGraphDestinationCases(evidence);
  if (
    evidence.generatedFrom?.unprovenSpineTarget !== null &&
    evidence.generatedFrom?.unprovenSpineTarget !== undefined
  ) {
    const declaration = evidence.generatedFrom.unprovenProductionFeatureSpineTarget;
    const drilldown = evidence.generatedFrom.unprovenSpineDrilldown;
    const target = evidence.generatedFrom.unprovenSpineTarget;
    const provenance = evidence.generatedFrom.unprovenSpineProvenance;
    const graphSelection =
      evidence.generatedFrom.unprovenSelectedProductionFeatureGraph;
    if (
      typeof declaration?.featureSlotId !== "string" ||
      typeof declaration?.cycleId !== "string" ||
      typeof declaration?.roleUrlId !== "string" ||
      typeof declaration?.checkpointId !== "string" ||
      typeof declaration?.adminCheckId !== "string" ||
      typeof target.featureSlotId !== "string" ||
      typeof target.cycleId !== "string" ||
      typeof target.roleUrlId !== "string" ||
      typeof target.roleUrl !== "string" ||
      typeof target.checkpointId !== "string" ||
      typeof target.adminCheckId !== "string" ||
      typeof target.browserProofCommand !== "string" ||
      typeof target.sourceProofArtifact !== "string" ||
      target.sourceProofArtifact.length === 0 ||
      target.coverageDecision === null ||
      typeof target.coverageDecision !== "object" ||
      target.featureSlotId !== declaration.featureSlotId ||
      target.adminCheckId !== declaration.adminCheckId ||
      typeof drilldown?.featureSlotId !== "string" ||
      typeof drilldown?.cycleRowId !== "string" ||
      typeof drilldown?.roleUrlRowId !== "string" ||
      typeof drilldown?.checkpointRowId !== "string" ||
      typeof drilldown?.adminCheckId !== "string" ||
      typeof drilldown?.rerunCommand !== "string" ||
      drilldown.sourceProofArtifact !== target.sourceProofArtifact ||
      drilldown.featureSlotId !== declaration.featureSlotId ||
      drilldown.adminCheckId !== declaration.adminCheckId ||
      !selectedProductionFeatureSpineMatchesProvenance({
        provenanceCase: provenance,
        declaration,
        target,
        drilldown,
        graphSelection,
      }) ||
      !evidence.adminRoleSurface?.visibleChecks?.includes(
        "selected-feature-spine-declaration",
      ) ||
      !evidence.adminRoleSurface?.visibleChecks?.includes(
        "selected-spine-target",
      ) ||
      !evidence.adminRoleSurface?.visibleChecks?.includes(
        "selected-spine-drilldown",
      ) ||
      !evidence.adminRoleSurface?.visibleChecks?.includes(
        "selected-spine-admin-check",
      ) ||
      !evidence.adminRoleSurface?.visibleChecks?.includes(
        "selected-spine-rerun-command",
      ) ||
      !evidence.adminRoleSurface?.visibleChecks?.includes(
        "selected-spine-browser-proof",
      ) ||
      !evidence.adminRoleSurface?.visibleChecks?.includes(
        "selected-spine-source-artifact",
      ) ||
      !evidence.adminRoleSurface?.visibleChecks?.includes(
        "selected-spine-coverage-decision",
      )
    ) {
      throw new Error("next-action admin proof missing selected spine target row");
    }
  }
  const localCheckId = evidence.generatedFrom?.localCheckId;
  if (
    typeof localCheckId === "string" &&
    !evidence.adminRoleSurface?.visibleChecks?.includes(localCheckId)
  ) {
    throw new Error("next-action admin proof missing local readiness check row");
  }
  if (
    typeof localCheckId === "string" &&
    !evidence.adminRoleSurface?.visibleRelatedLinks?.includes(localCheckId)
  ) {
    throw new Error("next-action admin proof missing local readiness role URL");
  }
  if (
    typeof evidence.generatedFrom?.seedProofLaneCoverageRoleUrl === "string" &&
    !evidence.adminRoleSurface?.visibleRelatedLinks?.includes(
      "seed-proof-lane-coverage",
    )
  ) {
    throw new Error("next-action admin proof missing seed coverage role URL");
  }
  if (evidence.generatedFrom?.proofGraphDestinationSummary !== null) {
    if (
      !evidence.adminRoleSurface?.visibleChecks?.includes(
        "proof-graph-destination-summary",
      ) ||
      !evidence.adminRoleSurface?.visibleChecks?.includes(
        "proof-graph-destination-summary-drift-count",
      ) ||
      !evidence.adminRoleSurface?.visibleRelatedLinks?.includes(
        "proof-graph-destination-summary",
      )
    ) {
      throw new Error(
        "next-action admin proof missing proof graph destination-summary recovery rows",
      );
    }
  }
  for (const relatedHandoff of evidence.generatedFrom?.relatedHandoffs ?? []) {
    assertAdminAuditRelatedHandoff({
      adminRoleSurface: evidence.adminRoleSurface,
      handoff: relatedHandoff,
      proofName: "next-action admin proof",
    });
  }
  const checklist = evidence.generatedFrom?.unprovenHostedHandoffChecklist;
  if (checklist !== null && checklist !== undefined) {
    if (
      checklist.status !== "blocked" ||
      !Array.isArray(checklist.inputIds) ||
      !Array.isArray(checklist.blockedCheckIds)
    ) {
      throw new Error("next-action admin proof has malformed hosted handoff checklist");
    }
    for (const inputId of checklist.inputIds) {
      if (
        !evidence.adminRoleSurface?.visibleHostedHandoffInputs?.includes(inputId)
      ) {
        throw new Error(
          `next-action admin proof missing hosted handoff input: ${inputId}`,
        );
      }
    }
    for (const [inputId, expected] of Object.entries(
      hostedHandoffInputValues(checklist),
    )) {
      const visibleText =
        evidence.adminRoleSurface?.visibleHostedHandoffInputValues?.[inputId] ??
        "";
      if (!visibleText.includes(expected)) {
        throw new Error(
          `next-action admin proof missing hosted handoff input value: ${inputId}`,
        );
      }
    }
    for (const checkId of checklist.blockedCheckIds) {
      if (
        !evidence.adminRoleSurface?.visibleHostedHandoffBlockedChecks?.includes(
          checkId,
        )
      ) {
        throw new Error(
          `next-action admin proof missing hosted handoff blocked check: ${checkId}`,
        );
      }
    }
    for (const groupId of hostedHandoffGroupIds(checklist)) {
      if (
        !evidence.adminRoleSurface?.visibleHostedHandoffGroups?.includes(groupId)
      ) {
        throw new Error(
          `next-action admin proof missing hosted handoff group: ${groupId}`,
        );
      }
    }
    for (const section of hostedHandoffInputSections(checklist)) {
      if (
        !evidence.adminRoleSurface?.visibleHostedHandoffInputSections?.includes(
          section.id,
        )
      ) {
        throw new Error(
          `next-action admin proof missing hosted handoff input section: ${section.id}`,
        );
      }
    }
    for (const row of hostedHandoffSectionInputRows(checklist)) {
      if (
        !evidence.adminRoleSurface?.visibleHostedHandoffSectionInputs?.includes(
          row.id,
        )
      ) {
        throw new Error(
          `next-action admin proof missing hosted handoff section input: ${row.id}`,
        );
      }
    }
    const summary = evidence.adminRoleSurface?.visibleHostedHandoffSummary;
    if (
      summary?.status !== checklist.status ||
      summary?.preflightStatus !== checklist.preflightStatus ||
      summary?.command !== checklist.command ||
      summary?.proofTarget !== checklist.proofTarget
    ) {
      throw new Error(
        "next-action admin proof missing hosted handoff blocked summary",
      );
    }
    if (checklist.blockedReceipt !== undefined) {
      const receipt =
        evidence.adminRoleSurface?.visibleHostedHandoffBlockedReceipt;
      if (
        receipt?.status !== checklist.blockedReceipt.status ||
        receipt?.operatorAction !== checklist.blockedReceipt.operatorAction ||
        receipt?.localVsHostedBoundary !==
          checklist.blockedReceipt.localVsHostedBoundary ||
        receipt?.nextProofTarget !== checklist.blockedReceipt.nextProofTarget ||
        JSON.stringify(receipt?.missingRequiredInputs ?? []) !==
          JSON.stringify(checklist.blockedReceipt.missingRequiredInputs ?? []) ||
        JSON.stringify(receipt?.firstMissingOperatorArtifact ?? null) !==
          JSON.stringify(
            visibleFirstMissingOperatorArtifact(
              checklist.blockedReceipt.firstMissingOperatorArtifact,
            ),
          ) ||
        JSON.stringify(receipt?.blockedOperatorPacket ?? null) !==
          JSON.stringify(
            visibleBlockedOperatorPacket(
              checklist.blockedReceipt.blockedOperatorPacket,
            ),
          )
      ) {
        throw new Error(
          "next-action admin proof missing hosted handoff blocked receipt",
        );
      }
    }
    const operatorGate = checklist.operatorEvidenceGate;
    if (operatorGate !== undefined) {
      if (
        !evidence.adminRoleSurface?.visibleHostedIdentityOperatorGate?.includes(
          operatorGate.id,
        ) ||
        !(
          evidence.adminRoleSurface
            ?.visibleHostedIdentityOperatorGateStatuses?.[operatorGate.id] ?? ""
        ).includes(operatorGate.requiredRawEvidencePathKind)
      ) {
        throw new Error(
          "next-action admin proof missing hosted identity operator evidence gate",
        );
      }
      for (const family of operatorGate.requiredEvidenceFamilies ?? []) {
        if (
          !evidence.adminRoleSurface
            ?.visibleHostedIdentityOperatorGateFamilies?.includes(family.id)
        ) {
          throw new Error(
            `next-action admin proof missing hosted identity operator evidence family: ${family.id}`,
          );
        }
      }
      for (const kind of operatorGate.rejectedRawEvidencePathKinds ?? []) {
        if (
          !evidence.adminRoleSurface
            ?.visibleHostedIdentityOperatorGateRejectedPathKinds?.includes(kind)
        ) {
          throw new Error(
            `next-action admin proof missing hosted identity rejected evidence path kind: ${kind}`,
          );
        }
      }
    }
    const progressionSummary = checklist.progressionSummary;
    if (progressionSummary !== undefined) {
      for (const progression of progressionSummary.progressions ?? []) {
        if (
          !evidence.adminRoleSurface?.visibleHostedIdentityProgressions?.includes(
            progression.id,
          )
        ) {
          throw new Error(
            `next-action admin proof missing hosted identity progression: ${progression.id}`,
          );
        }
        const visibleText =
          evidence.adminRoleSurface
            ?.visibleHostedIdentityProgressionStatuses?.[progression.id] ?? "";
        if (!visibleText.includes(progression.adminProofTarget)) {
          throw new Error(
            `next-action admin proof missing hosted identity progression target: ${progression.id}`,
          );
        }
      }
    }
  }
  return evidence;
}

function visibleFirstMissingOperatorArtifact(artifact) {
  if (artifact === null || artifact === undefined) {
    return null;
  }
  const drilldown = artifact.roleSurfaceDrilldown ?? {};
  return {
    inputId: String(artifact.inputId ?? ""),
    checkId: String(artifact.checkId ?? ""),
    sectionId: String(artifact.sectionId ?? ""),
    sectionLabel: String(artifact.sectionLabel ?? ""),
    requiredEvidence: String(artifact.requiredEvidence ?? ""),
    purpose: String(artifact.purpose ?? ""),
    proofTarget: String(artifact.proofTarget ?? ""),
    roleSurfaceDrilldown: {
      localCapabilityRoleUrl: String(drilldown.localCapabilityRoleUrl ?? ""),
      handoffRoleUrl: String(drilldown.handoffRoleUrl ?? ""),
      proofGraphNodeId: String(drilldown.proofGraphNodeId ?? ""),
      productionFeatureGraphNodeId: String(
        drilldown.productionFeatureGraphNodeId ?? "",
      ),
      proofGraphEvidencePath: String(drilldown.proofGraphEvidencePath ?? ""),
    },
  };
}

function recoveryReceiptGraphGeneratedFrom(nextAction) {
  return Object.fromEntries(
    recoveryReceiptGraphDescriptors.map((descriptor) => [
      descriptor.nextActionGeneratedFromKey,
      nextAction.generatedFrom?.[descriptor.nextActionGeneratedFromKey] ?? null,
    ]),
  );
}

function assertNextActionAdminProofGraphDiagnosticSummaryTrace(evidence) {
  assertProofGraphDiagnosticSummaryVisibleChecks(
    evidence.generatedFrom?.proofGraphDiagnosticSummaryTrace,
    evidence.adminRoleSurface?.visibleChecks,
    { label: "next-action admin proof diagnostic summary trace" },
  );
}

function assertNextActionAdminPhaseLocalNextActionSnapshots(evidence) {
  const snapshots = evidence.generatedFrom?.phaseLocalNextActionSnapshots;
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return;
  }
  const visibleRows =
    evidence.adminRoleSurface?.visiblePhaseLocalNextActionSnapshots ?? [];
  const visibleStatuses =
    evidence.adminRoleSurface?.visiblePhaseLocalNextActionSnapshotStatuses ?? {};
  const visibleDrilldowns =
    evidence.adminRoleSurface?.visiblePhaseLocalNextActionDrilldowns ?? [];
  for (const snapshot of snapshots) {
    if (
      snapshot.status !== "recorded" ||
      snapshot.canonicalArtifact !== "target/dev-test-game/next-action.json" ||
      !String(snapshot.artifact ?? "").startsWith(
        "target/dev-test-game/next-action-",
      ) ||
      snapshot.proofCommand !== "test:dev-test-game-next-action" ||
      !visibleRows.includes(snapshot.id)
    ) {
      throw new Error(
        `next-action admin proof phase-local snapshot drifted: ${snapshot?.id}`,
      );
    }
    const visibleText = String(visibleStatuses[snapshot.id] ?? "");
    for (const token of [
      snapshot.phaseLocalNextActionId,
      snapshot.artifact,
      snapshot.canonicalArtifact,
      snapshot.nextActionEdgeRowId,
      snapshot.manifestEdgeRowId,
      snapshot.proofCommand,
    ]) {
      if (!visibleText.includes(String(token ?? ""))) {
        throw new Error(
          `next-action admin proof missing phase-local snapshot text ${token}: ${snapshot.id}`,
        );
      }
    }
    const drilldown = visibleDrilldowns.find((item) => item.id === snapshot.id);
    if (
      drilldown?.clickedThrough !== true ||
      drilldown.artifact !== snapshot.artifact ||
      drilldown.href !== phaseLocalNextActionArtifactHref(snapshot.artifact) ||
      drilldown.canonicalArtifact !== snapshot.canonicalArtifact ||
      drilldown.phaseLocalNextActionId !== snapshot.phaseLocalNextActionId ||
      drilldown.proofCommand !== snapshot.proofCommand
    ) {
      throw new Error(
        `next-action admin proof missing phase-local snapshot drilldown: ${snapshot.id}`,
      );
    }
  }
}

function assertNextActionAdminRecoveryReceiptGraphs(generatedFrom) {
  for (const descriptor of recoveryReceiptGraphDescriptors) {
    assertRecoveryReceiptGraphSummary(
      generatedFrom?.[descriptor.nextActionGeneratedFromKey],
      descriptor,
      { label: "next-action admin proof" },
    );
  }
}

function phaseLocalNextActionArtifactHref(artifact) {
  const params = new URLSearchParams({
    game: "<seeded-game>",
    path: String(artifact ?? ""),
  });
  return `/admin/artifact?${params.toString()}`;
}

function assertNextActionAdminCoreLoopRecoveryDestinationCoverage(evidence) {
  const coverage = evidence.generatedFrom?.coreLoopRecoveryDestinationCoverage;
  if (coverage === null || coverage === undefined) {
    return;
  }
  if (
    coverage.id !== "core-loop-recovery-destination-coverage" ||
    coverage.status !== "passed" ||
    !Number.isInteger(coverage.recoveryCount) ||
    coverage.recoveryCount < 1 ||
    coverage.coveredCount !== coverage.recoveryCount ||
    !Array.isArray(coverage.rows) ||
    coverage.rows.length !== coverage.recoveryCount
  ) {
    throw new Error(
      "next-action admin proof core-loop recovery destination coverage drifted",
    );
  }
  const statuses = evidence.adminRoleSurface?.visibleCheckStatuses ?? {};
  if (
    !String(statuses[coverage.id] ?? "").includes(
      `${coverage.coveredCount}/${coverage.recoveryCount} recoveries`,
    )
  ) {
    throw new Error(
      "next-action admin proof missing core-loop recovery destination summary",
    );
  }
  for (const row of coverage.rows) {
    const rowId = `core-loop-recovery-destination:${String(row.id ?? "")}`;
    const visibleText = String(statuses[rowId] ?? "");
    if (
      row.status !== "passed" ||
      !visibleText.includes(String(row.adminRowId ?? "")) ||
      !visibleText.includes(String(row.proofGraphNodeId ?? "")) ||
      !visibleText.includes(String(row.nextActionEdgeRowId ?? ""))
    ) {
      throw new Error(
        `next-action admin proof missing core-loop recovery destination row: ${rowId}`,
      );
    }
  }
}

function recoveryReceiptGraphCheckIdsForEvidence(evidence) {
  return recoveryReceiptGraphDescriptors.flatMap((descriptor) =>
    evidence.generatedFrom?.[descriptor.nextActionGeneratedFromKey] === null ||
    evidence.generatedFrom?.[descriptor.nextActionGeneratedFromKey] === undefined
      ? []
      : [descriptor.checkId],
  );
}

function requiredChecksForNextAction(nextAction) {
  const checks = ["next-command", nextAction.nextAction.reason];
  if (nextAction.nextAction.artifact?.id !== undefined) {
    checks.push(nextAction.nextAction.artifact.id);
  }
  if (nextAction.nextAction.localCheck?.id !== undefined) {
    checks.push(nextAction.nextAction.localCheck.id);
  }
  if (nextAction.nextAction.unproven?.id !== undefined) {
    checks.push(
      nextAction.nextAction.unproven.id,
      "selected-proof-graph-node",
      "selected-proof-graph-destination",
    );
    if (nextAction.nextAction.unproven.hostedIdentityFamilyBatch !== undefined) {
      checks.push(nextAction.nextAction.unproven.hostedIdentityFamilyBatch.id);
    }
    if (
      nextAction.nextAction.unproven.hostedIdentityProofGraphEdges !== undefined
    ) {
      checks.push(
        ...hostedIdentityProofGraphDependencyCheckIds(
          nextAction.nextAction.unproven.hostedIdentityProofGraphEdges,
        ),
      );
    }
    if (selectedHostedIdentityOperatorCandidate(nextAction) !== null) {
      checks.push(
        "selected-next-command",
        "selected-proof-target",
        "selected-proof-boundary",
      );
    }
    if (nextAction.nextAction.unproven.spineTarget !== undefined) {
      checks.push("selected-feature-spine-declaration");
      checks.push("selected-spine-target");
      checks.push("selected-spine-drilldown");
      checks.push("selected-spine-admin-check");
      checks.push("selected-spine-rerun-command");
      checks.push("selected-spine-browser-proof");
      checks.push("selected-spine-source-artifact");
      checks.push("selected-spine-coverage-decision");
    }
    if (nextAction.selectedOperatorHandoff != null) {
      checks.push(
        "selected-operator-handoff",
        "selected-operator-handoff-role-url",
        "selected-operator-handoff-feature-node",
      );
    }
    if (
      nextAction.nextAction.unproven.selectedProductionFeatureGraph !== undefined
    ) {
      checks.push("selected-production-feature-graph-node");
      checks.push("selected-production-feature-graph-edge");
      checks.push("selected-production-feature-graph-browser-workbench");
      checks.push("selected-production-feature-graph-coverage-decision");
    }
  }
  checks.push(
    ...preReadinessTraceCheckIds(
      preReadinessTraceKeys.proofStability,
      nextAction.stabilityTrace,
    ),
  );
  if (nextAction.nextAction.seedProofLaneCoverage?.source !== undefined) {
    checks.push("seed-proof-lane-coverage");
  }
  if (nextAction.nextAction.proofGraphDestinationSummary?.source !== undefined) {
    checks.push(
      "proof-graph-destination-summary",
      "proof-graph-destination-summary-drift-count",
      "proof-graph-destination-summary-core-loop-recovery-coverage",
    );
  }
  if (nextAction.nextAction.sequenceDeferral !== undefined) {
    checks.push(
      "hosted-identity-sequence-deferral",
      "hosted-identity-sequence-promotion",
    );
    if (
      nextAction.nextAction.sequenceDeferral.localCapabilityConfidence !==
      undefined
    ) {
      checks.push("hosted-identity-local-capability-confidence");
      for (const check of nextAction.nextAction.sequenceDeferral
        .localCapabilityConfidence.checks ?? []) {
        checks.push(`hosted-identity-local-capability-${check.id}`);
      }
    }
  }
  if (nextAction.generatedFrom?.terminalBatchGraph !== undefined) {
    checks.push("terminal-proof-batch-graph");
  }
  if (nextAction.generatedFrom?.nextActionHandoffPair !== undefined) {
    checks.push(nextAction.generatedFrom.nextActionHandoffPair.id);
  }
  if (nextAction.generatedFrom?.coreLoopRecoveryDestinationCoverage !== undefined) {
    checks.push(
      ...coreLoopRecoveryDestinationCoverageCheckIds(
        nextAction.generatedFrom.coreLoopRecoveryDestinationCoverage,
      ),
    );
  }
  for (const descriptor of recoveryReceiptGraphDescriptors) {
    if (
      nextAction.generatedFrom?.[descriptor.nextActionGeneratedFromKey] !==
      undefined
    ) {
      checks.push(descriptor.checkId);
    }
  }
  checks.push(
    ...selectionTraceCheckIds(nextAction.selectionTrace),
  );
  checks.push(
    ...preReadinessTraceCheckIds(
      preReadinessTraceKeys.seedProofLaneCoverage,
      nextAction.seedProofLaneCoverageTrace,
    ),
  );
  checks.push(
    ...preReadinessTraceCheckIds(
      preReadinessTraceKeys.proofGraphDestinationSummary,
      nextAction.proofGraphDestinationSummaryTrace,
    ),
  );
  checks.push(
    ...proofGraphDiagnosticSummaryCheckIds(
      nextAction.proofGraphDiagnosticSummaryTrace,
    ),
  );
  checks.push(...releaseReadinessTraceCheckIds(nextAction.releaseReadinessTrace));
  checks.push(
    ...preReadinessTraceCheckIds(
      preReadinessTraceKeys.localReadinessDependency,
      nextAction.localReadinessDependencyTrace,
    ),
  );
  checks.push(
    ...recoveryTraceCheckIds(
      recoveryTraceKeys.replacementRaceReload,
      nextAction.replacementRaceReloadTrace,
    ),
  );
  checks.push(
    ...recoveryTraceCheckIds(
      recoveryTraceKeys.hostConcurrentRaceReload,
      nextAction.hostConcurrentRaceReloadTrace,
    ),
  );
  checks.push(
    ...recoveryTraceCheckIds(
      recoveryTraceKeys.playerConcurrentActionReload,
      nextAction.playerConcurrentActionReloadTrace,
    ),
  );
  checks.push(
    ...recoveryTraceCheckIds(
      recoveryTraceKeys.cohostDeadlineRaceReload,
      nextAction.cohostDeadlineRaceReloadTrace,
    ),
  );
  checks.push("race-coverage-promoted-milestones");
  checks.push(
    ...recoveryTraceCheckIds(
      recoveryTraceKeys.staleConflictMessage,
      nextAction.staleConflictMessageTrace,
    ),
  );
  checks.push(
    ...recoveryTraceCheckIds(
      recoveryTraceKeys.hostStaleControl,
      nextAction.hostStaleControlTrace,
    ),
  );
  return checks;
}

function requiredRelatedLinksForNextAction(nextAction) {
  const proofGraphNodeId = nextAction.nextAction.unproven?.proofGraphNodeId;
  const selectedProductionFeatureGraphNodeId =
    nextAction.nextAction.unproven?.selectedProductionFeatureGraph?.nodeId;
  const localCheckId = nextAction.nextAction.localCheck?.id;
  const seedProofLaneCoverageRoleUrl =
    nextAction.nextAction.seedProofLaneCoverage?.roleUrl;
  const proofGraphDestinationSummary =
    nextAction.nextAction.proofGraphDestinationSummary;
  return [
    ...(typeof proofGraphNodeId === "string" && proofGraphNodeId.trim() !== ""
      ? ["selected-proof-graph-node"]
      : []),
    ...(typeof proofGraphNodeId === "string" && proofGraphNodeId.trim() !== ""
      ? [proofGraphNodeId]
      : []),
    ...(typeof selectedProductionFeatureGraphNodeId === "string" &&
    selectedProductionFeatureGraphNodeId.trim() !== ""
      ? [selectedProductionFeatureGraphNodeId]
      : []),
    ...(typeof localCheckId === "string" && localCheckId.trim() !== ""
      ? [localCheckId]
      : []),
    ...(typeof seedProofLaneCoverageRoleUrl === "string" &&
    seedProofLaneCoverageRoleUrl.trim() !== ""
      ? ["seed-proof-lane-coverage"]
      : []),
    ...(proofGraphDestinationSummary !== null &&
    typeof proofGraphDestinationSummary === "object"
      ? ["proof-graph-destination-summary"]
      : []),
  ];
}

function requiredHostedHandoffInputIdsForNextAction(nextAction) {
  const inputIds =
    nextAction.nextAction.unproven?.hostedHandoffChecklist?.inputIds;
  return Array.isArray(inputIds) ? inputIds : [];
}

function requiredHostedHandoffInputValuesForNextAction(nextAction) {
  return hostedHandoffInputValues(
    nextAction.nextAction.unproven?.hostedHandoffChecklist,
  );
}

function hostedHandoffInputValues(checklist) {
  return typeof checklist?.placeholderFixturePath === "string" &&
    checklist.placeholderFixturePath.trim() !== ""
    ? {
        FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH:
          checklist.placeholderFixturePath,
      }
    : {};
}

function requiredHostedHandoffBlockedCheckIdsForNextAction(nextAction) {
  const blockedCheckIds =
    nextAction.nextAction.unproven?.hostedHandoffChecklist?.blockedCheckIds;
  return Array.isArray(blockedCheckIds) ? blockedCheckIds : [];
}

function requiredHostedHandoffGroupIdsForNextAction(nextAction) {
  return hostedHandoffGroupIds(
    nextAction.nextAction.unproven?.hostedHandoffChecklist,
  );
}

function hostedHandoffGroupIds(checklist) {
  const groups = checklist?.requirementGroups;
  return Array.isArray(groups) ? groups.map((group) => String(group.id)) : [];
}

function requiredHostedHandoffInputSectionIdsForNextAction(nextAction) {
  return hostedHandoffInputSections(
    nextAction.nextAction.unproven?.hostedHandoffChecklist,
  ).map((section) => section.id);
}

function requiredHostedHandoffInputSectionStatusesForNextAction(nextAction) {
  return Object.fromEntries(
    hostedHandoffInputSections(
      nextAction.nextAction.unproven?.hostedHandoffChecklist,
    ).map((section) => [section.id, section.status]),
  );
}

function requiredHostedHandoffSectionInputIdsForNextAction(nextAction) {
  return hostedHandoffSectionInputRows(
    nextAction.nextAction.unproven?.hostedHandoffChecklist,
  ).map((row) => row.id);
}

function requiredHostedHandoffSectionInputStatusesForNextAction(nextAction) {
  return Object.fromEntries(
    hostedHandoffSectionInputRows(
      nextAction.nextAction.unproven?.hostedHandoffChecklist,
    ).map((row) => [row.id, row.status]),
  );
}

function requiredHostedIdentityProgressionIdsForNextAction(nextAction) {
  const progressions =
    nextAction.nextAction.unproven?.hostedHandoffChecklist?.progressionSummary
      ?.progressions;
  return Array.isArray(progressions)
    ? progressions.map((progression) => String(progression.id ?? ""))
    : [];
}

function requiredHostedIdentityProgressionStatusesForNextAction(nextAction) {
  const progressions =
    nextAction.nextAction.unproven?.hostedHandoffChecklist?.progressionSummary
      ?.progressions;
  return Object.fromEntries(
    (Array.isArray(progressions) ? progressions : []).map((progression) => [
      String(progression.id ?? ""),
      String(progression.adminProofTarget ?? ""),
    ]),
  );
}

function requiredNextActionHandoffPairRowsForNextAction(nextAction) {
  const pair = nextAction.generatedFrom?.nextActionHandoffPair;
  if (pair === undefined) {
    return [];
  }
  return [
    "summary",
    String(pair.defaultSequenceBlocker.id ?? ""),
    String(pair.hostedIdentityPredicate.id ?? ""),
  ];
}

function requiredNextActionHandoffPairRowStatusesForNextAction(nextAction) {
  const pair = nextAction.generatedFrom?.nextActionHandoffPair;
  if (pair === undefined) {
    return {};
  }
  return {
    summary: String(pair.proofBoundary ?? ""),
    [String(pair.defaultSequenceBlocker.id ?? "")]: `${String(
      pair.defaultSequenceBlocker.expectedReason ?? "",
    )}\n${String(pair.defaultSequenceBlocker.expectedActionStatus ?? "")}`,
    [String(pair.hostedIdentityPredicate.id ?? "")]: `${String(
      pair.hostedIdentityPredicate.expectedReason ?? "",
    )}\n${String(pair.hostedIdentityPredicate.expectedActionStatus ?? "")}`,
  };
}

function requiredPhaseLocalNextActionSnapshotRowsForProofGraph(proofGraph) {
  return phaseLocalNextActionSnapshotsForProofGraph(proofGraph).map(
    (snapshot) => snapshot.id,
  );
}

function requiredPhaseLocalNextActionSnapshotStatusesForProofGraph(proofGraph) {
  return Object.fromEntries(
    phaseLocalNextActionSnapshotsForProofGraph(proofGraph).map((snapshot) => [
      snapshot.id,
      phaseLocalNextActionSnapshotStatusText(snapshot),
    ]),
  );
}

function phaseLocalNextActionSnapshotsForProofGraph(proofGraph) {
  const edges = Array.isArray(proofGraph?.edges) ? proofGraph.edges : [];
  return (Array.isArray(proofGraph?.nodes) ? proofGraph.nodes : [])
    .filter((node) => node.kind === "phase-local-next-action")
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
      return {
        id: String(node.id ?? ""),
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
      };
    });
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

function proofGraphEdgeCheckId(edge) {
  return `edge:${String(edge?.from ?? "")}:${String(
    edge?.relationship ?? "related",
  )}:${String(edge?.to ?? "")}`;
}

function phaseLocalNextActionSnapshotStatusText(snapshot) {
  return [
    snapshot.status,
    snapshot.phaseLocalNextActionId,
    snapshot.sequenceStage,
    snapshot.artifact,
    snapshot.canonicalArtifact,
    snapshot.nextActionEdgeRowId,
    snapshot.manifestEdgeRowId,
    snapshot.proofCommand,
  ]
    .filter((token) => String(token ?? "") !== "")
    .join("\n");
}

function requiredHostedIdentityOperatorGateForNextAction(nextAction) {
  const gate =
    nextAction.nextAction.unproven?.hostedHandoffChecklist?.operatorEvidenceGate;
  return gate === null || gate === undefined ? null : gate;
}

function requiredSelectedOperatorHandoffTextForNextAction(nextAction) {
  const handoff = nextAction.selectedOperatorHandoff;
  const packet = handoff?.blockedOperatorPacket;
  if (handoff === null || handoff === undefined || packet === undefined) {
    return [];
  }
  return [
    "Selected operator handoff",
    "Selected blocked operator packet",
    handoff.command,
    handoff.firstMissingInputId,
    handoff.selectedProductionFeatureRoleUrl,
    packet.rawEvidenceContractSummary,
    packet.localVsHostedBoundary,
    packet.operatorAction,
  ];
}

function hostedHandoffInputSections(checklist) {
  return Array.isArray(checklist?.inputSections)
    ? checklist.inputSections.map((section) => ({
        id: String(section.id),
        status: String(section.status ?? ""),
        requiredInputIds: Array.isArray(section.requiredInputIds)
          ? section.requiredInputIds.map((inputId) => String(inputId))
          : [],
        providedInputIds: Array.isArray(section.providedInputIds)
          ? section.providedInputIds.map((inputId) => String(inputId))
          : [],
      }))
    : [];
}

function hostedHandoffSectionInputRows(checklist) {
  return hostedHandoffInputSections(checklist).flatMap((section) =>
    section.requiredInputIds.map((inputId) => ({
      id: `${section.id}-${inputId}`,
      status: section.providedInputIds.includes(inputId)
        ? "provided"
        : "missing",
    })),
  );
}

function requiredHostedHandoffSummaryForNextAction(nextAction) {
  const checklist = nextAction.nextAction.unproven?.hostedHandoffChecklist;
  return checklist === null || checklist === undefined
    ? null
    : {
        status: checklist.status,
        preflightStatus: checklist.preflightStatus,
        command: checklist.command,
        proofTarget: checklist.proofTarget,
      };
}

function requiredHostedHandoffBlockedReceiptForNextAction(nextAction) {
  const receipt =
    nextAction.nextAction.unproven?.hostedHandoffChecklist?.blockedReceipt;
  return receipt === null || receipt === undefined
    ? null
    : {
        status: receipt.status,
        operatorAction: receipt.operatorAction,
        localVsHostedBoundary: receipt.localVsHostedBoundary,
        nextProofTarget: receipt.nextProofTarget,
        missingRequiredInputs: Array.isArray(receipt.missingRequiredInputs)
          ? receipt.missingRequiredInputs
          : [],
        ...(receipt.firstMissingOperatorArtifact === undefined
          ? {}
          : {
              firstMissingOperatorArtifact:
                receipt.firstMissingOperatorArtifact,
            }),
        ...(receipt.blockedOperatorPacket === undefined
          ? {}
          : {
              blockedOperatorPacket: visibleBlockedOperatorPacket(
                receipt.blockedOperatorPacket,
              ),
            }),
      };
}

function requiredCheckStatusesForNextAction(nextAction, proofGraph) {
  const selectedNodeStatus = selectedNextActionProofGraphNodeStatus({
    nextAction,
    proofGraph,
  });
  const selectedOperatorCandidate =
    selectedHostedIdentityOperatorCandidate(nextAction);
  const hostedIdentityFamilyBatch =
    nextAction.nextAction.unproven?.hostedIdentityFamilyBatch;
  const hostedIdentityProofGraphEdges =
    nextAction.nextAction.unproven?.hostedIdentityProofGraphEdges;
  const selectedOperatorHandoff = nextAction.selectedOperatorHandoff;
  return {
    ...(selectedNodeStatus === ""
      ? {}
      : { "selected-proof-graph-node": selectedNodeStatus }),
    ...(hostedIdentityFamilyBatch === undefined
      ? {}
      : {
          [hostedIdentityFamilyBatch.id]: hostedIdentityFamilyBatchStatusText(
            hostedIdentityFamilyBatch,
          ),
        }),
    ...(hostedIdentityProofGraphEdges === undefined
      ? {}
      : hostedIdentityProofGraphDependencyStatuses(
          hostedIdentityProofGraphEdges,
        )),
    ...(selectedOperatorCandidate === null
      ? {}
      : {
          "selected-next-command": nextAction.nextAction.command,
          "selected-proof-target": selectedOperatorCandidate.proofTarget,
          "selected-proof-boundary": selectedOperatorCandidate.proofBoundary,
        }),
    ...(selectedOperatorHandoff == null
      ? {}
      : {
          "selected-operator-handoff":
            selectedOperatorHandoff.firstMissingInputId,
          "selected-operator-handoff-role-url":
            selectedOperatorHandoff.selectedProductionFeatureRoleUrl,
          "selected-operator-handoff-feature-node":
            selectedOperatorHandoff.selectedProductionFeatureGraphNodeId,
        }),
    ...coreLoopRecoveryDestinationCoverageStatuses(
      nextAction.generatedFrom?.coreLoopRecoveryDestinationCoverage,
    ),
  };
}

function coreLoopRecoveryDestinationCoverageStatuses(coverage) {
  if (coverage === null || coverage === undefined) {
    return {};
  }
  return {
    [coverage.id]: `${coverage.coveredCount}/${coverage.recoveryCount} recoveries`,
    ...(Array.isArray(coverage.rows)
      ? Object.fromEntries(
          coverage.rows.map((row) => [
            `core-loop-recovery-destination:${String(row.id ?? "")}`,
            String(row.proofGraphNodeId ?? ""),
          ]),
        )
      : {}),
  };
}

function hostedIdentityFamilyBatchStatusText(batch) {
  return [
    batch.status,
    batch.command,
    batch.firstPendingProgressionId,
    ...(batch.proofTargets ?? []),
    batch.proofBoundary,
  ]
    .filter((part) => String(part ?? "") !== "")
    .join(" ");
}

function hostedIdentityProofGraphDependencyStatuses(dependency) {
  const summaryStatus = [
    dependency.status,
    dependency.proofGraphRoleUrl,
    dependency.familyBatchNodeId,
    dependency.operatorPredicateNodeId,
    dependency.adminSurfaceNodeId,
    dependency.operatorProofTarget,
    dependency.proofBoundary,
  ]
    .filter((part) => String(part ?? "") !== "")
    .join(" ");
  return Object.fromEntries([
    [dependency.id, summaryStatus],
    ...(dependency.edges ?? []).map((edge) => [
      edge.id,
      [
        edge.from,
        edge.relationship,
        edge.to,
        edge.command,
        edge.proofTarget,
      ]
        .filter((part) => String(part ?? "") !== "")
        .join(" "),
    ]),
  ]);
}

function hostedIdentityProofGraphDependencyCheckIds(dependency) {
  return [
    dependency.id,
    ...(Array.isArray(dependency.edges)
      ? dependency.edges.map((edge) => edge.id)
      : []),
  ].filter((id) => typeof id === "string" && id !== "");
}

function selectedReleaseReadinessCandidateForNextAction(nextAction) {
  const candidates = nextAction.releaseReadinessTrace?.candidates;
  return (Array.isArray(candidates) ? candidates : []).find(
    (candidate) => candidate?.selected === true,
  ) ?? null;
}

function selectedHostedIdentityOperatorCandidate(nextAction) {
  const candidate = selectedReleaseReadinessCandidateForNextAction(nextAction);
  if (
    nextAction.nextAction?.unproven?.id !== "hosted-production-identity" ||
    candidate?.id !== "hosted-production-identity" ||
    typeof nextAction.nextAction?.command !== "string" ||
    !nextAction.nextAction.command.includes("test:dev-test-game-identity:operator")
  ) {
    return null;
  }
  return candidate;
}

function relatedHandoffsForNextAction({ nextAction, proofGraph, hostedMatrix }) {
  return [
    ...selectedGraphDestinationHandoffSummaries({ nextAction, proofGraph }),
    hostedIdentityEvidenceHandoffSummary({ nextAction }),
    hostedMatrixHandoffSummary({ nextAction, hostedMatrix }),
  ].filter((handoff) => handoff !== null);
}

function hostedIdentityEvidenceHandoffSummary({ nextAction }) {
  const unproven = nextAction.nextAction.unproven;
  if (
    unproven?.id !== "hosted-production-identity" ||
    unproven?.proofGraphNodeId !== "admin-proof:hosted-identity-evidence" ||
    typeof unproven?.roleUrl !== "string" ||
    !unproven.roleUrl.includes("/admin/audit/local-hosted-identity-evidence")
  ) {
    return null;
  }
  const checklist = unproven.hostedHandoffChecklist;
  return {
    linkId: unproven.proofGraphNodeId,
    auditId: localAdminAuditIds.hostedIdentityEvidence,
    requiredCheckIds: Array.isArray(checklist?.blockedCheckIds)
      ? checklist.blockedCheckIds
      : [],
    requiredHostedHandoffInputIds: Array.isArray(checklist?.inputIds)
      ? checklist.inputIds
      : [],
    requiredHostedHandoffSummary:
      requiredHostedHandoffSummaryForNextAction(nextAction),
    requiredHostedIdentityProgressionIds:
      requiredHostedIdentityProgressionIdsForNextAction(nextAction),
    requiredHostedIdentityProgressionStatuses:
      requiredHostedIdentityProgressionStatusesForNextAction(nextAction),
    requiredRelatedLinkIds: [
      localAdminAuditIds.identityAdapter,
      localAdminAuditIds.nextAction,
    ],
  };
}

function assertSelectedGraphDestinationCases(evidence) {
  for (const destinationCase of selectedNextActionGraphDestinationCases) {
    const subject = selectedGraphDestinationSubject({
      destinationCase,
      generatedFrom: evidence.generatedFrom,
    });
    if (subject === null) {
      continue;
    }
    assertSelectedGraphDestinationCaseSurface({
      destinationCase,
      subject,
      adminRoleSurface: evidence.adminRoleSurface,
      missingErrorMessage: destinationCase.proofMissingMessage,
      textErrorMessage: destinationCase.proofTextMessage,
    });
  }
}

function selectedGraphDestinationHandoffSummaries({ nextAction, proofGraph }) {
  const generatedFrom = selectedGraphDestinationGeneratedFrom({
    nextAction,
    proofGraph,
  });
  return selectedNextActionGraphDestinationCases.map((destinationCase) => {
    const subject = selectedGraphDestinationSubject({
      destinationCase,
      generatedFrom,
    });
    return subject === null
      ? null
      : selectedGraphDestinationHandoffSummary({
          destinationCase,
          subject,
        });
  });
}

function selectedGraphDestinationGeneratedFrom({ nextAction, proofGraph }) {
  return {
    selectedProofGraphNode: selectedNextActionProofGraphNodeSummary({
      nextAction,
      proofGraph,
    }),
    unprovenSelectedProductionFeatureGraph:
      nextAction.nextAction.unproven?.selectedProductionFeatureGraph ?? null,
  };
}

function requiredChecksForEvidence(evidence) {
  return [
    "next-command",
    evidence.generatedFrom?.reason ?? "unknown",
    ...(typeof evidence.generatedFrom?.artifactId === "string"
      ? [evidence.generatedFrom.artifactId]
      : []),
    ...(typeof evidence.generatedFrom?.localCheckId === "string"
      ? [evidence.generatedFrom.localCheckId]
      : []),
    ...(typeof evidence.generatedFrom?.unprovenId === "string"
      ? [
          evidence.generatedFrom.unprovenId,
          "selected-proof-graph-node",
          "selected-proof-graph-destination",
          ...(evidence.generatedFrom?.unprovenHostedIdentityFamilyBatch ===
            null ||
          evidence.generatedFrom?.unprovenHostedIdentityFamilyBatch ===
            undefined
            ? []
            : [evidence.generatedFrom.unprovenHostedIdentityFamilyBatch.id]),
          ...(evidence.generatedFrom?.unprovenHostedIdentityProofGraphEdges ===
            null ||
          evidence.generatedFrom?.unprovenHostedIdentityProofGraphEdges ===
            undefined
            ? []
            : hostedIdentityProofGraphDependencyCheckIds(
                evidence.generatedFrom.unprovenHostedIdentityProofGraphEdges,
              )),
          ...(evidence.generatedFrom?.unprovenSpineTarget === null ||
          evidence.generatedFrom?.unprovenSpineTarget === undefined
            ? []
            : [
                "selected-feature-spine-declaration",
                "selected-spine-target",
                "selected-spine-drilldown",
                "selected-spine-admin-check",
                "selected-spine-rerun-command",
                "selected-spine-browser-proof",
                "selected-spine-source-artifact",
                "selected-spine-coverage-decision",
              ]),
          ...(evidence.generatedFrom?.unprovenSelectedProductionFeatureGraph ===
            null ||
          evidence.generatedFrom?.unprovenSelectedProductionFeatureGraph ===
            undefined
            ? []
            : [
                "selected-production-feature-graph-node",
                "selected-production-feature-graph-edge",
                "selected-production-feature-graph-browser-workbench",
                "selected-production-feature-graph-coverage-decision",
              ]),
        ]
      : []),
    ...preReadinessTraceCheckIds(
      preReadinessTraceKeys.proofStability,
      evidence.generatedFrom?.stabilityTrace,
    ),
    ...(typeof evidence.generatedFrom?.seedProofLaneCoverageSource === "string"
      ? ["seed-proof-lane-coverage"]
      : []),
    ...(evidence.generatedFrom?.proofGraphDestinationSummary === null ||
    evidence.generatedFrom?.proofGraphDestinationSummary === undefined
      ? []
      : [
          "proof-graph-destination-summary",
          "proof-graph-destination-summary-drift-count",
          "proof-graph-destination-summary-core-loop-recovery-coverage",
        ]),
    ...(evidence.generatedFrom?.terminalBatchGraph === null ||
    evidence.generatedFrom?.terminalBatchGraph === undefined
      ? []
      : ["terminal-proof-batch-graph"]),
    ...(evidence.generatedFrom?.nextActionHandoffPair === null ||
    evidence.generatedFrom?.nextActionHandoffPair === undefined
      ? []
      : [evidence.generatedFrom.nextActionHandoffPair.id]),
    ...coreLoopRecoveryDestinationCoverageCheckIds(
      evidence.generatedFrom?.coreLoopRecoveryDestinationCoverage,
    ),
    ...recoveryReceiptGraphCheckIdsForEvidence(evidence),
    ...preReadinessTraceCheckIds(
      preReadinessTraceKeys.seedProofLaneCoverage,
      evidence.generatedFrom?.seedProofLaneCoverageTrace,
    ),
    ...preReadinessTraceCheckIds(
      preReadinessTraceKeys.proofGraphDestinationSummary,
      evidence.generatedFrom?.proofGraphDestinationSummaryTrace,
    ),
    ...proofGraphDiagnosticSummaryCheckIds(
      evidence.generatedFrom?.proofGraphDiagnosticSummaryTrace,
    ),
    ...selectionTraceCheckIds(evidence.generatedFrom?.selectionTrace),
    ...releaseReadinessTraceCheckIds(
      evidence.generatedFrom?.releaseReadinessTrace,
    ),
    ...preReadinessTraceCheckIds(
      preReadinessTraceKeys.localReadinessDependency,
      evidence.generatedFrom?.localReadinessDependencyTrace,
    ),
    ...recoveryTraceCheckIds(
      recoveryTraceKeys.replacementRaceReload,
      evidence.generatedFrom?.replacementRaceReloadTrace,
    ),
    ...recoveryTraceCheckIds(
      recoveryTraceKeys.hostConcurrentRaceReload,
      evidence.generatedFrom?.hostConcurrentRaceReloadTrace,
    ),
    ...recoveryTraceCheckIds(
      recoveryTraceKeys.playerConcurrentActionReload,
      evidence.generatedFrom?.playerConcurrentActionReloadTrace,
    ),
    ...recoveryTraceCheckIds(
      recoveryTraceKeys.cohostDeadlineRaceReload,
      evidence.generatedFrom?.cohostDeadlineRaceReloadTrace,
    ),
    "race-coverage-promoted-milestones",
    ...recoveryTraceCheckIds(
      recoveryTraceKeys.staleConflictMessage,
      evidence.generatedFrom?.staleConflictMessageTrace,
    ),
    ...recoveryTraceCheckIds(
      recoveryTraceKeys.hostStaleControl,
      evidence.generatedFrom?.hostStaleControlTrace,
    ),
  ];
}

function coreLoopRecoveryDestinationCoverageCheckIds(coverage) {
  if (coverage === null || coverage === undefined) {
    return [];
  }
  return [
    coverage.id,
    ...(Array.isArray(coverage.rows)
      ? coverage.rows.map(
          (row) => `core-loop-recovery-destination:${String(row.id ?? "")}`,
        )
      : []),
  ];
}
