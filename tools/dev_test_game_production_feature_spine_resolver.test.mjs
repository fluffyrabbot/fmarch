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
  completedGameEndgameRecoveryFeatureSpineRows,
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";
import {
  coreLoopSpineRowsFixture,
} from "./dev_test_game_core_loop_spine_target_fixtures.mjs";
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
const completedGameEndgameRecoveryRows = Object.freeze(
  completedGameEndgameRecoveryFeatureSpineRows({ cycleId: "d05-n05" }),
);

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
    browserWorkbench: coreLoopResolutionBrowserWorkbenchFixture(),
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
    browserWorkbench: coreLoopResolutionBrowserWorkbenchFixture(),
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

test("production feature spine resolver preserves host phase command target shape", () => {
  const sourceTarget = coreLoopSourceTargetFixture();
  const declaration =
    releaseReadinessProductionFeatureSpineTargets.hostPhaseControl;
  const target = resolveProductionFeatureSpineTarget({
    itemId: "host-phase-control",
    declaration,
    sourceTargetsByCheckId: {
      "local-core-loop-proof": sourceTarget,
    },
  });

  assert.deepEqual(target, {
    featureSlotId: "host-phase-control",
    sourceCheckId: "local-core-loop-proof",
    coverageDecision: {
      kind: "seeded-role-url-proof",
      proofCommand: coreLoopAdminProofCommand,
    },
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    cycleId: "d02-n02",
    roleUrlId: "d02-n02-host",
    roleUrl: "http://127.0.0.1:5173/g/game-b/host",
    rowKind: "checkpoint",
    checkpointId: "d02-n02-host-lifecycle-control-checkpoint",
    adminCheckId: "host-lifecycle-control",
    featureTargetKind: "host-phase-command",
    browserProofCommand,
    browserWorkbench: {
      status: "passed",
      route: "/g/game-b/host",
      roleUrl: "http://127.0.0.1:5173/g/game-b/host",
      roleSurface: "host",
      featureSlotId: "host-phase-control",
      requiredEvidence:
        "Seeded host-phase-control role URL opens /g/game-b/host in the browser proof before host-lifecycle-control recovery is trusted.",
    },
    sourceProofArtifact: "target/dev-test-game/core-loop-admin-proof.json",
    rerunCommand: coreLoopAdminProofCommand,
  });
  assert.equal(
    validProductionFeatureSpineTarget(target, {
      sourceCheckRules: coreLoopSourceCheckRules(),
    }),
    true,
  );
  assert.equal(
    buildProductionFeatureSpineDrilldown(target).featureTargetKind,
    "host-phase-command",
  );
});

test("production feature spine resolver preserves host locked recovery target shape", () => {
  const sourceTarget = coreLoopSourceTargetFixture();
  const declaration =
    releaseReadinessProductionFeatureSpineTargets.hostPhaseLockedRecovery;
  const target = resolveProductionFeatureSpineTarget({
    itemId: "host-phase-locked-recovery",
    declaration,
    sourceTargetsByCheckId: {
      "local-core-loop-proof": sourceTarget,
    },
  });

  assert.deepEqual(target, {
    featureSlotId: "host-phase-locked-recovery",
    sourceCheckId: "local-core-loop-proof",
    coverageDecision: {
      kind: "seeded-role-url-proof",
      proofCommand: coreLoopAdminProofCommand,
    },
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    cycleId: "d02-n02",
    roleUrlId: "d02-n02-host",
    roleUrl: "http://127.0.0.1:5173/g/game-b/host",
    rowKind: "checkpoint",
    checkpointId: "d02-n02-host-lifecycle-control-locked-checkpoint",
    adminCheckId: "host-lifecycle-control",
    featureTargetKind: "host-phase-locked-recovery",
    browserProofCommand,
    browserWorkbench: {
      status: "passed",
      route: "/g/game-b/host",
      roleUrl: "http://127.0.0.1:5173/g/game-b/host",
      roleSurface: "host",
      featureSlotId: "host-phase-locked-recovery",
      requiredEvidence:
        "Seeded host-phase-locked-recovery role URL opens /g/game-b/host in the browser proof before host-lifecycle-control recovery is trusted.",
    },
    sourceProofArtifact: "target/dev-test-game/core-loop-admin-proof.json",
    rerunCommand: coreLoopAdminProofCommand,
  });
  assert.equal(
    validProductionFeatureSpineTarget(target, {
      sourceCheckRules: coreLoopSourceCheckRules(),
    }),
    true,
  );
});

