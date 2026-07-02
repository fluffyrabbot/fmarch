import {
  productionFeatureSourceRegistry,
} from "./dev_test_game_production_feature_source_registry.mjs";

export const productionFeatureGraphSourceNodeIdsByCheckId = Object.freeze(
  Object.fromEntries(
    productionFeatureSourceRegistry.map((source) => [
      source.sourceCheckId,
      source.graphSourceNodeId,
    ]),
  ),
);

export function productionFeatureGraphSourceNodeId(sourceCheckId) {
  const nodeId = productionFeatureGraphSourceNodeIdsByCheckId[sourceCheckId];
  if (nodeId === undefined) {
    throw new Error(`unknown production feature source check: ${sourceCheckId}`);
  }
  return nodeId;
}
