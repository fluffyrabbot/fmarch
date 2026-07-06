import {
  devTestGameProofRunPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  featureSpineTargetProvenanceCase,
} from "./dev_test_game_feature_spine_target_provenance.mjs";

export const replacementPrivateFeatureSpineSourceCheckId =
  "local-replacement-private-proof";
export const replacementPrivateFeatureSpineCycleId =
  "replacement-private-channel";
export const replacementPrivateFeatureSlotId =
  "replacement-private-channel-recovery";
export const devTestGameReplacementPrivateProofCommand =
  "npm run test:dev-test-game-core-live:local";

export const replacementPrivateFeatureSpineSource = Object.freeze({
  sourceCheckId: replacementPrivateFeatureSpineSourceCheckId,
  graphSourceNodeId: "role-surface:replacement-private-channel",
  readinessSourceKind: "spine-targets",
  coverageDecision: Object.freeze({
    kind: "seeded-role-url-proof",
    proofCommand: devTestGameReplacementPrivateProofCommand,
  }),
  detailRoleUrlIncludes:
    "/g/<replacement-private-game>/c/private%3Amafia_day_chat",
  roleUrlIncludes: "/g/<replacement-private-game>/c/private%3Amafia_day_chat",
  proofArtifact: devTestGameProofRunPath,
  rerunCommand: devTestGameReplacementPrivateProofCommand,
});

export const replacementPrivateFeatureSpineTargetRows = Object.freeze({
  replacementPrivateChannel: Object.freeze({
    featureSlotId: replacementPrivateFeatureSlotId,
    sourceCheckId: replacementPrivateFeatureSpineSourceCheckId,
    cycleId: replacementPrivateFeatureSpineCycleId,
    roleUrlId: "replacement-private-channel",
    checkpointId: "replacement-stale-private-channel",
    adminCheckId: "replacement-stale-private-channel",
  }),
});

export const replacementPrivateFeatureSpineTargetProvenanceCases =
  Object.freeze([
    featureSpineTargetProvenanceCase({
      targetKey: "replacementPrivateChannel",
      sourceFactory:
        "replacementPrivateFeatureSpineTargetRows.replacementPrivateChannel",
      sourceRow:
        replacementPrivateFeatureSpineTargetRows.replacementPrivateChannel,
      source: replacementPrivateFeatureSpineSource,
    }),
  ]);
