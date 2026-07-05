import {
  cohostFeatureSpineSource,
  cohostFeatureSpineTargetRows,
} from "./dev_test_game_cohost_feature_spine_targets.mjs";
import {
  hostSetupFeatureSpineSource,
  hostSetupFeatureSpineTargetRows,
} from "./dev_test_game_host_setup_feature_spine_targets.mjs";
import {
  replacementFeatureSpineSource,
  replacementFeatureSpineTargetRows,
} from "./dev_test_game_replacement_feature_spine_targets.mjs";
import {
  replacementActionFeatureSpineSource,
  replacementActionFeatureSpineTargetRows,
} from "./dev_test_game_replacement_action_feature_spine_targets.mjs";
import {
  replacementPrivateFeatureSpineSource,
  replacementPrivateFeatureSpineTargetRows,
} from "./dev_test_game_replacement_private_feature_spine_targets.mjs";

export const proofGraphAdminFeatureTargetCases = Object.freeze([
  Object.freeze({
    generatedFromKey: "hostSetupFeatureTarget",
    label: "host setup",
    source: hostSetupFeatureSpineSource,
    targetRow: hostSetupFeatureSpineTargetRows.hostSetupRoute,
  }),
  Object.freeze({
    generatedFromKey: "cohostFeatureTarget",
    label: "cohost console",
    source: cohostFeatureSpineSource,
    targetRow: cohostFeatureSpineTargetRows.cohostConsole,
  }),
  Object.freeze({
    generatedFromKey: "replacementFeatureTarget",
    label: "replacement player",
    source: replacementFeatureSpineSource,
    targetRow: replacementFeatureSpineTargetRows.replacementPlayer,
  }),
  Object.freeze({
    generatedFromKey: "replacementActionFeatureTarget",
    label: "replacement action",
    source: replacementActionFeatureSpineSource,
    targetRow: replacementActionFeatureSpineTargetRows.replacementActionRecovery,
  }),
  Object.freeze({
    generatedFromKey: "replacementPrivateFeatureTarget",
    label: "replacement private",
    source: replacementPrivateFeatureSpineSource,
    targetRow: replacementPrivateFeatureSpineTargetRows.replacementPrivateChannel,
  }),
]);
