import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameHostedConcurrentRaceMatrixEvidence,
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import {
  devTestGameHostedConcurrentRaceMatrixAdminProofPath,
  hostedMatrixProgressCheckIds,
  hostedMatrixRealHostedEvidenceInputIds,
  hostedMatrixRelatedAuditIds,
  hostedMatrixStaleConflictMilestoneCases,
} from "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs";
import {
  hostedEvidenceHandoffBlockedCheckRequiredEvidence,
  hostedEvidenceHandoffInputValues,
  hostedEvidenceHandoffSummary,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  assertAdminRoleSurfaceStatusText,
  assertVisibleAdminRoleSurfaceRows,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";
import {
  buildAdminAuditHandoffPath,
} from "./dev_test_game_admin_audit_handoff_path.mjs";
import {
  assertGeneratedAdminProofHandoffPath,
} from "./dev_test_game_admin_audit_handoff_contract.mjs";
import {
  devTestGameProofRunPath,
} from "./dev_test_game_spine_artifact_paths.mjs";

const hostedMatrixPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX ??
    devTestGameHostedConcurrentRaceMatrixPath,
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    devTestGameProofRunPath,
);
const hostedMatrixRelativePath = path.relative(repoRoot, hostedMatrixPath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(
  repoRoot,
  devTestGameHostedConcurrentRaceMatrixAdminProofPath,
);
const requiredProgressChecks = hostedMatrixProgressCheckIds;
const requiredRelatedLinks = hostedMatrixRelatedAuditIds;
const requiredRealHostedEvidenceInputs =
  hostedMatrixRealHostedEvidenceInputIds;
const requiredStaleConflictMilestones =
  hostedMatrixStaleConflictMilestoneCases();

function hostedMatrixSummaryRows(hostedMatrix) {
  const missingInputs =
    hostedMatrix.hostedHandoffChecklist?.blockedReceipt?.missingRequiredInputs ?? [];
  const missingInputStatus =
    missingInputs.length === 0
      ? "0 missing hosted inputs\nLocal hosted-like matrix evidence cannot satisfy real hosted race evidence."
      : `${missingInputs.length} missing hosted inputs\n${missingInputs.join(
          ", ",
        )}\nLocal hosted-like matrix evidence cannot satisfy real hosted race evidence.`;
  return [
    {
      id: "coverage",
      status: `${hostedMatrix.status}\n${Number(
        hostedMatrix.summary?.passedCellCount ?? 0,
      )}/${Number(hostedMatrix.summary?.cellCount ?? 0)} cells passed\n${Number(
        hostedMatrix.summary?.reloadCoveredCellCount ?? 0,
      )}/${Number(hostedMatrix.summary?.cellCount ?? 0)} reloads covered\n${Number(
        hostedMatrix.summary?.reconnectLaneCount ?? 0,
      )} reconnect lanes\n${Number(
        hostedMatrix.summary?.staleConflictLaneCount ?? 0,
      )} stale conflict lanes`,
    },
    {
      id: "hosted-evidence",
      status: `${String(
        hostedMatrix.summary?.realHostedEvidenceStatus ?? "unknown",
      )}\n${String(
        hostedMatrix.summary?.realHostedDeploymentStatus ?? "unknown",
      )}\n${String(hostedMatrix.summary?.hostedEvidenceMode ?? "unknown")}`,
    },
    {
      id: "missing-inputs",
      status: missingInputStatus,
    },
  ];
}

function hostedMatrixSummaryStatuses(hostedMatrix) {
  return Object.fromEntries(
    hostedMatrixSummaryRows(hostedMatrix).map((summary) => [
      summary.id,
      summary.status,
    ]),
  );
}

function hostedEvidenceTransition(hostedMatrix) {
  return {
    source: String(hostedMatrix.externalHostedEvidence?.targetSource ?? "unknown"),
    sourcePath:
      hostedMatrix.externalHostedEvidence?.targetSourcePath === null ||
      hostedMatrix.externalHostedEvidence?.targetSourcePath === undefined
        ? null
        : String(hostedMatrix.externalHostedEvidence.targetSourcePath),
    status: String(hostedMatrix.summary?.hostedEvidenceStatus ?? "unknown"),
    mode: String(hostedMatrix.summary?.hostedEvidenceMode ?? "unknown"),
    realHostedEvidenceStatus: String(
      hostedMatrix.summary?.realHostedEvidenceStatus ?? "unknown",
    ),
    realHostedDeploymentStatus: String(
      hostedMatrix.summary?.realHostedDeploymentStatus ?? "unknown",
    ),
    externalEvidencePath:
      hostedMatrix.externalHostedEvidence?.evidencePath === null ||
      hostedMatrix.externalHostedEvidence?.evidencePath === undefined
        ? null
        : String(hostedMatrix.externalHostedEvidence.evidencePath),
    frontendBaseUrl:
      hostedMatrix.externalHostedEvidence?.frontendBaseUrl === null ||
      hostedMatrix.externalHostedEvidence?.frontendBaseUrl === undefined
        ? null
        : String(hostedMatrix.externalHostedEvidence.frontendBaseUrl),
    apiBaseUrl:
      hostedMatrix.externalHostedEvidence?.apiBaseUrl === null ||
      hostedMatrix.externalHostedEvidence?.apiBaseUrl === undefined
        ? null
        : String(hostedMatrix.externalHostedEvidence.apiBaseUrl),
  };
}

function hostedMatrixHandoffPath(hostedMatrix) {
  return buildAdminAuditHandoffPath({
    upstreamAuditId: "local-next-action",
    localCapabilityAuditId: "local-race-coverage",
    downstreamStatus: String(
      hostedMatrix.summary?.realHostedEvidenceStatus ?? "unknown",
    ),
    downstreamCommand: String(hostedMatrix.realHostedEvidenceInputs?.command ?? ""),
    downstreamProofTarget: String(
      hostedMatrix.realHostedEvidenceInputs?.proofTarget ?? "",
    ),
  });
}

export function hostedConcurrentRaceMatrixAdminProofCase() {
  return {
    smokeName: "dev-test-game-hosted-concurrent-race-matrix-admin-proof",
    stage: "hosted-concurrent-race-matrix-admin-proof-listen",
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX: hostedMatrixRelativePath,
    },
    loadSource: async () => ({
      hostedMatrix: assertDevTestGameHostedConcurrentRaceMatrixEvidence(
        await readJson(hostedMatrixPath),
      ),
      proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
    }),
    prove: async ({ browser, frontendBaseUrl, source }) => {
      const hostedHandoffInputValues =
        source.hostedMatrix.hostedHandoffChecklist === undefined
          ? {}
          : hostedEvidenceHandoffInputValues(
              source.hostedMatrix.realHostedEvidenceInputs,
            );
      const hostedHandoffBlockedCheckRequiredEvidence =
        hostedEvidenceHandoffBlockedCheckRequiredEvidence(
          source.hostedMatrix.hostedHandoffChecklist?.blockedChecks ?? [],
          source.hostedMatrix.hostedHandoffChecklist?.blockedCheckIds ?? [],
        );
      const hostedHandoffSummary =
        source.hostedMatrix.hostedHandoffChecklist === undefined
          ? null
          : hostedEvidenceHandoffSummary({
              status: source.hostedMatrix.hostedHandoffChecklist.status,
              preflightStatus:
                source.hostedMatrix.hostedHandoffChecklist.preflightStatus,
              inputs: source.hostedMatrix.realHostedEvidenceInputs,
              command: source.hostedMatrix.hostedHandoffChecklist.command,
              proofTarget: source.hostedMatrix.hostedHandoffChecklist.proofTarget,
            });
      return await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: source.proofRun.session.game,
        auditId: "local-hosted-concurrent-race-matrix",
        requiredChecks: [
          ...requiredProgressChecks,
          ...source.hostedMatrix.cells.map((cell) => cell.id),
        ],
        requiredReconnectLanes: source.hostedMatrix.reconnectLanes.map(
          (lane) => lane.id,
        ),
        requiredStaleConflictLanes: source.hostedMatrix.staleConflictLanes.map(
          (lane) => lane.id,
        ),
        requiredHostedMatrixSummaries: hostedMatrixSummaryRows(
          source.hostedMatrix,
        ).map((summary) => summary.id),
        requiredHostedMatrixSummaryStatuses: hostedMatrixSummaryStatuses(
          source.hostedMatrix,
        ),
        requiredCheckStatuses: {
          "local-demo-hosted-evidence":
            source.hostedMatrix.summary.localDemoHostedEvidenceStatus,
          "real-hosted-evidence-required":
            source.hostedMatrix.summary.realHostedEvidenceStatus,
          "real-hosted-deployment":
            source.hostedMatrix.summary.realHostedDeploymentStatus,
        },
        requiredUnproven: [
          source.hostedMatrix.requestedEvidence.id,
          ...source.hostedMatrix.remainingGaps.map(
            (_gap, index) => `remaining-gap-${index + 1}`,
          ),
        ],
        requiredRealHostedEvidenceInputs,
        requiredHostedHandoffInputs:
          source.hostedMatrix.hostedHandoffChecklist?.inputIds ?? [],
        requiredHostedHandoffInputValues: hostedHandoffInputValues,
        requiredHostedHandoffBlockedChecks:
          source.hostedMatrix.hostedHandoffChecklist?.blockedCheckIds ?? [],
        requiredHostedHandoffBlockedCheckStatuses:
          hostedHandoffBlockedCheckRequiredEvidence,
        requiredHostedHandoffSummary: hostedHandoffSummary,
        requiredHostedHandoffBlockedReceipt:
          source.hostedMatrix.hostedHandoffChecklist?.blockedReceipt ?? null,
        requiredHandoffPath: hostedMatrixHandoffPath(source.hostedMatrix),
        requiredRelatedLinks,
        requiredRelatedDestinations: [
          {
            linkId: "local-next-action",
            auditId: "local-next-action",
            requiredChecks: ["next-command"],
          },
        ],
      });
    },
    buildEvidence: ({ source, adminRoleSurface }) => ({
      version: 1,
      proof: "dev-test-game-hosted-concurrent-race-matrix-admin-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: "local-dev-test-game-hosted-concurrent-race-matrix-admin-surface",
      proofBoundary:
        "Local SvelteKit admin role URL with fixture admin authority over the generated hosted-like concurrent race matrix. Proves the local matrix artifact is discoverable from the seeded admin overview and inspectable in a native admin audit detail route, including the unproven real-hosted-deployment boundary; it does not prove hosted deployment, multi-node storage, beta readiness, release readiness, production operations, or human rollback readiness.",
      generatedFrom: {
        hostedConcurrentRaceMatrix: hostedMatrixRelativePath,
        proofRun: proofRunRelativePath,
        game: source.proofRun.session.game,
        cellIds: source.hostedMatrix.cells.map((cell) => cell.id),
        reconnectLaneIds: source.hostedMatrix.reconnectLanes.map((lane) => lane.id),
        staleConflictLaneIds: source.hostedMatrix.staleConflictLanes.map(
          (lane) => lane.id,
        ),
        staleConflictMilestones: source.hostedMatrix.staleConflictMilestones.map(
          (milestone) => ({
            id: milestone.id,
            laneId: milestone.laneId,
            progressCheckId: milestone.progressCheckId,
          }),
        ),
        hostedMatrixSummaryIds: hostedMatrixSummaryRows(source.hostedMatrix).map(
          (summary) => summary.id,
        ),
        hostedMatrixSummaryStatuses: hostedMatrixSummaryStatuses(
          source.hostedMatrix,
        ),
        progressCheckIds: requiredProgressChecks,
        relatedAuditIds: requiredRelatedLinks,
        requestedEvidenceId: source.hostedMatrix.requestedEvidence.id,
        hostedEvidenceStatus: source.hostedMatrix.summary.hostedEvidenceStatus,
        hostedEvidenceMode: source.hostedMatrix.summary.hostedEvidenceMode,
        localDemoHostedEvidenceStatus:
          source.hostedMatrix.summary.localDemoHostedEvidenceStatus,
        realHostedEvidenceStatus:
          source.hostedMatrix.summary.realHostedEvidenceStatus,
        hostedEvidenceTransition: hostedEvidenceTransition(source.hostedMatrix),
        realHostedEvidenceInputIds: requiredRealHostedEvidenceInputs,
        hostedHandoffInputIds:
          source.hostedMatrix.hostedHandoffChecklist?.inputIds ?? [],
        hostedHandoffInputValues:
          source.hostedMatrix.hostedHandoffChecklist === undefined
            ? {}
            : hostedEvidenceHandoffInputValues(
                source.hostedMatrix.realHostedEvidenceInputs,
              ),
        hostedHandoffBlockedCheckIds:
          source.hostedMatrix.hostedHandoffChecklist?.blockedCheckIds ?? [],
        hostedHandoffBlockedCheckRequiredEvidence:
          hostedEvidenceHandoffBlockedCheckRequiredEvidence(
            source.hostedMatrix.hostedHandoffChecklist?.blockedChecks ?? [],
            source.hostedMatrix.hostedHandoffChecklist?.blockedCheckIds ?? [],
          ),
        ...(source.hostedMatrix.hostedHandoffChecklist === undefined
          ? {}
          : {
              hostedHandoffSummary: hostedEvidenceHandoffSummary({
                status: source.hostedMatrix.hostedHandoffChecklist.status,
                preflightStatus:
                  source.hostedMatrix.hostedHandoffChecklist.preflightStatus,
                inputs: source.hostedMatrix.realHostedEvidenceInputs,
                command: source.hostedMatrix.hostedHandoffChecklist.command,
                proofTarget:
                  source.hostedMatrix.hostedHandoffChecklist.proofTarget,
              }),
              hostedHandoffBlockedReceipt:
                source.hostedMatrix.hostedHandoffChecklist.blockedReceipt,
            }),
        handoffPath: hostedMatrixHandoffPath(source.hostedMatrix),
        realHostedDeploymentStatus:
          source.hostedMatrix.summary.realHostedDeploymentStatus,
      },
      adminRoleSurface,
    }),
    assertEvidence: assertHostedConcurrentRaceMatrixAdminProof,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(hostedConcurrentRaceMatrixAdminProofCase());
}

export function assertHostedConcurrentRaceMatrixAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !==
      "dev-test-game-hosted-concurrent-race-matrix-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !==
      "local-dev-test-game-hosted-concurrent-race-matrix-admin-surface"
  ) {
    throw new Error(
      "hosted concurrent race matrix admin proof must pass locally without release claims",
    );
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error(
      "hosted concurrent race matrix admin proof did not prove admin overview click-through",
    );
  }
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.progressCheckIds,
    proofName: "hosted concurrent race matrix admin proof",
    rowName: "visible check",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.cellIds,
    proofName: "hosted concurrent race matrix admin proof",
    rowName: "visible cell",
  });
  for (const laneId of evidence.generatedFrom?.reconnectLaneIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleReconnectLanes?.includes(laneId)) {
      throw new Error(
        `hosted concurrent race matrix admin proof missing reconnect lane: ${laneId}`,
      );
    }
  }
  for (const laneId of evidence.generatedFrom?.staleConflictLaneIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleStaleConflictLanes?.includes(laneId)) {
      throw new Error(
        `hosted concurrent race matrix admin proof missing stale-conflict lane: ${laneId}`,
      );
    }
  }
  for (const scenario of requiredStaleConflictMilestones) {
    const milestone = evidence.generatedFrom?.staleConflictMilestones?.find(
      (candidate) => candidate.id === scenario.id,
    );
    if (
      milestone?.laneId !== scenario.laneId ||
      milestone.progressCheckId !== scenario.progressCheckId ||
      !evidence.adminRoleSurface?.visibleStaleConflictLanes?.includes(
        scenario.laneId,
      )
    ) {
      throw new Error(
        `hosted concurrent race matrix admin proof missing stale milestone: ${scenario.id}`,
      );
    }
  }
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedMatrixSummaryIds,
    proofName: "hosted concurrent race matrix admin proof",
    rowName: "hosted matrix summary",
    surfaceKey: "visibleHostedMatrixSummaries",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedMatrixSummaryStatuses,
    proofName: "hosted concurrent race matrix admin proof",
    rowName: "hosted matrix summary status",
    surfaceKey: "visibleHostedMatrixSummaryStatuses",
  });
  assertHostedEvidenceTransition(evidence);
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.relatedAuditIds,
    proofName: "hosted concurrent race matrix admin proof",
    rowName: "related link",
    surfaceKey: "visibleRelatedLinks",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds:
      evidence.generatedFrom?.requestedEvidenceId === undefined
        ? []
        : [evidence.generatedFrom.requestedEvidenceId],
    proofName: "hosted concurrent race matrix admin proof",
    rowName: "requested evidence row",
    surfaceKey: "visibleUnproven",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.realHostedEvidenceInputIds,
    proofName: "hosted concurrent race matrix admin proof",
    rowName: "real hosted input",
    surfaceKey: "visibleRealHostedEvidenceInputs",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffInputIds,
    proofName: "hosted concurrent race matrix admin proof",
    rowName: "handoff input",
    surfaceKey: "visibleHostedHandoffInputs",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffBlockedCheckIds,
    proofName: "hosted concurrent race matrix admin proof",
    rowName: "handoff blocked check",
    surfaceKey: "visibleHostedHandoffBlockedChecks",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedHandoffInputValues,
    proofName: "hosted concurrent race matrix admin proof",
    rowName: "handoff input value",
    surfaceKey: "visibleHostedHandoffInputValues",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses:
      evidence.generatedFrom?.hostedHandoffBlockedCheckRequiredEvidence,
    proofName: "hosted concurrent race matrix admin proof",
    rowName: "blocked check evidence",
    surfaceKey: "visibleHostedHandoffBlockedCheckStatuses",
  });
  const expectedSummary = evidence.generatedFrom?.hostedHandoffSummary;
  if (expectedSummary !== undefined) {
    for (const [key, expectedValue] of Object.entries(expectedSummary)) {
      if (
        evidence.adminRoleSurface?.visibleHostedHandoffSummary?.[key] !==
        String(expectedValue)
      ) {
        throw new Error(
          `hosted concurrent race matrix admin proof missing handoff summary: ${key}`,
        );
      }
    }
  }
  const expectedBlockedReceipt =
    evidence.generatedFrom?.hostedHandoffBlockedReceipt;
  if (expectedBlockedReceipt !== undefined) {
    const visibleReceipt =
      evidence.adminRoleSurface?.visibleHostedHandoffBlockedReceipt;
    if (visibleReceipt === undefined) {
      throw new Error(
        "hosted concurrent race matrix admin proof missing blocked receipt",
      );
    }
    for (const key of [
      "status",
      "operatorAction",
      "localVsHostedBoundary",
      "nextProofTarget",
    ]) {
      if (visibleReceipt[key] !== String(expectedBlockedReceipt[key] ?? "")) {
        throw new Error(
          `hosted concurrent race matrix admin proof missing blocked receipt field: ${key}`,
        );
      }
    }
    for (const input of expectedBlockedReceipt.missingRequiredInputs ?? []) {
      if (!visibleReceipt.missingRequiredInputs?.includes(String(input))) {
        throw new Error(
          `hosted concurrent race matrix admin proof missing blocked receipt input: ${input}`,
        );
      }
    }
  }
  assertGeneratedAdminProofHandoffPath({
    proof: evidence,
    proofName: "hosted concurrent race matrix admin proof",
  });
  return evidence;
}

