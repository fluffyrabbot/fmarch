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
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph.mjs";
import {
  artifactDir,
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
  assertRecoveryReceiptGraphSummary,
  recoveryReceiptGraphDescriptors,
} from "./dev_test_game_recovery_receipt_catalog.mjs";

const nextActionPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_NEXT_ACTION ??
    "target/dev-test-game/next-action.json",
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? "target/dev-test-game/proof-run.json",
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
const nextActionRelativePath = path.relative(repoRoot, nextActionPath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const proofGraphRelativePath = path.relative(repoRoot, proofGraphPath);
const hostedMatrixRelativePath = path.relative(repoRoot, hostedMatrixPath);
const evidencePath = path.join(artifactDir, "next-action-admin-proof.json");

export function nextActionAdminProofCase() {
  return {
    smokeName: "dev-test-game-next-action-admin-proof",
    stage: "next-action-admin-proof-listen",
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_NEXT_ACTION: nextActionRelativePath,
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
      unprovenSelectedProductionFeatureGraph:
        source.nextAction.nextAction.unproven?.selectedProductionFeatureGraph ??
        null,
      unprovenHostedHandoffChecklist:
        source.nextAction.nextAction.unproven?.hostedHandoffChecklist ?? null,
      selectedProofGraphNode: selectedNextActionProofGraphNodeSummary({
        nextAction: source.nextAction,
        proofGraph: source.proofGraph,
      }),
      terminalBatchGraph: source.nextAction.generatedFrom?.terminalBatchGraph ?? null,
      ...recoveryReceiptGraphGeneratedFrom(source.nextAction),
      relatedHandoffs: relatedHandoffsForNextAction({
        nextAction: source.nextAction,
        proofGraph: source.proofGraph,
        hostedMatrix: source.hostedMatrix,
      }),
      stabilityStatus: source.nextAction.stabilityTrace.status,
      selectionTrace: {
        strategy: source.nextAction.selectionTrace.strategy,
        candidateCount: source.nextAction.selectionTrace.candidateCount,
        selectedArtifactId: source.nextAction.selectionTrace.selectedArtifactId,
        candidateIds: source.nextAction.selectionTrace.candidates.map(
          (candidate) => candidate.id,
        ),
      },
      releaseReadinessTrace: {
        strategy: source.nextAction.releaseReadinessTrace.strategy,
        candidateCount: source.nextAction.releaseReadinessTrace.candidateCount,
        selectedUnprovenId:
          source.nextAction.releaseReadinessTrace.selectedUnprovenId,
        candidateIds: source.nextAction.releaseReadinessTrace.candidates.map(
          (candidate) => candidate.id,
        ),
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
  if (
    evidence.generatedFrom?.selectionTrace?.strategy !== "development-spine-priority" ||
    !Number.isInteger(evidence.generatedFrom.selectionTrace.candidateCount) ||
    !Array.isArray(evidence.generatedFrom.selectionTrace.candidateIds)
  ) {
    throw new Error("next-action admin proof is missing selection trace evidence");
  }
  if (
    evidence.generatedFrom?.releaseReadinessTrace?.strategy !==
      "local-dev-release-readiness-priority" ||
    !Number.isInteger(evidence.generatedFrom.releaseReadinessTrace.candidateCount) ||
    !Array.isArray(evidence.generatedFrom.releaseReadinessTrace.candidateIds)
  ) {
    throw new Error("next-action admin proof is missing release-readiness trace evidence");
  }
  if (
    evidence.generatedFrom?.localReadinessDependencyTrace?.strategy !==
      "local-readiness-dependency-before-hosted-work" ||
    !Number.isInteger(
      evidence.generatedFrom.localReadinessDependencyTrace.candidateCount,
    ) ||
    !Array.isArray(
      evidence.generatedFrom.localReadinessDependencyTrace.candidateIds,
    )
  ) {
    throw new Error(
      "next-action admin proof is missing local readiness dependency trace evidence",
    );
  }
  if (
    evidence.generatedFrom?.stabilityTrace?.strategy !==
      "proof-stability-before-readiness" ||
    !["clean", "drifted"].includes(evidence.generatedFrom.stabilityTrace.status) ||
    typeof evidence.generatedFrom.stabilityTrace.selected !== "boolean"
  ) {
    throw new Error("next-action admin proof is missing stability trace evidence");
  }
  if (
    evidence.generatedFrom?.seedProofLaneCoverageTrace?.strategy !==
      "seed-proof-lane-coverage-before-readiness" ||
    !["clean", "drifted", "unavailable"].includes(
      evidence.generatedFrom.seedProofLaneCoverageTrace.status,
    ) ||
    typeof evidence.generatedFrom.seedProofLaneCoverageTrace.selected !==
      "boolean" ||
    !Number.isInteger(
      evidence.generatedFrom.seedProofLaneCoverageTrace.unclassifiedLaneCount,
    ) ||
    !Array.isArray(
      evidence.generatedFrom.seedProofLaneCoverageTrace.unclassifiedLaneIds,
    )
  ) {
    throw new Error(
      "next-action admin proof is missing seed proof-lane coverage trace evidence",
    );
  }
  if (
    evidence.generatedFrom?.replacementRaceReloadTrace?.strategy !==
      "replacement-race-reload-before-readiness" ||
    !["covered", "gapped", "unavailable"].includes(
      evidence.generatedFrom.replacementRaceReloadTrace.status,
    ) ||
    !Number.isInteger(
      evidence.generatedFrom.replacementRaceReloadTrace.requiredCellCount,
    ) ||
    !Array.isArray(evidence.generatedFrom.replacementRaceReloadTrace.cellIds)
  ) {
    throw new Error(
      "next-action admin proof is missing replacement-race reload trace evidence",
    );
  }
  if (
    evidence.generatedFrom?.hostConcurrentRaceReloadTrace?.strategy !==
      "host-concurrent-race-reload-before-readiness" ||
    !["covered", "gapped", "unavailable"].includes(
      evidence.generatedFrom.hostConcurrentRaceReloadTrace.status,
    ) ||
    !Number.isInteger(
      evidence.generatedFrom.hostConcurrentRaceReloadTrace.requiredCellCount,
    ) ||
    !Array.isArray(evidence.generatedFrom.hostConcurrentRaceReloadTrace.cellIds)
  ) {
    throw new Error(
      "next-action admin proof is missing host concurrent race-reload trace evidence",
    );
  }
  if (
    evidence.generatedFrom?.playerConcurrentActionReloadTrace?.strategy !==
      "player-concurrent-action-reload-before-readiness" ||
    !["covered", "gapped", "unavailable"].includes(
      evidence.generatedFrom.playerConcurrentActionReloadTrace.status,
    ) ||
    !Number.isInteger(
      evidence.generatedFrom.playerConcurrentActionReloadTrace.requiredCellCount,
    ) ||
    !Array.isArray(evidence.generatedFrom.playerConcurrentActionReloadTrace.cellIds)
  ) {
    throw new Error(
      "next-action admin proof is missing player concurrent action reload trace evidence",
    );
  }
  if (
    evidence.generatedFrom?.cohostDeadlineRaceReloadTrace?.strategy !==
      "cohost-deadline-race-reload-before-readiness" ||
    !["covered", "gapped", "unavailable"].includes(
      evidence.generatedFrom.cohostDeadlineRaceReloadTrace.status,
    ) ||
    !Number.isInteger(
      evidence.generatedFrom.cohostDeadlineRaceReloadTrace.requiredCellCount,
    ) ||
    !Array.isArray(evidence.generatedFrom.cohostDeadlineRaceReloadTrace.cellIds)
  ) {
    throw new Error(
      "next-action admin proof is missing cohost deadline race reload trace evidence",
    );
  }
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
  if (
    evidence.generatedFrom?.staleConflictMessageTrace?.strategy !==
      "stale-conflict-message-before-readiness" ||
    !["covered", "gapped", "unavailable"].includes(
      evidence.generatedFrom.staleConflictMessageTrace.status,
    ) ||
    !Number.isInteger(
      evidence.generatedFrom.staleConflictMessageTrace.requiredLaneCount,
    ) ||
    !Array.isArray(evidence.generatedFrom.staleConflictMessageTrace.laneIds) ||
    evidence.generatedFrom.staleConflictMessageTrace.surfaceCoverage?.status !==
      "complete" ||
    !Number.isInteger(
      evidence.generatedFrom.staleConflictMessageTrace.surfaceCoverage
        ?.requiredSurfaceCount,
    ) ||
    !Number.isInteger(
      evidence.generatedFrom.staleConflictMessageTrace.surfaceCoverage
        ?.coveredSurfaceCount,
    ) ||
    !Array.isArray(evidence.generatedFrom.staleConflictMessageTrace.surfaces)
  ) {
    throw new Error(
      "next-action admin proof is missing stale conflict-message trace evidence",
    );
  }
  if (
    evidence.generatedFrom?.hostStaleControlTrace?.strategy !==
      "host-stale-control-before-readiness" ||
    !["covered", "gapped", "unavailable"].includes(
      evidence.generatedFrom.hostStaleControlTrace.status,
    ) ||
    !Number.isInteger(
      evidence.generatedFrom.hostStaleControlTrace.requiredLaneCount,
    ) ||
    !Array.isArray(evidence.generatedFrom.hostStaleControlTrace.laneIds)
  ) {
    throw new Error(
      "next-action admin proof is missing host stale-control trace evidence",
    );
  }
  assertNextActionAdminRecoveryReceiptGraphs(evidence.generatedFrom);
  for (const checkId of requiredChecksForEvidence(evidence)) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`next-action admin proof missing visible check: ${checkId}`);
    }
  }
  const relatedLinkId = evidence.generatedFrom?.unprovenProofGraphNodeId;
  if (
    typeof relatedLinkId === "string" &&
    !evidence.adminRoleSurface?.visibleRelatedLinks?.includes(relatedLinkId)
  ) {
    throw new Error("next-action admin proof missing selected role URL handoff");
  }
  if (
    evidence.generatedFrom?.selectedProofGraphNode !== null &&
    evidence.generatedFrom?.selectedProofGraphNode?.id !== undefined &&
    !evidence.adminRoleSurface?.visibleChecks?.includes("selected-proof-graph-node")
  ) {
    throw new Error("next-action admin proof missing selected graph node row");
  }
  if (
    evidence.generatedFrom?.selectedProofGraphNode !== null &&
    evidence.generatedFrom?.selectedProofGraphNode?.id !== undefined &&
    !evidence.adminRoleSurface?.visibleChecks?.includes(
      "selected-proof-graph-destination",
    )
  ) {
    throw new Error("next-action admin proof missing selected graph destination row");
  }
  if (
    evidence.generatedFrom?.selectedProofGraphNode !== null &&
    evidence.generatedFrom?.selectedProofGraphNode?.id !== undefined &&
    !evidence.adminRoleSurface?.visibleRelatedLinks?.includes(
      "selected-proof-graph-node",
    )
  ) {
    throw new Error("next-action admin proof missing selected graph destination link");
  }
  if (
    evidence.generatedFrom?.unprovenSpineTarget !== null &&
    evidence.generatedFrom?.unprovenSpineTarget !== undefined
  ) {
    const declaration = evidence.generatedFrom.unprovenProductionFeatureSpineTarget;
    const drilldown = evidence.generatedFrom.unprovenSpineDrilldown;
    const target = evidence.generatedFrom.unprovenSpineTarget;
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
      target.featureSlotId !== declaration.featureSlotId ||
      target.adminCheckId !== declaration.adminCheckId ||
      typeof drilldown?.featureSlotId !== "string" ||
      typeof drilldown?.cycleRowId !== "string" ||
      typeof drilldown?.roleUrlRowId !== "string" ||
      typeof drilldown?.checkpointRowId !== "string" ||
      typeof drilldown?.adminCheckId !== "string" ||
      typeof drilldown?.rerunCommand !== "string" ||
      drilldown.featureSlotId !== declaration.featureSlotId ||
      drilldown.adminCheckId !== declaration.adminCheckId ||
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
          JSON.stringify(checklist.blockedReceipt.missingRequiredInputs ?? [])
      ) {
        throw new Error(
          "next-action admin proof missing hosted handoff blocked receipt",
        );
      }
    }
  }
  return evidence;
}

