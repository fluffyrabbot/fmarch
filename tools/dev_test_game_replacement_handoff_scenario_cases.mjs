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
