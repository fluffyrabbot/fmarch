import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameReleaseReadiness,
  validateDevTestGameAdminSpineProof,
} from "./dev_test_game_release_readiness.mjs";
import {
  assertDevTestGameNextAction,
  devTestGameNextActionPath,
  devTestGameReleaseReadinessPath,
  devTestGameSeedFixtureCommand,
  devTestGameSeedFixturePath,
  devTestGameSeedFixtureRoleUrl,
} from "./dev_test_game_next_action.mjs";
import { assertDevTestGameSpineManifest } from "./dev_test_game_spine_manifest.mjs";
import {
  assertProductionFacingSurfaceGraphCoverage,
} from "./dev_test_game_production_surface_checklist.mjs";
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

export function buildDevTestGameProofGraph(
  { spineManifest, adminSpineProof, nextAction = null, releaseReadiness },
  {
    generatedAt = new Date().toISOString(),
    spineManifestSource = "target/dev-test-game/spine-manifest.json",
    adminSpineProofSource = "target/dev-test-game/admin-spine-proof.json",
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
  const releaseReadinessChecklist =
    assertDevTestGameReleaseReadiness(releaseReadiness);
  const adminSpine = adminSpineProof;
  const nodes = buildProofGraphNodes({
    manifest,
    adminSpine,
    releaseReadiness: releaseReadinessChecklist,
    releaseReadinessSource,
  });
  const edges = buildProofGraphEdges({ nodes, nextAction: nextActionEvidence });
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
  if (releaseReadiness !== undefined) {
    assertDevTestGameProofGraphCoversProductionFeatureTargets(
      evidence,
      releaseReadiness,
    );
  }
  assertProductionFacingSurfaceGraphCoverage({ proofGraph: evidence });
  return evidence;
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
  const targets = coreLoopProductionFeatureTargetCollection(readiness);
  const nodes = (graph.nodes ?? []).filter(
    (node) => node.kind === "production-feature-spine-target",
  );
  if (nodes.length !== targets.slotIds.length) {
    throw new Error(
      `proof graph production feature target count drifted: expected ${targets.slotIds.length}, got ${nodes.length}`,
    );
  }
  const nodesBySlotId = new Map(nodes.map((node) => [node.featureSlotId, node]));
  for (const slotId of targets.slotIds) {
    const target = targets.bySlotId[slotId];
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
  nextActionPath = process.env.FMARCH_DEV_TEST_GAME_NEXT_ACTION ??
    devTestGameNextActionPath,
  releaseReadinessPath = process.env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS ??
    devTestGameReleaseReadinessPath,
} = {}) {
  const absoluteSpineManifestPath = path.resolve(repoRoot, spineManifestPath);
  const absoluteAdminSpineProofPath = path.resolve(repoRoot, adminSpineProofPath);
  const absoluteNextActionPath = path.resolve(repoRoot, nextActionPath);
  const absoluteReleaseReadinessPath = path.resolve(repoRoot, releaseReadinessPath);
  const spineManifest = JSON.parse(await readFile(absoluteSpineManifestPath, "utf8"));
  const adminSpineProof = JSON.parse(await readFile(absoluteAdminSpineProofPath, "utf8"));
  const nextAction = JSON.parse(await readFile(absoluteNextActionPath, "utf8"));
  const releaseReadiness = JSON.parse(
    await readFile(absoluteReleaseReadinessPath, "utf8"),
  );
  const evidence = buildDevTestGameProofGraph(
    { spineManifest, adminSpineProof, nextAction, releaseReadiness },
    {
      generatedAt,
      spineManifestSource: path.relative(repoRoot, absoluteSpineManifestPath),
      adminSpineProofSource: path.relative(repoRoot, absoluteAdminSpineProofPath),
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
  return [
    {
      id: "admin-spine",
      label: "Local admin spine",
      kind: "aggregate-proof",
      status: adminSpine.status,
      artifact: "target/dev-test-game/admin-spine-proof.json",
      roleUrl: "/admin/audit/local-admin-spine?game=<seeded-game>",
      proofCommand: manifest.commands?.adminSpine?.script,
      recoveryCommand: adminSpine.recovery?.nextCommand,
    },
    {
      id: "spine-manifest",
      label: "Local spine manifest",
      kind: "manifest",
      status: manifest.status,
      artifact: "target/dev-test-game/spine-manifest.json",
      roleUrl: "/admin/audit/local-spine-manifest?game=<seeded-game>",
      proofCommand: "test:dev-test-game-spine-manifest",
      recoveryCommand: recoveryCommands.get("spine-manifest"),
    },
    {
      id: "proof-freshness",
      label: "Local proof freshness",
      kind: "freshness-dashboard",
      status: manifest.artifactFreshness?.status ?? "unknown",
      artifact: manifest.commands?.proofFreshness?.proofArtifact,
      roleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
      proofCommand: manifest.commands?.proofFreshness?.script,
      recoveryCommand: manifest.artifactFreshness?.nextCommand,
    },
    {
      id: "next-action",
      label: "Local next action",
      kind: "recovery-receipt",
      status: "recorded",
      artifact: manifest.commands?.nextAction?.proofArtifact,
      roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
      proofCommand: manifest.commands?.nextAction?.script,
      recoveryCommand: manifest.commands?.proofFreshness?.script,
    },
    ...adminProofNodes,
    ...productionFeatureTargetNodes,
  ].map((node) =>
    Object.fromEntries(
      Object.entries(node).filter(([, value]) => value !== undefined && value !== ""),
    ),
  );
}

function buildProofGraphEdges({ nodes, nextAction = null }) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [
    ["admin-spine", "spine-manifest", "aggregates"],
    ["spine-manifest", "proof-freshness", "records"],
    ["spine-manifest", "next-action", "records"],
    ["proof-freshness", "next-action", "recovers-through"],
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

function buildProductionFeatureTargetNodes({
  releaseReadiness,
  releaseReadinessSource,
}) {
  const targets = coreLoopProductionFeatureTargetCollection(releaseReadiness);
  return targets.slotIds.map((slotId) => {
    const target = targets.bySlotId[slotId];
    return {
      id: `production-feature:${slotId}`,
      featureSlotId: slotId,
      label: `Production feature: ${slotId}`,
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

function coreLoopProductionFeatureTargetCollection(releaseReadiness) {
  const coreLoopCheck = releaseReadiness.localDevelopmentSpine?.checks?.find(
    (check) => check.id === "local-core-loop-proof",
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

function productionFeatureSourceGraphNodeId(sourceCheckId) {
  if (sourceCheckId === "local-core-loop-proof") {
    return "admin-proof:core-loop";
  }
  throw new Error(`unknown production feature source check: ${sourceCheckId}`);
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
