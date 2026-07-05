import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameSpineManifest,
  proofFreshnessAdminProofCommand,
  spineManifestPath,
} from "./dev_test_game_spine_manifest.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";
import { assertDevTestGameReleaseReadiness } from "./dev_test_game_release_readiness.mjs";
import {
  assertDevTestGameNextActionSequenceHandoffPair,
} from "./dev_test_game_next_action_sequence_handoff_pair.mjs";
import {
  assertDevTestGameOpsArtifacts,
  devTestGameOpsArtifactsPath,
} from "./dev_test_game_ops_artifacts.mjs";
import {
  devTestGameReleaseReadinessPath,
} from "./dev_test_game_spine_readiness_steps.mjs";
import {
  assertDevTestGameRaceCoverage,
  devTestGameRaceCoverageAdminProofPath,
  devTestGameRaceCoveragePath,
  raceCoveragePromotedReloadGroups,
} from "./dev_test_game_race_coverage.mjs";
import {
  devTestGameReleaseAdminProofPath,
  devTestGameReleaseRunbookAdminProofPath,
  devTestGameReleaseRunbookPath,
} from "./dev_test_game_release_artifact_paths.mjs";
import {
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import {
  devTestGameHostedEvidenceLanePath,
} from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  devTestGameHostedEvidenceLaneDemoProofPath,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  devTestGameBackupRestoreProofPath,
  devTestGameIdentityAdapterProofPath,
  devTestGameSeedFixturePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  assertDevTestGameHostedTargetPreflight,
  devTestGameHostedTargetPreflightPath,
} from "./dev_test_game_hosted_target_preflight.mjs";
import {
  releaseReadinessBuildableItemForId,
} from "./dev_test_game_release_readiness_cases.mjs";
import { rankedMissingLocalReadinessDependencies } from "./dev_test_game_local_readiness_dependencies.mjs";
import {
  buildProductionFeatureSpineDrilldown,
  resolveProductionFeatureSpineTarget,
  validProductionFeatureSpineDeclaration,
  validProductionFeatureSpineDrilldown,
  validProductionFeatureSpineTarget,
} from "./dev_test_game_production_feature_spine_resolver.mjs";
import {
  productionFeatureGraphSourceNodeId,
} from "./dev_test_game_production_feature_graph_sources.mjs";
import {
  productionFeatureSourceTargetsByCheckIdFromReadiness,
} from "./dev_test_game_production_feature_readiness_sources.mjs";
import {
  defaultProductionFeatureSpineRerunCommands,
  devTestGameProductionFeatureBrowserProofCommand,
  productionFeatureSpineSourceCheckRules,
} from "./dev_test_game_production_feature_source_rules.mjs";
import {
  devTestGameProofGraphCommand,
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import {
  buildProofGraphDestinationSummaryTrace,
  proofGraphDestinationSummaryDriftFromProofGraph,
} from "./dev_test_game_proof_graph_destination_summary_trace.mjs";
import {
  assertProofGraphDiagnosticSummaryTrace,
  buildProofGraphDiagnosticSummaryTrace,
} from "./dev_test_game_proof_graph_diagnostic_summary.mjs";
import {
  buildProofStabilityTrace,
  proofStabilityDriftFromOpsArtifacts,
} from "./dev_test_game_proof_stability_trace.mjs";
import {
  buildSeedProofLaneCoverageTrace,
  seedProofLaneCoverageDriftFromReadiness,
} from "./dev_test_game_seed_proof_lane_coverage_trace.mjs";
import {
  assertPreReadinessTrace,
  buildLocalReadinessDependencyTrace,
  preReadinessTraceKeys,
} from "./dev_test_game_pre_readiness_trace_registry.mjs";
import {
  assertReleaseReadinessTrace,
  assertSelectionTrace,
  buildReleaseReadinessTrace,
  buildSelectionTrace,
} from "./dev_test_game_next_action_priority_traces.mjs";
import {
  assertRecoveryReceiptGraphSummary,
  recoveryReceiptGraphDescriptors,
  recoveryReceiptGraphSummaryFromProofGraph,
} from "./dev_test_game_recovery_receipt_catalog.mjs";
import {
  assertRecoveryTrace,
  buildCohostDeadlineRaceReloadTrace,
  buildHostConcurrentRaceReloadTrace,
  buildHostStaleControlTrace,
  buildPlayerConcurrentActionReloadTrace,
  buildReplacementRaceReloadTrace,
  buildStaleConflictMessageTrace,
  recoveryTraceKeys,
} from "./dev_test_game_next_action_recovery_traces.mjs";
import {
  hostedAdminHandoffProofArtifactCases,
} from "./dev_test_game_hosted_handoff_proof_cases.mjs";
import {
  devTestGameHostedIdentityOperatorAdminProofPath,
  hostedIdentityEvidenceFamilyProgressionCases,
  hostedIdentityEvidenceProgressionAdminProofPath,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  devTestGameAdminSpineAdminProofPath,
  devTestGameBackupAdminProofPath,
  devTestGameCoreLoopAdminProofPath,
  devTestGameHardeningAdminProofPath,
  devTestGameIdentityAdminProofPath,
  devTestGameOpsAdminProofPath,
  devTestGameSeedAdminProofPath,
  devTestGameSpineManifestAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  adminSpineProofPath,
  adminSpineTerminalBatchProofPath,
  devTestGameProofGraphAdminProofPath,
  devTestGameProofRunPath,
  devTestGameSessionPath,
  hostedIdentityNextActionPath,
  nextActionAdminProofPath,
  nextActionPath,
} from "./dev_test_game_spine_artifact_paths.mjs";

export {
  devTestGameCoreLoopAdminProofCommand,
  devTestGameHardeningAdminProofCommand,
  devTestGameIdentityAdminProofCommand,
} from "./dev_test_game_production_feature_source_rules.mjs";

export const DEV_TEST_GAME_NEXT_ACTION_VERSION = 1;
export const devTestGameNextActionPath = nextActionPath;
export const devTestGameHostedIdentityNextActionPath =
  hostedIdentityNextActionPath;
export { devTestGameOpsArtifactsPath, devTestGameReleaseReadinessPath };
export const devTestGameLiveProofCommand =
  devTestGameProductionFeatureBrowserProofCommand;
export const devTestGameSeedFixtureCommand =
  "npm run test:dev-test-game-seed-fixture";
export { devTestGameSeedFixturePath };
export const devTestGameSeedFixtureRoleUrl =
  "/admin/audit/local-seed-fixtures?game=<seeded-game>";
export const devTestGameDefaultSequenceStage = "local-capability-model";
export const devTestGameHostedIdentitySequenceStage = "hosted-identity";
export const devTestGameHostedIdentitySequencePromotionCommand =
  "npm run test:dev-test-game-next-action:hosted-identity";
export const devTestGameHostedIdentityOperatorSpineScript =
  "test:dev-test-game-identity:operator";
export const devTestGameHostedIdentityOperatorSpineCommand =
  `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run ${devTestGameHostedIdentityOperatorSpineScript}`;
const devTestGameHostSetupRoleUrl =
  "http://127.0.0.1:5173/g/<seeded-game>/setup";

export function buildDevTestGameNextAction(
  spineManifest,
  {
    generatedAt = new Date().toISOString(),
    sequenceStage = devTestGameDefaultSequenceStage,
    spineManifestSource = spineManifestPath,
    releaseReadinessChecklist = null,
    releaseReadinessChecklistSource = devTestGameReleaseReadinessPath,
    opsArtifacts = null,
    opsArtifactsSource = devTestGameOpsArtifactsPath,
    raceCoverage = null,
    raceCoverageSource = devTestGameRaceCoveragePath,
    hostedTargetPreflight = null,
    hostedTargetPreflightSource = devTestGameHostedTargetPreflightPath,
    proofGraph = null,
    proofGraphSource = devTestGameProofGraphPath,
    hostedIdentityProgressionProofs = {},
  } = {},
) {
  const manifest = assertDevTestGameSpineManifest(spineManifest);
  const readiness =
    releaseReadinessChecklist === null
      ? null
      : assertDevTestGameReleaseReadiness(releaseReadinessChecklist);
  const ops =
    opsArtifacts === null ? null : assertDevTestGameOpsArtifacts(opsArtifacts);
  const races =
    raceCoverage === null ? null : assertDevTestGameRaceCoverage(raceCoverage);
  const hostedPreflight =
    hostedTargetPreflight === null
      ? null
      : assertDevTestGameHostedTargetPreflight(hostedTargetPreflight);
  const graph = proofGraph === null ? null : assertProofGraphForNextAction(proofGraph);
  const terminalBatchGraph = terminalBatchGraphFromProofGraph(graph);
  const nextActionHandoffPair = nextActionHandoffPairFromReadiness(readiness);
  const recoveryReceiptGraphs =
    recoveryReceiptGraphSummariesFromProofGraph(graph);
  const sourceTargetsByCheckId =
    productionFeatureSourceTargetsByCheckIdFromReadiness(readiness, {
      defaultBrowserProofCommand: devTestGameLiveProofCommand,
      defaultRerunCommandBySourceCheckId:
        defaultProductionFeatureSpineRerunCommands,
    });
  const candidates = rankedArtifactsNeedingRefresh(manifest);
  const artifact = candidates[0]?.artifact;
  const selectionTrace = buildSelectionTrace(candidates);
  const stabilityDrift = proofStabilityDriftFromOpsArtifacts(ops);
  const stabilityTrace = buildProofStabilityTrace(stabilityDrift);
  const seedProofLaneCoverageDrift =
    seedProofLaneCoverageDriftFromReadiness(readiness, {
      source: devTestGameReleaseReadinessPath,
    });
  const seedProofLaneCoverageTrace = buildSeedProofLaneCoverageTrace(
    seedProofLaneCoverageDrift,
  );
  const proofGraphDestinationSummaryDrift =
    proofGraphDestinationSummaryDriftFromProofGraph(graph, {
      source: proofGraphSource,
    });
  const proofGraphDestinationSummaryTrace =
    buildProofGraphDestinationSummaryTrace(proofGraphDestinationSummaryDrift);
  const proofGraphDiagnosticSummaryTrace =
    buildProofGraphDiagnosticSummaryTrace(graph, { source: proofGraphSource });
  const releaseReadinessCandidates = rankedBuildableReleaseReadinessItems(readiness, {
    hostedTargetPreflight: hostedPreflight,
    sourceTargetsByCheckId,
    proofGraph: graph,
    hostedIdentityOperatorBuildable:
      hostedIdentityOperatorBuildableForManifest(manifest, { sequenceStage }),
    hostedIdentityProgressionProofs,
  });
  const releaseReadinessTrace = buildReleaseReadinessTrace(releaseReadinessCandidates);
  const localReadinessDependencyCandidates =
    rankedMissingLocalReadinessDependencies(readiness);
  const localReadinessDependencyTrace = buildLocalReadinessDependencyTrace(
    localReadinessDependencyCandidates,
  );
  const replacementRaceReloadTrace = buildReplacementRaceReloadTrace(races, {
    source: raceCoverageSource,
  });
  const hostConcurrentRaceReloadTrace = buildHostConcurrentRaceReloadTrace(races, {
    source: raceCoverageSource,
  });
  const playerConcurrentActionReloadTrace = buildPlayerConcurrentActionReloadTrace(
    races,
    {
      source: raceCoverageSource,
    },
  );
  const cohostDeadlineRaceReloadTrace = buildCohostDeadlineRaceReloadTrace(races, {
    source: raceCoverageSource,
  });
  const raceCoveragePromotedMilestones = buildRaceCoveragePromotedMilestones(
    races,
    {
      replacementRaceReloadTrace,
      hostConcurrentRaceReloadTrace,
      playerConcurrentActionReloadTrace,
      cohostDeadlineRaceReloadTrace,
    },
  );
  const staleConflictMessageTrace = buildStaleConflictMessageTrace(readiness);
  const hostStaleControlTrace = buildHostStaleControlTrace(readiness);
  const selectedUnproven = releaseReadinessCandidates[0];
  const selectedLocalReadinessDependency = localReadinessDependencyCandidates[0];
  const localCapabilityConfidence =
    localCapabilityConfidenceFromReadiness(readiness);
  const hostedIdentitySequenceDeferral =
    hostedIdentitySequenceDeferralFor(selectedUnproven, {
      sequenceStage,
      localCapabilityConfidence,
    });
  const nextAction =
    artifact !== undefined
      ? {
          command: artifact.nextCommand ?? artifact.refreshCommand,
          reason: "artifact-not-fresh",
          status: "blocked",
          artifact: {
            id: artifact.id,
            label: artifact.label,
            path: artifact.path,
            status: artifact.status,
            refreshSource: artifact.refreshSource,
            proofTarget: artifact.path,
            ...artifactRecoveryMetadata(artifact),
          },
        }
      : stabilityDrift.status === "drifted"
        ? {
            command: devTestGameLiveProofCommand,
            reason: "harness-stability-drift",
            status: "blocked",
            stability: {
              source: opsArtifactsSource,
              hostConfirmClicks: stabilityDrift.hostConfirmClicks,
              retryClickCount: stabilityDrift.retryClickCount,
              domFallbackCount: stabilityDrift.domFallbackCount,
              forceFallbackCount: stabilityDrift.forceFallbackCount,
              failureCount: stabilityDrift.failureCount,
              maxAttempts: stabilityDrift.maxAttempts,
              eventCount: stabilityDrift.events.length,
              buildSlice:
                "Stabilize the critical host-confirm browser interaction before expanding the production-facing seeded proof spine.",
              proofTarget: devTestGameSessionPath,
            },
          }
      : proofGraphDestinationSummaryDrift.status === "drifted"
        ? {
            command: `npm run ${devTestGameProofGraphCommand}`,
            reason: "proof-graph-destination-summary-drift",
            status: "blocked",
            proofGraphDestinationSummary: {
              source: proofGraphDestinationSummaryDrift.source,
              summaryStatus: proofGraphDestinationSummaryDrift.summaryStatus,
              totalDestinationCount:
                proofGraphDestinationSummaryDrift.totalDestinationCount,
              productionFeatureTargetCount:
                proofGraphDestinationSummaryDrift.productionFeatureTargetCount,
              adminAuditDestinationCount:
                proofGraphDestinationSummaryDrift.adminAuditDestinationCount,
              roleUrlDestinationCount:
                proofGraphDestinationSummaryDrift.roleUrlDestinationCount,
              driftCount: proofGraphDestinationSummaryDrift.driftCount,
              buildSlice:
                "Refresh the proof graph so its production-feature destination summary matches the production-feature target inventory before next-action or readiness guidance is trusted.",
              proofTarget: devTestGameProofGraphPath,
            },
          }
      : seedProofLaneCoverageDrift.status === "drifted"
        ? {
            command: devTestGameSeedFixtureCommand,
            reason: "seed-proof-lane-coverage-drift",
            status: "blocked",
            seedProofLaneCoverage: {
              source: seedProofLaneCoverageDrift.source,
              status: seedProofLaneCoverageDrift.status,
              passedLaneCount: seedProofLaneCoverageDrift.passedLaneCount,
              unclassifiedLaneCount:
                seedProofLaneCoverageDrift.unclassifiedLaneCount,
              unclassifiedLaneIds:
                seedProofLaneCoverageDrift.unclassifiedLaneIds,
              buildSlice:
                "Classify every passed proof lane as direct seeded, alias-covered, or aggregate-only before expanding the production-facing seeded proof spine.",
              proofTarget: devTestGameSeedFixturePath,
              roleUrl: devTestGameSeedFixtureRoleUrl,
            },
          }
      : selectedLocalReadinessDependency !== undefined
        ? {
            command: selectedLocalReadinessDependency.command,
            reason: "release-readiness-local-check-missing",
            status: "blocked",
            localCheck: {
              id: selectedLocalReadinessDependency.id,
              status: selectedLocalReadinessDependency.status,
              requiredEvidence: selectedLocalReadinessDependency.requiredEvidence,
              buildSlice: selectedLocalReadinessDependency.buildSlice,
              proofTarget: selectedLocalReadinessDependency.proofTarget,
              roleUrl: selectedLocalReadinessDependency.roleUrl,
            },
          }
      : hostedIdentitySequenceDeferral !== null
        ? {
            command: hostedIdentitySequenceDeferral.nextLocalCommand,
            reason: "sequence-deferred-hosted-identity",
            status: "blocked",
            sequenceDeferral: hostedIdentitySequenceDeferral,
          }
      : selectedUnproven !== undefined
        ? {
            command: selectedUnproven.command,
            reason: "release-readiness-unproven",
            status: selectedUnproven.actionStatus,
            unproven: {
              id: selectedUnproven.item.id,
              status: selectedUnproven.item.status,
              requiredEvidence: selectedUnproven.item.requiredEvidence,
              buildSlice: selectedUnproven.buildSlice,
              proofTarget: selectedUnproven.proofTarget,
              roleUrl: selectedUnproven.roleUrl,
              proofGraphNodeId: selectedUnproven.proofGraphNodeId,
              productionFeatureSpineTarget:
                selectedUnproven.productionFeatureSpineTarget,
              ...(selectedUnproven.spineDrilldown == null
                ? {}
                : { spineDrilldown: selectedUnproven.spineDrilldown }),
              ...(selectedUnproven.spineTarget == null
                ? {}
                : { spineTarget: selectedUnproven.spineTarget }),
              ...(selectedUnproven.selectedProductionFeatureGraph == null
                ? {}
                : {
                    selectedProductionFeatureGraph:
                      selectedUnproven.selectedProductionFeatureGraph,
                  }),
              ...(selectedUnproven.hostedEvidenceMode === undefined
                ? {}
                : { hostedEvidenceMode: selectedUnproven.hostedEvidenceMode }),
              ...(selectedUnproven.realHostedEvidenceStatus === undefined
                ? {}
                : {
                    realHostedEvidenceStatus:
                      selectedUnproven.realHostedEvidenceStatus,
                  }),
              ...(selectedUnproven.realHostedEvidenceInputs === undefined
                ? {}
                : {
                    realHostedEvidenceInputs:
                      selectedUnproven.realHostedEvidenceInputs,
                  }),
              ...(selectedUnproven.hostedHandoffChecklist === undefined
                ? {}
                : {
                    hostedHandoffChecklist:
                      selectedUnproven.hostedHandoffChecklist,
                  }),
              ...(selectedUnproven.hostedIdentityProgression === undefined
                ? {}
                : {
                    hostedIdentityProgression:
                      selectedUnproven.hostedIdentityProgression,
                  }),
            },
          }
        : {
            command:
              manifest.artifactFreshness?.nextCommand ?? proofFreshnessAdminProofCommand,
            reason: "all-artifacts-fresh",
            status: "ready",
          };
  const releaseReadinessSummary =
    readiness === null
      ? null
      : {
          status: readiness.releaseReadiness.status,
          localCheckCount: readiness.localDevelopmentSpine.checks.length,
          buildableLocalDependencyCount: localReadinessDependencyCandidates.length,
          unprovenCount: readiness.releaseReadiness.unproven.length,
          buildableUnprovenCount: releaseReadinessCandidates.length,
        };
  const evidence = {
    version: DEV_TEST_GAME_NEXT_ACTION_VERSION,
    proof: "dev-test-game-next-action",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-next-action",
    proofBoundary:
      "Local next-action receipt derived from the generated dev-test-game spine manifest, ops artifacts, race coverage, and release-readiness checklist. It chooses the highest-priority local artifact recovery command while the development-spine is stale, records replacement, host, player, and cohost race-reload milestone coverage, blocks on saved harness-stability drift, then recovers missing local readiness dependencies before choosing a local-dev buildable slice from the current unproven release-readiness checklist; it does not validate artifact contents, hosted operations, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      spineManifest: spineManifestSource,
      manifestGeneratedAt: manifest.generatedAt,
      artifactFreshnessStatus: manifest.artifactFreshness.status,
      artifactFreshnessSummary: { ...manifest.artifactFreshness.summary },
      ...(ops === null
        ? {}
        : {
            opsArtifacts: opsArtifactsSource,
            proofStabilityStatus: stabilityDrift.status,
            proofStabilitySummary: {
              hostConfirmClicks: stabilityDrift.hostConfirmClicks,
              retryClickCount: stabilityDrift.retryClickCount,
              domFallbackCount: stabilityDrift.domFallbackCount,
              forceFallbackCount: stabilityDrift.forceFallbackCount,
              failureCount: stabilityDrift.failureCount,
            },
          }),
      ...(readiness === null
        ? {}
        : {
            sequenceStage,
            releaseReadinessChecklist: releaseReadinessChecklistSource,
            releaseReadinessGeneratedAt: readiness.generatedAt,
            releaseReadinessSummary,
            seedProofLaneCoverageStatus: seedProofLaneCoverageDrift.status,
            seedProofLaneCoverageUnclassifiedCount:
              seedProofLaneCoverageDrift.unclassifiedLaneCount,
          }),
      ...(races === null
        ? {}
        : {
            raceCoverage: raceCoverageSource,
            replacementRaceReloadSummary: {
              status: replacementRaceReloadTrace.status,
              requiredCellCount: replacementRaceReloadTrace.requiredCellCount,
              coveredCellCount: replacementRaceReloadTrace.coveredCellCount,
              gapCount: replacementRaceReloadTrace.gapCount,
            },
            hostConcurrentRaceReloadSummary: {
              status: hostConcurrentRaceReloadTrace.status,
              requiredCellCount: hostConcurrentRaceReloadTrace.requiredCellCount,
              coveredCellCount: hostConcurrentRaceReloadTrace.coveredCellCount,
              gapCount: hostConcurrentRaceReloadTrace.gapCount,
            },
            playerConcurrentActionReloadSummary: {
              status: playerConcurrentActionReloadTrace.status,
              requiredCellCount:
                playerConcurrentActionReloadTrace.requiredCellCount,
              coveredCellCount:
                playerConcurrentActionReloadTrace.coveredCellCount,
              gapCount: playerConcurrentActionReloadTrace.gapCount,
            },
            cohostDeadlineRaceReloadSummary: {
              status: cohostDeadlineRaceReloadTrace.status,
              requiredCellCount: cohostDeadlineRaceReloadTrace.requiredCellCount,
              coveredCellCount: cohostDeadlineRaceReloadTrace.coveredCellCount,
              gapCount: cohostDeadlineRaceReloadTrace.gapCount,
            },
            raceCoveragePromotedMilestones,
          }),
      ...(hostedPreflight === null
        ? {}
        : {
            hostedTargetPreflight: hostedTargetPreflightSource,
            hostedTargetPreflightStatus: hostedPreflight.status,
            hostedTargetPreflightNextCommand: hostedPreflight.nextCommand,
            hostedTargetPreflightNextProofTarget: hostedPreflight.nextProofTarget,
            hostedTargetPreflightBlockedCheckCount: hostedPreflight.checks.filter(
              (check) => check.status === "blocked",
            ).length,
          }),
      ...(graph === null
        ? {}
        : {
            proofGraph: proofGraphSource,
            proofGraphGeneratedAt: graph.generatedAt,
            proofGraphDestinationSummaryStatus:
              proofGraphDestinationSummaryDrift.status,
            proofGraphDestinationSummaryDriftCount:
              proofGraphDestinationSummaryDrift.driftCount,
            proofGraphDiagnosticSummaryStatus:
              proofGraphDiagnosticSummaryTrace.status,
            proofGraphDiagnosticCount:
              proofGraphDiagnosticSummaryTrace.diagnosticCount,
            ...(terminalBatchGraph === null
              ? {}
              : { terminalBatchGraph }),
            ...(nextActionHandoffPair === null
              ? {}
              : { nextActionHandoffPair }),
            ...recoveryReceiptGraphs,
          }),
    },
    nextAction,
    selectionTrace,
    stabilityTrace,
    proofGraphDestinationSummaryTrace,
    proofGraphDiagnosticSummaryTrace,
    seedProofLaneCoverageTrace,
    localReadinessDependencyTrace,
    releaseReadinessTrace,
    replacementRaceReloadTrace,
    hostConcurrentRaceReloadTrace,
    playerConcurrentActionReloadTrace,
    cohostDeadlineRaceReloadTrace,
    raceCoveragePromotedMilestones,
    staleConflictMessageTrace,
    hostStaleControlTrace,
  };
  assertDevTestGameNextAction(evidence);
  return evidence;
}

