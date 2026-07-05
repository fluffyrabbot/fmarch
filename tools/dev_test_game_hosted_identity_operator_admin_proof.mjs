import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildDevTestGameHostedIdentityEvidence,
} from "./dev_test_game_hosted_identity_evidence.mjs";
import {
  hostedIdentityEvidenceAdminProofCase,
} from "./dev_test_game_hosted_identity_evidence_admin_proof.mjs";
import {
  buildHostedIdentityEvidenceFixtureSnapshot,
  devTestGameHostedIdentityOperatorAdminProofPath,
  devTestGameHostedIdentityOperatorEvidencePath,
  hostedIdentityEvidenceProofGraphPath,
  hostedIdentityEvidenceRedactedPassFixturePath,
  hostedIdentityOperatorEvidencePacketPath,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  assertHostedIdentityProofGraphDependency,
} from "./dev_test_game_hosted_identity_proof_graph_dependency.mjs";
import {
  buildReleaseReadinessUnprovenItems,
  hostedIdentityEvidenceSatisfiesProductionIdentity,
} from "./dev_test_game_release_readiness_cases.mjs";
import {
  validateDevTestGameHostedIdentityEvidenceAdminProof,
} from "./dev_test_game_release_readiness.mjs";
import {
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await writeHostedIdentityOperatorAdminProof();
}

export async function writeHostedIdentityOperatorAdminProof() {
  const proofGraphPath = path.resolve(
    repoRoot,
    process.env.FMARCH_DEV_TEST_GAME_PROOF_GRAPH ??
      hostedIdentityEvidenceProofGraphPath,
  );
  const proofGraphRelativePath = path.relative(repoRoot, proofGraphPath);
  const proofGraphDependency = assertHostedIdentityProofGraphDependency(
    await readJson(proofGraphPath),
  );
  const operatorPacketPath = path.resolve(
    repoRoot,
    hostedIdentityOperatorEvidencePacketPath,
  );
  const operatorEvidencePath = path.resolve(
    repoRoot,
    devTestGameHostedIdentityOperatorEvidencePath,
  );
  const operatorAdminProofPath = path.resolve(
    repoRoot,
    devTestGameHostedIdentityOperatorAdminProofPath,
  );
  const sourcePacket = buildHostedIdentityEvidenceFixtureSnapshot(
    hostedIdentityEvidenceRedactedPassFixturePath,
  );
  await writeJsonArtifact(operatorPacketPath, sourcePacket);
  const operatorEvidence = await buildDevTestGameHostedIdentityEvidence({
    env: {
      FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH:
        hostedIdentityOperatorEvidencePacketPath,
    },
  });
  if (
    operatorEvidence.status !== "passed" ||
    operatorEvidence.target?.rawEvidencePath !==
      hostedIdentityOperatorEvidencePacketPath ||
    operatorEvidence.releaseReady !== false ||
    operatorEvidence.productionReady !== false
  ) {
    throw new Error(
      "hosted identity operator evidence did not pass with operator packet boundary",
    );
  }
  await writeJsonArtifact(operatorEvidencePath, operatorEvidence);
  await runAdminAuditProof(
    hostedIdentityEvidenceAdminProofCase({
      sourcePath: operatorEvidencePath,
      proofPath: operatorAdminProofPath,
      smokeName: "dev-test-game-hosted-identity-operator-admin-proof",
      stage: "hosted-identity-operator-admin-proof-listen",
    }),
  );
  const adminProof = await readJson(operatorAdminProofPath);
  const validated = validateDevTestGameHostedIdentityEvidenceAdminProof(
    adminProof,
    { path: devTestGameHostedIdentityOperatorAdminProofPath },
  );
  const unprovenIds = buildReleaseReadinessUnprovenItems({
    identityAdapterEvidence: { status: "passed" },
    hostedIdentityEvidenceAdminProofEvidence: validated,
  }).map((item) => item.id);
  if (
    !hostedIdentityEvidenceSatisfiesProductionIdentity(validated) ||
    unprovenIds.includes("hosted-production-identity") ||
    validated.releaseReady !== false ||
    validated.productionReady !== false
  ) {
    throw new Error(
      "hosted identity operator proof failed production-identity handoff predicate",
    );
  }
  const persisted = {
    ...adminProof,
    operatorReadinessPredicate: {
      status: "passed",
      identityAdapterPrerequisiteStatus: "passed",
      acceptedRawEvidencePathKind: validated.rawEvidencePathKind,
      acceptedRawEvidencePath: validated.rawEvidencePath,
      rejectedDefaultFixturePath: hostedIdentityEvidenceRedactedPassFixturePath,
      unprovenIdsAfterOperatorProof: unprovenIds,
      proofGraphDependency: {
        proofGraph: proofGraphRelativePath,
        id: proofGraphDependency.id,
        status: proofGraphDependency.status,
        familyBatchNodeId: proofGraphDependency.familyBatchNodeId,
        operatorPredicateNodeId: proofGraphDependency.operatorPredicateNodeId,
        adminSurfaceNodeId: proofGraphDependency.adminSurfaceNodeId,
        familyProofTargets: proofGraphDependency.familyProofTargets,
        operatorProofTarget: proofGraphDependency.operatorProofTarget,
        edgeIds: proofGraphDependency.edges.map((edge) => edge.id),
      },
      releaseReady: false,
      productionReady: false,
      proofBoundary:
        "Local operator-evidence promotion predicate only. Passing means a non-fixture hosted identity evidence packet path clears the hosted-production-identity readiness item when the identity adapter prerequisite is already passed; it does not prove live hosted identity traffic, release readiness, or production readiness.",
    },
  };
  await writeJsonArtifact(operatorAdminProofPath, persisted);
  console.log(`wrote ${devTestGameHostedIdentityOperatorAdminProofPath}`);
}

async function writeJsonArtifact(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
