import {
  devTestGameIdentityAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";

export const identityFeatureSpineSourceCheckId =
  "local-identity-adapter-proof";
export const devTestGameIdentityAdminProofCommand =
  "npm run test:dev-test-game-identity-admin-proof";
export const identityFeatureSpineSource = Object.freeze({
  sourceCheckId: identityFeatureSpineSourceCheckId,
  graphSourceNodeId: "admin-proof:identity",
  readinessSourceKind: "identity-adapter",
  coverageDecision: Object.freeze({
    kind: "seeded-admin-proof",
    proofCommand: devTestGameIdentityAdminProofCommand,
  }),
  detailRoleUrlIncludes: "/admin/audit/local-identity-adapter",
  roleUrlIncludes: "/admin/audit/local-identity-adapter",
  proofArtifact: devTestGameIdentityAdminProofPath,
  rerunCommand: devTestGameIdentityAdminProofCommand,
});

export const identityFeatureSpineTargetRows = Object.freeze({
  identityAdapter: Object.freeze({
    featureSlotId: "identity-adapter",
    sourceCheckId: identityFeatureSpineSourceCheckId,
    cycleId: "identity-adapter",
    roleUrlId: "local-identity-adapter",
    checkpointId: "account-login",
    adminCheckId: "account-login",
  }),
});
