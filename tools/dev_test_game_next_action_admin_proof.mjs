import path from "node:path";
import { assertDevTestGameNextAction } from "./dev_test_game_next_action.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const nextActionPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_NEXT_ACTION ??
    "target/dev-test-game/next-action.json",
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? "target/dev-test-game/proof-run.json",
);
const nextActionRelativePath = path.relative(repoRoot, nextActionPath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(artifactDir, "next-action-admin-proof.json");

await runAdminAuditProof({
  smokeName: "dev-test-game-next-action-admin-proof",
  stage: "next-action-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_NEXT_ACTION: nextActionRelativePath,
  },
  loadSource: async () => ({
    nextAction: assertDevTestGameNextAction(await readJson(nextActionPath)),
    proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
  }),
  prove: async ({ browser, frontendBaseUrl, source }) =>
    await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: source.proofRun.session.game,
      auditId: "local-next-action",
      requiredChecks: requiredChecksForNextAction(source.nextAction),
      requiredRelatedLinks: requiredRelatedLinksForNextAction(source.nextAction),
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
      game: source.proofRun.session.game,
      command: source.nextAction.nextAction.command,
      reason: source.nextAction.nextAction.reason,
      actionStatus: source.nextAction.nextAction.status,
      artifactId: source.nextAction.nextAction.artifact?.id ?? null,
      unprovenId: source.nextAction.nextAction.unproven?.id ?? null,
      unprovenRoleUrl: source.nextAction.nextAction.unproven?.roleUrl ?? null,
      unprovenProofGraphNodeId:
        source.nextAction.nextAction.unproven?.proofGraphNodeId ?? null,
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
      stabilityTrace: {
        strategy: source.nextAction.stabilityTrace.strategy,
        status: source.nextAction.stabilityTrace.status,
        selected: source.nextAction.stabilityTrace.selected,
        retryClickCount: source.nextAction.stabilityTrace.retryClickCount,
        domFallbackCount: source.nextAction.stabilityTrace.domFallbackCount,
        forceFallbackCount: source.nextAction.stabilityTrace.forceFallbackCount,
        failureCount: source.nextAction.stabilityTrace.failureCount,
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
});

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
    evidence.generatedFrom?.stabilityTrace?.strategy !==
      "proof-stability-before-readiness" ||
    !["clean", "drifted"].includes(evidence.generatedFrom.stabilityTrace.status) ||
    typeof evidence.generatedFrom.stabilityTrace.selected !== "boolean"
  ) {
    throw new Error("next-action admin proof is missing stability trace evidence");
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
    !Array.isArray(evidence.generatedFrom.staleConflictMessageTrace.laneIds)
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
  return evidence;
}

function requiredChecksForNextAction(nextAction) {
  const checks = ["next-command", nextAction.nextAction.reason, "selection-trace"];
  if (nextAction.nextAction.artifact?.id !== undefined) {
    checks.push(nextAction.nextAction.artifact.id);
  }
  if (nextAction.nextAction.unproven?.id !== undefined) {
    checks.push(
      nextAction.nextAction.unproven.id,
      "release-readiness-selection-trace",
    );
  }
  if (nextAction.nextAction.stability?.source !== undefined) {
    checks.push("proof-stability-drift");
  }
  for (const candidate of nextAction.selectionTrace.candidates) {
    checks.push(`selection-trace-${candidate.id}`);
  }
  for (const candidate of nextAction.releaseReadinessTrace.candidates) {
    checks.push(`release-readiness-${candidate.id}`);
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
  for (const laneId of nextAction.staleConflictMessageTrace.laneIds) {
    checks.push(`stale-conflict-message-${laneId}`);
  }
  checks.push("host-stale-control-milestone");
  for (const laneId of nextAction.hostStaleControlTrace.laneIds) {
    checks.push(`host-stale-control-${laneId}`);
  }
  return checks;
}

function requiredRelatedLinksForNextAction(nextAction) {
  const proofGraphNodeId = nextAction.nextAction.unproven?.proofGraphNodeId;
  return typeof proofGraphNodeId === "string" && proofGraphNodeId.trim() !== ""
    ? [proofGraphNodeId]
    : [];
}

function requiredChecksForEvidence(evidence) {
  return [
    "next-command",
    evidence.generatedFrom?.reason ?? "unknown",
    "selection-trace",
    ...(typeof evidence.generatedFrom?.artifactId === "string"
      ? [evidence.generatedFrom.artifactId]
      : []),
    ...(typeof evidence.generatedFrom?.unprovenId === "string"
      ? [evidence.generatedFrom.unprovenId, "release-readiness-selection-trace"]
      : []),
    ...(evidence.generatedFrom?.stabilityStatus === "drifted"
      ? ["proof-stability-drift"]
      : []),
    ...(Array.isArray(evidence.generatedFrom?.selectionTrace?.candidateIds)
      ? evidence.generatedFrom.selectionTrace.candidateIds.map((id) => `selection-trace-${id}`)
      : []),
    ...(Array.isArray(evidence.generatedFrom?.releaseReadinessTrace?.candidateIds)
      ? evidence.generatedFrom.releaseReadinessTrace.candidateIds.map(
          (id) => `release-readiness-${id}`,
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
    ...(Array.isArray(evidence.generatedFrom?.staleConflictMessageTrace?.laneIds)
      ? evidence.generatedFrom.staleConflictMessageTrace.laneIds.map(
          (id) => `stale-conflict-message-${id}`,
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
