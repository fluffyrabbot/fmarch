import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameReleaseReadiness,
  validateDevTestGameAdminSpineProof,
  validateDevTestGameAdminSpineTerminalBatches,
  validateDevTestGamePrivateChannelRecoveryReceipt,
} from "./dev_test_game_release_readiness.mjs";
import {
  assertDevTestGameNextAction,
  devTestGameIdentityAdminProofCommand,
  devTestGameLiveProofCommand,
  devTestGameNextActionPath,
  devTestGameReleaseReadinessPath,
  devTestGameSeedFixtureCommand,
  devTestGameSeedFixturePath,
  devTestGameSeedFixtureRoleUrl,
} from "./dev_test_game_next_action.mjs";
import { assertDevTestGameSpineManifest } from "./dev_test_game_spine_manifest.mjs";
import {
  assertProductionFacingSurfaceGraphCoverage,
  productionFacingSurfaceChecklistItems,
} from "./dev_test_game_production_surface_checklist.mjs";
import {
  featureSpineRowKind,
} from "./dev_test_game_feature_spine_targets.mjs";
import {
  productionFeatureGraphSourceNodeId as productionFeatureSourceGraphNodeId,
} from "./dev_test_game_production_feature_graph_sources.mjs";
import {
  coreLoopFeatureSpineSourceCheckId,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  hardeningFeatureSpineSourceCheckId,
} from "./dev_test_game_hardening_feature_spine_targets.mjs";
import {
  identityFeatureSpineSourceCheckId,
} from "./dev_test_game_identity_feature_spine_targets.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGamePrivateChannelRecoveryReceiptCommand,
  devTestGamePrivateChannelRecoveryReceiptPath,
} from "./dev_test_game_private_channel_recovery_receipt.mjs";
export {
  devTestGameProofGraphAdminProofCommand,
  devTestGameProofGraphAdminProofPath,
  devTestGameProofGraphCommand,
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import { devTestGameProofGraphPath } from "./dev_test_game_proof_graph_paths.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_PROOF_GRAPH_VERSION = 1;

const proofGraphJsonPath = path.join(repoRoot, devTestGameProofGraphPath);
const defaultAdminSpineTerminalBatchProofPath =
  "target/dev-test-game/admin-spine-terminal-batches.json";
const defaultPrivateChannelRecoveryReceiptPath =
  devTestGamePrivateChannelRecoveryReceiptPath;

export function buildDevTestGameProofGraph(
  {
    spineManifest,
    adminSpineProof,
    adminSpineTerminalBatches = null,
    privateChannelRecoveryReceipt = null,
    nextAction = null,
    releaseReadiness,
  },
  {
    generatedAt = new Date().toISOString(),
    spineManifestSource = "target/dev-test-game/spine-manifest.json",
    adminSpineProofSource = "target/dev-test-game/admin-spine-proof.json",
    adminSpineTerminalBatchesSource = defaultAdminSpineTerminalBatchProofPath,
    privateChannelRecoveryReceiptSource =
      defaultPrivateChannelRecoveryReceiptPath,
    nextActionSource = devTestGameNextActionPath,
    releaseReadinessSource = devTestGameReleaseReadinessPath,
  } = {},
) {
  const manifest = assertDevTestGameSpineManifest(spineManifest);
  validateDevTestGameAdminSpineProof(adminSpineProof, {
    path: adminSpineProofSource,
  });
  const nextActionEvidence =
    nextAction === null ? null : assertDevTestGameNextAction(nextAction);
  const adminSpineTerminalBatchEvidence =
    adminSpineTerminalBatches === null
      ? null
      : validateDevTestGameAdminSpineTerminalBatches(adminSpineTerminalBatches, {
          path: adminSpineTerminalBatchesSource,
        });
  const privateChannelRecoveryReceiptEvidence =
    privateChannelRecoveryReceipt === null
      ? null
      : validateDevTestGamePrivateChannelRecoveryReceipt(
          privateChannelRecoveryReceipt,
          {
            path: privateChannelRecoveryReceiptSource,
          },
        );
  const releaseReadinessChecklist =
    assertDevTestGameReleaseReadiness(releaseReadiness);
  const adminSpine = adminSpineProof;
  const nodes = buildProofGraphNodes({
    manifest,
    adminSpine,
    adminSpineTerminalBatches: adminSpineTerminalBatchEvidence,
    adminSpineTerminalBatchesSource,
    privateChannelRecoveryReceipt: privateChannelRecoveryReceiptEvidence,
    privateChannelRecoveryReceiptSource,
    releaseReadiness: releaseReadinessChecklist,
    releaseReadinessSource,
  });
  const edges = buildProofGraphEdges({
    nodes,
    nextAction: nextActionEvidence,
    adminSpineTerminalBatches: adminSpineTerminalBatchEvidence,
    privateChannelRecoveryReceipt: privateChannelRecoveryReceiptEvidence,
  });
  const evidence = {
    version: DEV_TEST_GAME_PROOF_GRAPH_VERSION,
    proof: "dev-test-game-proof-graph",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-proof-graph",
    proofBoundary:
      "Generated local proof graph for the dev-test-game development spine. It records local audit role URLs, production feature spine target role URLs, artifact paths, proof commands, dependencies, and recovery edges for seeded admin proof surfaces; it does not validate artifact contents, hosted identity, hosted operations, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      spineManifest: spineManifestSource,
      adminSpineProof: adminSpineProofSource,
      ...(adminSpineTerminalBatchEvidence === null
        ? {}
        : { adminSpineTerminalBatches: adminSpineTerminalBatchesSource }),
      ...(privateChannelRecoveryReceiptEvidence === null
        ? {}
        : {
            privateChannelRecoveryReceipt:
              privateChannelRecoveryReceiptSource,
          }),
      ...(nextActionEvidence === null ? {} : { nextAction: nextActionSource }),
      releaseReadiness: releaseReadinessSource,
      manifestGeneratedAt: manifest.generatedAt,
      adminSpineGeneratedAt: adminSpine.generatedAt,
      ...(nextActionEvidence === null
        ? {}
        : { nextActionGeneratedAt: nextActionEvidence.generatedAt }),
      releaseReadinessGeneratedAt: releaseReadinessChecklist.generatedAt,
    },
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      roleUrlCount: nodes.filter((node) => node.roleUrl).length,
      recoveryTargetCount: nodes.filter((node) => node.recoveryCommand).length,
      productionFeatureTargetCount: nodes.filter(
        (node) => node.kind === "production-feature-spine-target",
      ).length,
      terminalBatchCount: adminSpineTerminalBatchEvidence?.batchCount ?? 0,
      privateChannelRecoveryLaneCount:
        privateChannelRecoveryReceiptEvidence?.laneCount ?? 0,
    },
    nodes,
    edges,
  };
  assertDevTestGameProofGraph(evidence, {
    adminSpineProof: adminSpine,
    releaseReadiness: releaseReadinessChecklist,
  });
  return evidence;
}

