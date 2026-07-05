import {
  devTestGameHostedConcurrentRaceMatrixAdminProofPath,
} from "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs";
import {
  devTestGameHostedIdentityEvidenceAdminProofPath,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  devTestGameRealHostedObservabilityHandoffAdminProofPath,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";

export const hostedAdminHandoffProofArtifactCases = Object.freeze([
  createHostedAdminHandoffProofArtifactCase({
    id: "hosted-identity-evidence-admin-proof",
    manifestCommandKey: "hostedIdentityEvidenceAdminProof",
    readinessId: "hostedIdentityEvidenceAdminProof",
    refreshId: "hosted-identity-evidence-admin",
    label: "hosted identity evidence admin proof",
    script: "test:dev-test-game-hosted-identity-evidence-admin-proof",
    path: devTestGameHostedIdentityEvidenceAdminProofPath,
    envVar: "FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE_ADMIN_PROOF",
    outputKeys: {
      data: "hostedIdentityEvidenceAdminProof",
      path: "hostedIdentityEvidenceAdminProofPath",
      freshnessMetadata: "hostedIdentityEvidenceAdminProofArtifact",
    },
    roleUrl:
      "/admin/audit/local-hosted-identity-evidence?game=<seeded-game>",
  }),
  createHostedAdminHandoffProofArtifactCase({
    id: "hosted-concurrent-race-matrix-admin-proof",
    manifestCommandKey: "hostedConcurrentRaceMatrixAdminProof",
    readinessId: "hostedConcurrentRaceMatrixAdminProof",
    refreshId: "hosted-concurrent-race-matrix-admin",
    label: "hosted concurrent race matrix admin proof",
    script: "test:dev-test-game-hosted-concurrent-race-matrix-admin-proof",
    path: devTestGameHostedConcurrentRaceMatrixAdminProofPath,
    envVar:
      "FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX_ADMIN_PROOF",
    outputKeys: {
      data: "hostedConcurrentRaceMatrixAdminProof",
      path: "hostedConcurrentRaceMatrixAdminProofPath",
      freshnessMetadata: "hostedConcurrentRaceMatrixAdminProofArtifact",
    },
    roleUrl:
      "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
  }),
  createHostedAdminHandoffProofArtifactCase({
    id: "real-hosted-observability-handoff-admin-proof",
    manifestCommandKey: "realHostedObservabilityHandoffAdminProof",
    readinessId: "realHostedObservabilityHandoffAdminProof",
    refreshId: "real-hosted-observability-handoff-admin",
    label: "real hosted observability handoff admin proof",
    script: "test:dev-test-game-real-hosted-observability-handoff-admin-proof",
    path: devTestGameRealHostedObservabilityHandoffAdminProofPath,
    envVar:
      "FMARCH_DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF_ADMIN_PROOF",
    outputKeys: {
      data: "realHostedObservabilityHandoffAdminProof",
      path: "realHostedObservabilityHandoffAdminProofPath",
      freshnessMetadata: "realHostedObservabilityHandoffAdminProofArtifact",
    },
    roleUrl:
      "/admin/audit/local-real-hosted-observability-handoff?game=<seeded-game>",
  }),
]);

export const hostedAdminHandoffProofArtifactCaseByManifestCommandKey =
  new Map(
    hostedAdminHandoffProofArtifactCases.map((artifactCase) => [
      artifactCase.manifestCommandKey,
      artifactCase,
    ]),
  );

export function hostedAdminHandoffProofArtifactCase(key) {
  const artifactCase =
    hostedAdminHandoffProofArtifactCaseByManifestCommandKey.get(key);
  if (artifactCase === undefined) {
    throw new Error(`unknown hosted admin handoff proof artifact case: ${key}`);
  }
  return artifactCase;
}

function createHostedAdminHandoffProofArtifactCase(artifactCase) {
  return Object.freeze({
    ...artifactCase,
    command: `npm run ${artifactCase.script}`,
    outputKeys: Object.freeze({ ...artifactCase.outputKeys }),
  });
}
