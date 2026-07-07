import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameProofRun,
} from "./dev_test_game_proof_contract.mjs";
import { assertDevTestGameRaceCoverage } from "./dev_test_game_race_coverage.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";
import { assertDevTestGameReleaseReadiness } from "./dev_test_game_release_readiness.mjs";
import {
  devTestGameReleaseReadinessPath,
} from "./dev_test_game_spine_readiness_steps.mjs";
import {
  devTestGameProofRunPath,
  devTestGameSessionPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  devTestGameHostedConcurrentRaceMatrixPath,
  devTestGameRaceCoveragePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  assertRealHostedEvidenceInputs,
  buildRealHostedEvidenceInputs,
} from "./dev_test_game_real_hosted_evidence_inputs.mjs";
import {
  isExternallyHostedUrl,
} from "./dev_test_game_hosted_target_url_policy.mjs";
import {
  hostedMatrixProgressCheckIds,
  hostedMatrixRealHostedEvidenceCommand,
  hostedMatrixExternalEvidenceProofTarget,
  hostedMatrixRealHostedHandoffChecklist,
  hostedMatrixReconnectLaneIds,
  hostedMatrixRequestedEvidenceIds,
  hostedMatrixStaleConflictMilestoneCases,
  hostedMatrixStaleConflictLaneIds,
} from "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs";

export const DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX_VERSION = 1;
export {
  devTestGameProofRunPath,
  devTestGameReleaseReadinessPath,
  devTestGameSessionPath,
};
export { devTestGameHostedConcurrentRaceMatrixPath, devTestGameRaceCoveragePath };
export const devTestGameHostedConcurrentRaceMatrixCommand =
  "test:dev-test-game-hosted-concurrent-race-matrix";

const hostedMatrixJsonPath = path.join(
  repoRoot,
  devTestGameHostedConcurrentRaceMatrixPath,
);

const reconnectLaneIds = hostedMatrixReconnectLaneIds;
const staleConflictLaneIds = hostedMatrixStaleConflictLaneIds;

