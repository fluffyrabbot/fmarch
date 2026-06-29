import path from "node:path";
import { assertDevTestGameProofGraph } from "./dev_test_game_proof_graph.mjs";
import { validateDevTestGameAdminSpineProof } from "./dev_test_game_release_readiness.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const proofGraphPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_GRAPH ??
    "target/dev-test-game/proof-graph.json",
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? "target/dev-test-game/proof-run.json",
);
const adminSpineProofPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF ??
    "target/dev-test-game/admin-spine-proof.json",
);
const proofGraphRelativePath = path.relative(repoRoot, proofGraphPath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const adminSpineProofRelativePath = path.relative(repoRoot, adminSpineProofPath);
const evidencePath = path.join(artifactDir, "proof-graph-admin-proof.json");

await runAdminAuditProof({
  smokeName: "dev-test-game-proof-graph-admin-proof",
  stage: "proof-graph-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_PROOF_GRAPH: proofGraphRelativePath,
    FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF: adminSpineProofRelativePath,
  },
  loadSource: async () => {
    const adminSpineProof = await readJson(adminSpineProofPath);
    return {
      proofGraph: assertDevTestGameProofGraph(await readJson(proofGraphPath), {
        adminSpineProof,
      }),
      proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
      adminSpineProof: validateDevTestGameAdminSpineProof(adminSpineProof, {
        path: adminSpineProofRelativePath,
      }),
    };
  },
  prove: async ({ browser, frontendBaseUrl, source }) =>
    await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: source.proofRun.session.game,
      auditId: "local-proof-graph",
      requiredChecks: source.proofGraph.nodes.map((node) => node.id),
      requiredRelatedLinks: source.proofGraph.nodes
        .filter((node) => typeof node.roleUrl === "string" && node.roleUrl.trim() !== "")
        .slice(0, 8)
        .map((node) => node.id),
    }),
  buildEvidence: ({ source, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-proof-graph-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-proof-graph-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the generated dev-test-game proof graph. Proves the machine-readable proof graph is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted operations, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      proofGraph: proofGraphRelativePath,
      proofRun: proofRunRelativePath,
      adminSpineProof: adminSpineProofRelativePath,
      game: source.proofRun.session.game,
      nodeIds: source.proofGraph.nodes.map((node) => node.id),
      edgeCount: source.proofGraph.edges.length,
      adminProofSurfaceIds: source.adminSpineProof.proofIds,
    },
    adminRoleSurface,
  }),
  assertEvidence: assertProofGraphAdminProof,
});

export function assertProofGraphAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-proof-graph-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-proof-graph-admin-surface"
  ) {
    throw new Error("proof graph admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("proof graph admin proof did not prove admin overview click-through");
  }
  for (const nodeId of evidence.generatedFrom?.nodeIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(nodeId)) {
      throw new Error(`proof graph admin proof missing visible node: ${nodeId}`);
    }
  }
  const nodeIds = new Set(evidence.generatedFrom?.nodeIds ?? []);
  for (const surfaceId of evidence.generatedFrom?.adminProofSurfaceIds ?? []) {
    if (!nodeIds.has(`admin-proof:${surfaceId}`)) {
      throw new Error(`proof graph admin proof missing generated admin node: ${surfaceId}`);
    }
  }
  if (!Array.isArray(evidence.adminRoleSurface?.visibleRelatedLinks)) {
    throw new Error("proof graph admin proof did not prove related links");
  }
  return evidence;
}