export function assertDevTestGameProofGraph(
  evidence,
  { adminSpineProof, releaseReadiness } = {},
) {
  if (evidence?.version !== DEV_TEST_GAME_PROOF_GRAPH_VERSION) {
    throw new Error(`proof graph version drifted: ${evidence?.version}`);
  }
  if (evidence.proof !== "dev-test-game-proof-graph") {
    throw new Error(`unexpected proof graph id: ${evidence.proof}`);
  }
  if (evidence.status !== "passed") {
    throw new Error(`proof graph status is ${evidence.status}`);
  }
  if (evidence.scope !== "local-dev-test-game-proof-graph") {
    throw new Error(`proof graph scope drifted: ${evidence.scope}`);
  }
  if (evidence.releaseReady !== false || evidence.productionReady !== false) {
    throw new Error("proof graph must not claim production or release readiness");
  }
  if (!Array.isArray(evidence.nodes) || evidence.nodes.length < 4) {
    throw new Error("proof graph is missing local proof nodes");
  }
  if (!Array.isArray(evidence.edges) || evidence.edges.length < 3) {
    throw new Error("proof graph is missing local proof edges");
  }
  const nodesById = new Set(evidence.nodes.map((node) => node.id));
  if (nodesById.size !== evidence.nodes.length) {
    throw new Error("proof graph node ids must be unique");
  }
  const productionFeatureTargetNodes = evidence.nodes.filter(
    (node) => node.kind === "production-feature-spine-target",
  );
  if (
    evidence.summary?.productionFeatureTargetCount !==
    productionFeatureTargetNodes.length
  ) {
    throw new Error("proof graph production feature target count drifted");
  }
  for (const node of evidence.nodes) {
    if (typeof node.id !== "string" || node.id.trim() === "") {
      throw new Error("proof graph node is missing an id");
    }
    if (typeof node.artifact !== "string" || node.artifact.trim() === "") {
      throw new Error(`proof graph node ${node.id} is missing an artifact`);
    }
    if (node.roleUrl !== undefined && !node.roleUrl.includes("?game=<seeded-game>")) {
      throw new Error(`proof graph node ${node.id} role URL is not seeded`);
    }
    if (
      node.kind === "production-feature-spine-target" &&
      (typeof node.targetRoleUrl !== "string" || node.targetRoleUrl.trim() === "")
    ) {
      throw new Error(`proof graph production feature ${node.id} target role URL is missing`);
    }
  }
  for (const edge of evidence.edges) {
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) {
      throw new Error(`proof graph edge has an unknown endpoint: ${edge.from}->${edge.to}`);
    }
    if (edge.roleUrl !== undefined && !edge.roleUrl.includes("?game=<seeded-game>")) {
      throw new Error(`proof graph edge ${edge.from}->${edge.to} role URL is not seeded`);
    }
  }
  const seedCoverageRecoveryEdge = evidence.edges.find(
    (edge) =>
      edge.from === "next-action" &&
      edge.to === "admin-proof:seed" &&
      edge.relationship === "recovery-target",
  );
  if (seedCoverageRecoveryEdge !== undefined) {
    if (
      seedCoverageRecoveryEdge.reason !== "seed-proof-lane-coverage-drift" ||
      seedCoverageRecoveryEdge.command !== devTestGameSeedFixtureCommand ||
      seedCoverageRecoveryEdge.roleUrl !== devTestGameSeedFixtureRoleUrl ||
      seedCoverageRecoveryEdge.proofTarget !== devTestGameSeedFixturePath ||
      !Array.isArray(seedCoverageRecoveryEdge.unclassifiedLaneIds)
    ) {
      throw new Error("proof graph seed coverage recovery edge is malformed");
    }
  }
  if (adminSpineProof !== undefined) {
    assertDevTestGameProofGraphCoversAdminSpine(evidence, adminSpineProof);
  }
  assertDevTestGameProofGraphCoversTerminalBatches(evidence);
  assertDevTestGameProofGraphCoversPrivateChannelRecoveryReceipt(evidence);
  if (releaseReadiness !== undefined) {
    assertDevTestGameProofGraphCoversProductionFeatureTargets(
      evidence,
      releaseReadiness,
    );
  }
  assertProductionFacingSurfaceGraphCoverage({ proofGraph: evidence });
  return evidence;
}