export function buildDevTestGameHostedConcurrentRaceMatrixEvidence(
  releaseReadiness,
  {
    raceCoverage,
    proofRun,
    session,
    generatedAt = new Date().toISOString(),
    releaseReadinessSource = devTestGameReleaseReadinessPath,
    raceCoverageSource = devTestGameRaceCoveragePath,
    proofRunSource = devTestGameProofRunPath,
    sessionSource = devTestGameSessionPath,
    hostedTarget = hostedMatrixTargetFromEnv(),
  } = {},
) {
  const readiness = assertDevTestGameReleaseReadiness(releaseReadiness);
  const coverage = assertDevTestGameRaceCoverage(raceCoverage);
  const proof = assertDevTestGameProofRun(proofRun);
  const sessionArtifact = session ?? proof.session;
  if (
    sessionArtifact?.game !== undefined &&
    proof.session?.game !== undefined &&
    sessionArtifact.game !== proof.session.game
  ) {
    throw new Error(
      `hosted concurrent race matrix session game drifted: ${sessionArtifact.game}`,
    );
  }
  const promoted = readiness.generatedFrom?.raceCoveragePromotedMilestones;
  if (
    promoted?.status !== "passed" ||
    promoted.cellCount !== coverage.summary.cellCount ||
    promoted.cellCount !== promoted.reloadCoveredCellCount ||
    promoted.groupCount !== promoted.passedGroupCount
  ) {
    throw new Error(
      "hosted concurrent race matrix evidence requires promoted local race milestones",
    );
  }
  if (coverage.generatedFrom?.proofRun !== proofRunSource) {
    throw new Error(
      `race coverage proof-run source drifted: ${coverage.generatedFrom?.proofRun}`,
    );
  }
  const laneById = new Map(proof.lanes.map((lane) => [lane.id, lane]));
  const cells = coverage.cells.map((cell) => hostedMatrixCell(cell, laneById));
  const reconnectLanes = proofLanesById(laneById, reconnectLaneIds);
  const staleConflictLanes = proofLanesById(laneById, staleConflictLaneIds);
  const staleConflictMilestones =
    hostedMatrixStaleConflictMilestones(staleConflictLanes);
  const roleSurfaces = roleSurfacesFromSession(sessionArtifact);
  const externalHostedEvidence = buildExternalHostedEvidence(hostedTarget, promoted);
  const realHostedDeploymentPassed =
    externalHostedEvidence.status === "passed" &&
    externalHostedEvidence.syntheticExternalTarget !== true &&
    isExternallyHostedUrl(externalHostedEvidence.frontendBaseUrl) &&
    isExternallyHostedUrl(externalHostedEvidence.apiBaseUrl);
  const localDemoHostedEvidenceStatus =
    externalHostedEvidence.syntheticExternalTarget === true
      ? "passed"
      : "not_applicable";
  const realHostedEvidenceStatus = realHostedDeploymentPassed ? "passed" : "unproven";
  const requestedEvidence = hostedMatrixRequestedEvidenceFromReadiness(readiness);
  const realHostedEvidenceInputs = buildRealHostedEvidenceInputs({
    status: realHostedEvidenceStatus,
    mode: externalHostedEvidence.hostedEvidenceMode,
    command: hostedMatrixRealHostedEvidenceCommand,
    proofTarget: hostedMatrixExternalEvidenceProofTarget,
  });
  const hostedHandoffChecklist = realHostedDeploymentPassed
    ? undefined
    : hostedMatrixRealHostedHandoffChecklist({
        preflightStatus: externalHostedEvidence.status,
      });
  const evidence = {
    version: DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX_VERSION,
    proof: "dev-test-game-hosted-concurrent-race-matrix",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-hosted-like-concurrent-race-matrix",
    proofBoundary:
      "Local hosted-like concurrent race matrix over the saved dev-test-game browser/API proof. Passing means the seeded localhost API and frontend target has artifacted multi-session race, reload, reconnect, and stale-client evidence for the recorded cells; it does not prove hosted deployment, multi-node command races, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      releaseReadinessChecklist: releaseReadinessSource,
      releaseReadinessGeneratedAt: readiness.generatedAt,
      proofRun: proofRunSource,
      proofGeneratedAt: proof.generatedAt,
      session: sessionSource,
      raceCoverage: raceCoverageSource,
      raceCoverageGeneratedAt: coverage.generatedAt,
      raceCoveragePromotedMilestones: {
        status: promoted.status,
        cellCount: promoted.cellCount,
        provenCellCount: promoted.provenCellCount,
        reloadCoveredCellCount: promoted.reloadCoveredCellCount,
        groupCount: promoted.groupCount,
        passedGroupCount: promoted.passedGroupCount,
        requiredCellCount: promoted.requiredCellCount,
        coveredCellCount: promoted.coveredCellCount,
        gapCount: promoted.gapCount,
        groupIds: promoted.groups.map((group) => group.id),
      },
    },
    hostedLikeTarget: {
      kind: "local-rust-api-plus-sveltekit-browser",
      status: "passed",
      game: proof.session.game,
      seedMode: proof.session.seedMode,
      frontendBaseUrl: proof.session.frontendBaseUrl,
      apiBaseUrl: proof.session.apiBaseUrl,
      roleSurfaces,
      setupBootstrap: proof.session.setupBootstrap,
      proofBoundary: proof.proofBoundary,
    },
    summary: {
      cellCount: cells.length,
      passedCellCount: cells.filter((cell) => cell.status === "passed").length,
      raceLaneCount: cells.length,
      reloadLaneCount: cells.filter((cell) => cell.reloadLane !== null).length,
      reloadCoveredCellCount: cells.filter(
        (cell) => cell.reloadLane?.status === "passed",
      ).length,
      reconnectLaneCount: reconnectLanes.length,
      staleConflictLaneCount: staleConflictLanes.length,
      roleSurfaceCount: roleSurfaces.length,
      hostedEvidenceStatus: externalHostedEvidence.status,
      hostedEvidenceMode: externalHostedEvidence.hostedEvidenceMode,
      localDemoHostedEvidenceStatus,
      realHostedEvidenceStatus,
      realHostedDeploymentStatus: realHostedDeploymentPassed ? "passed" : "unproven",
    },
    evidenceProgress: [
      {
        id: hostedMatrixProgressCheckIds[0],
        status: "passed",
        evidence: [
          proof.session.frontendBaseUrl,
          proof.session.apiBaseUrl,
          devTestGameSessionPath,
        ],
      },
      {
        id: hostedMatrixProgressCheckIds[1],
        status: "passed",
        evidence: cells.map((cell) => cell.id),
      },
      {
        id: hostedMatrixProgressCheckIds[2],
        status: "passed",
        evidence: cells.map((cell) => cell.reloadLane.id),
      },
      {
        id: hostedMatrixProgressCheckIds[3],
        status: "passed",
        evidence: reconnectLanes.map((lane) => lane.id),
      },
      {
        id: hostedMatrixProgressCheckIds[4],
        status: "passed",
        evidence: staleConflictLanes.map((lane) => lane.id),
      },
      {
        id: hostedMatrixProgressCheckIds[5],
        status: "passed",
        evidence: ["roleSurfaces.directUrl", "lane.evidence redaction"],
      },
      {
        id: hostedMatrixProgressCheckIds[6],
        status: localDemoHostedEvidenceStatus,
        ...(externalHostedEvidence.syntheticExternalTarget === true
          ? { evidence: [externalHostedEvidence.evidencePath] }
          : {}),
      },
      {
        id: hostedMatrixProgressCheckIds[7],
        status: realHostedEvidenceStatus,
        ...(realHostedEvidenceStatus === "passed"
          ? {
              evidence: [
                externalHostedEvidence.frontendBaseUrl,
                externalHostedEvidence.apiBaseUrl,
                externalHostedEvidence.evidencePath,
              ],
            }
          : {
              requiredEvidence:
                "Raw hosted matrix evidence from a real externally reachable hosted target.",
            }),
      },
      {
        id: hostedMatrixProgressCheckIds[8],
        status: realHostedDeploymentPassed ? "passed" : "unproven",
        ...(realHostedDeploymentPassed
          ? {
              evidence: [
                externalHostedEvidence.frontendBaseUrl,
                externalHostedEvidence.apiBaseUrl,
                externalHostedEvidence.evidencePath,
              ],
            }
          : {}),
        requiredEvidence:
          "Externally reachable hosted API/frontend deployment, multi-node command race execution, and hosted reconnect/stale-client evidence.",
      },
    ],
    realHostedEvidenceInputs,
    ...(hostedHandoffChecklist === undefined ? {} : { hostedHandoffChecklist }),
    externalHostedEvidence,
    cells,
    reconnectLanes,
    staleConflictLanes,
    staleConflictMilestones,
    requestedEvidence: {
      id: requestedEvidence.id,
      status: requestedEvidence.status,
      requiredEvidence: requestedEvidence.requiredEvidence,
      firstProofTarget: devTestGameHostedConcurrentRaceMatrixPath,
      localBaseline: {
        cellCount: promoted.cellCount,
        reloadCoveredCellCount: promoted.reloadCoveredCellCount,
        groupCount: promoted.groupCount,
        passedGroupCount: promoted.passedGroupCount,
      },
    },
    remainingGaps: [
      ...(realHostedDeploymentPassed
        ? []
        : [
            "hosted API/frontend deployment proof with external health checks",
            "multi-node concurrent command race execution against hosted storage",
            "hosted reload/reconnect and stale-client conflict evidence",
          ]),
      "beta/release/operator readiness and human rollback path",
    ],
    nextBuildSlice: {
      command: devTestGameHostedConcurrentRaceMatrixCommand,
      buildSlice:
        "Promote the local hosted-like matrix to a real hosted or multi-node matrix run while preserving the seeded role-surface architecture.",
      proofTarget: devTestGameHostedConcurrentRaceMatrixPath,
    },
  };
  assertDevTestGameHostedConcurrentRaceMatrixEvidence(evidence);
  return evidence;
}

