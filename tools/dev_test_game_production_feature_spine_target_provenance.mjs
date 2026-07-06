import {
  coreLoopFeatureSpineTargetProvenanceCases,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  hardeningFeatureSpineTargetProvenanceCases,
} from "./dev_test_game_hardening_feature_spine_targets.mjs";
import {
  identityFeatureSpineTargetProvenanceCases,
} from "./dev_test_game_identity_feature_spine_targets.mjs";
import {
  roleSurfaceFeatureSpineTargetProvenanceCases,
} from "./dev_test_game_role_surface_spine_cases.mjs";

export const allProductionFeatureSpineTargetProvenanceCases = Object.freeze([
  ...identityFeatureSpineTargetProvenanceCases,
  ...roleSurfaceFeatureSpineTargetProvenanceCases,
  ...coreLoopFeatureSpineTargetProvenanceCases,
  ...hardeningFeatureSpineTargetProvenanceCases,
]);