function assertHostedEvidenceTransition(evidence) {
  const transition = evidence.generatedFrom?.hostedEvidenceTransition;
  if (transition === undefined) {
    throw new Error(
      "hosted concurrent race matrix admin proof missing hosted evidence transition",
    );
  }
  const visibleHostedEvidenceSummary =
    evidence.adminRoleSurface?.visibleHostedMatrixSummaryStatuses?.[
      "hosted-evidence"
    ];
  const expectedVisibleSummary = `${transition.realHostedEvidenceStatus}\n${transition.realHostedDeploymentStatus}\n${transition.mode}`;
  if (visibleHostedEvidenceSummary !== expectedVisibleSummary) {
    throw new Error(
      "hosted concurrent race matrix admin proof did not prove hosted evidence transition summary",
    );
  }
  if (
    transition.status !== evidence.generatedFrom?.hostedEvidenceStatus ||
    transition.mode !== evidence.generatedFrom?.hostedEvidenceMode ||
    transition.realHostedEvidenceStatus !==
      evidence.generatedFrom?.realHostedEvidenceStatus ||
    transition.realHostedDeploymentStatus !==
      evidence.generatedFrom?.realHostedDeploymentStatus
  ) {
    throw new Error(
      "hosted concurrent race matrix admin proof transition drifted from generated status fields",
    );
  }
  if (transition.source === "hosted-evidence-lane") {
    if (
      transition.status !== "passed" ||
      transition.mode !== "real-hosted" ||
      transition.realHostedEvidenceStatus !== "passed" ||
      transition.realHostedDeploymentStatus !== "passed" ||
      typeof transition.sourcePath !== "string" ||
      transition.sourcePath.trim() === "" ||
      typeof transition.externalEvidencePath !== "string" ||
      transition.externalEvidencePath.trim() === ""
    ) {
      throw new Error(
        "hosted concurrent race matrix admin proof lane-derived transition is incomplete",
      );
    }
  }
  if (transition.source === "not_configured") {
    if (
      transition.status !== "not_configured" ||
      transition.mode !== "not_configured" ||
      transition.realHostedEvidenceStatus !== "unproven" ||
      transition.realHostedDeploymentStatus !== "unproven"
    ) {
      throw new Error(
        "hosted concurrent race matrix admin proof not-configured transition drifted",
      );
    }
  }
}
