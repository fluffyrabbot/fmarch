export const cohostFeatureSpineSourceCheckId = "local-cohost-console-proof";
export const cohostFeatureSpineCycleId = "cohost-console";
export const cohostConsoleFeatureSlotId = "cohost-console";
export const devTestGameCohostConsoleProofCommand =
  "npm run test:dev-test-game-core-live";

export const cohostFeatureSpineSource = Object.freeze({
  sourceCheckId: cohostFeatureSpineSourceCheckId,
  graphSourceNodeId: "role-surface:cohost-console",
  readinessSourceKind: "spine-targets",
  detailRoleUrlIncludes: "/g/<seeded-game>/host",
  roleUrlIncludes: "/g/<seeded-game>/host",
  rerunCommand: devTestGameCohostConsoleProofCommand,
});

export const cohostFeatureSpineTargetRows = Object.freeze({
  cohostConsole: Object.freeze({
    featureSlotId: cohostConsoleFeatureSlotId,
    sourceCheckId: cohostFeatureSpineSourceCheckId,
    cycleId: cohostFeatureSpineCycleId,
    roleUrlId: "cohost-console",
    checkpointId: "extend-deadline-ack",
    adminCheckId: "cohost-console",
  }),
});
