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
import { assertDevTestGameOpsArtifacts } from "./dev_test_game_ops_artifacts.mjs";
import {
  assertDevTestGameRaceCoverage,
  devTestGameRaceCoveragePath,
  raceCoveragePromotedReloadGroup,
  raceCoveragePromotedReloadGroups,
} from "./dev_test_game_race_coverage.mjs";
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
  hostStaleControlLaneIds,
} from "./dev_test_game_host_stale_recovery_scenarios.mjs";
import {
  staleConflictMessageSurfaceCases,
  staleConflictMessageLaneIds,
} from "./dev_test_game_hardening_recovery_scenarios.mjs";
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
import { devTestGameProofGraphPath } from "./dev_test_game_proof_graph_paths.mjs";
import {
  assertRecoveryReceiptGraphSummary,
  recoveryReceiptGraphDescriptors,
  recoveryReceiptGraphSummaryFromProofGraph,
} from "./dev_test_game_recovery_receipt_catalog.mjs";

export {
  devTestGameCoreLoopAdminProofCommand,
  devTestGameHardeningAdminProofCommand,
  devTestGameIdentityAdminProofCommand,
} from "./dev_test_game_production_feature_source_rules.mjs";

export const DEV_TEST_GAME_NEXT_ACTION_VERSION = 1;
export const devTestGameNextActionPath = "target/dev-test-game/next-action.json";
export const devTestGameReleaseReadinessPath =
  "target/dev-test-game/release-readiness-checklist.json";
export const devTestGameOpsArtifactsPath = "target/dev-test-game/ops-artifacts.json";
export const devTestGameLiveProofCommand =
  devTestGameProductionFeatureBrowserProofCommand;
export const devTestGameSeedFixtureCommand =
  "npm run test:dev-test-game-seed-fixture";
export const devTestGameSeedFixturePath =
  "target/dev-test-game/seed-fixture-summary.json";
export const devTestGameSeedFixtureRoleUrl =
  "/admin/audit/local-seed-fixtures?game=<seeded-game>";

const nextActionJsonPath = path.join(repoRoot, devTestGameNextActionPath);

export function buildDevTestGameNextAction(
  spineManifest,
  {
    generatedAt = new Date().toISOString(),
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
    seedProofLaneCoverageDriftFromReadiness(readiness);
  const seedProofLaneCoverageTrace = buildSeedProofLaneCoverageTrace(
    seedProofLaneCoverageDrift,
  );
  const releaseReadinessCandidates = rankedBuildableReleaseReadinessItems(readiness, {
    hostedTargetPreflight: hostedPreflight,
    sourceTargetsByCheckId,
    proofGraph: graph,
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
              proofTarget: "target/dev-test-game/session.json",
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
            ...(terminalBatchGraph === null
              ? {}
              : { terminalBatchGraph }),
            ...recoveryReceiptGraphs,
          }),
    },
    nextAction,
    selectionTrace,
    stabilityTrace,
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
    typeof evidence.nextAction.artifact?.id !== "string"
  ) {
    throw new Error("next-action artifact recovery is missing an artifact id");
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
  }
  if (
    evidence.nextAction.reason === "harness-stability-drift" &&
    typeof evidence.nextAction.stability?.source !== "string"
  ) {
    throw new Error("next-action harness-stability recovery is missing stability evidence");
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
  assertSelectionTrace(evidence.selectionTrace, evidence.nextAction);
  assertProofStabilityTrace(evidence.stabilityTrace, evidence.nextAction);
  assertSeedProofLaneCoverageTrace(
    evidence.seedProofLaneCoverageTrace,
    evidence.nextAction,
  );
  assertLocalReadinessDependencyTrace(
    evidence.localReadinessDependencyTrace,
    evidence.nextAction,
  );
  assertReleaseReadinessTrace(evidence.releaseReadinessTrace, evidence.nextAction);
  assertReplacementRaceReloadTrace(evidence.replacementRaceReloadTrace);
  assertHostConcurrentRaceReloadTrace(evidence.hostConcurrentRaceReloadTrace);
  assertPlayerConcurrentActionReloadTrace(evidence.playerConcurrentActionReloadTrace);
  assertCohostDeadlineRaceReloadTrace(evidence.cohostDeadlineRaceReloadTrace);
  assertRaceCoveragePromotedMilestones(evidence.raceCoveragePromotedMilestones);
  assertStaleConflictMessageTrace(evidence.staleConflictMessageTrace);
  assertHostStaleControlTrace(evidence.hostStaleControlTrace);
  assertTerminalBatchGraph(evidence.generatedFrom?.terminalBatchGraph);
  assertRecoveryReceiptGraphsForNextAction(evidence.generatedFrom);
  return evidence;
}