function hostedMatrixRequestedEvidenceFromReadiness(readiness) {
  const unproven = readiness.releaseReadiness.unproven.find((item) =>
    hostedMatrixRequestedEvidenceIds.includes(item.id),
  );
  if (unproven !== undefined) {
    return unproven;
  }
  return {
    id: "real-hosted-concurrent-race-matrix",
    status: "unproven",
    requiredEvidence:
      "Externally reachable hosted API/frontend deployment, multi-node command race execution, and hosted reload/reconnect and stale-client conflict evidence beyond the local hosted-like matrix artifact",
  };
}

export function assertDevTestGameHostedConcurrentRaceMatrixEvidence(evidence) {
  if (
    evidence?.version !== DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX_VERSION ||
    evidence.proof !== "dev-test-game-hosted-concurrent-race-matrix" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-hosted-like-concurrent-race-matrix"
  ) {
    throw new Error("hosted concurrent race matrix evidence shape drifted");
  }
  const promoted = evidence.generatedFrom?.raceCoveragePromotedMilestones;
  if (
    promoted?.status !== "passed" ||
    !Number.isInteger(promoted.cellCount) ||
    promoted.cellCount !== promoted.reloadCoveredCellCount ||
    promoted.groupCount !== promoted.passedGroupCount ||
    !Array.isArray(promoted.groupIds) ||
    promoted.groupIds.length !== promoted.groupCount
  ) {
    throw new Error("hosted concurrent race matrix promoted baseline drifted");
  }
  if (
    evidence.summary?.cellCount !== promoted.cellCount ||
    evidence.summary.passedCellCount !== promoted.cellCount ||
    evidence.summary.reloadCoveredCellCount !== promoted.reloadCoveredCellCount ||
    evidence.summary.reconnectLaneCount !== reconnectLaneIds.length ||
    evidence.summary.staleConflictLaneCount !== staleConflictLaneIds.length ||
    !["not_configured", "configured_unproven", "passed"].includes(
      evidence.summary.hostedEvidenceStatus,
    ) ||
    ![
      "not_configured",
      "configured_unproven",
      "synthetic-demo",
      "real-hosted",
      "local-or-loopback",
    ].includes(evidence.summary.hostedEvidenceMode) ||
    !["passed", "not_applicable"].includes(
      evidence.summary.localDemoHostedEvidenceStatus,
    ) ||
    !["passed", "unproven"].includes(evidence.summary.realHostedEvidenceStatus) ||
    !["passed", "unproven"].includes(
      evidence.summary.realHostedDeploymentStatus,
    )
  ) {
    throw new Error("hosted concurrent race matrix summary drifted");
  }
  assertRealHostedEvidenceInputs(evidence.realHostedEvidenceInputs);
  if (evidence.summary.realHostedDeploymentStatus === "unproven") {
    assertHostedMatrixRealHostedHandoffChecklist(evidence.hostedHandoffChecklist);
  }
  assertExternalHostedEvidence(evidence.externalHostedEvidence, promoted);
  if (
    evidence.hostedLikeTarget?.status !== "passed" ||
    typeof evidence.hostedLikeTarget.frontendBaseUrl !== "string" ||
    typeof evidence.hostedLikeTarget.apiBaseUrl !== "string" ||
    !Array.isArray(evidence.hostedLikeTarget.roleSurfaces) ||
    evidence.hostedLikeTarget.roleSurfaces.length === 0
  ) {
    throw new Error("hosted concurrent race matrix target drifted");
  }
  for (const surface of evidence.hostedLikeTarget.roleSurfaces) {
    if (
      typeof surface.role !== "string" ||
      typeof surface.directUrl !== "string" ||
      "token" in surface ||
      "inviteToken" in surface ||
      "loginUrl" in surface
    ) {
      throw new Error("hosted concurrent race matrix role surface leaked credentials");
    }
  }
  if (!Array.isArray(evidence.cells) || evidence.cells.length !== promoted.cellCount) {
    throw new Error("hosted concurrent race matrix cells drifted");
  }
  for (const cell of evidence.cells) {
    if (
      cell.status !== "passed" ||
      cell.raceLane?.status !== "passed" ||
      cell.reloadLane?.status !== "passed" ||
      !Array.isArray(cell.roleSurfaces) ||
      cell.roleSurfaces.length === 0
    ) {
      throw new Error(`hosted concurrent race matrix cell drifted: ${cell.id}`);
    }
  }
  if (
    !hostedMatrixRequestedEvidenceIds.includes(evidence.requestedEvidence?.id) ||
    evidence.requestedEvidence.status !== "unproven" ||
    !Array.isArray(evidence.remainingGaps) ||
    evidence.remainingGaps.length === 0
  ) {
    throw new Error("hosted concurrent race matrix remaining gap drifted");
  }
  assertHostedMatrixStaleConflictMilestones(evidence.staleConflictMilestones);
  if (
    evidence.nextBuildSlice?.command !==
      devTestGameHostedConcurrentRaceMatrixCommand ||
    evidence.nextBuildSlice?.proofTarget !== devTestGameHostedConcurrentRaceMatrixPath
  ) {
    throw new Error("hosted concurrent race matrix next slice drifted");
  }
  return evidence;
}

