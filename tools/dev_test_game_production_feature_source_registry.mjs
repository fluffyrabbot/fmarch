import {
  coreLoopFeatureSpineSource,
  devTestGameCoreLoopAdminProofCommand,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  devTestGameHardeningAdminProofCommand,
  hardeningFeatureSpineSource,
} from "./dev_test_game_hardening_feature_spine_targets.mjs";
import {
  devTestGameIdentityAdminProofCommand,
  identityFeatureSpineSource,
} from "./dev_test_game_identity_feature_spine_targets.mjs";

export const productionFeatureReadinessSourceKind = Object.freeze({
  spineTargets: "spine-targets",
  identityAdapter: "identity-adapter",
});

export const devTestGameProductionFeatureBrowserProofCommand =
  "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-core-live";
export {
  devTestGameCoreLoopAdminProofCommand,
  devTestGameHardeningAdminProofCommand,
  devTestGameIdentityAdminProofCommand,
};

export const productionFeatureSourceRegistry = Object.freeze([
  coreLoopFeatureSpineSource,
  hardeningFeatureSpineSource,
  identityFeatureSpineSource,
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
