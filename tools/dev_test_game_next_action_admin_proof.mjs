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
  for (const checkId of requiredChecksForEvidence(evidence)) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`next-action admin proof missing visible check: ${checkId}`);
    }
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
  return checks;
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
  ];
}
