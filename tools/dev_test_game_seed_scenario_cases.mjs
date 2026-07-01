export const seedRequiredScenarioIds = Object.freeze([
  "host-phase-controls",
  "cohost-deadline-control",
  "player-vote-recovery",
  "player-action-denied",
  "invalid-action-recovery",
  "resolution-receipt",
  "dead-player-recovery",
  "night-action-loop",
  "action-idempotent-retry",
  "concurrent-action-race",
  "concurrent-action-race-reload",
  "concurrent-player-vote-resolve-race",
  "concurrent-player-vote-resolve-race-reload",
  "concurrent-player-action-advance-race",
  "concurrent-player-action-advance-race-reload",
  "concurrent-cohost-deadline-resolve-race",
  "concurrent-cohost-deadline-resolve-race-reload",
  "concurrent-replacement-private-post-race",
  "concurrent-replacement-private-post-race-reload",
  "concurrent-replacement-vote-race",
  "concurrent-replacement-vote-race-reload",
  "concurrent-replacement-action-race",
  "concurrent-replacement-action-race-reload",
  "replacement-incoming-action",
  "replacement-action-reconnect",
  "replacement-stale-action-after-resolve",
  "replacement-stale-private-post-after-resolve",
  "replacement-stale-private-post-reconnect",
  "replacement-stale-private-post-after-complete",
  "replacement-stale-private-post-after-complete-reload",
  "concurrent-host-resolve-race",
  "concurrent-host-resolve-race-reload",
  "stale-host-resolve-reload",
  "stale-host-resolve-reconnect-recovery",
  "concurrent-host-advance-race",
  "concurrent-host-advance-race-reload",
  "stale-host-advance-reload",
  "stale-host-advance-reconnect-recovery",
  "stale-host-deadline-reload",
  "stale-host-deadline-reconnect-recovery",
  "stale-cohost-deadline-reload",
  "stale-cohost-deadline-reconnect-recovery",
  "concurrent-host-deadline-advance-race",
  "concurrent-host-deadline-advance-race-reload",
  "concurrent-host-lifecycle-race",
  "concurrent-host-lifecycle-race-reload",
  "concurrent-host-complete-race",
  "concurrent-host-complete-race-reload",
  "stale-host-prompt-reload",
  "stale-host-complete-reload",
  "stale-host-complete-reconnect-recovery",
  "concurrent-player-complete-race",
  "public-player-complete-reload",
  "stale-player-complete-reload",
  "concurrent-host-mixed-advance-race",
  "concurrent-host-mixed-advance-race-reload",
  "stale-same-action-recovery",
  "host-replacement-console",
  "replacement-host-issued-invite",
  "replacement-pending-player",
  "replacement-redeemed-invite-recovery",
  "replacement-session-revocation-recovery",
  "replacement-session-refresh-recovery",
  "replacement-stale-session-after-refresh",
  "replacement-reconnect-recovery",
  "replacement-stale-conflict-message",
  "replacement-invalid-target-recovery",
  "replacement-idempotent-retry",
  "stale-host-invite-recovery",
  "replacement-stale-success-recovery",
  "replacement-stale-player",
  "replacement-stale-action",
  "replacement-stale-private-channel",
  "replacement-stale-private-receipts",
  "replacement-incoming-player",
  "stale-action-conflict-message",
  "stale-action-reconnect-recovery",
  "stale-dead-action-conflict",
  "private-channel-member",
  "private-channel-denied",
  "multiplayer-hardening",
  "local-ops-readiness",
]);

export const seedDemoScenarioIds = Object.freeze([
  ...seedRequiredScenarioIds.slice(0, 3),
  "day-vote-resolution",
  "day-vote-no-lynch",
  ...seedRequiredScenarioIds.slice(3, 11),
  "concurrent-vote-race-reload",
  ...seedRequiredScenarioIds.slice(11),
]);

export function seedDemoScenarioFixtureRows({
  ids = seedDemoScenarioIds,
  status = "available_locally",
} = {}) {
  return ids.map((id) => ({
    id,
    title: seedScenarioTitle(id),
    role: seedScenarioRole(id),
    status,
  }));
}

function seedScenarioTitle(id) {
  return String(id)
    .split("-")
    .filter((part) => part !== "")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function seedScenarioRole(id) {
  if (id === "local-ops-readiness") {
    return "admin";
  }
  if (id.includes("cohost")) {
    return "cohost";
  }
  if (id.includes("denied") || id.includes("receipt") || id.includes("dead-player")) {
    return "deniedPlayer";
  }
  if (id.includes("action") || id.includes("night-action")) {
    return "actionPlayer";
  }
  if (id.includes("replacement-stale-conflict")) {
    return "host";
  }
  if (id.includes("replacement") && !id.includes("host")) {
    return "replacementPlayer";
  }
  if (id.includes("host")) {
    return "host";
  }
  return "player";
}
