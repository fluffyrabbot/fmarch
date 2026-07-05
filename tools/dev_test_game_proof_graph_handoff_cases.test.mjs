import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminSpineProofCommand,
  adminProofDestinationArtifactPath,
  adminProofDestinationProofGraphNodes,
  adminProofDestinationRequirementCases,
  adminProofDestinationRequirementForLink,
  adminProofDestinationRequirementLinkRows,
  adminProofDestinationRequirementRoleRows,
  adminProofDestinationRecoveryCommand,
  adminProofDestinationRoleUrl,
  adminProofDestinationRequirements,
  devTestGameProofGraphBaseEdges,
  devTestGameProofGraphFirstClassNodes,
  proofGraphProductionFeatureCase,
  proofGraphProductionFeatureEdge,
  proofGraphProductionFeatureNode,
  proofGraphRecoveryReceiptCase,
  proofGraphRecoveryReceiptEdges,
  proofGraphRecoveryReceiptNodes,
  seedFixtureRecoveryCommand,
  seedProofLaneCoverageRecoveryReason,
  spineManifestAdminProofCommand,
  terminalAdminProofBatchArtifactPaths,
  terminalAdminProofBatchEdgeIds,
  terminalAdminProofBatchIds,
} from "./dev_test_game_proof_graph_handoff_cases.mjs";
import {
  devTestGameSeedFixturePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  devTestGameProductionFeatureBrowserProofCommand,
} from "./dev_test_game_production_feature_source_registry.mjs";
import {
  recoveryReceiptGraphDescriptorByReceiptKey,
} from "./dev_test_game_recovery_receipt_graph_surfaces.mjs";
import {
  hostedIdentityEvidenceHandoffCase,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  staleConflictMessageLaneIds,
} from "./dev_test_game_stale_conflict_scenarios.mjs";
import {
  hostedTargetPreflightBlockingCheckIds,
  hostedTargetPreflightCheckIds,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import {
  hostedEvidenceHandoffCase,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  hostedOpsSignalCheckIds,
  hostedOpsSignalRelatedAuditIds,
} from "./dev_test_game_hosted_ops_signal_cases.mjs";
import {
  realHostedObservabilityHandoffCase,
  realHostedObservabilityHandoffCheckIds,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  seedScenarioCoverageGroups,
} from "./dev_test_game_seed_scenario_cases.mjs";
import {
  localAdminAuditHandoffCheckIds,
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGameProofGraphCommand,
} from "./dev_test_game_proof_graph_paths.mjs";
import {
  nextActionCommand,
  proofFreshnessAdminProofCommand,
} from "./dev_test_game_next_action_paths.mjs";
import {
  localHostedEvidenceLaneDemoProofCheckId,
  localNextActionAdminSurfaceCheckId,
  localProofFreshnessAdminSurfaceCheckId,
  localProofGraphAdminRoleHandoffsCheckId,
} from "./dev_test_game_local_readiness_dependencies.mjs";

test("admin proof destination handoff cases share link and audit rows", () => {
  assert.deepEqual(adminProofDestinationRequirementLinkRows, [
    ["admin-proof:core-loop", localAdminAuditIds.coreLoop],
    ["admin-proof:hardening", localAdminAuditIds.hardening],
    ["admin-proof:identity", localAdminAuditIds.identityAdapter],
    [
      "admin-proof:hosted-identity-evidence",
      localAdminAuditIds.hostedIdentityEvidence,
    ],
    ["admin-proof:backup", localAdminAuditIds.backupRestore],
    ["admin-proof:ops", localAdminAuditIds.opsArtifacts],
    ["admin-proof:seed", localAdminAuditIds.seedFixtures],
    ["admin-proof:release", localAdminAuditIds.releaseReadiness],
    ["admin-proof:release-runbook", localAdminAuditIds.releaseRunbook],
    ["admin-proof:race-coverage", localAdminAuditIds.raceCoverage],
    [
      "admin-proof:hosted-target-preflight",
      localAdminAuditIds.hostedTargetPreflight,
    ],
    ["admin-proof:hosted-evidence-lane", localAdminAuditIds.hostedEvidenceLane],
    [
      "admin-proof:hosted-concurrent-race-matrix",
      localAdminAuditIds.hostedConcurrentRaceMatrix,
    ],
    ["admin-proof:hosted-ops-signals", localAdminAuditIds.hostedOpsSignals],
    [
      "admin-proof:real-hosted-observability-handoff",
      localAdminAuditIds.realHostedObservabilityHandoff,
    ],
    ["admin-proof:spine-manifest", localAdminAuditIds.spineManifest],
  ]);
  assert.equal(
    adminProofDestinationRequirementCases.length,
    adminProofDestinationRequirementLinkRows.length,
  );
  assert.deepEqual(
    adminProofDestinationRequirementRoleRows(),
    adminProofDestinationRequirementLinkRows.map(([linkId, auditId]) => ({
      linkId,
      auditId,
      roleUrl: `/admin/audit/${auditId}?game=<seeded-game>`,
    })),
  );
  assert.equal(
    adminProofDestinationRoleUrl({
      auditId: localAdminAuditIds.coreLoop,
      game: "midsummer",
    }),
    "/admin/audit/local-core-loop?game=midsummer",
  );
});

test("admin proof destination handoff cases derive proof graph nodes", () => {
  assert.deepEqual(
    adminProofDestinationProofGraphNodes({ game: "midsummer" }).map((node) => [
      node.id,
      node.label,
      node.kind,
      node.status,
      node.artifact,
      node.roleUrl,
      node.recoveryCommand,
    ]),
    adminProofDestinationRequirementLinkRows.map(([linkId, auditId]) => [
      linkId,
      `${auditId} admin proof`,
      "proof-surface",
      "passed",
      adminProofDestinationArtifactPath(linkId),
      `/admin/audit/${auditId}?game=midsummer`,
      adminProofDestinationRecoveryCommand(linkId),
    ]),
  );
});

test("proof graph first-class fixture nodes share artifact and command contracts", () => {
  assert.deepEqual(
    devTestGameProofGraphFirstClassNodes({ game: "midsummer" }).map((node) => [
      node.id,
      node.kind,
      node.status,
      node.artifact,
      node.roleUrl,
      node.recoveryCommand ?? "",
      node.proofIds ?? [],
      node.artifactPaths ?? [],
    ]),
    [
      [
        "admin-spine",
        "proof-surface",
        "passed",
        "target/dev-test-game/admin-spine-proof.json",
        "/admin/audit/local-admin-spine?game=midsummer",
        adminSpineProofCommand,
        [],
        [],
      ],
      [
        "spine-manifest",
        "proof-surface",
        "passed",
        "target/dev-test-game/spine-manifest.json",
        "/admin/audit/local-spine-manifest?game=midsummer",
        spineManifestAdminProofCommand,
        [],
        [],
      ],
      [
        "proof-graph",
        "proof-surface",
        "passed",
        "target/dev-test-game/proof-graph.json",
        "/admin/audit/local-proof-graph?game=midsummer",
        devTestGameProofGraphCommand,
        [],
        [],
      ],
      [
        "proof-freshness",
        "proof-surface",
        "passed",
        "target/dev-test-game/proof-freshness-admin-proof.json",
        "/admin/audit/local-proof-freshness?game=midsummer",
        proofFreshnessAdminProofCommand,
        [],
        [],
      ],
      [
        "next-action",
        "proof-surface",
        "recorded",
        "target/dev-test-game/next-action.json",
        "/admin/audit/local-next-action?game=midsummer",
        nextActionCommand,
        [],
        [],
      ],
      [
        "admin-spine-terminal-batches",
        "terminal-proof-batch-receipt",
        "passed",
        "target/dev-test-game/admin-spine-terminal-batches.json",
        "/admin/audit/local-admin-spine?game=midsummer",
        "",
        terminalAdminProofBatchIds,
        terminalAdminProofBatchArtifactPaths,
      ],
    ],
  );
});

test("proof graph base edges share fixed topology and seed recovery metadata", () => {
  assert.deepEqual(
    devTestGameProofGraphBaseEdges({ game: "midsummer" }),
    [
      { from: "admin-spine", to: "spine-manifest", relationship: "aggregates" },
      { from: "spine-manifest", to: "proof-graph", relationship: "records" },
      { from: "spine-manifest", to: "proof-freshness", relationship: "records" },
      { from: "spine-manifest", to: "next-action", relationship: "records" },
      {
        from: "proof-freshness",
        to: "next-action",
        relationship: "recovers-through",
      },
      ...terminalAdminProofBatchEdgeIds.map((proofId) => ({
        from: "admin-spine-terminal-batches",
        to: proofId,
        relationship: "terminal-browser-proof",
      })),
      {
        from: "next-action",
        to: "admin-proof:seed",
        relationship: "recovery-target",
        reason: seedProofLaneCoverageRecoveryReason,
        command: seedFixtureRecoveryCommand,
        roleUrl: "/admin/audit/local-seed-fixtures?game=midsummer",
        proofTarget: devTestGameSeedFixturePath,
      },
      ...adminProofDestinationRequirementLinkRows.map(([linkId]) => ({
        from: "admin-spine",
        to: linkId,
        relationship: "aggregates",
      })),
    ],
  );
});

test("proof graph feature and recovery receipt helpers preserve fixture graph shape", () => {
  const featureCase = proofGraphProductionFeatureCase({
    spineTarget: {
      sourceCheckId: "local-core-loop-proof",
      featureSlotId: "future-feature",
      detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
      roleUrl: "/g/<seeded-game>/player-a",
      browserProofCommand: devTestGameProductionFeatureBrowserProofCommand,
      coverageDecision: {
        kind: "seeded-role-url-proof",
        proofCommand: "npm run proof",
      },
    },
  });
  assert.deepEqual(proofGraphProductionFeatureNode(featureCase), {
    id: "production-feature:future-feature",
    label: "Production feature: future-feature",
    kind: "production-feature-spine-target",
    status: "passed",
    artifact: "target/dev-test-game/release-readiness-checklist.json",
    roleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    targetRoleUrl: "/g/<seeded-game>/player-a",
    browserProofCommand: devTestGameProductionFeatureBrowserProofCommand,
    coverageDecision: {
      kind: "seeded-role-url-proof",
      proofCommand: "npm run proof",
    },
  });
  assert.deepEqual(proofGraphProductionFeatureEdge(featureCase), {
    from: "admin-proof:core-loop",
    to: "production-feature:future-feature",
    relationship: "proves-production-feature",
    featureSlotId: "future-feature",
    targetRoleUrl: "/g/<seeded-game>/player-a",
    command: devTestGameProductionFeatureBrowserProofCommand,
  });

  const receiptCases = [
    proofGraphRecoveryReceiptCase({
      descriptor: recoveryReceiptGraphDescriptorByReceiptKey(
        "privateChannelRecoveryReceipt",
      ),
      graph: {
        nodeId: "private-channel-recovery-receipt",
        status: "passed",
        proofTarget: "target/dev-test-game/private-channel-recovery-receipt.json",
        roleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
        familyId: "core-loop-private-channel-recovery",
        laneCount: 2,
        laneIds: ["future-a", "future-b"],
        normalizedEvidenceObjects: [{ name: "evidence-a" }],
      },
    }),
  ];
  assert.deepEqual(proofGraphRecoveryReceiptNodes(receiptCases), [
    {
      id: "private-channel-recovery-receipt",
      label: "Private-channel recovery receipt",
      kind: "private-channel-recovery-receipt",
      status: "passed",
      artifact: "target/dev-test-game/private-channel-recovery-receipt.json",
      roleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
      proofCommand: "test:dev-test-game-private-channel-recovery-receipt",
      recoveryCommand: "test:dev-test-game-private-channel-recovery-receipt",
      familyId: "core-loop-private-channel-recovery",
      laneCount: 2,
      laneIds: ["future-a", "future-b"],
      normalizedEvidenceObjects: [{ name: "evidence-a" }],
    },
  ]);
  assert.deepEqual(proofGraphRecoveryReceiptEdges(receiptCases), [
    {
      from: "admin-proof:core-loop",
      to: "private-channel-recovery-receipt",
      relationship: "proves",
    },
    {
      from: "private-channel-recovery-receipt",
      to: "proof-graph",
      relationship: "records",
    },
    {
      from: "private-channel-recovery-receipt",
      to: "next-action",
      relationship: "summarizes-into",
    },
  ]);
});

test("admin proof destination handoff cases carry shared row requirements", () => {
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:hardening")
      .requiredCheckIds,
    [
      "idempotent-retry",
      "concurrent-action-race",
      ...staleConflictMessageLaneIds,
    ],
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:seed")
      .requiredScenarioIds,
    seedScenarioCoverageGroups.allDemo,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink(
      "admin-proof:hosted-identity-evidence",
    ).requiredHostedHandoffInputs,
    hostedIdentityEvidenceHandoffCase().inputIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink(
      "admin-proof:hosted-identity-evidence",
    ).requiredHostedHandoffBlockedChecks,
    hostedIdentityEvidenceHandoffCase().blockedCheckIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:hosted-target-preflight")
      .requiredCheckIds,
    hostedTargetPreflightCheckIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:hosted-evidence-lane")
      .requiredCheckIds,
    ["hosted-target-preflight", ...hostedTargetPreflightBlockingCheckIds],
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:hosted-evidence-lane")
      .requiredHostedHandoffInputs,
    hostedEvidenceHandoffCase().inputIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:hosted-evidence-lane")
      .requiredHostedHandoffBlockedChecks,
    hostedEvidenceHandoffCase().blockedCheckIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:hosted-ops-signals")
      .requiredCheckIds,
    hostedOpsSignalCheckIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:hosted-ops-signals")
      .requiredRelatedLinkIds,
    hostedOpsSignalRelatedAuditIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink(
      "admin-proof:real-hosted-observability-handoff",
    ).requiredCheckIds,
    realHostedObservabilityHandoffCheckIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink(
      "admin-proof:real-hosted-observability-handoff",
    ).requiredHostedHandoffInputs,
    realHostedObservabilityHandoffCase().inputIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink(
      "admin-proof:real-hosted-observability-handoff",
    ).requiredHostedHandoffBlockedChecks,
    realHostedObservabilityHandoffCase().blockedCheckIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink(
      "admin-proof:real-hosted-observability-handoff",
    ).requiredRelatedLinkIds,
    [localAdminAuditIds.hostedOpsSignals, localAdminAuditIds.nextAction],
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:release")
      .requiredLocalPrerequisiteDestinations,
    [
      {
        id: localProofGraphAdminRoleHandoffsCheckId,
        auditId: localAdminAuditIds.proofGraph,
      },
      {
        id: localProofFreshnessAdminSurfaceCheckId,
        auditId: localAdminAuditIds.proofFreshness,
      },
      {
        id: localNextActionAdminSurfaceCheckId,
        auditId: localAdminAuditIds.nextAction,
      },
      {
        id: localHostedEvidenceLaneDemoProofCheckId,
        auditId: localAdminAuditIds.hostedEvidenceLane,
      },
    ],
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:spine-manifest")
      .requiredCheckIds,
    [
      "core-live-order-recorded",
      "live-spine-order-recorded",
      localAdminAuditHandoffCheckIds.proofFreshness,
      localAdminAuditHandoffCheckIds.nextAction,
    ],
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:spine-manifest")
      .requiredRelatedLinkIds,
    [localAdminAuditIds.proofFreshness, localAdminAuditIds.nextAction],
  );
});

