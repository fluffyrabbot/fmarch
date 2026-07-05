import {
  coreLoopPrivateChannelRecoveryCoverageFamilies,
  coreLoopPrivateChannelRecoveryLaneIds,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  replacementActionRecoveryCoverageFamilies,
  replacementActionLaneIds,
} from "./dev_test_game_replacement_action_scenario_cases.mjs";
import {
  replacementHandoffRecoveryCoverageFamilies,
  replacementHandoffRecoveryLaneIds,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";
import {
  replacementPrivateChannelRecoveryCoverageFamilies,
  replacementPrivateChannelRecoveryLaneIds,
} from "./dev_test_game_replacement_private_scenarios.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  privateChannelNormalizedEvidenceObjects,
  replacementPrivatePostNormalizedEvidenceObjects,
  sameNormalizedEvidenceObjects,
} from "./dev_test_game_normalized_evidence_objects.mjs";
import {
  assertDevTestGamePrivateChannelRecoveryReceipt,
  buildDevTestGamePrivateChannelRecoveryReceipt,
  devTestGamePrivateChannelRecoveryReceiptCommand,
  devTestGamePrivateChannelRecoveryReceiptPath,
} from "./dev_test_game_private_channel_recovery_receipt.mjs";
import {
  assertDevTestGameReplacementActionRecoveryReceipt,
  buildDevTestGameReplacementActionRecoveryReceipt,
  devTestGameReplacementActionRecoveryReceiptCommand,
  devTestGameReplacementActionRecoveryReceiptPath,
} from "./dev_test_game_replacement_action_recovery_receipt.mjs";
import {
  assertDevTestGameReplacementHandoffRecoveryReceipt,
  buildDevTestGameReplacementHandoffRecoveryReceipt,
  devTestGameReplacementHandoffRecoveryReceiptCommand,
  devTestGameReplacementHandoffRecoveryReceiptPath,
} from "./dev_test_game_replacement_handoff_recovery_receipt.mjs";
import {
  assertDevTestGameReplacementPrivateRecoveryReceipt,
  buildDevTestGameReplacementPrivateRecoveryReceipt,
  devTestGameReplacementPrivateRecoveryReceiptCommand,
  devTestGameReplacementPrivateRecoveryReceiptPath,
} from "./dev_test_game_replacement_private_recovery_receipt.mjs";

const recoveryReceiptRelationships = Object.freeze([
  "proves",
  "records",
  "summarizes-into",
]);