export function assertDevTestGameNextAction(evidence) {
  if (evidence?.version !== DEV_TEST_GAME_NEXT_ACTION_VERSION) {
    throw new Error(`next-action version drifted: ${evidence?.version}`);
  }
  if (evidence.proof !== "dev-test-game-next-action") {
    throw new Error(`unexpected next-action proof id: ${evidence.proof}`);
  }
  if (evidence.status !== "passed") {
    throw new Error(`next-action status is ${evidence.status}`);
  }
  if (evidence.scope !== "local-dev-test-game-next-action") {
    throw new Error(`next-action scope drifted: ${evidence.scope}`);
  }
  if (evidence.releaseReady !== false || evidence.productionReady !== false) {
    throw new Error("next-action must not claim production or release readiness");
  }
  if (typeof evidence.nextAction?.command !== "string" || evidence.nextAction.command === "") {
    throw new Error("next-action is missing a command");
  }
  if (!["ready", "blocked"].includes(evidence.nextAction.status)) {
    throw new Error(`next-action status drifted: ${evidence.nextAction.status}`);
  }
  if (
    ![
      "all-artifacts-fresh",
      "artifact-not-fresh",
      "harness-stability-drift",
      "proof-graph-destination-summary-drift",
      "seed-proof-lane-coverage-drift",
      "release-readiness-local-check-missing",
      "release-readiness-unproven",
      "sequence-deferred-hosted-identity",
    ].includes(evidence.nextAction.reason)
  ) {
    throw new Error(`next-action reason drifted: ${evidence.nextAction.reason}`);
  }
  if (
    evidence.nextAction.reason === "artifact-not-fresh" &&
    (typeof evidence.nextAction.artifact?.id !== "string" ||
      typeof evidence.nextAction.artifact?.proofTarget !== "string" ||
      evidence.nextAction.artifact.proofTarget.trim() === "")
  ) {
    throw new Error("next-action artifact recovery is missing artifact proof target");
  }
  if (
    evidence.nextAction.reason === "release-readiness-unproven" &&
    typeof evidence.nextAction.unproven?.id !== "string"
  ) {
    throw new Error("next-action release-readiness recovery is missing an unproven id");
  }
  if (evidence.nextAction.reason === "sequence-deferred-hosted-identity") {
    assertHostedIdentitySequenceDeferral(evidence.nextAction.sequenceDeferral);
    if (
      evidence.nextAction.command !==
        evidence.nextAction.sequenceDeferral.nextLocalCommand ||
      evidence.nextAction.status !== "blocked"
    ) {
      throw new Error("next-action hosted identity sequence deferral drifted");
    }
  }
  if (
    evidence.nextAction.reason === "release-readiness-local-check-missing" &&
    typeof evidence.nextAction.localCheck?.id !== "string"
  ) {
    throw new Error("next-action local readiness recovery is missing a check id");
  }
  if (evidence.nextAction.reason === "release-readiness-local-check-missing") {
    if (
      typeof evidence.nextAction.localCheck?.roleUrl !== "string" ||
      !evidence.nextAction.localCheck.roleUrl.includes("?game=<seeded-game>")
    ) {
      throw new Error("next-action local readiness recovery is missing a seeded role URL");
    }
  }
  if (evidence.nextAction.reason === "release-readiness-unproven") {
    if (
      typeof evidence.nextAction.unproven?.roleUrl !== "string" ||
      !evidence.nextAction.unproven.roleUrl.includes("?game=<seeded-game>")
    ) {
      throw new Error("next-action release-readiness recovery is missing a seeded role URL");
    }
    if (typeof evidence.nextAction.unproven?.proofGraphNodeId !== "string") {
      throw new Error("next-action release-readiness recovery is missing a graph node id");
    }
    if (
      !validProductionFeatureSpineDeclaration(
        evidence.nextAction.unproven?.productionFeatureSpineTarget,
      )
    ) {
      throw new Error(
        "next-action release-readiness recovery is missing a production feature spine declaration",
      );
    }
    if (
      !validProductionFeatureSpineTarget(evidence.nextAction.unproven?.spineTarget, {
        sourceCheckRules: productionFeatureSpineSourceCheckRules,
      })
    ) {
      throw new Error(
        "next-action release-readiness recovery is missing an actionable spine target",
      );
    }
    if (
      !validProductionFeatureSpineDrilldown(
        evidence.nextAction.unproven?.spineDrilldown,
        { sourceCheckRules: productionFeatureSpineSourceCheckRules },
      )
    ) {
      throw new Error(
        "next-action release-readiness recovery is missing a feature spine drilldown",
      );
    }
    if (
      evidence.generatedFrom?.proofGraph !== undefined &&
      !validSelectedProductionFeatureGraph(
        evidence.nextAction.unproven?.selectedProductionFeatureGraph,
        evidence.nextAction.unproven?.spineTarget,
      )
    ) {
      throw new Error(
        "next-action release-readiness recovery is missing selected production feature graph evidence",
      );
    }
    if (
      evidence.nextAction.unproven?.hostedHandoffChecklist !== undefined &&
      !validHostedHandoffChecklist(
        evidence.nextAction.unproven.hostedHandoffChecklist,
      )
    ) {
      throw new Error(
        "next-action release-readiness recovery has a malformed hosted handoff checklist",
      );
    }
    if (
      evidence.nextAction.unproven?.hostedIdentityProgression !== undefined &&
      !validHostedIdentityProgressionSelection(
        evidence.nextAction.unproven.hostedIdentityProgression,
        evidence.nextAction.unproven.hostedHandoffChecklist,
      )
    ) {
      throw new Error(
        "next-action release-readiness recovery has a malformed hosted identity progression",
      );
    }
  }
  if (
    evidence.nextAction.reason === "harness-stability-drift" &&
    typeof evidence.nextAction.stability?.source !== "string"
  ) {
    throw new Error("next-action harness-stability recovery is missing stability evidence");
  }
  if (evidence.nextAction.reason === "proof-graph-destination-summary-drift") {
    if (
      evidence.nextAction.command !== `npm run ${devTestGameProofGraphCommand}` ||
      evidence.nextAction.status !== "blocked" ||
      typeof evidence.nextAction.proofGraphDestinationSummary?.source !== "string" ||
      evidence.nextAction.proofGraphDestinationSummary.proofTarget !==
        devTestGameProofGraphPath ||
      !Number.isInteger(
        evidence.nextAction.proofGraphDestinationSummary.driftCount,
      )
    ) {
      throw new Error(
        "next-action proof graph destination-summary recovery is missing drift evidence",
      );
    }
  }
  if (evidence.nextAction.reason === "seed-proof-lane-coverage-drift") {
    if (
      typeof evidence.nextAction.seedProofLaneCoverage?.source !== "string" ||
      !Array.isArray(
        evidence.nextAction.seedProofLaneCoverage?.unclassifiedLaneIds,
      ) ||
      evidence.nextAction.seedProofLaneCoverage.unclassifiedLaneIds.length === 0 ||
      evidence.nextAction.seedProofLaneCoverage.roleUrl !==
        devTestGameSeedFixtureRoleUrl ||
      evidence.nextAction.seedProofLaneCoverage.proofTarget !==
        devTestGameSeedFixturePath
    ) {
      throw new Error(
        "next-action seed proof-lane coverage recovery is missing drift evidence",
      );
    }
  }
  assertSelectionTrace(evidence.selectionTrace, {
    nextAction: evidence.nextAction,
  });
  assertPreReadinessTrace(
    preReadinessTraceKeys.proofStability,
    evidence.stabilityTrace,
    {
      label: "next-action stability trace",
      nextActionReason: evidence.nextAction.reason,
    },
  );
  assertPreReadinessTrace(
    preReadinessTraceKeys.proofGraphDestinationSummary,
    evidence.proofGraphDestinationSummaryTrace,
    {
      label: "next-action proof graph destination-summary trace",
      nextActionReason: evidence.nextAction.reason,
      nextActionProofGraphDestinationSummary:
        evidence.nextAction.proofGraphDestinationSummary,
    },
  );
  assertProofGraphDiagnosticSummaryTrace(evidence.proofGraphDiagnosticSummaryTrace);
  assertPreReadinessTrace(
    preReadinessTraceKeys.seedProofLaneCoverage,
    evidence.seedProofLaneCoverageTrace,
    {
      label: "next-action seed proof-lane coverage trace",
      nextActionReason: evidence.nextAction.reason,
    },
  );
  assertPreReadinessTrace(
    preReadinessTraceKeys.localReadinessDependency,
    evidence.localReadinessDependencyTrace,
    {
      label: "next-action local readiness dependency trace",
      nextActionReason: evidence.nextAction.reason,
      nextActionLocalCheck: evidence.nextAction.localCheck,
      nextActionCommand: evidence.nextAction.command,
    },
  );
  assertReleaseReadinessTrace(evidence.releaseReadinessTrace, {
    nextAction: evidence.nextAction,
  });
  assertRecoveryTrace(
    recoveryTraceKeys.replacementRaceReload,
    evidence.replacementRaceReloadTrace,
    { label: "next-action replacement-race reload trace" },
  );
  assertRecoveryTrace(
    recoveryTraceKeys.hostConcurrentRaceReload,
    evidence.hostConcurrentRaceReloadTrace,
    { label: "next-action host concurrent race-reload trace" },
  );
  assertRecoveryTrace(
    recoveryTraceKeys.playerConcurrentActionReload,
    evidence.playerConcurrentActionReloadTrace,
    { label: "next-action player concurrent action reload trace" },
  );
  assertRecoveryTrace(
    recoveryTraceKeys.cohostDeadlineRaceReload,
    evidence.cohostDeadlineRaceReloadTrace,
    { label: "next-action cohost deadline race reload trace" },
  );
  assertRaceCoveragePromotedMilestones(evidence.raceCoveragePromotedMilestones);
  assertRecoveryTrace(
    recoveryTraceKeys.staleConflictMessage,
    evidence.staleConflictMessageTrace,
    { label: "next-action stale conflict-message trace" },
  );
  assertRecoveryTrace(
    recoveryTraceKeys.hostStaleControl,
    evidence.hostStaleControlTrace,
    { label: "next-action host stale-control trace" },
  );
  assertTerminalBatchGraph(evidence.generatedFrom?.terminalBatchGraph);
  assertNextActionHandoffPairForNextAction(
    evidence.generatedFrom?.nextActionHandoffPair,
  );
  assertRecoveryReceiptGraphsForNextAction(evidence.generatedFrom);
  return evidence;
}

