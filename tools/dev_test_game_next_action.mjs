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
} from "./dev_test_game_race_coverage.mjs";
import {
  devTestGameHostedConcurrentRaceMatrixCommand,
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import {
  devTestGameHostedEvidenceLaneCommand,
  devTestGameHostedEvidenceLanePath,
} from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  devTestGameHostedEvidenceLaneDemoProofPath,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  devTestGameHostedMatrixExternalEvidenceCommand,
  devTestGameHostedMatrixExternalEvidencePath,
} from "./dev_test_game_hosted_matrix_external_evidence.mjs";
import {
  assertDevTestGameHostedTargetPreflight,
  devTestGameHostedTargetPreflightPath,
} from "./dev_test_game_hosted_target_preflight.mjs";
import {
  buildRealHostedEvidenceInputs,
} from "./dev_test_game_real_hosted_evidence_inputs.mjs";
import {
  devTestGameReleaseRunbookCommand,
  devTestGameReleaseRunbookPath,
} from "./dev_test_game_release_runbook.mjs";
import { rankedMissingLocalReadinessDependencies } from "./dev_test_game_local_readiness_dependencies.mjs";

export const DEV_TEST_GAME_NEXT_ACTION_VERSION = 1;
export const devTestGameNextActionPath = "target/dev-test-game/next-action.json";
export const devTestGameReleaseReadinessPath =
  "target/dev-test-game/release-readiness-checklist.json";
export const devTestGameOpsArtifactsPath = "target/dev-test-game/ops-artifacts.json";
export const devTestGameLiveProofCommand =
  "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live";

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
  const coreLoopSpineTarget = coreLoopSpineTargetFromReadiness(readiness);
  const candidates = rankedArtifactsNeedingRefresh(manifest);
  const artifact = candidates[0]?.artifact;
  const selectionTrace = buildSelectionTrace(candidates);
  const stabilityDrift = proofStabilityDriftFromOpsArtifacts(ops);
  const stabilityTrace = buildProofStabilityTrace(stabilityDrift);
  const releaseReadinessCandidates = rankedBuildableReleaseReadinessItems(readiness, {
    hostedTargetPreflight: hostedPreflight,
    coreLoopSpineTarget,
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
      : selectedUnproven !== undefined
        ? {
            command: selectedUnproven.command,
            reason: "release-readiness-unproven",
            status: "ready",
            unproven: {
              id: selectedUnproven.item.id,
              status: selectedUnproven.item.status,
              requiredEvidence: selectedUnproven.item.requiredEvidence,
              buildSlice: selectedUnproven.buildSlice,
              proofTarget: selectedUnproven.proofTarget,
              roleUrl: selectedUnproven.roleUrl,
              proofGraphNodeId: selectedUnproven.proofGraphNodeId,
              ...(selectedUnproven.spineTarget == null
                ? {}
                : { spineTarget: selectedUnproven.spineTarget }),
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
    },
    nextAction,
    selectionTrace,
    stabilityTrace,
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
      "release-readiness-local-check-missing",
      "release-readiness-unproven",
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
    if (!validActionableSpineTarget(evidence.nextAction.unproven?.spineTarget)) {
      throw new Error(
        "next-action release-readiness recovery is missing an actionable spine target",
      );
    }
  }
  if (
    evidence.nextAction.reason === "harness-stability-drift" &&
    typeof evidence.nextAction.stability?.source !== "string"
  ) {
    throw new Error("next-action harness-stability recovery is missing stability evidence");
  }
  assertSelectionTrace(evidence.selectionTrace, evidence.nextAction);
  assertProofStabilityTrace(evidence.stabilityTrace, evidence.nextAction);
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

function coreLoopSpineTargetFromReadiness(readiness) {
  const coreLoopCheck = readiness?.localDevelopmentSpine?.checks?.find?.(
    (check) => check?.id === "local-core-loop-proof",
  );
  const targets = coreLoopCheck?.spineTargets;
  if (targets === null || typeof targets !== "object") {
    return null;
  }
  const target = {
    sourceCheckId: "local-core-loop-proof",
    detailRoleUrl: String(targets.detailRoleUrl ?? ""),
    cycleId: String(targets.defaultCycleId ?? ""),
    roleUrlId: String(targets.defaultRoleUrlId ?? ""),
    roleUrl: String(targets.defaultRoleUrl ?? ""),
    checkpointId: String(targets.defaultCheckpointId ?? ""),
    browserProofCommand: String(targets.browserProofCommand ?? ""),
  };
  return Object.values(target).every((value) => value !== "") ? target : null;
}

function rankedBuildableReleaseReadinessItems(
  readiness,
  { hostedTargetPreflight = null, coreLoopSpineTarget = null } = {},
) {
  if (readiness === null) {
    return [];
  }
  return (readiness.releaseReadiness?.unproven ?? [])
    .map((item, index) => {
      const buildable =
        item.id === "hosted-deployment"
          ? hostedDeploymentBuildable({ hostedTargetPreflight })
          : localBuildableReleaseReadinessItems.get(item.id);
      return buildable === undefined
        ? null
        : {
            item,
            index,
            priority: buildable.priority,
            command: buildable.command,
            buildSlice: buildable.buildSlice,
            proofTarget: buildable.proofTarget,
            roleUrl: buildable.roleUrl,
            proofGraphNodeId: buildable.proofGraphNodeId,
            proofBoundary: buildable.proofBoundary,
            spineTarget: buildable.spineTarget ?? coreLoopSpineTarget,
            hostedEvidenceMode: buildable.hostedEvidenceMode,
            realHostedEvidenceStatus: buildable.realHostedEvidenceStatus,
            realHostedEvidenceInputs: buildable.realHostedEvidenceInputs,
          };
    })
    .filter((candidate) => candidate !== null)
    .sort((left, right) => left.priority - right.priority || left.index - right.index);
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
      requiredEvidence: candidate.item.requiredEvidence,
      ...(candidate.spineTarget == null ? {} : { spineTarget: candidate.spineTarget }),
      ...(candidate.hostedEvidenceMode === undefined
        ? {}
        : { hostedEvidenceMode: candidate.hostedEvidenceMode }),
      ...(candidate.realHostedEvidenceStatus === undefined
        ? {}
        : { realHostedEvidenceStatus: candidate.realHostedEvidenceStatus }),
      ...(candidate.realHostedEvidenceInputs === undefined
        ? {}
        : { realHostedEvidenceInputs: candidate.realHostedEvidenceInputs }),
    })),
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
  const groups = [
    buildRaceCoveragePromotedMilestoneGroup(
      "replacement-race-reload",
      "Replacement race reload",
      replacementRaceReloadTrace,
    ),
    buildRaceCoveragePromotedMilestoneGroup(
      "host-concurrent-race-reload",
      "Host concurrent race reload",
      hostConcurrentRaceReloadTrace,
    ),
    buildRaceCoveragePromotedMilestoneGroup(
      "player-concurrent-action-reload",
      "Player concurrent action reload",
      playerConcurrentActionReloadTrace,
    ),
    buildRaceCoveragePromotedMilestoneGroup(
      "cohost-deadline-race-reload",
      "Cohost deadline race reload",
      cohostDeadlineRaceReloadTrace,
    ),
  ];
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