test("production feature spine resolver preserves host unlocked recovery target shape", () => {
  const sourceTarget = coreLoopSourceTargetFixture();
  const declaration =
    releaseReadinessProductionFeatureSpineTargets.hostPhaseUnlockedRecovery;
  const target = resolveProductionFeatureSpineTarget({
    itemId: "host-phase-unlocked-recovery",
    declaration,
    sourceTargetsByCheckId: {
      "local-core-loop-proof": sourceTarget,
    },
  });

  assert.deepEqual(target, {
    featureSlotId: "host-phase-unlocked-recovery",
    sourceCheckId: "local-core-loop-proof",
    coverageDecision: {
      kind: "seeded-role-url-proof",
      proofCommand: coreLoopAdminProofCommand,
    },
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    cycleId: "d02-n02",
    roleUrlId: "d02-n02-host",
    roleUrl: "http://127.0.0.1:5173/g/game-b/host",
    rowKind: "checkpoint",
    checkpointId: "d02-n02-host-lifecycle-control-unlocked-checkpoint",
    adminCheckId: "host-lifecycle-control",
    featureTargetKind: "host-phase-unlocked-recovery",
    browserProofCommand,
    browserWorkbench: {
      status: "passed",
      route: "/g/game-b/host",
      roleUrl: "http://127.0.0.1:5173/g/game-b/host",
      roleSurface: "host",
      featureSlotId: "host-phase-unlocked-recovery",
      requiredEvidence:
        "Seeded host-phase-unlocked-recovery role URL opens /g/game-b/host in the browser proof before host-lifecycle-control recovery is trusted.",
    },
    sourceProofArtifact: "target/dev-test-game/core-loop-admin-proof.json",
    rerunCommand: coreLoopAdminProofCommand,
  });
  assert.equal(
    validProductionFeatureSpineTarget(target, {
      sourceCheckRules: coreLoopSourceCheckRules(),
    }),
    true,
  );
});

test("production feature spine resolver preserves host stale reject target shape", () => {
  const sourceTarget = coreLoopSourceTargetFixture();
  const declaration =
    releaseReadinessProductionFeatureSpineTargets.hostPhaseStaleReject;
  const target = resolveProductionFeatureSpineTarget({
    itemId: "host-phase-stale-reject",
    declaration,
    sourceTargetsByCheckId: {
      "local-core-loop-proof": sourceTarget,
    },
  });

  assert.deepEqual(target, {
    featureSlotId: "host-phase-stale-reject",
    sourceCheckId: "local-core-loop-proof",
    coverageDecision: {
      kind: "seeded-role-url-proof",
      proofCommand: coreLoopAdminProofCommand,
    },
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    cycleId: "d02-n02",
    roleUrlId: "d02-n02-host",
    roleUrl: "http://127.0.0.1:5173/g/game-b/host",
    rowKind: "checkpoint",
    checkpointId: "d02-n02-host-lifecycle-control-stale-reject-checkpoint",
    adminCheckId: "host-lifecycle-control",
    featureTargetKind: "host-phase-stale-reject",
    browserProofCommand,
    browserWorkbench: {
      status: "passed",
      route: "/g/game-b/host",
      roleUrl: "http://127.0.0.1:5173/g/game-b/host",
      roleSurface: "host",
      featureSlotId: "host-phase-stale-reject",
      requiredEvidence:
        "Seeded host-phase-stale-reject role URL opens /g/game-b/host in the browser proof before host-lifecycle-control recovery is trusted.",
    },
    sourceProofArtifact: "target/dev-test-game/core-loop-admin-proof.json",
    rerunCommand: coreLoopAdminProofCommand,
  });
  assert.equal(
    validProductionFeatureSpineTarget(target, {
      sourceCheckRules: coreLoopSourceCheckRules(),
    }),
    true,
  );
});