function recoveryReceiptGraphGeneratedFrom(nextAction) {
  return Object.fromEntries(
    recoveryReceiptGraphDescriptors.map((descriptor) => [
      descriptor.nextActionGeneratedFromKey,
      nextAction.generatedFrom?.[descriptor.nextActionGeneratedFromKey] ?? null,
    ]),
  );
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

function recoveryReceiptGraphCheckIdsForEvidence(evidence) {
  return recoveryReceiptGraphDescriptors.flatMap((descriptor) =>
    evidence.generatedFrom?.[descriptor.nextActionGeneratedFromKey] === null ||
    evidence.generatedFrom?.[descriptor.nextActionGeneratedFromKey] === undefined
      ? []
      : [descriptor.checkId],
  );
}

function requiredChecksForNextAction(nextAction) {
  const checks = ["next-command", nextAction.nextAction.reason, "selection-trace"];
  if (nextAction.nextAction.artifact?.id !== undefined) {
    checks.push(nextAction.nextAction.artifact.id);
  }
  if (nextAction.nextAction.localCheck?.id !== undefined) {
    checks.push(
      nextAction.nextAction.localCheck.id,
      "local-readiness-dependency-trace",
    );
  }
  if (nextAction.nextAction.unproven?.id !== undefined) {
    checks.push(
      nextAction.nextAction.unproven.id,
      "selected-proof-graph-node",
      "selected-proof-graph-destination",
      "release-readiness-selection-trace",
    );
    if (nextAction.nextAction.unproven.spineTarget !== undefined) {
      checks.push("selected-feature-spine-declaration");
      checks.push("selected-spine-target");
      checks.push("selected-spine-drilldown");
      checks.push("selected-spine-admin-check");
      checks.push("selected-spine-rerun-command");
      checks.push("selected-spine-browser-proof");
    }
    if (
      nextAction.nextAction.unproven.selectedProductionFeatureGraph !== undefined
    ) {
      checks.push("selected-production-feature-graph-node");
      checks.push("selected-production-feature-graph-edge");
    }
  }
  if (nextAction.nextAction.stability?.source !== undefined) {
    checks.push("proof-stability-drift");
  }
  if (nextAction.nextAction.seedProofLaneCoverage?.source !== undefined) {
    checks.push("seed-proof-lane-coverage");
  }
  if (nextAction.nextAction.sequenceDeferral !== undefined) {
    checks.push("hosted-identity-sequence-deferral");
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
  for (const descriptor of recoveryReceiptGraphDescriptors) {
    if (
      nextAction.generatedFrom?.[descriptor.nextActionGeneratedFromKey] !==
      undefined
    ) {
      checks.push(descriptor.checkId);
    }
  }
  if (nextAction.seedProofLaneCoverageTrace?.status !== "unavailable") {
    checks.push("seed-proof-lane-coverage-trace");
    for (const laneId of nextAction.seedProofLaneCoverageTrace.unclassifiedLaneIds) {
      checks.push(`seed-proof-lane-coverage-${laneId}`);
    }
  }
  for (const candidate of nextAction.selectionTrace.candidates) {
    checks.push(`selection-trace-${candidate.id}`);
  }
  for (const candidate of nextAction.releaseReadinessTrace.candidates) {
    checks.push(`release-readiness-${candidate.id}`);
  }
  for (const candidate of nextAction.localReadinessDependencyTrace.candidates) {
    checks.push(`local-readiness-dependency-${candidate.id}`);
  }
  checks.push("replacement-race-reload-milestone");
  for (const cell of nextAction.replacementRaceReloadTrace.cells) {
    checks.push(`replacement-race-reload-${cell.id}`);
  }
  checks.push("host-concurrent-race-reload-milestone");
  for (const cell of nextAction.hostConcurrentRaceReloadTrace.cells) {
    checks.push(`host-concurrent-race-reload-${cell.id}`);
  }
  checks.push("player-concurrent-action-reload-milestone");
  for (const cell of nextAction.playerConcurrentActionReloadTrace.cells) {
    checks.push(`player-concurrent-action-reload-${cell.id}`);
  }
  checks.push("cohost-deadline-race-reload-milestone");
  for (const cell of nextAction.cohostDeadlineRaceReloadTrace.cells) {
    checks.push(`cohost-deadline-race-reload-${cell.id}`);
  }
  checks.push("race-coverage-promoted-milestones");
  checks.push("stale-conflict-message-milestone");
  checks.push("stale-conflict-message-surface-coverage");
  for (const laneId of nextAction.staleConflictMessageTrace.laneIds) {
    checks.push(`stale-conflict-message-${laneId}`);
  }
  for (const surface of nextAction.staleConflictMessageTrace.surfaces) {
    checks.push(surface.checkId);
  }
  checks.push("host-stale-control-milestone");
  for (const laneId of nextAction.hostStaleControlTrace.laneIds) {
    checks.push(`host-stale-control-${laneId}`);
  }
  return checks;
}

function requiredRelatedLinksForNextAction(nextAction) {
  const proofGraphNodeId = nextAction.nextAction.unproven?.proofGraphNodeId;
  const selectedProductionFeatureGraphNodeId =
    nextAction.nextAction.unproven?.selectedProductionFeatureGraph?.nodeId;
  const localCheckId = nextAction.nextAction.localCheck?.id;
  const seedProofLaneCoverageRoleUrl =
    nextAction.nextAction.seedProofLaneCoverage?.roleUrl;
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
      };
}

function requiredCheckStatusesForNextAction(nextAction, proofGraph) {
  const selectedNodeStatus = selectedNextActionProofGraphNodeStatus({
    nextAction,
    proofGraph,
  });
  return selectedNodeStatus === ""
    ? {}
    : {
        "selected-proof-graph-node": selectedNodeStatus,
      };
}

function relatedHandoffsForNextAction({ nextAction, proofGraph, hostedMatrix }) {
  return [
    selectedProofGraphHandoffSummary({ nextAction, proofGraph }),
    selectedProductionFeatureGraphHandoffSummary({ nextAction }),
    hostedMatrixHandoffSummary({ nextAction, hostedMatrix }),
  ].filter((handoff) => handoff !== null);
}

function selectedProofGraphHandoffSummary({ nextAction, proofGraph }) {
  const selectedNode = selectedNextActionProofGraphNodeSummary({
    nextAction,
    proofGraph,
  });
  if (selectedNode === null) {
    return null;
  }
  return {
    linkId: "selected-proof-graph-node",
    auditId: localAdminAuditIds.proofGraph,
    requiredCheckIds: [selectedNode.id],
    requiredRelatedLinkIds:
      selectedNode.roleUrl === "" ? [] : [selectedNode.id],
  };
}

function selectedProductionFeatureGraphHandoffSummary({ nextAction }) {
  const selectedGraph =
    nextAction.nextAction.unproven?.selectedProductionFeatureGraph;
  if (
    selectedGraph === null ||
    typeof selectedGraph !== "object" ||
    typeof selectedGraph.nodeId !== "string" ||
    selectedGraph.nodeId.trim() === ""
  ) {
    return null;
  }
  return {
    linkId: selectedGraph.nodeId,
    auditId: localAdminAuditIds.proofGraph,
    requiredCheckIds: [selectedGraph.nodeId],
    requiredRelatedLinkIds: [selectedGraph.nodeId],
  };
}

function requiredChecksForEvidence(evidence) {
  return [
    "next-command",
    evidence.generatedFrom?.reason ?? "unknown",
    "selection-trace",
    ...(typeof evidence.generatedFrom?.artifactId === "string"
      ? [evidence.generatedFrom.artifactId]
      : []),
    ...(typeof evidence.generatedFrom?.localCheckId === "string"
      ? [
          evidence.generatedFrom.localCheckId,
          "local-readiness-dependency-trace",
        ]
      : []),
    ...(typeof evidence.generatedFrom?.unprovenId === "string"
      ? [
          evidence.generatedFrom.unprovenId,
          "selected-proof-graph-node",
          "selected-proof-graph-destination",
          "release-readiness-selection-trace",
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
              ]),
          ...(evidence.generatedFrom?.unprovenSelectedProductionFeatureGraph ===
            null ||
          evidence.generatedFrom?.unprovenSelectedProductionFeatureGraph ===
            undefined
            ? []
            : [
                "selected-production-feature-graph-node",
                "selected-production-feature-graph-edge",
              ]),
        ]
      : []),
    ...(evidence.generatedFrom?.stabilityStatus === "drifted"
      ? ["proof-stability-drift"]
      : []),
    ...(typeof evidence.generatedFrom?.seedProofLaneCoverageSource === "string"
      ? ["seed-proof-lane-coverage"]
      : []),
    ...(evidence.generatedFrom?.terminalBatchGraph === null ||
    evidence.generatedFrom?.terminalBatchGraph === undefined
      ? []
      : ["terminal-proof-batch-graph"]),
    ...recoveryReceiptGraphCheckIdsForEvidence(evidence),
    ...(evidence.generatedFrom?.seedProofLaneCoverageTrace?.status !==
      "unavailable"
      ? [
          "seed-proof-lane-coverage-trace",
          ...(Array.isArray(
            evidence.generatedFrom.seedProofLaneCoverageTrace
              .unclassifiedLaneIds,
          )
            ? evidence.generatedFrom.seedProofLaneCoverageTrace.unclassifiedLaneIds.map(
                (id) => `seed-proof-lane-coverage-${id}`,
              )
            : []),
        ]
      : []),
    ...(Array.isArray(evidence.generatedFrom?.selectionTrace?.candidateIds)
      ? evidence.generatedFrom.selectionTrace.candidateIds.map((id) => `selection-trace-${id}`)
      : []),
    ...(Array.isArray(evidence.generatedFrom?.releaseReadinessTrace?.candidateIds)
      ? evidence.generatedFrom.releaseReadinessTrace.candidateIds.map(
          (id) => `release-readiness-${id}`,
        )
      : []),
    ...(Array.isArray(
      evidence.generatedFrom?.localReadinessDependencyTrace?.candidateIds,
    )
      ? evidence.generatedFrom.localReadinessDependencyTrace.candidateIds.map(
          (id) => `local-readiness-dependency-${id}`,
        )
      : []),
    "replacement-race-reload-milestone",
    ...(Array.isArray(evidence.generatedFrom?.replacementRaceReloadTrace?.cellIds)
      ? evidence.generatedFrom.replacementRaceReloadTrace.cellIds.map(
          (id) => `replacement-race-reload-${id}`,
        )
      : []),
    "host-concurrent-race-reload-milestone",
    ...(Array.isArray(evidence.generatedFrom?.hostConcurrentRaceReloadTrace?.cellIds)
      ? evidence.generatedFrom.hostConcurrentRaceReloadTrace.cellIds.map(
          (id) => `host-concurrent-race-reload-${id}`,
        )
      : []),
    "player-concurrent-action-reload-milestone",
    ...(Array.isArray(evidence.generatedFrom?.playerConcurrentActionReloadTrace?.cellIds)
      ? evidence.generatedFrom.playerConcurrentActionReloadTrace.cellIds.map(
          (id) => `player-concurrent-action-reload-${id}`,
        )
      : []),
    "cohost-deadline-race-reload-milestone",
    ...(Array.isArray(evidence.generatedFrom?.cohostDeadlineRaceReloadTrace?.cellIds)
      ? evidence.generatedFrom.cohostDeadlineRaceReloadTrace.cellIds.map(
          (id) => `cohost-deadline-race-reload-${id}`,
        )
      : []),
    "race-coverage-promoted-milestones",
    "stale-conflict-message-milestone",
    "stale-conflict-message-surface-coverage",
    ...(Array.isArray(evidence.generatedFrom?.staleConflictMessageTrace?.laneIds)
      ? evidence.generatedFrom.staleConflictMessageTrace.laneIds.map(
          (id) => `stale-conflict-message-${id}`,
        )
      : []),
    ...(Array.isArray(evidence.generatedFrom?.staleConflictMessageTrace?.surfaces)
      ? evidence.generatedFrom.staleConflictMessageTrace.surfaces.map(
          (surface) => surface.checkId,
        )
      : []),
    "host-stale-control-milestone",
    ...(Array.isArray(evidence.generatedFrom?.hostStaleControlTrace?.laneIds)
      ? evidence.generatedFrom.hostStaleControlTrace.laneIds.map(
          (id) => `host-stale-control-${id}`,
        )
      : []),
  ];
}
