import {
  devTestGameHardeningAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";

export const hardeningFeatureSpineSourceCheckId = "local-hardening-proof";
export const hardeningFeatureSpineCycleIds = Object.freeze({
  staleConflict: "hardening-stale-conflict",
});
export const devTestGameHardeningAdminProofCommand =
  "npm run test:dev-test-game-hardening-admin-proof";
export const hardeningFeatureSpineSource = Object.freeze({
  sourceCheckId: hardeningFeatureSpineSourceCheckId,
  graphSourceNodeId: "admin-proof:hardening",
  readinessSourceKind: "spine-targets",
  coverageDecision: Object.freeze({
    kind: "seeded-role-url-proof",
    proofCommand: devTestGameHardeningAdminProofCommand,
  }),
  detailRoleUrlIncludes: "/admin/audit/local-hardening",
  roleUrlIncludes: "/g/",
  proofArtifact: devTestGameHardeningAdminProofPath,
  rerunCommand: devTestGameHardeningAdminProofCommand,
});