function assertHostedMatrixRealHostedHandoffChecklist(checklist) {
  if (
    checklist === null ||
    typeof checklist !== "object" ||
    checklist.status !== "blocked" ||
    typeof checklist.preflightStatus !== "string" ||
    checklist.preflightStatus === "" ||
    checklist.command !== hostedMatrixRealHostedEvidenceCommand ||
    checklist.proofTarget !== hostedMatrixExternalEvidenceProofTarget ||
    !Array.isArray(checklist.inputIds) ||
    checklist.inputIds.length === 0 ||
    !Array.isArray(checklist.blockedCheckIds) ||
    checklist.blockedCheckIds.length === 0 ||
    !Array.isArray(checklist.blockedChecks) ||
    checklist.blockedChecks.length !== checklist.blockedCheckIds.length ||
    checklist.blockedReceipt?.status !== "blocked" ||
    checklist.blockedReceipt.nextProofTarget !==
      hostedMatrixExternalEvidenceProofTarget
  ) {
    throw new Error("hosted concurrent race matrix handoff checklist drifted");
  }
  for (const checkId of checklist.blockedCheckIds) {
    const check = checklist.blockedChecks.find((item) => item.id === checkId);
    if (
      check?.status !== "blocked" ||
      typeof check.requiredEvidence !== "string" ||
      check.requiredEvidence.trim() === ""
    ) {
      throw new Error(
        `hosted concurrent race matrix handoff missing blocked check: ${checkId}`,
      );
    }
  }
}