export async function writeDevTestGameNextAction({
  generatedAt = new Date().toISOString(),
  manifestPath = process.env.FMARCH_DEV_TEST_GAME_SPINE_MANIFEST ?? spineManifestPath,
} = {}) {
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

function buildSelectionTrace(candidates) {
  const selectedArtifactId = candidates[0]?.artifact.id ?? null;
  return {
    strategy: "development-spine-priority",
    candidateCount: candidates.length,
    selectedArtifactId,
    candidates: candidates.map(({ artifact, priority }, index) => ({
      rank: index + 1,
      id: artifact.id,
      label: artifact.label,
      path: artifact.path,
      status: artifact.status,
      priority,
      selected: artifact.id === selectedArtifactId,
      refreshCommand: artifact.nextCommand ?? artifact.refreshCommand,
      refreshSource: artifact.refreshSource,
      ...(artifact.ageSeconds === undefined ? {} : { ageSeconds: artifact.ageSeconds }),
      ...(artifact.maxAgeSeconds === undefined
        ? {}
        : { maxAgeSeconds: artifact.maxAgeSeconds }),
    })),
  };
}

function rankedBuildableReleaseReadinessItems(
  readiness,
  {
    hostedTargetPreflight = null,
    sourceTargetsByCheckId = {},
    proofGraph = null,
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
      const spineTarget = resolveProductionFeatureSpineTarget({
        itemId: item.id,
        declaration: buildable.productionFeatureSpineTarget,
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
        priority: buildable.priority,
        command: buildable.command,
        buildSlice: buildable.buildSlice,
        proofTarget: buildable.proofTarget,
        roleUrl: buildable.roleUrl,
        proofGraphNodeId: buildable.proofGraphNodeId,
        proofBoundary: buildable.proofBoundary,
        productionFeatureSpineTarget: buildable.productionFeatureSpineTarget,
        spineTarget,
        spineDrilldown: buildProductionFeatureSpineDrilldown(spineTarget),
        selectedProductionFeatureGraph,
        hostedEvidenceMode: buildable.hostedEvidenceMode,
        realHostedEvidenceStatus: buildable.realHostedEvidenceStatus,
        realHostedEvidenceInputs: buildable.realHostedEvidenceInputs,
        hostedHandoffChecklist: buildable.hostedHandoffChecklist,
        actionStatus: releaseReadinessActionStatus(buildable),
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
    edgeCount: edges.length,
    edgeTargets: edges.map((edge) => String(edge.to ?? "")),
  };
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
      "target/dev-test-game/admin-spine-terminal-batches.json" ||
    terminalBatchGraph.roleUrl !==
      "/admin/audit/local-admin-spine?game=<seeded-game>" ||
    !Number.isInteger(terminalBatchGraph.batchCount) ||
    terminalBatchGraph.batchCount < 1 ||
    terminalBatchGraph.edgeCount !== 3 ||
    JSON.stringify(terminalBatchGraph.edgeTargets) !==
      JSON.stringify(["proof-graph", "proof-freshness", "next-action"])
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

function selectedProductionFeatureGraphForTarget({ proofGraph, spineTarget }) {
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
    edge.from !== productionFeatureGraphSourceNodeId(spineTarget.sourceCheckId) ||
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
    graphSelection.proofTarget.length > 0
  );
}

function buildLocalReadinessDependencyTrace(candidates) {
  const selectedCheckId = candidates[0]?.id ?? null;
  return {
    strategy: "local-readiness-dependency-before-hosted-work",
    candidateCount: candidates.length,
    selectedCheckId,
    candidates: candidates.map((candidate, index) => ({
      rank: index + 1,
      id: candidate.id,
      status: candidate.status,
      priority: candidate.priority,
      selected: candidate.id === selectedCheckId,
      command: candidate.command,
      buildSlice: candidate.buildSlice,
      proofTarget: candidate.proofTarget,
      roleUrl: candidate.roleUrl,
      proofBoundary: candidate.proofBoundary,
      requiredEvidence: candidate.requiredEvidence,
    })),
  };
}

function buildReleaseReadinessTrace(candidates) {
  const selectedUnprovenId = candidates[0]?.item.id ?? null;
  return {
    strategy: "local-dev-release-readiness-priority",
    candidateCount: candidates.length,
    selectedUnprovenId,
    candidates: candidates.map((candidate, index) => ({
      rank: index + 1,
      id: candidate.item.id,
      status: candidate.item.status,
      priority: candidate.priority,
      selected: candidate.item.id === selectedUnprovenId,
      command: candidate.command,
      buildSlice: candidate.buildSlice,
      proofTarget: candidate.proofTarget,
      roleUrl: candidate.roleUrl,
      proofGraphNodeId: candidate.proofGraphNodeId,
      proofBoundary: candidate.proofBoundary,
      actionStatus: candidate.actionStatus,
      requiredEvidence: candidate.item.requiredEvidence,
      productionFeatureSpineTarget: candidate.productionFeatureSpineTarget,
      spineDrilldown: candidate.spineDrilldown,
      ...(candidate.spineTarget == null ? {} : { spineTarget: candidate.spineTarget }),
      ...(candidate.selectedProductionFeatureGraph == null
        ? {}
        : {
            selectedProductionFeatureGraph:
              candidate.selectedProductionFeatureGraph,
          }),
      ...(candidate.hostedEvidenceMode === undefined
        ? {}
        : { hostedEvidenceMode: candidate.hostedEvidenceMode }),
      ...(candidate.realHostedEvidenceStatus === undefined
        ? {}
        : { realHostedEvidenceStatus: candidate.realHostedEvidenceStatus }),
      ...(candidate.realHostedEvidenceInputs === undefined
        ? {}
        : { realHostedEvidenceInputs: candidate.realHostedEvidenceInputs }),
      ...(candidate.hostedHandoffChecklist === undefined
        ? {}
        : { hostedHandoffChecklist: candidate.hostedHandoffChecklist }),
    })),
  };
}

function seedProofLaneCoverageDriftFromReadiness(readiness) {
  const seedCheck = readiness?.localDevelopmentSpine?.checks?.find?.(
    (check) => check?.id === "local-seed-demo-fixture",
  );
  const coverage = seedCheck?.proofLaneCoverage;
  const unclassifiedLaneIds = Array.isArray(coverage?.unclassified?.laneIds)
    ? coverage.unclassified.laneIds.map((laneId) => String(laneId))
    : [];
  const unclassifiedLaneCount = numberOrZero(
    coverage?.unclassified?.count ?? unclassifiedLaneIds.length,
  );
  return {
    strategy: "seed-proof-lane-coverage-before-readiness",
    status:
      readiness === null || coverage === null || typeof coverage !== "object"
        ? "unavailable"
        : unclassifiedLaneCount > 0
          ? "drifted"
          : "clean",
    source: readiness === null ? "" : devTestGameReleaseReadinessPath,
    checkId: seedCheck?.id ?? null,
    passedLaneCount: numberOrZero(coverage?.passedLaneCount),
    directSeededLaneCount: numberOrZero(coverage?.directSeeded?.count),
    aliasOnlyLaneCount: numberOrZero(coverage?.aliasOnly?.count),
    aggregateOnlyLaneCount: numberOrZero(coverage?.aggregateOnly?.count),
    unclassifiedLaneCount,
    unclassifiedLaneIds,
  };
}

function buildSeedProofLaneCoverageTrace(seedProofLaneCoverageDrift) {
  return {
    strategy: seedProofLaneCoverageDrift.strategy,
    status: seedProofLaneCoverageDrift.status,
    source: seedProofLaneCoverageDrift.source,
    checkId: seedProofLaneCoverageDrift.checkId,
    passedLaneCount: seedProofLaneCoverageDrift.passedLaneCount,
    directSeededLaneCount: seedProofLaneCoverageDrift.directSeededLaneCount,
    aliasOnlyLaneCount: seedProofLaneCoverageDrift.aliasOnlyLaneCount,
    aggregateOnlyLaneCount: seedProofLaneCoverageDrift.aggregateOnlyLaneCount,
    unclassifiedLaneCount:
      seedProofLaneCoverageDrift.unclassifiedLaneCount,
    unclassifiedLaneIds: seedProofLaneCoverageDrift.unclassifiedLaneIds,
    selected: seedProofLaneCoverageDrift.status === "drifted",
  };
}

function proofStabilityDriftFromOpsArtifacts(ops) {
  const hostConfirmClicks = ops?.proofStability?.hostConfirmClicks ?? {};
  const retryClickCount = numberOrZero(hostConfirmClicks.retryClickCount);
  const domFallbackCount = numberOrZero(hostConfirmClicks.domFallbackCount);
  const forceFallbackCount = numberOrZero(hostConfirmClicks.forceFallbackCount);
  const failureCount = numberOrZero(hostConfirmClicks.failureCount);
  const events = Array.isArray(hostConfirmClicks.events) ? hostConfirmClicks.events : [];
  return {
    status:
      retryClickCount + domFallbackCount + forceFallbackCount + failureCount > 0
        ? "drifted"
        : "clean",
    hostConfirmClicks: numberOrZero(hostConfirmClicks.total),
    retryClickCount,
    domFallbackCount,
    forceFallbackCount,
    failureCount,
    maxAttempts: numberOrZero(hostConfirmClicks.maxAttempts),
    events: events.map((event) => ({
      actionId: String(event.actionId ?? "unknown"),
      roleLabel: String(event.roleLabel ?? "unknown"),
      method: String(event.method ?? "unknown"),
      attempts: numberOrZero(event.attempts),
    })),
  };
}

function buildProofStabilityTrace(stabilityDrift) {
  return {
    strategy: "proof-stability-before-readiness",
    status: stabilityDrift.status,
    hostConfirmClicks: stabilityDrift.hostConfirmClicks,
    retryClickCount: stabilityDrift.retryClickCount,
    domFallbackCount: stabilityDrift.domFallbackCount,
    forceFallbackCount: stabilityDrift.forceFallbackCount,
    failureCount: stabilityDrift.failureCount,
    maxAttempts: stabilityDrift.maxAttempts,
    eventCount: stabilityDrift.events.length,
    selected: stabilityDrift.status === "drifted",
  };
}

function buildReplacementRaceReloadTrace(
  raceCoverage,
  { source = devTestGameRaceCoveragePath } = {},
) {
  const cells = replacementRaceReloadCellIds.map((id) => {
    const cell = raceCoverage?.cells?.find?.((candidate) => candidate.id === id);
    const reloadLaneId =
      typeof cell?.reloadLaneId === "string" ? cell.reloadLaneId : null;
    const reloadStatus = String(cell?.reloadStatus ?? "missing");
    const covered =
      cell?.status === "passed" && reloadLaneId !== null && reloadStatus === "passed";
    return {
      id,
      raceLaneId: String(cell?.raceLaneId ?? ""),
      reloadLaneId,
      reloadStatus,
      covered,
    };
  });
  const coveredCellCount = cells.filter((cell) => cell.covered).length;
  const gapCount = cells.length - coveredCellCount;
  return {
    strategy: "replacement-race-reload-before-readiness",
    status: raceCoverage === null ? "unavailable" : gapCount === 0 ? "covered" : "gapped",
    source: raceCoverage === null ? "" : source,
    requiredCellCount: cells.length,
    coveredCellCount,
    gapCount,
    cells,
  };
}

function buildHostConcurrentRaceReloadTrace(
  raceCoverage,
  { source = devTestGameRaceCoveragePath } = {},
) {
  const cells = hostConcurrentRaceReloadCellIds.map((id) => {
    const cell = raceCoverage?.cells?.find?.((candidate) => candidate.id === id);
    const reloadLaneId =
      typeof cell?.reloadLaneId === "string" ? cell.reloadLaneId : null;
    const reloadStatus = String(cell?.reloadStatus ?? "missing");
    const covered =
      cell?.status === "passed" && reloadLaneId !== null && reloadStatus === "passed";
    return {
      id,
      raceLaneId: String(cell?.raceLaneId ?? ""),
      reloadLaneId,
      reloadStatus,
      covered,
    };
  });
  const coveredCellCount = cells.filter((cell) => cell.covered).length;
  const gapCount = cells.length - coveredCellCount;
  return {
    strategy: "host-concurrent-race-reload-before-readiness",
    status: raceCoverage === null ? "unavailable" : gapCount === 0 ? "covered" : "gapped",
    source: raceCoverage === null ? "" : source,
    requiredCellCount: cells.length,
    coveredCellCount,
    gapCount,
    cells,
  };
}

function buildPlayerConcurrentActionReloadTrace(
  raceCoverage,
  { source = devTestGameRaceCoveragePath } = {},
) {
  const cells = playerConcurrentActionReloadCellIds.map((id) => {
    const cell = raceCoverage?.cells?.find?.((candidate) => candidate.id === id);
    const reloadLaneId =
      typeof cell?.reloadLaneId === "string" ? cell.reloadLaneId : null;
    const reloadStatus = String(cell?.reloadStatus ?? "missing");
    const covered =
      cell?.status === "passed" && reloadLaneId !== null && reloadStatus === "passed";
    return {
      id,
      raceLaneId: String(cell?.raceLaneId ?? ""),
      reloadLaneId,
      reloadStatus,
      covered,
    };
  });
  const coveredCellCount = cells.filter((cell) => cell.covered).length;
  const gapCount = cells.length - coveredCellCount;
  return {
    strategy: "player-concurrent-action-reload-before-readiness",
    status: raceCoverage === null ? "unavailable" : gapCount === 0 ? "covered" : "gapped",
    source: raceCoverage === null ? "" : source,
    requiredCellCount: cells.length,
    coveredCellCount,
    gapCount,
    cells,
  };
}

function buildCohostDeadlineRaceReloadTrace(
  raceCoverage,
  { source = devTestGameRaceCoveragePath } = {},
) {
  const cells = cohostDeadlineRaceReloadCellIds.map((id) => {
    const cell = raceCoverage?.cells?.find?.((candidate) => candidate.id === id);
    const reloadLaneId =
      typeof cell?.reloadLaneId === "string" ? cell.reloadLaneId : null;
    const reloadStatus = String(cell?.reloadStatus ?? "missing");
    const covered =
      cell?.status === "passed" && reloadLaneId !== null && reloadStatus === "passed";
    return {
      id,
      raceLaneId: String(cell?.raceLaneId ?? ""),
      reloadLaneId,
      reloadStatus,
      covered,
    };
  });
  const coveredCellCount = cells.filter((cell) => cell.covered).length;
  const gapCount = cells.length - coveredCellCount;
  return {
    strategy: "cohost-deadline-race-reload-before-readiness",
    status: raceCoverage === null ? "unavailable" : gapCount === 0 ? "covered" : "gapped",
    source: raceCoverage === null ? "" : source,
    requiredCellCount: cells.length,
    coveredCellCount,
    gapCount,
    cells,
  };
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

function buildStaleConflictMessageTrace(readiness) {
  const milestone =
    readiness?.generatedFrom?.staleConflictMessageMilestone ??
    readiness?.localDevelopmentSpine?.evidence?.staleConflictMessageMilestone ??
    null;
  const check = readiness?.localDevelopmentSpine?.checks?.find?.(
    (candidate) => candidate.id === "local-stale-conflict-message-milestone",
  );
  const laneIds = Array.isArray(milestone?.laneIds)
    ? milestone.laneIds.map((laneId) => String(laneId))
    : staleConflictMessageLaneIds.map((laneId) => String(laneId));
  const surfaces = Array.isArray(milestone?.surfaces)
    ? milestone.surfaces.map((surface) => ({
        id: String(surface.id ?? ""),
        checkId: String(surface.checkId ?? ""),
        label: String(surface.label ?? surface.id ?? ""),
        status: String(surface.status ?? "unknown"),
        laneId: String(surface.laneId ?? ""),
        roleUrl: String(surface.roleUrl ?? ""),
        rejectError: String(surface.rejectError ?? ""),
        rejectMessage: String(surface.rejectMessage ?? ""),
        receiptStatusText: String(surface.receiptStatusText ?? ""),
        proofBoundary: String(surface.proofBoundary ?? ""),
      }))
    : [];
  const surfaceCoverage = normalizeStaleConflictMessageSurfaceCoverage({
    coverage: milestone?.surfaceCoverage,
    readiness,
    laneIds,
    surfaces,
  });
  const requiredLaneCount = Number(
    milestone?.requiredLaneCount ?? check?.requiredLaneCount ?? laneIds.length,
  );
  const coveredLaneCount = Number(
    milestone?.coveredLaneCount ?? check?.coveredLaneCount ?? 0,
  );
  const gapCount = Number(
    milestone?.gapCount ?? Math.max(requiredLaneCount - coveredLaneCount, 0),
  );
  return {
    strategy: "stale-conflict-message-before-readiness",
    status:
      readiness === null
        ? "unavailable"
        : check?.status === "passed" && gapCount === 0
          ? "covered"
          : "gapped",
    source: readiness === null ? "" : devTestGameReleaseReadinessPath,
    requiredLaneCount,
    coveredLaneCount,
    gapCount,
    laneIds,
    surfaceCoverage,
    surfaces,
  };
}

function normalizeStaleConflictMessageSurfaceCoverage({
  coverage,
  readiness,
  laneIds,
  surfaces,
}) {
  if (readiness === null) {
    return {
      status: "unavailable",
      requiredSurfaceCount: laneIds.length,
      coveredSurfaceCount: 0,
      gapCount: laneIds.length,
    };
  }
  const requiredSurfaceCount = Number(
    coverage?.requiredSurfaceCount ?? laneIds.length,
  );
  const coveredSurfaceCount = Number(
    coverage?.coveredSurfaceCount ??
      surfaces.filter((surface) => surface.status === "passed").length,
  );
  const gapCount = Number(
    coverage?.gapCount ?? Math.max(requiredSurfaceCount - coveredSurfaceCount, 0),
  );
  return {
    status:
      coverage?.status === "complete" && gapCount === 0
        ? "complete"
        : gapCount === 0
          ? "complete"
          : "gapped",
    requiredSurfaceCount,
    coveredSurfaceCount,
    gapCount,
  };
}

function buildHostStaleControlTrace(readiness) {
  const milestone =
    readiness?.generatedFrom?.hostStaleControlMilestone ??
    readiness?.localDevelopmentSpine?.evidence?.hostStaleControlMilestone ??
    null;
  const check = readiness?.localDevelopmentSpine?.checks?.find?.(
    (candidate) => candidate.id === "local-host-stale-control-milestone",
  );
  const laneIds = Array.isArray(milestone?.laneIds)
    ? milestone.laneIds.map((laneId) => String(laneId))
    : hostStaleControlLaneIds.map((laneId) => String(laneId));
  const requiredLaneCount = Number(
    milestone?.requiredLaneCount ?? check?.requiredLaneCount ?? laneIds.length,
  );
  const coveredLaneCount = Number(
    milestone?.coveredLaneCount ?? check?.coveredLaneCount ?? 0,
  );
  const gapCount = Number(
    milestone?.gapCount ?? Math.max(requiredLaneCount - coveredLaneCount, 0),
  );
  return {
    strategy: "host-stale-control-before-readiness",
    status:
      readiness === null
        ? "unavailable"
        : check?.status === "passed" && gapCount === 0
          ? "covered"
          : "gapped",
    source: readiness === null ? "" : devTestGameReleaseReadinessPath,
    requiredLaneCount,
    coveredLaneCount,
    gapCount,
    laneIds,
  };
}

function assertSelectionTrace(selectionTrace, nextAction) {
  if (
    selectionTrace?.strategy !== "development-spine-priority" ||
    !Number.isInteger(selectionTrace.candidateCount) ||
    !Array.isArray(selectionTrace.candidates)
  ) {
    throw new Error("next-action selection trace is missing or malformed");
  }
  if (selectionTrace.candidateCount !== selectionTrace.candidates.length) {
    throw new Error("next-action selection trace candidate count drifted");
  }
  if (selectionTrace.candidateCount === 0) {
    if (
      selectionTrace.selectedArtifactId !== null ||
      nextAction.reason === "artifact-not-fresh"
    ) {
      throw new Error("next-action fresh trace has a selected artifact");
    }
    return;
  }
  const [selected, ...rest] = selectionTrace.candidates;
  if (
    nextAction.reason !== "artifact-not-fresh" ||
    selected.selected !== true ||
    selected.id !== selectionTrace.selectedArtifactId ||
    nextAction.artifact?.id !== selected.id
  ) {
    throw new Error("next-action selection trace does not match selected artifact");
  }
  for (const candidate of rest) {
    if (candidate.selected === true) {
      throw new Error(`next-action selection trace has duplicate selection: ${candidate.id}`);
    }
  }
}

function assertReleaseReadinessTrace(releaseReadinessTrace, nextAction) {
  if (
    releaseReadinessTrace?.strategy !== "local-dev-release-readiness-priority" ||
    !Number.isInteger(releaseReadinessTrace.candidateCount) ||
    !Array.isArray(releaseReadinessTrace.candidates)
  ) {
    throw new Error("next-action release-readiness trace is missing or malformed");
  }
  if (releaseReadinessTrace.candidateCount !== releaseReadinessTrace.candidates.length) {
    throw new Error("next-action release-readiness trace candidate count drifted");
  }
  if (releaseReadinessTrace.candidateCount === 0) {
    if (
      releaseReadinessTrace.selectedUnprovenId !== null ||
      nextAction.reason === "release-readiness-unproven"
    ) {
      throw new Error("next-action release-readiness trace has no selected item");
    }
    return;
  }
  const [selected, ...rest] = releaseReadinessTrace.candidates;
  if (
    selected.selected !== true ||
    selected.id !== releaseReadinessTrace.selectedUnprovenId
  ) {
    throw new Error("next-action release-readiness trace does not match selection");
  }
  if (nextAction.reason === "release-readiness-unproven") {
    if (
      nextAction.unproven?.id !== selected.id ||
      nextAction.command !== selected.command ||
      nextAction.unproven?.roleUrl !== selected.roleUrl ||
      nextAction.unproven?.proofGraphNodeId !== selected.proofGraphNodeId ||
      nextAction.status !== selected.actionStatus ||
      JSON.stringify(nextAction.unproven?.productionFeatureSpineTarget ?? null) !==
        JSON.stringify(selected.productionFeatureSpineTarget ?? null) ||
      JSON.stringify(nextAction.unproven?.spineDrilldown ?? null) !==
        JSON.stringify(selected.spineDrilldown ?? null) ||
      JSON.stringify(nextAction.unproven?.spineTarget ?? null) !==
        JSON.stringify(selected.spineTarget ?? null) ||
      JSON.stringify(nextAction.unproven?.selectedProductionFeatureGraph ?? null) !==
        JSON.stringify(selected.selectedProductionFeatureGraph ?? null) ||
      JSON.stringify(nextAction.unproven?.hostedHandoffChecklist ?? null) !==
        JSON.stringify(selected.hostedHandoffChecklist ?? null)
    ) {
      throw new Error("next-action release-readiness selection does not match action");
    }
  }
  for (const candidate of rest) {
    if (candidate.selected === true) {
      throw new Error(
        `next-action release-readiness trace has duplicate selection: ${candidate.id}`,
      );
    }
  }
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
  { localCapabilityConfidence },
) {
  if (selectedUnproven?.item?.id !== "hosted-production-identity") {
    return null;
  }
  return {
    status: "blocked",
    currentSequenceStage: "local-capability-model",
    deferredUnprovenId: selectedUnproven.item.id,
    deferredCommand: selectedUnproven.command,
    deferredProofTarget: selectedUnproven.proofTarget,
    deferredRoleUrl: selectedUnproven.roleUrl,
    nextLocalCommand: devTestGameLiveProofCommand,
    nextLocalProofTarget: "target/dev-test-game/proof-run.json",
    roleUrl: selectedUnproven.spineTarget?.roleUrl ?? "",
    buildSlice:
      "Keep hosted production identity deferred while the local seeded capability model remains the active architecture sequence; refresh the core-live role proof before replacing dev tokens with hosted accounts, sessions, and invites.",
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
    deferral.currentSequenceStage !== "local-capability-model" ||
    deferral.deferredUnprovenId !== "hosted-production-identity" ||
    typeof deferral.deferredCommand !== "string" ||
    !deferral.deferredCommand.startsWith("npm run ") ||
    typeof deferral.deferredProofTarget !== "string" ||
    deferral.deferredProofTarget.length === 0 ||
    typeof deferral.deferredRoleUrl !== "string" ||
    !deferral.deferredRoleUrl.includes("?game=<seeded-game>") ||
    deferral.nextLocalCommand !== devTestGameLiveProofCommand ||
    deferral.nextLocalProofTarget !== "target/dev-test-game/proof-run.json" ||
    typeof deferral.roleUrl !== "string" ||
    deferral.roleUrl.length === 0 ||
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
    )
  );
}

function assertLocalReadinessDependencyTrace(localReadinessDependencyTrace, nextAction) {
  if (
    localReadinessDependencyTrace?.strategy !==
      "local-readiness-dependency-before-hosted-work" ||
    !Number.isInteger(localReadinessDependencyTrace.candidateCount) ||
    !Array.isArray(localReadinessDependencyTrace.candidates)
  ) {
    throw new Error("next-action local readiness dependency trace is missing or malformed");
  }
  if (
    localReadinessDependencyTrace.candidateCount !==
    localReadinessDependencyTrace.candidates.length
  ) {
    throw new Error("next-action local readiness dependency count drifted");
  }
  if (localReadinessDependencyTrace.candidateCount === 0) {
    if (
      localReadinessDependencyTrace.selectedCheckId !== null ||
      nextAction.reason === "release-readiness-local-check-missing"
    ) {
      throw new Error("next-action local readiness trace has no selected item");
    }
    return;
  }
  const [selected, ...rest] = localReadinessDependencyTrace.candidates;
  if (
    selected.selected !== true ||
    selected.id !== localReadinessDependencyTrace.selectedCheckId
  ) {
    throw new Error("next-action local readiness trace does not match selection");
  }
  if (nextAction.reason === "release-readiness-local-check-missing") {
    if (
      nextAction.localCheck?.id !== selected.id ||
      nextAction.command !== selected.command ||
      nextAction.localCheck?.roleUrl !== selected.roleUrl
    ) {
      throw new Error("next-action local readiness selection does not match action");
    }
  }
  for (const candidate of rest) {
    if (candidate.selected === true) {
      throw new Error(
        `next-action local readiness trace has duplicate selection: ${candidate.id}`,
      );
    }
  }
}

function assertProofStabilityTrace(stabilityTrace, nextAction) {
  if (
    stabilityTrace?.strategy !== "proof-stability-before-readiness" ||
    !["clean", "drifted"].includes(stabilityTrace.status) ||
    typeof stabilityTrace.selected !== "boolean"
  ) {
    throw new Error("next-action stability trace is missing or malformed");
  }
  if (
    nextAction.reason === "harness-stability-drift" &&
    (stabilityTrace.status !== "drifted" || stabilityTrace.selected !== true)
  ) {
    throw new Error("next-action stability trace does not match selected drift");
  }
  if (
    nextAction.reason !== "harness-stability-drift" &&
    stabilityTrace.selected === true
  ) {
    throw new Error("next-action stability trace selected without drift action");
  }
}

function assertSeedProofLaneCoverageTrace(seedProofLaneCoverageTrace, nextAction) {
  if (
    seedProofLaneCoverageTrace?.strategy !==
      "seed-proof-lane-coverage-before-readiness" ||
    !["clean", "drifted", "unavailable"].includes(seedProofLaneCoverageTrace.status) ||
    typeof seedProofLaneCoverageTrace.selected !== "boolean" ||
    !Number.isInteger(seedProofLaneCoverageTrace.unclassifiedLaneCount) ||
    !Array.isArray(seedProofLaneCoverageTrace.unclassifiedLaneIds)
  ) {
    throw new Error("next-action seed proof-lane coverage trace is missing or malformed");
  }
  if (
    nextAction.reason === "seed-proof-lane-coverage-drift" &&
    (seedProofLaneCoverageTrace.status !== "drifted" ||
      seedProofLaneCoverageTrace.selected !== true ||
      seedProofLaneCoverageTrace.unclassifiedLaneIds.length === 0)
  ) {
    throw new Error(
      "next-action seed proof-lane coverage trace does not match selected drift",
    );
  }
  if (
    nextAction.reason !== "seed-proof-lane-coverage-drift" &&
    seedProofLaneCoverageTrace.selected === true
  ) {
    throw new Error(
      "next-action seed proof-lane coverage trace selected without drift action",
    );
  }
  if (
    seedProofLaneCoverageTrace.unclassifiedLaneCount !==
    seedProofLaneCoverageTrace.unclassifiedLaneIds.length
  ) {
    throw new Error("next-action seed proof-lane coverage trace count drifted");
  }
}

function assertReplacementRaceReloadTrace(trace) {
  if (
    trace?.strategy !== "replacement-race-reload-before-readiness" ||
    !["covered", "gapped", "unavailable"].includes(trace.status) ||
    !Number.isInteger(trace.requiredCellCount) ||
    !Number.isInteger(trace.coveredCellCount) ||
    !Number.isInteger(trace.gapCount) ||
    !Array.isArray(trace.cells)
  ) {
    throw new Error("next-action replacement-race reload trace is missing or malformed");
  }
  if (
    trace.requiredCellCount !== replacementRaceReloadCellIds.length ||
    trace.cells.length !== replacementRaceReloadCellIds.length ||
    trace.coveredCellCount + trace.gapCount !== trace.requiredCellCount
  ) {
    throw new Error("next-action replacement-race reload trace count drifted");
  }
  for (const id of replacementRaceReloadCellIds) {
    const cell = trace.cells.find((candidate) => candidate.id === id);
    if (cell === undefined) {
      throw new Error(`next-action replacement-race reload trace missing cell: ${id}`);
    }
    if (typeof cell.covered !== "boolean") {
      throw new Error(`next-action replacement-race reload trace malformed cell: ${id}`);
    }
  }
  if (trace.status === "covered" && trace.gapCount !== 0) {
    throw new Error("next-action replacement-race reload trace covered with gaps");
  }
  if (trace.status === "gapped" && trace.gapCount === 0) {
    throw new Error("next-action replacement-race reload trace gapped without gaps");
  }
}

function assertHostConcurrentRaceReloadTrace(trace) {
  if (
    trace?.strategy !== "host-concurrent-race-reload-before-readiness" ||
    !["covered", "gapped", "unavailable"].includes(trace.status) ||
    !Number.isInteger(trace.requiredCellCount) ||
    !Number.isInteger(trace.coveredCellCount) ||
    !Number.isInteger(trace.gapCount) ||
    !Array.isArray(trace.cells)
  ) {
    throw new Error("next-action host concurrent race-reload trace is missing or malformed");
  }
  if (
    trace.requiredCellCount !== hostConcurrentRaceReloadCellIds.length ||
    trace.cells.length !== hostConcurrentRaceReloadCellIds.length ||
    trace.coveredCellCount + trace.gapCount !== trace.requiredCellCount
  ) {
    throw new Error("next-action host concurrent race-reload trace count drifted");
  }
  for (const id of hostConcurrentRaceReloadCellIds) {
    const cell = trace.cells.find((candidate) => candidate.id === id);
    if (cell === undefined) {
      throw new Error(`next-action host concurrent race-reload trace missing cell: ${id}`);
    }
    if (cell.covered === true && cell.reloadStatus !== "passed") {
      throw new Error(
        `next-action host concurrent race-reload trace covered without reload: ${id}`,
      );
    }
  }
  if (trace.status === "covered" && trace.gapCount !== 0) {
    throw new Error("next-action host concurrent race-reload trace covered with gaps");
  }
  if (trace.status === "gapped" && trace.gapCount === 0) {
    throw new Error("next-action host concurrent race-reload trace gapped without gaps");
  }
}

function assertPlayerConcurrentActionReloadTrace(trace) {
  if (
    trace?.strategy !== "player-concurrent-action-reload-before-readiness" ||
    !["covered", "gapped", "unavailable"].includes(trace.status) ||
    !Number.isInteger(trace.requiredCellCount) ||
    !Number.isInteger(trace.coveredCellCount) ||
    !Number.isInteger(trace.gapCount) ||
    !Array.isArray(trace.cells)
  ) {
    throw new Error(
      "next-action player concurrent action reload trace is missing or malformed",
    );
  }
  if (
    trace.requiredCellCount !== playerConcurrentActionReloadCellIds.length ||
    trace.cells.length !== playerConcurrentActionReloadCellIds.length ||
    trace.coveredCellCount + trace.gapCount !== trace.requiredCellCount
  ) {
    throw new Error("next-action player concurrent action reload trace count drifted");
  }
  for (const id of playerConcurrentActionReloadCellIds) {
    const cell = trace.cells.find((candidate) => candidate.id === id);
    if (cell === undefined) {
      throw new Error(
        `next-action player concurrent action reload trace missing cell: ${id}`,
      );
    }
    if (cell.covered === true && cell.reloadStatus !== "passed") {
      throw new Error(
        `next-action player concurrent action reload trace covered without reload: ${id}`,
      );
    }
  }
  if (trace.status === "covered" && trace.gapCount !== 0) {
    throw new Error("next-action player concurrent action reload trace covered with gaps");
  }
  if (trace.status === "gapped" && trace.gapCount === 0) {
    throw new Error("next-action player concurrent action reload trace gapped without gaps");
  }
}

function assertCohostDeadlineRaceReloadTrace(trace) {
  if (
    trace?.strategy !== "cohost-deadline-race-reload-before-readiness" ||
    !["covered", "gapped", "unavailable"].includes(trace.status) ||
    !Number.isInteger(trace.requiredCellCount) ||
    !Number.isInteger(trace.coveredCellCount) ||
    !Number.isInteger(trace.gapCount) ||
    !Array.isArray(trace.cells)
  ) {
    throw new Error("next-action cohost deadline race reload trace is missing or malformed");
  }
  if (
    trace.requiredCellCount !== cohostDeadlineRaceReloadCellIds.length ||
    trace.cells.length !== cohostDeadlineRaceReloadCellIds.length ||
    trace.coveredCellCount + trace.gapCount !== trace.requiredCellCount
  ) {
    throw new Error("next-action cohost deadline race reload trace count drifted");
  }
  for (const id of cohostDeadlineRaceReloadCellIds) {
    const cell = trace.cells.find((candidate) => candidate.id === id);
    if (cell === undefined) {
      throw new Error(`next-action cohost deadline race reload trace missing cell: ${id}`);
    }
    if (cell.covered === true && cell.reloadStatus !== "passed") {
      throw new Error(
        `next-action cohost deadline race reload trace covered without reload: ${id}`,
      );
    }
  }
  if (trace.status === "covered" && trace.gapCount !== 0) {
    throw new Error("next-action cohost deadline race reload trace covered with gaps");
  }
  if (trace.status === "gapped" && trace.gapCount === 0) {
    throw new Error("next-action cohost deadline race reload trace gapped without gaps");
  }
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

function assertStaleConflictMessageTrace(trace) {
  if (
    trace?.strategy !== "stale-conflict-message-before-readiness" ||
    !["covered", "gapped", "unavailable"].includes(trace.status) ||
    !Number.isInteger(trace.requiredLaneCount) ||
    !Number.isInteger(trace.coveredLaneCount) ||
    !Number.isInteger(trace.gapCount) ||
    !Array.isArray(trace.laneIds) ||
    trace.surfaceCoverage === null ||
    typeof trace.surfaceCoverage !== "object" ||
    !["complete", "gapped", "unavailable"].includes(trace.surfaceCoverage.status) ||
    !Number.isInteger(trace.surfaceCoverage.requiredSurfaceCount) ||
    !Number.isInteger(trace.surfaceCoverage.coveredSurfaceCount) ||
    !Number.isInteger(trace.surfaceCoverage.gapCount) ||
    !Array.isArray(trace.surfaces)
  ) {
    throw new Error("next-action stale conflict-message trace is missing or malformed");
  }
  if (
    trace.requiredLaneCount !== staleConflictMessageLaneIds.length ||
    trace.laneIds.length !== staleConflictMessageLaneIds.length ||
    trace.coveredLaneCount + trace.gapCount !== trace.requiredLaneCount
  ) {
    throw new Error("next-action stale conflict-message trace count drifted");
  }
  for (const laneId of staleConflictMessageLaneIds) {
    if (!trace.laneIds.includes(laneId)) {
      throw new Error(`next-action stale conflict-message trace missing lane: ${laneId}`);
    }
  }
  for (const scenario of staleConflictMessageSurfaceCases()) {
    const surface = trace.surfaces.find(
      (candidate) => candidate.id === scenario.id,
    );
    if (
      trace.status === "covered" &&
      (surface?.checkId !== scenario.checkId ||
        surface.laneId !== scenario.laneId ||
        surface.status !== "passed" ||
        !String(surface.roleUrl ?? "").includes("/g/") ||
        (scenario.expectedReceiptFragment !== undefined &&
          !String(surface.receiptStatusText ?? "").includes(
            scenario.expectedReceiptFragment,
          )) ||
        (scenario.expectedRejectMessageFragment !== undefined &&
          !String(surface.rejectMessage ?? "").includes(
            scenario.expectedRejectMessageFragment,
          )))
    ) {
      throw new Error(
        `next-action stale conflict-message trace missing surface: ${scenario.id}`,
      );
    }
  }
  if (trace.status === "covered" && trace.gapCount !== 0) {
    throw new Error("next-action stale conflict-message trace covered with gaps");
  }
  if (
    trace.status === "covered" &&
    (trace.surfaceCoverage.status !== "complete" ||
      trace.surfaceCoverage.requiredSurfaceCount !== staleConflictMessageLaneIds.length ||
      trace.surfaceCoverage.coveredSurfaceCount !== staleConflictMessageSurfaceCases().length ||
      trace.surfaceCoverage.gapCount !== 0)
  ) {
    throw new Error("next-action stale conflict-message trace covered without complete surfaces");
  }
  if (trace.status === "gapped" && trace.gapCount === 0) {
    throw new Error("next-action stale conflict-message trace gapped without gaps");
  }
}

function assertHostStaleControlTrace(trace) {
  if (
    trace?.strategy !== "host-stale-control-before-readiness" ||
    !["covered", "gapped", "unavailable"].includes(trace.status) ||
    !Number.isInteger(trace.requiredLaneCount) ||
    !Number.isInteger(trace.coveredLaneCount) ||
    !Number.isInteger(trace.gapCount) ||
    !Array.isArray(trace.laneIds)
  ) {
    throw new Error("next-action host stale-control trace is missing or malformed");
  }
  if (
    trace.requiredLaneCount !== hostStaleControlLaneIds.length ||
    trace.laneIds.length !== hostStaleControlLaneIds.length ||
    trace.coveredLaneCount + trace.gapCount !== trace.requiredLaneCount
  ) {
    throw new Error("next-action host stale-control trace count drifted");
  }
  for (const laneId of hostStaleControlLaneIds) {
    if (!trace.laneIds.includes(laneId)) {
      throw new Error(`next-action host stale-control trace missing lane: ${laneId}`);
    }
  }
  if (trace.status === "covered" && trace.gapCount !== 0) {
    throw new Error("next-action host stale-control trace covered with gaps");
  }
  if (trace.status === "gapped" && trace.gapCount === 0) {
    throw new Error("next-action host stale-control trace gapped without gaps");
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
    ["proof-run", "target/dev-test-game/proof-run.json"],
    ["session", "target/dev-test-game/session.json"],
    ["core-loop", "target/dev-test-game/core-loop-admin-proof.json"],
    ["hardening", "target/dev-test-game/hardening-admin-proof.json"],
    ["identity-adapter", "target/auth-invite-role-proof/invite-role-proof.json"],
    ["identity", "target/dev-test-game/identity-admin-proof.json"],
    ["backup-restore", "target/live-stack-backup-restore-drill/local-backup-restore-proof.json"],
    ["backup", "target/dev-test-game/backup-admin-proof.json"],
    ["ops-artifacts", "target/dev-test-game/ops-artifacts.json"],
    ["ops", "target/dev-test-game/ops-admin-proof.json"],
    ["seed-fixture", "target/dev-test-game/seed-fixture-summary.json"],
    ["seed", "target/dev-test-game/seed-admin-proof.json"],
    ["release-readiness", "target/dev-test-game/release-readiness-checklist.json"],
    ["release-runbook", "target/dev-test-game/release-runbook.json"],
    ["release-runbook-admin", "target/dev-test-game/release-runbook-admin-proof.json"],
    ["race-coverage", "target/dev-test-game/race-coverage.json"],
    ["race-coverage-admin", "target/dev-test-game/race-coverage-admin-proof.json"],
    ["hosted-concurrent-race-matrix", devTestGameHostedConcurrentRaceMatrixPath],
    ["hosted-target-preflight", devTestGameHostedTargetPreflightPath],
    ["hosted-evidence-lane-demo", devTestGameHostedEvidenceLaneDemoProofPath],
    ["hosted-evidence-lane", devTestGameHostedEvidenceLanePath],
    ["release", "target/dev-test-game/release-admin-proof.json"],
    ["admin-spine", "target/dev-test-game/admin-spine-proof.json"],
    ["admin-spine-admin", "target/dev-test-game/admin-spine-admin-proof.json"],
    ["proof-graph", "target/dev-test-game/proof-graph.json"],
    ["proof-graph-admin", "target/dev-test-game/proof-graph-admin-proof.json"],
    ["spine-manifest", "target/dev-test-game/spine-manifest.json"],
    ["spine-manifest-admin", "target/dev-test-game/spine-manifest-admin-proof.json"],
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
  "target/dev-test-game/next-action-admin-proof.json",
  "target/dev-test-game/proof-graph.json",
  "target/dev-test-game/proof-graph-admin-proof.json",
]);

const replacementRaceReloadCellIds = Object.freeze([
  ...raceCoveragePromotedReloadGroup("replacement-race-reload").cellIds,
]);

const hostConcurrentRaceReloadCellIds = Object.freeze([
  ...raceCoveragePromotedReloadGroup("host-concurrent-race-reload").cellIds,
]);

const playerConcurrentActionReloadCellIds = Object.freeze([
  ...raceCoveragePromotedReloadGroup("player-concurrent-action-reload").cellIds,
]);

const cohostDeadlineRaceReloadCellIds = Object.freeze([
  ...raceCoveragePromotedReloadGroup("cohost-deadline-race-reload").cellIds,
]);

const raceCoveragePromotedMilestoneGroupIds = Object.freeze([
  "replacement-race-reload",
  "host-concurrent-race-reload",
  "player-concurrent-action-reload",
  "cohost-deadline-race-reload",
]);

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidence = await writeDevTestGameNextAction();
  console.log(`wrote ${devTestGameNextActionPath} (${evidence.nextAction.status})`);
}
