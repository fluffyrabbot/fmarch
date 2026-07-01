import path from "node:path";
import { validateDevTestGameIdentityAdapterProof } from "./dev_test_game_release_readiness.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const identityProofPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF ??
    "target/auth-invite-role-proof/invite-role-proof.json",
);
const identityProofRelativePath = path.relative(repoRoot, identityProofPath);
const evidencePath = path.join(artifactDir, "identity-admin-proof.json");
const requiredChecks = [
  "account-login",
  "session-rotation",
  "session-revocation",
  "invite-revocation",
  "host-scoped-invite-issuance",
  "audit-trail",
  "admin-audit-surface",
];
const requiredSessions = ["admin", "host", "player"];

await runAdminAuditProof({
  smokeName: "dev-test-game-identity-admin-proof",
  stage: "identity-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_IDENTITY_ADAPTER_PROOF: identityProofRelativePath,
  },
  loadSource: async () => {
    const identityProof = await readJson(identityProofPath);
    validateDevTestGameIdentityAdapterProof(identityProof, {
      path: identityProofRelativePath,
    });
    return identityProof;
  },
  prove: async ({ browser, frontendBaseUrl, source: identityProof }) =>
    await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: identityProof.game,
      auditId: "local-identity-adapter",
      requiredChecks,
      requiredSessions,
      forbiddenText: inviteTokens(identityProof),
    }),
  buildEvidence: ({ source: identityProof, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-identity-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-identity-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the auth invite-role identity adapter proof. Proves the saved local identity-adapter evidence is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with role surfaces and lifecycle checks visible; it does not prove hosted accounts, invite delivery, account recovery, abuse controls, hosted audit retention/export, beta readiness, or production readiness.",
    generatedFrom: {
      identityAdapterProof: identityProofRelativePath,
      game: identityProof.game,
    },
    adminRoleSurface,
  }),
  assertEvidence: assertIdentityAdminProof,
});

export function assertIdentityAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-identity-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-identity-admin-surface"
  ) {
    throw new Error("identity admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("identity admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`identity admin proof missing visible check: ${checkId}`);
    }
  }
  for (const sessionRole of requiredSessions) {
    if (!evidence.adminRoleSurface?.visibleSessions?.includes(sessionRole)) {
      throw new Error(`identity admin proof missing visible session: ${sessionRole}`);
    }
  }
  return evidence;
}

function inviteTokens(identityProof) {
  return Object.values(identityProof.roles ?? {})
    .map((entry) => new URL(entry.loginUrl).searchParams.get("invite"))
    .filter((invite) => invite !== null);
}
