export const devTestGameHostedTargetPreflightAdminProofPath =
  "target/dev-test-game/hosted-target-preflight-admin-proof.json";

export const hostedTargetPreflightBlockingCheckIds = Object.freeze([
  "hosted-frontend-url-configured",
  "hosted-api-url-configured",
  "hosted-targets-external",
  "raw-evidence-path-configured",
  "raw-evidence-readable",
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
  "Set FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH to a readable raw hosted matrix evidence JSON captured from the same frontend/API/group, then rerun npm run test:dev-test-game-hosted-evidence-lane.";

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
