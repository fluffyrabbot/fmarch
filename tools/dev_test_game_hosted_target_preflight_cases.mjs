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