export async function writeDevTestGameNextAction({
  generatedAt = new Date().toISOString(),
  sequenceStage =
    process.env.FMARCH_DEV_TEST_GAME_SEQUENCE_STAGE ??
    devTestGameDefaultSequenceStage,
  manifestPath = process.env.FMARCH_DEV_TEST_GAME_SPINE_MANIFEST ?? spineManifestPath,
  nextActionOutputPath =
    process.env.FMARCH_DEV_TEST_GAME_NEXT_ACTION ?? devTestGameNextActionPath,
} = {}) {
  const nextActionJsonPath = path.resolve(repoRoot, nextActionOutputPath);
  const absoluteManifestPath = path.resolve(repoRoot, manifestPath);
  const absoluteReleaseReadinessPath = path.resolve(
    repoRoot,
    process.env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS_CHECKLIST ??
      devTestGameReleaseReadinessPath,
  );
  const manifest = JSON.parse(await readFile(absoluteManifestPath, "utf8"));
  const releaseReadinessChecklist = JSON.parse(
    await readFile(absoluteReleaseReadinessPath, "utf8"),
  );
  const absoluteOpsArtifactsPath = path.resolve(
    repoRoot,
    process.env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS ?? devTestGameOpsArtifactsPath,
  );
  const opsArtifacts = JSON.parse(await readFile(absoluteOpsArtifactsPath, "utf8"));
  const absoluteRaceCoveragePath = path.resolve(
    repoRoot,
    process.env.FMARCH_DEV_TEST_GAME_RACE_COVERAGE ?? devTestGameRaceCoveragePath,
  );
  const raceCoverage = JSON.parse(await readFile(absoluteRaceCoveragePath, "utf8"));
  const absoluteHostedTargetPreflightPath = path.resolve(
    repoRoot,
    process.env.FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT ??
      devTestGameHostedTargetPreflightPath,
  );
  const hostedTargetPreflight = await readOptionalJson(absoluteHostedTargetPreflightPath);
  const absoluteProofGraphPath = path.resolve(
    repoRoot,
    process.env.FMARCH_DEV_TEST_GAME_PROOF_GRAPH ?? devTestGameProofGraphPath,
  );
  const proofGraph = await readOptionalJson(absoluteProofGraphPath);
  const hostedIdentityProgressionProofs =
    await readHostedIdentityProgressionProofs();
  const spineManifestSource = path.relative(repoRoot, absoluteManifestPath);
  const releaseReadinessChecklistSource = path.relative(
    repoRoot,
    absoluteReleaseReadinessPath,
  );
  const opsArtifactsSource = path.relative(repoRoot, absoluteOpsArtifactsPath);
  const raceCoverageSource = path.relative(repoRoot, absoluteRaceCoveragePath);
  const hostedTargetPreflightSource = path.relative(
    repoRoot,
    absoluteHostedTargetPreflightPath,
  );
  const proofGraphSource = path.relative(repoRoot, absoluteProofGraphPath);
  const evidence = buildDevTestGameNextAction(manifest, {
    generatedAt,
    sequenceStage,
    spineManifestSource,
    releaseReadinessChecklist,
    releaseReadinessChecklistSource,
    opsArtifacts,
    opsArtifactsSource,
    raceCoverage,
    raceCoverageSource,
    hostedTargetPreflight,
    hostedTargetPreflightSource,
    proofGraph,
    proofGraphSource,
    hostedIdentityProgressionProofs,
  });
  await mkdir(path.dirname(nextActionJsonPath), { recursive: true });
  await writeFile(nextActionJsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function rankedArtifactsNeedingRefresh(manifest) {
  const artifacts = (manifest.artifactFreshness?.artifacts ?? []).filter(
    (artifact) => artifact.status !== "fresh",
  );
  return artifacts
    .map((artifact, index) => ({
      artifact,
      index,
      priority: developmentSpineArtifactPriority(artifact),
      statusPriority: artifact.status === "missing" ? 0 : 1,
    }))
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        left.statusPriority - right.statusPriority ||
        artifactAgeSeconds(right.artifact) - artifactAgeSeconds(left.artifact) ||
        left.index - right.index,
    );
}

function artifactRecoveryMetadata(artifact) {
  if (artifact.id === "host-setup-role") {
    return {
      roleUrl: devTestGameHostSetupRoleUrl,
      requiredEvidence:
        "Fresh host setup seeded role proof artifact with setup workbench browser proof for /g/<seeded-game>/setup, roster/role/policy/start recovery, and command recovery.",
      buildSlice:
        "Refresh only the host setup workbench role URL proof before trusting /g/<seeded-game>/setup freshness.",
      proofBoundary:
        "Local host setup workbench role proof freshness recovery only; does not prove the admin audit surface, hosted setup behavior, release readiness, or production readiness.",
    };
  }
  if (artifact.id === "host-setup-admin") {
    return {
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostSetupProof),
      requiredEvidence:
        "Fresh host setup admin proof artifact with visible setup checks.",
      buildSlice:
        "Refresh only the host setup admin proof before trusting host setup admin freshness.",
      proofBoundary:
        "Local host setup admin proof freshness recovery only; does not rerun the role proof or claim release readiness.",
    };
  }
  return {};
}

