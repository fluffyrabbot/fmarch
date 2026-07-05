import {
  staleConflictMessageLaneIds,
} from "./dev_test_game_hardening_recovery_scenarios.mjs";
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
  hostedIdentityEvidenceCheckIds,
  hostedIdentityEvidenceHandoffCase,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  seedScenarioCoverageGroups,
} from "./dev_test_game_seed_scenario_cases.mjs";
import {
  devTestGameSeedFixturePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  localAdminAuditHandoffCheckIds,
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  adminSpineProofPath,
  adminSpineTerminalBatchProofPath,
  devTestGameReleaseReadinessPath,
  devTestGameProofGraphPath,
  nextActionPath,
  proofFreshnessAdminProofPath,
  spineManifestPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  devTestGameProofGraphCommand,
} from "./dev_test_game_proof_graph_paths.mjs";
import {
  proofGraphDestinationSummaryDriftNextActionAdminProofPath,
} from "./dev_test_game_next_action_admin_proof_paths.mjs";
import {
  terminalProofGraphEdgeTargetIds,
  terminalProofGraphReceiptArtifacts,
  terminalProofGraphUniqueReceiptTargets,
} from "./dev_test_game_proof_graph_receipt_artifact_rows.mjs";
import {
  productionFeatureGraphSourceNodeId,
} from "./dev_test_game_production_feature_graph_sources.mjs";
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

export const adminSpineProofCommand = "npm run test:dev-test-game-admin-spine";
export const spineManifestAdminProofCommand =
  "npm run test:dev-test-game-spine-manifest-admin-proof";
export const seedFixtureRecoveryCommand =
  "npm run test:dev-test-game-seed-fixture";
export const seedProofLaneCoverageRecoveryReason =
  "seed-proof-lane-coverage-drift";
export const terminalAdminProofBatchIds = Object.freeze([
  ...terminalProofGraphUniqueReceiptTargets.map((target) => target.proofId),
]);
export const terminalAdminProofBatchEdgeIds = Object.freeze([
  ...terminalProofGraphEdgeTargetIds,
]);
export const terminalAdminProofBatchArtifactPaths = Object.freeze([
  ...terminalProofGraphUniqueReceiptTargets.map((target) => target.artifactPath),
]);
export const terminalAdminProofBatchReceiptArtifacts = Object.freeze(
  terminalProofGraphReceiptArtifacts.map((artifact) =>
    Object.freeze({
      proofId: artifact.proofId,
      artifactPath: artifact.artifactPath,
      batchLabel: artifact.batchLabel,
    }),
  ),
);
export const proofGraphDiagnosticProofNodes = Object.freeze([
  Object.freeze({
    id: "diagnostic:proof-graph-destination-summary-drift",
    label: "Proof graph destination-summary drift branch",
    kind: "diagnostic-browser-proof",
    status: "passed",
    artifact: proofGraphDestinationSummaryDriftNextActionAdminProofPath,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.nextAction),
    proofCommand: "npm run test:dev-test-game-next-action-admin-proof",
    recoveryCommand: devTestGameProofGraphCommand,
    diagnostic: true,
    diagnosticReason: "proof-graph-destination-summary-drift",
    promotesFreshness: false,
    terminalArtifact: false,
  }),
]);
export const proofGraphDiagnosticProofEdges = Object.freeze([
  Object.freeze({
    from: "next-action",
    to: "diagnostic:proof-graph-destination-summary-drift",
    relationship: "diagnostic-browser-proof",
    reason: "proof-graph-destination-summary-drift",
    command: "npm run test:dev-test-game-next-action-admin-proof",
  }),
  Object.freeze({
    from: "diagnostic:proof-graph-destination-summary-drift",
    to: "proof-graph",
    relationship: "diagnoses",
    reason: "proof-graph-destination-summary-drift",
    command: devTestGameProofGraphCommand,
  }),
]);