export const recoveryReceiptGraphDescriptors = Object.freeze([
  recoveryReceiptGraphDescriptor({
    receiptKey: "privateChannelRecoveryReceipt",
    sourceKey: "privateChannelRecoveryReceiptSource",
    nextActionGeneratedFromKey: "privateChannelRecoveryGraph",
    summaryLaneCountKey: "privateChannelRecoveryLaneCount",
    envVar: "FMARCH_DEV_TEST_GAME_PRIVATE_CHANNEL_RECOVERY_RECEIPT",
    pathOptionKey: "privateChannelRecoveryReceiptPath",
    artifactOptionKey: "privateChannelRecoveryReceiptArtifact",
    checkId: "private-channel-recovery-graph",
    readinessCheckId: "local-private-channel-recovery-receipt",
    readinessLabel: "Local private-channel recovery receipt",
    releaseReadinessOrder: 10,
    nodeId: "private-channel-recovery-receipt",
    label: "Private-channel recovery receipt",
    kind: "private-channel-recovery-receipt",
    provingNodeId: "admin-proof:core-loop",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
    proofCommand: devTestGamePrivateChannelRecoveryReceiptCommand,
    proofScript: "tools/dev_test_game_private_channel_recovery_receipt.mjs",
    proofTarget: devTestGamePrivateChannelRecoveryReceiptPath,
    manifestDependsOn: Object.freeze([
      "target/dev-test-game/proof-run.json",
      "target/dev-test-game/core-loop-admin-proof.json",
    ]),
    familyId: "core-loop-private-channel-recovery",
    laneIds: coreLoopPrivateChannelRecoveryLaneIds,
    normalizedEvidenceObjects: privateChannelNormalizedEvidenceObjects,
    receiptFixture: {
      scope: "local-dev-test-game-private-channel-recovery",
      proofBoundary: "Local private-channel recovery receipt.",
      familyCount: coreLoopPrivateChannelRecoveryCoverageFamilies().length,
      evidence: { channel: "private:mafia_day_chat" },
      adminProofSourceKey: "coreLoopAdminProof",
      adminProofSourcePath: "target/dev-test-game/core-loop-admin-proof.json",
    },
    buildReceipt: buildDevTestGamePrivateChannelRecoveryReceipt,
    assertReceipt: assertDevTestGamePrivateChannelRecoveryReceipt,
  }),
  recoveryReceiptGraphDescriptor({
    receiptKey: "replacementActionRecoveryReceipt",
    sourceKey: "replacementActionRecoveryReceiptSource",
    nextActionGeneratedFromKey: "replacementActionRecoveryGraph",
    summaryLaneCountKey: "replacementActionRecoveryLaneCount",
    envVar: "FMARCH_DEV_TEST_GAME_REPLACEMENT_ACTION_RECOVERY_RECEIPT",
    pathOptionKey: "replacementActionRecoveryReceiptPath",
    artifactOptionKey: "replacementActionRecoveryReceiptArtifact",
    checkId: "replacement-action-recovery-graph",
    readinessCheckId: "local-replacement-action-recovery-receipt",
    readinessLabel: "Local replacement action recovery receipt",
    releaseReadinessOrder: 30,
    nodeId: "replacement-action-recovery-receipt",
    label: "Replacement action recovery receipt",
    kind: "replacement-action-recovery-receipt",
    provingNodeId: "admin-proof:hardening",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hardening),
    proofCommand: devTestGameReplacementActionRecoveryReceiptCommand,
    proofScript: "tools/dev_test_game_replacement_action_recovery_receipt.mjs",
    proofTarget: devTestGameReplacementActionRecoveryReceiptPath,
    manifestDependsOn: replacementRecoveryReceiptManifestDependencies(),
    familyId: "replacement-action-recovery",
    laneIds: replacementActionLaneIds,
    receiptFixture: {
      scope: "local-dev-test-game-replacement-action-recovery",
      proofBoundary: "Local replacement action recovery receipt.",
      familyCount: replacementActionRecoveryCoverageFamilies().length,
      evidence: { targetSlot: "slot-2" },
      adminProofSourceKey: "hardeningAdminProof",
      adminProofSourcePath: "target/dev-test-game/hardening-admin-proof.json",
    },
    buildReceipt: buildDevTestGameReplacementActionRecoveryReceipt,
    assertReceipt: assertDevTestGameReplacementActionRecoveryReceipt,
  }),
  recoveryReceiptGraphDescriptor({
    receiptKey: "replacementHandoffRecoveryReceipt",
    sourceKey: "replacementHandoffRecoveryReceiptSource",
    nextActionGeneratedFromKey: "replacementHandoffRecoveryGraph",
    summaryLaneCountKey: "replacementHandoffRecoveryLaneCount",
    envVar: "FMARCH_DEV_TEST_GAME_REPLACEMENT_HANDOFF_RECOVERY_RECEIPT",
    pathOptionKey: "replacementHandoffRecoveryReceiptPath",
    artifactOptionKey: "replacementHandoffRecoveryReceiptArtifact",
    checkId: "replacement-handoff-recovery-graph",
    readinessCheckId: "local-replacement-handoff-recovery-receipt",
    readinessLabel: "Local replacement handoff recovery receipt",
    releaseReadinessOrder: 40,
    nodeId: "replacement-handoff-recovery-receipt",
    label: "Replacement handoff recovery receipt",
    kind: "replacement-handoff-recovery-receipt",
    provingNodeId: "admin-proof:hardening",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hardening),
    proofCommand: devTestGameReplacementHandoffRecoveryReceiptCommand,
    proofScript: "tools/dev_test_game_replacement_handoff_recovery_receipt.mjs",
    proofTarget: devTestGameReplacementHandoffRecoveryReceiptPath,
    manifestDependsOn: replacementRecoveryReceiptManifestDependencies(),
    familyId: "replacement-handoff-recovery",
    laneIds: replacementHandoffRecoveryLaneIds,
    receiptFixture: {
      scope: "local-dev-test-game-replacement-handoff-recovery",
      proofBoundary: "Local replacement handoff recovery receipt.",
      familyCount: replacementHandoffRecoveryCoverageFamilies().length,
      evidence: { slot: "slot-2" },
      adminProofSourceKey: "hardeningAdminProof",
      adminProofSourcePath: "target/dev-test-game/hardening-admin-proof.json",
    },
    buildReceipt: buildDevTestGameReplacementHandoffRecoveryReceipt,
    assertReceipt: assertDevTestGameReplacementHandoffRecoveryReceipt,
  }),
  recoveryReceiptGraphDescriptor({
    receiptKey: "replacementPrivateRecoveryReceipt",
    sourceKey: "replacementPrivateRecoveryReceiptSource",
    nextActionGeneratedFromKey: "replacementPrivateRecoveryGraph",
    summaryLaneCountKey: "replacementPrivateRecoveryLaneCount",
    envVar: "FMARCH_DEV_TEST_GAME_REPLACEMENT_PRIVATE_RECOVERY_RECEIPT",
    pathOptionKey: "replacementPrivateRecoveryReceiptPath",
    artifactOptionKey: "replacementPrivateRecoveryReceiptArtifact",
    checkId: "replacement-private-recovery-graph",
    readinessCheckId: "local-replacement-private-recovery-receipt",
    readinessLabel: "Local replacement private-channel recovery receipt",
    releaseReadinessOrder: 20,
    nodeId: "replacement-private-recovery-receipt",
    label: "Replacement private-channel recovery receipt",
    kind: "replacement-private-recovery-receipt",
    provingNodeId: "admin-proof:hardening",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hardening),
    proofCommand: devTestGameReplacementPrivateRecoveryReceiptCommand,
    proofScript: "tools/dev_test_game_replacement_private_recovery_receipt.mjs",
    proofTarget: devTestGameReplacementPrivateRecoveryReceiptPath,
    manifestDependsOn: replacementRecoveryReceiptManifestDependencies(),
    familyId: "replacement-private-channel-recovery",
    laneIds: replacementPrivateChannelRecoveryLaneIds,
    normalizedEvidenceObjects: replacementPrivatePostNormalizedEvidenceObjects,
    receiptFixture: {
      scope: "local-dev-test-game-replacement-private-recovery",
      proofBoundary: "Local replacement private-channel recovery receipt.",
      familyCount: replacementPrivateChannelRecoveryCoverageFamilies().length,
      evidence: { channel: "private:mafia_day_chat" },
      adminProofSourceKey: "hardeningAdminProof",
      adminProofSourcePath: "target/dev-test-game/hardening-admin-proof.json",
    },
    buildReceipt: buildDevTestGameReplacementPrivateRecoveryReceipt,
    assertReceipt: assertDevTestGameReplacementPrivateRecoveryReceipt,
  }),
]);

