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
  for (const checkId of requiredChecksForEvidence(evidence)) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`next-action admin proof missing visible check: ${checkId}`);
    }
  }
  return evidence;
}

function requiredChecksForNextAction(nextAction) {
  const checks = ["next-command", nextAction.nextAction.reason];
  if (nextAction.nextAction.artifact?.id !== undefined) {
    checks.push(nextAction.nextAction.artifact.id);
  }
  return checks;
}

function requiredChecksForEvidence(evidence) {
  return [
    "next-command",
    evidence.generatedFrom?.reason ?? "unknown",
    ...(typeof evidence.generatedFrom?.artifactId === "string"
      ? [evidence.generatedFrom.artifactId]
      : []),
  ];
}
