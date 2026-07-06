import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  releaseReadinessProductionFeatureSpineTargets,
} from "./dev_test_game_release_readiness_cases.mjs";
import {
  coreLoopFeatureSpineTargetRows,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  buildProductionFeatureSpineDrilldown,
  buildProductionFeatureSpineTargetCollection,
  resolveProductionFeatureSpineTarget,
  validProductionFeatureSpineDrilldown,
  validProductionFeatureSpineTarget,
  validProductionFeatureSpineTargetCollection,
} from "./dev_test_game_production_feature_spine_resolver.mjs";
import {
  buildProductionFeatureTargetGraphNode,
} from "./dev_test_game_proof_graph.mjs";
import {
  selectedProductionFeatureGraphForTarget,
} from "./dev_test_game_next_action.mjs";
import {
  assertProductionFeatureSourceSpineChecklist,
  productionFeatureCoverageDecisionKind,
  productionFeatureReadinessSourceKind,
  productionFeatureSourceCoverageDecisionSummary,
  productionFeatureSourceSpineChecklist,
} from "./dev_test_game_production_feature_source_registry.mjs";

const browserProofCommand =
  "npm run test:dev-test-game-core-live:local";
const coreLoopAdminProofCommand =
  "npm run test:dev-test-game-core-loop-admin-proof";

test("core loop feature spine catalog rows are scenario-owned", () => {
  const source = readFileSync(
    new URL("./dev_test_game_feature_lane_catalog.mjs", import.meta.url),
    "utf8",
  );
  const spineRowsStart = source.indexOf(
    "const coreLoopFeatureSpineLaneRows = Object.freeze([",
  );
  const seedRowsStart = source.indexOf(
    "const coreLoopSeedOnlyLaneRows = Object.freeze([",
  );
  assert.notEqual(spineRowsStart, -1);
  assert.notEqual(seedRowsStart, -1);
  const spineRowsBlock = source.slice(spineRowsStart, seedRowsStart);

  assert.equal(spineRowsBlock.includes("targetKey:"), false);
  assert.match(spineRowsBlock, /hostPhaseControlFeatureSpineRow/);
  assert.match(spineRowsBlock, /dayVoteResolutionFeatureSpineRow/);
  assert.match(spineRowsBlock, /invalidActionRecoveryFeatureSpineRow/);
  assert.match(spineRowsBlock, /completedGameRecoveryFeatureSpineRow/);
});

test("production feature spine resolver resolves seeded role targets", () => {
  const sourceTarget = coreLoopSourceTargetFixture();
  const target = resolveProductionFeatureSpineTarget({
    itemId: "resolution-receipts",
    declaration: releaseReadinessProductionFeatureSpineTargets.resolutionReceipts,
    sourceTargetsByCheckId: {
      "local-core-loop-proof": sourceTarget,
    },
  });

  assert.deepEqual(target, {
    featureSlotId: "resolution-receipts",
    sourceCheckId: "local-core-loop-proof",
    coverageDecision: {
      kind: "seeded-role-url-proof",
      proofCommand: coreLoopAdminProofCommand,
    },
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    cycleId: "d01-n01-d02",
    roleUrlId: "d01-n01-d02-target",
    roleUrl: "http://127.0.0.1:5173/g/game-a",
    rowKind: "checkpoint",
    checkpointId: "d01-n01-d02-n01-resolved-target-killed",
    adminCheckId: "resolution-receipts",
    browserProofCommand,
    sourceProofArtifact: "target/dev-test-game/core-loop-admin-proof.json",
    rerunCommand: coreLoopAdminProofCommand,
  });
  assert.equal(
    validProductionFeatureSpineTarget(target, {
      sourceCheckRules: coreLoopSourceCheckRules(),
    }),
    true,
  );
  assert.deepEqual(buildProductionFeatureSpineDrilldown(target), {
    featureSlotId: "resolution-receipts",
    sourceCheckId: "local-core-loop-proof",
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    cycleRowId: "d01-n01-d02",
    roleUrlRowId: "d01-n01-d02-target",
    rowKind: "checkpoint",
    checkpointRowId: "d01-n01-d02-n01-resolved-target-killed",
    adminCheckId: "resolution-receipts",
    roleUrl: "http://127.0.0.1:5173/g/game-a",
    rerunCommand: coreLoopAdminProofCommand,
    browserProofCommand,
    sourceProofArtifact: "target/dev-test-game/core-loop-admin-proof.json",
    coverageDecision: {
      kind: "seeded-role-url-proof",
      proofCommand: coreLoopAdminProofCommand,
    },
  });
  assert.equal(
    validProductionFeatureSpineDrilldown(buildProductionFeatureSpineDrilldown(target), {
      sourceCheckRules: coreLoopSourceCheckRules(),
    }),
    true,
  );
});