export function assertDevTestGameProofGraphCoversPrivateChannelRecoveryReceipt(
  graph,
) {
  const node = (graph?.nodes ?? []).find(
    (candidate) => candidate.id === "private-channel-recovery-receipt",
  );
  if (graph?.generatedFrom?.privateChannelRecoveryReceipt === undefined) {
    if (
      node !== undefined ||
      graph.summary?.privateChannelRecoveryLaneCount !== 0
    ) {
      throw new Error("proof graph private-channel receipt summary drifted");
    }
    return graph;
  }
  if (
    node?.kind !== "private-channel-recovery-receipt" ||
    node.status !== "passed" ||
    node.artifact !== graph.generatedFrom.privateChannelRecoveryReceipt ||
    node.roleUrl !== localAdminAuditRoleUrl(localAdminAuditIds.coreLoop) ||
    node.proofCommand !== devTestGamePrivateChannelRecoveryReceiptCommand ||
    node.recoveryCommand !== devTestGamePrivateChannelRecoveryReceiptCommand ||
    node.laneCount !== graph.summary.privateChannelRecoveryLaneCount
  ) {
    throw new Error("proof graph private-channel receipt node drifted");
  }
  for (const [from, to, relationship] of [
    ["admin-proof:core-loop", "private-channel-recovery-receipt", "proves"],
    ["private-channel-recovery-receipt", "proof-graph", "records"],
    ["private-channel-recovery-receipt", "next-action", "summarizes-into"],
  ]) {
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === from &&
          edge.to === to &&
          edge.relationship === relationship,
      )
    ) {
      throw new Error(
        `proof graph private-channel receipt edge missing: ${from}->${to}`,
      );
    }
  }
  return graph;
}