export const recoveryReceiptReleaseReadinessDescriptors = Object.freeze(
  [...recoveryReceiptGraphDescriptors].sort(
    (left, right) => left.releaseReadinessOrder - right.releaseReadinessOrder,
  ),
);

export function recoveryReceiptGraphDescriptorByReceiptKey(receiptKey) {
  const descriptor = recoveryReceiptGraphDescriptors.find(
    (candidate) => candidate.receiptKey === receiptKey,
  );
  if (descriptor === undefined) {
    throw new Error(`unknown recovery receipt graph descriptor: ${receiptKey}`);
  }
  return descriptor;
}

export function recoveryReceiptProofPlanSteps(options = {}) {
  return filteredRecoveryReceiptGraphDescriptors(options).map((descriptor) => ({
    kind: "node",
    script: descriptor.proofScript,
  }));
}

export function recoveryReceiptProofTargets(options = {}) {
  return filteredRecoveryReceiptGraphDescriptors(options).map(
    (descriptor) => descriptor.proofTarget,
  );
}

export function buildRecoveryReceiptGraphNode({
  descriptor,
  receipt,
  source,
}) {
  if (receipt === null) {
    return null;
  }
  return {
    id: descriptor.nodeId,
    label: descriptor.label,
    kind: descriptor.kind,
    status: receipt.status,
    artifact: source,
    roleUrl: receipt.roleUrl,
    proofCommand: descriptor.proofCommand,
    recoveryCommand: descriptor.proofCommand,
    familyId: receipt.familyId,
    laneCount: receipt.laneCount,
    laneIds: receipt.laneIds,
    ...(receipt.normalizedEvidenceObjects === undefined
      ? {}
      : { normalizedEvidenceObjects: receipt.normalizedEvidenceObjects }),
  };
}

export function validateRecoveryReceiptArtifact(
  proof,
  descriptor,
  options = {},
) {
  const receipt = descriptor.assertReceipt(proof);
  return {
    status: "passed",
    path: options.path ?? descriptor.proofTarget,
    proofBoundary: receipt.proofBoundary,
    roleUrl: receipt.generatedFrom.roleUrl,
    familyId: receipt.generatedFrom.family.id,
    laneCount: receipt.summary.laneCount,
    passedLaneCount: receipt.summary.passedLaneCount,
    laneIds: [...receipt.laneIds],
    ...(receipt.normalizedEvidenceObjects === undefined
      ? {}
      : { normalizedEvidenceObjects: receipt.normalizedEvidenceObjects }),
    ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
  };
}

