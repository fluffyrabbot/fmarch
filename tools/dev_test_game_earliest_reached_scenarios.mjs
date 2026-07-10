export const earliestReachedTieLaneId = "earliest-reached-tie";

export function earliestReachedTieFeatureSpineRow() {
  return {
    targetKey: "earliestReachedTie",
    featureSlotId: earliestReachedTieLaneId,
    cycleId: "earliest-reached",
    role: "host",
    checkpointId: "earliest-reached-d01-tie-resolved",
    adminCheckId: "day-vote-resolution",
    seedMembership: "demoOnly",
    seedOrder: 11,
    seedRoleOverride: "host",
  };
}
