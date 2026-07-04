import path from "node:path";
import { hardeningHighlightedLaneEvidence } from "../frontend/src/lib/app/local-proof-lane-status.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  playerRecoveryAuditLaneIds,
} from "./dev_test_game_player_recovery_scenarios.mjs";
import {
  hardeningAuditLaneIds,
} from "./dev_test_game_hardening_scenarios.mjs";
import {
  hostStaleControlLaneIds,
} from "./dev_test_game_host_stale_recovery_scenarios.mjs";
import {
  hardeningRecoveryAuditLaneIds,
  staleConflictMessageLaneIds,
} from "./dev_test_game_hardening_recovery_scenarios.mjs";
import {
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    "target/dev-test-game/proof-run.json",
);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(artifactDir, "hardening-admin-proof.json");
const requiredChecks = hardeningAuditLaneIds;

await runAdminAuditProof({
  smokeName: "dev-test-game-hardening-admin-proof",
  stage: "hardening-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_PROOF_RUN: proofRunRelativePath,
  },
  loadSource: async () => assertDevTestGameProofRun(await readJson(proofRunPath)),
  prove: async ({ browser, frontendBaseUrl, source: proofRun }) => {
    const highlightedLaneEvidence = hardeningHighlightedLaneEvidence(proofRun);
    const playerRecoveryHighlightedLaneEvidence = Object.fromEntries(
      playerRecoveryAuditLaneIds
        .filter((id) => highlightedLaneEvidence[id] !== undefined)
        .map((id) => [id, highlightedLaneEvidence[id]]),
    );
    const adminRoleSurface = await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: proofRun.session.game,
      auditId: localAdminAuditIds.hardening,
      requiredChecks,
      requiredCheckStatuses: highlightedLaneEvidence,
    });
    const playerRecoveryRoleSurface = await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: proofRun.session.game,
      auditId: localAdminAuditIds.playerRecovery,
      requiredChecks: playerRecoveryAuditLaneIds,
      requiredCheckStatuses: playerRecoveryHighlightedLaneEvidence,
      requiredRelatedLinks: [
        localAdminAuditIds.coreLoop,
        localAdminAuditIds.hardening,
      ],
    });
    return { adminRoleSurface, playerRecoveryRoleSurface };
  },
  buildEvidence: ({ source: proofRun, adminRoleSurface: surfaces }) => ({
    version: 1,
    proof: "dev-test-game-hardening-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hardening-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game multiplayer-hardening proof-run lanes. Proves the saved local hardening evidence and focused player-recovery matrix are discoverable from the seeded admin overview and inspectable in native admin audit detail routes; it does not prove exhaustive race coverage, hosted reconnect behavior, multi-node concurrency, beta readiness, or production readiness.",
    generatedFrom: {
      proofRun: proofRunRelativePath,
      game: proofRun.session.game,
      highlightedLaneEvidence: hardeningHighlightedLaneEvidence(proofRun),
      hostStaleControlLaneIds: [...hostStaleControlLaneIds],
      hardeningRecoveryAuditLaneIds: [...hardeningRecoveryAuditLaneIds],
      staleConflictMessageLaneIds: [...staleConflictMessageLaneIds],
    },
    adminRoleSurface: surfaces.adminRoleSurface,
    playerRecoveryRoleSurface: surfaces.playerRecoveryRoleSurface,
  }),
  assertEvidence: assertHardeningAdminProof,
});

export function assertHardeningAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-hardening-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-hardening-admin-surface"
  ) {
    throw new Error("hardening admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false ||
    evidence.playerRecoveryRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.playerRecoveryRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("hardening admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`hardening admin proof missing visible check: ${checkId}`);
    }
  }
  for (const [checkId, expectedStatus] of Object.entries(
    evidence.generatedFrom?.highlightedLaneEvidence ?? {},
  )) {
    if (
      expectedStatus !== "" &&
      !evidence.adminRoleSurface?.visibleCheckStatuses?.[checkId]?.includes(
        expectedStatus,
      )
    ) {
      throw new Error(
        `hardening admin proof missing visible status for ${checkId}: ${expectedStatus}`,
      );
    }
  }
  for (const checkId of playerRecoveryAuditLaneIds) {
    if (!evidence.playerRecoveryRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`player recovery admin proof missing visible check: ${checkId}`);
    }
  }
  for (const relatedLinkId of [
    localAdminAuditIds.coreLoop,
    localAdminAuditIds.hardening,
  ]) {
    if (
      !evidence.playerRecoveryRoleSurface?.visibleRelatedLinks?.includes(relatedLinkId)
    ) {
      throw new Error(
        `player recovery admin proof missing related link: ${relatedLinkId}`,
      );
    }
  }
  return evidence;
}