test("future feature source template flows through checklist, resolver, graph, and next-action", () => {
  const source = futureFeatureSourceFixture();
  const sourceTarget = futureFeatureSourceTargetFixture();
  const declaration = futureFeatureDeclarationFixture();
  const coverageDecisionSummaryForCheckId = (sourceCheckId) => {
    assert.equal(sourceCheckId, source.sourceCheckId);
    return productionFeatureSourceCoverageDecisionSummary(source);
  };
  const validSpineDeclaration = validFutureFeatureSpineDeclaration(source);
  const sourceCheckRules = {
    [source.sourceCheckId]: {
      detailRoleUrlIncludes: source.detailRoleUrlIncludes,
      roleUrlIncludes: source.roleUrlIncludes,
      proofArtifact: source.proofArtifact,
      rerunCommand: source.rerunCommand,
    },
  };

  assert.deepEqual(productionFeatureSourceSpineChecklist(source), {
    sourceCheckId: source.sourceCheckId,
    coverageDecision: "declared:seeded-role-url-proof",
    roleUrlTarget: "declared",
    browserProofCommand,
    proofArtifact: "target/dev-test-game/future-feature-admin-proof.json",
    recoveryCommand: "npm run test:dev-test-game-future-feature-admin-proof",
    proofGraphVisibility: source.graphSourceNodeId,
    readinessDrilldown: productionFeatureReadinessSourceKind.spineTargets,
    nextActionDrilldown: "coverage-decision-summary",
  });
  assert.doesNotThrow(() =>
    assertProductionFeatureSourceSpineChecklist([source]),
  );

  const target = resolveProductionFeatureSpineTarget({
    itemId: declaration.featureSlotId,
    declaration,
    sourceTargetsByCheckId: {
      [source.sourceCheckId]: sourceTarget,
    },
    coverageDecisionSummaryForCheckId,
    validSpineDeclaration,
  });

  assert.equal(
    validProductionFeatureSpineTarget(target, {
      sourceCheckRules,
      coverageDecisionSummaryForCheckId,
      validSpineDeclaration,
    }),
    true,
  );
  assert.deepEqual(target.browserWorkbench, futureFeatureBrowserWorkbenchFixture());
  const drilldown = buildProductionFeatureSpineDrilldown(target);
  assert.equal(
    validProductionFeatureSpineDrilldown(drilldown, {
      sourceCheckRules,
      coverageDecisionSummaryForCheckId,
    }),
    true,
  );
  assert.deepEqual(
    drilldown.browserWorkbench,
    futureFeatureBrowserWorkbenchFixture(),
  );

  const graphNode = buildProductionFeatureTargetGraphNode({
    target,
    releaseReadinessSource:
      "target/dev-test-game/release-readiness-checklist.json",
  });
  assert.deepEqual(graphNode, {
    id: "production-feature:future-feature",
    featureSlotId: "future-feature",
    label: "Production feature: future-feature",
    kind: "production-feature-spine-target",
    status: "passed",
    artifact: "target/dev-test-game/release-readiness-checklist.json",
    sourceCheckId: source.sourceCheckId,
    roleUrl: sourceTarget.detailRoleUrl,
    targetRoleUrl: sourceTarget.roleUrlHrefs[declaration.roleUrlId],
    cycleId: declaration.cycleId,
    roleUrlId: declaration.roleUrlId,
    rowKind: "checkpoint",
    checkpointId: declaration.checkpointId,
    recoveryHookId: undefined,
    adminCheckId: declaration.adminCheckId,
    browserProofCommand,
    browserWorkbench: futureFeatureBrowserWorkbenchFixture(),
    sourceProofArtifact: source.proofArtifact,
    recoveryCommand: source.rerunCommand,
    coverageDecision: productionFeatureSourceCoverageDecisionSummary(source),
  });

  const selectedGraph = selectedProductionFeatureGraphForTarget({
    proofGraph: {
      nodes: [
        {
          id: source.graphSourceNodeId,
          artifact: "target/dev-test-game/future-feature-admin-proof.json",
        },
        graphNode,
      ],
      edges: [
        {
          from: source.graphSourceNodeId,
          to: graphNode.id,
          relationship: "proves-production-feature",
          featureSlotId: target.featureSlotId,
          targetRoleUrl: target.roleUrl,
          sourceProofArtifact: target.sourceProofArtifact,
          command: target.browserProofCommand,
        },
      ],
    },
    spineTarget: target,
    sourceNodeId: source.graphSourceNodeId,
  });
  assert.deepEqual(selectedGraph, {
    nodeId: graphNode.id,
    status: "passed",
    sourceNodeId: source.graphSourceNodeId,
    edge: {
      from: source.graphSourceNodeId,
      to: graphNode.id,
      relationship: "proves-production-feature",
    },
    roleUrl: sourceTarget.detailRoleUrl,
    targetRoleUrl: target.roleUrl,
    edgeTargetRoleUrl: target.roleUrl,
    selectedSpineTargetRoleUrl: target.roleUrl,
    targetRoleUrlMatchesSelectedSpineTarget: true,
    browserProofCommand,
    proofTarget: "target/dev-test-game/release-readiness-checklist.json",
    sourceProofArtifact: source.proofArtifact,
    coverageDecision: productionFeatureSourceCoverageDecisionSummary(source),
  });
});