export function recoveryReceiptReadinessCheck(receiptEvidence, descriptor) {
  if (receiptEvidence === undefined) {
    return null;
  }
  return {
    id: descriptor.readinessCheckId,
    label: descriptor.readinessLabel,
    status: "passed",
    evidence: receiptEvidence.path,
    proofBoundary: receiptEvidence.proofBoundary,
    roleUrl: receiptEvidence.roleUrl,
    laneCount: receiptEvidence.laneCount,
    laneIds: receiptEvidence.laneIds,
    ...(receiptEvidence.normalizedEvidenceObjects === undefined
      ? {}
      : { normalizedEvidenceObjects: receiptEvidence.normalizedEvidenceObjects }),
  };
}

export function recoveryReceiptEvidenceByKeyFromOptions(options) {
  return Object.fromEntries(
    recoveryReceiptGraphDescriptors.map((descriptor) => [
      descriptor.receiptKey,
      options[descriptor.receiptKey]
        ? validateRecoveryReceiptArtifact(options[descriptor.receiptKey], descriptor, {
            path: options[descriptor.pathOptionKey] ?? descriptor.proofTarget,
            artifact: options[descriptor.artifactOptionKey],
          })
        : undefined,
    ]),
  );
}

export function recoveryReceiptGeneratedFromPaths(evidenceByKey) {
  return Object.fromEntries(
    recoveryReceiptGraphDescriptors.flatMap((descriptor) => {
      const evidence = evidenceByKey[descriptor.receiptKey];
      return evidence === undefined
        ? []
        : [[descriptor.receiptKey, evidence.path]];
    }),
  );
}

export function recoveryReceiptEvidenceSnapshots(evidenceByKey) {
  return Object.fromEntries(
    recoveryReceiptGraphDescriptors.flatMap((descriptor) => {
      const evidence = evidenceByKey[descriptor.receiptKey];
      return evidence === undefined
        ? []
        : [[descriptor.receiptKey, evidence]];
    }),
  );
}

export function recoveryReceiptOptionalReadinessArtifactDescriptor({
  descriptor,
  repoRoot,
}) {
  return {
    id: descriptor.receiptKey,
    envVar: descriptor.envVar,
    defaultPath: `${repoRoot}/${descriptor.proofTarget}`,
    outputKeys: {
      data: descriptor.receiptKey,
      path: descriptor.pathOptionKey,
      freshnessMetadata: descriptor.artifactOptionKey,
    },
    validator: (proof, options = {}) =>
      validateRecoveryReceiptArtifact(proof, descriptor, options),
    ignoreInvalidDefault: true,
  };
}

export function buildRecoveryReceiptGraphEdges({ descriptor, receipt }) {
  if (receipt === null) {
    return [];
  }
  return [
    [
      descriptor.provingNodeId,
      descriptor.nodeId,
      "proves",
      {
        roleUrl: receipt.roleUrl,
        proofTarget: receipt.path,
      },
    ],
    [
      descriptor.nodeId,
      "proof-graph",
      "records",
      { proofTarget: receipt.path },
    ],
    [
      descriptor.nodeId,
      "next-action",
      "summarizes-into",
      { proofTarget: receipt.path },
    ],
  ];
}

export function recoveryReceiptGraphSummaryFromProofGraph(proofGraph, descriptor) {
  if (proofGraph === null) {
    return null;
  }
  const node = proofGraph.nodes.find(
    (candidate) => candidate?.id === descriptor.nodeId,
  );
  if (node === undefined) {
    return null;
  }
  const edges = recoveryReceiptGraphEdgesForNode(proofGraph, descriptor);
  return {
    nodeId: node.id,
    status: String(node.status ?? "unknown"),
    proofTarget: String(node.artifact ?? ""),
    roleUrl: String(node.roleUrl ?? ""),
    familyId: String(node.familyId ?? ""),
    laneCount: Number(node.laneCount ?? 0),
    laneIds: Array.isArray(node.laneIds)
      ? node.laneIds.map((laneId) => String(laneId))
      : [],
    ...(node.normalizedEvidenceObjects === undefined
      ? {}
      : { normalizedEvidenceObjects: node.normalizedEvidenceObjects }),
    edgeCount: edges.length,
    edgeTargets: edges.map((edge) =>
      String(edge.from === node.id ? edge.to : edge.from),
    ),
  };
}

