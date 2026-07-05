import {
  devTestGameProofRunPath,
} from "./dev_test_game_spine_artifact_paths.mjs";

export const replacementActionFeatureSpineSourceCheckId =
  "local-replacement-action-proof";
export const replacementActionFeatureSpineCycleId = "replacement-action";
export const replacementActionFeatureSlotId = "replacement-action-recovery";
export const devTestGameReplacementActionProofCommand =
  "npm run test:dev-test-game-core-live:local";

export const replacementActionFeatureSpineSource = Object.freeze({
  sourceCheckId: replacementActionFeatureSpineSourceCheckId,
  graphSourceNodeId: "role-surface:replacement-action",
  readinessSourceKind: "spine-targets",
  coverageDecision: Object.freeze({
    kind: "seeded-role-url-proof",
    proofCommand: devTestGameReplacementActionProofCommand,
  }),
  detailRoleUrlIncludes: "/g/<replacement-action-game>",
  roleUrlIncludes: "/g/<replacement-action-game>",
  proofArtifact: devTestGameProofRunPath,
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
