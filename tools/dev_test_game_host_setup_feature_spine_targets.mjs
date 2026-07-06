import {
  featureSpineTargetProvenanceCase,
} from "./dev_test_game_feature_spine_target_provenance.mjs";

export const hostSetupFeatureSpineSourceCheckId = "local-host-setup-proof";
export const hostSetupFeatureSpineCycleId = "host-setup";
export const devTestGameHostSetupProofPath =
  "target/dev-test-game/host-setup-proof.json";
export const devTestGameHostSetupProofCommand =
  "npm run dev:test-game -- --verify-host-setup-only";

export const hostSetupFeatureSpineSource = Object.freeze({
  sourceCheckId: hostSetupFeatureSpineSourceCheckId,
  graphSourceNodeId: "role-surface:host-setup",
  readinessSourceKind: "spine-targets",
  coverageDecision: Object.freeze({
    kind: "seeded-role-url-proof",
    proofCommand: devTestGameHostSetupProofCommand,
  }),
  detailRoleUrlIncludes: "/g/<seeded-game>/setup",
  roleUrlIncludes: "/g/<seeded-game>/setup",
  proofArtifact: devTestGameHostSetupProofPath,
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

export const hostSetupFeatureSpineTargetProvenanceCases = Object.freeze([
  featureSpineTargetProvenanceCase({
    targetKey: "hostSetupRoute",
    sourceFactory: "hostSetupFeatureSpineTargetRows.hostSetupRoute",
    sourceRow: hostSetupFeatureSpineTargetRows.hostSetupRoute,
    source: hostSetupFeatureSpineSource,
  }),
]);
