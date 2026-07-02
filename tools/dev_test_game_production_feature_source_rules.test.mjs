import assert from "node:assert/strict";
import { test } from "node:test";
import {
  featureSpineSourceCheckIds,
} from "./dev_test_game_feature_spine_targets.mjs";
import {
  productionFeatureGraphSourceNodeIdsByCheckId,
} from "./dev_test_game_production_feature_graph_sources.mjs";
import {
  defaultProductionFeatureSpineRerunCommands,
  devTestGameCoreLoopAdminProofCommand,
  devTestGameHardeningAdminProofCommand,
  devTestGameIdentityAdminProofCommand,
  devTestGameProductionFeatureBrowserProofCommand,
  productionFeatureSpineSourceCheckRules,
} from "./dev_test_game_production_feature_source_rules.mjs";

test("production feature source rules cover every feature spine source", () => {
  assert.deepEqual(
    Object.keys(productionFeatureSpineSourceCheckRules),
    featureSpineSourceCheckIds,
  );
  assert.deepEqual(
    Object.keys(productionFeatureSpineSourceCheckRules),
    Object.keys(productionFeatureGraphSourceNodeIdsByCheckId),
  );
  assert.deepEqual(defaultProductionFeatureSpineRerunCommands, {
    "local-core-loop-proof": devTestGameCoreLoopAdminProofCommand,
    "local-hardening-proof": devTestGameHardeningAdminProofCommand,
    "local-identity-adapter-proof": devTestGameIdentityAdminProofCommand,
  });
  assert.ok(
    devTestGameProductionFeatureBrowserProofCommand.includes(
      "test:dev-test-game-live",
    ),
  );
});