test("production feature spine resolver builds and validates source collections", () => {
  const collection = buildProductionFeatureSpineTargetCollection({
    declarations: releaseReadinessProductionFeatureSpineTargets,
    sourceTarget: coreLoopSourceTargetFixture(),
  });

  assert.equal(collection.status, "passed");
  assert.deepEqual(
    collection.slotIds,
    Object.values(coreLoopFeatureSpineTargetRows).map(
      (row) => row.featureSlotId,
    ),
  );
  assert.equal(
    collection.bySlotId["invalid-action-recovery"].recoveryHookId,
    "invalidActionReject",
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["day-vote-resolution"].roleUrlId,
      checkpointId: collection.bySlotId["day-vote-resolution"].checkpointId,
      adminCheckId: collection.bySlotId["day-vote-resolution"].adminCheckId,
    },
    {
      roleUrlId: "d02-n02-actionPlayer",
      checkpointId: "d02-n02-d02-deciding-vote-submitted",
      adminCheckId: "day-vote-resolution",
    },
  );
  assert.deepEqual(
    {
      roleUrlId:
        collection.bySlotId["stale-vote-transition-recovery"].roleUrlId,
      checkpointId:
        collection.bySlotId["stale-vote-transition-recovery"].checkpointId,
      recoveryHookId:
        collection.bySlotId["stale-vote-transition-recovery"].recoveryHookId,
      adminCheckId:
        collection.bySlotId["stale-vote-transition-recovery"].adminCheckId,
    },
    {
      roleUrlId: "d02-n02-actionPlayer",
      checkpointId: "d02-n02-n02-action-open",
      recoveryHookId: "staleVoteTransitionReject",
      adminCheckId: "action-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId:
        collection.bySlotId["stale-action-transition-recovery"].roleUrlId,
      checkpointId:
        collection.bySlotId["stale-action-transition-recovery"].checkpointId,
      recoveryHookId:
        collection.bySlotId["stale-action-transition-recovery"].recoveryHookId,
      adminCheckId:
        collection.bySlotId["stale-action-transition-recovery"].adminCheckId,
    },
    {
      roleUrlId: "d01-n01-d02-actionPlayer",
      checkpointId: "d01-n01-d02-n01-action-open",
      recoveryHookId: "staleActionTransitionReject",
      adminCheckId: "action-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["day-vote-no-lynch"].roleUrlId,
      checkpointId: collection.bySlotId["day-vote-no-lynch"].checkpointId,
      adminCheckId: collection.bySlotId["day-vote-no-lynch"].adminCheckId,
    },
    {
      roleUrlId: "d03-n03-actionPlayer",
      checkpointId: "d03-n03-d03r1-revote-ballot-submitted",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["post-day-three-transition"].roleUrlId,
      checkpointId:
        collection.bySlotId["post-day-three-transition"].checkpointId,
      adminCheckId:
        collection.bySlotId["post-day-three-transition"].adminCheckId,
    },
    {
      roleUrlId: "d02-n02-host",
      checkpointId: "d02-n02-d02-resolved-target-killed",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["night-action-loop"].roleUrlId,
      checkpointId: collection.bySlotId["night-action-loop"].checkpointId,
      adminCheckId: collection.bySlotId["night-action-loop"].adminCheckId,
    },
    {
      roleUrlId: "d01-n01-d02-actionPlayer",
      checkpointId: "d01-n01-d02-n01-action-open",
      adminCheckId: "action-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["host-night-action-transition"].roleUrlId,
      checkpointId:
        collection.bySlotId["host-night-action-transition"].checkpointId,
      adminCheckId:
        collection.bySlotId["host-night-action-transition"].adminCheckId,
    },
    {
      roleUrlId: "d02-n02-host",
      checkpointId: "d02-n02-n02-action-open",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["night-two-action-resolution"].roleUrlId,
      checkpointId:
        collection.bySlotId["night-two-action-resolution"].checkpointId,
      adminCheckId:
        collection.bySlotId["night-two-action-resolution"].adminCheckId,
    },
    {
      roleUrlId: "n02-d03-host",
      checkpointId: "n02-d03-n02-resolved-target-killed",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["day-three-controls-return"].roleUrlId,
      checkpointId: collection.bySlotId["day-three-controls-return"].checkpointId,
      adminCheckId: collection.bySlotId["day-three-controls-return"].adminCheckId,
    },
    {
      roleUrlId: "n02-d03-actionPlayer",
      checkpointId: "n02-d03-d03-day-controls-return",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["day-three-terminal-boundary"].roleUrlId,
      checkpointId:
        collection.bySlotId["day-three-terminal-boundary"].checkpointId,
      recoveryHookId:
        collection.bySlotId["day-three-terminal-boundary"].recoveryHookId,
      adminCheckId:
        collection.bySlotId["day-three-terminal-boundary"].adminCheckId,
    },
    {
      roleUrlId: "d03-n03-host",
      checkpointId: "d03-n03-d03-terminal-advance-reject",
      recoveryHookId: "d03TerminalAdvanceReject",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["day-three-terminal-recovery"].roleUrlId,
      checkpointId:
        collection.bySlotId["day-three-terminal-recovery"].checkpointId,
      recoveryHookId:
        collection.bySlotId["day-three-terminal-recovery"].recoveryHookId,
      adminCheckId:
        collection.bySlotId["day-three-terminal-recovery"].adminCheckId,
    },
    {
      roleUrlId: "d03-n03-host",
      checkpointId: "d03-n03-d03-terminal-reload-recovery",
      recoveryHookId: "d03TerminalAdvanceReject",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId:
        collection.bySlotId["day-three-stale-continue-policy-recovery"]
          .roleUrlId,
      checkpointId:
        collection.bySlotId["day-three-stale-continue-policy-recovery"]
          .checkpointId,
      adminCheckId:
        collection.bySlotId["day-three-stale-continue-policy-recovery"]
          .adminCheckId,
    },
    {
      roleUrlId: "d03-n03-host",
      checkpointId: "d03-n03-d03r2-stale-continue-policy-recovery",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["day-three-no-majority-revote"].roleUrlId,
      checkpointId:
        collection.bySlotId["day-three-no-majority-revote"].checkpointId,
      adminCheckId:
        collection.bySlotId["day-three-no-majority-revote"].adminCheckId,
    },
    {
      roleUrlId: "d03-n03-host",
      checkpointId: "d03-n03-d03-revote-prompt-resolved",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["day-three-revote-ballot"].roleUrlId,
      checkpointId: collection.bySlotId["day-three-revote-ballot"].checkpointId,
      adminCheckId: collection.bySlotId["day-three-revote-ballot"].adminCheckId,
    },
    {
      roleUrlId: "d03-n03-actionPlayer",
      checkpointId: "d03-n03-d03r1-revote-ballot-submitted",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId:
        collection.bySlotId["day-three-revote-resolution"].roleUrlId,
      checkpointId:
        collection.bySlotId["day-three-revote-resolution"].checkpointId,
      adminCheckId:
        collection.bySlotId["day-three-revote-resolution"].adminCheckId,
    },
    {
      roleUrlId: "d03-n03-host",
      checkpointId: "d03-n03-d03r1-revote-resolved-no-majority",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["day-three-second-revote"].roleUrlId,
      checkpointId:
        collection.bySlotId["day-three-second-revote"].checkpointId,
      adminCheckId:
        collection.bySlotId["day-three-second-revote"].adminCheckId,
    },
    {
      roleUrlId: "d03-n03-host",
      checkpointId: "d03-n03-d03r2-revote-prompt-resolved",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId:
        collection.bySlotId["day-three-second-revote-ballot"].roleUrlId,
      checkpointId:
        collection.bySlotId["day-three-second-revote-ballot"].checkpointId,
      adminCheckId:
        collection.bySlotId["day-three-second-revote-ballot"].adminCheckId,
    },
    {
      roleUrlId: "d03-n03-actionPlayer",
      checkpointId: "d03-n03-d03r2-revote-ballot-submitted",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId:
        collection.bySlotId["day-three-second-revote-resolution"].roleUrlId,
      checkpointId:
        collection.bySlotId["day-three-second-revote-resolution"].checkpointId,
      adminCheckId:
        collection.bySlotId["day-three-second-revote-resolution"].adminCheckId,
    },
    {
      roleUrlId: "d03-n03-host",
      checkpointId: "d03-n03-d03r2-revote-resolved-no-majority",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["player-action-boundary"].roleUrlId,
      checkpointId: collection.bySlotId["player-action-boundary"].checkpointId,
      recoveryHookId:
        collection.bySlotId["player-action-boundary"].recoveryHookId,
      adminCheckId: collection.bySlotId["player-action-boundary"].adminCheckId,
    },
    {
      roleUrlId: "d01-n01-d02-normalPlayer",
      checkpointId: "d01-n01-d02-n01-action-open",
      recoveryHookId: "normalPlayerDirectActionReject",
      adminCheckId: "player-action-boundary",
    },
  );
  assert.equal(
    validProductionFeatureSpineTargetCollection(collection, {
      declarations: Object.values(releaseReadinessProductionFeatureSpineTargets)
        .filter(
          (declaration) => declaration.sourceCheckId === "local-core-loop-proof",
        ),
      sourceCheckRules: coreLoopSourceCheckRules(),
    }),
    true,
  );
});

