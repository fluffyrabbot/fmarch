export const replacementActionFeatureSpineSourceCheckId =
  "local-replacement-action-proof";
export const replacementActionFeatureSpineCycleId = "replacement-action";
export const replacementActionFeatureSlotId = "replacement-action-recovery";
export const devTestGameReplacementActionProofCommand =
  "npm run test:dev-test-game-core-live";

export const replacementActionFeatureSpineSource = Object.freeze({
  sourceCheckId: replacementActionFeatureSpineSourceCheckId,
  graphSourceNodeId: "role-surface:replacement-action",
  readinessSourceKind: "spine-targets",
  detailRoleUrlIncludes: "/g/<replacement-action-game>",
  roleUrlIncludes: "/g/<replacement-action-game>",
  rerunCommand: devTestGameReplacementActionProofCommand,
});

export const replacementActionFeatureSpineTargetRows = Object.freeze({
  replacementActionRecovery: Object.freeze({
    featureSlotId: replacementActionFeatureSlotId,
    sourceCheckId: replacementActionFeatureSpineSourceCheckId,
    cycleId: replacementActionFeatureSpineCycleId,
    roleUrlId: "replacement-action",
    checkpointId: "replacement-incoming-action",
    adminCheckId: "replacement-incoming-action",
  }),
});
