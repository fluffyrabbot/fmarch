import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateDevTestGameAdminSpineProof } from "./dev_test_game_release_readiness.mjs";
import { assertDevTestGameSpineManifest } from "./dev_test_game_spine_manifest.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_PROOF_GRAPH_VERSION = 1;
export const devTestGameProofGraphPath = "target/dev-test-game/proof-graph.json";

const proofGraphJsonPath = path.join(repoRoot, devTestGameProofGraphPath);

export function buildDevTestGameProofGraph(
  { spineManifest, adminSpineProof },
  {
    generatedAt = new Date().toISOString(),
    spineManifestSource = "target/dev-test-game/spine-manifest.json",
    adminSpineProofSource = "target/dev-test-game/admin-spine-proof.json",
  } = {},
) {
  const manifest = assertDevTestGameSpineManifest(spineManifest);
  validateDevTestGameAdminSpineProof(adminSpineProof, {
    path: adminSpineProofSource,
  });
  const adminSpine = adminSpineProof;
  const nodes = buildProofGraphNodes({ manifest, adminSpine });
  const edges = buildProofGraphEdges({ nodes });
  const evidence = {
    version: DEV_TEST_GAME_PROOF_GRAPH_VERSION,
    proof: "dev-test-game-proof-graph",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-proof-graph",
    proofBoundary:
      "Generated local proof graph for the dev-test-game development spine. It records local audit role URLs, artifact paths, proof commands, dependencies, and recovery edges for seeded admin proof surfaces; it does not validate artifact contents, hosted identity, hosted operations, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      spineManifest: spineManifestSource,
      adminSpineProof: adminSpineProofSource,
      manifestGeneratedAt: manifest.generatedAt,
      adminSpineGeneratedAt: adminSpine.generatedAt,
    },
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      roleUrlCount: nodes.filter((node) => node.roleUrl).length,
      recoveryTargetCount: nodes.filter((node) => node.recoveryCommand).length,
    },
    nodes,
    edges,
  };
  assertDevTestGameProofGraph(evidence);
  return evidence;
}

export function assertDevTestGameProofGraph(evidence) {
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
  }
  for (const edge of evidence.edges) {
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) {
      throw new Error(`proof graph edge has an unknown endpoint: ${edge.from}->${edge.to}`);
    }
  }
  return evidence;
}

export async function writeDevTestGameProofGraph({
  generatedAt = new Date().toISOString(),
  spineManifestPath = process.env.FMARCH_DEV_TEST_GAME_SPINE_MANIFEST ??
    "target/dev-test-game/spine-manifest.json",
  adminSpineProofPath = process.env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF ??
    "target/dev-test-game/admin-spine-proof.json",
} = {}) {
  const absoluteSpineManifestPath = path.resolve(repoRoot, spineManifestPath);
  const absoluteAdminSpineProofPath = path.resolve(repoRoot, adminSpineProofPath);
  const spineManifest = JSON.parse(await readFile(absoluteSpineManifestPath, "utf8"));
  const adminSpineProof = JSON.parse(await readFile(absoluteAdminSpineProofPath, "utf8"));
  const evidence = buildDevTestGameProofGraph(
    { spineManifest, adminSpineProof },
    {
      generatedAt,
      spineManifestSource: path.relative(repoRoot, absoluteSpineManifestPath),
      adminSpineProofSource: path.relative(repoRoot, absoluteAdminSpineProofPath),
    },
  );
  await mkdir(path.dirname(proofGraphJsonPath), { recursive: true });
  await writeFile(proofGraphJsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function buildProofGraphNodes({ manifest, adminSpine }) {
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
  ].map((node) =>
    Object.fromEntries(
      Object.entries(node).filter(([, value]) => value !== undefined && value !== ""),
    ),
  );
}

function buildProofGraphEdges({ nodes }) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [
    ["admin-spine", "spine-manifest", "aggregates"],
    ["spine-manifest", "proof-freshness", "records"],
    ["spine-manifest", "next-action", "records"],
    ["proof-freshness", "next-action", "recovers-through"],
    ...nodes
      .filter((node) => node.kind === "admin-proof-surface")
      .map((node) => ["admin-spine", node.id, "aggregates"]),
  ];
  return edges
    .filter(([from, to]) => nodeIds.has(from) && nodeIds.has(to))
    .map(([from, to, relationship]) => ({ from, to, relationship }));
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidence = await writeDevTestGameProofGraph();
  console.log(`wrote ${devTestGameProofGraphPath} (${evidence.status})`);
}
