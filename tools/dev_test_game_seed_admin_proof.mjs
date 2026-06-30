import path from "node:path";
import { assertDevTestGameSeedFixtureSummary } from "./dev_test_game_seed_fixture_summary.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const seedFixturePath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY ??
    "target/dev-test-game/seed-fixture-summary.json",
);
const seedFixtureRelativePath = path.relative(repoRoot, seedFixturePath);
const evidencePath = path.join(artifactDir, "seed-admin-proof.json");
const requiredScenarios = [
  "host-phase-controls",
  "cohost-deadline-control",
  "player-vote-recovery",
  "player-action-denied",
  "invalid-action-recovery",
  "resolution-receipt",
  "dead-player-recovery",
  "night-action-loop",
  "action-idempotent-retry",
  "concurrent-action-race",
  "concurrent-player-vote-resolve-race",
  "concurrent-player-action-advance-race",
  "concurrent-cohost-deadline-resolve-race",
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
  "concurrent-host-resolve-race",
  "concurrent-host-advance-race",
  "concurrent-host-deadline-advance-race",
  "concurrent-host-lifecycle-race",
  "concurrent-host-complete-race",
  "concurrent-player-complete-race",
  "public-player-complete-reload",
  "stale-player-complete-reload",
  "concurrent-host-mixed-advance-race",
  "stale-same-action-recovery",
  "host-replacement-console",
  "replacement-host-issued-invite",
  "replacement-pending-player",
  "replacement-redeemed-invite-recovery",
  "replacement-session-revocation-recovery",
  "replacement-session-refresh-recovery",
  "replacement-stale-session-after-refresh",
  "replacement-reconnect-recovery",
  "replacement-stale-conflict-message",
  "replacement-invalid-target-recovery",
  "replacement-idempotent-retry",
  "stale-host-invite-recovery",
  "replacement-stale-success-recovery",
  "replacement-stale-player",
  "replacement-stale-action",
  "replacement-stale-private-channel",
  "replacement-stale-private-receipts",
  "replacement-incoming-player",
  "stale-action-conflict-message",
  "stale-dead-action-conflict",
  "private-channel-member",
  "private-channel-denied",
  "multiplayer-hardening",
  "local-ops-readiness",
];

await runAdminAuditProof({
  smokeName: "dev-test-game-seed-admin-proof",
  stage: "seed-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY: seedFixtureRelativePath,
  },
  loadSource: async () =>
    assertDevTestGameSeedFixtureSummary(await readJson(seedFixturePath)),
  prove: async ({ browser, frontendBaseUrl, source: seedFixture }) =>
    await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: seedFixture.fixture.game,
      auditId: "local-seed-fixtures",
      requiredScenarios,
    }),
  buildEvidence: ({ source: seedFixture, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-seed-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-seed-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over a saved dev-test-game seed/demo fixture summary. Proves the local seed/demo fixture inventory is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted demo data, sanitized demo-data policy, invite delivery, beta readiness, or release readiness.",
    generatedFrom: {
      seedFixtureSummary: seedFixtureRelativePath,
      game: seedFixture.fixture.game,
    },
    adminRoleSurface,
  }),
  assertEvidence: assertSeedAdminProof,
});

export function assertSeedAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-seed-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-seed-admin-surface"
  ) {
    throw new Error("seed admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("seed admin proof did not prove admin overview click-through");
  }
  for (const scenarioId of requiredScenarios) {
    if (!evidence.adminRoleSurface?.visibleScenarios?.includes(scenarioId)) {
      throw new Error(`seed admin proof missing visible scenario: ${scenarioId}`);
    }
  }
  return evidence;
}
