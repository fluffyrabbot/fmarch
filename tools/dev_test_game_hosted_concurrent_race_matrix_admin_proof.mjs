import path from "node:path";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameHostedConcurrentRaceMatrixEvidence,
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import {
  hostedMatrixProgressCheckIds,
  hostedMatrixRealHostedEvidenceInputIds,
  hostedMatrixRelatedAuditIds,
  hostedMatrixStaleConflictMilestoneCases,
} from "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const hostedMatrixPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX ??
    devTestGameHostedConcurrentRaceMatrixPath,
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    "target/dev-test-game/proof-run.json",
);
const hostedMatrixRelativePath = path.relative(repoRoot, hostedMatrixPath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(
  artifactDir,
  "hosted-concurrent-race-matrix-admin-proof.json",
);
const requiredProgressChecks = hostedMatrixProgressCheckIds;
const requiredRelatedLinks = hostedMatrixRelatedAuditIds;
const requiredRealHostedEvidenceInputs =
  hostedMatrixRealHostedEvidenceInputIds;
const requiredStaleConflictMilestones =
  hostedMatrixStaleConflictMilestoneCases();

await runAdminAuditProof({
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
  prove: async ({ browser, frontendBaseUrl, source }) =>
    await proveAdminAuditDetail({
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
      requiredRelatedLinks,
    }),
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
      progressCheckIds: requiredProgressChecks,
      relatedAuditIds: requiredRelatedLinks,
      requestedEvidenceId: source.hostedMatrix.requestedEvidence.id,
      hostedEvidenceStatus: source.hostedMatrix.summary.hostedEvidenceStatus,
      hostedEvidenceMode: source.hostedMatrix.summary.hostedEvidenceMode,
      localDemoHostedEvidenceStatus:
        source.hostedMatrix.summary.localDemoHostedEvidenceStatus,
      realHostedEvidenceStatus:
        source.hostedMatrix.summary.realHostedEvidenceStatus,
      realHostedEvidenceInputIds: requiredRealHostedEvidenceInputs,
      realHostedDeploymentStatus:
        source.hostedMatrix.summary.realHostedDeploymentStatus,
    },
    adminRoleSurface,
  }),
  assertEvidence: assertHostedConcurrentRaceMatrixAdminProof,
});

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
  for (const checkId of evidence.generatedFrom?.progressCheckIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(
        `hosted concurrent race matrix admin proof missing visible check: ${checkId}`,
      );
    }
  }
  for (const cellId of evidence.generatedFrom?.cellIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(cellId)) {
      throw new Error(
        `hosted concurrent race matrix admin proof missing visible cell: ${cellId}`,
      );
    }
  }
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
  for (const linkId of evidence.generatedFrom?.relatedAuditIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(
        `hosted concurrent race matrix admin proof missing related link: ${linkId}`,
      );
    }
  }
  if (
    !evidence.adminRoleSurface?.visibleUnproven?.includes(
      evidence.generatedFrom?.requestedEvidenceId,
    )
  ) {
    throw new Error(
      "hosted concurrent race matrix admin proof missing requested evidence row",
    );
  }
  for (const inputId of evidence.generatedFrom?.realHostedEvidenceInputIds ?? []) {
    if (
      !evidence.adminRoleSurface?.visibleRealHostedEvidenceInputs?.includes(
        inputId,
      )
    ) {
      throw new Error(
        `hosted concurrent race matrix admin proof missing real hosted input: ${inputId}`,
      );
    }
  }
  return evidence;
}