export function assertDevTestGameProofGraphCoversTerminalBatches(graph) {
  const terminalNode = (graph?.nodes ?? []).find(
    (node) => node.id === "admin-spine-terminal-batches",
  );
  if (graph?.generatedFrom?.adminSpineTerminalBatches === undefined) {
    if (terminalNode !== undefined || graph.summary?.terminalBatchCount !== 0) {
      throw new Error("proof graph terminal batch summary drifted");
    }
    return graph;
  }
  if (
    terminalNode?.kind !== "terminal-proof-batch-receipt" ||
    terminalNode.status !== "passed" ||
    terminalNode.artifact !== graph.generatedFrom.adminSpineTerminalBatches ||
    terminalNode.roleUrl !== localAdminAuditRoleUrl(localAdminAuditIds.adminSpine) ||
    terminalNode.batchCount !== graph.summary?.terminalBatchCount ||
    !Array.isArray(terminalNode.proofIds) ||
    !terminalNode.proofIds.includes("proof-graph") ||
    !terminalNode.proofIds.includes("proof-freshness") ||
    !terminalNode.proofIds.includes("next-action")
  ) {
    throw new Error("proof graph terminal batch node drifted");
  }
  for (const target of ["proof-graph", "proof-freshness", "next-action"]) {
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === "admin-spine-terminal-batches" &&
          edge.to === target &&
          edge.relationship === "terminal-browser-proof",
      )
    ) {
      throw new Error(`proof graph terminal batch edge missing: ${target}`);
    }
  }
  return graph;
}

export function assertDevTestGameProofGraphCoversAdminSpine(graph, adminSpineProof) {
  validateDevTestGameAdminSpineProof(adminSpineProof, {
    path: graph?.generatedFrom?.adminSpineProof,
  });
  const recoveryCommands = new Map(
    (adminSpineProof.recovery?.surfaces ?? []).map((surface) => [
      surface.id,
      surface.rerunCommand,
    ]),
  );
  const adminEntries = new Map(
    (adminSpineProof.adminProofs ?? []).map((entry) => [entry.id, entry]),
  );
  const graphAdminNodes = new Map(
    (graph.nodes ?? [])
      .filter((node) => node.kind === "admin-proof-surface")
      .map((node) => [node.surfaceId, node]),
  );
  if (adminEntries.size !== graphAdminNodes.size) {
    throw new Error(
      `proof graph admin surface count drifted: expected ${adminEntries.size}, got ${graphAdminNodes.size}`,
    );
  }
  for (const [id, entry] of adminEntries) {
    const node = graphAdminNodes.get(id);
    if (node === undefined) {
      throw new Error(`proof graph missing admin surface node: ${id}`);
    }
    const expectedNodeId = `admin-proof:${id}`;
    if (node.id !== expectedNodeId) {
      throw new Error(`proof graph admin surface ${id} node id drifted: ${node.id}`);
    }
    if (node.status !== entry.status) {
      throw new Error(`proof graph admin surface ${id} status drifted`);
    }
    if (node.artifact !== entry.path) {
      throw new Error(`proof graph admin surface ${id} artifact drifted`);
    }
    if (node.roleUrl !== entry.detailRoleUrl) {
      throw new Error(`proof graph admin surface ${id} role URL drifted`);
    }
    if (node.proofCommand !== entry.rerunCommand) {
      throw new Error(`proof graph admin surface ${id} proof command drifted`);
    }
    if (node.recoveryCommand !== recoveryCommands.get(id)) {
      throw new Error(`proof graph admin surface ${id} recovery command drifted`);
    }
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === "admin-spine" &&
          edge.to === expectedNodeId &&
          edge.relationship === "aggregates",
      )
    ) {
      throw new Error(`proof graph admin surface ${id} is missing aggregate edge`);
    }
  }
  return graph;
}

