export const productionFeatureReadinessSourceKind = Object.freeze({
  spineTargets: "spine-targets",
  identityAdapter: "identity-adapter",
});

export const devTestGameProductionFeatureBrowserProofCommand =
  "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live";
export const devTestGameCoreLoopAdminProofCommand =
  "npm run test:dev-test-game-core-loop-admin-proof";
export const devTestGameHardeningAdminProofCommand =
  "npm run test:dev-test-game-hardening-admin-proof";
export const devTestGameIdentityAdminProofCommand =
  "npm run test:dev-test-game-identity-admin-proof";

export const productionFeatureSourceRegistry = Object.freeze([
  Object.freeze({
    sourceCheckId: "local-core-loop-proof",
    graphSourceNodeId: "admin-proof:core-loop",
    readinessSourceKind: productionFeatureReadinessSourceKind.spineTargets,
    detailRoleUrlIncludes: "/admin/audit/local-core-loop",
    roleUrlIncludes: "/g/",
    rerunCommand: devTestGameCoreLoopAdminProofCommand,
  }),
  Object.freeze({
    sourceCheckId: "local-hardening-proof",
    graphSourceNodeId: "admin-proof:hardening",
    readinessSourceKind: productionFeatureReadinessSourceKind.spineTargets,
    detailRoleUrlIncludes: "/admin/audit/local-hardening",
    roleUrlIncludes: "/g/",
    rerunCommand: devTestGameHardeningAdminProofCommand,
  }),
  Object.freeze({
    sourceCheckId: "local-identity-adapter-proof",
    graphSourceNodeId: "admin-proof:identity",
    readinessSourceKind: productionFeatureReadinessSourceKind.identityAdapter,
    detailRoleUrlIncludes: "/admin/audit/local-identity-adapter",
    roleUrlIncludes: "/admin/audit/local-identity-adapter",
    rerunCommand: devTestGameIdentityAdminProofCommand,
  }),
]);

export const productionFeatureSourceCheckIds = Object.freeze(
  productionFeatureSourceRegistry.map((source) => source.sourceCheckId),
);

export const productionFeatureSourceByCheckId = Object.freeze(
  Object.fromEntries(
    productionFeatureSourceRegistry.map((source) => [
      source.sourceCheckId,
      source,
    ]),
  ),
);

export function productionFeatureSourceForCheckId(sourceCheckId) {
  const source = productionFeatureSourceByCheckId[sourceCheckId];
  if (source === undefined) {
    throw new Error(`unknown production feature source check: ${sourceCheckId}`);
  }
  return source;
}
