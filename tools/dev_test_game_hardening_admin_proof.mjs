import path from "node:path";
import { hardeningHighlightedLaneEvidence } from "../frontend/src/lib/app/local-proof-lane-status.mjs";
import {
  completedGameHardeningLaneIds,
} from "./dev_test_game_core_loop_completed_recovery_cases.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  cohostDeadlineRecoveryLaneIds,
  hostGenericStaleControlLaneIds,
  hostPhaseStaleRecoveryLaneIds,
  hostPromptStaleControlLaneIds,
  hostRaceReloadLaneIds,
  hostStandaloneStaleControlLaneIds,
  playerActionConflictRecoveryLaneIds,
  playerActionFoundationLaneIds,
  promotedStalePlayerCommandLaneIds,
  staleConflictMessageLaneIds,
} from "./dev_test_game_hardening_lane_cases.mjs";
import {
  replacementPrivatePostRaceLaneIds,
  replacementPrivatePostRecoveryLaneIds,
} from "./dev_test_game_replacement_private_scenarios.mjs";
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
const requiredChecks = [
  "replacement-redeemed-invite-recovery",
  "replacement-session-revocation-recovery",
  "replacement-session-refresh-recovery",
  "replacement-stale-session-after-refresh",
  "replacement-reconnect-recovery",
  ...staleConflictMessageLaneIds,
  "replacement-idempotent-retry",
  ...playerActionFoundationLaneIds,
  ...promotedStalePlayerCommandLaneIds,
  "concurrent-vote-race",
  "concurrent-vote-race-reload",
  "concurrent-player-vote-resolve-race",
  "concurrent-player-vote-resolve-race-reload",
  "concurrent-player-action-advance-race",
  "concurrent-player-action-advance-race-reload",
  "concurrent-cohost-deadline-resolve-race",
  "concurrent-cohost-deadline-resolve-race-reload",
  ...replacementPrivatePostRaceLaneIds,
  "concurrent-replacement-vote-race",
  "concurrent-replacement-vote-race-reload",
  "concurrent-replacement-action-race",
  "concurrent-replacement-action-race-reload",
  "replacement-incoming-action",
  "replacement-action-reconnect",
  "replacement-stale-action-after-resolve",
  ...replacementPrivatePostRecoveryLaneIds,
  "concurrent-host-publish-race",
  "concurrent-host-publish-race-reload",
  ...hostStandaloneStaleControlLaneIds,
  "concurrent-host-lifecycle-race",
  "concurrent-host-lifecycle-race-reload",
  ...hostPromptStaleControlLaneIds,
  ...completedGameHardeningLaneIds(),
  ...playerActionConflictRecoveryLaneIds,
  ...hostGenericStaleControlLaneIds,
  ...hostRaceReloadLaneIds,
  ...hostPhaseStaleRecoveryLaneIds,
  "stale-cohost-deadline",
  ...cohostDeadlineRecoveryLaneIds,
];

await runAdminAuditProof({
  smokeName: "dev-test-game-hardening-admin-proof",
  stage: "hardening-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_PROOF_RUN: proofRunRelativePath,
  },
  loadSource: async () => assertDevTestGameProofRun(await readJson(proofRunPath)),
  prove: async ({ browser, frontendBaseUrl, source: proofRun }) =>
    await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: proofRun.session.game,
      auditId: "local-hardening",
      requiredChecks,
      requiredCheckStatuses: hardeningHighlightedLaneEvidence(proofRun),
    }),
  buildEvidence: ({ source: proofRun, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-hardening-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hardening-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game multiplayer-hardening proof-run lanes. Proves the saved local hardening evidence is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove exhaustive race coverage, hosted reconnect behavior, multi-node concurrency, beta readiness, or production readiness.",
    generatedFrom: {
      proofRun: proofRunRelativePath,
      game: proofRun.session.game,
      highlightedLaneEvidence: hardeningHighlightedLaneEvidence(proofRun),
    },
    adminRoleSurface,
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
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
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
  return evidence;
}