export function assertDevTestGameProofGraphCoversProductionFeatureTargets(
  graph,
  releaseReadiness,
) {
  const readiness = assertDevTestGameReleaseReadiness(releaseReadiness);
  const targets = productionFeatureTargetsForGraph(readiness);
  const nodes = (graph.nodes ?? []).filter(
    (node) => node.kind === "production-feature-spine-target",
  );
  if (nodes.length !== targets.length) {
    throw new Error(
      `proof graph production feature target count drifted: expected ${targets.length}, got ${nodes.length}`,
    );
  }
  const nodesBySlotId = new Map(nodes.map((node) => [node.featureSlotId, node]));
  for (const target of targets) {
    const slotId = target.featureSlotId;
    const node = nodesBySlotId.get(slotId);
    if (node === undefined) {
      throw new Error(`proof graph missing production feature target: ${slotId}`);
    }
    const expectedNodeId = `production-feature:${slotId}`;
    if (
      node.id !== expectedNodeId ||
      node.sourceCheckId !== target.sourceCheckId ||
      node.roleUrl !== target.detailRoleUrl ||
      node.targetRoleUrl !== target.roleUrl ||
      node.cycleId !== target.cycleId ||
      node.roleUrlId !== target.roleUrlId ||
      node.rowKind !== target.rowKind ||
      node.checkpointId !== target.checkpointId ||
      node.adminCheckId !== target.adminCheckId ||
      node.browserProofCommand !== target.browserProofCommand ||
      node.recoveryCommand !== target.rerunCommand
    ) {
      throw new Error(`proof graph production feature target drifted: ${slotId}`);
    }
    if ((node.recoveryHookId ?? undefined) !== (target.recoveryHookId ?? undefined)) {
      throw new Error(`proof graph production feature recovery hook drifted: ${slotId}`);
    }
    const sourceNodeId = productionFeatureSourceGraphNodeId(target.sourceCheckId);
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === sourceNodeId &&
          edge.to === expectedNodeId &&
          edge.relationship === "proves-production-feature" &&
          edge.roleUrl === target.detailRoleUrl &&
          edge.targetRoleUrl === target.roleUrl &&
          edge.command === target.browserProofCommand,
      )
    ) {
      throw new Error(`proof graph production feature ${slotId} is missing proof edge`);
    }
  }
  return graph;
}