export function hostedMatrixTargetFromEnv(env = process.env) {
  const frontendBaseUrl = optionalEnv(env.FMARCH_HOSTED_MATRIX_FRONTEND_URL);
  const apiBaseUrl = optionalEnv(env.FMARCH_HOSTED_MATRIX_API_URL);
  const evidencePath = optionalEnv(env.FMARCH_HOSTED_MATRIX_EVIDENCE_PATH);
  const targetSource =
    frontendBaseUrl === null && apiBaseUrl === null && evidencePath === null
      ? "not_configured"
      : "direct-env";
  return {
    targetSource,
    frontendBaseUrl,
    apiBaseUrl,
    evidencePath,
    evidence: undefined,
  };
}

export async function readHostedMatrixTargetFromEnv(env = process.env) {
  const target = hostedMatrixTargetFromEnv(env);
  if (target.evidencePath !== null) {
    return readHostedMatrixTargetEvidence(target);
  }
  const laneTarget = await hostedMatrixTargetFromEvidenceLane(env);
  if (laneTarget !== null) {
    return readHostedMatrixTargetEvidence(laneTarget);
  }
  return target;
}

async function readHostedMatrixTargetEvidence(target) {
  if (target.evidencePath === null) {
    return target;
  }
  const absoluteEvidencePath = path.resolve(repoRoot, target.evidencePath);
  return {
    ...target,
    evidencePath: path.relative(repoRoot, absoluteEvidencePath),
    evidence: await readJson(absoluteEvidencePath),
  };
}