test("production feature spine resolver fails closed for missing proof rows", () => {
  assert.throws(
    () =>
      resolveProductionFeatureSpineTarget({
        itemId: "resolution-receipts",
        declaration:
          releaseReadinessProductionFeatureSpineTargets.resolutionReceipts,
        sourceTargetsByCheckId: {
          "local-core-loop-proof": {
            ...coreLoopSourceTargetFixture(),
            checkpointIds: ["d01-n01-d02-n01-action-open"],
          },
        },
      }),
    /production feature spine target is not in local-core-loop-proof/,
  );
});

function coreLoopSourceTargetFixture() {
  return {
    sourceCheckId: "local-core-loop-proof",
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    browserProofCommand,
    sourceProofArtifact: "target/dev-test-game/core-loop-admin-proof.json",
    rerunCommand: coreLoopAdminProofCommand,
    cycleIds: [
      "d01-n01-d02",
      "d02-n02",
      "n02-d03",
      "d03-n03",
      "n03-d04",
      "d04-n04-d05",
      "d05-n05",
    ],
    roleUrlIds: [
      "d01-n01-d02-host",
      "d01-n01-d02-actionPlayer",
      "d01-n01-d02-normalPlayer",
      "d01-n01-d02-target",
      "d01-n01-d02-privateChannel",
      "d02-n02-host",
      "d02-n02-actionPlayer",
      "d02-n02-normalPlayer",
      "d02-n02-target",
      "n02-d03-host",
      "n02-d03-actionPlayer",
      "n02-d03-normalPlayer",
      "d03-n03-host",
      "d03-n03-actionPlayer",
      "d03-n03-normalPlayer",
      "n03-d04-host",
      "n03-d04-actionPlayer",
      "n03-d04-target",
      "d04-n04-d05-host",
      "d04-n04-d05-actionPlayer",
      "d04-n04-d05-deadPlayer",
      "d05-n05-host",
      "d05-n05-actionPlayer",
    ],
    checkpointIds: [
      "d01-n01-d02-d01-resolved-locked",
      "d01-n01-d02-n01-action-open",
      "d01-n01-d02-n01-resolved-target-killed",
      "d01-n01-d02-d02-day-controls-return",
      "d02-n02-d02-vote-open",
      "d02-n02-d02-deciding-vote-submitted",
      "d02-n02-d02-resolved-target-killed",
      "d02-n02-n02-action-open",
      "n02-d03-n02-action-open",
      "n02-d03-n02-action-submitted",
      "n02-d03-n02-resolved-target-killed",
      "n02-d03-d03-day-controls-return",
      "n02-d03-d03-terminal-advance-reject",
      "n02-d03-d03-terminal-reload-recovery",
      "n02-d03-d03-revote-prompt-resolved",
      "n02-d03-d03r1-revote-ballot-submitted",
      "n02-d03-d03r1-revote-resolved-no-majority",
      "n02-d03-d03r2-revote-prompt-resolved",
      "n02-d03-d03r2-revote-ballot-submitted",
      "n02-d03-d03r2-revote-resolved-no-majority",
      "n02-d03-d03r2-stale-continue-policy-recovery",
      "d03-n03-d03-terminal-advance-reject",
      "d03-n03-d03-terminal-reload-recovery",
      "d03-n03-d03-revote-prompt-resolved",
      "d03-n03-d03r1-revote-ballot-submitted",
      "d03-n03-d03r1-revote-resolved-no-majority",
      "d03-n03-d03r2-revote-prompt-resolved",
      "d03-n03-d03r2-revote-ballot-submitted",
      "d03-n03-d03r2-revote-resolved-no-majority",
      "d03-n03-d03r2-stale-continue-policy-recovery",
      "n03-d04-n03-action-open",
      "n03-d04-n03-action-submitted",
      "n03-d04-n03-resolved-target-killed",
      "n03-d04-d04-day-controls-return",
      "d04-n04-d05-d04-no-lynch-vote-submitted",
      "d04-n04-d05-d04-resolved-no-lynch",
      "d04-n04-d05-n04-no-action-open",
      "d04-n04-d05-n04-resolved-no-action",
      "d04-n04-d05-d05-day-controls-return",
      "d05-n05-d05-no-lynch-vote-submitted",
      "d05-n05-d05-resolved-no-lynch",
      "d05-n05-n05-night-controls-return",
    ],
    recoveryHookIds: [
      "staleLockedVoteReject",
      "invalidActionReject",
      "normalPlayerDirectActionReject",
      "staleActionConflictReject",
      "staleVoteTransitionReject",
      "staleActionTransitionReject",
      "d03TerminalAdvanceReject",
    ],
    visibleAdminCheckIds: [
      "core-loop",
      "completed-game-hardening-coverage",
      "host-lifecycle-control",
      "day-vote-resolution",
      "action-loop",
      "invalid-action-recovery",
      "player-action-boundary",
      "private-channel",
      "resolution-receipts",
      "stale-deadline-advance",
    ],
    roleUrlHrefs: {
      "d01-n01-d02-host": "http://127.0.0.1:5173/g/game-a/host",
      "d01-n01-d02-actionPlayer": "http://127.0.0.1:5173/g/game-a",
      "d01-n01-d02-normalPlayer": "http://127.0.0.1:5173/g/game-a",
      "d01-n01-d02-target": "http://127.0.0.1:5173/g/game-a",
      "d01-n01-d02-privateChannel":
        "http://127.0.0.1:5173/g/game-a/c/private%3Amafia_day_chat",
      "d02-n02-host": "http://127.0.0.1:5173/g/game-b/host",
      "d02-n02-actionPlayer": "http://127.0.0.1:5173/g/game-b",
      "d02-n02-normalPlayer": "http://127.0.0.1:5173/g/game-b",
      "n02-d03-host": "http://127.0.0.1:5173/g/game-b/host",
      "n02-d03-actionPlayer": "http://127.0.0.1:5173/g/game-b",
      "n02-d03-normalPlayer": "http://127.0.0.1:5173/g/game-b",
      "d03-n03-host": "http://127.0.0.1:5173/g/game-b/host",
      "d03-n03-actionPlayer": "http://127.0.0.1:5173/g/game-b",
      "d03-n03-normalPlayer": "http://127.0.0.1:5173/g/game-b",
      "n03-d04-host": "http://127.0.0.1:5173/g/game-b/host",
      "n03-d04-actionPlayer": "http://127.0.0.1:5173/g/game-b",
      "n03-d04-target": "http://127.0.0.1:5173/g/game-b",
      "d04-n04-d05-host": "http://127.0.0.1:5173/g/game-b/host",
      "d04-n04-d05-actionPlayer": "http://127.0.0.1:5173/g/game-b",
      "d04-n04-d05-deadPlayer": "http://127.0.0.1:5173/g/game-b",
      "d05-n05-host": "http://127.0.0.1:5173/g/game-b/host",
      "d05-n05-actionPlayer": "http://127.0.0.1:5173/g/game-b",
      "d02-n02-target": "http://127.0.0.1:5173/g/game-b",
    },
  };
}