export async function writeDevTestGameProofGraph({
  generatedAt = new Date().toISOString(),
  spineManifestPath = process.env.FMARCH_DEV_TEST_GAME_SPINE_MANIFEST ??
    "target/dev-test-game/spine-manifest.json",
  adminSpineProofPath = process.env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF ??
    "target/dev-test-game/admin-spine-proof.json",
  adminSpineTerminalBatchesPath =
    process.env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_TERMINAL_BATCHES ??
    defaultAdminSpineTerminalBatchProofPath,
  privateChannelRecoveryReceiptPath =
    process.env.FMARCH_DEV_TEST_GAME_PRIVATE_CHANNEL_RECOVERY_RECEIPT ??
    defaultPrivateChannelRecoveryReceiptPath,
  nextActionPath = process.env.FMARCH_DEV_TEST_GAME_NEXT_ACTION ??
    devTestGameNextActionPath,
  releaseReadinessPath = process.env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS ??
    devTestGameReleaseReadinessPath,
} = {}) {
  const absoluteSpineManifestPath = path.resolve(repoRoot, spineManifestPath);
  const absoluteAdminSpineProofPath = path.resolve(repoRoot, adminSpineProofPath);
  const absoluteAdminSpineTerminalBatchesPath = path.resolve(
    repoRoot,
    adminSpineTerminalBatchesPath,
  );
  const absolutePrivateChannelRecoveryReceiptPath = path.resolve(
    repoRoot,
    privateChannelRecoveryReceiptPath,
  );
  const absoluteNextActionPath = path.resolve(repoRoot, nextActionPath);
  const absoluteReleaseReadinessPath = path.resolve(repoRoot, releaseReadinessPath);
  const spineManifest = JSON.parse(await readFile(absoluteSpineManifestPath, "utf8"));
  const adminSpineProof = JSON.parse(await readFile(absoluteAdminSpineProofPath, "utf8"));
  const adminSpineTerminalBatches = await readOptionalJson(
    absoluteAdminSpineTerminalBatchesPath,
  );
  const privateChannelRecoveryReceipt = await readOptionalJson(
    absolutePrivateChannelRecoveryReceiptPath,
  );
  const nextAction = JSON.parse(await readFile(absoluteNextActionPath, "utf8"));
  const releaseReadiness = JSON.parse(
    await readFile(absoluteReleaseReadinessPath, "utf8"),
  );
  const evidence = buildDevTestGameProofGraph(
    {
      spineManifest,
      adminSpineProof,
      adminSpineTerminalBatches,
      privateChannelRecoveryReceipt,
      nextAction,
      releaseReadiness,
    },
    {
      generatedAt,
      spineManifestSource: path.relative(repoRoot, absoluteSpineManifestPath),
      adminSpineProofSource: path.relative(repoRoot, absoluteAdminSpineProofPath),
      adminSpineTerminalBatchesSource: path.relative(
        repoRoot,
        absoluteAdminSpineTerminalBatchesPath,
      ),
      privateChannelRecoveryReceiptSource: path.relative(
        repoRoot,
        absolutePrivateChannelRecoveryReceiptPath,
      ),
      nextActionSource: path.relative(repoRoot, absoluteNextActionPath),
      releaseReadinessSource: path.relative(repoRoot, absoluteReleaseReadinessPath),
    },
  );
  await mkdir(path.dirname(proofGraphJsonPath), { recursive: true });
  await writeFile(proofGraphJsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function buildProofGraphNodes({
  manifest,
  adminSpine,
  adminSpineTerminalBatches,
  adminSpineTerminalBatchesSource,
  privateChannelRecoveryReceipt,
  privateChannelRecoveryReceiptSource,
  releaseReadiness,
  releaseReadinessSource,
}) {
  const recoveryCommands = new Map(
    (adminSpine.recovery?.surfaces ?? []).map((surface) => [
      surface.id,
      surface.rerunCommand,
    ]),
  );
  const adminProofNodes = (adminSpine.adminProofs ?? []).map((proof) => ({
    id: `admin-proof:${proof.id}`,
    surfaceId: proof.id,
    label: proof.label,
    kind: "admin-proof-surface",
    status: proof.status,
    artifact: proof.path,
    roleUrl: proof.detailRoleUrl,
    proofCommand: proof.rerunCommand,
    recoveryCommand: recoveryCommands.get(proof.id) ?? proof.rerunCommand,
  }));
  const productionFeatureTargetNodes = buildProductionFeatureTargetNodes({
    releaseReadiness,
    releaseReadinessSource,
  });
  const terminalBatchNode =
    adminSpineTerminalBatches === null
      ? []
      : [
          {
            id: "admin-spine-terminal-batches",
            label: "Admin spine terminal proof batches",
            kind: "terminal-proof-batch-receipt",
            status: adminSpineTerminalBatches.status,
            artifact: adminSpineTerminalBatchesSource,
            roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.adminSpine),
            proofCommand: manifest.commands?.adminSpine?.script,
            recoveryCommand: adminSpine.recovery?.nextCommand,
            batchCount: adminSpineTerminalBatches.batchCount,
            proofIds: [
              ...new Set(
                adminSpineTerminalBatches.batches.flatMap(
                  (batch) => batch.proofIds,
                ),
              ),
            ],
            artifactPaths: [
              ...new Set(
                adminSpineTerminalBatches.batches.flatMap(
                  (batch) => batch.artifactPaths,
                ),
              ),
            ],
          },
        ];
  const privateChannelRecoveryReceiptNode =
    privateChannelRecoveryReceipt === null
      ? []
      : [
          {
            id: "private-channel-recovery-receipt",
            label: "Private-channel recovery receipt",
            kind: "private-channel-recovery-receipt",
            status: privateChannelRecoveryReceipt.status,
            artifact: privateChannelRecoveryReceiptSource,
            roleUrl: privateChannelRecoveryReceipt.roleUrl,
            proofCommand: devTestGamePrivateChannelRecoveryReceiptCommand,
            recoveryCommand: devTestGamePrivateChannelRecoveryReceiptCommand,
            familyId: privateChannelRecoveryReceipt.familyId,
            laneCount: privateChannelRecoveryReceipt.laneCount,
            laneIds: privateChannelRecoveryReceipt.laneIds,
          },
        ];
  return [
    {
      id: "admin-spine",
      label: "Local admin spine",
      kind: "aggregate-proof",
      status: adminSpine.status,
      artifact: "target/dev-test-game/admin-spine-proof.json",
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.adminSpine),
      proofCommand: manifest.commands?.adminSpine?.script,
      recoveryCommand: adminSpine.recovery?.nextCommand,
    },
    {
      id: "spine-manifest",
      label: "Local spine manifest",
      kind: "manifest",
      status: manifest.status,
      artifact: "target/dev-test-game/spine-manifest.json",
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.spineManifest),
      proofCommand: "test:dev-test-game-spine-manifest",
      recoveryCommand: recoveryCommands.get("spine-manifest"),
    },
    {
      id: "proof-graph",
      label: "Local proof graph",
      kind: "proof-graph",
      status: "passed",
      artifact: manifest.commands?.proofGraph?.proofArtifact,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph),
      proofCommand: manifest.commands?.proofGraph?.script,
      recoveryCommand: manifest.commands?.proofGraph?.script,
    },
    {
      id: "proof-freshness",
      label: "Local proof freshness",
      kind: "freshness-dashboard",
      status: manifest.artifactFreshness?.status ?? "unknown",
      artifact: manifest.commands?.proofFreshness?.proofArtifact,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofFreshness),
      proofCommand: manifest.commands?.proofFreshness?.script,
      recoveryCommand: manifest.artifactFreshness?.nextCommand,
    },
    {
      id: "next-action",
      label: "Local next action",
      kind: "recovery-receipt",
      status: "recorded",
      artifact: manifest.commands?.nextAction?.proofArtifact,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.nextAction),
      proofCommand: manifest.commands?.nextAction?.script,
      recoveryCommand: manifest.commands?.proofFreshness?.script,
    },
    ...terminalBatchNode,
    ...privateChannelRecoveryReceiptNode,
    ...adminProofNodes,
    ...productionFeatureTargetNodes,
  ].map((node) =>
    Object.fromEntries(
      Object.entries(node).filter(([, value]) => value !== undefined && value !== ""),
    ),
  );
}