async function hostedMatrixTargetFromEvidenceLane(env) {
  const lanePath = optionalEnv(env.FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE);
  if (lanePath === null) {
    return null;
  }
  const absoluteLanePath = path.resolve(repoRoot, lanePath);
  const lane = await readJson(absoluteLanePath);
  if (
    lane?.proof !== "dev-test-game-hosted-evidence-lane" ||
    lane.status !== "passed" ||
    lane.preflightStatus !== "passed" ||
    lane.hostedEvidence?.mode !== "real-hosted" ||
    lane.hostedEvidence.realHostedEvidenceStatus !== "passed" ||
    typeof lane.hostedEvidence.externalEvidencePath !== "string" ||
    lane.hostedEvidence.externalEvidencePath.trim() === "" ||
    typeof lane.target?.frontendBaseUrl !== "string" ||
    lane.target.frontendBaseUrl.trim() === "" ||
    typeof lane.target?.apiBaseUrl !== "string" ||
    lane.target.apiBaseUrl.trim() === ""
  ) {
    return null;
  }
  return {
    targetSource: "hosted-evidence-lane",
    targetSourcePath: path.relative(repoRoot, absoluteLanePath),
    frontendBaseUrl: lane.target.frontendBaseUrl,
    apiBaseUrl: lane.target.apiBaseUrl,
    evidencePath: lane.hostedEvidence.externalEvidencePath,
    evidence: undefined,
  };
}

function buildExternalHostedEvidence(hostedTarget, promoted) {
  const frontendBaseUrl = hostedTarget?.frontendBaseUrl ?? null;
  const apiBaseUrl = hostedTarget?.apiBaseUrl ?? null;
  const evidencePath = hostedTarget?.evidencePath ?? null;
  const targetSource = hostedTarget?.targetSource ?? "direct-env";
  const targetSourcePath = hostedTarget?.targetSourcePath ?? null;
  const source = hostedTarget?.evidence;
  if (frontendBaseUrl === null && apiBaseUrl === null && evidencePath === null) {
    return {
      status: "not_configured",
      targetSource: "not_configured",
      targetSourcePath: null,
      hostedEvidenceMode: "not_configured",
      syntheticExternalTarget: false,
      frontendBaseUrl: null,
      apiBaseUrl: null,
      evidencePath: null,
      requiredEnv: [
        "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
        "FMARCH_HOSTED_MATRIX_API_URL",
        "FMARCH_HOSTED_MATRIX_EVIDENCE_PATH",
      ],
      proofBoundary:
        "No external hosted matrix target was configured for this local artifact run.",
    };
  }
  if (frontendBaseUrl === null || apiBaseUrl === null) {
    throw new Error(
      "FMARCH_HOSTED_MATRIX_FRONTEND_URL and FMARCH_HOSTED_MATRIX_API_URL must be provided together",
    );
  }
  if (source === undefined) {
    return {
      status: "configured_unproven",
      targetSource,
      targetSourcePath,
      hostedEvidenceMode: "configured_unproven",
      syntheticExternalTarget: false,
      frontendBaseUrl,
      apiBaseUrl,
      evidencePath,
      requiredEvidence:
        "Set FMARCH_HOSTED_MATRIX_EVIDENCE_PATH to a passed hosted matrix evidence JSON generated against the configured API/frontend target.",
      proofBoundary:
        "External hosted target URLs were configured, but no hosted matrix evidence artifact was provided.",
    };
  }
  validateExternalHostedEvidenceSource(source, {
    frontendBaseUrl,
    apiBaseUrl,
    promoted,
  });
  const syntheticExternalTarget =
    source.generatedFrom?.rawEvidenceSyntheticExternalTarget === true ||
    source.sourceMode === "synthetic-demo";
  const targetKind =
    isExternallyHostedUrl(frontendBaseUrl) && isExternallyHostedUrl(apiBaseUrl)
      ? "external"
      : "local_or_loopback";
  return {
    status: "passed",
    targetSource,
    targetSourcePath,
    hostedEvidenceMode: syntheticExternalTarget
      ? "synthetic-demo"
      : targetKind === "external"
        ? "real-hosted"
        : "local-or-loopback",
    syntheticExternalTarget,
    frontendBaseUrl,
    apiBaseUrl,
    evidencePath,
    proof: source.proof,
    generatedAt: source.generatedAt,
    targetKind,
    groupIds: [...source.groupIds],
    cellIds: [...source.cellIds],
    commandRaceCount: source.commandRaceCount,
    reloadRecoveryCount: source.reloadRecoveryCount,
    reconnectRecovery: source.reconnectRecovery,
    staleConflictMessages: source.staleConflictMessages,
    rawRoleCredentialsRedacted: source.rawRoleCredentialsRedacted,
    proofBoundary:
      "External hosted matrix evidence was supplied and matched the configured API/frontend target. This still does not by itself prove beta readiness, release readiness, production operations, or human rollback readiness.",
  };
}

