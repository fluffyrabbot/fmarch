import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameProofGraph } from "./dev_test_game_proof_graph.mjs";
import { validateDevTestGameAdminSpineProof } from "./dev_test_game_release_readiness.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameHostedConcurrentRaceMatrixEvidence,
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import {
  devTestGameHostedEvidenceLaneDemoBlockedPath,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  assertDevTestGameHostedEvidenceLane,
} from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  assertVisibleAdminRoleSurfaceRows,
  artifactDir,
  normalizedEvidenceObjectRowIds,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";
import {
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  localNextActionAdminSurfaceCheckId,
  localProofFreshnessAdminSurfaceCheckId,
  localProofGraphAdminRoleHandoffsCheckId,
} from "./dev_test_game_local_readiness_dependencies.mjs";
import {
  assertAdminAuditRelatedHandoffs,
  requiredRelatedDestinationsForHandoffs,
} from "./dev_test_game_admin_audit_handoff_contract.mjs";
import { adminProofGraphRoleHandoffs } from "./dev_test_game_proof_graph_handoffs.mjs";

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
const hostedMatrixPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX ??
    devTestGameHostedConcurrentRaceMatrixPath,
);
const hostedEvidenceLanePath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE ??
    devTestGameHostedEvidenceLaneDemoBlockedPath,
);
const proofGraphRelativePath = path.relative(repoRoot, proofGraphPath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const adminSpineProofRelativePath = path.relative(repoRoot, adminSpineProofPath);
const hostedMatrixRelativePath = path.relative(repoRoot, hostedMatrixPath);
const hostedEvidenceLaneRelativePath = path.relative(
  repoRoot,
  hostedEvidenceLanePath,
);
const evidencePath = path.join(artifactDir, "proof-graph-admin-proof.json");

export function proofGraphAdminProofCase() {
  return {
    smokeName: "dev-test-game-proof-graph-admin-proof",
    stage: "proof-graph-admin-proof-listen",
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_PROOF_GRAPH: proofGraphRelativePath,
      FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF: adminSpineProofRelativePath,
      FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX:
        hostedMatrixRelativePath,
      FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE: hostedEvidenceLaneRelativePath,
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
        hostedMatrix: assertDevTestGameHostedConcurrentRaceMatrixEvidence(
          await readJson(hostedMatrixPath),
        ),
        hostedEvidenceLane: assertDevTestGameHostedEvidenceLane(
          await readJson(hostedEvidenceLanePath),
        ),
      };
    },
    prove: async ({ browser, frontendBaseUrl, source }) => {
      const roleHandoffs = bootstrapProofGraphAdminRoleHandoffs({
        proofGraph: source.proofGraph,
        hostedMatrix: source.hostedMatrix,
        hostedEvidenceLane: source.hostedEvidenceLane,
      });
      return await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: source.proofRun.session.game,
        auditId: localAdminAuditIds.proofGraph,
        requiredChecks: proofGraphVisibleCheckIds(source.proofGraph),
        requiredRelatedLinks: source.proofGraph.nodes
          .filter(
            (node) =>
              typeof node.roleUrl === "string" && node.roleUrl.trim() !== "",
          )
          .map((node) => node.id),
        requiredRelatedDestinations:
          requiredRelatedDestinationsForHandoffs(roleHandoffs),
      });
    },
    buildEvidence: ({ source, adminRoleSurface }) => ({
      version: 1,
      proof: "dev-test-game-proof-graph-admin-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: "local-dev-test-game-proof-graph-admin-surface",
      proofBoundary:
        "Local SvelteKit admin role URL with fixture admin authority over the generated dev-test-game proof graph. Proves the machine-readable proof graph, recovery receipt evidence-object rows, and role handoffs are discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted operations, beta readiness, release readiness, or production readiness.",
      generatedFrom: {
        proofGraph: proofGraphRelativePath,
        proofRun: proofRunRelativePath,
        adminSpineProof: adminSpineProofRelativePath,
        hostedConcurrentRaceMatrix: hostedMatrixRelativePath,
        hostedEvidenceLane: hostedEvidenceLaneRelativePath,
        game: source.proofRun.session.game,
        nodeIds: source.proofGraph.nodes.map((node) => node.id),
        evidenceObjectRowIds: proofGraphEvidenceObjectRowIds(source.proofGraph),
        edgeRowIds: source.proofGraph.edges.map((edge) =>
          proofGraphEdgeCheckId(edge),
        ),
        edgeCount: source.proofGraph.edges.length,
        adminProofSurfaceIds: source.adminSpineProof.proofIds,
        adminProofRoleHandoffs: bootstrapProofGraphAdminRoleHandoffs({
          proofGraph: source.proofGraph,
          hostedMatrix: source.hostedMatrix,
          hostedEvidenceLane: source.hostedEvidenceLane,
        }),
      },
      adminRoleSurface,
    }),
    assertEvidence: assertProofGraphAdminProof,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(proofGraphAdminProofCase());
}

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
  for (const edgeRowId of evidence.generatedFrom?.edgeRowIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(edgeRowId)) {
      throw new Error(`proof graph admin proof missing visible edge: ${edgeRowId}`);
    }
  }
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.evidenceObjectRowIds,
    proofName: "proof graph admin proof",
    rowName: "evidence object",
  });
  const nodeIds = new Set(evidence.generatedFrom?.nodeIds ?? []);
  for (const surfaceId of evidence.generatedFrom?.adminProofSurfaceIds ?? []) {
    if (!nodeIds.has(`admin-proof:${surfaceId}`)) {
      throw new Error(`proof graph admin proof missing generated admin node: ${surfaceId}`);
    }
  }
  if (!Array.isArray(evidence.adminRoleSurface?.visibleRelatedLinks)) {
    throw new Error("proof graph admin proof did not prove related links");
  }
  for (const handoff of evidence.generatedFrom?.adminProofRoleHandoffs ?? []) {
    if (!evidence.adminRoleSurface.visibleRelatedLinks.includes(handoff.linkId)) {
      throw new Error(`proof graph admin proof missing related link: ${handoff.linkId}`);
    }
  }
  assertAdminAuditRelatedHandoffs({
    adminRoleSurface: evidence.adminRoleSurface,
    handoffs: evidence.generatedFrom?.adminProofRoleHandoffs,
    proofName: "proof graph admin proof",
  });
  return evidence;
}

