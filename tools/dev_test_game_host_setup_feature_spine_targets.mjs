export const hostSetupFeatureSpineSourceCheckId = "local-host-setup-proof";
export const hostSetupFeatureSpineCycleId = "host-setup";
export const devTestGameHostSetupProofCommand =
  "npm run dev:test-game -- --verify-host-setup-only";

export const hostSetupFeatureSpineSource = Object.freeze({
  sourceCheckId: hostSetupFeatureSpineSourceCheckId,
  graphSourceNodeId: "role-surface:host-setup",
  readinessSourceKind: "spine-targets",
  detailRoleUrlIncludes: "/g/<seeded-game>/setup",
  roleUrlIncludes: "/g/<seeded-game>/setup",
  rerunCommand: devTestGameHostSetupProofCommand,
});

export const hostSetupFeatureSpineTargetRows = Object.freeze({
  hostSetupRoute: Object.freeze({
    featureSlotId: "host-setup-route",
    sourceCheckId: hostSetupFeatureSpineSourceCheckId,
    cycleId: hostSetupFeatureSpineCycleId,
    roleUrlId: "host-setup",
    checkpointId: "start-phase",
    adminCheckId: "start-phase",
  }),
});
