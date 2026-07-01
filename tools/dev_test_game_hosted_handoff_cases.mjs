import {
  hostedTargetPreflightBlockingCheckIds,
} from "./dev_test_game_hosted_target_preflight.mjs";
import { realHostedEvidenceInputIds } from "./dev_test_game_real_hosted_evidence_inputs.mjs";

export const hostedEvidenceHandoffInputIds = realHostedEvidenceInputIds;
export const hostedEvidenceHandoffBlockedCheckIds =
  hostedTargetPreflightBlockingCheckIds;

export function hostedEvidenceHandoffCase() {
  return {
    inputIds: [...hostedEvidenceHandoffInputIds],
    blockedCheckIds: [...hostedEvidenceHandoffBlockedCheckIds],
  };
}

export function hostedEvidenceLaneHandoffFixture() {
  return {
    blockedCheckIds: [...hostedEvidenceHandoffBlockedCheckIds],
    hostedEvidence: {
      realHostedEvidenceInputs: {
        command: "npm run test:dev-test-game-hosted-evidence-lane",
        proofTarget: "target/dev-test-game/hosted-matrix-external.json",
        env: hostedEvidenceHandoffInputIds
          .filter((id) => id.startsWith("FMARCH_HOSTED_MATRIX_"))
          .map((name) => ({ name })),
      },
    },
  };
}
