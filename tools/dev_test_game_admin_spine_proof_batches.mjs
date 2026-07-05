import {
  defineAdminProofBatchRegistry,
} from "./dev_test_game_admin_proof_batch_registry.mjs";
import {
  devTestGameHostedConcurrentRaceMatrixAdminProofPath,
} from "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs";
import {
  devTestGameHostedEvidenceLaneAdminProofPath,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  devTestGameHostedIdentityEvidenceAdminProofPath,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  devTestGameHostedOpsSignalsAdminProofPath,
} from "./dev_test_game_hosted_ops_signal_cases.mjs";
import {
  devTestGameHostedTargetPreflightAdminProofPath,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import {
  devTestGameBackupAdminProofPath,
  devTestGameCoreLoopAdminProofPath,
  devTestGameHardeningAdminProofPath,
  devTestGameIdentityAdminProofPath,
  devTestGameOpsAdminProofPath,
  devTestGameSeedAdminProofPath,
  devTestGameSpineManifestAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  devTestGameRaceCoverageAdminProofPath,
} from "./dev_test_game_race_coverage.mjs";
import {
  devTestGameRealHostedObservabilityHandoffAdminProofPath,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  devTestGameReleaseAdminProofPath,
  devTestGameReleaseRunbookAdminProofPath,
} from "./dev_test_game_release_artifact_paths.mjs";

export const aggregatePreReleaseAdminProofBatchScript =
  "aggregate-pre-release-admin-proof-batch";
export const aggregateReleaseHostedAdminProofBatchScript =
  "aggregate-release-and-hosted-admin-proof-batch";

export const aggregatePreReleaseAdminProofBatchLabel =
  "Aggregate pre-release admin proof batch";
export const aggregateReleaseHostedAdminProofBatchLabel =
  "Aggregate release and hosted admin proof batch";

export const aggregatePreReleaseAdminProofBatchReason =
  "core, hardening, identity, backup, ops, and seed admin surfaces share the pre-readiness local proof inputs";
export const aggregateReleaseHostedAdminProofBatchReason =
  "release, hosted, race coverage, and manifest admin surfaces share the post-readiness rollup inputs";

export const adminSpineProofArtifactPathById = Object.freeze({
  "core-loop": devTestGameCoreLoopAdminProofPath,
  hardening: devTestGameHardeningAdminProofPath,
  identity: devTestGameIdentityAdminProofPath,
  "hosted-identity-evidence": devTestGameHostedIdentityEvidenceAdminProofPath,
  backup: devTestGameBackupAdminProofPath,
  ops: devTestGameOpsAdminProofPath,
  seed: devTestGameSeedAdminProofPath,
  release: devTestGameReleaseAdminProofPath,
  "release-runbook": devTestGameReleaseRunbookAdminProofPath,
  "race-coverage": devTestGameRaceCoverageAdminProofPath,
  "hosted-target-preflight": devTestGameHostedTargetPreflightAdminProofPath,
  "hosted-evidence-lane": devTestGameHostedEvidenceLaneAdminProofPath,
  "hosted-concurrent-race-matrix":
    devTestGameHostedConcurrentRaceMatrixAdminProofPath,
  "hosted-ops-signals": devTestGameHostedOpsSignalsAdminProofPath,
  "real-hosted-observability-handoff":
    devTestGameRealHostedObservabilityHandoffAdminProofPath,
  "spine-manifest": devTestGameSpineManifestAdminProofPath,
});

export const adminSpineProofBatchRegistry = defineAdminProofBatchRegistry(
  [
    {
      label: aggregatePreReleaseAdminProofBatchLabel,
      script: aggregatePreReleaseAdminProofBatchScript,
      reason: aggregatePreReleaseAdminProofBatchReason,
      proofIds: [
        "core-loop",
        "hardening",
        "identity",
        "hosted-identity-evidence",
        "backup",
        "ops",
        "seed",
      ],
    },
    {
      label: aggregateReleaseHostedAdminProofBatchLabel,
      script: aggregateReleaseHostedAdminProofBatchScript,
      reason: aggregateReleaseHostedAdminProofBatchReason,
      proofIds: [
        "release",
        "release-runbook",
        "race-coverage",
        "hosted-target-preflight",
        "hosted-evidence-lane",
        "hosted-concurrent-race-matrix",
        "hosted-ops-signals",
        "real-hosted-observability-handoff",
        "spine-manifest",
      ],
    },
  ],
  { artifactPathForProofId: adminSpineProofArtifactPathForId },
);

export const adminSpineProofIds = Object.freeze(
  adminSpineProofBatchRegistry.flatMap((batch) => batch.proofIds),
);

export function adminSpineProofArtifactPathForId(id) {
  const artifactPath = adminSpineProofArtifactPathById[id];
  if (artifactPath === undefined) {
    throw new Error(`unknown admin spine proof id: ${id}`);
  }
  return artifactPath;
}
