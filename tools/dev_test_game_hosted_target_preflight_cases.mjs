import {
  hostedMatrixRawEvidenceContractSummary,
} from "./dev_test_game_hosted_matrix_raw_evidence_contract.mjs";
import {
  devTestGameHostedMatrixRawEvidenceTemplatePath,
  devTestGameHostedMatrixRawEvidenceTemplateProofCommand,
} from "./dev_test_game_hosted_matrix_raw_evidence_template_proof.mjs";
import {
  devTestGameRealHostedMatrixRawCaptureCommand,
} from "./dev_test_game_real_hosted_matrix_raw_capture_contract.mjs";

export const devTestGameHostedTargetPreflightAdminProofPath =
  "target/dev-test-game/hosted-target-preflight-admin-proof.json";
export const devTestGameHostedTargetPreflightRealCaptureAdminProofPath =
  "target/dev-test-game/hosted-target-preflight-real-capture-admin-proof.json";
export const devTestGameHostedTargetPreflightRealCaptureProofSourcePath =
  "target/dev-test-game/hosted-target-preflight-real-capture-source.json";

export const hostedTargetPreflightBlockingCheckIds = Object.freeze([
  "hosted-frontend-url-configured",
  "hosted-api-url-configured",
  "hosted-targets-external",
  "raw-evidence-path-configured",
  "raw-evidence-readable",
  "raw-evidence-real-hosted-target",
]);

export const hostedTargetPreflightCheckIds = Object.freeze([
  ...hostedTargetPreflightBlockingCheckIds,
  "release-claim-boundary-carried",
]);

export const hostedTargetPreflightMissingFrontendUrlRequiredEvidence =
  "Set FMARCH_HOSTED_MATRIX_FRONTEND_URL to the externally reachable frontend base URL, then rerun npm run test:dev-test-game-hosted-evidence-lane.";

export const hostedTargetPreflightMissingApiUrlRequiredEvidence =
  "Set FMARCH_HOSTED_MATRIX_API_URL to the externally reachable API base URL for the same hosted deployment, then rerun npm run test:dev-test-game-hosted-evidence-lane.";

export const hostedTargetPreflightMissingRawEvidencePathRequiredEvidence =
  `Start from ${devTestGameHostedMatrixRawEvidenceTemplatePath}; validate the template with npm run ${devTestGameHostedMatrixRawEvidenceTemplateProofCommand}; fill a copy with real hosted capture data, set FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH to that readable ${hostedMatrixRawEvidenceContractSummary()} captured from the same externally reachable frontend/API/group, then rerun npm run ${devTestGameRealHostedMatrixRawCaptureCommand} and npm run test:dev-test-game-hosted-evidence-lane.`;

export const hostedTargetPreflightSyntheticRawEvidenceRequiredEvidence =
  `Replace synthetic demo raw evidence with a filled copy of ${devTestGameHostedMatrixRawEvidenceTemplatePath} containing a real ${hostedMatrixRawEvidenceContractSummary()} captured from an externally reachable hosted target; synthetic demo evidence can only prove the local handoff shape.`;

export const hostedTargetPreflightFixtureRawEvidenceRequiredEvidence =
  `Replace redacted fixture raw evidence with a filled copy of ${devTestGameHostedMatrixRawEvidenceTemplatePath} containing a real ${hostedMatrixRawEvidenceContractSummary()} captured from an externally reachable hosted target; fixture packets can prove operator handoff shape and target matching only.`;

export const hostedTargetPreflightRawCaptureRequiredEvidence =
  `Run npm run ${devTestGameRealHostedMatrixRawCaptureCommand} with a filled copy of ${devTestGameHostedMatrixRawEvidenceTemplatePath} containing a real ${hostedMatrixRawEvidenceContractSummary()} that includes capture.externallyCaptured=true plus capture/redaction/retention metadata; only a passed raw-capture intake or equivalent embedded metadata can satisfy the real hosted target check.`;

export function hostedTargetPreflightExternalTargetsRequiredEvidence({
  frontendBaseUrl = null,
  apiBaseUrl = null,
} = {}) {
  return [
    "Set FMARCH_HOSTED_MATRIX_FRONTEND_URL and FMARCH_HOSTED_MATRIX_API_URL to externally reachable http(s) URLs for the same hosted deployment.",
    "Do not use localhost, loopback, private-network, link-local, or reserved IP targets.",
    `Observed frontend=${frontendBaseUrl ?? "<unset>"} api=${apiBaseUrl ?? "<unset>"}.`,
    "Rerun npm run test:dev-test-game-hosted-evidence-lane.",
  ].join(" ");
}
