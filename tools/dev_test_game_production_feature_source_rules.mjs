export const devTestGameProductionFeatureBrowserProofCommand =
  "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live";
export const devTestGameCoreLoopAdminProofCommand =
  "npm run test:dev-test-game-core-loop-admin-proof";
export const devTestGameHardeningAdminProofCommand =
  "npm run test:dev-test-game-hardening-admin-proof";
export const devTestGameIdentityAdminProofCommand =
  "npm run test:dev-test-game-identity-admin-proof";

export const productionFeatureSpineSourceCheckRules = Object.freeze({
  "local-core-loop-proof": Object.freeze({
    detailRoleUrlIncludes: "/admin/audit/local-core-loop",
    roleUrlIncludes: "/g/",
    rerunCommand: devTestGameCoreLoopAdminProofCommand,
  }),
  "local-hardening-proof": Object.freeze({
    detailRoleUrlIncludes: "/admin/audit/local-hardening",
    roleUrlIncludes: "/g/",
    rerunCommand: devTestGameHardeningAdminProofCommand,
  }),
  "local-identity-adapter-proof": Object.freeze({
    detailRoleUrlIncludes: "/admin/audit/local-identity-adapter",
    roleUrlIncludes: "/admin/audit/local-identity-adapter",
    rerunCommand: devTestGameIdentityAdminProofCommand,
  }),
});

export const defaultProductionFeatureSpineRerunCommands = Object.freeze(
  Object.fromEntries(
    Object.entries(productionFeatureSpineSourceCheckRules).map(
      ([sourceCheckId, rule]) => [sourceCheckId, rule.rerunCommand],
    ),
  ),
);