function buildProofGraphEdges({
  nodes,
  nextAction = null,
  adminSpineTerminalBatches = null,
  privateChannelRecoveryReceipt = null,
}) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [
    ["admin-spine", "spine-manifest", "aggregates"],
    ["spine-manifest", "proof-graph", "records"],
    ["spine-manifest", "proof-freshness", "records"],
    ["spine-manifest", "next-action", "records"],
    ["proof-freshness", "next-action", "recovers-through"],
    ...terminalBatchEdges(adminSpineTerminalBatches),
    ...privateChannelRecoveryReceiptEdges(privateChannelRecoveryReceipt),
    ...nextActionRecoveryEdges(nextAction),
    ...nodes
      .filter((node) => node.kind === "admin-proof-surface")
      .map((node) => ["admin-spine", node.id, "aggregates"]),
    ...nodes
      .filter((node) => node.kind === "production-feature-spine-target")
      .map((node) => [
        productionFeatureSourceGraphNodeId(node.sourceCheckId),
        node.id,
        "proves-production-feature",
        {
          featureSlotId: node.featureSlotId,
          roleUrl: node.roleUrl,
          targetRoleUrl: node.targetRoleUrl,
          command: node.browserProofCommand,
        },
      ]),
  ];
  return edges
    .filter(([from, to]) => nodeIds.has(from) && nodeIds.has(to))
    .map(([from, to, relationship, metadata = {}]) =>
      Object.fromEntries(
        Object.entries({ from, to, relationship, ...metadata }).filter(
          ([, value]) => value !== undefined && value !== "",
        ),
      ),
    );
}

function privateChannelRecoveryReceiptEdges(privateChannelRecoveryReceipt) {
  if (privateChannelRecoveryReceipt === null) {
    return [];
  }
  return [
    [
      "admin-proof:core-loop",
      "private-channel-recovery-receipt",
      "proves",
      {
        roleUrl: privateChannelRecoveryReceipt.roleUrl,
        proofTarget: privateChannelRecoveryReceipt.path,
      },
    ],
    [
      "private-channel-recovery-receipt",
      "proof-graph",
      "records",
      { proofTarget: privateChannelRecoveryReceipt.path },
    ],
    [
      "private-channel-recovery-receipt",
      "next-action",
      "summarizes-into",
      { proofTarget: privateChannelRecoveryReceipt.path },
    ],
  ];
}

