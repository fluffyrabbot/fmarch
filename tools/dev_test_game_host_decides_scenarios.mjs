export const hostDecidesTieLaneId = "host-decides-tie";

export function hostDecidesTieFeatureSpineRow() {
  return {
    targetKey: "hostDecidesTie",
    featureSlotId: hostDecidesTieLaneId,
    cycleId: "host-decides",
    role: "host",
    checkpointId: "host-decides-d01-pk-resolved",
    adminCheckId: "day-vote-resolution",
    seedMembership: "demoOnly",
    seedOrder: 12,
    seedRoleOverride: "host",
  };
}