function assertExternalHostedEvidence(evidence, promoted) {
  if (
    evidence === null ||
    typeof evidence !== "object" ||
    !["not_configured", "configured_unproven", "passed"].includes(evidence.status)
  ) {
    throw new Error("external hosted matrix evidence status drifted");
  }
  if (evidence.status !== "passed") {
    return;
  }
  validateExternalHostedEvidenceSource(
    {
      proof: evidence.proof,
      status: evidence.status,
      frontendBaseUrl: evidence.frontendBaseUrl,
      apiBaseUrl: evidence.apiBaseUrl,
      groupIds: evidence.groupIds,
      cellIds: evidence.cellIds,
      commandRaceCount: evidence.commandRaceCount,
      reloadRecoveryCount: evidence.reloadRecoveryCount,
      reconnectRecovery: evidence.reconnectRecovery,
      staleConflictMessages: evidence.staleConflictMessages,
      rawRoleCredentialsRedacted: evidence.rawRoleCredentialsRedacted,
    },
    {
      frontendBaseUrl: evidence.frontendBaseUrl,
      apiBaseUrl: evidence.apiBaseUrl,
      promoted,
    },
  );
}

function validateExternalHostedEvidenceSource(
  source,
  { frontendBaseUrl, apiBaseUrl, promoted },
) {
  if (
    source?.proof !== "fmarch-hosted-concurrent-race-matrix-evidence" ||
    source.status !== "passed" ||
    source.frontendBaseUrl !== frontendBaseUrl ||
    source.apiBaseUrl !== apiBaseUrl ||
    !Array.isArray(source.groupIds) ||
    source.groupIds.length === 0 ||
    !Array.isArray(source.cellIds) ||
    source.cellIds.length === 0 ||
    !Number.isInteger(source.commandRaceCount) ||
    source.commandRaceCount < source.cellIds.length ||
    !Number.isInteger(source.reloadRecoveryCount) ||
    source.reloadRecoveryCount < source.cellIds.length ||
    source.reconnectRecovery !== true ||
    source.staleConflictMessages !== true ||
    source.rawRoleCredentialsRedacted !== true
  ) {
    throw new Error("external hosted matrix evidence artifact drifted");
  }
  const promotedGroupIds = new Set(promotedGroupIdsFrom(promoted));
  for (const groupId of source.groupIds) {
    if (!promotedGroupIds.has(groupId)) {
      throw new Error(`external hosted matrix evidence unknown group: ${groupId}`);
    }
  }
}

function promotedGroupIdsFrom(promoted) {
  if (Array.isArray(promoted?.groupIds)) {
    return promoted.groupIds;
  }
  return (promoted?.groups ?? []).map((group) => group.id);
}

function optionalEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function hostedMatrixCell(cell, laneById) {
  const raceLane = laneSummary(laneById.get(cell.raceLaneId), cell.raceLaneId);
  const reloadLane = laneSummary(laneById.get(cell.reloadLaneId), cell.reloadLaneId);
  return {
    id: cell.id,
    actorPair: cell.actorPair,
    commandFamily: cell.commandFamily,
    roleSurfaces: [...cell.roleSurfaces],
    status:
      cell.status === "passed" &&
      raceLane.status === "passed" &&
      reloadLane.status === "passed"
        ? "passed"
        : "blocked",
    raceLane,
    reloadLane,
  };
}