test("production feature spine resolver preserves host advance transition target shape", () => {
  const sourceTarget = coreLoopSourceTargetFixture();
  const declaration =
    releaseReadinessProductionFeatureSpineTargets.hostPhaseAdvanceTransition;
  const target = resolveProductionFeatureSpineTarget({
    itemId: "host-phase-advance-transition",
    declaration,
    sourceTargetsByCheckId: {
      "local-core-loop-proof": sourceTarget,
    },
  });

  assert.deepEqual(target, {
    featureSlotId: "host-phase-advance-transition",
    sourceCheckId: "local-core-loop-proof",
    coverageDecision: {
      kind: "seeded-role-url-proof",
      proofCommand: coreLoopAdminProofCommand,
    },
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    cycleId: "d02-n02",
    roleUrlId: "d02-n02-host",
    roleUrl: "http://127.0.0.1:5173/g/game-b/host",
    rowKind: "checkpoint",
    checkpointId: "d02-n02-host-phase-advance-transition-checkpoint",
    adminCheckId: "core-loop",
    featureTargetKind: "host-phase-advance-transition",
    browserProofCommand,
    browserWorkbench: {
      status: "passed",
      route: "/g/game-b/host",
      roleUrl: "http://127.0.0.1:5173/g/game-b/host",
      roleSurface: "host",
      featureSlotId: "host-phase-advance-transition",
      requiredEvidence:
        "Seeded host-phase-advance-transition role URL opens /g/game-b/host in the browser proof before core-loop recovery is trusted.",
    },
    sourceProofArtifact: "target/dev-test-game/core-loop-admin-proof.json",
    rerunCommand: coreLoopAdminProofCommand,
  });
  assert.equal(
    validProductionFeatureSpineTarget(target, {
      sourceCheckRules: coreLoopSourceCheckRules(),
    }),
    true,
  );
});

test("production feature spine resolver preserves player action submission ACK target shape", () => {
  const sourceTarget = coreLoopSourceTargetFixture();
  const declaration =
    releaseReadinessProductionFeatureSpineTargets.playerActionSubmissionAck;
  const target = resolveProductionFeatureSpineTarget({
    itemId: "player-action-submission-ack",
    declaration,
    sourceTargetsByCheckId: {
      "local-core-loop-proof": sourceTarget,
    },
  });

  assert.deepEqual(target, {
    featureSlotId: "player-action-submission-ack",
    sourceCheckId: "local-core-loop-proof",
    coverageDecision: {
      kind: "seeded-role-url-proof",
      proofCommand: coreLoopAdminProofCommand,
    },
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    cycleId: "d02-n02",
    roleUrlId: "d02-n02-actionPlayer",
    roleUrl: "http://127.0.0.1:5173/g/game-b",
    rowKind: "checkpoint",
    checkpointId: "d02-n02-player-action-submission-ack-checkpoint",
    adminCheckId: "action-loop",
    featureTargetKind: "player-action-submission-ack",
    browserProofCommand,
    browserWorkbench: {
      status: "passed",
      route: "/g/game-b",
      roleUrl: "http://127.0.0.1:5173/g/game-b",
      roleSurface: "player",
      featureSlotId: "player-action-submission-ack",
      requiredEvidence:
        "Seeded player-action-submission-ack role URL opens /g/game-b in the browser proof before action-loop recovery is trusted.",
    },
    sourceProofArtifact: "target/dev-test-game/core-loop-admin-proof.json",
    rerunCommand: coreLoopAdminProofCommand,
  });
  assert.equal(
    validProductionFeatureSpineTarget(target, {
      sourceCheckRules: coreLoopSourceCheckRules(),
    }),
    true,
  );
});

test("production feature spine resolver preserves night action receipt target shape", () => {
  const sourceTarget = coreLoopSourceTargetFixture();
  const declaration =
    releaseReadinessProductionFeatureSpineTargets.nightActionResolutionReceipt;
  const target = resolveProductionFeatureSpineTarget({
    itemId: "night-action-resolution-receipt",
    declaration,
    sourceTargetsByCheckId: {
      "local-core-loop-proof": sourceTarget,
    },
  });

  assert.deepEqual(target, {
    featureSlotId: "night-action-resolution-receipt",
    sourceCheckId: "local-core-loop-proof",
    coverageDecision: {
      kind: "seeded-role-url-proof",
      proofCommand: coreLoopAdminProofCommand,
    },
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    cycleId: "d02-n02",
    roleUrlId: "d02-n02-target",
    roleUrl: "http://127.0.0.1:5173/g/game-b",
    rowKind: "checkpoint",
    checkpointId: "d02-n02-night-action-resolution-receipt-checkpoint",
    adminCheckId: "resolution-receipts",
    featureTargetKind: "night-action-resolution-receipt",
    browserProofCommand,
    browserWorkbench: {
      status: "passed",
      route: "/g/game-b",
      roleUrl: "http://127.0.0.1:5173/g/game-b",
      roleSurface: "player",
      featureSlotId: "night-action-resolution-receipt",
      requiredEvidence:
        "Seeded night-action-resolution-receipt role URL opens /g/game-b in the browser proof before resolution-receipts recovery is trusted.",
    },
    sourceProofArtifact: "target/dev-test-game/core-loop-admin-proof.json",
    rerunCommand: coreLoopAdminProofCommand,
  });
  assert.equal(
    validProductionFeatureSpineTarget(target, {
      sourceCheckRules: coreLoopSourceCheckRules(),
    }),
    true,
  );
});

