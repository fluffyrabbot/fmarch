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
  hostedEvidenceHandoffBlockedCheckRequiredEvidence,
  hostedEvidenceHandoffInputValues,
  hostedEvidenceHandoffSummary,
} from "./dev_test_game_hosted_handoff_cases.mjs";
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
  prove: async ({ browser, frontendBaseUrl, source }) => {
    const hostedHandoffInputValues = hostedEvidenceHandoffInputValues(
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
      requiredRelatedLinks,
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
      hostedHandoffInputIds:
        source.hostedMatrix.hostedHandoffChecklist?.inputIds ?? [],
      hostedHandoffInputValues: hostedEvidenceHandoffInputValues(
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
  for (const inputId of evidence.generatedFrom?.hostedHandoffInputIds ?? []) {
    if (
      !evidence.adminRoleSurface?.visibleHostedHandoffInputs?.includes(inputId)
    ) {
      throw new Error(
        `hosted concurrent race matrix admin proof missing handoff input: ${inputId}`,
      );
    }
  }
  for (const checkId of evidence.generatedFrom?.hostedHandoffBlockedCheckIds ?? []) {
    if (
      !evidence.adminRoleSurface?.visibleHostedHandoffBlockedChecks?.includes(
        checkId,
      )
    ) {
      throw new Error(
        `hosted concurrent race matrix admin proof missing handoff blocked check: ${checkId}`,
      );
    }
  }
  for (const [inputId, expectedValue] of Object.entries(
    evidence.generatedFrom?.hostedHandoffInputValues ?? {},
  )) {
    const visibleValue =
      evidence.adminRoleSurface?.visibleHostedHandoffInputValues?.[inputId];
    if (typeof visibleValue !== "string" || !visibleValue.includes(expectedValue)) {
      throw new Error(
        `hosted concurrent race matrix admin proof missing handoff input value: ${inputId}`,
      );
    }
  }
  for (const [checkId, expectedText] of Object.entries(
    evidence.generatedFrom?.hostedHandoffBlockedCheckRequiredEvidence ?? {},
  )) {
    const visibleText =
      evidence.adminRoleSurface?.visibleHostedHandoffBlockedCheckStatuses?.[
        checkId
      ];
    if (typeof visibleText !== "string" || !visibleText.includes(expectedText)) {
      throw new Error(
        `hosted concurrent race matrix admin proof missing blocked check evidence: ${checkId}`,
      );
    }
  }
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
  return evidence;
}
