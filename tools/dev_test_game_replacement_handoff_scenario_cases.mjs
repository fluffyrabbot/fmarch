import {
  assertLaneCoverageSummary,
  buildLaneCoverageSummary,
  cloneLaneCoverageFamilies,
} from "./dev_test_game_lane_coverage.mjs";

export const replacementCoreLoopHandoffLaneIds = Object.freeze([
  "replacement-host-issued-invite",
  "replacement-pending-player",
  "replacement-invalid-target-recovery",
  "replacement-console",
  "stale-host-invite-recovery",
  "replacement-stale-success-recovery",
  "replacement-stale-player",
  "replacement-stale-action",
  "replacement-stale-private-channel",
  "replacement-stale-private-receipts",
  "replacement-incoming-player",
]);

export const replacementSessionRecoveryLaneIds = Object.freeze([
  "replacement-redeemed-invite-recovery",
  "replacement-session-revocation-recovery",
  "replacement-session-refresh-recovery",
  "replacement-stale-session-after-refresh",
  "replacement-reconnect-recovery",
]);

export const replacementHandoffHardeningLaneIds = Object.freeze([
  ...replacementSessionRecoveryLaneIds,
  "replacement-idempotent-retry",
]);

export const replacementHandoffRecoveryLaneIds = Object.freeze([
  "replacement-host-issued-invite",
  "replacement-pending-player",
  ...replacementSessionRecoveryLaneIds,
  "stale-host-invite-recovery",
  "replacement-invalid-target-recovery",
  "replacement-console",
  "replacement-idempotent-retry",
  "replacement-stale-success-recovery",
  "replacement-stale-player",
  "replacement-stale-action",
  "replacement-stale-private-channel",
  "replacement-stale-private-receipts",
  "replacement-incoming-player",
]);

export const replacementHandoffRecoveryCoverageFamilyDefinitions = Object.freeze([
  Object.freeze({
    id: "replacement-entry",
    label: "Replacement entry and pending state",
    laneIds: Object.freeze([
      "replacement-host-issued-invite",
      "replacement-pending-player",
    ]),
  }),
  Object.freeze({
    id: "replacement-session-recovery",
    label: "Replacement session recovery",
    laneIds: replacementSessionRecoveryLaneIds,
  }),
  Object.freeze({
    id: "replacement-host-command-recovery",
    label: "Replacement host command recovery",
    laneIds: Object.freeze([
      "stale-host-invite-recovery",
      "replacement-invalid-target-recovery",
      "replacement-console",
      "replacement-idempotent-retry",
      "replacement-stale-success-recovery",
    ]),
  }),
  Object.freeze({
    id: "replacement-stale-outgoing-authority",
    label: "Replacement stale outgoing authority",
    laneIds: Object.freeze([
      "replacement-stale-player",
      "replacement-stale-action",
      "replacement-stale-private-channel",
      "replacement-stale-private-receipts",
    ]),
  }),
  Object.freeze({
    id: "replacement-incoming-player",
    label: "Replacement incoming player recovery",
    laneIds: Object.freeze(["replacement-incoming-player"]),
  }),
]);

export function replacementHandoffRecoveryCoverageFamilies() {
  return cloneLaneCoverageFamilies(
    replacementHandoffRecoveryCoverageFamilyDefinitions,
  );
}

export function buildReplacementHandoffRecoveryCoverageSummary(lanes) {
  return buildLaneCoverageSummary({
    lanes,
    laneIds: replacementHandoffRecoveryLaneIds,
    families: replacementHandoffRecoveryCoverageFamilyDefinitions,
  });
}

export function assertReplacementHandoffRecoveryCoverageSummary({
  summary,
  lanes,
}) {
  return assertLaneCoverageSummary({
    summary,
    lanes,
    laneIds: replacementHandoffRecoveryLaneIds,
    familyDefinitions: replacementHandoffRecoveryCoverageFamilyDefinitions,
    label: "replacement handoff recovery",
  });
}