function buildRaceCoveragePromotedMilestoneGroup(id, label, trace) {
  return {
    id,
    label,
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
      JSON.stringify(nextAction.unproven?.spineTarget ?? null) !==
        JSON.stringify(selected.spineTarget ?? null)
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

function validActionableSpineTarget(spineTarget) {
  return (
    spineTarget !== null &&
    typeof spineTarget === "object" &&
    spineTarget.sourceCheckId === "local-core-loop-proof" &&
    typeof spineTarget.detailRoleUrl === "string" &&
    spineTarget.detailRoleUrl.includes("/admin/audit/local-core-loop") &&
    typeof spineTarget.cycleId === "string" &&
    spineTarget.cycleId.length > 0 &&
    typeof spineTarget.roleUrlId === "string" &&
    spineTarget.roleUrlId.length > 0 &&
    typeof spineTarget.roleUrl === "string" &&
    spineTarget.roleUrl.includes("/g/") &&
    typeof spineTarget.checkpointId === "string" &&
    spineTarget.checkpointId.length > 0 &&
    typeof spineTarget.browserProofCommand === "string" &&
    spineTarget.browserProofCommand.includes("test:dev-test-game-live")
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
    !Array.isArray(trace.laneIds)
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
  if (trace.status === "covered" && trace.gapCount !== 0) {
    throw new Error("next-action stale conflict-message trace covered with gaps");
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

function hostedDeploymentBuildable({ hostedTargetPreflight }) {
  if (hostedTargetPreflight?.status === "passed") {
    const syntheticExternalTarget =
      hostedTargetPreflight.target?.rawEvidenceSyntheticExternalTarget === true;
    return {
      priority: 0,
      command: `npm run ${devTestGameHostedEvidenceLaneCommand}`,
      buildSlice:
        syntheticExternalTarget
          ? "Run the one-command hosted evidence lane to refresh the local demo pass path; real externally hosted evidence remains required."
          : "Run the one-command hosted evidence lane; the hosted target preflight has passed, so the lane can write external hosted matrix evidence.",
      proofTarget: devTestGameHostedMatrixExternalEvidencePath,
      roleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      proofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
      proofBoundary:
        syntheticExternalTarget
          ? "Local demo hosted evidence handoff after passed synthetic target preflight. This command refreshes the blocked-to-passed local pass path, but does not satisfy real hosted deployment evidence."
          : "External hosted evidence handoff after passed target preflight. This command requires the same FMARCH_HOSTED_MATRIX_FRONTEND_URL, FMARCH_HOSTED_MATRIX_API_URL, and FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH target inputs; it does not let local hosted-like evidence satisfy hosted deployment.",
      hostedEvidenceMode: syntheticExternalTarget ? "synthetic-demo" : "real-hosted",
      realHostedEvidenceStatus: syntheticExternalTarget ? "unproven" : "passed",
      realHostedEvidenceInputs: buildRealHostedEvidenceInputs({
        status: syntheticExternalTarget ? "unproven" : "passed",
        mode: syntheticExternalTarget ? "synthetic-demo" : "real-hosted",
      }),
    };
  }
  return localBuildableReleaseReadinessItems.get("hosted-deployment");
}

const localBuildableReleaseReadinessItems = new Map([
  [
    "hosted-deployment",
    {
      priority: 0,
      command: `npm run ${devTestGameHostedEvidenceLaneCommand}`,
      buildSlice:
        "Run the one-command hosted evidence lane; it records a blocked preflight report until externally reachable hosted URLs and raw evidence are configured.",
      proofTarget: devTestGameHostedEvidenceLanePath,
      roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      proofGraphNodeId: "admin-proof:hosted-evidence-lane",
      proofBoundary:
        "Hosted evidence lane handoff. This command records whether FMARCH_HOSTED_MATRIX_FRONTEND_URL, FMARCH_HOSTED_MATRIX_API_URL, and FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH are configured for a non-local hosted target, then exposes the blocked or passed lane through its native admin role URL; it does not let local hosted-like evidence satisfy hosted deployment.",
      realHostedEvidenceInputs: buildRealHostedEvidenceInputs({
        status: "unproven",
        mode: "not_configured",
      }),
    },
  ],
  [
    "hosted-concurrent-race-matrix",
    {
      priority: 5,
      command: `npm run ${devTestGameHostedConcurrentRaceMatrixCommand}`,
      buildSlice:
        "Create the first hosted-like concurrent race matrix proof request from the promoted local race baseline.",
      proofTarget: devTestGameHostedConcurrentRaceMatrixPath,
      roleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      proofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
      proofBoundary:
        "Machine-readable request artifact only. This can prepare hosted-like concurrent race proof work from the local promoted baseline, but it does not prove hosted deployment, multi-node races, beta readiness, release readiness, or production readiness.",
    },
  ],
  [
    "real-hosted-concurrent-race-matrix",
    {
      priority: 10,
      command: `npm run ${devTestGameHostedMatrixExternalEvidenceCommand}`,
      buildSlice:
        "Promote the local hosted-like matrix with externally reachable hosted race, reload, reconnect, and stale-client evidence.",
      proofTarget: devTestGameHostedMatrixExternalEvidencePath,
      roleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      proofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
      proofBoundary:
        "External hosted matrix handoff. Passing requires normalized raw evidence from a real hosted target; local browser/API proof artifacts are only the baseline.",
    },
  ],
  [
    "human-release-runbook",
    {
      priority: 20,
      command: `npm run ${devTestGameReleaseRunbookCommand}`,
      buildSlice:
        "Create the local release-runbook rehearsal that maps remaining readiness gaps to rollback, support, owner, and evidence boundaries.",
      proofTarget: devTestGameReleaseRunbookPath,
      roleUrl: "/admin/audit/local-release-runbook?game=<seeded-game>",
      proofGraphNodeId: "admin-proof:release-runbook",
      proofBoundary:
        "Machine-readable local runbook rehearsal only. This can prove the release checklist is mapped and inspectable, but it does not prove human approval, beta readiness, release readiness, or production readiness.",
    },
  ],
]);

const replacementRaceReloadCellIds = Object.freeze([
  "replacement-private-post",
  "replacement-vote",
  "replacement-action",
]);

const hostConcurrentRaceReloadCellIds = Object.freeze([
  "host-resolve",
  "host-advance",
  "host-deadline-advance",
  "host-lifecycle",
  "host-mixed-advance",
  "host-votecount-publication",
  "host-complete-game",
]);

const playerConcurrentActionReloadCellIds = Object.freeze([
  "player-vote-change",
  "player-night-action",
  "player-vote-vs-host-resolve",
  "player-action-vs-host-advance",
  "player-vs-completed-game",
]);

const cohostDeadlineRaceReloadCellIds = Object.freeze([
  "cohost-deadline-vs-host-resolve",
]);

const raceCoveragePromotedMilestoneGroupIds = Object.freeze([
  "replacement-race-reload",
  "host-concurrent-race-reload",
  "player-concurrent-action-reload",
  "cohost-deadline-race-reload",
]);

const staleConflictMessageLaneIds = Object.freeze([
  "replacement-stale-conflict-message",
  "stale-action-conflict-message",
  "stale-dead-action-conflict",
]);

const hostStaleControlLaneIds = Object.freeze([
  "stale-host-publish",
  "stale-host-lifecycle",
  "stale-host-modkill",
  "stale-host-prompt",
  "stale-host-prompt-reload",
  "stale-host-complete",
  "stale-host-complete-reload",
  "stale-host-complete-reconnect-recovery",
  "stale-host-control",
  "stale-host-resolve",
  "stale-host-resolve-reload",
  "stale-host-resolve-reconnect-recovery",
  "stale-host-advance",
  "stale-host-advance-reload",
  "stale-host-advance-reconnect-recovery",
  "stale-host-deadline",
  "stale-host-deadline-reload",
  "stale-host-deadline-reconnect-recovery",
]);

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidence = await writeDevTestGameNextAction();
  console.log(`wrote ${devTestGameNextActionPath} (${evidence.nextAction.status})`);
}
