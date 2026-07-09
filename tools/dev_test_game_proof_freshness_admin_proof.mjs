import path from "node:path";
import { pathToFileURL } from "node:url";
import { readLocalProofFreshness } from "../frontend/src/lib/server/local-ops-artifacts.mjs";
import { assertDevTestGameNextAction } from "./dev_test_game_next_action.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";
import {
  localAdminAuditHandoffCheckIds,
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGameProofRunPath,
  nextActionPath as defaultNextActionPath,
  proofFreshnessAdminProofPath,
} from "./dev_test_game_spine_artifact_paths.mjs";

const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? devTestGameProofRunPath,
);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const nextActionPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_NEXT_ACTION ??
    defaultNextActionPath,
);
const nextActionRelativePath = path.relative(repoRoot, nextActionPath);
const evidencePath = path.join(repoRoot, proofFreshnessAdminProofPath);

export function proofFreshnessAdminProofCase() {
  return {
    smokeName: "dev-test-game-proof-freshness-admin-proof",
    stage: "proof-freshness-admin-proof-listen",
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_NEXT_ACTION: nextActionRelativePath,
    },
    loadSource: async () => ({
      freshness: assertProofFreshness(await readLocalProofFreshness()),
      proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
      nextAction: assertDevTestGameNextAction(await readJson(nextActionPath)),
    }),
    prove: async ({ browser, frontendBaseUrl, source }) =>
      await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: source.proofRun.session.game,
        auditId: localAdminAuditIds.proofFreshness,
        requiredChecks: [
          ...source.freshness.artifacts.map((artifact) => artifact.id),
          localAdminAuditHandoffCheckIds.nextAction,
          ...(source.nextAction.nextAction.reason ===
          "proof-graph-destination-summary-drift"
            ? [
                `next-action-${source.nextAction.nextAction.reason}`,
                "next-action-proof-graph-destination-summary",
              ]
            : []),
        ],
        requiredCheckStatuses: Object.fromEntries([
          ...source.freshness.artifacts.map((artifact) => [
            artifact.id,
            artifact.status,
          ]),
          [
            localAdminAuditHandoffCheckIds.nextAction,
            source.nextAction.nextAction.status,
          ],
          ...(source.nextAction.nextAction.reason ===
          "proof-graph-destination-summary-drift"
            ? [
                [
                  `next-action-${source.nextAction.nextAction.reason}`,
                  source.nextAction.nextAction.status,
                ],
                [
                  "next-action-proof-graph-destination-summary",
                  String(
                    source.nextAction.nextAction.proofGraphDestinationSummary
                      ?.summaryStatus ?? "",
                  ),
                ],
              ]
            : []),
        ]),
        requiredRelatedLinks: [localAdminAuditIds.nextAction],
      }),
    buildEvidence: ({ source, adminRoleSurface }) => ({
      version: 1,
      proof: "dev-test-game-proof-freshness-admin-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: "local-dev-test-game-proof-freshness-admin-surface",
      proofBoundary:
        "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game proof freshness dashboard. Proves required local-spine artifacts are fresh and optional real-hosted handoff freshness remains visible as diagnostic evidence from the seeded admin overview and native audit detail route; it does not validate artifact contents, hosted operations, beta readiness, release readiness, or production readiness.",
      generatedFrom: {
        proofRun: proofRunRelativePath,
        nextAction: nextActionRelativePath,
        game: source.proofRun.session.game,
        artifactIds: source.freshness.artifacts.map((artifact) => artifact.id),
        maxAgeHours: source.freshness.maxAgeHours,
        nextActionCommand: source.nextAction.nextAction.command,
        nextActionStatus: source.nextAction.nextAction.status,
        nextActionReason: source.nextAction.nextAction.reason,
        nextActionProofGraphDestinationSummary:
          source.nextAction.nextAction.proofGraphDestinationSummary ?? null,
      },
      adminRoleSurface,
    }),
    assertEvidence: assertProofFreshnessAdminProof,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(proofFreshnessAdminProofCase());
}

function assertProofFreshness(freshness) {
  if (
    freshness?.version !== 1 ||
    freshness.proof !== "dev-test-game-proof-freshness" ||
    freshness.scope !== "local-dev-test-game-proof-freshness" ||
    freshness.status !== "passed" ||
    freshness.releaseReady !== false ||
    freshness.productionReady !== false
  ) {
    throw new Error("proof freshness source must be fresh and local-only");
  }
  for (const artifact of freshness.artifacts ?? []) {
    if (
      artifact.requiredForLocalSpine !== false &&
      artifact.status !== "fresh"
    ) {
      throw new Error(`proof freshness artifact ${artifact.id} is ${artifact.status}`);
    }
  }
  return freshness;
}

export function assertProofFreshnessAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-proof-freshness-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-proof-freshness-admin-surface"
  ) {
    throw new Error("proof freshness admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("proof freshness admin proof did not prove admin overview click-through");
  }
  if (
    typeof evidence.generatedFrom?.nextActionCommand !== "string" ||
    evidence.generatedFrom.nextActionCommand.trim() === "" ||
    !evidence.adminRoleSurface?.visibleRelatedLinks?.includes(
      localAdminAuditIds.nextAction,
    )
  ) {
    throw new Error("proof freshness admin proof did not prove next-action handoff");
  }
  if (
    !evidence.adminRoleSurface?.visibleChecks?.includes(
      localAdminAuditHandoffCheckIds.nextAction,
    )
  ) {
    throw new Error("proof freshness admin proof missing next-action handoff check");
  }
  if (
    evidence.generatedFrom?.nextActionReason ===
      "proof-graph-destination-summary-drift" &&
    (!evidence.adminRoleSurface?.visibleChecks?.includes(
      `next-action-${evidence.generatedFrom.nextActionReason}`,
    ) ||
      !evidence.adminRoleSurface?.visibleChecks?.includes(
        "next-action-proof-graph-destination-summary",
      ) ||
      evidence.generatedFrom.nextActionProofGraphDestinationSummary === null)
  ) {
    throw new Error(
      "proof freshness admin proof missing proof graph destination-summary handoff row",
    );
  }
  for (const id of evidence.generatedFrom?.artifactIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(id)) {
      throw new Error(`proof freshness admin proof missing visible artifact: ${id}`);
    }
  }
  return evidence;
}