function rankedBuildableReleaseReadinessItems(
  readiness,
  {
    hostedTargetPreflight = null,
    sourceTargetsByCheckId = {},
    proofGraph = null,
    hostedIdentityOperatorBuildable = null,
    hostedIdentityProgressionProofs = {},
  } = {},
) {
  if (readiness === null) {
    return [];
  }
  return (readiness.releaseReadiness?.unproven ?? [])
    .map((item, index) => {
      const buildable =
        releaseReadinessBuildableItemForId(item.id, { hostedTargetPreflight });
      if (buildable === undefined) {
        return null;
      }
      const hostedIdentityProgressionBuildable =
        item.id === "hosted-production-identity" &&
        hostedIdentityOperatorBuildable !== null
          ? hostedIdentityProgressionBuildableForChecklist({
              hostedHandoffChecklist: buildable.hostedHandoffChecklist,
              hostedIdentityProgressionProofs,
            })
          : null;
      const selectedBuildable =
        hostedIdentityProgressionBuildable !== null
          ? {
              ...buildable,
              ...hostedIdentityOperatorBuildable,
              ...hostedIdentityProgressionBuildable,
            }
          : item.id === "hosted-production-identity" &&
              hostedIdentityOperatorBuildable !== null
            ? { ...buildable, ...hostedIdentityOperatorBuildable }
            : buildable;
      const spineTarget = resolveProductionFeatureSpineTarget({
        itemId: item.id,
        declaration: selectedBuildable.productionFeatureSpineTarget,
        sourceTargetsByCheckId,
        defaultRerunCommandBySourceCheckId:
          defaultProductionFeatureSpineRerunCommands,
      });
      const selectedProductionFeatureGraph =
        selectedProductionFeatureGraphForTarget({
          proofGraph,
          spineTarget,
        });
      return {
        item,
        index,
        priority: selectedBuildable.priority,
        command: selectedBuildable.command,
        buildSlice: selectedBuildable.buildSlice,
        proofTarget: selectedBuildable.proofTarget,
        roleUrl: selectedBuildable.roleUrl,
        proofGraphNodeId: selectedBuildable.proofGraphNodeId,
        proofBoundary: selectedBuildable.proofBoundary,
        productionFeatureSpineTarget:
          selectedBuildable.productionFeatureSpineTarget,
        spineTarget,
        spineDrilldown: buildProductionFeatureSpineDrilldown(spineTarget),
        selectedProductionFeatureGraph,
        hostedEvidenceMode: selectedBuildable.hostedEvidenceMode,
        realHostedEvidenceStatus: selectedBuildable.realHostedEvidenceStatus,
        realHostedEvidenceInputs: selectedBuildable.realHostedEvidenceInputs,
        hostedHandoffChecklist: selectedBuildable.hostedHandoffChecklist,
        hostedIdentityProgression: selectedBuildable.hostedIdentityProgression,
        actionStatus: releaseReadinessActionStatus(selectedBuildable),
      };
    })
    .filter((candidate) => candidate !== null)
    .sort(
      (left, right) =>
        releaseReadinessActionRank(left.actionStatus) -
          releaseReadinessActionRank(right.actionStatus) ||
        left.priority - right.priority ||
        left.index - right.index,
    );
}

