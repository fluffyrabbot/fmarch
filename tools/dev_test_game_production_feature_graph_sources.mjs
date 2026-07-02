export const productionFeatureGraphSourceNodeIdsByCheckId = Object.freeze({
  "local-core-loop-proof": "admin-proof:core-loop",
  "local-hardening-proof": "admin-proof:hardening",
  "local-identity-adapter-proof": "admin-proof:identity",
});

export function productionFeatureGraphSourceNodeId(sourceCheckId) {
  const nodeId = productionFeatureGraphSourceNodeIdsByCheckId[sourceCheckId];
  if (nodeId === undefined) {
    throw new Error(`unknown production feature source check: ${sourceCheckId}`);
  }
  return nodeId;
}
