import path from "node:path";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
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
  "replacement-stale-conflict-message",
  "replacement-idempotent-retry",
  "idempotent-retry",
  "action-idempotent-retry",
  "concurrent-action-race",
  "concurrent-action-race-reload",
  "reconnect-recovery",
  "stale-player-vote",
  "concurrent-vote-race",
  "concurrent-vote-race-reload",
  "concurrent-player-vote-resolve-race",
  "concurrent-player-vote-resolve-race-reload",
  "concurrent-player-action-advance-race",
  "concurrent-player-action-advance-race-reload",
  "concurrent-cohost-deadline-resolve-race",
  "concurrent-cohost-deadline-resolve-race-reload",
  "concurrent-replacement-private-post-race",
  "concurrent-replacement-vote-race",
  "concurrent-replacement-action-race",
  "replacement-incoming-action",
  "replacement-action-reconnect",
  "replacement-stale-action-after-resolve",
  "replacement-stale-private-post-after-resolve",
  "replacement-stale-private-post-reconnect",
  "replacement-stale-private-post-after-complete",
  "replacement-stale-private-post-after-complete-reload",
  "stale-host-publish",
  "stale-host-lifecycle",
  "stale-host-modkill",
  "stale-host-prompt",
  "stale-host-prompt-reload",
  "stale-host-complete",
  "stale-host-complete-reload",
  "concurrent-host-complete-race",
  "concurrent-player-complete-race",
  "public-player-complete-reload",
  "stale-player-complete",
  "stale-player-complete-reload",
  "stale-same-action-recovery",
  "stale-dead-action-conflict",
  "stale-action-conflict",
  "stale-action-conflict-message",
  "stale-host-control",
  "concurrent-host-resolve-race",
  "concurrent-host-resolve-race-reload",
  "concurrent-host-advance-race",
  "concurrent-host-deadline-advance-race",
  "concurrent-host-lifecycle-race",
  "concurrent-host-mixed-advance-race",
  "stale-host-resolve",
  "stale-host-resolve-reload",
  "stale-host-advance",
  "stale-host-advance-reload",
  "stale-host-deadline",
  "stale-host-deadline-reload",
  "stale-cohost-deadline",
  "stale-cohost-deadline-reload",
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
  return evidence;
}
