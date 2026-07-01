export const staleConflictMessageLaneIds = Object.freeze([
  "replacement-stale-conflict-message",
  "stale-action-conflict-message",
  "stale-dead-action-conflict",
]);

export const hostStaleControlLaneIds = Object.freeze([
  "stale-host-publish",
  "stale-host-lifecycle",
  "stale-host-modkill",
  "stale-host-prompt",
  "stale-host-prompt-reload",
  "stale-host-complete",
  "stale-host-complete-reload",
  "stale-host-complete-reconnect-recovery",
  "stale-host-control",
  "stale-host-resolve",
  "stale-host-resolve-reload",
  "stale-host-resolve-reconnect-recovery",
  "stale-host-advance",
  "stale-host-advance-reload",
  "stale-host-advance-reconnect-recovery",
  "stale-host-deadline",
  "stale-host-deadline-reload",
  "stale-host-deadline-reconnect-recovery",
]);

export const hostedMatrixStaleConflictLaneIds = Object.freeze([
  ...staleConflictMessageLaneIds,
  "stale-host-control",
]);
