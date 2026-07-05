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
  assertProductionFeatureSourceCoverageDecisions,
  productionFeatureCoverageDecisionKind,
  productionFeatureReadinessSourceKind,
  productionFeatureSourceCoverageDecision,
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
      source.coverageDecision.kind,
      source.coverageDecision.proofCommand,
    ]),
    [
      [
        coreLoopFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.spineTargets,
        productionFeatureCoverageDecisionKind.seededRoleUrlProof,
        devTestGameCoreLoopAdminProofCommand,
      ],
      [
        hostSetupFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.spineTargets,
        productionFeatureCoverageDecisionKind.seededRoleUrlProof,
        devTestGameHostSetupProofCommand,
      ],
      [
        cohostFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.spineTargets,
        productionFeatureCoverageDecisionKind.seededRoleUrlProof,
        devTestGameCohostConsoleProofCommand,
      ],
      [
        replacementFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.spineTargets,
        productionFeatureCoverageDecisionKind.seededRoleUrlProof,
        devTestGameReplacementPlayerProofCommand,
      ],
      [
        replacementActionFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.spineTargets,
        productionFeatureCoverageDecisionKind.seededRoleUrlProof,
        devTestGameReplacementActionProofCommand,
      ],
      [
        replacementPrivateFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.spineTargets,
        productionFeatureCoverageDecisionKind.seededRoleUrlProof,
        devTestGameReplacementPrivateProofCommand,
      ],
      [
        hardeningFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.spineTargets,
        productionFeatureCoverageDecisionKind.seededRoleUrlProof,
        devTestGameHardeningAdminProofCommand,
      ],
      [
        identityFeatureSpineSourceCheckId,
        productionFeatureReadinessSourceKind.identityAdapter,
        productionFeatureCoverageDecisionKind.seededAdminProof,
        devTestGameIdentityAdminProofCommand,
      ],
    ],
  );
  assert.doesNotThrow(() => assertProductionFeatureSourceCoverageDecisions());
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

test("production feature source coverage decisions fail closed", () => {
  assert.equal(
    productionFeatureSourceCoverageDecision({
      sourceCheckId: "future-feature",
      rerunCommand: "npm run future-proof",
    }),
    null,
  );
  assert.throws(
    () =>
      assertProductionFeatureSourceCoverageDecisions([
        {
          sourceCheckId: "future-feature",
          rerunCommand: "npm run future-proof",
        },
      ]),
    /production feature source missing coverage decision: future-feature/,
  );
  assert.equal(
    productionFeatureSourceCoverageDecision({
      sourceCheckId: "future-deferred-feature",
      coverageDecision: {
        kind: productionFeatureCoverageDecisionKind.deferred,
        reason: "awaiting real accounts",
        nextDecisionTrigger: "identity session model lands",
      },
    })?.kind,
    productionFeatureCoverageDecisionKind.deferred,
  );
  assert.equal(
    productionFeatureSourceCoverageDecision({
      sourceCheckId: "future-blocked-feature",
      coverageDecision: {
        kind: productionFeatureCoverageDecisionKind.blockedLocalPrerequisite,
        prerequisiteCheckId: "local-proof-freshness",
        recoveryCommand: "npm run test:dev-test-game-proof-freshness-admin-proof",
      },
    })?.kind,
    productionFeatureCoverageDecisionKind.blockedLocalPrerequisite,
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
  const readinessSource = await readFile(
    new URL("dev_test_game_release_readiness.mjs", import.meta.url),
    "utf8",
  );
  assert.match(readinessSource, /validProductionFeatureTargetsForSource/);
  for (const staleFunctionName of [
    "validHostSetupProductionFeatureTargets",
    "validCohostProductionFeatureTargets",
    "validReplacementProductionFeatureTargets",
    "validReplacementActionProductionFeatureTargets",
    "validReplacementPrivateProductionFeatureTargets",
  ]) {
    assert.equal(
      readinessSource.includes(staleFunctionName),
      false,
      `release readiness should validate role-surface production targets through the shared source helper: ${staleFunctionName}`,
    );
  }
});
