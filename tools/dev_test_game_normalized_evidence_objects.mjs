import {
  coreLoopPrivateChannelCompletedPostLaneId,
  coreLoopPrivateChannelStalePostLaneId,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";

export const privateChannelNormalizedEvidenceObjects = Object.freeze([
  Object.freeze({
    name: "submitPostAckProof",
    laneId: coreLoopPrivateChannelStalePostLaneId,
  }),
  Object.freeze({
    name: "completedPostRejectProof",
    laneId: coreLoopPrivateChannelCompletedPostLaneId,
  }),
]);

export function normalizedEvidenceObjectsFromProof({ proof, objects }) {
  const laneById = new Map((proof?.lanes ?? []).map((lane) => [lane.id, lane]));
  return objects.map(({ name, laneId }) => {
    const lane = laneById.get(laneId);
    return {
      name,
      laneId,
      status:
        lane?.evidence?.normalizedProofStatus ??
        lane?.evidence?.[name]?.status ??
        "missing",
      evidencePath: `lanes.${laneId}.evidence.${name}`,
    };
  });
}

export function sameNormalizedEvidenceObjects(actual, expected) {
  return JSON.stringify(actual ?? []) === JSON.stringify(expected ?? []);
}
