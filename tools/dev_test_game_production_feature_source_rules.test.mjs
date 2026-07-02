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
import {
  productionFeatureReadinessSourceKind,
  productionFeatureSourceRegistry,
} from "./dev_test_game_production_feature_source_registry.mjs";
import {
  coreLoopFeatureSpineSource,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  hardeningFeatureSpineSource,
} from "./dev_test_game_hardening_feature_spine_targets.mjs";
import {
  identityFeatureSpineSource,
} from "./dev_test_game_identity_feature_spine_targets.mjs";

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
  assert.deepEqual(productionFeatureSourceRegistry, [
    coreLoopFeatureSpineSource,
    hardeningFeatureSpineSource,
    identityFeatureSpineSource,
  ]);
  assert.deepEqual(
    productionFeatureSourceRegistry.map((source) => [
      source.sourceCheckId,
      source.readinessSourceKind,
    ]),
    [
      [
        "local-core-loop-proof",
        productionFeatureReadinessSourceKind.spineTargets,
      ],
      [
        "local-hardening-proof",
        productionFeatureReadinessSourceKind.spineTargets,
      ],
      [
        "local-identity-adapter-proof",
        productionFeatureReadinessSourceKind.identityAdapter,
      ],
    ],
  );
  assert.ok(
    devTestGameProductionFeatureBrowserProofCommand.includes(
      "test:dev-test-game-live",
    ),
  );
});