test("admin proof destination handoff cases return cloned mutable rows", () => {
  const requirements = adminProofDestinationRequirements();
  requirements.find((item) => item.linkId === "admin-proof:release")
    .requiredCheckIds.push("mutated");
  requirements.find((item) => item.linkId === "admin-proof:hosted-evidence-lane")
    .requiredHostedHandoffInputs.push("mutated");
  requirements
    .find((item) => item.linkId === "admin-proof:hosted-evidence-lane")
    .requiredHostedHandoffBlockedChecks.push("mutated");
  requirements
    .find((item) => item.linkId === "admin-proof:hosted-identity-evidence")
    .requiredHostedHandoffInputs.push("mutated");
  requirements
    .find((item) => item.linkId === "admin-proof:hosted-identity-evidence")
    .requiredHostedHandoffBlockedChecks.push("mutated");
  requirements
    .find(
      (item) =>
        item.linkId === "admin-proof:real-hosted-observability-handoff",
    )
    .requiredHostedHandoffInputs.push("mutated");
  requirements
    .find(
      (item) =>
        item.linkId === "admin-proof:real-hosted-observability-handoff",
    )
    .requiredHostedHandoffBlockedChecks.push("mutated");
  assert.equal(
    adminProofDestinationRequirementForLink("admin-proof:release")
      .requiredCheckIds.includes("mutated"),
    false,
  );
  assert.equal(
    adminProofDestinationRequirementForLink("admin-proof:hosted-evidence-lane")
      .requiredHostedHandoffInputs.includes("mutated"),
    false,
  );
  assert.equal(
    adminProofDestinationRequirementForLink("admin-proof:hosted-evidence-lane")
      .requiredHostedHandoffBlockedChecks.includes("mutated"),
    false,
  );
  assert.equal(
    adminProofDestinationRequirementForLink(
      "admin-proof:hosted-identity-evidence",
    ).requiredHostedHandoffInputs.includes("mutated"),
    false,
  );
  assert.equal(
    adminProofDestinationRequirementForLink(
      "admin-proof:hosted-identity-evidence",
    ).requiredHostedHandoffBlockedChecks.includes("mutated"),
    false,
  );
  assert.equal(
    adminProofDestinationRequirementForLink(
      "admin-proof:real-hosted-observability-handoff",
    ).requiredHostedHandoffInputs.includes("mutated"),
    false,
  );
  assert.equal(
    adminProofDestinationRequirementForLink(
      "admin-proof:real-hosted-observability-handoff",
    ).requiredHostedHandoffBlockedChecks.includes("mutated"),
    false,
  );
});