export function assertRecoveryReceiptGraphSummary(
  summary,
  descriptor,
  { label = "recovery receipt graph" } = {},
) {
  if (summary === undefined) {
    return;
  }
  if (
    summary === null ||
    summary.nodeId !== descriptor.nodeId ||
    summary.status !== "passed" ||
    summary.proofTarget !== descriptor.proofTarget ||
    summary.roleUrl !== descriptor.roleUrl ||
    summary.familyId !== descriptor.familyId ||
    summary.laneCount !== descriptor.laneIds.length ||
    !Array.isArray(summary.laneIds) ||
    summary.laneIds.length !== descriptor.laneIds.length ||
    summary.edgeCount !== 3 ||
    JSON.stringify(summary.edgeTargets) !==
      JSON.stringify([descriptor.provingNodeId, "proof-graph", "next-action"])
  ) {
    throw new Error(`${label} ${descriptor.nodeId} summary drifted`);
  }
}

export function assertProofGraphCoversRecoveryReceipt(graph, descriptor) {
  const node = (graph?.nodes ?? []).find(
    (candidate) => candidate.id === descriptor.nodeId,
  );
  if (graph?.generatedFrom?.[descriptor.receiptKey] === undefined) {
    if (
      node !== undefined ||
      graph.summary?.[descriptor.summaryLaneCountKey] !== 0
    ) {
      throw new Error(`proof graph ${descriptor.nodeId} summary drifted`);
    }
    return graph;
  }
  if (
    node?.kind !== descriptor.kind ||
    node.status !== "passed" ||
    node.artifact !== graph.generatedFrom[descriptor.receiptKey] ||
    node.roleUrl !== descriptor.roleUrl ||
    node.proofCommand !== descriptor.proofCommand ||
    node.recoveryCommand !== descriptor.proofCommand ||
    node.laneCount !== graph.summary[descriptor.summaryLaneCountKey]
  ) {
    throw new Error(`proof graph ${descriptor.nodeId} node drifted`);
  }
  if (
    descriptor.normalizedEvidenceObjects.length > 0 &&
    !sameNormalizedEvidenceObjects(
      node.normalizedEvidenceObjects,
      descriptor.normalizedEvidenceObjects.map((object) => ({
        ...object,
        status: "passed",
        evidencePath: `lanes.${object.laneId}.evidence.${object.name}`,
      })),
    )
  ) {
    throw new Error(`proof graph ${descriptor.nodeId} evidence objects drifted`);
  }
  for (const [from, to, relationship] of [
    [descriptor.provingNodeId, descriptor.nodeId, "proves"],
    [descriptor.nodeId, "proof-graph", "records"],
    [descriptor.nodeId, "next-action", "summarizes-into"],
  ]) {
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === from &&
          edge.to === to &&
          edge.relationship === relationship,
      )
    ) {
      throw new Error(`proof graph ${descriptor.nodeId} edge missing: ${from}->${to}`);
    }
  }
  return graph;
}

function recoveryReceiptGraphDescriptor(descriptor) {
  return Object.freeze({
    ...descriptor,
    laneIds: Object.freeze([...descriptor.laneIds]),
    manifestDependsOn: Object.freeze([...descriptor.manifestDependsOn]),
    normalizedEvidenceObjects: Object.freeze(
      (descriptor.normalizedEvidenceObjects ?? []).map((object) =>
        Object.freeze({ ...object }),
      ),
    ),
    receiptFixture: Object.freeze({
      ...descriptor.receiptFixture,
      evidence: Object.freeze({ ...descriptor.receiptFixture.evidence }),
    }),
  });
}

function replacementRecoveryReceiptManifestDependencies() {
  return Object.freeze([
    "target/dev-test-game/proof-run.json",
    "target/dev-test-game/hardening-admin-proof.json",
  ]);
}

function filteredRecoveryReceiptGraphDescriptors({ provingNodeId } = {}) {
  return recoveryReceiptGraphDescriptors.filter(
    (descriptor) =>
      provingNodeId === undefined || descriptor.provingNodeId === provingNodeId,
  );
}

function recoveryReceiptGraphEdgesForNode(proofGraph, descriptor) {
  return proofGraph.edges.filter(
    (candidate) =>
      (candidate?.from === descriptor.nodeId ||
        candidate?.to === descriptor.nodeId) &&
      recoveryReceiptRelationships.includes(
        String(candidate?.relationship ?? ""),
      ),
  );
}
