import { pathToFileURL } from "node:url";
import {
  writeHostedIdentityProgressionAdminProof,
} from "./dev_test_game_hosted_identity_evidence_admin_proof.mjs";
import {
  hostedIdentityEvidenceFamilyProgressionCases,
  hostedIdentityEvidenceProgressionAdminProofPath,
  hostedIdentityEvidenceProgressionPath,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";

export const devTestGameHostedIdentityProgressionAdminProofBatchScript =
  "tools/dev_test_game_hosted_identity_progression_admin_proof_batch.mjs";

export const hostedIdentityProgressionAdminProofBatchPlan = Object.freeze(
  hostedIdentityEvidenceFamilyProgressionCases.map((progression) =>
    Object.freeze({
      progressionId: progression.id,
      evidencePath: hostedIdentityEvidenceProgressionPath(progression.id),
      adminProofPath: hostedIdentityEvidenceProgressionAdminProofPath(
        progression.id,
      ),
    }),
  ),
);

export const hostedIdentityProgressionAdminProofBatchArtifactPaths =
  Object.freeze(
    hostedIdentityProgressionAdminProofBatchPlan.flatMap((step) => [
      step.evidencePath,
      step.adminProofPath,
    ]),
  );

export async function writeHostedIdentityProgressionAdminProofBatch({
  plan = hostedIdentityProgressionAdminProofBatchPlan,
} = {}) {
  const results = [];
  for (const step of plan) {
    await writeHostedIdentityProgressionAdminProof({
      progressionId: step.progressionId,
      evidencePath: step.evidencePath,
      proofPath: step.adminProofPath,
    });
    results.push({ ...step, status: "passed" });
  }
  return Object.freeze(results);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const results = await writeHostedIdentityProgressionAdminProofBatch();
  console.log(
    `wrote ${results.length} hosted identity progression admin proofs`,
  );
}