export const adminProofDestinationRequirementCases = Object.freeze([
  Object.freeze({
    linkId: "admin-proof:core-loop",
    auditId: localAdminAuditIds.coreLoop,
    requiredCheckIds: Object.freeze([
      "core-loop",
      "private-channel",
      "host-lifecycle-control",
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:hardening",
    auditId: localAdminAuditIds.hardening,
    requiredCheckIds: Object.freeze([
      "idempotent-retry",
      "concurrent-action-race",
      ...staleConflictMessageLaneIds,
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:identity",
    auditId: localAdminAuditIds.identityAdapter,
    requiredCheckIds: Object.freeze(["session-rotation", "invite-revocation"]),
    requiredSessionIds: Object.freeze(["admin", "host", "player"]),
  }),
  Object.freeze({
    linkId: "admin-proof:hosted-identity-evidence",
    auditId: localAdminAuditIds.hostedIdentityEvidence,
    requiredCheckIds: Object.freeze([...hostedIdentityEvidenceCheckIds]),
    requiredUnprovenIds: Object.freeze([...hostedIdentityEvidenceCheckIds]),
    requiredHostedHandoffInputs: Object.freeze([
      ...hostedIdentityEvidenceHandoffCase().inputIds,
    ]),
    requiredHostedHandoffBlockedChecks: Object.freeze([
      ...hostedIdentityEvidenceHandoffCase().blockedCheckIds,
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:backup",
    auditId: localAdminAuditIds.backupRestore,
    requiredCheckIds: Object.freeze(["dump-created", "auth-sessions-restored"]),
    requiredSessionIds: Object.freeze(["host", "player", "admin"]),
  }),
  Object.freeze({
    linkId: "admin-proof:ops",
    auditId: localAdminAuditIds.opsArtifacts,
    requiredCheckIds: Object.freeze([
      "source-artifacts-checksummed",
      "release-boundary-carried",
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:seed",
    auditId: localAdminAuditIds.seedFixtures,
    requiredScenarioIds: Object.freeze([...seedScenarioCoverageGroups.allDemo]),
  }),
  Object.freeze({
    linkId: "admin-proof:release",
    auditId: localAdminAuditIds.releaseReadiness,
    requiredCheckIds: Object.freeze([
      "local-role-url-browser-proof",
      "local-core-loop-proof",
      "local-hardening-proof",
      localProofGraphAdminRoleHandoffsCheckId,
    ]),
    requiredLocalPrerequisiteDestinations: Object.freeze([
      Object.freeze({
        id: localProofGraphAdminRoleHandoffsCheckId,
        auditId: localAdminAuditIds.proofGraph,
      }),
      Object.freeze({
        id: localProofFreshnessAdminSurfaceCheckId,
        auditId: localAdminAuditIds.proofFreshness,
      }),
      Object.freeze({
        id: localNextActionAdminSurfaceCheckId,
        auditId: localAdminAuditIds.nextAction,
      }),
      Object.freeze({
        id: localHostedEvidenceLaneDemoProofCheckId,
        auditId: localAdminAuditIds.hostedEvidenceLane,
      }),
    ]),
    requiredUnprovenIds: Object.freeze([
      "hosted-deployment",
      "human-release-approval",
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:release-runbook",
    auditId: localAdminAuditIds.releaseRunbook,
    requiredCheckIds: Object.freeze([
      "remaining-readiness-gaps-mapped",
      "rollback-path-carried",
      "support-path-carried",
      "release-claim-boundary-carried",
      "human-approval-boundary-carried",
    ]),
    requiredUnprovenIds: Object.freeze(["human-release-approval"]),
    requiredRelatedLinkIds: Object.freeze([localAdminAuditIds.releaseReadiness]),
  }),
  Object.freeze({
    linkId: "admin-proof:race-coverage",
    auditId: localAdminAuditIds.raceCoverage,
    requiredCheckIds: Object.freeze(["player-vote-change", "player-night-action"]),
  }),
  Object.freeze({
    linkId: "admin-proof:hosted-target-preflight",
    auditId: localAdminAuditIds.hostedTargetPreflight,
    requiredCheckIds: Object.freeze([...hostedTargetPreflightCheckIds]),
    requiredRelatedLinkIds: Object.freeze([
      localAdminAuditIds.hostedConcurrentRaceMatrix,
      localAdminAuditIds.nextAction,
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:hosted-evidence-lane",
    auditId: localAdminAuditIds.hostedEvidenceLane,
    requiredCheckIds: Object.freeze([
      "hosted-target-preflight",
      ...hostedTargetPreflightBlockingCheckIds,
    ]),
    requiredHostedHandoffInputs: Object.freeze([
      ...hostedEvidenceHandoffCase().inputIds,
    ]),
    requiredHostedHandoffBlockedChecks: Object.freeze([
      ...hostedEvidenceHandoffCase().blockedCheckIds,
    ]),
    requiredRelatedLinkIds: Object.freeze([
      localAdminAuditIds.hostedTargetPreflight,
      localAdminAuditIds.hostedConcurrentRaceMatrix,
      localAdminAuditIds.nextAction,
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:hosted-concurrent-race-matrix",
    auditId: localAdminAuditIds.hostedConcurrentRaceMatrix,
    fromHostedMatrix: true,
  }),
  Object.freeze({
    linkId: "admin-proof:hosted-ops-signals",
    auditId: localAdminAuditIds.hostedOpsSignals,
    requiredCheckIds: Object.freeze([...hostedOpsSignalCheckIds]),
    requiredRelatedLinkIds: Object.freeze([...hostedOpsSignalRelatedAuditIds]),
  }),
  Object.freeze({
    linkId: "admin-proof:real-hosted-observability-handoff",
    auditId: localAdminAuditIds.realHostedObservabilityHandoff,
    requiredCheckIds: Object.freeze([...realHostedObservabilityHandoffCheckIds]),
    requiredHostedHandoffInputs: Object.freeze([
      ...realHostedObservabilityHandoffCase().inputIds,
    ]),
    requiredHostedHandoffBlockedChecks: Object.freeze([
      ...realHostedObservabilityHandoffCase().blockedCheckIds,
    ]),
    requiredRelatedLinkIds: Object.freeze([
      localAdminAuditIds.hostedOpsSignals,
      localAdminAuditIds.nextAction,
    ]),
  }),
  Object.freeze({
    linkId: "admin-proof:spine-manifest",
    auditId: localAdminAuditIds.spineManifest,
    requiredCheckIds: Object.freeze([
      "core-live-order-recorded",
      "live-spine-order-recorded",
      localAdminAuditHandoffCheckIds.proofFreshness,
      localAdminAuditHandoffCheckIds.nextAction,
    ]),
    requiredRelatedLinkIds: Object.freeze([
      localAdminAuditIds.proofFreshness,
      localAdminAuditIds.nextAction,
    ]),
  }),
]);

export const adminProofDestinationRequirementLinkRows = Object.freeze(
  adminProofDestinationRequirementCases.map((requirement) =>
    Object.freeze([requirement.linkId, requirement.auditId]),
  ),
);

export function adminProofDestinationRequirementRoleRows({
  game = "<seeded-game>",
} = {}) {
  return adminProofDestinationRequirementCases.map((requirement) =>
    Object.freeze({
      linkId: requirement.linkId,
      auditId: requirement.auditId,
      roleUrl: adminProofDestinationRoleUrl({
        auditId: requirement.auditId,
        game,
      }),
    }),
  );
}

export function devTestGameProofGraphFirstClassNodes({
  game = "<seeded-game>",
} = {}) {
  return Object.freeze([
    proofGraphSurfaceNode({
      id: "admin-spine",
      label: "Local admin spine",
      status: "passed",
      artifact: adminSpineProofPath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.adminSpine, { game }),
      recoveryCommand: adminSpineProofCommand,
    }),
    proofGraphSurfaceNode({
      id: "spine-manifest",
      label: "Local spine manifest",
      status: "passed",
      artifact: spineManifestPath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.spineManifest, {
        game,
      }),
      recoveryCommand: spineManifestAdminProofCommand,
    }),
    proofGraphSurfaceNode({
      id: "proof-graph",
      label: "Local proof graph",
      status: "passed",
      artifact: devTestGameProofGraphPath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph, { game }),
      recoveryCommand: devTestGameProofGraphCommand,
    }),
    proofGraphSurfaceNode({
      id: "proof-freshness",
      label: "Local proof freshness",
      status: "passed",
      artifact: proofFreshnessAdminProofPath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofFreshness, {
        game,
      }),
      recoveryCommand: proofFreshnessAdminProofCommand,
    }),
    proofGraphSurfaceNode({
      id: "next-action",
      label: "Local next action",
      status: "recorded",
      artifact: nextActionPath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.nextAction, { game }),
      recoveryCommand: nextActionCommand,
    }),
    Object.freeze({
      id: "admin-spine-terminal-batches",
      label: "Admin spine terminal proof batches",
      kind: "terminal-proof-batch-receipt",
      status: "passed",
      artifact: adminSpineTerminalBatchProofPath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.adminSpine, { game }),
      batchCount: 3,
      proofIds: terminalAdminProofBatchIds,
      artifactPaths: terminalAdminProofBatchArtifactPaths,
      receiptArtifacts: terminalAdminProofBatchReceiptArtifacts,
    }),
    ...proofGraphDiagnosticProofNodes.map((node) =>
      Object.freeze({
        ...node,
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.nextAction, { game }),
      }),
    ),
  ]);
}

export function devTestGameProofGraphBaseEdges({
  game = "<seeded-game>",
} = {}) {
  return Object.freeze([
    proofGraphEdge({
      from: "admin-spine",
      to: "spine-manifest",
      relationship: "aggregates",
    }),
    proofGraphEdge({
      from: "spine-manifest",
      to: "proof-graph",
      relationship: "records",
    }),
    proofGraphEdge({
      from: "spine-manifest",
      to: "proof-freshness",
      relationship: "records",
    }),
    proofGraphEdge({
      from: "spine-manifest",
      to: "next-action",
      relationship: "records",
    }),
    proofGraphEdge({
      from: "proof-freshness",
      to: "next-action",
      relationship: "recovers-through",
    }),
    ...terminalAdminProofBatchEdgeIds.map((proofId) =>
      proofGraphEdge({
        from: "admin-spine-terminal-batches",
        to: proofId,
        relationship: "terminal-browser-proof",
      }),
    ),
    proofGraphEdge({
      from: "next-action",
      to: "admin-proof:seed",
      relationship: "recovery-target",
      reason: seedProofLaneCoverageRecoveryReason,
      command: seedFixtureRecoveryCommand,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.seedFixtures, { game }),
      proofTarget: devTestGameSeedFixturePath,
    }),
    ...proofGraphDiagnosticProofEdges,
    ...adminProofDestinationRequirementLinkRows.map(([linkId]) =>
      proofGraphEdge({
        from: "admin-spine",
        to: linkId,
        relationship: "aggregates",
      }),
    ),
  ]);
}

export function adminProofDestinationProofGraphNodes({
  game = "<seeded-game>",
  status = "passed",
} = {}) {
  return adminProofDestinationRequirementRoleRows({ game }).map(
    ({ linkId, auditId, roleUrl }) =>
      Object.freeze({
        id: linkId,
        label: `${auditId} admin proof`,
        kind: "proof-surface",
        status,
        artifact: adminProofDestinationArtifactPath(linkId),
        roleUrl,
        recoveryCommand: adminProofDestinationRecoveryCommand(linkId),
      }),
  );
}

export function proofGraphProductionFeatureCase({
  spineTarget,
  artifact = devTestGameReleaseReadinessPath,
  status = "passed",
}) {
  return Object.freeze({
    id: `production-feature:${spineTarget.featureSlotId}`,
    label: `Production feature: ${spineTarget.featureSlotId}`,
    featureSlotId: spineTarget.featureSlotId,
    status,
    artifact,
    roleUrl: spineTarget.detailRoleUrl,
    provingNodeId: productionFeatureGraphSourceNodeId(spineTarget.sourceCheckId),
    targetRoleUrl: spineTarget.roleUrl,
    browserProofCommand: spineTarget.browserProofCommand,
    coverageDecision: spineTarget.coverageDecision,
  });
}

export function proofGraphProductionFeatureNode(featureCase) {
  return Object.freeze({
    id: featureCase.id,
    label: featureCase.label,
    kind: "production-feature-spine-target",
    status: featureCase.status,
    artifact: featureCase.artifact,
    roleUrl: featureCase.roleUrl,
    targetRoleUrl: featureCase.targetRoleUrl,
    browserProofCommand: featureCase.browserProofCommand,
    coverageDecision: featureCase.coverageDecision,
  });
}

export function proofGraphProductionFeatureEdge(featureCase) {
  return proofGraphEdge({
    from: featureCase.provingNodeId,
    to: featureCase.id,
    relationship: "proves-production-feature",
    featureSlotId: featureCase.featureSlotId,
    targetRoleUrl: featureCase.targetRoleUrl,
    command: featureCase.browserProofCommand,
  });
}

export function proofGraphRecoveryReceiptNodes(recoveryReceiptCases) {
  return recoveryReceiptCases.map(({ graph, label, kind, recoveryCommand }) =>
    proofGraphRecoveryReceiptNode({ graph, label, kind, recoveryCommand }),
  );
}

export function proofGraphRecoveryReceiptCase({ descriptor, graph }) {
  return Object.freeze({
    graph,
    label: descriptor.label,
    kind: descriptor.kind,
    recoveryCommand: descriptor.proofCommand,
    provingNodeId: descriptor.provingNodeId,
  });
}

export function proofGraphRecoveryReceiptEdges(recoveryReceiptCases) {
  return recoveryReceiptCases.flatMap(({ graph, provingNodeId }) =>
    proofGraphRecoveryReceiptEdgeRows({ graph, provingNodeId }),
  );
}

export function proofGraphRecoveryReceiptNode({
  graph,
  label,
  kind,
  recoveryCommand,
}) {
  return Object.freeze({
    id: graph.nodeId,
    label,
    kind,
    status: graph.status,
    artifact: graph.proofTarget,
    roleUrl: graph.roleUrl,
    proofCommand: recoveryCommand,
    recoveryCommand,
    familyId: graph.familyId,
    laneCount: graph.laneCount,
    laneIds: graph.laneIds,
    normalizedEvidenceObjects: graph.normalizedEvidenceObjects,
  });
}

function proofGraphRecoveryReceiptEdgeRows({ graph, provingNodeId }) {
  return Object.freeze([
    proofGraphEdge({
      from: provingNodeId,
      to: graph.nodeId,
      relationship: "proves",
    }),
    proofGraphEdge({
      from: graph.nodeId,
      to: "proof-graph",
      relationship: "records",
    }),
    proofGraphEdge({
      from: graph.nodeId,
      to: "next-action",
      relationship: "summarizes-into",
    }),
  ]);
}

export function adminProofDestinationArtifactPath(linkId) {
  const proofId = adminProofDestinationProofId(linkId);
  return `target/dev-test-game/${proofId}-admin-proof.json`;
}

export function adminProofDestinationRecoveryCommand(linkId) {
  const proofId = adminProofDestinationProofId(linkId);
  return `npm run test:dev-test-game-${proofId}-admin-proof`;
}

export function adminProofDestinationRoleUrl({ auditId, game = "<seeded-game>" }) {
  return localAdminAuditRoleUrl(auditId, { game });
}

export function adminProofDestinationRequirements() {
  return adminProofDestinationRequirementCases.map((requirement) =>
    cloneRequirement(requirement),
  );
}

export function adminProofDestinationRequirementForLink(linkId) {
  const requirement = adminProofDestinationRequirementCases.find(
    (item) => item.linkId === linkId,
  );
  return requirement === undefined ? undefined : cloneRequirement(requirement);
}

function cloneRequirement(requirement) {
  return {
    linkId: requirement.linkId,
    auditId: requirement.auditId,
    ...(requirement.requiredCheckIds === undefined
      ? {}
      : { requiredCheckIds: [...requirement.requiredCheckIds] }),
    ...(requirement.requiredCheckStatuses === undefined
      ? {}
      : { requiredCheckStatuses: { ...requirement.requiredCheckStatuses } }),
    ...(requirement.requiredScenarioIds === undefined
      ? {}
      : { requiredScenarioIds: [...requirement.requiredScenarioIds] }),
    ...(requirement.requiredSessionIds === undefined
      ? {}
      : { requiredSessionIds: [...requirement.requiredSessionIds] }),
    ...(requirement.requiredUnprovenIds === undefined
      ? {}
      : { requiredUnprovenIds: [...requirement.requiredUnprovenIds] }),
    ...(requirement.requiredHostedHandoffInputs === undefined
      ? {}
      : {
          requiredHostedHandoffInputs: [
            ...requirement.requiredHostedHandoffInputs,
          ],
        }),
    ...(requirement.requiredHostedHandoffBlockedChecks === undefined
      ? {}
      : {
          requiredHostedHandoffBlockedChecks: [
            ...requirement.requiredHostedHandoffBlockedChecks,
          ],
        }),
    ...(requirement.requiredLocalPrerequisiteDestinations === undefined
      ? {}
      : {
          requiredLocalPrerequisiteDestinations:
            requirement.requiredLocalPrerequisiteDestinations.map((item) => ({
              ...item,
            })),
        }),
    ...(requirement.requiredRelatedLinkIds === undefined
      ? {}
      : { requiredRelatedLinkIds: [...requirement.requiredRelatedLinkIds] }),
    ...(requirement.fromHostedMatrix === undefined
      ? {}
      : { fromHostedMatrix: requirement.fromHostedMatrix }),
  };
}

function adminProofDestinationProofId(linkId) {
  return String(linkId).replace("admin-proof:", "");
}

function proofGraphSurfaceNode({
  id,
  label,
  status,
  artifact,
  roleUrl,
  recoveryCommand,
}) {
  return Object.freeze({
    id,
    label,
    kind: "proof-surface",
    status,
    artifact,
    roleUrl,
    recoveryCommand,
  });
}

function proofGraphEdge(edge) {
  return Object.freeze(edge);
}
