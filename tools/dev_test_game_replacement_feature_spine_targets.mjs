import {
  devTestGameProofRunPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  featureSpineTargetProvenanceCase,
} from "./dev_test_game_feature_spine_target_provenance.mjs";

export const replacementFeatureSpineSourceCheckId =
  "local-replacement-player-proof";
export const replacementFeatureSpineCycleId = "replacement-player";
export const replacementPlayerFeatureSlotId = "replacement-player-role-surface";
export const devTestGameReplacementPlayerProofCommand =
  "npm run test:dev-test-game-core-live:local";

export const replacementFeatureSpineSource = Object.freeze({
  sourceCheckId: replacementFeatureSpineSourceCheckId,
  graphSourceNodeId: "role-surface:replacement-player",
  readinessSourceKind: "spine-targets",
  coverageDecision: Object.freeze({
    kind: "seeded-role-url-proof",
    proofCommand: devTestGameReplacementPlayerProofCommand,
  }),
  detailRoleUrlIncludes: "/g/<seeded-game>",
  roleUrlIncludes: "/g/<seeded-game>",
  proofArtifact: devTestGameProofRunPath,
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

export const replacementFeatureSpineTargetProvenanceCases = Object.freeze([
  featureSpineTargetProvenanceCase({
    targetKey: "replacementPlayer",
    sourceFactory: "replacementFeatureSpineTargetRows.replacementPlayer",
    sourceRow: replacementFeatureSpineTargetRows.replacementPlayer,
    source: replacementFeatureSpineSource,
  }),
]);
