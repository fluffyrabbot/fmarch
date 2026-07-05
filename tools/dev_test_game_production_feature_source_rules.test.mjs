import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  devTestGameCohostConsoleProofCommand,
  devTestGameHardeningAdminProofCommand,
  devTestGameHostSetupProofCommand,
  devTestGameIdentityAdminProofCommand,
  devTestGameProductionFeatureBrowserProofCommand,
  devTestGameReplacementActionProofCommand,
  devTestGameReplacementPlayerProofCommand,
  devTestGameReplacementPrivateProofCommand,
  productionFeatureSpineSourceCheckRules,
} from "./dev_test_game_production_feature_source_rules.mjs";
import {
  productionFeatureReadinessSourceKind,
  productionFeatureRoleSurfaceSources,
  productionFeatureRoleSurfaceSourceCheckIds,
  productionFeatureSourceRegistry,
} from "./dev_test_game_production_feature_source_registry.mjs";
import {
  coreLoopFeatureSpineSource,
  coreLoopFeatureSpineSourceCheckId,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  hardeningFeatureSpineSource,
  hardeningFeatureSpineSourceCheckId,
} from "./dev_test_game_hardening_feature_spine_targets.mjs";
import {
  identityFeatureSpineSource,
  identityFeatureSpineSourceCheckId,
} from "./dev_test_game_identity_feature_spine_targets.mjs";
import {
  cohostFeatureSpineSource,
  cohostFeatureSpineSourceCheckId,
} from "./dev_test_game_cohost_feature_spine_targets.mjs";
import {
  hostSetupFeatureSpineSource,
  hostSetupFeatureSpineSourceCheckId,
} from "./dev_test_game_host_setup_feature_spine_targets.mjs";
import {
  replacementFeatureSpineSource,
  replacementFeatureSpineSourceCheckId,
} from "./dev_test_game_replacement_feature_spine_targets.mjs";
import {
  replacementActionFeatureSpineSource,
  replacementActionFeatureSpineSourceCheckId,
} from "./dev_test_game_replacement_action_feature_spine_targets.mjs";
import {
  replacementPrivateFeatureSpineSource,
  replacementPrivateFeatureSpineSourceCheckId,
} from "./dev_test_game_replacement_private_feature_spine_targets.mjs";

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
    [coreLoopFeatureSpineSourceCheckId]: devTestGameCoreLoopAdminProofCommand,
    [hostSetupFeatureSpineSourceCheckId]: devTestGameHostSetupProofCommand,
    [cohostFeatureSpineSourceCheckId]: devTestGameCohostConsoleProofCommand,
    [replacementFeatureSpineSourceCheckId]:
      devTestGameReplacementPlayerProofCommand,
    [replacementActionFeatureSpineSourceCheckId]:
      devTestGameReplacementActionProofCommand,
    [replacementPrivateFeatureSpineSourceCheckId]:
      devTestGameReplacementPrivateProofCommand,
    [hardeningFeatureSpineSourceCheckId]: devTestGameHardeningAdminProofCommand,
    [identityFeatureSpineSourceCheckId]: devTestGameIdentityAdminProofCommand,
  });
  assert.deepEqual(productionFeatureSourceRegistry, [
    coreLoopFeatureSpineSource,
    hostSetupFeatureSpineSource,
    cohostFeatureSpineSource,
    replacementFeatureSpineSource,
    replacementActionFeatureSpineSource,
    replacementPrivateFeatureSpineSource,
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
        coreLoopFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.spineTargets,
      ],
      [
        hostSetupFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.spineTargets,
      ],
      [
        cohostFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.spineTargets,
      ],
      [
        replacementFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.spineTargets,
      ],
      [
        replacementActionFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.spineTargets,
      ],
      [
        replacementPrivateFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.spineTargets,
      ],
      [
        hardeningFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.spineTargets,
      ],
      [
        identityFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.identityAdapter,
      ],
    ],
  );
  assert.ok(
    devTestGameProductionFeatureBrowserProofCommand.includes(
      "test:dev-test-game-core-live",
    ),
  );
  assert.deepEqual(productionFeatureRoleSurfaceSources, [
    hostSetupFeatureSpineSource,
    cohostFeatureSpineSource,
    replacementFeatureSpineSource,
    replacementActionFeatureSpineSource,
    replacementPrivateFeatureSpineSource,
  ]);
  assert.deepEqual(productionFeatureRoleSurfaceSourceCheckIds, [
    hostSetupFeatureSpineSourceCheckId,
    cohostFeatureSpineSourceCheckId,
    replacementFeatureSpineSourceCheckId,
    replacementActionFeatureSpineSourceCheckId,
    replacementPrivateFeatureSpineSourceCheckId,
  ]);
  assert.deepEqual(
    productionFeatureRoleSurfaceSources.map((source) => source.graphSourceNodeId),
    [
      "role-surface:host-setup",
      "role-surface:cohost-console",
      "role-surface:replacement-player",
      "role-surface:replacement-action",
      "role-surface:replacement-private-channel",
    ],
  );
});

test("production feature builders use source modules instead of raw source ids", async () => {
  const sourceIdLiterals = [
    coreLoopFeatureSpineSourceCheckId,
    hostSetupFeatureSpineSourceCheckId,
    cohostFeatureSpineSourceCheckId,
    replacementFeatureSpineSourceCheckId,
    replacementActionFeatureSpineSourceCheckId,
    replacementPrivateFeatureSpineSourceCheckId,
    hardeningFeatureSpineSourceCheckId,
    identityFeatureSpineSourceCheckId,
  ];
  for (const sourceFile of [
    "dev_test_game_release_readiness.mjs",
    "dev_test_game_proof_graph.mjs",
  ]) {
    const source = await readFile(new URL(sourceFile, import.meta.url), "utf8");
    for (const sourceId of sourceIdLiterals) {
      assert.equal(
        source.includes(JSON.stringify(sourceId)),
        false,
        `${sourceFile} should import the feature source id for ${sourceId}`,
      );
    }
  }
  const proofGraphSource = await readFile(
    new URL("dev_test_game_proof_graph.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    proofGraphSource,
    /productionFeatureRoleSurfaceSources\.map/,
  );
  for (const staleFunctionName of [
    "cohostProductionFeatureTargetCollection",
    "replacementProductionFeatureTargetCollection",
    "replacementActionProductionFeatureTargetCollection",
    "replacementPrivateProductionFeatureTargetCollection",
  ]) {
    assert.equal(
      proofGraphSource.includes(staleFunctionName),
      false,
      `proof graph should collect role-surface targets through the registry: ${staleFunctionName}`,
    );
  }
});
