export {
  devTestGameRealHostedMatrixRawCapturePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
export const devTestGameRealHostedMatrixRawCaptureCommand =
  "test:dev-test-game-real-hosted-matrix-raw-capture";

export function assertDevTestGameRealHostedMatrixRawCapture(proof) {
  if (
    proof?.version !== 1 ||
    proof.proof !== "dev-test-game-real-hosted-matrix-raw-capture" ||
    !["passed", "blocked"].includes(proof.status) ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.scope !== "real-hosted-matrix-raw-capture" ||
    !Array.isArray(proof.checks) ||
    !Array.isArray(proof.blockedCheckIds)
  ) {
    throw new Error("real hosted matrix raw capture proof shape drifted");
  }
  const checks = new Map(proof.checks.map((check) => [check.id, check]));
  for (const id of [
    "raw-evidence-path-configured",
    "raw-evidence-contract-valid",
    "fixture-and-demo-markers-absent",
    "capture-redaction-retention-metadata",
    "release-claim-boundary-carried",
  ]) {
    if (!checks.has(id)) {
      throw new Error(`real hosted matrix raw capture missing check: ${id}`);
    }
  }
  const blockedCheckIds = proof.checks
    .filter((check) => check.status === "blocked")
    .map((check) => check.id);
  if (JSON.stringify(proof.blockedCheckIds) !== JSON.stringify(blockedCheckIds)) {
    throw new Error("real hosted matrix raw capture blocked check ids drifted");
  }
  if (
    proof.status === "passed" &&
    (blockedCheckIds.length !== 0 ||
      proof.target.rawEvidenceFixture !== false ||
      proof.target.rawEvidenceSyntheticExternalTarget !== false)
  ) {
    throw new Error("real hosted matrix raw capture passed with blocked evidence");
  }
  if (proof.status === "blocked" && blockedCheckIds.length === 0) {
    throw new Error("real hosted matrix raw capture blocked without blocked checks");
  }
  if (checks.get("release-claim-boundary-carried")?.releaseReady !== false) {
    throw new Error("real hosted matrix raw capture made a release claim");
  }
  return proof;
}