function hostedIdentityOperatorBuildableForManifest(
  manifest,
  { sequenceStage },
) {
  if (sequenceStage !== devTestGameHostedIdentitySequenceStage) {
    return null;
  }
  if (
    manifest.commands?.identityOperator?.script !==
    devTestGameHostedIdentityOperatorSpineScript
  ) {
    return null;
  }
  return {
    command: devTestGameHostedIdentityOperatorSpineCommand,
    buildSlice:
      "Run the opt-in hosted identity operator spine after the hosted identity family admin proofs are current; it attaches the target-local redacted operator packet to the admin proof and refreshes readiness through the operator predicate without claiming live hosted traffic, release readiness, or production readiness.",
    proofTarget: devTestGameHostedIdentityOperatorAdminProofPath,
    proofBoundary:
      "Opt-in local operator predicate proof. The command proves that a non-fixture hosted identity packet path can clear the hosted-production-identity readiness item over the existing role-surface adapter; it does not prove live hosted account/session/invite traffic, release readiness, or production readiness.",
  };
}

function hostedIdentityProgressionBuildableForChecklist({
  hostedHandoffChecklist,
  hostedIdentityProgressionProofs = {},
}) {
  const progression = firstUnprovenHostedIdentityProgression({
    hostedHandoffChecklist,
    hostedIdentityProgressionProofs,
  });
  if (!validHostedIdentityProgressionSummaryRow(progression)) {
    return null;
  }
  const selectedProgression = {
    id: progression.id,
    checkId: progression.checkId,
    missingInputId: progression.missingInputId,
    adminProofMode: progression.adminProofMode,
    proofCommand: progression.proofCommand,
    evidencePath: progression.evidencePath,
    adminProofTarget: progression.adminProofTarget,
    roleUrl: progression.roleUrl,
    firstMissingInputId: progression.firstMissingInputId,
    firstMissingCheckId: progression.firstMissingCheckId,
    proofBoundary: progression.proofBoundary,
    artifactStatus: hostedIdentityProgressionArtifactStatus(
      progression,
      hostedIdentityProgressionProofs,
    ),
  };
  return {
    command: progression.proofCommand,
    buildSlice: [
      `Run the first hosted identity evidence-family admin proof (${progression.id});`,
      `it proves the admin handoff can surface ${progression.firstMissingInputId}`,
      "while the aggregate hosted identity evidence remains blocked and non-production.",
    ].join(" "),
    proofTarget: progression.adminProofTarget,
    roleUrl: progression.roleUrl,
    proofBoundary: progression.proofBoundary,
    hostedIdentityProgression: selectedProgression,
  };
}

function firstUnprovenHostedIdentityProgression({
  hostedHandoffChecklist,
  hostedIdentityProgressionProofs = {},
}) {
  const progressions =
    hostedHandoffChecklist?.progressionSummary?.progressions ?? [];
  return progressions.find(
    (progression) =>
      validHostedIdentityProgressionSummaryRow(progression) &&
      !validHostedIdentityProgressionProofArtifact(
        progression,
        hostedIdentityProgressionProofs,
      ),
  );
}

function hostedIdentityProgressionProofArtifactFor(
  progression,
  hostedIdentityProgressionProofs = {},
) {
  return (
    hostedIdentityProgressionProofs[progression.id] ??
    hostedIdentityProgressionProofs[progression.adminProofTarget] ??
    null
  );
}

function validHostedIdentityProgressionProofArtifact(
  progression,
  hostedIdentityProgressionProofs = {},
) {
  const artifact = hostedIdentityProgressionProofArtifactFor(
    progression,
    hostedIdentityProgressionProofs,
  );
  return (
    artifact !== null &&
    typeof artifact === "object" &&
    artifact.proof === "dev-test-game-hosted-identity-evidence-admin-proof" &&
    artifact.status === "passed" &&
    artifact.releaseReady === false &&
    artifact.productionReady === false &&
    artifact.generatedFrom?.hostedIdentityEvidence === progression.evidencePath &&
    artifact.generatedFrom?.proofArtifact === progression.adminProofTarget &&
    artifact.adminRoleSurface?.clickedThroughFromOverview === true &&
    artifact.adminRoleSurface?.rawInviteTokensVisible === false
  );
}

function hostedIdentityProgressionArtifactStatus(
  progression,
  hostedIdentityProgressionProofs = {},
) {
  const artifact = hostedIdentityProgressionProofArtifactFor(
    progression,
    hostedIdentityProgressionProofs,
  );
  if (artifact === null) {
    return "missing";
  }
  return validHostedIdentityProgressionProofArtifact(
    progression,
    hostedIdentityProgressionProofs,
  )
    ? "passed"
    : "stale";
}