function coreLoopSourceCheckRules() {
  return {
    "local-core-loop-proof": {
      detailRoleUrlIncludes: "/admin/audit/local-core-loop",
      roleUrlIncludes: "/g/",
      proofArtifact: "target/dev-test-game/core-loop-admin-proof.json",
      rerunCommand: coreLoopAdminProofCommand,
    },
  };
}

function futureFeatureSourceFixture() {
  return {
    sourceCheckId: "local-future-feature-proof",
    readinessSourceKind: productionFeatureReadinessSourceKind.spineTargets,
    graphSourceNodeId: "role-surface:future-feature",
    detailRoleUrlIncludes: "/admin/audit/local-future-feature",
    roleUrlIncludes: "/g/",
    proofArtifact: "target/dev-test-game/future-feature-admin-proof.json",
    rerunCommand: "npm run test:dev-test-game-future-feature-admin-proof",
    coverageDecision: {
      kind: productionFeatureCoverageDecisionKind.seededRoleUrlProof,
      proofCommand: "npm run test:dev-test-game-future-feature-admin-proof",
    },
  };
}

function futureFeatureDeclarationFixture() {
  return {
    featureSlotId: "future-feature",
    sourceCheckId: "local-future-feature-proof",
    cycleId: "future-cycle",
    roleUrlId: "future-player",
    checkpointId: "future-checkpoint",
    adminCheckId: "future-admin-check",
  };
}

