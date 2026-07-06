import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameReleaseReadiness,
} from "./dev_test_game_release_readiness.mjs";
import {
  assertReleaseAdminProof,
  assertReleaseAdminProofDiagnosticsMatchReadiness,
  releaseReadinessDiagnosticIds,
} from "./dev_test_game_release_admin_proof.mjs";
import {
  devTestGameReleaseAdminProofPath,
  devTestGameReleaseAdminProofContractPath,
} from "./dev_test_game_release_artifact_paths.mjs";
import {
  devTestGameReleaseReadinessPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  repoRoot,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const readinessPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS ??
    devTestGameReleaseReadinessPath,
);
const proofPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_RELEASE_ADMIN_PROOF ??
    devTestGameReleaseAdminProofPath,
);
const contractPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_RELEASE_ADMIN_PROOF_CONTRACT ??
    devTestGameReleaseAdminProofContractPath,
);

export const devTestGameReleaseAdminProofContractCommand =
  "test:dev-test-game-release-admin-proof-contract";

export async function assertReleaseAdminProofArtifactContract({
  readinessArtifactPath = readinessPath,
  releaseAdminProofPath = proofPath,
} = {}) {
  const readiness = assertDevTestGameReleaseReadiness(
    JSON.parse(await readFile(readinessArtifactPath, "utf8")),
  );
  const proof = assertReleaseAdminProof(
    JSON.parse(await readFile(releaseAdminProofPath, "utf8")),
  );
  assertReleaseAdminProofDiagnosticsMatchReadiness({ proof, readiness });
  return Object.freeze({
    version: 1,
    proof: "dev-test-game-release-admin-proof-contract",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-release-admin-proof-contract",
    proofBoundary:
      "Local terminal artifact contract for final release-readiness diagnostics. It verifies browser-visible release-admin diagnostics match the final release-readiness checklist; it does not prove hosted deployment, release readiness, beta readiness, or production readiness.",
    generatedFrom: {
      releaseReadinessChecklist: path.relative(repoRoot, readinessArtifactPath),
      releaseAdminProof: path.relative(repoRoot, releaseAdminProofPath),
      localDiagnosticIds: Object.freeze(releaseReadinessDiagnosticIds(readiness)),
    },
  });
}

export function assertReleaseAdminProofContractArtifact(contract) {
  if (contract?.version !== 1) {
    throw new Error(`release admin proof contract version drifted: ${contract?.version}`);
  }
  if (contract.proof !== "dev-test-game-release-admin-proof-contract") {
    throw new Error(`unexpected release admin proof contract id: ${contract.proof}`);
  }
  if (contract.status !== "passed") {
    throw new Error(`release admin proof contract status is ${contract.status}`);
  }
  if (contract.scope !== "local-dev-test-game-release-admin-proof-contract") {
    throw new Error(`release admin proof contract scope drifted: ${contract.scope}`);
  }
  if (contract.releaseReady !== false || contract.productionReady !== false) {
    throw new Error("release admin proof contract must not claim readiness");
  }
  if (
    contract.generatedFrom?.releaseReadinessChecklist !==
      devTestGameReleaseReadinessPath ||
    contract.generatedFrom.releaseAdminProof !== devTestGameReleaseAdminProofPath ||
    !Array.isArray(contract.generatedFrom.localDiagnosticIds)
  ) {
    throw new Error("release admin proof contract generatedFrom drifted");
  }
  return contract;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const contract = await assertReleaseAdminProofArtifactContract();
  assertReleaseAdminProofContractArtifact(contract);
  await mkdir(path.dirname(contractPath), { recursive: true });
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  const relativeContractPath = path.relative(repoRoot, contractPath);
  console.log(
    `wrote ${relativeContractPath}; validated ${contract.generatedFrom.releaseAdminProof} against ${contract.generatedFrom.releaseReadinessChecklist} (${contract.generatedFrom.localDiagnosticIds.length} diagnostics)`,
  );
}