function proofGraphEdgeCheckId(edge) {
  return `edge:${String(edge?.from ?? "")}:${String(
    edge?.relationship ?? "related",
  )}:${String(edge?.to ?? "")}`;
}

function proofGraphVisibleCheckIds(proofGraph) {
  return [
    ...proofGraph.nodes.map((node) => node.id),
    ...proofGraphEvidenceObjectRowIds(proofGraph),
    ...proofGraph.edges.map((edge) => proofGraphEdgeCheckId(edge)),
  ];
}

function proofGraphEvidenceObjectRowIds(proofGraph) {
  return proofGraph.nodes.flatMap((node) =>
    normalizedEvidenceObjectRowIds({
      parentId: node.id,
      objects: node.normalizedEvidenceObjects,
    }),
  );
}

function bootstrapProofGraphAdminRoleHandoffs({
  proofGraph,
  hostedMatrix,
  hostedEvidenceLane,
}) {
  return adminProofGraphRoleHandoffs({
    proofGraph,
    hostedMatrix,
    hostedEvidenceLane,
  }).map(bootstrapProofGraphAdminRoleHandoff);
}

function bootstrapProofGraphAdminRoleHandoff(handoff) {
  if (handoff.linkId === "admin-proof:release") {
    return releaseReadinessBootstrapHandoff(handoff);
  }
  if (handoff.linkId === "admin-proof:release-runbook") {
    return releaseRunbookBootstrapHandoff(handoff);
  }
  return handoff;
}

function releaseReadinessBootstrapHandoff(handoff) {
  const bootstrapIds = new Set([
    localProofGraphAdminRoleHandoffsCheckId,
    localProofFreshnessAdminSurfaceCheckId,
    localNextActionAdminSurfaceCheckId,
  ]);
  return {
    ...handoff,
    requiredCheckIds: (handoff.requiredCheckIds ?? []).filter(
      (id) => !bootstrapIds.has(id),
    ),
    requiredLocalPrerequisiteDestinations: (
      handoff.requiredLocalPrerequisiteDestinations ?? []
    ).filter((item) => !bootstrapIds.has(item.id)),
  };
}

function releaseRunbookBootstrapHandoff(handoff) {
  return {
    ...handoff,
    requiredUnprovenIds: [],
  };
}
