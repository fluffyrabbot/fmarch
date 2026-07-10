import { pathToFileURL } from "node:url";
import {
  readinessEvidenceEnv,
} from "./dev_test_game_ops_artifact_dependencies.mjs";
import {
  devTestGameHostedIdentityProgressionAdminProofBatchScript,
  hostedIdentityProgressionAdminProofBatchArtifactPaths,
} from "./dev_test_game_hosted_identity_progression_admin_proof_batch.mjs";
import { runSpinePlan } from "./dev_test_game_spine_runner.mjs";
import { releaseReadinessStep } from "./dev_test_game_spine_readiness_steps.mjs";

export const hostedIdentityEvidenceReadinessArtifactIds = [
  "opsArtifacts",
  "seedFixture",
  "seedAdminProof",
  "identityAdapterProof",
  "identityAdminProof",
  "hostedIdentityEvidence",
  "hostedIdentityProgressionSummary",
  "hostedIdentityEvidenceAdminProof",
];

export const hostedIdentityEvidenceReadinessEnv = readinessEvidenceEnv(
  hostedIdentityEvidenceReadinessArtifactIds,
);

export const devTestGameHostedIdentityEvidenceSpinePlan = [
  {
    kind: "node",
    script: "tools/dev_test_game_hosted_identity_real_evidence_guard.mjs",
  },
  {
    kind: "node",
    script: "tools/dev_test_game_hosted_identity_evidence.mjs",
  },
  {
    kind: "node",
    script: "tools/dev_test_game_hosted_identity_evidence_admin_proof.mjs",
  },
  {
    kind: "node",
    script: "tools/dev_test_game_hosted_identity_progression_summary.mjs",
  },
  {
    kind: "node",
    script: devTestGameHostedIdentityProgressionAdminProofBatchScript,
  },
  releaseReadinessStep({
    reason: "hosted-identity-operator-evidence-intake",
    changedArtifactIds: hostedIdentityEvidenceReadinessArtifactIds.slice(5),
    additionalChangedInputs: hostedIdentityProgressionAdminProofBatchArtifactPaths,
    env: hostedIdentityEvidenceReadinessEnv,
  }),
];

export async function runDevTestGameHostedIdentityEvidenceSpine() {
  await runSpinePlan(devTestGameHostedIdentityEvidenceSpinePlan);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runDevTestGameHostedIdentityEvidenceSpine();
}
