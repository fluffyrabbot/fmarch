import {
  productionFeatureSourceRegistry,
} from "./dev_test_game_production_feature_source_registry.mjs";

export {
  devTestGameCohostConsoleProofCommand,
  devTestGameCoreLoopAdminProofCommand,
  devTestGameHardeningAdminProofCommand,
  devTestGameHostSetupProofCommand,
  devTestGameIdentityAdminProofCommand,
  devTestGameProductionFeatureBrowserProofCommand,
  devTestGameReplacementPlayerProofCommand,
} from "./dev_test_game_production_feature_source_registry.mjs";

export const productionFeatureSpineSourceCheckRules = Object.freeze(
  Object.fromEntries(
    productionFeatureSourceRegistry.map((source) => [
      source.sourceCheckId,
      Object.freeze({
        detailRoleUrlIncludes: source.detailRoleUrlIncludes,
        roleUrlIncludes: source.roleUrlIncludes,
        rerunCommand: source.rerunCommand,
      }),
    ]),
  ),
);

export const defaultProductionFeatureSpineRerunCommands = Object.freeze(
  Object.fromEntries(
    Object.entries(productionFeatureSpineSourceCheckRules).map(
      ([sourceCheckId, rule]) => [sourceCheckId, rule.rerunCommand],
    ),
  ),
);
