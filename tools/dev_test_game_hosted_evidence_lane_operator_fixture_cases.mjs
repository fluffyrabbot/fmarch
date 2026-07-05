export const devTestGameHostedEvidenceLaneOperatorFixturePath =
  "target/dev-test-game/hosted-evidence-lane-operator-fixture.json";
export const devTestGameHostedEvidenceLaneOperatorFixtureAdminProofPath =
  "target/dev-test-game/hosted-evidence-lane-operator-fixture-admin-proof.json";
export const devTestGameHostedEvidenceLaneOperatorFixtureAdminProofCommand =
  "test:dev-test-game-hosted-evidence-lane-operator-fixture-admin-proof";

export function assertHostedEvidenceLaneOperatorFixtureAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !==
      "dev-test-game-hosted-evidence-lane-operator-fixture-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !==
      "local-dev-test-game-hosted-evidence-lane-operator-fixture-admin-surface" ||
    evidence.generatedFrom?.operatorFixture !== true ||
    evidence.generatedFrom?.fixtureEvidence !== true ||
    evidence.generatedFrom?.targetMatchedFixture !== true ||
    evidence.generatedFrom?.checkStatuses?.["raw-evidence-readable"] !==
      "passed" ||
    evidence.generatedFrom?.checkStatuses?.["raw-evidence-real-hosted-target"] !==
      "blocked" ||
    evidence.adminRoleSurface?.visibleChecks?.includes("raw-evidence-readable") !==
      true ||
    evidence.adminRoleSurface?.visibleChecks?.includes(
      "raw-evidence-real-hosted-target",
    ) !== true ||
    evidence.adminRoleSurface?.visibleUnproven?.includes(
      "raw-evidence-real-hosted-target",
    ) !== true
  ) {
    throw new Error("hosted evidence lane operator fixture admin proof drifted");
  }
  return evidence;
}
