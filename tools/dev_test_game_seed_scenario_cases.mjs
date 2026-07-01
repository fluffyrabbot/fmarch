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

export const seedDemoOnlyScenarioIds = Object.freeze([
  "day-vote-resolution",
  "day-vote-no-lynch",
  "host-deadline-advance",
  "stale-deadline-advance",
  "private-channel",
  "resolution-receipts",
  "player-action-boundary",
  "host-votecount-publication",
  "host-lifecycle-control",
  "host-modkill-control",
  "stale-host-publish-after-change",
  "stale-host-publish",
  "stale-host-lifecycle",
  "stale-host-modkill",
  "stale-host-prompt",
  "stale-host-complete",
  "stale-player-vote",
  "stale-player-vote-after-change",
  "stale-player-post-after-phase-closure",
  "stale-player-withdraw-after-change",
  "stale-player-withdraw-after-phase-closure",
  "stale-player-vote-after-phase-closure",
  "stale-dead-target-vote",
  "dead-current-vote",
  "concurrent-vote-race-reload",
]);

export const seedDemoScenarioIds = Object.freeze([
  ...seedRequiredScenarioIds.slice(0, 3),
  ...seedDemoOnlyScenarioIds.slice(0, 24),
  ...seedRequiredScenarioIds.slice(3, 11),
  seedDemoOnlyScenarioIds[24],
  ...seedRequiredScenarioIds.slice(11),
]);

export const seedScenarioCoverageGroups = Object.freeze({
  required: seedRequiredScenarioIds,
  demoOnly: seedDemoOnlyScenarioIds,
  allDemo: seedDemoScenarioIds,
});

const seedScenarioRoleOverrides = new Map([
  ["day-vote-resolution", "actionPlayer"],
  ["player-action-denied", "player"],
  ["player-action-boundary", "player"],
  ["stale-deadline-advance", "host"],
  ["concurrent-replacement-private-post-race", "player"],
  ["concurrent-replacement-private-post-race-reload", "player"],
  ["concurrent-replacement-vote-race", "player"],
  ["concurrent-replacement-vote-race-reload", "player"],
  ["concurrent-replacement-action-race", "player"],
  ["concurrent-replacement-action-race-reload", "player"],
  ["replacement-incoming-action", "player"],
  ["host-replacement-console", "host"],
  ["replacement-host-issued-invite", "host"],
  ["replacement-idempotent-retry", "host"],
  ["stale-host-invite-recovery", "host"],
  ["replacement-stale-success-recovery", "host"],
  ["replacement-stale-player", "player"],
  ["replacement-stale-action", "player"],
  ["replacement-stale-private-channel", "player"],
  ["replacement-stale-private-receipts", "player"],
  ["stale-dead-action-conflict", "actionPlayer"],
]);

const seedScenarioProofLaneAliases = new Map([
  ["host-phase-controls", ["browser-entry", "core-loop"]],
  ["cohost-deadline-control", ["browser-entry", "cohost-console"]],
  ["player-vote-recovery", ["browser-entry", "core-loop", "stale-player-vote"]],
  ["player-action-denied", ["browser-entry", "player-action-boundary"]],
  ["resolution-receipt", ["browser-entry", "resolution-receipts"]],
  ["night-action-loop", ["action-loop", "stale-action-conflict"]],
  ["local-ops-readiness", ["local-ops-artifact-bundle", "local-backup-restore-drill"]],
]);

export function seedDemoScenarioFixtureRows({
  ids = seedDemoScenarioIds,
  status = "available_locally",
} = {}) {
  return seedDemoScenarioCatalog({ ids, status }).map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    role: scenario.role,
    status: scenario.status,
  }));
}

export function seedDemoScenarioCatalog({
  ids = seedDemoScenarioIds,
  status = "available_locally",
  provenByForId = seedDemoScenarioProofLaneCandidates,
  roleUrlForRole = () => null,
} = {}) {
  return ids.map((id) => {
    const role = seedScenarioRole(id);
    return {
      id,
      title: seedScenarioTitle(id),
      status,
      role,
      roleUrlRedacted: roleUrlForRole(role),
      provenBy: provenByForId(id),
      note: seedScenarioNote(id, role),
    };
  });
}

export function seedDemoScenarioProofLaneCandidates(id) {
  return seedScenarioProofLaneAliases.get(id) ?? [id];
}

function seedScenarioNote(id, role) {
  return [
    "Local seeded scenario",
    id,
    "is exposed through the",
    role,
    "role surface and checked by matching dev-test-game proof lanes.",
  ].join(" ");
}

function seedScenarioTitle(id) {
  return String(id)
    .split("-")
    .filter((part) => part !== "")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function seedScenarioRole(id) {
  const overriddenRole = seedScenarioRoleOverrides.get(id);
  if (overriddenRole !== undefined) {
    return overriddenRole;
  }
  if (id === "local-ops-readiness") {
    return "admin";
  }
  if (id.includes("cohost")) {
    return "cohost";
  }
  if (id.includes("action") || id.includes("night-action")) {
    return "actionPlayer";
  }
  if (id.includes("denied") || id.includes("receipt") || id.includes("dead-player")) {
    return "deniedPlayer";
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
