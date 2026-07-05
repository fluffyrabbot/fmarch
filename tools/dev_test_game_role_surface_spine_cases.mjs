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

export const roleSurfaceSpineCases = Object.freeze({
  hostSetup: Object.freeze({
    generatedFromKey: "hostSetupFeatureTarget",
    label: "host setup",
    source: hostSetupFeatureSpineSource,
    targetRow: hostSetupFeatureSpineTargetRows.hostSetupRoute,
    visibleAdminCheckIds: Object.freeze(["start-phase"]),
  }),
  cohost: Object.freeze({
    generatedFromKey: "cohostFeatureTarget",
    label: "cohost console",
    source: cohostFeatureSpineSource,
    targetRow: cohostFeatureSpineTargetRows.cohostConsole,
    visibleAdminCheckIds: Object.freeze(["cohost-console"]),
  }),
  replacement: Object.freeze({
    generatedFromKey: "replacementFeatureTarget",
    label: "replacement player",
    source: replacementFeatureSpineSource,
    targetRow: replacementFeatureSpineTargetRows.replacementPlayer,
    visibleAdminCheckIds: Object.freeze([
      "replacement-incoming-player",
      "replacement-stale-player",
    ]),
    buildVisibleAdminCheckIds: Object.freeze([
      "replacement-host-issued-invite",
      "replacement-session-refresh-recovery",
      "replacement-incoming-player",
      "replacement-stale-player",
      "replacement-stale-private-channel",
      "replacement-stale-private-receipts",
    ]),
  }),
  replacementAction: Object.freeze({
    generatedFromKey: "replacementActionFeatureTarget",
    label: "replacement action",
    source: replacementActionFeatureSpineSource,
    targetRow: replacementActionFeatureSpineTargetRows.replacementActionRecovery,
    visibleAdminCheckIds: Object.freeze([
      "replacement-incoming-action",
      "replacement-action-reconnect",
      "replacement-stale-action-after-resolve",
    ]),
  }),
  replacementPrivate: Object.freeze({
    generatedFromKey: "replacementPrivateFeatureTarget",
    label: "replacement private",
    source: replacementPrivateFeatureSpineSource,
    targetRow: replacementPrivateFeatureSpineTargetRows.replacementPrivateChannel,
    visibleAdminCheckIds: Object.freeze([
      "replacement-stale-private-channel",
      "replacement-stale-private-post-after-complete-reload",
    ]),
    buildVisibleAdminCheckIds: Object.freeze([
      "replacement-stale-private-channel",
      "replacement-stale-private-receipts",
      "replacement-stale-private-post-after-resolve",
      "replacement-stale-private-post-reconnect",
      "replacement-stale-private-post-after-complete",
      "replacement-stale-private-post-after-complete-reload",
    ]),
  }),
});

export const roleSurfaceSpineCaseList = Object.freeze(
  Object.values(roleSurfaceSpineCases),
);
