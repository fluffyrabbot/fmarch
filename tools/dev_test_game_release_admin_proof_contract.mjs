import path from "node:path";
import { readFile } from "node:fs/promises";
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
    status: "passed",
    readinessPath: path.relative(repoRoot, readinessArtifactPath),
    releaseAdminProofPath: path.relative(repoRoot, releaseAdminProofPath),
    localDiagnosticIds: Object.freeze(releaseReadinessDiagnosticIds(readiness)),
  });
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const contract = await assertReleaseAdminProofArtifactContract();
  console.log(
    `validated ${contract.releaseAdminProofPath} against ${contract.readinessPath} (${contract.localDiagnosticIds.length} diagnostics)`,
  );
}
