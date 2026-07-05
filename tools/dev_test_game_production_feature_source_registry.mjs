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
import {
  devTestGameHostSetupProofCommand,
  hostSetupFeatureSpineSource,
} from "./dev_test_game_host_setup_feature_spine_targets.mjs";
import {
  cohostFeatureSpineSource,
  devTestGameCohostConsoleProofCommand,
} from "./dev_test_game_cohost_feature_spine_targets.mjs";
import {
  devTestGameReplacementPlayerProofCommand,
  replacementFeatureSpineSource,
} from "./dev_test_game_replacement_feature_spine_targets.mjs";
import {
  devTestGameReplacementActionProofCommand,
  replacementActionFeatureSpineSource,
} from "./dev_test_game_replacement_action_feature_spine_targets.mjs";
import {
  devTestGameReplacementPrivateProofCommand,
  replacementPrivateFeatureSpineSource,
} from "./dev_test_game_replacement_private_feature_spine_targets.mjs";

export const productionFeatureReadinessSourceKind = Object.freeze({
  spineTargets: "spine-targets",
  identityAdapter: "identity-adapter",
});

export const devTestGameProductionFeatureBrowserProofCommand =
  "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-core-live";
export {
  devTestGameCoreLoopAdminProofCommand,
  devTestGameCohostConsoleProofCommand,
  devTestGameHardeningAdminProofCommand,
  devTestGameHostSetupProofCommand,
  devTestGameIdentityAdminProofCommand,
  devTestGameReplacementActionProofCommand,
  devTestGameReplacementPlayerProofCommand,
  devTestGameReplacementPrivateProofCommand,
};

export const productionFeatureSourceRegistry = Object.freeze([
  coreLoopFeatureSpineSource,
  hostSetupFeatureSpineSource,
  cohostFeatureSpineSource,
  replacementFeatureSpineSource,
  replacementActionFeatureSpineSource,
  replacementPrivateFeatureSpineSource,
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