function proofLanesById(laneById, laneIds) {
  return laneIds.map((laneId) => laneSummary(laneById.get(laneId), laneId));
}

function hostedMatrixStaleConflictMilestones(staleConflictLanes) {
  const laneById = new Map(staleConflictLanes.map((lane) => [lane.id, lane]));
  return hostedMatrixStaleConflictMilestoneCases().map((scenario) => {
    const lane = laneById.get(scenario.laneId);
    if (lane?.status !== "passed") {
      throw new Error(
        `hosted concurrent race matrix missing stale milestone lane: ${scenario.laneId}`,
      );
    }
    return {
      id: scenario.id,
      label: scenario.label,
      status: "passed",
      progressCheckId: scenario.progressCheckId,
      laneId: scenario.laneId,
      laneLabel: lane.label,
      proofBoundary: scenario.proofBoundary,
      evidence: lane.evidence,
    };
  });
}

function assertHostedMatrixStaleConflictMilestones(milestones) {
  const expectedCases = hostedMatrixStaleConflictMilestoneCases();
  if (
    !Array.isArray(milestones) ||
    milestones.length !== expectedCases.length
  ) {
    throw new Error("hosted concurrent race matrix stale milestones drifted");
  }
  for (const scenario of expectedCases) {
    const milestone = milestones.find((candidate) => candidate.id === scenario.id);
    if (
      milestone?.status !== "passed" ||
      milestone.progressCheckId !== scenario.progressCheckId ||
      milestone.laneId !== scenario.laneId ||
      milestone.proofBoundary !== scenario.proofBoundary
    ) {
      throw new Error(
        `hosted concurrent race matrix stale milestone drifted: ${scenario.id}`,
      );
    }
  }
}

function laneSummary(lane, laneId) {
  if (lane?.status !== "passed") {
    throw new Error(`hosted concurrent race matrix missing passed lane: ${laneId}`);
  }
  return {
    id: lane.id,
    label: lane.label,
    status: lane.status,
    evidence: redactSensitive(lane.evidence ?? {}),
  };
}

function roleSurfacesFromSession(sessionArtifact) {
  const sessions = sessionArtifact?.sessions ?? {};
  return Object.entries(sessions)
    .filter(([, session]) => typeof session?.directUrl === "string")
    .map(([role, session]) => ({
      role,
      principalUserId: String(session.principalUserId ?? ""),
      expectedCapabilityKind: String(session.expectedCapabilityKind ?? ""),
      directUrl: session.directUrl,
      returnTo: String(session.returnTo ?? ""),
    }))
    .sort((a, b) => a.role.localeCompare(b.role));
}

function redactSensitive(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      isSensitiveKey(key) ? "[redacted]" : redactSensitive(child),
    ]),
  );
}

function isSensitiveKey(key) {
  return /token|cookie|authorization|secret|password|databaseUrl|grant/i.test(key);
}

async function main() {
  const readinessPath = path.join(repoRoot, devTestGameReleaseReadinessPath);
  const sessionPath = path.join(repoRoot, devTestGameSessionPath);
  const raceCoveragePath = path.join(repoRoot, devTestGameRaceCoveragePath);
  const proofRunPath = path.join(repoRoot, devTestGameProofRunPath);
  const [readiness, session, raceCoverage, proofRun] = await Promise.all([
    readJson(readinessPath),
    readJson(sessionPath),
    readJson(raceCoveragePath),
    readJson(proofRunPath),
  ]);
  const hostedTarget = await readHostedMatrixTargetFromEnv();
  const evidence = buildDevTestGameHostedConcurrentRaceMatrixEvidence(readiness, {
    raceCoverage,
    proofRun,
    session,
    hostedTarget,
  });
  await mkdir(path.dirname(hostedMatrixJsonPath), { recursive: true });
  await writeFile(hostedMatrixJsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `wrote ${path.relative(repoRoot, hostedMatrixJsonPath)} (${evidence.status})`,
  );
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await main();
}