function futureFeatureSourceTargetFixture() {
  return {
    sourceCheckId: "local-future-feature-proof",
    detailRoleUrl: "/admin/audit/local-future-feature?game=<seeded-game>",
    browserProofCommand,
    browserWorkbench: futureFeatureBrowserWorkbenchFixture(),
    sourceProofArtifact: "target/dev-test-game/future-feature-admin-proof.json",
    rerunCommand: "npm run test:dev-test-game-future-feature-admin-proof",
    cycleIds: ["future-cycle"],
    roleUrlIds: ["future-player"],
    checkpointIds: ["future-checkpoint"],
    recoveryHookIds: [],
    visibleAdminCheckIds: ["future-admin-check"],
    roleUrlHrefs: {
      "future-player": "http://127.0.0.1:5173/g/<seeded-game>",
    },
  };
}

function futureFeatureBrowserWorkbenchFixture() {
  return {
    status: "passed",
    route: "/g/<seeded-game>",
    roleUrl: "http://127.0.0.1:5173/g/<seeded-game>",
    roleSurface: "future-feature",
    featureSlotId: "future-feature",
    requiredEvidence:
      "Seeded future feature role URL opens /g/<seeded-game> in the browser proof before future-admin-check recovery is trusted.",
  };
}

function validFutureFeatureSpineDeclaration(source) {
  return (declaration) =>
    declaration !== null &&
    typeof declaration === "object" &&
    declaration.sourceCheckId === source.sourceCheckId &&
    typeof declaration.featureSlotId === "string" &&
    declaration.featureSlotId.length > 0 &&
    typeof declaration.cycleId === "string" &&
    declaration.cycleId.length > 0 &&
    typeof declaration.roleUrlId === "string" &&
    declaration.roleUrlId.length > 0 &&
    typeof declaration.checkpointId === "string" &&
    declaration.checkpointId.length > 0 &&
    typeof declaration.adminCheckId === "string" &&
    declaration.adminCheckId.length > 0;
}