function releaseReadinessActionRank(status) {
  return status === "ready" ? 0 : 1;
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

async function readHostedIdentityProgressionProofs() {
  const entries = await Promise.all(
    hostedIdentityEvidenceFamilyProgressionCases.map(async (progression) => {
      const proofPath = hostedIdentityEvidenceProgressionAdminProofPath(
        progression.id,
      );
      const proof = await readOptionalJson(path.resolve(repoRoot, proofPath));
      return proof === null
        ? []
        : [
            [progression.id, proof],
            [proofPath, proof],
          ];
    }),
  );
  return Object.fromEntries(entries.flat());
}

function assertProofGraphForNextAction(proofGraph) {
  if (
    proofGraph?.version !== 1 ||
    proofGraph.proof !== "dev-test-game-proof-graph" ||
    proofGraph.status !== "passed" ||
    proofGraph.scope !== "local-dev-test-game-proof-graph" ||
    !Array.isArray(proofGraph.nodes) ||
    !Array.isArray(proofGraph.edges)
  ) {
    throw new Error("next-action proof graph input is malformed");
  }
  return proofGraph;
}

function terminalBatchGraphFromProofGraph(proofGraph) {
  if (proofGraph === null) {
    return null;
  }
  const node = proofGraph.nodes.find(
    (candidate) => candidate?.id === "admin-spine-terminal-batches",
  );
  if (node === undefined) {
    return null;
  }
  const edges = proofGraph.edges.filter(
    (candidate) =>
      candidate?.from === "admin-spine-terminal-batches" &&
      candidate?.relationship === "terminal-browser-proof",
  );
  return {
    nodeId: node.id,
    status: String(node.status ?? "unknown"),
    proofTarget: String(node.artifact ?? ""),
    roleUrl: String(node.roleUrl ?? ""),
    batchCount: Number(node.batchCount ?? 0),
    proofIds: Array.isArray(node.proofIds)
      ? node.proofIds.map((proofId) => String(proofId))
      : [],
    receiptArtifacts: Array.isArray(node.receiptArtifacts)
      ? node.receiptArtifacts.map((artifact) => ({
          proofId: String(artifact.proofId ?? ""),
          artifactPath: String(artifact.artifactPath ?? ""),
          batchLabel: String(artifact.batchLabel ?? ""),
        }))
      : [],
    edgeCount: edges.length,
    edgeTargets: edges.map((edge) => String(edge.to ?? "")),
  };
}

function nextActionHandoffPairFromReadiness(readiness) {
  const pair = readiness?.localDevelopmentSpine?.checks?.find(
    (check) => check?.id === "local-admin-spine-terminal-batches",
  )?.nextActionHandoffPair;
  if (pair === undefined) {
    return null;
  }
  return assertDevTestGameNextActionSequenceHandoffPair(pair);
}

function assertNextActionHandoffPairForNextAction(pair) {
  if (pair === undefined) {
    return;
  }
  assertDevTestGameNextActionSequenceHandoffPair(pair);
}

function recoveryReceiptGraphSummariesFromProofGraph(proofGraph) {
  return Object.fromEntries(
    recoveryReceiptGraphDescriptors
      .map((descriptor) => [
        descriptor.nextActionGeneratedFromKey,
        recoveryReceiptGraphSummaryFromProofGraph(proofGraph, descriptor),
      ])
      .filter(([, summary]) => summary !== null),
  );
}

function assertTerminalBatchGraph(terminalBatchGraph) {
  if (terminalBatchGraph === undefined) {
    return;
  }
  if (
    terminalBatchGraph === null ||
    terminalBatchGraph.nodeId !== "admin-spine-terminal-batches" ||
    terminalBatchGraph.status !== "passed" ||
    terminalBatchGraph.proofTarget !==
      adminSpineTerminalBatchProofPath ||
    terminalBatchGraph.roleUrl !==
      "/admin/audit/local-admin-spine?game=<seeded-game>" ||
    !Number.isInteger(terminalBatchGraph.batchCount) ||
    terminalBatchGraph.batchCount < 1 ||
    terminalBatchGraph.edgeCount !== 3 ||
    JSON.stringify(terminalBatchGraph.edgeTargets) !==
      JSON.stringify(["proof-graph", "proof-freshness", "next-action"]) ||
    (Array.isArray(terminalBatchGraph.receiptArtifacts) &&
      terminalBatchGraph.receiptArtifacts.length > 0 &&
      !terminalBatchGraph.receiptArtifacts.some(
        (artifact) =>
          artifact.proofId === "hosted-identity-next-action" &&
          artifact.artifactPath ===
            "target/dev-test-game/hosted-identity-next-action-admin-proof.json",
      ))
  ) {
    throw new Error("next-action terminal batch graph summary drifted");
  }
}

function assertRecoveryReceiptGraphsForNextAction(generatedFrom) {
  for (const descriptor of recoveryReceiptGraphDescriptors) {
    assertRecoveryReceiptGraphSummary(
      generatedFrom?.[descriptor.nextActionGeneratedFromKey],
      descriptor,
      { label: "next-action" },
    );
  }
}

export function selectedProductionFeatureGraphForTarget({
  proofGraph,
  spineTarget,
  sourceNodeId = productionFeatureGraphSourceNodeId(spineTarget.sourceCheckId),
}) {
  if (proofGraph === null) {
    return null;
  }
  const nodeId = `production-feature:${spineTarget.featureSlotId}`;
  const node = proofGraph.nodes.find((candidate) => candidate?.id === nodeId);
  if (node === undefined) {
    throw new Error(`next-action proof graph missing feature node: ${nodeId}`);
  }
  const edge = proofGraph.edges.find(
    (candidate) =>
      candidate?.to === nodeId &&
      candidate?.relationship === "proves-production-feature",
  );
  if (edge === undefined) {
    throw new Error(`next-action proof graph missing feature edge: ${nodeId}`);
  }
  if (
    node.featureSlotId !== spineTarget.featureSlotId ||
    node.sourceCheckId !== spineTarget.sourceCheckId ||
    edge.from !== sourceNodeId ||
    edge.featureSlotId !== spineTarget.featureSlotId ||
    edge.command !== spineTarget.browserProofCommand
  ) {
    throw new Error(
      `next-action proof graph feature target drifted: ${spineTarget.featureSlotId}`,
    );
  }
  const targetRoleUrl = String(node.targetRoleUrl ?? "");
  const edgeTargetRoleUrl = String(edge.targetRoleUrl ?? "");
  return {
    nodeId,
    status: String(node.status ?? "unknown"),
    sourceNodeId: String(edge.from ?? ""),
    edge: {
      from: String(edge.from ?? ""),
      to: String(edge.to ?? ""),
      relationship: String(edge.relationship ?? ""),
    },
    roleUrl: String(node.roleUrl ?? ""),
    targetRoleUrl,
    edgeTargetRoleUrl,
    selectedSpineTargetRoleUrl: String(spineTarget.roleUrl ?? ""),
    targetRoleUrlMatchesSelectedSpineTarget:
      targetRoleUrl === spineTarget.roleUrl &&
      edgeTargetRoleUrl === spineTarget.roleUrl,
    browserProofCommand: String(
      node.browserProofCommand ?? edge.command ?? spineTarget.browserProofCommand,
    ),
    proofTarget: String(node.artifact ?? ""),
    coverageDecision: node.coverageDecision ?? spineTarget.coverageDecision,
  };
}

function validSelectedProductionFeatureGraph(graphSelection, spineTarget) {
  if (
    graphSelection === null ||
    typeof graphSelection !== "object" ||
    spineTarget === null ||
    typeof spineTarget !== "object"
  ) {
    return false;
  }
  const expectedNodeId = `production-feature:${spineTarget.featureSlotId}`;
  return (
    graphSelection.nodeId === expectedNodeId &&
    graphSelection.status === "passed" &&
    typeof graphSelection.sourceNodeId === "string" &&
    graphSelection.sourceNodeId.length > 0 &&
    graphSelection.edge?.to === expectedNodeId &&
    graphSelection.edge?.relationship === "proves-production-feature" &&
    typeof graphSelection.targetRoleUrl === "string" &&
    graphSelection.targetRoleUrl.length > 0 &&
    typeof graphSelection.selectedSpineTargetRoleUrl === "string" &&
    graphSelection.selectedSpineTargetRoleUrl === spineTarget.roleUrl &&
    graphSelection.browserProofCommand === spineTarget.browserProofCommand &&
    typeof graphSelection.proofTarget === "string" &&
    graphSelection.proofTarget.length > 0 &&
    JSON.stringify(graphSelection.coverageDecision ?? null) ===
      JSON.stringify(spineTarget.coverageDecision ?? null)
  );
}

function buildRaceCoveragePromotedMilestones(
  raceCoverage,
  {
    replacementRaceReloadTrace,
    hostConcurrentRaceReloadTrace,
    playerConcurrentActionReloadTrace,
    cohostDeadlineRaceReloadTrace,
  },
) {
  const traceByGroupId = new Map([
    ["replacement-race-reload", replacementRaceReloadTrace],
    ["host-concurrent-race-reload", hostConcurrentRaceReloadTrace],
    ["player-concurrent-action-reload", playerConcurrentActionReloadTrace],
    ["cohost-deadline-race-reload", cohostDeadlineRaceReloadTrace],
  ]);
  const groups = raceCoveragePromotedReloadGroups.map((group) =>
    buildRaceCoveragePromotedMilestoneGroup(group, traceByGroupId.get(group.id)),
  );
  const requiredCellCount = groups.reduce(
    (total, group) => total + group.requiredCellCount,
    0,
  );
  const coveredCellCount = groups.reduce(
    (total, group) => total + group.coveredCellCount,
    0,
  );
  const passedGroupCount = groups.filter((group) => group.status === "covered").length;
  const gapCount = requiredCellCount - coveredCellCount;
  return {
    status:
      raceCoverage === null ? "unavailable" : gapCount === 0 ? "passed" : "gapped",
    cellCount: Number(raceCoverage?.summary?.cellCount ?? 0),
    provenCellCount: Number(raceCoverage?.summary?.provenCellCount ?? 0),
    reloadCoveredCellCount: Number(
      raceCoverage?.summary?.reloadCoveredCellCount ?? 0,
    ),
    groupCount: groups.length,
    passedGroupCount,
    requiredCellCount,
    coveredCellCount,
    gapCount,
    groups,
  };
}

function buildRaceCoveragePromotedMilestoneGroup(group, trace) {
  return {
    id: group.id,
    label: group.label,
    status: trace.status,
    cellIds: trace.cells.map((cell) => cell.id),
    requiredCellCount: trace.requiredCellCount,
    coveredCellCount: trace.coveredCellCount,
    gapCount: trace.gapCount,
  };
}

function releaseReadinessActionStatus(buildable) {
  if (
    buildable?.actionStatus === "ready" ||
    buildable?.actionStatus === "blocked"
  ) {
    return buildable.actionStatus;
  }
  return (
    buildable?.hostedHandoffChecklist?.status === "blocked" ||
    buildable?.realHostedEvidenceStatus === "unproven"
  )
    ? "blocked"
    : "ready";
}

const hostedIdentityLocalCapabilityCheckIds = Object.freeze([
  "local-core-loop-proof",
  "local-hardening-proof",
  "local-ops-artifact-bundle",
  "local-seed-demo-fixture",
  "local-identity-adapter-proof",
]);

function localCapabilityConfidenceFromReadiness(readiness) {
  const checksById = new Map(
    (readiness?.localDevelopmentSpine?.checks ?? []).map((check) => [
      check.id,
      check,
    ]),
  );
  const checks = hostedIdentityLocalCapabilityCheckIds.map((id) => {
    const check = checksById.get(id);
    return {
      id,
      label: String(check?.label ?? id),
      status: String(check?.status ?? "missing"),
      evidence: String(check?.evidence ?? ""),
      roleUrl: String(
        check?.adminRoleSurface?.detailRoleUrl ??
          check?.recovery?.roleUrl ??
          "",
      ),
      proofBoundary: String(check?.proofBoundary ?? ""),
    };
  });
  const passedCheckCount = checks.filter((check) => check.status === "passed").length;
  return {
    status:
      readiness !== null &&
      passedCheckCount === hostedIdentityLocalCapabilityCheckIds.length
        ? "passed"
        : "blocked",
    source: readiness === null ? "" : devTestGameReleaseReadinessPath,
    requiredCheckIds: hostedIdentityLocalCapabilityCheckIds,
    checkCount: hostedIdentityLocalCapabilityCheckIds.length,
    passedCheckCount,
    checks,
    proofBoundary:
      "Local capability-model confidence is derived from the current release-readiness checklist. It requires passed core-loop, hardening, local ops, seed/demo fixture, and local identity-adapter rows before hosted identity can move out of sequencing deferral; it does not prove hosted accounts, sessions, invites, release readiness, or production readiness.",
  };
}

function hostedIdentitySequenceDeferralFor(
  selectedUnproven,
  { sequenceStage, localCapabilityConfidence },
) {
  if (selectedUnproven?.item?.id !== "hosted-production-identity") {
    return null;
  }
  if (sequenceStage === devTestGameHostedIdentitySequenceStage) {
    return null;
  }
  const readyForHostedIdentity =
    localCapabilityConfidence?.status === "passed";
  return {
    status: "blocked",
    currentSequenceStage: sequenceStage,
    requiredSequenceStage: devTestGameHostedIdentitySequenceStage,
    deferredUnprovenId: selectedUnproven.item.id,
    deferredCommand: selectedUnproven.command,
    deferredProofTarget: selectedUnproven.proofTarget,
    deferredRoleUrl: selectedUnproven.roleUrl,
    nextLocalCommand: readyForHostedIdentity
      ? devTestGameHostedIdentitySequencePromotionCommand
      : devTestGameLiveProofCommand,
    nextLocalProofTarget: readyForHostedIdentity
      ? devTestGameNextActionPath
      : devTestGameProofRunPath,
    roleUrl: selectedUnproven.spineTarget?.roleUrl ?? "",
    sequenceTransition: {
      status: readyForHostedIdentity ? "ready" : "blocked",
      promotionCommand: devTestGameHostedIdentitySequencePromotionCommand,
      promotedSequenceStage: devTestGameHostedIdentitySequenceStage,
    },
    buildSlice: readyForHostedIdentity
      ? "Local seeded capability confidence is passed; promote the next-action generator to the hosted-identity sequence stage before replacing dev tokens with hosted accounts, sessions, and invites."
      : "Keep hosted production identity deferred while the local seeded capability model remains the active architecture sequence; refresh the core-live role proof before replacing dev tokens with hosted accounts, sessions, and invites.",
    requiredBeforeHostedIdentity:
      "The local core gameplay, hardening, and local ops proof spine should remain the trusted development surface before production identity replaces dev tokens.",
    localCapabilityConfidence,
    proofBoundary:
      "Sequencing hold only. This records that hosted production identity is a real release-readiness blocker, but not the next local-development command; it does not prove hosted account lifecycle, invite delivery, release readiness, or production readiness.",
  };
}

function assertHostedIdentitySequenceDeferral(deferral) {
  if (
    deferral === null ||
    typeof deferral !== "object" ||
    deferral.status !== "blocked" ||
    typeof deferral.currentSequenceStage !== "string" ||
    deferral.currentSequenceStage.length === 0 ||
    deferral.requiredSequenceStage !== devTestGameHostedIdentitySequenceStage ||
    deferral.deferredUnprovenId !== "hosted-production-identity" ||
    typeof deferral.deferredCommand !== "string" ||
    !deferral.deferredCommand.startsWith("npm run ") ||
    typeof deferral.deferredProofTarget !== "string" ||
    deferral.deferredProofTarget.length === 0 ||
    typeof deferral.deferredRoleUrl !== "string" ||
    !deferral.deferredRoleUrl.includes("?game=<seeded-game>") ||
    ![devTestGameLiveProofCommand, devTestGameHostedIdentitySequencePromotionCommand]
      .includes(deferral.nextLocalCommand) ||
    ![devTestGameNextActionPath, devTestGameProofRunPath].includes(
      deferral.nextLocalProofTarget,
    ) ||
    typeof deferral.roleUrl !== "string" ||
    deferral.roleUrl.length === 0 ||
    !validHostedIdentitySequenceTransition(deferral.sequenceTransition) ||
    typeof deferral.buildSlice !== "string" ||
    deferral.buildSlice.length === 0 ||
    typeof deferral.requiredBeforeHostedIdentity !== "string" ||
    deferral.requiredBeforeHostedIdentity.length === 0 ||
    !validHostedIdentityLocalCapabilityConfidence(
      deferral.localCapabilityConfidence,
    ) ||
    typeof deferral.proofBoundary !== "string" ||
    deferral.proofBoundary.length === 0
  ) {
    throw new Error("next-action hosted identity sequence deferral is malformed");
  }
  if (
    deferral.localCapabilityConfidence.status === "passed" &&
    (deferral.nextLocalCommand !==
      devTestGameHostedIdentitySequencePromotionCommand ||
      deferral.nextLocalProofTarget !== devTestGameNextActionPath ||
      deferral.sequenceTransition.status !== "ready")
  ) {
    throw new Error(
      "next-action hosted identity deferral must expose the stage promotion command",
    );
  }
  if (
    deferral.localCapabilityConfidence.status !== "passed" &&
    (deferral.nextLocalCommand !== devTestGameLiveProofCommand ||
      deferral.nextLocalProofTarget !== devTestGameProofRunPath ||
      deferral.sequenceTransition.status !== "blocked")
  ) {
    throw new Error(
      "next-action hosted identity deferral must refresh local proof while confidence is blocked",
    );
  }
}

function validHostedIdentitySequenceTransition(transition) {
  return (
    transition !== null &&
    typeof transition === "object" &&
    ["ready", "blocked"].includes(transition.status) &&
    transition.promotionCommand ===
      devTestGameHostedIdentitySequencePromotionCommand &&
    transition.promotedSequenceStage === devTestGameHostedIdentitySequenceStage
  );
}

function validHostedIdentityLocalCapabilityConfidence(confidence) {
  return (
    confidence !== null &&
    typeof confidence === "object" &&
    ["passed", "blocked"].includes(confidence.status) &&
    typeof confidence.source === "string" &&
    Array.isArray(confidence.requiredCheckIds) &&
    JSON.stringify(confidence.requiredCheckIds) ===
      JSON.stringify(hostedIdentityLocalCapabilityCheckIds) &&
    confidence.checkCount === hostedIdentityLocalCapabilityCheckIds.length &&
    Number.isInteger(confidence.passedCheckCount) &&
    confidence.passedCheckCount >= 0 &&
    confidence.passedCheckCount <= confidence.checkCount &&
    Array.isArray(confidence.checks) &&
    confidence.checks.length === confidence.checkCount &&
    confidence.checks.every(
      (check, index) =>
        check.id === hostedIdentityLocalCapabilityCheckIds[index] &&
        typeof check.label === "string" &&
        check.label.length > 0 &&
        typeof check.status === "string" &&
        typeof check.evidence === "string" &&
        typeof check.roleUrl === "string" &&
        typeof check.proofBoundary === "string",
    ) &&
    typeof confidence.proofBoundary === "string" &&
    confidence.proofBoundary.length > 0
  );
}

function validHostedHandoffChecklist(checklist) {
  return (
    checklist !== null &&
    typeof checklist === "object" &&
    checklist.status === "blocked" &&
    checklist.preflightStatus === "blocked" &&
    typeof checklist.command === "string" &&
    checklist.command.startsWith("npm run test:") &&
    typeof checklist.proofTarget === "string" &&
    checklist.proofTarget.trim() !== "" &&
    Array.isArray(checklist.inputIds) &&
    checklist.inputIds.length > 0 &&
    Array.isArray(checklist.blockedCheckIds) &&
    checklist.blockedCheckIds.length > 0 &&
    Array.isArray(checklist.blockedChecks) &&
    checklist.blockedChecks.length === checklist.blockedCheckIds.length &&
    checklist.blockedChecks.every(
      (check) =>
        checklist.blockedCheckIds.includes(check.id) &&
        check.status === "blocked" &&
        typeof check.requiredEvidence === "string",
    ) &&
    (checklist.progressionSummary === undefined ||
      validHostedIdentityProgressionSummary(checklist.progressionSummary))
  );
}

function validHostedIdentityProgressionSummary(summary) {
  return (
    summary !== null &&
    typeof summary === "object" &&
    summary.status === "passed" &&
    typeof summary.command === "string" &&
    summary.command.startsWith("npm run test:") &&
    typeof summary.proofTarget === "string" &&
    summary.proofTarget.trim() !== "" &&
    Number.isInteger(summary.progressionCount) &&
    summary.progressionCount > 0 &&
    Array.isArray(summary.progressionIds) &&
    summary.progressionIds.length === summary.progressionCount &&
    Array.isArray(summary.progressionProofTargets) &&
    summary.progressionProofTargets.length === summary.progressionCount &&
    Array.isArray(summary.progressions) &&
    summary.progressions.length === summary.progressionCount &&
    summary.progressions.every(
      (progression, index) =>
        progression.id === summary.progressionIds[index] &&
        progression.adminProofTarget === summary.progressionProofTargets[index] &&
        typeof progression.proofCommand === "string" &&
        progression.proofCommand.includes("npm run test:") &&
        typeof progression.adminProofMode === "string" &&
        progression.adminProofMode !== "" &&
        typeof progression.adminProofFixturePath === "string" &&
        progression.adminProofFixturePath !== "" &&
        typeof progression.evidencePath === "string" &&
        progression.evidencePath.trim() !== "" &&
        typeof progression.roleUrl === "string" &&
        progression.roleUrl.includes("?game=<seeded-game>") &&
        typeof progression.firstMissingInputId === "string" &&
        progression.firstMissingInputId !== "" &&
        typeof progression.firstMissingCheckId === "string" &&
        progression.firstMissingCheckId !== "" &&
        typeof progression.proofBoundary === "string" &&
        progression.proofBoundary !== "",
    )
  );
}

function validHostedIdentityProgressionSelection(progression, checklist) {
  if (!validHostedIdentityProgressionSummaryRow(progression)) {
    return false;
  }
  const expected = checklist?.progressionSummary?.progressions?.find(
    (candidate) => candidate.id === progression.id,
  );
  return (
    validHostedIdentityProgressionSummaryRow(expected) &&
    progression.proofCommand === expected.proofCommand &&
    progression.evidencePath === expected.evidencePath &&
    progression.adminProofTarget === expected.adminProofTarget &&
    progression.roleUrl === expected.roleUrl &&
    progression.firstMissingInputId === expected.firstMissingInputId &&
    progression.firstMissingCheckId === expected.firstMissingCheckId &&
    progression.proofBoundary === expected.proofBoundary &&
    ["missing", "stale"].includes(progression.artifactStatus)
  );
}

function validHostedIdentityProgressionSummaryRow(progression) {
  return (
    progression !== null &&
    typeof progression === "object" &&
    typeof progression.id === "string" &&
    progression.id !== "" &&
    typeof progression.checkId === "string" &&
    progression.checkId !== "" &&
    typeof progression.missingInputId === "string" &&
    progression.missingInputId !== "" &&
    typeof progression.adminProofMode === "string" &&
    progression.adminProofMode !== "" &&
    typeof progression.proofCommand === "string" &&
    progression.proofCommand.includes("npm run test:") &&
    typeof progression.evidencePath === "string" &&
    progression.evidencePath !== "" &&
    typeof progression.adminProofTarget === "string" &&
    progression.adminProofTarget !== "" &&
    typeof progression.roleUrl === "string" &&
    progression.roleUrl.includes("?game=<seeded-game>") &&
    typeof progression.firstMissingInputId === "string" &&
    progression.firstMissingInputId !== "" &&
    typeof progression.firstMissingCheckId === "string" &&
    progression.firstMissingCheckId !== "" &&
    typeof progression.proofBoundary === "string" &&
    progression.proofBoundary !== ""
  );
}

function assertRaceCoveragePromotedMilestones(summary) {
  if (
    !["passed", "gapped", "unavailable"].includes(summary?.status) ||
    !Number.isInteger(summary.cellCount) ||
    !Number.isInteger(summary.provenCellCount) ||
    !Number.isInteger(summary.reloadCoveredCellCount) ||
    !Number.isInteger(summary.groupCount) ||
    !Number.isInteger(summary.passedGroupCount) ||
    !Number.isInteger(summary.requiredCellCount) ||
    !Number.isInteger(summary.coveredCellCount) ||
    !Number.isInteger(summary.gapCount) ||
    !Array.isArray(summary.groups)
  ) {
    throw new Error("next-action race coverage promoted milestone summary is malformed");
  }
  if (
    summary.groupCount !== raceCoveragePromotedMilestoneGroupIds.length ||
    summary.groups.length !== raceCoveragePromotedMilestoneGroupIds.length ||
    summary.coveredCellCount + summary.gapCount !== summary.requiredCellCount
  ) {
    throw new Error("next-action race coverage promoted milestone summary count drifted");
  }
  for (const id of raceCoveragePromotedMilestoneGroupIds) {
    const group = summary.groups.find((candidate) => candidate.id === id);
    if (group === undefined) {
      throw new Error(`next-action race coverage promoted milestone missing group: ${id}`);
    }
    if (
      !["covered", "gapped", "unavailable"].includes(group.status) ||
      !Array.isArray(group.cellIds) ||
      !Number.isInteger(group.requiredCellCount) ||
      !Number.isInteger(group.coveredCellCount) ||
      !Number.isInteger(group.gapCount)
    ) {
      throw new Error(`next-action race coverage promoted milestone malformed group: ${id}`);
    }
  }
  if (summary.status === "passed" && summary.gapCount !== 0) {
    throw new Error("next-action race coverage promoted milestone passed with gaps");
  }
  if (summary.status === "gapped" && summary.gapCount === 0) {
    throw new Error("next-action race coverage promoted milestone gapped without gaps");
  }
}

function artifactAgeSeconds(artifact) {
  return typeof artifact.ageSeconds === "number" ? artifact.ageSeconds : 0;
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function developmentSpineArtifactPriority(artifact) {
  return (
    devSpineArtifactPriorities.get(artifact.id) ??
    devSpineArtifactPriorities.get(artifact.path) ??
    (terminalArtifactIds.has(artifact.id) || terminalArtifactPaths.has(artifact.path)
      ? terminalFallbackPriority
      : unknownSpineFallbackPriority)
  );
}

const devSpineArtifactPriorities = new Map(
  [
    ["proof-run", devTestGameProofRunPath],
    ["session", devTestGameSessionPath],
    ["core-loop", devTestGameCoreLoopAdminProofPath],
    ["hardening", devTestGameHardeningAdminProofPath],
    ["identity-adapter", devTestGameIdentityAdapterProofPath],
    ["identity", devTestGameIdentityAdminProofPath],
    ["backup-restore", devTestGameBackupRestoreProofPath],
    ["backup", devTestGameBackupAdminProofPath],
    ["ops-artifacts", devTestGameOpsArtifactsPath],
    ["ops", devTestGameOpsAdminProofPath],
    ["seed-fixture", devTestGameSeedFixturePath],
    ["seed", devTestGameSeedAdminProofPath],
    ["release-readiness", devTestGameReleaseReadinessPath],
    ["release-runbook", devTestGameReleaseRunbookPath],
    ["release-runbook-admin", devTestGameReleaseRunbookAdminProofPath],
    ["race-coverage", devTestGameRaceCoveragePath],
    ["race-coverage-admin", devTestGameRaceCoverageAdminProofPath],
    ["hosted-concurrent-race-matrix", devTestGameHostedConcurrentRaceMatrixPath],
    ["hosted-target-preflight", devTestGameHostedTargetPreflightPath],
    ["hosted-evidence-lane-demo", devTestGameHostedEvidenceLaneDemoProofPath],
    ["hosted-evidence-lane", devTestGameHostedEvidenceLanePath],
    ["release", devTestGameReleaseAdminProofPath],
    ["admin-spine", adminSpineProofPath],
    ["admin-spine-admin", devTestGameAdminSpineAdminProofPath],
    ["proof-graph", devTestGameProofGraphPath],
    ["proof-graph-admin", devTestGameProofGraphAdminProofPath],
    ["spine-manifest", spineManifestPath],
    ["spine-manifest-admin", devTestGameSpineManifestAdminProofPath],
    ...hostedAdminHandoffProofArtifactCases.map((artifactCase) => [
      artifactCase.refreshId,
      artifactCase.path,
    ]),
  ].flatMap(([id, artifactPath], index) => [
    [id, index],
    [artifactPath, index],
  ]),
);

const unknownSpineFallbackPriority = 1_000;
const terminalFallbackPriority = 10_000;
const terminalArtifactIds = new Set([
  "next-action",
  "next-action-admin-proof",
  "proof-graph",
  "proof-graph-admin",
]);
const terminalArtifactPaths = new Set([
  devTestGameNextActionPath,
  nextActionAdminProofPath,
  devTestGameProofGraphPath,
  devTestGameProofGraphAdminProofPath,
]);

const raceCoveragePromotedMilestoneGroupIds = Object.freeze(
  raceCoveragePromotedReloadGroups.map((group) => group.id),
);

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidence = await writeDevTestGameNextAction();
  console.log(
    `wrote ${process.env.FMARCH_DEV_TEST_GAME_NEXT_ACTION ?? devTestGameNextActionPath} (${evidence.nextAction.status})`,
  );
}
