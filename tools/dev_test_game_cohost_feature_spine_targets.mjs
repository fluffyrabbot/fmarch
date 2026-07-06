import {
  devTestGameProofRunPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  featureSpineTargetProvenanceCase,
} from "./dev_test_game_feature_spine_target_provenance.mjs";

export const cohostFeatureSpineSourceCheckId = "local-cohost-console-proof";
export const cohostFeatureSpineCycleId = "cohost-console";
export const cohostConsoleFeatureSlotId = "cohost-console";
export const devTestGameCohostConsoleProofCommand =
  "npm run test:dev-test-game-core-live:local";

export const cohostFeatureSpineSource = Object.freeze({
  sourceCheckId: cohostFeatureSpineSourceCheckId,
  graphSourceNodeId: "role-surface:cohost-console",
  readinessSourceKind: "spine-targets",
  coverageDecision: Object.freeze({
    kind: "seeded-role-url-proof",
    proofCommand: devTestGameCohostConsoleProofCommand,
  }),
  detailRoleUrlIncludes: "/g/<seeded-game>/host",
  roleUrlIncludes: "/g/<seeded-game>/host",
  proofArtifact: devTestGameProofRunPath,
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

export const cohostFeatureSpineTargetProvenanceCases = Object.freeze([
  featureSpineTargetProvenanceCase({
    targetKey: "cohostConsole",
    sourceFactory: "cohostFeatureSpineTargetRows.cohostConsole",
    sourceRow: cohostFeatureSpineTargetRows.cohostConsole,
    source: cohostFeatureSpineSource,
  }),
]);