function terminalBatchEdges(adminSpineTerminalBatches) {
  if (adminSpineTerminalBatches === null) {
    return [];
  }
  return ["proof-graph", "proof-freshness", "next-action"].map((target) => [
    "admin-spine-terminal-batches",
    target,
    "terminal-browser-proof",
    {
      batchLabels: adminSpineTerminalBatches.batches
        .filter((batch) => batch.proofIds.includes(target))
        .map((batch) => batch.label),
    },
  ]);
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function buildProductionFeatureTargetNodes({
  releaseReadiness,
  releaseReadinessSource,
}) {
  const targets = productionFeatureTargetsForGraph(releaseReadiness);
  return targets.map((target) => {
    return {
      id: `production-feature:${target.featureSlotId}`,
      featureSlotId: target.featureSlotId,
      label: `Production feature: ${target.featureSlotId}`,
      kind: "production-feature-spine-target",
      status: "passed",
      artifact: releaseReadinessSource,
      sourceCheckId: target.sourceCheckId,
      roleUrl: target.detailRoleUrl,
      targetRoleUrl: target.roleUrl,
      cycleId: target.cycleId,
      roleUrlId: target.roleUrlId,
      rowKind: target.rowKind,
      checkpointId: target.checkpointId,
      recoveryHookId: target.recoveryHookId,
      adminCheckId: target.adminCheckId,
      browserProofCommand: target.browserProofCommand,
      recoveryCommand: target.rerunCommand,
    };
  });
}

function productionFeatureTargetsForGraph(releaseReadiness) {
  const coreLoopTargets = coreLoopProductionFeatureTargetCollection(releaseReadiness);
  const hardeningTargets = hardeningProductionFeatureTargetCollection(
    releaseReadiness,
  );
  const targetsBySlotId = new Map(
    [coreLoopTargets, hardeningTargets].flatMap((targets) =>
      targets.slotIds.map((slotId) => [
        slotId,
        targets.bySlotId[slotId],
      ]),
    ),
  );
  for (const item of productionFacingSurfaceChecklistItems()) {
    const slotId = item.productionFeatureSpineTarget.featureSlotId;
    if (!targetsBySlotId.has(slotId)) {
      targetsBySlotId.set(
        slotId,
        resolveBuildableProductionFeatureTarget({
          declaration: item.productionFeatureSpineTarget,
          releaseReadiness,
        }),
      );
    }
  }
  return [...targetsBySlotId.values()];
}

function coreLoopProductionFeatureTargetCollection(releaseReadiness) {
  const coreLoopCheck = releaseReadiness.localDevelopmentSpine?.checks?.find(
    (check) => check.id === coreLoopFeatureSpineSourceCheckId,
  );
  const targets = coreLoopCheck?.spineTargets?.productionFeatureTargets;
  if (
    targets?.status !== "passed" ||
    !Array.isArray(targets.slotIds) ||
    targets.bySlotId === null ||
    typeof targets.bySlotId !== "object"
  ) {
    throw new Error("proof graph missing core-loop production feature targets");
  }
  return targets;
}

function hardeningProductionFeatureTargetCollection(releaseReadiness) {
  const hardeningCheck = releaseReadiness.localDevelopmentSpine?.checks?.find(
    (check) => check.id === hardeningFeatureSpineSourceCheckId,
  );
  const targets = hardeningCheck?.spineTargets?.productionFeatureTargets;
  if (
    targets?.status !== "passed" ||
    !Array.isArray(targets.slotIds) ||
    targets.bySlotId === null ||
    typeof targets.bySlotId !== "object"
  ) {
    throw new Error("proof graph missing hardening production feature targets");
  }
  return targets;
}

function resolveBuildableProductionFeatureTarget({ declaration, releaseReadiness }) {
  if (declaration.sourceCheckId === identityFeatureSpineSourceCheckId) {
    const identityCheck = releaseReadiness.localDevelopmentSpine?.checks?.find(
      (check) => check.id === declaration.sourceCheckId,
    );
    const detailRoleUrl = identityCheck?.adminRoleSurface?.detailRoleUrl;
    if (typeof detailRoleUrl !== "string" || detailRoleUrl.trim() === "") {
      throw new Error("proof graph missing identity adapter production feature target");
    }
    return {
      featureSlotId: declaration.featureSlotId,
      sourceCheckId: declaration.sourceCheckId,
      detailRoleUrl,
      cycleId: declaration.cycleId,
      roleUrlId: declaration.roleUrlId,
      roleUrl: detailRoleUrl,
      rowKind: featureSpineRowKind(declaration),
      checkpointId: declaration.checkpointId,
      adminCheckId: declaration.adminCheckId,
      browserProofCommand: devTestGameLiveProofCommand,
      rerunCommand: devTestGameIdentityAdminProofCommand,
    };
  }
  throw new Error(
    `proof graph cannot resolve production feature source check: ${declaration.sourceCheckId}`,
  );
}

function nextActionRecoveryEdges(nextAction) {
  if (nextAction?.nextAction?.reason !== "seed-proof-lane-coverage-drift") {
    return [];
  }
  const seedCoverage = nextAction.nextAction.seedProofLaneCoverage;
  return [
    [
      "next-action",
      "admin-proof:seed",
      "recovery-target",
      {
        reason: nextAction.nextAction.reason,
        command: nextAction.nextAction.command,
        roleUrl: seedCoverage?.roleUrl,
        proofTarget: seedCoverage?.proofTarget,
        buildSlice: seedCoverage?.buildSlice,
        unclassifiedLaneCount: seedCoverage?.unclassifiedLaneCount,
        unclassifiedLaneIds: seedCoverage?.unclassifiedLaneIds,
      },
    ],
  ];
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidence = await writeDevTestGameProofGraph();
  console.log(`wrote ${devTestGameProofGraphPath} (${evidence.status})`);
}
