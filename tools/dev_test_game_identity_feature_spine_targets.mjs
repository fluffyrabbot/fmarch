export const identityFeatureSpineSourceCheckId =
  "local-identity-adapter-proof";

export const identityFeatureSpineTargetRows = Object.freeze({
  identityAdapter: Object.freeze({
    featureSlotId: "identity-adapter",
    sourceCheckId: identityFeatureSpineSourceCheckId,
    cycleId: "identity-adapter",
    roleUrlId: "local-identity-adapter",
    checkpointId: "account-login",
    adminCheckId: "account-login",
  }),
});