test("production feature spine resolver preserves night action privacy target shape", () => {
  const sourceTarget = coreLoopSourceTargetFixture();
  const declaration =
    releaseReadinessProductionFeatureSpineTargets.nightActionResolutionPrivacy;
  const target = resolveProductionFeatureSpineTarget({
    itemId: "night-action-resolution-privacy",
    declaration,
    sourceTargetsByCheckId: {
      "local-core-loop-proof": sourceTarget,
    },
  });

  assert.deepEqual(target, {
    featureSlotId: "night-action-resolution-privacy",
    sourceCheckId: "local-core-loop-proof",
    coverageDecision: {
      kind: "seeded-role-url-proof",
      proofCommand: coreLoopAdminProofCommand,
    },
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    cycleId: "d02-n02",
    roleUrlId: "d02-n02-normalPlayer",
    roleUrl: "http://127.0.0.1:5173/g/game-b",
    rowKind: "checkpoint",
    checkpointId: "d02-n02-night-action-resolution-privacy-checkpoint",
    adminCheckId: "resolution-receipts",
    featureTargetKind: "night-action-resolution-privacy",
    browserProofCommand,
    browserWorkbench: {
      status: "passed",
      route: "/g/game-b",
      roleUrl: "http://127.0.0.1:5173/g/game-b",
      roleSurface: "player",
      featureSlotId: "night-action-resolution-privacy",
      requiredEvidence:
        "Seeded night-action-resolution-privacy role URL opens /g/game-b in the browser proof before resolution-receipts recovery is trusted.",
    },
    sourceProofArtifact: "target/dev-test-game/core-loop-admin-proof.json",
    rerunCommand: coreLoopAdminProofCommand,
  });
  assert.equal(
    validProductionFeatureSpineTarget(target, {
      sourceCheckRules: coreLoopSourceCheckRules(),
    }),
    true,
  );
});

function coreLoopResolutionBrowserWorkbenchFixture() {
  return {
    status: "passed",
    route: "/g/game-a",
    roleUrl: "http://127.0.0.1:5173/g/game-a",
    roleSurface: "player",
    featureSlotId: "resolution-receipts",
    requiredEvidence:
      "Seeded resolution-receipts role URL opens /g/game-a in the browser proof before resolution-receipts recovery is trusted.",
  };
}

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
    browserWorkbench: futureFeatureBrowserWorkbenchFixture(),
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
  const rowIds = coreLoopSpineRowsFixture();
  return {
    sourceCheckId: "local-core-loop-proof",
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    browserProofCommand,
    sourceProofArtifact: "target/dev-test-game/core-loop-admin-proof.json",
    rerunCommand: coreLoopAdminProofCommand,
    cycleIds: [...rowIds.cycles],
    roleUrlIds: [
      ...rowIds.roleUrls,
      ...completedGameEndgameRecoveryRows.map((row) => row.roleUrlId),
    ],
    checkpointIds: [
      ...rowIds.checkpoints.slice(0, 4),
      ...rowIds.roleSurfaceCheckpoints,
      ...rowIds.checkpoints.slice(4),
      ...completedGameEndgameRecoveryRows.map((row) => row.checkpointId),
    ],
    recoveryHookIds: [...rowIds.recoveryHooks],
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
    roleUrlHrefs: coreLoopSourceRoleUrlHrefsFixture(rowIds),
  };
}

function coreLoopSourceRoleUrlHrefsFixture(rowIds) {
  return Object.fromEntries(
    [
      ...rowIds.roleUrls.map((roleUrlId) => [roleUrlId, roleUrlId]),
      ...completedGameEndgameRecoveryRows.map((row) => [
        row.roleUrlId,
        row.role,
      ]),
    ].map(([roleUrlId, role]) => [roleUrlId, coreLoopRoleUrlHrefFixture(role)]),
  );
}

function coreLoopRoleUrlHrefFixture(role) {
  const baseGame = role.startsWith("d01-n01-d02") ? "game-a" : "game-b";
  const roleSuffix =
    role === "host" || role.endsWith("-host")
      ? "/host"
      : role === "privateChannel" || role.endsWith("-privateChannel")
        ? "/c/private%3Amafia_day_chat"
        : role === "deadPlayer" && baseGame === "game-b"
          ? "?private=notification-1"
          : "";
  return `http://127.0.0.1:5173/g/${baseGame}${roleSuffix}`;
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
