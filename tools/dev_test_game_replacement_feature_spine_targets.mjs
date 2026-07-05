export const replacementFeatureSpineSourceCheckId =
  "local-replacement-player-proof";
export const replacementFeatureSpineCycleId = "replacement-player";
export const replacementPlayerFeatureSlotId = "replacement-player-role-surface";
export const devTestGameReplacementPlayerProofCommand =
  "npm run test:dev-test-game-core-live";

export const replacementFeatureSpineSource = Object.freeze({
  sourceCheckId: replacementFeatureSpineSourceCheckId,
  graphSourceNodeId: "role-surface:replacement-player",
  readinessSourceKind: "spine-targets",
  detailRoleUrlIncludes: "/g/<seeded-game>",
  roleUrlIncludes: "/g/<seeded-game>",
  rerunCommand: devTestGameReplacementPlayerProofCommand,
});

export const replacementFeatureSpineTargetRows = Object.freeze({
  replacementPlayer: Object.freeze({
    featureSlotId: replacementPlayerFeatureSlotId,
    sourceCheckId: replacementFeatureSpineSourceCheckId,
    cycleId: replacementFeatureSpineCycleId,
    roleUrlId: "replacement-player",
    checkpointId: "incoming-player-slot-authority",
    adminCheckId: "replacement-incoming-player",
  }),
});
